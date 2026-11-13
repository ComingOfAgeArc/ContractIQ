import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAiError, isAiError } from '../services/geminiService.js';

const apiError = (message, status) => Object.assign(new Error(message), { name: 'ApiError', status });

test('Gemini errors → status + message a user can act on', () => {
  assert.equal(describeAiError(apiError('RESOURCE_EXHAUSTED: quota exceeded', 429)).status, 429);
  assert.equal(describeAiError(new Error('GEMINI_API_KEY is not set in server/.env')).status, 503);
  assert.match(describeAiError(apiError('API key not valid. Please pass a valid API key.', 400)).message, /rejected the API key/);
  assert.equal(describeAiError(apiError('The model is overloaded', 503)).status, 503);
  assert.match(describeAiError(apiError('models/gemini-x is not found for API version v1beta', 404)).message, /model not found/);
  assert.match(describeAiError(apiError('something odd', 500)).message, /^AI service error: something odd/);
});

test('only Gemini-looking errors are treated as AI errors', () => {
  assert.equal(isAiError(apiError('x', 500)), true);
  assert.equal(isAiError(new Error('GEMINI_API_KEY is not set')), true);
  assert.equal(isAiError(new Error('Cast to ObjectId failed')), false);
});
