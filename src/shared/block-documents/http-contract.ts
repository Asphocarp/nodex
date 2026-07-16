import {
  MAX_BLOCK_ID_LENGTH,
  MAX_PAGE_DOCUMENT_STATE_BYTES,
  MAX_PAGE_DOCUMENT_UPDATE_BYTES,
  MAX_DOCUMENT_TOUCHED_BLOCK_IDS,
  type DocumentReadiness,
  type OwnedDocumentDescriptor,
} from "./contracts";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  type DocumentAwarenessPublishRequest,
  type DocumentSyncApplyAck,
  type DocumentSyncApplyRequest,
  type DocumentSyncCommandError,
  type DocumentSyncRealtimeEvent,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
} from "./document-sync";
import {
  decodeDocumentHttpEnvelope,
  documentBytesFromBase64,
  documentBytesToBase64,
  encodeDocumentHttpEnvelope,
  DocumentHttpWireError,
} from "./http-wire";

export const DOCUMENT_HTTP_CONTENT_TYPE =
  "application/vnd.nodex.document-sync.v1+octet-stream";
const DOCUMENT_SYNC_ERROR_CODES = new Set<DocumentSyncCommandError["code"]>([
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

interface VersionedMetadata {
  readonly version: 1;
}

interface SyncRequestMetadata extends VersionedMetadata {
  readonly clientSessionId: string;
}

interface SyncResponseMetadata extends VersionedMetadata {
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly stateVector: string;
}

interface ApplyRequestMetadata extends VersionedMetadata {
  readonly storeEpoch: string;
  readonly generation: number;
  readonly updateId: string;
  readonly clientSessionId: string;
  readonly baseHeadSeq: number;
  readonly touchedBlockIds: readonly string[];
}

interface ApplyAckMetadata extends VersionedMetadata {
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly updateId: string;
  readonly committedSeq: number;
  readonly headSeq: number;
  readonly duplicate: boolean;
}

interface AwarenessRequestMetadata extends VersionedMetadata {
  readonly clientSessionId: string;
  readonly storeEpoch: string;
  readonly generation: number;
}

interface EncodedRealtimeEvent {
  readonly version: 1;
  readonly kind: DocumentSyncRealtimeEvent["kind"];
  readonly documentId: string;
  readonly state?: "connected" | "disconnected";
  readonly storeEpoch?: string;
  readonly generation?: number;
  readonly headSeq?: number;
  readonly updateId?: string;
  readonly clientSessionId?: string;
  readonly update?: string;
  readonly leaseId?: string;
  readonly expectedHeadSeq?: number;
  readonly deadlineAt?: number;
  readonly reason?: string;
}

type EncodedOwnedDocumentSyncEngine =
  | {
      readonly kind: "yjs";
      readonly stateVector: string;
    }
  | {
      readonly kind: "canvas_scene";
    };

interface EncodedOwnedDocumentDescriptor {
  readonly version: 2;
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly ownerType: string;
  readonly ownerLifecycle: OwnedDocumentDescriptor["ownerLifecycle"];
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly readiness: DocumentReadiness;
  readonly sync: EncodedOwnedDocumentSyncEngine;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new DocumentHttpWireError("Document HTTP metadata must be an object");
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void => {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length === expectedKeys.size &&
    Object.keys(record).every((key) => expectedKeys.has(key))
  ) {
    return;
  }
  throw new DocumentHttpWireError(`${label} has unsupported fields`);
};

const readVersion = (record: Readonly<Record<string, unknown>>): 1 => {
  if (record.version === 1) return 1;
  throw new DocumentHttpWireError("Unsupported Document HTTP contract version");
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = record[key];
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new DocumentHttpWireError(`${key} must be a non-empty string`);
};

const readOptionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  if (record[key] === undefined) return undefined;
  return readString(record, key);
};

const readInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  minimum: number,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new DocumentHttpWireError(`${key} must be an integer >= ${minimum}`);
};

const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean => {
  const value = record[key];
  if (typeof value === "boolean") return value;
  throw new DocumentHttpWireError(`${key} must be a boolean`);
};

