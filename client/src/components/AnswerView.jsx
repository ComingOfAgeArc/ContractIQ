import { useState } from 'react';
import { Link } from 'react-router';
import { pageLabel, RankBadges } from './ChunkCard.jsx';
import { answerBanner } from '../services/verificationView.js';

// One Q&A result: how well the answer is backed by the contract text, the answer
// with clickable [S1] markers, the cited sources (each linking to its place in the
// contract), and (collapsed) everything that was retrieved, so you can see what the model saw.

const TONES = {
  ok: 'border-green-200 bg-green-50 text-green-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

function VerificationBanner({ result }) {
  const b = answerBanner(result);
  return (
    <div className={`mb-3 rounded border px-3 py-2 text-xs ${TONES[b.tone]}`}>
      <span className="font-semibold">{b.title}.</span> {b.message}
      {b.details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {b.details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}

function SourceCard({ source, anchorId, cited, highlighted }) {
  const [heading, ...body] = source.text.split('\n');
  return (
    <div
      id={anchorId}
      className={`rounded border p-3 transition-shadow ${cited ? 'border-violet-300' : 'border-slate-200'} ${highlighted ? 'ring-2 ring-violet-400' : ''}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="rounded bg-violet-100 px-1.5 font-mono text-violet-800">{source.id}</span>
        <span className="font-medium text-slate-700">{source.contractTitle ?? `${source.vendor} ${source.version}`}</span>
        <span>{source.vendor} {source.version}</span>
        <span>§ {source.sectionNumber || '–'} {source.sectionTitle}</span>
        <span>{pageLabel(source)}</span>
        <RankBadges ranks={source.ranks} />
        {source.contractId && source.chunkIndex != null && (
          <Link
            to={`/contracts/${source.contractId}?chunk=${source.chunkIndex}`}
            className="ml-auto text-violet-700 hover:underline"
            title="Open this clause inside the full contract"
          >
            Open in contract →
          </Link>
        )}
      </div>
      <h5 className="text-sm font-medium">{heading}</h5>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{body.join('\n')}</p>
    </div>
  );
}

export default function AnswerView({ result, index }) {
  const anchor = (id) => `answer-${index}-${id}`;
  const citedIds = new Set(result.citations.map((c) => c.id));
  const [highlight, setHighlight] = useState(null);
  const abstained = result.abstained ?? result.verification?.status === 'insufficient_information';

  function jumpTo(id) {
    document.getElementById(anchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2000);
  }

  // Split "…12 months [S1]." into ["…12 months ", "[S1]", "."] and render markers as buttons
  const parts = result.answer.split(/(\[S\d+\])/g);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium">Q: {result.question}</p>

      <VerificationBanner result={result} />

      {abstained ? (
        <div className="rounded bg-slate-50 p-3 text-sm text-slate-700">
          <p>{result.answer}</p>
          <p className="mt-1 text-xs text-slate-500">
            Try rephrasing the question, selecting other contracts, or searching for the clause on the Search page.
          </p>
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {parts.map((part, i) => {
            const m = part.match(/^\[(S\d+)\]$/);
            if (!m) return <span key={i}>{part}</span>;
            return (
              <button
                key={i}
                onClick={() => jumpTo(m[1])}
                title="Show the cited contract text"
                className="mx-0.5 rounded bg-violet-100 px-1 align-super font-mono text-[10px] text-violet-800 hover:bg-violet-200"
              >
                {m[1]}
              </button>
            );
          })}
        </div>
      )}

      {result.citations.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-semibold uppercase text-slate-400">Cited sources</h4>
          {result.citations.map((s) => (
            <SourceCard key={s.id} source={s} anchorId={anchor(s.id)} cited highlighted={highlight === s.id} />
          ))}
        </div>
      )}

      {result.sources.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            All {result.sources.length} retrieved chunks (what the model was given) · {result.model}{result.reranked ? ' · reranked' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {result.sources
              .filter((s) => !citedIds.has(s.id))
              .map((s) => (
                <SourceCard key={s.id} source={s} anchorId={anchor(s.id)} />
              ))}
          </div>
        </details>
      )}
    </div>
  );
}
