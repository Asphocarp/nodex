# Nodex - Product Specification

## Relation Properties

Users can create a Relation Property for a Data Source and choose from the Project's paged catalog of accessible target Databases. A Relation cell links an unordered unique set of target Pages, displays the first three visible title chips plus exact hidden/remaining counts, supports add/remove and paged expansion, and can filter by contains/not-contains/empty/not-empty. Candidate search queries the configured target Data Source directly rather than only its default View. Relation does not grant access: inaccessible targets render only as a `Restricted` count, without identity or title. Moving, archiving, deleting, restoring, or renaming a target preserves the reference and updates its projected state. Relation is one-way in this release and is unavailable for View sorting/grouping; a name such as `Blocked By` does not enable cycle validation.

Clearing a non-empty Relation requires explicit confirmation and uses a revision-fenced empty replacement, including targets hidden as `Restricted`. Adding a target accepts a currently readable Page ID; incremental removal accepts only the Core-authored opaque edge handle already issued for that source value. A user can therefore remove a relation after losing target access without turning a guessed Page ID into a membership oracle. A paged selected-target window may show generic `Restricted page` rows with remove controls, but exposes no target identity or metadata. Saved Relation filter operands are rechecked whenever the View is read after authorization changes. Page Detail built-in Source Properties use the same Database write contract as Database Views. An action that also changes intrinsic schedule/run metadata commits both owning-module mutations atomically.

CLI `meta.yaml` represents a non-empty Relation as a read-only bounded summary containing visible `{id, name}` targets, `total_count`, `restricted_count`, and `has_more`. Restricted identities are never serialized, and a long or partially restricted Relation does not make the Page unreadable.

Fresh Profiles use Store v110. Exact older native Stores are backed up and
atomically advanced through the v102 LocalCommit ledger, v103 composite Store
identity, v104 canonical evidence hash, v105 Manifest/authorized packet split,
v106 Projection scope heads, v107 exact Block child-key indexes, v108 scoped
resource-revocation evidence, and v109 resource-atomic delivery, complete
Projection audiences, opaque Relation edge identities, and sealed mutation
finalization, followed by v110 transaction-owned visibility journaling,
canonical pre/post authorization deltas, and private sealed Projection
descriptors. Drifted or
partially migrated inventories fail closed.

## Overview

Nodex is a local-first, block-based agent workspace. A local Profile owns one durable Library of Pages, Database Containers, Data Sources, Views, Documents, and history. Projects are execution contexts for filesystem roots, sessions, terminals, Codex tasks, one primary Database binding, and explicit Library resource grants. Electron and loopback HTTP clients share one SQLite authority.

User-facing interactive conversations are **Chats**. `Session` and `Thread` remain persistence/protocol terms, but conversation selectors, navigation, empty states, and actions must not call a Chat a task. **Task** is reserved for real work items such as Database cards, scheduled automations, and protocol concepts whose external contract already uses that term.

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
- When Core creates a Project's primary Database aggregate and Primary Canvas, it snapshots the normalized Project name into `<project-name> DB` for the Database container and its initial Data Source, and `<project-name> Canvas` for the Canvas display name. These names are creation-time defaults: renaming the Project never cascades to either resource, and existing `Cards`/`Canvas` resources are not migrated. If the derived display name reaches the 256-character limit, the project-name prefix is shortened with an ellipsis while preserving the ` DB` or ` Canvas` suffix.
- A fresh Profile automatically creates one ordinary source-backed Project named `My Project`; there is no setup wizard or special onboarding route. Its source is the first collision-free `<Documents>/Nodex/My Project*` directory. Isolated development/Profile runners may replace only that parent directory through an absolute Host override, while normal Project and projectless writable-root behavior stays unchanged. Bootstrap readiness is derived from whether any Project exists, including inactive or archived Projects, so archiving or removing the last active Project never restarts onboarding.
- The first Project is committed through the atomic `CreateInitialProject` Workspace intent. In the same immediate writer transaction, Core creates the normal Project/primary Database/default View aggregate and one ordinary `Welcome to Nodex` Page in that Database; it creates no Session. Invalid starter content rolls the entire aggregate back. Concurrent windows or clients produce one winner, and exact operation replay returns the same aggregate rather than creating another initial Project or Page.
- The editable `Welcome to Nodex` Page shows the actual source path, model sign-in/provider choices, a send-to-chat starter prompt, and the relationships among Projects, projectless chats, Pages, and DB Views. The first Window Session opens the Project Scene with the current default Database View as its protected root tab, opens that Page Stage in the fixed full-width surface stack, makes it active, and leaves the bottom panel collapsed. The Page and Project can be edited or deleted like any other user content; removing them does not recreate onboarding.
- Historical rootless Projects remain valid and do not block Workbench startup. They use the ordinary Project edit dialog when the user wants to add source folders; there is no separate legacy repair state or one-time repair prompt.
- Single-page app with one Workbench shell: Projects render as folders in the left sidebar, expanded Projects show durable Sessions, and Pages lists a small flat set of standalone top-level Page, Database, and Canvas roots. Each Window Session presents a Project-, Session-, or Resource-owned Scene through the same primary-plus-right/bottom-panel composition.
- Every Project can open with zero Sessions. A Project Scene resolves the Project's current primary Database default View from exact Project state and places it as the protected first tab in a fixed-open/full-width surface stack; a Session Scene uses Conversation as its fixed primary plane. That protected root tab presents the Project marker and the stable label `Project Home`, without repeating the current Project name; `Project Home` is only the root surface's presentation label, not a separate route, entity, or duplicate title row. Only that protected root replaces standard DB tab chrome: every other DB surface in the Project Scene uses the same table icon and `DB View` label as a Session Scene. Agent composition belongs only to the footer Agent Dock, whose own restore control toggles it without adding a second Database-toolbar entry point. Database, Page, Canvas, Files, Browser, Terminal, and Review surfaces can open in the Project Scene without creating a Session as a panel host. Window Session storage identifies DB surfaces by explicit durable target, permits distinct Views from the same Project, focuses an already-open identical View within that Scene, and rejects missing/deleted/cross-Project View identities.
- Each DB tab reads one atomic descriptor/query snapshot for its durable View ID. The exact unfiltered, manually ordered, status-grouped primary Kanban View keeps its specialized Board UI. Filtered and secondary Views render list, board, or calendar-agenda projections from their own query; both Board renderers share column-major keyboard active-Page and selection semantics, while pointer hover is transient and movement is admitted only when that exact View can compile one atomic authority mutation. An active selected Page resolves to one selected-card halo rather than stacked focus and selection outlines. The active Workbench tab owns contextual Page shortcuts for its mounted lifetime; reactive Board renders never relinquish ownership, and background split/tab surfaces cannot claim commands. Displayed custom properties and manual ordering mutate that selected View/Database identity, never the Project's primary board. Scalar values use captured revisions, multi-select values use add/remove intent, and stale writes refresh instead of overwriting another window.
- Grouped board Views page per column: every column loads its own first window (50 rows), renders an in-flow `Show N more` row after its last loaded card (above `New page`, scrolling with the cards), and its header count badge always reports the group's true total from the bounded per-group totals read, so a partially loaded column is never mistaken for a short or empty one. Flat list projections page as one window with a trailing `Show more · loaded of total` row. Paging keeps working while edits and background sync mutate the Database: a rejected continuation silently re-reads that column's loaded span from its first window, an ordinary load failure keeps the board rendered and offers an inline per-column retry, and refreshes (edits, realtime events, invalidations) re-read each column's loaded span instead of collapsing it back to the first window. Calendar projections currently render all loaded windows with a single continue affordance; date-range-scoped calendar reads are planned follow-up work.
- Window Session Scenes support the closed surface union `conversation`, `db_view`, `page_stage`, `canvas_stage`, `terminal`, `browser`, `review`, and `files`. Create, update, clone, and restore use one strict kind-discriminated descriptor contract, so a Browser identity cannot appear on another kind and malformed owner/primary or kind/config combinations fail before Window Session persistence. Database, Page, and Canvas descriptors retain resource identity plus an explicit Project or trusted-Library access context; Scene owner and access authority are independent, and Project never becomes Page content ownership. The Pages Scene allows only trusted-Library content surfaces; execution-only Terminal, Browser, Review, and Files surfaces require a Project or Session context. An attached projectless Session is a valid Session context for Review; Review is hidden only when no valid thread/turn target or scoped diff can be resolved.
- Empty panels and each panel-group tab strip use the same target-aware new-tab action registry. Each group's plus button sits immediately after that group's tabs and creates or previews content in that leaf. The standard Session Scene chooser order is Review, Terminal, Browser, Files, and Side chat, filtered by target panel and singleton availability; an attached projectless Session includes Review when its turn target can be resolved, while an empty/invalid target omits the action instead of showing a dead button. A Project Scene uses the same registry with explicit Project context and omits Side chat; its resource surfaces never allocate a Session. Right-panel choosers then append a separated Nodex-only section for DB View and Page Stage when eligible. DB View creates or focuses the selected Scene context's DB surface directly until that Scene already has one, then opens the move-to-style DB destination picker so another Project DB can be selected. Direct creation targets the Project's current default View; when the Project has no active default View the action reports that explicitly instead of silently doing nothing. Page Stage's empty picker shows the selected Project context's bounded first Page window; typing searches all accessible Projects through the bounded native Page-search projection and groups current-Project hits before other Projects. Timeline remains hidden until Nodex has a first-class tab kind and eligibility model for it. Review is a singleton surface per Scene across both right and bottom panels. DB View is one tab per target Project, while Browser is multi-tab and supports New tab to the right, Reload, and Duplicate before generic close actions from the tab context menu.
- Browser and selected Files can open as preview tabs in either right or bottom panel, and single-clicking a Kanban DB-view card opens its Page in Page Stage as a right-panel preview in the nearest right leaf, creating a right-side group first when the right panel is full-width with only the DB group. A Window Session panel leaf owns at most one italic preview at a time; opening a second preview in the same leaf replaces the first, and the preview is ephemeral until the user interacts with the preview body, pins it, or double-clicks its tab label. A newly opened empty Files tab is durable and shows `Open file` / `Select a file from the workspace tree`; its first file selection creates and activates a normal durable file tab, then closes the empty navigator through the ordinary same-leaf close path. Later tree single-clicks use the leaf's replaceable preview, while double-click and Enter promote the matching preview in place or open durably. Focusing an already durable matching file leaves any unrelated preview open. Preview replacement and promotion preserve the visible tab presentation rather than replaying tab entry/exit motion. Files navigation, search, splitter, and toolbar interactions are exempt from generic preview auto-pinning.
- The built-in Browser uses one Profile across Nodex windows while every live
  page belongs to one exact Window Session-scoped route. Main owns sandboxed
  guest attachment, navigation, permissions, popup policy, persisted Chromium
  history, page suspension/restoration, downloads, annotations, device metrics,
  the app-resolved page color scheme, site information, Profile import, and
  credential operations. Color-scheme changes reach the guest through
  Main-owned CDP emulation and update `prefers-color-scheme` without navigating
  or recreating the page, including while Settings or another route temporarily
  replaces the workbench. Window Session files retain only the Browser tab shell
  and opaque storage identity. A Browser
  preview allocates that identity before Main registration and promotion keeps
  it unchanged; a provisional legacy identity may migrate only while the tab is
  cold and has no attached guest. Guest attachment resolves the opaque storage
  identity from the Main-owned registered host; it does not depend on custom
  renderer DOM attributes being forwarded by Electron. Electron's attach
  instance identity binds the accepted request to the resulting guest in Main
  before renderer registration or guest messages can use it. Runtime messages
  that require guest methods wait for `dom-ready`, so opening a restored or
  newly navigated page cannot fail because annotation state arrived before
  attachment. Profile data clearing is explicitly global to the built-in
  Browser; tab close is not. Browser guest presentation follows logical panel
  visibility rather than the panel shell's animation lifetime: closing a panel
  hides and disables its fixed guest before the shell spring begins, while that
  mounted panel keeps host ownership until the spring unmounts. Only then may
  the background retention host take over, and stale presentation updates are
  rejected by renderer, host, and mount generation.
- Browser Use controls its presentation explicitly. Starting an idle turn first
  awaits capture of the exact owning Session namespace and Window Session view
  scope; merely selecting a Session or Agent Dock target does not capture.
  `New chat` materializes its real Session before capture. A newly created Codex
  Thread promotes that Session route before the first turn dispatches,
  including worktree starts, while steering or queueing an active turn
  preserves its route. When the agent requests a visible Browser, Nodex first
  materializes the exact controlled page in the owning Session Scene and then
  selects that task. A background request may materialize a retained Browser
  shell in an empty target leaf, but it must not expand a panel, select that
  Browser tab, replace another active tab, change split or maximized state, or
  perturb global MRU ordering. The shell becomes the leaf's local active surface
  only when the leaf had no active surface. Hide requests likewise update the
  Session Scene without navigating. Manually opened Project Browser tabs remain
  Project-owned and are not implicitly attached to a Dock chat. Hiding the Browser or Dock
  does not stop Browser Use or destroy the page. Browser activity, a pending
  presentation request, and actual renderer-confirmed visibility are distinct
  states; every runtime tab keeps its exact source `codexSessionId`, even when
  other Dock targets are selected.
- A controlled Browser page keeps one body-level guest host for its complete
  live lifetime. Moving between retained, background, and visible panel
  presentation updates only that host's layout and presentation metadata; it
  never reparents or recreates the Electron guest. While Browser Use is active,
  its cursor is composited through the host's dedicated overlay above the
  native page. The cursor appears at a stable idle position before the first
  movement, derives its visible bounds from the presented webview surface,
  clamps movement within those bounds, and reports arrival only after visible
  motion has completed. A non-presented page snaps cursor state without waiting
  for a renderer animation.
- The thread floating Environment surface includes a `Browser` section built
  from right-panel, bottom-panel, preview, and Browser Use runtime pages,
  deduplicated by logical `browserTabId`. Runtime-only pages therefore appear
  before a Workbench shell exists and are still clickable; clicking one uses
  the same materialization path as an agent visibility request. The current
  Browser Use page shows its live title, host, favicon, spinner, and working
  shimmer. Releasing a handoff or deliverable page retains it as an ordinary
  Browser tab in the background, while closing an agent-only page removes its
  shell and summary row.
- Browser settings expose searchable history, durable download history,
  password/contact summaries, Profile import, and extension capability through
  product-owned providers. Password material is encrypted with the platform
  storage facility, never returned to the app renderer, and may be filled into
  only the currently owned origin through the restricted guest preload. Cookie
  import targets the shared Profile. Password import/save is unavailable when
  platform encryption is unavailable; an unattached page has no current-site
  credential results rather than producing a lifecycle error. Extension
  management is shown as unavailable when Electron exposes no supported provider.
