import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  LARGE_CODE_BLOCK_TYPE,
  LARGE_CODE_DOCUMENT_SCHEMA_KEY,
  LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
  LARGE_DOCUMENT_BLOCK_TYPE,
  LARGE_DOCUMENT_SCHEMA_KEY,
  LARGE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_REFERENCE_TYPE,
  REUSABLE_TEMPLATE_SOURCE_TYPE,
  createBodyOnlyBlockDocument,
  type AdditionalDocumentBearingMutationResult,
  type CreateExplicitDocumentBearingBlock,
  type CreateReusableTemplateReference,
  type CreateReusableTemplateSource,
  type ExplicitDocumentBearingBlockKind,
  type InstantiateReusableTemplate,
} from "../../shared/block-documents";
import {
  populateBlockDocumentBodyFromBlockTree,
  type BlockTreeNode,
  type BlockTreeValue,
} from "../../shared/block-documents/block-document-codec";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  inspectOwnedBlockDocument,
} from "../../shared/block-documents/document-schema-adapters";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  persistAuthoritativeOperationRejection,
  prepareAuthoritativeOperation,
} from "./authoritative-operation-receipts";
import { getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import {
  BlockDocumentStoreError,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { planDatabaseFractionalRank } from "./database-fractional-rank";

export type AdditionalDocumentBearingBlockErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "store_epoch_mismatch"
  | "identity_conflict"
  | "source_not_found"
  | "source_referenced"
  | "document_head_conflict"
  | "host_document_conflict"
  | "document_state_corrupt";

export class AdditionalDocumentBearingBlockError extends Error {
  constructor(
    readonly code: AdditionalDocumentBearingBlockErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdditionalDocumentBearingBlockError";
  }
}

export type AdditionalDocumentBearingFaultPoint =
  | "after_owner_staged"
  | "after_genesis"
  | "after_host_update"
  | "before_receipt";

export interface AdditionalDocumentBearingMutationOptions {
  readonly faultInjector?: (point: AdditionalDocumentBearingFaultPoint) => void;
}

export interface DocumentBearingBlockSummary {
  readonly projectId: string;
  readonly blockId: string;
  readonly ownerType: string;
  readonly lifecycle: "active" | "archived";
  readonly displayName: string;
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly preview: string;
}

type StoredMutationOutcome =
  | AdditionalDocumentBearingMutationResult
  | {
      readonly code: AdditionalDocumentBearingBlockErrorCode;
      readonly message: string;
    };

const ADDITIONAL_DOCUMENT_BEARING_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "project_not_found",
  "store_epoch_mismatch",
  "identity_conflict",
  "source_not_found",
  "source_referenced",
  "document_head_conflict",
  "host_document_conflict",
  "document_state_corrupt",
]);

const requireIdentity = (value: string, field: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  throw new AdditionalDocumentBearingBlockError(
    "invalid_request",
    `${field} must be a non-empty bounded identity`,
  );
};

