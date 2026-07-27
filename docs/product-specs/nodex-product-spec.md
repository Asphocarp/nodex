# Nodex - Product Specification

## Overview

Nodex is a local-first, block-based agent workspace. A local Profile owns one durable Library of Pages, Database Containers, Data Sources, Views, Documents, and history. Projects are execution contexts for filesystem roots, sessions, terminals, Codex tasks, one primary Database binding, and explicit Library resource grants. Electron and loopback HTTP clients share one SQLite authority.

Desktop runtime requirement: macOS 12 Monterey or later. Nodex ships separate notarized Apple silicon (`arm64`) and Intel (`x64`) macOS builds.

## Problem Statement

When working with coding agents like Claude Code, there's no streamlined way to:
1. Visualize and manage task queues across different stages
2. Allow agents to update their own status without complex integrations
3. Track agent progress in real-time
4. Maintain a simple, portable task state

## Goals

1. **Agent-Native**: Agents use the semantic native CLI and approved tools to read/write product state
2. **Real-Time Sync**: UI reflects changes instantly via SSE
3. **Human-Friendly**: Notion-like UI for manual task management
4. **Portable**: Single SQLite database file, easy to backup/restore
5. **Local-First**: No external dependencies or cloud services required
6. **Multi-Project**: Independent kanban boards per project

## Non-Goals

- Remote multi-account collaboration or a cloud sync service (multiple local windows still share one collaborative Page Document)
- Cloud sync or remote storage
- Mobile-responsive design (desktop-first)
- Complex workflow automation (keep it simple)

---

## Features

### Core Features

#### 1. Multi-Project Support
- Each Project has independent Database Views and durable history. Typing undo/redo is local to each mounted collaborative Document surface rather than a Project-wide stack.
- Single-page app with a project/session shell: projects render as folders in the left sidebar, expanded projects show durable Sessions, and each Window Session presents the active Session as a thread page with its own right and bottom panels for content tabs.
- Every new Project starts with an ordinary pinned `Database View` Session marked as the Project's database starter (`databaseStarter`). The first Window Session that materializes a database-starter Session creates one local full-width right-panel `db_view` tab targeting the Project's current primary Database default View, resolved from the Project read model at materialization time; later windows materialize independently or start from an explicit new-window clone. Newly created chat Sessions materialize with the right panel collapsed. Window Session storage identifies DB tabs by `databaseViewId`, permits distinct Views from the same Project, focuses an already-open identical View within that window, and rejects missing/deleted/cross-Project View identities.
- Each DB tab reads one atomic descriptor/query snapshot for its durable View ID. The exact unfiltered, manually ordered, status-grouped primary Kanban View keeps its specialized Board UI. Filtered and secondary Views render list, board, calendar-agenda, or ordered-canvas projections from their own query; displayed custom properties and manual ordering mutate that selected View/Database identity, never the Project's primary board. Scalar values use captured revisions, multi-select values use add/remove intent, and stale writes refresh instead of overwriting another window.
- Grouped board Views page per column: every column loads its own first window (50 rows), renders an in-flow `Show N more` row after its last loaded card (above `New task`, scrolling with the cards), and its header count badge always reports the group's true total from the bounded per-group totals read, so a partially loaded column is never mistaken for a short or empty one. Flat list projections page as one window with a trailing `Show more · loaded of total` row. Paging keeps working while edits and background sync mutate the Database: a rejected continuation silently re-reads that column's loaded span from its first window, an ordinary load failure keeps the board rendered and offers an inline per-column retry, and refreshes (edits, realtime events, invalidations) re-read each column's loaded span instead of collapsing it back to the first window. Calendar and canvas projections currently render all loaded windows with a single continue affordance; date-range-scoped calendar reads are planned follow-up work.
- Window Session view tabs support `db_view`, `page_stage`, `terminal`, `browser`, `review`, and `files`. Create, update, and restore use one strict kind-discriminated descriptor contract, so a Browser identity cannot appear on another kind and malformed kind/config combinations fail before Window Session persistence. Page descriptors retain Page identity plus the Project access context used for authorization; Project never becomes the Page owner. Terminal descriptors retain only a nonblank terminal runtime identity and are valid in both Project and projectless Sessions without a `projectId`.
- Empty panels and each panel-group tab strip use the same target-aware new-tab action registry. Each group's plus button sits immediately after that group's tabs and creates or previews content in that leaf. The standard thread-panel chooser order is Review, Terminal, Browser, Files, and Side chat, filtered by target panel and singleton availability. Right-panel choosers then append a separated Nodex-only section for DB View and Page Stage when eligible. DB View creates or focuses the active Session Project's DB tab directly until that Window Session view already has one, then opens the move-to-style DB destination picker so another Project DB can be selected. Direct creation targets the Project's current default View; when the Project has no active default View the action reports that explicitly instead of silently doing nothing. Page Stage's empty picker shows the active Session Project's bounded first Page window; typing searches all accessible Projects through the bounded native Page-search projection and groups current-Project hits before other Projects. Timeline remains hidden until Nodex has a first-class tab kind and eligibility model for it. Review is a singleton tab per Window Session view across both right and bottom panels. DB View is one tab per target Project, while Browser is multi-tab and supports New tab to the right, Reload, and Duplicate before generic close actions from the tab context menu.
- Browser and selected Files can open as preview tabs in either right or bottom panel, and single-clicking a Kanban DB-view card opens its Page in Page Stage as a right-panel preview in the nearest right leaf, creating a right-side group first when the right panel is full-width with only the DB group. A Window Session panel leaf owns at most one italic preview at a time; opening a second preview in the same leaf replaces the first, and the preview is ephemeral until the user interacts with the preview body, pins it, or double-clicks its tab label. A newly opened empty Files tab is durable and shows `Open file` / `Select a file from the workspace tree`; its first file selection creates and activates a normal durable file tab, then closes the empty navigator through the ordinary same-leaf close path. Later tree single-clicks use the leaf's replaceable preview, while double-click and Enter promote the matching preview in place or open durably. Focusing an already durable matching file leaves any unrelated preview open. Preview replacement and promotion preserve the visible tab presentation rather than replaying tab entry/exit motion. Files navigation, search, splitter, and toolbar interactions are exempt from generic preview auto-pinning.
- A Files tab identifies an exact local file by host and absolute path independently of its optional navigation root: files produced or changed in worktrees and other directories remain previewable and pinnable even when they are outside the Project source, while the tree and breadcrumb browse only within an explicitly selected canonical root. The Files tree uses the virtualized Pierre tree runtime with 28px rows, disclosure-only folders, colored file-type icons, sticky folders, keyboard navigation, and hidden/generated entries included. Directory browsing remains lazy; the 150ms-debounced filter uses a bounded root-wide main-process search so it can find files under directories that have not been expanded. Directory requests and search use root-relative coordinates, hide directory symlinks whose resolved target escapes that root, and may traverse directory symlinks that resolve inside it.
- Exact-file metadata, text, and binary reads do not require a workspace-root grant; the main process accepts them only from the top-level renderer of an owned app window. File routing is metadata-first: sampled text always receives a source surface even when its filename has no extension, so files such as `LICENSE` remain readable. The renderer uses Pierre for all read-only and editable source, wraps source by default with a per-tab toggle, syntax-highlights recognized languages, and lets Markdown switch between editable source and rendered presentation. Text under 10 MiB is editable, text from 10 MiB through 20 MiB is read-only, and larger text is rejected before a full read. Editable files persist a recoverable draft after 550ms and compare-and-swap autosave after 3 seconds. Exact-path watchers are shared per renderer and refresh clean documents after external changes; dirty external changes retain both versions in a split conflict diff. Close, preview replacement, panel movement, and app-window close wait for saving, while an unresolved conflict retains its draft and blocks destructive tab transitions. Page Stage preview promotion reuses the preview tab id so the editor body does not remount. Page Stage close/delete controls do not pin an unpinned preview before closing/deleting. Side chat uses a separate renderer-local leaf-scoped tab lifecycle: the empty-panel action, panel menu, thread overflow action, `/side`, and the thread selected-text `Ask in side chat` overlay create `sidechat-loading:<parentThreadId>:<index>` tabs, replace them with closable `sidechat:<threadId>` tabs after the temporary fork starts, and never pin or persist those tabs.
- DB view tabs keep the DB view selector pinned above board, list, toggle-list, canvas, and calendar content, with task search and supported view-local filter/sort/display controls inside that tab body
- Page Stage opens as a Window Session-local tab when opened from persistent entry points such as the command palette, thread Page links, or the explicit Page Stage picker. Single-clicking a visual card from a Kanban DB View opens or replaces a renderer-local Page preview in the active Session view; double-clicking opens a persisted local Page tab immediately. A Page tab can remain in the active Session view while rendering a Page accessible through another Project; the active Session supplies placement context, while the tab config's Project is the authorization context for Page content, history, and terminal requests. Cross-Project Page tabs show the content Project as a compact prefix before the Page title, and tab hover tooltips expose the full title/Project context. Page tab config persists only Page identity, access context, and a title snapshot; navigation history is never stored as Page ancestry. Page Stage resolves the current root-to-parent ownership path from Page authority in one Project-scoped read and projects it as a single-line breadcrumb in the top toolbar. Opening a sibling through `pageRef`, a Database View, history, or any other entry point therefore yields the same canonical breadcrumb as opening it directly. Page moves, renames, lifecycle changes, and grant changes invalidate the path read model; inaccessible ancestors are not exposed, while the current item follows the mounted Y.Text title. The current Page stays non-interactive, and every visible or overflowed ancestor can reopen its Page tab in the same authorized Project context. When the DB tab group has a right-side sibling group, new Page previews or tabs open in the nearest group to the right; when the full-width right panel has only the DB group, opening a DB View row first creates a right-side group and then opens there. Focusing an existing persisted Page tab clears any preview in that leaf and preserves the current right-panel width mode. Page tabs keep the Page Stage shell stable while board summary or full detail hydration is pending: the toolbar is visible but disabled, the title uses the tab snapshot when available, and only unresolved property/editor regions skeletonize. Missing Page/Project targets render a clear empty state only after loading settles instead of a blank or misleading panel. A panel leaf renders only its selected tab body. Switching tabs disposes the inactive EditorView, NodeViews, and DOM and removes local Awareness, while the PageTab keeps its headless collaborative model—Y.Doc/provider, BlockNote editor, and UndoManager—under the stable Window Session view/tab identity. Returning attaches a fresh EditorView to that model, restores the cursor through Yjs-relative positions after current remote changes have reconciled, restores PageTab-local scroll, and reactivates the main NFM editor only when it was the Page's last-focused region. Explicit local tab close, Window Session view teardown, or descriptor identity invalidation disposes the retained model exactly once. An unpromoted Page preview disposes its model when the preview disappears; promotion keeps the same tab/model identity and begins persisted local retention without remounting the editor.
- Page Stage omits the Properties section when a Page has neither Data Source property rows nor a Threads row, so standalone nested Pages do not retain empty section chrome.
- In Kanban DB views, cards that are open in selected, visible Page Stage tabs or in the active Page Stage preview in the active session's right or bottom panel render an active ring. Collapsed panels, unselected tabs, and durable Page tabs hidden behind a different preview or temporary tab do not mark board cards active.
- Opening DB View from the right-panel action chooser creates or focuses the current Project DB directly when possible; once that current-Project DB tab exists, the action uses the shared move-to-style picker chrome with command-palette-aligned fuzzy/prefix search. DB View picker results open one DB tab per selected Project. Page Stage picker results group the active session Project's matching Pages first, then other Projects, and can target Pages available through another Project while preserving the active session as the tab owner.
- Terminal opens as a Window Session-local bottom-panel tab with a terminal runtime id and starts in the attached Thread cwd when present, otherwise the owning Project's primary source, otherwise the PTY process default. Pages can request a terminal in a Project execution context, but terminal tabs carry neither Page ownership nor Page IDs. Switching away disposes only the xterm renderer; the PTY and bounded output buffer remain in Main and hydrate the next view. A PTY grants one interactive Window Session lease at a time; another window must explicitly take over. Local tab close releases the lease without killing the PTY, while `Kill terminal`, backend exit, Project cleanup, and app shutdown terminate the runtime and publish exit.
- Panel action shortcuts are `Ctrl+Shift+G` for Review, `Ctrl+\`` for Terminal, `Cmd/Ctrl+T` for Browser, `Cmd/Ctrl+Shift+E` for Files, and `Alt+Cmd/Ctrl+S` for Side chat. Focused right/bottom panel tab cycling uses `Cmd/Ctrl+Shift+[` for the previous tab and `Cmd/Ctrl+Shift+]` for the next tab in the nearest or last focused split leaf, wrapping within that same group. `Cmd/Ctrl+W` closes the active closable tab in that focused leaf without closing the app window. Panel action shortcuts are ignored while focus is inside editor/input/dialog surfaces; focused panel tab cycling and close-tab still work from NFM editor content in the focused panel group but ignore input fields and dialogs. Plain `Cmd/Ctrl+[` / `Cmd/Ctrl+]` remain app-window Back/Forward.
- The active Session view can show, collapse, resize, or full-width expand the right panel, and can show/collapse/resize the bottom panel independently in each Window Session. Right, bottom, and split-panel resize drags remain continuous even when Browser webview content is visible under the pointer. The fixed global header exposes `Toggle bottom panel` and `Toggle side panel` buttons, ordered bottom first and side second, and keeps those persistent top-right toggles visible and clickable over regular and full-width right panels. The right panel owns its expand/restore button in the far-right after-list area of its tab header, followed by a measured spacer for the fixed right header slot; the bottom panel owns its close button at the far-right edge of the whole bottom panel. A regular right panel only narrows the selected thread and does not change its route activity or header ownership. When the right panel is full-width, its tab header visually owns the top row and hides the thread title/header area; the selected route, composer, footer, and lifecycle coordinator remain mounted while only transcript children unmount. Restoring regular width remounts the transcript from its stored view snapshot. If the sidebar is also collapsed, that right-panel tab header starts after the measured left titlebar rail so the left titlebar buttons and right-panel tabs do not overlap. Newly materialized chat Session views default to collapsed right panels; bottom opens when a Terminal tab is created or focused. A Project starter `Database View` Session materializes open and full-width in each Window Session unless that window already has a local view snapshot.
- Attached root-thread sessions use a floating composer overlay at the bottom of the full-width right panel for `review`, `browser`, `db_view`, and `page_stage` tabs. The overlay preserves the normal follow-up composer behavior, latest-turn preview, queued/background lanes, model/reasoning selector, dictation, stop/send controls, and app-shell bottom-panel offset. Side chats, Terminal, Files, blank new-thread homes, and resuming attached threads do not show the root-thread overlay.
- Right and bottom panels support splitable tab groups. Users can split the selected tab from a multi-tab group into a new neighboring group, drag tabs between leaf tab strips with a live insertion marker, drag tabs near the body edge of a leaf to create a split, and resize split groups with sashes. A released sash keeps its committed position while the split ratio is persisted instead of snapping back to the previous layout. Split sashes retain the same token-colored one-pixel hairline as the outer panel edges at rest, with the matching gradient emphasis on hover or drag. Header tab rows insert or move tabs into that group; body drops merge into the group center or split from the body edges. Durable tabs are uniquely owned by one leaf; when the last visible tab leaves or closes from a non-final group, that empty group is removed automatically. The final empty group remains as the panel fallback, and collapsed panels restore their split tree when reopened.
- URL sync: `/?project=<id>`, persisted to localStorage
- Selecting a Project expands its folder and switches the active DB Project context. Project action menus and their dialogs are independent of folder disclosure, so interacting with those surfaces never activates the Project row. Selecting a Session synchronously unmounts the previous task page, mounts exactly one fresh selected task page plus that Window Session's two local panel groups, renders exactly one selected-route title/action set in the global titlebar, restores explicitly owned Composer/transcript/route presentation state, and clears the shared Session's unread flag. Background Codex execution and Main-owned Browser/Terminal runtimes continue through their stable managers without retaining hidden task DOM.
- Task search query is persisted per project and restored on space switching; search lives inside the active DB view tab toolbar for searchable DB views, while Calendar hides that search chrome
- `Cmd/Ctrl+F` opens a body-portal floating content search input for session content instead of panel-local search bars. Threads register the `conversation` domain, Review registers the `diff` domain with precise path/partial-hunk matching and a generation-fenced Git fallback, and active Browser tabs register the `browser` domain backed by the existing Electron `browser-sidebar-command` find bridge. The input seeds from a single-line text selection, uses Enter/Shift+Enter for next/previous, Escape or `Close find` to exit, stores at most 250 local matches while preserving the exact total, and cycles `conversation -> diff -> browser` while focused when a browser target is available. Settings search, DB task search, file tree filter, and jump-to-file remain separate scoped search controls.
- The global command palette has explicit modes. `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P` open root mode: commands remain visible, fuzzy subsequence matches receive character-level highlights, and local Chat and Page metadata joins after two Unicode query characters. Root mode concurrently adds bounded Page-body results, adds bounded app-server Chat history after three characters, and groups the result types as commands, Chats, then Pages. Pages ignore hidden Page-mode filters and fill only the `7`-row discovery budget left after command, Chat, and search-status rows; they have no separate result cap. Unsupported placeholder actions appear only in development as disabled rows with a `Mock` badge and are hidden from production catalogs. `Cmd/Ctrl+G` opens chat-only search across local project-backed/projectless/sessionless chats plus eligible server-only roots returned by app-server `thread/search`; Nodex enriches those hits with local Project/session/pin/status state when available and keeps local metadata results on server failure. `Cmd/Ctrl+P` opens Page search; current title/body hits come from generation/head-fenced Library Page Document projections, each candidate must be readable through at least one selected Project access context, and status comes from the Page's current Data Source. Results expose bounded excerpts through `pages:search` without loading full bodies. Local metadata remains visible during Page-body lookup, and an empty result is shown only after the exact query and Project scope settle. Page mode owns the trailing `Filter` popover and compact active-filter row beneath the input, using the same status/priority/tag/project-style pill language as the Database View toolbar while persisting those filter selections across reopen/reload. A leading `>` no longer switches modes. File search remains a development-only disabled mock until Nodex has a real file-search backend.
- App-window Back/Forward navigation is available from the top-left titlebar controls, `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, desktop mouse Back/Forward buttons, the command palette, and the macOS application menu. It navigates backward/forward through Window Session-owned workbench context: active Project, active Session, DB View, right/bottom active tabs, right/bottom collapsed state, and right-panel full-width state. Transient overlays such as settings, command palette, task search, and browser-sidebar webview history are not part of this stack.
- The command palette always includes `Back` and `Forward` commands with matching keyboard hints; those commands are shown disabled when there is no history in that direction. Browser-sidebar webview history is separate and does not drive these app-window controls.
- Desktop supports multi-window in a single app process (`Cmd/Ctrl+Shift+N`): each Window Session keeps independent navigation and Session views, including tab creation, close, selection, ordering, splits, and panel geometry, while all windows share the same Core-backed Project, Session, Thread, Page, and Database data plus realtime invalidation.
- When Nodex starts, the Settings -> General -> `Restore windows` policy decides whether to restore all retained window sessions, only the last focused session, or one fresh session
- Each restored window resumes its own active Project/Session/tab, panel state, DB View, open Page context, selected Thread context, per-Session view snapshots, workbench layout, and saved window bounds.
- New Window first reattaches the most recently closed Window Session with its exact local identities. When no closed history remains, it flushes and clones the requesting Window Session as a one-time starting snapshot with reminted tab, split-node, Browser scope/runtime, and editor-view identities; without a live source it creates a fresh Window Session. A targeted `Open in new window` always clones its source with the selected Session override and never consumes unrelated closed history.
- Back/forward navigation history is window-session-local and is restored only from that window's session storage; it is not part of the cold-launch resume snapshot saved when all windows close
- Desktop single-instance behavior is scoped per resolved Nodex home (`NODEX_HOME` or `[server].home`). Different Nodex homes can run at the same time (for example packaged release + dev build), while each Profile still enforces one process with many windows.
- Packaged macOS launches from outside `/Applications` show a native prompt to move Nodex into Applications, continue from the current location, or quit before the app runtime starts.
- Project-local Session identity, ordering, pin, archive, unread, no-thread fallback label, the `databaseStarter` marker, and optional Thread link are shared domain data in SQLite. Each Main-persisted Window Session owns the right/bottom panel collapse, size, split tree, active leaf/tab, local tab descriptors, and tab ordering for every materialized Session view; renderer-only state owns previews, transient focus history, and temporary side-chat tabs. Saving uses a monotonic `layoutRevision` with stale-write rejection and atomic file replacement. The `Database View` row is ordinary starter domain content: it starts pinned for new Projects but can be renamed, unpinned, archived, deleted, opened in a new window, and shown in the normal Session row context menu.
- Codex thread metadata lives in `codex_threads`, where `project_id` is nullable. Durable local chat ownership lives in `project_session_threads`, with exactly one Project-session owner per thread; Pages can reference or mention threads but do not own them. Attached session row titles use `threadName || threadPreview || noThreadFallbackTitle || "New thread"`; blank sessions use `noThreadFallbackTitle || "New thread"`. `noThreadFallbackTitle` is not a thread title authority. App-server `createdAt` and `updatedAt` values are compatibility-tainted source observations: a new UUIDv7 Thread uses its ID timestamp, normalized to protocol-second precision, as canonical creation evidence; an existing Thread keeps that creation time and advances recency monotonically with `max(createdAt, previousUpdatedAt, observedUpdatedAt)`.
- Sidebar rows use compact Project folder and session row chrome. The expanded fixed header starts with a `Nodex` product-name row and a right-aligned icon-only Search button, followed by the fixed New chat row; Search opens global Page search and exposes `Cmd/Ctrl+P` in its tooltip. Scheduled and Plugins lead the scrolling content instead of remaining fixed. Once content scrolls under the header, the New chat edge gains a subtle hairline divider and the scroll content fades beneath it; both disappear again at the top. View-local task search remains inside DB View toolbars. Project-scoped pinned chats appear first inside their own Project folder with regular chats immediately below; projectless pinned chats appear as standalone rows in Pinned, followed by pinned Project folders. Unpinned Project folders stay in Projects and projectless non-pinned chats stay in Chats. This pinned composition has no user-selectable layout preference. Project and task collections are real Core windows: a folded Project reads no task rows, expansion reads the first window, and `Show more` follows its opaque continuation instead of slicing a preloaded catalog. Project folder and Project child lists start at five visible rows, `Show more` adds ten rows per click, `Show less` resets to the first five rows, and the active row remains visible without consuming that page quota. Unread sessions show a left dot, read session rows expose trailing `Archive chat`, `Pin chat` / `Unpin chat` only on row hover, when the specific action button has keyboard focus, or open state, and no hover overflow menu button; pinned state uses the filled pin glyph. Other hover-only sidebar affordances do not enter the sequential Tab order unless this spec names them. Session rows open an Electron-native context menu from right-click without selecting the session. `Loading chats...` is reserved for initial session-scope hydration; once hydrated, background Workspace invalidations preserve the current rows or `No projectless chats` empty state.
- Active session rows open `Rename chat` when the row receives a title-target double-click. The same dialog is reachable from the session context menu, the active thread header actions menu, the command palette command `renameThread`, the macOS application menu item `Rename chat`, and `Cmd/Ctrl+Alt+R`. The dialog uses `Rename chat`, `Keep it short and recognizable`, placeholder `Add a title…`, `Chat title`, `Cancel`, and `Save`; it submits the raw input value. Manual session/thread rename sanitization trims outer whitespace, folds internal whitespace, treats empty results as no-op, and truncates over 60 characters to 59 characters plus `…`.
- The session row context menu order is `Pin/Unpin`, `Rename`, `Archive`, `Mark as unread`, `Reveal in Finder/File Explorer/File Manager`, `Copy` (`working directory`, `session ID`, `deeplink`), `Fork` (`local`, `new worktree`), and `Open in new window`; the native archive action id is `archive-thread`. Archiving is non-destructive, optimistically hides the sidebar row, clears pin/unread state, and archives the linked Codex thread when one exists. Snapshot-only Codex sidebar rows archive through the Codex thread archive channel. `Copy deeplink` uses `nodex://sessions/<session-id>`. `Open in new window` seeds the requesting layout with the exact `activeProjectSessionId`.
- Collapsing the Workbench sidebar: width defaults to `300px`, is clamped to `240..520px`, persists under `sidebar-width`, and the explicit `Hide sidebar` / `Show sidebar` trigger, command palette command, native menu item, and `Cmd/Ctrl+B` shortcut all use the same `toggleSidebar` path. The real sidebar closes through an animated progress spring, remains mounted until progress reaches zero, moves the left titlebar controls from the same animated width, and snaps under reduced motion. During expanded-sidebar sash resize, raw widths from `120px` through `239px` keep the sidebar open at the `240px` minimum; only raw widths below `120px` collapse it. The collapsed sidebar auto-reveals only from the inclusive left-edge pointer strip `0..12px`, including while a full-width right panel is open. The floating sidebar remains visible while the pointer stays inside the current sidebar width, while keyboard focus remains inside the floating sidebar shell, or while its resize sash is actively dragging, then hides when those holds are gone. The floating sidebar can be resized from its right-edge sash; its width clamps and persists like the expanded sidebar, but dragging below the minimum clamps to `240px` instead of expanding/collapsing the real sidebar. Focus inside right or bottom panel controls must not reveal the sidebar.
- Sidebar footer keeps a compact Settings button at bottom-left and no workspace switching controls. Its bottom-right account slot stays empty until the Codex account snapshot hydrates, then shows `Sign in` for a signed-out account or the authenticated quota indicator when signed in.
- Settings opens a full-window settings route shell, not a modal dialog or overlay. It replaces the normal workbench body with a left navigation rail, a `Back to app` affordance, and one active section page at a time instead of a single scrollspy document. The settings rail owns only settings navigation, preserves the same renderer-transparent native vibrancy as the normal sidebar, and leaves each section to render a full-width `main-surface` pane with the settings content centered at the established settings width. The shell is path-driven (`/settings/:section`) and redirects invalid section ids to the default visible section. On desktop, the settings rail groups sections and includes a local `Search settings…` field below `Back to app`; `Cmd/Ctrl+F` focuses and selects it, `Escape` clears it, Arrow Up/Down wraps highlighted results, Enter selects only a highlighted result, and selecting a result navigates to `/settings/:section` without clearing the query. The search index is generated from a normalized renderer catalog of section titles, subtitles, group headings, setting row labels/descriptions, option labels, aliases, and hidden runtime Project-name terms; results still navigate to the owning settings section rather than to an individual row. The current sections are `General` (`Restore windows`, `Desktop notifications`, `App updates`, `Diagnostics`, `Telemetry`), `Appearance` (`Theme`, `Sans font size`, `Code font size`), `Keyboard shortcuts` (searchable editable command shortcuts, keystroke search, capture, clear, reset-one, reset-all, conflict warnings, and user-level persistence in `~/.nodex/config.toml` under `[server.command_keybindings]`), `Agent` (`Permissions modes`, `Custom config.toml settings`), `Editor` (`Thread detail`, `Spellcheck`, `Auto-link while typing`, `Auto-link on paste`, `Recognize bare domains`, `Large paste text threshold`, `Large paste description soft limit`, `Open markdown file links in`, `Smart parse block prefixes`, `Strip parsed prefix from title`, `Cmd/Ctrl+Enter to send long prompts`, `Queue follow-ups`), `Page` (`Kanban card properties`, `Page Stage collapsed properties`), `Git` (`Branch prefix`, `Commit instructions`, `Pull request instructions`), `Worktrees` (`Worktree start mode`, managed-worktree inventory), `Local environments` (a settings-surface page constrained to the same centered max-width as other settings pages; its root state is a Project chooser with `Learn more` copy and `Add project`, and Project-specific summary/edit subpages move through a breadcrumb toolbar while editing structured `.codex/environments/*.toml` `setup`, `cleanup`, platform overrides, and reusable actions), and `Backups` (auto-backup on/off, frequency hours, backup retention, history retention, manual backup, restore, per-snapshot delete). `Sans font size` defaults to `15px`, persists locally, updates `--vscode-font-size`, and scales the shared sans typography tokens used by the renderer; `Code font size` defaults to `14px`, persists locally, and sets `--vscode-editor-font-size` globally.
- On macOS, traffic-light window controls stay visible at top-left; when the sidebar is expanded, the sidebar collapse control plus Back/Forward controls sit beside them in the sidebar top strip, and when collapsed the titlebar left region reserves `208px` for the sidebar toggle, Back/Forward, then a compact `New chat` button before the thread title section.
- Page Stage selection lives in the active Window Session view's right-panel tab groups; leaf tab strips support hover tooltips, close, wheel-driven horizontal scrolling when tabs overflow, pointer-only drag reorder, cross-leaf tab moves, and edge-drop splitting through the shared tab strip/tree.
- Settings can choose which optional Page Stage rows start behind the `more properties` toggle (`Tags`, `Assignee`, `Threads`, and `Schedule`).
- Terminal is a Window Session-local descriptor that defaults to the bottom panel, starts from the active Session/Thread cwd before falling back to the Project primary source, and can be moved to the right panel. Page Stage may request a Session-context terminal, but Pages cannot own terminal tabs or PTY IDs.
- Scheduled is a Workbench-owned route opened from the sidebar, command palette, and floating summary Scheduled row while the normal Project/Session sidebar remains mounted. Rust Core is the only authority for versioned definitions, RRULE scheduling and jitter, due leases, run/inbox/read/archive state, occurrences, and reminders; the Host owns external Codex execution and OS notifications. The route provides task/template tabs, search, list, create, edit, Pause/Resume, Run now, delete confirmation, a peer detail rail, Project/environment/model/reasoning/schedule controls, and previous-run actions. Cron drafts require a name, prompt, schedule, Project, and model; heartbeat drafts require a name, prompt, schedule, and local task. Existing edits autosave after a short debounce and route changes first flush a valid dirty edit. `automation_update` can list/search Core definitions, view one, create/update/delete directly, or return suggested changes for user review; direct heartbeats reject unknown/non-local task targets and all mutations share the same Core revision fence and renderer invalidation event. Suggested cards remain render-only until accepted. The active Scheduled collection has a 200-definition domain bound enforced at creation; deleted history remains available through its bounded Core window. The route keeps selection in `/automations` search params, and deleting a definition atomically removes its owned run rows.
- When the Agent provider catalog is available, Scheduled's Model and reasoning control replaces the legacy OpenAI-only list with provider-scoped models from OpenAI, Anthropic, Kimi For Coding, Moonshot, and OpenRouter. Core preserves the exact provider/model/recommended-harness/reasoning tuple, including case-sensitive values such as Kimi `Thinking`; unavailable credentials disable that provider for scheduled-task creation. The old `codex:model:list` behavior remains only as a compatibility fallback when the provider catalog is unavailable.
- Run lifecycle changes broadcast an automation-run update event so Scheduled rows, the automation-run inbox, and the sidebar/recent thread snapshot stay synchronized after scheduled execution, run-now, archive/delete/read actions, and tool-driven deletion.
- Process Manager is a Workbench-owned dialog opened from the command palette `Process Manager`, `Ctrl+Alt+M`, and the floating summary panel `Tasks` section action. It lists Nodex's registered background-process rows for known attached chats, joins currently live app-server background terminal snapshots and terminal-action sessions for status/output data, polls only while open, freezes the visible snapshot while a row action menu is open, sorts live rows by CPU then memory, and keeps previously registered but currently missing processes visible as `not-found` rows. App-server terminal rows use app-server CPU/memory/pid data; local terminal-action rows use the terminal session OS pid and leave CPU/memory unavailable rather than inventing metrics. `Open output` focuses the owning chat when needed and opens a right-panel `Process output` tab that follows the matching command item's live output or the registered terminal-action session buffer. Floating summary `Tasks` rows open the same output tab directly. `Start` and `Restart` are available for registered rows with a command and working directory, create or refresh a terminal-action session, and refresh the row's start time. Restarting a live app-server process stops that process before starting the terminal action. `Stop` handles either a live app-server process id or a terminal-action session.
- When the desktop host reports an active Computer Use PiP stream for the attached thread, the floating summary panel shows a headerless `Computer Use` row between `Tasks` and `Browser`. Nodex derives that active stream state from BrowserUse capture tabs that are unreleased, capture-active, attached to a live webContents, and associated with the attached thread's session. The row's accessible label and native title are `Show PiP` or `Hide PiP` based on the current visibility request from the host, and activation publishes a visibility change back to the desktop host. Attached thread scroll layouts publish the remote-hosted PiP host layout through the desktop bridge, using the thread viewport as `codex-main-thread` and treating the sticky footer and floating summary panel as PiP obstacles. Host layout publication is placement metadata only; threads without an active toggleable PiP stream do not show a placeholder row.
- The session thread page is a live Codex workspace in Electron. Without an attached thread, it shows a centered new-chat home headed `What should we build in <project>?`, with the inline project selector sharing state with the lower composer project selector. The sticky composer exposes add-context, Plan mode, permissions, model/reasoning, dictation, send controls, a project selector, and a `Start in` selector in the attached lower status strip. The `Start in` selector supports `Work locally` and `New worktree`; cloud, connected-app, and suggestion rows stay hidden until those backend paths are intentionally added. Submitting the first prompt starts a session-owned Codex thread and stores the link in `project_session_threads`; if the selected Project differs from the current blank session's Project, Nodex first reuses or creates a blank session owned by that Project, then starts the thread there so session/Project ownership remains valid. The `Chats` section header exposes `New projectless chat`, which creates a blank session with `project_id = null`; its project selectors show `No project`, and its only run target is `Work locally`. The Workbench remains available when the Project catalog is empty, so existing projectless chats and `New projectless chat` do not depend on creating a Project first. Nodex does not allocate a filesystem directory until that blank session's first prompt is submitted. While a first prompt is starting, the session owns a runtime `threadStartProgress` state so navigation away and back still shows startup or failure instead of `No messages yet`; once the first visible turn/user message arrives, the normal transcript takes over. Project `Work locally` uses the selected Project's primary source when one exists, otherwise a generated per-thread local workspace, and relies on the composer send-button pending state until the first turn is visible. `New worktree` requires a Project primary source, creates a managed Git worktree, runs the selected local-environment setup script when configured, starts `thread/start` and `turn/start` in that worktree cwd, streams setup/log progress until the first turn takes over, and links the resulting thread to the owning session with both its cwd and managed worktree path. Thread-id attachment storage remains available at the transport layer, but the workbench header does not expose an attach/detach thread button.
- Fresh projectless chats receive a host-allocated workspace at `~/Documents/Nodex/YYYY-MM-DD/<ascii-slug>/`. The thread directory is the process cwd; `work/` holds scratch analysis, scripts, drafts, and temporary assets, while `outputs/` holds user-facing deliverables. The collection root `~/Documents/Nodex` is the task's persisted workspace/browser root and runtime writable root, and the persisted output hint is `<cwd>/outputs`. Slugs use only lowercase ASCII letter/digit runs, keep at most six prompt words, truncate to 80 characters, and fall back to `new-chat` when no ASCII token exists. Directory collisions use deterministic numeric suffixes before unique suffixes. If child-directory creation fails after the thread directory exists, Nodex keeps the thread directory and uses it as both cwd and output directory rather than rolling back the allocation.
- Projectless identity is `project_id = null` plus its persisted cwd, output-directory, and workspace-browser-root hints; no separate provenance flag is required. Cold resume reuses a valid generated cwd, then the newest retained generated writable root, then a saved concrete browser root, and finally allocates an unsplit replacement workspace where cwd equals output directory. A persistent fork and a side chat inherit the source task's workspace hints without allocating a new directory. When a persisted projectless task references the old Nodex-generated `~/Documents/Codex/YYYY-MM-DD/<slug>` shape, Nodex moves only that referenced task directory to a collision-safe path under `~/Documents/Nodex` and updates its hints; it never scans or moves the shared legacy root, and arbitrary external cwd values remain untouched.
- The active thread title exposes `Task actions` through a title-adjacent ellipsis menu. It offers Pin/Unpin, Rename, Archive, optional Open side task, and a Copy flyout for the working directory, Codex session/thread ID, Nodex session deeplink, and `Copy as Markdown`. Markdown export first completes the current conversation and any parent conversation through the existing renderer owner/follower history protocol, then rereads canonical visible turns, lazily loads the renderer serializer, and writes through the shared text-clipboard helper. The Electron app session grants `clipboard-sanitized-write` only to top-level app windows; webviews, subframes, and unrelated permissions remain denied. Browser/permission failures can recover through the existing DOM fallback, and copy success/failure is reported by toast. The Markdown document keeps its final newline and is not subject to the selected-text bridge's transcript crop; empty canonical output is a silent no-op. No Markdown export endpoint exists in the main process or app server.
- Side chats are temporary forked conversations for questions and lightweight exploration. Starting a side chat sends an ephemeral `thread/fork` with excluded parent turns, injects a side-conversation boundary before any initial prompt, and renders the resulting thread through the same connected local conversation stage inside the right or bottom panel. The child inherits the parent's project/projectless identity, projectless output directory, and workspace-browser root as one workspace boundary. Inherited parent history is reference-only; workspace mutation is allowed only when the user explicitly asks for mutation inside that side conversation. Side chats are excluded from project thread lists, session thread links, durable tab ordering, archive/title flows, and cold-start restoration. Closing a side-chat tab discards its cached temporary thread in the background; missing or discarded side chats render `Side chat expired` with `Start new side chat`.
- Opening a session with an archived attached thread shows an archived-thread restore state. Nodex must not call `thread/resume` for archived thread metadata; the user explicitly restores the thread through `thread/unarchive`, then the normal resume flow can continue after the thread is active again.
- Detailed visible transcript behavior for Threads lives in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md), including answered `request_user_input` rows, plan-implementation follow-up flow, params-owned prompt reconciliation, tool/reasoning rendering, and restart recovery rules.
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
  - Forking from a session-backed thread opens a new project session backed by the forked conversation snapshot and focuses the composer in that new session. Project assignment and the core fork materialize before the thread-start notification gate is released; an older-turn rollback and the synthetic fork provenance marker run only after that release. The rollback response then replaces both canonical child history and that same attached session link before it is published, so the initial fork snapshot is never re-emitted as the final session state. Non-session legacy thread surfaces may still open the forked thread directly.
