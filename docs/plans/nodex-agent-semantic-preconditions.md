# Migrate Nodex agent tools to semantic preconditions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while implementation proceeds. This document follows `docs/PLANS.md` and must remain self-contained enough that a contributor with only this repository and this file can complete the migration.

## Purpose / Big Picture

After this change, a Codex task can read and edit a Nodex Project without carrying the storage engine's revision topology through every tool result. Ordinary reads return Project content, not a large superset of possible future write proofs. When an Agent is about to overwrite a title, complete NFM body, stable Block, scalar Database value, or View placement, it asks for one short ETag beside only that resource and supplies it as `ifMatch`. Additive and exact semantic operations such as creating a Card, appending many NFM Blocks, applying exact NFM patches, moving by stable anchors, or adding/removing set members do not need unrelated revisions.

The behavior is visible in two ways. A representative thirteen-row `query_database` response contains no ETags by default and is a small fraction of the v1 response. In Code Mode, an Agent can query, filter, narrowly prepare selected rows, perform one bulk edit, and return only a short count summary while the transcript still exposes every nested Nodex call and its raw details.

This plan migrates the existing unreleased `nodex_app@1` implementation to `nodex_app@2`. The completed v1 design and implementation record remains in `docs/plans/nodex-agent-dynamic-tools.md`; this plan repeats the context needed for the migration and does not require the reader to reconstruct decisions from that older file. ADR 0015 in `docs/adr/0015-agent-tools-use-semantic-preconditions.md` is the normative architectural decision.

## Progress

- [x] (2026-07-16 05:18Z) Re-read the repository architecture, domain model, ADRs, ExecPlan requirements, v1 dynamic-tool plan, current contracts, token codec, read/write services, authorization broker, canonical mutation kernels, task-pinned catalog, and transcript projection.
- [x] (2026-07-16 05:18Z) Researched the pinned and current upstream Codex Code Mode/dynamic-tool behavior, official app-server protocol, MCP structured output, HTTP strong validators, and official Notion MCP context-reduction/interface choices.
- [x] (2026-07-16 05:18Z) Accepted ADR 0015 and wrote this migration ExecPlan before changing production code.
- [x] (2026-07-16 05:18Z) Committed ADR 0015 and this ExecPlan as a documentation-only checkpoint before production-code changes.
- [x] (2026-07-16 05:45Z) Implemented and validated the `nodex_app@2` public contract, semantic guard vocabulary, sparse result selectors, and token-budget fixture.
- [x] (2026-07-16 05:45Z) Split digest-only short ETags from self-contained cursors, reused only the durable signing-key authority, and removed the obsolete universal token codec.
- [x] (2026-07-16 05:45Z) Made reads validator-free by default and added typed, operation-scoped `prepareFor` planning for titles, bodies, Blocks, values, and placements.
- [x] (2026-07-16 05:45Z) Migrated create, Document edit, Block transfer, and Database edit to semantic inputs, final re-resolution, authorization-footprint comparison, replay-before-guard ordering, and sparse output.
- [x] (2026-07-16 05:45Z) Added namespace-scoped Code Mode parsing/pipeline instructions and updated transcript result projection for the v2 shapes.
- [x] (2026-07-16 05:45Z) Updated architecture, product, security, reliability, changelog, ADR, and living-plan documentation for the implemented contract.
- [x] (2026-07-16 06:00Z) Ran focused cross-layer behavior tests, strict typecheck, full lint, and the standard Node/main/renderer/Electron integration suite; all passed after updating two v1 test expectations.
- [x] (2026-07-16 06:04Z) Completed the outcomes retrospective and prepared the finished implementation as one atomic feature commit after the documentation checkpoint.

## Surprises & Discoveries

- Observation: the representative query problem is primarily validator volume and payload design, not JSON punctuation.
  Evidence: the saved discussion measured 15,374 revision characters in an 18,801-character response. Removing validators by default leaves roughly 3,427 characters of actual response data before further sparse-output work.

- Observation: the canonical Block transfer Module already has the desired public/private split.
  Evidence: `src/shared/block-transfer.ts` defines `BlockTransferIntent` without freshness coordinates, and `prepareBlockTransfer` in `src/main/local-store/block-transfers.ts` compiles it to exact current location, membership, and Document-head checks. The Agent Adapter currently adds public tokens above this existing seam.

- Observation: the current short-looking “opaque revision” is a signed, self-contained state envelope rather than a digest.
  Evidence: `src/main/local-store/nodex-agent-token-codec.ts` base64url-encodes the complete kind, Project, store epoch, subject, and state JSON before adding an HMAC signature.

- Observation: cursor and validator requirements are different.
  Evidence: a write already supplies the resource identity and can recompute a guard from current state, while a page request needs the cursor to recover offset and query-snapshot data. Replacing both with digest-only tokens would make pagination impossible without a new server-side registry.

