# Move Canvas to a scene-native Owned Document sync engine

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this file in accordance with `docs/PLANS.md`.

## Purpose / Big Picture

After this work, a user can edit the same Canvas from multiple Nodex windows, close or reconnect either window, restore Canvas history, and keep managed images and Card references durable without encoding the scene as a Y.Doc. Canvas changes converge through Excalidraw's element version rules, are acknowledged only after one SQLite transaction, and repair gaps by loading the current canonical scene. Card and other BlockNote-backed editors continue using Yjs unchanged.

The architectural outcome is equally important: an Owned Document means independently owned, loaded, synchronized, persisted, and history-scoped content. It no longer means Y.Doc. Each registered content schema selects its synchronization engine explicitly.

## Progress

- [x] (2026-07-13 01:20Z) Confirmed the current Canvas/Yjs revision-register state grows with edit history rather than effective scene size and documented the replacement decision in ADR 0005.
- [x] (2026-07-13 01:20Z) Mapped descriptor, adapter, renderer, provider, Hub, writer, store, history, projection, backup, retention, and migration coupling.
- [ ] (2026-07-13 02:31Z) Introduce engine-neutral Owned Document descriptors, heads, schema registration, and checkpoint formats while keeping block-tree Yjs behavior green (completed: additive descriptor discriminant, strict v2 HTTP codec, engine metadata/Yjs-only lookup, pure Canvas scene contracts, and additive renderer provider/outbox; remaining: call-site migration, history format, removal of legacy public types).
- [ ] Add schema v71 and atomically migrate Canvas current state and checkpoints from Yjs into normalized scene authority.
- [ ] (2026-07-13 02:46Z) Implement the Canvas scene store kernel, exact receipts, projections, history, backup, retention, transfer, and additional-owner operations (completed: normalized current-scene authority, deterministic merge, app-state CAS, immutable files, exact receipts, canonical full sync/deltas, and transitional exact-head projection refresh; remaining: history, backup, retention, transfer, owner creation/deletion, and removal of the transitional projection).
- [x] (2026-07-13 03:00Z) Added engine-discriminated IPC/HTTP/realtime contracts and routed Canvas through the sole writer and one engine-neutral Hub subscription/lease lifecycle; durable canonical deltas fan out only after commit.
- [x] (2026-07-13 03:00Z) Replaced the renderer Canvas Y.Doc surface with a Canvas scene provider, durable IndexedDB outbox, coalescing, reconnect/gap repair, exact write-lease flush/freeze/resync, and bounded app-close flush.
- [ ] Delete Canvas Yjs roots/adapters/probes and remove public `ydoc_primary`/universal-state-vector assumptions.
- [ ] Update domain, architecture, reliability, security, product, engineering-learning, changelog, and Storybook documentation where behavior changes.
- [ ] Complete multi-angle code review, targeted tests, full typecheck/lint/test, runtime probes, and atomic conventional commits.

## Surprises & Discoveries

- Observation: The current scene adapter uses Yjs only to carry complete element contenders; final conflicts are still resolved by Excalidraw `version` and `versionNonce`.
  Evidence: `src/shared/block-documents/canvas-document.ts` stores unique revision keys and selects winners with `chooseCanvasElementWinner`.

- Observation: Operational update compaction does not bound the current Canvas Yjs full-state size.
  Evidence: one effective element measured 134 bytes as JSON and 52,135 bytes as a full Yjs update after 1,000 edits; applying that full update to a fresh Y.Doc and re-encoding it remained 52,060 bytes.

- Observation: `OwnedBlockDocumentSurface` is generic in name only. It always constructs `Y.Doc`, `NodexYProvider`, and Yjs Awareness, then rejects non-`ydoc_primary` descriptors.
  Evidence: `src/renderer/components/block-documents/block-document-surface.tsx` and `src/renderer/lib/block-document-surface-runtime.ts`.