- Mounted thread turn rendering follows the turn projection pipeline:
  - each visible turn is projected from an ordered item stream into semantic render buckets, then rendered in a fixed order instead of category-priority reshuffling
  - visible order is `model changed -> user -> model reroute -> agent/exploration body (including completed MCP elicitation) -> system event -> assistant with assistant-after artifacts/actions -> proposed plan / todo -> in-progress placeholder -> provenance markers`; unresolved request surfaces remain on the request/composer plane rather than becoming completed activity rows
  - the mounted renderer preserves the canonical per-turn item sequence from the conversation snapshot instead of re-sorting turn items by timestamp or id inside the renderer
  - pre-final assistant commentary stays in the agent-work body ahead of the final assistant anchor; only the final assistant message becomes the dedicated assistant block for the turn
  - the latest open activity group owns the live `Thinking` fallback when possible; blocking requests, safety buffering, incomplete plans, worked-for state, exploration, and visible final answers suppress both group-owned and standalone Thinking
  - consecutive raw subagent items render as one inline activity group; when no raw subagent anchor exists, same-turn background agents marked for inline activity affect commentary ownership, the settled collapse boundary, and active-turn auto-collapse without creating a subagent chip, activity leaf, or empty group, so the independent `Thinking` fallback remains available
  - the latest active turn lifts non-empty todo plus real aggregate diff into one conversation-scoped fixed pill above the composer; blocking requests hide that pill without duplicating it inline, live patch rows remain in activity, completed todo disappears, and completed diff renders once as assistant-after `Edited …` content or a standalone fallback
  - completed turn diffs render as assistant-after `Edited …` cards before the final assistant action strip when a final assistant exists; commentary-only turns keep commentary in activity and place the diff after it
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
  - approvals, request-user-input, option-picker, setup, and implement-plan prompts stay in the footer request surface above the composer rather than being rendered as normal inline timeline blocks
  - dynamic onboarding questions force a `Something else` path on every question and dismiss by returning an empty answer set; ordinary questions dismiss by interrupting the waiting turn unless their auto-resolution window owns the empty response
  - setup onboarding is a three-step request family: role uses a shuffled multi-select catalog with `Something else` fixed last and persists canonical role IDs; task derives up to three interleaved role-specific first-task suggestions plus a freeform path; context recommends connected Google Drive, Slack, and Gmail sources when available and returns ordered, deduplicated source IDs on Continue, while Skip and Dismiss return no sources
  - blocking active requests and background child approval/permission requests replace only the composer editor/footer controls until the request surface is cleared; the background child request is shown before the active-thread request, both may coexist, and a child's private picker/setup/input request does not hide its approval/permission request; existing-thread request surfaces do not render the new-chat-only lower composer status strip
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
  - the toolbar exposes source selection, `+N` / `-N` stats, `Review options`, standalone `Collapse all diffs` / `Expand all diffs`, `Jump to file`, unified/split diff mode, `Hide files` / `Show files`, `Commit or push`, and `Create PR`
  - `Review options` owns word wrap, full-file loading, rich preview, word diffs, hide/show white space, and copy-git-apply commands; full-file loading is enabled by default, so the default menu action is `Don't load full files`; inline stage/unstage/revert actions stay out of the Review toolbar
  - file diffs collapse large unchanged ranges into clickable `N unmodified lines` rows that can expand upward, downward, or both in 20-line increments; full old/new context loads only for an expanded partial row after that row enters the virtualizer margin, and a failed or stale full-context read leaves the partial diff intact
  - review file headers and the right-side file tree render file-type icons for known extensions and tool config files, with unknown files falling back to the default file glyph
  - Git-backed review sources use a generation-bound live metadata summary followed by coalesced tracked/untracked partial-diff requests; repository events publish ordered tracked/complete phases, and stale diff, full-content, or search responses cannot replace the current generation
  - `Last turn` renders the newest available completed turn diff even while a newer prose-only turn is running; Review subscribes to a minimal diff/comment projection rather than the whole streaming conversation
  - when full context is eligible, Nodex batches at most four Git objects through `git cat-file --batch`, validates complete lines against the existing partial hunk metadata, and expands that metadata without recomputing a full-file diff; closed, offscreen, generated, binary, new, deleted, gitlink, pure-rename, and unchanged rows do not start full-content reads
  - the Review scroll surface uses the diff renderer's real virtualizer with a 1000px margin, memoized file rows, and row-local full-content state; collapse-all keeps textual diff hosts connected and changes their package-owned collapsed layout state so cached virtual heights reconcile atomically; a source-scoped global disclosure default plus sparse file overrides makes new files inherit the current bulk state; files above 2000 changed lines disable word-level diffing
  - generated-file-aware content search stays local only when all required row data is ready; otherwise main streams the generation-bound Git patch, excludes generated bodies, and caps stored matches at 250 while preserving the total count
  - the right-side file tree is fixed-width, can filter changed files with `Filter files...`, and can be hidden without resetting diff selection or comments
  - changed diff lines expose a hover `+` gutter utility, right-click `Request changes`, and drag/range selection for creating `Local comment` request-change annotations; submitted local comments become pending composer attachments and are sent with the next turn/steer as both structured review-diff comment context and text user input
  - model-produced `::code-comment{...}` directives render as readonly path/line anchored review annotation cards above the matching file diff
  - GitHub PR comments use the inline review-comments API for path/line/side/range/reply metadata instead of showing issue-level comments as fake inline comments
  - very large reviews fall back to a capped one-file-at-a-time mode when they exceed file-count, total-line, total-byte, or single-file changed-line thresholds
  - detailed Review panel behavior lives in [Review Right Panel Behavior](./review-right-panel-behavior.md)
