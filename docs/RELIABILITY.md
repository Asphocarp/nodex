# Reliability

## Reliability Goals
- Maintain durable local task state across app restarts.
- Keep board views synchronized across Electron and browser clients.
- Keep Codex thread state synchronized between main-process runtime, persisted Codex session history, SQLite link metadata, and renderer views.
- Provide safe recovery paths for destructive operations.

## Data Durability Model
- SQLite runs in WAL mode (`db-service.ts`) for resilient write/read behavior.
- SQLite schema version state is tracked in `PRAGMA user_version`.
- SQLite file reclamation runs with `PRAGMA auto_vacuum = INCREMENTAL`; startup migration applies `VACUUM` when switching to that mode, and history pruning opportunistically runs `PRAGMA incremental_vacuum`.
- Card and history writes are wrapped in transactions for atomicity.
- Project deletion cascades card/history rows to prevent orphaned state.
- Card descriptions remain materialized on `cards.description`, while historical description changes are stored in `description_revisions` / `description_blocks` and referenced from history rows via revision ids.
- Codex thread metadata persists in `codex_threads` with nullable project/card ownership, while card ownership lives in `codex_thread_card_links` and session ownership lives in `project_session_threads`.
- Persisted Codex session files under `$CODEX_HOME` / `~/.codex` are the preferred recovery source for linked thread turns/items across tab switches and app restarts.
- The main-process conversation manager now bootstraps canonical thread state directly from persisted Codex session files when needed; there is no separate app-owned transcript snapshot cache.
- Active-thread runtime authority is conversation-centric inside the main process: each loaded thread keeps one canonical manager record with transcript/detail, `resumeState`, stream role, queued follow-ups, and pending steers, and renderer snapshots are always serialized from that record.
- Project rename updates linked Codex rows transactionally with project metadata updates.

## Backup and Restore
- Whole-store backups include `kanban.db` and asset files.
- Manual and scheduled backups are managed by `backup-service.ts`.
- Restore requires explicit confirmation and supports pre-restore safety backup.

## Sync and Event Delivery
- Electron path: DB change notifier -> main-process fanout to all open windows -> IPC event -> hook refresh.
- Electron startup path: the main process starts through a small bootstrap entry that resolves the profile dir, scopes Electron storage, queues early deep links/second-instance events, and then dynamically loads the application runtime. Renderer windows still block behind the preload-driven initialization screen until runtime initialization resolves.
- Electron single-instance lock scope is profile-aware: bootstrap sets `userData`/`sessionData` under resolved `KANBAN_DIR` before calling `requestSingleInstanceLock`, so independently configured installs can run concurrently.
- Packaged macOS startup first checks whether the app is running from `/Applications`; if not, users can move it there through Electron's native `moveToApplicationsFolder`, continue from the current location, or quit.
- Browser path: DB change notifier -> SSE stream -> hook refresh.
- Renderer applies short mutation cooldown to reduce stale refresh races.
- Renderer IPC board-change subscriptions filter by `projectId` to avoid unrelated refresh churn across windows/projects.
- Reminder path: main-process scheduler scans due reminders every 30s, dedupes with `reminder_receipts`, and emits desktop notifications while app is running.
- Resume/startup catch-up replays missed reminders within the configured catch-up window and still dedupes by receipt keys.
- Packaged macOS builds expose an `electron-updater`-backed app-update channel: the main process publishes updater status changes over IPC, auto-checks only start after initialization completes and at least one window exists, downloads run in the background when enabled, and installation stays explicit via `Restart to Update`.
- Codex path: `codex-service` emits normalized `codex:event` IPC updates; renderer reduces events into thread/turn/item state.
- Codex client startup is handshake-gated (`initialize` + `initialized`) and reconnects with backoff on unexpected child exit.
- Backend observability includes structured JSON-line logs under `${KANBAN_DIR}/logs` for unpackaged/dev runs, covering HTTP requests, app lifecycle, PTY, backup/reminder jobs, and Codex client/service flows (thread start, turn start, approvals, user-input, reconnects, worktree setup). Packaged builds leave backend file and console logging off by default unless explicitly enabled through `NODEX_LOG_FILE` or `NODEX_LOG_CONSOLE`.
- Remote crash diagnostics are optional and separate from local logs. Sentry initializes only when diagnostics are enabled through Settings, `[server].diagnostics_enabled`, or `NODEX_SENTRY_ENABLED`; warn/error backend log entries may become scrubbed breadcrumbs, but Nodex does not ship raw JSONL logs to Sentry in v1.
- Detailed logging behavior, configuration, and extension guidelines live in `docs/product-specs/backend-logging-spec.md`.

