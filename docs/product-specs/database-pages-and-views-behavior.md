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

## Page keys

Pages in an enabled Database receive a short key such as `LAB-13`. The key is a
readable locator, not Page identity: UUID remains authoritative for Documents,
references, deep links, selection, drag state, caches, and every mutation.
Project creation enables the namespace of its primary Database and exposes that
Database prefix as the Page key prefix. Project rename does not change it.
Create Project does not show or request Page-key settings. The Project and
primary-Database genesis transaction derives a collision-free initial prefix
from the Project name; the transaction remains final authority. Prefix settings
become visible only after the Project exists.

Edit Project keeps the current prefix collapsed by default. Expanding it reads
the primary Database namespace, including its assigned Page count and retained
prefix history. Saving changed Project details and renaming the Database prefix
are two ordered operations: details save first, then the revision-fenced prefix
rename. If the second step fails, the saved details remain saved, the dialog
stays open with the prefix draft, and the namespace is refreshed for an explicit
retry; Nodex never creates another historical alias by attempting an automatic
rollback. An unused old prefix is released; a used one stays reserved and its
allocated keys keep resolving.

Allocation is monotonic and may contain gaps. Archive, delete, retry, and
movement never recycle a committed number. Moving among Views or Data Sources
inside one Database retains the assignment. A cross-Database move receives or
recovers the target Database assignment while every previously allocated key
remains an authorized historical locator for the same Page UUID.

Page Stage does not repeat the contextual Database key in its Page identity.
In Board and List Display Options the Page key is labeled **ID**. The canonical
UUID remains machine identity and is not a View display field. List includes ID
in its default presentation; Board keeps it hidden by default. A personal
Display Option may change either choice without disabling assignment, lookup,
copy, command search, CLI, or Agent results. Publishing the normalized effective
presentation makes the same choice the shared View default. When enabled on
Board, ID is the first quiet metadata line at the top of the card, above the
title and displayed Properties. List keeps ID in its named identity lane. The
lane measures the widest plausible identifier for the prefixes and number
depths in the current projection, so short prefixes do not inherit spacing
sized for longer ones and virtualized rows do not change the lane as individual
numeral glyphs appear.
A Page with no current enabled Database renders no placeholder.
Board and List expose `Copy Page key` in the Page context menu whenever a
current key exists. Both surfaces use the same success and failure
feedback; `Copy deeplink` remains a distinct UUID-based action.

The Page context menu also exposes a bounded, schema-driven Property section.
The current writable Board grouping Property appears first, followed by exact
built-in Status, Priority, Assignee, Due date, Tags, and Estimate roles, with
duplicates removed and at most seven direct entries. Remaining active
Properties appear under `More properties…`; root-menu search surfaces a matching
custom Property directly instead of requiring that extra navigation step.
Every Property entry remains a native context submenu. Select and multi-select
submenus host the canonical `PropertyOptionPicker`, including the same search,
rows, selected state, and Status, Priority, Estimate, and Tags presentation used
by Page Stage. Menu entries use the same canonical Property icon resolver as
Page Stage. A single-select choice commits and closes the action menu, while a
multi-select submenu remains open for additional set edits. Tags carries the
same option-creation capability through Board and List adapters; creating a Tag
atomically adds the option and selects it for the target Page. Text and number
Properties such as Assignee use a compact draft-and-save submenu editor; other
Property types embed their canonical shared value editor in the submenu. The
submenu is already the editor-opening action, so Date and Relation expose their
input/calendar or search content immediately and never add a nested `Empty` or
value trigger. Every root menu and Property submenu has one floating-surface
owner for collision bounds, scrolling, ring, radius, and shadow; editor bodies
do not add a second fixed-width shell or horizontal scrollbar.
Changing the Board grouping Property uses the same semantic Page move that owns
group membership and rank; other Board and List Properties use receipt-backed
value mutations.
Right-click edits only the Page under the pointer and never implicitly applies
to the current multi-selection. Page title remains Document authority and is
not presented as a Database Property.

View-local search accepts a current canonical key, case normalization, one
optional leading `#`, outer whitespace, and no-hyphen shorthand. Key matching
is exact or prefix-oriented, never fuzzy within the key token; explicit `#`
intent never falls back to title or body. Loaded Board/List rows do not carry
historical aliases. Global search, destination pickers, CLI, and Agent reads use
the authorized Core resolver when historical lookup is required. A compact
query that maps to multiple authorized Pages shows every candidate; a direct
selector reports ambiguity and never chooses the first match. Results keep the
current key in the primary identity slot and show `Matched OLD-13` only when a
historical key matched. Prefix changes refresh current View, Page Detail, and
search projections from one Database LocalCommit without remounting Page
identity or emitting one patch per Page.

