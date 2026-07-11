# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Added stable-ID Card Document mutation APIs and `nodex block` CLI commands for title, NFM import/export, and Block insert/update/delete/move operations, with exact-head receipts, equivalent Electron/browser behavior, and short editor flush/freeze fences for identity-destructive changes.
- Added stable Block property mutation APIs for field-level scalar conflict detection and set add/remove intent, with equivalent Electron and browser behavior and exact retry receipts.
- Added same-window and cross-window drag-and-drop between Kanban and Card Stage/Toggle List editors, with ordered multi-item moves, Alt/Option copy, cross-project transactions, rollback-safe editor insertion, and atomic cross-project undo/redo.
- Added a packaged macOS startup prompt that offers to move Nodex into Applications before launching from another location.
- Added opt-in Sentry crash diagnostics with a General settings toggle, local-content scrubber, and release source-map upload for readable production stacks.
- Added a separate opt-in Sentry Session Replay toggle for masked renderer replays on diagnostic sessions.
- Added opt-in Statsig product telemetry with anonymous identity, filtered web analytics, and General settings toggles.
- Added source-backed local projects with ordered source folders, UUID-only project identity, and server-side project creation.
- Added a sidebar add-project menu with `Start from scratch` and `Use an existing folder` flows.
- Added draggable project folders in the Workbench sidebar, including pointer and keyboard reordering, stationary source ghosts, compact drag previews, precise insertion indicators, pinned project groups, a Pinned section, and drag-to-pin behavior.
- Added a real project Files tab with a workspace tree, Codex-style filtering and file tab ids, local file previews, external-open actions, and migration from older placeholder tabs.
- Added a slash-command menu above the Thread composer, including inline grouped filtering, keyboard selection, nested command panels, app-server-backed Compact/Goal/Memory/Feedback actions, MCP status, model/reasoning/service-tier controls, contextual hidden commands, and Storybook coverage.
- Added Browser tabs with Electron webview navigation chrome, local-server new-tab discovery, full-bleed retained page hosting across tab switches and panel hide/show, device toolbar presets, zoom and browsing-data controls, screenshot/comment affordances, browser-use overlay state, and multi-tab context actions.
- Added Codex-style project session shell behavior for session pinning and native sidebar session context menus, including direct filled row pin buttons, archive/unread state, copy/reveal/fork/open actions, and `nodex://sessions/<session-id>` deeplinks.
- Added app-window Back/Forward titlebar controls with matching keyboard, mouse, command-palette, and macOS menu entry points.
- Added the global bottom-panel toggle beside the side-panel toggle, with active/ghost toolbar states.
- Added a Notion-style floating text action menu for NFM rich-text selections, with tokenized chrome, supported text/link/block actions, development-only mock controls, and Nodex send-block actions where Card Stage callbacks are available.
- Added Settings -> Keyboard shortcuts with searchable editable command shortcuts, capture, conflict checks, per-command reset, reset-all, shared runtime/menu labels, and user-level config persistence.
- Added right and bottom session panels with shared tab chrome, panel-scoped ordering, cross-panel tab moves, a bottom-panel Terminal default, and eligible bottom actions for Files, Side chat, Browser, Review, and Terminal.
- Added splitable tab groups for right and bottom session panels, including nested horizontal/vertical groups, sash resizing, tab split actions, leaf-scoped previews and side chats, live tab-row insertion previews, and body-edge drag splitting within a panel.
- Added temporary Side chat conversations in right or bottom panels, including empty-panel, header-menu, `/side`, and selected-text `Ask in side chat` overlay entry points, loading/expired states, background discard on close, and migration cleanup for older saved durable launcher rows.
- Added a right-panel Plan tab for completed proposed-plan cards, with an in-thread preview card that opens full markdown in the side panel and collapses while that tab is active.
- Added ephemeral panel previews for Files and Browser tabs in either right or bottom panel; they replace the prior preview in the same panel and persist only after the user interacts with or pins the preview.
- Added a native floating-summary `Commit or push` workflow for local Git threads, including managed-worktree branch setup from detached or default-branch checkouts, commit, app-server-generated blank-message commit messages, commit-and-push, push, create-PR setup, blocker titles, and cancellable workflow-state actions backed by main-process Git operations.
- Added a public changelog page at `nodex.jyu.app/changelog`, generated from the project changelog file.
- Added chat rename entry points for active project sessions, including title double-click, thread/header actions, command palette, macOS menu, and `Cmd/Ctrl+Alt+R`.
- Added sidebar-wide chat search to the command palette, including projectless/sessionless sidebar chats, fuzzy metadata matches, bounded FTS5 local content snippets, and direct navigation through chat session materialization.
- Added a floating `Cmd/Ctrl+F` content search input for chat, review diff, and active Browser page search, while keeping DB task search and settings search scoped to their existing surfaces.
- Added line-level Review diff comments with hover `+`, range selection, local request-change annotation cards, pending composer attachment chips, and inline GitHub PR review-comment API support.
- Added a left-side Thread user-message navigation rail for longer conversations, with hover previews, output pills, paged and background-filled long-transcript history, restored scroll position, stable latest-turn follow, smooth click/find jumps, and drag scrubbing.
- Added a project session shell with expandable project folders, a sidebar `New chat` entry, project-row new-chat actions, durable sessions, a session thread page, session-owned panel tabs, browsers, and separate optional session-thread attachments.
- Added SQLite-backed project session, project session tab, and session-thread link storage with ordinary pinned `Database View` starter sessions seeded for every project.
- Added a project selector in the empty session new-chat status row so a first prompt can target another project before the thread starts.
- Added a `Start in` selector to empty session new-chat composers, including `Work locally` and managed `New worktree` starts with environment setup progress.
- Added NFM thread mentions so card descriptions can reference and open Codex threads with `<mention-thread uuid="..." />`, with the `@` picker using command-palette chat/card search for sidebar-wide chat mentions, content snippets, fuzzy card metadata, card description hits, current-project-first grouping, cleaner mention rows, and compact hover context.
- Added NFM date mentions with `<mention-date ... />`, `@today`/`@now` insertion, a text-level inline chip, tokenized date-picker popover editing, date ranges, time, format, and inline reminder payloads.
- Added a real `Send to chat` picker to the NFM text-selection menu, including sidebar-wide chat search with content snippets, project-labeled chat rows, current-session/current-section priority, current-session `New chat` targeting for empty sessions, project-level new-chat sending, and an app-level persisted `Send & wrap` mode with inline explanation.
- Added simple table support to NFM descriptions, including GFM pipe-table parsing, lossless table serialization for header columns and widths, editable BlockNote tables, Notion simple-table paste, read-only previews, and tokenized Notion-style table chrome.
- Added a Card Stage heading rail navigator for rich NFM descriptions, with automatic left-gutter markers for heading-heavy cards.

