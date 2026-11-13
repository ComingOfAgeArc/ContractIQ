// How to label AI output by how well it is backed by the contract text.
// Plain functions (no React) so they are unit-tested with `npm test`.
//
// Wording matters: a citation shows WHERE to check; it does not prove the answer
// is right. So the best label is "cited", never "correct" or "true".

const ANSWER_LABELS = {
  cited: { tone: 'ok', title: 'Cited' },
  partially_cited: { tone: 'warn', title: 'Partly cited' },
  uncited: { tone: 'bad', title: 'Unverified answer' },
  insufficient_information: { tone: 'info', title: 'Not enough information' },
};

// Q&A result → { status, tone, title, message, details }
// Results saved before verification existed get a neutral fallback.
export function answerBanner(result) {
  const v = result.verification;
  if (!v) {
    return result.citations?.length
      ? { status: 'cited', ...ANSWER_LABELS.cited, message: 'Open the citations to check the answer.', details: [] }
      : { status: 'uncited', ...ANSWER_LABELS.uncited, message: 'This answer has no citations.', details: [] };
  }
  const details = [
    ...(v.invalidCitations ?? []).map((id) => `Removed citation ${id}: the model cited a source it was not given.`),
    ...(v.unverifiedValues ?? []).map((x) => `"${x.value}" does not appear in the cited text: "${x.statement}"`),
    ...(v.uncitedStatements ?? []).map((s) => `No citation: "${s}"`),
  ];
  return { status: v.status, ...(ANSWER_LABELS[v.status] ?? ANSWER_LABELS.uncited), message: v.message, details };
}

// Clause → 'verified' | 'unverified' | 'not_found' (older analyses only have `verified`)
export function clauseVerification(clause) {
  if (clause.verification) return clause.verification;
  if (!clause.found) return 'not_found';
  return clause.verified ? 'verified' : 'unverified';
}

export const CLAUSE_BADGES = {
  verified: { label: '✓ Quote verified', cls: 'bg-green-50 text-green-800 border-green-200', title: 'The quoted text was found in the contract.' },
  unverified: { label: '⚠ Unverified', cls: 'bg-amber-50 text-amber-800 border-amber-200', title: 'The AI reported this clause, but its quote could not be found in the contract text.' },
  not_found: { label: 'Not in contract', cls: 'bg-slate-50 text-slate-600 border-slate-200', title: 'No such clause was found in this contract.' },
};

// Counts for the "8 verified · 1 unverified · 2 not found" line
export function verificationCounts(clauses) {
  const counts = { verified: 0, unverified: 0, not_found: 0 };
  for (const c of clauses) counts[clauseVerification(c)]++;
  return counts;
}
