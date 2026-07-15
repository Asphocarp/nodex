# Remove Card reference snapshots and add identity-keyed target freshness

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while implementation proceeds. It follows `docs/PLANS.md` and is intentionally self-contained so another contributor can resume from this file and the working tree.

## Purpose / Big Picture

After this change, a Card reference stores only the target Card Block identity. Renaming, formatting, or clearing the target title changes no host Document and leaves no stale title in canonical NFM. Collapsed references still render cheaply from the membership-independent exact-head Card content summary. When any Card target changes, only queries for that identity refresh, including Cards nested in Documents with no Database membership.

The visible behavior is straightforward: insert `@Card A`, rename Card A elsewhere, and the collapsed mention updates in every open window. Clear the title and it displays `Untitled`, never the insertion-time name. Inspecting NFM shows `<card-ref target-block="..." />`. A different mounted Card reference in the same Project does not refetch because Card A changed.

## Progress

- [x] (2026-07-15 05:40Z) Read `ARCHITECTURE.md`, `docs/PLANS.md`, ADR 0007/0010, the NFM/BlockNote adapters, Card target reader, writer fanout, notifier, SSE/IPC transports, and renderer query subscription hub.
- [x] (2026-07-15 05:55Z) Confirmed from current TanStack Query documentation that an exact query key can be invalidated and active observers refetch, while cache mutation should be reserved for complete validated data.
- [x] (2026-07-15 06:20Z) Recorded the identity-only storage, durable Yjs cleanup, and `card-target-changed` event decision in ADR 0011.
- [x] (2026-07-15 06:20Z) Created this complete migration ExecPlan before production-code edits.
- [x] (2026-07-15 06:55Z) Removed Card title hints from canonical NFM, writable BlockNote schemas, adapters, insertion/transfer/migration paths, derived reference records, and renderer fallback behavior.
- [x] (2026-07-15 07:20Z) Added the resumable v59-to-v60 store migration that deletes existing `displayHint` attributes through the Document update writer and proves fixed-point/idempotent behavior.
- [x] (2026-07-15 07:45Z) Added the typed membership-independent Card target event through worker capture, main notifier, Electron IPC, browser SSE, and renderer transport.
- [x] (2026-07-15 07:50Z) Published target events after content, lifecycle, location, and target-visible metadata commits while keeping optional board fanout separate.
- [x] (2026-07-15 08:05Z) Replaced project-wide Card target query refresh with target-ID dispatch and exact query-key invalidation; retained deleted-target subscriptions.
- [x] (2026-07-15 08:25Z) Added focused canonicalization, Yjs cleanup, schema/store, worker transport, Project hub, browser multiplexing, and empty-title behavior regressions.
- [x] (2026-07-15 08:35Z) Updated architecture, product, reliability, changelog, ADR 0007, ADR 0011, and this living plan.
- [x] (2026-07-15 08:55Z) Passed targeted tests, strict typecheck, lint, and all unit/main/renderer/integration gates; reviewed the migration and event diff.
- [x] (2026-07-15 09:05Z) Committed the complete change as `refactor(cards): make references identity-only` with an explanatory body.

## Surprises & Discoveries

- Observation: An available target with a current empty title still displays the stale hint.
  Evidence: `cardOutlinerPlainTitle` returns `target.card.content?.title.trim() || target.fallbackTitle`, and `fallbackTitle` is derived from the stored `displayHint`.

- Observation: The current renderer discards `BoardChangeEvent.cardId` before dispatch and refreshes every distinct Card target query in the Project.
  Evidence: `project-board-change-subscription-hub.ts` accepts a zero-argument Project listener and schedules one callback for every consumer key on every board event.

- Observation: The canonical Card target reader is already membership-independent, but its notification path is not.
  Evidence: `card-targets.ts` reads `CardContentSummary` directly from Block/Document authority; `block-mutation-worker.ts` instead calls `readCardDocumentBoardProjection`, which requires an active Database row before emitting `board-changed`.

- Observation: Deleted Card targets carry `projectId`, but the renderer subscribes only for the `available` branch.
  Evidence: `useCardTargetReadModel` computes `targetProjectId` only when `query.data?.status === "available"`.

- Observation: `displayHint` lives in Y.XmlElement attributes, not a relational column. Removing TypeScript fields alone would leave stale CRDT data and historical current-head materializations.
  Evidence: foreign-reference migration creates `Y.XmlElement("cardRef")` and calls `setAttribute("displayHint", ...)`; the BlockNote schema maps the same prop into Yjs XML.

- Observation: Card references can occur in multiple registered block-tree Document kinds, so cleanup must scan block-tree Documents rather than only owner type `card`.
  Evidence: Card reference codecs and derived-reference projection are shared by Card, Synced Block, and Reusable Template adapters, subject to each owner's content restrictions.

