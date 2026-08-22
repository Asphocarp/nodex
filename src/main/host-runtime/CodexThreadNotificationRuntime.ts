import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import {
  makeCodexThreadNotificationHandler,
  type CodexThreadNotificationHandlerOptions,
} from "../codex/codex-thread-notification-handler";

export interface CodexThreadNotificationRuntimeOptions extends CodexThreadNotificationHandlerOptions {
  readonly events: CodexApplicationEventHub["Service"];
}

/** Owns native-notification ingress and action admission for exactly one Main Scope. */
export const live = (options: CodexThreadNotificationRuntimeOptions): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      let accepting = true;
      const handle = makeCodexThreadNotificationHandler({
        ...options,
        showNotification: (notification, targetClientId, onAction) =>
          options.showNotification(notification, targetClientId, (action) => {
            if (accepting) onAction(action);
          }),
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          accepting = false;
        }),
      );
      yield* options.events.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.kind === "threadNotification") {
              handle(event.value);
              return;
            }
            if (event.kind === "rendererConversationPresentedInForeground") {
              options.dismissNotification({ conversationId: event.value });
            }
          }),
        ),
        Effect.forkScoped,
      );
    }),
  );
