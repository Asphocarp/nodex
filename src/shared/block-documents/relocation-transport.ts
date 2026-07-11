import {
  MAX_CARD_DOCUMENT_STATE_BYTES,
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
  type RelocationCommandError,
  type RelocationIntent,
  type RelocationResult,
} from "./contracts";
import {
  parseRelocationIntent,
  parseRelocationResult,
  RelocationContractError,
} from "./relocation";
import {
  decodeDocumentHttpEnvelope,
  encodeDocumentHttpEnvelope,
  DocumentHttpWireError,
} from "./http-wire";

export const RELOCATION_HTTP_CONTENT_TYPE =
  "application/vnd.nodex.block-relocation.v1+octet-stream";

const MAX_RELOCATION_HTTP_PAYLOAD_BYTES =
  MAX_CARD_DOCUMENT_UPDATE_BYTES * 2 + MAX_CARD_DOCUMENT_STATE_BYTES * 2;

const RELOCATION_ERROR_CODES = new Set<RelocationCommandError["code"]>([
  "invalid_relocation_request",
  "store_epoch_mismatch",
  "relocation_id_collision",
  "relocation_lease_timeout",
  "source_document_not_found",
  "target_document_not_found",
  "document_not_ready",
  "document_generation_mismatch",
  "source_head_mismatch",
  "target_head_changed",
  "block_not_found",
  "invalid_relocation_roots",
  "block_location_mismatch",
  "block_location_revision_mismatch",
  "invalid_relocation_target",
  "relocation_cycle",
  "block_relocated",
  "recovery_required",
  "document_state_corrupt",
  "unknown",
]);

interface RelocationHttpRequestEnvelope {
  readonly version: 1;
  readonly clientSessionId: string;
  readonly intent: RelocationIntent;
}

export interface DocumentRelocationRequest {
  readonly clientSessionId: string;
  readonly intent: RelocationIntent;
}

interface EncodedCommitBoundary {
  readonly updateLength: number;
  readonly stateVectorLength: number;
  readonly hasUpdate: boolean;
}

interface RelocationHttpResultMetadata {
  readonly version: 1;
  readonly result: Omit<RelocationResult, "sourceCommit" | "targetCommit"> & {
    readonly sourceCommit: Omit<
      RelocationResult["sourceCommit"],
      "update" | "stateVector"
    >;
    readonly targetCommit?: Omit<
      NonNullable<RelocationResult["targetCommit"]>,
      "update" | "stateVector"
    >;
  };
  readonly source: EncodedCommitBoundary;
  readonly target?: EncodedCommitBoundary;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new DocumentHttpWireError(`${label} must be an object`);
};

const requireExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  keys: readonly string[],
): void => {
  const actual = Object.keys(record).sort().join(",");
  const expected = [...keys].sort().join(",");
  if (actual === expected) return;
  throw new DocumentHttpWireError(`${label} has unsupported fields`);
};

const requireString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string => {
  const value = record[key];
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new DocumentHttpWireError(`${label}.${key} must be a non-empty string`);
};

const requireBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value === "boolean") return value;
  throw new DocumentHttpWireError(`${label}.${key} must be a boolean`);
};

const requireLength = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximum: number,
  label: string,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  ) {
    return value;
  }
  throw new DocumentHttpWireError(`${label}.${key} is invalid`);
};

const parseRequestEnvelope = (
  value: unknown,
): RelocationHttpRequestEnvelope => {
  const record = requireRecord(value, "Relocation request");
  requireExactKeys(record, "Relocation request", [
    "version",
    "clientSessionId",
    "intent",
  ]);
  if (record.version !== 1) {
    throw new DocumentHttpWireError("Unsupported Relocation HTTP version");
  }
  try {
    return {
      version: 1,
      clientSessionId: requireString(
        record,
        "clientSessionId",
        "Relocation request",
      ),
      intent: parseRelocationIntent(record.intent),
    };
  } catch (error) {
    if (error instanceof DocumentHttpWireError) throw error;
    throw new DocumentHttpWireError("Relocation intent is invalid", {
      cause: error,
    });
  }
};

const parseCommitBoundary = (
  value: unknown,
  label: string,
): EncodedCommitBoundary => {
  const record = requireRecord(value, label);
  requireExactKeys(record, label, [
    "updateLength",
    "stateVectorLength",
    "hasUpdate",
  ]);
  const updateLength = requireLength(
    record,
    "updateLength",
    MAX_CARD_DOCUMENT_UPDATE_BYTES,
    label,
  );
  const hasUpdate = requireBoolean(record, "hasUpdate", label);
  if (!hasUpdate && updateLength !== 0) {
    throw new DocumentHttpWireError(
      `${label}.updateLength must be zero when its update was compacted`,
    );
  }
  return {
    updateLength,
    stateVectorLength: requireLength(
      record,
      "stateVectorLength",
      MAX_CARD_DOCUMENT_STATE_BYTES,
      label,
    ),
    hasUpdate,
  };
};

