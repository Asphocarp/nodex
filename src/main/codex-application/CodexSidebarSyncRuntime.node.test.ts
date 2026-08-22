import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { CodexSidebarSnapshot } from "../../shared/types";
import {
  CodexSidebarSyncError,
  type CodexSidebarSyncMetadata,
  make,
} from "./CodexSidebarSyncRuntime";

const EMPTY_METADATA: CodexSidebarSyncMetadata = {
  changedProjectIds: [],
  projectlessChanged: false,
  materializedSessionIds: [],
  failedThreadIds: [],
};

const snapshot = (revision: number): CodexSidebarSnapshot => ({
  items: [],
  pinnedThreadIds: [],
  projectAssignments: {},
  projectlessThreadIds: [],
  revision,
  generatedAt: revision,
});

it.effect("coalesces concurrent refresh callers behind one scoped physical fiber", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let refreshes = 0;
    const runtime = yield* make({
      refresh: () => {
        refreshes += 1;
        return Deferred.await(release).pipe(Effect.as(EMPTY_METADATA));
      },
      buildSnapshot: (_includeArchived, revision) => Effect.succeed(snapshot(revision)),
      emit: () => {},
    });
    const first = yield* Effect.forkChild(runtime.sync({ policy: "force" }), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(runtime.sync({ policy: "force" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(refreshes, 1);
    yield* Deferred.succeed(release, undefined);
    assert.deepEqual(yield* Fiber.join(first), yield* Fiber.join(second));
  }),
);

it.effect("uses a fresh revisioned cache and refreshes after invalidation", () =>
  Effect.gen(function* () {
    let refreshes = 0;
    const runtime = yield* make({
      refresh: () => {
        refreshes += 1;
        return Effect.succeed(EMPTY_METADATA);
      },
      buildSnapshot: (_includeArchived, revision) => Effect.succeed(snapshot(revision)),
      emit: () => {},
    });
    yield* runtime.sync({ policy: "force" });
    const cached = yield* runtime.sync({ policy: "stale" });
    assert.strictEqual(refreshes, 1);
    assert.strictEqual(cached.source, "core");
    runtime.invalidate();
    const refreshed = yield* runtime.sync({ policy: "stale" });
    assert.strictEqual(refreshes, 2);
    assert.strictEqual(refreshed.snapshot.revision, 1);
  }),
);

it.effect("serves stale last-known state during Effect-clock failure backoff", () =>
  Effect.gen(function* () {
    let refreshes = 0;
    const runtime = yield* make({
      refresh: () => {
        refreshes += 1;
        return Effect.fail(new CodexSidebarSyncError({ cause: new Error("busy") }));
      },
      buildSnapshot: (_includeArchived, revision) => Effect.succeed(snapshot(revision)),
      emit: () => {},
    });
    yield* runtime.sync({ policy: "read" });
    assert.strictEqual((yield* runtime.sync({ policy: "force" })).source, "stale-last-known");
    assert.strictEqual((yield* runtime.sync({ policy: "stale" })).source, "stale-last-known");
    assert.strictEqual(refreshes, 1);
    yield* TestClock.adjust("2 seconds");
    yield* runtime.sync({ policy: "stale" });
    assert.strictEqual(refreshes, 2);
  }),
);

it.effect("notification repair crosses the active-catalog fence despite an archived refresh", () =>
  Effect.gen(function* () {
    const releaseFirst = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    let activeRefreshes = 0;
    let archivedRefreshes = 0;
    const runtime = yield* make({
      refresh: ({ includeArchived }) => {
        if (includeArchived) {
          archivedRefreshes += 1;
          return Effect.succeed(EMPTY_METADATA);
        }
        activeRefreshes += 1;
        if (activeRefreshes === 1) {
          return Deferred.await(releaseFirst).pipe(Effect.as(EMPTY_METADATA));
        }
        return Deferred.succeed(secondStarted, undefined).pipe(Effect.as(EMPTY_METADATA));
      },
      buildSnapshot: (_includeArchived, revision) => Effect.succeed(snapshot(revision)),
      emit: () => {},
    });
    const stale = yield* Effect.forkChild(runtime.sync({ policy: "force" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    runtime.scheduleNotification({ notificationMethod: "turn/completed", threadId: "thread-1" });
    yield* runtime.sync({ includeArchived: true, policy: "force" });
    yield* TestClock.adjust("300 millis");
    assert.strictEqual(activeRefreshes, 1);
    assert.strictEqual(archivedRefreshes, 1);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(stale);
    yield* Deferred.await(secondStarted);
    assert.strictEqual(activeRefreshes, 2);
    yield* runtime.sync({ policy: "force" });
  }),
);

it.effect("Main Scope close interrupts refreshes and releases invalidation subscription", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    let subscriptions = 0;
    const runtime = yield* make({
      refresh: () => Effect.never,
      buildSnapshot: (_includeArchived, revision) => Effect.succeed(snapshot(revision)),
      emit: () => {},
      subscribeInvalidation: () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            subscriptions += 1;
          }),
          () =>
            Effect.sync(() => {
              subscriptions -= 1;
            }),
        ),
    }).pipe(Effect.provideService(Scope.Scope, ownerScope));
    const pending = yield* Effect.forkChild(runtime.sync({ policy: "force" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(subscriptions, 1);
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual(subscriptions, 0);
    assert.strictEqual((yield* Fiber.await(pending))._tag, "Failure");
  }),
);
