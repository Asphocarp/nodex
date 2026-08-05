import type { DatabaseJsonValue } from "./database-kernel";
import { stableStringifyDatabaseJson } from "./database-kernel";
import type {
  BlockId,
  BlockLocation,
  DocumentId,
  DocumentCommitRef,
} from "./block-documents/contracts";

/** Exact writer request/receipt protocol. */
export const BLOCK_TRANSFER_CONTRACT_VERSION = 1 as const;
/** Public logical parent protocol compiled by the SQLite writer. */
export const BLOCK_TRANSFER_INTENT_CONTRACT_VERSION = 2 as const;
export const MAX_BLOCK_TRANSFER_ROOTS = 10_000;
export const MAX_BLOCK_TRANSFER_ID_LENGTH = 512;

export type BlockTransferMode = "move" | "copy";

export type BlockTransferIntentSource =
  | { readonly kind: "library"; readonly libraryId: string }
  | { readonly kind: "page"; readonly pageId: BlockId }
  | { readonly kind: "document"; readonly documentId: DocumentId }
  | { readonly kind: "data_source"; readonly dataSourceId: string };

export type BlockTransferIntentTarget =
  | {
      readonly kind: "library";
      readonly libraryId: string;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "page";
      readonly pageId: BlockId;
      readonly parentBlockId?: BlockId;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly parentBlockId?: BlockId;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "data_source";
      readonly dataSourceId: string;
      readonly viewId: string;
      readonly groupKey: string | null;
      readonly beforePageId?: BlockId;
    };

/**
 * Public logical command. Freshness coordinates are deliberately absent:
 * only the SQLite writer may compile those from current authority.
 */
export interface BlockTransferIntent {
  readonly version: typeof BLOCK_TRANSFER_INTENT_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  readonly mode: BlockTransferMode;
  readonly rootBlockIds: readonly BlockId[];
  readonly source: BlockTransferIntentSource;
  readonly target: BlockTransferIntentTarget;
}

export interface BlockTransferDocumentHead {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly expectedHeadSeq: number;
}

export interface BlockTransferPreparation {
  readonly request: BlockTransferRequest;
  readonly documentHeads: readonly BlockTransferDocumentHead[];
}

export type BlockTransferSource =
  | { readonly kind: "space"; readonly libraryId?: string }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly pageId?: BlockId;
      readonly generation: number;
      readonly expectedHeadSeq: number;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: BlockId;
      readonly dataSourceId?: string;
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
      readonly libraryId?: string;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly pageId?: BlockId;
      readonly generation: number;
      readonly expectedHeadSeq: number;
      readonly parentBlockId?: BlockId;
      readonly beforeBlockId?: BlockId;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: BlockId;
      readonly dataSourceId?: string;
      readonly viewId: string;
      readonly groupKey: string | null;
      readonly beforePageId?: BlockId;
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