- Observation: the first Agent contract freezes internally compiled commands before user consent.
  Evidence: `src/main/agent-tools/dynamic-service.ts` prepares each write, asks the renderer for authorization, and then executes the stored command. `docs/SECURITY.md` and `docs/RELIABILITY.md` currently describe that frozen-command guarantee and must change with the implementation.

- Observation: exact NFM patches already carry a useful semantic compare condition.
  Evidence: `applyExactNfmPatches` in `src/shared/nodex-agent-tools/document-edit-compiler.ts` matches every `oldNfm` against the same source, enforces `expectedMatches`, rejects overlap, and applies replacements simultaneously. A Document-wide revision is stronger than necessary for unrelated concurrent edits.

- Observation: committed replay must precede current guard validation.
  Evidence: the current Database edit preparation validates schema state before resolving a committed dynamic-call receipt. A response-loss retry can therefore conflict after a later unrelated schema change even though the original call already committed.

- Observation: current Codex dynamic tools do not provide structured Code Mode results.
  Evidence: Nodex returns one JSON `inputText` item, the generated `DynamicToolFunctionSpec` has no output schema, and `DynamicToolCallResponse` has only `contentItems` and `success`. Pinned Codex 0.146.0 and current upstream convert the dynamic result to a JavaScript string.

- Observation: `Promise.all` does not currently make nested dynamic tools execute concurrently.
  Evidence: the Codex dynamic handler does not opt into parallel tool calls and the router serializes the calls. Code Mode still removes model round trips, but instructions must not promise I/O parallelism.

- Observation: transcript observability is already a separate renderer projection.
  Evidence: canonical dynamic items retain arguments, content items, success, duration, and raw protocol identity. `nodex-dynamic-tool-call-presentation.ts` derives compact labels and NFM diffs from arguments, while `dynamic-tool-call-inspector.tsx` owns formatted details and Raw access.

- Observation: membership identity must be part of Database value and placement ETags even when logical values and numeric revisions are equal.
  Evidence: removing and re-adding a Card can recreate revision-zero/one state with the same value and placement. Binding the stable membership ID prevents that ABA sequence from validating an older ETag.

- Observation: one shared transfer `from` is both smaller and more truthful than repeating a source on every root.
  Evidence: the canonical transfer kernel rejects mixed-source root sets before compilation. `blockIds` plus one move-only `from` expresses that invariant directly; copy can resolve its current source without any freshness proof.

## Decision Log

- Decision: implement ADR 0015's semantic-precondition model rather than only shortening every existing revision.
  Rationale: short tokens alone preserve a shallow interface and still return a validator superset on broad reads.
  Date/Author: 2026-07-16 / Codex

- Decision: keep all eight intent-oriented tools and change their concurrency contract in place at toolset revision 2.
  Rationale: separate tools preserve deferred schema loading, authorization effect locality, and understandable transcripts. One giant mutation union does not reduce domain complexity.
  Date/Author: 2026-07-16 / Codex

- Decision: retire v1 execution instead of maintaining parallel v1/v2 services.
  Rationale: dynamic tools are unreleased, Nodex has no real users or data, and repository policy favors long-term coherence over compatibility. Existing v1 task bindings remain truthful and fail with `tool_catalog_stale`; they are not rewritten to claim v2.
  Date/Author: 2026-07-16 / Codex

- Decision: use one generic `ETag`/`ifMatch` public vocabulary and keep operation-specific guard kinds internal.
  Rationale: the operation position supplies the meaning, while one public validator type prevents storage topology from leaking into schemas.
  Date/Author: 2026-07-16 / Codex

- Decision: encode ETags as a digest-only `nxe1` HMAC and preserve a separate self-contained cursor codec.
  Rationale: writes can recompute current state from their resource arguments; pagination must decode its state. Both remain stateless and store-epoch bound.
  Date/Author: 2026-07-16 / Codex

- Decision: represent `prepareFor` as a bounded list of typed discriminated operations.
  Rationale: one read may prepare title plus body or values plus placement. A typed list supports composition without asking the Agent to name internal revision kinds.
  Date/Author: 2026-07-16 / Codex

- Decision: re-resolve semantic intent after consent and compare an authorization footprint, not the complete prepared command or resulting NFM.
  Rationale: unrelated current-head changes should not invalidate additive or exact semantic work, while expanded deletion, ownership, destination, or effect scope must never execute under old consent.
  Date/Author: 2026-07-16 / Codex

- Decision: keep the current JSON-text transport and document a one-time Code Mode parser in the namespace description.
  Rationale: adding unused TypeScript protocol fields cannot change the pinned Codex Rust handler. Structured output and parallel-safety flags require an actual Codex upstream upgrade.
  Date/Author: 2026-07-16 / Codex

- Decision: make mutation output sparse by default and use a bounded `return` selector for NFM, detailed IDs, or fresh ETags.
  Rationale: canonical receipts and transcript raw data are observability channels; model-facing output should contain only data useful to a subsequent action.
  Date/Author: 2026-07-16 / Codex

