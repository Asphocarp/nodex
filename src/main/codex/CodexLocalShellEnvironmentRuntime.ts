import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import {
  loadCodexLocalShellEnvironment,
  type CodexLocalShellEnvironmentOptions,
} from "./codex-worktree-shell-environment";

export class CodexLocalShellEnvironmentRuntimeError extends Schema.TaggedError<CodexLocalShellEnvironmentRuntimeError>()(
  "CodexLocalShellEnvironmentRuntimeError",
  { cause: Schema.Defect() },
) {}

export interface CodexLocalShellEnvironmentRuntime {
  readonly load: Effect.Effect<NodeJS.ProcessEnv, CodexLocalShellEnvironmentRuntimeError>;
}

/**
 * Creates one Scope-owned, lazy, single-flight login-shell discovery.
 * Caller interruption stops only that wait; Scope release interrupts the physical discovery.
 */
export const make = (
  options: CodexLocalShellEnvironmentOptions = {},
): Effect.Effect<CodexLocalShellEnvironmentRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const immutableOptions: CodexLocalShellEnvironmentOptions = {
      ...options,
      ...(options.baseEnvironment === undefined
        ? {}
        : { baseEnvironment: { ...options.baseEnvironment } }),
    };
    const discovery = yield* FiberHandle.make<
      NodeJS.ProcessEnv,
      CodexLocalShellEnvironmentRuntimeError
    >();
    const admission = yield* Semaphore.make(1);
    let accepting = true;
    let cached: Fiber.Fiber<NodeJS.ProcessEnv, CodexLocalShellEnvironmentRuntimeError> | undefined;

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        accepting = false;
      }),
    );

    const acquire = admission.withPermits(1)(
      Effect.gen(function* () {
        if (!accepting) {
          return yield* Effect.fail(
            new CodexLocalShellEnvironmentRuntimeError({
              cause: new Error("Shell environment runtime is closed"),
            }),
          );
        }
        if (cached) return cached;

        const physical = Effect.tryPromise({
          try: (signal) =>
            loadCodexLocalShellEnvironment({
              ...immutableOptions,
              signal,
            }),
          catch: (cause) => new CodexLocalShellEnvironmentRuntimeError({ cause }),
        });
        // Publish the FiberHandle lease before login-shell spawning can expose started state.
        cached = yield* FiberHandle.run(discovery, Effect.yieldNow.pipe(Effect.andThen(physical)), {
          startImmediately: true,
        });
        return cached;
      }),
    );

    return {
      load: acquire.pipe(Effect.flatMap(Fiber.join)),
    };
  });
