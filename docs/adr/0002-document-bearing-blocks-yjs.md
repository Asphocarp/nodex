# ADR 0002: Document-bearing Blocks use explicitly registered Yjs Documents

- Status: Accepted
- Date: 2026-07-11
- Owners: Nodex maintainers

## Context

The legacy Card editor serializes a whole BlockNote document to NFM, debounces the snapshot, and later replaces editor content when another window's Card snapshot arrives. Two windows therefore edit separate snapshots rather than one shared causal document. A later full save can overwrite an earlier save, and deferring external replacement merely delays the conflict.

Making every paragraph an independent collaborative Document would produce excessive provider, persistence, loading, and undo overhead. Conversely, placing every Card body in one Space-wide Y.Doc would couple unrelated loading, retention, permissions, history, and failure domains.

## Decision

Every Card owns exactly one explicitly registered Yjs Document. It has two named roots:

- `Y.Text("title")`
- `Y.XmlFragment("body")`

These are the complete named-root set; hidden extra shared roots are invalid. The body owns one canonical BlockNote root `blockGroup`. Every active BlockNote-backed Document contains at least one registered application Block because the editor schema requires `blockGroupChild+`; semantic blank is represented by one stable-ID empty paragraph and projects to blank NFM/plain text. Genesis allocates that identity before durability, prepare idempotently repairs historical zero-Block Documents through the sole SQLite writer, and mutation/relocation boundaries cannot leave an active Document empty. Renderer-created placeholder IDs are never authority.

Title and body therefore participate in the same causal history and durable update stream. Ordinary paragraphs, headings, lists, and media are stable-ID Blocks inside the nearest Card's body fragment; they do not each own a Y.Doc.

Only selected document-bearing Block types own independent Documents. Card, Synced Block sources, Reusable Template sources, explicit Large Documents, and explicit Large Code are registered now. Canvas scenes remain a later Adapter. Promotion, instantiation, and ownership changes are explicit transactions; content size never promotes an ordinary Block.

A Synced Block source is a system-managed document-bearing Block with schema `nodex.synced-block@1`. Its Y.Doc has only `Y.XmlFragment("body")`; it must not manufacture a Card title root. Every visible occurrence is a childless `syncedBlockRef` that stores only `sourceBlockId` and lazy-mounts the source's independent surface. Nodex deliberately uses a library-source model: the source Block has a real Space placement so its relational location is total, but normal Card/Database/top-level navigation does not present it as another Card or standalone page. Exact owner lookup, reference expansion, history, search materialization, and maintenance may address it. The original promotion location becomes the first reference; this hidden source placement is product policy, not an accidental extra page.

Promotion moves the original subtree's application Block IDs into the new source Document, creates a new UUID-v7 reference identity at the host location, and commits both Documents/registry/evidence atomically. Copy allocates fresh UUID-v7 IDs for the source body. Demotion is allowed only when exactly one current reference can be proven from exact-head projections. It requires one lease covering both host and source heads, relocates the source roots back with their existing IDs, leaves the source Y.Doc at a durable empty head/projection, and tombstones the source resource and reference in the same SQLite transaction. Typed deletion and physical GC must pass the same exact-head reference scan and reject any source with a live reference. The current BF-09 slice implements and proves the store/kernel boundary; production Hub/FIFO/transport commands remain required before this behavior is exposed to users.

The schema registry dispatches on `contentModel`. Card, Synced Block, Reusable Template, Large Document, and Large Code use `block_tree`; future canvas/scene adapters use `scene_graph` and define their own named Yjs roots. BlockNote/NFM code requests the block-tree Adapter explicitly and fails closed for another content model, so a canvas is never forced into a fake title/body tree.

Every body-only `block_tree` owner reuses one exact-root primitive rather than maintaining per-type `body` validators. Reusable Template, Large Document, and Large Code Documents have no title root. Large Code narrows the common tree contract to one childless root `codeBlock`; an update that drifts to another shape is rejected before durability.

