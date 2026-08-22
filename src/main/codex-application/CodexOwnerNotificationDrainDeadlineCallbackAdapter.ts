import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type {
  CodexOwnerNotificationDrainDeadline,
  CodexOwnerNotificationDrainDeadlineLegacyPort,
} from "./CodexOwnerNotificationDrainDeadline";

type DrainDeadlineCommand =
  | {
      readonly _tag: "Schedule";
      readonly conversationId: string;
      readonly sentSequence: number;
      readonly ackSequence: number;
    }
  | { readonly _tag: "Clear"; readonly conversationId: string };

/** FIFO projection for synchronous owner-ack lifecycle callbacks. */
export const makeCodexOwnerNotificationDrainDeadlineCallbackAdapter = (
  runtime: CodexOwnerNotificationDrainDeadline["Service"],
): Effect.Effect<CodexOwnerNotificationDrainDeadlineLegacyPort, never, Scope.Scope> =>
  Effect.gen(function* () {
    const commands = yield* Queue.unbounded<DrainDeadlineCommand>();
    yield* Effect.addFinalizer(() => Queue.shutdown(commands));
    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(commands).pipe(
          Effect.flatMap((command) =>
            command._tag === "Schedule"
              ? runtime.schedule(command.conversationId, command.sentSequence, command.ackSequence)
              : runtime.clear(command.conversationId),
          ),
        ),
      ),
    );

    return {
      schedule: (conversationId, sentSequence, ackSequence) => {
        Queue.offerUnsafe(commands, {
          _tag: "Schedule",
          conversationId,
          sentSequence,
          ackSequence,
        });
      },
      clear: (conversationId) => {
        Queue.offerUnsafe(commands, { _tag: "Clear", conversationId });
      },
    };
  });
