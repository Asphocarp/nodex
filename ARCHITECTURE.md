# Architecture

## Overview
Nodex is a local-first, block-based agent orchestrator for coordinating coding-agent work. The Electron main process hosts SQLite authority, an embedded HTTP Interface, and a Codex app-server runtime so CLI clients, browser clients, and the desktop renderer operate on one product model while Codex Threads run Electron-first.

Each local Profile owns one Library. Library is the durable content scope for
Blocks, Pages, Documents, Database Containers, Data Sources, Views, assets,
search, schedules, and history. Project is a separate execution context for
filesystem roots, sessions, terminals, Threads, and approval policy. Each
Project binds one primary Database and gains foreign Library access only through
explicit Page/Database resource grants or main-owned resource consent. The exact
Turn launched with Nodex's
built-in Full access preset receives a main-owned, ephemeral same-Library
authority overlay; it never becomes a resource grant. Project lifecycle never
owns or deletes Library content.

## Content and execution authority

```text
Profile
└── Library                         durable content scope
    ├── Page                        document-bearing Block
    │   ├── Document                sync/history implementation
    │   └── nested Page/Database    ownership descendants
    └── Database                    placeable Container Block
        ├── Data Source             schema + Page rows + values
        └── View                    presentation → one Data Source

Project                              execution context
├── primary Database binding        implicit recursive access
├── Page/Database grants            explicit foreign access
└── Sessions / Threads / terminals  runtime and approval
```

Every Page has one exclusive `library | page | data_source` parent. Page
ownership is a rooted acyclic forest: a move into the Page itself or any of its
descendants is invalid at both the command and SQLite boundaries. A View,
`pageRef`, relation, mention, backlink, or linked View is non-owning and never
expands authorization. Page ID equals Block ID. Document remains an independently
synchronized content owner and is not a user-facing parent coordinate.

Database is a Container with stable Block identity, metadata, lifecycle, Data
Sources, hosted Views, default View, access revision, and Project bindings. Data
Source is a non-Block relational entity that owns schema, Pages, property
values, and query identity. View belongs to a Database and explicitly targets
one Data Source. Database, Data Source, and View use independent opaque global
identities; creating a Database preallocates a UUID-v7 identity for each root
instead of deriving one from another. The first UI exposes one initial Source
per Database; linked Views, Source moves, Relations, and Add Data Source remain
future product work. Properties are local to one Source: reserved built-ins use
stable semantic IDs, while custom Properties and options use compact `p_` and
`o_` IDs with eight base64url characters.

All Database semantics live behind one deep Module with `read` and `apply` as
its Interface. Trusted HTTP, IPC, CLI, renderer, and Agent-tool Adapters bind
Profile/Library/Project/Session identity, while the Module hides binding and
grant evaluation, schema/value validation, dormant membership history,
fractional ranking, revisions, idempotent receipts, projections, and post-commit
events. Resource authorization and Codex operation approval are separate
Modules.

## Codemap

### Native Core migration and development-cutover boundary

The repository includes an additive native-Core boundary that is deliberately
not the default Electron authority yet. Bootstrap makes one process-lifetime
choice from `NODEX_CORE_BACKEND=typescript|rust` before either database path can
open; an invalid selector or attempted in-process change fails closed. Every
legacy `better-sqlite3` entry point independently rejects access after the Rust
choice. The detached Core launcher first authenticates and reuses a compatible
runtime from the fixed Profile-private descriptor, or starts the validated
development/app-bundle executable and polls the same handshake until readiness;
it never interprets process output as authority. Main initialization now routes
through that selection: the Rust branch skips the TypeScript database, worker,
maintenance schedulers, public HTTP server, and revision-flush shutdown path,
and disconnecting Electron does not terminate the detached Core. Electron
Module adapters still need to replace the TypeScript stores before the Rust
development selector can serve the full desktop workflow. The first active
proxy slices cover the established Library catalog/navigation `read`/`apply`
IPC pair, Project/Library Page Detail, and the Project catalog boundary.
Library reads use the Library connection, writes derive the actor Project from
the trusted invoking window,
and committed Core events become renderer Library or Workspace invalidations.
The event bridge is backend-neutral and active for both authority choices, so
Rust Session and Project receipts refresh existing renderer subscriptions.
Project catalog reads, creation, metadata/source updates, sidebar and pinned ordering,
and archival all pass through one Workspace Adapter. Its Session startup/list
and exact-snapshot reads hydrate the existing camel-cased IPC model from Core
without opening SQLite in Electron; Session creation/deletion, ordinary and
pinned ordering, pin, archive/restore, and unread transitions use the same
Adapter and one native aggregate each. Tab creation, metadata/state replacement,
deletion, cross-panel movement, panel split/ensure/merge/activation/resize/
maximize, leaf-local tab reorder, and composite Session view updates also cross
that boundary. Tab-only calls resolve their owning Session through an exact
Workspace read instead of scanning repositories, while delete and move carry
the Adapter-compiled final layout into the same native aggregate as the tab
mutation. Thread metadata upsert plus Session attach and guarded detach also
cross this boundary as one native aggregate. Owned Document descriptor reads
and owner preparation select the same Project or trusted Library Core scope as
subsequent synchronization; Library results remove the compatibility storage
Project before crossing IPC. Project-scoped live Yjs subscribe,
sync, update, and Awareness IPC use a lifecycle-aware Owned Document bridge;
each native subscription is bound to its Electron target, Project, Document,
and client session and is closed with the target. Library-scoped live Page
Document sync uses the root Core client and an explicit Library transport scope that the
server accepts only from trusted local Electron, native CLI, and test Adapters;
Core resolves the Page's local Library identity and read/write lifecycle itself
and never accepts an Adapter-selected storage Project as Library authority.
Project Canvas scene subscribe, full sync, and field/element mutation use the
same bridge and exact-target lifecycle but remain Project-only. Canvas and Yjs
share one client-session ownership fence, while durable Canvas events carry the
actual pre-commit authority head so replayed scene deltas retain their causal
boundary even when a stale non-conflicting intent merges.
Additional Document owner commands for Synced Blocks, Reusable Templates, and
non-primary Canvas owners use that same authority-selected Owned Document
bridge. The Rust branch submits one deep owner command to the exact Project
client and maps the native mutation effect, event sequence, and persisted
commit time back into the established receipt; it does not ask the TypeScript
Hub to coordinate or write SQLite. Renewable Document heads and connection
identity are execution evidence rather than semantic retry identity, so a
durable receipt can replay after a provider flush or Electron reconnect while
all owner, generation, placement, and content coordinates remain collision
fenced.
Immutable Owned Document checkpoint creation plus version list/detail reads use
the same exact-Project bridge. Core persists the trusted actor, revision kind,
optional mutation evidence, and materialization/checkpoint hashes in one
immutable version identity; a checkpoint receipt returns the complete public
summary and distinguishes operation replay from an already-existing identical
version. Pagination carries the full `(baseHeadSeq, createdAt, versionId)`
cursor and Core verifies all three coordinates against the retained row before
reading the next page. The Adapter validates every returned summary against its
Project, Document, metadata, and materialization boundary. Forward restore uses
a receipt-first two-phase command: Core returns an existing durable mutation
without reacquiring a lease, but a first execution fails with
`write_fence_required`. The native bridge then asks every exact Yjs or Canvas
subscription for a bounded flush/freeze ACK, rejects a resolved head that moved
past the request, and only then resubmits with trusted write-fence evidence.
Core commits the forward update, before/after restore checkpoints, semantic
Block effect, change event, canonical timestamp, and exact-retry receipt in one
writer transaction. Release carries the committed head back to each frozen
provider. Renderer/connection audit identity and the host lease are excluded
from semantic retry identity, so a reconnect or later head cannot hide an
already-committed receipt.
Project-scoped Page History reads also use the Library Module Adapter: the
renderer request selects the exact Project client, Core evaluates recursive
resource access in one read snapshot, and the Adapter maps the typed native
cursor/evidence/recovery graph through the established strict Page History
parser before IPC. Semantic Page content and the remaining deep Module adapters
stay on the migration inventory and must fail closed rather than fall back in
the Rust branch. Renderer Project Page search is now native: one
trusted root Library read accepts the requested Project sequence, evaluates
each Page's primary-Database or recursive grant authority, requires its current
Data Source workflow status, and returns the established deduplicated command-
palette projection. It is intentionally separate from Library-wide semantic
content search, whose raw Block/Document evidence serves CLI and Agent use cases.
Scheduled Automation definition CRUD, due dispatch, Codex run lifecycle, the
renderer run inbox, Calendar occurrence reads/mutations, reminder snooze, and
reminder Host delivery use one authority-selected Automation port. In the Rust
branch the trusted root client maps the established camel-cased host model to
Core-owned revisions and receipts. The scheduler claims durable expiring leases
before external execution and completes or fails that exact lease afterward;
manual dispatch advances runtime schedule state through a separate trusted
Core-clock intent. Pending-run creation, real-Thread replacement, title,
review/inbox, acceptance, archive/restore/delete, startup interruption
settlement, and definition-owned run cascade are native transitions. Archive
messages resolved from Codex transcripts are submitted with the archive
transition instead of being persisted first. Durable Automation events refresh
the host's command-only run and active-heartbeat caches and invalidate the
established renderer queries. Calendar callers retain their exact logical
operation identity through the Adapter so response-loss retries resolve the
same native receipt. The native reminder scheduler claims expiring Host leases,
displays each OS notification, and completes or fails the exact lease; snooze
actions return through the same port. The TypeScript implementation is an
explicit fallback behind that port. Electron remains responsible only for
external Codex execution, live renderer ownership evidence, transcript
observation, app-server Thread coordination, and OS notification presentation.
Store Administration backup inventory, manual creation/deletion/restore, and
automatic creation/retention use one authority-selected desktop port. The Rust
Adapter maps the complete immutable manifest projection, including trigger,
asset inclusion, and database/asset/total byte counts, while the TypeScript
implementation remains an explicit fallback behind that port. A successful
native restore has already rotated the Store epoch and invalidated every
long-lived Core client; Electron therefore returns the committed restore result
and performs a controlled relaunch so startup can bind a fresh descriptor,
client connection, and collaboration handshake. Backup settings remain
Profile-local host configuration rather than SQLite authority. In the native
branch the same port schedules bounded idle-revision finalization, Document
compaction/history retention, and physical Block retention; each Block pass
samples the Profile-local retained-tombstone setting and binds it into the Core
operation fingerprint.
Project-scoped Database Module reads and writes select one cached Core client
per Project. The Adapter translates only typed target/intent coordinates,
preserves filter/sort/config/value domain JSON unchanged, and validates both
camel-cased aggregates and atomic mutation receipts through the existing strict
Database v2 parsers. Core records operation kinds, every committed revision,
change-log sequence, and commit time inside the writer transaction; durable
Database events also retain the actor Project so Electron can publish the
existing resource-scoped Database and Library invalidations after commit.
Trusted Library Database access uses a distinct root-client capability accepted
only from local Electron-host, native-CLI, and test adapters. Core resolves the
concrete Library Database/Data Source/View itself and keeps the non-null legacy
change-ledger Project coordinate private; Library snapshots, receipts, and
events never expose or imply that compatibility owner. Electron consequently
publishes Library catalog/resource invalidations without inventing a Project.
`nodex-core-contracts` owns six
transport-neutral semantic Module contracts; `nodex-core-protocol` generates the
fixed private OpenAPI 3.1 surface and `@nodex/core-protocol` TypeScript types;
`nodex-core` contains vertical Module implementations; and `nodex-core-server`
hosts authenticated HTTP/1.1 over a Profile-private Unix socket. The thin
`src/main/core-client/` Adapter validates runtime ownership and permissions,
performs the version/nonce/Profile handshake, uses bounded codecs, and parses
committed SSE events incrementally. Global Module replay is reconstructed from
the durable SQLite change log in one read snapshot, so a process restart does
not reset the cursor. The replay window and live broadcast are bounded; a
retention gap, oversized catch-up window, or lagged subscriber receives an
explicit `core-resync-required` boundary and must refresh Module snapshots.
Document subscribers receive their existing document-specific resync boundary.
The connection registry grants one RAII lease per exact event-stream identity,
rejects duplicate live global or Document-session streams, and caps both
per-connection and process-wide subscriptions. The engine-neutral Document
Realtime Adapter enforces the same independent subscription ceiling plus
bounded Awareness publications, client ownership sets, and initial snapshots,
so another trusted local Adapter cannot turn presence into unbounded memory.
The handshake also binds its declared
Electron Host, native CLI, or test Adapter kind to a generated connection ID;
every Module and Document request must present the resulting per-start binding
capability. Core registers that logical connection against the authenticated
Unix-socket peer UID/PID, client build, negotiated protocol, and process-start
nonce; a binding cannot be replayed by a different local process or rebound to
another Adapter kind. Concurrent launchers treat `core.json` as a hint only:
the losing launcher validates owner/type/mode for the fixed runtime entries and
performs an authenticated matching handshake before reusing the winner. A PID
or stale descriptor alone never proves process identity, and lifecycle control
requires a registered Host, CLI, or test connection.

Core is detached from whichever launcher happened to win. Its lifecycle
coordinator records every successful handshake and bound request under the same
generation lock used by idle admission, so a client arriving at the idle
boundary either resets the complete period or sees an explicit draining
response. A logical client remains live while its authenticated peer PID is
live and recently registered, and stream/document/Awareness/prepared-operation,
SQLite read/write/maintenance, or due Automation work independently prevents
idle exit. The default idle period is fifteen minutes; the private launcher may
configure or disable it within the bounded Core policy. Idle exit, explicit
shutdown, SIGINT, and SIGTERM all enter the same drain state. Axum stops
accepting sockets and waits for ordinary in-flight requests/transactions, while
Core signals long-lived SSE streams to finish so graceful shutdown cannot wait
forever on a subscription.

Launchers reuse any running Core whose declared protocol range overlaps their
own, selecting the highest common version rather than requiring equal build
identities. If the ranges do not overlap, the contender authenticates to the
fixed UDS and submits an exact descriptor-generation handoff through the
existing lifecycle route. Core drains only when the same atomic idle predicate
passes; otherwise it returns a bounded busy/retry result. An accepted contender
waits for the incumbent to clean up and release the Profile store lock before
removing stale runtime entries or opening SQLite, so upgrade races cannot create
a second writer. A rejected, unverified, or legacy handoff never falls back to
process killing or stale-file deletion.

The private health route is also the bounded native observability snapshot. It
derives readiness from the lifecycle/store generation and reports only numeric
process-local evidence: writer queue and active work, accepted-command and real
`IMMEDIATE` transaction timing, Document cache/reconstruction, replay lag, WAL
bytes, backup timing, and active client/subscription/presence/prepared-operation
counts. These metrics are diagnostics, not durable product authority, and reset
with the Core process.

Native failure recovery is promoted through one executable Gate D matrix, not
an informal inference from the full suite. The matrix binds named behavior
tests for each deep transaction aggregate and for pre-transaction rejection,
post-commit Document cache/publication recovery, v82 migration, online backup,
restore journaling/runtime reset, and abrupt WAL exit. It also starts from a
fresh restricted `.generated` Profile and reports the reopened v83 Store's
durable head, integrity result, and foreign-key result. The Electron loopback
test in the same gate proves that private Core health/lifecycle/Store
Administration UDS paths remain unreachable over the public HTTP adapter.

The native Library and Database Modules now cover their complete Milestone 5
semantic surface behind those fixed `read`/`apply` pairs. Whole-Page copy is a
single Library writer aggregate: it fences source location, parent, membership,
and Document authority; recursively clones owned Page/Synced/Template/Canvas
Documents with fresh deterministic identities; and lands the result in Library,
Page, or Data Source ownership. Data Source value/View placement and
cross-Project compatibility rehome reuse Database internals inside that same
SQLite transaction rather than composing public Module calls, so one durable
Library receipt and event represent the operation.

