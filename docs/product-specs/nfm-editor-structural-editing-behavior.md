# NFM Editor Structural Editing Behavior

Status: Active
Last updated: 2026-08-22

## Purpose

This document is the user-visible source of truth for editing selections that contain owning Page, Canvas, or Database Blocks. These Blocks own state outside the host Page Document, so the complete selection is committed by Core as one structural edit.

## Selection boundary

Purely ordinary selections use the editor's local collaborative fast path. If any selected root or descendant is an owning Page, Canvas, or Database, the complete selected forest—including ordinary Blocks—is handled by one Core operation.

A Block selection remains authoritative whether it was created by pointer drag, the side menu, keyboard navigation, or an atomic Block node selection. A single selected owner never falls back to the last text cursor merely because the editor's text-selection API has no range for that atomic node.

Core normalizes the selection in current Document order. A selected descendant is omitted when its selected ancestor already contains it; owned descendants are still discovered while Core expands the ancestor's complete ownership closure. A stale root, causal-head mismatch, authorization failure, or protected primary Database rejects the whole operation before content changes.

Generic Document updates may edit ordinary content, but they cannot create, remove, reparent, clone, or reclassify an owning shell. Page references, mentions, relations, links, and View occurrences remain non-owning and follow ordinary editing semantics.

## Delete and cursor behavior

Backspace, Delete, the block side menu, and a block selection may remove any supported mixture of ordinary Blocks and owners in one operation. The operation commits host Document updates, owner lifecycle and parentage, owned Documents, Canvas scenes, Database state, projections, retention evidence, and its inverse recipe atomically.

After Backspace, the cursor prefers the previous surviving editable Block at its end. After Delete, it prefers the next surviving editable Block at its start. If the host Document would become empty, the same operation creates an empty paragraph and places the cursor there. A user interaction in another surface while Core is committing always wins; a late completion does not steal focus.

Backspace at the start of an ordinary text Block does not implicitly delete or merge a preceding non-text Block. It crosses a consecutive run of Page, Canvas, Database, image, divider, or other atomic Blocks and places the cursor at the end of the nearest preceding editable text Block. If none exists at that sibling level, the cursor stays in place. Deleting an atomic Block remains an explicit Block-selection action.

## Copy, cut, paste, and duplicate

Copy captures an immutable, bounded ownership-closure snapshot at the fenced source head. It includes ordinary selected Blocks, Page Documents and nested owners, Canvas scenes and managed scene assets, Database schema, Data Sources, Views, rows and typed values. Reference edges stay references to their existing targets.

The system clipboard contains safe HTML and text presentation plus a bounded capability envelope. The snapshot itself remains in Core and is available offline in the same Profile while its clipboard lease is active. The envelope grants no authority by itself: Core verifies Profile/Library scope, Store epoch, manifest hash, capability, current access, and destination head before paste. A missing, foreign, malformed, expired, or unauthorized capability cannot create owning Blocks.

Copy claims the native clipboard synchronously with safe presentation while Core prepares the snapshot. An immediate paste waits for that exact capture. The final capability replaces the presentation only if the native clipboard still contains the same write claim, so a newer copy—inside or outside Nodex—cannot be overwritten by an older asynchronous result. Portable HTML never carries owning semantics; without a verified capability it materializes only ordinary content.

The structural command queue and history lane have the same lifetime as their BlockNote editor. Page Stage may detach and remount a tab's React view while retaining that editor; each active view rebinds its current Document participant to the retained structural controller before input is accepted. Consecutive copy or cut commands therefore remain ordered while a prior commit updates the surface or the user switches tabs, and a previously opened destination tab can accept a pending capability as soon as its view remounts. Every pending capture reaches a terminal result; an unavailable or stalled structural session leaves the source unchanged and never silently degrades an owner to title-only clipboard content.

Copy never changes the source. Cut follows the fixed order `capture → native clipboard write/readback → source delete`; any failure before the final step leaves the source unchanged. The first valid paste of an available cut claim moves the original identities. Later pastes clone the immutable snapshot with fresh Block, Document, Canvas, Database, Data Source, View, and row identities.

Pasting while a Block selection contains an owner replaces the complete selection in one Core transaction. The same replacement boundary handles ordinary HTML, Markdown, BlockNote, plain text, files, oversized-text attachments, and a verified structural clipboard capability. Direct non-composition typing and Enter over that selection use the same atomic replacement command. The original closure and the inserted closure are both captured in one inverse recipe, so failure changes neither side and Undo removes the replacement while restoring the original identities in one step. Input-method composition remains owned by the editor until it produces a committed replacement event.

A cloned root title advances one canonical trailing positive-number suffix, or appends ` (1)` when no such suffix exists. Titles are display values, not uniqueness keys. Non-owning references inside the clone continue to target their original resources.

Duplicate and structural drag/copy use the same closure planner without changing the system clipboard. Structural Move to and drag/move preserve identities and are rejected when the destination is inside the moved ownership closure. Mixed structural selections may move between Page Documents; destinations that would require converting ordinary Blocks into Database rows remain separate typed product actions.

## Undo and redo

Each mounted editor surface owns one chronological history lane. Local Yjs StackItems and opaque Core structural history tokens appear in the lane in the order the user acted. Remote collaborative changes do not create local entries.

The lane follows the editor surface rather than an individual runtime binding. Embedded Page Documents therefore keep structural undo across provider updates and session rebinding just like top-level Page editors, even when no local Yjs UndoManager is available at the instant the surface mounts.

Undoing a structural edit executes a new Core transaction from its single-use inverse token. Core returns a fresh inverse token for redo; it never rewinds SQLite or replays the original command. Deleting and restoring an owner therefore preserves the same owner and Document identities while leaving unrelated collaborator changes intact. Replacement history swaps the currently active closure with the retained opposite closure, so paste and direct typing do not create a separate delete entry. A conflict keeps the entry at the top of history instead of skipping to an earlier action.

A new local branch clears both kinds of redo entry together. Structural tokens that leave the reachable lane are explicitly released, including when the editor surface ends, so retention does not keep deleted closure state indefinitely. Releasing a cut history token also gives up its move claim; the immutable clipboard snapshot may still be pasted as a copy.

## Bounds and recovery

One structural selection is bounded to 10,000 roots and 10,000 Blocks; ordinary replacement trees are additionally bounded to 128 levels; an ownership closure is bounded to 1,024 owned Documents and a 64 MiB canonical payload. Every command is Store-epoch-bound, exact-head-fenced, Project-authorized, and idempotent by operation identity and request hash.

Clipboard bundles and history recipes hold normalized retention edges only while active. A consumed, superseded, or explicitly released recipe cannot be replayed. Transport response loss is recovered by idempotent receipt replay and canonical Document synchronization; renderer code does not construct compensation edits.
