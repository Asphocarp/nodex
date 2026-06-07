# Architecture

## Overview
Nodex is a local-first kanban platform for coordinating coding-agent work. The Electron main process hosts SQLite state, an embedded HTTP API, and a Codex app-server runtime so CLI clients, browser clients, and the desktop renderer all operate on the same data model while Codex Threads run Electron-first.

## Codemap

### Shared Contracts (`src/shared`)
- `types.ts`: canonical domain model (`Card`, `Board`, `Project`, project session/tab/thread-link payloads, block-drop import payloads).
- `workspace.ts`: canonical profile-local workspace catalog and serializable workbench layout snapshot types.
- `ipc-api.ts`: typed IPC channel surface between preload/renderer/main.
- `codex-thread-title.ts`: shared thread-title sanitization and bounded cache helpers used by both main and renderer.
- `schemas/*`: runtime boundary schemas for persisted renderer state, workspace layout catalogs, Codex settings, HTTP bodies, Codex session replay JSONL lines, and transcript special-item/raw JSON payload families.
- `card-limits.ts`: centralized payload and field size constraints.
- `assets.ts`: stable `nodex://assets/` URI helpers.
- `nfm/*`: shared Notion-flavored Markdown parser/serializer core used by both main-process storage logic and renderer editor adapters.

### Main Process and Data Layer (`src/main`)
- `index.ts`: application bootstrap (startup-init gating, DB init with migration progress fanout, HTTP server start, multi-window registry, profile-scoped single-instance lock, notifier fanout).
- `instance-scope.ts`: resolves/apply Electron `userData` + `sessionData` paths under the resolved server dir so each configured profile owns its own process lock scope.
- `http-server.ts`: Hono routes for projects, project sessions/tabs/thread links, cards, history, backups, and assets.
- `ipc-handlers.ts`: mirrors core operations through IPC, including project session mutations, asset-path resolution, and clipboard paste inspection for desktop-only file/folder paste flows.
- `clipboard-paste-inspector.ts`: best-effort Electron clipboard inspection for pasted absolute file/folder paths across supported native formats.
- `kanban/db-service.ts`: SQLite CRUD, move logic, project lifecycle, atomic block-drop import (`sourceUpdates + card creates`), and atomic card-to-editor move drop (`target updates + source delete`) grouped in one transaction.
- `kanban/project-session-service.ts`: SQLite CRUD for project-owned sessions, right/bottom session panels, session-attached tabs, optional session-thread links, Overview seeding, ordering, and v1 single-leaf panel layout JSON.
- `kanban/history-service.ts`: undo/redo and change history records, including grouped undo/redo via `history.group_id` and description hydration from revision ids.
- `kanban/description-revision-service.ts`: top-level NFM block hashing, revision delta/snapshot storage, description reconstruction, and revision/blob garbage collection.
- `kanban/recurrence-service.ts`: recurrence expansion, exception application, and next-occurrence computation.
- `kanban/reminder-service.ts`: runtime reminder scheduler, startup/resume catch-up, receipts, and snoozes.
- `kanban/backup-service.ts`: whole-store backup/restore and scheduler.
- `kanban/schema.ts`: latest-schema bootstrap and the future-ready schema version/migration framework, including project session tables and Overview-session seed migration.
- `kanban/card-input-validation.ts`: shared write validation used by all mutation paths.
- `logging/logger.ts`: structured backend logger with child scopes, sensitive-field redaction, bounded payload serialization, and profile-scoped JSONL file persistence under `${KANBAN_DIR}/logs`.
- `workbench-resume-state.ts`: legacy profile-scoped last-window snapshot store retained for migration/default seeding.
- `workspace-state.ts`: profile-scoped workspace catalog store under Electron `userData`, including default workspace seeding, legacy workbench-resume migration, active-workspace tracking, and layout snapshot persistence.
- `window-session-state.ts`: profile-scoped persisted Electron window-session catalog with per-window layout snapshots, restore-policy selection support, focus recency, and saved window bounds.
- `pty-manager.ts`: PTY process lifecycle management for session terminal ids (spawn, write, resize, kill).
- `codex/codex-app-server-client.ts`: global JSON-RPC client for `codex app-server` stdio lifecycle, handshake, request correlation, reconnect/backoff, and wire-level typing against the committed `@nodex/codex-app-server-protocol` workspace package.
- `codex/codex-service.ts`: domain facade for account/auth, thread/turn actions, approval + request-user-input handling, packaged-vs-dev Codex runtime resolution, canonical per-thread conversation-manager state, and main-process transcript/snapshot projection + `codex:event` / host-message emission.
- `codex/thread-title-generator.ts`: packaged-safe shared helper for `generate-thread-title` RPC prompt building and structured title parsing; it never reads repo-relative prompt assets.
- `codex/thread-title-state.ts`: profile-scoped persistent thread-title cache plus pending startup/app-server backfill queue.
- `codex/codex-item-normalizer.ts`: maps heterogeneous app-server item payloads into internal `CodexItemView` intermediates used by the transcript projector and tool metadata parsing.
- `codex/codex-transcript-projection.ts`: canonical transcript reducer/projection helpers that unify bootstrap, live updates, optimistic prompts, and terminal turn reconciliation into ordered `CodexTranscriptEntry[]`.
- `shared/codex-thread-detail-reducer.ts`: shared canonical merge/reduce helpers for thread detail snapshots, transcript deltas, and optimistic-entry reconciliation used by both main and renderer.
- `codex/codex-link-repository.ts`: persistence adapter for canonical Codex thread metadata (`codex_threads`) plus optional card-thread relations (`codex_thread_card_links`).
- `codex/codex-session-store.ts`: reads persisted Codex session artifacts from `$CODEX_HOME` / `~/.codex`, supports both legacy JSON and modern JSONL rollout layouts, and rebuilds visible transcript state for restart recovery/import from replay-safe events instead of raw bootstrap messages.
- `codex/git-worktree-service.ts`: managed Git worktree creation for card thread starts (`autoBranch` or `detachedHead`) with base-ref resolution, thread-title-driven auto-branch naming (`<prefix><thread-slug>`), and path allocation under `${serverDir}/worktrees`.
- `codex/worktree-environment-service.ts`: lists and validates `.codex/environments/*.toml`, parses environment metadata (`name`, `[setup].script`), and enforces in-repo path boundaries.