const requireHead = (value: number, field: string, minimum: number): number => {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  throw new AdditionalDocumentBearingBlockError(
    "invalid_request",
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const requireBoundedText = (
  value: string,
  field: string,
  maximumLength: number,
  allowEmpty = false,
): string => {
  if (
    typeof value === "string" &&
    value.length <= maximumLength &&
    (allowEmpty || value.trim().length > 0)
  ) {
    return value;
  }
  throw new AdditionalDocumentBearingBlockError(
    "invalid_request",
    `${field} must be ${allowEmpty ? "a" : "a non-empty"} string no longer than ${maximumLength} characters`,
  );
};

const requireVersion = (version: number): void => {
  if (version === ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION) return;
  throw new AdditionalDocumentBearingBlockError(
    "invalid_request",
    `Unsupported additional document-bearing operation version: ${version}`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new AdditionalDocumentBearingBlockError(
    "document_state_corrupt",
    "Block store epoch is missing",
  );
};

const assertStoreEpoch = (
  database: Database.Database,
  expected: string,
): string => {
  const requested = requireIdentity(expected, "storeEpoch");
  const current = readStoreEpoch(database);
  if (requested === current) return current;
  throw new AdditionalDocumentBearingBlockError(
    "store_epoch_mismatch",
    `Operation belongs to store epoch ${requested}; current epoch is ${current}`,
  );
};

const requireProject = (
  database: Database.Database,
  projectId: string,
): string => {
  const requested = requireIdentity(projectId, "projectId");
  const row = database
    .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
    .get(requested) as { readonly present: number } | undefined;
  if (row) return requested;
  throw new AdditionalDocumentBearingBlockError(
    "project_not_found",
    `Project does not exist: ${requested}`,
  );
};

/** Exact-head summary used by collapsed shells; display hints remain disposable. */
export const getDocumentBearingBlockSummary = (
  database: Database.Database,
  projectId: string,
  blockId: string,
): DocumentBearingBlockSummary => {
  const scope = requireProject(database, projectId);
  const ownerId = requireIdentity(blockId, "blockId");
  const row = database
    .prepare(
      `
      SELECT owner.type AS owner_type, owner.lifecycle, property.value_json,
        document.id AS document_id, document.generation, document.head_seq,
        document.schema_key, document.schema_version,
        materialization.projected_seq, materialization.preview
      FROM blocks owner
      INNER JOIN block_documents ownership
        ON ownership.block_id = owner.id
        AND ownership.project_id = owner.project_id
      INNER JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      INNER JOIN document_materializations materialization
        ON materialization.document_id = document.id
      INNER JOIN block_properties property
        ON property.block_id = owner.id
        AND property.project_id = owner.project_id
        AND property.property_key = 'document.display_name'
        AND property.value_type = 'string'
      WHERE owner.id = ? AND owner.project_id = ?
        AND owner.lifecycle IN ('active', 'archived')
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
    `,
    )
    .get(ownerId, scope) as
    | {
        readonly owner_type: string;
        readonly lifecycle: "active" | "archived";
        readonly value_json: string;
        readonly document_id: string;
        readonly generation: number;
        readonly head_seq: number;
        readonly schema_key: string;
        readonly schema_version: number;
        readonly projected_seq: number;
        readonly preview: string;
      }
    | undefined;
  if (!row || row.projected_seq !== row.head_seq) {
    throw new AdditionalDocumentBearingBlockError(
      "source_not_found",
      `Document-bearing Block ${ownerId} has no exact-head summary in Project ${scope}`,
    );
  }
  try {
    getRegisteredBlockDocumentSchemaAdapter({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    throw new AdditionalDocumentBearingBlockError(
      "document_state_corrupt",
      `Document-bearing Block ${ownerId} uses an unregistered owner/schema`,
      { cause: error },
    );
  }
  let displayName: unknown;
  try {
    displayName = JSON.parse(row.value_json);
  } catch {
    displayName = null;
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new AdditionalDocumentBearingBlockError(
      "document_state_corrupt",
      `Document-bearing Block ${ownerId} has an invalid display name`,
    );
  }
  return {
    projectId: scope,
    blockId: ownerId,
    ownerType: row.owner_type,
    lifecycle: row.lifecycle,
    displayName,
    documentId: row.document_id,
    generation: row.generation,
    headSeq: row.head_seq,
    schemaKey: row.schema_key,
    schemaVersion: row.schema_version,
    preview: row.preview,
  };
};

/** Exact-head guard for future Template lifecycle/GC commands. */
export const assertReusableTemplateSourceIsUnreferenced = (
  database: Database.Database,
  projectId: string,
  sourceBlockId: string,
): void => {
  const summary = getDocumentBearingBlockSummary(
    database,
    projectId,
    sourceBlockId,
  );
  if (summary.ownerType !== REUSABLE_TEMPLATE_SOURCE_TYPE) {
    throw new AdditionalDocumentBearingBlockError(
      "source_not_found",
      `Block ${sourceBlockId} is not a Reusable Template source`,
    );
  }
  const rows = database
    .prepare(
      `
      SELECT document.id, document.generation, document.head_seq,
        materialization.generation AS materialized_generation,
        materialization.projected_seq, materialization.references_json
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE document.project_id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
    `,
    )
    .all(projectId) as readonly {
    readonly id: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly materialized_generation: number | null;
    readonly projected_seq: number | null;
    readonly references_json: string | null;
  }[];
  let references = 0;
  for (const row of rows) {
    if (
      row.materialized_generation !== row.generation ||
      row.projected_seq !== row.head_seq ||
      row.references_json === null
    ) {
      throw new AdditionalDocumentBearingBlockError(
        "document_state_corrupt",
        `Cannot prove Template references while Document ${row.id} lacks an exact-head materialization`,
      );
    }
    let stored: unknown;
    try {
      stored = JSON.parse(row.references_json);
    } catch {
      stored = null;
    }
    if (!Array.isArray(stored)) {
      throw new AdditionalDocumentBearingBlockError(
        "document_state_corrupt",
        `Document ${row.id} has invalid reference materialization`,
      );
    }
    for (const reference of stored) {
      if (
        typeof reference === "object" &&
        reference !== null &&
        (reference as { readonly kind?: unknown }).kind === "block" &&
        (reference as { readonly targetBlockId?: unknown }).targetBlockId ===
          sourceBlockId
      ) {
        references += 1;
      }
    }
  }
  if (references === 0) return;
  throw new AdditionalDocumentBearingBlockError(
    "source_referenced",
    `Reusable Template ${sourceBlockId} still has ${references} live reference${references === 1 ? "" : "s"}`,
  );
};

const assertIdentityAvailable = (
  database: Database.Database,
  table: "blocks" | "documents",
  id: string,
): void => {
  const existing = database
    .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ?`)
    .get(id) as { readonly present: number } | undefined;
  if (!existing) return;
  throw new AdditionalDocumentBearingBlockError(
    "identity_conflict",
    `${table === "blocks" ? "Block" : "Document"} identity already exists: ${id}`,
  );
};

const hashIdentity = (operationId: string, sourceId: string): string =>
  `block:${createHash("sha256")
    .update(stableStringifyBlockPropertyJson([operationId, sourceId]))
    .digest("hex")}`;

const clonePortable = <T extends BlockTreeValue>(value: T): T =>
  structuredClone(value);

const remapTemplateBlockTree = (
  blocks: readonly BlockTreeNode[],
  operationId: string,
): readonly BlockTreeNode[] => {
  const visit = (block: BlockTreeNode): BlockTreeNode => ({
    id: hashIdentity(operationId, block.id),
    type: block.type,
    props: clonePortable(block.props),
    ...(block.content === undefined
      ? {}
      : { content: clonePortable(block.content) }),
    children: block.children.map(visit),
  });
  return blocks.map(visit);
};

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const allocateTopLevelRank = (
  database: Database.Database,
  projectId: string,
  targetBlockId: string,
  beforeBlockId?: string,
): string => {
  const items = database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      INNER JOIN blocks block ON block.id = placement.block_id
      WHERE placement.project_id = ? AND block.lifecycle <> 'deleted'
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(projectId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[];
  const plan = planDatabaseFractionalRank({
    items,
    targetId: targetBlockId,
    ...(beforeBlockId ? { beforeId: beforeBlockId } : {}),
  });
  const now = new Date().toISOString();
  const update = database.prepare(`
    UPDATE top_level_block_placements
    SET rank_key = ?, updated_at = ?
    WHERE block_id = ? AND project_id = ?
  `);
  for (const [blockId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, now, blockId, projectId);
  }
  return plan.rankKey;
};

interface StageOwnedDocumentInput {
  readonly projectId: string;
  readonly blockId: string;
  readonly blockType: string;
  readonly documentId: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly displayName: string;
  readonly location:
    | { readonly kind: "space"; readonly beforeBlockId?: string }
    | { readonly kind: "document"; readonly hostDocumentId: string };
}

const stageOwnedDocument = (
  database: Database.Database,
  input: StageOwnedDocumentInput,
): void => {
  assertIdentityAvailable(database, "blocks", input.blockId);
  assertIdentityAvailable(database, "documents", input.documentId);
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, 1, 1, ?, ?)
    `,
    )
    .run(
      input.blockId,
      input.projectId,
      input.blockType,
      input.location.kind,
      input.location.kind === "document" ? input.location.hostDocumentId : null,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type,
        value_json, revision, updated_at
      ) VALUES (?, ?, 'document.display_name', 'string', ?, 1, ?)
    `,
    )
    .run(
      input.blockId,
      input.projectId,
      stableStringifyBlockPropertyJson(input.displayName),
      now,
    );
  if (input.location.kind === "space") {
    database
      .prepare(
        `
        INSERT INTO top_level_block_placements (
          block_id, project_id, rank_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(
        input.blockId,
        input.projectId,
        allocateTopLevelRank(
          database,
          input.projectId,
          input.blockId,
          input.location.beforeBlockId,
        ),
        now,
        now,
      );
  }
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, ?, ?, X'', '', 'pending_genesis',
        'legacy_shadow', NULL, ?, ?)
    `,
    )
    .run(
      input.documentId,
      input.projectId,
      input.schemaKey,
      input.schemaVersion,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(input.blockId, input.documentId, input.projectId, now);
};

const initializeOwnedBlockTreeDocument = (
  database: Database.Database,
  input: {
    readonly operationId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly clientSessionId: string;
    readonly blockId: string;
    readonly blockType: string;
    readonly documentId: string;
    readonly schemaKey: string;
    readonly schemaVersion: number;
    readonly displayName: string;
    readonly blockTree: readonly BlockTreeNode[];
    readonly location: StageOwnedDocumentInput["location"];
  },
): { readonly generation: number; readonly headSeq: number } => {
  let envelope: ReturnType<typeof createBodyOnlyBlockDocument> | null = null;
  try {
    stageOwnedDocument(database, input);
    envelope = createBodyOnlyBlockDocument({
      documentId: input.documentId,
      initializeBody: false,
      label: input.blockType,
    });
    populateBlockDocumentBodyFromBlockTree(envelope.body, input.blockTree);
    inspectOwnedBlockDocument(envelope.document, {
      ownerType: input.blockType,
      schemaKey: input.schemaKey,
      schemaVersion: input.schemaVersion,
    });
    const ack = initializeBlockDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch: input.storeEpoch,
      generation: 1,
      updateId: `${input.operationId}:genesis`,
      clientSessionId: input.clientSessionId,
      update: Y.encodeStateAsUpdate(envelope.document),
      finalAuthority: "ydoc_primary",
    });
    return { generation: ack.generation, headSeq: ack.headSeq };
  } catch (error) {
    if (error instanceof AdditionalDocumentBearingBlockError) throw error;
    if (error instanceof BlockDocumentStoreError) {
      throw new AdditionalDocumentBearingBlockError(
        error.code === "store_epoch_mismatch"
          ? "store_epoch_mismatch"
          : "document_state_corrupt",
        error.message,
        { cause: error },
      );
    }
    throw new AdditionalDocumentBearingBlockError(
      "invalid_request",
      `Initial ${input.blockType} content violates its registered Document schema: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    envelope?.document.destroy();
  }
};

interface TemplateSourceState {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly blockTree: readonly BlockTreeNode[];
  readonly displayName: string;
}

const loadTemplateSource = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly sourceBlockId: string;
    readonly sourceDocumentId: string;
    readonly expectedGeneration: number;
    readonly expectedHeadSeq: number;
  },
): TemplateSourceState => {
  let descriptor;
  try {
    descriptor = getOwnedBlockDocumentDescriptor(
      database,
      input.projectId,
      input.sourceBlockId,
    );
  } catch (error) {
    throw new AdditionalDocumentBearingBlockError(
      "source_not_found",
      `Reusable Template source does not exist: ${input.sourceBlockId}`,
      { cause: error },
    );
  }
  if (
    descriptor.ownerType !== REUSABLE_TEMPLATE_SOURCE_TYPE ||
    descriptor.documentId !== input.sourceDocumentId ||
    descriptor.schemaKey !== REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY ||
    descriptor.schemaVersion !== REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION ||
    descriptor.readiness !== "ready" ||
    descriptor.authority !== "ydoc_primary" ||
    descriptor.ownerLifecycle === "deleted"
  ) {
    throw new AdditionalDocumentBearingBlockError(
      "source_not_found",
      `Block ${input.sourceBlockId} is not a readable Reusable Template source`,
    );
  }
  if (
    descriptor.generation !== input.expectedGeneration ||
    descriptor.headSeq !== input.expectedHeadSeq
  ) {
    throw new AdditionalDocumentBearingBlockError(
      "document_head_conflict",
      `Reusable Template source changed before this operation`,
    );
  }
  const loaded = loadPrimaryBlockDocument(database, descriptor.documentId);
  try {
    const materialization = inspectOwnedBlockDocument(loaded.document, {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    }).materialization;
    if (materialization.kind !== "reusable_template") {
      throw new AdditionalDocumentBearingBlockError(
        "document_state_corrupt",
        `Reusable Template ${input.sourceBlockId} materialized as ${materialization.kind}`,
      );
    }
    const property = database
      .prepare(
        `
        SELECT value_json
        FROM block_properties
        WHERE block_id = ? AND project_id = ?
          AND property_key = 'document.display_name'
          AND value_type = 'string'
      `,
      )
      .get(input.sourceBlockId, input.projectId) as
      | { readonly value_json: string }
      | undefined;
    let displayName: unknown;
    try {
      displayName = property ? JSON.parse(property.value_json) : null;
    } catch {
      displayName = null;
    }
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      throw new AdditionalDocumentBearingBlockError(
        "document_state_corrupt",
        `Reusable Template ${input.sourceBlockId} has no authoritative display name`,
      );
    }
    return {
      documentId: descriptor.documentId,
      generation: descriptor.generation,
      headSeq: descriptor.headSeq,
      blockTree: materialization.blockTree,
      displayName,
    };
  } finally {
    loaded.document.destroy();
  }
};