const parseResultMetadata = (value: unknown): RelocationHttpResultMetadata => {
  const record = requireRecord(value, "Relocation response");
  const allowedKeys =
    record.target === undefined
      ? ["version", "result", "source"]
      : ["version", "result", "source", "target"];
  requireExactKeys(record, "Relocation response", allowedKeys);
  if (record.version !== 1) {
    throw new DocumentHttpWireError("Unsupported Relocation HTTP version");
  }
  const result = requireRecord(record.result, "Relocation response result");
  const source = parseCommitBoundary(record.source, "Relocation source commit");
  const target =
    record.target === undefined
      ? undefined
      : parseCommitBoundary(record.target, "Relocation target commit");
  if ((result.targetCommit !== undefined) !== (target !== undefined)) {
    throw new DocumentHttpWireError(
      "Relocation target commit metadata and payload boundary disagree",
    );
  }
  return {
    version: 1,
    result: result as unknown as RelocationHttpResultMetadata["result"],
    source,
    ...(target ? { target } : {}),
  };
};

const appendBytes = (
  target: Uint8Array,
  offset: number,
  bytes: Uint8Array,
): number => {
  target.set(bytes, offset);
  return offset + bytes.byteLength;
};

const readBytes = (
  payload: Uint8Array,
  offset: number,
  length: number,
  label: string,
): readonly [Uint8Array, number] => {
  const end = offset + length;
  if (end > payload.byteLength) {
    throw new DocumentHttpWireError(`${label} is truncated`);
  }
  return [payload.subarray(offset, end).slice(), end];
};

const assertResultMatchesIntent = (
  result: RelocationResult,
  intent: RelocationIntent,
): void => {
  const rootsMatch =
    result.rootBlockIds.length === intent.rootBlockIds.length &&
    result.rootBlockIds.every((blockId) =>
      intent.rootBlockIds.includes(blockId),
    );
  if (
    result.relocationId !== intent.relocationId ||
    result.projectId !== intent.projectId ||
    result.storeEpoch !== intent.storeEpoch ||
    result.sourceCommit.documentId !== intent.sourceDocumentId ||
    result.sourceCommit.generation !== intent.sourceGeneration ||
    result.targetCommit?.documentId !== intent.target.documentId ||
    result.targetCommit?.generation !== intent.target.generation ||
    !rootsMatch
  ) {
    throw new DocumentHttpWireError(
      "Relocation response escaped its requested boundary",
    );
  }
};

export const encodeRelocationHttpRequest = (
  clientSessionId: string,
  rawIntent: RelocationIntent,
): string => {
  const envelope = parseRequestEnvelope({
    version: 1,
    clientSessionId,
    intent: rawIntent,
  });
  return JSON.stringify(envelope);
};

export const parseDocumentRelocationRequest = (
  value: unknown,
): DocumentRelocationRequest => {
  const request = requireRecord(value, "Document relocation request");
  requireExactKeys(request, "Document relocation request", [
    "clientSessionId",
    "intent",
  ]);
  const envelope = parseRequestEnvelope({ version: 1, ...request });
  return {
    clientSessionId: envelope.clientSessionId,
    intent: envelope.intent,
  };
};

export const decodeRelocationHttpRequest = (
  serialized: string,
  routeProjectId: string,
  routeDocumentId: string,
): DocumentRelocationRequest => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new DocumentHttpWireError("Relocation request is invalid JSON", {
      cause: error,
    });
  }
  const envelope = parseRequestEnvelope(value);
  if (
    envelope.intent.projectId !== routeProjectId ||
    envelope.intent.sourceDocumentId !== routeDocumentId
  ) {
    throw new DocumentHttpWireError(
      "Relocation request escaped its route boundary",
    );
  }
  return {
    clientSessionId: envelope.clientSessionId,
    intent: envelope.intent,
  };
};

export const encodeRelocationHttpResult = (
  rawResult: RelocationResult,
): Uint8Array => {
  const result = parseRelocationResult(rawResult);
  const sourceUpdate = result.sourceCommit.update ?? new Uint8Array();
  const targetUpdate = result.targetCommit?.update ?? new Uint8Array();
  const targetStateVector =
    result.targetCommit?.stateVector ?? new Uint8Array();
  const payload = new Uint8Array(
    sourceUpdate.byteLength +
      result.sourceCommit.stateVector.byteLength +
      targetUpdate.byteLength +
      targetStateVector.byteLength,
  );
  let offset = appendBytes(payload, 0, sourceUpdate);
  offset = appendBytes(payload, offset, result.sourceCommit.stateVector);
  offset = appendBytes(payload, offset, targetUpdate);
  appendBytes(payload, offset, targetStateVector);

  const source = {
    documentId: result.sourceCommit.documentId,
    generation: result.sourceCommit.generation,
    baseHeadSeq: result.sourceCommit.baseHeadSeq,
    headSeq: result.sourceCommit.headSeq,
    updateId: result.sourceCommit.updateId,
  };
  const targetCommit = result.targetCommit;
  const target = targetCommit
    ? {
        documentId: targetCommit.documentId,
        generation: targetCommit.generation,
        baseHeadSeq: targetCommit.baseHeadSeq,
        headSeq: targetCommit.headSeq,
        updateId: targetCommit.updateId,
      }
    : undefined;
  const base = {
    relocationId: result.relocationId,
    projectId: result.projectId,
    storeEpoch: result.storeEpoch,
    duplicate: result.duplicate,
    rootBlockIds: result.rootBlockIds,
    movedBlockIds: result.movedBlockIds,
    finalLocations: result.finalLocations,
    finalLocationRevisions: result.finalLocationRevisions,
    changeLogSeq: result.changeLogSeq,
    committedAt: result.committedAt,
  };
  return encodeDocumentHttpEnvelope<RelocationHttpResultMetadata>(
    {
      version: 1,
      result: {
        ...base,
        sourceCommit: source,
        ...(target ? { targetCommit: target } : {}),
      },
      source: {
        updateLength: sourceUpdate.byteLength,
        stateVectorLength: result.sourceCommit.stateVector.byteLength,
        hasUpdate: result.sourceCommit.update !== null,
      },
      ...(targetCommit
        ? {
            target: {
              updateLength: targetUpdate.byteLength,
              stateVectorLength: targetStateVector.byteLength,
              hasUpdate: targetCommit.update !== null,
            },
          }
        : {}),
    },
    payload,
  );
};

