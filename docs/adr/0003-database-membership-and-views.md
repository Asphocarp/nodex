# ADR 0003: Database capability, Card membership, and durable views

- Status: Superseded in part by ADR 0005
- Date: 2026-07-11
- Owners: Nodex maintainers

## Context

The legacy Kanban model stores workflow status and dense order directly on each Card row. Inline list views inject snapshots of matching Cards into a host editor tree and synchronize edits back through projection controllers. This makes a displayed row look like a second content owner, mixes query results with host content, and prevents the same model from supporting multiple Databases and durable views.

Nodex needs Database behavior without duplicating Cards or treating each visual row as independent content.

## Decision

A Database is a Block with a relational Database capability. Its capability owns typed property definitions, Card memberships, shared view definitions, and view-specific positions.

A Database row is the presentation of an existing Card membership. The row has no duplicate Card identity or body. One active Card may have zero or one owning Database membership. ADR 0005 supersedes this ADR's placement-independent membership rule: an active membership is now the typed placement record for a Card whose exclusive parent is that Database. A linked view or reference does not create membership or change the target Card's parent.

Database property values belong to the membership. Property changes use field/path-level operations. Independent fields merge naturally; stale writes to the same scalar return a typed conflict; set-like values preserve add/remove intent. Card-intrinsic behavior such as execution settings, recurrence, reminders, and agent state remains generic Block properties with typed read models even when a Database View displays it.

A durable Database View stores filter, sort, group, display, and manual position configuration. Board, list, toggle-list, calendar, and canvas views use one Database query Module. Each view owns its fractional manual ordering; content placement and another view's order are unaffected.

Host Documents store only reference Blocks containing stable target IDs or durable `databaseViewId` values. Collapsed rows use Card summary projections. Only expanded and visible rows mount the target Card's independent Document editor. Query results and foreign bodies never become ProseMirror/Yjs children of the host Document.

## Consequences

The same Card can be shown in multiple views without copying content. A second Database and custom properties can be added without changing Card identity. View changes synchronize as relational mutations, while active view/search/selection/expansion remain window-local.

Migration must seed one primary Database Block and one primary Kanban View per Project, map legacy status/properties/order into capability records, and prove normalized parity before cutover. Existing inline snapshots must become references; recoverable orphan snapshots create standalone Cards before being referenced.

The relational implementation uses stable property definitions and values scoped by both membership and Database identity. Composite foreign keys prevent a value from crossing Database or Project scope, and the historical-membership constraint preserves one dormant identity per Card/Database pair. Public membership management compiles to ADR 0005's `BlockTransfer`; `transfer_membership` remains only an internal atomic Database step and is rejected by public Database-mutation transports.

The one-membership constraint is deliberate for the first general model. If future product needs require multiple owning memberships, that decision must supersede this ADR rather than silently treating linked views as memberships.

## Alternatives considered

Copying a Card per Database row creates identity and synchronization conflicts. Storing query rows in a host Y.Doc makes query results durable content and duplicates foreign bodies. Keeping status/order as intrinsic Card columns prevents multiple schemas and view-specific order. These alternatives are rejected.
