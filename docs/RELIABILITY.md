# Reliability

## Local commit apply/replay contract

Core atomically persists canonical writes, private physical evidence, one
immutable `CommitManifest`, per-scope Projection revisions, and the Module
receipt. A successful apply response returns the command outcome even when the
caller has no post-state read capability; its optional
`AuthorizedDeliveryPacket` is independently resolved after commit. The
initiating renderer admits that packet immediately and never waits for SSE,
projection reads, renderer acknowledgement, or a future network acknowledgement.

Manifest identity is `(store_epoch, commit_seq, manifest_hash)`. Recipient,
inline/ref mode, retry count, and packet hash are outside that identity, so an
apply packet and a later stream packet may have complementary coverage. Main's
dispatcher applies new coverage as enrichment and treats already-covered
resources as duplicates. A different Manifest hash at the same durable
coordinate fails closed. Document update bytes never appear in an authorized
Module payload; they are available only through a `DocumentEffectRef` with an
optional, hash- and length-verified inline resource.

The global durable stream and scoped projection broker scan the SQLite ledger
through one private `CommitWakeScanner` after installing their wake receivers.
Broadcast carries an opaque zero-data wake and only triggers another keyset
scan; it is never a commit queue or cursor source. The scanner emits authorized
packets plus a checkpoint, and advances that checkpoint across sequence gaps
and commits filtered to zero packets. Wake loss is recovered by the next wake
or reconnect barrier, and receiver lag requests a scan rather than a repair.
A cursor older than `oldest_available_seq` returns a typed resync boundary with
generation and opaque token. Current exact
Document resource reads reauthorize and return typed unavailable reasons for a
missing, compacted, generation-changed, or hash-mismatched ref.

An exact Document subscription is also an authorization and resource-filtering
boundary, but has no replay cursor. Core installs its resource-addressed live
receiver before reading authorization, Store identity, engine, generation,
Document head, and LocalCommit head in one SQLite snapshot. The resulting
`DocumentLiveBarrier` means every later addressed commit is either buffered by
Main or delivered after canonical state-vector/scene synchronization adopts the
barrier. Earlier state comes from that canonical sync, never from scanning the
global ledger. Post-state packet resolution still applies the canonical
owned-Document read rules—including Canvas shells and granted host Pages—and
emits only effects, refs, and revocations for that exact Document.

The exact live publisher resolves immutable routing claims once per commit on
an ordered blocking worker and wakes only addressed Document channels. Apply
publication performs only bounded non-blocking enqueue work; routing,
authorization, packet reconstruction, and renderer delivery are not response
prerequisites. Unrelated commits therefore create no wakeup or cursor work per
open surface. Ephemeral Awareness uses a separate addressed per-Document
channel, so presence bursts cannot crowd the commit/repair lane. Receiver lag,
route/payload failure, and Store replacement are typed repair boundaries that
close the physical stream and force a fresh barrier plus canonical sync. A
post-state access revocation is delivered through the same exact-resource
boundary even when the commit has no semantic effects. Durable root scanning
and exact packet reconstruction run outside the async server reactor, so a
large mutation cannot starve handshake or UDS scheduling.

Once a command's durable identity is verified, Core publishes its at-least-once
wake before reconstructing optional apply delivery. A post-commit response
failure therefore remains recoverable without waiting for another mutation;
an exact retry republishes the same identity and downstream resource admission
deduplicates it.

Document/Canvas realtime heads are ordered independently per surface. A future
head is retained in a bounded gap buffer until its predecessor arrives; an
overflow or epoch mismatch emits a resync boundary. This protects Yjs and scene
state without making unrelated Library projection work part of the apply
response latency.

Document ref metadata remains durable even when operational compaction has
removed the binary update bytes. Replay then emits a typed
`document_resync_required` effect with the Document generation/head and the
verified update identity/hash; Main maps it to a `history-compacted` resync
instead of treating the committed mutation as missing or fabricating an empty
update. A fresh canonical snapshot/state-vector sync repairs that surface. The
apply fast path can still carry the update bytes before compaction, while the
durable ledger and compact receipt retain only the ref/metadata needed for
recovery.

Structural Block commands carry typed causal Document head tokens when a local
surface is mounted. The surface flushes pending Yjs updates, Core verifies the
token again in the same writer transaction, and a mismatch returns a retryable
revision conflict. The token is deliberately excluded from the idempotent
intent hash, so response-loss recovery does not create a new logical command.

Every canonical Module read derives its Store epoch, finalized LocalCommit
head, nested snapshot coordinates, and projected values from one SQLite read
transaction. Public `commit_head`, `commit_seq`, `covered_commit_seq`, and
collection freshness authorities therefore share the LocalCommit coordinate
space even when the private `change_log.seq` has allocation gaps or several
physical effects belong to one semantic commit. The change-log sequence may
bound historical evidence queries, but it never crosses a Module, Main, or
renderer freshness boundary and is never accepted as a causal read floor.

Heavy cross-Document transfer, promotion, copy, and Agent Page batches prepare
against isolated clones of immutable cached Document bases on read connections.
The writer revalidates every captured head, owner revision, membership, and
authorization fact before applying the prepared result. A batch advances each
Document head at most once. In-Project registry relocation updates the complete
captured closure in one set operation and does not rewrite an unchanged Project
key; cross-Project relocation is protected by exact foreign-key child indexes.
CAS failure discards the working clone and leaves cache and canonical state
unchanged.

Main's Document delivery lanes are keyed by one Document ID, never by a composite
set of Documents. Two commits sharing any Document therefore serialize for that
Document, while another Document from the same multi-Document commit can proceed
independently. Apply and tailer packet coverage use separate Document-control
and notification claims, so a failed Document delivery can be replayed without
depending on notification delivery state.

The v102-v110 cutover is durable, not a renderer-only cache change. v102 adds
the LocalCommit ledger, effect/document impact rows, and receipt linkage; v103
rebuilds those tables with composite `(store_epoch, commit_seq)` foreign-key
boundaries; v104 adds canonical evidence hashing; v105 records the complete
effect/projection envelope shape; and v106 persists immutable Manifests plus
per-scope Projection heads without adding a second authority. v107 adds exact
child-key indexes for the Block Project-key cascades exercised by ownership
relocation. v108 persists scoped resource revocations as immutable LocalCommit
evidence and covers each delivery authorization scope in the packet hash. v109
adds resource-atomic DeliveryAtoms, authorization-complete Projection
audiences, opaque Relation edge identity, and a sealed transaction-owned
DurableMutation finalization boundary.
v110 installs authority-table dirty-fact triggers and a transaction-owned
visibility journal. The journal reconstructs the pre-mutation graph by reverse
fact replay, compares it with current authorization, and seals exact gain/loss
evidence plus explicit private Projection requirements. Authority DML without
an active mutation or explicit maintenance context fails closed; LocalCommit
seal rejects unconsumed or noncanonical visibility evidence. Triggers ignore
unchanged watched values and non-authority Block types. A root born and moved
through multiple states in one commit has an empty pre-set without schema
replay; any pre-existing root still requires the reverse overlay.
Receipts persist a compact command result and commit identity rather
than duplicating large Yjs updates; Core resolves authorized delivery from the
ledger after commit. Projection gaps and unavailable patches remain visible to
the exact-scope causal runtime and are repaired with coalesced canonical reads.
All LocalCommit parent/child reads use the complete Store coordinate, and one
verified load supplies the Manifest, physical evidence, and canonical Document
effects to authorization and delivery. An older Store installs the final target
schema before historical artifacts are compiled, so each retained commit is
enriched and finalized exactly once in the atomic upgrade rather than once per
intermediate version. Verification binds the stored physical payload bytes to
their effect digest. Historical Document effects are enriched from durable
update receipts, so normal update-byte compaction does not erase their causal
base/result heads or integrity evidence.

Core validates complete physical-event coverage and finalized LocalCommit
history once while preparing the exclusive Store. Runtime stream pages use
indexed `(store_epoch, commit_seq)` boundaries and keyset ranges; replay cost is
bounded by the requested page and its authorized resources, rather than by all
history retained before the cursor.

## Relation authority

Store v109 and later retain Relation targets only in normalized edge authority and give every edge a Core-authored 256-bit opaque identity. Adding an edge requires source write plus current target read. Incremental removal accepts only the source-owned edge identity and validates its source membership/Property scope without requiring continuing target read; clear-all uses the value revision. Relation headers retain revision and JSON `null`; triggers and readiness validation reject incomplete definitions, invalid targets, and header/edge divergence. Complete values are capped at 10,000 targets, patches at 100 identities, full target/candidate windows at 100 items, and row previews at the first three visible items with exact total/restricted counts. The shared SQL projection returns one row per selected Relation value and hydrates at most three visible targets; hidden target identities are absent from its rowset. Signed target continuations contain only ordinal coordinates and a constant marker. Selected-target windows may return a generic restricted row with only the source-owned edge handle so it can be removed; they never return the target Page ID, title, Document, parent, or Data Source metadata. Candidate search is scoped directly to the configured target Data Source and paged independently of its Views. Copy preserves outbound targets with newly allocated edge identities. External inbound edges retain target Pages and target Data Sources; edges whose source is inside the same deletion closure do not retain that closure. Projection impact follows inbound edges for one hop and falls back to global invalidation when the existing identity budget is exceeded.

## Reliability Goals
- Maintain durable local task state across app restarts.
- Keep board views synchronized across Electron and browser clients.
- Keep every mounted view of a Page converged on its one durable Y.Doc without whole-Page overwrite.
- Keep Codex thread state synchronized across the active renderer owner, the main-process content-addressed recovery/relay replica, bootstrap-only app-server rollout recovery input, Core Workspace metadata, and checkpoint-acknowledged follower views.
- Keep Review repository metadata, partial diffs, full context, and search on one repository generation without letting stale work replace a newer edit.
- Provide safe recovery paths for destructive operations.

## Data Durability Model
- Electron fixes exactly one Profile data authority at bootstrap: native Rust
  Core. The JavaScript SQLite/Yjs authority and runtime selector are absent; the
  frozen legacy migrator is an import-only staging converter and the final
  TypeScript v84 artifact is import/conformance evidence. The accompanying
  launcher executes the validated candidate selector first, then starts or
  reuses only the exact generation returned by its bounded selection result.
  Compatibility covers transport, committed event, every semantic Module,
  exact Store format, and the launcher's artifact-freshness policy. Electron
  waits for an authenticated full-generation handshake before Adapter
  initialization. The Profile/Library/Store epoch authority cannot change
  inside an Electron process. Its Core process generation may change: Desktop
  adapters retain a stable authority facade which re-runs the single-winner
  selector after definitive transport loss and adopts only a ready generation
  with the same authority identity. Initial launch/readiness failure remains
  terminal rather than an implicit fallback or second writer.
- A live Electron Host connection and its authenticated global event stream are
  explicit Core demand and prevent idle exit. Core can still drain after the
  Host and all other clients, streams, prepared operations, Store work, and due
  Automation demand disappear. Electron sends no heartbeat and does not disable
  the bounded idle policy.
- Electron allocates one logical Core connection ID at Desktop authority
  initialization and reuses it for every handshake during that Main-process
  lifetime. Rebinding to the same Core generation refreshes one authenticated
  registry record instead of consuming another client slot; independent CLI and
  test clients continue to mint independent identities. The logical connection
  is transient authentication state and never participates in durable receipt
  identity.
- Cross-generation recovery is single-flight. Stable root and Project facades,
  the Projection router, global event cursor, Document/Canvas logical
  subscriptions, and background schedulers survive the swap. Reads and writes
  carrying stable idempotency identities are retried exactly once with the
  original input; ephemeral Awareness publications trigger recovery but are
  not replayed. Core receipt fingerprints exclude transient connection IDs and
  retain Profile, Library, Project, adapter, contract, Store epoch, and intent
  identity, so a committed operation replays after reconnect without allowing a
  different operation to reuse its key. Durable Yjs update and recovery evidence
  records the renderer's logical client-session ID rather than its physical Core
  connection, so response loss followed by reauthentication remains an exact
  retry while another logical editor cannot reuse that update ID.
- While authority is recovering or circuit-open, Host backup, maintenance,
  reminder, and scheduled-Automation producers retain their timers and local
  state but do not claim or start new Core work. Admission is checked again
  after every asynchronous initialization or claim step. If a reminder or
  scheduled-Automation claim arrives after authority changes, its lease is
  settled for a bounded retry without delivering a notification or starting a
  Codex run; backup retention likewise does not begin after backup creation
  loses authority. Producers resume from the same scheduler instances after
  authority is ready. One physical global-stream interruption publishes one
  reconnect resync and one warning until a new authenticated stream actually
  connects.
- `ENOENT`, `ECONNREFUSED`, `ECONNRESET`, `EPIPE`, and authenticated draining
  responses can initiate generation recovery. A request timeout alone is
  ambiguous and never proves that the SQLite writer disappeared. Three losses
  from three independently authenticated sessions inside one minute open a local
  circuit, even when every rebound reached the same process generation;
  concurrent errors from one session count once. The renderer shows one app-wide
  unavailable state with explicit Retry and Restart actions instead of letting
  each Module emit an independent error loop.
- Desktop recovery is lifecycle-epoch fenced. `close()` invalidates a selector
  or health check already in flight, preventing it from publishing `ready` or
  replaying after shutdown. A late failure from an older session joins an active
  recovery of the current session before choosing its replay target.
- Core writes a private, bounded lifecycle summary at
  `${NODEX_HOME}/run/core/lifecycle.json`. It distinguishes typed graceful drain
  reasons and completed stop outcomes from a generation later observed without
  a completed stop. The breadcrumb is diagnostic-only, contains no user content
  or transport secret, and fails independently from authority startup.
- The cutover gate runs inside the Electron runtime, opens a disposable Profile
  through Core, exercises a Project-bound Module client, and inspects Electron's
  file-descriptor table to prove it holds no `nodex.db`, `nodex.db-wal`, or
  `nodex.db-shm` handle. Production dependency audits also reject any
  JavaScript SQLite/Yjs authority in the bootstrap graph.