- Decision: reject a call with a retryable conflict when its post-consent authorization footprint changes instead of silently requesting consent in a loop.
  Rationale: the old consent is never reused, the retry produces one fresh preview from current authority, and a rapidly changing resource cannot trap the user in repeated prompts inside one tool call.
  Date/Author: 2026-07-16 / Codex

## Outcomes & Retrospective

The migration produced one coherent `nodex_app@2` contract rather than a compatibility layer. Public reads no longer expose the six storage-revision families. Typed `prepareFor` entries mint only adjacent overwrite ETags, additive create/NFM insert/exact patch/set-delta/copy operations carry no validator, and bounded `return` selectors keep mutation results sparse. The representative thirteen-row query fixture is 1,895 bytes with zero ETags, about 90% smaller than the 18,801-character v1 sample that motivated the migration.

ETags are fixed 48-character `nxe1` HMAC digests over canonical operation state. Self-contained `nxc1` cursors retain only pagination's decoding responsibility. Database value and placement guards bind membership identity as well as logical/revision state, closing the remove-and-re-add ABA case. The former universal `nxt1` codec was removed without a schema migration because both formats reuse the existing durable signing key and store epoch.

All four writes now pass through one `prepareAuthorizedWrite` orchestration boundary: resolve replay or semantic preflight, obtain consent for the resolved footprint, preflight current authority again, reject a changed footprint, then execute only the fresh exact command through the existing Hub/writer kernels. Exact committed replay precedes current guard checks. A changed footprint deliberately returns a retryable conflict so the next invocation gets one fresh preview; it does not run a potentially unbounded consent loop. Transfer also converged on one shared move-only `from`, matching the kernel's single-source invariant more directly than a source per root.

Code Mode remains on the pinned app-server's JSON-text transport. Namespace-level instructions now show the parse/error boundary, keep NFM/rows/cursors/ETags inside JavaScript, serialize dependent writes, and expose only a bounded `text()` summary. Transcript projection understands the sparse v2 shapes while preserving exact nested raw items. Native structured dynamic output, completed-item structured content, and read-only parallel-safety declarations remain upstream Codex work; no ignored local protocol fields were added.

Validation completed with 17 shared contract/compiler tests, 64 focused main/runtime tests, 19 focused renderer projection tests, strict TypeScript, and full ESLint. The standard suite passed 1,188 Node tests, 1,339 main-process tests, 2,866 renderer tests, and 29 Electron integration tests. A production build was not added because no generated protocol, bundler configuration, packaging path, or application entrypoint changed; typecheck plus the standard cross-runtime suite exercised the changed runtime boundaries. The manual disposable-Project Code Mode scenario remains a useful exploratory smoke test, but its contract, service, authorization, replay, and transcript invariants are covered automatically.

## Context and Orientation

Nodex is a local-first Electron app backed by SQLite. A Project is an isolated Space. Every persistent content identity is a Block. A Card is a document-bearing Block, a Database is a Block with relational properties/memberships/Views, and a Kanban is one View kind. A Block has one exclusive location: directly in Space, inside a Yjs-backed Document, or as an owning Database membership. `CONTEXT.md` and ADRs 0001 through 0005 define these terms.

Codex app-server receives a dynamic-tool catalog when a task starts. `src/main/codex/dynamic-tool-registry.ts` stores registrations by namespace, toolset revision, and tool name. `src/main/codex/nodex-dynamic-tool-registry.ts` registers Nodex's contracts and namespace description. `src/main/codex/codex-dynamic-tool-catalog-bindings.ts` chooses the current revision for a new task, while `codex-dynamic-tool-catalog-repository.ts` persists the revision with the task. The app-server rollout and Nodex binding are intentionally task-pinned. `src/main/codex/nodex-agent-dynamic-tool-runtime.ts` validates a call against the pinned revision and serializes success or failure into one JSON text content item.

The v1 public schemas live in `src/shared/nodex-agent-tools/`. `base-schemas.ts` defines six branded opaque revision strings and the common result envelope. `read-schemas.ts` returns revisions from context, Block, Document, Database, row value, and View placement reads. `write-schemas.ts` requires those revisions throughout create, Document edit, transfer, and Database edit. `contracts.ts` binds schemas, descriptions, deferred loading, and effect classification. `read-runtime.ts` and `write-runtime.ts` define worker-safe request/result and prepared-command types.

Substantial Agent reads run in the Block writer through `src/main/agent-tools/read-service.ts`. `read-context.ts`, `read-block.ts`, and `read-query-database.ts` compose one SQLite snapshot and mint current tokens through helpers in `read-support.ts`. Search is unaffected by validator semantics except for the common result envelope.

