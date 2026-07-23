# Security

## Threat Model
Nodex is local-first. Main risks are malformed local inputs, accidental data loss, unintended exposure of the local HTTP API, and unsafe command/file-change approvals during Codex thread execution.

## Security Controls in Place
- Boundary validation for typed Core Module, IPC, and HTTP requests.
- HTTP body limits for mutation and image-upload routes.
- Browser-origin checks for mutating HTTP requests (trusted local dev origins only).
- Restrictive CORS policy for browser access (trusted local dev origins only).
- No arbitrary SQL inspection route in IPC, loopback HTTP, or the public CLI.
- Electron preload bridge limits renderer access to a typed API surface.
- Workspace-file IPC is available only to the top-level renderer frame of an owned app window. Directory browsing accepts canonical root-relative coordinates, verifies lexical and resolved-realpath containment, and omits directory symlinks that escape the selected root. Exact-file metadata/text/binary operations intentionally accept an absolute local path without a Project-root grant so user-visible agent outputs and patches remain openable outside the active source; this relies on the trusted-renderer boundary rather than path sandboxing. Write requests use an expected-modification-time CAS guard and never create missing parent directories implicitly.
- Electron bootstrap fixes Rust Core as the only production authority before
  store startup; the retired selector and JavaScript SQLite/Yjs implementation
  are absent. Native launch validates a regular, executable,
  non-symlinked Core binary, then trusts readiness only after the existing
  descriptor, capability, UDS, and handshake checks succeed; failed startup
  never falls back to another authority.
- Legacy Profile import does not restore JavaScript storage authority. The Host
  resolves one absolute regular-file migrator executable and bundle from its
  verified resources, while Core verifies the bundle against its manifest
  SHA-256 before use. Core accepts only complete normalized schema fingerprints
  for the frozen v26/two-v57/v68/v82/v83 inventories, creates an online database
  snapshot and validated no-symlink asset backup, and gives the hash-pinned,
  reproducibly generated sidecar only a staging Profile. Its reviewed
  compatibility overlays are limited to import-time legacy projection,
  workflow-status, recovered option-registry, explicit same-Library
  cross-Project Page read-grant, unresolved-reference diagnostic, and
  token-bound authority/evidence audit coordinates; opaque Session UI JSON
  remains under its own schema validation. Native exact-v84 and semantic
  validation must succeed before an
  fsynced journaled rename can replace live files; failure or interruption
  preserves or restores the original database, SQLite companions, and assets.
- The native Core runtime validates the Profile, `run`, and `run/core`
  ancestry without following symlinks; requires current-user ownership; and
  requires 0700 for `run/core` plus 0600 and the expected file type for the
  lock, socket, descriptor, and bearer capability. It removes a stale socket
  only after acquiring the lifetime lock and proving the existing entry is the
  current user's Unix socket. Runtime cleanup similarly removes only the exact
  start-nonce generation after validating every target.
- Optional background registration uses a signed nested application and its bundled macOS 13+ `SMAppService` LaunchAgent; it never installs a root helper or writes a launchd plist outside the signed bundle. The selected absolute Profile path is the only persisted input, stored as a private regular file below the current user's Application Support directory. The controller rejects symlinked configuration and executable entries, bounds configuration and control output, and executes the fixed sibling Core without a shell.
- Every native-Core HTTP request is authenticated by a fresh per-start
  capability and same-UID Unix peer credentials. Handshake registers the
  logical connection against peer PID/UID, client build, protocol, Adapter
  kind, and start nonce; later Module, event, and lifecycle requests require
  that exact connection binding. The only pre-handshake lifecycle exception is
  incompatible-version handoff: it still requires the bearer capability,
  same-UID/PID UDS credentials, genuinely disjoint protocol ranges, and an
  exact match for every descriptor-generation identity field, and it can drain
  only an otherwise idle Core. Compatible process reuse requires a live
  authenticated handshake matching the fixed-path descriptor. Neither a stale
  descriptor, recycled PID, self-declared build, nor failed/legacy handoff is
  process authority, and the launcher never kills the claimed process.
- The native Core transport rejects declared or streamed body overflow before
  domain decoding. JSON is required to be valid UTF-8 and is bounded by bytes,
  nesting depth, total nodes, array length, object fields, key length, and
  string length; Yjs/Awareness binary frames retain their narrower framing and
  payload bounds. JSON and Document responses are capped independently, while
  SSE remains a bounded-frame stream instead of being buffered as one response.
- Native CLI search never gives ripgrep a database path or a caller-selected
  directory. Core alone assembles authorized snapshot leases below the Profile,
  rejects symlinked or foreign-owned paths, seals directories and files
  current-user read-only, and publishes the manifest last. The CLI revalidates
  lease expiry, types, modes, relative paths, lengths, hashes, and the exact
  manifest before invoking the packaged binary with `--no-config`, a fixed
  snapshot root, no shell, and a closed read-only option set. Logical Page
  titles affect display mapping only and never physical path construction.