- Create Projects from the sidebar Projects header and remove them from project-row action menus. `Project sidebar options` exposes `Removed projects…` for restore.
- Default project is seeded on first boot with a UUID canonical ID and a retained `default` legacy alias.
- In Electron, startup opens into a flat blocking surface with the shared shimmering Nodex mark until the renderer has both native Core readiness and its window bootstrap. Ordinary opening copy stays visually quiet for 1.8 seconds. Only a versioned advisory event emitted by the authoritative Core after it has classified a supported older Store can switch the surface to `Updating local data…`; fresh and current Profiles and incumbent reuse never present migration messaging, and Nodex never fabricates a migration percentage. Fresh Profiles are created as exact Rust-owned v94. Exact frozen TypeScript v26, either frozen v57, v68, v82, and v83 Profiles are backed up and converted in isolation to the frozen exact v84 handoff; direct v84 and Rust-owned v85/v86/v87/v88/v89/v90/v91/v92/v93 Profiles are also accepted. Core validates the complete inventory and content before one-way v94 publication. The v90 step removes shared Project Session view authority and retains at most one valid initial Database View target; v91 normalizes sidebar lane ranks; v92 canonicalizes every schema-owned `TEXT` timestamp column ending in `_at` to millisecond UTC ISO-8601 before strict protocol reads begin; v93 converts the retained initial Database View pointer into the durable `database_starter` marker so the presented View always resolves from current Database authority; v94 replaces the legacy optional Project icon with one required, constrained color-plus-marker appearance, preserving a valid legacy emoji and otherwise defaulting to black/folder. Unfrozen same-version lineages, drifted, ambiguous, future, or damaged stores fail closed while HTTP, schedulers, and windows remain unavailable. A renderer bootstrap failure leaves the loading state and presents an explicit restartable failure surface.
- Project ID: opaque UUID generated server-side. Legacy slug IDs resolve through aliases, but responses return canonical UUIDs.
- Project appearance is durable Project metadata owned by Core: one of eight constrained colors plus either one of the canonical named markers or a normalized legacy emoji. Every Project surface renders the same appearance. Create/Edit stages appearance with name and sources and saves them atomically; Cancel discards every staged field. The sidebar hover card can change appearance immediately with optimistic, serialized persistence.
- Project sources: ordered source folders persisted separately from the project row. The first source is the primary workspace root for Git, Files, Review, local thread cwd, and managed worktree base repository; all configured sources are writable workspace roots for sandboxing.
- Empty-source projects are valid Nodex data containers. Work-local thread starts allocate a generated per-thread workspace; managed worktree and local-environment flows require a primary source and surface a clear error when missing.
- Sidebar project rows do not show the source path inline. Each project row actions menu exposes, in order and without separators: `Pin project`/`Unpin project`; `Reveal in Finder` only when the project has exactly one source folder (no inline path); `Create permanent worktree` when the primary source is a Git repository; `Edit project`; `Mark all as read` only while the project has unread chats; `Archive chats` (disabled when nothing is archiveable); and a plain `Remove`. Removal is available independently of the Library workspace release gate.
- Hovering a sidebar Project row opens an interactive Project detail card after a deliberate 700 ms delay; keyboard focus opens it immediately. It stays open while the pointer crosses into the body-portalled card or its inline marker picker, closes after a 100 ms safe-leave delay, and supports a 300 ms warm handoff between peer rows. The card shows the canonical marker and inline-renamable name, pin state, complete Project activity counts independent of loaded task pages, optional Git repository identity, every ordered source root, and `Edit project`. Source rows open the actual local path in the platform file manager. Opening menus, dragging, or interacting anywhere in the card or registry-owned dialog cannot fold or expand the Project group; a floating auto-revealed sidebar remains visible while one of its cards is active.
- `Edit project` opens one dialog owning the project marker, name, and ordered source folders: rows show the folder name with the full path on hover, the first folder carries a `Primary` badge when several exist, other rows expose `Make primary` (moves the folder to the front) and every row a remove control. `Add folder` opens a multi-select native picker; folders can also be dropped onto the list; duplicate folders (case-insensitive) collapse to the first entry. Saving writes appearance, name, and folder order together; the dialog footer also hosts `Remove project`, `Cancel`, and `Save`. `Archive chats` confirms, archives the project's chats in small batches, and reports success/partial failure; `Mark all as read` clears unread state without confirmation.
- The left sidebar has one fixed lane-aware pinned projection. Every project-scoped pinned chat renders at the top of its own project folder, before that project's regular lane; moving it to another project folder preserves pin state unless it is dropped explicitly into the regular lane. Each regular lane starts from stable last-activity order and projects that scope's persisted Manual order only into slots belonging to tracked durable thread IDs. New, temporary, and otherwise untracked rows keep their activity-derived slots until a later manual drag reconciles them; selecting or loading a session cannot rewrite this order. A manual reorder changes only sidebar order authority and publishes a refreshed sidebar snapshot; it does not rewrite or refetch project-session layout. Pinning changes lanes without deleting the thread's project manual identity, so unpinning can return it to the same tracked position. Starting a move leaves the visible project-folder list intact and enters the drag preview without reloading the renderer. While reordering within a lane, crossing a row midpoint updates the insertion indicator even when the hovered row does not change; dropping a visible non-no-op indicator commits that order without reloading or crashing the renderer. Persistence failures restore the authoritative order and show an error. Projectless pinned chats render as standalone Pinned rows, and pinned chats with a temporarily unknown project fall back there. Pinned project folders render in Pinned with both of their project-local lanes; `Projects` renders unpinned project folders; and `Chats` renders projectless non-pinned sessions. If there are no projectless/fallback pinned chats or pinned project folders, the Pinned section header is hidden.
- The independent Library workspace is guarded by the temporary, startup-fixed `libraryWorkspace` release gate. It defaults off and can be enabled only with `NODEX_LIBRARY_WORKSPACE_ENABLED=true`; it has no Settings or `config.toml` control. The gate covers Library navigation, routes, queries, drag/drop, and Project-grant UI only. Library ownership, migrations, Project authorization, Agent tools, Library HTTP/IPC authority, and Project remove/restore remain active. Delete the gate after the Library release checks are complete; it is not a permanent preference.
- When enabled, `Library` appears after optional Pinned and before Projects. It is a bounded, lazy ownership tree: the first ten root Page/Database Blocks are shown in canonical order, the active route and ancestry remain visible, Page branches load direct Page/Database children on demand, and multi-View Databases may disclose hosted Views. Data Sources, ordinary body Blocks, references, and Database row Pages are not sidebar children. The tree uses one keyboard focus model with directional navigation, Home/End, Enter, and typeahead; `More` opens the complete Library workspace.
- Library Home searches and filters all active or archived Pages and Databases independently of Project lifecycle, including Data Source row Pages. It can open Page and Database content after every Project is archived. Creating a Page or Database, moving ownership, archiving, restoring, editing, or browsing never activates a Project and never creates a resource grant. A new Database contains one initial Data Source and default View; Add Data Source remains hidden.
- Library Page, Database, property, and Document routes use trusted local-human Library authority. Public renderer results identify `accessContext: library` and do not expose the archived compatibility Project used by private storage. New Untitled Pages focus their collaborative title. Opening a Database uses its durable default View unless an exact View was selected. Every Library route keeps the window navigation and Sidebar controls in the global header while hiding Project-session right/bottom panel controls without mutating the retained Project panel state.
- `Give Project access…`, `Open in Project…`, and Library-to-Project drag require explicit recursive `Read` or `Read & write` confirmation. An equal or stronger existing grant produces no duplicate write. These actions do not move the resource or rebind either Project's primary Database. Within Library, Page/Database drag and `Move to…` change only exclusive ownership and preserve stable IDs and owned Documents; View rows cannot move.
- Sidebar project headers can be reordered by dragging the project-label activator. Pointer drag starts after 6px; the row midpoint selects a before/after insertion boundary, refreshed on both drag move and drag over. The source remains as an inert 20% ghost, sibling projects stay fixed, and a compact body-level overlay follows the pointer. A zero-height 2px line with a leading outlined dot marks the final boundary. Normal project groups persist their order in `project_order`; pinned project groups render inside the single `Pinned` section above Projects and persist their order in `pinned_project_order`. Semantic no-ops do not write, and failed writes clear the matching optimistic order and show the shared reorder error.
- Dragging a normal project header onto the pinned section pins that project and leaves normal project order unchanged. The Projects section excludes pinned projects while preserving their normal order for later unpinning.
- The Projects header exposes compact actions: the project-group action is hidden when it does not apply, shows `Collapse all` when more than one visible project folder is expanded, and then shows `Reopen previous` to restore that previous expanded set after collapsing all; `Project sidebar options` contains `Archive all chats`, the fixed `By project` organization, and the fixed `Manual order` sorting contract, with no pin-specific organization control. `Manual order` is not a pinned-layout mode. `Add new project` opens a submenu with `Start from scratch` and `Use an existing folder`, both using the project-add glyph. `Start from scratch` opens the `Create project` dialog — the same name plus source-folders body as `Edit project` — and requires at least one source folder before creating. `Use an existing folder` opens the multi-select native folder picker, names the project from the first folder's basename, and stores the picked folders in order as its sources.
- Removing a Project archives only the execution context plus its Database binding through the serialized Core writer. Before commit, the Desktop Host discovers every Project-owned Thread (including unlinked child/subagent Threads) and checks active turns, pending requests, live terminals, and running background processes; any blocker or inspection failure leaves the Project unchanged and is explained to the caller. A shared per-Project admission gate serializes the final preflight/Core commit with new Terminal and Codex turn starts across IPC and HTTP. A committed removal excludes the Project and its chats from ordinary navigation, rejects new Project-owned Sessions, Thread mutations, terminals, and execution work in Core, closes Browser ownership and discards exited Terminal snapshots best-effort, retains historical Sessions/Threads as read-only, and leaves source folders plus every Library Page, Database, Document, asset, and durable identity untouched.
- `Project sidebar options` always exposes `Removed projects…`. Its lazy manager lists archived Projects, their source roots, and per-row restore actions. Restore preserves the Project ID, Sessions, Threads, and source configuration, increments the binding revision, recomputes current access, and appends the Project to active Project order without reordering survivors. Window Session-local views remain presentation state and re-resolve their targets after restore. If the active Project is removed, selection moves to the adjacent surviving Project; after the final Project is removed the Workbench enters an explicit projectless state rather than inventing a fallback Project. Permanent content deletion remains a separate Library resource operation.
- Codex thread links are session-owned. Cards can mention threads and send selected content to chats, but they do not own durable Codex threads.

#### 2. Kanban Board View
- 8 columns representing workflow stages
- Drag-and-drop Database Pages between columns
- Each kanban column header includes a `more actions` popover for collapsing that column and adjusting its persisted expanded width; collapsed columns still show their card count and the same `more actions` trigger
- Shift-click in Kanban toggles a temporary multi-selection from the clicked Page presentation; selection can span columns. A board drop reads one atomic query from the Project-bound Database's default Data Source and View, then commits Data Source value changes plus the selected run's Page-coordinate View positions as one `DatabaseApply`. Single and bulk intents use `set_value(s)` followed by `position_page(s)`; the client submits stable Page anchors and never rank strings.
- Same-window cross-surface drag treats a Kanban Database View as a projection over real Pages. The explicit NFM side-menu starts one typed window-local session after BlockNote returns the exact root selection. Dragging one or more Kanban Page presentations into a visible NFM editor moves those same-ID childless Page shells into the host Page Document; dragging editor roots into a Kanban column moves them into that Data Source, promoting compatible text-like roots in place and wrapping non-convertible roots in a Page; dragging between different Page Documents moves the same stable roots through the same command. A Page cannot be moved into itself or any Page in its ownership subtree; invalid hover targets may be suppressed for feedback, and the writer always rejects the command against current authority. Holding Option/Alt at drop time copies the recursive ownership closure with fresh application IDs instead. At a nested editor boundary, only the deepest eligible surface shows an insertion indicator and handles the drop; parent and child indicators/commands never coexist. One `BlockTransfer` commits source/target Documents, exclusive parent, membership, View position, projections, history, and receipt atomically; the renderer carries no Page body snapshot, never removes the source optimistically, and suppresses BlockNote's native cross-editor slice insertion/deletion and text caret while the session is managed.
- Same-Data-Source Kanban reorder remains a View-position operation because it does not change the Page's exclusive parent. Cross-window native DnD is intentionally unsupported until the platform can prove a live source session and safely carry the logical transfer payload; it fails closed without mutation.
- Data Source membership makes a Page eligible for every View over that Data Source; a manual View position is optional presentation state. In the default Kanban View, an unpositioned Page still appears in the column selected by its status property and sorts after explicitly positioned Pages with Page ID as the stable tie-breaker. Delete/restore, transfer, search, and recurrence cloning preserve the absence of a position instead of inventing one. On the first explicit manual move into a group containing unpositioned Pages, the writer atomically materializes the complete unfiltered logical group order before inserting the moved Page run; logical anchors may therefore name positioned or unpositioned Pages, including through Agent create/move destinations. A persisted partial position or a position group that disagrees with status remains a typed authority error.
- The NFM side-menu `Move to` action opens a compact destination popover with grouped `Database` and `Page` search results. Database rows disclose View group destinations, while Page rows append Blocks to an existing Page. Detailed behavior lives in [NFM Editor Move-To Popover Behavior](./nfm-editor-move-to-popover-behavior.md).
- In NFM editors, Page outliner property chips sit in the same inline text flow as the Page title, so wrapped titles use the full row width like inline Kanban card properties instead of a separate leading chip column.
- Visual card previews with priority badges
- The Database manager lists every active Page in the selected Data Source independently of View filters. It can create a Page in that Source, atomically move a Page from another parent, move a Page back to the Library without deleting it, select the target durable View and a stable null-group Page anchor, and author View name, kind, nested AND/OR filters, ordered sorts, grouping, visible properties, and durable View order. View drafts retain the revision at which editing began; a concurrent change is a typed conflict rather than a whole-config overwrite. Other open windows refresh from the committed Database event.
- Kanban card reorder keeps a non-layout-shifting insertion indicator; the source card stays as a static ghost in place while dragging, same-column reorders do not live-shift sibling cards, columns do not tint as separate previews, the drag overlay is geometry-matched to the source card so it starts aligned with the cursor, and dropping on the visual gap between cards still inserts into that gap instead of falling through to column-end append
- The Kanban insert-position indicator is resolved against the remaining non-dragged cards in the target surface, so same-column and multi-card drags never draw the line above a dragged ghost when the actual drop will land before the next remaining card
- Kanban card property chips (priority/estimate/tags/assignee) render inline with the card title by default, and Settings can move them above the title or below the body
- Right-clicking a Kanban card opens a Radix context menu with a searchable action list; production shows only real actions: `Copy deeplink` copies a `nodex://pages/<page-id>` deeplink to the represented Page, and `Delete` invokes the Page lifecycle command. Reference-only actions such as favorite/icon/property/layout/open/duplicate appear only in development or Storybook as disabled rows with a `Mock` badge. Project access changes through Database binding or resource grants; this menu never transfers Library ownership between Projects.
- Real-time Database invalidation is resource-addressed. `database-changed@2` keeps Project as subscription/actor context and carries canonical `affectedDatabaseIds`, plus Data Source, Page, and View ID sets when the committing Module knows them. Renderers refetch authority instead of replaying schema/value/position deltas or interpreting membership as Project ownership.
- Page lifecycle, property, Database Module, and Document edits use separate typed commands. Page lifecycle authority is Library-owned and Project-authorized: create checks the bound Database, while reads and mutations of existing Pages require an effective recursive Page or Database grant. Stale parent or scalar metadata edits return typed revision conflicts; set-like properties preserve add/remove intent. Title/body merge through Yjs and are never retried as a whole-Page overwrite.
- Header task search supports token-contains matching across title/description/tags/assignee/id in Kanban, All Tasks, and Toggle List views
- Kanban card drag-and-drop stays available while search or toolbar filters are active; reordering maps the visible drop slot back into the underlying board order so hidden non-matching cards keep their relative position
- When a non-default toolbar sort is active in Kanban view, cards remain draggable across columns, but same-column manual re-ranking is disabled because the active sort, not board order, owns the visible ordering
- Detailed drag-and-drop behavior and invariants: [Kanban Drag and Drop Behavior](./kanban-drag-and-drop-behavior.md)

#### 3. Toggle-List View
- Third Project Page tab (`Toggle List`) renders summary/reference rows; expanding a visible row opens that Page's own collaborative editor and provider.
- Each top-level toggle row maps to one Page summary/reference. Expanding it mounts that Page's own title/body Document rather than mapping the body projection into row children.
- Toggle-list editor uses the same shared slash-menu controller as Page Stage (defaults + custom blocks) to keep insertion UX aligned
- `pageRef` and Database View references are reference-only Blocks. Idle collapsed Page rows render summary projections; disclosure or explicit title engagement lazily mounts that Page's independent collaborative Document, never a copied child subtree in the host editor.
- Reference disclosure preference persists in the local browser Profile by stable shell Block identity, while title engagement, visibility, navigation handles, and provider activation remain mount-local. A small renderer-wide activation budget bounds live nested providers and gives focused editing priority over passive visibility. Separate `pageRef` occurrences targeting the same Page retain independent preferences. Self references do not recursively mount, and a Project must hold an effective grant before mounting any referenced Page.
- Board state sync is shared per project (`useKanban` store-backed): one realtime subscription/fetch pipeline fans out to all consumers and exposes O(1) `pageIndex` lookup
- Toggle List row and in-editor toggle disclosure preferences persist in the local browser profile and never enter a Page body or Y.Doc. Active windows keep their own live presentation; reopening or remounting hydrates the latest local preference without producing collaborative updates or undo history.
- View-toolbar filter/sort controls:
  - `kanban`, `list`, and top-level `toggle-list` share one view-local filter model with grouped logic (`OR` across groups, `AND` within group) and status/priority/tag clauses
  - Priority clauses can explicitly include or exclude empty priority values via the `-` filter chip instead of treating empties as an implicit side effect of selecting all concrete priorities
  - Each supported view has its own persisted sort stack; list-header sort clicks write through to the same shared toolbar sort state, and nullable `priority` / `estimate` sorts can place empty values either first or last (default: last)
  - When active, filter/sort rules surface as compact pills in a collapsible bottom band inside the toolbar; the sort side uses one leading chip (`Field` with direction for a single sort, `n sorts` for multiple) separated from filter chips by a thin divider
- View-stage display controls move into the toolbar `Display` popover:
  - `kanban`: reorder + hide/show board-card properties for `priority`, `estimate`, `tags`, `assignee`
  - `toggle-list`: reorder + hide/show row properties for `priority`, `estimate`, `status`, `tags`
  - `kanban` and `toggle-list` can also show empty `priority` / `estimate` values as neutral `-` chips, using the same styling in both views; kanban keeps those empty chips editable through the same inline property menu used by filled chips
- Row properties render as compact chips (priority/estimate/status) matching existing Board/Page Stage visual language.
- Toggle-list editor surface reuses the same `nfm-editor` styling layer used by Page Stage for consistent typography/spacing/toggle visuals
- Toggle-list Page title/body edits use each Page's own mutation/Document authority, while board updates refresh summary rows through the shared Project subscription.
- Top-level rows are Database query results, not host-editor children; membership and View operations own their structure/order.
- Supported DB view filter/sort/display settings persist per project and per view in renderer localStorage

#### 4. Native Core Storage
- One detached Rust Core exclusively owns the Profile's `nodex.db`, WAL, collaborative Documents, projections, receipts, schedules, backups, and migrations. Electron never opens the database.
- Accepted legacy imports are the exact frozen TypeScript v26, both frozen v57, v68, v82, and v83 physical inventories plus the exact final v84 handoff, which contains no local Thread transcript/FTS projection. Earlier sources receive an immutable database/assets backup and are advanced only in a staging Profile by the bundled hash-pinned migrator; the earlier v57 inventory first receives native named-column Thread and Automation table normalization in that staging copy. The migrator is reproducibly generated from a fixed historical source commit plus deterministic import-only compatibility overlays that preserve pre-cutover Page projection names and workflow-status identities, refresh recovered option registries, give explicit cross-Project Page references same-Library read grants, retain missing targets as inert unresolved-reference diagnostics, and audit old identity residue on token boundaries in Database authority and committed evidence without treating opaque Session UI state as identity authority. Core validates exact v84 plus native Document/projection semantics before journaled v94 publication; fresh Profiles start directly at v94, and exact v85/v86/v87/v88/v89/v90/v91/v92/v93 native stores are backed up before their forward upgrade. The v90 migration drops historical shared tab/panel rows and extracts at most one valid Database View into `initial_database_view_id`; v91 converts legacy sidebar JSON order into normalized lane ranks and compact Thread preview metadata; v92 rewrites every schema-owned `TEXT` `*_at` value to canonical millisecond UTC and rejects unparseable or later-drifted timestamps; v93 rebuilds `project_sessions` with the `database_starter` marker backfilled from the retained pointer and drops `initial_database_view_id`; v94 replaces the optional Project icon with constrained, non-null appearance columns and preserves a valid legacy emoji.
- One serialized native writer commits Block/Page/Database/Workspace/Automation semantics and their events atomically, while bounded read snapshots serve desktop, browser, CLI, and Agent adapters.
- New user/content Blocks, Database Containers, Data Sources, and Views use independently allocated canonical lowercase UUID-v7 identities and are validated only at creation. Existing global IDs remain opaque. Built-in Data Source Properties use reserved stable IDs; custom Properties use `p_` plus eight base64url characters, and custom options use `o_` plus eight base64url characters under their owning Property. Unbound references carry `{dataSourceId, propertyId}` and, for options, `optionId`; display names never define identity. Membership, operation, and mutation identities remain opaque, while explicit timestamps, ranks, and sequences are the only ordering authority.