- Core runs SQLite in WAL mode for resilient write/read behavior.
- SQLite schema version state is tracked in `PRAGMA user_version`.
- The final TypeScript handoff schema is exactly v84 and the current Rust-owned
  Store is v109. Core accepts only the complete normalized frozen inventories
  for v26, both v57 variants, v68, v82, and v83 as older sources. It snapshots
  the source database and assets, advances only a staging copy through the
  hash-pinned migrator to exact v84, reconstructs ready Yjs Documents through
  Yrs, rebuilds derived projections, and atomically publishes v109. Direct v84
  imports and exact Rust-owned v85 through v108 stores follow the same durable
  backup, validation, and forward-upgrade boundary. v102 introduced the
  LocalCommit ledger, v103 its composite Store identity, v104 canonical
  physical evidence hashing, v105 immutable Manifest/authorized packet
  separation, v106 per-scope Projection heads, v107 exact child-key indexes
  for Block Project-key cascades, v108 immutable scoped revocations, and v109
  resource-atomic delivery, complete Projection audiences, opaque Relation
  edge identities, and sealed DurableMutation finalization. Unfrozen same-version lineages, drifted
  inventories, ambiguous owners, and future versions fail closed. Reopening
  v109 validates the exact physical inventory and all semantic authority
  invariants without silently repairing damage.
- Schema v64-v66 add the Agent dynamic-tool durability plane: each launched task retains its namespace/toolset catalog, one store-local signing key authenticates separately domain-bound short ETags and self-contained cursors across restarts, and content-free call receipts bind thread/call identity, request semantics, deterministic allocations, canonical mutation identity, and compact replay results. Restoring or replacing the store changes the epoch, so validators, cursors, and task grants from the old authority fail closed.
- Production startup imports only the exact frozen v26, either frozen v57, v68, v82, or v83 source; all other pre-v84 stores are rejected. The historical TypeScript chain is frozen into one bundled sidecar and runs only on the backed-up staging copy. Core never opens that converter as the live authority and never repairs a near-match. Its output must match the complete frozen v84 physical inventory exactly, including trigger/index SQL and absence of Thread-search shadow objects, before native semantic validation and publication can begin.
- A native forward migration publishes one validated, content-addressed source
  backup before changing authority. A retry reuses it before copying only when
  the complete append-only LocalCommit source identity—Store epoch, ledger
  head/hash, and covered durable counts—still matches. Older sources without
  that proof still deduplicate to the same digest after a copy. Every backup
  ancestor must be a real directory, never a symlink. Core emits a bounded
  monotonic count only while rebuilding retained history and emits a low-rate
  heartbeat during otherwise silent migration work; Main displays only the
  real percentage and switches to workspace opening on `store_ready`. Valid
  startup events extend a sliding inactivity deadline, while an independent
  hard deadline remains
  finite and the post-selection handshake receives a fresh deadline. Before
  connection succeeds the launcher owns the candidate process group and
  terminates and awaits it on cancellation, timeout, malformed output, artifact
  mismatch, or handshake failure. App shutdown also aborts and awaits in-flight
  startup/recovery; only an authenticated connected Core may remain detached.
- Schema v67 turns `document_versions` into the semantic Document Revision ledger. New BlockTree revisions retain stable-ID BlockTree plus rich title rather than complete causal Yjs history; detail reads rederive NFM and other projections through the registered schema adapter. Legacy Yjs and Canvas revision bytes remain immutable and readable. Human edits durably record dirty revision sessions with a pre-burst safety revision, ten-minute active capture, two-minute idle finalization, startup retry, and forced shutdown finalization through the one mutation writer. A failed revision-maintenance pass never invalidates the already durable edit ACK and remains retryable from session state.
- Core startup validates current v109 authority and projections but performs no
  semantic content repair. Timestamp and content rewrites occur only in their
  explicit forward migrations. Once v109 is published, any ownership, receipt,
  Document, Projection, LocalCommit evidence, canonical timestamp, Scene, or
  physical-inventory drift blocks readiness with bounded diagnostics. Recovery
  uses an explicit validated backup or a forward semantic operation.
- SQLite file reclamation runs with `PRAGMA auto_vacuum = INCREMENTAL`; retention maintenance may reclaim free pages incrementally instead of forcing a blocking full rewrite.
- Removing a Project is a recoverable archive of the execution context and its Database binding through the Core Workspace/Library transaction; it does not delete, retire, or reset source files, Library Blocks, or Documents. The main process fails closed if it cannot inspect Project-owned runtime work, and a shared per-Project admission gate serializes the final blocker preflight/Core commit with new Codex and Terminal starts. Active turns, pending requests, live terminals, and running background processes block removal. Archived Projects disappear from ordinary Project and sidebar projections, keep historical Sessions and Threads readable, reject new execution and ordinary mutations in Core, and may be explicitly restored under current authorization. Browser ownership and already-exited Terminal snapshots are cleaned up best-effort only after the durable archive commits; cleanup failure never reverses the archive and is safe to retry. Physical Page/Database tombstone collection remains a separate Library retention operation. Direct deletion of a Document owner or owned Document is restricted.
- Project resource authorization is evaluated from current Library ownership on every read/write. A Project's bound Database grants implicit recursive read-write access; explicit recursive Page/Database grants follow ownership edges only and never follow `pageRef`, relation, backlink, linked View, or ordinary link edges. Main-owned one-call/task consent overlays can temporarily cover only canonical same-Library resource roots and never become persistent grants. Project archive/deactivation changes execution access but never deletes Library content.
- Full-access Turn authority is persisted immutably by exact `(thread_id, turn_id)` and is valid only while root Thread, actor Project, Profile Library, and store epoch still match. A separate mutable Project preset-selection row distinguishes Nodex's built-in selection from equivalent Custom config; each Turn snapshots only after main verifies that selection against effective Codex semantics. Notification-first and response-first Turn binding publish the same row. App-server background child initial Turns may inherit the exact parent authority captured at spawn; independent created tasks and later child Turns resolve separately. Historical committed Agent receipts without provenance may replay their already-committed result, while historical prepared receipts cannot continue.
- Every Canvas is a `scene_graph` Owned Document using the `canvas_scene` engine, not Yjs or a renderer-overwritten scene row; each Project merely seeds one deterministic primary Canvas as its default entry. SQLite normalizes current element, durable app-state, and managed-file authority; the writer merges bounded candidates by Excalidraw version/nonce plus canonical hash, requires explicit tombstones, advances the head only for effective change, and records compact exact-mutation evidence atomically with projections. Exact counters—including tombstone UTF-8 bytes—derived reference/text columns, sparse hash buckets, and a projection head keep warm writes and maintenance eligibility proportional to changed candidates rather than total scene size. The common Module receipt is the only retained replay result, and its Canvas semantic fingerprint excludes physical connection and adapter identity. A renderer shares one ref-counted provider/outbox session per Canvas Document while preserving surface-local interaction state. Images are materialized under SHA-256 filenames before enqueue; repeated logical file assertions compare canonical MIME, byte length, and verified digest, retain first-writer URI/time metadata, and reject only different content. Active outbox rows cross store-epoch/generation boundaries only by explicit reset. A deterministic Core rejection moves the exact row atomically into a bounded quarantine before full resync, while transport or ambiguous protocol failures retain the active row for exact retry. Subscribe-before-sync, semantic snapshot decoding, canonical delta fanout, and bounded full-scene repair close realtime gaps; Rust JSON bytes are validated as UTF-8/JSON/portable scene rather than being required to equal a JavaScript re-encoding. Remote presentation uses Excalidraw reconciliation with `CaptureUpdateAction.NEVER`. When the last fully committed surface closes, count or byte pressure may trigger invisible maintenance. The Host requires that surface to be the sole subscriber, uses the common write fence to pin a complete safety revision, and atomically publishes a tombstone-free next generation at head one. Offline, pending-outbox, concurrent-surface, and fence failures defer without blocking close. Exact replay precedes fresh fence checks; stale generation intent is cleared before it can replay. Missing, replaced, oversized, symlinked, or hash-mismatched assets fail the whole scene mutation, maintenance, or backup validation.
- Pointer, selection, and idle presence uses a Host-memory lane keyed to the exact Canvas subscription generation. Higher clocks replace, clean close removes immediately, 15-second heartbeats prevent 30-second TTL expiry, and reconnect receives a fresh snapshot. Presence never enters Core, SQLite, history, the change log, or the outbox; remote collaborator presentation also uses `CaptureUpdateAction.NEVER`.
- Ready Block Documents use binary Yjs updates in SQLite. The DocumentStore rejects stale store epochs and generations, deduplicates update IDs through immutable receipts, reconstructs from the latest snapshot plus tail, validates the Page roots/XML tree/global Block registry before commit, and acknowledges only after the immediate SQLite transaction advances the durable head and Block index together. A causally redundant Yjs replay is a successful duplicate ACK at the unchanged head and produces neither an update row nor fanout; monotonic CRDT state makes that no-op result stable without inventing a sequence receipt. Client-declared touched IDs are bounded diagnostics; the writer derives the authoritative title/Block change set from validated before/after content. An update with unresolved Yjs dependencies returns a typed retry error and is never appended as a poison tail.
- Electron IPC adapts Core's engine-specific Document contracts. A client subscribes before synchronization, and success means the first authenticated exact live barrier is open rather than merely scheduled. The Host keeps one logical subscription across retryable physical UDS interruptions, opens a fresh barrier instead of replaying an exact cursor, and holds dependent commands behind the current connection boundary. The bridge does not expose post-barrier bytes as current authority until canonical sync adopts the matching Store/generation/head; covered events are discarded and later contiguous heads drain in order. A terminal stream failure releases the exact renderer binding; replacement sessions wait for predecessor teardown. Renderer sessions are multiplexed by subscriber identity and serialize subscribe/unsubscribe, so an old disposer cannot close a revived provider. Yjs repairs with state vectors, while Canvas repairs a missing/out-of-order head with one bounded full canonical scene. Only durable effective changes fan out, and exact retries return their original receipt.
- Every new `change_log` row requires a normalized `ProjectionImpact` committed with its semantic mutation. Page Document commits include Page, Database, Data Source, every affected View, and the exact final Document head. Ordinary lifecycle, property, Database, Automation, and Project-creation mutations include their complete resource closure; modules with no canonical projection effect explicitly record `none`. Empty resources become `none`, and a legitimate effect beyond the fixed identity bound becomes `all` rather than being truncated. Visibility-changing moves, grants, and transfers also use identity-free `all`: Project filtering reads post-commit authorization and cannot safely reveal or name a resource the Project just lost. Event payloads contain no title, summary, property values, or Page DTO. Live publication and replay call the same row decoder, so commit-time coordinates survive later moves.
- Committed Core event version 8 is distinct from transport version 8 and from
  every semantic Module contract version. Apply responses and durable replay
  reference the same immutable Manifest but may carry different authorized
  packet coverage. Command authorization remains bound to the exact Project or
  resource scope. For the Electron Host, Core separately resolves the
  apply/response-loss-recovery delivery for an explicit Library-broker
  audience, matching the durable root stream without a second HTTP round trip
  and without erasing the command's Project context. Native CLI, test, Agent,
  and loopback adapters retain their exact bound delivery scope. The initiating
  renderer validates and admits its packet-v4 response before the feature
  Promise resolves. Main admits scoped-live and durable copies through
  `LocalCommitCoordinator`, validates identity and coverage, and deduplicates
  the later copy by authorization-scoped resource identity. Each Document,
  exact Projection scope, visibility delta, and notification lane orders
  independently. Main's audience broker accepts only logical addresses and
  installs Core-issued recipient leases from the live barrier; it cannot
  author an authorization scope. The recipient router requires a
  causal-ingress ACK and converts send/NACK/timeout/queue/reload failure into an
  actively retried lease-bound address reset rather than silent loss. A
  checkpoint records durable scan progress only; it is not awaited by the
  initiating renderer and cannot serialize unrelated resources. Retention gaps
  publish `event_gap` reset. An unexpected Core stream end reopens from the last
  accepted checkpoint. A transport/event/Store-epoch mismatch requires a fresh
  authenticated runtime binding.
- Core seals authorization change in the same LocalCommit as the ownership,
  lifecycle, or grant change. The trusted stream carries exact Grant/Revoke
  roots or a bounded `ConservativeReset` as Manifest-bound visibility evidence;
  apply, replay, and audience packets enter the same complete-packet admission
  path. Renderer ingress runs every matching revoke reducer synchronously
  before post-state content or repair I/O. A transport `AddressReset` has a
  separate lease/floor identity and cannot masquerade as semantic visibility.
  Authorization-bearing reads carry a same-snapshot Core stamp. Renderer
  freshness leases separate request-known identities from response-known
  authorization roots, then verify epoch, address, scope, hash, covered commit,
  address floor, and every exact root floor before adoption. Older in-flight
  reads retain relevant floors until completion or timeout. Active cache
  registrations retain their roots, and overflow fails closed at the address
  boundary instead of evicting the oldest floor.
  This prevents stale display or cache retention; it does not replace Core's
  authorization check on every subsequent read.
- Renderer Projection registrations are owned by semantic scope and consumer
  identity, never by a TanStack Query result object. Canonical refetches update
  callback-visible cache state without disconnecting the consumer or replaying
  its initial checkpoint. A consumer joining an already-live scope receives
  the latest stream position as a checkpoint, not a historical effect or
  revocation payload. Aggregate family cursors exclude disabled entries,
  including never-fetched sentinels; UI without a complete target creates no
  placeholder query inside that family. The renderer retains the last confirmed
  Library identity through a query-authority reset so its audience remains
  owned until the reset acknowledgement completes; a later canonical metadata
  read may replace that identity.
