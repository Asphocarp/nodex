# Nodex - Product Specification

## Overview

Nodex is a local SQLite-based kanban board designed for managing coding agents (e.g., Claude Code). It runs as an Electron desktop app with a Notion-like UI, and also serves a web interface accessible from any browser. All data is stored in a SQLite database that agents can interact with via REST API. Each Project is an isolated Space with its own Blocks, Documents, Databases, and durable history.

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

- Remote multi-account collaboration or a cloud sync service (multiple local windows still share one collaborative Card Document)
- Cloud sync or remote storage
- Mobile-responsive design (desktop-first)
- Complex workflow automation (keep it simple)

---

## Features

### Core Features

#### 1. Multi-Project Support
- Each Project has independent Database Views and durable history. Typing undo/redo is local to each mounted collaborative Document surface rather than a Project-wide stack.
- Single-page app with a project/session shell: projects render as folders in the left sidebar, expanded projects show durable sessions, and the active session renders as a thread page with shell-owned right and bottom panels for content tabs
- Every new project starts with an ordinary pinned `Database View` session containing one open full-width right-panel `db_view` tab for that project's durable primary View ID; newly created chat sessions start with the right panel collapsed. Session storage identifies DB tabs by `databaseViewId`, permits distinct Views from the same Project, focuses an already-open identical View, and rejects missing/deleted/cross-Project View identities.
- Each DB tab reads one atomic descriptor/query snapshot for its durable View ID. The exact unfiltered, manually ordered, status-grouped primary Kanban View keeps its specialized Board UI. Filtered and secondary Views render list, board, calendar-agenda, or ordered-canvas projections from their own query; displayed custom properties and manual ordering mutate that selected View/Database identity, never the Project's primary board. Scalar values use captured revisions, multi-select values use add/remove intent, and stale writes refresh instead of overwriting another window.
- Session panel tabs support `db_view`, `card_stage`, `terminal`, `browser`, `review`, and `files` kinds; Browser renders the Electron browser-sidebar feature with isolated main-owned webview content, a compact navigation toolbar, address commit/skip behavior, local-server discovery cards, full-bleed responsive page hosting, retained page lifetime across tab switches and panel hide/show, panel-motion-aware fixed webview bounds, device toolbar presets, zoom/data clearing, screenshot/comment affordances, and browser-use overlay state. Files renders the primary source tree, search/filter input, file preview area, thread file tab ids, external-open actions, and markdown/text/image/PDF/unsupported preview routing. Review renders the active thread's connected review diff panel, and Side chat actions create renderer-local temporary thread tabs instead of durable `project_session_tabs` rows. Older saved durable Side chat launcher rows are pruned during schema migration, and older `files_placeholder` rows are normalized to `files`.
- Empty panels and each panel-group tab strip use the same target-aware new-tab action registry. Each group's plus button sits immediately after that group's tabs and creates or previews content in that leaf. The standard thread-panel chooser order is Review, Terminal, Browser, Files, and Side chat, filtered by target panel and singleton availability. Right-panel choosers then append a separated Nodex-only section for DB View and Card Stage when eligible. DB View creates or focuses the active session project's DB tab directly until that project already has one, then opens the move-to-style DB destination picker so another project DB can be selected; Card Stage opens the card destination picker with the active session project's cards grouped before other projects. Timeline remains hidden until Nodex has a first-class tab kind and eligibility model for it. Review is a singleton tab per session across both right and bottom panels. DB View is one tab per target project, while Browser is multi-tab and supports New tab to the right, Reload, and Duplicate before generic close actions from the tab context menu.
- Files and Browser can open as preview tabs in either right or bottom panel, and single-clicking a Kanban DB-view card opens Card Stage as a right-panel preview in the nearest right leaf, creating a right-side group first when the right panel is full-width with only the DB group. A project session panel leaf owns at most one italic preview at a time; opening a second preview in the same leaf replaces the first, and the preview is ephemeral until the user interacts with the preview body, pins it, or double-clicks its tab label. Card Stage preview promotion reuses the preview tab id so the editor body does not remount. Card Stage close/delete controls do not pin an unpinned preview before closing/deleting. Side chat uses a separate renderer-local leaf-scoped tab lifecycle: the empty-panel action, panel menu, thread overflow action, `/side`, and the thread selected-text `Ask in side chat` overlay create `sidechat-loading:<parentThreadId>:<index>` tabs, replace them with closable `sidechat:<threadId>` tabs after the temporary fork starts, and never pin or persist those tabs.
- DB view tabs keep the DB view selector pinned above board, list, toggle-list, canvas, and calendar content, with task search and supported view-local filter/sort/display controls inside that tab body
- Card Stage opens as a session-attached tab when opened from durable entry points such as the command palette, thread card links, or the explicit Card Stage picker. Single-clicking a card from a Kanban DB view opens or replaces a renderer-local preview in the active session instead of switching a global Card stage or creating a durable tab; double-clicking the card opens a durable tab immediately. A card tab can remain attached to the active project session while rendering a card from another project; the tab row's project owns the session placement, while the tab config project owns the card, history, and card-requested terminal target. Cross-project card tabs show the content project as a compact prefix before the card title, and tab hover tooltips expose the full title/project context. When the DB tab group has a right-side sibling group, new card previews or tabs open in the nearest group to the right; when the full-width right panel has only the DB group, DB card opens first create a right-side group and then open there. Focusing an existing durable card tab clears any preview in that leaf and preserves the current right-panel width mode. Card tabs keep the Card Stage shell stable while board summary or full detail hydration is pending: the toolbar is visible but disabled, the title uses the tab snapshot when available, and only unresolved property/editor regions skeletonize. Missing card/project targets render a clear empty state only after loading settles instead of a blank or misleading panel. Durable Card Stage tabs in the mounted panel leaf retain their rich-editor body across panel-tab switches, so the description cursor and editor-local state survive `Cmd/Ctrl+Shift+[` / `Cmd/Ctrl+Shift+]` cycling while the tab remains open.
- In Kanban DB views, cards that are open in selected, visible Card Stage tabs or in the active Card Stage preview in the active session's right or bottom panel render an active ring. Collapsed panels, unselected tabs, and durable card tabs hidden behind a different preview or temporary tab do not mark board cards active.
- Opening DB View from the right-panel action chooser creates or focuses the current project DB directly when possible; once that current-project DB tab exists, the action uses the shared move-to-style picker chrome with command-palette-aligned fuzzy/prefix search. DB View picker results open one DB tab per selected project. Card Stage picker results group the active session project's matching cards first, then other projects, and can target cards from another project while preserving the active session as the tab owner.
- Terminal opens as a session-attached bottom-panel tab with a session-tab-scoped terminal id and starts in the attached thread cwd when present, otherwise the owning project's primary source, otherwise the PTY process default. Cards can request a terminal, but terminal tabs no longer carry card ownership or card ids. When the terminal backend exits, including a user typing `exit`, the owning terminal tab closes automatically.
- Panel action shortcuts are `Ctrl+Shift+G` for Review, `Ctrl+\`` for Terminal, `Cmd/Ctrl+T` for Browser, `Cmd/Ctrl+Shift+E` for Files, and `Alt+Cmd/Ctrl+S` for Side chat. Focused right/bottom panel tab cycling uses `Cmd/Ctrl+Shift+[` for the previous tab and `Cmd/Ctrl+Shift+]` for the next tab in the nearest or last focused split leaf, wrapping within that same group. `Cmd/Ctrl+W` closes the active closable tab in that focused leaf without closing the app window. Panel action shortcuts are ignored while focus is inside editor/input/dialog surfaces; focused panel tab cycling and close-tab still work from NFM editor content in the focused panel group but ignore input fields and dialogs. Plain `Cmd/Ctrl+[` / `Cmd/Ctrl+]` remain app-window Back/Forward.
- The active session can show, collapse, resize, or full-width expand the right panel, and can show/collapse/resize the bottom panel independently. Right, bottom, and split-panel resize drags remain continuous even when Browser webview content is visible under the pointer. The fixed global header exposes `Toggle bottom panel` and `Toggle side panel` buttons, ordered bottom first and side second, and keeps those persistent top-right toggles visible and clickable over regular and full-width right panels. The right panel owns its expand/restore button in the far-right after-list area of its tab header, followed by a measured spacer for the fixed right header slot; the bottom panel owns its close button at the far-right edge of the whole bottom panel. When the right panel is full-width, its tab header visually owns the top row and hides the thread title/header area. If the sidebar is also collapsed, that right-panel tab header starts after the measured left titlebar rail so the left titlebar buttons and right-panel tabs do not overlap. Newly created chat sessions default to collapsed right panels; bottom opens when a terminal tab is created or focused. Project starter `Database View` sessions default to open full-width right panels unless the user changes that session's panel width.
- Attached root-thread sessions use a floating composer overlay at the bottom of the full-width right panel for `review`, `browser`, `db_view`, and `card_stage` tabs. The overlay preserves the normal follow-up composer behavior, latest-turn preview, queued/background lanes, model/reasoning selector, dictation, stop/send controls, and app-shell bottom-panel offset. Side chats, Terminal, Files, blank new-thread homes, and resuming attached threads do not show the root-thread overlay.
- Right and bottom panels support splitable tab groups. Users can split the selected tab from a multi-tab group into a new neighboring group, drag tabs between leaf tab strips with a live insertion marker, drag tabs near the body edge of a leaf to create a split, and resize split groups with sashes. Header tab rows insert or move tabs into that group; body drops merge into the group center or split from the body edges. Durable tabs are uniquely owned by one leaf; when the last visible tab leaves or closes from a non-final group, that empty group is removed automatically. The final empty group remains as the panel fallback, and collapsed panels restore their split tree when reopened.
- URL sync: `/?project=<id>`, persisted to localStorage
- Selecting a project expands its folder and switches the active DB project context. Selecting a session switches the thread page plus both panel tab groups and clears that session's unread flag.
- Task search query is persisted per project and restored on space switching; search lives inside the active DB view tab toolbar for searchable DB views, while Calendar hides that search chrome
- `Cmd/Ctrl+F` opens a body-portal floating content search input for session content instead of panel-local search bars. Threads register the `conversation` domain, Review registers the `diff` domain with renderer-local snapshot/file/full-content matching, and active Browser tabs register the `browser` domain backed by the existing Electron `browser-sidebar-command` find bridge. The input seeds from a single-line text selection, uses Enter/Shift+Enter for next/previous, Escape or `Close find` to exit, caps local result labels at `150+`, and cycles `conversation -> diff -> browser` while focused when a browser target is available. Settings search, DB task search, file tree filter, and jump-to-file remain separate scoped search controls.
- The global command palette has explicit modes. `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P` open root mode, which searches command/action rows only and includes supported shell actions; unsupported placeholder actions appear only in development as disabled rows with a `Mock` badge and are hidden from production catalogs. `Cmd/Ctrl+G` opens chat search across the current non-archived sidebar chat snapshot, including project-backed, projectless, and sessionless sidebar chats, using fuzzy chat metadata plus bounded local content snippets from Nodex's worker-owned FTS5 index. `Cmd/Ctrl+P` opens card search; current title/body hits come from generation/head-fenced Block Document projections, while Card lifecycle and column status resolve from current Block/Database records. Results expose bounded excerpts through `cards:search` without loading full bodies. Card mode owns the trailing `Filter` popover and compact active-filter row beneath the input, using the same status/priority/tag/project-style pill language as the DB view toolbar while persisting those filter selections across reopen/reload. A leading `>` no longer switches modes. File search remains a development-only disabled mock until Nodex has a real file-search backend.
- App-window Back/Forward navigation is available from the top-left titlebar controls, `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, desktop mouse Back/Forward buttons, the command palette, and the macOS application menu. It navigates backward/forward through shell-owned durable workbench context: active project, active session, DB view, right/bottom active tabs, right/bottom collapsed state, and right-panel full-width state. Transient overlays such as settings, command palette, task search, and browser-sidebar webview history are not part of this stack.
- The command palette always includes `Back` and `Forward` commands with matching keyboard hints; those commands are shown disabled when there is no history in that direction. Browser-sidebar webview history is separate and does not drive these app-window controls.
- Desktop supports multi-window in a single app process (`Cmd/Ctrl+N`): each window keeps independent navigation/session state while all windows share the same SQLite data and realtime board/session-change fanout
- When Nodex starts, the Settings -> General -> `Restore windows` policy decides whether to restore all retained window sessions, only the last focused session, or one fresh session
- Each restored window resumes its own active project/session/tab, pane state, DB view, open card context, selected thread context, workbench layout, and saved window bounds
- Windows opened while another window is already open start from the requesting window's current layout and then diverge as independent window sessions
- Back/forward navigation history is window-session-local and is restored only from that window's session storage; it is not part of the cold-launch resume snapshot saved when all windows close
- Desktop single-instance behavior is scoped per resolved server profile (`NODEX_DIR`/`config.toml` dir). Different profile dirs can run at the same time (for example packaged release + dev build), while each profile still enforces one process with many windows.
- Packaged macOS launches from outside `/Applications` show a native prompt to move Nodex into Applications, continue from the current location, or quit before the app runtime starts.
- Project-local session pins, archived state, unread state, durable tab state, no-thread fallback labels, right/bottom panel collapse/size/split layout, active leaf, active tab, and derived flat tab ordering are shared project data in SQLite. Renderer state owns ephemeral panel previews, active project, active session, transient focus history, and temporary side-chat tabs. The `Database View` row is ordinary starter content: it starts pinned for new projects but can be renamed, unpinned, archived, deleted, opened in a new window, and shown in the normal session row context menu.
- Codex thread metadata lives in `codex_threads`, where `project_id` is nullable. Durable local chat ownership lives in `project_session_threads`; cards can reference or mention threads but do not own them. Attached session row titles use `threadName || threadPreview || noThreadFallbackTitle || "New thread"`; blank sessions use `noThreadFallbackTitle || "New thread"`. `noThreadFallbackTitle` is not a thread title authority.
- Sidebar rows use compact project folder and session row chrome. The expanded fixed header starts with a `Nodex` product-name row and a right-aligned icon-only Search button, followed by the fixed New chat row; Search opens global card-search mode and exposes `Cmd/Ctrl+P` in its tooltip. Scheduled and Plugins lead the scrolling content instead of remaining fixed. Once content scrolls under the header, the New chat edge gains a subtle hairline divider and the scroll content fades beneath it; both disappear again at the top. View-local task search remains inside DB view toolbars. Sessions are nested under project folders, and the Projects section options menu persists pin organization through `Organize pins` as `By project` by default or `Manual order` on request. In `By project`, project-scoped pinned chats appear at the top of their project subtree, pinned project folders stay in Pinned with their pinned chats inside that subtree, projectless pinned chats remain standalone in Pinned, Projects contains unpinned project folders, and Chats contains projectless non-pinned chats. In `Manual order`, all pinned chats appear as standalone Pinned rows before pinned project folders. Project folder and project chat lists start at five visible rows, `Show more` adds ten rows per click, `Show less` resets to the first five rows, and the active overflow row remains visible. Unread sessions show a left dot, read session rows expose trailing `Archive chat`, `Pin chat` / `Unpin chat` only on row hover, when the specific action button has keyboard focus, or open state, and no hover overflow menu button; pinned state uses the filled pin glyph. Other hover-only sidebar affordances do not enter the sequential Tab order unless this spec names them. Session rows open an Electron-native context menu from right-click without selecting the session.
- Active session rows open `Rename chat` when the row receives a title-target double-click. The same dialog is reachable from the session context menu, the active thread header actions menu, the command palette command `renameThread`, the macOS application menu item `Rename chat`, and `Cmd/Ctrl+Alt+R`. The dialog uses `Rename chat`, `Keep it short and recognizable`, placeholder `Add a title…`, `Chat title`, `Cancel`, and `Save`; it submits the raw input value. Manual session/thread rename sanitization trims outer whitespace, folds internal whitespace, treats empty results as no-op, and truncates over 60 characters to 59 characters plus `…`.
- The session row context menu order is `Pin/Unpin`, `Rename`, `Archive`, `Mark as unread`, `Reveal in Finder/File Explorer/File Manager`, `Copy` (`working directory`, `session ID`, `deeplink`), `Fork` (`local`, `new worktree`), and `Open in new window`; the native archive action id is `archive-thread`. Archiving is non-destructive, optimistically hides the sidebar row, clears pin/unread state, and archives the linked Codex thread when one exists. Snapshot-only Codex sidebar rows archive through the Codex thread archive channel. `Copy deeplink` uses `nodex://sessions/<session-id>`. `Open in new window` seeds the requesting layout with the exact `activeProjectSessionId`.
- Collapsing the Workbench sidebar: width defaults to `300px`, is clamped to `240..520px`, persists under `sidebar-width`, and the explicit `Hide sidebar` / `Show sidebar` trigger, command palette command, native menu item, and `Cmd/Ctrl+B` shortcut all use the same `toggleSidebar` path. The real sidebar closes through an animated progress spring, remains mounted until progress reaches zero, moves the left titlebar controls from the same animated width, and snaps under reduced motion. During expanded-sidebar sash resize, raw widths from `120px` through `239px` keep the sidebar open at the `240px` minimum; only raw widths below `120px` collapse it. The collapsed sidebar auto-reveals only from the inclusive left-edge pointer strip `0..12px`, including while a full-width right panel is open. The floating sidebar remains visible while the pointer stays inside the current sidebar width, while keyboard focus remains inside the floating sidebar shell, or while its resize sash is actively dragging, then hides when those holds are gone. The floating sidebar can be resized from its right-edge sash; its width clamps and persists like the expanded sidebar, but dragging below the minimum clamps to `240px` instead of expanding/collapsing the real sidebar. Focus inside right or bottom panel controls must not reveal the sidebar.
- Sidebar footer keeps a compact Settings button at bottom-left, no workspace switching controls, and an authenticated Codex quota indicator at bottom-right when account rate-limit data is available.
- Settings opens a full-window settings route shell, not a modal dialog or overlay. It replaces the normal workbench body with a left navigation rail, a `Back to app` affordance, and one active section page at a time instead of a single scrollspy document. The settings rail owns only settings navigation, preserves the same renderer-transparent native vibrancy as the normal sidebar, and leaves each section to render a full-width `main-surface` pane with the settings content centered at the established settings width. The shell is path-driven (`/settings/:section`) and redirects invalid section ids to the default visible section. On desktop, the settings rail groups sections and includes a local `Search settings…` field below `Back to app`; `Cmd/Ctrl+F` focuses and selects it, `Escape` clears it, Arrow Up/Down wraps highlighted results, Enter selects only a highlighted result, and selecting a result navigates to `/settings/:section` without clearing the query. The search index is generated from a normalized renderer catalog of section titles, subtitles, group headings, setting row labels/descriptions, option labels, aliases, and hidden runtime project-name terms; results still navigate to the owning settings section rather than to an individual row. The current sections are `General` (`Restore windows`, `Desktop notifications`, `App updates`, `Diagnostics`, `Telemetry`), `Appearance` (`Theme`, `Sans font size`, `Code font size`), `Keyboard shortcuts` (searchable editable command shortcuts, keystroke search, capture, clear, reset-one, reset-all, conflict warnings, and user-level persistence in `~/.nodex/config.toml` under `[server.command_keybindings]`), `Agent` (`Permissions modes`, `Custom config.toml settings`), `Editor` (`Thread detail`, `Spellcheck`, `Auto-link while typing`, `Auto-link on paste`, `Recognize bare domains`, `Large paste text threshold`, `Large paste description soft limit`, `Open markdown file links in`, `Smart parse block prefixes`, `Strip parsed prefix from title`, `Cmd/Ctrl+Enter to send long prompts`, `Queue follow-ups`), `Card` (`Kanban card properties`, `Card stage collapsed properties`), `Worktrees` (`Worktree start mode`, `Auto branch prefix`, managed-worktree inventory), `Local environments` (a settings-surface page constrained to the same centered max-width as other settings pages; its root state is a project chooser with `Learn more` copy and `Add project`, and project-specific summary/edit subpages move through a breadcrumb toolbar while editing structured `.codex/environments/*.toml` `setup`, `cleanup`, platform overrides, and reusable actions), and `Backups` (auto-backup on/off, frequency hours, backup retention, history retention, manual backup, restore, per-snapshot delete). `Sans font size` defaults to `15px`, persists locally, updates `--vscode-font-size`, and scales the shared sans typography tokens used by the renderer; `Code font size` defaults to `14px`, persists locally, and sets `--vscode-editor-font-size` globally.
- On macOS, traffic-light window controls stay visible at top-left; when the sidebar is expanded, the sidebar collapse control plus Back/Forward controls sit beside them in the sidebar top strip, and when collapsed the titlebar left region reserves `208px` for the sidebar toggle, Back/Forward, then a compact `New chat` button before the thread title section.
- Card Stage session selection lives in the active session's right-panel tab groups; leaf tab strips support hover tooltips, close, wheel-driven horizontal scrolling when tabs overflow, pointer-only drag reorder, cross-leaf tab moves, and edge-drop splitting through the shared tab strip/tree
- Settings can choose which optional card-stage rows start behind the Card Stage `more properties` toggle (`Tags`, `Assignee`, `Threads`, `Schedule`, `Agent blocked`, and `Agent status`)
- Terminal is a session-attached panel tab that defaults to the bottom panel, starts from the active session/thread cwd before falling back to the project primary source, and can be moved to the right panel. Card Stage may request a session terminal, but cards cannot own terminal tabs or PTY ids.
- Scheduled is a Workbench-owned route opened from the sidebar, command palette, and floating summary Scheduled row while the normal project/session sidebar remains mounted. It manages local scheduled automation definitions stored as profile TOML files and mirrored through `codex_scheduled_automations` for low-frequency reads, with task/template tabs, search, list, create, edit, and delete behavior in the main pane plus a peer right-side detail rail. The header create control is an in-app split menu where `Create manually` opens a local draft rail and `Create via chat` opens a blank project session with a prefilled scheduled-task interview prompt. The Templates tab renders a searchable System catalog of scheduled task templates; selecting one opens the create rail with its name, prompt, and schedule prefilled, and the template draft primary action starts a project chat that asks Codex to personalize the template and return a suggested scheduled task. Task list search covers the task name, prompt, workspace/source label, schedule label, kind, target thread, RRULE, and CWDs. Rows group into `Current` and `Paused`, display workspace fallback plus schedule/status text, show `In progress` for active runs or `Next run ...` for active scheduled tasks, mark unread previous runs, and expose Pause/Resume, Run now, Edit, and Delete row actions. Run now starts the task through the same runtime path as scheduled execution, shows `Scheduled task started` on success, and shows `Could not start scheduled task` with the host error message on failure. Delete always opens an in-app confirmation dialog before removing the task. The detail rail exposes title and prompt editing plus Status and Details sections. Details include in-app dropdown controls for Runs in and Environment, a Schedule popover for Repeats or Interval with mode, time, interval, weekly-day, and custom RRULE controls, and a combined Model and reasoning selector; Chat for heartbeat tasks; a Project dropdown backed by configured local project source folders; and a Previous runs section for existing cron tasks. The Model and reasoning selector loads visible Codex models from `codex:model:list`, shows `Loading model` while the app-server model list is pending, resolves empty or unavailable draft models to the visible `isDefault` model and then the first visible model, and clamps reasoning effort to the selected model's supported/default options. The Environment dropdown appears only for cron worktree tasks with one selected project folder, reads the selected project's local-environment options, supports `No environment`, highlights the preferred `environment.toml` config, and opens Settings -> Local environments with the selected project/config context. Previous runs list matching run chats newest first, show unread/running/archived state, source workspace label, compact relative time, `No chats` empty state, open available run chats as normal threads, row menus for Mark as read/unread and Archive/Unarchive/Delete where applicable, and a section menu for Mark all as read and Archive all with archive confirmation. Cron create/edit requires a name, prompt, schedule, project, and model; heartbeat create/edit requires a name, prompt, schedule, and chat. Existing detail edits autosave after a short debounce, and route-changing actions first flush a valid dirty edit through the same update payload before tab switches, row selection, detail close, chat/settings entry, or previous-run open; create remains an explicit submit that selects the saved task; navigating away from a changed create draft opens a discard confirmation with keep-editing and discard actions. Conversation agents receive an `automation_update` dynamic tool that can view, directly create, directly update, suggest, or delete scheduled automations with cron and heartbeat payload validation, structured success/failure output, duplicate-heartbeat/store safety checks, explicit rejection of direct heartbeat writes that target an unknown or non-local thread, and the same scheduled-automation invalidation channel used by manual mutations. Suggested automation tool calls are render-only until the user accepts them in the conversation UI; their conversation cards show Proposed or Proposed update state with Cancel plus Create scheduled task or Apply changes actions. Saved or direct-result cards show Created, Updated, Deleted, or Missing state and can open the matching Scheduled route when an automation id is available. Previous automation runs are stored separately in `codex_automation_runs` with lifecycle status, read state, archived message excerpts, source cwd, and thread/inbox metadata; deleting a scheduled automation also removes its previous-run rows. The route keeps selection in `/automations` search params (`tab`, `automationId`, `automationMode`); creating a task selects the saved automation, closing detail removes selection params, editing updates the same row, and deleting the selected task returns to the scheduled-task list.
- Run lifecycle changes broadcast an automation-run update event so Scheduled rows, the automation-run inbox, and the sidebar/recent thread snapshot stay synchronized after scheduled execution, run-now, archive/delete/read actions, and tool-driven deletion.
- Process Manager is a Workbench-owned dialog opened from the command palette `Process Manager`, `Ctrl+Alt+M`, and the floating summary panel `Tasks` section action. It lists Nodex's registered background-process rows for known attached chats, joins currently live app-server background terminal snapshots and terminal-action sessions for status/output data, polls only while open, freezes the visible snapshot while a row action menu is open, sorts live rows by CPU then memory, and keeps previously registered but currently missing processes visible as `not-found` rows. App-server terminal rows use app-server CPU/memory/pid data; local terminal-action rows use the terminal session OS pid and leave CPU/memory unavailable rather than inventing metrics. `Open output` focuses the owning chat when needed and opens a right-panel `Process output` tab that follows the matching command item's live output or the registered terminal-action session buffer. Floating summary `Tasks` rows open the same output tab directly. `Start` and `Restart` are available for registered rows with a command and working directory, create or refresh a terminal-action session, and refresh the row's start time. Restarting a live app-server process stops that process before starting the terminal action. `Stop` handles either a live app-server process id or a terminal-action session.
- When the desktop host reports an active Computer Use PiP stream for the attached thread, the floating summary panel shows a headerless `Computer Use` row between `Tasks` and `Browser`. Nodex derives that active stream state from BrowserUse capture tabs that are unreleased, capture-active, attached to a live webContents, and associated with the attached thread's session. The row's accessible label and native title are `Show PiP` or `Hide PiP` based on the current visibility request from the host, and activation publishes a visibility change back to the desktop host. Attached thread scroll layouts publish the remote-hosted PiP host layout through the desktop bridge, using the thread viewport as `codex-main-thread` and treating the sticky footer and floating summary panel as PiP obstacles. Host layout publication is placement metadata only; threads without an active toggleable PiP stream do not show a placeholder row.
- The session thread page is a live Codex workspace in Electron. Without an attached thread, it shows a centered new-chat home headed `What should we build in <project>?`, with the inline project selector sharing state with the lower composer project selector. The sticky composer exposes add-context, Plan mode, permissions, model/reasoning, dictation, send controls, a project selector, and a `Start in` selector in the attached lower status strip. The `Start in` selector supports `Work locally` and `New worktree`; cloud, connected-app, suggestion, and projectless rows stay hidden until those backend paths are intentionally added. Submitting the first prompt starts a session-owned Codex thread for the selected project and stores the link in `project_session_threads`; if the selected project differs from the current blank session's project, Nodex first reuses or creates a blank session owned by that project, then starts the thread there so session/project ownership remains valid. While this first prompt is starting, the session owns a runtime `threadStartProgress` state so navigation away and back still shows startup or failure instead of `No messages yet`; once the first visible turn/user message arrives, the normal transcript takes over. `Work locally` uses the selected project's primary source when one exists, otherwise a generated per-thread local workspace, and relies on the composer send-button pending state until the first turn is visible. `New worktree` requires a primary source, creates a managed Git worktree, runs the selected local-environment setup script when configured, starts `thread/start` and `turn/start` in that worktree cwd, streams setup/log progress until the first turn takes over, and links the resulting thread to the owning session with both its cwd and managed worktree path. Thread-id attachment storage remains available at the transport layer, but the workbench header does not expose an attach/detach thread button. Projectless new-chat startup remains hidden until a backend projectless session path exists.
- Side chats are temporary forked conversations for questions and lightweight exploration. Starting a side chat sends an ephemeral `thread/fork` with excluded parent turns, injects a side-conversation boundary before any initial prompt, and renders the resulting thread through the same connected local conversation stage inside the right or bottom panel. Inherited parent history is reference-only; workspace mutation is allowed only when the user explicitly asks for mutation inside that side conversation. Side chats are excluded from project thread lists, session thread links, durable tab ordering, archive/title flows, and cold-start restoration. Closing a side-chat tab discards its cached temporary thread in the background; missing or discarded side chats render `Side chat expired` with `Start new side chat`.
- Opening a session with an archived attached thread shows an archived-thread restore state. Nodex must not call `thread/resume` for archived thread metadata; the user explicitly restores the thread through `thread/unarchive`, then the normal resume flow can continue after the thread is active again.
- Detailed visible transcript behavior for Threads lives in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md), including answered `request_user_input` rows, plan-implementation follow-up flow, optimistic prompt dedupe, tool/reasoning rendering, and restart recovery rules.
- Long Codex thread transcripts load the recent history first, fill remaining history in the background when available, and still request older turns on demand as the user reaches the top of loaded content. Older-page loading preserves the visible transcript position, and rail/find navigation can reveal targets in virtualized or newly loaded history without snapping to the bottom. The latest streaming turn can reserve a response spacer so the footer catch-up action and follow-latest behavior stay stable while new content grows.
- User-message transcript actions:
  - Threads with four or more rendered user messages show a left-side `User messages` navigation rail in the thread body when the content column leaves the Codex-sized left gutter available. Each rail row represents one user message, opens a delayed preview on pointer hover or when the rail row itself has keyboard focus, shows the user prompt, assistant response preview, and capped output pills, and jumps to that message when clicked.
  - User-message rail clicks use smooth thread scrolling and briefly pulse the target user bubble or attachment chip. Pointer dragging over the rail scrubs between rows with instant scrolling. Threads with zero to three user messages do not render the rail.
  - `Copy message` and the sent timestamp are available from user bubbles.
  - The user sent timestamp comes from the turn's `turnStartedAtMs` and renders as a localized relative calendar label: time only for today, weekday plus time for the previous six calendar days, and month/day plus time for older or future timestamps.
  - Long user-message bubbles collapse to a 20-line preview with local `Show more` / `Show less` controls; this is renderer-only UI state and does not change thread data.
  - `Ask in side chat` for selected transcript text is owned by the thread-level selected-text overlay, not the user-message action row. It appears only for an active non-empty selection inside selectable transcript text and opens a temporary side conversation with the selected text prefilled in the side composer without sending it.
  - `Edit message` is shown only on the last user message of the latest completed editable turn; activating it swaps that bubble for an inline edit prompt in place, and the actual rollback-plus-resend happens only after the user clicks `Send`.
