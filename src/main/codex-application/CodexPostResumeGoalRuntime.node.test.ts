import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import {
  make,
  type CodexPostResumeGoalLoadResult,
  type CodexPostResumeGoalRuntimeOptions,
} from "./CodexPostResumeGoalRuntime";

const goal = (threadId = "thread-1"): ThreadGoal => ({
  threadId,
  objective: "Finish the cut-over",
  status: "active",
  tokenBudget: null,
  tokensUsed: 1,
  timeUsedSeconds: 2,
  createdAt: 1,
  updatedAt: 2,
});

const loaded = (threadId = "thread-1"): CodexPostResumeGoalLoadResult => ({
  ok: true,
  goal: goal(threadId),
});

const options = (
  overrides: Partial<CodexPostResumeGoalRuntimeOptions> = {},
): CodexPostResumeGoalRuntimeOptions => ({
  load: (threadId) => Effect.succeed(loaded(threadId)),
  commit: () => true,
  requestContinuation: () => {},
  scheduleRemainingTurns: () => {},
  ...overrides,
});

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`Post-resume goal test did not settle: ${label}`));
  });

it.effect("shares one goal load while each hydration keeps its own revision fence", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<CodexPostResumeGoalLoadResult>();
    let loads = 0;
    const committedRevisions: number[] = [];
    let continuations = 0;
    const runtime = yield* make(
      options({
        load: () =>
          Effect.sync(() => {
            loads += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
        commit: (_threadId, expectedRevision) => {
          committedRevisions.push(expectedRevision);
          return expectedRevision === 2;
        },
        requestContinuation: () => {
          continuations += 1;
        },
      }),
    );
    const stale = yield* Effect.forkChild(runtime.hydrate("thread-1", 1));
    yield* Deferred.await(started);
    const current = yield* Effect.forkChild(runtime.hydrate("thread-1", 2));
    yield* Effect.yieldNow;
    assert.strictEqual(loads, 1);
    yield* Deferred.succeed(release, loaded());
    yield* Fiber.join(stale);
    yield* Fiber.join(current);
    assert.deepEqual(committedRevisions, [1, 2]);
    assert.strictEqual(continuations, 1);
  }),
);

it.effect("coalesces background requests and commits their latest revision", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<CodexPostResumeGoalLoadResult>();
    const committedRevisions: number[] = [];
    let continuations = 0;
    let tailSchedules = 0;
    const runtime = yield* make(
      options({
        load: () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
        commit: (_threadId, expectedRevision) => {
          committedRevisions.push(expectedRevision);
          return true;
        },
        requestContinuation: () => {
          continuations += 1;
        },
        scheduleRemainingTurns: () => {
          tailSchedules += 1;
        },
      }),
    );
    runtime.request("thread-1", 1);
    yield* Deferred.await(started);
    runtime.request("thread-1", 2);
    yield* Deferred.succeed(release, loaded());
    yield* waitUntil("background request", () => tailSchedules === 1);
    assert.deepEqual(committedRevisions, [2]);
    assert.strictEqual(continuations, 3);
  }),
);

it.effect("releases one deferred post-resume flow exactly once", () =>
  Effect.gen(function* () {
    let tailSchedules = 0;
    const runtime = yield* make(
      options({
        scheduleRemainingTurns: () => {
          tailSchedules += 1;
        },
      }),
    );
    runtime.defer("thread-1");
    assert.isTrue(runtime.release("thread-1", 4));
    assert.isFalse(runtime.release("thread-1", 4));
    yield* waitUntil("deferred release", () => tailSchedules === 1);
  }),
);

it.effect("clear interrupts an active load and suppresses its tail", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let tailSchedules = 0;
    const runtime = yield* make(
      options({
        load: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        scheduleRemainingTurns: () => {
          tailSchedules += 1;
        },
      }),
    );
    runtime.request("thread-1", 1);
    yield* Deferred.await(started);
    runtime.clear("thread-1");
    yield* Deferred.await(interrupted);
    yield* Effect.yieldNow;
    assert.strictEqual(tailSchedules, 0);
  }),
);

it.effect("Main Scope close interrupts every post-resume goal fiber", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const runtime = yield* make(
      options({
        load: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.request("thread-1", 1);
    yield* Deferred.await(started);
    yield* Scope.close(ownerScope, Exit.void);
    yield* Deferred.await(interrupted);
  }),
);
