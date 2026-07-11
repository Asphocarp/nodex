import {
  MAX_CARD_DESCRIPTION_LENGTH,
  MAX_CARD_TITLE_LENGTH,
} from "../card-limits";
import type { BlockTreeNode, BlockTreeValue } from "./block-document-codec";
import {
  MAX_BLOCK_ID_LENGTH,
  type BlockId,
  type DocumentId,
} from "./contracts";

export const DOCUMENT_OPERATION_CONTRACT_VERSION = 1;
export const MAX_DOCUMENT_OPERATION_BATCH_SIZE = 512;

const MAX_SCOPE_ID_LENGTH = 512;
const MAX_BLOCK_TYPE_LENGTH = 128;
const MAX_PORTABLE_KEY_LENGTH = 256;
const MAX_PORTABLE_VALUE_DEPTH = 64;
const MAX_OPERATION_REQUEST_UNITS = 2_000_000;

export interface SetDocumentTitleOperation {
  readonly kind: "set_title";
  readonly title: string;
}

export interface InsertDocumentBlockOperation {
  readonly kind: "insert_block";
  readonly block: BlockTreeNode;
  readonly parentBlockId?: BlockId;
  readonly beforeBlockId?: BlockId;
}

export interface DocumentBlockUpdatePatch {
  readonly type?: string;
  readonly props?: Readonly<Record<string, BlockTreeValue>>;
  readonly content?: BlockTreeValue;
  readonly unsetContent?: true;
}

export interface UpdateDocumentBlockOperation {
  readonly kind: "update_block";
  readonly blockId: BlockId;
  readonly patch: DocumentBlockUpdatePatch;
}

export interface DeleteDocumentBlockOperation {
  readonly kind: "delete_block";
  readonly blockId: BlockId;
}

export interface MoveDocumentBlockOperation {
  readonly kind: "move_block";
  readonly blockId: BlockId;
  readonly parentBlockId?: BlockId;
  readonly beforeBlockId?: BlockId;
}

export type DocumentBlockOperation =
  | SetDocumentTitleOperation
  | InsertDocumentBlockOperation
  | UpdateDocumentBlockOperation
  | DeleteDocumentBlockOperation
  | MoveDocumentBlockOperation;

export interface DocumentOperationBatch {
  readonly version: typeof DOCUMENT_OPERATION_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockTreeValue>>;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly operations: readonly DocumentBlockOperation[];
}

export interface ReplaceDocumentFromNfm {
  readonly version: typeof DOCUMENT_OPERATION_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockTreeValue>>;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly nfm: string;
}

export type DocumentMutationRequest =
  | DocumentOperationBatch
  | ReplaceDocumentFromNfm;

export type DocumentMutationKind =
  "document_operation_batch" | "replace_document_from_nfm";

export type DocumentMutationCoordination = "merge_friendly" | "write_fence";

/** Trusted coordinator evidence; never accept it directly from an untrusted transport. */
export interface DocumentWriteFenceProof {
  readonly leaseId: string;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly headSeq: number;
}

export interface DocumentOperationResult {
  readonly version: typeof DOCUMENT_OPERATION_CONTRACT_VERSION;
  readonly mutationKind: DocumentMutationKind;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly touchedBlockIds: readonly BlockId[];
  readonly createdBlockIds: readonly BlockId[];
  readonly deletedBlockIds: readonly BlockId[];
  readonly updatedBlockIds: readonly BlockId[];
  readonly movedBlockIds: readonly BlockId[];
  /** Existing Yjs structs invalidated by this commit; stale edits need recovery. */
  readonly writeFenceBlockIds: readonly BlockId[];
  readonly titleChanged: boolean;
  readonly coordination: DocumentMutationCoordination;
  readonly changeLogSeq: number;
  readonly committedAt: string;
  readonly duplicate: boolean;
}

