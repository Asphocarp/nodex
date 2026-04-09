# Desktop Notification Behavior

## Status

Active

## Purpose

This document defines the source-of-truth behavior for Nodex desktop notifications related to Codex Threads. It covers:

- which thread events can produce desktop notifications
- how notification settings are stored and applied
- when notifications are suppressed
- notification payload and action contracts
- how the renderer and main process divide responsibility

This document applies to the Electron desktop runtime. Browser delivery is out of scope.

## Scope

Core thread desktop notifications are limited to three notification families:

- `turn-complete`
- `permission`
- `question`

These correspond to:

- a local thread turn reaching a notifying terminal state
- a new approval request entering a live conversation
- a new request-user-input prompt entering a live conversation

The host notification manager may be reused by other features such as reminders, automation heartbeat notifications, or worktree failure notifications, but those are separate producers and are not part of this thread notification contract.

## Architectural Split

Desktop notifications are a three-layer feature.

### 1. Producer layer

The local conversation manager is the producer for local thread notifications.

It is responsible for:

- observing live conversation diffs
- emitting normalized `turn-complete`, `approval-request`, and `user-input-request` events
- deduplicating request ingress against existing live request ids
- explicitly suppressing user-interrupted turns from turn-complete notification emission

The producer does not know about window focus, settings suppression, OS notification objects, or route navigation.

### 2. Renderer controller layer

The renderer notification controller is responsible for:

- reading notification settings
- reading current window focus state
- reading the focused workbench stage and active thread tab
- suppressing or allowing notifications based on the rules in this document
- shaping user-facing notification title/body/action payloads
- handling notification actions returned from the main process

The renderer does not own Electron `Notification` instances.

### 3. Host layer

The main process notification manager is responsible for:

- creating and tracking Electron `Notification` objects
- registering click, button, close, and reply callbacks
- focusing the origin window before `open` actions are delivered back to the renderer
- dismissing notifications by conversation id
- applying host-only details such as `timeoutType`, action cap, reply support, and macOS sound staging

## Settings Model

Thread desktop notifications use three independent settings.

### Turn-complete mode

Stored as:

- `turnMode: "off" | "unfocused" | "always"`

Behavior:

- `off`: never notify for turn-complete
- `unfocused`: notify for turn-complete only when the app window is not focused
- `always`: notify for turn-complete regardless of same-conversation focus

### Approval notifications

Stored as:

- `permissionsEnabled: boolean`

Behavior:

- controls approval-request notifications only
- does not affect turn-complete or question notifications

### Question notifications

Stored as:

- `questionsEnabled: boolean`

Behavior:

- controls request-user-input notifications only
- does not affect turn-complete or approval notifications

### Defaults

Fresh defaults are:

- `turnMode = "unfocused"`
- `permissionsEnabled = true`
- `questionsEnabled = true`

### Storage keys

The persisted config keys are:

- `thread_notifications_turn_mode`
- `thread_notifications_permissions_enabled`
- `thread_notifications_questions_enabled`

No legacy notification keys are part of this contract.

## Producer Rules

### Turn-complete producer

The producer emits a `turn-complete` event only when all of the following are true:

- the conversation already existed in the live manager
- the turn existed before the update
- the previous turn status was `inProgress`
- the new turn status is `completed` or `failed`

The event payload includes:

- `conversationId`
- `turnId`
- `lastAgentMessage`

`lastAgentMessage` is taken from the final assistant message in that turn after whitespace normalization. If no assistant message exists, it is `null`.

### Interrupted-turn exclusion

User-interrupted turns must never emit a `turn-complete` notification.

This exclusion is explicit. The producer tracks interrupted turn ids so a later terminal update for that same turn still cannot generate a turn-complete notification.

This applies to:

- normal interrupt flow from an already-known in-progress turn
- optimistic renderer-side interrupt paths before later stream reconciliation arrives

### Approval-request producer

The producer emits an approval notification event when:

- a request id is present in the new `conversation.requests`
- that request id was not present in the previous `conversation.requests`
- the request type is `approval`

The event payload includes:

- `conversationId`
- `requestId`
- `kind`
- `reason`

`kind` is `command` or `file`.

### Question producer

The producer emits a question notification event when:

- a request id is present in the new `conversation.requests`
- that request id was not present in the previous `conversation.requests`
- the request type is `userInput`

The event payload includes:

- `conversationId`
- `requestId`
- `turnId`
- `questionCount`
- `firstQuestion`

### Bootstrap and resume behavior

The producer must not emit notifications from:

- initial bootstrap snapshots
- cold snapshot hydration for a conversation first entering the manager
- resume hydration that is effectively a current-state snapshot rather than a new live ingress

Notifications come from live deltas, not from first-seen current state.

## Focus and Suppression Rules

### Same-conversation focused

For desktop notification suppression, "same conversation focused" means:

