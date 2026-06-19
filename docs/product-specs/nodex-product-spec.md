# Nodex - Product Specification

## Overview

Nodex is a local SQLite-based kanban board designed for managing coding agents (e.g., Claude Code). It runs as an Electron desktop app with a Notion-like UI, and also serves a web interface accessible from any browser. All data is stored in a SQLite database that agents can interact with via REST API. Supports multiple independent projects, each with its own kanban board, history, and undo/redo stacks.

Desktop runtime requirement: macOS 12 Monterey or later. Nodex ships separate notarized Apple silicon (`arm64`) and Intel (`x64`) macOS builds.

## Problem Statement

When working with coding agents like Claude Code, there's no streamlined way to:
1. Visualize and manage task queues across different stages
2. Allow agents to update their own status without complex integrations
3. Track agent progress in real-time
4. Maintain a simple, portable task state

## Goals

1. **Agent-Native**: Agents use REST API to read/write task status
2. **Real-Time Sync**: UI reflects changes instantly via SSE
3. **Human-Friendly**: Notion-like UI for manual task management
4. **Portable**: Single SQLite database file, easy to backup/restore
5. **Local-First**: No external dependencies or cloud services required
6. **Multi-Project**: Independent kanban boards per project

## Non-Goals

- Multi-user collaboration features
- Cloud sync or remote storage
- Mobile-responsive design (desktop-first)
- Complex workflow automation (keep it simple)

---

## Features

### Core Features

#### 1. Multi-Project Support
- Each project has an independent kanban board, history, and undo/redo
- Single-page app with a project/session shell: projects render as folders in the left sidebar, expanded projects show durable sessions, and the active session renders as a thread page with shell-owned right and bottom panels for content tabs
- Every project has a seeded `Overview` session with one open full-width right-panel `db_view` tab for that project's primary DB view; new non-Overview sessions start with the right panel collapsed
- Session panel tabs support `db_view`, `card_stage`, `terminal`, `browser`, `review`, and `files` kinds; Browser renders the Electron browser-sidebar feature with isolated main-owned webview content, a compact navigation toolbar, address commit/skip behavior, local-server discovery cards, full-bleed responsive page hosting, retained page lifetime across tab switches and panel hide/show, panel-motion-aware fixed webview bounds, device toolbar presets, zoom/data clearing, screenshot/comment affordances, and browser-use overlay state. Files renders the primary source tree, search/filter input, file preview area, Codex-style file tab ids, external-open actions, and markdown/text/image/PDF/unsupported preview routing. Review renders the active thread's connected review diff panel, and Side chat actions create renderer-local temporary thread tabs instead of durable `project_session_tabs` rows. Older saved durable Side chat launcher rows are pruned during schema migration, and older `files_placeholder` rows are normalized to `files`.
- Empty panels and each panel-group tab strip use the same target-aware new-tab action registry. Each group's plus button sits immediately after that group's tabs and creates or previews content in that leaf. The Codex-parity chooser order is Review, Terminal, Browser, Files, and Side chat, filtered by target panel and singleton availability. Right-panel choosers then append a separated Nodex-only section for DB View and Card Stage when eligible; those rows open a move-to-style search picker, scoped to DB destinations for DB View and card destinations for Card Stage. Timeline remains hidden until Nodex has a first-class tab kind and eligibility model for it. Review is a singleton tab per session across both right and bottom panels. Browser is multi-tab, remains available when Browser tabs already exist, and supports New tab to the right, Reload, and Duplicate before generic close actions from the tab context menu.
- Files and Browser can open as preview tabs in either right or bottom panel, and single-clicking a Kanban DB-view card opens Card Stage as a right-panel preview in the nearest right leaf. A project session panel leaf owns at most one italic preview at a time; opening a second preview in the same leaf replaces the first, and the preview is ephemeral until the user interacts with the preview body, pins it, or double-clicks its tab label. Card Stage preview promotion reuses the preview tab id so the editor body does not remount. Card Stage close/delete controls do not pin an unpinned preview before closing/deleting. Side chat uses a separate renderer-local leaf-scoped tab lifecycle: the empty-panel action, panel menu, thread overflow action, `/side`, and transcript `Ask in side chat` actions create `sidechat-loading:<parentThreadId>:<index>` tabs, replace them with closable `sidechat:<threadId>` tabs after the temporary fork starts, and never pin or persist those tabs.
- DB view tabs keep the DB view selector pinned above board, list, toggle-list, canvas, and calendar content, with task search and supported view-local filter/sort/display controls inside that tab body
- Card Stage opens as a session-attached tab when opened from durable entry points such as the command palette, thread card links, or the explicit Card Stage picker. Single-clicking a card from a Kanban DB view opens or replaces a renderer-local preview in the active session instead of switching a global Card stage or creating a durable tab; double-clicking the card opens a durable tab immediately. A card tab can remain attached to the active project session while rendering a card from another project; the tab row's project owns the session placement, while the tab config project owns the card, history, and card-requested terminal target. Cross-project card tabs show the content project as a compact prefix before the card title, and tab hover tooltips expose the full title/project context. When the DB tab group has a right-side sibling group, new card previews or tabs open in the nearest group to the right. Focusing an existing durable card tab clears any preview in that leaf, preserves the current right-panel width mode, and missing card/project targets render a clear empty state instead of a blank panel. Durable Card Stage tabs in the mounted panel leaf retain their rich-editor body across panel-tab switches, so the description cursor and editor-local state survive `Cmd/Ctrl+Shift+[` / `Cmd/Ctrl+Shift+]` cycling while the tab remains open.
- In Kanban DB views, cards that are open in selected, visible Card Stage tabs or in the active Card Stage preview in the active session's right or bottom panel render an active ring. Collapsed panels, unselected tabs, and durable card tabs hidden behind a different preview or temporary tab do not mark board cards active.
- Opening DB View or Card Stage from the right-panel action chooser uses the shared move-to-style picker chrome with command-palette-aligned fuzzy/prefix search. DB View results open a selected project DB; Card Stage results open matching cards and can target cards from another project while preserving the active session as the tab owner.
- Terminal opens as a session-attached bottom-panel tab with a session-tab-scoped terminal id and starts in the attached thread cwd when present, otherwise the owning project's primary source, otherwise the PTY process default. Cards can request a terminal, but terminal tabs no longer carry card ownership or card ids.
- Panel action shortcuts are `Ctrl+Shift+G` for Review, `Ctrl+\`` for Terminal, `Cmd/Ctrl+T` for Browser, `Cmd/Ctrl+Shift+E` for Files, and `Alt+Cmd/Ctrl+S` for Side chat. Focused right/bottom panel tab cycling uses `Cmd/Ctrl+Shift+[` for the previous tab and `Cmd/Ctrl+Shift+]` for the next tab in the nearest or last focused split leaf, wrapping within that same group. `Cmd/Ctrl+W` closes the active closable tab in that focused leaf without closing the app window. Panel action shortcuts are ignored while focus is inside editor/input/dialog surfaces; focused panel tab cycling and close-tab still work from NFM editor content in the focused panel group but ignore input fields and dialogs. Plain `Cmd/Ctrl+[` / `Cmd/Ctrl+]` remain app-window Back/Forward.
- The active session can show, collapse, resize, or full-width expand the right panel, and can show/collapse/resize the bottom panel independently. Right, bottom, and split-panel resize drags remain continuous even when Browser webview content is visible under the pointer. The fixed global header exposes `Toggle bottom panel` and `Toggle side panel` buttons, ordered bottom first and side second, and keeps those persistent top-right toggles visible and clickable over regular and full-width right panels. The right panel owns its expand/restore button in the far-right after-list area of its tab header, followed by a measured spacer for the fixed right header slot; the bottom panel owns its close button at the far-right edge of the whole bottom panel. When the right panel is full-width, its tab header visually owns the top row and hides the thread title/header area. If the sidebar is also collapsed, that right-panel tab header starts after the measured left titlebar rail so the left titlebar buttons and right-panel tabs do not overlap. New non-Overview sessions default to collapsed right panels; bottom opens when a terminal tab is created or focused. Overview sessions default to open full-width right panels unless the user has changed that session's panel width.
- Attached root-thread sessions use a floating composer overlay at the bottom of the full-width right panel for `review`, `browser`, `db_view`, and `card_stage` tabs. The overlay preserves the normal follow-up composer behavior, latest-turn preview, queued/background lanes, model/reasoning selector, dictation, stop/send controls, and app-shell bottom-panel offset. Side chats, Terminal, Files, blank new-thread homes, and resuming attached threads do not show the root-thread overlay.
- Right and bottom panels support splitable tab groups. Users can split the selected tab from a multi-tab group into a new neighboring group, drag tabs between leaf tab strips with a live insertion marker, drag tabs near the body edge of a leaf to create a split, and resize split groups with sashes. Header tab rows insert or move tabs into that group; body drops merge into the group center or split from the body edges. Durable tabs are uniquely owned by one leaf; when the last visible tab leaves or closes from a non-final group, that empty group is removed automatically. The final empty group remains as the panel fallback, and collapsed panels restore their split tree when reopened.
- URL sync: `/?project=<id>`, persisted to localStorage
- Selecting a project expands its folder and switches the active DB project context. Selecting a session switches the thread page plus both panel tab groups and clears that session's unread flag.
- Task search query is persisted per project and restored on space switching; search lives inside the active DB view tab toolbar for searchable DB views, while Calendar hides that search chrome
- `Cmd/Ctrl+K` and `Cmd/Ctrl+P` open a global command palette that searches cards across projects by default; typing a `>` prefix switches the palette into command mode for shell actions such as opening settings, task search, project picker, terminal, stage focus, and view switches, and `Cmd/Ctrl+Shift+P` opens that same palette with `>` already prefilled. Card results use fuzzy full-text ranking across title, description, tags, assignee, agent status, column, project name, and card id; card mode also exposes a trailing `Filter` popover plus a compact active-filter row beneath the input, using the same status/priority/tag/project-style pill language as the View-stage toolbar while persisting those filter selections across reopen/reload and still rendering three-line contextual previews for matching description text
- App-window Back/Forward navigation is available from the top-left titlebar controls, `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, desktop mouse Back/Forward buttons, the command palette, and the macOS application menu. It navigates backward/forward through shell-owned durable workbench context: active project, active session, DB view, right/bottom active tabs, right/bottom collapsed state, and right-panel full-width state. Transient overlays such as settings, command palette, task search, and browser-sidebar webview history are not part of this stack.
- The command palette always includes `Back` and `Forward` commands with matching keyboard hints; those commands are shown disabled when there is no history in that direction. Browser-sidebar webview history is separate and does not drive these app-window controls.
- Desktop supports multi-window in a single app process (`Cmd/Ctrl+N`): each window keeps independent navigation/session state while all windows share the same SQLite data and realtime board/session-change fanout
- When Nodex starts, the Settings -> General -> `Restore windows` policy decides whether to restore all retained window sessions, only the last focused session, or one fresh session
- Each restored window resumes its own active project/session/tab, pane state, DB view, open card context, selected thread context, workbench layout, and saved window bounds
- Windows opened while another window is already open start from the requesting window's current layout and then diverge as independent window sessions
- Back/forward navigation history is window-session-local and is restored only from that window's session storage; it is not part of the cold-launch resume snapshot saved when all windows close
- Desktop single-instance behavior is scoped per resolved server profile (`KANBAN_DIR`/`config.toml` dir). Different profile dirs can run at the same time (for example packaged release + dev build), while each profile still enforces one process with many windows.
- Packaged macOS launches from outside `/Applications` show a native prompt to move Nodex into Applications, continue from the current location, or quit before the app runtime starts.
- Project-local session pins, archived state, unread state, durable tab state, right/bottom panel collapse/size/split layout, active leaf, active tab, and derived flat tab ordering are shared project data in SQLite. Renderer state owns ephemeral panel previews, active project, active session, transient focus history, and temporary side-chat tabs. Overview sessions stay first, are non-pinnable and non-archivable, and are excluded from the session row context menu.
- Codex thread metadata lives in `codex_threads`, where `project_id` and `card_id` are nullable. Optional card ownership lives in `codex_thread_card_links`; optional session ownership lives in `project_session_threads`.
- Sidebar rows use compact project folder and session row chrome, including top actions for New chat, Search, Plugins, and Automations. The Search row opens the global command palette in default card-search mode and shows `Cmd/Ctrl+K`; view-local task search remains inside DB view toolbars. Sessions are nested under project folders; pinned sessions sort above unpinned sessions within their project, unread sessions show a left dot, read non-Overview sessions expose a Codex-style trailing `Pin chat` / `Unpin chat` button whose pinned state uses the filled pin glyph, and non-Overview session rows open an Electron-native context menu from right-click or the hover overflow button without selecting the session.
- Active non-Overview session rows open `Rename chat` when the row receives a title-target double-click. The same dialog is reachable from the session context menu, the active thread header actions menu, the command palette command `renameThread`, the macOS application menu item `Rename chat`, and `Cmd/Ctrl+Alt+R`. The dialog uses `Rename chat`, `Keep it short and recognizable`, placeholder `Add a title…`, `Chat title`, `Cancel`, and `Save`; it submits the raw input value. Manual session/thread rename sanitization trims outer whitespace, folds internal whitespace, treats empty results as no-op, and truncates over 60 characters to 59 characters plus `…`.
- The session row context menu order is `Pin/Unpin`, `Rename`, `Archive`, `Mark as unread`, `Reveal in Finder/File Explorer/File Manager`, `Copy` (`working directory`, `session ID`, `deeplink`), `Fork` (`local`, `new worktree`), and `Open in new window`. Archiving is non-destructive, hides the session from normal lists, clears pin/unread state, and archives the linked Codex thread when one exists. `Copy deeplink` uses `nodex://sessions/<session-id>`. `Open in new window` seeds the requesting layout with the exact `activeProjectSessionId`.
- Collapsing the Workbench sidebar: width defaults to `300px`, is clamped to `240..520px`, persists under `sidebar-width`, and the explicit `Hide sidebar` / `Show sidebar` trigger, command palette command, native menu item, and `Cmd/Ctrl+B` shortcut all use the same `toggleSidebar` path. The real sidebar closes through an animated progress spring, remains mounted until progress reaches zero, moves the left titlebar controls from the same animated width, and snaps under reduced motion. During expanded-sidebar sash resize, raw widths from `120px` through `239px` keep the sidebar open at the `240px` minimum; only raw widths below `120px` collapse it. The collapsed sidebar auto-reveals only from the inclusive left-edge pointer strip `0..12px`, including while a full-width right panel is open. The floating sidebar remains visible while the pointer stays inside the current sidebar width, while keyboard focus remains inside the floating sidebar shell, or while its resize sash is actively dragging, then hides when those holds are gone. The floating sidebar can be resized from its right-edge sash; its width clamps and persists like the expanded sidebar, but dragging below the minimum clamps to `240px` instead of expanding/collapsing the real sidebar. Focus inside right or bottom panel controls must not reveal the sidebar.
- Sidebar footer keeps a compact Settings button at bottom-left, no workspace switching controls, and an authenticated Codex quota indicator at bottom-right when account rate-limit data is available.
- Settings opens a full-window settings route shell, not a modal dialog or overlay. It replaces the normal workbench body with a left navigation rail, a `Back to app` affordance, and one active section page at a time instead of a single scrollspy document. The settings rail owns only settings navigation, preserves the same renderer-transparent native vibrancy as the normal sidebar, and leaves each section to render a full-width `main-surface` pane with the settings content centered at the established settings width. The shell is path-driven (`/settings/:section`) and redirects invalid section ids to the default visible section. On desktop, the settings rail groups sections and includes a local `Search settings…` field below `Back to app`; `Cmd/Ctrl+F` focuses and selects it, `Escape` clears it, Arrow Up/Down wraps highlighted results, Enter selects only a highlighted result, and selecting a result navigates to `/settings/:section` without clearing the query. The search index is generated from a normalized renderer catalog of section titles, subtitles, group headings, setting row labels/descriptions, option labels, aliases, and hidden runtime project-name terms; results still navigate to the owning settings section rather than to an individual row. The current sections are `General` (`Restore windows`, `Desktop notifications`, `App updates`, `Diagnostics`, `Telemetry`), `Appearance` (`Theme`, `Sans font size`, `Code font size`), `Keyboard shortcuts` (searchable editable command shortcuts, keystroke search, capture, clear, reset-one, reset-all, conflict warnings, and user-level persistence in `~/.nodex/config.toml` under `[server.command_keybindings]`), `Agent` (`Permissions modes`, `Custom config.toml settings`), `Editor` (`Thread detail`, `Spellcheck`, `Auto-link while typing`, `Auto-link on paste`, `Recognize bare domains`, `Large paste text threshold`, `Large paste description soft limit`, `Open markdown file links in`, `Smart parse block prefixes`, `Strip parsed prefix from title`, `Confirm thread section send`, `Cmd/Ctrl+Enter to send long prompts`, `Queue follow-ups`), `Card` (`Kanban card properties`, `Card stage collapsed properties`), `Worktrees` (`Worktree start mode`, `Auto branch prefix`, managed-worktree inventory), `Local environments` (a settings-surface page constrained to the same centered max-width as other settings pages; its root state is a project chooser with `Learn more` copy and `Add project`, and project-specific summary/edit subpages move through a breadcrumb toolbar while editing structured `.codex/environments/*.toml` `setup`, `cleanup`, platform overrides, and reusable actions), and `Backups` (auto-backup on/off, frequency hours, backup retention, history retention, manual backup, restore, per-snapshot delete). `Sans font size` defaults to `15px`, persists locally, updates `--vscode-font-size`, and scales the shared sans typography tokens used by the renderer; `Code font size` defaults to `14px`, persists locally, and sets `--vscode-editor-font-size` globally.
- On macOS, traffic-light window controls stay visible at top-left; when the sidebar is expanded, the sidebar collapse control plus Back/Forward controls sit beside them in the sidebar top strip, and when collapsed the titlebar left region reserves `208px` for the sidebar toggle, Back/Forward, then a compact `New chat` button before the thread title section.
- Card Stage session selection lives in the active session's right-panel tab groups; leaf tab strips support hover tooltips, close, wheel-driven horizontal scrolling when tabs overflow, pointer-only drag reorder, cross-leaf tab moves, and edge-drop splitting through the shared tab strip/tree
- Settings can choose which optional card-stage rows start behind the Card Stage `more properties` toggle (`Tags`, `Assignee`, `Threads`, `Schedule`, `Agent blocked`, and `Agent status`)
- Terminal is a session-attached panel tab that defaults to the bottom panel, starts from the active session/thread cwd before falling back to the project primary source, and can be moved to the right panel. Card Stage may request a session terminal, but cards cannot own terminal tabs or PTY ids.
- The session thread page is a live Codex workspace in Electron. Without an attached thread, it shows a centered new-chat home headed `What should we build in <project>?`, with the inline project selector sharing state with the lower composer project selector. The sticky composer exposes add-context, Plan mode, permissions, model/reasoning, dictation, send controls, a project selector, and a `Start in` selector in the attached lower status strip. The `Start in` selector supports `Work locally` and `New worktree`; cloud, connected-app, suggestion, and projectless rows stay hidden until those backend paths are intentionally added. Submitting the first prompt starts a session-owned Codex thread for the selected project and stores the link in `project_session_threads`; if the selected project differs from the current blank session's project, Nodex first reuses or creates a blank session owned by that project, then starts the thread there so session/project ownership remains valid. `Work locally` uses the selected project's primary source when one exists, otherwise a generated per-thread local workspace. `New worktree` requires a primary source, creates a managed Git worktree, runs the selected local-environment setup script when configured, starts `thread/start` and `turn/start` in that worktree cwd, streams setup progress, and links the resulting thread to the owning session. Thread-id attachment storage remains available at the transport layer, but the workbench header does not expose an attach/detach thread button. Projectless new-chat startup remains hidden until a backend projectless session path exists.
- Side chats are temporary forked conversations for questions and lightweight exploration. Starting a side chat sends an ephemeral `thread/fork` with excluded parent turns, injects a side-conversation boundary before any initial prompt, and renders the resulting thread through the same connected local conversation stage inside the right or bottom panel. Inherited parent history is reference-only; workspace mutation is allowed only when the user explicitly asks for mutation inside that side conversation. Side chats are excluded from project thread lists, session thread links, durable tab ordering, archive/title flows, and cold-start restoration. Closing a side-chat tab discards its cached temporary thread in the background; missing or discarded side chats render `Side chat expired` with `Start new side chat`.
- Opening a session with an archived attached thread shows an archived-thread restore state. Nodex must not call `thread/resume` for archived thread metadata; the user explicitly restores the thread through `thread/unarchive`, then the normal resume flow can continue after the thread is active again.
- Detailed visible transcript behavior for Threads lives in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md), including answered `request_user_input` rows, plan-implementation follow-up flow, optimistic prompt dedupe, tool/reasoning rendering, and restart recovery rules.
- User-message transcript actions:
  - `Copy message` and the sent timestamp are available from user bubbles.
  - The user sent timestamp comes from the turn's `turnStartedAtMs` and renders as localized short time only.
  - Long user-message bubbles collapse to a 20-line preview with local `Show more` / `Show less` controls; this is renderer-only UI state and does not change thread data.
  - `Ask in side chat` starts a temporary side conversation from the selected user-message text, or the full message when no selected text is available.
  - `Edit message` is shown only on the last user message of the latest completed editable turn; activating it swaps that bubble for an inline edit prompt in place, and the actual rollback-plus-resend happens only after the user clicks `Send`.