export type DocumentOperationErrorCode =
  | "invalid_document_operation_request"
  | "store_epoch_mismatch"
  | "mutation_id_collision"
  | "document_not_found"
  | "document_not_ready"
  | "document_generation_conflict"
  | "document_head_conflict"
  | "project_scope_mismatch"
  | "duplicate_block_id"
  | "block_not_found"
  | "invalid_anchor"
  | "ancestor_cycle"
  | "invalid_block"
  | "invalid_operation"
  | "no_change"
  | "write_fence_required"
  | "document_write_lease_timeout"
  | "document_state_corrupt"
  | "unknown";

export interface DocumentOperationCommandError {
  readonly code: DocumentOperationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly mutationId?: string;
  readonly expectedGeneration?: number;
  readonly actualGeneration?: number;
  readonly expectedHeadSeq?: number;
  readonly actualHeadSeq?: number;
  readonly operationIndex?: number;
  readonly blockId?: BlockId;
}

export type DocumentOperationCommandResult =
  | { readonly ok: true; readonly value: DocumentOperationResult }
  | { readonly ok: false; readonly error: DocumentOperationCommandError };

export class DocumentOperationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentOperationContractError";
  }
}

interface ParseBudget {
  remaining: number;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new DocumentOperationContractError(`${label} must be an object`);
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
    throw new DocumentOperationContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new DocumentOperationContractError(
      `${label}.${key} is not supported`,
    );
  }
};

const consumeBudget = (
  budget: ParseBudget,
  units: number,
  label: string,
): void => {
  budget.remaining -= units;
  if (budget.remaining >= 0) return;
  throw new DocumentOperationContractError(
    `${label} exceeds the bounded operation payload budget`,
  );
};

const readBoundedString = (
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
  throw new DocumentOperationContractError(
    `${label}.${key} must be a non-empty bounded string`,
  );
};

const readOptionalBlockId = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): BlockId | undefined => {
  if (record[key] === undefined) return undefined;
  return readBoundedString(record, key, label, MAX_BLOCK_ID_LENGTH);
};

const readInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new DocumentOperationContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readOptionalInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number | undefined => {
  if (record[key] === undefined) return undefined;
  return readInteger(record, key, label, minimum);
};

const clonePortableValue = (
  value: unknown,
  label: string,
  budget: ParseBudget,
  depth = 0,
): BlockTreeValue => {
  if (depth > MAX_PORTABLE_VALUE_DEPTH) {
    throw new DocumentOperationContractError(
      `${label} exceeds the portable value depth limit`,
    );
  }
  consumeBudget(budget, 1, label);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    consumeBudget(budget, value.length, label);
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      clonePortableValue(entry, `${label}[${index}]`, budget, depth + 1),
    );
  }
  if (!isRecord(value)) {
    throw new DocumentOperationContractError(
      `${label} must contain only portable JSON values`,
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        key.length === 0 ||
        key.length > MAX_PORTABLE_KEY_LENGTH ||
        key !== key.trim()
      ) {
        throw new DocumentOperationContractError(
          `${label} contains an invalid object key`,
        );
      }
      consumeBudget(budget, key.length, label);
      return [
        key,
        clonePortableValue(entry, `${label}.${key}`, budget, depth + 1),
      ];
    }),
  );
};

const readProps = (
  value: unknown,
  label: string,
  budget: ParseBudget,
): Readonly<Record<string, BlockTreeValue>> => {
  const cloned = clonePortableValue(value, label, budget);
  if (isRecord(cloned)) {
    return cloned as Readonly<Record<string, BlockTreeValue>>;
  }
  throw new DocumentOperationContractError(`${label} must be an object`);
};

