# Nodex Domain Context

This document defines the canonical Block-first domain language for Nodex. Schema v73 implements engine-neutral Owned Documents, scene-native Canvas authority, exclusive Card parents, and stable dormant Database memberships directly. Files that can still read the former Card snapshot schema exist only to finalize a supported v69 store through v70 before normal runtime begins; they are migration code, not an alternate authority.

## Product boundary

Nodex is a local-first workspace for durable content and agent work. A Project provides the filesystem, execution, and data-isolation boundary. Content inside that boundary is modeled as Blocks. The user-facing name for a document-like Block is Card.

Accepted system-wide decisions live in `docs/adr/`. The completed development spike and its evidence remain in `.generated/block-first/` as implementation history.

## Canonical terms

### Space

A Space is the content scope owned by one Project. `projectId` is the isolation key for Blocks, Documents, Database records, assets, search units, and operations. Space is a domain role played by the existing Project; it is not a persisted Block type.

### Block

A Block is the only persistent content identity. Every content object has one globally unique application `blockId`, a type, lifecycle, Space, and current location. A Block can be text, media, a Card, a Database, a reference, or another registered type.

Yjs internal client and struct identifiers are implementation details. They never replace `blockId` and are not exposed as application identity.

Physical retention may remove the live Block row only after global reachability is disproved. The application ID then remains forever in `retired_block_identities`; no create, import, clone, relocation, or migration may reuse it. Deleting a whole Project is the only bulk physical-removal path: it runs through `BlockMutationWriter`, permanently retires every Block identity in that Space inside the deletion transaction, then revokes only those Documents from the live sync Hub after commit.

### Card

A Card is the user-facing name for a document-bearing Block. A Card has no separate storage identity: the Card ID is its Block ID. Every Card owns exactly one Document containing its collaborative title and body.

A Card has exactly one parent: a Space, another Document, or a Database. It can also be shown through non-owning references and Database views. Nesting a Card moves its shell placement; it does not copy or embed the Card's owned body into the containing Document.

Card Stage resolves the owned Document with the exact `(projectId, cardBlockId)` pair. It never derives a Document ID from a Card ID or treats a Card read model as proof of content authority. Only a ready descriptor whose registered sync engine is `yjs` may mount Card Stage; the current schema has no snapshot-editor fallback.

### Document

A Document is an independently loaded, persisted, synchronized, and history-scoped content owner. Its identity is `documentId`; its registered schema selects a content-specific sync engine. A `block_tree` Card Document uses Yjs and has exactly two named shared roots:

- `Y.Text("title")` for the Card's canonical rich title. Its validated Delta preserves supported styles, links, and inline application objects; plain title text is only a rebuildable projection.
- `Y.XmlFragment("body")` for the BlockNote-compatible body tree.

No additional named shared roots are valid. The body fragment contains one canonical root `blockGroup` so every persisted ready Document can be mounted by the editor schema.

A body-only Block Document has exactly one `Y.XmlFragment("body")` root and no synthetic title. Synced Block sources (`nodex.synced-block@1`) and Reusable Template sources (`nodex.reusable-template@1`) share one root/envelope primitive. Document schemas dispatch through an exact `(ownerType, schemaKey, schemaVersion, contentModel, syncEngine)` registration and then apply type-specific content validation. BlockNote-backed Documents use the `block_tree` content model and `yjs` engine; Canvas uses the `scene_graph` content model and `canvas_scene` engine.

The Yjs state vector expresses causal synchronization state. SQLite `headSeq` expresses only the local durable append order. Neither is a content-integrity digest; persisted updates, snapshots, and reconstructed full states carry separate hashes.

Every mounted writable `block_tree` surface owns a fresh local Y.Doc/client identity. It completes a state-vector handshake before resolving and mounting the `title` and `body` roots. A retained inactive surface may keep content synchronization alive, but it clears its local Awareness state so a hidden tab does not appear present. A mounted Canvas instead owns a scene-native provider/client session and completes a canonical scene handshake before mounting Excalidraw.

### Document-bearing Block

