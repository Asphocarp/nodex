import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import { isCardStatus, type CardStatus } from "./card-status";

export const CARD_PROJECT_TRANSFER_CONTRACT_VERSION = 1 as const;

const MAX_ID_LENGTH = 512;
const MAX_TYPE_LENGTH = 128;
const MAX_CLOSURE_ENTRIES = 100_000;

export interface CardProjectTransferIntentTarget {
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly status: CardStatus;
  readonly beforeBlockId?: string;
  readonly beforeViewCardId?: string;
}

/**
 * Publicly meaningful transfer intent. Authority coordinates are deliberately
 * absent: the single SQLite writer compiles them immediately before use.
 * Audit identity is present only after a trusted host boundary binds it.
 */
export interface CardProjectTransferIntent {
  readonly version: typeof CARD_PROJECT_TRANSFER_CONTRACT_VERSION;
  readonly operationId: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly cardId: string;
  readonly target: CardProjectTransferIntentTarget;
  readonly clientSessionId: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
}

export interface CardProjectTransferBlockCoordinate {
  readonly blockId: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location:
    | Readonly<{ kind: "space" }>
    | Readonly<{ kind: "document"; documentId: string }>;
  readonly locationRevision: number;
  readonly metadataRevision: number;
}

export interface CardProjectTransferDocumentCoordinate {
  readonly ownerBlockId: string;
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export interface CardProjectTransferMembershipCoordinate {
  readonly cardBlockId: string;
  readonly membershipId: string;
  readonly databaseBlockId: string;
  readonly databaseSchemaRevision: number;
  readonly membershipRevision: number;
  readonly statusPropertyId: string;
  readonly statusValueRevision: number;
  readonly status: CardStatus;
}

export interface CardProjectTransferTarget {
  readonly databaseBlockId: string;
  readonly databaseSchemaRevision: number;
  readonly viewId: string;
  readonly viewRevision: number;
  readonly status: CardStatus;
  readonly beforeBlockId?: string;
  readonly beforeViewCardId?: string;
}

/**
 * A transfer request is a complete exact-authority claim compiled from one
 * source/target read snapshot. The closure arrays are sorted by stable ID so
 * semantically identical retries serialize to one canonical request.
 */
export interface CardProjectTransferRequest {
  readonly version: typeof CARD_PROJECT_TRANSFER_CONTRACT_VERSION;
  readonly operationId: string;
  readonly storeEpoch: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly cardId: string;
  readonly expectedTopLevelRankKey: string;
  readonly expectedBlocks: readonly CardProjectTransferBlockCoordinate[];
  readonly expectedDocuments: readonly CardProjectTransferDocumentCoordinate[];
  readonly expectedMemberships: readonly CardProjectTransferMembershipCoordinate[];
  readonly target: CardProjectTransferTarget;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
}

export interface CardProjectTransferReceipt {
  readonly version: typeof CARD_PROJECT_TRANSFER_CONTRACT_VERSION;
  readonly operationId: string;
  readonly storeEpoch: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly cardId: string;
  readonly duplicate: boolean;
  readonly movedBlockIds: readonly string[];
  readonly movedDocumentIds: readonly string[];
  readonly sourceMembershipIds: readonly string[];
  readonly targetMembershipIds: Readonly<Record<string, string>>;
  readonly blockMetadataRevisions: Readonly<Record<string, number>>;
  readonly rootLocationRevision: number;
  readonly documentHeads: Readonly<
    Record<string, Readonly<{ generation: number; headSeq: number }>>
  >;
  readonly targetDatabaseBlockId: string;
  readonly targetDatabaseSchemaRevision: number;
  readonly targetViewId: string;
  readonly targetStatus: CardStatus;
  readonly targetTopLevelRankKey: string;
  readonly targetViewRankKey: string;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type CardProjectTransferErrorCode =
  | "invalid_card_project_transfer_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "operation_receipt_corrupt"
  | "source_project_not_found"
  | "target_project_not_found"
  | "same_project"
  | "card_not_found"
  | "card_type_mismatch"
  | "card_lifecycle_conflict"
  | "card_location_invalid"
  | "block_authority_conflict"
  | "document_authority_conflict"
  | "document_generation_mismatch"
  | "document_head_conflict"
  | "coordination_failed"
  | "membership_authority_conflict"
  | "target_database_conflict"
  | "target_view_conflict"
  | "target_property_schema_invalid"
  | "target_property_value_invalid"
  | "position_anchor_not_found"
  | "position_anchor_group_mismatch"
  | "foreign_key_violation"
  | "unknown";

export interface CardProjectTransferCommandError {
  readonly code: CardProjectTransferErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly cardId?: string;
}

export type CardProjectTransferCommandResult<
  Value = CardProjectTransferReceipt,
> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: CardProjectTransferCommandError };

export interface PreparedCardProjectTransfer {
  readonly kind: "prepared";
  readonly intent: CardProjectTransferIntent;
  readonly request: CardProjectTransferRequest;
}

export interface CommittedCardProjectTransfer {
  readonly kind: "committed";
  readonly intent: CardProjectTransferIntent;
  readonly receipt: CardProjectTransferReceipt;
}

export type CardProjectTransferPreparation =
  | PreparedCardProjectTransfer
  | CommittedCardProjectTransfer;

export class CardProjectTransferContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardProjectTransferContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new CardProjectTransferContractError(`${label} must be an object`);
};

const assertExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.hasOwn(value, key)) continue;
    throw new CardProjectTransferContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new CardProjectTransferContractError(
      `${label}.${key} is not supported`,
    );
  }
};

const readString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximum = MAX_ID_LENGTH,
): string => {
  const candidate = value[key];
  if (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= maximum &&
    candidate === candidate.trim()
  ) {
    return candidate;
  }
  throw new CardProjectTransferContractError(
    `${label}.${key} must be a canonical bounded identity`,
  );
};

const readOptionalString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | undefined =>
  value[key] === undefined ? undefined : readString(value, key, label);

const readRevision = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): number => {
  const candidate = value[key];
  if (
    typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 1
  ) {
    return candidate;
  }
  throw new CardProjectTransferContractError(
    `${label}.${key} must be a safe integer >= 1`,
  );
};

const readStatus = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): CardStatus => {
  const candidate = value[key];
  if (isCardStatus(candidate)) return candidate;
  throw new CardProjectTransferContractError(
    `${label}.${key} must be a Card status`,
  );
};

const readSortedArray = <T>(
  value: unknown,
  label: string,
  parse: (entry: unknown, index: number) => T,
  identity: (entry: T) => string,
): readonly T[] => {
  if (!Array.isArray(value) || value.length > MAX_CLOSURE_ENTRIES) {
    throw new CardProjectTransferContractError(
      `${label} must be a bounded array`,
    );
  }
  const parsed = value.map(parse);
  let previous: string | null = null;
  for (const entry of parsed) {
    const current = identity(entry);
    if (previous !== null && previous.localeCompare(current) >= 0) {
      throw new CardProjectTransferContractError(
        `${label} must be strictly sorted by stable identity`,
      );
    }
    previous = current;
  }
  return parsed;
};

const parseBlockCoordinate = (
  value: unknown,
  index: number,
): CardProjectTransferBlockCoordinate => {
  const label = `cardProjectTransfer.expectedBlocks[${index}]`;
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "blockId",
    "type",
    "lifecycle",
    "location",
    "locationRevision",
    "metadataRevision",
  ]);
  if (
    record.lifecycle !== "active" &&
    record.lifecycle !== "archived" &&
    record.lifecycle !== "deleted"
  ) {
    throw new CardProjectTransferContractError(
      `${label}.lifecycle is invalid`,
    );
  }
  const location = readRecord(record.location, `${label}.location`);
  if (location.kind === "space") {
    assertExactKeys(location, `${label}.location`, ["kind"]);
  } else if (location.kind === "document") {
    assertExactKeys(location, `${label}.location`, ["kind", "documentId"]);
  } else {
    throw new CardProjectTransferContractError(
      `${label}.location.kind is invalid`,
    );
  }
  return {
    blockId: readString(record, "blockId", label),
    type: readString(record, "type", label, MAX_TYPE_LENGTH),
    lifecycle: record.lifecycle,
    location:
      location.kind === "space"
        ? { kind: "space" }
        : {
            kind: "document",
            documentId: readString(location, "documentId", `${label}.location`),
          },
    locationRevision: readRevision(record, "locationRevision", label),
    metadataRevision: readRevision(record, "metadataRevision", label),
  };
};

