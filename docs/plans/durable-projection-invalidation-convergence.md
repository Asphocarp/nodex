# Make projection invalidation durable and convergent

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain current
while implementation proceeds. Maintain this file according to `docs/PLANS.md`.

## Purpose / Big Picture

After this work, a committed Page title or body edit refreshes every mounted
Page, Database View, Library, and reference projection without requiring a
manual save, focus change, or restart. Rust Core records a bounded projection
impact in the same ledger transaction as the semantic mutation. Live delivery
and restart replay decode that same durable event. The Host forwards one
authorization-filtered invalidation stream without inspecting module-specific
payloads, and each renderer window has one registry that converts those
coordinates into canonical rereads with an in-flight trailing-read guarantee.

The observable proof is a deferred Database View read: let its first response
capture an old Page title, commit a new title in another window, then release the
old response. The view, Page detail, reference, and Library navigation must all
settle on the new title without remounting. The same scenario must pass through
Electron IPC and browser SSE, and no invalidation payload may contain a title,
summary, property value, or complete Page DTO.

## Progress

- [x] (2026-07-22 00:00Z) Explored the Core ledger/replay, Host fanout, browser
  authorization, renderer subscriptions, query invalidation helper, and prior
  Page-target freshness design.
- [x] (2026-07-22 00:00Z) Chose a Core protocol v2 clean cutover and kept
  domain/optimistic events separate from projection correctness.
- [x] (2026-07-22 05:40Z) Persisted required projection impact in schema v88,
  added the replay floor and corruption checks, converted production ledger
  writes to one required-impact helper, and made live/replay use one decoder.
- [x] (2026-07-22 05:45Z) Split transport/event protocol v2 from module contract
  v1, regenerated the private protocol package, and verified the generated
  artifacts.
- [x] (2026-07-22 05:48Z) Replaced Page-target fanout with one scoped Host
  projection router, batched Core Project authorization, ordered queues,
  checkpoint barriers, fail-closed resync, and acceptance-gated Core cursors.
- [x] (2026-07-22 05:50Z) Added the renderer projection registry and migrated
  Page detail, Database Views, all boards, references, Library routes/navigation,
  and Database management to cursor-bearing canonical reads.
- [x] (2026-07-22 05:52Z) Removed Page-target/projection-resync channels, the
  module switch, the per-Project Page hub, and parallel event types. Added ADR
  0024 and updated architecture, reliability, and product behavior docs.
- [x] (2026-07-22 07:25Z) Completed protocol generation/verification, Rust
  workspace checks, TypeScript typecheck/lint, repository tests/build/full
  release gate, a fresh-root Electron/Core v2/v88 startup, and the required
  correctness/security/simplification reviews; prepared the complete change for
  one conventional commit.

## Surprises & Discoveries

- Observation: `core-event-stream-supervisor.ts` advances its cursor before
  invoking the Host publisher.
  Evidence: the raw callback assigns `after = Math.max(...)` before
  `input.onEvent(envelope)`, so a synchronous fanout failure skips replay of the
  event that failed to publish.

- Observation: browser Project Page authorization is asynchronous and can
  reorder events.
  Evidence: `/api/projects/:projectId/events` starts one independent
  `resolvePageTarget(...).then(send)` chain per Page-target event.

- Observation: TanStack Query ordinary invalidation is not a sufficient
  initial-fetch fence.
  Evidence: the existing `invalidateExactQuery` explicitly schedules one
  trailing refetch when the matching query is fetching with no data.

- Observation: direct View consumers need `viewIds` before their first
  descriptor response reveals a Database or Data Source identity.
  Evidence: `LibraryDatabaseRoute` already treats an unresolved direct View as
  an invalidation case.

- Observation: making live publication load the just-written ledger row exposed
  an existing `block_relocation` replay omission that the old hand-built live
  event path concealed.
  Evidence: the full Rust unit suite initially failed two Block transfer tests
  with `Core event kind is unsupported`; adding `block_relocation` to the
  Library decoder/allowlist made both live and replay paths pass.

- Observation: a checkpoint cursor must be captured at subscription and queued
  behind already accepted work for every scope, not emitted synchronously for
  Library scope.
  Evidence: otherwise the checkpoint could jump past a changed message already
  waiting in the scope queue and let the renderer treat stale data as current.