## View behavior

Database Views support Board and List layouts. Both execute the selected View's
saved query through one runtime and preserve the durable View identity while the
layout changes. Every legal Board grouping and subgrouping uses one canonical
Column/Card presentation with whole-card drag, schema-driven compact Properties,
column controls, Page menus, and keyboard behavior. Grouping changes column and
swimlane membership, markers, labels, and semantic tone; it never selects a
different Card presenter. Grouping and subgrouping Properties are structural and
do not repeat in the Card body, while other displayed empty Properties do not
occupy visual rows. Column headers remain opaque and sticky while the Board
scrolls; Page and Block drags show the canonical insertion indicator before a
drop. A collapsed target keeps its compact rail, highlights only that target,
and puts its horizontal drop boundary below the complete collapsed header.
Finite empty groups remain present as canonical collapsed rails instead of
disappearing, while each populated Status column retains the full-width
`New page` launcher. Historical Table, top-level Toggle List, and Calendar layouts
migrate to List; inline `pageRef` and toggle-list Blocks remain editor features.

Grouped Views page independently per group and show the canonical total even
when only one window is loaded. Flat Views use one cursor window. Refresh after
a mutation preserves the loaded span where possible, and an expired cursor
restarts that bounded window rather than silently truncating the result.

Filter is durable View query authority and search is window-local. Layout,
sorting, grouping, subgrouping, completion policy, List empty-group visibility,
Board card description visibility, and displayed Properties resolve through a
sparse Core personal presentation keyed by durable View ID. Its monotonic
revision applies only to that presentation;
List disclosure is a separate bounded sparse set changed by idempotent
per-target patches. The current List exposes disclosure only on group headers;
Page occurrences remain expanded and do not create personal disclosure state.
Changing either coordinate never rewrites or conflicts with the other. Board
and List remember separate displayed-Property sets while sharing the other
presentation rules. Reset removes only the personal presentation override and
does not expand collapsed groups.
`Set default for everyone` publishes the normalized effective presentation with
View revision compare-and-swap and clears the override only after success; a
conflict retains the personal state. A valid legacy renderer preference migrates
once and is removed only after Core accepts the write.

Personal presentation and disclosure changes converge across mounted windows as
typed deltas authorized by the durable View. They do not claim a shared View,
Data Source, Database, or Page projection change, so a personal toggle cannot
refresh Board/List content or invalidate Library navigation. Reconnect replay
preserves those deltas; a Store-epoch replacement rehydrates both personal
authorities while retaining the last readable surface until the handover.

Display Options derives valid group fields, intrinsic Page identity fields,
finite empty groups, completion controls, and visible Properties from the active
Source schema. It also exposes the Board-only **Show description** toggle, which
controls only the Page description preview in Board cards, defaults to visible,
and does not change Page content, search authority, or List rows. Page key is
labeled ID and follows the same personal override, reset, and
default-publishing flow as other display fields. It is included in the default
List presentation and omitted from the default Board presentation. Hiding any optional
field collapses only that field's track; the
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
grouping, Page creation, and update commands. Core row contracts do not carry a
parallel display-value map. Board, List, Page Stage, Filter controls, active-rule
summaries, and local search derive labels and colors only from bounded option
registries; a missing registry entry is an explicit unknown option, never a
fallback display name inferred from the identity. Closed controls request option
windows for their currently selected IDs before the picker opens, continuing
across pages until every visible label resolves or the authoritative registry
proves the ID missing. `Loading…` therefore represents an active request only;
an idle or failed registry cannot leave visible Property chips permanently
loading. A Property registry contains at most 100 options; names and colors are
bounded as canonical UTF-8 metadata at every Core and transport read/write seam.

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
revision. Parent and sibling rank form one semantic coordinate on the moved
Page. Ordered insertion uses fractional ranks: only Pages whose parent or
logical sibling position changes advance their Parent value and Page metadata
revisions. A rare order-preserving rank rebalance may rewrite untouched sibling
rank encodings but must not advance those siblings' semantic revisions. Repeating
the same ordered Parent command is a no-op. Each parent must be an active row in
the same Data Source, cycles are
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

