# Add project-scoped Nodex agent dynamic tools

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while implementation proceeds. This document follows `docs/PLANS.md` and must remain self-contained enough that a contributor with only this repository and this file can finish the work.

## Purpose / Big Picture

After this change, a Codex task can work with the Nodex Project to which the host has bound it. An agent can discover Blocks, Cards, Databases, and Views; read a Card body as concise Notion-flavored Markdown (NFM); create a complete Card with many body Blocks in one call; append or insert a multi-Block NFM fragment in one call; perform exact NFM search-and-replace or whole-body replacement; use stable Block IDs when identity matters; move or copy Blocks between Space, Document, and Database containers; and update Database values or View positions.

The capability appears as a new `nodex_app` dynamic-tool namespace. It is not a second database API. Dynamic tools adapt Codex app-server calls to a transport-neutral Nodex application service, which uses the existing Document Hub, asynchronous Block writer, and canonical mutation kernels. The renderer never writes SQLite, the dynamic handler never shells out to the CLI or calls Nodex through loopback HTTP, and model-generated arguments never choose their own Project, actor, store epoch, mutation identity, or write-fence proof.

NFM is a first-class agent content protocol, not merely an export. It is the concise path for large creative writes. Stable-ID Block operations remain the precision path for identity-sensitive changes. Ownership and placement never hide inside Markdown: an NFM `<card uuid="..." />` may preserve an existing same-Document Card shell during an exact-head rewrite, but creating, copying, or moving a Card always uses a typed Nodex operation.

Reading is automatic inside the bound Project. The first ordinary write presents an inline Nodex confirmation with Allow once, Allow for this task, and Deny. A mutation that deletes existing Blocks requires a fresh visible confirmation even when the task has a write grant. Headless writes fail closed in version 1.

## Progress

- [x] (2026-07-15 14:00Z) Explored the Nodex Block, Document, Database, View, Card lifecycle, NFM, Codex dynamic-tool, and authorization boundaries.
- [x] (2026-07-15 14:05Z) Captured and committed the initial seven-tool, stable-ID-first plan before the requested Notion/NFM review.
- [x] (2026-07-15 14:20Z) Researched the hosted official Notion MCP catalog, the official open-source Notion MCP server at commit `d7e3bbd62890f9efca2cd54449ac072f3bd1a4ba`, the enhanced Markdown content API, asynchronous writes, deletion safeguards, and the April 2026 update guidance.
- [x] (2026-07-15 14:20Z) Revised the public interface around NFM-native Card creation, structural NFM insertion, exact NFM update/replacement, and a stable-ID fallback; added `create` as an eighth tool.
- [x] (2026-07-15 15:35Z) Reviewed `/Users/asc/Downloads/Nodex设计理念转变.html`, reworked public wording around Agent intent, made search Card-first by default, hid internal concurrency coordinates behind typed opaque revisions, and specified non-cascading NFM patch semantics.
- [x] (2026-07-15 15:55Z) Traced the existing Card search stack from renderer MiniSearch through `cards:search` to the exact-head Block FTS projection, verified MiniSearch 7.2 behavior, and refined the protocol around a main-owned hybrid search service with typed match evidence rather than public search scores.
- [x] (2026-07-16 00:42Z) Implemented the namespace-aware, revision-selected dynamic-tool registry; strict Zod-derived contracts for all eight `nodex_app` tools; namespace-safe Codex lifecycle routing; and durable per-thread catalog bindings with schema migration and fork inheritance.
- [x] (2026-07-16 01:05Z) Implemented worker-owned `get_context`, `get_block`, `search`, and `query_database` reads; durable signed opaque revisions/cursors; compact NFM guidance; exact-head NFM/Block projection reads; hybrid metadata/FTS search; and persisted/ad-hoc Database queries.
- [x] (2026-07-16 01:09Z) Validated Milestone 2 with 1,288 main-process tests, focused shared search/display tests, strict typecheck, lint, and markdown/diff checks.
- [x] (2026-07-16 01:25Z) Implemented Milestone 3's `edit_document` compiler and worker-owned prepare/complete service: structural multi-Block NFM insertion, simultaneous exact NFM patches, whole-NFM plus rich-title replacement, stable-ID Block edits, protected owner deletion, exact revision preflight, deterministic identity allocation, and durable response-loss recovery receipts.
- [x] (2026-07-16 01:25Z) Proved `edit_document` through real SQLite/Yjs commits, including one-call nested NFM append, atomic rich-title/body replacement, stable replay allocation, recovered committed writes without duplicate mutation, idempotency collision, and stale-revision rejection; focused tests and strict typecheck pass.
- [x] (2026-07-16 01:46Z) Implemented Milestone 4's atomic Card aggregate creation with rich title, complete nested NFM genesis, deterministic identity allocation, Space/Document/Database destinations, optional Database values and View placement, membership without a View position, exact destination preflight, response-loss replay, and Hub-coordinated target-Document leases.
- [x] (2026-07-16 01:46Z) Proved one-transaction rollback across Card lifecycle, owned Document, Block transfer, membership/value/View authority, projections, change log, and sub-receipts; added realtime Document/board/Database fanout and focused create, lifecycle, Database-kernel, and Hub tests.
- [x] (2026-07-16 02:08Z) Implemented Milestone 5's host-resolved `transfer_blocks` compiler and constrained `edit_database` compiler: exact opaque location/value/View-placement preflight, mixed-source rejection, Space reorder, recursive move/copy, atomic destination values and optional View placement, compare-and-set values, multi-select add/remove intent, and grouped multi-Card placement.
- [x] (2026-07-16 02:08Z) Routed transfer and Database commits through the worker, canonical kernels, Document Hub lease closure, and existing realtime fanout; generalized recursive Card copy to preserve valid Database membership without requiring a source View position; focused transfer, Database edit, Hub, writer, typecheck, and lint gates pass.
- [x] (2026-07-16 02:42Z) Implemented main-owned authorization and the inline renderer request surface: preflight-before-consent, frozen-command execution, random occurrences, allow-once/task/deny decisions, destructive re-prompt, verified root-task descendant inheritance, Project/store/session/owner grant invalidation, headless fail-closed behavior, turn-cancellation cleanup, and semantic/NFM previews.
- [x] (2026-07-16 02:42Z) Connected `nodex_app@1` to app-server dispatch and every eligible new-task catalog independently of model discovery; persisted catalog selection remains authoritative, forks inherit it, and old tasks return structured `tool_catalog_stale` instead of hot-injecting a new contract.
- [x] (2026-07-16 02:42Z) Added main-process authorization/runtime tests, renderer bridge/projection/card tests, and Storybook states for ordinary and destructive writes; focused suites and strict typecheck pass.
- [x] (2026-07-16 03:25Z) Updated product, architecture, security, reliability, NFM round-trip, Storybook, release, and living-plan documentation to match the implemented contract and failure model.
- [x] (2026-07-16 03:58Z) Passed all targeted suites plus the full standard gate (199 Node files/1180 tests, 184 main files/1320 tests, 387 renderer files/2857 tests, and 2 integration files/29 tests), strict typecheck, lint, and production build; committed each coherent milestone.

## Surprises & Discoveries

- Observation: the current dynamic-tool dispatcher largely selects handlers by tool name and does not consistently treat namespace as part of the identity.
  Evidence: `src/main/codex/codex-service.ts` branches on `params.tool`, although `packages/codex-app-server-protocol/src/v2/DynamicToolCallParams.ts` also carries `namespace`. A second public namespace therefore requires full `(namespace, tool)` routing before any Nodex data tool is safe.

- Observation: Codex app-server accepts dynamic tools at `thread/start`, but the current resume request has no catalog-refresh field.
  Evidence: `packages/codex-app-server-protocol/src/v2/ThreadStartParams.ts` contains `dynamicTools`; `ThreadResumeParams` does not. Existing tasks must retain their historical catalog instead of claiming that a resume hot-injected `nodex_app`.

- Observation: Card is a document-bearing Block capability, and Kanban is a Database View kind rather than a separate authority.
  Evidence: `CONTEXT.md`, `ARCHITECTURE.md`, and the contracts under `src/shared/block-documents/` and `src/shared/database-kernel.ts` all use Block identity and separate Document, placement, and Database revisions. Names such as `move_card` and `edit_kanban` encode UI cases that the domain does not need.

- Observation: the three existing write families have different atomic and concurrency boundaries.
  Evidence: Document operations compare generation/head and may require a write fence; Block transfer compiles exclusive locations and memberships; Database operations compare property, schema, membership, and View-position revisions. One universal `apply` would falsely imply one cross-domain transaction.

- Observation: Nodex already has most of the hard NFM machinery needed for agent writes.
  Evidence: `src/shared/block-documents/block-document-codec.ts` can create Card Document genesis from NFM; `src/shared/block-documents/document-operations.ts` defines exact-head `ReplaceDocumentFromNfm`; `src/shared/block-documents/legacy-nfm-shadow-translator.ts` conservatively aligns stable IDs and validates explicit Card identity pins. The missing product boundary is an ergonomic and safe public command set, not a new document format.

- Observation: the official hosted Notion MCP is intent-oriented, while the open-source local server exposes a broader endpoint-shaped catalog.
  Evidence: the hosted catalog documents high-level tools such as `notion-fetch`, `notion-create-pages`, `notion-update-page`, and `notion-move-pages`. The official local repository at the researched commit exposes 22 OpenAPI-derived tools, including `retrieve-page-markdown` and `update-page-markdown`. Nodex should follow the hosted catalog's smaller cognitive surface without copying Notion's Page-centric domain.

- Observation: Notion made enhanced Markdown the high-leverage payload for AI content creation and editing.
  Evidence: `notion-create-pages` accepts full Markdown content, and `notion-update-page` supports whole-content replacement and up to 100 exact search-and-replace edits. The official content API returns full enhanced Markdown and uses XML extensions for nonstandard Blocks. This directly validates NFM-native create and bulk edit in Nodex.

- Observation: Notion deprecated text-position insertion and ellipsis-based range replacement in favor of exact search-and-replace or whole-content replacement.
  Evidence: the April 7, 2026 Notion changelog recommends `update_content` and `replace_content` over `insert_content` and `replace_content_range`. Nodex can do better for insertion because it owns stable Block IDs: use structural start/end/before/after/inside anchors, never a character offset or fuzzy ellipsis.

- Observation: Notion's large-write asynchronous task API solves a cloud timeout problem that does not yet exist for Nodex's local writer.
  Evidence: Notion's `allow_async` changes response delivery but not validation or mutation semantics, and callers poll `notion-get-async-task`. Adding a ninth Nodex task-status tool before local measurements require it would enlarge the catalog without improving current correctness.

- Observation: a Markdown rewrite can accidentally remove nested resource-owning Blocks.
  Evidence: Notion refuses to remove child Pages or Databases unless `allow_deleting_content` is explicit. Nodex NFM serializes owning Cards as identity-pinned shells. NFM update and replacement therefore need both a protected-owner deletion flag and the normal fresh destructive-write confirmation.

