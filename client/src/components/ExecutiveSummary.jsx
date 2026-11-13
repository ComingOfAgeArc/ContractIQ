// The plain-English brief: overview, key terms, what is worth reading, what is missing.
// Written by Gemini from the extracted clauses and flags (not from the raw contract).
export default function ExecutiveSummary({ summary }) {
  return (
    <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-4 text-sm">
      <p className="leading-relaxed">{summary.overview}</p>

      {summary.keyTerms?.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {summary.keyTerms.map((kt, i) => (
            <div key={i} className="contents">
              <dt className="text-slate-500">{kt.label}</dt>
              <dd className="font-medium">{kt.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {summary.worthReading?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-400">Worth reading closely</h4>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-700">
            {summary.worthReading.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {summary.notFound?.length > 0 && (
        <p className="text-xs text-slate-500">Not found in the contract: {summary.notFound.join(', ')}</p>
      )}

      <p className="text-xs text-slate-400">
        Written by {summary.model} from the extracted clauses and flags below. Informational only, not legal advice.
      </p>
    </div>
  );
}
