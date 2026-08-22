import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { make } from "./CodexActiveGoalContinuation";

it.effect("coalesces callers behind one delayed continuation", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const release = yield* Deferred.make<void>();
    const runtime = yield* make({
      isEligible: () => true,
      delay: "250 millis",
      continueGoal: () => {
        attempts += 1;
        return Deferred.await(release);
      },
    });
    yield* runtime.request("thread-1");
    yield* runtime.request("thread-1");

    yield* TestClock.adjust("249 millis");
    assert.strictEqual(attempts, 0);
    yield* TestClock.adjust("1 millis");
    assert.strictEqual(attempts, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Effect.yieldNow;
  }),
);

it.effect("rechecks eligibility after the continuation delay", () =>
  Effect.gen(function* () {
    let eligible = true;
    let attempts = 0;
    const runtime = yield* make({
      isEligible: () => eligible,
      delay: "1 second",
      continueGoal: () => Effect.sync(() => void (attempts += 1)),
    });
    yield* runtime.request("thread-1");
    eligible = false;
    yield* TestClock.adjust("1 second");
    assert.strictEqual(attempts, 0);
  }),
);

it.effect("clears a pending keyed continuation", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* make({
      isEligible: () => true,
      delay: "1 second",
      continueGoal: () => Effect.sync(() => void (attempts += 1)),
    });
    yield* runtime.request("thread-1");
    yield* runtime.clear("thread-1");
    yield* TestClock.adjust("1 minute");
    assert.strictEqual(attempts, 0);
  }),
);

it.effect("interrupts pending continuation work when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let attempts = 0;
    let interrupted = false;
    const release = yield* Deferred.make<void>();
    const runtime = yield* make({
      isEligible: () => true,
      delay: "1 second",
      continueGoal: () => {
        attempts += 1;
        return Deferred.await(release).pipe(
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        );
      },
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.request("thread-1");
    yield* TestClock.adjust("1 second");
    assert.strictEqual(attempts, 1);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(interrupted);
  }),
);
