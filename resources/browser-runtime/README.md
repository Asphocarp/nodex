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

4. Create and push the dedicated annotated tag at the exact reviewed Nodex
   source commit chosen to own this runtime release. The guarded publisher
   requires the remote tag to exist and will not infer a target from a moving
   branch.
5. Publish both immutable archives only through the guarded publisher:

   ```sh
   pnpm browser-runtime:publish -- \
     --repo junyudev/nodex \
     --tag browser-runtime-v<build> \
     --arm64 .generated/browser-runtime-release/<arm64-asset>.tar.gz \
     --x64 .generated/browser-runtime-release/<x64-asset>.tar.gz
   ```

   This Interface always passes `--latest=false` and verifies that GitHub
   Latest remains the stable Nodex app release. Never use a bare
   `gh release create` for a Browser runtime release.
6. Replace this lock atomically with the printed archive metadata and the
   versions from both generated Browser runtime manifests.
7. Run the Browser runtime conformance test for both release artifacts before
   publishing a Nodex release.

The vendor command accepts an application path only when it is explicitly
provided. This keeps local application state outside the normal build contract.
