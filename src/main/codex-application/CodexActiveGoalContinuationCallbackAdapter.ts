import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type {
  CodexActiveGoalContinuation,
  CodexActiveGoalContinuationLegacyPort,
} from "./CodexActiveGoalContinuation";

type ContinuationCommand =
  | { readonly _tag: "Request"; readonly conversationId: string }
  | { readonly _tag: "Clear"; readonly conversationId: string };

/** FIFO projection for synchronous CodexService goal-lifecycle callbacks. */
export const makeCodexActiveGoalContinuationCallbackAdapter = (
  runtime: CodexActiveGoalContinuation["Service"],
): Effect.Effect<CodexActiveGoalContinuationLegacyPort, never, Scope.Scope> =>
  Effect.gen(function* () {
    const commands = yield* Queue.unbounded<ContinuationCommand>();
    yield* Effect.addFinalizer(() => Queue.shutdown(commands));
    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(commands).pipe(
          Effect.flatMap((command) =>
            command._tag === "Request"
              ? runtime.request(command.conversationId)
              : runtime.clear(command.conversationId),
          ),
        ),
      ),
    );

    return {
      request: (conversationId) => {
        Queue.offerUnsafe(commands, { _tag: "Request", conversationId });
      },
      clear: (conversationId) => {
        Queue.offerUnsafe(commands, { _tag: "Clear", conversationId });
      },
    };
  });
