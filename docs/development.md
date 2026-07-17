# Development

This document keeps contributor setup and local validation details out of the public README.

## Setup

Install dependencies from the repository root:

```bash
pnpm install
```

Nodex pins Node `24.15.0` in `.node-version` and pnpm `11.11.0` in
`package.json`. Use those versions before running a frozen install.

The install lifecycle runs `electron-builder install-app-deps`, which rebuilds
`better-sqlite3` and `node-pty` for Electron. Do not run `pnpm rebuild` for these
packages: it can replace the Electron-compatible binaries with host-Node
binaries.

Start the desktop app in development mode:

```bash
pnpm run dev
```

Both `pnpm run dev` and `pnpm run build:run` expose the renderer Chrome DevTools
Protocol endpoint on `127.0.0.1:9333` for local debugging.

Run Nodex against disposable Codex and Nodex state when checking first-run or
profile-scoped behavior:

```bash
pnpm run build:run:isolated
# or
scripts/run.sh
```

The isolated runner creates temporary `CODEX_HOME` and `NODEX_DIR` directories
and removes them when the app exits. It starts with an empty Codex home by
default. Copy snapshots of the current Codex authentication or configuration
when they are needed:

```bash
scripts/run.sh -ac
scripts/run.sh -da
```

Run `scripts/run.sh --help` for options that use either global directory.
Use `--keep` to preserve the generated run root for inspection, or
`--root DIR` to choose its path explicitly. An existing root can be reused only
when `--keep` is also set.

Build the app:

```bash
pnpm run build
```

Package local macOS installers:

```bash
pnpm run package
```

## Validation

Run the standard checks before handing off code changes:

```bash
pnpm run typecheck
pnpm run lint
pnpm test:all
```

The test commands follow production boundaries:

- `pnpm test:unit` runs pure shared, script, configuration, and renderer helper
  logic in Node. Renderer tests use the `.node.test.ts` suffix when they do not
  require DOM behavior.
- `pnpm test:main` runs main/store tests in Electron's embedded Node runtime.
- `pnpm test:renderer` runs ordinary React and DOM behavior in jsdom.
- `pnpm test:browser` runs browser-sensitive renderer contracts in Chromium.
- `pnpm test:integration` runs integration tests in Electron's Node runtime.
- `pnpm test:electron-runtime` runs native persistence probes.
- `pnpm test:e2e` builds and exercises the complete Electron/preload/IPC/SQLite chain.

Use the matching runtime when running one test file:

```bash
# Pure Node/shared logic
pnpm exec vitest run --config vitest.node.config.ts <test-file>

# Renderer/jsdom behavior
pnpm exec vitest run --config vitest.renderer.config.ts <test-file>

# Electron main process, local store, and native addons
pnpm test:main <test-file>

# Electron integration behavior
pnpm test:integration <test-file>
```

Do not run `vitest.main.config.ts` or `vitest.integration.config.ts` directly.
Those configs fail fast outside Electron so that host Node cannot reach an
Electron-built native addon.

During implementation, run the narrow test file or runtime suite affected by the
change. Run the complete validation set once after the final edit set is stable;
`test:all` is the handoff and release gate, not the inner development loop.

## Native Addon ABI Errors

Electron and the host Node executable can report the same Node version while
using different native module ABIs. `better-sqlite3` and `node-pty` therefore
must be loaded by the runtime they were rebuilt for. An error containing
`compiled against a different Node.js version` or mismatched
`NODE_MODULE_VERSION` values usually means the wrong runtime launched the code;
it does not necessarily mean dependencies are stale.

First, rerun the operation through the repository command that owns its runtime.
For a main/store test, use `pnpm test:main <test-file>`; for an integration
test, use `pnpm test:integration <test-file>`. Reinstalling is unnecessary
when the failing command invoked either Electron Vitest config directly.

If a host-Node rebuild already replaced the native binaries, restore the
repository's Electron target from the repository root:

```bash
pnpm exec electron-builder install-app-deps
```

To diagnose an unfamiliar environment, compare the runtime-reported ABIs:

```bash
node -p "process.versions.modules"
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p "process.versions.modules"
```

Different values are expected. Do not try to make one native binary serve both
runtimes; keep native-addon work on the Electron-owned test and application
paths.

## Related Technical Docs

- [Architecture](../ARCHITECTURE.md)
- [Engineering learnings](ENGINEERING_LEARNINGS.md)
- [Product specification](product-specs/nodex-product-spec.md)
- [Frontend conventions](FRONTEND.md)
- [Reliability model](RELIABILITY.md)
- [Security model](SECURITY.md)
- [macOS release CI](release-macos.md)
- [Landing site operations](landing-site.md)
