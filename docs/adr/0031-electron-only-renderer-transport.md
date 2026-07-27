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
Owned Electron windows map raster images to a read-only `nodex-asset:` protocol
registered only on the default app session. Asset mutation, byte reads, bounded
previews, path resolution, and dictation use sender-validated typed IPC.
Browser-sidebar webviews retain their separate session and receive neither the
asset protocol handler nor privileged preload capabilities.

The private authenticated Core Unix-socket protocol remains unchanged.

## Consequences

- Distinct `NODEX_HOME` profiles can run concurrently without coordinating a
  Desktop Host TCP port.
- Renderer capabilities have one typed adapter and one authorization boundary.
- The Browser sidebar remains supported, but opening the renderer as a normal
  browser page is not a product mode.
- Text, HTML, script, SVG, arbitrary paths, directories, and symlinks are never
  served by the managed-image protocol.
- Existing stored asset references require no migration.

This decision supersedes only public loopback/browser-parity statements in ADRs
0006, 0010, 0017, 0023, 0024, and 0028. Their domain, data-authority, cursor,
projection, and bounded-read decisions remain in force.
