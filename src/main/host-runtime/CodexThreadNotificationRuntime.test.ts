import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { DesktopNotificationActionPayload } from "../../shared/types";
import { live, type CodexThreadNotificationEventSource } from "./CodexThreadNotificationRuntime";

it.effect("releases every Codex notification listener with the Main Scope", () =>
  Effect.gen(function* () {
    let notificationListenerCount = 0;
    let presentedListenerCount = 0;
    const listeners: {
      event:
        | Parameters<CodexThreadNotificationEventSource["addThreadNotificationListener"]>[0]
        | null;
      action: ((action: DesktopNotificationActionPayload) => void) | null;
    } = { event: null, action: null };
    let dispatchedActionCount = 0;
    const source: CodexThreadNotificationEventSource = {
      addThreadNotificationListener: (listener) => {
        listeners.event = listener;
        notificationListenerCount += 1;
        return () => {
          listeners.event = null;
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
        resolveTargetClientId: () => "renderer-1",
        showNotification: (_notification, _targetClientId, onAction) => {
          listeners.action = onAction;
        },
        dismissNotification: () => undefined,
        dispatchAction: () => {
          dispatchedActionCount += 1;
          return true;
        },
        focusTargetClient: () => undefined,
      }),
      scope,
    );
    assert.strictEqual(notificationListenerCount, 1);
    assert.strictEqual(presentedListenerCount, 1);
    listeners.event?.({
      type: "user-input-requested",
      hostId: "default",
      conversation: {
        conversationId: "thread-1",
        title: "Question",
        threadSource: null,
        parentThreadId: null,
        source: null,
        sideConversationParentNavigationPath: null,
      },
      requestId: "request-1",
      turnId: "turn-1",
      questionCount: 1,
    });
    assert.isNotNull(listeners.action);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(notificationListenerCount, 0);
    assert.strictEqual(presentedListenerCount, 0);
    listeners.action?.({
      notificationId: "question-default-request-1",
      actionId: null,
      actionType: "open",
    });
    assert.strictEqual(dispatchedActionCount, 0);
  }),
);
