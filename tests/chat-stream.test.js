'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readChatStream } = require('../src/main/chat-stream');
const { chat } = require('../src/main/llm');
const event = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}`;
const reply = (text, reason) => new Response(event(text, reason) + '\r\n\r\ndata: [DONE]\r\n\r\n');
const cfg = { apiKeys: { groq: 'test-only' } };
const input = { model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] };

test('The last data line and split UTF-8 characters reach the chat intact', async () => {
  const bytes = Buffer.from(event('Grüße ') + '\r\n\r\n' + event('zum Schluss.', 'stop'));
  async function* chunks() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const deltas = [];
  const result = await readChatStream(chunks(), (s) => deltas.push(s));
  assert.equal(result.text, 'Grüße zum Schluss.');
  assert.equal(deltas.join(''), result.text);
  assert.equal(result.finishReason, 'stop');
});

test('A disconnected stream is reported as incomplete with its partial answer', async () => {
  const body = new Response(event('Half a sentence') + '\n\n').body;
  await assert.rejects(readChatStream(body, () => {}), (err) => {
    assert.equal(err.partialText, 'Half a sentence');
    assert.match(err.message, /before the answer was complete/);
    return true;
  });
});

test('Groq length limits continue the answer without duplicating streamed text', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? reply('We can', 'length') : reply(' finish this.', 'stop');
  });
  const deltas = [];
  assert.equal(await chat('groq', cfg, input, (s) => deltas.push(s)), 'We can finish this.');
  assert.equal(deltas.join(''), 'We can finish this.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].max_completion_tokens, 4096);
  assert.deepEqual(requests[1].messages.at(-2), { role: 'assistant', content: 'We can' });
  assert.equal(input.messages.length, 1, 'continuation must not mutate chat history');
});

test('Normal completion is accepted even without punctuation, with no extra request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply('OK', 'stop'));
  assert.equal(await chat('groq', cfg, input, () => {}), 'OK');
  assert.equal(fetch.mock.callCount(), 1);
});

test('Groq GPT-OSS chat uses the settings verified by the repair probe', async (t) => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return reply('A complete reply.', 'stop');
  });
  await chat('groq', cfg, { ...input, model: 'openai/gpt-oss-120b' }, () => {});
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.include_reasoning, false);
});

test('Empty provider completions fail visibly instead of becoming ellipses in memory', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply('', 'stop'));
  await assert.rejects(chat('groq', cfg, input, () => {}), /Empty answer/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('Free-plan rate limits have a separate code from transient server overload', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: { message: 'Rate limit reached. Try again in 30 seconds.' } }),
    { status: 429, headers: { 'retry-after': '30' } }));
  await assert.rejects(chat('groq', cfg, input, () => {}), (err) => {
    assert.equal(err.code, 'rate_limit');
    assert.equal(err.status, 429);
    assert.match(err.message, /30 seconds/);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('Repeated length limits are bounded and retain the full partial reply', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply('part ', 'length'));
  await assert.rejects(chat('groq', cfg, input, () => {}), (err) => {
    assert.equal(err.partialText, 'part part part ');
    assert.match(err.message, /provider limit/);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test('Closing chat cancels any pending continuation', async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply('partial', 'length'));
  await assert.rejects(chat('groq', cfg, input, () => controller.abort(), controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('Provider filtering and failed continuations never masquerade as complete replies', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (requests === 1) return reply('unfinished', 'length');
    throw new Error('Connection lost');
  });
  await assert.rejects(chat('groq', cfg, input, () => {}), (err) => err.partialText === 'unfinished');
  assert.equal(requests, 2);
  t.mock.restoreAll();
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply('filtered', 'content_filter'));
  await assert.rejects(chat('groq', cfg, input, () => {}), /content_filter/);
  assert.equal(fetch.mock.callCount(), 1);
});
