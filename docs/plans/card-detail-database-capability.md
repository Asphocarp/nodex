# Make Card Stage independent from Database membership

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This file follows `docs/PLANS.md` and must remain self-contained enough for a new contributor to resume the implementation from this file and the current working tree alone.

## Purpose / Big Picture

After this work, a user can expand a Card inside another Card, click Open Card, and receive a normal Card tab editing the same rich title and body. The Card does not need to belong to a Database. If it does belong to a Database, Card Stage also presents that Database's status and seeded properties. If it does not, those controls are absent instead of being fabricated or causing the tab to fail.

The visible proof is the Card currently represented by Block `019f5b2b-db66-746c-8d7c-4cd84ebaf3f3` in the development store: it is active, Document-parented, owns a ready Y.Doc, and has only a dormant historical Database membership. Before this change, Open Card reports “is not an active Database row.” After this change, the tab mounts its owned Document and remains editable. A normal Kanban Card continues to show and mutate its Database properties.

## Progress

- [x] (2026-07-13 17:11Z) Traced Open Card from `CardOutlinerBlock` through `CardStageSessionTab`, `useCardDetail`, `card:get`, and `readDatabaseCardById`.
- [x] (2026-07-13 17:11Z) Proved from the development SQLite store that the failing Card and exact-head Document projection are healthy and that only its Database membership is inactive.
- [x] (2026-07-13 17:11Z) Recorded the membership-independent Card Detail decision in `docs/adr/0010-card-detail-and-database-capability.md`.
- [x] (2026-07-13 18:05Z) Defined and validated the shared versioned `CardDetail` transport contract and pure Card Stage semantic projection.
- [x] (2026-07-13 18:05Z) Implemented the one-transaction main-process Card Detail reader with typed not-found/corrupt-state outcomes.
- [x] (2026-07-13 18:05Z) Switched Electron IPC and browser HTTP `card:get` to `CardDetail`; introduced explicit `database-row:get` and `database-rows:details:get` compatibility commands.
- [x] (2026-07-13 18:05Z) Replaced Card Stage's Database-row cache dependency with a Card Detail external store keyed by Project/Card identity and authority freshness.
- [x] (2026-07-13 18:05Z) Composed Card Stage from always-available core/intrinsic behavior and membership-gated Database behavior.
- [x] (2026-07-13 18:05Z) Corrected post-mutation canonical reads, followed cross-window membership invalidations, and prevented nested Card actions from entering Database-only lifecycle paths.
- [x] (2026-07-13 18:05Z) Renamed the old wide-row cache/read/batch seams to Database-row terminology and deleted the unused legacy thread Card fetch helper.
- [x] (2026-07-13 18:05Z) Added contract, main-store, renderer-store, transport, standalone mutation, Card Stage, and Workbench Open Card regressions.
- [x] (2026-07-13 18:05Z) Updated `CONTEXT.md`, `ARCHITECTURE.md`, `docs/ENGINEERING_LEARNINGS.md`, the product specification, changelog, ADR, and this living plan.
- [x] (2026-07-13 18:22Z) Ran final `pnpm run typecheck`, `pnpm run lint`, and `pnpm test`; all gates passed without ignored warnings.
- [x] (2026-07-13 18:24Z) Reviewed and committed the complete change as `fix(cards): open Card Stage without database membership`.

## Surprises & Discoveries

- Observation: The outliner button already sends the correct target Card Block ID and Project. The failure is downstream, not an identity mix-up in `card` versus `cardRef`.
  Evidence: `src/renderer/components/kanban/editor/card-outliner-block.tsx` calls `host.openCard` with `target.card.blockId`.

- Observation: The development Card is active, has `location_kind = document`, owns a ready Card@2 Document, and has `head_seq = projected_seq = 279`. Its only membership row has `removed_at` set.
  Evidence: read-only queries against `/Users/asc/.nodex/dev/nodex.db` reproduce the exact error while the membership-independent target resolver succeeds.

- Observation: The repository already documents the desired invariant, so this is implementation drift rather than a new product decision.
  Evidence: `docs/adr/0007-card-outliner-independent-document-surface.md` says `CardSummary` must not open a nested Card; `ARCHITECTURE.md` says a Space- or Document-parented Card remains valid outside Database Views.

- Observation: The generic metadata snapshot reader already returns every intrinsic coordinate when membership is absent and only appends Database coordinates when membership exists. This is a reusable authority primitive, but it does not include the full Card/Document detail or membership revision.
  Evidence: `src/main/local-store/card-metadata-property-snapshot.ts` builds intrinsic fields before its optional membership branch.

