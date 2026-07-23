import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationError,
  CanvasSceneRealtimeEvent,
  CanvasSceneSubscribeRequest,
  CanvasSceneSubscriptionCommandResult,
  CanvasSceneSyncCommandResult,
} from "../../shared/block-documents";
import type { CanvasSceneSyncAdapter } from "./canvas-scene-provider";
import type { ElectronRendererBridge } from "./electron-renderer-transport";
import { decodeDocumentRealtimeSseEvent } from "../../shared/block-documents/http-contract";
import {
  createExactRemoteSubscriptionLifecycle,
  type ExactRemoteSubscriptionLifecycle,
} from "./exact-remote-subscription-lifecycle";

const transportFailure = (error: unknown): CanvasSceneMutationError => ({
  code: "unknown",
  message: error instanceof Error ? error.message : String(error),
  retryable: true,
  resetRequired: false,
});

interface ElectronCanvasSubscriber {
  readonly listener: (event: CanvasSceneRealtimeEvent) => void;
  readonly leaseListener?: NonNullable<
    Parameters<CanvasSceneSyncAdapter["subscribe"]>[2]
  >;
}

interface ElectronCanvasSubscription {
  readonly subscribers: Set<ElectronCanvasSubscriber>;
  readonly lifecycle: ExactRemoteSubscriptionLifecycle<
    CanvasSceneSubscriptionCommandResult
  >;
}

export const createElectronCanvasSceneSyncAdapter = (
  bridge: ElectronRendererBridge,
  projectId: string,
): CanvasSceneSyncAdapter => {
  const subscriptions = new Map<string, ElectronCanvasSubscription>();
  const invoke = async <T>(channel: string, request: unknown): Promise<T> =>
    await bridge.invoke(channel, request) as T;
  const invokeSubscription = async (
    channel: string,
    request: CanvasSceneSubscribeRequest,
  ): Promise<CanvasSceneSubscriptionCommandResult> => {
    try {
      return await invoke(channel, request);
    } catch (error) {
      return { ok: false, error: transportFailure(error) };
    }
  };
  const ensureRemoteSubscription = (
    entry: ElectronCanvasSubscription,
  ): Promise<CanvasSceneSubscriptionCommandResult> =>
    entry.lifecycle.ensure();
  return {
    subscribe(request, listener, leaseListener) {
      if (request.projectId !== projectId) {
        throw new TypeError("Canvas subscription crossed its Project boundary");
      }
      const key = JSON.stringify([request.documentId, request.clientSessionId]);
      let entry = subscriptions.get(key);
      if (!entry) {
        const subscribers = new Set<ElectronCanvasSubscriber>();
        const fullRequest = { version: 1 as const, ...request };
        const removeBridgeListener = bridge.on(
          "document-sync:event",
          (...args: unknown[]) => {
            const event = args[0] as CanvasSceneRealtimeEvent | import("./canvas-scene-provider").CanvasSceneRelocationLeaseEvent;
            if (event && "kind" in event) {
              try {
                const leaseEvent = decodeDocumentRealtimeSseEvent(JSON.stringify(event));
                if (
                  (leaseEvent.kind === "relocation-lease-prepare" ||
                    leaseEvent.kind === "relocation-lease-release" ||
                    leaseEvent.kind === "relocation-lease-cancel") &&
                  leaseEvent.documentId === request.documentId &&
                  leaseEvent.clientSessionId === request.clientSessionId
                ) {
                  subscribers.forEach((subscriber) =>
                    subscriber.leaseListener?.(leaseEvent)
                  );
                }
              } catch {
                // Invalid main-to-renderer events never cross the adapter boundary.
              }
              return;
            }
            if (
              !event ||
              (event.type !== "canvas_scene_committed" &&
                event.type !== "canvas_scene_resync_required") ||
              event.projectId !== projectId ||
              event.documentId !== request.documentId
            ) {
              return;
            }
            subscribers.forEach((subscriber) =>
              subscriber.listener(event)
            );
          },
        );
        const lifecycle = createExactRemoteSubscriptionLifecycle<
          CanvasSceneSubscriptionCommandResult
        >({
          hasSubscribers: () => subscribers.size > 0,
          open: async () =>
            await invokeSubscription("canvas-scene:subscribe", fullRequest),
          isOpenResult: (result) => result.ok,
          alreadyOpenResult: () => ({
            ok: true,
            value: { subscribed: true },
          }),
          inactiveResult: () => ({
            ok: false,
            error: {
              code: "project_scope_mismatch",
              message: "Canvas scene subscription is not active",
              retryable: false,
              resetRequired: false,
            },
          }),
          close: async () => {
            await invokeSubscription("canvas-scene:unsubscribe", fullRequest);
          },
          finalize: () => {
            if (subscriptions.get(key)?.lifecycle === lifecycle) {
              subscriptions.delete(key);
            }
            removeBridgeListener();
          },
        });
        const createdEntry: ElectronCanvasSubscription = {
          subscribers,
          lifecycle,
        };
        entry = createdEntry;
        subscriptions.set(key, entry);
      }
      const subscriber: ElectronCanvasSubscriber = {
        listener,
        leaseListener,
      };
      entry.subscribers.add(subscriber);
      void ensureRemoteSubscription(entry);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        entry?.subscribers.delete(subscriber);
        if (!entry || entry.subscribers.size > 0) return;
        entry.lifecycle.releaseIfIdle();
      };
    },
    async sync(request): Promise<CanvasSceneSyncCommandResult> {
      try {
        const entry = subscriptions.get(JSON.stringify([request.documentId, request.clientSessionId]));
        const ready = entry ? await ensureRemoteSubscription(entry) : null;
        if (!ready?.ok) {
          return { ok: false, error: ready?.error ?? {
            code: "project_scope_mismatch",
            message: "Canvas scene subscription is not active",
            retryable: false,
            resetRequired: false,
          } };
        }
        return await invoke("canvas-scene:sync", request);
      } catch (error) {
        return { ok: false, error: transportFailure(error) };
      }
    },
    async applyMutation(request): Promise<CanvasSceneMutationCommandResult> {
      try {
        const entry = subscriptions.get(JSON.stringify([request.documentId, request.clientSessionId]));
        const ready = entry ? await ensureRemoteSubscription(entry) : null;
        if (!ready?.ok) {
          return { ok: false, error: ready?.error ?? {
            code: "project_scope_mismatch",
            message: "Canvas scene subscription is not active",
            retryable: false,
            resetRequired: false,
            mutationId: request.mutationId,
          } };
        }
        return await invoke("canvas-scene:apply", request);
      } catch (error) {
        return { ok: false, error: { ...transportFailure(error), mutationId: request.mutationId } };
      }
    },
    async respondToRelocationLease(request) {
      try {
        return await invoke("document-sync:relocation-lease:respond", request);
      } catch (error) {
        return { ok: false, error: {
          code: "transport_unavailable",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          resetRequired: false,
        } };
      }
    },
  };
};