### Changed
- Canvas scenes now synchronize through an independent per-Project Y.Doc, so concurrent windows merge Excalidraw edits instead of overwriting a whole-scene snapshot; image files use verified managed assets and Card shapes remain stable references.
- Multi-Card Kanban drags now commit status, property, and manual View position changes as one atomic Database operation, with exact retry and all-or-nothing conflict recovery.
- Moving Blocks between collaborative Cards now uses one atomic cross-Document transaction: active editors briefly flush and freeze, application Block IDs stay stable, and a failed move leaves both Cards unchanged instead of saving competing body snapshots.
- Full Card detail, Board, reference, and notification-summary reads now assemble current collaborative content and relational properties from their authoritative records, so stale legacy Card columns cannot reappear after a remote edit or restart.
- Card search now indexes committed collaborative Document title/body units and resolves current relational status, so remote edits become searchable immediately and stale legacy content cannot reappear after restart.
- Calendar and reminder reads now use the typed schedule index plus current collaborative Card content and relational metadata, with stale projections rejected instead of falling back to legacy Card rows.
- Card references, inline Database views, and the top-level Toggle List are now reference-only surfaces: collapsed rows use summaries, expanded visible Cards open their own collaborative Document, and legacy foreign snapshots migrate durably without copying or rewriting another Card body.
- `Cmd/Ctrl+Enter` in NFM editors now modifies the current actionable block before falling back to Card Stage thread-section send, including checkbox toggles, toggle rows, image previews, card opens, and linked thread-section opens.
- Renamed the main local-store server environment variables from `KANBAN_*` to `NODEX_*` and the SQLite database file from `kanban.db` to `nodex.db`; startup moves an existing legacy database file when no `nodex.db` exists.
- Updated command palette root mode to use current chat, panel, tab, and settings actions instead of legacy stage and view-switch commands.
- Split the command palette into command, chat, card, and file-shell modes: `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P` search commands, `Cmd/Ctrl+G` searches chats, `Cmd/Ctrl+P` searches cards with filters, and unsupported placeholder rows are now development-only mock entries instead of production command results.
- Production card and NFM editor action menus now hide reference-only mock rows; development and Storybook still show them as disabled `Mock` entries for future surface work.
- Card Stage history now opens as an app-shell version-history modal with post-change card snapshot previews rendered through the read-only NFM editor surface.
- Codex thread previews now prefer the first user message from available transcript history, so thread mention fallback labels and thread pickers reflect the original request instead of the latest assistant response.
- Project names are now display-only: renaming a project no longer changes its stable server-generated UUID.
- Project row actions now own rename, icon, source-folder, Finder, and delete management directly from the sidebar.
- Matched the Workbench Projects header and project folder fold animations to the shipped Codex sidebar motion.
- Sidebar chats now always use the Projects organization without an All chats/Projects/Connections selector, and newly created blank chats appear at the top of their project folder below pinned rows such as `Database View`.
- Replaced the special Overview session with an ordinary pinned `Database View` starter session that can be renamed, unpinned, archived, deleted, and opened from the normal session menu.
- Blank project session thread pages now open on a centered new-chat home with a project-aware hero prompt, attached composer/footer strip, ProseMirror prompt editor, and local/worktree-only start controls.
- Replaced the old primary stage-rail workbench model with project sessions that open as a thread page with a collapsible and full-width-expandable right panel plus an independent bottom panel for session tabs.
- Settings now opens as a full-window route shell with the same native vibrant sidebar feel as the normal workbench sidebar instead of a modal overlay.
- Card Stage title and body now save as collaborative Y.Doc updates; the temporary snapshot autosave remains isolated to an explicit migration-failure surface.
- Window restore and new-window layout seeding are now owned only by window sessions instead of named workspaces.
- macOS window titles now use `Nodex` instead of a workspace name.
- Terminal tabs are now session-owned panel tabs with session terminal ids that start from the attached thread cwd before falling back to the project primary source; cards can request a terminal but no longer own terminal tabs or PTY identity.
- Card Stage local run-folder selection now uses the shared workspace directory picker instead of the legacy PTY picker channel.
- Refined the project/session sidebar chrome, moved project folder selection into each project row actions menu, and added Search, Plugins, and Scheduled rows for a denser shell layout.
- Refined project session panel groups so empty non-final groups close automatically, each group's new-tab button sits directly after its tabs, and right-panel expand/restore plus bottom-panel close controls sit at the far-right edge of the whole panel.
- Refined the project session shell side-panel control placement, adjacent header-slot spacing, remembered full-width mode, and button styling: the global header now owns `Toggle side panel`, tab creation lives in each panel group header, right-panel expand/restore lives in the panel-global header rail, and the unused attach/detach thread toolbar button is removed.
- Refined project session thread headers to use the thread title as the session header and hide the redundant header separator while the right panel is closed.
- Existing thread composers no longer show the lower run-target/status row under the prompt; that row remains available on new-chat composers.
- Added a top-right thread summary surface for attached local conversation sessions, with a pinned-summary toggle/icon, a right-panel-open `Toggle summary` popover, toolbar-safe under-header pinned placement, and hover-revealed section chevrons.
- Added a Workbench Scheduled route that opens from the sidebar, command palette, and scheduled summary rows with task/template tabs, a searchable system template catalog, searchable Current/Paused task rows, row status/actions, project-folder and local-environment pickers, app-server-backed model/reasoning selection, run-now notifications, chat/template personalization entry points, split create controls, in-app delete/discard confirmations, previous-run history actions, run-state sync across Scheduled, Inbox, and sidebar rows, conversation `automation_update` cards for suggested and direct scheduled-task mutations, and a right-side detail rail for creating and editing local scheduled tasks.
- Added a Workbench Process Manager dialog that opens from the command palette, `Ctrl+Alt+M`, and summary Tasks rows to inspect and stop running thread background terminals.
- Centralized workbench top-right header controls through a header action registry so panel toggles and adjacent panel-header actions keep consistent spacing and reserved width.
- Collapsed sidebar titlebar chrome now uses a measured left header rail, compact `New chat` button, and thread title alignment after the macOS traffic-light safe area.
- Moved authenticated Codex quota visibility from the floating thread summary panel into a double-ring indicator in the sidebar footer, with the existing account details available on hover.
- Project session thread pages without an attached thread now show the session new-chat composer and start a session-owned Codex thread from the first prompt instead of showing an attach-thread empty state.
- Codex threads are now session-owned locally; legacy card-linked threads are migrated into project sessions instead of retaining card ownership.
- Thread collapsed tool activity groups now has synthesized summaries and flat expanded row hierarchy instead of showing generic completed-action labels or nested exploration subgroups.
- Command execution output now streams through the active thread renderer with smoother batched updates, canonical 20k truncation, reversed output scrolling, and explicit `Stopped` / `Success` / `Exit code` footer states.
- NFM side-menu `Move to` now opens one grouped DB/Card destination popover with shared prefix/fuzzy search instead of separate `Move to DB` and `Move to card` submenu actions.
- NFM side-menu `Turn into -> Card in` now opens the same destination popover scoped to DB results instead of the older send-blocks dialog.
- Right-panel DB View and Card Stage actions now use the same dense searchable picker chrome as NFM move-to, scoped to DB or card destinations.

