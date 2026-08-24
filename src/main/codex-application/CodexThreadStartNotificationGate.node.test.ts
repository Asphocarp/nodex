import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { make } from "./CodexThreadStartNotificationGate";

it.effect("releases notification-first starts only after local materialization", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const gate = yield* make.pipe(Effect.provideService(Scope.Scope, scope));
    const response = yield* Deferred.make<string>();
    const materialization = yield* gate
      .materialize("local", Deferred.await(response), (threadId) => threadId)
      .pipe(Effect.forkChild);

    yield* Effect.yieldNow;
    assert.isTrue(gate.defer("local", "thread-a"));
    assert.isFalse(gate.defer("remote", "thread-remote"));
    yield* Deferred.succeed(response, "thread-a");
    assert.strictEqual(yield* Fiber.join(materialization), "thread-a");
    const release = Option.getOrThrow(yield* Stream.runHead(gate.releases));
    assert.deepEqual(release, { hostId: "local", threadId: "thread-a" });
    assert.isFalse(gate.defer("local", "thread-a"));

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("drains an unknown started Thread when its request fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const gate = yield* make.pipe(Effect.provideService(Scope.Scope, scope));
    const rejectRequest = yield* Deferred.make<void>();
    const failed = yield* gate
      .materialize(
        "local",
        Deferred.await(rejectRequest).pipe(Effect.andThen(Effect.fail("request failed"))),
        () => null,
      )
      .pipe(Effect.forkChild);

    yield* Effect.yieldNow;
    assert.isTrue(gate.defer("local", "orphan-thread"));
    yield* Deferred.succeed(rejectRequest, undefined);
    assert.strictEqual((yield* Fiber.await(failed))._tag, "Failure");
    assert.deepEqual(Option.getOrThrow(yield* Stream.runHead(gate.releases)), {
      hostId: "local",
      threadId: "orphan-thread",
    });

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps the physical materialization alive after its renderer waiter is interrupted", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const gate = yield* make.pipe(Effect.provideService(Scope.Scope, scope));
    const response = yield* Deferred.make<string>();
    const committed = yield* Deferred.make<string>();
    const waiter = yield* gate
      .materialize(
        "local",
        Deferred.await(response).pipe(
          Effect.tap((threadId) => Deferred.succeed(committed, threadId)),
        ),
        (threadId) => threadId,
      )
      .pipe(Effect.forkChild);

    yield* Effect.yieldNow;
    assert.isTrue(gate.defer("local", "thread-detached"));
    yield* Fiber.interrupt(waiter);
    yield* Deferred.succeed(response, "thread-detached");
    assert.strictEqual(yield* Deferred.await(committed), "thread-detached");
    assert.deepEqual(Option.getOrThrow(yield* Stream.runHead(gate.releases)), {
      hostId: "local",
      threadId: "thread-detached",
    });

    yield* Scope.close(scope, Exit.void);
  }),
);
