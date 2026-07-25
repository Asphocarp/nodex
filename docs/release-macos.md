# macOS Release CI

This document is the source of truth for Nodex macOS release automation, notarization, and Homebrew tap publication.

## Overview

Nodex ships notarized macOS builds for both Apple Silicon and Intel:
- `Nodex-<version>-arm64.dmg`
- `Nodex-<version>-arm64.zip`
- `Nodex-<version>-x64.dmg`
- `Nodex-<version>-x64.zip`
- `Nodex-latest-arm64.dmg`
- `Nodex-latest-x64.dmg`
- canonical `latest-mac.yml`
- per-architecture ZIP blockmaps required by `electron-updater`

User runtime requirement: macOS 12 Monterey or later.

Build requirement: release packaging runs on macOS 26 runners because `electron-builder`'s Icon Composer path requires `actool >= 26`. Do not present that build-runner constraint as a user-facing OS requirement.

The release pipeline uses two GitHub Actions workflows:
- `.github/workflows/prepare-release.yml`
- `.github/workflows/release.yml`

`Prepare Release` is the normal entrypoint. It validates the TypeScript and Rust sources, generated Core protocol, production authority boundary, browser and Electron restart flows; prepares an unpushed release-candidate workspace; builds and notarizes both macOS artifacts from that candidate; verifies the closed native runtime from each signed app; and only then creates and pushes the release commit plus the `v<version>` tag before publishing the GitHub Release and updating the Homebrew tap.

`Release` is the fallback workflow for already-existing refs. It builds, signs, notarizes, verifies, publishes the GitHub Release, and updates the first-party Homebrew tap for a committed tag or ref. It does not mutate git history.

Because `arm64` and `x64` packaging run in separate jobs, each macOS build uploads its own updater manifest and blockmaps as first-class artifacts. The publish job merges the two per-arch `latest-mac.yml` files into one canonical `latest-mac.yml`, creates stable DMG aliases for the landing page, and then publishes the GitHub Release.

Installer styling is checked in with the app: `electron-builder.yml` owns the DMG Finder geometry, and `resources/dmg-background.png` plus `resources/dmg-background@2x.png` provide the 1x/Retina background pair. Keep those two background assets in sync so packaged DMGs stay sharp on Retina displays.

For local Linux-path debugging, Nodex also ships a committed `act` harness for the `prepare` job. That harness intentionally stops after validation and never performs the candidate-build, commit, tag, push, or publish steps locally.

## Installation and Update Contract

The notarized DMG is the direct-install artifact. Users drag `Nodex.app` into
Applications or accept the first-launch native move prompt. The ZIP is an
updater payload, not a second manual installation format. A packaged copy
running outside an Applications folder may continue for recovery, but it does
not initialize `electron-updater`.

Homebrew Cask installs the same app bundle and exposes
`Contents/Resources/bin/nodex` through a `binary` symlink. Direct-install users
can create the equivalent user-owned `~/.local/bin/nodex` link through
`Nodex -> Install Command Line Tool…`. No channel copies the native CLI away
from its sibling Core and bundled resources.

Installation, Cask zap, and app updates never migrate or delete Profile content.
In particular, `~/.nodex` and Nodex Application Support state are absent from
the generated Cask zap list. Core alone recognizes, snapshots, stages,
validates, and publishes legacy Profile migrations.

## One-Time Setup

### GitHub

Create a GitHub Actions environment named `release` in the `junyudev/nodex` repository. The macOS build jobs, release publication job, and Homebrew tap update job all run under that environment.

Add these environment secrets:
- `CSC_LINK`: base64 of the exported `Developer ID Application` `.p12`
- `CSC_KEY_PASSWORD`: password used when exporting the `.p12`
- `APPLE_API_KEY_B64`: base64 of the App Store Connect API key `.p8`
- `APPLE_API_KEY_ID`: App Store Connect API key id
- `APPLE_API_ISSUER`: App Store Connect issuer id
- `HOMEBREW_TAP_GITHUB_TOKEN`: fine-grained token with `Contents: Read and write` on `junyudev/homebrew-tap`

Recommended environment protection:
- required reviewers for first releases
- secrets restricted to the `release` environment only

### Apple

Nodex uses:
- bundle id `app.jyu.nodex`
- `Developer ID Application` certificate for outside-App-Store distribution
- App Store Connect API key authentication for notarization

