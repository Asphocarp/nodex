import { stableStringifyBlockPropertyJson } from "../block-property-mutations";
import type { BlockTreeValue } from "./block-document-codec";
import {
  DOCUMENT_VERSION_CONTRACT_VERSION,
  MAX_DOCUMENT_VERSION_CAUSE_LENGTH,
  MAX_DOCUMENT_VERSION_HISTORY_LIMIT,
  MAX_DOCUMENT_VERSION_LABEL_LENGTH,
  type CreateDocumentVersionCheckpoint,
  type DocumentVersionActor,
  type GetDocumentVersion,
  type ListDocumentVersions,
} from "./document-history";

const MAX_SCOPE_ID_LENGTH = 512;

export type DocumentHistoryCommandErrorCode =
  | "invalid_document_history_request"
  | "store_epoch_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "project_scope_mismatch"
  | "document_generation_conflict"
  | "document_head_conflict"
  | "document_version_not_found"
  | "document_version_schema_mismatch"
  | "document_history_corrupt"
  | "unknown";

export interface DocumentHistoryCommandError {
  readonly code: DocumentHistoryCommandErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly expectedGeneration?: number;
  readonly actualGeneration?: number;
  readonly expectedHeadSeq?: number;
  readonly actualHeadSeq?: number;
}

export type DocumentHistoryCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DocumentHistoryCommandError };

export class DocumentHistoryContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentHistoryContractError";
  }
}

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new DocumentHistoryContractError(`${label} must be an object`);
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.hasOwn(record, key)) continue;
    throw new DocumentHistoryContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new DocumentHistoryContractError(`${label}.${key} is not supported`);
  }
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_SCOPE_ID_LENGTH,
): string => {
  const value = record[key];
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new DocumentHistoryContractError(
    `${label}.${key} must be a non-empty bounded string`,
  );
};

const readInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    return value;
  }
  throw new DocumentHistoryContractError(
    `${label}.${key} must be a safe integer in range`,
  );
};

const readActor = (value: unknown, label: string): DocumentVersionActor => {
  if (!isRecord(value)) {
    throw new DocumentHistoryContractError(`${label} must be an object`);
  }
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as Readonly<Record<string, BlockTreeValue>>;
  } catch (error) {
    throw new DocumentHistoryContractError(
      `${label} must be bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const parseCreateDocumentVersionCheckpoint = (
  value: unknown,
): CreateDocumentVersionCheckpoint => {
  const label = "createDocumentVersionCheckpoint";
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    [
      "version",
      "projectId",
      "storeEpoch",
      "documentId",
      "expectedGeneration",
      "expectedHeadSeq",
      "cause",
      "actor",
    ],
    ["label"],
  );
  if (record.version !== DOCUMENT_VERSION_CONTRACT_VERSION) {
    throw new DocumentHistoryContractError(
      `${label}.version must be ${DOCUMENT_VERSION_CONTRACT_VERSION}`,
    );
  }
  const optionalLabel =
    record.label === undefined
      ? undefined
      : readString(record, "label", label, MAX_DOCUMENT_VERSION_LABEL_LENGTH);
  return {
    version: DOCUMENT_VERSION_CONTRACT_VERSION,
    projectId: readString(record, "projectId", label),
    storeEpoch: readString(record, "storeEpoch", label),
    documentId: readString(record, "documentId", label),
    expectedGeneration: readInteger(
      record,
      "expectedGeneration",
      label,
      1,
    ),
    expectedHeadSeq: readInteger(record, "expectedHeadSeq", label, 0),
    cause: readString(
      record,
      "cause",
      label,
      MAX_DOCUMENT_VERSION_CAUSE_LENGTH,
    ),
    ...(optionalLabel === undefined ? {} : { label: optionalLabel }),
    actor: readActor(record.actor, `${label}.actor`),
  };
};

export const parseListDocumentVersions = (
  value: unknown,
): ListDocumentVersions => {
  const label = "listDocumentVersions";
  const record = readRecord(value, label);
  assertExactKeys(record, label, ["projectId", "documentId"], ["before", "limit"]);
  const limit =
    record.limit === undefined
      ? undefined
      : readInteger(
          record,
          "limit",
          label,
          1,
          MAX_DOCUMENT_VERSION_HISTORY_LIMIT,
        );
  let before: ListDocumentVersions["before"];
  if (record.before !== undefined) {
    const cursor = readRecord(record.before, `${label}.before`);
    assertExactKeys(cursor, `${label}.before`, [
      "baseHeadSeq",
      "createdAt",
      "versionId",
    ]);
    before = {
      baseHeadSeq: readInteger(cursor, "baseHeadSeq", `${label}.before`, 0),
      createdAt: readString(cursor, "createdAt", `${label}.before`, 256),
      versionId: readString(cursor, "versionId", `${label}.before`),
    };
  }
  return {
    projectId: readString(record, "projectId", label),
    documentId: readString(record, "documentId", label),
    ...(before === undefined ? {} : { before }),
    ...(limit === undefined ? {} : { limit }),
  };
};

export const parseGetDocumentVersion = (
  value: unknown,
): GetDocumentVersion => {
  const label = "getDocumentVersion";
  const record = readRecord(value, label);
  assertExactKeys(record, label, ["projectId", "documentId", "versionId"]);
  return {
    projectId: readString(record, "projectId", label),
    documentId: readString(record, "documentId", label),
    versionId: readString(record, "versionId", label),
  };
};

export const bindTrustedDocumentVersionCheckpoint = (
  rawRequest: unknown,
  projectId: string,
  documentId: string,
  actor: DocumentVersionActor,
): CreateDocumentVersionCheckpoint => {
  const request = parseCreateDocumentVersionCheckpoint(rawRequest);
  if (request.projectId !== projectId || request.documentId !== documentId) {
    throw new DocumentHistoryContractError(
      "Document checkpoint does not match its Project and Document scope",
    );
  }
  return parseCreateDocumentVersionCheckpoint({
    ...request,
    projectId,
    documentId,
    actor,
  });
};

export const documentHistoryFailure = (
  code: DocumentHistoryCommandErrorCode,
  message: string,
  options: Omit<
    Partial<DocumentHistoryCommandError>,
    "code" | "message" | "retryable"
  > & { readonly retryable?: boolean } = {},
): DocumentHistoryCommandError => {
  const { retryable = false, ...details } = options;
  return { code, message, retryable, ...details };
};

export const documentHistoryHttpStatus = (
  error: DocumentHistoryCommandError,
): 400 | 404 | 409 | 500 | 503 => {
  if (
    error.code === "document_not_found" ||
    error.code === "document_version_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "document_not_ready" ||
    error.code === "document_generation_conflict" ||
    error.code === "document_head_conflict" ||
    error.code === "document_version_schema_mismatch"
  ) {
    return 409;
  }
  if (error.code === "unknown" && error.retryable) return 503;
  if (error.code === "unknown" || error.code === "document_history_corrupt") {
    return 500;
  }
  return 400;
};
