import { Link } from 'react-router';

const STATUS = {
  same: { label: 'Same', cls: 'bg-green-100 text-green-800' },
  different: { label: 'Different', cls: 'bg-amber-100 text-amber-800' },
  onlyA: { label: 'Only A', cls: 'bg-sky-100 text-sky-800' },
  onlyB: { label: 'Only B', cls: 'bg-sky-100 text-sky-800' },
  neither: { label: 'Neither', cls: 'bg-slate-100 text-slate-500' },
  unknown: { label: '?', cls: 'bg-slate-100 text-slate-500' },
};

// "§ 9 · p. 3" links that open the contract at that chunk
function Cites({ contractId, citations }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {citations.map((c) => (
        <Link
          key={c.chunkIndex}
          to={`/contracts/${contractId}?chunk=${c.chunkIndex}`}
          className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600 hover:bg-violet-100"
        >
          § {c.sectionNumber || c.sectionTitle} · p. {c.pageStart}
        </Link>
      ))}
    </div>
  );
}

export default function VendorComparison({ result }) {
  const { contractA: A, contractB: B, rows, summary } = result;
  const differing = rows.filter((r) => r.status !== 'same' && r.status !== 'neither').length;

  return (
    <div className="space-y-4">
      {summary && <p className="rounded-lg bg-slate-50 p-3 text-sm">{summary}</p>}
      <p className="text-xs text-slate-500">
        {differing} of {rows.length} clause types differ · clauses matched by type, not wording
        {result.model && ` · explained by ${result.model}`}
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-36 px-3 py-2">Clause</th>
              <th className="px-3 py-2">A · {A.vendor} {A.version}</th>
              <th className="px-3 py-2">B · {B.vendor} {B.version}</th>
              <th className="w-56 px-3 py-2">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.label}</div>
                  <span className={`mt-1 inline-block rounded px-1.5 text-xs ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                </td>
                <td className="px-3 py-2">
                  <div className={r.a.found ? '' : 'text-slate-400'}>{r.aValue}</div>
                  <Cites contractId={A._id} citations={r.a.citations} />
                </td>
                <td className="px-3 py-2">
                  <div className={r.b.found ? '' : 'text-slate-400'}>{r.bValue}</div>
                  <Cites contractId={B._id} citations={r.b.citations} />
                </td>
                <td className="px-3 py-2 text-slate-600">{r.difference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        “Not found” means the clause was not found in the contract text. Informational only, not legal advice.
      </p>
    </div>
  );
}
