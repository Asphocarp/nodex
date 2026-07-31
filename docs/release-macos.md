# macOS Release Runbook

This document is the source of truth for Nodex application releases. A normal
release is expressed by a reviewed metadata-only commit on protected `main`;
there is no “Prepare Release” cloud form and no tag-push build path.

## Release model

The release system has one deep repository-owned Release Module under
`scripts/release/` and three thin GitHub Interfaces:

- `CI` proves source quality and exposes the stable required check
  `CI / required`.
- `Distribution Rehearsal` invokes the production Distribution Implementation
  without publishing anything.
- `Release` observes a successful protected-main CI run, recognizes an exact
  version transition, builds one verified Release Bundle, then promotes it.
- `Release Recovery` is the only manual production recovery Interface. It
  accepts an exact source SHA and version and applies the same validation,
  Distribution, and promotion logic idempotently.

The important seam is the Release Bundle, not a YAML artifact convention.
Each native architecture emits an `architecture-build.json` that binds its
source commit/tree, Release Identity, runtime locks, prepared-build generation,
package provenance, runner/toolchain versions, and artifact hashes. The
assembler accepts both manifests only when they describe one source and emits:

- `Nodex-latest-arm64.dmg`
- `Nodex-latest-x64.dmg`
- versioned arm64/x64 ZIPs and blockmaps
- merged `latest-mac.yml`
- `release-bundle.json`
- `SHA256SUMS`
- `release-notes.md` for the publisher (not a public asset)

The tag is created only after this bundle passes. A published release is never
rebuilt in place, and an existing tag is never moved.

## Release Identity

`package.json` is the canonical version input. The Release Module requires the
same stable `x.y.z` value in:

- root `package.json`
- `[workspace.package].version` in `Cargo.toml`
- every local Nodex package entry in `Cargo.lock`
- the released Changelog heading
- prepared Electron metadata, app `Info.plist`, native runtime manifest, and
  the packaged `nodex --version` result

The only valid release commit diff is exactly:

```text
CHANGELOG.md
Cargo.lock
Cargo.toml
package.json
```

Any source, workflow, runtime lock, generated file, or second version change in
that commit makes release detection fail closed.

## One-time repository configuration

The repository must have these environments, restricted to protected `main`:

| Environment | Secrets | Authority |
| --- | --- | --- |
| `macos-distribution` | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Apple signing/notarization; Sentry upload once from production arm64 |
| `release-publish` | none | job-scoped repository `contents: write` only |
| `homebrew-tap` | `HOMEBREW_TAP_GITHUB_TOKEN` | Contents read/write only on `junyudev/homebrew-tap` |
| `landing-production` | `NODEXAPP_GITHUB_IO_TOKEN` | Contents read/write only on `NodexApp/NodexApp.github.io` |

Migration status on 2026-07-31: the four protected environments exist, but
their secrets cannot be copied through the GitHub API. Before rehearsal, copy
the five Apple values from the legacy `release` environment into
`macos-distribution`. Before production, copy its Homebrew token into
`homebrew-tap`, configure the three Sentry values, and rotate the current
repository-level landing token into `landing-production`; then delete the
repository-level copy. Delete the legacy `release` environment only after the
new scopes have been exercised successfully. If v0.2.0 must intentionally omit
Sentry source maps, change the production workflow input to `false` in a
reviewed foundation commit; do not silently proceed with a partial Sentry
configuration.

Repository Actions default permissions remain read-only. The `main` ruleset
requires PRs, linear history, an up-to-date branch, and `CI / required`; it
blocks force pushes and deletion. Repository merge settings enable squash
merge only. A `v*` tag ruleset prevents update/deletion while allowing the
release workflow to create a new tag. Immutable releases must be enabled after
the current Latest release points to a stable app release.

Every external Action is pinned to a full commit SHA. Dependabot proposes npm,
Cargo, and GitHub Action updates; high-authority Action changes require release
note and source review before merge.

## Local gates

Use narrow checks while iterating. Before a release foundation or release
metadata PR is merged, run:

```bash
pnpm run verify:source
pnpm run verify:runtime:mac
```

`verify:source` is the platform-independent source gate: types, lint, generated
contracts, authority boundaries, notices/migrator reproducibility, Rust, app
tests, browser tests, Electron E2E, and landing build. `verify:runtime:mac`
verifies Agent/Browser schemas and runtime conformance on macOS. Neither proves
Apple signing or Intel behavior; the dual-architecture Distribution is that
deeper Implementation.

`pnpm test:all` remains a compatibility alias for `verify:source`.

## Rehearse a candidate

Rehearse the exact protected-main foundation SHA before the first release after
release infrastructure or packaging changes:

```bash
gh workflow run release-rehearsal.yml \
  --repo junyudev/nodex \
  -f source_sha=<full-main-sha>
```

The guard requires that SHA to be reachable from `main` and to have a
successful protected-main `CI` push run. Both hosted macOS architectures use
the same source and signing environment, but rehearsal does not receive
`contents: write`, Homebrew/landing credentials, or a Sentry upload token. It
creates no tag, Release, tap commit, or production telemetry release.

