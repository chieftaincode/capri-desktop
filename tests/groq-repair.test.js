'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probe, applyRepair, MODEL } = require('../scripts/repair-groq-linux');

test('Groq repair archives the full conversation and preserves memories, bond, keys, and Claude', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-groq-repair-'));
  try {
    const config = { provider: 'groq', chatModel: 'old', apiKeys: { groq: 'test-only' }, memories: ['Note'], bond: { xp: 70 }, assistant: 'claude' };
    const memory = { history: [{ role: 'assistant', content: 'fragment' }], claude: { session: 'existing' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify(memory));
    const backups = applyRepair(dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(backups.configBackup)), config);
    assert.deepEqual(JSON.parse(fs.readFileSync(backups.memoryBackup)), memory);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'))), { ...config, chatModel: MODEL });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'memory.json'))), { ...memory, history: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Replacement model must produce a substantive complete reply before applying changes', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: 'Eine vollständige erste Erklärung. Hier folgt ein zweiter vollständiger Satz.' } }],
  })));
  const result = await probe('test-only');
  assert.equal(result.model, MODEL);
  assert.ok(result.contentCharacters >= 60);
  assert.ok(!JSON.stringify(result).includes('vollständige'));
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })));
  await assert.rejects(probe('test-only'), /did not produce a complete answer/);
  fetch.mock.mockImplementation(async () => new Response('{}', { status: 429 }));
  await assert.rejects(probe('test-only'), /HTTP 429/);
});
