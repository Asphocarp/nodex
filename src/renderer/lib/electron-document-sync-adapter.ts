import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncErrorCode,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
  DocumentSyncSubscriptionAck,
} from "../../shared/block-documents/document-sync";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import type { ElectronRendererBridge } from "./electron-renderer-transport";

interface SubscriptionEntry {
  readonly request: DocumentSyncSubscribeRequest;
  readonly listeners: Set<(event: DocumentSyncRealtimeEvent) => void>;
  readonly removeBridgeListener: () => void;
  remoteSubscription: Promise<
    DocumentSyncCommandResult<DocumentSyncSubscriptionAck>
  > | null;
  remoteSubscribed: boolean;
  disposed: boolean;
}

const ERROR_CODES = new Set<DocumentSyncErrorCode>([
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
  "block_relocated",
  "recovery_required",
  "document_state_corrupt",
  "invalid_response",
  "unknown",
]);

const transportError = (error: unknown): DocumentSyncCommandError => ({
  code: "transport_unavailable",
  message:
    error instanceof Error ? error.message : "Electron IPC is unavailable",
  retryable: true,
  resetRequired: false,
});

const invalidResponseError = (message: string): DocumentSyncCommandError => ({
  code: "invalid_response",
  message,
  retryable: false,
  resetRequired: false,
});

const unauthorizedError = (): DocumentSyncCommandError => ({
  code: "unauthorized",
  message: "The document provider has no active Electron subscription",
  retryable: false,
  resetRequired: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const copyBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (!ArrayBuffer.isView(value)) {
    return null;
  }
  return new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
};

const normalizeError = (value: unknown): DocumentSyncCommandError | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.code !== "string" ||
    !ERROR_CODES.has(value.code as DocumentSyncErrorCode) ||
    typeof value.message !== "string" ||
    typeof value.retryable !== "boolean" ||
    typeof value.resetRequired !== "boolean"
  ) {
    return null;
  }
  if (
    value.relocationId !== undefined &&
    (typeof value.relocationId !== "string" || value.relocationId.length === 0)
  ) {
    return null;
  }
  if (
    value.recoveryArtifactId !== undefined &&
    (typeof value.recoveryArtifactId !== "string" ||
      value.recoveryArtifactId.length === 0)
  ) {
    return null;
  }
  return {
    code: value.code as DocumentSyncErrorCode,
    message: value.message,
    retryable: value.retryable,
    resetRequired: value.resetRequired,
    ...(typeof value.relocationId === "string"
      ? { relocationId: value.relocationId }
      : {}),
    ...(typeof value.recoveryArtifactId === "string"
      ? { recoveryArtifactId: value.recoveryArtifactId }
      : {}),
  };
};

const normalizeCommandResult = <T>(
  value: unknown,
): DocumentSyncCommandResult<T> => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return {
      ok: false,
      error: invalidResponseError(
        "Electron document sync returned an invalid envelope",
      ),
    };
  }
  if (value.ok) {
    if (!("value" in value)) {
      return {
        ok: false,
        error: invalidResponseError(
          "Electron document sync omitted its result",
        ),
      };
    }
    return { ok: true, value: value.value as T };
  }

  const error = normalizeError(value.error);
  if (error) {
    return { ok: false, error };
  }
  return {
    ok: false,
    error: invalidResponseError(
      "Electron document sync returned an invalid error",
    ),
  };
};

const normalizeSyncResult = (
  result: DocumentSyncCommandResult<DocumentSyncResponse>,
): DocumentSyncCommandResult<DocumentSyncResponse> => {
  if (!result.ok) {
    return result;
  }
  const value = result.value as unknown;
  if (!isRecord(value)) {
    return {
      ok: false,
      error: invalidResponseError("Invalid document sync result"),
    };
  }
  const stateVector = copyBytes(value.stateVector);
  const update = copyBytes(value.update);
  if (
    !stateVector ||
    !update ||
    typeof value.documentId !== "string" ||
    typeof value.storeEpoch !== "string" ||
    typeof value.generation !== "number" ||
    typeof value.headSeq !== "number"
  ) {
    return {
      ok: false,
      error: invalidResponseError("Invalid document sync result"),
    };
  }
  return {
    ok: true,
    value: {
      documentId: value.documentId,
      storeEpoch: value.storeEpoch,
      generation: value.generation,
      headSeq: value.headSeq,
      stateVector,
      update,
    },
  };
};

