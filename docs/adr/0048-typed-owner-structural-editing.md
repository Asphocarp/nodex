# ADR 0048: Typed owners use one structural editing authority

Status: Accepted
Date: 2026-08-21

## Context

An owning Page, Canvas, or Database shell is visible in a Page Document but also owns state outside that Document. A generic collaborative update can describe the shell's placement, but it cannot atomically update owner lifecycle, parentage, owned Documents, Canvas scenes, Database authority, projections, retention, and undo evidence. Entry-point-specific deletion and copy rules consequently produced partial feature coverage and conflicting history semantics.

## Decision

Core owns a `LibraryStructuralEdit` boundary for any editor selection whose root forest contains a typed owner. Core normalizes the selected forest, captures its complete ownership closure, checks exact source and target Document heads, and commits all affected authorities as one durable mutation. Generic Document mutation continues to reject typed-owner lifecycle or placement changes.

The same boundary owns mixed deletion, immutable clipboard capture, clipboard paste, ordinary-content replacement of an owner selection, duplicate, and move. Clipboard presentation carries only a bounded capability; the authoritative snapshot and cut claim remain in Core. Copy instantiates fresh identities and preserves reference edges. The first valid cut paste may consume its claim to preserve identities; later pastes clone the snapshot. Replacement atomically swaps the selected ownership closure for the inserted closure and records both sides in one inverse recipe.

Structural undo and redo are forward inverse transactions represented by single-use Core tokens. Each retained editor surface merges those tokens chronologically with its own local Yjs UndoManager StackItems. Tokens removed from reachable surface history are explicitly released so their retention edges can be collected.

The renderer owns gesture interpretation, selection/focus epochs, native clipboard verification, and cursor presentation. It does not branch on Page, Canvas, or Database lifecycle policy. Core owns selection validation, closure expansion, clone/move semantics, protected-resource policy, identity allocation, retention, and inverse recipes.

## Consequences

- A mixed selection has one commit boundary and one user-visible history entry.
- Failure cannot leave ordinary Blocks changed while an owner remains half-mutated.
- Delete, Duplicate, Move to, drag/drop, copy/cut/paste, undo, and redo share owner semantics.
- Multiple editor surfaces keep independent cursor and local history state even when they share one live Document runtime.
- Clipboard capabilities are same-Library, Store-epoch-bound authority references rather than portable content archives.
- Supporting cross-Library transfer or durable cross-restart editor undo would require separate authority and history designs.

The detailed interaction contract is [NFM Editor Structural Editing Behavior](../product-specs/nfm-editor-structural-editing-behavior.md).
