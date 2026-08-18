# Agent runtime supply chain

`openinterpreter.lock.json` is the complete source and artifact contract for
Nodex's primary app-server. It deliberately separates three identities:

- `source.repository` and the full `source.commit` identify the immutable
  upstream tree;
- ordered `source.patches` identify every reviewed local build correction by
  repository path, packaged evidence path, and SHA-256;
- `release.repository` and `release.tag` identify the immutable dual-architecture
  archives consumed by development, CI, and packaging.

The lock also binds every archive's size and SHA-256, the staged metadata hash,
the package layout, third-party notices, and the generated experimental
app-server schema fingerprint. A runtime upgrade is incomplete until both macOS
architectures pass staging and the app-server conformance probes.

Normal installs carry no parallel official Codex npm package or protocol
snapshot. When `codexCompatibilityVersion` changes, rebuild and relock the Open
Interpreter artifacts, regenerate the committed protocol package from that
runtime, and run `pnpm run verify:runtime:mac`.

## Upgrade procedure

Prefer an immutable upstream Open Interpreter release when its tag resolves to
the reviewed source commit and it publishes both required macOS package
archives. Verify each package manifest, required artifact, archive size and
SHA-256, then update the lock and stage both architectures. Keep
`source.patches` empty when the release already contains every required fix.

Build and publish a Nodex-owned runtime only when the reviewed source needs a
local patch or upstream does not provide the required package closure.

Clone `source.repository` into a disposable directory, detach at the exact
`source.commit`, verify the clean tree, then apply `source.patches` in listed
order with `git apply`. Use Python 3.10 or later and the upstream package
builder once per target:

```bash
python3 scripts/build_codex_package.py \
  --target aarch64-apple-darwin \
  --variant open-interpreter \
  --cargo-profile release \
  --package-dir <arm64-package-directory> \
  --archive-output <arm64-archive> \
  --force

python3 scripts/build_codex_package.py \
  --target x86_64-apple-darwin \
  --variant open-interpreter \
  --cargo-profile release \
  --package-dir <x64-package-directory> \
  --archive-output <x64-archive> \
  --force
```

Update the lock from the resulting regular files, stage each local archive, and
run the schema and runtime gates before publication. Create and push the exact
artifact tag at the reviewed Nodex commit, then publish through the guarded
interface:

```bash
pnpm agent-runtime:publish -- \
  --repo <owner/repository> \
  --tag <agent-runtime-vX.Y.Z-8-char-source-commit> \
  --source-commit <40-char-source-commit> \
  --arm64 <arm64-archive> \
  --x64 <x64-archive>
```

The publisher always uses `--verify-tag --latest=false`. After publication,
delete the local download cache, restage from the locked HTTPS URLs, and rerun
`pnpm run verify:runtime:mac` so the shipped path is tested rather than only the
build directory.
