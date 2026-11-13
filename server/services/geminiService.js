import { getGemini, CHAT_MODEL } from '../config/gemini.js';

const MAX_RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a Gemini call; if rate-limited (HTTP 429) or briefly unavailable (503),
// wait 2s, 4s, 8s, 16s and try again. Any other error is thrown immediately.
export async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = [429, 503].includes(err.status) || /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(err.message);
      if (!retryable || attempt >= MAX_RETRIES) throw err;
      const wait = 2 ** attempt * 2000;
      console.warn(`Gemini busy/rate-limited, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

// Is this error from Gemini (or from a missing key)? Works on Error objects and plain messages.
export function isAiError(err) {
  const message = typeof err === 'string' ? err : err?.message ?? '';
  return err?.name === 'ApiError' || /GEMINI_API_KEY|RESOURCE_EXHAUSTED|API key|generativelanguage/i.test(message);
}

// Gemini error → { status, message } a user can act on. The raw message is logged, not shown.
export function describeAiError(err) {
  const message = typeof err === 'string' ? err : err?.message ?? '';
  const code = err?.status;
  if (code === 429 || /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
    return { status: 429, message: 'Gemini rate limit or quota reached. Wait a minute and try again (free-tier keys also have a daily limit).' };
  }
  if (/GEMINI_API_KEY is not set/.test(message)) {
    return { status: 503, message: 'AI is not configured: GEMINI_API_KEY is not set on the server.' };
  }
  if ([401, 403].includes(code) || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|unauthori[sz]ed/i.test(message)) {
    return { status: 502, message: 'Gemini rejected the API key. Check GEMINI_API_KEY on the server.' };
  }
  if (code === 503 || /\b503\b|UNAVAILABLE|overloaded/i.test(message)) {
    return { status: 503, message: 'Gemini is temporarily unavailable. Try again in a minute.' };
  }
  if (code === 404 || /\b404\b|NOT_FOUND|not found for API version|is not found/i.test(message)) {
    return { status: 502, message: 'Gemini model not found. Check CHAT_MODEL / EMBEDDING_MODEL on the server.' };
  }
  return { status: 502, message: `AI service error: ${message.slice(0, 200)}` };
}

// Plain text answer. `system` = rules the model must follow; `prompt` = the task + data.
export async function generateText({ system, prompt }) {
  const res = await withRetry(() =>
    getGemini().models.generateContent({
      model: CHAT_MODEL,
      contents: prompt,
      config: { systemInstruction: system },
    })
  );
  return res.text?.trim() ?? '';
}

// JSON answer that must match `schema` (a JSON Schema object).
// Gemini's structured output guarantees the shape, so JSON.parse is safe.
export async function generateJson({ system, prompt, schema }) {
  const res = await withRetry(() =>
    getGemini().models.generateContent({
      model: CHAT_MODEL,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    })
  );
  return JSON.parse(res.text);
}
