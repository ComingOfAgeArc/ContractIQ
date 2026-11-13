// Runs the evaluation against your real database + Gemini.
//   npm run eval                 retrieval + answers
//   npm run eval -- --retrieval  retrieval only (no Gemini text calls, faster/cheaper)
//   npm run eval -- --rerank     also measure "hybrid+rerank" (extra Gemini calls)
// Needs the sample contracts uploaded (default titles) and processed. Questions
// about a sample you have not uploaded are skipped (with a note), not fatal.
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Contract from '../models/Contract.js';
import { evaluate } from '../eval/evaluate.js';
import { CHAT_MODEL, EMBEDDING_MODEL } from '../config/gemini.js';

const dir = path.resolve(import.meta.dirname, '../eval');
const fullDataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8'));
const answers = !process.argv.includes('--retrieval');
const rerank = process.argv.includes('--rerank');

await connectDB();

// Map contract titles used in the dataset to ids in your database
const titlesOf = (q) => [...q.contracts, ...q.expected.map((e) => e.contract)];
const titles = [...new Set(fullDataset.questions.flatMap(titlesOf))];
const contracts = await Contract.find({ title: { $in: titles } }).select('title status').lean();
const idsByTitle = Object.fromEntries(contracts.map((c) => [c.title, String(c._id)]));
const ready = new Set(contracts.filter((c) => ['embedded', 'analyzed'].includes(c.status)).map((c) => c.title));

// Keep only the questions whose contracts are all uploaded AND embedded
const runnable = fullDataset.questions.filter((q) => titlesOf(q).every((t) => ready.has(t)));
const skipped = fullDataset.questions.length - runnable.length;
if (!runnable.length) {
  console.error(`Upload and process the sample contracts from samples/ first (default titles). Missing or not embedded: ${titles.filter((t) => !ready.has(t)).join(', ')}`);
  process.exit(1);
}
if (skipped) {
  const missing = titles.filter((t) => !ready.has(t));
  console.warn(`Skipping ${skipped} question(s) that need contracts not uploaded/embedded yet: ${missing.join(', ')}\n`);
}
const dataset = { ...fullDataset, questions: runnable };

console.log(`Evaluating ${dataset.questions.length} questions (${answers ? 'retrieval + answers' : 'retrieval only'}${rerank ? ', + rerank' : ''})\n`);
const { summary, rows } = await evaluate(dataset, idsByTitle, { answers, rerank });

console.log('\nRetrieval');
console.table(Object.fromEntries(Object.entries(summary.retrieval).map(([m, s]) => [m, Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v?.toFixed(2)]))])));
if (summary.answers) {
  console.log('Answers (hybrid retrieval)');
  console.table(Object.fromEntries(Object.entries(summary.answers).map(([k, v]) => [k, v?.toFixed(2) ?? '-'])));
}

// Save a dated copy so you can compare runs after changing chunking, prompts or models
fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
const file = path.join(dir, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ date: new Date(), rerank, chatModel: CHAT_MODEL, embeddingModel: EMBEDDING_MODEL, summary, rows }, null, 2));
console.log(`Saved ${path.relative(process.cwd(), file)}`);

// Ready-to-paste README table
const f = (v) => (v == null ? '-' : v.toFixed(2));
console.log(`\nMarkdown for the README (${summary.questions} questions, ${CHAT_MODEL}, ${EMBEDDING_MODEL}):\n`);
console.log(`| Retrieval | recall@${summary.K} | MRR |\n|---|---|---|`);
for (const [mode, s] of Object.entries(summary.retrieval)) console.log(`| ${mode} | ${f(s[`recall@${summary.K}`])} | ${f(s.MRR)} |`);
if (summary.answers) {
  console.log(`\n| Answers | score |\n|---|---|`);
  for (const [k, v] of Object.entries(summary.answers)) console.log(`| ${k} | ${f(v)} |`);
}

await mongoose.disconnect();
