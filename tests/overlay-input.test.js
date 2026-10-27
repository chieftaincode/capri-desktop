'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inputWindowOptions, focusInput } = require('../src/main/overlay-input');

function nativeWindow(platform) {
  const state = { ...inputWindowOptions(platform), focused: false, webFocused: false, text: '' };
  return { state, isDestroyed: () => false,
    setFocusable(on) {
      if (platform === 'linux') throw new Error('setFocusable is unsupported on Linux');
      state.focusable = on;
    },
    focus() { state.focused = state.focusable; },
    blur() { state.focused = false; state.webFocused = false; },
    webContents: { focus() { state.webFocused = state.focused; } },
    type(text) { if (state.focused && state.webFocused) state.text += text; },
  };
}

test('Linux chat and secret-input sessions can focus, type, blur, and reacquire focus', () => {
  const win = nativeWindow('linux');
  assert.equal(win.state.focused, false, 'creation must not activate the overlay');
  assert.equal(focusInput(win, true, 'linux'), true);
  win.type('harmless sample');
  assert.equal(win.state.text, 'harmless sample');
  focusInput(win, false, 'linux');
  win.type('ignored');
  assert.equal(win.state.text, 'harmless sample');
  focusInput(win, true, 'linux');
  win.type(' pasted text');
  assert.equal(win.state.text, 'harmless sample pasted text');
});

test('Windows retains its dynamic focusability when opening and closing input', () => {
  const win = nativeWindow('win32');
  assert.equal(win.state.focusable, false);
  focusInput(win, true, 'win32');
  win.type('sample');
  assert.equal(win.state.text, 'sample');
  focusInput(win, false, 'win32');
  assert.equal(win.state.focusable, false);
});

test('Input focus requests are harmless when the overlay has closed', () => {
  assert.equal(focusInput(null, true, 'linux'), false);
  assert.equal(focusInput({ isDestroyed: () => true }, true, 'linux'), false);
});