The Project Workspace read boundary returns active Project execution contexts
and non-archived startup Sessions, or resolves an exact Project, normalized
Session panel/tab aggregate, complete Codex Thread descriptor, persisted Thread
execution context, root/child Thread collection, managed-worktree set, durable
sidebar snapshot, transcript-search results, or bounded search-backfill work.
Profile/Library Adapter identity, Project lifecycle, primary Database bindings,
JSON bounds, store epoch, and event head are validated by the Module; incomplete
bindings and cross-Library rows fail closed.
Automation now
owns its accepted definition, lease, run, reminder, and Scheduled Page
occurrence surface. Store Administration owns v83 readiness, backup listing,
online SQLite backup creation, and whole-store restore through the same
generated `read`/`apply` boundary. A backup uses a deterministic operation-owned
directory, publishes a v2-compatible manifest last, validates the immutable
snapshot, fsyncs database, assets, manifest, and directories, then commits its
receipt/event. A retry after filesystem publication but before the SQLite
receipt adopts only an exact operation/request-fingerprint match. Restore
semantically validates the complete v83 Document/Canvas/projection/managed-asset
closure, optionally creates a safety backup inside one maintenance generation,
installs through the Core-owned journal, rotates `storeEpoch`, resets Document
cache and realtime state, republishes the runtime descriptor, and clears the
old live subscriptions before committing its receipt/event; subsequent replay
is read from the installed Store's durable change log. Backup deletion
and automatic-retention pruning commit a durable logical tombstone before
best-effort physical cleanup, so a crash cannot make a deleted backup visible or
restorable and an exact retry finishes cleanup. Maintenance normalizes task
order inside the Module and owns integrity/foreign-key verification, bounded
idle Document-revision finalization, eligible Document compaction, revision
retention, and physical Block retention. Block retention preserves the
configured newest deleted Blocks per Project, then
handles at most 100 older roots per pass in independent IMMEDIATE transactions.
It derives each recursive deleted ownership closure from registered Documents,
reconstructs current Yrs/Canvas authority, decodes bounded retained history,
and scans recovery, immutable attribution, relocation, Database, Session,
reminder, and inbound-FK roots. Only expired revisions and wholly attributable
resolved recovery artifacts are pruned; immutable mutation/change evidence is
retained. Every collected identity enters `retired_block_identities` before the
verified Block/Document closure is removed, and any unclassified reference or
late constraint rolls the candidate back.

Every native Module now holds a stable `StoreWriter`/`StoreReaders` facade,
not a generation-local connection or channel. The shared store runtime admits
work only while running, counts every accepted read and write through result
delivery, and resolves each call to the current generation. Exclusive
maintenance first changes admission to `maintenance_in_progress`, drains both
counts, joins the FIFO writer, and drops the complete reader pool before its
Core-owned closure runs. It then opens and atomically publishes a replacement
generation, so all pre-existing Module facades resume without reconstruction.
The Core-owned replacement journal records only validated operation identity
and controlled staging/rollback directory names. Startup reconciles it after
the Profile lock but before opening SQLite: prepared candidates remain
adoptable, every interrupted install phase restores the complete source while
preserving the candidate, and committed installations remain live until their
matching Store Administration receipt makes cleanup safe. Public restore uses
that pending committed journal as a durable pre-receipt boundary: an exact
retry finalizes the receipt without reinstalling files, while a different
request cannot adopt it. Any pre-commit installation or runtime-reset failure
restores the complete source and resets the runtime back to its source epoch.

Project creation is the first native Workspace writer aggregate. One writer job
creates the Project/sidebar order/sources, its primary Database Block and
Library placement, complete Database/Data Source/eight built-in Property/default
View authority, active Project binding, pinned default View Session/Tab, and the
deterministic primary Canvas plus empty scene authority. Database and Owned
Document contribute internal genesis seams inside the transaction; Workspace
does not compose public Module calls or publish collaborator events. A user
creation publishes one Workspace receipt/event with exact replay, while a fresh
Profile bootstrap uses the same record aggregate before the server advertises
readiness so no half-bound default Project can exist.

The same Workspace writer owns Project metadata/source replacement, lifecycle,
sidebar order, and pinned order. Each operation validates Library ownership and
bounded canonical input, writes one receipt/event with exact replay, and keeps
the compatibility binding row synchronized through the v82 import triggers.
Metadata replacement fences the Project binding revision; lifecycle transitions
advance it, remove archived Projects from sidebar/pinned order, and append a
restored Project without renumbering surviving gaps. Multi-Project reorder events
use a deterministic Project anchor for the non-null change ledger coordinate
while carrying the complete affected order in the Workspace event.

Workspace also owns Session fallback/linked-thread titles, pinned and unread
state, and links to already-persisted Codex Threads. Link writes require the
Session, expected Project, and Thread Project to agree exactly and reject a
Thread already owned by another Session; unlink carries the exact Thread ID as a
guard. These mutations share the Workspace transaction/receipt/event boundary.
Electron remains responsible for starting Codex and coordinating an external
app-server rename; native Core persists the accepted local metadata and never
starts execution as part of a Session mutation.

Workspace also owns the durable Codex Thread launch descriptor independently of
its optional Session link. Presence-sensitive upsert patches cover Project,
lineage, display/service/agent identity, working-directory/worktree and
projectless coordinates, protocol-derived status, archive state, and immutable
creation/link timestamps. Separate semantic intents own root-only global pin
order, unread state, dynamic-tool catalog selection, Project permission-mode
selection, and Thread deletion. An execution-context read combines the exact
Thread, its Project binding, current permission mode, and sorted tool catalogs
from one snapshot. Invalid protocol status, oversized metadata, cross-Library
Projects, duplicate Session ownership, and a Thread/Session Project mismatch
fail closed. Electron still hosts codex-app-server and supplies accepted runtime
observations; reading or persisting this context never starts a process.

The same Thread aggregate owns host-observed execution continuity without
moving process execution into Core. Only a trusted Electron Host Adapter may
freeze an exact Thread/Turn authority row; Core derives Profile, Library,
Project, store epoch, scope, permission-profile provenance, and the
JavaScript-compatible fingerprint, then relies on immutable SQLite triggers to
prevent later update or deletion. A missing historical row resolves to the
bounded Project fallback, while an existing row from another epoch or actor
fails closed and is never replaced by broader authority. One inherited
full-access Turn must name an exact persisted Library-scope parent Turn.
Per-Thread writable workspace roots are ordered Core rows with Thread-cascade
lifecycle; v83 imports the former profile JSON projection once and retains the
file only as rollback evidence. Background-process observations remain records
of Electron-owned app-server or terminal work: Workspace validates and bounds
their Thread identity, preserves restart time according to the semantic intent,
and prunes the global durable collection atomically with its receipt/event.

Workspace also owns the durable sidebar/search projection around those Threads.
One snapshot returns eligible root Threads together with Project-lane and
projectless manual identity order. Project order set and clear are distinct
intents, projectless reorder replaces only the caller's visible slots, and a
cross-Project Thread move atomically updates Thread and Session ownership,
browser-tab ownership, metadata, search-unit scope, and every affected Project
manual order. Project and projectless lanes are explicit contract variants, so
absence never doubles as an ownership coordinate. Electron continues to observe
Codex app-server content and extracts only bounded user/assistant transcript
units; Core admits that projection only at the exact current Thread
`updated_at`, owns the FTS5 index, retry clock, stale-work selection, eligibility,
and snippets, and emits the normal Workspace invalidation event after commit.
Generic persisted renderer atoms remain shell-owned until their owning semantic
Module adopts a typed field; Core does not provide a catch-all JSON persistence
surface.

Workspace owns the durable Session panel/tab aggregate as well. The versioned
contract names the target panel, tab kind, optional browser identity, and target
leaf instead of asking an Adapter to reconstruct those facts from JSON. Core
validates kind-specific tab configuration against the Session Project, resolves
and authorizes active Database Views, preserves review/Database-View uniqueness,
normalizes bounded v2 split trees, and persists layout plus depth-first flat tab
order in one receipt/event transaction. Create/focus, layout replacement,
cross-panel move, and delete all keep each durable tab in exactly one leaf;
delete/move prune non-final empty leaves while ordinary layout replacement may
retain an explicitly visible empty leaf. Typed view-state patches own left-pane
collapse plus right/bottom collapse and size without rewriting tab timestamps.
Tab metadata updates rerun kind-specific validation and Database View
authorization, while opaque versioned tab state is replaced as one bounded
`state_key`/JSON pair. Page Stage config retains its independent content Project
instead of being rewritten to the owning Session Project.

Session collection lifecycle is owned by the same Workspace boundary. Creation
uses an explicit retry-stable identity and inserts at the head of the target
Project or projectless order. Ordinary and pinned reorder intents preserve the
established partial-order behavior over non-archived Sessions; archive clears
pin/unread state and restore retains the sparse order. A Project move is allowed
only for an empty or browser-only Session and atomically rewrites the Session,
every browser tab's owner/config, and any linked Codex Thread before publishing
one Workspace receipt/event. Deletion cascades the panel/tab and Thread-link
aggregate without deleting the independently owned Codex Thread.

The native Automation Module now owns Scheduled Automation definitions and due
work leases in SQLite. v83 adds an optimistic definition revision, imports the
former profile jitter salt once, and retains the old TOML tree only as legacy
rollback/export evidence; native mutations never reconcile two writable
definition authorities. Typed create/update/delete intents validate cron versus
heartbeat shape, canonical absolute execution paths, target Thread existence,
RRULE bounds, and the one-active-heartbeat-per-Thread invariant. Core computes
the next local-calendar occurrence and deterministic profile jitter on its own
clock. A trusted Electron Host may claim bounded due work without advancing the
definition, and receives a durable expiring lease; completion advances
`last_run_at` and the next occurrence, failure records a bounded reason and
optional retry, and an expired lease can be reclaimed with a higher attempt.
Without a Host claim, due work remains durably pending. Every transition shares
the normal store-epoch, exact-receipt, change-event, and same-transaction
boundary. The authenticated UDS handshake binds the connection's Adapter kind,
and a native CLI connection is rejected before any claim or settlement logic.

The same native Module owns the Scheduled Automation run aggregate. A trusted
Host records a retry-stable pending run before external Thread creation, then
atomically rekeys it to an existing Codex Thread; every subsequent title,
review, inbox, read, acceptance, archive, restore, and delete transition is
fenced by `run_revision`. Inbox rows and unread counts come from one read
snapshot. Startup interruption recovery deterministically archives unresolved
`pending:` runs and moves real in-progress Threads to review in bounded batches;
definition deletion removes its complete run collection in the same receipt and
event. Electron remains the Codex executor and transcript observer, but it no
longer owns run state or composes archive-message persistence with a separate
lifecycle write.

Scheduled Page occurrence reads and reminder delivery are now native Automation
semantics. One SQLite snapshot validates recursive Project access, the schedule
index revision, current Document generation/head/schema, Data Source property
coordinates, and the exact materialized title/body before expanding bounded
local-calendar occurrences. Recurrence preserves IANA wall-clock behavior across
DST gaps/folds, inclusive end dates, exceptions, all-day date spans, and the
established post-first-occurrence millisecond precision. Reminder claims are
trusted-Host-only durable leases: claiming does not record delivery, expiry can
be reclaimed, completion atomically records the existing unique reminder
receipt and consumes due Project-owned snoozes, and failure retains bounded
retry evidence. Recursive-grant duplicates collapse to one delivery coordinate
and prefer the active content-owning Project. The complete/skip/update
occurrence aggregate now enters the same Automation writer boundary. Callers
provide one logical operation identity and preallocate a UUID-v7 whenever the
intent may clone a Page. Complete clones the exact occurrence as an archived
`ship` Page and advances or excepts the recurring source; skip records the same
recurrence identity and advances only the current occurrence; update owns
one-time, whole-series, detached-occurrence, and this-and-future split
semantics. Recursive owned Documents, Data Source values, View placement,
schedule projections, recurrence exceptions, the source transition, and the
single Automation receipt/event commit or roll back together. Deterministic
request failures persist as replayable rejected receipts without a change-log
row, including across authenticated Adapter changes.

The complete Automation Host boundary is active behind the Electron Rust
development selector, including durable execution and reminder leases,
Calendar occurrence reads/mutations, snooze, and committed event invalidation.
Generated protocol artifacts are byte-verified, and dependency audits prevent
UDS routes from importing SQLite, deep Modules from importing transport code,
or the Electron client from reaching the local store.

### Shared Contracts (`src/shared`)
- `types.ts`: canonical product read models (`Page` detail payloads, internal full-board shapes, `PageSummary`/`BoardSummary` lightweight View projections, `Project`, and project session/tab/thread-link payloads). Page is a document-bearing Block and has no second storage identity; `Card` is reserved for visual components.
- `codex-conversation-state/codex-conversation-state.ts`: protocol-backed Codex conversation core. Generated `ThreadItem` and `ServerRequest` envelopes remain the single raw-field authority; request-caused synthetic rows are an explicit non-protocol union, and turn timing/diff/context lives in a separate sidecar. Its constructor requires complete caller-supplied app-side params and a fully loaded `itemsView: "full"` envelope for every hydrated turn, fails closed rather than inventing unavailable model/permission/attachment context, and preserves protocol item/request identity. `codex-prompt-preparation.ts` compiles renderer-owned prompt text and app sidecars once into exact app-server input so optimistic start/steer state and transport share one client identity and payload.
- `codex-canonical-item-projector.ts`: exhaustive typed canonical-turn projection boundary. It switches directly on generated and app-local item discriminants, owns each item's zero/one/many display policy, last-work completion, per-item turn-status dependencies, command expansion, feature-gated subagent rows, and consecutive image-view folding, and never reparses canonical items through unknown records or alias keys. Whole-turn projection owns the params-sourced user row before raw items, blocked-delivery state, and structural suppression of the matching raw user echo. Canonical lifecycle diffs project the complete turn once, then publish the dependency-affected raw-owner closure so last-work, status, raw-order, and image-run neighbors update without replacing unrelated streaming rows; projected rows carry explicit raw item id/type identity and owner-following overlay segments move with their raw owner. App-local turns keep their honest nullable protocol id; their canonical array occurrence owns the stable `turnId ?? turn-index-${index}` projection key, so multiple local optimistic, goal, worktree, provenance, compaction, or error turns never enter a nullable-keyed map or acquire a fabricated protocol id. Main resume, older-page, complete-history, rollback, and include-turn read materialization consume canonical turn state directly through this boundary; protocol-only automation extraction uses the generated `Turn`/`ThreadItem` unions without entering transcript projection. `codex-protocol-thread-item.ts` fails malformed JSON/IPC lifecycle items closed before canonical reduction, so no permissive projection or readiness branch exists.
- `codex-mcp-tool-call.ts`: pure MCP tool-call projection boundary. It derives the stable renderer activity leaf from the generated `mcpToolCall` item plus owning turn status, normalizes only schema-valid content blocks, preserves result/error/unknown-block identity, and resolves tool/result MCP-app resource metadata against the unflattened `ListMcpServerStatusResponse` without writing query context into canonical conversation state. `codex-app-info.ts` normalizes the paged generated app list once at ingress, including square-asset light/dark precedence and install-relative URLs. A second late visual projection consumes only that stable leaf and normalized `AppInfo[]`, with one exact priority (`tool-surface/native identity`, then first matching app alias, then trimmed server fallback) shared by grouped facts, leaf icons, and summary sources; raw item/logo guess trees are not an identity source.
- `project-session-panel-layout.ts`: pure recursive split-tree helpers for v2 right/bottom project-session panel layouts, including normalization, leaf/tab movement, split/merge, active/MRU leaf tracking, and ratio clamping.
- `workbench-layout.ts`: canonical serializable workbench layout snapshot types.
- `command-keybindings.ts` and `workbench-commands.ts`: canonical editable accelerator registry plus the typed Workbench command/host-ingress contract shared by Electron, preload, and renderer.
- `ipc-api.ts`: typed IPC channel surface between preload/renderer/main.
- `content-access-context.ts`, `library-module.ts`, and `library-module-transport.ts`: strict Project-versus-Library route selectors plus the transport-neutral Library navigation/structure Interface. Public Library requests never name a Profile, Library, or compatibility Project; reads expose bounded root/Page/View/path/catalog/content/search/history projections, while exact-retry writes create, move, archive, restore, and recursively grant Page/Database resources using stable identities and revision evidence. Page history is one Project-authorized, source-cursor timeline over immutable Document revisions and attributable mutation/relocation evidence; it never exposes tables or fabricates whole-Page inverses.
- `codex-hooks.ts`: generated-protocol aliases plus the host-scoped Hooks list, state-patch, and change-event contracts. Hook identity and source metadata remain app-server-owned; local settings code does not reconstruct plugin identity from paths.
- `block-documents/*`: transport-neutral Block/Owned Document Interfaces; one DOM-neutral custom BlockNote config set; canonical Page/body-only Y.Doc schemas; engine-neutral descriptors; normalized Canvas scene contracts, reconciliation, and sync/HTTP codecs; headless NFM or scene materialization into stable identities, references, search text, and assets; structural validation; portable Y.Xml subtree operations; and stable-ID Document mutation batches. Pending file Blocks with an empty source remain valid collaborative content while asset projections contain only resolved non-empty sources. Public exclusive-parent Move/Copy contracts live in `block-transfer*`; renderer specs supply React/DOM implementations while authority-side codecs remain non-rendering.
- `additional-document-commands.ts` and `additional-document-command-transport.ts`: versioned logical ownership commands for Synced/Template sources and non-primary Canvas owners, exact-retry receipts, global reference-guarded tombstoning, Project scoping, and host-bound audit identity shared by Electron, HTTP, renderer, and CLI callers.
- Project-to-Project product ownership transfer is absent by design. Pages remain in one Library; ordinary Project access changes through binding or resource grants. Full-access Agent operations may atomically change the private compatibility `project_id` of a complete Page ownership closure while preserving Library identity and stable Page/Block/Document IDs.
- `database-module-v2.ts`, Page drag compilation, `database-events.ts`, and `fractional-rank.ts`: strict transport-neutral Database `read`/`apply` Interface, explicit Database/Data Source/View targets, Source-scoped Property/option coordinates, one-snapshot multi-Page drag compilation, resource-addressed post-commit invalidations, and the shared fixed-width fractional-order planner. Durable View filters are bounded recursive expressions; atomic value/position intent, select options, and logical Page anchors use stable application identities while callers never submit physical rank strings.
- `block-transfer.ts`, `block-transfer-transport.ts`, and `block-ownership-copy-plan.ts`: the versioned same-Project exclusive-parent Intent/receipt, trusted public transport binding, and recursive ownership-only Copy planner. Public Intent carries stable identities and logical parents only; exact SQL/Yjs freshness is writer-compiled.
- `codex-thread-title.ts`: shared thread-title sanitization and bounded cache helpers used by both main and renderer.
- `schemas/*`: runtime boundary schemas for persisted renderer state, workbench layout snapshots, Codex settings, HTTP bodies, Codex session replay JSONL lines, and transcript special-item/raw JSON payload families.
- `page-limits.ts`: centralized Page payload and field size constraints.
- `assets.ts`: stable `nodex://assets/` URI helpers.
- `nfm/*`: shared internal parser/serializer core for the public Nested Markdown format, used by both main-process storage logic and renderer editor adapters; the path and canonical internal types retain their established NFM names.
- `nodex-agent-tools/*`: revisioned Agent contracts and pure Adapters. Current contracts expose Page/Data Source intents, inline-Markdown titles, public `markdown` fields, sparse result projections, recovery vocabulary, and deterministic catalog/result budgets while retaining older revisions only for historical transcript parsing. The shared schema never accepts caller-authored Project, Library, grant, or storage-revision authority.

