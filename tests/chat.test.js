'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Load the browser modules as ESM without changing the main process's CommonJS package.
async function loadChat() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-chat-test-'));
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const file of ['chat.js', 'chat-context.js', 'util.js', 'lines.js', 'reminders.js']) {
      fs.copyFileSync(path.join(__dirname, '../src/renderer/js', file), path.join(dir, file));
    }
    return await import(pathToFileURL(path.join(dir, 'chat.js')).href);
  } finally {
    if (previous === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const chatModule = loadChat();

test('Chat context skips orphan answers and legacy empty placeholders without changing saved history', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/chat-context.js'), 'utf8');
  const { chatContext } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const history = [
    { role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'Next question' }, { role: 'assistant', content: '…' },
    { role: 'user', content: 'Current question' },
  ];
  const saved = structuredClone(history);
  assert.deepEqual(chatContext(history, 4), [history[2], history[4]]);
  assert.deepEqual(history, saved);
});

test('Empty model replies are never remembered or treated as successful actions', async () => {
  const { Chat } = await chatModule;
  let displayed = '', actions = 0;
  const panel = { setChatBusy(on) { this.busy = on; }, setActions() {}, chatTurn() {}, stream(text) { displayed = text; } };
  const host = { onChatDelta() {}, chatSend: async () => ({ ok: true, text: '<think>reasoning only</think>' }) };
  const chat = new Chat({ panel, host, capri: { pulse() {} }, brain: { t: { chat: { failed: 'Lost the signal:' } } } });
  chat.open = true;
  chat.persona = () => 'You are Capri.';
  chat.asked = () => null;
  chat.after = () => { actions++; };
  await chat.send('Hello');
  assert.match(displayed, /Empty answer/);
  assert.equal(panel.busy, false);
  assert.equal(actions, 0);
  assert.equal(chat.history.length, 0);
});

test('Interrupted answers remain visible with an error, unlock input, and trigger no actions', async () => {
  const { Chat } = await chatModule;
  let displayed = '', actions = 0;
  const panel = {
    chatInput: { disabled: false },
    setChatBusy(on) { this.chatInput.disabled = on; },
    setActions() {}, chatTurn() {}, setFace() {},
    stream(text) { displayed = text; },
  };
  const host = { onChatDelta() {}, chatSend: async () => ({ ok: false, partialText: 'An unfinished reply', error: 'Connection lost' }) };
  const chat = new Chat({ panel, host, capri: { pulse() {} }, brain: { t: { chat: { failed: 'Lost the signal:' } } } });
  chat.open = true;
  chat.persona = () => 'You are Capri.';
  chat.asked = () => null;
  chat.after = () => { actions++; };
  await chat.send('Hello');
  assert.match(displayed, /^An unfinished reply\n\n\[Lost the signal: Connection lost\]$/);
  assert.equal(panel.chatInput.disabled, false);
  assert.equal(actions, 0);
  assert.equal(chat.history.length, 0, 'an incomplete answer must not be remembered as successful');
});

for (const mode of ['cloud with mood', 'cloud without mood', 'agent']) {
  test(`Chat keeps complete turns and unlocks input after more than ten exchanges: ${mode}`, async () => {
    const { Chat } = await chatModule;
    const busy = [], faces = [], requests = [], answers = [];
    let reply, requested;
    const panel = {
      chatInput: { disabled: false },
      setChatBusy(on) { this.chatInput.disabled = on; busy.push(on); },
      setActions() {}, chatTurn() {},
      setFace(face) { faces.push(face); },
      stream(text, options) { if (options?.done) answers.push(text); },
    };
    const host = {
      onChatDelta() {}, chatRemember() {}, openApps: async () => [],
      chatSend(request) {
        requests.push(request);
        return new Promise((resolve) => { reply = resolve; requested(); });
      },
    };
    const chat = new Chat({ panel, host, capri: { pulse() {} }, brain: { t: { chat: {} } } });
    chat.open = true;
    chat.agent = mode === 'agent';
    chat.bond = { heard() {}, moodLine: () => mode === 'cloud with mood' ? 'Right now: happy' : null };
    chat.persona = () => 'You are Capri.';
    chat.asked = () => null;
    chat.after = () => {};
    chat.history = Array.from({ length: 12 }, (_, n) => [
      { role: 'user', content: `Question ${n}` }, { role: 'assistant', content: `Answer ${n}.` },
    ]).flat();

    for (const [index, text] of ['Hello Capri', 'How are you'].entries()) {
      const started = new Promise((resolve) => { requested = resolve; });
      const sending = chat.send(text);
      await started;
      assert.equal(panel.chatInput.disabled, true, 'sending temporarily locks the field');
      assert.equal(requests.length, index + 1);
      assert.equal(requests[index].messages[1].role, 'user', 'rolling context must start with a question');
      assert.equal(requests[index].messages.at(-1).role, 'user');
      assert.ok(requests[index].messages.length <= 21);
      reply({ ok: true, text: index ? 'Doing well!' : 'Hello!' });
      await sending;
      assert.equal(panel.chatInput.disabled, false, 'a finished answer must unlock the field');
      assert.equal(chat.turn, 0);
    }
    assert.deepEqual(busy, [true, false, true, false]);
    assert.deepEqual(faces, ['grin', 'grin']);
    assert.deepEqual(answers, ['Hello!', 'Doing well!']);
    assert.equal(chat.history.length, 28);
    assert.equal(requests[0].messages.at(-1).content.includes('happy'), mode === 'cloud with mood');
  });
}
