// Frontend logic behind the processing tracker and upload form.
// Runs with Node's built-in test runner: npm test (no extra packages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeIds, nextPollDelay, statusLabel, transitions, validateFiles, POLL_INTERVAL_MS } from '../src/services/processingView.js';

const view = (state, extra = {}) => ({ state, active: state === 'queued' || state === 'running', percent: 40, ...extra });

test('polling: only queued/running contracts are polled', () => {
  const list = [
    { _id: 'a', processing: view('running') },
    { _id: 'b', processing: view('failed', { error: 'boom' }) },
    { _id: 'c', processing: view('completed') },
    { _id: 'd', processing: view('queued') },
    { _id: 'e' }, // older API response without processing
  ];
  assert.deepEqual(activeIds(list), ['a', 'd']);
});

test('polling: 1.5 s normally, backs off after errors, capped at 10 s', () => {
  assert.equal(nextPollDelay(0), POLL_INTERVAL_MS);
  assert.equal(nextPollDelay(1), 3000);
  assert.equal(nextPollDelay(2), 6000);
  assert.equal(nextPollDelay(10), 10000);
});

test('notifications: report a contract once when it goes from running to failed or completed', () => {
  const before = { a: view('running'), b: view('running'), c: view('failed') };
  const after = [
    { _id: 'a', title: 'A', processing: view('completed') },
    { _id: 'b', title: 'B', processing: view('failed', { error: 'Gemini rate limit' }) },
    { _id: 'c', title: 'C', processing: view('failed') }, // was already failed: no second toast
  ];
  const { completed, failed } = transitions(before, after);
  assert.deepEqual(completed.map((c) => c.title), ['A']);
  assert.deepEqual(failed.map((c) => c.title), ['B']);
});

test('status labels: processing errors are visible in the list', () => {
  assert.equal(statusLabel({ status: 'parsed', processing: view('running', { percent: 38 }) }), 'Processing 38%');
  assert.equal(statusLabel({ status: 'parsed', processing: view('queued') }), 'Queued');
  assert.equal(statusLabel({ status: 'chunked', processing: view('failed') }), 'Failed');
  assert.equal(statusLabel({ status: 'analyzed', processing: view('completed') }), 'analyzed');
});

test('upload validation: wrong type, empty, too big, duplicates and too many files are refused up front', () => {
  const file = (name, size, type = 'application/pdf') => ({ name, size, type });
  const files = [
    file('a.pdf', 1000),
    file('notes.docx', 1000, 'application/msword'),
    file('empty.pdf', 0),
    file('huge.pdf', 21 * 1024 * 1024),
    file('a.pdf', 1000), // same file twice
    ...Array.from({ length: 10 }, (_, i) => file(`c${i}.pdf`, 500)),
  ];
  const { accepted, rejected } = validateFiles(files);
  assert.equal(accepted.length, 10);
  assert.deepEqual(rejected.map((r) => r.reason), ['not a PDF', 'the file is empty', 'larger than 20 MB', 'selected twice', 'only 10 files per upload']);
});
