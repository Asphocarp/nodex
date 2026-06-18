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

This means the editor can accept rapid typing with minimal Nodex-owned synchronous work. Card Stage and Kanban previews still catch up shortly after typing pauses, and important lifecycle paths flush immediately before reading or saving description data.

## Board Read Model

Card Stage typing must also avoid broad renderer data refreshes after persistence. The high-frequency board store now fetches `BoardSummary`, where each card carries only `descriptionPreview`, `descriptionLength`, and `hasDescription`. Full `description` bodies are not part of the shared board snapshot.

Full card bodies are loaded through explicit detail paths:

- Card Stage hydrates the active card with `card:get`/`card-detail-store`.
- Toggle-list, inline toggle-list, and `cardRef` projections compute visible card ids from summary state, then hydrate those ids through `cards:details:get`.
- Command palette description matches come from `cards:search`, which returns ids and bounded excerpts instead of full descriptions.

This keeps save acknowledgements and board-change refreshes from sending every card body through Electron IPC structured clone. `board:get` remains only as a legacy full-payload compatibility path and should not be used by normal renderer flows.

## Editor-Side Features

### Dirty-First Change Handling

`NfmEditor` no longer serializes the full document inside the BlockNote `onChange` handler. Instead, ordinary editor changes call the serialized change emitter's `schedule()` method. Scheduling only records that there is pending work and resets the debounce timer.

This keeps the per-transaction path small:

- ignore changes while external sync/drop suppression is active
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

### Discrete Immediate Operations

Some editor operations need durable NFM immediately. These paths cancel or flush pending work and serialize synchronously as part of the operation:

- toggle click handling
- block send to an existing card
- block send to a project
- card import drop
- projected-card drop into the editor
- inline-view card drop import
- external content sync

The rule is: if an operation is discrete, structural, or needs a precise before/after document snapshot, it must not wait for the draft debounce.

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

Freeform dirty flags (`title`, `description`, `assignee`, `agentStatus`) must not be cleared when a save request is merely sent. They clear only when a successful acknowledgement returns a value that still matches the current local draft. If the user continues typing while a save is in flight, older acknowledgements and stale card-detail hydrations must leave the local draft intact.

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

Kanban previews can still reflect local Card Stage drafts through `card-draft-store`. Card Stage writes a scoped overlay for the active project/card. Preview consumers for that card can merge the overlay into their display model.

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

## Persistence Timing

There are two separate timing layers:

1. Editor draft serialization debounce: converts BlockNote document state to serialized NFM.
2. Field-save debounce: persists the serialized draft through the existing card update path.

The first layer keeps typing responsive. The second layer limits backend/storage writes. They should stay separate. Do not use the persistence debounce as a substitute for editor serialization debounce, because serialization itself is the synchronous CPU cost on the typing path.

## Invariants

- `NfmEditor` must not serialize the whole document on every ordinary editor transaction.
- `serializeEditorToNfm()` remains the correctness boundary for NFM output.
- Ordinary typing schedules serialized emission instead of doing it synchronously.
- Explicit lifecycle reads must call `flushPendingChange()` before reading `description`.
- Equal serialized output must not re-emit.
- Equal incoming external content must not call `replaceBlocks`.
- Suppressed external sync/drop paths must not emit user changes.
- Card Stage save/has-changes logic must read the latest description ref, not stale React state.
- Save requests must not clear freeform dirty flags until the returned card matches the current draft.
- Active Card Stage editors must not use board-summary revision changes to automatically rehydrate and replace the full description.
- Freeform text edits must not call `onPatch`.
- Kanban preview overlays must remain scoped by project/card.
- Card Stage must not consume its own merged draft overlay through props.
- Shared board snapshots must stay `BoardSummary`-only; description saves should merge returned full cards into summary metadata and the card-detail cache without triggering a legacy full-board refresh.

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
- equal external content does not trigger an editor document replacement
- scoped draft overlays still update matching Kanban previews
- `CardStage` passes the flush handle into `NfmEditor`

Regression checks for related behavior should include:

- NFM parser tests
- NFM inline parser tests
- BlockNote adapter tests
- card draft store tests
- Kanban store tests
- board summary/detail/search tests
- Card Stage render/controller tests

## When Adding New Editor Features

Use this decision rule:

- If the operation is ordinary text input, schedule serialized emission.
- If the operation changes document structure, moves blocks, imports cards, sends blocks elsewhere, toggles raw view, saves, closes, or switches cards, flush or serialize immediately before reading durable NFM.
- If the operation is programmatic external sync, cancel pending user-style emission and update the editor under suppression.

When adding a new Card Stage path that reads `description`, ask whether a pending editor transaction could exist. If yes, call the flush handle first and read from `latestDescriptionRef`.

When adding a new preview consumer, read from `card-draft-store` by project/card. Do not route draft overlay data back into Card Stage's `card` prop.
