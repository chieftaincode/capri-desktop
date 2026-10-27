'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const linux = require('../src/main/linux');

function kwinSession() {
  const desktop = { id: 'one' };
  const other = { id: 'two' };
  const closed = [];
  const win = (id, extra = {}) => ({ internalId: id, pid: 200, normalWindow: true, dialog: false,
    minimized: false, desktops: [desktop], activities: [], caption: 'private title', resourceClass: 'org.kde.konsole',
    frameGeometry: { x: -1200, y: 140, width: 900, height: 600 }, fullScreen: false, maximizeMode: 0,
    closeable: true, closeWindow() { closed.push(id); }, ...extra });
  const windows = [win('back'), win('max', { maximizeMode: 3 }), win('hidden', { minimized: true }),
    win('elsewhere', { desktops: [other] }), win('activity', { activities: ['other'] }),
    win('small', { frameGeometry: { x: 0, y: 0, width: 20, height: 20 } }),
    win('overlay', { pid: 100, caption: 'Capri Desktop Overlay', criticalNotification: true, layer: 7 }),
    win('demo', { pid: 100, caption: 'night-city-api — npm test' }),
    win('front', { caption: 'ChatGPT — private conversation' })];
  const workspace = { currentDesktop: desktop, currentActivity: 'default', stackingOrder: windows,
    activeWindow: windows.at(-1), cursorPos: { x: -700, y: 200 } };
  const messages = [];
  const callbacks = [];
  const source = fs.readFileSync(path.join(__dirname, '../src/main/kwin.js'), 'utf8')
    .replace('__CAPRI_BUS__', 'org.capri.Test').replace('__CAPRI_PID__', '100');
  vm.runInNewContext(source, { workspace, callDBus(service, object, iface, method, payload, callback) {
    assert.equal(service, 'org.capri.Test');
    assert.equal(method, 'Snapshot');
    messages.push(JSON.parse(payload));
    callbacks.push(callback);
  } });
  return { workspace, windows, closed, messages, callbacks };
}

test('KWin tracks visible windows front first, keeps negative coordinates, and includes demo windows', () => {
  const { messages } = kwinSession();
  const snapshot = messages[0];
  assert.deepEqual(snapshot.wins.map((w) => w.id), ['front', 'demo', 'max', 'back']);
  assert.equal(snapshot.wins.at(-1).x, -1200);
  assert.equal(snapshot.wins.find((w) => w.id === 'max').max, true);
  assert.equal(snapshot.logical, true);
  assert.deepEqual(snapshot.cursor, { x: -700, y: 200 });
  assert.deepEqual(snapshot.ai, ['chatgpt']);
  assert.equal(snapshot.fg, 'front');
  assert.doesNotMatch(JSON.stringify(snapshot), /private|conversation|caption|title/);
});

test('KWin refreshes when focus, desktop, geometry, and minimization change', () => {
  const { workspace, windows, callbacks, messages } = kwinSession();
  workspace.activeWindow = windows[0];
  windows[0].frameGeometry.x = 50;
  windows.at(-1).minimized = true;
  callbacks.shift()('[]');
  assert.equal(messages.at(-1).fg, 'back');
  assert.equal(messages.at(-1).wins.find((w) => w.id === 'back').x, 50);
  assert.equal(messages.at(-1).wins.some((w) => w.id === 'front'), false);
  workspace.currentDesktop = windows[3].desktops[0];
  callbacks.shift()('[]');
  assert.deepEqual(messages.at(-1).wins.map((w) => w.id), ['elsewhere']);
});

test('KWin hides Capri from the taskbar and switcher and reports its fullscreen layer', () => {
  const { windows, messages } = kwinSession();
  const overlay = windows.find((w) => w.internalId === 'overlay');
  assert.equal(overlay.skipTaskbar, true);
  assert.equal(overlay.skipSwitcher, true);
  assert.equal(overlay.skipPager, true);
  assert.equal(overlay.keepAbove, true);
  assert.deepEqual(messages[0].overlay, { skipTaskbar: true, aboveFullscreen: true, layer: 7,
    geometry: { x: -1200, y: 140, width: 900, height: 600 } });
  assert.equal(windows[0].skipTaskbar, undefined, 'other applications must keep their taskbar entries');
});

test('Window ledges use the real KWin overlay origin on the left and right monitors', () => {
  const viewport = { width: 1920, height: 1080 };
  assert.deepEqual(linux.relativeRect({ x: -1700, y: 100, width: 800, height: 600 },
    { x: -1920, y: 30, width: 1920, height: 1080 }, viewport), { x: 220, y: 70, w: 800, h: 600 });
  assert.deepEqual(linux.relativeRect({ x: 2200, y: 100, width: 800, height: 600 },
    { x: 1920, y: 30, width: 1920, height: 1080 }, viewport), { x: 280, y: 70, w: 800, h: 600 });
  assert.deepEqual(linux.relativeRect({ x: 4400, y: 200, width: 1600, height: 1200 },
    { x: 3840, y: 60, width: 3840, height: 2160 }, viewport), { x: 280, y: 70, w: 800, h: 600 });
});

test('KWin closes only explicitly named windows and never Capri itself', () => {
  const { callbacks, closed } = kwinSession();
  callbacks.shift()(JSON.stringify([{ command: 'close', ids: ['front', 'demo', 'overlay', 'nonexistent'] }]));
  assert.deepEqual(closed, ['front']);
});

test('Linux discovers the real desktop application catalogue without launching anything', { skip: process.platform !== 'linux' }, async () => {
  const list = await linux.desktopApps();
  assert.ok(list.length > 0);
  assert.ok(list.every((item) => item.name && item.id.endsWith('.desktop') && item.kind === 'app'));
});

test('Heroic catalogue reads installed Epic games and excludes DLC', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-heroic-test-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, 'heroic/legendaryConfig/legendary'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'heroic/legendaryConfig/legendary/installed.json'), JSON.stringify({
    testGame: { title: 'Test Epic Game', is_dlc: false },
    testDlc: { title: 'Test DLC', is_dlc: true },
  }));
  const games = linux.epicGames();
  assert.deepEqual(games.find((g) => g.id === 'testGame'), { name: 'Test Epic Game', kind: 'epic', id: 'testGame' });
  assert.equal(games.some((g) => g.id === 'testDlc'), false);
});

test('Linux desktop launcher is valid, including paths with spaces and shell characters', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-desktop-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'capri.desktop');
  const text = linux.desktopEntry('/usr/bin/node', ['/tmp/path with spaces/start.js'], '/tmp/icon.png');
  assert.match(text, /Exec="\/usr\/bin\/node" "\/tmp\/path with spaces\/start.js"/);
  fs.writeFileSync(file, text);
  const check = spawnSync('desktop-file-validate', [file], { encoding: 'utf8' });
  if (check.error?.code === 'ENOENT') return t.skip('desktop-file-validate is not installed');
  assert.equal(check.status, 0, check.stdout + check.stderr);
  fs.writeFileSync(file, linux.desktopEntry('/usr/bin/node', ['/tmp/a $b `c` "d" \\ %f.js'], '/tmp/icon.png'));
  const special = spawnSync('desktop-file-validate', [file], { encoding: 'utf8' });
  assert.equal(special.status, 0, special.stdout + special.stderr);
});