A document-bearing Block owns a Document through `block_documents`. Card, the system-managed Synced Block source, Reusable Template source, and Canvas are registered document-bearing types. Every Project has one deterministic primary Canvas Block whose `nodex.canvas@1` Document uses the separate `scene_graph` content model. Ordinary paragraphs, headings, lists, and code Blocks remain first-class Blocks but share the nearest owning Document and are never promoted because of size. Long-form content is modeled as a Card; size may tune loading or caching but never durable type or ownership.

A Canvas Document stores normalized Excalidraw authority in SQLite: one current portable JSON value per element, bounded durable app-state fields, ordering, and immutable managed-file metadata. Concurrent candidates resolve by Excalidraw version and version nonce, with a canonical payload-hash tie-break; absence never deletes an element, so deletion requires an explicit tombstone. Application Card references store only `targetBlockId` plus a disposable title hint. Binary image data is uploaded first and the scene mutation retains only a `nodex://assets/*` URI. Renderers durably enqueue exact mutations in a local outbox, invalidate that outbox across store-epoch or generation changes, and repair event gaps by loading the full canonical scene.

Document ownership changes only through an explicit promotion or demotion operation. It never changes automatically because content became large.

Nodex intentionally models a Synced Block source as a hidden library resource. The source Block has a real Space placement so every active Block has one total relational location, but Card/Database/top-level navigation does not present it as another Card or page. Every visible occurrence, including the original promotion location, is a childless `syncedBlockRef` that stores only `sourceBlockId` and mounts the source Document independently. Exact owner lookup, history/search projection, reference expansion, and maintenance may address the source directly.

A Reusable Template is also a library source with an authoritative human display name in intrinsic Block properties and a body-only Document. A childless `templateRef` targets the source and may carry only a disposable display hint. Instantiation reads an exact source generation/head and copies the source subtree into a target Document with fresh UUID-v7 application Block IDs; later Template edits do not mutate existing instances. Global exact-head reference scanning prevents deleting or garbage-collecting a source referenced from any Project. Deletion tombstones the complete recursively owned Block closure while retaining its Documents and immutable history for retention GC. Template content cannot contain a document-bearing owner shell until a future typed deep-clone operation can also allocate and commit the nested owned Documents.

### Block shell

A Block shell is the representation of a Block inside its containing Document. For an ordinary Block, the shell and its content live together in the host Document. For a document-bearing Block, the host Document stores only its shell identity and presentation fields; the owned Document remains separate and is loaded independently.

An inline document-bearing shell is window-local UI over that ownership boundary. Collapsed or offscreen Synced and Template shells create no provider or editor. Expanding a visible shell mounts the owner through the registered owned-Document boundary and the shared window activation budget; collapsing unmounts it. The inherited open-owner path blocks recursive Card/body-only Document cycles. A `scene_graph` owner never mounts a BlockNote body editor and remains a Canvas-view concern.

### Placement

Placement answers where an active Block lives. A Block has exactly one content location:

- `space`: directly under a Project/Space, ordered by a fractional `rankKey`.
- `document`: inside one containing Document; parent and order are authoritative in that Yjs tree.
- `database`: a Card child of one Database, with its typed placement detail in one matching active membership.

Top-level Space order and Database View manual order are independent orderings. Both use fractional keys and `blockId` as a stable tie-breaker. SQL rank is never authoritative for order inside a Yjs Document.

### Database

A Database is a Block with a Database capability. The capability owns property definitions, memberships, shared views, and view-specific positions. A Database remains placeable like any other Block.

### Database membership

Database membership is the typed placement record for an existing Card whose exclusive parent is that Database. It does not create a second Card or copy its Document. A Space- or Document-parented Card has no active membership; a Database-parented Card has exactly one matching active membership.

Leaving a Database tombstones the membership but retains its property values as dormant data. Dormant values are excluded from active queries, scheduling, summaries, and mutations. Returning to the same Database reactivates the same membership and restores those values.

Linked Database views and reference Blocks do not count as memberships.