- Assistant-message transcript actions:
  - Completed final assistant messages can expose `Copy`, `Good response`, `Bad response`, `Fork from this point`, and sent timestamp actions.
  - The assistant sent timestamp comes from `finalAssistantStartedAtMs`, refreshed from live agent-message event timing, and uses the same localized relative calendar label as user timestamps; protocol `completedAt` is only an archived/read fallback and is not the renderer's display source.
  - `Fork from this point` is shown on eligible completed final assistant messages; latest-turn forks execute immediately, while older-turn forks open a confirmation dialog unless the user has opted out of that confirmation.
  - Forking from a session-backed thread opens a new project session backed by the forked conversation snapshot and focuses the composer in that new session. Non-session legacy thread surfaces may still open the forked thread directly.
- Mounted thread turn rendering follows the turn projection pipeline:
  - each visible turn is projected from an ordered item stream into semantic render buckets, then rendered in a fixed order instead of category-priority reshuffling
  - visible order is `model changed -> user -> model reroute -> agent/exploration body -> system event -> assistant with assistant-after artifacts/actions -> MCP elicitation -> proposed plan / todo -> in-progress placeholder -> provenance markers`
  - the mounted renderer preserves the canonical per-turn item sequence from the conversation snapshot instead of re-sorting turn items by timestamp or id inside the renderer
  - pre-final assistant commentary stays in the agent-work body ahead of the final assistant anchor; only the final assistant message becomes the dedicated assistant block for the turn
  - completed turn diffs render as assistant-after `Edited …` cards before the final assistant action strip when a final assistant exists
  - multi-file completed turn diffs use a compact `Edited N files` card with total `+N -N` stats, a full-row `Review changed files` header click target, `Undo`/`Reapply` before `Review` when patch application is available, and compact clickable file rows instead of per-file accordions
  - turn-diff file lists render only for more than one file, show the first three files by default, and expose a single disclosure row labelled `Show N more files` / `Collapse files`; expanding or collapsing swaps rows immediately without a height animation and preserves scroll position
  - clicking the turn-diff header or `Review` opens the right Review tab; clicking a file row opens Review focused on that path; Cmd/Ctrl-clicking a file row opens that file in the right Files preview tab instead of Review
  - small turn-diff file rows can show a diff preview above the row on hover, but that preview is suppressed while the right-side panel is open so it does not overlap Review, Files, side chat, or other right-panel content
  - turn-diff `Undo` applies patch batches in reverse order with `target: "unstaged"` and thread-diff source semantics; `Reapply` applies batches in forward order. Success switches the next button state and shows `Changes reverted` / `Changes reapplied`; failures open a dialog listing applied, skipped, and conflicted paths.
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
- Turn-complete notifications are governed by the turn-complete mode, current window focus, heartbeat suppression, and pending-continuation suppression. Approval-request and request-user-input notifications ignore the turn-complete mode and are suppressed when the focused stage is `threads`, the active thread tab matches that conversation, and the app window is focused. Ephemeral, system-source, and side-conversation threads are not eligible for desktop notifications.
- Turn-complete notifications may include inline reply, use the thread title or `Turn complete` as the title, and summarize code-review outputs as `Code review finished. No findings.`, `1 finding.`, or `N findings.` when the final assistant message contains inline review findings. Approval and question notifications are open-only; approvals expose `Approve`, `Approve for session`, and `Decline` actions, while question notifications do not expose reply or approval buttons.
- Opening a desktop notification focuses the origin window and opens the matching thread tab. Reply sends a new turn into that thread. Approval actions route back through the existing approval-response flow. Navigating to a real thread tab dismisses all desktop notifications for that conversation.
- User-interrupted turns must never produce a turn-complete desktop notification, even if later terminal updates arrive for that turn through the local stream.
- Packaged macOS builds can check for stable app updates on launch in the background, download them automatically when found, expose a manual `Check now` action in Settings -> General -> `App updates`, expose `Check for Updates…` in the macOS app menu, and require an explicit `Restart to Update` action before installation.
- Diff stage is a review panel bound to the active thread cwd or project primary source:
  - review sources include `Unstaged`, `Staged`, `Commit`, `Branch`, and `Last turn`; the selector only switches the visible diff source and never starts a review prompt
  - the panel can initialize Git for a workspace that is not yet a repository
  - the toolbar exposes source selection, `+N` / `-N` stats, `Review options`, `Jump to file`, unified/split diff mode, `Hide files` / `Show files`, `Commit or push`, and `Create PR`
  - `Review options` owns word wrap, expand/collapse all, full-file loading, rich preview, word diffs, hide/show white space, and copy-git-apply commands; full-file loading is enabled by default, so the default menu action is `Don't load full files`; inline stage/unstage/revert actions stay out of the Review toolbar
  - file diffs collapse large unchanged ranges into clickable `N unmodified lines` rows that can expand upward, downward, or both in 20-line increments when full old/new file contents are available, while turn-diff hover/inline previews keep their simpler hunk separator presentation
  - review file headers and the right-side file tree render file-type icons for known extensions and tool config files, with unknown files falling back to the default file glyph
  - Git-backed review sources load through main-process `git:review:diff`, branch stats, and merge-base IPC, preserving separate loading, load-failed, timed-out, non-git, empty, and large-diff states
  - `Last turn` renders from the active conversation's turn diff; when the current workspace file still matches the patch, Nodex safely reconstructs full old/new text for the same expandable separator behavior, otherwise it falls back to partial patch rendering; Git-backed sources load exact workspace diffs and full file contents through main-process Git review IPC
  - the right-side file tree is fixed-width, can filter changed files with `Filter files...`, and can be hidden without resetting diff selection or comments
  - changed diff lines expose a hover `+` gutter utility, right-click `Request changes`, and drag/range selection for creating `Local comment` request-change annotations; submitted local comments become pending composer attachments and are sent with the next turn/steer as both structured review-diff comment context and text user input
  - model-produced `::code-comment{...}` directives render as readonly path/line anchored review annotation cards above the matching file diff
  - GitHub PR comments use the inline review-comments API for path/line/side/range/reply metadata instead of showing issue-level comments as fake inline comments
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
- The left sidebar uses a persisted pinned organization preference from the Projects section options menu's `Organize pins` submenu. `By project` is the default: project-scoped pinned chats render inside their project subtree, projectless pinned chats render as standalone Pinned rows, pinned project folders render inside Pinned, `Projects` renders unpinned project folders, and `Chats` renders projectless non-pinned sessions. `Manual order` preserves the previous behavior where all pinned chats render as standalone rows in Pinned before pinned project folders. If the current organization projection leaves no standalone pinned chats or pinned project folders in Pinned, the Pinned section header is hidden.
- Sidebar project headers can be reordered by dragging the header row. Normal project groups persist their order in `project_order`; pinned project groups render inside the single `Pinned` section above Projects and persist their order in `pinned_project_order`.
- Dragging a normal project header onto the pinned section pins that project and leaves normal project order unchanged. The Projects section excludes pinned projects while preserving their normal order for later unpinning.
- The Projects header exposes compact actions: the project-group action is hidden when it does not apply, shows `Collapse all` when more than one visible project folder is expanded, and then shows `Reopen previous` to restore that previous expanded set after collapsing all; `Project sidebar options` opens a menu with `Archive all chats`, `Organize pins`, `Organize sidebar`, and `Sort by`; unsupported entries are disabled, `Organize pins` is the live pin-organization selector, and the supported current sort mode shows `Manual order` as selected. `Add new project` opens a submenu with `Start from scratch` and `Use an existing folder`, both using the project-add glyph. `Start from scratch` opens the local project setup dialog with optional name/source collection. `Use an existing folder` opens the native folder picker, names the project from the folder basename, and stores that folder as the first source.
- Project deletion enters the same durable FIFO as Card/Document edits, permanently retires every Block ID in the Space, and removes the Project-scoped Block/Document/Database graph plus rebuildable projections in one guarded transaction. After commit, mounted surfaces for those Documents are selectively reset; a queued old edit can only commit before deletion or fail against the removed identity, and no deleted ID can be reused.
- Codex thread links are session-owned. Cards can mention threads and send selected content to chats, but they do not own durable Codex threads.

