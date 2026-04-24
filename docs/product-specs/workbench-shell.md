# Workbench Shell

## Intent
The workbench shell presents project work as a staged horizontal pipeline inspired by niri-like focus movement.
The sidebar `Projects` section controls the DB stage datasource, while top-level Workspaces persist named workbench layouts across app restarts.
Cards/Threads/Terminal keep stage-local project context and remain mounted in one horizontal shell.

Detailed Auto-review preset, config, and approval-lifecycle rules are specified in [Auto-review Behavior](./auto-review-behavior.md).

## Layout
- Left sidebar: a top-level `Projects` section for DB datasource selection plus the global stage map (`View`, `Card`, `Thread`, `Diff`).
- The `Projects` section is collapsible, keeps the active DB project highlighted, lists each project as a row while expanded, and still leaves the active project row visible for context when collapsed.
- Sidebar footer: workspace dots for switching named workbench layouts, plus a `+` workspace editor trigger for creating, renaming, and deleting workspaces. Workspaces may define an optional icon; when absent, the footer and editor show the same colored dot fallback used by projects. The last remaining workspace cannot be deleted.
- The DB stage owns a sticky top toolbar across all board/list/toggle-list/canvas/calendar views.
- The sticky DB toolbar contains the view selector as a horizontal top-edge tab strip plus a Notion-like trailing action cluster; task search expands inline inside that right-side cluster.
- The primary DB views keep a consistent inner gutter under that toolbar: kanban, toggle-list, list, calendar, and canvas all inset their content away from the stage edge instead of running flush to the shell chrome.
- For `kanban`, `list`, and `toggle-list`, that trailing cluster also owns shared view-local `Filter` and `Sort` popovers plus a `Display` popover for per-view property layout controls; kanban uses it for board-card property visibility/order and optional empty `priority` / `estimate` placeholders, while toggle-list uses it for row-property visibility/order and the same empty-value placeholders, rendered as matching neutral `-` chips. In kanban, those empty chips stay clickable and open the same inline property picker as filled chips.
- When a supported view has active filter/sort rules, the toolbar can render a compact bottom band with pills for the active filter clauses plus a leading sort chip; a single sort shows the field name with direction, multiple sorts collapse to an `n sorts` chip, and a thin separator divides sort from filter pills.
- The `Cards` sidebar stage group contains current DB-project cards grouped by non-empty status in reverse workflow order plus a `Recent` subsection for persisted cross-project card sessions.
- When collapsed, the sidebar can be temporarily revealed by hovering the left window edge; it floats above the stage rail instead of reflowing it.
- Top toolbar actions: sidebar collapse/expand and sliding-window pane-count decrease/increase.
- Stage rail: horizontal panel rail with stage-specific tab groups.
- Stage rail supports two modes:
  - `Sliding window` (default): a sliding 1-4 stage window with resizable separators between adjacent panes.
  - `Full rail`: all stages rendered in one horizontal strip.
- Terminal: global foldable bottom panel (VS Code-like), outside the stage rail.
- Visible stages:
  - sliding window: 1-4 stage panels render at once; focused stage and direction determine the contiguous visible window.
  - full rail: all stages render at once and remain mounted.
  - focused stage is visually emphasized and auto-revealed without forced centering.
  - titlebar pane controls flank the minimap: `-` sits on the left and removes the current right-most pane, while `+` sits on the right and appends the next right pane when available before falling back to prepending the left pane at the right edge.
- Stage order: `View -> Card -> Thread -> Diff`.

## Stage Semantics
- View: existing board/list/toggle-list/canvas/calendar host with one shared sticky toolbar for view switching, task search, and supported view-local filter/sort controls.
- Card: Card Stage editor session tabs; history opens as a card-specific overlay from Card Stage, and the sidebar mirrors card navigation with collapsible current DB-project status groups plus a `Recent` session subsection. Status groups start collapsed by default, and a collapsed status group may still keep its active card row visible under the header.
- Thread: Codex app-server-backed thread workspace with account/auth controls, a config-backed permission mode selector, streaming turn/item feed, reverse navigation to owning card, and stage-local project context (`threadsProjectId`).
- Thread stage uses independently connected renderer surfaces: `WorkbenchShell` passes route inputs and bound actions into the thread route shell, and the mounted thread header/body/footer subscribe to their own narrow manager-backed selectors instead of one broad renderer model.
- Diff: interactive mock placeholder for diff previews.
- Terminal panel: mixed tabs (`project` and `card` bound), globally docked at bottom, with per-tab project routing.

