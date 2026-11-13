import { Link } from 'react-router';

// Stage-by-stage view of one contract's processing, drawn from the server's
// `processing` view (stages, percent, error, retryable). The server decides the
// state; this component only draws it, so a page refresh shows the same thing.

function StageIcon({ status }) {
  if (status === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-[11px] text-white" aria-label="done">✓</span>
    );
  }
  if (status === 'active') {
    return <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-label="in progress" />;
  }
  if (status === 'failed') {
    return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] text-white" aria-label="failed">!</span>;
  }
  if (status === 'queued') {
    return <span className="h-5 w-5 animate-pulse rounded-full border-2 border-slate-300" aria-label="waiting" />;
  }
  if (status === 'skipped') {
    return <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-400" aria-label="skipped">–</span>;
  }
  return <span className="h-5 w-5 rounded-full border-2 border-slate-200" aria-label="pending" />;
}

const STAGE_TEXT = {
  done: 'text-slate-700',
  active: 'font-medium text-slate-900',
  queued: 'text-slate-500',
  failed: 'font-medium text-red-700',
  skipped: 'text-slate-400',
  pending: 'text-slate-400',
};

function headline(p) {
  if (p.state === 'completed') return 'Ready';
  if (p.state === 'failed') return `Failed at: ${p.label}`;
  if (p.state === 'queued') return 'Waiting to start…';
  if (p.stage === 'embedding' && p.progress) return `${p.label} (${p.progress.done}/${p.progress.total} chunks)`;
  return `${p.label}…`;
}

export default function ProcessingTracker({ contract, onRetry, onDismiss, retrying = false, compact = false }) {
  const p = contract.processing;
  if (!p) return null;
  const barColor = p.state === 'failed' ? 'bg-red-500' : p.state === 'completed' ? 'bg-green-600' : 'bg-violet-600';

  return (
    <div className={`rounded-lg border bg-white p-4 ${p.state === 'failed' ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium" title={contract.title}>{contract.title}</div>
          <div className={`text-sm ${p.state === 'failed' ? 'text-red-700' : 'text-slate-500'}`}>{headline(p)}</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums text-slate-600" aria-label="progress">{p.percent}%</span>
          {p.state === 'completed' && (
            <Link to={`/contracts/${contract._id}`} className="text-violet-700 hover:underline">Open</Link>
          )}
          {onDismiss && !p.active && (
            <button onClick={() => onDismiss(contract._id)} className="text-xs text-slate-400 hover:text-slate-700" aria-label="Dismiss">✕</button>
          )}
        </div>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${p.percent}%` }} />
      </div>

      {!compact && (
        <ol className="mt-4 space-y-2">
          {p.stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <StageIcon status={s.status} />
              <span className={STAGE_TEXT[s.status]}>
                {s.label}
                {s.status === 'skipped' && ' (skipped)'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {p.state === 'failed' && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{p.error}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {p.retryable && onRetry && (
              <button
                onClick={() => onRetry(contract)}
                disabled={retrying}
                className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : p.retryFrom === 'analyzing' ? 'Retry analysis' : 'Retry processing'}
              </button>
            )}
            {!p.retryable && <span className="text-xs">This cannot be retried. Delete the contract and upload the PDF again.</span>}
            {p.attempts > 1 && <span className="text-xs opacity-70">Attempt {p.attempts}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
