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
  DocumentSyncRealtimeEvent,
} from "../../shared/block-documents/document-sync";
import type { CanvasSceneSyncAdapter } from "./canvas-scene-provider";
import { toApiUrl } from "./http-base";

interface EventSourceLike {
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null;
  close(): void;
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
  const readyBySubscription = new Map<string, Promise<void>>();
  const subscriptionKey = (documentId: string, clientSessionId: string): string =>
    JSON.stringify([documentId, clientSessionId]);
  return {
    subscribe(request, listener, leaseListener) {
      if (request.projectId !== options.projectId) {
        throw new TypeError("Canvas subscription crossed its Project boundary");
      }
      const query = new URLSearchParams({ clientSessionId: request.clientSessionId });
      const source = createEventSource(toUrl(
        `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/events?${query.toString()}`,
      ));
      const key = subscriptionKey(request.documentId, request.clientSessionId);
      const ready = new Promise<void>((resolve) => {
        source.onopen = () => resolve();
      });
      readyBySubscription.set(key, ready);
      source.onmessage = (message: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(message.data) as unknown;
          if (
            typeof raw === "object" && raw !== null && "kind" in raw &&
            (raw.kind === "relocation-lease-prepare" || raw.kind === "relocation-lease-release" || raw.kind === "relocation-lease-cancel")
          ) {
            leaseListener?.(raw as DocumentSyncRealtimeEvent & { kind: "relocation-lease-prepare" });
            return;
          }
          listener(decodeCanvasSceneSseEvent(message.data));
        } catch {
          // A later full sync repairs a malformed or missed realtime event.
        }
      };
      return () => {
        readyBySubscription.delete(key);
        source.close();
      };
    },
    async sync(request) {
      try {
        await readyBySubscription.get(
          subscriptionKey(request.documentId, request.clientSessionId),
        );
        const response = await fetchImplementation(toUrl(
          `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/sync`,
        ), {
          method: "POST",
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE, Accept: CANVAS_SCENE_HTTP_CONTENT_TYPE },
          body: encodeCanvasSceneSyncRequestHttp(request),
        });
        return decodeCanvasSceneSyncResultHttp(await response.text());
      } catch (error) {
        return { ok: false, error: { code: "unknown", message: error instanceof Error ? error.message : String(error), retryable: true, resetRequired: false } };
      }
    },
    async applyMutation(request) {
      try {
        await readyBySubscription.get(
          subscriptionKey(request.documentId, request.clientSessionId),
        );
        const response = await fetchImplementation(toUrl(
          `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/canvas/mutations`,
        ), {
          method: "POST",
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE, Accept: CANVAS_SCENE_HTTP_CONTENT_TYPE },
          body: encodeCanvasSceneMutationRequestHttp(request),
        });
        return decodeCanvasSceneMutationResultHttp(await response.text());
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
