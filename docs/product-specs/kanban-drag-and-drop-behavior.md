# Kanban Drag and Drop Behavior

## Status
- Active
- Last updated: 2026-08-09

## Scope
This spec is the detailed source of truth for drag-and-drop behavior across the Kanban board and its directly connected editor surfaces.

It covers:
- Kanban card drag within the board
- Multi-card Kanban drag
- Drag behavior while Kanban search/filter/sort rules are active
- Block drag from NFM editors into Kanban
- Kanban card drag into NFM editors
- Block drag between independently mounted NFM editor surfaces

It does not redefine general BlockNote side-menu behavior outside these Kanban-facing flows.

## Terms

### Visible cards
Cards currently rendered in the active Kanban view after applying search and toolbar filter/sort rules.

### Dragged cards
The card or card set currently being moved.

### Remaining cards
The target column after removing the dragged cards from that column.

### Visible slot
The insertion slot measured against the visible remaining cards in the rendered column.

### Persisted order
`newOrder` for Kanban card moves. This is always the insertion index after removing the dragged card or dragged cards from the target column.

This post-removal contract must stay identical across:
- Drag indicator placement
- Renderer optimistic transforms
- Backend `moveCard` / `moveCards` persistence

## Kanban Card Drag

### Pickup and preview
- Kanban card drag uses Atlassian Pragmatic Drag and Drop.
- Cards register their own draggable behavior locally.
- Board outcomes are resolved in one board-level monitor.
- The native drag preview preserves source geometry and source offset.
- While dragging, the source card stays rendered as a static ghost in place instead of live-shifting siblings.

### Same-column reorder
- Same-column reorder is measured against the remaining cards, not the raw pre-removal list.
- The insertion indicator is rendered from that same remaining-card slot space.
- Dropping between cards inserts into that exact visible gap.
- Same-column reorder must never require the user to mentally compensate for the dragged card still being visible as a ghost.

### Multi-card reorder
- Shift-click creates a temporary multi-selection.
- Dragging any selected card drags the full selected set.
- Same-column multi-card reorder preserves the dragged cards' relative order.
- Cross-column multi-card move inserts the dragged set as one block.
- Undo/redo treats the move as one grouped action.

### Cross-column move
- Dragging to another column changes card status to the target column.
- For same-project board moves, the operation stays local to the board mutation pipeline.
- Cross-column moves preserve grouped history semantics for multi-card drags.

## Filtered and Sorted Kanban

### Search and toolbar filters
- Kanban card drag remains enabled while search and toolbar filters are active.
- Reordering in a filtered view maps the visible slot back into the underlying board order.
- Hidden non-matching cards keep their relative order.
- If no visible anchor cards remain in a target column, the fallback behavior must be stable and deterministic.

### Sort-driven drag modes
- Kanban drag mode is decided by the primary sort key, not by a binary "sorted vs unsorted" check.
- `board-order` primary sort uses `manual-rank` mode.
- `priority` and `estimate` primary sorts use `property-sorted` mode.
- `created` and `title` primary sorts use `derived-move-only` mode.

### `manual-rank` mode
- When `board-order` is the primary sort key, same-column and cross-column drag both remain enabled.
- Secondary sort keys do not disable manual ranking.
- The visible slot still maps back to persisted post-removal `newOrder`.

### `property-sorted` mode
- When `priority` or `estimate` is the primary sort key, same-column drag stays enabled.
- The drop resolves to an inferred target bucket from the visible neighbor cards.
- If the dragged cards already belong to that bucket, the drop is a pure reorder inside the bucket.
- If the drop crosses buckets, the dragged cards receive one inferred property patch (`priority` or `estimate`) and then reorder using `board-order` as the intra-bucket tiebreaker.
- Grouped multi-card drags preserve relative order while sharing the same inferred property patch.

### `derived-move-only` mode
- When `created` or `title` is the primary sort key, same-column manual ranking is blocked.
- Cross-column status changes remain enabled.
- The board must explain the block with explicit feedback instead of silently no-oping the drop.
- In this mode, column drop targets stay active while card drop targets stay disabled.

### Block import while derived views are active
- Native block-drop import into Kanban stays blocked while free-text search is active.
- Structured derived views can still accept block-drop import when the board can explain the result as either an exact visible slot or a column-level create.
- Exact-slot import is allowed when newly created cards can remain in the active subset using only safe inferred workflow properties, and the resulting placement can be mapped to a persisted insertion anchor.
- Safe inferred properties are limited to workflow metadata already owned by the board/view contract, such as target column status, unambiguous priority defaults, required tags, and discrete sortable fields like priority or estimate.
- If the active sort does not support a truthful gap meaning for new cards (for example title/created ordering), the board falls back to column-level target feedback instead of an insertion line.
- Column-level import still creates cards in the hovered column, but the current sort owns their rendered position.
- The board must not invent title/description text or other search-only content just to keep a created card visible in the current query.

## Editor Interop

