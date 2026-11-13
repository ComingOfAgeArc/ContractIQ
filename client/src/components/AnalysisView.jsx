import { CLAUSE_BADGES, clauseVerification, verificationCounts } from '../services/verificationView.js';

// Shows the extracted overview: summary, parties, dates and one card per clause type.
// Every card cites its chunks (§ section · page) and says whether its quote was verified.

function VerificationBadge({ clause }) {
  const b = CLAUSE_BADGES[clauseVerification(clause)];
  return <span title={b.title} className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${b.cls}`}>{b.label}</span>;
}

function CitationChip({ citation, onClick }) {
  const pages =
    citation.pageStart === citation.pageEnd ? `p. ${citation.pageStart}` : `pp. ${citation.pageStart}–${citation.pageEnd}`;
  return (
    <button
      onClick={() => onClick(citation.chunkIndex)}
      title={citation.sectionTitle}
      className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-violet-100"
    >
      § {citation.sectionNumber || citation.sectionTitle} · {pages}
    </button>
  );
}

function ClauseCard({ clause, onCite }) {
  const state = clauseVerification(clause);
  if (state === 'not_found') {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-slate-500">{clause.label}</h4>
          <VerificationBadge clause={clause} />
        </div>
        <p className="mt-1 text-xs text-slate-400">Not found in this contract</p>
      </div>
    );
  }

  const unverified = state === 'unverified';
  return (
    <div className={`rounded-lg border p-3 ${unverified ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium">{clause.label}</h4>
        <VerificationBadge clause={clause} />
      </div>
      <p className="mt-1 text-sm text-slate-700">{clause.summary}</p>

      {clause.keyValues.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {clause.keyValues.map((kv, i) => (
            <div key={i} className="contents">
              <dt className="text-slate-500">{kv.label}</dt>
              <dd className="font-medium">
                {kv.value}
                {kv.check === 'not_in_text' && (
                  <span
                    className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-normal text-amber-800"
                    title="A number in this value does not appear in the cited contract text. Check the source."
                  >
                    ⚠ not in cited text
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {clause.quote && (
        <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">“{clause.quote}”</blockquote>
      )}
      {(unverified || clause.verificationNote) && (
        <p className={`mt-1 text-xs ${unverified ? 'text-amber-800' : 'text-slate-500'}`}>
          {clause.verificationNote || 'The quote could not be found in the contract text. Check the source.'}
        </p>
      )}
      {clause.invalidChunkIds?.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          Ignored {clause.invalidChunkIds.length} reference(s) to sections that do not exist.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {clause.citations.map((c) => (
          <CitationChip key={c.chunkIndex} citation={c} onClick={onCite} />
        ))}
      </div>
    </div>
  );
}

export default function AnalysisView({ analysis, onCite }) {
  const clauses = Object.values(analysis.clauses);
  const counts = verificationCounts(clauses);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p>{analysis.summary}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-slate-400">Parties</div>
            {analysis.parties.map((p) => (
              <div key={p.name}>
                {p.name} <span className="text-slate-500">({p.role})</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Effective date</div>
            <div>{analysis.effectiveDate || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">End date</div>
            <div>{analysis.endDate || 'Not stated'}</div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {clauses.length - counts.not_found} of {clauses.length} clause types found:{' '}
        <span className="text-green-700">{counts.verified} with a verified quote</span>
        {counts.unverified > 0 && <span className="text-amber-700"> · {counts.unverified} unverified (check the source)</span>}
        {' '}· extracted by {analysis.model} on {new Date(analysis.analyzedAt).toLocaleString()}
      </p>
      <p className="text-xs text-slate-400">
        “Verified” means the quoted words were found in the contract. It does not guarantee the summary is complete
        or correct; click a § citation to read the clause.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {clauses.map((clause) => (
          <ClauseCard key={clause.label} clause={clause} onCite={onCite} />
        ))}
      </div>
    </div>
  );
}
