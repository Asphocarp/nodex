# Make Card history a restorable Document revision timeline

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this file in accordance with `docs/PLANS.md`.

## Purpose / Big Picture

After this work, opening Card History shows the exact title and body retained at each meaningful editing checkpoint in the existing read-only NFM editor. A user can select an earlier revision and restore its title and body as a new forward change. Human typing, Agent/API edits, named checkpoints, and restores all produce coherent revisions, while property and movement activity remains available without duplicating content events.

The architectural result is a Document Revision module, not a revived Card snapshot system. Live Card content remains an Owned Document; Yjs remains the live BlockTree synchronization authority; NFM remains a projection; Canvas remains scene-native; and restore continues through semantic forward operations.

## Progress

- [x] (2026-07-15 20:34Z) Read the architecture, domain, frontend, product, reliability, history, editor, schema, writer, and migration sources and mapped current checkpoint, compaction, restore, Card history, and read-only NFM behavior.
- [x] (2026-07-15 20:34Z) Compared active/idle automatic version cadence, grouped revision presentation, named checkpoints, and forward-restore practices against the current local-first constraints.
- [x] (2026-07-15 20:42Z) Accepted and recorded the semantic Document Revision decision in ADR 0014 before implementation.
- [x] (2026-07-15 21:15Z) Added schema v67, immutable revision metadata, `block_tree_snapshot_v2`, durable revision sessions, and a byte-preserving v66 migration.
- [x] (2026-07-15 21:15Z) Added pre-burst safety, ten-minute active, two-minute idle, startup/periodic maintenance, and forced shutdown finalization through the mutation writer.
- [x] (2026-07-15 21:15Z) Added linked strict-operation revisions, outer Additional Document command capture, and pinned before/after restore revisions for BlockTree and Canvas.
- [x] (2026-07-15 21:15Z) Collapsed linked content evidence into one Card history entry and upgraded the overlay to Current/Revisions/Activity with selected read-only NFM previews and forward restore.
- [x] (2026-07-15 21:15Z) Added deterministic tiered retention plus migration, store, transport, projection, renderer, scheduler, and command-boundary tests and Storybook revision states.
- [x] (2026-07-15 21:38Z) Updated the architecture, domain, reliability, product-spec, release-note, ADR, and living-plan sources of truth.
- [x] (2026-07-15 21:38Z) Passed the targeted suites, four Electron runtime probes, full standard test gate, typecheck, lint, and Electron build; fixed composite-transaction and tombstone-retention regressions found by the broad gate.
- [x] (2026-07-15 21:40Z) Prepared the complete implementation, migration, documentation, and validation record for the final conventional commit.

## Surprises & Discoveries

- Observation: ordinary renderer/Yjs writes commit update receipts, update blobs, current authority, and projections, but do not append either `document_versions` or `change_log`.
  Evidence: `applyBlockDocumentUpdateForAuthority` in `src/main/local-store/block-document-store.ts` advances the Document head and projections without calling the history stores.

- Observation: operational update compaction deliberately removes old update blobs and snapshots while retaining receipts, so an old head is not guaranteed to remain reconstructable.
  Evidence: `compactBlockDocument` in `src/main/local-store/block-document-store.ts` treats those rows as synchronization recovery data, not user revision authority.

- Observation: strict semantic edits already persist immutable mutation and change-log evidence in the same transaction, but Card history renders that evidence separately from optional Document checkpoints.
  Evidence: `src/main/local-store/block-document-operations.ts` persists the mutation ledger, while `src/main/local-store/card-history.ts` independently merges `change_log` and `document_versions`.

- Observation: the existing History overlay already has the correct large-preview/timeline composition and a full-schema read-only NFM editor; the missing capability is durable revision coverage and a revision-first view model.
  Evidence: `src/renderer/components/kanban/history-panel.tsx` loads `DocumentVersionDetail` only for `document_version` entries and renders `ReadonlyNfmBlockNotePreview`.