- Native CLI drafts use an explicit current-user-owned destination and a fixed
  manifest/base/work layout. Creation stages beside the destination and
  atomically promotes only a complete tree; base evidence and apply markers are
  read-only, while editable files are private. Every read opens with no-follow,
  validates ownership, type, mode, exact entry names, hashes, UTF-8, and byte
  bounds, and rejects symlink traversal or unknown entries. Core receives only
  the selected identities and accepted title/body semantic commands, never a
  filesystem path. Discard has no recursive caller-selected deletion path and
  refuses uncertainty instead of broadening cleanup.
- Stable asset URI scheme avoids embedding brittle absolute local URLs.
- Codex approvals are explicit protocol responses (`accept`/`decline`/etc) and are gated by the per-project Threads permission mode.
- Codex user-input requests are never auto-answered and require explicit renderer interaction.
- Provider credentials are main-process-only secrets. Anthropic, Kimi For Coding, Moonshot, and OpenRouter API keys are encrypted synchronously with Electron `safeStorage` and atomically stored in `${NODEX_HOME}/secrets/provider-credentials.v1.json` under a 0700 directory and 0600 regular file; unsafe permissions, symlinks, malformed ciphertext, or unavailable platform encryption fail closed. Renderer code can set, delete, and read readiness status but cannot retrieve plaintext. Decryption occurs only while constructing the Open Interpreter child-process environment, never in SQLite/Core execution profiles, IPC responses, argv, logs, rollouts, or Nodex backup manifests. Inherited environment keys remain process input and are reported separately from saved credentials.
- Nodex does not import Claude.ai or Claude Code subscription tokens and does not offer third-party Claude OAuth. Claude support uses an Anthropic API key or an explicitly configured OpenRouter key; OpenAI authentication remains runtime-managed. Provider/model/harness/reasoning metadata is non-secret and durable, but an existing task cannot change provider or harness in place.
- External-agent import is an explicit trusted-renderer workflow backed by expiring opaque scan ids. Source homes are canonicalized and read-only; the writable Agent home cannot be selected as its own source. Session content is hashed before and immediately before import, then app-server `thread/fork(path)` creates the target Thread. Native file copies never replace a target, reject symlinks, stage directory trees before rename, and do not copy SQLite/WAL/SHM files. Config translation allowlists passive settings, removes literal MCP environment/header/token material, and omits provider, authentication, approval, and sandbox state. Imported provider and connection credentials must be reauthorized through Nodex's main-owned credential boundary.
- `nodex_app` reads and writes derive an exact-Turn authority snapshot from the verified launched task; model arguments and renderer responses cannot select another Project, Library, store epoch, Turn, or catalog revision. Ordinary snapshots use Project binding/grants. Main persists the selected Nodex preset separately from raw Codex config and requires both to agree before the built-in Full access preset records `:danger-full-access` provenance and receives temporary same-Library scope; Custom settings with equivalent raw sandbox values do not upgrade a Turn. Missing historical provenance falls back to Project scope, while stale or inconsistent recorded provenance fails closed.
- Every `nodex_app@5` write performs mutation-free canonical preflight before any required consent, then re-resolves the exact `(thread, turn, root thread, actor Project, Library, Profile, store epoch)` authority. Execution proceeds only when the fresh effect class, target resources, deletions, and ownership transformations equal the approved footprint. Primary-Database and `read_write`-grant operations, including destructive writes, execute without a renderer card. Full-access Library scope also auto-approves. Neither path bypasses ETag/CAS guards, schema revisions, lifecycle checks, footprint equality, or transaction validation.
- Native Core prepared operations expose no additional private route: prepare
  and execute are typed intents in the owning Module `read/apply` pair. Only an
  Electron-host connection (or the isolated test role) may submit the exact
  persisted Turn provenance. Tokens contain 256 bits of fresh entropy, live for
  at most 60 seconds, are stored only as hashes, are capped globally and per
  connection, and bind request fingerprint, UDS connection, authority
  revisions, target footprint, and effect class. Execution acquires one
  in-flight lease inside the writer command and consumes it only after commit;
  rollback releases the lease for a bounded retry, concurrent use fails, and
  store replacement or process restart invalidates every outstanding token.
  Tokens are omitted from logs and durable receipts.
- Native Core JSONL logging accepts only explicit scalar metadata and applies
  the shared sensitive-key redaction and string bound before either sink. It
  records request/connection/Module/receipt/writer/event correlation but never
  request or Document bodies, Yjs/Canvas/Awareness bytes, SQL text or values,
  prepared tokens, bearer capabilities, runtime socket paths, or local source
  paths. Caller-provided connection, operation, receipt, and resource identities
  are logged only as bounded hashes; unknown request paths use a fixed
  `unmatched` label. The log directory and Core segments must be
  current-user-owned regular entries with exact modes 0700 and 0600. Core
  creates and exclusively locks a new Profile-family segment, refuses symlink
  segments, and removes only segments it can lock; an unsafe or failed file sink
  disables itself without weakening Core availability.
