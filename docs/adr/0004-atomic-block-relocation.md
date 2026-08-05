# ADR 0004: Cross-Document Block relocation is one durable operation

- Status: Accepted as the low-level Document primitive; public command superseded by ADR 0005
- Date: 2026-07-11
- Owners: Nodex maintainers

## Context

Yjs transactions are atomic inside one Y.Doc, but moving a subtree between two Documents produces independent source and target updates. Applying “copy target, update registry, delete source” as separately committed steps can expose duplicates, lose edits, or leave stale windows writing ghost content. Yjs internal struct identifiers cannot be moved between Documents, yet application Block IDs and references must remain stable.

Cross-Document moves are relatively infrequent, so correctness and recoverability matter more than maximizing operation throughput.

## Decision

Nodex implements relocation as an idempotent internal `RelocateBlocks` primitive with a stable `relocationId`. It preserves application Block IDs while cloning XML content into new Yjs structs in the target and deleting the source subtree. ADR 0005 makes `BlockTransfer` the sole public same-Project parent-change command; its writer delegates Document-to-Document Move to this primitive inside the broader transaction. No renderer, IPC, or HTTP route may call `RelocateBlocks` directly.

The writer performs the operation as follows:

1. Acquire source and target write fences in sorted `documentId` order.
2. Active writable surfaces complete IME composition and run their local
   mutation barrier. The barrier flushes pending updates and returns the exact
   Document generation/head token that Core must recheck. There is no renderer
   lease acknowledgement or UI-wide freeze on the response path.
3. Validate project scope, source and target heads, root location revisions, target parent and anchor, identity uniqueness, and absence of ancestor cycles.
4. Rebuild source and target working clones from durable state, then use the portable Y.Xml subtree codec to clone into the target and delete from the source. Application IDs, formatting, nested structure, and reference targets are preserved; Yjs internal struct IDs are new.
5. In one SQLite transaction, append both Document updates, advance both heads, update Block locations and materialized indexes, record the relocation ledger/history/change log, and release durable fences.
6. After commit, swap live caches, fan out both updates plus a relocation event, and release the ephemeral lease.

Moving a document-bearing Card changes only its shell placement. Its owned Document ID and body do not move. Copy is a separate operation that recursively allocates new application IDs; reference target IDs remain unchanged.

If the process crashes before commit, no change is visible. If it crashes after commit but before fanout, state-vector reconnection recovers the committed state. Replaying the same `relocationId` returns the recorded result.

An update based on stale pre-relocation content declares `baseHeadSeq` and `touchedBlockIds`, but client declarations are only bounded diagnostics. The writer derives or verifies the actual changed Block set before using it for relocation safety. If the update touches a relocated subtree, the writer returns typed `block_relocated` metadata. If a binary update cannot be safely split, Nodex stores it as a recovery artifact and requires reload/merge instead of discarding it or applying ghost content.

The renderer receives the committed local result through Main immediately;
durable event-tail replay and projection invalidation are recovery/fanout
paths, not prerequisites for command completion. A later tailer envelope is
deduplicated by its `(store_epoch, commit_seq)` identity.

## Consequences

Relocation results are all-old or all-new across persistence, registry, and projections. The operation is intentionally heavier than an in-Document move and can fail cleanly when an active editor cannot flush.

The XML codec must validate and clone every supported BlockNote Y.Xml node. Fault injection must cover lease timeout, validation failure, each write within the SQLite transaction, commit, cache swap, and fanout. Recovery tests must prove no duplicate identity and no missing subtree at every failure point.

Cross-Space moves additionally validate both Project scopes and apply the destination's ownership/security rules. They remain one writer operation because one SQLite store is authoritative.

## Alternatives considered

Best-effort multi-step commits can leave duplicate or missing content. Keeping Yjs internal struct IDs across Documents is not supported by the CRDT model. A single Space-wide Y.Doc would avoid cross-Document moves but collapse loading, undo, and failure scopes. These alternatives are rejected.