### Removed
- Removed the old `KANBAN_*` server environment variable aliases.
- Removed the floating Manage Projects popover entry points.
- Removed legacy project slugs, project-level workspace paths, and runtime alias compatibility from the project model.
- Removed the legacy Full rail stage layout mode, its General settings controls, and the adjacent-panel peek setting.
- Removed profile-local named workspaces, the workspace switcher/footer dots, and workspace create/rename/delete controls.
- Removed the old workspace terminal drawer state and right-pane mirror columns; Terminal tabs and panel state now live only in project sessions.
- Removed the deprecated `pty:*` IPC compatibility shim; integrated terminals now use only the `terminal-*` protocol.
- Removed the legacy full-board read API so renderer board views now use lightweight summaries plus on-demand card detail hydration.

### Fixed
- Whole-store backup and restore now freeze collaborative and managed-asset writes at one consistent boundary, recover interrupted database/assets swaps without mixing snapshots, and automatically reload open Cards without replaying pre-restore edits.
- Card title and body edits now synchronize through the Card's collaborative document, so two windows can edit the same Card without delayed whole-Card overwrites; reconnect and restart preserve the merged result.
- Fixed Card delete undo and create redo failing while restoring the persisted Card row.
- Fixed Scheduled edit navigation so valid pending detail edits save before switching tabs, opening another scheduled task, running toolbar actions, or opening a previous run chat.
- Fixed recent Workbench session switching so sidebar rows use lightweight summaries, warmed session details and DB View boards are reused across projects, DB View scroll restores before paint, Card Stage tab switches keep mounted scroll/editor state, and hidden full-width right-panel thread pages no longer resume idle threads.
- Fixed Review so Git-backed diffs load metadata before file bodies, binary and oversized files render as metadata placeholders instead of decoded text, and non-renderable file bodies are skipped during diff rendering, full-file loading, and search.
- Fixed Thread pages opening slowly after sidebar reconciliation by keeping thread metadata updates out of project-session change fanout and refreshing sidebar session rows with lightweight summaries instead of full panel/tab payloads.
- Fixed reopened Thread pages getting stuck loading by resuming renderer-owned streams from the live renderer cursor, replaying resume buffers consistently, and promoting background subagent threads to full streaming only after their right-panel detail tab opens.
- Fixed editing the last Thread user message in multi-window live streams so local edits first resume renderer ownership when needed, materialize rollback in the renderer owner, tombstone late old-turn notifications, start the replacement as an owner-local optimistic turn, and no longer let main-generated post-start snapshots reintroduce the removed turn.
- Fixed forking from a Thread turn in owner/follower streams so no-role local forks first resume renderer ownership and active forks use the owner app-server facade instead of the removed renderer fork fallback IPC.
- Fixed multi-window active Thread actions so normal turn starts, settings/goals, queued follow-ups, steer pending state, plan-dismissal rows, and owner-routed app-server requests publish through the live owner stream, wait for the owner revision when needed, and no longer rely on stale main-process fallback patches.
- Fixed multi-window Thread request responses so approval, permission, user-input, MCP, and notification actions route by the owning thread before falling back to local request lookup, and mark the thread for resume instead of direct-answering when the previous owner is unavailable.
- Fixed live assistant, plan, and reasoning streaming so out-of-order delta notifications no longer create fake transcript rows before the matching item starts.
- Fixed active Thread recovery paths so owner helper failures and reconnect refreshes no longer overwrite live partial transcript text with stale fallback snapshots.
- Fixed Card Stage long-description saves so description autosaves use staged chunk transport, durable writes run in the card worker, and board/search views read persisted summary indexes instead of reparsing full descriptions while `Saving...` is shown.
- Fixed new Codex session rows so generated and manually renamed thread titles replace the initial `New thread` label in the sidebar.
- Fixed fast NFM `@now` mention entry so pressing Enter before async picker results finish no longer inserts a stale `@no` item.
- Fixed search-backed pickers so quick typing followed by Enter or click no longer submits stale command, chat, card, destination, file, or content-search results from the previous query.
- Fixed the NFM text-selection toolbar so collapsing a rich-text selection to a cursor no longer reopens the legacy formatting toolbar.
- Fixed the NFM side-menu `Card in` flyout so hovering the row opens the DB picker reliably.
- Fixed card history retention so retained card versions stay previewable/restorable after pruning by preserving internal reconstruction checkpoints.
- Fixed packaged production builds so backend logs are not written by default; diagnostics remain opt-in through `NODEX_LOG_FILE` or `NODEX_LOG_CONSOLE`.
- Fixed Browser tabs so Electron page navigation is owned by the main-process webview lifecycle instead of competing renderer and main navigations, while the address bar, page actions, local-server cards, loaded page stage, and app tab strip now use the shipped compact panel contract, including a clickable no-drag address bar inside the draggable toolbar.
- Fixed full-width right-panel mode so the panel header hides the thread header while keeping the persistent top-right panel toggles visible.
- Fixed app-window Back/Forward controls so titlebar clicks, shortcuts, mouse buttons, and menu commands restore the active project/session and panel context in the current shell.
- Removed the redundant `Session Terminal` body row from terminal tabs so the terminal content starts directly below the tab chrome.
- Fixed collapsed sidebar titlebar buttons so they match the top-right toolbar controls for size, color, icon scale, and hover highlight instead of using project-row hover styling.
- Fixed the right-panel-open thread summary trigger so it sits at the thread/right-panel boundary, keeps the active icon unclipped, and opens the summary popover when clicked.
- Fixed open right-panel sessions so the thread page no longer leaves an empty toolbar-height row above the thread title.
- Fixed sidebar session rows so titles keep the grouped project indent.
- Fixed active project folder toggles so clicking the project title while focused on one of its sessions no longer re-selects the project and flickers back open.
- Fixed the sidebar `Projects` header so clicking it collapses and expands the project/session rows.
- Restored the native vibrant workbench sidebar background after the sidebar chrome update.
- Fixed long Thread composer prompts so the prompt field shows only the textarea scrollbar instead of a second wrapper scrollbar.
- Fixed full-width right-panel tabs so they start at the panel edge instead of leaving an empty leading gap.
- Fixed newly created chat sessions so they start with the right panel collapsed, while project starter `Database View` sessions open their DB tab full-width by default.
- Fixed project-session DB tabs so the restored View toolbar includes the original view selector, search, filter, sort, display, and calendar controls.
- Fixed cross-project Card Stage tabs so they keep loading the target card's project when hosted inside another project session, including recovery for previously saved blank tabs.
- Fixed archived session threads so opening them shows a restore state instead of attempting to resume and surfacing an app-server archive error.
- Fixed Codex runtime compatibility after the pinned `@openai/codex` bump by updating app-server handshake and thread request payloads to the new protocol shape.
- Fixed stopped Thread turn ordering so a final collapsed tool/activity group renders above the assistant action toolbar.
- Fixed completed Thread file-edit rows so expanding a file shows the rendered inline diff body again instead of only the patch-frame header.
- Removed the redundant extra colored gutter line from inline Thread diffs so the diff body relies on the native add/delete indicators.
- Fixed Threads composer file attachment handling so renderer code can no longer request arbitrary local file bytes; image previews are now read only from files selected through the native picker.
- Fixed active-turn steering so steers now render as optimistic steering user messages, accept against the matching backend user message, show the separate `Steered conversation` divider, and restore unaccepted steers as queued follow-ups.

