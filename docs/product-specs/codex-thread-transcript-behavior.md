# Codex Thread Transcript Behavior

## Intent
This document is the source of truth for visible Codex Threads transcript behavior in Nodex.
It defines what appears in chat, what stays internal, how transcript state is projected, and how live and restarted threads stay consistent.

Other product specs should link here instead of restating transcript behavior.

## Scope
This spec covers:
- canonical transcript projection and entry ordering
- optimistic prompt behavior
- visible item kinds and transcript rendering rules
- turn bucketing and composer-shell request rules
- transcript-only UI behaviors such as request-user-input rows, plan follow-up prompts, exploration coalescing, searchable content units, and agent-body collapse
- persistence and restart recovery rules
- internal bootstrap/context visibility rules

This spec does not cover:
- general workbench shell layout
- thread auth/account flows
- worktree creation and environment setup
- approval policy configuration outside its visible transcript effects

## Canonical Model
- The visible transcript is one canonical ordered array of `CodexTranscriptEntry` values owned by the main process.
- Renderer surfaces consume `thread.transcript` as-is and do not reconstruct chat rows from raw runtime payloads or sort rows independently by timestamp.
- Renderer derives turn-scoped view models from that canonical transcript (`thread detail -> turn buckets -> render blocks`), but transcript merge/reconciliation stays outside the JSX layer.
- Fresh thread creation, optimistic prompt submit, live runtime updates, resume, and restart recovery must all feed the same projection rules and produce the same visible transcript shape.
- Runtime item normalization is an internal parse layer only. It may help extract tool metadata or streaming content, but it is not the renderer-facing transcript contract.

## Visibility Rules
- Only actual conversation and visible tool/reasoning state belongs in the transcript.
- Internal bootstrap/context content such as `AGENTS.md`, developer instructions, and other session setup wrappers is not part of the visible transcript.
- Raw rollout `response_item.message` rows are not themselves visible transcript truth.
- Restart must not reveal transcript rows that were hidden in the live session.

## Ordering and Identity
- Transcript order is owned by the projection layer, not inferred ad hoc in the renderer.
- Projection assigns one canonical sequence order for visible entries.
- Optimistic user prompts and later authoritative user-message entries must deduplicate into one visible row instead of rendering twice.
- Transcript identity and duplicate reconciliation operate at the transcript-entry layer, not by mixing raw rollout ids directly into renderer state.

## Transcript Entry Kinds
The visible transcript can contain these projected kinds:
- `userMessage`
- `assistantMessage`
- `reasoning`
- `plan`
- `userInputRequest`
- `commandExecution`
- `fileChange`
- `toolCall`
- `systemEvent`

Not every runtime payload becomes a transcript row. Only entries explicitly projected into these visible kinds render in chat.

## Prompt and Turn Behavior
- Sending from `New thread` creates the thread and switches focus to the newly created thread tab.
- As soon as a turn starts, the transcript shows the submitted user prompt optimistically and keeps that bubble visible above the pending turn-body `Thinking` state until live response items arrive.
- When the live user-message item later arrives, it is deduped instead of rendering twice.
- Follow-up prompts sent to an already-running turn do not insert an optimistic transcript bubble on submit. They remain in the pending-steer lane above the composer until the authoritative user-message item arrives from the host manager, and only that authoritative item becomes a transcript row.
- While a turn is already running, composer submit mode resolves exactly like Codex Electron: empty draft keeps `Stop`, non-empty draft submits as `Steer` or `Queue` based on the queue-follow-ups preference, and the alternate shortcut temporarily inverts that mode for one submit.
- `Queue` does not start a turn immediately. It appends a queued follow-up entry above the composer, then the manager-owned drain loop tries to submit that entry through the same non-interrupting follow-up path Codex Electron uses. If a queued entry is sent manually or drained successfully, it disappears from the queued list and any accepted steer shows up in the pending-steer lane until the authoritative user-message item arrives.
- If a turn is active and no visible response item has arrived yet, the transcript may show a pending `Thinking` placeholder at the bottom of that turn.