- Observation: Directly running a main-process Vitest file under Node loads the Electron-built `better-sqlite3` binary with the wrong ABI. This is a test-runner boundary, not a Card Detail failure.
  Evidence: `node scripts/run-vitest-in-electron.mjs --config vitest.main.config.ts src/main/local-store/card-detail.test.ts` passes the exact regression under the supported Electron runner.

- Observation: Card Detail must follow coarse Database invalidation even while currently standalone, because a transfer event identifies affected Databases but not every Card newly entering one.
  Evidence: `useCardDetail` refetches a mounted standalone Card on a newer project-scoped `database-changed` sequence, while a member can filter unrelated Database IDs.

## Decision Log

- Decision: Preserve Card as the sole user-facing Page-like concept; do not add a `Page` type, table, or renderer.
  Rationale: Card is already the document-bearing Block alias accepted by ADR 0001, and another entity would duplicate identity.
  Date/Author: 2026-07-14 / Codex with user approval.

- Decision: Make `databaseContext` a discriminated optional capability on `CardDetail`, not optional loose fields on the wide `Card` type.
  Rationale: A discriminant prevents callers from treating missing Database values as empty authoritative values and makes capability checks exhaustive in TypeScript.
  Date/Author: 2026-07-14 / Codex with user approval.

- Decision: Keep board-specific row projection temporarily, but move it behind explicitly named readers/transports.
  Rationale: Board, calendar, and scheduler still need seeded relational fields. An explicit boundary allows this vertical slice to correct Card identity without preserving the misleading `card:get` semantics.
  Date/Author: 2026-07-14 / Codex.

- Decision: Hide Database-only Card Stage sections for standalone/nested Cards rather than render disabled defaults.
  Rationale: A control without a Database property coordinate has no truthful value or write target.
  Date/Author: 2026-07-14 / Codex with user approval.

- Decision: Do not expose Kanban delete or occurrence actions for nested Cards until a location-aware atomic lifecycle command exists.
  Rationale: Routing a Document child through a Database lifecycle path is another authority violation and can orphan its shell or owned Document.
  Date/Author: 2026-07-14 / Codex.

- Decision: Preserve old CLI/board/calendar wide-row behavior behind the explicit HTTP `database-row` seam instead of preserving ambiguous `card:get` semantics.
  Rationale: The versioned Card Detail contract must remain the canonical Card-opening boundary; compatibility consumers can migrate independently without weakening it.
  Date/Author: 2026-07-14 / Codex.

## Outcomes & Retrospective

The vertical slice is implemented and validated. A Document-parented Card now resolves through Card Detail, mounts the same owned Y.Doc in Card Stage, keeps intrinsic Agent/run mutations, and receives no synthetic Database status or lifecycle actions. Database-member Cards preserve current compatibility properties and commands through explicit Database-row seams. The optional Database capability uses a stable wrapper with a disabled Kanban subscription while standalone, so a later membership transition changes props without remounting Card Stage or its provider.

Final validation passed: TypeScript strict checks, ESLint, 147 unit files / 854 tests, 137 Electron-main files / 914 tests, 356 renderer files / 2,567 tests, and 2 integration files / 29 tests. No browser automation was run because repository guidance assigns the final visual and live two-surface collaboration review to the user. The implementation, tests, docs, and this completed plan were committed together.

## Context and Orientation

Nodex stores every Card as a Block in SQLite. A document-bearing Block owns one independent Document whose rich title and body are synchronized with Yjs. The SQLite `blocks.location_kind` plus its containing coordinate expresses the Card's exclusive parent: a Space, another Document, or a Database. `database_memberships` and `database_view_positions` exist only for the Database-parented case.

`src/main/local-store/database-query.ts` already exposes `CardContentSummary`, a membership-independent exact-head projection containing Block location and owned Document coordinates. `src/main/local-store/card-targets.ts` adds Document readiness/schema and is used by embedded `card` and `cardRef` surfaces. `src/main/local-store/card-metadata-property-snapshot.ts` captures intrinsic Block properties for every active Card plus Database property coordinates when an active membership exists.

The incompatible path begins in `src/renderer/components/workbench/workbench-shell.tsx`. `CardStageSessionTab` reads the current Kanban summary and calls `src/renderer/lib/card-detail-store.ts`, whose single fetch invokes `card:get`. The IPC handler in `src/main/ipc-handlers.ts` and HTTP route in `src/main/http-server.ts` call `src/main/local-store/cards.ts#getCard`, which calls `readDatabaseCardById` in `src/main/local-store/card-read-store.ts`. That reader deliberately rejects a Card without active membership or primary View position.