- A Files tab identifies an exact local file by host and absolute path independently of its optional navigation root: files produced or changed in worktrees and other directories remain previewable and pinnable even when they are outside the Project source, while the tree and breadcrumb browse only within an explicitly selected canonical root. The Files tree uses the virtualized Pierre tree runtime with 28px rows, disclosure-only folders, colored file-type icons, sticky folders, keyboard navigation, and hidden/generated entries included. Directory browsing remains lazy; the 150ms-debounced filter uses a bounded root-wide main-process search so it can find files under directories that have not been expanded. Directory requests and search use root-relative coordinates, hide directory symlinks whose resolved target escapes that root, and may traverse directory symlinks that resolve inside it.
- Exact-file metadata, text, and binary reads do not require a workspace-root grant; the main process accepts them only from the top-level renderer of an owned app window. File routing is metadata-first: sampled text always receives a source surface even when its filename has no extension, so files such as `LICENSE` remain readable. The renderer uses Pierre for all read-only and editable source, wraps source by default with a per-tab toggle, syntax-highlights recognized languages, and lets Markdown switch between editable source and rendered presentation. Text under 10 MiB is editable, text from 10 MiB through 20 MiB is read-only, and larger text is rejected before a full read. Editable files persist a recoverable draft after 550ms and compare-and-swap autosave after 3 seconds. Exact-path watchers are shared per renderer and refresh clean documents after external changes; dirty external changes retain both versions in a split conflict diff. Close, preview replacement, panel movement, and app-window close wait for saving, while an unresolved conflict retains its draft and blocks destructive tab transitions. Page Stage preview promotion reuses the preview tab id so the editor body does not remount. Page Stage close/delete controls do not pin an unpinned preview before closing/deleting. Side chat uses a separate renderer-local leaf-scoped tab lifecycle: the empty-panel action, panel menu, thread overflow action, `/side`, and the thread selected-text `Ask in side chat` overlay create `sidechat-loading:<parentThreadId>:<index>` tabs, replace them with closable `sidechat:<threadId>` tabs after the temporary fork starts, and never pin or persist those tabs.
- DB view tabs keep the DB view selector pinned above board, list, toggle-list, and calendar content, with task search and supported view-local filter/sort/display controls inside that tab body
- Page Stage opens as a Window Session Scene panel surface when opened from persistent entry points such as the command palette, thread Page links, or the explicit Page Stage picker. Single-clicking a visual card from a Kanban DB View opens or replaces a renderer-local Page preview in the selected owner Scene; double-clicking opens a persisted local Page tab immediately. A Page tab can remain in the selected owner Scene while rendering a Page accessible through another Project; the selected Scene supplies placement context, while the tab config's Project is the authorization context for Page content, history, and terminal requests. Cross-Project Page tabs show the content Project as a compact prefix before the Page title, and tab hover tooltips expose the full title/Project context. Page tab config persists only Page identity, access context, and a title snapshot; navigation history is never stored as Page ancestry. Page Stage resolves the current root-to-parent ownership path from Page authority in one Project-scoped read and projects it as a single-line breadcrumb in the top toolbar. Opening a sibling through `pageRef`, a Database View, history, or any other entry point therefore yields the same canonical breadcrumb as opening it directly. Page moves, renames, lifecycle changes, and grant changes invalidate the path read model; inaccessible ancestors are not exposed, while the current item follows the mounted Y.Text title. The current Page stays non-interactive, and every visible or overflowed ancestor can reopen its Page tab in the same authorized Project context. When the DB tab group has a right-side sibling group, new Page previews or tabs open in the nearest group to the right; when the full-width right panel has only the DB group, opening a DB View row first creates a right-side group and then opens there. Focusing an existing persisted Page tab clears any preview in that leaf and preserves the current right-panel width mode. Page tabs keep the Page Stage shell stable while board summary or full detail hydration is pending: the toolbar is visible but disabled, the title uses the tab snapshot when available, and only unresolved property/editor regions skeletonize. Missing Page/Project targets render a clear empty state only after loading settles instead of a blank or misleading panel. A panel leaf renders only its selected tab body. Within one renderer, every surface with the same Store epoch, normalized access scope, Document, generation, schema, and sync engine shares one canonical Y.Doc/provider; owner metadata, head advancement, tab identity, and tab group do not split that authority. Each Page tab instead retains an independent EditorSurfaceLease containing its BlockNote editor, surface transaction origin, UndoManager, relative selection, focus, and Awareness contribution. Switching tabs disposes only the inactive EditorView, NodeViews, and DOM and removes only that contribution. Returning attaches a fresh EditorView to the shared current Y.Doc and restores surface-local interaction state. Explicit tab close disposes its lease once; the final lease closes the DocumentSession. Store epoch, access scope, generation, schema, or terminal reset replaces the session, while Page moves and ordinary head changes do not. An unpromoted Page preview disposes its lease when the preview disappears; promotion keeps the same lease without remounting the editor.
- Page Stage projects each active Data Source Property independently in Source rank order. Removing one Property removes only that row; remaining and custom text, number, checkbox, select, multi-select, date, datetime, and Relation Properties stay visible and editable. Assignee is a reserved Text presentation role, not a synthetic Person identity. It omits the Properties section only when a Page has neither Data Source property rows nor a Threads row, so standalone nested Pages do not retain empty section chrome.
- In Kanban DB views, cards that are open in selected, visible Page Stage tabs or in the active Page Stage preview in the active session's right or bottom panel render an active ring. Collapsed panels, unselected tabs, and durable Page tabs hidden behind a different preview or temporary tab do not mark board cards active.
- Opening DB View from the right-panel action chooser creates or focuses the current Project DB directly when possible; once that current-Project DB tab exists, the action uses the shared move-to-style picker chrome with command-palette-aligned fuzzy/prefix search. DB View picker results open one DB tab per selected Project. Page Stage picker results group the active session Project's matching Pages first, then other Projects, and can target Pages available through another Project while preserving the active session as the tab owner.
- Terminal opens as a Window Session-local bottom-panel tab with a terminal runtime id and starts in the attached Thread cwd when present, otherwise the owning Project's primary source, otherwise the PTY process default. Pages can request a terminal in a Project execution context, but terminal tabs carry neither Page ownership nor Page IDs. Switching away disposes only the xterm renderer; the PTY and bounded output buffer remain in Main and hydrate the next view. A PTY grants one interactive Window Session lease at a time; another window must explicitly take over. Local tab close releases the lease without killing the PTY, while `Kill terminal`, backend exit, Project cleanup, and app shutdown terminate the runtime and publish exit.
- Panel action shortcuts are `Ctrl+Shift+G` for Review, `Ctrl+\`` for Terminal, `Cmd/Ctrl+T` for Browser, `Cmd/Ctrl+Shift+E` for Files, and `Alt+Cmd/Ctrl+S` for Side chat. Focused right/bottom panel tab cycling uses `Cmd/Ctrl+Shift+[` for the previous tab and `Cmd/Ctrl+Shift+]` for the next tab in the nearest or last focused split leaf, wrapping within that same group. `Cmd/Ctrl+W` closes the active closable tab in that focused leaf without closing the app window. Panel action shortcuts are ignored while focus is inside editor/input/dialog surfaces; focused panel tab cycling and close-tab still work from NFM editor content in the focused panel group but ignore input fields and dialogs. Plain `Cmd/Ctrl+[` / `Cmd/Ctrl+]` remain app-window Back/Forward.
- A selected Session Scene can show, collapse, resize, or full-width expand its right panel. Project and Pages Scenes instead use the same panel tree as a structurally open, full-width surface stack. A Project's current default Database View remains its first non-closable root tab. Pages has no protected primary: every Library Page, Database, View, and Canvas tab can close, reorder, move, or split, and closing the final tab reveals the Pages chooser. The Project root is projected as the Project marker and `Project Home`; Pages tabs keep their live resource title and type icon. Opening a Page from a Database in a one-group full-width stack creates an adjacent right tab group; later Pages from that Database reuse the nearest right group. Right, bottom, and split-panel resize drags remain continuous even when Browser webview content is visible under the pointer. The fixed global header keeps eligible panel controls clickable over every surface. When the sidebar is collapsed and a surface stack is full-width, its tab header starts after the measured left titlebar rail so the left titlebar buttons and tabs do not overlap. Newly materialized Session Scenes default to collapsed right panels; newly materialized Project and Pages Scenes normalize to open/full-width, with Project onboarding optionally activating the Welcome Page while retaining Database as the protected first tab.
- Attached root-thread sessions use a fixed body-portal composer overlay at the bottom of the full-width right panel for `review`, `browser`, `db_view`, `page_stage`, and `canvas_stage` tabs. Project Scenes use the same footer-only connector as a controlled Agent Dock: it renders one shared context rail and composer without mounting a transcript body. Both owner kinds persist manual composer visibility in their Window Scene without adding Back/Forward history, so switching tabs or Sessions, leaving full width, and restoring the window preserve the choice. Hiding releases the bottom reserve without stopping a turn, clearing a draft, or releasing Browser/Terminal runtime; the accessible reveal handle restores and focuses the composer. The rail begins with any exact Session in the Project or a Scene-local `New chat`; selection never navigates, and only `Open chat` enters the complete Session page. `New chat` continues with its mutable run-target/environment/branch context while omitting the fixed Project selector. A connected chat continues with its latest-turn summary and `Open chat`; expanding the summary reveals its content inside that same surface. The compact selector shows no `Draft`, `Running`, `Ready`, or other status copy. Its fixed leading indicator uses the same status language as the sidebar: an active chat shows the spinner, unread or attention-bearing chat state shows the blue dot, and an idle/read chat keeps a quiet neutral dot. Switching targets replaces this rail projection in the same render without a vertical entrance/exit transition, and each target owns its own collapsed latest-turn state. The overlay reuses normal follow-up composer state and actions while presenting an empty or fitting draft as a 44px single-line row joined to the rail. The rail uses one centered 13px horizontal inset, translucent input-surface material, and edge relative to the composer surface. When the prompt's measured unwrapped width no longer fits beside the compact controls—or the draft has explicit line breaks, attachments, an error, or active dictation—the composer adopts the normal Session shape with a full-width prompt row above a standard split control row: context and permission stay left, while model, dictation, and submit stay right. The fit remains based on the compact row while expanded so shortening the prompt or resizing the pane can return it to one line; only the capped prompt editor scrolls. Browser can contract to a 384px idle/hover surface and owns transient document-bottom auto-hide; that effective hiding composes with but never overwrites the persisted manual preference. The portal tracks pane geometry, app zoom, and bottom-panel offset. Side chats, Terminal, Files, blank Session homes, and resuming attached Session pages do not show the Session root-thread overlay.
- `New chat` creates no Project Session until its first send. That send is coalesced per Scene draft, creates exactly one ordinary Session, promotes the composer identity and binds the Dock before starting the real Thread, and leaves the Project route unchanged. A failed Session create preserves the unbound prompt; a failed Thread start preserves the one blank Session binding so retry cannot create a duplicate. Existing targets share the canonical conversation store and attached draft identity with their complete chat pages. Dock binding and visibility persist in the Window Session Scene without entering Back/Forward history; exact Session hydration, not the bounded chat picker window, decides whether a binding remains valid.
- Right and bottom panels support splitable tab groups. Users can split the selected tab from a multi-tab group into a new neighboring group, drag tabs between leaf tab strips with a live insertion marker, drag tabs near the body edge of a leaf to create a split, and resize split groups with sashes. A released sash keeps its committed position while the split ratio is persisted instead of snapping back to the previous layout. Split sashes retain the same token-colored one-pixel hairline as the outer panel edges at rest, with the matching gradient emphasis on hover or drag. Header tab rows insert or move tabs into that group; body drops merge into the group center or split from the body edges. Durable tabs are uniquely owned by one leaf; when the last visible tab leaves or closes from a non-final group, that empty group is removed automatically. The final empty group remains as the panel fallback, and collapsed panels restore their split tree when reopened.
- URL sync: `/?project=<id>`, persisted to localStorage
- Selecting a Project expands its folder and switches the active DB Project context. Project action menus and their dialogs are independent of folder disclosure, so interacting with those surfaces never activates the Project row. Selecting a Session synchronously unmounts the previous task page, mounts exactly one fresh selected task page plus that Window Session's two local panel groups, renders exactly one selected-route title/action set in the global titlebar, restores explicitly owned Composer/transcript/route presentation state, and clears the shared Session's unread flag. Background Codex execution and Main-owned Browser/Terminal runtimes continue through their stable managers without retaining hidden task DOM.
- Task search query is persisted per project and restored on space switching; search lives inside the active DB view tab toolbar for searchable DB views, while Calendar hides that search chrome
- `Cmd/Ctrl+F` opens a body-portal floating content search input for session content instead of panel-local search bars. Threads register the `conversation` domain, Review registers the `diff` domain with precise path/partial-hunk matching and a generation-fenced Git fallback, and active Browser tabs register the `browser` domain backed by the existing Electron `browser-sidebar-command` find bridge. The input seeds from a single-line text selection, uses Enter/Shift+Enter for next/previous, Escape or `Close find` to exit, stores at most 250 local matches while preserving the exact total, and cycles `conversation -> diff -> browser` while focused when a browser target is available. Settings search, DB task search, file tree filter, and jump-to-file remain separate scoped search controls.
- The global command palette has explicit modes. `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P` open root mode: commands remain visible, fuzzy subsequence matches receive character-level highlights, and local Chat and Page metadata joins after two Unicode query characters. Root mode concurrently adds bounded Page-body results, adds bounded app-server Chat history after three characters, and groups the result types as commands, Chats, then Pages. Pages ignore hidden Page-mode filters and fill only the `7`-row discovery budget left after command, Chat, and search-status rows; they have no separate result cap. Unsupported placeholder actions appear only in development as disabled rows with a `Mock` badge and are hidden from production catalogs. `Cmd/Ctrl+G` opens chat-only search across local project-backed/projectless/sessionless chats plus eligible server-only roots returned by app-server `thread/search`; Nodex enriches those hits with local Project/session/pin/status state when available and keeps local metadata results on server failure. `Cmd/Ctrl+P` opens Page search; current title/body hits come from generation/head-fenced Library Page Document projections, each candidate must be readable through at least one selected Project access context, and status comes from the Page's current Data Source. Results expose bounded excerpts through `pages:search` without loading full bodies. Local metadata remains visible during Page-body lookup, and an empty result is shown only after the exact query and Project scope settle. Page mode owns the trailing `Filter` popover and compact active-filter row beneath the input, using the same status/priority/tag/project-style pill language as the Database View toolbar while persisting those filter selections across reopen/reload. A leading `>` no longer switches modes. File search remains a development-only disabled mock until Nodex has a real file-search backend.
- App-window Back/Forward navigation is available from the top-left titlebar controls, `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, desktop mouse Back/Forward buttons, the command palette, and the macOS application menu. It navigates backward/forward through Window Session-owned Workbench context: the exact Project/Session/Pages/empty location plus every owner Scene's active panel surfaces, protected primary where applicable, collapse state, and right-panel full-width state. Pages surface presentation and location selection commit as one transition; first materialization and live title synchronization do not add phantom history entries. Agent Dock binding and composer-overlay visibility updates, settings, command palette, task search, and Browser webview history are not part of this stack.
- The command palette always includes `Back` and `Forward` commands with matching keyboard hints; those commands are shown disabled when there is no history in that direction. Browser-sidebar webview history is separate and does not drive these app-window controls.
- Desktop supports multi-window in a single app process (`Cmd/Ctrl+Shift+N`): each Window Session keeps independent navigation and Project/Session/Pages Scenes, including surface creation, close, selection, ordering, splits, panel geometry, and Project Agent Dock presentation, while all windows share the same Core-backed Project, Session, Thread, Page, Canvas, and Database data plus realtime invalidation. A Dock and a complete task page may observe the same canonical Thread in different windows without creating another execution runtime.
- When Nodex starts, the Settings -> General -> `Restore windows` policy decides whether to restore all retained window sessions, only the last focused session, or one fresh session
- Each restored window resumes its exact Project/Session/Pages/empty location, owner Scene snapshots, active panel surfaces, panel state, composer-overlay visibility, Project Agent Dock binding, open resource context, selected Thread context, Workbench layout, and saved window bounds.
- New Window first reattaches the most recently closed Window Session with its exact local identities. When no closed history remains, it flushes and clones the requesting Window Session as a one-time starting snapshot with reminted Scene-surface, split-node, Browser scope/runtime, editor-view, and unbound Agent Dock draft identities; bindings to real Sessions remain. Without a live source it creates a fresh Window Session. A targeted `Open in new window` always clones its source with the selected owner-location override and never consumes unrelated closed history.
- Back/forward navigation history is window-session-local and is restored only from that window's session storage; it is not part of the cold-launch resume snapshot saved when all windows close
- Desktop single-instance behavior is scoped per resolved Nodex home (`NODEX_HOME` or `[server].home`). Different Nodex homes can run at the same time (for example packaged release + dev build), while each Profile still enforces one process with many windows.
- Packaged macOS launches from outside `/Applications` show a native prompt to move Nodex into Applications, continue from the current location, or quit before the app runtime starts.
- Project-local Session identity, ordering, pin, archive, unread, no-thread fallback label, and optional Thread link are shared domain data in SQLite. A Main-persisted Window Session owns canonical layout v7 with Scene v5: exact location plus owner-keyed `WorkbenchSceneSnapshot` values whose shared composer-overlay visibility and right/bottom panel trees hold local surface descriptors, collapse, size, active leaf/surface, and ordering. Project and Session Scenes keep semantic primaries; Project Scenes additionally persist Agent Dock binding and unbound draft identity. The singleton Pages Scene has no primary and persists only ordinary trusted-Library content surfaces. Layout v6 migrates the active per-root Resource Scene into Pages, promoting its former primary to an ordinary tab and discarding dormant Resource presentations. Renderer-only state owns previews, transient focus history, and temporary side-chat tabs. Saving uses a monotonic `layoutRevision` with stale-write rejection and atomic file replacement. There is no Library route state, database-starter Session, or parallel per-Session layout map.
- Codex thread metadata lives in `codex_threads`, where `project_id` is nullable. Durable local chat ownership lives in `project_session_threads`, with exactly one Project-session owner per thread; Pages can reference or mention threads but do not own them. Attached session row titles use `threadName || threadPreview || noThreadFallbackTitle || "New thread"`; blank sessions use `noThreadFallbackTitle || "New thread"`. `noThreadFallbackTitle` is not a thread title authority. App-server `createdAt` and `updatedAt` values are compatibility-tainted source observations: a new UUIDv7 Thread uses its ID timestamp, normalized to protocol-second precision, as canonical creation evidence; an existing Thread keeps that creation time and advances recency monotonically with `max(createdAt, previousUpdatedAt, observedUpdatedAt)`.
- Sidebar rows use compact Project folder and session row chrome. The expanded fixed header starts with a `Nodex` product-name row and a right-aligned icon-only Search button, followed by the fixed New chat row; Search opens global Page search and exposes `Cmd/Ctrl+P` in its tooltip. Scheduled and Plugins lead the scrolling content instead of remaining fixed. Once content scrolls under the header, the New chat edge gains a subtle hairline divider and the scroll content fades beneath it; both disappear again at the top. View-local task search remains inside DB View toolbars. Project-scoped pinned chats appear first inside their own Project folder with regular chats immediately below; projectless pinned chats appear as standalone rows in Pinned, followed by pinned Project folders. Unpinned Project folders stay in Projects and projectless non-pinned chats stay in Chats. This pinned composition has no user-selectable layout preference. Project and task collections are real Core windows: a folded inactive Project reads no task rows, expansion or active Project ownership reads the first window, and `Show more` follows its opaque continuation instead of slicing a preloaded catalog. Project folder and Project child lists start at five visible rows, `Show more` adds ten rows per click, `Show less` resets to the first five rows, and the active row remains visible without consuming that page quota. Unread sessions show a left dot, read session rows expose trailing `Archive chat`, `Pin chat` / `Unpin chat` only on row hover, when the specific action button has keyboard focus, or open state, and no hover overflow menu button; pinned state uses the filled pin glyph. Other hover-only sidebar affordances do not enter the sequential Tab order unless this spec names them. Session rows open an Electron-native context menu from right-click without selecting the session. Session collection lifecycle is scope-local and data-first: one scope never supplies another scope's loading or error state, and cached rows or a confirmed empty result remain ready during background refresh. Project folders progressively reveal Sessions without a loading child row; a Project-scoped collection renders the indented `No chats inside` state, aligned with Session titles, only after that exact scope is confirmed ready and empty. `idle`, initial loading, and background refresh never masquerade as empty. The persistent projectless Chats section reserves `Loading chats...` for its genuine first hydration and renders `No projectless chats` once confirmed empty. An initial scope failure renders a compact retry action in that scope, including when a sidebar snapshot can still supply partial rows.
- A Project row has two independent controls in one stable composition: its visible label opens the Project Scene, while the leading Project marker becomes the disclosure chevron only when the row is hovered; the disclosure control may also reveal itself for its own keyboard `focus-visible` state. Focus retained by Project navigation and active Project Scene ownership never replaces the marker. Hovering the chevron adds a local highlight before it folds or expands Session children. The shared leading slot is optically inset without moving the Project label out of alignment with Session titles. Selecting a Project never selects its first Session, and folding a Project never navigates away from the selected Scene. Exact Project hydration, not the currently loaded bounded child window, determines whether a restored Project Scene still exists.
- Active session rows open `Rename chat` when the row receives a title-target double-click. The same dialog is reachable from the session context menu, the active thread header actions menu, the command palette command `renameThread`, the macOS application menu item `Rename chat`, and `Cmd/Ctrl+Alt+R`. The dialog uses `Rename chat`, `Keep it short and recognizable`, placeholder `Add a title…`, `Chat title`, `Cancel`, and `Save`; it submits the raw input value. Manual session/thread rename sanitization trims outer whitespace, folds internal whitespace, treats empty results as no-op, and truncates over 60 characters to 59 characters plus `…`.
- The session row context menu order is `Pin/Unpin`, `Rename`, `Archive`, `Mark as unread`, `Reveal in Finder/File Explorer/File Manager`, `Copy` (`working directory`, `session ID`, `deeplink`), `Fork` (`local`, `new worktree`), and `Open in new window`; the native archive action id is `archive-thread`. Archiving is non-destructive, optimistically hides the sidebar row, clears pin/unread state, and archives the linked Codex thread when one exists. Snapshot-only Codex sidebar rows archive through the Codex thread archive channel. `Copy deeplink` uses `nodex://sessions/<session-id>`. `Open in new window` seeds the requesting layout with the exact Session owner location.
- Collapsing the Workbench sidebar: width defaults to `300px`, is clamped to `240..520px`, persists under `sidebar-width`, and the explicit `Hide sidebar` / `Show sidebar` trigger, command palette command, native menu item, and `Cmd/Ctrl+B` shortcut all use the same `toggleSidebar` path. The real sidebar closes through an animated progress spring, remains mounted until progress reaches zero, moves the left titlebar controls from the same animated width, and snaps under reduced motion. During expanded-sidebar sash resize, raw widths from `120px` through `239px` keep the sidebar open at the `240px` minimum; only raw widths below `120px` collapse it. The collapsed sidebar auto-reveals only from the inclusive left-edge pointer strip `0..12px`, including while a full-width right panel is open. The floating sidebar remains visible while the pointer stays inside the current sidebar width, while keyboard focus remains inside the floating sidebar shell, or while its resize sash is actively dragging, then hides when those holds are gone. The floating sidebar can be resized from its right-edge sash; its width clamps and persists like the expanded sidebar, but dragging below the minimum clamps to `240px` instead of expanding/collapsing the real sidebar. Focus inside right or bottom panel controls must not reveal the sidebar.
- Sidebar footer keeps a compact Settings button at bottom-left and no workspace switching controls. Its bottom-right account slot stays empty until the Codex account snapshot hydrates, then shows `Sign in` for a signed-out account or the authenticated quota indicator when signed in.
- Settings opens a full-window settings route shell, not a modal dialog or overlay. It replaces the normal workbench body with a left navigation rail, a `Back to app` affordance, and one active section page at a time instead of a single scrollspy document. The settings rail owns only settings navigation, preserves the same renderer-transparent native vibrancy as the normal sidebar, and leaves each section to render a full-width `main-surface` pane with the settings content centered at the established settings width. The shell is canonical-path driven: top-level pages use `/settings/:section`, Browser detail pages use `/settings/browser/<detail>`, and Browser overview subsections use hash anchors such as `/settings/browser#permissions`; unknown paths fall back to the default visible page without rewriting the URL or accepting legacy aliases. On desktop, the settings rail groups sections and includes a local `Search settings…` field below `Back to app`; `Cmd/Ctrl+F` focuses and selects it, `Escape` clears it, Arrow Up/Down wraps highlighted results, Enter selects only a highlighted result, and selecting a result navigates to the owning top-level page without clearing the query. The search index is generated from a normalized renderer catalog of section titles, subtitles, group headings, setting row labels/descriptions, option labels, aliases, and hidden runtime Project-name terms; Browser child terms contribute to the Browser result but do not create independent search owners. The current top-level pages are `General` (`Permissions`, `General`, `Composer`, `Files & links`, `Notifications`), `Import`, `Appearance`, `Agent` (raw `config.toml` configuration), `Keyboard shortcuts`, `Browser` (`General`, `Autofill and passwords`, `Extensions`, `Downloads`, `Permissions`, `Site permissions`, `Developer mode`, with detail pages for `Password manager`, `Contact info`, `Browsing history`, `Extension manager`, and `Download history`), `Computer use`, `Hooks`, `Git`, `Environments`, `Worktrees`, `Pages` (`Cards & Page Stage`, `Block import`), and `Backups`. `Sans font size` defaults to `15px`, persists locally, updates `--vscode-font-size`, and scales the shared sans typography tokens used by the renderer; `Code font size` defaults to `14px`, persists locally, and sets `--vscode-editor-font-size` globally.
- Settings' desktop navigation groups the canonical top-level pages as `Personal` (`General`, `Import`, `Appearance`, `Agent`, `Keyboard shortcuts`), `Integrations` (`Browser`, `Computer use`), `Coding` (`Hooks`, `Git`, `Environments`, `Worktrees`), `Workspace` (`Pages`), and `Data & recovery` (`Backups`). The route catalog owns the stable section id, page key, group, label, search catalog, and app-owned icon for each entry. Browser subsections and detail pages belong to the Browser page and never occupy independent rail entries; the rail preserves canonical section hrefs, while search navigation keeps its query and targets the owning page/anchor.
- On macOS, traffic-light window controls stay visible at top-left; when the sidebar is expanded, the sidebar collapse control plus Back/Forward controls sit beside them in the sidebar top strip, and when collapsed the titlebar left region reserves `208px` for the sidebar toggle, Back/Forward, then a compact `New chat` button before the thread title section.
- Page Stage selection lives in the selected Window Session Scene's right-panel tab groups; leaf tab strips support hover tooltips, close, wheel-driven horizontal scrolling when tabs overflow, pointer-only drag reorder, cross-leaf surface moves, and edge-drop splitting through the shared tab strip/tree.
- Settings can choose which optional Page Stage rows start behind the `more properties` toggle (`Tags`, `Assignee`, `Threads`, and `Schedule`).
- Terminal is a Window Session-local descriptor that defaults to the bottom panel, starts from the active Session/Thread cwd before falling back to the Project primary source, and can be moved to the right panel. Page Stage may request a Session-context terminal, but Pages cannot own terminal tabs or PTY IDs.
- Scheduled is a Workbench-owned route opened from the sidebar, command palette, and floating summary Scheduled row while the normal Project/Session sidebar remains mounted. Rust Core is the only authority for versioned definitions, RRULE scheduling and jitter, due leases, run/inbox/read/archive state, occurrences, and reminders; the Host owns external Codex execution and OS notifications. The route provides task/template tabs, search, list, create, edit, Pause/Resume, Run now, delete confirmation, a peer detail rail, Project/environment/model/reasoning/schedule controls, and previous-run actions. Cron drafts require a name, prompt, schedule, Project, and model; heartbeat drafts require a name, prompt, schedule, and local task. Existing edits autosave after a short debounce and route changes first flush a valid dirty edit. `automation_update` can list/search Core definitions, view one, create/update/delete directly, or return suggested changes for user review; direct heartbeats reject unknown/non-local task targets and all mutations share the same Core revision fence and renderer invalidation event. Suggested cards remain render-only until accepted. The active Scheduled collection has a 200-definition domain bound enforced at creation; deleted history remains available through its bounded Core window. The route keeps selection in `/automations` search params, and deleting a definition atomically removes its owned run rows.
- When the Agent provider catalog is available, Scheduled's Model and reasoning control replaces the legacy OpenAI-only list with provider-scoped models from OpenAI, Anthropic, Kimi For Coding, Moonshot, and OpenRouter. Core preserves the exact provider/model/recommended-harness/reasoning tuple, including case-sensitive values such as Kimi `Thinking`; unavailable credentials disable that provider for scheduled-task creation. The old `codex:model:list` behavior remains only as a compatibility fallback when the provider catalog is unavailable.
- Run lifecycle changes broadcast an automation-run update event so Scheduled rows, the automation-run inbox, and the sidebar/recent thread snapshot stay synchronized after scheduled execution, run-now, archive/delete/read actions, and tool-driven deletion.
- Process Manager is a Workbench-owned dialog opened from the command palette `Process Manager`, `Ctrl+Alt+M`, and the floating summary panel `Tasks` section action. It lists Nodex's registered background-process rows for known attached chats, joins currently live app-server background terminal snapshots and terminal-action sessions for status/output data, polls only while open, freezes the visible snapshot while a row action menu is open, sorts live rows by CPU then memory, and keeps previously registered but currently missing processes visible as `not-found` rows. App-server terminal rows use app-server CPU/memory/pid data; local terminal-action rows use the terminal session OS pid and leave CPU/memory unavailable rather than inventing metrics. `Open output` focuses the owning chat when needed and opens a right-panel `Process output` tab that follows the matching command item's live output or the registered terminal-action session buffer. Floating summary `Tasks` rows open the same output tab directly. `Start` and `Restart` are available for registered rows with a command and working directory, create or refresh a terminal-action session, and refresh the row's start time. Restarting a live app-server process stops that process before starting the terminal action. `Stop` handles either a live app-server process id or a terminal-action session.
- Native remote-hosted presentation is owned by the desktop host. A completed
  Browser `node_repl` item may publish a static screenshot PiP, while the
  Computer Use service may publish a live native layer during an app action.
  Either may remain visible while its corresponding Browser right-panel tab is
  retained and collapsed. PiP is suppressed while that Browser surface is
  visibly presented, follows the owning window between workspaces, avoids the
  thread viewport's registered obstacles, and is dismissed at turn completion,
  privacy termination, Browser release, window teardown, or app shutdown. Its
  maximum display size is Profile-local persisted preference; transient
  placement, visibility, cursor, and pet state are not transcript or Scene
  authority. The floating summary panel exposes a headerless `Computer Use` row
  only while the host reports an active toggleable PiP stream, and its `Show
  PiP` / `Hide PiP` action changes the host request rather than opening the
  Browser panel.