## Request User Input
- `item/tool/requestUserInput` always requires explicit user input in UI.
- While unanswered, `request_user_input` does not render inline in the scroll body. It appears in the composer shell above the input editor.
- After resolution, answered `request_user_input` remains visible as a compact `Asked N question(s)` disclosure row.
- That answered row stays collapsed by default and expands to reveal the question/answer pairs.
- Multi-question `request_user_input` cards preserve keyboard continuity: using `Left` / `Right` moves focus to the next question’s equivalent answer control, `ArrowDown` from the last preset option can enter the free-form row, and `ArrowUp` from the start of that free-form field returns to the preset options.
- `serverRequest/resolved` clears stale pending approval and user-input queue entries by request id.

## Plan Mode Follow-Up
- `item/plan/delta` streams incremental plan content; both `text` and `markdownText` stay in sync during reducer updates for markdown-first rendering.
- When a completed turn’s latest visible plan item is non-empty, the composer swaps into an `Implement this plan?` request surface.
- That surface offers `Yes, implement this plan` and `No, and tell Codex what to do differently`.
- Accepting the plan sends a follow-up prompt prefixed with `PLEASE IMPLEMENT THIS PLAN:` and resets collaboration mode to `Default` for that follow-up turn.

## Turn Rendering
- The renderer groups transcript entries by `turnId`, projects a flat renderer-item stream, bucketizes that stream, and then renders each turn in fixed block order:
  - `modelChanged`
  - `userMessage`
  - selected `modelRerouted`
  - activity blocks (`reasoning`, `commandExecution`, `patch`, `turnDiff`, `mcpToolCall`, `webSearch`, `multiAgentAction`, plus derived exploration groups)
  - `systemEvent`
  - `assistantMessage`
  - post-assistant artifacts such as answered `userInputRequest`
  - inline `mcpServerElicitation`
  - `proposedPlan`
  - turn-body `Thinking` placeholder when the in-progress placeholder state resolves to `thinking`
  - completed inline `turn diff`
  - trailing status markers (`remoteTaskCreated`, `personalityChanged`, `forkedFromConversation`)
- If the active turn has no blocking pending request, the turn may append a `Thinking` placeholder after the proposed-plan block and before any completed inline diff.
- Exploration groups take precedence over that placeholder, incomplete proposed plans suppress it, `workedFor` suppresses it, and unresolved approval / request-user-input / MCP elicitation state suppresses it.
- Incomplete MCP elicitation blocks the same in-progress surfaces as approval and request-user-input state.
- Unknown replay/app-server tool payloads do not render a generic transcript tool row. The mounted transcript only renders the Codex Electron tool families with dedicated surfaces (`exec`, `patch`, `mcpToolCall`, `webSearch`, `turnDiff`) and keeps any remaining raw tool metadata internal to the canonical conversation state.

## Collapse and Search
- Agent-body collapse applies only to the activity section of older completed turns with renderable agent work. It does not hide the turn's user message or final assistant answer.
- The newest completed turn does not render an agent-body collapse toggle unless that turn already has an explicit persisted collapse state. Older completed turns with renderable agent work default to collapsed.
- In-progress, interrupted, and failed turns do not render the agent-body collapse toggle.
- Search is modeled as explicit content units, not generic DOM scraping.
- Only user-message and assistant-message content participates in `Find in thread` searchable units.
- `Find in thread` stays hidden until explicitly requested, normally through `⌘/Ctrl+F` while the Threads stage is focused.
- Searchable units use stable keys scoped to the turn, drive match highlighting on the owning user or assistant block, and let search results target collapsed or virtualized turns through `scrollToTurn(..., { expand: true })`.

