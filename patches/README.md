# Patches Notes

This directory stores local patches applied to upstream BlockNote packages. They are intended to be applied automatically after dependency installation through the project's patch workflow.

## Patch List

### `@blocknote%2Fcore@0.47.1.patch`

- Target package: `@blocknote/core`
- Purpose: fixes toggle block collapse behavior when child blocks are added.
- Behavior change: upstream automatically expands a collapsed toggle when a child is added; this patch keeps the toggle collapsed and only removes the "add block" button.
- Source touched: `src/blocks/ToggleWrapper/createToggleWrapper.ts`
- Why it exists: Nodex needs stable, predictable collapsed state. Adding or editing child blocks should not force headings or toggle nodes open.

### `@blocknote%2Freact@0.47.1.patch`

- Target package: `@blocknote/react`
- Purpose: keeps the React `ToggleWrapper` behavior aligned with the patched `@blocknote/core` collapse semantics.
- Behavior change: removes the "auto-expand when a child is added" state update and keeps only the "auto-collapse when the last child is removed" handling.
- Source touched: `src/blocks/ToggleWrapper/ToggleWrapper.tsx`
- Why it exists: patching `core` alone is not enough. The React UI layer can still auto-expand collapsed toggles unless this layer is patched too.

### `@blocknote%2Fshadcn@0.47.1.patch`

- Target package: `@blocknote/shadcn`
- Purpose: fixes focus loss in BlockNote's shadcn/radix menus during mouse interaction.
- Behavior change: adds `onPointerDownCapture` to `DropdownMenuSubTrigger`, checkbox items, and regular menu items, and calls `preventDefault()` on left mouse button down to stop pointer events from stealing focus too early.
- Source touched: `src/menu/Menu.tsx`
- Why it exists: Nodex menu interactions often happen inside active editor flows. Losing focus can break selection state, editing state, or related floating UI behavior.

## Maintenance Notes

- These patches modify both `src/` and built `dist/` files because the published upstream packages already include compiled output.
- When upgrading BlockNote, verify each behavior first and then decide whether the patch can be removed, needs to be recreated, or should be replaced by the upstream implementation.
- If a new patch is added, document it here in the same format: target package, purpose, touched source, and why the patch must remain.