- Each renderer window has one renderer-lifetime LocalCommit ingress, while Main holds one multiplexed audience broker for its active Library/Project address set. Neither owner is tied to React Provider cleanup. Broker scope changes are make-before-break: the replacement barrier and Core recipient leases are accepted before the predecessor closes, and overlapping complete packets deduplicate by scoped resource identity. The broker retains the current lease and barrier floor while any recipient uses an address; a later WebContents for that same address receives the lease plus a floor reset before joining packet delivery. Quiet reset retries use one full-jitter timer with a 100 ms initial delay and 60-second cap, plus a hard budget of 20 attempts in any owned ten-minute retry window; disposal removes the timer, budget, and recipient. Exact consumers order by `(store_epoch, scope_key, schema_version, revision, effect_hash)`, never by the global stream cursor. Integrity claims intentionally omit recipient scope so audience divergence fails closed; delivery claims include the concrete Library/Project address so a Library packet cannot suppress a Project packet for the same effect. A Database-row patch is legal only when Core can prove that it is an exact reduction for the scoped bounded View: one active row in the primary unfiltered manual-order View with a persisted position. Filtered/custom-sorted/secondary, unpositioned, archived, and multi-row effects are patchless and converge through one `requires_read_at_least` floor read. Exact singleton reducers order the complete loaded row set by rank and rebuild sibling ordinals; they never compare one new ordinal with stale peer ordinals or inject a new row beyond a loaded continuation boundary. A patch is low-latency state, not proof that a committed overlay may retire; only a canonical bounded read supplies that proof. Group windows apply an upsert only inside the matching effective-group scope. Gaps, patchless effects, conservative visibility, address reset, or hash divergence coalesce into a canonical floor read; retry remains local to that exact address. Read floors carry both Store epoch and commit sequence: crossing to a new epoch returns replacement authority instead of waiting for an unreachable old sequence. Canonical snapshots cannot overwrite a newer coordinate. Database View groups and all group windows expose the same projection authority; mixed revisions are retried, and a continuation crossing a revision is discarded. Projection audiences use the pre/post authorization closure, so retained and newly authorized third-party Projects receive their own transition instead of waiting for a later canonical read. `board-changed` remains optional compatibility fanout and is never required for convergence.
- `BlockTransfer` is the single public stable-ID Move/Copy command for
  cross-surface Block ownership. Its intent uses logical
  `library | page | data_source` parents; `document` is permitted only for a
  registered non-Page Document. There is no public plan/write-fence round trip.
  Core prepares heavy Yrs work internally, revalidates current heads and
  authority in the writer, and commits content, ownership, membership,
  Projection effects, Document refs, event, and receipt in one transaction. The
  apply-response packet reaches open providers before the command waits on any
  stream work. Response-loss retry compares the logical intent with its
  immutable receipt, so it never depends on the obsolete source parent.
- Page, Database, and Canvas owner Blocks are lifecycle-only identities. Generic Yjs/BlockNote deletion, cut, paste replacement, duplication, or type conversion is rejected or routed to a typed command; nested Page/Canvas removal carries the containing Page Document head and commits the owner transition plus host-shell update atomically. A Page lifecycle tombstone recursively validates the indexed ownership closure and advances embedded Database container lifecycle/revisions alongside the Block, so no typed owner can remain active behind a deleted host Page. The initiating renderer admits the apply-response LocalCommit before its command returns, while scoped-live and durable delivery remain idempotent convergence paths. A stale host head fails closed as a causal conflict rather than leaving an orphaned owner or shell.
- The Synced Block ownership kernel reuses that fence/relocation substrate. Its writer-only contract requires one Host boundary for promotion and one exact host+source boundary for sole-instance demotion, rejecting partial/duplicate proofs. Inside that boundary Core removes the host reference, relocates every source root with stable application IDs, advances and materializes the source as an empty Y.Doc, moves the registry rows, and tombstones the hidden source resource in one transaction. Any stale/missing reference projection, changed source ownership, additional reference, or wrong store epoch fails closed. The Host-only coordinator acquires mounted-surface flush/freeze evidence; Core reprepares and commits through its serialized writer, publishes terminal heads, and exact retry cross-checks the immutable receipt/change evidence.
- Reusable Template kernels reuse the Yrs Document runtime, binary update log, projections, history, and relocation path. Canvas structure uses typed Library create/rename/move/duplicate/delete commands while content dispatches to normalized scene authority. New Canvas Block/Document identities remain UUID-v7; existing-owner fields additionally accept only the exact deterministic primary Canvas/Document forms. A Page destination includes exact generation/head, parent/anchor, and an optional empty-paragraph replacement; request-level Store epoch remains outside that destination, and renderer builders assign the destination's allowed fields explicitly so preparation metadata cannot leak through object spread. Core commits owner metadata, independent Document genesis/lifecycle, childless host shell, projections, event, and receipt together. Renderer transport retries an ambiguous result once with the exact same request and operation ID after flushing only the inputs that command consumes; local recovery checkpoints stay outside the structural barrier. The Host publishes receipt-carried Page commits through the same exact scope-aware Document-sync fanout as streamed Yjs events before acknowledging the command, while provider idempotence makes later replay harmless. The renderer may show an ephemeral pending decoration but never performs shell optimism. Canvas delete is different from content-sensitive create/move/duplicate: it sends owner location/metadata CAS directly and never waits on a scene provider or scene head. The single writer orders a final scene commit before deletion or rejects a later scene write after deletion. The command removes the shell and tombstones the owner without discarding its Document or immutable evidence. Inline and Stage Canvas surfaces mount `scene_graph` only through the scene provider. Renderer-local camera and frame preferences are Store-epoch scoped, bounded, and fail open to defaults when storage is absent or corrupt; Stage preference identity excludes disposable Tab IDs and performs a bounded, exact-coordinate migration from older Stage-only keys. Preferences never participate in content recovery or replay.
- An offline/stale update that overlaps a committed moved subtree never creates ghost content. The writer derives its actual touched IDs against the stored pre-relocation state: safe remaining edits may commit, while moved/opaque edits become durable recovery artifacts and return typed `block_relocated` / `recovery_required` boundaries that force reload instead of silent loss.
- The SQLite writer owns a count/encoded-byte bounded Y.Doc LRU for `block_tree`. Cache identity is store epoch, authority, generation, head, schema, and state vector; updates advance it only after durable commit. Exact update/snapshot blob hashes protect persisted bytes. An equivalent Y.Doc can encode to different full-update bytes, so Yjs Documents persist no full-state digest and never use re-encoded wire bytes as identity, authorization, or corruption evidence. Cold reconstruction instead requires a contiguous exact-blob-verified replay, dependency closure, schema/global identity, semantic state-vector equality, and exact agreement with the persisted materialization. Store v98 validates every live Yjs Document under that model before retiring legacy wire fingerprints. Yjs renderer checkpoints are disposable recovery data validated against the exact engine boundary. Canvas instead stores exact canonical mutation requests in an IndexedDB active outbox before transport; ACK removes them, response loss retries the same request with bounded exponential backoff and jitter, deterministic rejection quarantines one row, and epoch/generation rotation clears active rows so restore cannot be contaminated by stale scene intent.
- Page Stage prepares a grant-authorized owned descriptor through the writer before choosing an editor. Only a validated ready `yjs`/`block_tree` descriptor crosses the Page editor boundary; Canvas Stage and inline Canvas require `canvas_scene`/`scene_graph` and resolve the owned descriptor from public Canvas Block identity. Every active block-tree Document has at least one registered Block, with semantic blank represented by one stable-ID empty paragraph. A Page surface creates a fresh Y.Doc/client session for each visible effect incarnation and performs state-vector repair before exposing title/body roots.
- Renderer editing never seeds an existing Document from a row projection, serializes a whole body for autosave, applies an external `replaceBlocks` refresh, or offers a whole-Page conflict overwrite. Parent changes use logical `BlockTransfer`, and explicit whole-body import uses the generation/head-gated Document mutation.
- Same-window Database View/editor drag carries only a bounded versioned stable-ID logical-parent payload. It advertises `copyMove`, resolves Move by default and Option/Alt Copy from the current dragover/drop event, and uses the same resolver for cursor, indicator, accessibility label, and final Intent. Neither side performs optimistic deletion or serializes NFM/Page bodies. Text-like Blocks promote in place when moved into a Data Source; non-convertible Blocks wrap in a new Page; Data Source-to-editor Move inserts the same-ID Page shell while its body remains independently owned.
- Cross-window DnD is intentionally rejected. Kanban Card drags never publish native reference MIME, another renderer cannot satisfy the in-memory editor-source boundary, and cross-window content consistency remains owned by SQLite/Y.Doc synchronization.
- The Kanban element monitor is one stable subscription per Board instance. Selection, filtering, optimistic Board updates, and drag feedback may rerender the Board without cleaning up that subscription; Effect Events provide its callbacks with current state. A BlockTransfer editor target suppresses any ancestor column placement, so one gesture has exactly one semantic destination and one mutation owner.
- Canonical Page and Database View references read bounded summaries through Project-authorized IPC adapters; one multiplexed Board stream serves all reference queries for a Project context. Disclosure preference is disposable renderer state keyed by stable shell Block identity and never enters Y.Doc, NFM, history, backup, or undo. Collapsed rows own no provider; only effectively expanded and visible rows mount the target Page's independently prepared Y.Doc, with a small per-mounted-surface activation budget that protects the focused editor. Temporary target unavailability suppresses effective expansion without rewriting the preference. An inherited ancestry path blocks self and indirect cycles. Canonical reference Blocks are childless at the authority validator. Database View filter/sort/include-host rules execute over live membership rows before transport, while positions remain presentation state and visibility/provider activation remain ephemeral.
- Database View collections use signed keyset continuations bound to the Library, Store epoch, and View query fingerprint (which covers the View config and any group scope). A continuation stays valid while data mutates: the coordinate remains a well-defined seek point, and loaded windows converge through projection invalidation instead of cursor conflicts. Only an epoch rotation, a query-shape change, or a payload-version change rejects a cursor, and every consumer treats that rejection as disposable read state — it drops the cursor and silently re-reads its span from the first window. Core enforces both a 200-row maximum and a 1 MiB encoded-window budget; grouped Views additionally serve per-group scoped windows and a bounded per-group totals read whose counts derive from the same candidate predicate. The 16 MiB ordinary-response ceiling is only a transport fault boundary. Window rows contain exact-head title/preview and Database placement/value evidence but no NFM; one Page detail identity read is the only Database path that materializes its body.
- A multi-Page Kanban drag captures the primary Database descriptor and View query under one SQLite read cursor, compiles bounded `set_values` plus `position_pages` intent once, and retries only the exact request after transport uncertainty. The writer removes the selected run before resolving one external anchor and commits every value/rank/revision/receipt row together. A typed stale conflict refreshes the Board and exposes no partial movement; duplicate/lost-response replay produces no second fanout.
- Database management captures the complete catalog, all active Page summaries (including Library- or Page-parented Pages), each sole active membership, and current View positions under one SQLite cursor. Schema/View/value operations use the Database mutation contract; membership add/remove/transfer compiles to logical `BlockTransfer`. Public Database transports reject `transfer_membership`, preventing placement from bypassing the exclusive-parent transaction.

- The top-level Toggle List is a summary/reference view, not a multi-Page editor Document. Filter/search/sort and metadata display consume `DatabasePageSummary`; expanding one visible row opens only that Page's Y.Doc. It never batch-loads bodies or submits legacy title/description snapshots. A mounted row may use the same stable-ID `BlockTransfer` command as Page Stage; projected rows themselves are never draggable host children.
- Primary title/body edits are direct Yjs transactions. One renderer-level DocumentSession shares the Y.Doc/provider across authorized surfaces, while BlockNote tags each editor's y-prosemirror transactions with its `EditorSurfaceLease` origin; each UndoManager tracks only that token, so another local surface is treated like a remote collaborator. Awareness is aggregated by active surface and removing one lease cannot clear another. Whole-state IndexedDB checkpoint reads/writes are serialized and expose `idle|saving|ready|degraded|disabled` telemetry, but never participate in Core ACK or `flushAndFence()`. Structural mutations wait only for an exact Core store/generation/head fence and never freeze the editor or expose a structural pending projection. Authorized inline Document effects are hash/length verified; ref-only effects are reauthorized and coalesced per access scope, then verified against document/generation/base/head/id/hash/length. Missing or compacted refs trigger snapshot/state-vector resync, while integrity, identity, or access boundaries reset the DocumentSession. Normal fast ACKs are silent; delayed transport, offline, error, and reset states provide retry/reload affordances.
- A primary Document update commits its NFM/title/preview/reference/asset materialization, Page read model, and durable projection impact with the same head; a missing or mismatched Page projection or impact aborts the transaction instead of committing an unobservable head. The scoped stream invalidates every affected summary/detail reader after commit; consumers reread that exact projection and never route content through an event-carried summary DTO. A Host delivery failure replays from the previous cursor; a renderer callback failure remains local and later checkpoint/resync/canonical reads recover visibility.
- Document-derived search units and asset references refresh in that same Core transaction from the current materialization and Block index. A file/image Block may durably carry an empty source while its asynchronous upload is pending; that content state advances normally but contributes no asset-reference row until a later update supplies a non-empty source. Queries require matching generation and projected head, so stale rows are invisible; startup validates exact projection markers before renderer readiness, and explicit Document/Project rebuilds reproduce the same rows after compaction or recovery. Remote edits remove old terms/assets and publish new ones before ACK. Public Page search reads these current units and resolves lifecycle/status from relational Block/Database records.
- Native CLI ripgrep reads a lease whose complete Page set, canonical metadata/body bytes, ownership coordinates, and revision evidence are captured in one SQLite reader transaction. An exact-head gap fails strictly with `materialization_stale`; non-strict internal callers receive typed skipped-Page warnings instead of mixed generations. Each projection file has an independently validated content-addressed cache entry, so metadata-only and body-only changes reuse the unaffected bytes and a corrupt cache object is rebuilt before lease publication. Lease files are same-filesystem read-only hard links to those immutable objects. After release, Core validates the complete tree before atomically pooling one unchanged event-head/scope tree for a later random lease identity; a changed, corrupt, expired, or replaced Store discards it. The manifest remains the final commit marker, old lease paths disappear on release, startup removes incomplete/reusable trees, explicit release is idempotent, and store replacement invalidates all live leases and disposable cache state.
- Native CLI drafts obtain canonical metadata/body bytes, title/body ETags, generation, and head from one Library reader transaction, then become bounded local evidence only. Apply writes a read-only pending marker before submission and atomically replaces it with the committed result; after response loss, the exact stored semantic request is revalidated against the accepted work and resubmitted under its deterministic operation ID. Core receipt replay runs before current-head guards, so the same commit is recovered without a second update. A definitive conflict removes the pending marker so a later invocation can recompile against current content. Draft files never become recovery or startup state for Core.
- Native Agent Skill setup needs no lock, ledger, or recovery journal. Every
  selected target is classified before normal writes; parent creation is
  single-level and re-inspected, leaf creation uses no-clobber symlink semantics,
  and `EEXIST` is accepted only after it reclassifies as the exact current
  managed link. A process interruption may leave an already-installed first
  target and a missing second target, but rerunning the same setup preserves the
  first and completes the second. Removal is likewise idempotent and can unlink
  only an exact link to the current signed-App source.
- Official Skill release identity is reproducible and cross-architecture.
  Release preparation generates one timestamp-free allowlisted artifact;
  prepared Electron output, arm64, x64, signed provenance, and the public mirror
  compare its release-manifest/tree digests. The mirror update atomically
  fast-forwards `main` with its annotated version tag, so a concurrent advance
  or partial branch/tag write fails. If App publication succeeds while mirror
  publication fails, offline App-bundled setup remains available and the same
  artifact can be retried safely; exact retries create no commit and rollback is
  refused.
