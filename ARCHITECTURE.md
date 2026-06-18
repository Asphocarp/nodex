# Architecture

## Overview
Nodex is a local-first kanban platform for coordinating coding-agent work. The Electron main process hosts SQLite state, an embedded HTTP API, and a Codex app-server runtime so CLI clients, browser clients, and the desktop renderer all operate on the same data model while Codex Threads run Electron-first.

## Codemap

### Shared Contracts (`src/shared`)
- `types.ts`: canonical domain model (`Card`/`Board` full payloads, `CardSummary`/`BoardSummary` lightweight board read models, `Project`, project session/tab/thread-link payloads, block-drop import payloads).
- `project-session-panel-layout.ts`: pure recursive split-tree helpers for v2 right/bottom project-session panel layouts, including normalization, leaf/tab movement, split/merge, active/MRU leaf tracking, and ratio clamping.
- `workbench-layout.ts`: canonical serializable workbench layout snapshot types.
- `ipc-api.ts`: typed IPC channel surface between preload/renderer/main.
- `codex-thread-title.ts`: shared thread-title sanitization and bounded cache helpers used by both main and renderer.
- `schemas/*`: runtime boundary schemas for persisted renderer state, workbench layout snapshots, Codex settings, HTTP bodies, Codex session replay JSONL lines, and transcript special-item/raw JSON payload families.
- `card-limits.ts`: centralized payload and field size constraints.
- `assets.ts`: stable `nodex://assets/` URI helpers.
- `nfm/*`: shared Notion-flavored Markdown parser/serializer core used by both main-process storage logic and renderer editor adapters.

### Main Process and Data Layer (`src/main`)
- `bootstrap.ts`: early Electron lifecycle entrypoint. It resolves the server profile dir, scopes `userData`/`sessionData`, owns the profile-scoped single-instance lock and deep-link queue, runs the packaged macOS Applications prompt, and dynamically imports the application runtime.
- `main-runtime.ts`: application runtime startup (startup-init gating, DB init with migration progress fanout, HTTP server start, multi-window registry, app-update service, notifier fanout, and shutdown handlers).
- `instance-scope.ts`: resolves/apply Electron `userData` + `sessionData` paths under the resolved server dir so each configured profile owns its own process lock scope.
- `http-server.ts`: Hono routes for projects, project sessions/tabs/thread links, cards, board summaries/card details/search, history, backups, and assets.
- `ipc-handlers.ts`: mirrors core operations through IPC, including lightweight board-summary fetches, on-demand card detail/search channels, project session mutations, side-chat start/discard requests, native context menu selection, asset-path resolution, and clipboard paste inspection for desktop-only file/folder paste flows.
- `clipboard-paste-inspector.ts`: best-effort Electron clipboard inspection for pasted absolute file/folder paths across supported native formats.
- `kanban/db-service.ts`: SQLite CRUD, lightweight board-summary/detail/search read models, move logic, project lifecycle, atomic block-drop import (`sourceUpdates + card creates`), and atomic card-to-editor move drop (`target updates + source delete`) grouped in one transaction.
- `kanban/project-session-service.ts`: SQLite CRUD for project-owned sessions, project-local pin/archive/unread state, right/bottom session panels, session-attached tabs, optional session-thread links, Overview seeding, ordering, v2 recursive panel layout JSON, and derived flat tab-order compatibility.
- `kanban/history-service.ts`: undo/redo and change history records, including grouped undo/redo via `history.group_id` and description hydration from revision ids.
- `kanban/description-revision-service.ts`: top-level NFM block hashing, revision delta/snapshot storage, description reconstruction, and revision/blob garbage collection.
- `kanban/recurrence-service.ts`: recurrence expansion, exception application, and next-occurrence computation.
- `kanban/reminder-service.ts`: runtime reminder scheduler, startup/resume catch-up, receipts, and snoozes.
- `kanban/backup-service.ts`: whole-store backup/restore and scheduler.
- `kanban/schema.ts`: latest-schema bootstrap and the future-ready schema version/migration framework, including project session tables and Overview-session seed migration.
- `kanban/card-input-validation.ts`: shared write validation used by all mutation paths.
- `logging/logger.ts`: structured backend logger with child scopes, sensitive-field redaction, bounded payload serialization, and profile-scoped JSONL file persistence under `${KANBAN_DIR}/logs` for dev/unpackaged runs or explicitly enabled packaged diagnostics.
- `window-session-state.ts`: profile-scoped persisted Electron window-session catalog with per-window layout snapshots, restore-policy selection support, focus recency, and saved window bounds.
- `pty-manager.ts`: PTY process lifecycle management for session terminal ids (spawn, write, resize, kill).
- `codex/codex-app-server-client.ts`: global JSON-RPC client for `codex app-server` stdio lifecycle, handshake, request correlation, reconnect/backoff, and wire-level typing against the committed `@nodex/codex-app-server-protocol` workspace package.
- `codex/codex-service.ts`: domain facade for account/auth, thread/turn actions, ephemeral side-chat forks, approval + request-user-input handling, packaged-vs-dev Codex runtime resolution, canonical per-thread conversation-manager state, and main-process transcript/snapshot projection + `codex:event` / host-message emission.
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
- `index.ts`: minimal `window.api` bridge that exposes `invoke`, event subscription, runtime server URL, cached Electron asset-path prefix, and the `window.electronBridge.showContextMenu` native-menu bridge used by desktop-only row menus.

