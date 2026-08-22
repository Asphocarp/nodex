import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { make } from "./CodexOwnerNotificationDrainDeadline";

it.effect("fires with the first admitted owner-ack barrier at its deadline", () =>
  Effect.gen(function* () {
    const barriers: string[] = [];
    const runtime = yield* make({
      timeout: "1 second",
      onTimeout: (conversationId, sentSequence, ackSequence) =>
        Effect.sync(() => barriers.push(`${conversationId}:${sentSequence}:${ackSequence}`)),
    });
    yield* runtime.schedule("thread-1", 4, 2);
    yield* runtime.schedule("thread-1", 7, 3);
    yield* TestClock.adjust("999 millis");
    assert.isEmpty(barriers);
    yield* TestClock.adjust("1 millis");
    assert.deepEqual(barriers, ["thread-1:4:2"]);
  }),
);

it.effect("allows a new barrier after the previous deadline completes", () =>
  Effect.gen(function* () {
    const barriers: number[] = [];
    const runtime = yield* make({
      timeout: "1 second",
      onTimeout: (_conversationId, sentSequence) => Effect.sync(() => barriers.push(sentSequence)),
    });
    yield* runtime.schedule("thread-1", 1, 0);
    yield* TestClock.adjust("1 second");
    yield* runtime.schedule("thread-1", 2, 1);
    yield* TestClock.adjust("1 second");
    assert.deepEqual(barriers, [1, 2]);
  }),
);

it.effect("cancels a pending owner-ack deadline", () =>
  Effect.gen(function* () {
    let timeouts = 0;
    const runtime = yield* make({
      timeout: "1 second",
      onTimeout: () => Effect.sync(() => void (timeouts += 1)),
    });
    yield* runtime.schedule("thread-1", 1, 0);
    yield* runtime.clear("thread-1");
    yield* TestClock.adjust("1 minute");
    assert.strictEqual(timeouts, 0);
  }),
);

it.effect("cancels pending deadlines when the Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let timeouts = 0;
    const runtime = yield* make({
      timeout: "1 second",
      onTimeout: () => Effect.sync(() => void (timeouts += 1)),
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.schedule("thread-1", 1, 0);
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("1 minute");
    assert.strictEqual(timeouts, 0);
  }),
);
