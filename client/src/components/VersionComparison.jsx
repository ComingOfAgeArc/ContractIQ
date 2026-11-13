import { Link } from 'react-router';

const STATUS = {
  added: 'bg-green-100 text-green-800',
  removed: 'bg-red-100 text-red-800',
  modified: 'bg-amber-100 text-amber-800',
  unchanged: 'bg-slate-100 text-slate-500',
};

const pages = ([a, b]) => (a === b ? `p. ${a}` : `pp. ${a}–${b}`);
const sec = (n) => (n ? `§ ${n}` : '§ –');

// Word-level diff: removed words struck through in red, added words in green
function WordDiff({ parts }) {
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((p, i) =>
        p.type === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.type === 'removed' ? (
          <del key={i} className="mx-px rounded-sm bg-red-50 px-0.5 text-red-700">{p.text}</del>
        ) : (
          <ins key={i} className="mx-px rounded-sm bg-green-50 px-0.5 text-green-800 no-underline">{p.text}</ins>
        )
      )}
    </p>
  );
}

function ChangeCard({ change, oldId, newId }) {
  const where =
    change.status === 'added'
      ? `${sec(change.newSection)} · ${pages(change.newPages)} (new)`
      : change.status === 'removed'
        ? `${sec(change.oldSection)} · ${pages(change.oldPages)} (old)`
        : `${sec(change.oldSection)} → ${sec(change.newSection)} · ${pages(change.newPages)}`;
  const link =
    change.status === 'removed'
      ? `/contracts/${oldId}?chunk=${change.oldChunkIndexes[0]}`
      : `/contracts/${newId}?chunk=${change.newChunkIndexes[0]}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 text-xs uppercase ${STATUS[change.status]}`}>{change.status}</span>
        <span className="font-medium">{change.title}</span>
        {change.oldTitle && <span className="text-xs text-slate-500">(was “{change.oldTitle}”)</span>}
        <Link to={link} className="ml-auto text-xs text-slate-500 hover:underline">{where}</Link>
      </div>

      {change.valueChanges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {change.valueChanges.map((v, i) => (
            <span key={i} title={v.context} className="rounded border border-slate-200 px-2 py-0.5 font-mono text-xs">
              <span className="text-red-700">{v.from ?? '—'}</span> → <span className="text-green-800">{v.to ?? '—'}</span>
            </span>
          ))}
        </div>
      )}

      {change.explanation && <p className="mt-2 text-sm text-slate-700">{change.explanation}</p>}

      <details className="mt-2" open={change.status === 'modified'}>
        <summary className="cursor-pointer text-xs text-slate-500">Text</summary>
        <div className="mt-1 rounded bg-slate-50 p-2">
          {change.status === 'modified' && <WordDiff parts={change.wordDiff} />}
          {change.status === 'added' && <p className="text-sm text-green-800">{change.newText}</p>}
          {change.status === 'removed' && <p className="text-sm text-red-700 line-through">{change.oldText}</p>}
        </div>
      </details>
    </div>
  );
}

export default function VersionComparison({ result }) {
  const { counts, changes, summary, warning, oldContract, newContract } = result;
  const changed = changes.filter((c) => c.status !== 'unchanged');
  const unchanged = changes.filter((c) => c.status === 'unchanged');

  return (
    <div className="space-y-4">
      {warning && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{warning}</p>}

      <div className="flex flex-wrap gap-2 text-sm">
        {['added', 'removed', 'modified', 'unchanged'].map((s) => (
          <span key={s} className={`rounded px-2 py-1 ${STATUS[s]}`}>{counts[s]} {s}</span>
        ))}
      </div>

      {summary && <p className="rounded-lg bg-slate-50 p-3 text-sm">{summary}</p>}
      <p className="text-xs text-slate-500">
        Changes detected by text diff (no AI){result.model ? `; explanations by ${result.model}` : ''}.
      </p>

      <div className="space-y-3">
        {changed.map((c) => <ChangeCard key={c.id} change={c} oldId={oldContract._id} newId={newContract._id} />)}
        {!changed.length && <p className="text-sm text-slate-500">No differences found.</p>}
      </div>

      {unchanged.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">{unchanged.length} unchanged clauses</summary>
          <ul className="mt-2 list-inside list-disc text-slate-600">
            {unchanged.map((c) => (
              <li key={c.id}>
                {c.title} {c.renumbered && <span className="text-xs text-slate-400">(renumbered {sec(c.oldSection)} → {sec(c.newSection)})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
