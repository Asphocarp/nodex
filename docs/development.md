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
`node-pty` for Electron. Do not run `pnpm rebuild` for it: that can replace the
Electron-compatible binary with a host-Node binary. SQLite and collaborative
Document authority are native Rust code and do not use a Node addon.

Start the desktop app in development mode:

```bash
pnpm run dev
```

Both `pnpm run dev` and `pnpm run build:run` expose the renderer Chrome DevTools
Protocol endpoint on `127.0.0.1:9333` for local debugging. Both commands first
build the development `target/debug/nodex-core` executable so Electron cannot
start a stale native authority after a branch switch or rebase.

After one successful `pnpm run build` or ordinary isolated run, subsequent
production-mode `scripts/run.sh` launches automatically reuse the prepared
Electron bundle when it still verifies. To require reuse and fail instead of
falling back to a full rebuild, use:

```bash
scripts/run.sh -ck -r /tmp/nodex-library --reuse-build
```

Prepared reuse is fail-closed. It hashes the complete Electron input closure,
the production build context, dynamically read development resources, and the
exact `out/` inventory. A changed, missing, added, or symlinked input/output
requires one normal build. The build wrapper fingerprints inputs before and
after `electron-vite` and again after recording outputs, so an edit made during
the build cannot produce a reusable stamp. The path still runs Cargo's
incremental Core build on every launch; the native authority is never reused
from a source-blind build stamp. Use `--dev` instead when actively editing and
needing Vite HMR; `--dev` and `--reuse-build` are mutually exclusive.

Development startup also reuses the staged agent runtime only after its target,
release-lock-bound metadata, exact artifact closure, modes, sizes, and SHA-256
digests validate. A miss performs the normal archive-backed atomic restage.
Packaging always performs a full target-specific native runtime stage.

Run Nodex against disposable Codex and Nodex state when checking first-run or
profile-scoped behavior:

```bash
pnpm run build:run:isolated
# or
scripts/run.sh
```

The isolated runner creates temporary `CODEX_HOME` and `NODEX_HOME` roots and
removes them when the app exits. It starts with an empty Codex home by
default. Copy snapshots of the current Codex authentication or configuration
when they are needed:

```bash
scripts/run.sh -ac
scripts/run.sh -da
scripts/run.sh -ack -r /tmp/nodex-library
```

Run `scripts/run.sh --help` for options that use either global home.
Use `--keep` to preserve the generated run root for inspection, or
`--root DIR` to choose its path explicitly. An existing root can be reused only
when `--keep` is also set. Reuse preserves its existing schema and data; choose
a new root when checking first-run behavior or when the retained profile predates
the currently supported Core import boundary.

Desktop process isolation is keyed by the resolved `NODEX_HOME`. A development
run and a packaged app may run concurrently when their homes differ; each gets
its own Electron storage, process lock, Core socket/capability, database,
assets, backups, and logs. Nodex no longer starts a Desktop TCP API or reads
`NODEX_PORT` / `[server].port`. To verify that boundary with disposable data:

```bash
scripts/run.sh -ck -r ../tmp/no/oi --dev
lsof -nP -iTCP:51283 -sTCP:LISTEN
```

The listener check should show no Nodex desktop process. The Browser sidebar is
still supported, but it is a separate webview partition and cannot resolve the
default-session-only `nodex-asset:` protocol.

When `NODEX_HOME` is isolated, the runner holds an exclusive Profile lease,
keeps the selected package script under a dedicated application process group,
and gracefully stops the authenticated Core generation before it releases the
lease or removes the run root. Terminal interrupts are forwarded to the whole
application group with a bounded termination escalation so Electron/Vite
descendants cannot be orphaned; the detached Core is never selected or stopped
by a process signal. `--keep` therefore preserves Profile state, not background
processes. A shutdown that cannot be proven preserves both the lease and run
root and prints a diagnostic; verify that the recorded supervisor and exact
Core generation have stopped before manually removing that validated lease.
`--global-nodex` retains the normal detached Core lifetime because the runner
does not own that Profile.

