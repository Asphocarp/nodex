# ADR 0010: Card Detail is independent from Database membership

- Status: Superseded by ADR 0017
- Date: 2026-07-14
- Owners: Nodex maintainers
- Extends: ADR 0001, ADR 0003, ADR 0006, and ADR 0007

## Context

Card is Nodex's user-facing name for a document-bearing Block. Its stable Block identity, location, lifecycle, rich title, body, and intrinsic execution properties exist independently from any Database. A Card may be placed directly in a Space, nested in another Card Document, or parented by one Database. Only the last form is a Database row.

The first Block-first cutover introduced a membership-independent `CardTargetReadModel` for collapsed and expanded `card` and `cardRef` Blocks, but Card Stage continued to open through the compatibility `card:get` route. That route calls `readDatabaseCardById`, whose product shape requires an active Database membership and a position in the primary Kanban View. Consequently, a valid Document-parented Card can render and edit inline, yet opening the same Block in Card Stage fails with “is not an active Database row.”

This is not a synchronization or Document-readiness failure. It is an authority-boundary error: a Database-row projection is being used as the existence test for the Card itself. Filling absent fields with a synthetic `draft` status, restoring a dormant membership, or copying the embedded projection into a new Document would create false authority and violate exclusive Card parenting.

## Decision

### Card Detail is the membership-independent product read model

Nodex will expose one validated `CardDetail` contract for opening a Card. It is assembled in one SQLite read transaction from the Card Block, its owned Document and exact-head content materialization, its intrinsic Block properties, and an optional active Database context.

`CardDetail` contains:

- stable Card Block identity, Project, lifecycle, parent location, location revision, metadata revision, and timestamps;
- owned Document identity, generation, head sequence, authority, readiness, schema key, and schema version;
- exact-head rich-title/plain-title/preview/plain-text projection used only for bounded reads and loading UI, never to initialize an existing Y.Doc;
- intrinsic Card property coordinates and values for schedule behavior, recurrence, reminders, Agent state, and run target configuration;
- a discriminated `databaseContext` union whose `standalone` branch has no Database values, and whose `member` branch carries the active membership coordinate plus the Database property coordinates needed by the current Card Stage compatibility property controls.

The contract does not introduce a `Page` type or table. Card remains the user vocabulary and a specialized read model over Block/Document authority.

ADR 0013 supersedes only the Agent-state portion of the intrinsic property bullet above. Schedule, recurrence, reminders, and run-target configuration remain in Card Detail.

### Database rows remain an explicitly bounded projection

The existing wide `Card` model remains a Database-row projection while board, calendar, scheduler, and current compatibility mutations still require its seeded property vocabulary. Its readers and renderer caches must be explicitly named as Database-row facilities. `readDatabaseCardById` and batched Database-row reads may reject Cards without active membership because membership is a precondition of those callers, but `card:get` and Card Stage must not call them.

The public `card:get` command returns `CardDetail`. Database-row consumers use an explicitly named `database-row:get` command. Browser HTTP and Electron IPC must expose the same success, not-found, corrupt-state, and unavailable behavior. No transport may collapse a server error into a misleading `null`.

### Card Stage composes core Card behavior with optional Database capability

Card Stage always mounts the Card's prepared owned Document using `OwnedBlockDocumentBoundary` and `BlockDocumentSurface`. Its title, body, sync runtime, local undo scope, history, terminal actions, linked threads, and intrinsic Agent/run controls are available for every active Card.

ADR 0013 supersedes the intrinsic Agent-state controls in the preceding sentence. Run-target controls remain Card configuration; live execution state is owned by Thread/session runtime.

Database-only controls are rendered only for `databaseContext.kind === "member"`. These currently include status, priority, estimate, tags, assignee, due date, scheduled start/end, and occurrence actions. A standalone or nested Card shows no fabricated values or disabled imitation of Database properties. Adding it to a Database is a separate explicit Block transfer, not a property edit or an Open Card side effect.

Membership changes update only the optional capability. They do not change the Card Block ID or owned Document ID, and they must not remount the Y.Doc provider or reset the local undo runtime.

### Mutations follow the same capability boundary

Intrinsic property mutations use the generic Block property kernel for both standalone and Database-member Cards. Database property mutations require the exact membership/property coordinate and are unavailable when the Card is standalone. Canonical reads following either mutation use `CardDetail` for Card Stage and explicit Database-row reads for board compatibility; they do not force a standalone Card through a row Adapter.

Database status changes and occurrence actions remain membership-gated Database operations. Card deletion is location-aware: a Database-member Card may use the existing Database lifecycle path, while a Document-parented Card requires an atomic ownership mutation that removes its shell from the containing Document and tombstones the Card/owned-Document closure. Until that command exists, Card Stage must not expose an action that routes a nested Card through Kanban deletion.

### Query invalidation follows Card authority, not board visibility

The Card Detail renderer store is keyed by Project and Card Block ID. Freshness is derived from Block metadata/location revisions, Document generation/head sequence, and the optional membership coordinate. Absence from `useKanban().cardIndex` never means the Card is missing. Board summaries may seed or invalidate Database-row caches, but they are not the existence authority for Card Stage.

## Consequences

A nested Card can open in its own tab and edit the same Y.Doc as its embedded surface. Standalone Cards retain intrinsic execution behavior without acquiring false Database status. Card Stage becomes a reusable Card surface instead of a Kanban detail modal with an editor attached.

The change adds a temporary translation boundary because the board and scheduler still consume the wide Database-row `Card`. That boundary is intentionally explicit and one-way. Future Database-property generalization can replace the current seeded field projection without changing Card identity or Document loading.

The migration retires the misleading renderer Database-row `card-detail-store` name and `cards:details:get` command. Compatibility reads are now `database-row-detail-store`, `database-row:get`, and `database-rows:details:get`; `card:get` is reserved for Card Detail. Tests prove behavior rather than source strings: a Document-parented Card with a dormant membership opens successfully, Database controls are absent, intrinsic mutation succeeds, and Database-only mutation is rejected or unavailable.

## Rejected alternatives

- Automatically reactivate the last membership when Card Stage opens. Opening content must not mutate ownership.
- Give every standalone Card a hidden primary-Database membership. This would make nested ownership and Database ownership simultaneous and destroy the exclusive-parent invariant.
- Fill `status`, `tags`, ordering, or dates with defaults. Those values would look authoritative without a Database/property coordinate and would later conflict with a real transfer.
- Catch the row error in the renderer and continue from `CardTargetReadModel`. This opens the body but leaves property, delete, lifecycle, and canonical reread paths connected to the wrong authority.
- Rebuild or seed the Y.Doc from NFM/materialized content. The existing owned Document is authoritative and must be mounted by identity.
