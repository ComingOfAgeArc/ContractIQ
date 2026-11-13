import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import AnalysisView from '../components/AnalysisView.jsx';
import FlagList from '../components/FlagList.jsx';
import ChunkList from '../components/ChunkList.jsx';
import PageText from '../components/PageText.jsx';
import ExecutiveSummary from '../components/ExecutiveSummary.jsx';
import ExportButtons from '../components/ExportButtons.jsx';
import ProcessingTracker from '../components/ProcessingTracker.jsx';
import { useToast } from '../components/Toasts.jsx';
import { useProcessingStatus } from '../services/useProcessingStatus.js';
import { analysisRows, downloadFile, slug, toCsv } from '../services/exportCsv.js';
import * as api from '../services/api.js';

export default function ContractDetailPage() {
  const { id } = useParams();
  // ?chunk=9 (from comparison citations) opens the Chunks tab at that chunk
  const [searchParams] = useSearchParams();
  const chunkParam = searchParams.get('chunk');
  const [contract, setContract] = useState(null);
  const [tab, setTab] = useState(chunkParam != null ? 'chunks' : 'overview');
  const [highlight, setHighlight] = useState(chunkParam != null ? Number(chunkParam) : null);
  const [analyzing, setAnalyzing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.getContract(id).then(setContract).catch((err) => setError(api.errorMessage(err)));
  }, [id]);

  // While the background pipeline runs, poll its status; reload everything when it ends
  const processing = contract?.processing;
  useProcessingStatus(processing?.active ? [id] : [], async ([fresh]) => {
    if (!fresh) return;
    setContract((c) => ({ ...c, ...fresh }));
    if (!fresh.processing.active) {
      if (fresh.processing.state === 'completed') toast.success('Processing finished. The contract is ready.');
      else toast.error(`Processing failed: ${fresh.processing.error}`);
      setContract(await api.getContract(id));
    }
  });

  async function handleRetry() {
    setRetrying(true);
    try {
      const result = await api.retryContract(id);
      setContract((c) => ({ ...c, ...result }));
    } catch (err) {
      toast.error(api.errorMessage(err));
    } finally {
      setRetrying(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setError('');
    try {
      await api.analyzeContract(id);
      setContract(await api.getContract(id)); // reload: analysis + flags + status
      toast.success('Analysis complete.');
    } catch (err) {
      setError(api.errorMessage(err));
      toast.error(`Analysis failed: ${api.errorMessage(err)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSummarize() {
    setSummarizing(true);
    setError('');
    try {
      const { executiveSummary } = await api.summarizeContract(id);
      setContract((c) => ({ ...c, executiveSummary }));
      toast.success('Executive summary ready.');
    } catch (err) {
      setError(api.errorMessage(err));
      toast.error(`Summary failed: ${api.errorMessage(err)}`);
    } finally {
      setSummarizing(false);
    }
  }

  const exportCsv = () =>
    downloadFile(`contractiq-${slug(contract.vendor, contract.version, 'overview')}.csv`, toCsv(analysisRows(contract)));
  // PDF code is loaded only when someone clicks "PDF"
  const exportPdf = async () => (await import('../services/exportPdf.js')).exportAnalysisPdf(contract);

  // Clicking a citation chip jumps to that chunk
  function showChunk(chunkIndex) {
    setHighlight(chunkIndex);
    setTab('chunks');
  }

  if (error && !contract) {
    return (
      <div className="space-y-3">
        <Link to="/" className="text-sm text-slate-500 hover:underline">← All contracts</Link>
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!contract) {
    return (
      <div className="space-y-3" aria-label="Loading contract">
        <div className="h-6 w-1/3 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }
  const busyProcessing = Boolean(processing?.active);

  const tabClass = (name) =>
    `rounded px-3 py-1 text-sm ${tab === name ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-slate-500 hover:underline">← All contracts</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{contract.title}</h2>
          <p className="text-sm text-slate-500">
            {contract.vendor} · {contract.version} · {contract.pageCount} pages · {contract.chunkCount} chunks ·{' '}
            {busyProcessing ? 'processing…' : processing?.state === 'failed' ? 'processing failed' : contract.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/ask?contract=${contract._id}`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Ask about this contract
          </Link>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || busyProcessing || !['embedded', 'analyzed'].includes(contract.status)}
            title={busyProcessing ? 'Wait for processing to finish' : undefined}
            className="inline-flex items-center gap-2 rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {analyzing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {analyzing ? 'Analysing… (~10–30s)' : contract.analysis ? 'Re-analyse' : 'Analyse contract'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {(busyProcessing || processing?.state === 'failed') && (
        <ProcessingTracker contract={contract} onRetry={handleRetry} retrying={retrying} />
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex gap-2">
          <button className={tabClass('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button className={tabClass('chunks')} onClick={() => setTab('chunks')}>Chunks</button>
          <button className={tabClass('pages')} onClick={() => setTab('pages')}>Pages</button>
        </div>

        {tab === 'overview' &&
          (contract.analysis ? (
            <div className="space-y-6">
              <div className="flex justify-end">
                <ExportButtons onCsv={exportCsv} onPdf={exportPdf} />
              </div>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Executive summary</h3>
                  <button
                    onClick={handleSummarize}
                    disabled={summarizing}
                    className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    {summarizing ? 'Writing… (~5–15s)' : contract.executiveSummary ? 'Regenerate' : 'Generate summary'}
                  </button>
                </div>
                {contract.executiveSummary ? (
                  <ExecutiveSummary summary={contract.executiveSummary} />
                ) : (
                  <p className="text-sm text-slate-500">
                    A short plain-English brief of this contract, written from the analysis below.
                  </p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Flags</h3>
                <FlagList flags={contract.flags} contractId={contract._id} onCite={showChunk} />
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Clauses</h3>
                <AnalysisView analysis={contract.analysis} onCite={showChunk} />
              </section>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {busyProcessing
                ? 'The analysis will appear here when processing finishes.'
                : 'Not analysed yet. Click “Analyse contract” to extract parties, dates and key clauses.'}
            </p>
          ))}
        {tab === 'chunks' && <ChunkList contractId={contract._id} highlight={highlight} />}
        {tab === 'pages' && <PageText pages={contract.pages} />}
      </div>
    </div>
  );
}