const readEnum = <Value extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly Value[],
): Value => {
  const value = record[key];
  if (typeof value === "string" && values.includes(value as Value)) {
    return value as Value;
  }
  throw new DocumentHttpWireError(`${key} has an unsupported value`);
};

const readTouchedBlockIds = (
  record: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const value = record.touchedBlockIds;
  if (!Array.isArray(value) || value.length > MAX_DOCUMENT_TOUCHED_BLOCK_IDS) {
    throw new DocumentHttpWireError("touchedBlockIds is invalid or too large");
  }
  const ids = value.map((entry) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_BLOCK_ID_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new DocumentHttpWireError("touchedBlockIds contains an invalid ID");
  });
  if (new Set(ids).size !== ids.length) {
    throw new DocumentHttpWireError("touchedBlockIds contains a duplicate ID");
  }
  return ids;
};

const assertRouteDocument = (routeDocumentId: string): string => {
  if (
    routeDocumentId.length > 0 &&
    routeDocumentId === routeDocumentId.trim()
  ) {
    return routeDocumentId;
  }
  throw new DocumentHttpWireError("route documentId must be non-empty");
};

const parseSyncRequestMetadata = (value: unknown): SyncRequestMetadata => {
  const record = readRecord(value);
  return {
    version: readVersion(record),
    clientSessionId: readString(record, "clientSessionId"),
  };
};

const parseSyncResponseMetadata = (value: unknown): SyncResponseMetadata => {
  const record = readRecord(value);
  return {
    version: readVersion(record),
    documentId: readString(record, "documentId"),
    storeEpoch: readString(record, "storeEpoch"),
    generation: readInteger(record, "generation", 1),
    headSeq: readInteger(record, "headSeq", 0),
    stateVector: readString(record, "stateVector"),
  };
};

const parseApplyRequestMetadata = (value: unknown): ApplyRequestMetadata => {
  const record = readRecord(value);
  return {
    version: readVersion(record),
    storeEpoch: readString(record, "storeEpoch"),
    generation: readInteger(record, "generation", 1),
    updateId: readString(record, "updateId"),
    clientSessionId: readString(record, "clientSessionId"),
    baseHeadSeq: readInteger(record, "baseHeadSeq", 0),
    touchedBlockIds: readTouchedBlockIds(record),
  };
};

const parseApplyAckMetadata = (value: unknown): ApplyAckMetadata => {
  const record = readRecord(value);
  return {
    version: readVersion(record),
    documentId: readString(record, "documentId"),
    storeEpoch: readString(record, "storeEpoch"),
    generation: readInteger(record, "generation", 1),
    updateId: readString(record, "updateId"),
    committedSeq: readInteger(record, "committedSeq", 1),
    headSeq: readInteger(record, "headSeq", 1),
    duplicate: readBoolean(record, "duplicate"),
  };
};

const parseAwarenessRequestMetadata = (
  value: unknown,
): AwarenessRequestMetadata => {
  const record = readRecord(value);
  return {
    version: readVersion(record),
    clientSessionId: readString(record, "clientSessionId"),
    storeEpoch: readString(record, "storeEpoch"),
    generation: readInteger(record, "generation", 1),
  };
};

const parseOwnedDocumentSyncEngine = (
  value: unknown,
): EncodedOwnedDocumentSyncEngine => {
  const record = readRecord(value);
  const kind = readEnum(record, "kind", ["yjs", "canvas_scene"] as const);
  if (kind === "canvas_scene") {
    assertExactKeys(record, ["kind"], "Canvas scene sync descriptor");
    return { kind };
  }
  assertExactKeys(
    record,
    ["kind", "stateVector"],
    "Yjs sync descriptor",
  );
  const stateVector = record.stateVector;
  if (typeof stateVector !== "string") {
    throw new DocumentHttpWireError("stateVector must be base64 text");
  }
  return { kind, stateVector };
};

