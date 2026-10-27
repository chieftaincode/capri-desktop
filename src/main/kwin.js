// Runs inside KWin 6. Only geometry, application IDs and AI-name matches leave KWin.
// The Python bridge inserts its unique bus name and Capri's PID into this template.
'use strict';
const service = '__CAPRI_BUS__';
const selfPid = __CAPRI_PID__;
const rivals = [
  ['chatgpt', /\bChatGPT\b/i], ['claude', /\bClaude\b/i], ['codex', /\bCodex\b/i],
  ['gemini', /\bGemini\b/i], ['copilot', /\bCopilot\b/i], ['perplexity', /\bPerplexity\b/i],
  ['deepseek', /\bDeepSeek\b/i], ['grok', /\bGrok\b/i], ['lechat', /\bLe Chat\b|\bMistral AI\b/i],
  ['characterai', /character\.ai/i], ['metaai', /\bMeta AI\b/i],
];
function visible(w) {
  return !w.minimized && (!w.desktops.length || w.desktops.indexOf(workspace.currentDesktop) !== -1)
    && (!w.activities.length || w.activities.indexOf(workspace.currentActivity) !== -1);
}
function tick() {
  const stack = workspace.stackingOrder;
  const fg = workspace.activeWindow;
  const wins = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const w = stack[i];
    if (w.pid === selfPid && w.caption === 'Capri Desktop Overlay') {
      w.skipSwitcher = true;
      w.skipPager = true;
      continue;
    }
    if (!visible(w) || (!w.normalWindow && !w.dialog)) continue;
    const r = w.frameGeometry;
    if (r.width < 200 || r.height < 120) continue;
    wins.push({ id: String(w.internalId), x: r.x, y: r.y, w: r.width, h: r.height,
      max: w.fullScreen || w.maximizeMode === 3, pid: w.pid, app: String(w.resourceClass) });
  }
  const data = { fg: fg ? String(fg.internalId) : null, taskbar: Boolean(fg && fg.dock),
    ai: fg ? rivals.filter(function (r) { return r[1].test(fg.caption + ' ' + fg.resourceClass); }).map(function (r) { return r[0]; }) : [],
    wins: wins, logical: true, cursor: { x: workspace.cursorPos.x, y: workspace.cursorPos.y } };
  callDBus(service, '/Capri', 'org.capri.Desktop', 'Snapshot', JSON.stringify(data), function (reply) {
    if (typeof reply !== 'string') return; // bridge exited: stop instead of spinning on D-Bus errors
    try {
      const commands = JSON.parse(reply);
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (cmd.command !== 'close') continue;
        stack.forEach(function (w) {
          if (w.pid !== selfPid && w.closeable && cmd.ids.indexOf(String(w.internalId)) !== -1) w.closeWindow();
        });
      }
    } catch (e) { /* no command */ }
    tick();
  });
}
tick();
