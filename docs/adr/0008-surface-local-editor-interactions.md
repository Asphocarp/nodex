# ADR 0008: Editor interactions are surface-local sessions with domain-owned transfer

- Status: Accepted
- Date: 2026-07-13
- Owners: Nodex maintainers
- Extends: ADR 0002, ADR 0005, and ADR 0007

## Context

One Card body may be visible in Card Stage, inside an expanded owning `card` Block, or inside an expanded `cardRef` Block. Each presentation is a separate mounted editor surface over one independently synchronized Card Y.Doc. That loading boundary is intentional, but the first nested-outliner implementation left drag and undo ownership partly attached to browser and ProseMirror view lifetimes.

BlockNote establishes the authoritative drag selection only when its side-menu handle starts a block drag. Nodex previously observed an earlier native `dragstart` on the surrounding `.nfm-editor`, tried to infer the selected Blocks from whichever ProseMirror selection happened to be current, and stored the source in one module-global `HTMLElement`. This happened to work for a top-level editor whose selection was already stable. In an embedded Card editor, the outer listener ran before the React side-menu handler established BlockNote's block selection, so it could not attach Nodex's stable-ID transfer payload. The embedded interaction boundary also correctly stopped the event from reaching BlockNote's document-wide cross-editor listener. The destination consequently saw only `text/html` and `text/plain`, rendered ProseMirror's vertical native text caret, and could neither invoke the atomic BlockTransfer command nor enter a Kanban Database target.

Allowing BlockNote's native cross-editor drop to fill that gap is not valid. Its generic behavior inserts a serialized ProseMirror slice in the target and later deletes the source selection. For two independent Y.Docs those are separate writes with no common commit, identity validation, relocation lease, or recovery receipt. ADR 0005 already requires a cross-surface move or copy to preserve stable application Block IDs and commit through one domain-owned `BlockTransfer` operation.

Undo had a separate symptom with the same ownership mistake. Nodex renders React under `StrictMode`. Development StrictMode deliberately executes a callback ref's setup, cleanup, and setup sequence once to reveal missing cleanup. BlockNote's ref cleanup unmounts the Tiptap/ProseMirror EditorView. The upstream y-prosemirror undo plugin creates a `Y.UndoManager` in plugin state but destroys it when that short-lived EditorView is destroyed. Reusing the editor state on the second mount therefore reuses a dead manager: local transactions still reach Yjs, but no UndoManager observer remains and `Cmd/Ctrl+Z` has no stack to consume. This affects every collaborative NFM editor, though nested editors made it visible first.

An EditorView is a DOM attachment. A Nodex editor surface is the longer-lived interaction owner: it combines one BlockNote editor, one Y.Doc body fragment, one local collaboration origin, and one undo history. Native drag events are transport signals, not the authority for either the selected application Blocks or the mutation.

## Decision

### One window-local coordinator owns every managed Block drag session

Nodex has one `BlockDragSessionCoordinator` for a renderer window. The custom `NfmSideMenu` starts a session only after BlockNote has established the exact side-menu drag selection and returned its root Block IDs. The session stores a generated session ID, a stable source surface ID, Project and store epoch, logical source Document, root application Block IDs, and non-authoritative display hints. It mirrors a versioned token into `DataTransfer` so the browser can advertise the gesture, but the in-memory session is the authoritative same-window source.

Every mounted NFM surface registers its semantic Document target, concrete DOM boundary, and feedback-deactivation callback with the coordinator. Every Kanban board registers a semantic Database/View drop target. Target registration contains logical coordinates and geometry needed to derive a Block insertion anchor; it does not contain a serialized Block tree. For native editor drags, the coordinator reads the event's composed path and grants feedback/drop ownership to the first registered boundary—the deepest mounted editor—before capture-listener order can matter. Changing owner synchronously clears the previous surface's custom indicator and BlockNote drop cursor. Nested interaction boundaries may stop React/native propagation to protect parent editors because target discovery no longer depends on bubbling to `document`.

