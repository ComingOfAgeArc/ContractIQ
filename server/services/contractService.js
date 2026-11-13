import Contract from '../models/Contract.js';
import Chunk from '../models/Chunk.js';
import { extractPages, hashBuffer, looksLikePdf } from './pdfService.js';
import { chunkPages } from './chunkService.js';
import { embedDocuments, documentInput } from './embeddingService.js';
import { analyzeContract } from './analysisService.js';
import { computeFlags } from './flagService.js';
import { generateSummary } from './summaryService.js';

const MIN_CHARS = 200; // below this we assume a scanned/image-only PDF
const MAX_META_LENGTH = 120; // vendor / version / title typed by the user

// Phase 2 pipeline for one contract: pages → chunks → embeddings → MongoDB.
// Safe to re-run: old chunks are replaced.
//
// Optional hooks let the background runner (processingService) report progress:
//   onStage(stage, progress?)  called when a new stage starts
//   onProgress(done, total)    called after each embedding batch
// If embedding fails the chunks are still saved (status "chunked", `error` set)
// and the original error is kept in contract.$locals.embedError for the caller.
export async function processContract(contract, { onStage, onProgress } = {}) {
  await onStage?.('chunking');
  const drafts = chunkPages(contract.pages);
  if (!drafts.length) throw new Error('No text could be split into chunks.');

  // Embed "title | text" rather than the bare clause, so the vector also
  // carries which contract/vendor it came from ("contextual chunk header").
  const label = `${contract.title} (${contract.vendor} ${contract.version})`;
  let vectors = null;
  let error = null;
  await onStage?.('embedding', { done: 0, total: drafts.length });
  try {
    vectors = await embedDocuments(drafts.map((d) => documentInput(label, d.text)), { onProgress });
  } catch (err) {
    // Keep the chunks even if embedding fails (no key, quota...), so you can
    // still inspect them and retry with POST /api/contracts/:id/retry
    error = `Embedding failed: ${err.message}`;
    contract.$locals.embedError = err;
    console.error(error);
  }

  if (vectors) await onStage?.('indexing');
  // Atlas Search indexes new chunks automatically (near real time) once they are written.
  await Chunk.deleteMany({ contractId: contract._id });
  await Chunk.insertMany(
    drafts.map((d, i) => ({
      ...d,
      contractId: contract._id,
      vendor: contract.vendor,
      version: contract.version,
      embedding: vectors?.[i],
    }))
  );

  contract.chunkCount = drafts.length;
  contract.analysis = null; // chunks changed, so any old analysis citations may be stale
  contract.flags = [];
  contract.executiveSummary = null; // depends on the analysis, which was just cleared
  contract.status = vectors ? 'embedded' : 'chunked';
  contract.error = error ?? undefined;
  await contract.save();
  return contract;
}

// Phase 3: extract parties/dates/clauses and store them on the contract
export async function runAnalysis(contract) {
  contract.analysis = await analyzeContract(contract);
  // Phase 5: rule-based flags from the analysis + clause text (no AI)
  const chunks = await Chunk.find({ contractId: contract._id }).select('-embedding').lean();
  contract.flags = computeFlags(contract.analysis, chunks);
  contract.executiveSummary = null; // the old brief described the old analysis
  if (contract.status === 'embedded') contract.status = 'analyzed';
  // A manual re-analyse fixes a pipeline that had failed at the analysis stage
  if (contract.processing?.state === 'failed' && contract.processing.stage === 'analyzing') {
    contract.processing.stage = 'completed';
    contract.processing.state = 'completed';
    contract.processing.error = undefined;
    contract.processing.finishedAt = new Date();
  }
  contract.markModified('analysis'); // Mixed fields: tell Mongoose it changed
  contract.markModified('flags');
  contract.markModified('executiveSummary');
  await contract.save();
  return contract;
}

// Executive summary from the existing analysis + flags (one small Gemini call)
export async function runSummary(contract) {
  contract.executiveSummary = await generateSummary(contract);
  contract.markModified('executiveSummary');
  await contract.save();
  return contract;
}

export function getChunks(contractId) {
  return Chunk.find({ contractId }).select('-embedding').sort({ chunkIndex: 1 });
}

// Text typed by the user (vendor, version, title): string, trimmed, length-limited
const metaText = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_META_LENGTH) : '');

// One uploaded file → one Contract document, parsed and queued for processing.
// Chunking, embedding and analysis run afterwards in the background
// (processingService), so the upload request returns quickly and the UI can
// show each stage. Returns { ok, contract?, duplicateOf?, error? } so one bad
// file never fails the whole batch.
export async function createContractFromPdf(file, meta = {}) {
  if (!file.buffer?.length) return { ok: false, error: 'The file is empty.' };
  // The browser-supplied type and file name can lie; real PDFs start with "%PDF-"
  if (!looksLikePdf(file.buffer)) return { ok: false, error: 'Not a valid PDF file (missing PDF header).' };

  const fileHash = hashBuffer(file.buffer);
  const existing = await Contract.findOne({ fileHash }).select('_id title').lean();
  if (existing) {
    return {
      ok: false,
      error: `Duplicate: this exact PDF is already uploaded as "${existing.title}".`,
      duplicateOf: existing,
    };
  }

  let extracted;
  try {
    extracted = await extractPages(file.buffer);
  } catch (err) {
    return { ok: false, error: `Could not read PDF: ${err.message}` };
  }

  if (extracted.charCount < MIN_CHARS) {
    return { ok: false, error: 'No selectable text found (scanned PDF?). OCR is not supported.' };
  }

  meta = meta && typeof meta === 'object' ? meta : {};
  const baseName = file.originalname.replace(/\.pdf$/i, '').slice(0, MAX_META_LENGTH);
  const now = new Date();
  const contract = await Contract.create({
    title: metaText(meta.title) || baseName,
    vendor: metaText(meta.vendor) || baseName,
    version: metaText(meta.version) || 'v1',
    originalName: file.originalname,
    fileSize: file.size,
    fileHash,
    ...extracted,
    status: 'parsed',
    // Upload + text extraction are done; the background runner takes it from here
    processing: { stage: 'chunking', state: 'queued', attempts: 1, startedAt: now, updatedAt: now },
  });

  return { ok: true, contract };
}

// List view: everything except the (large) page text
export function listContracts() {
  return Contract.find().select('-pages -analysis -executiveSummary').sort({ createdAt: -1 }); // flags stay: the list shows them
}

export function getContract(id) {
  return Contract.findById(id);
}

// Small projection for status polling: no page text, analysis or summary
export function getStatuses(ids) {
  return Contract.find({ _id: { $in: ids } })
    .select('title vendor version status error chunkCount pageCount processing updatedAt')
    .lean();
}

// Deleting a contract must also delete its chunks, or search returns ghosts
export async function deleteContract(id) {
  const contract = await Contract.findByIdAndDelete(id);
  if (contract) await Chunk.deleteMany({ contractId: id });
  return contract;
}