Membership management reads all active Cards, including Cards with no membership, plus each Card's sole membership and View positions in one SQLite authority snapshot. Add, remove, and transfer therefore derive logical source/target parents without requiring the Card to be visible through any filtered View. Public callers submit that parent change through `BlockTransfer`; the Database kernel's membership transition is an internal step of the same atomic commit, never a separately callable placement authority.

### Database property

A Database property is a typed field defined by a Database capability. Values belong to the Card membership and are mutated by field/path-level operations. Scalar properties use revision-aware conflict responses. Set-like properties such as tags preserve add/remove intent.

Agent execution, recurrence, reminders, and other behavior intrinsic to a Card are generic Block properties with typed read models; they are not Database membership fields merely because a Database View displays them.

### Database View

A Database View is a durable shared query definition over one Database. It stores filter, sort, group, display, and view-specific manual positions. The active view, search text, selection, and expansion state are window-local and are not part of the durable view definition.

Renaming or changing a View addresses the selected stable `databaseViewId` and its exact revision. It never silently edits the Project's primary View merely because that View is easier to resolve.

An inline Database View Block stores only its own `blockId` and a `databaseViewId`. The query executes over durable memberships and view configuration; result rows are read projections and never become children of the host Document.

### Reference Block

A Reference Block is a Block with its own `blockId` and a stable `targetBlockId`. It presents another Block without changing that target's placement or membership. A collapsed Card reference reads a rebuildable summary. An expanded visible Card reference mounts the target Card's independent Document surface; the foreign body never becomes content of the host Document.

A `syncedBlockRef` follows the same foreign-body rule and targets a `synced_block_source`. Promotion moves the selected subtree IDs into that source's body and allocates a new reference ID at the host location. Copy allocates fresh IDs recursively. Demotion is permitted only when exact-head projections prove a sole reference; one dual-Document fence then relocates the original IDs back, empties the source Y.Doc/projection at a new durable head, and tombstones the source resource and reference atomically.

A `templateRef` follows the same foreign-body rule but has copy-on-instantiate semantics rather than live-content expansion semantics. Collapsed reference UI resolves the source's authoritative summary when the production query transport is available; its optional display hint is never the source name authority and opaque IDs are not user-facing labels.

Synced source, Template, and non-primary Canvas ownership changes use one versioned Additional Document command. The Project route and actor/session are trusted transport evidence and are rebound by Electron main or loopback HTTP. Logical intent retains `operationId`, `storeEpoch`, application identities, generations, and requested placement; only the Document Hub may renew execution heads after mounted surfaces flush and freeze. Creation and reference-guarded recursive tombstoning commit through the same receipt boundary. The CLI and renderer API submit this same envelope, and committed heads repair through the registered engine's ordinary realtime resync path rather than a second ownership channel.

Reference expansion is window-local. The renderer bounds simultaneously mounted referenced-Document providers per mounted surface, keeps the focused editor most-recent, and never persists expansion, visibility, or activation into either Y.Doc. Every nested surface carries its open Card ancestry, so direct and indirect cycles such as A → B → A remain summary/navigation-only. Canonical Card and Database View references are childless. An unresolved legacy reference reserves a tombstoned diagnostic Block identity so a later unrelated create cannot silently capture the target ID.

### Projection

A projection is rebuildable data derived from the authoritative Block, Document, and Database records. NFM, plain text, previews, search units, asset references, Card read models, and scheduled-card indexes are projections. A projection can lag, be discarded, and be rebuilt. It must never be used to reconstruct an already-existing Yjs Document.

The v70 property/projection foundation keeps Card-intrinsic agent/run/recurrence/reminder state in `block_properties`, Database membership values in typed relational records, and scheduler reads in `scheduled_card_index`. Recurrence exceptions and reminder evidence belong to the owning Card Block. Projection coordinates must match the current metadata revision or Document generation/head before a reader may use them.

Durable secondary evidence is separate from rebuildable projections. `document_versions` retains user/history checkpoints independently of operational update compaction, and `block_mutations` is the idempotency/history ledger for property/location/membership operations. `block_search_units`, `block_asset_refs`, and `card_read_model` carry explicit Document generation/head or Block/property revisions and may be deleted and rebuilt. No projection writes back into Y.Doc or property authority.

