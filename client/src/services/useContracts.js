import { useEffect, useState } from 'react';
import { listContracts, errorMessage } from './api.js';

// Contracts that are ready for search / Q&A / comparison (they have embeddings).
// A tiny custom hook so every page doesn't repeat the same fetch code.
// `loading` lets pages tell "still loading" apart from "nothing uploaded yet".
export function useReadyContracts() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listContracts()
      .then((list) => setContracts(list.filter((c) => ['embedded', 'analyzed'].includes(c.status))))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return { contracts, loading, error };
}
