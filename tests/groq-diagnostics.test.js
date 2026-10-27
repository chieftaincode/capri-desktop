'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