- Observation: returning a truncated NFM string and allowing it to be written back is unsafe.
  Evidence: a truncated serialization is not a complete Document and could delete omitted Blocks when used as replacement input. Version 1 must return complete canonical NFM or a typed `result_too_large` recovery that directs the agent to summary, subtree NFM, search, or stable-ID pages.

- Observation: tool names that mirror mutation adapters still make the model think in storage-engine verbs.
  Evidence: the design discussion contrasts `apply_content` with the natural intent “edit this document.” The same mismatch exists for `apply_database` and `apply_placement`. Public names should describe what the Agent is trying to accomplish; command discriminants can retain exact mutation semantics inside the selected authority.

- Observation: raw generation/head and numeric revision fields force Agents to understand internal concurrency topology.
  Evidence: a Document mutation needs generation/head, a transfer may depend on location plus source-Document or membership state, and grouped View placement depends on position plus grouping-value state. A domain-typed opaque revision can bind all coordinates for one observed resource snapshot while remaining a compare token rather than an authorization token.

- Observation: Block-first search output is canonical but poorly shaped for the common discovery task.
  Evidence: most searches ask for “the Card about dynamic tools.” Returning each matching Paragraph separately makes the Agent aggregate ownership and choose among duplicate Card titles. The index can remain Block-level while the default public result groups the best title, property, heading, and body matches under the owning Card.

- Observation: ordered string replacement allows an earlier edit to change how a later edit matches.
  Evidence: the previous `nfm.update` proposal applied changes sequentially. Matching every patch against the same canonical source revision, rejecting overlapping spans, and then applying the replacements simultaneously produces deterministic all-or-nothing behavior.

- Observation: current Card search is already a useful two-channel design, but the two channels live at different authority levels.
  Evidence: `src/renderer/lib/command-palette-card-search.ts` uses MiniSearch 7.2 over bounded Card summaries for typo-tolerant title, tag, assignee, column, project, preview, and ID ranking. `src/main/local-store/card-search-store.ts` uses `searchDocumentBlockUnits` over `block_search_units_fts` for exact/prefix title and full-body hits from the current Document generation/head. `command-palette-card-results.ts` merges the two result sets only for renderer presentation.

- Observation: the existing `searchAuthoritativeCards` facade is not a sufficient canonical Agent search boundary.
  Evidence: it keeps only one best Document hit per Card, then requires an active Database membership, status property, primary Kanban View, and matching View position. That is correct for the current board-oriented command palette, but it excludes valid Cards in Space or Documents and cannot explain property, identity, or multiple Block matches.

- Observation: the general search projection was deliberately prepared for more than Document text, but its current non-Document freshness coordinate is not yet sufficient for general Database-property display text.
  Evidence: `block_search_units` supports non-Document rows with one Block `source_revision`, and `rebuildProjectDocumentSecondaryProjections` explicitly leaves intrinsic/property units untouched for later projectors. A rendered select value, however, depends on membership, value, property, option/schema, and Block revisions. Writing it under only `blocks.metadata_revision` would make a property/option rename look fresh when it is not. Version 1 should derive property display text from one canonical relational snapshot and keep it only in the disposable metadata index; a future persisted projector must first add honest composite freshness coordinates.

- Observation: MiniSearch result scores and SQLite BM25 ranks are not comparable public relevance values.
  Evidence: MiniSearch scores depend on index corpus, field boosts, fuzzy/prefix weights, and BM25 options; FTS5 ranks have a separate scale. MiniSearch does provide the useful stable concepts—query terms, matched document terms, and fields—but a protocol that exposes either raw score would make ranking implementation part of the API and make hybrid ordering incoherent.

- Observation: app-server's dynamic call contains namespace and tool but intentionally does not echo the launch catalog revision.
  Evidence: `DynamicToolCallParams` carries `namespace`, `tool`, and arguments, while `ThreadStartParams.dynamicTools` is the only catalog injection point. Schema v64 therefore adds `codex_thread_dynamic_tool_catalogs`; every successful durable launch persists the host-selected revision, and persistent forks copy the source bindings.

- Observation: Zod 4 emits an `anyOf` root for strict unions such as Card-versus-Block search, while each union branch remains a closed object.
  Evidence: contract tests inspect every generated root alternative and verify `type: "object"` plus `additionalProperties: false`. Requiring one root `type` would reject correct JSON Schema for a union and would tempt a weaker handwritten schema.

- Observation: the existing Block writer protocol is already the correct serialization boundary for substantial Agent reads as well as writes.
  Evidence: worker requests and results are structured-clone-safe unions, and `better-sqlite3` deferred transactions can capture Project, change cursor, Document heads/materializations, Database authority, FTS evidence, and minted tokens without blocking Electron main or stitching snapshots there. The new `readNodexAgentTool` command publishes no mutation event.

- Observation: a base64-encoded numeric revision would be opaque in appearance but weak in domain isolation and stale-state detection.
  Evidence: schema v65 creates one durable random 32-byte local signing key. `nxt1` HMAC-SHA256 envelopes bind kind, Project, store epoch, resource subjects, and canonical state; decoding rejects tampering plus cross-kind, cross-resource, cross-Project, and cross-epoch reuse while remaining valid across process restart.

- Observation: one fuzzy MiniSearch query across identity and human text would accidentally make stable Block IDs typo-tolerant.
  Evidence: the shared metadata search now queries identity with exact/prefix matching and title/property display text with the shared term-length fuzzy threshold, then derives typed evidence from the matched indexed terms. Tests prove that fuzzy property evidence names the actual matching property rather than a fallback field.

- Observation: ad-hoc Database filtering and sorting did not need a parallel query implementation.
  Evidence: `queryGeneralDatabaseAdHoc` constructs an in-memory canonical list View config and reuses the same filter, sort, value, and Card snapshot pipeline as persisted Views; manual ordering remains schema-rejected because no persisted View owns positions.

- Observation: dynamic-call idempotency and canonical mutation idempotency solve different response-loss windows.
  Evidence: the Agent call receipt binds `(threadId, callId)` to a request fingerprint and deterministic allocations before execution, while `block_mutations` proves whether the canonical Document mutation committed. A retry can recover the committed result after the mutation ACK was lost, then persist only compact result metadata; neither receipt needs to retain NFM or Document body content.

- Observation: Database membership and manual View placement are independent authorities.
  Evidence: a Card can validly belong to a Database without appearing in a particular manual View ordering. The canonical membership transition previously required a View only because every existing caller was a board/transfer workflow; making the position optional removed that UI assumption while preserving one active membership, default value initialization, and exact View checks whenever placement is requested.

- Observation: recursive Card copy also carried an accidental primary-View assumption.
  Evidence: the ownership-copy primitive required a source primary View position even though Database membership without any View position is valid. Making the clone's primary rank conditional preserves all existing positioned copies and allows an unplaced Card's membership, values, owned Document, and nested ownership closure to be copied before the canonical transfer chooses its destination.

- Observation: grouped View placement is one semantic write across two canonical operation kinds.
  Evidence: changing a Card's group requires updating the grouping property and its persisted manual position together. The compiler validates one composite `ViewPlacementRevision`, emits `set_values` before `position_cards` in one Database mutation, and returns fresh value and placement tokens only after both commit.

- Observation: descendant tool execution and authorization presentation can belong to different conversation streams.
  Evidence: a background child may invoke `nodex_app` without owning a renderer stream, while its root task still has the trusted visible owner. The broker therefore binds authority to the verified root task but attaches the semantic request to the owner conversation's current turn; an existing task grant remains inheritable by the child.

- Observation: an authorization decision is safe only for the exact preflight snapshot that produced its preview.
  Evidence: the dynamic service prepares the canonical command before prompting and executes that same object after consent. The broker rechecks the store epoch after the renderer response, and the Codex adapter rechecks root-task and Project binding, so a long-lived prompt cannot authorize a rebased command or newly rebound task.

- Observation: model-aware `codex_app` catalog construction is an availability hazard for unrelated product tools.
  Evidence: model listing can fail independently of Nodex content access. Composing the static `nodex_app@1` spec after the model-dependent host-tool catalog, with the same static fallback, keeps the product namespace present whenever a new eligible task starts.

## Decision Log

- Decision: add a separate `nodex_app` namespace and retain `codex_app` for task, terminal, automation, and handoff controls.
  Rationale: product-content operations and Codex host controls have different authority, scoping, and authorization semantics.
  Date/Author: 2026-07-15 / user and Codex.

- Decision: make `(namespace, toolsetRevision, tool)` the only registry key and keep `toolsetRevision` host-owned.
  Rationale: app-server already supplies namespace and tool, while the persisted thread catalog supplies the historical revision. The model cannot select a parser, and two namespaces can safely reuse the same tool name without entering each other's lifecycle.
  Date/Author: 2026-07-16 / Codex during Milestone 1 implementation.

- Decision: generate app-server JSON Schema and runtime input/output validation from the same strict Zod registrations.
  Rationale: contract drift is more dangerous than a little schema boilerplate. Zod 4's native `toJSONSchema` preserves strict nested object boundaries and discriminated unions, and the registry rejects both malformed arguments and malformed executor output before they cross the protocol boundary.
  Date/Author: 2026-07-16 / Codex during Milestone 1 implementation.

- Decision: use durable HMAC-signed opaque envelopes for every revision and cursor, backed by one store-local key created in schema v65.
  Rationale: revisions are compare tokens rather than capabilities, but accepting model-authored or corrupted coordinates would weaken optimistic concurrency. A durable local key gives transcript-safe integrity and restart survival without a token registry; binding the store epoch makes restored/replaced stores fail closed.
  Date/Author: 2026-07-16 / Codex during Milestone 2 implementation.

- Decision: execute all Agent reads in one deferred worker transaction and validate the complete success envelope again against the public Zod schema before it leaves the worker.
  Rationale: exact reads must not combine a title from one head with a revision or Database value from another. Keeping scope filtering, search fusion, pagination coordinates, and token minting in one SQLite snapshot provides one honest read boundary and keeps Codex service transport-only.
  Date/Author: 2026-07-16 / Codex during Milestone 2 implementation.

- Decision: reuse exact-head FTS only for full Document text and build canonical property display text from the relational snapshot into a bounded disposable MiniSearch index.
  Rationale: the current persisted search projection cannot honestly bind property-value, membership, property-schema, and option-name freshness. Snapshot-derived metadata preserves correctness now; exact/prefix identity/body behavior, field-specific fuzzy semantics, reciprocal-rank fusion, and private scores keep the wire contract stable.
  Date/Author: 2026-07-16 / Codex during Milestone 2 implementation.

- Decision: compile `edit_document` completely against one exact materialization before authorization, but execute only its canonical Document mutation through the existing Document Hub.
  Rationale: preflight produces an honest semantic preview and catches invalid NFM, anchors, owner deletion, and operation order without partial writes. The Hub still owns write-fence acquisition, realtime resync, and the sole FIFO writer, so the dynamic service does not become a second Document authority.
  Date/Author: 2026-07-16 / Codex during Milestone 3 implementation.

