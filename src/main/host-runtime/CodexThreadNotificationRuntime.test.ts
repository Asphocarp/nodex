import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { CodexThreadNotificationEventSource } from "../codex/codex-thread-notification-coordinator";
import { live } from "./CodexThreadNotificationRuntime";

it.effect("releases every Codex notification listener with the Main Scope", () =>
  Effect.gen(function* () {
    let notificationListenerCount = 0;
    let presentedListenerCount = 0;
    const source: CodexThreadNotificationEventSource = {
      addThreadNotificationListener: () => {
        notificationListenerCount += 1;
        return () => {
          notificationListenerCount -= 1;
        };
      },
      addRendererConversationPresentedInForegroundListener: () => {
        presentedListenerCount += 1;
        return () => {
          presentedListenerCount -= 1;
        };
      },
    };
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        source,
        getSettings: () => ({
          turnMode: "unfocused",
          permissionsEnabled: true,
          questionsEnabled: true,
        }),
        isAppForegrounded: () => false,
        isConversationPresentedInForeground: () => false,
        resolveTargetClientId: () => null,
        showNotification: () => undefined,
        dismissNotification: () => undefined,
        dispatchAction: () => false,
        focusTargetClient: () => undefined,
      }),
      scope,
    );
    assert.strictEqual(notificationListenerCount, 1);
    assert.strictEqual(presentedListenerCount, 1);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(notificationListenerCount, 0);
    assert.strictEqual(presentedListenerCount, 0);
  }),
);
