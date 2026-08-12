# Document Sync, History, and Retention

## Exact live boundary

An exact Document subscription is both authorization and resource routing. Core
installs the addressed live receiver before reading authorization, Store epoch,
engine, generation, Document head, and LocalCommit head from one snapshot. The
resulting barrier guarantees that later addressed commits are buffered or
delivered after canonical synchronization adopts that boundary.

Earlier content comes from the engine's canonical state-vector or scene sync,
not from replaying the global LocalCommit ledger. Receiver lag, Store
replacement, route/payload failure, missing predecessor, or gap-buffer overflow
closes the physical stream and requires a fresh barrier plus canonical sync.
Awareness uses a separate ephemeral addressed channel and cannot crowd the
durable repair lane.

## Page and Block Documents

A Page/Block Document writer applies bounded idempotent Yjs updates against the
current generation and durable head. The writer validates schema, application
Block identity, dependencies, projections, and receipts before commit. The
mounted surface receives acknowledgement only after durable transaction commit.

Each writable surface owns its client identity, local undo origins, selection,
and Awareness contribution. Another surface's or remote transactions converge
visibly without entering local undo. Deactivation clears ephemeral presence and
keeps durable work behind a bounded flush/checkpoint boundary.

Structural operations that consume mounted Document shape first flush pending
updates and carry a typed causal head token. Core rechecks the token with every
owner, membership, and authorization fact in the committing transaction.
Response-loss retry retains the original logical intent; the transient head
proof is not part of idempotent identity.

Cross-Document transfer and copy prepare against isolated clones, then recheck
all captured heads and ownership facts under the writer. Each affected Document
advances at most once. Failure leaves canonical state and reusable base caches
unchanged.

## Canvas Documents

Canvas uses its scene-native engine and normalized element/app-state authority.
The renderer persists pending local scene mutations in a bounded outbox before
transport. Response loss retries the exact row. Deterministic rejection moves
that row to bounded quarantine, resynchronizes canonical scene state, and lets
later edits proceed.

Scene generation, head, file identity, and portable snapshot validation remain
separate. Remote repair never guesses a scene or enters local undo. Product
behavior is specified in [Canvas Behavior](../product-specs/canvas-behavior.md).

## Semantic history

Operational updates and semantic history have different retention. Document
revisions retain user-meaningful title/body or scene states and are immutable.
Human editing records bounded safety, active, and idle revisions; strict
semantic commands record immediate linked revisions.

Page History combines Document revisions with immutable property, Database,
lifecycle, and relocation activity. Only compatible Document revisions are
restorable. Restore pins current state, applies the selected state as one new
forward engine mutation, records its receipt/revision, and never rewinds Yjs or
Canvas causality.

Named and restore revisions are pinned. Unpinned revisions follow the current
age/tier/count policy implemented by the Document retention Module. Deleting a
revision never rewrites immutable mutation evidence; Activity may retain its
operation record after preview content expires.

## Compaction and collection

Yjs update compaction retains a valid canonical snapshot plus required tail and
does not change semantic Document identity. LocalCommit retains Document effect
metadata even when update bytes are compacted, enabling canonical resync.

Deleted Block collection is closure-based and fail-closed. Core proves no live
ownership, reference, history, recovery, Database, Session, schedule, relocation,
or unknown foreign-key root before physical removal. The complete candidate
rolls back if any constraint changes. Collected stable Block identities remain
retired permanently and are never reused.

Canvas tombstone/file compaction runs only after the last committed surface
closes and no pending/active copy remains. It pins a safety revision and rotates
the collaboration generation; inability to prove the boundary simply defers
maintenance.

Incremental vacuum may reclaim freed SQLite pages gradually. Retention and
compaction are storage maintenance, never user-visible undo.
