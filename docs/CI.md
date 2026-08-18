# Continuous integration

Nodex uses one classifier-driven pull-request gate and separate exhaustive
workflows. The pull-request workflow is intentionally a small merge-safe loop;
the main-branch, nightly, and performance workflows keep the expensive checks
continuously exercised.

## Workflow tiers

- `.github/workflows/ci.yml` runs on pull requests and owns the stable
  `required` check. It selects Rust, migration, application, browser, Electron,
  stress, and runtime gates from `scripts/ci/classify-change.ts`.
- An exact four-file stable release transition (`CHANGELOG.md`, `Cargo.lock`,
  `Cargo.toml`, and `package.json`) is a narrow CI mode: classification skips
  the application gates and `release transition` validates the semantic version
  transition, release identity, and remote tag availability. The protected-main
  `Main CI` workflow remains exhaustive after merge, before the production
  Release workflow builds the signed application.
- `.github/workflows/ci-main.yml` runs the complete static, runtime, Rust, app,
  browser, stress, and Electron non-performance suite after changes land on
  `main`.
- `.github/workflows/ci-nightly.yml` repeats the ignored-test, stress, and
  Electron suites. Its E2E matrix is an intentionally asynchronous
  soak signal, not a second pull-request merge requirement.
- `.github/workflows/performance.yml` owns the ignored scale/performance gates
  and the hardware-sensitive Electron performance suite.

The PR workflow fails closed: every selected job must finish successfully;
unselected jobs are allowed to be skipped. A manual `workflow_dispatch` with
`full=true` selects every PR gate.

## Canonical Rust commands

Project-specific test semantics live in `package.json`, not in workflow YAML:

- `pnpm run core:test:pr` runs the ordinary Rust suite through cargo-nextest
  plus doctests.
- `pnpm run core:test:full` runs the ordinary workspace suite and the complete
  migration compatibility layer.
- `pnpm run core:test:migration` runs the migration-focused compatibility tier.
- `pnpm run core:test:nightly` runs each explicitly named ignored scale,
  performance, reliability, and legacy-inventory gate.
- `pnpm run core:test` remains the local/source-verification alias for the full
  and nightly Rust tiers.

Every ignored Rust test is listed in `.config/ci/ignored-rust-tests.json` and
must have a direct package-script owner. `pnpm run ci:verify-ignored-rust-tests`
checks that the manifest, package scripts, and workflows cannot silently drift.

## Compiler and browser caches

Rust-bearing jobs use sccache through `.github/actions/setup-rust-ci` with
`RUSTC_WRAPPER=sccache` and the GitHub Actions cache backend. Jobs expose
`sccache --show-stats` in their summaries. Cargo target directories and mutable
test Stores are not used as correctness caches.

Browser jobs use `.github/actions/setup-playwright`, which keys the managed
Chromium cache from the lockfile and package manifest, then verifies the
runner's system dependencies with Playwright's installer.

## Electron E2E isolation

The E2E config uses two workers in CI while keeping `fullyParallel: false`.
Each Electron scenario creates a disposable Profile under the operating
system's owned temporary namespace. That Profile supplies its own `NODEX_HOME`,
Core Unix socket, Electron user-data/session directories, workspace, agent home,
and artifacts directory. Core shutdown and ownership leases must be proven
before cleanup deletes a Profile. The worker index is included in fixture labels
and is available as `NODEX_E2E_WORKER_INDEX` for diagnostics.

Do not replace these boundaries with fixed ports, shared Stores, shared Electron
user-data directories, or a process singleton shared across workers.

## CI timing evidence

Wrap meaningful commands with:

```bash
pnpm exec tsx scripts/ci/run-timed.ts \
  --name rust-fast \
  -- pnpm run core:test:pr
```

The helper appends JSONL records to `.generated/ci-timings/<job>.jsonl` and,
when `GITHUB_STEP_SUMMARY` is available, adds a duration table to the job
summary. Use repeated warm and cold-ish runs before changing tiers, worker
counts, runner sizes, or artifact topology.
