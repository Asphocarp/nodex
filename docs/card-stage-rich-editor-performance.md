# Card Stage Rich Editor Performance

This document defines the performance and durability contract for Card Stage after the Block-first cutover. A Card is the product name for a document-bearing Block. Its title and body are edited directly in one collaborative Y.Doc; NFM and Card detail payloads are projections, never editor state authority.

## Authority Boundary

Every Card owns one registered `nodex.card@2` Document with exactly:

- `Y.Text("title")` for the canonical rich title, using the validated portable-rich Delta subset.
- `Y.XmlFragment("body")` for the BlockNote-compatible body tree.

`CardStage` prepares the exact `(projectId, cardBlockId)` owned descriptor and mounts `BlockDocumentSurface` only when the descriptor is ready, schema-compatible, and `ydoc_primary`. `NfmEditor` receives the live body fragment; `CollaborativeCardTitle` receives the live title. Neither component receives a serialized body callback for persistence.

Each mounted writable surface creates a fresh Y.Doc/client session, including two windows opened by the same user. Local transactions appear immediately, remote transactions merge through Yjs, and only the local surface's tracked origins enter its undo manager.

## Typing Hot Path

An ordinary title or body edit stays inside Yjs and ProseMirror:

1. The editor applies the local transaction immediately.
2. `NodexYProvider` captures the binary incremental update.
3. Pending updates are sent sequentially to the Block mutation worker and may be merged while queued.
4. SQLite validates and commits the update, head, Block registry/index, exact-head materialization, search/assets, receipt, and change evidence atomically.
5. The provider clears pending state only after the durable ACK; other subscribed surfaces receive the committed update.

The hot path does not serialize the complete body to NFM, update a React `description` draft, replace the BlockNote tree from Card props, or send a whole-Card mutation. This removes both the historical per-keystroke serialization cost and the last-writer-wins snapshot seam.

Editor-local derived features may observe BlockNote transactions for selection, heading navigation, search, menus, or UI state. They must not turn those observations into a content save payload.

## Provider and Writer

`BlockDocumentSurfaceRuntime` owns the surface Y.Doc, `NodexYProvider`, lifecycle preparation, disposable checkpoint boundary, and status projection. Electron IPC and browser HTTP/SSE implement the same Document contract:

- subscribe before the state-vector handshake;
- submit idempotent binary updates scoped by `storeEpoch`, Document generation, update ID, and client session;
- acknowledge only after SQLite commit;
- fan out only durable first commits;
- repair missed, duplicated, or reordered events with state-vector synchronization.

The main process coordinates this asynchronously. Synchronous `better-sqlite3` work runs in the single `BlockMutationWriter` worker, never in an IPC/HTTP handler and never in one worker per Document. The worker's bounded Y.Doc cache is validated against SQLite coordinates and swapped only after commit.

If validation or persistence fails, the provider remains pending/failed and exposes retry or reload. There is no synchronous main-process fallback and no snapshot overwrite action.

## Sync Status

Fast successful updates are visually quiet. `BlockDocumentSyncStatus` surfaces only actionable or sustained states:

- pending beyond the configured grace period;
- offline/retrying;
- validation or persistence error;
- store reset or recovery-required reload;
- temporary write freeze for a structural fence.

“Saved” means the newest submitted update has a durable SQLite acknowledgement. Awareness/presence is advisory and memory-only; it is not a write lock or durability signal.

## Card and Board Read Models

High-frequency Board state uses `BoardSummary`. Each Card summary contains bounded title/preview/property data assembled from:

- the exact current Document materialization for title/body preview;
- Block lifecycle and revisions;
- Database membership, typed property values, and View position;
- intrinsic Block properties.

Full bodies never enter the shared Board snapshot. Card detail, reference summaries, notification summaries, Calendar, and search are separate read projections and must reject stale Document/property coordinates. A committed Document event can patch summary caches, but no summary or detail payload may seed or refresh an already mounted editor.

This is a one-way graph:

```text
Y.Doc + Block/Database authority
  -> exact-head materializations and read models
  -> Board/Card/reference/search UI
```

No arrow returns from a projection to an existing Y.Doc.

## NFM Boundary

NFM remains the public text interchange and read format. Full serialization is appropriate only for:

- materialization/export after a validated Document transaction;
- raw read-only display;
- sending selected/current content to another product surface;
- genesis import during creation or shipped-store finalization;
- explicit `ReplaceDocumentFromNfm` with current generation/head CAS.

Explicit replacement parses NFM and compiles stable-ID operations against the current Y.Doc. It creates a forward Yjs update; it does not replace the Y.Doc, reset causal history, or write NFM directly as authority.

## Lifecycle and Close