- Observation: current Yjs checkpoints contain the complete causal state, whose size can reflect historical edits rather than only effective semantic content.
  Evidence: `createDocumentVersionCheckpoint` calls `Y.encodeStateAsUpdate` for every BlockTree checkpoint.

- Observation: the worker already serializes all Document mutations and the main runtime already owns periodic maintenance schedulers and bounded shutdown sequencing.
  Evidence: `src/main/block-mutation-writer.ts`, `src/main/block-retention-maintenance-scheduler.ts`, and `src/main/main-runtime.ts` provide the existing seams for revision maintenance.

- Observation: nested Additional Document operations cannot snapshot a newly staged owner from the inner Document-operation savepoint because ownership is not readable until the outer command finishes staging every registry row.
  Evidence: post-operation capture inside `block-document-operations.ts` failed the promoted Synced source's owner validation; capture succeeds after `executeDomainMutation` returns within the same outer transaction.

- Observation: the Card Stage read model intentionally contains no body, so the History overlay cannot truthfully source Current content from Card projection props.
  Evidence: `CardStageCoreCard` exposes title and metadata only; the mounted `BlockDocumentSurfaceRuntime.document` is the authoritative live source.

- Observation: Block transfers have the same staged-authority constraint as Additional Document commands even when an individual nested Document batch does not create a new owner.
  Evidence: a source-host removal is temporarily inconsistent with the old Block parent until the outer transfer updates topology; post-ledger capture succeeds only after final ownership and locations are authoritative.

- Observation: tombstone collection previously treated every checkpoint owned by a deleted Document as immediately prunable.
  Evidence: the broad main suite showed a fresh v2 operation revision being deleted outside its retention tier; collection now shares the revision retention planner and is blocked by any retained or pinned revision.

## Decision Log

- Decision: Extend `document_versions` into the sole immutable Document Revision ledger instead of adding a Card-specific snapshot table.
  Rationale: Document identity, Project scope, schema coordinates, preview, and forward restore already live at this boundary; a second Card authority would recreate the legacy split model.
  Date/Author: 2026-07-16 / Codex and user.

- Decision: New BlockTree revisions use a canonical semantic materialization payload, while historical Yjs and current Canvas checkpoint formats remain readable.
  Rationale: semantic payload size tracks effective content and preserves stable IDs/rich title; retaining readers avoids rewriting immutable evidence and respects Canvas's separate sync engine.
  Date/Author: 2026-07-16 / Codex and user.

- Decision: Human edits use pre-burst safety, ten-minute active, two-minute idle, and shutdown finalization rather than one revision per Yjs update.
  Rationale: this gives useful restore granularity and crash recovery without turning keystrokes into an unbounded history ledger.
  Date/Author: 2026-07-16 / Codex and user.

- Decision: Persist dirty revision sessions beside Document authority and run finalization through the one mutation worker.
  Rationale: in-memory timers alone lose intent on crash; renderer-created snapshots race acknowledged writes; durable sessions let startup and shutdown converge safely.
  Date/Author: 2026-07-16 / Codex.

- Decision: Link revisions to strict mutation/change identities and project one content entry.
  Rationale: users need the edit and its resulting content as one event, while the immutable ledgers may remain normalized for audit and recovery.
  Date/Author: 2026-07-16 / Codex and user.

- Decision: Retain pinned revisions indefinitely and tier only unpinned automatic/operation history.
  Rationale: explicit user intent and restore safety must outrank storage compaction; deterministic hourly/daily tiers keep long-range recovery useful.
  Date/Author: 2026-07-16 / Codex.

- Decision: Keep the shipped physical `full_update_blob` and `state_vector` column names in v67 while discriminating their meaning through `checkpoint_format`.
  Rationale: Canvas and shipped-version import paths already share this immutable storage seam; renaming columns would broaden the migration without improving the domain contract. New semantic snapshots require an empty state vector.
  Date/Author: 2026-07-16 / Codex.

