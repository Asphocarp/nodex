import {
  CANVAS_SCENE_HTTP_CONTENT_TYPE,
  decodeCanvasSceneMutationResultHttp,
  decodeCanvasSceneSseEvent,
  decodeCanvasSceneSyncResultHttp,
  encodeCanvasSceneMutationRequestHttp,
  encodeCanvasSceneSyncRequestHttp,
} from "../../shared/block-documents/canvas-scene-http-contract";
import type {
  DocumentRelocationLeaseResponseAck,
  DocumentSyncCommandResult,
} from "../../shared/block-documents/document-sync";
import type { CanvasSceneRealtimeEvent } from "../../shared/block-documents";
import type { CanvasSceneSyncAdapter } from "./canvas-scene-provider";
import { toApiUrl } from "./http-base";
import { decodeDocumentRealtimeSseEvent } from "../../shared/block-documents/http-contract";

interface EventSourceLike {
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null;
  close(): void;
}

interface HttpCanvasSubscriber {
  readonly listener: (event: CanvasSceneRealtimeEvent) => void;
  readonly leaseListener?: NonNullable<
    Parameters<CanvasSceneSyncAdapter["subscribe"]>[2]
  >;
}

interface HttpCanvasSubscription {
  readonly source: EventSourceLike;
  readonly subscribers: Set<HttpCanvasSubscriber>;
  readonly openWaiters: Set<(opened: boolean) => void>;
  opened: boolean;
  openedOnce: boolean;
  disposed: boolean;
  boundary?: {
    readonly storeEpoch: string;
    readonly generation: number;
    readonly headSeq: number;
  };
}

