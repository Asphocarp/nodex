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

const transportFailure = (error: unknown): CanvasSceneMutationError => ({
  code: "unknown",
  message: error instanceof Error ? error.message : String(error),
  retryable: true,
  resetRequired: false,
});

export const createElectronCanvasSceneSyncAdapter = (
  bridge: ElectronRendererBridge,
  projectId: string,
): CanvasSceneSyncAdapter => {
  const subscriptions = new Map<
    string,
    {
      readonly request: CanvasSceneSubscribeRequest;
      readonly listeners: Set<(event: CanvasSceneRealtimeEvent) => void>;
      readonly leaseListeners: Set<NonNullable<Parameters<CanvasSceneSyncAdapter["subscribe"]>[2]>>;
      readonly removeBridgeListener: () => void;
      readonly ready: Promise<CanvasSceneSubscriptionCommandResult>;
    }
  >();
  const invoke = async <T>(channel: string, request: unknown): Promise<T> =>
    await bridge.invoke(channel, request) as T;
  return {
    subscribe(request, listener, leaseListener) {
      if (request.projectId !== projectId) {
        throw new TypeError("Canvas subscription crossed its Project boundary");
      }
      const key = JSON.stringify([request.documentId, request.clientSessionId]);
      let entry = subscriptions.get(key);
      if (!entry) {
        const listeners = new Set<(event: CanvasSceneRealtimeEvent) => void>();
        const leaseListeners = new Set<NonNullable<Parameters<CanvasSceneSyncAdapter["subscribe"]>[2]>>();
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
                  leaseListeners.forEach((active) => active(leaseEvent));
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
            listeners.forEach((active) => active(event));
          },
        );
        const ready = invoke<CanvasSceneSubscriptionCommandResult>(
          "canvas-scene:subscribe",
          fullRequest,
        );
        entry = { request: fullRequest, listeners, leaseListeners, removeBridgeListener, ready };
        subscriptions.set(key, entry);
      }
      entry.listeners.add(listener);
      if (leaseListener) entry.leaseListeners.add(leaseListener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        entry?.listeners.delete(listener);
        if (leaseListener) entry?.leaseListeners.delete(leaseListener);
        if (!entry || entry.listeners.size > 0 || entry.leaseListeners.size > 0) return;
        subscriptions.delete(key);
        entry.removeBridgeListener();
        void invoke<CanvasSceneSubscriptionCommandResult>(
          "canvas-scene:unsubscribe",
          entry.request,
        );
      };
    },
    async sync(request): Promise<CanvasSceneSyncCommandResult> {
      try {
        const entry = subscriptions.get(JSON.stringify([request.documentId, request.clientSessionId]));
        const ready = entry ? await entry.ready : null;
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
        const ready = entry ? await entry.ready : null;
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