### Preload Boundary (`src/preload`)
- `index.ts`: minimal `window.api` bridge that exposes `invoke`, event subscription, runtime server URL, and the cached Electron asset-path prefix used for synchronous local asset-path resolution.

### Renderer Application (`src/renderer`)
- `app.tsx`: workbench orchestration, workspace bootstrap/switching, Electron startup-gating screen, reminder deep-link handling, and feature-flagged shell entry.
- `styles/theme-source.css`: author-maintained renderer token source, including Tailwind theme declarations, window-type/theme-scoped root tokens, and the CSS-side `--vscode-*` contract consumed by renderer surfaces.
- `styles/theme-codex-foundation.generated.css`: generated renderer foundation layer synced from Codex Electron for radius math, toolbar spacing, and window-scoped runtime overrides.
- `styles/theme-codex-utilities.generated.css`: generated renderer utility contract synced from Codex Electron for exact shipped utility selectors and Codex-specific arbitrary/container utility coverage.
- `styles/theme-token-bridge.css`: renderer token bridge for authored aliases that are not part of the generated Codex contract or the generated Codex foundation layer.
- `styles/theme-codex-surface.generated.css`: generated renderer surface layer synced from Codex Electron for shared component/global rules that are treated as upstream-owned.
- `styles/theme-utilities.css`: author-maintained renderer utility source for Nodex-local utility additions that are not part of the generated Codex contract.
- `styles/theme-surface.css`: author-maintained renderer surface rules and global CSS contracts layered on top of the source token files.
- `components/workbench/*`: Codex-style project/session shell, shared right/bottom panel tab strip, DB view host, Card Stage/session-terminal tab wrappers, settings surfaces, and remaining workbench composition helpers.
- `components/workbench/review-diff-panel.tsx`: Codex-style Diff stage surface for `Last turn` and Git-backed review snapshots (`unstaged`, `staged`, `branch`), including toolbar controls, review search, file-tree filtering, lazy full-file loading, capped large-diff mode, and per-file diff rendering/actions.
- `components/workbench/workbench-settings-*`: Codex-style settings route shell with a settings-specific sidebar adapter, section metadata registry, path resolver/redirect policy, shared settings page primitives, and one active section page at a time (`/settings/:section` over `general-settings`, `appearance`, `editor`, `card`, `worktrees`, `local-environments`, `backups`).
- `features/local-conversation/*`: Codex-parity renderer substrate and the public workbench boundary for active conversation stages. It owns the renderer-side app-server manager/registry substrate, host-message + control-event bridge, per-thread/any-conversation/meta selector hooks, connected thread/review stage containers, projection pipeline, stage shell, header/auth shell, footer/composer shell, shared thread controls, turn virtualization, and the thread-body search/scroll/collapse behavior used by the active workbench thread stage.
- `components/kanban/*`: board UI, card-stage editor, history panel, toggle-list UI.
- `components/kanban/editor/*`: BlockNote/NFM integration, custom blocks and inline attachment chips, keyboard behaviors, paste-resource prompting/materialization, single-editor projection helpers for `cardRef`/`toggleListInlineView` children, a shared per-editor projection sync controller (`projection-sync-controller.ts`) that owns one listener set and an owner registry, shared editor drag session coordination for editor->board drops, card-drag target registry for board->editor drops, bridged in-editor drop-indicator rendering for Pragmatic Drag and Drop card drags, and `cardToggle` snapshot/meta round-trip helpers.
- `lib/api.ts`: transport facade over explicit Electron and browser transport adapters (IPC in Electron, HTTP+SSE in browser).
- `lib/codex-theme-variant.ts`: Codex Electron-style runtime theme bridge that derives semantic color variables from the active light/dark theme variant and injects them onto `document.documentElement` before renderer surfaces read the token bridge.
- `lib/kanban-store.ts`: shared per-project board store with one realtime subscription, deduped fetches, optimistic journal rebase (`baseBoard + pending/local ops`), LWW conflict superseding, typed conflict resolution (`updated|conflict|not_found`), and O(1) `cardIndex` lookup map.
- `lib/use-kanban.ts`, `lib/use-history.ts`, `lib/use-projects.ts`: stateful hooks over API channels (`use-kanban` is store-backed via `useSyncExternalStore`).
- `lib/use-workbench-state.ts`: persisted legacy workspace shell state with explicit project-context slices. Session panels and durable terminal tabs are no longer owned here; project-session SQLite state is the primary model, while legacy terminal height can still seed bottom-panel defaults.
- `lib/workbench-persisted-schemas.ts`: renderer-side persisted-state schema/parsing layer for workbench/session history maps, tabs, panel widths, and restart-friendly shell snapshots.
- `lib/app-close-flush.ts`: renderer-side close-flush coordinator so all registered async flushers complete before one final Electron close ack is sent.
- `lib/workbench-resume.ts`: renderer helpers for consuming/saving the durable last-window snapshot and building snapshot payloads from live shell state.
- `lib/workspaces.ts`: renderer helpers for workspace bootstrap, workspace catalog mutations, active-workspace changes, and layout saves through IPC.
- `lib/dock-layout.ts`: dock split-tree helpers for the current persisted shell layout model.
- `lib/use-workbench-shortcuts.ts`: app-wide stage-first keyboard shortcut mapping.
- `lib/use-terminal.ts`: ghostty-web terminal lifecycle hook with cached instances, fit/resize handling, IPC wiring, and theme sync.
- `lib/use-codex-account-actions.ts`: auth/account command wrappers (`read`, login start/cancel, logout). For the active thread renderer, auth state flows from the local-conversation app-server manager substrate, not from this action layer.
- `lib/codex-collaboration-mode-settings.ts`: global fallback collaboration mode persistence for no-thread/new-thread surfaces. Active thread collaboration mode is owned by the local-conversation manager record, not by shell-local storage.
- `lib/nfm/*`: renderer wrappers over the shared NFM core plus the BlockNote adapter and clipboard/read-only helpers.
- `lib/toggle-list/*`: rule engine and mapping logic for toggle-list views.