The wide `Card` interface in `src/shared/types.ts` combines rich content projections, intrinsic execution properties, Database properties, status, and View order. It remains useful only as a Database-row compatibility projection. Card Stage currently consumes it through `src/renderer/components/kanban/card-stage/types.ts` and `use-card-stage-controller.ts`, so the renderer must receive a smaller membership-independent stage model derived from `CardDetail`.

## Plan of Work

First create `src/shared/card-detail.ts`. Define a versioned JSON-safe `CardDetail` whose `card` field is `CardContentSummary` restricted to an active or archived Card, whose `document` field includes readiness/schema, whose `properties` field includes the exact `CardMetadataPropertySnapshot`, and whose `databaseContext` is either `{ kind: "standalone" }` or `{ kind: "member", membership, values }`. Add a strict parser that rejects scope mismatches, mismatched Document coordinates, missing intrinsic fields, duplicate semantic fields, invalid membership/database coordinates, and Database coordinates in the standalone branch. Add pure helpers that expose typed semantic intrinsic and Database values for Card Stage without making projections authoritative.

Then create `src/main/local-store/card-detail.ts`. In one deferred SQLite transaction, validate Project/Card identity and lifecycle, call the existing membership-independent content/materialization reader, read Document readiness/schema, capture property coordinates, and read at most one active membership with its revision. Cross-check `blocks.location_kind`: a Database context must agree with `containing_database_id`, while a Space/Document Card must not have an active membership. Return null only when the Card does not exist in the requested Project. Throw a typed corruption error for incomplete owned Document authority, ambiguous membership, mismatched parent, or malformed properties.

Change `card:get` in `src/main/ipc-handlers.ts` and `/api/projects/:projectId/card` in `src/main/http-server.ts` to return the validated Card Detail contract. The HTTP route must distinguish missing with 404 from corrupt/unavailable with a typed non-200 response, and `src/renderer/lib/browser-renderer-transport.ts` must not turn arbitrary non-OK replies into null. Add `database-row:get` for the compatibility `Card` reader, use it in metadata/lifecycle runtimes that still need a row, and rename the batch seam to `database-rows:details:get` so its Database-row scope is explicit.

Refactor the renderer cache. Rename the current wide-Card external store and its public functions to Database-row terminology for `useKanban`. Build a small Card Detail store for Card Stage with request deduplication and freshness based on `metadataRevision`, `locationRevision`, Document generation/head sequence, and membership revision. Card Stage must not pass board status/revision as the fetch coordinate or treat absence from `cardIndex` as missing.

Define a `CardStageCard` view model in the Card Stage boundary. It always contains Card identity, title projection, intrinsic properties, and a `database` discriminated union. Convert JSON date strings to renderer Dates only inside this pure boundary. Update `CardStageProps` and `useCardStageController`: intrinsic Agent/run handlers remain enabled for standalone Cards; status, priority, estimate, tags, assignee, date scheduling, recurrence occurrence actions, and move callbacks exist only for the member branch. Render `CardStageInlinePropertyStrip` and Database rows inside `CardStagePropertiesSection` only when the branch is `member`. Keep threads, Agent state, and run-target rows available for all Cards.

Correct mutation ownership. Card Stage intrinsic updates continue through the Block property kernel and refresh `CardDetail`; Database updates use exact Database coordinates and refresh both detail and row caches. The board continues to use explicit Database-row canonical reads. Card Stage must hide Database lifecycle actions on standalone/nested Cards until a location-aware deletion command is implemented; do not silently call Kanban delete.

Finally rename or delete obsolete ambiguous functions, update architecture/product/engineering documentation, and add meaningful tests. Store tests seed both a Database member and a Document-parented Card with a dormant membership. Transport tests prove IPC/HTTP parity and typed errors. Renderer tests prove opening the nested Card reaches `CardStage`, Database controls are absent, and an ordinary row still has its controls. Pure helper tests prove semantic coordinate decoding and malformed-contract rejection.

## Concrete Steps

All commands run from `/Users/asc/repo/nodex2`.

During implementation, run the nearest focused tests after each boundary. Expected commands include:

    node scripts/run-vitest-in-electron.mjs --config vitest.main.config.ts src/main/local-store/card-detail.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/lib/card-detail-renderer-transport.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/lib/card-detail-store.test.tsx
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/components/workbench/workbench-shell.test.tsx