The current `src/main/local-store/nodex-agent-token-codec.ts` encodes both revisions and cursors as self-contained `nxt1` payloads signed with the durable 32-byte key in `nodex_agent_token_keys`. The new implementation needs a digest-only ETag module and a cursor-only self-contained module. The existing schema and key can be retained; no database migration is necessary unless implementation evidence proves otherwise.

Writes are orchestrated by `src/main/agent-tools/dynamic-service.ts`. Each write service performs a mutation-free preflight in SQLite, records deterministic allocations and call identity in `nodex_agent_call_receipts`, returns a prepared exact command and preview data, waits for renderer authorization, and executes through the Document Hub or Block writer. `authorization-broker.ts` binds ordinary task grants to root task, Project, store epoch, renderer owner, and app session. Exact call replay is separate from canonical mutation receipts and must remain idempotent.

`document-edit-service.ts` reads an exact Card materialization and uses `document-edit-compiler.ts` to compile title, NFM insert/patch/replace, or stable Block edits. The resulting internal Document mutation retains store epoch, generation, expected head, mutation identity, and optional write-fence coordination. `create-service.ts` composes Card genesis, destination placement, membership values, and optional View placement atomically. `transfer-service.ts` adapts to the existing `BlockTransferIntent`/`prepareBlockTransfer` seam. `database-edit-service.ts` compiles scalar value compare-and-set, set-like add/remove, and grouped View placement into `DatabaseMutationRequest`. These internal exact coordinates remain unchanged unless the Adapter needs a cleaner compile boundary.

The renderer transcript does not execute tools. `src/shared/codex-canonical-item-projector.ts` retains the canonical dynamic-call item. `src/renderer/features/local-conversation/projection/tool-metadata/nodex-dynamic-tool-call-presentation.ts` derives bounded Nodex labels and NFM diffs, and `dynamic-tool-call-inspector.tsx` renders details and exact raw data. The v2 result projection must continue to read counts and identities from sparse output without weakening Raw access.

In this plan, a semantic precondition is a user-meaningful condition under which an operation remains safe, such as “this exact old NFM still occurs once” or “this scalar value is the one I read.” An ETag is a short signed digest that proves one observed semantic state. An internal compare-and-set coordinate is a numeric revision, Document head, membership identity, or other storage value that only the writer uses to make the final transaction atomic. An authorization footprint is the stable user-visible mutation scope approved by the renderer, excluding incidental internal heads and revisions.

## Plan of Work

### Milestone 0: commit the architectural decision and migration specification

Add ADR 0015 and this plan without changing production code. Review the Markdown directly, run `git diff --check`, and commit both files with a conventional documentation subject and explanatory body. This creates a restartable checkpoint before any public schema changes.

At the end of the milestone, `git show --stat HEAD` contains only the ADR and ExecPlan, and the plan's Progress section records the commit. No code checks are required for this docs-only milestone.

### Milestone 1: define and prove the v2 contract

In `src/shared/nodex-agent-tools/identity.ts`, advance the current toolset revision to 2. Do not rewrite persisted revision-1 task bindings. In `base-schemas.ts`, replace the six public revision brands with one bounded `ETag` string and keep cursor separate. Simplify the result envelope so Code Mode can distinguish success data from an in-band error without duplicating the toolset revision in every payload. Preserve a concise structured recovery code and target details for programmatic conflict handling.

In `read-schemas.ts`, remove all mandatory validators. Define bounded `prepareFor` discriminated unions and make ETags conditional beside only the prepared title, Document body, structural Block, property value, or View placement. Refine property selection so a narrow `get_block` can request specific property IDs. In `write-schemas.ts`, remove destination and top-level revisions, add `ifMatch` only to overwrite operations, add logical `from` to transfer moves, and add a bounded `return` selector. Keep the existing NFM and stable-anchor vocabulary. Do not add schema/View mutation operations that v1 intentionally did not expose.

Update `contracts.ts` descriptions and one canonical effect classifier so NFM patch is classified from prepared effects rather than inconsistently by input shape. Update worker runtime types after the public schemas are stable. Adjust transcript presentation helpers for renamed title/result fields only when tests demonstrate a visible projection change.

Add contract tests that prove strict JSON Schema, absence of the six revision names, correct required/optional guards for every operation, bounded `prepareFor` composition, and the v2 toolset binding. Add a constructed thirteen-row output budget fixture. The default result must contain no ETag and target less than 5 KiB, with a stretch goal below 4 KiB. A prepared response must contain exactly the requested validators.

At the end of the milestone, shared contract tests and dynamic registry tests pass even though the services may still need migration. The public API is unambiguous enough that subsequent milestones only implement it.

### Milestone 2: separate short ETags from cursors

Replace the all-purpose token codec with two focused modules under `src/main/local-store/`. The ETag module canonicalizes `(version, guardKind, projectId, storeEpoch, subject, currentState)`, computes HMAC-SHA256 using the existing durable key, and emits exactly `nxe1.` plus a 43-character base64url digest. It exposes mint and assert functions; it never decodes old state. Format validation happens before the timing-safe comparison.

