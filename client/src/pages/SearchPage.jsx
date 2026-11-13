import { useState } from 'react';
import { Link } from 'react-router';
import ChunkCard from '../components/ChunkCard.jsx';
import ContractPicker from '../components/ContractPicker.jsx';
import NoContracts from '../components/NoContracts.jsx';
import { useReadyContracts } from '../services/useContracts.js';
import * as api from '../services/api.js';

const MODES = [
  { id: 'hybrid', label: 'Hybrid', hint: 'Meaning + exact words, merged with Reciprocal Rank Fusion. Best default.' },
  { id: 'vector', label: 'Semantic', hint: 'By meaning: "cancel the deal" finds "Termination".' },
  { id: 'keyword', label: 'Keyword', hint: 'Exact words and "quoted phrases": ISO/IEC 27001, "Schedule 1", EUR 120,000.' },
];

const EXAMPLES = ['how do we cancel the agreement', 'ISO/IEC 27001', '"72 hours"', 'price increase on renewal'];

export default function SearchPage() {
  const { contracts, loading, error: loadError } = useReadyContracts();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('hybrid');
  const [grouped, setGrouped] = useState(true);
  const [results, setResults] = useState(null); // { grouped, data }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const names = Object.fromEntries(contracts.map((c) => [c._id, `${c.vendor} ${c.version}`]));

  async function runSearch(q = query) {
    if (!q.trim()) return;
    setBusy(true);
    setError('');
    try {
      const data = grouped
        ? await api.searchAcross(q, selected, 2, mode)
        : await api.searchChunks(q, { contractIds: selected, limit: 8, mode });
      setResults({ grouped, data });
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !loadError && !contracts.length) return <NoContracts what="Search" />;

  const pill = (active) =>
    `rounded px-3 py-1 text-sm ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Search across contracts</h2>
          <div className="flex gap-1">
            <button type="button" className={pill(grouped)} onClick={() => setGrouped(true)}>Per contract</button>
            <button type="button" className={pill(!grouped)} onClick={() => setGrouped(false)}>Best overall</button>
          </div>
        </div>

        <ContractPicker contracts={contracts} selected={selected} onChange={setSelected} />

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. data breach notification, "30 days", ISO/IEC 27001'
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button type="button" key={m.id} className={pill(mode === m.id)} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
          <span className="text-xs text-slate-500">{MODES.find((m) => m.id === mode).hint}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => {
                setQuery(q);
                runSearch(q);
              }}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>
        {(error || loadError) && <p className="text-sm text-red-600">{error || loadError}</p>}
      </form>

      {results?.grouped && (
        <div className="grid gap-4 md:grid-cols-2">
          {results.data.map(({ contract, results: hits }) => (
            <div key={contract._id} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Link to={`/contracts/${contract._id}`} className="font-medium hover:underline">
                {contract.vendor} {contract.version}
              </Link>
              {hits.map((r) => <ChunkCard key={r._id} chunk={r} score={r.score} />)}
              {!hits.length && <p className="text-sm text-slate-500">No match.</p>}
            </div>
          ))}
        </div>
      )}

      {results && !results.grouped && (
        <div className="space-y-2">
          {results.data.map((r) => (
            <ChunkCard key={r._id} chunk={r} score={r.score} source={names[r.contractId] || r.contractTitle} />
          ))}
          {!results.data.length && <p className="text-sm text-slate-500">No results.</p>}
        </div>
      )}
    </div>
  );
}
