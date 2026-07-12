import type { DatabaseJsonValue } from "./database-kernel";
import { stableStringifyDatabaseJson } from "./database-kernel";
import type {
  BlockId,
  BlockLocation,
  DocumentId,
  RelocationDocumentCommit,
} from "./block-documents/contracts";

export const BLOCK_TRANSFER_CONTRACT_VERSION = 1 as const;
export const MAX_BLOCK_TRANSFER_ROOTS = 10_000;
export const MAX_BLOCK_TRANSFER_ID_LENGTH = 512;

export type BlockTransferMode = "move" | "copy";

export type BlockTransferSource =
  | { readonly kind: "space" }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly generation: number;
      readonly expectedHeadSeq: number;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: BlockId;
      readonly memberships: Readonly<
        Record<
          BlockId,
          { readonly membershipId: string; readonly revision: number }
        >
      >;
    };

export type BlockTransferTarget =
  | {
      readonly kind: "space";
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly generation: number;
      readonly expectedHeadSeq: number;
      readonly parentBlockId?: BlockId;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: BlockId;
      readonly viewId: string;
      readonly groupKey: string | null;
      readonly beforeCardBlockId?: BlockId;
    };

export interface BlockTransferRequest {
  readonly version: typeof BLOCK_TRANSFER_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  readonly mode: BlockTransferMode;
  readonly rootBlockIds: readonly BlockId[];
  readonly expectedLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly source: BlockTransferSource;
  readonly target: BlockTransferTarget;
}

export interface BlockTransferReceipt {
  readonly version: typeof BLOCK_TRANSFER_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly mode: BlockTransferMode;
  readonly duplicate: boolean;
  readonly sourceRootBlockIds: readonly BlockId[];
  readonly resultRootBlockIds: readonly BlockId[];
  readonly copiedBlockIds: Readonly<Record<BlockId, BlockId>>;
  readonly finalLocations: Readonly<Record<BlockId, BlockLocation>>;
  readonly finalLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly BlockId[];
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type BlockTransferErrorCode =
  | "invalid_transfer_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "project_not_found"
  | "block_not_found"
  | "block_not_active"
  | "source_parent_mismatch"
  | "location_revision_mismatch"
  | "source_head_mismatch"
  | "target_head_mismatch"
  | "membership_revision_mismatch"
  | "target_not_found"
  | "invalid_target"
  | "transfer_cycle"
  | "unsupported_transfer"
  | "recovery_required"
  | "unknown";

export interface BlockTransferCommandError {
  readonly code: BlockTransferErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly reloadRequired: boolean;
  readonly operationId?: string;
}

export type BlockTransferCommandResult =
  | { readonly ok: true; readonly value: BlockTransferReceipt }
  | { readonly ok: false; readonly error: BlockTransferCommandError };

export class BlockTransferContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockTransferContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new BlockTransferContractError(`${label} must be an object`);
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const requiredKeys = new Set(required);
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of requiredKeys) {
    if (Object.hasOwn(record, key)) continue;
    throw new BlockTransferContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowedKeys.has(key)) continue;
    throw new BlockTransferContractError(`${label}.${key} is not supported`);
  }
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_BLOCK_TRANSFER_ID_LENGTH,
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
  throw new BlockTransferContractError(
    `${label}.${key} must be a non-empty bounded string`,
  );
};

const readOptionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | undefined =>
  record[key] === undefined ? undefined : readString(record, key, label);

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
  throw new BlockTransferContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readRootBlockIds = (
  record: Readonly<Record<string, unknown>>,
): readonly BlockId[] => {
  const value = record.rootBlockIds;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_BLOCK_TRANSFER_ROOTS
  ) {
    throw new BlockTransferContractError(
      `blockTransfer.rootBlockIds must contain 1-${MAX_BLOCK_TRANSFER_ROOTS} IDs`,
    );
  }
  const ids = value.map((entry) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_BLOCK_TRANSFER_ID_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new BlockTransferContractError(
      "blockTransfer.rootBlockIds contains an invalid ID",
    );
  });
  if (new Set(ids).size === ids.length) return ids;
  throw new BlockTransferContractError(
    "blockTransfer.rootBlockIds contains a duplicate ID",
  );
};

