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
- `Batch`, `Create`, `Move`, `MoveMany`, `CopySubtree`, `PromoteManyToPage`,
  `PlaceManyInDataSource`, `SetMaterializedContent`,
  `ReconcilePageTree`, `Update`, `ArchiveSubtree`, and `RestoreSubtree` are
  typed Core
  operations. Validation, rank rebalance, canonical row updates, content
  materialization, and LocalCommit append happen in one SQLite transaction.
- `Batch` is a finite, non-nesting composition of the same typed operations.
  Child operations are applied in order against the prepared graph and share
  one receipt/LocalCommit; callers must not emulate a cross-domain mutation by
  awaiting several independent applies.
- `RestoreSubtree` carries any sibling placement rebalances in the same
  operation. Restoring an archived Page never needs to reject a dense rank
  space or split ordering into a second write.
- Archive parks the existing placement under a Block-specific private rank and
  retains View positions. Active reads exclude the archived lifecycle, while a
  parent-first Restore reactivates the same records and placement edges. This
  keeps recovery inside the same ownership authority instead of introducing an
  archive-only copy of the subtree.
- Every successful operation returns the committed envelope, including its
  Store epoch, commit sequence, operation identity, affected records, bounded
  effects, and observed cursor. An operation ID plus intent hash is idempotent;
  a different intent for the same operation ID is a conflict.
- Agent Page mutations carry the frozen Turn authorization alongside the
  typed operation. Core derives the required source and destination resource
  actions from the operation itself and validates them inside the same writer
  transaction before applying the mutation; Main cannot turn a preparation
  result into an unbounded write capability.

Library New Page is compiled into this same `Create` operation. Its title is
the initial `title` content slot and its Library/Page parent is the owning
placement; the Library adapter returns the BlockRecord commit cursor as the
operation receipt. Library navigation and Page Detail have a canonical
BlockRecord read path for this result, so Document genesis is not a local UI
completion prerequisite.

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
The dispatcher keeps a bounded recent identity window. It only compacts entries
that the durable tailer has crossed; apply-only entries remain remembered until
that confirmation, and a late response for an older compacted cursor is treated
as a duplicate against the durable ledger rather than delivered again.

The Board may publish its canonical BlockRecord projection as soon as that
window is loaded. The older View row windows are now metadata and pagination
enrichment only; they do not overwrite the canonical card projection. The
production registry has no old-summary fallback when the canonical
BlockRecord read fails. An isolated legacy-only test adapter may still model
the old read contract, but it is not a production authority.

## User-facing operations

For a record-backed editor, `Move to → Page` flushes the active editor before
submitting the typed move, so the content mutation and relocation cannot race.
The lifecycle transport used by Page menus follows the same rule for
archive/unarchive/top-level reorder: its legacy receipt envelope is an adapter
shape only, while the durable writer is `ArchiveSubtree`, `RestoreSubtree`, or
`MoveMany` and the receipt identifies the record-backed Page authority.
For an ordinary canonical Block, `Move to → Board` uses the same transfer
boundary as an external editor drop: the source Block IDs are read, the target
Data Source/View is resolved, and one `PromoteManyToPage` commit changes kind,
placement, membership, View position, and title projection. For an existing
canonical Page, the same boundary uses `PlaceManyInDataSource` and changes
only owning placement, membership, and View position. Descendant IDs and
content shard identity remain stable; neither operation copies a Page document
or re-creates a child subtree.

Canonical Page/Block copy uses `CopySubtree`. Core validates the complete
owning closure and source revisions, copies only the current content snapshots
into fresh Block IDs, and commits all new placements, content rows, and an
optional Board View position in one LocalCommit. The copy therefore has
independent future content history without introducing a second structural
Document.

Library Move, Archive, and Restore of a canonical Page use the same typed
BlockRecord boundary. The adapter validates the observed placement or metadata
revision against its local snapshot and returns the resulting LocalCommit
cursor, so these menu actions do not wait for the legacy Page event stream.

An already-Page root is therefore never a promotion. On opening a current
development store, Core claims any active legacy-created Block IDs that still
lack a BlockRecord in a repeatable local conversion transaction; existing
canonical records and content revisions are not rewritten. The final store
replacement still removes the legacy tables and runtime writer, so an
unconverted root is a corruption/conversion failure rather than a reason to
silently fall back to the old Page transfer writer.

## Scope and follow-up

This ADR governs the shipped Page/Board terminal slice. Canvas scene data keeps
its scene-native authority, and history/search/embedded surfaces that still use
the older Document adapters must migrate through their own typed adapters
before their old paths are removed. They must not write Page/Board ownership
or invent a second LocalCommit cursor. The next cutover work is to route those
domain writers through the same Core transaction/commit boundary, then remove
the remaining Page-wide structural Document runtime and its old public write
routes in one schema replacement.

Native Agent Page create, copy, move, update, and fetch now prepare and execute
against an authorized BlockRecord window. The frozen Turn authorization travels
with both read and write requests; Core revalidates the operation-derived
source/target permissions inside the same read or writer transaction. The Agent
command carries canonical Page/Block identities and placement anchors rather
than Document generations or Page-owned heads. Agent search remains a derived
search read and is still scheduled for the search/index closure cutover below;
it must not be treated as a second Page authority.

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
