import type {
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncAdapter,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
} from "./types";

interface ActiveSubscription {
  readonly ready: Promise<void>;
  close(): void;
}

const subscriptionKey = (
  request: Pick<DocumentSyncSubscribeRequest, "clientSessionId" | "documentId">,
): string => JSON.stringify([request.clientSessionId, request.documentId]);

export const createCoreDocumentSyncAdapter = (
  client: CoreClientPort,
): DocumentSyncAdapter => {
  const subscriptions = new Map<string, ActiveSubscription>();
  const lastSequences = new Map<string, number>();

  const requireSubscription = (
    request: Pick<DocumentSyncSubscribeRequest, "clientSessionId" | "documentId">,
  ): Promise<void> => {
    const subscription = subscriptions.get(subscriptionKey(request));
    if (subscription) return subscription.ready;
    return Promise.reject(
      new Error("Owned Document sync requires an active event subscription"),
    );
  };

  const sync = async (
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
    try {
      await requireSubscription(request);
      return success(await client.documentSync(request));
    } catch (error) {
      return failure(error);
    }
  };

  const applyUpdate = async (
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
    try {
      await requireSubscription(request);
      return success(await client.documentApplyUpdate(request));
    } catch (error) {
      return failure(error);
    }
  };

  const subscribe = (
    request: DocumentSyncSubscribeRequest,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ): (() => void) => {
    const key = subscriptionKey(request);
    subscriptions.get(key)?.close();
    let active = true;
    let opened: CoreEventSubscription | undefined;
    const ready = client
      .openDocumentEventStream(
        {
          documentId: request.documentId,
          clientSessionId: request.clientSessionId,
          after: lastSequences.get(key) ?? 0,
        },
        (envelope) => {
          const event = documentEvent(request, envelope);
          if (!event) return;
          const previous = lastSequences.get(key) ?? 0;
          if (envelope.event.sequence <= previous) return;
          lastSequences.set(key, envelope.event.sequence);
          listener(event);
        },
        (resync) => {
          lastSequences.set(key, resync.event_head);
          listener({
            kind: "resync-required",
            documentId: resync.document_id,
            storeEpoch: resync.store_epoch,
            generation: resync.generation,
            headSeq: resync.head_seq,
            reason: "history-compacted",
          });
        },
        (event) => listener(event),
      )
      .then((subscription) => {
        opened = subscription;
        if (!active) {
          subscription.close();
          return;
        }
        listener({
          kind: "connection",
          documentId: request.documentId,
          state: "connected",
        });
      });
    const subscription: ActiveSubscription = {
      ready,
      close: () => {
        if (!active) return;
        active = false;
        opened?.close();
        if (subscriptions.get(key) === subscription) {
          subscriptions.delete(key);
        }
        listener({
          kind: "connection",
          documentId: request.documentId,
          state: "disconnected",
        });
      },
    };
    subscriptions.set(key, subscription);
    void ready.catch(() => subscription.close());
    return subscription.close;
  };

  return {
    sync,
    applyUpdate,
    subscribe,
    publishAwareness: async (request: DocumentAwarenessPublishRequest) => {
      try {
        await requireSubscription(request);
        return success(await client.documentPublishAwareness(request));
      } catch (error) {
        return failure(error);
      }
    },
    respondToRelocationLease: async () =>
      failure(new Error("Core relocation leases remain internal to the Module")),
  };
};

const documentEvent = (
  request: DocumentSyncSubscribeRequest,
  envelope: CoreEventEnvelope,
): DocumentSyncRealtimeEvent | null => {
  const payload = envelope.event.payload;
  if (payload.module !== "owned_document") return null;
  const event = payload.event;
  if (event.document_id !== request.documentId) return null;
  if (event.kind === "document_updated") {
    return {
      kind: "document-update",
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: event.generation,
      headSeq: event.head_seq,
      updateId: envelope.event.operation_id ?? `event:${envelope.event.sequence}`,
      clientSessionId: "core",
      update: Uint8Array.from(event.update),
    };
  }
  if (event.kind === "document_invalidated") {
    return {
      kind: "resync-required",
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: 1,
      headSeq: 0,
      reason: "event-gap",
    };
  }
  return null;
};

const success = <Value>(value: Value): DocumentSyncCommandResult<Value> => ({
  ok: true,
  value,
});

const failure = <Value>(error: unknown): DocumentSyncCommandResult<Value> => ({
  ok: false,
  error: commandError(error),
});

const commandError = (error: unknown): DocumentSyncCommandError => {
  if (error instanceof CoreModuleResponseError) {
    const code = error.coreError.code;
    return {
      code: mapCoreErrorCode(code),
      message: error.message,
      retryable: error.coreError.retryable,
      resetRequired:
        code === "stale_store_epoch" || code === "generation_conflict",
    };
  }
  return {
    code: "transport_unavailable",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    resetRequired: false,
  };
};

const mapCoreErrorCode = (
  code: CoreModuleResponseError["coreError"]["code"],
): DocumentSyncCommandError["code"] => {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "not_found":
      return "document_not_found";
    case "stale_store_epoch":
      return "store_epoch_mismatch";
    case "generation_conflict":
      return "document_generation_mismatch";
    case "head_conflict":
      return "future_base_head";
    case "document_update_missing_dependencies":
      return "document_update_missing_dependencies";
    case "idempotency_key_reused":
      return "update_id_collision";
    case "invalid_document_schema":
    case "schema_unsupported":
      return "unsupported_document_schema";
    case "store_corrupt":
      return "document_state_corrupt";
    case "invalid_input":
      return "invalid_document_update";
    default:
      return "unknown";
  }
};