export const createHttpCanvasSceneSyncAdapter = (options: {
  readonly projectId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly createEventSource?: (url: string) => EventSourceLike;
  readonly toUrl?: (pathname: string) => string;
}): CanvasSceneSyncAdapter => {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const toUrl = options.toUrl ?? toApiUrl;
  const createEventSource = options.createEventSource ?? ((url: string) => new EventSource(url));
  const subscriptions = new Map<string, HttpCanvasSubscription>();
  const subscriptionKey = (documentId: string, clientSessionId: string): string =>
    JSON.stringify([documentId, clientSessionId]);
  const readCanvasResponse = async (response: Response): Promise<string> => {
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (contentType !== CANVAS_SCENE_HTTP_CONTENT_TYPE) {
      throw new TypeError("Canvas HTTP response has an invalid Content-Type");
    }
    return await response.text();
  };
  const requireOpen = async (key: string): Promise<void> => {
    const subscription = subscriptions.get(key);
    if (!subscription || subscription.disposed) {
      throw new Error("Canvas SSE subscription is not active");
    }
    if (subscription.opened) return;
    const opened = await new Promise<boolean>((resolve) => {
      subscription.openWaiters.add(resolve);
    });
    if (!opened) throw new Error("Canvas SSE subscription is disconnected");
  };
  return {
    subscribe(request, listener, leaseListener) {
      if (request.projectId !== options.projectId) {
        throw new TypeError("Canvas subscription crossed its Project boundary");
      }
      const key = subscriptionKey(request.documentId, request.clientSessionId);
      let subscription = subscriptions.get(key);
      if (!subscription) {
        const query = new URLSearchParams({
          clientSessionId: request.clientSessionId,
        });
        const source = createEventSource(toUrl(
          `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/events?${query.toString()}`,
        ));
        const createdSubscription: HttpCanvasSubscription = {
          source,
          subscribers: new Set(),
          openWaiters: new Set(),
          opened: false,
          openedOnce: false,
          disposed: false,
        };
        subscription = createdSubscription;
        subscriptions.set(key, createdSubscription);
        source.onopen = () => {
          if (createdSubscription.disposed) return;
          const reconnect = createdSubscription.openedOnce;
          createdSubscription.opened = true;
          createdSubscription.openedOnce = true;
          const waiters = [...createdSubscription.openWaiters];
          createdSubscription.openWaiters.clear();
          waiters.forEach((resolve) => resolve(true));
          if (reconnect && createdSubscription.boundary) {
            const event: CanvasSceneRealtimeEvent = {
              type: "canvas_scene_resync_required",
              version: 1,
              projectId: request.projectId,
              documentId: request.documentId,
              ...createdSubscription.boundary,
            };
            createdSubscription.subscribers.forEach((subscriber) =>
              subscriber.listener(event)
            );
          }
        };
        source.onerror = () => {
          if (createdSubscription.disposed) return;
          createdSubscription.opened = false;
          const waiters = [...createdSubscription.openWaiters];
          createdSubscription.openWaiters.clear();
          waiters.forEach((resolve) => resolve(false));
        };
        source.onmessage = (message: MessageEvent<string>) => {
          if (createdSubscription.disposed) return;
          try {
            const raw = JSON.parse(message.data) as unknown;
            if (
              typeof raw === "object" && raw !== null && "kind" in raw &&
              (
                raw.kind === "relocation-lease-prepare" ||
                raw.kind === "relocation-lease-release" ||
                raw.kind === "relocation-lease-cancel"
              )
            ) {
              const event = decodeDocumentRealtimeSseEvent(message.data);
              if (
                event.kind === "relocation-lease-prepare" ||
                event.kind === "relocation-lease-release" ||
                event.kind === "relocation-lease-cancel"
              ) {
                createdSubscription.subscribers.forEach((subscriber) =>
                  subscriber.leaseListener?.(event)
                );
              }
              return;
            }
            const event = decodeCanvasSceneSseEvent(message.data);
            createdSubscription.subscribers.forEach((subscriber) =>
              subscriber.listener(event)
            );
          } catch {
            // A later full sync repairs a malformed or missed realtime event.
          }
        };
      }
      const subscriber: HttpCanvasSubscriber = { listener, leaseListener };
      subscription.subscribers.add(subscriber);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscription.subscribers.delete(subscriber);
        if (subscription.subscribers.size > 0) return;
        subscription.disposed = true;
        if (subscriptions.get(key) === subscription) {
          subscriptions.delete(key);
        }
        subscription.openWaiters.forEach((resolve) => resolve(false));
        subscription.openWaiters.clear();
        subscription.source.close();
      };
    },
    async sync(request) {
      try {
        const key = subscriptionKey(request.documentId, request.clientSessionId);
        await requireOpen(key);
        const response = await fetchImplementation(toUrl(
          `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/sync`,
        ), {
          method: "POST",
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE, Accept: CANVAS_SCENE_HTTP_CONTENT_TYPE },
          body: encodeCanvasSceneSyncRequestHttp(request),
        });
        const result = decodeCanvasSceneSyncResultHttp(await readCanvasResponse(response));
        if (result.ok) {
          const subscription = subscriptions.get(key);
          if (subscription) subscription.boundary = {
            storeEpoch: result.value.storeEpoch,
            generation: result.value.generation,
            headSeq: result.value.headSeq,
          };
        }
        return result;
      } catch (error) {
        return { ok: false, error: { code: "unknown", message: error instanceof Error ? error.message : String(error), retryable: true, resetRequired: false } };
      }
    },
    async applyMutation(request) {
      try {
        const key = subscriptionKey(request.documentId, request.clientSessionId);
        await requireOpen(key);
        const response = await fetchImplementation(toUrl(
          `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/mutations`,
        ), {
          method: "POST",
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE, Accept: CANVAS_SCENE_HTTP_CONTENT_TYPE },
          body: encodeCanvasSceneMutationRequestHttp(request),
        });
        const result = decodeCanvasSceneMutationResultHttp(await readCanvasResponse(response));
        if (result.ok) {
          const subscription = subscriptions.get(key);
          if (subscription) subscription.boundary = {
            storeEpoch: result.value.storeEpoch,
            generation: result.value.generation,
            headSeq: result.value.headSeq,
          };
        }
        return result;
      } catch (error) {
        return { ok: false, error: { code: "unknown", message: error instanceof Error ? error.message : String(error), retryable: true, resetRequired: false, mutationId: request.mutationId } };
      }
    },
    async respondToRelocationLease(request) {
      try {
        const response = await fetchImplementation(toUrl(
          `/api/projects/${encodeURIComponent(options.projectId)}/documents/${encodeURIComponent(request.documentId)}/relocation-leases/${encodeURIComponent(request.leaseId)}/responses`,
        ), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) throw new Error(`Lease response failed with status ${response.status}`);
        return {
          ok: true,
          value: await response.json() as DocumentRelocationLeaseResponseAck,
        } satisfies DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
      } catch (error) {
        return { ok: false, error: { code: "transport_unavailable", message: error instanceof Error ? error.message : String(error), retryable: true, resetRequired: false } };
      }
    },
  };
};