#### 2. Kanban Board View
- 8 columns representing workflow stages
- Drag-and-drop cards between columns
- Each kanban column header includes a `more actions` popover for collapsing that column and adjusting its persisted expanded width; collapsed columns still show their card count and the same `more actions` trigger
- Shift-click in Kanban toggles a temporary multi-selection from the clicked card; selection can span columns. A board drop compiles status/property changes and the selected run's manual View position from one current authority snapshot, then commits them as one all-or-nothing Database mutation.
- Same-window cross-surface drag treats a Kanban Database View as a projection over real Card children. Dragging one or more Kanban Cards into a visible NFM editor moves those same-ID childless Card shells into the host Document; dragging editor roots into a Kanban column moves them into that Database, promoting compatible text-like roots in place and wrapping non-convertible roots in a Card. Holding Option/Alt at drop time copies the recursive ownership closure with fresh application IDs instead. One `BlockTransfer` commits source/target Documents, exclusive parent, membership, View position, projections, history, and receipt atomically; the renderer carries no NFM/Card body snapshot and never removes the source optimistically.
- Same-Database Kanban reorder remains a View-position operation because it does not change the Card's parent. Cross-window native DnD is intentionally unsupported until the platform can prove a live source session and safely carry the logical transfer payload; it fails closed without mutation.
- The NFM side-menu `Move to` action opens a compact destination popover with grouped `DB` and `Card` search results. DB rows disclose column/status child destinations, while card rows append blocks to an existing card. Detailed behavior lives in [NFM Editor Move-To Popover Behavior](./nfm-editor-move-to-popover-behavior.md).
- In NFM editors, `cardToggle` property chips sit in the same inline text flow as the toggle title, so wrapped titles use the full row width like inline kanban card properties instead of a separate leading chip column
- Visual card previews with priority badges
- The Database manager lists every active Card independently of View filters. For the selected Database it can add an unassigned Card, atomically transfer a Card from another owning Database, remove membership without deleting the Card, select the target durable View and a stable null-group Card anchor, and author View name, kind, nested AND/OR filters, ordered sorts, grouping, visible properties, and durable View order. View drafts retain the revision at which editing began; a concurrent change is a typed conflict rather than a whole-config overwrite. Other open windows refresh from the committed Database event.
- Kanban card reorder keeps a non-layout-shifting insertion indicator; the source card stays as a static ghost in place while dragging, same-column reorders do not live-shift sibling cards, columns do not tint as separate previews, the drag overlay is geometry-matched to the source card so it starts aligned with the cursor, and dropping on the visual gap between cards still inserts into that gap instead of falling through to column-end append
- The Kanban insert-position indicator is resolved against the remaining non-dragged cards in the target surface, so same-column and multi-card drags never draw the line above a dragged ghost when the actual drop will land before the next remaining card
- Kanban card property chips (priority/estimate/tags/assignee) render inline with the card title by default, and Settings can move them above the title or below the body
- Right-clicking a Kanban card opens a Radix context menu with a searchable action list; production shows only real actions: `Copy deeplink` copies an `nodex://cards/<card-id>` deeplink to the target card, `Delete` removes the card, and clicking `Move to` advances the same menu into a searchable in-place project picker that atomically transfers the Card into the same workflow column of the selected Project's primary Database View. Every open editor for the Card or a recursively owned Document briefly flushes and freezes first; failure leaves the Card entirely in the source Project, while success removes the source row, publishes the target summary, and resynchronizes all moved Documents without changing stable IDs. Reference-only actions such as favorite/icon/property/layout/open/duplicate appear only in development or Storybook as disabled rows with a `Mock` badge.
- Real-time updates when data changes
- Card lifecycle, property, Database, and Document edits use separate typed commands. Stale scalar metadata edits return field/path-level conflicts; set-like properties preserve add/remove intent. Title/body merge through Yjs and are never retried as a whole-Card overwrite.
- Header task search supports token-contains matching across title/description/tags/assignee/agent status/id in Kanban, All Tasks, and Toggle List views
- Kanban card drag-and-drop stays available while search or toolbar filters are active; reordering maps the visible drop slot back into the underlying board order so hidden non-matching cards keep their relative position
- When a non-default toolbar sort is active in Kanban view, cards remain draggable across columns, but same-column manual re-ranking is disabled because the active sort, not board order, owns the visible ordering
- Detailed drag-and-drop behavior and invariants: [Kanban Drag and Drop Behavior](./kanban-drag-and-drop-behavior.md)

