import { GoogleGenAI } from '@google/genai';

// Model settings in one place. If you change EMBEDDING_DIMENSIONS you must
// recreate the vector index AND re-embed every contract (vectors of different
// sizes or from different models cannot be compared).
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 768);

// Text generation (answers, clause extraction). Safe to change any time.
export const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-3.5-flash-lite';

let client;

// Created on first use, so the server can start (and you can upload/parse)
// even before GEMINI_API_KEY is set.
export function getGemini() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in server/.env');
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}