### Renderer Application (`src/renderer`)
- `app.tsx`: workbench orchestration, window-session bootstrap/layout persistence, Electron startup-gating screen, reminder deep-link handling, and feature-flagged shell entry.
- `styles/theme-source.css`: author-maintained renderer token source, including Tailwind theme declarations, window-type/theme-scoped root tokens, and the CSS-side `--vscode-*` contract consumed by renderer surfaces.
- `styles/theme-codex-foundation.generated.css`: generated renderer foundation layer for radius math, toolbar spacing, and window-scoped runtime overrides.
- `styles/theme-codex-utilities.generated.css`: generated renderer utility contract for utility selectors and specialized arbitrary/container utility coverage.
- `styles/theme-token-bridge.css`: renderer token bridge for authored aliases that are not part of the generated theme contract or foundation layer.
- `styles/theme-codex-surface.generated.css`: generated renderer surface layer for shared component/global rules.
- `styles/theme-utilities.css`: author-maintained renderer utility source for Nodex-local utility additions that are not part of the generated theme contract.
- `styles/theme-surface.css`: author-maintained renderer surface rules and global CSS contracts layered on top of the source token files.
- `components/workbench/*`: project/session shell, recursive right/bottom panel group tree, shared leaf-level panel tab strip, renderer-local side-chat tabs, DB view host, Card Stage/session-terminal tab wrappers, settings surfaces, and remaining workbench composition helpers.
- `components/workbench/review-diff-panel.tsx`: Diff stage surface for `Last turn` and Git-backed review snapshots (`unstaged`, `staged`, `branch`), including toolbar controls, review search, file-tree filtering, lazy full-file loading, capped large-diff mode, and per-file diff rendering/actions.
- `components/workbench/workbench-settings-*`: settings route shell with a settings-specific sidebar adapter, section metadata registry, path resolver/redirect policy, shared settings page primitives, and one active section page at a time (`/settings/:section` over `general-settings`, `appearance`, `editor`, `card`, `worktrees`, `local-environments`, `backups`).
- `features/local-conversation/*`: renderer substrate and the public workbench boundary for active conversation stages. It owns the renderer-side app-server manager/registry substrate, host-message + control-event bridge, per-thread/any-conversation/meta selector hooks, connected thread/review stage containers, projection pipeline, stage shell, header/auth shell, footer/composer shell, shared thread controls, turn virtualization, and the thread-body search/scroll/collapse behavior used by the active workbench thread stage.
- `components/kanban/*`: board UI, card-stage editor, history panel, toggle-list UI.
- `components/kanban/editor/*`: BlockNote/NFM integration, custom blocks and inline attachment chips, keyboard behaviors, paste-resource prompting/materialization, single-editor projection helpers for `cardRef`/`toggleListInlineView` children, a shared per-editor projection sync controller (`projection-sync-controller.ts`) that owns one listener set and an owner registry, shared editor drag session coordination for editor->board drops, card-drag target registry for board->editor drops, bridged in-editor drop-indicator rendering for Pragmatic Drag and Drop card drags, and `cardToggle` snapshot/meta round-trip helpers. The editor consumes the vendored BlockNote workspace packages in `third_party/blocknote/packages/*` through the normal `@blocknote/*` package names.
- `lib/api.ts`: transport facade over explicit Electron and browser transport adapters (IPC in Electron, HTTP+SSE in browser).
- `lib/codex-theme-variant.ts`: runtime theme bridge that derives semantic color variables from the active light/dark theme variant and injects them onto `document.documentElement` before renderer surfaces read the token bridge.
- `lib/query-client.tsx`, `lib/query-keys.ts`, `lib/query-options.ts`: low-frequency renderer server-state substrate built on TanStack Query. Query functions still go through `lib/api.ts`; keys are centralized for projects, boards-by-project, history, settings, Git branch state, local environments, MCP status/resources, and workspace file reads.
- `lib/kanban-store.ts`: shared per-project board-summary store with one realtime subscription, deduped summary fetches, optimistic journal rebase (`baseBoard + pending/local ops`), LWW conflict superseding, typed conflict resolution (`updated|conflict|not_found`), and O(1) `cardIndex` lookup map that intentionally excludes full `description`.
- `lib/card-detail-store.ts`: renderer owner for full `Card` bodies keyed by project/card. Card Stage, toggle-list children, and projected card embeds hydrate details through `card:get` or `cards:details:get` only for selected/visible cards.
- `lib/use-kanban.ts`, `lib/use-history.ts`, `lib/use-projects.ts`: stateful hooks over API channels. `use-kanban` remains store-backed via `useSyncExternalStore`; `use-history` and `use-projects` use TanStack Query for server-state cache, invalidation, and cross-consumer request dedupe.
- `lib/use-workbench-state.ts`: window-local workbench shell state with explicit project-context slices. Session panels and durable terminal tabs are not owned here; project-session SQLite state is the primary model.
- `lib/workbench-persisted-schemas.ts`: renderer-side persisted-state schema/parsing layer for workbench/session history maps, tabs, panel widths, and restart-friendly shell snapshots.
- `lib/app-close-flush.ts`: renderer-side close-flush coordinator so all registered async flushers complete before one final Electron close ack is sent.
- `lib/window-sessions.ts`: renderer helpers for bootstrapping the assigned window session and saving workbench layout snapshots through IPC.
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
4. `db-notifier` emits `board-changed` for board/card changes, `project-sessions-changed` for session-tree changes, or `projects-changed` for project-list/order/pin changes.
5. Electron main broadcasts change events to all open windows. Board and session renderer subscriptions filter by `projectId`; project-list subscriptions are global.
6. Renderer shared project stores (`kanban-store`) receive IPC/SSE board-change signals and dedupe refresh work per project. Workbench session lists receive IPC/SSE session-change signals and reload the affected project sessions. Low-frequency server state managed by TanStack Query invalidates its centralized keys from subscriptions such as `projects-changed`, board changes, and Git branch changes.
7. Reminder scheduler polls occurrences, dedupes delivery via receipts, and emits `reminder:open` to renderer on notification click.