### Main Process and Data Layer (`src/main`)
- `bootstrap.ts`: early Electron lifecycle entrypoint. It resolves the Nodex home, publishes the canonical absolute path as `NODEX_HOME`, scopes `userData`/`sessionData`, owns the profile-scoped single-instance lock and deep-link queue, runs the packaged macOS Applications prompt, and dynamically imports the application runtime.
- `main-runtime.ts`: application runtime startup (startup-init gating, DB init with migration progress fanout, HTTP server start, multi-window registry, app-update service, notifier fanout, renderer permission policy, and shutdown handlers). The app session allows clipboard writes only from top-level app windows; Browser sidebar partitions and embedded/subframe content do not inherit that permission.
- `instance-scope.ts`: applies Electron `userData` + `sessionData` paths under the resolved Nodex home so each configured Profile owns its own process-lock scope.
- `http-server.ts`: Hono routes for Profiles/Libraries, Projects and bindings/grants, project sessions/tabs/thread links, Pages, Database/Source/View reads and writes, history, backups, assets, and access-bound Owned Document preparation/synchronization/mutation/version checkpoints. Yjs sync uses bounded binary envelopes; Canvas scene sync uses bounded canonical JSON; stable-ID Agent mutations and immutable Document-history commands use bounded JSON with host-bound identity. Realtime delivery is filtered through the Project's effective Library scope while Yjs Awareness remains ephemeral. Preparing a Page Document is an explicit writer command, never a renderer ID convention.
- `ipc-handlers.ts`: mirrors core operations through IPC, including lightweight board-summary fetches, on-demand Page detail/search channels, authority-selected Calendar occurrence reads/complete/skip/update commands, Project session mutations, side-chat start/discard requests, native context menu selection, asset-path resolution, clipboard paste inspection, prepared owned-Document descriptors, binary Block Document subscription/sync/apply/Awareness, immutable Document version list/get/checkpoint/restore, stable-ID Document mutations restricted to trusted main-frame windows, and the narrow Hooks registration in `codex-hooks-ipc-handlers.ts`. Backup IPC is registered through `store-administration-ipc-handlers.ts` against the same authority-selected port used by the host scheduler; a native restore schedules a controlled Electron relaunch after its receipt returns. Hook state writes broadcast a host-scoped change only after the app-server config write succeeds.
- `block-mutation-writer.ts`, `block-mutation-worker.ts`, and `block-mutation-worker-protocol.ts`: the single asynchronous SQLite writer seam. IPC/HTTP handlers enqueue Page lifecycle/parent, Block property/Database Module, stable-ID Document, owned-Document preparation, Yjs sync/apply, Canvas scene, transfer, history, binding/grant, and maintenance commands into one FIFO worker. It owns the SQLite connection and bounded Y.Doc cache for `block_tree`, while normalized Canvas authority is relational; typed receipts return only after durability.
- `local-store/local-profile-library.ts`, `content-resource-authority.ts`, and `library-module-runtime.ts`: resolve the one local human Profile/Library independently of visible Project lifecycle, bind trusted application-window or loopback authority, and implement bounded Library navigation plus structural commands. Private compatibility ownership is selected only inside the worker; Library Page Detail, Database, Property, and Owned Document results expose `accessContext: { kind: "library" }` and never expose that storage Project.
- `library-module-ipc.ts`, `library-module-http.ts`, and the Library event stream: equivalent trusted adapters and resource-addressed post-commit invalidation for Project-independent Library windows. Library events are hints to refetch authority, not content payloads, and remain useful when every Project is archived.
- `document-sync-hub.ts`, `document-sync-runtime.ts`, and `document-sync-http.ts`: one targeted realtime plane shared by browser clients and the TypeScript desktop backend. It requires subscribe-before-sync, evaluates current Project resource access, fans out durable engine-discriminated updates, keeps Yjs Awareness ephemeral, and repairs Canvas gaps with canonical full-scene sync. `BlockTransfer`, Additional Document commands, and identity-destructive Agent operations reuse one short per-surface flush/freeze lease. The Rust desktop bridge registers its native Yjs/Canvas subscriptions with the same pure lease coordinator and owns restore preparation/release without invoking the TypeScript Hub. Editability changes in place without remounting parent EditorViews/nested participants; an accepted provider lease may drain headlessly past visual teardown. Post-commit resync dispatches through the registered engine.
- `block-transfer-ipc.ts` and `block-transfer-http.ts`: equivalent trusted Adapters for logical same-Library parent Move/Copy. They replace caller audit/scope identity, evaluate Project access to source and target, and return binary Document commits natively over IPC or as bounded base64 over HTTP.
- `additional-document-command-ipc.ts` and `additional-document-command-http.ts`: equivalent public boundaries for Additional Document commands. They reject unavailable capabilities, validate route scope and bounded JSON, replace caller attribution with trusted host identity, and preserve typed outcomes. Desktop IPC selects the Owned Document Module bridge under the Rust authority; the loopback HTTP path continues through the TypeScript Hub until its Core client boundary is enabled.
- `ipc-safe-send.ts`: centralized one-way renderer notification helper for main-process IPC fanout. It checks `BrowserWindow`/`webContents` lifetime before sending, treats disposed-frame races as debug-only lifecycle skips, and rate-limits unexpected send warnings.
- `codex/renderer-client-router.ts` and `codex/codex-renderer-view-registry.ts`: main-process renderer-client boundaries for Codex thread coordination. The router assigns stable client ids per `webContents`, sends targeted main-to-renderer requests, validates responses against the target `webContents`, rejects pending requests on timeout/destroy, reports disposed clients to Codex owner/follower coordination, and provides registry-backed Codex host-message fanout. The view registry independently tracks which renderers are actively presenting each task and selects the most recently activated client for local-only request UI; presentation never adopts canonical conversation-state ownership.
- `clipboard-paste-inspector.ts`: best-effort Electron clipboard inspection for pasted absolute file/folder paths across supported native formats.
- `git-action-service.ts`: main-process status, commit/message-generation/push, and cancellation boundary for native Git workflows. An `operationId` is registered synchronously before directory/status preflight, and one AbortSignal spans preflight, optional message generation, Git child processes, and final cleanup; cancellation never depends on a renderer delay or mutation having already started.
- `git-review-service.ts`, `git-review-live-service.ts`, `git-review-repository-watcher.ts`, and `file-watch-host.ts`: generation-bound Git Review read plane. Main canonicalizes each local repository as `(hostId, real commonDir, real root)`, so cwd aliases, metadata, snapshot state, and reference-counted watcher hubs share one identity. Repository metadata, local/remote base branch, branch commits, and live metadata summaries are separate from partial diff bodies; the live registry serializes debounced refreshes, publishes tracked/complete phases where applicable, cancels every method by request identity, waits for refresh/recovery generations to settle, and upgrades a non-repository initialization watch when `.git` appears. Repository events advance watched snapshot generations before method-specific routing; stale reads fail closed, search streams with an internal generation fence, and full context uses byte-safe batched `git cat-file`. Mutation services invalidate the same repository generation seam.
- `local-store/config.ts`, `database.ts`, `schema.ts`, `shipped-schema-migration.ts`, `shipped-schema-v26.ts`, and `notifier.ts`: profile resolution, SQLite connection/init, ordered release migrations, shipped-source staging import, integrity/ownership validation, and post-commit change fanout. Runtime authority has one persisted Profile/Library; Library-owned Blocks use exclusive Library/Page/Data Source parents; Page Documents select `yjs`, Canvas selects `canvas_scene`; Database Containers own Sources/Views while Sources own schema/Pages/values; Project records own binding/lifecycle/grants only. Legacy v26/v57 and release-chain Project/Card/Database-as-schema coordinates are migration input, not runtime alternatives. `database.ts` also performs the historical `kanban.db` to `nodex.db` filename migration before SQLite opens.
- `local-store/block-first-finalization.ts`, `block-first-legacy-schema.ts`, `legacy-card-shadow-*`, and `foreign-reference-migration.ts`: private shipped-import implementation. They run only against the staging snapshot, drain legacy Card snapshots into Y.Docs, convert foreign bodies into childless Block/Database View references, and delete Card-first storage before the candidate is published as v58. They are not startup entry points or runtime content authorities.
- `local-store/block-document-store.ts`, `block-document-cutover.ts`, and `block-document-change-set.ts`: the durable Yjs `block_tree` persistence boundary. It initializes from one validated genesis update, reconstructs from the latest snapshot plus ordered update tail, verifies each exact blob, rejects unresolved Yjs dependencies, validates the registered schema/global Block registry/state vector, derives authoritative touched Block IDs, reconciles projections, and advances `headSeq` only inside the committing SQLite transaction. Since equivalent Y.Docs need not have byte-identical full-state encodings, `state_hash` fingerprints the current physical reconstruction and is CAS-repairable only after those stronger checks pass; it is not cache or CRDT identity. Verified full-state snapshots may idempotently prune covered update payloads while immutable receipts retain late-retry identity. Canvas does not enter this update/snapshot pipeline.
- `local-store/canvas-scene-store.ts`: normalized `canvas_scene` authority. It reads bounded full canonical scenes and merges idempotent element/app-state/file mutation intent in one SQLite transaction, advances the scene head only for effective changes, records immutable receipts, validates assets/references, and refreshes exact-head projections without retaining Yjs causal history.
- `local-store/block-document-projections.ts` and `page-search-store.ts`: rebuildable Library-scoped FTS and asset projections from exact current materialization plus the Document Block index. Genesis, ordinary updates, reference repair, and relocation refresh them inside the authority transaction. Scoped queries require exact generation/head and current Project grant evaluation; Page search joins current Page lifecycle, Source/property authority, and optional View evidence without requiring a manual position.
- `local-store/block-property-mutations-v2-store.ts`: strict Source-scoped field/path mutation kernel for intrinsic Block and Data Source properties. Scalar fields use independent revision CAS, set-like properties use add/remove intent, status and grouped View position change together, and typed values, Block metadata revisions, canonical `block_mutation` history with before/after field evidence, plus the immutable accepted/rejected receipt commit in one IMMEDIATE transaction. Exact retries replay the receipt; reusing a mutation ID with another canonical request is rejected.
- `local-store/database-module-v2-runtime.ts`, query compilation, authorization evaluation, and fractional ranking form one deep Database Module. `read` resolves project-default/Database/Data Source/View targets; `apply` atomically creates Containers from independently preallocated Database/Data Source/View identities or mutates Source schema, Page parents/values, Views, and Page positions. Logical Page anchors resolve across the complete unfiltered View group; the first explicit reorder of a group with optional positions atomically materializes its existing deterministic order before inserting the moved run. The Implementation owns active/dormant membership, exact retries, revision conflicts, grant closure, schema slices, projection repair, and post-commit events. Returning to the same Source restores dormant values; moving to another Source starts with defaults and performs no implicit mapping.
- `local-store/block-document-operations.ts`: stable-ID Agent operation authority over an existing primary Y.Doc. It validates and prepares ordered title/insert/update/delete/move batches on a detached clone, commits the relative update, registry/index/materialization/search projections, `change_log`, immutable `block_mutations` receipt, and linked semantic Document revision in one exact-head transaction, and compiles explicit NFM replacement plus an optional rich-title replacement into the same Yjs update. Identity-destructive update/delete/move operations require a trusted write fence; their exact invalidated application IDs become durable structural barriers so a stale overlapping Yjs update is retained as a recovery artifact instead of creating ghost content. Tombstoned Block IDs are never reused. A read-only committed-result seam lets a separately bound host call receipt recover an already durable mutation without retaining or replaying its request body.
- `local-store/scheduled-page-store.ts`: typed scheduler/Calendar reader and projection refresh. It requires current Page metadata, a ready exact-head Document, valid Source/property coordinates when Source-defined schedule fields participate, and current Project resource access before expanding occurrences. Calendar, reminder catch-up, and snoozes use this Module; property mutations refresh the index atomically.
- `local-store/block-transfers.ts`, `block-relocations.ts`, `library-content-rehome.ts`, and `document-relocation-lease-coordinator.ts`: same-Library ownership Move/Copy authority. The writer prepares exact Library/Page/Data Source parents, recursively follows owned Documents but never references, and commits parents, active/dormant Source state, Page View positions, engine updates, projections, history, and immutable receipt together. Cross-compatibility-owner Page transfers freeze the complete rehome plan before mutation and apply it after logical parenting but before target Document materialization. The typed rehome boundary separates actor, source compatibility owner, and target compatibility owner, verifies closure/FKs before commit, and records immutable relocation members while Page/Document identity remains Library-global.
- `local-store/projects.ts`, binding/grant storage, and `project-sessions.ts`: Project CRUD/lifecycle, primary Database binding, resource grants, source-folder run context, project-owned/projectless sessions, panel layouts, tabs, thread links, ordering, archive/unread state, and derived display titles. Project creation binds or creates a Database and seeds a pinned default-View session; Project deletion retires execution records only.
- `local-store/page-read-store.ts`, `pages.ts`, `board-read-model.ts`, and `page-occurrences.ts`: Page reads assemble identity/lifecycle/revisions from canonical Page authority, the exact current Document materialization, optional Data Source membership/property values, intrinsic Block properties, and optional View placement in one SQLite snapshot. Board compatibility reads scope rows to the Project's bound Database; Page Detail and Page Target remain membership-independent. Occurrence commands compose typed schedule-property mutations with authoritative Y.Doc cloning and relational values. Kanban is one View over one Data Source, not Page existence authority.
- `local-store/page-history.ts`, `document-versions.ts`, `document-revision-session-store.ts`, and `document-revision-maintenance-store.ts`: the canonical Page-scoped history projection and immutable semantic Document Revision module. Human Yjs edits retain pre-burst safety plus active/idle revisions through durable session state; strict commands link their resulting revision to mutation evidence; Page history collapses that pair into one restorable content entry and keeps non-content evidence as Activity. BlockTree v2 revisions store stable-ID BlockTree plus rich Page title and rederive NFM on read; legacy Yjs and Canvas formats remain readable. Restore records pinned before/after revisions and appends a current-head forward mutation. A worker-owned scheduler finalizes idle/crash-surviving sessions, shutdown forces dirty finalization, and deterministic retention tiers only unpinned rows.
- `local-store/description-revisions.ts`, `legacy-card-shadow-*`, and `foreign-reference-migration.ts`: shipped-schema staging-import helpers. They are unreachable from current-store editing/history paths, and their backing tables are absent from a published v58 store.
- `local-store/block-retention-gc.ts`, `block-retention-maintenance.ts`, `block-retention-maintenance-store.ts`, and `block-retention-maintenance-scheduler.ts`: fail-closed tombstone retention planning and production collection. The background scheduler samples the current store epoch and retention setting, then submits one bounded all-Project pass through `BlockMutationWriter`. Each candidate rechecks global reference/history/recovery reachability in an IMMEDIATE transaction, prunes only attributable expiring evidence, preserves immutable mutation/change receipts, permanently records every removed application ID in `retired_block_identities`, and removes a verified ownership closure or nothing.
- `local-store/reminders.ts`, `backups.ts`, `assets.ts`, `primary-canvas-document.ts`, `canvas-scene-store.ts`, `canvas-scene-authority-reader.ts`, and `sql-inspection.ts`: the explicit TypeScript-oracle reminder and whole-store backup/restore implementations, managed asset storage, deterministic primary Canvas ownership/migration, normalized scene authority, and read-only SQLite inspection. Desktop reminder delivery and backup scheduling/IPC depend on their backend-neutral Automation and Store Administration ports rather than importing these stores in the Rust branch.
- `local-store/page-input-validation.ts`: shared Page write validation used by all mutation paths.
- `logging/logger.ts`: structured backend logger with child scopes, sensitive-field redaction, bounded payload serialization, independently filtered console/file/observer sinks, and a profile-scoped bounded JSONL writer under `${NODEX_HOME}/logs`. The file sink uses size-based segments, a global byte budget, a priority-aware bounded queue, stream backpressure, retention pruning, and shutdown flush; dev/unpackaged runs enable console `warn+`, file `info+`, and observer `warn+` by default, while packaged diagnostics remain opt-in.
- `window-session-state.ts`: profile-scoped persisted Electron window-session catalog with per-window layout snapshots, restore-policy selection support, focus recency, and saved window bounds.
- `terminal-manager.ts`: integrated terminal owner for session terminal ids, including typed `terminal-*` IPC, xterm attach snapshots, owner checks, 16k buffer retention, node-pty local backend lifecycle, restart actions, and `read_thread_terminal` snapshot lookup.
- `codex/codex-app-server-client.ts`: global JSON-RPC client for `codex app-server` stdio lifecycle, handshake, request correlation, reconnect/backoff, and wire-level typing against the committed `@nodex/codex-app-server-protocol` workspace package.
- `codex/codex-service.ts` and `codex/codex-nodex-agent-authority.ts`: domain facade for account/auth, thread/turn actions, sidebar thread sync/snapshot/pin APIs, external thread session materialization, background-terminal controls, side-chat forks, approval and user-input handling, packaged runtime resolution, canonical conversation state, state-owner routing, authorization-presentation routing, and shell/control events. New eligible Project-bound root tasks start with the static ten-tool `nodex_app@5` catalog. Main persists Nodex's selected permission preset separately from raw Codex config, verifies both before granting built-in Full access, then freezes Project or Library authority before each Project-bound Turn and atomically binds it to the first trusted exact Turn ID; app-server background child Turns may inherit only the exact parent Library authority captured at spawn, while independent created tasks do not. The durable catalog selects execution and existing tasks are never mutated on resume.
- `agent-tools/read-service.ts` plus `agent-tools/read-v3.ts`: transport-neutral, Project-authorized Agent read facade and Page-first v3 projection. One worker command captures effective Library grant scope, Project/change cursor, Block/Document exact-head materializations, Database/Data Source/View/value/placement state, and hybrid fuzzy metadata/FTS evidence in one deferred SQLite transaction. The v3 Adapter resolves `search → fetch`, saved-View queries, ad-hoc Data Source queries, canonical Nested Markdown, and narrowly prepared title/body/Block ETags from that snapshot without exposing Document IDs or value validators by default.
- `agent-tools/document-edit-service.ts`, `agent-tools/page-update-v3.ts`, and `shared/nodex-agent-tools/document-edit-compiler.ts`: one canonical Document mutation/receipt boundary behind `update_page` and `advanced_update_page`. The Page Adapter derives the owned Document from `pageId`, parses inline-Markdown titles, and translates public Nested Markdown or stable-Block intent. The pure compiler applies simultaneous exact patches, structural multi-Block insertion, guarded whole-body replacement, rich-title replacement, or ordered stable-ID edits against one current materialization and derives the complete semantic effect set before execution. Only the Document Hub may execute the resulting mutation and acquire a write fence.
- `agent-tools/create-service.ts` and `agent-tools/call-receipts.ts`: exact-destination Page creation coordinator and shared dynamic-call identity ledger. `create_pages` validates one to sixteen complete Page drafts, deterministically allocates each ownership closure, prepares one shared destination/Document lease, and preserves input-order placement under one outer transaction and public receipt. Page lifecycle genesis, Block transfer, Data Source membership/value/View changes, result replay, and rollback reuse the canonical kernels; no partial batch becomes observable.
- `agent-tools/transfer-service.ts`: Page-only v3 move/duplicate coordinators over canonical BlockTransfer and Database kernels. `duplicate_page` copies one complete ownership subtree with fresh deterministic identities. `move_pages` infers every logical parent, deduplicates Document leases, rebases sequential same-target heads inside one outer transaction, and preserves final input order; same-Source movement compiles directly to grouped placement/value intent without detaching membership.
- `agent-tools/dynamic-service-v3.ts`, `agent-tools/authorization-broker.ts`, `local-store/project-resource-grants.ts`, and `codex/nodex-agent-dynamic-tool-runtime.ts`: unified resource-authority and consent boundary for all ten `nodex_app@5` tools. Every Nodex call executes directly in main with frozen Turn authority and never detours through the canonical conversation-state owner. The planner classifies each resource intent as direct, consent-eligible, or denied before tool execution. The primary Database and recursive `read_write` grants execute directly; `read` grants require consent only for writes; known ungranted same-Library targets require resource-scoped consent. One-call overlays bind exact call identity, task overlays bind root task/Project/Library/store epoch and survive renderer replacement, and Project consent persists only Page/Database grants through the writer. Library-scope Turns auto-approve without a card. Writes in every path perform mutation-free prepare/reprepare, compare exact semantic and ownership footprints, and execute through the existing Hub/writer boundary. Turn/provenance-bound receipts replay exact committed calls without prompting or mutating again, while missing prepared provenance and same-call/different-input collisions reject.
- `codex/dynamic-tool-catalog-metrics.ts` and `shared/nodex-agent-tools/budgets.ts`: pure production catalog serializer and deterministic context-budget gate. It measures the exact namespace JSON published to app-server, separates eager and complete catalogs, and caps each selected tool without loading stores, renderer assets, or the Agent execution singleton.
- `thread-goal-attachments.ts`: main-owned goal attachment boundary. A registry-backed pasted-source manager owns individual temporary files and retries interrupted removals, while a separate process-lifetime manager owns recursively removable materialized goal directories. Both resolve under `$CODEX_HOME/attachments`; renderer IPC reaches them through the singleton Codex service so creation and cleanup share one ownership instance.
- `codex/thread-title-generator.ts`: packaged-safe shared helper for Codex-compatible `generate-thread-title` prompt shaping, fixed `gpt-5.4-mini`/low-reasoning structured schema, and generated title parsing; it never reads repo-relative prompt assets.
- `codex/conversation-image-asset-service.ts`, `codex/chatgpt-base-url.ts`, and `codex/chatgpt-desktop-request.ts`: the authenticated generated-image asset boundary. Renderer requests carry only a supported asset pointer and the local Codex host; main resolves ChatGPT configuration/authentication, obtains the signed download URL, fetches bytes with Electron networking, and returns typed base64/mime data. Tokens and authenticated request headers never cross into renderer state, and unsupported remote hosts fail closed until the remote-host runtime exists.
- `codex/codex-transcript-projection.ts`: transcript projection helpers that unify bootstrap, live updates, and terminal turn reconciliation into ordered `CodexTranscriptEntry[]`; submitted prompts are projected from canonical turn params, and the pure view-to-entry adapter lives at `src/shared/codex-transcript-entry-projection.ts`.
- `shared/codex-thread-detail-reducer.ts`: shared legacy view-snapshot merge helpers for transcript deltas and optimistic-entry reconciliation used by both main and renderer during the canonical reducer migration.
- `codex/codex-link-repository.ts`: persistence adapter for canonical Codex thread metadata (`codex_threads`) and global sidebar pin order (`codex_pinned_threads`), with session ownership represented through `project_session_threads`; parent-linked subagent rows stay out of ordinary sidebar lists but remain available as lightweight child memberships.
- `codex/codex-session-store.ts`: reads persisted Codex session artifacts from `$CODEX_HOME` / `~/.codex`, supports both legacy JSON and modern JSONL rollout layouts, and rebuilds visible transcript state for restart recovery/import from replay-safe events instead of raw bootstrap messages.
- `codex/git-worktree-service.ts`: managed Git worktree creation for session thread starts (`autoBranch` or `detachedHead`) with base-ref resolution, thread-title-driven auto-branch naming (`<prefix><thread-slug>`), and path allocation under `${nodexHome}/worktrees`.
- `codex/worktree-environment-service.ts`: lists and validates `.codex/environments/*.toml`, parses environment metadata (`name`, `[setup].script`), and enforces in-repo path boundaries.

