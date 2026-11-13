// Background processing: chunk → embed → index → analyse, one stage at a time,
// with every stage change saved on the contract so the UI can poll it.
//
// Deliberately simple (no Redis, no job queue, no WebSockets):
//   - jobs run inside this Node process, at most PROCESSING_CONCURRENCY at a time
//   - progress lives in MongoDB (contract.processing), so a page refresh just reads it back
//   - if the server restarts mid-job, the job is lost; on startup we mark such
//     contracts "failed: interrupted" so the user can press Retry (see recoverInterruptedJobs)
//
// Limitation: this assumes ONE server instance. With several instances, use a real queue.
import Contract from '../models/Contract.js';
import Chunk from '../models/Chunk.js';
import { processContract, runAnalysis } from './contractService.js';
import { describeAiError, isAiError } from './geminiService.js';
import { assertTransition, describeProcessing, retryPlan, INTERRUPTED_MESSAGE, RESTART_STAGES } from './processingStatus.js';

export const AUTO_ANALYZE = !/^(off|false|0|no)$/i.test(process.env.AUTO_ANALYZE || 'on');
const CONCURRENCY = Math.min(Math.max(Number(process.env.PROCESSING_CONCURRENCY) || 2, 1), 4);

const waiting = []; // [{ id, from }]
const inFlight = new Set(); // contract ids queued or running in THIS process
let running = 0;

// ---------- small helpers that write the tracker ----------

// One targeted update per change ($set on processing.* only), so the large
// `pages` array is never rewritten and other fields are never overwritten.
function saveProcessing(id, fields) {
  const $set = { 'processing.updatedAt': new Date() };
  for (const [key, value] of Object.entries(fields)) $set[`processing.${key}`] = value;
  return Contract.updateOne({ _id: id }, { $set });
}

// Message shown to the user for a failed stage. Gemini errors become actionable
// text; our own errors (e.g. "Contract too long to analyse") are shown as they are.
export function failureMessage(err) {
  if (isAiError(err)) return describeAiError(err).message;
  if (err?.name === 'DocumentNotFoundError') return 'The contract was deleted while it was being processed.';
  if (/^Mongo/.test(err?.name ?? '')) return 'Database error while saving the contract. Try again.';
  return (err?.message || 'Unexpected error').slice(0, 300);
}

// An error that knows which stage it belongs to
class StageError extends Error {
  constructor(stage, cause) {
    super(failureMessage(cause));
    this.stage = stage;
  }
}

// ---------- the pipeline for one contract ----------

// from = 'chunking' (full run) or 'analyzing' (chunks already embedded, analysis only)
// `steps` can be swapped in tests, so the pipeline logic is tested without Gemini.
export async function runPipeline(id, { from = 'chunking', autoAnalyze = AUTO_ANALYZE, steps = { processContract, runAnalysis } } = {}) {
  let stage = from;
  const enter = async (next, progress = null) => {
    if (next === stage && !progress) return; // already there: skip a pointless write
    if (next !== stage) assertTransition(stage, next);
    stage = next;
    await saveProcessing(id, { stage: next, state: 'running', progress, error: null });
  };

  try {
    const contract = await Contract.findById(id);
    if (!contract) return; // deleted while it was waiting
    await saveProcessing(id, { stage: from, state: 'running', progress: null, error: null, finishedAt: null });

    if (from === 'chunking') {
      await steps.processContract(contract, {
        onStage: enter,
        // one small write per batch of 20 chunks
        onProgress: (done, total) => saveProcessing(id, { progress: { done, total } }),
      });
      if (contract.status !== 'embedded') {
        // processContract keeps the chunks but could not embed them
        throw new StageError('embedding', contract.$locals.embedError ?? new Error(contract.error || 'Embeddings were not generated.'));
      }
    }

    const analyse = autoAnalyze || from === 'analyzing';
    if (analyse) {
      await enter('analyzing');
      await steps.runAnalysis(contract);
    }

    // Deleted while we worked? Then the chunks we just wrote are orphans.
    if (!(await Contract.exists({ _id: id }))) {
      await Chunk.deleteMany({ contractId: id });
      return;
    }
    assertTransition(stage, 'completed');
    await saveProcessing(id, {
      stage: 'completed',
      state: 'completed',
      progress: null,
      error: null,
      analysisSkipped: !analyse,
      finishedAt: new Date(),
    });
  } catch (err) {
    const failedStage = err instanceof StageError ? err.stage : stage;
    console.error(`Processing ${id} failed at ${failedStage}:`, err.message);
    if (!(await Contract.exists({ _id: id }).catch(() => true))) {
      await Chunk.deleteMany({ contractId: id }).catch(() => {});
      return;
    }
    await saveProcessing(id, {
      stage: failedStage,
      state: 'failed',
      progress: null,
      error: err instanceof StageError ? err.message : failureMessage(err),
      finishedAt: new Date(),
    }).catch((e) => console.error('Could not save failure state:', e.message));
  }
}

