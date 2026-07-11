# Nodex Domain Context

This document defines the canonical domain language for Nodex. It describes the accepted Block-first target model, even while the implementation is migrating from the legacy Card-first schema. During the migration, code that contradicts these definitions is migration debt rather than an alternate model.

## Product boundary

Nodex is a local-first workspace for durable content and agent work. A Project provides the filesystem, execution, and data-isolation boundary. Content inside that boundary is modeled as Blocks. The user-facing name for a document-like Block is Card.

The migration from the legacy model is tracked in `.generated/block-first/EXECPLAN.md`. Accepted system-wide decisions live in `docs/adr/`.

## Canonical terms

### Space

A Space is the content scope owned by one Project. `projectId` is the isolation key for Blocks, Documents, Database records, assets, search units, and operations. Space is a domain role played by the existing Project; it is not a persisted Block type.

### Block

A Block is the only persistent content identity. Every content object has one globally unique application `blockId`, a type, lifecycle, Space, and current location. A Block can be text, media, a Card, a Database, a reference, or another registered type.

Yjs internal client and struct identifiers are implementation details. They never replace `blockId` and are not exposed as application identity.

### Card

A Card is the user-facing name for a document-bearing Block. A Card has no separate storage identity: the Card ID is its Block ID. Every Card owns exactly one Document containing its collaborative title and body.

A Card can be placed directly in a Space, nested in another Document, or shown through references and Database views. Nesting a Card moves its shell placement; it does not copy or embed the Card's owned body into the containing Document.

Card Stage resolves the owned Document with the exact `(projectId, cardBlockId)` pair. It never derives a Document ID from a Card ID or treats a Card read-model snapshot as proof of content authority. During migration the returned descriptor explicitly selects either the temporary legacy surface or the Y.Doc-primary surface.

### Document

A Document is an independently loaded, persisted, synchronized, and undo-scoped Yjs document. Its identity is `documentId`. A Card Document has exactly two named shared roots:

- `Y.Text("title")` for the Card title.
- `Y.XmlFragment("body")` for the BlockNote-compatible body tree.

No additional named shared roots are valid. The body fragment contains one canonical root `blockGroup` so every persisted ready Document can be mounted by the editor schema.

A Synced Block source Document uses `nodex.synced-block@1` and has only `Y.XmlFragment("body")`. It is not a Card and has no synthetic title root. Document schemas dispatch through an exact `(ownerType, schemaKey, schemaVersion, contentModel)` registration. BlockNote-backed Documents use `block_tree`; future scene/canvas Documents use a separate `scene_graph` Adapter with their own roots.

The Yjs state vector expresses causal synchronization state. SQLite `headSeq` expresses only the local durable append order. Neither is a content-integrity digest; persisted updates, snapshots, and reconstructed full states carry separate hashes.

Every mounted writable Document surface owns a fresh local Y.Doc/client identity. It completes a state-vector handshake before resolving and mounting the `title` and `body` roots. A retained inactive surface may keep content synchronization alive, but it clears its local Awareness state so a hidden tab does not appear present.

### Document-bearing Block

A document-bearing Block owns a Document through `block_documents`. Card and the system-managed Synced Block source are registered document-bearing types. Later types may include reusable templates, large code/documents, and canvas scenes. Ordinary paragraphs, headings, and list items remain first-class Blocks but share the nearest owning Card's Document.

Document ownership changes only through an explicit promotion or demotion operation. It never changes automatically because content became large.

Nodex intentionally models a Synced Block source as a hidden library resource. The source Block has a real Space placement so every active Block has one total relational location, but Card/Database/top-level navigation does not present it as another Card or page. Every visible occurrence, including the original promotion location, is a childless `syncedBlockRef` that stores only `sourceBlockId` and mounts the source Document independently. Exact owner lookup, history/search projection, reference expansion, and maintenance may address the source directly.

### Block shell

