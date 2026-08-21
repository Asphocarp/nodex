import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { CodexHostMessage } from "../../shared/types";
import type { IpcEvents } from "../../shared/ipc-api";
import type { CodexService } from "../codex/codex-service";
import {
  broadcastCodexHostMessageToRendererClients,
  sendRendererOwnerHostMessage,
  sendRendererThreadStreamControlRelay,
  sendRendererThreadStreamRelay,
} from "../codex/owner-follower-ipc-bridge";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";

export interface CodexRendererProjectionRuntimeOptions {
  readonly codex: CodexService;
  readonly rendererClients: RendererClientRouter;
  readonly windows: WindowRuntimeService;
}

export const live = (options: CodexRendererProjectionRuntimeOptions): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        const broadcastWindows = <Channel extends keyof IpcEvents>(
          channel: Channel,
          payload: IpcEvents[Channel],
        ): void => {
          safeBroadcastToWindows(options.windows.all(), channel, [payload]);
        };
        const reportDeliveryFailure = (delivery: {
          readonly unavailableClientIds: readonly string[];
          readonly failedClientIds: readonly string[];
        }): void => {
          options.codex.handleRendererClientDeliveryFailure([
            ...delivery.unavailableClientIds,
            ...delivery.failedClientIds,
          ]);
        };
        const onEvent = (event: IpcEvents["codex:event"]): void => {
          options.rendererClients.broadcast("codex:event", [event]);
          if (event.type === "scheduledAutomationChanged") {
            broadcastWindows("codex:scheduled-automations:changed", event.event);
          }
          if (event.type === "automationRunsUpdated") {
            broadcastWindows("codex:automation-runs:updated", event.event);
          }
        };
        const onHostMessage = (message: CodexHostMessage): void => {
          const targetClientIds =
            message.type === "threadStreamStateChanged"
              ? options.codex.getRendererConversationFollowerClientIds(message.conversationId)
              : undefined;
          if (message.type === "threadStreamStateChanged" && targetClientIds !== undefined) {
            if (targetClientIds === null) return;
            reportDeliveryFailure(
              sendRendererThreadStreamRelay(
                options.rendererClients,
                targetClientIds,
                message.sourceClientId,
                message,
              ),
            );
            return;
          }
          broadcastCodexHostMessageToRendererClients(
            options.rendererClients,
            (channel, args) => safeBroadcastToWindows(options.windows.all(), channel, args),
            message,
          );
        };
        const onUserInputAutoResolutionChanged = (
          change: IpcEvents["codex:user-input:auto-resolution:changed"],
        ): void => broadcastWindows("codex:user-input:auto-resolution:changed", change);
        const onRendererOwnerHostMessage = (event: {
          readonly targetClientId: string;
          readonly message: unknown;
        }): void => {
          sendRendererOwnerHostMessage(options.rendererClients, event);
        };
        const onRendererThreadStreamRelay = (event: {
          readonly targetClientIds: readonly string[];
          readonly sourceClientId: string | null;
          readonly message: CodexHostMessage;
        }): void => {
          reportDeliveryFailure(
            sendRendererThreadStreamRelay(
              options.rendererClients,
              event.targetClientIds,
              event.sourceClientId,
              event.message,
            ),
          );
        };
        const onRendererThreadStreamControlRelay = (event: {
          readonly targetClientIds: readonly string[];
          readonly message: Extract<
            CodexHostMessage,
            { type: "threadStreamFollowersChanged" | "threadStreamTransportReset" }
          >;
        }): void => {
          reportDeliveryFailure(
            sendRendererThreadStreamControlRelay(
              options.rendererClients,
              event.targetClientIds,
              event.message,
            ),
          );
        };
        const onPendingWorktreesChanged = (
          event: IpcEvents["codex:pending-worktrees:changed"],
        ): void => broadcastWindows("codex:pending-worktrees:changed", event);
        const onPendingWorktreeWarning = (
          event: IpcEvents["codex:pending-worktree:warning"],
        ): void => broadcastWindows("codex:pending-worktree:warning", event);
        const onAgentImportProgress = (event: IpcEvents["agent-import:progress"]): void =>
          broadcastWindows("agent-import:progress", event);

        options.codex.on("event", onEvent);
        options.codex.on("hostMessage", onHostMessage);
        options.codex.on("userInputAutoResolutionChanged", onUserInputAutoResolutionChanged);
        options.codex.on("rendererOwnerHostMessage", onRendererOwnerHostMessage);
        options.codex.on("rendererThreadStreamRelay", onRendererThreadStreamRelay);
        options.codex.on("rendererThreadStreamControlRelay", onRendererThreadStreamControlRelay);
        options.codex.on("pendingWorktreesChanged", onPendingWorktreesChanged);
        options.codex.on("pendingWorktreeWarning", onPendingWorktreeWarning);
        options.codex.on("agentImportProgress", onAgentImportProgress);
        const releaseDisposed = options.rendererClients.addClientDisposedListener((event) => {
          options.codex.handleRendererClientDisposed(event.clientId);
        });
        const releaseConnected = options.rendererClients.addClientConnectedListener((event) => {
          options.codex.handleRendererClientConnected(event.clientId);
        });

        return () => {
          releaseConnected();
          releaseDisposed();
          options.codex.off("agentImportProgress", onAgentImportProgress);
          options.codex.off("pendingWorktreeWarning", onPendingWorktreeWarning);
          options.codex.off("pendingWorktreesChanged", onPendingWorktreesChanged);
          options.codex.off("rendererThreadStreamControlRelay", onRendererThreadStreamControlRelay);
          options.codex.off("rendererThreadStreamRelay", onRendererThreadStreamRelay);
          options.codex.off("rendererOwnerHostMessage", onRendererOwnerHostMessage);
          options.codex.off("userInputAutoResolutionChanged", onUserInputAutoResolutionChanged);
          options.codex.off("hostMessage", onHostMessage);
          options.codex.off("event", onEvent);
        };
      }),
      (release) => Effect.sync(release),
    ).pipe(Effect.asVoid),
  );