- Decision: Store only the minimum semantic v2 payload and rederive all presentation projections when reading a revision.
  Rationale: persisting NFM/plain text/reference projections would duplicate derived data inside immutable history and allow them to drift from the registered schema adapter.
  Date/Author: 2026-07-16 / Codex.

- Decision: Defer staged Synced/Template/Canvas operation capture to the Additional Document command's outer transaction.
  Rationale: the outer command is the first boundary where all new owners and affected heads are simultaneously valid; it can create one linked revision per surviving Document without weakening transaction atomicity.
  Date/Author: 2026-07-16 / Codex.

- Decision: Persist Card Stage before opening History and derive Current title/body from its mounted Y.Doc.
  Rationale: a Card read model is not content authority, and restore must save the same committed state that the user sees as Current.
  Date/Author: 2026-07-16 / Codex.

- Decision: Composite Block transfers suppress nested automatic revision capture and append one linked revision per final affected Document after the outer mutation ledger is durable.
  Rationale: only the outer transaction sees stable ownership, final heads, and the public operation identity; migration-only repairs explicitly suppress their nested post-state revision.
  Date/Author: 2026-07-16 / Codex.

- Decision: Deleted-Block collection may remove Document revisions only when the same 7/30/90-day and 500-row planner selects every revision owned by the candidate Document.
  Rationale: GC cannot bypass named/pinned recovery intent or shorten content-history retention merely because the current Block is a tombstone.
  Date/Author: 2026-07-16 / Codex.

## Outcomes & Retrospective

Completed as one Document-level vertical slice. Schema v67 preserves legacy checkpoint bytes while adding semantic revision metadata and durable edit sessions. New BlockTree revisions retain minimal canonical stable-ID content, human writes converge through safety/active/idle checkpoints, strict/composite operations link their post-state to immutable evidence, and restore pins both sides of one forward mutation. Card History now separates Current, restorable Revisions, and non-restorable Activity and renders selected title/body content through the existing read-only NFM editor.

The final implementation deliberately defaults to `Current` rather than the plan's early `Revisions` wording. This gives the preview a truthful live anchor sourced from the persisted mounted Y.Doc, while the adjacent revision list remains the primary navigation. Composite Additional Document and BlockTransfer commands also capture at their outer ledger boundary rather than inside nested Document savepoints, an implementation refinement required by staged ownership invariants.

Validation passed: focused Node, main/Electron, renderer, scheduler, migration, retention, history, and command tests; runtime probes for Document versions, Card history, and both Additional Document paths; `pnpm test` (1182 Node, 1332 main, 2858 renderer, and 29 integration tests); `pnpm run typecheck`; `pnpm run lint`; and `pnpm run build`. The build emitted only the existing `browser-sidebar-service.ts` mixed dynamic/static import chunking warning. Per repository policy, final desktop/narrow visual review remains a user check rather than an automated Playwright pass.

## Context and Orientation

Nodex is a local-first Electron application. A Card is a document-bearing Block. Its BlockNote-backed title and body are authoritative in a per-Card Y.Doc, persisted through `documents`, `document_updates`, `document_snapshots`, and relational projections. Canvas is also an Owned Document, but uses a normalized scene-native engine.

`src/main/local-store/document-versions.ts` owns immutable revision creation, listing, detail decoding, and forward-restore preparation. `src/shared/block-documents/document-history.ts` defines its public contracts. Legacy BlockTree checkpoints are complete Yjs updates; new revisions are semantic BlockTree snapshots; Canvas checkpoints are canonical scene JSON. `src/main/local-store/block-document-operations.ts` compiles strict edits and restores into semantic operations and stores immutable mutation/change evidence. `src/main/local-store/card-history.ts` merges revision and change rows into the Card-facing history contract in `src/shared/card-history.ts`.