- Decision: persist a general dynamic-call receipt separate from canonical kernel receipts, containing only request identity/fingerprint, deterministic allocation IDs, compact effects, and replay metadata.
  Rationale: canonical receipts deduplicate a known mutation ID, but a host must also bind the app-server call identity before execution and recover after response loss. Excluding raw NFM/body content keeps the receipt an idempotency ledger rather than a hidden Document history.
  Date/Author: 2026-07-16 / Codex during Milestone 3 implementation.

- Decision: implement Card creation as one outer writer transaction that composes the existing lifecycle, Block-transfer, and Database mutation kernels through nested SAVEPOINTs.
  Rationale: Card genesis, arbitrary placement, membership, typed values, and View rank already have separate proven invariant owners. The aggregate preallocates identities and freezes any live destination Document, then reuses those kernels without exposing intermediate state; a failure at any late seam rolls back authority, projections, change logs, and every sub-receipt together.
  Date/Author: 2026-07-16 / Codex during Milestone 4 implementation.

- Decision: compile `transfer_blocks` and `edit_database` into the existing Block-transfer and Database request contracts before authorization, then execute those frozen requests only through the worker and Document Hub.
  Rationale: source, memberships, locations, values, View grouping, and live Document heads are store facts rather than model arguments. Preflight can produce a truthful preview and reject stale tokens, while canonical execution retains the sole transaction, idempotency, lease, projection, and realtime boundaries.
  Date/Author: 2026-07-16 / Codex during Milestone 5 implementation.

- Decision: keep View participation optional throughout Database transfer and recursive Card copy.
  Rationale: membership owns containment and values; a View owns only a presentation-specific position. Requiring a transient primary View position would reintroduce Kanban as hidden authority and make a valid unplaced Card impossible to copy.
  Date/Author: 2026-07-16 / Codex during Milestone 5 implementation.

- Decision: authorize a prepared semantic effect, then execute only the frozen canonical command that produced the preview.
  Rationale: parsing before authorization is insufficient because source location, Document identity effects, Database values, and deletion impact are host-resolved store facts. Preparing first makes denial mutation-free, makes the preview truthful, and prevents time-of-check/time-of-use argument reinterpretation; canonical optimistic concurrency still rejects a changed store snapshot.
  Date/Author: 2026-07-16 / Codex during Milestone 6 implementation.

- Decision: keep task grants solely in the main process and key them by app session, root task, Project, and store epoch.
  Rationale: renderer state is a presentation surface, not authorization authority. Random per-call occurrences prevent response confusion; ordinary descendants may inherit a verified root grant, while destructive effects always re-prompt and owner loss, archive, Project/store change, shutdown, or restart invalidates the grant.
  Date/Author: 2026-07-16 / Codex during Milestone 6 implementation.

- Decision: project authorization as an existing conversation request and use the renderer client router as the trusted response channel.
  Rationale: this keeps consent inline with the task instead of creating a second modal system. The targeted renderer client proves ownership, the request card returns only one decision, terminal turns resolve pending requests as denial, and the main process remains the sole party that maps a decision back to a prepared command.
  Date/Author: 2026-07-16 / Codex during Milestone 6 implementation.

- Decision: inject `nodex_app@1` only at eligible task start and select execution from the durable per-thread catalog.
  Rationale: app-server has no truthful resume-time catalog refresh. Static composition keeps Nodex tools independent from model discovery, persistent forks inherit the historical revision, internal ephemeral tasks remain excluded, and old tasks receive a recoverable stale-catalog response rather than silently changing contracts.
  Date/Author: 2026-07-16 / Codex during Milestones 6–7 implementation.

- Decision: publish eight intent-first tools: `get_context`, `get_block`, `search`, `query_database`, `create`, `edit_document`, `transfer_blocks`, and `edit_database`.
  Rationale: the catalog answers four read questions and four write intents without exposing adapter wording. The write tools still align exactly to aggregate creation, Document, cross-container placement, and Database data/View transaction boundaries.
  Date/Author: 2026-07-15 / Codex after design-language review.

- Decision: make NFM the default full-content representation for document-bearing Blocks.
  Rationale: NFM is concise, preserves the Block hierarchy and rich content types that agents need, and already has a canonical parser/serializer. A stable-ID Block tree remains available on request rather than being the only editing format.
  Date/Author: 2026-07-15 / user direction and Codex.

- Decision: let one `create` call create one Card, its title, its complete NFM body, its initial location, and optional initial Database values atomically.
  Rationale: the requested optimization is many body Blocks in one Card, not many unrelated Cards in one partially successful batch. One resource per call gives a clear receipt, one authorization decision, and one idempotent aggregate transaction.
  Date/Author: 2026-07-15 / Codex.

- Decision: define `edit_document.body` as a strict union of `nfm.insert`, `nfm.patch`, `nfm.replace`, and `blocks`.
  Rationale: these are four representations of a Document edit, not four public tools. NFM handles large creative changes; the stable-ID representation is an escape hatch for precise identity-sensitive work. The public tool name stays in Agent language while the discriminant stays exact.
  Date/Author: 2026-07-15 / Codex.

- Decision: anchor NFM insertion structurally by Document start/end or stable Block ID before/after/inside positions.
  Rationale: structural anchors are deterministic across text edits and superior to deprecated character, substring, or ellipsis positions. Root append is the zero-friction default use case.
  Date/Author: 2026-07-15 / Codex.

- Decision: model NFM patch as exact `oldNfm` to `newNfm` replacements located against one original canonical body, with `expectedMatches` defaulting to one, non-overlapping spans, and at most 100 resulting replacements.
  Rationale: this keeps Notion's strongest exact-match idea but removes sequential cascade behavior. Missing, extra, or overlapping matches fail before parsing or mutation.
  Date/Author: 2026-07-15 / Codex.

- Decision: keep title outside NFM but allow `edit_document` to change title and body atomically.
  Rationale: a Card title is a separate rich Y.Text root and is not a body heading. It nevertheless belongs to the same Document aggregate, so requiring a second tool call would expose an implementation split and permit partial intent.
  Date/Author: 2026-07-15 / Codex.

- Decision: reject owning `<card uuid="..." />` elements in NFM creation and insertion; allow them only as same-Document identity pins during update or replacement.
  Rationale: NFM must never create, copy, or move an owned Card implicitly. Use `create` for a new Card, `transfer_blocks` for an existing Card, and `<mention-card>` for a non-owning reference.
  Date/Author: 2026-07-15 / Codex.

- Decision: expose domain-typed opaque revisions instead of generation/head, numeric location revisions, or composite Database coordinates.
  Rationale: an Agent only needs to prove which snapshot it read. `DocumentRevision`, `LocationRevision`, `DatabaseSchemaRevision`, `DatabaseValueRevision`, `ViewRevision`, and `ViewPlacementRevision` can bind the relevant Project, store epoch, resource identities, and internal revisions without leaking kernel topology or permitting token-kind confusion.
  Date/Author: 2026-07-15 / Codex.

- Decision: remove `version: 1` from every input and bind `toolsetRevision` in the host's task catalog registration.
  Rationale: schema version belongs to the tool catalog injected at task start, not to model-authored arguments. Success and failure envelopes retain `schemaVersion` for parsing and transcript audit. A task's persisted catalog revision selects the parser/handler or fails explicitly as stale.
  Date/Author: 2026-07-15 / Codex.

- Decision: make `search` default to Card-level results while retaining `target: "blocks"` as the identity-sensitive mode.
  Rationale: this optimizes the common product intent without changing the Block-first index. Each Card appears once with a few representative matches and can be passed directly to `get_block`.
  Date/Author: 2026-07-15 / user discussion and Codex.

- Decision: implement `nodex_app.search` as one main-owned hybrid application service, not as a call into renderer state or the `cards:search` transport.
  Rationale: exact/prefix full-content hits must come from fresh `block_search_units_fts` rows, while typo-tolerant Card metadata matching can reuse a transport-neutral extraction of the existing MiniSearch document/ranking semantics. Renderer IndexedDB caches, `CommandPaletteCard` shapes, decorations, recency, active-project preference, and board order remain UI concerns. The existing `cards:search` endpoint becomes a thin compatibility consumer of the shared service where practical.
  Date/Author: 2026-07-15 / Codex after Card-search source review.

- Decision: derive general Database-property search text from the captured relational snapshot in version 1 instead of prematurely persisting it in `block_search_units`.
  Rationale: the existing non-Document unit carries only one Block source revision, while a human-readable property value can depend on membership, value, property, option/schema, and Block revisions. A change-cursor-keyed in-memory metadata index is rebuildable and honestly fresh. Persist property units later only if profiling justifies it and the projection schema can bind every canonical source coordinate.
  Date/Author: 2026-07-15 / Codex.

- Decision: make fuzzy matching an automatic Card-discovery behavior, not a protocol mode, and never fuzzy-match full body text in version 1.
  Rationale: an Agent should ask for the Card it means without tuning edit distance. Exact structured lookup belongs to `get_block` or `query_database`. Restricting typo tolerance to bounded title, identity, and property display text preserves useful recall without building a second full-content fuzzy index or returning a fuzzy Paragraph as a precision-edit anchor.
  Date/Author: 2026-07-15 / Codex.

- Decision: return typed match evidence and deterministic ordering, but no numeric relevance score.
  Rationale: `source`, `quality`, stable Block/property identity, and a bounded excerpt tell the Agent why a Card matched. Internal field tiers and rank fusion can combine MiniSearch and FTS5 without pretending their raw scores share a scale. A ranking revision is cursor state, not a public score contract.
  Date/Author: 2026-07-15 / Codex.

- Decision: omit transfer source from model input.
  Rationale: source is current store fact, not user intent. `blockId` plus a typed `ifLocationRevision` proves the observed source snapshot; the host resolves and validates the actual source immediately before compiling the canonical transfer.
  Date/Author: 2026-07-15 / Codex.

- Decision: mint revision tokens only alongside the state they describe and never return a fresh token by itself in a conflict error.
  Rationale: returning only a newer token encourages blind retry against unread state. Conflict recovery must call `get_block` or `query_database` again and obtain state and revision together.
  Date/Author: 2026-07-15 / Codex.

- Decision: guard deletion of document-bearing owner Blocks twice.
  Rationale: `allowDeletingOwnedBlocks: true` proves that the model intended the semantic operation, while a fresh user confirmation proves current human authorization. Neither signal substitutes for the other.
  Date/Author: 2026-07-15 / Codex.

- Decision: expose a compact, versioned NFM guide through `get_context` only when `include.nfmGuide` is true.
  Rationale: Notion reduced tool context by moving its Markdown specification to a resource. Codex dynamic tools do not need a separate discovery tool for this; on-demand context keeps the eager schema small while making Nodex extensions discoverable.
  Date/Author: 2026-07-15 / Codex.

- Decision: do not add asynchronous write jobs in version 1.
  Rationale: Nodex is local, dynamic calls already wait for a response, and current content limits are bounded. Add job creation and polling only after measurement shows valid writes exceed the execution budget.
  Date/Author: 2026-07-15 / Codex.

