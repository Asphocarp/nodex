import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { planManagedWorktreeRetention } from "../codex/codex-managed-worktree-retention";
import {
  ManagedWorktreeRetentionRuntime,
  live as managedWorktreeRetentionRuntimeLive,
} from "./ManagedWorktreeRetentionRuntime";

const disabledPlan = () =>
  planManagedWorktreeRetention({
    enabled: false,
    keepCount: 1,
    metadataComplete: true,
    records: [],
    threadMetadata: [],
    pathProtections: [],
    protectPreMigrationOwnerlessWorktrees: true,
    nowMs: 0,
  });

const buildRuntime = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(managedWorktreeRetentionRuntimeLive(), scope);
  return {
    runtime: Context.get(context, ManagedWorktreeRetentionRuntime),
    scope,
  };
});

it.effect("coalesces scheduled requests against one fixed deadline", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const { runtime, scope } = yield* buildRuntime;

    yield* runtime.request(Effect.sync(() => (calls.push("first"), disabledPlan())));
    yield* Effect.yieldNow;
    yield* runtime.request(Effect.sync(() => (calls.push("latest"), disabledPlan())));
    yield* TestClock.adjust("299 millis");
    assert.deepEqual(calls, []);

    yield* TestClock.adjust("1 millis");
    yield* Effect.yieldNow;
    assert.deepEqual(calls, ["latest"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("flushes a pending debounce when an awaited sweep is admitted", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const { runtime, scope } = yield* buildRuntime;

    yield* runtime.request(Effect.sync(() => (calls.push("scheduled"), disabledPlan())));
    yield* Effect.yieldNow;
    const result = yield* runtime.run(
      Effect.sync(() => {
        calls.push("awaited");
        return disabledPlan();
      }),
    );

    assert.strictEqual(result.status, "skipped");
    assert.deepEqual(calls, ["awaited"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("collapses requests admitted during a sweep into one immediate rerun", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const rerunFinished = yield* Deferred.make<void>();
    const { runtime, scope } = yield* buildRuntime;

    yield* runtime.request(
      Effect.gen(function* () {
        calls.push("first");
        yield* Deferred.succeed(firstStarted, undefined);
        yield* Deferred.await(releaseFirst);
        return disabledPlan();
      }),
    );
    yield* Effect.yieldNow;
    yield* TestClock.adjust("300 millis");
    yield* Deferred.await(firstStarted);

    yield* runtime.request(Effect.sync(() => (calls.push("stale"), disabledPlan())));
    yield* runtime.request(
      Effect.gen(function* () {
        calls.push("latest");
        yield* Deferred.succeed(rerunFinished, undefined);
        return disabledPlan();
      }),
    );
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Deferred.await(rerunFinished);

    assert.deepEqual(calls, ["first", "latest"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts a pending debounce when its owning Scope closes", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const { runtime, scope } = yield* buildRuntime;

    yield* runtime.request(Effect.sync(() => (calls.push("sweep"), disabledPlan())));
    yield* Effect.yieldNow;
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("1 second");

    assert.deepEqual(calls, []);
  }),
);
