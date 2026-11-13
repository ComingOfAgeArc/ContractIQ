import { useState } from 'react';

// "Export: CSV · PDF" for any result. The page passes two functions; nothing here
// knows about contracts. Failures (e.g. a blocked download) show a short message
// instead of breaking the page.
export default function ExportButtons({ onCsv, onPdf, label = 'Export' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setError('Export failed');
    } finally {
      setBusy(false);
    }
  }

  const btn = 'rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {onCsv && <button className={btn} disabled={busy} onClick={() => run(onCsv)}>CSV</button>}
      {onPdf && <button className={btn} disabled={busy} onClick={() => run(onPdf)}>{busy ? 'Preparing…' : 'PDF'}</button>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