A Reusable Template source is a library Block with an authoritative display name in intrinsic Block properties. A visible `templateRef` is childless and may retain a disposable display hint only. Instantiation is copy-on-apply: it fences the exact source and target heads, recursively allocates fresh application IDs, and inserts the copied subtree through the normal stable-ID Document operation path. Existing instances do not remain linked. Exact-head reference scanning rejects lifecycle deletion/GC while any live reference remains. Template content currently rejects nested document-bearing owner shells because a correct deep copy would also need to allocate and atomically create their owned Documents.

Large Document and Large Code are explicit visible shell types. The persisted owner type and shell node type are the same canonical identity (`largeDocument` or `largeCode`); the shell never includes the owned body. A typed creation transaction stages the owner, initializes the registered Document, and inserts the shell under one SQLite commit. The ordinary Yjs reconciliation path rejects attempts to manufacture any document-bearing owner type. Internal body Blocks continue to use history, provider, projection, compaction, and relocation Modules unchanged.

NFM projection syntax for a typed owner shell is not authority genesis. Parsing or identity-aligned replacement may preserve the shell projection, but generic NFM import must fail when no registered owner/owned Document exists. Portable copy/import requires a typed ownership operation that allocates both identities before inserting the shell.

The registry is relational (`documents` and `block_documents`). Nodex does not use Yjs subdocuments for ownership: providers still synchronize subdocuments as independent entities, while explicit registration makes loading, persistence, cache invalidation, and access checks visible in the Nodex domain.

SQLite is the local durable authority. `document_updates` stores the compactable binary Yjs replay tail, `document_update_receipts` permanently retains update identity/request hash and committed sequence, and `document_snapshots` stores verified operational full states. A provider acknowledges only after durable commit. An update that still has unresolved Yjs struct/delete dependencies after tentative application is rejected for retry rather than persisted. Yjs state vectors drive synchronization; SQLite `headSeq` is only a persistence freshness sequence, and independent hashes protect stored bytes and reconstructed state.

Each mounted writable surface creates a distinct Yjs client identity, even for two windows owned by the same user. `Y.UndoManager` tracks only local transaction origins for that surface, so remote edits are not undone locally. Awareness carries cursor/presence keyed by client session and window but is never persisted as content.

NFM is limited to genesis import, explicit compare-and-swap replacement, export, and materialized projection. `blocksToYDoc`-style conversion is permitted only for genesis. An existing collaborative Document is loaded from snapshot plus updates and is never reconstructed from NFM.

The current Reusable Template/Large Document/Large Code slice establishes the registry, store, history, relocation, summary, typed creation, reference, and instantiate kernel contracts. Production FIFO/IPC/HTTP commands and lazy authoritative-summary/owned-surface UI remain required before these operations are exposed to users.

## Consequences

Concurrent title and body edits merge through Yjs instead of competing whole-Card snapshots. Loading, undo, cache, compaction, and failure scopes align with the surface a user opens. Expanded references can mount a target Card's independent provider without copying foreign content into the host Y.Doc.

The renderer needs a transport-neutral `NodexYProvider`; Electron carries binary updates through IPC and browser clients use binary POST plus SSE fanout. Both transports must share handshake, durable acknowledgement, retry, deduplication, epoch, and generation semantics.

The writer must tentatively apply and validate updates before one SQLite transaction appends the update, advances the head, updates Block registry/materialized indexes, and records change history. A rejected update invalidates the tentative cache and reloads from durable state.

## Alternatives considered

Whole-NFM last-write-wins snapshots cannot merge concurrent intent. A Space-wide Y.Doc makes unrelated Cards one loading and failure domain. One Y.Doc per paragraph creates needless synchronization overhead. Yjs subdocuments hide no provider complexity and weaken explicit product ownership. These alternatives are rejected.