- Observation: Canvas does not participate in the application close flush coordinator. It relies on React effect cleanup, which cannot provide the same bounded close handshake as Card Stage.
  Evidence: `src/renderer/app.tsx` registers Card persistence and window layout, while Canvas cleanup only calls `binding.flush()` from its effect destructor.

- Observation: Main-process Vitest must run through `scripts/run-vitest-in-electron.mjs`; invoking `vitest.main.config.ts` directly loads `better-sqlite3` with the wrong Node module ABI.
  Evidence: direct Vitest reported module versions 143 versus 137, while `pnpm run test:main` passed 130 files and 890 tests.

## Decision Log

- Decision: Preserve Canvas as a Project-owned document-bearing Block and preserve common Owned Document identity, head, lease, history identity, backup, retention, Project scope, and single-writer rules.
  Rationale: Those are valid domain boundaries independent of the content synchronization algorithm.
  Date/Author: 2026-07-13 / Codex and user.

- Decision: Use a descriptor sync-engine discriminant and keep state vectors out of common Owned Document contracts.
  Rationale: A universal state vector would retain the false Document-equals-Y.Doc abstraction under a new name.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use normalized per-element Canvas authority plus immutable receipts, full-scene gap repair, and canonical delta fanout.
  Rationale: This matches Excalidraw's atomic element model, avoids rewriting unrelated large elements, and gives deterministic multi-window convergence without a second CRDT history.
  Date/Author: 2026-07-13 / Codex and user.

- Decision: Keep Yjs APIs intact for `block_tree` callers and delete Canvas-specific Yjs behavior after the scene engine is vertically complete.
  Rationale: The refactor must not destabilize Card editing and must not leave a permanent dual Canvas authority.
  Date/Author: 2026-07-13 / Codex.

- Decision: Isolate `legacy_shadow` inside the historical finalization seam rather than exposing it as a normal Owned Document authority.
  Rationale: schema v70 finalizes legacy content before runtime readiness; new engine-neutral public contracts should describe only live runtime states.
  Date/Author: 2026-07-13 / Codex.

## Outcomes & Retrospective

The ADR and implementation map are complete. Runtime implementation is in progress. This section must be expanded after every milestone with the observable behavior achieved, remaining risks, and validation evidence.

## Context and Orientation

Nodex is a local-first Block-based desktop application. A Project is the isolation scope. A Block is the persistent content identity. A document-bearing Block owns an independently loaded content aggregate through the relational `block_documents` table. This plan calls that aggregate an Owned Document.

Today `src/shared/block-documents/contracts.ts` defines every descriptor with a Yjs state vector and calls the live authority `ydoc_primary`. `src/shared/block-documents/document-schema-adapters.ts` registers both BlockNote `block_tree` and Canvas `scene_graph` schemas as functions over `Y.Doc`. The renderer's `src/renderer/lib/block-document-surface-runtime.ts` always creates `Y.Doc` plus `NodexYProvider`. The main process `src/main/document-sync-hub.ts` accepts only Yjs state-vector sync and binary updates. `src/main/local-store/block-document-store.ts` reconstructs every registered Document from Yjs snapshots and updates.

Canvas begins in `src/renderer/components/kanban/canvas-view.tsx`. `CanvasSceneBinding` in `src/renderer/lib/canvas-scene-binding.ts` observes Excalidraw, uploads managed images, and mutates Canvas Yjs roots from `src/shared/block-documents/canvas-document.ts`. `NodexYProvider` sends the resulting binary update through IPC or HTTP/SSE. The writer reconstructs and validates the Y.Doc, then writes a complete rebuildable JSON projection through `src/main/local-store/canvas-scene-materializations.ts`.

The replacement keeps the `documents` and `block_documents` ownership records but adds a sync-engine field. `yjs` continues to mean binary causal synchronization for BlockNote trees. `canvas_scene` means a scene-native protocol whose authority is current normalized SQLite rows and whose conflicts use Excalidraw element versions. A durable head is the monotonically increasing SQLite sequence for either engine. A write lease is the common Hub protocol that asks mounted surfaces to flush, acknowledges the exact resulting head, freezes writes during an identity-sensitive command, and resynchronizes before release.

