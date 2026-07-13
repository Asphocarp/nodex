# ADR 0006: Card title is rich Block content and promotion preserves semantic shape

- Status: Accepted
- Date: 2026-07-13
- Owners: Nodex maintainers
- Extends: ADR 0002 and ADR 0005
- Corrects: the implemented BP-05 promotion body shape

## Context

Nodex models Card as the Page-like, document-bearing form of a Block. ADR 0002 gives each Card one owned Yjs Document with `Y.Text("title")` and `Y.XmlFragment("body")`. ADR 0005 says a compatible ordinary Block can be promoted in place when moved to Space or Database: the root identity becomes the Card identity, its primary content becomes the Card title, and its children become the Card body.

The first implementation did not preserve that semantic shape. It projected the source root to plain text for the Card title, then copied the complete source root under a fresh body Block ID. The same visible text consequently appeared once as title and again as body content. Formatting, links, and inline application objects were not part of the title authority. This made promotion a lossy, special-case compiler even though ordinary BlockNote Blocks already expose the two semantic slots Nodex needs: `content` and `children`.

The product decision is that Card title is rich text. Rich means styled text, links, and registered title-safe inline application objects, not merely a string with presentation applied after projection. Concurrent edits to that rich value must merge through the Card Y.Doc and participate in the same durable head, undo scope, history, search, and reference derivation as the body.

Nodex must preserve its explicit Document boundary. An ordinary paragraph remains inside its nearest owner's Y.Doc; it does not gain an independent Document. A Card title must remain in the Card's owned Y.Doc so moving the Card between Space, Database, and a containing Document never moves or duplicates title authority.

## Decision

### A Block has primary content and children

Nodex defines one semantic content model for transformations:

```ts
interface SemanticBlockContent {
  readonly primary: PortableRichText | null;
  readonly children: readonly BlockTreeNode[];
}
```

This is an Interface, not a new storage aggregate. Its Implementations are Adapters over existing authority:

- an ordinary BlockNote Block reads `primary` from `BlockTreeNode.content` and `children` from `BlockTreeNode.children`;
- a Card reads `primary` from its owned Y.Doc title and `children` from its owned Y.Doc body roots;
- void, media, table, reference, and document-bearing shell types may report that they have no promotable primary content.

The shared Module owns validation, portable rich-text normalization, plain-text projection, semantic hashing, reference and asset derivation, and conversion capability. Renderer DOM and React code are Implementations outside that Module.

### Card title remains `Y.Text("title")` and becomes validated rich Delta

The Card Document retains its two existing named roots:

- `Y.Text("title")`, whose Delta is the rich Card-title authority;
- `Y.XmlFragment("body")`, whose top-level BlockNote Blocks are the Card's body children.

`Y.Text` already provides concurrent rich-text formatting through Delta attributes. Nodex schema version 2 permits only a canonical bounded attribute vocabulary. The portable public representation is `PortableRichText`; raw Yjs Delta is an internal Adapter representation and does not cross Electron, HTTP, CLI, or Agent Interfaces.

The initial title-safe vocabulary includes styled text, links, line breaks, date mentions, and thread mentions. Inline application objects use a canonical atomic representation with stable semantic payload and a deterministic plain label. Attachment and Agent-configuration chips are not title-safe in the initial version. A root containing an unsupported inline object cannot be promoted in place; it follows the wrapper rule instead of dropping or flattening that object.

Validation rejects unknown attributes, invalid combinations, non-canonical payloads, excessive segment or payload counts, excessive serialized bytes, and a plain projection longer than the Card title limit. It never silently truncates. Formatting attributes do not create a second title identity. `document_materializations.title` remains the rebuildable plain projection; the projection additionally stores canonical portable rich title and its semantic hash.

