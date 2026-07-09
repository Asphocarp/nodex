# Codex Thread Owner/Follower Streaming

Status: Active
Last Updated: 2026-07-07

## Intent

Nodex supports multiple desktop windows viewing and operating on the same live Codex thread. One renderer window owns the live transcript projection for a thread; follower windows mirror that owner through ordered snapshots and patches, and route state-changing actions back to the owner instead of mutating local transcript state directly.

This contract keeps live streaming text, request cards, queued state, edit/rollback, and recovery behavior consistent across windows.

## Terms

- **Streaming thread**: a Codex app-server thread that is started, resumed, or attached to a live transport and may emit thread, turn, item, or server-request events.
- **Owner window**: the renderer window allowed to reduce live app-server events into visible conversation state for one thread.
- **Follower window**: a renderer window that displays the same thread from owner snapshots and patches.
- **Source-null baseline**: a main-owned cold/recovery/no-owner stream baseline whose stream messages carry no renderer `sourceClientId`. It is not a follower role and cannot route actions to another window.
- **Stream revision**: a per-thread monotonically increasing revision attached to owner snapshots and patches.
- **Owner client id**: the stable renderer-client identity carried with stream updates so followers can reject stale owners.
- **Complete-history barrier**: a follower asks the owner to load complete history, waits for the owner-published revision, then continues with history-sensitive work.

## Scope

This spec covers:

- owner/follower stream roles for active local Codex threads
- revisioned snapshot and patch application
- live assistant, plan, and reasoning prose streaming
- state-changing action routing from followers to owner
- request-plane ownership for approvals, user input, permissions, and MCP elicitations
- edit-last-user-turn rollback/replacement ordering
- complete-history, resume, owner-loss, and inactive-owner cleanup

This spec does not cover:

- browser/HTTP Codex thread support
- realtime voice transcript UI
- first-run onboarding picker/setup UI
- visual styling unrelated to transcript ownership
- exact replay of hidden prompt-start params not stored in the conversation model

## Ownership Rules

At any moment, a streaming thread has one effective owner window for a given host.

Only the owner may:

- reduce visible thread mutation notifications
- run the assistant/plan/reasoning prose frame queue
- publish `threadStreamStateChanged` snapshots or patches
- own live request cards and request-response cleanup
- execute state-changing thread actions directly

Followers must:

- apply only matching owner snapshots and contiguous patches
- reject patches from missing, stale, or mismatched owners
- reject patches whose `baseRevision` does not equal the local revision
- route state-changing actions to the owner
- mark the conversation `needs_resume` when the owner disappears

Source-null baselines must:

- accept only source-null snapshots and contiguous source-null patches
- never be treated as routable followers
- resume into current-window renderer ownership before owner-local actions such as edit, fork, or active visible mutations
- ignore source-null refreshes once the renderer is a real follower of a non-empty owner client id

Main process must:

- provide stable renderer client ids
- route owner/follower messages and validate response origins
- host app-server transport and durable/recovery cache state
- suppress competing source-null visible stream updates while a confirmed renderer owner exists
- confirm renderer ownership only from an accepted owner stream-state publish, not from a fallible request entry point such as resume or turn start

## Stream State

Snapshots contain the full `conversationState` and a target `revision`.

Patches contain `baseRevision`, `revision`, and ordered Immer-compatible patches.

A follower applies a patch only when:

- local role is `follower`
- patch `sourceClientId` matches the recorded owner
- local revision equals patch `baseRevision`

A source-null baseline applies a patch only when:

- local role is the source-null baseline
- patch `sourceClientId` is null
- local revision equals patch `baseRevision`

On mismatch, the follower drops the patch and waits for a future owner snapshot, explicit resume, or owner-loss recovery. It does not request a source-null snapshot just because a stale patch was observed.

A renderer that is already owner ignores incoming stream-state messages, including main fallback changes and publish echoes. A real follower ignores source-null snapshots and patches so explicit resyncs cannot downgrade it into a non-routable state.

## Prose Streaming

Assistant, plan, and reasoning text stream as live owner patches, not as completed-message animation.

Required behavior:

- `item/started` creates the canonical item and does not force prose flushes.
- Prose deltas append only to existing matching assistant/plan/reasoning items.
- Missing or kind-mismatched delta targets are dropped, ACKed, and logged.
- The owner batches visible prose through a frame queue.
- `item/completed` drains pending prose before applying the authoritative completed item.
- Terminal `turn/completed`, `turn/interrupted`, and `turn/failed` drain pending prose before final turn state applies.

Frame queue constants:

- visible renderer frames use `requestAnimationFrame`
- fallback timer is `16ms`
- normal prose flushes up to `24` characters per frame
- terminal drain uses at most `8` frames
- hidden/no-rAF/small terminal buffers flush synchronously

Streamdown remains the markdown renderer and in-progress visual animation layer. It is not the upstream transport mechanism for live text.

## Owner Actions

Follower-originated state-changing actions route to the owner:

- start turn / follow-up turn
- steer active turn
- interrupt turn
- update thread settings
- compact thread
- edit last user turn
- set or clear thread goal
- set thread memory mode
- approval, permission, user-input, and MCP elicitation responses
- queued follow-up mutations
- plan-implementation request removal
- complete-history load
- fork from turn

The owner performs visible mutations locally and publishes the resulting stream revision. Main validates ownership and executes allowlisted app-server requests through the owner-scoped request facade.

### Start Turn

For active owned threads, the renderer owner creates the submitted-user bubble:

1. Generate `clientUserMessageId`.
2. Append a temporary in-progress turn with a completed optimistic user item.
3. Publish the optimistic owner revision.
4. Call app-server `turn/start` through the owner-scoped facade with the same client id.
5. Rebind the temporary turn to the returned app-server turn id.
6. Publish the rebind revision.

Later app-server user-message echoes merge with the optimistic row instead of creating a second user bubble.

### Edit Last User Turn

Editing the latest user turn is an owner-local ordered transaction:

1. Ensure the local conversation is owner; no-role local edits resume first.
2. Verify the target is the latest completed editable user turn.
3. Wait for the owner publish cursor and already-forwarded owner notifications to settle.
4. Call app-server `thread/rollback` through the owner-scoped facade.
5. Project the raw rollback response into local owner conversation state.
6. Publish the rollback snapshot.
7. Tombstone removed turn/item ids so late notifications cannot recreate the old bubble.
8. Start the replacement turn through the same owner-local start-turn path.
9. Followers wait for the returned owner revision before the edit action resolves.

Current edit replacement input is reconstructed from visible user-message content. Text, images, mentions, skills, and text attachments represented in `rawItem.content` are preserved. Hidden start params such as structured comment attachments or agent config overrides are not replayed unless they are persisted in the conversation model.

## Request Plane

Live approval, permission, request-user-input, and MCP elicitation rows are visible request-plane state. When a renderer owner exists:

- main keeps JSON-RPC pending-response plumbing
- the owner stores and publishes visible request rows
- response UI routes by `conversationId` before local request lookup
- owner response cleanup removes the request and publishes completed request item state
- stale followers do not call direct response IPC when they missed the request row locally

Dynamic tool calls that do not create visible request state are owner-gated and ACKed without ordinary stream patches.

## History and Resume

History-sensitive actions must pass the complete-history barrier before they run from a follower. The owner loads complete history, publishes the target revision, and the follower waits for that revision before edit, fork, or older-turn work continues.

Explicit resume hydrates the latest tail and returns the hydrated conversation to the requesting renderer. Main silently updates its recovery/broadcast cache for `resuming` and `resumed` without advancing the renderer stream revision or emitting source-null snapshots. The renderer applies the hydrated conversation, marks itself owner using its current renderer-local stream revision, releases buffered same-thread notifications and requests, then publishes the owner snapshot as the next renderer revision. Resume failure releases the buffer, returns the local conversation to `needs_resume`, and must not use a source-null snapshot to overwrite partial owner state.

Renderer ownership adoption is part of that resume transaction. Main resolves the invoking renderer's registered client ID from the resume IPC event and, after successful hydration but before returning the snapshot, adopts that client only when no different owner exists. A failed, archived, non-resumed, disposed-client, or competing-owner resume never installs or replaces an owner. The first resumed snapshot can therefore publish immediately while unknown and wrong-client publications remain fail-closed.

