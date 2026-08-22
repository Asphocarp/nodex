import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { CodexSidebarThreadMoveError, make } from "./CodexSidebarThreadMoveRuntime";

it.effect("admits one sidebar move at a time in FIFO order", () =>
  Effect.gen(function* () {
    const runtime = make();
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const order: string[] = [];
    const first = yield* Effect.forkChild(
      runtime.run(
        Deferred.succeed(firstStarted, undefined).pipe(
          Effect.andThen(Effect.sync(() => order.push("first:start"))),
          Effect.andThen(Deferred.await(releaseFirst)),
          Effect.andThen(Effect.sync(() => order.push("first:end"))),
        ),
      ),
    );
    yield* Deferred.await(firstStarted);
    const second = yield* Effect.forkChild(runtime.run(Effect.sync(() => order.push("second"))));
    yield* Effect.yieldNow;
    assert.deepEqual(order, ["first:start"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  }),
);

it.effect("releases admission after a failed move", () =>
  Effect.gen(function* () {
    const runtime = make();
    const failure = new CodexSidebarThreadMoveError({ cause: new Error("move failed") });
    assert.strictEqual(yield* runtime.run(Effect.fail(failure)).pipe(Effect.flip), failure);
    assert.strictEqual(yield* runtime.run(Effect.succeed("next")), "next");
  }),
);

it.effect("removes an interrupted waiter without running its move", () =>
  Effect.gen(function* () {
    const runtime = make();
    const active = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      runtime.run(
        Deferred.succeed(active, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ),
    );
    yield* Deferred.await(active);
    let ran = false;
    const waiting = yield* Effect.forkChild(runtime.run(Effect.sync(() => void (ran = true))));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(waiting);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    assert.isFalse(ran);
  }),
);