#### 3. Toggle-List View
- Third project page tab (`Toggle List`) renders summary/reference rows; expanding a visible row opens that Card's own collaborative editor and provider
- Each top-level toggle row maps to one Card summary/reference. Expanding it mounts that Card's own title/body Document rather than mapping the description into row children.
- Toggle-list editor uses the same shared slash-menu controller as Card Stage (defaults + custom blocks) to keep insertion UX aligned
- Inline Card and Database View references are reference-only Blocks. Collapsed rows render summary projections; expanding a visible row lazily mounts that Card's independent collaborative Document, never a copied child subtree in the host editor.
- Reference expansion is window-local and a small renderer-wide activation budget bounds live nested providers. Self references do not recursively mount, and cross-Project references use the target Project's workspace context.
- Board state sync is shared per project (`useKanban` store-backed): one realtime subscription/fetch pipeline fans out to all consumers and exposes O(1) `cardIndex` lookup
- Toggle List row expansion is window-local and never enters a Card body. Toggles inside an expanded Card's own editor honor `▼` / `▶` on NFM import, but disclosure state remains window-local and is not persisted in the Card Y.Doc.
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
- Toggle-list Card title/body edits use each Card's own mutation/Document authority, while board updates refresh summary rows through the shared project subscription.
- Top-level rows are Database query results, not host-editor children; membership and View operations own their structure/order.
- Supported DB view filter/sort/display settings persist per project and per view in renderer localStorage

#### 4. SQLite Database Storage
- Single `nodex.db` file in the local store directory
- Schema v74 stores Block identity with one Space/Document/Database parent, engine-neutral Owned Documents, stable dormant Database membership/properties/Views, immutable mutation/history evidence, rebuildable projections, and a validated portable-rich Card title projection. Block-tree owners use Yjs authority; Canvas uses normalized scene authority. The content-bearing Card/history/description snapshot tables are absent.
- One asynchronous `BlockMutationWriter` serializes Block/Card-domain `better-sqlite3` transactions outside the Electron main event loop.
- New user/content Block identities use canonical lowercase UUID-v7 and are validated only at creation. Existing IDs remain opaque. View, property, membership, operation, mutation, and other non-Block identities default to UUID-v4 when they do not have a stronger domain-derived identity; explicit timestamps, ranks, and sequences remain the only ordering authority.

#### 5. Card Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Canonical lowercase UUID-v7 Block identity; Card has no separate storage ID |
| `title` | string | Yes | Plain-text projection of `Y.Text("title")` (max 2,000 chars); used by search, tables, accessibility, and plain CLI output |
| `richTitle` | portable rich text | Yes on current reads | Canonical styled/link/mention projection of the Card Document title; structured transports preserve it without loading the body |
| `description` | string | No | Read/export projection of `Y.XmlFragment("body")` as [NFM](../references/notion-flavored-markdown-spec.md), including image/attachment/thread/date syntax (max 1,000,000 projected chars); never a collaborative write field |
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
| `revision` | number | Yes | Compatibility read of the Card Block metadata revision; individual mutable properties carry field/path revisions |
| `created` | datetime | Yes | Creation timestamp (ISO 8601) |
| `order` | number | Yes | Compatibility read of the primary Database View position; durable ordering is View-specific fractional rank |

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
- Card is the user-facing term for a document-bearing Block; Card Stage never introduces a second Page identity
- Production Card Stage prepares the exact Project-scoped owned-Document descriptor before rendering content. Only a ready, schema-compatible `yjs` descriptor mounts the Card editor; `canvas_scene` descriptors route to Canvas view, and invalid descriptors remain on a retryable fail-closed diagnostic surface
- Card Stage uses one continuous content skeleton across Card hydration, Document preparation, runtime creation, and the initial state-vector handshake. Normal opening never replaces that skeleton with a second text-only loading state. A terminal open or resync failure remains inline until recovery, shows the concrete failure reason beside Reload, and offers expandable, copyable diagnostics with the protocol error code and Document identity; delayed/offline sync status remains available after a Document has opened
- A title-only Card opens as a normal empty editor. Its collaborative body contains one authority-owned empty paragraph with a stable Block ID, while NFM/plain-text exports remain empty; the editor never creates a placeholder identity during mount
- On a primary Card, every mounted writable surface owns an independent Y.Doc client/session, completes state-vector synchronization before mounting content, binds title to `Y.Text("title")`, and binds BlockNote to `Y.XmlFragment("body")`
- Card title is a rich contenteditable projection of that Y.Text. It preserves bold/italic/underline/code/color, links, line breaks, and registered title-safe mention atoms; formatting never applies to atomic objects or line breaks. Ordinary input and deletion mutate minimal Y.Text ranges, Shift+Enter inserts a canonical line break, Enter remains Card-stage navigation, and paste falls back to sanitized plain title text when external rich content is unsupported.
- Synced Block sources are not another Card/Page: each is a system-managed body-only collaborative Document whose library placement is omitted from normal Card/Database navigation, while visible occurrences are childless references to the same source Block. The typed ownership command is available through renderer IPC/HTTP and CLI. A collapsed occurrence creates no provider; expanding a visible occurrence mounts the source's independent collaborative editor without copying its body into the host Card
- Reusable Template library sources, explicit Large Document shells, explicit Large Code shells, and non-primary Canvas owners use the same production command boundary. Templates have an authoritative human name, childless references, and copy-on-instantiate semantics with fresh Block IDs. Template and Large shells contain no foreign body and open their independently synchronized block-tree body through the shared lazy owned-Document surface. Canvas scene Documents remain in Canvas view and never mount a BlockNote body editor. A source can be deleted only after a global exact-head scan proves that no Project references any Block in its recursively owned closure; deletion retains Documents/history until GC. Ordinary paragraphs never promote automatically
- Promotion/demotion preserves selected subtree IDs, allocates fresh IDs only for copies, obtains host/source flush fences through the collaboration Hub, and either commits a sole-occurrence demotion completely or leaves both Documents unchanged. Clients never submit writer fence proofs directly.
- Primary title/body edits are Yjs transactions and never run whole-NFM autosave, external whole-body replacement, or description conflict overwrite. Lifecycle and metadata use separate typed commands; explicit NFM import requires current Document generation/head CAS and produces a forward Yjs transaction.
- A descriptor that is not ready/primary/schema-compatible remains on a fail-closed diagnostic surface. There is no legacy snapshot editor or whole-Card overwrite recovery, and authority is never inferred from `Card.description`.
- Title/body undo tracks only the current surface's local origins. Remote edits merge visibly but do not enter that surface's undo stack
- Awareness distinguishes mounted windows/sessions and is advisory rather than a lock. Hiding a retained Card Stage clears its presence and closes that surface client; returning creates a new client session and state-vector-syncs any intervening content before editing resumes
- Close/deactivation persistence is bounded and combines durable provider flush with a disposable local checkpoint. Normal fast ACKs stay visually quiet; delayed pending, offline, error, and reset states show compact retry/reload status
- Card Stage visibility context is global: switching spaces/projects and views keeps the current Card Stage state/card until explicitly closed
- Card Stage metadata drafts, DOM state, and editor presentation state survive Project/session switching. A hidden Activity publishes no presence and owns no live collaborative runtime; returning to it opens a fresh per-surface Y.Doc client, completes state-vector synchronization against the same Card Document, and only then exposes title/body editing
- Card Stage priority uses an explicit empty state by default; empty priority renders as a subdued placeholder in selectors and is omitted from dense card badges.
- Card Stage Properties includes schedule editing with an `All-day` mode toggle.
- Card Stage Properties includes a `Run in` selector for new thread execution target: `Local project` (with optional folder override picker), `New worktree` (base-branch selector + environment selector for `.codex/environments/*.toml`), and `Cloud` (mock/unavailable).
- Timed mode uses start/end `datetime-local` inputs with quick actions (`Set schedule`, `Now + 1h`, `Clear`) and automatic end-after-start guardrails.
- All-day mode uses start/end `date` inputs (end shown as inclusive in UI, persisted as end-exclusive storage) with the same guardrails.
- Tag input suggests existing project tags while typing via native autocomplete options (excluding tags already on the current card)
- BlockNote block editor for description (Notion-flavored Markdown)
- NFM headings use a typography scale in-editor: H1 `1.875em`, H2 `1.5em`, H3 `1.25em`, H4 `1.125em`, all at `600` weight with `1.3` line-height relative to the editor body size
- Card Stage rich editors with four or more H1-H4 headings show an automatic right-gutter heading rail. The rail is renderer-derived from the mounted NFM document, is available only for the active rich-editor tab on fine-pointer viewports with at least 48px of right gutter, and is absent in raw mode. Its markers anchor at the right and extend left toward the content. It shares the user-message marker rail behavior: current headings follow viewport intersection, rows auto-scroll, click reveal uses smooth scrolling, pointer drag scrub uses instant reveal, and hover shows a heading tooltip opening toward the content. The rail has no toolbar setting, card field, schema migration, backend endpoint, or history persistence.
- NFM descriptions support simple editable tables from GFM pipe-table syntax and the lossless NFM `<table>` extension. Tables render in Card Stage, a Toggle List row's expanded Card editor, read-only history previews, and raw NFM renderer surfaces; detailed behavior lives in [NFM Editor Table Block Behavior](./nfm-editor-table-block-behavior.md).
- Card Stage toolbar includes a `Show raw` toggle that swaps the description area into a read-only raw NFM view for debugging. The view is materialized from the live Y.Doc and never becomes content authority.
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
- NFM supports inline `<mention-thread uuid="..." />` mentions for Codex thread references. They render as minimal Notion-style inline references, resolve local thread metadata when available, open the referenced thread when clicked, serialize to `[Thread: <uuid>]` in copy and thread-section prompts, and never inject the mentioned thread transcript into `promptInput`. The NFM `@` picker uses the same command-palette chat/card search model for thread mentions and card references, including sidebar-wide chat metadata/content search and card metadata/description search, while keeping the stored `threadMention` and `cardRef` shapes unchanged. Picker results prioritize the editor's current-project chats/cards in a `Current project` group, omit redundant right-side mention syntax hints, and keep hover tooltips to compact context plus optional search snippets. Detailed behavior lives in [NFM Editor Thread Mention Behavior](./nfm-editor-thread-mention-behavior.md).
- Toggle headings (`▶# Heading`) supported: headings with collapsible children, matching Notion's toggle heading behaviour
- Toggle open/closed state is persisted in NFM using `▼` (expanded) / `▶` (collapsed) markers; state survives save/reload cycles via a localStorage bridge that pre-populates BlockNote's `defaultToggledState` on editor init and reads DOM `data-show-children` on save
- `ArrowUp` / `ArrowDown` across a collapsed toggle boundary preserve browser-native visual-line movement and never jump into hidden edge non-inline children while the toggle stays collapsed
- Typing `## ` inside a toggle header converts it to a toggle heading (preserves toggle state)
- `Cmd/Ctrl+Enter` modifies the current actionable NFM block before any Card Stage send fallback: checklist blocks toggle checked state, toggle list items and toggle headings expand/collapse, image blocks open preview, `cardRef` and targeted `cardToggle` blocks open Card Stage, and bound `threadSection` markers open their linked thread. If no modify action is available, Card Stage keeps the thread-section send behavior without moving focus to the Threads stage; unsectioned content still creates a section marker before sending.
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
- Drag-hovering persisted collapsed toggle headers (`toggleListItem`, toggle headings, and legacy/nested `cardToggle` rows) keeps a stable overlay highlight with pointer-coordinate hit-testing plus drop-time active-target fallback (no rapid flicker), and supports diagnostics via `window.__TOGGLE_DND_DEBUG__ = true`.
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
- `@Card` inserts a fully resolved canonical Card reference with `targetBlockId` plus a bounded display hint. `/card` stays hidden until its picker can choose a target before the Y.Doc transaction; no writable surface may create an unresolved Card reference. Legacy `Toggle List Inline View` insertion is unavailable; migrated inline queries use `databaseViewRef` and a durable View definition.
- `Database View Reference` is a childless custom Block that stores `databaseViewId` and renders the durable query's ordered summary rows.
- Reference row headers reuse existing property chip styles (`priority`, `estimate`, `status`) on the same title line.
- Reference Blocks render full-width with shallow, chrome-light rows; expansion indents the independently mounted target Document without changing the host Block tree.
- Canonical Card/Database View reference owners remain ordinary stable-ID Blocks for BlockNote selection and drag operations. Result rows are renderer projections and cannot be dragged as if they were host Document children.
- Migrated inline rules compile into the canonical durable Database View schema before v70 cutover. Project-scoped reads validate and execute filter/sort/include-host semantics over memberships, including negative set membership and creation-time sorts, use view rank plus Card ID as stable tie-breakers, and safely show all rows when a malformed legacy rule cannot be interpreted. No active View retains a legacy compatibility config.
- `cardRef` / `databaseViewRef` are childless persistence shapes. Parser, codec, and primary storage validation reject foreign Card bodies; legacy `cardToggle` / `toggleListInlineView` shapes exist only as migration inputs and inert diagnostics.
- Toggle List summary rows do not export or accept body snapshots; only an independently mounted Card editor can move its own stable-ID Blocks through `BlockTransfer`.
- Reference recursion is guarded by an inherited Card ancestry path (including A → B → A), while a per-mounted-surface visible-provider budget caps independent editors and keeps the focused surface resident; foreign bodies never enter the host tree.
- Drag-handle block menu includes a real `Move to` destination popover with grouped Database/Card results. Choosing a different parent sends stable root Block IDs plus a logical `BlockTransfer` destination: all affected mounted editors commit IME, durably flush, and freeze briefly; Yjs changes, registry locations, Space/Database placement, projections, history, and receipt then commit atomically. No renderer removes the source optimistically or reads either Card's NFM snapshot. For a losslessly promotable root, Move preserves that root ID as the Card ID, its exact rich inline content becomes Card title, and only its ordered children become body roots; a leaf receives one canonical empty body paragraph. Option/Alt Copy allocates fresh IDs before applying the identical transformation. Stateful or unsupported roots retain their complete subtree inside a wrapper Card or fail before writing.
- NFM block side menu opens from the left drag handle or `Cmd/Ctrl+/` at the current block, promotes relevant text selections into visible block selections, and advertises the top-level action scope with labels such as `Text`, `Code`, or `3 blocks`. Production rows expose real block actions only: `Turn into`, `Color`, `Duplicate`, `Move to`, and `Delete`, plus eligible divider/table-specific rows. Block-link copy rows remain development-only reference mocks until NFM has stable persisted block identities. Detailed title, action, layout, submenu, and card deeplink rules: [NFM Block Side Menu Behavior](./nfm-block-side-menu-behavior.md).
- Side-menu handle dragging interprets a live text selection with block-level start-inclusive/end-exclusive bounds. If the selection ends exactly at the start of the next block, that next block is not part of the drag payload; if the selection has entered the next block's content, it is included. If the selection starts at the previous block's content end, the previous block remains included. Cross-parent text selections do not create custom mixed-parent payloads; instead, the editor drags the smallest common-level block range that fully covers the selected candidates. Examples: `blo<start>ck-0 / <end>block-1` dragged from `block-0` moves `{block-0}`, while `blo<start>ck-0 / b<end>lock-1` dragged from either selected handle moves `{block-0, block-1}`; `block-0<start> / blo<end>ck-1` also moves `{block-0, block-1}`; `block-0<start> / <end>block-1` moves only `{block-0}` when dragged from `block-0`. In a nested range `block-0 > block-02<start>, block-03 / <end>block-1`, dragging `block-02` or `block-03` moves `{block-02, block-03}`, while dragging `block-1` moves `{block-1}`; if the end enters `block-1`, dragging `block-02`, `block-03`, or `block-1` moves `{block-0, block-1}` so the dragged payload fully covers the text selection.
- Expanded rich-text selections in Card Stage and a Toggle List row's independently mounted Card editor show a Notion-style floating text action menu instead of the compact formatting toolbar. The production menu uses Nodex tokens while preserving the 192px popup hierarchy, block-type row, text style grid, color controls, and supported Nodex action rows. Supported actions use existing BlockNote/Nodex editor paths for block conversion, bold/italic/underline/strike/code, clear format, and link creation/editing. The color button opens a 190px swatch-grid dialog with up to five app-wide persisted recent color slots plus text/background color grids; swatch clicks keep the dialog open, and clicking the active swatch clears that color back to default. Reference-only controls such as equation, comment/reaction/comment-pencil, skills list, and inline AI footer appear only in development or Storybook as disabled mock controls with `Mock` labelling or mock-specific aria/tooltip labels, while Card Stage editors can expose Nodex-specific `Send to chat` and `Move to` actions in the actions area when callbacks are available. `Send to chat` opens a right-side sidebar-wide chat picker that reuses command-palette chat search, including fuzzy metadata ranking and bounded local content snippets; the current session or current section remains the context-recommended first destination when available, and a bottom `New chat` action plus app-level persisted `Send` / `Send & wrap` modes remain available. Ordinary chat rows show their owning project as right-side metadata; contextual rows keep `This session` or `Current section`. Selected-block sends recommend the current session: if it already has a chat, that chat is first; if the current session is an empty no-tab chat draft, `New chat` appears first with `This session` metadata and creates the thread in that session. Thread-section sends recommend the section's bound chat first. Sending targets the selected top-level blocks, preserves supported prompt attachments, and does not switch the stage to the chat; `Send & wrap` includes an info icon tooltip and only mutates the document after a successful send by replacing the selected roots with a collapsed toggle headed `▶ sent to <mention-thread uuid="..." />`. `Move to` keeps the single destination popover for DB/card targets. Hover-opening either action picker must not steal focus from the editor or hide the selected range; when a picker/search input is focused, the original editor selection remains visibly decorated until the picker is closed and focus leaves the text-action toolbar. File, image, table, and non-rich-text node selections keep the compact legacy toolbar fallback, while collapsed rich-text cursors show no floating toolbar; image/file toolbars anchor directly above the selected block and omit text-alignment controls because NFM does not persist that state.
- The text-selection menu `More` button closes the text-selection menu and opens the existing block side-menu actions for the currently selected block range. Partial text selections are promoted to block-scoped side-menu actions over every selected block; non-mutating dismissal returns focus to the editor with that promoted block scope still held as the real editor selection while suppressing the formatting toolbar for the dismissed range. A same-editor blank click only dismisses the handed-off side menu and does not click through into ProseMirror to place a cursor or scroll the editor.
- Drag handles, formatting toolbar, block selection
- Delete card action
- View history button opens an app-shell version-history modal for the currently open Card Stage card
- Owned Document history is exposed through Project/Document-scoped list, get, checkpoint, and restore commands over both Electron IPC and loopback HTTP. A `block_tree` checkpoint stores a full Yjs update and causal metadata; a Canvas checkpoint stores bounded canonical scene JSON. Restore requires the selected version identity plus current generation/head, briefly flushes and freezes every mounted surface, creates a `before_restore` checkpoint, and appends one engine-specific forward mutation. Retrying the same restore mutation ID returns the original durable result.
- History modal presents one cursor-paginated timeline merged from immutable Document checkpoints and canonical Block mutation/relocation evidence. A selected checkpoint has a full read-only preview; non-checkpoint entries show bounded durable evidence and do not pretend to be reversible snapshots.

