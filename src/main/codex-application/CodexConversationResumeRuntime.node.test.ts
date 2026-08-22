import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { CodexConversationResumeError, make } from "./CodexConversationResumeRuntime";

it.effect("coalesces identical per-Thread resume demand", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let physicalRuns = 0;
    const runtime = yield* make({
      run: () => {
        physicalRuns += 1;
        return Deferred.await(release).pipe(Effect.as(null));
      },
    });
    const first = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(physicalRuns, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
  }),
);

it.effect("serializes incompatible replay demand as an idempotent upgrade", () =>
  Effect.gen(function* () {
    const releaseFirst = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const demands: string[] = [];
    let active = 0;
    let maxActive = 0;
    const runtime = yield* make({
      run: (input) =>
        Effect.gen(function* () {
          active += 1;
          maxActive = Math.max(maxActive, active);
          demands.push(
            `${input.syncDormantConversationSnapshots}:${input.replayBufferedNotifications}`,
          );
          if (demands.length === 1) yield* Deferred.await(releaseFirst);
          else yield* Deferred.succeed(secondStarted, undefined);
          active -= 1;
          return null;
        }),
    });
    const adoption = yield* Effect.forkChild(
      runtime.resume({
        threadId: "thread-1",
        syncDormantConversationSnapshots: false,
        replayBufferedNotifications: false,
      }),
      { startImmediately: true },
    );
    const ordinary = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.deepEqual(demands, ["false:false"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(adoption);
    yield* Deferred.await(secondStarted);
    yield* Fiber.join(ordinary);
    assert.deepEqual(demands, ["false:false", "true:true"]);
    assert.strictEqual(maxActive, 1);
  }),
);

it.effect("evicts failed work so the next resume can retry", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* make({
      run: () => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(new CodexConversationResumeError({ cause: new Error("resume failed") }))
          : Effect.succeed(null);
      },
    });
    assert.strictEqual(
      (yield* runtime.resume({ threadId: "thread-1" }).pipe(Effect.result))._tag,
      "Failure",
    );
    yield* runtime.resume({ threadId: "thread-1" });
    assert.strictEqual(attempts, 2);
  }),
);

it.effect("Thread clear and Main Scope close interrupt physical resumes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const runtime = yield* make({ run: () => Effect.never }).pipe(
      Effect.provideService(Scope.Scope, ownerScope),
    );
    const cleared = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    runtime.clear("thread-1");
    assert.strictEqual((yield* Fiber.await(cleared))._tag, "Failure");

    const closed = yield* Effect.forkChild(runtime.resume({ threadId: "thread-2" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual((yield* Fiber.await(closed))._tag, "Failure");
  }),
);