- Structured property batches are canonical and immutable by `mutationId`. Every field is validated before the first write; scalar CAS is field-local, set add/remove intent is deterministic, and status changes update their primary Kanban group in the same IMMEDIATE transaction. Property values, one Block metadata revision per target, complete Page/scheduler projections, change-log evidence, and the committed or rejected receipt roll back together at every pre-commit fault point. An exact retry returns the durable outcome without advancing any revision twice.
- Electron property IPC uses that exact typed envelope and the one Core writer. Main binds audit identity to the trusted main-frame renderer client. Every first commit records one canonical `block_mutation` cursor with per-field before/after value and revision evidence, so property changes appear in the same durable history as Document and behavior operations. Only a first committed receipt emits a Board summary; duplicate/rejected retries stay silent.
- Stable-ID Document operation batches are prepared against a detached current-head clone and make no authority change until every operation, schema rule, application identity, anchor, and ancestry check succeeds. The resulting relative Yjs update, registry/index/materialization/search projections, one `change_log` cursor, and immutable committed receipt share the same IMMEDIATE transaction; every pre-commit fault leaves the old head and no receipt, while a response lost after commit replays the exact outcome. Update/delete/move operations record the precise invalidated subtree IDs in a Core structural-barrier ledger. Stale Yjs updates that overlap those IDs become durable recovery artifacts; disjoint stale edits may still merge. Structural-barrier lookup is scoped to the current Project and `storeEpoch`, so pre-restore ledgers cannot poison a restored Document. This ledger is Core recovery evidence, not a Host lease or renderer proof.
- Production Document mutation IPC never accepts structural-barrier proof or durable actor identity from a client. Electron derives first-attempt audit identity from the trusted main-frame renderer and calls the Core-backed Adapter. Transport identity is excluded from the logical mutation hash, so an exact retry after a window restart returns the first durable outcome. A surface-scoped causal flush may finish local IME/Yjs updates before a structural command consumes them; the editor is never frozen and Core performs the final generation/head CAS and serialized commit. Post-commit provider fanout failure can never turn durability into a second mutation.
- Document revisions are immutable semantic evidence addressed by content and source identity and retained independently from operational update compaction. New BlockTree revisions store canonical stable-ID BlockTree plus rich Page title; legacy full-state Yjs and Canvas scene formats remain readable. Restore is a first-class exact-retry Core Document mutation: Core validates Project, store epoch, generation, schema, and current head, consumes any required local causal flush, and then one native transaction pins the current state, appends one forward mutation with registry/projection/change-log/receipt evidence, and pins the resulting state. Faults roll the whole transition back. The internal restore compiler may exceed the public 512-operation batch limit without widening that public contract. Only IDs present in the selected revision may reactivate retained same-type tombstones from that same Project and Document; ordinary create/import remains unable to reuse deleted identity.
- The Page history reader collapses linked Document revisions and content mutation evidence into one cursor-stable content entry, while property, Database, lifecycle, and relocation evidence remains non-restorable Activity. Every row is authorized against the requested Project, Page Block, and owned Document; malformed or oversized evidence degrades to bounded `unknown` display instead of leaking raw payloads or breaking pagination. Only a generation-compatible revision advertises restore. Current content is persisted and read from the mounted Y.Doc before the overlay opens, so remote edits cannot be undone through a stale Page projection or another window's UI stack.
- Page lifecycle, Block properties, and Database values use separate typed commands over the same Core writer. Property commands capture exact field revisions; scalar CAS stays field-local, missing sparse values start at revision zero, and tags remain commutative add/remove intent. No endpoint accepts a mixed whole-Page patch, and the old chunked description staging transport is absent.
- Calendar, reminder catch-up, and snooze-title reads use the typed schedule index plus current Block/Document/Database authorities. They reject an index whose `source_metadata_revision` differs from the Page Block, a legacy or non-ready Document, and any non-current materialization. Schedule projection refresh runs inside the writer transaction; invalid start/end/all-day/recurrence/reminder combinations roll back both source properties and the index.
- The native Automation Module evaluates Calendar occurrences inside one SQLite read transaction from those same authorities. It preserves local wall-clock recurrence through DST, inclusive end dates, exception identity, and all-day local date spans; authorization or exact-head drift fails the whole read instead of mixing snapshots.
- Occurrence complete/skip/update commands require a caller-retained logical `operationId`; renderer generation uses UUID-v4 and there is no server-generated fallback. Complete and clone-capable update scopes also require a caller-preallocated UUID-v7 `createdPageId` in canonical intent. Actor and client session are first-attempt audit evidence outside the logical hash, so a lost response can retry after SQLite/process restart without cloning or advancing twice. Committed schedule/exception/clone/projection changes and their canonical Block mutation receipt are one transaction. Deterministic precondition failures such as missing/unscheduled Pages and invalid occurrence updates persist an immutable rejected receipt with no `change_log` row or authority write. Reusing an operation ID for different semantic intent returns a typed collision.
- The native Automation mutation path enforces the same boundary inside one immediate writer transaction. It resolves Page write access separately from sibling-creation authority, fences the current schedule/Document/Data Source heads, and reuses the Library-owned recursive clone seam without publishing a nested Module event. A failed clone, source advance, recurrence exception, this-and-future split, projection refresh, receipt, or event therefore leaves no partial Page. Rejected receipts replay across authenticated Adapters because transport connection identity is excluded from the semantic fingerprint; successful replay never allocates a second Page.
- Full Page product reads run inside one SQLite read transaction and assemble identity/lifecycle from `blocks`, content only from a materialization whose generation/schema/head exactly matches its ready owned Document, Database fields from membership/property values, optional manual order from View position, and intrinsic behavior from Block properties. A stale or missing materialization is a typed failure. The disposable `page_read_model` may be rebuilt by the writer but is never fallback authority; Library- or Page-parented Pages project successfully and are absent only from Database Views they have not joined, while active members without a position remain queryable and use the View's null-ordering policy.
- Application shutdown stops Host background producers at `before-quit`, flushes mounted renderer providers, and drains accepted Core work. The detached Core remains reusable after Electron exits; its own bounded idle/drain lifecycle never turns Host shutdown into a second storage writer.
- The historical sidecar is the only TypeScript legacy consumer. Core first recognizes an exact frozen v26/two-v57/v68/v82/v83 inventory and creates a durable source database/assets backup; the earlier v57 inventory is normalized by native named-column table rebuilds only in staging, and the sidecar then advances that staging copy to exact v84. A packaged Core discovers the enclosing app's regular Electron executable, migrator script, and canonical digest manifest from its own executable path; explicit environment overrides remain an all-or-nothing development/test seam. Electron, a native CLI symlink, and the background launcher therefore reach the same closed migration runtime without launcher-specific resource injection. The checked-in sidecar is reproducibly generated from its fixed source commit plus deterministic compatibility overlays before its bundle hash is pinned. Native code reconstructs every ready Yjs Document through Yrs, rebuilds derived projections without rewriting the authoritative update stream, verifies semantic dependencies, and publishes v92 once. The separate direct-v84 and v85/v86/v87/v88/v89/v90/v91 Rust paths validate their exact inventories, back them up, and reach v92 without reinterpreting TypeScript authority. IPC, CLI mutation, schedulers, and windows remain unavailable throughout migration. The checked-in bundle, legal notices, and canonical manifest form one integrity unit; v92 does not regenerate or rewrite them.
- `headSeq` is a local persistence sequence and the Yjs state vector is causal synchronization state, not an integrity digest. SHA-256 hashes protect every exact persisted update and compaction-snapshot blob, but no hash is computed from a later full-state re-encoding. Operational snapshot compaction verifies the exact blob it writes, reloads it through the complete semantic reconstruction boundary, and then prunes only covered update payloads; re-encoding byte equality is deliberately irrelevant. Exact-head recompaction is a no-op and receipts remain durable so a late retry still returns its original committed sequence. User-visible history checkpoints are a separate retention domain.
- Tombstone retention is fail-closed and global in reachability while ownership remains Library-scoped. The planner retains the newest configured deleted roots, recursively includes only deleted contained/document-bearing descendants, and scans every registered exact-head Block-tree/Canvas projection, retained Document revision, recovery artifact, mutation/change/relocation ledger, active Database target, durable cross-Project reference, and inbound foreign key. Window-local tabs are disposable presentation state and never become retention roots. A background epoch-fenced FIFO pass—or an operator-targeted pass over explicit roots—runs one root at a time in an IMMEDIATE transaction: only Document revisions already selected by the shared revision-retention planner and resolved recovery artifacts are pruned, reachability is replanned, immutable mutation/change receipts remain, all closure IDs are inserted into the immutable `retired_block_identities` registry, and the verified ownership/Block/Document closure is deleted or the full candidate rolls back. Any pinned or still-retained revision blocks collection. Same-Project immutable receipts may mention both collected and live identities because transfer operations are multi-root; they remain byte-for-byte audit evidence but do not own reachability. Cross-Project attribution, corrupt evidence, or mixed evidence that would actually be pruned still fails closed. The registry has no cascading Project FK and a `blocks` insert trigger rejects reuse forever. Startup data repairs continue to validate restorable tombstones, but ignore historical receipts only after the Page identity has entered this permanent-retirement registry; an immutable event alone never makes a retired aggregate live again. Missing ownership, stale/corrupt projections, unknown FK shape, or a constraint retains the candidate with bounded typed evidence.
- Codex thread metadata persists in `codex_threads` with nullable project ownership, global sidebar pin authority persists in `codex_pinned_threads`, and durable local thread ownership lives in `project_session_threads`. Parent-linked subagent rows persist as lightweight, unarchived `codex_threads` catalog records with optional nickname/role metadata, but they cannot own a `project_session_threads` link or appear in ordinary root-thread sidebar lists. A late root-to-child classification atomically clears pin/unread state and archives/detaches any prematurely materialized Session while preserving the child catalog row.
- App-server Thread timestamps are external observations, not local clock authority. First materialization prefers the UUIDv7 creation instant at protocol-second precision; subsequent observations preserve immutable creation and advance update time with `max(created_at, previous_updated_at, observed_updated_at)`. Cold `thread/read` and `thread/resume` metadata therefore cannot regress sidebar recency or make the pair invalid.
- Persisted app-server session files under the Nodex-owned `$INTERPRETER_HOME` at `${NODEX_HOME}/agent` are the sole recovery source for linked thread turns/items across tab switches and app restarts. Claude Code, Codex, and Open Interpreter history enters that home only through the Settings import workflow. Imported rollout content receives a new Thread id and a content-hash ledger prevents an unchanged source session from being imported twice; the source can subsequently move or disappear without affecting recovery.
- The main-process conversation manager now bootstraps canonical thread state directly from persisted Codex session files when needed; there is no separate app-owned transcript snapshot cache.
- Active-thread runtime authority is conversation-centric inside the main process: each loaded thread keeps one canonical manager record with transcript/detail, `resumeState`, stream role, queued follow-ups, and pending steers, and renderer snapshots are always serialized from that record.
- Project rename updates linked Codex rows transactionally with project metadata updates.

## Backup and Restore
- The native Rust Core migration lane exposes v92 readiness, backup inventory,
  manual online backup creation, and whole-store restore over its private
  generated Module route.
  Backup identity is derived from Profile plus operation identity; the manifest
  binds the full request fingerprint. Staging and managed-asset trees refuse
  symlinks and special files, the immutable candidate must pass schema-owner,
  integrity, and foreign-key validation, and every file plus containing
  directory is flushed before the Store receipt commits. Publication is a
  subsequent atomic rename. A crash before the receipt leaves reusable or
  safely replaceable staging; a crash after the receipt is recovered by exact
  replay, which verifies the original Manifest and finishes publication before
  returning. Restore validates the selected immutable v92 backup plus every
  reconstructed ready Document, Canvas scene and current projection,
  Profile/Library identity, and referenced managed asset before file movement.
  Delete and automatic-retention pruning persist exact logical deletion
  identities with the Store Administration receipt before moving physical
  targets into a deterministic operation-owned cleanup staging directory.
  Backup reads and restore filter those identities, and exact retry completes
  either an interrupted rename or directory removal. All changed Administration
  receipts seal through Library-scoped LocalCommit evidence and a Library-only
  DeliveryAtom; Project catalog presence and lifecycle are irrelevant. No-op
  receipts retain their original Store observation even after later commits.
  Integrity/foreign-key checks,
  bounded eligible Document compaction, and revision retention run in a
  Module-owned canonical order with physical Block retention and one exact
  receipt. Retention processes each older deleted root in its own IMMEDIATE
  transaction, reconstructs current Yrs/Canvas authority instead of trusting a
  stale projection, decodes bounded retained revisions through the same history
  readers, and fails closed on live descendants, recovery, Database/Session/
  reminder roots, cross-Project attribution, relocation, or unknown inbound
  foreign keys. It prunes only expired revisions and wholly owned resolved or
  discarded recovery artifacts. Immutable mutation/change rows survive physical
  collection, and permanent retired identities plus exact row counts make ID
  reuse or a partial closure impossible.
- Native SQLite handles are generation-stable facades. Exclusive maintenance
  rejects new reads/writes with a typed retryable error, waits for all accepted
  operations (including queued writer jobs and checked-out readers), joins the
  writer, and drops idle readers before invoking filesystem work. A fresh
  writer/pool generation is published before the fence reopens, so existing
  Modules cannot retain a connection to a replaced database. The store remains
  fenced if reopen fails. Native restore resets the Document runtime cache,
  subscriptions, and Awareness state; atomically republishes the runtime
  descriptor with the new epoch/readiness generation; and makes the installed
  Store's durable change log the new replay authority before the fence reopens.
  The epoch-rotation transaction rewrites restored change-log and Module-receipt
  epoch coordinates, including receipt result JSON, to that new Store
  incarnation. Old clients therefore fail their exact event-epoch contract,
  while a newly handshaken client can replay the restored history without
  accepting a prior-incarnation frame.
- Native Core startup serializes on one mode-restricted lifetime lock. A losing
  selector does not trust descriptor JSON or its PID: it validates the fixed
  runtime directory, descriptor, auth file, and Unix socket ownership/type/mode,
  canonical compatibility manifest/digest, executable identity, and exact Store
  identity, then proves readiness through an authenticated full-generation
  handshake before returning the winner. The winner removes only
  an owned real socket after it holds the lock. Handshake connections are
  registered against the UDS peer identity and cannot change role; shutdown
  first enters drain state, rejects fresh connected work, stops accepting
  sockets, and lets Axum finish in-flight requests before Store teardown and
  exact-generation runtime-file cleanup.
