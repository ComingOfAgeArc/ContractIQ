import { useState } from 'react';
import { useSearchParams } from 'react-router';
import AnswerView from '../components/AnswerView.jsx';
import ContractPicker from '../components/ContractPicker.jsx';
import NoContracts from '../components/NoContracts.jsx';
import { useToast } from '../components/Toasts.jsx';
import { useReadyContracts } from '../services/useContracts.js';
import * as api from '../services/api.js';

const EXAMPLES = [
  'How much notice is needed to terminate for convenience?',
  'What is the liability cap?',
  'Does the contract renew automatically?',
  'How quickly must a data breach be reported?',
];

export default function AskPage() {
  const [searchParams] = useSearchParams();
  const { contracts, loading, error: loadError } = useReadyContracts();
  const toast = useToast();
  const [selected, setSelected] = useState(() => {
    const preset = searchParams.get('contract'); // from "Ask about this contract"
    return preset ? [preset] : [];
  });
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]); // newest first
  const [rerank, setRerank] = useState('default'); // 'default' = server setting | 'on' | 'off'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleAsk(e) {
    e?.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.ask(question.trim(), selected, rerank === 'default' ? undefined : rerank === 'on');
      setHistory((h) => [result, ...h]);
      setQuestion('');
    } catch (err) {
      setError(api.errorMessage(err));
      toast.error(`Could not answer: ${api.errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !loadError && !contracts.length) return <NoContracts what="Asking questions" />;

  return (
    <div className="space-y-6">
      <form onSubmit={handleAsk} className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Ask your contracts</h2>
        <p className="mb-3 text-xs text-slate-500">
          Answers come only from the contract text, with citations. Nothing selected = search all contracts.
        </p>

        <div className="mb-3">
          <ContractPicker contracts={contracts} selected={selected} onChange={setSelected} />
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAsk(e)}
          rows={2}
          placeholder="e.g. Compare the liability caps"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button disabled={busy || !question.trim()} className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {busy ? 'Searching and answering…' : 'Ask'}
          </button>
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Rerank: Gemini re-scores the retrieved clauses before answering. Slower, often more accurate.">
            Rerank
            <select value={rerank} onChange={(e) => setRerank(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
              <option value="default">server default</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          {EXAMPLES.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => setQuestion(q)}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>
        {(error || loadError) && <p className="mt-2 text-sm text-red-600">{error || loadError}</p>}
      </form>

      {busy && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4" aria-label="Answer loading">
          <p className="text-sm text-slate-500">Finding relevant clauses, then writing a cited answer…</p>
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      )}

      {history.map((result, i) => (
        <AnswerView key={history.length - i} result={result} index={history.length - i} />
      ))}
    </div>
  );
}
