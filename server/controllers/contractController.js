import mongoose from 'mongoose';
import * as contractService from '../services/contractService.js';
import * as processing from '../services/processingService.js';
import { describeProcessing } from '../services/processingStatus.js';

const MAX_STATUS_IDS = 50;

// Stored contract → API shape: the raw `processing` tracker is replaced by the
// view the UI draws (stages, percent, retryable…). Same shape everywhere.
function withProcessing(doc) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return { ...obj, processing: describeProcessing(obj) };
}

// Just what the status poller needs
function statusView(c) {
  return {
    _id: c._id,
    title: c.title,
    vendor: c.vendor,
    version: c.version,
    status: c.status,
    chunkCount: c.chunkCount,
    pageCount: c.pageCount,
    processing: describeProcessing(c),
  };
}

const isRunning = (contract) => ['queued', 'running'].includes(contract.processing?.state);

// The form sends per-file details as a JSON string, in the same order as the files:
// metadata = '[{"vendor":"Vendor A","version":"2025"}, {...}]'
function parseMetadata(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// POST /api/contracts/upload
export async function uploadContracts(req, res) {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No PDF files received (form field must be "files")' });
  }

  const metadata = parseMetadata(req.body.metadata);
  const results = [];

  // One at a time keeps memory use low and logs readable.
  for (const [i, file] of req.files.entries()) {
    const result = await contractService.createContractFromPdf(file, metadata[i]);
    // Chunking, embedding and analysis continue in the background; poll /status
    if (result.ok) processing.enqueue(result.contract._id, { from: 'chunking' });
    results.push({
      file: file.originalname,
      ok: result.ok,
      error: result.error,
      duplicateOf: result.duplicateOf && { _id: result.duplicateOf._id, title: result.duplicateOf.title },
      contract: result.contract && {
        ...statusView(result.contract),
        charCount: result.contract.charCount,
      },
    });
  }

  const created = results.filter((r) => r.ok).length;
  // 201 if anything was created, 422 if every file failed
  res.status(created ? 201 : 422).json({ created, failed: results.length - created, results });
}

// GET /api/contracts
export async function listContracts(req, res) {
  const contracts = await contractService.listContracts();
  res.json(contracts.map(withProcessing));
}

// GET /api/contracts/status?ids=a,b,c  — processing status of several contracts in ONE request
// (the upload screen polls this while contracts are being processed)
export async function getStatuses(req, res) {
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'ids is required, e.g. ?ids=<id1>,<id2>' });
  if (ids.length > MAX_STATUS_IDS) return res.status(400).json({ error: `At most ${MAX_STATUS_IDS} ids per request` });
  if (!ids.every((id) => mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'ids must be valid contract ids' });

  const found = await contractService.getStatuses(ids);
  const byId = new Map(found.map((c) => [String(c._id), c]));
  res.json({
    contracts: ids.filter((id) => byId.has(id)).map((id) => statusView(byId.get(id))),
    missing: ids.filter((id) => !byId.has(id)), // e.g. deleted in another tab
  });
}

// GET /api/contracts/:id/status
export async function getStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const [contract] = await contractService.getStatuses([req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(statusView(contract));
}

// GET /api/contracts/:id
export async function getContract(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const contract = await contractService.getContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(withProcessing(contract));
}

// Shared by /process and /retry: start a background run, reply 202 with the new status
async function startRun(req, res, action) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const [contract] = await contractService.getStatuses([req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const result = await action(contract);
  if (!result.ok) return res.status(result.status).json({ error: result.error, processing: describeProcessing(contract) });
  const c = result.contract;
  // Same fields as before (_id, status, chunkCount, error) plus the processing view
  res.status(202).json({ _id: c._id, status: c.status, chunkCount: c.chunkCount, error: c.error, processing: c.processing });
}

// POST /api/contracts/:id/process  — re-chunk, re-embed and re-analyse from scratch (runs in the background)
export const processContract = (req, res) => startRun(req, res, processing.reprocess);

// POST /api/contracts/:id/retry  — continue a failed run from the safest stage
export const retryContract = (req, res) => startRun(req, res, processing.retry);

// POST /api/contracts/:id/analyze  — extract parties, dates and key clauses with Gemini
export async function analyzeContract(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const contract = await contractService.getContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!contract.chunkCount) return res.status(409).json({ error: 'Process the contract before analysing it' });
  if (isRunning(contract)) return res.status(409).json({ error: 'This contract is still being processed. Wait for it to finish.' });
  if (!['embedded', 'analyzed'].includes(contract.status)) {
    return res.status(409).json({ error: 'Embeddings are missing. Retry processing before analysing.' });
  }
  await contractService.runAnalysis(contract);
  res.json({ _id: contract._id, status: contract.status, analysis: contract.analysis });
}

// POST /api/contracts/:id/summary  — plain-English executive summary (needs the analysis first)
export async function summarizeContract(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const contract = await contractService.getContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!contract.analysis) return res.status(409).json({ error: 'Analyse the contract before summarising it' });
  await contractService.runSummary(contract);
  res.json({ _id: contract._id, executiveSummary: contract.executiveSummary });
}

// GET /api/contracts/:id/chunks
export async function getChunks(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  res.json(await contractService.getChunks(req.params.id));
}

// DELETE /api/contracts/:id
export async function deleteContract(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const contract = await contractService.deleteContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json({ deleted: contract._id });
}
