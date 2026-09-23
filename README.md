# ContractIQ

Contract intelligence & comparison platform. Upload PDF contracts, then:

- **Analyse**: parties, dates and 11 clause types (term, renewal, termination, payment, liability, indemnification, confidentiality, data protection, SLA, IP, governing law), each with section/page citations and a verified quote.
- **Ask**: questions over one or many contracts, answered only from the contract text with `[S1]`-style citations.
- **Compare vendors**: Vendor A vs Vendor B, clauses matched by meaning even when the wording differs.
- **Compare versions**: 2025 vs 2026, added/removed/modified clauses and changed values detected by a text diff; AI only explains.
- **Search**: hybrid (semantic + keyword) across contracts, per contract or best overall.
- **Flags**: informational, rule-based (auto-renewal, long notice periods, liability cap, missing SLA…). No risk scores, no legal advice.

**Stack:** React + Vite + Tailwind · Node.js + Express · MongoDB Atlas (Vector Search + Atlas Search) · Gemini API.
No LangChain/LlamaIndex, no agents: the RAG pipeline is written by hand in a few small files.

## How it works

```
PDF ──pdf-parse──► per-page text ──clause-aware chunking──► chunks {section, pages}
                                                               │
                                              gemini-embedding-2 (768-d)
                                                               ▼
                                          MongoDB: chunks + vectors + text index
                                                               │
 question ──► hybrid search: $vectorSearch + $search ──► Reciprocal Rank Fusion ──► top chunks
                                                               │
                         prompt: numbered sources [S1]… + strict "only these sources" rules
                                                               ▼
                                   Gemini ──► answer ──► citation check ──► answer + citations
```

| Step | File | What to know |
|---|---|---|
| Parse | `services/pdfService.js` | Text is kept **per page** so every citation can point to a page |
| Chunk | `services/chunkService.js` | Cut at clause headings (`9. Limitation of Liability`), numbers must increase, long clauses split at sub-clauses |
| Embed | `services/embeddingService.js` | `title: … \| text: …` for chunks, `task: search result \| query: …` for questions (asymmetric retrieval) |
| Retrieve | `services/searchService.js` | Vector + keyword in parallel, merged by rank (RRF, k = 60); per-contract retrieval for multi-contract questions |
| Generate | `services/ragService.js` | Sources numbered `[S1]…`; answer must cite; unknown citations are removed |
| Extract | `services/analysisService.js` | Whole contract → JSON Schema structured output; every clause's quote is checked against the text |
| Compare vendors | `services/comparisonService.js` | Align by clause **type** (from analysis), Gemini compares each pair's text |
| Compare versions | `services/clauseDiffService.js` | Pure JS: align by title → word similarity; word diff; regex value diff (`12 months → 6 months`) |
| Flags | `services/flagService.js` | Plain rules over cited clause text, configurable thresholds |

### Design decisions worth explaining

- **Clause-aware chunks, not fixed-size**: people ask about clauses, and a clause-sized chunk gives a clean citation (§ 9, p. 3).
- **Hybrid search**: embeddings understand "cancel ≈ terminate" but miss exact tokens like `ISO/IEC 27001` or `EUR 120,000`; BM25 is the opposite. RRF merges by rank because the two score scales can't be compared.
- **RAG for Q&A, full context for extraction**: Q&A needs the few best chunks; an overview must not miss a clause, and contracts fit in Gemini's context.
- **Page numbers never come from the model**: Gemini returns source or chunk ids; the server looks up section/page from its own metadata.
- **Deterministic where possible**: version diff and flags are plain code, which is testable, free and unable to hallucinate. The LLM only explains.
- **Verification layers**: invalid `[S#]` removed, quotes checked against the text, chunk ids validated, schema-constrained JSON.

## Run locally

Requires Node 22+, a free MongoDB Atlas cluster and a Gemini API key.

```bash
# API
cd server
cp .env.example .env          # set MONGODB_URI and GEMINI_API_KEY
npm install
npm run create:index          # once: vector + text indexes on the chunks collection
npm run dev                   # http://localhost:5000/api/health

# Web app (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```

Upload the three fictional contracts in `samples/`: Vendor A 2025, Vendor A 2026 (an edited version) and Vendor B 2025 (different wording, no SLA). Then analyse each one.