- `focusedStage === "threads"`
- the active thread tab is a real thread id, not the new-thread placeholder
- `activeThreadsTabId === conversationId`
- the app window is focused

### Turn-complete suppression

Turn-complete notifications are governed only by:

- `turnMode`
- current window focus state

Turn-complete notifications are not suppressed merely because the same conversation is already open.

Rules:

- `off`: always suppress
- `unfocused`: suppress when the app window is focused
- `always`: never suppress for focus reasons

### Approval suppression

Approval notifications are shown only when:

- `permissionsEnabled === true`
- the same conversation is not focused

Approval notifications do not consult `turnMode`.

### Question suppression

Question notifications are shown only when:

- `questionsEnabled === true`
- the same conversation is not focused

Question notifications do not consult `turnMode`.

## Notification Payload Shape

The renderer sends normalized notification payloads to the host with this shape:

```ts
interface DesktopNotificationPayload {
  id: string;
  kind: "turn-complete" | "permission" | "question";
  title: string;
  body: string;
  conversationId?: string;
  requestId?: string;
  actions?: Array<{
    id: string;
    title: string;
    actionType: "approve" | "approve-for-session" | "decline";
  }>;
  replyPlaceholder?: string;
}
```

### Payload invariants

- `id` is unique per active notification
- `conversationId` is included for all thread notification families
- `requestId` is included for approval and question notifications
- `actions` are used only for approval notifications
- `replyPlaceholder` is used only for turn-complete notifications

## User-Facing Copy Rules

### Turn-complete title

Use:

- thread title when available
- otherwise `Turn complete`

### Turn-complete body

Body selection order:

1. normalized final assistant message summary for code-review findings
2. normalized final assistant message
3. fallback `Codex finished a turn.`

If the final assistant message contains inline review findings (`::code-comment{...}`), summarize as:

- `Code review finished. No findings.` when the review explicitly reports no findings
- `Code review finished. 1 finding.`
- `Code review finished. N findings.`

### Approval title

Use:

- `Command approval` for command approvals
- `File edit approval` for file-edit approvals

### Approval body

Use:

- normalized approval reason when present
- otherwise `Approval required`

### Question title

Use:

- thread title when available
- otherwise `Need your input`

### Question body

Use:

- `Answer N questions to proceed.`
- `Answer 1 question to proceed.`
- `Answer a question to proceed.`

depending on `questionCount`.

## Host Delivery Rules

### Action cap

The host must cap notification buttons to 4 actions.

### Reply support

Reply is enabled only when:

- `kind === "turn-complete"`
- `replyPlaceholder` is present and non-empty

Approval and question notifications are never reply-enabled.

### Timeout behavior

Use:

- `timeoutType: "never"` for `permission`
- `timeoutType: "never"` for `question`

Turn-complete notifications do not force `timeoutType: "never"`.

### Sound behavior

On macOS, the host may stage a packaged notification sound once and reference it by name for delivery. If staging fails, delivery still proceeds without a custom sound.

## Action Routing

The host sends renderer actions back in this shape:

```ts
interface DesktopNotificationActionPayload {
  notificationId: string;
  actionId: string | null;
  actionType: "open" | "reply" | "approve" | "approve-for-session" | "decline";
  reply?: string;
}
```

The renderer receives that plus:

- `conversationId`
- `requestId`

from the host callback context.

### Open

When the user clicks the notification body:

- the host focuses the origin window first
- the renderer navigates to the matching thread tab

### Reply

Reply is valid only for turn-complete notifications.

The renderer:

- opens the matching thread tab
- sends a new turn using the reply text

Empty replies are ignored.

### Approval actions

Approval buttons map as follows:

- `approve` -> `accept`
- `approve-for-session` -> `acceptForSession`
- `decline` -> `decline`

The renderer:

- opens the matching thread tab
- routes the decision through the existing approval-response path for that request id

### Questions

Question notifications are open-only in desktop notification delivery.

They do not support:

- inline reply
- inline question answering
- approval-style action buttons

## Dismissal Rules

When the active thread tab becomes a real thread id, the renderer requests host dismissal for that conversation id.

Host dismissal closes all tracked notifications associated with that conversation id.

This keeps thread notifications from lingering after the user is actively viewing that thread.

## Transport Contract

Renderer-to-main invoke channels:

- `desktop-notification:show`
- `desktop-notification:hide`
- `electron-window:focus:get`

Main-to-renderer events:

- `desktop-notification:action`
- `electron-window:focus-changed`

The browser `Notification` API is not the delivery mechanism for this feature. Browser-side permission probing may exist opportunistically, but Electron host delivery is authoritative.

## Out of Scope

The following are not part of the core thread notification path defined here:

- reminders
- automation heartbeat notifications
- worktree failure notifications
- browser-native notification delivery
- remote unread-thread notification feeds

Remote unread-thread notifications, if added later, must remain a separate producer path rather than reusing local `turn-complete` emission semantics.