- The session thread page is a live Codex workspace in Electron. Without an attached thread, it shows a centered new-chat home headed `What should we build in <project>?`; the inline selector renders the Project name as heading text without its marker and shares state with the lower composer project selector. The sticky composer exposes add-context, Plan mode, permissions, model/reasoning, dictation, send controls, a project selector, and a `Start in` selector in the attached lower status strip. The `Start in` selector supports `Work locally` and `New worktree`; cloud, connected-app, and suggestion rows stay hidden until those backend paths are intentionally added. Submitting the first prompt starts a session-owned Codex thread and stores the link in `project_session_threads`; if the selected Project differs from the current blank session's Project, Nodex first reuses or creates a blank session owned by that Project, then starts the thread there so session/Project ownership remains valid. The `Chats` section header exposes `New projectless chat`, which creates a blank session with `project_id = null`; its project selectors show `No project`, and its only run target is `Work locally`. Projectless chats remain available after Profile bootstrap even when every Project is archived, while a truly empty catalog is resolved by automatic source-backed initial Project bootstrap before Workbench mounts. Nodex does not allocate a filesystem directory until that blank session's first prompt is submitted. While a first prompt is starting, the session owns a runtime `threadStartProgress` state so navigation away and back still shows startup or failure instead of `No messages yet`. For a direct local start, the initiating window keeps the blank composer surface mounted after the durable Session link is written, adopts the new thread without issuing `thread/resume`, and synchronously commits the first optimistic user turn before revealing the attached transcript. The submit action returns at that optimistic-visible boundary instead of waiting for `turn/start`; the exact prepared input, attachments, model/settings, and `clientUserMessageId` are reused for the one real background request, whose response rebinds or fails the same optimistic turn. Once that visible turn exists, the normal transcript takes over. Project `Work locally` uses the selected Project's primary source when one exists, otherwise a generated per-thread local workspace, and relies on the composer send-button pending state until the first turn is visible. `New worktree` requires a Project primary source, creates a managed Git worktree, runs the selected local-environment setup script when configured, starts `thread/start` and `turn/start` in that worktree cwd, streams setup/log progress until the first turn takes over, and links the resulting thread to the owning session with both its cwd and managed worktree path. Thread-id attachment storage remains available at the transport layer, but the workbench header does not expose an attach/detach thread button.
- While the latest turn is streaming, reasoning summary and tool activity are
  separate presentation inputs. Reasoning stays hidden from tool topology and may
  supply the latest open group's `thinking` header or one standalone shimmer row;
  it never contributes to an active tool label, a completed tool summary, or an
  expanded tool body. A trailing visible assistant commentary closes the main
  activity slice, but may derive a post-assistant standalone fallback until final
  answer output or later post-assistant units take ownership; commentary followed
  by later tool activity remains inside that later activity sequence. An ordinary
  in-progress `fileChange` with no materialized change or visualization remains in
  canonical lifecycle state but creates no patch activity. The same stable item
  begins showing `Editing files` only after a real change materializes. This live
  presentation remains independent from `Edited files, read files`, turn diff,
  Review capability, and Projectless scope.
- Fresh projectless chats receive a host-allocated workspace at `~/Documents/Nodex/YYYY-MM-DD/<ascii-slug>/`. The thread directory is the process cwd; `work/` holds scratch analysis, scripts, drafts, and temporary assets, while `outputs/` holds user-facing deliverables. The collection root `~/Documents/Nodex` is the task's persisted workspace/browser root and runtime writable root, and the persisted output hint is `<cwd>/outputs`. The initial `My Project` source may be a descendant of this same collection root; Nodex does not carve it out of Projectless writable authority, and path containment never determines an existing Thread's Project owner. Slugs use only lowercase ASCII letter/digit runs, keep at most six prompt words, truncate to 80 characters, and fall back to `new-chat` when no ASCII token exists. Directory collisions use deterministic numeric suffixes before unique suffixes. If child-directory creation fails after the thread directory exists, Nodex keeps the thread directory and uses it as both cwd and output directory rather than rolling back the allocation.
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
  - Review opening is adaptive to the attached Session: projectless conversations may open a session-scoped Review when a valid turn/diff target exists, while missing/filtered-empty targets omit the Review action and preserve the live patch/activity rows; no trailing Review control is rendered as a silent no-op
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
  - request-user-input preset options are activation actions: click, `Enter`, `Space`, and number keys advance after a short acknowledgement or submit the final answer directly, while approval/permission/authorization and private picker forms retain explicit confirmation; renderer-memory drafts survive remounts for the same typed request identity and clear when that request resolves or its app-server generation disconnects
  - main owns ordinary user-input auto-resolution independently of the renderer lifecycle: focused visible presentation waits for one minute of inactivity before a 90-second countdown, background or fully obscured presentation starts that countdown immediately, every request-card interaction—including Dismiss and Escape intent—snoozes the timeout before choosing an outcome, and expiry becomes terminal before responding with an empty answer set rather than a selected default
  - setup onboarding is a three-step request family: role uses a shuffled multi-select catalog with `Something else` fixed last and persists canonical role IDs; task derives up to three interleaved role-specific first-task suggestions plus a freeform path; context recommends connected Google Drive, Slack, and Gmail sources when available and returns ordered, deduplicated source IDs on Continue, while Skip and Dismiss return no sources
  - blocking active requests and background child approval/permission requests replace only the composer editor/footer controls until the request surface is cleared; the background child request is shown before the active-thread request, both may coexist, and a child's private picker/setup/input request does not hide its approval/permission request; existing-thread request surfaces do not render the new-chat-only lower composer status strip
  - reopening an existing thread tab first enters a resume shell state; the mounted transcript and composer stay hidden until the active conversation reaches `resumeState = resumed`
  - reopening a completed thread after app restart now resumes through the main-process conversation manager only, without session bootstrap, rereads, or transcript re-merges
- Thread stage project context is stage-local (`threadsProjectId`) and remains stable when DB datasource changes
- Desktop notifications use one Main-owned lifecycle pipeline: `CodexService` emits exact typed occurrences only after canonical app-server commitment, `CodexThreadNotificationCoordinator` applies settings/focus/presentation/host policy and selects one renderer, `DesktopNotificationManager` owns native instances, and notification actions enter renderer navigation through `WorkbenchCommandIngress`.
- Detailed desktop-notification rules, payloads, suppression semantics, and action routing live in [Desktop Notification Behavior](./desktop-notification-behavior.md).
- Desktop notifications remain separate from the in-app global toast system: desktop notifications are OS-level and main-owned, while in-app toasts are renderer-local, transient, and shown in one top-centered global overlay.
- Settings -> General -> `Notifications` exposes three independent controls: `Turn completion notifications` (`Never`, `Only when unfocused`, `Always`), `Enable permission notifications` (boolean), and `Enable question notifications` (boolean). Defaults are `Only when unfocused`, permissions enabled, and questions enabled. The OS notification permission remains independent from these app-level preferences.
- Turn-complete notifications are local-host only and accept completed, failed, and interrupted terminal states. Policy suppresses automation/heartbeat `DONT_NOTIFY`, real child provenance, realtime-voice turns, exact terminal-specific pending continuations, disabled mode, and foreground app focus in `Only when unfocused` mode. Queue loading/unpaused state does not suppress interruption, an active goal suppresses completion only, while a still-running merged turn, collaboration agent, or descendant suppresses every terminal state; pending steer alone does not suppress. Ephemeral, system-source, and side-conversation identity alone do not suppress a top-level task.
- Approval/input notifications ignore turn mode and suppress only when their exact conversation is actually presented in a foreground renderer. The current producer is Nodex's singleton local app-server host; host-qualified occurrence/action contracts preserve the boundary for a future real host source without fabricating remote lifecycle events. Command/file approvals expose `Approve`, `Approve for session`, and `Decline`; permissions approvals and all input notifications are open-only. Supported option/onboarding/incomplete setup inputs can notify even with zero question rows.
- Real children identified by a direct parent or app-server thread-spawn provenance never emit turn, approval, permission, or input notifications. A child's request is not promoted to the parent.
- Opening a desktop notification focuses its selected live window and navigates to the task. Side-conversation callbacks navigate through the parent path and activate/materialize the existing `sidechat:<threadId>` tab. Button/reply actions navigate without forcing focus; reply uses the exact host, and approval revalidates the live canonical request method after navigation so stale callbacks fail closed.
- Every raw request-resolution occurrence and foreground presentation dismisses matching native notifications. Stable public native IDs coexist with strict internal family/host/conversation/scalar occurrence identities, preventing numeric/textual request-ID or cross-conversation collisions while preserving exact notification/conversation/path cleanup. Callbacks and native failure cleanup are idempotent, approval/input notifications never time out, Main sanitizes only visible notification text, reply input preserves user Markdown, and system notification permission remains independent from app-level notification preferences.
- Packaged macOS builds can check for stable app updates on launch in the background, download them automatically when found, expose a manual `Check now` action in Settings -> General -> `App updates`, and expose `Check for Updates…` in the macOS app menu. Once an update is ready, `Restart to Update` installs it immediately through the normal flush/shutdown path; if the user keeps working, Sparkle may install the ready update after a later normal app exit.
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
- In Electron, startup opens into a flat blocking surface with the shared
  shimmering Nodex mark until the renderer has both native Core readiness and
  its window bootstrap. Ordinary opening copy stays visually quiet for 1.8
  seconds. Only a versioned advisory event emitted by the authoritative Core
  after it has classified a supported older Store can switch the surface to
  `Updating local data…`; fresh/current Profiles and incumbent reuse never
  present migration messaging. When retained history is being rebuilt, Core
  reports a bounded monotonic completed/total count and the surface shows that
  real percentage; it never estimates progress from elapsed time. `store_ready`
  immediately changes the copy to `Opening workspace…`, so completed Store work
  is not presented as an ongoing migration. Fresh Profiles are exact Rust-owned
  v109. Exact frozen TypeScript v26, both v57 variants, v68, v82, and v83
  Profiles are backed up and converted in isolation to the frozen v84 handoff;
  direct v84 and exact Rust-owned v85 through v107 Profiles are also accepted.
  Core validates the complete
  inventory and content before one-way v109 publication. v102 introduced the
  LocalCommit ledger, v103 its composite Store identity, v104 canonical
  evidence hashing, v105 immutable Manifest/authorized packet separation, v106
  Projection scope heads, v107 exact child-key indexes for Block Project-key
  cascades, v108 immutable scoped revocations, and v109 resource-atomic
  delivery, complete Projection audiences, opaque Relation edge identities,
  and sealed mutation finalization. Unfrozen same-version lineages, drifted, ambiguous, future, or
  damaged Stores fail closed while HTTP, schedulers, and windows remain
  unavailable. Repeated failure against identical source bytes retains one
  content-addressed migration backup. Long but active migration phases emit a
  private heartbeat without fabricating user progress. A silent, malformed, or
  cancelled pre-ready candidate is terminated and awaited as one process group;
  it cannot retain the Profile lock after the launcher reports failure or the
  App begins shutting down. A renderer bootstrap failure leaves the loading
  state and presents an explicit restartable failure surface.
- While Nodex remains open, its authenticated Host connection and global event stream keep the detached per-Profile Core active. If that Core process nevertheless exits or drains, the Desktop Host automatically selects and authenticates a replacement generation for the same Profile, Library, and Store epoch; existing windows, adapters, event cursors, open Documents/Canvas surfaces, and background schedulers continue through stable logical connections. Rebinding does not consume a new Core client slot, a committed edit can find its receipt after its response and physical connection are lost, and background claims returned during recovery are deferred without starting user-visible work. Closing Nodex fences a recovery already in flight. Brief recovery presents one compact app-wide `Reconnecting to Nodex Core…` status. A crash loop pauses automatic recovery and presents one `Nodex Core is unavailable` status with `Retry` and `Restart Nodex`; individual views do not accumulate duplicate transport errors. Store restore or authority identity drift never hot-switches and continues to require a full App relaunch.
- Project ID: opaque UUID generated server-side. Legacy slug IDs resolve through aliases, but responses return canonical UUIDs.
- Project appearance is durable Project metadata owned by Core: one of eight constrained colors plus either one of the canonical named markers or a normalized legacy emoji. Every Project surface renders the same appearance. Create/Edit stages appearance with name and sources and saves them atomically; Cancel discards every staged field. The sidebar hover card can change appearance immediately with optimistic, serialized persistence, and the pending or confirmed marker stays synchronized across Project lists and an open Project Scene.
- Project sources: ordered source folders persisted separately from the project row. The first source is the primary workspace root for Git, Files, Review, local thread cwd, and managed worktree base repository; all configured sources are writable workspace roots for sandboxing.
- Empty-source projects are valid Nodex data containers. Work-local thread starts allocate a generated per-thread workspace; managed worktree and local-environment flows require a primary source and surface a clear error when missing.
- Sidebar project rows do not show the source path inline. Each project row actions menu exposes, in order and without separators: `Pin project`/`Unpin project`; `Reveal in Finder` only when the project has exactly one source folder (no inline path); `Create permanent worktree` when the primary source is a Git repository; `Edit project`; `Mark all as read` only while the project has unread chats; `Archive chats` (disabled when nothing is archiveable); and a plain `Remove`. Removal is independent of whether the Project's durable primary resources currently appear in Pages.
- Hovering a sidebar Project row opens an interactive Project detail card after a deliberate 700 ms delay; keyboard focus opens it immediately. It stays open while the pointer crosses into the body-portalled card or its inline marker picker, closes after a 100 ms safe-leave delay, and supports a 300 ms warm handoff between peer rows. The card shows the canonical marker and inline-renamable name, pin state, complete Project activity counts independent of loaded task pages, optional Git repository identity, every ordered source root, and `Edit project`. Source rows open the actual local path in the platform file manager. Opening menus, dragging, or interacting anywhere in the card or registry-owned dialog cannot fold or expand the Project group; a floating auto-revealed sidebar remains visible while one of its cards is active.
- `Edit project` opens one dialog owning the project marker, name, and ordered source folders: rows show the folder name with the full path on hover, the first folder carries a `Primary` badge when several exist, other rows expose `Make primary` (moves the folder to the front) and every row a remove control. `Add folder` opens a multi-select native picker; folders can also be dropped onto the list; duplicate folders (case-insensitive) collapse to the first entry. Saving writes appearance, name, and folder order together; the dialog footer also hosts `Remove project`, `Cancel`, and `Save`. `Archive chats` confirms, archives the project's chats in small batches, and reports success/partial failure; `Mark all as read` clears unread state without confirmation.
- The left sidebar has one fixed lane-aware pinned projection. Every project-scoped pinned chat renders at the top of its own project folder, before that project's regular lane; moving it to another project folder preserves pin state unless it is dropped explicitly into the regular lane. Each regular lane starts from stable last-activity order and projects that scope's persisted Manual order only into slots belonging to tracked durable thread IDs. New, temporary, and otherwise untracked rows keep their activity-derived slots until a later manual drag reconciles them; selecting or loading a session cannot rewrite this order. A manual reorder changes only sidebar order authority and publishes a refreshed sidebar snapshot; it does not rewrite or refetch project-session layout. Pinning changes lanes without deleting the thread's project manual identity, so unpinning can return it to the same tracked position. Starting a move leaves the visible project-folder list intact and enters the drag preview without reloading the renderer. While reordering within a lane, crossing a row midpoint updates the insertion indicator even when the hovered row does not change; dropping a visible non-no-op indicator commits that order without reloading or crashing the renderer. Persistence failures restore the authoritative order and show an error. Projectless pinned chats render as standalone Pinned rows, and pinned chats with a temporarily unknown project fall back there. Pinned project folders render in Pinned with both of their project-local lanes; `Projects` renders unpinned project folders; and `Chats` renders projectless non-pinned sessions. If there are no projectless/fallback pinned chats or pinned project folders, the Pinned section header is hidden.
- `Pages` appears after optional Pinned and before Projects. It is a bounded, flat projection of active top-level Page, Database, and Canvas roots that currently need an entry outside Projects; it is not the complete Library ownership tree. A non-archived Project's canonical primary Database and deterministic primary Canvas are omitted before count and pagination because Projects already represents them. Archiving that Project makes the durable roots eligible again; restoring it hides them again. Ordinary read/read-write grants never hide a root. Data Sources, Views, nested Pages, ordinary body Blocks, references, and Database row Pages are not sidebar rows.
- Pages uses the same section, row, leading-slot, action-rail, focus, active, and pager primitives as Projects. Page, Database, and Canvas use the shared `PageIcon`, `DatabaseIcon`, and `CanvasIcon`; Page identity uses the same geometry as File identity. Up to five eligible roots are initially visible. `Show more` appears only when a sixth loaded item or a real source continuation exists, expands in place, and shares Projects' focus restoration and `Show less` behavior. The section has no `Open Library` action and there is no Library Home route. Its header plus creates a root Page or Database and immediately opens it in Pages.
- Selecting any Pages row opens or focuses its semantic resource tab in the window's singleton Pages Scene. It never selects a Project, creates a Session, or infers navigation from a resource grant. All top-level roots, nested Pages, Database row Pages, selected Views, and referenced Canvases share one ordinary tab/split tree. Switching tabs derives the highlighted sidebar root from the active target's canonical Library path. Explicit `Open in Project` remains a separate grant-and-transition action.
- The Pages tab-strip plus opens a search-first Library catalog picker for active Page, Database, and Canvas targets, with New Page and New Database footer actions. Selecting an already-open target focuses its existing tab. The empty Pages Scene presents the same chooser. Exact Database Views continue to open from in-resource navigation until the Library catalog exposes View entries.
- Pages Scene Page, Database, Canvas, property, and Document operations use trusted local-human Library authority. Every shared Page/Canvas editor operation preserves the mounted surface's explicit access context through renderer transport and Main; the current Scene and any private compatibility Project are never authority inputs. Core resolves a schema-required compatibility storage/event-ledger Project inside the serialized writer, independently of caller authority, and an archived compatibility Project does not block local Library writes. Public renderer results identify `accessContext: library` and do not expose a private compatibility Project. New Untitled Pages focus their collaborative title. A Database opens its durable default View unless an exact View was selected, and uses the same Database View controller/presenter, search, group pagination, mutations, Page opening, and toolbar composition as ordinary DB View tabs; there is no Library-specific board. Canvas uses the shared Canvas Stage without selecting its compatibility storage Project.
- The fixed App Header publishes `Pages / <root>` and, when a child tab is active, `Pages / <root> / <child>`. `Pages` is context text rather than a link to a nonexistent Home. The authoritative Library path supplies root identity and title while the selected surface supplies the live child title. App-window Back/Forward and Settings/Automations return transitions restore the Pages location together with its exact active tab and Scene layout.
- `Manage access` opens one all-Project matrix for the selected Page or Database. Each row shows effective `No access`, `Read`, or `Read & write` together with any parent-Page, owning-Database, or primary-Database source. The control edits only the exact direct grant: inherited access is a visible floor and removing a direct grant never claims to remove it. Active Projects may add, change, or remove direct access; inactive and archived Projects may only remove an existing direct grant. `Save changes` commits the bounded draft atomically with per-grant revision fences, while Cancel writes nothing. `Open in Project…` and Library-to-Project drag remain separate single-target flows and require explicit recursive `Read` or `Read & write` confirmation. Equal direct grants produce no duplicate write. Access actions do not move the resource or rebind a Project's primary Database. Within Library, Page/Database drag and `Move to…` change only exclusive ownership and preserve stable IDs and owned Documents; View rows cannot move.
- Sidebar project headers can be reordered by dragging the project-label activator. Pointer drag starts after 6px; the row midpoint selects a before/after insertion boundary, refreshed on both drag move and drag over. The source remains as an inert 20% ghost, sibling projects stay fixed, and a compact body-level overlay follows the pointer. A zero-height 2px line with a leading outlined dot marks the final boundary. Normal project groups persist their order in `project_order`; pinned project groups render inside the single `Pinned` section above Projects and persist their order in `pinned_project_order`. Semantic no-ops do not write, and failed writes clear the matching optimistic order and show the shared reorder error.
- Dragging a normal project header onto the pinned section pins that project and leaves normal project order unchanged. The Projects section excludes pinned projects while preserving their normal order for later unpinning.
- After Profile bootstrap, the Projects header exposes compact actions: the project-group action is hidden when it does not apply, shows `Collapse all` when more than one visible project folder is expanded, and then shows `Reopen previous` to restore that previous expanded set after collapsing all; `Project sidebar options` contains `Archive all chats`, the fixed `By project` organization, and the fixed `Manual order` sorting contract, with no pin-specific organization control. `Manual order` is not a pinned-layout mode. The pure-plus `Add new project` action opens `Create project` directly, with no intermediate creation menu. The dialog reuses the marker, name, and ordered source-folder editor from `Edit project`; its empty source panel opens the multi-select native folder picker and also accepts dropped folders. Source selection is optional. When no source is selected, the Desktop Host sanitizes the entered name (falling back to `New project`), creates the first collision-free folder in the system Documents directory (`Name`, `Name 2`, `Name 3`, …), initializes it as a Git repository when Git is available, and binds it as the Project's source. When folders are selected, creation stores them in order and an omitted name is derived from the first folder's basename.
- Removing a Project archives only the execution context plus its Database binding through the serialized Core writer. Before commit, the Desktop Host discovers every Project-owned Thread (including unlinked child/subagent Threads) and checks active turns, pending requests, live terminals, and running background processes; any blocker or inspection failure leaves the Project unchanged and is explained to the caller. A shared per-Project admission gate serializes the final preflight/Core commit with new Terminal and Codex turn starts across IPC and HTTP. A committed removal excludes the Project and its chats from ordinary navigation, rejects new Project-owned Sessions, Thread mutations, terminals, and execution work in Core, closes Browser ownership and discards exited Terminal snapshots best-effort, retains historical Sessions/Threads as read-only, and leaves source folders plus every Library Page, Database, Document, asset, and durable identity untouched.
- `Project sidebar options` always exposes `Removed projects…`. Its lazy manager lists archived Projects, their source roots, and per-row restore actions. Restore preserves the Project ID, Sessions, Threads, and source configuration, increments the binding revision, recomputes current access, and appends the Project to active Project order without reordering survivors. Window Session-local views remain presentation state and re-resolve their targets after restore. If the active Project is removed, selection moves to the adjacent surviving Project; after the final Project is removed the Workbench enters an explicit projectless state rather than inventing a fallback Project. Permanent content deletion remains a separate Library resource operation.
- Codex thread links are session-owned. Cards can mention threads and send selected content to chats, but they do not own durable Codex threads.