const normalizeApplyResult = (
  result: DocumentSyncCommandResult<DocumentSyncApplyAck>,
): DocumentSyncCommandResult<DocumentSyncApplyAck> => {
  if (!result.ok) {
    return result;
  }
  const value = result.value as unknown;
  if (!isRecord(value)) {
    return {
      ok: false,
      error: invalidResponseError("Invalid document update ACK"),
    };
  }
  const stateVector = copyBytes(value.stateVector);
  if (
    !stateVector ||
    typeof value.documentId !== "string" ||
    typeof value.storeEpoch !== "string" ||
    typeof value.generation !== "number" ||
    typeof value.updateId !== "string" ||
    typeof value.committedSeq !== "number" ||
    typeof value.headSeq !== "number" ||
    typeof value.duplicate !== "boolean"
  ) {
    return {
      ok: false,
      error: invalidResponseError("Invalid document update ACK"),
    };
  }
  return {
    ok: true,
    value: {
      documentId: value.documentId,
      storeEpoch: value.storeEpoch,
      generation: value.generation,
      updateId: value.updateId,
      committedSeq: value.committedSeq,
      headSeq: value.headSeq,
      stateVector,
      duplicate: value.duplicate,
    },
  };
};

const normalizeRelocationLeaseResponse = (
  result: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>,
): DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck> => {
  if (!result.ok) return result;
  const value = result.value as unknown;
  if (
    !isRecord(value) ||
    value.accepted !== true ||
    typeof value.leaseId !== "string" ||
    typeof value.documentId !== "string" ||
    (value.status !== "preparing" &&
      value.status !== "frozen" &&
      value.status !== "released" &&
      value.status !== "cancelled")
  ) {
    return {
      ok: false,
      error: invalidResponseError("Invalid relocation lease response"),
    };
  }
  return {
    ok: true,
    value: {
      accepted: true,
      leaseId: value.leaseId,
      documentId: value.documentId,
      status: value.status,
    },
  };
};