- Observation: The unit gate depends on an ignored research manifest that is present in the primary checkout but absent from a fresh worktree.
  Evidence: the first full unit run passed 1129 of 1130 tests and failed only with `ENOENT` for `.generated/research/thread-tool-activity-26.707.30751-payload-corpus-manifest.json`; restoring that generated fixture made all 1130 unit tests pass without source changes.

- Observation: A backup-service unit fixture hard-coded schema v59 and correctly failed the new v60 restore-journal check.
  Evidence: changing the fake validator to return `CURRENT_SCHEMA_VERSION` preserved the mismatch guard and made the focused backup test plus all 1244 main tests pass.

## Decision Log

- Decision: Remove hints from both non-owning `cardRef` and owning `card` shells, but leave `databaseViewRef` and `templateRef` unchanged.
  Rationale: Both Card shells resolve the same Card title authority and exhibit the same stale-copy problem. Other reference kinds have separate product/read contracts and should not be changed incidentally.
  Date/Author: 2026-07-15 / Codex with user approval of the recommended architecture.

- Decision: Keep current Document schema coordinates and use SQLite `user_version` as the cleanup migration ledger.
  Rationale: The deprecated value is a shared presentation prop, not a new root or content model. A durable Yjs deletion update plus rebuilt projections makes current heads canonical while preserving historical replay.
  Date/Author: 2026-07-15 / Codex.

- Decision: Introduce `card-target-changed`, not `card-content-changed`.
  Rationale: `CardTargetReadModel` also contains lifecycle, location, Project, readiness, and Document coordinates. A target-level invalidation event truthfully covers every reason that read model becomes stale and fixes deleted-to-restored behavior.
  Date/Author: 2026-07-15 / Codex.

- Decision: Include `metadata` alongside content, lifecycle, and location change kinds.
  Rationale: `CardTargetReadModel` exposes `metadataRevision`; intrinsic Block-property changes must keep the full read model fresh without pretending the change is content or lifecycle.
  Date/Author: 2026-07-15 / Codex during implementation.

- Decision: Send invalidation coordinates, not a summary payload.
  Rationale: The validated target reader remains the sole read boundary. Events stay small and do not acquire partial-projection ordering or compatibility obligations.
  Date/Author: 2026-07-15 / Codex.

- Decision: Use exact TanStack Query invalidation behind a target-ID subscription hub.
  Rationale: This refreshes active observers, preserves request deduplication, avoids creating incomplete cache entries, and prevents unrelated target queries from refetching.
  Date/Author: 2026-07-15 / Codex, based on current TanStack Query documentation.

## Outcomes & Retrospective

The implementation and commit are complete. Canonical Card references and child shells no longer contain title snapshots. The v59-to-v60 migration removes old XML attributes by appending normal validated Yjs updates, preserves identities/generations/history, rebuilds projections, and performs zero writes at its clean fixed point. Card target invalidations now cross the worker boundary independently of Database summaries and dispatch by exact target identity over the existing Project IPC/SSE transport.

Final automated validation passed: 189 unit files / 1130 tests, 168 Electron-main files / 1244 tests, 378 renderer files / 2811 tests, and 2 integration files / 29 tests, plus strict TypeScript and ESLint. No browser/UI automation was run because repository guidance assigns final visual verification to the user; the manual two-surface rename/clear check remains the handoff step.

## Context and Orientation

`src/shared/nfm/types.ts`, `parser.ts`, and `serializer.ts` define the agent/import/export representation. `src/shared/block-documents/nfm-blocknote-adapter.ts` converts between NFM blocks and BlockNote blocks. `blocknote-schema-config.ts` defines writable props used by both the headless main-process schema and renderer schema. `derived-records.ts` turns canonical materializations into reference projections.

`card` and `cardRef` render through `src/renderer/components/kanban/editor/card-outliner-block.tsx`. The DOM-neutral resolver in `src/renderer/lib/card-outliner-target.ts` currently accepts `displayHint`. `src/renderer/lib/block-reference-queries.ts` reads `CardTargetReadModel` with query key `queryKeys.cardTargets.byId(requestingProjectId, targetBlockId)` and currently drives freshness from `project-board-change-subscription-hub.ts`.

The canonical reader is `src/main/local-store/card-targets.ts`. It joins the Card Block and owned Document, then calls the membership-independent exact-head `readCardContentSummary`. Document updates commit in the dedicated block mutation worker through `BlockDocumentRuntime.applyUpdate` or the strict document-operation kernels. The worker currently captures only local `board-changed` events and returns them to `BlockMutationWriter`, which republishes them on the main-process `dbNotifier`. Main runtime broadcasts notifier events over Electron IPC; `/api/projects/:projectId/events` multiplexes them over browser SSE.

