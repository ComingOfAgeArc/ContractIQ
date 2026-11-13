// Version comparison WITHOUT AI: plain text processing only.
//
//   chunks → clauses → align old/new clauses → diff each pair → changed values
//
// Everything here is deterministic: same input, same output, no API calls.
// Gemini is only used afterwards (comparisonService) to explain the changes.
import { diffWords } from 'diff';

// ---------- 1. chunks → clauses ----------
// A long clause may have been split into several chunks; glue the parts back.
export function buildClauses(chunks) {
  const clauses = [];
  for (const chunk of [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    const key = `${chunk.sectionNumber ?? ''}|${chunk.sectionTitle}`;
    const body = chunk.text.split('\n').slice(1).join('\n'); // drop the repeated heading line
    const last = clauses.at(-1);
    if (last?.key === key) {
      last.body += '\n' + body;
      last.pageEnd = Math.max(last.pageEnd, chunk.pageEnd);
      last.chunkIndexes.push(chunk.chunkIndex);
    } else {
      clauses.push({
        key,
        number: chunk.sectionNumber ?? null,
        title: chunk.sectionTitle,
        body,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkIndexes: [chunk.chunkIndex],
      });
    }
  }
  return clauses;
}

// ---------- helpers ----------
const normTitle = (t) => t.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Remove sub-clause numbers ("11.1", "(a)") so a clause that was only
// renumbered (11 → 12) does not look modified.
const stripNumbering = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/^(\d+\.\d+(\.\d+)*\.?|\([a-z0-9]{1,4}\))\s+/i, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (text) => new Set(text.toLowerCase().match(/[a-z0-9%]+/g) || []);

// Jaccard similarity: shared words / all words. 1 = same vocabulary, 0 = nothing shared.
export function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size && !B.size) return 1;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

// ---------- 2. align old ↔ new clauses ----------
const MIN_SIMILARITY = 0.5;

export function alignClauses(oldClauses, newClauses) {
  const pairs = [];
  const unmatchedNew = new Set(newClauses);
  const unmatchedOld = [];

  // Pass 1: same title (handles renumbering: "11. Governing Law" → "12. Governing Law")
  for (const o of oldClauses) {
    const match = [...unmatchedNew].find((n) => normTitle(n.title) === normTitle(o.title));
    if (match) {
      pairs.push({ old: o, new: match, matchedBy: 'title' });
      unmatchedNew.delete(match);
    } else {
      unmatchedOld.push(o);
    }
  }

  // Pass 2: renamed clauses ("Fees" → "Charges"): best text similarity above a threshold
  const removed = [];
  for (const o of unmatchedOld) {
    let best = null;
    let bestScore = 0;
    for (const n of unmatchedNew) {
      const score = similarity(stripNumbering(o.body), stripNumbering(n.body));
      if (score > bestScore) [best, bestScore] = [n, score];
    }
    if (best && bestScore >= MIN_SIMILARITY) {
      pairs.push({ old: o, new: best, matchedBy: 'text' });
      unmatchedNew.delete(best);
    } else {
      removed.push(o);
    }
  }

  return { pairs, removed, added: [...unmatchedNew] };
}

// ---------- 3. values: durations, money, percentages, dates ----------
const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|fifty|sixty|seventy-two|ninety';
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

const VALUE_PATTERNS = [
  // "twelve (12) months", "90 days", "five (5) business days", "seventy-two (72) hours"
  {
    kind: 'duration',
    re: new RegExp(`(?:\\b(?:${NUMBER_WORDS})\\s*)?\\(?(\\d+)\\)?\\s*(business\\s+|calendar\\s+)?(day|month|year|hour|week)s?\\b`, 'gi'),
    normalize: (m) => `${m[1]} ${m[2] ? m[2].trim().toLowerCase() + ' ' : ''}${m[3].toLowerCase()}${m[1] === '1' ? '' : 's'}`,
  },
  // "EUR 120,000", "USD 95,000", "$1,000", "€500"
  {
    kind: 'money',
    re: /(EUR|USD|GBP|INR|€|\$|£|Rs\.?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/gi,
    normalize: (m) => `${m[1].toUpperCase()} ${m[2]}`,
  },
  // "99.5%", "5 %", "two times (2x)"
  { kind: 'percent', re: /(\d+(?:\.\d+)?)\s?%/g, normalize: (m) => `${m[1]}%` },
  { kind: 'multiple', re: /\b(\d+)x\b/gi, normalize: (m) => `${m[1]}x` },
  // "1 January 2025", "March 15, 2025"
  {
    kind: 'date',
    re: new RegExp(`\\b(\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}|(?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4})\\b`, 'gi'),
    normalize: (m) => m[1],
  },
];

// Every value mentioned in a clause, with the start of its sentence as context
export function extractValues(text) {
  const values = [];
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.;])\s+/);
  for (const sentence of sentences) {
    for (const { kind, re, normalize } of VALUE_PATTERNS) {
      for (const m of sentence.matchAll(re)) {
        values.push({ kind, value: normalize(m), context: sentence.split(' ').slice(0, 10).join(' ') });
      }
    }
  }
  return values;
}

