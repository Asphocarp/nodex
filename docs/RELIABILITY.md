# Reliability

## Purpose

Nodex is reliable when committed local work survives process and window
lifecycle, every authorized presentation converges on the same semantic state,
and recovery never introduces a second authority or replays stale work into a
new one.

This document is the reliability map and cross-system contract. Detailed
mechanisms live in the focused documents under `docs/reliability/`, product
behavior in `docs/product-specs/`, and executable version/schema/limit values in
code and tests.

## Reliability model

Nodex uses four distinct recovery layers:

1. **Semantic transaction:** Core validates one intent and atomically commits
   canonical state, receipt, history, projection effects, and visibility.
2. **Authorized delivery:** the initiating caller admits its authorized committed
   effect immediately; other consumers receive the same fact through durable or
   exact-resource delivery.
3. **Canonical repair:** a gap, stale projection, compacted update, or reconnect
   reloads a bounded current snapshot from the owning Module.
4. **Authority replacement:** whole-Store restore or authority drift rotates the
   Store epoch and relaunches every Adapter; stale transports and local recovery
   state fail closed.

These layers must not substitute for one another. A renderer reread cannot make
an uncommitted command real. An event cursor cannot stand in for a Projection
revision. A projection invalidation cannot grant access. A Core generation
reconnect cannot hot-adopt another Store epoch.

## Completion and acknowledgement

A durable mutation is complete when Core commits its transaction and returns or
can replay its immutable receipt. When an authorized apply delivery exists,
Main admits it to the initiating renderer before resolving the feature command.
The later event stream is fanout and recovery, not a second success condition.

Response loss is handled by retrying the same idempotent intent. The original
receipt is returned without applying the mutation again. Reusing an operation
identity for different intent is a typed collision.

Optimistic presentation may continue after acknowledgement until a bounded
projection materializes the committed result. The optimistic owner must remain
semantic and identity-keyed; it cannot infer canonical success from elapsed
time, a broad cursor, or the disappearance of a component.

Read [LocalCommit and Projection Delivery](reliability/local-commit-and-projections.md)
for Manifest, wake/replay, audience, projection-freshness, visibility, and
Document-effect rules.

## Core and Store lifecycle

One detached Rust Core is the only SQLite and durable Document authority for a
Profile. Electron selects an authenticated compatible generation before
initializing Adapters and never opens the Store itself.

A definitive transport loss may reconnect to a different Core process only
when Profile, Library, and Store epoch remain identical. Stable facades,
schedulers, cursors, and logical subscriptions survive the physical generation.
Repeated failures produce one app-wide unavailable state and a bounded circuit,
not many feature-local retry loops.

Store migrations always protect the recognized source, migrate a staged copy,
validate semantic authority, and atomically publish the target. Exact accepted
source/current version inventories are executable data owned by Core migration
code and tests, not prose.

Read [Core Lifecycle and Store Reliability](reliability/core-lifecycle-and-store.md).

## Documents and collaborative state

Exact Page/Block and Canvas subscriptions establish an authorized live barrier
before canonical engine synchronization. Earlier state comes from state-vector
or full-scene sync; later effects arrive through the addressed lane. Missing or
out-of-order heads, receiver lag, generation changes, and compacted update bytes
produce typed canonical resync rather than guessed content.

A mounted writer acknowledges only durable updates. Each surface keeps its own
selection, undo origins, camera/tools, and ephemeral presence. Structural
operations flush mounted Documents and recheck exact causal heads in the same
transaction that changes ownership or placement.

Semantic history and operational update logs have different retention. Restore
creates a new forward mutation. Deleted-content collection proves complete
unreachability and permanently retires stable identities.

Read [Document Sync, History, and Retention](reliability/document-sync-history-and-retention.md).

## Page-key allocation

Page-key allocation is part of the same Core transaction that commits Page
creation or Database placement. Exact receipt replay returns the original
assignment without consuming another number. Failed transactions consume
nothing; committed archive, deletion, or relocation never releases a number.
Cross-Database moves preserve the source assignment and allocate or reuse the
target assignment atomically with membership and projection effects.

