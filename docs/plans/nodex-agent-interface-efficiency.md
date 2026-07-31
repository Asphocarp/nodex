# Budget and simplify the Nodex Agent interface

This ExecPlan is a living document. Maintain the `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections as implementation proceeds. Follow `docs/PLANS.md` when editing it.

## Purpose / Big Picture

After this work, a newly started Codex task receives `nodex_app@3`: an intent-oriented Agent API whose common search/fetch, saved-View query, plural Card creation, Card update, movement, and duplication paths are materially smaller and harder to misunderstand than v2 without weakening semantic concurrency, atomic creation, transcript observability, or advanced stable-Block updates.

This completed plan records the historical v3 cutover. The later Library
Page/Data Source migration renamed the public nouns and published the current
catalog as `nodex_app@4`; it did not rewrite this plan's measured v3 artifacts.

An Agent can follow the familiar `search → fetch` workflow, query a saved View without constructing a source union, atomically create one or several complete Cards, update a Card by its public Card ID, move several Cards, or duplicate one complete Card without choosing a generic operation mode. Nested Markdown is the default format, and the namespace explains its tab-nesting rule with one immediately usable example. Rich titles use its inline Markdown syntax instead of an Agent-specific `plain|rich` JSON tree. Rare identity-sensitive Block operations and `advanced_query_database` remain separately deferred. Independent value edits on an existing Database membership are deliberately absent until their user intents are designed. Deterministic CI budgets and behavior fixtures prevent future catalog growth or misleading simplification from going unnoticed.

The user-visible proof is a Code Mode workflow that discovers Cards, reads only selected complete Nested Markdown, performs a bulk semantic edit, and returns a short summary while every nested call remains readable and raw-inspectable in the transcript. The engineering proof is a generated catalog report and behavior fixtures that meet the budgets below.

## Progress

- [x] (2026-07-16) Read the current v2 ADR, ExecPlan, contracts, dynamic registry/runtime, Nested Markdown guide, transcript contract, and Agent Integration product spec.
- [x] (2026-07-16) Read the current official Notion MCP supported-tools guide, changelog, and enhanced-Markdown create/read/update guide.
- [x] (2026-07-16) Clone and inspect `makenotion/notion-mcp-server` at `d7e3bbd62890f9efca2cd54449ac072f3bd1a4ba`; confirm that it is the older local OpenAPI server rather than the actively supported remote MCP source.
- [x] (2026-07-16) Measure the v2 catalog, opt-in Nested Markdown guide, representative query result, and the largest individual schemas.
- [x] (2026-07-16) Prototype flattened/text-first variants for create, Nested Markdown edit, and transfer to identify the highest-leverage changes.
- [x] (2026-07-16) Refine the proposal around intent clarity: rename `get_block` to `fetch`, make Nested Markdown the default, remove `title.kind`, and split saved-View query from ad-hoc Database query.
- [x] (2026-07-16) Refine the intent catalog to `create_cards`, `update_card`, `advanced_update_card`, `move_cards`, `duplicate_card`, and `advanced_query_database`; remove `edit_database` from v3.
- [x] (2026-07-16) Replace Agent-visible `NFM` terminology with Nested Markdown, choose compact `markdown` wire fields, and budget one tab-explicit namespace example.
- [x] (2026-07-16) Record the proposed decision in ADR 0016 and create this restartable implementation plan.
- [x] (2026-07-16) Add a pure production catalog serializer/measurement seam, deterministic developer report, v2 baseline and v3 acceptance budgets, and sparse-result fixtures before changing v2 contracts.
- [x] (2026-07-16) Implement and prove canonical inline Markdown title input/output helpers over the existing portable-rich-title storage boundary.
- [x] (2026-07-16) Define and budget the complete `nodex_app@3` contract, including default `update_card` authoring through Nested Markdown and separately deferred `advanced_update_card` for stable-Block operations; keep v2 active until service migration is complete.
- [x] (2026-07-16) Implement the v3 Card-first read Adapter for context, search, fetch, saved-View query, and advanced ad-hoc query; preserve one-snapshot reads, fuzzy Card discovery, sparse values, and narrow semantic ETags without activating the catalog.
- [x] (2026-07-16) Adapt `update_card` and `advanced_update_card` to the canonical Document mutation/receipt kernel with Card-ID resolution, inline-Markdown titles, public Nested Markdown results/errors, and replay-before-current-state preflight.
- [x] (2026-07-16) Deepen Card creation into a real `create_cards` coordinator with deterministic batch allocation, one public receipt, one shared destination snapshot/Document lease, ordered multi-root placement, sparse Card-first output, exact replay, and whole-batch rollback.
- [x] (2026-07-16) Adapt `duplicate_card` to the canonical copy compiler with Card-root validation, Card-first destinations/results, complete ownership leases, fresh deterministic identities, opt-in Block map/ETags, and exact public receipt replay.
- [x] (2026-07-16) Implement `move_cards` as one mixed-source transaction coordinator with inferred Card authority, deduplicated Document leases, sequential head rebasing, ordered final placement, same-Database placement-only semantics, sparse Card-first output, and exact replay.
- [x] (2026-07-16) Bind all ten v3 tools through the dynamic execution service, semantic authorization and Document lease paths; pin newly launched tasks to revision 3, retire v2 execution with structured stale-catalog recovery, and keep both revisions readable in transcript Details/Raw.
- [x] (2026-07-16) Add v3 compact transcript projections for fetch/query/create/update/move/duplicate, bounded Nested Markdown diffs, exact arguments/output/raw inspection, and dual-read authorization previews for historical `nfmPreview` plus v3 `markdownPreview`.
- [x] (2026-07-16) Build and run a throwaway pure Database query compiler/benchmark, then delete it: the candidate reduced tool bytes by 76.2% and corpus argument bytes by 51.8% with 10/10 canonical AST equivalence, but accepted only 4/10 plausible SQL/colloquial grammar variants, so typed `advanced_query_database` remains the v3 contract pending broader deterministic grammar coverage and concrete user demand.
- [x] (2026-07-16) Evaluate structured dynamic-tool results against the pinned protocol, current official app-server contract, and upstream Codex router/Code Mode implementation; retain JSON-text transport because dynamic tools expose neither an output schema nor structured response content, and Code Mode therefore receives their text payload as a string.
- [x] (2026-07-16) Update ADR/domain/architecture/product/reliability/security/transcript/reference/changelog sources of truth, rename the public format reference, complete catalog/type/lint/unit/main/renderer/integration/build validation, isolate one renderer worker-start flake, and write the retrospective.

## Surprises & Discoveries

- Observation: The often-repeated “91% reduction” applies only to `notion-create-database` and `notion-update-data-source` after switching schema definitions to SQL DDL. Notion lists `update-page` flattening and moving the Markdown specification to an on-demand Resource as separate improvements.
  Evidence: The February 26, 2026 Notion changelog entry names those two tools and separately describes flattened page parameters; the January 15 entry records removal of the Markdown specification from `notion-create-pages`.

- Observation: The current remote Notion MCP source is not published in the public `makenotion/notion-mcp-server` repository.
  Evidence: The repository README says active support is for a separate remote MCP and asks users not to file remote-MCP issues there. Source inspection is still useful for its OpenAPI-to-tool flattening boundary, but official remote docs and changelog are authoritative for the Agent tools.

- Observation: v2 already has a small opt-in format guide; grammar duplication is not the current catalog problem.
  Evidence: the current `NFM_AGENT_GUIDE` serializes to 1,123 bytes and is returned only when the v2 `get_context.include.nfmGuide` flag is requested. The namespace does not contain the full grammar.

- Observation: “Nested Markdown” is easier to infer than `NFM`, but it is descriptive product language rather than a standard with one universal indentation rule.
  Evidence: Notion's official enhanced-Markdown reference requires one tab per child Block, while CommonMark treats tabs as tab-stop-expanded spaces in structural contexts. Nodex must explain that only tabs express Block nesting, without guessing that authored leading spaces were intended as structure.

- Observation: A rendered indentation example can contradict its own rule without looking wrong.
  Evidence: spaces and a literal tab are visually indistinguishable in many transcript/code renderers. A JSON-string example containing `\n` and `\t` makes the required bytes unambiguous to a Code Mode Agent.

- Observation: Result bloat and catalog bloat are now different problems.
  Evidence: The semantic-precondition migration reduced the representative thirteen-row query to 1,895 bytes, while the published v2 catalog remains 40,594 bytes. Optimizing one does not imply the other is solved.

- Observation: Generated-schema structure, not field spelling, dominates the largest tools.
  Evidence: `TextInput` alone is 2,615 bytes. `transfer_blocks` repeats the destination union under separate move/copy variants. `edit_document` loads Nested Markdown and recursive stable-Block operations together.

- Observation: A quick prototype can materially reduce the common path without inventing a DSL.
  Evidence: Create input fell from 7,109 to 4,286 bytes with an inline title and the direct v2 `nfm` field; text-only Document edit fell from 9,663 to 2,499 bytes; consolidated transfer fell from 9,200 to 5,124 bytes. V3 must remeasure after renaming that public field to `markdown`.

- Observation: Familiar naming exposes a hidden v2 query ambiguity.
  Evidence: `get_block` is an implementation-oriented verb for a search/fetch workflow. The current `query_database` schema accepts either a saved View or an ad-hoc Database filter/sort, so renaming it wholesale to `query_database_view` would misdescribe one branch. Splitting the intents makes both names and schemas narrower.

- Observation: Card-level names eliminate more schema and recovery branches than flattening one generic union.
  Evidence: Current `transfer_blocks` accepts arbitrary roots, a move/copy discriminator, a caller-supplied source for move, promotion/wrapping evidence, and a duplicated destination schema. `move_cards` and `duplicate_card` can require real Card roots, infer source authority, omit transformation variants, and return Card identities directly.

- Observation: Removing `edit_database` is a real capability decision.
  Evidence: V2 uses it for scalar value replacement, set-like changes, and persisted View placement. V3 can initialize new memberships during create, cross-Database move, or duplication and can change View placement through `move_cards`, but it cannot perform an independent value edit on an existing same-Database membership.

- Observation: The first attempt to measure the production catalog by importing the complete runtime into `tsx` loaded BlockNote CSS and failed under host Node.
  Evidence: Importing `buildNodexAgentDynamicToolSpecs` reached `third_party/blocknote/packages/core/src/style.css`. The successful measurement used the shared contracts plus the same Zod JSON Schema conversion and catalog metadata. The implementation should expose a pure catalog serialization seam so future measurements do not depend on renderer assets.

- Observation: The pure production serializer validates the research baseline closely enough to use it as a CI boundary.
  Evidence: `pnpm run agent-tools:measure` reports 529 namespace bytes, 6,524 eager bytes, and 40,558 complete bytes for v2. The earlier contract-only research measurement was 40,594 complete bytes, a 36-byte difference rather than a materially different catalog.

- Observation: Catalog declaration did not need to depend on the Agent execution singleton.
  Evidence: Building catalog specs from the shared contracts and the generic registry is sufficient; runtime execution still uses the authoritative Agent service, while the launch catalog, tests, and developer report now avoid stores and BlockNote assets.

- Observation: Canonical rich-title storage does not have a Card-mention atom.
  Evidence: `PortableRichText` and the collaborative title UI support text, links, line breaks, thread mentions, and date mentions. Nested Markdown's `<mention-card>` is a standalone body Block. Accepting it in an Agent title would claim a lossy capability, so the v3 title subset rejects Card Blocks without changing storage.

- Observation: The shared inline parser previously treated uniform style markup inside a link label as literal escaped characters.
  Evidence: `[**docs**](https://example.com)` serialized as styled link content but parsed back as literal `**docs**`. Parsing a uniform inline label before constructing the link preserves styles and keeps both the historical escaped-literal case and repeated round trips stable.

- Observation: The measured v3 contract is substantially below every initial cap without a query DSL.
  Evidence: After making advanced Block preparations explicit, `pnpm run agent-tools:measure -- --v3` reports 4,427 eager bytes and 29,021 complete bytes. Per-tool totals are `fetch` 1,932, `query_database_view` 983, `advanced_query_database` 2,796, `create_cards` 4,472, `update_card` 3,004, `advanced_update_card` 4,889, `move_cards` 4,198, and `duplicate_card` 4,245 bytes.

- Observation: Card-first reads can reuse the existing read kernels without exposing Document IDs or Database value validators.
  Evidence: The v3 Adapter resolves Card ownership and search scope inside the same deferred SQLite transaction, translates canonical internal NFM to the public `markdown` projection, and strips property ETags from fetch/query results while retaining explicitly prepared title, body, Block-update, and subtree-delete ETags.

- Observation: Public Card intents do not require a second Document mutation or receipt implementation.
  Evidence: The shared preparation seam now hashes the original public request and checks its committed receipt before invoking a late input resolver. V2 resolves a Document input directly; both v3 update tools resolve `cardId`, parse inline Markdown, and translate Nested Markdown or stable-Block edits only when a new mutation is actually required.

- Observation: A correct Card batch needs a coordinator above single-Card genesis, not a loop around the public single-create service.
  Evidence: Every draft can reuse the existing genesis, membership, value, and View kernels, but separate public calls would create separate receipts and transactions, while sequential placement into one Document would invalidate the prepared head after the first Card. The v3 coordinator allocates every identity under one receipt and places all roots into a parent Document in one transfer operation under one lease and outer transaction.

- Observation: Card-only duplication removes transformation branches without weakening the copy kernel.
  Evidence: The Adapter verifies an active owning Card before compilation and rejects any non-preserved authorization evidence. The underlying BlockTransfer request still copies the complete ownership subtree under the same lease/receipt rules, while the v3 result projects only the new Card identity unless the caller explicitly requests the full Block map or ETags.

- Observation: A mixed-source Card move cannot be represented by one existing BlockTransfer command, but it also does not need a new relocation kernel.
  Evidence: The coordinator compiles one exact internal transfer per Card under a single outer SQLite transaction and public receipt. It deduplicates the complete Document lease closure and rebases later internal requests onto Document heads committed earlier in the same transaction; a forced freshness failure in the second transfer rolls the first transfer back.

- Observation: Same-Database movement is a Database placement mutation, not a membership transfer.
  Evidence: Sending the Card through BlockTransfer would detach/reactivate the same membership and blur the deliberate absence of independent property edits. The v3 coordinator instead compiles one typed group-value plus ordered `position_cards` mutation and rejects destination `values` before property lookup.

- Observation: Switching the host catalog alone would make every v3 write fail before authorization.
  Evidence: The renderer request validator accepted only the four v2 write-tool names and the confirmation surface read only `nfmPreview`. The migration now accepts both revision vocabularies, emits only `markdownPreview` for v3, and retains `nfmPreview` solely as a historical read path.

- Observation: A public recovery enum can preserve an obsolete tool name even after the catalog is otherwise coherent.
  Evidence: Internal kernels correctly return `get_block_again`, but that action is impossible in v3. The v3 error Adapter now translates it to `fetch_again` while leaving v2 recovery unchanged.

- Observation: Compact transcript labels are part of the Agent interface's debuggability, not decorative metadata.
  Evidence: V3 projections can show the search phrase, fetch title/format, saved View or Database name, created titles/counts, move destination, and duplicate result identity without expansion; Nested Markdown patches show both sides before Details, while Arguments, output, and exact Raw remain available on demand.

- Observation: A Database query DSL easily wins schema bytes without automatically winning Agent comprehension.
  Evidence: A throwaway parser for `where ...; sort ...; select ...; summary` compiled ten representative scalar, empty, set-membership, date, boolean-group, null-order, and projection cases to the existing AST exactly. Its candidate tool measured 665 bytes versus 2,796 for typed `advanced_query_database` (76.2% smaller), and its arguments totaled 939 versus 1,950 bytes (51.8% smaller). Yet only four of ten plausible SQL/colloquial variants parsed; failures included `ORDER BY`, omitted `where`, `has`, `IS NULL`, `==`, and `filter ... equals`.

- Observation: Code Mode can keep a dynamic-tool pipeline out of the model context, but it cannot currently make a Nodex dynamic-tool result a native JavaScript object.
  Evidence: The pinned `DynamicToolFunctionSpec` publishes only `inputSchema` and `deferLoading`; `DynamicToolCallResponse` publishes only `contentItems` and `success`. The official app-server contract documents the same text/image response. Upstream Codex commit `03bb3b12367397e14a8facc2e018d645ff4d8e83` still maps dynamic tools to `output_schema: None`, converts their response to `FunctionToolOutput`, and the default Code Mode adapter exposes content-item output as a JSON string. MCP has a distinct `structuredContent` path, but dynamic tools do not.

## Decision Log

- Decision: Treat catalog, call, and model-visible workflow context as separate budgets.
  Rationale: Each has a different owner and optimization mechanism. Deferred loading affects catalog visibility, sparse projections affect calls, and Code Mode affects model round trips.
  Date/Author: 2026-07-16 / Codex

- Decision: Measure catalog bytes as the exact UTF-8 JSON sent through the app-server protocol, with an empty-tools namespace envelope for shared bytes and the same namespace filtered to non-deferred tools for eager bytes.
  Rationale: This gives deterministic additive cost centers while keeping complete/eager totals faithful to production serialization. `bytes / 4` is printed only as orientation and is never a test boundary.
  Date/Author: 2026-07-16 / Codex

- Decision: Name the Agent-facing format “Nested Markdown” and use `markdown` rather than `nfm` or `nestedMarkdown` in v3 wire fields.
  Rationale: The full name is self-explanatory in prose; once the namespace defines the dialect, `markdown`, `oldMarkdown`, `newMarkdown`, `format: "markdown"`, and `markdownGuide` are familiar and compact. Historical v2 raw items remain exact but v3 never emits the acronym.
  Date/Author: 2026-07-16 / Codex

- Decision: Put one 200-byte-budget syntax hint in the namespace and keep the complete guide on demand.
  Rationale: Every authoring Agent must know the tab-only nesting rule before its first call, while extensions and edge cases should not tax unrelated search/query turns. The example uses escaped `\n` and `\t` so spaces cannot masquerade as valid nesting.
  Date/Author: 2026-07-16 / Codex

- Decision: Do not reject or reinterpret leading spaces as suspected nesting.
  Rationale: Spaces may be intentional content, and the parser cannot infer author intent reliably. Tabs alone carry Block-nesting meaning; canonical output uses tabs, while leading spaces retain their ordinary authored semantics.
  Date/Author: 2026-07-16 / Codex

- Decision: Rename `get_block` to `fetch` and default fetchable Document content to canonical Nested Markdown.
  Rationale: `search → fetch` is a familiar Agent workflow and a default fetch should be useful without requiring the Agent to discover the v2 `include.document.format=nfm` path. Summary and stable-Block formats remain explicit alternatives.
  Date/Author: 2026-07-16 / Codex

- Decision: Split `query_database_view` from `advanced_query_database` rather than applying a misleading rename.
  Rationale: Saved View execution and ad-hoc filter/sort are distinct intents. The explicit advanced name reduces source-union errors, warns that schema knowledge is required, and lets the common View tool stay small.
  Date/Author: 2026-07-16 / Codex

- Decision: Replace `create` with bounded atomic `create_cards`.
  Rationale: The plural name matches bulk authoring and removes the generic resource discriminator. One to sixteen complete Card drafts share one destination and commit all-or-nothing in input order.
  Date/Author: 2026-07-16 / Codex

- Decision: Replace `edit_document` with `update_card({ cardId, ... })`.
  Rationale: Card is the public aggregate and its Document ID is derived storage topology. The Adapter resolves the owned Document while retaining separate title/body semantic guards.
  Date/Author: 2026-07-16 / Codex

- Decision: Replace `transfer_blocks` with `move_cards` and `duplicate_card`.
  Rationale: They are distinct familiar intents with different cardinality and results. Restricting them to real Cards removes mode, source, promotion, and wrapping choices from the Agent contract.
  Date/Author: 2026-07-16 / Codex

- Decision: Remove `edit_database` from v3 without folding it into `update_card`.
  Rationale: The capability is not yet expressed in user-intent language. Combining it with Nested Markdown authoring would enlarge the common schema and blur Document/Database concurrency; the limitation is documented until a focused successor is designed.
  Date/Author: 2026-07-16 / Codex

- Decision: Keep intent-oriented tool names and add separately deferred `advanced_update_card` instead of one universal mutation tool.
  Rationale: `update_card` should be the obvious default for Nested Markdown authoring. The `advanced_` prefix tells the Agent that stable Block IDs and ETags are required, while preserving distinct loading, authorization, and transcript semantics.
  Date/Author: 2026-07-16 / Codex

- Decision: Use bounded canonical inline Markdown for Agent-facing titles while keeping title as a separate semantic unit.
  Rationale: It removes a 2.6 KiB recursive schema, reuses the language Agents already need, preserves rich title content, and avoids hidden first-heading extraction.
  Date/Author: 2026-07-16 / Codex

- Decision: Limit Agent title Markdown to the lossless canonical title subset: text, styles, links, thread mentions, and date mentions.
  Rationale: Card mentions, attachments, agent configuration, Block syntax, tabs, and line breaks are not representable by the existing title authority. Rejecting them at the Adapter is safer than silently flattening or expanding canonical storage during an Agent API migration.
  Date/Author: 2026-07-16 / Codex

- Decision: Use bounded unique string lists for v3 `return` projections.
  Rationale: The three-selector generated schema is 152 bytes versus 205 for optional booleans, and the two-selector form is 141 versus 175. Calls remain direct (`return: ["markdown", "etags"]`), duplicates reject, and Zod preserves enum typing.
  Date/Author: 2026-07-16 / Codex

- Decision: Remove only transport wrappers and duplicated schema branches; retain `destination`, `title`, `body`, `prepareFor`, `safety`, and `return` as semantic groups while eliminating the old query `source` union.
  Rationale: Schema economy should not detach validators from values or flatten real domain concepts into ambiguous top-level flags.
  Date/Author: 2026-07-16 / Codex

- Decision: Do not include a Database query DSL in the initial v3 contract.
  Rationale: The typed query input is deferred and approximately 3.5 KiB. A custom language requires benchmark evidence for validity and correction behavior, not only a smaller schema.
  Date/Author: 2026-07-16 / Codex

- Decision: Keep distinct `block_update` and `block_delete` fetch preparations in the advanced path.
  Rationale: Updating one Block validates that Block's current semantic state, while deleting it validates the complete subtree. A generic `blocks` preparation would hide which ETag the Agent must send and invite stale-subtree deletion mistakes.
  Date/Author: 2026-07-16 / Codex

- Decision: Preserve the real public update tool in the canonical receipt identity while sharing one Document receipt table and compiler.
  Rationale: `update_card` and `advanced_update_card` are distinct Agent intents and must not collide when a host reuses a call ID, but they require identical deterministic allocation, committed-mutation recovery, semantic guard, and Document Hub behavior. The receipt lookup therefore keys on the public tool and converges immediately into one kernel.
  Date/Author: 2026-07-16 / Codex

- Decision: Model `create_cards` as one aggregate command containing deterministic per-Card genesis commands and one shared prepared destination.
  Rationale: Per-Card commands keep proven canonical creation logic reusable, while the aggregate owns consent, replay, lease closure, input ordering, placement, result projection, and rollback. This preserves a single transaction and receipt without duplicating Card lifecycle or Database kernels.
  Date/Author: 2026-07-16 / Codex

- Decision: Coordinate `move_cards` above BlockTransfer and Database kernels rather than broadening either kernel around Agent batches.
  Rationale: Each kernel keeps its existing exact authority and idempotency contract. The Adapter alone owns mixed-source grouping, one public receipt, all-or-nothing ordering, intermediate Document-head rebasing, and the same-Database placement exception exposed by the Card intent.
  Date/Author: 2026-07-16 / Codex

- Decision: Make revision 3 the sole executable `nodex_app` catalog while preserving revision 2 only as an explicitly named contract/transcript format.
  Rationale: Running old calls against new semantics would be unsafe, and registering both revisions in one launched namespace would defeat task pinning. Historical transcript projection is read-only and can safely recognize both tool lists; a v2 execution request receives `tool_catalog_stale` and starts a new task.
  Date/Author: 2026-07-16 / Codex

- Decision: Name v3 authorization and transcript content `markdownPreview` / `markdownChange`, with a dual-read fallback only at historical rendering boundaries.
  Rationale: This prevents the retired acronym from leaking into new Agent-visible traffic while keeping old task records inspectable. The confirmation and diff surfaces retain one dense, flat composition and do not add a second metadata card.
  Date/Author: 2026-07-16 / Codex

- Decision: Keep the typed `advanced_query_database` contract in v3 and delete the query-DSL prototype after recording its benchmark.
  Rationale: The prototype exceeded the 30% size threshold, preserved stable IDs, rejected ambiguous names with candidates, and never executed SQL, but the narrow canonical corpus did not cover enough plausible grammar variants. A later revision may revisit a DSL only with broader deterministic grammar coverage, concrete user demand, and an on-demand grammar design; saved Views remain a separate `query_database_view` intent.
  Date/Author: 2026-07-16 / Codex

- Decision: Design future Database schema/View configuration around a parsed compact DSL from the start.
  Rationale: That domain is recursive and variant-heavy enough to reproduce the exact cost center behind Notion's 91% two-tool reduction. Ordinary row value writes remain typed JSON.
  Date/Author: 2026-07-16 / Codex

- Decision: Do not add asynchronous local writes or pretend current dynamic tools support structured results.
  Rationale: Neither has current runtime evidence. Add async only after profiling; add structured results only through an actual app-server protocol/router upgrade.
  Date/Author: 2026-07-16 / Codex

- Decision: Retain the v3 JSON-text success/error envelope and make Code Mode examples parse it once at the pipeline boundary.
  Rationale: Native object results require three aligned upstream seams: dynamic-tool `outputSchema` declaration, response `structuredContent`, and a Code Mode adapter that returns the structured value. All three are absent from the pinned dynamic-tool protocol; the latest upstream source confirms the same limitation. Local output schemas remain runtime validators, not advertised protocol fields. Adding ignored fields or a private pseudo-structured envelope would make the contract look safer than the router actually is.
  Date/Author: 2026-07-16 / Codex

## Outcomes & Retrospective

The migration is complete. The production measurement boundary established an honest v2 baseline of 529 namespace bytes, 6,524 eager bytes, and 40,558 complete bytes. The activated v3 interface measures 547 shared namespace bytes, 4,427 eager bytes, and 29,021 complete bytes, with every intent tool below its individual cap. Contract fixtures prove strict flattened calls, opt-in guide loading, title round trips, intentional authored spaces, query separation, Card-only placement intents, sparse outputs, and exact prepared ETags. All ten v3 tools execute through the canonical read/write, receipt, lease, authorization, and Hub boundaries; newly launched tasks are revision 3, retired v2 calls fail explicitly as stale, and both revisions remain readable in transcript Details and Raw. The Database query DSL experiment was rejected despite its byte savings because its grammar-repair risk was not proven acceptable. Structured dynamic results were also rejected for v3 because neither the pinned nor current upstream dynamic-tool protocol exposes the required declaration, response, and Code Mode seams. The public reference is now `docs/references/nested-markdown-spec.md`; internal NFM paths and compatibility identifiers remain intentionally unchanged.

Final validation:

- `pnpm run agent-tools:measure -- --v3` passed with the exact 547 / 4,427 / 29,021 shared/eager/complete byte totals. Per-tool totals were `advanced_query_database` 2,796, `advanced_update_card` 4,889, `create_cards` 4,472, `duplicate_card` 4,245, `fetch` 1,932, `get_context` 461, `move_cards` 4,198, `query_database_view` 983, `search` 1,483, and `update_card` 3,004 bytes.
- `pnpm run typecheck` and `pnpm run lint` passed.
- The initial `pnpm test` passed all 1,215 Node and 1,358 Electron-main assertions, then executed 2,846 renderer assertions successfully but exited nonzero because two unrelated fork workers timed out before starting. The two affected files passed immediately in isolation (26 assertions), and the complete renderer suite then passed with bounded workers: 388 files / 2,872 assertions. `pnpm run test:integration` passed 2 files / 29 assertions. This is treated as an isolated process-capacity flake, not a hidden assertion failure.
- `pnpm run build` passed. Vite printed the pre-existing warning that `browser-sidebar-service.ts` has both static and dynamic importers, so dynamic import cannot create a separate chunk.
- `git diff --check` passed before final commit.

The main remaining product limitation is deliberate: v3 has no independent property-value mutation for an existing same-Database membership. The main upstream limitation is also explicit: dynamic tools still require one JSON parse inside a Code Mode pipeline. Neither gap is hidden behind a compatibility tool or private transport. UI structure was covered by renderer tests and Storybook fixtures; per project guidance, final visual review remains a manual app check rather than an automated browser run.

## Context and Orientation

The current public contract is `nodex_app@2`. `src/shared/nodex-agent-tools/identity.ts` defines the revision and tool names. `base-schemas.ts`, `read-schemas.ts`, and `write-schemas.ts` define strict Zod input/output schemas. `contracts.ts` attaches descriptions, deferred-loading flags, and effect classification. `src/main/codex/nodex-dynamic-tool-registry.ts` registers the namespace; `dynamic-tool-registry.ts` serializes Zod to JSON Schema; `nodex-agent-dynamic-tool-runtime.ts` returns each success or failure as one JSON text item.

The current eager tools are `get_context`, `get_block`, and `search`. `query_database` and all five mutation tools are deferred. V3 renames the read intent to `fetch`, splits out `query_database_view`, renames the ad-hoc branch `advanced_query_database`, adds `advanced_update_card`, replaces generic create/edit/transfer with Card intents, and removes `edit_database`; both query tools and all mutations stay deferred. A new task is pinned to the selected toolset revision through the existing catalog binding/repository path. Execution never hot-swaps the schema of a resumed task.

`src/shared/nfm/agent-guide.ts` contains the current compact opt-in format guide. `src/shared/nfm/parser.ts`, `serializer.ts`, and inline content helpers implement the lossless text/Block boundary. Those internal paths, storage columns, and receipt identifiers may retain `nfm` as implementation vocabulary during v3; mass-renaming them does not help Agent comprehension and would obscure historical raw data. Every v3 Agent-visible schema field, description, error, guide response, transcript label, and product example instead uses Nested Markdown/`markdown`. Card title storage remains portable rich text and is separate from body Nested Markdown. The public v2 `TextInputSchema` exposes both plain text and the full portable rich-text item union to Agents; v3 changes only the Agent Adapter representation, not canonical title storage.

Document writes converge in `src/main/agent-tools/document-edit-service.ts` and the pure compiler under `src/shared/nodex-agent-tools/`. Nested Markdown insert/patch/replace and stable-Block operations already share atomic Document mutation receipts and semantic ETags. Splitting the public tools must not duplicate this kernel, receipt logic, authorization footprint, or final re-resolution.

`create-service.ts` currently performs one atomic aggregate creation. V3 must lift its deterministic allocation, Nested Markdown validation, destination preparation, and outer transaction to a bounded Card batch without exposing partial success. `transfer-service.ts` currently compiles arbitrary same-source roots plus move/copy into `BlockTransferIntent`; v3 replaces that public contract with Card-only move/duplicate Adapters while reusing or deepening the internal transfer kernel. `database-edit-service.ts` remains internal code but has no v3 public dynamic-tool registration.

Transcript presentation lives in `src/renderer/features/local-conversation/projection/tool-metadata/nodex-dynamic-tool-call-presentation.ts`, with Details and Raw in `dynamic-tool-call-inspector.tsx`. v3 must retain readable compact rows for Card batch creation, Nested Markdown updates, stable-Block updates, Card moves, duplication, and query/search while parsing both stored v2 and new v3 items.

In this plan, **Nested Markdown** is Nodex's lossless Markdown-and-tags projection of a Block tree; one literal tab per level expresses Block nesting. **Inline Markdown** is its bounded single-line rich-title subset: text, styles, links, thread mentions, and date mentions are lossless; Card mentions and other Block/attachment/configuration syntax reject. It also rejects tabs and newlines. **Common path** means a schema normally loaded for search/fetch/Card creation/Card update or saved-View query. **Advanced update path** means the separately deferred identity-sensitive stable-Block protocol exposed by `advanced_update_card`. **Catalog core bytes** means the UTF-8 length of the serialized namespace, revision, tool names, descriptions, input schemas, and deferred flags; it does not claim exact model token usage.

## Proposed v3 Interface

The examples below are the target shape. Exact field spelling may change during the measured contract milestone, but any change must preserve the semantic groups and budgets in ADR 0016.

`NODEX_APP_TOOL_NAMESPACE_DESCRIPTION` always includes this shared compact hint before the Code Mode transport guidance:

    Nested Markdown is Markdown with Nodex tags and tab-nested Blocks. Use one literal tab per child level; spaces do not nest. Example string: "▶ Toggle title\n\tChild paragraph\n\t- [ ] Child task".

“Spaces do not nest” describes the structure rule, not an input ban: leading spaces may be intentional content and are not rejected or rewritten. The canonical serializer uses tabs for actual Block ancestry. Agents request the complete grammar only when needed:

    get_context({ include: { markdownGuide: true } })

Discover and fetch content:

    const nodex = async (call) => {
      const result = JSON.parse(await call);
      if (result.error) throw Object.assign(new Error(result.error.message), { result });
      return result.data;
    };
    const found = await nodex(tools.nodex_app__search({ query: "dynamic tools" }));
    const card = await nodex(tools.nodex_app__fetch({ id: found.results[0].id }));

`fetch({ id })` defaults to canonical Nested Markdown for an owning Card or Document subtree, and to the Database/View definition for a Database Block. Callers select `format: "summary"` to save a large read or `format: "blocks"` when stable child identities are required. `maxDepth` and pagination are valid only for the Block representation. Property projection and title/body/Block `prepareFor` requests remain explicit so a default content read does not mint validators.

Query a saved View without a source discriminator:

    query_database_view({
      viewId: "...",
      select: { propertyIds: ["status", "due"] },
      page: { limit: 50 },
    })

An advanced ad-hoc query remains separate and self-labeling:

    advanced_query_database({
      databaseBlockId: "...",
      filter: { ... },
      sort: [{ ... }],
      select: { propertyIds: ["status", "due"] },
      page: { limit: 50 },
    })

The public dynamic identifiers use underscores for direct JavaScript property access. Transcript labels may display `query-database-view`; documentation examples use `tools.nodex_app__query_database_view` and `tools.nodex_app__advanced_query_database`.

Create one or several complete Cards at one shared destination:

    create_cards({
      destination: {
        kind: "database",
        databaseBlockId: "...",
        view: { viewId: "roadmap", groupKey: "Planning" },
      },
      cards: [
        {
          title: "Q3 launch plan",
          markdown: "# Goal\nShip the onboarding redesign.\n\n## Tasks\n- [ ] Confirm scope",
          values: [{ propertyId: "status", value: "Planning" }],
        },
        {
          title: "Release checklist",
          markdown: "- [ ] Tag release\n- [ ] Publish notes",
          values: [{ propertyId: "status", value: "Planning" }],
        },
      ],
      return: ["block_ids"],
    })

`cards` contains one to sixteen drafts. Every title string uses canonical inline Markdown and does not require `{ kind: "plain", text }` or `{ kind: "rich", richText }`. It is not extracted from the first body heading, and each `markdown` string is one complete Card body. Nested Markdown is implicit, so there is no `{ format: "markdown", content }` wrapper. The shared `destination` appears once; per-Card initial Database values stay beside the Card they affect. The server validates the complete batch and aggregate UTF-8 budget, allocates every identity deterministically, and commits all Cards or none. Input order determines sibling order at the shared anchor.

Update a Card through the default Nested Markdown path:

    update_card({
      cardId: "...",
      title: {
        markdown: "Q3 launch plan — ready for review",
        ifMatch: "nxe1....",
      },
      body: {
        kind: "patch",
        patches: [{
          oldMarkdown: "- [ ] Confirm scope",
          newMarkdown: "- [x] Confirm scope",
          expectedMatches: 1,
        }],
      },
      return: ["etags"],
    })

The body variants are:

    { kind: "insert", at, markdown }
    { kind: "patch", patches: [{ oldMarkdown, newMarkdown, expectedMatches? }] }
    { kind: "replace", markdown, ifMatch }

`safety: { allowDeletingOwnedBlocks: true }` remains an explicit destructive acknowledgment when a patch or replacement removes protected ownership.

Use `advanced_update_card` only after reading stable Blocks and only when their identities must be preserved:

    advanced_update_card({
      cardId: "...",
      edits: [
        { kind: "update", blockId: "...", ifMatch: "nxe1....", patch: { ... } },
        { kind: "delete", blockId: "...", ifMatch: "nxe1...." },
      ],
      return: ["block_ids"],
    })

The first v3 design should consider whether Block insert and intra-Card move remain here or are fully covered by Nested Markdown insert and the existing Document kernel. Do not remove them merely to save schema; prove that no identity-preserving workflow is lost. Cross-container non-Card Block transfer is not part of v3.

Move several existing Cards without a generic mode or caller-supplied source:

    move_cards({
      cardIds: ["card-a", "card-b"],
      destination: {
        kind: "database",
        databaseBlockId: "...",
        view: { viewId: "...", groupKey: "Done" },
      },
    })

`move_cards` requires real Card roots and one shared destination. The host reads current locations, rejects duplicate/missing/non-Card identities, groups bounded mixed sources internally, shows every source and the final destination in authorization, and commits the batch all-or-nothing in input order. There is no public `from` field to become stale and no promotion/wrapping result for the Agent to interpret.

When the destination is a different Database, its database branch may include one optional `values` list applied to every new membership in the batch. A same-Database move rejects `values` and changes only View/group/manual placement; it must not become a disguised property-edit endpoint. Agents that need different destination values per Card use separate moves until a focused Card-property intent exists.

Duplicate one complete Card with a distinct intent:

    duplicate_card({
      cardId: "card-a",
      destination: {
        kind: "card",
        cardId: "parent-card",
        at: { kind: "end" },
      },
      return: ["block_map"],
    })

`duplicate_card` copies one complete Card ownership subtree, allocates fresh Card/Block/Document identities, and returns the new root Card ID by default. The detailed identity map is opt-in. It has no `mode`, plural input, or move-only fields.

A Database destination may include `values` for the copied Card's new membership. Duplicating within the same Database copies the source membership values unless explicit initial values are supplied; duplicating across Databases starts from destination defaults plus explicit values and never guesses a property mapping by name.

All three Card placement tools use the same Card-first location vocabulary: `{ kind: "space" }`, `{ kind: "card", cardId, at }`, or `{ kind: "database", databaseBlockId, view? }`. `create_cards` keeps varying values on each draft; move and duplicate may extend the Database destination with values for the new membership as described above. The Adapter resolves a parent Card's owned Document internally; no public destination asks the Agent for a derived `documentId`.

Search keeps the search/fetch split but removes a trivial wrapper:

    search({
      query: "dynamic tools",
      target: "blocks",
      scope: { kind: "card", cardId: "..." },
      blockTypes: ["heading", "paragraph"],
      includeArchived: false,
      page: { limit: 20 },
    })

`blockTypes` is accepted only for Block search. Card-scoped search uses public `cardId`, not a derived Document ID. `page` remains grouped because cursor and limit are one pagination concept. Search results remain excerpts and identities, never complete Nested Markdown or ETags.

Success transport remains JSON text in the current app-server revision. Inner result data is flattened where the tool already supplies the resource kind. A `create_cards` result should resemble:

    {
      "data": {
        "cards": [
          {
            "cardId": "...",
            "location": { "kind": "database", "databaseBlockId": "..." },
            "bodyBlocksCreated": 8
          }
        ],
        "created": 1
      }
    }

The `data` envelope is retained while it is the Code Mode success/error discriminator. It is removed only together with a native structured-result transport, not as an isolated cosmetic v3 change.

## Budget Targets

Milestone 1 must compute exact actual-catalog baselines through a pure serialization seam. The initial acceptance caps for v3 are:

| Budget | Cap |
| --- | ---: |
| Nested Markdown namespace hint | 200 bytes |
| Eager catalog | 5.5 KiB |
| Complete published catalog | 38 KiB |
| `fetch` tool | 2.5 KiB |
| `query_database_view` tool | 2.5 KiB |
| `advanced_query_database` tool | 4.5 KiB |
| `create_cards` tool | 6 KiB |
| `update_card` tool | 4 KiB |
| `move_cards` tool | 5 KiB |
| `duplicate_card` tool | 5 KiB |
| `advanced_update_card` tool | 8 KiB |
| Representative thirteen-row default query result | 4 KiB |
| Default non-batch mutation result excluding caller-requested Nested Markdown | 2 KiB |
| Default `create_cards` result | 512 bytes + 256 bytes per created Card |

The full-catalog cap is secondary to eager and per-selected-tool caps but still detects accidental duplication. If the pure production serializer yields a materially different baseline from the research script, update the numbers and Decision Log before changing schemas; do not tune implementation around a faulty measurement.

Additional behavioral budgets are mandatory:

- the namespace contains exactly one shared Nested Markdown hint and one escaped tab example, but no complete grammar or additional examples;
- default reads contain no ETags;
- v3 Database query results contain no value/placement ETags because no v3 tool consumes them;
- preparing one Card title, body, or stable Block adds exactly one 48-character ETag plus its bounded association fields;
- default writes contain no complete Nested Markdown, internal receipt, revision topology, or raw authorization evidence;
- a Code Mode example emits only a bounded summary even when nested results are large;
- transcript Raw retains the exact canonical arguments and result.

## Plan of Work

### Milestone 0: record the decision and migration plan

Add ADR 0016 and this ExecPlan without changing production behavior. Validate Markdown and commit a documentation-only checkpoint. ADR status remains Proposed until implementation begins or the maintainer explicitly accepts it.

At the end of the milestone, the commit contains only these two files, `git diff --check` passes, and no code tests are necessary.

### Milestone 1: make context cost measurable

Create a pure catalog serialization/measurement seam that accepts the registered namespace and contracts without constructing the Agent service, importing BlockNote, or opening a store. Reuse the exact Zod-to-JSON-Schema conversion used by `DynamicToolRegistry`; do not create a second approximate serializer.

Add a developer command that prints one deterministic table containing namespace bytes, eager bytes, complete bytes, and each tool's description/schema/total bytes. It may also print a labeled tokenizer-independent `bytes / 4` estimate for orientation. Add behavior tests for the caps above against the actual registered catalog. Store caps as named constants with a short rationale, not a brittle full JSON snapshot.

Extend result-budget fixtures through real public output schemas. Preserve the existing thirteen-row query regression, tighten its default cap to 4 KiB, remove value/placement ETags from v3 query projections, add prepared title/body/Block fixtures, and add sparse default results for `create_cards`, `update_card`, `advanced_update_card`, `move_cards`, and `duplicate_card`. Default `fetch` Nested Markdown is exempt from a tiny byte cap because the content is the requested high-value payload, but its metadata overhead must be measured separately. Tests must validate output behavior; they must not assert that source files contain particular strings.

Add a generated-catalog assertion that the namespace contains the exact shared Nested Markdown hint within its 200-byte budget and the serialized eager/deferred tool descriptions and schemas do not duplicate it or embed the complete guide. Exercise `get_context({ include: { markdownGuide: true } })` to prove the full guide remains available only when requested.

At the end of the milestone, running one command explains where Agent context is spent, CI fails on unreviewed catalog/result growth, and v2 behavior is otherwise unchanged. Commit this instrumentation separately so later size improvements have an honest before/after baseline.

### Milestone 2: define the v3 text-first contract

Add a bounded inline Markdown title schema and pure parse/serialize functions near the existing Nested Markdown boundary. The parser accepts plain text, supported inline formatting, links, thread mentions, and date mentions; it rejects Block syntax including Card mentions, tabs/newlines, attachments/configuration, owning Card shells, and overlong titles, and canonicalizes escapes exactly once. Convert the canonical inline tree to the existing portable-rich-title storage type; do not change storage schemas. Add round-trip and boundary tests for plain text, styles, links, date/thread mentions, literal escapes, blank titles, and length limits.

Define one shared compact format hint and one full guide source. `NODEX_APP_TOOL_NAMESPACE_DESCRIPTION` imports the compact hint once; individual tools name Nested Markdown but do not repeat its grammar. Rename the public guide request/response from v2 `nfmGuide` to `markdownGuide`, and expose `format: "markdown"` in the guide response. The full guide leads with the same tab rule and escaped example so eager and on-demand instructions cannot drift.

Replace every v3 Agent-visible format field and selector with `markdown`: `create_cards.cards[].markdown`, `update_card.title.markdown`, body `markdown`, patches `oldMarkdown`/`newMarkdown`, `format: "markdown"`, and `return: ["markdown"]`. No v3 description, schema, error, transcript label, or product example emits `NFM`/`nfm`. Historical v2 raw items remain byte-exact and the transcript projector maps them to the current Nested Markdown presentation without changing Raw.

Keep the existing parser's authored-space behavior. Tabs are the only Block-ancestry signal and canonical serialization emits one tab per level, but the Agent Adapter must neither reject leading spaces merely as “suspected nesting” nor silently rewrite them to tabs. Add round-trip fixtures proving intentional leading spaces survive according to existing format semantics and a tab-nested toggle materializes the expected parent/children.

Advance the public revision to 3 and define the proposed tool list. Rename `get_block` to `fetch`, rename its public `blockId` input to the locally unambiguous `id`, default its content representation to canonical Nested Markdown, flatten representation selection, and retain explicit summary/blocks/property/validator projections.

Split current `query_database` into `query_database_view({ viewId, ... })` and `advanced_query_database({ databaseBlockId, filter?, sort?, ... })`. Share projection, pagination, and result schemas internally without publishing a `source` union. Remove Database value/placement `prepareFor` and ETags because no v3 mutation consumes them.

Define `create_cards({ destination, cards, return? })` with one to sixteen items, canonical inline Markdown title, optional body Nested Markdown, per-item initial values, a shared Card-first destination union, a bounded aggregate UTF-8 limit, deterministic allocation, and all-or-nothing output. Define default `update_card({ cardId, title?, body?, safety?, return? })` for title plus Nested Markdown body insert/patch/replace. Move the existing stable-Block operation schema to separately deferred `advanced_update_card({ cardId, edits, return? })`; its description must instruct callers to fetch stable Blocks first and use it only for identity-sensitive work. Keep one shared effect classifier that derives destructive scope from replacements, protected deletion, and stable-Block deletes.

Replace public `transfer_blocks` with `move_cards({ cardIds, destination, return? })` and `duplicate_card({ cardId, destination, return? })`. Both require Card roots and share a Card-first location schema. `move_cards` has no public `from`, permits a bounded set of current source authorities, preserves input order, and is all-or-nothing. A different-Database destination may initialize one common value set; a same-Database move rejects values. `duplicate_card` is singular, can initialize its new Database membership, and returns the new Card ID by default. Do not expose generic cross-container Block transformation variants or inferred cross-Database property mapping.

Remove `edit_database` from the identity list, contracts, registry handlers, transcript v3 presentation, and public docs. Do not delete the underlying Database kernel or internal service merely to remove the dynamic tool. Flatten search's two mostly duplicated branches, replace public Document scope with Card scope, and retain target-specific validation. Apart from the deliberate `markdownGuide` rename and guide payload, leave `get_context` unchanged unless exact measurement identifies a simple high-value duplication.

Prototype simple list-valued `return` selectors against the current boolean objects. Choose the smaller representation only if calls remain self-explanatory, duplicate entries reject, and output selection is type-safe. Record the measured choice in this plan.

Contract tests must prove strict validation, absence of Agent-visible `nfm` in v3, the exact shared namespace hint, opt-in `markdownGuide`, tab nesting without leading-space rejection, `fetch` defaults and target-sensitive representation rules, saved-View/advanced-query separation, inline-title semantics, one-to-sixteen `create_cards` items, shared destination and aggregate bounds, no stable-Block branch in `update_card`, stable-Block coverage in `advanced_update_card`, Card-only move/duplicate inputs, absence of `from`/`mode`/promotion variants, absence of public `edit_database`, flattened search calls, deferred-loading boundaries, effect classification, v3 pinning, and every catalog budget. Tests must also prove v2 transcript schemas remain readable even though v2 execution is retired.

At the end of the milestone, shared contracts and catalog tests pass and the public v3 interface is stable enough for service migration.

### Milestone 3: adapt services without duplicating kernels

Add one Agent title Adapter that converts inline Markdown to/from portable rich text. Use it consistently in `create_cards` preparation, `fetch` title projection, `update_card` preparation, ETag state construction, sparse results, and transcript previews. Search may continue returning bounded plain-title text for ranking and scanning; full rich round-trip belongs to `fetch`.

Refactor `document-edit-service.ts` so `update_card` resolves the owned Document from `cardId` and `update_card`/`advanced_update_card` enter through thin public adapters that converge before semantic preflight, authorization footprint construction, post-consent re-resolution, deterministic allocation, Document Hub execution, and receipt recovery. Do not fork receipt tables or mutation identities by tool. Exact retry must recover the same committed sparse result before checking current guards.

Update `read-service.ts` and its focused read modules so `fetch` resolves default canonical Nested Markdown by Block kind without creating a second storage query path. Split the existing Database query service at the public Adapter only; `query_database_view` and `advanced_query_database` retain the same snapshot, cursor, and projection semantics while v3 drops unused value/placement ETag planning.

Deepen `create-service.ts` into a bounded batch coordinator. Validate every draft and the shared destination before recording consent, allocate every Card/Document/Block/membership identity deterministically under one dynamic call receipt, acquire the destination lease once, and execute all Card genesis, Nested Markdown bodies, Database memberships/values, and View placements under one outer SQLite transaction. Any invalid Nested Markdown, destination, value, or placement rolls back the entire batch. Replay returns the same ordered sparse result without rerunning successful items.

Replace the public transfer Adapter with Card-only paths. `move_cards` verifies every ID is an active Card, resolves current source authority after consent, groups a bounded mixed-source set into exact internal transfer requests, coordinates all affected Document leases/write fences, and commits the whole move plus destination placements in input order or not at all. `duplicate_card` reuses copy compilation for one Card ownership subtree, preserves deterministic fresh identity allocation, and returns one new Card root plus optional Block map. Promotion, wrapping, mixed-root-type, and caller-supplied-source branches disappear from the v3 schema and preview, even if internal Block transfer code remains reusable.

Remove `edit_database` from dynamic registration and execution dispatch. Keep `database-edit-service.ts` and Database kernels intact for non-Agent callers and future design work. Enforce that same-Database moves cannot smuggle independent value edits, while new memberships can still receive initial values through create, cross-Database move, or duplication. Update search input normalization without changing fuzzy Card search or exact/prefix Block search behavior.

Preserve sparse mutation defaults and typed `prepareFor`. Ensure the new return projection cannot request a partial/truncated writable Nested Markdown. Keep complete post-write Nested Markdown opt-in and only return a fresh value when it corresponds to the committed head; this does not change `fetch`'s default read representation.

Update transcript presentation for `fetch`, `query_database_view`, `advanced_query_database`, `create_cards`, `update_card`, `advanced_update_card`, `move_cards`, and `duplicate_card`. Compact rows show batch counts, titles, source/destination summaries, and new Card identities; Nested Markdown arguments still generate bounded diffs; Details and Raw stay lossless. Historical v2 `create`, `edit_document`, `transfer_blocks`, and `edit_database` items remain readable but are not executable through v3. Renderer tests should cover real projection behavior, not class names or source strings. Add Storybook only if visible inspector structure changes, not for metadata parsing alone.

At the end of the milestone, all ten v3 tools execute through existing authority boundaries, v2 tasks fail explicitly as stale, stored v2 transcript calls remain inspectable, and focused service/registry/renderer tests pass.

### Milestone 4: benchmark, do not assume, a Database query DSL

Build a throwaway pure parser prototype outside the public contract for a small read-only query language. It may borrow familiar SQL concepts, but it must compile to the existing typed filter/sort/select AST and never execute caller SQL against SQLite. Support stable property IDs and unambiguous display names; ambiguous names must return a structured correction with candidates.

Create a benchmark corpus of representative prompts and current Database schemas covering scalar comparisons, empty checks, conjunction/disjunction, multi-select membership, dates, sorting/null order, selected properties, a saved View, and invalid/ambiguous fields. Compare typed JSON and the compact language on:

- published schema bytes and actual argument bytes;
- deterministic parse coverage across canonical and plausible grammar variants;
- semantic equivalence of the compiled AST;
- transcript readability and authorization/debug evidence;
- Code Mode ease of constructing queries from fetched schema.

Adopt the DSL in a later toolset revision only if it reduces the `advanced_query_database` schema by at least 30%, accepts the required grammar corpus without ambiguity, and does not require exposing a large grammar in the eager catalog. Otherwise keep the typed v3 advanced query and record the negative result. Do not block the main v3 migration on this experiment.

For future Database schema and View-definition capabilities, write a separate ADR/ExecPlan before implementation. Start from a parsed configuration DSL and on-demand guide; preserve typed daily values and semantic authorization previews.

### Milestone 5: upgrade structured results only with upstream support

Inspect the pinned `packages/codex-app-server-protocol/src/v2`, generated Codex protocol, app-server documentation, and router implementation at the time of implementation. Determine whether dynamic-tool declarations can publish `outputSchema`, whether completed calls carry `structuredContent`, and whether Code Mode receives the structured value directly.

If all required layers support it, add one feature-gated v4 migration that returns the object natively, drops the JSON parser/data-envelope guidance, and retains a human-readable content fallback for older transcript projections only if the upstream protocol requires it. Update Code Mode examples and raw inspector parsing accordingly.

If any layer lacks support, leave v3's JSON-text transport intact and record the exact missing seam in this plan. Do not hand-edit generated protocol files, add ignored fields, or create an app-private pseudo-structured content type.

### Milestone 6: documentation and handoff validation

Change ADR 0016 to Accepted when the v3 contract begins implementation. Update `ARCHITECTURE.md` with the pure catalog budget boundary, `search → fetch`, saved-View/advanced-query Adapters, batched Card creation coordinator, Card-ID Document Adapter, Card-only move/duplicate Adapters, the absent public Database mutation boundary, and shared kernels. Update the Agent Integration section of `docs/product-specs/nodex-product-spec.md` with the v3 catalog and examples. Rename the public format reference to `docs/references/nested-markdown-spec.md`, update its heading and inbound links, add the inline-title subset and Agent wire vocabulary, and keep the title/body ETag distinction explicit. Internal `src/shared/nfm/*` paths and persisted identifiers remain implementation details unless a separate mechanical rename proves worthwhile.

Update `docs/RELIABILITY.md` only if conditional schema validation or the split adapter changes retry/recovery wording. Update `docs/SECURITY.md` only if the authorization footprint or destructive gate changes. Revise the existing Unreleased Agent-tools changelog entry rather than adding a Changed/Fixed entry for an unreleased replacement.

Run focused checks throughout. For final handoff, run strict typecheck, lint, the standard test suite because v3 crosses shared contracts, main services, registry/task pinning, and renderer transcript projections, and a production build if entrypoints, generated protocol, or bundling changed. Record exact catalog sizes and commands in Outcomes.

At the end of the milestone, docs describe only the shipped interface, the budget report meets the caps or records justified changes, validation is green, and the implementation is committed atomically.

## Concrete Steps

Work from `/Users/asc/repo/nodex`. Before every milestone, run `git status --short --branch` and preserve unrelated user work. Use `rg` before changing public types, use `apply_patch` for manual edits, and use Electron-ABI-aware scripts for main/store tests.

Documentation checkpoint:

    git diff --check
    git diff -- docs/adr/0016-agent-interface-budgets-the-common-path.md docs/plans/nodex-agent-interface-efficiency.md
    git add docs/adr/0016-agent-interface-budgets-the-common-path.md docs/plans/nodex-agent-interface-efficiency.md
    git commit -m "docs(agent-tools): budget the common path" -m "Record the measured Notion MCP lessons, proposed nodex_app@3 interface, and a restartable migration plan before changing production contracts."

Likely contract and pure-helper checks:

    pnpm exec vitest run --config vitest.node.config.ts src/shared/nodex-agent-tools/contracts.test.ts
    pnpm exec vitest run --config vitest.node.config.ts src/shared/nfm/agent-title.test.ts
    pnpm exec vitest run --config vitest.node.config.ts src/shared/nodex-agent-tools/document-edit-compiler.test.ts

Likely main/runtime checks:

    pnpm test:main src/main/codex/dynamic-tool-registry.test.ts src/main/codex/nodex-dynamic-tool-registry.test.ts src/main/codex/nodex-agent-dynamic-tool-runtime.test.ts
    pnpm test:main src/main/agent-tools/read-service.test.ts
    pnpm test:main src/main/agent-tools/create-service.test.ts
    pnpm test:main src/main/agent-tools/document-edit-service.test.ts
    pnpm test:main src/main/agent-tools/transfer-service.test.ts
    pnpm test:main src/main/agent-tools/database-edit-service.test.ts
    pnpm test:main src/main/agent-tools/dynamic-service.test.ts

Likely transcript projection check:

    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/features/local-conversation/projection/tool-metadata/nodex-dynamic-tool-call-presentation.test.ts

Final handoff gates for the expected cross-cutting implementation:

    pnpm run typecheck
    pnpm run lint
    pnpm test
    git diff --check
    git status --short

Run `pnpm run build` when protocol generation, application entrypoints, or bundling changes. If Milestone 5 remains documentation-only because upstream structured results are unavailable, record that a build was unnecessary for that milestone.

## Validation and Acceptance

The implementation is acceptable when all of the following are observable:

1. The generated catalog report uses the actual production serializer and meets the recorded eager, complete, and per-tool byte caps.
2. The namespace contains the exact ≤200-byte Nested Markdown hint once, including an escaped `\n`/`\t` example; individual tool descriptions do not duplicate it, and the full `markdownGuide` appears only when requested.
3. No v3 Agent-visible description, schema, selector, error, transcript label, or product example emits `NFM` or `nfm`. Public content fields use `markdown`, patch fields use `oldMarkdown`/`newMarkdown`, and historical v2 Raw remains exact.
4. One literal tab per level produces the expected nested Block tree and canonical serialization. Intentional leading spaces are neither rejected merely as suspected nesting nor rewritten into tabs.
5. `search → fetch` succeeds with one intuitive follow-up call; default fetch returns canonical Nested Markdown, and explicit summary/blocks projections remain bounded and correct.
6. `query_database_view` accepts only a saved View and `advanced_query_database` accepts only ad-hoc Database query intent; neither requires an irrelevant source union or returns unused mutation ETags.
7. A plain or rich inline Markdown title round-trips through `create_cards`, fetch, ETag preparation, `update_card`, and transcript without losing formatting or mentions, and no public title input requires `kind: plain|rich`.
8. `create_cards` accepts one to sixteen complete drafts for one Card-first destination, preserves input order, deterministically replays its ordered result, and rolls back every Card when any Nested Markdown, value, or placement fails.
9. `update_card` accepts `cardId` and exposes no derived `documentId`; its schema contains no stable-Block operation tree, while `advanced_update_card({ cardId, ... })` preserves all supported identity-sensitive operations and kernel guarantees.
10. Exact Nested Markdown patches can survive unrelated concurrent edits, whole replacement rejects a stale body ETag, title replacement rejects a stale title ETag, and stable-Block delete guards the full subtree.
11. `move_cards` accepts only active Card roots, has no `mode` or caller-supplied `from`, resolves a bounded mixed-source set, preserves input order, previews every source, and commits all moves or none.
12. `duplicate_card` accepts one Card, copies its complete ownership subtree with fresh identities, returns the new Card ID by default, and returns a detailed identity map only when requested.
13. `edit_database` is absent from v3 registration and schemas. New Database memberships can still receive initial values and `move_cards` can change View placement, but an independent same-Database value edit fails as unsupported rather than routing through a hidden fallback.
14. Default search/query/read outputs remain validator-free; prepared Card reads return only requested title/body/Block ETags; default writes return no complete document. Default `fetch` Nested Markdown is counted as requested content rather than low-value overhead.
15. A Code Mode pipeline can search, filter, narrowly fetch/prepare, create/update/move/duplicate, and expose only a bounded summary without any durable workflow object.
16. Transcript compact rows, Nested Markdown diffs, Details, and exact Raw work for every v3 tool and still render historical v2 items including retired `edit_database` calls.
17. A retired v2 execution binding fails with a structured stale-catalog recovery rather than silently running v3 semantics.

## Idempotence and Recovery

Catalog measurement and schema generation are read-only and deterministic. Re-running them must not change generated files unless an explicit report artifact is part of the chosen implementation.

Inline-title parsing happens before mutation preparation. Invalid input returns a bounded argument error and allocates no durable identity. `create_cards` records deterministic Card/Document/Block/membership allocations for the complete ordered batch under one dynamic call receipt; retries recover the canonical committed result and never skip or re-run individual items.

Splitting `update_card` and `advanced_update_card` does not create new canonical Document receipt namespaces. A dynamic call's tool name remains part of its call identity, but both adapters use the same canonical Document mutation receipt and replay-before-guard ordering. Never retry a rejected kernel receipt under a different semantic command with the same mutation ID.

`move_cards` records one ordered public call receipt and deterministic internal operation identities for every resolved source group. A retry returns the committed aggregate result before re-reading current locations. `duplicate_card` retains deterministic fresh identity allocation and canonical copy receipt recovery. A partially committed source group is never exposed as success; the coordinator uses one outer transaction or fails before mutation when all required authority cannot participate atomically.

If the v3 migration is interrupted after contracts but before all services compile, revert or finish within the feature branch before committing; do not expose a half-registered catalog. Because new tasks are revision-pinned, switching the active binding to v3 is the final rollout step after all handlers and tests pass.

The Database query DSL prototype is non-authoritative and read-only. It must live outside the registered catalog until accepted. Deleting the prototype must leave no migration or compatibility obligation.

Structured-result work is capability-gated. If upstream support is absent, the recovery action is to retain the tested JSON-text transport, update this plan with the missing seam, and stop that milestone without speculative protocol fields.

## Artifacts and Notes

Official sources consulted on 2026-07-16:

- [Notion MCP supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Notion API changelog](https://developers.notion.com/page/changelog)
- [Working with Markdown content](https://developers.notion.com/guides/data-apis/working-with-markdown-content)
- [Enhanced Markdown format](https://developers.notion.com/guides/data-apis/enhanced-markdown)
- [CommonMark tabs](https://spec.commonmark.org/spec#tabs)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server/)
- Local clone of `https://github.com/makenotion/notion-mcp-server.git` at `d7e3bbd62890f9efca2cd54449ac072f3bd1a4ba`
- Local clone of `https://github.com/openai/codex.git` at `03bb3b12367397e14a8facc2e018d645ff4d8e83`

Research measurements used Zod's Draft 7 JSON Schema conversion over `NODEX_AGENT_TOOL_CONTRACTS`, plus namespace/tool metadata matching the registry's published shape. The first production milestone must replace this research script with a pure seam around the exact production serializer.

No Notion field names or SQL dialect are compatibility requirements for Nodex. The durable lessons are intent-local tools, text-native bulk authoring, semantic search-and-replace, on-demand grammar, parsed DSLs for recursive schema domains, and explicit context budgets.

Revision note (2026-07-16): Initial plan written from current `nodex_app@2`, official Notion MCP/Markdown and CommonMark documentation, the public local-server source boundary, measured catalog/result sizes, and isolated alternative schema prototypes. Refined the same day around intent clarity: adopt `fetch`, name the public format Nested Markdown with compact `markdown` fields and a tab-explicit namespace example, preserve intentional leading spaces, use direct title strings, split saved-View query from `advanced_query_database`, replace generic create/edit/transfer with `create_cards`, `update_card`, `advanced_update_card`, `move_cards`, and `duplicate_card`, and remove public `edit_database`. Implementation then added the pure budget gate, title-safe inline Markdown, complete v3 contract and Card-first Adapters, atomic Card creation/move/duplicate coordinators, runtime activation, stale-v2 recovery, authorization/transcript projections, a negative query-DSL benchmark, a negative structured-result capability gate, source-of-truth documentation, and final validation.