The data cleanup should be a new local-store module, for example `card-reference-hint-finalization.ts`. It can load ready primary Yjs block-tree Documents using existing store readers, walk `Y.XmlFragment("body")`, remove only `displayHint` from `cardRef` and `card` content elements, encode the delta against the pre-edit state vector, and call the existing `applyBlockDocumentUpdate` boundary with a deterministic migration client/update identity. It must not write `document_materializations`, reference tables, head sequences, or snapshots directly.

## Plan of Work

First remove the field from canonical write and render paths. Change `NfmCardRef` and `NfmCard` so current canonical values have no hint. The parser should accept and discard historical attributes; the serializer must never emit them. Update the NFM/BlockNote Adapter and writable Block configs so `cardRef` contains only the canonical target and temporary legacy locator fields still required by the shipped import, while `card` has no title-like prop. Stop mention insertion, Card shell creation, transfer/clone, and foreign-reference conversion from constructing hints. Derived Card block references must not project a hint. Keep database/template hint logic intact.

Make unavailable outliner copy a pure function of target state. Remove `displayHint` from `CardOutlinerTargetInput`, its fallback helper, and the Card render props. Loading, missing, deleted, invalid, and error states receive stable product copy. Available current empty titles become `Untitled`. Update behavioral tests to prove a cleared authoritative title cannot revive historical text; do not add source-string or Tailwind assertions.

Then implement the data migration. Add a pure Yjs helper that removes Card hint attributes and returns the affected Block IDs/count. Test nested blocks, unrelated attributes, database/template hints, and a clean second run. Add a store finalizer that queries registered ready primary Yjs block-tree Documents, loads each exact head, computes a minimal update, and commits it through `applyBlockDocumentUpdate`. Use the current generation/head/store epoch and touched Block IDs; choose a deterministic update/client namespace that cannot collide with renderer updates. Advance SQLite schema 59 to 60 only after the fixed point completes. Extend migration target calculation, fresh-store setup, shipped v58 chain, backup validation assumptions, and schema tests. Prove that head sequence and materialization advance, IDs/generation remain stable, canonical NFM/reference projections lose the hint, and retry is a no-op.

Next define `CardTargetChangedEvent` in shared transport types. The payload should contain `projectId`, `targetBlockId`, `changeKind`, and optional committed Document coordinates for content changes. Add a notifier method and event name. Extend worker response protocol so target events captured inside the worker cross the thread boundary beside board events; do not infer target events in the main thread from board events.

Add one membership-independent helper that maps a Document ID to its owner Card target coordinate without reading Database membership. After any committed Card Document update/mutation/restore/additional-document/relocation path, publish a content target event even if `readCardDocumentBoardProjection` returns null. If a board projection exists, continue publishing the board event separately. Absence of a row is expected, not an error. Lifecycle operations emit lifecycle events, and location/Project transfer operations emit location events. For a Project transfer, capture/publish both old and new scopes so a query subscribed to the old target Project refetches and can resubscribe to the new one. Exact duplicate command receipts emit no second semantic event.

Wire the event through `IpcEvents`, Electron bridge/transport, main window broadcast, project SSE, the browser Project stream union/parser, and `RendererTransport`. Preserve one browser EventSource per Project. Add a Card target subscription hub keyed by Project plus target Block ID. It should coalesce multiple observers of the same query but dispatch no callbacks for a different identity.

Update `useCardTargetReadModel` to subscribe for both available and deleted models. On a matching event, invalidate exactly its TanStack query key with `{ exact: true }`; do not update cache from the incomplete event payload. Keep `refetchOnWindowFocus` as recovery for missed/reconnected events. Database View reference reads remain on board refresh. Delete Card-target usage from the project-wide board hub if no other consumer needs it.

Finally update ADR 0007's obsolete statement that hints remain, the product spec's NFM/realtime sections, `ARCHITECTURE.md` event/dependency map, and `docs/RELIABILITY.md` missed-event/recovery contract. Add a changelog entry only if the final behavior is release-note-worthy; this change likely qualifies because stale Card references and cross-window freshness are user-visible.

## Concrete Steps

All commands run from `/Users/asc/.codex/worktrees/2ee1/nodex`.

Use focused tests while changing each boundary. Discover exact adjacent test names before adding new files. Expected commands include:

    pnpm exec vitest run --config vitest.shared.config.ts src/shared/block-documents/reference-codec.test.ts
    node scripts/run-vitest-in-electron.mjs --config vitest.main.config.ts src/main/local-store/card-reference-hint-finalization.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/lib/project-card-target-change-subscription-hub.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/components/block-documents/reference-block-surfaces.test.tsx

If config names differ, use the ones declared in `package.json` and record the actual commands here. After the edit set stabilizes, run the required independent handoff gates:

    pnpm run typecheck
    pnpm run lint
    pnpm test

