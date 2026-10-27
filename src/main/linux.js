'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawn, execFile } = require('node:child_process');

const helper = (name) => path.join(__dirname, name).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, out) => err ? reject(err) : resolve(out));
});
let child = null;
let snapshot = null;

function relativeRect(rect, origin, viewport) {
  const sx = viewport.width / origin.width, sy = viewport.height / origin.height;
  return { x: (rect.x - origin.x) * sx, y: (rect.y - origin.y) * sy,
    w: rect.width * sx, h: rect.height * sy };
}

function overlayBounds(overlay) {
  const b = snapshot?.logical && snapshot?.overlay?.geometry;
  return b && b.width > 0 && b.height > 0 ? b : overlay.getBounds();
}

function setInputRegions(data) {
  if (!child?.stdin.writable || child.stdin.writableLength > 128 * 1024) return;
  if (!Array.isArray(data?.rects) || data.rects.length > 1024 || !Array.isArray(data.viewport)) return;
  child.stdin.write(JSON.stringify({ command: 'input-regions', rects: data.rects, viewport: data.viewport }) + '\n');
}

async function prepareOverlay(overlay) {
  const handle = overlay.getNativeWindowHandle();
  const result = JSON.parse(await run('/usr/bin/python', [helper('linux-desktop.py'), '--prepare-overlay',
    String(handle.readUInt32LE(0)), String(process.pid)]));
  if (!result.ok) throw new Error('Overlay window hints were not applied');
  console.log('[capri] overlay role:', result.role);
}

function startWindowWatch({ overlay, onUpdate }) {
  let stopped = false;
  let restarts = 0;
  let restartTimer;
  const send = () => {
    if (!snapshot || overlay.isDestroyed()) return;
    const b = overlay.getBounds();
    const origin = overlayBounds(overlay);
    const { screen } = require('electron');
    const wins = snapshot.wins.map((w) => {
      let r = { x: w.x, y: w.y, width: w.w, height: w.h };
      if (!snapshot.logical) {
        const p = screen.screenToDipPoint({ x: Math.round(w.x), y: Math.round(w.y) });
        const scale = screen.getDisplayNearestPoint(p).scaleFactor || 1;
        r = { x: p.x, y: p.y, width: w.w / scale, height: w.h / scale };
      }
      return { id: w.id, ...relativeRect(r, origin, b), max: w.max, seatOffset: -1 };
    }).filter((w) => w.x < b.width && w.x + w.w > 0 && w.y < b.height && w.y + w.h > 0);
    onUpdate({ fg: snapshot.fg, taskbar: Boolean(snapshot.taskbar), ai: snapshot.ai || [], wins });
  };
  const start = () => {
    child = spawn('/usr/bin/python', [helper('linux-desktop.py'), String(process.pid),
      String(overlay.getNativeWindowHandle().readUInt32LE(0))], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const data = JSON.parse(line);
        if (!Array.isArray(data.wins)) return;
        if (!snapshot) console.log('[capri] desktop bridge connected:', data.logical ? 'KWin' : 'X11');
        snapshot = data;
        send();
      } catch (err) { console.error('[capri] invalid window snapshot:', err.message); }
    });
    child.stderr.on('data', (d) => console.error(String(d).trim()));
    child.on('error', (err) => console.error('[capri] Linux helper:', err.message));
    child.on('exit', () => {
      child = null;
      snapshot = null;
      if (!overlay.isDestroyed()) onUpdate({ fg: null, taskbar: false, ai: [], wins: [] });
      if (!stopped && restarts++ < 3) restartTimer = setTimeout(start, 3000);
    });
  };
  start();
  return { refresh: send, stop() { stopped = true; clearTimeout(restartTimer); child?.stdin.end(); } };
}

// KWin's cursor is in the same logical coordinates as its window geometries.
function cursor() { return snapshot?.logical ? snapshot.cursor : null; }
function status() { return { connected: Boolean(snapshot), backend: snapshot ? (snapshot.logical ? 'kwin' : 'x11') : null,
  windows: snapshot?.wins?.length || 0, overlay: snapshot?.overlay || null, input: snapshot?.input || null }; }