- Nodex resource consent exists only in main and is independent of Codex filesystem/command approval modes. One-call consent binds the exact call and prepared footprint. Task consent binds app session, verified root task, Project, Library, store epoch, and canonical resource roots; it is not owned by the renderer that presented it. Project consent is the only choice that persists `project_resource_grants`, and exact-Turn authority is revalidated before that write. Canonical conversation-state ownership and renderer fields cannot grant or elevate Nodex authority. Denial, timeout, task archive, Project/store change, shutdown, restart, or a headless first prompt withholds or invalidates transient authority without mutation.
- Full-access Library authority is an ephemeral overlay and never creates or expands `project_resource_grants`. Cross-compatibility-owner structure writes validate actor/source/target in one Library, move the complete ownership closure in one deferred-FK transaction, rebuild derived projections, require a clean `foreign_key_check`, and publish immutable source/final owner members. Store restore changes the epoch and invalidates prior Turn authority and broker grants.
- Authorization responses travel through the targeted active-view renderer route and use random occurrence identities, preventing another renderer or an equal app-server call ID from satisfying the request. The renderer validates the bound Project/task, presents the request as a local overlay, and cannot publish it into or elevate canonical owner/follower state. Exact durable call replay bypasses authorization only after its request fingerprint and prior compact result are verified; same-call/different-input collisions fail closed.
- Native Module receipt replay follows the same ordering: current store epoch
  and the exact provenance/intent fingerprint must match, but a committed
  operation is returned before a fresh token, current ETag, or current head is
  required. New or colliding operations cannot use that exception.
- Optional Sentry diagnostics are disabled by default, use `sendDefaultPii: false`, and scrub local paths, auth/cookie/token fields, prompt text, card descriptions, transcript content, SQL/query strings, and raw request bodies before upload. Session Replay is a separate off-by-default renderer opt-in that requires diagnostics to be enabled, masks all text and inputs, blocks media, and keeps screenshots and broad remote log shipping disabled.
- Optional Statsig telemetry is disabled by default, sends no `userID` or account data, and relies on Statsig's anonymous Stable ID plus safe app/runtime metadata. Statsig web analytics is a separate off-by-default opt-in that disables console-log capture, copy-text capture, and current-page URL attachment, then filters AutoCapture to low-risk technical events such as web vitals, performance, and session start. Click, copy, form, dead-click, rage-click, error, and page-view AutoCapture events are blocked by default. Nodex does not enable Statsig Session Replay.

## Current Gaps
- The public loopback HTTP API still has no built-in authentication; it is a
  separate Electron adapter and never receives the native Core bearer
  capability. Behavioral coverage requires 404 for native health, lifecycle,
  and Store Administration `read`/`apply` paths; the loopback router cannot
  proxy those private UDS routes by path coincidence.
- No role-based access control model (single-user/local trust assumption).
- Security logging/auditing is still local-first and not audit-grade. Backend logs redact common secret-bearing fields (for example authorization headers, tokens, API keys, passwords, cookies, and session values) before writing JSON-line log records; optional Sentry crash diagnostics are for failure triage, not an audit trail.
- `full-access` is intentionally high authority: it removes Nodex approval prompts for the exact Turn and permits every read/write/destructive action currently exposed by `nodex_app@5` across the current Library, in addition to unrestricted Codex filesystem and network access.
- Workspace-write sandbox roots are derived from user-configured project sources. Additional allow-listing beyond those local source roots remains future hardening work.
- A compromised trusted top-level renderer can request exact local file reads through the workspace-file bridge. Webviews, subframes, and unowned renderer contents are rejected, but process-level renderer isolation is still the confidentiality boundary for these reads.
- Dynamic-tool receipts are an idempotency and recovery ledger, not an audit-grade record of human intent. They intentionally exclude raw Nested Markdown/body content; the authorization preview is not retained as a second document history.

## Safe Operating Practices
- Bind HTTP server to loopback-only contexts where possible.
- Do not expose the local API port publicly without external controls.
- Keep dependencies updated (`bun update` cadence).
- Use manual backups before destructive operations.

## Hardening Backlog
- Optional API token gate for CLI/browser calls.
- Basic security smoke checks in CI for transport/body limits and absence of SQL inspection routes.
- Approval policy profiles (for example, command/file-change scopes and allow-lists) beyond the current `sandbox`/`full-access`/`custom` permission presets.
- Additional execution boundary controls for Codex subprocess invocations.