#### 2. Kanban Board View
- 8 columns representing workflow stages
- Drag-and-drop Database Pages between columns
- Each kanban column header includes a `more actions` popover for collapsing that column and adjusting its persisted expanded width; collapsed columns still show their card count and the same `more actions` trigger
- Kanban's column-header plus, in-flow `New page`, and auto-collapsed empty-column surface all open one app-owned Page composer bound to the exact Project, Database View, panel tab, and Board surface that launched it. Its lifetime is independent of the mounted Board: switching or unmounting that Board does not discard the draft or sever submit authority, another Board cannot close it, and a repeated open request focuses the existing composer instead of replacing its state or showing a duplicate-draft toast. The app-level Create Page command uses ordered default bindings `C` and `Cmd/Ctrl+Shift+C`. A window-scoped capability registry resolves an explicitly active writable Board first, the most recent writable Board interaction within the active Project second, and the active Project's prewarmed durable default Database View otherwise. It never guesses from another Project or queues a command while the default View is loading. Missing Project/default View, loading, read failure, and read-only authority disable the Command Palette row with a reason; a bare shortcut silently fails open and does not consume the character.
- App-level keyboard ownership belongs to the deepest interaction surface. Workbench observes keydown in window bubble phase after inputs, contenteditables, editors, Dialogs, Dropdowns, Popovers, and Terminals have handled or stopped it; consumed events, IME composition, and repeat events do not create. Only a ready command that accepts the composer request consumes the event. An expanded pure-text selection from a non-editable, non-local surface is whitespace-normalized and bounded to the Page title limit as the new draft's initial title; editor/input selections, HTML, collapsed selections, and cross-boundary selections are ignored.
- A writable active Board exposes one contextual keyboard action capability to Workbench. Pointer hover is only a transient surface tint; pointer down and `J`/`K` or arrow navigation establish a keyboard-active Page independently from multi-selection. Keyboard activity uses one quiet blue perimeter, while selection uses the stronger perimeter and tint instead of stacking a second halo. A Page currently presented by an active Page Stage in any other visible tab group carries an independent short inset blue rail; background tabs, collapsed panels, and leaves hidden by maximization do not count as presented. The rail composes with keyboard activity and selection without replacing or duplicating either state. `Space` provides tap-to-toggle and hold-to-preview Peek, `Enter` opens a durable Page Stage, `X` toggles selection, and `Escape` clears selection before closing Peek. Status, priority, estimate, and tag shortcuts reuse the same portalled property menus and mutation paths as pointer controls. Keyboard reordering reuses the Board's drop-intent compiler and receipt-backed optimistic move path rather than directly rewriting renderer order. `W` then `O` starts a new chat from the highlighted Page. These actions fail open when no Page/capability is available and never cross an editable, Dialog, Popover, Dropdown, or Terminal boundary.
- The compact composer is upper-anchored and writing-first. Project context and `New page` share a 52px header with explicit Expand/Collapse and Close controls. The 18px title and canonical NFM description form one flat writing plane with the same inline start; non-composing title `Enter` moves directly into the description, whose shared normal-style placeholder is `Add description...`. Expanded mode grows the same mounted editor and preserves its content, selection, and undo authority. Status and only the canonical Priority, Estimate, and Tags properties present in the current Data Source schema render as compact pills with legible 16px semantic glyphs; missing or type-mismatched properties are neither shown nor submitted. Status, Priority, and Estimate open the shared body-portalled searchable semantic property picker, use field-specific `Change …` search prompts, highlight/check the current choice, and consume Escape before the parent dialog. Nullable semantic fields expose explicit `No priority` and `No estimate` actions instead of embedding empty values among real options. The property strip and footer use spacing instead of section dividers.
- One successful submit commits title, NFM body, workflow status, supported properties, selected existing tags, and newly named tags through the shared Page lifecycle create command. `top`, `bottom`, and `before Page` are explicit Core placement intents resolved against the complete logical same-group order in the create transaction; they are not inferred from bounded preflight rows. Unpositioned active Pages remain valid logical anchors, and the first explicit placement atomically materializes their persisted order. The command re-resolves the exact View store and rechecks write compatibility even if the source Board has unmounted. Its optimistic Page remains at the requested position until the same-epoch View projection covers the durable receipt and the loaded window materializes that Page; a Page created beyond the loaded tail stays visibly pinned instead of disappearing. Canonical identity, fields, and order then replace it in one transition, and a lagging detail read cannot roll back or locally reinsert it. Failure leaves the complete draft and a wrapping alert visible; while pending, Close, Escape, outside presses, expand, and repeated submit are disabled. `Create more` clears only title/body after success, retains Status/property choices and layout mode, and treats the resulting empty draft as the new clean baseline.
- Closing a modified draft by Close, Escape, or outside press is immediately reversible through a 10-second `Page draft closed` info toast. It uses the shared compact severity shell, icon, dismiss control, and action slot rather than a composer-specific surface. The toast's icon, copy, action, and dismiss control share one vertical axis, and the actual toast footprint is excluded from Electron's native window drag region so every action remains clickable at the top of the window. Restore captures only title, canonical NFM, Status, supported property values, `Create more`, and expanded state, then hydrates a fresh renderer-local collaborative Document when the captured Project/default View or exact source Board is available; live Yjs/editor/DOM objects never enter app state. Success focuses the new card inside the exact source surface. Cancel falls back in order to that surface's semantic launcher, Board root, source panel tab, then the owning Project Scene, never the document's first matching Board. Read-only launchers remain keyboard-focusable with `aria-disabled`, a canonical-reason tooltip, and guarded pointer/keyboard activation.
- Shift-click in Kanban toggles a temporary multi-selection from the clicked Page presentation; selection can span columns. A board drop reads one atomic query from the Project-bound Database's default Data Source and View, then commits Data Source value changes plus the selected run's Page-coordinate View positions as one `DatabaseApply`. Single and bulk intents use `set_value(s)` followed by `position_page(s)`; the client submits stable Page anchors and never rank strings.
- Same-window cross-surface drag treats a Kanban Database View as a projection over real Pages. The explicit NFM side-menu starts one typed window-local session after BlockNote returns the exact root selection. Dragging one or more Kanban Page presentations into a visible NFM editor moves those same-ID childless Page shells into the host Page Document; dragging editor roots into a Kanban column moves them into that Data Source, promoting compatible text-like roots in place and wrapping non-convertible roots in a Page; dragging between different Page Documents moves the same stable roots through the same command. A Page cannot be moved into itself or any Page in its ownership subtree; invalid hover targets may be suppressed for feedback, and the writer always rejects the command against current authority. Holding Option/Alt at drop time copies the recursive ownership closure with fresh application IDs instead. At a nested editor boundary, only the deepest eligible surface shows an insertion indicator and handles the drop; parent and child indicators/commands never coexist. One `BlockTransfer` commits source/target Documents, exclusive parent, membership, View position, projections, history, and receipt atomically; the renderer carries no Page body snapshot, never removes the source optimistically, and suppresses BlockNote's native cross-editor slice insertion/deletion and text caret while the session is managed.
- Same-Data-Source Kanban reorder remains a View-position operation because it does not change the Page's exclusive parent. Cross-window native DnD is intentionally unsupported until the platform can prove a live source session and safely carry the logical transfer payload; it fails closed without mutation.
- Data Source membership makes a Page eligible for every View over that Data Source; a manual View position is optional presentation state. In the default Kanban View, an unpositioned Page still appears in the column selected by its status property and sorts after explicitly positioned Pages with Page ID as the stable tie-breaker. Delete/restore, transfer, search, and recurrence cloning preserve the absence of a position instead of inventing one. On the first explicit manual move into a group containing unpositioned Pages, the writer atomically materializes the complete unfiltered logical group order before inserting the moved Page run; logical anchors may therefore name positioned or unpositioned Pages, including through Agent create/move destinations. A persisted partial position or a position group that disagrees with status remains a typed authority error.
- The NFM side-menu `Move to` action opens a compact destination popover with grouped `Database` and `Page` search results. Database rows disclose View group destinations, while Page rows append Blocks to an existing Page. Detailed behavior lives in [NFM Editor Move-To Popover Behavior](./nfm-editor-move-to-popover-behavior.md).
- In NFM editors, Page outliner property chips sit in the same inline text flow as the Page title, so wrapped titles use the full row width like inline Kanban card properties instead of a separate leading chip column.
- Visual card previews with priority badges
- The Database manager lists every active Page in the selected Data Source independently of View filters. It can create a Page in that Source, atomically move a Page from another parent, move a Page back to the Library without deleting it, select the target durable View and a stable null-group Page anchor, and author View name, kind, nested AND/OR filters, ordered sorts, grouping, visible properties, and durable View order. View drafts retain the revision at which editing began; a concurrent change is a typed conflict rather than a whole-config overwrite. Other open windows refresh from the committed Database event.
- Kanban card reorder keeps a non-layout-shifting insertion indicator; the source card stays as a static ghost in place while dragging, same-column reorders do not live-shift sibling cards, columns do not tint as separate previews, the drag overlay is geometry-matched to the source card so it starts aligned with the cursor, and dropping on the visual gap between cards inserts into that gap and stays there continuously while committed projection authority converges
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
- Accepted legacy imports are the exact frozen TypeScript v26, both frozen v57,
  v68, v82, and v83 physical inventories plus the exact final v84 handoff,
  which contains no local Thread transcript/FTS projection. Earlier sources
  receive an immutable database/assets backup and are advanced only in a staging
  Profile by the bundled hash-pinned migrator. Core validates exact v84 plus
  native Document/Projection semantics before journaled v109 publication;
  fresh Profiles start directly at v109, and exact v85 through v108 native
  Stores are backed up before forward upgrade. Import-only compatibility logic
  never becomes a live runtime path.
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

#### 6. Page Creation Dialog
- The Kanban column header, in-flow `New page` action, and auto-collapsed empty column open the same app-owned dialog with their semantic origin and target status.
- The compact `Project > New page` header identifies context above one flat title/description writing plane. A normal, non-composing Enter in the title focuses the description without inserting a title newline.
- A renderer-local Page Document draft owns the plain title and canonical NFM body until submit; it starts with one authority-owned empty paragraph, so an empty description is valid and BlockNote never needs to invent document structure. Opening or editing the dialog does not create a Page, history entry, or Property option.
- Status, Priority, Estimate, and Tags use the selected View's current schema. Property menus use the app-level floating layer outside the clipping dialog surface while remaining nested focus/dismissable layers; their first Escape closes the property surface rather than the dialog.
- One successful lifecycle mutation creates the Page body and property values atomically. Failure preserves the complete draft, while `Create more` clears title/body and retains the selected properties after success.
- The renderer preallocates the Page's canonical identity and projects its pending create as an identity-keyed insert-if-absent across the whole Board. If the committed LocalCommit projection arrives before the initiating command settles, that canonical row, placement, and field set immediately win; one Page identity is rendered at most once while later pending edits continue to compose over it.
- Closing is never blocked by optional draft-recovery serialization: if a damaged local draft cannot be captured, the dialog still closes and reports that recovery was unavailable. Closing restores the originating launcher when possible. Normal creation focuses the resulting card, with the launcher and board root as deterministic fallbacks when the card is filtered or remounted.

#### 7. Page Stage Editor
- Notion-style slide-out panel for Page details
- Always-editable fields (no edit mode toggle)
- Page is the user-facing term for a document-bearing Block; Page Stage never introduces a second content identity.
- Page Stage opens through membership-independent Page Detail. Library-, Page-, and Data Source-parented Pages all resolve the same Block and owned Document; absence from a Database View is never treated as a missing Page. Nested `page` and `pageRef` actions therefore open the same Y.Doc in a normal Page tab without copying content or restoring an old membership.
- Title/body, history, Threads, and `Run in` controls are available for every Page. Live Agent execution state belongs to Thread/session runtime and is not shown as Page metadata. Each Source Property renders from its own active schema/value coordinate and reports malformed or conflicted values locally without hiding sibling Properties. Status grouping and movement require an active compatible status Property; schedule and occurrence controls require both active schedule boundary Properties. A single remaining schedule boundary behaves as an ordinary datetime Property. A standalone Page receives no synthetic `triage` status or empty Data Source values.
- Page Stage Property presentation is schema-driven without being visually generic. An exact reserved Property ID plus its canonical value type selects the focused Status, Priority, Estimate, Tags, Due date, schedule-boundary, or Assignee presenter; an editable schema/option registry remains authoritative for whether that Property exists and for its current name, order, option labels, colors, and revisions. A custom select named `Status`, or a reserved identity with a corrupt type, uses the typed fallback and cannot acquire workflow semantics by name.
- Status retains the Triage, Plan, Build, Review, and Ship icon system keyed by stable option identity. Priority and Estimate likewise key their tone from stable built-in option identity while displaying registry-owned labels. Select and multi-select values use one searchable token picker; multi-select stays open while toggling and exposes explicit token removal. Option registries preserve their configured order and load lazily in projection-fenced cursor windows when the picker opens or approaches its list boundary; an expired continuation silently restarts from current first-window authority. Custom options are preallocated and created together with their first selection in one Database apply, so conflicts cannot leave an orphan option.
- Date and datetime Properties use one controlled six-week calendar with typed input, Today, and Clear. A date persists only `YYYY-MM-DD`; datetime additionally exposes a real local-time input and persists canonical ISO time. Due date does not display range, reminder, or time affordances that its schema cannot store. Relation Properties use a target-Source-aware search popover with separate Selected and candidate groups, explicit add/remove controls, candidate and selected-target pagination, stale-result fencing, and an inline clear-all confirmation. Opening the picker with an empty search lists the target Data Source's accessible active Pages in stable title order and continues through the same bounded cursor window; typing narrows that list through one cursor-stable match key that folds ASCII case and preserves every other Unicode code point exactly. The compact value exposes restricted targets only as a count. A paged Selected window may render a generic `Restricted page` row with a remove action backed by its opaque source edge handle, but never exposes target identity or title.
- Property failures stay with the control that owns the action. Save conflicts or unavailable values render concise field-level guidance without exposing transport or protocol strings; option and Relation collection failures remain inside their open popovers, preserve current selections, and provide an in-place Retry action.
- Property deletion requires an explicit inline confirmation because it removes that Property's values from every member Page. Active Views that reference the Property through grouping, filtering, sorting, or display block deletion and are named before the user confirms; Core rechecks the same typed references atomically at mutation time.
- Membership refresh changes only the optional Page Stage Database capability. It keeps the Page Block ID, owned Document ID/provider boundary, collaborative content, and local undo scope stable. Opening a Page is read-only with respect to ownership.
- Production Page Stage prepares the exact Project-scoped owned-Document descriptor before rendering content. Only a ready, schema-compatible `yjs` descriptor mounts the Page editor; `canvas_scene` descriptors mount only through the Canvas surface boundary, and invalid descriptors remain on a retryable fail-closed diagnostic surface.
- Page Stage uses one continuous content skeleton across Page hydration, Document preparation, runtime creation, and the initial state-vector handshake. Normal opening never replaces that skeleton with a second text-only loading state. Opening an exact Document begins at an atomic live barrier and canonical sync; it never replays retained global LocalCommit history, so skeleton duration is independent of Profile commit count. Events after the barrier remain buffered until that sync adopts its Store/generation/head boundary. A terminal open or resync failure remains inline until recovery, shows the concrete failure reason beside Reload, and offers expandable, copyable diagnostics with the protocol error code and Document identity; delayed/offline sync status remains available after a Document has opened. If durable replay discovers that a committed update body was compacted, the surface reports a history-compacted resync and reloads the canonical Document; it never presents the committed Page as empty or silently drops the update.
- A title-only Page opens as a normal empty editor. Its collaborative body contains one authority-owned empty paragraph with a stable Block ID, while NFM/plain-text exports remain empty; the editor never creates a placeholder identity during mount. Clearing a whole body with empty Nested Markdown preserves this invariant. A first root-level insertion promotes that same seed identity into the inserted content under a write fence, so the editor scaffold never leaks into the public body as an extra `<empty-block/>`.
- On a primary Page, every mounted writable surface owns an independent Y.Doc client/session, completes state-vector synchronization before mounting content, binds title to `Y.Text("title")`, and binds BlockNote to `Y.XmlFragment("body")`.
- Page title is a rich contenteditable projection of that Y.Text. It preserves bold/italic/underline/code/color, links, line breaks, and registered title-safe mention atoms; formatting never applies to atomic objects or line breaks. Ordinary input and deletion mutate minimal Y.Text ranges, Shift+Enter inserts a canonical line break, Enter remains Page Stage navigation, and paste falls back to sanitized plain title text when external rich content is unsupported. Copy and cut write plain text plus semantic HTML derived from the selected title content, so Page-title presentation weight never becomes a copied bold mark while explicit inline formatting remains portable; cut deletes only after a clipboard payload is written successfully.
- Synced Block sources are not another Page: each is a system-managed body-only collaborative Document whose Library placement is omitted from normal Page/Database navigation, while visible occurrences are childless references to the same source Block. The typed ownership command is available through renderer IPC and CLI. A collapsed occurrence creates no provider; expanding a visible occurrence mounts the source's independent collaborative editor without copying its body into the host Page.
- Reusable Template Library sources use the Additional Document command boundary. Templates have an authoritative human name, childless references, and copy-on-instantiate semantics with fresh Block IDs; expanding a reference opens the independently synchronized source without embedding foreign body content. Canvas structure uses the Library command boundary instead: create, rename, move, duplicate, and delete atomically coordinate owner metadata, scene Document lifecycle, and any Page shell. Canvas scene Documents never mount a BlockNote body editor. A source can be deleted only after a global exact-head scan proves that no Project references any Block in its recursively owned closure; deletion retains Documents/history until GC. Long-form content remains a Page, ordinary code remains a `codeBlock`, and size never changes a Block's durable type or ownership.
- Promotion/demotion preserves selected subtree IDs, allocates fresh IDs only for copies, and lets Core validate the current Document heads and commit the ownership transition atomically. A mounted surface flushes its local durable updates and supplies a typed causal head token; Core rechecks that token during planning and apply. The initiating renderer receives the committed local result immediately and does not wait for the durable event tail or projection refresh.
- Primary title/body edits are Yjs transactions and never run whole-NFM autosave, external whole-body replacement, or description conflict overwrite. Lifecycle and metadata use separate typed commands; explicit NFM import requires current Document generation/head CAS and produces a forward Yjs transaction.
- Restart, idle-history finalization, and operational compaction must reopen any semantically valid Page even when the Yjs engine emits a different byte encoding for the same full state. Page integrity fails closed on damaged retained blobs, discontinuous replay, unresolved dependencies, state-vector/schema violations, or materialization drift—not on a re-encoding fingerprint.
- A descriptor that is not ready/primary/schema-compatible remains on a fail-closed diagnostic surface. There is no legacy snapshot editor or whole-Page overwrite recovery, and authority is never inferred from a compatibility description projection.
- Title/body undo tracks only the current surface's local origins. Body UndoManager lifetime follows the registered collaborative editor surface rather than its replaceable ProseMirror EditorView, so React StrictMode and DOM detach/reattach do not disable `Cmd/Ctrl+Z`; remote edits merge visibly but do not enter that surface's undo stack. Extension unregister and editor disposal still detach the UndoManager from Yjs.
- Awareness distinguishes mounted windows/sessions and is advisory rather than a lock. Switching away from a Page Stage clears its presence and closes that surface client; returning mounts a new client session and state-vector-syncs any intervening content before editing resumes
- Close/deactivation persistence is bounded and combines durable provider flush with a disposable local checkpoint. Normal fast ACKs stay visually quiet; delayed pending, offline, error, and reset states show compact retry/reload status
- Page Stage visibility context is global: switching Projects and Views keeps the current Page Stage state until explicitly closed.
- Page Stage durable content and explicitly owned renderer presentation survive Project/session switching; component-local DOM and gesture state do not. No hidden task page remains mounted. Returning opens a fresh per-surface Y.Doc client, completes state-vector synchronization against the same Page Document, and only then exposes title/body editing
- Every unset Page Stage Property renders the same secondary `Empty` text as its only visible value: no type icon, add label, or plus affordance appears until the Property has a value. These empty controls share one value-column start and vertical baseline, while populated reserved Properties retain their focused presenter. Empty priority remains omitted from dense card badges.
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
- Deleting or restoring a nested Page is a typed Page-lifecycle action: it atomically updates the Page ownership closure, the child shell in its containing Page, and all affected projections. The same closure transaction also tombstones/restores any embedded Database container authority with its Block and records the exact owner revision needed for restore. The mounted host editor supplies its current Document head as a causal fence; a stale head reports a retryable conflict and never falls back to generic Block deletion. The committed host-shell update reaches every open Page surface through the normal LocalCommit/document-sync path, so the source shell disappears or reappears without an edit-triggered refresh.

