# Codex Thread Transcript Behavior

## Intent
This document is the source of truth for visible Codex Threads transcript behavior in Nodex.
It defines what appears in chat, what stays internal, how transcript state is projected, and how live and restarted threads stay consistent.

Other product specs should link here instead of restating transcript behavior.
Detailed Auto-review preset and approval-lifecycle rules are specified in [Auto-review Behavior](./auto-review-behavior.md).

## Scope
This spec covers:
- canonical transcript projection and entry ordering
- optimistic prompt behavior
- visible item kinds and transcript rendering rules
- turn bucketing and composer-shell request rules
- transcript-only UI behaviors such as request-user-input rows, plan follow-up prompts, exploration coalescing, searchable content units, and agent-body collapse
- Codex-style tool-call grouping for pending MCP calls, dynamic app-server tools, and collapsed historical activity
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
- The detailed turn-level classifier, conditional assistant-promotion rule, and post-classification lane order are specified in [../codex-thread-turn-ordering-and-assistant-promotion.md](../codex-thread-turn-ordering-and-assistant-promotion.md).

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
MCP and dynamic app-server tool calls are specialized `toolCall` rows with canonical renderer state: MCP rows preserve plugin ids, app resource URIs, result metadata, and normalized resource content; dynamic rows preserve namespace/tool/arguments/status/output content for tools such as `read_thread`.

## Prompt and Turn Behavior
- Sending from a new-chat composer creates a session-owned thread; editor/card send-to-chat flows keep focus in the originating surface.
- As soon as a turn starts, the transcript shows the submitted user prompt optimistically and keeps that bubble visible above the pending turn-body `Thinking` state until live response items arrive.
- When the live user-message item later arrives, it is deduped instead of rendering twice.
- Follow-up prompts steered into an already-running turn insert an optimistic `steeringUserMessage` transcript bubble labeled `Steering conversation`. When the matching authoritative backend `userMessage` arrives for the same target turn and equivalent input, that bubble becomes `Steered conversation` and the runtime appends a separate `steered` divider row, also labeled `Steered conversation`.
- While a turn is already running, composer submit mode resolves from the draft and queue preference: empty draft keeps `Stop`, non-empty draft submits as `Steer` or `Queue` based on the queue-follow-ups preference, and the alternate shortcut temporarily inverts that mode for one submit.
- `Queue` does not start a turn immediately. It appends a queued follow-up entry above the composer, then the manager-owned drain loop tries to submit that entry through the same non-interrupting follow-up path. If a queued entry is sent manually or drained successfully, it disappears from the queued list and any unaccepted steer is restored to that queue if the active turn ends before acceptance.
- Dictation is a separate Electron-only composer path, not realtime voice. In ChatGPT-authenticated Electron sessions, the footer shows a `Dictate` mic button with tooltip `Click to dictate or hold` and shortcut label `Ctrl+M`; click starts buffered `MediaRecorder` capture, `Ctrl+M` keydown starts and keyup stops with `insert`, recordings shorter than `250ms` are discarded locally, and the active dictation footer preserves the two stop modes: `insert` and `send` before one `/transcribe` POST appends or submits the returned text.
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
  - leading `hook` items that appear before the first user message
  - `userMessage`
  - selected `modelRerouted`
  - activity blocks (`reasoning`, `commandExecution`, `patch`, `mcpToolCall`, `dynamicToolCall`, `webSearch`, `multiAgentAction`, inline `hook`, completed `mcpServerElicitation`, completed `userInputResponse`, `contextCompaction`, plus derived exploration groups)
  - `systemEvent`
  - `assistantMessage`
  - post-assistant artifacts such as trailing `hook` items and trailing automatic approval review
  - inline incomplete `mcpServerElicitation`
  - `proposedPlan`
  - turn-body `Thinking` placeholder when the in-progress placeholder state resolves to `thinking`
  - completed inline `turn diff`
  - trailing status markers (`remoteTaskCreated`, `personalityChanged`, `forkedFromConversation`)
