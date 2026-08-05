# Architecture

Current Rust Store authority is v104. Database contract v6 centralizes typed Property schema, capabilities, and edits. Relation definitions and Page-reference edges are normalized in `data_source_relation_properties` and `data_source_relation_edges`; JSON `null` headers retain revision/CAS leverage while reverse indexes support projection invalidation and retention. Main and renderer adapters map this contract mechanically: authorized Database catalogs, target-Source candidate windows, relation-value windows, and bounded summaries replace View-cache inference and per-Page hydration. Library contract v9 provides the upper transaction for Page Detail actions that combine Database-owned Source Properties with Library-owned intrinsic Properties, while preserving the lower ownership boundaries and restricting the composition to value edits over one identical Page set.

Store v104 completes the LocalCommit cutover. v102 introduced semantic local
mutation identity, v103 added `(store_epoch, commit_seq)` foreign-key
boundaries for effects, Document impacts, and module receipts, and v104
canonicalizes the complete envelope evidence and verifies it on replay. The
physical `change_log_seq` remains an internal effect/history coordinate and is
not a renderer cursor. v104 is a logical integrity cutover; it reuses the
validated v103 physical inventory and does not add a second storage authority.

## Overview
Nodex is a local-first, block-based agent orchestrator for coordinating coding-agent work. One detached native Rust Core is the exclusive SQLite and collaborative-document authority for each Profile. Electron is the Desktop Host for windows, typed renderer IPC, operating-system integration, and the pinned Codex-compatible app-server runtime; supported macOS Desktop Tool threads retain that app-server while launching their shared REPL through the vendor-signed Node and Codex ancestry required by native Browser and Computer Use authentication. The native CLI and desktop renderer reach product state through Core-backed semantic adapters.

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
    │   └── nested Page/Database/
    │       Canvas                  ownership descendants
    ├── Canvas                      scene-bearing Block
    │   └── Document                canvas_scene authority
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

Canvas is also a document-bearing Block. Its Block identity owns metadata and
one exclusive `library | page` placement; `canvas_owners` records Library
membership, and `block_documents` resolves its independent `scene_graph`
Document. A Page-owned Canvas appears in the Page Y.Doc only as a childless
`canvas` shell whose Block ID is the Canvas owner ID. Scene elements, files,
app state, history, and Document identity never enter the Page Document.
Project creation retains one deterministic primary Canvas, but that default is
ordinary Canvas authority rather than a Database View presentation.

Page, Database, and Canvas are typed owner Blocks, not generic Yjs nodes. A
generic editor delete, cut, paste replacement, reclassification, or duplicate
cannot retire or clone one of these identities. Owner lifecycle commands must
carry the exact current Document head of every host Page whose shell changes;
Core applies the owner/index/read-model transition and the host shell edit in
one LocalCommit. This keeps the independent Page body, ownership closure, and
host Document causally consistent even when the owner is nested or mounted in
another tab group.

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
its Interface. Trusted IPC, CLI, renderer, and Agent-tool Adapters bind
Profile/Library/Project/Session identity, while the Module hides binding and
grant evaluation, schema/value validation, dormant membership history,
fractional ranking, revisions, idempotent receipts, projections, and post-commit
events. Resource authorization and Codex operation approval are separate
Modules.

## Local mutation and projection convergence

Durable user mutations have one semantic `LocalCommit` envelope. Core assigns
the `(store_epoch, commit_seq)` identity inside the SQLite transaction and
persists the envelope, its physical effect references, affected Document
heads, and the idempotent receipt before returning the successful response.
The older `change_log` effect sequence remains an internal storage coordinate;
renderer-facing mutation results and projection cursors use the semantic local
commit sequence.

The Main process admits the envelope from an apply response synchronously into
`LocalCommitDispatcher`. Admission is not projection completion: the response
can return to the renderer immediately, while the dispatcher serializes
document fanout, scoped projection invalidation, and domain notifications in a
retryable background drain. The durable Core event tailer and replay path feed
the same dispatcher. `(store_epoch, commit_seq)` plus the canonical hash makes
the two paths at-least-once and deduplicated; a later richer envelope can
replace a not-yet-started sparse admission, and an identity collision fails
closed. The event supervisor therefore does not make a renderer wait for the
durable stream or a projection listener.

Document and Canvas realtime delivery has a separate per-surface durable head
ordering barrier. A future head is buffered, a contiguous head drains in
order, and a bounded overflow emits an explicit resync. This ordering is
independent of the semantic LocalCommit order because one commit may update
multiple Documents and two apply responses may arrive out of order.

Document payload bytes are operationally compactable, but the LocalCommit effect
is not deleted from the durable semantic history. The v104 canonical hash covers
the parent identity, every ordered physical effect, projection impact, and
Document reference metadata, so changing any of those facts fails closed during
replay. If replay finds a verified
Document effect whose update bytes have been compacted, Core emits the typed
`document_resync_required` effect with the Document generation/head and update
identity/hash. Main turns it into a `history-compacted` surface resync; it never
silently skips the effect or invents an empty Yjs update. The surface repairs
from the canonical snapshot/state vector, while an apply response may still
deliver the original bytes before compaction.

Before a structural Block mutation, a mounted Yjs surface runs a causal
barrier: it flushes its local durable updates and returns a typed
`DocumentHeadToken` containing Document identity, Store epoch, generation, and
head sequence. Move-to and cross-surface Board DnD include the observed tokens
in the logical command. Core rechecks every token during both planning and
apply, so a local body edit cannot be silently overwritten by an ownership or
membership mutation. The fence is a freshness precondition, not idempotent
command identity; retries with a newly observed head retain the same semantic
intent hash.

Renderer stores treat projection invalidation as a minimum cursor, not a
second authority. Each consumer tracks the `commitSeq` covered by its
canonical read; an old response cannot replace a snapshot already covering a
newer commit. Successful receipts and LocalCommit fanout drive the same
invalidation registry, so Board membership, Page ownership, title/body
materialization, and navigation converge without focus changes or manual
refresh calls. The router admits invalidations without awaiting projection
reads, serializes work per scope, and retries failed reads with bounded
backoff. There is no per-item pending projection state: when Core has durably
committed, the local commit is the current authority and the renderer
reconciles through its normal canonical read boundary.

## Codemap

### Native Core and Desktop Host boundary

Bootstrap fixes Rust Core as the process-lifetime authority before any legacy
database path can open. The retired `NODEX_CORE_BACKEND=typescript` selector is
rejected, and the JavaScript SQLite/Yjs authority has been removed. The frozen
v84 SQL artifact remains import evidence. A separate hash-pinned migrator,
reproducibly built from one fixed historical source commit plus reviewed
import-only compatibility overlays, can advance the exact frozen v26, both v57,
v68, v82, and v83 snapshots to that handoff schema, but it runs only against a
disposable staging copy and can never become the live authority. Every launcher
first executes its validated candidate as the single-winner selector. Under the
Profile lifetime lock, that selector either
starts the candidate or authenticates and reuses an incumbent that satisfies the
generated transport, event, per-Module, exact Store-format, and launcher
freshness policy. Its bounded selection result identifies one exact generation;
only the following authenticated handshake proves authority. Electron may opt
the launched candidate into a private, versioned, bounded NDJSON startup-event
prefix on the same machine stdout channel. Those best-effort frames expose
candidate timing and a Store migration only after Core has authoritatively
classified a supported older schema and before its first migration write; they
cannot select a process, extend authority, or replace the terminal selection
result and authenticated generation handshake. Native CLI launch does not opt
in and continues to receive the selection result as the first line. Main
retains a monotonic UI projection so a window created after the event still
receives the true migration state. Main initialization routes every durable
port through Core before renderer windows become operational; disconnecting
Electron does not terminate the detached Core. The active
proxy slices cover the established Library catalog/navigation `read`/`apply`
IPC pair, Project/Library Page Detail, explicit-authority Page references and
ownership paths, trusted-root Page deep-link location, and the Project catalog
boundary. Page lifecycle and mixed Page Property writes also cross the native
Library aggregate boundary through Core.
Electron keeps the Profile/Library/Store epoch authority identity stable for
its whole process lifetime, but treats a Core process generation as a
replaceable transport session. Every long-lived Desktop adapter targets one
`DesktopCoreAuthoritySupervisor` facade rather than the first raw UDS client.
Definitive socket loss or a draining response re-enters the same safe selector
and exact handshake, coalesces concurrent callers behind one recovery, and
atomically adopts only a ready generation with the same Profile, Library, and
Store epoch. Store-epoch or authority drift fails closed and remains an App
relaunch boundary. Existing global and Document logical stream supervisors
then reopen their physical streams through that facade from their retained
cursors; they are not recreated per generation. The Desktop authority reuses
one logical Core connection ID across those handshakes, while a monotonic
lifecycle epoch fences candidate adoption and replay after Main closes. Durable
receipt identity excludes that physical connection; Yjs durability binds the
renderer's stable logical client session instead. Background producers repeat
authority admission after asynchronous claim boundaries and return leases for a
bounded retry if authority changes before external work starts.
Library Module reads and writes carry an explicit `ContentAccessContext` from
the mounted content surface. Main admits only trusted app-window senders,
strictly parses that context, and selects the Library or Project Core client
without consulting mutable Window Session navigation. Committed Core events
become renderer Library or Workspace invalidations.
Workspace events carry a typed Project-catalog change kind, explicit Session
summary scopes (`project`, `projectless`, or `all`), and exact Session detail
identities in addition to audit-oriented affected identities. A Host replay-gap
repair broadens the detail invalidation to `all`, because omitted events may
have changed Session domain state outside a known scope. The event bridge maps
catalog mutations and Database View structure changes to the global Project
subscription — the Project catalog projects the primary Database default View,
so View changes must refresh it — and routes Session invalidations
through one global typed subscription, so one aggregate event never
turns routine chat activity into a Project-list refresh.
Project catalog reads, creation, metadata/source updates, sidebar and pinned
ordering, and archival all pass through one Workspace Adapter. Project reads carry the primary Database's current default View resolved from
Database authority at read time. Session reads contain only Project or
projectless scope, title, ordering, pin/archive/unread state, optional Thread
link, and timestamps.
Session creation/deletion, ordering, pin, archive/restore, unread, and Thread
link transitions use the same native aggregate. Tabs, panel trees, selection,
and geometry never cross that Core boundary; the renderer combines Query-owned
Session domain data with its assigned Window Session Scene. Project, Session,
and Thread-link IPC dereference the Core-backed Workspace port. Owned Document descriptor reads
and owner preparation select the same Project or trusted Library Core scope as
subsequent synchronization; Library results remove the compatibility storage
Project before crossing IPC. Project-scoped live Yjs subscribe,
sync, update, and Awareness IPC use a lifecycle-aware Owned Document bridge;
each native subscription is bound to its Electron target, Project, Document,
and client session and is closed with the target. The bridge reserves that exact
session while opening, acknowledges it only after the authenticated Core stream
is physically open, and serializes replacement behind predecessor teardown. One
logical subscription supervises retryable physical UDS interruptions from the
last delivered cursor; dependent commands wait for its current connection,
and a typed stream recovery invalidates a stale physical stream before one
safe/idempotent command retry. A fatal stream end atomically releases the
renderer binding. Session-qualified connection events prevent a retiring
provider from changing its replacement's state. Library-scoped live Page
Document sync uses the root Core client and an explicit Library transport scope that the
server accepts only from trusted local Electron, native CLI, and test Adapters;
Core resolves the Page's local Library identity and read/write lifecycle itself
and never accepts an Adapter-selected storage Project as Library authority. The
Library writer similarly resolves any schema-required compatibility Project
itself, separately from the optional requesting Project, so an archived
execution context cannot disable local-user Page, Database, Canvas, or property
mutations.
Project-authorized Canvas scene subscribe, full sync, and field/element mutation use the
same supervised bridge and exact-target lifecycle. Canvas and Yjs
share one client-session identity, while durable Canvas events carry the actual
pre-commit authority head so replayed scene deltas retain their causal boundary
even when a stale non-conflicting intent merges. Canvas tombstone compaction is
invisible idle maintenance: Store metadata decides eligibility in O(1), and the
last closing surface may proceed only when its outbox is empty and Core can
validate the current Document head. Core commits the safety revision and the
next generation atomically; the Host only forwards the resulting boundary to
open surfaces. Offline, concurrent-surface, and stale-generation failures defer
without blocking close. The generation event makes old outbox intent terminal
rather than replaying it into the compacted scene.
Canvas collaborator presence branches at the Electron Host instead of entering
Core. A bounded in-memory hub accepts publications only from an exact active
Canvas target at its synchronized generation, derives collaborator identity
from that WebContents binding, and fans pointer/selection/idle snapshots to
other targets. Clocks, clean unsubscribe, and TTL expiry order this advisory
state; no presence packet opens the SQLite writer or becomes a receipt, event,
history record, or IndexedDB outbox entry.
Additional Document owner commands for Synced Blocks and Reusable Templates
use that same authority-selected Owned Document bridge. Canvas structure
instead enters the Library mutation boundary, which atomically changes its
owner metadata, independent Document genesis/lifecycle, Library or Page
placement, and childless host shell. The Adapter submits one deep command to
the exact Project client and maps the native mutation effect, event sequence,
and persisted commit time back into the established receipt. When that effect
contains Page Document commits, the Host publishes them through the same exact
scope-aware Document-sync ingress used by native Yjs events before completing
the renderer command. Mounted Project and Library providers therefore converge
from the atomic Canvas transaction itself; later Core replay remains an
idempotent repair path rather than the normal visibility mechanism. Renewable
Document heads and connection identity are execution evidence rather than
semantic retry identity, so a durable receipt can replay after a provider flush
or Electron reconnect while all owner, generation, placement, and content
coordinates remain collision fenced.
Immutable Owned Document checkpoint creation plus version list/detail reads use
the same exact-Project bridge. Core persists the trusted actor, revision kind,
optional mutation evidence, and materialization/checkpoint hashes in one
immutable version identity; a checkpoint receipt returns the complete public
summary and distinguishes operation replay from an already-existing identical
version. Pagination carries the full `(baseHeadSeq, createdAt, versionId)`
cursor and Core verifies all three coordinates against the retained row before
reading the next page. The Adapter validates every returned summary against its
Project, Document, metadata, and materialization boundary. Forward restore
validates the current generation/head and commits the forward update,
before/after restore checkpoints, semantic Block effect, change event, canonical
timestamp, and exact-retry receipt in one writer transaction. Mounted surfaces
first flush their local durable updates through a causal barrier when the
command consumes their content, but they are never frozen and do not supply
authority proofs. The receipt carries the committed Document boundary back to
the owning bridge; renderer/connection identity is excluded from semantic
retry identity, so a reconnect or later head cannot hide an already-committed
receipt.
Public stable-ID Document batches and whole-NFM replacements use the same native
boundary. The Adapter translates the established renderer contract into typed
Core operations, including an explicit absent/value wrapper for nullable Block
content. Core prepares the relative Yrs update at the exact generation/head,
derives the semantic Block effect, and commits the update, event, projection
impact, and receipt in the same transaction. The renderer may use a
surface-scoped causal barrier to flush local Yjs work before a structural
command, but mutation authority remains Core's generation/head CAS. Mutation
identity excludes the renewable connection and actor, so reconnect replay
returns the original audit/effect rather than executing again.
Public ordinary-Block move/copy between Page-owned or directly addressed Yjs
Documents also uses this native boundary. Exact physical ownership is sufficient;
otherwise Core authorizes Page-owned Documents through the requesting Project's
canonical recursive Page/Database grant. Copy requires source read and target
write authority, while Move requires write authority on both sides. The Library
Module resolves the exact source and target Document heads inside Core, applies
portable Yrs subtree updates, relocates or renews registry identities, and
commits Document updates, structural evidence, operation checkpoints, the
Library event, projection impact, and one reconnect-safe transfer receipt
atomically.
A cross-storage Move rehomes the complete ordinary-Block registry closure to the
target Document's compatibility Project and records general mutation evidence;
same-storage movement retains the stricter relocation ledger. Same-Document move
remains a stable-ID Document operation. An ordinary root can also target the
Library root or a Data Source: Core deterministically promotes title-capable
Blocks or wraps the unchanged subtree in a fresh Page, creates the Page ownership
Document, and commits the source edit plus Page genesis under one Library writer
transaction. Library placement creates both Library/Project ranks; Data Source
placement reuses the Database Module's membership, built-in value, grouped-View
position, and projection kernels and reports the affected Database. These
branches touch only the existing source Document because the target Document is
created inside the transaction. Existing Page Move retains identity and its
recursively owned Documents while changing only the canonical parent and any
containing Page shells. Page Copy clones the complete
Page/Synced/Template/Canvas ownership closure, and multiple roots targeting one
Page stage all closures before one ordered target-Document commit.
Page target and ownership-path reads use the Library Module Adapter selected by
the surface's explicit content authority. A trusted local root receives the
complete same-Library target and ownership ancestry; a Project-bound client is
evaluated against recursive resource access in one read snapshot and sees only
the highest-to-direct-parent prefix independently readable by that Project.
Missing or unreadable Project targets remain non-disclosing. Project-scoped
Page History remains Project-authorized. Page Detail, Page content, and Page
paths enforce the same trusted-root-or-bound-Project distinction. Global Page
and saved-View deep-link lookup uses separate minimal location projections
accepted only from trusted root Electron, native CLI, or test Adapters;
Project-bound and Agent clients cannot enumerate storage Projects. A View
location resolves its active View, Data Source, Database, storage Project, and
lifecycle chain in Core. The CLI never uses this global lookup: it first selects
one Project and validates the Page or View through that Project-bound authority.
The Adapter maps these typed native results through the existing strict renderer
contracts before IPC. Semantic Agent
`fetch` resolves a Page or ordinary child Block to this same owned-Document
authority, then Core returns canonical Nested Markdown/plain text, a bounded
flat Block projection, and only the requested narrow ETags through a signed,
head-bound pagination cursor. Agent `search` combines typo-tolerant Page
identity/title/property evidence with exact/prefix current-Document FTS, filters
the complete candidate set through current Turn, Project grant, and logical
Library/Page/Database/Data Source scope before ranking or pagination, and emits
Core-signed event-head cursors. Codex execution remains Host-owned, while every
durable Nodex Project/Thread/Automation projection enters Core and fails closed
if the native port is unavailable.
Renderer Project Page search is native in Library Module v2: one trusted root
Library read accepts the requested Project sequence, evaluates
each Page's primary-Database or recursive grant authority, requires its current
Data Source workflow status, and returns a bounded deduplicated projection with
the exact current title, status, score, and excerpt. Command palette, move-to,
and panel destination pickers consume this projection for non-empty queries;
they never hydrate every Project Database View to construct a renderer search
index. It is intentionally separate from Library-wide semantic content search,
whose raw Block/Document evidence serves CLI and Agent use cases.
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
actions return through the same port. Electron remains responsible only for
external Codex execution, live renderer ownership evidence, transcript
observation, app-server Thread coordination, and OS notification presentation.
Store Administration backup inventory, manual creation/deletion/restore, and
automatic creation/retention use one Core-backed desktop port. The Adapter maps
the complete immutable manifest projection, including trigger, asset inclusion,
and database/asset/total byte counts. A successful
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
Database v2 parsers. Renderer Database intents carry only a presentation-origin
tag; Electron replaces their actor with the trusted IPC sender identity, and
renderer session IDs never enter Database Apply. Core records operation kinds,
every committed revision, change-log sequence, and commit time inside the
writer transaction; durable Database events also retain the actor Project so
Electron can publish the existing resource-scoped Database and Library
invalidations after commit.
Under Rust authority, Database View reads are count- and encoded-byte-bounded
keyset windows over exact-head Page summary projections. Window rows carry
title, description preview, revisions, bounded property values, and View
placement, but never Page NFM. A strict storage-independent Adapter may expose
a bounded compatibility query shape to existing renderers; it cannot expand
beyond the Core window. Full Page content is available only through the
identity-scoped Page/detail and owned-Document paths. The Project-bound
`ViewContext` read composes the authorized Database, Data Source, saved View
config, projected Property definitions/options, group totals, and one signed
row window inside the same SQLite read transaction. It reuses the View window
and group kernels, and signs each row's narrow move ETag from Page location,
membership, grouping-value, View-revision, and View-position authority; CLI
callers never replay View config or assemble those coordinates themselves. The
same Core signer serves `read --prepare page.move`, while the Library writer
recomputes the validator after resolving the requested destination View and
before applying a transfer. Same-Data-Source placement keeps Page ownership and
membership stable and atomically updates the grouping Property plus View
position; cross-owner placement continues through the structural transfer
aggregate. Successful receipts include the final View/group position and a
fresh move ETag, and exact retries return that stored result before revalidation.
Canonical `nodex://pages/<encoded-id>`, `nodex://sessions/<encoded-id>`, and
`nodex://views/<encoded-id>` parsing is defined by one cross-language fixture.
Electron resolves Page/View identity through trusted Core before sending typed
renderer ingress. The Workbench reuses its panel command router so a View link
selects the owning Project and focuses an existing exact-View tab or creates
one durable `db_view` tab; no URL controls a shell command or arbitrary route.
Page creation, ordinary Block-to-Page promotion,
and recursive Page copy initialize the same nine intrinsic Properties in Core,
so incomplete durable authority fails at the projection boundary instead of
being repaired with read-time defaults. A private exact-Page Database target
serves the legacy single-row compatibility read for active or archived Pages,
including default-View group order; it authorizes through the owning Database
and remains behind the desktop port rather than expanding the public
TypeScript Database v2 request union.
Page lifecycle compilation uses one Project-bound Library Core read rather
than assembling mutable coordinates in Electron. In the same snapshot Core
returns the default Database/View query, exact tags Property revision, reserved
Block identity, Page/Document authority, parent and Library placement,
Data Source membership/status/View position, and lifecycle revisions. The
strict Adapter maps that native snapshot into the established lifecycle-v2
compiler contract, and Electron IPC selects it through the authority bridge.
Database value and position mutations advance `blocks`, `pages`, and the Page
read model to the same metadata revision; lifecycle CAS therefore observes the
same Page authority after any Database edit instead of failing on projection
drift.
Page lifecycle writes use the same Project-bound Library bridge and one native
`apply_page_lifecycle` aggregate. Create, archive, unarchive, delete, restore,
and Library reorder validate their exact Page/Document/Data Source authority,
compile Yrs genesis or recursive indexed-Document tombstones where required,
update membership, Property compatibility values, View/Library placements,
schedule and Page projections, and commit one immutable Library receipt/event
inside the existing immediate writer transaction. Delete receipts retain the
exact previous lifecycle, dormant membership/View coordinates, indexed
Document closure, and tombstoned Block revisions needed for restore; preflight
derives restore evidence from that receipt rather than mutable Electron state.
Nested Page delete/restore additionally tombstone or recreate the child shell
in the containing Page Document in that same commit, using receipt-carried
parent position evidence for restore. A stale or missing host head is a typed
conflict, never permission to fall back to a raw Block removal. The apply
response publishes the committed host-Document effect before the renderer
command completes; the event tailer is only an at-least-once repair path.
The recursive closure also advances every independent typed-owner authority it
contains: an embedded Database tombstones/restores `database_containers` with
its Block and records the owner revision in delete evidence. Closure validation
rejects a missing or divergent owner authority before any tombstone is visible.
All Library and View placement receipts use the canonical 32-digit fractional
rank format, including bounded repair of imported legacy ranks. Exact replay
returns the original receipt without reverting a later restore or advancing a
revision again.
Page Property v2 writes use one native `apply_block_property_mutation` Library
aggregate for each mixed intrinsic/Data Source field batch. Core keeps
compare-and-swap sets, multi-select add/remove deltas, cross-field schedule
validation, Page/Data Source authorization, metadata advancement, Page/View/
schedule projections, the public change payload, and committed or rejected
`block_mutations` evidence in one transaction. Project-bound calls retain the
invoking Project while trusted Library calls resolve their private compatibility
ledger coordinate inside Core. Electron IPC selects this authority through the
same Core-backed desktop bridges used by Library/Database Module, Page
detail/lifecycle/history, semantic Document command/history, and Block Transfer
operations. The binary Yjs/Canvas realtime plane, descriptor/prepare calls, and
renderer subscriptions select the same async Document bridge; subscription
authorization completes before Main acknowledges the renderer binding.
Settings and managed-asset filesystem concerns remain Host-owned; every durable
data route is available only after Core readiness.
Trusted Library Database access uses a distinct root-client capability accepted
only from local Electron-host, native-CLI, and test adapters. Core resolves the
concrete Library Database/Data Source/View itself and keeps the non-null legacy
change-ledger Project coordinate private; Library snapshots, receipts, and
events never expose or imply that compatibility owner. Electron consequently
publishes Library catalog/resource invalidations without inventing a Project.
`nodex-core-contracts` owns six
transport-neutral semantic Module contracts and their independent versions;
`nodex-core-protocol` owns transport 4, committed-event version selection,
artifact/Store compatibility, and generates the fixed private OpenAPI 3.1
surface plus `@nodex/core-protocol` TypeScript requirements;
`nodex-core` contains vertical Module implementations; and `nodex-core-server`
hosts authenticated HTTP/1.1 over a Profile-private Unix socket. The thin
`src/main/core-client/` Adapter validates runtime ownership, permissions,
canonical manifest/digest, artifact, and Store identity; performs the
exact-generation handshake; uses bounded codecs; and parses committed SSE
events incrementally. `contract_version`, `transport_version`, and
`event_version` are separate axes. Transport 4's generated 16 MiB ordinary
response cap is a fault-isolation guard, not a collection capacity. Every
user-growing Module collection uses the shared count-and-byte-bounded
`CollectionWindow` contract and an opaque HMAC-signed keyset cursor bound to
Library, Store epoch, query fingerprint, projection revision, and the last
stable coordinate. Owning Modules must apply indexed seek predicates and
`LIMIT first + 1` before projection; the shared assembler does not legitimize
OFFSET or full-load-then-slice. Global Module replay is reconstructed from
the durable SQLite change log in one read snapshot, so a process restart does
not reset the cursor. The replay window and live broadcast are bounded; a
retention gap, oversized catch-up window, or lagged subscriber receives an
explicit `core-resync-required` boundary and must refresh Module snapshots.
Document subscribers receive their existing document-specific resync boundary.
The connection registry grants one RAII lease per exact event-stream identity,
rejects duplicate live global or Document-session streams, and caps both
per-connection and process-wide subscriptions. The engine-neutral Document
Realtime Adapter gives each stream an exact `(connection, client session)`
cleanup guard, so dropping one Document stream removes only its subscription
and Awareness identities while a true connection teardown removes the remaining
set. It enforces the same independent subscription ceiling plus bounded
Awareness publications, client ownership sets, and initial snapshots, so
another trusted local Adapter cannot turn presence into unbounded memory.
The handshake also binds its declared
Electron Host, native CLI, or test Adapter kind to a generated connection ID;
every Module and Document request must present the resulting per-start binding
capability. Core registers that logical connection against the authenticated
Unix-socket peer UID/PID, client build, selected transport, and process-start
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
Every accepted drain records its typed reason (`idle_timeout`,
`explicit_shutdown`, `replacement`, or `operating_system_signal`) in a private,
fixed-size `${NODEX_HOME}/run/core/lifecycle.json` summary and records the final
stop outcome before exit. A later start preserves the prior summary and marks a
previously running generation as unclean-observed. The summary contains only
generation/lifecycle metadata and never capabilities, socket paths, SQL, or
user content; unsafe summary storage disables this diagnostic without weakening
Core authority.