Typed owner operations follow one closed matrix. `pageRef` is a non-owning reference and can be unlinked, deleted, moved, duplicated, pasted, replaced, or reclassified as an ordinary Document edit. An owning `page` shell uses Page lifecycle for delete/archive, Block Transfer for movement, and Page Copy for duplication; generic cut/paste, replacement, promotion, unlink, and reclassification are forbidden. An owning `canvas` shell uses Canvas lifecycle for delete, move, and duplication; generic lifecycle and clipboard transformations are forbidden. An owning `database` shell can be archived/restored or moved only through Database/Library lifecycle commands; direct editor deletion, duplication, clipboard transformation, unlink, replacement, promotion, and reclassification remain explicitly unavailable until a recursive Database-deletion product contract exists. Ordinary Blocks use Document edits within one Document and Block Transfer for cross-Document move or Block-to-Page promotion. A selection that contains an owner below an ordinary ancestor, mixes an owner with other roots, or contains multiple owners cannot be destructively edited as one generic transaction. Core reports `protected_owner_deletion` if any caller bypasses these intent seams; normal Page and Canvas delete paths never surface that validator error.
- Page expansion keeps the projected title row stable while the target boundary or first sync is pending and uses a body skeleton instead of replacing the row with opening text.
- Canonical Page and Database View reference owners remain ordinary stable-ID Blocks for BlockNote selection and drag operations. Result rows are projections and cannot be dragged as host Document children.
- The v84 handoff inventory contains the canonical durable Database View schema. Older accepted Profiles reach that boundary only inside the frozen staging migrator; native Core runs no legacy inline-rule conversion. Project-authorized reads validate and execute filter/sort/include-host semantics over memberships, including negative set membership and creation-time sorts, and use View rank plus Page ID as stable tie-breakers. No active View retains a legacy compatibility config.
- `pageRef` / `databaseViewRef` are childless persistence shapes. Parser, codec, and primary storage validation reject foreign Page bodies; `cardRef`, `cardToggle`, and `toggleListInlineView` exist only as migration inputs and inert diagnostics. A migrated missing Page target remains an import-only, deleted `unresolved_card_reference` shell in its host Project; current writes cannot create or target that shell. Table materialization preserves BlockNote header-cell matrices as `headerRows` / `headerCols` and emits the corresponding `tableHeader` nodes on round-trip.
- Toggle List summary rows do not export or accept body snapshots; only an independently mounted Page editor can move its own stable-ID Blocks through `BlockTransfer`.
- Reference recursion is guarded by inherited Page ancestry (including A → B → A), while a per-mounted-surface provider budget caps independent editors; foreign bodies never enter the host tree.
- Drag-handle `Move to` sends stable root Block IDs plus logical `library | page | data_source` parents. Core resolves current physical storage coordinates, validates the target View/Data Source, and commits content, parent, Source membership/value state, View positions, projections, history, Document effects, and receipt atomically. The apply response is the local committed authority: the initiating renderer admits its authorized source Document update, exact Database View effect, and any source revocation before the command Promise resolves, so the source Block disappears and the promoted Page appears without a durable-tail or repair read. Other renderers receive authorization-scoped live delivery with causal-ingress ACK/reset semantics. A later live/tailer copy is deduplicated by Manifest, audience, and resource identity. No renderer invents an ownership mutation, displays a structural pending projection, or performs a post-command Page/Board refresh. Losslessly promotable roots preserve their ID as Page identity; Option/Alt Copy allocates fresh identities.
- Moving, archiving, deleting, granting, or ungranting a resource seals a Manifest-bound visibility delta in the same local transaction. Exact revokes evict matching Page, Board, query, and Document state before post-state content; an exact grant identifies the newly authorized roots. Only a bounded authorization-closure overflow produces a conservative whole-address reset. Recipient transport loss uses a separate Core-lease-bound address reset and actively retries even when no later commit arrives. Visibility clears stale client state but never substitutes for Core's authorization check on a later read.
- Authority-bearing Page Detail, navigation/path, Database View/row, Canvas target/project-access, and owned-Document descriptor reads carry a Core stamp produced with their data in one SQLite snapshot. The renderer records only the requested address and resource before I/O, then adopts the returned direct/ancestor/membership/grant roots after verifying the stamp and every observed visibility floor. A response started before a matching revoke can never repopulate the UI. Exact loss leaves unrelated resources in the same Project visible; only conservative visibility or an address reset clears that full address. Cache pressure fails closed rather than forgetting an old authority floor.
- NFM block side menu opens from the left drag handle or `Cmd/Ctrl+/` at the current block, promotes relevant text selections into visible block selections, and advertises the top-level action scope with labels such as `Text`, `Code`, or `3 blocks`. Production rows expose real block actions only: `Turn into`, `Color`, `Duplicate`, `Move to`, and `Delete`, plus eligible divider/table-specific rows. Block-link copy rows remain development-only reference mocks until NFM has stable persisted block identities. Detailed title, action, layout, submenu, and card deeplink rules: [NFM Block Side Menu Behavior](./nfm-block-side-menu-behavior.md).
- Page, Database, and Canvas owner Blocks cannot be removed or reclassified through generic editor commands such as cut, paste replacement, duplicate, or `Turn into`; their typed lifecycle/transfer actions are the only paths that can change ownership. This protects the stable owner identity and prevents a host Document from diverging from the Core ownership and projection authorities.
- Side-menu handle dragging interprets a live text selection with block-level start-inclusive/end-exclusive bounds. If the selection ends exactly at the start of the next block, that next block is not part of the drag payload; if the selection has entered the next block's content, it is included. If the selection starts at the previous block's content end, the previous block remains included. Cross-parent text selections do not create custom mixed-parent payloads; instead, the editor drags the smallest common-level block range that fully covers the selected candidates. Examples: `blo<start>ck-0 / <end>block-1` dragged from `block-0` moves `{block-0}`, while `blo<start>ck-0 / b<end>lock-1` dragged from either selected handle moves `{block-0, block-1}`; `block-0<start> / blo<end>ck-1` also moves `{block-0, block-1}`; `block-0<start> / <end>block-1` moves only `{block-0}` when dragged from `block-0`. In a nested range `block-0 > block-02<start>, block-03 / <end>block-1`, dragging `block-02` or `block-03` moves `{block-02, block-03}`, while dragging `block-1` moves `{block-1}`; if the end enters `block-1`, dragging `block-02`, `block-03`, or `block-1` moves `{block-0, block-1}` so the dragged payload fully covers the text selection.
- Expanded rich-text selections in Page Stage, Page creation, and a Toggle List row's independently mounted Page editor show a Notion-style floating text action menu instead of the compact formatting toolbar. The menu and link toolbar use fixed body portals above modal/footer chrome, with viewport collision handling, so editor scroll containers never crop them. A floating editor surface keeps its last rendered geometry throughout its close transition, so document edits that invalidate the original selection cannot move the fading surface to a new anchor. The production menu uses Nodex tokens while preserving the 192px popup hierarchy, block-type row, text style grid, color controls, and supported Nodex action rows. Supported actions use existing BlockNote/Nodex editor paths for block conversion, bold/italic/underline/strike/code, clear format, and link creation/editing. The color button opens a 190px swatch-grid dialog with up to five app-wide persisted recent color slots plus text/background color grids; swatch clicks keep the dialog open, and clicking the active swatch clears that color back to default. Reference-only controls such as equation, comment/reaction/comment-pencil, skills list, and inline AI footer appear only in development or Storybook as disabled mock controls with `Mock` labelling or mock-specific aria/tooltip labels, while Page Stage editors can expose Nodex-specific `Send to chat` and `Move to` actions in the actions area when callbacks are available. The actions area shows its bottom fade only while content remains below the scroll viewport, so a fully visible final action is never obscured. Both action rows open their right-side pickers only after click or keyboard activation, never from pointer hover or row focus. `Send to chat` reuses command-palette chat search, including fuzzy local metadata ranking and bounded app-server history snippets. The current session or current section remains the context-recommended first destination when available, and a bottom `New chat` action plus app-level persisted `Send` / `Send & wrap` modes remain available. Ordinary chat rows show their owning Project as right-side metadata; contextual rows keep `This session` or `Current section`. Selected-block sends recommend the current session: if it already has a chat, that chat is first; if the current session is an empty no-tab chat draft, `New chat` appears first with `This session` metadata and creates the thread in that session. Thread-section sends recommend the section's bound chat first. Sending targets the selected top-level Blocks, preserves supported prompt attachments, and does not switch the stage to the chat; `Send & wrap` includes an info icon tooltip and only mutates the Document after a successful send by replacing the selected roots with a collapsed toggle headed `▶ sent to <mention-thread uuid="..." />`. `Move to` keeps the single destination popover for Database/Page targets. Opening either picker must not steal focus from the editor or hide the selected range; when a picker/search input is focused, the original editor selection remains visibly decorated until the picker is closed and focus leaves the text-action toolbar. File, image, table, and non-rich-text node selections keep the compact legacy toolbar fallback, while collapsed rich-text cursors show no floating toolbar; image/file toolbars anchor directly above the selected Block and omit text-alignment controls because NFM does not persist that state.
- The text-selection menu `More` button closes the text-selection menu and opens the existing block side-menu actions for the currently selected block range. Partial text selections are promoted to block-scoped side-menu actions over every selected block; non-mutating dismissal returns focus to the editor with that promoted block scope still held as the real editor selection while suppressing the formatting toolbar for the dismissed range. A same-editor blank click only dismisses the handed-off side menu and does not click through into ProseMirror to place a cursor or scroll the editor.
- Drag handles, formatting toolbar, block selection
- Page Stage keeps raw-format, content-width, and history controls directly in the top toolbar. Its trailing Page actions menu contains `Copy deeplink` plus a separated, destructive-tinted `Delete` action; closing remains owned by the containing tab.
- View history first persists the mounted Page surface, then opens an app-shell revision-history modal sourced from that authoritative Y.Doc.
- Owned Document history is exposed through Project/Document-scoped list, get, checkpoint, and restore commands over both Electron IPC and loopback HTTP. New `block_tree_snapshot_v2` revisions retain stable-ID BlockTree plus rich Page title; NFM is rederived for display. Canvas retains bounded canonical scene JSON and historical Yjs checkpoint readers remain available. Restore requires the selected revision plus current generation/head, flushes only the local updates consumed by that command, and lets Core pin the current state, append one engine-specific forward mutation, and pin the resulting state in one transaction. Retrying the same restore mutation ID returns the original durable result.
- History defaults to a `Current` row plus cursor-paginated semantic revisions grouped by date. Selecting a revision loads its exact title/body in the read-only NFM editor and offers `Restore title & body` when generation-compatible. `Activity` separately exposes property, Database, lifecycle, mutation, and relocation evidence without pretending those events are reversible snapshots.

#### 8. Edit History & Undo/Redo
- Typing undo/redo is owned by the mounted Yjs surface. `Cmd/Ctrl+Z` and redo operate only on transactions created by that surface's local origins; remote edits and another window's changes never enter its undo stack. An EditorView remount preserves that surface's UndoManager and stack, while collaboration-extension unregister or editor destruction releases its observers.
- Durable content history is a retained `document_versions` semantic revision stream. Human editing retains a pre-burst safety state, the latest state every ten active minutes, and the final state after two idle minutes or shutdown. Strict commands create immediate revisions linked to their immutable mutation evidence. Named and restore revisions are pinned; automatic, safety, and operation revisions use seven-day full, thirty-day hourly, ninety-day daily, and 500-row retention.
- Property, lifecycle, Database membership/value/View, and location changes are immutable `block_mutations` / `block_relocations` joined through the Project change log. Their before/after evidence is field- or operation-scoped, not a reconstructed whole Page snapshot.
- The Page history modal is Page-scoped and merges these sources into one stable cursor timeline. Pagination never depends on array offsets or renderer-local clocks.
- Selecting a Document revision loads its exact read-only NFM preview. Reference and embed Blocks remain inert and do not fetch or mutate current target state.
- Restore is available only for a retained compatible Document revision. It validates the current generation/head, uses a causal local flush where needed, and lets Core pin the current state, append a new forward engine mutation with an exact-retry receipt, and pin the restored state. Page restore never rewinds Yjs causality; Canvas restore assigns newer element versions and explicit tombstones rather than replacing current authority with an old scene snapshot.
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

