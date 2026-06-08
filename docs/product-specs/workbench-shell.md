# Workbench Shell

## Intent
The workbench shell presents each project as a folder in the left sidebar. Expanded projects show durable project-owned sessions. The active session renders as a thread page with shell-owned right and bottom panels for session-attached content tabs, replacing the previous stage rail with a denser desktop shell.

Detailed Auto-review preset, config, and approval-lifecycle rules are specified in [Auto-review Behavior](./auto-review-behavior.md).

## Layout
- Left sidebar: projects render as expandable folders. Selecting a project expands it and switches the DB project context.
- Project children: each expanded project lists ordered sessions. Every project has one seeded `Overview` session.
- Sidebar footer: a compact Settings button remains available without workspace switching controls.
- Active session header: uses the active thread title row as the session header, without a separate session title, project-name subtitle, or empty toolbar row above it in either regular or narrow layouts. The fixed global header owns the left chrome (`Sidebar`, `Back`, `Forward`, and collapsed-only `New chat`) plus the top-right `Toggle bottom panel` and `Toggle side panel` controls, ordered bottom first and side second. Right-panel tab creation and expand/restore actions belong to the right-panel tab header; bottom-panel tab creation plus the plain `Close` X action belong to the bottom-panel tab header. There is no attach/detach thread toolbar button.
- Thread page: the main session viewport always hosts the session thread page. If no thread is attached, it shows the new-thread composer. If the right panel is collapsed, the global top-right side-panel toggle opens it.
- Pinned summary: attached-thread pages show a summary button at the right edge of the thread header, immediately before the right-panel boundary. While the right panel is collapsed, the button is labelled `Toggle pinned summary` and controls the 300px pinned summary panel, which renders below the thread header and never over the top toolbar buttons. Opening the regular right panel hides the pinned overlay, makes the global header slot reserve the right-panel width, and switches the thread-header button to a separate `Toggle summary` popover trigger; that popover dismisses on outside click and does not change the saved pinned-open preference.
- Right panel: the v1 right panel renders one tab group with ordered session tabs. It can be collapsed, regular-width, or expanded to the full session content area. New non-Overview sessions start with the right panel collapsed; each seeded `Overview` session starts with the right panel open and full-width expanded on its default DB tab unless the user has changed that session's panel width. Hiding and showing the side panel preserves the session-local regular/full-width mode. The persisted layout shape already supports future split leaves, but v1 does not render multiple split groups.
- Bottom panel: the v1 bottom panel renders one tab group below the thread/right-panel row and spans the full active session width. It has a top-edge resize handle, defaults to 280px tall, opens when a bottom tab such as Terminal is created or focused, and can be shown or hidden from the fixed global `Toggle bottom panel` button even before any durable bottom tab exists. Its new-tab chooser offers Files, Side chat, Browser, Review, and Terminal when eligible, while DB View and Card Stage remain right-panel-only creation actions.
- Browser tabs: browser is a real tab kind but renders a nonfunctional placeholder until the browser feature ships.
- The right panel has a left-edge resize handle in regular mode. Full-width mode collapses the thread viewport to zero width, removes the resize handle and inner left border, and exposes `Restore panel width` from the right-panel tab header.

## Session And Tab Semantics
- `Overview`: created for every project, ordered first by default, with one open full-width right-panel `db_view` tab for that project.
- `db_view`: reuses the DB toolbar/view host for kanban, list, toggle-list, canvas, and calendar views.
- `card_stage`: reuses Card Stage for a project/card config. Opening a card from a DB tab creates or focuses the matching session tab instead of switching to a global Cards stage.
- `terminal`: reuses the terminal lifecycle with a session-tab-scoped terminal id, defaults to the bottom panel, starts in the attached thread cwd when available before falling back to the owning project workspace path, and contains no card ownership fields.
- `browser_placeholder`: shows a quiet placeholder surface and stores optional placeholder metadata.
- Preview tabs: Files, Browser, and Side chat can open as renderer-local previews in either right or bottom panel. Each panel has at most one preview; opening another preview in that panel replaces it. Preview tabs are not written to SQLite until the user interacts with the preview body or chooses `Pin tab`, at which point the normal `project_session_tabs` create flow persists the tab and activates it.
- Session-thread links are optional and separate from card-owned Codex thread links. Attaching a thread to a session does not create or rewrite a `codex_thread_card_links` card relation.