Renderer Yjs updates enter `src/main/document-sync-runtime.ts`, pass through `src/main/block-mutation-writer.ts` and `src/main/block-mutation-worker.ts`, and commit in `applyBlockDocumentUpdateForAuthority` in `src/main/local-store/block-document-store.ts`. This writer/store boundary is where human-edit revision session state must advance. The mutation worker is also the only safe process for idle and shutdown finalization.

`src/renderer/components/kanban/history-panel.tsx` is the current overlay. It already has one large preview surface and a compact right timeline. `src/renderer/components/kanban/editor/readonly-nfm-blocknote-preview.tsx` is the reusable read-only editor and supports the same Block schema, links, mentions, and managed assets as other NFM preview surfaces.

A revision is an immutable restorable semantic checkpoint. A revision session is mutable bookkeeping saying that a live Document head has changed and still needs an automatic final checkpoint. A safety revision is the pre-edit head retained at the beginning of a new burst. A pinned revision is exempt from retention. A linked revision references the mutation/change evidence whose resulting content it contains.

## Plan of Work

First, introduce the shared revision vocabulary and schema v67. Extend Document version contracts with `revisionKind`, `sourceMutationId`, `sourceChangeSeq`, and `pinned`. Rebuild `document_versions` with format-discriminated checkpoint bytes, optional causal state vector, `block_tree_snapshot_v2`, and guarded metadata. Preserve existing rows byte-for-byte while classifying old `before_restore` checkpoints as pinned restore revisions and other old explicit checkpoints as pinned manual revisions. Add `document_revision_sessions`, keyed by Document and generation, with burst start, last edit, last automatic checkpoint, dirty head, and client session fields. Update fresh-schema creation, reset order, release migration chain, backup validation assumptions, and migration tests.

Second, keep the semantic codec beside the immutable revision store, where registered schema inspection, content hashing, identity, insertion, and exact-retry validation already meet. BlockTree writes use `block_tree_snapshot_v2`; Canvas uses scene JSON. Decoding validates hash, schema, kind, bounded canonical JSON, rich title, and BlockTree, then rederives presentation projections through a disposable registered Document. Historical Yjs decoding remains isolated behind the historical adapter.

Third, add automatic human-edit capture. Before applying the first accepted primary renderer update in a new burst, inspect the already loaded current Document and append a safety revision if that generation/head has no revision. After the successful authority/projection write, update the revision session in the same transaction. If ten minutes have elapsed since the last automatic checkpoint, append the accepted post-update materialization immediately. Duplicate, no-op, rejected, migration, strict, and legacy-shadow updates do not use this path.

Fourth, add a revision-maintenance command and scheduler. The store selects bounded dirty sessions. A normal pass finalizes heads idle for at least two minutes; a forced pass finalizes every dirty head. It rechecks store epoch, generation, readiness, and head inside the writer transaction, creates an automatic revision, clears dirty state, and applies retention. The main runtime starts the scheduler after database readiness, disposes its timers on shutdown, forces one final pass after renderer flush and before writer shutdown, and reports failures without converting acknowledged edits into failures.

Fifth, deepen strict command capture. After a non-duplicate strict mutation ledger is persisted, create an operation revision at the committed head with its mutation ID and change sequence. Restore keeps the existing pre-restore checkpoint but marks it pinned/linked and creates a pinned post-restore revision. Apply equivalent before/after behavior to Canvas restore. Exact mutation retries reuse the linked revision and never add another Card history entry.

Sixth, update Card history projection. Query revision linkage metadata. Exclude a change-log content row when a linked revision is in scope and emit the revision entry with content category, command display metadata, and restore recovery. Pagination must remain stable across the normalized ledgers; tests must cover a linked pair split around page boundaries, legacy unlinked rows, property/location events, generation changes, and malformed evidence. Add enough revision metadata to render named, automatic, operation, safety, and restore rows without exposing raw hashes as primary UI.

