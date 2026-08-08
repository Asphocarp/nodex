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

Core separates one semantic mutation into three artifacts. Private physical
journal rows retain reconstruction evidence. One immutable `CommitManifest`
owns `(store_epoch, commit_seq, manifest_hash)`, semantic effects, exact
Document refs, Projection effects, scoped resource revocations, routing claims,
and the receipt reference.
An `AuthorizedDeliveryPacket` is resolved after commit for one current access
context and may carry complementary inline/ref coverage without changing the
Manifest identity. A committed apply response always returns command outcome,
receipt, and Manifest identity; its delivery packet is optional and cannot
expand post-state read capability.

Command authorization and delivery authorization are separate Core decisions.
A Project-bound command remains constrained by that Project. When the connected
adapter is the authenticated Electron Host, Core resolves the apply and
response-loss-recovery packet for an explicit Library-broker delivery audience
used by the process-wide coordinator; the original Project context is retained.
Native CLI, test, Agent, and loopback adapters keep their exact bound post-state
audience. This makes source revocation and target projection
available in the response fast path without a second request or a durable-stream
wait. The Host packet does not grant any renderer a read capability: routing
uses the packet's Core-authored scopes, and every canonical fetch authorizes
again in Core.

Authorization loss is commit evidence, not a delivery-time guess. In the same
SQLite transaction as an ownership, lifecycle, or Project-grant change, Core
records the exact Library/Project/Document scope that lost each Page, Document,
Database, Data Source, or View. Every packet also carries a Core-authored
authorization scope covered by `packet_hash`. A trusted Library stream may
carry Project-scoped revocations, but adapters never infer historical scope
from current ownership. Revocation identity uses a canonical structured scope
encoding, never delimiter-concatenated IDs. A packet containing only
revocations is valid.

For a Page-to-Board promotion, heavy Yrs reconstruction and transformation run
against isolated working clones outside the SQLite writer. The writer then
revalidates command authorization, Document heads, ownership revisions,
membership, and Projection scope heads before one short transaction persists
the source removal, target Page genesis, exclusive ownership/membership,
Board patch, typed receipt, and one sealed Manifest. Same-Document Agent
batches compile one ordered Yrs update per Document and one outer Manifest;
they never prepare several updates against the same stale target head. The
transaction cannot return a successful response with only a final Library
effect or with an inferred operation-id grouping.

Main admits both apply-response and durable-tail/replay packets into one
synchronous `LocalCommitCoordinator`. Admission validates Manifest hash and
coverage, claims semantic/resource identities, and schedules independent
ordered retry lanes for each exact Document, exact projection scope,
scoped resource revocation, and domain notification. Revocations are admitted
before ordinary Document effects from the same packet. Transactions affecting
overlapping Document sets serialize on each shared Document without creating a
composite lane that blocks unrelated Documents. One lane cannot delay another
or the apply response.

Admission may select one semantic effect for a notification lane, but the
Core-authored packet remains byte-for-byte intact with its original coverage
and `packet_hash`; adapters receive the selected effect as a separate argument
and never manufacture a sliced packet that reuses another packet's hash.
The later tailer copy enriches or deduplicates already delivered resources; an
identity collision fails closed. Stream checkpoints advance replay bookkeeping
only.

Core seals each affected projection scope with an independent
`base_revision`, `result_revision`, `covered_commit_seq`, `effect_hash`, an
optional complete patch, and `requires_read_at_least`. Main routes the already
authorized effect without reading. A renderer `CausalProjectionRuntime`
accepts only a contiguous revision edge, applies complete patches
synchronously, buffers bounded future edges, and coalesces canonical repair for
gaps, patchless effects, resets, or integrity conflicts. Canonical reads carry
the exact coordinate and cannot replace newer local authority. The global
LocalCommit sequence is never treated as a projection version.

