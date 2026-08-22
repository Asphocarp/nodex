import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import {
  CodexUserInputAutoResolutionError,
  make,
  USER_INPUT_AUTO_RESOLUTION_COUNTDOWN,
  USER_INPUT_FOREGROUND_INACTIVITY,
} from "./CodexUserInputAutoResolution";

it.effect("waits for foreground inactivity before resolving through one tracked fiber", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const resolved: Array<readonly [string, string | number]> = [];
    const runtime = yield* make({ isConversationPresented: () => true }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    const changes = yield* runtime.changes.pipe(
      Stream.take(3),
      Stream.runCollect,
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;
    yield* runtime.observeRequest(
      "thread-1",
      "request-1",
      Effect.sync(() => resolved.push(["thread-1", "request-1"])),
    );
    assert.strictEqual((yield* runtime.snapshot)[0]?.phase.type, "waitingForInactivity");

    yield* TestClock.adjust(USER_INPUT_FOREGROUND_INACTIVITY);
    const scheduled = (yield* runtime.snapshot)[0];
    assert.strictEqual(scheduled?.phase.type, "scheduled");
    yield* TestClock.adjust(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN);
    assert.deepEqual(resolved, [["thread-1", "request-1"]]);
    assert.isEmpty(yield* runtime.snapshot);
    const observed = [...(yield* Fiber.join(changes))];
    assert.deepEqual(observed.at(-1), {
      type: "timedOut",
      conversationId: "thread-1",
      requestId: "request-1",
    });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("resets inactivity, preserves scalar request identity, and snoozes permanently", () =>
  Effect.gen(function* () {
    let presented = true;
    let resolved = 0;
    const runtime = yield* make({ isConversationPresented: () => presented });
    yield* runtime.observeRequest(
      "thread-1",
      7,
      Effect.sync(() => void (resolved += 1)),
    );
    yield* TestClock.adjust("59 seconds");
    yield* runtime.recordActivity("thread-1");
    yield* TestClock.adjust("59 seconds");
    assert.strictEqual((yield* runtime.snapshot)[0]?.phase.type, "waitingForInactivity");

    presented = false;
    yield* runtime.reevaluatePresentation("thread-1");
    assert.strictEqual((yield* runtime.snapshot)[0]?.phase.type, "scheduled");
    presented = true;
    yield* runtime.reevaluatePresentation("thread-1");
    assert.strictEqual((yield* runtime.snapshot)[0]?.phase.type, "waitingForInactivity");
    presented = false;
    yield* runtime.reevaluatePresentation("thread-1");
    assert.isFalse(yield* runtime.snooze("thread-1", "7"));
    assert.isTrue(yield* runtime.snooze("thread-1", 7));
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(resolved, 0);
    assert.strictEqual((yield* runtime.snapshot)[0]?.phase.type, "snoozed");
  }),
);

it.effect("clears every request generation when the app-server disconnects", () =>
  Effect.gen(function* () {
    const runtime = yield* make({ isConversationPresented: () => false });
    const removal = yield* runtime.changes.pipe(
      Stream.filter((change) => change.type === "removed" && change.reason === "disconnected"),
      Stream.runHead,
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;
    yield* runtime.observeRequest("thread-1", "request-1", Effect.void);
    yield* runtime.handleDisconnect;

    assert.isEmpty(yield* runtime.snapshot);
    assert.deepEqual(Option.getOrUndefined(yield* Fiber.join(removal)), {
      type: "removed",
      conversationId: "thread-1",
      requestId: "request-1",
      reason: "disconnected",
    });
  }),
);

it.effect("replaces requests and cancels stale generations on response or reconciliation", () =>
  Effect.gen(function* () {
    let resolved = 0;
    const runtime = yield* make({ isConversationPresented: () => false });
    const changes = yield* runtime.changes.pipe(
      Stream.take(4),
      Stream.runCollect,
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;
    yield* runtime.observeRequest(
      "thread-1",
      7,
      Effect.sync(() => void (resolved += 1)),
    );
    yield* runtime.observeRequest(
      "thread-1",
      "7",
      Effect.sync(() => void (resolved += 1)),
    );
    yield* runtime.observeResponse("thread-1", 7);
    assert.lengthOf(yield* runtime.snapshot, 1);
    yield* runtime.reconcilePendingRequests("thread-1", [7]);
    assert.isEmpty(yield* runtime.snapshot);
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(resolved, 0);
    const observed = [...(yield* Fiber.join(changes))];
    assert.deepInclude(observed, {
      type: "removed",
      conversationId: "thread-1",
      requestId: 7,
      reason: "replaced",
    });
  }),
);

it.effect("publishes timeout before best-effort resolution failure and never retries", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* make({ isConversationPresented: () => false });
    const change = yield* runtime.changes.pipe(
      Stream.filter((candidate) => candidate.type === "timedOut"),
      Stream.runHead,
      Effect.forkScoped,
    );
    yield* runtime.observeRequest(
      "thread-1",
      "request-1",
      Effect.sync(() => void (attempts += 1)).pipe(
        Effect.andThen(
          Effect.fail(new CodexUserInputAutoResolutionError({ cause: new Error("transport") })),
        ),
      ),
    );
    yield* TestClock.adjust(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN);
    assert.isTrue(Option.isSome(yield* Fiber.join(change)));
    assert.isEmpty(yield* runtime.snapshot);
    assert.strictEqual(attempts, 1);
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(attempts, 1);
  }),
);

it.effect("interrupts every countdown when its owning Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let resolved = 0;
    const runtime = yield* make({ isConversationPresented: () => false }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    yield* runtime.observeRequest(
      "thread-1",
      "request-1",
      Effect.sync(() => void (resolved += 1)),
    );
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(resolved, 0);
  }),
);