const parseOwnedDocumentDescriptor = (
  value: unknown,
): EncodedOwnedDocumentDescriptor => {
  const record = readRecord(value);
  assertExactKeys(
    record,
    [
      "version",
      "projectId",
      "ownerBlockId",
      "ownerType",
      "ownerLifecycle",
      "documentId",
      "storeEpoch",
      "generation",
      "headSeq",
      "schemaKey",
      "schemaVersion",
      "readiness",
      "sync",
    ],
    "Owned Document descriptor",
  );
  if (record.version !== 2) {
    throw new DocumentHttpWireError(
      "Unsupported Owned Document descriptor version",
    );
  }
  return {
    version: 2,
    projectId: readString(record, "projectId"),
    ownerBlockId: readString(record, "ownerBlockId"),
    ownerType: readString(record, "ownerType"),
    ownerLifecycle: readEnum(record, "ownerLifecycle", [
      "active",
      "archived",
      "deleted",
    ] as const),
    documentId: readString(record, "documentId"),
    storeEpoch: readString(record, "storeEpoch"),
    generation: readInteger(record, "generation", 1),
    headSeq: readInteger(record, "headSeq", 0),
    schemaKey: readString(record, "schemaKey"),
    schemaVersion: readInteger(record, "schemaVersion", 1),
    readiness: readEnum(record, "readiness", [
      "pending_genesis",
      "ready",
      "failed",
    ] as const),
    sync: parseOwnedDocumentSyncEngine(record.sync),
  };
};

export const encodeOwnedDocumentDescriptorHttp = (
  descriptor: OwnedDocumentDescriptor,
): string => {
  const sync: EncodedOwnedDocumentSyncEngine =
    descriptor.sync.kind === "yjs"
      ? {
          kind: "yjs",
          stateVector: documentBytesToBase64(descriptor.sync.stateVector),
        }
      : { kind: "canvas_scene" };
  return JSON.stringify({
    version: 2,
    projectId: descriptor.projectId,
    ownerBlockId: descriptor.ownerBlockId,
    ownerType: descriptor.ownerType,
    ownerLifecycle: descriptor.ownerLifecycle,
    documentId: descriptor.documentId,
    storeEpoch: descriptor.storeEpoch,
    generation: descriptor.generation,
    headSeq: descriptor.headSeq,
    schemaKey: descriptor.schemaKey,
    schemaVersion: descriptor.schemaVersion,
    readiness: descriptor.readiness,
    sync,
  } satisfies EncodedOwnedDocumentDescriptor);
};

export const decodeOwnedDocumentDescriptorHttp = (
  serialized: string,
): OwnedDocumentDescriptor => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new DocumentHttpWireError(
      "Owned Document descriptor is not valid JSON",
      { cause: error },
    );
  }
  const descriptor = parseOwnedDocumentDescriptor(decoded);
  const sync = descriptor.sync.kind === "yjs"
    ? {
        kind: "yjs" as const,
        stateVector: documentBytesFromBase64(
          descriptor.sync.stateVector,
          MAX_PAGE_DOCUMENT_STATE_BYTES,
        ),
      }
    : { kind: "canvas_scene" as const };
  return {
    projectId: descriptor.projectId,
    ownerBlockId: descriptor.ownerBlockId,
    ownerType: descriptor.ownerType,
    ownerLifecycle: descriptor.ownerLifecycle,
    documentId: descriptor.documentId,
    storeEpoch: descriptor.storeEpoch,
    generation: descriptor.generation,
    headSeq: descriptor.headSeq,
    schemaKey: descriptor.schemaKey,
    schemaVersion: descriptor.schemaVersion,
    readiness: descriptor.readiness,
    sync,
  };
};

export const encodeDocumentSyncHttpRequest = (
  request: DocumentSyncRequest,
): Uint8Array =>
  encodeDocumentHttpEnvelope<SyncRequestMetadata>(
    { version: 1, clientSessionId: request.clientSessionId },
    request.stateVector,
  );

export const decodeDocumentSyncHttpRequest = (
  routeDocumentId: string,
  bytes: Uint8Array,
): DocumentSyncRequest => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseSyncRequestMetadata,
    MAX_PAGE_DOCUMENT_STATE_BYTES,
  );
  return {
    documentId: assertRouteDocument(routeDocumentId),
    clientSessionId: envelope.metadata.clientSessionId,
    stateVector: envelope.payload,
  };
};