- Decision: bind Project, actor, store epoch, client session, and mutation identity in the host rather than accepting them from tool arguments.
  Rationale: dynamic arguments are untrusted model output. Scope, identity, and concurrency authority come from the persisted task/Project binding and current store.
  Date/Author: 2026-07-15 / Codex.

- Decision: use automatic reads, task-scoped ordinary-write grants, and per-call destructive confirmation.
  Rationale: this supports sustained agent editing without treating filesystem permission as Nodex data permission or allowing deletions to disappear behind a broad grant.
  Date/Author: 2026-07-15 / user-approved recommendation.

## Outcomes & Retrospective

Milestone 1 is implemented. Dynamic-tool identity is now namespace-safe in the shared request lifecycle and Codex service; the reusable registry selects handlers by namespace, persisted toolset revision, and tool; Zod generates the launch schema and validates both sides of execution; all eight intent-first contracts exist under `src/shared/nodex-agent-tools/`; and schema v64 durably binds each launched thread to its injected namespace revisions. Focused shared and main-process suites prove strict inputs, same-name namespace isolation, stale-catalog errors, catalog/handler parity, migration integrity, and binding copy/replace behavior. The existing `codex_app` executor remains its explicit internal implementation while `nodex_app` executors are connected in the following milestones.

Milestone 6 and the task-launch portion of Milestone 7 are implemented. `nodex_app@1` now dispatches through a transport-neutral service that performs exact store preflight before consent and executes only the prepared command. A main-owned broker routes random authorization occurrences to the verified owner, grants ordinary writes at root-task scope, re-prompts destructive edits, and fails closed for headless or stale authority. The renderer projects semantic details and bounded NFM into the existing request-card surface, resolves cancellation as denial, and exposes ordinary and destructive states in Storybook. New eligible tasks persist both host and Nodex catalogs; old tasks remain historically truthful.

The documentation portion of Milestone 7 is complete. Product, architecture, security, reliability, NFM, and release sources now describe the same eight-tool intent surface, complete-NFM bulk path, frozen-preflight authorization model, main-owned task grants, opaque compare-token semantics, durable catalog rollout, and dual-receipt recovery boundary that the implementation enforces. The CLI/REST path remains documented as the external automation interface rather than a competing in-app authority.

The implementation is complete through Milestone 7. The final standard gate caught one obsolete assertion that expected the pre-`nodex_app` unsupported-namespace text; the runtime had correctly returned the new structured stale-catalog recovery without executing the same-named `codex_app` handler. Updating that behavioral assertion left every full test tier, strict typecheck, lint, and the production build green. No compatibility shim, resume-time catalog mutation, parallel write authority, or hidden NFM history was introduced.

The baseline plan was committed separately before research, preserving the design history. The revised interface treats NFM as the primary agent content protocol and closes the two concrete gaps the baseline had: creating a complete many-Block Card in one call, and appending or editing many Blocks in one NFM operation. The later design-language review makes the surface intent-first rather than mutation-adapter-first and removes internal concurrency coordinates from model-visible arguments. The Card-search review grounds discovery in Nodex's existing exact-head FTS and typo-tolerant metadata behavior while moving the reusable semantics below the renderer and keeping UI caches and third-party scores out of the Agent contract.

The Notion comparison changed the plan in useful but bounded ways. Nodex adopts full-Markdown creation, exact multi-replacement, whole-body replacement, an explicit protected-content deletion gate, and on-demand format documentation. It does not copy Notion's Page-specific tool names, endpoint-shaped local catalog, fuzzy insertion anchors, or cloud-oriented asynchronous job surface. Stable Block IDs let Nodex use safer structural insertion and retain a precision editing path that Notion's Markdown API does not expose.

## Context and Orientation

Nodex is a local-first Electron application backed by SQLite. A Project is an isolated Space. A Block is the durable identity that can appear in the Space, inside a Document, or as a Database member. A Card is a Block that owns a Document; it is not a separate content table. A Database is also a Block capability, so the public API uses `databaseBlockId` rather than inventing a parallel Database identity. A Database owns properties, memberships, and Views. A Kanban board is one View kind. A Document is a Yjs-backed title/body aggregate with internal generation and head coordinates. The dynamic API wraps those coordinates in a typed opaque Document revision.

NFM is Nodex's text representation of a Block forest. Standard Markdown covers paragraphs, headings, lists, tasks, quotes, code, equations, and ordinary tables. XML-like extensions cover Blocks and rich content that standard Markdown cannot represent, such as callouts, lossless tables, mentions, Cards, images, database-view references, synced-block references, templates, and thread sections. Tabs represent nesting. `src/shared/nfm/parser.ts` parses it, `src/shared/nfm/serializer.ts` writes the canonical representation, `src/shared/nfm/types.ts` defines its syntax tree, and `docs/references/notion-flavored-markdown-spec.md` is the human reference.

`src/shared/block-documents/block-document-codec.ts` translates between NFM, the BlockNote-shaped tree, and a Yjs Card Document. `src/shared/block-documents/document-operations.ts` defines stable-ID operation batches and whole-NFM replacement. `src/shared/block-documents/legacy-nfm-shadow-translator.ts` performs current whole-body NFM alignment: it preserves exact Card identity pins, conservatively matches other identities, allocates fresh IDs for genuinely new content, and builds a detached validated Yjs update. `src/main/local-store/block-document-operations.ts` is the store-side mutation boundary, and `src/main/document-sync-hub.ts` owns write-fence coordination.

`src/shared/block-transfer.ts` and `src/main/local-store/block-transfers.ts` own Block movement and copying. `src/shared/database-kernel.ts` and `src/main/local-store/database-kernel.ts` own Database property, membership, and View-position revisions. `src/shared/card-lifecycle.ts` and its main-process implementation already create Card genesis with NFM, but the existing lifecycle intent is oriented around the primary Kanban. The new agent creation kernel must generalize initial placement without bypassing these authorities.

Card search currently has two complementary implementations. `src/main/local-store/block-document-projections.ts` materializes every current Document title and Block text into the general `block_search_units`/FTS5 projection with stable owner, Document, and Block identities; queries reject stale generation/head rows. `src/renderer/lib/command-palette-card-search.ts` builds a MiniSearch index over lightweight Card metadata and supports AND terms, prefix matching from two characters, and term-length-sensitive typo tolerance. The renderer owns IndexedDB hydration, decorations, recency, active-Project preference, and board-order tie-breaking. The new search service reuses the authoritative projection and extracts only transport-neutral metadata normalization, field evidence, and MiniSearch query semantics. It never calls IPC from main, reads renderer caches, loads full Documents into MiniSearch, or treats the current board-oriented `searchAuthoritativeCards` result as the complete Card domain.

Codex app-server supplies dynamic tools at task start. Protocol types under `packages/codex-app-server-protocol/src/v2/` are authoritative. `src/main/codex/codex-thread-launch-context.ts` assembles the start request, `src/main/codex/codex-app-meta-thread-tools.ts` defines the current `codex_app` namespace, and `src/main/codex/codex-service.ts` executes calls and resolves pending responses. A dynamic call identifies both a namespace and a tool. The implementation must preserve that pair throughout dispatch, pending-request storage, authorization, response, and transcript projection.

The official hosted Notion MCP research used the supported-tool guide, Markdown content guide, enhanced Markdown reference, and changelog listed in `Artifacts and Notes`. Its relevant contract is embedded in this plan: one high-level fetch, full Markdown on create, exact search-and-replace or whole replacement on update, separate move operations, explicit deletion permission for nested resources, and optional async delivery for large cloud writes. No implementation step depends on the external pages remaining available.

## Public Interface

The namespace is `nodex_app`. Public names use Agent intent; discriminants inside a tool describe the exact representation or mutation. The catalog is:

    export const NODEX_APP_TOOLSET_REVISION = 1 as const;

    export const NODEX_APP_TOOLS = [
      "get_context",
      "get_block",
      "search",
      "query_database",
      "create",
      "edit_document",
      "transfer_blocks",
      "edit_database",
    ] as const;

`get_context`, `get_block`, and `search` are eager because they form the normal discovery loop. `query_database` and all writes are deferred. Each registration owns its Zod input/output schema, descriptions, loading policy, effect classifier, and executor. TypeScript types and app-server JSON Schema are generated from that same schema source; do not maintain handwritten validators and schema objects in parallel.

Inputs do not contain `version`, Project ID, store epoch, actor, client session, mutation ID, idempotency key, or write-fence proof. The host persists `toolsetRevision` with the task's launch catalog and selects the matching registration on every call. Outputs retain `schemaVersion: 1` so transcripts and callers can audit the returned shape.

### Shared identities, revisions, and anchors

The wire uses canonical Block identity for Cards and Databases. It does not introduce separate `CardId` or `DatabaseId` identities.

    type Opaque<T, Name extends string> = T & {
      readonly __opaque: Name;
    };

    export type ProjectId = Opaque<string, "ProjectId">;
    export type BlockId = Opaque<string, "BlockId">;
    export type DocumentId = Opaque<string, "DocumentId">;
    export type ViewId = Opaque<string, "ViewId">;
    export type PropertyId = Opaque<string, "PropertyId">;
    export type Cursor = Opaque<string, "Cursor">;

    export type JsonValue =
      | null
      | boolean
      | number
      | string
      | JsonValue[]
      | { [key: string]: JsonValue };

    type Revision<Kind extends string> = Opaque<
      string,
      `Revision:${Kind}`
    >;

    export type DocumentRevision = Revision<"document">;
    export type LocationRevision = Revision<"location">;
    export type DatabaseSchemaRevision = Revision<"database_schema">;
    export type DatabaseValueRevision = Revision<"database_value">;
    export type ViewRevision = Revision<"view">;
    export type ViewPlacementRevision = Revision<"view_placement">;

`PortableRichText`, `DatabasePropertyValueType`, `DatabaseViewFilterNode`, and `DatabaseViewSort` are imported from the existing canonical types under `src/shared/block-documents/` and `src/shared/database-kernel.ts`. The ad-hoc query exposes this projection rather than forking the sort language:

    export type NonManualDatabaseViewSort = Omit<
      DatabaseViewSort,
      "field"
    > & {
      field: Exclude<
        DatabaseViewSort["field"],
        { kind: "manual" }
      >;
    };

A revision is opaque but not secret and never grants authority. Its internal envelope is versioned and binds revision kind, Project, store epoch, resource identities, and all canonical coordinates needed to prove the observed snapshot. For example, a Document revision contains generation/head internally, and a grouped View-placement revision may bind View revision, position revision, membership, and grouping-property value revision. The decoder rejects a token used for the wrong kind, resource, Project, or store epoch. Tokens survive process restart while their bound store epoch and authority remain valid; no server-side token registry is required.

The host mints a revision only beside the state it describes. A conflict error instructs the Agent to read again and does not return a replacement token without replacement state.

    export type TextInput =
      | { kind: "plain"; text: string }
      | {
          kind: "rich";
          richText: PortableRichText;
        };

    export type SiblingAnchor =
      | { kind: "start" }
      | { kind: "end" }
      | { kind: "before"; blockId: BlockId }
      | { kind: "after"; blockId: BlockId };

    export type DocumentAnchor =
      | { kind: "start"; parentBlockId?: BlockId }
      | { kind: "end"; parentBlockId?: BlockId }
      | { kind: "before"; blockId: BlockId }
      | { kind: "after"; blockId: BlockId };