const readBlockTreeNode = (
  value: unknown,
  label: string,
  budget: ParseBudget,
  seenIds: Set<BlockId>,
  depth = 0,
): BlockTreeNode => {
  if (depth > MAX_PORTABLE_VALUE_DEPTH) {
    throw new DocumentOperationContractError(
      `${label} exceeds the Block tree depth limit`,
    );
  }
  const block = readRecord(value, label);
  consumeBudget(budget, 1, label);
  assertExactKeys(
    block,
    label,
    ["id", "type", "props", "children"],
    ["content"],
  );
  const id = readBoundedString(block, "id", label, MAX_BLOCK_ID_LENGTH);
  if (seenIds.has(id)) {
    throw new DocumentOperationContractError(
      `${label} repeats Block identity ${id}`,
    );
  }
  seenIds.add(id);
  const type = readBoundedString(block, "type", label, MAX_BLOCK_TYPE_LENGTH);
  consumeBudget(budget, id.length + type.length, label);
  const children = block.children;
  if (!Array.isArray(children)) {
    throw new DocumentOperationContractError(
      `${label}.children must be an array`,
    );
  }
  const content = Object.hasOwn(block, "content")
    ? clonePortableValue(block.content, `${label}.content`, budget)
    : undefined;
  return {
    id,
    type,
    props: readProps(block.props, `${label}.props`, budget),
    ...(content === undefined ? {} : { content }),
    children: children.map((child, index) =>
      readBlockTreeNode(
        child,
        `${label}.children[${index}]`,
        budget,
        seenIds,
        depth + 1,
      ),
    ),
  };
};

const readUpdatePatch = (
  value: unknown,
  label: string,
  budget: ParseBudget,
): DocumentBlockUpdatePatch => {
  const patch = readRecord(value, label);
  assertExactKeys(
    patch,
    label,
    [],
    ["type", "props", "content", "unsetContent"],
  );
  if (Object.keys(patch).length === 0) {
    throw new DocumentOperationContractError(
      `${label} must change at least one field`,
    );
  }
  const type =
    patch.type === undefined
      ? undefined
      : readBoundedString(patch, "type", label, MAX_BLOCK_TYPE_LENGTH);
  const props =
    patch.props === undefined
      ? undefined
      : readProps(patch.props, `${label}.props`, budget);
  const content = Object.hasOwn(patch, "content")
    ? clonePortableValue(patch.content, `${label}.content`, budget)
    : undefined;
  if (patch.unsetContent !== undefined && patch.unsetContent !== true) {
    throw new DocumentOperationContractError(
      `${label}.unsetContent must be true when provided`,
    );
  }
  if (Object.hasOwn(patch, "content") && patch.unsetContent === true) {
    throw new DocumentOperationContractError(
      `${label} cannot set and unset content together`,
    );
  }
  return {
    ...(type === undefined ? {} : { type }),
    ...(props === undefined ? {} : { props }),
    ...(Object.hasOwn(patch, "content") ? { content: content ?? null } : {}),
    ...(patch.unsetContent === true ? { unsetContent: true as const } : {}),
  };
};

