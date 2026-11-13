import axios from 'axios';

// Every backend call goes through this one file, so components never
// hard-code URLs and switching to a deployed API is one env variable.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

// Turn any axios error into a readable message for the UI
export function errorMessage(err) {
  return err.response?.data?.error || err.message || 'Request failed';
}

// items: [{ file: File, vendor: string, version: string }]
export async function uploadContracts(items, onProgress) {
  const form = new FormData();
  items.forEach((item) => form.append('files', item.file));
  form.append('metadata', JSON.stringify(items.map(({ vendor, version }) => ({ vendor, version }))));

  const { data } = await api.post('/contracts/upload', form, {
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return data;
}

export async function listContracts() {
  const { data } = await api.get('/contracts');
  return data;
}

export async function getContract(id) {
  const { data } = await api.get(`/contracts/${id}`);
  return data;
}

export async function getChunks(id) {
  const { data } = await api.get(`/contracts/${id}/chunks`);
  return data;
}

// Processing status of several contracts in one request: { contracts: [...], missing: [ids] }
export async function getStatuses(ids) {
  const { data } = await api.get('/contracts/status', { params: { ids: ids.join(',') } });
  return data;
}

// Continue a failed run from the safest stage (runs in the background; poll getStatuses)
export async function retryContract(id) {
  const { data } = await api.post(`/contracts/${id}/retry`);
  return data;
}

// Re-chunk, re-embed and re-analyse from scratch (runs in the background; poll getStatuses)
export async function processContract(id) {
  const { data } = await api.post(`/contracts/${id}/process`);
  return data;
}

// Search over chunks
// mode: 'hybrid' (meaning + keywords, default) | 'vector' | 'keyword'
export async function searchChunks(query, { contractIds, vendor, limit, mode = 'hybrid' } = {}) {
  const { data } = await api.post('/search', { query, contractIds, vendor, limit, mode });
  return data.results;
}

// Extract parties, dates and key clauses (Gemini). Takes a few seconds.
export async function analyzeContract(id) {
  const { data } = await api.post(`/contracts/${id}/analyze`);
  return data;
}

// RAG Q&A. contractIds empty = all contracts.
// rerank: true/false overrides the server's RERANK setting; undefined = use the setting
export async function ask(question, contractIds = [], rerank) {
  const { data } = await api.post('/ask', { question, contractIds, ...(typeof rerank === 'boolean' && { rerank }) });
  return data;
}

// Plain-English executive summary (needs the contract analysed first). Takes a few seconds.
export async function summarizeContract(id) {
  const { data } = await api.post(`/contracts/${id}/summary`);
  return data;
}

// Multi-contract search: best `perContract` clauses from EACH contract
export async function searchAcross(query, contractIds = [], perContract = 2, mode = 'hybrid') {
  const { data } = await api.post('/search', { query, contractIds, limit: perContract, groupByContract: true, mode });
  return data.groups;
}

export async function compareVendors(contractIdA, contractIdB) {
  const { data } = await api.post('/compare/vendors', { contractIdA, contractIdB });
  return data;
}

export async function compareVersions(oldId, newId, explain = true) {
  const { data } = await api.post('/compare/versions', { oldId, newId, explain });
  return data;
}

export async function deleteContract(id) {
  const { data } = await api.delete(`/contracts/${id}`);
  return data;
}
