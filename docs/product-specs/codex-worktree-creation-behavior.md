# Codex Worktree Creation Behavior

## Intent

This document owns the user-visible and cross-runtime contract for starting a
Codex Chat in a new managed Git worktree. It covers the Composer target and
environment choices, pending setup route, Git and setup transaction, retry and
cancel behavior, conversation handoff, and the worktree initialization activity
shown at the top of the finished Chat.

General Chat identity and Project ownership remain in
[Codex Workspace Behavior](codex-workspace-behavior.md). General transcript
projection remains in
[Codex Thread Transcript Behavior](codex-thread-transcript-behavior.md). Exact
host elements, token classes, icons, and visual fixtures are owned by the
focused renderer components and Storybook stories named below.

## Composer contract

`Work in` is the Composer's execution-target menu. For a Project with a primary
Git source it offers `Local` and `New worktree`; targets that are unavailable for
the selected Project or host stay disabled instead of failing after submit. The
selected target is Composer draft state and does not mutate Git.

For one source folder, the worktree row is labelled `New worktree`. For a
multi-source Project it is labelled `New worktree · <primary repository>` and
its secondary text says `Work locally in 1 other folder` or
`Work locally in N other folders`. Only the primary Git source is copied into a
new worktree. Other Project roots remain direct source roots for the new Chat.
The trigger and menu use the shared dropdown portal, roving keyboard focus,
selected checkmark, disabled semantics, and focus restoration.

Selecting `New worktree` reveals two adjacent Composer controls:

- The starting-state control chooses the current working tree, a local branch,
  or a remote branch. A working-tree choice includes tracked, staged, binary,
  ignored-included, and untracked local changes. A remote choice preserves both
  its display branch name and full remote ref; opening the menu never creates a
  source-repository branch.
- The Environment control chooses one valid Environment or `Work without
  environment`. It is titled `Environment`, or `Environment · <repository>`
  when the repository name disambiguates a multi-root Project. It exposes
  loading, load-error, empty, default, selected, and needs-attention states and
  ends with `Environment settings`.

Submit freezes one immutable launch descriptor containing the host, primary and
additional source roots, starting state, resolved Environment path, prompt and
attachments, collaboration and intelligence settings, permission inputs,
Project assignment, goal/pin/title metadata, and client Thread identity. The
renderer then opens the pending client route. It does not call app-server
`thread/start` until the worktree is ready.

## Environment resolution

Environment selection distinguishes three user intents and never collapses
them into one nullable guess:

- With no stored choice, Nodex selects the first successful
  `environment.toml`, otherwise the first successful Environment, otherwise the
  first returned record. An unreadable first record becomes needs-attention;
  it is not silently replaced by another setup.
- An explicit stored `null` always means `Work without environment` and runs no
  setup script.
- A stored path is canonicalized against equivalent host paths. A missing,
  unreadable, too-large, or invalid selected file is needs-attention and retains
  its repair path. It never falls back to a different Environment.

A config-list load failure is unresolved rather than `No environment`.
Composer submission is blocked while the selected intent cannot be safely
resolved. Opening Environment settings receives the exact repair path when one
exists.

## Pending lifecycle and actions

Electron Main owns an in-memory collection of pending worktrees. Each entry has
an immutable launch descriptor plus an attempt number, phase, two bounded output
tails, allocated roots, failure/attention metadata, and presentation metadata.
Its worktree phase is one of `queued`, `creating`, `setting-up`,
`worktree-ready`, or `failed`. Conversation start is a separate state machine:
`waiting`, `starting`, `succeeded`, or `failed`.

Every worker and conversation terminal event carries the current attempt.
Events from an aborted or superseded attempt are ignored. Worktree output and
setup output are independent trailing 32,000-character buffers. The worker
emits an explicit phase with every chunk; Main never guesses phase from log
text.

The pending route uses the normal conversation scroll frame. It shows the
submitted user bubble with an always-available Copy action, then worktree/setup
activities and their output. Running and terminal actions appear in this order:

- During `queued`, `creating`, or `setting-up`: `Work locally`, then `Cancel`.
  Both share the active-action loading state.
- After a creation failure: `Edit environment`, then `Retry` when applicable.
- After setup failure with an allocated worktree: `Edit environment`,
  `Auto-fix` when eligible, `Retry`, then the primary `Continue anyway` action.
- After conversation-start failure: `Retry`; retry starts the conversation from
  the ready worktree and does not create another worktree or Project Session.

`Work locally` aborts and cleans a partial new worktree, starts the original
launch from its source root, and navigates using the Thread id returned by Main.
`Cancel` aborts the current worker attempt, removes any published partial
worktree, and returns to the source context. `Retry` after worktree/setup
failure cleans the failed worktree before starting the next fenced attempt.
`Continue anyway` keeps the created worktree, records setup as skipped, and
continues to conversation start. Dismissal after successful handoff removes only
pending presentation state and never deletes the ready worktree.

Auto-fix starts an independent pending repair Chat without an Environment. A
stable-worktree request shares the worker transaction but, on success, adds a
workspace root and does not start a conversation. Neither path changes the
ordinary prompt-created worktree state machine.

## Host-owned worktree transaction

Main coordinates the lifecycle but performs no worktree filesystem mutation in
the renderer or app-server process. A host-scoped `CodexWorktreeWorkerPort`
executes create/remove operations. The local adapter is a dedicated worker
thread; another host may register its own adapter for paths it owns. Default
branch resolution happens inside that host's worker. Local-only ignored-file
propagation is disabled for non-local adapters.

The create transaction is linear and all-or-cleanup:

1. Resolve the source Git root and the selected source subdirectory suffix.
2. Allocate `<worktrees root>/<first four UUID characters>/<repository name>`,
   retrying bounded collisions. Publish both Git and workspace roots before
   `git worktree add`, so cancel can clean every partial state.
3. Resolve the selected local branch/ref, full remote ref, or working-tree base.
   A missing local tracking branch for a selected remote ref is created with
   its upstream and rolled back if the transaction fails.
4. For working-tree starts, capture the complete tracked/staged/binary patch and
   enumerate untracked files. Capture failure is fatal; it never degrades to a
   clean worktree.
5. Run `git worktree add --detach`, apply the tracked patch, and copy untracked
   regular files with bounded concurrency, root-containment checks, symlink
   rejection, exclusive creation, and abort checks.
6. For local hosts, propagate eligible ignored files selected by
   `.worktreeinclude` and repository instruction overrides such as
   `AGENTS.override.md`, preserving the same containment and symlink defenses.
7. On any create error, abort, incomplete copy, or callback error, remove the
   registered Git worktree, token directory, and any transaction-created local
   branch. Cleanup failure is reported separately and does not hide the primary
   error.

The worktree folder's first four characters are intentionally short for compact
paths; collision retry, not silent reuse, supplies uniqueness.

## Environment setup transaction

When an Environment is selected, the worker publishes `setup-started` after Git
creation, reads the selected config from the source repository, and runs its
setup script with the worktree Git root as cwd. The script receives the host's
base shell environment plus `CODEX_SOURCE_TREE_PATH` and
`CODEX_WORKTREE_PATH`. Stdout and stderr stream into the setup output tail.

Successful shell environment changes are stored in the worktree Git metadata
for later Thread launches. Persistence failure is nonfatal because it must not
discard a successfully created and set-up worktree. Setup script or config
failure retains the worktree for Retry, Continue anyway, Edit environment, or
Auto-fix. Cancellation sends termination to the complete detached process
group, escalates to a kill signal after a short grace period, then removes the
partial worktree. Descendant setup processes must not survive cancellation.

## Conversation handoff and synthetic activity