No React `act(...)` warnings or relevant ignored errors are acceptable. Review `git diff --check`, `git status --short`, and the final diff before committing with a conventional subject and explanatory body.

## Validation and Acceptance

Automated acceptance requires these behaviors:

1. New canonical `cardRef` NFM and BlockNote state contain `targetBlockId` but no title snapshot; a `card` shell contains no title snapshot.
2. Historical `<card-ref ... display-hint="Old" />` and `<card display-hint="Old" />` parse successfully and serialize without the attribute. Database View and Template hint behavior is unchanged.
3. The migration commits deletion attributes through the Document writer, advances affected heads/materializations, preserves Block/Document IDs and generations, and reaches a no-op fixed point on rerun.
4. An available Card with an empty authoritative title renders `Untitled`; loading/missing/deleted/error states do not display an old title.
5. A committed title/body update for a zero-membership Card emits one `card-target-changed` event and no required board event.
6. A Database-member Card content update emits the target event plus existing board summary behavior.
7. Duplicate mutation receipts emit no duplicate target event.
8. Lifecycle and Project/location transitions invalidate a mounted target, including deleted-to-restored and old-to-new Project subscription changes.
9. Browser SSE and Electron IPC carry equivalent typed events.
10. A target A event invalidates/refetches target A's exact query and does not invoke target B consumers in the same Project; multiple A observers coalesce.
11. Existing Database View realtime behavior remains intact.

Manual acceptance is small and belongs to the user per repository guidance. Run the app with two windows or one Electron window and browser client. Reference one Database-member Card and one nested zero-membership Card. Rename and clear each title from another surface; confirm collapsed references update without remounting and the empty title becomes `Untitled`. Inspect/export NFM to confirm identity-only Card references. The user should also verify a Database View reference still refreshes normally.

## Idempotence and Recovery

The migration is deliberately resumable. It never edits CRDT tables or projections directly. Each affected Document receives a normal committed update with a deterministic migration namespace. If startup stops after some Documents commit, their current heads are already valid; the next run skips clean Documents and continues. SQLite `user_version` remains 59 until every eligible current head is clean, then advances to 60. A clean rerun performs zero Document writes.

Do not rotate generations, rebuild Y.Docs from NFM, or delete historical updates/snapshots. Do not preserve `displayHint` in a compatibility write path. If an old test fixture needs the historical shape, construct the Y.Xml attribute directly or use a clearly named historical parser fixture so production types stay canonical.

Event delivery is best-effort after durable commit. A notification failure never turns a committed writer ACK into failure. Renderer focus refetch and normal SSE reconnect remain repair paths. Since event payloads are invalidations rather than authority, duplicate delivery is harmless and missed delivery is repaired by later canonical reads.

## Artifacts and Notes

The old problematic representation is:

    <card-ref target-block="019f5658-cac0-73e0-bfe2-f1e5199a91f5" display-hint="to-be-test-card-ref" />

The target representation is:

    <card-ref target-block="019f5658-cac0-73e0-bfe2-f1e5199a91f5" />

The old freshness chain is:

    Card Document commit
      -> require Database-row CardSummary
      -> board-changed(Project)
      -> refresh every Card target query in Project

The target chain is:

    Card Document commit
      -> resolve owner Card identity independent of Database
      -> card-target-changed(Project, targetBlockId)
      -> invalidate exact cardTargets(requestingProjectId, targetBlockId)

Board fanout remains a parallel optional projection path for Database rows.

## Interfaces and Dependencies

The shared event should be equivalent to:

    interface CardTargetChangedEvent {
      projectId: string;
      targetBlockId: string;
      changeKind: "content" | "lifecycle" | "location" | "metadata";
      document?: {
        id: string;
        generation: number;
        headSeq: number;
      };
    }

The final type may flatten Document coordinates if that better matches existing event conventions, but it must keep Project scope, target identity, and change kind mandatory. It must not carry a `CardSummary`, Database status, or copied title.

The finalizer's pure helper should accept a `Y.XmlFragment` and return affected stable Block IDs or a count. The store wrapper owns loading, state-vector/delta encoding, and the `applyBlockDocumentUpdate` call. Reuse `loadPrimaryBlockDocument`, `applyBlockDocumentUpdate`, and existing materialization/projection validation; do not invent a second persistence path.

Revision note, 2026-07-15: Initial plan created after ADR 0011 and before production-code edits. It incorporates codebase tracing, current TanStack Query documentation, the membership-independent reader boundary, the worker/main notification boundary, and a resumable Yjs cleanup strategy.

Revision note, 2026-07-15: Updated after implementation. The final event also covers target-visible metadata revisions, store schema v60 is the cleanup ledger, all focused and full automated gates passed, and the only test-environment repair was restoring an ignored generated research manifest already present in the primary checkout.