const mapHostError = (message: string): AdditionalDocumentBearingBlockError =>
  new AdditionalDocumentBearingBlockError("host_document_conflict", message);

const applyHostInsertions = (
  database: Database.Database,
  input: {
    readonly operationId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly clientSessionId: string;
    readonly actor: Readonly<Record<string, BlockTreeValue>>;
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
    readonly blocks: readonly BlockTreeNode[];
    readonly parentBlockId?: string;
    readonly beforeBlockId?: string;
    readonly stagedOwnerBlockIds?: readonly string[];
  },
) => {
  if (input.blocks.length === 0) {
    throw new AdditionalDocumentBearingBlockError(
      "invalid_request",
      "A Reusable Template must contain at least one Block before instantiation",
    );
  }
  const result = applyDocumentOperationBatch(
    database,
    {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      mutationId: `${input.operationId}:host`,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      documentId: input.documentId,
      generation: input.generation,
      expectedHeadSeq: input.headSeq,
      operations: input.blocks.map((block) => ({
        kind: "insert_block" as const,
        block,
        ...(input.parentBlockId
          ? { parentBlockId: input.parentBlockId }
          : {}),
        ...(input.beforeBlockId ? { beforeBlockId: input.beforeBlockId } : {}),
      })),
    },
    {
      allowStagedDocumentBearingBlockIds: input.stagedOwnerBlockIds,
    },
  );
  if (result.ok) return result.value;
  throw mapHostError(result.error.message);
};

