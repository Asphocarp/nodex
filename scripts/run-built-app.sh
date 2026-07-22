#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"
pnpm --silent run core:build:dev
pnpm --silent run stage:codex-runtime:mac:cached

if pnpm exec tsx scripts/prepared-electron-build.ts verify >/dev/null 2>&1; then
  printf 'Reusing verified production build.\n'
else
  printf 'Prepared production build is stale; rebuilding.\n'
  pnpm --silent run build
fi

exec pnpm exec electron . --remote-debugging-port=9333