`before` and `after` infer the parent from the anchor Block. `start` and `end` without a parent address Document roots; with `parentBlockId`, they address that parent's children. This discriminated union replaces illegal `parentBlockId?` plus `beforeBlockId?` combinations and never uses character offsets or fuzzy ellipses.

    export interface PageInput {
      limit?: number;
      cursor?: Cursor;
    }

    export interface PageOutput {
      hasMore: boolean;
      nextCursor?: Cursor;
    }

### Result envelope and errors

Every success and failure is one JSON text content item. The app-server `success` flag agrees with the envelope.

    export interface ToolSuccess<T> {
      schemaVersion: 1;
      data: T;
      page?: PageOutput;
    }

    export type RecoveryAction =
      | "retry_same"
      | "get_block_again"
      | "query_database_again"
      | "restart_search"
      | "request_authorization"
      | "use_block_representation"
      | "start_new_task"
      | "none";

    export interface ToolFailure {
      schemaVersion: 1;
      error: {
        code:
          | "invalid_arguments"
          | "tool_catalog_stale"
          | "project_context_required"
          | "authorization_required"
          | "authorization_denied"
          | "not_found"
          | "unsupported_resource"
          | "projection_not_ready"
          | "cursor_stale"
          | "conflict"
          | "invalid_nfm"
          | "nfm_patch_mismatch"
          | "nfm_patch_overlap"
          | "protected_owner_deletion"
          | "mixed_transfer_sources"
          | "idempotency_collision"
          | "result_too_large"
          | "timeout"
          | "internal_error";
        message: string;
        retryable: boolean;
        recovery: RecoveryAction;
        details?: {
          resourceId?: string;
          domainCode?: string;
        };
      };
    }

SQLite statements, numeric revision coordinates, Yjs state vectors, write-fence proof, IPC owner IDs, stack traces, and unbounded kernel payloads never cross this boundary.

### `get_context`

This tool answers “Where am I, what can I do, which Databases and Views exist, and how do I write NFM?”

    export interface GetContextInput {
      include?: {
        databases?: boolean;
        nfmGuide?: boolean;
      };
    }

    export interface GetContextOutput {
      project: null | {
        projectId: ProjectId;
        name: string;
      };
      access: {
        read: "allowed" | "unavailable";
        write: "granted" | "consent_required" | "unavailable";
        domains: Array<"document" | "placement" | "database">;
      };
      databases?: Array<{
        databaseBlockId: BlockId;
        name: string;
        isPrimary: boolean;
        schemaRevision: DatabaseSchemaRevision;
        views: Array<{
          viewId: ViewId;
          name: string;
          kind: "kanban" | "list" | "calendar" | "canvas";
          isPrimary: boolean;
          revision: ViewRevision;
        }>;
      }>;
      nfmGuide?: {
        format: "nfm";
        specificationVersion: string;
        instructions: string;
        examples: string[];
      };
    }

A Projectless task can call `get_context`; all other tools return `project_context_required`. The compact NFM guide is generated from shared format capability data and includes escaping, tab nesting, supported extension tags, limits, and the ownership distinction between `<card>` and `<mention-card>`.

### `get_block`

This tool gets one known Block by stable ID. A Card response can include its complete Document; an ordinary Document Block can return its subtree or owning Document.

    export type BlockLocation =
      | { kind: "space" }
      | {
          kind: "document";
          documentId: DocumentId;
          parentBlockId?: BlockId;
        }
      | {
          kind: "database";
          databaseBlockId: BlockId;
        };

    export interface DocumentBlockRecord {
      blockId: BlockId;
      parentBlockId: BlockId | null;
      siblingIndex: number;
      depth: number;
      type: string;
      props: Record<string, JsonValue>;
      content?: JsonValue;
    }

    export type DocumentRepresentation =
      | { format: "summary"; text: string }
      | {
          format: "nfm";
          content: string;
          contentHash: string;
        }
      | {
          format: "blocks";
          blocks: DocumentBlockRecord[];
        };

    export interface GetBlockInput {
      blockId: BlockId;
      include?: {
        properties?: boolean;
        database?: boolean;
        document?: {
          format: "summary" | "nfm" | "blocks";
          scope?: "owner" | "subtree";
          maxDepth?: number;
        };
      };
      page?: PageInput;
    }

    export interface GetBlockOutput {
      block: {
        blockId: BlockId;
        type: string;
        title?: TextInput;
        lifecycle: "active" | "archived" | "deleted";
        location: BlockLocation;
        locationRevision: LocationRevision;
        properties?: Record<
          PropertyId,
          {
            value: JsonValue;
            revision: DatabaseValueRevision;
          }
        >;
      };
      document?: {
        documentId: DocumentId;
        ownerBlockId: BlockId;
        revision: DocumentRevision;
        body: DocumentRepresentation;
      };
      database?: {
        databaseBlockId: BlockId;
        schemaRevision: DatabaseSchemaRevision;
      };
    }

For a document owner, NFM owner scope is the default. For an ordinary Block, NFM subtree scope is the default. NFM is always a complete canonical serialization for the selected scope. If it cannot fit, the tool returns `result_too_large`; it never returns a writable truncated string. Paged `blocks` output is the precision path and the source of anchor IDs.

### `search`

Search remains Block-indexed internally but defaults to Card-level product results. The input uses `query`, not `text`, because it expresses a discovery request. Fuzzy behavior is deliberately not an input knob.

    export type SearchScope =
      | { kind: "project" }
      | { kind: "database"; databaseBlockId: BlockId }
      | { kind: "document"; documentId: DocumentId };

    export type SearchInput =
      | {
          query: string;
          target?: "cards";
          scope?: SearchScope;
          filters?: { includeArchived?: boolean };
          page?: PageInput;
        }
      | {
          query: string;
          target: "blocks";
          scope?: SearchScope;
          filters?: {
            blockTypes?: string[];
            includeArchived?: boolean;
          };
          page?: PageInput;
        };

    export type SearchMatchQuality = "exact" | "prefix" | "fuzzy";

    export type CardSearchMatch =
      | {
          source: "identity";
          quality: "exact" | "prefix";
          excerpt: string;
        }
      | {
          source: "title";
          quality: SearchMatchQuality;
          excerpt: string;
        }
      | {
          source: "property";
          quality: SearchMatchQuality;
          propertyId: PropertyId;
          propertyName: string;
          excerpt: string;
        }
      | {
          source: "body";
          quality: "exact" | "prefix";
          blockId: BlockId;
          blockType: string;
          excerpt: string;
        };

    export interface CardSearchResult {
      kind: "card";
      blockId: BlockId;
      title: string;
      location: BlockLocation;
      matches: CardSearchMatch[];
    }

    export interface BlockSearchResult {
      kind: "block";
      blockId: BlockId;
      blockType: string;
      ownerBlockId: BlockId;
      documentId: DocumentId;
      source: "title" | "body";
      quality: "exact" | "prefix";
      excerpt: string;
    }

    export type SearchOutput =
      | {
          target: "cards";
          results: CardSearchResult[];
        }
      | {
          target: "blocks";
          results: BlockSearchResult[];
        };

The omitted target means `cards`, and omitted scope means the bound Project. Deleted Blocks never appear; archived Cards are excluded unless requested. A Database scope admits only Cards with a current membership in that Database. Scope and lifecycle filtering happen before candidate cutoffs, not after taking a Project-wide top N.

Each Card appears once with at most three representative matches. Multi-term queries use AND semantics at the Card aggregate: different terms may be satisfied by its title, identity, property values, headings, or body Blocks. Title and human-readable property display text receive term-length-sensitive typo tolerance using the shared policy already used by the command palette; identity and full Document content are exact/prefix only. `target: "blocks"` requires all terms to match one Block and never returns fuzzy hits, making it the advanced discovery path for a later stable-ID edit. A body match reports the exact current Block and type; a heading is therefore a `source: "body"` match with its heading Block type rather than a synthetic source category.

The main-side implementation has four stages:

1. In one deferred read transaction, capture Project/store epoch, change cursor, requested scope, current Card lifecycle/location/membership, current Database schemas and typed values, and every relevant Document search-unit freshness coordinate. Convert property values to bounded canonical display text through the same typed Database mapping that read models use; retain `propertyId` and name for evidence. Do not stringify arbitrary property JSON or use locale-dependent renderer labels.
2. Query `block_search_units_fts` for exact/prefix title and Block text. Keep the existing requirement that Document units equal the current generation/head. The current `source_revision`-only non-Document shape does not honestly capture Database value plus schema/option freshness, so version 1 does not persist property display units. If measurements later require that optimization, extend the projection schema and transactionally maintained source coordinates first.
3. Feed only the captured lightweight Card title, identity, and property display text into a disposable MiniSearch metadata index. Extract normalization, field-match interpretation, prefix policy, and fuzzy threshold from `command-palette-card-search.ts` into a shared DOM-free module; keep the Agent metadata document general rather than importing fixed command-palette fields or types. The main process may keep a bounded Project LRU keyed by `(storeEpoch, changeCursor, rankingRevision)`; it must not read the renderer's IndexedDB cache or index full NFM/body content. The renderer can continue to own cache hydration and visual decorations over the same shared semantics.
4. Union candidates by Card Block ID, require query-term coverage across their collected evidence, deduplicate evidence by stable source identity, and merge independently ordered metadata and FTS lists with field-aware reciprocal-rank fusion. Semantic tiers are exact identity, exact/prefix title, fuzzy title, exact/prefix property, exact/prefix heading/body, then fuzzy property. Multiple independent matches improve order within a tier. Use stable Block identity as the final tie-breaker. MiniSearch scores and FTS5 BM25 ranks remain private inputs and are never directly compared or returned.

This service searches canonical property values, not renderer labels such as active-Project preference or board recency. Project name is redundant inside a Project-bound tool, and a Kanban column/group label should be represented by its canonical grouping-property option where one exists. Typed range/equality/property logic remains `query_database`, not free-text search.

Search discovers identity but deliberately does not mint mutation revisions from a partial excerpt; the next step is `get_block`. Cursors bind target, scope, normalized query fingerprint, Project/store epoch, captured change cursor, ranking revision, and the last deterministic order key. Any authority or ranking revision change returns `cursor_stale` rather than mixing pages.

### `query_database`