- Observation: Board identity and freshness could not be inferred safely from
  the previous identity-free board payload.
  Evidence: the registry needs Project/Database/Data Source/View dependencies
  and a canonical cursor, so the primary read now returns one
  `BoardSummarySnapshot` carrying those coordinates with the board.

- Observation: a late consumer joining an already shared scope subscription
  still needs the most recent checkpoint.
  Evidence: without retaining and comparing the scope checkpoint, the shared
  transport correctly avoids a second subscription but reopens the query-before-
  effect race for the newly registered consumer.

- Observation: version literals in native CLI integration fixtures drifted as
  soon as the Store advanced to v88.
  Evidence: replacing the fixture's hard-coded v87 with `CORE_SCHEMA_VERSION`
  made the test assert the authority contract instead of the previous schema.

- Observation: the lifecycle readiness helper reported an early child exit as
  a JSON EOF, hiding the actual process status and stderr.
  Evidence: capturing the exited child's status and stderr made the one observed
  readiness failure diagnosable; the incompatible-Core handoff then passed 20
  consecutive focused runs and three full lifecycle runs.

- Observation: the frozen TypeScript migrator and the Rust Store migration form
  two intentionally separate stages.
  Evidence: both `pnpm run build` and `pnpm test:all` verified the unchanged v84
  bundle/manifest, while a fresh runtime root created an immediately usable v88
  Store with a v2 Core descriptor.

- Observation: filtering projection coordinates with a parallel authorization
  query is both a data-leak risk and a convergence risk.
  Evidence: the first Project filter treated same-storage Databases as visible
  even though canonical Database reads did not. Extracting and reusing the
  canonical evaluator made an unauthorized Database/Data Source/View negative
  fixture fail closed.

- Observation: post-commit authorization cannot identity-filter a resource a
  Project just lost without either leaking that identity or suppressing the
  invalidation.
  Evidence: Page moves, grant changes, and transfers can remove visibility
  before the router reads the event. Those topology transactions now persist
  `all`, which remains Project-scoped after authorization verifies the Project.

- Observation: a query family is fresh only at the oldest cursor represented
  by every canonical member needed by its consumer.
  Evidence: Library navigation metadata could be newer than a still-stale child
  page. Family cursor calculation now takes the common minimum and keeps Page
  detail/Document caches outside the navigation key prefix.

- Observation: protocol frame bounds must account for payload and durable
  impact together.
  Evidence: a legal impact near its one-MiB resource bound plus a legal module
  payload exceeded the former 512-KiB Core event reader limit. The private event
  frame has an explicit combined budget and a large valid-event regression.

## Decision Log

- Decision: Store impact on `CommittedCoreModuleEvent`, not on the transport
  `EventEnvelope` and not as a Host-derived value.
  Rationale: impact is a fact about the committed transaction and must survive
  restart without querying current ownership. A single ledger decoder makes
  live and replay byte-equivalent.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Use `none | all | resources`, with Page, Database, Data Source,
  View, and Page-bound Document-head coordinates.
  Rationale: explicit `none` prevents accidental omission, `all` is the safe
  bounded fallback, and binding a head to its Page lets Project filtering remove
  unauthorized Document identity without a second authorization model.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Projection impacts do not carry a change kind or projection DTO.
  Rationale: the stream declares stale canonical readers. Navigation,
  ownership, automation, and optimistic-board semantics remain domain events,
  while title and summary remain reader-owned projections.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Make the private Core protocol v2-only while module contracts stay
  at version 1.
  Rationale: a required event field is wire-incompatible. The existing
  authenticated generation handoff is cleaner than retaining a module-switch
  v1 fallback.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Close first-read and reconnect races with a listener-before-
  checkpoint barrier and a renderer cursor comparison.
  Rationale: this covers queries that begin before their React subscription
  effect without delaying every initial read, and it gives browser reconnect an
  exact recovery boundary.
  Date/Author: 2026-07-22 / Codex.

- Decision: Expand ordinary Database coordinates inside the Core writer
  transaction, and use `all` for visibility transitions whose lost Project
  membership cannot be identity-filtered from post-commit state.
  Rationale: Page, Library, Database, and Automation mutations must publish the
  complete current projection closure. Move, grant, and transfer transactions
  can enumerate their raw old/new resource IDs, but the Project filter reads
  current authorization and therefore cannot safely reconstruct which IDs a
  Project just lost. Identity-free `all` is the bounded truthful convergence
  signal for those rare topology transitions; returning a partial resource set
  would be a lie. A nonpersistent test authority with no catalog uses the same
  explicit fallback.
  Date/Author: 2026-07-22 / Codex.