const parseStoredOutcome = (value: unknown): StoredMutationOutcome => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored additional document-bearing result is not an object");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.code === "string" &&
    ADDITIONAL_DOCUMENT_BEARING_ERROR_CODES.has(record.code) &&
    typeof record.message === "string"
  ) {
    return record as StoredMutationOutcome;
  }
  if (
    record.version === ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION &&
    typeof record.operationId === "string" &&
    typeof record.projectId === "string" &&
    typeof record.storeEpoch === "string" &&
    typeof record.mutationKind === "string" &&
    Array.isArray(record.blockIds) &&
    typeof record.documentHeads === "object" &&
    record.documentHeads !== null &&
    Number.isSafeInteger(record.changeLogSeq) &&
    typeof record.duplicate === "boolean" &&
    typeof record.committedAt === "string"
  ) {
    return record as unknown as AdditionalDocumentBearingMutationResult;
  }
  throw new TypeError("Stored additional document-bearing result is invalid");
};

const isStoredRejection = (
  value: StoredMutationOutcome,
): value is Extract<StoredMutationOutcome, { readonly code: string }> =>
  "code" in value;

const mapReceiptError = (
  error: AuthoritativeOperationReceiptError,
): AdditionalDocumentBearingBlockError =>
  new AdditionalDocumentBearingBlockError(
    error.code === "operation_id_collision"
      ? "identity_conflict"
      : "document_state_corrupt",
    error.message,
    { cause: error },
  );

