import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import contractRoutes from './routes/contractRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import askRoutes from './routes/askRoutes.js';
import compareRoutes from './routes/compareRoutes.js';
import { aiLimiter, searchLimiter } from './middleware/rateLimit.js';
import { MAX_FILES, MAX_FILE_SIZE_MB } from './middleware/upload.js';
import { describeAiError, isAiError } from './services/geminiService.js';

// Multer error codes → messages a user can act on
const UPLOAD_ERRORS = {
  LIMIT_FILE_SIZE: `Each PDF must be ${MAX_FILE_SIZE_MB} MB or smaller.`,
  LIMIT_FILE_COUNT: `Upload at most ${MAX_FILES} files at a time.`,
  LIMIT_UNEXPECTED_FILE: 'Unexpected form field. Files must be sent in the "files" field.',
};

// app.js builds the Express app; index.js starts it.
// Keeping them separate lets test scripts use the app without opening a port.
const app = express();

// Behind Render/Vercel/any proxy the real client IP is in X-Forwarded-For.
// Needed so rate limiting counts per visitor, not per proxy.
app.set('trust proxy', 1);

// CLIENT_URL may list several origins: "http://localhost:5173,https://contractiq.vercel.app"
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/contracts', contractRoutes);
app.use('/api/search', searchLimiter, searchRoutes);
app.use('/api/ask', aiLimiter, askRoutes);
app.use('/api/compare', aiLimiter, compareRoutes);

// Unknown /api/* → JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` }));

// Production: serve the built React app from the same server (one service, one URL, no CORS).
// Any non-API path returns index.html so React Router can handle /contracts/:id etc.
const clientDist = path.resolve(import.meta.dirname, '../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Express 5 forwards errors thrown in async handlers here automatically,
// so controllers don't need try/catch everywhere.
app.use((err, req, res, next) => {
  // Upload problems (too big, too many files, not a PDF) are the user's to fix → 400
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: UPLOAD_ERRORS[err.code] ?? err.message });
  }
  // Errors created on purpose for the client (bad JSON body, payload too large, our own 400s)
  if (err.status >= 400 && err.status < 500 && (err.expose || err.status === 400)) {
    return res.status(err.status).json({ error: err.message });
  }
  // Gemini problems (bad key, quota, model name) → a readable reason the UI can show,
  // e.g. 429 "rate limit or quota reached" instead of a vague 500
  if (isAiError(err)) {
    console.error('Gemini error:', err.message);
    const { status, message } = describeAiError(err);
    return res.status(status).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

export default app;
