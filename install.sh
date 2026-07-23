#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "install.sh is deprecated; forwarding to install:local:mac." >&2
cd "$REPO_DIR"
exec pnpm run install:local:mac -- "$@"