`scripts/run.sh --dev` still runs the unchanged `pnpm run dev` command beneath
the lifecycle supervisor. electron-vite continues to own its renderer dev
server and Electron child, so CSS HMR and React Fast Refresh remain active
until the app or launching terminal exits.

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
pnpm run verify:source
```

The test commands follow production boundaries:

- `pnpm test` runs the ordinary deterministic test tier across the Node, main,
  renderer, and integration runtimes.
- `pnpm test:unit` runs pure shared, script, configuration, and renderer helper
  logic in Node. Renderer tests use the `.node.test.ts` suffix when they do not
  require DOM behavior.
- `pnpm test:main` runs Electron main-process adapter and host tests.
- `pnpm test:renderer` runs ordinary React and DOM behavior in jsdom.
- `pnpm test:browser` runs browser-sensitive renderer contracts in Chromium.
- `pnpm test:integration` runs integration tests in Electron's Node runtime.
- `pnpm run test:stress` runs volume, repeated-lifecycle, and concurrency
  contracts in every runtime. It executes one worker at a time, independently
  of the ordinary suite.
- `pnpm run test:complete` runs both ordinary and stress tiers without the
  full Electron end-to-end suite.
- `pnpm run test:performance` runs hardware-sensitive latency gates. Run it
  manually on a stable machine; do not use its raw timing thresholds as a
  shared-CI gate.
- `pnpm run core:fmt`, `pnpm run core:clippy`, and `pnpm run core:test` validate the native authority.
- `pnpm run core:protocol:verify` and `pnpm run core:module-boundaries` verify generated contracts and the Rust-only production boundary.
- `pnpm test:e2e` builds and exercises the complete Electron/preload/IPC/Core chain.

Use the `.stress.` filename segment for a test that intentionally exercises
high volume, repeated lifecycle work, concurrent calls, or resource pressure:

```text
feature.stress.test.tsx
feature.stress.node.test.ts
feature.stress.integration.ts
feature.stress.browser.test.tsx
```

Keep a test in the ordinary tier when a single oversized input validates a
product boundary cheaply and deterministically. Move a case into the stress
tier when its scale or concurrency is the behavior under test. Keep
hardware-dependent timing and memory thresholds in explicit benchmark or
performance commands instead of either Vitest tier.

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

# A specific stress test in its owning runtime
NODEX_TEST_TIER=stress pnpm test:renderer <stress-test-file>
```

Do not run `vitest.main.config.ts` or `vitest.integration.config.ts` directly.
Those configs fail fast outside Electron so that host Node cannot reach an
Electron-built native addon.

During implementation, run the narrow ordinary or stress test file affected by
the change. Run `verify:source` once after a broad final edit set is stable; it
includes the stress tier, browser suite, and Electron E2E coverage. On macOS,
release/runtime changes additionally run:

```bash
pnpm run verify:runtime:mac
```

`pnpm test:all` remains a compatibility alias for `verify:source`; neither
command proves Apple signing, notarization, or native Intel behavior. Use the
production-like `Distribution Rehearsal` described in `release-macos.md` for
that boundary.

## Native Addon ABI Errors

Electron and the host Node executable can report the same Node version while
using different native module ABIs. `node-pty` therefore must be loaded by the
runtime it was rebuilt for. An error containing
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

Different values are expected. Do not try to make one `node-pty` binary serve
both runtimes; keep native-addon work on Electron-owned test and application
paths. Rust Core tests and binaries are independent of this Node ABI boundary.

## Related Technical Docs

- [Architecture](../ARCHITECTURE.md)
- [Engineering learnings](ENGINEERING_LEARNINGS.md)
- [Product specification](product-specs/nodex-product-spec.md)
- [Frontend conventions](FRONTEND.md)
- [Reliability model](RELIABILITY.md)
- [Security model](SECURITY.md)
- [macOS release CI](release-macos.md)
- [Landing site operations](landing-site.md)