Historical schema v69 made stable Block/Document identity, rather than the current Project coordinate, the foreign-key edge for retained relocation, recovery, version, membership, and Canvas-reference evidence. Its startup finalizer drains shadow content and foreign-body references to a fixed point, repairs projections, verifies every owned Card Document, and atomically advances to v70 while dropping `cards`, legacy history/description storage, migration ledgers, the old Canvas row, and the transfer fence. Project transfer in v70 mutates only Block/Document/Database authority and rebuildable projections.

A structured property mutation is a versioned, project/store-scoped field-intent batch with one immutable `mutationId`. Scalar fields compare their own property revision rather than a whole-Card revision; set-like values apply add/remove intent against the current set. The property values, any coupled View grouping, one `metadataRevision` advance per affected Card, full Card/schedule projections, change-log cursor, and accepted or rejected receipt are one SQLite transaction. Retrying the same canonical request replays its prior outcome; the same ID can never name different intent.

Scheduler and Calendar reads begin with `scheduled_card_index`, never the wide Card row. An index row is visible only when its source metadata revision equals the current Card Block revision; title/body additionally require the ready Card Document's exact current Yjs materialization. Invalid or stale index/content coordinates fail closed, and the index can be rebuilt completely from Database plus intrinsic Block properties.

The materialization committed with each Card Document head supplies title, NFM, preview, references, and assets to Card-named read models. Card/Board/reference summaries combine that exact-head content with current Block identity and Database/intrinsic properties in one SQLite read snapshot. Fanout never writes a projection back into content or metadata authority.

### NFM

NFM is Nodex's public text interchange format. It is used for genesis import, explicit compare-and-swap replacement, export, and materialized reads. NFM does not preserve every internal identity and is never a collaborative write authority.

There is no ordinary whole-Card update transport. Card lifecycle, Block/Database properties, and Document content use separate typed commands. Retired Card creation/deletion/description endpoints return `410 Gone` with their authoritative replacements. A whole-body NFM import must use `ReplaceDocumentFromNfm` with the current Document generation and head; renderer editing always emits Yjs updates instead.

### Mutation

A mutation is a durable user or agent intent applied by the single SQLite writer. Document updates, property edits, membership changes, and placements are different mutation families but share idempotency, project scoping, durable acknowledgement, history, and change-log rules.

Every logical operation that may be retried after losing its response has a caller-generated operation identity. Canonical intent, not the transport attempt, determines equality: actor and client session are immutable first-seen audit fields and never participate in the logical hash. A committed operation records one canonical Block change; a deterministic precondition rejection records only an immutable rejected receipt and no authority change. Exact retry returns the same result after restart or transport switching, while any semantic reuse of the identity is a typed collision.

`BlockTransfer` is the sole public same-Project parent-change command. Its logical Intent contains stable root IDs, current logical source, destination anchors, and Move/Copy mode but no guessed SQL/Yjs revisions. The FIFO writer compiles exact locations, memberships, and Document heads; the Hub leases every affected mounted Document, flushes and freezes it, recompiles, then commits all Yjs, registry, placement, Database, projection, history, and receipt changes together. Copy recursively allocates fresh ownership identities and never follows reference targets. Same-parent Yjs order and Database View order remain focused in-parent operations rather than fake parent transfers.

Occurrence complete/skip/update is another operation family. It mutates schedule/recurrence through typed Block/Database property authority and, when it can create an archived, detached, or future Card, carries a preallocated UUID-v7 `createdCardId` in the canonical command intent. Exact retry therefore targets the same identity while cloning the current source Y.Doc plus relational properties without creating another Card storage aggregate.

A Document operation batch addresses application Block IDs, not Yjs struct IDs. It may set the title or insert, update, delete, and move Blocks in order. The writer validates the entire batch on a detached current-head clone before committing one relative Yjs update and its registry, projections, mutation receipt, and change-log evidence atomically. Operations that replace or remove existing Yjs structs require a short trusted write fence and record every invalidated Block/subtree ID; an offline update that crosses such a barrier may merge only when its derived touched IDs are disjoint. Otherwise Nodex persists a recovery artifact and requires reload. A tombstoned Block ID is never a valid create/import identity.

