'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

test('X11 overlay roles preserve keyboard input and affect only Capri', { skip: process.platform !== 'linux' }, async () => {
  const result = await new Promise((resolve) => execFile('/usr/bin/python',
    [path.join(__dirname, 'linux_overlay_test.py'), '-v'], (err, stdout, stderr) => resolve({ err, stdout, stderr })));
  assert.ifError(result.err);
  assert.match(result.stderr, /Ran 7 tests/);
  assert.match(result.stderr, /OK/);
});