// Values in old but not in new (and vice versa), paired by kind in order of appearance.
// "12 months" gone + "6 months" new → { from: "12 months", to: "6 months" }
// Values in listA that have no equal partner in listB (each partner used once,
// so "30 days" twice in old but once in new leaves one "30 days" behind)
function subtract(listA, listB) {
  const available = new Map();
  for (const v of listB) available.set(v.value, (available.get(v.value) || 0) + 1);
  return listA.filter((v) => {
    const n = available.get(v.value) || 0;
    if (n > 0) {
      available.set(v.value, n - 1);
      return false; // found a partner → unchanged
    }
    return true;
  });
}

export function diffValues(oldText, newText) {
  const oldValues = extractValues(oldText);
  const newValues = extractValues(newText);
  const gone = subtract(oldValues, newValues);
  const fresh = subtract(newValues, oldValues);

  const changes = [];
  const unpairedFresh = [...fresh];
  for (const g of gone) {
    const i = unpairedFresh.findIndex((f) => f.kind === g.kind);
    if (i >= 0) {
      const [f] = unpairedFresh.splice(i, 1);
      changes.push({ kind: g.kind, from: g.value, to: f.value, context: f.context });
    } else {
      changes.push({ kind: g.kind, from: g.value, to: null, context: g.context });
    }
  }
  for (const f of unpairedFresh) changes.push({ kind: f.kind, from: null, to: f.value, context: f.context });
  return changes;
}

// ---------- 4. compare one aligned pair ----------
function diffPair({ old: o, new: n, matchedBy }) {
  const oldText = stripNumbering(o.body);
  const newText = stripNumbering(n.body);
  const base = {
    title: n.title,
    oldTitle: o.title !== n.title ? o.title : undefined,
    oldSection: o.number,
    newSection: n.number,
    renumbered: o.number !== n.number,
    matchedBy,
    oldPages: [o.pageStart, o.pageEnd],
    newPages: [n.pageStart, n.pageEnd],
    oldChunkIndexes: o.chunkIndexes,
    newChunkIndexes: n.chunkIndexes,
  };

  if (oldText.toLowerCase() === newText.toLowerCase()) return { ...base, status: 'unchanged', valueChanges: [] };

  return {
    ...base,
    status: 'modified',
    similarity: Number(similarity(oldText, newText).toFixed(2)),
    // Word-level diff for display: [{ type: 'same'|'removed'|'added', text }]
    wordDiff: diffWords(oldText, newText).map((p) => ({
      type: p.added ? 'added' : p.removed ? 'removed' : 'same',
      text: p.value,
    })),
    valueChanges: diffValues(oldText, newText),
    oldText,
    newText,
  };
}

// ---------- main entry ----------
export function diffVersions(oldChunks, newChunks) {
  const { pairs, removed, added } = alignClauses(buildClauses(oldChunks), buildClauses(newChunks));

  const changes = [
    ...pairs.map(diffPair),
    ...removed.map((o) => ({
      status: 'removed', title: o.title, oldSection: o.number, oldPages: [o.pageStart, o.pageEnd],
      oldChunkIndexes: o.chunkIndexes, oldText: stripNumbering(o.body), valueChanges: [],
    })),
    ...added.map((n) => ({
      status: 'added', title: n.title, newSection: n.number, newPages: [n.pageStart, n.pageEnd],
      newChunkIndexes: n.chunkIndexes, newText: stripNumbering(n.body), valueChanges: [],
    })),
  ];

  // Order by position in the new version (removed ones by their old position)
  const pos = (c) => c.newChunkIndexes?.[0] ?? c.oldChunkIndexes[0] - 0.5;
  changes.sort((a, b) => pos(a) - pos(b));
  changes.forEach((c, i) => (c.id = `D${i + 1}`));

  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const c of changes) counts[c.status]++;
  return { counts, changes };
}