### NFM block -> Kanban
- Native block drag from Card Stage and independently mounted owning/reference editors into Kanban targets the Database parent, not a serialized row snapshot. The custom side-menu starts one window-local drag session only after BlockNote has established the exact root Block selection. The default operation is move; holding Alt/Option at drop time copies instead.
- Move submits one logical `BlockTransfer`: text-like roots promote to Cards in place, while non-convertible roots receive deterministic wrapper Cards. Copy recursively clones ownership with fresh IDs and leaves the source unchanged. Neither path serializes NFM nor mutates a Card description projection.
- Multi-block order follows the selected top-level document order. Nested selected blocks are represented only once through their selected ancestor.
- Pointer position determines the Kanban insert slot when block-drop import is allowed.
- The board shows truthful drag feedback for this import path.
- Empty target columns use whole-column drop feedback instead of a floating insertion line, because there is no sibling list for a truthful gap preview.
- Auto-collapsed empty columns stay collapsed and express the target with the existing column-surface highlight.

### NFM editor -> NFM editor
- An explicit side-menu drag between different Card Documents carries stable root Block IDs and logical Document coordinates through the same window-local session. The destination renders the horizontal block insertion line and suppresses ProseMirror's vertical text caret.
- The target does not insert a serialized ProseMirror/HTML slice, and the source does not later delete its selection. One `BlockTransfer` commits both Document updates and Block locations or leaves both unchanged.
- Same mounted-surface reorder remains BlockNote-native because it is already one Yjs transaction in one Document. Two separately mounted surfaces over the same logical Document fail closed until a stable-ID single-Document move command is available.
- In nested Card outliners, the closest `.nfm-editor` to the event target owns the drop. An outer editor capture listener must not steal a drop intended for an embedded Card body.

### Kanban card -> NFM editor
- Dragging one or more ordered Kanban Cards into a Card Stage or independently mounted reference editor moves the real same-ID, childless Card shells into the target Document. Their separately owned title/body Documents are unchanged.
- Move is the default. Holding Alt/Option at drop time copies each recursive ownership closure with fresh application IDs and preserves the source Cards.
- The target editor shows pending feedback but does not insert or remove authority optimistically. `BlockTransfer` commits the source Database parent, target Y.Doc shells, projections, and receipt together; failure leaves both surfaces unchanged.
- The editor renders a live insertion line even though the drag originates from the Kanban runtime.
- Self-drop into the source card/editor context must be blocked.

### Cross-window transport
- Cross-window native DnD is intentionally unsupported. A drag payload is valid only while the same renderer owns its typed live session; another window fails closed without claiming or mutating it.
- Cross-window consistency is provided by SQLite/Y.Doc synchronization. Supporting cross-window gestures later would require a trusted live-session handoff into the same `BlockTransfer` command, not a second snapshot transport.

## Visual Feedback Rules
- Same-column board reorder uses an insertion line resolved against remaining cards.
- The insertion line must never render above a dragged ghost when the actual persisted position is before the next remaining card.
- `property-sorted` drags render the same insertion line plus a property-preview label that states the inferred target bucket.
- `derived-move-only` same-column drags must not show a misleading insertion line.
- `derived-move-only` same-column drags must show an explicit blocked-sort message on the destination column.
- Sorted cross-column drags should highlight the destination column on the actual column header/body surfaces, not only on the outer wrapper edges.
- Empty-column drops should highlight the column surface instead of rendering a detached insertion line at index `0`.
- Editor-targeted card drags show an editor insertion line, not just board-column feedback.
- Copy feedback follows the live Alt/Option state: board indicators say `Copy` or `Copy · <inferred property>`, and editor insertion lines include an integrated token-colored plus marker.
- Bare column hits still derive a real insertion slot from pointer position when manual ranking is active.

## Persistence and History Invariants
- `newOrder` is a post-removal insertion index.
- `moveCard` and `moveCards` must interpret `newOrder` the same way.
- Renderer optimistic transforms and backend persistence must produce the same column order for identical inputs.
- After drop, the Page run stays continuously visible at the intended slot while the command acknowledgement, exact row effect, and canonical repair converge. A successful acknowledgement ends pending UI but does not expose an older Board snapshot.
- A singleton Database-row effect preserves Core's canonical `position_order`; it must not renumber the affected Page as the first row of its group. Group-scoped windows insert the row only when their scope contains its effective group and remove it otherwise.
- Move transforms are identity-keyed, all-or-nothing for multi-Page runs, preserve `pageIds` visual order, update each summary's target status, and become a reference no-op once canonical column, slot, and field values satisfy the intent.
- Drop-derived property patches must be applied atomically with the move, not through a follow-up card update.
- Group IDs are globally unique and grouped history lookup is global rather than project-local, so undo/redo of a cross-project move restores every affected project atomically and publishes change notifications for each project.
- Cross-surface Move/Copy carries stable IDs and logical parents only and commits through one idempotent `BlockTransfer`; source and target authority are never separate renderer mutations.
- The side-menu selection that starts the gesture is authoritative. Container-level `dragstart` listeners may manage visual cleanup but must never infer or replace the selected Block IDs.

## Non-Goals
- Copy-style Kanban-to-Kanban board drag
- Allowing derived-view block import when insert semantics are ambiguous