The cursor module retains a signed, self-contained payload with Project, store epoch, subject, offset, and query snapshot. Give it a cursor-specific prefix and schemas so a cursor cannot be accepted as an ETag or vice versa. Move `read-support.ts` to explicit `mintEtag`, `assertEtag`, `mintCursor`, and cursor-decode helpers. Delete the universal token-kind abstraction once all call sites migrate.

Tests must prove deterministic same-state ETags, a stable 48-character total length, changed-state mismatch, tamper rejection, cross-kind/resource/Project/epoch rejection, same-epoch process reopen, and no state disclosure. Cursor tests must continue to prove pagination, query binding, tamper detection, and stale snapshot rejection. No server-side token registry or schema migration should appear.

At the end of the milestone, the codecs are independently understandable and their focused main-process tests pass.

### Milestone 3: make reads data-first with on-demand guard planning

Refactor `read-context.ts` to stop minting Database schema and View validators. Refactor `read-block.ts` to return plain location and selected values by default, compute title/body/Block/subtree/property ETags only for requested `prepareFor` entries, and reject preparation that is inconsistent with the requested representation or unknown target IDs. A Block-delete ETag must hash the canonical subtree. A body ETag must hash canonical body state independently of title; a title ETag must hash canonical rich title independently of body.

Refactor `read-query-database.ts` to stop unconditionally minting schema, View, row location, value, and placement tokens. For `value.set`, mint only selected property-cell ETags requested by `prepareFor`. For `view.place`, mint only returned placement ETags and bind the current View configuration, membership, grouping value, and position state required by that operation. Continue deriving every row from one SQLite snapshot and preserve cursor behavior.

Keep ETags adjacent to their resource so a JavaScript pipeline can pass `cell.etag`, `body.etag`, or `placement.etag` directly into the corresponding operation. Do not return a separate flat bag that requires the Agent to reconstruct identity associations.

Read tests must demonstrate zero default ETags, exact preparation targeting, independent title/body freshness, subtree sensitivity, Project/store isolation, current Database query behavior, and the response budget from Milestone 1 using real service output.

At the end of the milestone, read-only Agent tasks receive concise results and all read-service suites pass.

### Milestone 4: compile semantic writes after consent

Migrate each write service while preserving canonical receipts and existing atomic kernels.

For `edit_document`, resolve committed replay before guards. Read the latest materialization without a public Document revision. Validate title, whole-body, and stable Block ETags only for operations that carry `ifMatch`. Let exact NFM patch and insertion compile against current canonical NFM. Preserve deterministic Block allocations across repeated preflight. Return an authorization footprint containing effect class, target Document, protected updated roots, deleted subtrees, and owner-deletion scope. After consent, run preflight again with the same call identity, compare footprints, return a retryable conflict when scope changes so a fresh invocation produces a new preview, and otherwise execute the newly compiled exact Document mutation. Do not auto-retry a rejected kernel receipt with the same mutation ID.

For `create`, remove destination revisions and compile current Document, Database, View, schema, group, and anchor authority during both preflight passes. The input and allocated identities remain stable. A compatible concurrent destination change can recompile; an invalid target fails before mutation. The one-transaction aggregate and rollback behavior remain unchanged.

For `transfer_blocks`, require logical `from` for moves, resolve copies from current source, and remove public location/destination revisions. Reuse `BlockTransferIntent` and `prepareBlockTransfer` for final exact compilation. The authorization footprint includes source roots, target authority, mode, and promotion/wrapper/ownership transformation evidence. A changed transformation or ownership closure rejects the old call so its retry receives a fresh preview and consent.

For `edit_database`, resolve committed replay first, remove the top-level schema guard, validate scalar cell and placement ETags against current rows, and let set-like add/remove compile against the latest set. A placement ETag subsumes separate View and item revisions. The final compiler still emits exact expected value, membership, grouping, View, and position revisions for the Database kernel.

Add a shared final-resolution helper in `dynamic-service.ts` rather than copying prepare/authorize/reprepare logic four times. Its guard clauses handle completed replay, preflight failure, authorization denial, footprint broadening, and final execution. Keep the happy path linear. The footprint comparison must be pure and tested. Update authorization previews so affected resources, old/new scalar intent, protected deletions, transfer transformations, and destination are visible enough to justify the footprint.

Project results through sparse output. Default create returns created Card/Document IDs and bounded counts. Document edit returns Document ID and effect counts. Transfer returns source/result root IDs, final logical locations, and transformation kinds. Database edit returns Database ID and operation counts. `return` may request detailed Block maps, complete current NFM when still at the committed head, or fresh ETags. Public `receipt.duplicate` disappears; exact retry still replays the stored result.