The certificate exported into `CSC_LINK` must contain the `Developer ID Application` identity and its private key.

## Triggering a Release

### Preferred path

Run `Prepare Release` from GitHub Actions UI or from the CLI.

For a patch bump:

```bash
gh workflow run "Prepare Release" \
  --repo junyudev/nodex \
  -f release_type=patch
```

For an explicit version:

```bash
gh workflow run "Prepare Release" \
  --repo junyudev/nodex \
  -f release_type=custom \
  -f custom_version=0.1.3
```

Before triggering it:
1. Make sure `CHANGELOG.md` has the intended release notes under `## [Unreleased]`.
2. Make sure the `release` environment secrets are populated.
3. Make sure the default branch is green.

### Manual fallback

If the workflow cannot be used, cut the version locally:

```bash
pnpm run release:cut -- 0.1.3
git push origin HEAD
git push origin v0.1.3
```

This bypasses the `Prepare Release` workflow, so use it only when necessary.

### Local `act` reproduction for `prepare`

Use this when `Prepare Release` fails in the Ubuntu validation path and you need a local reproduction that stays aligned with the real workflow:

```bash
brew install act
pnpm run release:prepare:act:list
pnpm run release:prepare:act -- --release-type patch
```

For an explicit version:

```bash
pnpm run release:prepare:act -- --release-type custom --custom-version 0.1.3
```

Supporting files:
- `.actrc`
- `.github/act/prepare-release.event.json`
- `.github/act/prepare-release.secrets.example`
- `scripts/run-prepare-release-act.sh`

Behavior:
- runs only the `prepare` job from `.github/workflows/prepare-release.yml`
- keeps checkout, Node/pnpm and Rust setup, install, typecheck, lint, Core fmt/clippy/tests/protocol/boundary audit, application tests, browser tests, and Electron restart E2E aligned with GitHub Actions
- skips version bump, changelog generation, candidate artifact creation, macOS packaging, commit/tag/push, and publication when `github.event.act` is true

Current known target:
- the cloud failure on March 16, 2026 was in the macOS `electron-vite build` step, where Node hit its default old-space heap limit during renderer chunk rendering; release CI now applies a larger CI-only heap limit and delays git mutation until after both macOS builds pass

Limitations:
- no macOS runner emulation
- no notarization validation
- no validation for environment-scoped GitHub Actions secrets
- requires a working Docker-compatible runtime such as Docker Desktop or OrbStack

## Workflow Details

### `Prepare Release`

Workflow file: `.github/workflows/prepare-release.yml`

Trigger:
- `workflow_dispatch`

Inputs:
- `release_type`: `patch`, `minor`, `major`, or `custom`
- `custom_version`: required only when `release_type=custom`

Steps:
1. Check out the repository with full history.
2. Install the Node and pnpm versions pinned by `.node-version` and `package.json#packageManager`, then install dependencies with `pnpm install --frozen-lockfile`.
3. Run `pnpm run typecheck`.
4. Run `pnpm run lint`.
5. Run Rust formatting, strict Clippy, the complete Rust workspace, generated Core protocol verification, and the production authority boundary audit.
6. Build the debug Core integration runtime, then run the Node/main/renderer/integration, Chromium browser, and Electron restart E2E suites.
7. When `github.event.act` is true, stop after validation and skip all candidate-build, git-mutation, and publish steps.
8. Resolve the target version:
   - for `patch`/`minor`/`major`, use Bun semver bumping
   - for `custom`, use the explicit version string
9. Run `pnpm version ... --no-git-tag-version`.
10. Run `pnpm run release:prepare` to:
   - roll `CHANGELOG.md` forward
   - generate release notes
   - generate the release commit message
11. Archive the prepared workspace as a release-candidate source artifact, plus release notes and commit-message metadata artifacts.
12. Build and notarize `arm64` and `x64` macOS artifacts from that unpushed release-candidate source.
13. Verify each packaged native runtime's closed manifest, architecture, deployment target, Developer ID team, CLI/Core cold start, optional service status, and Electron startup before the existing notarization/stapling checks.
14. Verify the release branch head is still unchanged since the workflow started.
15. Create the release commit.
16. Create annotated tag `v<version>`.
17. Push the commit and tag.
18. Publish the GitHub Release from the already-built artifacts.
19. Update the Homebrew tap from those same verified artifacts.