## Tests and evaluation

| Command (in `server/`) | Needs | What it checks |
|---|---|---|
| `npm test` | nothing | 16 unit tests: chunking, version diff, value extraction, RRF, citation cleanup, quote verification, flags |
| `npm run test:chunks` / `test:diff` / `test:pdf` | nothing | Print chunking / diff / parsing for a PDF |
| `npm run test:embed -- "question"` | Gemini key | Embeddings + cosine ranking in plain JS |
| `npm run eval` | DB + key + samples | 13 questions: recall@8 and MRR for vector vs keyword vs hybrid; fact, citation and abstention accuracy for answers. Saves `eval/results/*.json` |
| `npm run eval -- --retrieval` | DB + key | Retrieval metrics only (no text generation) |
| `npm run flags` | DB | Recompute flags for analysed contracts (after changing thresholds) |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| POST | `/api/contracts/upload` | multipart `files` (≤10 PDFs, 20 MB each) + `metadata` JSON `[{vendor, version}]` |
| GET | `/api/contracts` | List (with flags, without text) |
| GET | `/api/contracts/:id` | Contract with pages, analysis, flags |
| GET | `/api/contracts/:id/chunks` | Chunks (without vectors) |
| POST | `/api/contracts/:id/process` | Re-chunk and re-embed |
| POST | `/api/contracts/:id/analyze` | Extract parties/dates/clauses + compute flags |
| DELETE | `/api/contracts/:id` | Delete contract and its chunks |
| POST | `/api/search` | `{ query, mode: hybrid\|vector\|keyword, contractIds?, limit?, groupByContract? }` |
| POST | `/api/ask` | `{ question, contractIds? }` → `{ answer, citations, sources, model }` |
| POST | `/api/compare/vendors` | `{ contractIdA, contractIdB }` |
| POST | `/api/compare/versions` | `{ oldId, newId, explain? }` |

AI endpoints are rate-limited per IP (20/min; search 60/min; uploads 10 per 10 min), because there is no login.

## Deploy

One Render web service serves both the API and the built React app. See [DEPLOY.md](DEPLOY.md).

## Structure

```
server/
  index.js, app.js            start; express app (routes, rate limits, serves client/dist in production)
  config/                     db, gemini (models), searchIndexes (vector + text index definitions)
  models/                     Contract (pages, status, analysis, flags), Chunk (text, section, pages, embedding)
  middleware/                 upload (multer), rateLimit
  routes/ + controllers/      contracts, search, ask, compare (HTTP in/out only)
  services/
    pdfService                PDF → per-page text
    chunkService              pages → clause chunks
    embeddingService          texts → vectors (batched, retry)
    geminiService             generateText / generateJson (+ retry on 429/503)
    vectorSearchService       $vectorSearch
    keywordSearchService      $search (BM25, "quoted phrases")
    searchService             modes + Reciprocal Rank Fusion + per-contract search
    ragService                retrieve → [S#] context → Gemini → citation check
    analysisService           structured clause extraction + quote verification
    clauseDiffService         deterministic version diff + value diff
    comparisonService         vendor compare, version compare (+ explanations)
    flagService               rule-based informational flags
    contractService           upload pipeline, analysis, CRUD
  scripts/                    create indexes, eval, flags, debug helpers
  eval/                       dataset.json + evaluate.js
  test/                       node:test unit tests
client/src/
  pages/                      Contracts, ContractDetail, Search, Ask, Compare, Flags
  components/                 UploadForm, ContractList, ChunkCard, AnswerView, AnalysisView, FlagList,
                              VendorComparison, VersionComparison, ContractPicker, …
  services/api.js             every backend call
samples/                      three fictional contracts
render.yaml                   one-click deploy (see DEPLOY.md)
```

## Limitations

- Text PDFs only (no OCR for scanned contracts).
- Heading detection is heuristic; unusual layouts fall back to size-based chunks.
- Contracts over ~300k characters are too long for single-pass analysis.
- Flags are pattern rules and can miss unusual wording; every flag shows its evidence so it can be checked.
- No authentication: anyone with the URL can see and upload contracts. Don't upload confidential documents to a public deployment.

*ContractIQ summarises contract text. It is not legal advice.*