- Native Core is launcher-independent and idle-exits through that same graceful
  drain. The default idle period is fifteen minutes;
  `NODEX_CORE_IDLE_TIMEOUT_MS` may set a positive value up to 24 hours or `0`
  to disable idle exit for a private development launch. Idle eligibility
  requires no live/recent authenticated peer process, event or Document
  subscription, Awareness participant, prepared Agent operation, accepted or
  queued SQLite read/write, maintenance generation, due Automation definition
  or snooze, or unexpired Automation/reminder execution lease. Each successful
  handshake and bound request increments an activity generation under the same
  lock that enters idle drain, closing the check/accept race. Explicit shutdown,
  idle expiry, SIGINT, and SIGTERM signal SSE streams to end, stop new socket
  acceptance, and then rely on Axum to wait for already admitted ordinary
  requests; an active transaction is never cancelled to accelerate exit.
- Repository-owned isolated runs add a development-only lifetime supervisor
  around the unchanged package script. It atomically leases the isolated
  Profile before Electron starts, Electron publishes a `starting` claim after
  acquiring its Profile-scoped single-instance lock and advances it to `ready`
  after Core-backed runtime startup, and the supervisor retains that lease
  through authenticated exact-generation shutdown. The selected package script
  runs in a dedicated process group so terminal interrupts terminate its
  Electron/Vite descendants without signaling the separately detached Core.
  Every Electron bootstrap refuses an active isolated lease without its
  matching run ID, closing the handoff interval between Electron exit and Core
  teardown.
  Successful drain removes Core runtime evidence before releasing the lease
  last; an absent/mismatched claim, changed generation, unsafe runtime entry, or
  timeout leaves the lease and Profile intact. Isolated runs inherit a
  thirty-second idle period only as crash recovery when no caller value exists;
  the production fifteen-minute contract and `--global-nodex` remain unchanged.
- Core compatibility is an explicit offer/require comparison, not transport
  overlap or a build string. Transport 8 carries committed-event version 8,
  canonical per-Module ranges, exact normalized-schema Store fingerprints, and
  executable SHA-256 separately. Electron's `prefer_current_artifact` policy
  replaces a different compatible artifact; native CLI's `compatible` policy
  reuses it. Replacement authenticates over the fixed UDS and echoes the
  complete manifest/artifact/PID/start-nonce/Profile/Store/readiness generation.
  Core rejects unreadable Stores and every transport/event/Module downgrade,
  and returns `busy` plus a bounded retry delay while an idle-preventing lease
  remains. An accepted handoff enters normal drain; the contender holds the
  already-open advisory lock and starts only after exact-generation cleanup and
  lock release. Transport-4 shutdown/replacement JSON rejects unknown or legacy
  fields. The Rust selector alone can bridge forward from a transport-1/2/3
  incumbent; an old candidate cannot replace transport 4. Failure is terminal:
  startup never kills a PID, deletes an unproven path, opens a second SQLite
  writer, or silently falls back to another backend.
- The authenticated native health response derives `ready | maintenance |
  draining | failed` from the lifecycle and restartable Store generation. Its
  metrics are bounded process-local counters/gauges: current writer queue/read/
  write load; cumulative accepted-command, actual `IMMEDIATE` transaction,
  Document reconstruction, and backup durations in microseconds; Document
  cache entries/bytes/hits/misses plus integer parts-per-million hit rate;
  current/max initial SSE replay lag; event head; WAL bytes; and live client,
  stream, Document, Awareness, and prepared-operation counts, plus cumulative
  dropped Core log records. A failed internal
  metric probe makes readiness `failed` rather than returning a deceptively
  healthy partial snapshot. Metrics reset on process restart and never replace
  receipts, change-log sequence, or Store Administration status.
- One native transport guard surrounds every private route. It enforces the
  route-specific body cap even when a handler would otherwise ignore its body,
  validates JSON UTF-8 and structural budgets before typed extraction, rebuilds
  the request body for the owning handler, and caps non-streaming JSON/binary
  responses before publication. Oversized, deeply nested, container-heavy, and
  invalid-UTF-8 inputs fail before Module work; the connection is closed after
  a transport-bound rejection so unread request bytes cannot poison reuse.
- Transport budgets and collection budgets are different contracts. Transport
  4 publishes ordinary JSON request/response caps of 2 MiB/16 MiB from the Rust
  protocol and generates the same constants for Host consumers; Document JSON,
  Document frames, and committed-event frames retain independent caps. A
  growing Module collection must still return a `CollectionWindow` with at
  most 200 items and a 1 MiB encoded semantic budget. Its continuation is an
  opaque HMAC-signed keyset cursor bound to Library, Store epoch, query
  fingerprint, direction, and the last stable coordinate. The cursor is a
  coordinate, not a snapshot claim: data mutations never invalidate it, and
  concurrent writers can never livelock a reader out of finishing its
  pagination. Only signature/shape failures, a query-fingerprint mismatch, a
  Store-epoch rotation, or a payload-version change reject a cursor, and the
  consumer contract for any rejection is to drop the cursor and silently
  converge from the first window — never to surface it as an error. The cursor
  fingerprint serializes the complete query tuple, so an empty member remains a
  valid, unambiguous representation of an absent optional filter. The cursor
  never grants authority. OFFSET and full-load-then-slice are not valid
  implementations of this contract.
- `pnpm run core:failure-matrix -- --profile <.generated/rust-core-migration/path>`
  is the executable Gate D recovery audit. It refuses nonempty, symlinked, or
  out-of-tree Profiles; verifies the named behavior tests still exist; runs all
  native Module transaction tests plus abrupt-WAL recovery; then migrates and
  reopens one representative v84
  input Profile as v92 to report its final committed sequence, `integrity_check`, and
  `foreign_key_check`. The matrix covers rejection before transaction,
  Library/Database/Workspace/Automation rollback during a transaction,
  Document commit before cache/event publication, published legacy/v84 import and v85/v86/v87/v88/v89/v90/v91-to-v92 migration publication,
  backup publication before receipt, restore rollback/adoption, and process
  exit with a committed WAL.
- `pnpm run core:read-budget-gate -- --profile <.generated/read-budget-gate>`
  is the disposable large-Profile read-model audit. It refuses a symlink,
  nonempty directory, or target outside this repository's `.generated/`;
  seeds thousands of Sessions/Threads and tens of thousands of Database rows;
  proves that legacy-equivalent payloads exceed 16 MiB while first and
  continuation windows remain below 1 MiB; verifies summary/body isolation,
  RowsById, stale cursors, mutation receipts, constant Core request count,
  `integrity_check`, `foreign_key_check`, and the expected covering-index query
  plan. The gate may create only synthetic Profiles and must never point at a
  developer's real `NODEX_HOME`.
- Native global and scoped projection events are reconstructed from the durable
  SQLite LocalCommit ledger in one read transaction after the broadcast
  receiver is installed. The
  fixed catch-up window is bounded and never returns a partial prefix: a
  retention hole or an oversized replay emits `core-resync-required` with the
  requested cursor, oldest available sequence, and durable head. Global/scoped
  broadcast lag is only a wake to rescan durable state; Document/Awareness lag
  emits the Document-specific repair boundary and closes that resource
  subscription. A reconnect after process
  restart therefore replays retained typed events; a slow or stale consumer is
  forced onto fresh authoritative reads instead of silently skipping changes.
  The Host configures its decoder only after a successful handshake and accepts
  exactly the selected transport, event version, Store epoch, positive sequence,
  known Module payload envelope, and canonical bounded Projection Impact.
  Decode/compatibility failure occurs before router delivery and permanently
  ends that supervisor; ordinary disconnects retain bounded backoff, and replay
  gaps retain their explicit resync path. The replay cursor advances only after
  ordered router acceptance.
- Native event-stream identities are leased, unique, and released when Axum
  drops the stream: one logical connection may hold at most 64 streams and the
  process at most 2,048. A second live global stream or identical Document
  client-session stream conflicts instead of creating ambiguous disconnect
  ownership. A Document stream's drop guard releases only its exact connection
  and client-session subscription; sibling streams on the same logical
  connection remain authorized, while full connection teardown clears the
  remaining set. The Document Realtime Adapter independently caps its
  subscription map, accepts at most 4 KiB per Awareness publication, owns at
  most eight Awareness clients per subscription and sixteen per Document, and
  refuses an initial Awareness snapshot above 96 KiB. Capacity failure is the
  typed retryable `resource_exhausted` error (HTTP 429), not silent eviction.
- Native prepared Agent operations are process-local leases over durable Module
  semantics, never a second mutation authority. Preparation uses one SQLite
  read snapshot and issues no token when the exact Module receipt already
  exists. New tokens expire after 60 seconds and are capped at 32 per UDS
  connection and 1,024 per Core. Execution re-prepares against the writer's
  current Store/Turn/Page/Document authority, acquires the token before any
  authoritative write, and removes it after the transaction commits. A failed
  transaction restores the lease for retry; a concurrent attempt conflicts;
  process restart and Store replacement discard all prepared state. A crash
  after SQLite commit is recovered through the durable receipt and change log,
  so it neither repeats the mutation nor asks for consent again.
- Native whole-store replacement has a bounded, mode-restricted, atomically
  fsynced journal whose paths are controlled staging/rollback directory names,
  never caller-authored paths. It is inspected under the Profile lock before
  any SQLite connection opens. A prepared candidate must be a Rust-owned v110
  Store with a regular no-symlink asset tree. An interruption before file
  movement returns the journal to `prepared`; an interruption during install
  restores DB, WAL, SHM, and assets while moving the candidate back to staging.
  A committed installed epoch is never rolled back: startup leaves it pending
  until the exact Store Administration receipt exists, then removes only the
  journal-owned staging and rollback trees. If the process survives a failure
  between journal commit and receipt commit, the exact old-epoch restore retry
  finalizes the receipt and Library effect without reinstalling the Store. An installation
  or runtime-reset failure before journal commit restores the complete source
  DB/WAL/SHM/assets set and resets the process runtime to the source epoch.
- Whole-store backups include `nodex.db` and managed asset files from one Core maintenance boundary. Core drains accepted writes and asset materialization, blocks new admission, snapshots SQLite online, validates and fsyncs the asset closure, commits the Administration receipt, and then atomically publishes the immutable backup; Electron has no database connection to close.
- Manual and scheduled backups enter the Core Store Administration Module and use rusqlite's online backup API. The staged DB and every asset file/directory are fsynced before receipt commit; the operation-bound directory rename is the recoverable publication phase.
- Restore requires explicit confirmation. Its optional pre-restore safety backup is created after the same asset/writer fence is acquired and before replacement, without reopening a write window between those operations.
- Before swap, the staged DB must pass current schema, `quick_check`, `foreign_key_check`, Block store metadata, Page-owned-Document, and primary projection/head checks. Its managed asset root may contain only flat regular files with safe names: directories/symlinks are rejected, and every exact-head `nodex://assets/*` projection must resolve to an existing file (unreferenced files may remain).
- Cross-file DB/WAL/assets replacement is protected by one atomically written and fsynced Core store-replacement journal. Rename parents and staged/live files are fsynced. Startup recovery restores the complete rollback for every pre-commit phase; a durable `committed` phase keeps the complete installed v110 store and removes only journal-owned recovery artifacts. Both candidate and installed stores receive exact v110 physical and semantic validation.
- The installed DB rotates `storeEpoch` transactionally before `committed`. Core then invalidates leases/subscriptions and publishes the replacement generation; missing Host fanout cannot turn a durable restore into an apparent failure. Old-epoch IPC updates fail closed, while providers clear checkpoints/outboxes and reload through a fresh descriptor/state-vector handshake after the controlled Electron relaunch.

## Sync and Event Delivery
- Electron path: committed Core event stream -> main-process fanout to all open windows -> IPC event -> hook refresh.
- Main supervises the global Core event stream for the lifetime of the Host. It advances its replay cursor only from delivered sequences, reconnects after clean or failed termination, and treats `core-resync-required` as a repair boundary: invalidate the complete Project catalog plus every Session summary and detail cache, advance to the reported event head, and reopen the stream. Shutdown closes the supervisor and suppresses reconnect.
- Electron one-way fanout must go through `ipc-safe-send`. Renderer frames can be disposed during window reload/close between `BrowserWindow` lookup and `webContents.send`; lifecycle send failures are treated as debug-level skips, while unexpected send failures are warning-rate-limited so one broken window cannot create a log storm.
- Electron startup path: the main process starts through a small bootstrap entry that resolves the Nodex home, writes its canonical absolute path to `NODEX_HOME`, scopes Electron storage, queues early deep links/second-instance events, and then dynamically loads the application runtime. Renderer windows still block behind the preload-driven initialization screen until runtime initialization resolves.
- Fresh-Profile Project bootstrap is a recoverable automatic Host workflow over one atomic Core aggregate, not a Core schema state machine or renderer wizard. Core derives `empty | ready` from the complete Project catalog and serializes `CreateInitialProject` with `BEGIN IMMEDIATE`; the required starter Page, ready Document, primary Data Source membership, and View impact commit in that same transaction, exact operation replay is checked before the empty-catalog precondition, and every other Workspace mutation conflicts until the aggregate exists. Before crossing the filesystem/Core boundary, Main writes the stable attempt and operation IDs plus the exact Project/source/appearance/starter-Page payload to `${NODEX_HOME}/recovery/initial-project-v2.json`. The bounded strict JSON file uses same-directory temporary publication with file and directory fsync, rejects relative sources and symlinks/special files, and quarantines malformed input. A newly claimed collision-safe `Default*` directory carries a matching bounded marker so restart can adopt only that exact attempt. Recovery never deletes a user directory and an unrelated winner leaves the unused empty directory intact. After Core commit, Main must durably seed a Project-owned Scene whose primary is the current default Database View and whose right panel presents the Welcome Page before removing the marker and journal; it creates no starter Session. A failure in that final write therefore replays the same Core receipt and presentation on restart. Deleting the initial Project or Page is ordinary user intent and never triggers bootstrap again.
- Each renderer window restores one revisioned Window Session from `window-sessions-v3.json`. The strict catalog records `open | closed` lifecycle independently from BrowserWindow attachment; v2 and v1 catalogs migrate forward as open records without deleting their source files. Saves use a serialized compare-and-swap revision, atomic temp-file rename, file and directory fsync; stale writers are rejected and malformed current catalogs are preserved for diagnosis before a fresh catalog is created.
- User window close persists final bounds and transitions the attached Window Session to closed only after the renderer close flush and Electron's definitive `closed` event. App quit and unexpected destruction retain open lifecycle for cold-start recovery. Generic New Window acquisition consumes the most recently closed record in reverse close order with exact identity and rolls that record back if native window construction fails. Closed history retains the twenty most recent records by default and evicts the oldest closed records until the catalog is at most 32 MiB; open records are never evicted.
- When no closed record remains, opening a new app window flushes and clones the focused Window Session as a one-time starting snapshot with reminted Scene surface, panel-tree, browser-scope, and terminal-descriptor identities; without a source it creates a fresh Window Session. Targeted `Open in new window` clones the selected source owner Scene without consuming closed history. Subsequent surface creation, close, selection, split, and sizing remain independent; only Core-backed domain data converges across windows.
- Browser runtime ownership is keyed by the Window Session's `browserViewScopeId`, so the same Project or Session Scene can display unrelated Browser surfaces in different windows without sharing navigation state. A deliberate fork snapshots descriptors from the source Scene and remints them into the target scope. Terminal PTYs remain shared process runtimes but grant one active Window Session lease at a time; another window must explicitly take over, closing a local Terminal surface releases only that lease, and explicit kill terminates the process.
- Browser descriptors keep one opaque storage identity; full navigation snapshots
  live in the Main-owned Browser page store. That store validates exact route
  ownership, caps each page at 500 entries, the collection at 100 pages and
  64 MiB, and publishes through same-directory temp write, fsync, and rename.
  A prepared cold restore starts `navigationHistory.restore` at
  `did-attach-webview`, before the first guest load. Invalid or incompatible
  history is quarantined without deleting the tab or shared Profile.
