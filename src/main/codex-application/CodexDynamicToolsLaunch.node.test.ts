import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { CodexDynamicToolsLaunchError, make } from "./CodexDynamicToolsLaunch";

const tool = {
  name: "create_thread",
  description: "Create a thread",
  inputSchema: {},
} as DynamicToolSpec;

it.effect("returns discovered tools before the launch deadline", () =>
  Effect.gen(function* () {
    const runtime = make("5 seconds");
    assert.deepEqual(yield* runtime.load(Effect.succeed([tool])), [tool]);
  }),
);

it.effect("fails open with no dynamic tools at the Effect-clock deadline", () =>
  Effect.gen(function* () {
    const runtime = make("2 seconds");
    const waiting = yield* Effect.forkChild(
      runtime.load(Effect.never as Effect.Effect<readonly DynamicToolSpec[]>),
    );
    yield* TestClock.adjust("1999 millis");
    yield* TestClock.adjust("1 millis");
    assert.deepEqual(yield* Fiber.join(waiting), []);
  }),
);

it.effect("preserves discovery failure before the deadline", () =>
  Effect.gen(function* () {
    const runtime = make("5 seconds");
    const failure = new CodexDynamicToolsLaunchError({ cause: new Error("catalog failed") });
    assert.strictEqual(yield* runtime.load(Effect.fail(failure)).pipe(Effect.flip), failure);
  }),
);

it.effect("interrupts an in-flight discovery when its caller closes", () =>
  Effect.gen(function* () {
    const runtime = make("5 seconds");
    const started = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(
      runtime.load(
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(released, undefined)),
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(waiting);
    yield* Deferred.await(released);
  }),
);