Structured filters and sorts belong here, not in `search`. The ad-hoc source reuses `DatabaseViewFilterNode` and non-manual `DatabaseViewSort` from `src/shared/database-kernel.ts`; do not hand-write parallel AST types.

    export type DatabaseQuerySource =
      | { kind: "view"; viewId: ViewId }
      | {
          kind: "database";
          databaseBlockId: BlockId;
          filter?: DatabaseViewFilterNode;
          sort?: NonManualDatabaseViewSort[];
        };

    export interface QueryDatabaseInput {
      source: DatabaseQuerySource;
      select?: {
        propertyIds?: PropertyId[];
        documentSummary?: boolean;
      };
      page?: PageInput;
    }

    export interface QueryDatabaseOutput {
      database: {
        databaseBlockId: BlockId;
        name: string;
        schemaRevision: DatabaseSchemaRevision;
        properties: Array<{
          propertyId: PropertyId;
          name: string;
          valueType: DatabasePropertyValueType;
          config: Record<string, JsonValue>;
        }>;
      };
      view?: {
        viewId: ViewId;
        name: string;
        kind: "kanban" | "list" | "calendar" | "canvas";
        revision: ViewRevision;
      };
      rows: Array<{
        blockId: BlockId;
        title: string;
        locationRevision: LocationRevision;
        values: Record<
          PropertyId,
          {
            value: JsonValue;
            revision: DatabaseValueRevision;
          }
        >;
        placement?: {
          viewId: ViewId;
          groupKey: string | null;
          revision: ViewPlacementRevision;
        };
        documentSummary?: string;
      }>;
    }

An ad-hoc query rejects manual sort because no persisted View owns manual positions. A row's placement revision is a composite snapshot token sufficient for grouped movement; the Agent does not separately coordinate group-property and rank revisions.

### `create`

`create` atomically creates one aggregate. Version 1 has only `resource.kind: "card"`; the generic name permits a future Database or Template variant without turning one call into a multi-resource mutation bag.

    export interface DatabaseValueDraft {
      propertyId: PropertyId;
      value: JsonValue;
    }

    export type CreateDestination =
      | {
          kind: "space";
          at?: SiblingAnchor;
        }
      | {
          kind: "document";
          documentId: DocumentId;
          ifRevision: DocumentRevision;
          at: DocumentAnchor;
        }
      | {
          kind: "database";
          databaseBlockId: BlockId;
          ifSchemaRevision: DatabaseSchemaRevision;
          values?: DatabaseValueDraft[];
          view?: {
            viewId: ViewId;
            ifRevision: ViewRevision;
            groupKey?: string | null;
            at?: SiblingAnchor;
          };
        };

    export interface CreateInput {
      resource: {
        kind: "card";
        title: TextInput;
        body?: {
          format: "nfm";
          content: string;
        };
      };
      destination: CreateDestination;
    }

    export interface CreateOutput {
      resource: {
        kind: "card";
        blockId: BlockId;
        documentId: DocumentId;
        documentRevision: DocumentRevision;
        locationRevision: LocationRevision;
        createdBodyBlockIds: BlockId[];
      };
      database?: {
        databaseBlockId: BlockId;
        valueRevisions: Record<PropertyId, DatabaseValueRevision>;
        placementRevision?: ViewPlacementRevision;
      };
      receipt: { duplicate: boolean };
    }

The body may contain many Blocks. The host validates NFM, title, destination, schema, property values, View/group, and anchors before committing Card identity, Document genesis, body Blocks, membership, values, and position in one worker transaction. A Database destination without `view` creates membership without a manual View position. Owning `<card>` elements are rejected; non-owning `<mention-card>` is allowed.

Example:

    await nodex_app.create({
      resource: {
        kind: "card",
        title: { kind: "plain", text: "Migration plan" },
        body: {
          format: "nfm",
          content: [
            "## Goal",
            "",
            "Move in three phases.",
            "",
            "- [ ] Inventory",
            "- [ ] Migrate",
            "- [ ] Verify",
          ].join("\n"),
        },
      },
      destination: {
        kind: "database",
        databaseBlockId,
        ifSchemaRevision,
        values: [{ propertyId: priorityPropertyId, value: "p1" }],
        view: {
          viewId,
          ifRevision: viewRevision,
          groupKey: "in_progress",
          at: { kind: "end" },
        },
      },
    });

### `edit_document`

This is the primary authoring tool. It edits one Document aggregate and can change title and body in the same commit. NFM is the default mental model; stable Blocks are an escape hatch.

    export interface ExactNfmPatch {
      oldNfm: string;
      newNfm: string;
      expectedMatches?: number;
    }

    export interface NewBlockDraft {
      localId: string;
      type: string;
      props?: Record<string, JsonValue>;
      content?: JsonValue;
      children?: NewBlockDraft[];
    }

    export interface BlockUpdatePatch {
      type?: string;
      props?: Record<string, JsonValue>;
      content?: JsonValue;
      unsetContent?: true;
    }

    export type StableBlockEdit =
      | {
          kind: "insert";
          at: DocumentAnchor;
          block: NewBlockDraft;
        }
      | {
          kind: "update";
          blockId: BlockId;
          patch: BlockUpdatePatch;
        }
      | {
          kind: "move";
          blockId: BlockId;
          at: DocumentAnchor;
        }
      | {
          kind: "delete";
          blockId: BlockId;
        };

    export type DocumentBodyEdit =
      | {
          kind: "nfm.insert";
          at: DocumentAnchor;
          content: string;
        }
      | {
          kind: "nfm.patch";
          patches: ExactNfmPatch[];
        }
      | {
          kind: "nfm.replace";
          content: string;
        }
      | {
          kind: "blocks";
          edits: StableBlockEdit[];
        };

    export interface EditDocumentInput {
      documentId: DocumentId;
      ifRevision: DocumentRevision;
      title?: TextInput;
      body?: DocumentBodyEdit;
      safety?: {
        allowDeletingOwnedBlocks?: boolean;
      };
    }

    export interface EditDocumentOutput {
      documentId: DocumentId;
      revision: DocumentRevision;
      effects: {
        createdBlockIds: BlockId[];
        localBlockIds: Record<string, BlockId>;
        copiedBlockIds: Record<BlockId, BlockId>;
        updatedBlockIds: BlockId[];
        movedBlockIds: BlockId[];
        deletedBlockIds: BlockId[];
      };
      body:
        | { format: "nfm"; content: string; contentHash: string }
        | { contentOmitted: true };
      receipt: { duplicate: boolean };
    }

The schema requires at least one of title or body. `nfm.insert` parses a whole fragment, allocates fresh identities, and inserts all roots at one structural anchor without rewriting existing content. It rejects owning `<card>` elements. Appending many Blocks is:

    await nodex_app.edit_document({
      documentId,
      ifRevision,
      body: {
        kind: "nfm.insert",
        at: { kind: "end" },
        content: "## Risks\n\n- First risk\n- Second risk",
      },
    });

`nfm.patch` finds all patches against the same original canonical body. `oldNfm` must be non-empty. `expectedMatches` defaults to one and must equal the actual count. All matched spans across all patches must be disjoint. The compiler applies replacements simultaneously from the end of the original string, parses and canonicalizes the complete candidate, then performs one exact-revision mutation. There is no sequential cascade and no fuzzy normalization of `oldNfm`.

`nfm.replace` supplies the complete new body and is the recommended path when the Agent is drafting or substantially rewriting a document. The existing translator preserves unambiguous stable identities and explicit same-Document Card pins. `blocks` is for identity-sensitive type/property changes, Document-internal moves, and exact deletes. Copying is handled by `transfer_blocks`, even when destination equals source, because copying can clone document-bearing ownership closures rather than only one Document tree.

All body modes preflight identity effects. Any deletion requires fresh destructive confirmation. Deleting a Block that owns a Document additionally requires `allowDeletingOwnedBlocks: true`. A successful result returns complete updated NFM only when it fits; otherwise `contentOmitted: true` forces an explicit follow-up read.

### `transfer_blocks`

This tool moves or copies root Blocks between Space, Documents, and Databases. Source is deliberately absent: the host resolves it from current authority and verifies the observed location token.

    export interface TransferItem {
      blockId: BlockId;
      ifLocationRevision: LocationRevision;
    }

    export type TransferDestination =
      | { kind: "space"; at?: SiblingAnchor }
      | {
          kind: "document";
          documentId: DocumentId;
          ifRevision: DocumentRevision;
          at: DocumentAnchor;
        }
      | {
          kind: "database";
          databaseBlockId: BlockId;
          ifSchemaRevision: DatabaseSchemaRevision;
          values?: DatabaseValueDraft[];
          view?: {
            viewId: ViewId;
            ifRevision: ViewRevision;
            groupKey?: string | null;
            at?: SiblingAnchor;
          };
        };

    export interface TransferBlocksInput {
      mode: "move" | "copy";
      items: TransferItem[];
      destination: TransferDestination;
    }

    export interface TransferBlocksOutput {
      mode: "move" | "copy";
      results: Array<{
        sourceBlockId: BlockId;
        resultBlockId: BlockId;
        location: BlockLocation;
        locationRevision: LocationRevision;
        transformation: "preserved" | "wrapped" | "promoted";
      }>;
      copiedBlockIds: Record<BlockId, BlockId>;
      receipt: { duplicate: boolean };
    }

All items must currently share one source container because the canonical transfer has one source authority; otherwise return `mixed_transfer_sources` and ask the Agent to split calls. Space reordering is allowed. A move wholly within one Document uses `edit_document`; copy remains here because it allocates a new ownership closure. A move wholly within one Database uses `edit_database`; copy remains here because it creates a new Block and membership. Transfer to a Database may set initial values and View placement because membership, group validity, and initial position form one transfer aggregate; failure rolls them back together.

### `edit_database`

This tool edits Database data and persisted View placement, not membership or schema.

    export type DatabaseEdit =
      | {
          kind: "value.set";
          blockId: BlockId;
          propertyId: PropertyId;
          ifRevision: DatabaseValueRevision;
          value: JsonValue;
        }
      | {
          kind: "value.add_remove";
          blockId: BlockId;
          propertyId: PropertyId;
          add: string[];
          remove: string[];
        }
      | {
          kind: "view.place";
          viewId: ViewId;
          ifViewRevision: ViewRevision;
          items: Array<{
            blockId: BlockId;
            ifRevision: ViewPlacementRevision;
          }>;
          groupKey?: string | null;
          at?: SiblingAnchor;
        };

    export interface EditDatabaseInput {
      databaseBlockId: BlockId;
      ifSchemaRevision: DatabaseSchemaRevision;
      edits: DatabaseEdit[];
    }

    export interface EditDatabaseOutput {
      databaseBlockId: BlockId;
      valueRevisions: Array<{
        blockId: BlockId;
        propertyId: PropertyId;
        revision: DatabaseValueRevision;
      }>;
      placementRevisions: Array<{
        blockId: BlockId;
        viewId: ViewId;
        revision: ViewPlacementRevision;
      }>;
      receipt: { duplicate: boolean };
    }

`value.set` is compare-and-swap. `value.add_remove` preserves concurrent set intent for multi-select-like fields. A grouped `view.place` compiles grouping-property changes and manual position together; its composite placement token prevents a lost group/value update without exposing multiple numeric revisions. Membership entry/exit uses `transfer_blocks`. Property/View definition changes are intentionally absent and may later become `configure_database`.

### Limits and idempotency