Output contract:
- `tag_name`: for example `v0.1.3`
- `version`: for example `0.1.3`

### `Release`

Workflow file: `.github/workflows/release.yml`

Triggers:
- `push` on tags matching `v*`
- `workflow_call` from other workflows that already have a committed release ref

Environment:
- all jobs use the `release` environment

Release jobs:
- `build-macos-arm64`
- `build-macos-x64`
- `publish-release`
- `update-homebrew-tap`

#### `build-macos-arm64`

Runner:
- `macos-26`

Responsibilities:
1. Check out the release tag or passed git ref.
2. Install the Node and pnpm versions pinned by `.node-version` and `package.json#packageManager`, then install dependencies.
3. Resolve the release tag and semver version.
4. Materialize `APPLE_API_KEY_B64` into `${RUNNER_TEMP}/AuthKey_<id>.p8`.
5. Export `APPLE_API_KEY=<temp-path>` into the job environment.
6. Run `pnpm run package:mac:arm64` with a larger CI-only `NODE_OPTIONS=--max-old-space-size=6144` heap limit to avoid the default Node old-space cap during renderer bundling.
   - When `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are configured, this build emits hidden source maps, uploads them to Sentry under `nodex@<version>`, and deletes the generated `.map` files before packaging artifacts are uploaded.
7. Package on a macOS 26 runner so `electron-builder` can compile the checked-in `resources/icon.icon` asset with `actool >= 26`.
8. Assert these files exist:
   - `dist/Nodex-<version>-arm64.dmg`
   - `dist/Nodex-<version>-arm64.zip`
   - `dist/latest-mac.yml`
   - `dist/Nodex-<version>-arm64.zip.blockmap`
   - built `Nodex.app`
9. Assert bundled Agent and Nodex runtime resources exist inside the architecture-specific app:
   - `Contents/Resources/bin/interpreter`
   - `Contents/Resources/bin/codex-code-mode-host`
   - `Contents/Resources/codex-path/rg`
   - `Contents/Resources/codex-resources/zsh/bin/zsh`
   - `Contents/Resources/agent-runtime.json`
   - `Contents/Resources/codex-package.json`
   - `Contents/Resources/third-party/open-interpreter/LICENSE`
   - `Contents/Resources/third-party/open-interpreter/NOTICE`
   - `Contents/Resources/bin/nodex`
   - `Contents/Resources/bin/nodex-core`
   - `Contents/Resources/bin/rust-core-runtime.json`
   - `Contents/Helpers/Nodex Service.app`
10. Extract the signed ZIP into a new `${RUNNER_TEMP}` install root. All runtime and launch checks use this extracted app, not the mutable builder output.
11. Run `scripts/verify-codex-runtime.ts` against the fresh install. It validates every declared Agent artifact against its post-signing size and SHA-256, checks declared search-path tools as regular executables, runs bundled `interpreter --version`, and verifies the pinned Open Interpreter release provenance. Every embedded runtime executable must use the same TeamIdentifier as the enclosing app.
12. Run `scripts/verify-native-runtime.ts` for the job architecture. It validates the closed native manifest against the final Developer ID-signed bytes, exact bundle destinations, regular executable modes, thin Mach-O architecture, macOS 12 load commands, the single shared `Resources/codex-path/rg` executable, the nested ServiceManagement bundle, Developer ID team consistency, and the final deep app seal. It also requires Core's authenticated self SHA-256 to equal `rust-core-runtime.json`. With a PATH limited to `/usr/bin:/bin` and nonexistent Cargo/Rustup homes, it invokes `nodex` through an external symlink, cold-starts Core through `nodex --json doctor`, repeats the selector launch to prove compatible reuse of the same PID/start nonce, creates one disposable Page and finds it through `nodex rg`, queries optional service status, migrates the frozen early-v57 fixture through only the packaged app's self-discovered migrator and confirms its source backup, and keeps the fresh Electron app process alive through startup.
13. Require both notarization checks from the same verifier:
   - `spctl --assess --type execute --verbose=4`
   - `xcrun stapler validate`
14. Upload the DMG, ZIP, `latest-mac.yml`, and blockmaps as the `macos-arm64-release` artifact.

Secrets consumed:
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_B64`
- `SENTRY_AUTH_TOKEN` (optional, enables source-map upload)
- `SENTRY_ORG` (optional, enables source-map upload)
- `SENTRY_PROJECT` (optional, enables source-map upload)