- Assistant-message transcript actions:
  - Completed final assistant messages can expose `Copy`, `Good response`, `Bad response`, `Fork from this point`, and sent timestamp actions.
  - The assistant sent timestamp comes from `finalAssistantStartedAtMs`, refreshed from live agent-message event timing; protocol `completedAt` is only an archived/read fallback and is not the renderer's display source.
  - `Fork from this point` is shown on eligible completed final assistant messages; latest-turn forks execute immediately, while older-turn forks open a confirmation dialog unless the user has opted out of that confirmation.
  - Forking from a session-backed thread opens a new project session backed by the forked conversation snapshot and focuses the composer in that new session. Non-session legacy thread surfaces may still open the forked thread directly.
- Mounted thread turn rendering follows the turn projection pipeline:
  - each visible turn is projected from an ordered item stream into semantic render buckets, then rendered in a fixed order instead of category-priority reshuffling
  - visible order is `model changed -> user -> model reroute -> agent/exploration body -> system event -> assistant with assistant-after artifacts/actions -> MCP elicitation -> proposed plan / todo -> in-progress placeholder -> provenance markers`
  - the mounted renderer preserves the canonical per-turn item sequence from the conversation snapshot instead of re-sorting turn items by timestamp or id inside the renderer
  - pre-final assistant commentary stays in the agent-work body ahead of the final assistant anchor; only the final assistant message becomes the dedicated assistant block for the turn
  - completed turn diffs render as assistant-after `Edited …` cards before the final assistant action strip when a final assistant exists
  - collapsed historical agent-work sections prefer explicit first-work timing, then `durationMs`, then `X previous messages`; timing labels render as `Worked for …`
  - collapsed historical agent-work toggles render as a full-width left-aligned click target without hover highlight, with nested muted label text, a `rotate-0` / `rotate-90` chevron, and a separate light divider line
  - active running turns with qualifying first-work timing render a standalone non-button `Working` / `Working for …` divider before the first non-user work row; it has no hover background, chevron, or `aria-expanded`
  - the detailed classifier contract, conditional assistant-promotion rule, and scenario matrix live in [codex-thread-turn-ordering-and-assistant-promotion.md](../codex-thread-turn-ordering-and-assistant-promotion.md)
  - collapsed agent-work sections collapse to the summary row only; their body exits the DOM once collapsed, while collapsed command-tool bodies keep the hidden measured body in the DOM with `height: 0`, `opacity: 0`, and pointer events disabled
  - the mounted thread body uses a flat section layout: no extra turn-level tool card wraps, and tool / exploration / system rows render as direct sections instead of being nested inside additional app-owned shell cards
  - approvals, request-user-input, and implement-plan prompts stay in the footer request surface above the composer rather than being rendered as normal inline timeline blocks
  - blocking active requests and background approvals replace only the composer editor/footer controls until the request surface is cleared; existing-thread request surfaces do not render the new-chat-only lower composer status strip
  - reopening an existing thread tab first enters a resume shell state; the mounted transcript and composer stay hidden until the active conversation reaches `resumeState = resumed`
  - reopening a completed thread after app restart now resumes through the main-process conversation manager only, without session bootstrap, rereads, or transcript re-merges
- Thread stage project context is stage-local (`threadsProjectId`) and remains stable when DB datasource changes
- Desktop notifications use a three-layer split: a renderer-side local-thread producer emits normalized `turn-complete`, approval, and request-user-input events; a renderer-side controller suppresses/shapes them from focus plus settings; and the main process owns the actual Electron `Notification` objects, OS callbacks, and dismissal by conversation.
- Detailed desktop-notification rules, payloads, suppression semantics, and action routing live in [Desktop Notification Behavior](./desktop-notification-behavior.md).
- Desktop notifications remain separate from the in-app global toast system: desktop notifications are OS-level and main-owned, while in-app toasts are renderer-local, transient, and shown in one top-centered global overlay.
- Settings -> General -> `Desktop notifications` exposes three independent controls: `Turn complete` (`Never`, `Only when unfocused`, `Always`), `Approval requests` (boolean), and `Questions` (boolean). Defaults are `Only when unfocused`, approvals enabled, and questions enabled.
- Turn-complete notifications are governed only by the turn-complete mode and current window focus. Approval-request and request-user-input notifications ignore the turn-complete mode and are suppressed only when the focused stage is `threads`, the active thread tab matches that conversation, and the app window is focused.
- Turn-complete notifications may include inline reply, use the thread title or `Turn complete` as the title, and summarize code-review outputs as `Code review finished. No findings.`, `1 finding.`, or `N findings.` when the final assistant message contains inline review findings. Approval and question notifications are open-only; approvals expose `Approve`, `Approve for session`, and `Decline` actions, while question notifications do not expose reply or approval buttons.
- Opening a desktop notification focuses the origin window and opens the matching thread tab. Reply sends a new turn into that thread. Approval actions route back through the existing approval-response flow. Navigating to a real thread tab dismisses all desktop notifications for that conversation.
- User-interrupted turns must never produce a turn-complete desktop notification, even if later terminal updates arrive for that turn through the local stream.
- Packaged macOS builds can check for stable app updates on launch in the background, download them automatically when found, expose a manual `Check now` action in Settings -> General -> `App updates`, expose `Check for Updates…` in the macOS app menu, and require an explicit `Restart to Update` action before installation.
- Diff stage is a review panel bound to the active thread cwd or project primary source:
  - review sources include `Last turn`, `Review uncommitted changes`, `Review staged changes`, and `Review against a base branch`
  - the panel can initialize Git for a workspace that is not yet a repository
  - the toolbar exposes source selection, `+N` / `-N` stats, `Review options`, `Jump to file`, unified/split diff mode, `Hide files` / `Show files`, `Commit or push`, and `Create PR`
  - the panel does not expose word-diff toggles, rich-preview toggles, full-file loading toggles, manual file-tree resizing, copy-git-apply commands, or inline stage/unstage/revert actions
  - Git-backed review sources load through main-process `git:review:diff`, branch stats, and merge-base IPC, preserving separate loading, load-failed, timed-out, non-git, empty, and large-diff states
  - `Last turn` renders from the active conversation's turn diff, while Git-backed sources load workspace diffs with optional hidden-whitespace review options
  - the right-side file tree is fixed-width, can filter changed files with `Filter files...`, and can be hidden without resetting diff selection or comments
  - model-produced `::code-comment{...}` directives render as path/line anchored review annotations above the matching file diff
  - very large reviews fall back to a capped one-file-at-a-time mode when they exceed file-count, total-line, total-byte, or single-file changed-line thresholds
  - detailed Review panel behavior lives in [Review Right Panel Behavior](./review-right-panel-behavior.md)
- Create/delete projects from the sidebar Projects header or project-row action menus.
- Default project is seeded on first boot with a UUID canonical ID and a retained `default` legacy alias.
- In Electron, startup opens into a blocking bootstrap surface until local initialization completes; if a future supported SQLite schema migration is running, that surface shows determinate migration progress and migration-specific status copy
- Project ID: opaque UUID generated server-side. Legacy slug IDs resolve through aliases, but responses return canonical UUIDs.
- Project icon: optional per-project emoji persisted in SQLite; when empty, UI shows a project-colored dot
- Project sources: ordered source folders persisted separately from the project row. The first source is the primary workspace root for Git, Files, Review, local thread cwd, and managed worktree base repository; all configured sources are writable workspace roots for sandboxing.
- Empty-source projects are valid Nodex data containers. Work-local thread starts allocate a generated per-thread workspace; managed worktree and local-environment flows require a primary source and surface a clear error when missing.
- Sidebar project rows do not show the source path inline. Each project row actions menu exposes rename, choose icon, edit sources, add source folder, project pin/unpin, `Open in Finder` for the primary source, and delete.
- Sidebar project headers can be reordered by dragging the header row. Normal project groups persist their order in `project_order`; pinned project groups render in a `Pinned` section above Projects and persist their order in `pinned_project_order`.
- Dragging a normal project header onto the pinned section pins that project and leaves normal project order unchanged. The Projects section excludes pinned projects while preserving their normal order for later unpinning.
- The Projects header add button opens a submenu with `Start from scratch` and `Use an existing folder`. `Start from scratch` opens the local project setup dialog with optional name/source collection. `Use an existing folder` opens the native folder picker, names the project from the folder basename, and stores that folder as the first source.
- CASCADE delete removes all cards and history for a project
- Codex thread links are one-owner: one card can own many threads, each thread belongs to one card

