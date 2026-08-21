import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class CallbackRuntimeClosedError extends Schema.TaggedError<CallbackRuntimeClosedError>()(
  "CallbackRuntimeClosedError",
  {},
) {}

export class ScopedCallbackRuntime extends Context.Service<
  ScopedCallbackRuntime,
  {
    readonly fork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E> | null;
    readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  }
>()("nodex/main/app/ScopedCallbackRuntime") {}

export const layer: Layer.Layer<ScopedCallbackRuntime> = Layer.effect(
  ScopedCallbackRuntime,
  Effect.gen(function* () {
    let accepting = true;
    const fibers = yield* FiberSet.make();
    const runFork = yield* FiberSet.runtime(fibers)();
    const runPromise = yield* FiberSet.runtimePromise(fibers)();

    // This finalizer is registered after FiberSet.make, so it closes admission
    // before the FiberSet interrupts and awaits already-admitted callbacks.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        accepting = false;
      }),
    );

    return ScopedCallbackRuntime.of({
      fork: <A, E>(effect: Effect.Effect<A, E>) => {
        if (!accepting) return null;
        return runFork(effect) as Fiber.Fiber<A, E>;
      },
      runPromise: <A, E>(effect: Effect.Effect<A, E>) => {
        if (!accepting) return Promise.reject(new CallbackRuntimeClosedError());
        return runPromise(effect) as Promise<A>;
      },
    });
  }),
);
