# Card Stage Rich Editor Performance

This document describes the performance-sensitive Card Stage rich-editor path. It covers the features that keep typing responsive in the BlockNote/ProseMirror editor, how Card Stage keeps draft state accurate, how Kanban previews receive draft updates, and which flush points must preserve durability.

## Problem

Card descriptions are stored as NFM, but users edit them through BlockNote/ProseMirror. A naive implementation serializes the whole editor document to NFM on every editor transaction and pushes that value through React state immediately. That makes each keystroke do work outside the editor's own optimized input path:

- walk the full BlockNote document
- convert BlockNote blocks into NFM blocks
- serialize the full NFM document
- update Card Stage React state
- update draft preview subscribers
- potentially schedule persistence

When the client CPU is busy because of another application, this synchronous work competes directly with input handling. The editor then feels much worse than apps that keep typing on the editor engine's hot path and defer derived work.

## Core Model

The rich-editor path is split into two phases:

1. Editor transaction phase: mark that the editor is dirty, but do not serialize immediately.
2. Serialized draft phase: after a short debounce or an explicit flush, serialize the current document to NFM and publish it to Card Stage.

The debounce is controlled by `EDITOR_DRAFT_SERIALIZE_DEBOUNCE_MS` in `src/renderer/lib/timing.ts`. It is currently `250ms`.

This means the editor can accept rapid typing with minimal Nodex-owned synchronous work. Card Stage state catches up shortly after typing pauses, while Kanban description previews update only after the durable save acknowledgement carries a fresh `CardSummary`. Important lifecycle paths flush immediately before reading or saving description data.

## Board Read Model

Card Stage typing must also avoid broad renderer data refreshes after persistence. The high-frequency board store now fetches `BoardSummary`, where each card carries only persisted `descriptionPreview`, `descriptionLength`, and `hasDescription` columns. Full `description` bodies are not part of the shared board snapshot, and `board:summary:get` must not read or parse the `description` column.

Full card bodies are loaded through explicit detail paths:

- Card Stage hydrates the active card with `card:get`/`card-detail-store`.
- Toggle-list, inline toggle-list, and `cardRef` projections compute visible card ids from summary state, then hydrate those ids through `cards:details:get`.
- Command palette description matches come from `cards:search`, which queries the card FTS read model and returns ids and bounded excerpts instead of full descriptions.

This keeps save acknowledgements and board-change refreshes from sending every card body through Electron IPC structured clone. Successful `card:update` and `card:description:update:*` acknowledgements carry only `CardSummary` plus revision metadata; conflict acknowledgements are the only update path that returns a full `Card`. Full-board reads are intentionally not exposed through IPC or HTTP; renderer flows must compose summaries with explicit detail hydration.

## Durable Save Worker

Long-description saves must also avoid blocking the Electron main process. Description-only Card Stage autosaves use the staged `card:description:update:*` transport: the renderer sends small chunks with yields between chunks, main appends them to a temporary file, and `CardMutationWriter` asks the worker to read that file and perform the durable update. Non-description card updates still use `card:update`.

The writer enqueues card-domain mutations into a single FIFO `worker_threads` writer. The worker opens its own SQLite connection, runs the synchronous `better-sqlite3` transaction, captures the local-store board mutation events, refreshes the persisted summary/search read model, and returns the mutation result plus events and timing metrics after the write is durable.

The toolbar `Saving...` text keeps its durable-ack meaning: it remains visible until the latest submitted save has been acknowledged by SQLite. The important boundary is that the main process is now awaiting an async worker response instead of running the SQLite transaction, description revision write, and history work on its own event loop. If a worker crashes or cannot start, the mutation fails and the Card Stage dirty state remains uncleared; there is no synchronous main-process fallback for card writes.

After a successful worker ack, main republishes the captured `BoardChangeEvent[]`. Events with `summary` let `kanban-store` and `useAllBoards` patch their `BoardSummary` cache directly. Only events that cannot be represented locally fall back to a coalesced `board:summary:get` refetch. This keeps save acknowledgements, durable board notifications, and secondary board caches from reloading long descriptions or storming the summary endpoint while the user is typing.

## Editor-Side Features

### Dirty-First Change Handling

