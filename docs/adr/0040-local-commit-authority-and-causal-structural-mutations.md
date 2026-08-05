# ADR 0040: LocalCommit is the local mutation authority and structural commands use causal Document heads

- Status: Accepted
- Date: 2026-08-06
- Owners: Nodex maintainers
- Extends: ADR 0004, ADR 0005, ADR 0024

## Context

One local command can change a Page body, Page ownership, Database membership,
and several projections. Waiting for the durable event stream before updating
the initiating renderer creates an avoidable round trip and allows a Board or
Page surface to look stale after Core has already committed. Conversely,
letting a structural command race a mounted Yjs provider's unsent body update
can compile ownership from an older Document head and lose the user's local
edit.

The apply response and the durable event stream are therefore two deliveries of
one committed fact. They need one identity and one retry model. The Document
body head is a different coordinate: it orders Yjs/Canvas updates within one
surface and is a causal precondition for a structural mutation, not a public
projection cursor.

## Decision

Core writes a semantic `LocalCommit` envelope in the same transaction as the
mutation and idempotent receipt. Its identity is `(store_epoch, commit_seq)`;
the physical `change_log` effect sequence is internal. The envelope includes
the projection impact, physical effect references, and affected Document heads.
All successful mutation responses that have a commit carry this envelope.

For a Page-to-Board promotion, Core allocates the LocalCommit parent before
writing any physical effect and explicitly attaches every effect to it. The
same SQLite transaction then persists the source Document update (which
removes the Block from the mounted Page), the new Page Document genesis, the
exclusive ownership/membership and Board projection rows, and the final
Library receipt effect. The transaction cannot return a successful response
with only the final Library effect or with an inferred operation-id grouping.
The v104 canonical hash covers the parent identity, ordered effect metadata
and payloads, merged projection impact, and Document update references, and
Core verifies it whenever a LocalCommit is loaded for replay or resolve.

Main admits both apply-response and durable-tail/replay envelopes into one
synchronous `LocalCommitDispatcher`. Admission only queues work. The dispatcher
then performs document fanout, projection invalidation, and domain notification
in a retryable drain. It verifies canonical hashes, retains identities rather
than a single max cursor, deduplicates the later tailer copy, and fails closed
on an identity collision. The event supervisor is allowed to advance its
transport cursor after admission; replay/resync repairs failed delivery.

Projection consumers keep a minimum semantic cursor for their canonical reads.
An older asynchronous response cannot replace a snapshot that covers a newer
commit. The same invalidation registry handles apply and tailer delivery, so
Board membership, navigation, Page detail, and search do not need manual
refresh calls or item-level pending projection state.

Every mounted collaborative Document surface exposes a
`BlockDocumentMutationBarrier`. It flushes local durable updates and returns a
`DocumentHeadToken` containing Document identity, Store epoch, generation, and
head sequence. Move-to and cross-surface Block DnD pass the tokens as causal
dependencies. Core verifies the dependencies during plan and apply against the
current SQLite Document rows. The dependency is excluded from the semantic
intent hash so a retry after a fresh read remains the same idempotent command.

Document/Canvas realtime streams independently enforce per-surface head order.
They buffer a bounded future-head gap and emit resync on overflow or epoch
change. This preserves Yjs/scene convergence without making projection replay a
prerequisite for local command visibility.

Compaction may remove a retained Yjs update body but never removes the semantic
LocalCommit effect. Replay of such an effect returns the typed
`document_resync_required` boundary with verified identity/hash metadata; Main
maps it to a history-compacted surface resync, and the provider repairs from a
canonical snapshot/state vector rather than applying an invented empty update.

## Consequences

The initiating window can render the committed result with the same latency as
the Core response, while other windows and a restarted process converge from
the durable stream. The Main process owns delivery deduplication and retry;
renderer stores own only canonical read snapshots and cursor fences.

Structural commands can still return a retryable revision conflict when a
mounted provider changes after its barrier or when an unmounted target changes
before Core applies the command. This is intentional: the command never
silently overwrites a newer Document body. No application-wide pending overlay
or UI freeze is needed for the normal commit path.

## Rejected alternatives

- Wait for the SSE tailer or projection callback before resolving apply. This
  makes a durable local commit look remote and couples command latency to
  renderer fanout.
- Let each renderer optimistically mutate Board membership and Page ownership.
  This duplicates the SQLite authority and cannot reconcile ownership/body
  transactions safely.
- Use only `max(commit_seq)` as a dedupe cursor. An out-of-order N+1 delivery
  would cause N to be discarded even though it may affect another Document or
  projection.
- Treat a Yjs head token as an idempotency hash. Freshness changes on retry;
  command identity must remain stable across a response-loss recovery.

## Acceptance

- Apply response returns without waiting for projection or durable tailer work.
- The same envelope arriving from apply and tailer produces one Main delivery.
- N and N+1 remain independently deliverable when they arrive out of order.
- A mounted source/target body is flushed before Move-to or Board DnD, and Core
  rejects a stale causal head without a partial ownership/membership commit.
- A high-pressure populated Board test moves a nested 100-child subtree at
  least 20 times and reports commit/card visibility p50/p95/p99/max without a
  fixed sleep or manual refresh.
