#!/usr/bin/env bash
set -euo pipefail
capri_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$capri_root"
mkdir -p .runtime
exec > >(tee .runtime/update.log) 2>&1
npm test
git push origin arch-linux
node scripts/restart-linux.js
