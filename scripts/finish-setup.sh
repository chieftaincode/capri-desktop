#!/usr/bin/env bash
# One final step outside the restricted coding session: authenticated fork,
# desktop integration, assistant hooks, full integration tests, and GUI launch.
set -euo pipefail
capri_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$capri_root"
mkdir -p .runtime
exec > >(tee .runtime/setup.log) 2>&1
command -v gh >/dev/null
gh auth status
capri_login=$(gh api user --jq '.login')
if ! capri_parent=$(gh api "repos/$capri_login/capri-desktop" --jq '.parent.full_name' 2>/dev/null); then
  # gh prints an HTTP error body to stdout even with --jq. A failed lookup is
  # not evidence that an unrelated repository exists.
  capri_parent=''
fi
if [[ -z "$capri_parent" ]]; then
  gh api --method POST repos/mochiiwuff/capri-desktop/forks --jq '.full_name'
elif [[ "$capri_parent" != 'mochiiwuff/capri-desktop' ]]; then
  echo 'An unrelated capri-desktop repository already exists in your account; nothing overwritten.' >&2
  exit 1
fi
capri_url="https://github.com/$capri_login/capri-desktop.git"
if git remote get-url origin >/dev/null 2>&1; then
  if [[ "$(git remote get-url origin)" != "$capri_url" ]]; then
    echo 'Origin points to another repository; nothing overwritten.' >&2
    exit 1
  fi
else
  git remote add origin "$capri_url"
fi
gh auth setup-git
if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  git fetch --unshallow upstream main
fi
git push -u origin arch-linux
echo "Fork ready: https://github.com/$capri_login/capri-desktop/tree/arch-linux"
npm test
node scripts/check-linux.js
node scripts/install-linux.js
# Use the installed coding assistant, keeping any other hooks and writing backups.
if command -v codex >/dev/null 2>&1; then
  node scripts/install-codex-hooks.js
elif command -v claude >/dev/null 2>&1; then
  node scripts/install-hooks.js
fi
echo 'Starting Capri. Restart your coding assistant so it loads the hooks.'
node scripts/restart-linux.js
echo "Capri is running. Log: $capri_root/.runtime/capri.log"
