# ADR 0027: Window Sessions outlive BrowserWindows

- Status: Accepted
- Date: 2026-07-24
- Owners: Nodex maintainers
- Extends: ADR 0026

## Context

ADR 0026 made panel tabs and layout window-local, but the first implementation
still coupled their durability to an open Electron `BrowserWindow`. Shutdown
kept only the Window Sessions attached to the windows that still existed. A
user who deliberately closed one window could therefore lose that window's
tabs and layout as soon as the app quit, even though closing a native window is
not the same product action as deleting its saved workbench.

The same coupling made native reopen behavior ambiguous. Recreating a fresh
Window Session would preserve data-layer resources but discard the user's view.
Cloning another open window would create new local identities and could not
restore the closed workbench exactly.

## Decision

Window Session catalog v3 separates durable lifecycle from runtime attachment.
Every record has one strict lifecycle:

- `open`: eligible for cold-start restoration;
- `closed`: deliberately dismissed, with a `closedAt` timestamp, and eligible
  for later New Window acquisition.

A `BrowserWindow` is a temporary attachment to exactly one Window Session.
Main fences duplicate Window Session and `webContents` attachments. Focus,
bounds, and layout revisions update the attached record without changing
another window's view.

Main finalizes lifecycle only after Electron emits the definitive `closed`
event. A user close records `closed` after the renderer's bounded close flush
finishes or times out. App quit and unexpected destruction retain `open`, so a
normal restart or crash recovery can restore the window.

Generic New Window acquisition reattaches the most recently closed record
before it considers cloning the active window. Repeated use follows reverse
close order. Reattachment preserves the exact Window Session ID, Browser
scope, Workbench tab and split-tree identities, layout revision, and saved
bounds. It does not clone or synchronize another window. If native window
creation fails, Main rolls the catalog back to the exact closed record.

When no closed record remains, a generic New Window request flushes and clones
the active Window Session with reminted local identities; without an active
source, it creates a fresh Window Session. A targeted `Open in new window`
request is a deliberate fork: it always clones its source with the requested
Session selected and never consumes unrelated closed history. An ordinary
second-instance launch focuses an existing window, while an explicit
`--new-window` launch uses generic New Window acquisition.

Startup restore policies operate only on open records:

- `all` restores every open Window Session;
- `last-window` restores the last active open record and transitions other open
  records into recoverable closed history;
- `none` transitions every open record into recoverable closed history and
  creates one fresh Window Session.

When `all` or `last-window` finds no open record, Main reattaches the most
recently closed record before creating a fresh one. On macOS, activating Nodex
with no open windows follows the same generic New Window acquisition rule.

Existing strict v2 and v1 catalogs migrate to v3 with their records marked
open; the legacy source file remains untouched. Current writes use validated
same-directory atomic replacement, file and directory fsync, and corruption
preservation.

Closed history is bounded rather than immortal. Main keeps the twenty most
recent closed records by default, then evicts the oldest closed records until
the serialized catalog fits a 32 MiB ceiling. Open records are never evicted;
if open records alone exceed the limit, persistence fails explicitly.

## Consequences

- Closing a native window no longer deletes its workbench state.
- Cold-start restoration remains distinct from New Window acquisition and does
  not resurrect every deliberately closed window.
- Reattachment through New Window retains local identities required by
  Browser, editor, tab, and split-tree ownership.
- Fallback and targeted clones remint identities and remain one-time snapshots,
  not live layout subscriptions.
- Closed history has predictable profile-disk bounds and may eventually evict
  the oldest dismissed workbench.
- Lifecycle writes become part of the close/quit reliability boundary and must
  remain atomic with final saved bounds.

## Alternatives rejected

Keeping every closed window in the startup set was rejected because deliberate
close would become meaningless after restart. Deleting the Window Session on
close was rejected because a native window is a presentation attachment, not
the durable workbench aggregate. Reopening by cloning another window was
rejected because it loses exact identity and restores the wrong view. Keeping
unbounded closed history was rejected because tab snapshots and Browser
descriptors can make the profile catalog grow indefinitely. A separate
`Reopen Closed Window` command was rejected because it exposes an internal
unnamed history model and makes ordinary New Window unexpectedly ignore the
workbench the user just closed.