The shared compatibility evaluator compares an explicit client requirement with
the incumbent offer across transport, committed event, each of the six Module
contracts, and the exact Store identity. Electron additionally uses
`prefer_current_artifact`, so a different executable SHA-256 causes a safe
handoff even when semantics match; native CLI uses `compatible`, so compatible
installation sources reuse one another. A replacement carries the candidate
manifest/digest/artifact/policy plus the exact incumbent generation. Core
rejects an unreadable Store or any transport/event/Module downgrade and drains
only when the same atomic idle predicate passes; otherwise it returns a bounded
busy/retry result. An accepted contender waits for exact-generation cleanup and
Profile-lock release before opening SQLite, so upgrade races cannot create a
second writer. Transport-4 lifecycle JSON is strictly tagged. The only legacy
bridge is forward replacement of a transport-1/2/3 incumbent by the transport-4
Rust selector; an old candidate cannot shut down a transport-4 Core. No rejected
or unverified handoff falls back to process killing or stale-file deletion.
For packaged macOS builds, artifact identity is computed after nested Developer
ID signing; the signing boundary rewrites the closed native manifest from those
final bytes, writes one package provenance record that binds the prepared
source/output generation, `app.asar`, signed Sparkle runtime identity, and final
native/Agent/Browser manifests, then reseals the outer app before notarization. The
prepared generation inventories
the complete Electron, Rust, resource, packaging-script, and configuration
input closure; a Git commit is lineage metadata only, while the content digest
remains authoritative for dirty or archive builds. Local source deployment
packages an unpacked, update-disabled App into a new unique `.generated`
directory and verifies the same provenance identity before and after staging,
so a persistent `dist/` directory can never silently supply an older
same-version app or a production feed capability. Explicit external
artifacts are not compared to the current checkout, but their intrinsic
provenance and runtime closure remain mandatory. A packaged Core also
derives the frozen legacy-migrator closure from its own enclosing app bundle:
the Electron executable, script, and digest manifest must be regular files in
the canonical `Contents` layout. Environment-provided migrator coordinates are
an all-or-nothing development/test override, not a launcher-specific packaged
dependency.

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
post-commit Document cache/publication recovery, published legacy imports and
exact v84 import, online backup,
restore journaling/runtime reset, and abrupt WAL exit. It also starts from a
fresh restricted `.generated` Profile and reports the reopened v92 Store's
durable head, integrity result, and foreign-key result. Private Core
health/lifecycle/Store Administration paths remain reachable only through the
authenticated Profile-local UDS client.

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
and non-archived startup Sessions, or resolves an exact Project, domain-only
Session descriptor, complete Codex Thread descriptor, persisted Thread execution
context, root/child Thread collection, managed-worktree set, or durable sidebar
snapshot. Session panel/tab arrangement never crosses this Core boundary.
Profile/Library Adapter identity, Project lifecycle, primary Database bindings,
JSON bounds, store epoch, and event head are validated by the Module; incomplete
bindings and cross-Library rows fail closed.
Codex app-server Thread timestamps are source observations, not a second durable
clock. On first materialization, the Host derives creation from the Thread's
UUIDv7 timestamp when available and normalizes it to the protocol's second
precision. Existing creation is immutable, while every later observation can
advance `updatedAt` but can never move it behind either the durable creation or
the previous update. Store v89 applied the same canonicalization to persisted
UUIDv7 Threads and repairs any remaining inverted custom-id pair before current
Store validation.
Automation now
owns its accepted definition, lease, run, reminder, and Scheduled Page
occurrence surface. Store Administration owns v92 readiness, backup listing,
online SQLite backup creation, and whole-store restore through the same
generated `read`/`apply` boundary. A backup uses a deterministic operation-owned
directory, publishes a v2-compatible manifest last, validates the immutable
snapshot, fsyncs database, assets, manifest, and directories, then commits its
receipt/event. A retry after filesystem publication but before the SQLite
receipt adopts only an exact operation/request-fingerprint match. Restore
semantically validates the complete v92 Document/Canvas/projection/managed-asset
closure, optionally creates a safety backup inside one maintenance generation,
installs through the Core-owned journal, rotates `storeEpoch`, resets Document
cache and realtime state, republishes the runtime descriptor, and clears the
old live subscriptions before committing its receipt/event. Epoch rotation also
rebinds the restored change-log and Module-receipt epoch coordinates in the same
maintenance transaction, so the new generation replays one internally
consistent Store incarnation; subsequent replay is read from that installed
Store's durable change log. Backup deletion
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
counts, joins the serialized Rust writer, and drops the complete reader pool before its
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
deterministic primary Canvas plus empty scene authority. Database, Page, and
Owned Document contribute internal genesis seams inside the transaction;
Workspace does not compose public Module calls or publish collaborator events.
A normal user creation publishes one Workspace receipt/event with exact replay.
Workspace construction is read-only and leaves a fresh Profile's Project
catalog empty. Its bootstrap read derives `empty | ready` from the complete
catalog, including archived Projects. The first source-backed Project enters
through a distinct `CreateInitialProject` intent that also requires an explicit
starter Page payload. It checks the catalog is still empty and creates the
Project aggregate plus the Page, its ready Yjs Document, primary Data Source
membership, and affected View projections inside the same immediate writer
transaction. Invalid Page genesis rolls the complete aggregate back. All other
Workspace mutations, including normal `CreateProject` and projectless Session
creation, are rejected while the catalog is empty. Exact receipt lookup
precedes that precondition, so a lost response replays the same aggregate,
while competing windows or clients cannot create a second initial Project or
starter Page.

Electron Main owns the non-transactional host half of first-Project setup:
automatic collision-safe `<Documents>/Nodex/My Project*` allocation, source-aware
starter content generation, and a bounded fsynced exact-payload recovery journal
at `${NODEX_HOME}/recovery/initial-project-v2.json`. The journal records the
stable attempt/operation identities and the complete Core request before the
filesystem/Core boundary; a matching marker proves ownership of a directory
created by that attempt. Recovery replays exactly that request, never deletes a
user directory, and persists the initial Window Session presentation before
removing marker/journal evidence. The presentation selects the Project Scene,
uses the Project's current default Database View as its primary surface, and
opens the ordinary Welcome to Nodex Page in the right panel. The journal never enters Core schema,
backups, or product queries. Renderer waits for normal application
initialization, then mounts the same Workbench used by every other Profile;
there is no setup-only renderer state machine. Historical rootless Projects
remain ready and use ordinary source replacement.

The same Workspace writer owns Project metadata/source replacement, lifecycle,
sidebar order, and pinned order. Each operation validates Library ownership and
bounded canonical input, writes one receipt/event with exact replay, and keeps
the imported compatibility binding row synchronized through the v84 schema
triggers.
Metadata replacement fences the Project binding revision; lifecycle transitions
advance it, remove archived Projects from sidebar/pinned order, and append a
restored Project without renumbering surviving gaps. Multi-Project reorder events
use a deterministic Project anchor for the non-null change ledger coordinate
while carrying the complete affected order in the Workspace event.

Workspace also owns durable Thread project identity. cwd is execution metadata:
the Desktop Host may use its longest source-root match only while materializing
a server-only Thread that does not yet exist in Core. Every later reconciliation
preserves the existing Project ID, including explicit `null`. Ordinary Thread
upsert/update rejects an ownership mismatch; `MoveThread` is the sole re-home
command.

The Desktop Host's `project-lifecycle-service.ts` is the orchestration boundary
for recoverable Project removal. It derives complete Session/Thread ownership,
including Project-owned Threads without a Session link, and checks Codex
requests and turns, Terminals, and background processes before the Core
lifecycle commit. One main-process per-Project admission coordinator serializes
that final preflight/commit with Terminal and Codex turn starts across IPC, so
no new runtime can enter between inspection and archive. Post-commit
Browser and exited-Terminal cleanup is best-effort and idempotent. Restore
requires no runtime preflight because it only reactivates retained identity and
authority. Core remains the lifecycle writer and rejects archived-Project
Thread, Session, and execution mutations at every boundary.

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
selection, Thread lifecycle, and deletion. A Thread unread mutation commits its
attached Session mirror in the same transaction. Codex Host waits for that
receipt before changing its in-memory read marker or broadcasting
`threadReadStateChanged`. Archive clears pin/unread and archives the attached
Session shell; restore reactivates both identities without restoring ephemeral
pin/read state; delete first preserves an archived detached Session shell, then
removes the Thread and its dependent continuity/search rows. An
app-server status or name notification uses an existing-only metadata mutation,
so a late notification cannot recreate a deleted Thread; materialization uses a
separate create-capable intent. Native metadata includes the complete persisted
subagent nickname, role, and path identity. An
execution-context read combines the exact Thread, its Project binding, current
permission mode, sorted tool catalogs, and writable roots from one snapshot.
Cross-Project Thread movement is a Workspace aggregate: Core moves the owning
Session, Thread, tab ownership, browser-tab Project config, search projection,
and manual sidebar order in one receipt while applying the accepted workspace
metadata patch. Codex Host stages external app-server cwd and writable-root
effects around that commit, but it never repairs a temporary Thread/Session
Project mismatch in Electron.
Invalid protocol status, oversized metadata, cross-Library Projects, duplicate
Session ownership, and a Thread/Session Project mismatch fail closed. Electron
still hosts codex-app-server and supplies accepted runtime observations;
reading or persisting this context never starts a process. Thread
launches and dynamic creates persist their exact namespace/revision catalog
through the backend-selected Workspace port before execution continues. A fork
reads the source execution-context snapshot and replaces the target catalog
through the same authority, while every `nodex_app` call resolves its expected
toolset revision from that snapshot. The Rust branch therefore never opens
SQLite in Electron for catalog launch, inheritance, or stale-catalog checks.
Project Session Thread starts, pending dynamic creates, and persistent Session
forks also read, atomically materialize-and-attach, create, and reread their
Session/Thread aggregate through that same Workspace port. External Codex
process execution remains Host-owned, but a successful launch cannot publish
its in-memory result before native Session ownership commits.
Permission settings use a separate scope snapshot because a Project or a
projectless chat may not own a Thread yet. Project-backed selections are stored
by Project; projectless selections use one persisted Library-level default.
Execution-context reads choose the Project selection for Project Threads and
the projectless default for projectless Threads. Codex verifies a selected
preset against the live app-server config before treating built-in Full access
as Library authority, then persists the accepted selection through the same
Workspace port; custom config edits explicitly replace the selection with
`custom` in the active scope.

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
lifecycle; v84 imports the former profile JSON projection once and retains the
file only as rollback evidence. The Desktop Host reads those roots only from
the authority-selected execution-context snapshot and uses semantic merge or
replace intents for app-server launch repair and workspace moves. A newly
started Thread is persisted before any repair intent; failed external moves
restore the previous native root set through the same port. Background-process
observations remain records of Electron-owned app-server or terminal work:
Codex persists both app-server observations and manual terminal-action
registrations through the authority-selected Workspace port, awaiting the
manual record before launching its external terminal action. The Host then
uses one committed record snapshot for metric refresh and row projection;
under Rust it never opens SQLite for this continuity path. Workspace validates
and bounds each Thread identity, preserves restart time according to the
semantic intent, and prunes the global durable collection atomically with its
receipt/event.

