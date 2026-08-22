import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";

export const DEFAULT_ACTIVE_GOAL_CONTINUATION_DELAY = "250 millis";

export class CodexActiveGoalContinuationError extends Data.TaggedError(
  "CodexActiveGoalContinuationError",
)<{ readonly cause: unknown }> {}

export interface CodexActiveGoalContinuationOptions {
  readonly isEligible: (conversationId: string) => boolean;
  readonly continueGoal: (
    conversationId: string,
  ) => Effect.Effect<void, CodexActiveGoalContinuationError>;
  readonly delay?: Duration.Input;
}

export class CodexActiveGoalContinuation extends Context.Service<
  CodexActiveGoalContinuation,
  {
    readonly request: (conversationId: string) => Effect.Effect<void>;
    readonly clear: (conversationId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexActiveGoalContinuation") {}

export const make = (
  options: CodexActiveGoalContinuationOptions,
): Effect.Effect<CodexActiveGoalContinuation["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const continuations = yield* FiberMap.make<string, void, never>();
    const admission = yield* Semaphore.make(1);

    const runContinuation = (conversationId: string) =>
      Effect.sleep(options.delay ?? DEFAULT_ACTIVE_GOAL_CONTINUATION_DELAY).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            options.isEligible(conversationId) ? options.continueGoal(conversationId) : Effect.void,
          ),
        ),
        Effect.catch((error) =>
          Effect.logError("Failed to continue active Codex thread goal").pipe(
            Effect.annotateLogs({
              cause: String(error.cause),
              conversationId,
            }),
          ),
        ),
      );

    const request = (conversationId: string) =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          if (!options.isEligible(conversationId)) return;
          if (yield* FiberMap.has(continuations, conversationId)) return;
          yield* FiberMap.run(continuations, conversationId, runContinuation(conversationId), {
            startImmediately: true,
          });
        }),
      );

    return CodexActiveGoalContinuation.of({
      request,
      clear: (conversationId) => FiberMap.remove(continuations, conversationId),
    });
  });

export interface CodexActiveGoalContinuationLegacyPort {
  readonly request: (conversationId: string) => void;
  readonly clear: (conversationId: string) => void;
}
