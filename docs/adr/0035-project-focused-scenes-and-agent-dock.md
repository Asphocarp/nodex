# ADR 0035: Project-focused Scenes and the Agent Dock

## Status

Accepted

## Context

ADR 0034 separated durable Project and Session domain state from
Window Session-owned Workbench Scenes. Its first renderer kept the owner root
on a separate primary plane and opened an ordinary Session Conversation as a
Project right-panel surface when the user asked an agent for help.

That composition exposed implementation boundaries as product concepts. A
Project Database appeared to sit behind a side panel even when it was the
Project's main workspace; full-width panel chrome could hide Project identity;
and a Project Conversation surface mounted a second task-shaped page without
owning that task's navigation or complete lifecycle. An initial Agent Dock
implementation then used the Scene that started a turn as the durable owner of
Browser Use output. That kept the user in the Project Scene, but left a
task-created Browser tab beside Project resources after the Dock switched to a
different task and separated its visible location from its Session lifecycle.

The product needs one Project workspace where users can switch among Database,
Page, Browser, Files, Review, and other surfaces while retaining lightweight
access to a real task. It does not need a Project Home entity, a synthetic
Session, or a second conversation runtime.

## Decision

### The Project root is part of the surface stack

`WorkbenchSceneSnapshot` version 2 keeps one semantic `primary` descriptor but
allows a Project primary to occur in the right-panel placement tree. A Project
Scene normalizes that tree into a permanently open, full-width surface stack:

- the Project's symbolic default Database surface occurs exactly once;
- it is in the right panel, at the start of its leaf, and cannot be closed,
  moved, or split away;
- ordinary surfaces keep the existing tab, split, preview, close, and runtime
  policies;
- the bottom panel remains independent;
- Project chrome is rendered in the root tab header and names the Project
  without inventing a `Home` route or label.

The primary descriptor still means "the owner root" rather than "the DOM plane
behind the right panel." Session Scenes retain Conversation on the primary
plane and keep their existing collapsible and expandable right-panel behavior.
One pure surface resolver and the Scene codec enforce the distinction.

Scene v1 migration is deterministic and idempotent. It moves the Project root
into the fixed stack, removes Project Conversation descriptors without deleting
their Sessions, and converts the active Conversation target into an Agent Dock
binding when possible. Session Scene placement is unchanged. Window cloning
remints the Project's unbound draft identity while preserving bindings to real
Sessions.

### Project collaboration is a Session-bound Agent Dock

Every Project Scene owns Window Session-local Agent Dock presentation state:
visibility, one binding to either `New task` or an exact Project Session, and a
stable identity for the unbound draft. Binding and visibility are persisted but
do not create Back/Forward checkpoints.

The Dock mounts the shared conversation footer, latest-turn projection,
blocking requests, and composer. It does not mount a transcript body, a second
conversation store, or a second Browser host. Selecting a task changes only the
Dock binding. `Open task` uses ordinary Session navigation. Hiding the Dock
removes its layout reserve and presented-view claim but does not stop the turn
or release Main-owned runtimes.

`New task` is lazy. Opening a Project or selecting the target creates no Core
Session. The first send creates one Project Session, promotes the Scene-local
draft identity to that Session, persists the binding, and then starts the real
Codex Thread without navigating away. Creation is coalesced per draft. If Core
creation fails, the unbound draft remains; if Thread start fails after Session
creation, the Dock remains bound to that blank Session so retry does not create
a duplicate.

A `newWorktree` start remains bound to that exact blank Session. The Dock
derives setup progress from the existing Main-synchronized pending-worktree
collection by `projectSessionId`; it does not persist or reconstruct a second
pending state machine. While that exact entry exists and no Thread is attached,
the target row exposes compact progress or failure attention, the composer and
start action reject a second launch, and an explicit details action opens the
full recovery route. The client identity is registered into the same scope and
is promoted again when the real Thread attaches. Reload therefore recovers from
Main authority rather than renderer memory.