## Plan of Work

First, change common contracts without changing behavior. `src/shared/block-documents/contracts.ts` will define an engine-neutral Owned Document descriptor and a discriminated sync payload. A Yjs-specific head retains the state vector. Schema registration will state both `contentModel` and `syncEngine`; Yjs inspection APIs will accept only block-tree registrations. HTTP and IPC descriptor codecs will encode the discriminant. Existing Card and body-only call sites will narrow to the Yjs variant, and tests will prove a Canvas descriptor cannot enter `NodexYProvider`.

Second, add schema v71. Rebuild `documents` with a required `sync_engine`, engine-neutral content hash, and no universal state vector; move the Yjs state vector into a Yjs-only state table or retain a nullable guarded column if rebuilding every hot query is less clear. Add `canvas_scenes`, `canvas_scene_elements`, `canvas_scene_files`, and `canvas_scene_mutation_receipts`. Rebuild `document_versions` around `checkpoint_format`, opaque checkpoint bytes, checkpoint hash, materialization hash, and optional Yjs causal metadata. The migration must load every existing Canvas Y.Doc using the old adapter before deleting its Canvas update/snapshot rows, insert exact normalized scene authority, convert retained Canvas versions to canonical scene JSON, validate references/assets, and only then advance `user_version`.

Third, implement the pure Canvas authority kernel. Shared scene contracts canonicalize runtime elements, app-state field intent, files, requests, results, and canonical hashes. The local store reads an exact scene, reconciles candidates deterministically, retains explicit tombstones, validates immutable files and Card targets, records exact-retry receipts, advances only effective heads, refreshes references/assets/search/preview, and appends change evidence inside one immediate transaction. Focused tests must cover concurrent opposite-order convergence, equal-version ties, stale mergeable bases, future-head rejection, response-loss retry, mutation-ID collision, no-op receipts, app-state CAS, file upload races, missing assets, invalid references, and restart persistence.

Fourth, expose engine-specific synchronization through the one worker and Hub. Add Canvas full-sync and mutation commands to `block-mutation-worker-protocol.ts`, `block-mutation-writer.ts`, and `block-mutation-worker.ts`. Add typed IPC and HTTP bodies, bounded JSON codecs, renderer adapters, and a realtime event discriminant. Subscribe before full sync. Broadcast only durable canonical scene events. A missing head triggers full sync. Preserve common store reset, Project authorization, lease, and connection cleanup.

Fifth, replace the renderer surface. A `CanvasSceneProvider` owns accepted canonical scene, one immutable in-flight mutation, one coalesced pending observation, reconnect/gap repair, persistent IndexedDB outbox, and lease state. It uploads files before enqueue, records the exact mutation before transport, replays only under the same store epoch and generation, and invalidates obsolete recovery data after restore. `CanvasSceneBinding` becomes a UI bridge over provider methods instead of a Y.Doc mutator. `CanvasView` mounts the Canvas-specific surface, reconciles remote elements with Excalidraw, marks those updates `CaptureUpdateAction.NEVER`, and registers a bounded app-close flush.

Sixth, route history, restore, backup, GC, Project transfer, deletion, and Additional Document commands by engine. Canvas checkpoints contain canonical JSON and restore through newer element candidates. Backup validation reads scene authority and managed file rows directly. Retention scans current and versioned Canvas references without reconstructing Yjs. Project transfer moves the engine-neutral owner coordinates and Canvas authority/projections atomically. Non-primary Canvas creation initializes scene authority directly. Block relocation remains Yjs/block-tree only.

Finally, remove the old Canvas Yjs adapter, Canvas Yjs roots, scene branches in the Yjs store/provider/version code, obsolete IndexedDB Canvas checkpoints, and now-misleading tests/probes. Update the canonical docs and run the complete validation gates.

## Concrete Steps

Run all commands from `/Users/asc/.codex/worktrees/3a79/nodex2`.