Background child-agent summaries are not active child-thread streams. Parent thread surfaces may show child memberships and multi-agent-derived row state, but a child thread becomes full-fidelity only when a background-agent detail tab opens it. Multi-agent visible rows are derived from receiver thread display metadata and agent state keys; sparse receiver id lists remain available to membership/reference projection but do not create clickable visible row targets on their own. Receiver display metadata is lightweight catalog data, so friendly agent names and seed-based identicons must not depend on parent-driven child snapshot hydration. The background-agent opener hydrates only the selected child thread id and opens the tab; the detail tab content materializes/resumes the child body and then marks the child thread opened for routed deltas without requiring local parent metadata.

When the owner client disappears, followers reject revision waiters, clear the owner role, mark the conversation `needs_resume`, and recover through explicit resume.

## Source-Null Boundaries

Source-null snapshots remain valid for cold load, explicit snapshot/resume, no-owner fallback, inactive-owner cleanup, and durable recovery. They must not be used as hot repair for active owner state.

Owner patch publication is a follower-broadcast side effect, not the owner-visible state boundary. Main validates the owner client and broadcasts the owner change; renderer followers enforce owner id and `baseRevision` continuity.

## Implementation Coverage

The current implementation covers these owner/follower contract areas:

| Area | Status | Contract |
| --- | --- | --- |
| Single visible owner | complete | One renderer reduces active live transcript state; main owns transport, persistence, routing, and recovery caches. |
| Follower mirror semantics | complete | Followers apply matching owner snapshots/patches and drop stale owner/base mismatches. |
| Follower mutation guard | complete | State-changing follower actions route to the owner unless explicitly no-op, owner-local, or outside transcript ownership. |
| Request ownership | complete | Approval, permission, user-input, and MCP elicitation request rows are owner-visible state. |
| Notification ownership | complete | Owner-visible app-server notifications route to the renderer owner while source-null visible fanout is suppressed. |
| Prose and output queues | complete | Assistant, plan, reasoning, command output, and terminal interaction updates are ordered through owner-local queues. |
| Resume/start/history lifecycle | complete | Resume uses the renderer-local stream revision, releases the resume buffer before the owner snapshot, optimistic start/rebind, and complete-history revision waits are owner-published. |
| Owner-loss recovery | complete | Owner disposal rejects waiters and marks followers `needs_resume`. |
| Source-null discipline | complete | Source-null snapshots are restricted to cold load, explicit recovery, no-owner fallback, inactive-owner cleanup, and durable recovery. |

Covered owner-routed actions include start turn, edit last user turn, steer turn, interrupt turn, thread settings, goal changes, memory mode, compaction, complete history, queued follow-ups, request responses, fork from turn, and plan-implementation request removal.

Covered owner-visible notification categories include thread metadata/status, turn lifecycle, item lifecycle, assistant/plan/reasoning deltas, command output, file-change patches, request resolution, and turn errors. Progress-only, deprecated, or unsupported rows are validated, ACKed when needed, and kept out of ordinary visible stream patches.

No owner/follower streaming gaps are currently tracked. The remaining fidelity caveat is edit replacement input: Nodex reconstructs replacement prompt input from visible user-message content, preserving text/images/mentions/skills/text attachments represented in `rawItem.content`. Exact replay of hidden start params such as structured review comments or agent config overrides requires persisting those params in the conversation model.

## Validation Expectations

Required regression coverage includes:

- live partial prose appears before completion in owner and follower windows
- terminal lifecycle waits for pending prose drain
- owner patch publish does not gate owner-visible state
- owner publish failure preserves partial text
- edit rollback removes the old turn before replacement starts
- follower actions wait for returned owner revisions
- request responses route through owner by conversation id
- stale patches are dropped without source-null resync
- owner-loss recovery marks followers `needs_resume`
- failed resume/start requests do not leave stale main-side renderer owner mappings
- renderer-owned resume seeds the owner cursor from the renderer-local stream revision, releases the resume buffer, and then publishes the hydrated owner snapshot
- ordinary resume IPC adopts its invoking renderer before returning, so the first owner snapshot succeeds without test-only owner seeding
- resume failure releases the buffer and rolls local state back to `needs_resume`
- parent thread mounts do not mark background child agents opened; only background-agent detail tabs do
