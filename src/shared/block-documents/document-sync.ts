import type { ApplyDocumentUpdate, DocumentId } from "./contracts";

export const MAX_DOCUMENT_AWARENESS_UPDATE_BYTES = 64 * 1024;

/**
 * Errors are values on the wire. Transport implementations must not require
 * callers to parse exception messages to decide whether a request can retry or
 * whether a cached Y.Doc has crossed an identity boundary.
 */
export type DocumentSyncErrorCode =
  | "transport_unavailable"
  | "request_cancelled"
  | "unauthorized"
  | "store_not_initialized"
  | "store_epoch_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "document_generation_mismatch"
  | "unsupported_document_schema"
  | "future_base_head"
  | "invalid_document_update"
  | "invalid_awareness_update"
  | "document_update_missing_dependencies"
  | "update_id_collision"
  | "document_state_corrupt"
  | "invalid_response"
  | "unknown";

export interface DocumentSyncCommandError {
  readonly code: DocumentSyncErrorCode;
  readonly message: string;
  /** The exact same durable command may be attempted again. */
  readonly retryable: boolean;
  /**
   * The surface must discard this Y.Doc and create a fresh one before syncing.
   * This is required after restore/store replacement or document regeneration.
   */
  readonly resetRequired: boolean;
}

export type DocumentSyncCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DocumentSyncCommandError };

export interface DocumentSyncRequest {
  readonly documentId: DocumentId;
  readonly clientSessionId: string;
  readonly stateVector: Uint8Array;
}

export interface DocumentSyncResponse {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly stateVector: Uint8Array;
  /** The server state missing from the supplied state vector. */
  readonly update: Uint8Array;
}

export type DocumentSyncApplyRequest = ApplyDocumentUpdate;

export interface DocumentSyncApplyAck {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly updateId: string;
  /** Sequence assigned to this update; stable across idempotent retries. */
  readonly committedSeq: number;
  /** Latest durable sequence observed by the writer while producing the ACK. */
  readonly headSeq: number;
  readonly stateVector: Uint8Array;
  readonly duplicate: boolean;
}

export interface DocumentSyncSubscribeRequest {
  readonly documentId: DocumentId;
  readonly clientSessionId: string;
}

export interface DocumentSyncSubscriptionAck {
  readonly subscribed: true;
}

export interface DocumentSyncUnsubscribeAck {
  readonly unsubscribed: true;
}

export interface DocumentAwarenessPublishRequest {
  readonly documentId: DocumentId;
  readonly clientSessionId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly update: Uint8Array;
}

export interface DocumentAwarenessPublishAck {
  readonly accepted: true;
}

export type DocumentSyncRealtimeEvent =
  | {
      readonly kind: "connection";
      readonly documentId: DocumentId;
      readonly state: "connected" | "disconnected";
    }
  | {
      readonly kind: "document-update";
      readonly documentId: DocumentId;
      readonly storeEpoch: string;
      readonly generation: number;
      readonly headSeq: number;
      readonly updateId: string;
      readonly clientSessionId: string;
      readonly update: Uint8Array;
    }
  | {
      readonly kind: "awareness";
      readonly documentId: DocumentId;
      readonly storeEpoch: string;
      readonly generation: number;
      readonly clientSessionId: string;
      readonly update: Uint8Array;
    }
  | {
      readonly kind: "resync-required";
      readonly documentId: DocumentId;
      readonly storeEpoch: string;
      readonly generation: number;
      readonly headSeq: number;
      readonly reason: "event-gap" | "history-compacted" | "transport-reconnected";
    };
