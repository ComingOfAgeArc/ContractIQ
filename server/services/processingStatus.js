// Processing status: the stages a contract goes through after upload, and how
// to turn what is stored in MongoDB into what the UI shows.
//
// Pure functions only (no database, no API calls), so every rule here is unit-tested.
//
//   uploaded → parsing → chunking → embedding → indexing → analyzing → completed
//   (any running stage can end in state "failed"; a failed run can be retried)
//
// Upload and text extraction happen inside the upload request, so a contract
// first appears in the database already at "chunking" / queued. Everything
// from chunking onwards runs in the background (processingService.js).

export const STAGES = [
  { key: 'uploaded', label: 'File uploaded', weight: 5 },
  { key: 'parsing', label: 'Extracting text from PDF', weight: 10 },
  { key: 'chunking', label: 'Splitting document into chunks', weight: 5 },
  { key: 'embedding', label: 'Generating embeddings', weight: 35 },
  { key: 'indexing', label: 'Indexing document for search', weight: 10 },
  { key: 'analyzing', label: 'Analyzing contract clauses', weight: 35 },
  { key: 'completed', label: 'Processing completed', weight: 0 },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const PROCESSING_STATES = ['queued', 'running', 'completed', 'failed'];

// Stages the background pipeline can (re)start from
export const RESTART_STAGES = ['chunking', 'analyzing'];

export const INTERRUPTED_MESSAGE = 'Processing was interrupted because the server restarted. Click Retry to continue.';

const indexOf = (stage) => STAGE_KEYS.indexOf(stage);

// Is moving the pipeline from one stage to the next allowed?
// Only forwards. Skipping is allowed (indexing → completed when analysis is turned off).
export function isValidTransition(from, to) {
  const a = indexOf(from);
  const b = indexOf(to);
  if (a < 0 || b < 0) return false;
  return b > a;
}

// Throws on a bad transition, so a coding mistake shows up in tests/logs
// instead of the UI quietly jumping backwards.
export function assertTransition(from, to) {
  if (!isValidTransition(from, to)) throw new Error(`Invalid processing transition: ${from} → ${to}`);
}

// Contracts uploaded before `processing` existed have no tracker. Work out a
// sensible equivalent from their old `status` field.
export function legacyProcessing(contract) {
  switch (contract.status) {
    case 'analyzed':
      return { stage: 'completed', state: 'completed' };
    case 'embedded':
      return { stage: 'completed', state: 'completed', analysisSkipped: true };
    case 'chunked':
      return { stage: 'embedding', state: 'failed', error: contract.error || 'Embeddings were not generated.' };
    default: // uploaded / parsed / failed: never finished processing
      return { stage: 'chunking', state: 'failed', error: contract.error || 'Processing did not finish for this contract.' };
  }
}

// Can the user safely press Retry, and from which stage?
// - only a failed run can be retried (never while queued/running: two runs would race)
// - the PDF bytes are not kept, so we need the extracted pages to redo anything
// - analysis can be retried on its own when the chunks are already embedded
export function retryPlan(contract, processing = contract.processing?.state ? contract.processing : legacyProcessing(contract)) {
  if (processing.state !== 'failed') return { retryable: false, reason: `Contract is ${processing.state}` };
  if (!contract.pageCount) return { retryable: false, reason: 'No extracted text. Delete the contract and upload the PDF again.' };
  if (processing.stage === 'analyzing' && ['embedded', 'analyzed'].includes(contract.status)) {
    return { retryable: true, from: 'analyzing' };
  }
  return { retryable: true, from: 'chunking' };
}

// Percentage for the progress bar. Never 100 until the pipeline has actually finished.
export function percentFor(processing) {
  if (processing.state === 'completed') return 100;
  const current = indexOf(processing.stage);
  let percent = STAGES.slice(0, Math.max(current, 0)).reduce((sum, s) => sum + s.weight, 0);
  const { done, total } = processing.progress ?? {};
  if (processing.state === 'running' && total > 0 && current >= 0) {
    percent += STAGES[current].weight * Math.min(done / total, 1);
  }
  return Math.min(Math.round(percent), 99);
}

// Stored contract → everything the UI needs to draw the stage list.
export function describeProcessing(contract) {
  const p = contract.processing?.state ? contract.processing : legacyProcessing(contract);
  const current = indexOf(p.stage);
  const done = p.state === 'completed';

  const stages = STAGES.map((s, i) => {
    let status;
    if (done) status = s.key === 'analyzing' && p.analysisSkipped ? 'skipped' : 'done';
    else if (i < current) status = 'done';
    else if (i > current) status = 'pending';
    else status = p.state === 'failed' ? 'failed' : p.state === 'queued' ? 'queued' : 'active';
    return { key: s.key, label: s.label, status };
  });

  const plan = retryPlan(contract, p);
  return {
    stage: p.stage,
    state: p.state,
    label: STAGES[current]?.label ?? p.stage,
    error: p.state === 'failed' ? p.error || 'Processing failed.' : null,
    progress: p.progress?.total ? { done: p.progress.done, total: p.progress.total } : null,
    percent: percentFor(p),
    active: p.state === 'queued' || p.state === 'running', // the UI keeps polling while true
    analysisSkipped: Boolean(p.analysisSkipped),
    retryable: plan.retryable,
    retryFrom: plan.from ?? null,
    attempts: p.attempts ?? 0,
    updatedAt: p.updatedAt ?? null,
    stages,
  };
}