#### 2. Kanban Board View
- 8 columns representing workflow stages
- Drag-and-drop cards between columns
- Each kanban column header includes a `more actions` popover for collapsing that column and adjusting its persisted expanded width; collapsed columns still show their card count and the same `more actions` trigger
- Shift-click in Kanban toggles a temporary multi-selection from the clicked card; selection can span columns, dragging moves the whole selected set together as one grouped undo step, and dropping into editors inserts one `cardToggle` per selected card before deleting all source cards in the same grouped action
- Native block drag from visible NFM editors (Card Stage, including projected inline embed rows) into Kanban columns creates card(s) using move semantics (source blocks are removed)
- Dragging a Kanban card into a visible NFM editor (Card Stage, including projected inline embed rows) creates a standalone `cardToggle` snapshot block and removes the source card (move semantics)
- Card->editor drop is pointer-anchored, blocks self-drop, supports same-project and cross-project sources, and persists as one grouped undo/redo action (target description update + source card delete)
- Card->editor drag shows a live in-editor insertion line (matching BlockNote drop-cursor semantics) even though the drag source is the Kanban native drag runtime
- The NFM side-menu `Move to` action opens a compact destination popover with grouped `DB` and `Card` search results. DB rows disclose column/status child destinations, while card rows append blocks to an existing card. Detailed behavior lives in [NFM Editor Move-To Popover Behavior](./nfm-editor-move-to-popover-behavior.md).
- `cardToggle` chips (`priority`, `estimate`, `status`) are editable inline in NFM editors and mutate both serialized `meta` and embedded snapshot payload
- In NFM editors, `cardToggle` property chips sit in the same inline text flow as the toggle title, so wrapped titles use the full row width like inline kanban card properties instead of a separate leading chip column
- Dragging a `cardToggle` block back into Kanban creates card(s) with snapshot-preserved properties (priority/estimate/tags/assignee/due-date/scheduled-start/scheduled-end/blocked) plus current title/description edits
- Block-drop card creation uses pointer-based insertion (top/middle/bottom) with a visible drop indicator
- Block->card import supports strict smart shorthand parsing for non-`cardToggle` blocks (`0..4`, optional estimate `XS/S/M/L/XL`, optional `(tag)`), applying parsed values to `priority`, `estimate`, and `tags`
- Visual card previews with priority badges
- Kanban card reorder keeps a non-layout-shifting insertion indicator; the source card stays as a static ghost in place while dragging, same-column reorders do not live-shift sibling cards, columns do not tint as separate previews, the drag overlay is geometry-matched to the source card so it starts aligned with the cursor, and dropping on the visual gap between cards still inserts into that gap instead of falling through to column-end append
- The Kanban insert-position indicator is resolved against the remaining non-dragged cards in the target surface, so same-column and multi-card drags never draw the line above a dragged ghost when the actual drop will land before the next remaining card
- Kanban card property chips (priority/estimate/tags/assignee) render inline with the card title by default, and Settings can move them above the title or below the body
- Right-clicking a Kanban card opens a Radix context menu with a searchable action list; `Copy deeplink` copies an `nodex://cards/<card-id>` deeplink to the target card, `Delete` removes the card, and clicking `Move to` advances the same menu into a searchable in-place project picker that moves the card into the same workflow column in the selected project
- Real-time updates when data changes
- Card updates include revision-based stale-write detection: stale edits return typed `conflict` results instead of silent last-write-wins
- Card Stage surfaces conflicts inline with explicit recovery actions: `Reload Latest` (drop local draft fields) and `Overwrite Mine` (retry on newest revision)
- Header task search supports token-contains matching across title/description/tags/assignee/agent status/id in Kanban, All Tasks, and Toggle List views
- Kanban card drag-and-drop stays available while search or toolbar filters are active; reordering maps the visible drop slot back into the underlying board order so hidden non-matching cards keep their relative position
- When a non-default toolbar sort is active in Kanban view, cards remain draggable across columns and into editors, but same-column manual re-ranking is disabled because the active sort, not board order, owns the visible ordering
- Native block-drop import into Kanban remains blocked under free-text search, but structured filter/sort views can still accept imports when Nodex can either preserve an exact visible slot by inferring safe workflow properties or clearly downgrade to column-level create feedback
- Detailed drag-and-drop behavior and invariants: [Kanban Drag and Drop Behavior](./kanban-drag-and-drop-behavior.md)

#### 3. Toggle-List View
- Third project page tab (`Toggle List`) renders cards as top-level toggle rows in a specialized BlockNote editor
- Each top-level toggle row maps to one card: editable title in row header, with description mapped to child blocks
- Toggle-list editor uses the same shared slash-menu controller as Card Stage (defaults + custom blocks) to keep insertion UX aligned
- Inline embeds (`cardRef`, `toggleListInlineView`) use single-editor projection: referenced card rows are projected as children in the host NFM editor (no nested BlockNote editor instances)
- Projection sync for inline embeds is shared per editor instance (one listener set + owner registry) instead of per-embed listeners, so typing latency remains stable with many embeds open
- Board state sync is shared per project (`useKanban` store-backed): one realtime subscription/fetch pipeline fans out to all consumers and exposes O(1) `cardIndex` lookup
- Card description toggles in Toggle List + inline toggle-list embeds honor NFM `▼` (expanded) / `▶` (collapsed) prefixes on load, and toggle-click changes are persisted back to card descriptions (and synced across views)
- View-toolbar filter/sort controls:
  - `kanban`, `list`, and top-level `toggle-list` share one view-local filter model with grouped logic (`OR` across groups, `AND` within group) and status/priority/tag clauses
  - Priority clauses can explicitly include or exclude empty priority values via the `-` filter chip instead of treating empties as an implicit side effect of selecting all concrete priorities
  - Each supported view has its own persisted sort stack; list-header sort clicks write through to the same shared toolbar sort state, and nullable `priority` / `estimate` sorts can place empty values either first or last (default: last)
  - When active, filter/sort rules surface as compact pills in a collapsible bottom band inside the toolbar; the sort side uses one leading chip (`Field` with direction for a single sort, `n sorts` for multiple) separated from filter chips by a thin divider
- View-stage display controls move into the toolbar `Display` popover:
  - `kanban`: reorder + hide/show board-card properties for `priority`, `estimate`, `tags`, `assignee`
  - `toggle-list`: reorder + hide/show row properties for `priority`, `estimate`, `status`, `tags`
  - `kanban` and `toggle-list` can also show empty `priority` / `estimate` values as neutral `-` chips, using the same styling in both views; kanban keeps those empty chips editable through the same inline property menu used by filled chips
- Row properties render as Notion-like chips (priority/estimate/status) matching existing board/card-stage visual language
- Toggle-list editor surface reuses the same `nfm-editor` styling layer used by Card Stage for consistent typography/spacing/toggle visuals
- Bi-directional sync:
  - editor title/description edits sync back to card updates
  - board updates from Kanban/List/card-stage refresh toggle rows
  - projected-row edits apply local optimistic card patches before remote persistence so board/list views reflect changes immediately
- Structural guard blocks manual insert/delete/reorder/type-change of top-level card rows; structure is rule-driven
- Supported DB view filter/sort/display settings persist per project and per view in renderer localStorage

#### 4. SQLite Database Storage
- Single `kanban.db` file in kanban directory
- Atomic transactions for data integrity
- Schema v26 with UUID-v7 card ids, description revision storage, Codex thread-link metadata keyed by `thread_id`, recurring reminder state, and project-scoped realtime/history state

#### 5. Card Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Canonical lowercase UUID-v7 |
| `title` | string | Yes | Task name (max 2,000 chars) |
| `description` | string | No | [Notion-flavored Markdown (NFM)](../references/notion-flavored-markdown-spec.md) details (default: ""), including `<image ...>` blocks and inline `<attachment kind="text|file|folder" mode="materialized|link" ... />` chips with local or managed asset URIs (max 1,000,000 chars) |
| `priority` | enum | No | Optional priority tier: p0-critical, p1-high, p2-medium, p3-low, p4-later |
| `estimate` | enum | No | xs, s, m, l, xl |
| `tags` | string[] | No | Custom labels (default: [], max 64 tags, each max 64 chars) |
| `dueDate` | date | No | Task deadline (YYYY-MM-DD format) |
| `scheduledStart` | datetime | No | Scheduled start timestamp (ISO 8601) used by Calendar and recurrence windows |
| `scheduledEnd` | datetime | No | Scheduled end timestamp (ISO 8601, must be after `scheduledStart` when both are set) |
| `isAllDay` | boolean | No | Explicit all-day flag; when `true`, schedule is stored as local-day start plus end-exclusive day boundary (`scheduledStart` + `scheduledEnd` required) |
| `recurrence` | object | No | Repeat rule (`daily|weekly|monthly|yearly`, interval, optional weekdays, optional inclusive until date) |
| `reminders` | object[] | No | Reminder offsets in minutes before each occurrence start (`[{offsetMinutes}]`, deduplicated) |
| `scheduleTimezone` | string | No | IANA timezone used to anchor recurring schedule expansion |
| `assignee` | string | No | Who's working on it (max 256 chars) |
| `agentStatus` | string | No | Current agent status message (max 1,024 chars) |
| `agentBlocked` | boolean | No | Whether agent is blocked (default: false) |
| `runInTarget` | enum | No | Where new card threads run: `localProject` (default), `newWorktree`, `cloud` (mock/blocked) |
| `runInLocalPath` | string | No | Optional local folder override used when `runInTarget=localProject`; empty means project primary source or generated per-thread workspace for empty-source projects |
| `runInBaseBranch` | string | No | Optional base branch for new worktree creation (`runInTarget=newWorktree`) |
| `runInWorktreePath` | string | No | Persisted managed worktree path used for sticky reuse when `runInTarget=newWorktree` |
| `runInEnvironmentPath` | string | No | Optional repo-relative `.codex/environments/*.toml` path used when creating a new managed worktree; selected in Card Stage and edited in Settings -> Local environments |
| `revision` | number | Yes | Monotonic per-card revision used by optimistic stale-write detection (`card:update expectedRevision`) |
| `created` | datetime | Yes | Creation timestamp (ISO 8601) |
| `order` | number | Yes | Sort order within column (0-indexed) |

#### 6. Inline Card Creator
- Notion-style inline form in each column
- Cards created via the inline creator are inserted at the top of the current column
- Quick-add with optional priority, estimate, tags
- Enter to save, Escape to cancel
- Priority/estimate and other single-choice pickers use the shared Codex dropdown facade rather than a separate shared Select primitive
- Click-outside save/cancel logic ignores portaled select menus so property selection does not dismiss the creator