#### 8. Edit History & Undo/Redo
- Typing undo/redo is owned by the mounted Yjs surface. `Cmd/Ctrl+Z` and redo operate only on transactions created by that surface's local origins; remote edits and another window's changes never enter its undo stack.
- Durable content history is a retained `document_versions` checkpoint stream. Each checkpoint records an explicit engine format, schema, content hash, and bounded audit metadata independently from operational compaction.
- Property, lifecycle, Database membership/value/View, and location changes are immutable `block_mutations` / `block_relocations` joined through the Project change log. Their before/after evidence is field- or operation-scoped, not a reconstructed whole Card snapshot.
- The Card history modal is Card-scoped and merges these sources into one stable cursor timeline. Pagination never depends on array offsets or renderer-local clocks.
- Selecting a Document checkpoint loads a read-only preview. Reference and embed Blocks remain inert in previews and do not fetch or mutate current target state.
- Restore is available only for a retained compatible Document checkpoint. It validates the current generation/head, briefly fences mounted editors, writes a mandatory `before_restore` checkpoint, and appends a new forward engine mutation with an exact-retry receipt. Card restore never rewinds Yjs causality; Canvas restore assigns newer element versions and explicit tombstones rather than replacing current authority with an old scene snapshot.
- Mutation and relocation entries expose durable evidence but no generic inverse button. A future domain-specific inverse must be a new validated forward command, never Project-wide snapshot undo.
- Fast local undo has no global toast. Durable restore reports pending/success/failure in the history surface and refreshes through the committed Document event.

#### 9. Whole-Store Backups
- Manual backup creation via CLI/API (`nodex.db` + `assets/`)
- Automatic backups every 6 hours with retention of latest 28 auto backups
- Backup briefly freezes managed asset and content writes so the database and referenced files come from one consistent point
- Restore requires explicit confirmation and creates a pre-restore safety backup by default; that safety snapshot and replacement share one uninterrupted write fence
- Restore either installs the complete selected database/assets snapshot or keeps the complete previous store, including after an interruption between file moves
- Restore rejects snapshots with missing referenced managed assets, nested asset directories, symlinks, or unsafe asset filenames
- Successful restore automatically reloads every open collaborative Card against a new store epoch; edits and local recovery data from before restore cannot replay into the restored snapshot
- Backup artifacts are stored under `~/.nodex/backups/<backup-id>/` with a versioned `manifest.json`

#### 10. Canvas View (Excalidraw)
- Canvas tab provides a freeform whiteboard per project for card brainstorming and visual mapping.
- Every Project owns one primary Canvas Block and an independent `canvas_scene` Owned Document. SQLite stores normalized current element, durable app-state, and managed-file authority rather than a Y.Doc or renderer-overwritten whole scene.
- Separate windows submit bounded element candidates and field-level app-state intent. Greater Excalidraw version wins, equal versions use the lower version nonce, a canonical hash breaks malformed ties, and deletion is always an explicit tombstone.
- Card shapes are reference objects with a stable `targetBlockId`; they do not copy Card bodies or Database membership into Canvas content, and standalone Cards remain openable.
- Shared scene state contains current portable elements, ordering, and a bounded set of durable app-state fields. Selection, viewport, active tool, and focus remain window-local.
- Embedded image bytes are uploaded to managed assets before a scene mutation records immutable URI metadata. Remote surfaces lazily resolve those URIs and reuse unchanged asset reads.
- The renderer coalesces frequent observations, persists each exact pending mutation to an IndexedDB outbox before transport, retries response loss idempotently, and invalidates stale outbox entries after a store-epoch or generation change.
- Scene subscriptions start before synchronization. A missing/out-of-order head, reconnect, or completed write lease repairs through one bounded full canonical scene. Pending upload/outbox/provider work joins bounded close and write-fence flushing; remote scenes reconcile with `CaptureUpdateAction.NEVER` and do not enter local Excalidraw undo.

#### 11. Calendar View
- Calendar tab shows scheduled cards in a day-grid timeline with Day, Week, custom Multi-Day, and custom Multi-Week ranges.
- The Calendar controls live in the View-stage global toolbar instead of a separate in-calendar toolbar; the compact primary month/year label sits beside the active Calendar selector, while the trailing cluster omits search/filter/sort/display chrome and shows create, range selector, and previous/today/next navigation.
- Multi-Day and Multi-Week range rows reveal inline `- number +` controls on pointer hover or when the range row itself has keyboard focus so users can adjust the actual custom span without leaving the menu.
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
- Completing an occurrence creates a new current-content Card with status `done` and `archived=true`; archived events remain visible on Calendar with muted styling.
- Complete, skip, and scoped update are idempotent logical commands. Every caller supplies and retains an `operationId`; retrying the same command after a lost response, app restart, or IPC/HTTP switch returns the first committed or rejected result without cloning or advancing again. Reusing that ID for a different Card, occurrence, scope, update, or command kind returns a typed collision.
- Missing/unscheduled targets and invalid occurrence updates are durable rejections: an exact retry returns the same error, but no Card, schedule, exception, projection, or change-log entry is written. Complete and clone-capable update commands preallocate a UUID-v7 `createdCardId` as part of their canonical intent; complete/detach/split clone the source's current collaborative title/body and relational properties into that identity without creating another storage aggregate.
- Recurrence logs are not exposed in product UI or API.
- Occurrence schedule edits support scope: `this`, `this-and-future` (series split), and `all`.
- For recurring event drag/resize from Calendar, the app prompts with explicit scope choices before persisting. On the first occurrence in the current series, it shows `Only this occurrence` and `All occurrences`; on non-first occurrences, it shows `Only this occurrence` and `This and future`.
- Choosing `Only this occurrence` detaches that occurrence into a standalone non-recurring card while the original series skips that occurrence.
- Choosing `This and future` trims the original series to end the day before the selected occurrence and creates a new series from the selected occurrence onward; when selected on the first occurrence, it behaves like `All occurrences` (no split).
- For drag-based recurrence schedule moves (`All occurrences` and `This and future`), if the series has an inclusive end date (`untilDate`), that date shifts by the same calendar-day delta as the dragged occurrence so series length is preserved.
- Desktop reminders fire while the app is running, include startup/resume catch-up, and notification click deep-links to the target Card Stage. Calendar/reminder/snooze reads use the typed schedule index, current relational schedule metadata, and the Card's exact current collaborative title/body; stale index or legacy content coordinates fail closed instead of resurfacing compatibility-row data.