const executeMutation = (
  database: Database.Database,
  input: {
    readonly operationId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly clientSessionId: string;
    readonly actor: Readonly<Record<string, BlockTreeValue>>;
    readonly mutationKind: AdditionalDocumentBearingMutationResult["mutationKind"];
    readonly logicalRequest: Readonly<Record<string, unknown>>;
    readonly requestedBlockIds: readonly string[];
    readonly fieldIntents: readonly Readonly<{
      readonly path: string;
      readonly operation: string;
    }>[];
  },
  operation: () => {
    readonly blockIds: readonly string[];
    readonly documentHeads: AdditionalDocumentBearingMutationResult["documentHeads"];
  },
  options: AdditionalDocumentBearingMutationOptions,
): AdditionalDocumentBearingMutationResult => {
  const operationId = requireIdentity(input.operationId, "operationId");
  const projectId = requireProject(database, input.projectId);
  const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
  const clientSessionId = requireIdentity(
    input.clientSessionId,
    "clientSessionId",
  );
  let prepared;
  try {
    prepared = prepareAuthoritativeOperation(
      database,
      {
        operationId,
        projectId,
        mutationKind: input.mutationKind,
        logicalRequest: input.logicalRequest,
        actor: input.actor,
        clientSessionId,
      },
      parseStoredOutcome,
    );
  } catch (error) {
    if (error instanceof AuthoritativeOperationReceiptError) {
      throw mapReceiptError(error);
    }
    throw error;
  }
  if (prepared.kind === "replay") {
    if (isStoredRejection(prepared.result)) {
      throw new AdditionalDocumentBearingBlockError(
        prepared.result.code,
        prepared.result.message,
      );
    }
    return { ...prepared.result, duplicate: true };
  }

  try {
    return database
      .transaction(() => {
        const committed = operation();
        options.faultInjector?.("before_receipt");
        const committedAt = new Date().toISOString();
        return persistAuthoritativeOperationReceipt(database, {
          evidence: prepared.evidence,
          targetBlockIds: committed.blockIds,
          affectedDocumentIds: Object.keys(committed.documentHeads),
          fieldIntents: input.fieldIntents,
          documentHeads: committed.documentHeads,
          committedRevisions: {},
          changePayload: { mutationKind: input.mutationKind },
          committedAt,
          makeResult: (changeLogSeq): AdditionalDocumentBearingMutationResult => ({
            version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
            operationId,
            projectId,
            storeEpoch,
            mutationKind: input.mutationKind,
            blockIds: [...new Set(committed.blockIds)].sort(),
            documentHeads: committed.documentHeads,
            changeLogSeq,
            duplicate: false,
            committedAt,
          }),
        }).result;
      })
      .immediate();
  } catch (error) {
    if (!(error instanceof AdditionalDocumentBearingBlockError)) throw error;
    if (
      error.code === "project_not_found" ||
      error.code === "store_epoch_mismatch"
    ) {
      throw error;
    }
    database
      .transaction(() => {
        persistAuthoritativeOperationRejection(database, {
          evidence: prepared.evidence,
          targetBlockIds: input.requestedBlockIds,
          fieldIntents: input.fieldIntents,
          rejectedAt: new Date().toISOString(),
          result: { code: error.code, message: error.message },
        });
      })
      .immediate();
    throw error;
  }
};

