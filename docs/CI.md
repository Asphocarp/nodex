# Continuous integration

Nodex uses one classifier-driven pull-request gate and separate exhaustive
workflows. The pull-request workflow is intentionally a small merge-safe loop;
the main-branch, nightly, and performance workflows keep the expensive checks
continuously exercised.

## Workflow tiers

- `.github/workflows/ci.yml` runs on pull requests and owns the stable
  `required` check. `scripts/ci/classify-change.ts` returns one typed gate plan
  containing the selected static groups, application suites, Rust, migration,
  browser, Electron, stress, and runtime owners. The final job derives its
  required jobs from that same plan and fails if a selected job is skipped,
  cancelled, or failed.
- An exact four-file stable release transition (`CHANGELOG.md`, `Cargo.lock`,
  `Cargo.toml`, and `package.json`) is a narrow CI mode: classification skips
  the application gates and `release transition` validates the semantic version
  transition, release identity, and remote tag availability. The protected-main
  `Main CI` workflow remains exhaustive after merge, before the production
  Release workflow builds the signed application.
- `.github/workflows/ci-main.yml` runs the complete static, runtime, Rust, app,
  browser, stress, and Electron non-performance suite after changes land on
  `main`. Main runs are exhaustive but may execute concurrently; the production
  `Release` workflow owns release serialization through its `release-main`
  concurrency group.
- `.github/workflows/ci-nightly.yml` repeats the ignored-test, stress, and
  Electron suites. Its E2E matrix is an intentionally asynchronous
  soak signal, not a second pull-request merge requirement.
- `.github/workflows/performance.yml` owns the ignored scale/performance gates
  and the hardware-sensitive Electron performance suite.

The PR workflow fails closed: every selected job must finish successfully;
unselected jobs are allowed to be skipped. A manual `workflow_dispatch` with
`full=true` selects every ordinary PR gate. It does not promote the Rust job to
the exhaustive Main tier.

The classifier and final aggregators intentionally run before dependency setup
with the runner's native Node 22 TypeScript stripping. Their relative
TypeScript imports must include the `.ts` extension; `tsconfig.node.json`
enables extension rewriting so the same entrypoints remain typecheck-safe.

## Parallel feedback topology

`.github/workflows/_app-tests.yml` runs unit, CoreClient, Main, renderer, and
integration suites as independent matrix cells. The integration cell builds
its own Core test support instead of depending on a preceding suite. Renderer
tests use four fork workers in CI, two locally, and one in the stress tier.
Rust compiler-cache variables stay scoped to Rust-bearing steps: every cell
prepares build-resource metadata, while unit and renderer intentionally skip
the Rust and sccache setup action.

`.github/workflows/_static-checks.yml` runs typed JavaScript checks, UI
contracts, CI contracts, repository contracts, generated resources, and the
landing build as independently selectable matrix cells. `pnpm run
verify:static` remains the complete local command and also runs generated Core
protocol verification. In CI that protocol command belongs to the Rust fast
job on PRs and the Rust quality job on Main so it can share Rust setup and
compiler cache.

Changing CI orchestration or manually selecting `full` activates every
ordinary PR job, but `core:test:pr` remains the only ordinary PR Rust command.
The exhaustive workspace and Store-migration suites remain separate parallel
jobs in Main CI. This separation means broad gate selection cannot accidentally
turn a workflow-only PR into the slowest Rust tier.

## Canonical Rust commands

Project-specific test semantics live in `package.json`, not in workflow YAML:

- `pnpm run core:test:pr` runs the ordinary Rust suite through cargo-nextest
  plus doctests. It is the only ordinary PR Rust test tier.
- `pnpm run core:test:workspace` runs the exhaustive Rust workspace suite as a
  separate parallel Main CI job.
- `pnpm run core:test:full` runs the ordinary workspace suite and the complete
  supported Store-baseline migration layer.
- `pnpm run core:test:migration` verifies fresh/current Store preparation, the
  minimum supported baseline, exact inventory convergence, backup, rollback,
  fail-closed inputs, and idempotent reopen.
- `pnpm run core:test:nightly` runs each explicitly named ignored scale,
  performance, and reliability gate.
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
The functional Electron smoke suite opts its independent fresh-Profile
scenarios into Playwright's parallel describe mode, so the large source file no
longer collapses those workers into one serial lane. Tests tagged
`@performance` are excluded from PR and Main functional E2E and are selected
only by `pnpm run test:e2e:performance` in Performance CI.
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
summary. Records include the non-sensitive Actions run id, attempt, job, and
SHA when available.

Use the read-only historical report for workflow-level wall time, queue delay,
and summed runner-minutes:

```bash
pnpm run ci:report-timings -- \
  --workflow CI \
  --limit 20 \
  --output notes.local/ci-timings.json
```

The report deduplicates run attempts and computes nearest-rank p50/p90 only
from successful first attempts; failures and cancellations remain visible as
separate outcome counts. Use repeated comparable runs before changing tiers,
worker counts, runner sizes, or artifact topology.