Prefix changes are revision-fenced and retain the exact previously allocated
range for historical resolution. Projection repair may temporarily hide a key,
but it cannot synthesize, reserve, renumber, or reclaim one. Whole-Store backup,
restore, validation, and retention cover namespace, prefix, and assignment
authority together. Detailed identity and allocation decisions are recorded in
[ADR 0043](adr/0043-database-scoped-page-keys.md).

## Backup, restore, and maintenance

A whole-Store backup covers the database and managed assets behind one Core
maintenance fence. Restore validates the complete candidate, journals database/
WAL/assets replacement, publishes all-or-nothing, rotates the Store epoch, and
relaunches Electron. Old outboxes, checkpoints, Awareness, and cursors cannot
replay across that epoch.

Maintenance has one canonical coordinator for integrity, compaction, retention,
collection, and vacuum. It never rewrites immutable receipts/history or removes
pinned revisions.

Read [Backup, Restore, and Maintenance](reliability/backup-restore-and-maintenance.md).

## Runtime-specific recovery

### Codex conversations

The app-server is the wire authority; one renderer owner is the visible
conversation writer. Main retains a validated relay/recovery replica and routes
followers through revisioned barriers. A gap or owner replacement requests a
fresh owner snapshot rather than merging competing transcripts.

Persisted app-server artifacts are cold recovery input. Sidebar metadata reads
do not hydrate complete transcripts. Resume, fork, archive/delete, pending
requests, and old-history behavior are specified in
[Codex Owner/Follower Streaming](product-specs/codex-thread-owner-follower-streaming.md),
[Codex Thread Transcript Behavior](product-specs/codex-thread-transcript-behavior.md),
[Codex Workspace Behavior](product-specs/codex-workspace-behavior.md), and
[Codex Managed Worktree Lifecycle Behavior](product-specs/codex-managed-worktree-lifecycle-behavior.md).

Core Workspace is the cold-restart authority for a managed Thread's execution
host, cwd, worktree path, and writable roots. Resume projects that complete
location into app-server rather than adopting a cold `thread/read` cwd. The
app-local worktree initialization activity survives renderer replacement in
Main's live conversation document but intentionally disappears with Main; it
is never fabricated into durable protocol history.

A retained worktree removal leaves either the physical worktree or a complete
snapshot ref available. Restore recreates only the authorized durable path and
keeps the snapshot on failure. Execution-location handoff journals every
external boundary and reconciles against Core after interruption, preserving at
least one complete usable source or destination. These guarantees are shared by
settings, archive, retention, automation, and host-to-host movement.

### Browser, Computer Use, Terminal, and Files

These are Main-owned runtime aggregates. Renderer surfaces hold presentation
descriptors and generation-fenced host bindings, not the runtime itself.
Unmounting, panel animation, or navigation cannot implicitly destroy or reassign
a live runtime. Explicit close/kill, owner teardown, app shutdown, or bounded
retention owns termination.

Browser guest attachment, readiness-sensitive messages, capture geometry,
downloads, and Computer Use native helpers are bounded and fail closed when the
verified runtime is unavailable. Their sandbox and peer trust requirements are
owned by [Security](SECURITY.md); product lifecycle is owned by
[Workbench Shell](product-specs/workbench-shell.md) and
[Codex Workspace Behavior](product-specs/codex-workspace-behavior.md).

Editable Files retain recoverable local drafts and use compare-and-swap save.
External changes preserve both versions in a conflict surface; close or preview
replacement cannot discard a dirty/conflicted draft silently.

### Git Review

One dedicated generation-bound worker owns each repository read plane. A stale
or canceled read never replaces a newer generation. Mutation invalidates the
same worker, and Review preserves its current visible snapshot until a coherent
replacement is ready.

The ownership decision is [ADR 0036](adr/0042-dedicated-git-read-worker.md), and
the visible contract is [Review Right Panel Behavior](product-specs/review-right-panel-behavior.md).

### Automations and reminders

Core owns definitions, schedules, occurrences, leases, run/inbox state, and
receipts. Host executors and notification delivery revalidate authority after
every async claim. Recovery defers work; it never starts an agent or notification
from a lease tied to the previous authority generation.

Read [Scheduled Route Behavior](product-specs/scheduled-route-behavior.md),
[Calendar and Reminders Behavior](product-specs/calendar-and-reminders-behavior.md),
and [Desktop Notification Behavior](product-specs/desktop-notification-behavior.md).