#### 7. Card Stage Editor
- Notion-style slide-out panel for card details
- Always-editable fields (no edit mode toggle)
- Card description edits persist after a 1.5s auto-save debounce, with immediate save on blur/close and explicit save actions
- Card Stage visibility context is global: switching spaces/projects and views keeps the current Card Stage state/card until explicitly closed
- Card Stage draft fields survive view/space switching because local patch/update/move operations keep the active card snapshot in sync
- Card Stage priority uses an explicit empty state by default; empty priority renders as a subdued placeholder in selectors and is omitted from dense card badges.
- Card Stage Properties includes schedule editing with an `All-day` mode toggle.
- Card Stage Properties includes a `Run in` selector for new thread execution target: `Local project` (with optional folder override picker), `New worktree` (base-branch selector + environment selector for `.codex/environments/*.toml`), and `Cloud` (mock/unavailable).
- Timed mode uses start/end `datetime-local` inputs with quick actions (`Set schedule`, `Now + 1h`, `Clear`) and automatic end-after-start guardrails.
- All-day mode uses start/end `date` inputs (end shown as inclusive in UI, persisted as end-exclusive storage) with the same guardrails.
- Tag input suggests existing project tags while typing via native autocomplete options (excluding tags already on the current card)
- BlockNote block editor for description (Notion-flavored Markdown)
- NFM headings use a typography scale in-editor: H1 `1.875em`, H2 `1.5em`, H3 `1.25em`, H4 `1.125em`, all at `600` weight with `1.3` line-height relative to the editor body size
- Card Stage toolbar includes a `Show raw` toggle that swaps the description area into a read-only raw NFM view of the current local draft for debugging, without changing card fields or save behavior.
- BlockNote structural animations are mostly disabled in-editor (including indent/unindent depth transitions) to keep editing interactions immediate
- NFM link labels are escape-normalized on parse, so repeated auto-save cycles remain idempotent (prevents exponential backslash growth on escaped markdown markers inside link text)
- NFM autolink behavior is renderer-configurable: typing and paste recognition can be toggled independently, bare-domain recognition defaults on, and paste-time matching is intentionally strict enough to leave repo paths, slash-separated path segments, local file paths, and filename-like text such as `foo/bar/baz.md`, `local/code-block-mock-ui/action-menu-popper.com`, or `nfm-editor-copy-behavior.md` plain by default
- Manual link creation/editing in the NFM editor trims surrounding whitespace only and otherwise preserves the entered target exactly, so absolute local paths, slash-separated relative file paths, `file://` URLs, and protocol-less domains are all stored as authored
- Preserved manual NFM links are classified only at open time: bare domains open as `https://...`, absolute/file URLs open through the local-file path, relative file-like links resolve against the active project primary source, and unresolved file-like links fail closed instead of navigating browser-relative
- Detailed autolink rules and examples: [NFM Editor Autolink Behavior](./nfm-editor-autolink-behavior.md)
- Detailed manual-link rules and examples: [NFM Editor Link Behavior](./nfm-editor-link-behavior.md)
- Card writes are validated before persistence (field limits + enum/type checks), and oversized HTTP payloads for create/update are rejected with `413`
- `Shift+Enter` hard line breaks are persisted within the same block across app restarts
- Enter-created blank paragraph lines are persisted as `<empty-block/>` and preserved across app restarts
- Ordered-list markers round-trip exactly through NFM parse/save/reload and raw read-only NFM rendering, so authored sequences like `3.`, `4.`, or restarted `1.` blocks are preserved instead of being normalized to `1.` per item
- Thread sections are supported via `<thread-section ... />` blocks: they render as divider-like runnable section headers in the Card Stage editor, bind to a sticky per-section Codex thread, and define a prompt as the marker's direct children plus all following sibling blocks in the same parent collection until the next thread section, excluding nested child thread-section ranges; typing `---` on an empty paragraph inserts a new thread-section marker by default, sending opens a plain-text confirmation preview by default, and sending from unsectioned content inserts a new marker before the current block
- NFM supports inline `<agent-config mode="default|plan" model="..." reasoning="minimal|low|medium|high|xhigh" />` chips. They are interpreted only at send time, stripped from model-visible text, and later chips override earlier attributes for that one send. Unknown attributes, invalid values, or invisible app-server models block sending with a validation error. In NFM editors, chips display readable model labels when available, clicking a chip opens a compact editor popover for mode, visible app-server model, and reasoning fields, and the Card Stage editor slash menu includes an `Agent Config` command that inserts a plan-mode config chip.
- Toggle headings (`▶# Heading`) supported: headings with collapsible children, matching Notion's toggle heading behaviour
- Toggle open/closed state is persisted in NFM using `▼` (expanded) / `▶` (collapsed) markers; state survives save/reload cycles via a localStorage bridge that pre-populates BlockNote's `defaultToggledState` on editor init and reads DOM `data-show-children` on save
- `ArrowUp` / `ArrowDown` across a collapsed toggle boundary preserve browser-native visual-line movement and never jump into hidden edge non-inline children while the toggle stays collapsed
- Typing `## ` inside a toggle header converts it to a toggle heading (preserves toggle state)
- `Cmd/Ctrl+Enter` sends the current explicit thread section from the Card Stage editor without moving focus to the Threads stage; if the cursor is on a toggle header or `cardToggle` row, the editor preserves toggle-expand behavior instead of sending
- `Enter` at end of an open toggle header (or toggle heading) with no children still creates a first child paragraph (Notion fallback) instead of a sibling block
- `Enter` in the middle or at the end of any inline parent block that already has children splits trailing parent text into a new first child paragraph
- `Backspace` at the start of a leaf child block under an inline parent always merges into the previous sibling, or into the parent if it is the first child
- `Enter` at the start of an empty leaf child block under an inline parent creates a sibling paragraph in the same child group instead of unindenting
- Existing divider blocks remain normal `---` separators unless explicitly converted; only the fresh typed `---` shortcut inserts a thread-section marker by default
- `Cmd+A` selects only the current block content while editing
- Normal copy/cut uses one cut-aware clipboard model across `blocknote/html`, `text/html`, and structure-preserving `text/plain`; it preserves the rich clipboard payloads and rewrites `nodex://assets/...` paths only in `text/plain` for external use when the sync asset-path prefix is available
- Detailed copy rules and examples: [NFM Editor Copy Behavior](./nfm-editor-copy-behavior.md)
- `Cmd/Ctrl+F` opens in-editor find for NFM description with sticky find bar, match count, previous/next navigation (`Enter`/`Shift+Enter`), and highlighted matches; when editor text is selected, the find query seeds from that selection
- Replace controls are hidden by default and shown in a second row only when toggled; supports `Replace` (current match) and `Replace All`
- Find/replace UI uses a floating dark two-row panel (top: find + nav, bottom: replace) anchored in-editor without shifting document content
- Search includes text inside collapsed toggles; collapsed toggle ancestors are expanded only when navigating to a matched result inside them
- Drag-hovering collapsed toggle headers (`toggleListItem`, toggle headings, and `cardToggle` rows including projected rows under `cardRef` / `toggleListInlineView`) keeps a stable, Notion-style overlay highlight with pointer-coordinate hit-testing plus drop-time active-target fallback for side-menu retargeting (no rapid flicker), and supports diagnostics via `window.__TOGGLE_DND_DEBUG__ = true`
- Image blocks are supported in NFM (`<image source="...">Caption</image>`) and render in both editor and read-only previews
- When a Card Stage thread-section prompt contains NFM image blocks, supported `http://` and `https://` sources are sent to Codex as image URL inputs, absolute local paths and resolved `nodex://assets/...` sources are sent as local image inputs, and captions remain in the cleaned nearby prompt text. Image attachments stay attachments and do not imply model image input.
- Mouse drag/range selections that span image blocks show a blue-tinted image-block highlight/outline so inclusion is visually explicit
- Image block floating toolbar includes `Copy image` (copies actual image content through the native desktop clipboard, does not fall back to copying the URL, and shows a global in-app success/error toast for the result)
- Pressing `Space` while an image block is focused opens a larger centered modal preview; pressing `Space` again closes it (Esc/click outside also close)
- Double-clicking an image block opens the same large preview modal
- Image preview modal includes zoom controls (`+`, `-`, reset) with a visible zoom percentage
- Pasting images uploads them to shared local assets and inserts image blocks automatically
- Pasting from Notion preserves block structure (including toggle blocks and nested children) when Notion clipboard metadata is present
- Notion paste preserves inline rich text marks (`bold`, `italic`, `strikethrough`, `code`, `underline`) and inline text/background colors from Notion annotation metadata (`h` color tokens)
- When pasting plain text that exceeds the configurable `Large paste text threshold` (default `100,000`) or would push the description near the configurable `Large paste description soft limit` (default `750,000`), Nodex intercepts the paste and offers `Save in Nodex`, `Paste anyway`, or `Cancel`, with a truncated, scrollable preview of the pasted text and character/line metadata in the dialog
- On Electron desktop, if the native clipboard exposes actual file or folder entries, Nodex intercepts the paste before default BlockNote handling. File paste offers `Save in Nodex`, `Keep as link`, or `Cancel`; folder paste offers only `Keep as link` or `Cancel`. Plain copied absolute paths in `text/plain` do not trigger this prompt, and browser runtime does not support native file/folder paste inspection
- `Save in Nodex` stores pasted text/files in shared local assets and inserts an inline `attachment` chip. Saved text-like attachments open a scrollable preview capped to `200` lines or `64 KiB`
- `Keep as link` inserts an inline `attachment` chip that references the original absolute path for pasted files/folders; this option is not shown for oversized plain-text prompts, and it is the only supported folder-paste action
- `Paste anyway` bypasses the attachment flow and inserts the oversized text directly into the note despite the warning
- Attachment chips stay inline with surrounding paragraph content, show only concise label/icon chrome, reveal a short hover hint, and open a click popover with metadata plus `Open`, `Reveal`, `Copy path`, and `Open original` actions when an original path exists
- Detailed attachment-chip rules and examples: [NFM Editor Attachment Chip Behavior](./nfm-editor-attachment-chip-behavior.md)
- Slash menu (`/`) for inserting block types
- Slash menu includes a custom `Toggle List Inline View` block insertion item
- `Toggle List Inline View` is a custom NFM block (`<toggle-list-inline-view ... />`) that renders a low-distraction inline sequence of toggle rows for a chosen source project
- Inline block row headers reuse existing property chip styles (`priority`, `estimate`, `status`) on the same title line
- Inline block is rendered full-width in the editor flow with a chrome-less container (no extra wrapper margin/padding/background/indent), card rows use the standard toggle-caret icon style, and `toggleListInlineView` block-content padding is reset to `0`
- Inline embed root rows explicitly cancel BlockNote nested-group left margin so `toggleListInlineView` rows stay left-aligned with surrounding blocks
- Inline controls remain available via lightweight top-right actions without adding persistent container chrome
- `toggleListInlineView` top-right action bar includes a dedicated drag handle button that drags the embed owner block directly
- `cardRef` owner dragging is available from the left BlockNote side-menu drag handle; when hovering projected rows/descendants, the handle targets the owning `cardRef` block (not the projected child row)
- Inline block actions support source-project selection and foldable advanced rules editing (single dense control surface), with rules-panel expanded state persisted in localStorage (not in NFM block props)
- Inline toggle-list rules persist canonically as `rulesV2` (base64url JSON); old status/priority/tag/rank attrs are ignored, and explicit empty-priority filters serialize in canonical `rulesV2` rather than depending on legacy “all priorities” behavior.
- `toggleListInlineView` excludes the current host document card by default when source project matches the host; users can include it from Rules (`Include current host card`)
- Inline card rows are projected directly into the host NFM editor tree as child `cardToggle` rows; drag handles and block DnD operate on one editor surface (no nested side-menu conflict)
- `cardRef` / `toggleListInlineView` are childless embed blocks at persistence boundaries: parser/adapter/serializer normalize away direct children so NFM always stores them as self-contained tags (`toggleListInlineView` persists `rules-v2="..."` when explicit rules are present, otherwise current defaults apply in-memory).
- Dropping host-document blocks onto a `toggleListInlineView` owner/root boundary creates cards in the inline view's source project instead of nesting blocks under the embed; target status/index are inferred from pointed row neighbors and active rank/filter rules (best-effort)
- Projected row roots are structure-guarded for manual insert/delete/reorder, but dragging a projected row root out to host-doc scope materializes it into a standalone `cardToggle` and deletes the source card using source-project metadata (works for same-project and cross-project projected sources); child blocks inside projected rows remain freely draggable in/out
- Inline block recursion is guarded: nested same-source inline views render an infinity placeholder (`∞`) instead of expanding recursively
- Drag-handle block menu includes a real `Move to` destination popover with grouped DB/card search results; DB columns create destination cards and card rows append into existing card descriptions while removing the selected source blocks and persisting grouped history updates.
- NFM block side menu opens from the left drag handle or `Cmd/Ctrl+/` at the current block. Opening it promotes any active text selection that contains the target block into a visible block-level selection; otherwise it selects only the target block, so menu actions always advertise their block-level scope without opening the rich-text selection menu. The promoted scope includes selected blocks' descendant blocks; structural actions such as duplicate/delete/move operate on the top-level selected roots, while per-block actions such as color/type conversion apply across the expanded scope. Reopening the side menu on an already promoted block selection is idempotent and must not extend the scope to the next sibling. When the drag handle is used to move selected blocks into a new position, the editor reselects the dropped block range after insertion so follow-up block actions apply to the moved blocks. It renders a compact `265px` action dialog with search, listbox semantics, `200ms` opacity/scale entry motion, and the fixed action order `Turn into`, `Color`, `Copy link to block`, `Duplicate`, `Move to`, `Delete`, `Comment`, `Suggest edits`, `Present from here`, and `Ask AI`. The visible rows use Notion-style grouping separators after `Color`, `Delete`, `Suggest edits`, `Present from here`, and before the footer metadata. `Duplicate`, `Delete`, `Turn into`, `Color`, and `Move to` use existing BlockNote/Nodex editor operations when supported; unsupported reference actions stay visible but inert with `aria-disabled` so layout and keyboard affordances remain stable. `Card in` is also available from the `Turn into` submenu as a DB-only destination popover that creates cards from selected blocks, divider blocks can expose `Make thread section`, and table blocks can expose header row/column toggles.
- Side-menu handle dragging interprets a live text selection with block-level start-inclusive/end-exclusive bounds. If the selection ends exactly at the start of the next block, that next block is not part of the drag payload; if the selection has entered the next block's content, it is included. If the selection starts at the previous block's content end, the previous block remains included. Cross-parent text selections do not create custom mixed-parent payloads; instead, the editor drags the smallest common-level block range that fully covers the selected candidates. Examples: `blo<start>ck-0 / <end>block-1` dragged from `block-0` moves `{block-0}`, while `blo<start>ck-0 / b<end>lock-1` dragged from either selected handle moves `{block-0, block-1}`; `block-0<start> / blo<end>ck-1` also moves `{block-0, block-1}`; `block-0<start> / <end>block-1` moves only `{block-0}` when dragged from `block-0`. In a nested range `block-0 > block-02<start>, block-03 / <end>block-1`, dragging `block-02` or `block-03` moves `{block-02, block-03}`, while dragging `block-1` moves `{block-1}`; if the end enters `block-1`, dragging `block-02`, `block-03`, or `block-1` moves `{block-0, block-1}` so the dragged payload fully covers the text selection.
- Expanded rich-text selections in Card Stage and Toggle List NFM editors show a Notion-style floating text action menu instead of the compact formatting toolbar. The menu uses Nodex tokens while preserving the 192px popup hierarchy, block-type row, annotation grid, comment/reaction mock row, AI skills scroller, and AI prompt footer. Supported actions use existing BlockNote/Nodex editor paths for block conversion, bold/italic/underline/strike/code, clear format, and link creation/editing. The color button opens a 190px swatch-grid dialog with up to five app-wide persisted recent color slots plus text/background color grids; swatch clicks keep the dialog open, and clicking the active swatch clears that color back to default. Unsupported reference features such as equation, comment, reaction, and inline AI remain visible but inert with `aria-disabled`, while Card Stage editors can expose Nodex-specific Send section and a single `Move to` destination popover for DB/card targets in the skills area when callbacks are available. File, image, table, collapsed-cursor, and non-rich-text selections keep the compact legacy toolbar fallback; image/file toolbars anchor directly above the selected block and omit text-alignment controls because NFM does not persist that state.
- Drag handles, formatting toolbar, block selection
- Delete card action
- View history button opens an app-shell version-history modal for the currently open Card Stage card
- History modal supports operation filters, keyboard/list navigation, a full reconstructed snapshot preview for the selected version rendered through a read-only BlockNote/NFM surface, and entry-level detailed views (update before/after field diffs, move from/to columns, create/delete snapshots)

#### 8. Edit History & Undo/Redo
- Full edit history tracked in SQLite `history` table
- Session-scoped undo stacks (each renderer/browser tab has independent history)
- Keyboard shortcuts: `Cmd+Z` (undo), `Cmd+Shift+Z` (redo) — see `docs/KEYBOARD_SHORTCUTS.md` for full reference
- Operations tracked: create, update, delete, move
- Grouped undo/redo is supported via `history.group_id` so one undo can revert a multi-step atomic action (for example: block-drop import creates + source updates)
- Non-description fields use delta storage (only changed fields stored, not full snapshots)
- Card descriptions are stored outside `history` in a revision chain keyed by `cards.description_revision_id`; history rows only store description revision pointers
- Description revisions use top-level NFM block hashing plus ordered splice deltas, with periodic snapshot revisions to cap reconstruction work
- Full-card history checkpoints are stored internally in `card_history_snapshots` so retained visible history rows remain previewable and restorable after older rows are pruned
- Current builds do not support opening older pre-revision SQLite schemas in-app; recreate the local database if you need a fresh store on a newer build
- History modal is card-scoped (opened from Card Stage) and renders above the whole app shell with a per-card edit timeline, timestamps, a selected-version snapshot preview, and selectable detail panes for field diffs and snapshots
- The card history modal reads its timeline from `history:card` and lazily loads selected full-card snapshots from `history:card-version-preview`; update/move entries preview the card state immediately after the selected history entry, while delete entries preview the final state immediately before deletion
- Selected snapshot descriptions render with BlockNote in read-only mode to match the Card Stage NFM editor; live embeds such as card refs, thread sections, and inline toggle-list views appear as inert placeholders so historical previews do not fetch current board/thread state
- Description changes in the history panel render as top-level NFM block operations (`added`, `removed`, `replaced`) with per-block previews and optional raw block source, not hydrated whole-document before/after blobs
- Each description-delta entry also includes a default-collapsed full diff viewer so users can inspect the entire description state when the block summary is not enough
- Create/delete entries show description snapshots as ordered top-level block cards with previews and expandable block source
- History retention is configurable from Settings -> Backups; the value is a per-project count of visible `history` rows, `0` disables pruning, and internal checkpoint rows do not count against this limit
- If a retained legacy row predates checkpoint backfill and can no longer be reconstructed, the history modal keeps the row visible but marks restore/revert-to-snapshot actions unavailable
- History modal uses a fixed responsive two-pane layout instead of a persisted resizable side panel
- Detailed storage and migration rules for revision-based description history: [Description History Revisions](./description-history-revisions.md)
- **Revert single change**: Undo a specific history entry (update, move, create, or delete) — creates a new forward history entry so the revert is itself visible and reversible
- **Restore to point**: Time-travel a card to any retained reconstructable historical state by replaying from the nearest create/delete/checkpoint anchor plus forward deltas; applies field updates and column moves as needed
- Action buttons shown in entry detail view with inline confirmation flow; disabled for undo meta-entries
- Card stage auto-refreshes card state after history mutations via `onCardMutated` callback
- Global in-app toast notifications after undo/redo actions and other transient editor/review feedback

#### 9. Whole-Store Backups
- Manual backup creation via CLI/API (`kanban.db` + `assets/`)
- Automatic backups every 6 hours with retention of latest 28 auto backups
- Restore requires explicit confirmation and creates a pre-restore safety backup by default
- Backup artifacts are stored under `~/.nodex/backups/<backup-id>/` with a versioned `manifest.json`

#### 10. Canvas View (Excalidraw)
- Canvas tab provides a freeform whiteboard per project for card brainstorming and visual mapping.
- Scene persistence stores Excalidraw `elements`, `appState`, and `files` so embedded images survive reloads/project switches.
- Canvas payload supports image-heavy scenes up to 20 MB over HTTP transport.
- Canvas saves are flushed on page lifecycle transitions and during app-window close handshake to reduce lost edits when quitting.

#### 11. Calendar View
- Calendar tab shows scheduled cards in a day-grid timeline with Day, Week, custom Multi-Day, and custom Multi-Week ranges.
- The Calendar controls live in the View-stage global toolbar instead of a separate in-calendar toolbar; the compact primary month/year label sits beside the active Calendar selector, while the trailing cluster omits search/filter/sort/display chrome and shows create, range selector, and previous/today/next navigation.
- Multi-Day and Multi-Week range rows reveal inline `- number +` controls on hover/focus so users can adjust the actual custom span without leaving the menu.
- Calendar has a dedicated all-day lane above the timed grid, and all-day cards render only in that lane.
- Multi-day all-day cards render as one horizontal span across covered day columns using end-exclusive day range semantics.
- All-day lane overflow is vertical-scrollable.
- A draggable separator between all-day lane and timed grid resizes lane height; height preference persists per project and day-count view in localStorage.
- The separator is keyboard-accessible (`ArrowUp`/`ArrowDown` with `Home`/`End` bounds) and exposed as an ARIA horizontal separator.
- Timeline hour height auto-fits to available panel height with a minimum readable hour height.
- `Shift + mouse wheel` navigates the Calendar with immediate horizontal visual movement and a delayed commit: wheel deltas accumulate during the gesture, settle after a 500ms idle pause to the nearest day count, and can move across multiple days in one gesture.
- In Calendar view, `Shift + mouse wheel` is owned by the calendar grid while the calendar surface scope blocks stage switching, including from the calendar toolbar area.
- Users can drag existing calendar cards to move them across visible days and times while preserving duration.
- Calendar move-drag uses native drag lifecycle, so the drag ghost follows the pointer across the desktop (including when leaving the app window).
- Dragging supports timed/all-day conversion:
  - Timed -> all-day: sets `isAllDay=true`, snaps start to local midnight of target day, and preserves span as `ceil(duration/24h)` days (minimum 1).
  - All-day -> timed: sets `isAllDay=false`, drops at target slot time, preserves meaningful sub-day duration when available, otherwise uses 1 hour fallback.