- If the active turn has no blocking pending request, the turn may append a `Thinking` placeholder after the proposed-plan block and before any completed inline diff.
- Exploration groups take precedence over that placeholder, incomplete proposed plans suppress it, `workedFor` suppresses it, and unresolved approval / request-user-input / MCP elicitation state suppresses it.
- The first visible work-like item in a turn stamps `firstTurnWorkItemStartedAtMs` at the main-process summary layer. `item/started`, `item/completed`, and live patch updates can set it, but later events must not overwrite an existing value.
- Active running turns with `firstTurnWorkItemStartedAtMs` project a first-class `workedFor` block before the first non-user item. That visible block renders as a plain `Working` label for sub-second elapsed time, then `Working for Xm Ys`, followed by a `border-current/20` divider. It is not a button and has no hover background or chevron.
- Completed turns with first-work timing project the same internal block before the final assistant boundary, but completed collapsible agent bodies consume it as collapse-label input and remove it from visible expanded body rows.
- Incomplete MCP elicitation blocks the same in-progress surfaces as approval and request-user-input state.
- Unknown replay/app-server tool payloads do not render a generic transcript tool row. The mounted transcript only renders supported tool families with dedicated surfaces (`exec`, `patch`, `mcpToolCall`, `dynamicToolCall`, `webSearch`, `turnDiff`) and keeps any remaining raw tool metadata internal to the canonical conversation state.

## Collapse and Search
- Agent-body collapse applies only to the activity section of older completed turns with renderable agent work. It does not hide the turn's user message or final assistant answer.
- The newest completed turn does not render an agent-body collapse toggle unless that turn already has an explicit persisted collapse state. Older completed turns with renderable agent work default to collapsed.
- In-progress, interrupted, and failed turns do not render the agent-body collapse toggle.
- Collapsed historical agent-work labels resolve in this order: explicit completed worked-for timing, completed turn `durationMs`, then `X previous messages`.
- The completed historical `Worked for ...` row uses a full-width left-aligned toggle button with no hover highlight, nested muted label spans, `aria-expanded`, a rotating `icon-2xs` chevron, and a separate `border-token-border-light` divider row. It is intentionally different from the active running divider, which is non-interactive.
- Search is modeled as explicit content units, not generic DOM scraping.
- Only user-message and assistant-message content participates in `Find in thread` searchable units.
- `Find in thread` stays hidden until explicitly requested, normally through `⌘/Ctrl+F` while the Threads stage is focused.
- Searchable units use stable keys scoped to the turn, drive match highlighting on the owning user or assistant block, and let search results target collapsed or virtualized turns through `scrollToTurn(..., { expand: true })`.