Pragmatic Drag and Drop already publishes its nested target stack in inner-to-outer order, but invokes every nested target callback. A Document target may render feedback or commit only when its own element is the first entry in `location.current.dropTargets`; every outer callback clears its local feedback and returns. Thus native editor drags and Kanban drags share one semantic rule even though their event adapters differ: the deepest eligible surface is the sole effect owner.

The target chooses behavior by identity:

- A drag whose source and target are the same mounted surface remains BlockNote's native in-document reorder. Nodex does not intercept it.
- A managed drag crossing surface or parent boundaries is claimed by the coordinator in capture phase. It suppresses ProseMirror's native cross-editor slice insertion, source deletion, and vertical text drop caret. The Document target renders the same horizontal insertion line used for block placement.
- A cross-Document, Document-to-Database, or Database-to-Document drop sends exactly one `BlockTransfer` intent. Move is the default. The coordinator samples Option/Alt at drop time, not only at drag start, and selects Copy when held.
- Two mounted views of the same logical Document must not use serialized cross-editor insertion. They resolve to one stable-ID in-Document move command when such a target is enabled; until that command is available, the coordinator rejects the ambiguous drop rather than creating duplicate CRDT content.

The coordinator owns only ephemeral gesture state. It clears on drop, cancel, `dragend`, source/target unmount, Project/store-epoch change, and window blur. It never persists a session and never treats a missing custom MIME payload as permission to mutate content.

### SideMenu exposes the selection it already owns

The vendored BlockNote `SideMenuExtension.blockDragStart` returns the root Block IDs that its native drag implementation actually selected. Nodex consumes that result synchronously in `NfmSideMenu`; it no longer re-resolves selection from a separate container `dragstart` listener. This is a general extension contract rather than Nodex MIME logic inside BlockNote.

BlockNote also exposes a general predicate for whether an external coordinator owns the current drag. Its SideMenu cross-editor `dragover` and `drop` handlers return without inserting a slice or deleting the source, and its DropCursor extension removes/declines its native cursor when that predicate is true. DropCursor exposes an imperative clear operation so a parent cursor can be retired when ownership passes to a child whose capture handler stops further propagation. These are generic editor-integration seams; the predicate contains no Nodex domain or transport code, and Nodex supplies it when mounting the surface.

### Undo belongs to the collaborative editor surface, not its EditorView

The Yjs undo extension owns one `Y.UndoManager` for the lifetime of its registered collaboration extension. Mounting an EditorView attaches selection metadata listeners and keyboard commands; unmounting detaches only those view listeners. It does not destroy the manager or clear its stack. A later mount of the same surface therefore resumes the same local undo history.

Unregistering the Yjs undo extension, switching the collaboration fragment, or destroying the Tiptap editor destroys the manager exactly once. The BlockNote extension lifecycle gains an explicit registration-lifetime cleanup distinct from its existing mount cleanup. `ForkYDoc` can unregister the old fragment's undo extension without leaving an observer attached, while React StrictMode and ordinary DOM detach/reattach do not invalidate the surface.

The manager scopes itself to the current Card body `Y.XmlFragment` and tracks only the surface's local y-prosemirror origin. Provider-applied remote updates and another window's client origin never enter the local stack. Title undo remains the title binding's separate surface-local scope; this ADR does not combine title and body into one undo item.

### A durable PageTab owns a model session across view teardown

A selected panel leaf still renders only one tab body. For a durable Page Stage tab, the stable ProjectSession/tab identity owns a window-local model session containing the Block Document runtime, Y.Doc/provider, BlockNote editor, and UndoManager. React receives a generation-fenced view lease from that session. Unmounting the tab body detaches the EditorView and its NodeViews, clears local Awareness, and gives pending updates a bounded background persist opportunity; it does not destroy the model or require a new SQLite/state-vector bootstrap when the user returns.

Before the EditorView detaches, the model captures its selection as Yjs-relative anchor/head positions. After a later mount reconciles the current Y.Doc into the new EditorView, those relative positions resolve against the new document shape and restore the logical cursor or selection. Numeric ProseMirror positions are not retained because remote edits may shift them while the view is absent. Scroll state uses the same PageTab identity so two tabs showing one Page do not overwrite each other's viewport.

