# NFM Editor Move-To Popover Behavior

Status: Active  
Last Updated: 2026-06-19

## Contract

The NFM side-menu `Move to` action opens a destination popover instead of a two-row submenu. The popover searches across DB destinations and card destinations in one surface while preserving move semantics for the selected NFM blocks.

The expanded text-selection menu uses the same `Move to` destination popover in its Actions area. It replaces the older separate `Move to card` and `Turn into cards` text-selection actions with one destination picker.

The `Card in` row inside the side-menu `Turn into` submenu uses the same popover interaction model, but it is scoped to DB destinations only. Its row label and page-in icon stay unchanged.

## UI

- The popover is anchored to the `Move to` side-menu row and opens to the right.
- In the text-selection menu, the popover is anchored to the `Move to` action row and opens to the right of the floating text action menu.
- The search input is labeled `Move blocks to` and uses placeholder `Move blocks to…`.
- Results render in this fixed order:
  - `DB`
  - `Card`
- `DB` rows represent projects and are disclosure rows only. Clicking a DB row expands or collapses its column/status children.
- DB column/status child rows are the selectable DB destinations.
- `Card` rows are selectable card destinations and show the owning DB and column as secondary metadata.
- The source card is excluded from card results.
- Loading shows only after a short delay. Empty results show `No results`. Loading or submit failures show `Something went wrong`.
- `Card in` opens a nested DB-only picker from the `Turn into` submenu. It shows the `DB` section, expands DB rows to column/status destinations, and does not render the `Card` section or card-title results.

## Behavior

- Opening the popover resets its query and expands the current source DB when available.
- Typing filters by DB name, column name, and card title.
- Search uses the shared command-palette text normalization, all-term matching, prefix matching for terms of at least two characters, and the same fuzzy threshold policy.
- The popover intentionally does not search card descriptions, tags, assignees, or agent status; those broader card fields remain command-palette behavior.
- A non-empty query resets keyboard focus to the first visible row and auto-expands matching DB rows.
- Arrow Up and Arrow Down move through visible rows.
- Enter toggles a DB row or accepts a DB column/card row.
- Escape closes the move-to popover before closing the parent side menu.

## Move Semantics

- Selecting a DB column creates cards from the selected NFM blocks in that destination column.
- Selecting a card appends the selected NFM blocks to that card description.
- Selecting a DB column from `Card in` uses the same DB-column move semantics as selecting a DB column from `Move to`.
- The implementation reuses the existing selected-block guard, projected-ancestor rejection, editor snapshot rollback, and grouped `card:import-block-drop` persistence path.
- Grouped source/target card description updates advance the touched cards' revisions so Kanban summaries and full Card Stage descriptions converge through the same detail hydration path.
- After a successful move, Nodex refreshes the full source card detail and, for card destinations, the full target card detail so already-open Card Stage tabs render the moved blocks.