const KEEP = /^(?:kwin.*|plasmashell|ksmserver|kscreenlocker.*|kded.*|org\.kde\.plasmashell|capri.*|electron.*|claude.*|codex.*|ollama.*)$/i;
function openApps() {
  const apps = new Map();
  for (const w of snapshot?.wins || []) {
    if (!w.app || KEEP.test(w.app) || w.pid <= 1 || w.pid === process.pid) continue;
    const app = apps.get(w.app) || { name: w.app, process: w.app, label: w.app, ids: [] };
    if (!app.ids.includes(w.pid)) app.ids.push(w.pid);
    apps.set(w.app, app);
  }
  return [...apps.values()];
}
async function closeApp(name, { force = false } = {}) {
  const app = openApps().find((a) => a.process === name);
  if (!app) return { running: false };
  if (force) {
    // Only the current user's processes that still own windows from the fresh snapshot.
    for (const pid of app.ids) {
      try {
        if (fs.statSync(`/proc/${pid}`).uid === process.getuid()) process.kill(pid, 'SIGKILL');
      } catch (err) { if (err.code !== 'ESRCH' && err.code !== 'ENOENT') throw err; }
    }
  } else {
    if (!child?.stdin.writable) throw new Error('Desktop bridge is unavailable');
    const ids = snapshot.wins.filter((w) => w.app === name && app.ids.includes(w.pid)).map((w) => w.id);
    child.stdin.write(JSON.stringify({ command: 'close', ids }) + '\n');
  }
  await new Promise((r) => setTimeout(r, force ? 600 : 2500));
  return { running: openApps().some((a) => a.process === name) };
}

// Gio uses the desktop's own Exec parser and handles Flatpak/Snap launchers correctly.
async function desktopApps() {
  const source = "from gi.repository import Gio; import json; print(json.dumps([{'name':a.get_display_name(),'kind':'app','id':a.get_id()} for a in Gio.AppInfo.get_all() if a.should_show() and a.get_id()]))";
  return JSON.parse(await run('/usr/bin/python', ['-c', source]));
}
async function launchApp(id) { await run('gtk-launch', [id]); }

// Epic games installed by Heroic, including Flatpak, use Legendary's manifests.
function epicGames() {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const flatpak = path.join(os.homedir(), '.var/app/com.heroicgameslauncher.hgl/config');
  const dirs = [path.join(config, 'legendary'), path.join(config, 'heroic/legendaryConfig/legendary'),
    path.join(flatpak, 'legendary'), path.join(flatpak, 'heroic/legendaryConfig/legendary')];
  const games = [];
  for (const dir of dirs) {
    try {
      for (const [id, game] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, 'installed.json'), 'utf8')))) {
        if (game.title && !game.is_dlc) games.push({ name: game.title, kind: 'epic', id });
      }
    } catch { /* launcher not installed, or its manifest is being updated */ }
  }
  return games;
}

async function media(action) {
  const volume = { volup: ['set-volume', '-l', '1.0', '@DEFAULT_AUDIO_SINK@', '5%+'],
    voldown: ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-'], mute: ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle'] };
  try {
    if (volume[action]) await run('wpctl', volume[action]);
    else if (['play', 'pause', 'next', 'previous'].includes(action)) await run('/usr/bin/python', [helper('linux-media.py'), action]);
    else return false;
    return true;
  } catch (err) { console.error('[capri] media:', err.message); return false; }
}

// Freedesktop autostart, scoped to this user. Electron's login-item API has no Linux implementation.
function desktopQuote(value) {
  // Exec quoting is parsed after desktop-file string escapes, so escaped
  // backslashes need another escaping pass (four for a literal backslash).
  return '"' + String(value).replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%') + '"';
}
function desktopEntry(executable, args, icon) {
  return `[Desktop Entry]\nType=Application\nName=Capri\nComment=Capri desktop companion\nExec=${[executable, ...args].map(desktopQuote).join(' ')}\nIcon=${icon}\nTerminal=false\nCategories=Utility;\nStartupWMClass=capri-desktop\n`;
}
function startupFile() { return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'capri-desktop.desktop'); }
function startupEnabled() { return fs.existsSync(startupFile()); }
function setStartup(enabled, root) {
  if (!enabled) { fs.rmSync(startupFile(), { force: true }); return; }
  const { app } = require('electron');
  const exe = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? [] : [root];
  fs.mkdirSync(path.dirname(startupFile()), { recursive: true });
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'capri.png') : path.join(root, 'assets/icons/capri.png');
  fs.writeFileSync(startupFile(), desktopEntry(exe, args, icon));
}

module.exports = { prepareOverlay, startWindowWatch, cursor, status, overlayBounds, relativeRect, setInputRegions, openApps, closeApp, desktopApps, launchApp, epicGames, media,
  desktopEntry, startupEnabled, setStartup };
