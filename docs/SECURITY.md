# Security

## Threat Model
Nodex is local-first. Main risks are malformed local inputs, accidental data loss, unintended exposure of the local HTTP API, and unsafe command/file-change approvals during Codex thread execution.

## Security Controls in Place
- Input validation for card writes (`card-input-validation.ts`).
- HTTP body limits for mutation and image-upload routes.
- Browser-origin checks for mutating HTTP requests (trusted local dev origins only).
- Restrictive CORS policy for browser access (trusted local dev origins only).
- Read-only guard on SQL query endpoint.
- Read-only SQL result-size cap to avoid large memory responses.
- Electron preload bridge limits renderer access to a typed API surface.
- Renderer file attachment previews are scoped to native picker results; no generic renderer IPC channel returns arbitrary local file bytes.
- Stable asset URI scheme avoids embedding brittle absolute local URLs.
- Codex approvals are explicit protocol responses (`accept`/`decline`/etc) and are gated by the per-project Threads permission mode.
- Codex user-input requests are never auto-answered and require explicit renderer interaction.
- `nodex_app` reads and writes derive an exact-Turn authority snapshot from the verified launched task; model arguments and renderer responses cannot select another Project, Library, store epoch, Turn, or catalog revision. Ordinary snapshots use Project binding/grants. Main persists the selected Nodex preset separately from raw Codex config and requires both to agree before the built-in Full access preset records `:danger-full-access` provenance and receives temporary same-Library scope; Custom settings with equivalent raw sandbox values do not upgrade a Turn. Missing historical provenance falls back to Project scope, while stale or inconsistent recorded provenance fails closed.
- Every `nodex_app@4` write performs mutation-free canonical preflight before approval, then re-resolves the exact `(thread, turn, root thread, actor Project, Library, Profile, store epoch)` authority. Execution proceeds only when the fresh effect class, target resources, deletions, and ownership transformations equal the approved footprint. Full-access Library scope auto-approves write and destructive effects without a renderer card; it does not bypass ETag/CAS guards, schema revisions, lifecycle checks, footprint equality, or transaction validation.
- Nodex data-write grants exist only in the main process and are independent of Codex filesystem/command approval modes. Ordinary task grants bind app session, verified root task, Project, store epoch, and the renderer client that presented consent; destructive effects always re-prompt. Canonical conversation-state ownership cannot grant, revoke, or present Nodex authority. Denial, timeout, presentation-client disposal, task archive, Project/store change, shutdown, restart, or a headless first prompt revokes or withholds authority without mutation; an already-issued task grant remains usable while its renderer view is merely hidden.
- Full-access Library authority is an ephemeral overlay and never creates or expands `project_resource_grants`. Cross-compatibility-owner structure writes validate actor/source/target in one Library, move the complete ownership closure in one deferred-FK transaction, rebuild derived projections, require a clean `foreign_key_check`, and publish immutable source/final owner members. Store restore changes the epoch and invalidates prior Turn authority and broker grants.
- Authorization responses travel through the targeted active-view renderer route and use random occurrence identities, preventing another renderer or an equal app-server call ID from satisfying the request. The renderer validates the bound Project/task, presents the request as a local overlay, and cannot publish it into or elevate canonical owner/follower state. Exact durable call replay bypasses authorization only after its request fingerprint and prior compact result are verified; same-call/different-input collisions fail closed.
- Optional Sentry diagnostics are disabled by default, use `sendDefaultPii: false`, and scrub local paths, auth/cookie/token fields, prompt text, card descriptions, transcript content, SQL/query strings, and raw request bodies before upload. Session Replay is a separate off-by-default renderer opt-in that requires diagnostics to be enabled, masks all text and inputs, blocks media, and keeps screenshots and broad remote log shipping disabled.
- Optional Statsig telemetry is disabled by default, sends no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. Statsig web analytics is a separate off-by-default opt-in that disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical events such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events are blocked by default. Nodex does not enable Statsig Session Replay.

## Current Gaps
- No built-in authentication on the local HTTP API.
- No role-based access control model (single-user/local trust assumption).
- Security logging/auditing is still local-first and not audit-grade. Backend logs redact common secret-bearing fields (for example authorization headers, tokens, API keys, passwords, cookies, and session values) before writing JSON-line log records; optional Sentry crash diagnostics are for failure triage, not an audit trail.
- `full-access` is intentionally high authority: it removes Nodex approval prompts for the exact Turn and permits every read/write/destructive action currently exposed by `nodex_app@4` across the current Library, in addition to unrestricted Codex filesystem and network access.
- Workspace-write sandbox roots are derived from user-configured project sources. Additional allow-listing beyond those local source roots remains future hardening work.
- Dynamic-tool receipts are an idempotency and recovery ledger, not an audit-grade record of human intent. They intentionally exclude raw Nested Markdown/body content; the authorization preview is not retained as a second document history.

## Safe Operating Practices
- Bind HTTP server to loopback-only contexts where possible.
- Do not expose the local API port publicly without external controls.
- Keep dependencies updated (`bun update` cadence).
- Use manual backups before destructive operations.

## Hardening Backlog
- Optional API token gate for CLI/browser calls.
- Basic security smoke checks in CI (write-limit and read-only query assertions).
- Approval policy profiles (for example, command/file-change scopes and allow-lists) beyond the current `sandbox`/`full-access`/`custom` permission presets.
- Additional execution boundary controls for Codex subprocess invocations.