## Failure matrix

| Failure | Required response |
| --- | --- |
| Mutation validation/conflict | No state change; preserve authored input and return typed recovery guidance |
| Response lost after commit | Replay the immutable receipt for the same intent |
| Projection patch gap or stale read | Fence affected state and coalesce a bounded canonical read |
| Document update bytes compacted | Canonical Document resync; never fabricate an empty update |
| Exact resource authorization lost | Revoke/evict before post-state presentation; later operations reauthorize |
| Core transport generation lost | Single-flight reconnect to the same Profile/Library/Store epoch |
| Repeated Core losses | Open bounded circuit and show one app-wide Retry/Restart state |
| Document/Canvas stream gap | New exact live barrier plus canonical engine sync |
| Files external edit during local draft | Preserve local and external versions in explicit conflict state |
| Browser/Terminal surface unmount | Preserve Main-owned runtime unless explicit lifecycle closes it |
| Managed-worktree removal interrupted | Preserve the snapshot ref or physical worktree; never clear the durable Chat location to hide failure |
| Chat handoff interrupted | Reconcile the Main journal against Core's canonical execution location; finish commit or compensate while retaining at least one complete checkout. Cross-host cleanup locates an unknown completed import by its operation-scoped destination ref before deleting any destination artifact. |
| Backup or maintenance authority lost | Stop/defer remaining work; do not publish retention or notification side effects |
| Restore interrupted | Journal recovery yields the complete old or complete new Store/assets |
| Store epoch changed | Invalidate every old transport, outbox, checkpoint, lease, and subscription; relaunch |
| Unsupported/corrupt Store | Fail closed after preserving diagnostic/backup evidence where safe |
| Packaged runtime missing/tampered | Disable the dependent capability; never fall back to ambient binaries |

## Operational evidence

Testing commands and suite selection live in [AGENTS.md](../AGENTS.md) and
[Development](development.md). Choose checks from the changed reliability seam:

- semantic mutations: focused Module/receipt/idempotency tests;
- projection delivery: gap, replay, revoke, reset, and canonical-repair tests;
- Document/Canvas: exact barrier, response-loss, generation, outbox, and
  compaction/resync tests;
- Core lifecycle: selection, authentication, same-authority recovery, circuit,
  shutdown fence, and idle-drain tests;
- migrations: frozen/current inventories, backup/staging, interruption, and
  semantic validation;
- backup/restore: every journal interruption phase, asset closure, epoch
  rotation, and stale-client rejection;
- release runtime: source gate, target-specific packaged verification, signed
  dual-architecture rehearsal, and immutable Release Bundle checks.

For Core read-model or transport changes, run the repository read-budget gate
and retain its byte/request/query-plan evidence. The transport maximum is a
fault boundary, not a target for an interactive projection.

Build, signing, notarization, appcast/delta, Homebrew, landing, runtime manifest,
and Release recovery procedures belong in
[the macOS Release Runbook](release-macos.md). Release identity and supply-chain
trust belong in [Security](SECURITY.md). Do not duplicate those inventories
here.

## Documentation ownership

| Information | Owner |
| --- | --- |
| Cross-system reliability layers and failure outcomes | This document |
| Core selection, generation recovery, Store migration policy | [Core lifecycle and Store](reliability/core-lifecycle-and-store.md) |
| LocalCommit, delivery, projection freshness, visibility | [LocalCommit and projections](reliability/local-commit-and-projections.md) |
| Document/Canvas sync, semantic history, retention | [Document sync/history](reliability/document-sync-history-and-retention.md) |
| Backup, restore, Store replacement, maintenance | [Backup/restore](reliability/backup-restore-and-maintenance.md) |
| User-visible feature failure/recovery behavior | Focused document in [Product Specifications](product-specs/index.md) |
| Runtime ownership and critical flows | [Architecture](ARCHITECTURE.md) and ADRs |
| Trust, sandbox, authorization, supply chain | [Security](SECURITY.md) |
| Exact schema versions, limits, filenames, protocol versions | Source contracts, generated artifacts, and tests |
| Release procedures and operational recovery | [macOS Release Runbook](release-macos.md) |

Replace stale statements at the narrow owner. Do not append migration history,
per-file behavior, release inventories, or feature acceptance rules to this map.
