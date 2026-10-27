#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
let ok = true;
function check(label, file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 10000 });
  const pass = !result.error && result.status === 0;
  console.log(`${pass ? 'OK' : 'FAIL'} ${label}${pass ? '' : ': ' + (result.stderr?.trim() || result.error?.message || result.status)}`);
  ok &&= pass;
}
check('Python desktop dependencies', '/usr/bin/python', ['-c', 'import dbus, gi, Xlib; from gi.repository import Gio, GLib']);
check('KWin session access', 'qdbus6', ['org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting.isScriptLoaded', 'capri-diagnostic']);
for (const file of ['/usr/bin/electron42', '/usr/bin/gtk-launch', '/usr/bin/wpctl']) {
  const pass = fs.existsSync(file);
  console.log(`${pass ? 'OK' : 'FAIL'} ${file}`);
  ok &&= pass;
}
check('Desktop application catalogue', '/usr/bin/python', ['-c', 'from gi.repository import Gio; assert len(Gio.AppInfo.get_all()) > 0']);
if (!process.env.DISPLAY) { console.log('FAIL XWayland DISPLAY is missing'); ok = false; }
console.log('Session:', process.env.XDG_CURRENT_DESKTOP, process.env.XDG_SESSION_TYPE);
process.exitCode = ok ? 0 : 1;
