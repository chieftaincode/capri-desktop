'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

for (const scenario of ['missing', 'existing-fork', 'unrelated']) {
  test(`finish setup handles GitHub repository lookup: ${scenario}`, { skip: process.platform !== 'linux' }, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-setup-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.copyFileSync(path.join(__dirname, '../scripts/finish-setup.sh'), path.join(dir, 'scripts/finish-setup.sh'));
    const gh = `#!/bin/sh
case "$1 $2" in
  'auth status'|'auth setup-git') exit 0 ;;
  'api user') echo test-owner ;;
  'api repos/test-owner/capri-desktop')
    case "$CAPRI_TEST_SCENARIO" in
      missing) echo '{"message":"Not Found","status":"404"}'; exit 1 ;;
      existing-fork) echo mochiiwuff/capri-desktop ;;
      unrelated) echo null ;;
    esac ;;
  'api --method')
    [ "$3" = POST ] && [ "$4" = repos/mochiiwuff/capri-desktop/forks ] || exit 98
    echo fork >> "$CAPRI_TEST_DIR/actions"
    echo test-owner/capri-desktop ;;
  *) exit 99 ;;
esac
`;
    const git = `#!/bin/sh
case "$1 $2" in
  'remote get-url') exit 2 ;;
  'remote add') echo origin >> "$CAPRI_TEST_DIR/actions" ;;
  'rev-parse --is-shallow-repository') echo false ;;
  'push -u') echo push >> "$CAPRI_TEST_DIR/actions" ;;
  *) exit 99 ;;
esac
`;
    for (const [name, content] of Object.entries({ gh, git, npm: '#!/bin/sh\nexit 23\n' })) {
      fs.writeFileSync(path.join(dir, 'bin', name), content, { mode: 0o755 });
    }
    const result = await new Promise((resolve) => {
      execFile('/usr/bin/bash', [path.join(dir, 'scripts/finish-setup.sh')], {
        env: { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH,
          CAPRI_TEST_SCENARIO: scenario, CAPRI_TEST_DIR: dir },
      }, (err, stdout, stderr) => resolve({ code: err?.code || 0, stdout, stderr }));
    });
    const actions = fs.existsSync(path.join(dir, 'actions')) ? fs.readFileSync(path.join(dir, 'actions'), 'utf8').trim().split('\n') : [];
    if (scenario === 'missing') assert.deepEqual(actions, ['fork', 'origin', 'push']);
    else if (scenario === 'existing-fork') assert.deepEqual(actions, ['origin', 'push']);
    else assert.deepEqual(actions, []);
    // The npm stub intentionally stops execution before actual tests, hooks, or GUI launch.
    assert.equal(result.code, scenario === 'unrelated' ? 1 : 23, result.stdout + result.stderr);
  });
}