During each milestone, run the nearest unit or integration tests with the appropriate Vitest config. Examples are:

    pnpm exec vitest run --config vitest.node.config.ts src/shared/block-documents/<changed-test>.test.ts
    pnpm exec vitest run --config vitest.main.config.ts src/main/local-store/<changed-test>.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/lib/<changed-test>.test.ts

After the final edit set is stable, run:

    pnpm run typecheck
    pnpm run lint
    pnpm test
    pnpm run test:all

The targeted Canvas runtime proof must demonstrate two windows submitting concurrent element versions in opposite delivery order and reaching the same canonical scene. A stress proof must apply thousands of revisions to one element and show that current authority size remains proportional to the current element JSON rather than revision count.

## Validation and Acceptance

Create or open one Project Canvas in two windows. Draw and drag elements in both windows, including concurrent edits to the same element. Both windows must converge to the deterministic Excalidraw winner without entering the remote update in either local undo stack. Restart the app and observe the same scene. Disconnect one renderer, edit locally, reconnect, and observe its persistent mutation replay or a clear epoch/generation recovery boundary. Close the application immediately after an edit and observe the edit after restart.

Add an image and a Card reference. The image bytes must be durable before the scene references the managed URI. Backup validation must prove the managed asset. Deleting or collecting a referenced Card must fail through the current exact-head reference guard. A Canvas history checkpoint must preview correctly and forward restore without a Yjs payload.

Database inspection must show Canvas Documents have `sync_engine = 'canvas_scene'`, have current scene/element/file rows and mutation receipts, and have no rows in Yjs update or operational snapshot tables. Block-tree Documents must show `sync_engine = 'yjs'` and continue passing existing multi-window, relocation, history, and recovery tests.

## Idempotence and Recovery

The v71 migration runs in an immediate transaction and may be retried after process restart. It must not delete old Canvas Yjs evidence until all current scenes and retained checkpoints have been converted and validated in the same transaction. A migration error leaves `user_version` and every old authority row unchanged.

Scene mutation IDs are immutable. Exact replay returns the first result; reuse with another canonical request returns a typed collision. Asset upload may leave an unreferenced managed file after an aborted mutation, but must never create a scene reference before durable asset validation. Existing backup-before-migration behavior remains mandatory.

No destructive Git reset or checkout is permitted. Existing unrelated worktree changes must be preserved. Each completed milestone should be committed with a conventional subject and explanatory body so a later contributor can restart from this plan.

## Artifacts and Notes

Current growth evidence from the old revision-register model:

    edits=0     effective JSON=128 B   Yjs full state=157 B
    edits=100   effective JSON=132 B   Yjs full state=5,333 B
    edits=1000  effective JSON=134 B   Yjs full state=52,135 B
    edits=5000  effective JSON=134 B   Yjs full state=263,841 B

ADR 0005 records the accepted decision and supersedes only the Canvas/Yjs extension of ADR 0002. Card and body-only Block Documents remain Yjs-backed.

## Interfaces and Dependencies

In `src/shared/block-documents/contracts.ts`, the common descriptor must expose identity, owner, schema, generation, head, readiness, and a discriminated sync engine. Yjs-only contracts must own their state vector. Canvas contracts live in a scene-specific shared module and use bounded portable JSON.

The Canvas mutation kernel must expose pure request canonicalization and deterministic element reconciliation separately from SQLite orchestration. The store API must offer full scene sync, apply mutation, read checkpoint materialization, and migration import. It must not import renderer or Excalidraw React modules.

The renderer provider must depend on a transport interface, an outbox interface, asset upload dependencies, and callbacks for canonical scene/status changes. Tests inject all dependencies. The provider must not import SQLite, Electron, or Yjs.

The main-process Hub may depend on engine backends selected by the descriptor, but common subscription and write-lease logic must not inspect engine payload internals. Yjs Awareness remains isolated to the Yjs backend.

Revision note: created 2026-07-13 after codebase exploration, upstream source review, and direct Canvas Yjs growth measurement. It records the accepted scene-native direction and the complete implementation sequence so work can resume from this file alone.