Seventh, revise the History overlay. Default to the synthetic `Current` row sourced from the live descriptor/materialization, group historical revisions by calendar date, and retain an `Activity` filter for property/database/lifecycle/location evidence. Load or instantiate only the selected read-only NFM preview. Show title, body, checkpoint label/cause, actor, and time; hide byte size/hash/schema from the default surface. Rename the action to `Restore title & body` and explain in confirmation that Nodex saves the current state first and applies a forward change. Update focused renderer tests and Storybook stories for current, automatic, named, Agent edit, empty, loading, error, generation-unrestorable, and confirmation states.

Eighth, implement deterministic retention as a pure selection helper plus store deletion. Preserve all pinned revisions. For unpinned rows, keep all under 7 days, newest per UTC hour from 7–30 days, newest per UTC day from 30–90 days, none older than 90 days, and at most the newest 500 selected rows. Run pruning after maintenance/finalization and manual/operation checkpoints, with tests around exact boundaries and pinned exceptions.

Finally, update `CONTEXT.md`, `ARCHITECTURE.md`, `docs/PRODUCT_SENSE.md` if the user-facing framing needs it, `docs/RELIABILITY.md`, `docs/product-specs/nodex-product-spec.md`, and `CHANGELOG.md`. Remove obsolete history wording and record schema/version ownership. Run targeted suites throughout, then typecheck, lint, the relevant Node/main/renderer/integration suites, and broader tests warranted by the final diff. Commit the finished vertical slice with a conventional subject and explanatory body.

## Concrete Steps

Run commands from `/Users/asc/repo/nodex2`.

After creating ADR 0014 and this plan, inspect the diff before changing source:

    git diff -- docs/adr/0014-document-revision-history.md docs/plans/document-revision-history.md

During schema and store work, run focused main-process tests through the Electron ABI wrapper:

    pnpm test:main src/main/local-store/schema.test.ts
    pnpm test:main src/main/local-store/document-revisions.test.ts
    pnpm test:main src/main/local-store/block-document-operations.test.ts
    pnpm test:main src/main/local-store/card-history.test.ts

Run pure shared tests with the Node configuration and renderer tests with jsdom:

    pnpm exec vitest run --config vitest.node.config.ts src/shared/block-documents/document-revision-retention.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/components/kanban/history-panel.test.tsx

Run scheduler/writer/transport tests nearest their changed runtime. Once the edit set is stable, run at minimum:

    pnpm run typecheck
    pnpm run lint
    pnpm test

Run `pnpm test:integration` for the changed worker/transport path. Run `pnpm run build` only if application entrypoints or bundling fail or change materially. Record every command and outcome in `Progress` and `Outcomes & Retrospective`.

## Validation and Acceptance

Create a Card, type continuously, and inspect the database/history after the two-minute idle boundary. The timeline must contain the pre-burst safety state and the final title/body state, not one row per keystroke. Simulated time tests must show another automatic checkpoint during a burst that crosses ten minutes. Duplicate update replay and rejected/no-op updates must not add revisions.

Perform one strict NFM or block operation. Card history must show one content entry whose preview is the exact resulting title/body and whose restore action is available. Its linked mutation row remains queryable as immutable evidence but is not duplicated in the default timeline. Retrying the same mutation must return the same revision.

Restore an older revision after making new edits. The confirmation must state that current content will be saved. After restore, history must contain a pinned pre-restore state and a pinned restored state. The live Y.Doc head must advance; later history must remain; restoring the pre-restore revision must recover the content that existed immediately before the first restore.

Restart after committing an edit but before the idle timer fires. The durable revision session must survive. A startup maintenance pass must finalize the dirty current head. A forced shutdown pass must do the same after renderer flush. Revision-maintenance failure must be logged and retried later without invalidating the original durable edit acknowledgement.

Inspect old `yjs_update_v1` and Canvas `canvas_scene_json_v1` fixtures after v67 migration. Their checkpoint hashes and bytes must be unchanged, details must preview, and forward restore must still compile. New BlockTree checkpoints must be `block_tree_snapshot_v2` and must restore stable Block IDs and rich title without reading NFM as authority.

