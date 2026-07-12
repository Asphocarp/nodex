# ADR 0005: Card has one exclusive parent and cross-surface drag is a Block transfer

- Status: Accepted
- Date: 2026-07-13
- Owners: Nodex maintainers
- Supersedes: the placement-independent membership decision in ADR 0003
- Extends: ADR 0004

## Context

Nodex currently gives a Card two independent placement coordinates. The Block registry says that the Card is either directly in a Space or inside a Document, while `database_memberships` may simultaneously say that the same Card is a row in a Database. A newly created board Card is therefore both a top-level Space Block and a Database member.

That model was sufficient while a Database was only a Kanban projection over Cards, but it is not sufficient for Block-first editing. A user dragging a Card between a Database View and a Document expects one Page-like object to move. The current model cannot answer whether that gesture moves the Card, creates a reference, only changes membership, or merely changes a view position. Renderer code consequently has to combine unrelated mutations, and an interruption can expose duplicate placement, stale view revisions, or content that appears in both surfaces.

The same ambiguity affects ordinary Blocks dragged into a Database. A Database can display only Cards, yet the editor contains paragraphs, headings, lists, media, references, and document-bearing shells. Nodex needs a precise conversion rule that preserves content and application identity where possible without embedding a foreign Card body in the host Y.Doc.

The product decisions are:

- Card remains Nodex's user-facing and internal Page-like type. There is no separate Page table, type, or Interface.
- A Card has exactly one parent: a Space, a Document, or a Database.
- Leaving a Database retains that Database's property values as dormant state. Returning to the same Database restores them.
- Drag and drop moves by default. Holding Option/Alt at drop time copies.

## Decision

### Parent is one explicit algebra

Every active Block has one relational location. Card supports all three location variants:

```ts
type BlockLocation =
  | { kind: "space"; projectId: string; rankKey: string }
  | { kind: "document"; documentId: string }
  | { kind: "database"; databaseBlockId: string };
```

The `blocks` row is the canonical parent coordinate. The schema stores `containing_document_id` and `containing_database_id` and enforces an exact exclusive-or:

- `space`: both containing IDs are null;
- `document`: only `containing_document_id` is non-null;
- `database`: only `containing_database_id` is non-null.

A Space-located Block has one `top_level_block_placements` row. A Database-located Card has one active membership whose Database exactly equals `blocks.containing_database_id`. A Document-located Block is present in that Document's current Yjs tree and materialized index. A Card may never retain two of those placements after a transaction commits.

Database Views do not own Cards. They project the children of their Database and own only query configuration and view-specific manual ordering.

This decision changes ADR 0003: membership is no longer independent of content placement. It is the typed relational placement detail for a Card whose parent is a Database. Linked views and reference Blocks remain non-owning projections.

### A nested Card is a real childless shell

When a Card is inside another Document, the host Y.Doc contains a childless `card` shell whose application `blockId` is exactly the Card ID. The Card's title and body remain in its separately owned Y.Doc. Expanding the shell mounts that owned Document lazily; the body is never copied into the host Y.Doc.

`cardRef` remains a separate reference type with its own Block ID and a `targetBlockId`. Moving a `cardRef` moves the reference Block, never its target Card. A reference may be wrapped in a new Card when a Database target requires a row, but it cannot silently reparent the referenced Card.

Moving a document-bearing Card changes the shell/parent only. Its owned `documentId`, generation, Yjs history, title, body, and ordinary descendant IDs are unchanged. Ownership cycles are rejected: a Card cannot be placed in its own owned Document or below any descendant ownership edge.

### Database properties are membership-scoped and can be dormant

Database property values remain scoped to a stable membership identity. Removing a Card from a Database sets that membership's `removed_at` and retains its values. Dormant memberships and values are excluded from Database queries, scheduler/read-model assembly, View positions, and property mutation targets.

Returning the Card to the same Database reactivates the most recent matching membership and its exact values, increments its revision, and applies any explicit target group/status and position intent. It does not allocate a second membership or copy values.