## Message Rendering
- Assistant, plan, and reasoning content render through Streamdown with official code, Mermaid, math, and CJK plugins.
- Streamdown fenced code blocks in thread markdown use the same resting visual surface as the BlockNote-backed NFM editor code block: one subdued `--code-block-bg` surface, no nested Streamdown header/body card, no line numbers, and a hover/focus copy action only.
- Thread fenced code copy preserves the original source line breaks and goes through Nodex's clipboard fallback path so Electron permission/API gaps do not make the Streamdown copy affordance inert.
- Transcript markdown rendering remains streaming-safe for in-progress turns.
- `imageView` transcript items render as assistant markdown content; review-mode markers (`enteredReviewMode`, `exitedReviewMode`) are ignored and do not render transcript rows.
- Active-thread streaming updates are manager-driven: assistant text, plan text, and reasoning text arrive through thread stream patches, while command output arrives as raw host `mcpNotification` deltas. The local-conversation manager coalesces command output for 50 ms, appends it to the matching `commandExecution.aggregatedOutput`, preserves only the latest 20,000 characters with `[output truncated]\n`, and drops deltas whose conversation, turn, or item is not present.
- Absolute local file links in transcript markdown open in the configured desktop app, and hovering those links shows the full resolved local path plus line/column when present.
- Reasoning rows follow summary-first projection: only the reasoning `summary` is rendered into the transcript item, empty summaries produce no reasoning row, and raw `content` remains non-transcript state.
- Consecutive replay reasoning records in the same turn are coalesced into one visible reasoning row instead of materializing one `Thought` block per raw reasoning event line.
- Reasoning items stay visible while in progress and remain visible after completion; the turn-bottom `Thinking` placeholder is a separate turn-body state, not a reasoning row.
- User transcript bubbles expose hover message actions under the bubble in this order: timestamp, `Copy message`, and optional `Edit message`.
- User message action timestamps are formatted as localized short time from the turn-level `turnStartedAtMs` field. Inline/non-primary user messages in a turn render no timestamp node.
- `Edit message` only attaches to the last user message of the latest completed editable turn. Later steer or follow-up `userMessage` items in the same turn do not get user-bubble actions.
- User-sent images and context/file attachments render as a separate right-aligned strip immediately before the owning user bubble. They are derived from non-text `userMessage.content` inputs, not from markdown, so thumbnails are excluded from copy/edit text and from `Find in thread` searchable units. Local images render as 64px cropped thumbnails; remote image pointers render through the same strip slot with 64px contained thumbnails when their file source resolves.
- Assistant transcript actions are owned by the turn's bucketized final-assistant lane and render after assistant prose and assistant-after artifacts in this order: `Copy`, `Good response`, `Bad response`, `Fork from this point`, then timestamp. Earlier assistant commentary rows and running agent-body assistant rows do not get transcript message actions. If a stopped turn keeps the latest assistant inline because later tool activity arrived after it, Nodex uses a renderer-local action-only anchor after the settled agent body so the final tool group stays above the toolbar.
- Assistant message action timestamps are formatted as localized short time from `finalAssistantStartedAtMs`, which is updated from live `agentMessage` event timing and is not treated as the turn completion time. Archived/read fallback data may derive this field from protocol `completedAt` only before live assistant timing exists. If either timestamp field is missing, the timestamp node is omitted.
- Assistant fork targets the owning completed turn. Latest-turn forks execute immediately, while older-turn forks open a confirmation dialog unless the user has opted out. For session-backed threads, forking opens a new project session backed by the forked conversation snapshot and focuses an empty composer in that new session.

## Tool and Activity Rendering
- Tool activity renders as structured expandable cards instead of plain text dumps.
- Specialized cards exist for command execution, file changes, MCP, and web search.
- Tool and action surfaces use the shared local icon asset module:
  - semantic tool glyphs cover command execution, file edits, web/search, code search, list-files, approvals, denials, skills, hooks, plugins, connectors, and generic source fallbacks
  - decorative row glyphs are hidden from assistive technology; website favicons use decorative empty-alt images, while source logos expose meaningful alt text
  - icon rendering is surface-specific, not universal: collapsed activity headers and top-level command/web/MCP surfaces may show glyphs, while nested collapsed-activity body rows often stay text-only
  - visible activity glyphs use the documented `icon-xs` muted contract, chevrons use `icon-2xs`, and source/card glyphs use `icon-sm`