A Block shell is the representation of a Block inside its containing Document. For an ordinary Block, the shell and its content live together in the host Document. For a document-bearing Block, the host Document stores only its shell identity and presentation fields; the owned Document remains separate and is loaded independently.

### Placement

Placement answers where an active Block lives. A Block has exactly one content location:

- `space`: directly under a Project/Space, ordered by a fractional `rankKey`.
- `document`: inside one containing Document; parent and order are authoritative in that Yjs tree.

Top-level Space order and Database View manual order are independent orderings. Both use fractional keys and `blockId` as a stable tie-breaker. SQL rank is never authoritative for order inside a Yjs Document.

### Database

A Database is a Block with a Database capability. The capability owns property definitions, memberships, shared views, and view-specific positions. A Database remains placeable like any other Block.

### Database membership

Database membership associates an existing Card with one owning Database. A Card has zero or one active owning membership. Membership does not create a second Card, change the Card's content placement, or copy its Document.

Linked Database views and reference Blocks do not count as memberships.

### Database property

A Database property is a typed field defined by a Database capability. Values belong to the Card membership and are mutated by field/path-level operations. Scalar properties use revision-aware conflict responses. Set-like properties such as tags preserve add/remove intent.

Agent execution, recurrence, reminders, and other behavior intrinsic to a Card are generic Block properties with typed read models; they are not Database membership fields merely because a Database View displays them.

### Database View

A Database View is a durable shared query definition over one Database. It stores filter, sort, group, display, and view-specific manual positions. The active view, search text, selection, and expansion state are window-local and are not part of the durable view definition.

An inline Database View Block stores only its own `blockId` and a `databaseViewId`. The query executes over durable memberships and view configuration; result rows are read projections and never become children of the host Document.

### Reference Block

A Reference Block is a Block with its own `blockId` and a stable `targetBlockId`. It presents another Block without changing that target's placement or membership. A collapsed Card reference reads a rebuildable summary. An expanded visible Card reference mounts the target Card's independent Document surface; the foreign body never becomes content of the host Document.

A `syncedBlockRef` follows the same foreign-body rule and targets a `synced_block_source`. Promotion moves the selected subtree IDs into that source's body and allocates a new reference ID at the host location. Copy allocates fresh IDs recursively. Demotion is permitted only when exact-head projections prove a sole reference; one dual-Document fence then relocates the original IDs back, empties the source Y.Doc/projection at a new durable head, and tombstones the source resource and reference atomically.

Reference expansion is window-local. The renderer bounds simultaneously mounted referenced-Document providers per mounted surface, keeps the focused editor most-recent, and never persists expansion, visibility, or activation into either Y.Doc. Every nested surface carries its open Card ancestry, so direct and indirect cycles such as A → B → A remain summary/navigation-only. Canonical Card and Database View references are childless. An unresolved legacy reference reserves a tombstoned diagnostic Block identity so a later unrelated create cannot silently capture the target ID.

### Projection

A projection is rebuildable data derived from the authoritative Block, Document, and Database records. NFM, plain text, previews, search units, asset references, Card read models, and scheduled-card indexes are projections. A projection can lag, be discarded, and be rebuilt. It must never be used to reconstruct an already-existing Yjs Document.

Schema v62 is the first persisted property/projection foundation: `block_properties` holds Card-intrinsic agent/run/recurrence/reminder state, Database membership values hold status/priority/estimate/tags/dates/assignee, and `scheduled_card_index` is the typed scheduler read model. Schema v63 adds the resumable foreign-reference migration ledger and converts legacy Card/query snapshots into canonical `targetBlockId`/`databaseViewId` references before cutover. Schema v66 makes recurrence exceptions, reminder receipts, and reminder snoozes children of the owning Card Block rather than the compatibility `cards` row; their composite Project/Block foreign keys cascade with Block identity, and typed guards reject behavior records for non-Card Blocks. Each stable source records a semantic fingerprint, so an identical crash retry resumes one occurrence while changed live content advances to a new recovery without overwriting the prior Card. During BF-03/BF-07 migration only, legacy Card metadata is a one-way write seam into these records; it is not a second target identity or a content authority.