`NfmEditor` no longer serializes the full document inside the BlockNote `onChange` handler. Instead, ordinary editor changes notify Card Stage that a local transaction is pending, then call the serialized change emitter's `schedule()` method. Scheduling only records that there is pending work and resets the debounce timer.

This keeps the per-transaction path small:

- ignore changes while external sync/drop suppression is active
- mark the Card Stage description draft dirty before serialization finishes
- mark the editor as pending
- restart the debounce timer

### Serialized Change Emitter

`src/renderer/components/kanban/editor/nfm-serialized-change-emitter.ts` owns the debounce and flush behavior. It is intentionally UI-independent and tested as a pure helper.

Responsibilities:

- `schedule()`: mark a pending change and start or restart the debounce timer
- `flush()`: serialize immediately when a pending change exists
- `cancel()`: clear pending work without serialization
- `hasPendingChange()`: report whether a user edit is waiting to be serialized

The emitter compares serialized output against the last emitted value. Equal output is not emitted again. This matters because editor transactions can happen without changing the durable NFM representation.

### Empty Document Handling

`NfmEditor` treats an empty BlockNote document as an empty NFM string during serialization. The empty-state check happens only when serialization is actually needed, not on every editor change.

### External Sync Suppression

External content changes, card imports, projected-card drops, and other programmatic editor updates use suppression refs so they do not look like user typing. Suppressed paths cancel pending user-style serialized emission before applying their own operation.

This avoids stale pending work being emitted after the editor has been replaced or structurally changed by a non-typing operation.

Before an external content sync calls `replaceBlocks`, it must compare the incoming persisted NFM against the editor's current serialized NFM. If they are equal, the editor should only advance its emitted-content bookkeeping and skip the replacement. This keeps save acknowledgements, same-revision hydrations, and equivalent cache replies from replacing the ProseMirror document and disturbing selection or focus.

If the editor is focused, composing IME text, or holding a pending serialized change, external content sync must defer instead of cancelling the pending emitter or replacing the document. The active editor owns the local draft. A deferred inbound value may replay only after the editor is safe and the local document still matches the baseline captured at deferral; if a local pending/composition edit caused the defer, the local draft wins and remote divergence is handled by the existing save conflict/overwrite flow.

### Discrete Immediate Operations

Some editor operations need durable NFM immediately. These paths cancel or flush pending work and serialize synchronously as part of the operation:

- toggle click handling
- block send to an existing card
- block send to a project
- card import drop
- projected-card drop into the editor
- inline-view card drop import
- safe external content sync

The rule is: if an operation is discrete, structural, or needs a precise before/after document snapshot, it must not wait for the draft debounce. External content sync is the exception: it may be structural, but it must first prove that no active local edit window owns the editor.

## Card Stage Flush Interface

Card Stage owns a narrow renderer-only flush handle:

```ts
export interface CardStageDescriptionFlushHandle {
  flushPendingChange: () => string | null;
  hasPendingChange: () => boolean;
}
```

`CardStage` passes this handle to `NfmEditor` through `flushHandleRef`. The editor fills the ref while mounted and clears it on cleanup.

The handle is intentionally narrow. Card Stage does not know about BlockNote internals, timers, transactions, or serialization mechanics. It can only ask whether a pending change exists and force that change to be serialized before Card Stage reads description data.

## Card Stage State Features

### Latest Description Ref

`useCardStageController` keeps `latestDescriptionRef` as the synchronous source of truth for the latest serialized description draft.

When the editor emits serialized NFM:

- `latestDescriptionRef.current` updates immediately
- `formStateRef.current.description` updates immediately
- React `description` state updates inside `startTransition`

The ref exists because save, close, raw view, conflict overwrite, and card switch paths must not depend on React rendering a non-urgent state update first.

### Non-Urgent React Description State

`description` React state is still kept because the UI and draft overlay effects need render-driven state. It is just not urgent. Updating it inside `startTransition` lets React schedule preview/UI work without competing with the editor's input path.

The state may lag slightly behind `latestDescriptionRef.current`. Any logic that must be exact uses the ref or calls the editor flush handle first.

### Save and Close

Save and close paths flush pending editor content before checking for changes or building the mutation payload.

Important paths:

- `handleDescriptionBlur`
- `handleSave`
- `handlePersist`
- `handleClose`
- `persistRef`
- `closeRef`

