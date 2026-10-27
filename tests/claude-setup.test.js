'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { selectClaude } = require('../scripts/connect-claude-linux');
const hooks = require('../scripts/install-hooks');

test('Claude setup preserves chat settings and other hooks, backs up, and is repeatable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-claude-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const settingsFile = path.join(dir, 'settings.json');
    const existing = { permissions: { allow: [] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } };
    fs.writeFileSync(settingsFile, JSON.stringify(existing));
    const file = path.join(dir, 'config.json');
    const original = { assistant: 'codex', claude: true, linked: true, provider: 'groq', apiKeys: { groq: 'test-only' }, scale: 0.6 };
    fs.writeFileSync(file, JSON.stringify(original));
    hooks.install();
    selectClaude(file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, assistant: 'claude', linked: false });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)).hooks.Stop[0], existing.hooks.Stop[0]);
    assert.equal(hooks.status().events.length, hooks.EVENTS.length);
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('backup')).length, 2);
    const before = fs.readdirSync(dir);
    hooks.install();
    selectClaude(file);
    assert.deepEqual(fs.readdirSync(dir), before);
    hooks.uninstall();
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)), existing);
    fs.writeFileSync(file, '{broken');
    assert.throws(() => selectClaude(file));
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