### Preload Boundary (`src/preload`)
- `index.ts`: minimal `window.api` bridge that exposes `invoke`, event subscription, runtime server URL, cached Electron asset-path prefix, the typed focused-window Workbench command ingress used by application-menu accelerators, and the `window.electronBridge.showContextMenu` native-menu bridge used by desktop-only row menus.

### CLI (`bin`)

- `nodex.mjs`: Page commands address `pageId` directly. Source-defined metadata reads Page Detail and writes revisioned values through Database Module; title/body resolve the owned Page Document and use exact-head stable-ID/NFM mutations. `nodex block descriptor/apply/replace/title/export` exposes the owned Document contract directly; `nodex block command` submits the shared Synced/Template/Canvas ownership envelope. Explicit operation identity plus original logical intent provides lost-response retry.

### Renderer Application (`src/renderer`)
- `app.tsx`: workbench orchestration, window-session bootstrap/layout persistence, Electron startup-gating screen, reminder deep-link handling, and feature-flagged shell entry.
- `styles/theme-source.css`: author-maintained renderer token source, including Tailwind theme declarations, window-type/theme-scoped root tokens, and the CSS-side `--vscode-*` contract consumed by renderer surfaces.
- `styles/theme-codex-foundation.generated.css`: generated renderer foundation layer for radius math, toolbar spacing, and window-scoped runtime overrides.
- `styles/theme-codex-utilities.generated.css`: generated renderer utility contract for utility selectors and specialized arbitrary/container utility coverage.
- `styles/theme-token-bridge.css`: renderer token bridge for authored aliases that are not part of the generated theme contract or foundation layer.
- `styles/theme-codex-surface.generated.css`: generated renderer surface layer for shared component/global rules.
- `styles/theme-utilities.css`: author-maintained renderer utility source for Nodex-local utility additions that are not part of the generated theme contract.
- `styles/theme-surface.css`: author-maintained renderer surface rules and global CSS contracts layered on top of the source token files.
- `components/workbench/*`: project/session shell, recursive right/bottom panel group tree, shared leaf-level panel tab strip, renderer-local side-chat tabs, DB view host, Page Stage/session-terminal tab wrappers, settings surfaces, Process Manager dialog, and remaining workbench composition helpers.
- `lib/maitai/*`: the renderer-local view-state kernel. One stable Jotai store exists per renderer window; App, Thread (20), nested Route (20), and nested Composer (100) scopes resolve logical atoms to retained concrete bindings without retaining React pages. Persisted atoms adapt the shared renderer/main persistence substrate with versioned codecs plus explicit cross-window synchronization policy; that lower store remains available to bootstrap, migration, fixtures, and non-React runtime Modules needing imperative access. External-store atoms remain read-only bridges, scoped families own deletion cleanup, and ordinary React state never rebuilds hydration/subscription controllers over the lower substrate. Maitai never stores DOM/editor handles or duplicates Query, Codex conversation, Browser, Terminal, or collaborative Document authority.
- `components/workbench/use-workbench-preferences.ts`: App-atom ownership for renderer-wide Workbench preferences such as summary pinning, Composer submit behavior, worktree start mode, and branch-prefix policy. Storage and Git-refresh behavior stay behind focused adapters rather than Context providers.
- `components/library/*`, `components/workbench/sidebar-library-section.tsx`, and `sidebar-library-dnd.tsx`: the Project-independent Library Home/Page/Database routes and the bounded lazy sidebar ownership tree. One shared sidebar drag context interprets Library-to-Library/Page drops as ownership moves and Library-to-Project drops as confirmed recursive grants; View rows are presentation-only and cannot move. Data Sources and Database row Pages remain outside the sidebar tree.
- `components/workbench/review-diff-panel.tsx` and `features/review/*`: Review right-panel surface and its isolated data/model seams. Git sources consume canonical live metadata and remote-first base identity, stable tracked/untracked initial diff Queries plus missing-path fallback Queries, double-microtask generation-fenced batches, per-path parsed-metadata identities, row-local full-content cells, four-object cat-file batches, exact partial-metadata expansion, and the real Pierre virtualizer; transcript Review consumes a stable diff/comment projection rather than the whole streaming conversation. Tracked-to-complete publication and unchanged per-file revisions across repository generations preserve existing Query, parse, row, full, and comment identities. Diff disclosure is a source-scoped global default with sparse per-file overrides, and collapsed textual rows remain connected to Pierre while its native collapsed layout state invalidates virtual heights. The surface retains toolbar controls, exact generated-aware partial-hunk/search-fallback behavior, resizable file-tree filtering, capped large-diff mode, safety-gated placeholders, comments, and actions.
- `components/workbench/workbench-settings-*`: settings route shell with a settings-specific sidebar adapter, section metadata registry, path resolver/redirect policy, shared settings page primitives, and one active section page at a time (`/settings/:section`, including `hooks-settings`). The Hooks page keeps host/source/project/plugin selection in the route, groups app-server results without guessing source identity, and owns review/trust/enable interactions.
- `features/local-conversation/*`: renderer substrate and the public workbench boundary for active conversation stages. It owns the renderer-side app-server manager/registry substrate, host-message + control-event bridge, stream role/revision state, per-thread/any-conversation/meta selector hooks, connected thread/review stage containers, projection pipeline, summary-panel section registry, stage shell, header/auth shell, footer/composer shell, shared thread controls, turn virtualization, and the thread-body search/scroll/collapse behavior used by the active workbench thread stage. The thread-body shell consumes one real `CodexConversationSnapshot | null` plus genuine shell context; callers must not flatten conversation fields or synthesize partial snapshots at selector seams. Explicit snapshot, resume, history-page, side-chat, follower-bootstrap, and rollback ingresses materialize each canonical turn through the shared whole-turn lifecycle projection before it enters renderer state; the generic snapshot merge boundary remains projection-free. Stable visible-turn entries are the main-surface projection cache boundary: a mounted row owns both transcript and fixed todo/diff output from one model, while the right-panel latest-turn preview remains an intentionally separate preview surface. Activity projection owns command/dynamic/MCP metadata and emits only standalone entries or generic `agentActivityGroup` units; React leaves do not feed family-specific grouping policy back into projection. The same pure boundary may emit auxiliary turn state that has no DOM item—for example, null-anchor background-subagent activity can control commentary ownership and collapse defaults without fabricating a visible group.
- Nodex resource consent reuses the local-conversation request-card surface rather than creating another modal authority. The renderer projects bounded semantic/Nested Markdown details and returns `allow_once`, `allow_task`, `allow_project`, or `deny` through the targeted presentation bridge for read, write, and destructive requests. Turn termination and bridge teardown resolve pending presentation as denial. Renderer state presents consent but never owns authority, grants, or prepared commands.
- `components/kanban/*`: board UI, Page Stage composition, history panel, and the summary-only Toggle List. Toggle List filter/search/sort operates on `DatabasePageSummary`; an idle collapsed row stays projection-only, while disclosure or explicit title engagement can mount that Page's independent Document, so no multi-Page ProseMirror tree or whole-description write path remains.
- `components/block-documents/*`: the owned-Document query boundary, writable `BlockDocumentSurface`, rich Y.Text Page title surface, sparse sync status, Page outliner controller/presentation, and canonical Database reference surfaces. Idle collapsed Page outliner rows resolve membership-independent `PageTargetReadModel` data through `page-target:resolve`; Database-row `DatabasePageSummary` is not a Page-opening boundary. Disclosure mounts the target Page's independent Document only when needed. The embedded-surface bridge traverses host Blocks, Page titles, and disclosed bodies in visible depth-first order, while Page plus general Document-owner ancestry prevents direct or indirect inline cycles.
- `components/kanban/editor/*`: BlockNote/NFM integration, custom Blocks and inline attachment chips, Page outliner/reference rendering, paste-resource materialization, and stable-ID Block relocation. An owning Page shell uses Block type `page`; a non-owning reference uses the canonical editor node `pageRef` and NFM `<page-ref url="nodex://pages/..." />`. Historical `card` and `cardRef` nodes are decode-only migration inputs. Cross-surface drag publishes logical `library | page | data_source` parents (with `document` only for a registered non-Page Document); the writer resolves current physical `space | document | database` coordinates and validates the target View/Data Source before acquiring leases.
- `lib/api.ts`: transport facade over explicit Electron and browser transport adapters (IPC in Electron, HTTP+SSE in browser).
- `lib/codex-conversation-image-assets.ts` and `features/local-conversation/view/shared/use-conversation-image-asset.ts`: renderer-side generated-image query and source resolution. Pointer data uses the five-minute `file/image-src` cache with transient-only retries; local absolute paths use a file URL for display and load binary data only for a download/drag consumer. Gallery tiles resolve preview and full descriptors independently, while the full descriptor derives display, download, and data-URL outputs.
- `lib/codex-theme-variant.ts`: runtime theme bridge that derives semantic color variables from the active light/dark theme variant and injects them onto `document.documentElement` before renderer surfaces read the token bridge.
- `lib/query-client.tsx`, `lib/query-keys.ts`, `lib/query-options.ts`: low-frequency renderer server-state substrate built on TanStack Query. Query functions still go through `lib/api.ts`; keys are centralized for projects, boards-by-project, history, settings, Git branch state, local environments, Codex sidebar snapshots/pins, Hooks-by-host/root-set, scheduled automations, MCP status/resources, and workspace file reads. Hook state writes optimistically patch every matching host query, roll back on failure, and invalidate from both the local settlement and the main-process host change event.
- `lib/kanban-store.ts`: shared per-Project board-summary store with one realtime subscription, deduped summary fetches, optimistic journal rebase (`baseBoard + pending/local ops`), LWW conflict superseding, typed conflict resolution (`updated|conflict|not_found`), and O(1) compatibility `pageIndex` lookup. Database invalidations carry Library resource identities (`databaseId`, `dataSourceId`, `pageId`, `viewId`); Project scopes delivery and authorization but does not own the affected content.
- `lib/page-detail-store.ts`: grant-aware renderer cache for versioned Page Detail keyed by Project/Page. It follows Board and Database invalidations without using View visibility as existence authority. The read model proves the exclusive Page parent and optional Source membership/schema/value slice; title/body remain exact-head projections edited through the owned Y.Doc surface.
- `lib/database-row-detail-store.ts`: explicitly bounded cache for the wide Database-row projection used by Kanban/calendar consumers. It requires active membership and is never a Page-opening boundary.
- `lib/use-kanban.ts` and `lib/use-projects.ts`: stateful owners over API channels. `use-kanban` remains store-backed via `useSyncExternalStore`; `use-projects` uses TanStack Query for server-state cache, invalidation, and cross-consumer request dedupe. Page history is a cursor read model owned by `history-panel.tsx`, while typing undo stays inside the mounted Document surface.
- `lib/use-workbench-state.ts`: one transactional App-atom aggregate for renderer-window layout and explicit project-context slices, hydrated from session/window snapshots and persisted through the window-session adapters. Session panels and durable terminal tabs are not owned here; project-session SQLite state is the primary model.
- `lib/workbench-persisted-schemas.ts`: renderer-side persisted-state schema/parsing layer for workbench/session history maps, tabs, panel widths, and restart-friendly shell snapshots.
- `lib/app-close-flush.ts`: renderer-side close-flush coordinator so all registered async flushers complete before one final Electron close ack is sent.
- `lib/nodex-y-provider.ts`, `block-document-surface-runtime.ts`, `page-editor-session-registry.ts`, and `owned-block-document*.ts`: transport-neutral Yjs provider, registry-dispatched surface lifecycle, durable PageTab model sessions, and prepared-descriptor validation for one writable Block Document. They own state-vector synchronization, merged local-update batching, one durable command in flight, idempotent retry, realtime gap repair, remote-origin echo suppression, store-epoch/generation reset boundaries, bounded flush/checkpoint/close, accepted-lease drain across visual teardown, disposable-checkpoint isolation after fatal state, independent client sessions, and ephemeral Awareness. A PageTab session retains its Y.Doc/provider, BlockNote editor, UndoManager, and Yjs-relative cursor while inactive; React owns only a generation-fenced EditorView lease. Other owners use the same generic surface boundary with their schema-specific envelope and ordinary component lifetime.
- `lib/electron-document-sync-adapter.ts` and `http-document-sync-adapter.ts`: equivalent provider transports. Electron uses typed binary structured-clone IPC. Browser opens its Project- or Library-scoped SSE subscription before issuing versioned binary POST commands; EventSource reconnect triggers a new state-vector repair rather than trusting event delivery as causal authority. A Library descriptor is validated without a Project coordinate before the renderer creates its local editor-surface scope.
- `lib/window-sessions.ts`: renderer helpers for bootstrapping the assigned window session and saving workbench layout snapshots through IPC.
- `lib/dock-layout.ts`: dock split-tree helpers for the current persisted shell layout model.
- `lib/use-workbench-shortcuts.ts`: app-wide stage-first keyboard shortcut mapping plus browser-runtime fallback dispatch for shell commands whose desktop accelerators are owned by Electron's application menu.
- `lib/terminal-session-store.ts` and `lib/use-terminal.ts`: xterm terminal state and lifecycle. The store owns renderer session snapshots, active metadata, pending writes, resize dedupe, 16k buffer truncation, and `terminal-*` IPC fanout; the hook mounts `@xterm/xterm` with Clipboard/Fit/WebLinks add-ons, CSS-variable theme extraction, Codex terminal key handling, window-zoom mouse coordinate patching, and ResizeObserver-driven fit.
- `lib/use-codex-account-actions.ts`: auth/account command wrappers (`read`, login start/cancel, logout). For the active thread renderer, auth state flows from the local-conversation app-server manager substrate, not from this action layer.
- `lib/codex-collaboration-mode-settings.ts`: global fallback collaboration mode persistence for no-thread/new-thread surfaces. Active thread collaboration mode is owned by the local-conversation manager record, not by shell-local storage.
- `lib/nfm/*`: renderer wrappers over the shared NFM core plus the BlockNote adapter and clipboard/read-only helpers.
- `lib/toggle-list/*`: rule engine and mapping logic for toggle-list views.

