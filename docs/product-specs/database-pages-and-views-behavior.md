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

Database Views support Board and List layouts. Both execute the selected View's
saved query through one runtime and preserve the durable View identity while the
layout changes. The canonical status-grouped Board keeps its established
Column/Card composition, whole-card drag, column controls, Page menus, and
keyboard behavior. Board configurations that require capabilities such as
subgroups may use the advanced renderer without replacing that canonical
presentation. Historical Table, top-level Toggle List, and Calendar layouts
migrate to List; inline `pageRef` and toggle-list Blocks remain editor features.

Grouped Views page independently per group and show the canonical total even
when only one window is loaded. Flat Views use one cursor window. Refresh after
a mutation preserves the loaded span where possible, and an expired cursor
restarts that bounded window rather than silently truncating the result.

Filter is durable View query authority and search is window-local. Layout,
sorting, grouping, subgrouping, completion policy, empty-group visibility, and
displayed Properties resolve through a sparse Core personal preference keyed by
durable View ID. Board and List remember separate displayed-Property sets while
sharing the other presentation rules. Reset removes only the personal override.
`Set default for everyone` publishes the normalized effective presentation with
View revision compare-and-swap and clears the override only after success; a
conflict retains the personal state. A valid legacy renderer preference migrates
once and is removed only after Core accepts the write.

Display Options derives valid group fields, finite empty groups, completion
controls, and visible Properties from the active Source schema. Page ID is an
ordinary optional List display field: it follows the same personal override,
reset, and default-publishing flow as other display fields and is never forced
visible. Hiding any optional List field collapses only that field's track; the
remaining Page identity cells, Property cells, group headers, and nested guides
retain their named-column alignment. List is a dense,
full-width 40–44px task-row surface whose sections match Board groups and
subgroups; it has no spreadsheet header, column resizers, rounded card stack, or
inline foreign Page Document. Its controls use the shared Nodex dropdown,
button, switch, popover, and checkbox primitives. Selectors backed by Source
Properties, options, or other growing data catalogs are searchable; closed
presentation enums remain compact selection menus without a redundant search
field. Board and List share bounded group windows, selection, Page-open behavior,
Property editors, and mutation receipts.

Database row authority always carries canonical Property values. In particular,
select and multi-select values remain stable option IDs through View windows,
List occurrence windows, optimistic row patches, Page Stage, filtering, sorting,
and grouping. A compatibility display projection may carry resolved names for
legacy card presentation, but it is explicit and never substitutes for value
identity. Closed List and Page Stage controls request bounded option windows for
their currently selected IDs before the picker opens, continuing across pages
until every visible label resolves or the authoritative registry proves the ID
missing. `Loading…` therefore represents an active request only; an idle or
failed registry cannot leave visible Property chips permanently loading.

### List projection and task hierarchy

List is a virtual grid over Core-authored occurrence rows. Group headers are
36px with a 2px first-row gap, Page rows are 44px, row surfaces are inset 8px,
and each nested level shifts the complete visible Page identity cluster by 24px
while preserving named-column alignment. Hierarchy guides anchor to the leading
identity lane. Their overlay spans the full 44px Page row: a parent stem begins
5px above the row edge, a child elbow begins 15px from the row top, and a final
child stem is 16px tall. Guides use the solid divider contrast and maintain
consistent opacity across Page-row boundaries. A transient occurrence weakens
its Page content and row-state surface to 60%, while its hierarchy guide remains
part of the full-opacity structural overlay. Nested descendants remain visible
without a Page-row disclosure control. Group, subgroup, Page, and transient
occurrences have stable path keys independent of Page identity. Group collapse
hard-removes that group's occurrences without row tweening. This separation
keeps cross-group hierarchy legible without implying membership in the current
group. The mounted View
session restores a logical row anchor, continues bounded windows near the
viewport end, keeps field widths monotonic, and hides trailing low-value fields
before compressing the title column.

A Data Source task hierarchy is the projection of its fixed `task_parent`
Property, not a second graph. `task_parent` is a required cardinality-one
self-Relation: every active row, including a root, retains one positive,
monotonic Relation value revision; a child has one Relation edge whose target is
its parent and whose edge metadata carries sibling rank. Generic Relation edits,
List nesting, and batch drag commands all compare and update that same value
revision. Each parent must be an active row in the same Data Source, cycles are
forbidden, and maximum depth is ten. Removing a parent from the Data Source
clears its own Parent value, removes its incoming child edges, advances every
affected value revision, and promotes its direct children to task roots without
moving or rewriting Page Documents. Archiving retains the Relation so restore
recovers the hierarchy, but the active List projection temporarily treats a
child of an archived parent as a root instead of hiding it beneath an invisible
row. Search and filtering may include transient
ancestors needed to explain matching descendants, so the same Page can have
multiple visible occurrences while selection and mutations deduplicate by Page
ID.

List selection supports replace, toggle, contiguous range, all matching with
sparse exclusions, a roving keyboard cursor, context actions, and a bulk action
bar. A normal pointer click on either the title or any non-interactive part of a
Page row opens that Page; it does not convert navigation into selection.
Pointer selection is explicit: the row checkbox toggles an occurrence and
Shift-click extends the current range, while Property controls remain isolated
from both Page-open and selection. Selection-state paint in a
List row is immediate rather than tweened. A visible Status or Priority icon is
also its inline editor trigger: opening it must not select or open the Page. The
editor uses the shared searchable Property option picker, and choosing an option
commits through the same optimistic, receipt-backed Property mutation path as
other editors. Built-in task Properties keep their canonical options available
when a bounded option window is not embedded in the current projection.
The roving cursor records the next List tab stop, not an enduring DOM-focus
command. Only an unconsumed keyboard-navigation request may move focus to a
Page row; selection commands, View projection refreshes, and edits in another
surface never replay an earlier row-focus request.