Workspace owns the durable sidebar metadata projection around those Threads.
One snapshot returns eligible root Threads together with Project-lane and
projectless manual identity order. Project order set and clear are distinct
intents, projectless reorder replaces only the caller's visible slots, and a
global pinned reorder changes only already-pinned Thread positions. Codex Host
manual-order commands enter through the authority-selected Workspace port and
publish the post-commit Workspace snapshot, so Project, Chats, and pinned lanes
never acknowledge a speculative Electron-side order. Interactive pin/unpin and
same-Project lane changes use one native pin intent with optional start/end or
before-anchor placement; the same transaction updates the attached Session pin
mirror and invalidates both Thread and Session projections. A
cross-Project Thread move atomically updates Thread and Session ownership,
browser-tab ownership, metadata, and every affected Project
manual order. Project and projectless lanes are explicit contract variants, so
absence never doubles as an ownership coordinate. Transcript search remains
owned by Codex app-server. Electron exposes one bounded `thread/search` Adapter,
filters non-root/internal/ephemeral results, guards cursor progress, and enriches
each result from Workspace metadata when available; Rust Core stores no
transcript units, FTS tables, indexing state, or a
backfill queue. Renderer MiniSearch covers the small local metadata catalog and
merges query-fenced server hits, including server-only Threads. Project Thread
catalogs, command-palette metadata, and managed-worktree catalogs enter through
the authority-selected Workspace port. Managed worktree removal remains a Host
filesystem action, then deletes every owning Thread through native lifecycle
commands.
Codex Host keeps a bounded in-memory Workspace Thread projection only so its
synchronous protocol and renderer serializers can resolve already-observed
metadata without blocking. That projection is never durable authority: resume,
sidebar/catalog hydration, and lifecycle reads populate it from the selected
Workspace port, while name, summary, status, unread, archive/restore, Session
attachment, move, and delete paths await the Workspace mutation before emitting
their local projection events. Archived mutations reread the exact Thread
because the active-sidebar response intentionally omits it. Workspace partial
updates are presence-sensitive and never reset absent preview, provider, or
status values. Codex Project catalogs, active-run context, permission roots,
worktree registration, and dynamic Project targeting use the same asynchronous
Workspace Project reads and creates; Codex Host has no local persistence
fallback.
Generic persisted renderer atoms remain shell-owned until their owning semantic
Module adopts a typed field; Core does not provide a catch-all JSON persistence
surface.

Window Sessions own owner-scoped Workbench Scenes. A strict
`WorkbenchSceneSnapshot` has normalized right/bottom split trees as its only
panel placement and ordering source. An owner is an exact Project, Session, or
the window-local singleton Pages context. A Project owner uses the current
default Database View as its primary and places that root exactly once at the
start of its permanently open, full-width right surface stack. Root-aware pure
transitions prevent removing, moving, or splitting it away. A Session owner
uses Conversation as its primary and keeps that root outside the panel trees.
The Pages owner has no protected primary: every Library Page, Database, View,
or Canvas is an ordinary closable surface, and an empty Scene is valid. Pages
content descriptors carry explicit trusted-Library access context; Scene
ownership is presentation, not authorization. Every Scene persists shared
composer-overlay visibility. Project Scenes also
persist the Agent Dock's exact Session or unbound-draft binding and draft
identity; Session Scenes have no Agent Dock target state.
Pure renderer mutations create, update, activate, reorder, move, split, merge,
resize, maximize, and remove local Scene state without IPC or Core invalidation.
The legacy public Document owner commands for Canvas do not
exist; all non-primary Canvas lifecycle changes enter through the Library
module. A `canvas_stage` descriptor stores only authorizing Project,
public Canvas Block ID, and title snapshot; it deduplicates that target within
the owning Scene while the live Canvas summary refreshes its displayed title.
The Window Session catalog persists complete Workbench layout v7
snapshots with monotonic revisions and atomic replacement. Catalog lifecycle is
independent of BrowserWindow attachment: an `open` Window Session is eligible
for cold-start restoration, while a deliberately closed Window Session remains
as bounded history that can be reopened with the same identity and layout.

Session collection lifecycle is owned by the same Workspace boundary. Creation
uses an explicit retry-stable identity and inserts at the head of the target
Project or projectless order. Ordinary and pinned reorder intents preserve the
established partial-order behavior over non-archived Sessions; archive clears
pin/unread state and restore retains the sparse order. A Project move updates
the Session and linked Codex Thread without inspecting one window's tabs.
Deletion cascades only the Thread-link aggregate without deleting the
independently owned Codex Thread; Window Sessions reconcile the removed view
locally.

Codex fork side-panel transfer is a Host-owned, process-local snapshot
lifecycle. Capture receives the initiating Window Session scope and view,
validates it, clones Browser runtime state into the target Window Session with
reminted identities, and returns descriptors for local application. It never
reads or writes Core layout. Capture, rebase, pending promotion, and target
consumption are awaited so navigation cannot overtake the transfer; a failed
apply retains the snapshot for retry. Canonical-to-client Thread aliases remain
Host-owned and are not a second SQLite authority.

The desktop Browser Platform is a Main-owned runtime aggregate. Window Session
descriptors own only the durable tab shell and opaque `browserStorageId`; Main
owns guest attachment, navigation, Profile session, persisted Chromium history,
downloads, annotations, credentials, Browser Use, resource budgets, and
generation-fenced teardown. Its route identity is the exact
`(browserConversationId, browserViewScopeId, browserTabId)` tuple, with
`browserViewScopeId` equal to the owning Window Session. Renderer hosts register
their renderer, host, and mount generations before Electron may attach a guest.
`will-attach-webview` parses only the exact partition route that Electron
guarantees to expose, resolves the storage identity from the matching Main-owned
host registration, validates both against the registered tab, strips caller
preferences, and forces the fixed sandboxed preload plus the shared
`persist:codex-browser-app` partition in both attachment parameters and effective
web preferences. Custom renderer DOM attributes are presentation diagnostics,
not attachment authority. Main correlates Electron's `instanceId` from
`will-attach-webview` with the guest's `viewInstanceId` at
`did-attach-webview`, activates guest ownership synchronously, and starts
prepared history restoration before the guest's first load. Later preload and
renderer acknowledgements complete presentation, but cannot create, transfer,
or broaden ownership. Each renderer continuously publishes its resolved
`light | dark` state for the owning Window Session even when the workbench route
is not mounted; current hosts repeat that value alongside generation-bound
logical `visible` / `presented` state. Main serializes device metrics and
`prefers-color-scheme` CDP mutations per guest through one page-lifetime
baseline debugger session. Browser Use borrows that session and releasing
automation never tears down the emulation baseline; destroying the guest ends
both. A closing panel host backgrounds its body-level fixed webview
synchronously before paint but retains route ownership for the shell animation;
the hidden retention host is eligible only after the panel host unmounts.

Browser Use activity and Browser presentation are separate state dimensions.
Main owns the active controlled page, each runtime tab's exact Codex
Session/Thread identity, and any generation-bound presentation intent. The
owning Project Session determines durable agent-created surface placement; the
Scene where its turn was sent is only navigation origin. A renderer-local
coordinator materializes the exact Main-owned `browserTabId` plus
`browserStorageId` into that Session's right/bottom-panel tree. A visible intent
updates the target Scene before selecting the Session so the panel snaps with
the route rather than animating later. A background or hide intent updates an
inactive Session Scene without navigation. Manually opened Project Browser
surfaces stay Project-owned and are not implicit Browser Use inputs. Renderer
host bounds remain the only acknowledgement that a page is actually presented
and visible. Hiding a Browser presentation or Agent Dock never releases Browser
Use control. Release transfers the existing page into an ordinary durable
Session Browser shell, while close removes both runtime and shell. A
renderer-wide immutable Browser projection bootstraps from a scoped Main
snapshot and feeds hidden hosts, Browser Use presentation, and thread summary;
it is a cache of Main state, not a second runtime authority. Retained Browser
Use hosts reconcile every live tab in that Window Session projection,
independently of the selected Scene owner. Durable background and panel hosts
remain Scene-owned and supersede a retained host only when the full route tuple
matches; a `browserTabId` collision across conversations is not ownership.

Browser automation remains a separate low-level Adapter over that aggregate.
One verified Desktop Tool Runtime bundle supplies the matching signed Codex CLI,
Node, Node REPL, Browser and Computer Use plugins/clients, native PiP addon,
Computer Use service application, and peer-authorizer closure. The public
app-server config seam supplies the same exact trusted paths and hashes to
start, resume, and fork. A per-Codex-session authenticated native pipe owns IAB
session/turn routing, low-level tab/CDP/cursor/viewport/capture/download
operations, and turn finalization; the first-party plugin retains the public
Browser/Tab/Playwright/Locator/CUA API and its confirmation policy. Neither
renderer state nor response metadata is a second Browser runtime authority.
The bundle is a repository-controlled release input rather than an ambient
desktop-app dependency. A committed dual-architecture lock selects immutable
release archives by URL, byte size, archive SHA-256, inner manifest SHA-256,
desktop build, Codex compatibility version, plugin version, and component
versions. Development, CI, and packaging materialize that lock into the
generated source closure before atomic staging. Reading an installed desktop
application exists only in the explicit maintainer vendor workflow and is
never part of application startup or a normal build. The primary app-server
remains Nodex's pinned Open Interpreter runtime. Every Desktop Tool thread
launches the shared `node_repl` through a persistent vendor-signed Node process
and the signed Codex CLI (`node -> codex sandbox -> node_repl`). The Browser
peer authorizer can therefore validate the REPL plus its two nearest ancestors,
and the Computer Use sender sees Codex as the immediate parent, without
replacing Nodex's app-server protocol or provider/model extensions.

The Desktop Host owns one native remote-hosted PiP coordinator. It loads the
verified `sky.node`, starts the native host, registers each eligible
`BrowserWindow` with its native handle and placement anchors, and derives the
active thread only from the focused registered window. Browser tool results
contribute bounded data-URL screenshots from completed `node_repl` calls;
Computer Use contributes a live native layer directly from its service. The
coordinator keeps user-hidden threads, Browser-panel suppression, and the
global always-hide preference as separate state. Per-thread hiding, placement,
active content, cursor, and turn ownership remain ephemeral; maximum display
size and global always-hide are atomically persisted. Completed turns use native
thread completion, unsuccessful terminal turns invalidate the exact turn, and
thread close/archive removes all associated Browser presentations. No PiP
frame is stored in Core, Yjs, the transcript, or renderer state.

On Apple Silicon macOS 14.4+, Main atomically materializes the verified Computer
Use application at `$CODEX_HOME/computer-use/Codex Computer Use.app`, preserving
its original signature and App Group identity. Main also serializes atomic
writes of `$CODEX_HOME/computer-use/config.json` with the active locale, text
direction, product accent, and overlay copy. A private framed host-services
socket provides only `ensureService("computer-use")`; the service manager
serializes spawn/reuse, rejects stale or mismatched PIDs, and leaves the shared
canonical service alive during ordinary Host disposal. Browser and Computer Use
share one `node_repl` configuration and one materialized bundled marketplace.
The app-server-owned `$CODEX_HOME` is the Node REPL trusted-code root because
installed plugin skills execute from its versioned `plugins/cache` copy rather
than from the marketplace source path; Browser client execution remains
independently constrained by the verified client hash allowlist.
Intel builds deliberately omit the Computer Use plugin and helper while keeping
Browser native PiP available.

Computer Use Settings is a typed Main-owned OS adapter. It reads and revokes
App and Messages approvals from the helper App Group container, reads and writes
the helper click-sound mode through its defaults domain, gates Locked Use with
app-server config requirements, and invokes only the verified nested installer
for status/install/uninstall. Renderer IPC exposes snapshots and bounded
mutations; it never receives filesystem authority for the Group Container or an
arbitrary command surface.
Each live renderer Browser host is appended to `document.body` exactly once and
owns both the Electron webview and a sibling cursor overlay for its whole guest
lifetime. `retained`, `background`, and `panel` are layout/presentation states,
not DOM ownership states; changing them must not detach the custom element
because detachment destroys Electron's guest WebContents. Browser Use cursor
state includes whether movement may animate. The native-overlay controller
owns clamping, motion, idle presentation, and arrival acknowledgement. Its
coordinate bounds come from the currently presented webview surface, with the
Browser Use viewport retained only as a pre-presentation fallback. Main waits
for arrival only while the exact page is renderer-confirmed presented and
visible.
Main resolves one Browser Use host capability from the verified runtime and
supported platform. That single result drives bundled-plugin eligibility,
thread backend configuration, and native-pipe activation; an unavailable host
removes the managed Browser plugin instead of exposing a skill without a
provider. Peer verification is a separate transport policy: packaged macOS
requires native code-signing verification, while unpackaged development uses
the user-owned private socket unless native development verification is
explicitly enabled.
Browser presentation capture is an awaited command, not a renderer selection
side effect. An idle turn supplies its exact owning Session namespace and Window
Session view scope before dispatch; steering or queueing an active turn
preserves its existing route. A Project Agent Dock draft materializes its real
Project Session before capture. Before a new Codex Thread exists, that route
uses the Project Session identity provisionally. Once the canonical Codex
session is linked, Main promotes the provisional route before dispatching the
first turn, including pending-worktree starts. Promotion failure retains the
Session/Thread link but prevents first-turn dispatch so the user can retry
without ambiguous Browser ownership. `projectId: null` is a valid projectless
route and is not an availability failure.
The Codex app-server initialize handshake advertises OpenAI form elicitation.
Browser origin approval therefore travels through the normal
`mcpServer/elicitation/request` request/response path; loading the plugin and
opening its native pipe are not sufficient on their own. Full-page capture is
also a coordinated host operation: Main applies the requested CDP clip size
through the renderer's central webview manager to whichever Browser host
currently owns the guest, polls `Page.getLayoutMetrics` until Chromium reports
that surface (bounded to one second), runs `Page.captureScreenshot`, and always
restores the ordinary viewport afterward. The native-pipe transport does not
race operations with a second request deadline; Main owns the fixed 20-second
CDP boundary and ignores plugin timing hints.

The native Automation Module now owns Scheduled Automation definitions and due
work leases in SQLite. v84 adds an optimistic definition revision, imports the
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

The complete Automation Host boundary is active through Core, including
durable execution and reminder leases,
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
- `content-access-context.ts`, `library-module.ts`, and `library-module-transport.ts`: strict Project-versus-Library access selectors plus the transport-neutral Library navigation/structure Interface. Public Library requests never name a Profile, Library, or compatibility Project; reads expose bounded ownership-tree, standalone-root, Page, View, path, catalog, content, search, and history projections. The standalone-root projection filters canonical primary resources already represented by non-archived Projects before counting or pagination; grants do not affect navigation eligibility. Exact-retry writes create, move, archive, restore, and recursively grant Page/Database resources using stable identities and revision evidence. Page history is one Project-authorized, source-cursor timeline over immutable Document revisions and attributable mutation/relocation evidence; it never exposes tables or fabricates whole-Page inverses.
- `codex-hooks.ts`: generated-protocol aliases plus the host-scoped Hooks list, state-patch, and change-event contracts. Hook identity and source metadata remain app-server-owned; local settings code does not reconstruct plugin identity from paths.
- `block-documents/*`: transport-neutral Block/Owned Document Interfaces; one DOM-neutral custom BlockNote config set; canonical Page/body-only Y.Doc schemas; engine-neutral descriptors; normalized Canvas scene contracts, reconciliation, and sync/HTTP codecs; headless NFM or scene materialization into stable identities, references, search text, and assets; structural validation; portable Y.Xml subtree operations; and stable-ID Document mutation batches. Pending file Blocks with an empty source remain valid collaborative content while asset projections contain only resolved non-empty sources. Public exclusive-parent Move/Copy contracts live in `block-transfer*`; renderer specs supply React/DOM implementations while authority-side codecs remain non-rendering.
- `additional-document-commands.ts` and `additional-document-command-transport.ts`: versioned logical ownership commands for Synced/Template sources plus retained internal Canvas-owner primitives, exact-retry receipts, global reference-guarded tombstoning, Project scoping, and host-bound audit identity shared by Electron, renderer, and CLI callers. Product Canvas placement and lifecycle use the Library mutation contract.
- Project-to-Project product ownership transfer is absent by design. Pages remain in one Library; ordinary Project access changes through binding or resource grants. Full-access Agent operations may atomically change the private compatibility `project_id` of a complete Page ownership closure while preserving Library identity and stable Page/Block/Document IDs.
- `database-module-v2.ts`, Page drag compilation, `database-events.ts`, and `fractional-rank.ts`: strict transport-neutral Database `read`/`apply` Interface, explicit Database/Data Source/View targets, Source-scoped Property/option coordinates, one-snapshot multi-Page drag compilation, resource-addressed post-commit invalidations, and the shared fixed-width fractional-order planner. Durable View filters are bounded recursive expressions; atomic value/position intent, select options, and logical Page anchors use stable application identities while callers never submit physical rank strings.
- `block-transfer.ts`, `block-transfer-transport.ts`, and `block-ownership-copy-plan.ts`: the versioned same-Project exclusive-parent Intent/receipt, trusted public transport binding, and recursive ownership-only Copy planner. Public Intent carries stable identities and logical parents only; exact SQL/Yjs freshness is writer-compiled.
- `codex-thread-title.ts`: shared thread-title sanitization and bounded cache helpers used by both main and renderer.
- `schemas/*`: runtime boundary schemas for persisted renderer state, workbench layout snapshots, Codex settings, HTTP bodies, Codex session replay JSONL lines, and transcript special-item/raw JSON payload families.
- `page-limits.ts`: centralized Page payload and field size constraints.
- `assets.ts` and `managed-assets.ts`: stable `nodex://assets/` identity helpers plus bounded upload/preview contracts and pure mapping to the display-only `nodex-asset://managed/` raster URL.
- `nfm/*`: shared internal parser/serializer core for the public Nested Markdown format, used by both main-process storage logic and renderer editor adapters; the path and canonical internal types retain their established NFM names.
- `nodex-agent-tools/*`: revisioned Agent contracts and pure Adapters. Current contracts expose Page/Data Source intents, inline-Markdown titles, public `markdown` fields, sparse result projections, recovery vocabulary, and deterministic catalog/result budgets while retaining older revisions only for historical transcript parsing. The shared schema never accepts caller-authored Project, Library, grant, or storage-revision authority.

