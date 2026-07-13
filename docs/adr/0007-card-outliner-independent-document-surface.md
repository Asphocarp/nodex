# ADR 0007: Card Blocks use one flat outliner surface over an independent Document

- Status: Accepted
- Date: 2026-07-13
- Owners: Nodex maintainers
- Extends: ADR 0002 and ADR 0006

## Context

Nodex has two ways to place a Card in another Card's body. A `card` Block is the exclusive child placement of that Card; a `cardRef` Block is a non-owning reference to an existing Card. Both host Blocks are intentionally childless shells. The referenced Card title and body remain authoritative in the target Card's independent Y.Doc and must never be copied into the host Y.Doc.

The first Block-first renderer preserved that authority boundary but exposed it as implementation chrome. A Card rendered as a generic document-bearing box with a file or link icon, a type label, a separate detail line, a rounded hover container, and a second editor below a vertical divider. Expanding a reference mounted an embedded Card editor that rendered the title again above the body. The result looked and behaved like an editor nested inside another editor instead of a native row in one outliner.

The product model is simpler than that presentation. Card is the Page-like form of a Block. Its title is the primary content of the Card Block and its body is the Card's children. The independent Document is a synchronization and loading boundary, not a visual container. A collapsed Card row should therefore read like a normal toggle row. Expanding it should reveal body content at the same indentation and rhythm as ordinary nested Blocks while retaining the independent target Y.Doc.

ADR 0006 makes Card title rich content stored in `Y.Text("title")`. A collapsed host cannot load every target Y.Doc merely to render that title, so the membership-independent `CardContentSummary.content.richTitle` projection is the bounded read model for collapsed rows. `CardSummary` remains a Database-row projection and must not be used to open a Card, because an exclusively nested Card has no Database membership. Once expanded, one target runtime must drive both the editable rich title in the row and the body editor. Mounting separate providers for the row and body would split undo, awareness, readiness, and lifecycle behavior and is not acceptable.

## Decision

### Card has a specialized outliner presentation

The `card` and `cardRef` schema types remain distinct because they express different ownership relationships, but they share one renderer family named the Card outliner surface. The renderer resolves both through `CardTargetReadModel`, a membership-independent boundary containing the target Card identity, target Project, lifecycle/location, exact-head content projection, and owned Document descriptor. Database property values and View positions are deliberately absent.

For `card`, the target identity is the host Block's own stable `block.id`. For `cardRef`, the target identity is `props.targetBlockId`. `props.displayHint` is only a loading, missing-target, or offline fallback; it is never current title authority.

The visual row follows the editor's native toggle geometry:

- a hollow triangular disclosure control reuses BlockNote's native toggle button geometry and 200-millisecond rotation;
- the Card rich title occupies the primary inline content position;
- target state may follow the title in the same wrapping flow instead of being laid out as a second card header; Database properties appear only when a Database View row explicitly composes them;
- the open-in-stage action appears only on hover or keyboard focus;
- there is no permanent Card/File/Link icon, type label, rounded shell border, inset card background, or vertical body divider;
- the expanded body begins one native Block indentation, 24 pixels, after the row and remains visually transparent.

Error, deleted, archived, self-reference, and cycle states retain the same row geometry. They may add a terse state token or inline recovery action, but they do not switch to a visually unrelated message box. Expansion state, visibility, and activation budget remain window-local and are not persisted into either Y.Doc.

The existing generic `OwnedDocumentReferenceSurface` remains available for body-only owners with a distinct product meaning, currently Synced Block source and Reusable Template source. Card no longer uses that generic shell.

### One expanded target runtime owns header and body

The Card outliner is composed from three layers:

1. A DOM-neutral target resolver maps `card` and `cardRef` inputs plus their read model to one typed target state.
2. A presentation/controller layer owns local expand state, viewport visibility, activation-budget admission, cycle protection, native row slots, and body indentation. This layer does not know about Yjs or BlockNote.
3. An editor Adapter lazily mounts `OwnedBlockDocumentBoundary` and exactly one `BlockDocumentSurface` for an active target. The resulting surface renders `CollaborativeCardTitle` into the row's title slot and one body-only `NfmEditor` into the body slot.