The tests for this milestone must cover revision-free create/insert/patch/add-remove, ETag conflicts for replace/title/Block update-delete/value set/placement, unrelated Document edits during authorization, patch target changes, subtree changes, compatible and incompatible destination schema changes, logical transfer source changes, footprint-change conflict, denial with zero writes, committed replay before guard checks, sparse output selectors, and all existing rollback/idempotency cases.

At the end of the milestone, all four write tools execute v2 semantic requests through existing atomic kernels, and focused service, Hub, writer, and kernel tests pass.

### Milestone 5: make Code Mode and transcript behavior explicit

Extend `NODEX_APP_TOOL_NAMESPACE_DESCRIPTION` in `src/main/codex/nodex-dynamic-tool-registry.ts` with a compact current-runtime instruction: results are JSON text; parse once; keep intermediate NFM, rows, cursors, and ETags inside JavaScript; use narrow fresh reads after filtering; prefer bulk mutations; serialize dependent writes; treat `error` as failure; and emit only bounded summaries through `text()`. Do not repeat this text in every tool description and do not promise actual parallel execution.

Keep `nodex-agent-dynamic-tool-runtime.ts` on the protocol-supported `inputText` transport. Update its tests to prove the in-band error shape expected by the wrapper. Record `outputSchema`, `structuredContent`, a dedicated Codex dynamic output, completed-item structured content, and read-only parallel-safety declarations as upstream work. Do not hand-edit generated protocol files or send ignored fields to the pinned binary.

Update `nodex-dynamic-tool-call-presentation.ts` to parse v2 sparse results for trustworthy counts and identities while deriving NFM diffs from arguments. Keep `dynamic-tool-call-inspector.tsx` and canonical raw items lossless. Add renderer tests only for actual behavior changes; do not assert Tailwind or source strings. Storybook needs an update only if the visible presentation structure changes.

At the end of the milestone, a manual Code Mode pipeline can keep full nested values out of its final model-visible summary, and the transcript still shows compact Nodex labels, Details, NFM diffs, and Raw data.

### Milestone 6: update source-of-truth documentation and complete validation

Update `ARCHITECTURE.md` to describe the semantic guard planner, final re-resolution, authorization footprint, and internal CAS boundary. Update the Agent Integration section in `docs/product-specs/nodex-product-spec.md` with `nodex_app@2`, default validator-free reads, ETag/ifMatch, NFM patch semantics, sparse results, Code Mode behavior, and v1 retirement.

Update `docs/SECURITY.md` so ETags are compare tokens rather than capabilities, guard validation does not authorize writes, and post-consent recompilation is bounded by a non-expanding footprint. Update `docs/RELIABILITY.md` to replace frozen-command wording with semantic re-resolution, replay-before-guard ordering, and existing kernel receipt/CAS guarantees. Update `docs/references/nested-markdown-spec.md` to distinguish exact patch, additive insertion, and guarded replacement. Update the existing Unreleased dynamic-tools changelog bullet rather than adding a Changed/Fixed entry for an unreleased feature. Update the completed v1 plan only with a final pointer to ADR 0015 and this successor plan; do not rewrite its historical decisions.

Run focused tests throughout. When the edit set is stable, run strict typecheck and lint, then the standard test suite because this migration crosses shared contracts, main/store services, app-server routing, and renderer transcript projection. Run production build if generated app-server protocol, bundling, or entrypoints changed; otherwise record why it was unnecessary. Exercise a disposable Project manually if the automated integration path cannot prove Code Mode behavior.

At the end of the milestone, all source-of-truth docs agree with the implementation, validation evidence is captured below, the plan retrospective is complete, and the repository has one coherent final implementation commit.

## Concrete Steps

Work from `/Users/asc/repo/nodex`. Before each milestone, run `git status --short --branch` and preserve unrelated user changes. Search with `rg` before changing a public type or helper. Use `apply_patch` for manual edits. Use Electron-ABI-aware test scripts for main/store and integration tests.

For the documentation checkpoint, run:

    git diff --check
    git diff -- docs/adr/0015-agent-tools-use-semantic-preconditions.md docs/plans/nodex-agent-semantic-preconditions.md
    git add docs/adr/0015-agent-tools-use-semantic-preconditions.md docs/plans/nodex-agent-semantic-preconditions.md
    git commit -m "docs(agent-tools): adopt semantic preconditions" -m "Record the nodex_app@2 concurrency boundary and a restartable migration plan before changing the public dynamic-tool contract."

For contract and pure compiler work, run focused Node tests such as:

    pnpm exec vitest run --config vitest.node.config.ts src/shared/nodex-agent-tools/contracts.test.ts
    pnpm exec vitest run --config vitest.node.config.ts src/shared/nodex-agent-tools/document-edit-compiler.test.ts

