import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type {
  CodexRendererOwnerRetention,
  CodexRendererOwnerRetentionLegacyPort,
} from "./CodexRendererOwnerRetention";

type RetentionCommand =
  | {
      readonly _tag: "Reconcile";
      readonly conversationId: string;
      readonly candidate: boolean;
    }
  | { readonly _tag: "RecheckAfter"; readonly conversationId: string; readonly delayMs: number }
  | { readonly _tag: "Clear"; readonly conversationId: string };

interface CodexRendererOwnerRetentionCallbackAdapterOptions {
  readonly isCandidate: (conversationId: string) => boolean;
}

/** FIFO projection for synchronous CodexService ownership callbacks. */
export const makeCodexRendererOwnerRetentionCallbackAdapter = (
  runtime: CodexRendererOwnerRetention["Service"],
  options: CodexRendererOwnerRetentionCallbackAdapterOptions,
): Effect.Effect<CodexRendererOwnerRetentionLegacyPort, never, Scope.Scope> =>
  Effect.gen(function* () {
    const commands = yield* Queue.unbounded<RetentionCommand>();
    yield* Effect.addFinalizer(() => Queue.shutdown(commands));
    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(commands).pipe(
          Effect.flatMap((command) => {
            switch (command._tag) {
              case "Reconcile":
                return runtime.reconcile(command.conversationId, command.candidate);
              case "RecheckAfter":
                return runtime.recheckAfter(command.conversationId, command.delayMs);
              case "Clear":
                return runtime.clear(command.conversationId);
            }
          }),
        ),
      ),
    );

    return {
      reconcile: (conversationId) => {
        Queue.offerUnsafe(commands, {
          _tag: "Reconcile",
          conversationId,
          candidate: options.isCandidate(conversationId),
        });
      },
      recheckAfter: (conversationId, delayMs) => {
        Queue.offerUnsafe(commands, { _tag: "RecheckAfter", conversationId, delayMs });
      },
      clear: (conversationId) => {
        Queue.offerUnsafe(commands, { _tag: "Clear", conversationId });
      },
    };
  });