## Data and Event Flow
1. Renderer issues a command through `lib/api.ts`.
2. Transport resolves to IPC or HTTP based on runtime.
3. Main process writes through `db-service`, recurrence helpers, and records history.
4. `db-notifier` emits `board-changed`.
5. Electron main broadcasts `board-changed` to all open windows; renderer store subscriptions filter by `projectId`.
6. Renderer shared project stores (`kanban-store`) receive IPC/SSE board-change signals and dedupe refresh work per project.
6. Reminder scheduler polls occurrences, dedupes delivery via receipts, and emits `reminder:open` to renderer on notification click.

Project sessions flow:
1. The renderer shell loads `project-sessions:list` for each visible project and renders projects as expandable folders with ordered sessions beneath them.
2. SQLite owns the shared tree: `project_sessions.panel_state_json` stores independent right and bottom panel state, `project_session_tabs.panel_id` stores ordered DB/Card/terminal/browser/review/files/side-chat tabs per panel, and `project_session_threads` stores optional session-to-thread attachments while thread metadata lives in `codex_threads`.
3. Window/session UI state owns only the active project, active session, transient focus/history, and legacy migration defaults. Durable panel collapse, size, active tab, tab order, and tab state belong to project-session storage.
4. Every project has a seeded `Overview` session with one right-panel `db_view` tab for that project. The project-session service also lazily creates the Overview row for projects added after startup.
5. Session singleton right-panel kinds are `db_view`, `review`, and `browser_placeholder`. Terminal tabs are session-owned bottom-panel tabs by default and carry only `projectId` plus `terminalSessionId`; cards never own terminals.
6. Renderer-local panel previews are intentionally outside SQLite. Files, Browser, and Side chat previews occupy one preview slot per session panel, replace each other within that panel, and are persisted only when pinned through the normal session-tab create API.