#### 12. Codex Threads (Electron-only in this phase)
- New chats are created for project sessions and linked through `project_session_threads`; cards can mention threads or send selected content to them, but cards do not own threads.
- The sidebar discovers active interactive Codex root threads globally through app-server `thread/list`, including chats created outside Nodex by Codex CLI, VS Code extension, or another local app-server client.
- External threads are automatically materialized into local sessions during sidebar sync. Nodex assigns them to the project whose source root is the longest normalized cwd prefix. Threads whose cwd does not match any project become projectless sessions and render under `Chats`.
- Projectless sessions have `projectId: null`, can open the thread stage, rename, archive, and pin like normal chats, but they do not switch the active project and cannot own DB View or project-only Card Stage tabs.
- Global thread pinning is stored in `codex_pinned_threads` and controls attached chat ordering in the sidebar pinned section. `project_sessions.pinned` is retained only as a compatibility mirror and for no-thread local rows.
- Active sidebar lists hide archived Codex threads, archived sessions, deleted threads, ephemeral side chats, side-conversation helper threads, background subagents, and detached internal reviewer/helper threads such as auto-review reviewer runs. Existing local rows that previously materialized these internal threads as sessions are repaired by archiving/detaching the leaked session and archiving the helper thread row.
- Newly created blank project chats render at the top of their normal project subtree below pinned rows such as the starter `Database View` session and above older normal chats. Projectless blank chats render at the top of `Chats`.
- Thread creation requires the first user prompt and immediately starts the first turn. The pending state belongs to the session/thread-start lifecycle, not to the composer button alone, and it remains visible for attached empty thread snapshots until the first visible turn replaces it.
- New threads auto-generate a concise title from the first user prompt in the main process after `thread/start` succeeds unless an explicit thread name or `skipAutoTitleGeneration` is provided.
- Auto-title generation uses a Codex-compatible structured helper: `gpt-5.4-mini`, low reasoning, read-only ephemeral system thread, 30-second turn timeout, web search/hooks disabled, and a `{ title: string }` JSON schema capped at 36 characters. Helper thread notifications are internal-only and never materialize as sidebar rows, thread stream state, or desktop notifications. Schema-invalid model output returns no title before cleanup; valid generated titles are normalized, applied optimistically, and persisted through `thread/name/set`. Manual rename still trims/folds whitespace and truncates to 60 characters. Auto-title generation and persistence failures are log-only and do not surface as user-visible host errors.
- Auto-title, manual rename, and app-server `thread/name/updated` notifications update `codex_threads.thread_name` and notify linked project sessions to refetch their derived `displayTitle`. `project_sessions.no_thread_fallback_title` is only used before a thread is attached or as the final display fallback.
- Empty project sessions show the new-chat composer for the first prompt; Card Stage does not create card-owned thread tabs.
- `Work locally` uses the selected project's primary source when available, otherwise a generated per-thread local workspace.
- `New worktree` run target creates a managed Git worktree under `${serverDir}/worktrees/<rand4>/<project-id>` and links thread cwd to that worktree.
- The new-chat `Start in` selector shows `Work locally` and `New worktree`; the environment selector is populated from `<workspace>/.codex/environments/*.toml`, with a `No environment` option and an `Environment settings` action that deep-links into the shared `Local environments` settings section for that project/config context.
- If `runInEnvironmentPath` is selected and points to a valid `.toml` file, Nodex reads the structured local-environment definition from Settings -> Local environments and runs its default `[setup].script` in the newly created managed worktree before `thread/start`.
- Environment setup failure aborts thread creation and best-effort removes the just-created managed worktree.
- The floating summary panel shows the `Environment` review/change section only for non-projectless git-backed attached threads with a resolvable cwd. Projectless threads keep deliverable artifacts in `Outputs` even when their cwd is a git repository, and non-git/projectless threads do not show disabled Environment placeholder rows.
- The floating summary panel `Commit or push` row opens a native Git dialog. The row surfaces commit/push blocker titles while disabled. In a detached HEAD checkout with a valid Git HEAD, the Environment branch row becomes `Create branch`; activating it opens a `Work here` branch setup dialog that creates and checks out a branch through the Git branch IPC. Managed worktree threads on their repository default branch keep the normal branch selector row and add a separate `Create branch` action above `Commit or push`. Activating `Commit or push` while detached, or while a managed-worktree default-branch checkout only has branch commits to push, runs the same branch setup first, then continues into the commit dialog after branch creation succeeds. Activating `Create pull request` from a managed-worktree default-branch checkout also runs branch setup first, then opens the native Create PR dialog after branch creation succeeds. The commit dialog reads repository status from the main process, supports committing staged changes or including unstaged changes, generates a blank commit message through the Codex app-server from the staged diff, can commit-and-push in one action, can push branch commits without local file changes, renders command-menu-style action rows for `Commit`, `Commit and push`, and `Push`, closes when an action starts, shows active workflow phase/cancel state on the summary row, and refreshes the summary Git state after a successful operation. Empty generated commit-message output aborts the commit instead of falling back to a guessed subject. The Create PR dialog reads Git and GitHub CLI state, opens existing PRs in the browser instead of creating duplicates, can commit and push local changes before creating a PR, generates missing PR title/body through the Codex app-server from branch diff context, supports draft PRs and create-then-open-in-browser, shows active `Generating messages…`, `Committing…`, `Pushing changes…`, and `Creating PR…` phases on the summary row, and refreshes summary Git/PR state after success.
- During `New worktree` creation, the new-chat panel shows a real-time setup log view (`Creating a worktree and running setup.`) with streamed progress from worktree creation and setup script output; `Work locally` uses the same session progress channel but renders as a compact sending/failure state without Worktree/Setup steps.
- Settings -> `Worktrees` shows managed inventory deduplicated by resolved worktree path (reused paths appear once).
- Settings -> `Worktrees` delete removes the managed directory (prefer `git worktree remove --force` when metadata is available, otherwise recursive delete) and unlinks all thread links that target the same managed path.
- Worktree base branch resolution order is: remote HEAD symbolic ref, then `main`, then `master`, then current branch, then first available local branch.
- Global worktree creation mode is configurable in Settings -> `Worktrees`: `Auto branch` (creates `<prefix><thread-slug>`; default prefix is `nodex/`, and thread slug is derived from the thread title by lowercasing, keeping the first 5 words, stripping non-`[a-z0-9]`, then joining with `-`) or `Detached HEAD` (default).
- `Cloud` run target is explicitly blocked in both renderer preflight and backend thread-start validation in this release.
- Sending from a card/editor to `New chat` creates the thread in the current session when the picker row is labeled `This session`; the bottom `This project` action reuses the current project's blank session or creates one. Both paths keep focus in the current editor/card surface.
- Running threads keep syncing in the background when users switch to another thread tab; returning to the running tab preserves live state (including stop affordance and existing tool-call logs).
- Thread tabs show a running indicator for actively executing threads.
- Sidebar thread entries (and the Threads group icon) switch to a running indicator while execution is active.
- Archiving a sidebar chat archives the app-server thread and the linked session when session-backed, or archives only the app-server thread when the sidebar row is snapshot-only; both paths optimistically suppress the row from active sidebar lists. Archiving clears global pin/unread state. App-server archive notifications received from another client perform the same local hiding. Unarchive notifications restore thread metadata only; re-showing the session is an explicit unarchive action.
- In-app account UX supports account read, ChatGPT/API-key login, login cancel, logout, and an authenticated quota indicator in the left sidebar footer. The footer indicator is a compact double ring: the outer ring shows the shorter window such as `5h` remaining, and the inner ring shows the weekly window remaining. Hovering or focusing the ring opens the existing account detail tooltip with email/plan, detailed remaining windows, reset timing when available, and sign-out; opening that tooltip refreshes account data. If authenticated rate-limit windows are unavailable, the footer shows a subdued connected indicator instead of percentages. Quota data also refreshes in the background every 60 seconds while the Codex connection is live and authenticated. Signed-out auth remains available from the thread header.
- Thread permissions are resolved from Codex app-server config (`config/read`) plus config requirements (`configRequirements/read`), not from renderer-local per-project preferences.
- Thread stage and Settings -> `Agent` expose the same preset-backed permission selector with the exact visible modes `Ask for approval`, `Approve for me`, `Full access`, and `Custom (config.toml)`.
- Permission preset semantics:
  - `Ask for approval` resolves to `sandbox_mode=workspace-write`, `approval_policy=on-request`, `approvals_reviewer=user`.
  - `Approve for me` resolves to the same sandbox/policy pair, but with `approvals_reviewer=auto_review`.
  - `Full access` resolves to `sandbox_mode=danger-full-access`, `approval_policy=never`, `approvals_reviewer=user`.
  - `Custom (config.toml)` remains available whenever config contains explicit permission keys and the resulting raw permission state is allowed, even if those values are equivalent to a fixed preset.
- `features.guardian_approval` disables `Auto-review` only when it is explicitly false; missing feature metadata does not disable the preset. `configRequirements/read.allowedPermissionProfiles`, `allowedApprovalsReviewers`, `allowedApprovalPolicies`, and `allowedSandboxModes` still constrain availability. `auto_review` and the legacy/internal alias `guardian_subagent` are treated as the same automatic-review reviewer when reading config or requirements, but Nodex writes the public `auto_review` literal.
- Permission writes target the current config key origin when available; otherwise Nodex writes to the user config file instead of silently creating a project override from the thread footer.
- Settings -> `Agent` uses a split surface:
  - `Permissions modes` contains `Default permissions mode`.
  - `Custom config.toml settings` contains raw controls for `Approval policy`, `Sandbox settings`, `Allow network access`, and `config.toml`.
- New thread start, later turn start, queued follow-ups, and thread resume all inherit the same resolved `approvalPolicy`, `sandbox`, and `approvalsReviewer` values from the main-owned permission resolver.
- Approval requests stay attached to the underlying transcript items instead of opening a separate approval screen:
  - command approvals attach to existing exec rows
  - file approvals attach to existing file-change rows
  - automatic approval review rows use the synthetic item id form `automatic-approval-review:{reviewId}`
