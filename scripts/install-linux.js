#!/usr/bin/env node
'use strict';
// Run in the regular desktop session, where XDG application/config directories are writable.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { desktopEntry } = require('../src/main/linux');
const root = path.resolve(__dirname, '..');
const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const desktop = path.join(data, 'applications/capri-desktop.desktop');
const autostart = path.join(config, 'autostart/capri-desktop.desktop');
if (process.argv.includes('--uninstall')) {
  fs.rmSync(desktop, { force: true });
  fs.rmSync(autostart, { force: true });
  console.log('Capri menu entry and autostart removed. Source and personal data kept.');
} else {
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  const entry = desktopEntry(process.execPath, [path.join(root, 'scripts/start-linux.js')], path.join(root, 'assets/icons/capri.png'));
  fs.writeFileSync(desktop, entry);
  if (process.argv.includes('--autostart')) {
    fs.mkdirSync(path.dirname(autostart), { recursive: true });
    fs.writeFileSync(autostart, entry);
  }
  console.log('Installed:', desktop);
}