Codex Threads flow:
1. Renderer sends `codex:*` IPC actions through `lib/api.ts`, manager-backed control hooks, and the local-conversation app-server manager substrate.
2. Renderer loads `collaborationMode/list` via IPC and resolves active collaboration mode from the local-conversation manager when a thread exists; only no-thread/new-thread surfaces fall back to the global persisted default.
3. `codex-service` resolves card run target (`localProject` / `newWorktree` / `cloud`), including sticky per-card managed-worktree reuse via `runInWorktreePath`; for freshly created worktrees, it optionally executes selected `.codex/environments/*.toml` `[setup].script` before thread start. Session-owned thread starts use `codex:thread:start-for-session`, require the owning project workspace path, start the first turn immediately, persist the resulting thread in `codex_threads`, and attach it through `project_session_threads` without creating a card link.
4. For fresh worktree creation, `codex-service` emits `codex:event` `threadStartProgress` updates (`creatingWorktree` / `runningSetup` / `startingThread` / terminal `ready|failed`) with streamed stdout/stderr chunks so renderer can render real-time setup logs.
5. `codex-service` persists thread cwd in `codex_threads` (payload cwd or resolved fallback) so follow-up turns keep the same execution location even when a thread has no card or project.
6. `codex-link-repository` persists canonical thread metadata plus optional card relations in SQLite, while `codex-session-store` provides bootstrap-only recovery input for the main-process conversation manager when persisted Codex session artifacts exist.
7. Runtime notifications/server requests are first normalized into internal `CodexItemView` shapes, then projected in main into canonical `CodexConversationSnapshot` payloads and host-message broadcasts for the mounted thread route. Canonical thread summaries and snapshots also carry a minimal `source` contract; child/helper threads set `source.parentThreadId`, and root threads keep `source = null`.
8. Main still emits `codex:event` payloads for approval/request-side state and a manager-owned `codex:host-message` plane for shared objects plus thread stream sync. Connection/account/rate-limits/thread-summary/thread-start-progress all enter renderer as `sharedObjectUpdated`, thread-title cache sync enters as `threadTitleUpdated`, thread snapshots and incremental updates enter as `threadStreamStateChanged`, and host/runtime failures enter the same plane as explicit `error` messages. Renderer no longer keeps a separate Codex control reducer; thread-start progress, model bootstrap, permission modes, thread summaries, thread titles, and active conversations all flow through the same local-conversation app-server manager substrate.
9. The active workbench thread stage is mounted entirely through `features/local-conversation`: `WorkbenchShell` passes active thread identity plus static shell inputs into connected thread/review containers, and the local-conversation feature owns the per-thread selectors, active projection pipeline, local type surface, and independently connected header/body/footer thread surfaces. The production route does not rebuild one synthetic `conversation` object or one broad stage model before rendering those surfaces.
10. Main exposes separate snapshot/resume request IPC plus a `codex:host-message` stream. Snapshot requests only rebroadcast the current manager-owned conversation snapshot; they never call `thread/read`, never call `thread/resume`, and never bootstrap transcript state on behalf of the active renderer route. Explicit resume requests still drive the active-thread `needs_resume -> resuming -> resumed` state machine and materialize the canonical conversation directly from `thread/resume` payloads without rereads or transcript merge fallbacks.
11. The Codex service now stores active thread authority as a conversation-centric manager record (`detail + resumeState + stream role + queued follow-ups + pending steers + item cache`) instead of scattering transcript authority across independent per-thread maps. Running-thread `queue` submits mutate manager-owned queued-follow-up state first, then a manager-owned drain loop advances those entries through `turn/steer` or the next `turn/start` when the active run can accept them.
12. `features/local-conversation` is manager-owned: renderer triggers auto-title generation through a main-owned `generate-thread-title` RPC (`hostId + prompt + cwd`), applies the returned title locally first, then persists it through `thread/name/set`. Main emits host-scoped `sharedObjectUpdated`, `threadTitleUpdated`, `threadStreamStateChanged`, and `error` messages; a renderer host bridge fans those into an app-server message bus; and per-host app-server managers subscribe to that bus through a registry with per-conversation, any-conversation, and any-conversation-meta callbacks. Connected thread/review containers subscribe only to the active thread and its child memberships. Resumed child-thread de-dup reads `conversation.source.parentThreadId -> parent turns` through normal per-thread selectors; renderer must not reconstruct parent ownership by scanning every manager or by inferring parenthood from `childMemberships`. `WorkbenchShell` no longer owns a shell-wide conversation reducer, a full `conversationsById` map, or a separate control-plane reducer.
13. Thread titles are a first-class host capability, not a one-shot side effect of thread creation. Main persists a bounded `THREAD_TITLES`-style cache plus pending backfill queue, replays cached titles to app-server after startup/reconnect, and rebroadcasts `threadTitleUpdated` when a title changes. Renderer overlays cached titles onto thread summaries/conversation snapshots so installed and dev builds follow the same title lifecycle.
14. Renderer theme state follows Codex Electron's split ownership: authored CSS declares the token and utility contract, while the runtime theme bridge computes semantic variables such as foregrounds, control backgrounds, borders, panel colors, and editor colors from the active theme variant before the CSS token bridge resolves renderer-facing aliases.
15. The Diff stage is a workbench-owned review surface, not a transcript diff card. `Last turn` review comes from the active conversation turn diff, while `unstaged` / `staged` / `branch` review data flows through dedicated main-process Git snapshot IPC.