#### 10. Canvas Block and Canvas Stage (Excalidraw)
- Canvas is a first-class document-bearing Block. Every Project retains one deterministic primary Canvas, and users can add another Canvas at the current Page block position or as a top-level Library resource.
- A Page contains only one childless owning shell whose Block ID equals the Canvas ID. The shell has empty props/children and stores no scene JSON, file metadata, title snapshot, or `documentId`; all Canvas content remains in the independently synchronized `canvas_scene` Owned Document.
- The Page slash menu and block side menu create Canvas through one typed Library operation after flushing the current Page provider to an exact durable head; the disposable local checkpoint is not part of this structural transaction barrier. While the operation is in flight, the replaced paragraph shows a transient `Creating Canvas…` status that is editor-only and never enters NFM or Yjs authority. Create, move, and duplicate commit the content/host coordinates they consume together with Canvas owner metadata, independent Document/scene lifecycle, exact Library or Page placement, the host Page shell, projections, and receipt. Delete is an owner-lifecycle terminal command with location/metadata CAS only: it never waits for a scene provider or a scene head, and Core's serialized writer orders it against concurrent scene writes. The Host feeds Page commits from each receipt into the ordinary scope-aware Document sync path before command completion, so an already-mounted Page reveals the authoritative shell without reload. A failed or stale operation leaves no orphan owner or unregistered shell.
- An inline Canvas starts as a lightweight titled shell and automatically mounts Excalidraw while its Page surface is active and it is visible or inside the prewarm margin. The bounded coordinator prioritizes pointer/focus engagement, actual viewport intersection, center distance, and stable document position; offscreen or budget-evicted shells remain compact and return automatically without an Activate/Resume step. The embedded editor confines pointer and keyboard interaction to its block; Page chrome and neighboring blocks remain interactive, and Escape ends nested engagement and returns selection to the host shell without blanking a still-admitted scene. Rename, duplicate, delete, and Move to use the Canvas lifecycle command rather than raw BlockNote cloning/removal.
- `Open Canvas in tab`, the Library Canvas row, and the Project's primary Canvas action open a durable `canvas_stage` tab for the same public Canvas Block ID. The tab stores Project authorization, Canvas ID, and a fallback title—not a Document ID or scene. Opening the same Canvas again focuses its existing tab in that Session; live metadata refreshes the title, and missing/deleted targets retain a closable explicit state.
- Inline and Stage mounts share one `CanvasDocumentSurface` and, within one renderer, one ref-counted Canvas Document session/provider/outbox. Each mount keeps its own binding, selection/tool state, presence participant, undo, asset resolver, and surface-scoped camera. Editing either surface enters one serialized local mutation drain and converges with other renderer windows through normal Canvas synchronization.
- SQLite stores normalized current element, durable app-state, and managed-file authority rather than a Y.Doc or renderer-overwritten whole scene. Exact counters, derived element metadata, sparse content-hash buckets, and a projection head make an ordinary edit proportional to its changed candidates; the bounded portable JSON scene is materialized only for sync, history, restore, copy, backup, and integrity validation.
- Separate windows submit bounded element candidates and field-level app-state intent. Greater Excalidraw version wins, equal versions use the lower version nonce, a canonical hash breaks malformed ties, and deletion is always an explicit tombstone.
- Page shapes are reference objects with a stable `targetBlockId`; they do not copy Page bodies or Data Source membership into Canvas content, and standalone Pages remain openable.
- Shared scene state contains current portable elements, ordering, and a bounded set of durable app-state fields. Selection, active tool, and focus remain window-local. The last viewport position and zoom are stored as a Profile-local preference per Canvas Document and stable inline/Stage scope, so a Page provider remount does not lose the inline camera and closing then reopening the same Canvas Tab restores the Stage camera; already-open windows keep independent live viewports and never follow another window's preference writes. A Page inline Canvas also remembers its expanded height locally per Store epoch and Canvas Block. Its width remains responsive to the Page, compact/offscreen presentation does not replace the saved height, moving the owner preserves it, and duplicating the Canvas starts from the default height. Camera and frame preferences never enter Page Block props or Canvas scene authority.
- Embedded image bytes are uploaded to a SHA-256-addressed managed asset before a scene mutation records immutable URI metadata. Repeated materialization returns the same source. The Core treats one logical file ID plus equal canonical MIME/digest/length as an idempotent assertion even when legacy URI or `created` metadata differs, retains first-writer metadata, and rejects different bytes. Remote surfaces lazily resolve those URIs and reuse unchanged asset reads.
- The renderer coalesces frequent observations, reuses staged file definitions before ACK, and persists each exact pending mutation to an IndexedDB active outbox before transport. Response loss keeps and retries the exact row with bounded exponential backoff; a deterministic rejected mutation moves atomically to a bounded quarantine, resyncs accepted authority, and allows later edits to continue. Store-epoch or generation change invalidates active rows.
- Scene subscriptions start before synchronization. A missing/out-of-order head, reconnect, or completed write lease repairs through one bounded full scene. Snapshot validity is bounded UTF-8, JSON, and `PortableCanvasScene` semantics; wire bytes need not equal a JavaScript re-encoding of Rust JSON. Pending upload/outbox/provider work joins bounded close and write-fence flushing; remote scenes reconcile with `CaptureUpdateAction.NEVER` and do not enter local Excalidraw undo.
- Open Canvas windows show each other's bounded cursor, selection, and active/idle state. This collaborator presence is best effort and memory-only: pointer samples are limited to 20 Hz, quiet sessions heartbeat every 15 seconds, clean close disappears immediately, and an interrupted window expires after 30 seconds. Presence never changes the Canvas head, undo stack, history, database, or offline outbox.
- Canvas deletion history is maintained automatically and has no toolbar action or confirmation dialog. When the last fully committed Canvas surface closes and retained deleted-item count or bytes cross an internal threshold, Nodex verifies that no other copy is active, saves a pinned safety version, removes current-generation tombstones and files referenced only by them, and starts the next collaboration generation. Offline state, pending local work, another active copy, or an unavailable write fence silently defers maintenance and never blocks close or resets an active undo stack.
- Database Views support Board, Table, List, and Calendar presentations. Their toolbar includes an adjacent Canvas destination that opens or focuses the Project's deterministic primary `canvas_stage` without changing the Database tab, selected View, search, filter, sort, or display preferences. The retired Database `canvas` presentation migrates to List; an owning Canvas is never a Data Source query presentation.

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
- Kanban Page context menus expose `Open Page`, `Open in New Chat`, and `Send Page to Chat…`. `Open in New Chat` creates and selects a new blank Project Session, opens a durable Page Stage in that Session's right panel, and does not create a Thread; the first composer send creates the ordinary Thread. `Send Page to Chat…` searches existing chats and the Project's New chat target, reads the current canonical Page Document only after target selection, and sends one immutable Page prompt snapshot without navigating away or creating a Page-to-Thread relation.
- The sidebar discovers active interactive Codex root threads globally through app-server `thread/list`, including chats created outside Nodex by Codex CLI, VS Code extension, or another local app-server client.
- External threads are automatically materialized into local sessions during sidebar sync. Only first materialization may infer ownership from the longest normalized Project source-root prefix of cwd; a nonmatching cwd produces an explicitly projectless owner. Once Core has a Thread row, its Project ID or explicit `null` is durable authority. Later `thread/list`, `thread/read`, startup recovery, and app-server notifications may reconcile execution metadata but never reinterpret cwd as an ownership change.
- Projectless Sessions have `projectId: null` and can open the Thread stage, rename, archive, pin, and fork in the same directory. Selecting one enters the explicit no-Project Session Scene, and shell Back/Forward restores that null Project context. Its Window Session-local Scene can open Browser surfaces like a normal chat. An attached projectless Thread can start an ephemeral Side chat; when its cwd is present it can also reference a Terminal PTY that starts exactly there. If cwd is absent, Side chat repairs and persists the projectless workspace before forking, while Terminal stays unavailable. A blank projectless Session Scene exposes Browser only. It can also open an exact-file Files surface without acquiring Project ownership or a workspace tree root, but cannot open a generic Files tree, DB View, Page Stage, or Review surface. Persistent same-directory forks and temporary side-chat forks retain the source output-directory and workspace-browser-root hints; the app-server fork payload cannot silently reclassify those children as ordinary Project workspaces. Ownership changes require the explicit `MoveThread` domain command; after a move, each Window Session keeps its own descriptors and re-resolves the shared target under the new owner.
- Two windows selecting the same Project or projectless Session never synchronize Scene-surface creation, close, selection, order, split geometry, or panel sizing. Shared Session/Thread/Page/Canvas/Database mutations still converge through Core. Browser guests are scoped by the Window Session's `browserViewScopeId`; a deliberate fork or new-window clone remints Browser identity from an explicit source snapshot. Terminal PTYs use one active Window Session lease and expose takeover instead of accepting concurrent input from two xterm views.
- Closing an app window retains its Window Session as bounded closed history instead of deleting its Scenes and layout. The next generic New Window restores the most recently closed window in reverse close order with the same Window Session, Scene, split, Browser-scope, revision, and bounds identities; a separate Reopen command is not exposed. Deliberately closed windows do not join ordinary cold-start restoration: `all` restores open records, `last-window` restores one open record and keeps the others as closed history, and `none` keeps prior open records as closed history before creating a fresh window. On macOS, activating Nodex with no open window uses the same New Window acquisition behavior. An ordinary second-instance launch focuses an existing window; explicit `--new-window` uses generic New Window acquisition.
- Global thread pinning is stored in `codex_pinned_threads` and controls attached chat ordering in the sidebar pinned section. `project_sessions.pinned` is retained only as a compatibility mirror and for no-thread local rows.
- Active sidebar lists hide archived Codex threads, archived sessions, deleted threads, ephemeral side chats, side-conversation helper threads, parent-linked subagents, and detached internal reviewer/helper threads such as auto-review reviewer runs. A parent-linked subagent remains an unarchived catalog row for its parent conversation and can never own a sidebar Session. If parent metadata arrives after an early root-thread materialization, Core atomically clears the child's pin/unread state, archives and detaches the leaked Session, and preserves the child Thread for parent-conversation presentation. Sidebar task queries, main-process snapshots, and renderer projection independently exclude parent-linked rows. Existing detached reviewer/helper leaks are still repaired by archiving/detaching the Session and archiving the helper Thread row.
- Newly created blank Project chats render at the top of their normal Project subtree below pinned chats and above older normal chats. Projectless blank chats render at the top of `Chats`. A newly created Project may show no child rows until the user asks an agent or starts a chat.
- Thread creation requires the first user prompt and immediately starts the first turn. The pending state belongs to the session/thread-start lifecycle, not to the composer button alone. A durable Session link is not itself a presentation boundary: the initiating renderer keeps the new-chat surface visible until it owns a canonical conversation and has synchronously committed the first optimistic user turn. Defensive recovery renders an explicit preparing/failure state rather than an empty transcript whenever an attached thread still lacks a readable conversation.
- Pasting at least 5,000 JavaScript characters of plain text into the Thread composer creates a removable `Pasted text.txt` attachment instead of inserting the text into the prompt editor. The attachment appears immediately as pending, becomes ready after Nodex stores its exact content in the owned attachment area, and exposes retry or removal if materialization fails. `Show in text field` restores the exact text on demand; sending, queueing, goals, and worktree starts wait for pending materialization and use the owned file rather than a renderer draft copy.
- Exact large content remains available through `View full`, `Raw`, copy, or source views, while inline presentation is deliberately bounded. Workspace Markdown above 256 KiB or 5,000 lines opens as exact source with `Rich preview is unavailable for large Markdown files`; large assistant/tool Markdown follows the same rich-preview budget. Plain workspace files, raw tool/page output, process output, environment-script summaries, and legacy very large user messages use the shared selectable, syntax-aware, viewport-rendered Pierre source reader instead of mounting the complete document as text nodes. File references preserve start line, column, end line, and end column through the Files tab; range targets center and highlight the complete line range, while editable source applies the character selection and clears stale line highlighting.
- Live assistant, plan, and reasoning prose shares one manager-global frame queue. Visible conversations append up to 24 UTF-16 code units per raw target per animation frame; hidden or no-frame runtimes wait 16 ms and flush the complete buffer. `item/completed` and `turn/completed` globally drain this queue before final lifecycle state, including queued empty deltas. Delta application resolves nullable turns at flush time, matches the last same-ID exact raw protocol type, validates reasoning indexes, never synthesizes a missing item, and never refreshes item/turn status or timing; the completed item remains authoritative. Statusless reasoning, assistant-message, and plan items consume the turn's item-id lifecycle ledger, so their visible in-progress state is not inferred from the last sibling work item.
- Reopened and paginated app-server history is hydrated and merged into the same canonical turn state used by live activity before any thread-body projection. Generated item slot identity/order and hydrated start/completion timestamps survive that adapter; older pages are not independently normalized or prepended to a second transcript model.
- Canonical turn-item display is an exhaustive zero/one/many projection over the raw ordered turn. Nonblank hook prompts render as user-facing hook feedback, generated images remain visible, and consecutive image-view items fold only until the next raw non-image item—even when that intervening item is itself hidden. Sleep and review-mode markers stay hidden. Assistant, proposed-plan, and reasoning status comes from the item-id lifecycle ledger, while statusful tool families retain their protocol status and terminal turn policy; completion is never inferred from sibling position. Checklist-looking protocol plans remain proposed plans rather than becoming todo lists.
- Generated-image output resolves its thumbnail descriptor separately from its full descriptor. The full resolver independently supplies preview, download, and data-URL values; drag prefers data URL, then download, full preview, and thumbnail. Absolute local paths display directly and load binary data only while a download-capable preview is open. ChatGPT file pointers resolve through authenticated main-process networking with a five-minute renderer cache and transient retry policy. A failed thumbnail refetches at most twice for its current resolved URL, and the preview dialog exposes the resolved download asset.
- App-local turn activity uses the same whole-turn projection as server turns. Optimistic first messages, goal submissions, fork/worktree provenance, remote-task markers, manual-compaction placeholders, model transitions, and local failures may appear before a protocol turn id exists; each remains a distinct ordered turn, renders params input before its typed items, and binds in place when the matching server turn starts. Local turns do not receive server request overlays. Empty metadata preview turns and startup-tool-prewarm turns remain hidden.
- Before app-server hydration is available, local rollout JSONL may provisionally recover session/turn metadata, user and assistant prose, reasoning summaries, compaction, token usage, and explicit errors. It never guesses a v2 tool family from Responses function names or fabricates a generic tool from function output; canonical app-server history is the only restart authority for tool activity.
- A generated command remains one raw lifecycle/output owner but may render one exec activity per command action. Multi-action row IDs use `<raw item id>:<action index>` and retain the raw owner ID for approvals and updates; empty actions render one unknown-command fallback. Split rows share process, cwd, timing, status, duration, and output while keeping their action-local command and parsed action type.
- File-change projection keeps ordinary files in a path-keyed patch map and tracks Codex visualization HTML as separate create/update activities; visualization files are not rendered as ordinary patch files. In-progress and completed visualization activity is retained, while failed/declined activity is omitted. A non-failed patch also contributes to the turn-level diff batch using the latest preceding exec cwd. The patch activity and turn-diff row coexist; explicit turn diffs win after visualization-only diff blocks are removed.
- File-change activity renders visualization status before insertion-ordered file rows. Patch lifecycle comes from its nullable success plus approval/cancellation state. Detailed mode gives each path an independently expandable diff with line stats, review details, copy action, and semantic add/update/delete fallback; prose detail mode keeps the same status/path rows static without diff disclosure. File links prefer the granted root, open in the side panel normally, and use the configured external opener for modified clicks.
- Special tool projection preserves family-specific protocol state instead of wrapping everything as a generic tool call. MCP retains app/resource/source/result/error metadata and becomes complete when its item or turn is terminal. Its visible source identity is resolved late from stable projected source/invocation metadata: browser/computer/native tool surfaces take precedence, then a trimmed server name supplies the fallback. The projection can consume normalized app metadata once Nodex supports ChatGPT Apps/Connectors, but that capability is currently disabled and production must not send `app/list`; existing and imported tool calls therefore degrade to source/server fallback identity. Chrome browser-use uses its bundled Chrome asset, while native Chrome remains a host-native app reference. Grouped facts, standalone icons, and summary sources consume that same identity; incidental raw item/app/logo fields never override it. Successful item-level app URIs still participate in the rendered resource scope. Dynamic tool output renders protocol text, image, and audio content without coercing media into text. Ordinary dynamic calls omit result/success except for create-thread and handoff-thread; dependency loading is hidden, and successful automation updates route to the scheduled-task model while failed/invalid updates stay hidden. Registered Codex-app task controls, settings reads/writes, and Chrome tab-context calls select their renderer by the exact `(namespace, tool)` pair. Their labels use task terminology, task reads/messages can navigate to their target, successful task creation becomes an openable resource card, and only registered activity flags may affect grouping or continuation. Collaboration `wait` is hidden, other collaboration activity respects the background-subagent gate, and web search retains its generated action and stays active only when it is the final non-user work item of an in-progress turn.
- Built-in Desktop Tools are supplied as one verified runtime closure containing
  the matching signed Codex CLI, Node, Node REPL, Browser plugin/client, native
  Browser PiP bridge, Computer Use plugin, `sky.node`, and signed Computer Use
  helper app when supported by the target architecture. Nodex development and
  release builds materialize that closure from
  one repository-controlled, dual-architecture release lock; ordinary startup
  never reads another installed desktop application. Thread start, resume, and
  fork receive the same trusted paths,
  hashes, backend list, and socket-directory allowlist through the public
  app-server config field. One authenticated native-pipe backend is created per
  Codex session and requires the current session and turn on every request.
  Artifact verification, backend `getInfo`, and plugin policy jointly determine
  the effective Browser API; an absent or unknown capability stays unavailable.
  The reserved bundled marketplace is reconciled to the verified local runtime
  source before plugin version checks; a stale source registration is removed
  through the app-server marketplace API and replaced within the same
  reconciliation before the next verification pass. Runtime verification and
  the supported platform resolve one host capability used by plugin eligibility,
  thread configuration, and native-pipe activation. Peer verification remains a
  separate transport policy so unpackaged development can use its private
  current-user socket without masquerading as a packaged build. When the host
  capability is unavailable, Nodex removes the managed Browser plugin and
  refreshes skills instead of offering an action that cannot discover a browser.
  A new task may have a provisional Project-Session pipe before its Codex session
  is known. Browser route capture returns only after Main has accepted the exact
  route; when the canonical session is linked, Nodex promotes and closes the
  provisional backend before publishing the canonical pipe and dispatching the
  first turn, even when captures overlap. Capture or promotion failure prevents
  that turn from starting but retains its Session/Thread link for retry.
  Projectless tasks use the same flow with `projectId: null`; a Project is not
  required for Browser discovery.
- On supported Apple silicon macOS hosts, startup verifies and atomically
  materializes `Codex Computer Use.app` beneath the active Codex home, exposes a
  private authenticated host-services socket, and enables the bundled Computer
  Use skill only after both the native host and materialized marketplace are
  ready. The host socket accepts only `ensureService` for `computer-use`; its
  manager reuses only a live non-zombie PID whose executable resolves to the
  canonical helper, respawns invalid state, and leaves the shared helper alive
  during ordinary runtime disposal. Nodex atomically maintains the helper's
  locale, direction, accent, and overlay text in the canonical Computer Use
  config. Nodex retains its pinned Open Interpreter app-server, while every
  Desktop Tool thread launches the shared `node_repl` through vendor-signed
  Node and Codex processes. This preserves Browser's peer ancestry and keeps
  Codex as the helper's immediate sender parent. The app-server-owned Codex home
  is the trusted Node REPL code root so the versioned installed plugin-cache
  copy used by agent skill paths retains the native bridge and runtime
  environment; Browser client code is additionally hash-allowlisted. Intel
  macOS and unsupported macOS versions omit Computer Use entirely while
  retaining Browser Use. Action
  approval and denial continue through app-server elicitation and native
  Computer Use errors remain typed tool failures.
- Settings -> Computer use shows the verified runtime state, global PiP
  always-hide control, approved applications, approved Messages threads, click
  sound mode, and Locked Use only when app-server config requirements allow it.
  Removing an approval updates the helper's App Group files; Locked Use invokes
  the nested verified installer and accepts only its exact installed status.
  Accessibility, Screen Recording, Automation, Escape cancellation, and user
  intervention remain native helper/plugin action-time behavior rather than a
  second renderer-maintained permission model.
- Browser origin approval uses the app-server's negotiated form-elicitation
  channel. Selecting Browser from the composer therefore supports the complete
  first-use flow—tool discovery, per-origin confirmation, native Browser
  navigation, and response—without asking the user to connect a separate
  browser. Full-page screenshots temporarily resize the current Browser guest
  through the shared webview manager, whether visible or retained, wait until
  Chromium reports the requested clip dimensions, and restore the ordinary
  viewport after capture.
- The Browser plugin owns its high-level Browser, Tab, Playwright, Locator, and
  CUA wrappers plus action-time confirmation. Main owns route claims, guest/CDP
  access, cursor, viewport and capture intents, one-use download grants, and
  deterministic turn teardown. A tab mention must match its Browser session,
  provider tab identity, title, and URL snapshot. Turn finalization distinguishes
  handoff, user deliverable, claimed user tabs, and unretained agent-created tabs;
  stale turns and owner/process teardown cannot affect the next turn.
- Multi-agent actions are standalone transcript activity. Their rich header starts collapsed even while an action is running, uses the action lifecycle and unique target count for its summary, shimmers only while work is in progress, and remains user-expandable. Expanded rows preserve per-agent lifecycle copy, prompt truncation/tooltips, model tooltips, friendly names, roles, and background-agent navigation context. Consecutive subagent activity is summarized as at most three inline identicon chips followed by any hidden-agent count and a shared `started working`, `updated`, `interrupted`, or `finished` status; selecting a chip opens that child with inline-activity context.
- Modern inline child agents use one root-scoped `Subagents` right-panel tab rather than one tab per child. Composer and floating-summary surfaces show one compact avatar/count action; the panel root groups active and completed descendants with lazy assistant-message previews, and selecting a row routes inside the same tab to the child's read-only transcript with a back header and no composer. Relationship discovery uses app-server source ancestry so nested descendants remain visible even when the root transcript has not been hydrated. Legacy non-inline collaboration agents remain individually listed and keep dedicated read-only child tabs.
- Renderable web searches remain individual leaves inside mixed activity groups. Each row shows its normalized action/query detail and uses the deterministic semantic web-search globe rather than depending on remote favicon discovery. Searches with a blank top-level query are hidden before grouping, even if secondary action metadata contains displayable text.
- Automatic approval review state comes from the canonical review payload. Approved and malformed reviews are hidden, in-progress reviews are groupable, and aborted, denied, or timed-out reviews are standalone. A review attaches to an exec, patch, or MCP body only through the target's canonical command-execution/call identity; attached approved reviews are removed before rendering. Visible review activity uses the reviewed action as its disclosure summary, the dedicated automatic-review glyph, and a nested title-first rationale row; attached rows remain inside the owning tool body.
- Thread activity uses one v2 visibility and presentation projection in production. Contiguous groupable command, materialized patch, non-empty web, ordinary MCP, dynamic, and eligible review activity first forms maximal mixed groups; reasoning is hidden and does not split a run, while app/computer-use MCP, handoff, collaboration, assistant, and other standalone items do. A settled ordinary singleton is then demoted to its family row, except active groups and special patch shapes remain grouped. Every group retains immutable full entries for lifecycle, completed facts, identity, and header icon plus an independently filtered expansion body. The parent presentation exclusively assigns live reasoning/`Thinking` to the latest open group's thinking header, a standalone fallback, or no surface; reasoning never becomes a tool fact or body row. React consumes these projected units without regrouping. Visualization/special-read filtering happens before classification, MCP app barriers update from live server metadata, and an immutable render revision keeps same-ID lifecycle/content updates fresh while streaming.
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
- Thread permissions are resolved from Codex app-server config (`config/read`) plus config requirements (`configRequirements/read`), then overlaid with the persisted selection for the active Project or the persisted projectless default. The selection is Workspace-owned, not renderer-local.
- Settings -> `Hooks` lists lifecycle hooks discovered by the Codex app-server for every non-empty project source root. It groups User/Admin config, plugins by protocol `pluginId`, projects by cwd, and session/unknown sources; warning-only and error-only roots remain visible. Source, project, plugin, and host selection are deep-linkable. Managed hooks are always enabled, new or modified hooks must be trusted before they can run, and trusted hooks can be enabled or disabled. Trust and enable writes update `hooks.state` through app-server config, update matching host views optimistically with rollback, then refresh every open window after a successful write.
- Thread stage and Settings -> `Agent` expose the same preset-backed permission selector with the exact visible modes `Ask for approval`, `Approve for me`, `Full access`, and `Custom (config.toml)`. Its menu title is `How should Agent actions be approved?`; option descriptions stay concise enough to preserve the intrinsic compact menu width, and `Full access` uses the warning treatment across its icon, label, description, and selected marker.
- Permission preset semantics:
  - `Ask for approval` resolves to `sandbox_mode=workspace-write`, `approval_policy=on-request`, `approvals_reviewer=user`.
  - `Approve for me` resolves to the same sandbox/policy pair, but with `approvals_reviewer=auto_review`.
  - `Full access` resolves to `sandbox_mode=danger-full-access`, `approval_policy=never`, `approvals_reviewer=user`; for each exact Project-bound Turn launched with this built-in preset it also allows every existing `nodex_app@5` read/write capability across the current Nodex Library without approval prompts. Projectless Full access changes Codex's sandbox only and never grants Project/Library authority.
  - `Custom (config.toml)` remains available whenever config contains explicit permission keys and the resulting raw permission state is allowed, even if those values are equivalent to a fixed preset.
- `features.guardian_approval` disables `Auto-review` only when it is explicitly false; missing feature metadata does not disable the preset. `configRequirements/read.allowedPermissionProfiles`, `allowedApprovalsReviewers`, `allowedApprovalPolicies`, and `allowedSandboxModes` still constrain availability. `auto_review` and the legacy/internal alias `guardian_subagent` are treated as the same automatic-review reviewer when reading config or requirements, but Nodex writes the public `auto_review` literal.
- Permission writes target the current config key origin when available; otherwise Nodex writes to the user config file instead of silently creating a project override from the thread footer. Preset selection is persisted in the active Project scope, or in the projectless default scope when no Project is attached.
- Settings -> `Agent` uses a split surface:
  - `Permissions modes` contains `Default permissions mode`.
  - `Custom config.toml settings` contains raw controls for `Approval policy`, `Sandbox settings`, `Allow network access`, and `config.toml`.
- New thread start, later turn start, queued follow-ups, and thread resume all inherit the same resolved `approvalPolicy`, `sandbox`, and `approvalsReviewer` values from the main-owned permission resolver.
- Nodex content authority is frozen separately for each exact Turn. Switching the selector while a Turn is running does not change its queued or pending Nodex calls; the next Turn uses the new mode. Raw Custom configuration follows the app-server config scope, while the selected `custom`/preset value is stored in the active Project scope or projectless default scope. A background app-server child may inherit its parent Turn once; an independent `codex_app create_thread` task does not.
- While `Ask for approval` is active and Auto-review is available, three successful manual approval or permission responses in the same thread arm a standalone `Want fewer approval prompts?` offer. The offer replaces the normal composer only while that thread is idle, takes priority over active and background request cards, and is cleared when the permission mode changes. `Approve for me` switches to the Auto-review permission preset; `Keep manual approvals` permanently dismisses the offer across threads and clears every accumulated thread count.
- Approval requests stay in the underlying transcript flow instead of opening a separate approval screen:
  - command approvals project a pending exec request row whose call ID targets the raw command owner; generated command items and timestamps remain unchanged
  - file approvals attach to the last matching file-change row
  - automatic approval review rows use the synthetic item id form `automatic-approval-review:{reviewId}`