const normalizeRealtimeEvent = (
  value: unknown,
): DocumentSyncRealtimeEvent | null => {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.documentId !== "string"
  ) {
    return null;
  }
  if (value.kind === "connection") {
    if (value.state !== "connected" && value.state !== "disconnected") {
      return null;
    }
    return {
      kind: "connection",
      documentId: value.documentId,
      state: value.state,
    };
  }
  if (value.kind === "document-update") {
    const update = copyBytes(value.update);
    if (
      !update ||
      typeof value.storeEpoch !== "string" ||
      typeof value.generation !== "number" ||
      typeof value.headSeq !== "number" ||
      typeof value.updateId !== "string" ||
      typeof value.clientSessionId !== "string"
    ) {
      return null;
    }
    return {
      kind: "document-update",
      documentId: value.documentId,
      storeEpoch: value.storeEpoch,
      generation: value.generation,
      headSeq: value.headSeq,
      updateId: value.updateId,
      clientSessionId: value.clientSessionId,
      update,
    };
  }
  if (value.kind === "awareness") {
    const update = copyBytes(value.update);
    if (
      !update ||
      typeof value.storeEpoch !== "string" ||
      typeof value.generation !== "number" ||
      typeof value.clientSessionId !== "string"
    ) {
      return null;
    }
    return {
      kind: "awareness",
      documentId: value.documentId,
      storeEpoch: value.storeEpoch,
      generation: value.generation,
      clientSessionId: value.clientSessionId,
      update,
    };
  }
  if (value.kind === "relocation-lease-prepare") {
    if (
      typeof value.leaseId !== "string" ||
      typeof value.clientSessionId !== "string" ||
      typeof value.storeEpoch !== "string" ||
      typeof value.generation !== "number" ||
      typeof value.expectedHeadSeq !== "number" ||
      typeof value.deadlineAt !== "number"
    ) {
      return null;
    }
    return {
      kind: value.kind,
      leaseId: value.leaseId,
      clientSessionId: value.clientSessionId,
      documentId: value.documentId,
      storeEpoch: value.storeEpoch,
      generation: value.generation,
      expectedHeadSeq: value.expectedHeadSeq,
      deadlineAt: value.deadlineAt,
    };
  }
  if (
    value.kind === "relocation-lease-release" ||
    value.kind === "relocation-lease-cancel"
  ) {
    if (
      typeof value.leaseId !== "string" ||
      typeof value.clientSessionId !== "string" ||
      typeof value.storeEpoch !== "string" ||
      typeof value.generation !== "number" ||
      typeof value.headSeq !== "number" ||
      (value.kind === "relocation-lease-cancel" &&
        typeof value.reason !== "string")
    ) {
      return null;
    }
    return value.kind === "relocation-lease-release"
      ? {
          kind: value.kind,
          leaseId: value.leaseId,
          clientSessionId: value.clientSessionId,
          documentId: value.documentId,
          storeEpoch: value.storeEpoch,
          generation: value.generation,
          headSeq: value.headSeq,
        }
      : {
          kind: value.kind,
          leaseId: value.leaseId,
          clientSessionId: value.clientSessionId,
          documentId: value.documentId,
          storeEpoch: value.storeEpoch,
          generation: value.generation,
          headSeq: value.headSeq,
          reason: value.reason as string,
        };
  }
  if (value.kind !== "resync-required") {
    return null;
  }
  if (
    typeof value.storeEpoch !== "string" ||
    typeof value.generation !== "number" ||
    typeof value.headSeq !== "number" ||
    (value.reason !== "event-gap" &&
      value.reason !== "history-compacted" &&
      value.reason !== "transport-reconnected")
  ) {
    return null;
  }
  return {
    kind: "resync-required",
    documentId: value.documentId,
    storeEpoch: value.storeEpoch,
    generation: value.generation,
    headSeq: value.headSeq,
    reason: value.reason,
  };
};

const subscriptionKey = (request: DocumentSyncSubscribeRequest): string =>
  JSON.stringify([request.clientSessionId, request.documentId]);