- Top-level web rows prefer extracted site favicons through the Google favicon URL helper and fall back to the semantic web-search glyph when no stable domain is available. Expanded/detail web rows render the favicon only when a `faviconUrl` exists; they do not add a globe fallback when no site favicon was resolved.
- MCP, plugin, connector, and elicitation rows resolve source logos from available metadata, Browser Use / computer-use source identifiers, connector/plugin logo URLs, then the generic source fallback.
- Connector logos choose light or dark logo URLs from the current theme and fall back to the generic source glyph after an image load error without changing row geometry.
- In-progress MCP rows group into a pending MCP disclosure with `pending-mcp-tool-calls-body`; repeated identical dynamic tool rows group into a dynamic disclosure with `dynamic-tool-call-group-body` and `{count} times` repeat text.
- MCP tool rows resolve app resources from tool metadata, result metadata, and item-level `mcpAppResourceUri`, then render supported `text/html`, `text/html;profile=mcp-app`, and `text/x-dil;profile=mcp-app` resources in a sandboxed inline frame. Renderable app resources also expose a transient right-panel tab using `mcp-app:${mcpAppId}` and `mcp-capability:${threadId}:${server}:${tool}:${callId}` ids; unsupported or failed resources fall back to text, structured JSON, error, or no-content branches.
- The app-server `read_thread` dynamic tool returns `schemaVersion: 1`, thread metadata, newest-first paged turns, and optional truncated outputs as a successful `inputText` JSON result.
- Transient tool labels use Nodex's `CodexShimmerText` wrapper. Active false renders plain text; active true uses the shared `loading-shimmer-pure-text` timing (`2s`, `steps(48,end)`, `-100%` to `250%`, reduced-motion disabled), with cadenced timing kept as an internal optional variant.
- Shimmer placement is source-specific: collapsed activity active labels shimmer only while the latest group is running, completed collapsed summaries stay static, command rows shimmer only the active status phrase, web rows shimmer only the top-level `Searching the web` phrase, MCP rows shimmer only the in-progress label text while logos remain static, and file-change rows do not text-shimmer because live patch motion belongs to the `+N` / `-N` digit wheel.
- Collapsed activity group headers use synthesized activity sentences, never a generic `Completed N actions` fallback. Source-backed segments are ordered as file changes, exploration, approvals/denials, hooks, commands, MCP usage, then web searches; mixed groups render summaries such as `Explored 5 files, 1 search, ran 2 commands, searched web 1 time`.
- Collapsed activity group headers choose their summary icon from the original grouped render units by scanning newest-to-oldest for an active meaningful row, then newest-to-oldest for a completed meaningful row, before falling back to the activity-family priority: web, exploration, edits, commands, approvals, hooks/skills, then the first MCP source logo. That header icon does not imply nested row icons.
- Automatic approval review items render as a dedicated compact status row with the required title, status chip, optional risk label, and an expandable rationale/fallback summary.
- Multi-agent action items render as a dedicated grouped activity surface instead of falling back to generic system banners. Running actions stay expanded, settled contiguous actions can coalesce into one grouped surface, and `wait`-only collab tool calls stay out of the mounted transcript.
- Context compaction renders as a dedicated compact divider row instead of a generic system banner:
  - in progress: `Automatically compacting context` with Codex shimmer text
  - completed: `Context automatically compacted` with the compact completion icon
- Session-backed reopen/bootstrap preserves the same context-compaction rows, including compaction boundaries that split replayed history across pre-compaction and post-compaction turns.
  - the row stays in the post-assistant transcript lane rather than the grouped agent-body lane
- Poor-network retry errors render inside the mounted transcript as inline error rows instead of replacing the whole thread shell:
  - retryable transport errors materialize as `streamError` rows, for example `Reconnecting... 2/5`
  - non-retryable turn errors materialize as `systemError` rows
  - both rows may carry expandable `additionalDetails`
  - this feature is distinct from explicit thread reopen/resume; `resumeState` does not own the poor-network reconnect row
- Transcript expanders use Motion and subtype-owned state, not a generic shared accordion:
  - measured transcript bodies (`commandExecution`, exploration groups, `patch`, MCP, reasoning, completed request-user-input answers, plan/todo disclosure, and other transcript expandable rows) animate through explicit `motion.div` height/opacity wrappers fed by a `ResizeObserver`-driven measured-height hook
  - agent-body collapse is a separate presence animation contract and does not reuse the measured-height transcript-body model
