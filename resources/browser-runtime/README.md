# Browser runtime release

Nodex builds consume the Browser runtime exclusively through
`browser-runtime.lock.json`. Each architecture-specific archive is immutable and
bound by its byte size, archive SHA-256, inner manifest SHA-256, source desktop
build, Browser plugin version, Codex compatibility version, and component
versions.

Normal development, CI, and packaging must use
`pnpm run materialize:browser-runtime:mac`. They must not inspect an installed
desktop application.

Updating the runtime is an explicit maintainer workflow:

1. Obtain the intended signed desktop builds for both macOS architectures.
2. Run the following separately for `arm64` and `x64`, using the Codex
   compatibility version pinned by the Agent runtime lock:

   ```sh
   pnpm run browser-runtime:vendor -- \
     --app <ChatGPT.app> \
     --codex-compatibility-version <version> \
     --target-arch <arm64|x64> \
     --out .generated/browser-runtime-vendor/<arch>
   ```

3. Seal each prepared closure:

   ```sh
   pnpm run browser-runtime:archive -- \
     --source .generated/browser-runtime-vendor/<arch> \
     --out .generated/browser-runtime-release/<asset>.tar.gz
   ```

4. Publish both immutable archives under a dedicated release tag.
5. Replace this lock atomically with the printed archive metadata and the
   versions from both generated Browser runtime manifests.
6. Run the Browser runtime conformance test for both release artifacts before
   publishing a Nodex release.

The vendor command accepts an application path only when it is explicitly
provided. This keeps local application state outside the normal build contract.