Block pages default to 40, search results to 20, and Database rows to 50, with maxima of 100, 100, and 200. Card search keeps at most three matches per result. A search query is at most 512 UTF-8 bytes and 32 normalized terms. Bound each normalized property display value and total metadata bytes per Card before indexing; keep internal FTS candidate pools, MiniSearch Project caches, and cached Card counts behind explicit constants and LRU eviction so scope filtering and rank fusion never become an unbounded response or memory path. NFM uses the existing Card body limit; the normal dynamic response budget is 256 KiB. `nfm.insert` and `nfm.replace` accept at most the canonical body limit and 512 parsed Blocks; `nfm.patch` accepts at most 100 matched spans; `blocks` accepts at most the canonical 512 operations; transfers accept at most 16 roots; Database edits accept at most 32 operations. Validate raw JSON size, decoded token size, NFM size, parsed Block count, and operation count before authorization or mutation.

Every write uses a host-derived semantic call identity. A worker-owned `nodex_agent_call_receipts` row stores normalized request hash, request-local identity allocations, effect/decision metadata, canonical receipt reference, and final status, but not raw body text or full arguments. Persist allocations before canonical execution. Exact replay returns the original result with `duplicate: true`; identity reuse with different normalized arguments returns `idempotency_collision`.

## Plan of Work

### Milestone 1: make dynamic tools a real namespaced registry

Create a registry under `src/main/codex/` whose registration owns namespace, toolset revision, tool name, description, strict Zod input/output schemas, deferred-loading policy, effect classifier, and executor. Generate TypeScript inference, app-server JSON Schema, output parsing, and the execution index from these registrations. Convert every special dynamic request branch, pending-call selector, authorization occurrence, response route, and transcript formatter to use the complete `(namespace, toolsetRevision, tool)` key. Preserve current onboarding calls as explicit internal registrations rather than treating an unnamespaced matching tool name as trusted.

Add shared contracts under `src/shared/nodex-agent-tools/`. Keep protocol-facing Codex request/response types imported from `packages/codex-app-server-protocol/src/v2`; the new shared types describe Nodex's application contract, not a duplicate app-server protocol. Persist the injected Nodex toolset revision with the task launch/binding so a future handler never guesses an old catalog shape from model input. Version 1 tasks select version 1 handlers; unsupported historical revisions return `tool_catalog_stale`. Contract tests must prove strict keys, discriminants, bounded inputs, absence of model-authored version/scope fields, deterministic errors, and catalog/schema/handler parity.

At the end of this milestone, a test namespace may register a tool with the same name as a `codex_app` tool without entering its lifecycle. Run the focused Codex main and shared tests and expect both namespaces to dispatch independently.

### Milestone 2: add exact Project reads and compact NFM discovery

Create `src/main/agent-tools/` as a transport-neutral facade. Derive an `AgentProjectScope` from the dynamic call and persisted root-task/Project binding. Add the versioned opaque revision/cursor codec described above. Encode a bounded stable JSON envelope as base64url with a revision-kind prefix and integrity checksum; the checksum detects corruption but is not authorization. The codec must round-trip each revision kind, reject kind/resource/Project/epoch misuse, and project to existing numeric kernel coordinates only inside the trusted facade. Add Block-worker commands for Project context, exact `get_block`, Card-first/Block-aware `search`, and paged `query_database`. Exact reads must capture identity, location, properties, membership, Document head, current materialization, Database values, and View placement in one deferred SQLite transaction before minting tokens. A ready Document without an exact current materialization fails closed.

Implement search as its own application read service under that facade. Extract the reusable normalization, prefix/fuzzy policy, and match-evidence helpers from `src/renderer/lib/command-palette-card-search.ts` into a shared DOM-free Card-search module; keep MiniSearch persistence, command-palette fields, preview decoration, recent/active Project preference, and board ordering in the renderer adapter. Add a canonical metadata snapshot reader for every Card location, not only active primary-Kanban rows. It reads bounded title/identity plus current typed property display values and records stable property evidence under the same transaction/change cursor used for FTS results. Build or reuse a bounded main-process MiniSearch cache from that snapshot, query exact-head `searchDocumentBlockUnits` for body/title evidence, and fuse results by Card ID without comparing raw channel scores. Do not invoke `cards:search` from the dynamic handler and do not reuse `searchAuthoritativeCards` as the domain boundary; once the shared service is stable, adapt the legacy IPC/HTTP description-search response to consume it where this preserves current command-palette behavior.

Keep the existing FTS projection as the only full-content index. Do not add persisted Database-property rows to `block_search_units` until a schema can bind value, membership, property, option/schema, and Block freshness rather than only `source_revision`. Cap normalized metadata field bytes and cached Projects, invalidate the cache on store epoch/change cursor/ranking revision, and filter lifecycle/Database/Document scope before taking candidates. Card search aggregates term coverage across metadata and multiple body Blocks; Block search requires exact/prefix term coverage within one current Block.

Add a shared NFM format version and compact agent reference beside `src/shared/nfm/`. The parser, serializer, tool response, and human reference must draw supported feature names from the same capability definition where practical. Add no runtime dependency on a repository Markdown file, because packaged apps may not ship `docs/`.

At the end of this milestone, a new Project-bound task can call `get_context`, default Card-first `search`, `get_block`, and `query_database`. A full Card read returns canonical NFM plus `DocumentRevision`; Block representation returns stable IDs; Database rows return typed value and composite View-placement revisions; an oversized NFM read fails safely instead of truncating. Search tests prove typo-tolerant title/property discovery, exact/prefix-only body behavior, cross-field multi-term AND coverage, Cards in Space/Document/Database locations, Database scope before limiting, several matching body Blocks collapsing into one Card with distinct evidence, stable Block-target hits, absence of public scores/revisions, deterministic ties, cache invalidation, and stale-cursor rejection.

### Milestone 3: make NFM a first-class mutation compiler

Add pure command compilers under `src/shared/nodex-agent-tools/` or `src/shared/block-documents/` as appropriate. `nfm.insert` must parse a fragment, reject owner-bearing elements, allocate IDs through a supplied deterministic allocator, and produce one ordered `DocumentOperationBatch`. Test root start/end, before/after, child start/end, multiple roots, nested Blocks, invalid anchors, and replayed allocations.

`nfm.patch` must serialize the exact current materialization, locate every patch against that one original string, enforce each `expectedMatches`, reject all overlapping spans, apply replacements simultaneously, parse and canonicalize the result, and then call the same detached whole-NFM translator as `nfm.replace`. Extend the canonical Document edit seam so a title change and any body mode commit as one Yjs/Document mutation. Add an impact preflight that reports created, deleted, changed, and moved IDs before authorization. Preserve existing same-Document Card UUID pins and reject foreign, duplicate, newly introduced, or cross-parent owner pins.

Expose these compilers only through Document mutation coordination in `src/main/document-sync-hub.ts` and `src/main/local-store/block-document-operations.ts`. Decode the opaque Document revision at this trusted edge; do not mutate a Y.Doc in the dynamic handler or reimplement canonical store checks. At the end of the milestone, tests demonstrate a one-call multi-Block append, a two-patch non-cascading edit, overlap rejection, atomic title-plus-body replacement, a protected nested Card, a same-Document stable-ID move, revision conflict, and no partial commit.

### Milestone 4: create complete Cards atomically at any supported location

Introduce a purpose-built Card creation aggregate command rather than chaining public `create`, transfer, and Database calls. Reuse `createCardDocumentGenesis` for NFM import and the canonical Card lifecycle, Block-location, membership, Database-value, and View-position helpers inside one worker-owned SQLite transaction. The command allocates every identity before execution, decodes and validates destination revisions before writes, and emits one durable receipt with newly minted public revisions.

The current `src/shared/card-lifecycle.ts` creation path assumes the primary Kanban/status model. Refactor the reusable Card genesis and lifecycle record portion from that assumption, then support Space, Document, and Database targets through the same location vocabulary used by Block transfer. Remove no existing caller until the generalized kernel has parity tests. This is a controlled parallel migration, not a second permanent Card-creation authority.

At the end of the milestone, one tool call creates a titled Card containing headings, tasks, a callout, and nested lists. Tests prove Space append/before placement, nested Document placement guarded by `DocumentRevision`, Database group/value/position creation, rollback on every late failure seam, and exact idempotent replay.

### Milestone 5: adapt transfer and Database edits without bypasses

Implement `transfer_blocks` as a strict compiler to the existing Block-transfer kernel. Resolve source from the store, verify every `LocationRevision`, require all roots to share one source, and reject same-Document or same-Database cases that belong to `edit_document` or `edit_database`. Extend the purpose-built transfer transaction only as needed for atomic destination values/View placement. Implement `edit_database` as a restricted compiler to canonical value and View-position operations. Decode composite placement tokens into all required expected revisions. Keep membership exclusively in transfer and return canonical receipts plus newly minted opaque revisions rather than synthetic success strings.

At the end of the milestone, an Agent can move or copy any supported Block across Space, Document, and Database containers without stating the source, then update typed values or reorder a View without Card- or Kanban-specific public tools.

### Milestone 6: authorize effects in the main process

Add a main-owned authorization broker. Parsed reads execute automatically. An ungranted ordinary write creates a random opaque authorization occurrence and semantic preview; the renderer displays it in the existing conversation request surface and returns only the decision. A task grant is in-memory state bound to root task, Project, store epoch, and app-server session epoch; verified descendants may inherit it.

Classify effects from validated inputs plus store preflight, never from the tool name alone. Block deletion, owner replacement, and move/copy effects must appear in the preview. Destructive calls always require a current visible owner and allow-once decision. Project rebinding, epoch rotation, root archive/unsubscribe, owner disconnect, service shutdown, and restart revoke grants. Pending approval expires after five minutes; execution expires after thirty seconds; cancellation resolves the dynamic call with a structured error and no abandoned waiter.

At the end of the milestone, renderer tests and Storybook show allow once, allow task, deny, and destructive re-prompt states. Headless writes return `authorization_required` without mutation.

### Milestone 7: integrate task launch, document behavior, and release safely

Compose the static Nodex namespace and its toolset revision into every new user-owned task, including Projectless tasks that may later become bound. Exclude internal title-generation and other ephemeral tasks. Project-bound scheduled tasks may read, but version 1 headless writes fail closed. Keep Nodex registrations independent from model-list loading so a model-provider failure cannot remove product tools. Do not fake hot injection for old tasks.

Update `ARCHITECTURE.md`, `docs/product-specs/nodex-product-spec.md`, `docs/SECURITY.md`, `docs/RELIABILITY.md`, `docs/references/notion-flavored-markdown-spec.md`, Storybook, and this plan. Add an `Unreleased` changelog entry because Agent-readable/writeable Project data is a release-note-worthy capability. Document intent-first tool wording, opaque revision semantics, Card-first search, NFM create/insert/patch/replace rules, ownership separation, scope binding, grant lifecycle, idempotency, headless policy, and old-task rollout limitation.

At the end of the milestone, manual acceptance from a newly created Project-bound task exercises the full user journey described below and all release gates pass.

## Concrete Steps

Work from `/Users/asc/repo/nodex`. Before each milestone, run `git status --short` and preserve unrelated user changes. Use `rg` to find call sites before editing. Commit each independently working milestone with a conventional subject and an explanatory body.

