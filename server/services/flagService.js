// Informational flags: plain rules over the contract text, no AI.
//
// A flag says "this is worth a look" and shows the evidence. It is NOT a risk
// score or legal advice. Three neutral types:
//   clause    – a notable term is present   (e.g. automatic renewal)
//   threshold – a value passes a limit you can configure (e.g. notice ≥ 90 days)
//   missing   – a commonly expected clause was not found
//
// Rules read the text of the chunks that Phase 3 analysis cited for each clause
// type, and reuse extractValues() from the version diff to read durations.
import { extractValues } from './clauseDiffService.js';

// Change these to match your own review checklist
export const THRESHOLDS = {
  terminationNoticeDays: 90, // flag convenience-termination notice at or above this
  renewalNoticeDays: 90,     // flag non-renewal notice at or above this
  initialTermMonths: 36,     // flag initial terms at or above this
  breachNoticeHours: 72,     // flag breach notification slower than this
};

// "180 days" / "6 months" / "72 hours" / "5 business days" → comparable numbers
const HOURS = { hour: 1, day: 24, week: 168, month: 730, year: 8760 };
function toHours(duration) {
  const m = duration.match(/^(\d+) (?:business |calendar )?(hour|day|week|month|year)s?$/);
  return m ? Number(m[1]) * HOURS[m[2]] : null;
}
const toDays = (d) => (toHours(d) ?? NaN) / 24;
const toMonths = (d) => (toHours(d) ?? NaN) / HOURS.month;

// Short label for a table cell: "12 months of fees" / "2x charges" / first words
function capValue(cap) {
  if (!cap) return 'Yes';
  const v = extractValues(cap).find((x) => x.kind === 'duration' || x.kind === 'multiple' || x.kind === 'money');
  if (v?.kind === 'duration') return `${v.value} of ${/fees|charges/i.test(cap) ? 'fees' : 'payments'}`;
  if (v?.kind === 'multiple') return `${v.value} ${/fees|charges/i.test(cap) ? 'charges' : ''}`.trim();
  if (v) return v.value;
  return cap.split(' ').slice(0, 5).join(' ');
}

const sentences = (text) => text.replace(/\s+/g, ' ').split(/(?<=[.;])\s+/);
const firstDuration = (sentence) => extractValues(sentence).find((v) => v.kind === 'duration')?.value;