The session is disposed only when its durable tab closes, its owning ProjectSession is archived, or its prepared descriptor changes across a store epoch, Document generation, schema, or owner identity fence. Descriptor replacement closes the old runtime before connecting its successor, and generation-fenced view releases cannot tear down a newer mount. An unpromoted Page preview disposes the same model seam with its final view; promotion preserves its stable tab/model identity and enables durable retention without a remount. Other embedded or standalone Document surfaces keep their ordinary React-owned runtime lifetime; retention is a PageTab capability, not a global hidden-editor cache.

### A write fence changes capability, not editor or participant identity

Relocation preparation makes every affected surface temporarily non-editable. That capability change is applied to the existing BlockNote/Tiptap EditorView in place. It must not change the React callback-ref identity or call `editor.unmount()`: remounting the parent EditorView destroys its React NodeViews, and an expanded `card`/`cardRef` NodeView owns an independently synchronized participant required by the same relocation quorum.

The collaboration provider, not the React subtree, owns an accepted relocation lease. If a visual surface genuinely disappears after accepting preparation, its runtime finishes the bounded lease headlessly before unsubscribing or destroying its Y.Doc. An unacknowledged participant disappearing still cancels the operation. Once a participant has durably flushed and ACKed, its proof has transferred to the coordinator; detaching that already-acknowledged subscription cannot invalidate the proof while the remaining quorum completes. Release/cancel plus the provider's terminal watchdog bounds this handoff.

## Consequences

Dragging from an expanded `card` or `cardRef` body to its outer editor or to Kanban behaves like dragging from Card Stage: the destination shows a horizontal Block insertion indicator, Move preserves application IDs by default, Option/Alt copies, and the domain command commits all authorities atomically. Dragging into an embedded body continues to work through the same path. A browser text caret is no longer a competing affordance during a managed Block drag.

The renderer has one place to reason about gesture cancellation, target priority, modifier state, and pending transfer feedback. Entering a sub-editor retires the parent's feedback in the same event dispatch, so browser `dragenter`/`dragleave` overlap cannot expose two target levels. Pragmatic nested callbacks cannot submit two operations for one drop. The old module-global source element, early container drag inference, one-way Kanban transfer adapter, and BlockNote cross-editor split insert/delete path are deleted. Same-editor reorder remains delegated to BlockNote because it is already one Yjs transaction in one Document.

Collaborative body undo survives StrictMode callback-ref probing and any DOM remount of the same surface. A relocation write fence preserves the current EditorView and nested NodeView identities, while a genuine visual teardown drains any accepted provider lease before releasing the participant. Extension unregister and editor destruction still release Yjs observers, so fixing lifetime safety does not trade correctness for a leak.

The vendored BlockNote changes are narrow upstream-quality lifecycle and integration seams: returning selected Block IDs, allowing an external drag owner to decline native cross-editor handling/cursors, explicitly clearing a stale cursor during nested ownership handoff, applying editability without remounting, and distinguishing view cleanup from extension cleanup. Nodex-specific nesting, target priority, and BlockTransfer semantics stay outside the vendor package.

## Invariants

1. Only an explicit side-menu block drag may start a managed Block drag session.
2. Root IDs come from the selection established by BlockNote for that exact drag, never from a later or earlier DOM guess.
3. Same-surface reorder is one local Yjs transaction and is not routed through BlockTransfer.
4. Any move or copy that crosses a logical parent is one idempotent BlockTransfer, never target insert followed by source delete.
5. Managed cross-surface drag renders only a block-placement indicator; ProseMirror's text caret and native cross-editor slice handling are suppressed.
6. Move is the default and Option/Alt at drop time selects Copy.
7. Drag session state is window-local and disposable; persisted authority contains only the committed domain operation.
8. One collaborative body surface owns one live UndoManager across EditorView mount cycles.
9. Remote/provider transactions never enter that surface's local undo stack.
10. Unregistering the undo extension or destroying its editor detaches the UndoManager from Yjs exactly once.
11. Write-fence editability changes preserve the parent EditorView and every nested NodeView identity.
12. An accepted provider lease outlives visual React teardown until terminal synchronization; only an unacknowledged participant departure invalidates preparation.
13. Exactly one semantic target owns feedback and drop for a pointer location; in nested editors that owner is the deepest registered/eligible surface.
14. A nested Pragmatic drop executes exactly one authority command even though the adapter notifies every target in its inner-to-outer stack.
15. An inactive durable PageTab retains its collaborative model but no EditorView, NodeView, DOM, or local Awareness state.
16. Cursor restoration across PageTab view mounts uses Yjs-relative positions rather than stale ProseMirror offsets.
17. Tab close, ProjectSession archive, or descriptor identity replacement destroys the retained editor/provider exactly once.

