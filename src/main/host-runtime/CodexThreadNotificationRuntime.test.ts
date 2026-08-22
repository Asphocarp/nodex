import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type { DesktopNotificationActionPayload } from "../../shared/types";
import type { CodexApplicationEvent } from "../codex-application/CodexApplicationEventHub";
import { live } from "./CodexThreadNotificationRuntime";

it.effect("releases every Codex notification listener with the Main Scope", () =>
  Effect.gen(function* () {
    const listeners: {
      action: ((action: DesktopNotificationActionPayload) => void) | null;
    } = { action: null };
    let dispatchedActionCount = 0;
    let dismissedCount = 0;
    const applicationEvents = yield* PubSub.unbounded<CodexApplicationEvent>();
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        events: {
          events: Stream.fromPubSub(applicationEvents),
          publish: (event) => {
            PubSub.publishUnsafe(applicationEvents, event);
          },
        },
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
        dismissNotification: () => {
          dismissedCount += 1;
        },
        dispatchAction: () => {
          dispatchedActionCount += 1;
          return true;
        },
        focusTargetClient: () => undefined,
      }),
      scope,
    );
    yield* Effect.yieldNow;
    yield* PubSub.publish(applicationEvents, {
      kind: "threadNotification",
      value: {
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
      },
    });
    yield* PubSub.publish(applicationEvents, {
      kind: "rendererConversationPresentedInForeground",
      value: "thread-1",
    });
    yield* Effect.yieldNow;
    assert.isNotNull(listeners.action);
    assert.strictEqual(dismissedCount, 1);

    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(applicationEvents, {
      kind: "rendererConversationPresentedInForeground",
      value: "thread-1",
    });
    yield* Effect.yieldNow;
    assert.strictEqual(dismissedCount, 1);
    listeners.action?.({
      notificationId: "question-default-request-1",
      actionId: null,
      actionType: "open",
    });
    assert.strictEqual(dispatchedActionCount, 0);
  }),
);