#### 5. Page and Data Source Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Canonical lowercase UUID-v7 Block identity; Page has no separate storage ID |
| `title` | string | Yes | Plain-text projection of `Y.Text("title")` (max 2,000 chars); used by search, tables, accessibility, and plain CLI output |
| `richTitle` | portable rich text | Yes on current reads | Canonical styled/link/mention projection of the Page Document title; structured transports preserve it without loading the body |
| `description` | string | No | Read/export projection of `Y.XmlFragment("body")` as [Nested Markdown](../references/nested-markdown-spec.md), including image/attachment/thread/date syntax (max 1,000,000 projected chars); never a collaborative write field |
| `priority` | enum | No | Optional priority tier: p0-critical, p1-high, p2-medium, p3-low, p4-later |
| `estimate` | enum | No | xs, s, m, l, xl |
| `tags` | string[] | No | User-facing canonical display names (default: [], max 64 tags, each max 64 chars); Page creation resolves or preallocates owner-scoped option IDs before enqueue, while low-level Data Source values carry those option IDs |
| `dueDate` | date | No | Task deadline (YYYY-MM-DD format) |
| `scheduledStart` | datetime | No | Scheduled start timestamp (ISO 8601) used by Calendar and recurrence windows |
| `scheduledEnd` | datetime | No | Scheduled end timestamp (ISO 8601, must be after `scheduledStart` when both are set) |
| `isAllDay` | boolean | No | Explicit all-day flag; when `true`, schedule is stored as local-day start plus end-exclusive day boundary (`scheduledStart` + `scheduledEnd` required) |
| `recurrence` | object | No | Repeat rule (`daily|weekly|monthly|yearly`, interval, optional weekdays, optional inclusive until date) |
| `reminders` | object[] | No | Reminder offsets in minutes before each occurrence start (`[{offsetMinutes}]`, deduplicated) |
| `scheduleTimezone` | string | No | IANA timezone used to anchor recurring schedule expansion |
| `assignee` | string | No | Who's working on it (max 256 chars) |
| `runInTarget` | enum | No | Where new Page-requested threads run: `localProject` (default), `newWorktree`, `cloud` (mock/blocked) |
| `runInLocalPath` | string | No | Optional local folder override used when `runInTarget=localProject`; empty means project primary source or generated per-thread workspace for empty-source projects |
| `runInBaseBranch` | string | No | Optional base branch for new worktree creation (`runInTarget=newWorktree`) |
| `runInWorktreePath` | string | No | Persisted managed worktree path used for sticky reuse when `runInTarget=newWorktree` |
| `runInEnvironmentPath` | string | No | Optional repo-relative `.codex/environments/*.toml` path used when creating a new managed worktree; selected in Page Stage and edited in Settings -> Local environments |
| `revision` | number | Yes | Compatibility read of the Page Block metadata revision; individual mutable properties carry field/path revisions |
| `created` | datetime | Yes | Creation timestamp (ISO 8601) |
| `order` | number | Yes | Compatibility read of the primary Database View order; an absent manual position maps to the deterministic nulls-last tail, while durable ordering remains a View-specific fractional rank |

#### 6. Inline Page Creator
- Notion-style inline form in each column
- Cards created via the inline creator are inserted at the top of the current column
- Quick-add with optional priority, estimate, tags
- Enter to save, Escape to cancel
- Priority/estimate and other single-choice pickers use the shared Codex dropdown facade rather than a separate shared Select primitive
- Property menus portal into the creator's interaction boundary, so choosing a property never dismisses or submits the draft; only an interaction outside that complete boundary invokes click-outside save/cancel

#### 7. Page Stage Editor
- Notion-style slide-out panel for Page details
- Always-editable fields (no edit mode toggle)
- Page is the user-facing term for a document-bearing Block; Page Stage never introduces a second content identity.
- Page Stage opens through membership-independent Page Detail. Library-, Page-, and Data Source-parented Pages all resolve the same Block and owned Document; absence from a Database View is never treated as a missing Page. Nested `page` and `pageRef` actions therefore open the same Y.Doc in a normal Page tab without copying content or restoring an old membership.
- Title/body, history, Threads, and `Run in` controls are available for every Page. Live Agent execution state belongs to Thread/session runtime and is not shown as Page metadata. Status, priority, estimate, tags, assignee, due/scheduled dates, occurrence actions, Data Source moves, and Database lifecycle actions render only when Page Detail includes a matching active membership and property coordinates. A standalone Page receives no synthetic `triage` status or empty Data Source values.
- Membership refresh changes only the optional Page Stage Database capability. It keeps the Page Block ID, owned Document ID/provider boundary, collaborative content, and local undo scope stable. Opening a Page is read-only with respect to ownership.
- Production Page Stage prepares the exact Project-scoped owned-Document descriptor before rendering content. Only a ready, schema-compatible `yjs` descriptor mounts the Page editor; `canvas_scene` descriptors route to Canvas view, and invalid descriptors remain on a retryable fail-closed diagnostic surface
- Page Stage uses one continuous content skeleton across Page hydration, Document preparation, runtime creation, and the initial state-vector handshake. Normal opening never replaces that skeleton with a second text-only loading state. A terminal open or resync failure remains inline until recovery, shows the concrete failure reason beside Reload, and offers expandable, copyable diagnostics with the protocol error code and Document identity; delayed/offline sync status remains available after a Document has opened.
- A title-only Page opens as a normal empty editor. Its collaborative body contains one authority-owned empty paragraph with a stable Block ID, while NFM/plain-text exports remain empty; the editor never creates a placeholder identity during mount.
- On a primary Page, every mounted writable surface owns an independent Y.Doc client/session, completes state-vector synchronization before mounting content, binds title to `Y.Text("title")`, and binds BlockNote to `Y.XmlFragment("body")`.
- Page title is a rich contenteditable projection of that Y.Text. It preserves bold/italic/underline/code/color, links, line breaks, and registered title-safe mention atoms; formatting never applies to atomic objects or line breaks. Ordinary input and deletion mutate minimal Y.Text ranges, Shift+Enter inserts a canonical line break, Enter remains Page Stage navigation, and paste falls back to sanitized plain title text when external rich content is unsupported. Copy and cut write plain text plus semantic HTML derived from the selected title content, so Page-title presentation weight never becomes a copied bold mark while explicit inline formatting remains portable; cut deletes only after a clipboard payload is written successfully.
- Synced Block sources are not another Page: each is a system-managed body-only collaborative Document whose Library placement is omitted from normal Page/Database navigation, while visible occurrences are childless references to the same source Block. The typed ownership command is available through renderer IPC and CLI. A collapsed occurrence creates no provider; expanding a visible occurrence mounts the source's independent collaborative editor without copying its body into the host Page.
- Reusable Template Library sources and non-primary Canvas owners use the same production command boundary. Templates have an authoritative human name, childless references, and copy-on-instantiate semantics with fresh Block IDs; expanding a reference opens the independently synchronized source without embedding foreign body content. Canvas scene Documents remain in Canvas view and never mount a BlockNote body editor. A source can be deleted only after a global exact-head scan proves that no Project references any Block in its recursively owned closure; deletion retains Documents/history until GC. Long-form content remains a Page, ordinary code remains a `codeBlock`, and size never changes a Block's durable type or ownership.
- Promotion/demotion preserves selected subtree IDs, allocates fresh IDs only for copies, obtains host/source flush evidence through the Host coordinator, and lets Core reprepare and either commit a sole-occurrence demotion completely or leave both Documents unchanged. Clients never submit writer fence proofs directly.
- Primary title/body edits are Yjs transactions and never run whole-NFM autosave, external whole-body replacement, or description conflict overwrite. Lifecycle and metadata use separate typed commands; explicit NFM import requires current Document generation/head CAS and produces a forward Yjs transaction.
- A descriptor that is not ready/primary/schema-compatible remains on a fail-closed diagnostic surface. There is no legacy snapshot editor or whole-Page overwrite recovery, and authority is never inferred from a compatibility description projection.
- Title/body undo tracks only the current surface's local origins. Body UndoManager lifetime follows the registered collaborative editor surface rather than its replaceable ProseMirror EditorView, so React StrictMode and DOM detach/reattach do not disable `Cmd/Ctrl+Z`; remote edits merge visibly but do not enter that surface's undo stack. Extension unregister and editor disposal still detach the UndoManager from Yjs.
- Awareness distinguishes mounted windows/sessions and is advisory rather than a lock. Switching away from a Page Stage clears its presence and closes that surface client; returning mounts a new client session and state-vector-syncs any intervening content before editing resumes
- Close/deactivation persistence is bounded and combines durable provider flush with a disposable local checkpoint. Normal fast ACKs stay visually quiet; delayed pending, offline, error, and reset states show compact retry/reload status
- Page Stage visibility context is global: switching Projects and Views keeps the current Page Stage state until explicitly closed.
- Page Stage durable content and explicitly owned renderer presentation survive Project/session switching; component-local DOM and gesture state do not. No hidden task page remains mounted. Returning opens a fresh per-surface Y.Doc client, completes state-vector synchronization against the same Page Document, and only then exposes title/body editing
- Page Stage priority uses an explicit empty state by default; empty priority renders as a subdued placeholder in selectors and is omitted from dense card badges.
- Page Stage Properties includes schedule editing with an `All-day` mode toggle.
- Page Stage Properties includes a `Run in` selector for new thread execution target: `Local project` (with optional folder override picker), `New worktree` (base-branch selector + environment selector for `.codex/environments/*.toml`), and `Cloud` (mock/unavailable).
- Timed mode uses start/end `datetime-local` inputs with quick actions (`Set schedule`, `Now + 1h`, `Clear`) and automatic end-after-start guardrails.
- All-day mode uses start/end `date` inputs (end shown as inclusive in UI, persisted as end-exclusive storage) with the same guardrails.
- Tag input suggests existing Data Source tags while typing via native autocomplete options, excluding tags already on the current Page.
- BlockNote block editor for description (Notion-flavored Markdown)
- NFM headings use a typography scale in-editor: H1 `1.875em`, H2 `1.5em`, H3 `1.25em`, H4 `1.125em`, all at `600` weight with `1.3` line-height relative to the editor body size
- Page Stage rich editors with four or more H1-H4 headings show an automatic right-gutter heading rail. The rail is renderer-derived from the mounted NFM Document, is available only for the active rich-editor tab on fine-pointer viewports with at least 48px of right gutter, and is absent in raw mode. Its markers anchor at the right and extend left toward the content. It shares the user-message marker rail behavior: current headings follow viewport intersection, rows auto-scroll, click reveal uses smooth scrolling, pointer drag scrub uses instant reveal, and hover shows a heading tooltip opening toward the content. The rail has no toolbar setting, Page property, schema migration, backend endpoint, or history persistence.
- NFM descriptions support simple editable tables from GFM pipe-table syntax and the lossless NFM `<table>` extension. Tables render in Page Stage, a Toggle List row's expanded Page editor, read-only history previews, and raw NFM renderer surfaces; detailed behavior lives in [NFM Editor Table Block Behavior](./nfm-editor-table-block-behavior.md).
- Page Stage toolbar includes a `Show raw` toggle that swaps the description area into a read-only raw NFM view for debugging. The view is materialized from the live Y.Doc and never becomes content authority.
- BlockNote structural animations are mostly disabled in-editor (including indent/unindent depth transitions) to keep editing interactions immediate
- NFM link labels are escape-normalized on parse, so repeated auto-save cycles remain idempotent (prevents exponential backslash growth on escaped markdown markers inside link text)
- NFM autolink behavior is renderer-configurable: typing and paste recognition can be toggled independently, bare-domain recognition defaults on, and paste-time matching is intentionally strict enough to leave repo paths, slash-separated path segments, local file paths, and filename-like text such as `foo/bar/baz.md`, `local/code-block-mock-ui/action-menu-popper.com`, or `nfm-editor-copy-behavior.md` plain by default
- Manual link creation/editing in the NFM editor trims surrounding whitespace only and otherwise preserves the entered target exactly, so absolute local paths, slash-separated relative file paths, `file://` URLs, and protocol-less domains are all stored as authored
- Preserved manual NFM links are classified only at open time: bare domains open as `https://...`, absolute/file URLs open through the local-file path, relative file-like links resolve against the active project primary source, and unresolved file-like links fail closed instead of navigating browser-relative
- Typing a closing backtick autoformats inline code only when the opening delimiter begins at a line, whitespace, or `(` boundary; the closing delimiter ends at the cursor or before whitespace or `)`, and the enclosed text is non-empty with no leading or trailing whitespace. Interior spaces remain valid. The input transaction removes only the delimiters, never a neighboring character, and a later space does not retroactively convert a literal backtick span. `Cmd/Ctrl+E` remains an independent explicit code-mark toggle.
- Detailed autolink rules and examples: [NFM Editor Autolink Behavior](./nfm-editor-autolink-behavior.md)
- Detailed manual-link rules and examples: [NFM Editor Link Behavior](./nfm-editor-link-behavior.md)
- Page writes are validated before persistence (field limits + enum/type checks), and oversized HTTP payloads for create/update are rejected with `413`.
- `Shift+Enter` hard line breaks are persisted within the same block across app restarts
- Enter-created blank paragraph lines are persisted as `<empty-block/>` and preserved across app restarts
- Ordered-list markers round-trip exactly through NFM parse/save/reload and raw read-only NFM rendering, so authored sequences like `3.`, `4.`, or restarted `1.` blocks are preserved instead of being normalized to `1.` per item
- Thread sections are supported via `<thread-section ... />` blocks: they render as divider-like runnable section headers in the Page Stage editor, bind to a sticky per-section Codex thread, and define a prompt as the marker's direct children plus all following sibling blocks in the same parent collection until the next thread section, excluding nested child thread-section ranges; typing `---` on an empty paragraph inserts a new thread-section marker by default, sending opens a plain-text confirmation preview by default, and sending from unsectioned content inserts a new marker before the current block
- NFM supports inline `<agent-config mode="default|plan" model="..." reasoning="minimal|low|medium|high|xhigh" />` chips. They are interpreted only at send time, stripped from model-visible text, and later chips override earlier attributes for that one send. Unknown attributes, invalid values, or invisible app-server models block sending with a validation error. In NFM editors, chips display readable model labels when available, clicking a chip opens a compact editor popover for mode, visible app-server model, and reasoning fields, and the Page Stage editor slash menu includes an `Agent Config` command that inserts a plan-mode config chip.
- NFM supports inline `<mention-thread uuid="..." />` mentions for Codex thread references. They render as minimal Notion-style inline references, resolve local thread metadata when available, open the referenced thread when clicked, serialize to `[Thread: <uuid>]` in copy and thread-section prompts, and never inject the mentioned thread transcript into `promptInput`. The NFM `@` picker uses the same command-palette chat/Page search model for thread mentions and Page references (`pageRef`, serialized as `<page-ref>`), including local chat metadata plus bounded app-server history search and Page metadata/body search. Picker results prioritize the editor's current-Project chats/Pages in a `Current project` group, omit redundant right-side mention syntax hints, and keep hover tooltips to compact context plus optional search snippets. Detailed behavior lives in [NFM Editor Thread Mention Behavior](./nfm-editor-thread-mention-behavior.md).
- Toggle headings (`▶# Heading`) supported: headings with collapsible children, matching Notion's toggle heading behaviour
- Toggle open/closed state is persisted in NFM using `▼` (expanded) / `▶` (collapsed) markers; state survives save/reload cycles via a localStorage bridge that pre-populates BlockNote's `defaultToggledState` on editor init and reads DOM `data-show-children` on save
- `ArrowUp` / `ArrowDown` across a collapsed toggle boundary preserve browser-native visual-line movement and never jump into hidden edge non-inline children while the toggle stays collapsed
- For child `page` and `pageRef` outliner rows, unmodified `ArrowUp` / `ArrowDown` traverse the visible host Block order, authoritative Page title, and disclosed body Blocks as one sequence. Entry waits for visual textblock boundaries, skips hidden collapsed-toggle descendants, and does not change Page disclosure.
- Typing `## ` inside a toggle header converts it to a toggle heading (preserves toggle state)
- `Cmd/Ctrl+Enter` modifies the current actionable NFM Block before any Page Stage send fallback: checklist Blocks toggle checked state, toggle list items and toggle headings expand/collapse, image Blocks open preview, child `page` and `pageRef` occurrences toggle their local outliner disclosure, and bound `threadSection` markers open their linked thread. Page disclosure works from the selected host shell and the live title header; events originating in a disclosed nested body remain scoped to that body editor. An unavailable Page occurrence consumes the Page modify action without changing its saved disclosure preference or falling through to section send. If no modify action is available, Page Stage keeps the thread-section send behavior without moving focus to the Threads stage; unsectioned content still creates a section marker before sending.
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
- When a Page Stage thread-section prompt contains NFM image blocks, supported `http://` and `https://` sources are sent to Codex as image URL inputs, absolute local paths and resolved `nodex://assets/...` sources are sent as local image inputs, and captions remain in the cleaned nearby prompt text. Image attachments stay attachments and do not imply model image input.
- Mouse drag/range selections that span image blocks show a blue-tinted image-block highlight/outline so inclusion is visually explicit
- Image block floating toolbar includes `Copy image` (copies actual image content through the native desktop clipboard, does not fall back to copying the URL, and shows a global in-app success/error toast for the result)
- Pressing `Space` while an image block is focused opens a larger centered modal preview; pressing `Space` again closes it (Esc/click outside also close)
- Double-clicking an image block opens the same large preview modal
- Image preview modal includes zoom controls (`+`, `-`, reset) with a visible zoom percentage
- Pasting images inserts a collaborative pending image Block immediately, uploads the file to shared local assets, and then resolves the same Block to its canonical asset source. Pending Blocks remain valid content but are not exposed as asset references until the source exists.
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
- `@Page` inserts a fully resolved Page mention whose canonical childless editor node is `pageRef` and whose only semantic target is `targetBlockId`. Historical `cardRef` nodes are decode-only. No writable surface may create an unresolved Page mention.
- `Database View Reference` is a childless custom Block that stores `databaseViewId` and renders the durable query's ordered summary rows.
- Child Page and Page-reference rows share one flat outliner geometry. Loading or activating the independent target Document replaces only title/body slots. Database property chips appear only when a Database View explicitly renders a row; a generic Page target never invents membership.
- Page targets resolve from Block/Document content authority even when the Page has no Data Source parent. Idle collapsed rows mount no target provider; expansion reuses one authoritative target surface and renders only the target body at standard Block child indentation.
- Canonical child Page shells use Block type `page` and persist no copied title. Canonical non-owning editor references use `pageRef`; NFM derives owning identity as `<page uuid="..." />` and serializes Page references as `<page-ref url="nodex://pages/..." />`. Historical `<card />`, `<card-ref ... />`, `<mention-card ... />`, and `cardRef` nodes are decode-only. Existing Page UUIDs may pin same-Document shells during exact-head NFM replacement, but create/copy/move remain typed ownership operations.
- Page expansion keeps the projected title row stable while the target boundary or first sync is pending and uses a body skeleton instead of replacing the row with opening text.
- Canonical Page and Database View reference owners remain ordinary stable-ID Blocks for BlockNote selection and drag operations. Result rows are projections and cannot be dragged as host Document children.
- The v84 handoff inventory contains the canonical durable Database View schema. Older accepted Profiles reach that boundary only inside the frozen staging migrator; native Core runs no legacy inline-rule conversion. Project-authorized reads validate and execute filter/sort/include-host semantics over memberships, including negative set membership and creation-time sorts, and use View rank plus Page ID as stable tie-breakers. No active View retains a legacy compatibility config.
- `pageRef` / `databaseViewRef` are childless persistence shapes. Parser, codec, and primary storage validation reject foreign Page bodies; `cardRef`, `cardToggle`, and `toggleListInlineView` exist only as migration inputs and inert diagnostics. A migrated missing Page target remains an import-only, deleted `unresolved_card_reference` shell in its host Project; current writes cannot create or target that shell. Table materialization preserves BlockNote header-cell matrices as `headerRows` / `headerCols` and emits the corresponding `tableHeader` nodes on round-trip.
- Toggle List summary rows do not export or accept body snapshots; only an independently mounted Page editor can move its own stable-ID Blocks through `BlockTransfer`.
- Reference recursion is guarded by inherited Page ancestry (including A → B → A), while a per-mounted-surface provider budget caps independent editors; foreign bodies never enter the host tree.
- Drag-handle `Move to` sends stable root Block IDs plus logical `library | page | data_source` parents. The writer resolves current physical storage coordinates, validates the target View/Data Source, leases affected Documents, and commits content, parent, Source membership/value state, View positions, projections, history, and receipt atomically. No renderer removes the source optimistically or reads a Page NFM snapshot. Losslessly promotable roots preserve their ID as Page identity; Option/Alt Copy allocates fresh identities.
- NFM block side menu opens from the left drag handle or `Cmd/Ctrl+/` at the current block, promotes relevant text selections into visible block selections, and advertises the top-level action scope with labels such as `Text`, `Code`, or `3 blocks`. Production rows expose real block actions only: `Turn into`, `Color`, `Duplicate`, `Move to`, and `Delete`, plus eligible divider/table-specific rows. Block-link copy rows remain development-only reference mocks until NFM has stable persisted block identities. Detailed title, action, layout, submenu, and card deeplink rules: [NFM Block Side Menu Behavior](./nfm-block-side-menu-behavior.md).
- Side-menu handle dragging interprets a live text selection with block-level start-inclusive/end-exclusive bounds. If the selection ends exactly at the start of the next block, that next block is not part of the drag payload; if the selection has entered the next block's content, it is included. If the selection starts at the previous block's content end, the previous block remains included. Cross-parent text selections do not create custom mixed-parent payloads; instead, the editor drags the smallest common-level block range that fully covers the selected candidates. Examples: `blo<start>ck-0 / <end>block-1` dragged from `block-0` moves `{block-0}`, while `blo<start>ck-0 / b<end>lock-1` dragged from either selected handle moves `{block-0, block-1}`; `block-0<start> / blo<end>ck-1` also moves `{block-0, block-1}`; `block-0<start> / <end>block-1` moves only `{block-0}` when dragged from `block-0`. In a nested range `block-0 > block-02<start>, block-03 / <end>block-1`, dragging `block-02` or `block-03` moves `{block-02, block-03}`, while dragging `block-1` moves `{block-1}`; if the end enters `block-1`, dragging `block-02`, `block-03`, or `block-1` moves `{block-0, block-1}` so the dragged payload fully covers the text selection.
- Expanded rich-text selections in Page Stage and a Toggle List row's independently mounted Page editor show a Notion-style floating text action menu instead of the compact formatting toolbar. The production menu uses Nodex tokens while preserving the 192px popup hierarchy, block-type row, text style grid, color controls, and supported Nodex action rows. Supported actions use existing BlockNote/Nodex editor paths for block conversion, bold/italic/underline/strike/code, clear format, and link creation/editing. The color button opens a 190px swatch-grid dialog with up to five app-wide persisted recent color slots plus text/background color grids; swatch clicks keep the dialog open, and clicking the active swatch clears that color back to default. Reference-only controls such as equation, comment/reaction/comment-pencil, skills list, and inline AI footer appear only in development or Storybook as disabled mock controls with `Mock` labelling or mock-specific aria/tooltip labels, while Page Stage editors can expose Nodex-specific `Send to chat` and `Move to` actions in the actions area when callbacks are available. Both action rows open their right-side pickers only after click or keyboard activation, never from pointer hover or row focus. `Send to chat` reuses command-palette chat search, including fuzzy local metadata ranking and bounded app-server history snippets. The current session or current section remains the context-recommended first destination when available, and a bottom `New chat` action plus app-level persisted `Send` / `Send & wrap` modes remain available. Ordinary chat rows show their owning Project as right-side metadata; contextual rows keep `This session` or `Current section`. Selected-block sends recommend the current session: if it already has a chat, that chat is first; if the current session is an empty no-tab chat draft, `New chat` appears first with `This session` metadata and creates the thread in that session. Thread-section sends recommend the section's bound chat first. Sending targets the selected top-level Blocks, preserves supported prompt attachments, and does not switch the stage to the chat; `Send & wrap` includes an info icon tooltip and only mutates the Document after a successful send by replacing the selected roots with a collapsed toggle headed `▶ sent to <mention-thread uuid="..." />`. `Move to` keeps the single destination popover for Database/Page targets. Opening either picker must not steal focus from the editor or hide the selected range; when a picker/search input is focused, the original editor selection remains visibly decorated until the picker is closed and focus leaves the text-action toolbar. File, image, table, and non-rich-text node selections keep the compact legacy toolbar fallback, while collapsed rich-text cursors show no floating toolbar; image/file toolbars anchor directly above the selected Block and omit text-alignment controls because NFM does not persist that state.
- The text-selection menu `More` button closes the text-selection menu and opens the existing block side-menu actions for the currently selected block range. Partial text selections are promoted to block-scoped side-menu actions over every selected block; non-mutating dismissal returns focus to the editor with that promoted block scope still held as the real editor selection while suppressing the formatting toolbar for the dismissed range. A same-editor blank click only dismisses the handed-off side menu and does not click through into ProseMirror to place a cursor or scroll the editor.
- Drag handles, formatting toolbar, block selection
- Page Stage keeps raw-format, content-width, and history controls directly in the top toolbar. Its trailing Page actions menu contains `Copy deeplink` plus a separated, destructive-tinted `Delete` action; closing remains owned by the containing tab.
- View history first persists the mounted Page surface, then opens an app-shell revision-history modal sourced from that authoritative Y.Doc.
- Owned Document history is exposed through Project/Document-scoped list, get, checkpoint, and restore commands over both Electron IPC and loopback HTTP. New `block_tree_snapshot_v2` revisions retain stable-ID BlockTree plus rich Page title; NFM is rederived for display. Canvas retains bounded canonical scene JSON and historical Yjs checkpoint readers remain available. Restore requires the selected revision plus current generation/head, briefly flushes and freezes every mounted surface, pins the current state, appends one engine-specific forward mutation, and pins the resulting state. Retrying the same restore mutation ID returns the original durable result.
- History defaults to a `Current` row plus cursor-paginated semantic revisions grouped by date. Selecting a revision loads its exact title/body in the read-only NFM editor and offers `Restore title & body` when generation-compatible. `Activity` separately exposes property, Database, lifecycle, mutation, and relocation evidence without pretending those events are reversible snapshots.