export const encodeDocumentSyncHttpResponse = (
  response: DocumentSyncResponse,
): Uint8Array =>
  encodeDocumentHttpEnvelope<SyncResponseMetadata>(
    {
      version: 1,
      documentId: response.documentId,
      storeEpoch: response.storeEpoch,
      generation: response.generation,
      headSeq: response.headSeq,
      stateVector: documentBytesToBase64(response.stateVector),
    },
    response.update,
  );

export const decodeDocumentSyncHttpResponse = (
  bytes: Uint8Array,
): DocumentSyncResponse => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseSyncResponseMetadata,
    MAX_PAGE_DOCUMENT_STATE_BYTES,
  );
  return {
    documentId: envelope.metadata.documentId,
    storeEpoch: envelope.metadata.storeEpoch,
    generation: envelope.metadata.generation,
    headSeq: envelope.metadata.headSeq,
    stateVector: documentBytesFromBase64(
      envelope.metadata.stateVector,
      MAX_PAGE_DOCUMENT_STATE_BYTES,
    ),
    update: envelope.payload,
  };
};

export const encodeDocumentApplyHttpRequest = (
  request: DocumentSyncApplyRequest,
): Uint8Array =>
  encodeDocumentHttpEnvelope<ApplyRequestMetadata>(
    {
      version: 1,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
      updateId: request.updateId,
      clientSessionId: request.clientSessionId,
      baseHeadSeq: request.baseHeadSeq,
      touchedBlockIds: request.touchedBlockIds,
    },
    request.update,
  );

export const decodeDocumentApplyHttpRequest = (
  routeDocumentId: string,
  bytes: Uint8Array,
): DocumentSyncApplyRequest => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseApplyRequestMetadata,
    MAX_PAGE_DOCUMENT_UPDATE_BYTES,
  );
  return {
    documentId: assertRouteDocument(routeDocumentId),
    storeEpoch: envelope.metadata.storeEpoch,
    generation: envelope.metadata.generation,
    updateId: envelope.metadata.updateId,
    clientSessionId: envelope.metadata.clientSessionId,
    baseHeadSeq: envelope.metadata.baseHeadSeq,
    touchedBlockIds: envelope.metadata.touchedBlockIds,
    update: envelope.payload,
  };
};

export const encodeDocumentApplyHttpAck = (
  ack: DocumentSyncApplyAck,
): Uint8Array =>
  encodeDocumentHttpEnvelope<ApplyAckMetadata>(
    {
      version: 1,
      documentId: ack.documentId,
      storeEpoch: ack.storeEpoch,
      generation: ack.generation,
      updateId: ack.updateId,
      committedSeq: ack.committedSeq,
      headSeq: ack.headSeq,
      duplicate: ack.duplicate,
    },
    ack.stateVector,
  );

export const decodeDocumentApplyHttpAck = (
  bytes: Uint8Array,
): DocumentSyncApplyAck => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseApplyAckMetadata,
    MAX_PAGE_DOCUMENT_STATE_BYTES,
  );
  return {
    documentId: envelope.metadata.documentId,
    storeEpoch: envelope.metadata.storeEpoch,
    generation: envelope.metadata.generation,
    updateId: envelope.metadata.updateId,
    committedSeq: envelope.metadata.committedSeq,
    headSeq: envelope.metadata.headSeq,
    stateVector: envelope.payload,
    duplicate: envelope.metadata.duplicate,
  };
};

export const encodeDocumentAwarenessHttpRequest = (
  request: DocumentAwarenessPublishRequest,
): Uint8Array =>
  encodeDocumentHttpEnvelope<AwarenessRequestMetadata>(
    {
      version: 1,
      clientSessionId: request.clientSessionId,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
    },
    request.update,
  );

export const decodeDocumentAwarenessHttpRequest = (
  routeDocumentId: string,
  bytes: Uint8Array,
): DocumentAwarenessPublishRequest => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseAwarenessRequestMetadata,
    MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  );
  return {
    documentId: assertRouteDocument(routeDocumentId),
    clientSessionId: envelope.metadata.clientSessionId,
    storeEpoch: envelope.metadata.storeEpoch,
    generation: envelope.metadata.generation,
    update: envelope.payload,
  };
};