Retention boundary tests must prove pinned rows survive all ages, every recent row survives seven days, hourly/daily representatives are deterministic, rows older than ninety days are removed, and the unpinned cap cannot remove a pinned revision.

The user performs final visual verification, per repository policy: inspect desktop and narrow layouts, keyboard timeline navigation, date grouping, long titles, empty documents, dark/light themes, and read-only special Block rendering.

## Idempotence and Recovery

Schema v67 migration runs in one immediate transaction. It creates the replacement table and triggers, copies every old checkpoint byte-for-byte, validates row counts, hashes, format metadata, and foreign keys, then drops the old table and publishes `user_version = 67`. Any failure leaves v66 unchanged. Re-running database initialization after success is a no-op.

Revision append is content-addressed and source-addressed. Exact retry returns the first immutable row. Reuse of an identity with different content or linkage fails closed. Session maintenance rechecks Document generation/head and may safely retry; a revision already covering the dirty head clears the session without inserting another row.

If a Document generation changes, its old versions remain immutable history but are not restorable to the new generation. The session row is replaced or removed at the generation boundary. If a timer or process exits before finalization, `dirty_head_seq` remains and startup maintenance resumes.

Retention is deterministic and idempotent. Applying it twice selects the same survivors. It operates only on unpinned version IDs selected in the current transaction and can be retried after interruption.

No destructive Git reset or checkout is permitted. Preserve unrelated user changes. Keep this plan updated after every milestone so another contributor can resume from the last checked item and its recorded commands.

## Artifacts and Notes

The pre-implementation behavior is intentionally preserved as historical context:

    renderer update -> durable Yjs head/projections -> no user revision
    strict mutation -> durable change_log evidence -> no guaranteed content revision
    explicit checkpoint -> full Yjs state -> preview + forward restore

The target behavior is:

    renderer update -> durable head + dirty revision session
                    -> safety / active / idle semantic revision

    strict mutation -> durable change evidence + linked semantic revision

    restore request -> pinned current revision -> forward mutation
                    -> pinned restored revision

The active interval is ten minutes, the idle interval is two minutes, recent retention is seven days, hourly retention ends at thirty days, daily retention ends at ninety days, and the unpinned cap is five hundred revisions per Document. These values are named constants and pure-policy test inputs, not scattered literals.

## Interfaces and Dependencies

`src/shared/block-documents/document-history.ts` will define `DocumentRevisionKind`, checkpoint metadata for `block_tree_snapshot_v2`, revision linkage, and detail/summary fields. Existing version/restore contract names may remain for transport compatibility, but code and UI language should use “revision” unless referring to an old format.

A shared or main-local revision codec must accept only a validated `RegisteredOwnedDocumentMaterialization`. It canonicalizes portable JSON and returns checkpoint bytes plus format metadata. Its decoder must return the same materialization shape consumed by `DocumentVersionDetail`. Restoration continues through `compileBlockTreeReplacementOperations` and rich-title semantic comparison.

`document_revision_sessions` is internal mutable scheduling state. It is not exposed through IPC or renderer APIs. Its store functions receive explicit `now` values for deterministic tests and use early guards for generation, readiness, duplicate, and no-op cases.

The maintenance request/result contract is bounded and worker-safe. It includes contract version, store epoch, canonical `now`, force flag, and maximum Documents. Results report scanned, finalized, already-covered, stale, pruned, and failed counts. The main scheduler depends only on the writer interface and epoch reader, following the existing retention scheduler pattern.

Card history remains transport-agnostic in the renderer. The renderer calls `history-panel-deps.ts`/`api.ts`; it never imports the worker, SQLite, Yjs checkpoint decoder, or retention/session code. `ReadonlyNfmBlockNotePreview` remains the sole selected BlockTree revision renderer.

Revision note: created 2026-07-16 after codebase exploration, source-of-truth documentation review, official collaboration/version-history research, and user acceptance of the proposed architecture. It is the implementation contract for this migration.
