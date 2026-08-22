import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { CodexSidebarSweepStepError, make } from "./CodexSidebarSweepRuntime";

const stepError = (cause: unknown) =>
  new CodexSidebarSweepStepError({
    cause,
    state: { archived: false, cursorPresent: true, phase: "scan" },
  });

it.effect("runs one cooperative window per state and resets retry progress", () =>
  Effect.gen(function* () {
    const visited: number[] = [];
    const runtime = yield* make();
    yield* runtime.start(1, (state) =>
      Effect.sync(() => {
        visited.push(state);
        return state === 3 ? null : state + 1;
      }),
    );

    assert.isEmpty(visited);
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    assert.deepEqual(visited, [1, 2, 3]);
  }),
);

it.effect("retries the failed state with capped exponential Effect-clock delays", () =>
  Effect.gen(function* () {
    const attempts: number[] = [];
    const runtime = yield* make({
      retryInitialDelay: "1 second",
      retryMaxDelay: "2 seconds",
      retryDelay: (baseDelayMs) => Effect.succeed(baseDelayMs),
    });
    yield* runtime.start(7, (state) => {
      attempts.push(state);
      return attempts.length < 4 ? Effect.fail(stepError("temporary")) : Effect.succeed(null);
    });
    yield* Effect.yieldNow;
    assert.deepEqual(attempts, [7]);

    yield* TestClock.adjust("999 millis");
    assert.deepEqual(attempts, [7]);
    yield* TestClock.adjust("1 millis");
    assert.deepEqual(attempts, [7, 7]);
    yield* TestClock.adjust("2 seconds");
    assert.deepEqual(attempts, [7, 7, 7]);
    yield* TestClock.adjust("2 seconds");
    assert.deepEqual(attempts, [7, 7, 7, 7]);
  }),
);

it.effect("replaces an active sweep only after its physical window drains", () =>
  Effect.gen(function* () {
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const visited: string[] = [];
    const runtime = yield* make();
    yield* runtime.start("first", (state) =>
      Effect.sync(() => visited.push(state)).pipe(
        Effect.andThen(Deferred.succeed(firstStarted, undefined)),
        Effect.andThen(Deferred.await(releaseFirst)),
        Effect.as(null),
      ),
    );
    yield* Deferred.await(firstStarted);
    let replacementAdmitted = false;
    const replacement = yield* Effect.forkChild(
      runtime
        .start("second", (state) => Effect.sync(() => visited.push(state)).pipe(Effect.as(null)))
        .pipe(Effect.tap(() => Effect.sync(() => void (replacementAdmitted = true)))),
    );
    yield* Effect.yieldNow;
    assert.isFalse(replacementAdmitted);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(replacement);
    yield* Effect.yieldNow;
    assert.deepEqual(visited, ["first", "second"]);
  }),
);

it.effect("cancels active work explicitly and when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const runtime = yield* make().pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.start(1, () =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
      ),
    );
    yield* Deferred.await(started);
    const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
    yield* Deferred.await(interrupted);
    yield* Fiber.join(closing);
  }),
);
