# Library Move Destination Picker Behavior

Status: Active
Last updated: 2026-08-11

## Scope

This specification defines `Move to` for movable Page and Database resources in Pages.

The action changes exclusive Library ownership only.
It preserves the resource ID, owned Document, Database bindings, and Project grants.

## Presentation

`Move to` opens a compact 330-pixel right-side submenu owned by the resource action menu.
The submenu is portaled for collision handling but never creates a dialog, modal overlay, or second interaction layer.
The surface starts with an autofocus search field and has no explanatory form copy, native select, confirmation footer, or second submit step.

The idle view contains `Recent` destinations followed by a browsable `Pages` tree.
The tree begins with a `Pages` row whose secondary label is `Top level`.
Expanded Page rows reveal their direct child Pages.
Search replaces the idle sections with flat title matches whose secondary label is the complete owning path.

The current parent remains visible when it helps orientation, is labeled `Current`, and cannot be selected.
The moving Page and every Page below it are absent rather than shown as destinations that will fail later.

## Interaction

Selecting an eligible row commits the move immediately.
Only the selected row shows progress while the mutation is pending; the rest of the picker is inert.
Success closes the picker.
Failure keeps it open and presents an inline error so another destination can be chosen.

Arrow Up and Arrow Down move through selectable visible rows and skip `Current`.
Arrow Right expands the focused tree Page and Arrow Left collapses it.
Enter selects the focused destination, Arrow Left returns to the parent menu when the search field is not consuming it, and Escape closes the complete action menu.
Pointer activation and Enter must not accept rows produced for an older search query.

Loading feedback appears only after 400 milliseconds so fast local reads do not flash a spinner.
Empty and failed reads remain compact status rows inside the result region.
When a bounded tree window has a continuation, the picker explains that search can reach destinations outside the visible window.

## Destination authority

Core returns a bounded, cursor-backed destination window for `suggested`, direct `children`, or `search` scope.
Every Page entry includes its display path, child availability, current-parent state, and exact Document generation/head required by the move command.

Core filters candidates to active, projection-ready Pages in the moving resource's current Project.
It excludes a moving Page's complete ownership subtree and rejects Data Source-row resources as move sources.
The renderer does not reconstruct hierarchy validity, infer a compatibility Project, or issue a second path read before committing.

The mutation remains the final serialized authority and rechecks the resource location revision, destination Document head, Project boundary, and Page-cycle invariant.

## Shared UI substrate

Library Move and NFM Move share the destination-picker frame, search geometry, section headers, status rows, scroll window, and delayed-loading visual language.
Their destination domain models and mutations remain separate.
