import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import UploadForm from '../components/UploadForm.jsx';
import ContractList from '../components/ContractList.jsx';
import ProcessingTracker from '../components/ProcessingTracker.jsx';
import { useToast } from '../components/Toasts.jsx';
import { useProcessingStatus } from '../services/useProcessingStatus.js';
import { activeIds, transitions } from '../services/processingView.js';
import * as api from '../services/api.js';

export default function ContractsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [contracts, setContracts] = useState(null); // null = still loading
  const [watched, setWatched] = useState(() => new Set()); // shown in "Processing" until dismissed
  const [retryingId, setRetryingId] = useState(null);
  const [error, setError] = useState('');
  const contractsRef = useRef([]);
  contractsRef.current = contracts ?? [];

  async function refresh() {
    try {
      setContracts(await api.listContracts());
      setError('');
    } catch (err) {
      setError(api.errorMessage(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Contracts that are processing right now: the status is persisted on the
  // server, so after a page refresh these are picked up again automatically.
  const pollIds = activeIds(contracts ?? []);
  const { error: pollError } = useProcessingStatus(pollIds, (fresh, missing) => {
    const before = Object.fromEntries(contractsRef.current.map((c) => [String(c._id), c.processing]));
    const { completed, failed } = transitions(before, fresh);
    const byId = new Map(fresh.map((c) => [String(c._id), c]));
    setContracts((list) =>
      (list ?? [])
        .filter((c) => !missing.includes(String(c._id))) // deleted elsewhere
        .map((c) => (byId.has(String(c._id)) ? { ...c, ...byId.get(String(c._id)) } : c))
    );
    // Keep finished cards on screen (showing "Processing completed") until dismissed,
    // also for contracts that were already processing when the page was opened
    watch(completed.map((c) => c._id));
    completed.forEach((c) => toast.success(`"${c.title}" is ready.`));
    failed.forEach((c) => toast.error(`"${c.title}" failed: ${c.processing.error}`));
    if (completed.length || failed.length) refresh(); // pick up chunk counts, flags…
  });

  function watch(ids) {
    setWatched((prev) => new Set([...prev, ...ids.map(String)]));
  }

  function handleUploaded(results) {
    const created = results.filter((r) => r.ok).map((r) => r.contract);
    watch(created.map((c) => c._id));
    // Show the new contracts immediately, then load the full list
    setContracts((list) => [...created, ...(list ?? []).filter((c) => !created.some((n) => n._id === c._id))]);
    refresh();
  }

  async function handleRetry(contract) {
    setRetryingId(contract._id);
    try {
      const result = await api.retryContract(contract._id);
      watch([contract._id]);
      setContracts((list) => list.map((c) => (c._id === contract._id ? { ...c, ...result } : c)));
      toast.info(`Retrying "${contract.title}"…`);
    } catch (err) {
      toast.error(api.errorMessage(err));
      refresh();
    } finally {
      setRetryingId(null);
    }
  }

  async function handleDelete(contract) {
    if (!confirm(`Delete "${contract.title}"?`)) return;
    try {
      await api.deleteContract(contract._id);
      toast.success(`Deleted "${contract.title}".`);
      refresh();
    } catch (err) {
      toast.error(api.errorMessage(err));
    }
  }

  const dismiss = (id) =>
    setWatched((prev) => {
      const next = new Set(prev);
      next.delete(String(id));
      return next;
    });

  // Processing panel: running or failed contracts, plus ones that finished in this session
  const tracked = (contracts ?? []).filter(
    (c) => c.processing?.active || c.processing?.state === 'failed' || watched.has(String(c._id))
  );

  return (
    <div className="space-y-6">
      <UploadForm onUploaded={handleUploaded} />

      {tracked.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Processing</h2>
          {pollError && <p className="text-xs text-amber-700">{pollError}</p>}
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {tracked.map((c) => (
              <ProcessingTracker
                key={c._id}
                contract={c}
                onRetry={handleRetry}
                retrying={retryingId === c._id}
                onDismiss={watched.has(String(c._id)) ? dismiss : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load contracts: {error}{' '}
          <button onClick={refresh} className="underline">Try again</button>
        </p>
      )}
      {contracts === null && !error ? (
        <div className="space-y-2" aria-label="Loading contracts">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}
        </div>
      ) : (
        contracts && (
          <ContractList
            contracts={contracts}
            retryingId={retryingId}
            onSelect={(id) => navigate(`/contracts/${id}`)}
            onRetry={handleRetry}
            onDelete={handleDelete}
          />
        )
      )}
    </div>
  );
}