export function createElectronDocumentSyncAdapter(
  bridge: ElectronRendererBridge,
): DocumentSyncAdapter {
  const subscriptions = new Map<string, SubscriptionEntry>();

  const invokeCommand = async <T>(
    channel: string,
    request: unknown,
  ): Promise<DocumentSyncCommandResult<T>> => {
    try {
      return normalizeCommandResult<T>(await bridge.invoke(channel, request));
    } catch (error) {
      return { ok: false, error: transportError(error) };
    }
  };

  const ensureRemoteSubscription = (
    entry: SubscriptionEntry,
  ): Promise<DocumentSyncCommandResult<DocumentSyncSubscriptionAck>> => {
    if (entry.remoteSubscribed) {
      return Promise.resolve({ ok: true, value: { subscribed: true } });
    }
    if (entry.disposed) {
      return Promise.resolve({ ok: false, error: unauthorizedError() });
    }
    if (entry.remoteSubscription) {
      return entry.remoteSubscription;
    }

    const command = invokeCommand<DocumentSyncSubscriptionAck>(
      "document-sync:subscribe",
      entry.request,
    ).then((result) => {
      if (result.ok && result.value.subscribed !== true) {
        entry.remoteSubscription = null;
        return {
          ok: false,
          error: invalidResponseError(
            "Electron did not confirm document subscription",
          ),
        } satisfies DocumentSyncCommandResult<DocumentSyncSubscriptionAck>;
      }
      if (result.ok) {
        entry.remoteSubscribed = true;
      }
      entry.remoteSubscription = null;
      return result;
    });
    entry.remoteSubscription = command;
    return command;
  };

  const requireRemoteSubscription = async <T>(
    request: DocumentSyncSubscribeRequest,
  ): Promise<DocumentSyncCommandResult<T> | null> => {
    const entry = subscriptions.get(subscriptionKey(request));
    if (!entry) {
      return { ok: false, error: unauthorizedError() };
    }
    const subscription = await ensureRemoteSubscription(entry);
    if (!subscription.ok) {
      return { ok: false, error: subscription.error };
    }
    return null;
  };

  return {
    sync: async (request: DocumentSyncRequest) => {
      const blocked =
        await requireRemoteSubscription<DocumentSyncResponse>(request);
      if (blocked) {
        return blocked;
      }
      return normalizeSyncResult(
        await invokeCommand<DocumentSyncResponse>(
          "document-sync:sync",
          request,
        ),
      );
    },
    applyUpdate: async (request: DocumentSyncApplyRequest) => {
      const blocked =
        await requireRemoteSubscription<DocumentSyncApplyAck>(request);
      if (blocked) {
        return blocked;
      }
      return normalizeApplyResult(
        await invokeCommand<DocumentSyncApplyAck>(
          "document-sync:apply",
          request,
        ),
      );
    },
    publishAwareness: async (request: DocumentAwarenessPublishRequest) => {
      const blocked =
        await requireRemoteSubscription<DocumentAwarenessPublishAck>(request);
      if (blocked) {
        return blocked;
      }
      return invokeCommand<DocumentAwarenessPublishAck>(
        "document-sync:awareness:publish",
        request,
      );
    },
    respondToRelocationLease: async (
      request: DocumentRelocationLeaseResponseRequest,
    ) => {
      const blocked =
        await requireRemoteSubscription<DocumentRelocationLeaseResponseAck>(
          request,
        );
      if (blocked) return blocked;
      return normalizeRelocationLeaseResponse(
        await invokeCommand<DocumentRelocationLeaseResponseAck>(
          "document-sync:relocation-lease:respond",
          request,
        ),
      );
    },
    subscribe: (request, listener) => {
      const key = subscriptionKey(request);
      let entry = subscriptions.get(key);
      if (!entry) {
        const listeners = new Set<(event: DocumentSyncRealtimeEvent) => void>();
        const removeBridgeListener = bridge.on(
          "document-sync:event",
          (...args: unknown[]) => {
            const event = normalizeRealtimeEvent(args[0]);
            if (!event || event.documentId !== request.documentId) {
              return;
            }
            if (
              (event.kind === "relocation-lease-prepare" ||
                event.kind === "relocation-lease-release" ||
                event.kind === "relocation-lease-cancel") &&
              event.clientSessionId !== request.clientSessionId
            ) {
              return;
            }
            listeners.forEach((activeListener) => activeListener(event));
          },
        );
        entry = {
          request: { ...request },
          listeners,
          removeBridgeListener,
          remoteSubscription: null,
          remoteSubscribed: false,
          disposed: false,
        };
        subscriptions.set(key, entry);
      }
      entry.listeners.add(listener);
      void ensureRemoteSubscription(entry);

      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        entry?.listeners.delete(listener);
        if (!entry || entry.listeners.size > 0) {
          return;
        }

        entry.disposed = true;
        subscriptions.delete(key);
        entry.removeBridgeListener();
        const remoteCommand = entry.remoteSubscription;
        void (async () => {
          if (remoteCommand) {
            const result = await remoteCommand;
            if (!result.ok && !entry?.remoteSubscribed) {
              return;
            }
          }
          if (!entry?.remoteSubscribed) {
            return;
          }
          await invokeCommand("document-sync:unsubscribe", request);
        })();
      };
    },
  };
}