- During an active drag move, target feedback is region-specific:
  - Timed target: source card stays ghosted at origin while a timed ghost preview is shown in-grid.
  - All-day target: source card stays ghosted at origin while an all-day ghost span appears in the all-day lane.
  - Outside calendar target: a cancel indicator appears and dropping does not change schedule.
- Side-by-side lane width is driven by peak simultaneous overlap within a connected overlap chain, so transitive-only neighbors do not create phantom extra lanes.
- Users can resize scheduled ranges by dragging the top or bottom edge of a calendar card; updates snap to 15-minute slots.
- Calendar rendering is occurrence-based (`calendar:occurrences`) so recurring cards expand into time-windowed event instances.
- Calendar event cards display a repeat indicator on occurrences derived from recurring cards, with a distinct icon for the first occurrence in each series.
- Card Stage exposes repeat settings (frequency, interval, weekly weekdays, inclusive end date), reminder offsets, and schedule timezone.
- Users can complete or skip a specific occurrence from Calendar quick actions and from Card Stage.
- Completing an occurrence creates a new snapshot card with status `done` and `archived=true`; archived events remain visible on Calendar with muted styling.
- Recurrence logs are not exposed in product UI or API.
- Occurrence schedule edits support scope: `this`, `this-and-future` (series split), and `all`.
- For recurring event drag/resize from Calendar, the app prompts with explicit scope choices before persisting. On the first occurrence in the current series, it shows `Only this occurrence` and `All occurrences`; on non-first occurrences, it shows `Only this occurrence` and `This and future`.
- Choosing `Only this occurrence` detaches that occurrence into a standalone non-recurring card while the original series skips that occurrence.
- Choosing `This and future` trims the original series to end the day before the selected occurrence and creates a new series from the selected occurrence onward; when selected on the first occurrence, it behaves like `All occurrences` (no split).
- For drag-based recurrence schedule moves (`All occurrences` and `This and future`), if the series has an inclusive end date (`untilDate`), that date shifts by the same calendar-day delta as the dragged occurrence so series length is preserved.
- Desktop reminders fire while the app is running, include startup/resume catch-up, and notification click deep-links to the target card Card Stage.

#### 12. Codex Threads (Electron-only in this phase)
- New threads are created from a card and linked immediately to that card.
- Thread creation requires the first user prompt and immediately starts the first turn.
- New threads auto-generate a concise title from the first user prompt through the main-process `generate-thread-title` host capability (`gpt-5.1-codex-mini`, reasoning effort `low`) unless an explicit thread name is provided.
- Auto-generated and manually renamed thread titles are cached in the host, replayed back to app-server after startup/reconnect, and rebroadcast to renderer through explicit `threadTitleUpdated` host messages so installed and dev builds share the same behavior.
- Thread stage always includes a persistent `New thread` tab.
- In Card Stage `Threads`, pressing `New` focuses the Thread stage `New thread` tab (no inline Card Stage prompt composer).
- The `New thread` tab shows the selected project/card context and uses the stage composer for the first prompt.
- Card `Run in` defaults to `Local project`, so new threads run in `runInLocalPath` (when set) or the project primary source.
- `New worktree` run target creates a managed Git worktree under `${serverDir}/worktrees/<rand4>/<project-id>` and links thread cwd to that worktree.
- For `New worktree`, first thread creation persists the managed worktree path on the card (`runInWorktreePath`), and subsequent new threads for that card reuse it.
- If the persisted managed worktree path is missing/invalid (for example deleted outside Nodex), thread start recreates a managed worktree and overwrites `runInWorktreePath`.
- For `New worktree` before first creation (no persisted `runInWorktreePath`), Card Stage shows an environment selector populated from `<workspace>/.codex/environments/*.toml`, with a `No environment` option and an `Environment settings` action that deep-links into the shared `Local environments` settings section for that project/config context.
- If `runInEnvironmentPath` is selected and points to a valid `.toml` file, Nodex reads the structured local-environment definition from Settings -> Local environments and runs its default `[setup].script` in the newly created managed worktree before `thread/start`.
- Environment setup failure aborts thread creation, does not persist `runInWorktreePath`, and best-effort removes the just-created managed worktree.
- During `New worktree` creation, the `New thread` panel shows a real-time setup log view (`Creating a worktree and running setup.`) with streamed progress from worktree creation and setup script output.
- Reusing an existing persisted `runInWorktreePath` does not re-run environment setup.
- Settings -> `Worktrees` shows managed inventory deduplicated by resolved worktree path (reused paths appear once).
- Settings -> `Worktrees` delete removes the managed directory (prefer `git worktree remove --force` when metadata is available, otherwise recursive delete) and unlinks all thread links that target the same managed path.
- Card Stage `Threads` row shows a `Reset worktree` control when reusing a persisted path; reset clears `runInWorktreePath` so the next thread creates a fresh managed worktree.
- Worktree base branch resolution order is: remote HEAD symbolic ref, then `main`, then `master`, then current branch, then first available local branch.
- Global worktree creation mode is configurable in Settings -> `Worktrees`: `Auto branch` (creates `<prefix><thread-slug>`; default prefix is `nodex/`, and thread slug is derived from the thread title by lowercasing, keeping the first 5 words, stripping non-`[a-z0-9]`, then joining with `-`) or `Detached HEAD` (default).
- `Cloud` run target is explicitly blocked in both renderer preflight and backend thread-start validation in this release.
- Sending from `New thread` creates the thread and switches focus to the newly created thread tab.
- Threads can navigate back to the owning card (`Open card`) from the Thread stage.
- Running threads keep syncing in the background when users switch to another thread tab; returning to the running tab preserves live state (including stop affordance and existing tool-call logs).
- Thread tabs show a running indicator for actively executing threads.
- Sidebar thread entries (and the Threads group icon) switch to a running indicator while execution is active.
- In-app account UX supports account read, ChatGPT/API-key login, login cancel, logout, and an authenticated quota indicator in the left sidebar footer. The footer indicator is a compact double ring: the outer ring shows the shorter window such as `5h` remaining, and the inner ring shows the weekly window remaining. Hovering or focusing the ring opens the existing account detail tooltip with email/plan, detailed remaining windows, reset timing when available, and sign-out; opening that tooltip refreshes account data. If authenticated rate-limit windows are unavailable, the footer shows a subdued connected indicator instead of percentages. Quota data also refreshes in the background every 60 seconds while the Codex connection is live and authenticated. Signed-out auth remains available from the thread header.
- Thread permissions are resolved from Codex app-server config (`config/read`) plus config requirements (`configRequirements/read`), not from renderer-local per-project preferences.
- Thread stage and Settings -> `Agent` expose the same preset-backed permission selector with the exact visible modes `Default permissions`, `Auto-review`, `Full access`, and `Custom (config.toml)`.
- Permission preset semantics:
  - `Default permissions` resolves to `sandbox_mode=workspace-write`, `approval_policy=on-request`, `approvals_reviewer=user`.
  - `Auto-review` resolves to the same sandbox/policy pair, but with `approvals_reviewer=auto_review`.
  - `Full access` resolves to `sandbox_mode=danger-full-access`, `approval_policy=never`, `approvals_reviewer=user`.
  - `Custom (config.toml)` remains visible whenever the effective raw config does not round-trip to a fixed preset.
- `features.guardian_approval` and `configRequirements/read.allowedApprovalsReviewers` are hard gates for `Auto-review`. When Auto-review is unavailable or `auto_review` is disallowed, any resolved automatic reviewer collapses back to `user`, the Auto-review preset is disabled/hidden from available modes, and the selector falls back to the nearest allowed non-Auto-review preset.
- Permission writes target the current config key origin when available; otherwise Nodex writes to the user config file instead of silently creating a project override from the thread footer.
- Settings -> `Agent` uses a split surface:
  - `Permissions modes` contains `Default permissions mode`.
  - `Custom config.toml settings` contains raw controls for `Approval policy`, `Sandbox settings`, `Allow network access`, and `config.toml`.
- New thread start, later turn start, queued follow-ups, and thread resume all inherit the same resolved `approvalPolicy`, `sandbox`, and `approvalsReviewer` values from the main-owned permission resolver.
- Approval requests stay attached to the underlying transcript items instead of opening a separate approval screen:
  - command approvals attach to existing exec rows
  - file approvals attach to existing file-change rows
  - automatic approval review rows use the synthetic item id form `automatic-approval-review:{targetItemId}`
- Thread stage composer exposes real Codex model and reasoning-effort selectors through one compact Intelligence footer control; the opened menu lists supported Intelligence options first, then Model and Speed flyouts, with selections persisted through the existing thread-settings and service-tier settings paths.
- Fast-mode core enablement is global, not per-thread. Detailed persistence, UI, request-resolution, queue-freezing, and reporting rules are defined in [Codex Fast Mode Core Enablement](./codex-fast-mode-core-enablement.md).
- New thread-start and turn-start requests inherit the persisted global `serviceTier` when callers do not provide one explicitly; explicit `null`/missing values normalize back to `standard` reporting and omit `serviceTier` from outgoing app-server payloads.
- Thread stage composer exposes collaboration mode presets (`Default`, `Plan`) sourced from app-server `collaborationMode/list` with a client fallback to `Default` + `Plan` when unavailable. Existing thread composers reflect `conversation.latestCollaborationMode` live, including mode changes applied by prompt `<agent-config />` chips; new-thread drafts reflect the selected draft mode until the thread is created.
- Collaboration mode selection is persisted locally per thread context (`thread:<threadId>`) and per new-thread draft context (`draft:<projectId>:<cardId>`), with draft selection migrated to the created thread after first-turn creation.
- Thread and turn start requests include `collaborationMode` when selected; `Plan` mode enables clarifying-question flows through `item/tool/requestUserInput`.
- Thread stage composer places the add-context menu and permission selector on the left side of the composer footer, while context usage, compact model/reasoning/speed, dictation, and send/stop controls sit on the right. The add-context menu uses a compact `+` trigger and contains `Add photos & files` (`Add photos` when images-only), optional `Include IDE context`, `Plan mode`, and optional `Plugins`; Speed remains only in Intelligence.
- Thread stage composer input is a ProseMirror-backed contenteditable prompt editor. Blank new-chat drafts show the `Do anything` placeholder, existing threads show `Ask for follow-up changes`, and dictation/attachment/send behavior uses the same normalized prompt flow as before.
- Typing a slash token at the start of the prompt or after whitespace opens a Codex-style slash-command menu above the composer. The menu uses grouped fuzzy filtering, preserves a keyboard-highlighted row, supports ArrowUp/ArrowDown/Enter/Escape, mouse hover/click selection, `No commands` empty state, and nested content panels for commands such as Model, Reasoning, Fork, Goal, MCP, Memories, Feedback, Project, and Personality. Direct commands clear the slash token before running; inline skill commands replace the slash token with the structured skill mention path. Context-conflicting Codex rows such as projectless Chat and hotkey-window commands remain hidden until their Nodex runtime path exists. Implementation evidence for the parity target is documented in `/Users/asc/repo/devtools-codex/codex_electron_26.608.12217_to_be_readable/.readable`.
- Thread stage composer shell uses static chrome: rounded input background, subtle ring, backdrop blur, and a fixed shallow shadow with no added focus-within elevation when the editor is active.
- Add-context picker non-image files become prompt mentions, picked images are read as data URLs and sent as image inputs, and picker attachments remain separate from paste/drop/Add-to-chat file provenance. Running-turn steer sends the same normalized prompt input shape as normal turns; unaccepted steers are restored as queued follow-ups if the active turn ends too early.
- Thread stage request cards replace the normal composer editor, attachments, add-context, permission, context, Intelligence, dictation, and send/stop footer controls while they are active. Existing-thread request cards do not render the new-chat-only lower status strip.
- Thread stage composer lower status row is a pre-start new-chat-only attached strip. It shows the selected project when available, the local run target (`Work locally`) or `Start in` selector, optional environment selection for `New worktree`, and the real Git branch for the selected primary source; once a conversation exists, existing-thread composers do not mount this lower row.
- Thread stage composer shows the context-window meter tooltip from the composer footer: unavailable data falls back to `0% used (100% left)`, ready data rounds token counts to whole thousands, usage below `50%` reads `{usage}% used ({remaining}% left)`, usage at or above `50%` reads `{usage}% full`, and the `Codex automatically compacts its context` line appears only for ChatGPT-authenticated sessions without an explicit `modelProvider`.
- Thread stage composer includes dictation as a separate buffered speech-to-text feature in Electron: the mic button is shown in supported ChatGPT-authenticated sessions, tooltip copy is `Click to dictate or hold`, `Ctrl+M` starts on keydown and stops on keyup with `insert`, button click starts recording, recordings shorter than `250ms` are discarded locally, and stop actions stay split between `Stop dictation` (`insert`) and `Transcribe and send` (`send`) before one `/transcribe` POST returns transcript text.
- Threads composer uses one round icon button: it sends when idle, shows a spinner immediately while the prompt send is pending, and switches to a stop icon while Codex is running so users can interrupt immediately.
- Threads composer send behavior defaults to `Enter` (with `Shift+Enter` for newline). Settings -> Editor exposes `Cmd/Ctrl+Enter to send long prompts`; when enabled, single-line drafts still submit on `Enter`, multiline drafts switch primary submit to `Cmd/Ctrl+Enter`, and running-thread alternate queue/steer submit moves to `Cmd/Ctrl+Shift+Enter`.
- Visible transcript semantics are defined in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md), including optimistic prompt rows, steering user-message acceptance and divider rows, request-user-input cards, plan follow-up flow, local file links in transcript markdown, reasoning/tool rendering, exploration coalescing, queue cleanup, and restart recovery consistency.
- Browser/HTTP transport returns explicit unsupported errors for `codex:*` methods in this release.

### Statuses

| Order | ID | Name | Purpose |
|---|-----|------|---------|
| 1 | draft | Draft | Early ideas, rough notes, and planning-stage tasks |
| 2 | backlog | Backlog | Refined tasks ready to queue up |
| 3 | in_progress | In Progress | Currently being worked on |
| 4 | in_review | In Review | Awaiting review or verification |
| 5 | done | Done | Finished work |

`archived` is an orthogonal internal flag. Archived cards are not rendered in the Kanban board, sidebar status groups, or toggle-list defaults.

---

## Technical Architecture