## Alternatives Rejected

Adding the missing custom MIME in another parent `dragstart` listener was rejected because event ordering and propagation remain accidental, stable Block IDs are still inferred twice, and embedded editors still depend on document-wide listeners.

Letting BlockNote perform cross-editor insertion and then calling BlockTransfer was rejected because it would briefly create duplicate content and then submit a domain command against already-mutated replicas.

Keeping separate adapters for editor-to-editor and editor-to-Kanban was rejected because modifier policy, cancellation, source identity, and error handling would diverge again.

Disabling nested event isolation was rejected because the parent editor would regain the ability to claim child selection, side-menu, and drop interactions.

Disabling React StrictMode was rejected because it would hide the lifetime bug and leave real detach/reattach paths unsafe.

Recreating an UndoManager on every EditorView mount was rejected because a visual remount would erase the user's local undo history. Never destroying it was rejected because collaboration-fragment switches and disposed editors would retain Yjs observers.

Keeping inactive Page editors mounted in hidden DOM was rejected because it ties application state to React/DOM survival and retains NodeViews, observers, layout work, and browser memory for invisible tabs. Recreating the full provider and editor on every tab switch was rejected because it repeats synchronization and loses local undo and selection continuity. Retaining numeric cursor offsets was rejected because concurrent edits make them refer to different content.

Treating nested participant loss during a parent write fence as an ordinary drag failure was rejected because the parent itself caused that loss by remounting its EditorView. Ignoring all participant disconnects was also rejected: a surface that leaves before durable flush/ACK has supplied no safe fence proof.

Teaching BlockNote about Card ancestry, Y.Doc ownership, or `BlockTransfer` was rejected because those are application-domain coordinates, not editor concerns. BlockNote needs only generic extension seams for external drag ownership and cursor teardown; the renderer coordinator owns nested semantic target arbitration.

## Acceptance

In development StrictMode, type in a Card Stage body or an expanded `card`/`cardRef` body and press `Cmd/Ctrl+Z`; the local edit is undone while a remote edit remains. Collapse and re-expand the Card to create a fresh surface, then repeat successfully without stale observers from the prior surface.

Drag a root Block from an embedded body into the outer NFM editor. The outer editor shows the horizontal block insertion line, never the vertical native text caret. Drop without Option/Alt and observe the same Block ID move atomically; drop with Option/Alt and observe a fresh copied ownership closure. Drag the same source into a Kanban column and observe the same Move/Copy policy and one committed BlockTransfer. Same-editor reorder continues to behave natively.

During embedded-to-outer Move, relocation preparation toggles the outer surface non-editable without replacing its EditorView or unmounting the embedded participant. Collapsing a prepared embedded surface after its ACK lets that headless provider receive terminal release/cancel and then close; leaving before ACK still aborts with no authority change.

Drag from a parent editor across an expanded child editor boundary. The parent indicator disappears as the child indicator appears; at no point are two levels visible. Drag a Kanban Card over the same child and drop once: only the innermost eligible target renders, and exactly one `BlockTransfer` operation is submitted.

## References

- [React StrictMode callback-ref checks](https://react.dev/reference/react/StrictMode)
- [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager)
- [y-prosemirror undo plugin](https://github.com/yjs/y-prosemirror/blob/master/src/plugins/undo-plugin.js)
- [ProseMirror drag and drop hooks](https://prosemirror.net/docs/ref/)
- [BlockNote collaboration](https://www.blocknotejs.org/docs/features/collaboration)
- [Pragmatic Drag and Drop nested targets](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/drop-targets)
