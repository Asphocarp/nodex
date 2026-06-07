# Workbench Shell

## Intent
The workbench shell presents each project as a folder in the left sidebar. Expanded projects show durable project-owned sessions. The active session renders as a thread page with a shell-owned right panel for session-attached content tabs, matching the Codex desktop shell hierarchy more closely than the previous stage rail.

Detailed Auto-review preset, config, and approval-lifecycle rules are specified in [Auto-review Behavior](./auto-review-behavior.md).

## Layout
- Left sidebar: projects render as expandable folders. Selecting a project expands it and switches the DB project context.
- Project children: each expanded project lists ordered sessions. Every project has one seeded `Overview` session.
- Sidebar footer: workspace dots remain profile-local window layout controls. Workspaces do not own project session data.
- Active session header: uses the active thread title row as the session header, without a separate session title or project-name subtitle. The fixed global header still owns the Codex-style `Toggle side panel` control. Right-panel tab creation and expand/restore actions belong to the right-panel tab header; there is no attach/detach thread toolbar button.
- Thread page: the main session viewport always hosts the session thread page. If no thread is attached, it shows the new-thread composer. If the right panel is collapsed, the global top-right side-panel toggle opens it.
- Right panel: the v1 right panel renders one tab group with ordered session tabs. It can be collapsed, regular-width, or expanded to the full session content area. Hiding and showing the side panel preserves the session-local regular/full-width mode. The persisted layout shape already supports future split leaves, but v1 does not render multiple split groups.
- Browser tabs: browser is a real tab kind but renders a nonfunctional placeholder until the browser feature ships.
- The right panel has a left-edge resize handle in regular mode. Full-width mode collapses the thread viewport to zero width, removes the resize handle and inner left border, and exposes `Restore panel width` from the right-panel tab header.

## Session And Tab Semantics
- `Overview`: created for every project, ordered first by default, with one right-panel `db_view` tab for that project.
- `db_view`: reuses the DB toolbar/view host for kanban, list, toggle-list, canvas, and calendar views.
- `card_stage`: reuses Card Stage for a project/card config. Opening a card from a DB tab creates or focuses the matching session tab instead of switching to a global Cards stage.
- `terminal`: reuses the terminal lifecycle with a session-tab-scoped terminal id.
- `browser_placeholder`: shows a quiet placeholder surface and stores optional placeholder metadata.
- Session-thread links are optional and separate from card-owned Codex thread links. Attaching a thread to a session does not create or rewrite a `codex_thread_card_links` card relation.

## Storage Ownership
- SQLite owns shared project session data:
  - `project_sessions`: project id, title, overview marker, order, default pane collapse state, and right-pane layout JSON.
  - `project_session_tabs`: session/project id, kind, title, order, and validated kind-specific config JSON.
  - `project_session_threads`: optional session-to-thread attachments; canonical thread metadata lives in `codex_threads`.
- Window-local shell state owns only active project, active session, active tab, right-panel width/full-width mode, collapse overrides, and focus history.
- Existing projects are migrated by creating missing Overview sessions. Existing cards, project data, history, and legacy `codex_card_threads` rows are migrated into `codex_threads` plus `codex_thread_card_links`.
- Old stage-rail/window layout snapshots are best-effort inputs for active project/session defaults only; they are not authoritative shared session data.

## Navigation
- Session switching changes both the thread page and the right-panel tab group.
- Tab switching persists through the active session's v1 leaf layout.
- Tab reorder persists through `project_session_tabs.order` and updates the leaf tab id order.
- Closing a tab removes that session tab. The Overview DB tab can remain closable only when another tab exists in the same session.
- The shell uses `startTransition` for session/tab changes that may mount expensive tab bodies.
- React keys should reset only the active session/tab body that changed; switching projects or sessions must not force unrelated global stores to remount.

## Keyboard Model
- Existing global command palette, settings, undo/redo, and editor shortcuts remain in force.
- The previous stage-order shortcuts (`View -> Card -> Thread -> Diff`) are retired as primary shell semantics.
- Project/session/tab keyboard shortcuts should be introduced against the new hierarchy: project folder, session row, thread page, and right panel tab group.
- `Cmd/Ctrl+J` may continue to toggle terminal-related UI where applicable, but session-tab terminals are the primary terminal surface in the new shell.

## UI Contract
- Surfaces should use the generated Codex theme layers and token classes before adding local CSS.
- Tabs are dense, use hover-revealed close actions, and support pointer reorder through the shared tab strip.
- Project/session rows should be information-dense and shallow: folder disclosure, project label, session title, and subtle thread-attached indicator.
- Do not reintroduce the stage rail as a compatibility layer. DB view, Card Stage, Thread, Diff/review, and Terminal implementations should remain reusable bodies behind sessions and tabs.

## Storybook And Testing
- Storybook coverage lives in `src/renderer/components/workbench/workbench-session-shell.stories.tsx` for mixed tabs, attached thread page, collapsed right panel, full-width right panel, and long names.
- Unit tests should cover schema migration, Overview seeding, tab config validation, session ordering, tab ordering, session-thread startup, and the absence of attach/detach toolbar controls.
- Renderer tests should cover project expansion, session loading/switching, Overview defaults, right-panel collapse/full-width behavior, tab selection, tab reorder, and each tab kind.
