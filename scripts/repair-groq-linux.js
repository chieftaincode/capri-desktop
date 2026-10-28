#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { restart } = require('./restart-linux');
const root = path.resolve(__dirname, '..');
const MODEL = 'openai/gpt-oss-120b';

async function probe(key) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, stream: false, max_completion_tokens: 2048, reasoning_effort: 'low', include_reasoning: false,
      messages: [{ role: 'system', content: 'You are Capri, a playful desktop companion. Answer in two complete sentences, in German.' },
        { role: 'user', content: 'Warum ist der Himmel blau? Bitte erkläre es in zwei vollständigen Sätzen.' }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Groq model test failed (HTTP ${response.status}); settings were not changed`);
  const body = await response.json();
  const answer = body.choices?.[0];
  const text = answer?.message?.content || '';
  if (answer?.finish_reason !== 'stop' || text.trim().length < 60 || /<toolcall>|<function=/.test(text)) {
    throw new Error('Groq model test did not produce a complete answer; settings were not changed');
  }
  return { model: MODEL, status: response.status, finishReason: answer.finish_reason,
    contentCharacters: text.length, completionTokens: body.usage?.completion_tokens ?? null };
}

function applyRepair(dir) {
  const file = path.join(dir, 'config.json'), memoryFile = path.join(dir, 'memory.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile, 'utf8')) : {};
  if (config.provider !== 'groq' || !memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new Error('Unexpected configuration; settings were not changed');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const configBackup = `${file}.groq-backup-${stamp}`;
  const memoryBackup = fs.existsSync(memoryFile) ? `${memoryFile}.groq-archive-${stamp}` : null;
  fs.copyFileSync(file, configBackup);
  if (memoryBackup) fs.copyFileSync(memoryFile, memoryBackup);
  fs.writeFileSync(file, JSON.stringify({ ...config, chatModel: MODEL }, null, 2) + '\n');
  fs.writeFileSync(memoryFile, JSON.stringify({ ...memory, history: [] }, null, 2) + '\n', { mode: 0o600 });
  return { configBackup, memoryBackup };
}

async function main() {
  const env = { ...process.env, ELECTRON_FORCE_IS_PACKAGED: 'false', ELECTRON_IS_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAPRI_DIAGNOSE_GROQ;
  const tested = spawnSync(process.env.CAPRI_ELECTRON || '/usr/bin/electron42',
    [path.join(__dirname, 'diagnose-groq.js'), '--repair', '--ozone-platform=x11'], { cwd: root, env, stdio: 'inherit' });
  if (tested.status !== 0) throw new Error('Groq model verification failed; no changes applied');
  delete process.env.CAPRI_DIAGNOSE_GROQ;
  await restart({ beforeStart: () => {
    const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'capri-desktop');
    const backups = applyRepair(dir);
    console.log(`Previous conversation archived: ${backups.memoryBackup || 'no previous history'}`);
  } });
  console.log(`Capri now uses ${MODEL} on Groq with a fresh conversation. Personal memories and bond are preserved.`);
}

module.exports = { probe, applyRepair, MODEL };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