### Tech Stack
- **Desktop**: Electron with electron-vite (v5) + Vite 7
- **UI**: React 19, shadcn/ui, Tailwind CSS
- **Block Editor**: BlockNote (@blocknote/core, @blocknote/react, @blocknote/shadcn)
- **Description Format**: [Notion-flavored Markdown (NFM)](../references/notion-flavored-markdown-spec.md) with custom parser/serializer
- **HTTP Server**: Hono (embedded in main process)
- **HTTP Server Port**: Configurable via `[server].port` / `KANBAN_PORT` (default 51283)
- **Drag & Drop**: @atlaskit/pragmatic-drag-and-drop, @atlaskit/pragmatic-drag-and-drop-auto-scroll
- **Database**: better-sqlite3 (in main process)
- **Real-Time**: IPC events (Electron) / SSE (browser fallback)
- **Codex Runtime**: main-process `codex app-server --listen stdio://` JSON-RPC bridge
- **Transport**: Dual-mode — IPC when in Electron, HTTP fetch when in browser
- **Codex Transport**: Electron IPC only (browser runtime unsupported in this phase)
- **Package Manager**: Bun
- **Local Assets**: Uploaded images are stored under `~/.nodex/assets/` and served via flat asset HTTP routes
- **Backups**: Whole-store snapshots are stored under `~/.nodex/backups/<backup-id>/`

### Directory Structure
```
nodex/
├── bin/
│   └── nodex.mjs              # Unified CLI (server + agent + project commands)
├── skills/nodex-kanban/
│   └── SKILL.md                # Agent skill documentation
├── .github/
│   └── workflows/
│       └── release.yml         # CI/CD: build + publish on git tag push (v*)
├── ~/.nodex/                  # Default storage directory
│   ├── kanban.db               # SQLite database
│   ├── kanban.db-wal           # Write-ahead log
│   ├── assets/                 # Uploaded images
│   └── backups/                # Whole-store backup snapshots (db + assets)
├── electron.vite.config.ts     # electron-vite config (main, preload, renderer)
├── electron-builder.yml        # Electron packaging + signing + publish config
├── homebrew-cask-template.rb   # Generated local mirror of the Homebrew tap cask layout
├── resources/
│   ├── icon.icns               # macOS app icon
│   ├── icon.png                # PNG app icon
│   └── entitlements.mac.plist  # macOS hardened runtime entitlements
├── scripts/
│   └── generate-homebrew-cask.ts # Generates the tap cask pushed to junyudev/homebrew-tap
├── src/
│   ├── shared/
│   │   ├── types.ts            # Shared TypeScript types (Card, Board, Project, etc.)
│   │   ├── ipc-api.ts          # Type-safe IPC channel map (IpcApi, IpcEvents)
│   │   ├── assets.ts           # Shared asset URI helpers (nodex://assets/...)
│   │   └── card-limits.ts      # Shared card payload/field size limits
│   ├── main/                   # Electron main process
│   │   ├── bootstrap.ts        # Early Electron lifecycle, profile lock, dynamic runtime import
│   │   ├── main-runtime.ts     # BrowserWindow, IPC registration, HTTP server
│   │   ├── ipc-handlers.ts     # ipcMain.handle() registrations
│   │   ├── http-server.ts      # Hono HTTP server (configured port) for CLI + browser
│   │   └── kanban/
│   │       ├── config.ts       # Configuration (KANBAN_DIR + backup env)
│   │       ├── asset-service.ts # Image upload/storage/read helpers
│   │       ├── backup-service.ts # Backup create/list/restore + auto scheduler
│   │       ├── card-input-validation.ts # Card write validation across HTTP + IPC
│   │       ├── db-service.ts   # SQLite CRUD (projects + cards)
│   │       ├── db-notifier.ts  # EventEmitter for changes
│   │       ├── schema.ts       # Latest database schema bootstrap + version guard
│   │       └── history-service.ts  # History tracking logic
│   ├── preload/
│   │   └── index.ts            # contextBridge: exposes window.api (invoke, on, serverUrl, assetPathPrefix)
│   └── renderer/               # React SPA (Vite dev server on port 51284)
│       ├── index.html          # HTML entry
│       ├── main.tsx            # React root
│       ├── app.tsx             # Workbench shell orchestration
│       ├── components/workbench/ # Project/session shell, split panel groups, tab strips, DB/Card/terminal wrappers, settings shells
│       ├── env.d.ts            # Window.api type declaration
│       ├── components/
│       │   ├── kanban/
│       │   │   ├── board.tsx              # DnD context, layout, undo/redo
│       │   │   ├── column.tsx             # Column with droppable
│       │   │   ├── card.tsx               # Draggable card
│       │   │   ├── card-dialog.tsx        # Card creation dialog
│       │   │   ├── inline-card-creator.tsx
│       │   │   ├── list-view.tsx          # Table view of all cards
│       │   │   ├── toggle-list-view.tsx   # Rule-driven toggle editor view of cards
│       │   │   ├── project-switcher.tsx   # Radix Popover project dropdown
│       │   │   ├── card-stage.tsx          # Card editor panel
│       │   │   ├── nfm-renderer.tsx       # Read-only NFM block renderer
│       │   │   ├── history-panel.tsx      # Card edit history timeline
│       │   ├── ui/
│       │   │   ├── toast.tsx              # Global renderer toast system
│       │   │   └── editor/
│       │   │       ├── nfm-editor.tsx     # BlockNote-based NFM editor
│       │   │       ├── nfm-editor-extensions.ts # Shared BlockNote extension/paste setup
│       │   │       ├── nfm-slash-menu.tsx # Shared slash-menu controller (defaults + custom items)
│       │   │       ├── nfm-formatting-toolbar.tsx # Shared formatting toolbar composition
│       │   │       ├── callout-block.tsx  # Shared custom callout block spec (used by multiple schemas)
│       │   │       ├── card-toggle-block.tsx # Custom BlockNote card row toggle block
│       │   │       ├── toggle-list-inline-view-block.tsx # Custom inline embed block for project toggle-list view
│       │   │       ├── toggle-list-card-editor.tsx # Toggle List tab card-toggle editor core
│       │   │       ├── projection-card-toggle.ts # Shared projection helpers for inline embeds
│       │   │       ├── projection-sync-controller.ts # Per-editor projection owner registry + shared listeners/flush pipeline
│       │   │       ├── use-projected-card-embed-sync.ts # Registration facade for projection sync + helper exports
│       │   │       ├── copy-image.ts      # Clipboard helpers for image block copy action
│       │   │       ├── copy-image-button.tsx # Custom image floating toolbar action
│       │   │       ├── search-extension.ts # ProseMirror decoration plugin for in-editor find
│       │   │       ├── notion-paste.ts    # Notion clipboard parser + paste insertion helpers
│       │   │       ├── toggle-backspace.ts # Toggle child Backspace merge handler
│       │   │       ├── toggle-enter.ts    # Toggle child Enter handlers (enter-to-child, empty-enter)
│       │   │       ├── nfm-schema.tsx     # Custom BlockNote schema (callout + toggleListInlineView)
│       │   │       ├── toggle-list-schema.ts # Toggle-list BlockNote schema (cardToggle + toggleListInlineView)
│       │   │       └── use-editor-drag-behaviors.ts # Shared drag-state + toggle-drop editor wiring
│       │   └── ui/                        # shadcn/ui components
│       └── lib/
│           ├── api.ts            # Transport abstraction (IPC or HTTP fetch)
│           ├── assets.ts         # Image upload + asset URI resolution helpers
│           ├── http-base.ts      # Runtime HTTP base resolver (Electron serverUrl / browser origin)
│           ├── card-search.ts    # Shared token search helpers for kanban/list filtering
│           ├── kanban-store.ts   # Per-project shared board store + realtime/fetch dedupe + cardIndex
│           ├── use-toggle-list-settings.ts # Per-project persisted toggle-list rules/settings
│           ├── types.ts          # Re-exports from ../../shared/types
│           ├── utils.ts          # cn() helper
│           ├── nfm/              # Notion-flavored Markdown library
│           │   ├── types.ts      # NfmBlock, NfmInlineContent, NfmColor types
│           │   ├── parser.ts     # parseNfm(string) → NfmBlock[]
│           │   ├── parser-inline.ts   # Inline rich text parser
│           │   ├── serializer.ts      # serializeNfm(NfmBlock[]) → string
│           │   ├── serializer-inline.ts # Inline rich text serializer
│           │   ├── blocknote-adapter.ts # NFM ↔ BlockNote block converter
│           │   ├── extract-text.ts    # Plain text extraction for previews
│           │   └── index.ts           # Barrel exports
│           ├── toggle-list/      # Toggle-list view rules + mapping + sync helpers
│           │   ├── types.ts
│           │   ├── settings.ts
│           │   ├── rules.ts
│           │   ├── meta.ts
│           │   ├── meta-chips.ts
│           │   ├── inline-view-props.ts
│           │   ├── block-mapping.ts
│           │   └── sync.ts
│           ├── use-kanban.ts     # React hook for board state
│           ├── use-history.ts    # React hook for undo/redo
│           ├── use-projects.ts   # React hook for project CRUD
│           ├── use-keyboard-shortcuts.ts # Undo/redo shortcut handler
│           └── use-workbench-shortcuts.ts # Workbench navigation shortcut handler
├── out/                        # Build output (electron-vite build)
│   ├── main/bootstrap.js
│   ├── main/main-runtime-*.js
│   ├── preload/index.js
│   └── renderer/
├── dist/                       # Packaging output (electron-builder)
│   ├── Nodex-*-arm64.dmg       # Notarized Apple Silicon installer
│   ├── Nodex-*-arm64.zip       # Apple Silicon ZIP companion artifact
│   ├── Nodex-*-x64.dmg         # Notarized Intel installer
│   └── Nodex-*-x64.zip         # Intel ZIP companion artifact
└── package.json
```

### API Endpoints

#### Backup Routes (global)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backups` | List all backups (newest first) |
| POST | `/api/backups` | Create manual backup (body: `{label?}`) |
| POST | `/api/backups/[backupId]/restore` | Restore whole-store backup (body: `{confirm: true, createSafetyBackup?}`) |

#### Project Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project (body: `{name?, description?, icon?, sources?}` where `icon` is an optional emoji and the canonical ID is generated server-side) |
| PUT | `/api/projects/order` | Reorder normal project groups (body: `{orderedProjectIds}`) |
| PUT | `/api/projects/pinned-order` | Reorder pinned project groups (body: `{orderedProjectIds}`) |
| GET | `/api/projects/events` | SSE stream for project list, project order, and project pin changes |
| GET | `/api/projects/[projectId]` | Get project details; `[projectId]` may be a UUID or retained legacy alias |
| PUT | `/api/projects/[projectId]` | Update project display fields and sources (body: `{name?, description?, icon?, sources?}`); ID changes are rejected |
| PUT | `/api/projects/[projectId]/pinned` | Pin or unpin a project group (body: `{pinned}`) |
| DELETE | `/api/projects/[projectId]` | Delete project (cascades cards + history) |

#### Project Session Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/sessions` | Fetch a project's ordered session tree with tabs and optional attached thread metadata (`?includeArchived=true` includes archived sessions) |
| POST | `/api/projects/[projectId]/sessions` | Create a project-owned session (body: `{title}`) |
| PUT | `/api/projects/[projectId]/sessions/reorder` | Reorder sessions (body: `{orderedSessionIds}`) |
| PUT | `/api/projects/[projectId]/sessions/pinned-order` | Reorder pinned sessions inside the project (body: `{orderedSessionIds}`) |
| PUT | `/api/project-sessions/[sessionId]` | Update session title or left-pane state |
| PUT | `/api/project-sessions/[sessionId]/rename` | Rename a non-Overview session using manual chat-title sanitization (body: `{title}`); whitespace-only input is a no-op |
| PUT | `/api/project-sessions/[sessionId]/pinned` | Pin or unpin a non-Overview session (body: `{pinned}`) |
| PUT | `/api/project-sessions/[sessionId]/archive` | Archive a non-Overview session and linked Codex thread when attached |
| PUT | `/api/project-sessions/[sessionId]/unarchive` | Unarchive a non-Overview session and linked Codex thread when attached |
| PUT | `/api/project-sessions/[sessionId]/unread` | Mark a non-Overview session read/unread (body: `{unread}`) |
| POST | `/api/project-sessions/[sessionId]/fork` | Fork an attached session thread into a new project session (body: `{target: "local" \| "newWorktree", turnId?, message?, collaborationMode?}`) |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]` | Update a `right` or `bottom` panel's collapsed state, layout, or size |
| POST | `/api/project-sessions/[sessionId]/panels/[panelId]/split` | Split a panel group left/right/up/down, optionally moving a selected tab into the new group |
| POST | `/api/project-sessions/[sessionId]/panels/[panelId]/merge` | Close or merge a panel group; non-empty groups merge tabs into the nearest visual neighbor first |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/active-group` | Activate a panel group and optionally one tab in that group |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/resize-group` | Persist a split branch sash ratio |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/maximized-group` | Set or clear the temporarily maximized panel group |
| DELETE | `/api/project-sessions/[sessionId]` | Delete a non-Overview session |
| POST | `/api/project-sessions/[sessionId]/tabs` | Create a session tab (body: `{projectId, panelId, clientTabId?, kind, title, config}`) |
| PUT | `/api/project-session-tabs/[tabId]` | Update a session tab title or validated config |
| PUT | `/api/project-session-tabs/[tabId]/state` | Update a tab state key/value pair |
| PUT | `/api/project-session-tabs/[tabId]/move` | Move a tab between panels, target leaves, or a split target; optional `preserveEmptyLeafIds` keeps renderer-local visible leaves alive |
| DELETE | `/api/project-session-tabs/[tabId]` | Delete a session tab; optional `preserveEmptyLeafIds` keeps renderer-local visible leaves alive |
| PUT | `/api/project-sessions/[sessionId]/tabs/reorder` | Reorder tabs in one panel leaf (body: `{panelId, leafId?, orderedTabIds}`) |
| PUT | `/api/project-sessions/[sessionId]/thread` | Attach or update a session-owned thread link |
| DELETE | `/api/project-sessions/[sessionId]/thread` | Detach the session-owned thread link |

#### Board Routes (project-scoped)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/board` | Fetch all columns and cards |
| POST | `/api/projects/[projectId]/board` | Create new card (request body capped at 2MB; oversized requests return 413; optional `id` must already be a canonical lowercase UUID-v7 or the server generates one) |
| GET | `/api/projects/[projectId]/column` | Fetch a single board status group (query: `?id=<status>`) |
| GET | `/api/projects/[projectId]/card` | Fetch single card (query: `?cardId=Y` or `?status=X&cardId=Y`) |
| PUT | `/api/projects/[projectId]/card` | Update card properties (`status` optional and server-resolved when omitted; optional `expectedRevision` enables stale-write detection; stale writes return `409` with `{status:\"conflict\", card}`; request body capped at 2MB; oversized requests return 413) |
| DELETE | `/api/projects/[projectId]/card` | Delete card (query: `?cardId=Y` or `?status=X&cardId=Y`, optional `&sessionId=Z`) |
| GET | `/api/projects/[projectId]/calendar/occurrences` | List calendar occurrences in a time window (`?start=ISO&end=ISO&search=...`) |
| POST | `/api/projects/[projectId]/card-occurrence/complete` | Complete one occurrence (body: `{cardId, occurrenceStart, source, sessionId?}`) |
| POST | `/api/projects/[projectId]/card-occurrence/skip` | Skip one occurrence (body: `{cardId, occurrenceStart, source, sessionId?}`) |
| PUT | `/api/projects/[projectId]/card-occurrence` | Update occurrence timing with scope (body: `{cardId, occurrenceStart, scope, updates, sessionId?}`) |
| PUT | `/api/projects/[projectId]/move` | Move card between statuses (`fromStatus` optional — server resolves; when provided, returns 409 if card not in expected status; supports optional `newOrder`; omit to append to end) |
| POST | `/api/projects/[projectId]/card-import-block-drop` | Atomic block-drop import: source updates + target card creates in one grouped transaction |
| GET | `/api/projects/[projectId]/events` | SSE stream for real-time updates |
| GET | `/api/projects/[projectId]/history` | List recent history (query: `?limit=N&offset=N&sessionId=Z`) |
| GET | `/api/projects/[projectId]/history/card` | Card-specific history (query: `?cardId=X`) |
| GET | `/api/projects/[projectId]/history/card-version-preview` | Reconstructed card snapshot for a history entry (query: `?cardId=X&historyId=N`) |
| POST | `/api/projects/[projectId]/history/revert` | Revert a single history entry (body: `{historyId, sessionId?}`) |
| POST | `/api/projects/[projectId]/history/restore` | Restore card to historical state (body: `{cardId, historyId, sessionId?}`) |
| POST | `/api/projects/[projectId]/undo` | Undo last operation |
| POST | `/api/projects/[projectId]/redo` | Redo last undone |
| POST | `/api/projects/[projectId]/query` | Execute read-only SQL query |
| GET | `/api/projects/[projectId]/schema` | Get database schema |