## Data and Event Flow
1. Renderer issues a command through `lib/api.ts`.
2. Transport resolves to IPC or HTTP based on runtime.
   Focused-window UI commands do not enter this mutation transport: application-menu accelerators send a typed command request through preload, `app.tsx` assigns a monotonic request tick, and `WorkbenchShell` executes the same handler used by toolbar and command-palette entry points.
3. Main process routes Page lifecycle, intrinsic Block property, Database Module, Document, history, relocation, transfer, maintenance commands, and Project-bound Agent read snapshots through `BlockMutationWriter`. A Page editor sends binary Yjs updates; there is no Page title/body snapshot command or main-process SQLite fallback. Agent reads use the worker's deferred transaction path and publish no mutation events. Non-Block write domains continue to call their local-store Modules directly from main.
4. Page local-store writes emit domain events inside the worker, where they are captured into the mutation envelope. Every committed Page Document head emits membership-independent `page-target-changed` by Project access context and Page identity; lifecycle, location, and target-visible metadata changes use the same invalidation boundary. A Database-row summary additionally emits `board-changed` when that optional projection exists. Main republishes both only after the durable ACK boundary.
5. Electron main broadcasts ordinary change events to all open windows through the safe IPC sender; Codex host-message/event fanout goes through the renderer-client router, which itself uses the safe sender. Direct `webContents.send` fanout is not allowed outside those helpers because renderer reload/close can dispose frames between lookup and send. Board and session renderer subscriptions filter by `projectId`; project-list subscriptions are global.
6. Renderer shared Project stores (`kanban-store`) receive IPC/SSE board-change events. Events carrying a `DatabasePageSummary` patch the local summary cache directly; Document summaries come from committed exact-head materializations. Structurally ambiguous board events are coalesced into a summary refetch per Project. Page target queries use the separate Project stream event, dispatch by `targetBlockId`, and invalidate only the exact TanStack Query key; deleted targets retain their Project subscription for restoration. Page Stage breadcrumb queries read the root-to-parent ownership chain from one main-process Page hierarchy/authority snapshot rather than session navigation state and observe the target plus returned ancestor identities. A Library-scoped, identity-free ownership-path event also invalidates their Project prefix after location/lifecycle changes that make the changed Page fail post-change authorization; Project-scoped access events cover grant changes without exposing Page identities or titles. Workbench sidebar session rows receive IPC/SSE session-change signals and refresh affected lightweight project-session summaries; full session detail is loaded through explicit selected-session or panel/tab paths.
7. Reminder scheduler polls occurrences, dedupes delivery via receipts, and emits `reminder:open` to renderer on notification click.

Block-first migration foundation:

1. Current v81 stores extend the Block-first foundation with one persisted Profile-owned Library, stable Project-to-Database bindings and lifecycle, independently identified Database Containers, Data Sources, and Views, Source-scoped compact Property/option identities, Source-owned schema/membership/value tables, explicit View-to-Source targets, Page View coordinates, canonical Page records with exclusive `library | page | data_source` parents, Library top-level placements, recursive Project resource-grant authorization, immutable Database Module receipts, exact-Turn Nodex authority provenance, and actor/source/target Library content relocation evidence. The old Project-shaped Database capability, Property, membership, value, and position tables are migration input only. The persisted Page literals are `page` and `nodex.page`; active relational projections use `page_read_model`, `scheduled_page_index`, `canvas_page_references`, and Page-named key columns. Physical `blocks.location_kind` retains `space | document | database` only as the storage adapter compiled from canonical parents. Schema v81 rewrites v1 Property/option coordinates and their coupled mutation/history evidence, rotates the store epoch, rebuilds canonical View dependencies, and removes the duplicate Database authority. Shipped v26/v57 and earlier release schemas remain import inputs, never runtime alternatives.
2. A successful Document apply tentatively reconstructs and validates a Y.Doc, derives the changed title/Block identities from before/after state, reconciles the registry/index, and writes the binary update, immutable receipt, exact-blob checksum, state vector, reconstruction fingerprint, and new head under one immediate SQLite transaction. Receipts remain independently of update payload retention; compaction verifies a full snapshot at the current head, advances the physical reconstruction fingerprint, then atomically removes only its covered payload tail. Store epoch, Document generation, update identity, `headSeq`, Yjs state vector, exact-blob integrity, and non-canonical reconstruction fingerprint remain separate concepts.
3. Production Page Stage prepares the exact owned descriptor before rendering content. Only a ready `yjs`/`block_tree` descriptor enters the Page editor: it mounts one independent Y.Doc surface, completes state-vector sync before resolving `Y.Text("title")` / `Y.XmlFragment("body")`, and binds BlockNote through its collaboration extension without projection-based initialization. Every active BlockNote-backed Document contains at least one registered application Block; a semantically blank Page is one stable-ID empty paragraph whose NFM/plain-text projections remain blank.
4. A writable Block Document runtime normally belongs to one visible React effect incarnation. A durable PageTab is the explicit exception: its ProjectSession/tab-keyed model session retains the Y.Doc/provider, BlockNote editor, and UndoManager while the inactive React body and EditorView are absent. Switching away removes local Awareness and backgrounds a bounded persist without disconnecting the provider; returning mounts a fresh EditorView, reconciles current CRDT state, restores the selection from Yjs-relative positions plus PageTab-local scroll, and reactivates the main NFM editor only when it owned the Page's last focus intent. Tab close, ProjectSession archive, store-epoch/Document-generation/schema/owner identity replacement, or terminal reload destroys the retained model and provider exactly once; renderer close flushes every ready retained session before acknowledging shutdown. An unpromoted preview disposes on final view teardown, while promotion keeps its stable model identity. This is a deep runtime Module, never hidden DOM or Maitai state. Normal durable ACKs are quiet; sustained pending/offline/error/reset states are the only Page Stage sync chrome.
5. Canonical Page and Database View references are childless and store only stable targets. A nested `page` shell and non-owning `pageRef` resolve through the same flat Page outliner Adapter; collapsed rows use summary projections without a provider, while disclosure mounts the target Page's independent Document. Runtime boundaries never copy a target title or body into the host Y.Doc.
6. The relocation Hub makes `Move to Page` a stable-ID, dual-Document transaction. Every active surface locally commits composition, flushes its provider, becomes temporarily non-editable, and ACKs its durable head. The writer prepares again after those ACKs; failure before commit cancels the lease, while response loss after commit resolves through the immutable receipt and state-vector resync.
7. Whole-store backup/restore is a process-wide maintenance boundary, not a raw file operation. The asset mutation gate drains accepted managed-file writes and rejects new ones; the FIFO writer then drains and closes its worker-owned SQLite connection, the main connection closes, and lazy main access fails closed. Backup uses a standalone read-only SQLite online-backup source only while that boundary is frozen. Restore validates a staged current-schema DB and flat regular-file asset root (including every exact-head managed asset reference), creates the optional safety snapshot inside the same uninterrupted fence, and records every DB/WAL/assets rename in an fsynced restore journal. Startup rolls every pre-commit phase back to the complete old store, or finishes cleanup after a durable `committed` phase. The installed DB rotates `storeEpoch` before the journal commits and Core invalidates every subscription and connection-bound operation. Native non-desktop clients must reconnect and prepare a fresh descriptor/state-vector handshake; Electron performs a controlled relaunch after returning the successful restore result so every renderer and host Adapter is recreated against the new epoch.
8. The owned-Document registry has another concrete owner: `synced_block_source` with `nodex.synced-block@1` and a body-only `block_tree` Y.Doc. A system-managed source has a real but user-hidden Library placement; visible `syncedBlockRef` instances contain only `sourceBlockId` and never foreign body content. The authority kernel shares Document persistence, projections, history, relocation, immutable receipts, caller `storeEpoch`, and first-attempt actor audit.
9. Reusable Template sources are registered `block_tree` owners over the same body-only root primitive, Yjs DocumentStore, provider, history, projection, and relocation Modules. Template sources carry an authoritative intrinsic display name; `templateRef` is childless and instantiation renews every copied subtree ID against exact source/target heads. Long documents remain Pages and code remains an ordinary `codeBlock`; size-dependent loading, caching, and compaction never create durable owner types.
10. Every Project has one deterministic primary Canvas Block and independently synchronized `nodex.canvas@1` Owned Document using `canvas_scene`. Normalized element rows are resolved by Excalidraw version/nonce rules with canonical hash fallback; bounded shared app state is field-intent merged; managed files are immutable URI metadata. Each mounted Canvas owns a scene provider/client and persistent exact-mutation outbox, uploads assets before enqueuing references, presents remote canonical changes with `CaptureUpdateAction.NEVER`, repairs event gaps by loading a bounded full scene, and joins bounded close/write-fence flushing. Search/reference/asset rows remain rebuildable exact-head projections; Canvas writes no Yjs updates, state vectors, or operational Yjs snapshots.
11. Page history is a read model over immutable `document_versions`, `block_mutations`, `block_relocations`, and `change_log`, scoped by Page identity and its owned Document. It uses a stable source-specific cursor and exposes only bounded validated evidence. The renderer previews and forward-restores retained Document checkpoints; property/location/lifecycle evidence is not given a synthetic whole-Page inverse.
12. Every `db_view` renderer surface resolves its exact durable `databaseViewId` and queries that View's descriptor/config/rows. Kanban mutation affordances are enabled only for the exact primary write-compatible status-grouped View; arbitrary Views render from the generic query model and never borrow the Project's primary board identity. Cache keys and invalidation include both Project and View identity.
13. Current Page Stage and Board vocabulary is a presentation Adapter over Page authority, not a parallel mutation kernel. Source-defined status, priority, estimate, tags, dates, and assignee compile from Page Detail coordinates to Database Module `set_value`; Page-intrinsic run/schedule fields use Block property CAS. The retired Card metadata snapshot/compiler transport no longer exists. Database schema/View management likewise derives operations, exact revisions, selected View identity, and logical Page anchors without accepting client rank keys.
14. Physical tombstone collection is a separate retention planner, not a cascade side effect. It retains the newest configured count, computes a recursive deleted ownership closure, scans exact current and retained historical Document materializations plus cross-Project references/sessions, classifies every recovery/history/Database/FK root, and only deletes an all-clear closure in one immediate transaction. Attributable expired versions and resolved recovery evidence are pruned in that transaction; immutable mutation/change receipts remain and may retain wider same-Project attribution without owning reachability. Before deletion, every closure ID enters the immutable global retired-ID registry, whose `blocks` insert trigger prevents identity reuse across every typed creation path. Unknown schema, corrupt projections, missing document-bearing ownership, cross-Project attribution, mixed prunable evidence, or an unclassified inbound foreign key retains the candidate.