For codecs and main-process Agent services, use:

    pnpm test:main src/main/local-store/nodex-agent-etag.test.ts
    pnpm test:main src/main/local-store/nodex-agent-cursor-codec.test.ts
    pnpm test:main src/main/agent-tools/read-service.test.ts
    pnpm test:main src/main/agent-tools/document-edit-service.test.ts
    pnpm test:main src/main/agent-tools/create-service.test.ts
    pnpm test:main src/main/agent-tools/transfer-service.test.ts
    pnpm test:main src/main/agent-tools/database-edit-service.test.ts
    pnpm test:main src/main/agent-tools/dynamic-service.test.ts

For registry/runtime and transcript projection, use:

    pnpm test:main src/main/codex/dynamic-tool-registry.test.ts src/main/codex/nodex-dynamic-tool-registry.test.ts src/main/codex/nodex-agent-dynamic-tool-runtime.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/features/local-conversation/projection/tool-metadata/nodex-dynamic-tool-call-presentation.test.ts

For handoff, choose the broad gates required by the final diff. The expected default is:

    pnpm run typecheck
    pnpm run lint
    pnpm test
    git diff --check
    git status --short

Record commands, pass counts, relevant response-byte measurements, and any isolated unrelated failures in this plan as they occur. Commit coherent milestones with a conventional subject and explanatory body. Do not leave the worktree dirty at a stopping point.

## Validation and Acceptance

Contract acceptance requires that a new task receives `nodex_app@2`, every schema is strict, no public schema contains `DocumentRevision`, `LocationRevision`, `DatabaseSchemaRevision`, `DatabaseValueRevision`, `ViewRevision`, `ViewPlacementRevision`, `ifSchemaRevision`, or `ifLocationRevision`, and an old v1 binding fails explicitly with `tool_catalog_stale` instead of executing v2 under a v1 rollout.

ETag acceptance requires exactly one public validator type and a stable digest-only format. Minting the same guard twice in the same Project/store state returns the same 48-character ETag. Any state, kind, subject, Project, epoch, or signature change fails. Opening the same store in a later process preserves valid ETags; rotating the store epoch invalidates them. No ETag reveals IDs or numeric revisions when base64url-decoded because it contains only a digest.

Read acceptance requires zero ETags in `get_context`, `get_block`, and `query_database` by default. A `prepareFor` list returns ETags only for its requested fields/resources. A thirteen-row query fixture remains below 5 KiB and should be below 4 KiB if ordinary data allows. Cursor pagination continues to reject a changed query snapshot.

Document acceptance requires that a multi-Block NFM insert and exact patch need no ETag. An exact patch succeeds after an unrelated concurrent edit but fails when `oldNfm` no longer has the requested match count. Whole replacement conflicts after a body change but not after a title-only change. Title replacement conflicts only after title change. Block deletion conflicts after any target-subtree change. Stable Block movement preserves concurrent content. Any re-resolved change to protected deletions or owner scope rejects the old call and requires a fresh preview on retry.

Create acceptance requires one complete Card with rich title and many-Block NFM body to commit atomically in Space, Document, or Database without public revisions. A destination that remains semantically valid after concurrent change recompiles to current authority. A deleted anchor, incompatible schema, or invalid View/group fails with no partial Card, membership, value, placement, or receipt state.

Transfer acceptance requires a move to state logical `from`, a copy to omit freshness proof, and the writer to continue compiling exact source locations, memberships, Document heads, and destination authority. A source that changed container fails. A changed promotion/wrapper or recursively owned closure rejects the old call and produces a fresh authorization preview on retry. All-old/all-new relocation and exact retry remain intact.

Database acceptance requires scalar `value.set` and View placement to fail only when their selected semantic unit changed. Unrelated rows, unselected properties, and compatible schema changes do not invalidate the call. Set add/remove applies against the current set. The kernel still uses exact numeric revisions and one atomic mutation receipt.

Code Mode acceptance uses a disposable Project and a generated JavaScript workflow. The workflow parses JSON text once, queries a Database without validators, filters rows inside V8, narrowly prepares only selected scalar cells, sends one bulk `edit_database`, and calls `text()` with only `{scanned, matched, updated}`. The outer result contains no NFM, rows, cursor, or ETag. The transcript nevertheless exposes every nested query/read/edit with complete Details and Raw data. Instructions describe no unsupported parallel guarantee.

Regression acceptance requires all focused suites, strict typecheck, lint, and the standard cross-runtime test suite to pass. No public revision compatibility layer, stateful validator registry, loopback HTTP path, renderer SQLite access, or duplicate mutation authority remains.

## Idempotence and Recovery

All reads and guard minting are side-effect free. Repeating a read in unchanged state returns the same data, cursor behavior, and requested ETags. A caller that receives a conflict must re-read the affected semantic unit; the server never returns a replacement ETag without the replacement state.

Dynamic-call identity continues to reserve deterministic Card/Block allocations before mutation and replay a committed result after response loss. Repeated preflight before and after consent reuses those allocations and the same semantic input. It may update prepared internal coordinates, but it must not create a second canonical mutation or broaden the request. A same-call/different-input collision remains an error.

