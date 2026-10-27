#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let executable = process.env.CAPRI_ELECTRON;
if (!executable) {
  for (const candidate of ['/usr/bin/electron42', '/usr/bin/electron44', '/usr/bin/electron']) {
    if (fs.existsSync(candidate)) { executable = candidate; break; }
  }
}
if (!executable) {
  try { executable = require('electron'); } catch { /* report below */ }
}
if (!executable) {
  console.error('Electron is missing. On Arch install electron42, or run npm install with Electron downloads enabled.');
  process.exit(1);
}
const env = { ...process.env, ELECTRON_FORCE_IS_PACKAGED: 'false', ELECTRON_IS_DEV: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root, '--ozone-platform=x11', ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
