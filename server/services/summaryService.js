// Executive summary: a one-screen, plain-English brief of a contract.
//
// Input is NOT the raw contract. It is the structured analysis (Phase 3) plus the
// rule-based flags (Phase 5) that already exist and already carry verified quotes.
// Gemini only has to write them up, which keeps it small, cheap and far less
// likely to invent anything. Same rules as the rest of the app: describe what the
// contract says; no legal advice, no risk scores.
import { generateJson } from './geminiService.js';
import { CHAT_MODEL } from '../config/gemini.js';

const summarySchema = {
  type: 'object',
  properties: {
    overview: { type: 'string', description: '2-3 sentences: who the parties are, what the contract is for, how long it runs.' },
    keyTerms: {
      type: 'array',
      description: 'The most important concrete terms, e.g. {label:"Annual fee", value:"EUR 120,000"}',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
    worthReading: {
      type: 'array',
      description: 'Up to 5 short points about terms a reader should look at closely, based on the flags and clauses.',
      items: { type: 'string' },
    },
    notFound: {
      type: 'array',
      description: 'Clause types that were not found in the contract.',
      items: { type: 'string' },
    },
  },
  required: ['overview', 'keyTerms', 'worthReading', 'notFound'],
};

const SYSTEM_PROMPT = `You write a short executive summary of a contract for a busy reader.
Use ONLY the structured data provided (parties, dates, extracted clauses, flags).
- Never guess or add facts that are not in the data. Copy numbers, periods and amounts exactly as written.
- keyTerms: 5 to 8 of the most decision-relevant concrete terms (term, renewal, fees, notice periods, liability cap, SLA).
- worthReading: up to 5 short points drawn from the flags and clauses. Neutral wording: say what the contract says,
  not whether it is good or bad. No legal advice, no risk ratings, no recommendations.
- notFound: the labels of clause types marked as not found.
- Plain text only, no markdown.`;

// contract (with analysis + flags) → the compact JSON sent to Gemini.
// Pure function, unit-tested. Drops quotes/citations/ids: the model does not need them.
export function buildSummaryInput(contract) {
  const a = contract.analysis;
  if (!a) throw new Error('Contract has not been analysed yet');

  return {
    title: contract.title,
    vendor: contract.vendor,
    version: contract.version,
    parties: a.parties ?? [],
    effectiveDate: a.effectiveDate ?? null,
    endDate: a.endDate ?? null,
    overview: a.summary ?? '',
    clauses: Object.values(a.clauses ?? {}).map((c) => ({
      label: c.label,
      found: Boolean(c.found),
      summary: c.found ? c.summary : '',
      keyValues: c.found ? (c.keyValues ?? []) : [],
    })),
    flags: (contract.flags ?? []).map((f) => ({ title: f.title, type: f.type, value: f.value, detail: f.detail })),
  };
}

export async function generateSummary(contract) {
  const input = buildSummaryInput(contract);
  const raw = await generateJson({
    system: SYSTEM_PROMPT,
    prompt: `Contract data:\n\n${JSON.stringify(input, null, 2)}`,
    schema: summarySchema,
  });

  return {
    overview: raw.overview ?? '',
    keyTerms: raw.keyTerms ?? [],
    worthReading: raw.worthReading ?? [],
    notFound: raw.notFound ?? [],
    model: CHAT_MODEL,
    generatedAt: new Date(),
  };
}
