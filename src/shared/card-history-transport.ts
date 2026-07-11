import {
  CARD_HISTORY_CONTRACT_VERSION,
  MAX_CARD_HISTORY_PAGE_SIZE,
  type CardBlockMutationHistoryEntry,
  type CardBlockRelocationHistoryEntry,
  type CardDocumentVersionHistoryEntry,
  type CardHistoryCategory,
  type CardHistoryCursor,
  type CardHistoryDisplay,
  type CardHistoryEntry,
  type CardHistoryEvidence,
  type CardHistoryPage,
  type CardHistoryRecovery,
  type ListCardHistoryRequest,
} from "./card-history";

const MAX_ID_LENGTH = 512;
const MAX_ENTRY_ID_LENGTH = 1_024;
const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_DISPLAY_TITLE_LENGTH = 256;
const MAX_DISPLAY_DETAIL_LENGTH = 512;
const MAX_ACTOR_LABEL_LENGTH = 256;

const HISTORY_CATEGORIES = new Set<CardHistoryCategory>([
  "checkpoint",
  "content",
  "property",
  "database",
  "lifecycle",
  "location",
  "unknown",
]);

const HISTORY_ERROR_CODES = new Set<CardHistoryCommandErrorCode>([
  "invalid_card_history_request",
  "card_not_found",
  "card_history_corrupt",
  "unknown",
]);

export type CardHistoryCommandErrorCode =
  | "invalid_card_history_request"
  | "card_not_found"
  | "card_history_corrupt"
  | "unknown";

export interface CardHistoryCommandError {
  readonly code: CardHistoryCommandErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type CardHistoryCommandResult =
  | { readonly ok: true; readonly value: CardHistoryPage }
  | { readonly ok: false; readonly error: CardHistoryCommandError };

export class CardHistoryContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardHistoryContractError";
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
  throw new CardHistoryContractError(`${label} must be an object`);
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
    throw new CardHistoryContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new CardHistoryContractError(`${label}.${key} is not supported`);
  }
};

const readStringValue = (
  value: unknown,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CardHistoryContractError(
    `${label} must be a non-empty bounded string`,
  );
};

const readNullableStringValue = (
  value: unknown,
  label: string,
  maximumLength: number,
): string | null => {
  if (value === null) return null;
  return readStringValue(value, label, maximumLength);
};

const readSafeIntegerValue = (
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    return value;
  }
  throw new CardHistoryContractError(`${label} must be a safe integer in range`);
};

const readNullableSafeIntegerValue = (
  value: unknown,
  label: string,
  minimum: number,
): number | null => {
  if (value === null) return null;
  return readSafeIntegerValue(value, label, minimum);
};

const readCanonicalTimestamp = (value: unknown, label: string): string => {
  const timestamp = readStringValue(value, label, 256);
  if (
    Number.isFinite(Date.parse(timestamp)) &&
    new Date(timestamp).toISOString() === timestamp
  ) {
    return timestamp;
  }
  throw new CardHistoryContractError(
    `${label} must be a canonical ISO timestamp`,
  );
};

const readHash = (value: unknown, label: string): string => {
  if (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)) return value;
  throw new CardHistoryContractError(`${label} must be a SHA-256 digest`);
};

export const parseCardHistoryCursor = (
  value: unknown,
  label = "cardHistoryCursor",
): CardHistoryCursor => {
  const record = readRecord(value, label);
  if (record.source === "document_version") {
    assertExactKeys(record, label, ["occurredAt", "source", "versionId"]);
    return {
      occurredAt: readCanonicalTimestamp(
        record.occurredAt,
        `${label}.occurredAt`,
      ),
      source: "document_version",
      versionId: readStringValue(record.versionId, `${label}.versionId`),
    };
  }
  if (record.source === "change_log") {
    assertExactKeys(record, label, ["occurredAt", "source", "changeSeq"]);
    return {
      occurredAt: readCanonicalTimestamp(
        record.occurredAt,
        `${label}.occurredAt`,
      ),
      source: "change_log",
      changeSeq: readSafeIntegerValue(
        record.changeSeq,
        `${label}.changeSeq`,
        1,
      ),
    };
  }
  throw new CardHistoryContractError(`${label}.source is unsupported`);
};