Board read flow:
1. High-frequency board consumers use `board:summary:get` / `/api/projects/:projectId/board-summary`, which returns `BoardSummary` and must not include `Card.description`.
2. Consumers that need bodies request them by id with `card:get` or `cards:details:get`. Batch hydration should be limited to visible/selected cards.
3. Description search runs in the main process through `cards:search`, returning project/card ids, status, score, and a bounded excerpt without returning full descriptions.
4. `board:get` remains a legacy full-payload compatibility channel only. New renderer paths should not call it.

Project sessions flow:
1. The renderer shell loads `project-sessions:list` for each visible project and renders projects as expandable folders with ordered sessions beneath them.
2. SQLite owns the shared tree: `project_order` and `pinned_project_order` store global sidebar project grouping order, `project_sessions.pinned`, `pinned_order`, `archived`, `archived_at`, and `unread` store project-local session sidebar state, `project_sessions.panel_state_json` stores independent right and bottom panel state with a v2 recursive split-tree layout (`root`, `activeLeafId`, `mruLeafIds`, optional `maximizedLeafId`), `project_session_tabs.panel_id` and `"order"` store a flat compatibility order derived from depth-first layout leaves, and `project_session_threads` stores optional session-to-thread attachments while thread metadata lives in `codex_threads`.
3. Window/session UI state owns only the active project, active session, and transient focus/history. Durable panel collapse, size, split layout, active leaf/tab, tab order, and tab state belong to project-session storage.
4. Every project has a seeded `Overview` session with one right-panel `db_view` tab for that project. The project-session service also lazily creates the Overview row for projects added after startup. Overview sessions always sort first and cannot be pinned, archived, deleted, or marked unread.
5. Session singleton right-panel kinds are `db_view` and `review`. Browser tabs are first-class multi-tabs with their own webview lifecycle, title/favicon state, context menu actions, and browsing history. Terminal tabs are session-owned bottom-panel tabs by default and carry only `projectId` plus `terminalSessionId`; cards never own terminals.
6. Session tab storage deliberately splits ownership from content targeting: `project_session_tabs.project_id` is the owner project that attaches the row to a session, while kind-specific `config.projectId` is the project whose content the tab body loads. These values normally match, but cross-project Card Stage tabs preserve a different config project so the active session can host another project's card without loading the wrong board.
7. Renderer-local panel previews are intentionally outside SQLite. Files and Browser previews occupy one preview slot per session panel leaf, replace each other within that leaf, and are persisted only when pinned through the normal session-tab create API.
8. Renderer-local side-chat tabs are also outside SQLite but use a separate leaf-scoped lifecycle from previews. The renderer creates `sidechat-loading:<parentThreadId>:<index>` tabs, asks main to start an ephemeral fork, replaces the loading tab with `sidechat:<threadId>`, and discards the backing temporary thread when the tab closes.