export interface BlockTransferTransformationEvidence {
  readonly sourceBlockId: BlockId;
  readonly resultPageId: BlockId;
  readonly kind: "promote" | "wrap";
  readonly sourceBlockType: string;
  readonly semanticTitleHash: string;
  readonly consumedPropertyKeys: readonly string[];
  readonly wrapperReason?:
    | "type_requires_wrapper"
    | "unsupported_primary_content"
    | "unmapped_type_state";
  readonly bodyRootBlockIds: readonly BlockId[];
  readonly sourceToResultBlockIds: Readonly<Record<BlockId, BlockId>>;
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
  readonly transformationEvidence: readonly BlockTransferTransformationEvidence[];
  readonly finalLocations: Readonly<Record<BlockId, BlockLocation>>;
  readonly finalLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly documentCommits: readonly DocumentCommitRef[];
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

export type BlockTransferCommandResult<Value = BlockTransferReceipt> =
  | { readonly ok: true; readonly value: Value }
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
    assertExactKeys(source, "blockTransfer.source", ["kind"], ["libraryId"]);
    return {
      kind: "space",
      ...(source.libraryId === undefined
        ? {}
        : {
            libraryId: readString(
              source,
              "libraryId",
              "blockTransfer.source",
            ),
          }),
    };
  }
  if (source.kind === "document") {
    assertExactKeys(
      source,
      "blockTransfer.source",
      ["kind", "documentId", "generation", "expectedHeadSeq"],
      ["pageId"],
    );
    return {
      kind: "document",
      documentId: readString(source, "documentId", "blockTransfer.source"),
      ...(source.pageId === undefined
        ? {}
        : { pageId: readString(source, "pageId", "blockTransfer.source") }),
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
    assertExactKeys(
      source,
      "blockTransfer.source",
      ["kind", "databaseBlockId", "memberships"],
      ["dataSourceId"],
    );
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
      ...(source.dataSourceId === undefined
        ? {}
        : {
            dataSourceId: readString(
              source,
              "dataSourceId",
              "blockTransfer.source",
            ),
          }),
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
      ["libraryId", "beforeBlockId"],
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
      ...(target.libraryId === undefined
        ? {}
        : {
            libraryId: readString(
              target,
              "libraryId",
              "blockTransfer.target",
            ),
          }),
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "document") {
    assertExactKeys(
      target,
      "blockTransfer.target",
      ["kind", "documentId", "generation", "expectedHeadSeq"],
      ["pageId", "parentBlockId", "beforeBlockId"],
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
      ...(target.pageId === undefined
        ? {}
        : { pageId: readString(target, "pageId", "blockTransfer.target") }),
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
      ["dataSourceId", "beforePageId"],
    );
    const groupKey = target.groupKey;
    if (groupKey !== null && typeof groupKey !== "string") {
      throw new BlockTransferContractError(
        "blockTransfer.target.groupKey must be a string or null",
      );
    }
    const beforePageId = readOptionalString(
      target,
      "beforePageId",
      "blockTransfer.target",
    );
    if (beforePageId && rootBlockIds.includes(beforePageId)) {
      throw new BlockTransferContractError(
        "blockTransfer.target.beforePageId cannot be a transferred root",
      );
    }
    return {
      kind: "database",
      databaseBlockId: readString(
        target,
        "databaseBlockId",
        "blockTransfer.target",
      ),
      ...(target.dataSourceId === undefined
        ? {}
        : {
            dataSourceId: readString(
              target,
              "dataSourceId",
              "blockTransfer.target",
            ),
          }),
      viewId: readString(target, "viewId", "blockTransfer.target"),
      groupKey,
      ...(beforePageId ? { beforePageId } : {}),
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

const parseIntentSource = (value: unknown): BlockTransferIntentSource => {
  const source = readRecord(value, "blockTransferIntent.source");
  if (source.kind === "library") {
    assertExactKeys(source, "blockTransferIntent.source", [
      "kind",
      "libraryId",
    ]);
    return {
      kind: "library",
      libraryId: readString(
        source,
        "libraryId",
        "blockTransferIntent.source",
      ),
    };
  }
  if (source.kind === "page") {
    assertExactKeys(source, "blockTransferIntent.source", ["kind", "pageId"]);
    return {
      kind: "page",
      pageId: readString(source, "pageId", "blockTransferIntent.source"),
    };
  }
  if (source.kind === "document") {
    assertExactKeys(source, "blockTransferIntent.source", ["kind", "documentId"]);
    return {
      kind: "document",
      documentId: readString(source, "documentId", "blockTransferIntent.source"),
    };
  }
  if (source.kind === "data_source") {
    assertExactKeys(source, "blockTransferIntent.source", [
      "kind",
      "dataSourceId",
    ]);
    return {
      kind: "data_source",
      dataSourceId: readString(
        source,
        "dataSourceId",
        "blockTransferIntent.source",
      ),
    };
  }
  throw new BlockTransferContractError(
    "blockTransferIntent.source.kind must be library, page, document, or data_source",
  );
};

const parseIntentTarget = (
  value: unknown,
  rootBlockIds: readonly BlockId[],
): BlockTransferIntentTarget => {
  const target = readRecord(value, "blockTransferIntent.target");
  if (target.kind === "library") {
    assertExactKeys(
      target,
      "blockTransferIntent.target",
      ["kind", "libraryId"],
      ["beforeBlockId"],
    );
    const beforeBlockId = readOptionalString(
      target,
      "beforeBlockId",
      "blockTransferIntent.target",
    );
    if (beforeBlockId && rootBlockIds.includes(beforeBlockId)) {
      throw new BlockTransferContractError(
        "blockTransferIntent.target.beforeBlockId cannot be a transferred root",
      );
    }
    return {
      kind: "library",
      libraryId: readString(
        target,
        "libraryId",
        "blockTransferIntent.target",
      ),
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "page") {
    assertExactKeys(
      target,
      "blockTransferIntent.target",
      ["kind", "pageId"],
      ["parentBlockId", "beforeBlockId"],
    );
    const parentBlockId = readOptionalString(
      target,
      "parentBlockId",
      "blockTransferIntent.target",
    );
    const beforeBlockId = readOptionalString(
      target,
      "beforeBlockId",
      "blockTransferIntent.target",
    );
    if (
      (parentBlockId && rootBlockIds.includes(parentBlockId)) ||
      (beforeBlockId && rootBlockIds.includes(beforeBlockId))
    ) {
      throw new BlockTransferContractError(
        "blockTransferIntent Page anchors cannot be transferred roots",
      );
    }
    return {
      kind: "page",
      pageId: readString(target, "pageId", "blockTransferIntent.target"),
      ...(parentBlockId ? { parentBlockId } : {}),
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "document") {
    assertExactKeys(
      target,
      "blockTransferIntent.target",
      ["kind", "documentId"],
      ["parentBlockId", "beforeBlockId"],
    );
    const parentBlockId = readOptionalString(
      target,
      "parentBlockId",
      "blockTransferIntent.target",
    );
    const beforeBlockId = readOptionalString(
      target,
      "beforeBlockId",
      "blockTransferIntent.target",
    );
    if (
      (parentBlockId && rootBlockIds.includes(parentBlockId)) ||
      (beforeBlockId && rootBlockIds.includes(beforeBlockId))
    ) {
      throw new BlockTransferContractError(
        "blockTransferIntent Document anchors cannot be transferred roots",
      );
    }
    return {
      kind: "document",
      documentId: readString(
        target,
        "documentId",
        "blockTransferIntent.target",
      ),
      ...(parentBlockId ? { parentBlockId } : {}),
      ...(beforeBlockId ? { beforeBlockId } : {}),
    };
  }
  if (target.kind === "data_source") {
    assertExactKeys(
      target,
      "blockTransferIntent.target",
      ["kind", "dataSourceId", "viewId", "groupKey"],
      ["beforePageId"],
    );
    if (target.groupKey !== null && typeof target.groupKey !== "string") {
      throw new BlockTransferContractError(
        "blockTransferIntent.target.groupKey must be a string or null",
      );
    }
    const beforePageId = readOptionalString(
      target,
      "beforePageId",
      "blockTransferIntent.target",
    );
    if (beforePageId && rootBlockIds.includes(beforePageId)) {
      throw new BlockTransferContractError(
        "blockTransferIntent.target.beforePageId cannot be a transferred root",
      );
    }
    return {
      kind: "data_source",
      dataSourceId: readString(
        target,
        "dataSourceId",
        "blockTransferIntent.target",
      ),
      viewId: readString(target, "viewId", "blockTransferIntent.target"),
      groupKey: target.groupKey,
      ...(beforePageId ? { beforePageId } : {}),
    };
  }
  throw new BlockTransferContractError(
    "blockTransferIntent.target.kind must be library, page, document, or data_source",
  );
};

const assertParentChange = (
  mode: BlockTransferMode,
  source: BlockTransferIntentSource | BlockTransferSource,
  target: BlockTransferIntentTarget | BlockTransferTarget,
  label: string,
): void => {
  if (mode !== "move") return;
  if (
    source.kind === "page" &&
    target.kind === "page" &&
    source.pageId === target.pageId
  ) {
    throw new BlockTransferContractError(
      `${label} is for parent changes; reorder within one Page uses a Yjs transaction`,
    );
  }
  if (
    source.kind === "document" &&
    target.kind === "document" &&
    source.documentId === target.documentId
  ) {
    throw new BlockTransferContractError(
      `${label} is for parent changes; reorder within one Document uses a Yjs transaction`,
    );
  }
  if (
    source.kind === "data_source" &&
    target.kind === "data_source" &&
    source.dataSourceId === target.dataSourceId
  ) {
    throw new BlockTransferContractError(
      `${label} is for parent changes; reorder within one Data Source uses a View position operation`,
    );
  }
  if (
    source.kind === "database" &&
    target.kind === "database" &&
    (source.dataSourceId !== undefined && target.dataSourceId !== undefined
      ? source.dataSourceId === target.dataSourceId
      : source.databaseBlockId === target.databaseBlockId)
  ) {
    throw new BlockTransferContractError(
      `${label} is for parent changes; reorder within one Data Source uses a View position operation`,
    );
  }
};

export const parseBlockTransferIntent = (value: unknown): BlockTransferIntent => {
  const intent = readRecord(value, "blockTransferIntent");
  assertExactKeys(
    intent,
    "blockTransferIntent",
    [
      "version",
      "operationId",
      "projectId",
      "storeEpoch",
      "actor",
      "mode",
      "rootBlockIds",
      "source",
      "target",
    ],
    ["clientSessionId"],
  );
  if (intent.version !== BLOCK_TRANSFER_INTENT_CONTRACT_VERSION) {
    throw new BlockTransferContractError(
      `blockTransferIntent.version must be ${BLOCK_TRANSFER_INTENT_CONTRACT_VERSION}`,
    );
  }
  if (intent.mode !== "move" && intent.mode !== "copy") {
    throw new BlockTransferContractError(
      "blockTransferIntent.mode must be move or copy",
    );
  }
  const rootBlockIds = readRootBlockIds(intent);
  const source = parseIntentSource(intent.source);
  const target = parseIntentTarget(intent.target, rootBlockIds);
  assertParentChange(intent.mode, source, target, "BlockTransfer");
  return {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: readString(intent, "operationId", "blockTransferIntent"),
    projectId: readString(intent, "projectId", "blockTransferIntent"),
    storeEpoch: readString(intent, "storeEpoch", "blockTransferIntent"),
    ...(intent.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readString(
            intent,
            "clientSessionId",
            "blockTransferIntent",
          ),
        }),
    actor: readActor(intent.actor),
    mode: intent.mode,
    rootBlockIds,
    source,
    target,
  };
};

export const blockTransferIntentFromRequest = (
  value: BlockTransferRequest,
): BlockTransferIntent => {
  const request = parseBlockTransferRequest(value);
  const source: BlockTransferIntentSource = (() => {
    if (request.source.kind === "space") {
      if (!request.source.libraryId) {
        throw new BlockTransferContractError(
          "Prepared Library source is missing libraryId",
        );
      }
      return { kind: "library", libraryId: request.source.libraryId };
    }
    if (request.source.kind === "document") {
      return request.source.pageId
        ? { kind: "page", pageId: request.source.pageId }
        : { kind: "document", documentId: request.source.documentId };
    }
    if (!request.source.dataSourceId) {
      throw new BlockTransferContractError(
        "Prepared Data Source source is missing dataSourceId",
      );
    }
    return {
      kind: "data_source",
      dataSourceId: request.source.dataSourceId,
    };
  })();
  const target: BlockTransferIntentTarget = (() => {
    if (request.target.kind === "space") {
      if (!request.target.libraryId) {
        throw new BlockTransferContractError(
          "Prepared Library target is missing libraryId",
        );
      }
      return {
        kind: "library",
        libraryId: request.target.libraryId,
        ...(request.target.beforeBlockId
          ? { beforeBlockId: request.target.beforeBlockId }
          : {}),
      };
    }
    if (request.target.kind === "document") {
      const anchors = {
        ...(request.target.parentBlockId
          ? { parentBlockId: request.target.parentBlockId }
          : {}),
        ...(request.target.beforeBlockId
          ? { beforeBlockId: request.target.beforeBlockId }
          : {}),
      };
      return request.target.pageId
        ? { kind: "page", pageId: request.target.pageId, ...anchors }
        : {
            kind: "document",
            documentId: request.target.documentId,
            ...anchors,
          };
    }
    if (!request.target.dataSourceId) {
      throw new BlockTransferContractError(
        "Prepared Data Source target is missing dataSourceId",
      );
    }
    return {
      kind: "data_source",
      dataSourceId: request.target.dataSourceId,
      viewId: request.target.viewId,
      groupKey: request.target.groupKey,
      ...(request.target.beforePageId
        ? { beforePageId: request.target.beforePageId }
        : {}),
    };
  })();
  return {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    ...(request.clientSessionId
      ? { clientSessionId: request.clientSessionId }
      : {}),
    actor: request.actor,
    mode: request.mode,
    rootBlockIds: request.rootBlockIds,
    source,
    target,
  };
};

export const canonicalizeBlockTransferLogicalIntent = (value: unknown): string => {
  const intent = parseBlockTransferIntent(value);
  return stableStringifyDatabaseJson({
    version: intent.version,
    operationId: intent.operationId,
    projectId: intent.projectId,
    storeEpoch: intent.storeEpoch,
    actor: intent.actor,
    mode: intent.mode,
    rootBlockIds: intent.rootBlockIds,
    source: intent.source,
    target: intent.target,
  });
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
  assertParentChange(request.mode, source, target, "BlockTransfer");
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