#### Asset Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/assets/images` | Upload image via multipart `file`; returns `{source}` with canonical `nodex://assets/<file-name>` URI |
| POST | `/api/assets/resources` | Upload or materialize pasted text/files/folders; accepts multipart `file` or JSON `{localPath}` and returns `{source, name, mimeType, bytes}` |
| GET | `/api/assets/[fileName]` | Serve asset bytes for editor/read-only rendering |

### Database Schema

```sql
-- Current schema (simplified excerpt)

-- Projects table
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- opaque UUID generated by the main process
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',    -- optional project emoji icon
  created TEXT NOT NULL,            -- ISO datetime
  updated TEXT NOT NULL             -- ISO datetime
);

CREATE TABLE project_sources (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root TEXT NOT NULL,               -- absolute source folder
  root_key TEXT NOT NULL,           -- normalized dedupe key
  "order" INTEGER NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (project_id, root_key)
);

CREATE TABLE project_order (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  updated TEXT NOT NULL
);

CREATE TABLE pinned_project_order (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  updated TEXT NOT NULL
);

-- Project sessions and session tabs
CREATE TABLE project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,              -- max 2,000 chars
  is_overview INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
  panel_state_json TEXT NOT NULL,   -- right/bottom state; v2 split layout owns leaf membership
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_session_tabs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  panel_id TEXT NOT NULL,           -- right | bottom; flat compatibility owner
  kind TEXT NOT NULL,               -- db_view | card_stage | terminal | browser | review | files
  title TEXT NOT NULL,
  config_json TEXT NOT NULL,
  state_key INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  "order" INTEGER NOT NULL,         -- flat compatibility order derived from layout leaves
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_session_threads (
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
);

-- Cards table
CREATE TABLE cards (
  id TEXT PRIMARY KEY,              -- canonical lowercase UUID-v7
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,             -- draft | backlog | in_progress | in_review | done
  archived INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  description_revision_id INTEGER,  -- latest materialized description revision
  priority TEXT,                    -- nullable priority tier
  estimate TEXT,                    -- nullable: xs, s, m, l, xl
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
  due_date TEXT,                    -- YYYY-MM-DD
  assignee TEXT,
  agent_blocked INTEGER NOT NULL DEFAULT 0,
  agent_status TEXT,
  run_in_target TEXT NOT NULL DEFAULT 'local_project',
  run_in_local_path TEXT,
  run_in_base_branch TEXT,
  run_in_worktree_path TEXT,
  run_in_environment_path TEXT,
  created TEXT NOT NULL,            -- ISO datetime
  "order" INTEGER NOT NULL          -- position within (project_id, archived, status)
);

CREATE INDEX idx_cards_project_archived_status_order ON cards(project_id, archived, status, "order");

CREATE TABLE description_blocks (
  hash TEXT PRIMARY KEY,
  content TEXT NOT NULL,            -- canonical serialized top-level NFM block
  created_at TEXT NOT NULL
);

CREATE TABLE description_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  parent_revision_id INTEGER,
  kind TEXT NOT NULL,               -- 'snapshot' | 'delta'
  block_hashes_json TEXT,           -- snapshot only
  ops_json TEXT,                    -- delta only
  created_at TEXT NOT NULL,
  CHECK (kind IN ('snapshot', 'delta'))
);

-- History table
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,          -- 'create', 'update', 'delete', 'move'
  card_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL,          -- ISO 8601
  previous_values TEXT,             -- JSON: changed fields before
  new_values TEXT,                  -- JSON: changed fields after
  from_status TEXT,                 -- move only
  to_status TEXT,                   -- move only
  from_archived INTEGER,            -- move only
  to_archived INTEGER,              -- move only
  from_order INTEGER,               -- move only
  to_order INTEGER,                 -- move only
  card_snapshot TEXT,               -- JSON: full card for create/delete
  previous_description_revision_id INTEGER,
  new_description_revision_id INTEGER,
  snapshot_description_revision_id INTEGER,
  session_id TEXT,                  -- browser session UUID
  group_id TEXT,                    -- grouped action UUID
  is_undone INTEGER NOT NULL DEFAULT 0,
  undo_of INTEGER,                  -- links to undone entry
  CHECK (operation IN ('create', 'update', 'delete', 'move'))
);

CREATE INDEX idx_history_project ON history(project_id);
CREATE INDEX idx_history_card ON history(card_id);
CREATE INDEX idx_history_timestamp ON history(timestamp DESC);
CREATE INDEX idx_history_session ON history(session_id);
CREATE INDEX idx_history_group ON history(project_id, group_id);

-- Internal full-card checkpoints for retained card history reconstruction
CREATE TABLE card_history_snapshots (
  history_id INTEGER PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  status TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  card_snapshot TEXT NOT NULL,      -- JSON: full card except raw description
  description_revision_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_card_history_snapshots_project_card_history
  ON card_history_snapshots(project_id, card_id, history_id);

-- Codex thread metadata and optional card ownership
CREATE TABLE codex_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  parent_thread_id TEXT,
  thread_name TEXT,
  thread_preview TEXT NOT NULL DEFAULT '',
  model_provider TEXT NOT NULL DEFAULT '',
  cwd TEXT,
  status_type TEXT NOT NULL DEFAULT 'notLoaded',
  status_active_flags_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_codex_threads_project_updated
  ON codex_threads(project_id, updated_at DESC);
CREATE INDEX idx_codex_threads_card_updated
  ON codex_threads(card_id, updated_at DESC);

CREATE TABLE codex_thread_card_links (
  thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_codex_thread_card_links_project_card
  ON codex_thread_card_links(project_id, card_id);
```

### Real-Time Sync Flow

**Electron path (IPC):**
```
Database Write → EventEmitter (notifier) → mainWindow.webContents.send()
    → window.api.on("board-changed") → useKanban hook → UI re-renders
```

**Browser path (HTTP + SSE):**
```
Database Write → EventEmitter (notifier) → SSE push (Hono /events endpoint)
    → EventSource listener → useKanban hook → UI re-renders
```

The transport layer (`src/renderer/lib/api.ts`) auto-detects the runtime and uses the appropriate path. In Electron, renderer HTTP routes resolve from a preload-injected server URL; in browser mode they resolve from same-origin (with localhost Vite dev fallback to default API port `51283`). Board and session SSE events are scoped per project; project-list/order/pin changes use the global `/api/projects/events` stream.

Codex Threads emit a separate Electron IPC stream (`codex:event`) from the main-process Codex domain service; browser mode intentionally does not support this transport in this phase.

---

## CLI Reference

The `nodex` binary serves two roles: starting the server and running agent commands.

### Server Commands

```bash
nodex                            # Start server with defaults
nodex serve [path] [-p port]     # Explicit server start
nodex serve --dev                # Development mode
```

Server options:
- `[kanban-path]` - Path to kanban directory (default: `~/.nodex`)
- `-p, --port <port>` - Port to run on (default: 51283)
- `--dev` - Run in development mode with hot reload

### Project Commands

```bash
nodex projects                          # List all projects
nodex projects add <id> <name>          # Create a project
nodex projects mv <old-id> <new-id>     # Rename a project (updates all references)
nodex projects rm <id>                  # Delete a project (and all its data)
```

### Config Commands

```bash
nodex config                     # Edit config interactively
nodex config show                # Show resolved config with sources
nodex config show --json         # JSON output
```

### Agent Commands

```bash
nodex ls [column]                # List cards (all or by column)
nodex get <card-id>              # Get card details (auto-resolves column)
nodex add <column> <title>       # Create card
nodex update <card-id> [opts]    # Update card (minimal output; -v for full details)
nodex rm <card-id>               # Delete card (auto-resolves column)
nodex mv <card-id> <from> <to> [order] [opts] # Move card (atomic claim)
nodex history [--card <id>]      # View edit history
nodex undo                       # Undo last operation
nodex redo                       # Redo last undone
nodex query "<sql>" [params...]  # Run read-only SQL query
nodex schema                     # Show database schema
nodex backups [subcommand]       # List/create/restore backups
# Aliases: list/show/create/remove/delete/move/hist
```

Agent command options:
- `-p, --project <id>` - Project to operate on (default: "default")
- `--url <url>` - Server URL override
- `--session-id <id>` - Session ID for undo/redo tracking
- `--jsonl` - Output JSON Lines (default)
- `--json` - Output JSON array/object
- `--csv` - Output CSV
- `--pretty` - Pretty-print JSON output (use with `--json`)
- `--table` - Output aligned plain-text tables
- `-v, --verbose` - Verbose output (e.g. full card details after update)
- `-d, --description <text>` - Card description (supports `@file` / `@-` for stdin)
- `-P, --priority <p>` - Priority level
- `-e, --estimate <e>` - Size estimate
- `-t, --tags <t1,t2>` - Comma-separated tags
- `-a, --assignee <name>` - Assignee
- `--yes` - Required confirmation flag for destructive backup restore
- `--no-safety-backup` - Skip automatic pre-restore safety backup
- `--label <text>` - Optional backup label for `nodex backups create`
- `--clear-description` - Clear description (update/mv)
- `--clear-tags` - Clear tags (update/mv)
- `--clear-assignee` - Clear assignee (update/mv)
- `--clear-due` - Clear due date (update/mv)
- `--clear-agent-status` - Clear agent status (update/mv)
- `--no-agent-blocked` - Clear blocked state (update/mv)
- `--full` - Include full card fields in `ls`
- `--description-chars <n>` - Truncate `ls --full` descriptions to `n` chars (default: 240)
- `--description-full` - Include full description in `ls --full`

CLI parsing is strict: unknown options and invalid enum/date values fail fast with actionable errors.

Status args accept canonical ids plus ergonomic separator aliases such as `in-progress` -> `in_progress` and `in-review` -> `in_review`.

### Backup Commands

```bash
nodex backups                                   # List backups
nodex backups create [--label <text>]           # Create manual backup
nodex backups restore <backup-id> --yes         # Restore backup with safety backup
nodex backups restore <backup-id> --yes --no-safety-backup
```

### File/Stdin Input

Text fields (`--description`, `--agent-status`, `--title`) support reading from files or stdin:

```bash
nodex add backlog "Task" -d @./plan.md        # Read from file
cat spec.md | nodex add backlog "Task" -d @-  # Read from stdin
```

---

## Configuration

### Config File: `.nodex/config.toml`

TOML config for both agent and server settings. Resolution order (later wins):
1. Defaults
2. `~/.nodex/config.toml` (user-level, auto-generated if no config exists)
3. `.nodex/config.toml` walked up from CWD (project-level overrides user-level)
4. Env vars: `NODEX_*` for agent, `KANBAN_*` for server
5. CLI flags: `--url`, `--session-id`, `--project`, `--port`, `[path]`

```toml
# .nodex/config.toml
url = "http://localhost:51283"
session_id = "my-agent"
project = "default"

[server]
dir = "~/.nodex"
port = 51283
backup_auto_enabled = false
backup_interval_hours = 6
backup_retention = 28
history_retention = 1000
```

**Dev/production separation**: Use project-level `.nodex/config.toml` for dev settings (different port/dir) and `~/.nodex/config.toml` for production. When running `nodex --dev` from a project directory, the project-level config takes priority. When the Electron app is launched directly (e.g., from Dock), only `~/.nodex/config.toml` is read.

**Electron renderer API base resolution**: Main process resolves server port from the same config chain (`config.toml` + env), starts HTTP server on that port, and injects `serverUrl` through preload. Renderer HTTP helpers (including image upload and asset URL resolution) consume this runtime URL so `[server].port` changes are honored; browser mode uses same-origin except local Vite dev (`:51284`) which falls back to default API port (`:51283`).

### Server Environment Variables
```bash
KANBAN_DIR=~/.nodex     # Kanban directory (default: ~/.nodex)
KANBAN_PORT=51283        # Port (default: 51283)
KANBAN_BACKUP_AUTO_ENABLED=false   # Enable auto backups (default: false)
KANBAN_BACKUP_INTERVAL_HOURS=6    # Auto backup interval in hours (default: 6)
KANBAN_BACKUP_RETENTION=28        # Auto backup retention count (default: 28)
KANBAN_HISTORY_RETENTION=1000    # Max history entries per project (default: 1000, 0 = unlimited)
NODEX_SENTRY_ENABLED=false       # Enable opt-in Sentry diagnostics (default: false)
SENTRY_DSN=...                   # Override the Sentry DSN
SENTRY_ENVIRONMENT=production    # Override diagnostics environment
SENTRY_RELEASE=nodex@0.1.10      # Override diagnostics release
NODEX_SENTRY_TRACES_SAMPLE_RATE=0 # Performance trace sample rate, 0..1
NODEX_SENTRY_REPLAY_ENABLED=false # Enable opt-in renderer Session Replay (default: false)
NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1 # Full-session replay sample rate, 0..1
NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1 # Error-session replay sample rate, 0..1
NODEX_TELEMETRY_ENABLED=false     # Enable opt-in Statsig product telemetry (default: false)
STATSIG_CLIENT_KEY=client-wpoc5Yx721NAMgJde6jcWUTiEP9kp2Ll9nr4EUxdmiP # Override Statsig client key
STATSIG_ENVIRONMENT=production    # Override Statsig environment
NODEX_TELEMETRY_AUTOCAPTURE_ENABLED=false # Enable filtered Statsig web analytics (default: false)
```

These can also be set via the `[server]` section in config.toml. Env vars override TOML values.

In the desktop app, Settings -> Backups updates `~/.nodex/config.toml` `[server]` backup fields and reapplies the auto-backup scheduler immediately. If `KANBAN_BACKUP_*` environment variables are set, those values remain effective and the UI marks the overridden fields.

In the desktop app, Settings -> General -> `App updates` updates the user-level `~/.nodex/config.toml` `[server].app_updates_auto_check_enabled` flag. Browser mode and unpackaged/non-macOS runtimes report updater support as unavailable and do not perform background checks.

In the desktop app, Settings -> General -> `Diagnostics` updates user-level `[server]` fields for `diagnostics_enabled`, `diagnostics_dsn`, `diagnostics_environment`, `diagnostics_traces_sample_rate`, `diagnostics_replay_enabled`, `diagnostics_replays_session_sample_rate`, and `diagnostics_replays_on_error_sample_rate`. Diagnostics and Session Replay are disabled by default; Replay is a separate renderer-only opt-in that only runs when crash diagnostics are also enabled. When diagnostics are enabled without an explicit DSN, Nodex uses its bundled Sentry project DSN. Env overrides win and the UI disables overridden controls.

