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
- `nodex_app` reads and writes derive Project scope from the verified launched task; model arguments cannot select another Project, store epoch, or catalog revision. Opaque revision/cursor envelopes are HMAC-signed and bind token kind, Project, store epoch, resource identity, and canonical state, so tampered, cross-resource, cross-Project, and post-restore reuse fails closed.
- Every `nodex_app` write performs mutation-free canonical preflight before consent and executes only the frozen prepared command. Authorization therefore covers resolved effects—including identity deletion and protected owners—rather than untrusted raw arguments, while canonical optimistic concurrency still rejects a changed snapshot.
- Nodex data-write grants exist only in the main process and are independent of Codex filesystem/command approval modes. Ordinary task grants bind app session, verified root task, Project, store epoch, and renderer-owner lifecycle; destructive effects always re-prompt. Denial, timeout, owner loss, task archive, Project/store change, shutdown, restart, or headless execution revokes or withholds authority without mutation.
- Authorization responses travel through the targeted renderer-client route and use random occurrence identities, preventing a follower or equal app-server call ID from satisfying another request. Exact durable call replay bypasses authorization only after its request fingerprint and prior compact result are verified; same-call/different-input collisions fail closed.
- Optional Sentry diagnostics are disabled by default, use `sendDefaultPii: false`, and scrub local paths, auth/cookie/token fields, prompt text, card descriptions, transcript content, SQL/query strings, and raw request bodies before upload. Session Replay is a separate off-by-default renderer opt-in that requires diagnostics to be enabled, masks all text and inputs, blocks media, and keeps screenshots and broad remote log shipping disabled.
- Optional Statsig telemetry is disabled by default, sends no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. Statsig web analytics is a separate off-by-default opt-in that disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical events such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events are blocked by default. Nodex does not enable Statsig Session Replay.

## Current Gaps
- No built-in authentication on the local HTTP API.
- No role-based access control model (single-user/local trust assumption).
- Security logging/auditing is still local-first and not audit-grade. Backend logs redact common secret-bearing fields (for example authorization headers, tokens, API keys, passwords, cookies, and session values) before writing JSON-line log records; optional Sentry crash diagnostics are for failure triage, not an audit trail.
- `full-access` mode is convenience-first and auto-accepts any approval requests that still surface.
- Workspace-write sandbox roots are derived from user-configured project sources. Additional allow-listing beyond those local source roots remains future hardening work.
- Dynamic-tool receipts are an idempotency and recovery ledger, not an audit-grade record of human intent. They intentionally exclude raw NFM/body content; the authorization preview is not retained as a second document history.

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