### Main Process and Data Layer (`src/main`)
- `bootstrap.ts`: early Electron lifecycle entrypoint. It resolves the Nodex home, publishes the canonical absolute path as `NODEX_HOME`, scopes `userData`/`sessionData`, owns the profile-scoped single-instance lock and deep-link queue, runs the packaged macOS Applications prompt, and dynamically imports the application runtime.
- `main-runtime.ts`: application runtime startup (Core readiness gating, Core-backed adapter construction, managed-asset protocol lifecycle, multi-window registry, app-update service, event fanout, renderer permission policy, and shutdown handlers). The app session allows clipboard writes and managed raster delivery only to owned app windows; Browser sidebar partitions and embedded/subframe content do not inherit those capabilities.
- `instance-scope.ts`: applies Electron `userData` + `sessionData` paths under the resolved Nodex home so each configured Profile owns its own process-lock scope.
- `managed-asset-protocol.ts`: default-session-only, read-only raster delivery for canonical managed assets. It accepts only safe flat names and `GET`/`HEAD`, rejects SVG/text/directories/symlinks/traversal, and is never registered on the Browser sidebar partition.
- `ipc-handlers.ts`: exposes Core operations and Host-owned capabilities through typed IPC, including bounded managed-asset writes/reads/previews and dictation. Privileged filesystem/asset/dictation channels validate that the sender is the top-level frame of an owned app window. Project remove/restore delegates to `project-lifecycle-service.ts`, which owns runtime preflight and post-commit Browser cleanup. Backup IPC is registered through `store-administration-ipc-handlers.ts` against the same authority-selected port used by the host scheduler; a native restore schedules a controlled Electron relaunch after its receipt returns.
- `core-client/*` and `data-authority.ts`: the only production data-authority Adapter. They launch or reuse the detached Core, authenticate the UDS connection, bind Host/Project/Library identity, map the six generated Module contracts, and fail closed when Core is unavailable. Electron owns no SQLite connection, Y.Doc cache, schema repair, or semantic writer.
- `library-module-ipc.ts` and `document-sync-transport.ts`: trusted Electron Adapters over the Core Library and Document ports. A successful subscription response proves the first exact Core stream is open. Retryable physical interruptions reconnect under the same logical subscription and cursor while commands wait; terminal failure or connection teardown closes only the exact native subscription and releases its binding. Durable Yjs/Canvas events preserve their Core head/epoch, and Awareness stays ephemeral.
- `core-client/block-transfer-adapter.ts` and `desktop-document-sync-bridge.ts`: the typed BlockTransfer boundary. They submit one semantic Core mutation, fan out receipt-carried Document commit refs to matching providers, and leave ownership, membership, projection, and retry authority in Core; no Host flush/freeze coordinator exists.
- `block-transfer-ipc.ts`: trusted Adapter for logical same-Library parent Move/Copy. It replaces caller audit/scope identity, evaluates Project access to source and target, and returns binary Document commits through structured-clone IPC.
- `additional-document-command-ipc.ts`: trusted renderer boundary for Additional Document commands. It rejects unavailable capabilities, validates scope, replaces caller attribution with trusted host identity, and preserves typed outcomes.
- `ipc-safe-send.ts`: centralized one-way renderer notification helper for main-process IPC fanout. It checks `BrowserWindow`/`webContents` lifetime before sending, treats disposed-frame races as debug-only lifecycle skips, and rate-limits unexpected send warnings.
- `codex/renderer-client-router.ts`, `codex/codex-thread-stream-subscription-state.ts`, `codex/owner-follower-ipc-bridge.ts`, and `codex/codex-renderer-view-registry.ts`: main-process renderer-client boundaries for Codex thread coordination. The router assigns stable client ids per `webContents`, sends targeted main-to-renderer requests and stream relays, validates responses against the target `webContents`, rejects pending requests on timeout/destroy, reports connected/disposed clients and delivery failures to the subscription coordinator, and provides registry-backed Codex host-message fanout. The subscription coordinator keeps follow intent, connected clients, snapshot-pending followers, membership epochs, the five-second IPC reconnect grace, and owner-detached recovery lease separate; ordinary state/control delivery is target-before-delivery, source-excluding, empty-target no-op, and fail-closed. `threadStreamStateChanged` is only a follower relay: the renderer owner remains canonical, while Main retains the accepted document/revision as a recovery/repair cache and never becomes a visible transcript writer. The view registry independently tracks which renderers are actively presenting each task and selects the most recently activated client for local-only request UI; presentation drives follow intent through its explicit active lifecycle but never adopts canonical conversation-state ownership.
- `clipboard-paste-inspector.ts`: best-effort Electron clipboard inspection for pasted absolute file/folder paths across supported native formats.
- `git-action-service.ts`: main-process status, commit/message-generation/push, and cancellation boundary for native Git workflows. An `operationId` is registered synchronously before directory/status preflight, and one AbortSignal spans preflight, optional message generation, Git child processes, and final cleanup; cancellation never depends on a renderer delay or mutation having already started.
- `git-worker-host.ts`, `git-worker/`, and `renderer/features/review/data/git-query.ts`: generation-bound Git Review read plane. One process-lifetime worker canonicalizes each local repository as `(hostId, real commonDir, real root)` and owns its serialized command lane, query sharing, generation, reference-counted watcher lease, and bounded untracked cache. Main authorizes and routes the typed worker bus but owns no repository snapshot state; preload is a narrow message bridge; each renderer window projects active worker subscriptions into its TanStack Query cache. Repository metadata, local/remote base branch, branch commits, status, and live metadata summaries remain separate from partial diff bodies. Direct reads and live refreshes share query identities, tracked/complete publications expose bounded untracked completion, and repository events advance generation before method-specific invalidation. Stale, cancellation, timeout, and output-limit outcomes are typed operation data; protocol faults and worker exits retire the worker epoch. Repository initialization, patch application, branch mutation, and pure commit execution use the same repository lane and invalidate it before resolving, while Main retains message/GitHub/push orchestration through worker read adapters.
- `crates/nodex-core/src/{library,database,document,workspace,automation,administration}`: the six deep native Modules. One serialized Rust writer owns semantic transactions, receipts, projections, migrations, schedules, backups, restore, and Yrs/Canvas persistence; bounded readers serve coherent snapshots. Module code is transport-neutral and emits events only after commit.
- `src/main/local-store/*`: Host-only profile configuration, managed-asset filesystem access, persisted renderer settings, notification fanout, pure schedule formatting, historical filename migration, and maintenance gating. No retained file opens `nodex.db`, implements a schema, reconstructs a Document, or provides a semantic fallback.
- `shared/page-input-validation.ts`: transport-neutral Page write validation used by Core-client compatibility projections without importing a store implementation.
- `logging/logger.ts`: structured backend logger with child scopes, sensitive-field redaction, bounded payload serialization, independently filtered console/file/observer sinks, and a profile-scoped bounded JSONL writer under `${NODEX_HOME}/logs`. The file sink uses size-based segments, a global byte budget, a priority-aware bounded queue, stream backpressure, retention pruning, and shutdown flush; dev/unpackaged runs enable console `warn+`, file `info+`, and observer `warn+` by default, while packaged diagnostics remain opt-in.
- `window-session-state.ts`: profile-scoped persisted Electron window-session catalog with per-window layout snapshots, restore-policy selection support, focus recency, and saved window bounds.
- `terminal-manager.ts`: integrated terminal owner for session terminal ids, including typed `terminal-*` IPC, xterm attach snapshots, owner checks, 16k buffer retention, node-pty local backend lifecycle, restart actions, and `read_thread_terminal` snapshot lookup.
- `codex/codex-app-server-client.ts`: global JSON-RPC client for the pinned Open Interpreter `app-server` stdio lifecycle, handshake/home verification, request correlation, reconnect/backoff, and wire-level typing against the committed `@nodex/codex-app-server-protocol` workspace package. The runtime contract separately seals its exact upstream commit, reviewed patch set, immutable Nodex artifact release, per-architecture bytes, staged closure, and generated schema fingerprint; production never follows a branch or selects an arbitrary binary from `PATH`.
- `codex/agent-provider-catalog.ts`, `provider-credential-store.ts`, and `electron-provider-credential-store.ts`: provider-neutral discovery and credential boundary. Main filters the runtime catalog to Nodex-conformant OpenAI, Anthropic, Kimi For Coding, Moonshot, and OpenRouter providers; computes readiness independently of Open Interpreter's `configured` claim; encrypts API keys through Electron `safeStorage` into a private atomic file; and exposes only set/delete/status operations to renderer code. Plaintext enters the child process only through its spawn environment.
- `codex/codex-service.ts`, `nodex-agent-authority-port.ts`, and the Core-backed authority Adapters: domain facade for account/auth, provider catalog, immutable per-task execution profiles, thread/turn actions, sidebar synchronization, external Thread materialization, background-terminal controls, side-chat forks, approvals, canonical conversation state, and shell/control events. `providerId + modelId + harnessId + reasoningEffort + serviceTier` is persisted through Core and carried explicitly through start, resume, fork, side-chat, dynamic-create, heartbeat, and cron paths; Nodex never uses Open Interpreter's process-global provider/model/harness setters. New eligible Project-bound root tasks start with the static ten-tool `nodex_app@5` catalog. Main verifies the selected permission preset, while Core freezes and revalidates exact Turn Project/Library provenance and durable call receipts. Electron owns app-server execution, notification ordering, consent presentation, and the isolated writable Agent home at `${NODEX_HOME}/agent`, but no persistence transaction.
- `shared/codex-thread-notification.ts` and `codex/codex-thread-notification-coordinator.ts`: deep desktop-notification domain and Main policy Module. `CodexService` emits exact turn/request/resolved occurrences only after raw lifecycle and pending-request commitment; renderer snapshots never produce notifications. The coordinator is the single settings, child-provenance, focus, surface-aware presentation, host-family, and target-renderer authority.
- `desktop-notification-manager.ts` and `system-notification-permission-service.ts`: native desktop-notification Adapters. The first owns sanitized Electron Notification instances, Codex-compatible public IDs plus strict occurrence indexes, exact dismissal, timeout/reply/action/sound shaping, and failure-isolated idempotent callback disposal. The second capability-detects OS permission status, dynamically isolates the macOS UserNotifications bridge, and opens platform settings without coupling OS permission to app-level preferences.
- Native notification callbacks carry a host-qualified conversation locator into `useWorkbenchCommandIngress`. Workbench navigates the parent task and activates or materializes any existing Side chat before executing reply or a live-method-revalidated approval. Native callbacks do not bypass session/panel commands or enter the renderer conversation store as lifecycle producers.
- `agent-tools/dynamic-service-v3.ts`, `agent-tools/dynamic-service-v3-port.ts`, `core-client/desktop-nodex-agent-*`, and `codex/nodex-agent-dynamic-tool-runtime.ts`: the transport-neutral Agent facade over Core-native search/fetch/query/create/update/move/duplicate semantics. Pure TypeScript helpers validate public payloads and compile exact NFM patches; Core performs authorization, preparation, transaction execution, idempotent replay, projections, and event publication.
- `agent-tools/authorization-broker.ts` and `nodex-agent-resource-authority-port.ts`: Host presentation and transient-consent boundary for the ten `nodex_app@5` tools. Core validates immutable Turn provenance, resolves exact Page/Block/Database/Data Source/View ownership, classifies direct/consent/denied access, persists Project grants, mints single-use prepared tokens, and revalidates the footprint in the committing Module transaction. Renderer cards present decisions but never become authority; committed Turn-bound receipts replay without another prompt or mutation.
- `codex/dynamic-tool-catalog-metrics.ts` and `shared/nodex-agent-tools/budgets.ts`: pure production catalog serializer and deterministic context-budget gate. It measures the exact namespace JSON published to app-server, separates eager and complete catalogs, and caps each selected tool without loading stores, renderer assets, or the Agent execution singleton.
- `thread-goal-attachments.ts`: main-owned goal attachment boundary. A registry-backed pasted-source manager owns individual temporary files and retries interrupted removals, while a separate process-lifetime manager owns recursively removable materialized goal directories. Both resolve under the Nodex-owned Open Interpreter state home (`$INTERPRETER_HOME/attachments`, with `$INTERPRETER_HOME=${NODEX_HOME}/agent`); renderer IPC reaches them through the singleton runtime service so creation and cleanup share one ownership instance.
- `codex/thread-title-generator.ts`: packaged-safe shared helper for Codex-compatible `generate-thread-title` prompt shaping, fixed `gpt-5.4-mini`/low-reasoning structured schema, and generated title parsing; it never reads repo-relative prompt assets.
- `codex/conversation-image-asset-service.ts`, `codex/chatgpt-base-url.ts`, and `codex/chatgpt-desktop-request.ts`: the authenticated generated-image asset boundary. Renderer requests carry only a supported asset pointer and the local Codex host; main resolves ChatGPT configuration/authentication, obtains the signed download URL, fetches bytes with Electron networking, and returns typed base64/mime data. Tokens and authenticated request headers never cross into renderer state, and unsupported remote hosts fail closed until the remote-host runtime exists.
- `codex/composer-external-suggestion-service.ts` and `composer-appshot-service.ts`: privileged composer-provider boundaries. The external-suggestion service gates and bounds authenticated Sites/ChatGPT discovery before projecting renderer-safe mention rows. Appshot owns macOS foreground-window tracking, opaque target handles, exact Electron source selection, screen capture, and app-icon hydration; the packaged `resources/macos/nodex-appshot-helper.swift` supplies bounded native window identity and Accessibility text. Renderer never receives auth material, raw provider payloads, native process/window ids, or a desktop-enumeration primitive.
- `codex/codex-transcript-projection.ts`: transcript projection helpers that unify bootstrap, live updates, and terminal turn reconciliation into ordered `CodexTranscriptEntry[]`; submitted prompts are projected from canonical turn params, and the pure view-to-entry adapter lives at `src/shared/codex-transcript-entry-projection.ts`.
- `shared/codex-thread-detail-reducer.ts`: shared legacy view-snapshot merge helpers for transcript deltas and optimistic-entry reconciliation used by both main and renderer during the canonical reducer migration.
- `core-client/desktop-project-workspace-bridge.ts`: persistence adapter for canonical Codex Thread metadata, global sidebar pin/order state, root-thread Session ownership, and catalog-only parent-linked subagent rows. Core rejects child-to-Session links and atomically retires an early root Session when later metadata classifies its Thread as a child. All reads and mutations are typed Workspace Module requests.
- `codex/agent-import-coordinator.ts`: owns explicit, user-triggered imports from Claude Code, Codex, and Open Interpreter. Renderer previews carry opaque, expiring scan/item ids rather than protocol migration payloads. Claude items use the app-server external-agent importer; Codex-compatible rollout history enters the same ThreadStore through `thread/fork(path)` with new Thread ids. Native setup copies are no-overwrite, reject symlinks, and config translation excludes provider/auth/security state. A private content-hash ledger makes session import idempotent.
- `agent-skill-setup.ts`: thin Desktop orchestration Adapter for the separate official Nodex Skill export. It runs only the packaged absolute CLI with fixed shell-free `skills status`/`skills install` argv, preserves unknown structured target identities, owns the native Agent-choice/success/error dialogs, and shows exact conflict paths. It never creates links, reads Agent homes, or owns installation state; all filesystem trust and mutation remains in the Rust CLI.
- `codex/codex-session-store.ts`: reads session artifacts only from the Nodex-owned `$INTERPRETER_HOME` at `${NODEX_HOME}/agent`. It supports JSONL rollout materialization and rebuilds visible transcript state from replay-safe events instead of raw bootstrap messages; external agent homes are available only through the explicit import boundary.
- `codex/git-worktree-service.ts`: managed Git worktree creation for session thread starts (`autoBranch` or `detachedHead`) with base-ref resolution, thread-title-driven auto-branch naming (`<prefix><thread-slug>`), and path allocation under `${nodexHome}/worktrees`.
- `codex/worktree-environment-service.ts`: lists and validates `.codex/environments/*.toml`, parses environment metadata (`name`, `[setup].script`), and enforces in-repo path boundaries.

### Preload Boundary (`src/preload`)
- `index.ts`: minimal `window.api` bridge that exposes `invoke`, event subscription, a narrow synchronous managed-asset-path resolver used during native copy events, the typed focused-window Workbench command ingress used by application-menu accelerators, and the `window.electronBridge.showContextMenu` native-menu bridge used by desktop-only row menus.

### CLI (`bin`)