Every mounted collaborative Document surface exposes a
`BlockDocumentMutationBarrier`. It flushes local durable updates and returns a
`DocumentHeadToken` containing Document identity, Store epoch, generation, and
head sequence. Move-to and cross-surface Block DnD pass the tokens as causal
dependencies. Core verifies them while preparing and revalidates them in the
writer transaction against current SQLite Document rows. The dependency is excluded from the semantic
intent hash so a retry after a fresh read remains the same idempotent command.

Document/Canvas realtime streams independently enforce per-surface head order.
They buffer a bounded future-head gap and emit resync on overflow or epoch
change. This preserves Yjs/scene convergence without making projection replay a
prerequisite for local command visibility.

Each exact Document subscription is also a post-state authorization and
resource-filtering boundary. Core resolves read access through the canonical
owned-Document rules, including Canvas shells and granted host Pages, and
delivers only effects, refs, and revocations that address that Document.
Unrelated commits may advance the scanner checkpoint but cannot enter the
surface lane. This rule applies equally to the initiating apply packet and the
durable replay packet.

An already-open exact Document subscription remains a Core-authorized
capability for that Document. A trusted root-stream ref may therefore fan out
to every active subscription for the exact Document; a scoped Document
revocation independently emits `access-revoked` and closes only the addressed
Project or Library subscription. Revocation and Document effects have separate
bridge entry points, so one lane cannot accidentally consume or suppress the
other.

Compaction may remove a retained Yjs update body but never removes the semantic
LocalCommit effect. Replay of such an effect returns the typed
`document_resync_required` boundary with verified identity/hash metadata; Main
maps it to a history-compacted surface resync, and the provider repairs from a
canonical snapshot/state vector rather than applying an invented empty update.

## Consequences

The initiating window renders the committed source-Document and target-View
result with the same latency as the Core response, while other windows and a
restarted process converge from the durable stream. Main owns resource-level
deduplication and independent delivery retry; renderer stores own Core-derived
snapshots, exact scope coordinates, and deterministic reducers—not speculative
ownership state.
When access is lost, Page Detail, Board, and query stores synchronously remove
the matching cached authority for every revocation before any canonical repair.
Authorization-bearing inactive query entries retain a scope subscription. If a
revocation occurs between canonical read and subscription installation, the
projection stream's initial checkpoint synchronously fences any older cache
before repair. Only the later repair may coalesce. Per-resource/store
generations fence reads that started before the revocation, preventing them
from repopulating stale content. This is a client consistency guarantee, not a
replacement for Core's read authorization.

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
- A trusted local Project-bound cross-Project command returns a Library-scoped
  packet that can deliver both the source revocation and target projection
  before the command Promise resolves; the command authorization itself remains
  Project-bound.
- Packets for the same Manifest arriving from apply and tailer produce one delivery per
  resource identity, while complementary authorized coverage is preserved.
- A pure scoped revocation packet survives apply/tailer deduplication, reaches
  only its authorization scope, closes exact Document subscriptions, and
  synchronously evicts matching renderer caches even when their cursor is newer.
- N and N+1 remain independently deliverable when they arrive out of order.
- A projection-lane failure cannot delay Document fanout, another projection
  scope, a revocation, or the apply response.
- A contiguous Database View patch updates Board cards, query rows, grouped
  windows, totals, and exact authority before repair I/O; mixed-revision reads
  and continuations are rejected.
- A mounted source/target body is flushed before Move-to or Board DnD, and Core
  rejects a stale causal head without a partial ownership/membership commit.
- An exact Page or Canvas Document subscription receives its own authorized
  updates and never receives unrelated semantic effects from a multi-resource
  Manifest.
- A high-pressure populated Board test moves 100 independently seeded nested
  100-child subtrees and reports commit/card visibility p50/p95/p99/max without
  a fixed sleep or manual refresh. Automated Electron coverage invokes the real
  renderer IPC mutation/projection boundary; native pointer DnD remains a
  manual smoke check because synthetic drag events are not a reliable product
  input model.