## Threads Rendering Model
- Visible transcript rules, rendering contracts, optimistic prompt behavior, tool/reasoning rows, and restart recovery semantics are specified in [Codex Thread Transcript Behavior](./codex-thread-transcript-behavior.md).
- Storybook is the supported renderer harness for isolated UI work. Run `bun run dev:storybook` from the repository root to inspect the Threads panel scenarios, Card Stage scenarios, and the general shared-UI gallery without booting the Electron shell.
- Threads use follow/read modes: if the viewport is near the bottom, new items auto-scroll into view; if the user scrolls up, auto-scroll pauses and a floating catch-up button appears above the composer to jump back to latest.
- Threads render by turns, not flat transcript rows. The scroll body groups each turn into ordered blocks (`user messages -> activity -> system events -> assistant -> plan -> answered user input`) and virtualizes that turn list.
- Unresolved live approvals, request-user-input cards, and implement-plan prompts render in a dedicated pending-request surface above the composer. Historical answered artifacts remain in the transcript.
- Approval requests stay attached to the matching transcript work item instead of opening a separate approval screen: command approvals decorate existing exec rows, file approvals decorate existing file-change rows, and automatic approval review rows render as trailing transcript items.
- Running thread tabs render a live indicator dot in the tab strip.
- Sidebar thread items replace their default thread glyph with a live running indicator while active; the Thread stage group icon also reflects running state.
- The composer footer’s bottom-right context ring uses live `thread/tokenUsage/updated` data from Codex. It shows the active thread’s current context-window fill level, and hovering the ring reveals percent-full plus `used / window` token details when available.
- Visual styling layers Streamdown's base styles under `.codex-markdown` and `codex-tool-*` token overrides in `src/renderer/globals.css`.
- The permission selector matches Codex Electron's visible labels and behavior:
  - `Default permissions`
  - `Auto-review`
  - `Full access`
  - `Custom (config.toml)`
- `Auto-review` is reviewer-only parity, not a different sandbox preset: it shares `workspace-write + on-request` with `Default permissions` and only changes `approvalsReviewer` from `user` to `auto_review`.
- If the current config/requirements disable `guardian_approval` or disallow the `auto_review` reviewer, the Auto-review mode is unavailable and any resolved automatic reviewer collapses back to `user`.

