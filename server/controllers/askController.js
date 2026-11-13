import mongoose from 'mongoose';
import { answerQuestion } from '../services/ragService.js';

// POST /api/ask   body: { question, contractIds?, rerank? }   (no contractIds = search all contracts)
// rerank: true/false overrides the RERANK env setting for this request (omit = use the setting)
export async function ask(req, res) {
  const { question, contractIds = [], rerank } = req.body;

  if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'question is required' });
  if (question.length > 1000) return res.status(400).json({ error: 'question is too long (max 1000 characters)' });
  if (!Array.isArray(contractIds) || !contractIds.every((id) => mongoose.isValidObjectId(id))) {
    return res.status(400).json({ error: 'contractIds must be an array of valid ids' });
  }
  if (contractIds.length > 20) return res.status(400).json({ error: 'Select at most 20 contracts' });

  const options = typeof rerank === 'boolean' ? { rerank } : {};
  res.json(await answerQuestion(question.trim(), contractIds, options));
}
