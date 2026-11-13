import { useEffect, useState } from 'react';
import VendorComparison from '../components/VendorComparison.jsx';
import VersionComparison from '../components/VersionComparison.jsx';
import ExportButtons from '../components/ExportButtons.jsx';
import NoContracts from '../components/NoContracts.jsx';
import { useToast } from '../components/Toasts.jsx';
import { downloadFile, slug, toCsv, vendorRows, versionRows } from '../services/exportCsv.js';
import { useReadyContracts } from '../services/useContracts.js';
import * as api from '../services/api.js';

// Suggest a sensible starting pair for each mode
function defaultPair(list, mode) {
  const contracts = [...list].sort((x, y) => `${x.vendor} ${x.version}`.localeCompare(`${y.vendor} ${y.version}`));
  if (mode === 'vendor') {
    const a = contracts[0];
    const b = contracts.find((c) => c.vendor !== a?.vendor) || contracts[1];
    return [a?._id || '', b?._id || ''];
  }
  // version: two contracts of the same vendor, older first
  for (const a of contracts) {
    const same = contracts.filter((c) => c.vendor === a.vendor).sort((x, y) => x.version.localeCompare(y.version));
    if (same.length >= 2) return [same[0]._id, same[same.length - 1]._id];
  }
  return [contracts[0]?._id || '', contracts[1]?._id || ''];
}

export default function ComparePage() {
  const { contracts, loading, error: loadError } = useReadyContracts();
  const toast = useToast();
  const [mode, setMode] = useState('vendor');
  const [[idA, idB], setPair] = useState(['', '']);
  const [explain, setExplain] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPair(defaultPair(contracts, mode));
    setResult(null);
  }, [contracts, mode]);

  async function handleCompare() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(mode === 'vendor' ? await api.compareVendors(idA, idB) : await api.compareVersions(idA, idB, explain));
    } catch (err) {
      setError(api.errorMessage(err));
      toast.error(`Comparison failed: ${api.errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // Export what is on screen. PDF code is loaded only on click.
  const exportCsv = () => {
    const isVendor = result.type === 'vendor';
    const [a, b] = isVendor ? [result.contractA, result.contractB] : [result.oldContract, result.newContract];
    const name = isVendor ? slug(a.vendor, a.version, 'vs', b.vendor, b.version) : slug(a.vendor, a.version, 'to', b.version, 'changes');
    downloadFile(`contractiq-${name}.csv`, toCsv(isVendor ? vendorRows(result) : versionRows(result)));
  };
  const exportPdf = async () => {
    const pdf = await import('../services/exportPdf.js');
    return result.type === 'vendor' ? pdf.exportVendorPdf(result) : pdf.exportVersionPdf(result);
  };

  if (!loading && !loadError && contracts.length < 2) {
    return contracts.length ? (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Comparison needs two processed contracts. Upload another one on the Contracts page.
      </div>
    ) : (
      <NoContracts what="Comparison" />
    );
  }

  const modeClass = (m) =>
    `rounded px-3 py-1 text-sm ${mode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;
  const select = (value, onChange) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
      {contracts.map((c) => (
        <option key={c._id} value={c._id}>{c.vendor} {c.version}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Compare contracts</h2>
          <div className="flex gap-1">
            <button className={modeClass('vendor')} onClick={() => setMode('vendor')}>Vendor A vs B</button>
            <button className={modeClass('version')} onClick={() => setMode('version')}>Old vs new version</button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {mode === 'vendor'
            ? 'Matches clauses by meaning (clause type), so different wording still lines up. Runs contract analysis first if needed (~30s).'
            : 'Finds added, removed and changed clauses and values with a text diff. Gemini only explains the changes.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">{mode === 'vendor' ? 'A' : 'Old'}</span>
          {select(idA, (v) => setPair([v, idB]))}
          <span className="text-sm text-slate-500">{mode === 'vendor' ? 'B' : 'New'}</span>
          {select(idB, (v) => setPair([idA, v]))}
          {mode === 'version' && (
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <input type="checkbox" checked={explain} onChange={(e) => setExplain(e.target.checked)} /> Explain with AI
            </label>
          )}
          <button
            onClick={handleCompare}
            disabled={busy || !idA || !idB || idA === idB}
            className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {busy ? (mode === 'vendor' ? 'Comparing… (up to ~30s)' : 'Comparing…') : 'Compare'}
          </button>
        </div>
        {idA && idA === idB && <p className="text-xs text-amber-700">Pick two different contracts.</p>}
        {(error || loadError) && <p className="text-sm text-red-600">{error || loadError}</p>}
      </div>

      {busy && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4" aria-label="Comparison loading">
          <p className="text-sm text-slate-500">
            {mode === 'vendor' ? 'Pairing clause types and comparing their terms…' : 'Diffing the two versions…'}
          </p>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />)}
        </div>
      )}

      {result && (
        <div className="flex justify-end">
          <ExportButtons onCsv={exportCsv} onPdf={exportPdf} />
        </div>
      )}
      {result?.type === 'vendor' && <VendorComparison result={result} />}
      {result?.type === 'version' && <VersionComparison result={result} />}
    </div>
  );
}