- Decision: Keep Data Source/View coordinates out of duplicated Automation and
  Owned Document payload fields when the top-level durable impact already owns
  them.
  Rationale: the Host is forbidden to interpret module payloads for freshness.
  Repeating the same fact in domain payloads would recreate two authorities;
  producers instead enrich the required top-level impact before ledger append.
  Date/Author: 2026-07-22 / Codex.

- Decision: Make router replacement and main shutdown dispose every projection
  scope and IPC release.
  Rationale: Store replacement and process teardown are ownership boundaries;
  listeners from an old Store epoch must not survive them.
  Date/Author: 2026-07-22 / Codex.

## Outcomes & Retrospective

The complete architecture is implemented and validated. `pnpm test:all` passed
the Rust workspace, generated protocol, module-boundary audit, reproducible
frozen migrator, 1,429 Node tests, 956 Main tests, 3,105 renderer tests, 46
Electron integration tests, 51 browser tests, the production build, and the
Electron restart E2E. Separate typecheck, lint, protocol generation, build, and
focused Core/renderer suites also passed. A new isolated root launched Electron
with a Core descriptor negotiating protocol `2..=2`; its fresh SQLite Store was
v88 with `projection_event_v2_floor = 1`, and every observed change-log row had
durable impact. Three independent review passes ended clean after their findings
were resolved.

The implementation removed the compatibility freshness paths rather than
retaining dual delivery. The most important follow-up lesson is that durability
alone is insufficient: convergence also depends on sharing canonical
authorization predicates, representing lost visibility without identity leaks,
reporting the common cursor of multi-query projections, and retaining a required
cursor across read failures. A single durable decoder made the live/replay
contract testable, while one Host router and one renderer registry made those
remaining ordering and ownership rules explicit instead of distributing them
across feature-specific subscriptions.

## Context and Orientation

Rust Core is the exclusive writer for one Profile. Each mutation writes a row
to `change_log`; `crates/nodex-core/src/infrastructure/event_log.rs` reconstructs
module events for global replay, while `crates/nodex-core/src/document/event_log.rs`
reconstructs exact Document updates. `crates/nodex-core-server/src/lib.rs` wraps
those committed events in the transport `EventEnvelope` for SSE.

The Electron main process supervises that Core stream in
`src/main/core-client/core-event-stream-supervisor.ts`. Before this plan,
`src/main/core-client/page-projection-events.ts` inspected selected module
payloads and created one `page-target-changed` event per Page;
`src/main/main-runtime.ts` published those through `DatabaseNotifier`, Electron
IPC, and browser SSE. That mapper and event no longer exist.

Renderer freshness was split among `kanban-store.ts`, `page-detail-store.ts`,
`block-reference-queries.ts`, `use-all-boards.ts`, and Library routes. They each
subscribed to some combination of Page-target, Database, Board, Library, and
authority-resync events and implemented overlapping refresh/trailing-read logic.
The central registry is now the only renderer module allowed to consume the raw
projection stream.

## Plan of Work

First advance the Store to v88. Add a canonical projection-impact JSON column
and a replay floor to Core metadata. The v87-to-v88 migration sets the floor to
the next event sequence; replay crossing older rows requests a resync instead of
inventing historical impact. Replace raw module inserts with a shared append
boundary that requires an explicit impact, then decode both live and replay
events through one row loader. Page Document commits record Page, Database, Data
Source, all affected Views, and their exact head in the same transaction.

Next introduce event version 2 and transport protocol 2 while leaving module
request versions unchanged. Regenerate the OpenAPI/TypeScript contract and test
that a new Host hands off a still-running protocol-v1 Core. The historical
legacy migrator remains frozen at its v84 target.

Then add one Host projection router. It consumes only the durable impact and
cursor, serves full Library scope, and filters Project scope through one bounded
Core authorization read. Each Project has an ordered queue. Subscribing installs
the listener before appending a checkpoint barrier. Filtering failure emits a
scoped resync without exposing any identity. The Core supervisor advances only
after the router accepts the event.