Moving to another Database leaves the source membership dormant. The target reuses its own dormant membership if one exists. Otherwise it creates a membership and maps only compatible source values. Compatibility is determined by a stable semantic property key plus value type, with option values mapped by stable option identity or normalized option name when unambiguous. Incompatible source values remain dormant in the source Database and are never coerced silently.

Card title is not a Database property value. Database APIs expose a virtual title field backed by the Card's `Y.Text("title")`, avoiding a second title authority.

### One versioned `TransferBlocks` command owns cross-surface semantics

All same-Project moves and copies between Space, Document, and Database surfaces use one versioned, idempotent command. The logical request contains:

- a caller-retained `operationId`, Project and store epoch;
- `mode: "move" | "copy"`;
- one or more root Block IDs;
- exact logical source coordinates;
- a target Space, Document parent/anchor, or Database/View/group/anchor;
- trusted transport/session evidence added at the host boundary.

The renderer never performs “create target, then delete source”, never guesses a Database revision after an optimistic reorder, and never sends serialized NFM as the authority for a move. It submits intent and reconciles from the committed result.

The authority classifies the roots and applies these rules:

1. Ordinary Block to Document preserves its Block ID on move. Existing cross-Document Y.Xml relocation remains the low-level primitive. Space has no body container, so an ordinary content root leaving a Document for Space is compiled into a Card parent just like a Database target: text-like roots promote in place and other roots receive a wrapper Card.
2. Card between Space, Document, and Database preserves the Card ID and owned Document. The transaction changes only its parent shell/placement/membership and derived projections.
3. A compatible text-like Block moved to Space or a Database is promoted to a Card using the same root Block ID. Its primary text becomes the Card title and its remaining content/children become the new owned Card body.
4. Media, reference, void, or already document-bearing roots moved to Space or a Database are wrapped by a new Card. The original subtree keeps its IDs and becomes content of the new Card's owned Document.
5. Copy leaves every source unchanged and allocates canonical UUID-v7 Block IDs for the copied ownership closure inside the committing transaction. Coercion then runs on those fresh identities: a promotable source root maps directly to the fresh Card ID, while only wrapper-required roots receive an additional Card. Reference target IDs remain unchanged.

Multi-root transfer is all-or-nothing. Promotion, wrapping, membership/property changes, source/target Y.Doc updates, Block locations, materialized indexes, view positions, history, operation receipt, and change log commit in one SQLite transaction.

### Copy traverses ownership, references do not

Copying a subtree recursively follows `block_documents` ownership. A copied nested Card receives a fresh Card ID, owned Document ID, ordinary descendant IDs, membership identities, and operation-local Yjs structs. Nested document-bearing Blocks follow the same rule. Reference Blocks are copied as references to their original targets.

The copy planner allocates UUID-v7 content identities only inside the outer SQLite transaction. A pre-commit failure rolls them back and may allocate another unused set on retry; a committed operation persists the complete mapping in its immutable receipt, so response-loss retry returns the same clone without recompiling or allocating again. Non-content Document identities may remain operation-derived. The planner validates the full ownership closure and rejects cycles, duplicate application IDs, unsupported owner schemas, or stale Document heads before writing.

### Move/copy intent is sampled at drop time

Drag sources advertise `copyMove`. The UI resolves the current operation from the drop event's Option/Alt modifier, not only from `dragstart`, because the modifier may change during the gesture. The same resolver drives the cursor/drop effect, indicator wording, accessibility announcement, and submitted `TransferBlocks.mode`.

The HTML `dropEffect` is feedback only; it never decides persistence semantics. Keyboard or menu alternatives invoke the same command.

Cross-window drag and drop is not a separate domain operation. If a transport can carry the versioned drag payload and current modifier safely, it calls `TransferBlocks`; otherwise the UI fails closed without a partial mutation.

### Durability and concurrency

The single SQLite writer remains the authority. Before compiling a transfer, the realtime Hub acquires sorted leases for every affected writable Document. Mounted surfaces complete IME, flush pending updates, freeze, and acknowledge. The writer then re-reads exact heads and location/membership revisions and compiles against current durable state.