// Each rule gets a helper for one clause type and returns a flag or null
const RULES = [
  function autoRenewal(clause) {
    const c = clause('renewal');
    const s = c.sentences.find((x) => /automatic(ally)?\s+renew|renews?\s+automatically|auto-?renew/i.test(x));
    if (!s || /\b(no|not|never|without)\b[^.]{0,40}automatic/i.test(s)) return null;
    const notice = firstDuration(s.replace(/^.*?(notice)/i, '$1')) ?? firstDuration(s);
    return {
      code: 'AUTO_RENEWAL', type: 'clause', clauseKey: 'renewal', title: 'Automatic renewal', value: notice ? `${notice} notice` : 'Yes',
      detail: notice ? `Renews automatically unless notice is given (${notice}).` : 'Renews automatically.',
      evidence: s,
    };
  },

  function renewalNotice(clause) {
    const c = clause('renewal');
    const s = c.sentences.find((x) => /non-renewal|not to renew|notice/i.test(x) && /renew/i.test(x));
    const notice = s && firstDuration(s.replace(/^.*?(notice)/i, '$1'));
    if (!notice || toDays(notice) < THRESHOLDS.renewalNoticeDays) return null;
    return {
      code: 'LONG_RENEWAL_NOTICE', type: 'threshold', clauseKey: 'renewal', title: 'Long non-renewal notice', value: notice,
      detail: `Non-renewal notice of ${notice} (flag threshold: ${THRESHOLDS.renewalNoticeDays} days).`, evidence: s,
    };
  },

  function terminationNotice(clause) {
    const c = clause('termination');
    if (!c.found) return null;
    const s = c.sentences.find((x) => /convenience|any reason|without cause/i.test(x));
    if (!s) {
      return {
        code: 'NO_CONVENIENCE_TERMINATION', type: 'missing', clauseKey: 'termination', title: 'No termination for convenience', value: 'Not found',
        detail: 'No right to terminate for convenience was found; termination may require cause.', evidence: null,
      };
    }
    const notice = firstDuration(s);
    if (!notice || toDays(notice) < THRESHOLDS.terminationNoticeDays) return null;
    return {
      code: 'LONG_TERMINATION_NOTICE', type: 'threshold', clauseKey: 'termination', title: 'Long termination notice', value: notice,
      detail: `Termination for convenience needs ${notice} notice (flag threshold: ${THRESHOLDS.terminationNoticeDays} days).`,
      evidence: s,
    };
  },

  function liabilityCap(clause) {
    const c = clause('liability');
    if (!c.found) {
      return {
        code: 'NO_LIABILITY_CLAUSE', type: 'missing', clauseKey: 'liability', title: 'No limitation of liability found', value: 'Not found',
        detail: 'No clause limiting liability was found.', evidence: null,
      };
    }
    const s = c.sentences.find((x) => /limited to|shall not exceed|not exceed|cap(ped)?\b|in no event/i.test(x));
    if (!s) return null;
    const cap = s.match(/(?:limited to|exceed)\s+(.{5,120}?)(?:[.;]|$)/i)?.[1];
    return {
      code: 'LIABILITY_CAP', type: 'clause', clauseKey: 'liability', title: 'Liability cap', value: capValue(cap),
      detail: cap ? `Liability capped at ${cap}.` : 'Liability is capped.', evidence: s,
    };
  },

  function initialTerm(clause) {
    const c = clause('term');
    const s = c.sentences.find((x) => /initial term|term of|in force for|continues for|remains in force/i.test(x));
    const term = s && firstDuration(s);
    if (!term || toMonths(term) < THRESHOLDS.initialTermMonths) return null;
    return {
      code: 'LONG_INITIAL_TERM', type: 'threshold', clauseKey: 'term', title: 'Long initial term', value: term,
      detail: `Initial term of ${term} (flag threshold: ${THRESHOLDS.initialTermMonths} months).`, evidence: s,
    };
  },

  function priceIncrease(clause) {
    const c = clause('payment');
    const s = c.sentences.find((x) => /increase (the )?(fees|prices|charges)|price increase|fee increase/i.test(x));
    if (!s) return null;
    const pct = extractValues(s).find((v) => v.kind === 'percent')?.value;
    return { code: 'PRICE_INCREASE', type: 'clause', clauseKey: 'payment', title: 'Price increases allowed', value: pct ? `up to ${pct}` : 'Yes', detail: s, evidence: s };
  },

  function nonRefundable(clause) {
    for (const key of ['payment', 'termination']) {
      const s = clause(key).sentences.find((x) => /non-?refundable|no refund/i.test(x));
      if (s) return { code: 'NON_REFUNDABLE', type: 'clause', clauseKey: key, title: 'Non-refundable fees', value: 'Yes', detail: s, evidence: s };
    }
    return null;
  },

  function breachNotice(clause) {
    const c = clause('dataProtection');
    if (!c.found) {
      return {
        code: 'NO_DATA_PROTECTION', type: 'missing', clauseKey: 'dataProtection', title: 'No data protection clause found', value: 'Not found',
        detail: 'No clause on processing or protecting personal data was found.', evidence: null,
      };
    }
    const s = c.sentences.find((x) => /breach|unauthori[sz]ed access|incident/i.test(x) && extractValues(x).some((v) => v.kind === 'duration'));
    const period = s && firstDuration(s);
    if (!period || toHours(period) <= THRESHOLDS.breachNoticeHours) return null;
    return {
      code: 'SLOW_BREACH_NOTICE', type: 'threshold', clauseKey: 'dataProtection', title: 'Breach notification period', value: period,
      detail: `Breach notification within ${period} (flag threshold: ${THRESHOLDS.breachNoticeHours} hours).`, evidence: s,
    };
  },

  function missingSla(clause) {
    if (clause('sla').found) return null;
    return {
      code: 'MISSING_SLA', type: 'missing', clauseKey: 'sla', title: 'No service levels (SLA) found', value: 'Not found',
      detail: 'No availability commitment or service credits were found.', evidence: null,
    };
  },
];

// analysis (Phase 3) + chunks → flags with citations
export function computeFlags(analysis, chunks) {
  if (!analysis) return [];
  const byIndex = new Map(chunks.map((c) => [c.chunkIndex, c]));

  const clause = (key) => {
    const a = analysis.clauses[key] ?? { found: false, chunkIds: [], citations: [] };
    const text = a.chunkIds
      .map((i) => byIndex.get(i)?.text ?? '')
      .flatMap((t) => t.split('\n').slice(1)) // drop the heading line
      .map((line) => line.replace(/^(\d+\.\d+(\.\d+)*\.?|\([a-z0-9]{1,4}\))\s+/i, '')) // drop "3.3 " / "(a) "
      .join('\n');
    return { found: a.found, citations: a.citations ?? [], sentences: a.found ? sentences(text) : [] };
  };

  return RULES.map((rule) => rule(clause))
    .filter(Boolean)
    .map((flag) => ({ ...flag, citations: clause(flag.clauseKey).citations }));
}