`handlePersist` first flushes pending editor content, then cancels pending field-save timers, then saves if there are changes. `handleSave` also flushes defensively before creating the update payload.

Freeform dirty flags (`title`, `description`, `assignee`, `agentStatus`) must not be cleared when a save request is merely sent. They clear only when a successful acknowledgement corresponds to a submitted value that still matches the current local draft. If the user continues typing while a save is in flight, older acknowledgements and stale card-detail hydrations must leave the local draft intact.

Description persistence uses one in-flight save per mounted Card Stage. If a description save is already in flight, continued typing records only the latest pending serialized draft. When the active save is acknowledged, Card Stage immediately drains that latest pending value if it still differs from the last persisted description. The toolbar `Saving...` state means the latest queued/in-flight save has not yet been acknowledged by SQLite.

### Raw NFM View

Raw mode is a read-only view of the serialized NFM string. Toggling raw mode must flush pending editor content first, otherwise raw mode could show stale NFM while the editor has newer unsaved text.

### Conflict Overwrite

Conflict recovery can build overwrite payloads from the local draft. When description is part of the attempted update, Card Stage flushes pending editor content before copying description into the overwrite payload.

## Draft and Preview Features

### Local-Only Freeform Drafts

Freeform fields stay local to Card Stage while the user edits:

- title
- description
- assignee
- agent status

These fields do not call `onPatch` on every edit. They persist through the existing debounced or explicit save paths instead.

This prevents typing in Card Stage from invalidating the shared Kanban board store and forcing broad board/sidebar/card rerenders.

### Scoped Draft Overlay Store

Kanban previews can still reflect small local Card Stage drafts through `card-draft-store`. Card Stage writes a scoped overlay for title, assignee, and agent status. Description is intentionally excluded so board cards never parse or carry the full draft body while the user types; description preview updates arrive from the durable ack `CardSummary`.

This is a one-way graph:

- producer: Card Stage writes overlays from local draft state
- consumers: Kanban cards read overlays for display
- Card Stage itself must keep receiving the persisted/base card, not its own merged overlay

That one-way rule prevents feedback loops where Card Stage writes an overlay, the parent passes the merged card back into Card Stage, and Card Stage then clears or recreates the overlay repeatedly.

### Debounced Preview Updates

Because description React state updates only after serialized emission, Kanban description previews update shortly after typing pauses or after an explicit flush. This is intentional.

The product tradeoff is:

- active typing stays responsive
- previews are eventually current within the editor serialization debounce
- save/close/raw/card-switch paths remain exact because they flush

## Card Switching

Opening another card while a Card Stage is already active must close or persist the current stage first. Board, list, canvas, and calendar card-opening paths should call the Card Stage close ref before opening the next card.

This prevents a pending editor change from being dropped when the active card changes and the editor receives new external content.

Durable Card Stage panel tabs stay mounted while their panel leaf stays mounted, so switching between card tabs with focused panel-tab shortcuts preserves the BlockNote/ProseMirror editor instance, cursor, undo stack, and plugin state. Deactivating a Card Stage must call the same persist path used by close flows, but it must not call `onLeaveCard` or close the tab. Only the active Card Stage may publish shared `closeRef`, `persistRef`, and session-snapshot refs; inactive retained stages must stay hidden and ref-passive.

Preview-to-durable Card Stage promotion reuses the preview tab id. Treat that as the same editor identity: the promotion must not blur the NFM editor, remount the panel body, or clear ProseMirror selection. Active Card Stage previews should use the same retained panel wrapper as durable Card Stage tabs while they remain the renderer-local preview; switching away still clears the preview instead of keeping preview bodies around. Focus cleanup belongs at the tab-shell boundary and should only blur focus stranded inside hidden retained panels after the active tab id actually changes.

## Persistence Timing

There are two separate timing layers:

1. Editor draft serialization debounce: converts BlockNote document state to serialized NFM.
2. Field-save debounce: persists the serialized draft through the existing card update path.

The first layer keeps typing responsive. The second layer limits backend/storage writes. They should stay separate. Do not use the persistence debounce as a substitute for editor serialization debounce, because serialization itself is the synchronous CPU cost on the typing path.

