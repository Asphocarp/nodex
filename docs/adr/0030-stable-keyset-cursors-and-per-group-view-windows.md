# ADR 0030: Keyset cursors survive data mutations; grouped Views page per group

- Status: Accepted
- Date: 2026-07-27
- Owners: Nodex maintainers
- Extends: ADR 0028 and ADR 0029 (revises ADR 0028's cursor revision fence)

## Context

ADR 0028 introduced bounded keyset windows with HMAC-signed cursors. The first
implementation embedded a `projection_revision` in every cursor and required
exact equality on decode. That revision was the profile-global `change_log`
head, so any write anywhere in the store — a Document autosave, an app-server
thread sync, an automation heartbeat, the retention planner — invalidated every
outstanding cursor in every module. Clicking `Show more` while anything wrote
in the background failed with `Collection changed while its windows were being
read`, the renderer surfaced the raw string as a full-view error, and an agent
paginating a large Database could never finish while the app was running: a
livelock, not a safety property.

The fence was also redundant. The three real invalidation classes already had
independent fences: query-shape changes are covered by the query fingerprint
(the View config, including any group scope, is hashed into it), restores and
migrations are covered by the Store epoch, and tampering is covered by the
HMAC. Data mutations — the only thing the revision fence actually reacted to —
are precisely what keyset pagination tolerates by construction, because a
cursor is a coordinate in a stable total order, not a snapshot claim.

Separately, the Database View window was a single flat window in group-major
order. A 200-row first window filled early board columns and left later
columns falsely empty, one full-width `Show more` bar under the whole board
grew a global window, refreshes reset loaded rows back to 50, and column count
badges reported loaded-window sizes as if they were totals.

## Decision

Cursor payloads (version 2) carry no data revision and decode does not compare
one. A continuation stays valid while data mutates; loaded windows converge
through projection invalidation, and per-identity de-duplication absorbs rows
that move across window boundaries. A cursor is rejected only for
signature/shape failures, a query-fingerprint mismatch, a Store-epoch rotation,
or a payload-version change — and every consumer treats any rejection as
disposable read state: drop the cursor and silently re-read the loaded span
from the first window. Cursor rejections are never user-facing errors.
`CollectionWindowAuthority.projection_revision` remains in responses as an
ordering/diagnostic signal only.

Grouped Database Views page per group. One effective-group SQL expression —
explicit board position group first, otherwise the grouping Property value
normalized so NULL, empty strings, and empty lists mean "unassigned"; numbers,
booleans, and composite values group by canonical JSON text — is the single
source of truth for the summary projection, the effective-group-major total
order, `group_scope` window predicates, and the bounded `view_groups` totals
read (at most 200 groups plus a truncation flag, counts derived from the same
candidate predicate as the windows). Group scopes therefore partition the View
exactly, scoped windows are restrictions of the flat order, and totals always
agree with scoped traversal. Cursor fingerprints include the scope, isolating
each column's continuation.

The renderer kanban store owns one window per group and composes them for the
existing render pipeline. Columns page independently through in-flow
`Show N more` rows, header badges report true group totals, refreshes re-read
each loaded group's span (`first = clamp(loaded, 50, 200)`) instead of
resetting it, and Core-backed read channels carry typed error envelopes so the
store classifies cursor rejections without matching message text.

## Consequences

Pagination is livelock-free under concurrent writers, for users and for
agents. Boards paint balanced first windows per column, and a partially loaded
column can no longer masquerade as empty or short. The cost is that a window
chain is not a global snapshot: between invalidation refreshes, a reader can
briefly observe a row twice (de-duplicated by identity) or miss a row that
moved behind its cursor, exactly the semantics AIP-158-style page tokens
promise. Consumers that need stronger guarantees must read identities, not
windows.