#### 8. Edit History & Undo/Redo
- Typing undo/redo is owned by the mounted Yjs surface. `Cmd/Ctrl+Z` and redo operate only on transactions created by that surface's local origins; remote edits and another window's changes never enter its undo stack. An EditorView remount preserves that surface's UndoManager and stack, while collaboration-extension unregister or editor destruction releases its observers.
- Durable content history is a retained `document_versions` semantic revision stream. Human editing retains a pre-burst safety state, the latest state every ten active minutes, and the final state after two idle minutes or shutdown. Strict commands create immediate revisions linked to their immutable mutation evidence. Named and restore revisions are pinned; automatic, safety, and operation revisions use seven-day full, thirty-day hourly, ninety-day daily, and 500-row retention.
- Property, lifecycle, Database membership/value/View, and location changes are immutable `block_mutations` / `block_relocations` joined through the Project change log. Their before/after evidence is field- or operation-scoped, not a reconstructed whole Page snapshot.
- The Page history modal is Page-scoped and merges these sources into one stable cursor timeline. Pagination never depends on array offsets or renderer-local clocks.
- Selecting a Document revision loads its exact read-only NFM preview. Reference and embed Blocks remain inert and do not fetch or mutate current target state.
- Restore is available only for a retained compatible Document revision. It validates the current generation/head, briefly fences mounted editors, pins the current state, appends a new forward engine mutation with an exact-retry receipt, and pins the restored state. Page restore never rewinds Yjs causality; Canvas restore assigns newer element versions and explicit tombstones rather than replacing current authority with an old scene snapshot.
- Mutation and relocation entries expose durable evidence but no generic inverse button. A future domain-specific inverse must be a new validated forward command, never Project-wide snapshot undo.
- Fast local undo has no global toast. Durable restore reports pending/success/failure in the history surface and refreshes through the committed Document event.

#### 9. Whole-Store Backups
- Manual backup creation via CLI/API (`nodex.db` + `assets/`)
- Automatic backups every 6 hours with retention of latest 28 auto backups
- Backup briefly freezes managed asset and content writes so the database and referenced files come from one consistent point
- Restore requires explicit confirmation and creates a pre-restore safety backup by default; that safety snapshot and replacement share one uninterrupted write fence
- Restore either installs the complete selected database/assets snapshot or keeps the complete previous store, including after an interruption between file moves
- Restore rejects snapshots with missing referenced managed assets, nested asset directories, symlinks, or unsafe asset filenames
- Successful restore automatically reloads every open collaborative Page against a new store epoch; edits and local recovery data from before restore cannot replay into the restored snapshot.
- Backup artifacts are stored under `~/.nodex/backups/<backup-id>/` with a versioned `manifest.json`
- Store maintenance executes integrity, foreign-key, Document compaction, revision-retention, and deleted-Block retention tasks in one canonical order regardless of caller ordering.
- Native deleted-Block maintenance preserves the newest 10,000 tombstones per Project and removes only an older all-deleted ownership closure with no live content, history, recovery, Database, Session, reminder, relocation, cross-Project, or unknown foreign-key root.
- Physical collection never rewrites immutable mutation/change evidence, permanently reserves every collected Block identity against reuse, and rolls back the complete candidate if any late constraint changes.

#### 10. Canvas View (Excalidraw)
- Canvas tab provides a freeform whiteboard per Project for Page brainstorming and visual mapping.
- Every Project owns one primary Canvas Block and an independent `canvas_scene` Owned Document. SQLite stores normalized current element, durable app-state, and managed-file authority rather than a Y.Doc or renderer-overwritten whole scene.
- Separate windows submit bounded element candidates and field-level app-state intent. Greater Excalidraw version wins, equal versions use the lower version nonce, a canonical hash breaks malformed ties, and deletion is always an explicit tombstone.
- Page shapes are reference objects with a stable `targetBlockId`; they do not copy Page bodies or Data Source membership into Canvas content, and standalone Pages remain openable.
- Shared scene state contains current portable elements, ordering, and a bounded set of durable app-state fields. Selection, viewport, active tool, and focus remain window-local.
- Embedded image bytes are uploaded to managed assets before a scene mutation records immutable URI metadata. Remote surfaces lazily resolve those URIs and reuse unchanged asset reads.
- The renderer coalesces frequent observations, persists each exact pending mutation to an IndexedDB outbox before transport, retries response loss idempotently, and invalidates stale outbox entries after a store-epoch or generation change.
- Scene subscriptions start before synchronization. A missing/out-of-order head, reconnect, or completed write lease repairs through one bounded full canonical scene. Pending upload/outbox/provider work joins bounded close and write-fence flushing; remote scenes reconcile with `CaptureUpdateAction.NEVER` and do not enter local Excalidraw undo.

#### 11. Calendar View
- Calendar tab shows scheduled Pages in a day-grid timeline with Day, Week, custom Multi-Day, and custom Multi-Week ranges. Discovery starts from Pages in the selected Project's Library and then filters every result through the Project's effective recursive Page/Database grants.
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
- Users can drag existing calendar Pages to move them across visible days and times while preserving duration.
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
- Calendar rendering is occurrence-based (`calendar:occurrences`) so recurring Pages expand into time-windowed event instances.
- Calendar event rows display a repeat indicator on occurrences derived from recurring Pages, with a distinct icon for the first occurrence in each series.
- Page Detail exposes repeat settings (frequency, interval, weekly weekdays, inclusive end date), reminder offsets, and schedule timezone.
- Users can complete or skip a specific occurrence from Calendar quick actions and from Page Detail.
- Shipping an occurrence creates a new current-content Page with status `ship` and `archived=true`; archived events remain visible on Calendar with muted styling. Because completion and recurring-series detach/split create sibling Pages, they require the executing Project's bound Data Source `create_child` authority; an explicit grant can update or skip the granted Page but cannot confer structural creation authority.
- Complete, skip, and scoped update are idempotent logical commands. Every caller supplies and retains an `operationId`; retrying the same command after a lost response, or app restart returns the first committed or rejected result without cloning or advancing again. Reusing that ID for a different Page, occurrence, scope, update, or command kind returns a typed collision.
- Missing/unscheduled/unauthorized targets and invalid occurrence updates are durable rejections: an exact retry returns the same error, but no Page, schedule, exception, projection, or change-log entry is written. Complete and clone-capable update commands preallocate a UUID-v7 `createdPageId` as part of their canonical intent; complete/detach/split clone the source's current collaborative title/body and Data Source properties into that identity without creating another storage aggregate.
- Recurrence logs are not exposed in product UI or API.
- Occurrence schedule edits support scope: `this`, `this-and-future` (series split), and `all`.
- For recurring event drag/resize from Calendar, the app prompts with explicit scope choices before persisting. On the first occurrence in the current series, it shows `Only this occurrence` and `All occurrences`; on non-first occurrences, it shows `Only this occurrence` and `This and future`.
- Choosing `Only this occurrence` detaches that occurrence into a standalone non-recurring Page while the original series skips that occurrence.
- Choosing `This and future` trims the original series to end the day before the selected occurrence and creates a new series from the selected occurrence onward; when selected on the first occurrence, it behaves like `All occurrences` (no split).
- For drag-based recurrence schedule moves (`All occurrences` and `This and future`), if the series has an inclusive end date (`untilDate`), that date shifts by the same calendar-day delta as the dragged occurrence so series length is preserved.
- Desktop reminders fire while the app is running, include startup/resume catch-up, and notification click deep-links to the target Page Detail. The scheduler evaluates active Projects, de-duplicates the same Page occurrence across recursive grants, and prefers the Page's bound Project as the notification context when it is active. Snooze state belongs to the requesting Project and targets a Library Page independently; it requires effective Page read access and is discarded when that access or active Project lifecycle no longer holds. Calendar/reminder/snooze reads use the typed schedule index, current Data Source schedule metadata, and the Page's exact current collaborative title/body; stale index or legacy content coordinates fail closed instead of resurfacing compatibility-row data.