- `crates/nodex-cli`: native `nodex` command, selector, presentation, restricted `meta.yaml`, exact Page-patch, and local shell boundary. It discovers or cold-starts the packaged sibling `nodex-core`, validates the private current-user runtime descriptor/capability, binds a `native_cli` connection, and invokes only versioned Module requests over UDS. It never links the Core implementation, rusqlite, or Yrs. The app bundle remains the only distributable CLI/Core/runtime closure: Homebrew and the app-menu installer create symlinks to `Contents/Resources/bin/nodex`, so app replacement updates the CLI without copying or version-skewing native resources. Home selection follows the desktop bootstrap chain (`NODEX_HOME`, nearest project `.nodex/config.toml`, user config, then `~/.nodex`) with bounded fail-closed TOML parsing. Project selection prefers an explicit unique ID/name, then the longest managed-worktree match, then the longest source match; equal candidates fail instead of guessing. `context`, `tree`, and `rg` share authorized Page and exact-ID/unique-name Database scopes, while full Page title paths remain authorization-filtered aliases. `view query` resolves a full `@View` identity or an exact unique View name across the selected Project's authorized Databases, then returns the Core-composed saved View context with stable group keys, signed cursors, and move ETags. Exact `body.nested.md`/`meta.yaml` reads, restricted line selection, bounded Page history, Project Database/Page trees, backup, doctor, semantic Page creation/move/duplication/deletion, guarded title/body replacement, simultaneous exact body patches, anchored body insertion, stable Block insertion/update/move/deletion, immutable-snapshot `rg`, and explicit one-Page drafts now execute natively. Creation, move, and duplication resolve Library, Page, or explicit/default-View Data Source placement inside the Library writer transaction; `--view`, stable `--group`, and explicit `--unassigned` are valid only for Data Source destinations. Data Source creation stages complete Page/Document genesis in the destination storage Project and enters membership, built-in values, and the resolved View position before the single Library receipt/event becomes observable. Page move requires the narrow ETag from `view query` or `read --prepare page.move [--view @id]`; Core rejects stale View/group/position authority without a partial transfer and returns final placement plus fresh Page/move ETags. Page deletion consumes the signed Page-shell ETag and delegates the recursive lifecycle tombstone aggregate. Core alone allocates created/copy Page/Document/Block identities, composes metadata, signs explicitly requested validators, revalidates recursive Project write authority, commits Yrs plus projections/history/events, and persists connection-independent semantic receipts with post-commit title/body, Page-shell, move, and changed-Block ETags. Search snapshot manifests bind authorized scope, full Page identities, ownership and revision evidence, and independently content-addressed metadata/body bytes from one SQLite read transaction; the CLI validates the read-only lease, invokes only the bundled real ripgrep with a restricted flag set, remaps opaque physical paths, and releases the lease on every exit path. Draft creation obtains metadata, body, both narrow ETags, and one Document head from one authorized Library read transaction; Core never reads a draft directory. The CLI owns the bounded private layout, semantic metadata comparison, exact-patch compilation, deterministic apply receipt marker, and no-follow discard. A changed title and body enter one Owned Document semantic mutation, so conflicts write neither unit and lost responses replay the original receipt. `setup` and `skills status|install|remove|doctor` execute before Profile selection or Core launch. They verify the exact adjacent signed-App Skill tree, accept only fixed Codex/Claude global targets, and use no-clobber absolute symlink creation plus managed-current-only unlink; no project scope, copy mode, ownership ledger, lock, journal, recursive delete, or Agent process execution exists. `service status|enable|disable` also executes before any Core connection and talks only to a signed nested macOS 13+ `SMAppService` LaunchAgent controller. Registration persists one private selected-Profile pointer and replaces the controller process with the same packaged `nodex-core`; no root helper, KeepAlive loop, or alternate store owner exists, and every unavailable, denied, or disabled state preserves normal on-demand launch.
- External Agent Skills are instruction Adapters over this native CLI, never alternate data or authorization Adapters. Agent Application Interface revision 1 is independent from App and Core-contract versions. `nodex capabilities --json` runs before CWD, Profile selection, or Core launch and projects only the implemented command capabilities from the same semantic registry that owns machine-readable leaf-command help; a development binary without an adjacent packaged Skill bundle reports that bundle as unavailable. `agent-skills/nodex` is the single official authoring source. The allowlist-only `scripts/official-agent-skills.ts` exporter validates its six files, derives the Nested Markdown reference from the production guide, round-trips examples through the production codec, and emits the only package/public-mirror input under `.generated/official-agent-skills` with a stable tree hash and no timestamps. Internal `.agents/skills` never enter that artifact. The retired `skills/nodex-kanban` surface remains removed because it described nonexistent commands and raw SQL. No Skill may receive a database path, Core bearer capability, physical rank, or authority to bypass the typed CLI/Core boundary.
- The official Skill has one release identity across source, both macOS architectures, and `NodexApp/skills`. Prepared Electron manifest schema 3 binds the generated release-manifest and Skill-tree SHA-256; `electron-builder` copies only that exact directory into `Contents/Resources/agent-skills`; signed package provenance repeats both digests. The packaged verifier rejects unknown or linked entries and requires the adjacent native CLI's capability probe to advertise the same version/hash. Release preparation generates the artifact once, architecture jobs only verify/reuse it, and publication compares all three manifest digests before release. The public-mirror publisher owns only `README.md`, `LICENSE`, `release-manifest.json`, and `skills/`, preserves repository automation, rejects tag reuse and SemVer rollback, and atomically pushes `main` with its annotated release tag.

### Renderer Application (`src/renderer`)
- `app.tsx`: Electron startup gating and stable root providers only. It bootstraps the assigned Window Session plus product gates, then mounts `WorkbenchShell`; it does not own Workbench navigation, Projects, shortcuts, or panel state.
- `styles/theme-source.css`: author-maintained renderer token source, including Tailwind theme declarations, window-type/theme-scoped root tokens, and the CSS-side `--vscode-*` contract consumed by renderer surfaces.
- `styles/theme-codex-foundation.generated.css`: generated renderer foundation layer for radius math, toolbar spacing, and window-scoped runtime overrides.
- `styles/theme-codex-utilities.generated.css`: generated renderer utility contract for utility selectors and specialized arbitrary/container utility coverage.
- `styles/theme-token-bridge.css`: renderer token bridge for authored aliases that are not part of the generated theme contract or foundation layer.
- `styles/theme-codex-surface.generated.css`: generated renderer surface layer for shared component/global rules.
- `styles/theme-utilities.css`: author-maintained renderer utility source for Nodex-local utility additions that are not part of the generated theme contract.
- `styles/theme-surface.css`: author-maintained renderer surface rules and global CSS contracts layered on top of the source token files.
- `components/workbench/workbench-shell.tsx`: the thin Workbench composition root. Its bootstrap Interface is one `WindowSessionBootstrap` plus the Library feature gate; it connects Project Query state, profile preferences, revisioned Window Session persistence, native command ingress, deep links, and the internal runtime Module.
- `components/workbench/workbench-runtime.tsx`: the selected Workbench integration Module. It composes Window State, the Session Catalog, owner-scoped Project/Session/Pages Scene materialization, the Panel Controller, Sidebar, Chrome, route, command palette, and selected hosts without becoming the authority for Query, Codex, Browser, Terminal, or editor data.
- `components/workbench/use-workbench-chrome-layout.ts`: DOM geometry and motion owner for ResizeObserver values, sidebar/right/bottom target sizes, header reservation, summary layout mode, and width-class projection. High-frequency measurements stay in MotionValues; React observes only semantic modes.
- `components/workbench/*`: the shared Project/Session/Pages Scene frame, recursive right/bottom panel group tree, shared leaf-level panel tab strip, renderer-local auxiliary surfaces, Pages Library picker, DB view host, Page Stage/Canvas Stage/terminal tab wrappers, settings surfaces, Process Manager dialog, and focused Workbench Modules.
- `lib/maitai/*`: the renderer-local view-state kernel. One stable Jotai store exists per renderer window; App, Thread (20), nested Route (20), and nested Composer (100) scopes resolve logical atoms to retained concrete bindings without retaining React pages. Persisted atoms adapt the shared renderer/main persistence substrate with versioned codecs plus explicit cross-window synchronization policy; that lower store remains available to bootstrap, migration, fixtures, and non-React runtime Modules needing imperative access. External-store atoms remain read-only bridges, scoped families own deletion cleanup, and ordinary React state never rebuilds hydration/subscription controllers over the lower substrate. Maitai never stores DOM/editor handles or duplicates Query, Codex conversation, Browser, Terminal, or collaborative Document authority.
- `lib/modal-registry.tsx`: one ephemeral App-scoped application-modal stack per renderer window. Entries are keyed and deduplicated by component identity, while the root host owns rendering and close removal. It stores descriptors rather than mounted React nodes and does not replace Radix Dialog's portal, focus, or accessibility behavior. Trigger-owned confirmations stay local.
- `components/workbench/use-workbench-preferences.ts`: App-atom ownership for renderer-wide Workbench preferences such as summary pinning, Composer submit behavior, worktree start mode, and branch-prefix policy. Storage and Git-refresh behavior stay behind focused adapters rather than Context providers.
- `components/workbench/sidebar-pages-section.tsx`, `pages-tab-picker.tsx`, `resource-scene-breadcrumb.tsx`, and the shared Workbench Page/Database/Canvas surfaces: the Project-independent Pages projection and singleton window-local Pages Scene. The sidebar is a flat bounded list of top-level roots, while every selected or nested Library target opens or focuses an ordinary tab in one shared tablist. The search-first tab picker reads the bounded Library catalog and owns open/new actions. Active-root highlighting derives from the selected surface's canonical Library path. `components/library/*` retains creation and explicit resource actions; Library remains the domain authority rather than a user route.
- `components/workbench/review-diff-panel.tsx` and `features/review/*`: Review right-panel surface and its isolated data/model seams. Git sources consume canonical live metadata and remote-first base identity, stable tracked/untracked initial diff Queries plus missing-path fallback Queries, double-microtask generation-fenced batches, per-path parsed-metadata identities, row-local full-content cells, four-object cat-file batches, exact partial-metadata expansion, and the real Pierre virtualizer; transcript Review consumes a stable diff/comment projection rather than the whole streaming conversation. Tracked-to-complete publication and unchanged per-file revisions across repository generations preserve existing Query, parse, row, full, and comment identities. Diff disclosure is a source-scoped global default with sparse per-file overrides, and collapsed textual rows remain connected to Pierre while its native collapsed layout state invalidates virtual heights. The surface retains toolbar controls, exact generated-aware partial-hunk/search-fallback behavior, resizable file-tree filtering, capped large-diff mode, safety-gated placeholders, comments, and actions.
- `components/workbench/workbench-settings-*`: settings route shell (`workbench-settings-route-shell.tsx`) with a settings-specific sidebar adapter, canonical section/page-key registry, path resolver with fallback-only handling (no legacy route redirects), shared settings page primitives, and one active top-level page at a time. Canonical top-level routes are `/settings/:section`; Browser owns its overview anchors and detail routes under `/settings/browser/<detail>`. The registry groups Personal, Integrations, Coding, Workspace, and Data & recovery pages, while the Browser page owns browser preferences, permissions, and profile-management details. The Hooks page keeps host/source/project/plugin selection in the route, groups app-server results without guessing source identity, and owns review/trust/enable interactions.
- `features/local-conversation/*`: renderer substrate and the public workbench boundary for active conversation stages. It owns the renderer-side app-server manager/registry substrate, host-message + control-event bridge, stream role/revision state, per-thread/any-conversation/meta selector hooks, connected thread/review stage containers, projection pipeline, summary-panel section registry, stage shell, header/auth shell, footer/composer shell, shared thread controls, turn virtualization, and the thread-body search/scroll/collapse behavior used by the active workbench thread stage. The thread-body shell consumes one real `CodexConversationSnapshot | null` plus genuine shell context; callers must not flatten conversation fields or synthesize partial snapshots at selector seams. Explicit snapshot, resume, history-page, side-chat, follower-bootstrap, and rollback ingresses materialize each canonical turn through the shared whole-turn lifecycle projection before it enters renderer state; the generic snapshot merge boundary remains projection-free. Stable visible-turn entries are the main-surface projection cache boundary: a mounted row owns both transcript and fixed todo/diff output from one model, while the right-panel latest-turn preview remains an intentionally separate preview surface. Activity projection owns command/dynamic/MCP metadata and emits only standalone entries or generic `agentActivityGroup` units; React leaves do not feed family-specific grouping policy back into projection. The same pure boundary may emit auxiliary turn state that has no DOM item—for example, null-anchor background-subagent activity can control commentary ownership and collapse defaults without fabricating a visible group.
- Nodex resource consent reuses the local-conversation request-card surface rather than creating another modal authority. The renderer projects bounded semantic/Nested Markdown details and returns `allow_once`, `allow_task`, `allow_project`, or `deny` through the targeted presentation bridge for read, write, and destructive requests. Turn termination and bridge teardown resolve pending presentation as denial. Renderer state presents consent but never owns authority, grants, or prepared commands.
- `components/kanban/*`: board UI, Page Stage composition, history panel, and the summary-only Toggle List. Toggle List filter/search/sort operates on `DatabasePageSummary`; an idle collapsed row stays projection-only, while disclosure or explicit title engagement can mount that Page's independent Document, so no multi-Page ProseMirror tree or whole-description write path remains.
- `components/block-documents/*`: the owned-Document query boundary, writable `BlockDocumentSurface`, rich Y.Text Page title surface, sparse sync status, Page outliner controller/presentation, and canonical Database reference surfaces. Idle collapsed Page outliner rows resolve membership-independent `PageTargetReadModel` data through `page-target:resolve`; Database-row `DatabasePageSummary` is not a Page-opening boundary. Disclosure mounts the target Page's independent Document only when needed. The embedded-surface bridge traverses host Blocks, Page titles, and disclosed bodies in visible depth-first order, while Page plus general Document-owner ancestry prevents direct or indirect inline cycles.
- `components/kanban/editor/*`: BlockNote/NFM integration, custom Blocks and inline attachment chips, Page outliner/reference rendering, Canvas owning shells, paste-resource materialization, and stable-ID Block relocation. An owning Page shell uses Block type `page`; a non-owning reference uses the canonical editor node `pageRef` and NFM `<page-ref url="nodex://pages/..." />`; an owning Canvas uses a childless `canvas` shell and lazy-loads its independent scene surface only after visibility/activation admission. Historical `card` and `cardRef` nodes are decode-only migration inputs. Cross-surface drag publishes logical `library | page | data_source` parents (with `document` only for a registered non-Page Document); the writer resolves current physical `space | document | database` coordinates and validates the target View/Data Source before acquiring leases.
- `lib/api.ts`: typed facade over the Electron renderer transport. A missing preload bridge fails fast; there is no browser/localhost fallback.
- `lib/codex-conversation-image-assets.ts` and `features/local-conversation/view/shared/use-conversation-image-asset.ts`: renderer-side generated-image query and source resolution. Pointer data uses the five-minute `file/image-src` cache with transient-only retries; local absolute paths use a file URL for display and load binary data only for a download/drag consumer. Gallery tiles resolve preview and full descriptors independently, while the full descriptor derives display, download, and data-URL outputs.
- `lib/codex-theme-variant.ts`: runtime theme bridge that derives semantic color variables from the active light/dark theme variant and injects them onto `document.documentElement` before renderer surfaces read the token bridge.
- `lib/query-client.tsx`, `lib/query-keys.ts`, `lib/query-options.ts`: low-frequency renderer server-state substrate built on TanStack Query. Query functions still go through `lib/api.ts`; keys are centralized for projects, Library navigation/Page/Database reads, boards-by-project, history, settings, Git branch state, local environments, Codex sidebar snapshots/pins, Hooks-by-host/root-set, scheduled automations, MCP status/resources, and workspace file reads. Query families enumerate cached concrete keys and invalidate each exact key when projection freshness changes, preserving the initial-fetch trailing-read fence.
- `lib/projection-invalidation-registry.ts`: one registry per renderer window and one transport subscription per Library or Project scope. Consumers expose dynamic Page/Database/Data Source/View/Document dependencies, the cursor covered by their current canonical snapshot, and one invalidator. Checkpoints repair query-before-subscription races; in-flight events coalesce into at most one necessary trailing read; callback failure is isolated per consumer.
- `lib/kanban-store.ts`: shared per-Project `BoardSummarySnapshot` store with Project/Database/Data Source/View identity, Store epoch/change-log cursor, deduped summary fetches, optimistic journal rebase (`baseBoard + pending/local ops`), LWW conflict superseding, typed conflict resolution (`updated|conflict|not_found`), and O(1) compatibility `pageIndex` lookup. Durable projection impact owns freshness. Cursor-fenced `board-changed` summaries remain only provisional low-latency patches.
- `lib/page-detail-store.ts`: grant-aware renderer cache for versioned Page Detail keyed by Project/Page. It registers exact Page, Document, Database, and Data Source dependencies with the central projection registry and does not use View visibility as existence authority. Schema mutations therefore refresh the open Property surface even when no Page value changed. The read model proves the exclusive Page parent and optional Source membership/schema/value slice; title/body remain exact-head projections edited through the owned Y.Doc surface.
- `lib/database-row-detail-store.ts`: explicitly bounded cache for the wide Database-row projection used by Kanban/calendar consumers. It requires active membership and is never a Page-opening boundary.
- `lib/use-kanban.ts` and `lib/use-projects.ts`: stateful owners over API channels. `use-kanban` remains store-backed via `useSyncExternalStore`; `use-projects` uses TanStack Query for server-state cache, invalidation, and cross-consumer request dedupe. Page history is a cursor read model owned by `history-panel.tsx`, while typing undo stays inside the mounted Document surface.
- `lib/use-workbench-window-state.ts` and `lib/workbench-window-state.ts`: the single renderer writer for canonical layout v7. The aggregate contains one discriminated Project/Session/Pages/empty location, Project-keyed Database search, owner-keyed Scene snapshots, and renderer-lifetime Back/Forward history; the revisioned Window Session Adapter persists only its canonical snapshot.
- `lib/use-workbench-profile-preferences.ts`: the separate profile-preference owner for per-Project view presentation, DB view preferences, sidebar width/collapse/disclosure, and bounded recent Pages. It never owns active location, panel trees, or runtime handles.
- `lib/use-workbench-session-catalog.ts`: Query-backed Project/projectless Session directory and exact selected-detail projection. Session Scene state stays in Window State; the catalog exposes only a leaf compatibility projection for the existing Session renderer and writes every resulting layout mutation back through the Scene owner.
- `lib/use-workbench-panel-controller.ts` plus `workbench-ephemeral-panel-state.ts`: the command-shaped durable panel Adapter and renderer-lifetime auxiliary-surface reducer. Durable view mutations and preview/Side chat/MCP/Plan/Automation/Subagents/process placement are mutually explicit.
- `lib/app-close-flush.ts`: renderer-side close-flush coordinator so all registered async flushers complete before one final Electron close ack is sent.
- `lib/nodex-y-provider.ts`, `block-document-surface-runtime.ts`, `page-editor-session-registry.ts`, and `owned-block-document*.ts`: transport-neutral Yjs provider, registry-dispatched surface lifecycle, durable PageTab model sessions, and prepared-descriptor validation for one writable Block Document. They own state-vector synchronization, merged local-update batching, one durable command in flight, idempotent retry, realtime gap repair, remote-origin echo suppression, store-epoch/generation reset boundaries, bounded flush/checkpoint/close, accepted-lease drain across visual teardown, disposable-checkpoint isolation after fatal state, independent client sessions, and ephemeral Awareness. A PageTab session retains its Y.Doc/provider, BlockNote editor, UndoManager, and Yjs-relative cursor while inactive; React owns only a generation-fenced EditorView lease. Other owners use the same generic surface boundary with their schema-specific envelope and ordinary component lifetime.
- `lib/electron-document-sync-adapter.ts`: typed binary structured-clone IPC provider transport. Exact local sessions are multiplexed by subscriber instance, and subscribe/unsubscribe reconciliation is serialized so an old disposer cannot close a revived session. A Library descriptor is validated without a Project coordinate before the renderer creates its local editor-surface scope.
- `lib/window-sessions.ts`: renderer helpers for bootstrapping the assigned window session and saving workbench layout snapshots through IPC.
- `lib/use-workbench-shortcuts.ts`: app-wide Project, command, search, navigation, and panel-command shortcut classification. Retired stage/sliding-window keys remain unhandled for the mounted surface.
- `lib/terminal-session-store.ts` and `lib/use-terminal.ts`: xterm terminal state and view-lease lifecycle. Main owns each PTY and grants one Window Session the interactive lease; the renderer store owns snapshots, lease status, pending writes, resize dedupe, 16k buffer truncation, takeover/release, and `terminal-*` IPC fanout. The hook mounts `@xterm/xterm` with Clipboard/Fit/WebLinks add-ons, CSS-variable theme extraction, Codex terminal key handling, window-zoom mouse coordinate patching, and ResizeObserver-driven fit.
- `lib/use-codex-account-actions.ts`: auth/account command wrappers (`read`, login start/cancel, logout). For the active thread renderer, auth state flows from the local-conversation app-server manager substrate, not from this action layer.
- `lib/codex-collaboration-mode-settings.ts`: global fallback collaboration mode persistence for no-thread/new-thread surfaces. Active thread collaboration mode is owned by the local-conversation manager record, not by shell-local storage.
- `lib/nfm/*`: renderer wrappers over the shared NFM core plus the BlockNote adapter and clipboard/read-only helpers.
- `lib/toggle-list/*`: rule engine and mapping logic for toggle-list views.