Schema v65 separates durable secondary evidence from rebuildable projections. `document_versions` retains user/history checkpoints independently of operational update compaction, and `block_mutations` is the idempotency/history ledger for property/location/membership operations. `block_search_units`, `block_asset_refs`, and `card_read_model` carry explicit Document generation/head or Block/property revisions and may be deleted and rebuilt. None of these tables writes into `cards`, Y.Doc state, or property authority through a trigger.

A structured property mutation is a versioned, project/store-scoped field-intent batch with one immutable `mutationId`. Scalar fields compare their own property revision rather than a whole-Card revision; set-like values apply add/remove intent against the current set. The property values, any coupled View grouping, one `metadataRevision` advance per affected Card, full Card/schedule projections, change-log cursor, and accepted or rejected receipt are one SQLite transaction. Retrying the same canonical request replays its prior outcome; the same ID can never name different intent.

Scheduler and Calendar reads begin with `scheduled_card_index`, never the wide Card row. An index row is visible only when its source metadata revision equals the current Card Block revision; title/body additionally require the ready `ydoc_primary` Document's exact current materialization. Invalid or stale index/content coordinates fail closed, and the index can be rebuilt completely from Database plus intrinsic Block properties.

For a Y.Doc-primary Card, the materialization committed with each Document head supplies title, NFM, preview, references, and assets to compatibility readers. Card/Board/reference summaries combine that exact-head content with current Block identity and Database/intrinsic properties in one SQLite read snapshot. Fanout never writes the result back through the legacy Card title/body or metadata mutation paths.

### NFM

NFM is Nodex's public text interchange format. It is used for genesis import, explicit compare-and-swap replacement, export, and materialized reads. NFM does not preserve every internal identity and is never a collaborative write authority.

### Mutation

A mutation is a durable user or agent intent applied by the single SQLite writer. Document updates, property edits, membership changes, and placements are different mutation families but share idempotency, project scoping, durable acknowledgement, history, and change-log rules.

Every logical operation that may be retried after losing its response has a caller-generated operation identity. Canonical intent, not the transport attempt, determines equality: actor and client session are immutable first-seen audit fields and never participate in the logical hash. A committed operation records one canonical Block change; a deterministic precondition rejection records only an immutable rejected receipt and no authority change. Exact retry returns the same result after restart or transport switching, while any semantic reuse of the identity is a typed collision.

Occurrence complete/skip/update is one such operation family. It mutates schedule/recurrence through typed Block/Database property authority and, when it creates an archived, detached, or future Card, clones the current source Y.Doc plus relational properties without reading or writing a compatibility Card row. The created Card UUID-v7 is derived from the logical operation, so a pre-commit retry also targets the same identity.

A Document operation batch addresses application Block IDs, not Yjs struct IDs. It may set the title or insert, update, delete, and move Blocks in order. The writer validates the entire batch on a detached current-head clone before committing one relative Yjs update and its registry, projections, mutation receipt, and change-log evidence atomically. Operations that replace or remove existing Yjs structs require a short trusted write fence and record every invalidated Block/subtree ID; an offline update that crosses such a barrier may merge only when its derived touched IDs are disjoint. Otherwise Nodex persists a recovery artifact and requires reload. A tombstoned Block ID is never a valid create/import identity.

### Relocation

A relocation is an atomic move of one or more Block subtrees between Documents or between a Document and a Space. It preserves application Block IDs. A copy is different: it allocates new IDs for the copied subtree while preserving reference targets.

Cross-Document relocation uses short-lived write fences and an ephemeral lease so active editors flush composition and pending updates before the writer validates and commits source and target changes together.