const validateCommonInput = (input: {
  readonly version: number;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId: string;
  readonly actor: Readonly<Record<string, BlockTreeValue>>;
}): void => {
  requireVersion(input.version);
  requireIdentity(input.operationId, "operationId");
  requireIdentity(input.projectId, "projectId");
  requireIdentity(input.storeEpoch, "storeEpoch");
  requireIdentity(input.clientSessionId, "clientSessionId");
  try {
    stableStringifyBlockPropertyJson(input.actor);
  } catch (error) {
    throw new AdditionalDocumentBearingBlockError(
      "invalid_request",
      "actor must contain bounded portable JSON",
      { cause: error },
    );
  }
};

const withoutAuditIdentity = <
  T extends {
    readonly actor: Readonly<Record<string, BlockTreeValue>>;
    readonly clientSessionId: string;
  },
>(input: T): Omit<T, "actor" | "clientSessionId"> => {
  const { actor, clientSessionId, ...logicalRequest } = input;
  void actor;
  void clientSessionId;
  return logicalRequest;
};

export const createReusableTemplateSource = (
  database: Database.Database,
  input: CreateReusableTemplateSource,
  options: AdditionalDocumentBearingMutationOptions = {},
): AdditionalDocumentBearingMutationResult => {
  validateCommonInput(input);
  const sourceBlockId = requireIdentity(input.sourceBlockId, "sourceBlockId");
  const documentId = requireIdentity(input.documentId, "documentId");
  const displayName = requireBoundedText(
    input.displayName,
    "displayName",
    512,
  );
  return executeMutation(
    database,
    {
      ...input,
      mutationKind: input.kind,
      logicalRequest: withoutAuditIdentity(input),
      requestedBlockIds: [sourceBlockId],
      fieldIntents: [
        { path: "block.documentOwnership", operation: "create_template" },
      ],
    },
    () => {
      const head = initializeOwnedBlockTreeDocument(database, {
        ...input,
        blockId: sourceBlockId,
        blockType: REUSABLE_TEMPLATE_SOURCE_TYPE,
        documentId,
        schemaKey: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
        displayName,
        location: {
          kind: "space",
          ...(input.beforeBlockId
            ? { beforeBlockId: requireIdentity(input.beforeBlockId, "beforeBlockId") }
            : {}),
        },
      });
      options.faultInjector?.("after_owner_staged");
      options.faultInjector?.("after_genesis");
      return {
        blockIds: [sourceBlockId, ...flattenBlockIds(input.blockTree)],
        documentHeads: { [documentId]: head },
      };
    },
    options,
  );
};