Board read flow:
1. High-frequency board consumers use `board:summary:get` / `/api/projects/:projectId/board-summary`, which returns `BoardSummary` without full body content. The summary assembler reads title/preview from the current Document materialization and lifecycle/status/property/order from Block/Database records.
2. Page Stage reads versioned `PageDetail` through `pages:detail:get` / `GET /api/projects/:projectId/pages/:pageId`, assembled in one SQLite read transaction after Project grant evaluation. The contract contains Page identity/parent, the owned Document exact-head projection, intrinsic properties, and—only for a Source-parented Page—the matching membership, Database Container, Data Source schema slice, and values. Library- and Page-parented Pages expose the same core Stage without fabricated Source fields. Compatibility Board/calendar consumers use `database-row:get` or `database-rows:details:get`, both of which explicitly require Database-row shape.
3. Lifecycle, property, Database, and committed Document events carry or trigger a narrow authority-derived `DatabasePageSummary`; field-level conflicts return typed current property evidence without a whole-Page content overwrite payload.
4. Page content search runs through current `block_search_units` FTS projections via `pages:search`. Every hit is generation/head-fenced to its owning Document, authorized against the requesting Project, and returns Page identity plus a bounded title/body excerpt and optional Data Source context.
5. Full-board reads are not exposed through IPC or HTTP. New board consumers must compose `BoardSummary` with explicit detail/search requests instead of adding a broad board payload.

Project sessions and sidebar flow:
1. The renderer shell loads `codex:sidebar:snapshot({ refresh:false })` as the cold-start left-sidebar read model so SQLite can render immediately. External chat discovery is driven by `codex:sidebar:sync`, whose `read | stale | force` policies let the renderer force a mount/project-change reconciliation, run stale-gated focus/heartbeat/host-message reconciliation, or read only the SQLite snapshot for local session changes.
2. Main treats app-server `thread/list` as the sidebar discovery authority for interactive root threads and coalesces in-flight sidebar sync across windows with a short stale gate and failure backoff. Full-list refreshes and app-server `thread/started` notifications share one reconciliation path: skip non-sidebar helper/reviewer threads, match cwd to the longest normalized project source prefix, create/reuse a project-bound or projectless session, repair stale session ownership, and return the affected project/projectless scopes.
3. Sidebar reconciliation results are main-broadcast shared state, not only IPC return values. Successful renderer-initiated syncs, notification materialization, and forced unknown-notification repairs emit `sidebarSyncUpdated` host messages so every open window can write the same sidebar snapshot query and refresh affected session summaries. A no-op `thread/list` upsert only refreshes the `codex_threads` read model; it does not emit `project-sessions-changed`. Thread title/preview/status/archive/updatedAt changes are sidebar catalog changes, while `project-sessions-changed` is reserved for true session container or thread-link changes such as create/delete/reorder/pin/unread/archive/unarchive/materialize/re-home/attach/detach.
4. The renderer loads lightweight `project-sessions:list-summaries` for sidebar scope refreshes so catalog churn never pulls panel layouts or tabs into the thread-open hot path. TanStack Query owns renderer-only project-session summary keys by project/projectless scope and detail keys by session id; full session detail is fetched through `project-sessions:get` only for the selected session, sidebar intent, and explicit panel/tab actions, then seeded from mutations that already return a full session. Full `project-sessions:list` remains an explicit slow path for operations that truly need every session's panel state. `useSidebarThreadSyncModel` is the single driver for sidebar catalog updates, including inactive projects and projectless rows; `WorkbenchShell` does not keep a separate active-project-only sidebar listener. `WorkbenchShell` mounts exactly one selected task page and constructs only that session's panel tree. Switching tasks unmounts the previous page synchronously; Query, Codex conversation execution, Browser, and Terminal continuity remain in their deeper owners, while renderer-only restoration comes from scoped Maitai state.
5. SQLite owns the shared tree: `project_order` and `pinned_project_order` store global sidebar project grouping order, `codex_pinned_threads` stores global thread pin authority and order, `codex_project_thread_orders` and `codex_sidebar_chat_order` store project and projectless manual thread identities, and `project_sessions.pinned`/`pinned_order` remain compatibility mirrors for older session APIs and no-thread rows. Real Codex thread display never derives manual order from `project_sessions.order`: the sidebar projects each stored durable-ID order onto a current recency base, leaving untracked/new/temporary rows in their base slots. `project_sessions.archived`, `archived_at`, and `unread` store session state, `project_sessions.no_thread_fallback_title` stores only the label to show before a session has an attached thread, `project_sessions.panel_state_json` stores independent right and bottom panel state with a v2 recursive split-tree layout (`root`, `activeLeafId`, `mruLeafIds`, leaf-level durable `mruTabIds`, optional `maximizedLeafId`), `project_session_tabs.panel_id` and `"order"` store a flat compatibility order derived from depth-first leaf order, and `project_session_threads` stores optional one-to-one session/thread attachments while thread metadata lives in `codex_threads`. Thread metadata includes nullable projectless output-directory hints in `codex_threads.projectless_output_directory`; renderer artifact summaries use that hint to distinguish user-facing projectless deliverables from scratch work. Scheduled automation definitions live as versioned TOML files under the local profile `automations/<id>/automation.toml` tree, while `codex_scheduled_automations` is the low-frequency SQLite mirror exposed through typed `codex:scheduled-automations:*` IPC channels and a change event that invalidates the renderer query cache; the mirror also stores reconciled `nextRunAt`/`lastRunAt` runtime fields derived from RRULE/status and the profile jitter salt. `codex_automation_runs` stores previous-run lifecycle state (`IN_PROGRESS`, `PENDING_REVIEW`, `ACCEPTED`, `ARCHIVED`), read markers, archived message excerpts, source cwd, and thread title/inbox metadata for the automation inbox and previous-runs surfaces; scheduled automation deletion also removes its run rows. Workbench owns the local `/automations` route shell and uses `automationId` / `automationMode` search params to select list/detail/create/missing states from that mirror. Subagent metadata also lives in `codex_threads` as parent-linked lightweight rows, including optional `agent_nickname`, `agent_role`, and source-derived `agent_path`; ingestion reads top-level thread metadata and `source.subAgent/subagent.thread_spawn` fallback fields, and sparse later payloads do not clear existing agent metadata. These rows are excluded from root thread/sidebar queries. The Subagents panel discovers the complete descendant tree through relationship-filtered app-server `thread/list`, retains each real parent link, and hydrates turns only for visible previews or the selected detail. Detached internal helper/reviewer rows are never sidebar sessions; legacy leaks are repaired from persisted thread/session metadata during snapshot build.
   Automation-run lifecycle mutations emit `codex:automation-runs:updated`, which refreshes Scheduled task rows, automation-run inbox queries, and the Codex sidebar/recent thread snapshot. Cron execution is a command-only main-process runner: it owns workspace setup, app-server commands, tool/request transport, run status, and protocol-turn inbox extraction, but it never hydrates, merges, or broadcasts a conversation transcript. Heartbeats require a fresh renderer-state lease from the exact current conversation owner; main resumes/starts transport only and never claims a headless conversation-owner role. Brokered automation requests are replayed after a renderer later adopts the task.
6. Project session list results include a service-derived `displayTitle`. Attached sessions resolve it from `thread.threadName || thread.threadPreview || noThreadFallbackTitle || "New thread"`; blank sessions resolve it from `noThreadFallbackTitle || "New thread"`. `noThreadFallbackTitle` is not a Codex thread title authority.
7. Window/session UI state owns only the active project, active session, and transient focus/history. Project-bound session selection updates both active project and session. Projectless session selection updates only active session and leaves active project as the DB/workbench fallback.
8. Project creation seeds one ordinary pinned `Database View` session with an open full-width right-panel `db_view` tab for that Project's durable primary View ID. This happens only during Project creation, fresh default-Project initialization, or one-time schema migration; `project-sessions:list` never recreates it after the user renames, unpins, archives, or deletes it. Projectless sessions do not receive this starter DB session and cannot own Project-scoped DB/Page tabs.
9. `db_view` tabs are unique per durable `databaseViewId`, so one session may open multiple Views from the same Project while duplicate opens focus the existing tab. `review` remains the singleton right-panel kind. Browser tabs are first-class multi-tabs with their own webview lifecycle, title/favicon state, context menu actions, and browsing history. Terminal tabs are session-owned bottom-panel tabs by default and carry only `projectId` plus `terminalSessionId`; Pages never own terminals.
10. Session tab storage deliberately splits ownership from content targeting: `project_session_tabs.project_id` is the Project that attaches the row to a session, while kind-specific `config.projectId` is the Project authorization context whose content the tab body loads. These values normally match, but cross-Project Page Stage tabs preserve a different config Project so the active session can host a Page available through another grant context without loading the wrong Board.
11. Renderer-local panel previews are intentionally outside SQLite. Files and Browser previews occupy one preview slot per session panel leaf, replace each other within that leaf, and are persisted only when pinned through the normal session-tab create API.
12. Renderer-local side-chat tabs are also outside SQLite but use a separate leaf-scoped lifecycle from previews. The renderer creates `sidechat-loading:<parentThreadId>:<index>` tabs, asks main to start an ephemeral fork, replaces the loading tab with `sidechat:<threadId>`, and discards the backing temporary thread when the tab closes.

Codex Threads flow:
The installed `@openai/codex` app-server is the wire-contract authority. `pnpm run codex:schemas:generate` transactionally regenerates TypeScript bindings and the selected self-contained JSON Schema roots under `packages/codex-app-server-protocol`; `pnpm run codex:schemas:verify` must remain byte-stable. Main validates complete JSON-RPC envelopes before routing, and generated `ServerNotification` / `ServerRequest` discriminated objects remain whole through buffering, owner IPC, fallback delivery, and renderer consumption. Nodex-owned orchestration inputs and projected view models stay local only when they transform that generated contract; exact protocol copies must be aliases, indexed-access/`Pick` derivations, or generated runtime-schema adapters.

1. Renderer sends `codex:*` IPC actions through `lib/api.ts`, manager-backed control hooks, and the local-conversation app-server manager substrate.
2. Renderer loads `model/list` and `collaborationMode/list` via IPC and resolves active thread model, reasoning effort, and collaboration mode from the manager-owned `latestThreadSettings` when a thread exists. No-thread/new-thread draft surfaces may reuse a persisted draft model only when it still appears in the visible `model/list`; otherwise they select the app-server default model from `isDefault`, then the first visible model, and omit the request model override when no visible model is available.
3. Existing-thread next-turn settings flow through app-server `thread/settings/update` and `thread/settings/updated`. Canonical conversation hydration retains one complete generated `ThreadSettings` value in the conversation sidecar before any owner action can run. Main and renderer-owner settings transitions update that value first, then derive `latestThreadSettings` and `latestCollaborationMode` for legacy consumers; main falls back to a local merge only when the app-server method is unavailable.
4. `codex-service` resolves Page-requested run targets (`localProject` / `newWorktree` / `cloud`) through the Project's source roots, including sticky per-Page managed-worktree reuse via `runInWorktreePath`; for freshly created worktrees, it optionally executes selected `.codex/environments/*.toml` `[setup].script` before thread start. Session-owned thread starts use `codex:thread:start-for-session`, start the first turn immediately, persist the resulting thread in `codex_threads`, and attach it through `project_session_threads` without creating Page ownership. Project sessions use their primary source for local/worktree starts. For a null-owned projectless session, the renderer requests a filesystem descriptor through the typed `codex:projectless-thread-cwd` host boundary on first submission; main validates the descriptor, starts only in the local target, uses the generated task directory as cwd and `~/Documents/Nodex` as the runtime root, and persists the output/browser-root hints with the thread.
5. Sidebar sync uses app-server `thread/list` and `thread/started` notifications as the discovery authority for local interactive root threads, excluding archived threads by default. Each non-ephemeral, non-side-conversation, non-helper thread is matched to the longest normalized project source prefix from its cwd; matches create or reuse project-bound sessions, and misses create projectless sessions with `project_id = null`.
6. Side-chat starts use `codex:thread:side-chat:start`: main forks the parent thread with `ephemeral: true` and excluded turns, supplies side-conversation developer instructions, injects a boundary message, caches the resulting side conversation as ephemeral manager state, and optionally submits the initial `/side` or selected-text prompt into the side thread. Side chats set local source metadata (`sideConversation` and `sideConversationParentNavigationPath`) but do not create `codex_threads`, `project_session_threads`, Page links, or Project thread-list entries.
7. For session-owned first-message starts, `codex-service` emits `codex:event` `threadStartProgress` updates keyed by project/session and run target. Local-project starts use compact `startingThread` / terminal `ready|failed` progress so attached empty snapshots never render as a true empty thread, while fresh worktree starts additionally emit `creatingWorktree` / `runningSetup` stdout/stderr chunks for the setup log before `startingThread`.
8. `codex-service` persists thread cwd in `codex_threads` (payload cwd or resolved fallback) so follow-up turns keep the same execution location even when a thread has no Page or Project. Ordinary cold resume repairs unusable persisted projectless locations at the main-process filesystem boundary and updates the same row before app-server resume; seeded fork resume bypasses allocation so inherited workspace hints remain stable.
9. `codex-link-repository` persists canonical thread metadata plus optional Page relations in SQLite, while `codex-session-store` provides bootstrap-only recovery input for the main-process conversation manager when persisted Codex session artifacts exist.
10. Generated items and server requests have a shared protocol-backed raw-state boundary that preserves complete discriminated envelopes and scalar request identity. `codex-conversation-reducer.ts` owns the pure raw `item/started` / `item/completed` transition plus explicit streaming/collaboration effects and the shared admission/timing kernel consumed by both main/no-owner and renderer-owner adapters: same-ID stable upsert, authoritative final replacement, exact-type completion guards, hidden lifecycle identity, and turn-owned command timing are no longer independently defined by those transports. `codex-turn-lifecycle.ts` owns canonical turn start/completion, including nullable placeholder rebind, launch-context synthesis, strict terminal mutation, stale plan retirement, and completed-plan follow-up creation. `codex-turn-metadata.ts` owns diff, safety buffering, hook occurrences, plan rows, review/guardian rows, model reroutes, and notification errors. Both main and renderer-owner ingress commit those canonical turn transitions before applying the same scoped projection; main keeps owner-routed recovery silent and publishes no-owner changes only after the canonical commit. A renderer-owner snapshot carries the lossless canonical document itself; owner item and turn lifecycle reduce that document first and apply a scoped canonical-to-view diff only after the existing queue drain. Missing or mismatched canonical state fails closed into the normal ownership recovery path instead of reconstructing raw turns from transcript rows. `codex-frame-text-delta.ts` and `codex-frame-text-delta-queue.ts` likewise own the four raw prose/reasoning append targets, flush-time turn selection, exact raw-type lookup, and one manager-global 16ms/24-unit/eight-drain-frame scheduler. `codex-server-request-lifecycle.ts` owns request ingress, server withdrawal, local response, and request-caused synthetic-item transitions for canonical replay plus both transport owners. Its queue is an arrival-ordered sequence of complete envelopes: duplicates remain distinct occurrences, numeric and textual request ids compare strictly, ingress raises the request-side `hasUnreadTurn` flag, and removal never clears that flag. A withdrawal uses the first strict match to complete any permission/user-input/MCP synthetic item, then removes every envelope with that same scalar id without emitting a client response. Renderer-owner ingress, withdrawal, and local replies reduce this canonical request document before deriving request cards, attachments, and stream patches; outward request listeners run only after the committed conversation is readable. Hydration/live materialization clones only the image-generation and collaboration protocol exceptions, while live context compaction adds its app-owned completion/source fields. Main and renderer still project raw reducer results into `CodexItemView`, `CodexTranscriptEntry`, `CodexConversationSnapshot`, and request-card view models while C-08 removes the remaining derived state adapters and completes history/transport convergence, and Q-02 alone owns exact direct-request projection, placement, blocking, and UI action surfaces; those flattened snapshots are not the raw-field authority. Thread summaries and snapshots carry a minimal `source` contract: child/helper threads set `source.parentThreadId`, side chats set `source.sideConversation`, and root threads keep `source = null`.
   Renderer-owner prose/reasoning frame batches, command-output batches, and parsed terminal commands also mutate the handed-off canonical document before scoped projection. Their manager-global queues, UTF-16 segment ACK accounting, output timer/truncation policy, and manager-lifetime partial terminal input remain transport/scheduler state. Frame changes publish normal owner revisions; output and terminal changes remain owner-local recovery updates with no duplicate stream patch because main independently applies the same raw event.
   Renderer-owner file-patch updates and MCP progress structural repairs likewise reduce canonical turns first. Patch updates remain local/no-stream-patch owner recovery mutations; MCP progress stores no message but publishes any exact collection repair or placeholder rebind required by the raw turn contract.
   Conversation-level token usage is canonical sidecar state. `thread/tokenUsage/updated` replaces only that value and does not mutate turns, requests, unread state, or conversation timestamps before renderer projection/publication.
   Thread start/name/status are canonical thread-protocol mutations; complete generated thread settings, previous-turn model transition state, and active/completed goal state are canonical conversation sidecars. Renderer owner publication and goal/status effects occur only after those commits, while thread metadata projections preserve existing timestamps unless the protocol thread payload itself supplies new times.