- `fileChange` and turn-level unified diff are separate surfaces:
  - raw `fileChange` items always stay visible as `patch` tool rows (`Edited …`)
  - Nodex starts and resumes Codex app-server threads with `features.apply_patch_streaming_events=true`; without that server-side feature, app-server withholds the drafting-time `item/fileChange/patchUpdated` notifications and only the final completed file-change row can render
  - live `item/fileChange/patchUpdated` notifications own the canonical in-progress patch state; they create or update the in-progress `fileChange` row, may rebind the latest active turn to the notification `turnId`, and can render as a single-entry collapsed activity group while the model is drafting the edit
  - the live file-edit process row is source-backed as `response.custom_tool_call_input.delta` -> app-server patch parser -> `item/fileChange/patchUpdated`, not as a renderer-only animation layered over the completed row
  - `item/fileChange/outputDelta` burst bytes are deprecated diagnostic output for this surface and do not create or update visible transcript state
  - live `turn/diff/updated` notifications update `turn.diff` for turn-level diff surfaces only; they do not fabricate `fileChange` rows
  - completed turn-level aggregated `turn.diff` renders as final-assistant after-content when a final assistant exists, so the edited-files card appears before the assistant action strip inside the final assistant DOM
  - completed patch/file-change items synthesize the separate `turn-diff` payload from patch batches before falling back to a turn-level `diff`
  - active in-progress turn diffs may surface through the static above-composer portal (`data-above-composer-portal`) as a compact `files changed` banner only when no live file-change row already represents that draft edit
  - the above-composer diff banner is active-turn-owned `in progress` fixed content, not an item-status heuristic: it renders as the summary-only `Review changes` banner with no embedded per-file rows
  - completed turn diffs render as a dedicated `Edited …` card with per-file collapsed embedded diff rows
  - the unified diff card is never allowed to replace or swallow the underlying `Edited file` tool row
  - patch rows expand inline to reveal their own unified diff frame instead of delegating expansion to the separate turn-level diff card
  - live patch labels, live collapsed activity patch headers, and in-progress turn-diff banners animate `+N` / `-N` through the CSS digit-wheel contract, while accordion body expansion still uses Motion measured-height transitions
  - inline diff previews render the real `@pierre/diffs` `diffs-container` host directly, not a nested wrapper, and rely on the diff library's native line highlighting/indicators instead of adding a second left-side gutter overlay
  - patch headers split the status label and filename into separate elements; the filename is clickable and opens the local file target without toggling the row
  - embedded per-file patch previews suppress the diff library's built-in file header because the surrounding thread row already owns the filename and line-count summary
- Contiguous activity units can coalesce into a `collapsedToolActivity` group after bucketization only when a source-backed summary can be synthesized. A single in-progress file-change item may also become a collapsed activity group so the live `Creating/Editing/Deleting path +N -N` patch header stays subtype-owned.
- Expanded collapsed-activity bodies are flat: exploration groups render direct text-only `Read`, `Searched`, and `Listed files` rows through their body-only path, web-search rows render direct detail rows with a favicon only when one was resolved, file-change rows render `Edited`/`Created`/`Deleted` with filename/stats/chevron but no pencil glyph, and nested command rows render muted without the leading command icon. They do not mount nested `Explored...` or `Searched web...` subgroup headers.
- Tool-call expansion is subtype-owned local UI state; the mounted thread persists collapsed turns, not collapsed tool rows.
- Tool-call header labels use a scan-friendly two-tone hierarchy where the leading action phrase is visually emphasized over trailing detail text.
- Command execution cards consume parsed `commandActions` metadata (`read`, `listFiles`, `search`) to show exploration summaries and per-action transcript rows.
- Consecutive exploration-only command execution items in the same turn are coalesced into one transcript card before render.
- In mounted threads, non-exploration command cards use a local `collapsed | preview | expanded` state machine owned by the command card itself.
- The global thread-detail setting controls command-card visibility and the settled default state:
  - `STEPS_PROSE` suppresses command execution cards entirely
  - `STEPS_COMMANDS` shows command cards but keeps settled rows collapsed by default
  - `STEPS_EXECUTION` shows command cards and lets settled rows start expanded by default
