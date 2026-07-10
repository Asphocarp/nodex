import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentApplyHttpAck,
  decodeDocumentHttpError,
  decodeDocumentRealtimeSseEvent,
  decodeDocumentSyncHttpResponse,
  encodeDocumentApplyHttpRequest,
  encodeDocumentAwarenessHttpRequest,
  encodeDocumentSyncHttpRequest,
} from "../../shared/block-documents/http-contract";
import type {
  DocumentAwarenessPublishAck,
  DocumentSyncApplyAck,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncErrorCode,
  DocumentSyncRealtimeEvent,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import { toApiUrl } from "./http-base";

interface EventSourceLike {
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null;
  close(): void;
}

interface HttpDocumentSyncAdapterOptions {
  readonly projectId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly createEventSource?: (url: string) => EventSourceLike;
  readonly toUrl?: (pathname: string) => string;
}

interface HttpSubscription {
  readonly request: DocumentSyncSubscribeRequest;
  readonly listeners: Set<(event: DocumentSyncRealtimeEvent) => void>;
  readonly openWaiters: Set<(opened: boolean) => void>;
  eventSource: EventSourceLike | null;
  opened: boolean;
  disposed: boolean;
  startupError?: DocumentSyncCommandError;
}

const DOCUMENT_SYNC_ERROR_CODES = new Set<DocumentSyncErrorCode>([
  "transport_unavailable",
  "request_cancelled",
  "unauthorized",
  "store_not_initialized",
  "store_epoch_mismatch",
  "document_not_found",
  "document_not_ready",
  "document_generation_mismatch",
  "unsupported_document_schema",
  "future_base_head",
  "invalid_document_update",
  "invalid_awareness_update",
  "document_update_missing_dependencies",
  "update_id_collision",
  "document_state_corrupt",
  "invalid_response",
  "unknown",
]);

const commandError = (
  code: DocumentSyncErrorCode,
  message: string,
  options: { readonly retryable?: boolean; readonly resetRequired?: boolean } = {},
): DocumentSyncCommandError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  resetRequired: options.resetRequired ?? false,
});

const transportError = (error: unknown): DocumentSyncCommandError =>
  commandError(
    "transport_unavailable",
    error instanceof Error ? error.message : "Document HTTP transport is unavailable",
    { retryable: true },
  );

const invalidResponse = (message: string): DocumentSyncCommandError =>
  commandError("invalid_response", message);

const failure = <T>(
  error: DocumentSyncCommandError,
): DocumentSyncCommandResult<T> => ({ ok: false, error });

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new TypeError(`${field} must be a non-empty string`);
};

const defaultEventSourceFactory = (url: string): EventSourceLike => {
  if (typeof EventSource === "undefined") {
    throw new Error("EventSource is unavailable");
  }
  return new EventSource(url);
};

const bytesToFetchBody = (bytes: Uint8Array): ArrayBuffer => {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
};

const subscriptionKey = (request: DocumentSyncSubscribeRequest): string =>
  JSON.stringify([request.clientSessionId, request.documentId]);

const makeSubscriptionPath = (
  projectId: string,
  request: DocumentSyncSubscribeRequest,
): string => {
  const query = new URLSearchParams({ clientSessionId: request.clientSessionId });
  return `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(request.documentId)}/events?${query.toString()}`;
};

const parseHttpError = async (response: Response): Promise<DocumentSyncCommandError> => {
  try {
    const error = decodeDocumentHttpError(await response.text());
    if (DOCUMENT_SYNC_ERROR_CODES.has(error.code)) return error;
  } catch {
    // The protocol error below is safer than exposing an arbitrary HTTP body.
  }
  return invalidResponse(`Document HTTP request failed with status ${response.status}`);
};

const assertBinaryResponse = (response: Response): void => {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType === DOCUMENT_HTTP_CONTENT_TYPE) return;
  throw new TypeError("Document HTTP response has an invalid Content-Type");
};

const parseBinaryResponse = async (response: Response): Promise<Uint8Array> => {
  assertBinaryResponse(response);
  return new Uint8Array(await response.arrayBuffer());
};