- Browser guest lifetime is generation-fenced and distinct from React lifetime.
  Explicit close/reset and budget suspension use request/ack teardown; panel
  movement, collapse, ordinary unmount, and window minimization do not. Each
  live guest and its cursor overlay share one body-level host that is appended
  once; presentation-kind changes update bounds and z-order without moving the
  webview custom element between parents. This preserves the same guest
  WebContents across retained-to-panel handoff. Cursor arrival is acknowledged
  by the visual motion controller only after a presented-page animation
  finishes. Cursor placement uses the native overlay's current presentation
  bounds so panel resizing cannot desynchronize the cursor from page content;
  non-presented automation does not wait on an unavailable renderer.
  Each logical panel close backgrounds the fixed guest synchronously, before the
  animated shell finishes collapsing. The mounted panel remains the only host
  owner until animation unmount, and generation-bound presentation messages
  prevent a late cleanup or background host from overwriting its successor.
  Main retains one baseline debugger session for the guest lifetime so page
  color-scheme and device emulation survive navigation and theme changes.
  Route-independent renderer theme publication updates every live guest in the
  same Window Session even while Settings replaces the workbench. Browser Use
  shares the debugger session and releases only its listeners; guest destruction
  is the debugger teardown boundary. Each Window Session retains at most 32
  detached live pages, while selected,
  presented, recently used, Browser Use, capture, audio/media, loading/restore,
  and active-download pages are protected. Suspended pages retain their durable
  shell/snapshot and cold-restore when selected.
- Native remote-hosted PiP is ephemeral Main/OS presentation, never a second
  page owner. Completed Browser `node_repl` activity contributes static
  screenshots, while Computer Use contributes its service-owned live layer.
  Visible Browser presentation suppresses the owning thread, and turn
  completion, privacy termination, release, window teardown, and shutdown use
  idempotent cleanup. Maximum display size and global always-hide are restored
  from a Profile-local atomic preference file; per-task hidden state remains
  intentionally ephemeral.
- The canonical Computer Use helper is published by staging-and-rename with
  rollback after strict post-swap verification. Its service manager serializes
  concurrent starts, reuses only a live non-zombie process with an exact native
  executable-path match, and respawns otherwise. Ordinary coordinator disposal
  closes the private host-services pipe but deliberately does not kill the
  shared helper; isolated conformance probes terminate only the exact PID they
  started before removing temporary state.
- Computer Use overlay config and approval preference JSON are serialized and
  atomically renamed, so concurrent startup/settings mutations cannot expose a
  partial document. A malformed or missing file projects empty approvals and
  default click sound; Locked Use status failure projects disabled rather than
  claiming installation.
- Browser download and history stores are Profile-owned atomic files. Download
  records are bounded, retain collision-safe destination and progress state
  across restart, and attribute events only to the owning route/window. Browser
  Use grants expire after ten seconds and are consumed once by the matching
  guest and URL chain. Profile data clearing invalidates every affected window's
  projection rather than leaving renderer-local success state.
- The Core candidate's pre-selection startup frames are a private, explicitly enabled, bounded, best-effort advisory channel. Migration reporting happens only after Core has classified a supported older schema and before the first migration write. Main retains the latest monotonic projection before broadcast so late windows and renderer resubscriptions receive the same state. Missing advisory frames never weaken selection, migration, readiness, or the authenticated generation handshake.
- Native CLI startup resolves the same Profile home precedence before launching or connecting to Core. `NODEX_HOME` wins; otherwise the nearest project `.nodex/config.toml` overrides the user config and the default is `~/.nodex`. Config input is UTF-8 and byte-bounded, and malformed or unreadable TOML fails closed so a typo cannot silently start a different Profile.
- Native `service status|enable|disable` is deliberately outside the Core startup path. On macOS 13 and newer it controls a bundle-scoped `SMAppService` LaunchAgent that may prewarm the selected Profile by replacing its controller with the same `nodex-core` binary. Registration is optional and has no KeepAlive policy: disabled, approval-required, unsupported, malformed, missing, or timed-out Adapter states are reported as latency status and ordinary Electron/CLI on-demand launch remains authoritative.
- Electron single-instance lock scope is profile-aware: bootstrap sets `userData`/`sessionData` under resolved `NODEX_HOME` before calling `requestSingleInstanceLock`, so independently configured installs can run concurrently.
- Every Profile also owns its Core socket, runtime descriptor/capability, database, assets, backups, logs, and Electron session storage below that resolved home. Multiple windows in one Profile share one Main/Core authority; processes with distinct homes share none of those stateful coordinates and require no Desktop API port coordination.
- The managed raster protocol handler is installed only on the app's default session before the first window loads and is removed during Main shutdown. Browser-sidebar partitions never receive the handler. Asset identity remains `nodex://assets/<safe-name>` across backup/restore; the display-only protocol is rebuilt from the active Profile at each startup.
- Packaged macOS startup first checks whether the app is running from an Applications folder; if not, users can move it there through Electron's native `moveToApplicationsFolder`, continue from the current location, or quit. An existing installed copy may be replaced only when it is not running; a running-copy conflict cancels the move and asks the user to quit that copy first.
- Session mutation fanout comes only from committed Core events; IPC mutation handlers do not publish a second optimistic invalidation. TanStack Query serializes each scoped summary/detail refresh, retains settled data during background refetch, and marks cold scope queries pending before their first paint.
- Renderer IPC board-change subscriptions filter by `projectId` to avoid unrelated refresh churn across windows/projects.
- Reminder path: the Host scheduler claims revision-fenced due leases from Core, presents OS notifications, and completes or fails the exact lease; Core owns deduplication and advancement.
- Resume/startup catch-up replays missed reminders within the configured catch-up window and still dedupes by receipt keys.
- The native migration path separates selection from delivery with expiring durable leases. A Host claim may be retried after expiry without writing a delivery receipt; only successful completion inserts the unique receipt and consumes the exact due snoozes in the same transaction. A crash before completion is therefore at-least-once, while a completed `(project_id, page_id, occurrence_start, offset)` cannot be delivered again. Failure records a bounded reason and retry time, and a native CLI Adapter cannot claim or settle Host work.
- Production macOS builds installed in an Applications folder expose a pinned
  Sparkle app-update channel: the main process owns check scheduling and one IPC
  status source, while Sparkle verifies the signed architecture feed, downloads
  a matching delta or full fallback, and installs only after the update is ready.
  The global `Restart to Update` action installs immediately through the normal
  flush/shutdown coordinator; otherwise a ready update may install after a later
  normal app exit.
  Local packages carry an explicit disabled channel. A packaged copy still
  running from a DMG, Downloads, or another transient location reports updates
  as unsupported.
