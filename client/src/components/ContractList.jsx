import { FLAG_TYPES } from './FlagList.jsx';
import { statusLabel } from '../services/processingView.js';

const statusColors = {
  parsed: 'bg-blue-100 text-blue-800',
  chunked: 'bg-amber-100 text-amber-800',
  embedded: 'bg-green-100 text-green-800',
  analyzed: 'bg-violet-100 text-violet-800',
  failed: 'bg-red-100 text-red-800',
  processing: 'bg-violet-100 text-violet-800',
};

// Colour for the status pill: live processing state first, then the data status
function pillClass(c) {
  if (c.processing?.active) return statusColors.processing;
  if (c.processing?.state === 'failed') return statusColors.failed;
  return statusColors[c.status] || 'bg-slate-100';
}

export default function ContractList({ contracts, retryingId, onSelect, onRetry, onDelete }) {
  if (!contracts.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="font-medium text-slate-700">No contracts yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Upload one or more contract PDFs above. Each one is split into clauses, indexed for search and analysed,
          and you can watch every step. Try the example contracts in the repo’s <code>samples/</code> folder.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Vendor</th>
            <th className="px-3 py-2">Version</th>
            <th className="px-3 py-2">Pages</th>
            <th className="px-3 py-2">Chunks</th>
            <th className="px-3 py-2">Flags</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr
              key={c._id}
              onClick={() => onSelect(c._id)}
              className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
            >
              <td className="px-3 py-2 font-medium">{c.title}</td>
              <td className="px-3 py-2">{c.vendor}</td>
              <td className="px-3 py-2">{c.version}</td>
              <td className="px-3 py-2">{c.pageCount}</td>
              <td className="px-3 py-2">{c.chunkCount || '—'}</td>
              <td className="px-3 py-2" title={c.flags?.map((f) => f.title).join('\n')}>
                {c.status === 'analyzed' ? (
                  <span className="flex gap-0.5">
                    {c.flags.map((f) => (
                      <span key={f.code} className={`h-2 w-2 rounded-full ${FLAG_TYPES[f.type]?.dot ?? 'bg-slate-400'}`} />
                    ))}
                    {!c.flags.length && <span className="text-xs text-slate-400">none</span>}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <span
                  title={c.processing?.error || c.error || ''}
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs ${pillClass(c)}`}
                >
                  {c.processing?.active && <span className="h-2.5 w-2.5 animate-spin rounded-full border border-violet-300 border-t-violet-700" />}
                  {statusLabel(c)}
                </span>
              </td>
              <td className="space-x-3 whitespace-nowrap px-3 py-2 text-right">
                {c.processing?.state === 'failed' && c.processing.retryable && (
                  <button
                    disabled={retryingId === c._id}
                    onClick={(e) => {
                      e.stopPropagation(); // don't also select the row
                      onRetry(c);
                    }}
                    className="text-xs text-slate-700 hover:underline disabled:opacity-50"
                  >
                    {retryingId === c._id ? 'Retrying…' : 'Retry'}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c);
                  }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