For contract and pure Document compiler iteration, use commands shaped like:

    pnpm exec vitest run --config vitest.node.config.ts src/shared/nodex-agent-tools/<focused-test>.test.ts
    pnpm exec vitest run --config vitest.node.config.ts src/shared/block-documents/<focused-test>.test.ts

For main/store kernels, use the repository's Electron-ABI-aware runner rather than invoking a main Vitest config directly:

    pnpm test:main <path-to-focused-main-test>

For renderer authorization work, use:

    pnpm exec vitest run --config vitest.renderer.config.ts <path-to-focused-renderer-test>

For the app-server round trip, use:

    pnpm test:integration <path-to-focused-integration-test>

After the final edit set is stable, run the broad-feature handoff gates. Run them sequentially if Electron/native-addon or machine resource contention could make parallel results flaky:

    pnpm run typecheck
    pnpm run lint
    pnpm test

Then inspect:

    git diff --check
    git diff --stat
    git status --short

If a full gate fails, fix the issue and rerun the failed gate plus the focused test for that surface. Rerun all three full gates only when the fix crosses surfaces.

## Validation and Acceptance

Registry tests must prove full namespace isolation, one-source Zod/TypeScript/JSON-Schema generation, absence of model-authored version and scope authority, parser/executor parity, and correct eager/deferred flags. A foreign namespace using a Codex special tool name must not enter onboarding, automation, or meta-thread handling. New user tasks, fork/create paths, and eligible automations persist the intended toolset revision; resume selects that historical revision without claiming refresh, and an unsupported revision fails explicitly.

Read tests must cover Cards in Space, Document, and Database locations; ordinary Block subtrees; Database Blocks; archived/deleted identities; pending, corrupt, and stale materializations; Project isolation; persisted and ad-hoc View semantics; stable paging; and oversized NFM recovery. Search coverage must include exact/prefix title and body, fuzzy title and property values at every shared term-length boundary, no fuzzy full-body promise, ID exact/prefix behavior, multi-term coverage split across title/property/different body Blocks, property option rename freshness, scope filtering before cutoff, archived inclusion, duplicate Card collapse with at most three stable evidence items, heading Block identity/type, `target: "blocks"` all-terms-in-one-Block semantics, deterministic rank fusion/ties, no raw score or mutation revision, Project cache hit/miss/eviction, store-change and ranking-revision invalidation, and legacy command-palette adapter parity. Revision-token tests must round-trip every kind, reject cross-kind/resource/Project/epoch use, bind composite transfer/View state, survive process recreation in the same epoch, and never mint a replacement token in a conflict. A changed snapshot invalidates a cursor.

NFM write tests must prove canonical create round trips; multi-root nested append; all structural insertion anchors; exact one- and multi-patch edits; every patch matching the same source; expected-match mismatch; overlap rejection; non-cascading simultaneous application; whole replacement; atomic title-plus-body edit; same-Document stable-ID move; stable identity reporting; same-Document Card pin preservation; rejection of foreign/new/cross-parent Card pins; owner deletion gating; Document-revision conflict; deterministic ID allocation on replay; and atomic rollback.

Creation tests must prove that one call creates a complete Card and all body Blocks. Test each target authority and late fault seams after Card row, Document genesis, placement, membership, values, and View position. After any injected fault, no partial active records remain, and replay uses the same reserved IDs.

Transfer and Database tests must cover Space/Document/Database transfer, host-resolved source, mixed-source rejection, same-authority routing errors, copy maps, promotion/wrapping, stale location tokens, cycles, destination values, typed value revisions, set-intent updates, composite grouped View placement, and the invariant that membership is not writable through `edit_database`.

Authorization tests must cover allow once, task grant, verified child inheritance, denial, destructive re-prompt, protected-owner intent, no owner, follower forgery, concurrent authorization occurrences, timeout, turn cancellation, archive, owner loss, Project/epoch change, restart, exact replay, and idempotency collision. Renderer React tests must be act-clean, and Storybook must show all user-visible approval states.

Manual acceptance starts Nodex with a Project containing a Database and Kanban View, then creates a new Project-bound Codex task. Ask the agent to perform these observable actions:

1. Call `get_context` with the NFM guide, use default `search` with a misspelled title/property term to find a Card, then use an exact body phrase and confirm the same Card returns once with distinct bounded evidence even when several body Blocks match. Call `search` with `target: "blocks"` to obtain one exact Block identity, call `query_database` for the Card's Kanban, and use `get_block` to read it as NFM. No prompt appears and no search result exposes a raw score or mutation revision.
2. Create a new Card titled `Migration plan` with at least ten Blocks expressed in one NFM body, placing it in a selected Kanban group with initial property values. One ordinary-write prompt appears, and the complete Card appears after approval.
3. Read only the Card summary to obtain its opaque Document revision, then append a heading, paragraphs, and a checklist in one `edit_document` `nfm.insert` call. The task grant avoids a second ordinary-write prompt.
4. Use one `nfm.patch` call to check two tasks and rename a section. Both patches match the same original NFM and the resulting Card preserves unrelated content.
5. Use `edit_database` to move the Card to another View group and update a property. Then use `transfer_blocks` to move or copy it to another container without supplying a source. Existing realtime events update the UI.
6. Attempt an NFM replacement that removes existing Blocks. A fresh destructive prompt appears. If the body contains a nested owning Card, omitting `allowDeletingOwnedBlocks` fails before approval.
7. Use `edit_document` with `body.kind: "blocks"` for one stable-ID-specific edit and verify the returned Block ID remains the same.

The transcript must show structured `nodex_app` calls and canonical receipts. An old task created before rollout must not claim to have this namespace.

## Idempotence and Recovery

Reads are side-effect free, and cursors/revisions fail closed on snapshot change or scope/kind misuse. Opaque tokens are deterministic projections of canonical snapshots, not stored capabilities, so retrying the same read in the same state returns equivalent evidence. Every write has a host-derived semantic identity. Request-local Block, Card, Document, membership, and View-position allocations are durable before mutation. A crash after preparation but before mutation resumes from the same allocations; a crash after mutation replays the canonical receipt. Reusing an identity with different normalized arguments is a typed collision rather than a second write.

Approval never changes mutation input. The broker retains the parsed request and scope, accepts only an opaque decision occurrence from the current owner path, then rechecks Project binding, store epoch, and optimistic concurrency immediately before execution. A conflict asks the agent to read again; no NFM replacement, deletion, or placement intent is silently rebased.

NFM parsing and replacement happen on detached values before committing. Invalid syntax, an expected-match mismatch, overlapping patch spans, or a protected owner deletion leaves the authoritative Y.Doc untouched. Title and body are one Document intent and never partially commit. Creation validates the complete Card and destination before the worker transaction and rolls all authority tables back together on failure.

The receipts table is additive and stores no raw Document body. Removing `nodex_app` registrations from new task starts disables new exposure without changing existing Nodex data. Historical task catalogs remain truthful to the app-server model. Any temporary parallel creation seam introduced during migration must be removed once canonical parity tests pass; do not leave two authorities as a compatibility layer.

## Artifacts and Notes

The baseline design before the NFM/Notion revision is preserved in the immediately preceding plan commit. The official research sources were:

- Official hosted MCP catalog: `https://developers.notion.com/guides/mcp/mcp-supported-tools`.
- Official Markdown content guide: `https://developers.notion.com/guides/data-apis/working-with-markdown-content`.
- Official enhanced Markdown syntax: `https://developers.notion.com/guides/data-apis/enhanced-markdown`.
- Official changelog, especially February and April 2026: `https://developers.notion.com/page/changelog`.
- Official security guidance: `https://developers.notion.com/guides/mcp/mcp-security-best-practices`.
- Official open-source server: `https://github.com/makenotion/notion-mcp-server`, inspected locally at commit `d7e3bbd62890f9efca2cd54449ac072f3bd1a4ba` rather than through raw GitHub crawling.
- Official MiniSearch source/type documentation for search options and `SearchResult`: `https://github.com/lucaong/minisearch`, resolved through Context7 as `/lucaong/minisearch` and checked against the repository's pinned MiniSearch 7.2.0. It confirms callback-based prefix/fuzzy policy, `AND` combination, field boosts, and per-result `terms`/`match` evidence; its numeric score remains an implementation result rather than an interoperability contract.

The Card-search implementation review covered `src/renderer/lib/command-palette-card-search.ts`, `src/renderer/lib/command-palette-card-results.ts`, `src/renderer/lib/use-command-palette-card-search-index.ts`, `src/shared/search-text.ts`, `src/main/local-store/card-search-store.ts`, `src/main/local-store/block-document-projections.ts`, the `block_search_units` schema, Card read models, and their focused tests. The durable conclusion is to share semantics, not runtime state: renderer MiniSearch is a good metadata-recall model; exact-head FTS is the canonical full-content evidence source; main-side rank fusion owns Agent discovery; and general Database-property text stays snapshot-derived until a persisted projection can represent all of its freshness dependencies.

The subsequent product-language discussion was read from `/Users/asc/Downloads/Nodex设计理念转变.html`. Its durable contributions are embedded rather than referenced as authority: NFM is the language protocol and stable Block operations are the storage-level escape hatch; public tools use Agent intent; one `create` call builds a complete aggregate; search defaults to owning Cards; transfer source is store fact; and concurrency coordinates should be opaque. This plan further tightens that proposal by retaining canonical `databaseBlockId`, using domain-typed rather than universal revision tokens, binding toolset revision in the host, making NFM patches non-cascading, and refusing to return a fresh revision without its state.

The most important Notion request shapes, paraphrased for durable reference, are: create one or more Pages with parent, properties, and a Markdown `content` string; update a Page with a discriminated command for whole replacement or an ordered list of exact old/new strings; move Pages with a separate typed parent operation; optionally request asynchronous delivery for large cloud Markdown writes; and explicitly opt in before removing nested resource content. Nodex's design keeps those useful intents but maps them onto Block identity, opaque revision-bound Document snapshots, structural anchors, and separate placement/Database authorities.

Revision note, 2026-07-15: Replaced the baseline stable-ID-first interface after official Notion MCP and Nodex NFM source review. A later revision incorporated the saved design-language discussion: tools are now `get_block`, Card-first `search`, `query_database`, `edit_document`, `transfer_blocks`, and `edit_database`; inputs no longer repeat a version; concurrency uses typed opaque revisions; NFM patches are simultaneous against one source; transfer source is host-resolved; and the plan contains TypeScript-shaped contracts for every tool. The latest revision traced the current fuzzy Card-search pipeline and specified one main-owned hybrid service, typed exact/prefix/fuzzy evidence, exact-only Block discovery, snapshot-derived property metadata, score-free rank fusion, and cursor-bound ranking freshness.

Revision note, 2026-07-16: Recorded Milestone 1 implementation. The living plan now reflects the strict Zod registry, namespace-safe lifecycle routing, schema-v64 per-thread catalog binding, and the concrete decision to select handlers by the host-owned `(namespace, toolsetRevision, tool)` identity.