When a new Chat's worktree becomes ready, Main rewrites the primary cwd and the
matching primary workspace root to the new workspace root, preserves all other
Project roots, and rewrites `projectAssignment.cwd` consistently. It calls
app-server `thread/start`, binds the returned Thread to the already reserved
Project Session, and only then releases the deferred `thread/started`
notification. Generic sidebar materialization must reuse that committed owner;
it must not allocate a replacement Session. Main then establishes the
client-to-Thread mapping, inserts the client-only worktree initialization item
into the pre-first-turn canonical snapshot, and calls the first `turn/start`
with the original input.

This ordering makes the finished Chat begin with worktree initialization
activity followed by the user's prompt. The synthetic item is an app-side
canonical item; it is never added to the generated app-server `ThreadItem`
union, never sent as protocol history, and is filtered from accepted server
items.

Forking uses app-server `thread/fork` from the latest or selected source Turn,
rewrites cwd and roots the same way, and appends worktree initialization as its
own completed synthetic Turn. New-start and fork therefore share visible
activity but preserve their different history semantics. Owner metadata,
Project/Session links, title, goal, pin, and heartbeat work happen after the
Thread identity is known; metadata failures are logged and do not turn a
successfully started Chat back into a failed worktree.

Main persists only the resulting Session/Thread/worktree metadata in Core. The
pending collection and its streamed output are Main-memory runtime state. A
renderer reload can recover them from Main; this contract does not promise
recovery across a complete Main-process restart.

## Activity presentation and accessibility

Worktree initialization uses one ordered activity list with these exact labels:
`Creating a worktree`, `Worktree created`, `Failed to create worktree`,
`Setting up the environment`, `Environment set up`, `Environment setup
skipped`, `Failed to set up the environment`, `Starting the conversation`, and
`Failed to start the conversation`.

Each worktree or setup activity is an authored disclosure row with the shared
status icon, summary, chevron, optional plain shell output, and optional action
footer. The running conversation activity is a shimmer row rather than a
disclosure. The last actionable activity starts expanded. A running disclosure
starts expanded but respects a manual collapse; completed rows keep their own
manual state. Disclosure bodies remain mounted and switch `aria-hidden`,
`inert`, pointer events, overflow, measured height, and opacity together.

The shared height transition is 0.3 seconds with easing
`[0.19, 1, 0.22, 1]`; the chevron uses the shared relaxed transform token.
Plain shell output is capped at 9rem, scrolls in both axes when necessary,
keeps its action footer outside the clipped body, and provides a hover/focus
Copy output action. Shimmer animation is suppressed by the global reduced-motion
media rule; no worktree-only reduced-motion behavior is invented.

The implementation owners are:

- `src/renderer/features/local-conversation/view/shared/new-chat-start-in-selector.tsx`
- `src/renderer/features/local-conversation/view/shared/worktree-starting-state-popover.tsx`
- `src/renderer/features/local-conversation/view/shared/environment-selector-popover.tsx`
- `src/renderer/components/workbench/pending-worktree-route.tsx`
- `src/renderer/features/local-conversation/view/shared/tools/worktree-init-activity-list.tsx`
- `src/renderer/features/local-conversation/view/shared/tools/tool-primitives.tsx`
- `src/renderer/features/local-conversation/view/shared/tools/thread-command-shell-block.tsx`

Focused Storybook stories cover open Composer menus, every starting-state and
Environment state, queued/creating/setup/failure/continue/conversation states,
completed initialization, light and dark themes, narrow/default/wide layouts,
and reduced motion. Behavioral tests own roles, keyboard/focus behavior, action
visibility and order, state transitions, payloads, and Git effects; they do not
duplicate token-class strings.

## Non-goals and boundaries

- The renderer cannot invoke raw create/remove worktree worker operations.
- The generated app-server protocol does not gain a `worktreeInit` item.
- Worktree Settings, onboarding, and long-term cleanup are separate features
  except where they call the shared transaction.
- A remote-host option is advertised only when a real host adapter and its
  repository/environment catalog are registered. Nodex never treats a remote
  path as a local filesystem path.
- Complete Main restart recovery is not implied by renderer reload recovery.