The selector uses bounded Project Session windows plus exact selected-Session
hydration. An absent summary row is never deletion evidence. A Project with no
Sessions presents `New task` immediately rather than a synthetic loading child.

### Browser presentation follows the owning Session

Browser execution remains Main-owned and independent from whether the Dock or
a task page is mounted. Each Browser Use runtime tab carries its exact Codex
Session/Thread id; renderer hosts must not infer one id from the currently
selected task and apply it to every tab. Agent-created Browser surfaces belong
to the Project Session that owns that Thread. Manually opened Project Browser
surfaces remain Project-owned and are not implicitly exposed to a Dock task.

Selecting a Dock target is subscription only and never captures Browser
presentation. Immediately before an idle turn starts, the renderer submits the
exact owning Session namespace and Window Session view scope. `New task`
materializes its real Session before capture, so neither its Scene-local draft
identity nor the Project Scene becomes a Browser namespace. A newly created
Thread promotes that Session route to the canonical Codex Thread route before
its first turn is dispatched, including pending-worktree starts. Capture or
promotion failure prevents that turn from starting and remains retryable.
Steering or queueing into an already active turn does not rebind its route.

A visible Browser Use request first materializes or reuses the exact Browser
surface in its Session Scene, then selects that Session so host presentation is
truthful. The Window Session navigation checkpoint preserves the originating
Project Scene for Back navigation. A background or hide request updates the
owning Session Scene without selecting it. Hiding the Dock does not stop,
transfer, or rebind the Browser runtime.

## Authority boundaries

- Core owns Projects, Sessions, Session-to-Thread links, and task ordering.
- Codex conversation Modules own one canonical live Thread/Turn state.
- A Window Session Scene owns surface placement plus Agent Dock binding,
  visibility, and unbound draft identity.
- Main Browser services own route capture, route promotion, controlled pages,
  runtime-tab ownership, and guest lifecycle.
- Renderer coordinators project Main presentation intent into the currently
  matching Scene; they do not become Browser runtime authority.

## Consequences

- A Project reads as one general surface workspace rather than a special Home
  page or a Database hidden behind side-panel geometry.
- Users can discuss and edit in the same Project Scene while every sent message
  belongs to a normal sidebar task.
- A task page and a Project Dock can observe the same canonical Thread in
  different windows without creating duplicate execution state.
- Background turns and Browser guests outlive Dock visibility and target
  changes, while each agent-created Browser surface has one deterministic
  Session owner.
- Scene migration and panel operations have stronger root invariants, and the
  Project right-panel toggle/restore actions are intentionally unavailable.
- The Dock adds a small cross-authority materialization adapter, but failed
  starts recover forward through the retained Session instead of false rollback.

This ADR supersedes ADR 0034 only where that ADR requires the owner root to
remain on a separate physical plane or presents a Conversation surface beside a
Project. ADR 0034's Scene ownership, navigation, Window Session persistence,
resource-surface, and Core cleanup decisions remain in force.

## Rejected alternatives

### Add a Project Home route or dashboard

This would duplicate Project navigation and surface composition while giving a
hard-coded page no independent domain authority.

### Keep a full Conversation surface inside the Project Scene

That surface would look like a task page while lacking its route semantics and
would mount unnecessary transcript, scroll, and presentation state. The Dock
provides the collaboration boundary without duplicating the page.

### Automatically bind the most recent or active task

Background activity would silently change the recipient of the next message.
The explicit target is stable until the user changes it.

### Capture Browser presentation when a task is selected

Selection is observation, not execution. Capturing on selection can steal live
presentation from another window and still races the first turn.

### Keep task-created Browser surfaces in the Project Scene

This makes the Project Scene appear to own output whose execution, cleanup, and
continuation belong to one task. Switching the Dock target then leaves durable
task artifacts beside unrelated Project resources and obscures which Session
will continue controlling them.

### Move Browser ownership into the Dock

Browser guests and automation are process runtimes, not React descendants.
Tying them to Dock mount or visibility would break background execution and
multi-surface ownership.
