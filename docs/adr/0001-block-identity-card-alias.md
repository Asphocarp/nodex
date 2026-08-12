# ADR 0001: Block identity and the Card product alias

- Status: Superseded in part by ADR 0017
- Date: 2026-07-11
- Owners: Nodex maintainers

## Current applicability

ADR 0017 replaces Project/Space content ownership with Library ownership and
adopts Page as the durable document-bearing product noun. This ADR remains
authoritative for one stable Block identity and for references not owning their
targets; its Project/Space and Card placement vocabulary is historical.

## Context

The legacy data model makes `cards` a wide storage aggregate: one row owns identity, title, body text, board placement, properties, scheduling fields, and revisions. Editor content also contains paragraph-like objects and embedded Card snapshots, but those objects do not share one stable identity model. This causes duplicated ownership and makes operations such as nested content, references, block-level agent edits, and concurrent editing cross several incompatible seams.

Nodex needs one answer to “what content object is this?” while retaining Card as the product language users already understand. Project already owns filesystem, agent execution, and data isolation, so turning Project into content would conflate two domains.

## Decision

`Block` is the only persistent application content identity. `blocks.id` is a globally unique `blockId` and records the Block's Project/Space, type, lifecycle, location kind, location revision, and metadata revision.

Card is a user-facing alias and typed read model for a document-bearing Block. A Card ID is exactly its Block ID. There is no parallel Card storage identity and no second document-like content entity.

Project plays the Space role and remains outside the Block tree. Project sessions, tabs, panels, and Codex execution state also remain outside the Block content model.

Each active Block has one location:

- directly in a Space, with a relational fractional rank; or
- in one containing Document, with hierarchy and order represented by that Yjs tree.

A document-bearing Block may own a Document independently of where its shell is placed. A reference Block has its own identity and points to a target Block without changing target placement.

Yjs client and struct identifiers are never application Block IDs. Body nodes carry stable application IDs that can be validated against the Block registry and retained through persistence, compaction, and moves.

## Consequences

Card-facing UI and CLI remain stable while generic operations can address any Block by stable ID. Search, assets, history, links, and agent edits can converge on one identity. Nesting a Card moves its shell rather than copying its body.

The legacy `cards` row cannot remain a write authority. During migration it becomes a parity source, then a compatibility read adapter, and is finally removed or reduced to a derived read seam.

Every content creation/import path must allocate and register Block IDs. Every destructive operation tombstones identity before physical cleanup. Ordinary create/import may not reuse a tombstoned ID; only an explicit restore may reactivate the same Block and owned Document. Tests must prove that identities survive restart, snapshot compaction, schema migration, restore, and relocation, while copy allocates new identities.

## Alternatives considered

Keeping Card as a separate aggregate would preserve duplicate identity and force special cases into every generic Block operation. Treating Project as a Block would mix content placement with filesystem and execution isolation. Using Yjs internal identifiers as application IDs would couple durable references to one CRDT encoding and make cross-Document relocation unsafe. All three alternatives are rejected.
