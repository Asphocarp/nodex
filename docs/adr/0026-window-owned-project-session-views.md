# ADR 0026: Project Session views belong to Window Sessions

- Status: Accepted
- Date: 2026-07-23
- Owners: Nodex maintainers
- Extends: ADR 0022 and ADR 0023

## Context

A Project Session is shared execution state: it identifies a Project or
projectless scope, an optional Codex Thread link, title fallback, ordering,
pinning, archive, and unread state. Nodex previously stored the right and bottom
panel trees and every tab row in the same Rust Core aggregate.

That storage boundary made presentation shared. If two app windows selected the
same Project Session, a tab create, close, move, split, resize, maximize, or
selection in one window mutated SQLite and invalidated the other window. This
contradicted the product model in which each window has independent navigation
over shared resources.

Tabs also reference owners with different lifetimes. Page and Database targets
are shared durable resources. Browser guests are Main-owned runtimes with one
window-scoped host identity. Terminal PTYs are Main-owned runtime resources that
cannot safely accept input and geometry from two xterm views simultaneously.
Serializing any of those runtimes into a Session would create a second
authority.

## Decision

Rust Core owns only Project Session domain data and Thread links. The
`ProjectSession` contract contains:

- Session and Project identity;
- nullable `initialDatabaseViewId`;
- fallback and derived display title;
- order, pin, archive, and unread state;
- the optional Thread link and timestamps.

Each Main-persisted Window Session owns a
`WorkbenchSessionViewSnapshot` per Project Session ID. The snapshot contains
strict window-local tab descriptors, the right and bottom split trees,
selection/MRU state, collapse, maximize, size, and a touched timestamp. Panel
trees are the only source of tab placement and order. Shared Core events may
refresh the targets rendered by those descriptors, but never apply another
window's view patch.

`initialDatabaseViewId` is a semantic first-materialization target, not layout.
A window that has never materialized a newly created Project Session may create
one local Database View tab from it. Once a local view record exists, an empty
view remains intentionally empty.

Window Session catalog v2 persists Workbench layout v3 with a monotonic
`layoutRevision`. Main validates that the sender owns the Window Session,
rejects stale saves, and writes the catalog with same-directory atomic
replacement and fsync. When no closed Window Session awaits reattachment,
creating a new window flushes and clones the requesting window's saved layout
as a starting snapshot. Tab, leaf, branch, Browser, and editor-view identities
are reminted; the clone is not a subscription. ADR 0027 defines the durable
closed-history acquisition that precedes this fallback clone.

Browser runtime identity is scoped by Window Session. A cloned Browser
descriptor receives a new Browser runtime initialized from the source URL and
presentation metadata while the Profile browser partition continues to share
cookies and storage.

A Terminal descriptor may reference the same PTY from more than one Window
Session, but Main grants one explicit interactive view lease at a time. Closing
a local Terminal tab releases its lease without killing the PTY. Another window
may explicitly take over. Backend exit, `Kill terminal`, Project runtime
cleanup, or app shutdown destroys the PTY and publishes terminal exit.

Fork and new-window Browser transfer receive the exact initiating Window
Session view context. Main validates source and target scopes, remints runtime
and descriptor identity, and returns a local transfer snapshot; it never
reconstructs or writes tabs through Core.

Core schema v90 removes `project_session_tabs`,
`project_sessions.panel_state_json`, and
`project_sessions.left_pane_collapsed`. Migration preserves Session, Thread,
Project, and content data and at most one valid Database View as
`initial_database_view_id`; the formerly shared arrangement is intentionally
discarded because no historical window owner can be inferred. Public HTTP and
Electron IPC tab/panel mutation APIs are removed.

## Consequences

- Two windows can present the same Project Session differently while Page,
  Database, Session, and Thread changes still converge through their existing
  authorities.
- Core no longer retains Pages merely because a desktop view once opened them.
- A threadless starter Session is identified by domain state, not by whether one
  window currently has tabs.
- New-window cloning is explicit copy-on-create behavior. Subsequent layout
  mutations are independent.
- Browser host stealing is prevented by Window Session scope.
- Terminal contention is visible and recoverable through lease status and
  takeover instead of being an implicit owner mismatch.
- Window Session files become part of the cold-restore reliability boundary and
  require strict codecs, ordering evidence, bounded payloads, and atomic writes.

## Alternatives rejected

Adding a window ID to Core tab rows was rejected because it would make the
shared data authority store desktop scene state. Retaining a Core mirror was
rejected because two writable owners would require reconciliation. Synchronizing
only active-tab selection was rejected because creation, deletion, order,
splits, geometry, previews, and runtime attachment are one view aggregate.
Copying historical shared layouts into every window was rejected because it
would preserve the ownership error as migration state.
