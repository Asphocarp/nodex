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

These are the complete named-root set; hidden extra shared roots are invalid. The body owns one canonical BlockNote root `blockGroup`, preventing a persisted Document that cannot be mounted by the editor schema.

Title and body therefore participate in the same causal history and durable update stream. Ordinary paragraphs, headings, lists, and media are stable-ID Blocks inside the nearest Card's body fragment; they do not each own a Y.Doc.

Only selected document-bearing Block types own independent Documents. Card is required first; synced content groups, reusable templates, large explicit code/documents, and canvas scenes may be added later through the same Module. Promotion and demotion are explicit transactions.

The registry is relational (`documents` and `block_documents`). Nodex does not use Yjs subdocuments for ownership: providers still synchronize subdocuments as independent entities, while explicit registration makes loading, persistence, cache invalidation, and access checks visible in the Nodex domain.

SQLite is the local durable authority. `document_updates` stores idempotent binary Yjs updates and `document_snapshots` stores compacted full states. A provider acknowledges only after durable commit. An update that still has unresolved Yjs struct/delete dependencies after tentative application is rejected for retry rather than persisted. Yjs state vectors drive synchronization; SQLite `headSeq` is only a persistence freshness sequence, and independent hashes protect stored bytes and reconstructed state.

Each mounted writable surface creates a distinct Yjs client identity, even for two windows owned by the same user. `Y.UndoManager` tracks only local transaction origins for that surface, so remote edits are not undone locally. Awareness carries cursor/presence keyed by client session and window but is never persisted as content.

NFM is limited to genesis import, explicit compare-and-swap replacement, export, and materialized projection. `blocksToYDoc`-style conversion is permitted only for genesis. An existing collaborative Document is loaded from snapshot plus updates and is never reconstructed from NFM.

## Consequences

Concurrent title and body edits merge through Yjs instead of competing whole-Card snapshots. Loading, undo, cache, compaction, and failure scopes align with the surface a user opens. Expanded references can mount a target Card's independent provider without copying foreign content into the host Y.Doc.

The renderer needs a transport-neutral `NodexYProvider`; Electron carries binary updates through IPC and browser clients use binary POST plus SSE fanout. Both transports must share handshake, durable acknowledgement, retry, deduplication, epoch, and generation semantics.

The writer must tentatively apply and validate updates before one SQLite transaction appends the update, advances the head, updates Block registry/materialized indexes, and records change history. A rejected update invalidates the tentative cache and reloads from durable state.

## Alternatives considered

Whole-NFM last-write-wins snapshots cannot merge concurrent intent. A Space-wide Y.Doc makes unrelated Cards one loading and failure domain. One Y.Doc per paragraph creates needless synchronization overhead. Yjs subdocuments hide no provider complexity and weaken explicit product ownership. These alternatives are rejected.
