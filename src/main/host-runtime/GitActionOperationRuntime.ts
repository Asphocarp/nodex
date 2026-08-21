import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { GitActionCancelInput, GitActionCancelResult } from "../../shared/types";

export class GitActionOperationRuntimeError extends Schema.TaggedError<GitActionOperationRuntimeError>()(
  "GitActionOperationRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type RunOperation = <A, E, R>(
  operationId: string | undefined,
  task: Effect.Effect<A, E, R>,
  canceled: () => A,
) => Effect.Effect<A, E | GitActionOperationRuntimeError, R>;

/**
 * Owns renderer Git-action replacement, explicit cancellation, and shutdown interruption.
 * The caller waits on a child Exit so cancellation can still return the existing domain result.
 */
export class GitActionOperationRuntime extends Context.Service<
  GitActionOperationRuntime,
  {
    readonly run: RunOperation;
    readonly cancel: (input: GitActionCancelInput) => Effect.Effect<GitActionCancelResult>;
  }
>()("nodex/main/host-runtime/GitActionOperationRuntime") {}

const namedKey = (operationId: string): string => `named:${operationId}`;
const isInterruptedOnly = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 && cause.reasons.every(Cause.isInterruptReason);

export const live: Layer.Layer<GitActionOperationRuntime> = Layer.effect(
  GitActionOperationRuntime,
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>();
    let accepting = true;
    let anonymousSequence = 0;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        accepting = false;
      }),
    );

    const run = <A, E, R>(
      operationId: string | undefined,
      task: Effect.Effect<A, E, R>,
      canceled: () => A,
    ): Effect.Effect<A, E | GitActionOperationRuntimeError, R> =>
      Effect.gen(function* () {
        if (!accepting) {
          return yield* Effect.fail(
            new GitActionOperationRuntimeError({
              operation: "run",
              cause: new Error("Git action runtime is closed"),
            }),
          );
        }

        const normalizedOperationId = operationId?.trim();
        const key = normalizedOperationId
          ? namedKey(normalizedOperationId)
          : `anonymous:${++anonymousSequence}`;
        // Let FiberMap publish the key before a synchronous platform effect can expose
        // "started" to another callback that immediately issues a cancel request.
        const fiber = yield* FiberMap.run(fibers, key, Effect.yieldNow.pipe(Effect.andThen(task)), {
          startImmediately: true,
        });
        const exit = yield* Fiber.await(fiber);
        if (Exit.isSuccess(exit)) return exit.value;
        if (isInterruptedOnly(exit.cause)) return canceled();
        return yield* Effect.failCause(exit.cause as Cause.Cause<E>);
      });

    const cancel = (input: GitActionCancelInput): Effect.Effect<GitActionCancelResult> =>
      Effect.gen(function* () {
        const operationId = input.operationId.trim();
        if (!accepting || !operationId) return { canceled: false };

        const key = namedKey(operationId);
        if (!(yield* FiberMap.has(fibers, key))) return { canceled: false };
        yield* FiberMap.remove(fibers, key);
        return { canceled: true };
      });

    return GitActionOperationRuntime.of({ cancel, run });
  }),
);