export const parseListCardHistoryRequest = (
  value: unknown,
): ListCardHistoryRequest => {
  const label = "listCardHistory";
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    ["version", "projectId", "cardBlockId"],
    ["before", "pageSize"],
  );
  if (record.version !== CARD_HISTORY_CONTRACT_VERSION) {
    throw new CardHistoryContractError(
      `${label}.version must be ${CARD_HISTORY_CONTRACT_VERSION}`,
    );
  }
  const before =
    record.before === undefined
      ? undefined
      : parseCardHistoryCursor(record.before, `${label}.before`);
  const pageSize =
    record.pageSize === undefined
      ? undefined
      : readSafeIntegerValue(
          record.pageSize,
          `${label}.pageSize`,
          1,
          MAX_CARD_HISTORY_PAGE_SIZE,
        );
  return {
    version: CARD_HISTORY_CONTRACT_VERSION,
    projectId: readStringValue(record.projectId, `${label}.projectId`),
    cardBlockId: readStringValue(
      record.cardBlockId,
      `${label}.cardBlockId`,
    ),
    ...(before === undefined ? {} : { before }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
};

const parseDisplay = (value: unknown, label: string): CardHistoryDisplay => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, ["category", "title", "detail", "actorLabel"]);
  if (
    typeof record.category !== "string" ||
    !HISTORY_CATEGORIES.has(record.category as CardHistoryCategory)
  ) {
    throw new CardHistoryContractError(`${label}.category is unsupported`);
  }
  return {
    category: record.category as CardHistoryCategory,
    title: readStringValue(
      record.title,
      `${label}.title`,
      MAX_DISPLAY_TITLE_LENGTH,
    ),
    detail: readNullableStringValue(
      record.detail,
      `${label}.detail`,
      MAX_DISPLAY_DETAIL_LENGTH,
    ),
    actorLabel: readNullableStringValue(
      record.actorLabel,
      `${label}.actorLabel`,
      MAX_ACTOR_LABEL_LENGTH,
    ),
  };
};

const parseEvidence = (value: unknown, label: string): CardHistoryEvidence => {
  const record = readRecord(value, label);
  if (record.status === "verified") {
    assertExactKeys(record, label, ["status"]);
    return { status: "verified" };
  }
  if (record.status === "unavailable") {
    assertExactKeys(record, label, ["status", "reason"]);
    if (
      record.reason === "missing_ledger" ||
      record.reason === "malformed_evidence" ||
      record.reason === "unsupported_evidence"
    ) {
      return { status: "unavailable", reason: record.reason };
    }
  }
  throw new CardHistoryContractError(`${label} is invalid`);
};

const parseRecovery = (value: unknown, label: string): CardHistoryRecovery => {
  const record = readRecord(value, label);
  if (record.kind === "restore_document_version") {
    assertExactKeys(record, label, ["kind", "documentId", "versionId"]);
    return {
      kind: "restore_document_version",
      documentId: readStringValue(record.documentId, `${label}.documentId`),
      versionId: readStringValue(record.versionId, `${label}.versionId`),
    };
  }
  if (record.kind === "unavailable") {
    assertExactKeys(record, label, ["kind", "reason"]);
    if (
      record.reason === "document_generation_changed" ||
      record.reason === "insufficient_evidence" ||
      record.reason === "no_inverse_contract"
    ) {
      return { kind: "unavailable", reason: record.reason };
    }
  }
  throw new CardHistoryContractError(`${label} is invalid`);
};

interface ParsedEntryBase {
  readonly id: string;
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly documentId: string;
  readonly occurredAt: string;
  readonly display: CardHistoryDisplay;
  readonly evidence: CardHistoryEvidence;
  readonly recovery: CardHistoryRecovery;
}

const parseEntryBase = (
  record: Readonly<Record<string, unknown>>,
  label: string,
): ParsedEntryBase => ({
  id: readStringValue(record.id, `${label}.id`, MAX_ENTRY_ID_LENGTH),
  projectId: readStringValue(record.projectId, `${label}.projectId`),
  cardBlockId: readStringValue(record.cardBlockId, `${label}.cardBlockId`),
  documentId: readStringValue(record.documentId, `${label}.documentId`),
  occurredAt: readCanonicalTimestamp(record.occurredAt, `${label}.occurredAt`),
  display: parseDisplay(record.display, `${label}.display`),
  evidence: parseEvidence(record.evidence, `${label}.evidence`),
  recovery: parseRecovery(record.recovery, `${label}.recovery`),
});

const ENTRY_BASE_KEYS = [
  "id",
  "kind",
  "projectId",
  "cardBlockId",
  "documentId",
  "occurredAt",
  "display",
  "evidence",
  "recovery",
] as const;

