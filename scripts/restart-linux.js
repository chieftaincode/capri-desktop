#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const endpoint = `http://127.0.0.1:${Number(process.env.CAPRI_PORT) || 47823}/health`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function health() {
  try { return await (await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).json(); }
  catch { return null; }
}
async function main() {
  const before = await health();
  if (before) {
    if (before.name !== 'capri' || !Number.isSafeInteger(before.pid)) throw new Error('The bridge port belongs to another application');
    const args = fs.readFileSync(`/proc/${before.pid}/cmdline`, 'utf8').split('\0');
    // Electron can replace its original argv with the process title. In that
    // case, verify both its working directory and the Electron executable.
    const cwd = fs.realpathSync(`/proc/${before.pid}/cwd`);
    const exe = fs.readlinkSync(`/proc/${before.pid}/exe`);
    const sameDirectory = cwd === fs.realpathSync(root);
    const electronProcess = /^(?:electron\d*|capri)$/i.test(path.basename(exe));
    if (!args.includes(root) && !(sameDirectory && electronProcess)) {
      throw new Error(`The running Capri could not be matched to this installation (cwd: ${cwd}, executable: ${exe}); please close it from its tray menu`);
    }
    process.kill(before.pid, 'SIGTERM');
    for (let i = 0; i < 50 && await health(); i++) await wait(100);
    if (await health()) throw new Error('Capri did not stop; please close it from its tray menu');
  }
  fs.mkdirSync(path.join(root, '.runtime'), { recursive: true });
  const log = fs.openSync(path.join(root, '.runtime/capri.log'), 'w');
  const child = spawn(process.execPath, [path.join(root, 'scripts/start-linux.js')], {
    detached: true, stdio: ['ignore', log, log], cwd: root,
  });
  child.on('error', (err) => console.error(err.message));
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 100; i++) {
    await wait(150);
    const state = await health();
    if (state?.desktop?.connected) {
      console.log(JSON.stringify(state, null, 2));
      fs.writeFileSync(path.join(root, '.runtime/desktop-health.json'), JSON.stringify(state, null, 2) + '\n');
      return;
    }
  }
  console.error(fs.readFileSync(path.join(root, '.runtime/capri.log'), 'utf8'));
  throw new Error('Capri started, but its desktop bridge did not connect');
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