Download `nodex-release-bundle-<sha>` and inspect `release-bundle.json` and
`SHA256SUMS`. A rehearsal is required after release workflow, native packaging,
Apple signing, updater, Agent runtime, Browser runtime, or provenance changes.

## Prepare v0.2.0 (or another stable release)

Start from the latest protected `main`, use a dedicated branch, and provide the
version explicitly:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/release-v0.2.0
pnpm release:prepare -- 0.2.0
```

The command requires a clean worktree, advances all version sources, and rolls
the meaningful `Unreleased` Changelog content into a dated `0.2.0` section. It
does not commit, tag, push, or publish.

Curate `CHANGELOG.md` for user impact; do not turn the commit log or internal
refactors into release notes. Then verify the transition:

```bash
pnpm release:check -- --base origin/main --worktree
git diff -- package.json Cargo.toml Cargo.lock CHANGELOG.md
git diff --name-only
pnpm run verify:source
pnpm run verify:runtime:mac
```

The final path list must contain only the four Release Identity files. Commit
and open a PR:

```bash
git add package.json Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore(release): prepare v0.2.0" \
  -m "Synchronize the app and Rust workspace versions and roll the curated Unreleased notes into the v0.2.0 release entry."
git push -u origin codex/release-v0.2.0
```

Merge the PR with squash after `CI / required` succeeds. Do not create a tag or
manually dispatch the normal `Release` workflow.

## Automatic production path

The successful `CI` workflow for the main push wakes `Release` through
`workflow_run`. Before repository code or secrets are used, it validates the
triggering repository, `push` event, `main` branch, successful conclusion, and
source reachability. It checks the commit has one parent and asks the Release
Module to classify that parent-to-head transition.

An ordinary main commit returns `shouldRelease: false` and exits successfully.
A valid version transition runs this sequence:

1. Verify the remote stable app version and reject tag/source conflicts.
2. Build, sign, notarize, launch, and inspect arm64 on `macos-26`.
3. Build, sign, notarize, launch, and inspect x64 on `macos-26-intel`.
4. Assemble and hash the Release Bundle on a clean Linux runner.
5. Revalidate source, version, tag, remote state, and bundle identity.
6. Create or reuse an annotated tag targeting the exact source SHA.
7. Create/resume the GitHub draft, upload only the manifest allowlist, publish
   it as Latest, and verify immutability, asset digests, and tag target.
8. Generate the Homebrew cask from the same bundle, audit it, push it, and
   smoke-install the published app.
9. Deploy the landing site from the same source SHA after release verification,
   so its version and Changelog never lead the published downloads.

Sentry source maps are uploaded only by the production arm64 build. Both builds
use `SENTRY_RELEASE=nodex@<version>` so the generated app identity agrees.

## Recovery

Use recovery only for a transient Distribution/publisher/downstream failure on
an already-reviewed release commit:

```bash
gh workflow run release-recovery.yml \
  --repo junyudev/nodex \
  -f source_sha=<full-release-main-sha> \
  -f version=0.2.0
```

Recovery repeats protected-main and CI guards and requires that exact commit to
be a valid metadata-only transition for the supplied version. Its behavior is
idempotent:

- absent tag/release: rebuild, verify, tag, publish;
- matching tag: reuse only when it resolves to the exact source SHA;
- matching draft: verify every existing asset digest, upload only missing
  assets, then publish;
- matching published release: verify it, then retry Homebrew;
- conflicting tag or asset digest: stop without mutation.

Never delete or replace a published immutable asset. A product or artifact
defect requires the next patch version. Deleting a bad draft is an explicit
manual destructive operation and must be investigated before recovery.

## Browser runtime releases and Latest

The separately sealed Browser runtime currently shares this repository, but it
must never become the app Latest release. Publish it only through:

```bash
pnpm browser-runtime:publish -- \
  --repo junyudev/nodex \
  --tag browser-runtime-v<build> \
  --arm64 <arm64-archive> \
  --x64 <x64-archive>
```

That Interface validates both archives, invokes `gh release create` with
`--verify-tag --latest=false`, and asserts Latest is unchanged. Create and push
the runtime tag at an exact reviewed Nodex source commit first; do not use a
bare `gh release create` for runtime releases.

## Post-release acceptance

For v0.2.0, run:

```bash
gh release view v0.2.0 --repo junyudev/nodex \
  --json tagName,targetCommitish,isDraft,isImmutable,isPrerelease,assets,url
gh release verify v0.2.0 --repo junyudev/nodex
gh api repos/junyudev/nodex/releases/latest --jq .tag_name
gh release download v0.2.0 --repo junyudev/nodex \
  --pattern release-bundle.json --pattern SHA256SUMS \
  --dir .generated/v0.2.0-remote
pnpm release:verify:remote -- \
  --repo junyudev/nodex \
  --bundle .generated/v0.2.0-remote/release-bundle.json
```

Also verify both stable DMG URLs, a clean Apple Silicon install/first launch,
`nodex --version`, one Core-backed project operation, one Agent thread, one
Browser operation, update from v0.1.10, Homebrew install/upgrade, and the
landing download selector. `releases/latest` must be `v0.2.0`, never a Browser
runtime tag.