An ordinary Page-row drag resolves against the target row midpoint as a raw
before/after edge; the exact midpoint belongs to `after`. A leaf target keeps
that edge at its current sibling level. `after` on a target that already has
children normalizes to the first child slot, so the insertion guide uses the
prospective child depth. Adjacent row halves that describe the same sibling
boundary resolve to one stable insertion slot, and its circular endpoint sits
on the prospective parent branch rather than following the hovered row's raw
indent. Holding Option/Alt explicitly appends inside a Page, and group headers
accept only a root-level inside drop. Transient hierarchy context cannot
originate a drag, and a target inside the moved closure is never committable.

Dragging an occurrence moves its concrete subtree as one semantic action.
Transient rows are skipped as values but do not stop traversal; selecting an
ancestor and descendant normalizes to one source root; duplicate occurrences
are resolved by path and written once per Page. Cross-group adoption updates
every concrete Page in the closure, while Parent and rank changes apply only to
the normalized roots, preserving all internal Parent edges and child ranks.
Core resolves the full occurrence graph and commits Property, Parent, and order
writes atomically from one semantic operation; a bounded renderer window never
authors descendant IDs or primitive inverse operations.

The active source row alone becomes translucent, while descendants stay in
place. A body-portaled compact preview represents the initiator, mirrors its
visible Priority, readable ID, Status, and title columns, and shows the concrete
Page count; rows do not live-shift during pointer movement. Returning the source
to its unchanged structural slot is a silent no-op: it creates no mutation,
error, toast, or Undo entry. After drop,
a conservative optimistic projection remains until a receipt-fenced canonical
window confirms the same parent, group, and order semantics. One typed revision
conflict may rebase against fresh occurrence authority; exhausted conflicts
roll back without clearing the readable List. Successful moves are silent.
Their opaque Core recipe enters a bounded, Store-epoch-and-View-scoped session
history, and List-scoped Command/Ctrl+Z restores it only while editor, input,
combobox, and menu Undo owners are inactive.

List also accepts native NFM Block drags from another mounted editor in the
same renderer window. Under manual order or an inferable writable Property
sort, a root Page-row half resolves to a truthful root-level gap and reuses the
existing insertion line; group and subgroup headers, empty Lists, nested rows,
and non-inferable sorts use a quiet destination-surface highlight instead.
External Blocks do not author child
nesting: a nested row resolves to its owning group, because Option/Alt already
means Copy for Block transfer. At a root gap under writable Property sorts,
Core adopts the visible neighbors' writable sort prefix for both Page moves and
Block promotion. Under title or created sorting, the destination group is exact
but the intrinsic sort owns the final visible position.
Free-text search, read-only Views, non-Project contexts, incomplete or stale
Core projections, and cross-Project/store sessions fail closed. The renderer
sends only the raw occurrence target, exact projection expectation, and
effective List presentation; Core atomically resolves group/subgroup and sorted
Property values, root placement, shorthand, source Move/Copy, receipt, and Undo.

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
stable Page and View identities. Under a writable Property sort, Board and List
infer the Property prefix needed for the selected visible gap and commit it with
the move; View-global fractional rank remains the final stable tie-break among
Pages with equal sorted values. Detailed behavior is specified in
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
row. Each selected Tag keeps its preallocated canonical option ID. Its name is
metadata only when that same submit introduces the option; an existing option's
identity is never re-resolved from its label. Submit creates Page identity,
title, body, membership, any new options, values, and View placement atomically.
A failed submission keeps the complete draft and exact selected identities.

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
schema declares cardinality `one` or `many`, and that cardinality selects the
mutation grammar. A single Relation stores zero or one target and uses a
value-revision-fenced replace/clear command. A multi Relation is an unordered
unique set with idempotent edge patches plus a distinct revision-fenced whole-set
clear command. A one Relation rejects set patches; a many Relation rejects
single-target replacement. Both use the same normalized edge table and a
JSON-null value revision header. Relation never
changes ownership or grants access. Compact values show visible targets plus
hidden/restricted counts; inaccessible targets disclose neither identity nor
title. Candidate and selected lists are bounded and paged. Removal of a
restricted target uses a Core-authored opaque edge handle rather than a guessed
Page ID; the many-Relation clear command can remove every edge without
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