- Running command rows start collapsed, auto-expand after a short delay, and when they settle from an expanded state they briefly enter `preview` before collapsing again.
- Expanded command shell rows render a `Shell` chrome with the command line, copy-command/output controls, and a reversed scroll output area capped at 140px. Blank running output stays empty; blank settled output reads `No output`. The footer is blank while running, then reads `Stopped`, `Success`, `Exit code {code}`, or `Exit code unknown` from canonical command status and exit-code fields.
- While the current turn is still active, the trailing coalesced exploration section remains visually `in progress` (`Exploring` shimmer) until a non-exploration item appears in that same turn or the turn stops.
- Exploration groups keep one measured body and switch between `preview`, `expanded`, and `collapsed`; the preview state reveals the same measured content under a shorter height cap instead of mounting a separate preview tree.
- Proposed-plan cards animate the body height directly between the collapsed cap and the full markdown body, while the collapsed gradient/`Expand plan` overlay remains part of the same animated card.
- Exploration sections are expanded by default only while they are `in progress`; once exploration settles, they collapse by default.
- Running-thread activity uses verb-led summaries: contiguous exploration actions coalesce into `Exploring` / `Explored` groups, generic commands render as `Running …` while active and `Ran …` once settled, and MCP calls render as `Calling …` / `Called …`.
- Command execution headers show `in <cwd>` only when the command ran outside the active project workspace path.
- Patch rows own their expand/collapse state per file row. MCP tool calls own a local completed-only toggle. Neither surface uses a conversation-level collapsed-tool map.
- MCP tool-call rows follow the normalized-result contract instead of renderer-local raw fallbacks:
  - the primary expanded branch order is `success.content.length > 0` -> protocol error -> `Tool returned no content`
  - `structuredContent` is append-only and never replaces the primary branch
  - structured-only success still shows `Tool returned no content` before the JSON panel
  - malformed MCP content blocks render as visible JSON fallback blocks instead of disappearing
  - the raw-output dialog remains a separate expanded-only debug view
  - in-progress rows stay collapsed and same-server incomplete MCP elicitation suppresses only the matching in-progress MCP row from `agentItems`
- Patch-row expansion uses a per-file Motion-based measured-height animation model. Expanded rows keep their body height on continuously measured pixel values instead of switching back to `height: auto`, so inline diff expansion does not hand layout authority back to the scroll container mid-transition.

## Composer Shell
- The composer shell is owned outside the transcript scroll container and sits above the input editor.
- It owns queued follow-ups, background terminal rows, background child-agent rows, and unresolved live request cards. Pending steering messages belong to the transcript as `steeringUserMessage` items, not to the composer shell.
- Background terminal rows and queued follow-up rows remain visible as stacked shell sections above the request/editor branch.
- Background child-agent rows are shown only when the shell is not in approval mode.
- When a background child approval exists, its request card renders before the active-thread request card.
- Background child approvals do not add a separate worker-name header above the card; when the approval prompt needs an actor, that child identity is injected inline into the approval prompt itself.
- While request cards are present, the normal freeform composer editor is hidden.
- Request cards use one dispatcher family:
  - `approval` uses the ask-for-permission shell with inline command/network/patch preview, option rows, freeform decline guidance, `Skip`, and `Submit`
  - `userInput` and `implementPlan` use the same shared questionnaire shell with `Dismiss` and keyboard-first multi-question navigation
  - `mcpServerElicitation` uses the dedicated MCP approval card family instead of the questionnaire shell
- Live `approval`, unanswered `userInput`, synthesized `implementPlan`, and live MCP elicitation requests do not render inline in the transcript scroll area.

## Persistence and Recovery
- Snapshot requests only rebroadcast that current manager-owned canonical conversation; they do not invoke `thread/read` or `thread/resume`.
- Reopened completed threads resume through the manager-owned canonical conversation only; they do not bootstrap from persisted session history, reread the thread, or re-merge transcript history during reconnect.
- Explicit active-thread resume does not run `thread/read`; it reconnects in place from the canonical manager conversation through the host-manager path.
- Restart recovery depends on the host manager's canonical conversation state and explicit resume path, not on a renderer-side replay/bootstrap layer.
- Live and restarted threads must show the same visible conversation history for the same underlying session state.

## Non-Goals
- Nodex does not expose internal bootstrap/session context as a developer-visible transcript row in this release.
- Nodex does not treat raw rollout storage as a direct UI contract.
- Browser/HTTP transport does not support `codex:*` methods in this release.
