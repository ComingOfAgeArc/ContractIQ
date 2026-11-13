import { Link } from 'react-router';

// Neutral styling on purpose: flags are "worth a look", not good/bad ratings.
export const FLAG_TYPES = {
  clause: { label: 'Notable term', cls: 'border-sky-200 bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
  threshold: { label: 'Above threshold', cls: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  missing: { label: 'Not found', cls: 'border-slate-200 bg-slate-50 text-slate-700', dot: 'bg-slate-400' },
};

export default function FlagList({ flags, contractId, onCite }) {
  if (!flags?.length) {
    return <p className="text-sm text-slate-500">No flags for this contract.</p>;
  }

  return (
    <div className="space-y-2">
      {flags.map((f) => {
        const t = FLAG_TYPES[f.type] ?? FLAG_TYPES.clause;
        return (
          <div key={f.code} className={`rounded border p-2 text-sm ${t.cls}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${t.dot}`} />
              <span className="font-medium">{f.title}</span>
              <span className="text-xs opacity-70">{t.label}</span>
              <span className="ml-auto flex gap-1">
                {f.citations.map((c) =>
                  onCite ? (
                    <button key={c.chunkIndex} onClick={() => onCite(c.chunkIndex)} className="rounded bg-white/70 px-1.5 text-[11px] hover:bg-white">
                      § {c.sectionNumber} · p. {c.pageStart}
                    </button>
                  ) : (
                    <Link key={c.chunkIndex} to={`/contracts/${contractId}?chunk=${c.chunkIndex}`} className="rounded bg-white/70 px-1.5 text-[11px] hover:bg-white">
                      § {c.sectionNumber} · p. {c.pageStart}
                    </Link>
                  )
                )}
              </span>
            </div>
            <p className="mt-1">{f.detail}</p>
            {f.evidence && f.evidence !== f.detail && <p className="mt-1 text-xs italic opacity-80">“{f.evidence}”</p>}
          </div>
        );
      })}
      <p className="text-xs text-slate-400">
        Flags come from simple text rules. They point to terms worth reading; they are not risk scores or legal advice.
      </p>
    </div>
  );
}
