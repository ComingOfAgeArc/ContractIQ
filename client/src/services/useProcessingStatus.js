import { useEffect, useRef, useState } from 'react';
import { getStatuses } from './api.js';
import { nextPollDelay } from './processingView.js';

// Polls GET /api/contracts/status?ids=… while any of `ids` is still processing.
//
// - one request for all contracts (not one per contract)
// - the next poll is scheduled only after the previous one answered, so slow
//   responses never pile up
// - stops when everything is completed/failed, when `ids` becomes empty, or
//   when the component unmounts
// - backs off after errors (server asleep, network blip) and pauses while the
//   browser tab is hidden
//
// onUpdate(list) receives the fresh status of every polled contract.
export function useProcessingStatus(ids, onUpdate) {
  const [error, setError] = useState('');
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const key = [...ids].sort().join(','); // restart only when the SET of ids changes

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    let timer;
    let errors = 0;
    const idList = key.split(',');

    async function poll() {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(poll, nextPollDelay(0));
        return;
      }
      try {
        const { contracts, missing } = await getStatuses(idList);
        if (cancelled) return;
        errors = 0;
        setError('');
        onUpdateRef.current?.(contracts, missing);
        // Keep going only while something is still queued/running
        if (contracts.some((c) => c.processing.active)) timer = setTimeout(poll, nextPollDelay(0));
      } catch (err) {
        if (cancelled) return;
        errors++;
        setError('Lost connection to the server. Retrying…');
        timer = setTimeout(poll, nextPollDelay(errors));
      }
    }

    timer = setTimeout(poll, nextPollDelay(0));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return { error };
}