The renderer submits only a logical relocation intent: stable root Block IDs, source Document generation, and the target parent/anchor. It never supplies a guessed SQL head or location revision. The realtime Hub prepares once to establish the lease boundary, waits for every mounted source/target surface to commit IME, flush, and freeze, then prepares again so the SQLite writer receives the latest durable heads and Block location revisions. A response retry reuses the same relocation ID; the immutable ledger returns the committed result or a resync receipt after update compaction.

Schema v64 stores the immutable relocation request/result, moved-member set, source pre-relocation state, per-Document update receipts, recovery artifacts, and shared change-log cursor. A stale binary update that overlaps moved Blocks is never applied blindly: safe remaining edits may commit, while inseparable moved content becomes a durable recovery artifact and forces a typed reload boundary.

### Store epoch and Document generation

`storeEpoch` identifies one restored lifetime of the local SQLite store. It rotates after restore. `generation` identifies one reset/replacement lifetime of a Document. Durable updates and disposable client caches must match both values; old caches and outboxes are rejected rather than replayed into a restored state.

## Authority and ownership

| State | Canonical authority |
| --- | --- |
| Block identity, type, lifecycle, Space, and containing location | `blocks` |
| Card title and body content | Card Y.Doc |
| Synced Block source body | body-only Synced Block Y.Doc |
| Ordinary Block hierarchy, order, and content | nearest Card Y.Doc |
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
2. Every active Block belongs to exactly one Project/Space and has exactly one content location: directly in that Space or in one containing Document.
3. Every Card owns exactly one active Document. Registered Synced Block sources may own one body-only Document; ordinary body Blocks do not own Documents.
4. One active Card has at most one owning Database membership.
5. A reference never changes the target's location or membership and never embeds the target's body in the host Y.Doc.
6. A committed Document update is unique by `(documentId, updateId)` and is acknowledged only after its SQLite transaction commits. Its immutable receipt outlives compactable binary tail payloads, so late retries retain the original committed sequence. An update whose Yjs dependencies are not yet present is rejected for retry and does not advance the durable head.
7. `headSeq` orders local persistence; a Yjs state vector represents causal content state. Neither substitutes for the other.
8. Each mounted writable surface creates an independent Yjs client identity, including two surfaces opened by the same user in different windows.
9. Restoring history creates a new forward update in the current Document. It never rewinds or replaces the Yjs update log.
10. Deletion first tombstones identity. Ordinary create/import never reuses it; explicit history restore may reactivate the same Block and owned Document. Physical garbage collection waits until reference and history retention permits it.
11. Cross-Document relocation commits source update, target update, registry changes, indexes, ledger, history, and change log in one SQLite transaction.
12. NFM and all other projections can be rebuilt from authority. Authority is never rebuilt from an existing projection except during one-time genesis migration.
13. A retryable logical operation ID is required at its calling boundary. Transport actor/session changes do not change semantic equality; exact retry cannot advance authority twice, and a durable rejection has no change-log cursor.
14. Promotion/demotion of a Synced Block is fenced at every writable Document head. A source with more than one current reference cannot be demoted, and stale reference projections fail closed.

## Operation semantics

### Edit

A local editor transaction updates its live Y.Doc immediately. Its provider sends an idempotent binary update with the current store epoch, Document generation, client session, and declared touched Block IDs. Declared IDs are bounded diagnostics, not authority; relocation safety uses writer-derived changes. The writer tentatively applies the update against a cloned or reloadable Document, rejects unresolved dependencies, validates the resulting schema and global identity set, commits the update and derived registry/index changes, then acknowledges and fans it out. Remote-origin transactions do not echo and do not enter the local undo stack.

Card title undo and body undo are local to the mounted surface's tracked transaction origins. Awareness is ephemeral and window/session-specific rather than an edit lock. Surface close/deactivation persistence is bounded: content remains pending until durable acknowledgement or a disposable local checkpoint, and a close path must not wait forever on an offline transport. Normal fast acknowledgements render no sync chrome; only sustained pending, offline, error, or reset states become visible.

### Explicit NFM replacement