export const decodeRelocationHttpResult = (
  bytes: Uint8Array,
  expectedIntent?: RelocationIntent,
): RelocationResult => {
  const envelope = decodeDocumentHttpEnvelope(
    bytes,
    parseResultMetadata,
    MAX_RELOCATION_HTTP_PAYLOAD_BYTES,
  );
  let offset = 0;
  const [sourceUpdate, afterSourceUpdate] = readBytes(
    envelope.payload,
    offset,
    envelope.metadata.source.updateLength,
    "Relocation source update",
  );
  offset = afterSourceUpdate;
  const [sourceStateVector, afterSourceStateVector] = readBytes(
    envelope.payload,
    offset,
    envelope.metadata.source.stateVectorLength,
    "Relocation source state vector",
  );
  offset = afterSourceStateVector;
  const targetBoundary = envelope.metadata.target;
  let targetUpdate: Uint8Array = new Uint8Array();
  let targetStateVector: Uint8Array = new Uint8Array();
  if (targetBoundary) {
    [targetUpdate, offset] = readBytes(
      envelope.payload,
      offset,
      targetBoundary.updateLength,
      "Relocation target update",
    );
    [targetStateVector, offset] = readBytes(
      envelope.payload,
      offset,
      targetBoundary.stateVectorLength,
      "Relocation target state vector",
    );
  }
  if (offset !== envelope.payload.byteLength) {
    throw new DocumentHttpWireError("Relocation response has trailing bytes");
  }

  let result: RelocationResult;
  try {
    result = parseRelocationResult({
      ...envelope.metadata.result,
      sourceCommit: {
        ...envelope.metadata.result.sourceCommit,
        update: envelope.metadata.source.hasUpdate ? sourceUpdate : null,
        stateVector: sourceStateVector,
      },
      ...(envelope.metadata.result.targetCommit && targetBoundary
        ? {
            targetCommit: {
              ...envelope.metadata.result.targetCommit,
              update: targetBoundary.hasUpdate ? targetUpdate : null,
              stateVector: targetStateVector,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof RelocationContractError) {
      throw new DocumentHttpWireError("Relocation response is invalid", {
        cause: error,
      });
    }
    throw error;
  }
  if (expectedIntent) assertResultMatchesIntent(result, expectedIntent);
  return result;
};

export const encodeRelocationHttpError = (
  error: RelocationCommandError,
): string => JSON.stringify({ version: 1, ok: false, error });

export const decodeRelocationHttpError = (
  serialized: string,
): RelocationCommandError => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new DocumentHttpWireError("Relocation error is invalid JSON", {
      cause: error,
    });
  }
  const root = requireRecord(value, "Relocation error");
  requireExactKeys(root, "Relocation error", ["version", "ok", "error"]);
  if (root.version !== 1 || root.ok !== false) {
    throw new DocumentHttpWireError("Relocation error envelope is invalid");
  }
  const error = requireRecord(root.error, "Relocation error detail");
  const code = requireString(
    error,
    "code",
    "Relocation error detail",
  ) as RelocationCommandError["code"];
  if (!RELOCATION_ERROR_CODES.has(code)) {
    throw new DocumentHttpWireError("Relocation error code is invalid");
  }
  const relocationId =
    error.relocationId === undefined
      ? undefined
      : requireString(error, "relocationId", "Relocation error detail");
  const recoveryArtifactId =
    error.recoveryArtifactId === undefined
      ? undefined
      : requireString(error, "recoveryArtifactId", "Relocation error detail");
  return {
    code,
    message: requireString(error, "message", "Relocation error detail"),
    retryable: requireBoolean(error, "retryable", "Relocation error detail"),
    reloadRequired: requireBoolean(
      error,
      "reloadRequired",
      "Relocation error detail",
    ),
    ...(relocationId ? { relocationId } : {}),
    ...(recoveryArtifactId ? { recoveryArtifactId } : {}),
  };
};
