import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { CodexThreadNotificationEvent } from "../../shared/codex-thread-notification";
import {
  makeCodexThreadNotificationHandler,
  type CodexThreadNotificationHandlerOptions,
} from "../codex/codex-thread-notification-handler";

export interface CodexThreadNotificationEventSource {
  readonly addThreadNotificationListener: (
    listener: (event: CodexThreadNotificationEvent) => void,
  ) => () => void;
  readonly addRendererConversationPresentedInForegroundListener: (
    listener: (conversationId: string) => void,
  ) => () => void;
}

export interface CodexThreadNotificationRuntimeOptions extends CodexThreadNotificationHandlerOptions {
  readonly source: CodexThreadNotificationEventSource;
}

/** Owns native-notification ingress and action admission for exactly one Main Scope. */
export const live = (options: CodexThreadNotificationRuntimeOptions): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        let accepting = true;
        const handle = makeCodexThreadNotificationHandler({
          ...options,
          showNotification: (notification, targetClientId, onAction) =>
            options.showNotification(notification, targetClientId, (action) => {
              if (accepting) onAction(action);
            }),
        });
        const releaseNotification = options.source.addThreadNotificationListener((event) => {
          if (accepting) handle(event);
        });
        const releasePresentation =
          options.source.addRendererConversationPresentedInForegroundListener((conversationId) => {
            if (accepting) options.dismissNotification({ conversationId });
          });

        return () => {
          accepting = false;
          releasePresentation();
          releaseNotification();
        };
      }),
      (release) => Effect.sync(release),
    ).pipe(Effect.asVoid),
  );
