import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { make } from "./CodexSidebarNotificationSync";

const request = (minimumSyncGeneration: number) => ({
  notificationMethod: "thread/status/changed",
  threadId: `thread-${minimumSyncGeneration}`,
  minimumSyncGeneration,
});

it.effect("trailing-debounces to the latest sidebar repair generation", () =>
  Effect.gen(function* () {
    const repaired: number[] = [];
    const runtime = yield* make({
      debounce: "300 millis",
      repair: (generation) => Effect.sync(() => repaired.push(generation)),
    });
    yield* runtime.schedule(request(1));
    yield* TestClock.adjust("200 millis");
    yield* runtime.schedule(request(2));
    yield* TestClock.adjust("299 millis");
    assert.isEmpty(repaired);
    yield* TestClock.adjust("1 millis");
    assert.deepEqual(repaired, [2]);
  }),
);

it.effect("allows a new repair after the previous fiber completes", () =>
  Effect.gen(function* () {
    const repaired: number[] = [];
    const runtime = yield* make({
      debounce: "1 second",
      repair: (generation) => Effect.sync(() => repaired.push(generation)),
    });
    yield* runtime.schedule(request(1));
    yield* TestClock.adjust("1 second");
    yield* runtime.schedule(request(2));
    yield* TestClock.adjust("1 second");
    assert.deepEqual(repaired, [1, 2]);
  }),
);

it.effect("interrupts an active repair and pending debounce with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let interrupted = false;
    const runtime = yield* make({
      debounce: 0,
      repair: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        ),
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.schedule(request(1));
    yield* TestClock.adjust(0);
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(interrupted);
  }),
);