#### `build-macos-x64`

Runner:
- `macos-26-intel`

Responsibilities are the same as the arm64 job, except it runs `pnpm run package:mac:x64`, verifies every native artifact and fresh launch as x86_64 on the Intel runner, expects `x64` artifacts, and uploads them as `macos-x64-release`. It also must stay on a macOS 26 image because `mac.icon` packaging now requires the Xcode 26 `actool` toolchain.

#### `publish-release`

Runner:
- `ubuntu-latest`

Dependencies:
- `build-macos-arm64`
- `build-macos-x64`

Responsibilities:
1. Check out the same release ref.
2. Install the Node and pnpm versions pinned by `.node-version` and `package.json#packageManager`, then install dependencies.
3. Download the `macos-arm64-release` artifact.
4. Download the `macos-x64-release` artifact.
5. Merge the two per-arch `latest-mac.yml` files into one canonical `latest-mac.yml`.
6. Create stable landing-page aliases by copying the versioned DMGs to:
   - `Nodex-latest-arm64.dmg`
   - `Nodex-latest-x64.dmg`
7. Extract release notes for the resolved version from `CHANGELOG.md` with `pnpm run release:notes`.
8. Publish a non-draft GitHub Release using `softprops/action-gh-release`.
9. Attach release assets:
   - arm64 DMG
   - arm64 latest alias DMG
   - arm64 ZIP
   - arm64 blockmaps
   - x64 DMG
   - x64 latest alias DMG
   - x64 ZIP
   - x64 blockmaps
   - canonical `latest-mac.yml`

This job does not build binaries. It only publishes artifacts produced and verified by the two macOS jobs.

#### `update-homebrew-tap`

Runner:
- `ubuntu-latest`

Dependencies:
- `build-macos-arm64`
- `build-macos-x64`
- `publish-release`

Responsibilities:
1. Check out the same release ref.
2. Install the Node and pnpm versions pinned by `.node-version` and `package.json#packageManager`, then install dependencies.
3. Download the arm64 and x64 release artifacts.
4. Locate the released DMGs for both architectures.
5. Compute `sha256` for both DMGs with `shasum -a 256`.
6. Clone `junyudev/homebrew-tap` using `HOMEBREW_TAP_GITHUB_TOKEN`.
7. Run `pnpm run release:cask` to generate `Casks/nodex.rb`.
8. Commit the cask update:
   - `chore: update nodex cask to v<version>`
9. Push the tap update if the generated file changed.

If the tap repo already matches the generated cask, the job exits successfully without a new commit.

## Artifact and Cask Contract

The release job assumes these filenames:
- `dist/Nodex-<version>-arm64.dmg`
- `dist/Nodex-<version>-arm64.zip`
- `dist/Nodex-<version>-x64.dmg`
- `dist/Nodex-<version>-x64.zip`
- `dist/latest-mac.yml` in each per-architecture build output before merge
- `dist/Nodex-<version>-arm64.zip.blockmap`
- `dist/Nodex-<version>-x64.zip.blockmap`

The Homebrew cask generator assumes:
- the GitHub release tag is `v<version>`
- the app name is `Nodex`
- `app.jyu.nodex` is the canonical macOS bundle id for zap paths
- the cask lives at `junyudev/homebrew-tap/Casks/nodex.rb`
- the cask declares `auto_updates true`, because packaged macOS builds now self-update through GitHub Releases
- the cask links `#{appdir}/Nodex.app/Contents/Resources/bin/nodex` as `nodex`
- the cask zap list removes only disposable host preferences and saved state; it never includes `~/.nodex` or Nodex Application Support content

Homebrew install path:

```bash
brew install --cask junyudev/tap/nodex

# equivalent two-step flow
brew tap junyudev/tap
brew install --cask nodex
```

## Observability and Recovery

### Watching the workflows

List recent runs:

```bash
gh run list --repo junyudev/nodex --workflow "Prepare Release"
gh run list --repo junyudev/nodex --workflow "Release"
```

Watch a run:

```bash
gh run watch --repo junyudev/nodex
```

Inspect logs:

```bash
gh run view --repo junyudev/nodex --log
```

### Common failure points

`Prepare Release` failure:
- cause: typecheck, lint, or test regression
- action: reproduce locally with `pnpm run release:prepare:act -- --release-type patch`, fix the repo state on the default branch, then rerun `Prepare Release`
- note: if the Ubuntu suite fails while isolated renderer tests pass locally, audit top-level `mock.module()` calls in renderer tests first; under Vitest they can leak across later files and create Linux-only order-dependent failures

`build-macos-*` failure before notarization:
- cause: missing signing secrets, malformed `.p12`, wrong certificate, missing `APPLE_API_ISSUER`, packaging regression, or Node heap exhaustion during `electron-vite build`
- action: inspect the failed packaging log first; if it is a heap exhaustion, raise or validate the CI `NODE_OPTIONS` heap limit, otherwise fix the secret or packaging issue and rerun the failed job or rerun the entire workflow
- note: a DMG rejection like `source=no usable signature` from `spctl --assess --type open` usually means the workflow is verifying the wrong artifact. In Nodex's current electron-builder setup, the notarized target is the `.app`, not the unsigned DMG container.

`build-macos-*` failure during notarization or stapling:
- cause: Apple auth issue, notarization rejection, missing hardened runtime entitlement, or transient Apple service failure
- action: inspect the notarization logs, correct the signing config if needed, and rerun the job

`finalize-release` failure:
- cause: the release branch advanced while the workflow was running, the tag already exists, or git push was rejected
- action: inspect the branch/tag state, then rerun from a fresh `Prepare Release` dispatch instead of forcing the stale candidate through

`publish-release` failure:
- cause: missing release notes extraction, missing artifacts, or GitHub release API issue
- action: rerun the job after confirming both build jobs uploaded artifacts and `finalize-release` pushed the tag

`update-homebrew-tap` failure:
- cause: invalid tap token, missing tap repo access, or push conflict in `junyudev/homebrew-tap`
- action: fix the token or repo state, then rerun only the tap update job

### Recovery guidance

If `publish-release` succeeds but `update-homebrew-tap` fails:
- do not rebuild macOS artifacts
- rerun only `update-homebrew-tap` after fixing the token or repo issue

If `Prepare Release` is failing before the version bump:
- use the local `act` harness first
- do not try to debug the macOS packaging jobs until the Ubuntu `prepare` path is green again

If a macOS build fails in `Prepare Release`:
- no release commit or tag has been pushed yet
- fix the packaging issue and rerun `Prepare Release`; there is no partial git release state to clean up

If `finalize-release` succeeds but `publish-release` or `update-homebrew-tap` fails:
- do not cut a second version
- rerun the failed job in the same workflow run when possible
- if that run is no longer recoverable, use the committed tag with the fallback `Release` workflow instead of moving the tag silently

## Local Validation Before Enabling Secrets

Before trusting CI with signing secrets, do one local dry run on a Mac that has the certificate and API key available:

```bash
pnpm run package:mac:arm64
"dist/mac-arm64/Nodex.app/Contents/Resources/bin/interpreter" --version
codesign -dvvv "dist/mac-arm64/Nodex.app/Contents/Resources/bin/interpreter" 2>&1 | rg "TeamIdentifier="
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Nodex.app"
spctl --assess --type execute --verbose=4 "dist/mac-arm64/Nodex.app"
xcrun stapler validate "dist/mac-arm64/Nodex.app"
```

Repeat the same flow for `pnpm run package:mac:x64` if Intel packaging is being validated locally.

For a local unsigned developer deployment, keep packaging and installation
separate. The installer infers the standard output for the current architecture:

```bash
pnpm run package:mac
pnpm run install:local:mac -- --install-cli
```

The deployer defaults to `/Applications/Nodex Dev.app`, refuses a running Nodex
process, verifies the source and staged bundle, copies with `ditto`, performs a
same-filesystem replacement with a rollback app, verifies the installed result,
and only then removes the rollback. It will not target `/Applications/Nodex.app` unless
`--allow-production-destination` is explicit. A nonstandard package can still
be selected with `--app-path`. `install.sh` is only a temporary deprecated
forwarding shim for this command.
