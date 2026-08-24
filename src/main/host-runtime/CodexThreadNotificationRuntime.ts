import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import { CodexRendererConversationRegistry } from "../codex-application/CodexRendererConversationRegistry";
import { makeCodexThreadNotificationHandler } from "../codex/codex-thread-notification-handler";
import { getThreadNotificationSettings } from "../local-store/config";
import { getLogger } from "../logging/logger";
import { WindowRuntime } from "../window-runtime/WindowRuntime";
import { DesktopNotificationRuntime } from "./DesktopNotificationRuntime";
import { RendererClientRuntime } from "./RendererClientRuntime";

const logger = getLogger({ component: "codex-thread-notification-runtime" });

/** Owns native-notification ingress and action admission for exactly one Main Scope. */
export const live: Layer.Layer<
  never,
  never,
  | CodexApplicationEventHub
  | CodexRendererConversationRegistry
  | DesktopNotificationRuntime
  | RendererClientRuntime
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* CodexApplicationEventHub;
    const conversations = yield* CodexRendererConversationRegistry;
    const notifications = yield* DesktopNotificationRuntime;
    const rendererClients = yield* RendererClientRuntime;
    const windows = yield* WindowRuntime;
    let accepting = true;
    const handle = makeCodexThreadNotificationHandler({
      getSettings: getThreadNotificationSettings,
      isAppForegrounded: () => conversations.hasForegroundClient(),
      isConversationPresentedInForeground: (conversationId) =>
        conversations.isPresentedInForeground(conversationId),
      resolveTargetClientId: (conversationId) => {
        const presenting = conversations.resolvePresentedSurfaceClient(conversationId);
        if (presenting) return presenting;
        const fallbackWindow = windows.getLastFocused();
        if (!fallbackWindow) return null;
        return rendererClients.getClientIdForWebContentsId(fallbackWindow.webContents.id);
      },
      showNotification: (notification, targetClientId, onAction) => {
        const webContentsId = rendererClients.getWebContentsIdForClientId(targetClientId);
        if (webContentsId === null) return;
        const targetWindow = windows.get(webContentsId);
        if (!targetWindow || targetWindow.isDestroyed()) return;
        notifications.show(notification, targetWindow.webContents, (action) => {
          if (accepting) onAction(action);
        });
      },
      dismissNotification: notifications.dismiss,
      dispatchAction: (targetClientId, action) =>
        rendererClients.sendToClient(targetClientId, "desktop-notification:action", [action]),
      focusTargetClient: (targetClientId) => {
        const webContentsId = rendererClients.getWebContentsIdForClientId(targetClientId);
        if (webContentsId === null) return;
        const targetWindow = windows.get(webContentsId);
        if (!targetWindow || targetWindow.isDestroyed()) return;
        if (targetWindow.isMinimized()) targetWindow.restore();
        targetWindow.show();
        targetWindow.focus();
      },
      logger,
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        accepting = false;
      }),
    );
    yield* events.events.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.kind === "threadNotification") {
            handle(event.value);
            return;
          }
          if (event.kind === "rendererConversationPresentedInForeground") {
            notifications.dismiss({ conversationId: event.value });
          }
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
  }),
);
