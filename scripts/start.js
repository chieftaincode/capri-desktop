#!/usr/bin/env node
'use strict';
if (process.platform === 'linux') require('./start-linux');
else {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}