The controller's observed `<section>` is a permanent frame for the mounted Block. Loading or activating the target replaces only the title/body slots inside that frame. Replacing the observed element would detach the callback ref, reset visibility, release activation, remount the projected branch, and create a self-sustaining visible/invisible loop.

The disclosure wrapper and caret are also permanent children of that frame. Projected, loading, active, and failure renderers supply only title/body slots. They must not own or replace the caret: a CSS transition cannot animate an element that React unmounts at the same moment expansion state changes. The stable wrapper keeps native toggle width, a 32-pixel title row with 16/24 typography, and one 24-pixel body indentation while the independent target runtime changes beneath it.

Collapsed rows do not mount a target boundary, provider, or nested editor. They render canonical `CardContentSummary.content.richTitle` through a read-only portable-rich-title renderer. Loading expansion keeps the frame and title row stable and shows a skeleton only in the body slot. A ready expansion atomically replaces the projected title with the collaborative title from the target Y.Text; it does not render a second title.

The target `BlockDocumentSurface` supplies one Y.Doc, client session, awareness instance, write fence, readiness state, and local undo scope to both title and body. The nested `NfmEditor` continues to receive target Card context and extends the inline ancestor chain, so self and recursive Card references may still navigate to the Card Stage but cannot recursively mount another provider.

The host Block remains a childless shell in the host Y.Doc. Expanding, editing, loading, failing, or collapsing never calls `replaceBlocks` on the host editor and never serializes target content into host XML.

### Database rows reuse the primitive without being coupled to Card Blocks

Inline Database views may reuse the Card outliner row/controller and the same target runtime, but Database query, grouping, ordering, and property mutation remain owned by the Database view Module. This decision does not turn query rows into host Document children. The first migration may preserve the existing Database-row composition while extracting the shared primitive, provided Card and Card reference Blocks use the new unified surface and no duplicate target runtime is introduced.

## Consequences

Card blocks regain the density and scanning behavior of an outliner while retaining Block-first collaboration correctness. The visual hierarchy now expresses product semantics instead of provider boundaries. Rich title editing in an expanded row is authoritative and concurrent; the collapsed projection remains cheap, rebuildable, and valid for Cards outside every Database.

The renderer becomes more explicit: Card is not interchangeable with every document-bearing shell, and the target Document must be hoisted above both header and body. This adds a specialized Adapter but removes duplicated title chrome, permanent type icons, nested panels, and Card-specific use of the generic body-only shell.

There is no SQLite, Y.Doc schema, NFM, or persisted-data migration. The migration is a one-way renderer/read-protocol cutover. Existing `card` and `cardRef` Blocks keep their IDs and props. The former Card-reference read model and its Database-membership-dependent `CardSummary` Adapter are deleted; `card-target:resolve` is the only opening boundary. Database row readers retain explicit Database naming. Old presentation components and Card-only branches are deleted once all call sites use the new surface; no compatibility renderer remains.

## Alternatives Rejected

Projecting the target body back into host BlockNote children was rejected because it restores two authorities and makes host updates capable of overwriting or duplicating foreign Card content.

Keeping the current nested editor but removing borders was rejected because the duplicate title, provider ownership, event boundary, focus model, and loading layout would remain structurally wrong even if the CSS looked flatter.

Making every collapsed Card row mount its target Y.Doc was rejected because a long Card list would create one provider and Y.Doc per row merely to display title content already available in the exact-head read model.

Rendering expanded title from the summary projection was rejected because edits and remote formatting changes would lag the target Y.Text and title/body would not share one active collaboration runtime.

Adding a new persisted Block type for the visual row was rejected because `card` and `cardRef` already encode the only domain distinction. Presentation does not need another storage identity.

## Acceptance

In one NFM editor, a zero-membership child `card` and a `cardRef` pointing to the same Card render with the same hollow-caret outliner language. Neither shows permanent File or Link chrome. Collapsed instances create no target provider. Expanding one instance preserves the observed row element, creates one target provider, renders the collaborative rich title in the row, and renders only the target body beneath it. Editing either title or body updates the target Card Y.Doc and leaves the host Y.Doc free of foreign body content. A self or ancestor cycle remains navigable but never mounts recursively. Loading, archived, missing, and error examples are represented in Storybook, while visual verification is performed manually in the product.
