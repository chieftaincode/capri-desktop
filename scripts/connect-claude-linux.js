#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hooks = require('./install-hooks');
const { restart } = require('./restart-linux');
const root = path.resolve(__dirname, '..');

function readConfig(file) {
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid Capri configuration; nothing changed');
  return config;
}

function selectClaude(file) {
  const config = readConfig(file);
  if (config.assistant === 'claude' && config.claude === true) return;
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.claude-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  config.assistant = 'claude';
  config.claude = true;
  config.linked = false; // wait for a real Claude Code event to confirm the connection
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

async function main() {
  if (process.platform !== 'linux') throw new Error('This setup command is for Linux');
  const cli = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (cli.status !== 0) throw new Error('Claude Code is not available on PATH');
  console.log(cli.stdout.trim());
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'capri-desktop', 'config.json');
  readConfig(file); // validate before installing hooks or stopping Capri
  const checked = spawnSync(process.execPath, [path.join(root, 'scripts/install-hooks.js'), '--status'], { stdio: 'inherit' });
  if (checked.status !== 0) throw new Error('Could not inspect Claude hooks');
  const tests = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit' });
  if (tests.status !== 0) throw new Error('Integration checks failed; setup stopped');
  const installed = hooks.install();
  console.log(`Installed ${installed.events} Capri hooks in ${installed.file}`);
  await restart({ beforeStart: () => selectClaude(file) });
  console.log('Capri now watches Claude Code. Start a new Claude Code session to load the hooks.');
  console.log('Groq chat and existing Codex hooks are preserved. Switch the watched assistant in Capri\'s menu.');
}

module.exports = { selectClaude };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
