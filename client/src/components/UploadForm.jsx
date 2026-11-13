import { useState } from 'react';
import { Link } from 'react-router';
import { uploadContracts, errorMessage } from '../services/api.js';
import { validateFiles, MAX_FILES, MAX_FILE_SIZE_MB } from '../services/processingView.js';
import { useToast } from './Toasts.jsx';

// "vendor-a-2025.pdf" → { vendor: "Vendor A", version: "2025" }
// Just a starting guess; the user can edit both fields.
function guessMeta(fileName) {
  const base = fileName.replace(/\.pdf$/i, '');
  const year = base.match(/(19|20)\d{2}/)?.[0] || '';
  const vendor = base
    .replace(year, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { vendor: vendor || base, version: year || 'v1' };
}

export default function UploadForm({ onUploaded }) {
  const toast = useToast();
  const [items, setItems] = useState([]); // [{ file, vendor, version }]
  const [rejected, setRejected] = useState([]); // files refused before upload
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  function handleFiles(e) {
    const { accepted, rejected: refused } = validateFiles(Array.from(e.target.files || []));
    setItems(accepted.map((file) => ({ file, ...guessMeta(file.name) })));
    setRejected(refused);
    setResults(null);
    setError('');
  }

  function updateItem(index, field, value) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const data = await uploadContracts(items, setProgress);
      setResults(data.results);
      setItems([]);
      setRejected([]);
      e.target.reset(); // clear the file input
      if (data.created) toast.success(`${data.created} contract(s) uploaded. Processing has started.`);
      if (data.failed) toast.error(`${data.failed} file(s) could not be uploaded. See the details below the form.`);
      onUploaded?.(data.results);
    } catch (err) {
      // A 422 (every file failed) still carries per-file results
      if (err.response?.data?.results) {
        setResults(err.response.data.results);
        toast.error('No files were uploaded. See the details below the form.');
      } else {
        setError(errorMessage(err));
        toast.error(`Upload failed: ${errorMessage(err)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Upload contracts</h2>
      <p className="mb-3 text-xs text-slate-500">
        PDF with selectable text (no scans), up to {MAX_FILE_SIZE_MB} MB each, {MAX_FILES} files at a time.
      </p>

      <input
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={handleFiles}
        className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white"
      />

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="hidden grid-cols-[1fr_10rem_6rem] gap-2 text-xs font-medium text-slate-500 sm:grid">
            <span>File</span><span>Vendor</span><span>Version</span>
          </div>
          {items.map((it, i) => (
            <div key={it.file.name + i} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_10rem_6rem]">
              <span className="col-span-2 truncate text-sm sm:col-span-1" title={it.file.name}>{it.file.name}</span>
              <input
                value={it.vendor}
                onChange={(e) => updateItem(i, 'vendor', e.target.value)}
                aria-label={`Vendor for ${it.file.name}`}
                maxLength={120}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <input
                value={it.version}
                onChange={(e) => updateItem(i, 'version', e.target.value)}
                aria-label={`Version for ${it.file.name}`}
                maxLength={120}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          ))}
          <button
            disabled={busy || items.some((it) => !it.vendor.trim())}
            className="mt-2 inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {!busy && `Upload ${items.length} file(s)`}
            {busy && progress < 100 && `Uploading… ${progress}%`}
            {busy && progress >= 100 && 'Extracting text from PDF…'}
          </button>
        </div>
      )}

      {rejected.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-amber-700">
          {rejected.map((r, i) => (
            <li key={r.name + i}>Skipped {r.name}: {r.reason}</li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {results && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((r, i) => (
            <li key={r.file + i} className={r.ok ? 'text-green-700' : 'text-red-600'}>
              {r.ok && `✓ ${r.file}: ${r.contract.pageCount} pages read. Processing continues below.`}
              {!r.ok && (
                <>
                  ✗ {r.file}: {r.error}
                  {r.duplicateOf && (
                    <>
                      {' '}
                      <Link to={`/contracts/${r.duplicateOf._id}`} className="underline">Open it</Link>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