## Data and Event Flow
1. Renderer issues a command through `lib/api.ts`.
2. The Electron transport sends the typed request through the context-isolated preload bridge and IPC.
   Focused-window UI commands do not enter this mutation transport: application-menu accelerators send a typed command request through preload, `useWorkbenchCommandIngress` translates the event directly to the registered runtime command port, and toolbar/command-palette entry points execute the same command owner.
3. Main starts or reuses Core before opening the Profile. Every production capability enters its owning native deep Module; Electron never opens SQLite or reconstructs the transaction. Migration conformance uses exact frozen legacy inventories, the frozen final TypeScript v84 schema artifact, and disposable copies. A Page editor sends binary Yjs updates; there is no Page title/body snapshot command or main-process SQLite fallback. Agent reads publish no mutation events.
4. Core captures domain events and a required canonical `ProjectionImpact` in the same `change_log` transaction as their semantic mutation and exact-head projections. The impact is `none`, `all`, or bounded Page/Database/Data Source/View/Page-bound Document-head coordinates; it carries no title, summary, property value, Project identity, or change kind. Ordinary mutations and Project creation enumerate their full projection closure. Visibility-changing moves, grants, and transfers use identity-free `all`, because the Project router's post-commit authorization view cannot safely name a resource the Project just lost. Schema v88 records the first sequence with complete impact history. Replay crossing older rows returns a resync boundary, while a missing or malformed post-floor impact is corruption. Live publication and replay both use the same committed-row decoder. Main's `ProjectionInvalidationRouter` consumes only the top-level impact, cursor, and handshake Library identity. Library scope receives the complete impact; each active Project scope filters all coordinates through one Core authorization read on its own ordered queue, reusing canonical Page/Database/View authorization predicates. Authorization failure emits a scoped resync without identities. The Core supervisor advances only after router acceptance, so fanout failure reconnects from the previous cursor. Database, Library, Workspace, Automation, and compatibility `board-changed` events retain their domain effects but do not own projection correctness.
5. Electron main broadcasts ordinary change events to all open windows through the safe IPC sender; Codex host-message/event fanout goes through the renderer-client router, which itself uses the safe sender. Direct `webContents.send` fanout is not allowed outside those helpers because renderer reload/close can dispose frames between lookup and send. Board subscriptions filter by `projectId`; Project-list and Session invalidation subscriptions are global, with Session summary scopes carried in the event.
6. Each renderer window owns one `ProjectionInvalidationRegistry`, created synchronously above Query consumers. It reference-counts one Electron IPC stream per Library/Project scope and reads each consumer's dependencies and satisfied cursor dynamically. A new subscription receives a checkpoint behind already accepted Host work, closing the race between an initial query and later React effect. Resource intersection invalidates Page detail, Database Views, references, Library navigation, or management reads; `all`, resync, and Store-epoch changes invalidate the complete scope. Events arriving during an initial or background read set a required cursor, and callback completion triggers one trailing canonical read only if the returned snapshot does not cover it. TanStack Query families enumerate actual cached keys and invalidate each exact key. Cursor-fenced `board-changed` summaries may patch Kanban immediately but can never overwrite a newer canonical `BoardSummarySnapshot`. Ownership-path and navigation events remain for topology or permission side effects rather than freshness.
7. Reminder scheduler polls occurrences, dedupes delivery via receipts, and emits `reminder:open` to renderer on notification click.

Block-first migration foundation:

1. Core accepts the exact frozen v26, both v57, v68, v82, and v83 TypeScript inventories as historical import sources, the exact final TypeScript v84 inventory as its direct handoff, and exact Rust-owned v85 through v103 stores. For a historical source, Core identifies the complete normalized physical inventory and takes an online database snapshot plus a validated asset-tree backup. The earlier v57 inventory receives a named-column rebuild of its Thread and Automation tables only inside that staging copy. Core then invokes the bundled hash-pinned migrator, reproducibly built from the fixed historical source plus reviewed compatibility overlays that retain legacy Page projection names and workflow-status identities, refresh recovered option registries, materialize explicit cross-Project Page references as same-Library read grants, retain missing targets as inert unresolved-reference diagnostics, and audit old identities on token boundaries in Database authority and committed evidence while leaving opaque historical Session UI state to schema validation only. Core advances the candidate to exact v84, reconstructs authoritative Yjs content through Yrs—including BlockNote `tableHeader` matrices as canonical `headerRows`/`headerCols`—rebuilds only derived projections, validates the complete v84 handoff, and atomically publishes current Rust ownership as v104 under a crash-recovery journal. Rust-owned v85 through v103 stores are validated exactly, backed up, and atomically upgraded before v104 publication. The historical v87 migration widened null tab ownership to Browser, Terminal, and exact-file Files; v88 added required projection impact plus its honest replay floor; v89 canonicalized Codex Thread clocks; v90 removes Project Session panel/tab authority, preserving only one valid initial Database View target as `initial_database_view_id` while intentionally discarding historical window arrangement; v91 moves sidebar lane order into normalized relation ranks while keeping Thread previews compact; v92 canonicalizes every schema-owned `TEXT` `*_at` timestamp to millisecond UTC; v93 replaces the denormalized per-Session `initial_database_view_id` pointer with the historical `database_starter` marker because the presented View resolves from Database authority at read time; v94 replaces the optional legacy Project icon with a constrained, non-null color-plus-marker appearance; v95 makes Canvas authority incrementally verifiable with exact counters, deterministic hash buckets, a projection head, compact intent receipts, and indexed element/file metadata; v96 adds exact incremental tombstone bytes for constant-time maintenance policy; v97 adds explicit Canvas owner metadata, normalizes the retired Database Canvas presentation to List, and makes first-class Canvas placement queryable; v98 validates every live Yjs Document before removing non-canonical reconstruction fingerprints and enforcing hash-free Yjs heads; v99 removes current database-starter state, deletes only unthreaded marked starter Sessions, and preserves threaded marked rows as ordinary Sessions; v100 adds normalized Relation Property definitions and Page-reference edges without interpreting legacy Property JSON; and v101 adds the persisted projectless permission-mode scope; v102 adds the LocalCommit ledger; v103 adds the composite LocalCommit identity constraints; and v104 adds canonical LocalCommit evidence hashing. Unfrozen same-version lineages, near-matches, ambiguous owners, and future stores fail closed; a Rust-owned v104 store is validated exactly, including timestamp, Database View-kind, Canvas ownership, scene integrity, Yjs hash-separation, and LocalCommit evidence invariants, and never silently repaired.
2. A successful Document apply tentatively reconstructs and validates a Y.Doc, derives the changed title/Block identities from before/after state, reconciles the registry/index, and writes the binary update, immutable receipt, exact-blob checksum, state vector, and new head under one immediate SQLite transaction. Receipts remain independently of update payload retention; compaction verifies and semantically reloads a full snapshot at the current head, then atomically removes only its covered payload tail. Store epoch, Document generation, update identity, `headSeq`, Yjs state vector, and exact retained-blob integrity remain separate concepts. Equivalent Y.Docs may produce different full-state wire bytes, so Store v98 removes Yjs reconstruction fingerprints and excludes full-state hashes from authority, integrity, and concurrency.
3. Production Page Stage prepares the exact owned descriptor before rendering content. Only a ready `yjs`/`block_tree` descriptor enters the Page editor: it mounts one independent Y.Doc surface, completes state-vector sync before resolving `Y.Text("title")` / `Y.XmlFragment("body")`, and binds BlockNote through its collaboration extension without projection-based initialization. The NFM parser produces a zero-or-more Block forest without editor policy. Document create/replace/patch boundaries normalize an empty forest to one registered stable-ID paragraph, while Fragment insertion rejects an empty forest and points callers to `<empty-block/>`. A first root insertion into a semantically blank Document promotes the existing seed ID through a fenced Block update, preventing the authority scaffold from appearing in canonical NFM.
4. A writable Block Document runtime normally belongs to one visible React effect incarnation. A durable PageTab is the explicit exception: its Window Session view/tab-keyed model session retains the Y.Doc/provider, BlockNote editor, and UndoManager while the inactive React body and EditorView are absent. Switching away removes local Awareness and backgrounds a bounded persist without disconnecting the provider; returning mounts a fresh EditorView, reconciles current CRDT state, restores the selection from Yjs-relative positions plus PageTab-local scroll, and reactivates the main NFM editor only when it owned the Page's last focus intent. Local tab close, Window Session view teardown, store-epoch/Document-generation/schema/owner identity replacement, or terminal reload destroys the retained model and provider exactly once; renderer close flushes every ready retained session before acknowledging shutdown. An unpromoted preview disposes on final view teardown, while promotion keeps its stable model identity. This is a deep runtime Module, never hidden DOM or Maitai state. Normal durable ACKs are quiet; sustained pending/offline/error/reset states are the only Page Stage sync chrome.
5. Canonical Page and Database View references are childless and store only stable targets. A nested `page` shell and non-owning `pageRef` resolve through the same flat Page outliner Adapter; collapsed rows use summary projections without a provider, while disclosure mounts the target Page's independent Document. Runtime boundaries never copy a target title or body into the host Y.Doc.
6. The relocation Hub makes `Move to Page` a stable-ID, dual-Document transaction. Every active surface locally commits composition, flushes its provider, becomes temporarily non-editable, and ACKs its durable head. The writer prepares again after those ACKs; failure before commit cancels the lease, while response loss after commit resolves through the immutable receipt and state-vector resync.
7. Whole-store backup/restore is a Core-wide maintenance boundary, not a raw file operation. Core drains admitted writes and managed-asset mutations, takes an online SQLite snapshot, validates the complete staged database/assets closure, and records DB/WAL/assets replacement in an fsynced journal. Startup rolls every pre-commit phase back to the complete old store or finishes cleanup after a durable `committed` phase. The installed DB rotates `storeEpoch`, clears native caches/subscriptions/connection-bound operations, and republishes the runtime descriptor. Electron performs a controlled relaunch after the successful restore result so every Host Adapter reconnects to the new epoch.
8. The owned-Document registry has another concrete owner: `synced_block_source` with `nodex.synced-block@1` and a body-only `block_tree` Y.Doc. A system-managed source has a real but user-hidden Library placement; visible `syncedBlockRef` instances contain only `sourceBlockId` and never foreign body content. The authority kernel shares Document persistence, projections, history, relocation, immutable receipts, caller `storeEpoch`, and first-attempt actor audit.
9. Reusable Template sources are registered `block_tree` owners over the same body-only root primitive, Yjs DocumentStore, provider, history, projection, and relocation Modules. Template sources carry an authoritative intrinsic display name; `templateRef` is childless and instantiation renews every copied subtree ID against exact source/target heads. Long documents remain Pages and code remains an ordinary `codeBlock`; size-dependent loading, caching, and compaction never create durable owner types.
10. Every Project retains one deterministic primary Canvas Block, while users may create additional Canvas Blocks at Library root or inside a Page. A newly allocated Canvas Block/Document uses canonical UUID-v7 identities; the Project-owned primary pair uses the exact system identities `canvas:primary:<projectId>` and `document:canvas:primary:<projectId>`. Existing-owner Library boundaries accept precisely that semantic union without weakening new-identity allocation. Every Canvas independently owns a `nodex.canvas@1` Document using `canvas_scene`; Store v97 records its Library membership in `canvas_owners`, while its exclusive placement is either a Library rank or one exact childless shell in a host Page Document. Library create, rename, move, and duplicate commands capture the content/host coordinates they consume; delete is an owner-lifecycle terminal command whose CAS covers only current location and metadata. The serialized writer linearizes delete against scene writes and commits structure, Document lifecycle, shell mutation, projections, event, and exact-retry receipt atomically. Normalized element rows are resolved by Excalidraw version/nonce rules with canonical hash fallback; bounded shared app state is field-intent merged; managed files are immutable content-verified URI metadata. Store v95 persists exact scene counters, derived element reference/text fields, a sparse 1,024-bucket v2 content root, and one projection head; v96 adds exact tombstone JSON bytes. Warm writes read candidate rows and affected buckets, update only changed authority/projection rows, and keep the common Module receipt as the sole replay result; full scene materialization is reserved for sync, history, restore, copy, backup, eligible idle tombstone compaction, and integrity validation. In one renderer, inline and Stage ports for the same `{projectId, documentId}` share one ref-counted Canvas Document session containing the provider, exact outbox drain, accepted scene, and staged-file catalog. Each port retains its own binding, Excalidraw runtime, presence participant, asset resolver, undo/tool state, and surface-scoped camera. A runtime surface key may include transient mount/session identity, while renderer-local camera and inline-frame preferences use a separate stable semantic scope and Store epoch; no presentation preference enters Page or Canvas Document authority. Cross-renderer sessions converge through exact mutations, content-addressed managed assets, and content-based file assertions. The Host-only presence hub binds identity to exact renderer targets and keeps cursor/selection/idle traffic out of Core and SQLite. When the last clean, fully committed surface closes and count or byte pressure crosses the Core-owned threshold, best-effort maintenance pins the complete old scene, removes retained tombstones/orphaned files, rebuilds projections, and rolls authority to the next generation at head one. Other active surfaces, offline state, pending outbox intent, or fence failure defer the work; no Canvas UI or active undo stack is involved. Canvas writes no Yjs updates, state vectors, or operational Yjs snapshots.
11. Page history is a read model over immutable `document_versions`, `block_mutations`, `block_relocations`, and `change_log`, scoped by Page identity and its owned Document. It uses a stable source-specific cursor and exposes only bounded validated evidence. The renderer previews and forward-restores retained Document checkpoints; property/location/lifecycle evidence is not given a synthetic whole-Page inverse.
12. Every `db_view` renderer surface resolves its exact durable `databaseViewId` and queries that View's descriptor/config/rows. Kanban mutation affordances are enabled only for the exact primary write-compatible status-grouped View; arbitrary Views render from the generic query model and never borrow the Project's primary board identity. Cache keys and invalidation include both Project and View identity.
13. Current Page Stage and Board vocabulary is a presentation Adapter over Page authority, not a parallel mutation kernel. One shared schema-driven Property module renders every supported Source Property type and compiles exact value revisions to Database Module value edits; Page Stage adds only optional semantic capabilities such as status movement and paired scheduling. Removing or corrupting one Property cannot invalidate sibling rows. Page-intrinsic run/schedule fields use Block property CAS, while Database value commits refresh the typed schedule index after the complete atomic intent batch. The retired Card metadata snapshot/compiler transport no longer exists. Database schema/View management likewise derives operations, exact revisions, selected View identity, and logical Page anchors without accepting client rank keys.
14. Physical tombstone collection is a separate retention planner, not a cascade side effect. It retains the newest configured count, computes a recursive deleted ownership closure, scans exact current and retained historical Document materializations plus cross-Project references/sessions, classifies every recovery/history/Database/FK root, and only deletes an all-clear closure in one immediate transaction. Attributable expired versions and resolved recovery evidence are pruned in that transaction; immutable mutation/change receipts remain and may retain wider same-Project attribution without owning reachability. Before deletion, every closure ID enters the immutable global retired-ID registry, whose `blocks` insert trigger prevents identity reuse across every typed creation path. Unknown schema, corrupt projections, missing document-bearing ownership, cross-Project attribution, mixed prunable evidence, or an unclassified inbound foreign key retains the candidate.

Board read flow:
1. All primary and non-primary board consumers use `database:view-window:get`. Core applies the View filter/order in SQLite, reads `LIMIT first + 1`, and returns a signed keyset continuation. One effective-group SQL expression (explicit position group first, else the normalized grouping Property value, with NULL/empty-string/empty-list all meaning unassigned) drives the summary projection, the effective-group-major total order, group scoping, and group totals, so a grouped View also serves per-group windows (`groupScope`) and a bounded `database:view-groups:get` totals read whose counts always agree with scoped traversal. Each window is independently bounded below the ordinary transport ceiling and contains no Page body. These channels return a typed `CoreReadResult` envelope so cursor rejections and retryable failures reach the renderer as codes, not flattened strings.
2. Page Stage reads versioned `PageDetail` through `pages:detail:get`, assembled in one SQLite read transaction after Project grant evaluation. The contract contains Page identity/parent, the owned Document exact-head projection, intrinsic properties, and—only for a Source-parented Page—the matching membership, Database Container, Data Source schema slice, and values. Library- and Page-parented Pages expose the same core Stage without fabricated Source fields. Database row detail is an identity read; list consumers never batch-hydrate bodies.
3. Lifecycle, property, Database, and committed Document events carry or trigger a narrow authority-derived `DatabasePageSummary`; field-level conflicts return typed current property evidence without a whole-Page content overwrite payload.
4. Page content search runs through current `block_search_units` FTS projections via `pages:search`. Every hit is generation/head-fenced to its owning Document, authorized against the requesting Project, and returns Page identity plus a bounded title/body excerpt and optional Data Source context.
5. Full-board reads are not exposed through IPC. The renderer kanban store owns one window per group (scope key, merged rows de-duplicated by Page identity, per-group `nextCursor`), pages each board column independently, preserves the loaded span on refresh, and silently converges a group from its first window when its cursor is rejected. Column assembly happens once in the renderer render model; new consumers compose bounded summaries with explicit identity detail/search requests.