const readExpectedLocationRevisions = (
  record: Readonly<Record<string, unknown>>,
  rootBlockIds: readonly BlockId[],
): Readonly<Record<BlockId, number>> => {
  const revisions = readRecord(
    record.expectedLocationRevisions,
    "blockTransfer.expectedLocationRevisions",
  );
  const roots = new Set(rootBlockIds);
  if (
    Object.keys(revisions).length !== roots.size ||
    Object.keys(revisions).some((blockId) => !roots.has(blockId))
  ) {
    throw new BlockTransferContractError(
      "blockTransfer.expectedLocationRevisions must match rootBlockIds exactly",
    );
  }
  return Object.fromEntries(
    rootBlockIds.map((blockId) => {
      const revision = revisions[blockId];
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throw new BlockTransferContractError(
          `blockTransfer.expectedLocationRevisions.${blockId} must be a positive safe integer`,
        );
      }
      return [blockId, revision];
    }),
  );
};

const parseSource = (
  value: unknown,
  rootBlockIds: readonly BlockId[],
): BlockTransferSource => {
  const source = readRecord(value, "blockTransfer.source");
  if (source.kind === "space") {
    assertExactKeys(source, "blockTransfer.source", ["kind"]);
    return { kind: "space" };
  }
  if (source.kind === "document") {
    assertExactKeys(source, "blockTransfer.source", [
      "kind",
      "documentId",
      "generation",
      "expectedHeadSeq",
    ]);
    return {
      kind: "document",
      documentId: readString(source, "documentId", "blockTransfer.source"),
      generation: readInteger(source, "generation", "blockTransfer.source", 1),
      expectedHeadSeq: readInteger(
        source,
        "expectedHeadSeq",
        "blockTransfer.source",
        0,
      ),
    };
  }
  if (source.kind === "database") {
    assertExactKeys(source, "blockTransfer.source", [
      "kind",
      "databaseBlockId",
      "memberships",
    ]);
    const memberships = readRecord(
      source.memberships,
      "blockTransfer.source.memberships",
    );
    if (
      Object.keys(memberships).length !== rootBlockIds.length ||
      Object.keys(memberships).some(
        (blockId) => !rootBlockIds.includes(blockId),
      )
    ) {
      throw new BlockTransferContractError(
        "blockTransfer.source.memberships must match rootBlockIds exactly",
      );
    }
    return {
      kind: "database",
      databaseBlockId: readString(
        source,
        "databaseBlockId",
        "blockTransfer.source",
      ),
      memberships: Object.fromEntries(
        rootBlockIds.map((blockId) => {
          const membership = readRecord(
            memberships[blockId],
            `blockTransfer.source.memberships.${blockId}`,
          );
          assertExactKeys(
            membership,
            `blockTransfer.source.memberships.${blockId}`,
            ["membershipId", "revision"],
          );
          return [
            blockId,
            {
              membershipId: readString(
                membership,
                "membershipId",
                `blockTransfer.source.memberships.${blockId}`,
              ),
              revision: readInteger(
                membership,
                "revision",
                `blockTransfer.source.memberships.${blockId}`,
                1,
              ),
            },
          ];
        }),
      ),
    };
  }
  throw new BlockTransferContractError(
    "blockTransfer.source.kind must be space, document, or database",
  );
};