Discover the exact Vitest config names from `package.json` and existing adjacent tests before running them; adjust the commands in this section if the repository uses a different config filename.

After the final edit set is stable, run these independent handoff gates:

    pnpm run typecheck
    pnpm run lint
    pnpm test

The final repository must have no relevant failures or React `act(...)` warnings. Record concise output evidence in `Surprises & Discoveries` or `Outcomes & Retrospective`.

## Validation and Acceptance

Automated acceptance requires all of the following behavior:

1. A Document-parented active Card with a ready exact-head Document and no active membership returns `CardDetail` with `databaseContext.kind === "standalone"`.
2. A Database-parented Card returns the same core identity/Document fields plus `databaseContext.kind === "member"` and correct membership/property revisions.
3. `readDatabaseCardById` still rejects a non-row when deliberately invoked by a board consumer; `card:get` does not call it.
4. Electron IPC and browser HTTP produce equivalent validated Card Detail data and distinguish missing from corrupt state.
5. Card Stage opens the nested Card, mounts its owned Document ID/generation, and does not render status, priority, estimate, tags, assignee, or date controls.
6. Card Stage for a Database row still renders and mutates those controls.
7. Intrinsic Agent/run property mutation succeeds for a standalone Card and its canonical refresh does not require membership.
8. A Database-only mutation cannot be compiled or invoked without a member context.
9. Membership context changes do not change the owned Document descriptor passed to `BlockDocumentSurface`.

Manual acceptance is intentionally small. Start the development app, open the parent of `019f5b2b-db66-746c-8d7c-4cd84ebaf3f3`, expand the embedded Card, and click Open Card. The new tab must display the same rich title/body without a load error. Edit in the embedded surface and tab to verify both surfaces converge. Then open an ordinary Kanban Card and verify its Database properties remain present. Per repository guidance, the user performs this final UI review.

## Idempotence and Recovery

This change does not alter the SQLite schema or existing data. Readers are additive before call sites switch, so failed implementation attempts can be resumed safely. Do not edit or reactivate membership rows in the development store. If a renderer refactor is incomplete, keep the type checker failing rather than adding synthetic defaults. If transport changes temporarily break a compatibility consumer, point that consumer at the explicit `database-row:get` seam rather than reverting `card:get` to ambiguous semantics.

No Y.Doc is rebuilt or migrated. The Document descriptor returned by Card Detail is a read coordinate only; the existing provider performs the normal state-vector handshake.

## Artifacts and Notes

The original failure text is:

    CardReadStoreError: Card 019f5b2b-db66-746c-8d7c-4cd84ebaf3f3 is not an active Database row

The relevant old call chain is:

    CardOutlinerBlock.onOpenCard
      -> CardStageSessionTab
      -> useCardDetail
      -> card:get
      -> cardsStore.getCard
      -> readDatabaseCardById
      -> requireDatabaseRowCard

The target call chain is:

    CardOutlinerBlock.onOpenCard
      -> CardStageSessionTab
      -> useCardDetail
      -> card:get
      -> readCardDetail
      -> Block + owned Document + intrinsic properties + optional Database context

## Interfaces and Dependencies

`src/shared/card-detail.ts` must export a contract equivalent to:

    interface CardDetail {
      version: 1;
      card: CardContentSummary & { lifecycle: "active" | "archived" };
      document: {
        readiness: "pending_genesis" | "ready" | "failed";
        schemaKey: string;
        schemaVersion: number;
      };
      properties: CardMetadataPropertySnapshot;
      databaseContext:
        | { kind: "standalone" }
        | {
            kind: "member";
            membership: {
              id: string;
              databaseBlockId: string;
              revision: number;
            };
          };
    }

The precise final shape may add bounded Database descriptor/value data, but it must preserve this discriminant and exact authority coordinates. Use existing `PortableRichText`, `CardContentSummary`, `CardMetadataPropertySnapshot`, and owned-Document descriptors. Do not create a second content codec, a renderer-only authority fetch, or a Page abstraction.

Revision note, 2026-07-14: Initial plan created after reproducing the embedded Open Card failure and accepting ADR 0010. It records the approved architecture and implementation sequence before any production code changes.

Revision note, 2026-07-14: Updated after the vertical slice landed in the working tree. The final contract uses exact Card/Document/property coordinates plus an optional membership discriminant; wide-row reads were renamed explicitly, membership invalidation was added, and actual targeted validation commands/evidence replaced the speculative examples.

Revision note, 2026-07-14: Closed the plan after final strict checks, lint, and all four test tiers passed and the complete vertical slice was committed.