const parseVersionEntry = (
  record: Readonly<Record<string, unknown>>,
  label: string,
): CardDocumentVersionHistoryEntry => {
  assertExactKeys(record, label, [...ENTRY_BASE_KEYS, "versionMetadata"]);
  const metadataLabel = `${label}.versionMetadata`;
  const metadata = readRecord(record.versionMetadata, metadataLabel);
  assertExactKeys(metadata, metadataLabel, [
    "versionId",
    "generation",
    "baseHeadSeq",
    "schemaKey",
    "schemaVersion",
    "cause",
    "label",
    "checkpointHash",
    "byteLength",
  ]);
  const base = parseEntryBase(record, label);
  return {
    ...base,
    kind: "document_version",
    versionMetadata: {
      versionId: readStringValue(
        metadata.versionId,
        `${metadataLabel}.versionId`,
      ),
      generation: readSafeIntegerValue(
        metadata.generation,
        `${metadataLabel}.generation`,
        1,
      ),
      baseHeadSeq: readSafeIntegerValue(
        metadata.baseHeadSeq,
        `${metadataLabel}.baseHeadSeq`,
        0,
      ),
      schemaKey: readStringValue(
        metadata.schemaKey,
        `${metadataLabel}.schemaKey`,
        128,
      ),
      schemaVersion: readSafeIntegerValue(
        metadata.schemaVersion,
        `${metadataLabel}.schemaVersion`,
        1,
      ),
      cause: readStringValue(metadata.cause, `${metadataLabel}.cause`, 128),
      label: readNullableStringValue(
        metadata.label,
        `${metadataLabel}.label`,
        512,
      ),
      checkpointHash: readHash(
        metadata.checkpointHash,
        `${metadataLabel}.checkpointHash`,
      ),
      byteLength: readSafeIntegerValue(
        metadata.byteLength,
        `${metadataLabel}.byteLength`,
        1,
      ),
    },
  };
};

const parseMutationEntry = (
  record: Readonly<Record<string, unknown>>,
  label: string,
): CardBlockMutationHistoryEntry => {
  assertExactKeys(record, label, [
    ...ENTRY_BASE_KEYS,
    "changeSeq",
    "mutationId",
    "mutationKind",
    "affectedBlockCount",
    "fieldIntentCount",
  ]);
  return {
    ...parseEntryBase(record, label),
    kind: "block_mutation",
    changeSeq: readSafeIntegerValue(record.changeSeq, `${label}.changeSeq`, 1),
    mutationId: readNullableStringValue(
      record.mutationId,
      `${label}.mutationId`,
      MAX_ID_LENGTH,
    ),
    mutationKind: readNullableStringValue(
      record.mutationKind,
      `${label}.mutationKind`,
      128,
    ),
    affectedBlockCount: readNullableSafeIntegerValue(
      record.affectedBlockCount,
      `${label}.affectedBlockCount`,
      0,
    ),
    fieldIntentCount: readNullableSafeIntegerValue(
      record.fieldIntentCount,
      `${label}.fieldIntentCount`,
      0,
    ),
  };
};

const parseRelocationEntry = (
  record: Readonly<Record<string, unknown>>,
  label: string,
): CardBlockRelocationHistoryEntry => {
  assertExactKeys(record, label, [
    ...ENTRY_BASE_KEYS,
    "changeSeq",
    "relocationId",
    "direction",
    "movedBlockCount",
  ]);
  if (
    record.direction !== "into_card" &&
    record.direction !== "out_of_card" &&
    record.direction !== "within_card" &&
    record.direction !== "unknown"
  ) {
    throw new CardHistoryContractError(`${label}.direction is unsupported`);
  }
  return {
    ...parseEntryBase(record, label),
    kind: "block_relocation",
    changeSeq: readSafeIntegerValue(record.changeSeq, `${label}.changeSeq`, 1),
    relocationId: readNullableStringValue(
      record.relocationId,
      `${label}.relocationId`,
      MAX_ID_LENGTH,
    ),
    direction: record.direction,
    movedBlockCount: readNullableSafeIntegerValue(
      record.movedBlockCount,
      `${label}.movedBlockCount`,
      0,
    ),
  };
};

const parseEntry = (value: unknown, label: string): CardHistoryEntry => {
  const record = readRecord(value, label);
  if (record.kind === "document_version") {
    return parseVersionEntry(record, label);
  }
  if (record.kind === "block_mutation") {
    return parseMutationEntry(record, label);
  }
  if (record.kind === "block_relocation") {
    return parseRelocationEntry(record, label);
  }
  throw new CardHistoryContractError(`${label}.kind is unsupported`);
};

const cursorForEntry = (entry: CardHistoryEntry): CardHistoryCursor =>
  entry.kind === "document_version"
    ? {
        occurredAt: entry.occurredAt,
        source: "document_version",
        versionId: entry.versionMetadata.versionId,
      }
    : {
        occurredAt: entry.occurredAt,
        source: "change_log",
        changeSeq: entry.changeSeq,
      };