- Pending user-input requests project a standalone question row and are replaced by the completed response row after submission. Permission requests reuse their request-ID-matched synthetic row. Reopened history and main-owned live ingress use the same request projector, preserve numeric request IDs, and never invent an item for a missing target turn.
- Thread stage composer exposes provider, model, effort, and model-advertised speed selection through one compact model footer control. The trigger shows the current model plus effort and places the Fast lightning before the model whenever the effective service-tier option is semantically `Fast`, independently of whether its runtime wire id is `fast`, `priority`, or another catalog value. Its 224px root menu uses right-aligned current-value summary rows, and each configurable field opens one dedicated flyout. Provider is a root field instead of a branch inside Model, Model lists only the selected provider's models in catalog order without promoting the current selection, and Speed appears only when the selected model advertises multiple service tiers. New-thread drafts use the runtime provider catalog filtered to OpenAI, Anthropic, Kimi For Coding, Moonshot, and OpenRouter, persist the compound provider/model selection locally, preserve runtime-provided case-sensitive reasoning values and display labels, and automatically use the model's recommended harness. Ready credential states stay visually quiet; a provider that needs a key opens the shared modal credential flow, sends the key only to main, and becomes selected only after setup succeeds. Existing threads keep provider and harness fixed, but may change effort, service tier, and any current-provider model whose catalog `switchPolicy` is `same-thread`; those choices are one compound next-turn settings update, keep the menu open, and become the thread's durable defaults after validation. Models marked `new-thread` and all provider changes remain disabled with a new-task explanation. An imported or older thread without a stored profile derives its active selection only from its own model provider and live thread settings; it never borrows the global new-thread draft. The legacy OpenAI `model/list` and next-turn model path remain as a compatibility fallback when the provider catalog is unavailable.
- Fast-mode core enablement is global, not per-thread. Detailed persistence, UI, request-resolution, queue-freezing, and reporting rules are defined in [Codex Fast Mode Core Enablement](./codex-fast-mode-core-enablement.md).
- New thread-start requests inherit the persisted global `serviceTier` when callers do not provide one explicitly. Existing threads instead use their own latest service tier, so changing one task cannot silently change another; `null` is the durable standard tier and is sent when necessary to clear a previous fast tier.
- Thread stage composer exposes collaboration mode presets (`Default`, `Plan`) sourced from app-server `collaborationMode/list` with a client fallback to `Default` + `Plan` when unavailable. Existing thread composers reflect `conversation.latestThreadSettings.collaborationMode` live, with `conversation.latestCollaborationMode` retained only as a derived compatibility value; new-thread drafts reflect the selected draft mode until the thread is created.
- Existing-thread collaboration mode selection is thread-owned next-turn state. Plan mode can be toggled from `Shift+Tab`, the add-context menu Plan row, the active Plan chip, `/plan-mode`, or the `plan` keyword suggestion above the prompt editor, and all entry points call the same toggle action.
- Thread and turn start requests resolve model, reasoning effort, and collaboration mode in this order: explicit prompt/submit override, latest thread settings, derived latest collaboration mode, then selector-resolved new-thread defaults. Empty or unavailable model selections are omitted from app-server payloads so Codex config remains the fallback authority; Nodex must not hardcode a concrete fallback model id. `Plan` mode sends built-in collaboration mode instructions by passing `developer_instructions: null` and enables clarifying-question flows through `item/tool/requestUserInput`.
- A profile-backed task durably stores `providerId + modelId + harnessId + reasoningEffort + serviceTier` in Rust Core. `providerId + harnessId` are the immutable runtime binding; `modelId + reasoningEffort + serviceTier` are the mutable, validated next-turn intelligence defaults. Main carries the resulting tuple through session starts, cold resume, persistent and side-chat forks, dynamic child creation, heartbeat turns, and cron runs instead of mutating Open Interpreter's process-global provider/model/harness settings. Compatible intelligence changes update app-server thread settings and the Core tuple together, while provider/harness changes require an explicitly independent task. Child/fork paths inherit the latest durable source profile. The embedded Agent's writable home is `${NODEX_HOME}/agent`, and ordinary runtime recovery never reads another agent home.
- Before starting or restarting the embedded Agent, Nodex fills missing `${NODEX_HOME}/agent/config.toml` feature defaults for `unified_exec`, `shell_snapshot`, `multi_agent`, `prevent_idle_sleep`, and `respect_system_proxy`. Explicit user values remain authoritative, unsupported or retired feature keys are not introduced, and isolated Profile config copies use the same defaults.
- Settings -> `Import` is the only external-agent migration boundary. The user chooses Claude Code, Codex, or Open Interpreter, explicitly scans a default or selected home, reviews supported categories, and applies a subset. Scans expire and raw app-server migration payloads stay in main. Claude sessions/configuration use the runtime importer; Codex-compatible sessions use `thread/fork(path)` so ThreadStore creates independent target Threads. Instructions, skills, hooks, and subagents never replace existing targets; native config import is limited to absent passive preferences and sanitized missing MCP definitions. Provider credentials, OAuth/subscription state, provider/model selection, approval/sandbox policy, SQLite databases, and journal files are never imported. Imported conversations are initially projectless and have no durable execution profile; choosing a current provider/model when continuing establishes new execution semantics without rewriting the imported history.
- Thread stage composer places the add-context trigger and permission selector on the left side of the composer footer, while context usage, compact model/effort/speed, dictation, and send/stop controls sit on the right. When Plan mode is active, its direct toggle appears as a footer accessory after the permission selector with a subtle vertical divider before it. The compact `+` trigger preserves editor focus and dispatches a synthetic activation into the same ProseMirror suggestion controller that owns typed `@`, `$`, and `/`; every mode therefore shares one transaction-mapped range, dismissal model, keyboard owner, and composer-width surface. Context and slash surfaces are bounded to 320px; on the new-chat home the context surface additionally reserves 46px of composer chrome and an 8px gap after applying window zoom, while the heading-free `$` Skills-and-Apps surface is bounded to 240px and shows each skill scope or `App` at the right edge. Empty `+`/`@` context queries render Add actions in product order (`Files and folders`, an available macOS `Attach <App>` Appshot target, `Work in a project`, `Goal`, `Plan mode`, `Record a skill`), followed by app-server Plugins, accessible Apps, up to two Sites, up to five recent ChatGPT conversations, and the Files-and-chats search prompt. `Work in a project` replaces the root rows in the same surface with `None` and ordered Project choices, then closes after selection; it never stacks another popover. Skills and local Chats join only non-empty global searches, which remove section labels, rank every provider together, and expose at most eight rows. Search gives matching Plugin and App prefixes precedence, keeps remote conversation results in provider order, debounces ChatGPT search by 100ms, and never lets a stale async provider result satisfy a newer query. Arrow keys wrap the highlighted row only when rows exist, Enter or Tab selects it, Escape dismisses the current match, slash Backspace returns from a source or closes an empty synthetic slash activation, pointer rows preserve editor focus, and normal editor blur owns outside dismissal.
- Composer plugin, app, file, chat, site, and skill selection are inline atomic prompt mentions rather than ordinary text plus attachment chips. Main derives renderer-safe plugins from `plugin/installed`, enabled skills from `skills/list`, and retains no local plugin package path in renderer state. The Plugin inventory preserves marketplace order, excludes administrator-disabled entries and installed-but-disabled generic entries, and also includes explicitly requested uninstalled suggestions such as Browser, Computer, Spreadsheets, and Presentations. Selecting an uninstalled suggestion inserts its mention while main installs it from the exact local path or remote marketplace, force-reloads skills, verifies the enabled state, and invalidates active Plugin/Skill queries. `record-and-replay` is projected only as `Record a skill`; that action may also re-enable its installed plugin through `plugins.{id}.enabled`, then opens a new chat in the selected Project with `[@Display Name](plugin://{id})` plus the first non-empty catalog default prompt. Plugin mentions use canonical `plugin://{pluginId}` URIs, apps use `app://{appId}`, local files keep their path, local chats use `thread://{threadId}`, and external conversations/sites keep their protocol URI. Prompt links preserve the transport-stable name: plugins and agents use `@name`, apps and skills use `$name`, while files, sites, and external conversations use an unprefixed label. The atomic node separately owns display name, description, icon, and brand metadata; inventory refresh reconciles that metadata after draft hydration without rewriting the stable prompt link. Submit/queue/steer extracts non-skill nodes into app-server `{type:"mention",name,path}` inputs and skill nodes into `{type:"skill",name,path}`, so visible state, persisted draft state, and transport state cannot diverge.
- Sites and ChatGPT conversation discovery remain authenticated main-process capabilities. Renderer receives only typed, bounded suggestion rows: main checks ChatGPT authentication, resolves the configured ChatGPT origin, verifies Sites access before calling `sites_list_sites`, and lists recent or query-matched conversations through authenticated desktop requests. Auth tokens, integrity headers, raw tool responses, and ChatGPT configuration never enter renderer state. Unavailable capabilities omit their sections instead of showing inert rows.
- A macOS Appshot is a real prompt attachment, not a UI toggle. While Nodex is unfocused, main tracks the most recent external foreground window through the packaged native helper; the public menu row receives only an opaque target id, app identity, window title, and small icon. Capture revalidates that handle, resolves the exact Electron window source, obtains a high-density screenshot and app icon, and combines them with a bounded Accessibility tree from the helper. The attachment is generation-fenced against stale async capture, persists and clears with the same Composer draft lifecycle as other completed context, and submits both the screenshot image input and application additional context headed `# Applications mentioned by the user:` with escaped `<appshot app="…" bundle-identifier="…" window-title="…" image="…">` metadata. Missing Screen Recording access or an expired handle fails without mutating the draft.
- Thread stage composer input is a ProseMirror-backed contenteditable prompt editor. Its suggestion plugin state records activation (`synthetic` or `typed`), trigger, query, anchor/range, source, and dismissed match through transaction metadata and maps live ranges through document changes. Blank new-chat drafts show the `Do anything` placeholder, existing threads show `Ask for follow-up changes`, and active Plan mode shows `Describe your task to generate a plan...`; dictation/attachment/send behavior uses the same normalized prompt flow as before. Logical newlines use paragraph boundaries, so Backspace/Delete merge adjacent lines and remove empty lines through the editor transaction model while an empty composer retains one editable line.
- Composer prompt text hydrates before the editor mounts and persists by Composer identity, plus an attached thread alias, so it restores after task switches, renderer restarts, and updates from another open window. Inline capability mentions restore through that prompt document; completed files, images, Appshots, pasted text, review comments, and goal mode restore while their Composer scope remains retained. Successful send, start, queue, steer, side-chat creation, and goal actions clear the submitted text and completed context only after the awaited action succeeds; confirmation-only, preparation, permission, materialization, transport, and server failures preserve the draft. Explicit composer intents are consumed once: non-empty text replaces, ordinary empty text leaves the current prompt intact, `clearText` deliberately clears it, and attachment context declares append or replace semantics.
- Attached thread transcripts create their virtual layout immediately at every history size rather than delaying the entire body. On unmount they capture native bottom distance, latest-turn progress/phase/follow geometry, rendered anchor/window, and measured turn heights as one renderer-memory snapshot keyed by thread; remount restores the same snapshot before paint and treats 24px or less as bottom. Response-spacer height is removed from the saved distance. Agent-activity collapse choices are thread-and-turn keyed user overrides over the semantic default, including the MCP App latest-turn exception, and transcript/collapse state is removed only when the canonical thread is deleted.
- Thread stage composer supports thread prompt recall from an empty draft. With the cursor at the end and no modifier keys, `ArrowUp` first edits the latest visible queued follow-up when the composer has no prompt or attachments and no busy/slash-menu state; otherwise it restores the newest persisted prompt-history entry. Additional `ArrowUp`/`ArrowDown` presses wrap through the scoped history, `ArrowDown` from the newest recalled entry clears the composer, manual edits exit traversal, and successful prompt submissions append non-blank text to the current scope's latest 20 entries. This prompt history is local UI persisted state, separate from thread/conversation history and app-server APIs.
- Typing a slash token at the start of the prompt or after whitespace activates the shared editor suggestion controller in slash-command mode. The surface uses grouped fuzzy filtering, preserves a keyboard-highlighted row, supports ArrowUp/ArrowDown/Enter/Tab/Escape, mouse hover/click selection, `No commands` empty state, nested content panels for commands such as Model, Reasoning, Fork, MCP, Memories, Feedback, Project, and Personality, and direct mode commands such as Goal. Goal remains available in existing threads that support thread-goal actions and in pre-start new-chat surfaces that can start a session thread; selecting it enters goal mode, and new-chat submit carries the objective as a thread-goal draft for post-create goal setup. Direct commands clear the slash token before running. Plugins, files, and chats belong to `@`/`+` context providers; skills and apps are also available through the dedicated `$` surface rather than being duplicated as slash commands. Context-conflicting command rows such as projectless Chat and hotkey-window commands remain hidden until their Nodex runtime path exists.
- New-worktree goal drafts freeze pasted-text and image references before setup begins. Raw pasted sources survive setup failure, Retry, and Continue so a failed launch remains recoverable; they are removed best-effort after success, Cancel, Dismiss, or Work locally. Goal files copied into a realized thread remain available to that thread. Work locally starts from the original frozen prompt and attachments without promoting the pending draft into goal metadata.
- Thread stage composer shell uses static chrome: rounded input background, subtle ring, backdrop blur, and a fixed shallow shadow with no added focus-within elevation when the editor is active.
- Add-context picker non-image files become prompt mentions, picked images are read as data URLs and sent as image inputs, and picker attachments remain separate from paste/drop/Add-to-chat file provenance. Running-turn steer sends the same normalized prompt input shape as normal turns; unaccepted steers are restored as queued follow-ups if the active turn ends too early.
- Thread stage request ownership has three states: normal composer, Auto-review offer, or request stack. The Auto-review offer is exclusive while idle. Otherwise a background child approval or permission is rendered before the active thread request, and both may coexist; private child input, picker, setup, MCP, or plan requests never own the parent composer. Any replacement removes the normal editor, attachments, add-context, permission, context, model selector, dictation, and send/stop footer controls while preserving queue, background-agent, terminal, goal, and other above-composer lanes.
- Thread stage composer lower status row is a pre-start new-chat-only backplate mounted before and behind the raised home composer surface through the composer-owned external footer slot. It shows the selected project when available, the local run target (`Work locally`) or `Start in` selector, optional environment selection for `New worktree`, and the real Git branch for the selected primary source. It remains orthogonal to composer ownership, so a new-thread replacement keeps the strip; once a conversation exists, existing-thread composers synchronously unmount it instead of retaining it for an exit animation.
- Thread stage composer shows the context-window meter tooltip from the composer footer: unavailable data falls back to `0% used (100% left)`, ready data rounds token counts to whole thousands, usage below `50%` reads `{usage}% used ({remaining}% left)`, usage at or above `50%` reads `{usage}% full`, and the `Codex automatically compacts its context` line appears only for ChatGPT-authenticated sessions without an explicit `modelProvider`.
- Thread stage composer includes dictation as a separate buffered speech-to-text feature in Electron: the mic button is shown in supported ChatGPT-authenticated sessions, tooltip copy is `Click to dictate or hold`, `Ctrl+M` starts on keydown and stops on keyup with `insert`, button click starts recording, recordings shorter than `250ms` are discarded locally, and stop actions stay split between `Stop dictation` (`insert`) and `Transcribe and send` (`send`) before one bounded, sender-validated IPC command returns transcript text. The active waveform is a ten-second rolling audio window with one compact bar per four CSS pixels; it advances according to captured sample time rather than audio callback frequency, preserves a quiet visible baseline, and redraws at device-pixel resolution.
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
├── crates/
│   ├── nodex-cli/              # Native agent-facing CLI
│   ├── nodex-core/             # SQLite/Yrs authority and six deep Modules
│   ├── nodex-core-contracts/   # Versioned semantic Module contracts
│   ├── nodex-core-protocol/    # Generated transport envelopes/OpenAPI source
│   └── nodex-core-server/      # Profile-private authenticated UDS process
├── .github/
│   ├── actions/
│   │   └── finalize-sparkle/   # Protected appcast and delta finalization steps
│   └── workflows/
│       ├── ci.yml              # Stable CI / required source gate
│       ├── _macos-distribution.yml # Shared native dual-architecture builds
│       ├── _assemble-release.yml # Secret-free verified Bundle assembly
│       ├── release.yml         # Protected-main version-transition promotion
│       └── release-recovery.yml # Exact-SHA idempotent recovery
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
│   ├── release/               # Release Identity, Bundle, publisher, and Homebrew Module
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
│       │   │   ├── page-create-dialog.tsx # App-owned Project Page creation workflow
│       │   │   ├── page-create-description-editor.tsx # Renderer-local NFM draft surface
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
Core commit → ApplyResponse delivery → origin renderer LocalCommit ingress
            → scoped live broker → Main recipient ACK/reset → other renderers
            → durable stream replay/checkpoint deduplicates and repairs later
```

Primary Page Document edits use the independent binary collaboration plane:

```
Page Stage Y.Doc transaction → Core Document apply → serialized SQLite commit/ACK
    → same-head Page materialization + sealed projection effects
    → mounted editors apply remote origin; exact Page/Database reducers apply or repair
```

Each LocalCommit identifies affected resources and seals exact per-scope projection effects at commit time. The global stream coordinate is replay progress only. A renderer orders a derived model by its Core-owned scope revision/hash, applies a complete effect immediately, and uses a canonical floor read only for gaps, resets, integrity failures, or an explicitly incomplete patch. Database View groups and group windows must share that exact authority; mixed snapshots are discarded. A committed title/body/ownership/membership change therefore converges across app windows without save, focus change, remount, manual refresh, or a visible pending projection.

Each editor surface subscribes before its state-vector handshake. A successful subscription ACK proves that surface's exact authenticated Core stream is open. Retryable physical interruptions remain inside one logical subscription, resume from its accepted cursor, and pause dependent sync/mutation commands until reconnection. A terminal failure releases the exact session so Reload or a replacement surface can subscribe cleanly. Session-qualified connection state and serialized local teardown prevent a retiring surface from disconnecting its replacement. Missed or reordered Document updates are repaired by a later handshake; a fast successful ACK shows no save indicator. The global Core event stream replays from its last accepted sequence, and a retention gap emits a scoped `event_gap` resync.

Agent-facing body edits use ordered stable-ID Document operations (`set title`, `insert`, `update`, `delete`, and `move`) against the current Page Document. A batch either commits its Yjs update, Block registry/indexes, projections, mutation receipt, and change cursor together or changes nothing. Identity-destructive operations use Core's structural-barrier ledger and generation/head CAS; a mounted surface may flush local updates but is never frozen or asked to submit a writer proof. Whole NFM input is an explicit compare-and-swap import; an owning `<page uuid="..." />` may pin only an existing Page shell in that same Document.

Electron exposes this contract as `block-documents:mutate`; the native CLI calls Core directly over its private UDS contract. Client-supplied `actor`, `clientSessionId`, Project, or Document scope cannot mint authority: Main binds audit identity and scope before Core validates the request. The response is a typed immutable receipt or typed conflict; structural-barrier evidence is Core-owned and never crosses the renderer boundary as proof.

The renderer transport requires the Electron preload bridge and has no browser or localhost fallback. Private Host/Core transport is version 8, committed events are version 8, authorized delivery packets are version 4, and semantic Module versions are selected independently from generated requirements. Renderer audiences subscribe to at most 200 logical Library/Project addresses; only Core-issued recipient leases bind those addresses to authorization scopes. Two windows on one address receive independent delivery/ACK state; a later window receives the retained lease's barrier-floor reset before ordinary packets, and a destroyed window retains no retry timer or delivery state. Ordinary Core JSON requests/responses are capped at 2 MiB/16 MiB, while user-growing collections use at most 200 items and 1 MiB per signed-keyset window; 16 MiB is a fault boundary, not a product capacity target.

Codex Threads emit a separate Electron IPC stream (`codex:event`) from the main-process Codex domain service.

---

## CLI Reference

The packaged native `nodex` binary is a UDS client of the detached Rust Core. The app bundle is the one distribution and update closure for the CLI, Core, ripgrep, migrator, and ServiceManagement helper: Homebrew Cask links that bundled binary into the Homebrew prefix, while the macOS application menu's `Install Command Line Tool…` action creates or updates `~/.local/bin/nodex`. Neither path copies a standalone binary. The app action never edits shell startup files, reports when `~/.local/bin` is absent from `PATH`, and refuses to replace a non-symlink or a symlink not previously managed by Nodex.

`nodex capabilities --json` is the side-effect-free Agent handshake. It succeeds
before current-directory lookup, Profile configuration, Project selection, or
Core launch and reports Agent API revision `1..1`, Nested Markdown revision 2,
the command capability revisions implemented by that exact binary, supported
deep-link kinds, and the adjacent packaged Skill bundle identity when present.
An unpackaged development binary reports `bundle.status = unavailable` rather
than creating `~/.nodex` or failing. `nodex --json <command> --help` returns the
same registry's effect, required validators, result schema revision, stable
error codes, and parseable example; root and command-group help list their exact
leaf commands.

`nodex view query <view> [--group <stable-key> | --unassigned] [--after
<cursor>] [--limit 1..200]` resolves either a canonical `@View` ID or an exact
unique View name across the selected Project's authorized Databases. Core
returns the Database/Data Source/View descriptors, persisted filter/sort/group/
display config, projected Property definitions and option labels, bounded group
totals, and one row window from one read transaction. CLI JSON revision 1 keeps
stable group keys distinct from display labels and returns each row's opaque
move ETag plus the signed continuation cursor and projection revision.
Unauthorized descriptors and candidates are never emitted; tampered or
cross-View cursors fail closed. The CLI does not accept ad-hoc filters or
reimplement saved View ordering.

`nodex open page <page> [--print]` and `nodex open view <view> [--print]`
accept typed selectors only. Both select one Project and require a successful
Project-bound Core read before returning or launching the canonical
`nodex://pages/<encoded-id>` or `nodex://views/<encoded-id>` URL. `--print`
performs validation but never launches; `--json` changes only the output
envelope. On macOS the default launch invokes the fixed `/usr/bin/open` binary
with one URL argument and no shell. Other platforms return the URL with an
explicit unsupported-launch status. Desktop resolves incoming View links
through a trusted-root Core location projection that requires the active
View/Data Source/Database/Project chain, then selects that Project and focuses
an existing exact saved-View tab or creates one. Deleted or unauthorized
resources fail closed, and callers can never supply an arbitrary launch URL.