## [0.1.10] - 2026-05-03

### Added
- Added Show more/Show less controls for long Thread user-message bubbles.
- Added a packaged macOS notification sound for Nodex desktop notifications.
- Added editable NFM `<agent-config />` chips with readable model labels and a slash-menu insertion command so prompts can apply one-send Codex mode, model, and reasoning overrides without exposing config markup to the agent.
- Added a right-click Cut/Copy/Paste menu to the NFM editor.
- Added Calendar controls to the View-stage toolbar, with Day, Week, custom Multi-Day, custom Multi-Week, inline range steppers, navigation, a create action, and no unrelated search/filter/sort chrome.

### Changed
- Thread composer controls now has a stable no-focus-elevation composer chrome, permissions and context usage inside the composer footer, a compact Intelligence selector for model/reasoning/speed, a add-context menu for photos/files, live Plan-mode chrome from the active thread state including agent-config mode changes, IDE context, and plugins, request cards that replace only the composer input controls, and a preserved lower status row reduced to run target plus branch.
- NFM slash commands and card mentions now use a compact Nodex-native suggestion menu with right-aligned syntax hints and item descriptions shown on hover instead of inline secondary text.
- Card Stage now uses a top tab bar for card sessions, with card history rendered as a second state of the active card tab instead of a separate tab and rich hover tooltips for card/project context.
- macOS window titles now follow the active workspace name for each restored window session.

### Fixed
- Fixed sent image attachments in Threads so user-submitted images now appear above the user message bubble as previewable thumbnails instead of disappearing from the transcript body.
- Fixed NFM image blocks in thread-section prompts so their image pixels are sent to Codex as image inputs instead of only contributing serialized text.
- Fixed Card Stage rich-editor typing latency under CPU pressure by deferring full NFM serialization and Kanban preview updates until draft flush points instead of doing them on every editor transaction.
- Fixed the Calendar toolbar month label so it sits beside the active Calendar selector, uses primary text contrast, and leaves the action cluster consistently sized with the selector.
- Fixed Calendar `Shift+Wheel` navigation so wheel input shows a horizontal visual roll immediately, settles after a 500ms idle pause, and accumulated gestures can move across multiple days without the old one-day cap.

## [0.1.9] - 2026-04-24

### Added
- Added VS Code-style window session reopening, with profile-local per-window layout snapshots, saved window bounds, and a Settings -> General restore policy for reopening all windows, the last window, or a fresh window.
- Added profile-local workspaces for restoring named workbench layouts across app restarts, with a default workspace, optional workspace icons, footer workspace dots plus a `+` editor trigger, and workspace create/rename/delete controls.
- Added thread-composer dictation in Electron for ChatGPT-authenticated sessions, including the `Dictate` mic button, `Ctrl+M` hold-to-dictate shortcut, buffered `/transcribe` upload path, and the recording footer with `Stop dictation` plus `Transcribe and send`.
- Added a global `Service tier` preference with `Standard` and `Fast` controls in Settings and the thread composer, plus a lightning indicator before the composer model selector while Fast is active, so new thread and turn requests can inherit and send the persisted fast tier without per-thread configuration.
- Added Auto-review for local threads: permissions now resolve from Codex config/requirements, reviewer allow-lists are honored, the Thread stage and new `Agent` settings page expose `Default permissions`, `Auto-review`, `Full access`, and config-backed `Custom (config.toml)` states, Auto-review falls back to the normal reviewer when `guardian_approval` is unavailable, and approval requests stay attached to the matching exec/file-change transcript rows.
- Added per-snapshot delete actions in Settings -> Backups, with inline confirmation on each backup row so old local snapshots can be removed without leaving the settings page.
- Added a compact Nodex-native link UI across the NFM editor, including a slimmer formatting-toolbar `Create link` popover plus the hover toolbar with the stored URL as the primary pill action, above-link reveal, a dedicated copy affordance that now uses the shared copied-checkmark feedback pattern, and a single anchored edit dialog that replaces the pill when editing or unlinking, pushing URL/title edits into the current card draft on every keystroke without kicking focus back to the editor.
- Added native desktop `Copy image` handling for NFM image blocks, so the toolbar now writes real image content to the clipboard and shows a global in-app success/error toast instead of downgrading to a copied URL.
- Added a global Nodex toast system with a single top-centered renderer overlay, deduping/custom-toast support, and immediate migration of undo/history, editor, and review transient feedback onto the shared toaster.

### Changed
- Cards sidebar status groups now list completed work first, from `Done` back to `Draft`, while board and filter ordering stay unchanged.

