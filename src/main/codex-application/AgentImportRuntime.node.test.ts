import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { PendingImportScan } from "../codex/agent-import-operations";
import {
  AgentImportOperationsError,
  make,
  type AgentImportOperationsAdapter,
} from "./AgentImportRuntime";

const preparedScan = (scanId: string, expiresAt: number): PendingImportScan => ({
  itemsById: new Map(),
  scan: {
    expiresAt,
    items: [],
    scanId,
    skippedAlreadyImportedSessions: 0,
    sourceHome: "/source",
    sourceKind: "codex",
    sourceLabel: "Codex",
  },
  sourceHome: "/source",
});

const result = (importId: string, startedAt: number) => ({
  completedAt: startedAt,
  importId,
  importedThreadIds: [],
  outcomes: [],
  sourceKind: "codex" as const,
  sourceLabel: "Codex",
  startedAt,
});

const makeOperations = (
  overrides: Partial<AgentImportOperationsAdapter> = {},
): AgentImportOperationsAdapter => ({
  scan: (_sourceKind, _selectedSourceHome, now) =>
    Effect.succeed(preparedScan("scan-1", now + 600_000)),
  apply: (_input, _scan, importId, startedAt) => Effect.succeed(result(importId, startedAt)),
  makeImportId: Effect.succeed("import-1"),
  ...overrides,
});

it.effect("owns scan expiry and consumes a successful scan exactly once", () =>
  Effect.gen(function* () {
    const runtime = yield* make(makeOperations(), () => Effect.void);
    const scan = yield* runtime.scan("codex", "/source");
    assert.strictEqual(scan.scanId, "scan-1");
    assert.deepEqual((yield* runtime.snapshot).scanIds, ["scan-1"]);

    yield* TestClock.adjust("2 seconds");
    const imported = yield* runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] });
    assert.strictEqual(imported.importId, "import-1");
    assert.strictEqual(imported.startedAt, 2_000);
    assert.strictEqual(imported.completedAt, 2_000);
    assert.deepEqual((yield* runtime.snapshot).scanIds, []);

    const expired = yield* Effect.flip(runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] }));
    assert.strictEqual(expired.reason, "expired-scan");
  }),
);

it.effect("rejects a concurrent apply immediately and preserves admission after failure", () =>
  Effect.gen(function* () {
    const applyStarted = yield* Deferred.make<void>();
    const releaseApply = yield* Deferred.make<void>();
    let shouldFail = true;
    const runtime = yield* make(
      makeOperations({
        apply: (_input, _scan, importId, startedAt) =>
          Deferred.succeed(applyStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseApply)),
            Effect.flatMap(() =>
              shouldFail
                ? Effect.fail(
                    new AgentImportOperationsError({
                      operation: "apply",
                      cause: new Error("copy failed"),
                    }),
                  )
                : Effect.succeed(result(importId, startedAt)),
            ),
          ),
      }),
      () => Effect.void,
    );
    const scan = yield* runtime.scan("codex");
    const first = yield* Effect.forkChild(
      runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] }).pipe(Effect.flip),
    );
    yield* Deferred.await(applyStarted);

    const concurrent = yield* Effect.flip(
      runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] }),
    );
    assert.strictEqual(concurrent.reason, "concurrent-import");
    yield* Deferred.succeed(releaseApply, undefined);
    assert.strictEqual((yield* Fiber.join(first)).reason, "apply-failed");
    assert.isFalse((yield* runtime.snapshot).applying);
    assert.deepEqual((yield* runtime.snapshot).scanIds, [scan.scanId]);

    shouldFail = false;
    const second = yield* runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] });
    assert.strictEqual(second.importId, "import-1");
  }),
);

it.effect("prunes an expired preview with the Effect clock before apply admission", () =>
  Effect.gen(function* () {
    const runtime = yield* make(
      makeOperations({
        scan: (_sourceKind, _selectedSourceHome, now) =>
          Effect.succeed(preparedScan("short-scan", now + 1_000)),
      }),
      () => Effect.void,
    );
    const scan = yield* runtime.scan("codex");
    yield* TestClock.adjust("1 second");

    const expired = yield* Effect.flip(runtime.apply({ scanId: scan.scanId, itemIds: [] }));
    assert.strictEqual(expired.reason, "expired-scan");
    assert.deepEqual((yield* runtime.snapshot).scanIds, []);
  }),
);

it.effect("rejects a late scan result after the owning Main Scope closes", () =>
  Effect.gen(function* () {
    const scanStarted = yield* Deferred.make<void>();
    const releaseScan = yield* Deferred.make<void>();
    const scope = yield* Scope.make();
    const runtime = yield* make(
      makeOperations({
        scan: (_sourceKind, _selectedSourceHome, now) =>
          Deferred.succeed(scanStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseScan)),
            Effect.as(preparedScan("late-scan", now + 600_000)),
          ),
      }),
      () => Effect.void,
    ).pipe(Effect.provideService(Scope.Scope, scope));
    const scanning = yield* Effect.forkChild(runtime.scan("codex").pipe(Effect.flip));
    yield* Deferred.await(scanStarted);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.succeed(releaseScan, undefined);

    assert.strictEqual((yield* Fiber.join(scanning)).reason, "closed");
    const snapshot = yield* runtime.snapshot;
    assert.isTrue(snapshot.closed);
    assert.deepEqual(snapshot.scanIds, []);
  }),
);

it.effect("fences late apply completion and progress callbacks after Scope close", () =>
  Effect.gen(function* () {
    const applyStarted = yield* Deferred.make<void>();
    const releaseApply = yield* Deferred.make<void>();
    const progress: string[] = [];
    const scope = yield* Scope.make();
    const runtime = yield* make(
      makeOperations({
        apply: (_input, _scan, importId, startedAt, emitProgress) =>
          Effect.gen(function* () {
            emitProgress({
              activeItemLabel: "early",
              completed: false,
              completedItems: 0,
              importId,
              sourceKind: "codex",
              totalItems: 1,
            });
            yield* Deferred.succeed(applyStarted, undefined);
            yield* Deferred.await(releaseApply);
            emitProgress({
              activeItemLabel: "late",
              completed: false,
              completedItems: 0,
              importId,
              sourceKind: "codex",
              totalItems: 1,
            });
            return result(importId, startedAt);
          }),
      }),
      (update) => Effect.sync(() => progress.push(update.activeItemLabel ?? "completed")),
    ).pipe(Effect.provideService(Scope.Scope, scope));
    const scan = yield* runtime.scan("codex");
    const applying = yield* Effect.forkChild(
      runtime.apply({ scanId: scan.scanId, itemIds: ["item-1"] }).pipe(Effect.flip),
    );
    yield* Deferred.await(applyStarted);
    yield* Effect.yieldNow;
    assert.deepEqual(progress, ["early"]);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.succeed(releaseApply, undefined);
    assert.strictEqual((yield* Fiber.join(applying)).reason, "closed");
    yield* Effect.yieldNow;
    assert.deepEqual(progress, ["early"]);
  }),
);