const sameCursor = (
  left: CardHistoryCursor,
  right: CardHistoryCursor,
): boolean => {
  if (left.source !== right.source || left.occurredAt !== right.occurredAt) {
    return false;
  }
  if (left.source === "document_version" && right.source === "document_version") {
    return left.versionId === right.versionId;
  }
  return (
    left.source === "change_log" &&
    right.source === "change_log" &&
    left.changeSeq === right.changeSeq
  );
};

export const parseCardHistoryPage = (value: unknown): CardHistoryPage => {
  const label = "cardHistoryPage";
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "version",
    "projectId",
    "cardBlockId",
    "documentId",
    "entries",
    "nextCursor",
  ]);
  if (record.version !== CARD_HISTORY_CONTRACT_VERSION) {
    throw new CardHistoryContractError(
      `${label}.version must be ${CARD_HISTORY_CONTRACT_VERSION}`,
    );
  }
  if (!Array.isArray(record.entries)) {
    throw new CardHistoryContractError(`${label}.entries must be an array`);
  }
  if (record.entries.length > MAX_CARD_HISTORY_PAGE_SIZE) {
    throw new CardHistoryContractError(`${label}.entries exceeds the page budget`);
  }
  const projectId = readStringValue(record.projectId, `${label}.projectId`);
  const cardBlockId = readStringValue(
    record.cardBlockId,
    `${label}.cardBlockId`,
  );
  const documentId = readStringValue(record.documentId, `${label}.documentId`);
  const entries = record.entries.map((entry, index) =>
    parseEntry(entry, `${label}.entries[${index}]`),
  );
  const entryIds = new Set(entries.map((entry) => entry.id));
  if (entryIds.size !== entries.length) {
    throw new CardHistoryContractError(`${label}.entries contains duplicate ids`);
  }
  if (
    !entries.every(
      (entry) =>
        entry.projectId === projectId &&
        entry.cardBlockId === cardBlockId &&
        entry.documentId === documentId,
    )
  ) {
    throw new CardHistoryContractError(`${label}.entries escaped their scope`);
  }
  const nextCursor =
    record.nextCursor === null
      ? null
      : parseCardHistoryCursor(record.nextCursor, `${label}.nextCursor`);
  const lastEntry = entries.at(-1);
  if (nextCursor && (!lastEntry || !sameCursor(nextCursor, cursorForEntry(lastEntry)))) {
    throw new CardHistoryContractError(
      `${label}.nextCursor must identify the final entry`,
    );
  }
  return {
    version: CARD_HISTORY_CONTRACT_VERSION,
    projectId,
    cardBlockId,
    documentId,
    entries,
    nextCursor,
  };
};

export const cardHistoryFailure = (
  code: CardHistoryCommandErrorCode,
  message: string,
  retryable = false,
): CardHistoryCommandError => ({ code, message, retryable });

const parseCommandError = (value: unknown): CardHistoryCommandError => {
  const label = "cardHistoryError";
  const record = readRecord(value, label);
  assertExactKeys(record, label, ["code", "message", "retryable"]);
  if (
    typeof record.code !== "string" ||
    !HISTORY_ERROR_CODES.has(record.code as CardHistoryCommandErrorCode)
  ) {
    throw new CardHistoryContractError(`${label}.code is unsupported`);
  }
  if (typeof record.retryable !== "boolean") {
    throw new CardHistoryContractError(`${label}.retryable must be boolean`);
  }
  return {
    code: record.code as CardHistoryCommandErrorCode,
    message: readStringValue(
      record.message,
      `${label}.message`,
      MAX_ERROR_MESSAGE_LENGTH,
    ),
    retryable: record.retryable,
  };
};

export const parseCardHistoryCommandResult = (
  value: unknown,
): CardHistoryCommandResult => {
  const label = "cardHistoryResult";
  const record = readRecord(value, label);
  if (record.ok === true) {
    assertExactKeys(record, label, ["ok", "value"]);
    return { ok: true, value: parseCardHistoryPage(record.value) };
  }
  if (record.ok === false) {
    assertExactKeys(record, label, ["ok", "error"]);
    return { ok: false, error: parseCommandError(record.error) };
  }
  throw new CardHistoryContractError(`${label}.ok must be boolean`);
};

export const cardHistoryHttpStatus = (
  result: CardHistoryCommandResult,
): 200 | 400 | 404 | 500 => {
  if (result.ok) return 200;
  if (result.error.code === "card_not_found") return 404;
  if (result.error.code === "card_history_corrupt") return 500;
  if (result.error.code === "unknown") return 500;
  return 400;
};

export const cardHistoryTransportFailure = (): CardHistoryCommandResult => ({
  ok: false,
  error: cardHistoryFailure(
    "unknown",
    "The durable Card history reader is unavailable",
    true,
  ),
});
