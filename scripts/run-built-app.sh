#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

require_prepared_build="false"
if [[ "${1:-}" == "--prepared" ]]; then
  require_prepared_build="true"
  shift
fi
if (($# > 0)); then
  printf 'Error: unexpected argument: %s\n' "$1" >&2
  exit 1
fi

pnpm --silent run core:build:dev
pnpm --silent run stage:codex-runtime:mac:cached

remote_debugging_port="${NODEX_REMOTE_DEBUGGING_PORT:-9333}"
if [[ ! "${remote_debugging_port}" =~ ^[0-9]+$ ]] ||
  ((remote_debugging_port < 0 || remote_debugging_port > 65535)); then
  printf 'Error: NODEX_REMOTE_DEBUGGING_PORT must be an integer from 0 to 65535.\n' >&2
  exit 1
fi

if pnpm exec tsx scripts/prepared-electron-build.ts verify >/dev/null 2>&1; then
  printf 'Reusing verified production build.\n'
elif [[ "${require_prepared_build}" == "true" ]]; then
  printf 'Error: prepared Electron build is stale; run pnpm run build first.\n' >&2
  exit 1
else
  printf 'Prepared production build is stale; rebuilding.\n'
  pnpm --silent run build
fi

exec pnpm exec electron . "--remote-debugging-port=${remote_debugging_port}"
