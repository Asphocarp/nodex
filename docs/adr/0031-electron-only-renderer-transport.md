# ADR 0031: Electron-only renderer transport

## Status

Accepted

## Context

Nodex ships an Electron desktop renderer and a native CLI. The Desktop Host also
started an unauthenticated loopback HTTP server and maintained a second browser
renderer transport, although no standalone browser client was packaged. That
parallel path duplicated IPC adapters and event streams, exposed profile data on
a fixed TCP port, and prevented independently scoped development and production
profiles from starting together when both selected the default port.

The detached Rust Core is a different boundary. It uses an authenticated private
protocol over a `NODEX_HOME`-scoped Unix domain socket and remains the shared data
authority for Electron Main and the native CLI.

## Decision

Nodex supports one desktop renderer transport: typed Electron IPC exposed
through the context-isolated preload bridge. The public loopback HTTP API and
standalone browser renderer transport are removed.

Managed asset identities remain portable `nodex://assets/<file>` references.
Owned Electron windows resolve those identities to absolute paths through the
sender-validated preload bridge, then use the same `app://fs` display transport
as other trusted local image, audio, and video sources. One privileged `app:`
handler owns both packaged renderer files under `app://-` and local media under
`app://fs`; an origin gate admits only the app renderer or its exact configured
HTTP(S) development origin for filesystem requests. Asset mutation, byte reads,
bounded previews, path resolution, and dictation remain sender-validated typed
IPC. Browser-sidebar webviews retain their separate session and receive neither
the filesystem display transport nor privileged preload capabilities.

The private authenticated Core Unix-socket protocol remains unchanged.

## Consequences

- Distinct `NODEX_HOME` profiles can run concurrently without coordinating a
  Desktop Host TCP port.
- Renderer capabilities have one typed adapter and one authorization boundary.
- The Browser sidebar remains supported, but opening the renderer as a normal
  browser page is not a product mode.
- Local display URLs are ephemeral renderer values. Durable state continues to
  store managed locators or source paths rather than `app:` or development
  `/@fs` URLs.
- The filesystem display route accepts extension-addressed image, audio, and
  video MIME families, including SVG, and follows filesystem symlinks. It is an
  app-renderer transport boundary rather than a managed-asset authorization
  model.
- Existing stored asset references require no migration.

This decision supersedes only public loopback/browser-parity statements in ADRs
0006, 0010, 0017, 0023, 0024, and 0028. Their domain, data-authority, cursor,
projection, and bounded-read decisions remain in force.