const parseDocumentCoordinate = (
  value: unknown,
  index: number,
): CardProjectTransferDocumentCoordinate => {
  const label = `cardProjectTransfer.expectedDocuments[${index}]`;
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "ownerBlockId",
    "documentId",
    "generation",
    "headSeq",
    "schemaKey",
    "schemaVersion",
  ]);
  return {
    ownerBlockId: readString(record, "ownerBlockId", label),
    documentId: readString(record, "documentId", label),
    generation: readRevision(record, "generation", label),
    headSeq: readRevision(record, "headSeq", label),
    schemaKey: readString(record, "schemaKey", label, MAX_TYPE_LENGTH),
    schemaVersion: readRevision(record, "schemaVersion", label),
  };
};

const parseMembershipCoordinate = (
  value: unknown,
  index: number,
): CardProjectTransferMembershipCoordinate => {
  const label = `cardProjectTransfer.expectedMemberships[${index}]`;
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "cardBlockId",
    "membershipId",
    "databaseBlockId",
    "databaseSchemaRevision",
    "membershipRevision",
    "statusPropertyId",
    "statusValueRevision",
    "status",
  ]);
  return {
    cardBlockId: readString(record, "cardBlockId", label),
    membershipId: readString(record, "membershipId", label),
    databaseBlockId: readString(record, "databaseBlockId", label),
    databaseSchemaRevision: readRevision(
      record,
      "databaseSchemaRevision",
      label,
    ),
    membershipRevision: readRevision(record, "membershipRevision", label),
    statusPropertyId: readString(record, "statusPropertyId", label),
    statusValueRevision: readRevision(record, "statusValueRevision", label),
    status: readStatus(record, "status", label),
  };
};

const parseTarget = (value: unknown): CardProjectTransferTarget => {
  const label = "cardProjectTransfer.target";
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    [
      "databaseBlockId",
      "databaseSchemaRevision",
      "viewId",
      "viewRevision",
      "status",
    ],
    ["beforeBlockId", "beforeViewCardId"],
  );
  return {
    databaseBlockId: readString(record, "databaseBlockId", label),
    databaseSchemaRevision: readRevision(
      record,
      "databaseSchemaRevision",
      label,
    ),
    viewId: readString(record, "viewId", label),
    viewRevision: readRevision(record, "viewRevision", label),
    status: readStatus(record, "status", label),
    ...(readOptionalString(record, "beforeBlockId", label) === undefined
      ? {}
      : { beforeBlockId: readOptionalString(record, "beforeBlockId", label) }),
    ...(readOptionalString(record, "beforeViewCardId", label) === undefined
      ? {}
      : {
          beforeViewCardId: readOptionalString(
            record,
            "beforeViewCardId",
            label,
          ),
        }),
  };
};

const parseIntentTarget = (value: unknown): CardProjectTransferIntentTarget => {
  const label = "cardProjectTransferIntent.target";
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    ["databaseBlockId", "viewId", "status"],
    ["beforeBlockId", "beforeViewCardId"],
  );
  const beforeBlockId = readOptionalString(record, "beforeBlockId", label);
  const beforeViewCardId = readOptionalString(
    record,
    "beforeViewCardId",
    label,
  );
  return {
    databaseBlockId: readString(record, "databaseBlockId", label),
    viewId: readString(record, "viewId", label),
    status: readStatus(record, "status", label),
    ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    ...(beforeViewCardId === undefined ? {} : { beforeViewCardId }),
  };
};