- Codex conversation path: `codex-service` owns app-server transport and the main accepted recovery/relay replica. An active renderer owner reduces sequenced owner-routed notifications through the shared canonical reducer, projects visible state, and serializes snapshots/patches through one publication outbox. Main acknowledges a forwarded notification only after accepting the corresponding publication. With no renderer owner, main may reduce dormant recovery state, but it never emits a source-null visible conversation stream. `codex:event` remains for shell/control compatibility rather than acting as a second transcript reducer.
- Every accepted owner replica has a content-addressed checkpoint `(protocolVersion, ownerEpoch, revision, canonicalHash)`. Main accepts a first snapshot only with a null base, and otherwise compare-and-swaps against the exact base checkpoint, requires a contiguous revision, applies the patch, and verifies the declared post-apply hash before replacing accepted state. Shared hashes exclude durable read state and renderer-local authorization surfaces. Silent main cache maintenance cannot advance or mutate an active owner's accepted replica at the same revision.
- Follower subscription is checkpoint-gated. New followers and every owner replacement first receive a targeted snapshot; main withholds deltas until the follower explicitly acknowledges that exact checkpoint. The follower verifies source owner, epoch, exact base checkpoint, next revision, and post-apply hash. A gap, mismatch, patch failure, or transport reset requests a fresh snapshot and leaves the old state non-authoritative rather than silently continuing. Owner replacement increments `ownerEpoch`, so publications and acknowledgements from an earlier owner cannot cross the handoff boundary.
- Renderer resume/adoption results and relayed stream events always carry a checkpoint; no renderer synthesizes an epoch or revision. Owners and followers validate the returned revision/hash and retain the exact shared resume/snapshot document as their accepted publication/patch baseline before deriving normalized presentation. The first owner publication includes any normalization delta relative to Main's actual replica, so view-only normalization cannot alter replication identity or become a false CAS base.
- Canonical item lifecycle is terminal-monotonic per protocol occurrence, identified by item ID plus protocol type. Duplicate or delayed starts cannot reopen a completed occurrence; a later item of another protocol type may reuse the ID and begins a new lifecycle occurrence. Terminal owner notifications drain earlier streaming work before publication, and follower convergence is therefore defined by an accepted checkpoint rather than event arrival timing alone.
- A fresh Session start crosses the main/renderer authority boundary through one single-use launch ticket. Main completes `thread/start`, persists the Session link, and freezes the exact first-turn canonical/transport parameters plus `clientUserMessageId` for the initiating renderer. Fresh adoption seeds the accepted document and revision, reserves that renderer as owner, and buffers same-thread notifications until the renderer applies the seed. The renderer then publishes the optimistic first turn before consuming the ticket through the owner request facade. The submit boundary returns as soon as that optimistic turn is renderer-visible; `turn/start` completion, rebind, and failure projection continue in the owner transaction. This path never calls `thread/resume`; concurrent windows attach as followers to the reserved owner, and duplicate or wrong-renderer ticket use fails closed.
- Codex sidebar path: `codex:sidebar:snapshot({ refresh:false })` reads a bounded SQLite cold-start overview. Project/projectless lanes are independent Workspace task windows; folded lanes do not read, `Show more` consumes the Core continuation, and the selected task can be recovered by exact identity without loading intervening rows. External chat discovery goes through `codex:sidebar:sync`, which requests one bounded app-server window with the interactive root-thread source default, `modelProviders:null`, and state-DB listing enabled when supported.
- Sidebar sync is continuous reconciliation split by latency ownership. Main coalesces foreground calls across windows, uses a 60-second stale gate for `policy:"stale"`, commits the first window, returns its affected scopes, and schedules one process-wide background sweep. The sweep yields between windows, retries with backoff and jitter, and reconciles missing rows only after both active and archived scans reach their terminal cursor. A failed or interrupted partial sweep never archives unseen data. `policy:"force"` bypasses stale/backoff admission but joins or promotes the existing single-flight sweep instead of starting another.
- Sidebar `thread/list` refreshes separate thread read-model updates from session read-model notifications. Repeating the same force sync may upsert identical `codex_threads` rows, but it must not emit `project-sessions-changed`; session notifications are reserved for true session container or link changes such as first materialization, explicit re-home, archive/detach/delete/pin/unread/rename. In-place thread title/preview/status/archive/updatedAt/cwd changes update the sidebar catalog through `sidebarSyncUpdated` instead. Parent-linked subagent rows update only the child-membership projection and must not create project sessions. If parent metadata arrives after an early root materialization, that Thread upsert atomically archives/detaches the leaked Session and clears sidebar pin/unread state, emits only the affected Session/task invalidations, and preserves the child Thread as an unarchived catalog row. Core task windows, bounded main snapshots, and renderer presentation each reject parent-linked rows so corrupt or stale legacy projections cannot expose them. If older local rows already materialized a detached internal helper/reviewer as a Session, the next SQLite sidebar snapshot archives/detaches that Session and archives the helper Thread row.
- Low-latency sidebar updates come from app-server notifications. `thread/started` reuses the same reconciliation helper as `thread/list`; a server-only Thread may be materialized under the longest matching Project source or explicitly projectless owner, and emits the corresponding session change. Once that Thread exists in Core, the same notification path preserves its durable owner regardless of cwd. Unknown title/status/settings/goal/unarchive notifications schedule a debounced forced sidebar sync so the stale gate cannot swallow missing read-model repair; deleted-thread notifications only clean known local state and do not trigger a list repair.
- Reconciliation never owns Session or Thread re-home semantics. Core's existing Thread Project ID, including explicit `null`, wins over cwd and incoming metadata. Ordinary upsert/update rejects any attempted owner change; only the explicit `MoveThread` command may move the durable Thread/Session link. Window Session Scenes are not consulted and remain local descriptors that re-resolve shared targets after an explicit move. Browser and Terminal runtime policies are enforced independently by their Window Session scope and lease boundaries.
- Projectless workspace recovery runs only for a persisted thread with `project_id = null`. Cold resume and a Side-chat fork whose parent has no usable cwd prefer a real generated task cwd, then retained generated writable roots from newest to oldest, then a saved concrete browser root, and finally create an unsplit replacement under `~/Documents/Nodex` with cwd equal to output directory. The chosen cwd/output/browser-root tuple is persisted before app-server resume or fork, making retries reuse the same location. Seeded persistent-fork resume skips recovery and retains the inherited tuple.
- Legacy projectless migration is metadata-driven, not directory-scan-driven: only a persisted null-owned thread whose cwd exactly matches `~/Documents/Codex/YYYY-MM-DD/<slug>` is eligible. Main renames that one directory into a collision-safe `~/Documents/Nodex` destination, preserves relative output paths, and updates metadata after the destination exists. Unreferenced siblings, the shared legacy root, symlinks, files, and arbitrary external cwd values are never moved.
- Renderer sidebar sync triggers are local overview mount, delayed mount stale sync, focus/visibility stale sync, a focused visible 60-second heartbeat, debounced host-message stale sync, direct `sidebarSyncUpdated` host-message application, and project/source force sync. Session container/link changes refresh only affected `workspace:tasks:list` windows; they do not call `codex:sidebar:sync`. Renderer focus refetch applies to the bounded pinned-task overview with a short 5-second freshness window; pinned queries are not responsible for discovering external chats.
- Codex client startup is handshake-gated (`initialize` + `initialized`) and reconnects with backoff on unexpected child exit.
- Codex server requests use one shared raw lifecycle across canonical replay, main/no-owner state, and renderer-owner state. Pending state preserves complete envelopes, arrival order, duplicate occurrences, and the original `string | number` request id so owner handoff, replay, and snapshots cannot change which request is answered or withdrawn.
- If an owner-routed server request arrives before that renderer has a usable canonical conversation, the renderer retains the exact sequenced request, resumes the owner snapshot, applies the request only against the recovered canonical state, and then drains later owner messages in arrival order. A failed recovery still acknowledges the deferred sequence fail-closed without manufacturing a request projection. Browser origin confirmations therefore cannot disappear during first-turn owner/bootstrap races.
- Ordinary Codex user-input auto-resolution is main-hosted and keyed by conversation plus strict scalar request identity, so renderer remounts, owner handoff, and background windows do not reset or duplicate it. An explicit visible-presentation signal is tracked separately from the renderer's runtime-active lease. A request presented in at least one foreground window waits 60 seconds without activity before scheduling a 90-second empty response; a request without foreground presentation schedules immediately. Manual response, server withdrawal, request replacement, removed-turn reconciliation, thread archive/delete, and service shutdown cancel the timer. An app-server disconnect terminates the current inbound request generation, clears its pending cards and renderer-memory drafts, and drops any late handler response instead of writing an old JSON-RPC id into a replacement process; replay after reconnect is a fresh request generation even when the scalar id is reused. Request-card interaction, including Dismiss or Escape intent, atomically snoozes auto-resolution before choosing the manual outcome. Timeout first publishes a terminal state, then routes the empty response through the ordinary request transport and sends the owner a sequenced resolved notification only after that response succeeds, so canonical state cannot retain a card after main has answered it.
- `nodex_app@5` calls use the task's durable catalog revision and one transport-neutral Host facade. Page-first reads capture the exact Turn's Project-or-Library scope, returned content, and cursor state in one Core read snapshot. A resource-intent planner first returns direct authority, bounded consent requirements, or a terminal denial. Writes then preflight a semantic operation, re-resolve exact Turn authority, prepare again, compare the fresh effect/resource/deletion/ownership footprint, and execute through the owning Core Module. Direct Project authority and Library scope skip the card; one-call/task/Project consent remains resource-scoped. Exact completed-call retries verify Turn provenance and return the compact durable result without another write or prompt.
- Cross-owner Full-access Page create/move/duplicate operations use one outer `IMMEDIATE` transaction. Move stages the root at the source Library boundary, rehomes the complete stable-ID ownership closure, and places it under the target owner; duplicate copies fresh identities before the same rehome/placement boundary. Deferred foreign keys are transaction-local. Any injected failure rolls back Document heads, Block/Document owners, memberships, View placement, projections, immutable relocation ledger, and Agent receipt; commit requires closure consistency, canonical Page parent agreement, `foreign_key_check`, and current store epoch.
- Resume and thread-start buffers replay server requests in arrival order, but `currentTime/read` bypasses both buffers and responds immediately. A `serverRequest/resolved` notification is a no-response withdrawal: the first strict scalar-id match supplies any completed synthetic state and every same-id occurrence is removed, while the request-side unread flag remains set until the separate explicit read-state flow clears it.
- Server-request transport registries preserve delivered occurrences independently of scalar IDs. Stored interactive dynamic requests and ordinary dispatched dynamic calls use separate waiter lanes: an ordinary call never enters canonical request state, equal-ID deliveries do not coalesce, every dispatched occurrence receives its own response, and owner loss cannot reject a stored waiter while leaving its canonical request visible. Full service shutdown still rejects all remaining process-local waiters as described below; canonical state remains a separate concern.
- Explicit conversation read state is durable and non-revisioned. Main persists canonical membership in `codex_unread_threads`, derives linked-session unread state, silently rebases its broadcast cache, and emits `threadReadStateChanged`; renderers update loaded conversations/summaries without echoing IPC or advancing owner/follower stream revisions. Same-state writes are no-ops, focused selection/refocus and viewport interaction mark read, explicit context actions can set either state, archive clears it, and a late owner publication cannot resurrect an older unread value.
- Plan-implementation follow-up is replay-safe: identical completed-plan signals still replace the same-turn item/request set, dismiss/accept completion updates every matching item without timestamp churn, and starting a new turn removes stale and orphan plan requests globally. Recovery or pagination must not preserve a plan request merely because its source turn is absent from the loaded page.
- Backend observability includes structured JSON-line logs under `${NODEX_HOME}/logs` for unpackaged/dev runs, covering HTTP requests, native Core request/writer/transaction/event chains, app lifecycle, integrated terminal sessions, backup/reminder jobs, and Codex client/service flows (thread start, turn start, approvals, user-input, reconnects, worktree setup). Core records one correlated metadata-only chain from request through hashed caller identities, Module operation/receipt, SQLite writer command, and committed event sequence; exact retries retain their receipt sequence without inventing a second publication. Console and durable thresholds are independent: dev terminals default to `warn+`, while bounded rotating JSONL segments retain `info+`; observer subscribers have their own threshold. Each Core sink has its own bounded priority-aware queue, preserves warn/error ahead of lower levels, creates an exclusively locked Profile-family segment instead of appending an existing file, prunes only unlocked family segments by age and byte budget, and flushes under one timeout during shutdown. High-volume `dev runtime metric` records for thread-open diagnosis are opt-in through `NODEX_DEV_METRICS=1`. Packaged builds leave backend and Core file/console logging off by default unless explicitly enabled through `NODEX_LOG_FILE` or `NODEX_LOG_CONSOLE`.
- Remote crash diagnostics are optional and separate from local logs. Sentry initializes only when diagnostics are enabled through Settings, `[server].diagnostics_enabled`, or `NODEX_SENTRY_ENABLED`; warn/error backend log entries may become scrubbed breadcrumbs, but Nodex does not ship raw JSONL logs to Sentry in v1. Renderer Session Replay initializes only when the separate Replay opt-in is also enabled, using the configured replay sample rates.
- Remote product telemetry is optional and separate from local logs and Sentry diagnostics. The renderer dynamically loads Statsig only when telemetry is enabled through Settings, `[server].telemetry_enabled`, or `NODEX_TELEMETRY_ENABLED`; queued Statsig events flush through the app-close flush coordinator before Electron close. Filtered Statsig web analytics initializes only when the separate AutoCapture opt-in is enabled, and Nodex does not initialize Statsig Session Replay. The bundled Browser automation runtime independently disables its own ambient analytics and diagnostics requests so unavailable telemetry endpoints cannot delay successful browser commands or flood their results.
- Detailed logging behavior, configuration, and extension guidelines live in `docs/product-specs/backend-logging-spec.md`.

## Git Review Live-Read Reliability

- One process-lifetime Git worker owns repository change observation and every rebuildable read-plane cache. It canonicalizes a repository as `(hostId, real commonDir, real root)`, then shares one command lane, generation, watcher lease, in-flight query registry, and bounded untracked cache across cwd aliases, windows, direct reads, and live subscriptions. Main owns only worker lifecycle, trusted routing, and product orchestration.
- The repository lane serializes Git commands and local mutations for one common directory. Identical method/normalized-parameter/generation queries share one in-flight run. A semantic watcher event advances the repository generation before affected queries refresh, so work started against an older generation can return only a typed stale result and cannot publish into the current cache.
- The watcher classifies config, HEAD, index, remote-ref, working-tree, synced-branch, and worktree-topology changes, ignores object/log/lock churn, and coalesces semantic events. Each live subscription has a publication generation, dirty/running state, recovery flag, timer, and cancellable request. Tracked metadata can publish before untracked completion; complete results report an explicit omitted count after materializing at most 256 untracked paths.
- Untracked discovery uses `git status --porcelain=v1 -z --untracked-files=normal` plus bounded directory expansion under Git ignore semantics. One completion wave shares that scan across status, Review summary, and branch stats. Passive reads never run an unscoped `git status --untracked-files=all`. A slow successful scan receives a longer freshness window instead of being killed and immediately repeated.
- Renderer query ownership follows TanStack Query. One coordinator per window maps active query hashes to worker subscriptions, delays release briefly across React remounts, resubscribes after a worker epoch restart, and retains the last consistent result during recovery. Query and component cancellation propagate as AbortSignal-driven worker request cancellation; late results are ignored by request and generation ownership.
- Partial-diff loading keeps stable tracked/untracked group identities, coalesces after two microtasks, and uses per-path fallbacks only for missing or mismatched revisions. A stale diff performs at most one refresh/retry against a newer generation. Full-context requests remain byte-safe, batched `git cat-file` operations; failed or structurally invalid expansion preserves the partial diff.
- Stale, canceled, timed-out, non-zero-exit, and output-limit outcomes are operational data and are excluded from infrastructure exception capture. Per-operation metadata-only diagnostics record duration, first result, queueing, command count, peak repository concurrency, status/untracked scans, query cache/coalescing, limit flags, and a coarse index-size bucket; paths and diff content are never included. Invalid worker protocol, unexpected worker error, and unexpected exit are captured once, retire the epoch, and settle pending work as unavailable.
- Repository initialization, patch application, branch checkout/creation, and pure commit execution invalidate the worker-owned generation before success resolves. Commit and pull-request message generation obtain status and patch context from the worker without mutating the index. Main-owned push refreshes the worker after success or partial failure. Worker failure never falls back to a legacy Main snapshot path.

## Failure Modes and Handling
- Oversized Page payloads fail at the typed boundary before DB work.
- Invalid inputs fail at validation boundary with actionable errors.
- Not-found resources return typed not-found results.
- Startup accepts an empty Profile, an exact frozen v26/two-v57/v68/v82/v83 TypeScript Profile, an exact final TypeScript v84 Profile, or an exact Rust-owned v85/v86/v87/v88/v89/v90/v91/v92 Profile. Empty Profiles are created directly as Rust-owned v92. Legacy imports and v85/v86/v87/v88/v89/v90/v91 upgrades are validated and backed up before one-way v92 publication; any unfrozen lineage, physical drift, owner ambiguity, future version, or damaged native inventory fails before readiness. The v87 tab-table, v88 projection-impact, v89 Thread-clock, v90 Session-view-authority, v91 sidebar-rank, and v92 canonical-`TEXT`-timestamp migrations each run transactionally, so a failure restores the original Store and leaves the migration backup recoverable. A journal restores the complete old database, WAL/SHM, and asset tree after interruption before publication cleanup, while the immutable source backup is retained. IPC, schedulers, and windows remain stopped until Core reports the validated v92 generation ready.
- Runtime import/startup failures are handled in bootstrap by destroying any windows, writing a bootstrap log entry under `${NODEX_HOME}/logs`, showing a native `Nodex failed to start` dialog, and quitting.
- Stale Page/property writes with expected revisions return typed conflict payloads (`status: "conflict"`) and do not apply partial updates.
- Backup restore failures surface explicit error responses.
- Reminder delivery is at-least-once before settlement, then effectively exactly-once per `(project_id, page_id, occurrence_start, offset)` via receipt uniqueness.
- Missing Codex CLI binary surfaces explicit `missingBinary` connection status in UI.
- `codex-service` defers absent staged/bundled runtime handling until the client actually starts, while a materialized Open Interpreter runtime must pass its release-lock and manifest contracts before app-server launch. The lock independently binds the full upstream source commit, every ordered build patch, the Nodex artifact repository/tag, both architecture-specific archives, and the experimental app-server schema fingerprint; a floating branch or an artifact URL outside that release is invalid. Every staged artifact is a regular file with recorded size, SHA-256, and executable mode, every declared search-path tool is executable, the runtime version matches the lock, and initialize must resolve the expected isolated state home at `${NODEX_HOME}/agent`.
- Packaged builds mount one pinned Open Interpreter closure directly at `Contents/Resources`: `interpreter` and `codex-code-mode-host` share `Resources/bin` with the Nodex executables, one canonical `Resources/codex-path/rg` serves both runtimes, and the patched zsh remains at the upstream-required `Resources/codex-resources/zsh/bin/zsh`. `agent-runtime.json`, `codex-package.json`, Open Interpreter notices, and reviewed source-patch evidence live at that same package root. Dev/unpackaged runs retain `.generated/codex-runtime/agent-runtime` as an atomic staging ownership boundary while preserving the same package-relative paths. Staging downloads the architecture-specific locked archive, checks archive and inner artifact evidence, installs atomically, retains Apache-2.0 license/NOTICE material without duplicating the `i` executable alias, and rejects wrong-architecture or non-executable outputs before packaging.
- Desktop Tool automation is a separately sealed closure at `browser-runtime/`
  inside the Agent runtime. A committed release lock requires exact arm64 and
  x64 assets and binds each immutable HTTPS archive by byte size, archive
  SHA-256, inner manifest SHA-256, source desktop build/build number, Codex
  compatibility version, Browser plugin version, CUA runtime version, Node
  version, Codex CLI version, and architecture-specific native-artifact hashes.
  Normal development, CI, and packaging materialize only this lock into a
  generated source closure; they never inspect `/Applications` or another
  installed desktop app. Local desktop extraction is an explicit
  maintainer-only vendor operation. The schema-v4 inner manifest binds the
  complete Browser and architecture-optional Computer Use closure: exact signed
  Codex CLI, Node, Node REPL, Browser/Computer Use plugin, native PiP bridge,
  `sky.node`, helper app, peer-authorization paths, artifact sizes and SHA-256
  values, Node module directories, signing-team metadata, and supported
  backends. Materialization rejects unsafe archive entries and verifies the
  complete declared closure before atomic publication; staging verifies it
  again before activation. A missing, incompatible, tampered, symlinked, or
  wrong-target closure produces an explicit unavailable reason and leaves
  ordinary Agent runtime startup usable, while release packaging requires the
  target closure to be present.