export const createHttpDocumentSyncAdapter = ({
  projectId: rawProjectId,
  fetch: fetchImplementation = globalThis.fetch,
  createEventSource = defaultEventSourceFactory,
  toUrl = toApiUrl,
}: HttpDocumentSyncAdapterOptions): DocumentSyncAdapter => {
  const projectId = requireIdentity(rawProjectId, "projectId");
  const subscriptions = new Map<string, HttpSubscription>();

  const requireOpenSubscription = async <T>(
    request: DocumentSyncSubscribeRequest,
  ): Promise<DocumentSyncCommandResult<T> | null> => {
    const subscription = subscriptions.get(subscriptionKey(request));
    if (!subscription || subscription.disposed) {
      return failure(commandError("unauthorized", "Document SSE subscription is not active"));
    }
    if (subscription.startupError) {
      return failure(subscription.startupError);
    }
    if (!subscription.opened) {
      const opened = await new Promise<boolean>((resolve) => {
        subscription.openWaiters.add(resolve);
      });
      if (!opened || subscription.disposed) {
        return failure(
          subscription.startupError ??
            commandError("request_cancelled", "Document SSE subscription was closed"),
        );
      }
    }
    return null;
  };

  const postBinary = async <T>(
    pathname: string,
    body: Uint8Array,
    decode: (bytes: Uint8Array) => T,
  ): Promise<DocumentSyncCommandResult<T>> => {
    let response: Response;
    try {
      response = await fetchImplementation(toUrl(pathname), {
        method: "POST",
        headers: {
          "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE,
          Accept: DOCUMENT_HTTP_CONTENT_TYPE,
        },
        body: bytesToFetchBody(body),
      });
    } catch (error) {
      return failure(transportError(error));
    }
    if (!response.ok) {
      return failure(await parseHttpError(response));
    }
    try {
      return { ok: true, value: decode(await parseBinaryResponse(response)) };
    } catch (error) {
      return failure(
        invalidResponse(
          error instanceof Error ? error.message : "Document HTTP response is invalid",
        ),
      );
    }
  };

  return {
    sync: async (request) => {
      const blocked = await requireOpenSubscription<DocumentSyncResponse>(request);
      if (blocked) return blocked;
      return postBinary(
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(request.documentId)}/sync`,
        encodeDocumentSyncHttpRequest(request),
        decodeDocumentSyncHttpResponse,
      );
    },
    applyUpdate: async (request) => {
      const blocked = await requireOpenSubscription<DocumentSyncApplyAck>(request);
      if (blocked) return blocked;
      return postBinary(
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(request.documentId)}/updates`,
        encodeDocumentApplyHttpRequest(request),
        decodeDocumentApplyHttpAck,
      );
    },
    publishAwareness: async (request) => {
      const blocked = await requireOpenSubscription<DocumentAwarenessPublishAck>(
        request,
      );
      if (blocked) return blocked;
      let response: Response;
      try {
        response = await fetchImplementation(
          toUrl(
            `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(request.documentId)}/awareness`,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE,
              Accept: "application/json",
            },
            body: bytesToFetchBody(encodeDocumentAwarenessHttpRequest(request)),
          },
        );
      } catch (error) {
        return failure(transportError(error));
      }
      if (!response.ok) return failure(await parseHttpError(response));
      try {
        const value = await response.json() as unknown;
        if (
          typeof value === "object" &&
          value !== null &&
          "accepted" in value &&
          value.accepted === true
        ) {
          return { ok: true, value: { accepted: true } };
        }
      } catch {
        // Return the typed protocol failure below.
      }
      return failure(invalidResponse("Document Awareness ACK is invalid"));
    },
    subscribe: (request, listener) => {
      const key = subscriptionKey(request);
      let subscription = subscriptions.get(key);
      if (!subscription) {
        const createdSubscription: HttpSubscription = {
          request: { ...request },
          listeners: new Set(),
          openWaiters: new Set(),
          eventSource: null,
          opened: false,
          disposed: false,
        };
        subscription = createdSubscription;
        subscriptions.set(key, createdSubscription);
        try {
          const eventSource = createEventSource(
            toUrl(makeSubscriptionPath(projectId, request)),
          );
          createdSubscription.eventSource = eventSource;
          eventSource.onopen = () => {
            if (createdSubscription.disposed) return;
            createdSubscription.opened = true;
            const waiters = [...createdSubscription.openWaiters];
            createdSubscription.openWaiters.clear();
            waiters.forEach((resolve) => resolve(true));
            createdSubscription.listeners.forEach((activeListener) =>
              activeListener({
                kind: "connection",
                documentId: request.documentId,
                state: "connected",
              }),
            );
          };
          eventSource.onerror = () => {
            if (createdSubscription.disposed) return;
            createdSubscription.opened = false;
            createdSubscription.listeners.forEach((activeListener) =>
              activeListener({
                kind: "connection",
                documentId: request.documentId,
                state: "disconnected",
              }),
            );
          };
          eventSource.onmessage = (message) => {
            if (createdSubscription.disposed) return;
            let event: DocumentSyncRealtimeEvent;
            try {
              event = decodeDocumentRealtimeSseEvent(message.data);
            } catch {
              return;
            }
            if (event.documentId !== request.documentId) return;
            createdSubscription.listeners.forEach((activeListener) =>
              activeListener(event),
            );
          };
        } catch (error) {
          createdSubscription.startupError = transportError(error);
          const waiters = [...createdSubscription.openWaiters];
          createdSubscription.openWaiters.clear();
          waiters.forEach((resolve) => resolve(false));
        }
      }
      subscription.listeners.add(listener);

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscription?.listeners.delete(listener);
        if (!subscription || subscription.listeners.size > 0) return;
        subscription.disposed = true;
        const waiters = [...subscription.openWaiters];
        subscription.openWaiters.clear();
        waiters.forEach((resolve) => resolve(false));
        subscription.eventSource?.close();
        subscriptions.delete(key);
      };
    },
  };
};