### Fixed
- Fixed nested NFM editor Backspace for bullet, numbered, checklist, and toggle-list child items at block start so they now exit list formatting in place like root-level lists instead of merging into the previous sibling text.
- Fixed desktop notifications for local Codex threads so turn-complete, approval, and question notifications now follow settings, focus suppression, reply/action handling, and interrupted-turn filtering.
- Fixed NFM ordered-list round-tripping so numbered list markers now persist exactly through editor save/reload, plain-text copy, and raw NFM rendering instead of collapsing every item to `1.`.
- Fixed thread-composer dictation transcription in ChatGPT-authenticated Electron sessions by using the authenticated `/transcribe` request envelope and retry behavior.
- Fixed MCP tool-call transcript rendering so MCP rows now render from a canonical normalized result model, use stable `Calling`/`Called` summaries and expanded branch order, keep `structuredContent` append-only, and hide same-server in-progress MCP rows while an incomplete elicitation for that server is already visible.
- Fixed local-thread turn ordering so later tool-like rows now keep the latest assistant inline, while thread search still follows the raw latest assistant message even without a dedicated final-assistant slot.
- Fixed local-thread request-card ordering after turn-only updates so approval, user-input, and implement-plan selection now invalidates when turn order changes even if the raw request array is unchanged.
- Fixed local-thread renderer churn so the active thread route now reads narrow conversation slices instead of a whole conversation snapshot, and the mounted transcript body now renders from stable visible-turn entries with parent-turn de-duplication and memoized row measurement.
- Fixed resumed helper-thread ownership so child threads now carry a canonical `parentThreadId` in their thread summary/snapshot source metadata, letting the mounted body de-duplicate against the parent thread without scanning every renderer-side conversation manager.
- Fixed local-thread streaming update cost again so hot assistant-text and command-output flushes now patch the materialized conversation state directly instead of rebuilding a full serialized conversation snapshot on every flush.
- Fixed remaining local-thread patch churn so queued follow-ups, pending steers, request ingress/resolution, and patch-capable turn/item updates now mutate the broadcast conversation cache directly instead of falling back to full conversation reconciliation.
- Fixed active local-thread streaming gaps so turn text and command output now stay on patch-based updates, request ownership follows newest-turn scan, thread search highlighting is DOM-driven instead of prop-driven, and programmatic find scrolling now settles without forcing full-thread rerenders.
- Fixed Codex plan-mode follow-ups so clicking `Yes, implement this plan` now immediately switches the active thread back to `Default` mode before sending the follow-up, preventing plan-mode threads from getting stuck read-only.
- Fixed proposed-plan request cards so `Yes, implement this plan` now reappears reliably after plan generation, reopen, resume, and reconnect by making plan-implementation requests main-owned conversation state instead of renderer-local hidden state.
- Fixed NFM editor link editing so absolute local paths like `/Users/...` no longer get rewritten to malformed `https:///Users/...` URLs.
- Fixed preserved NFM links opening with browser-relative navigation by classifying stored hrefs at click time instead, so bare domains open as web URLs, absolute/file paths still open as local files, and relative file-like links resolve against the active project workspace or fail closed when they cannot be resolved safely.
- Fixed command-execution lifecycle ownership so exec rows, background terminals, approvals, and exit-code rendering now consume one canonical protocol-first exec item instead of mixing `toolCall`, `rawItem`, and output-text fallbacks.
- Fixed the Thread-stage auth chip so authenticated sessions now show concise remaining quota windows in the header instead of a generic `Connected` label.
- Fixed authenticated Codex quota badges going stale by adding a main-process 60-second quota refresh loop while the app-server connection is live, so thread headers stay current even without opening the tooltip.
- Fixed background terminal detection so long-running command executions from older completed turns now stay in the `Running terminals` lane until the command itself finishes or is interrupted.
- Fixed `Stop background terminals` so manually interrupted commands now disappear from the background-terminal lane immediately via turn-level interrupted-command tracking.
- Fixed running-thread composer follow-ups so `Cmd+Enter` now keeps messages in the queued-follow-up lane instead of immediately collapsing them into `Steer`, queued follow-ups auto-send in FIFO order after the current turn finishes, and the send-button tooltip now shows the `Steer`/`Queue` shortcut rows.
- Fixed `Context automatically compacted` transcript markers so live and replayed compaction rows now stay in the canonical turn item order instead of drifting to the bottom of the thread.
- Fixed installed-build thread auto-naming with a main-owned structured title helper, direct `thread/name/set` persistence, and explicit thread-title sync instead of a repo-relative prompt-file dependency.
- Fixed multi-file thread patch previews so each expanded file row no longer repeats the diff library's inner file header under the thread-owned filename and line-count header.
- Fixed thread file-change rendering so patch rows now use a semantic file-change model, synthesizing structured inline diffs and semantic add/delete fallbacks instead of showing raw patch text.
- Fixed the thread `Restoring thread` state so reopen/resume now uses a centered Nodex logo shimmer loader instead of a bordered spinner card.
- Fixed the Threads composer staying visible at the bottom of the stage even when the transcript is long instead of letting the body push the composer out of view.
- Fixed Codex thread sidebar and card-stage thread lists so they hydrate as soon as a project subscribes to thread summaries instead of staying empty until some later thread mutation happens.
- Fixed heavy streaming thread updates so live thread sync now follows a per-thread patch stream and provider-backed conversation manager instead of rebroadcasting full live snapshots through a shell-owned renderer reducer.
- Fixed heavy streaming thread sessions repainting the whole Electron shell by moving active thread state to a per-thread external store instead of a WorkbenchShell-owned reducer.
- Fixed remaining Codex thread control-plane invalidation so permission modes, thread-start progress, model bootstrap, thread summaries, and active conversations now share one manager/registry substrate instead of flowing through a second renderer reducer.
- Fixed Kanban board horizontal overflow so the board keeps a visible thin scrollbar instead of hiding the only obvious horizontal scroll affordance.
- Fixed active thread exploration rows so live read/search/list-file sequences now stay in `Exploring` preview mode instead of immediately falling back to `Explored`.
- Fixed release validation for Codex approval and permission unit tests so they no longer require a staged local Codex runtime on CI.
- Fixed thread-body and tool-call accordion motion timing so transcript reveals now use the shared easing and duration instead of a slower transition.
- Fixed streaming proposed-plan cards so active plans now render as `Writing plan` in the collapsed preview state instead of expanding immediately under an extra `Proposed plan` label.
- Fixed thread tool-call expand/collapse scroll anchoring so opening a visible tool body no longer drags the surrounding turn header and transcript position.
- Fixed thread transcript scroll behavior so tool-call and body remeasurements now follow the shared scroll-controller lifecycle, preserving visible turn headers while keeping follow-latest and search jumps stable.
- Fixed the mounted thread footer/body geometry so the transcript now keeps natural spacing above the composer, the scroll-to-latest control lives with the footer instead of inside the body, and bottom-follow no longer fights an extra resize-observer snap path.

## [0.1.8] - 2026-03-30

### Added
- Added full-feature Codex thread.
- Added command-palette card filters with persistent status, priority, tag, assignee, and project rules.
- Added a `Local environments` settings page for browsing and editing workspace `.codex/environments/*.toml` files in-app.
- Added a full Diff stage review workspace with source switching, file tree navigation, unified/split diffs, search, word wrap, word diffs, rich previews, and file-level Git actions.

### Changed
- Threads settings now include detail modes for `Steps`, `Steps with code commands`, and `Steps with code output`.
- Settings and shared form controls now use a cleaner shell, thinner inputs, shared validation, and matching theme tokens.
- Shared sort controls can now place empty `priority` and `estimate` values first or last.
- In sliding-window stage mode, `Cmd/Ctrl+H` and `Cmd/Ctrl+L` now move the visible stage window instead of always moving focus.
- Rebuilt the active Threads experience around a canonical main-process conversation manager, a virtualized turn list, and a unified composer shell for approvals, queued follow-ups, steers, background terminals, and child-agent activity.
- Active and mounted thread transcripts now use improved live-state rendering, request cards, transcript item types, expand/collapse behavior, and above-composer todo/diff surfaces.
- Running-thread follow-ups now use a true `queue`/`steer` split instead of starting queued messages immediately.

### Fixed
- Fixed Diff stage review polish, including file-tree statuses, directory expansion, virtualization, word wrap, review search, and actions-menu behavior.
- Fixed the NFM editor side-menu `+` button hit target.
- Fixed running-thread background terminal rows, follow-up keyboard shortcuts, and above-composer diff/task portal behavior.
- Fixed mounted and reopened thread reliability issues around resume, replay, duplication, compaction markers, streaming updates, and canonical turn ordering.
- Fixed thread transcript polish issues across command cards, patch rows, diff banners, message actions, reasoning/todo rows, collapse behavior, and inline message editing.
- Fixed Kanban drag-and-drop edge cases for sorted columns and auto-collapsed empty lanes.
- Fixed active thread gaps so implement-plan cards now follow the `planImplementation` ownership rule, request-priority selection uses stable composer ordering, command-output streams stay bounded with truncation markers, and header/footer surfaces stop re-rendering on plain turn-text streaming.