const parseActor = (
  value: unknown,
): Readonly<Record<string, BlockPropertyJsonValue>> => {
  const actor = readRecord(value, "cardProjectTransfer.actor");
  try {
    return JSON.parse(stableStringifyBlockPropertyJson(actor)) as Readonly<
      Record<string, BlockPropertyJsonValue>
    >;
  } catch (error) {
    throw new CardProjectTransferContractError(
      `cardProjectTransfer.actor is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const parseCardProjectTransferIntent = (
  value: unknown,
): CardProjectTransferIntent => {
  const label = "cardProjectTransferIntent";
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "version",
    "operationId",
    "sourceProjectId",
    "targetProjectId",
    "cardId",
    "target",
    "clientSessionId",
    "actor",
  ]);
  if (record.version !== CARD_PROJECT_TRANSFER_CONTRACT_VERSION) {
    throw new CardProjectTransferContractError(
      `cardProjectTransferIntent.version must be ${CARD_PROJECT_TRANSFER_CONTRACT_VERSION}`,
    );
  }
  const intent: CardProjectTransferIntent = {
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    operationId: readString(record, "operationId", label),
    sourceProjectId: readString(record, "sourceProjectId", label),
    targetProjectId: readString(record, "targetProjectId", label),
    cardId: readString(record, "cardId", label),
    target: parseIntentTarget(record.target),
    clientSessionId: readString(record, "clientSessionId", label),
    actor: parseActor(record.actor),
  };
  if (intent.sourceProjectId === intent.targetProjectId) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferIntent source and target Projects must differ",
    );
  }
  stableStringifyBlockPropertyJson(intent);
  return intent;
};

export const cardProjectTransferIntentFromRequest = (
  request: CardProjectTransferRequest,
): CardProjectTransferIntent =>
  parseCardProjectTransferIntent({
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    operationId: request.operationId,
    sourceProjectId: request.sourceProjectId,
    targetProjectId: request.targetProjectId,
    cardId: request.cardId,
    target: {
      databaseBlockId: request.target.databaseBlockId,
      viewId: request.target.viewId,
      status: request.target.status,
      ...(request.target.beforeBlockId === undefined
        ? {}
        : { beforeBlockId: request.target.beforeBlockId }),
      ...(request.target.beforeViewCardId === undefined
        ? {}
        : { beforeViewCardId: request.target.beforeViewCardId }),
    },
    clientSessionId: request.clientSessionId ?? "sqlite-card-transfer",
    actor: request.actor,
  });

export const encodeCardProjectTransferIntentSemanticInput = (
  intent: CardProjectTransferIntent,
): string => {
  const parsed = parseCardProjectTransferIntent(intent);
  return stableStringifyBlockPropertyJson({
    version: parsed.version,
    operationId: parsed.operationId,
    sourceProjectId: parsed.sourceProjectId,
    targetProjectId: parsed.targetProjectId,
    cardId: parsed.cardId,
    target: parsed.target,
  });
};

export const cardProjectTransferIntentsEqual = (
  left: CardProjectTransferIntent,
  right: CardProjectTransferIntent,
): boolean =>
  encodeCardProjectTransferIntentSemanticInput(left) ===
  encodeCardProjectTransferIntentSemanticInput(right);

export const parseCardProjectTransferRequest = (
  value: unknown,
): CardProjectTransferRequest => {
  const label = "cardProjectTransfer";
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    [
      "version",
      "operationId",
      "storeEpoch",
      "sourceProjectId",
      "targetProjectId",
      "cardId",
      "expectedTopLevelRankKey",
      "expectedBlocks",
      "expectedDocuments",
      "expectedMemberships",
      "target",
      "actor",
    ],
    ["clientSessionId"],
  );
  if (record.version !== CARD_PROJECT_TRANSFER_CONTRACT_VERSION) {
    throw new CardProjectTransferContractError(
      `cardProjectTransfer.version must be ${CARD_PROJECT_TRANSFER_CONTRACT_VERSION}`,
    );
  }
  const expectedBlocks = readSortedArray(
    record.expectedBlocks,
    `${label}.expectedBlocks`,
    parseBlockCoordinate,
    (entry) => entry.blockId,
  );
  const expectedDocuments = readSortedArray(
    record.expectedDocuments,
    `${label}.expectedDocuments`,
    parseDocumentCoordinate,
    (entry) => entry.documentId,
  );
  const expectedMemberships = readSortedArray(
    record.expectedMemberships,
    `${label}.expectedMemberships`,
    parseMembershipCoordinate,
    (entry) => entry.cardBlockId,
  );
  if (expectedBlocks.length === 0 || expectedDocuments.length === 0) {
    throw new CardProjectTransferContractError(
      "cardProjectTransfer authority closure cannot be empty",
    );
  }
  const request: CardProjectTransferRequest = {
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    operationId: readString(record, "operationId", label),
    storeEpoch: readString(record, "storeEpoch", label),
    sourceProjectId: readString(record, "sourceProjectId", label),
    targetProjectId: readString(record, "targetProjectId", label),
    cardId: readString(record, "cardId", label),
    expectedTopLevelRankKey: readString(
      record,
      "expectedTopLevelRankKey",
      label,
    ),
    expectedBlocks,
    expectedDocuments,
    expectedMemberships,
    target: parseTarget(record.target),
    ...(readOptionalString(record, "clientSessionId", label) === undefined
      ? {}
      : {
          clientSessionId: readOptionalString(
            record,
            "clientSessionId",
            label,
          ),
        }),
    actor: parseActor(record.actor),
  };
  stableStringifyBlockPropertyJson(request);
  return request;
};

const parseRevisionRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, number>> => {
  const record = readRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([key, revision]) => {
      if (!key || key.length > MAX_ID_LENGTH) {
        throw new CardProjectTransferContractError(
          `${label} has an invalid identity`,
        );
      }
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throw new CardProjectTransferContractError(
          `${label}.${key} must be a safe integer >= 1`,
        );
      }
      return [key, revision];
    }),
  );
};

const parseIdentityRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, string>> => {
  const record = readRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([key, identity]) => {
      if (
        !key ||
        key.length > MAX_ID_LENGTH ||
        typeof identity !== "string" ||
        identity.length === 0 ||
        identity.length > MAX_ID_LENGTH
      ) {
        throw new CardProjectTransferContractError(
          `${label} has an invalid identity mapping`,
        );
      }
      return [key, identity];
    }),
  );
};

const parseDocumentHeads = (
  value: unknown,
): CardProjectTransferReceipt["documentHeads"] => {
  const record = readRecord(value, "cardProjectTransferReceipt.documentHeads");
  return Object.fromEntries(
    Object.entries(record).map(([documentId, rawHead]) => {
      const label = `cardProjectTransferReceipt.documentHeads.${documentId}`;
      const head = readRecord(rawHead, label);
      assertExactKeys(head, label, ["generation", "headSeq"]);
      return [
        documentId,
        {
          generation: readRevision(head, "generation", label),
          headSeq: readRevision(head, "headSeq", label),
        },
      ];
    }),
  );
};

const parseIdentityArray = (value: unknown, label: string): readonly string[] =>
  readSortedArray(
    value,
    label,
    (entry) => {
      if (
        typeof entry === "string" &&
        entry.length > 0 &&
        entry.length <= MAX_ID_LENGTH &&
        entry === entry.trim()
      ) {
        return entry;
      }
      throw new CardProjectTransferContractError(
        `${label} contains an invalid identity`,
      );
    },
    (entry) => entry,
  );

export const parseCardProjectTransferReceipt = (
  value: unknown,
): CardProjectTransferReceipt => {
  const label = "cardProjectTransferReceipt";
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "version",
    "operationId",
    "storeEpoch",
    "sourceProjectId",
    "targetProjectId",
    "cardId",
    "duplicate",
    "movedBlockIds",
    "movedDocumentIds",
    "sourceMembershipIds",
    "targetMembershipIds",
    "blockMetadataRevisions",
    "rootLocationRevision",
    "documentHeads",
    "targetDatabaseBlockId",
    "targetDatabaseSchemaRevision",
    "targetViewId",
    "targetStatus",
    "targetTopLevelRankKey",
    "targetViewRankKey",
    "changeLogSeq",
    "committedAt",
  ]);
  if (
    record.version !== CARD_PROJECT_TRANSFER_CONTRACT_VERSION ||
    typeof record.duplicate !== "boolean"
  ) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferReceipt has an invalid version or duplicate flag",
    );
  }
  const committedAt = readString(record, "committedAt", label);
  if (Number.isNaN(new Date(committedAt).getTime())) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferReceipt.committedAt must be a timestamp",
    );
  }
  return {
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    operationId: readString(record, "operationId", label),
    storeEpoch: readString(record, "storeEpoch", label),
    sourceProjectId: readString(record, "sourceProjectId", label),
    targetProjectId: readString(record, "targetProjectId", label),
    cardId: readString(record, "cardId", label),
    duplicate: record.duplicate,
    movedBlockIds: parseIdentityArray(
      record.movedBlockIds,
      `${label}.movedBlockIds`,
    ),
    movedDocumentIds: parseIdentityArray(
      record.movedDocumentIds,
      `${label}.movedDocumentIds`,
    ),
    sourceMembershipIds: parseIdentityArray(
      record.sourceMembershipIds,
      `${label}.sourceMembershipIds`,
    ),
    targetMembershipIds: parseIdentityRecord(
      record.targetMembershipIds,
      `${label}.targetMembershipIds`,
    ),
    blockMetadataRevisions: parseRevisionRecord(
      record.blockMetadataRevisions,
      `${label}.blockMetadataRevisions`,
    ),
    rootLocationRevision: readRevision(
      record,
      "rootLocationRevision",
      label,
    ),
    documentHeads: parseDocumentHeads(record.documentHeads),
    targetDatabaseBlockId: readString(
      record,
      "targetDatabaseBlockId",
      label,
    ),
    targetDatabaseSchemaRevision: readRevision(
      record,
      "targetDatabaseSchemaRevision",
      label,
    ),
    targetViewId: readString(record, "targetViewId", label),
    targetStatus: readStatus(record, "targetStatus", label),
    targetTopLevelRankKey: readString(
      record,
      "targetTopLevelRankKey",
      label,
    ),
    targetViewRankKey: readString(record, "targetViewRankKey", label),
    changeLogSeq: readRevision(record, "changeLogSeq", label),
    committedAt,
  };
};

const ERROR_CODES = new Set<CardProjectTransferErrorCode>([
  "invalid_card_project_transfer_request",
  "store_epoch_mismatch",
  "operation_id_collision",
  "operation_receipt_corrupt",
  "source_project_not_found",
  "target_project_not_found",
  "same_project",
  "card_not_found",
  "card_type_mismatch",
  "card_lifecycle_conflict",
  "card_location_invalid",
  "block_authority_conflict",
  "document_authority_conflict",
  "document_generation_mismatch",
  "document_head_conflict",
  "coordination_failed",
  "membership_authority_conflict",
  "target_database_conflict",
  "target_view_conflict",
  "target_property_schema_invalid",
  "target_property_value_invalid",
  "position_anchor_not_found",
  "position_anchor_group_mismatch",
  "foreign_key_violation",
  "unknown",
]);

export const parseCardProjectTransferCommandResult = (
  value: unknown,
): CardProjectTransferCommandResult => {
  const record = readRecord(value, "cardProjectTransferResult");
  if (record.ok === true) {
    assertExactKeys(record, "cardProjectTransferResult", ["ok", "value"]);
    return { ok: true, value: parseCardProjectTransferReceipt(record.value) };
  }
  if (record.ok !== false) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferResult.ok must be boolean",
    );
  }
  assertExactKeys(record, "cardProjectTransferResult", ["ok", "error"]);
  const error = readRecord(record.error, "cardProjectTransferResult.error");
  assertExactKeys(
    error,
    "cardProjectTransferResult.error",
    ["code", "message", "retryable"],
    ["operationId", "cardId"],
  );
  if (
    typeof error.code !== "string" ||
    !ERROR_CODES.has(error.code as CardProjectTransferErrorCode) ||
    typeof error.message !== "string" ||
    error.message.length === 0 ||
    typeof error.retryable !== "boolean"
  ) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferResult.error is invalid",
    );
  }
  return {
    ok: false,
    error: {
      code: error.code as CardProjectTransferErrorCode,
      message: error.message,
      retryable: error.retryable,
      ...(readOptionalString(
        error,
        "operationId",
        "cardProjectTransferResult.error",
      ) === undefined
        ? {}
        : {
            operationId: readOptionalString(
              error,
              "operationId",
              "cardProjectTransferResult.error",
            ),
          }),
      ...(readOptionalString(
        error,
        "cardId",
        "cardProjectTransferResult.error",
      ) === undefined
        ? {}
        : {
            cardId: readOptionalString(
              error,
              "cardId",
              "cardProjectTransferResult.error",
            ),
          }),
    },
  };
};
