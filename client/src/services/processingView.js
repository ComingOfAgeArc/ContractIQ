// Plain functions behind the processing tracker and the upload form.
// No React here, so they can be tested with Node's built-in test runner (npm test).

export const POLL_INTERVAL_MS = 1500;
const MAX_POLL_INTERVAL_MS = 10_000;

export const MAX_FILES = 10;
export const MAX_FILE_SIZE_MB = 20;

// Ids of contracts that are still queued/running, i.e. worth polling
export function activeIds(contracts) {
  return contracts.filter((c) => c?.processing?.active).map((c) => String(c._id));
}

// Wait longer after failed polls (server asleep, network blip): 1.5s, 3s, 6s, then 10s max
export function nextPollDelay(consecutiveErrors = 0) {
  return Math.min(POLL_INTERVAL_MS * 2 ** consecutiveErrors, MAX_POLL_INTERVAL_MS);
}

// Compare the previous and the new status of each contract and report the ones
// that just finished or just failed (used to show one notification per change).
// prev: { [id]: processingView }, next: [{ _id, title, processing }]
export function transitions(prev, next) {
  const completed = [];
  const failed = [];
  for (const c of next) {
    const before = prev[String(c._id)];
    if (!before?.active || !c.processing) continue; // only report what we saw running
    if (c.processing.state === 'completed') completed.push(c);
    if (c.processing.state === 'failed') failed.push(c);
  }
  return { completed, failed };
}

// Short label for a contract's state in the list ("Processing 45%", "Failed", "Ready")
export function statusLabel(contract) {
  const p = contract.processing;
  if (p?.active) return p.state === 'queued' ? 'Queued' : `Processing ${p.percent}%`;
  if (p?.state === 'failed') return 'Failed';
  return contract.status;
}

// Check files in the browser before uploading, so obvious mistakes get instant feedback.
// Returns { accepted: File[], rejected: [{ name, reason }] }
export function validateFiles(files) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) rejected.push({ name: file.name, reason: 'not a PDF' });
    else if (file.size === 0) rejected.push({ name: file.name, reason: 'the file is empty' });
    else if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) rejected.push({ name: file.name, reason: `larger than ${MAX_FILE_SIZE_MB} MB` });
    else if (seen.has(`${file.name}:${file.size}`)) rejected.push({ name: file.name, reason: 'selected twice' });
    else if (accepted.length >= MAX_FILES) rejected.push({ name: file.name, reason: `only ${MAX_FILES} files per upload` });
    else {
      seen.add(`${file.name}:${file.size}`);
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
