import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { make } from "./CodexThreadSettingsRuntime";

it.effect("serializes settings mutations per Thread and lets turn admission await the lane", () =>
  Effect.gen(function* () {
    const runtime = yield* make;
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const order: string[] = [];
    const first = yield* Effect.forkChild(
      runtime.runMutation(
        "thread-1",
        Deferred.succeed(firstStarted, undefined).pipe(
          Effect.andThen(Effect.sync(() => order.push("first:start"))),
          Effect.andThen(Deferred.await(releaseFirst)),
          Effect.andThen(Effect.sync(() => order.push("first:end"))),
        ),
      ),
    );
    yield* Deferred.await(firstStarted);
    const second = yield* Effect.forkChild(
      runtime.runMutation(
        "thread-1",
        Effect.sync(() => order.push("second")),
      ),
    );
    let admitted = false;
    const admission = yield* Effect.forkChild(
      runtime
        .awaitCurrent("thread-1")
        .pipe(Effect.andThen(Effect.sync(() => void (admitted = true)))),
    );

    yield* Effect.yieldNow;
    assert.deepEqual(order, ["first:start"]);
    assert.isFalse(admitted);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    yield* Fiber.join(admission);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    assert.isTrue(admitted);
  }),
);

it.effect("keeps different Thread settings lanes independent", () =>
  Effect.gen(function* () {
    const runtime = yield* make;
    const releaseFirst = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      runtime.runMutation("thread-1", Deferred.await(releaseFirst)),
    );
    assert.strictEqual(
      yield* runtime.runMutation("thread-2", Effect.succeed("independent")),
      "independent",
    );
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
  }),
);

it.effect("releases a Thread lane after failure", () =>
  Effect.gen(function* () {
    const runtime = yield* make;
    const failure = new Error("invalid settings");
    assert.strictEqual(
      yield* runtime.runMutation("thread-1", Effect.fail(failure)).pipe(Effect.flip),
      failure,
    );
    assert.strictEqual(yield* runtime.runMutation("thread-1", Effect.succeed("next")), "next");
  }),
);

it.effect("owns app-server settings capability as one monotonic runtime fact", () =>
  Effect.gen(function* () {
    const runtime = yield* make;
    assert.strictEqual(runtime.remoteUpdateSupport(), "unknown");
    runtime.recordRemoteUpdateSupported();
    assert.strictEqual(runtime.remoteUpdateSupport(), "supported");
    runtime.recordRemoteUpdateUnsupported();
    assert.strictEqual(runtime.remoteUpdateSupport(), "unsupported");
    runtime.recordRemoteUpdateSupported();
    assert.strictEqual(runtime.remoteUpdateSupport(), "unsupported");
  }),
);