Card Stage panel tabs may retain their mounted editor while their panel leaf remains mounted. Tab switching should preserve the ProseMirror instance, selection, local undo stack, plugin state, and native scroll position. An inactive retained surface may remain a content subscriber but must clear Awareness, stay ref-passive for shell-owned close/persist handles, and remain excluded from document-wide editor hover and drag/drop routing even though layout-preserving parking keeps its DOM geometry measurable.

Persist/close follows a bounded Document lifecycle:

1. run registered surface preparation (including IME and pending managed-asset work);
2. ask the provider to flush pending updates;
3. checkpoint unresolved local state only in the disposable `(documentId, storeEpoch, generation)` cache;
4. return within the bounded close deadline.

A checkpoint is recovery data, not authority. On reopen it is validated in a detached Y.Doc and only missing CRDT state may replay. Store restore rotates `storeEpoch`, invalidates old providers, and clears/rejects the old cache so pre-restore edits cannot contaminate the installed backup.

## Structural Operations

Normal same-Document edits use Yjs transactions. Identity-destructive operations and cross-Document moves require stronger coordination:

- same-Document move: one editor/Yjs transaction;
- stable-ID Agent update/delete/move: a Hub-issued short write fence;
- cross-Document move: one relocation lease covering source and target;
- whole-Document restore/import: current-head CAS plus the same trusted fence.

Mounted surfaces complete IME, durably flush, ACK, and freeze briefly. The writer then validates fresh heads and commits every affected update, registry location, projection, history, and immutable receipt in one SQLite transaction. A pre-commit failure leaves the old state; a post-commit delivery gap repairs through receipt and state-vector resync.

Clients never construct durable fence proof themselves. A stale/offline update overlapping moved or invalidated Block IDs becomes typed recovery evidence and forces reload instead of creating ghost content.

## Reference-Only Surfaces

Card and Database View references are childless Blocks. A collapsed row renders only a summary. Expanding a visible Card reference mounts the target Card's own `BlockDocumentSurface`; the target body never becomes children of the host Y.Doc.

Nested surfaces are lazy and bounded by a renderer activation budget. Expansion, visibility, selection, and presence are window-local. An ancestry guard prevents direct or indirect recursive expansion.

## Invariants

- Card title/body authority is the owned Y.Doc, not `Card` props, NFM, Board state, or a renderer draft.
- An ordinary editor transaction must not serialize or submit the whole body.
- Every writable mount owns a distinct Yjs client/session identity.
- A durable ACK is emitted only after the SQLite transaction commits.
- Remote updates do not echo and do not enter local undo.
- Card/Board read-model updates never call `replaceBlocks` on an existing surface.
- There is no whole-Card title/body conflict overwrite path.
- NFM replacement is explicit, exact-head gated, and produces a forward update.
- Block/Card writes go through `BlockMutationWriter`; main-process handlers do not run synchronous Card transactions.
- Board caches remain summary-only and full bodies load only through explicit scoped reads or mounted Documents.
- Reference surfaces never store a foreign body in their host Document.
- Retained inactive tabs clear Awareness and do not own active shell refs.
- Restore/store-reset boundaries reject old epoch checkpoints and outboxes.

## Testing Expectations

Meaningful regression coverage belongs at behavior boundaries:

- `nodex-y-provider.test.ts`: convergence, duplicate/out-of-order updates, durable ACK ordering, retry, checkpoint recovery, and epoch reset.
- `block-document-surface.test.tsx` and runtime tests: descriptor validation, subscribe/sync before mount, bounded persist/close, reload, and inactive Awareness.
- collaborative title and Card Stage component tests: direct Y.Text/body binding, local undo ownership, retained-tab identity, and fail-closed descriptor errors.
- DocumentStore/worker tests: snapshot+tail reconstruction, schema/identity validation, atomic materialization/index commit, cache eviction, and worker failure.
- relocation/Document operation tests: leases, exact-head conflicts, fault injection, stale update recovery, and all-old/all-new outcomes.
- Board/read-model tests: exact-head summary projection, bounded payloads, and rejection of stale projections.
- reference surface tests: idle collapsed rows create no provider; explicit Card-title engagement or expanded visibility mounts only the target Document within the provider cap; cycles remain navigation-only.

Use Storybook and manual multi-window review for sync/error chrome and retained editor UX. Do not add tests that merely assert styling strings.

## When Extending Card Stage

Ask which owner the feature belongs to:

- collaborative content -> Yjs transaction in the owning Document;
- lifecycle/property/membership -> typed Block or Database mutation;
- export/import -> explicit NFM boundary;
- reference expansion -> lazy target Document surface;
- selection/search/open state -> window-local UI;
- history -> immutable checkpoint/evidence plus forward restore.

If a proposed path needs `Card.description` to refresh a mounted editor or needs to submit the complete body after a keystroke, it violates this contract.