Project sessions and sidebar flow:
1. The renderer shell loads `codex:sidebar:snapshot({ refresh:false })` as a bounded cold-start overview: counts plus the first pinned-task window, never the complete Thread/Session catalog. Project and projectless task lanes use `workspace:tasks:list`; only expanded or active scopes request their first window, `Show more` follows the opaque continuation, and an active task outside the loaded window comes from an exact Session identity read.
2. Main treats app-server `thread/list` as the discovery authority for interactive root threads. A foreground `codex:sidebar:sync` coalesces across windows, observes one bounded app-server window, commits its local effects, and returns immediately. A process-wide single-flight background sweep continues subsequent active and archived windows with event-loop yields, retry/backoff, and a run identity; only a sweep that reaches both ends may reconcile locally missing rows. An interrupted or failed partial sweep never infers deletion.
3. Foreground windows, background windows, and app-server `thread/started` notifications share one Workspace reconciliation path: skip non-sidebar helper/reviewer threads, match cwd to the longest normalized Project source prefix, and create/reuse a project-bound or projectless Session. Re-home decisions use Session/Thread domain state only; a window's open resources cannot block or redirect them. Mutation results contain changed identities/scopes and projection revisions rather than rebuilding a complete sidebar response.
4. Sidebar reconciliation results are main-broadcast invalidation state, not a second Thread/Session projection. Successful renderer-initiated syncs, notification materialization, and forced unknown-notification repairs emit `sidebarSyncUpdated` host messages so every open window refreshes the affected bounded windows. A no-op `thread/list` upsert only refreshes `codex_threads`; it does not emit `project-sessions-changed`. Thread title/preview/status/archive/updatedAt changes are sidebar catalog changes, while `project-sessions-changed` is reserved for true session container or thread-link changes such as create/delete/reorder/pin/unread/archive/unarchive/materialize/re-home/attach/detach.
5. TanStack Query owns Project and Project Session window/detail server state. Exact Project/Session hydration proves a selected Scene owner independently of bounded sidebar windows. `WorkbenchSessionCatalog` combines the selected domain Session with a read-only legacy render projection of its owner Scene; background invalidation retains the local Scene panel tree and surfaces while shared labels, lifecycle, Thread link, and resource targets refresh. `WorkbenchRuntime` mounts only the selected Project or Session route; switching owners unmounts the previous page synchronously while Query, Codex conversation execution, Browser, Terminal, and editor continuity remain in their deeper owners.
6. Core owns the shared Workspace and Automation trees. Workspace tables persist Project/sidebar order, Session domain and Thread metadata, pin/unread/archive state, and parent-linked subagent metadata. Window Session files persist per-window Workbench Scenes. Automation definitions, revisions, schedules, leases, run lifecycle, inbox/read state, archived message excerpts, occurrences, and reminder receipts remain one native aggregate. Electron keeps OS/runtime duties and explicit Window Session presentation persistence without mirroring Core data.
   Automation-run lifecycle mutations emit `codex:automation-runs:updated`, which refreshes Scheduled task rows, automation-run inbox queries, and the Codex sidebar/recent thread snapshot. Cron execution is a command-only main-process runner: it owns workspace setup, app-server commands, tool/request transport, run status, and protocol-turn inbox extraction, but it never hydrates, merges, or broadcasts a conversation transcript. Heartbeats require a fresh renderer-state lease from the exact current conversation owner; main resumes/starts transport only and never claims a headless conversation-owner role. Brokered automation requests are replayed after a renderer later adopts the task.
7. Project session list results include a service-derived `displayTitle`. Attached sessions resolve it from `thread.threadName || thread.threadPreview || noThreadFallbackTitle || "New thread"`; blank sessions resolve it from `noThreadFallbackTitle || "New thread"`. `noThreadFallbackTitle` is not a Codex thread title authority.
8. Window Session UI state owns the active Project/Session/Pages/empty location, focus/history, every owner-keyed Scene panel tree, and local surface descriptors. Selecting a Project opens its Project Scene independently of sidebar disclosure. Selecting a Project-bound Session records its Project navigation context; selecting a projectless Session uses a null context rather than retaining an unrelated Project fallback. Selecting Library content presents it in the singleton Pages Scene without creating a resource-specific owner.
9. Project creation creates no Session. Materializing a Project Scene gives it the Project's current primary Database default View as the semantic primary, places it exactly once at the front of the fixed-open/full-width right stack, and creates one Scene-local Agent Dock draft. Initial-Project bootstrap may additionally present the Welcome Page in that stack. The Project root cannot close, move, or split away; closing every other surface consumes no Core state and does not change it.
10. The Project Agent Dock is a footer-only view of a normal Project Session and its canonical Codex conversation. Selecting a Chat never navigates or captures Browser ownership. `New chat` creates no Session until first send; creation, binding, and Thread start advance forward so a failed start retains one retryable blank Session. Every owner Scene persists the shared composer-overlay visibility without entering Back/Forward history; Project Scenes separately persist Dock binding and draft identity. Hiding an overlay removes only its presentation claim and composer reserve.
11. Local `db_view` descriptors are unique per durable target within one Scene, while `review` remains the singleton right-panel kind. Browser descriptors use Window Session-scoped Browser runtime identities and may exist without a Codex Session. Manual Project Browser descriptors remain Project-owned; agent-created Browser Use descriptors belong to the owning Session Scene and retain exact source-Thread metadata without replacing Main runtime ownership. Terminal and Review descriptors carry an explicit Project or Session context; Terminal descriptors also carry a PTY resource ID and acquire one interactive lease at a time. Files, Page Stage, Review, and Database View descriptors retain explicit target authorization context where required.
12. `WorkbenchSceneSnapshot` is the strict owner-scoped surface contract. The primary surface is fixed by owner kind; panel descriptors carry stable resource targets but no owner, panel, or order because the containing Scene and its two panel trees provide those coordinates. Project primary placement and Agent Dock invariants are normalized at this boundary; malformed owner/primary or kind/config combinations fail closed.
13. Panel previews remain renderer-memory state. Files and Browser previews occupy one preview slot per Scene panel leaf, replace each other within that leaf, and enter the Window Session snapshot only when pinned.
14. Renderer-local side-chat tabs are also outside SQLite but use a separate leaf-scoped lifecycle from previews. The renderer creates `sidechat-loading:<parentThreadId>:<index>` tabs, asks main to start an ephemeral fork, replaces the loading tab with `sidechat:<threadId>`, and discards the backing temporary thread when the tab closes.

Codex Threads flow:
The release-locked Open Interpreter app-server is the wire-contract authority. `pnpm run codex:schemas:generate` transactionally regenerates TypeScript bindings and the selected self-contained JSON Schema roots under `packages/codex-app-server-protocol`; `pnpm run codex:schemas:verify` must remain byte-stable against that runtime. The release lock independently binds the exact source, reviewed patches, immutable dual-architecture artifacts, staged metadata, and generated experimental schema fingerprint, while the Agent runtime conformance gate exercises the shipped binary and representative wire flows. Nodex does not install a parallel official Codex runtime or maintain a full upstream protocol oracle: Open Interpreter owns its documented Codex-client compatibility, and Nodex validates the exact runtime and protocol surface it consumes. Main validates complete JSON-RPC envelopes before routing, and generated `ServerNotification` / `ServerRequest` discriminated objects remain whole through buffering, owner IPC, fallback delivery, and renderer consumption. Nodex-owned orchestration inputs and projected view models stay local only when they transform that generated contract; exact protocol copies must be aliases, indexed-access/`Pick` derivations, or generated runtime-schema adapters.

1. Renderer sends `codex:*` IPC actions through `lib/api.ts`, manager-backed control hooks, and the local-conversation app-server manager substrate.
2. Renderer loads `model/list` and `collaborationMode/list` via IPC and resolves active thread model, reasoning effort, and collaboration mode from the manager-owned `latestThreadSettings` when a thread exists. No-thread/new-thread draft surfaces may reuse a persisted draft model only when it still appears in the visible `model/list`; otherwise they select the app-server default model from `isDefault`, then the first visible model, and omit the request model override when no visible model is available.
3. Existing-thread next-turn settings flow through app-server `thread/settings/update` and `thread/settings/updated`. Canonical conversation hydration retains one complete generated `ThreadSettings` value in the conversation sidecar before any owner action can run. Main and renderer-owner settings transitions update that value first, then derive `latestThreadSettings` and `latestCollaborationMode` for legacy consumers; main falls back to a local merge only when the app-server method is unavailable.
4. `codex-service` resolves Page-requested run targets (`localProject` / `newWorktree` / `cloud`) through the Project's source roots, including sticky per-Page managed-worktree reuse via `runInWorktreePath`; for freshly created worktrees, it optionally executes selected `.codex/environments/*.toml` `[setup].script` before thread start. Session-owned thread starts use `codex:thread:start-for-session`, persist the resulting thread in `codex_threads`, and attach it through `project_session_threads` without creating Page ownership. When a renderer initiated a direct local start, main returns a single-use fresh-launch descriptor containing the exact prepared first-turn parameters instead of starting the turn as a second visible authority. That renderer adopts the fresh thread, synchronously publishes the optimistic first turn, consumes the descriptor through the owner-scoped facade for the one real `turn/start`, and returns the submit action at the optimistic-visible boundary while transport completion continues through the normal owner transaction; headless starts retain the main-owned fallback. Project sessions use their primary source for local/worktree starts. For a null-owned projectless session, the renderer requests a filesystem descriptor through the typed `codex:projectless-thread-cwd` host boundary on first submission; main validates the descriptor, starts only in the local target, uses the generated task directory as cwd and `~/Documents/Nodex` as the runtime root, and persists the output/browser-root hints with the thread.
5. Sidebar sync uses app-server `thread/list` and `thread/started` notifications as the discovery authority for local interactive root threads, excluding archived threads by default. Each non-ephemeral, non-side-conversation, parentless thread is matched to the longest normalized Project source prefix from its cwd; matches create or reuse Project-bound Sessions, and misses create projectless Sessions with `project_id = null`. Parent-linked subagents remain in the Thread catalog and parent-conversation membership only. Core forbids them from owning Sessions and repairs late parent classification atomically; task-window SQL, bounded main snapshots, and renderer presentation repeat the root-only predicate as fail-closed projection boundaries.
6. Side-chat starts use `codex:thread:side-chat:start`: main reads the parent conversation and derives its Project, cwd, writable roots, output directory, and browser root before forking with `ephemeral: true` and excluded turns. A Project parent without cwd uses its Project root; a projectless parent without usable cwd first runs the persisted workspace-repair boundary and saves the repaired tuple. Main then supplies side-conversation developer instructions, injects a boundary message, caches the resulting side conversation as ephemeral manager state, and optionally submits the initial `/side` or selected-text prompt into the side thread. Side chats set local source metadata (`sideConversation` and `sideConversationParentNavigationPath`) but do not create `codex_threads`, `project_session_threads`, Page links, or Project thread-list entries.
7. For session-owned first-message starts, `codex-service` emits `codex:event` `threadStartProgress` updates keyed by project/session and run target. Local-project starts use compact `startingThread` / terminal `ready|failed` progress. A renderer-local launch-pending bit keeps a newly persisted attachment behind the blank composer surface until the owner transaction has committed its optimistic user turn; an attached thread with no readable conversation still projects an explicit preparing state instead of a blank body. Fresh worktree starts additionally emit `creatingWorktree` / `runningSetup` stdout/stderr chunks for the setup log before `startingThread`.
8. `codex-service` persists thread cwd in `codex_threads` (payload cwd or resolved fallback) so follow-up turns keep the same execution location even when a thread has no Page or Project. Ordinary cold resume repairs unusable persisted projectless locations at the main-process filesystem boundary and updates the same row before app-server resume; seeded fork resume bypasses allocation so inherited workspace hints remain stable.
9. The Core Workspace Module persists canonical Thread metadata and optional Page relations; `codex-session-store` reads app-server rollout files only as bootstrap/recovery input for the main-process conversation manager.
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
14. Main exposes separate snapshot/resume request IPC plus a `codex:host-message` stream. Snapshot requests are read-only dormant-cache reads; they never make main the active transcript writer. Explicit resume drives `needs_resume -> resuming -> resumed` and returns a role-tagged result. With no owner, main hydrates an existing thread from `thread/resume`, silently seeds the accepted document/revision, compare-and-sets the invoking renderer as owner, and returns the owner result; the renderer releases the ordered same-thread notification/request buffer, publishes the next owner snapshot, then requests replay of transport-brokered pending requests. A fresh Session thread instead uses authenticated fresh adoption: main validates the launch id and initiating renderer, seeds the accepted revision without calling `thread/resume`, reserves that renderer as owner, and buffers notifications until the renderer releases adoption. With an existing or reserved owner, another renderer receives that owner's accepted document/revision/client id as a follower without issuing another app-server resume. Failed resume/adoption returns to recoverable state; main never emits a source-null conversation stream. Session-owned `thread/start` still uses thread-start deferral so early `thread/started` events replay only after the created thread is attached to its target session.
15. The Codex service now stores active thread authority as a conversation-centric manager record (`detail + resumeState + stream role + queued follow-ups + pending steers + item cache`) instead of scattering transcript authority across independent per-thread maps. Running-thread `queue` submits mutate manager-owned queued-follow-up state first, then a manager-owned drain loop advances those entries through `turn/steer` or the next `turn/start` when the active run can accept them.
16. `features/local-conversation` is manager-owned: main schedules auto-title generation for ordinary session thread starts after `thread/start` succeeds and before the first durable `turn/start`, applies the returned title locally, then persists it through `thread/name/set`. Main emits host-scoped `sharedObjectUpdated`, `threadTitleUpdated`, `threadStreamStateChanged`, `mcpNotification`, and `error` messages; auto-title generation failures are logged and do not emit host errors. A renderer host bridge fans messages into an app-server message bus, and per-host app-server managers subscribe to that bus through a registry with per-conversation, any-conversation, and any-conversation-meta callbacks. Connected thread/review containers subscribe only to the active thread and its child memberships. Background child-agent summaries merge parent `subAgentActivity`, legacy collaboration references, and source-linked app-server threads; the projector owns status normalization, friendly names/roles, assistant-message previews, recency ordering, and the modern-inline versus legacy split. Parent child-membership refreshes travel over `sharedObjectUpdated`, including status/archive/delete transitions, so active renderer owners update agent groups without accepting source-null transcript patches. Modern inline activity opens one transient `subagents:<rootThreadId>` right-panel tab: its root route lists the descendant tree and lazily hydrates only visible preview batches, while its detail route reuses the child transcript stage in read-only mode under a compact back header. Background-agent detail routes never mount a composer or claim the session's `ComposerScope`; writable auxiliary thread surfaces instead provide their own stable composer identity. Reopening another modern child updates that same tab's internal route. Legacy non-inline collaboration rows retain read-only `background-agent:<threadId>` tabs and selected-child hydration. Resumed child-thread de-dup reads `conversation.source.parentThreadId -> parent turns` through normal per-thread selectors; renderer must not reconstruct parent ownership by scanning every manager or by inferring parenthood from `childMemberships`. `WorkbenchShell` no longer owns a shell-wide conversation reducer, a full `conversationsById` map, or a separate control-plane reducer.
17. Thread titles are ordinary app-server thread metadata. Manual rename sanitizes to 60 characters before `thread/name/set`; generated titles use the structured title helper (`gpt-5.4-mini`, low reasoning, `{ title: string <= 36 }` schema), reject schema-invalid model output before cleanup, are applied optimistically in main, and are then persisted through the generated-title path. `codex_threads.thread_name` is the local read model for this metadata; thread name/status/archive/delete projections update sidebar rows through `sidebarSyncUpdated`, not through linked `project-sessions-changed` fanout.
18. Renderer theme state follows split ownership: authored CSS declares the token and utility contract, while the runtime theme bridge computes semantic variables such as foregrounds, control backgrounds, borders, panel colors, and editor colors from the active theme variant before the CSS token bridge resolves renderer-facing aliases.
19. The Diff stage is a workbench-owned review surface, not a transcript diff card. `Last turn` review comes from the active conversation turn diff, while `unstaged` / `staged` / `branch` / `commit` repository data flows through the dedicated typed Git worker bus. Git review is metadata-first: the worker builds file summaries from machine-readable Git status/stat/raw channels before exposing optional textual patch bodies, untracked files are diffed through Git rather than decoded in Node as UTF-8, and renderer rows lazily request per-file diff bodies instead of parsing an aggregate snapshot patch. `review-patch` is a read-only full-patch query for copy/export actions; `apply-patch` is the mutating apply/revert method in the same repository lane. The Review source selector only changes that data source; it does not start a Codex review prompt. Branch commit choices use `branch-commits`, and pull-request status, checks, comments, diffs, merge, update, and create operations remain typed `gh`-backed Main orchestration with disabled states for missing CLI/auth/remote.

Workbench reopen flow:
1. Main process keeps a profile-local Window Session catalog in `window-sessions-v3.json`; this is the cold-launch restore and closed-window history source for window count, Workbench layout v7 (including Project, Session, and Pages Scenes), monotonic layout revision, focus recency, saved window bounds, and explicit `open | closed` lifecycle. Existing catalog and layout versions migrate forward without deleting their source files. Writes use a bounded validated atomic replace; a malformed v3 catalog file is preserved with a `.corrupt` suffix before a fresh catalog is created.
2. Renderer bootstrap consumes its assigned window session through IPC before mounting the shell. No workspace catalog or deleted legacy snapshot store participates in bootstrap.
3. Live Workbench state is one renderer-window App aggregate. Durable reopen flows through Window Sessions; no localStorage/sessionStorage or Core mirror owns Scene surfaces or panels.
4. On close, renderer flushes the current layout snapshot, Page draft state, and registered close flushers before sending the final close ack. Main marks the Window Session closed only after the BrowserWindow's definitive `closed` event; app quit and unexpected destruction retain `open` lifecycle so cold-start recovery is not mistaken for deliberate dismissal.
5. Generic New Window acquisition reattaches the most recently closed Window Session in reverse close order, preserving its exact Window Session, tab, split-tree, Browser-scope, layout-revision, and saved-bounds identities. If BrowserWindow construction fails, Main restores the exact closed catalog record.
6. When no closed Window Session is available, New Window asks the trusted requesting renderer to flush its latest state, clones that layout with reminted tab/leaf/branch/Browser/editor identities, and then evolves independently. A targeted `Open in new window` request always clones its source with the active-Session override and never consumes unrelated closed history; a generic request with neither closed history nor a live source creates a fresh Window Session.
7. Startup policy operates only on `open` records. `all` restores all open Window Sessions, `last-window` restores one and closes the other previously open records into recoverable history, and `none` closes every previously open record before creating a fresh Window Session. If a restoring policy finds no open record, it reopens the most recently closed record before falling back to a fresh one.
8. Closed history is compacted by recency and serialized size. Main retains at most twenty closed records by default and then evicts the oldest closed records until the catalog fits the 32 MiB ceiling; open records are never evicted.

