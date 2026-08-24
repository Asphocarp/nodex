import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { IpcEvents } from "../../shared/ipc-api";
import { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import { CodexFreshThreadLaunchRuntime } from "../codex-application/CodexFreshThreadLaunchRuntime";
import { CodexRendererConversationCoordinator } from "../codex-application/CodexRendererConversationCoordinator";
import { CodexRendererConversationRegistry } from "../codex-application/CodexRendererConversationRegistry";
import { CodexUserInputAutoResolution } from "../codex-application/CodexUserInputAutoResolution";
import {
  broadcastCodexHostMessageToRendererClients,
  sendRendererOwnerHostMessage,
  sendRendererThreadStreamControlRelay,
  sendRendererThreadStreamRelay,
} from "../codex/owner-follower-ipc-bridge";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { RendererClientRuntime } from "./RendererClientRuntime";
import { WindowRuntime } from "../window-runtime/WindowRuntime";

export const live: Layer.Layer<
  never,
  never,
  | CodexApplicationEventHub
  | CodexFreshThreadLaunchRuntime
  | CodexRendererConversationCoordinator
  | CodexRendererConversationRegistry
  | CodexUserInputAutoResolution
  | RendererClientRuntime
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const coordinator = yield* CodexRendererConversationCoordinator;
    const events = yield* CodexApplicationEventHub;
    const freshThreadLaunch = yield* CodexFreshThreadLaunchRuntime;
    const registry = yield* CodexRendererConversationRegistry;
    const rendererClients = yield* RendererClientRuntime;
    const userInputAutoResolution = yield* CodexUserInputAutoResolution;
    const windows = yield* WindowRuntime;
    yield* userInputAutoResolution.changes.pipe(
      Stream.runForEach((change) =>
        Effect.sync(() =>
          safeBroadcastToWindows(windows.all(), "codex:user-input:auto-resolution:changed", [
            change,
          ]),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* rendererClients.events.pipe(
      Stream.runForEach((event) =>
        event.kind === "connected"
          ? coordinator.handleClientConnected(event.clientId)
          : coordinator
              .handleClientDisposed(event.clientId)
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    freshThreadLaunch.releaseRenderer(
                      event.clientId,
                      new Error("Fresh thread owner disconnected"),
                    ),
                  ),
                ),
              ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    const broadcastWindows = <Channel extends keyof IpcEvents>(
      channel: Channel,
      payload: IpcEvents[Channel],
    ): void => {
      safeBroadcastToWindows(windows.all(), channel, [payload]);
    };
    const reportDeliveryFailure = (delivery: {
      readonly unavailableClientIds: readonly string[];
      readonly failedClientIds: readonly string[];
    }): Effect.Effect<void> =>
      coordinator.handleClientDeliveryFailure([
        ...delivery.unavailableClientIds,
        ...delivery.failedClientIds,
      ]);

    yield* events.events.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.kind === "codex") {
            rendererClients.broadcast("codex:event", [event.value]);
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
                ? registry.getFollowerClientIds(message.conversationId)
                : undefined;
            if (message.type === "threadStreamStateChanged" && targetClientIds !== undefined) {
              if (targetClientIds === null) return;
              yield* reportDeliveryFailure(
                sendRendererThreadStreamRelay(
                  rendererClients,
                  targetClientIds,
                  message.sourceClientId,
                  message,
                ),
              );
              return;
            }
            broadcastCodexHostMessageToRendererClients(
              rendererClients,
              (channel, args) => safeBroadcastToWindows(windows.all(), channel, args),
              message,
            );
            return;
          }
          if (event.kind === "rendererOwnerHostMessage") {
            sendRendererOwnerHostMessage(rendererClients, event.value);
            return;
          }
          if (event.kind === "rendererThreadStreamRelay") {
            yield* reportDeliveryFailure(
              sendRendererThreadStreamRelay(
                rendererClients,
                event.value.targetClientIds,
                event.value.sourceClientId,
                event.value.message,
              ),
            );
            return;
          }
          if (event.kind === "rendererThreadStreamControlRelay") {
            yield* reportDeliveryFailure(
              sendRendererThreadStreamControlRelay(
                rendererClients,
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