- Thread stage composer exposes real Codex model and reasoning-effort selectors through one compact Intelligence footer control; the opened menu lists supported Intelligence options first, then Model and Speed flyouts. Existing-thread model and reasoning choices update the thread-owned next-turn settings path. New-thread drafts resolve model selection from visible app-server `model/list` entries: a persisted draft model is reused only while still visible, otherwise the `isDefault` model wins, then the first visible model, and no model override is sent when the list is unavailable or empty.
- Fast-mode core enablement is global, not per-thread. Detailed persistence, UI, request-resolution, queue-freezing, and reporting rules are defined in [Codex Fast Mode Core Enablement](./codex-fast-mode-core-enablement.md).
- New thread-start and turn-start requests inherit the persisted global `serviceTier` when callers do not provide one explicitly; explicit `null`/missing values normalize back to `standard` reporting and omit `serviceTier` from outgoing app-server payloads.
- Thread stage composer exposes collaboration mode presets (`Default`, `Plan`) sourced from app-server `collaborationMode/list` with a client fallback to `Default` + `Plan` when unavailable. Existing thread composers reflect `conversation.latestThreadSettings.collaborationMode` live, with `conversation.latestCollaborationMode` retained only as a derived compatibility value; new-thread drafts reflect the selected draft mode until the thread is created.
- Existing-thread collaboration mode selection is thread-owned next-turn state. Plan mode can be toggled from `Shift+Tab`, the add-context menu Plan row, the active Plan chip, `/plan-mode`, or the `plan` keyword suggestion above the prompt editor, and all entry points call the same toggle action.
- Thread and turn start requests resolve model, reasoning effort, and collaboration mode in this order: explicit prompt/submit override, latest thread settings, derived latest collaboration mode, then selector-resolved new-thread defaults. Empty or unavailable model selections are omitted from app-server payloads so Codex config remains the fallback authority; Nodex must not hardcode a concrete fallback model id. `Plan` mode sends built-in collaboration mode instructions by passing `developer_instructions: null` and enables clarifying-question flows through `item/tool/requestUserInput`.
- Thread stage composer places the add-context menu and permission selector on the left side of the composer footer, while context usage, compact model/reasoning/speed, dictation, and send/stop controls sit on the right. When Plan mode is active, its direct toggle appears as a footer accessory after the permission selector with a subtle vertical divider before it. The add-context menu uses a compact `+` trigger and contains `Add photos & files` (`Add photos` when images-only), optional `Include IDE context`, `Plan mode`, and optional `Plugins`; Speed remains only in Intelligence.
- Thread stage composer input is a ProseMirror-backed contenteditable prompt editor. Blank new-chat drafts show the `Do anything` placeholder, existing threads show `Ask for follow-up changes`, and active Plan mode shows `Describe your task to generate a plan...`; dictation/attachment/send behavior uses the same normalized prompt flow as before.
- Thread stage composer supports thread prompt recall from an empty draft. With the cursor at the end and no modifier keys, `ArrowUp` first edits the latest visible queued follow-up when the composer has no prompt or attachments and no busy/slash-menu state; otherwise it restores the newest persisted prompt-history entry. Additional `ArrowUp`/`ArrowDown` presses wrap through the scoped history, `ArrowDown` from the newest recalled entry clears the composer, manual edits exit traversal, and successful prompt submissions append non-blank text to the current scope's latest 20 entries. This prompt history is local UI persisted state, separate from thread/conversation history and app-server APIs.
- Typing a slash token at the start of the prompt or after whitespace opens the thread slash-command menu above the composer. The menu uses grouped fuzzy filtering, preserves a keyboard-highlighted row, supports ArrowUp/ArrowDown/Enter/Escape, mouse hover/click selection, `No commands` empty state, nested content panels for commands such as Model, Reasoning, Fork, MCP, Memories, Feedback, Project, and Personality, and direct mode commands such as Goal. Goal remains available in existing threads that support thread-goal actions and in pre-start new-chat surfaces that can start a session thread; selecting it enters goal mode, and new-chat submit carries the objective as a thread-goal draft for post-create goal setup. Direct commands clear the slash token before running; inline skill commands replace the slash token with the structured skill mention path. Context-conflicting command rows such as projectless Chat and hotkey-window commands remain hidden until their Nodex runtime path exists.
- Thread stage composer shell uses static chrome: rounded input background, subtle ring, backdrop blur, and a fixed shallow shadow with no added focus-within elevation when the editor is active.
- Add-context picker non-image files become prompt mentions, picked images are read as data URLs and sent as image inputs, and picker attachments remain separate from paste/drop/Add-to-chat file provenance. Running-turn steer sends the same normalized prompt input shape as normal turns; unaccepted steers are restored as queued follow-ups if the active turn ends too early.
- Thread stage request cards replace the normal composer editor, attachments, add-context, permission, context, Intelligence, dictation, and send/stop footer controls while they are active. Existing-thread request cards do not render the new-chat-only lower status strip.
- Thread stage composer lower status row is a pre-start new-chat-only attached strip mounted through the composer-owned external footer slot under the raised home composer surface. It shows the selected project when available, the local run target (`Work locally`) or `Start in` selector, optional environment selection for `New worktree`, and the real Git branch for the selected primary source; once a conversation exists, existing-thread composers do not mount this lower row.
- Thread stage composer shows the context-window meter tooltip from the composer footer: unavailable data falls back to `0% used (100% left)`, ready data rounds token counts to whole thousands, usage below `50%` reads `{usage}% used ({remaining}% left)`, usage at or above `50%` reads `{usage}% full`, and the `Codex automatically compacts its context` line appears only for ChatGPT-authenticated sessions without an explicit `modelProvider`.
- Thread stage composer includes dictation as a separate buffered speech-to-text feature in Electron: the mic button is shown in supported ChatGPT-authenticated sessions, tooltip copy is `Click to dictate or hold`, `Ctrl+M` starts on keydown and stops on keyup with `insert`, button click starts recording, recordings shorter than `250ms` are discarded locally, and stop actions stay split between `Stop dictation` (`insert`) and `Transcribe and send` (`send`) before one `/transcribe` POST returns transcript text.
- Threads composer uses one round icon button: it sends when idle, shows a spinner immediately while the prompt send is pending, and switches to a stop icon while Codex is running so users can interrupt immediately.
- Threads composer send behavior defaults to `Enter` (with `Shift+Enter` for newline). Settings -> Editor exposes `Cmd/Ctrl+Enter to send long prompts`; when enabled, single-line drafts still submit on `Enter`, multiline drafts switch primary submit to `Cmd/Ctrl+Enter`, and running-thread alternate queue/steer submit moves to `Cmd/Ctrl+Shift+Enter`. Running-thread primary and alternate submits carry explicit `Queue` or `Steer` actions so alternate queue submissions cannot fall through to normal steer.
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
- **HTTP Server Port**: Configurable via `[server].port` / `NODEX_PORT` (default 51283)
- **Drag & Drop**: @atlaskit/pragmatic-drag-and-drop, @atlaskit/pragmatic-drag-and-drop-auto-scroll
- **Database**: better-sqlite3 (in main process)
- **Real-Time**: IPC events (Electron) / SSE (browser fallback)
- **Codex Runtime**: main-process `codex app-server --listen stdio://` JSON-RPC bridge
- **Transport**: Dual-mode — IPC when in Electron, HTTP fetch when in browser
- **Codex Transport**: Electron IPC only (browser runtime unsupported in this phase)
- **Package Manager**: pnpm (pinned through `packageManager`)
- **Development Runtime**: Node 24.15.0
- **Tests**: Vitest projects for Node, Electron-main, renderer, browser, and integration behavior; Playwright for Electron/browser E2E
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
│   ├── nodex.db               # SQLite database
│   ├── nodex.db-wal           # Write-ahead log
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
│   │   └── local-store/
│   │       ├── config.ts       # Configuration (NODEX_DIR + backup env)
│   │       ├── database.ts     # SQLite connection, init, and legacy filename migration
│   │       ├── projects.ts     # Project CRUD and run context
│   │       ├── project-sessions.ts # Session tree, tabs, and thread links
│   │       ├── cards.ts        # Card-named create/read facade over Block/Document authority
│   │       ├── block-document-store.ts # Y.Doc update/snapshot/receipt authority
│   │       ├── block-property-mutations.ts # Field/path property authority
│   │       ├── database-kernel.ts # Database/membership/property/View authority
│   │       ├── board-read-model.ts # Board summary/detail/search reads
│   │       ├── card-occurrences.ts # Calendar occurrence actions
│   │       ├── backups.ts      # Backup create/list/restore + auto scheduler
│   │       ├── assets.ts       # Image/resource upload, storage, and read helpers
│   │       ├── notifier.ts     # EventEmitter for local-store changes
│   │       ├── schema.ts       # Latest database schema bootstrap + version guard
│   │       ├── card-history.ts # Canonical merged Card history read model
│   │       └── block-first-finalization.ts # v69→v70 migration-only fixed point
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
│       │   │   ├── board.tsx              # DnD context and Database View layout
│       │   │   ├── column.tsx             # Column with droppable
│       │   │   ├── card.tsx               # Draggable card
│       │   │   ├── card-dialog.tsx        # Card creation dialog
│       │   │   ├── inline-card-creator.tsx
│       │   │   ├── list-view.tsx          # Table view of all cards
│       │   │   ├── toggle-list-view.tsx   # Rule-driven summary rows + lazy Card Documents
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
│       │   │       ├── database-view-ref-block.tsx # Canonical durable Database View reference
│       │   │       ├── card-ref-block.tsx # Canonical Card reference + lazy target surface
│       │   │       ├── copy-image.ts      # Clipboard helpers for image block copy action
│       │   │       ├── copy-image-button.tsx # Custom image floating toolbar action
│       │   │       ├── search-extension.ts # ProseMirror decoration plugin for in-editor find
│       │   │       ├── notion-paste.ts    # Notion clipboard parser + paste insertion helpers
│       │   │       ├── toggle-backspace.ts # Toggle child Backspace merge handler
│       │   │       ├── toggle-enter.ts    # Toggle child Enter handlers (enter-to-child, empty-enter)
│       │   │       ├── nfm-schema.tsx     # Custom BlockNote schema including canonical references
│       │   │       ├── toggle-list-schema.ts # Toggle-list schema with canonical references
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
│           ├── use-projects.ts   # React hook for project CRUD
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
| POST | `/api/projects/[projectId]/sessions` | Create a project-owned session (body: `{noThreadFallbackTitle}`) |
| PUT | `/api/projects/[projectId]/sessions/reorder` | Reorder sessions (body: `{orderedSessionIds}`) |
| PUT | `/api/projects/[projectId]/sessions/pinned-order` | Reorder pinned sessions inside the project (body: `{orderedSessionIds}`) |
| PUT | `/api/project-sessions/[sessionId]` | Update no-thread fallback label, left-pane state, or panel state |
| PUT | `/api/project-sessions/[sessionId]/rename` | Rename a session using manual chat-title sanitization (body: `{title}`); whitespace-only input is a no-op |
| PUT | `/api/project-sessions/[sessionId]/pinned` | Pin or unpin a session (body: `{pinned}`) |
| PUT | `/api/project-sessions/[sessionId]/archive` | Archive a session and linked Codex thread when attached |
| PUT | `/api/project-sessions/[sessionId]/unarchive` | Unarchive a session and linked Codex thread when attached |
| PUT | `/api/codex/threads/[threadId]/archive` | Archive a snapshot-only Codex thread without requiring a local session |
| PUT | `/api/codex/threads/[threadId]/unarchive` | Unarchive a snapshot-only Codex thread without requiring a local session |
| PUT | `/api/project-sessions/[sessionId]/unread` | Mark a session read/unread (body: `{unread}`) |
| POST | `/api/project-sessions/[sessionId]/fork` | Fork an attached session thread into a new project session (body: `{target: "local" \| "newWorktree", turnId?, message?, collaborationMode?}`) |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]` | Update a `right` or `bottom` panel's collapsed state, layout, or size |
| POST | `/api/project-sessions/[sessionId]/panels/[panelId]/split` | Split a panel group left/right/up/down, optionally moving a selected tab into the new group |
| POST | `/api/project-sessions/[sessionId]/panels/[panelId]/merge` | Close or merge a panel group; non-empty groups merge tabs into the nearest visual neighbor first |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/active-group` | Activate a panel group and optionally one tab in that group |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/resize-group` | Persist a split branch sash ratio |
| PUT | `/api/project-sessions/[sessionId]/panels/[panelId]/maximized-group` | Set or clear the temporarily maximized panel group |
| DELETE | `/api/project-sessions/[sessionId]` | Delete a session |
| POST | `/api/project-sessions/[sessionId]/tabs` | Create a session tab (body: `{projectId, panelId, clientTabId?, kind, title, config}`) |
| PUT | `/api/project-session-tabs/[tabId]` | Update a session tab title or validated config |
| PUT | `/api/project-session-tabs/[tabId]/state` | Update a tab state key/value pair |
| PUT | `/api/project-session-tabs/[tabId]/move` | Move a tab between panels, target leaves, or a split target; optional `preserveEmptyLeafIds` keeps renderer-local visible leaves alive |
| DELETE | `/api/project-session-tabs/[tabId]` | Delete a session tab; optional `preserveEmptyLeafIds` keeps renderer-local visible leaves alive |
| PUT | `/api/project-sessions/[sessionId]/tabs/reorder` | Reorder tabs in one panel leaf (body: `{panelId, leafId?, orderedTabIds}`) |
| PUT | `/api/project-sessions/[sessionId]/thread` | Attach or update a session-owned thread link |
| DELETE | `/api/project-sessions/[sessionId]/thread` | Detach the session-owned thread link |

#### Card and Board Routes (project-scoped)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/board-summary` | Fetch the bounded primary Database View summary without full Card bodies |
| GET | `/api/projects/[projectId]/column` | Fetch a single board status group (query: `?id=<status>`) |
| GET | `/api/projects/[projectId]/card` | Read one Card product projection assembled from current Block/Document/Database authority |
| POST | `/api/projects/[projectId]/cards/details` | Read bounded selected Card detail projections |
| POST | `/api/projects/[projectId]/card-lifecycle-mutations` | Create, archive/restore, or tombstone a Card Block and owned Document through one idempotent lifecycle command |
| GET | `/api/projects/[projectId]/card-lifecycle-preflight` | Read exact lifecycle/ownership evidence needed to compile a lifecycle command |
| POST | `/api/projects/[sourceProjectId]/card-transfers` | Atomically transfer a top-level Card and recursively owned Document closure to another Project |
| POST | `/api/projects/[projectId]/block-transfers` | Atomically Move/Copy stable Blocks or Cards between Space, Document, and Database parents |
| POST | `/api/cards/search` | Search exact-head Block/Document units across selected Projects and return bounded excerpts |
| GET | `/api/projects/[projectId]/calendar/occurrences` | List calendar occurrences in a time window (`?start=ISO&end=ISO&search=...`) |
| POST | `/api/projects/[projectId]/card-occurrence/complete` | Complete one occurrence (body: `{operationId, createdCardId, cardId, occurrenceStart, source, sessionId?}`) |
| POST | `/api/projects/[projectId]/card-occurrence/skip` | Skip one occurrence (body: `{operationId, cardId, occurrenceStart, source, sessionId?}`) |
| PUT | `/api/projects/[projectId]/card-occurrence` | Update occurrence timing with scope (body: `{operationId, createdCardId?, cardId, occurrenceStart, source, scope, updates, sessionId?}`; `createdCardId` is required for `this` and `this-and-future`) |
| GET | `/api/projects/[projectId]/events` | SSE stream for real-time updates |
| GET | `/api/projects/[projectId]/cards/[cardBlockId]/history` | Cursor-paginated canonical Card timeline merged from Document checkpoints and Block mutation/relocation evidence |
| POST | `/api/projects/[projectId]/query` | Execute read-only SQL query |
| GET | `/api/projects/[projectId]/schema` | Get database schema |

The former board-create, Card-delete, and description-write snapshot endpoints return `410 Gone` and identify the lifecycle or Document mutation replacement. No HTTP route accepts a whole-Card update.

#### Block Document Routes (project-scoped)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/blocks/[ownerBlockId]/document` | Read the exact owned-Document descriptor without changing authority |
| POST | `/api/projects/[projectId]/blocks/[ownerBlockId]/document/prepare` | Validate and return the exact ready descriptor with its `yjs` or `canvas_scene` sync-engine discriminant |
| GET | `/api/projects/[projectId]/documents/[documentId]/events` | Subscribe to targeted engine-discriminated events before synchronization |
| POST | `/api/projects/[projectId]/documents/[documentId]/sync` | Send a state vector and receive the missing binary update plus current durable head |
| POST | `/api/projects/[projectId]/documents/[documentId]/updates` | Submit one idempotent binary update; success is acknowledged only after SQLite commit |
| POST | `/api/projects/[projectId]/documents/[documentId]/awareness` | Publish bounded ephemeral presence; it never mutates content or SQLite |
| POST | `/api/projects/[projectId]/documents/[documentId]/canvas-scene/sync` | Load the bounded full canonical Canvas scene at its current durable head |
| POST | `/api/projects/[projectId]/documents/[documentId]/canvas-scene/mutations` | Merge one idempotent bounded element/app-state/file mutation and return its durable receipt |
| POST | `/api/projects/[projectId]/documents/[documentId]/relocation-leases/[leaseId]/responses` | ACK/NACK a surface-local relocation freeze after its pending edits are durable |
| POST | `/api/projects/[projectId]/documents/[documentId]/mutations` | Apply a stable-ID title/insert/update/delete/move or CAS-gated NFM replacement batch |
| GET/POST | `/api/projects/[projectId]/documents/[documentId]/versions...` | List/get/checkpoint immutable Document versions and forward-restore one version through a write fence |
| POST | `/api/projects/[projectId]/block-property-mutations` | Apply a versioned field-level intrinsic/Database property batch with scalar CAS or set add/remove intent and an immutable typed receipt |
| GET | `/api/projects/[projectId]/databases/management` | Read the Database catalog plus all active Card membership/position authority under one store epoch and change cursor |
| POST | `/api/projects/[projectId]/database-mutations` | Apply exact-revision schema, value, View, or selected-View position operations with one immutable receipt; parent/membership changes use `block-transfers` |
| POST | `/api/projects/[projectId]/document-commands` | Create/promote/demote/instantiate/tombstone registered Synced, Template, Large, or Canvas Document owners |