- Thread start, resume, heartbeat resume, and fork obtain Browser-use app-server configuration through the same thread-config seam. That seam emits pinned verified paths and client hashes, limits trusted code to the bundled Browser plugin root, mirrors the macOS shell policy, and advertises only backends supplied by the active host capability; it never enables trust-all code or experimental thread-config endpoints. The same capability controls native-pipe activation and Browser bundled-plugin eligibility. If it becomes unavailable, the managed plugin is uninstalled and skills are reloaded before another thread can receive Browser configuration, preventing a visible skill with no provider.
- Packaged macOS runs require production peer authorization. In unpackaged development, Browser capability still comes from the verified runtime and supported platform; the native pipe relies on its current-user-owned `0700` directory and `0600` socket, matching the upstream development policy. `CODEX_BROWSER_USE_PEER_AUTHORIZATION=1` is an explicit opt-in to native development peer verification, not a feature-enable flag, and isolated-run supervision preserves rather than invents that policy. The chosen mode is logged independently from backend availability.
- A not-yet-materialized Thread may initially capture conversation-backed Browser routing under its Project Session identity. Arrival of the canonical Codex session closes any matching provisional backend before publishing the canonical pipe, and the transition also waits for an in-flight provisional startup. A Project Scene Browser instead routes under its canonical Project owner key and registers no `codexSessionId`; it can browse normally, while actions that add Browser context to an agent remain unavailable until a Conversation exists. Projectless tasks are valid with `projectId: null`. This keeps discovery at one pipe per live Codex session and prevents first-turn races from leaving stale candidates.
- App-server initialization must advertise `mcpServerOpenaiFormElicitation`. Browser origin consent is delivered as an app-server request and must receive the renderer's structured response; without that negotiated capability, the plugin can load and connect while its first navigation remains blocked before CDP. Native-pipe request lifecycle logs record only bounded method labels and durations, never command parameters or URLs, so this failure boundary remains diagnosable without leaking browsing data.
- Browser native-pipe framing owns connection isolation, authorization, and frame bounds, but does not impose a second request deadline around its handler. Main owns a fixed 20-second deadline for each CDP operation and deliberately ignores plugin-provided `timeoutMs` and `preserveDebuggerOnTimeout` hints; this prevents a 2–5 second client hint from truncating host-side paint synchronization while preserving a single bounded command lifecycle.
- A `Page.captureScreenshot` request with `captureBeyondViewport: true` and a finite positive `clip` temporarily sizes the Browser guest to the rounded-up clip through the central renderer webview manager, whether that guest is currently presented or retained. Hidden painting stays at `(0, 0)` with near-transparent opacity, no pointer events, explicit paint/size containment, and compositor promotion. Main polls `Page.getLayoutMetrics` for at most one second before issuing the screenshot, then restores the normal surface in `finally`. Metric read failure or a slow renderer does not extend the synchronization indefinitely.
- macOS packaging re-signs embedded Open Interpreter and native Nodex artifacts
  under the enclosing Nodex Developer ID identity, but preserves and restores
  the complete vendor-signed Desktop Tool closure after that outer signing pass.
  Because either operation can change Mach-O bytes, the custom signing boundary
  refreshes `agent-runtime.json`, `browser-runtime-manifest.json`, and
  `rust-core-runtime.json` from their final nested artifacts and reseals only the
  outer app before notarization. Structural packaged verification requires
  Nodex-owned executables to match the enclosing app, Desktop Tool artifacts to
  match their manifest-specific signing teams, and every manifest digest to
  match the final artifact. Distribution runs the stateful runtime smoke exactly
  once per architecture against the extracted, notarized ZIP App, while the
  mounted DMG is structural-only and must share its version, bundle, team, and
  sealed provenance. The smoke requires the manifest Core SHA-256 to equal
  Core's authenticated self identity, two selector launches to reuse one
  PID/start nonce, a real symlinked CLI workflow, Browser native-pipe
  conformance, and Computer Use conformance when the architecture advertises it.
  The Desktop Tool probe is relaunched as a temporary LaunchServices background
  app so the native helper inherits the same ordinary desktop stdio context as
  a packaged Electron launch; running it under a CI pipe can otherwise propagate
  macOS guarded file descriptors into the helper.
- Local macOS source deployment asks electron-builder for an unpacked App in a
  unique generated directory and installs that verified bundle directly. Its
  Sparkle runtime is explicitly disabled and has no feed URL. Sealed package
  provenance binds that capability together with `app.asar`, the framework and
  addon, and final native/Agent/Browser manifests, so neither a partial package
  nor a stale same-version App can pass installation verification. Source,
  staging, and installed copies receive structural verification only;
  byte-identical provenance makes repeated Core, migration, Browser-helper, or
  Page/ripgrep smoke runs redundant.
- Nodex never falls back to a system `codex` or `interpreter` binary from `PATH`. The committed protocol is generated from the actual pinned runtime, while a stock Codex schema comparison rejects accidental removal of the shared request surface.
- Credential changes invalidate the provider catalog and restart the app-server immediately when idle. If a turn is active, the restart is marked pending, new work is rejected until the active turn reaches a terminal notification, and the restart then applies the new environment before another start or turn request.
- Permission-state reads degrade to a local fallback when the pinned Agent app-server runtime cannot start, so settings and approval fallback logic do not crash before the missing-runtime connection state can be surfaced.
- App-update IPC/status calls in unpackaged builds and non-macOS builds return explicit `unsupported` status and do not attempt network update checks.
- Approval, permission, user-input, MCP elicitation, private picker, and dynamic-tool pending transport requests are rejected on Codex service shutdown to prevent hung renderer promises. Conversation request state remains separate from those process-local promise registries.
- A task without executable `nodex_app@5` in its durable launch catalog receives `tool_catalog_stale` with a start-new-task recovery instead of a resume-time contract mutation. Earlier records remain transcript-readable but cannot execute against current semantics. Projectless tasks cannot acquire Nodex Project or Library authority. Direct primary-Database and `read_write`-grant operations do not require a renderer. A consent-eligible resource without an existing task overlay requires an active renderer presenting the direct task or its root task; canonical state ownership is irrelevant. The authorization card is reapplied as a renderer-local overlay across main-owned and follower snapshots, and terminal Turn state cancels it. Full-access Library operations do not depend on renderer presentation, but exact Turn/root/Project/Profile/Library/store-epoch drift still denies execution.
- Complete canonical Nested Markdown is all-or-error at the v3 Agent boundary: a size-limited read never returns a writable truncation. Exact patches match `oldMarkdown` fragments against one current source, must not overlap, and apply all-or-nothing without a whole-Document validator; structural insertion uses stable Block anchors. Whole replacement and identity-destructive Block operations require a matching operation-scoped ETag, explicit protected-owner intent, and fresh destructive consent. Internal kernels may retain NFM names for the same canonical representation.
- Codex thread start tolerates rollout materialization lag (`empty session file`) by degrading to summary-only thread reads until full turn history becomes available.
- Codex follow-up turns tolerate app-server cold state after app restart: if `turn/start` reports `thread not found` for a persisted thread, the service issues `thread/resume` and retries once.
- Generic MCP server status is app-host metadata, so cold, archived, or still-resuming thread views may read it without loading a thread into app-server memory. Its shared IPC/query key omits `threadId`; only genuinely thread-scoped operations such as MCP resource reads participate in the thread lifecycle. ChatGPT Apps/Connectors remain product-disabled until Nodex owns their complete user experience: renderer consumers use fallback metadata, main returns an empty catalog without sending `app/list`, and unsolicited `app/list/updated` notifications are ignored.
- Snapshot requests never call `thread/read` or `thread/resume`; they rebroadcast the current canonical manager record and lazily bootstrap that manager record from persisted session artifacts when a linked thread has not been loaded yet.
- Renderer-owned resume returns the hydrated snapshot without a main-provided stream revision. The renderer materializes that canonical snapshot, seeds its owner publish cursor from the current local revision, releases the resume buffer, then publishes the latest owner snapshot after any released notifications have reduced. On failure, resume releases the buffer and rolls local state back to `needs_resume`.
- Sidebar snapshot and sync requests also avoid transcript hydration. They only use app-server thread metadata and SQLite session/link state; disconnected or missing app-server state falls back to the SQLite read model until the next successful refresh.
- App-server archive notifications update `codex_threads.archived`, clear the global pin/unread sidebar state, and archive linked sessions so active sidebar queries hide the row. Delete notifications clear global pin state, detach and unlink the thread, and archive linked sessions instead of leaving visible blank fallback rows. Unarchive notifications restore only the thread read model; session restoration remains an explicit archive-page/user action.
- Codex item hydration dedupes equivalent textual messages (`userMessage`, `assistantMessage`, `plan`, `reasoning`) across replay/live ID mismatches (for example synthetic `item-<n>` IDs from reads vs live `msg_*`/`rs_*` IDs) so follow-up text does not render twice.
- Backend log serialization is bounded (string/object/array limits) so debugging stays available even when services encounter unexpectedly large payloads.

## Release Reliability

- `package.json`, the Cargo workspace and lock, packaged app metadata, native
  runtime manifest, and CLI version form one Release Identity. A release
  transition changes exactly `package.json`, `Cargo.toml`, `Cargo.lock`, and
  `CHANGELOG.md`; any other parent diff fails closed.
- CI and release are separate Modules. Untrusted PR code sees read-only tokens
  and no environments. A stable `CI / required` aggregator records whether all
  change-selected source/runtime gates succeeded. Production release begins
  only from the successful CI run for a protected-main push.
- Distribution checks out one exact clean commit independently on native arm64
  and Intel runners. Each architecture manifest binds its source tree, runtime
  locks, prepared-build generation, package provenance, runner/toolchain, and
  artifact hashes. A protected per-architecture Sparkle finalizer accepts only
  verified schema-2 release history, uses the pinned official generator, and
  round-trips every emitted delta before assembly. Assembly accepts only
  matching build/update manifests and revalidates the full ZIP and every
  appcast/delta digest before producing the Release Bundle.
- Promotion is tag-last: it creates the stable tag only after both signed and
  notarized builds, fresh ZIP launches, mounted-DMG verification, and bundle
  assembly succeed. Existing tags never move. Draft recovery uploads only
  missing assets whose existing hashes agree; published immutable assets are
  never replaced.
- GitHub Release is Sparkle's immutable data plane. Stable app releases use
  `vX.Y.Z` and become Latest, while the two architecture-specific signed
  appcasts are projected to stable Pages URLs only after the release has been
  re-downloaded and verified. A projection cannot move a feed backwards or
  replace the same version with different bytes. Ordinary landing deployments
  preserve the target repository's `updates/` tree. Browser runtime releases
  use a separate tag namespace, are explicitly published with
  `--latest=false`, and must prove that Latest did not change.
- Homebrew and landing are downstream Adapters. Homebrew derives both checksums
  from `release-bundle.json` and binds URLs to the immutable version tag; the
  landing page consumes the stable Latest aliases and deploys release metadata
  only after remote release verification. A downstream failure is retryable
  without modifying the published app release.
- `Distribution Rehearsal` invokes the same deep dual-architecture
  Implementation with production signing but without release, repository-write,
  tap, landing, or Sentry-upload authority. It receives only the protected
  Sparkle finalization environment secret needed to prove signed appcast and
  delta generation.

## Operational Checks
- For read-model or Core transport changes, run
  `pnpm run core:read-budget-gate -- --profile .generated/<fresh-name>` and
  retain its printed byte counts, request count, integrity results, and query
  plan in the handoff. An ordinary response near 16 MiB is a contract bug even
  if transport accepts it; interactive collection windows should remain below
  their 1 MiB semantic budget.
- Before release: run `pnpm run verify:source` and, on macOS,
  `pnpm run verify:runtime:mac`. `pnpm test:all` is only a compatibility alias
  for the source gate; it does not replace a dual-architecture Distribution
  rehearsal.
- Release macOS packaging uploads hidden source maps to Sentry only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are present; `.map` files remain excluded from packaged artifacts.
- Before enabling CI signing secrets: do one local notarization dry run and verify `codesign --verify --deep --strict`, `spctl --assess --type open`, and `xcrun stapler validate` against the generated macOS artifacts.
- During macOS packaging validation, extract the update ZIP into a fresh install root. Verify both runtime manifests, validate every executable native artifact with `codesign --verify --strict`, require each embedded runtime executable, the Nodex native binaries, the shared `Resources/codex-path/rg`, and the helper app to share the enclosing Developer ID team, and validate the final deep app seal. The fresh install must invoke the CLI through an external symlink, cold-start and reuse one Core, complete a real `nodex rg` search through the canonical ripgrep, migrate the frozen early-v57 fixture through the packaged migrator without launcher-injected overrides, retain its source backup, and launch Electron with Cargo/Rustup unavailable and PATH restricted to operating-system tools.
- Release CI publishes only after both `arm64` and `x64` notarized artifacts,
  signed appcasts, and applicable round-tripped deltas pass verification. The
  exact Release Bundle rejects electron-updater metadata, and GitHub assets are
  re-downloaded before Homebrew or Pages projection. Downstream tap or feed
  publication can be retried through Release Recovery without changing the
  immutable release.
- The authoritative release runbook for workflow triggers, job ordering, secret requirements, artifact naming, and rerun strategy is `docs/release-macos.md`.
- Before risky migrations/refactors: create a labeled manual backup.
- Keep the deleted-Block retention count aligned with local storage constraints. It counts newest tombstoned roots, not immutable audit rows.
- Pinned manual/restore Document revisions are never automatically pruned. Unpinned revisions retain all rows for seven days, then deterministic hourly representatives through thirty days and daily representatives through ninety days, with a 500-row cap. Revision deletion never rewrites immutable mutation/change receipts; if a linked revision expires, Page Activity may still project its retained evidence.
- After large retention passes, expect incremental vacuum to reclaim free pages gradually rather than in one blocking rewrite.