export const encodeDocumentRealtimeSseEvent = (
  event: DocumentSyncRealtimeEvent,
): string => {
  const encoded: EncodedRealtimeEvent =
    event.kind === "connection"
      ? { version: 1, ...event }
      : event.kind === "document-update" || event.kind === "awareness"
        ? {
            version: 1,
            ...event,
            update: documentBytesToBase64(event.update),
          }
        : { version: 1, ...event };
  return JSON.stringify(encoded);
};

export const decodeDocumentRealtimeSseEvent = (
  serialized: string,
): DocumentSyncRealtimeEvent => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new DocumentHttpWireError("Document SSE event is invalid JSON", {
      cause: error,
    });
  }
  const record = readRecord(value);
  readVersion(record);
  const kind = readString(record, "kind");
  const documentId = readString(record, "documentId");
  if (kind === "connection") {
    const state = readString(record, "state");
    if (state !== "connected" && state !== "disconnected") {
      throw new DocumentHttpWireError("Document connection state is invalid");
    }
    return { kind, documentId, state };
  }
  const storeEpoch = readString(record, "storeEpoch");
  if (kind === "store-reset") {
    return { kind, documentId, storeEpoch };
  }
  const generation = readInteger(record, "generation", 1);
  if (kind === "awareness") {
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      clientSessionId: readString(record, "clientSessionId"),
      update: documentBytesFromBase64(
        readString(record, "update"),
        MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
      ),
    };
  }
  if (kind === "relocation-lease-prepare") {
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      leaseId: readString(record, "leaseId"),
      clientSessionId: readString(record, "clientSessionId"),
      expectedHeadSeq: readInteger(record, "expectedHeadSeq", 0),
      deadlineAt: readInteger(record, "deadlineAt", 0),
    };
  }
  const headSeq = readInteger(record, "headSeq", 0);
  if (kind === "document-update") {
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      headSeq,
      updateId: readString(record, "updateId"),
      clientSessionId: readString(record, "clientSessionId"),
      update: documentBytesFromBase64(
        readString(record, "update"),
        MAX_PAGE_DOCUMENT_UPDATE_BYTES,
      ),
    };
  }
  if (kind === "resync-required") {
    const reason = readString(record, "reason");
    if (
      reason !== "event-gap" &&
      reason !== "history-compacted" &&
      reason !== "transport-reconnected"
    ) {
      throw new DocumentHttpWireError("Document resync reason is invalid");
    }
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      headSeq,
      reason,
    };
  }
  if (kind === "relocation-lease-release") {
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      headSeq,
      leaseId: readString(record, "leaseId"),
      clientSessionId: readString(record, "clientSessionId"),
    };
  }
  if (kind === "relocation-lease-cancel") {
    return {
      kind,
      documentId,
      storeEpoch,
      generation,
      headSeq,
      leaseId: readString(record, "leaseId"),
      clientSessionId: readString(record, "clientSessionId"),
      reason: readString(record, "reason"),
    };
  }
  throw new DocumentHttpWireError(
    `Unsupported Document SSE event kind: ${kind}`,
  );
};

export const encodeDocumentHttpError = (
  error: DocumentSyncCommandError,
): string => JSON.stringify({ ok: false, error });

export const decodeDocumentHttpError = (
  serialized: string,
): DocumentSyncCommandError => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new DocumentHttpWireError("Document HTTP error is invalid JSON", {
      cause: error,
    });
  }
  const root = readRecord(value);
  const error = readRecord(root.error);
  const code = readString(error, "code") as DocumentSyncCommandError["code"];
  if (!DOCUMENT_SYNC_ERROR_CODES.has(code)) {
    throw new DocumentHttpWireError("Document HTTP error code is invalid");
  }
  const relocationId = readOptionalString(error, "relocationId");
  const recoveryArtifactId = readOptionalString(error, "recoveryArtifactId");
  return {
    code,
    message: readString(error, "message"),
    retryable: readBoolean(error, "retryable"),
    resetRequired: readBoolean(error, "resetRequired"),
    ...(relocationId ? { relocationId } : {}),
    ...(recoveryArtifactId ? { recoveryArtifactId } : {}),
  };
};