Block-to-Card transformation reads one semantic shape from exact Yjs authority: the source root's primary rich inline content and its ordered children. A losslessly promotable Move consumes the root as the Card owner, preserves that root ID as the Card ID, writes the primary content to the owned rich title, and makes the original children the Card body roots. Copy first allocates the recursive fresh-ID map and applies the same transformation. The source root is never cloned into body. Roots with unsupported inline objects or unmapped type-specific state receive a wrapper Card or a typed rejection rather than losing content.

### Relocation

A relocation is an atomic move of one or more Block subtrees between Documents or between a Document and a Space. It preserves application Block IDs. A copy is different: it allocates new IDs for the copied subtree while preserving reference targets.

Cross-Document relocation uses short-lived write fences and an ephemeral lease so active editors flush composition and pending updates before the writer validates and commits source and target changes together.

The renderer submits only a logical relocation intent: stable root Block IDs, source Document generation, and the target parent/anchor. It never supplies a guessed SQL head or location revision. The realtime Hub prepares once to establish the lease boundary, waits for every mounted source/target surface to commit IME, flush, and freeze, then prepares again so the SQLite writer receives the latest durable heads and Block location revisions. A response retry reuses the same relocation ID; the immutable ledger returns the committed result or a resync receipt after update compaction.

Schema v64 stores the immutable relocation request/result, moved-member set, source pre-relocation state, per-Document update receipts, recovery artifacts, and shared change-log cursor. A stale binary update that overlaps moved Blocks is never applied blindly: safe remaining edits may commit, while inseparable moved content becomes a durable recovery artifact and forces a typed reload boundary.

### Card Project transfer

A Card Project transfer moves one active Database-parented Card plus the complete recursively owned Document/Block closure. Traversal follows `block_documents` ownership only; Card, Database View, Synced Block, Template, and Canvas references remain external targets and are never pulled into the new Space. Every Block ID, Document ID, generation/head, and engine-specific authority identity is preserved; Yjs state vectors, persisted updates, and internal identities remain unchanged for `block_tree` Documents.

Electron, browser, renderer, and CLI callers submit only logical intent: operation ID, source/target Project, Card, target Database/View/status, and optional placement anchors. The FIFO writer first checks that intent against an immutable receipt, then compiles one exact snapshot of Block revisions, every recursively owned Document head, active Card memberships, root placement, and target schema. The realtime Hub leases every Document in that closure, lets mounted editors finish IME/flush/freeze, and asks the same FIFO to compile again; the second snapshot must retain the same logical intent/Document closure and observe every resolved head before commit.

The writer requires target properties to represent every source value, tombstones each source membership, creates fresh target membership/value/View-position identities, moves intrinsic and projection coordinates, and records one immutable `block_mutations`/`change_log` receipt. Composite Project foreign keys are deferred only for that IMMEDIATE transaction and must be fully satisfied before commit. A pre-commit failure exposes the complete old state; a lost response after commit replays the complete new receipt without reading the now-obsolete source coordinate. Commit fanout removes the source Board row, publishes the target authoritative summary, invalidates both Projects' Database queries, and forces state-vector resync for every moved Document.

### Store epoch and Document generation

`storeEpoch` identifies one restored lifetime of the local SQLite store. It rotates after restore. `generation` identifies one reset/replacement lifetime of a Document. Durable updates and disposable client caches must match both values; old caches and outboxes are rejected rather than replayed into a restored state.

## Authority and ownership