## [0.1.7] - 2026-03-19

### Changed
- Packaged macOS builds now bundle a pinned Codex CLI runtime and its bundled `rg`, keeping the shipped app-server binary version aligned with the committed generated `codex_schemas` instead of depending on a separately installed `codex` binary.
- Changed the first-party Homebrew tap namespace to `junyudev/tap`, so the canonical macOS install command is now `brew install --cask junyudev/tap/nodex`.

### Fixed
- Fixed packaged macOS builds re-signing the bundled Codex binary, so `Contents/Resources/bin/codex` now keeps OpenAI's original code signature and can reuse existing `Codex MCP Credentials` Keychain access without extra prompts.
- Fixed Thread-stage transcript message actions so user bubbles keep their copy/edit controls, while assistant copy now waits for the round to settle and only attaches to the round's final assistant message instead of appearing on streaming output.
- Fixed Thread-stage streaming transcript text so empty assistant/plan/thinking item shells no longer flash internal fallback labels like `Agent Message` before real content arrives.
- Fixed the Cards sidebar `Recents` section so clicking a recent card now keeps the newly opened card active instead of briefly reselecting the card you just left, and the active highlight now follows the actual open card even while the history overlay is shown.
- Fixed Card Stage `Cmd+Enter` toggle behavior so `cardToggle` rows now expand/collapse like other toggle headers instead of being intercepted by thread-section send.

## [0.1.6] - 2026-03-18

### Added
- Added derived-view Kanban block-drop import support for structured filter/sort views, including exact-slot placement when the board can infer safe workflow properties and column-level fallback when the active sort owns visible order.
- Added richer sorted Kanban drag modes: `board-order` now keeps same-column ranking even with secondary sorts, `priority` / `estimate` sorts can infer bucket-changing drops, and `title` / `created` sorts now explain blocked same-column ranking while still allowing cross-column moves.
- Added packaged-macOS app auto-update support via GitHub Releases, including background update checks/downloads, a new Settings -> General -> `App updates` control, a `Check for Updates…` macOS app-menu action, and in-app restart prompts when a downloaded update is ready.

### Changed
- Matched NFM editor heading typography to the reference scale, including heading weights and drag-handle alignment for heading rows.
- Changed linked Codex thread recovery to prefer persisted Codex session history over Nodex-owned full transcript snapshots, reducing duplicate local state while preserving restart recovery for thread logs and notifications.
- Changed generated card ids to use the published `uuid` package's UUID-v7 implementation, preserving DB-friendly ordering without the old visually repetitive `7000-8000` middle pattern.

### Fixed
- Fixed Kanban drag performance and interaction stability on dense boards by replacing the old sortable runtime with Atlassian Pragmatic Drag and Drop while preserving multi-card moves, gap insertion, and board-to-editor move semantics.
- Fixed NFM editor `cardToggle` rows so property chips now stay inline with the toggle title text and wrapped titles use the full row width, matching kanban card properties.
- Fixed the NFM editor side menu so the add-block `+` now uses the same icon color as the drag handle.
- Fixed sorted Kanban cross-column drag feedback so the destination column now shows a clear in-column target state instead of only subtle outer edge lines.
- Fixed sorted Kanban drag-and-drop so non-default sorts still allow cross-column card moves; only same-column manual ranking stays disabled.
- Fixed Kanban so card drag-and-drop no longer locks completely under active search, filter, or sort rules: filtered boards keep subset-aware reordering, and non-default sorts still allow drag-to-move across columns without pretending to manually rank a sorted column.
- Fixed the unreleased Kanban insert-position indicator so it no longer flickers from board-card/editor-import drag-handler races, and now matches the final persisted drop position for same-column reorders.
- Fixed Card Stage code blocks in light mode after the Streamdown migration by restoring BlockNote's shared dual-theme Shiki parser instead of falling back to a dark-only parser.
- Fixed the recurring NFM side-menu text-selection clipping regression by disabling hit-testing on BlockNote's floating side-menu overlay during mouse drag-selection instead of relying on brittle subtree-only CSS rules.
- Fixed local dev browser-origin HTTP requests so trusted localhost origins now receive the expected CORS headers and untrusted origins are rejected consistently even on unknown API routes.
- Fixed the Projects sidebar active-row workspace control so it no longer renders an invalid nested-button DOM tree that could trigger hydration failures.

## [0.1.5] - 2026-03-16

### Fixed
- Fixed oversized macOS release packages by keeping renderer-only libraries out of shipped runtime dependencies and pruning dead test/source-map/source-tree files from packaged Node modules.

## [0.1.4] - 2026-03-16

### Fixed
- Fixed release automation so macOS packaging now gets a larger CI-only Node heap budget, and the version commit/tag are pushed only after both release builds succeed.

## [0.1.3] - 2026-03-16

### Added
- Added a `Show raw` toggle in the Card Stage toolbar that swaps the rich description editor for a read-only raw NFM view of the current card draft, so debugging serialized content is one click away.
- Added fuzzy full-text card matching to the global command palette, with a cached MiniSearch index so card results now tolerate small typos and rank matches from descriptions, tags, assignees, statuses, column names, project names, and card ids instead of title-only token containment.
- Added Omnisearch-style contextual preview snippets to command-palette card results, with matching title and metadata indicators plus matching description text highlighted and clamped to three lines.
- Added a top-level `Projects` sidebar section for switching the DB view datasource, with inline workspace-folder context and project-management shortcuts so project selection no longer depends on a separate current-project header.
- Added per-column kanban header popovers for collapsing non-empty columns and adjusting each column's persisted width, while keeping counts and the `more actions` trigger visible on collapsed columns.
- Added notarized dual-architecture macOS release automation plus first-party Homebrew tap publishing, so tagged releases now produce signed `arm64` and `x64` installers and can be installed through Homebrew alongside the direct GitHub Release downloads.
- Added Streamdown 2.4.0-based markdown rendering across Codex threads and raw NFM code blocks, replacing the app-owned transcript Shiki/Mermaid stack with the official Streamdown code, Mermaid, math, and CJK plugins.

### Changed
- Changed the global command palette to match VS Code-style command mode: card search is now the default, and command results only appear when the query starts with `>`.
- Changed `Cmd/Ctrl+Shift+P` to open the global command palette directly in command mode with `>` prefilled, instead of opening the project picker.
- Changed the command palette to open faster, keep the workbench visible behind it instead of dimming the background, and use a heavier floating shadow for separation.

### Fixed
- Fixed NFM editor drag-handle menu actions like `Delete`, `Send blocks`, and `Colors` so BlockNote side-menu dropdown items now complete their pointer interaction reliably in Electron, and follow-up actions no longer leave the side menu frozen in place.
- Fixed the Card Stage history button so it opens reliably again after the navigation-history refactor; the cards overlay no longer clears itself by coupling the selected recent session to the active cards tab.
- Fixed DB view toolbar filter, sort, and display settings resetting after a full window close; they now persist durably per project and per supported view across reopen.

## [0.1.2] - 2026-03-14