The final internal command is compiled only after the last required consent. A kernel conflict is returned to the Agent rather than blindly retried with an operation ID whose rejected outcome may already be immutable. A crash before commit exposes no authority change; a crash after commit recovers from canonical receipts and finalizes the dynamic-call replay record without revalidating now-stale public guards.

The ETag key remains store-local and durable. Restore rotates the store epoch, so old ETags and cursors fail. The migration does not rewrite content, mutation history, Documents, Databases, or old task rollout metadata. If an implementation milestone fails halfway, revert only that uncommitted code or amend the living plan; the documentation checkpoint remains a safe restart point.

## Artifacts and Notes

The representative design discussion is stored at `.generated/discuss-revision-design.md`. It measured the v1 response and motivated short ETags plus demand-driven preparation. The file is generated/private research material rather than a product source of truth; the durable conclusions are embedded in ADR 0015 and this plan.

Official research established these constraints:

- Codex app-server dynamic tools are experimental, persist with task rollout metadata, and emit started/completed items containing arguments, content items, success, and duration.
- Code Mode runs nested tools inside an isolated V8 runtime; nested tools return an object or string, and only values explicitly appended with `text()` or `notify()` enter the outer result.
- The current Codex dynamic handler returns dynamic-tool text as a JavaScript string and does not advertise parallel execution.
- MCP defines `outputSchema` and `structuredContent` with a serialized text fallback. This is the desired future dynamic-tool transport, but not a feature of the pinned Codex binary.
- HTTP `If-Match` uses strong validators to prevent lost updates. Nodex adopts the concise `etag`/`ifMatch` vocabulary while applying it to operation-scoped local semantic state.
- Official Notion MCP uses separate intent-oriented search/fetch/create/update/move tools and full Markdown payloads. Its recent schema flattening and resource extraction achieved large context reduction. Nodex retains its Block/Document/Database authorities and stronger local concurrency rather than copying cloud last-write behavior.

Future upstream Codex work is intentionally outside the local v2 completion boundary: add dynamic-tool output schemas, structured content, a dedicated structured Code Mode result, completed-item structured content, and a parallel-safety declaration for read-only tools. When that lands, first upgrade the pinned Codex binary, regenerate protocol files with the repository command, and then migrate the Nodex runtime and transcript with a text fallback. Do not hand-edit generated v2 protocol files ahead of the binary.

## Interfaces and Dependencies

The public shared contract must end with one `ETag` type, one separate `Cursor` type, typed `PrepareFor` entries, operation-positioned `ifMatch`, logical transfer sources, and bounded sparse-output selectors. Names should remain Agent-oriented and independent of SQLite/Yjs coordinates.

The main-process codec layer should expose interfaces equivalent to:

    type NodexAgentGuardKind =
      | "title"
      | "document_body"
      | "document_block"
      | "document_subtree"
      | "database_value"
      | "view_placement";

    function mintNodexAgentEtag(
      database: Database,
      input: {
        kind: NodexAgentGuardKind;
        projectId: string;
        subject: readonly string[];
        state: Readonly<Record<string, JsonValue>>;
      },
    ): ETag;

    function assertNodexAgentEtag(
      database: Database,
      supplied: string,
      expectedCurrent: {
        kind: NodexAgentGuardKind;
        projectId: string;
        subject: readonly string[];
        state: Readonly<Record<string, JsonValue>>;
      },
    ): void;

The cursor codec should expose mint and decode operations over a versioned self-contained payload with Project, store epoch, subject, offset, and state. Neither module imports Agent write services.

Each write preflight exposes the resolved semantic evidence needed to derive a stable authorization footprint plus the newly compiled exact command. `dynamic-service.ts` resolves committed replay, performs first preflight, authorizes its preview/footprint, performs final preflight, rejects a materially changed footprint, and otherwise executes the fresh command. Individual services own semantic state reads and internal command compilation; the renderer and dynamic runtime do not inspect numeric coordinates.

The implementation continues to use Node's `crypto` HMAC-SHA256 and `timingSafeEqual`, Zod 4 as the one schema/type/JSON-Schema source, `better-sqlite3` transactions through the Block writer, existing Document Hub leases/fences, existing mutation kernels and immutable receipts, and the current canonical transcript projection. No new runtime dependency is required.

Revision note, 2026-07-16: Created the successor migration plan after measuring v1 revision overhead and tracing Code Mode, app-server, authorization, writer, kernel, and transcript behavior. The plan replaces public storage revisions with operation-scoped semantic guards while preserving internal atomicity and exact retry.

Revision note, 2026-07-16: Implemented the v2 contract. The final transfer interface uses one shared move-only `from`; Database guards bind membership identity to prevent ABA; changed post-consent footprints return a retryable conflict instead of starting a nested consent loop.
