# ADR 0033: Canvas authority is incrementally hashed and projected

## Status

Accepted

## Context

Canvas uses Excalidraw elements, but SQLite—not a renderer document—is the
authoritative current state. Excalidraw exposes scene changes as arrays and
resolves concurrent element values with its version and version-nonce clock.
Persisting every edit as another complete JSON scene made a one-element move
read, serialize, hash, project, and retain work proportional to the entire
Canvas. It also duplicated the complete logical request and result in both the
Canvas receipt and the common Module receipt.

The authority needs bounded repair snapshots, exact retries, deterministic
convergence, and cold correctness without making a parsed-scene cache part of
the write contract.

## Decision

Store format v95 keeps each canonical Excalidraw element and managed file as an
atomic row. Candidate elements are resolved with the existing total winner
rule: higher version, lower version nonce, then canonical hash and JSON
fallback. App-state intents remain field-level compare-and-swap operations.

Each element and file belongs to one of 1,024 deterministic hash buckets. The
bucket index is the first ten bits of SHA-256 over the versioned bucket-index
domain, item kind, a zero delimiter, and UTF-8 item identity. A leaf hashes a
versioned leaf domain, kind, length-prefixed identity, and the decoded
canonical row hash. A bucket hashes a versioned bucket domain, its two-byte
index, item count, and leaf hashes sorted by kind and identity. Empty buckets
use that same bucket hash with zero items and have no stored row.

The v2 scene root hashes its versioned root domain, Canvas schema version,
canonical app-state hash, element and file counts, and exactly 1,024 bucket
hashes in index order. SQLite stores exact element, tombstone, file, canonical
JSON-byte, and portable-snapshot-byte counters. The writer reads candidate
rows, affected file references, affected bucket items, and at most 1,024
compact bucket roots. It does not parse unchanged element JSON.

Element rows also store derived `referenced_file_id` and `plain_text`.
Incremental projection writes touch only changed Page references and managed
files. Aggregate search text is rebuilt from derived text rows only when a
winning element changes text. `canvas_scene_projection_heads` is the freshness
fence for the whole current-generation projection. Individual projection
rows retain the head at which that row last changed.

The common Module receipt is the sole durable replay result. The Canvas receipt
contains only Document/generation/mutation coordinates, semantic intent hash
and byte length, outcome, and commit time. Its semantic fingerprint includes
Profile, Library, optional Project, expected store epoch, Document,
generation, base head, mutation identity, and canonical mutation intent. It
excludes physical connection, adapter, renderer session, and lease identity,
so response-loss recovery can move to a new authenticated connection without
changing the logical operation.

Full scene materialization remains a cold path for synchronization, history
checkpoints, restore, backup validation, cloning, and explicit integrity
checks. Revision eligibility is queried before serialization; an edit burst
with current checkpoint coverage performs no full scene load.

Deleted elements remain ordinary current-generation rows until idle Canvas
maintenance. Store v96 persists tombstone UTF-8 bytes alongside the v95 scene
counters, so eligibility is one authority-row read: at least 5,000 tombstones
or 4 MiB of tombstone JSON. The last closing surface attempts maintenance only
when it is connected, fully committed, and has no pending IndexedDB outbox
intent. The Host additionally proves it is the Document's sole subscriber
before requesting the common write fence. One writer transaction then pins the
complete pre-compaction scene as a safety revision, removes tombstone rows and
files referenced only by them, rebuilds the compact authority and projections,
and advances to the next Document generation at head one.

The compaction operation has a delivery-neutral semantic receipt and emits a
durable generation-change event. A response-loss retry returns the original
result before reacquiring a fence. Offline state, pending work, another active
surface, and fence failure defer maintenance without blocking close. Renderers
clear any old-generation outbox intent if they encounter the new generation.
Because maintenance begins only after the last Excalidraw surface has
unmounted, it never resets an active undo stack. The pinned safety revision
keeps the deleted elements inspectable through history even though they are no
longer accepted as current-generation merge candidates.

Collaborator presence is a separate, non-durable lane owned by an Electron
Host memory hub. It reuses the exact Canvas subscription boundary but never
calls Core or opens SQLite. A semantic publication contains only Document,
generation, session-local monotonic clock, and bounded pointer/selection/idle
state. The Host binds the active renderer session and derives display identity
and color from the trusted WebContents target before fanout. It excludes the
sender, rejects stale clocks and generations, sends a current snapshot after
scene synchronization establishes the boundary, removes clean disconnects
immediately, and expires unclean sessions after 30 seconds. Renderers publish
at most 20 pointer samples per second, heartbeat every 15 seconds, and map
remote state only to Excalidraw collaborators with
`CaptureUpdateAction.NEVER`.

## Consequences

- A warm one-element geometry edit performs work proportional to the changed
  candidate and its bucket, plus the fixed 1,024-root bound.
- Content repair still returns one bounded canonical portable scene and
  verifies every row, counter, bucket, root, and projection head.
- Text changes may scan derived text strings, but never need to parse every
  element JSON value.
- Store migration must validate the complete v94 scene and projections before
  replacing its hash and receipt representation.
- Scene hashes from v95 are not the legacy whole-scene hash; the hash-version
  column makes that transition explicit.
- A parsed snapshot cache may be added later only as a post-commit optimization
  keyed by store epoch, Document, generation, head, hash version, and root.
  Correctness cannot depend on cache presence.
- Tombstone removal is invisible best-effort maintenance at a safe surface
  lifecycle boundary, not a user action or an age-based retention side effect.
  It retains the common write fence, pinned rollback evidence, and exact retry.
- A stale/offline element candidate from the previous generation cannot
  resurrect a compacted tombstone. It is rejected at the generation boundary
  and removed from the renderer outbox before replay.
- Pointer, selection, and idle traffic does not advance a Document head, enter
  the outbox, create history/receipts/change-log rows, or survive process exit.
  Presence is advisory and a missed packet is repaired by the next heartbeat
  or subscription snapshot.
- The executable hot-path contract seeds 20,000 elements and then performs
  1,001 same-element edits. It requires zero full-scene loads during that warm
  burst, one-element deltas below 64 KiB, compact Canvas receipts without JSON
  bodies, and bounded SQLite page growth.