#### 12. Codex Threads (Electron-only in this phase)
- New chats are created for Project sessions and linked through `project_session_threads`; Pages can mention threads or send selected content to them, but Pages do not own threads.
- The sidebar discovers active interactive Codex root threads globally through app-server `thread/list`, including chats created outside Nodex by Codex CLI, VS Code extension, or another local app-server client.
- External threads are automatically materialized into local sessions during sidebar sync. Nodex assigns them to the project whose source root is the longest normalized cwd prefix. Threads whose cwd does not match any project become projectless sessions and render under `Chats`.
- Projectless Sessions have `projectId: null` and can open the Thread stage, rename, archive, pin, and fork in the same directory. Selecting one enters the explicit no-Project Workbench state, and shell Back/Forward restores that same null Project coordinate. Its Window Session-local view can open Browser tabs like a normal chat. An attached projectless Thread can start an ephemeral Side chat; when its cwd is present it can also reference a Terminal PTY that starts exactly there. If cwd is absent, Side chat repairs and persists the projectless workspace before forking, while Terminal stays unavailable. A blank projectless Session view exposes Browser only. It can also open an exact-file Files tab without acquiring Project ownership or a workspace tree root, but cannot open a generic Files tree, DB View, Page Stage, or Review tab. Persistent same-directory forks and temporary side-chat forks retain the source output-directory and workspace-browser-root hints; the app-server fork payload cannot silently reclassify those children as ordinary Project workspaces. Session re-home uses only shared Session/Thread domain state and never depends on local tabs; each Window Session keeps its own descriptors and re-resolves them after the move.
- Two windows selecting the same Project or projectless Session never synchronize tab creation, close, selection, order, split geometry, or panel sizing. Shared Session/Thread/Page/Database mutations still converge through Core. Browser guests are scoped by the Window Session's `browserViewScopeId`; a deliberate fork or new-window clone remints Browser identity from an explicit source snapshot. Terminal PTYs use one active Window Session lease and expose takeover instead of accepting concurrent input from two xterm views.
- Closing an app window retains its Window Session as bounded closed history instead of deleting its tabs and layout. The next generic New Window restores the most recently closed window in reverse close order with the same Window Session, tab, split, Browser-scope, revision, and bounds identities; a separate Reopen command is not exposed. Deliberately closed windows do not join ordinary cold-start restoration: `all` restores open records, `last-window` restores one open record and keeps the others as closed history, and `none` keeps prior open records as closed history before creating a fresh window. On macOS, activating Nodex with no open window uses the same New Window acquisition behavior. An ordinary second-instance launch focuses an existing window; explicit `--new-window` uses generic New Window acquisition.
- Global thread pinning is stored in `codex_pinned_threads` and controls attached chat ordering in the sidebar pinned section. `project_sessions.pinned` is retained only as a compatibility mirror and for no-thread local rows.
- Active sidebar lists hide archived Codex threads, archived sessions, deleted threads, ephemeral side chats, side-conversation helper threads, background subagents, and detached internal reviewer/helper threads such as auto-review reviewer runs. Existing local rows that previously materialized these internal threads as sessions are repaired by archiving/detaching the leaked session and archiving the helper thread row.
- Newly created blank project chats render at the top of their normal project subtree below pinned rows such as the starter `Database View` session and above older normal chats. Projectless blank chats render at the top of `Chats`.
- Thread creation requires the first user prompt and immediately starts the first turn. The pending state belongs to the session/thread-start lifecycle, not to the composer button alone, and it remains visible for attached empty thread snapshots until the first visible turn replaces it.
- Pasting at least 5,000 JavaScript characters of plain text into the Thread composer creates a removable `Pasted text.txt` attachment instead of inserting the text into the prompt editor. The attachment appears immediately as pending, becomes ready after Nodex stores its exact content in the owned attachment area, and exposes retry or removal if materialization fails. `Show in text field` restores the exact text on demand; sending, queueing, goals, and worktree starts wait for pending materialization and use the owned file rather than a renderer draft copy.
- Exact large content remains available through `View full`, `Raw`, copy, or source views, while inline presentation is deliberately bounded. Workspace Markdown above 256 KiB or 5,000 lines opens as exact source with `Rich preview is unavailable for large Markdown files`; large assistant/tool Markdown follows the same rich-preview budget. Plain workspace files, raw tool/page output, process output, environment-script summaries, and legacy very large user messages use the shared selectable, syntax-aware, viewport-rendered Pierre source reader instead of mounting the complete document as text nodes.
- Live assistant, plan, and reasoning prose shares one manager-global frame queue. Visible conversations append up to 24 UTF-16 code units per raw target per animation frame; hidden or no-frame runtimes wait 16 ms and flush the complete buffer. `item/completed` and `turn/completed` globally drain this queue before final lifecycle state, including queued empty deltas. Delta application resolves nullable turns at flush time, matches the last same-ID exact raw protocol type, validates reasoning indexes, never synthesizes a missing item, and never refreshes item/turn status or timing; the completed item remains authoritative.
- Reopened and paginated app-server history is hydrated and merged into the same canonical turn state used by live activity before any thread-body projection. Generated item slot identity/order and hydrated start/completion timestamps survive that adapter; older pages are not independently normalized or prepended to a second transcript model.
- Canonical turn-item display is an exhaustive zero/one/many projection over the raw ordered turn. Nonblank hook prompts render as user-facing hook feedback, generated images remain visible, and consecutive image-view items fold only until the next raw non-image item—even when that intervening item is itself hidden. Sleep and review-mode markers stay hidden. Assistant, proposed-plan, reasoning, MCP, and web-search completion follows the owning turn's final non-user work position and terminal status instead of a per-notification fallback flag; checklist-looking protocol plans remain proposed plans rather than becoming todo lists.
- Generated-image output resolves its thumbnail descriptor separately from its full descriptor. The full resolver independently supplies preview, download, and data-URL values; drag prefers data URL, then download, full preview, and thumbnail. Absolute local paths display directly and load binary data only while a download-capable preview is open. ChatGPT file pointers resolve through authenticated main-process networking with a five-minute renderer cache and transient retry policy. A failed thumbnail refetches at most twice for its current resolved URL, and the preview dialog exposes the resolved download asset.
- App-local turn activity uses the same whole-turn projection as server turns. Optimistic first messages, goal submissions, fork/worktree provenance, remote-task markers, manual-compaction placeholders, model transitions, and local failures may appear before a protocol turn id exists; each remains a distinct ordered turn, renders params input before its typed items, and binds in place when the matching server turn starts. Local turns do not receive server request overlays. Empty metadata preview turns and startup-tool-prewarm turns remain hidden.
- Before app-server hydration is available, local rollout JSONL may provisionally recover session/turn metadata, user and assistant prose, reasoning summaries, compaction, token usage, and explicit errors. It never guesses a v2 tool family from Responses function names or fabricates a generic tool from function output; canonical app-server history is the only restart authority for tool activity.
- A generated command remains one raw lifecycle/output owner but may render one exec activity per command action. Multi-action row IDs use `<raw item id>:<action index>` and retain the raw owner ID for approvals and updates; empty actions render one unknown-command fallback. Split rows share process, cwd, timing, status, duration, and output while keeping their action-local command and parsed action type.
- File-change projection keeps ordinary files in a path-keyed patch map and tracks Codex visualization HTML as separate create/update activities; visualization files are not rendered as ordinary patch files. In-progress and completed visualization activity is retained, while failed/declined activity is omitted. A non-failed patch also contributes to the turn-level diff batch using the latest preceding exec cwd. The patch activity and turn-diff row coexist; explicit turn diffs win after visualization-only diff blocks are removed.
- File-change activity renders visualization status before insertion-ordered file rows. Patch lifecycle comes from its nullable success plus approval/cancellation state. Detailed mode gives each path an independently expandable diff with line stats, review details, copy action, and semantic add/update/delete fallback; prose detail mode keeps the same status/path rows static without diff disclosure. File links prefer the granted root, open in the side panel normally, and use the configured external opener for modified clicks.
- Special tool projection preserves family-specific protocol state instead of wrapping everything as a generic tool call. MCP retains app/resource/source/result/error metadata and becomes complete when its item or turn is terminal. Its visible source identity is resolved late from stable projected source/invocation metadata: browser/computer/native tool surfaces take precedence, then a trimmed server name supplies the fallback. The projection can consume normalized app metadata once Nodex supports ChatGPT Apps/Connectors, but that capability is currently disabled and production must not send `app/list`; existing and imported tool calls therefore degrade to source/server fallback identity. Chrome browser-use uses its bundled Chrome asset, while native Chrome remains a host-native app reference. Grouped facts, standalone icons, and summary sources consume that same identity; incidental raw item/app/logo fields never override it. Successful item-level app URIs still participate in the rendered resource scope. Ordinary dynamic calls omit result/success except for create-thread and handoff-thread; dependency loading is hidden, and successful automation updates route to the scheduled-task model while failed/invalid updates stay hidden. Registered Codex-app task controls, settings reads/writes, and Chrome tab-context calls select their renderer by the exact `(namespace, tool)` pair. Their labels use task terminology, task reads/messages can navigate to their target, successful task creation becomes an openable resource card, and only registered activity flags may affect grouping or continuation. Collaboration `wait` is hidden, other collaboration activity respects the background-subagent gate, and web search retains its generated action and stays active only when it is the final non-user work item of an in-progress turn.
- Multi-agent actions are standalone transcript activity. Their rich header starts collapsed even while an action is running, uses the action lifecycle and unique target count for its summary, shimmers only while work is in progress, and remains user-expandable. Expanded rows preserve per-agent lifecycle copy, prompt truncation/tooltips, model tooltips, friendly names, roles, and background-agent navigation context. Consecutive subagent activity is summarized as at most three inline identicon chips followed by any hidden-agent count and a shared `started working`, `updated`, `interrupted`, or `finished` status; selecting a chip opens that child with inline-activity context.
- Modern inline child agents use one root-scoped `Subagents` right-panel tab rather than one tab per child. Composer and floating-summary surfaces show one compact avatar/count action; the panel root groups active and completed descendants with lazy assistant-message previews, and selecting a row routes inside the same tab to the child's read-only transcript with a back header and no composer. Relationship discovery uses app-server source ancestry so nested descendants remain visible even when the root transcript has not been hydrated. Legacy non-inline collaboration agents remain individually listed and keep dedicated read-only child tabs.
- Renderable web searches remain individual leaves inside mixed activity groups. Each row shows its normalized action/query detail and uses the deterministic semantic web-search globe rather than depending on remote favicon discovery. Searches with a blank top-level query are hidden before grouping, even if secondary action metadata contains displayable text.
- Automatic approval review state comes from the canonical review payload. Approved and malformed reviews are hidden, in-progress reviews are groupable, and aborted, denied, or timed-out reviews are standalone. A review attaches to an exec, patch, or MCP body only through the target's canonical command-execution/call identity; attached approved reviews are removed before rendering. Visible review activity uses the reviewed action as its disclosure summary, the dedicated automatic-review glyph, and a nested title-first rationale row; attached rows remain inside the owning tool body.
- Thread activity uses one v2 visibility and grouping projection in production. Contiguous groupable command, patch, web, ordinary MCP, dynamic, and eligible review activity forms maximal mixed groups, including one-item groups; app/computer-use MCP, handoff, collaboration, assistant, and other classified standalone items split those runs. Expanded group leaves retain the same family/source-aware leading glyph and conversation-body row tone as their standalone renderer; grouping owns aggregation, compact spacing, and bounded scrolling rather than a muted iconless presentation. Visualization/special-read filtering happens before classification, MCP app barriers update from live server metadata, and render identity remains stable while streaming.
- New threads auto-generate a concise title from the first user prompt in the main process after `thread/start` succeeds unless an explicit thread name or `skipAutoTitleGeneration` is provided.
- Auto-title generation uses a Codex-compatible structured helper: `gpt-5.4-mini`, low reasoning, read-only ephemeral system thread, 30-second turn timeout, web search/hooks disabled, and a `{ title: string }` JSON schema capped at 36 characters. Helper thread notifications are internal-only and never materialize as sidebar rows, thread stream state, or desktop notifications. Schema-invalid model output returns no title before cleanup; valid generated titles are normalized, applied optimistically, and persisted through `thread/name/set`. Manual rename still trims/folds whitespace and truncates to 60 characters. Auto-title generation and persistence failures are log-only and do not surface as user-visible host errors.
- Auto-title, manual rename, and app-server `thread/name/updated` notifications update `codex_threads.thread_name` and notify linked project sessions to refetch their derived `displayTitle`. `project_sessions.no_thread_fallback_title` is only used before a thread is attached or as the final display fallback.
- Empty Project sessions show the new-chat composer for the first prompt; Page Stage does not create Page-owned thread tabs.
- `Work locally` uses the selected project's primary source when available, otherwise a generated per-thread local workspace.
- `New worktree` run target creates a managed Git worktree under `${nodexHome}/worktrees/<rand4>/<project-id>` and links thread cwd to that worktree.
- The new-chat `Start in` selector shows `Work locally` and `New worktree`; the environment selector is populated from `<workspace>/.codex/environments/*.toml`, with a `No environment` option and an `Environment settings` action that deep-links into the shared `Local environments` settings section for that project/config context.
- If `runInEnvironmentPath` is selected and points to a valid `.toml` file, Nodex reads the structured local-environment definition from Settings -> Local environments and runs its default `[setup].script` in the newly created managed worktree before `thread/start`.
- Environment setup failure aborts thread creation and best-effort removes the just-created managed worktree.
- The floating summary panel shows the `Environment` review/change section only for non-projectless git-backed attached threads with a resolvable cwd. Projectless threads keep deliverable artifacts in `Outputs` even when their cwd is a git repository, and non-git/projectless threads do not show disabled Environment placeholder rows.
- The floating summary panel `Commit or push` row opens a native Git dialog. The row surfaces commit/push blocker titles while disabled. In a detached HEAD checkout with a valid Git HEAD, the Environment branch row becomes `Create branch`; activating it opens a `Work here` branch setup dialog that creates and checks out a branch through the Git branch IPC. Managed worktree threads on their repository default branch keep the normal branch selector row and add a separate `Create branch` action above `Commit or push`. Activating `Commit or push` while detached, or while a managed-worktree default-branch checkout only has branch commits to push, runs the same branch setup first, then continues into the commit dialog after branch creation succeeds. Activating `Create pull request` from a managed-worktree default-branch checkout also runs branch setup first, then opens the native Create PR dialog after branch creation succeeds. The commit dialog reads repository status from the main process, supports committing staged changes or including unstaged changes, generates a blank commit message through the Codex app-server from the staged diff, can commit-and-push in one action, can push branch commits without local file changes, renders command-menu-style action rows for `Commit`, `Commit and push`, and `Push`, closes when an action starts, shows active workflow phase/cancel state on the summary row, and refreshes the summary Git state after a successful operation. Cancel applies from action acceptance through repository preflight, message generation, and the active Git process; it does not wait for a mutation subprocess to start. Empty generated commit-message output aborts the commit instead of falling back to a guessed subject. The Create PR dialog reads Git and GitHub CLI state, opens existing PRs in the browser instead of creating duplicates, can commit and push local changes before creating a PR, generates missing PR title/body through the Codex app-server from branch diff context, supports draft PRs and create-then-open-in-browser, shows active `Generating messages…`, `Committing…`, `Pushing changes…`, and `Creating PR…` phases on the summary row, and refreshes summary Git/PR state after success.
- During `New worktree` creation, the pending task body shows the original prompt plus ordered Worktree, optional Setup, and optional conversation-start activities. Recovery actions belong only to the final activity, which starts expanded; when a later phase appears, the previous activity remounts collapsed and the new action target opens. Completed worktree-initialization rows in the realized transcript have no recovery footer and all start collapsed. Worktree/setup logs share the command shell's safe ANSI renderer, whitespace-preserving 140px terminal viewport, raw-output copy action, and terminal theme colors. `Work locally` uses the same session progress channel but renders as a compact sending/failure state without Worktree/Setup steps.
- Live worktree and setup progress keeps the newest 32,000 characters. Once earlier output has been discarded, the panel continues to show an explicit truncation marker until that progress record is cleared; terminal carriage-return and backspace behavior remains intact inside the retained tail.
- A local-environment TOML file larger than 256 KiB is rejected from Settings before its body is read or parsed and is shown as `Local environment file is too large to load`. Individual names, scripts, actions, and commands are also validated at the main-process boundary so the settings editor never becomes a general large-file editor.
- If a pending worktree realizes its thread but heartbeat automation creation fails, the Workbench shows `Started task, but could not create the heartbeat` as a danger notification even if the pending route is no longer active. The warning is non-fatal: the realized thread, client-thread mapping, and successful pending handoff remain intact.
- Pending worktree state owns only transient creation and conversation-start status. Once a thread is created, the formal client-thread mapping is written before metadata handoff; successful dismissal removes the pending entry and its start tracker instead of retaining a second in-memory success mapping.
- Outside Electron, pending-worktree actions use a renderer-local fallback facade for deterministic UI and Storybook coverage: it allocates the same pending/client identities, publishes queued rows, and supports local metadata, retry, continue, cancel, and dismiss transitions. It does not fabricate worktree execution or thread realization; Work locally and Auto-fix report that browser Codex launch is unavailable.
- Settings -> `Worktrees` shows managed inventory deduplicated by resolved worktree path (reused paths appear once).
- Settings -> `Worktrees` delete removes the managed directory (prefer `git worktree remove --force` when metadata is available, otherwise recursive delete) and unlinks all thread links that target the same managed path.
- Worktree base branch resolution order is: remote HEAD symbolic ref, then `main`, then `master`, then current branch, then first available local branch.
- Global worktree creation mode is configurable in Settings -> `Worktrees`: `Auto branch` (creates `<prefix><thread-slug>`, where the live prefix comes from Settings -> `Git`, defaults to `codex/`, and the thread slug is derived from the thread title by lowercasing, keeping the first 5 words, stripping non-`[a-z0-9]`, then joining with `-`) or `Detached HEAD` (default). Git settings are persisted in the main-process user config and read again when project-aware developer instructions or an auto-branch worktree are created; branch, commit, and pull-request guidance therefore affects subsequent operations without restarting the app.
- `Cloud` run target is explicitly blocked in both renderer preflight and backend thread-start validation in this release.
- Sending from a Page editor to `New chat` creates the thread in the current session when the picker row is labeled `This session`; the bottom `This project` action reuses the current Project's blank session or creates one. Both paths keep focus in the current Page surface.
- Running threads keep syncing in the background when users switch to another thread tab; returning to the running tab preserves live state (including stop affordance and existing tool-call logs).
- Renderer ownership is invalidated when its client disconnects or an inactive owner is unsubscribed. The old client cannot publish or acknowledge late state, followers discard its revision, and the next renderer must reacquire the thread through canonical paged app-server resume rather than a stale cached projection. Inactive-owner cleanup announces owner unavailability before publishing a main-owned fallback snapshot so followers can accept it while remaining marked for resume.
- Thread tabs show a running indicator for actively executing threads.
- Sidebar thread entries derive execution state from the canonical thread status. While a thread is active, its elapsed metadata gives way to the subdued running spinner; hover and keyboard action rails take precedence over the spinner. The Threads group icon also switches to a running indicator while execution is active.
- Archiving a sidebar chat archives the app-server thread and the linked session when session-backed, or archives only the app-server thread when the sidebar row is snapshot-only; both paths optimistically suppress the row from active sidebar lists. Archiving clears global pin/unread state. App-server archive notifications received from another client perform the same local hiding. Unarchive notifications restore thread metadata only; re-showing the session is an explicit unarchive action.
- In-app account UX supports account read, ChatGPT/API-key login, login cancel, logout, and one account slot in the left sidebar footer. Signed-out accounts get the `Sign in` popover in that slot; authenticated accounts get a compact double ring, where the outer ring shows the shorter window such as `5h` remaining and the inner ring shows the weekly window remaining. Hovering or focusing the ring opens the account detail tooltip with email/plan, detailed remaining windows, reset timing when available, and sign-out; opening that tooltip refreshes account data. When the Codex service provides earned quota-reset credits, the `Rate limits remaining` list also shows a default-collapsed `1 available reset` / `N available resets` row alongside the limit windows. The row matches their compact, background-free resting style, highlights on hover, and places its disclosure chevron on the right; expanding it shows the selected available credit's expiry when its detail is available and an idempotent reset action. Successful and previously completed reset attempts refresh the account snapshot from app-server authority instead of decrementing quota locally. If authenticated rate-limit windows are unavailable, the footer shows a subdued connected indicator instead of percentages. Quota data also refreshes in the background every 60 seconds while the Codex connection is live and authenticated. The thread header contains only thread-level title and actions, not account authentication controls.
- Thread permissions are resolved from Codex app-server config (`config/read`) plus config requirements (`configRequirements/read`), not from renderer-local per-project preferences.
- Settings -> `Hooks` lists lifecycle hooks discovered by the Codex app-server for every non-empty project source root. It groups User/Admin config, plugins by protocol `pluginId`, projects by cwd, and session/unknown sources; warning-only and error-only roots remain visible. Source, project, plugin, and host selection are deep-linkable. Managed hooks are always enabled, new or modified hooks must be trusted before they can run, and trusted hooks can be enabled or disabled. Trust and enable writes update `hooks.state` through app-server config, update matching host views optimistically with rollback, then refresh every open window after a successful write.
- Thread stage and Settings -> `Agent` expose the same preset-backed permission selector with the exact visible modes `Ask for approval`, `Approve for me`, `Full access`, and `Custom (config.toml)`. Its menu title is `How should Agent actions be approved?`; option descriptions stay concise enough to preserve the intrinsic compact menu width, and `Full access` uses the warning treatment across its icon, label, description, and selected marker.
- Permission preset semantics:
  - `Ask for approval` resolves to `sandbox_mode=workspace-write`, `approval_policy=on-request`, `approvals_reviewer=user`.
  - `Approve for me` resolves to the same sandbox/policy pair, but with `approvals_reviewer=auto_review`.
  - `Full access` resolves to `sandbox_mode=danger-full-access`, `approval_policy=never`, `approvals_reviewer=user`; for each exact Turn launched with this built-in preset it also allows every existing `nodex_app@5` read/write capability across the current Nodex Library without approval prompts.
  - `Custom (config.toml)` remains available whenever config contains explicit permission keys and the resulting raw permission state is allowed, even if those values are equivalent to a fixed preset.
- `features.guardian_approval` disables `Auto-review` only when it is explicitly false; missing feature metadata does not disable the preset. `configRequirements/read.allowedPermissionProfiles`, `allowedApprovalsReviewers`, `allowedApprovalPolicies`, and `allowedSandboxModes` still constrain availability. `auto_review` and the legacy/internal alias `guardian_subagent` are treated as the same automatic-review reviewer when reading config or requirements, but Nodex writes the public `auto_review` literal.
- Permission writes target the current config key origin when available; otherwise Nodex writes to the user config file instead of silently creating a project override from the thread footer.
- Settings -> `Agent` uses a split surface:
  - `Permissions modes` contains `Default permissions mode`.
  - `Custom config.toml settings` contains raw controls for `Approval policy`, `Sandbox settings`, `Allow network access`, and `config.toml`.
- New thread start, later turn start, queued follow-ups, and thread resume all inherit the same resolved `approvalPolicy`, `sandbox`, and `approvalsReviewer` values from the main-owned permission resolver.
- Nodex content authority is frozen separately for each exact Turn. Switching the selector while a Turn is running does not change its queued or pending Nodex calls; the next Turn uses the new mode. Custom configuration remains Project-scoped even when its raw sandbox and approval values are equivalent to Full access. A background app-server child may inherit its parent Turn once; an independent `codex_app create_thread` task does not.
- While `Ask for approval` is active and Auto-review is available, three successful manual approval or permission responses in the same thread arm a standalone `Want fewer approval prompts?` offer. The offer replaces the normal composer only while that thread is idle, takes priority over active and background request cards, and is cleared when the permission mode changes. `Approve for me` switches to the Auto-review permission preset; `Keep manual approvals` permanently dismisses the offer across threads and clears every accumulated thread count.
- Approval requests stay in the underlying transcript flow instead of opening a separate approval screen:
  - command approvals project a pending exec request row whose call ID targets the raw command owner; generated command items and timestamps remain unchanged
  - file approvals attach to the last matching file-change row
  - automatic approval review rows use the synthetic item id form `automatic-approval-review:{reviewId}`
- Pending user-input requests project a standalone question row and are replaced by the completed response row after submission. Permission requests reuse their request-ID-matched synthetic row. Reopened history and main-owned live ingress use the same request projector, preserve numeric request IDs, and never invent an item for a missing target turn.
- Thread stage composer exposes provider, model, effort, and model-advertised speed selection through one compact model footer control. The trigger shows the current model plus effort; its 224px root menu uses right-aligned current-value summary rows, and each configurable field opens one dedicated flyout. Provider is a root field instead of a branch inside Model, Model lists only the selected provider's models, and Speed appears only when the selected model advertises multiple service tiers. New-thread drafts use the runtime provider catalog filtered to OpenAI, Anthropic, Kimi For Coding, Moonshot, and OpenRouter, persist the compound provider/model selection locally, preserve runtime-provided case-sensitive reasoning values and display labels, and automatically use the model's recommended harness. Ready credential states stay visually quiet; a provider that needs a key opens the shared modal credential flow, sends the key only to main, and becomes selected only after setup succeeds. Existing profile-backed threads show their durable execution profile and lock all execution-profile fields; changing them requires a new task. The legacy OpenAI `model/list` and next-turn model path remain as a compatibility fallback when the provider catalog is unavailable.
- Fast-mode core enablement is global, not per-thread. Detailed persistence, UI, request-resolution, queue-freezing, and reporting rules are defined in [Codex Fast Mode Core Enablement](./codex-fast-mode-core-enablement.md).
- New thread-start and turn-start requests inherit the persisted global `serviceTier` when callers do not provide one explicitly; explicit `null`/missing values normalize back to `standard` reporting and omit `serviceTier` from outgoing app-server payloads.
- Thread stage composer exposes collaboration mode presets (`Default`, `Plan`) sourced from app-server `collaborationMode/list` with a client fallback to `Default` + `Plan` when unavailable. Existing thread composers reflect `conversation.latestThreadSettings.collaborationMode` live, with `conversation.latestCollaborationMode` retained only as a derived compatibility value; new-thread drafts reflect the selected draft mode until the thread is created.
- Existing-thread collaboration mode selection is thread-owned next-turn state. Plan mode can be toggled from `Shift+Tab`, the add-context menu Plan row, the active Plan chip, `/plan-mode`, or the `plan` keyword suggestion above the prompt editor, and all entry points call the same toggle action.
- Thread and turn start requests resolve model, reasoning effort, and collaboration mode in this order: explicit prompt/submit override, latest thread settings, derived latest collaboration mode, then selector-resolved new-thread defaults. Empty or unavailable model selections are omitted from app-server payloads so Codex config remains the fallback authority; Nodex must not hardcode a concrete fallback model id. `Plan` mode sends built-in collaboration mode instructions by passing `developer_instructions: null` and enables clarifying-question flows through `item/tool/requestUserInput`.
- A profile-backed task durably stores `providerId + modelId + harnessId + reasoningEffort + serviceTier` in Rust Core. Main carries that exact tuple through session starts, cold resume, persistent and side-chat forks, dynamic child creation, heartbeat turns, and cron runs instead of mutating Open Interpreter's process-global provider/model/harness settings. Provider and harness are immutable for the task; child/fork paths inherit the source profile unless they create an explicitly independent task. The embedded Agent's writable home is `${NODEX_HOME}/agent`, and ordinary runtime recovery never reads another agent home.
- Settings -> `Import` is the only external-agent migration boundary. The user chooses Claude Code, Codex, or Open Interpreter, explicitly scans a default or selected home, reviews supported categories, and applies a subset. Scans expire and raw app-server migration payloads stay in main. Claude sessions/configuration use the runtime importer; Codex-compatible sessions use `thread/fork(path)` so ThreadStore creates independent target Threads. Instructions, skills, hooks, and subagents never replace existing targets; native config import is limited to absent passive preferences and sanitized missing MCP definitions. Provider credentials, OAuth/subscription state, provider/model selection, approval/sandbox policy, SQLite databases, and journal files are never imported. Imported conversations are initially projectless and have no durable execution profile; choosing a current provider/model when continuing establishes new execution semantics without rewriting the imported history.
- Thread stage composer places the add-context menu and permission selector on the left side of the composer footer, while context usage, compact model/effort/speed, dictation, and send/stop controls sit on the right. When Plan mode is active, its direct toggle appears as a footer accessory after the permission selector with a subtle vertical divider before it. The add-context menu uses a compact `+` trigger and contains `Add photos & files` (`Add photos` when images-only), optional `Include IDE context`, `Plan mode`, and optional `Plugins`; Speed is exposed only through the model selector.
- Thread stage composer input is a ProseMirror-backed contenteditable prompt editor. Blank new-chat drafts show the `Do anything` placeholder, existing threads show `Ask for follow-up changes`, and active Plan mode shows `Describe your task to generate a plan...`; dictation/attachment/send behavior uses the same normalized prompt flow as before. Logical newlines use paragraph boundaries, so Backspace/Delete merge adjacent lines and remove empty lines through the editor transaction model while an empty composer retains one editable line.
- Composer prompt text hydrates before the editor mounts and persists by Composer identity, plus an attached thread alias, so it restores after task switches, renderer restarts, and updates from another open window. Completed files, images, pasted text, skill context, review comments, and goal mode restore while their Composer scope remains retained. Successful send, start, queue, steer, side-chat creation, and goal actions clear the submitted text and completed context only after the awaited action succeeds; confirmation-only, preparation, permission, materialization, transport, and server failures preserve the draft. Explicit composer intents are consumed once: non-empty text replaces, ordinary empty text leaves the current prompt intact, `clearText` deliberately clears it, and attachment context declares append or replace semantics.
- Attached thread transcripts create their virtual layout immediately at every history size rather than delaying the entire body. On unmount they capture native bottom distance, latest-turn progress/phase/follow geometry, rendered anchor/window, and measured turn heights as one renderer-memory snapshot keyed by thread; remount restores the same snapshot before paint and treats 24px or less as bottom. Response-spacer height is removed from the saved distance. Agent-activity collapse choices are thread-and-turn keyed user overrides over the semantic default, including the MCP App latest-turn exception, and transcript/collapse state is removed only when the canonical thread is deleted.
- Thread stage composer supports thread prompt recall from an empty draft. With the cursor at the end and no modifier keys, `ArrowUp` first edits the latest visible queued follow-up when the composer has no prompt or attachments and no busy/slash-menu state; otherwise it restores the newest persisted prompt-history entry. Additional `ArrowUp`/`ArrowDown` presses wrap through the scoped history, `ArrowDown` from the newest recalled entry clears the composer, manual edits exit traversal, and successful prompt submissions append non-blank text to the current scope's latest 20 entries. This prompt history is local UI persisted state, separate from thread/conversation history and app-server APIs.
- Typing a slash token at the start of the prompt or after whitespace opens the thread slash-command menu above the composer. The menu uses grouped fuzzy filtering, preserves a keyboard-highlighted row, supports ArrowUp/ArrowDown/Enter/Escape, mouse hover/click selection, `No commands` empty state, nested content panels for commands such as Model, Reasoning, Fork, MCP, Memories, Feedback, Project, and Personality, and direct mode commands such as Goal. Goal remains available in existing threads that support thread-goal actions and in pre-start new-chat surfaces that can start a session thread; selecting it enters goal mode, and new-chat submit carries the objective as a thread-goal draft for post-create goal setup. Direct commands clear the slash token before running; inline skill commands replace the slash token with the structured skill mention path. Context-conflicting command rows such as projectless Chat and hotkey-window commands remain hidden until their Nodex runtime path exists.
- New-worktree goal drafts freeze pasted-text and image references before setup begins. Raw pasted sources survive setup failure, Retry, and Continue so a failed launch remains recoverable; they are removed best-effort after success, Cancel, Dismiss, or Work locally. Goal files copied into a realized thread remain available to that thread. Work locally starts from the original frozen prompt and attachments without promoting the pending draft into goal metadata.
- Thread stage composer shell uses static chrome: rounded input background, subtle ring, backdrop blur, and a fixed shallow shadow with no added focus-within elevation when the editor is active.
- Add-context picker non-image files become prompt mentions, picked images are read as data URLs and sent as image inputs, and picker attachments remain separate from paste/drop/Add-to-chat file provenance. Running-turn steer sends the same normalized prompt input shape as normal turns; unaccepted steers are restored as queued follow-ups if the active turn ends too early.
- Thread stage request ownership has three states: normal composer, Auto-review offer, or request stack. The Auto-review offer is exclusive while idle. Otherwise a background child approval or permission is rendered before the active thread request, and both may coexist; private child input, picker, setup, MCP, or plan requests never own the parent composer. Any replacement removes the normal editor, attachments, add-context, permission, context, model selector, dictation, and send/stop footer controls while preserving queue, background-agent, terminal, goal, and other above-composer lanes.
- Thread stage composer lower status row is a pre-start new-chat-only backplate mounted before and behind the raised home composer surface through the composer-owned external footer slot. It shows the selected project when available, the local run target (`Work locally`) or `Start in` selector, optional environment selection for `New worktree`, and the real Git branch for the selected primary source. It remains orthogonal to composer ownership, so a new-thread replacement would keep the strip; once a conversation exists, existing-thread composers do not mount it.
- Thread stage composer shows the context-window meter tooltip from the composer footer: unavailable data falls back to `0% used (100% left)`, ready data rounds token counts to whole thousands, usage below `50%` reads `{usage}% used ({remaining}% left)`, usage at or above `50%` reads `{usage}% full`, and the `Codex automatically compacts its context` line appears only for ChatGPT-authenticated sessions without an explicit `modelProvider`.
- Thread stage composer includes dictation as a separate buffered speech-to-text feature in Electron: the mic button is shown in supported ChatGPT-authenticated sessions, tooltip copy is `Click to dictate or hold`, `Ctrl+M` starts on keydown and stops on keyup with `insert`, button click starts recording, recordings shorter than `250ms` are discarded locally, and stop actions stay split between `Stop dictation` (`insert`) and `Transcribe and send` (`send`) before one bounded, sender-validated IPC command returns transcript text.
- Threads composer uses one round icon button: it sends when idle, shows a spinner immediately while the prompt send is pending, and switches to a stop icon while Codex is running so users can interrupt immediately.
- The `/personality` composer command is available when host personality support is connected. It offers `Friendly` (`Warm, collaborative, and helpful`) and `Pragmatic` (`Concise, task-focused, and direct`), marks the active value, and updates both the host default and the current thread's next-turn settings. The host default is `friendly`, accepts the protocol `none` state without exposing it as a third selector row, reaches ordinary and dynamic `thread/start`, and is replaced by hydrated thread personality for an existing conversation. Internal title-generation and heartbeat utility threads keep an explicit null personality.
- Threads composer send behavior defaults to `Enter` (with `Shift+Enter` for newline). Settings -> Editor exposes `Cmd/Ctrl+Enter to send long prompts`; when enabled, single-line drafts still submit on `Enter`, multiline drafts switch primary submit to `Cmd/Ctrl+Enter`, and running-thread alternate queue/steer submit moves to `Cmd/Ctrl+Shift+Enter`. Running-thread primary and alternate submits carry explicit `Queue` or `Steer` actions so alternate queue submissions cannot fall through to normal steer.
- Visible transcript semantics are defined in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md), including params-owned pending prompt rows, steering user-message acceptance and divider rows, request-user-input cards, plan follow-up flow, local file links in transcript markdown, reasoning/tool rendering, exploration coalescing, queue cleanup, and restart recovery consistency.