## Failure Modes and Handling
- Oversized card payloads return HTTP `413` before DB work.
- Invalid inputs fail at validation boundary with actionable errors.
- Not-found resources return `404` from API routes.
- Current builds expect the latest SQLite schema; explicit older schema versions fail fast during startup with an unsupported-version error instead of attempting in-app migrations.
- Runtime import/startup failures are handled in bootstrap by destroying any windows, writing a bootstrap log entry under `${KANBAN_DIR}/logs`, showing a native `Nodex failed to start` dialog, and quitting.
- Stale card writes with `expectedRevision` return typed conflict payloads (`status: "conflict"`; HTTP `409`) and do not apply partial updates.
- Backup restore failures surface explicit error responses.
- Reminder delivery is at-least-once at scheduler level, then effectively exactly-once per `(project_id, card_id, occurrence_start, offset)` via receipt uniqueness.
- Missing Codex CLI binary surfaces explicit `missingBinary` connection status in UI.
- `codex-service` defers staged/bundled runtime validation until the Codex client actually starts, so pure service construction and state-only test paths do not fail on hosts where the pinned runtime has not been materialized yet.
- Packaged builds ship a pinned Codex runtime inside `Contents/Resources/bin`, and dev/unpackaged runs use the staged pinned runtime under `.generated/codex-runtime/bin`.
- macOS packaging preserves the upstream OpenAI signature on `Contents/Resources/bin/codex` instead of re-signing that binary under the app's identity, so existing `Codex MCP Credentials` Keychain ACL entries that trust OpenAI's Codex team continue to match packaged Nodex builds.
- Nodex never falls back to a system `codex` binary from `PATH`, so the runtime CLI version stays aligned with the committed `@nodex/codex-app-server-protocol` package in both packaged and local development flows.
- Permission-state reads degrade to a local fallback when the pinned Codex app-server runtime cannot start, so settings and approval fallback logic do not crash before the missing-runtime connection state can be surfaced.
- `codex:*` API calls in browser mode fail fast with explicit unsupported errors.
- App-update IPC/status calls in browser mode, unpackaged builds, and non-macOS builds return explicit `unsupported` status and do not attempt network update checks.
- Approval/user-input pending requests are rejected on Codex service shutdown to prevent hung renderer promises.
- Codex thread start tolerates rollout materialization lag (`empty session file`) by degrading to summary-only thread reads until full turn history becomes available.
- Codex follow-up turns tolerate app-server cold state after app restart: if `turn/start` reports `thread not found` for a persisted thread, the service issues `thread/resume` and retries once.
- Snapshot requests never call `thread/read` or `thread/resume`; they rebroadcast the current canonical manager record and lazily bootstrap that manager record from persisted session artifacts when a linked thread has not been loaded yet.
- Codex item hydration dedupes equivalent textual messages (`userMessage`, `assistantMessage`, `plan`, `reasoning`) across replay/live ID mismatches (for example synthetic `item-<n>` IDs from reads vs live `msg_*`/`rs_*` IDs) so follow-up text does not render twice.
- Backend log serialization is bounded (string/object/array limits) so debugging stays available even when services encounter unexpectedly large payloads.

## Operational Checks
- Before release: run `bun run typecheck`, `bun run lint`, `bun test`.
- Before release packaging on macOS: run `bun run codex:schemas:verify` so checked-in app-server schemas still match the pinned Codex version.
- Release macOS packaging uploads hidden source maps to Sentry only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are present; `.map` files remain excluded from packaged artifacts.
- Before enabling CI signing secrets: do one local notarization dry run and verify `codesign --verify --deep --strict`, `spctl --assess --type open`, and `xcrun stapler validate` against the generated macOS artifacts.
- During macOS packaging validation, inspect `Contents/Resources/bin/codex` with `codesign -dvvv` and verify it still reports `TeamIdentifier=2DC432GLL2`.
- Release CI publishes only after both `arm64` and `x64` notarized artifacts pass verification, and it synthesizes one canonical `latest-mac.yml` plus referenced blockmaps from the two per-arch updater outputs before the GitHub Release is published; tap sync runs after GitHub Release publication and should be retried independently if the external tap push fails.
- The authoritative release runbook for workflow triggers, job ordering, secret requirements, artifact naming, and rerun strategy is `docs/release-macos.md`.
- Before risky migrations/refactors: create a labeled manual backup.
- Keep retention settings in sync with local storage constraints.
- After large history-prune events, expect incremental vacuum to reclaim free pages gradually rather than in one blocking rewrite.
