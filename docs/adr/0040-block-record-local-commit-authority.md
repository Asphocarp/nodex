# ADR-0040: BlockRecord and LocalCommit authority for Page and Board mutations

- Status: Accepted
- Date: 2026-08-06
- Owner: Core / Page and Board surfaces

## Context

The Page/Board interaction crosses two kinds of durable state: the identity and
placement of a Block, and the rich content presented by the editor. The old
Page/Board path used a Page-owned Document for the editor tree while SQLite
records separately described ownership, Data Source membership, View position,
and Board summaries. A move or promotion could therefore commit correctly and
still remain invisible until a later stream replay or projection reread.

The problem is not solved by adding another renderer refresh. The mutation,
its local durable result, and the projection consumed by the initiating window
must share one causal boundary.

## Decision

For the terminal Page/Board path, Rust Core owns a BlockRecord graph and typed
mutation boundary:

- `BlockRecord` is the stable content identity. Page is `kind = page`; its ID
  remains the Block ID.
- One placement row expresses the owning parent and rank. Placement is the
  authority for Page/Block containment and Data Source ownership; View position
  is presentation state and does not create a second parent.
- Rich content is stored by stable Block ID and slot. Yrs remains useful for
  text concurrency and replay, but a Page-wide Yjs tree is not the structural
  ownership authority for this path.
- `Create`, `Move`, `MoveMany`, `PromoteManyToPage`, `SetMaterializedContent`,
  `ReconcilePageTree`, `Update`, and `ArchiveSubtree` are typed Core
  operations. Validation, rank rebalance, canonical row updates, content
  materialization, and LocalCommit append happen in one SQLite transaction.
- Every successful operation returns the committed envelope, including its
  Store epoch, commit sequence, operation identity, affected records, bounded
  effects, and observed cursor. An operation ID plus intent hash is idempotent;
  a different intent for the same operation ID is a conflict.

The Board and Page renderer paths consume bounded BlockRecord windows. BlockNote
remains the editor, selection, IME, schema, and rendering surface; the
record-backed adapter materializes its nested tree from records and placements.
It must not persist a second structural tree.

## Publication and convergence

The apply response is the initiating window's fast path:

```text
Core transaction commit
  ├─ apply response with the same envelope
  │    └─ Main dispatcher → renderer BlockRecord window
  └─ durable LocalCommit tail
       └─ same envelope → dispatcher identity dedupe
```

The response does not wait for the durable tailer, a projection reread, or a
renderer acknowledgement. The tailer remains the crash/restart replay path.
Dispatcher admission is identity-based, so an out-of-order `N+1` response does
not cause `N` to be skipped. A later duplicate may enrich a sparse envelope,
but cannot regress an already accepted canonical cursor. A projection gap or
missing bounded effect requests a canonical reread at the required cursor.

The Board may publish its canonical BlockRecord projection as soon as that
window is loaded. The older View row windows are now metadata and pagination
enrichment only; they do not overwrite the canonical card projection. The
production registry has no old-summary fallback when the canonical
BlockRecord read fails. An isolated legacy-only test adapter may still model
the old read contract, but it is not a production authority.

## User-facing operations

For a record-backed editor, `Move to → Page` flushes the active editor before
submitting the typed move, so the content mutation and relocation cannot race.
For an ordinary canonical Block, `Move to → Board` uses the same transfer
boundary as an external editor drop: the source Block IDs are read, the target
Data Source/View is resolved, and one `PromoteManyToPage` commit changes kind,
placement, membership, View position, and title projection. Descendant IDs and
content shard identity remain stable; the operation does not copy a Page
document or re-create a child subtree.

An already-Page root is not a promotion. Until the remaining Page copy and
Page-placement writers are cut over, an already-Page or legacy-created root is
deliberately handled by the existing Library transfer adapter; it is never
fabricated into a BlockRecord promotion or admitted as an orphan canonical
record. This is an explicit current-slice boundary, not the terminal model:
the final replacement removes that route and moves existing Page roots with
the same BlockRecord placement kernel.

## Scope and follow-up

This ADR governs the shipped Page/Board terminal slice. Canvas scene data keeps
its scene-native authority, and history/search/embedded surfaces that still use
the older Document adapters must migrate through their own typed adapters
before their old paths are removed. They must not write Page/Board ownership
or invent a second LocalCommit cursor. The next cutover work is to route those
domain writers through the same Core transaction/commit boundary, then remove
the remaining Page-wide structural Document runtime and its old public write
routes in one schema replacement.

Schema versions 102–105 install and validate the current BlockRecord,
materialized content, View-position, and lifecycle tables. This is an internal
development cutover, not a user-data compatibility promise; the final store
replacement must still publish one schema/fingerprint once all remaining
domain adapters are converted.

## Consequences

- A successful local Move or promotion is visible from the same commit result;
  renderer correctness no longer depends on a refresh race.
- Moving a root with many children changes placement/type/membership rows and a
  bounded effect, rather than serializing and copying the whole subtree.
- Board reads can batch Page records and title slots without hydrating Page
  bodies or doing one IPC/SQL round trip per Block.
- Content concurrency remains available through Yrs, while ownership and
  membership get relational CAS and cycle validation.
- The current mutation kernel still performs a bounded graph validation pass;
  large-library graph indexing and the remaining domain-writer cutover are
  follow-up work, not reasons to reintroduce renderer optimism.

## Superseded assumptions

For the Page/Board terminal path, this ADR supersedes the assumptions in
ADR-0002 and ADR-0004 that Page structural ownership is persisted by a
Page-owned Yjs tree and that cross-surface visibility is repaired by document
fanout followed by projection refresh. Their Yrs replay, content validation,
and Canvas-specific portions remain reusable where this ADR explicitly leaves
them in scope.
