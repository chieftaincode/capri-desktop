'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Opt-in comparison of the exact live request. Only counters are saved, never
// prompts, answer text, API keys, or reasoning text.
async function compareLiveRequest(provider, request, initial, signal) {
  const report = { model: request.model, promptCharacters: request.messages.reduce((n, m) => n + m.content.length, 0),
    roles: request.messages.map((m) => m.role), results: [{ name: 'actual-stream', ...initial }] };
  const variants = [
    ['identical-json', request.messages, {}],
    ...(request.model === 'qwen/qwen3.8-27b' ? [['explicit-instruct-json', request.messages,
      { reasoning_effort: 'none', reasoning_format: 'hidden', temperature: 0.7, top_p: 0.8 }]] : []),
    ['neutral-last-question-json', [{ role: 'system', content: 'Answer the user helpfully in complete sentences, in the same language as their question.' },
      request.messages.findLast((m) => m.role === 'user')], {}],
  ];
  for (const [name, messages, extra] of variants) {
    try {
      signal?.throwIfAborted();
      const res = await fetch(`${provider.url}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` },
        body: JSON.stringify({ model: request.model, messages, max_completion_tokens: 4096, stream: false, ...extra }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      });
      const entry = { name, status: res.status, remainingTokens: res.headers.get('x-ratelimit-remaining-tokens') };
      if (res.ok) {
        const body = await res.json();
        const choice = body.choices?.[0];
        entry.finishReason = choice?.finish_reason;
        entry.contentCharacters = choice?.message?.content?.length || 0;
        entry.reasoningCharacters = (choice?.message?.reasoning || choice?.message?.reasoning_content || '').length;
        entry.messageFields = Object.keys(choice?.message || {});
        entry.completionTokens = body.usage?.completion_tokens ?? null;
      }
      report.results.push(entry);
      if (!res.ok) break;
    } catch (err) {
      report.results.push({ name, errorType: err.name });
      break;
    }
  }
  const dir = path.resolve(__dirname, '../../.runtime');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'groq-live-diagnostics.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('[capri] Live Groq comparison saved to .runtime/groq-live-diagnostics.json');
}

module.exports = { compareLiveRequest };