`ReplaceDocumentFromNfm` is an import seam, not a normal update path. It requires an expected Document head or state precondition, parses and validates NFM, and generates a transaction on the existing Y.Doc. It does not create a new Y.Doc or reset causal history.

Because public NFM does not encode Block IDs, replacement preserves an existing identity only when a conservative semantic/parent match is unambiguous. It allocates deterministic fresh IDs for unmatched nodes, then compiles the target BlockTree into the same stable-ID Document operation engine. It never writes a materialized NFM snapshot directly into authority.

### Move and copy

Moving within one Document is one Yjs transaction. Moving across Documents uses relocation. Moving a document-bearing Card changes only its shell placement; its owned `documentId` and body remain unchanged. Copying allocates fresh Block IDs recursively and, when copying a document-bearing Block as a new Card, allocates a fresh owned Document.

### Restore and backup

A backup is copied only while one whole-store maintenance fence has drained managed asset writes, flushed the writer FIFO, and closed both worker and main SQLite connections. A standalone read-only source performs the SQLite backup while ordinary main access fails closed. A pre-restore safety backup and the replacement happen under that same uninterrupted fence, so no accepted write can fall between them.

Restore treats SQLite, WAL state, and managed assets as one authority even though the filesystem cannot rename them atomically as a group. An fsynced restore journal makes every phase recoverable: startup rolls any pre-commit interruption back to the complete old store and finishes cleanup only after the installed DB has passed integrity/ownership/projection checks, every exact-head managed asset URI resolves to a flat regular file, and `storeEpoch` has durably rotated. The Hub then invalidates every live subscription. Old IPC/HTTP commands, Yjs outboxes, Awareness, and IndexedDB checkpoints fail closed; mounted surfaces fetch a new descriptor and state-vector sync instead of replaying old-epoch state. Snapshot compaction and user-visible history checkpoints have separate retention policies.

## Non-domain state

Presence, cursors, selections, open toggles, active Database View, search terms, focus, and relocation leases are not durable content. Project sessions, tabs, panels, and Codex thread ownership remain shell/execution concepts. Do not model them as Blocks.

## Naming rules

- Say **Card** in product surfaces, CLI commands, and Card read models.
- Say **Block** when an operation applies to all content identities.
- Say **Document** only for the independently synchronized Y.Doc owned by a document-bearing Block.
- Say **Database membership**, not row copy or embedded Card.
- Say **reference**, not embed snapshot, when a host Block points to foreign content.
- Say **projection** for derived NFM, preview, search, asset, schedule, and read-model data.
- Do not introduce another document-like product entity alongside Card.

## Code orientation during migration

The legacy Card-first authority is primarily in `src/main/local-store/schema.ts`, `src/main/local-store/cards.ts`, `src/main/local-store/history.ts`, `src/main/card-mutation-writer.ts`, `src/main/card-mutation-worker.ts`, `src/renderer/components/kanban/card-stage/use-card-stage-controller.ts`, and `src/renderer/components/kanban/editor/nfm-editor.tsx`.

The Block-first migration adds shared Block/Document Interfaces under `src/shared/`, persistence Implementations under `src/main/local-store/`, and a transport-neutral renderer provider behind `src/renderer/lib/api.ts`. Card Stage's authority boundary and writable surface live under `src/renderer/components/block-documents/`; the surface runtime and descriptor validation live under `src/renderer/lib/`. The exact paths and phased cutover are maintained in `.generated/block-first/EXECPLAN.md`.

## Decision index

- `docs/adr/0001-block-identity-card-alias.md`: one Block identity; Card is the product alias for a document-bearing Block.
- `docs/adr/0002-document-bearing-blocks-yjs.md`: per-Card Y.Doc and the distinction between first-class Blocks and Document ownership.
- `docs/adr/0003-database-membership-and-views.md`: Database capability, zero-or-one Card membership, and durable views.
- `docs/adr/0004-atomic-block-relocation.md`: atomic cross-Document moves with stable application identity.