## Focus and Navigation
- Focusing a stage scrolls only as needed so the focused stage is fully visible.
- Sliding-window focus uses nearest-window behavior: changing focus shifts the visible window only as much as needed to include the target stage.
- Sliding-window viewport shifts are distinct from focus changes: `Cmd/Ctrl+H` and `Cmd/Ctrl+L` move the visible contiguous stage window left/right by one stage, keeping the current focused stage when it remains inside the new window and only falling back to the entering edge stage when the old focus would move out of view.
- The shell keeps a window-local back/forward history for durable workbench context: DB project, active DB view, focused stage/direction, open card + card tab selection, active thread tab/project, and active file tab.
- Transient overlays do not enter navigation history: command palette, task search, settings, hover sidebar, terminal open/height, and raw search query text.
- `Cmd/Ctrl+[` navigates back and `Cmd/Ctrl+]` navigates forward through that history, including when focus is inside editable surfaces.
- The command palette always exposes `Go back` and `Go forward`; when no history exists in that direction, those commands stay visible but disabled.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` still cycle stage focus order.
- `Shift + mouse wheel` is reserved for native horizontal panel scrolling and does not step focus.
- Full rail: dragging either left or right border of a stage panel resizes only that panel width (neighbor widths do not change).
- Sliding window: dragging any separator resizes the adjacent pane pair in real time so content follows the pointer; width persistence commits on pointer release.
- Sliding-window separators use the same surface tone as adjacent panes and keep a single-line seam aesthetic.
- Sidebar stage groups mirror stage tab state and allow direct stage/tab focus.
- Current-project card groups in the sidebar ignore the View-stage search query and remain a stable navigator for the selected DB datasource project.

## Persistence
- A workspace owns the serializable workbench layout: active DB project, active view/search/filter/sort/display prefs, focused stage, stage direction, rail mode, pane count, panel widths/collapse state, open card stage state, recent card sessions, Thread project/tabs, files tab, terminal tabs/open state/height, sidebar state, and dock layout.
- A workspace does not own project/card data, Codex thread transcripts, Codex runtime state, or terminal process output beyond tab layout.
- A default workspace is always present. New workspaces start from the current layout snapshot, become active immediately, and diverge from that point forward. Workspace names and optional icons are layout-catalog metadata, not project data.
- Workspace catalogs are profile-local Electron state under `userData`; when no catalog exists, legacy workbench resume data seeds the default workspace if available.
- Electron window sessions are the cold-launch restore unit. Each open window persists its own selected workspace, layout snapshot, focus time, and saved window bounds in profile-local `window-sessions-v1.json`, so duplicate windows for the same workspace can reopen with independent layouts.
- On macOS, each native window title follows that window session's selected workspace name and updates after workspace switches or renames.
- Settings -> General -> `Restore windows` controls restart behavior: `All` restores every retained window session, `Last` restores only the last focused session, and `None` starts one fresh session from the active workspace.
- Closing one window while other windows remain open does not immediately rewrite the restore catalog; on app quit, Nodex rewrites the retained session set from the windows still open, matching VS Code's shutdown snapshot behavior. Closing the last window records it as the last closed session for macOS-style reactivation/reopen.
- Stage focus is persisted globally (not keyed by DB datasource project).
- Sidebar stage section expansion (including the top-level `Recents` group) and stage tab selections are persisted per project.
- Sidebar card-status subgroup expansion and per-section overflow expansion (`Show more` / `Show less`) are persisted per project.
- Full-rail stage panel widths are persisted globally after panel border resize.
- Sliding-window requested pane count (1-4) is persisted globally.
- Sliding-window pane widths are persisted globally by stage id.
- Card stage tabs derive from persisted recent card sessions.
- The `Recents` sidebar group is driven by persisted cross-project recent card sessions, capped at 10 items and updated only when the current card is left; leaving inserts only cards that are not already present, so existing entries keep a stable order.
- The Cards sidebar's grouped current-project rows are derived from the shared `useKanban` board snapshot for `dbProjectId`; they do not create separate persisted tab state.
- Thread stage tabs always include a persistent `New thread` tab, plus linked Codex thread tabs derived from persisted metadata in SQLite (`codex_card_threads`) and refreshed from runtime events.
- Thread background sync is preserved when changing the selected thread tab; active-thread detail refresh runs independently of the currently selected tab.
- DB view filter/sort prefs are persisted per project and per supported view (`kanban`, `list`, `toggle-list`) in renderer localStorage; calendar and canvas do not participate.
- Toggle-list display prefs (property order, hidden properties, empty-estimate display) persist alongside the supported DB view prefs instead of a standalone toggle-list storage silo.
- Bottom terminal panel persists open/closed + panel height globally.
- Terminal tabs persist mixed `project`/`card` mode state.
- Back/forward history is persisted only for the current window session and is not included in cold-launch resume snapshots.
- Thread permission state is main-owned and config-backed. Renderer reads/writes it through IPC, while the main process resolves effective values from app-server config and requirements plus the current config-key origin layer.
- The thread footer and Settings -> `Agent` write preset changes back to the active config origin when present, or to the user config file when no explicit origin exists.
- In Threads stage, the permission selector defaults to the resolved effective preset from config. `Custom (config.toml)` is shown only when the active raw config state does not round-trip to one of the fixed visible presets.
- The Threads permission menu shows hover tooltips for each mode; the `Custom (config.toml)` tooltip reflects the resolved config source, path, `sandbox_mode`, `approval_policy`, and `approvals_reviewer` values when available.

## Keyboard Model
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: next/previous stage.
- `Cmd/Ctrl+H` / `Cmd/Ctrl+L`: shift the sliding-window viewport left/right by one stage; in full-rail mode, they alias previous/next stage focus.
- `Cmd/Ctrl+[` / `Cmd/Ctrl+]`: back/forward durable workbench navigation.
- `Cmd/Ctrl+1..4`: jump to stage index.
- `Cmd/Ctrl+Alt+1..9`: jump to project index.
- `Cmd/Ctrl+Alt+1..9` updates DB datasource project only.
- `Cmd/Ctrl+Shift+P`: open command search by launching the command palette with `>` prefilled.
- `Cmd/Ctrl+J`: toggle global bottom terminal panel.