The command records an immutable receipt keyed by `operationId` and canonical intent. Exact retry returns the original result; semantic ID reuse is a typed collision. A stale source, target, location, membership, or View anchor fails without mutation. A crash before commit exposes the old state. A lost response after commit is recovered from the receipt and state-vector synchronization.

The writer publishes committed Board/query invalidations and Document updates only after commit. Renderers do not optimistically remove or create authoritative rows; they may show transient drag affordances and then reconcile to the returned authoritative summary.

Cross-Project Card transfer remains a separate operation because it changes the Space/security boundary and recursively rewrites Project coordinates. It may reuse the ownership traversal and property mapping primitives but not the same public command in this migration.

## Consequences

The model gains one answer to “where is this Card?” and one durable meaning for a cross-surface drop. A Database row, a nested Card shell, and a top-level Card are three placements of the same identity rather than overlapping representations.

Existing stores require a schema migration. Every Card with an active membership becomes Database-located and loses its legacy top-level placement. A Card without membership keeps its existing Space or Document location. Any legacy Card that is both Document-located and actively a Database member is invalid and causes migration to fail closed with diagnostic evidence.

Several existing Interfaces must change together: Block location types, Card lifecycle creation, membership management, Card read models, scheduler/search queries, retention/project transfer, real Card shell schemas, deep clone, relocation orchestration, Electron/HTTP transports, and renderer DnD. During migration there must be no long-lived path that independently updates membership and location.

The operation is deliberately broader than a UI-specific DnD patch. It reduces conceptual complexity by making drag, menu move, keyboard move, Agent operations, and future automation share the same domain command.

Dormant values increase retained relational data. Retention GC may remove them only when the owning Card or Database is permanently collected and history/reference policy allows it. Product UI can later expose “clear properties from previous Database” as an explicit destructive action.

## Invariants

1. Every active Card has exactly one parent: Space, Document, or Database.
2. A Database-located Card has exactly one matching active membership; a non-Database-located Card has none.
3. Only a Space-located Block has a top-level placement.
4. A Document-located Card has exactly one same-ID childless shell in the containing Y.Doc and keeps its owned body in its own Y.Doc.
5. A Database View never owns or duplicates a Card.
6. Dormant membership values are inert but recoverable.
7. Move preserves application identity and ownership; copy allocates a fresh ownership closure.
8. References preserve target identity and never imply target movement.
9. A transfer is idempotent and commits all affected authority/projections or none.
10. Default DnD is Move; Option/Alt at drop time is Copy.
11. An ordinary content Block is never persisted directly in Space: it belongs to a Document or is represented by a document-bearing Card parent.

## Alternatives considered

Keeping membership independent from placement preserves less migration work but leaves the user-visible object with two parents and keeps DnD semantics ambiguous.

Always creating a `cardRef` in Documents avoids reparenting but makes a drag labeled Move behave like a link operation and prevents Database rows from behaving as movable Card/Page objects.

Always wrapping any Block moved to a Database is mechanically simple but needlessly changes identity for text-like Blocks that can safely become Cards. Always coercing in place is unsafe for media, references, and existing document-bearing owners.

Deleting property values on Database exit is simple but turns a placement change into hidden data loss. Treating dormant values as active would leak stale status, schedule, and query behavior outside their schema.

Implementing separate Kanban-to-editor and editor-to-Kanban commands duplicates leases, idempotency, identity mapping, and failure semantics. A single transfer command provides the smaller long-term model.

## References

- [Notion's block data model](https://www.notion.com/blog/data-model-behind-notion)
- [Notion API page parent model](https://developers.notion.com/reference/page)
- [Notion API move page endpoint](https://developers.notion.com/reference/move-page)
- [MDN `DataTransfer.dropEffect`](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/dropEffect)
- [Apple drag-and-drop copy modifier](https://support.apple.com/guide/mac-help/drag-and-drop-items-mh35852/mac)