Finally create one renderer registry per window. Registrations provide a stable
consumer key, dynamic dependency coordinates, the cursor represented by their
current canonical data, and an invalidator. The registry reference-counts scope
streams, matches impacts, isolates failures, compares callback results with the
required cursor, and schedules at most the necessary trailing reread. Migrate
Page detail, Database views, all boards, references, and Library consumers;
retain Board events only as cursor-fenced patches and retain domain events only
for their domain semantics. Delete the old Page-target/resync projection paths.

## Concrete Steps

Run commands from `/Users/asc/repo/nodex2`. Use focused Rust, Node, renderer,
and integration tests after each boundary. Generate the private protocol only
after its Rust types stabilize:

    pnpm run core:protocol:generate
    pnpm run core:protocol:verify

The stable handoff gate is:

    pnpm run core:fmt
    pnpm run core:clippy
    pnpm run typecheck
    pnpm run lint
    pnpm test
    pnpm run build
    pnpm test:all

Use a fresh disposable runtime root for the startup smoke test:

    scripts/run.sh -ck -r <fresh-root>

Do not rebuild or rewrite the frozen legacy migrator bundle/manifest; normal
build verification must accept the checked-in v84 artifact.

## Validation and Acceptance

Core tests must prove impact normalization, every module's explicit impact,
same-transaction Page projection/head evidence, exact live/replay equality,
schema-v88 replay-floor behavior, fail-closed malformed rows, Project filtering,
and v1-to-v2 runtime handoff.

Host tests must prove payload-independent mapping, no event for `none`, ordered
async filtering, authorization-error resync, checkpoint barriers, cursor retry
after publisher failure, and equivalent Electron/browser messages.

Renderer tests must cover every identity dimension, wildcard and non-match,
duplicate observers, dynamic dependencies, duplicate and out-of-order messages,
Store epoch changes, checkpoints, resync, callback isolation, in-flight trailing
reads, cursor-covered events, and underlying stream teardown.

The end-to-end regression delays an old Database View response, commits a new
Page title/body, releases the old response, and observes the new title/summary in
Page detail, primary and filtered views, Page/Database references, and Library
navigation without a manual refresh. It runs through Electron IPC and browser
SSE, asserts Project identity filtering, and asserts that stream messages contain
no projection DTO.

## Idempotence and Recovery

The v88 migration is transactional. Before the replay floor, missing impact is
expected and forces resync; at or after the floor it is corruption. Re-running
an already migrated Store performs no data rewrite. `all` is the safe result for
a legitimate effect that cannot be represented within bounds; IDs are never
truncated.

Protocol generation is deterministic and may be rerun. If implementation stops
between milestones, keep this Progress section and the working tree accurate.
Do not retain a final compatibility path: temporary dual wiring is allowed only
while a milestone remains uncommitted and must be removed before handoff.

## Artifacts and Notes

The intended final flow is:

    Core transaction
      -> durable CommittedCoreModuleEvent + ProjectionImpact
      -> live/replay common decoder
      -> Host scoped projection router + checkpoint/resync
      -> renderer ProjectionInvalidationRegistry
      -> exact canonical reread (plus one necessary trailing read)

Domain events may still produce low-latency presentation patches, but removing
any one of them must not prevent the canonical projection from converging.

## Interfaces and Dependencies

No new third-party dependency is required. Rust contracts own the durable
snake_case impact. Generated TypeScript owns the Core wire shape. A small shared
camelCase projection-stream type validates IPC/SSE ingress. The Host owns scope
authorization and ordering. The renderer registry owns matching and refresh
coalescing; TanStack Query remains the cache implementation for query consumers,
and custom Page/Database stores continue to own their canonical response fences.

Revision note (2026-07-22 05:55Z): Updated this living plan after completing the
Core, protocol, Host, renderer, cleanup, and documentation milestones. Recorded
the block-relocation decoder discovery, checkpoint ordering, Board snapshot,
impact-ownership decisions, focused validation evidence, and the remaining
release-gate/commit work so implementation can resume from this file alone.

Revision note (2026-07-22 07:25Z): Closed the plan after structured review and
the complete release gate. Recorded the canonical-authorization, lost-
visibility, multi-query cursor, frame-budget, callback-retry, and fresh-root
startup evidence discovered during final hardening.