## Message Rendering
- Assistant, plan, and reasoning content render through Streamdown with official code, Mermaid, math, and CJK plugins.
- Transcript markdown rendering remains streaming-safe for in-progress turns.
- Active-thread streaming updates are manager-driven: assistant text, plan text, reasoning text, and command output flush into the canonical conversation incrementally during the turn instead of waiting for turn completion to reveal large chunks.
- Absolute local file links in transcript markdown open in the configured desktop app, and hovering those links shows the full resolved local path plus line/column when present.
- Reasoning rows follow Codex Electron's summary-first projection: only the reasoning `summary` is rendered into the transcript item, empty summaries produce no reasoning row, and raw `content` remains non-transcript state.
- Consecutive replay reasoning records in the same turn are coalesced into one visible reasoning row instead of materializing one `Thought` block per raw reasoning event line.
- Reasoning items stay visible while in progress and remain visible after completion; the turn-bottom `Thinking` placeholder is a separate turn-body state, not a reasoning row.
- User transcript bubbles expose hover/focus message actions under the bubble: `Copy message` and a mock-only `Edit message` control.
- `Edit message` and `Fork from here` only attach to the turn's leading contiguous `userMessage` prefix. Later steer or follow-up `userMessage` items in the same turn do not get those actions, because turn-level rollback and fork targets are owned by that leading user prefix only.
- Assistant copy only appears on the turn's bucketized final-assistant lane. Earlier assistant commentary rows, agent-body assistant rows, or settled assistant rows displaced by later follow-up items do not get transcript message actions. Running turns expose no assistant transcript message actions until that final-assistant lane settles with non-empty content.

## Tool and Activity Rendering
- Tool activity renders as structured expandable cards instead of plain text dumps.
- Specialized cards exist for command execution, file changes, MCP, and web search.
- Automatic approval review items render as a dedicated compact status row with Codex Electron's title, status chip, optional risk label, and an expandable rationale/fallback summary.
- Multi-agent action items render as a dedicated grouped activity surface instead of falling back to generic system banners. Running actions stay expanded, settled contiguous actions can coalesce into one grouped surface, and `wait`-only collab tool calls stay out of the mounted transcript.
- Context compaction renders as Codex Electron's dedicated compact divider row instead of a generic system banner:
  - in progress: `Automatically compacting context` with `loading-shimmer-pure-text`
  - completed: `Context automatically compacted` with the compact completion icon
- Session-backed reopen/bootstrap preserves the same context-compaction rows, including compaction boundaries that split replayed history across pre-compaction and post-compaction turns.
  - the row stays in the post-assistant transcript lane rather than the grouped agent-body lane
- Codex-parity transcript expanders use Motion and subtype-owned state, not a generic shared accordion:
  - measured transcript bodies (`commandExecution`, exploration groups, `patch`, MCP, reasoning, completed request-user-input answers, plan/todo disclosure, and other Codex-native expandable rows) animate through explicit `motion.div` height/opacity wrappers fed by a `ResizeObserver`-driven measured-height hook
  - agent-body collapse is a separate presence animation contract and does not reuse the measured-height transcript-body model
- `fileChange` and turn-level unified diff are separate surfaces, matching Codex Electron exactly:
  - raw `fileChange` items always stay visible as `patch` tool rows (`Edited …`)
  - turn-level aggregated `turn.diff` renders as a separate `turn-diff` surface
  - active in-progress turn diffs surface as a compact above-composer `files changed` banner instead of a generic inline diff viewer
  - the above-composer diff banner is caller-owned `in progress` UI, not an item-status heuristic: it renders as the summary-only `Review changes` banner with no embedded per-file rows
  - completed turn diffs render as a dedicated files-changed card with per-file collapsed embedded diff rows
  - the unified diff card is never allowed to replace or swallow the underlying `Edited file` tool row
  - patch rows expand inline to reveal their own unified diff frame instead of delegating expansion to the separate turn-level diff card
  - patch headers split the status label and filename into separate elements; the filename is clickable and opens the local file target without toggling the row
