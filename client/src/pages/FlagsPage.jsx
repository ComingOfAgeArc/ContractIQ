import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FLAG_TYPES } from '../components/FlagList.jsx';
import ExportButtons from '../components/ExportButtons.jsx';
import { downloadFile, flagsMatrixRows, toCsv } from '../services/exportCsv.js';
import * as api from '../services/api.js';

// Portfolio view: which contracts have which flags, side by side.
export default function FlagsPage() {
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listContracts().then(setContracts).catch((err) => setError(api.errorMessage(err)));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!contracts) return <p className="text-sm text-slate-500">Loading…</p>;

  const byName = (a, b) => `${a.vendor} ${a.version}`.localeCompare(`${b.vendor} ${b.version}`);
  const analysed = contracts.filter((c) => c.status === 'analyzed').sort(byName);
  const notAnalysed = contracts.filter((c) => c.status !== 'analyzed');

  // Every flag code that appears anywhere, with its title and type
  const allFlags = new Map();
  for (const c of analysed) for (const f of c.flags ?? []) allFlags.set(f.code, f);
  const rows = [...allFlags.values()].sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Flags across contracts</h2>
          <p className="text-sm text-slate-500">
            Rule-based and informational: terms worth reading, not risk ratings. Hover a cell for details.
          </p>
        </div>
        {analysed.length > 0 && (
          <ExportButtons onCsv={() => downloadFile('contractiq-flags.csv', toCsv(flagsMatrixRows(contracts)))} />
        )}
      </div>

      {!analysed.length ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No analysed contracts yet. Open a contract and click “Analyse contract”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 uppercase">Flag</th>
                {analysed.map((c) => (
                  <th key={c._id} className="px-3 py-2">
                    <Link to={`/contracts/${c._id}`} className="hover:underline">{c.vendor} {c.version}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((flag) => (
                <tr key={flag.code} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full ${FLAG_TYPES[flag.type].dot}`} />
                    {flag.title}
                  </td>
                  {analysed.map((c) => {
                    const hit = c.flags.find((f) => f.code === flag.code);
                    return (
                      <td key={c._id} className="px-3 py-2 text-xs text-slate-600" title={hit?.detail}>
                        {hit ? (
                          <Link to={`/contracts/${c._id}?chunk=${hit.citations[0]?.chunkIndex ?? ''}`} className="hover:underline">
                            {hit.value ?? '✓'}
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notAnalysed.length > 0 && (
        <p className="text-xs text-slate-500">
          Not analysed yet: {notAnalysed.map((c) => `${c.vendor} ${c.version}`).join(', ')}.
        </p>
      )}
    </div>
  );
}