11. Completed turn diffs follow the app-server conversation model first, then a main-owned projection fallback. Live `turn/diff/updated` notifications and read-model `turn.diff` values are the canonical source when non-empty; if they are missing or empty, main may synthesize the visible completed `turn-diff` payload from completed `fileChange` patch batches using path-aware hunk folding. Raw `fileChange` rows and `patchBatches` remain process/provenance data for inline patch rows and undo/reapply, and Review still folds repeated display paths defensively for every diff source. Binary, oversized, invalid-text, and unsupported file changes are local derived safety states: they retain path/action metadata, but they do not materialize decoded body text or textual turn-diff hunks.
12. Main still emits `codex:event` payloads for approval/request-side state and a manager-owned `codex:host-message` plane for shared objects, sidebar sync state, and thread stream sync. Main registers each Electron window as a renderer client and sends this Codex fanout through the renderer-client router; the same router exposes the targeted request/response substrate required by owner/follower coordination. Renderer-owner stream changes enter main through `codex:thread-owner:stream-state:publish`; main validates source ownership and revision continuity, applies the change to the accepted shared document when its revision base is valid, assigns the outer host-message version, and broadcasts to followers while skipping the source owner. Patch base-revision continuity is enforced by both main's accepted-document relay and renderer followers. When a renderer owner is known, owner-routed app-server notifications carry a per-conversation sequence and enter the renderer as owner-only `threadOwnerNotification` messages. The renderer owner reduces `thread/started` into an owner-published snapshot, reduces thread name/settings/status/token usage/goal, turn lifecycle/diff/plan/safety-buffering/hook/model-reroute/automatic-approval-review/guardian-warning updates, item lifecycle, `serverRequest/resolved`, turn errors, and assistant/plan/reasoning prose into local conversation state, then publishes revisioned snapshots or patches back through main. Command-output deltas, `item/commandExecution/terminalInteraction`, live `item/fileChange/patchUpdated` notifications, legacy `item/fileChange/outputDelta`, `item/reasoning/summaryPartAdded`, and `item/mcpToolCall/progress` are owner-local/no-op exception rows: the owner coalesces command output, parses terminal stdin into command actions, updates the in-progress `fileChange` row, ACKs burst-only legacy file-change output, ACKs reasoning summary boundaries, or ACKs ignored MCP progress without an ordinary stream patch, while main keeps silent canonical output/file-change/command-action caches so snapshots and recovery stay authoritative; raw `mcpNotification` command-output deltas are reserved for streams without a renderer owner. Terminal `item/completed` and terminal `turn/*` lifecycle notifications are sent to the owner, and the owner performs queue-native `drainBefore(...)` before applying final authoritative item/turn state. Follower-originated state-changing thread actions enter main through `codex:thread-follower:action`; main resolves the current renderer owner and sends a `thread-owner-action` request to that owner, while renderer actions pass one authority router: owners execute locally, followers forward, and no-role renderers resume/adopt. Owner actions that need app-server transport use the owner-scoped `codex:thread-owner:app-server-request` facade; main validates that the calling renderer is still the owner and that request params target the owned conversation before running the allowlisted app-server operation. Active-owner `turn/start` is an owner-local optimistic/rebind transaction: the renderer owner generates `clientUserMessageId`, appends and publishes the temporary user turn locally, calls the owner-scoped app-server facade with that client id, then rebinds the temporary turn to the returned app-server turn id and publishes the rebind revision; main returns only the raw start result or summary while silently maintaining durable/recovery cache state. Complete-history follower paths ask the owner to call main's silent `codex:thread:turns:load-complete`, publish the resulting full conversation as an owner snapshot, return the target revision, and make the follower wait for that revision before continuing. Edit-last-user-turn in an active owned conversation is also owner-local: the owner waits for pending owner publishes and forwarded notification sequences to drain, sends `thread/rollback` through the owner-scoped facade, projects the raw rollback response locally, publishes the rollback snapshot, tombstones removed turn/item ids, then starts the replacement through the same owner-local optimistic/rebind path; followers wait for the replacement revision before the edit action resolves. Fork-from-turn follows the same ownership boundary: followers wait for owner complete history and route the fork to the owner, no-role local forks first resume into renderer ownership, and the owner sends `thread/fork` through the owner-scoped facade instead of the removed `codex:thread:fork-from-turn` renderer IPC. If a local edit begins from a no-role active conversation, the renderer first resumes the thread and becomes owner, then uses the same facade path; the old main-owned `codex:thread:edit-last-user-turn` rollback+start IPC is not part of the runtime API. Queued follow-up mutations, pending-steer rows, thread settings, thread goals, and plan-implementation request removal are owner-visible snapshot transactions; main legacy command paths are transport- and durability-only; they never publish a visible transcript. Owner-only reducer/helper precondition failures are not repaired by source-null snapshots: a renderer that is clearly a follower ignores and ACKs owner-only messages, while a renderer with missing owner state preserves its current partial transcript, cancels owner queues, and marks the conversation `needs_resume`. Connection refresh also skips active owner conversations instead of pulling host snapshots over owner-local state. When the renderer-client router reports an owner client disposal, main clears only that client's conversation-owner assignments, releases pending owner-notification drains, and emits `threadOwnerUnavailable`; follower stores reject matching revision waiters, clear the old owner role, mark local conversations `needs_resume`, and resync instead of applying stale owner patches. Connected thread stages report active mounted views through `codex:thread:view-active:set`; main retains resumed renderer owners with no active view for one hour by default, caps retained inactive owners at four, skips active runtime/in-progress/request state, and then calls app-server `thread/unsubscribe` before clearing ownership, marking the dormant record `needs_resume`, and emitting `threadOwnerUnavailable`. Connection/account/rate-limits/thread-summary/thread-start-progress all enter renderer as `sharedObjectUpdated`, sidebar reconciliation enters as `sidebarSyncUpdated`, explicit title updates enter as `threadTitleUpdated`, thread snapshots and incremental updates enter as `threadStreamStateChanged`, owner-disconnect notices enter as `threadOwnerUnavailable`, owner-routed app-server notifications enter as `threadOwnerNotification`, no-owner command output falls back to raw `mcpNotification`, and host/runtime failures enter the same plane as explicit `error` messages. Renderer no longer keeps a separate Codex control reducer; thread-start progress, model bootstrap, permission modes, thread summaries, thread titles, command output streaming, next-turn settings, and active conversations all flow through the same local-conversation app-server manager substrate.
   Thread goal set/clear and thread memory-mode set actions are included in the owner-routed action plane. They are Nodex-owned controls, but they mutate live conversation or runtime-thread state; owner goal actions and goal notifications commit canonical goal/completed-goal/resume-confirmation sidecars before projecting stream-state changes, while memory-mode changes affect later turns. An existing-thread goal submission also appends one canonical app-local completed turn with a null protocol id, `/goal …` in `params.input`, and no raw items; its derived user row strips the slash command and carries `goal: true`. Goal edits with `appendTranscriptItem: false`, status changes, clear, and notifications do not append a row. A follower must not call the main goal or memory-mode IPC directly for a followed conversation.
   Owner app-server requests are renderer-owner request-client calls, not replacement legacy visible IPC. For active owner facade methods, main validates ownership, runs the allowlisted app-server request, and updates canonical/recovery state without emitting source-null stream-state; the renderer owner publishes the visible snapshot/patch and returns the owner revision for follower waits.
   Request response routing is keyed by the visible request's conversation id. Request cards, notification actions, and future response surfaces pass `conversationId` into the manager; follower managers check that conversation's stream role before consulting local `conversation.requests`, so stale followers cannot fall through to direct approval/user-input/MCP/permission legacy IPC merely because they missed a request patch.
   Background-terminal cleanup is a separate owner-local exception rather than a follower-routed action: ordinary followers reject it with the owner-window message, while owners call the silent cleanup IPC, apply the command-id cleanup locally without publishing stream patches, and let main call app-server `thread/backgroundTerminals/clean` plus silently refresh recovery cache state.
13. The active workbench thread stage is mounted entirely through `features/local-conversation`: `WorkbenchShell` passes active thread identity plus static shell inputs into connected thread/review containers, and the local-conversation feature owns the per-thread selectors, active projection pipeline, local type surface, and independently connected header/body/footer thread surfaces. The production route does not rebuild one synthetic `conversation` object or one broad stage model before rendering those surfaces.
14. Main exposes separate snapshot/resume request IPC plus a `codex:host-message` stream. Snapshot requests are read-only dormant-cache reads; they never make main the active transcript writer. Explicit resume drives `needs_resume -> resuming -> resumed` and returns a role-tagged result. With no owner, main hydrates from `thread/resume`, silently seeds the accepted document/revision, compare-and-sets the invoking renderer as owner, and returns the owner result; the renderer releases the ordered same-thread notification/request buffer, publishes the next owner snapshot, then requests replay of transport-brokered pending requests. With an existing owner, main does not resume again: it returns that owner's accepted document, revision, and client id, and the requester attaches as follower without publishing. Failed resume returns to `needs_resume`; main never emits a source-null conversation stream. Session-owned `thread/start` still uses thread-start deferral so early `thread/started` events replay only after the created thread is attached to its target session.
15. The Codex service now stores active thread authority as a conversation-centric manager record (`detail + resumeState + stream role + queued follow-ups + pending steers + item cache`) instead of scattering transcript authority across independent per-thread maps. Running-thread `queue` submits mutate manager-owned queued-follow-up state first, then a manager-owned drain loop advances those entries through `turn/steer` or the next `turn/start` when the active run can accept them.
16. `features/local-conversation` is manager-owned: main schedules auto-title generation for ordinary session thread starts after `thread/start` succeeds and before the first durable `turn/start`, applies the returned title locally, then persists it through `thread/name/set`. Main emits host-scoped `sharedObjectUpdated`, `threadTitleUpdated`, `threadStreamStateChanged`, `mcpNotification`, and `error` messages; auto-title generation failures are logged and do not emit host errors. A renderer host bridge fans messages into an app-server message bus, and per-host app-server managers subscribe to that bus through a registry with per-conversation, any-conversation, and any-conversation-meta callbacks. Connected thread/review containers subscribe only to the active thread and its child memberships. Background child-agent summaries merge parent `subAgentActivity`, legacy collaboration references, and source-linked app-server threads; the projector owns status normalization, friendly names/roles, assistant-message previews, recency ordering, and the modern-inline versus legacy split. Parent child-membership refreshes travel over `sharedObjectUpdated`, including status/archive/delete transitions, so active renderer owners update agent groups without accepting source-null transcript patches. Modern inline activity opens one transient `subagents:<rootThreadId>` right-panel tab: its root route lists the descendant tree and lazily hydrates only visible preview batches, while its detail route reuses the child transcript stage in read-only mode under a compact back header. Background-agent detail routes never mount a composer or claim the session's `ComposerScope`; writable auxiliary thread surfaces instead provide their own stable composer identity. Reopening another modern child updates that same tab's internal route. Legacy non-inline collaboration rows retain read-only `background-agent:<threadId>` tabs and selected-child hydration. Resumed child-thread de-dup reads `conversation.source.parentThreadId -> parent turns` through normal per-thread selectors; renderer must not reconstruct parent ownership by scanning every manager or by inferring parenthood from `childMemberships`. `WorkbenchShell` no longer owns a shell-wide conversation reducer, a full `conversationsById` map, or a separate control-plane reducer.
17. Thread titles are ordinary app-server thread metadata. Manual rename sanitizes to 60 characters before `thread/name/set`; generated titles use the structured title helper (`gpt-5.4-mini`, low reasoning, `{ title: string <= 36 }` schema), reject schema-invalid model output before cleanup, are applied optimistically in main, and are then persisted through the generated-title path. `codex_threads.thread_name` is the local read model for this metadata; thread name/status/archive/delete projections update sidebar rows through `sidebarSyncUpdated`, not through linked `project-sessions-changed` fanout.
18. Renderer theme state follows split ownership: authored CSS declares the token and utility contract, while the runtime theme bridge computes semantic variables such as foregrounds, control backgrounds, borders, panel colors, and editor colors from the active theme variant before the CSS token bridge resolves renderer-facing aliases.
19. The Diff stage is a workbench-owned review surface, not a transcript diff card. `Last turn` review comes from the active conversation turn diff, while `unstaged` / `staged` / `branch` / `commit` review data flows through dedicated main-process Git review IPC. Git review is metadata-first: main builds file summaries from machine-readable Git status/stat/raw channels before exposing optional textual patch bodies, untracked files are diffed through Git rather than decoded in Node as UTF-8, and renderer rows lazily request per-file diff bodies instead of parsing an aggregate snapshot patch. `git:review:patch` is a read-only full-patch query for copy/export actions; `git:apply-patch` is the mutating apply/revert boundary. The Review source selector only changes that data source; it does not start a Codex review prompt. Branch commit choices are loaded through `git:review:branch-commits`, and pull-request status, checks, comments, diffs, merge, update, and create operations flow through typed `gh`-backed main-process IPC with disabled states for missing CLI/auth/remote.

Workbench reopen flow:
1. Main process keeps a profile-local window session catalog in `window-sessions-v1.json`; this is the cold-launch restore source for window count, layout snapshot, focus recency, and saved window bounds.
2. Renderer bootstrap consumes its assigned window session through IPC before mounting the shell. No workspace catalog or deleted legacy snapshot store participates in bootstrap.
3. Live workbench state continues to persist window-locally in `sessionStorage` as an in-session fallback, while durable reopen flows through window sessions. For the project-session shell, this window-local layer may remember active project/session/tab, pane widths, collapse overrides, and focus history; the shared session tree and tab order stay in SQLite.
4. On close, renderer flushes the current layout snapshot, Page draft state, and registered close flushers before sending the final close ack.
5. Each window saves its own session layout. New windows are seeded from an explicit layout request, the last-focused window-session layout, or the default workbench layout.

## Invariants
- Dynamic tools are selected by `(namespace, durable toolset revision, tool)`, never by tool name alone. A model cannot choose its parser or hot-upgrade an existing task. `nodex_app` arguments never carry Project identity or raw storage revisions; main derives scope from the verified task binding. Digest-only operation ETags and self-contained pagination cursors are separate HMAC domains and never grant authority.
- Dynamic writes authorize semantic effects, not raw arguments. Canonical preflight is mutation-free; after consent the Adapter re-resolves current authority and compares effect class, target resources, deletions, and ownership transformations with the approved footprint before executing the fresh exact command. Incidental heads and rank keys may change; expanded scope cannot reuse old consent. The existing Document Hub and Block writer remain the sole execution authorities. Renderer ownership is proof of where to present a decision, not permission state. Ordinary grants live only in main and destructive effects always require a fresh occurrence.
- `blocks.id` is the single content identity. Newly allocated user/content Block IDs are canonical lowercase UUID-v7 values and are validated only when authority registers a previously unseen Block, so existing identities remain opaque and readable. System-derived singleton addresses such as the primary Canvas retain their explicit domain identity.
- One Profile owns one Library. Library owns Blocks, Pages, Documents, Databases,
  Data Sources, Views, assets, search, schedule, and history. Project owns only
  execution state, binds one Database, and receives explicit grants; Project
  lifecycle never deletes Library content.
- Every active Page has one `library | page | data_source` parent, and following
  Page parents always terminates at a matching Library or Data Source without
  revisiting a Page. A
  Source-parented Page has one matching active membership. References and Views
  are non-owning and never expand grant closure.
- Database Container owns Data Sources and Views but no schema/rows. Data Source
  owns schema, Pages, and values. Every View targets exactly one Source and
  positions Page IDs.