### Statuses

| Order | ID | Name | Purpose |
|---|-----|------|---------|
| 1 | triage | Triage | Incoming ideas or requests awaiting clarification and prioritization |
| 2 | plan | Plan | Accepted work being scoped and prepared |
| 3 | build | Build | Work actively being implemented |
| 4 | review | Review | Work awaiting review or verification |
| 5 | ship | Ship | Completed work ready for delivery or already delivered |

`archived` is an orthogonal internal flag. Archived Pages are not rendered in the Kanban board, sidebar status groups, or toggle-list defaults.

---

## Technical Architecture

### Tech Stack
- **Desktop**: Electron with electron-vite (v5) + Vite 7
- **UI**: React 19, shadcn/ui, Tailwind CSS
- **Block Editor**: BlockNote (@blocknote/core, @blocknote/react, @blocknote/shadcn)
- **Description Format**: [Nested Markdown](../references/nested-markdown-spec.md) with custom parser/serializer
- **Desktop Renderer Transport**: typed Electron IPC through a context-isolated preload bridge
- **Drag & Drop**: @atlaskit/pragmatic-drag-and-drop, @atlaskit/pragmatic-drag-and-drop-auto-scroll
- **Data Authority**: detached Rust Core with rusqlite and Yrs over an authenticated Profile-private Unix socket
- **Real-Time**: Electron IPC over the authenticated private Core event stream
- **Codex Runtime**: main-process `codex app-server --listen stdio://` JSON-RPC bridge
- **Transport**: Electron IPC for desktop workflows; native CLI over authenticated Profile-private UDS
- **Package Manager**: pnpm (pinned through `packageManager`)
- **Development Runtime**: Node 24.15.0
- **Tests**: Vitest projects for Node, Electron-main, renderer, browser-sensitive components, and integration behavior; Playwright for Electron E2E
- **Local Assets**: canonical `nodex://assets/<safe-name>` files under `${NODEX_HOME}/assets`; raster display uses the default-session-only `nodex-asset://managed/<safe-name>` protocol, while writes/bytes/previews use typed IPC
- **Backups**: Whole-store snapshots are stored under `~/.nodex/backups/<backup-id>/`

### Directory Structure
```
nodex/
├── bin/
│   └── nodex.mjs              # Compatibility launcher for the native nodex CLI
├── crates/
│   ├── nodex-cli/              # Native agent-facing CLI
│   ├── nodex-core/             # SQLite/Yrs authority and six deep Modules
│   ├── nodex-core-contracts/   # Versioned semantic Module contracts
│   ├── nodex-core-protocol/    # Generated transport envelopes/OpenAPI source
│   └── nodex-core-server/      # Profile-private authenticated UDS process
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
├── resources/
│   ├── icon.icns               # macOS app icon
│   ├── icon.png                # PNG app icon
│   └── entitlements.mac.plist  # macOS hardened runtime entitlements
├── scripts/
│   ├── generate-homebrew-cask.ts # Generates the tap cask pushed to junyudev/homebrew-tap
│   └── install-local-macos.ts  # Verifies and transactionally deploys an explicit local app bundle
├── src/
│   ├── shared/
│   │   ├── types.ts            # Shared TypeScript types (Page, Board, Project, etc.)
│   │   ├── ipc-api.ts          # Type-safe IPC channel map (IpcApi, IpcEvents)
│   │   ├── assets.ts           # Shared asset URI helpers (nodex://assets/...)
│   │   └── page-limits.ts      # Shared Page payload/field size limits
│   ├── main/                   # Electron main process
│   │   ├── bootstrap.ts        # Early Electron lifecycle, profile lock, dynamic runtime import
│   │   ├── main-runtime.ts     # Core readiness, BrowserWindow, IPC, managed-asset protocol
│   │   ├── ipc-handlers.ts     # ipcMain.handle() registrations
│   │   ├── managed-asset-protocol.ts # Default-session-only raster delivery
│   │   ├── core-client/        # Authenticated typed desktop Adapters
│   │   └── local-store/
│   │       ├── config.ts       # Host Profile configuration
│   │       ├── assets.ts       # Host filesystem asset ingress/read helpers
│   │       ├── persisted-atoms.ts # Renderer shell preference persistence
│   │       ├── notifier.ts     # Host event fanout only
│   │       └── store-maintenance-gate.ts # Host admission during Core maintenance
│   ├── preload/
│   │   └── index.ts            # contextBridge: typed IPC/events + narrow copy-path resolver
│   └── renderer/               # React SPA (Vite dev server on port 51284)
│       ├── index.html          # HTML entry
│       ├── main.tsx            # React root
│       ├── app.tsx             # Workbench shell orchestration
│       ├── components/workbench/ # Project/session shell, split panel groups, tab strips, DB/Page/terminal wrappers, settings shells
│       ├── env.d.ts            # Window.api type declaration
│       ├── components/
│       │   ├── kanban/
│       │   │   ├── board.tsx              # DnD context and Database View layout
│       │   │   ├── column.tsx             # Column with droppable
│       │   │   ├── card.tsx               # Draggable card
│       │   │   ├── inline-card-creator.tsx # Visual Kanban card creator
│       │   │   ├── list-view.tsx          # Table View of Page rows
│       │   │   ├── toggle-list-view.tsx   # Rule-driven summary rows + lazy Page Documents
│       │   │   ├── project-switcher.tsx   # Radix Popover project dropdown
│       │   │   ├── page-stage.tsx          # Page editor panel
│       │   │   ├── nfm-renderer.tsx       # Read-only NFM block renderer
│       │   │   ├── history-panel.tsx      # Page edit history timeline
│       │   ├── ui/
│       │   │   ├── toast.tsx              # Global renderer toast system
│       │   │   └── editor/
│       │   │       ├── nfm-editor.tsx     # BlockNote-based NFM editor
│       │   │       ├── nfm-editor-extensions.ts # Shared BlockNote extension/paste setup
│       │   │       ├── nfm-slash-menu.tsx # Shared slash-menu controller (defaults + custom items)
│       │   │       ├── nfm-formatting-toolbar.tsx # Shared formatting toolbar composition
│       │   │       ├── callout-block.tsx  # Shared custom callout block spec (used by multiple schemas)
│       │   │       ├── database-view-ref-block.tsx # Canonical durable Database View reference
│       │   │       ├── page-outliner-block.tsx # Child/reference Page outliner + lazy target surface
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
│           ├── api.ts            # Typed Electron renderer transport facade
│           ├── assets.ts         # Image upload + asset URI resolution helpers
│           ├── page-search.ts    # Shared token search helpers for Page filtering
│           ├── kanban-store.ts   # Per-project shared board store + realtime/fetch dedupe + pageIndex
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

### Database Schema

Schema v81 is Library/Page/Data Source-first. One Profile owns one Library. `pages` gives every Page one `library | page | data_source` parent and one owned Document. `database_containers` own Data Sources and Views; Data Sources own compact local schema identities, active/dormant Page membership history, and property values; each View explicitly targets one Data Source and positions Pages by Page ID. `data_source_properties`, `data_source_property_values`, `data_source_page_memberships`, `database_views`, and `database_view_page_positions` are the only live Database authority. Projects own execution state, lifecycle, one Database binding, and recursive Page/Database grants—not content. Exact-Turn Agent authority provenance and actor/source/target relocation evidence are immutable. Active projections use Page-named tables and keys. Physical `blocks.location_kind = space | document | database` remains an internal storage coordinate compiled from canonical parents.

The SQL excerpt below documents the historical v63 migration input and is not the current authority schema.

```sql
-- Historical v63 excerpt (migration input only)

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