// ---------- a tiny in-process runner ----------

function pump() {
  while (running < CONCURRENCY && waiting.length) {
    const job = waiting.shift();
    running++;
    runPipeline(job.id, { from: job.from })
      .catch((err) => console.error('Pipeline crashed:', err)) // runPipeline handles its own errors; belt and braces
      .finally(() => {
        running--;
        inFlight.delete(job.id);
        pump();
      });
  }
}

// Add a contract to the runner. Ignored if it is already queued/running here.
export function enqueue(id, { from = 'chunking' } = {}) {
  const key = String(id);
  if (inFlight.has(key)) return false;
  if (!RESTART_STAGES.includes(from)) throw new Error(`Cannot start processing from "${from}"`);
  inFlight.add(key);
  waiting.push({ id: key, from });
  pump();
  return true;
}

export const isInFlight = (id) => inFlight.has(String(id));

// ---------- entry points used by the controller ----------

// Atomically claim a contract for a new run. The filter only matches when no
// run is queued/running, so two clicks (or two tabs) can never start two runs.
async function claim(id, from) {
  const now = new Date();
  return Contract.findOneAndUpdate(
    { _id: id, 'processing.state': { $nin: ['queued', 'running'] } },
    {
      $set: {
        'processing.stage': from,
        'processing.state': 'queued',
        'processing.error': null,
        'processing.progress': null,
        'processing.startedAt': now,
        'processing.updatedAt': now,
        'processing.finishedAt': null,
      },
      $inc: { 'processing.attempts': 1 },
    },
    { returnDocument: 'after', projection: 'title vendor version status error chunkCount pageCount processing' }
  ).lean();
}

// Retry a failed run from the safest stage. Returns { ok, status, error?, contract? }.
export async function retry(contract) {
  const plan = retryPlan(contract);
  if (!plan.retryable) return { ok: false, status: 409, error: plan.reason };
  return start(contract._id, plan.from);
}

// Re-process from scratch (re-chunk, re-embed, re-analyse), e.g. after changing the embedding model.
export async function reprocess(contract) {
  if (!contract.pageCount) return { ok: false, status: 409, error: 'No extracted text. Delete the contract and upload the PDF again.' };
  return start(contract._id, 'chunking');
}

async function start(id, from) {
  if (isInFlight(id)) return { ok: false, status: 409, error: 'This contract is already being processed.' };
  const claimed = await claim(id, from);
  if (!claimed) return { ok: false, status: 409, error: 'This contract is already being processed.' };
  enqueue(id, { from });
  return { ok: true, status: 202, contract: { ...claimed, processing: describeProcessing(claimed) } };
}

// Called once at startup: anything still "queued"/"running" belonged to a
// previous server process that is gone, so it will never finish by itself.
export async function recoverInterruptedJobs() {
  const { modifiedCount } = await Contract.updateMany(
    { 'processing.state': { $in: ['queued', 'running'] } },
    {
      $set: {
        'processing.state': 'failed',
        'processing.error': INTERRUPTED_MESSAGE,
        'processing.progress': null,
        'processing.finishedAt': new Date(),
        'processing.updatedAt': new Date(),
      },
    }
  );
  if (modifiedCount) console.warn(`Marked ${modifiedCount} interrupted contract(s) as failed (retry them from the UI).`);
  return modifiedCount;
}