| State | Canonical authority |
| --- | --- |
| Block identity, type, lifecycle, Space, and containing location | `blocks` |
| Card title and body content | Card Y.Doc |
| Synced Block source body | body-only Synced Block Y.Doc |
| Ordinary Block hierarchy, order, and content | nearest Card Y.Doc |
| Canvas elements, durable app state, and managed-file metadata | normalized Canvas scene rows |
| Document ownership | `block_documents` |
| Top-level Space placement | `top_level_block_placements` |
| Database definitions, membership, property values, and shared views | Database relational records |
| Intrinsic Card behavior | generic Block properties plus typed read models |
| NFM, preview, search, schedule, asset, and Card summary data | rebuildable projections |
| Cursor, presence, and relocation lease | ephemeral collaboration state |
| Expansion, selection, active view, and search | window-local view state |
| Project sessions, tabs, and panels | existing shell domain |

## Invariants

1. `blocks.id` is the single application identity for content. A Card ID is a Block ID.
2. Every active Block belongs to exactly one Project/Space and has exactly one content location: Space, containing Document, or containing Database.
3. Every Card owns exactly one active Document. Registered Synced Block, Template, and Canvas owners use their registered Document schema; ordinary body Blocks do not own Documents.
4. A Database-parented active Card has exactly one matching active membership; a Space- or Document-parented Card has none.
5. A reference never changes the target's location or membership and never embeds the target's body in the host Y.Doc.
6. A committed engine mutation is idempotent by its Document-scoped mutation identity and is acknowledged only after its SQLite transaction commits. Yjs update receipts outlive compactable binary tails; Canvas mutation receipts bind the canonical scene request to its first durable outcome.
7. `headSeq` orders local persistence for every engine. A Yjs state vector represents only `yjs` causal content state; a Canvas scene hash protects only canonical scene content. None substitutes for another.
8. Each mounted writable surface creates an independent engine client session, including two surfaces opened by the same user in different windows.
9. Restoring history creates a new forward mutation in the current engine. It never rewinds a Yjs update log or replaces Canvas authority with an old snapshot.
10. Deletion first tombstones identity. Ordinary create/import never reuses it; explicit history restore may reactivate the same Block and owned Document. Physical collection keeps the newest configured tombstone count and proceeds only after exact reference/history/recovery reachability permits the entire ownership closure.
11. Cross-Document relocation commits source update, target update, registry changes, indexes, ledger, history, and change log in one SQLite transaction.
12. NFM and all other projections can be rebuilt from authority. Authority is never rebuilt from an existing projection except during one-time genesis migration.
13. A retryable logical operation ID is required at its calling boundary. Transport actor/session changes do not change semantic equality; exact retry cannot advance authority twice, and a durable rejection has no change-log cursor.
14. Promotion/demotion of a Synced Block is fenced at every writable Document head. A source with more than one current reference cannot be demoted, and stale reference projections fail closed.

## Operation semantics

### Edit

A local BlockNote editor transaction updates its live Y.Doc immediately. Its provider sends an idempotent binary update with the current store epoch, Document generation, client session, and declared touched Block IDs. Declared IDs are bounded diagnostics, not authority; relocation safety uses writer-derived changes. The writer tentatively applies the update against a cloned or reloadable Document, rejects unresolved dependencies, validates the resulting schema and global identity set, commits the update and derived registry/index changes, then acknowledges and fans it out. Remote-origin transactions do not echo and do not enter the local undo stack.

A local Canvas edit updates Excalidraw and its undo stack immediately. The scene provider coalesces observations, normalizes runtime values, uploads referenced assets, persists the exact mutation to its outbox, and sends element candidates plus app-state intent through the same durable FIFO boundary. Remote canonical scenes reconcile with `CaptureUpdateAction.NEVER`; gaps and reconnects load one full canonical scene rather than replaying guessed snapshots.

Card title undo and body undo are local to the mounted surface's tracked transaction origins. Awareness is ephemeral and window/session-specific rather than an edit lock. Surface close/deactivation persistence is bounded: content remains pending until durable acknowledgement or a disposable local checkpoint, and a close path must not wait forever on an offline transport. Normal fast acknowledgements render no sync chrome; only sustained pending, offline, error, or reset states become visible.

### Explicit NFM replacement