#### Asset Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/assets/images` | Upload image via multipart `file`; returns `{source}` with canonical `nodex://assets/<file-name>` URI |
| POST | `/api/assets/resources` | Upload or materialize pasted text/files/folders; accepts multipart `file` or JSON `{localPath}` and returns `{source, name, mimeType, bytes}` |
| GET | `/api/assets/[fileName]` | Serve asset bytes for editor/read-only rendering |

### Database Schema

Schema v74 is Block-first. `blocks` gives every active Card one Space, Document, or Database parent; a Database parent has one matching active membership, and each Card/Database pair retains at most one stable historical membership for dormant-value restoration. `retired_block_identities` permanently reserves collected IDs; `documents` plus `block_documents` own independently synchronized content and select its sync engine. Yjs tables own `block_tree` causal state; Canvas scene tables and immutable receipts own normalized `scene_graph` state. Database records model membership/properties/Views without copying Cards, mutation/history evidence is immutable, and read projections remain rebuildable at exact authority coordinates. A supported v69 store finalizes through v70, scene-native Canvas v71, exclusive-parent v72, stable-membership v73, and rich Card title projection/schema v74 in order. Failure leaves the prior schema edge intact and blocks readiness.

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
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  no_thread_fallback_title TEXT NOT NULL, -- max 2,000 chars; not thread title authority
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

-- Block identity and location
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  lifecycle TEXT NOT NULL,          -- active | archived | deleted
  location_kind TEXT NOT NULL,      -- space | document
  containing_document_id TEXT,
  location_revision INTEGER NOT NULL,
  metadata_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, project_id)
);

-- Engine-neutral Owned Document identity and durable coordinates
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  head_seq INTEGER NOT NULL,
  schema_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  readiness TEXT NOT NULL,          -- pending_genesis | ready | failed
  sync_engine TEXT NOT NULL,        -- yjs | canvas_scene
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, project_id)
);

-- Yjs operational updates/snapshots are used only for sync_engine = 'yjs'.
-- Canvas current authority and exact-retry receipts live in canvas_scenes,
-- canvas_scene_elements, canvas_scene_files, and canvas_scene_mutation_receipts.

CREATE TABLE block_documents (
  block_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (block_id, project_id) REFERENCES blocks(id, project_id),
  FOREIGN KEY (document_id, project_id) REFERENCES documents(id, project_id)
);

CREATE TABLE document_updates (
  document_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  update_id TEXT NOT NULL,
  client_session_id TEXT NOT NULL,
  base_head_seq INTEGER NOT NULL,
  update_blob BLOB NOT NULL,        -- row is compactable after verified snapshot
  update_hash TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (document_id, generation, seq),
  UNIQUE (document_id, update_id)
);

CREATE TABLE document_update_receipts (
  document_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  update_id TEXT NOT NULL,
  update_hash TEXT NOT NULL,
  update_byte_length INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (document_id, generation, seq),
  UNIQUE (document_id, update_id)
);

-- Database capability, membership, typed property values, Views, and
-- View-specific positions are relational authority. Document materializations,
-- Card read models, search units, schedule rows, and asset refs are rebuildable.
-- document_versions, block_mutations, block_relocations, change_log, and
-- recovery artifacts are durable history/retry evidence.

-- Codex thread metadata; session ownership lives in project_session_threads
CREATE TABLE codex_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_thread_id TEXT,
  thread_name TEXT,
  thread_source TEXT,
  agent_nickname TEXT,
  agent_role TEXT,
  thread_preview TEXT NOT NULL DEFAULT '',
  model_provider TEXT NOT NULL DEFAULT '',
  cwd TEXT,
  managed_worktree_path TEXT,
  projectless_output_directory TEXT,
  status_type TEXT NOT NULL DEFAULT 'notLoaded',
  status_active_flags_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_codex_threads_project_updated
  ON codex_threads(project_id, updated_at DESC);

CREATE TABLE codex_pinned_threads (
  thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  pinned_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Command palette chat content search read model
CREATE TABLE thread_search_units (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES project_sessions(id) ON DELETE SET NULL,
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE thread_search_thread_state (
  thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  source_updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  index_version INTEGER NOT NULL DEFAULT 1,
  unit_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  failed_at INTEGER,
  retry_after INTEGER
) WITHOUT ROWID;
```

### Real-Time Sync Flow

**Electron path (IPC):**
```
Database Write → EventEmitter (notifier) → mainWindow.webContents.send()
    → window.api.on("board-changed") → useKanban hook → UI re-renders
```

Primary Card Document edits use the independent binary collaboration plane:

```
Card Stage Y.Doc transaction → durable FIFO Document apply → SQLite commit/ACK
    → Document subscriber fanout + same-head CardSummary materialization event
    → other mounted surfaces apply remote origin; board summaries patch from projection
```

Each surface subscribes before its state-vector handshake. Missed or reordered realtime events are repaired by a later handshake; a fast successful ACK shows no save indicator. Browser clients use the equivalent binary POST + Document SSE Adapter. Both transports reach the same Document authority and no Card snapshot write exists.

Agent-facing body edits use ordered stable-ID Document operations (`set title`, `insert`, `update`, `delete`, and `move`) against the current Card Document. A batch either commits its Yjs update, Block registry/indexes, projections, mutation receipt, and change cursor together or changes nothing. Identity-destructive operations require mounted editors to flush and freeze behind a short write fence; stale overlapping edits are retained as recovery artifacts rather than silently overwritten. Whole NFM input is an explicit compare-and-swap import that compiles into these operations and never reconstructs the Y.Doc from a projection.

Electron exposes this contract as `block-documents:mutate`. Browser and CLI clients use `POST /api/projects/:projectId/documents/:documentId/mutations`. Client-supplied `actor`, `clientSessionId`, Project, or Document scope cannot mint authority: the host binds audit identity and route scope before the request reaches the Hub. The response is a typed immutable receipt or typed conflict; structural fence proof is never part of the public body.

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
- `[local-store-path]` - path to local store directory (default: `~/.nodex`)
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
nodex block descriptor <card-id> # Read Document id/epoch/generation/head
nodex block apply <card-id> <json|@file|@-> # Stable-ID operation batch
nodex block replace <card-id> <nfm|@file|@-> # Explicit NFM CAS import
nodex block title <card-id> <text> # Collaborative title replacement
nodex block export <card-id>      # Export title + materialized NFM
nodex block command <json|@file|@-> # Synced/Template/Large Document command
nodex rm <card-id>               # Delete card (auto-resolves column)
nodex mv <card-id> <from> <to> [order] [opts] # Move card (atomic claim)
nodex transfer <card-id> <target-project> <target-status> # Transfer Card + owned Documents
nodex history <card-id>          # View the Card-scoped durable cursor timeline
nodex database catalog           # List Databases and owning membership counts
nodex database members <database-id> # List current Card memberships
nodex database membership <card-id> <database-id|none> [view-id] # Move the Card to a Database or back to Space through BlockTransfer
nodex database view-update <view-id> <json|@file|@-> # Update that exact durable View
nodex query "<sql>" [params...]  # Run read-only SQL query
nodex schema                     # Show database schema
nodex backups [subcommand]       # List/create/restore backups
# Aliases: list/show/create/remove/delete/move/hist
```

Agent command options:
- `-p, --project <id>` - Project to operate on (default: "default")
- `--url <url>` - Server URL override
- `--session-id <id>` - Stable client session identity for mutation audit
- `nodex transfer` accepts paired `--target-database` / `--target-view`, optional logical placement anchors, and `--mutation-id` for response-loss retry; omitting the pair selects the target Project's primary Database View.
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
- `--mutation-id <id>` - Stable identity for an exact-retry Document mutation
- `--expected-head <seq>` - Explicit Document CAS head (obtain it with `nodex block descriptor`)

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
4. Env vars: `NODEX_*` for agent and server settings
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
history_retention = 1000 # retained newest deleted Block roots; legacy config key
```

**Dev/production separation**: Use project-level `.nodex/config.toml` for dev settings (different port/dir) and `~/.nodex/config.toml` for production. When running `nodex --dev` from a project directory, the project-level config takes priority. When the Electron app is launched directly (e.g., from Dock), only `~/.nodex/config.toml` is read.

**Electron renderer API base resolution**: Main process resolves server port from the same config chain (`config.toml` + env), starts HTTP server on that port, and injects `serverUrl` through preload. Renderer HTTP helpers (including image upload and asset URL resolution) consume this runtime URL so `[server].port` changes are honored; browser mode uses same-origin except local Vite dev (`:51284`) which falls back to default API port (`:51283`).

### Server Environment Variables
```bash
NODEX_DIR=~/.nodex     # Local store directory (default: ~/.nodex)
NODEX_PORT=51283        # Port (default: 51283)
NODEX_BACKUP_AUTO_ENABLED=false   # Enable auto backups (default: false)
NODEX_BACKUP_INTERVAL_HOURS=6    # Auto backup interval in hours (default: 6)
NODEX_BACKUP_RETENTION=28        # Auto backup retention count (default: 28)
NODEX_HISTORY_RETENTION=1000    # Retain newest deleted Block roots per project (legacy key; 0 keeps no count-protected tombstones)
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

In the desktop app, Settings -> Backups updates `~/.nodex/config.toml` `[server]` backup fields and reapplies the auto-backup scheduler immediately. If `NODEX_BACKUP_*` environment variables are set, those values remain effective and the UI marks the overridden fields.

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
pnpm install
pnpm run dev              # electron-vite dev (renderer on :51284, HTTP API on :51283)
```

### Production
```bash
pnpm run build            # electron-vite build → out/
electron .               # runs package main: out/main/bootstrap.js
```

### Packaging & Release
```bash
pnpm run package          # Build + create macOS DMG + ZIP in dist/
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
| List cards | `nodex ls [status]` | GET `/api/projects/[projectId]/board-summary` or `/column` |
| Get card | `nodex get <id>` | GET `/api/projects/[projectId]/card?cardId=Y` |
| Create card | `nodex add <status> <title>` | POST `/api/projects/[projectId]/card-lifecycle-mutations` plus typed properties |
| Update card | `nodex update <id> [opts]` | Block property mutation and/or Document mutation APIs |
| Read Card Document boundary | `nodex block descriptor <id>` | POST `/api/projects/[projectId]/blocks/[cardId]/document/prepare` |
| Apply stable-ID Block operations | `nodex block apply <id> <json>` | POST `/api/projects/[projectId]/documents/[documentId]/mutations` |
| Import/export collaborative body | `nodex block replace/export ...` | Document mutation API / authoritative Card read projection |
| Change document-bearing ownership | `nodex block command <json>` | POST `/api/projects/[projectId]/document-commands` |
| Delete card | `nodex rm <id>` | POST `/api/projects/[projectId]/card-lifecycle-mutations` |
| Move card | `nodex mv <id> <from> <to> [opts]` | GET primary View snapshot + POST `/api/projects/[projectId]/database-mutations` |
| Card history | `nodex history <id>` | GET `/api/projects/[projectId]/cards/[cardBlockId]/history` with a source-specific cursor |
| SQL query | `nodex query "<sql>"` | POST `/api/projects/[projectId]/query` |
| Schema | `nodex schema` | GET `/api/projects/[projectId]/schema` |
| List backups | `nodex backups` | GET `/api/backups` |
| Create backup | `nodex backups create` | POST `/api/backups` |
| Restore backup | `nodex backups restore <id> --yes` | POST `/api/backups/[backupId]/restore` |

Card commands keep product terminology while compiling to Block-first authority. `mv` requires explicit `<from> <to>` status intent and commits status plus View position as one Database mutation; a stale captured revision fails the whole request. Title/body commands resolve the owned Document and send an exact generation/head mutation; callers retry a lost response with the same mutation ID and expected head. `nodex update --title/--description` uses that Y.Doc path, while metadata options compile to field/path property mutations.

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
- **Single file**: One `nodex.db` contains all projects, easy to manage
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
- **Restore safety**: A continuous maintenance fence, auto safety backup, integrity validation, and durable DB/WAL/assets restore journal protect against failed or interrupted restores
- **Whole-store recovery**: Backups include both `nodex.db` and `assets/`

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
- **Transport consistency**: `local-store/card-input-validation` protects both HTTP and Electron IPC writes
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
- **DRY behavior**: Toggle List and inline references reuse one summary-row, visibility, provider-budget, and independent Card Document surface
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

### Why Surface-Local Undo and Forward History?
- **Collaborative safety**: each mounted Yjs surface tracks only its own local transaction origins, so a user cannot undo another window's edits.
- **Clear persistence boundary**: fast typing undo is ephemeral editor state; durable checkpoints and Block mutation evidence survive restart in SQLite.
- **Forward recovery**: restoring a checkpoint appends a new validated Yjs update and audit receipt instead of rewinding CRDT causality or rebuilding a Card snapshot.
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
| **Card** | The user-facing document-like Block; its Card ID is its Block ID and it owns one collaborative Document |
| **Column** | A vertical list representing a workflow stage |
| **Block** | The single persistent application identity for content, including Cards, Databases, ordinary body nodes, and references |
| **Document** | Independently synchronized content owned by a registered document-bearing Block; its schema selects `yjs` or `canvas_scene` |
| **Project** | The Space, filesystem/execution, and data-isolation boundary for Blocks, Documents, Databases, and agent work |
| **Card Stage** | Panel for viewing/editing Card properties and its independently synchronized title/body Document |
| **SSE** | Server-Sent Events for real-time updates (browser mode) |
| **IPC** | Inter-Process Communication between Electron main and renderer |
| **Transport** | Abstraction layer (`api.ts`) that routes calls to IPC or HTTP |
| **Main Process** | Electron process hosting SQLite, IPC handlers, and Hono HTTP server |
| **Preload** | Electron script that bridges main ↔ renderer via contextBridge |
| **Session ID** | UUID identifying one client session for audit, presence, and exact mutation attempts |
| **History Panel** | App-shell modal showing a Card's canonical timeline and retained Document checkpoint previews |
| **Mutation receipt** | Immutable evidence that one logical Block/Document/Database command committed or was durably rejected |
