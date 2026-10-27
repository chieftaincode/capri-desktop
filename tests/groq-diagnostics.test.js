'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compareLiveRequest } = require('../src/main/groq-diagnostic');

test('Live comparison keeps the actual request intact and saves only response counters', async (t) => {
  const request = { model: 'qwen/qwen3.8-27b', messages: [
    { role: 'system', content: 'Private persona' }, { role: 'user', content: 'Private question' },
  ] };
  const original = structuredClone(request);
  const sent = [];
  let report;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Private answer' } }], usage: { completion_tokens: 3 } }));
  });
  t.mock.method(fs, 'writeFileSync', (_file, value) => { report = JSON.parse(value); });
  await compareLiveRequest({ url: 'https://example.invalid', key: 'Private key' }, request,
    { finishReason: 'stop', contentCharacters: 0 });
  assert.deepEqual(request, original);
  assert.deepEqual(sent[0].messages, request.messages);
  assert.deepEqual(sent[1].messages, request.messages);
  assert.equal(sent[1].reasoning_effort, 'none');
  assert.equal(sent[2].messages.length, 2);
  assert.equal(report.results.length, 4);
  assert.equal(report.results[1].contentCharacters, 14);
  assert.ok(!JSON.stringify(report).includes('Private'));
});

test('Electron dynamic import starts diagnostics even when require.main belongs to default_app', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/diagnose-groq.js'), 'utf8');
  const reports = [];
  let ready = 0, exited = 0;
  const fakeRequire = (name) => {
    if (name === 'node:fs') return { mkdirSync() {}, writeFileSync(_file, text) { reports.push(JSON.parse(text)); } };
    if (name === 'electron') return { app: {
      setName() {}, setPath() {}, quit() {}, exit() { exited++; },
      whenReady() { ready++; return Promise.reject(new Error('private test failure')); },
    } };
    return require(name);
  };
  fakeRequire.main = { filename: 'default_app.asar/main.js' };
  vm.runInNewContext(source, { require: fakeRequire, module: { exports: {} },
    process: { versions: { electron: '42.11.18' }, env: {} },
    __dirname: path.join(__dirname, '../scripts'), console: { log() {}, error() {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, 1);
  assert.equal(exited, 1);
  assert.equal(reports[0].stage, 'waiting-for-electron');
  assert.equal(reports.at(-1).error.stage, 'waiting-for-electron');
  assert.ok(!JSON.stringify(reports).includes('private test failure'));
});
