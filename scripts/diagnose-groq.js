#!/usr/bin/env node
'use strict';
// Compare the provider's raw stream with its non-streaming response. Never log
// credentials, prompts, reasoning, or answer text; leave Capri's settings intact.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function summarize(messages) {
  const result = { finishReasons: [], contentCharacters: 0, reasoningCharacters: 0,
    deltaFields: [], messageFields: [], choiceIndexes: [], usage: null };
  for (const message of messages) {
    if (message.usage) result.usage = message.usage;
    if (message.x_groq?.usage) result.usage = message.x_groq.usage;
    for (const choice of message.choices || []) {
      result.choiceIndexes.push(choice.index ?? 0);
      if (choice.finish_reason) result.finishReasons.push(choice.finish_reason);
      result.deltaFields.push(...Object.keys(choice.delta || {}));
      result.messageFields.push(...Object.keys(choice.message || {}));
      const data = choice.delta || choice.message || {};
      if (typeof data.content === 'string') result.contentCharacters += data.content.length;
      for (const key of ['reasoning', 'reasoning_content']) {
        if (typeof data[key] === 'string') result.reasoningCharacters += data[key].length;
      }
    }
  }
  for (const key of ['finishReasons', 'deltaFields', 'messageFields', 'choiceIndexes']) result[key] = [...new Set(result[key])];
  // Restrict usage to numeric counters, even if a provider adds other metadata.
  if (result.usage) result.usage = Object.fromEntries(Object.entries(result.usage).filter(([, value]) => typeof value === 'number'));
  return result;
}

async function main() {
  const { app, safeStorage } = require('electron');
  app.setName('capri-desktop');
  app.setPath('userData', path.join(process.env.XDG_CONFIG_HOME || path.join(require('node:os').homedir(), '.config'), 'capri-desktop'));
  await app.whenReady();
  try {
    const config = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
    const stored = config.apiKeys?.groq || process.env.GROQ_API_KEY || '';
    const key = stored.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) : stored;
    if (!key) throw new Error('Groq key unavailable');
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'memory.json'), 'utf8'));
    const history = (saved.history || []).slice(-18).filter((m) => ['user', 'assistant'].includes(m.role));
    while (history.length && history[0].role !== 'user') history.shift();
    const system = { role: 'system', content: 'You are Capri, a friendly desktop companion. Answer in two complete sentences in German.' };
    const question = { role: 'user', content: 'Warum erscheint der Himmel blau? Erkläre es bitte in zwei vollständigen Sätzen.' };
    const report = { model: config.chatModel, results: [] };
    const variants = [
      ['fresh-stream', [], true, {}], ['fresh-json', [], false, {}],
      ['history-stream', history, true, {}],
      ['explicit-instruct-json', [], false, config.chatModel === 'qwen/qwen3.8-27b'
        ? { reasoning_effort: 'none', reasoning_format: 'hidden', temperature: 0.7, top_p: 0.8 } : {}],
    ];
    for (const [name, prior, stream, extra] of variants) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: config.chatModel, messages: [system, ...prior, question],
          stream, max_completion_tokens: 1024, ...extra }), signal: AbortSignal.timeout(45000),
      });
      const entry = { name, status: response.status, remainingTokens: response.headers.get('x-ratelimit-remaining-tokens'),
        retryAfter: response.headers.get('retry-after') };
      if (response.ok) {
        const raw = await response.text();
        const frames = stream ? raw.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim()).filter((line) => line && line !== '[DONE]').map((line) => JSON.parse(line)) : [JSON.parse(raw)];
        Object.assign(entry, summarize(frames));
      }
      report.results.push(entry);
      console.log(JSON.stringify(entry));
      if (!response.ok) break;
    }
    const dir = path.join(root, '.runtime');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'groq-diagnostics.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log('Diagnostic report saved to .runtime/groq-diagnostics.json');
  } finally { app.quit(); }
}

module.exports = { summarize };
if (require.main === module) {
  if (process.versions.electron) {
    main().catch(() => { console.error('Groq diagnostics failed; no credentials or response text were logged.'); require('electron').app.exit(1); });
  } else {
    const { spawnSync } = require('node:child_process');
    const env = { ...process.env, ELECTRON_FORCE_IS_PACKAGED: 'false', ELECTRON_IS_DEV: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.env.CAPRI_ELECTRON || '/usr/bin/electron42', [__filename, '--ozone-platform=x11'], { cwd: root, env, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  }
}