The title's `Y.Text` constructor does not change. Existing plain titles are valid rich titles with empty attributes. The Card schema advances from `nodex.card@1` to `nodex.card@2`, but migration does not rotate Document generation or rebuild the Y.Doc from projection. It validates current Yjs authority, writes the v2 schema coordinate and new projections under the sole writer, and forces mounted providers whose descriptor schema changed to reload before editing.

### Promotion consumes the root and lifts its children

For a compatible root moved from a Document to Space or Database, the atomic `TransferBlocks` compiler performs this transformation:

```text
source root X                         promoted Card X
  primary: R             ->            title: R
  children: [A, B]                     body roots: [A, B]
```

Move preserves `X` as the Card ID. Copy first allocates a fresh identity for the copied root, and that copied root identity becomes the new Card ID. In both cases the source root is consumed as the owner; it is not cloned into the Card body and no replacement body-root ID is allocated. Existing children retain their application IDs on Move and receive the ordinary recursive fresh-ID mapping on Copy.

If the source root has no children, the Card body is semantically empty. The body still contains one stable-ID canonical empty paragraph because BlockNote requires at least one Block. That paragraph is editor scaffolding owned by the Card body, not a copy of the promoted root.

Promotion compiles from the exact-head authoritative Block tree, never from `document_block_index.text`, NFM, or another projection. The title codec consumes the root's portable inline content directly. The title, source deletion, child reparenting, Card type/ownership creation, target placement or membership, projections, history, immutable receipt, and change log commit in one SQLite transaction after the existing Document leases have flushed and frozen mounted writers.

### Conversion is capability-driven and lossless

Every registered Block type declares one Database/Space transfer capability:

- `promote`: the type has title-safe primary content and its active semantic state has an explicit Card mapping;
- `wrap`: the original subtree must remain intact under a newly allocated Card;
- `already_card`: only parent placement changes;
- `unsupported_legacy`: migration is required before transfer.

The static type capability is necessary but not sufficient. The exact source value is also inspected. A paragraph containing an unsupported inline object wraps even though an ordinary paragraph containing text, styles, links, or supported mentions promotes. A type-specific property such as checklist completion or code language must have an explicit mapper or force wrapping; it is never silently discarded. Presentation-only properties may be deliberately consumed, with conversion evidence recorded in the immutable transfer receipt and durable history payload.

References never cause target traversal. A reference Block that must wrap stays a reference to the same target. Media, tables, void Blocks, and existing non-Card document-bearing shells wrap by default.

### Rich title editing and operations share one authority

Card Stage replaces the plain textarea Implementation with a collaborative rich-title editor bound directly to the title `Y.Text`. The editor must preserve IME composition, Yjs relative selections, local-only undo, remote edits, the existing relocation write fence, and title length/payload validation. It renders the same portable rich-title model used by read-only title surfaces. Kanban, search, tabs, notifications, CLI text output, and accessibility names may use the plain projection; surfaces that advertise rich title render the portable projection without loading the body.

`set_title` becomes a rich-title operation. Public commands accept portable rich title, while a plain string convenience Adapter constructs one unstyled text span. A whole-title replacement remains write-fenced because it invalidates existing title structs. Normal editor transactions mutate the live Y.Text incrementally and remain merge-friendly.

Durable history stores and hashes the portable rich title, not only its plain string. Restore applies a forward rich-title replacement to the current Y.Doc. Version-1 checkpoints are read through a v1 Adapter and translate their plain title to one v2 text span; current authority is never downgraded or rebuilt from a materialized string.

Search, references, assets, summaries, and change detection derive from the exact rich title committed with the Document head. A formatting-only title edit touches the Card owner and creates durable change evidence even when the plain projection is unchanged.

## Migration and rollout

The migration is a one-way authority cutover with no long-lived dual write.

First, a headless codec proves portable rich title to Y.Text Delta to portable rich title round trips for every allowed style and title-safe inline object. Next, schema and projection storage are added while all current titles are still plain. The writer migrates each ready Card Document from schema version 1 to 2 by validating its current Y.Text and building v2 projections without changing generation or body content. A v1 read-only Adapter remains only for historical checkpoints and migration verification.