An ordinary Page-row drag resolves against the target row midpoint as a
before/after insertion and never treats the row center as an implicit drop
inside the target Page. Transient hierarchy context cannot originate a drag.
Holding Option/Alt deliberately switches that target to the nest operation.
Reorder, cross-group Property adoption, explicit nest,
un-nest, and eligible
multi-Page drops compile from occurrence context into one atomic Database apply
with Property, Parent-value, and position compare-and-swap. The renderer may apply
a conservative optimistic occurrence projection and recompile once after a
typed revision conflict; otherwise it rolls back and converges from Core. A
successful lossless move offers a session Undo whose inverse carries the exact
committed revisions.

Primary and subgroup headers paint an opaque full-width sticky surface through
the scrollport's top edge. The scroll container must not introduce transparent
top padding above that sticky plane, so a scrolled Page row can never show
through as a seam above the header. Light and dark List presentations preserve
the same geometry, density, and interaction hierarchy; each theme supplies an
opaque surface plus distinct hover, selection, group, text, icon, chip, checkbox,
focus, and drop-indicator colors.

Opening a Page, changing Display Options, and switching between Board and List
preserve the last readable Database surface instead of replacing it with an
opening screen. Background reads update only the affected projection and hand
over atomically. An inactive alternative layout does not preload or refresh its
windows; selecting List starts its Core occurrence projection on demand and then
retains the last accepted window. List ordering never passes through a temporary
Board-derived order. Permission
revocation, checkpoint/reset, authorization loss, and Store replacement remain
hard-clear boundaries.

Rapid List coordinate replacements keep one first-window read in flight and
skip obsolete intermediate targets. Board group-window reads and load-more-all
use at most eight concurrent Core reads, independent of the number of groups.

Every mounted Board or List remains subscribed to its exact durable View while
another Page Stage or window edits Page titles and Source Properties. A
same-renderer title edit projects into visible cards and rows immediately;
cross-window edits converge through the cursor-fenced Project projection without
remounting the Database surface. A projection checkpoint may fence stale
authority and repair the loaded span, but it cannot detach later effects from a
consumer that remains mounted.

Workflow-status List groups use the canonical `Triage`, `Plan`, `Build`,
`Review`, and `Ship` labels. Each writable status group ends with a compact
create action that opens the standard Page composer already seeded to that
status. Their icons form one compact progress family: Triage uses a segmented
ring, Plan an empty ring, Build a half-filled ring, Review a three-quarter-filled
ring, and Ship a filled ring with a knocked-out check. Shape communicates state
at 14–16px while semantic color remains supplementary. Status values use a flat
icon-and-neutral-label presentation; the surrounding row or trigger owns hover,
focus, and selection backgrounds, so status itself never adds a nested pill.
Set-like Tags and Labels remain compact chips. Custom non-status option labels
remain data-defined.

A manual position is optional; an unpositioned Page remains visible according
to the View's null policy. Board drag, Board keyboard movement, and manual List
movement write one View-global rank. Cross-group Board movement commits the
target grouping Property values and rank in one atomic Database mutation from
stable Page and View identities. Manual reorder is disabled only where a
different active sort owns visible order. Detailed behavior is specified in
[Board Drag and Drop Behavior](board-drag-and-drop-behavior.md).

## Page creation

Every eligible `New page` entry point opens one app-owned composer bound to the
exact writable View and semantic insertion target. Unmounting the originating
Board does not discard the draft or move authority to another Board.

The composer owns an uncommitted title/body Document draft plus compatible
Status, Priority, Estimate, and Tags selections from the target Source schema.
These property controls form a compact chip strip. Each chip keeps its semantic
icon visible and, when empty, shows the property name rather than a generic
empty-value label. An empty value may use `Empty` when the surrounding row or
section already identifies the property.
Estimate uses one half-filled triangular semantic glyph across property labels,
values, pickers, Page summaries, and View rows.
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

Relation is a one-way Page-reference Property targeting one Data Source. Its
schema declares cardinality `one` or `many`: a single Relation stores zero or
one target and replaces it through value-revision compare-and-swap; a multi
Relation is an unordered unique set with idempotent edge patches. Both use the
same normalized edge table and a JSON-null value revision header. Relation never
changes ownership or grants access. Compact values show visible targets plus
hidden/restricted counts; inaccessible targets disclose neither identity nor
title. Candidate and selected lists are bounded and paged. Removal of a
restricted target uses a Core-authored opaque edge handle rather than a guessed
Page ID; a revision-fenced empty replacement can clear the whole value without
disclosing targets. Generic Relation references survive target membership and
lifecycle changes until explicitly removed. The standard `task_parent` Relation
adds same-Source activity, acyclicity, depth, sibling-order, copy-as-root, and
parent-removal promotion policy without creating another storage authority.
Relation supports contains/not-contains/empty/not-empty filters and is not
sortable or groupable in this release.

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

Schedule, recurrence, occurrences, and reminders are Page behavior, not
Database layouts. The complete contract is in
[Calendar and Reminders Behavior](calendar-and-reminders-behavior.md).