const parseTarget = (
  value: unknown,
  rootBlockIds: readonly BlockId[],
): BlockTransferTarget => {
  const target = readRecord(value, "blockTransfer.target");
  if (target.kind === "space") {
    assertExactKeys(
      target,
      "blockTransfer.target",
      ["kind"],
      ["beforeBlockId"],
    );
    const beforeBlockId = readOptionalString(
      target,
      "beforeBlockId",
      "blockTransfer.target",
    );
    if (beforeBlockId && rootBlockIds.includes(beforeBlockId)) {
      throw new BlockTransferContractError(
        "blockTransfer.target.beforeBlockId cannot be a transferred root",
      );
    }
    return {
      kind: "space",
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "document") {
    assertExactKeys(
      target,
      "blockTransfer.target",
      ["kind", "documentId", "generation", "expectedHeadSeq"],
      ["parentBlockId", "beforeBlockId"],
    );
    const parentBlockId = readOptionalString(
      target,
      "parentBlockId",
      "blockTransfer.target",
    );
    const beforeBlockId = readOptionalString(
      target,
      "beforeBlockId",
      "blockTransfer.target",
    );
    if (
      (parentBlockId && rootBlockIds.includes(parentBlockId)) ||
      (beforeBlockId && rootBlockIds.includes(beforeBlockId))
    ) {
      throw new BlockTransferContractError(
        "blockTransfer Document anchors cannot be transferred roots",
      );
    }
    return {
      kind: "document",
      documentId: readString(target, "documentId", "blockTransfer.target"),
      generation: readInteger(target, "generation", "blockTransfer.target", 1),
      expectedHeadSeq: readInteger(
        target,
        "expectedHeadSeq",
        "blockTransfer.target",
        0,
      ),
      ...(parentBlockId ? { parentBlockId } : {}),
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "database") {
    assertExactKeys(
      target,
      "blockTransfer.target",
      ["kind", "databaseBlockId", "viewId", "groupKey"],
      ["beforeCardBlockId"],
    );
    const groupKey = target.groupKey;
    if (groupKey !== null && typeof groupKey !== "string") {
      throw new BlockTransferContractError(
        "blockTransfer.target.groupKey must be a string or null",
      );
    }
    const beforeCardBlockId = readOptionalString(
      target,
      "beforeCardBlockId",
      "blockTransfer.target",
    );
    if (beforeCardBlockId && rootBlockIds.includes(beforeCardBlockId)) {
      throw new BlockTransferContractError(
        "blockTransfer.target.beforeCardBlockId cannot be a transferred root",
      );
    }
    return {
      kind: "database",
      databaseBlockId: readString(
        target,
        "databaseBlockId",
        "blockTransfer.target",
      ),
      viewId: readString(target, "viewId", "blockTransfer.target"),
      groupKey,
      ...(beforeCardBlockId ? { beforeCardBlockId } : {}),
    };
  }
  throw new BlockTransferContractError(
    "blockTransfer.target.kind must be space, document, or database",
  );
};

const readActor = (
  value: unknown,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const actor = readRecord(value, "blockTransfer.actor");
  try {
    return JSON.parse(stableStringifyDatabaseJson(actor)) as Readonly<
      Record<string, DatabaseJsonValue>
    >;
  } catch (error) {
    throw new BlockTransferContractError(
      `blockTransfer.actor must be bounded JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const parseBlockTransferRequest = (
  value: unknown,
): BlockTransferRequest => {
  const request = readRecord(value, "blockTransfer");
  assertExactKeys(
    request,
    "blockTransfer",
    [
      "version",
      "operationId",
      "projectId",
      "storeEpoch",
      "actor",
      "mode",
      "rootBlockIds",
      "expectedLocationRevisions",
      "source",
      "target",
    ],
    ["clientSessionId"],
  );
  if (request.version !== BLOCK_TRANSFER_CONTRACT_VERSION) {
    throw new BlockTransferContractError(
      `blockTransfer.version must be ${BLOCK_TRANSFER_CONTRACT_VERSION}`,
    );
  }
  if (request.mode !== "move" && request.mode !== "copy") {
    throw new BlockTransferContractError(
      "blockTransfer.mode must be move or copy",
    );
  }
  const rootBlockIds = readRootBlockIds(request);
  const source = parseSource(request.source, rootBlockIds);
  const target = parseTarget(request.target, rootBlockIds);
  if (
    source.kind === "document" &&
    target.kind === "document" &&
    source.documentId === target.documentId
  ) {
    throw new BlockTransferContractError(
      "BlockTransfer is for parent changes; reorder within one Document uses a Yjs transaction",
    );
  }
  if (
    source.kind === "database" &&
    target.kind === "database" &&
    source.databaseBlockId === target.databaseBlockId
  ) {
    throw new BlockTransferContractError(
      "BlockTransfer is for parent changes; reorder within one Database uses a View position operation",
    );
  }
  if (source.kind === "space" && target.kind === "space") {
    throw new BlockTransferContractError(
      "BlockTransfer is for parent changes; reorder within a Space uses a top-level position operation",
    );
  }
  return {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: readString(request, "operationId", "blockTransfer"),
    projectId: readString(request, "projectId", "blockTransfer"),
    storeEpoch: readString(request, "storeEpoch", "blockTransfer"),
    ...(request.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readString(
            request,
            "clientSessionId",
            "blockTransfer",
          ),
        }),
    actor: readActor(request.actor),
    mode: request.mode,
    rootBlockIds,
    expectedLocationRevisions: readExpectedLocationRevisions(
      request,
      rootBlockIds,
    ),
    source,
    target,
  };
};

/** Canonical semantic identity. Transport/session attempt identity is excluded. */
export const canonicalizeBlockTransferIntent = (value: unknown): string => {
  const request = parseBlockTransferRequest(value);
  return stableStringifyDatabaseJson({
    version: request.version,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    actor: request.actor,
    mode: request.mode,
    rootBlockIds: request.rootBlockIds,
    expectedLocationRevisions: request.expectedLocationRevisions,
    source: request.source,
    target: request.target,
  });
};