The durable write layer is separate from both renderer timers. Card Stage may enqueue saves frequently enough to preserve the chosen durability semantics, but the Electron main process must only coordinate the async writer request and publish the returned events after the ack. Do not move card-description SQLite writes, history writes, or description-revision diffing back into main-process IPC/HTTP handlers.

## Invariants

- `NfmEditor` must not serialize the whole document on every ordinary editor transaction.
- `serializeEditorToNfm()` remains the correctness boundary for NFM output.
- Ordinary typing schedules serialized emission instead of doing it synchronously.
- Explicit lifecycle reads must call `flushPendingChange()` before reading `description`.
- Equal serialized output must not re-emit.
- Equal incoming external content must not call `replaceBlocks`.
- Focused, composing, or pending `NfmEditor` instances must not accept external `replaceBlocks`.
- Old save acknowledgements matching `lastEmittedContent` must not cancel a newer pending local emit.
- Suppressed external sync/drop paths must not emit user changes.
- Card Stage save/has-changes logic must read the latest description ref, not stale React state.
- Save requests must not clear freeform dirty flags until the returned card matches the current draft.
- Card-domain durable writes must go through `CardMutationWriter`; there must be no synchronous Electron main-process card write fallback.
- Description-only Card Stage autosaves must use staged `card:description:update:*`, not JSON `card:update`.
- Active Card Stage editors must not use board-summary revision changes to automatically rehydrate and replace the full description.
- Durable Card Stage tab switches must not remount the retained editor body while the tab remains open in the mounted panel leaf.
- Preview-to-durable Card Stage promotion must preserve focus and selection because it keeps the same client tab id and retained wrapper identity.
- Freeform text edits must not call `onPatch`.
- Kanban preview overlays must remain scoped by project/card.
- Kanban preview overlays must not include `description`.
- Card Stage must not consume its own merged draft overlay through props.
- Shared board snapshots must stay `BoardSummary`-only; successful description saves should merge the returned summary ack into board metadata and update the active card-detail cache from the submitted local draft plus acknowledged revision, without returning full descriptions or triggering a broad board refresh.
- Board-change events carrying `CardSummary` should patch renderer board caches directly; ambiguous structure-only events may coalesce a summary refetch.

## Testing Expectations

Editor serialization behavior is covered by `nfm-serialized-change-emitter.test.ts`:

- first edit marks dirty without synchronous serialization
- rapid edits coalesce into one emit
- explicit flush serializes immediately and clears the timer
- equal serialized output does not re-emit
- cancel drops suppressed changes without serialization

Card Stage behavior is covered by `use-card-stage-controller.test.tsx` and component tests:

- close/persist flushes pending editor content before saving
- raw-mode toggle flushes pending content first
- description drafts stay local and do not call `onPatch`
- description save-in-flight keeps stale card props from replacing the local draft
- conflict overwrite flushes and sends the current editor description
- panel-tab deactivation flushes and persists pending description content
- inactive retained Card Stages do not own shared close/persist/session refs
- equal external content does not trigger an editor document replacement
- active focused/pending NFM editors defer different external content without cancelling pending emission
- same-card prop sync does not overwrite description state while the raw editor has an unserialized pending change
- scoped draft overlays still update matching Kanban previews
- `CardStage` passes the flush handle into `NfmEditor`

Regression checks for related behavior should include:

- NFM parser tests
- NFM inline parser tests
- BlockNote adapter tests
- card draft store tests
- Kanban store tests
- card mutation writer tests
- board summary event patch tests
- board summary/detail/search tests
- Card Stage render/controller tests

## When Adding New Editor Features

Use this decision rule:

- If the operation is ordinary text input, schedule serialized emission.
- If the operation changes document structure, moves blocks, imports cards, sends blocks elsewhere, toggles raw view, saves, closes, or switches cards, flush or serialize immediately before reading durable NFM.
- If the operation is programmatic external sync, replace under suppression only after checking that the editor is not focused, composing, or pending.

When adding a new Card Stage path that reads `description`, ask whether a pending editor transaction could exist. If yes, call the flush handle first and read from `latestDescriptionRef`.

When adding a new preview consumer, read from `card-draft-store` by project/card. Do not route draft overlay data back into Card Stage's `card` prop.