After every current Card has v2 parity, Card Stage and operation transports cut over to rich title. Finally, promotion and Copy cut over to the semantic transformation Module and the duplicated-root compiler is deleted. Existing Cards known from immutable transfer evidence to contain the old duplicated promotion shape are repaired by a writer migration only when the evidence and exact current shape prove the duplicate; ambiguous content fails closed for explicit review. Since Nodex has no production user data, development stores may instead be recreated when an unambiguous repair is not worth preserving.

Provider descriptors include schema version. A mounted v1 surface cannot submit a v2 rich-title update. Startup migration finishes before windows mount; a stale browser or renderer must reload its descriptor. No store-epoch rotation is required because authority lifetime did not change, but stale schema clients fail closed.

## Consequences

Block-to-Card promotion matches the Block-first mental model. The root identity becomes the Card identity, its own content becomes title, and its children become body without duplicated text or application IDs. Rich formatting, links, and supported mentions survive promotion and concurrent editing.

The existing per-Card loading, synchronization, undo, backup, compaction, and failure boundary remains intact. SQLite still owns identity/location and Yjs still owns collaborative title/body content. Database title remains a virtual property rather than a second value authority.

The shared semantic Module adds depth: promotion, Copy, Agent operations, history, import/export, search, and future type transformations use one portable rich-content model. The cost is a broader title editor and projection migration, plus explicit compatibility decisions for every custom inline object and type-specific Block property.

## Invariants

1. Card title is one canonical portable rich value backed by the Card Y.Doc `Y.Text("title")`.
2. Plain title, rich-title JSON, title hash, search rows, references, and display hints are rebuildable exact-head projections.
3. A formatting-only or inline-object title change touches the Card even when plain text is unchanged.
4. Promotion preserves the source root ID as Card ID on Move and consumes the root rather than copying it into body.
5. Promoted body roots are exactly the source root's children, except for the canonical empty paragraph required for a leaf.
6. Copy applies one recursive fresh application-ID map before the same semantic transformation.
7. Unsupported inline content or unmapped type state causes wrapping or a typed rejection, never silent loss.
8. Card title never becomes a Database property value, SQL scalar authority, or movable first body Block.
9. v1 title checkpoints restore forward into v2; live authority is never downgraded.
10. NFM and plain strings remain import/export or convenience Adapters and never become collaborative title authority.

## Alternatives considered

Keeping title plain and stripping formatting makes promotion smaller but loses user intent and cannot satisfy the rich-title product decision.

Making the first body Block the title gives title ordinary Block ordering and deletion semantics, lets body operations remove a required Database name, and makes the title identity dependent on a child. It is rejected.

Moving title to relational `block_properties` splits title and body CRDT causality, undo, durable head, and offline merge behavior. It recreates the scalar conflict that Block-first removed.

Replacing the two roots with a cosmetic `Y.Map("block")` envelope changes persistence, history, and provider schema without adding capability. The existing owned Document already supplies the owner boundary, and `Y.Text` already supports rich Delta. It is rejected.

Representing the Card owner as an ordinary same-ID Block inside its own body would make one identity both the relationally parented Card and a child occurrence in its owned Document. It would conflict with exclusive location and global Block indexing. It is rejected.

Always wrapping preserves bytes but needlessly changes identity for roots that have a lossless semantic Card mapping. Always promoting cannot preserve media, references, tables, or unsupported inline application objects. The capability-driven combination is retained.

## References

- [Yjs Y.Text rich-text Delta](https://docs.yjs.dev/api/shared-types/y.text)
- [Yjs Delta format](https://docs.yjs.dev/api/delta-format)
- [BlockNote document structure](https://www.blocknotejs.org/docs/foundations/document-structure)
- [ADR 0002](./0002-document-bearing-blocks-yjs.md)
- [ADR 0005](./0005-exclusive-card-parent-and-block-transfer.md)