const readOperation = (
  value: unknown,
  index: number,
  budget: ParseBudget,
): DocumentBlockOperation => {
  const label = `documentOperation.operations[${index}]`;
  const operation = readRecord(value, label);
  if (operation.kind === "set_title") {
    assertExactKeys(operation, label, ["kind", "title"]);
    const title = operation.title;
    if (typeof title === "string" && title.length <= MAX_CARD_TITLE_LENGTH) {
      consumeBudget(budget, title.length, `${label}.title`);
      return { kind: "set_title", title };
    }
    throw new DocumentOperationContractError(
      `${label}.title must be at most ${MAX_CARD_TITLE_LENGTH} characters`,
    );
  }
  if (operation.kind === "insert_block") {
    assertExactKeys(
      operation,
      label,
      ["kind", "block"],
      ["parentBlockId", "beforeBlockId"],
    );
    const block = readBlockTreeNode(
      operation.block,
      `${label}.block`,
      budget,
      new Set<BlockId>(),
    );
    const parentBlockId = readOptionalBlockId(
      operation,
      "parentBlockId",
      label,
    );
    const beforeBlockId = readOptionalBlockId(
      operation,
      "beforeBlockId",
      label,
    );
    const insertedIds = new Set<BlockId>();
    const pending = [block];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) break;
      insertedIds.add(current.id);
      pending.push(...current.children);
    }
    if (
      (parentBlockId !== undefined && insertedIds.has(parentBlockId)) ||
      (beforeBlockId !== undefined && insertedIds.has(beforeBlockId))
    ) {
      throw new DocumentOperationContractError(
        `${label} cannot target inside the inserted subtree`,
      );
    }
    return {
      kind: "insert_block",
      block,
      ...(parentBlockId === undefined ? {} : { parentBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  if (operation.kind === "update_block") {
    assertExactKeys(operation, label, ["kind", "blockId", "patch"]);
    return {
      kind: "update_block",
      blockId: readBoundedString(
        operation,
        "blockId",
        label,
        MAX_BLOCK_ID_LENGTH,
      ),
      patch: readUpdatePatch(operation.patch, `${label}.patch`, budget),
    };
  }
  if (operation.kind === "delete_block") {
    assertExactKeys(operation, label, ["kind", "blockId"]);
    return {
      kind: "delete_block",
      blockId: readBoundedString(
        operation,
        "blockId",
        label,
        MAX_BLOCK_ID_LENGTH,
      ),
    };
  }
  if (operation.kind === "move_block") {
    assertExactKeys(
      operation,
      label,
      ["kind", "blockId"],
      ["parentBlockId", "beforeBlockId"],
    );
    const blockId = readBoundedString(
      operation,
      "blockId",
      label,
      MAX_BLOCK_ID_LENGTH,
    );
    const parentBlockId = readOptionalBlockId(
      operation,
      "parentBlockId",
      label,
    );
    const beforeBlockId = readOptionalBlockId(
      operation,
      "beforeBlockId",
      label,
    );
    if (parentBlockId === blockId || beforeBlockId === blockId) {
      throw new DocumentOperationContractError(
        `${label} cannot target the moved Block itself`,
      );
    }
    return {
      kind: "move_block",
      blockId,
      ...(parentBlockId === undefined ? {} : { parentBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  throw new DocumentOperationContractError(`${label}.kind is not supported`);
};

const parseMutationEnvelope = (
  value: unknown,
  label: string,
  extraRequiredKeys: readonly string[],
  budget: ParseBudget,
): {
  readonly record: Readonly<Record<string, unknown>>;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockTreeValue>>;
  readonly documentId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
} => {
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    label,
    [
      "version",
      "mutationId",
      "projectId",
      "storeEpoch",
      "actor",
      "documentId",
      "generation",
      "expectedHeadSeq",
      ...extraRequiredKeys,
    ],
    ["clientSessionId"],
  );
  if (record.version !== DOCUMENT_OPERATION_CONTRACT_VERSION) {
    throw new DocumentOperationContractError(
      `${label}.version must be ${DOCUMENT_OPERATION_CONTRACT_VERSION}`,
    );
  }
  const clientSessionId = readOptionalBlockId(record, "clientSessionId", label);
  return {
    record,
    mutationId: readBoundedString(
      record,
      "mutationId",
      label,
      MAX_SCOPE_ID_LENGTH,
    ),
    projectId: readBoundedString(record, "projectId", label),
    storeEpoch: readBoundedString(record, "storeEpoch", label),
    ...(clientSessionId === undefined ? {} : { clientSessionId }),
    actor: readProps(record.actor, `${label}.actor`, budget),
    documentId: readBoundedString(record, "documentId", label),
    generation: readInteger(record, "generation", label, 1),
    expectedHeadSeq: readInteger(record, "expectedHeadSeq", label, 0),
  };
};

export const parseDocumentOperationBatch = (
  value: unknown,
): DocumentOperationBatch => {
  const budget: ParseBudget = { remaining: MAX_OPERATION_REQUEST_UNITS };
  const envelope = parseMutationEnvelope(
    value,
    "documentOperation",
    ["operations"],
    budget,
  );
  const operations = envelope.record.operations;
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > MAX_DOCUMENT_OPERATION_BATCH_SIZE
  ) {
    throw new DocumentOperationContractError(
      `documentOperation.operations must contain 1-${MAX_DOCUMENT_OPERATION_BATCH_SIZE} operations`,
    );
  }
  return {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationId: envelope.mutationId,
    projectId: envelope.projectId,
    storeEpoch: envelope.storeEpoch,
    ...(envelope.clientSessionId === undefined
      ? {}
      : { clientSessionId: envelope.clientSessionId }),
    actor: envelope.actor,
    documentId: envelope.documentId,
    generation: envelope.generation,
    expectedHeadSeq: envelope.expectedHeadSeq,
    operations: operations.map((operation, index) =>
      readOperation(operation, index, budget),
    ),
  };
};

export const parseReplaceDocumentFromNfm = (
  value: unknown,
): ReplaceDocumentFromNfm => {
  const budget: ParseBudget = { remaining: MAX_OPERATION_REQUEST_UNITS };
  const envelope = parseMutationEnvelope(
    value,
    "replaceDocumentFromNfm",
    ["nfm"],
    budget,
  );
  const nfm = envelope.record.nfm;
  if (typeof nfm !== "string" || nfm.length > MAX_CARD_DESCRIPTION_LENGTH) {
    throw new DocumentOperationContractError(
      `replaceDocumentFromNfm.nfm must be at most ${MAX_CARD_DESCRIPTION_LENGTH} characters`,
    );
  }
  return {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationId: envelope.mutationId,
    projectId: envelope.projectId,
    storeEpoch: envelope.storeEpoch,
    ...(envelope.clientSessionId === undefined
      ? {}
      : { clientSessionId: envelope.clientSessionId }),
    actor: envelope.actor,
    documentId: envelope.documentId,
    generation: envelope.generation,
    expectedHeadSeq: envelope.expectedHeadSeq,
    nfm,
  };
};

const readTouchedBlockIds = (
  value: unknown,
  label: string,
): readonly BlockId[] => {
  if (!Array.isArray(value)) {
    throw new DocumentOperationContractError(`${label} must be an array`);
  }
  const ids = value.map((entry, index) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_BLOCK_ID_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new DocumentOperationContractError(
      `${label}[${index}] must be a canonical Block identity`,
    );
  });
  if (new Set(ids).size === ids.length) return ids;
  throw new DocumentOperationContractError(`${label} contains duplicate IDs`);
};

export const parseDocumentOperationResult = (
  value: unknown,
): DocumentOperationResult => {
  const label = "documentOperationResult";
  const result = readRecord(value, label);
  assertExactKeys(result, label, [
    "version",
    "mutationKind",
    "mutationId",
    "projectId",
    "storeEpoch",
    "documentId",
    "generation",
    "baseHeadSeq",
    "headSeq",
    "touchedBlockIds",
    "createdBlockIds",
    "deletedBlockIds",
    "updatedBlockIds",
    "movedBlockIds",
    "writeFenceBlockIds",
    "titleChanged",
    "coordination",
    "changeLogSeq",
    "committedAt",
    "duplicate",
  ]);
  if (result.version !== DOCUMENT_OPERATION_CONTRACT_VERSION) {
    throw new DocumentOperationContractError(
      `${label}.version must be ${DOCUMENT_OPERATION_CONTRACT_VERSION}`,
    );
  }
  if (
    result.mutationKind !== "document_operation_batch" &&
    result.mutationKind !== "replace_document_from_nfm"
  ) {
    throw new DocumentOperationContractError(
      `${label}.mutationKind is not supported`,
    );
  }
  if (typeof result.duplicate !== "boolean") {
    throw new DocumentOperationContractError(
      `${label}.duplicate must be a boolean`,
    );
  }
  if (typeof result.titleChanged !== "boolean") {
    throw new DocumentOperationContractError(
      `${label}.titleChanged must be a boolean`,
    );
  }
  if (
    result.coordination !== "merge_friendly" &&
    result.coordination !== "write_fence"
  ) {
    throw new DocumentOperationContractError(
      `${label}.coordination is not supported`,
    );
  }
  if (
    typeof result.committedAt !== "string" ||
    result.committedAt.length === 0
  ) {
    throw new DocumentOperationContractError(
      `${label}.committedAt must be a non-empty string`,
    );
  }
  const generation = readInteger(result, "generation", label, 1);
  const baseHeadSeq = readInteger(result, "baseHeadSeq", label, 0);
  const headSeq = readInteger(result, "headSeq", label, 1);
  if (headSeq !== baseHeadSeq + 1) {
    throw new DocumentOperationContractError(
      `${label}.headSeq must immediately follow baseHeadSeq`,
    );
  }
  return {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationKind: result.mutationKind,
    mutationId: readBoundedString(result, "mutationId", label),
    projectId: readBoundedString(result, "projectId", label),
    storeEpoch: readBoundedString(result, "storeEpoch", label),
    documentId: readBoundedString(result, "documentId", label),
    generation,
    baseHeadSeq,
    headSeq,
    touchedBlockIds: readTouchedBlockIds(
      result.touchedBlockIds,
      `${label}.touchedBlockIds`,
    ),
    createdBlockIds: readTouchedBlockIds(
      result.createdBlockIds,
      `${label}.createdBlockIds`,
    ),
    deletedBlockIds: readTouchedBlockIds(
      result.deletedBlockIds,
      `${label}.deletedBlockIds`,
    ),
    updatedBlockIds: readTouchedBlockIds(
      result.updatedBlockIds,
      `${label}.updatedBlockIds`,
    ),
    movedBlockIds: readTouchedBlockIds(
      result.movedBlockIds,
      `${label}.movedBlockIds`,
    ),
    writeFenceBlockIds: readTouchedBlockIds(
      result.writeFenceBlockIds,
      `${label}.writeFenceBlockIds`,
    ),
    titleChanged: result.titleChanged,
    coordination: result.coordination,
    changeLogSeq: readInteger(result, "changeLogSeq", label, 1),
    committedAt: result.committedAt,
    duplicate: result.duplicate,
  };
};

const DOCUMENT_OPERATION_ERROR_CODES: readonly DocumentOperationErrorCode[] = [
  "invalid_document_operation_request",
  "store_epoch_mismatch",
  "mutation_id_collision",
  "document_not_found",
  "document_not_ready",
  "document_generation_conflict",
  "document_head_conflict",
  "project_scope_mismatch",
  "duplicate_block_id",
  "block_not_found",
  "invalid_anchor",
  "ancestor_cycle",
  "invalid_block",
  "invalid_operation",
  "no_change",
  "write_fence_required",
  "document_write_lease_timeout",
  "document_state_corrupt",
  "unknown",
];

export const parseDocumentOperationCommandError = (
  value: unknown,
): DocumentOperationCommandError => {
  const label = "documentOperationError";
  const error = readRecord(value, label);
  assertExactKeys(
    error,
    label,
    ["code", "message", "retryable"],
    [
      "mutationId",
      "expectedGeneration",
      "actualGeneration",
      "expectedHeadSeq",
      "actualHeadSeq",
      "operationIndex",
      "blockId",
    ],
  );
  if (
    typeof error.code !== "string" ||
    !DOCUMENT_OPERATION_ERROR_CODES.includes(
      error.code as DocumentOperationErrorCode,
    )
  ) {
    throw new DocumentOperationContractError(`${label}.code is not supported`);
  }
  if (typeof error.retryable !== "boolean") {
    throw new DocumentOperationContractError(
      `${label}.retryable must be a boolean`,
    );
  }
  const mutationId =
    error.mutationId === undefined
      ? undefined
      : readBoundedString(error, "mutationId", label);
  const blockId = readOptionalBlockId(error, "blockId", label);
  const expectedGeneration = readOptionalInteger(
    error,
    "expectedGeneration",
    label,
    1,
  );
  const actualGeneration = readOptionalInteger(
    error,
    "actualGeneration",
    label,
    1,
  );
  const expectedHeadSeq = readOptionalInteger(
    error,
    "expectedHeadSeq",
    label,
    0,
  );
  const actualHeadSeq = readOptionalInteger(error, "actualHeadSeq", label, 0);
  const operationIndex = readOptionalInteger(error, "operationIndex", label, 0);
  if (
    error.code === "document_generation_conflict" &&
    (expectedGeneration === undefined || actualGeneration === undefined)
  ) {
    throw new DocumentOperationContractError(
      `${label} generation conflicts require expected and actual generations`,
    );
  }
  if (
    error.code === "document_head_conflict" &&
    (expectedHeadSeq === undefined || actualHeadSeq === undefined)
  ) {
    throw new DocumentOperationContractError(
      `${label} head conflicts require expected and actual heads`,
    );
  }
  return {
    code: error.code as DocumentOperationErrorCode,
    message: readBoundedString(error, "message", label, 4_096),
    retryable: error.retryable,
    ...(mutationId === undefined ? {} : { mutationId }),
    ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
    ...(actualGeneration === undefined ? {} : { actualGeneration }),
    ...(expectedHeadSeq === undefined ? {} : { expectedHeadSeq }),
    ...(actualHeadSeq === undefined ? {} : { actualHeadSeq }),
    ...(operationIndex === undefined ? {} : { operationIndex }),
    ...(blockId === undefined ? {} : { blockId }),
  };
};

export const parseDocumentOperationCommandResult = (
  value: unknown,
): DocumentOperationCommandResult => {
  const label = "documentOperationCommandResult";
  const result = readRecord(value, label);
  if (result.ok === true) {
    assertExactKeys(result, label, ["ok", "value"]);
    return { ok: true, value: parseDocumentOperationResult(result.value) };
  }
  if (result.ok === false) {
    assertExactKeys(result, label, ["ok", "error"]);
    return {
      ok: false,
      error: parseDocumentOperationCommandError(result.error),
    };
  }
  throw new DocumentOperationContractError(`${label}.ok must be a boolean`);
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const canonicalizeDocumentOperationBatch = (value: unknown): string =>
  stableStringify(parseDocumentOperationBatch(value));

export const canonicalizeReplaceDocumentFromNfm = (value: unknown): string =>
  stableStringify(parseReplaceDocumentFromNfm(value));

const withoutMutationAuditIdentity = <
  T extends { readonly actor: unknown; readonly clientSessionId?: string },
>(
  value: T,
): Omit<T, "actor" | "clientSessionId"> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "actor" && key !== "clientSessionId",
    ),
  ) as Omit<T, "actor" | "clientSessionId">;

/**
 * Canonical logical intent used by durable idempotency receipts.
 *
 * Host-bound actor/session data is first-attempt audit evidence, not command
 * semantics: a caller must be able to repeat the same mutation ID after a
 * window restart or through another trusted transport and recover the original
 * durable outcome.
 */
export const canonicalizeDocumentOperationIntent = (value: unknown): string =>
  stableStringify(withoutMutationAuditIdentity(parseDocumentOperationBatch(value)));

/** See {@link canonicalizeDocumentOperationIntent}. */
export const canonicalizeReplaceDocumentFromNfmIntent = (
  value: unknown,
): string =>
  stableStringify(
    withoutMutationAuditIdentity(parseReplaceDocumentFromNfm(value)),
  );