## Storage Ownership
- SQLite owns shared project session data:
  - `project_sessions`: project id, title, overview marker, order, left-pane collapse, and `panel_state_json` for right/bottom collapse, layout, size, and active tab.
  - `project_session_tabs`: session/project id, `panel_id`, kind, title, per-panel order, state key/value, and validated kind-specific config JSON.
  - `project_session_threads`: optional session-to-thread attachments; canonical thread metadata lives in `codex_threads`.
- Window-local shell state owns only active project, active session, and transient focus history.
- Existing projects are migrated by creating missing Overview sessions. Existing cards, project data, history, and legacy `codex_card_threads` rows are migrated into `codex_threads` plus `codex_thread_card_links`.
- Old stage-rail/window layout snapshots are best-effort inputs for active project/session defaults only; they are not authoritative shared session data.

## Navigation
- Session switching changes the thread page plus the right and bottom panel tab groups.
- App-window Back/Forward controls are available as titlebar buttons, command palette commands, `Cmd/Ctrl+[` and `Cmd/Ctrl+]`, desktop mouse Back/Forward buttons, and the macOS application menu; all routes use the same window-local workbench history callbacks. The command ids are `navigateBack` and `navigateForward`, labels are `Back` and `Forward`, and the disabled state follows the workbench back/forward stacks.
- Tab switching persists through the owning panel's v1 leaf layout.
- Browser-sidebar webview navigation remains separate from app-window history. Browser tab `canGoBack` / `canGoForward` and `webContents.goBack` / `goForward` must not drive the top-left workbench Back/Forward buttons.
- Browser and Review are session singleton tab kinds across both right and bottom panels; creation affordances hide them when either kind already exists, and duplicate create requests focus the existing tab instead of adding another.
- Tab reorder persists through `project_session_tabs.order` scoped by `panel_id` and updates that panel's leaf tab id order.
- Closing a durable tab removes that session tab. Closing a preview tab drops only the renderer-local preview and collapses that panel if it has no durable tabs. The Overview DB tab can remain closable only when another tab exists in the same session.
- The shell uses `startTransition` for session/tab changes that may mount expensive tab bodies.
- React keys should reset only the active session/tab body that changed; switching projects or sessions must not force unrelated global stores to remount.

## Keyboard Model
- Existing global command palette, settings, undo/redo, and editor shortcuts remain in force.
- The previous stage-order shortcuts (`View -> Card -> Thread -> Diff`) are retired as primary shell semantics.
- Project/session/tab keyboard shortcuts should be introduced against the new hierarchy: project folder, session row, thread page, and right/bottom panel tab groups.
- `Ctrl+\`` focuses an existing session terminal tab or creates one in the bottom panel. The global terminal drawer is not part of the project-session shell model.

## UI Contract
- Surfaces should use the generated theme layers and token classes before adding local CSS.
- Left titlebar navigation uses one grouped toolbar rail. Back renders lucide `ArrowLeft` with `icon-xs`; Forward reuses the same icon with `icon-xs -scale-x-100`. Each button has matching `aria-label`, `title`, tooltip text, command palette title, and disabled styling.
- Tabs are dense, use hover-revealed close actions, and support pointer reorder through the shared tab strip.
- Keep `Timeline` hidden until Nodex has a first-class tab kind and eligibility model for it.
- Project/session rows should be information-dense and shallow: folder disclosure, project label, session title, and subtle thread-attached indicator.
- The thread page content frame keeps the shell top border but forces the frame top offset to `0px`, so the thread title row starts at the top instead of below an empty toolbar band. The global top-right controls are reserved inside that title row through the thread header right-reserve area.
- Do not reintroduce the stage rail as a compatibility layer. DB view, Card Stage, Thread, Diff/review, and Terminal implementations should remain reusable bodies behind sessions and tabs.

## Storybook And Testing
- Storybook coverage lives in `src/renderer/components/workbench/workbench-session-shell.stories.tsx` for mixed tabs, empty right/bottom action grids, attached thread page, collapsed right panel, full-width right panel, long names, and enabled/disabled left titlebar navigation chrome.
- Unit tests should cover schema migration, Overview seeding, tab config validation, session ordering, tab ordering, session-thread startup, and the absence of attach/detach toolbar controls.
- Renderer tests should cover project expansion, session loading/switching, Overview defaults, right-panel collapse/full-width behavior, bottom-panel terminal behavior, tab selection, tab reorder, cross-panel move, and each tab kind.