export const createReusableTemplateReference = (
  database: Database.Database,
  input: CreateReusableTemplateReference,
  options: AdditionalDocumentBearingMutationOptions = {},
): AdditionalDocumentBearingMutationResult => {
  validateCommonInput(input);
  const sourceBlockId = requireIdentity(input.sourceBlockId, "sourceBlockId");
  const sourceDocumentId = requireIdentity(
    input.sourceDocumentId,
    "sourceDocumentId",
  );
  const hostDocumentId = requireIdentity(input.hostDocumentId, "hostDocumentId");
  const referenceBlockId = requireIdentity(
    input.referenceBlockId,
    "referenceBlockId",
  );
  requireHead(input.expectedSourceGeneration, "expectedSourceGeneration", 1);
  requireHead(input.expectedSourceHeadSeq, "expectedSourceHeadSeq", 1);
  requireHead(input.expectedHostGeneration, "expectedHostGeneration", 1);
  requireHead(input.expectedHostHeadSeq, "expectedHostHeadSeq", 1);
  return executeMutation(
    database,
    {
      ...input,
      mutationKind: input.kind,
      logicalRequest: withoutAuditIdentity(input),
      requestedBlockIds: [referenceBlockId],
      fieldIntents: [
        { path: "document.block", operation: "create_template_reference" },
      ],
    },
    () => {
      const source = loadTemplateSource(database, {
        projectId: input.projectId,
        sourceBlockId,
        sourceDocumentId,
        expectedGeneration: input.expectedSourceGeneration,
        expectedHeadSeq: input.expectedSourceHeadSeq,
      });
      const host = applyHostInsertions(database, {
        ...input,
        documentId: hostDocumentId,
        generation: input.expectedHostGeneration,
        headSeq: input.expectedHostHeadSeq,
        blocks: [
          {
            id: referenceBlockId,
            type: REUSABLE_TEMPLATE_REFERENCE_TYPE,
            props: {
              sourceBlockId,
              displayHint: source.displayName,
            },
            children: [],
          },
        ],
      });
      options.faultInjector?.("after_host_update");
      return {
        blockIds: [referenceBlockId, sourceBlockId],
        documentHeads: {
          [source.documentId]: {
            generation: source.generation,
            headSeq: source.headSeq,
          },
          [hostDocumentId]: {
            generation: host.generation,
            headSeq: host.headSeq,
          },
        },
      };
    },
    options,
  );
};

export const instantiateReusableTemplate = (
  database: Database.Database,
  input: InstantiateReusableTemplate,
  options: AdditionalDocumentBearingMutationOptions = {},
): AdditionalDocumentBearingMutationResult => {
  validateCommonInput(input);
  const sourceBlockId = requireIdentity(input.sourceBlockId, "sourceBlockId");
  const sourceDocumentId = requireIdentity(
    input.sourceDocumentId,
    "sourceDocumentId",
  );
  const targetDocumentId = requireIdentity(
    input.targetDocumentId,
    "targetDocumentId",
  );
  requireHead(input.expectedSourceGeneration, "expectedSourceGeneration", 1);
  requireHead(input.expectedSourceHeadSeq, "expectedSourceHeadSeq", 1);
  requireHead(input.expectedTargetGeneration, "expectedTargetGeneration", 1);
  requireHead(input.expectedTargetHeadSeq, "expectedTargetHeadSeq", 1);
  return executeMutation(
    database,
    {
      ...input,
      mutationKind: input.kind,
      logicalRequest: withoutAuditIdentity(input),
      requestedBlockIds: [sourceBlockId],
      fieldIntents: [
        { path: "document.block", operation: "instantiate_template" },
      ],
    },
    () => {
      const source = loadTemplateSource(database, {
        projectId: input.projectId,
        sourceBlockId,
        sourceDocumentId,
        expectedGeneration: input.expectedSourceGeneration,
        expectedHeadSeq: input.expectedSourceHeadSeq,
      });
      const instantiated = remapTemplateBlockTree(
        source.blockTree,
        input.operationId,
      );
      const target = applyHostInsertions(database, {
        ...input,
        documentId: targetDocumentId,
        generation: input.expectedTargetGeneration,
        headSeq: input.expectedTargetHeadSeq,
        blocks: instantiated,
      });
      options.faultInjector?.("after_host_update");
      return {
        blockIds: [sourceBlockId, ...flattenBlockIds(instantiated)],
        documentHeads: {
          [source.documentId]: {
            generation: source.generation,
            headSeq: source.headSeq,
          },
          [targetDocumentId]: {
            generation: target.generation,
            headSeq: target.headSeq,
          },
        },
      };
    },
    options,
  );
};

const resolveExplicitBlockSchema = (kind: ExplicitDocumentBearingBlockKind) => {
  if (kind === "large_document") {
    return {
      blockType: LARGE_DOCUMENT_BLOCK_TYPE,
      schemaKey: LARGE_DOCUMENT_SCHEMA_KEY,
      schemaVersion: LARGE_DOCUMENT_SCHEMA_VERSION,
    } as const;
  }
  if (kind === "large_code") {
    return {
      blockType: LARGE_CODE_BLOCK_TYPE,
      schemaKey: LARGE_CODE_DOCUMENT_SCHEMA_KEY,
      schemaVersion: LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
    } as const;
  }
  throw new AdditionalDocumentBearingBlockError(
    "invalid_request",
    `Unsupported explicit document-bearing Block kind: ${String(kind)}`,
  );
};

