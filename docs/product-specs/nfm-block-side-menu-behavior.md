# NFM Block Side Menu Behavior

Status: Active
Last updated: 2026-06-24

## Purpose

The NFM block side menu is the block-scoped action surface for Card Stage descriptions. It opens from the editor side handle and keyboard block-action path, advertises the current block scope, and runs only actions that are real in production.

Development and Storybook may show disabled reference rows for future block links, collaboration, presentation, and AI actions. Production must not show unavailable actions.

## Scope Title

The first section title describes only the top-level action roots. Descendant blocks inside selected roots do not increase the displayed count.

- No target blocks: `Block`
- One target block: label by block type
- More than one top-level target block: `${count} blocks`
- Multi-selection always uses the count label, even when every selected root has the same block type

Single-block labels:

| Block type | Label |
|------------|-------|
| `paragraph` | `Text` |
| `codeBlock` | `Code` |
| `heading` with `level: 1/2/3` | `Heading 1/2/3` |
| `heading` with `isToggleable: true` | `Toggle heading 1/2/3` |
| `bulletListItem` | `Bulleted list` |
| `numberedListItem` | `Numbered list` |
| `checkListItem` | `To-do list` |
| `toggleListItem` | `Toggle list` |
| `quote` | `Quote` |
| `divider` | `Divider` |
| `image` | `Image` |
| `callout` | `Callout` |
| `table` | `Table` |
| `cardRef` | `Card reference` |
| `cardToggle` | `Card` |
| `toggleListInlineView` | `Toggle list view` |
| `threadSection` | `Thread section` |
| unknown or unsupported | `Block` |

## Production Actions

Production row order for a normal editable block is:

1. `Turn into`
2. `Color`
3. `Duplicate`
4. `Move to`
5. `Delete`

`Copy link to block` and `Copy links to all` are reference-only rows in development and Storybook. Production hides them because NFM does not yet persist stable block identities across parse/serialize round trips, so generated block anchors could become stale.

`Duplicate`, `Move to`, and `Delete` operate on top-level selected roots. `Turn into` and `Color` operate on the expanded selection, including descendants. `Color` is enabled only when every selected target supports at least one color prop; text and background color submenu groups are hidden independently when unsupported.

`Make thread section` appears only for one selected `divider` root when the Card Stage runtime can convert dividers. Table header row/column actions appear only for one selected `table` root when table headers are supported.

## Card Deeplinks

Card deeplinks open cards only:

```text
nodex://cards/<cardId>
```

The parser ignores unsupported query parameters such as `block`. Block-level links should not be emitted until NFM has a product-level persisted block identity.

## Layout

The side menu surface is a compact dialog:

- Width: `265px`
- Max height: `70vh`
- Row height: `28px`
- Section title: `12px`, subdued token color
- Search input at the top
- Listbox semantics for rows
- Group separators at visual group boundaries
- Right-side submenu flyouts for `Turn into`, `Color`, and `Move to`
- Entry/exit motion: `200ms` opacity/scale, with reduced-motion fallback
- Transform origin follows popup placement, including right-side `50%` origin behavior

Footer metadata is optional. Production hides the footer when there is no real metadata. Storybook fixtures may provide footer text.

## Submenus

`Turn into` includes supported non-destructive NFM block conversions:

- Text
- Heading 1/2/3
- Toggle heading 1/2/3
- Bulleted list
- Numbered list
- To-do list
- Toggle list
- Quote
- Code
- Callout

Divider is intentionally not part of the generic `Turn into` list because converting content blocks to dividers would discard content. Divider-related conversion stays under `Make thread section`.

`Color` exposes text and background color groups only when the current expanded selection supports the target prop.

`Move to` reuses the NFM move-to popover contract: DB rows create destination cards, card rows append selected blocks into an existing card, and source roots are removed after a successful move.

## Storybook Coverage

The side menu stories cover:

- `TextBlock`
- `CodeBlock`
- `HeadingBlock`
- `ThreeBlocks`
- `CardReferenceBlock`
- `ReferenceMocks`
- `NoFooterMetadata`
- Search, submenu, table, loading, empty, error, and narrow viewport states