Workbench reopen flow:
1. Main process keeps a profile-local workspace catalog in `workspaces-v1.json` under Electron `userData`, with a default workspace always present.
2. Main process also keeps a profile-local window session catalog in `window-sessions-v1.json`; this is the cold-launch restore source for window count, selected workspace, layout snapshot, focus recency, and saved window bounds.
3. Renderer bootstrap consumes its assigned window session through IPC before mounting the shell. Existing legacy workbench-resume snapshots only seed the default workspace/session when no newer catalog exists.
4. Live workbench state continues to persist window-locally in `sessionStorage` as an in-session fallback, while durable reopen flows through window sessions. For the project-session shell, this window-local layer may remember active project/session/tab, pane widths, collapse overrides, and focus history; the shared session tree and tab order stay in SQLite.
5. On workspace switch or close, renderer flushes the current layout snapshot, card draft state, and registered close flushers before applying the next layout or sending the final close ack.
6. Each window saves its own session layout. Only the focused window updates the named workspace template/last-active workspace used for future new-window seeds.

## Invariants
- Persistent truth is split by ownership: Nodex-owned board/link metadata lives in SQLite, while Codex-owned thread history now lives in the main-process conversation manager plus explicit resume operations; the active renderer caches canonical conversation snapshots plus flat UI-only shell state rather than maintaining a second transcript-authority store, a second `resumeState` truth, or a second recovery layer.
- Main-process local-thread streaming uses a materialized broadcast-conversation cache plus Immer-compatible `threadStreamStateChanged` patches for hot and patch-capable updates; keep assistant/plan/reasoning, request ingress, queue/steer rows, and turn/item patch paths on direct cache mutation, and reserve `emitThreadStreamStateChange()` for cold/fallback snapshot reconciliation only.
- Runtime validation belongs at boundaries. Persisted storage, selected HTTP bodies, and raw JSON payload families should parse through `src/shared/schemas/*` or feature-local schema adapters; normalized in-memory reducers/view-models remain plain TypeScript once the boundary parse succeeds.
- All card writes must pass `card-input-validation` constraints.
- Recurrence exceptions and reminder receipts are project-scoped and persisted in SQLite.
- Completing an occurrence creates a `done` card with `archived = true`; archived cards stay out of board/sidebar/toggle-list flows but still surface in calendar occurrence queries.
- `move` operations are claim-safe: optional `fromStatus` enables optimistic concurrency checks.
- `card:update` supports optimistic concurrency claims with `expectedRevision`; stale claims return typed `conflict` with latest card snapshot and do not mutate DB state.
- Project-scoped data stays isolated (`project_id` on cards/history with cascading cleanup).
- Renderer never accesses SQLite directly.
- Custom editor behavior must preserve NFM round-trip fidelity.
- Codex threads have optional ownership metadata: a thread can be card-owned, session-owned, project-only, or projectless. Card ownership is represented by `codex_thread_card_links`; session ownership is represented by `project_session_threads`.
- Session-created threads must not create hidden cards, and session attachments do not create card links.
- Codex thread creation is card-first and includes immediate first-turn submission for durable thread materialization.
- Codex thread/turn cwd must use the linked thread cwd when present (not only project workspace fallback).
- Thread-title generation is renderer-triggered but host-owned: renderer may request generation, but only main owns generation prompt building, persistent title cache/backfill, and authoritative `threadTitleUpdated` rebroadcasts.
- The active workbench conversation stage is now conversation-native: `features/local-conversation` consumes `CodexConversationSnapshot` turns/items directly, then derives an ordered per-turn item stream, semantic render buckets, blocked-turn state, search units, and collapse state in the renderer.
- The active workbench conversation stage must stay local-conversation-owned end-to-end: active shell, composer, thread-body helpers, request cards, and thread-item renderers have no secondary workbench thread renderer path.
- The Diff stage has its own review data plane. Transcript diff cards (`turn.diff`, tool-call patch previews) remain local-conversation surfaces; workbench review sources (`last-turn`, `unstaged`, `staged`, `branch`) are owned by `review-diff-panel` plus main-process Git review IPC, including snapshot, patch-application, repository-init, and full-file-content reads.
- Turn-scoped live requests (`approval`, `userInput`, `implementPlan`) are main-owned conversation request-plane entries, not renderer-synthesized heuristics. The renderer derives request cards by joining `conversation.requests` against the matching turn items before bucketization so blocked-turn state and composer request surfaces come from one canonical request owner.
- The composer region is one multiplexed shell, not a stack of unrelated footer surfaces: manager-owned pending steers, queued follow-ups, background terminal rows, and background child-agent rows render in one ordered shell above the input region, while live request cards replace the normal editor branch inside that same shell. When both exist, the first background child approval renders before the active-thread request card.
- Running-thread composer follow-up semantics match Codex Electron: `queue` only mutates queued-follow-up state, `steer` submits an in-progress follow-up, empty drafts stay on `Stop`, and queued rows are drained by manager-owned follow-up submission instead of a renderer-local fake queue path.
- Internal bootstrap/context content such as `AGENTS.md`, developer instructions, and other setup wrappers is not part of the visible chat transcript.
- `cloud` run target is intentionally blocked at backend thread-start.
- For `newWorktree`, card-level `runInWorktreePath` is reused when available; missing/invalid paths are recreated and overwritten on the card.
- For `newWorktree`, optional `runInEnvironmentPath` stores a repo-relative `.codex/environments/*.toml` path. The full local-environment definition (`name`, `setup`, `cleanup`, platform overrides, actions) is owned by the main-process worktree-environment service and surfaced through the workbench settings page; only the selected default `[setup].script` participates in managed-worktree creation today.
- Environment setup failure aborts thread start, does not persist `runInWorktreePath`, and triggers best-effort cleanup of the newly created managed worktree.
- Managed worktree inventory is derived from linked thread cwd values rooted under `${serverDir}/worktrees`, deduplicated by resolved worktree path.
- Codex thread execution requires a project `workspacePath`; browser transport explicitly does not support Codex threads in this phase.

## Cross-Cutting Concerns

### Reliability
- WAL mode + transactional writes for consistency.
- Whole-store backups include DB and asset files.
- SSE fallback keeps browser clients reactive when IPC is unavailable.
- Codex runtime has startup gating (`initialize`/`initialized`), connection-state surfacing, and restart/backoff handling.

### Security
- Renderer runs behind preload bridge; no direct Node API access in app code.
- HTTP write routes enforce body limits and field validation.
- SQL query endpoint is read-only (`Statement.readonly` enforcement).
- Codex approval requests are policy-controlled (`auto`/`manual` per project) before command/file-change execution proceeds.

### Observability and Debugging
- History records capture create/update/move/delete deltas.
- Backend services emit structured logs (JSON lines) with child-scoped context for HTTP, PTY, backup/reminder, and Codex runtime flows.
- Backend logs persist under `${KANBAN_DIR}/logs` with bounded serialization and sensitive-field redaction for debugging without dumping raw secrets.
- Detailed logging reference: `docs/product-specs/backend-logging-spec.md`.
- Editor subsystems include focused tests for parser, keyboard behavior, and sync edge cases.