const resolveExplicitBlockTree = (
  input: CreateExplicitDocumentBearingBlock,
): readonly BlockTreeNode[] => {
  if (input.blockKind === "large_document") {
    if (input.blockTree && input.code === undefined && input.language === undefined) {
      return input.blockTree;
    }
    throw new AdditionalDocumentBearingBlockError(
      "invalid_request",
      "large_document requires blockTree and does not accept code/language",
    );
  }
  if (input.blockTree !== undefined) {
    throw new AdditionalDocumentBearingBlockError(
      "invalid_request",
      "large_code accepts code/language instead of an arbitrary blockTree",
    );
  }
  const language = requireBoundedText(
    input.language ?? "text",
    "language",
    128,
  );
  const code = requireBoundedText(input.code ?? "", "code", 2_000_000, true);
  return [
    {
      id: hashIdentity(input.operationId, "large-code-content"),
      type: "codeBlock",
      props: { language },
      content: [{ type: "text", text: code, styles: {} }],
      children: [],
    },
  ];
};

export const createExplicitDocumentBearingBlock = (
  database: Database.Database,
  input: CreateExplicitDocumentBearingBlock,
  options: AdditionalDocumentBearingMutationOptions = {},
): AdditionalDocumentBearingMutationResult => {
  validateCommonInput(input);
  const blockId = requireIdentity(input.blockId, "blockId");
  const documentId = requireIdentity(input.documentId, "documentId");
  const displayName = requireBoundedText(input.displayName, "displayName", 512);
  const schema = resolveExplicitBlockSchema(input.blockKind);
  const blockTree = resolveExplicitBlockTree(input);
  const location =
    input.location.kind === "space"
      ? {
          kind: "space" as const,
          ...(input.location.beforeBlockId
            ? {
                beforeBlockId: requireIdentity(
                  input.location.beforeBlockId,
                  "location.beforeBlockId",
                ),
              }
            : {}),
        }
      : {
          kind: "document" as const,
          hostDocumentId: requireIdentity(
            input.location.hostDocumentId,
            "location.hostDocumentId",
          ),
        };
  if (input.location.kind === "document") {
    requireHead(
      input.location.expectedHostGeneration,
      "location.expectedHostGeneration",
      1,
    );
    requireHead(
      input.location.expectedHostHeadSeq,
      "location.expectedHostHeadSeq",
      1,
    );
  }
  return executeMutation(
    database,
    {
      ...input,
      mutationKind: input.kind,
      logicalRequest: withoutAuditIdentity(input),
      requestedBlockIds: [blockId],
      fieldIntents: [
        { path: "block.documentOwnership", operation: input.blockKind },
      ],
    },
    () => {
      const ownedHead = initializeOwnedBlockTreeDocument(database, {
        ...input,
        blockId,
        blockType: schema.blockType,
        documentId,
        schemaKey: schema.schemaKey,
        schemaVersion: schema.schemaVersion,
        displayName,
        blockTree,
        location,
      });
      options.faultInjector?.("after_owner_staged");
      options.faultInjector?.("after_genesis");
      const documentHeads: Record<
        string,
        { readonly generation: number; readonly headSeq: number }
      > = { [documentId]: ownedHead };
      if (input.location.kind === "document") {
        const shell: BlockTreeNode = {
          id: blockId,
          type: schema.blockType,
          props:
            input.blockKind === "large_code"
              ? {
                  displayName,
                  language: requireBoundedText(
                    input.language ?? "text",
                    "language",
                    128,
                  ),
                }
              : { displayName },
          children: [],
        };
        const host = applyHostInsertions(database, {
          ...input,
          documentId: input.location.hostDocumentId,
          generation: input.location.expectedHostGeneration,
          headSeq: input.location.expectedHostHeadSeq,
          blocks: [shell],
          ...(input.location.parentBlockId
            ? { parentBlockId: input.location.parentBlockId }
            : {}),
          ...(input.location.beforeBlockId
            ? { beforeBlockId: input.location.beforeBlockId }
            : {}),
          stagedOwnerBlockIds: [blockId],
        });
        documentHeads[input.location.hostDocumentId] = {
          generation: host.generation,
          headSeq: host.headSeq,
        };
        options.faultInjector?.("after_host_update");
      }
      return {
        blockIds: [blockId, ...flattenBlockIds(blockTree)],
        documentHeads,
      };
    },
    options,
  );
};