Codex Threads flow:
1. Renderer sends `codex:*` IPC actions through `lib/api.ts`, manager-backed control hooks, and the local-conversation app-server manager substrate.
2. Renderer loads `collaborationMode/list` via IPC and resolves active collaboration mode from the local-conversation manager when a thread exists; only no-thread/new-thread surfaces fall back to the global persisted default.
3. `codex-service` resolves card run target (`localProject` / `newWorktree` / `cloud`) through the project's source roots, including sticky per-card managed-worktree reuse via `runInWorktreePath`; for freshly created worktrees, it optionally executes selected `.codex/environments/*.toml` `[setup].script` before thread start. Session-owned thread starts use `codex:thread:start-for-session`, use the owning project's primary source for local/worktree starts, start the first turn immediately, persist the resulting thread in `codex_threads`, and attach it through `project_session_threads` without creating a card link.
4. Side-chat starts use `codex:thread:side-chat:start`: main forks the parent thread with `ephemeral: true` and excluded turns, supplies side-conversation developer instructions, injects a boundary message, caches the resulting side conversation as ephemeral manager state, and optionally submits the initial `/side` or selected-text prompt into the side thread. Side chats set local source metadata (`sideConversation` and `sideConversationParentNavigationPath`) but do not create `codex_threads`, `project_session_threads`, card links, or project thread-list entries.
5. For fresh worktree creation, `codex-service` emits `codex:event` `threadStartProgress` updates (`creatingWorktree` / `runningSetup` / `startingThread` / terminal `ready|failed`) with streamed stdout/stderr chunks so renderer can render real-time setup logs.
6. `codex-service` persists thread cwd in `codex_threads` (payload cwd or resolved fallback) so follow-up turns keep the same execution location even when a thread has no card or project.
7. `codex-link-repository` persists canonical thread metadata plus optional card relations in SQLite, while `codex-session-store` provides bootstrap-only recovery input for the main-process conversation manager when persisted Codex session artifacts exist.
8. Runtime notifications/server requests are first normalized into internal `CodexItemView` shapes, then projected in main into canonical `CodexConversationSnapshot` payloads and host-message broadcasts for the mounted thread route. Canonical thread summaries and snapshots also carry a minimal `source` contract; child/helper threads set `source.parentThreadId`, side chats set `source.sideConversation`, and root threads keep `source = null`.
9. Main still emits `codex:event` payloads for approval/request-side state and a manager-owned `codex:host-message` plane for shared objects plus thread stream sync. Connection/account/rate-limits/thread-summary/thread-start-progress all enter renderer as `sharedObjectUpdated`, thread-title cache sync enters as `threadTitleUpdated`, thread snapshots and incremental updates enter as `threadStreamStateChanged`, command output deltas enter as raw `mcpNotification` messages, and host/runtime failures enter the same plane as explicit `error` messages. Renderer no longer keeps a separate Codex control reducer; thread-start progress, model bootstrap, permission modes, thread summaries, thread titles, command output streaming, and active conversations all flow through the same local-conversation app-server manager substrate.
10. The active workbench thread stage is mounted entirely through `features/local-conversation`: `WorkbenchShell` passes active thread identity plus static shell inputs into connected thread/review containers, and the local-conversation feature owns the per-thread selectors, active projection pipeline, local type surface, and independently connected header/body/footer thread surfaces. The production route does not rebuild one synthetic `conversation` object or one broad stage model before rendering those surfaces.
11. Main exposes separate snapshot/resume request IPC plus a `codex:host-message` stream. Snapshot requests only rebroadcast the current manager-owned conversation snapshot; they never call `thread/read`, never call `thread/resume`, and never bootstrap transcript state on behalf of the active renderer route. Explicit resume requests still drive the active-thread `needs_resume -> resuming -> resumed` state machine and materialize the canonical conversation directly from `thread/resume` payloads without rereads or transcript merge fallbacks.
12. The Codex service now stores active thread authority as a conversation-centric manager record (`detail + resumeState + stream role + queued follow-ups + pending steers + item cache`) instead of scattering transcript authority across independent per-thread maps. Running-thread `queue` submits mutate manager-owned queued-follow-up state first, then a manager-owned drain loop advances those entries through `turn/steer` or the next `turn/start` when the active run can accept them.
13. `features/local-conversation` is manager-owned: renderer triggers auto-title generation through a main-owned `generate-thread-title` RPC (`hostId + prompt + cwd`), applies the returned title locally first, then persists it through `thread/name/set`. Main emits host-scoped `sharedObjectUpdated`, `threadTitleUpdated`, `threadStreamStateChanged`, `mcpNotification`, and `error` messages; a renderer host bridge fans those into an app-server message bus; and per-host app-server managers subscribe to that bus through a registry with per-conversation, any-conversation, and any-conversation-meta callbacks. Connected thread/review containers subscribe only to the active thread and its child memberships. Resumed child-thread de-dup reads `conversation.source.parentThreadId -> parent turns` through normal per-thread selectors; renderer must not reconstruct parent ownership by scanning every manager or by inferring parenthood from `childMemberships`. `WorkbenchShell` no longer owns a shell-wide conversation reducer, a full `conversationsById` map, or a separate control-plane reducer.
14. Thread titles are a first-class host capability, not a one-shot side effect of thread creation. Main persists a bounded `THREAD_TITLES`-style cache plus pending backfill queue, replays cached titles to app-server after startup/reconnect, and rebroadcasts `threadTitleUpdated` when a title changes. Renderer overlays cached titles onto thread summaries/conversation snapshots so installed and dev builds follow the same title lifecycle.
15. Renderer theme state follows split ownership: authored CSS declares the token and utility contract, while the runtime theme bridge computes semantic variables such as foregrounds, control backgrounds, borders, panel colors, and editor colors from the active theme variant before the CSS token bridge resolves renderer-facing aliases.
16. The Diff stage is a workbench-owned review surface, not a transcript diff card. `Last turn` review comes from the active conversation turn diff, while `unstaged` / `staged` / `branch` review data flows through dedicated main-process Git snapshot IPC.