The CLI selects the Profile home with the same bootstrap precedence as Electron: nonblank `NODEX_HOME`, nearest project `.nodex/config.toml` over user `~/.nodex/config.toml`, then the default `~/.nodex`; config files are UTF-8, size-bounded, and malformed TOML fails closed instead of silently connecting to another Profile. It resolves a Project from an explicit unique ID/name, otherwise the longest containing managed-worktree root before considering the longest source root; equal candidates fail with stable IDs. `context`, `tree`, and `rg` honor one global `--database` exact ID/unique name or `--page` stable ID/title path, with the primary Database as default. Full Page IDs use `@<id>`, and exact authorized `/`-separated title paths never expose unauthorized candidates. `nodex read <page>` returns canonical `body.nested.md` bytes with a final LF; `--meta` returns the deterministic typed `meta.yaml` projection. Ordinary reads emit no validator, while `--prepare title.set`, `document.replace`, `page.delete`, or `page.move` asks Core for only the compatible narrow ETag. `page.move` accepts an optional explicit `--view @<id>`; without it, an active Data Source Page binds its current default View, while a Page outside a Data Source binds no View. `nodex sed -n '<line>[,<line>]p' <page>` selects from those exact body bytes. `nodex history` returns the retained typed cursor timeline, and `nodex tree [scope]` traverses the selected Database or one authorized Page with fixed depth/node/cycle bounds. `--json` wraps stable machine output and errors; rejected commands exit 2.

`nodex rg [flags] <pattern> [scope]` asks Core for a strict, immutable search lease over the selected primary Database, Database, Data Source, or Page. Core authorizes the complete recursive Page set and projects canonical `meta.yaml` plus `body.nested.md` bytes and their ownership/revision manifest inside one SQLite read transaction without reconstructing Yrs. Metadata and body files are cached independently by projection version and content hash, hard-linked into a current-user read-only lease on the same filesystem, and never accepted back as write input. A released unchanged tree is reusable only after Core revalidates every file; reuse assigns a fresh random lease and manifest while removing the old physical path. The CLI validates the commit marker, expiry, permissions, paths, byte lengths, and SHA-256 hashes before launching the bundled real ripgrep with no config and only the documented read-only flag subset. It remaps opaque physical names to sanitized logical ownership paths containing each full Page ID, preserves ripgrep status 1 for no matches, reports stale materialization as `MATERIALIZATION_STALE`, and releases the lease after success, failure, or SIGINT.

`nodex draft create <page> --output <empty-directory>` creates an explicit bounded one-Page editing workspace containing an immutable `base/`, editable `work/`, and a private manifest; it is never a checkout or authority. `draft diff` is local and compares parsed metadata semantically, so comments, quoting, and key order are ignored. Version 1 permits only the inline-Markdown title and `body.nested.md` to change: Page identity changes, property/schedule edits, unsafe paths, symlinks, unknown entries, invalid YAML, non-canonical UTF-8/LF body bytes, and configured size excess fail before mutation. `draft apply` rereads current Page authority, preserves unrelated property/schedule changes, expands base-to-work body hunks until they are unique against current content, and falls back to whole-body replacement only while the original body ETag remains current. Title and body commit atomically in one Owned Document mutation. A deterministic operation ID plus the local pending/applied receipt marker makes response-loss retry exact; changing accepted work after apply starts requires a new draft. `draft discard` works without Core and removes only an exactly validated generated layout.

`nodex service status|enable|disable` manages only optional startup prewarming and does not connect to or start Core as part of the control command. Packaged macOS 13+ builds use a signed `SMAppService` LaunchAgent with no KeepAlive or elevated helper. Enable records the currently selected Profile and launches the same `nodex-core` executable; disabled, approval-required, unsupported, and unavailable states remain successful status outcomes because every normal command retains the authenticated on-demand startup path.

`nodex page create` accepts one inline-Markdown title plus bounded Nested Markdown from a file/stdin or an explicit empty body and targets the Library, an authorized Page, or a Database/Data Source owner. Core deterministically allocates the Page, Document, and recursive body Block identities from the idempotent operation, commits their complete genesis and projections together, and retains the exact IDs and initial title/body ETags in the replayable Library receipt. A Data Source target may name an explicit `--view` and stable `--group` or `--unassigned`; it stages complete genesis in the destination Database's storage Project and atomically replaces the temporary Library placement with membership, built-in values, grouping Property value, and View position. `nodex page duplicate` supports the same Data Source placement flags. Those flags reject Library/Page destinations, group and unassigned are exclusive, and a sibling anchor must resolve inside the selected View/group. Omitted View/group preserve the existing default semantics, including `triage` for a new built-in status row.

`nodex page move` additionally requires `--if-match <move-etag>`. A current saved-View row supplies it through `view query`; moving a Page into another View uses `read --prepare page.move --view @<target-view-id>`. The signed authority covers Project, Library, store epoch, Page shell, active membership, selected View revision, grouping Property/value revision, and current position/group/rank. After resolving the destination inside the same writer transaction, Core recomputes that exact validator and rejects stale intent before changing ownership, membership, grouping value, or position. Same-Data-Source moves keep parent and membership authority stable while atomically changing the grouping Property and View position; cross-owner moves use the structural transfer aggregate. Success returns final Page location, optional View/group/position revision, a fresh Page-shell ETag, and a fresh move ETag in the connection-independent receipt; an exact retry returns that stored result even though current authority has advanced. No command composes separate Database value and position mutations.

`nodex page delete` requires the narrow Page-shell ETag produced by `read --prepare page.delete`, recursively tombstones only through the protected Page lifecycle aggregate, and preserves exact replay after deletion. `nodex page title set` and `nodex page replace` require the corresponding narrow title/body ETag; an empty replacement clears the Page while retaining its authority-owned editable seed. `nodex patch` accepts the bounded one-Page patch language and preflights every old fragment against the same canonical body: each must match exactly once and no two hunks may overlap. `nodex page insert` accepts only stable start/end/before/after/inside anchors and rejects empty or whitespace-only input; an intentional empty Block must be `<empty-block/>`. `nodex block insert|update|move|delete` consumes a bounded closed JSON semantic draft or patch only where Block structure requires it; Core allocates actual Block identities, update guards cover intrinsic Block fields, and delete guards cover the complete subtree. Core repeats all checks against current authority and commits the collaborative update, materializations, history, receipt, and event atomically. Every mutation accepts a stable idempotency key; generated keys are diagnostics only, and a lost-response retry from another CLI process returns the original receipt even though the connection and current Document head changed. Compact results include affected Block IDs and fresh ETags for each changed semantic unit. File/stdin content is bounded UTF-8 with LF endings, and a missing source on an interactive terminal rejects instead of waiting. Decoded Document semantic strings are capped at 8 MiB; their JSON transport has a separate 64 MiB encoded bound so valid content cannot be rejected merely because JSON escaping expands it.

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
```

These can also be set via the `[server]` section in config.toml. Env vars override TOML values.

In the desktop app, Settings -> Backups updates `~/.nodex/config.toml` `[server]` backup fields and reapplies the auto-backup scheduler immediately. If `NODEX_BACKUP_*` environment variables are set, those values remain effective and the UI marks the overridden fields.

In the desktop app, Settings -> General -> `App updates` updates the user-level `~/.nodex/config.toml` `[server].app_updates_auto_check_enabled` flag. Unpackaged/non-macOS runtimes and packaged apps running outside an Applications folder report updater support as unavailable and do not perform background checks.

In the desktop app, Settings -> General -> `Diagnostics` updates user-level `[server]` fields for `diagnostics_enabled`, `diagnostics_dsn`, `diagnostics_environment`, `diagnostics_traces_sample_rate`, `diagnostics_replay_enabled`, `diagnostics_replays_session_sample_rate`, and `diagnostics_replays_on_error_sample_rate`. Diagnostics and Session Replay are disabled by default; Replay is a separate renderer-only opt-in that only runs when crash diagnostics are also enabled. When diagnostics are enabled without an explicit DSN, Nodex uses its bundled Sentry project DSN. Env overrides win and the UI disables overridden controls.

In the desktop app, Settings -> General -> `Telemetry` updates user-level `[server]` fields for `telemetry_enabled`, `telemetry_client_key`, `telemetry_environment`, and `telemetry_auto_capture_enabled`. Product telemetry and web analytics are disabled by default, and settings changes apply after restart. When telemetry is enabled without an explicit client key, Nodex uses its bundled Statsig client key. The renderer dynamically loads Statsig only when telemetry is enabled, passes no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. `Share web analytics` is a separate opt-in that only runs when product telemetry is enabled; it disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical signals such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events remain blocked by default. Nodex does not use Statsig Session Replay in v1; renderer replay remains the separate Sentry diagnostic opt-in. The bundled Browser automation runtime independently disables its own ambient analytics and diagnostics network; enabling Nodex telemetry does not enable that runtime traffic or affect page navigation and browser control.

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
pnpm run package          # Build + create the macOS DMG in dist/
```

The notarized DMG is the direct-install artifact. A first launch outside an
Applications folder can move the app through Electron's native installation
gate; replacement is rejected while the installed Nodex copy is running.
Homebrew installs the same DMG-backed `Nodex.app` and links its bundled CLI.
Both channels retain Profile data on uninstall. A production app uses its
architecture-specific signed Sparkle appcast, downloads a binary delta when a
verified compatible predecessor exists, and automatically falls back to the
signed full ZIP otherwise. Local/dev packages carry a disabled update channel
and never contact the production feed. Installers and updaters never
inspect, copy, or migrate `~/.nodex`; Core performs any recognized Profile
migration behind its snapshot, staging, validation, and rollback boundary.

Local source deployment is a single fresh-build operation:

```bash
pnpm run install:local:mac -- --install-cli
```

Without `--app-path`, the deployer rebuilds the Electron output and native
runtime, verifies the prepared source closure, packages into a new unique
`.generated/local-install/` directory through electron-builder's unpacked-app
target, and never reads a persistent `dist/` bundle. Every package carries a
signed build-provenance record binding the prepared source generation,
`app.asar`, the disabled Sparkle runtime metadata, and final signed native,
Agent, Browser, and Sparkle artifacts. The same identity is reverified on the source,
staging, and installed copies without starting a temporary Core or executing
release smoke workflows.

The deployer defaults to `/Applications/Nodex Dev.app`, uses `ditto`, preserves
the previous destination as a rollback app until the installed copy verifies,
and requires `--allow-production-destination` before it can target
`/Applications/Nodex.app`. `--app-path` is an explicit external-artifact mode:
it skips rebuilding but still requires a self-consistent package provenance
and complete structural native-runtime verification. The deprecated `install.sh` only
forwards to this command; it no longer installs dependencies, builds, runs
`pnpm link`, installs skills, or deletes the production app.

To release a new version, prepare an explicit metadata-only PR:
```bash
# 1. Update CHANGELOG.md under ## [Unreleased]
# 2. From a clean branch based on protected main:
pnpm release:prepare -- 0.2.1
# 3. Verify that only package.json, Cargo.toml, Cargo.lock, and CHANGELOG.md changed:
pnpm release:check -- --base origin/main --worktree
# 4. Open and merge the reviewed PR after CI / required succeeds.
# 5. The protected-main CI completion automatically runs native arm64/x64
#    Distribution, finalizes signed appcasts, creates the tag last, publishes
#    the immutable Release, and updates Homebrew and the stable Pages feeds from
#    the verified Release Bundle.
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

Nested Markdown is the primary Agent bulk-content representation and uses the compact wire name `markdown`. It is ordinary Markdown plus Nodex tags, with one literal tab per child Block level; spaces remain authored content and do not nest. Blank physical lines are formatting trivia rather than Blocks, and `<empty-block/>` is the only explicit empty Block. For example, the string `"▶ Toggle title\n\tChild paragraph\n\t- [ ] Child task"` creates a toggle with two children. Read results are either complete canonical content or a typed size error; truncated content is never writable. One `create_pages` call can therefore build several full many-Block Pages, while one `update_page` call can append a complete non-empty Block forest or apply multiple non-overlapping exact `oldMarkdown`/`newMarkdown` replacements against the same current source without carrying a whole-Document revision. Empty strings remain valid for Page creation, whole replacement, and a patch's final whole-body result; insertion rejects an empty or whitespace-only forest with `<empty-block/>` guidance. Structural insertion uses Document start/end or stable Block anchors, never character offsets or fuzzy ellipses. Whole replacement cannot implicitly create, copy, move, or delete an owning Page; ownership changes use `move_pages`/`duplicate_page`, and protected deletion remains explicit.

Page titles are direct inline Markdown strings, not `{ kind: "plain" | "rich" }` trees. The supported single-line subset preserves text styles, links, thread mentions, and date mentions. Block syntax, attachments, Page mentions, tabs, and newlines fail validation rather than being silently flattened. Title and body keep separate ETags.

ETags and cursors are opaque proofs, not capabilities. An ETag is a fixed 48-character digest that binds one internal guard kind, actor Project, store epoch, resource identity, and current semantic state without embedding that state. Cursors use a separate self-contained format because pagination must recover offset and snapshot coordinates. Stale, tampered, cross-resource, cross-Project, membership-ABA, and post-restore reuse fails closed. Dynamic-call receipts bind the app-server thread/call identity and exact-Turn authority fingerprint separately from canonical mutation receipts, so an exact retry can recover a committed sparse result before validating current guards and without storing body content or hidden document history in the receipt ledger. Historical committed receipts without provenance remain replay-only; historical prepared receipts must be restarted.

The current Codex dynamic-tool transport returns JSON text. In Code Mode, parse each result once, retain intermediate Markdown, rows, cursors, and ETags inside one JavaScript pipeline, serialize dependent writes, and expose only a bounded final summary through `text()`. Every nested call remains individually visible and raw-inspectable in the transcript. Native structured dynamic-tool output remains an app-server protocol upgrade because the current dynamic-tool declaration, response, and Code Mode adapter do not carry an output schema or structured value.

Independent value editing for an existing Data Source membership is intentionally absent from revision 5. New or relocated Data Source memberships may receive initial values, and `move_pages` can change saved-View placement. A future property-editing tool must begin from a focused user intent rather than restoring the retired generic `edit_database` union.

### Design: Native CLI + Desktop Adapters

External agents and scripts use the native **`nodex` CLI**, which is an
authenticated UDS Adapter over the same Core Modules as the desktop. It supports
context/tree inspection, exact Page and metadata reads, bounded history,
immutable-snapshot ripgrep, composed saved View context, explicit one-Page
drafts, semantic Page and stable Block mutations, backups, doctor, and optional
Core prewarming. Browser and Electron callers use typed HTTP/IPC Adapters for
their product workflows. The CLI and Electron renderer are separate typed
Adapters; neither receives a database path or the Core bearer capability.

Project, Page, Database, Document, and backup commands all submit semantic
intent. Core resolves current ownership and revisions, applies the mutation and
projections atomically, and returns an idempotent receipt. No Adapter accepts raw
SQL, a database path, physical rank, or Yjs storage coordinates.

The retired `skills/nodex-kanban` package is not a supported integration. Its
`ls/get/add/update/rm/mv/query/projects` command family and read-only SQL examples
predated the current native CLI and are removed. The official
`agent-skills/nodex` umbrella Skill covers Page/rich-editor, saved View/Kanban,
and typed open workflows over Agent Application Interface revision 1. Its
frontmatter remains cross-Agent, command details load progressively from four
references, and fetched Nodex content is always untrusted data. A strict
allowlist exporter derives the production Nested Markdown reference, validates
real codec round-trips and official Skill metadata, and emits one reproducible
`NodexApp/skills`-shaped artifact with a stable tree hash. Internal Skills,
symlinks, hardlinks, special files, and unknown files are never published.

`nodex setup` and `nodex skills status|install|remove|doctor` manage only the
official global Codex target `~/.agents/skills/nodex` and Claude Code target
`${CLAUDE_CONFIG_DIR:-~/.claude}/skills/nodex`. They run before Profile/Core
bootstrap, verify that the current executable is in a stable installed
Nodex.app and that its adjacent artifact exactly matches the release manifest,
then create an absolute symlink without clobbering. A byte-identical ordinary
directory is compatible external content: it is reported as available but
never adopted or removed. Any file, different directory, relative/foreign/
broken symlink, unexpected parent symlink, or moved-App stale link is a
conflict. Multi-Agent mutations preflight every target before normal writes;
an interrupted run converges when repeated. Removal unlinks only an exact
current managed leaf. The native manager never creates `.agents/.nodex`, reads
project-local Agent trees, runs Agent binaries, copies Skills, scans arbitrary
roots, or offers force/adopt/repair flags. `~/.codex/skills/nodex` is
doctor-only legacy evidence and is never changed.

After “Install Command Line Tool…” succeeds, Desktop reads native
`skills status --json`. If Codex and Claude Code are not both already
managed-current or compatible-external, it offers a cancellable native choice
for both Agents, Codex only, Claude Code only, or not now, displaying the exact
global paths and a PATH reminder when needed. “Set Up Agent Skills…” in the
application menu reopens the same flow independently. Main always invokes the
packaged absolute `Contents/Resources/bin/nodex` with fixed argv, `--yes`, and
no shell; it preserves unknown target records and displays the structured error
code plus exact target path. Cancelling performs only the read-only status call.
TypeScript never creates, removes, scans, or repairs Agent Skill files.

The signed App, arm64/x64 release packages, and public `NodexApp/skills` mirror
all consume one release-generated artifact. Prepared-build and signed-package
provenance bind both its release-manifest SHA-256 and its six-file Skill tree
SHA-256; packaging fails on unknown, linked, hard-linked, special, oversized,
CRLF, stale, or hash-mismatched content. The packaged native CLI must report
the same bundle version/tree through `capabilities` before a release is valid.
The public mirror is an output, never an authoring source: release automation
preserves its `.github` content, refuses a lower SemVer or a reused tag with
different bytes, and atomically advances `main` with an annotated version tag.
An exact retry succeeds without a new commit. Mirror failure does not invalidate
the already published App or its offline native setup and is recovered by
rerunning the same release job.

CLI + Skill access is local-only. The Skill teaches a shell-capable local Agent
to call typed commands; it neither transports local Nodex data to a remote
Agent nor weakens Project/Library authorization. Page/View/search output is
untrusted task data and cannot replace Skill or system instructions. A missing
CLI gives install guidance, while an unsupported Agent interface tells the user
to update Nodex; neither condition permits SQLite, direct file, raw SQL, or
alternate-scope fallback.

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
- **Receipt-ordered publication**: Core fsyncs an operation-owned staging directory, commits the exact Store Administration receipt, then atomically renames the Backup into place; retry completes whichever phase was interrupted
- **Library-native lifecycle**: Backup, list, delete, prune, and restore work even when the Library has no Project; Administration commits use Library evidence instead of a synthetic Project event
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
- **Saved View fidelity**: one Core read returns persisted config, schema, groups, rows, cursor authority, and narrow move ETags without CLI-side SQL or filter reconstruction
- **Profile selection**: `NODEX_HOME` and `[server].home` use the same precedence as the desktop
- **Private transport**: the CLI authenticates over Profile-private UDS and never receives the database path or Core bearer capability

### Why Write Limits in App Layer?
- **Stops runaway growth early**: Field-level validation blocks exponential-content bugs before they hit SQLite/history
- **Transport consistency**: shared validators and generated Core contracts protect Electron IPC and native Module requests.
- **Resource protection**: IPC and Core byte budgets reject oversized requests before domain work
- **Operational simplicity**: Limits live in shared constants, so values stay consistent across modules

### Why Popper Positioning for Compact Property Selects?
- **Radix compatibility with custom triggers**: Avoids `item-aligned` dependence on `SelectValue` value-node measurement
- **Reliable placement**: Dropdown menus anchor consistently in dense Database surfaces
- **Safe modal composition**: Menus use the app-level body portal by default, escaping clipping containers while Radix nested layers preserve modal focus, pointer, and dismissal ownership
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