### Added
- Added notebook-style `threadSection` blocks in the Card Stage editor so `Cmd/Ctrl+Enter` can send an explicit structure-preserving plain-text section payload, including marker-child content and nested child sections scoped to their sibling blocks, to a sticky Codex thread without leaving the editor; typing `---`, using the slash menu, or sending from unsectioned content can create a section marker, and sends now open a confirmation preview by default.
- Added a global command palette on `Cmd/Ctrl+K` and `Cmd/Ctrl+P` for jumping to cards across projects and running common shell commands like project picker, task search, settings, view switches, and terminal toggling.
- Added browser-style workbench back/forward navigation on `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, with matching `Go back` and `Go forward` actions in the command palette.
- Added filtered kanban drag-and-drop support so search results can still be moved between columns or reordered without disturbing hidden non-matching cards.
- Added shared view-local filter and sort controls to the DB toolbar for Kanban, Table, and Toggle List, including compact active-rule pills in the toolbar’s bottom band with a condensed sort chip plus filter separators.
- Added an explicit empty-priority (`-`) option to toggle-list and shared DB-view filter rules, including raw-rule serialization that preserves empty-priority intent instead of relying on legacy “all priorities” matching.

### Changed
- Refined Kanban drag feedback on dense boards so board drags keep a static source ghost plus a non-layout-shifting insertion indicator, same-column reordering no longer live-shifts the whole list, drag overlays now portal to the document root with source-locked geometry so they start under the cursor instead of appearing offset, and dropping onto the visible gap between cards inserts at that gap instead of snapping to column end.
- Replaced plain status dots with semantic status icons across shared status chips and sidebar status groups, so Kanban, table, editor, thread metadata, and the Cards sidebar all use the same clearer workflow language.
- Simplified the card workflow to five canonical statuses (`draft`, `backlog`, `in_progress`, `in_review`, `done`) plus an internal `archived` flag, and updated recurring completion snapshots to archive `done` cards instead of using a hidden archive column.
- Switched persisted card ids to canonical lowercase UUID-v7 values, simplified Codex thread-link storage so `thread_id` is the sole primary key, and dropped the historical in-app upgrade chain for pre-migrated local databases.
- Changed card deeplinks to the canonical `nodex://cards/<card-id>` schema and removed the startup rewrite pass for older deeplink variants.
- Moved DB view switching out of the sidebar and into a sticky View-stage toolbar with Notion-like tabs and inline search chrome that now stays pinned above every board, table, canvas, and calendar surface.
- Updated the View-stage Table tab to use a table-specific icon instead of the generic list glyph.
- Normalized the inner view padding for table, calendar, and canvas so they line up with the existing kanban and toggle-list gutters.
- Moved top-level Toggle List rules plus both Toggle List and Kanban display controls into the View-stage toolbar, and made table-header sorting write through to the same persisted per-view sort state.
- Replaced the standalone "Show empty estimate" checkbox in Display settings with inline toggle icons on the Estimate and Priority property rows, so both fields can show `[-]` placeholders when empty.
- Extended those empty `priority` / `estimate` placeholder toggles to kanban cards as well as toggle-list rows.
- Changed the toggle-list Rules panel so a top-right `Raw` toggle swaps the visual rules editor with the raw JSON editor directly.
- Priority is now empty by default and can be cleared back to empty across the card editor, inline creator, and compact card surfaces.

### Fixed
- Fixed card-stage typing lag in the NFM editor by keeping freeform text drafts local until save/blur instead of broadcasting every keystroke through the shared project board state, while still letting Kanban card surfaces reflect the in-progress draft for that card without feeding those overlays back into Card Stage, re-rendering the full interactive card shell on every keypress, or triggering a render loop.
- Matched Kanban’s empty `priority` / `estimate` placeholder chips to Toggle List exactly, including the rendered `-` label, shared chip styling/token logic, and the same click-to-edit dropdown behavior as filled Kanban property chips.

## [0.1.1] - 2026-03-12

### Added
- Added pasted attachment chips for oversized text, pasted files, and pasted folders, with save-in-Nodex support for text/files and local-path linking for files/folders.

### Changed
- Expanded local asset handling beyond images so pasted attachments can resolve previews and metadata through the shared `nodex://assets/...` pipeline.
- Refined the titlebar sliding-window pane controls so they flank the minimap, `+` grows to the right before falling back left, and `-` always removes the right-most visible pane.
- Reworked card-description history storage so repeated large description edits now write compact revision deltas and checkpoints instead of duplicating full description blobs in every history row.
- Reworked the card history overlay so description edits now render as block-level revision deltas and snapshots by default, with an optional collapsed full diff viewer when you need the entire document context.
- Added a Backups settings control for per-project history retention so you can configure how many history rows are kept before pruning.

### Fixed
- Fixed BlockNote drag-handle delete getting the side menu stuck at a stale position after removing a block.
- Fixed the Cards sidebar so status groups start collapsed by default instead of opening every group on first render.
- Fixed sidebar status-group collapse and `Show more` state resetting after reload; both now persist per project.
- Fixed default plain-text code blocks exporting as ` ```text`; they now serialize with bare triple-backtick fences unless you choose a real language.
- Fixed copying text from inside an NFM code block so plain-text clipboard output no longer adds surrounding triple backticks.
- Fixed local database growth from repeated large description edits by dropping legacy inline history during the schema v21 migration, seeding fresh description revisions from current cards, and enabling incremental SQLite auto-vacuum.

## [0.1.0] - 2026-03-10

### Added
- Initial public release.

## [0.0.9] - 2026-03-09

### Added
- Added a kanban card context menu, deeplink wiring for cards, and cross-project card moves.
- Persisted the last workbench window state so the shell can restore its previous layout.
- Added structured backend logging for the local-first runtime.

### Changed
- Made card properties inline by default and unified selector and chip-editor chrome across the card experience.
- Tightened the history panel layout and jump-to-latest affordance for denser navigation.
- Renamed the app from Aboard to Nodex, unified the icon set, and migrated legacy asset URIs to the `nodex://assets/...` scheme.

### Fixed
- Fixed card-move menu interactions, selector focus behavior, side-menu text selection clipping, NFM tab-boundary focus escape, and project-manager open request consumption.
- Fixed project edit form seeding, restored a missing BlockNote utility source, tightened collapsed-toggle keyboard behavior, sped up local installs, and restored editor autolinking.

## [0.0.8] - 2026-03-08

### Added
- Added Codex sidebar section actions in the workbench shell.
- Expanded documentation for NFM clipboard and copy behavior.
- Added a grouped cards sidebar navigator with collapsible active groups and a cleaner DB view selector.

### Changed
- Removed the final legacy schema-version compatibility shim.
- Removed legacy asset compatibility paths, simplified schema bootstrap, dropped remaining old migration layers, and switched schema tracking to SQLite `user_version`.
- Flattened asset storage and rewrote legacy asset URIs automatically at startup.
- Unified inline and block clipboard serialization so plain-text copy preserves more editor structure and inline markers.
- Refined sidebar section headers, chevrons, recents behavior, and hover/resize timing so the shell feels more immediate.

