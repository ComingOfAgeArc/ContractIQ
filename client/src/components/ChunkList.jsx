import { useEffect, useState } from 'react';
import ChunkCard from './ChunkCard.jsx';
import { getChunks, errorMessage } from '../services/api.js';

// All chunks of one contract. `highlight` = chunkIndex to scroll to and mark
// (used when clicking a citation in the overview).
export default function ChunkList({ contractId, highlight }) {
  const [chunks, setChunks] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getChunks(contractId).then(setChunks).catch((err) => setError(errorMessage(err)));
  }, [contractId]);

  useEffect(() => {
    if (chunks && highlight != null) {
      document.getElementById(`chunk-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [chunks, highlight]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!chunks) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!chunks.length) return <p className="text-sm text-slate-500">No chunks yet. Process the contract first.</p>;

  return (
    <div className="space-y-2">
      {chunks.map((c) => (
        <div
          key={c._id}
          id={`chunk-${c.chunkIndex}`}
          className={c.chunkIndex === highlight ? 'rounded ring-2 ring-violet-400' : ''}
        >
          <ChunkCard chunk={c} />
        </div>
      ))}
    </div>
  );
}