## Invariants
- Canonical content may be exact and large, but every rendered, parsed, formatted, accessible, or incrementally accumulated projection has an explicit feature-owned budget. Exact files and attachment bodies stay with their main-process owner; exact conversation and tool payloads stay in canonical conversation state. The owning ingress bounds intentionally lossy observations such as live log tails, the owning parser rejects over-budget Markdown/diffs/configuration before parsing, and renderer leaves mount only bounded previews or the shared viewport-rendered source reader. CSS height and `overflow` are layout choices, never content-performance boundaries. Shared helpers in `src/shared/content-budget.ts` implement byte/line/preview/tail mechanics without choosing feature policy.
- Dynamic tools are selected by `(namespace, durable toolset revision, tool)`, never by tool name alone. A model cannot choose its parser or hot-upgrade an existing task. `nodex_app` arguments never carry Project identity or raw storage revisions; main derives scope from the verified task binding. Digest-only operation ETags and self-contained pagination cursors are separate HMAC domains and never grant authority.
- Dynamic writes authorize semantic effects, not raw arguments. Canonical preflight is mutation-free; after consent the Adapter re-resolves current authority and compares effect class, target resources, deletions, and ownership transformations with the approved footprint before executing the fresh exact command. Incidental heads and rank keys may change; expanded scope cannot reuse old consent. The owning Core Module remains the sole execution authority. Renderer ownership is proof of where to present a decision, not permission state. Ordinary grants live only in main and destructive effects always require a fresh occurrence.
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
- Canonical Codex turns keep an explicit `lifecycleStatusByItemId` sidecar for protocol items whose generated shape has no status field, including reasoning, agent messages, and plans. `item/started` and `item/completed` are the lifecycle facts; duplicate or delayed starts cannot reopen a terminal occurrence. The sidecar is part of the owner snapshot/revision document, so owner, follower, hydration, and recovery projections use the same item lifecycle instead of sibling-position heuristics.
- Local conversation renders live activity as a pure turn-level projection over canonical items. Reasoning summaries remain hidden from ordinary activity leaves but independently project into a render-time fallback or the latest activity-group header; active patch/command labels, file-change bodies, turn diffs, and Review affordances remain separate concerns. A standalone fallback is a React render branch, never a synthetic canonical/bucket/search item, and every activity family uses the same current-input render path.
- TanStack Query owns only low-frequency renderer server state: project lists, project-session summaries/details, board snapshots used outside optimistic board editing, server-backed settings, Git branch snapshots, local-environment config reads, MCP status/resources, and workspace file/directory reads. The Page timeline performs explicit cursor paging because its source-specific cursor is part of the durable history contract. High-frequency or optimistic state stays in dedicated owners: `kanban-store`, mounted content-engine surfaces, the local-conversation app-server manager, terminals, browser/webview lifecycle, drafts, and localStorage-only preferences.
- Main-process local-thread streaming accepts revisioned renderer-owner documents and broadcasts their Immer-compatible `threadStreamStateChanged` snapshots or patches to followers. No-owner lifecycle paths may update a dormant recovery cache, but main never emits a source-null conversation stream; a visible renderer must resume/adopt or attach to an existing owner's accepted document. Snapshots carry `revision`; patches carry `baseRevision` and `revision`; followers drop changes from the wrong owner, wrong base, or missing follower role. Main validates owner publication and treats its accepted copy as a repairable shared document, not a second transcript writer. An owner ignores stream publish echoes. Assistant, plan, reasoning, lifecycle, request, file-change, and output updates are reduced by the renderer owner; asynchronous transport results such as post-resume goal hydration are converted to owner-routed notifications rather than main-authored snapshots. Main retains only transport plumbing and silent recovery/read-model caches. The renderer routes ordinary state-changing actions through one owner/follower/resume authority gate, automatically materializes canonical action mutations into the visible projection, and publishes through a per-conversation outbox whose cursor tracks the last accepted shared document/revision, coalesces in-flight mutations, and repairs rejected patches with a full shared-document snapshot. Renderer-private presentation overlays are stripped before diff or publication. Owner visibility and start/steer RPC dispatch never wait for publication; only resume, complete-history replacement, rollback, and repair use snapshot barriers. Start and steer compile one prepared input and client identity that flow unchanged through optimistic mutation, transport, retry, and reconciliation. Owner-routed requests remain pending JSON-RPC broker entries in main until an owner handles them; command-only automation can therefore run without conversation ownership and replay pending requests after later adoption. Request delivery is idempotent for each semantic request occurrence and renderer owner, while owner replacement permits unresolved requests to replay to the new owner. Main assigns stable renderer client ids for ownership, follower routing, heartbeat leases, and owner-loss recovery. Hidden owners are cleanup candidates only when they have no active view, active runtime, in-progress turn, or pending request. Complete-history loads and edit rollback remain owner-published snapshots; ordinary interaction uses owner patches.
- Renderer resume adoption is an authenticated IPC transaction. Main derives the stable client ID from the invoking `webContents`. If no owner exists, main hydrates, seeds the accepted document/revision, compare-and-sets the caller as owner, and returns an owner result before publication is enabled. If another owner exists, main returns that owner's accepted document/revision/client id as a follower result without issuing another app-server resume. Failed resumes and competing callers never replace ownership.
- Fresh-thread adoption is a distinct authenticated IPC transaction. Its single-use launch ticket binds the new thread, initiating renderer, exact canonical first-turn parameters, and client user-message identity. Main reserves follower routing and notification buffering before returning the owner seed; only that owner may consume the ticket for `turn/start`, and a fresh thread never enters the existing-thread `thread/resume` path.
- Prose streaming lifecycle ordering is a render-boundary invariant, not just a queue-flush invariant. Owner assistant/plan/reasoning queues use Nodex's `drainBefore(...)` shape: hidden/no-rAF or <=24-character terminal buffers flush synchronously and return `false`, larger visible terminal buffers drain across at most eight rAF frames and run the lifecycle callback immediately after the final flush. Because React can batch an external-store text flush with the following completed lifecycle update, renderer conversation notifications use a narrowly scoped synchronous commit for terminal prose flushes and follower in-progress prose patches. That keeps an `inProgress` Streamdown frame visible before `item/completed` / terminal `turn/*` state without adding a renderer-only fake streaming protocol.
- Turn diff, safety buffering, and hook lifecycle notifications mutate canonical turn sidecars before renderer projection. Hook occurrences retain stable local wrapper IDs for repeated protocol run IDs, and the renderer derives hook transcript rows without discarding hidden canonical item identities or advancing conversation timestamps.
- Turn-level app-local metadata rows are canonical synthetic items, not renderer-authored transcript state. Plan, model-reroute, and error notifications append opaque-ID occurrences; automatic approval reviews stable-upsert by review ID while preserving their first local start time; guardian interruption warnings append to the latest turn. Renderer ownership begins after these canonical transitions and is limited to projection, revision publication, effects, and ACKs.
- Runtime validation belongs at boundaries. Persisted storage, selected HTTP bodies, and raw JSON payload families should parse through `src/shared/schemas/*` or feature-local schema adapters; normalized in-memory reducers/view-models remain plain TypeScript once the boundary parse succeeds.
- Page lifecycle/import boundaries must pass shared Page limits; generic property
  and Document commands validate their own bounded typed contracts.
- Block/Page-domain writes must enter the owning Rust Core Module. Electron may
  bind trusted identity, request a surface-scoped causal flush when a command
  consumes local editor updates, and map typed results, but it must not open
  SQLite, reconstruct Yjs authority, or implement a fallback transaction.
  Project removal archives execution authority and
  revokes runtime access only; Library content remains.
- Agent-facing Project reads capture effective grant scope, content, and
  pagination authority in one Core read snapshot. Search access and
  lifecycle filters run before candidate limits; exact Document and Source
  evidence comes from the same snapshot. Search scores and numeric concurrency
  coordinates remain private.
- High-frequency renderer board state must use `BoardSummary`. `kanban-store` tracks per-Project fetch freshness and first subscription calls `ensureFreshBoard` instead of unconditional refetch; explicit refreshes, ambiguous realtime events, and mutation recovery may still force a summary fetch. Title/body summary fields come from current Document materializations. Full bodies belong to a mounted Document surface or an explicit scoped detail/export read, not `kanban-store`, Board/list/Calendar Views, or command-palette indexing.
- The renderer mounts one selected project-session task page and one selected tab body per panel leaf. Task and tab switches dispose their React views; scoped Maitai atoms restore renderer presentation, while Query, Codex conversation execution, Browser, Terminal, and collaborative Documents keep authority in their deeper Modules. Only the selected route may register global header actions, panel measurements, Browser visibility, or thread view-active state.
- Recurrence exceptions and reminder receipts are Page/Library-scoped and
  persisted in SQLite; Project is evaluated access context.
- Every occurrence complete/skip/update request carries a caller-generated logical `operationId`. Complete and clone-capable update scopes also carry a preallocated UUID-v7 `createdPageId` as semantic intent. The semantic hash excludes transport actor/session, so window/process restart replays the first committed or rejected result. Reusing the operation ID with another Page, created Page identity, occurrence, scope, update, or command kind is a typed collision.
- Completing an occurrence creates an archived Page whose status is `ship`; archived Pages stay out of board/sidebar/toggle-list flows but still surface in calendar occurrence queries.
- Status and manual View movement are Database operations with exact property/View revisions and logical anchors; stale intent fails as one typed conflict.
- Metadata concurrency is field/path scoped. Scalar Block/Database properties compare their own revision, set-like values preserve add/remove intent, and a stale claim returns a typed conflict without mutating unrelated fields. Title/body concurrency is Yjs-based and never uses a whole-Page revision.
- Library-scoped Block, Document, Database, projection, and history evidence is
  isolated by `library_id`. Projects never move content between ownership
  scopes; binding and grants alter access.
- Renderer never accesses SQLite directly.
- Custom editor behavior must preserve NFM round-trip fidelity.
- Codex threads are session-owned locally. Durable chat ownership is represented by the one-to-one `project_session_threads` relation; Project-bound sessions have `project_id`, projectless sessions use `project_id = null`, and Pages can mention or reference threads but do not own them.
- Sidebar thread discovery is global and app-server-led. `codex:sidebar:snapshot` is a bounded SQLite overview for cold-start rendering, while `codex:sidebar:sync` processes one foreground discovery window and schedules the single-flight background sweep. Project folders own independent Core task windows rather than slicing a global Thread array.
- Global thread pin authority lives in `codex_pinned_threads`. `project_sessions.pinned` may mirror pin state for compatibility but must not be used as the primary authority for attached Codex sidebar rows.
- Sidebar projection treats project membership and pin state as orthogonal coordinates. `pinned`/`chats` are the projectless lanes, while `project-pinned:<projectId>`/`project:<projectId>` are the project-owned lanes. A project folder target preserves the source pin lane; an explicit cross-lane drop changes pin state, and a cross-project pinned-lane drop changes ownership without unpinning.
- Sidebar manual order is durable relational lane state, not project-session layout state. A regular lane begins in recency mode; its first manual move materializes stable rank positions, new Threads enter at the head, and later moves update only local rank neighborhoods. Cross-Project moves atomically commit thread/session ownership with every affected lane revision. The per-project pinned lane is projected separately from global pin order; pin/unpin therefore changes lanes without deleting the thread's project manual identity.
- Attached project sessions must never use `project_sessions.no_thread_fallback_title` as the primary chat title. Codex thread title authority is app-server metadata, reflected locally through `codex_threads.thread_name`; project sessions expose only a derived `displayTitle` for shell rendering.
- Session-created threads must not create hidden Pages or Page-thread ownership links.
- Each Window Session Scene panel layout normalizes to at least one leaf per right/bottom panel. Local surface IDs occur in exactly one leaf, unknown IDs are removed, unplaced descriptors are repaired into the active right leaf, non-final empty leaves are pruned unless a visible transient surface preserves them, active/MRU identities resolve to valid fallbacks, sizes and split ratios are bounded, and panel-tree depth-first order is the only placement/order source.
- Scene panel surface drag-and-drop separates tab-row insertion from body split targets: tab-row drops render a non-layout-shifting insertion marker and commit leaf-scoped reorder/move operations, while body drops use a 10% edge threshold for split previews and center drops for group merge.
- Side-chat threads are ephemeral manager/cache records only. They must not create durable Codex thread links, session thread links, project thread-list entries, project-session tab rows, archive records, or cold-start restore targets.
- Codex thread creation is session-first and includes immediate first-turn submission for durable thread materialization.
- Codex thread/turn cwd must use the linked thread cwd when present (not only the project primary-source fallback).
- Thread-title generation is main-owned for session thread starts: after the app-server returns the new thread id, main builds a text-only first-prompt title prompt, runs the fixed structured helper, applies the title locally, and persists through `thread/name/set`. Auto-title failures stay log-only; generated titles follow the fixed 36-character structured title schema, while manual rename remains the only 60-character title sanitizer.
- The active workbench conversation stage is now conversation-native: `features/local-conversation` consumes `CodexConversationSnapshot` turns/items directly, then derives an ordered per-turn item stream, semantic render buckets, blocked-turn state, search units, and collapse state in the renderer.
- Canonical dynamic-tool projection must retain the app-server arguments, output items, success, duration, and exact raw item for every visible call. Transcript presentation is a renderer projection over that canonical state: the shared inspector owns formatted details/raw access, while the `nodex_app` metadata projector owns compact intent labels and bounded Nested Markdown change previews without changing execution data or inventing missing before-state. The projector dual-reads v2 and v3, but new authorization and presentation values use `markdownPreview`/`markdownChange` only.
- The active workbench conversation stage must stay local-conversation-owned end-to-end: active shell, composer, thread-body helpers, request cards, and thread-item renderers have no secondary workbench thread renderer path.
- The Diff stage has its own review data plane. Transcript diff cards (`turn.diff`, tool-call patch previews) remain local-conversation surfaces; workbench review sources (`last-turn`, `unstaged`, `staged`, `branch`, `commit`, and PR descriptors) are owned by `review-diff-panel` plus main-process Git/GitHub review IPC, including metadata snapshots, per-file diff loading, search, cancellation, read-only full-patch export, patch application, blame, repository init, full-file-content reads, and typed PR disabled/error states.
- Projectless Codex conversations keep activity summaries separate from Review capability. The shared turn-diff policy scopes unified diffs and patch batches to the persisted `projectlessOutputDirectory`, suppresses a duplicate turn card when end resources already cover the same paths, and creates no turn-level Review affordance when no in-scope change remains. A surviving affordance opens a session-owned Review surface; generic projectless panel choosers still omit Review, while project and session ownership are explicit in the Review surface configuration.
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
- Codex worktree/local-environment execution requires a project primary source; plain local thread starts for empty-source projects allocate a generated per-thread workspace.

## Cross-Cutting Concerns

### Reliability
- WAL mode + transactional writes for consistency.
- Whole-store backups include DB and asset files from one quiesced maintenance boundary; restore is journaled across both filesystem roots and rotates the collaboration epoch.
- Renderer event streams use Electron IPC; Core event streams reconnect over the authenticated Profile-private UDS.
- Codex runtime has startup gating (`initialize`/`initialized`), connection-state surfacing, and restart/backoff handling.

### Security
- Renderer runs behind preload bridge; no direct Node API access in app code.
- Privileged asset/dictation IPC validates the owned top-level renderer sender and bounded inputs; managed image URLs are raster-only and default-session-only.
- Browser guests use one fixed sandboxed preload, no Node integration, no nested
  webviews or caller-selected preload/preferences, and a Main-forced persistent
  Profile. Browser IPC and guest messages validate the top-level owner, complete
  route identity, storage identity, and current generations. Navigation,
  permission, popup, download, credential, annotation, and CDP policies are
  independently enforced at their Main-owned boundary.
- Arbitrary SQL inspection is not exposed through IPC or the
  public CLI; diagnostic reads use typed Core Module contracts.
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
- Backend services can emit structured logs (JSON lines) with child-scoped context for native Core requests, integrated terminal, backup/reminder, and Codex runtime flows.
- Backend logs persist under `${NODEX_HOME}/logs` for dev/unpackaged runs or explicitly enabled packaged diagnostics, with bounded serialization and sensitive-field redaction for debugging without dumping raw secrets.
- Renderer telemetry can emit opt-in Statsig product events through a central helper. Statsig loads only when enabled, uses anonymous Stable ID identity, flushes on app close, and keeps web analytics behind a separate filtered AutoCapture opt-in.
- Detailed logging reference: `docs/product-specs/backend-logging-spec.md`.
- Editor subsystems include focused tests for parser, keyboard behavior, and sync edge cases.

## Build and distribution boundary

The repository-owned Release Module under `scripts/release/` owns Release
Identity, release-source transition validation, per-architecture manifests,
Release Bundle assembly, GitHub publication state, Browser-runtime Latest
protection, and Homebrew projection. GitHub workflows are thin Adapters over
that Interface; YAML does not independently infer versions, merge updater
metadata, or decide which files are publishable.

The prepared Electron build and packaged-provenance Modules remain deeper,
independent implementations. Prepared build binds the clean source snapshot and
compiled Electron outputs. Package provenance binds the final `app.asar`, the
signed Sparkle framework/addon/runtime configuration, and native/Agent/Browser
manifests after signing. The
Release Module consumes those identities and adds source/tree, runtime-lock,
architecture, runner/toolchain, and public-artifact evidence. This Locality
keeps source correctness, package correctness, and publication correctness
separate while making their promotion seam machine-readable.

Production Distribution runs on native arm64 and x64 hosted macOS runners. It
does not cross-compile a second architecture as release evidence. Each signed,
notarized App is archived as Sparkle's full-update ZIP, extracted, launched,
and subjected once to the stateful
packaged runtime smoke. The DMG is mounted for structural verification and
checked against the same version, bundle ID, TeamIdentifier, and sealed package
provenance instead of repeating that smoke. A protected macOS finalizer uses
the pinned Sparkle tools to sign one architecture-specific appcast, generate
and round-trip applicable deltas against verified historical ZIPs, and emit a
closed update manifest. Only a matching pair reaches Linux assembly. The
stable annotated tag is created after assembly, then an immutable GitHub
Release is published and byte-verified before the Homebrew and Pages Adapters
run. GitHub Release is the immutable update data plane; Pages exposes only the
two signed stable appcast projections.

`CI / required` is the stable repository-protection Interface. Its internal
jobs may vary by change class, but release metadata always selects the app and
runtime gates. A protected-main successful CI `workflow_run`, not an untrusted
PR event or a tag push, is the only normal production trigger.

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

The Codex live-turn boundary has one shared reasoning-summary policy in
`src/shared/codex-reasoning-summary-policy.ts`. Every user-visible `turn/start`
path — ordinary follow-up, session first turn, dynamic first turn, and goal
continuation — resolves that policy before sending the request. The
`concurrent_reasoning_summaries` capability, request `summary`, canonical
optimistic params, and persisted thread settings use the same result so owner
and follower projections cannot diverge. `workedFor` is an independent
elapsed-time presentation row and never suppresses live reasoning activity.