### Fixed
- Fixed cut-aware clipboard payload generation, nested-copy parent lookup, and related code-block copy polish.
- Fixed the v19 asset migration cursor during the storage cleanup.
- Stabilized sidebar show-more collapse state and recents ordering.

## [0.0.7] - 2026-03-07

### Added
- Added collaboration Plan-mode UI, including required-input cards, multi-question navigation, answered-state rendering, and post-plan implementation flow.
- Added optimistic thread prompts, thread message copy/edit actions, copied-state feedback, and a general UI dev-story page.

### Changed
- Fixed running-thread steer prompts so accepted steers stay in the composer shell until the authoritative user-message item arrives, instead of inserting an early optimistic user bubble at the wrong transcript position.

### Fixed
- Fixed request-card keyboard flow, drag-preview cleanup, and pointer hit-testing around copied and draggable thread content.
- Fixed steered-thread active-status resets.

## [0.0.6] - 2026-03-05

### Added
- Added multi-window support, revision-based card conflict handling, selective install targets, and New Window app-menu and dock actions.
- Added stage-alias and settings-toggle shortcuts.
- Added inline card-property chip editing in the card stage.
- Added a project-wide optimistic journal for card mutations.
- Added instant tooltips for Codex file links.
- Added a connected-account rate-limit tooltip and thread completion notifications.

### Changed
- Scoped the Electron single-instance lock by server profile and refined thread running and elapsed indicators.
- Kept the kanban store alive across stage switches and auto-collected converged local overlays to make optimistic updates durable across the shell.
- Restyled Codex markdown links and aligned themed link token colors.
- Refined running-thread and empty-thread status rendering so the stage communicates runtime state more clearly.

### Fixed
- Fixed false stale-write conflicts during rapid card updates.
- Fixed same-card card-stage sync when external kanban mutations land while a card is open.
- Fixed Codex worktree startup races.

## [0.0.5] - 2026-03-04

### Added
- Added card run-targets with managed worktree startup, reusable per-card worktree paths, environment setup selection, auto-generated thread titles, and title-derived branch naming.
- Streamed worktree and setup progress directly into the new-thread UI and added a card-stage dev-story harness.

### Changed
- Renamed the side peek into the card stage, merged run-target controls into the Threads row, and tightened thread-stage composition and typography.
- Defaulted managed worktree starts to detached `HEAD` and surfaced the active thread cwd more clearly in the UI.

### Fixed
- Fixed run-target sync after thread start, thread reads before materialization, managed-worktree deduping and deletion semantics, stop-button state, CLI TOML parsing, and setup buffer and symlink validation.

## [0.0.4] - 2026-03-02

### Added
- Added configurable collapsed card-stage properties.
- Added a hover-reveal floating sidebar, a global right-pane width, and saner default width limits for the cards stage.
- Added real Codex model, reasoning, permission-mode, branch-selector, and live context-window controls in the thread stage.
- Added Toggle List Rules v2 with JSONLogic interop, editor support for opening markdown file links, and a redesigned settings overlay.

### Changed
- Moved kanban card properties to the top of the card UI and flattened the toggle-list rules panel into a denser Linear/Arc-inspired layout.

### Fixed
- Restored stage shortcuts while editing NFM and fixed the floating-sidebar offscreen shadow.
- Fixed Codex permission hints, branch watcher refresh, thread-stage rebase cleanup, and several remaining thread-stage UI issues.
- Fixed NFM code-fence round-tripping.

## [0.0.3] - 2026-02-27

### Added
- Added a weekly calendar with drag-to-create, drag/resize editing, an all-day lane, recurrence support, reminders, and richer event cards.
- Added the staged workbench shell with docked panels, calendar-aware navigation, settings surfaces, project emoji icons, floating search, and dual-pane stage-rail workflows.
- Integrated Codex app-server threads into the workbench with markdown rendering, tool cards, file diffs, running indicators, follow mode, persistent logs, and better exploration summaries.
- Added smart prefix parsing for block-to-card import and inserted inline-created cards at the top of the target list.

### Changed
- Reworked the shell toward a denser niri-like rail layout with glassy macOS-inspired chrome, collapsible sidebars, and a more focused titlebar and stage model.
- Consolidated calendar scheduling into a unified popover and improved special-copy and image-preview behavior in the editor.
- Shortened kanban priority badges to `P0` through `P4`.

### Fixed
- Hardened the local API by binding to loopback, enforcing a stricter localhost origin policy, validating backup IDs and calendar payloads, and capping SQL query output.
- Fixed recurring-calendar move semantics, overlap lanes, ghost previews, active-thread stop states, replayed Codex items, and a long tail of thread-stage and shell layout issues.
- Fixed Codex binary discovery in installed builds and code-block inline-copy newline escaping.
- Fixed CSS `@property` placement and ArrowDown visual-line movement from collapsed toggles whose first child is an image block.
- Fixed card-reference delete guards, active-border scoping, projected toggle-drop overwrite races, and the BlockNote toggle auto-open behavior.

## [0.0.2] - 2026-02-17

### Added
- Added richer projected inline-card workflows, including drag-handle send actions, cross-project drag/drop, childless embed normalization, and persisted projected-chip edits.
- Added inline card references, a terminal with running indicators, and an Excalidraw canvas view for card-level brainstorming.
- Added bidirectional NFM/Kanban drag-and-drop with grouped undo, spellcheck controls, richer toggle-list rules controls, and clickable property chips.

### Changed
- Replaced the terminal integration with `ghostty-web`.
- Reworked projected-card synchronization around a shared kanban store and editor controller, and made the side peek global across tabs and projects.

### Fixed
- Fixed projection reconciliation timing, focus retention, duplicate row updates, optimistic patch sync, and several inline-toggle chrome issues.
- Fixed NFM color parsing edge cases and isolated side-peek undo handling so editor undo stays scoped correctly.

## [0.0.1] - 2026-02-13

### Added
- Bootstrapped the product as a local-first kanban board for coding agents, then grew it into a packaged Electron app with web support, distribution tooling, and a CLI for automation.
- Added multi-project support, project rename/config flows, All Tasks list views, side-peek editing, detailed edit history with undo/redo, and agent-facing read and SQL introspection APIs.
- Added the NFM editor stack on top of BlockNote, including toggle blocks, Notion import fidelity, image asset paste/upload, dark mode, search/replace, and the first toggle-list views.
- Added whole-store backups, stricter card-write validation, keyboard shortcuts, empty-column auto-collapse, and persistent card and side-peek state.

### Changed
- Migrated persistence from TOML files to SQLite and tightened CLI behavior around config, output, and server defaults.
- Moved the app from a simple board UI toward a richer desktop shell with Electron packaging, better chrome, and more persistent project-aware navigation.

### Fixed
- Fixed SSE controller shutdown handling, optimistic card updates, toggle drag/drop stability, editor newline and empty-line persistence, inline creator dropdowns, tag and estimate edge cases, and a long run of early UI fit-and-finish issues.
