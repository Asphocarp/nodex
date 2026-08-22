import type { CodexQueuedFollowUp } from "../../shared/types";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";

export class CodexQueuedFollowUpDispatchError extends Data.TaggedError(
  "CodexQueuedFollowUpDispatchError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexQueuedFollowUpDispatchRuntimeOptions {
  readonly isEligible: (threadId: string) => boolean;
  /** Atomically removes and returns the next still-dispatchable follow-up. */
  readonly take: (threadId: string) => CodexQueuedFollowUp | null;
  readonly submit: (
    threadId: string,
    followUp: CodexQueuedFollowUp,
  ) => Effect.Effect<void, CodexQueuedFollowUpDispatchError>;
  readonly restore: (threadId: string, followUp: CodexQueuedFollowUp, reason: string) => void;
}

export class CodexQueuedFollowUpDispatchRuntime extends Context.Service<
  CodexQueuedFollowUpDispatchRuntime,
  {
    readonly request: (threadId: string) => void;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexQueuedFollowUpDispatchRuntime") {}

export const make = (
  options: CodexQueuedFollowUpDispatchRuntimeOptions,
): Effect.Effect<CodexQueuedFollowUpDispatchRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const dispatches = yield* FiberMap.make<string, void, never>();
    const runDispatch = yield* FiberMap.runtime(dispatches)();

    const dispatch = (threadId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const followUp = options.take(threadId);
        if (!followUp) return Effect.void;
        return options.submit(threadId, followUp).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              options.restore(
                threadId,
                followUp,
                error.cause instanceof Error ? error.cause.message : String(error.cause),
              );
            }),
          ),
        );
      });

    const request = (threadId: string): void => {
      if (!options.isEligible(threadId)) return;
      if (FiberMap.hasUnsafe(dispatches, threadId)) return;
      runDispatch(threadId, dispatch(threadId));
    };

    return CodexQueuedFollowUpDispatchRuntime.of({
      request,
      clear: (threadId) => {
        runDispatch(threadId, Effect.void);
      },
    });
  });