- Tool-call expansion is subtype-owned local UI state; the mounted thread persists collapsed turns, not collapsed tool rows.
- Tool-call header labels use a scan-friendly two-tone hierarchy where the leading action phrase is visually emphasized over trailing detail text.
- Command execution cards consume parsed `commandActions` metadata (`read`, `listFiles`, `search`) to show exploration summaries and per-action transcript rows.
- Consecutive exploration-only command execution items in the same turn are coalesced into one transcript card before render.
- In Electron-style mounted threads, non-exploration command cards use a local `collapsed | preview | expanded` state machine owned by the command card itself.
- The global thread-detail setting controls command-card visibility and the settled default state:
  - `STEPS_PROSE` suppresses command execution cards entirely
  - `STEPS_COMMANDS` shows command cards but keeps settled rows collapsed by default
  - `STEPS_EXECUTION` shows command cards and lets settled rows start expanded by default
- Running command rows start collapsed, auto-expand after a short delay, and when they settle from an expanded state they briefly enter `preview` before collapsing again.
- While the current turn is still active, the trailing coalesced exploration section remains visually `in progress` (`Exploring` shimmer) until a non-exploration item appears in that same turn or the turn stops.
- Exploration groups keep one measured body and switch between `preview`, `expanded`, and `collapsed`; the preview state reveals the same measured content under a shorter height cap instead of mounting a separate preview tree.
- Proposed-plan cards animate the body height directly between the collapsed cap and the full markdown body, while the collapsed gradient/`Expand plan` overlay remains part of the same animated card.
- Exploration sections are expanded by default only while they are `in progress`; once exploration settles, they collapse by default.
- Running-thread activity uses verb-led summaries: contiguous exploration actions coalesce into `Exploring` / `Explored` groups, generic commands render as `Running …` while active and `Ran …` once settled, and MCP calls render as `Calling …` / `Called …`.
- Command execution headers show `in <cwd>` only when the command ran outside the active project workspace path.
- Patch rows own their expand/collapse state per file row. MCP tool calls own a local completed-only toggle. Neither surface uses a conversation-level collapsed-tool map.
- Patch-row expansion uses a per-file Motion-based measured-height animation model. Expanded rows keep their body height on continuously measured pixel values instead of switching back to `height: auto`, so inline diff expansion does not hand layout authority back to the scroll container mid-transition.

## Composer Shell
- The composer shell is owned outside the transcript scroll container and sits above the input editor.
- It owns queued follow-ups, pending steers, background terminal rows, background child-agent rows, and unresolved live request cards.
- Background terminal rows and queued/pending-follow-up rows remain visible as stacked shell sections above the request/editor branch.
- Background child-agent rows are shown only when the shell is not in approval mode.
- When a background child approval exists, its request card renders before the active-thread request card.
- Background child approvals do not add a separate worker-name header above the card; when the approval prompt needs an actor, that child identity is injected inline into the approval prompt itself.
- While request cards are present, the normal freeform composer editor is hidden.
- Request cards use one Codex-style dispatcher family:
  - `approval` uses the ask-for-permission shell with inline command/network/patch preview, option rows, freeform decline guidance, `Skip`, and `Submit`
  - `userInput` and `implementPlan` use the same shared questionnaire shell with `Dismiss` and keyboard-first multi-question navigation
  - `mcpServerElicitation` uses the dedicated MCP approval card family instead of the questionnaire shell
- Live `approval`, unanswered `userInput`, synthesized `implementPlan`, and live MCP elicitation requests do not render inline in the transcript scroll area.

## Persistence and Recovery
- Snapshot requests only rebroadcast that current manager-owned canonical conversation; they do not invoke `thread/read` or `thread/resume`.
- Reopened completed threads resume through the manager-owned canonical conversation only; they do not bootstrap from persisted session history, reread the thread, or re-merge transcript history during reconnect.
- Explicit active-thread resume does not run `thread/read`; it reconnects in place from the canonical manager conversation, matching Codex Electron's host-manager path.
- Restart recovery depends on the host manager's canonical conversation state and explicit resume path, not on a renderer-side replay/bootstrap layer.
- Live and restarted threads must show the same visible conversation history for the same underlying session state.

## Non-Goals
- Nodex does not expose internal bootstrap/session context as a developer-visible transcript row in this release.
- Nodex does not treat raw rollout storage as a direct UI contract.
- Browser/HTTP transport does not support `codex:*` methods in this release.
