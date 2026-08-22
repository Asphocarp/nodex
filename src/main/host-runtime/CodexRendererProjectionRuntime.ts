import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { IpcEvents } from "../../shared/ipc-api";
import type { CodexService } from "../codex/codex-service";
import type { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import type { CodexUserInputAutoResolution } from "../codex-application/CodexUserInputAutoResolution";
import {
  broadcastCodexHostMessageToRendererClients,
  sendRendererOwnerHostMessage,
  sendRendererThreadStreamControlRelay,
  sendRendererThreadStreamRelay,
} from "../codex/owner-follower-ipc-bridge";
import type { RendererClientRuntimeService } from "../codex/renderer-client-runtime-contracts";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";

export interface CodexRendererProjectionRuntimeOptions {
  readonly codex: CodexService;
  readonly events: CodexApplicationEventHub["Service"];
  readonly rendererClients: RendererClientRuntimeService;
  readonly userInputAutoResolution: CodexUserInputAutoResolution["Service"];
  readonly windows: WindowRuntimeService;
}

export const live = (options: CodexRendererProjectionRuntimeOptions): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* options.userInputAutoResolution.changes.pipe(
        Stream.runForEach((change) =>
          Effect.sync(() =>
            safeBroadcastToWindows(
              options.windows.all(),
              "codex:user-input:auto-resolution:changed",
              [change],
            ),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* options.rendererClients.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.kind === "connected") {
              options.codex.handleRendererClientConnected(event.clientId);
              return;
            }
            options.codex.handleRendererClientDisposed(event.clientId);
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
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

      yield* options.events.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.kind === "codex") {
              options.rendererClients.broadcast("codex:event", [event.value]);
              if (event.value.type === "scheduledAutomationChanged") {
                broadcastWindows("codex:scheduled-automations:changed", event.value.event);
              }
              if (event.value.type === "automationRunsUpdated") {
                broadcastWindows("codex:automation-runs:updated", event.value.event);
              }
              return;
            }
            if (event.kind === "hostMessage") {
              const message = event.value;
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
              return;
            }
            if (event.kind === "rendererOwnerHostMessage") {
              sendRendererOwnerHostMessage(options.rendererClients, event.value);
              return;
            }
            if (event.kind === "rendererThreadStreamRelay") {
              reportDeliveryFailure(
                sendRendererThreadStreamRelay(
                  options.rendererClients,
                  event.value.targetClientIds,
                  event.value.sourceClientId,
                  event.value.message,
                ),
              );
              return;
            }
            if (event.kind === "rendererThreadStreamControlRelay") {
              reportDeliveryFailure(
                sendRendererThreadStreamControlRelay(
                  options.rendererClients,
                  event.value.targetClientIds,
                  event.value.message,
                ),
              );
              return;
            }
            if (event.kind === "pendingWorktreesChanged") {
              broadcastWindows("codex:pending-worktrees:changed", event.value);
              return;
            }
            if (event.kind === "pendingWorktreeWarning") {
              broadcastWindows("codex:pending-worktree:warning", event.value);
              return;
            }
            if (event.kind === "agentImportProgress") {
              broadcastWindows("agent-import:progress", event.value);
            }
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
    }),
  );