-- Project Session domain state; per-window tabs/panels live in the Window Session catalog
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
  database_starter INTEGER NOT NULL DEFAULT 0
    REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_session_threads (
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL UNIQUE REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
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
-- Page read models, schedule rows, and asset refs are rebuildable.
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

-- Transcript content is not duplicated in Nodex SQLite. Command-palette chat
-- history search is delegated to codex app-server and merged with this local
-- metadata at the renderer boundary.
```

### Real-Time Sync Flow

```
Core commit → authenticated event stream → mainWindow.webContents.send()
    → window.api Page/Database subscriptions → exact-head reread → UI re-renders
```

Primary Page Document edits use the independent binary collaboration plane:

```
Page Stage Y.Doc transaction → Core Document apply → serialized SQLite commit/ACK
    → same-head Page materialization + durable Page impact event
    → mounted editors apply remote origin; Page/Database readers invalidate and reread
```

The durable projection impact identifies every affected Page, Database, Data Source, View, and Page-bound Document head at commit time. It contains no title, summary, property value, or Page DTO. One scoped projection stream carries Core epoch/sequence coordinates through Electron IPC. Page detail, primary/filtered Database Views, Page and Database references, Library navigation, and management queries reread their canonical projection; if an event arrives during an in-flight read, the renderer performs one trailing reread unless the completed snapshot already covers that cursor. A committed title/body edit therefore converges across app windows without save, focus change, remount, or manual refresh.

Each editor surface subscribes before its state-vector handshake. A successful subscription ACK proves that surface's exact authenticated Core stream is open. Retryable physical interruptions remain inside one logical subscription, resume from its accepted cursor, and pause dependent sync/mutation commands until reconnection. If Core observes the lost lease before the client receives stream closure, its typed recovery forces a fresh stream and one safe/idempotent command retry; a terminal failure releases the exact session so Reload or a replacement surface can subscribe cleanly. Session-qualified connection state and serialized local teardown prevent a retiring surface from disconnecting its replacement. Missed or reordered Document updates are repaired by a later handshake; a fast successful ACK shows no save indicator. The global Core event stream replays from its last accepted sequence, and a retention gap emits a scoped `event_gap` resync.

Agent-facing body edits use ordered stable-ID Document operations (`set title`, `insert`, `update`, `delete`, and `move`) against the current Page Document. A batch either commits its Yjs update, Block registry/indexes, projections, mutation receipt, and change cursor together or changes nothing. Identity-destructive operations require mounted editors to flush and freeze behind a short write fence. Whole NFM input is an explicit compare-and-swap import; an owning `<page uuid="..." />` may pin only an existing Page shell in that same Document.

Electron exposes this contract as `block-documents:mutate`; the native CLI calls Core directly over its private UDS contract. Client-supplied `actor`, `clientSessionId`, Project, or Document scope cannot mint authority: Main binds audit identity and scope before Core reprepares the request. The response is a typed immutable receipt or typed conflict; structural fence proof never crosses the renderer boundary.

The renderer transport requires the Electron preload bridge and has no browser or localhost fallback. Private Host/Core transport remains version 4, committed events remain version 2, and semantic Module versions are selected independently from generated requirements. Ordinary Core JSON requests/responses are capped at 2 MiB/16 MiB, while user-growing collections use at most 200 items and 1 MiB per signed-keyset window; 16 MiB is a fault boundary, not a product capacity target.

Codex Threads emit a separate Electron IPC stream (`codex:event`) from the main-process Codex domain service.

---

## CLI Reference

The packaged native `nodex` binary is a UDS client of the detached Rust Core. The app bundle is the one distribution and update closure for the CLI, Core, ripgrep, migrator, and ServiceManagement helper: Homebrew Cask links that bundled binary into the Homebrew prefix, while the macOS application menu's `Install Command Line Tool…` action creates or updates `~/.local/bin/nodex`. Neither path copies a standalone binary. The app action never edits shell startup files, reports when `~/.local/bin` is absent from `PATH`, and refuses to replace a non-symlink or a symlink not previously managed by Nodex.

The CLI selects the Profile home with the same bootstrap precedence as Electron: nonblank `NODEX_HOME`, nearest project `.nodex/config.toml` over user `~/.nodex/config.toml`, then the default `~/.nodex`; config files are UTF-8, size-bounded, and malformed TOML fails closed instead of silently connecting to another Profile. It resolves a Project from an explicit unique ID/name, otherwise the longest containing managed-worktree root before considering the longest source root; equal candidates fail with stable IDs. `context`, `tree`, and `rg` honor one global `--database` exact ID/unique name or `--page` stable ID/title path, with the primary Database as default. Full Page IDs use `@<id>`, and exact authorized `/`-separated title paths never expose unauthorized candidates. `nodex read <page>` returns canonical `body.nested.md` bytes with a final LF; `--meta` returns the deterministic typed `meta.yaml` projection. Ordinary reads emit no validator, while `--prepare title.set`, `document.replace`, or `page.delete` asks Core for only the compatible narrow ETag. `nodex sed -n '<line>[,<line>]p' <page>` selects from those exact body bytes. `nodex history` returns the retained typed cursor timeline, and `nodex tree [scope]` traverses the selected Database or one authorized Page with fixed depth/node/cycle bounds. `--json` wraps stable machine output and errors; rejected commands exit 2.

`nodex rg [flags] <pattern> [scope]` asks Core for a strict, immutable search lease over the selected primary Database, Database, Data Source, or Page. Core authorizes the complete recursive Page set and projects canonical `meta.yaml` plus `body.nested.md` bytes and their ownership/revision manifest inside one SQLite read transaction without reconstructing Yrs. Metadata and body files are cached independently by projection version and content hash, hard-linked into a current-user read-only lease on the same filesystem, and never accepted back as write input. A released unchanged tree is reusable only after Core revalidates every file; reuse assigns a fresh random lease and manifest while removing the old physical path. The CLI validates the commit marker, expiry, permissions, paths, byte lengths, and SHA-256 hashes before launching the bundled real ripgrep with no config and only the documented read-only flag subset. It remaps opaque physical names to sanitized logical ownership paths containing each full Page ID, preserves ripgrep status 1 for no matches, reports stale materialization as `MATERIALIZATION_STALE`, and releases the lease after success, failure, or SIGINT.

`nodex draft create <page> --output <empty-directory>` creates an explicit bounded one-Page editing workspace containing an immutable `base/`, editable `work/`, and a private manifest; it is never a checkout or authority. `draft diff` is local and compares parsed metadata semantically, so comments, quoting, and key order are ignored. Version 1 permits only the inline-Markdown title and `body.nested.md` to change: Page identity changes, property/schedule edits, unsafe paths, symlinks, unknown entries, invalid YAML, non-canonical UTF-8/LF body bytes, and configured size excess fail before mutation. `draft apply` rereads current Page authority, preserves unrelated property/schedule changes, expands base-to-work body hunks until they are unique against current content, and falls back to whole-body replacement only while the original body ETag remains current. Title and body commit atomically in one Owned Document mutation. A deterministic operation ID plus the local pending/applied receipt marker makes response-loss retry exact; changing accepted work after apply starts requires a new draft. `draft discard` works without Core and removes only an exactly validated generated layout.

`nodex service status|enable|disable` manages only optional startup prewarming and does not connect to or start Core as part of the control command. Packaged macOS 13+ builds use a signed `SMAppService` LaunchAgent with no KeepAlive or elevated helper. Enable records the currently selected Profile and launches the same `nodex-core` executable; disabled, approval-required, unsupported, and unavailable states remain successful status outcomes because every normal command retains the authenticated on-demand startup path.

`nodex page create` accepts one inline-Markdown title plus bounded Nested Markdown from a file/stdin or an explicit empty body and targets the Library, an authorized Page, or a Database/Data Source owner. Core deterministically allocates the Page, Document, and recursive body Block identities from the idempotent operation, commits their complete genesis and projections together, and retains the exact IDs and initial title/body ETags in the replayable Library receipt. A Data Source target stages that complete genesis in the destination Database's storage Project and atomically replaces the temporary Library placement with the membership, built-in values, and default View position; no partial standalone Page is observable. `nodex page move` and `nodex page duplicate` accept start/end/before/after placement under the same owner kinds; Core resolves live destinations and revisions inside the writer transaction, preserves ownership/membership/View invariants, and returns the moved Page-shell ETag or copied identity map plus title/body ETags. A default grouped Database destination enters its valid `triage` workflow group. `nodex page delete` requires the narrow Page-shell ETag produced by `read --prepare page.delete`, recursively tombstones only through the protected Page lifecycle aggregate, and preserves exact replay after deletion. `nodex page title set` and `nodex page replace` require the corresponding narrow title/body ETag. `nodex patch` accepts the bounded one-Page patch language and preflights every old fragment against the same canonical body: each must match exactly once and no two hunks may overlap. `nodex page insert` accepts only stable start/end/before/after/inside anchors. `nodex block insert|update|move|delete` consumes a bounded closed JSON semantic draft or patch only where Block structure requires it; Core allocates actual Block identities, update guards cover intrinsic Block fields, and delete guards cover the complete subtree. Core repeats all checks against current authority and commits the collaborative update, materializations, history, receipt, and event atomically. Every mutation accepts a stable idempotency key; generated keys are diagnostics only, and a lost-response retry from another CLI process returns the original receipt even though the connection and current Document head changed. Compact results include affected Block IDs and fresh ETags for each changed semantic unit. File/stdin content is bounded UTF-8 with LF endings, and a missing source on an interactive terminal rejects instead of waiting. Decoded Document semantic strings are capped at 8 MiB; their JSON transport has a separate 64 MiB encoded bound so valid content cannot be rejected merely because JSON escaping expands it.

The JavaScript HTTP launcher and its `serve`, `query`, `schema`, URL/session,
and direct-SQL command families are removed. The npm `nodex` bin only locates
and execs the native binary; every product command uses authenticated UDS Module
requests and never receives a database path.

---

## Configuration

### Config File: `.nodex/config.toml`

TOML config for Profile and desktop settings. The native CLI reads only
`[server].home`; other `[server]` fields configure the Desktop Host. Resolution
order (later wins):
1. Defaults
2. `~/.nodex/config.toml` (user-level, auto-generated if no config exists)
3. `.nodex/config.toml` walked up from CWD (project-level overrides user-level)
4. Supported `NODEX_*` environment overrides

```toml
[server]
home = "~/.nodex"
backup_auto_enabled = false
backup_interval_hours = 6
backup_retention = 28
history_retention = 1000 # retained newest deleted Block roots; legacy config key
```

**Profile selection**: Use project-level `.nodex/config.toml` to select a
repository-specific `[server].home`; it overrides the user config for native CLI
and unpackaged runs launched from that tree. A Dock-launched Electron app reads
the user-level config because it has no repository working directory.

**Desktop renderer boundary**: Main exposes typed operations and event subscriptions through the context-isolated preload bridge. Distinct Profiles need only distinct `NODEX_HOME` values; no Desktop API port is allocated or coordinated.

### Server Environment Variables
```bash
NODEX_HOME=~/.nodex     # Nodex home (default: ~/.nodex)
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
NODEX_LIBRARY_WORKSPACE_ENABLED=false # Temporarily expose the independent Library workspace (default: false)
```

These can also be set via the `[server]` section in config.toml. Env vars override TOML values.
`NODEX_LIBRARY_WORKSPACE_ENABLED` is the exception: it is an environment-only temporary release gate, evaluated once at startup.

In the desktop app, Settings -> Backups updates `~/.nodex/config.toml` `[server]` backup fields and reapplies the auto-backup scheduler immediately. If `NODEX_BACKUP_*` environment variables are set, those values remain effective and the UI marks the overridden fields.

In the desktop app, Settings -> General -> `App updates` updates the user-level `~/.nodex/config.toml` `[server].app_updates_auto_check_enabled` flag. Unpackaged/non-macOS runtimes and packaged apps running outside an Applications folder report updater support as unavailable and do not perform background checks.

In the desktop app, Settings -> General -> `Diagnostics` updates user-level `[server]` fields for `diagnostics_enabled`, `diagnostics_dsn`, `diagnostics_environment`, `diagnostics_traces_sample_rate`, `diagnostics_replay_enabled`, `diagnostics_replays_session_sample_rate`, and `diagnostics_replays_on_error_sample_rate`. Diagnostics and Session Replay are disabled by default; Replay is a separate renderer-only opt-in that only runs when crash diagnostics are also enabled. When diagnostics are enabled without an explicit DSN, Nodex uses its bundled Sentry project DSN. Env overrides win and the UI disables overridden controls.

In the desktop app, Settings -> General -> `Telemetry` updates user-level `[server]` fields for `telemetry_enabled`, `telemetry_client_key`, `telemetry_environment`, and `telemetry_auto_capture_enabled`. Product telemetry and web analytics are disabled by default, and settings changes apply after restart. When telemetry is enabled without an explicit client key, Nodex uses its bundled Statsig client key. The renderer dynamically loads Statsig only when telemetry is enabled, passes no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. `Share web analytics` is a separate opt-in that only runs when product telemetry is enabled; it disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical signals such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events remain blocked by default. Nodex does not use Statsig Session Replay in v1; renderer replay remains the separate Sentry diagnostic opt-in.

In the desktop app, Settings -> General -> `Open source licenses` opens a nested, read-only page containing the generated legal notices for third-party JavaScript, Rust, and bundled runtime dependencies. Packaged builds read the immutable `THIRD_PARTY_NOTICES.txt` resource through the typed main-process boundary; development builds also recognize the desktop source asset locations before falling back to the repository resource. The route is loaded on demand, and the notice document participates in the page's single scroll area instead of creating a second, document-sized scroll container. The visual text is represented to assistive technology as one read-only document rather than tens of thousands of wrapped inline accessibility nodes. The page reports loading and unavailable-resource states without exposing filesystem access to the renderer.

### Development
```bash
pnpm install
pnpm run dev              # Electron + electron-vite development renderer on :51284
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

The notarized DMG is the direct-install artifact. A first launch outside an
Applications folder can move the app through Electron's native installation
gate; replacement is rejected while the installed Nodex copy is running.
Homebrew installs the same DMG-backed `Nodex.app` and links its bundled CLI.
Both channels retain Profile data on uninstall, and normal upgrades are owned
by the installed app's signed ZIP updater. Installers and updaters never
inspect, copy, or migrate `~/.nodex`; Core performs any recognized Profile
migration behind its snapshot, staging, validation, and rollback boundary.

Local source deployment is a single fresh-build operation:

```bash
pnpm run install:local:mac -- --install-cli
```

Without `--app-path`, the deployer rebuilds the Electron output and native
runtime, verifies the prepared source closure, packages into a new unique
`.generated/local-install/` directory through electron-builder's
update-capable DMG target, and never reads a persistent `dist/` bundle. The app
is installed directly while the temporary DMG is discarded; selecting that
target ensures the package contains electron-builder's supported
`app-update.yml` without introducing the ZIP target's separately downloaded
7zip toolset. Every package carries a signed build-provenance record binding the
prepared source generation, `app.asar`, updater metadata, and final signed native
and Agent runtime manifests. The same identity is reverified on the source,
staging, and installed copies.

The deployer defaults to `/Applications/Nodex Dev.app`, uses `ditto`, preserves
the previous destination as a rollback app until the installed copy verifies,
and requires `--allow-production-destination` before it can target
`/Applications/Nodex.app`. `--app-path` is an explicit external-artifact mode:
it skips rebuilding but still requires a self-consistent package provenance
and complete native-runtime verification. The deprecated `install.sh` only
forwards to this command; it no longer installs dependencies, builds, runs
`pnpm link`, installs skills, or deletes the production app.

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

### Project-bound dynamic tools

New eligible Codex tasks that start inside a Nodex Project receive the `nodex_app@5` dynamic-tool catalog. The namespace is for Nodex content and structure; Codex host controls such as task handoff, terminal access, and automations remain under `codex_app`. A task keeps the catalog revision with which it started. Retired catalogs return `tool_catalog_stale` and direct the agent to start a new task.

The thread transcript presents these calls as Nodex operations, not opaque function names. Compact rows identify the search phrase and result count, fetched Page, saved View or ad-hoc Data Source query, created titles, updated content, move destination, and duplicated Page identity. Nested Markdown inserts, exact patches, and replacements include bounded inline diffs; exact patches show removed and added source lines, while operations without prior source never fabricate deletions. Every visible call has an expandable inspector for exact arguments and output plus an exact raw app-server item dialog for debugging. Historical calls remain readable even when their catalogs are no longer executable.

The public catalog is intent-first:

| Tool | Intent |
|------|--------|
| `get_context` | Read the active Project binding, capabilities, Database/View catalog, or opt-in Nested Markdown guide. |
| `search` | Discover authorized Library Pages or body Blocks through stable identity, exact body evidence, and typo-tolerant Page metadata. |
| `fetch` | Fetch a known stable ID; default to complete canonical Nested Markdown or explicitly request a summary/stable-Block tree. |
| `query_database_view` | Execute one saved View's persisted filters, sorts, grouping, and row order. |
| `query_data_source` | Run a temporary typed filter/sort against one known Data Source. |
| `create_pages` | Atomically create one to sixteen complete Pages at one shared Library, Page, or Data Source destination. |
| `update_page` | Update one Page title/body through Nested Markdown insertion, simultaneous exact patches, or guarded whole-body replacement. |
| `advanced_update_page` | Apply identity-sensitive stable-Block edits after `fetch({ format: "blocks" })`. |
| `move_pages` | Atomically move one to sixteen existing Page roots to one destination while Nodex resolves their current parents. |
| `duplicate_page` | Copy one complete Page ownership subtree to a destination with fresh identities. |

`get_context`, `search`, and `fetch` are eager; both query tools and every write are deferred. An ordinary Project task reports `write: "granted"` while its active Project has direct writable authority: the primary Database and its complete recursive ownership closure can be read, changed, moved, or destructively edited without an authorization card. Recursive `read_write` Page/Database grants behave the same. A `read` grant allows reads directly and asks for consent only when a write is attempted. A known, currently ungranted target in the same Library also asks for consent; cross-Library, deleted, stale, and unsupported structural targets fail directly.

The consent card offers four resource-scoped decisions. `Allow once` covers only the exact prepared call footprint and persists nothing. `Allow for this task` stores only the corresponding canonical Page/Database/Library-create roots for the root task, Project, Library, app session, and store epoch; new top-level Pages produced under that task receive matching temporary Page access. `Allow for this project` writes recursive Page/Database grants through the durable writer; a top-level Library create/move/duplicate persists the resulting Page roots atomically because they do not exist before execution. `Deny` performs no mutation. Neither one-call nor task consent writes `project_resource_grants`, and renderer ownership or a forged permission-mode field cannot elevate authority. The card is local to the active direct-task viewer, or root-task viewer for a background child, and survives canonical snapshot refreshes; task authority survives renderer replacement but not app restart, task teardown, Project rebind, or store restore.

A Turn launched with the built-in Full access preset instead receives temporary same-Library authority over every capability in the existing catalog, including cross-owner create/move/duplicate and destructive writes, without creating grants or approval cards. Ordinary reads return no concurrency validators. A bounded typed `prepareFor` list asks only for the short title/body/Block ETags required by the next semantic write. Every write still performs mutation-free semantic preflight, exact-Turn and store-epoch validation, reprepare, footprint equality, ETag/CAS checks, and one atomic transaction. Direct Project authority, scoped consent, and Full access change who may approve an operation; none bypasses the semantic guards.

When the native Core backend owns the store, prepared Page semantic writes use the same Owned Document Module pair as renderer edits. Electron submits the exact frozen Turn provenance and semantic intent to the Module read; Core returns either the already committed receipt or a short-lived single-use token with the canonical effect/target footprint and whether resource consent is required. A new execution must arrive on the same bound UDS connection, revalidate the persisted Turn plus current Page/Document authority and revisions, reproduce the same footprint, and consume the token inside the writer command. The token is never durable. Exact matching receipts replay without another token or card, while a changed input, connection, Turn, epoch, revision, target closure, or effect fails closed.

Nested Markdown is the primary Agent bulk-content representation and uses the compact wire name `markdown`. It is ordinary Markdown plus Nodex tags, with one literal tab per child Block level; spaces remain authored content and do not nest. For example, the string `"▶ Toggle title\n\tChild paragraph\n\t- [ ] Child task"` creates a toggle with two children. Read results are either complete canonical content or a typed size error; truncated content is never writable. One `create_pages` call can therefore build several full many-Block Pages, while one `update_page` call can append a complete Block forest or apply multiple non-overlapping exact `oldMarkdown`/`newMarkdown` replacements against the same current source without carrying a whole-Document revision. Structural insertion uses Document start/end or stable Block anchors, never character offsets or fuzzy ellipses. Whole replacement cannot implicitly create, copy, move, or delete an owning Page; ownership changes use `move_pages`/`duplicate_page`, and protected deletion remains explicit.

Page titles are direct inline Markdown strings, not `{ kind: "plain" | "rich" }` trees. The supported single-line subset preserves text styles, links, thread mentions, and date mentions. Block syntax, attachments, Page mentions, tabs, and newlines fail validation rather than being silently flattened. Title and body keep separate ETags.

ETags and cursors are opaque proofs, not capabilities. An ETag is a fixed 48-character digest that binds one internal guard kind, actor Project, store epoch, resource identity, and current semantic state without embedding that state. Cursors use a separate self-contained format because pagination must recover offset and snapshot coordinates. Stale, tampered, cross-resource, cross-Project, membership-ABA, and post-restore reuse fails closed. Dynamic-call receipts bind the app-server thread/call identity and exact-Turn authority fingerprint separately from canonical mutation receipts, so an exact retry can recover a committed sparse result before validating current guards and without storing body content or hidden document history in the receipt ledger. Historical committed receipts without provenance remain replay-only; historical prepared receipts must be restarted.

The current Codex dynamic-tool transport returns JSON text. In Code Mode, parse each result once, retain intermediate Markdown, rows, cursors, and ETags inside one JavaScript pipeline, serialize dependent writes, and expose only a bounded final summary through `text()`. Every nested call remains individually visible and raw-inspectable in the transcript. Native structured dynamic-tool output remains an app-server protocol upgrade because the current dynamic-tool declaration, response, and Code Mode adapter do not carry an output schema or structured value.

Independent value editing for an existing Data Source membership is intentionally absent from revision 5. New or relocated Data Source memberships may receive initial values, and `move_pages` can change saved-View placement. A future property-editing tool must begin from a focused user intent rather than restoring the retired generic `edit_database` union.

### Design: Native CLI + Desktop Adapters

External agents and scripts use the native **`nodex` CLI**, which is an
authenticated UDS Adapter over the same Core Modules as the desktop. It supports
context/tree inspection, exact Page and metadata reads, bounded history,
immutable-snapshot ripgrep, explicit one-Page drafts, semantic Page and stable
Block mutations, backups, doctor, and optional Core prewarming. Browser and
Electron callers use typed HTTP/IPC Adapters for their product workflows; the
The CLI and Electron renderer are separate typed Adapters; neither receives a database path or the Core bearer capability.

Project, Page, Database, Document, and backup commands all submit semantic
intent. Core resolves current ownership and revisions, applies the mutation and
projections atomically, and returns an idempotent receipt. No Adapter accepts raw
SQL, a database path, physical rank, or Yjs storage coordinates.

### Output and Inspection

Commands provide concise human output by default and stable structured output
through `--json` where documented. Storage inspection is intentionally absent;
`nodex doctor`, typed context/tree/history reads, and Core validation reports are
the supported diagnostics.

---

## Design Decisions

### Why SQLite?
- **Atomic transactions**: Move operations are atomic, no data corruption
- **Fast queries**: Indexed lookups, no file parsing overhead
- **Single file**: Easy to backup, restore, or move
- **Local ownership**: Embedded database with no network database service; one detached per-Profile Core process owns it
- **WAL mode**: Good concurrent read performance

### Why Multi-Project in One Database?
- **Single file**: One `nodex.db` contains all projects, easy to manage
- **Foreign keys with CASCADE**: Deleting a project automatically cleans up all related data
- **Shared schema**: No duplicate table definitions across databases
- **Atomic cross-project queries**: SQL can query across projects if needed

### Why Electron?
- Desktop app with native window management
- Preload script provides secure IPC bridge via contextBridge
- Rust Core hosts SQLite/Yrs authority; Electron hosts windows, IPC, OS integration, and Codex app-server
- No need for globalThis singleton hacks (unlike Next.js server)

### Why Electron IPC?
- No public listener, port collision, CORS surface, or browser parity layer
- Typed structured-clone commands keep sender authorization and payload validation in Main
- Renderer event fanout stays project-scoped and shared across consumers
- The Browser sidebar remains an isolated embedded-webview feature rather than a second Nodex client

### Why a Local Native Core?
- No server setup required
- Offline-first with explicit `nodex doctor`, backup, and semantic CLI diagnostics
- Portable single file
- Works offline

### Why SQLite Online Backup API for Backups?
- **WAL-safe snapshots**: Core's online backup API captures consistent state from the live WAL database
- **Atomic backup directories**: Stage in temp dir and rename into place
- **Restore safety**: A continuous maintenance fence, auto safety backup, integrity validation, and durable DB/WAL/assets restore journal protect against failed or interrupted restores
- **Whole-store recovery**: Backups include both `nodex.db` and `assets/`

### Why Stable Asset URIs?
- **Profile-portable storage**: NFM descriptions stay valid independently of delivery details
- **Flat asset ids**: canonical asset references use `nodex://assets/<file>` so image blocks stay portable while file lookup remains a simple single-directory join
- **Narrow rendering**: allowlisted raster images map to a read-only protocol installed only in the owned app session; mutations, bytes, and previews use IPC
- **Safer lifecycle**: Deferred cleanup avoids accidental data loss from aggressive orphan deletion

### Why CLI for External Agents and Automation?
- **Semantic**: Page, Block, draft, tree, history, search, backup, and doctor commands expose product intent instead of tables
- **Concurrency-safe**: each mutation is one idempotent native Module request, so current ownership and revisions resolve inside the transaction
- **Stable identities**: Agents address Pages, Data Sources, Views, and properties by canonical IDs.
- **Strict parsing**: Unknown flags/invalid values fail fast instead of silently being ignored
- **Machine output**: documented commands expose stable `--json` output in addition to concise human output
- **Profile selection**: `NODEX_HOME` and `[server].home` use the same precedence as the desktop
- **Private transport**: the CLI authenticates over Profile-private UDS and never receives the database path or Core bearer capability

### Why Write Limits in App Layer?
- **Stops runaway growth early**: Field-level validation blocks exponential-content bugs before they hit SQLite/history
- **Transport consistency**: shared validators and generated Core contracts protect Electron IPC and native Module requests.
- **Resource protection**: IPC and Core byte budgets reject oversized requests before domain work
- **Operational simplicity**: Limits live in shared constants, so values stay consistent across modules

### Why Popper Positioning for Inline Creator Selects?
- **Radix compatibility with custom triggers**: Avoids `item-aligned` dependence on `SelectValue` value-node measurement
- **Reliable placement**: Dropdown menus anchor consistently in narrow kanban columns
- **Safer click-outside behavior**: Portaled menu interactions can be excluded from inline creator auto-dismiss logic
- **Safe writes**: API ensures valid data, agents can't corrupt database
- **Race condition safety**: Transactions handle concurrent writes properly

### Why Shared Slash-Menu Controller?
- **Single extension point**: Add custom block insertions (like `toggleListInlineView`) while preserving BlockNote default slash items
- **Consistent UX across editors**: Page Stage and Toggle-List editor use the same slash composition and filtering behavior
- **Avoid duplicate overlays**: Explicitly disabling built-in `slashMenu` prevents stacked/default menu conflicts

### Why Shared Toggle-List Page Editor Core?
- **DRY behavior**: Toggle List and inline references reuse one summary-row, visibility, provider-budget, and independent Page Document surface
- **Navigation correctness**: Boundary Up/Down routing is centralized around Page summaries and host callbacks, reducing `NodeSelection`/DOM-race edge cases.
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
- **Forward recovery**: restoring a checkpoint appends a new validated Yjs update and audit receipt instead of rewinding CRDT causality or rebuilding a Page snapshot.
- **Page ID preserved**: Deleted Pages restore with the same ID

### Why BlockNote for the Editor?
- **Notion-like UX out of the box**: Drag handles, slash menu, block selection, formatting toolbar
- **Native block nesting**: Children blocks are first-class (crucial for Nested Markdown's tab-indented structure)
- **Built on ProseMirror/Tiptap**: Battle-tested engine, active development
- **Custom block types**: `createReactBlockSpec` for callout blocks (extensible for future types)
- **shadcn/ui integration**: `@blocknote/shadcn` uses the same UI primitives as the rest of the app

### Why Nested Markdown?
- **Familiar base, lossless extensions**: Standard Markdown stays readable while Nodex tags preserve product-specific Blocks without a lossy importer
- **Block-level structure**: Tab indentation for children, `{color="Color"}` attributes, XML-like advanced blocks
- **Editor-local indentation boundaries**: If `Tab` or `Shift+Tab` cannot change nesting, the keystroke is swallowed instead of moving focus into hover-only editor chrome
- **Human-readable**: Descriptions remain readable in raw text (CLI, database inspection)
- **Custom parser/serializer**: Pure functions in `src/renderer/lib/nfm/`, independent of editor library
- **Three-layer architecture**: Nested Markdown string ↔ internal `NfmBlock` tree ↔ BlockNote blocks — clean separation of concerns
- **Read-only renderer**: Page previews use `NfmRenderer` (lightweight, no editor overhead).

---

## Glossary

| Term | Definition |
|------|------------|
| **Agent** | AI coding assistant (e.g., Claude Code) that interacts via API |
| **Page** | The user-facing document-like Block; Page ID equals Block ID and it owns one collaborative Document |
| **Library** | The Profile-owned durable content scope for Pages, Databases, Documents, and history |
| **Data Source** | Schema and Page-row identity owned by one Database Container |
| **Column** | A vertical list representing a workflow stage |
| **Block** | The single persistent application identity for content, including Pages, Databases, ordinary body nodes, and references |
| **Document** | Independently synchronized content owned by a registered document-bearing Block; its schema selects `yjs` or `canvas_scene` |
| **Project** | Execution context for filesystem roots, sessions, terminals, Codex tasks, one Database binding, and Library grants |
| **Page Stage** | Panel for viewing/editing Page properties and its independently synchronized title/body Document |
| **IPC** | Inter-Process Communication between Electron main and renderer |
| **Transport** | Typed renderer boundary in `api.ts` backed by Electron IPC |
| **Main Process** | Electron process hosting IPC handlers, OS integrations, and Core/Codex Adapters |
| **Preload** | Electron script that bridges main ↔ renderer via contextBridge |
| **Session ID** | UUID identifying one client session for audit, presence, and exact mutation attempts |
| **History Panel** | App-shell modal showing a Page's canonical timeline and retained Document checkpoint previews |
| **Mutation receipt** | Immutable evidence that one logical Block/Document/Database command committed or was durably rejected |
