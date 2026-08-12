# Database, Pages, and Views Behavior

## Scope and authority

This document owns the user-visible contract for Database Views, Page creation,
Page Stage, Source-defined Properties, and visual Page workflows. The canonical
Database/Data Source/View/Page model is defined in [CONTEXT.md](../../CONTEXT.md).
Durability and synchronization are defined in [Reliability](../RELIABILITY.md).

A Database is a placeable Container with one or more Data Sources and Views. A
Data Source owns schema, row Pages, and values. A View targets one Data Source
and owns saved filtering, sorting, grouping, displayed Properties, and optional
manual Page positions. Page content remains in the Page's owned Document.

## View behavior

Board, List, Table, Toggle List, and Calendar presentations execute the selected
View's saved query. The primary unfiltered status-grouped View may use the
specialized Kanban presentation; other Views retain their own identity and
configuration instead of mutating the Project default.

Grouped Views page independently per group and show the canonical total even
when only one window is loaded. Flat Views use one cursor window. Refresh after
a mutation preserves the loaded span where possible, and an expired cursor
restarts that bounded window rather than silently truncating the result.

Filtering and sorting are View presentation. A manual position is optional; an
unpositioned Page remains visible according to the View's null policy. Manual
reorder is disabled only where a different active sort owns visible order.
Reorder and cross-group moves compile one atomic Database mutation from stable
Page and View identities. Detailed Board drag behavior is specified in
[Kanban Drag and Drop Behavior](kanban-drag-and-drop-behavior.md).

## Page creation

Every eligible `New page` entry point opens one app-owned composer bound to the
exact writable View and semantic insertion target. Unmounting the originating
Board does not discard the draft or move authority to another Board.

The composer owns an uncommitted title/body Document draft plus compatible
Status, Priority, Estimate, and Tags selections from the target Source schema.
Opening or editing the composer creates no Page, option, history, or Database
row. Submit creates Page identity, title, body, membership, values, and View
placement atomically. A failed submission keeps the complete draft.

Closing a modified draft provides short-lived reversible recovery using only
serializable authored data. Live editors, Y.Docs, DOM nodes, and authority
tokens never enter draft recovery state. `Create more` starts a clean title/body
while retaining the user's selected properties and presentation choice.

## Page Stage

Page Stage opens one stable Page identity through Page Detail independently of
its current parent. Library-, Page-, and Data Source-parented Pages all expose
the same title, body, history, Threads, and Page-intrinsic run/schedule controls.
Opening a Page never creates membership or moves it into a Database.

Title and body mount only after a ready authorized Document descriptor and
initial sync barrier. They edit the canonical collaborative Document directly;
there is no ordinary whole-body autosave, projection-seeded initialization, or
whole-Page conflict overwrite. A title-only Page opens with a valid empty-body
editor while NFM/plain-text export remains empty.

Page Stage may show Source Properties only when the Page is currently parented
by a Data Source and the corresponding schema/value coordinates are valid.
Losing or changing membership removes only that capability; Page identity,
Document, content, and local editing surface remain stable.

Mounted surfaces own independent caret, selection, undo, and presence. Undo
includes only that surface's local edits. Durable history is a semantic revision
timeline; restore applies a new forward mutation and never rewinds collaborative
causality. Exact revision and retention behavior remains a reliability concern.

## Properties

Property identity and type, not display name, select behavior. Reserved
Properties such as Status, Priority, Estimate, Tags, schedule boundaries, and
Assignee may use focused controls only when their exact registered types match.
Custom or malformed Properties use the typed fallback.

Option registries own option identity, order, labels, colors, and revisions.
Scalar changes use their captured field revision; set-like changes preserve
add/remove intent. Conflicts and collection failures stay on the control or
popover that owns the action and do not hide unaffected fields.

Relation is a one-way, unordered set of Page references targeting one Data
Source. It never changes ownership or grants access. Compact values show visible
targets plus hidden/restricted counts; inaccessible targets disclose neither
identity nor title. Candidate and selected lists are bounded and paged. Removal
of a restricted target uses a Core-authored opaque edge handle rather than a
guessed Page ID. Relation supports contains/not-contains/empty/not-empty filters
and is not sortable or groupable in this release.

Deleting a Property requires explicit confirmation and is blocked while a View
still references it. Core rechecks the current schema and View references at
commit time.

## Page editor behavior

Page title and body support the registered rich-text and Block families,
including nested Pages, references, Database View references, images,
attachments, tables, toggles, and thread sections. Exact syntax is owned by
[Nested Markdown](../references/nested-markdown-spec.md); focused interaction
contracts are indexed in [Product Specifications](index.md).

Owning Page, Canvas, and Database shells cannot be removed, duplicated,
reclassified, or replaced through generic editor commands. Their lifecycle and
movement use typed owner operations. Ordinary Blocks use Document edits within
one Document and Block Transfer across Documents. Mixed selections that contain
protected owners cannot become one generic destructive edit.

Large or native clipboard input uses explicit bounded flows. Saved assets use
managed asset identity; external links remain links. Exact attachment, copy,
table, mention, side-menu, and thread-section behavior belongs to the focused
NFM specifications linked from [the index](index.md).

## Calendar and reminders

Schedule, recurrence, occurrences, and reminders are Page behavior even when a
Calendar View presents them. The complete contract is in
[Calendar and Reminders Behavior](calendar-and-reminders-behavior.md).
