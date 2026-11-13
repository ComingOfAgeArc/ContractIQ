import mongoose from 'mongoose';
import Contract from '../models/Contract.js';
import { compareVendors, compareVersions } from '../services/comparisonService.js';

// Load two contracts by id, or explain what's wrong. Returns [a, b] or null (response already sent).
async function loadPair(res, idA, idB) {
  if (![idA, idB].every((id) => mongoose.isValidObjectId(id))) {
    res.status(400).json({ error: 'Two valid contract ids are required' });
    return null;
  }
  if (String(idA) === String(idB)) {
    res.status(400).json({ error: 'Pick two different contracts' });
    return null;
  }
  const [a, b] = await Promise.all([Contract.findById(idA), Contract.findById(idB)]);
  if (!a || !b) {
    res.status(404).json({ error: 'Contract not found' });
    return null;
  }
  const notReady = [a, b].find((c) => !c.chunkCount);
  if (notReady) {
    res.status(409).json({ error: `"${notReady.title}" has no chunks yet. Process it first.` });
    return null;
  }
  const busy = [a, b].find((c) => ['queued', 'running'].includes(c.processing?.state));
  if (busy) {
    res.status(409).json({ error: `"${busy.title}" is still being processed. Try again when it has finished.` });
    return null;
  }
  return [a, b];
}

// POST /api/compare/vendors   body: { contractIdA, contractIdB }
export async function vendors(req, res) {
  const pair = await loadPair(res, req.body.contractIdA, req.body.contractIdB);
  if (pair) res.json(await compareVendors(...pair));
}

// POST /api/compare/versions  body: { oldId, newId, explain? }
export async function versions(req, res) {
  const pair = await loadPair(res, req.body.oldId, req.body.newId);
  if (pair) res.json(await compareVersions(...pair, { explain: req.body.explain !== false }));
}