Workbench reopen flow:
1. Main process keeps a profile-local window session catalog in `window-sessions-v1.json`; this is the cold-launch restore source for window count, layout snapshot, focus recency, and saved window bounds.
2. Renderer bootstrap consumes its assigned window session through IPC before mounting the shell. No workspace catalog or deleted legacy snapshot store participates in bootstrap.
3. Live workbench state continues to persist window-locally in `sessionStorage` as an in-session fallback, while durable reopen flows through window sessions. For the project-session shell, this window-local layer may remember active project/session/tab, pane widths, collapse overrides, and focus history; the shared session tree and tab order stay in SQLite.
4. On close, renderer flushes the current layout snapshot, card draft state, and registered close flushers before sending the final close ack.
5. Each window saves its own session layout. New windows are seeded from an explicit layout request, the last-focused window-session layout, or the default workbench layout.

## Invariants
- Persistent truth is split by ownership: Nodex-owned board/link metadata lives in SQLite, while Codex-owned thread history now lives in the main-process conversation manager plus explicit resume operations; the active renderer caches canonical conversation snapshots plus flat UI-only shell state rather than maintaining a second transcript-authority store, a second `resumeState` truth, or a second recovery layer.
- TanStack Query owns only low-frequency renderer server state: project lists, board snapshots used outside optimistic board editing, history recent state, server-backed settings, Git branch snapshots, local-environment config reads, MCP status/resources, and workspace file/directory reads. High-frequency or optimistic state stays in dedicated owners: `kanban-store`, the local-conversation app-server manager, terminals, browser/webview lifecycle, drafts, and localStorage-only preferences.
- Main-process local-thread streaming uses a materialized broadcast-conversation cache plus Immer-compatible `threadStreamStateChanged` patches for hot and patch-capable updates; keep assistant/plan/reasoning, request ingress, queue/steer rows, and turn/item patch paths on direct cache mutation, and reserve `emitThreadStreamStateChange()` for cold/fallback snapshot reconciliation only. Command output is the exception: main broadcasts raw `mcpNotification` deltas for live rendering, keeps a silent canonical output cache for snapshots/recovery, and flushes pending output before snapshots and item/turn completion. The renderer local-conversation manager owns the visible 50 ms command-output queue and appends into `commandExecution.aggregatedOutput`.
- Runtime validation belongs at boundaries. Persisted storage, selected HTTP bodies, and raw JSON payload families should parse through `src/shared/schemas/*` or feature-local schema adapters; normalized in-memory reducers/view-models remain plain TypeScript once the boundary parse succeeds.
- All card writes must pass `card-input-validation` constraints.
- High-frequency renderer board state must use `BoardSummary`. Full card bodies belong to explicit detail/search flows, not `kanban-store`, board/list/calendar views, or command-palette indexing.
- Recurrence exceptions and reminder receipts are project-scoped and persisted in SQLite.
- Completing an occurrence creates a `done` card with `archived = true`; archived cards stay out of board/sidebar/toggle-list flows but still surface in calendar occurrence queries.
- `move` operations are claim-safe: optional `fromStatus` enables optimistic concurrency checks.
- `card:update` supports optimistic concurrency claims with `expectedRevision`; stale claims return typed `conflict` with latest card snapshot and do not mutate DB state.
- Project-scoped data stays isolated (`project_id` on cards/history with cascading cleanup).
- Renderer never accesses SQLite directly.
- Custom editor behavior must preserve NFM round-trip fidelity.
- Codex threads have optional ownership metadata: a thread can be card-owned, session-owned, project-only, or projectless. Card ownership is represented by `codex_thread_card_links`; session ownership is represented by `project_session_threads`.
- Session-created threads must not create hidden cards, and session attachments do not create card links.
- Project-session panel layouts must normalize to at least one leaf per right/bottom panel. Durable tab ids are uniquely owned by one leaf, unknown tab ids are removed, unassigned durable tabs are appended to the active leaf, non-final empty durable leaves are pruned unless the renderer is preserving them for visible preview/side-chat tabs, active leaf/tab ids resolve to valid fallbacks, split ratios are clamped, and the flat `project_session_tabs` panel order is derived from depth-first leaf order after every durable panel mutation.
- Project-session panel tab drag-and-drop separates tab-row insertion from body split targets: tab-row drops render a non-layout-shifting insertion marker and commit leaf-scoped reorder/move operations, while body drops use a 10% edge threshold for split previews and center drops for group merge.
- Side-chat threads are ephemeral manager/cache records only. They must not create durable Codex thread links, session thread links, project thread-list entries, project-session tab rows, archive records, or cold-start restore targets.
- Codex thread creation is card-first and includes immediate first-turn submission for durable thread materialization.
- Codex thread/turn cwd must use the linked thread cwd when present (not only the project primary-source fallback).
- Thread-title generation is renderer-triggered but host-owned: renderer may request generation, but only main owns generation prompt building, persistent title cache/backfill, and authoritative `threadTitleUpdated` rebroadcasts.
- The active workbench conversation stage is now conversation-native: `features/local-conversation` consumes `CodexConversationSnapshot` turns/items directly, then derives an ordered per-turn item stream, semantic render buckets, blocked-turn state, search units, and collapse state in the renderer.
- The active workbench conversation stage must stay local-conversation-owned end-to-end: active shell, composer, thread-body helpers, request cards, and thread-item renderers have no secondary workbench thread renderer path.
- The Diff stage has its own review data plane. Transcript diff cards (`turn.diff`, tool-call patch previews) remain local-conversation surfaces; workbench review sources (`last-turn`, `unstaged`, `staged`, `branch`) are owned by `review-diff-panel` plus main-process Git review IPC, including snapshot, patch-application, repository-init, and full-file-content reads.
- Turn-scoped live requests (`approval`, `userInput`, `implementPlan`) are main-owned conversation request-plane entries, not renderer-synthesized heuristics. The renderer derives request cards by joining `conversation.requests` against the matching turn items before bucketization so blocked-turn state and composer request surfaces come from one canonical request owner.
- The composer region is one multiplexed shell, not a stack of unrelated footer surfaces: manager-owned pending steers, queued follow-ups, background terminal rows, and background child-agent rows render in one ordered shell above the input region, while live request cards replace the normal editor branch inside that same shell. When both exist, the first background child approval renders before the active-thread request card.
- Running-thread composer follow-up semantics are explicit: `queue` only mutates queued-follow-up state, `steer` submits an in-progress follow-up, empty drafts stay on `Stop`, and queued rows are drained by manager-owned follow-up submission instead of a renderer-local fake queue path.
- Internal bootstrap/context content such as `AGENTS.md`, developer instructions, and other setup wrappers is not part of the visible chat transcript.
- `cloud` run target is intentionally blocked at backend thread-start.
- For `newWorktree`, card-level `runInWorktreePath` is reused when available; missing/invalid paths are recreated and overwritten on the card.
- For `newWorktree`, optional `runInEnvironmentPath` stores a repo-relative `.codex/environments/*.toml` path. The full local-environment definition (`name`, `setup`, `cleanup`, platform overrides, actions) is owned by the main-process worktree-environment service and surfaced through the workbench settings page; only the selected default `[setup].script` participates in managed-worktree creation today.
- Environment setup failure aborts thread start, does not persist `runInWorktreePath`, and triggers best-effort cleanup of the newly created managed worktree.
- Managed worktree inventory is derived from linked thread cwd values rooted under `${serverDir}/worktrees`, deduplicated by resolved worktree path.
- Project identity is UUID-only and generated by the main process. Project names are display labels, ordered `project_sources` rows own local source folders, the first source is the primary cwd for Git, Files, Review, local-environment, and managed-worktree flows, and all sources participate in workspace-write sandbox roots.
- Codex worktree/local-environment execution requires a project primary source; plain local thread starts for empty-source projects allocate a generated per-thread workspace. Browser transport explicitly does not support Codex threads in this phase.

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
- Backend services can emit structured logs (JSON lines) with child-scoped context for HTTP, PTY, backup/reminder, and Codex runtime flows.
- Backend logs persist under `${KANBAN_DIR}/logs` for dev/unpackaged runs or explicitly enabled packaged diagnostics, with bounded serialization and sensitive-field redaction for debugging without dumping raw secrets.
- Detailed logging reference: `docs/product-specs/backend-logging-spec.md`.
- Editor subsystems include focused tests for parser, keyboard behavior, and sync edge cases.
