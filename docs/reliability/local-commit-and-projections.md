# LocalCommit and Projection Delivery

## One committed fact

Every semantic Core mutation atomically persists its canonical state change,
private physical evidence, immutable receipt, one CommitManifest, affected
Projection revisions, visibility evidence, and Document effect references. Its
durable identity is the Store epoch, LocalCommit sequence, and manifest hash.

The command result and post-state delivery authorization are separate. A caller
may receive the command outcome even when it cannot read the post-state. When an
authorized apply delivery exists, Main admits it to the initiating renderer
before the feature Promise resolves. The renderer never waits for the event
stream, a reread, or another renderer acknowledgement to treat the command as
complete.

An apply packet and later stream packet are complementary presentations of the
same Manifest. Coverage is deduplicated by durable identity, audience, and
resource. A different Manifest hash at the same Store coordinate fails closed.

## Durable wake and replay

The global and scoped brokers install their wake receiver before scanning the
durable ledger. A wake carries no event data or cursor; it only requests another
keyset scan. Lost or coalesced wakes are recovered by a later wake or reconnect
barrier. The scanner advances across sequence gaps and commits that authorize
zero packets.

A cursor older than retained history returns a typed resync boundary. Replay
pages are indexed, bounded, authorized, and keyed by the complete Store
coordinate. The global LocalCommit sequence measures replay progress; it is not
a Projection revision, Document head, or change-log sequence.

Main multiplexes Core-authored audience packets to concrete renderer recipients.
Each renderer has independent delivery and acknowledgement state. Recipient
leases and resets are Core-issued; Main cannot broaden an audience. A destroyed
renderer retains no delivery timer or state.

The multiplexed Projection live connection is one Main-scoped resource. Audience
changes publish only the latest desired scope set. A replacement opens in its
own child Scope while the current lease remains authoritative; its barrier is
installed before buffered packets become visible and before the old child Scope
closes. A clean overlap resets only newly added scopes. An unexpected end has no
overlap proof, so reconnect backs off on the Effect clock and resets every
desired scope. Callback ingress is ordered and bounded to 512 packets or repairs;
overflow fails and replaces that attempt instead of growing an unbounded queue.
Closing Main interrupts opening or backoff, closes the exact active subscription,
and fences callbacks that arrive after release.

## Projection freshness

Each projection advances on its exact scope revision and semantic dependencies.
A complete contiguous patch may apply immediately. A gap, unavailable patch,
integrity mismatch, conservative reset, or authorization change fences the stale
projection and schedules a bounded canonical read.

Patchless effects and advisory read-at-least requests accumulate into the latest
required coordinate per consumer. Interactive consumers repair after 300 ms of
quiet or at a 5 second starvation deadline, with one canonical read in flight;
reset, revocation, integrity failure, and a true causal gap stay urgent. Future
effect tails are Store-epoch keyed and capped at 128 entries because a canonical
repair can replace a compacted tail. These bounds prevent a busy Document writer
from turning projection convergence into an unbounded renderer queue. Failed
canonical reads retry with bounded exponential backoff; routine effects merge
into that pending retry instead of creating one failed read per notification.
Renderer admission also verifies inline Document resources through a small
fixed worker pool, so one large semantic commit cannot fan out an unbounded set
of buffer copies and digest jobs before its callbacks become visible.

Canonical reads derive their Store epoch, LocalCommit head, projection revision,
and values from one SQLite snapshot. Renderer stores admit the response only if
its authority/freshness stamp still covers every dependency observed since the
read began. A response started before a revoke or reset cannot repopulate stale
state.

Optimistic journals may keep an acknowledged semantic transform composed over
canonical base until the bounded projection actually materializes it. Promise
success or a broad commit cursor is not proof that one row/window contains the
result.

### Database List occurrence windows

Database List reads use a projection-identity-bound occurrence cursor over the
effective Filter, sort, grouping, subgrouping, presentation, and standard Parent
Relation projection.
Every response reports its logical start, total model count, total projection-row
count, and stable group, subgroup, Page, and transient-ancestor occurrence keys.
The renderer accepts a continuation only when identity, generation, start, and
occurrence uniqueness match the admitted prefix. A rejected or stale continuation
restarts from the first window; a transport failure keeps the admitted prefix
visible and offers retry.

Selection-all remains sparse until all windows are admitted, and drag is disabled
while selected Page authority is incomplete. A List drop commits Property,
Parent-Relation, and position intent in one transaction. The renderer may recompile
once after a typed revision conflict; otherwise it discards optimism and
converges from Core. Session Undo exists only when exact acknowledged before-
values and committed revisions make the inverse lossless.

## Visibility and authorization changes

Core computes authorization before and after the mutation inside the same
transaction and seals exact gains/losses into the Manifest. A revoke reaches the
affected resource before post-state content. Exact evidence evicts only matching
resources; a bounded closure overflow requests a conservative whole-address
reset.

Projection invalidation is not authorization. Every later read/write still
checks current Core authority. Relation and other reference edges do not expand
authorization; the product contract for Relation visibility is in
[Database, Pages, and Views Behavior](../product-specs/database-pages-and-views-behavior.md).

## Document effects

Large update bytes are referenced by verified Document effect metadata and may
be delivered through the exact Document resource lane. Operational compaction
may remove the bytes while retaining durable causal metadata. Replay then emits
`document_resync_required`; Main maps it to a history-compacted canonical resync
instead of inventing an empty update or declaring the commit lost.

Document delivery lanes serialize independently by Document identity. A multi-
Document commit may progress independently on unaffected lanes; retrying one
failed lane does not depend on unrelated notification delivery.

## Deep decisions

The durable projection model is recorded in
[ADR 0024](../adr/0024-durable-projection-invalidation.md) and the causal local
mutation boundary in
[ADR 0040](../adr/0040-local-commit-authority-and-causal-structural-mutations.md).