- Persistent truth is split by ownership: Nodex-owned board/link metadata lives in SQLite and app-server/rollout history remains the durable Codex source. Main holds dormant recovery/transport caches, never a visible transcript authority. The active renderer owner holds the canonical conversation document plus a derived presentation view; its publication outbox stores only the accepted shared document/revision, strips renderer-private overlays, and is the sole source of follower snapshots/patches.
- TanStack Query owns only low-frequency renderer server state: project lists, project-session summaries/details, board snapshots used outside optimistic board editing, server-backed settings, Git branch snapshots, local-environment config reads, MCP status/resources, and workspace file/directory reads. The Page timeline performs explicit cursor paging because its source-specific cursor is part of the durable history contract. High-frequency or optimistic state stays in dedicated owners: `kanban-store`, mounted content-engine surfaces, the local-conversation app-server manager, terminals, browser/webview lifecycle, drafts, and localStorage-only preferences.
- Main-process local-thread streaming accepts revisioned renderer-owner documents and broadcasts their Immer-compatible `threadStreamStateChanged` snapshots or patches to followers. No-owner lifecycle paths may update a dormant recovery cache, but main never emits a source-null conversation stream; a visible renderer must resume/adopt or attach to an existing owner's accepted document. Snapshots carry `revision`; patches carry `baseRevision` and `revision`; followers drop changes from the wrong owner, wrong base, or missing follower role. Main validates owner publication and treats its accepted copy as a repairable shared document, not a second transcript writer. An owner ignores stream publish echoes. Assistant, plan, reasoning, lifecycle, request, file-change, and output updates are reduced by the renderer owner; asynchronous transport results such as post-resume goal hydration are converted to owner-routed notifications rather than main-authored snapshots. Main retains only transport plumbing and silent recovery/read-model caches. The renderer routes ordinary state-changing actions through one owner/follower/resume authority gate, automatically materializes canonical action mutations into the visible projection, and publishes through a per-conversation outbox whose cursor tracks the last accepted shared document/revision, coalesces in-flight mutations, and repairs rejected patches with a full shared-document snapshot. Renderer-private presentation overlays are stripped before diff or publication. Owner visibility and start/steer RPC dispatch never wait for publication; only resume, complete-history replacement, rollback, and repair use snapshot barriers. Start and steer compile one prepared input and client identity that flow unchanged through optimistic mutation, transport, retry, and reconciliation. Owner-routed requests remain pending JSON-RPC broker entries in main until an owner handles them; command-only automation can therefore run without conversation ownership and replay pending requests after later adoption. Request delivery is idempotent for each semantic request occurrence and renderer owner, while owner replacement permits unresolved requests to replay to the new owner. Main assigns stable renderer client ids for ownership, follower routing, heartbeat leases, and owner-loss recovery. Hidden owners are cleanup candidates only when they have no active view, active runtime, in-progress turn, or pending request. Complete-history loads and edit rollback remain owner-published snapshots; ordinary interaction uses owner patches.
- Renderer resume adoption is an authenticated IPC transaction. Main derives the stable client ID from the invoking `webContents`. If no owner exists, main hydrates, seeds the accepted document/revision, compare-and-sets the caller as owner, and returns an owner result before publication is enabled. If another owner exists, main returns that owner's accepted document/revision/client id as a follower result without issuing another app-server resume. Failed resumes and competing callers never replace ownership.
- Prose streaming lifecycle ordering is a render-boundary invariant, not just a queue-flush invariant. Owner assistant/plan/reasoning queues use Nodex's `drainBefore(...)` shape: hidden/no-rAF or <=24-character terminal buffers flush synchronously and return `false`, larger visible terminal buffers drain across at most eight rAF frames and run the lifecycle callback immediately after the final flush. Because React can batch an external-store text flush with the following completed lifecycle update, renderer conversation notifications use a narrowly scoped synchronous commit for terminal prose flushes and follower in-progress prose patches. That keeps an `inProgress` Streamdown frame visible before `item/completed` / terminal `turn/*` state without adding a renderer-only fake streaming protocol.
- Turn diff, safety buffering, and hook lifecycle notifications mutate canonical turn sidecars before renderer projection. Hook occurrences retain stable local wrapper IDs for repeated protocol run IDs, and the renderer derives hook transcript rows without discarding hidden canonical item identities or advancing conversation timestamps.
- Turn-level app-local metadata rows are canonical synthetic items, not renderer-authored transcript state. Plan, model-reroute, and error notifications append opaque-ID occurrences; automatic approval reviews stable-upsert by review ID while preserving their first local start time; guardian interruption warnings append to the latest turn. Renderer ownership begins after these canonical transitions and is limited to projection, revision publication, effects, and ACKs.
- Runtime validation belongs at boundaries. Persisted storage, selected HTTP bodies, and raw JSON payload families should parse through `src/shared/schemas/*` or feature-local schema adapters; normalized in-memory reducers/view-models remain plain TypeScript once the boundary parse succeeds.
- Page lifecycle/import boundaries must pass shared Page limits; generic property
  and Document commands validate their own bounded typed contracts.
- Block/Page-domain writes must not run synchronous `better-sqlite3`
  transactions on the Electron main process. Route lifecycle, parent,
  property, Database, Document, occurrence, relocation, history, retention,
  binding, and grant commands through `BlockMutationWriter`. Project deletion
  removes execution state and revokes subscriptions only; Library content
  remains.
- Agent-facing Project reads capture effective grant scope, content, and
  pagination authority in one deferred worker transaction. Search access and
  lifecycle filters run before candidate limits; exact Document and Source
  evidence comes from the same snapshot. Search scores and numeric concurrency
  coordinates remain private.
- High-frequency renderer board state must use `BoardSummary`. `kanban-store` tracks per-Project fetch freshness and first subscription calls `ensureFreshBoard` instead of unconditional refetch; explicit refreshes, ambiguous realtime events, and mutation recovery may still force a summary fetch. Title/body summary fields come from current Document materializations. Full bodies belong to a mounted Document surface or an explicit scoped detail/export read, not `kanban-store`, Board/list/Calendar Views, or command-palette indexing.
- The renderer mounts one selected project-session task page and one selected tab body per panel leaf. Task and tab switches dispose their React views; scoped Maitai atoms restore renderer presentation, while Query, Codex conversation execution, Browser, Terminal, and collaborative Documents keep authority in their deeper Modules. Only the selected route may register global header actions, panel measurements, Browser visibility, or thread view-active state.
- Recurrence exceptions and reminder receipts are Page/Library-scoped and
  persisted in SQLite; Project is evaluated access context.
- Every occurrence complete/skip/update request carries a caller-generated logical `operationId`. Complete and clone-capable update scopes also carry a preallocated UUID-v7 `createdPageId` as semantic intent. The semantic hash excludes transport actor/session, so IPC/HTTP failover and window/process restart replay the first committed or rejected result. Reusing the operation ID with another Page, created Page identity, occurrence, scope, update, or command kind is a typed collision.
- Completing an occurrence creates an archived Page whose status is `ship`; archived Pages stay out of board/sidebar/toggle-list flows but still surface in calendar occurrence queries.
- Status and manual View movement are Database operations with exact property/View revisions and logical anchors; stale intent fails as one typed conflict.
- Metadata concurrency is field/path scoped. Scalar Block/Database properties compare their own revision, set-like values preserve add/remove intent, and a stale claim returns a typed conflict without mutating unrelated fields. Title/body concurrency is Yjs-based and never uses a whole-Page revision.
- Library-scoped Block, Document, Database, projection, and history evidence is
  isolated by `library_id`. Projects never move content between ownership
  scopes; binding and grants alter access.
- Renderer never accesses SQLite directly.
- Custom editor behavior must preserve NFM round-trip fidelity.
- Codex threads are session-owned locally. Durable chat ownership is represented by the one-to-one `project_session_threads` relation; Project-bound sessions have `project_id`, projectless sessions use `project_id = null`, and Pages can mention or reference threads but do not own them.
- Sidebar thread discovery is global and app-server-led. `codex:sidebar:snapshot` is a SQLite read model for cold-start rendering, while `codex:sidebar:sync` performs continuous app-server reconciliation through mount/focus/heartbeat/host-message/project-change triggers. Project folders are a view over that global snapshot, not the primary thread discovery source.
- Global thread pin authority lives in `codex_pinned_threads`. `project_sessions.pinned` may mirror pin state for compatibility but must not be used as the primary authority for attached Codex sidebar rows.
- Sidebar projection treats project membership and pin state as orthogonal coordinates. `pinned`/`chats` are the projectless lanes, while `project-pinned:<projectId>`/`project:<projectId>` are the project-owned lanes. A project folder target preserves the source pin lane; an explicit cross-lane drop changes pin state, and a cross-project pinned-lane drop changes ownership without unpinning.
- Sidebar manual order is durable-thread identity state, not project-session layout state. Each regular lane starts from stable recency order and replaces only slots tracked by its stored manual IDs. A manual-order command publishes only the refreshed sidebar snapshot: it neither rewrites `project_sessions.order` nor emits a project-session change. Cross-Project moves atomically commit thread/session ownership with every affected manual-order scope; the owning session gets the deterministic head of its new shell scope, while sidebar `before`/`end` intent changes only the destination manual-order authority. The per-project pinned lane is projected separately from global pin order; pin/unpin therefore changes lanes without deleting the thread's project manual identity.
- Attached project sessions must never use `project_sessions.no_thread_fallback_title` as the primary chat title. Codex thread title authority is app-server metadata, reflected locally through `codex_threads.thread_name`; project sessions expose only a derived `displayTitle` for shell rendering.
- Session-created threads must not create hidden Pages or Page-thread ownership links.
- Project-session panel layouts must normalize to at least one leaf per right/bottom panel. Durable tab ids are uniquely owned by one leaf, unknown tab ids are removed, unassigned durable tabs are appended to the active leaf, non-final empty durable leaves are pruned unless the renderer is preserving them for visible preview/side-chat tabs, active leaf/tab ids resolve to valid fallbacks, split ratios are clamped, and the flat `project_session_tabs` panel order is derived from depth-first leaf order after every durable panel mutation.
- Project-session panel tab drag-and-drop separates tab-row insertion from body split targets: tab-row drops render a non-layout-shifting insertion marker and commit leaf-scoped reorder/move operations, while body drops use a 10% edge threshold for split previews and center drops for group merge.
- Side-chat threads are ephemeral manager/cache records only. They must not create durable Codex thread links, session thread links, project thread-list entries, project-session tab rows, archive records, or cold-start restore targets.
- Codex thread creation is session-first and includes immediate first-turn submission for durable thread materialization.
- Codex thread/turn cwd must use the linked thread cwd when present (not only the project primary-source fallback).
- Thread-title generation is main-owned for session thread starts: after the app-server returns the new thread id, main builds a text-only first-prompt title prompt, runs the fixed structured helper, applies the title locally, and persists through `thread/name/set`. Auto-title failures stay log-only; generated titles follow the fixed 36-character structured title schema, while manual rename remains the only 60-character title sanitizer.
- The active workbench conversation stage is now conversation-native: `features/local-conversation` consumes `CodexConversationSnapshot` turns/items directly, then derives an ordered per-turn item stream, semantic render buckets, blocked-turn state, search units, and collapse state in the renderer.
- Canonical dynamic-tool projection must retain the app-server arguments, output items, success, duration, and exact raw item for every visible call. Transcript presentation is a renderer projection over that canonical state: the shared inspector owns formatted details/raw access, while the `nodex_app` metadata projector owns compact intent labels and bounded Nested Markdown change previews without changing execution data or inventing missing before-state. The projector dual-reads v2 and v3, but new authorization and presentation values use `markdownPreview`/`markdownChange` only.
- The active workbench conversation stage must stay local-conversation-owned end-to-end: active shell, composer, thread-body helpers, request cards, and thread-item renderers have no secondary workbench thread renderer path.
- The Diff stage has its own review data plane. Transcript diff cards (`turn.diff`, tool-call patch previews) remain local-conversation surfaces; workbench review sources (`last-turn`, `unstaged`, `staged`, `branch`, `commit`, and PR descriptors) are owned by `review-diff-panel` plus main-process Git/GitHub review IPC, including metadata snapshots, per-file diff loading, search, cancellation, read-only full-patch export, patch application, blame, repository init, full-file-content reads, and typed PR disabled/error states.
- Review file safety is a shared boundary model, not a renderer styling choice. `ReviewFileSafety` / `ReviewSkipReason` are derived outside the generated app-server protocol and must gate patch materialization, Git full-file reads, renderer diff parsing, and diff-domain content search before any binary or oversized bytes can become body text.
- Live request entries (`approval`, `userInput`, `permissionRequest`, `mcpServerElicitation`, and `implementPlan`) are canonical `conversation.requests` entries, not renderer-synthesized heuristics. For active conversations with a renderer owner, command/file approval, permissions approval, user-input, and MCP elicitation request ingress and response-side removal are owner-published stream-state patches; main remains the app-server response-plumbing owner. Ordinary dynamic tool calls are owner-gated but do not create `conversation.requests` rows unless their protocol branch is a visible request picker/setup flow. Active-owner plan-implementation request removal is also owner-published before main updates durable/recovery cache state; no-owner plan-request cleanup remains transport/recovery state and is never main-visible. The renderer derives request cards by joining `conversation.requests` against the matching turn items before bucketization so blocked-turn state and composer request surfaces come from one canonical request owner.
- The composer region is one multiplexed shell, not a stack of unrelated footer surfaces: manager-owned pending steers, queued follow-ups, background terminal rows, and background child-agent rows render in one ordered shell above the input region, while live request cards replace the normal editor branch inside that same shell. When both exist, the first background child approval renders before the active-thread request card.
- Running-thread composer follow-up semantics are explicit: `queue` only mutates queued-follow-up state, `steer` submits an in-progress follow-up, empty drafts stay on `Stop`, and queued rows are drained by manager-owned follow-up submission instead of a renderer-local fake queue path.
- Internal bootstrap/context content such as `AGENTS.md`, developer instructions, and other setup wrappers is not part of the visible chat transcript.
- `cloud` run target is intentionally blocked at backend thread-start.
- For `newWorktree`, Page-level `runInWorktreePath` is reused when available; missing/invalid paths are recreated and overwritten on the Page.
- For `newWorktree`, optional `runInEnvironmentPath` stores a repo-relative `.codex/environments/*.toml` path. The full local-environment definition (`name`, `setup`, `cleanup`, platform overrides, actions) is owned by the main-process worktree-environment service and surfaced through the workbench settings page; only the selected default `[setup].script` participates in managed-worktree creation today.
- Environment setup failure aborts thread start, does not persist `runInWorktreePath`, and triggers best-effort cleanup of the newly created managed worktree.
- Managed worktree inventory is derived from linked thread cwd values rooted under `${nodexHome}/worktrees`, deduplicated by resolved worktree path.
- Project identity is UUID-only and generated by the main process. Project names are display labels, ordered `project_sources` rows own local source folders, the first source is the primary cwd for Git, Files, Review, local-environment, and managed-worktree flows, and all sources participate in workspace-write sandbox roots.
- Codex worktree/local-environment execution requires a project primary source; plain local thread starts for empty-source projects allocate a generated per-thread workspace. Browser transport explicitly does not support Codex threads in this phase.

## Cross-Cutting Concerns

### Reliability
- WAL mode + transactional writes for consistency.
- Whole-store backups include DB and asset files from one quiesced maintenance boundary; restore is journaled across both filesystem roots and rotates the collaboration epoch.
- SSE fallback keeps browser clients reactive when IPC is unavailable.
- Codex runtime has startup gating (`initialize`/`initialized`), connection-state surfacing, and restart/backoff handling.

### Security
- Renderer runs behind preload bridge; no direct Node API access in app code.
- HTTP write routes enforce body limits and field validation.
- SQL query endpoint is read-only (`Statement.readonly` enforcement).
- Codex approval requests are policy-controlled (`auto`/`manual` per project) before command/file-change execution proceeds.
- Main binds Profile/Library/Project/Session identity at every content Adapter.
  The authorization Module rechecks Project lifecycle, binding, resource-grant
  and access revisions; recursive access follows ownership and never references.
  This resource decision is independent from Codex approval policy.
- Native prepared Agent writes remain semantic operations inside the owning
  Module `read/apply` pair. Electron supplies its frozen Turn provenance and the
  intent; Core revalidates the persisted Turn and canonical target in one read
  snapshot, returns a bounded single-use token plus effect/target footprint,
  and re-prepares under the writer transaction. The token is bound to the UDS
  connection, exact request, authority revisions, footprint, and effect class.
  Exact durable receipt replay runs before token/current-guard validation and
  succeeds only for the same provenance and intent fingerprint.

### Observability and Debugging
- Canonical Page history reads immutable semantic Document revisions and Block/
  Data Source mutation, relocation, and change evidence. Linked content evidence
  projects as one revision; legacy Card snapshot history is import-only.
- Backend services can emit structured logs (JSON lines) with child-scoped context for HTTP, integrated terminal, backup/reminder, and Codex runtime flows.
- Backend logs persist under `${NODEX_HOME}/logs` for dev/unpackaged runs or explicitly enabled packaged diagnostics, with bounded serialization and sensitive-field redaction for debugging without dumping raw secrets.
- Renderer telemetry can emit opt-in Statsig product events through a central helper. Statsig loads only when enabled, uses anonymous Stable ID identity, flushes on app close, and keeps web analytics behind a separate filtered AutoCapture opt-in.
- Detailed logging reference: `docs/product-specs/backend-logging-spec.md`.
- Editor subsystems include focused tests for parser, keyboard behavior, and sync edge cases.

## Test runtime boundaries

Tests are assigned to the runtime that owns the behavior instead of sharing one
synthetic global environment. Pure shared logic, operational scripts, and
renderer helpers marked with the `.node.test.ts` suffix run in Node 24; the Node
configuration preserves renderer import aliases without loading React or jsdom
setup. Main-process and SQLite tests run through Electron with
`ELECTRON_RUN_AS_NODE=1`, so native addons use the same ABI as production.
Ordinary renderer component tests use Vitest with jsdom; contracts that depend
on computed CSS, selection, focus, pointer input, observers, or layout geometry
use Vitest Browser Mode with Playwright Chromium. Playwright Electron smoke tests
cover the complete main/preload/IPC/renderer/SQLite process chain.