`ReplaceDocumentFromNfm` is an import seam, not a normal update path. It requires an expected Document head or state precondition, parses and validates NFM, and generates a transaction on the existing Y.Doc. It does not create a new Y.Doc or reset causal history.

Because public NFM does not encode Block IDs, replacement preserves an existing identity only when a conservative semantic/parent match is unambiguous. It allocates fresh UUID-v7 IDs for unmatched nodes, then compiles the target BlockTree into the same stable-ID Document operation engine. It never writes a materialized NFM snapshot directly into authority.

### Move and copy

Moving within one Document is one Yjs transaction. Moving across Documents uses relocation. Moving a document-bearing Card changes only its shell placement; its owned `documentId` and body remain unchanged. Copying allocates fresh Block IDs recursively and, when copying a document-bearing Block as a new Card, allocates a fresh owned Document.

### Restore and backup

A backup is copied only while one whole-store maintenance fence has drained managed asset writes, flushed the writer FIFO, and closed both worker and main SQLite connections. A standalone read-only source performs the SQLite backup while ordinary main access fails closed. A pre-restore safety backup and the replacement happen under that same uninterrupted fence, so no accepted write can fall between them.

Restore treats SQLite, WAL state, and managed assets as one authority even though the filesystem cannot rename them atomically as a group. An fsynced restore journal makes every phase recoverable: startup rolls any pre-commit interruption back to the complete old store and finishes cleanup only after the installed DB has passed integrity/ownership/projection checks, every exact-head managed asset URI resolves to a flat regular file, and `storeEpoch` has durably rotated. The Hub then invalidates every live subscription. Old IPC/HTTP commands, Yjs outboxes, Awareness, and IndexedDB checkpoints fail closed; mounted surfaces fetch a new descriptor and state-vector sync instead of replaying old-epoch state. Snapshot compaction and user-visible history checkpoints have separate retention policies.

## Non-domain state

Presence, cursors, selections, open toggles, search terms, focus, and relocation leases are not durable content. Project sessions, tabs, panels, and Codex thread ownership remain shell/execution concepts and are not Blocks. A durable `db_view` tab points to one stable `databaseViewId`; its temporary search, selection, and display interaction state remains window-local.

## Naming rules

- Say **Card** in product surfaces, CLI commands, and Card read models.
- Say **Block** when an operation applies to all content identities.
- Say **Document** for independently synchronized content owned by a document-bearing Block; name the `yjs` or `canvas_scene` engine when encoding matters.
- Say **Database membership**, not row copy or embedded Card.
- Say **reference**, not embed snapshot, when a host Block points to foreign content.
- Say **projection** for derived NFM, preview, search, asset, schedule, and read-model data.
- Do not introduce another document-like product entity alongside Card.

## Code orientation

Card-first migration machinery is confined to the v69→v70 schema/startup finalizer in `src/main`; its backing tables do not exist after finalization. Card-named read models are projections assembled from Block/Document/Database authority. Renderer Card Stage and NFM editing receive a prepared Document or render a fail-closed descriptor diagnostic, with no snapshot-authority branch.

Shared Block/Document Interfaces live under `src/shared/`, persistence Implementations under `src/main/local-store/`, and the transport-neutral renderer provider behind `src/renderer/lib/api.ts`. Card Stage's authority boundary and writable surface live under `src/renderer/components/block-documents/`; surface runtime and descriptor validation live under `src/renderer/lib/`. The completed spike evidence and phased cutover history remain in `.generated/block-first/EXECPLAN.md`.

## Decision index

- `docs/adr/0001-block-identity-card-alias.md`: one Block identity; Card is the product alias for a document-bearing Block.
- `docs/adr/0002-document-bearing-blocks-yjs.md`: per-Card Y.Doc and the distinction between first-class Blocks and Document ownership.
- `docs/adr/0003-database-membership-and-views.md`: Database capability, zero-or-one Card membership, and durable views.
- `docs/adr/0004-atomic-block-relocation.md`: atomic cross-Document moves with stable application identity.
- `docs/adr/0005-canvas-scene-native-sync-engine.md`: engine-neutral Owned Documents and normalized scene-native Canvas authority.