In the desktop app, Settings -> General -> `Telemetry` updates user-level `[server]` fields for `telemetry_enabled`, `telemetry_client_key`, `telemetry_environment`, and `telemetry_auto_capture_enabled`. Product telemetry and web analytics are disabled by default, and settings changes apply after restart. When telemetry is enabled without an explicit client key, Nodex uses its bundled Statsig client key. The renderer dynamically loads Statsig only when telemetry is enabled, passes no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. `Share web analytics` is a separate opt-in that only runs when product telemetry is enabled; it disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical signals such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events remain blocked by default. Nodex does not use Statsig Session Replay in v1; renderer replay remains the separate Sentry diagnostic opt-in.

### Agent Environment Variables
```bash
NODEX_URL=http://localhost:51283
NODEX_SESSION_ID=my-agent
NODEX_PROJECT=default
```

Environment variables can be passed directly. CLI arguments take precedence.

### Development
```bash
bun install
bun run dev              # electron-vite dev (renderer on :51284, HTTP API on :51283)
```

### Production
```bash
bun run build            # electron-vite build → out/
electron .               # runs package main: out/main/bootstrap.js
```

### Packaging & Release
```bash
bun run package          # Build + create macOS DMG + ZIP in dist/
```

To release a new version, use the GitHub Actions `Prepare Release` workflow:
```bash
# 1. Update CHANGELOG.md under ## [Unreleased]
# 2. Trigger "Prepare Release" in GitHub Actions or from the CLI:
gh workflow run "Prepare Release" \
  --repo junyudev/nodex \
  -f release_type=patch
# 3. The workflow runs typecheck/lint/tests, prepares an unpushed release
#    candidate, and signs/notarizes arm64 + x64 builds from that candidate.
# 4. Only after both macOS builds pass does it commit, tag, push, publish the
#    GitHub Release, and update junyudev/homebrew-tap.
```

Detailed CI behavior, job responsibilities, secrets, artifact naming, and recovery steps live in `docs/release-macos.md`.

---

## Agent Integration

### Design: CLI + REST API

Agents use the **`nodex` CLI** for all board operations. The CLI wraps the REST API with ergonomic commands, strict option/value validation, auto-column-resolution, and config file support. The REST API remains available for direct HTTP access.

### How Agents Use the Board

```bash
# 1. Read backlog tasks (uses default project, or set --project)
nodex ls backlog

# 2. Claim a task atomically (fails if another agent already claimed it)
nodex mv abc1234 backlog in-progress --agent-status "Starting work..."

# 3. Update status while working
nodex update abc1234 --agent-status "Running tests..."

# 4. Mark as blocked if stuck
nodex update abc1234 --agent-blocked --agent-status "Blocked: Need API credentials"

# 5. Complete task - move to review
nodex mv abc1234 in-progress in-review --agent-status "Ready for review"

# Working with a specific project
nodex --project my-app ls backlog
nodex --project my-app add backlog "New feature"

# Create a manual safety snapshot before risky changes
nodex backups create --label "before release refactor"

# Restore full board state (db + assets)
nodex backups restore <backup-id> --yes
```

### CLI vs REST API

| Action | CLI Command | REST API |
|--------|------------|----------|
| List projects | `nodex projects` | GET `/api/projects` |
| Create project | `nodex projects add <id> <name>` | POST `/api/projects` |
| Rename project | `nodex projects mv <old> <new>` | PUT `/api/projects/[projectId]` |
| Delete project | `nodex projects rm <id>` | DELETE `/api/projects/[projectId]` |
| List cards | `nodex ls [status]` | GET `/api/projects/[projectId]/board` |
| Get card | `nodex get <id>` | GET `/api/projects/[projectId]/card?cardId=Y` |
| Create card | `nodex add <status> <title>` | POST `/api/projects/[projectId]/board` |
| Update card | `nodex update <id> [opts]` | PUT `/api/projects/[projectId]/card` |
| Delete card | `nodex rm <id>` | DELETE `/api/projects/[projectId]/card?cardId=Y` |
| Move card | `nodex mv <id> <from> <to> [opts]` | PUT `/api/projects/[projectId]/move` (atomic: 409 if card not in `fromStatus`) + optional PUT `/api/projects/[projectId]/card` (property updates) |
| History | `nodex history` | GET `/api/projects/[projectId]/history` |
| Undo/Redo | `nodex undo` / `nodex redo` | POST `/api/projects/[projectId]/undo` / `redo` |
| SQL query | `nodex query "<sql>"` | POST `/api/projects/[projectId]/query` |
| Schema | `nodex schema` | GET `/api/projects/[projectId]/schema` |
| List backups | `nodex backups` | GET `/api/backups` |
| Create backup | `nodex backups create` | POST `/api/backups` |
| Restore backup | `nodex backups restore <id> --yes` | POST `/api/backups/[backupId]/restore` |

The server auto-resolves `status` for get/update/delete, so agents only need the card ID. `mv` requires explicit `<from> <to>` statuses for atomic claim semantics (409 if the card already moved). Each CLI command issues a single HTTP request (no pre-lookup), eliminating TOCTOU races when multiple agents operate concurrently.

### Output Format

All CLI output is **JSON Lines by default** (machine-readable, one object per line). Use `--json` for JSON array/object output, `--csv` for CSV, or `--table` for aligned plain-text tables.

```bash
nodex ls backlog            # JSONL (one card object per line)
nodex get abc1234 --json    # JSON object
nodex ls backlog --csv      # CSV table
nodex ls backlog --table    # aligned plain-text table
nodex ls backlog --full     # full card fields + truncated description
nodex ls backlog --full --description-full  # full description
nodex ls --offset 10 --limit 10      # paginate (skip 10, take 10)
```

### SQL Query Examples

```bash
# Count cards by status
nodex query "SELECT status, archived, COUNT(*) as count FROM cards GROUP BY status, archived"

# Find high-priority blocked cards
nodex query "SELECT * FROM cards WHERE priority IN (?, ?) AND agent_blocked = 1" p0-critical p1-high

# Search by title pattern
nodex query "SELECT * FROM cards WHERE title LIKE ?" "%bug%"
```

**Security:** Only SELECT queries are allowed (enforced via SQLite's `Statement.readonly`). Parameters are positional (`?` placeholders).

---

## Design Decisions

### Why SQLite?
- **Atomic transactions**: Move operations are atomic, no data corruption
- **Fast queries**: Indexed lookups, no file parsing overhead
- **Single file**: Easy to backup, restore, or move
- **No server**: Embedded database, no separate process needed
- **WAL mode**: Good concurrent read performance

### Why Multi-Project in One Database?
- **Single file**: One `kanban.db` contains all projects, easy to manage
- **Foreign keys with CASCADE**: Deleting a project automatically cleans up all related data
- **Shared schema**: No duplicate table definitions across databases
- **Atomic cross-project queries**: SQL can query across projects if needed

### Why Electron?
- Desktop app with native window management
- Preload script provides secure IPC bridge via contextBridge
- Main process hosts both SQLite and HTTP server in one long-lived process
- No need for globalThis singleton hacks (unlike Next.js server)
- Browser fallback: UI also works at `http://localhost:51284` via HTTP fetch

### Why Dual Transport (IPC + HTTP)?
- **Electron (IPC)**: Fast, no network overhead, no CORS concerns
- **Browser (HTTP)**: Allows accessing the board from any browser without Electron
- Transport abstraction (`api.ts`) makes this transparent to hooks/components
- Renderer HTTP base is runtime-aware: preload-injected `serverUrl` in Electron, same-origin in browser (with local Vite dev fallback to `:51283`)
- SSE provides real-time updates in browser mode; IPC events in Electron mode
- Renderer dedupes realtime fan-out by project: one shared board subscription/fetch path updates all `useKanban` consumers in that project

### Why SSE for Browser Mode?
- Simpler implementation for one-way updates
- Automatic reconnection
- No additional dependencies

### Why Local Database?
- No server setup required
- Easy to inspect with any SQLite client
- Portable single file
- Works offline

### Why SQLite Online Backup API for Backups?
- **WAL-safe snapshots**: `db.backup(...)` captures consistent state from a live WAL database
- **Atomic backup directories**: Stage in temp dir and rename into place
- **Restore safety**: Auto pre-restore safety backup and rollback staging protect against failed restores
- **Whole-store recovery**: Backups include both `kanban.db` and `assets/`

### Why Stable Asset URIs?
- **Port-independent storage**: NFM descriptions stay valid even if server host/port changes
- **Flat asset ids**: canonical asset references use `nodex://assets/<file>` so image blocks stay portable while file lookup remains a simple single-directory join
- **Simple rendering**: URI resolves to HTTP route in editor (`resolveFileUrl`) and read-only renderer
- **Safer lifecycle**: Deferred cleanup avoids accidental data loss from aggressive orphan deletion

### Why CLI for Agents?
- **Ergonomic**: `nodex mv abc1234 5 6` vs multi-line curl commands
- **Concurrency-safe**: Server-side column resolution means each CLI command is a single atomic HTTP request — no TOCTOU races when multiple agents operate simultaneously
- **Auto-resolution**: Agents don't need to track card column IDs
- **Strict parsing**: Unknown flags/invalid values fail fast instead of silently being ignored
- **Flexible output**: JSONL by default, plus `--json`, `--csv`, and human-friendly `--table`
- **Config files**: TOML config at `.nodex/config.toml` avoids repeating `--url`
- **File input**: `@file` / `@-` for uploading plans or descriptions
- **REST API still available**: CLI wraps the API; direct HTTP access remains for advanced use

### Why REST API?
- **Consistent interface**: Same HTTP patterns for all operations
- **JSON responses**: No database queries required by agents
- **Granular reads**: Fetch just one column or card instead of entire board

### Why Write Limits in App Layer?
- **Stops runaway growth early**: Field-level validation blocks exponential-content bugs before they hit SQLite/history
- **Transport consistency**: `db-service` validation protects both HTTP and Electron IPC writes
- **Resource protection**: Route-level body caps reject oversized requests with `413` before JSON parsing/DB work
- **Operational simplicity**: Limits live in shared constants, so values stay consistent across modules

### Why Popper Positioning for Inline Creator Selects?
- **Radix compatibility with custom triggers**: Avoids `item-aligned` dependence on `SelectValue` value-node measurement
- **Reliable placement**: Dropdown menus anchor consistently in narrow kanban columns
- **Safer click-outside behavior**: Portaled menu interactions can be excluded from inline creator auto-dismiss logic
- **Safe writes**: API ensures valid data, agents can't corrupt database
- **Race condition safety**: Transactions handle concurrent writes properly

### Why Shared Slash-Menu Controller?
- **Single extension point**: Add custom block insertions (like `toggleListInlineView`) while preserving BlockNote default slash items
- **Consistent UX across editors**: Card Stage and Toggle-List editor use the same slash composition and filtering behavior
- **Avoid duplicate overlays**: Explicitly disabling built-in `slashMenu` prevents stacked/default menu conflicts

### Why Shared Toggle-List Card Editor Core?
- **DRY behavior**: Toggle List tab and inline toggle-list embeds use one implementation for schema setup, structural guards, and card sync
- **Navigation correctness**: Boundary Up/Down routing is centralized around native `cardToggle` summaries and host callbacks, reducing `NodeSelection`/DOM-race edge cases
- **Safer maintenance**: Fixes to sync/debounce/rules apply once instead of drifting across duplicated editor implementations

### Why Schema-Gated Child-Group Keyboard Overrides?
- **Broader consistency**: One Enter/Backspace policy works for all inline parent blocks with children, not just toggle-type parents
- **Safer scope**: Schema-gating (`content: "inline"`) avoids applying text merge/split semantics to non-inline wrappers
- **Deterministic precedence**: Enter extension declares `runsBefore` list-item shortcut extensions so custom child-group behavior intercepts before built-in list item Enter handlers
- **Consistent child Backspace policy**: Nested list-like children (`bullet` / `numbered` / `check` / `toggle`) exit list formatting in place at block start, while other leaf-child Backspace cases still merge upward under inline parents, including tail children
- **Stable caret behavior**: ProseMirror-level split/merge helpers set cursor positions in one transaction, avoiding cursor drift from multi-step high-level updates

### Why TOML for Server Config?
- **Unified config**: Agent and server settings in one file, one resolution chain
- **Dev/production split**: Project-level `.nodex/config.toml` for dev, `~/.nodex/config.toml` for production
- **Direct launch support**: Electron app reads `~/.nodex/config.toml` without needing env vars
- **CLI bridge**: `cmdServe()` resolves TOML (with CWD walk-up) and passes final values as env vars to the Electron child process, since the child's CWD is `packageRoot`

### Why Session-Scoped Undo?
- **Independent tabs**: Each browser tab has its own undo stack
- **No conflicts**: Users can't accidentally undo each other's changes
- **Simple mental model**: "My undo undoes my actions"
- **Persisted in DB**: History survives page refresh (sessionStorage holds session ID)

### Why Delta Storage for History?
- **Space efficient**: Only store changed fields, not full card snapshots
- **Fast queries**: Smaller records = faster reads
- **Exception for delete**: Full snapshot stored to enable recreation
- **Card ID preserved**: Deleted cards restore with same ID

### Why BlockNote for the Editor?
- **Notion-like UX out of the box**: Drag handles, slash menu, block selection, formatting toolbar
- **Native block nesting**: Children blocks are first-class (crucial for NFM's tab-indented structure)
- **Built on ProseMirror/Tiptap**: Battle-tested engine, active development
- **Custom block types**: `createReactBlockSpec` for callout blocks (extensible for future types)
- **shadcn/ui integration**: `@blocknote/shadcn` uses the same UI primitives as the rest of the app

### Why Notion-Flavored Markdown (NFM)?
- **Notion compatibility**: Same format used by Notion API, enabling future integrations
- **Block-level structure**: Tab indentation for children, `{color="Color"}` attributes, XML-like advanced blocks
- **Editor-local indentation boundaries**: If `Tab` or `Shift+Tab` cannot change nesting, the keystroke is swallowed instead of moving focus into hover-only editor chrome
- **Human-readable**: Descriptions remain readable in raw text (CLI, database inspection)
- **Custom parser/serializer**: Pure functions in `src/renderer/lib/nfm/`, independent of editor library
- **Three-layer architecture**: NFM string ↔ NfmBlock tree ↔ BlockNote blocks — clean separation of concerns
- **Read-only renderer**: Card previews use `NfmRenderer` (lightweight, no editor overhead)

---

## Glossary

| Term | Definition |
|------|------------|
| **Agent** | AI coding assistant (e.g., Claude Code) that interacts via API |
| **Card** | A single task/item on the board |
| **Column** | A vertical list representing a workflow stage |
| **Project** | An independent kanban board with its own cards and history |
| **Card Stage** | Slide-out panel for viewing/editing card details |
| **SSE** | Server-Sent Events for real-time updates (browser mode) |
| **IPC** | Inter-Process Communication between Electron main and renderer |
| **Transport** | Abstraction layer (`api.ts`) that routes calls to IPC or HTTP |
| **Main Process** | Electron process hosting SQLite, IPC handlers, and Hono HTTP server |
| **Preload** | Electron script that bridges main ↔ renderer via contextBridge |
| **Session ID** | UUID identifying a browser tab's undo/redo stack |
| **History Panel** | App-shell modal showing a card's edit timeline and reconstructed version snapshots |
| **Delta** | Partial record of changed fields (vs full snapshot) |
