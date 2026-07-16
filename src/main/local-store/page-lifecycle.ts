import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  PAGE_LIFECYCLE_CONTRACT_VERSION,
  PageLifecycleContractError,
  parsePageLifecycleMutationCommandResult,
  parsePageLifecycleMutationRequest,
  type PageLifecycleMutationCommandError,
  type PageLifecycleMutationCommandResult,
  type PageLifecycleMutationRequest,
  type PageLifecycleOperation,
  type CreatePageOperation,
  type RestorePageOperation,
} from "../../shared/page-lifecycle";
import type {
  PageLifecycleMembershipCoordinate,
  PageLifecycleOwnedBlockAuthority,
  PageLifecyclePreflight,
  PageLifecyclePreflightErrorCode,
  PageLifecyclePreflightResult,
  PageLifecycleRestoreEvidence,
} from "../../shared/page-lifecycle-runtime";
import {
  BlockDocumentCodecError,
  createPageDocumentGenesis,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/page-document";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { isWorkflowStatus, type WorkflowStatus } from "../../shared/workflow-status";
import { isUuidV7 } from "../../shared/uuid-v7";
import { initialDataSourceId } from "../../shared/library";
import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  FractionalRankError,
  planFractionalRank,
  type FractionalRankedItem,
} from "../../shared/fractional-rank";
import {
  BlockDocumentStoreError,
  initializePageDocumentGenesis,
} from "./block-document-store";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";
import { finalizePageNfmIdentityProjection } from "./page-nfm-projection-finalization";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  persistAuthoritativeOperationRejection,
  prepareAuthoritativeOperation,
  type AuthoritativeOperationEvidence,
} from "./authoritative-operation-receipts";
import {
  readDatabaseModule,
} from "./database-module";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

const MUTATION_KIND = "page_lifecycle";

const REQUIRED_DATABASE_PROPERTIES = {
  status: "select",
  priority: "select",
  estimate: "select",
  tags: "multi_select",
  due_date: "date",
  scheduled_start: "datetime",
  scheduled_end: "datetime",
  assignee: "person",
} as const satisfies Readonly<Record<string, DatabasePropertyValueType>>;

const INTRINSIC_CARD_PROPERTIES = {
  "run.target": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.runInTarget,
  },
  "run.localPath": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.runInLocalPath,
  },
  "run.baseBranch": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.runInBaseBranch,
  },
  "run.worktreePath": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.runInWorktreePath,
  },
  "run.environmentPath": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.runInEnvironmentPath,
  },
  "schedule.isAllDay": {
    valueType: "boolean",
    read: (input: CreatePageOperation) => input.isAllDay,
  },
  "schedule.timezone": {
    valueType: "string",
    read: (input: CreatePageOperation) => input.scheduleTimezone,
  },
  "recurrence.config": {
    valueType: "json",
    read: (input: CreatePageOperation) => input.recurrence,
  },
  "reminders.config": {
    valueType: "json",
    read: (input: CreatePageOperation) => input.reminders,
  },
} as const;

export type PageLifecycleMutationFaultPoint =
  | "after_identity"
  | "after_document_genesis"
  | "after_properties"
  | "after_authority"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyPageLifecycleMutationOptions {
  readonly now?: () => string;
  readonly allocateBodyBlockId?: () => string;
  readonly allocateMembershipId?: () => string;
  readonly faultInjector?: (point: PageLifecycleMutationFaultPoint) => void;
}

interface BlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
  readonly metadata_revision: number;
}

interface PageAuthorityRow {
  readonly library_id: string;
  readonly parent_kind: "library" | "page" | "data_source";
  readonly parent_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly parent_revision: number;
  readonly metadata_revision: number;
  readonly library_rank_key: string | null;
}

interface OwnedDocumentRow {
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly schema_key: string;
  readonly schema_version: number;
}

interface PrimaryDatabaseRow {
  readonly database_block_id: string;
  readonly view_id: string;
  readonly view_config_json: string;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly key: keyof typeof REQUIRED_DATABASE_PROPERTIES;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly schema_revision: number;
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly revision: number;
  readonly removed_at: string | null;
}

type RestoreMembership = Exclude<RestorePageOperation["membership"], null>;
type RestoreWithMembershipOperation = RestorePageOperation & {
  readonly membership: RestoreMembership;
};

interface DeleteEvidence {
  readonly previousLifecycle: "active" | "archived";
  readonly databaseId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly status: WorkflowStatus | null;
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly tombstonedBlocks: readonly IndexedClosureBlock[];
  readonly indexedDocumentIds: readonly string[];
}

interface IndexedClosureBlock {
  readonly id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadataRevision: number;
}

interface IndexedBlockClosure {
  readonly blocks: readonly IndexedClosureBlock[];
  readonly documentIds: readonly string[];
}

interface AuthorityCommit {
  readonly pageId: string;
  readonly lifecycle: BlockRow["lifecycle"];
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly databaseId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly libraryRankKey: string | null;
  readonly viewRankKey: string | null;
  readonly createdBlockIds: readonly string[];
  readonly targetBlockIds: readonly string[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly fieldIntents: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changePayload: Readonly<Record<string, unknown>>;
}

class PageLifecycleRejection extends Error {
  constructor(readonly error: PageLifecycleMutationCommandError) {
    super(error.message);
    this.name = "PageLifecycleRejection";
  }
}

const makeError = (
  code: PageLifecycleMutationCommandError["code"],
  message: string,
  request?: Pick<PageLifecycleMutationRequest, "operationId" | "operation">,
  revisions: Pick<
    PageLifecycleMutationCommandError,
    "expectedRevision" | "actualRevision"
  > = {},
): PageLifecycleMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(request === undefined ? {} : { operationId: request.operationId }),
  ...(request === undefined ? {} : { pageId: request.operation.pageId }),
  ...(revisions.expectedRevision === undefined
    ? {}
    : { expectedRevision: revisions.expectedRevision }),
  ...(revisions.actualRevision === undefined
    ? {}
    : { actualRevision: revisions.actualRevision }),
});

const reject = (
  code: PageLifecycleMutationCommandError["code"],
  message: string,
  request: PageLifecycleMutationRequest,
  revisions?: Pick<
    PageLifecycleMutationCommandError,
    "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new PageLifecycleRejection(
    makeError(code, message, request, revisions),
  );
};

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const genesisUpdateId = (operationId: string): string =>
  `page-create-genesis:${createHash("sha256").update(operationId).digest("hex")}`;

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const projectExists = (
  database: Database.Database,
  projectId: string,
): boolean =>
  database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !==
  undefined;

const authorizePageLifecycleMutation = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): void => {
  const resource =
    request.operation.kind === "create_page"
      ? (() => {
          const project = database.prepare(`
            SELECT database_block_id FROM projects WHERE id = ?
          `).get(request.projectId) as
            | { readonly database_block_id: string }
            | undefined;
          if (project) {
            return {
              kind: "database" as const,
              databaseId: project.database_block_id,
            };
          }
          return null;
        })()
      : ({
          kind: "page" as const,
          pageId: request.operation.pageId,
        });
  if (!resource) {
    return reject(
      "project_not_found",
      `Project does not exist: ${request.projectId}`,
      request,
    );
  }
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: request.projectId,
    resource,
    action: request.operation.kind === "create_page" ? "create_child" : "write",
  });
  if (authorization.allowed) return;
  reject(
    "authorization_denied",
    `Page lifecycle mutation denied: ${authorization.reason}`,
    request,
  );
};

const readBlock = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): BlockRow => {
  const row = database
    .prepare(
      `
      SELECT
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision
      FROM blocks
      WHERE id = ?
    `,
    )
    .get(request.operation.pageId) as BlockRow | undefined;
  if (!row) {
    const global = database
      .prepare("SELECT type FROM blocks WHERE id = ?")
      .get(request.operation.pageId);
    return reject(
      global ? "page_not_found" : "page_not_found",
      global
        ? `Page identity ${request.operation.pageId} is unavailable`
        : `Page does not exist: ${request.operation.pageId}`,
      request,
    );
  }
  if (row.type === "page") return row;
  return reject(
    "page_type_mismatch",
    `Block ${row.id} is ${row.type}, not a Page`,
    request,
  );
};

const readOwnedDocument = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): OwnedDocumentRow => {
  const row = database
    .prepare(
      `
      SELECT
        document.id AS document_id, document.generation, document.head_seq,
        document.readiness, document.authority,
        document.schema_key, document.schema_version
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      WHERE ownership.block_id = ?
    `,
    )
    .get(request.operation.pageId) as
    OwnedDocumentRow | undefined;
  if (
    row &&
    row.readiness === "ready" &&
    row.authority === "ydoc_primary" &&
    row.schema_key === PAGE_DOCUMENT_SCHEMA_KEY &&
    row.schema_version === PAGE_DOCUMENT_SCHEMA_VERSION &&
    row.generation >= 1 &&
    row.head_seq >= 1
  ) {
    return row;
  }
  return reject(
    "document_state_corrupt",
    `Page ${request.operation.pageId} does not own a current primary Page Document`,
    request,
  );
};

/**
 * Resolve only Blocks represented by the current exact-head indexes. Historical
 * registry rows intentionally stay outside this closure: removing a Block from
 * a Y.Doc tombstones its identity but does not make that tombstone part of a
 * later Page delete/restore.
 *
 * A current indexed Block may itself own a Document, so the walk follows
 * ownership recursively. The single SQLite writer transaction keeps every
 * checked head and index coordinate stable for the caller.
 */
const readCurrentIndexedBlockClosure = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  root: BlockRow,
): IndexedBlockClosure => {
  const blocks = new Map<string, IndexedClosureBlock>([
    [
      root.id,
      {
        id: root.id,
        lifecycle: root.lifecycle,
        metadataRevision: root.metadata_revision,
      },
    ],
  ]);
  const documentIds = new Set<string>();
  const pendingOwnerIds = [root.id];

  while (pendingOwnerIds.length > 0) {
    const ownerBlockId = pendingOwnerIds.shift();
    if (!ownerBlockId) continue;
    const document = database
      .prepare(
        `
        SELECT
          document.id, document.generation, document.head_seq,
          document.readiness, document.authority, document.sync_engine,
          materialization.generation AS materialization_generation,
          materialization.projected_seq AS materialization_projected_seq
        FROM block_documents ownership
        INNER JOIN documents document
          ON document.id = ownership.document_id
         AND document.project_id = ownership.project_id
        LEFT JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE ownership.block_id = ?
      `,
      )
      .get(ownerBlockId) as
      | {
          readonly id: string;
          readonly generation: number;
          readonly head_seq: number;
          readonly readiness: string;
          readonly authority: string;
          readonly sync_engine: "yjs" | "canvas_scene";
          readonly materialization_generation: number | null;
          readonly materialization_projected_seq: number | null;
        }
      | undefined;
    if (!document) continue;
    if (documentIds.has(document.id)) {
      return reject(
        "document_state_corrupt",
        `Document ${document.id} is reachable more than once from Page ${root.id}`,
        request,
      );
    }
    if (
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary" ||
      document.sync_engine !== "yjs" ||
      document.generation < 1 ||
      document.head_seq < 1 ||
      document.materialization_generation !== document.generation ||
      document.materialization_projected_seq !== document.head_seq
    ) {
      return reject(
        "document_state_corrupt",
        `Owned Document ${document.id} lacks an exact-head block-tree materialization`,
        request,
      );
    }
    documentIds.add(document.id);

    const indexedBlocks = database
      .prepare(
        `
        SELECT
          entry.block_id, entry.projected_seq,
          block.lifecycle, block.metadata_revision,
          block.location_kind, block.containing_document_id
        FROM document_block_index entry
        INNER JOIN blocks block ON block.id = entry.block_id
        WHERE entry.document_id = ?
        ORDER BY entry.block_id
      `,
      )
      .all(document.id) as readonly {
      readonly block_id: string;
      readonly projected_seq: number;
      readonly lifecycle: "active" | "archived" | "deleted";
      readonly metadata_revision: number;
      readonly location_kind: "space" | "document";
      readonly containing_document_id: string | null;
    }[];
    for (const indexed of indexedBlocks) {
      if (
        indexed.projected_seq !== document.head_seq ||
        indexed.location_kind !== "document" ||
        indexed.containing_document_id !== document.id ||
        blocks.has(indexed.block_id)
      ) {
        return reject(
          "document_state_corrupt",
          `Document ${document.id} has a stale or ambiguous current Block index`,
          request,
        );
      }
      blocks.set(indexed.block_id, {
        id: indexed.block_id,
        lifecycle: indexed.lifecycle,
        metadataRevision: indexed.metadata_revision,
      });
      pendingOwnerIds.push(indexed.block_id);
    }
  }

  return {
    blocks: [...blocks.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    documentIds: [...documentIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

const readPrimaryDatabase = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): PrimaryDatabaseRow => {
  const rows = database
    .prepare(
      `
      SELECT
        capability.block_id AS database_block_id,
        view.id AS view_id,
        view.config_json AS view_config_json
      FROM database_capabilities capability
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
       AND database_block.project_id = capability.project_id
       AND database_block.type = 'database'
       AND database_block.lifecycle = 'active'
      INNER JOIN database_views view
        ON view.database_block_id = capability.block_id
       AND view.project_id = capability.project_id
       AND view.is_primary = 1
       AND view.kind = 'kanban'
       AND view.lifecycle = 'active'
      WHERE capability.project_id = ? AND capability.is_primary = 1
      ORDER BY capability.block_id, view.id
    `,
    )
    .all(request.projectId) as PrimaryDatabaseRow[];
  if (rows.length === 1 && rows[0]) return rows[0];
  return reject(
    "primary_database_not_found",
    rows.length === 0
      ? `Project ${request.projectId} has no active primary Database/Kanban View`
      : `Project ${request.projectId} has ambiguous primary Database state`,
    request,
  );
};

const readRequiredDatabaseProperties = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  databaseId: string,
  viewConfigJson: string,
): ReadonlyMap<
  keyof typeof REQUIRED_DATABASE_PROPERTIES,
  DatabasePropertyRow
> => {
  const keys = Object.keys(REQUIRED_DATABASE_PROPERTIES) as Array<
    keyof typeof REQUIRED_DATABASE_PROPERTIES
  >;
  const placeholders = keys.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT id, key, value_type, config_json, schema_revision
      FROM database_properties
      WHERE database_block_id = ?
        AND lifecycle = 'active' AND key IN (${placeholders})
      ORDER BY key, id
    `,
    )
    .all(databaseId, ...keys) as Array<
    Omit<DatabasePropertyRow, "config"> & { readonly config_json: string }
  >;
  const properties = new Map<
    keyof typeof REQUIRED_DATABASE_PROPERTIES,
    DatabasePropertyRow
  >();
  for (const row of rows) {
    const expectedType = REQUIRED_DATABASE_PROPERTIES[row.key];
    if (row.value_type !== expectedType || properties.has(row.key)) {
      return reject(
        "database_schema_invalid",
        `Primary Database property ${row.key} has an ambiguous or invalid type`,
        request,
      );
    }
    let config: Readonly<Record<string, DatabaseJsonValue>>;
    try {
      config = parseDatabasePropertyConfig(
        row.value_type,
        JSON.parse(row.config_json),
      );
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Primary Database property ${row.key} has invalid config: ${error instanceof Error ? error.message : String(error)}`,
        request,
      );
    }
    properties.set(row.key, { ...row, config });
  }
  const missing = keys.filter((key) => !properties.has(key));
  if (missing.length > 0) {
    return reject(
      "database_schema_invalid",
      `Primary Database is missing required Page properties: ${missing.join(", ")}`,
      request,
    );
  }
  let viewConfig;
  try {
    viewConfig = parseDatabaseViewConfig(JSON.parse(viewConfigJson));
  } catch (error) {
    return reject(
      "database_schema_invalid",
      `Primary Kanban View config is invalid: ${error instanceof Error ? error.message : String(error)}`,
      request,
    );
  }
  if (viewConfig.group?.propertyId !== properties.get("status")?.id) {
    return reject(
      "database_schema_invalid",
      "Primary Kanban View must group by the current status property identity",
      request,
    );
  }
  return properties;
};

const registerCreateTagOptions = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: CreatePageOperation;
  },
  property: DatabasePropertyRow,
  now: string,
): {
  readonly property: DatabasePropertyRow;
  readonly createdOptionIds: readonly string[];
} => {
  const rawOptions = property.config.options;
  if (!Array.isArray(rawOptions)) {
    return reject(
      "database_schema_invalid",
      `Primary Database tags property ${property.id} has no option registry`,
      request,
    );
  }
  const options = rawOptions.map((rawOption) => {
    if (
      typeof rawOption !== "object" ||
      rawOption === null ||
      Array.isArray(rawOption) ||
      typeof rawOption.id !== "string" ||
      typeof rawOption.name !== "string"
    ) {
      return reject(
        "database_schema_invalid",
        `Primary Database tags property ${property.id} has an invalid option`,
        request,
      );
    }
    return rawOption;
  });
  const existingIds = new Set(options.map((option) => option.id as string));
  const createdOptionIds = [...new Set(request.operation.tags)]
    .filter((tag) => !existingIds.has(tag))
    .sort((left, right) => left.localeCompare(right));
  if (createdOptionIds.length === 0) {
    return { property, createdOptionIds };
  }
  if (options.length + createdOptionIds.length > 10_000) {
    return reject(
      "database_schema_invalid",
      `Primary Database tags property ${property.id} exceeds the option registry limit`,
      request,
    );
  }
  const nextOptions = [
    ...options,
    ...createdOptionIds.map((tag) => ({ id: tag, name: tag })),
  ].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  const config = parseDatabasePropertyConfig(property.value_type, {
    ...property.config,
    options: nextOptions,
  });
  const configJson = stableStringifyBlockPropertyJson(config);
  const updated = database
    .prepare(
      `
      UPDATE database_properties
      SET config_json = ?, schema_revision = schema_revision + 1, updated_at = ?
      WHERE id = ? AND project_id = ? AND lifecycle = 'active'
        AND schema_revision = ?
    `,
    )
    .run(
      configJson,
      now,
      property.id,
      request.projectId,
      property.schema_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(
      `Primary Database tags property ${property.id} changed during Page creation`,
    );
  }
  return {
    property: {
      ...property,
      config,
      config_json: configJson,
      schema_revision: property.schema_revision + 1,
    },
    createdOptionIds,
  };
};

const readPlacementItems = (
  database: Database.Database,
  projectId: string,
): readonly FractionalRankedItem[] =>
  database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      INNER JOIN blocks block
        ON block.id = placement.block_id
       AND block.project_id = placement.project_id
       AND block.location_kind = 'space'
       AND block.lifecycle <> 'deleted'
      WHERE placement.project_id = ?
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(projectId) as FractionalRankedItem[];

const applyRankPlan = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  input: {
    readonly items: readonly FractionalRankedItem[];
    readonly targetId: string;
    readonly beforeId?: string;
    readonly updateExisting: (id: string, rankKey: string) => void;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  let plan;
  try {
    plan = planFractionalRank({
      items: input.items,
      targetId: input.targetId,
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    });
  } catch (error) {
    if (
      error instanceof FractionalRankError &&
      error.code === "anchor_not_found"
    ) {
      return reject("position_anchor_not_found", error.message, request);
    }
    throw error;
  }
  for (const [id, rankKey] of plan.rebalancedRankKeys) {
    input.updateExisting(id, rankKey);
  }
  return {
    rankKey: plan.rankKey,
    rebalanced: plan.rebalancedRankKeys.size,
  };
};

const allocateTopLevelRank = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  beforeBlockId?: string,
): { readonly rankKey: string; readonly rebalanced: number } =>
  applyRankPlan(database, request, {
    items: readPlacementItems(database, request.projectId),
    targetId: request.operation.pageId,
    ...(beforeBlockId === undefined ? {} : { beforeId: beforeBlockId }),
    updateExisting: (blockId, rankKey) => {
      database
        .prepare(
          `
          UPDATE top_level_block_placements
          SET rank_key = ?, updated_at = updated_at
          WHERE block_id = ? AND project_id = ?
        `,
        )
        .run(rankKey, blockId, request.projectId);
    },
  });

const allocateViewRank = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  input: {
    readonly viewId: string;
    readonly status: string;
    readonly beforeViewPageId?: string;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  if (input.beforeViewPageId !== undefined) {
    const anchor = database
      .prepare(
        `
        SELECT group_key
        FROM database_view_positions
        WHERE view_id = ? AND block_id = ?
      `,
      )
      .get(input.viewId, input.beforeViewPageId) as
      { readonly group_key: string | null } | undefined;
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `Primary View anchor does not exist: ${input.beforeViewPageId}`,
        request,
      );
    }
    if (anchor.group_key !== input.status) {
      return reject(
        "position_anchor_group_mismatch",
        `Primary View anchor ${input.beforeViewPageId} belongs to another status group`,
        request,
      );
    }
  }
  const items = database
    .prepare(
      `
      SELECT block_id AS id, rank_key AS rankKey
      FROM database_view_positions
      WHERE view_id = ? AND group_key = ?
      ORDER BY rank_key, block_id
    `,
    )
    .all(
      input.viewId,
      input.status,
    ) as FractionalRankedItem[];
  return applyRankPlan(database, request, {
    items,
    targetId: request.operation.pageId,
    ...(input.beforeViewPageId === undefined
      ? {}
      : { beforeId: input.beforeViewPageId }),
    updateExisting: (pageId, rankKey) => {
      database
        .prepare(
          `
          UPDATE database_view_positions
          SET rank_key = ?
          WHERE view_id = ? AND block_id = ?
        `,
        )
        .run(rankKey, input.viewId, pageId);
    },
  });
};

const databasePropertyValue = (
  input: CreatePageOperation,
  key: keyof typeof REQUIRED_DATABASE_PROPERTIES,
): unknown => {
  switch (key) {
    case "status":
      return input.status;
    case "priority":
      return input.priority;
    case "estimate":
      return input.estimate;
    case "tags":
      return input.tags;
    case "due_date":
      return input.dueDate;
    case "scheduled_start":
      return input.scheduledStart;
    case "scheduled_end":
      return input.scheduledEnd;
    case "assignee":
      return input.assignee;
  }
};

const assertIdentityAvailable = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: CreatePageOperation;
  },
  membershipId: string,
): void => {
  const documentId = `document:${request.operation.pageId}`;
  const collision = database
    .prepare(
      `
      SELECT 'block' AS kind FROM blocks WHERE id = ?
      UNION ALL SELECT 'document' FROM documents WHERE id = ?
      UNION ALL SELECT 'membership' FROM database_memberships WHERE id = ?
      LIMIT 1
    `,
    )
    .get(request.operation.pageId, documentId, membershipId) as
    { readonly kind: string } | undefined;
  if (!collision) return;
  reject(
    "page_identity_collision",
    `Page identity ${request.operation.pageId} collides with an existing ${collision.kind}`,
    request,
  );
};

const createPage = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: CreatePageOperation;
  },
  now: string,
  options: ApplyPageLifecycleMutationOptions,
): AuthorityCommit => {
  if (!isUuidV7(request.operation.pageId)) {
    reject(
      "invalid_page_lifecycle_request",
      "New Page Block id must be a canonical lowercase UUID-v7",
      request,
    );
  }
  const membershipId = options.allocateMembershipId?.() ?? randomUUID();
  assertIdentityAvailable(database, request, membershipId);
  const primary = readPrimaryDatabase(database, request);
  const properties = new Map(
    readRequiredDatabaseProperties(
    database,
    request,
    primary.database_block_id,
    primary.view_config_json,
    ),
  );
  const tagsProperty = properties.get("tags");
  if (!tagsProperty) {
    return reject(
      "database_schema_invalid",
      "Primary Database is missing its tags property",
      request,
    );
  }
  const registeredTags = registerCreateTagOptions(
    database,
    request,
    tagsProperty,
    now,
  );
  properties.set("tags", registeredTags.property);
  const viewRank = allocateViewRank(database, request, {
    viewId: primary.view_id,
    status: request.operation.status,
    beforeViewPageId: request.operation.beforeViewPageId,
  });
  const pageId = request.operation.pageId;
  const documentId = `document:${pageId}`;
  const genesis = createPageDocumentGenesis({
    documentId,
    ...(request.operation.richTitle
      ? { richTitle: request.operation.richTitle }
      : { title: request.operation.title }),
    nfm: request.operation.nfm,
    ...(options.allocateBodyBlockId === undefined
      ? {}
      : { allocateBlockId: options.allocateBodyBlockId }),
  });
  try {
    database
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, containing_database_id,
          location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES (?, ?, 'page', 'active', 'database', NULL, ?, 1, 1, ?, ?)
      `,
      )
      .run(pageId, request.projectId, primary.database_block_id, now, now);
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
        documentId,
        request.projectId,
        PAGE_DOCUMENT_SCHEMA_KEY,
        PAGE_DOCUMENT_SCHEMA_VERSION,
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
      .run(pageId, documentId, request.projectId, now);
    options.faultInjector?.("after_identity");

    const genesisAck = initializePageDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: genesisUpdateId(request.operationId),
      clientSessionId: request.clientSessionId ?? "authoritative-page-create",
      update: genesis.update,
      finalAuthority: "ydoc_primary",
    });
    options.faultInjector?.("after_document_genesis");

    database
      .prepare(
        `
        INSERT INTO database_memberships (
          id, database_block_id, page_block_id, project_id,
          revision, created_at, removed_at
        ) VALUES (?, ?, ?, ?, 1, ?, NULL)
      `,
      )
      .run(
        membershipId,
        primary.database_block_id,
        pageId,
        request.projectId,
        now,
      );
    const insertDatabaseValue = database.prepare(
      `
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `,
    );
    for (const [key, property] of properties) {
      let value: DatabaseJsonValue;
      try {
        value = normalizeDatabasePropertyValue(
          {
            valueType: property.value_type,
            config: property.config,
          },
          databasePropertyValue(request.operation, key),
        );
      } catch (error) {
        return reject(
          "database_property_value_invalid",
          `Page value for primary Database property ${key} violates the current schema: ${error instanceof Error ? error.message : String(error)}`,
          request,
        );
      }
      insertDatabaseValue.run(
        membershipId,
        property.id,
        primary.database_block_id,
        request.projectId,
        property.value_type,
        stableStringifyBlockPropertyJson(value),
        now,
      );
    }
    const insertIntrinsic = database.prepare(
      `
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type,
        value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `,
    );
    for (const [key, definition] of Object.entries(INTRINSIC_CARD_PROPERTIES)) {
      insertIntrinsic.run(
        pageId,
        request.projectId,
        key,
        definition.valueType,
        stableStringifyBlockPropertyJson(definition.read(request.operation)),
        now,
      );
    }
    database
      .prepare(
        `
        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `,
      )
      .run(
        primary.view_id,
        pageId,
        request.projectId,
        request.operation.status,
        viewRank.rankKey,
        now,
        now,
      );
    options.faultInjector?.("after_properties");

    const createdBlockIds = flattenBlockIds(genesis.materialization.blockTree);
    return {
      pageId,
      lifecycle: "active",
      metadataRevision: 1,
      parentRevision: 1,
      documentId,
      documentGeneration: 1,
      documentHeadSeq: genesisAck.headSeq,
      databaseId: primary.database_block_id,
      membershipId,
      viewId: primary.view_id,
      libraryRankKey: null,
      viewRankKey: viewRank.rankKey,
      createdBlockIds,
      targetBlockIds: uniqueSorted([
        pageId,
        primary.database_block_id,
        ...createdBlockIds,
      ]),
      affectedDatabaseBlockIds: [primary.database_block_id],
      fieldIntents: [
        { path: `blocks.${pageId}`, operation: "create" },
        { path: `documents.${documentId}`, operation: "genesis" },
        { path: `memberships.${membershipId}`, operation: "create" },
        ...registeredTags.createdOptionIds.map((optionId) => ({
          path: `databases.${primary.database_block_id}.properties.${tagsProperty.id}.options.${optionId}`,
          operation: "add",
        })),
      ],
      expectedRevisions: {
        blockMetadata: 0,
        blockLocation: 0,
        membership: 0,
      },
      committedRevisions: {
        blockMetadata: 1,
        blockLocation: 1,
        membership: 1,
        viewPosition: 1,
      },
      changePayload: {
        operation: "create_page",
        pageId,
        documentId,
        databaseId: primary.database_block_id,
        membershipId,
        viewId: primary.view_id,
        status: request.operation.status,
        createdBlockIds,
        libraryRankKey: null,
        viewRankKey: viewRank.rankKey,
        rebalancedTopLevelPlacements: [],
        rebalancedViewPositions: viewRank.rebalanced,
        createdTagOptionIds: registeredTags.createdOptionIds,
      },
    };
  } finally {
    genesis.document.destroy();
  }
};

const requireRevision = (
  request: PageLifecycleMutationRequest,
  expected: number,
  actual: number,
  kind: "metadata" | "parent",
): void => {
  if (expected === actual) return;
  reject(
    kind === "metadata"
      ? "metadata_revision_conflict"
      : "parent_revision_conflict",
    `Page ${request.operation.pageId} ${kind} revision changed`,
    request,
    { expectedRevision: expected, actualRevision: actual },
  );
};

const lifecycleTransition = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation:
      | Extract<PageLifecycleOperation, { readonly kind: "archive_page" }>
      | Extract<PageLifecycleOperation, { readonly kind: "unarchive_page" }>;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  const expectedLifecycle =
    request.operation.kind === "archive_page" ? "active" : "archived";
  const targetLifecycle =
    request.operation.kind === "archive_page" ? "archived" : "active";
  if (block.lifecycle !== expectedLifecycle) {
    return reject(
      "page_lifecycle_conflict",
      `Page ${block.id} is ${block.lifecycle}; ${request.operation.kind} requires ${expectedLifecycle}`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const nextMetadataRevision = block.metadata_revision + 1;
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = ?, metadata_revision = ?, updated_at = ?
      WHERE id = ? AND lifecycle = ?
        AND metadata_revision = ?
    `,
    )
    .run(
      targetLifecycle,
      nextMetadataRevision,
      now,
      block.id,
      expectedLifecycle,
      block.metadata_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Page ${block.id} changed during lifecycle transition`);
  }
  return makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: targetLifecycle,
      metadata_revision: nextMetadataRevision,
    },
    document,
    membership,
    operation: request.operation.kind,
    expectedRevisions: { blockMetadata: block.metadata_revision },
    committedRevisions: { blockMetadata: nextMetadataRevision },
  });
};

const readActiveMembership = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): MembershipRow | null =>
  (database
    .prepare(
      `
      SELECT id, database_block_id, revision, removed_at
      FROM database_memberships
      WHERE page_block_id = ? AND removed_at IS NULL
      LIMIT 1
    `,
    )
    .get(request.operation.pageId) as
    MembershipRow | undefined) ?? null;

const readPrimaryViewForMembership = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  membership: MembershipRow | null,
): Readonly<{
  viewId: string | null;
  position: null | Readonly<{
    groupKey: string | null;
    rankKey: string;
  }>;
}> => {
  if (!membership) return { viewId: null, position: null };
  const row = database
    .prepare(
      `
      SELECT view.id AS view_id, position.view_id AS position_view_id,
        position.group_key, position.rank_key
      FROM database_views view
      LEFT JOIN database_view_positions position
        ON position.view_id = view.id
       AND position.block_id = ?
       AND position.project_id = view.project_id
      WHERE view.database_block_id = ?
        AND view.is_primary = 1 AND view.lifecycle = 'active'
        AND view.kind = 'kanban'
      LIMIT 1
    `,
    )
    .get(
      request.operation.pageId,
      membership.database_block_id,
    ) as
    {
      readonly view_id: string;
      readonly position_view_id: string | null;
      readonly group_key: string | null;
      readonly rank_key: string | null;
    } | undefined;
  if (!row) return { viewId: null, position: null };
  if (row.position_view_id === null) {
    return { viewId: row.view_id, position: null };
  }
  if (row.position_view_id !== row.view_id || row.rank_key === null) {
    throw new Error(
      `Page ${request.operation.pageId} has an incomplete primary View position`,
    );
  }
  return {
    viewId: row.view_id,
    position: {
      groupKey: row.group_key,
      rankKey: row.rank_key,
    },
  };
};

const readMembershipStatus = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  membership: MembershipRow | null,
): WorkflowStatus | null => {
  if (!membership) return null;
  const row = database
    .prepare(
      `
      SELECT value.value_json
      FROM database_property_values value
      INNER JOIN database_properties property
        ON property.id = value.property_id
       AND property.database_block_id = value.database_block_id
       AND property.project_id = value.project_id
       AND property.key = 'status'
       AND property.value_type = 'select'
       AND property.lifecycle = 'active'
      WHERE value.membership_id = ? AND value.database_block_id = ?
    `,
    )
    .get(membership.id, membership.database_block_id) as
    { readonly value_json: string } | undefined;
  let parsed: unknown;
  try {
    parsed = row ? JSON.parse(row.value_json) : undefined;
  } catch {
    parsed = undefined;
  }
  if (isWorkflowStatus(parsed)) return parsed;
  return reject(
    "database_schema_invalid",
    `Membership ${membership.id} has no valid status property`,
    request,
  );
};

const readPlacementRank = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): string | null =>
  (
    database
      .prepare(
        `
        SELECT rank_key
        FROM top_level_block_placements
        WHERE block_id = ?
      `,
      )
      .get(request.operation.pageId) as
      { readonly rank_key: string } | undefined
  )?.rank_key ?? null;

const makeExistingCommit = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  input: {
    readonly block: BlockRow;
    readonly document: OwnedDocumentRow;
    readonly membership: MembershipRow | null;
    readonly operation: PageLifecycleOperation["kind"];
    readonly expectedRevisions: Readonly<Record<string, number>>;
    readonly committedRevisions: Readonly<Record<string, number>>;
    readonly libraryRankKey?: string | null;
    readonly viewId?: string | null;
    readonly viewRankKey?: string | null;
    readonly changePayload?: Readonly<Record<string, unknown>>;
  },
): AuthorityCommit => {
  const primaryView = readPrimaryViewForMembership(
    database,
    request,
    input.membership,
  );
  const libraryRankKey =
    input.libraryRankKey === undefined
      ? readPlacementRank(database, request)
      : input.libraryRankKey;
  const viewId =
    input.viewId === undefined
      ? primaryView.position === null
        ? null
        : primaryView.viewId
      : input.viewId;
  const viewRankKey =
    input.viewRankKey === undefined
      ? primaryView.position?.rankKey ?? null
      : input.viewRankKey;
  return {
    pageId: input.block.id,
    lifecycle: input.block.lifecycle,
    metadataRevision: input.block.metadata_revision,
    parentRevision: input.block.location_revision,
    documentId: input.document.document_id,
    documentGeneration: input.document.generation,
    documentHeadSeq: input.document.head_seq,
    databaseId: input.membership?.database_block_id ?? null,
    membershipId: input.membership?.id ?? null,
    viewId,
    libraryRankKey,
    viewRankKey,
    createdBlockIds: [],
    targetBlockIds: uniqueSorted([
      input.block.id,
      ...(input.membership ? [input.membership.database_block_id] : []),
    ]),
    affectedDatabaseBlockIds: input.membership
      ? [input.membership.database_block_id]
      : [],
    fieldIntents: [
      {
        path: `blocks.${input.block.id}`,
        operation: input.operation,
      },
    ],
    expectedRevisions: input.expectedRevisions,
    committedRevisions: input.committedRevisions,
    changePayload: {
      operation: input.operation,
      pageId: input.block.id,
      lifecycle: input.block.lifecycle,
      metadataRevision: input.block.metadata_revision,
      parentRevision: input.block.location_revision,
      libraryRankKey,
      viewRankKey,
      ...(input.changePayload ?? {}),
    },
  };
};

interface IndexedLifecycleTransition {
  readonly id: string;
  readonly expectedMetadataRevision: number;
  readonly committedMetadataRevision: number;
}

const indexedBlockMetadataRevisionKey = (blockId: string): string =>
  `indexedBlockMetadata:${blockId}`;

const withIndexedLifecycleEvidence = (
  commit: AuthorityCommit,
  input: {
    readonly indexedBlockIds: readonly string[];
    readonly indexedDocumentIds: readonly string[];
    readonly transitions: readonly IndexedLifecycleTransition[];
    readonly operation: "delete" | "restore";
    readonly payloadKey: "tombstonedBlockIds" | "restoredBlockIds";
  },
): AuthorityCommit => ({
  ...commit,
  targetBlockIds: uniqueSorted([
    ...commit.targetBlockIds,
    ...input.indexedBlockIds,
  ]),
  fieldIntents: [
    ...commit.fieldIntents,
    ...input.transitions.map((transition) => ({
      path: `blocks.${transition.id}.lifecycle`,
      operation: input.operation,
    })),
  ],
  expectedRevisions: {
    ...commit.expectedRevisions,
    ...Object.fromEntries(
      input.transitions.map((transition) => [
        indexedBlockMetadataRevisionKey(transition.id),
        transition.expectedMetadataRevision,
      ]),
    ),
  },
  committedRevisions: {
    ...commit.committedRevisions,
    ...Object.fromEntries(
      input.transitions.map((transition) => [
        indexedBlockMetadataRevisionKey(transition.id),
        transition.committedMetadataRevision,
      ]),
    ),
  },
  changePayload: {
    ...commit.changePayload,
    indexedDocumentIds: input.indexedDocumentIds,
    [input.payloadKey]: input.indexedBlockIds,
  },
});

const deletePage = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: Extract<
      PageLifecycleOperation,
      { readonly kind: "delete_page" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (block.lifecycle === "deleted") {
    return reject(
      "page_lifecycle_conflict",
      `Page ${block.id} is already deleted`,
      request,
    );
  }
  if (block.location_kind === "document") {
    return reject(
      "page_parent_invalid",
      `Nested Page ${block.id} must be removed through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  requireRevision(
    request,
    request.operation.expectedParentRevision,
    block.location_revision,
    "parent",
  );
  const document = readOwnedDocument(database, request);
  const indexedClosure = readCurrentIndexedBlockClosure(
    database,
    request,
    block,
  );
  const indexedContentBlocks = indexedClosure.blocks.filter(
    (candidate) => candidate.id !== block.id,
  );
  const nonActiveContentBlock = indexedContentBlocks.find(
    (candidate) => candidate.lifecycle !== "active",
  );
  if (nonActiveContentBlock) {
    return reject(
      "document_state_corrupt",
      `Current indexed Block ${nonActiveContentBlock.id} is ${nonActiveContentBlock.lifecycle}, not active`,
      request,
    );
  }
  const membership = readActiveMembership(database, request);
  if (
    (block.location_kind === "database" &&
      membership?.database_block_id !== block.containing_database_id) ||
    (block.location_kind === "space" && membership !== null)
  ) {
    return reject(
      "database_schema_invalid",
      `Page ${block.id} parent and active membership disagree`,
      request,
    );
  }
  const primaryView = readPrimaryViewForMembership(
    database,
    request,
    membership,
  );
  const previousStatus = readMembershipStatus(database, request, membership);
  const libraryRankKey =
    block.location_kind === "space"
      ? readPlacementRank(database, request)
      : null;
  if (block.location_kind === "space" && !libraryRankKey) {
    return reject(
      "database_schema_invalid",
      `Library Page ${block.id} is missing its top-level placement`,
      request,
    );
  }
  if (membership && !primaryView.viewId) {
    return reject(
      "database_schema_invalid",
      `Page ${block.id} membership has no active primary Kanban View`,
      request,
    );
  }
  if (
    primaryView.position &&
    primaryView.position.groupKey !== previousStatus
  ) {
    return reject(
      "database_schema_invalid",
      `Page ${block.id} status and primary View group disagree`,
      request,
    );
  }
  database
    .prepare(
      "DELETE FROM database_view_positions WHERE block_id = ?",
    )
    .run(block.id);
  if (membership) {
    const removedMembership = database
      .prepare(
        `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE id = ? AND removed_at IS NULL AND revision = ?
      `,
      )
      .run(now, membership.id, membership.revision);
    if (removedMembership.changes !== 1) {
      throw new Error(
        `Membership ${membership.id} changed during Page deletion`,
      );
    }
  }
  database
    .prepare(
      "DELETE FROM top_level_block_placements WHERE block_id = ?",
    )
    .run(block.id);
  const metadataRevision = block.metadata_revision + 1;
  const parentRevision = block.location_revision + 1;
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = 'deleted', metadata_revision = ?, location_revision = ?,
          updated_at = ?
      WHERE id = ? AND lifecycle = ?
        AND metadata_revision = ? AND location_revision = ?
    `,
    )
    .run(
      metadataRevision,
      parentRevision,
      now,
      block.id,
      block.lifecycle,
      block.metadata_revision,
      block.location_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Page ${block.id} changed during deletion`);
  }
  const tombstoneContentBlock = database.prepare(
    `
    UPDATE blocks
    SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ? AND lifecycle = 'active'
      AND metadata_revision = ?
  `,
  );
  const contentTransitions = indexedContentBlocks.map((contentBlock) => {
    const tombstoned = tombstoneContentBlock.run(
      now,
      contentBlock.id,
      contentBlock.metadataRevision,
    );
    if (tombstoned.changes !== 1) {
      throw new Error(
        `Indexed Block ${contentBlock.id} changed during Page deletion`,
      );
    }
    return {
      id: contentBlock.id,
      expectedMetadataRevision: contentBlock.metadataRevision,
      committedMetadataRevision: contentBlock.metadataRevision + 1,
    };
  });
  const commit = makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: "deleted",
      metadata_revision: metadataRevision,
      location_revision: parentRevision,
    },
    document,
    membership:
      membership === null
        ? null
        : {
            ...membership,
            revision: membership.revision + 1,
            removed_at: now,
          },
    operation: "delete_page",
    expectedRevisions: {
      blockMetadata: block.metadata_revision,
      blockLocation: block.location_revision,
      ...(membership === null ? {} : { membership: membership.revision }),
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: parentRevision,
      ...(membership === null ? {} : { membership: membership.revision + 1 }),
    },
    libraryRankKey: null,
    viewId: primaryView.position ? primaryView.viewId : null,
    viewRankKey: null,
    changePayload: {
      previousLifecycle: block.lifecycle,
      removedMembershipId: membership?.id ?? null,
      removedDatabaseBlockId: membership?.database_block_id ?? null,
      removedViewId: primaryView.position ? primaryView.viewId : null,
      previousStatus,
      previousTopLevelRankKey: libraryRankKey,
      previousViewRankKey: primaryView.position?.rankKey ?? null,
    },
  });
  return withIndexedLifecycleEvidence(commit, {
    indexedBlockIds: indexedClosure.blocks.map((candidate) => candidate.id),
    indexedDocumentIds: indexedClosure.documentIds,
    transitions: contentTransitions,
    operation: "delete",
    payloadKey: "tombstonedBlockIds",
  });
};

const parseStringArray = (value: string): readonly string[] | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string") &&
      new Set(parsed).size === parsed.length
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const readCanonicalStringArray = (value: unknown): readonly string[] | null => {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    return null;
  }
  const sorted = uniqueSorted(value);
  if (
    sorted.length !== value.length ||
    sorted.some((entry, index) => entry !== value[index])
  ) {
    return null;
  }
  return value;
};

const sameStringArray = (
  left: readonly string[] | null,
  right: readonly string[],
): boolean =>
  left?.length === right.length &&
  left.every((entry, index) => entry === right[index]);

const parseRevisionRecord = (
  value: string,
): Readonly<Record<string, number>> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const entries = Object.entries(parsed);
    if (
      entries.every(
        ([key, revision]) =>
          key.length > 0 &&
          typeof revision === "number" &&
          Number.isSafeInteger(revision) &&
          revision >= 0,
      )
    ) {
      return Object.fromEntries(entries) as Readonly<Record<string, number>>;
    }
  } catch {
    return null;
  }
  return null;
};

const readDeleteEvidence = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: RestorePageOperation;
  },
  block: BlockRow,
  document: OwnedDocumentRow,
): DeleteEvidence => {
  const row = database
    .prepare(
      `
      SELECT
        mutation.project_id, mutation.store_epoch, mutation.mutation_kind,
        mutation.request_hash, mutation.target_block_ids_json,
        mutation.affected_document_ids_json,
        mutation.affected_database_block_ids_json,
        mutation.expected_revisions_json, mutation.committed_revisions_json,
        mutation.outcome, mutation.result_json, mutation.change_log_seq,
        change.project_id AS change_project_id,
        change.store_epoch AS change_store_epoch,
        change.kind AS change_kind,
        change.operation_id AS change_operation_id,
        change.block_ids_json AS change_block_ids_json,
        change.document_ids_json AS change_document_ids_json,
        change.database_block_ids_json AS change_database_block_ids_json,
        change.payload_json AS change_payload_json
      FROM block_mutations mutation
      INNER JOIN change_log change ON change.seq = mutation.change_log_seq
      WHERE mutation.mutation_id = ?
    `,
    )
    .get(request.operation.deleteOperationId) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly mutation_kind: string;
        readonly request_hash: string;
        readonly target_block_ids_json: string;
        readonly affected_document_ids_json: string;
        readonly affected_database_block_ids_json: string;
        readonly expected_revisions_json: string;
        readonly committed_revisions_json: string;
        readonly outcome: string;
        readonly result_json: string;
        readonly change_log_seq: number;
        readonly change_project_id: string;
        readonly change_store_epoch: string;
        readonly change_kind: string;
        readonly change_operation_id: string | null;
        readonly change_block_ids_json: string;
        readonly change_document_ids_json: string;
        readonly change_database_block_ids_json: string;
        readonly change_payload_json: string;
      }
    | undefined;
  if (!row) {
    return reject(
      "delete_evidence_invalid",
      `Committed delete evidence does not exist: ${request.operation.deleteOperationId}`,
      request,
    );
  }
  if (
    row.project_id !== request.projectId ||
    row.mutation_kind !== MUTATION_KIND ||
    row.outcome !== "committed" ||
    row.change_project_id !== row.project_id ||
    row.change_store_epoch !== row.store_epoch ||
    row.change_kind !== "block_mutation" ||
    row.change_operation_id !== request.operation.deleteOperationId ||
    row.change_block_ids_json !== row.target_block_ids_json ||
    row.change_document_ids_json !== row.affected_document_ids_json ||
    row.change_database_block_ids_json !== row.affected_database_block_ids_json
  ) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} has divergent ledger identity`,
      request,
    );
  }
  let storedResult: PageLifecycleMutationCommandResult;
  let payload: Readonly<Record<string, unknown>>;
  try {
    storedResult = parsePageLifecycleMutationCommandResult(
      JSON.parse(row.result_json),
    );
    const parsedPayload = JSON.parse(row.change_payload_json) as unknown;
    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      throw new TypeError("change payload is not an object");
    }
    payload = parsedPayload as Readonly<Record<string, unknown>>;
  } catch (error) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is corrupt: ${error instanceof Error ? error.message : String(error)}`,
      request,
    );
  }
  const targetBlockIds = parseStringArray(row.target_block_ids_json);
  const documentIds = parseStringArray(row.affected_document_ids_json);
  const databaseIds = parseStringArray(
    row.affected_database_block_ids_json,
  );
  const expectedRevisions = parseRevisionRecord(row.expected_revisions_json);
  const committedRevisions = parseRevisionRecord(
    row.committed_revisions_json,
  );
  const tombstonedBlockIds = readCanonicalStringArray(
    payload.tombstonedBlockIds,
  );
  const indexedDocumentIds = readCanonicalStringArray(
    payload.indexedDocumentIds,
  );
  if (!storedResult.ok) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is not a committed receipt`,
      request,
    );
  }
  const receipt = storedResult.value;
  const previousLifecycle = payload.previousLifecycle;
  const removedMembershipId = payload.removedMembershipId;
  const removedDatabaseBlockId = payload.removedDatabaseBlockId;
  const removedViewId = payload.removedViewId;
  const previousStatus = payload.previousStatus;
  const currentClosure = readCurrentIndexedBlockClosure(
    database,
    request,
    block,
  );
  const currentBlockIds = currentClosure.blocks.map((candidate) => candidate.id);
  const currentContentBlocks = currentClosure.blocks.filter(
    (candidate) => candidate.id !== block.id,
  );
  const indexedRevisionKeys = currentContentBlocks.map((candidate) =>
    indexedBlockMetadataRevisionKey(candidate.id),
  );
  const storedExpectedIndexedKeys = Object.keys(expectedRevisions ?? {})
    .filter((key) => key.startsWith("indexedBlockMetadata:"))
    .sort((left, right) => left.localeCompare(right));
  const storedCommittedIndexedKeys = Object.keys(committedRevisions ?? {})
    .filter((key) => key.startsWith("indexedBlockMetadata:"))
    .sort((left, right) => left.localeCompare(right));
  const expectedTargetBlockIds = uniqueSorted([
    ...currentBlockIds,
    ...(typeof removedDatabaseBlockId === "string"
      ? [removedDatabaseBlockId]
      : []),
  ]);
  const contentTombstonesMatch = currentContentBlocks.every((candidate) => {
    const key = indexedBlockMetadataRevisionKey(candidate.id);
    const expected = expectedRevisions?.[key];
    const committed = committedRevisions?.[key];
    return (
      candidate.lifecycle === "deleted" &&
      typeof expected === "number" &&
      committed === expected + 1 &&
      candidate.metadataRevision === committed
    );
  });
  const evidenceMatches =
    sameStringArray(targetBlockIds, expectedTargetBlockIds) &&
    sameStringArray(tombstonedBlockIds, currentBlockIds) &&
    sameStringArray(indexedDocumentIds, currentClosure.documentIds) &&
    sameStringArray(storedExpectedIndexedKeys, indexedRevisionKeys) &&
    sameStringArray(storedCommittedIndexedKeys, indexedRevisionKeys) &&
    contentTombstonesMatch &&
    documentIds?.length === 1 &&
    documentIds[0] === document.document_id &&
    databaseIds !== null &&
    expectedRevisions !== null &&
    committedRevisions !== null &&
    expectedRevisions.blockMetadata === receipt.metadataRevision - 1 &&
    committedRevisions.blockMetadata === receipt.metadataRevision &&
    expectedRevisions.blockLocation === receipt.parentRevision - 1 &&
    committedRevisions.blockLocation === receipt.parentRevision &&
    payload.mutationKind === MUTATION_KIND &&
    payload.requestHash === row.request_hash &&
    payload.operation === "delete_page" &&
    payload.pageId === block.id &&
    (previousLifecycle === "active" || previousLifecycle === "archived") &&
    (removedMembershipId === null || typeof removedMembershipId === "string") &&
    (removedDatabaseBlockId === null ||
      typeof removedDatabaseBlockId === "string") &&
    (removedViewId === null || typeof removedViewId === "string") &&
    (previousStatus === null || isWorkflowStatus(previousStatus)) &&
    receipt.operationId === request.operation.deleteOperationId &&
    receipt.operationKind === "delete_page" &&
    receipt.projectId === request.projectId &&
    receipt.pageId === block.id &&
    receipt.lifecycle === "deleted" &&
    receipt.metadataRevision === block.metadata_revision &&
    receipt.parentRevision === block.location_revision &&
    receipt.documentId === document.document_id &&
    receipt.documentGeneration === document.generation &&
    receipt.documentHeadSeq === document.head_seq &&
    receipt.membershipId === removedMembershipId &&
    receipt.databaseId === removedDatabaseBlockId &&
    receipt.viewId === removedViewId &&
    receipt.libraryRankKey === null &&
    receipt.viewRankKey === null &&
    receipt.changeLogSeq === row.change_log_seq &&
    ((removedMembershipId === null &&
      removedDatabaseBlockId === null &&
      removedViewId === null &&
      previousStatus === null &&
      databaseIds.length === 0) ||
      (typeof removedMembershipId === "string" &&
        typeof removedDatabaseBlockId === "string" &&
        (removedViewId === null || typeof removedViewId === "string") &&
        isWorkflowStatus(previousStatus) &&
        databaseIds.length === 1 &&
        databaseIds[0] === removedDatabaseBlockId));
  if (!evidenceMatches) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} does not name the current Page tombstone`,
      request,
    );
  }
  return {
    previousLifecycle,
    databaseId: removedDatabaseBlockId,
    membershipId: removedMembershipId,
    viewId: removedViewId,
    status: previousStatus as WorkflowStatus | null,
    metadataRevision: receipt.metadataRevision,
    parentRevision: receipt.parentRevision,
    tombstonedBlocks: currentClosure.blocks,
    indexedDocumentIds: currentClosure.documentIds,
  };
};

const readRemovedMembership = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
): MembershipRow => {
  const row = database
    .prepare(
      `
      SELECT id, database_block_id, revision, removed_at
      FROM database_memberships
      WHERE id = ? AND database_block_id = ? AND page_block_id = ?
        AND removed_at IS NOT NULL
    `,
    )
    .get(
      request.operation.membership.membershipId,
      request.operation.membership.databaseId,
      request.operation.pageId,
    ) as MembershipRow | undefined;
  if (row) return row;
  return reject(
    "membership_not_found",
    `Removed membership ${request.operation.membership.membershipId} is not restorable for Page ${request.operation.pageId}`,
    request,
  );
};

const assertRestoreDatabase = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
): ReadonlyMap<
  keyof typeof REQUIRED_DATABASE_PROPERTIES,
  DatabasePropertyRow
> => {
  const expectedDataSourceId = initialDataSourceId(
    request.operation.membership.databaseId,
  );
  if (request.operation.membership.dataSourceId !== expectedDataSourceId) {
    return reject(
      "database_schema_invalid",
      `Restore Data Source ${request.operation.membership.dataSourceId} does not belong to Database ${request.operation.membership.databaseId}`,
      request,
    );
  }
  const row = database
    .prepare(
      `
      SELECT view.config_json
      FROM database_views view
      INNER JOIN database_capabilities capability
        ON capability.block_id = view.database_block_id
       AND capability.project_id = view.project_id
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
       AND database_block.project_id = capability.project_id
       AND database_block.type = 'database'
       AND database_block.lifecycle = 'active'
      WHERE view.database_block_id = ?
        AND view.lifecycle = 'active' AND view.is_primary = 1
        AND view.kind = 'kanban'
        AND (? IS NULL OR view.id = ?)
    `,
    )
    .get(
      request.operation.membership.databaseId,
      request.operation.membership.position?.viewId ?? null,
      request.operation.membership.position?.viewId ?? null,
    ) as { readonly config_json: string } | undefined;
  if (!row) {
    return reject(
      "view_not_found",
      request.operation.membership.position
        ? `Restore View ${request.operation.membership.position.viewId} is not an active primary Kanban View`
        : `Restore Database ${request.operation.membership.databaseId} has no active primary Kanban View`,
      request,
    );
  }
  return readRequiredDatabaseProperties(
    database,
    request,
    request.operation.membership.databaseId,
    row.config_json,
  );
};

const assertCompleteMembershipValues = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
  properties: ReadonlyMap<
    keyof typeof REQUIRED_DATABASE_PROPERTIES,
    DatabasePropertyRow
  >,
): void => {
  const rows = database
    .prepare(
      `
      SELECT property_id, value_type
      FROM database_property_values
      WHERE membership_id = ? AND database_block_id = ?
    `,
    )
    .all(
      request.operation.membership.membershipId,
      request.operation.membership.databaseId,
    ) as Array<{ readonly property_id: string; readonly value_type: string }>;
  const values = new Map(rows.map((row) => [row.property_id, row.value_type]));
  const missing = [...properties.values()].filter(
    (property) => values.get(property.id) !== property.value_type,
  );
  if (missing.length === 0) return;
  reject(
    "database_schema_invalid",
    `Removed membership ${request.operation.membership.membershipId} lacks complete Page property values`,
    request,
  );
};

const restorePage = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: RestorePageOperation;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (block.lifecycle !== "deleted") {
    return reject(
      "page_lifecycle_conflict",
      `Page ${block.id} is ${block.lifecycle}; restore requires deleted`,
      request,
    );
  }
  if (block.location_kind === "document") {
    return reject(
      "page_parent_invalid",
      `Deleted nested Page ${block.id} must be restored through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  requireRevision(
    request,
    request.operation.expectedParentRevision,
    block.location_revision,
    "parent",
  );
  const document = readOwnedDocument(database, request);
  const deleteEvidence = readDeleteEvidence(database, request, block, document);
  if (readActiveMembership(database, request)) {
    return reject(
      "page_lifecycle_conflict",
      `Deleted Page ${block.id} unexpectedly has an active membership`,
      request,
    );
  }
  const restoreMembership =
    request.operation.membership === null
      ? null
      : (request as PageLifecycleMutationRequest & {
          readonly operation: RestoreWithMembershipOperation;
        });
  const requestedMembership = restoreMembership?.operation.membership ?? null;
  const restoresDatabaseParent = requestedMembership !== null;
  if (
    (restoresDatabaseParent && block.location_kind !== "database") ||
    (!restoresDatabaseParent && block.location_kind !== "space")
  ) {
    return reject(
      "delete_evidence_invalid",
      `Restore parent does not match deleted Page ${block.id} location`,
      request,
    );
  }
  const topLevelRank = restoresDatabaseParent
    ? null
    : allocateTopLevelRank(
        database,
        request,
        request.operation.beforeBlockId,
      );
  const evidenceMembershipMatches =
    (deleteEvidence.membershipId === null && requestedMembership === null) ||
    (requestedMembership !== null &&
      requestedMembership.membershipId === deleteEvidence.membershipId &&
      requestedMembership.databaseId === deleteEvidence.databaseId &&
      (requestedMembership.position?.viewId ?? null) ===
        deleteEvidence.viewId &&
      requestedMembership.status === deleteEvidence.status);
  if (!evidenceMembershipMatches) {
    return reject(
      "delete_evidence_invalid",
      `Restore membership does not match delete ${request.operation.deleteOperationId}`,
      request,
    );
  }
  const membership = restoreMembership
    ? readRemovedMembership(database, restoreMembership)
    : null;
  const properties = restoreMembership
    ? assertRestoreDatabase(database, restoreMembership)
    : null;
  if (restoreMembership && properties) {
    assertCompleteMembershipValues(database, restoreMembership, properties);
    const persistedStatus = readMembershipStatus(
      database,
      restoreMembership,
      membership,
    );
    const statusProperty = properties.get("status");
    if (!statusProperty) {
      throw new Error("Validated Page Database lost its status property");
    }
    let normalizedStatus: DatabaseJsonValue;
    try {
      normalizedStatus = normalizeDatabasePropertyValue(
        {
          valueType: statusProperty.value_type,
          config: statusProperty.config,
        },
        persistedStatus,
      );
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Removed membership status violates the current Database schema: ${error instanceof Error ? error.message : String(error)}`,
        request,
      );
    }
    if (persistedStatus !== restoreMembership.operation.membership.status) {
      return reject(
        "delete_evidence_invalid",
        `Removed membership ${restoreMembership.operation.membership.membershipId} changed status after delete`,
        request,
      );
    }
    if (normalizedStatus !== persistedStatus) {
      return reject(
        "database_schema_invalid",
        "Removed membership status normalized to a different value",
        request,
      );
    }
  }
  const restorePosition = restoreMembership?.operation.membership.position;
  const viewRank = restoreMembership && restorePosition
    ? allocateViewRank(database, request, {
        viewId: restorePosition.viewId,
        status: restoreMembership.operation.membership.status,
        beforeViewPageId: restorePosition.beforeViewPageId,
      })
    : null;
  const metadataRevision = block.metadata_revision + 1;
  const parentRevision = block.location_revision + 1;
  const updatedBlock = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = ?, metadata_revision = ?, location_revision = ?,
          updated_at = ?
      WHERE id = ? AND lifecycle = 'deleted'
        AND metadata_revision = ? AND location_revision = ?
    `,
    )
    .run(
      deleteEvidence.previousLifecycle,
      metadataRevision,
      parentRevision,
      now,
      block.id,
      block.metadata_revision,
      block.location_revision,
    );
  if (updatedBlock.changes !== 1) {
    throw new Error(`Page ${block.id} changed during restore`);
  }
  const restoreContentBlock = database.prepare(
    `
    UPDATE blocks
    SET lifecycle = 'active', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ? AND lifecycle = 'deleted'
      AND metadata_revision = ?
  `,
  );
  const contentTransitions = deleteEvidence.tombstonedBlocks
    .filter((candidate) => candidate.id !== block.id)
    .map((contentBlock) => {
      const restored = restoreContentBlock.run(
        now,
        contentBlock.id,
        contentBlock.metadataRevision,
      );
      if (restored.changes !== 1) {
        throw new Error(
          `Indexed Block ${contentBlock.id} changed during Page restore`,
        );
      }
      return {
        id: contentBlock.id,
        expectedMetadataRevision: contentBlock.metadataRevision,
        committedMetadataRevision: contentBlock.metadataRevision + 1,
      };
    });
  if (topLevelRank) {
    database
      .prepare(
        `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(block.id, block.project_id, topLevelRank.rankKey, now, now);
  }
  const membershipRevision = membership ? membership.revision + 1 : null;
  if (restoreMembership && membership && properties) {
    const restoredMembership = database
      .prepare(
        `
        UPDATE database_memberships
        SET removed_at = NULL, revision = ?
        WHERE id = ? AND removed_at IS NOT NULL
          AND revision = ?
      `,
      )
      .run(
        membershipRevision,
        membership.id,
        membership.revision,
      );
    if (restoredMembership.changes !== 1) {
      throw new Error(
        `Membership ${membership.id} changed during Page restore`,
      );
    }
    if (viewRank && restorePosition) {
      database
        .prepare(
          `
        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `,
        )
        .run(
          restorePosition.viewId,
          block.id,
          block.project_id,
          restoreMembership.operation.membership.status,
          viewRank.rankKey,
          now,
          now,
        );
    }
  }
  const commit = makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: deleteEvidence.previousLifecycle,
      metadata_revision: metadataRevision,
      location_revision: parentRevision,
    },
    document,
    membership:
      membership === null || membershipRevision === null
        ? null
        : { ...membership, revision: membershipRevision, removed_at: null },
    operation: "restore_page",
    expectedRevisions: {
      blockMetadata: block.metadata_revision,
      blockLocation: block.location_revision,
      ...(membership === null ? {} : { membership: membership.revision }),
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: parentRevision,
      ...(membershipRevision === null
        ? {}
        : {
            membership: membershipRevision,
            ...(viewRank ? { viewPosition: 1 } : {}),
          }),
    },
    libraryRankKey: topLevelRank?.rankKey ?? null,
    viewId: restorePosition?.viewId ?? null,
    viewRankKey: viewRank?.rankKey ?? null,
    changePayload: {
      restoredMembershipId: membership?.id ?? null,
      deleteOperationId: request.operation.deleteOperationId,
      restoredLifecycle: deleteEvidence.previousLifecycle,
      status: restoreMembership?.operation.membership.status ?? null,
      rebalancedTopLevelPlacements: topLevelRank?.rebalanced ?? [],
      rebalancedViewPositions: viewRank?.rebalanced ?? 0,
    },
  });
  return withIndexedLifecycleEvidence(commit, {
    indexedBlockIds: deleteEvidence.tombstonedBlocks.map(
      (candidate) => candidate.id,
    ),
    indexedDocumentIds: deleteEvidence.indexedDocumentIds,
    transitions: contentTransitions,
    operation: "restore",
    payloadKey: "restoredBlockIds",
  });
};

const movePageInLibrary = (
  database: Database.Database,
  request: PageLifecycleMutationRequest & {
    readonly operation: Extract<
      PageLifecycleOperation,
      { readonly kind: "move_page_in_library" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (
    block.lifecycle === "deleted" ||
    block.location_kind !== "space" ||
    block.containing_document_id !== null ||
    readPlacementRank(database, request) === null
  ) {
    return reject(
      "page_parent_invalid",
      `Page ${block.id} is not a placed non-deleted Library Page`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedParentRevision,
    block.location_revision,
    "parent",
  );
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const rank = allocateTopLevelRank(
    database,
    request,
    request.operation.beforeBlockId,
  );
  const parentRevision = block.location_revision + 1;
  database
    .prepare(
      `
      UPDATE top_level_block_placements
      SET rank_key = ?, updated_at = ?
      WHERE block_id = ? AND project_id = ?
    `,
    )
    .run(rank.rankKey, now, block.id, request.projectId);
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET location_revision = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND location_revision = ?
    `,
    )
    .run(
      parentRevision,
      now,
      block.id,
      request.projectId,
      block.location_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Page ${block.id} changed during top-level move`);
  }
  return makeExistingCommit(database, request, {
    block: { ...block, location_revision: parentRevision },
    document,
    membership,
    operation: "move_page_in_library",
    expectedRevisions: { blockLocation: block.location_revision },
    committedRevisions: { blockLocation: parentRevision },
    libraryRankKey: rank.rankKey,
    changePayload: { rebalancedTopLevelPlacements: rank.rebalanced },
  });
};

const executeAuthority = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  now: string,
  options: ApplyPageLifecycleMutationOptions,
): AuthorityCommit => {
  switch (request.operation.kind) {
    case "create_page":
      return createPage(
        database,
        request as PageLifecycleMutationRequest & {
          readonly operation: CreatePageOperation;
        },
        now,
        options,
      );
    case "archive_page":
    case "unarchive_page":
      return lifecycleTransition(
        database,
        request as PageLifecycleMutationRequest & {
          readonly operation: Extract<
            PageLifecycleOperation,
            { readonly kind: "archive_page" | "unarchive_page" }
          >;
        },
        now,
      );
    case "delete_page":
      return deletePage(
        database,
        request as PageLifecycleMutationRequest & {
          readonly operation: Extract<
            PageLifecycleOperation,
            { readonly kind: "delete_page" }
          >;
        },
        now,
      );
    case "restore_page":
      return restorePage(
        database,
        request as PageLifecycleMutationRequest & {
          readonly operation: RestorePageOperation;
        },
        now,
      );
    case "move_page_in_library":
      return movePageInLibrary(
        database,
        request as PageLifecycleMutationRequest & {
          readonly operation: Extract<
            PageLifecycleOperation,
            { readonly kind: "move_page_in_library" }
          >;
        },
        now,
      );
  }
};

const logicalRequest = (
  request: PageLifecycleMutationRequest,
): Readonly<Record<string, unknown>> => ({
  version: PAGE_LIFECYCLE_CONTRACT_VERSION,
  projectId: request.projectId,
  operation: request.operation,
});

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Pre-v63 create receipts included Page-owned Agent fields in their canonical
 * logical request. Current authority ignores those retired fields, but replay
 * must still present the exact historical request to the immutable receipt
 * seam after proving that removing only those fields yields today's intent.
 */
const logicalRequestForReceiptMatching = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
): Readonly<Record<string, unknown>> => {
  const current = logicalRequest(request);
  if (request.operation.kind !== "create_page") return current;

  const stored = database
    .prepare(
      `SELECT request_json
       FROM block_mutations
       WHERE mutation_id = ? AND mutation_kind = ?`,
    )
    .get(request.operationId, MUTATION_KIND) as
    | { readonly request_json: string }
    | undefined;
  if (!stored) return current;

  let historical: unknown;
  try {
    historical = JSON.parse(stored.request_json) as unknown;
  } catch {
    return current;
  }
  if (!isRecord(historical) || !isRecord(historical.operation)) {
    return current;
  }
  if (historical.operation.kind !== "create_page") return current;
  if (
    !Object.hasOwn(historical.operation, "agentBlocked") &&
    !Object.hasOwn(historical.operation, "agentStatus")
  ) {
    return current;
  }

  const normalizedOperation = { ...historical.operation };
  delete normalizedOperation.agentBlocked;
  delete normalizedOperation.agentStatus;
  const normalizedHistorical = {
    ...historical,
    operation: normalizedOperation,
  };
  if (
    stableStringifyBlockPropertyJson(normalizedHistorical) !==
    stableStringifyBlockPropertyJson(current)
  ) {
    return current;
  }
  return historical;
};

const prepareOperation = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
) =>
  prepareAuthoritativeOperation(
    database,
    {
      operationId: request.operationId,
      projectId: request.projectId,
      mutationKind: MUTATION_KIND,
      logicalRequest: logicalRequestForReceiptMatching(database, request),
      actor: request.actor,
      clientSessionId: request.clientSessionId,
    },
    parsePageLifecycleMutationCommandResult,
  );

const validateReplay = (
  request: PageLifecycleMutationRequest,
  prepared: ReturnType<typeof prepareOperation>,
): PageLifecycleMutationCommandResult | null => {
  if (prepared.kind !== "replay") return null;
  if (!prepared.result.ok) {
    if (prepared.outcome === "rejected") return prepared.result;
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Page lifecycle operation ${request.operationId} stored a rejected committed result`,
    );
  }
  const receipt = prepared.result.value;
  if (
    prepared.outcome !== "committed" ||
    receipt.operationId !== request.operationId ||
    receipt.projectId !== request.projectId ||
    receipt.storeEpoch !== request.storeEpoch ||
    receipt.operationKind !== request.operation.kind ||
    receipt.pageId !== request.operation.pageId ||
    receipt.changeLogSeq !== prepared.changeLogSeq
  ) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Page lifecycle operation ${request.operationId} stored a divergent receipt`,
    );
  }
  return { ok: true, value: { ...receipt, duplicate: true } };
};

const persistRejection = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  evidence: AuthoritativeOperationEvidence,
  error: PageLifecycleMutationCommandError,
  now: string,
): PageLifecycleMutationCommandResult => {
  const result: PageLifecycleMutationCommandResult = { ok: false, error };
  const targetExists = database
    .prepare("SELECT 1 FROM blocks WHERE id = ? AND project_id = ?")
    .get(request.operation.pageId, request.projectId);
  return persistAuthoritativeOperationRejection(database, {
    evidence,
    targetBlockIds: targetExists ? [request.operation.pageId] : [],
    fieldIntents: [
      {
        path: `blocks.${request.operation.pageId}.lifecycle`,
        operation: request.operation.kind,
      },
    ],
    rejectedAt: now,
    result,
  });
};

const refreshProjections = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  commit: AuthorityCommit,
  now: string,
): void => {
  const authority = database.prepare(`
    SELECT project_id FROM blocks WHERE id = ?
  `).get(commit.pageId) as { readonly project_id: string } | undefined;
  if (!authority) {
    throw new Error(`Page ${commit.pageId} disappeared before projection refresh`);
  }
  if (request.operation.kind === "restore_page") {
    const indexedDocumentIds = commit.changePayload.indexedDocumentIds;
    if (
      !Array.isArray(indexedDocumentIds) ||
      indexedDocumentIds.some((documentId) => typeof documentId !== "string")
    ) {
      throw new Error("Page restore is missing its indexed Document closure");
    }
    finalizePageNfmIdentityProjection(database, {
      documentIds: indexedDocumentIds,
    });
  }
  refreshScheduledPageIndexProjection(
    database,
    authority.project_id,
    [commit.pageId],
    now,
  );
  rebuildPageReadModelProjection(database, authority.project_id, [commit.pageId]);
};

const makeReceipt = (
  request: PageLifecycleMutationRequest,
  commit: AuthorityCommit,
  changeLogSeq: number,
  now: string,
): PageLifecycleMutationCommandResult => ({
  ok: true,
  value: {
    version: PAGE_LIFECYCLE_CONTRACT_VERSION,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: request.operation.kind,
    pageId: commit.pageId,
    duplicate: false,
    metadataRevision: commit.metadataRevision,
    parentRevision: commit.parentRevision,
    lifecycle: commit.lifecycle,
    documentId: commit.documentId,
    documentGeneration: commit.documentGeneration,
    documentHeadSeq: commit.documentHeadSeq,
    databaseId: commit.databaseId,
    dataSourceId: commit.databaseId
      ? initialDataSourceId(commit.databaseId)
      : null,
    membershipId: commit.membershipId,
    viewId: commit.viewId,
    libraryRankKey: commit.libraryRankKey,
    viewRankKey: commit.viewRankKey,
    createdBlockIds: commit.createdBlockIds,
    changeLogSeq,
    committedAt: now,
  },
});

/**
 * Apply one Page-as-Block identity/lifecycle/Library-placement intent.
 *
 * Its Block, owned Y.Doc, Data Source membership/properties/View position,
 * projections, change cursor, and immutable receipt share one immediate SQLite
 * transaction.
 */
export const applyPageLifecycleMutation = (
  database: Database.Database,
  rawRequest: PageLifecycleMutationRequest,
  options: ApplyPageLifecycleMutationOptions = {},
): PageLifecycleMutationCommandResult => {
  let request: PageLifecycleMutationRequest;
  try {
    request = parsePageLifecycleMutationRequest(rawRequest);
  } catch (error) {
    if (!(error instanceof PageLifecycleContractError)) throw error;
    return {
      ok: false,
      error: makeError(
        "invalid_page_lifecycle_request",
        error.message,
        isLifecycleRequestIdentity(rawRequest) ? rawRequest : undefined,
      ),
    };
  }
  const inject = (point: PageLifecycleMutationFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): PageLifecycleMutationCommandResult => {
    const currentEpoch = readBlockStoreEpoch(database);
    if (currentEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeError(
          "store_epoch_mismatch",
          `Operation belongs to store epoch ${request.storeEpoch}; current epoch is ${currentEpoch ?? "missing"}`,
          request,
        ),
      };
    }
    if (!projectExists(database, request.projectId)) {
      return {
        ok: false,
        error: makeError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }
    let prepared;
    try {
      prepared = prepareOperation(database, request);
    } catch (error) {
      if (error instanceof AuthoritativeOperationReceiptError) {
        return {
          ok: false,
          error: makeError(error.code, error.message, request),
        };
      }
      throw error;
    }
    const replay = validateReplay(request, prepared);
    if (replay) return replay;
    try {
      authorizePageLifecycleMutation(database, request);
    } catch (error) {
      if (!(error instanceof PageLifecycleRejection)) throw error;
      return persistRejection(
        database,
        request,
        prepared.evidence,
        error.error,
        options.now?.() ?? new Date().toISOString(),
      );
    }
    const now = options.now?.() ?? new Date().toISOString();
    let commit: AuthorityCommit;
    try {
      commit = database.transaction(() =>
        executeAuthority(database, request, now, options),
      )();
    } catch (error) {
      if (
        error instanceof BlockDocumentCodecError ||
        error instanceof BlockDocumentStoreError
      ) {
        return persistRejection(
          database,
          request,
          prepared.evidence,
          makeError("invalid_page_lifecycle_request", error.message, request),
          now,
        );
      }
      if (!(error instanceof PageLifecycleRejection)) throw error;
      const result = persistRejection(
        database,
        request,
        prepared.evidence,
        error.error,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return result;
    }
    inject("after_authority");
    refreshProjections(database, request, commit, now);
    inject("after_projections");
    const persisted = persistAuthoritativeOperationReceipt(database, {
      evidence: prepared.evidence,
      targetBlockIds: commit.targetBlockIds,
      affectedDocumentIds: [commit.documentId],
      affectedDatabaseBlockIds: commit.affectedDatabaseBlockIds,
      fieldIntents: commit.fieldIntents,
      expectedRevisions: commit.expectedRevisions,
      committedRevisions: commit.committedRevisions,
      documentHeads: {
        [commit.documentId]: {
          generation: commit.documentGeneration,
          headSeq: commit.documentHeadSeq,
        },
      },
      changePayload: commit.changePayload,
      committedAt: now,
      makeResult: (changeLogSeq) =>
        makeReceipt(request, commit, changeLogSeq, now),
    });
    inject("after_change_log");
    inject("after_ledger");
    inject("before_commit");
    return persisted.result;
  });
  const result = apply.immediate();
  inject("after_commit");
  return result;
};

const isLifecycleRequestIdentity = (
  value: unknown,
): value is Pick<PageLifecycleMutationRequest, "operationId" | "operation"> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const request = value as {
    readonly operationId?: unknown;
    readonly operation?: unknown;
  };
  if (typeof request.operationId !== "string") return false;
  if (
    typeof request.operation !== "object" ||
    request.operation === null ||
    Array.isArray(request.operation)
  ) {
    return false;
  }
  return (
    typeof (request.operation as { readonly pageId?: unknown }).pageId ===
    "string"
  );
};

const readLifecycleChangeLogSeq = (
  database: Database.Database,
): number => {
  const row = database
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log")
    .get() as { readonly seq: number };
  return row.seq;
};

const readMembershipCoordinate = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  membership: MembershipRow | null,
): PageLifecycleMembershipCoordinate | null => {
  if (!membership) return null;
  const row = database
    .prepare(
      `
      SELECT
        view.id AS view_id, view.revision AS view_revision,
        property.id AS status_property_id,
        value.revision AS status_value_revision, value.value_json,
        position.view_id AS position_view_id,
        position.group_key, position.rank_key,
        position.revision AS position_revision
      FROM database_views view
      INNER JOIN database_properties property
        ON property.database_block_id = view.database_block_id
       AND property.project_id = view.project_id
       AND property.key = 'status'
       AND property.lifecycle = 'active'
      INNER JOIN database_property_values value
        ON value.membership_id = ?
       AND value.database_block_id = view.database_block_id
       AND value.project_id = view.project_id
       AND value.property_id = property.id
      LEFT JOIN database_view_positions position
        ON position.view_id = view.id
       AND position.project_id = view.project_id
       AND position.block_id = ?
      WHERE view.database_block_id = ? AND view.project_id = ?
        AND view.lifecycle = 'active' AND view.is_primary = 1
      LIMIT 1
    `,
    )
    .get(
      membership.id,
      request.operation.pageId,
      membership.database_block_id,
      request.projectId,
    ) as
    | {
        readonly view_id: string;
        readonly view_revision: number;
        readonly status_property_id: string;
        readonly status_value_revision: number;
        readonly value_json: string;
        readonly position_view_id: string | null;
        readonly group_key: string | null;
        readonly rank_key: string | null;
        readonly position_revision: number | null;
      }
    | undefined;
  if (!row) {
    throw new Error(
      `Page ${request.operation.pageId} membership has no primary View/status coordinate`,
    );
  }
  const status = JSON.parse(row.value_json) as unknown;
  if (!isWorkflowStatus(status)) {
    throw new Error(
      `Page ${request.operation.pageId} membership has an invalid status value`,
    );
  }
  const hasPosition = row.position_view_id !== null;
  if (
    hasPosition &&
    (row.position_view_id !== row.view_id ||
      row.group_key !== status ||
      row.rank_key === null ||
      row.position_revision === null)
  ) {
    throw new Error(
      `Page ${request.operation.pageId} membership status and primary View position diverge`,
    );
  }
  return {
    membershipId: membership.id,
    databaseId: membership.database_block_id,
    dataSourceId: initialDataSourceId(membership.database_block_id),
    membershipRevision: membership.revision,
    viewId: row.view_id,
    viewRevision: row.view_revision,
    statusPropertyId: row.status_property_id,
    statusValueRevision: row.status_value_revision,
    status,
    position: hasPosition
      ? {
          groupKey: row.group_key,
          rankKey: row.rank_key as string,
          revision: row.position_revision as number,
        }
      : null,
  };
};

const readLatestDeleteOperationId = (
  database: Database.Database,
  projectId: string,
  storeEpoch: string,
  pageId: string,
): string | null => {
  const row = database
    .prepare(
      `
      SELECT mutation_id
      FROM block_mutations
      WHERE project_id = ? AND store_epoch = ?
        AND mutation_kind = ? AND outcome = 'committed'
        AND json_extract(request_json, '$.operation.kind') = 'delete_page'
        AND json_extract(request_json, '$.operation.pageId') = ?
      ORDER BY change_log_seq DESC
      LIMIT 1
    `,
    )
    .get(projectId, storeEpoch, MUTATION_KIND, pageId) as
    | { readonly mutation_id: string }
    | undefined;
  return row?.mutation_id ?? null;
};

const readRestoreEvidence = (
  database: Database.Database,
  request: PageLifecycleMutationRequest,
  block: BlockRow,
  document: OwnedDocumentRow,
): PageLifecycleRestoreEvidence | null => {
  if (block.lifecycle !== "deleted") return null;
  const deleteOperationId = readLatestDeleteOperationId(
    database,
    request.projectId,
    request.storeEpoch,
    block.id,
  );
  if (!deleteOperationId) {
    throw new Error(`Deleted Page ${block.id} has no committed delete receipt`);
  }
  const evidenceRequest: PageLifecycleMutationRequest = {
    ...request,
    operationId: "internal:page-lifecycle-preflight",
    operation: {
      kind: "restore_page",
      pageId: block.id,
      deleteOperationId,
      expectedMetadataRevision: block.metadata_revision,
      expectedParentRevision: block.location_revision,
      membership: null,
    },
  };
  const evidence = readDeleteEvidence(
    database,
    evidenceRequest as PageLifecycleMutationRequest & {
      readonly operation: RestorePageOperation;
    },
    block,
    document,
  );
  const membership =
    evidence.membershipId &&
    evidence.databaseId &&
    evidence.status
      ? {
          membershipId: evidence.membershipId,
          databaseId: evidence.databaseId,
          dataSourceId: initialDataSourceId(evidence.databaseId),
          status: evidence.status,
          position: evidence.viewId ? { viewId: evidence.viewId } : null,
        }
      : null;
  return {
    deleteOperationId,
    previousLifecycle: evidence.previousLifecycle,
    membership,
  };
};

const readOwnedPageAuthority = (
  database: Database.Database,
  storeEpoch: string,
  pageId: string,
): {
  readonly reservedBlockType: string | null;
  readonly page: PageLifecycleOwnedBlockAuthority | null;
} => {
  const identity = database
    .prepare(
      "SELECT type, project_id FROM blocks WHERE id = ? LIMIT 1",
    )
    .get(pageId) as
    | { readonly type: string; readonly project_id: string }
    | undefined;
  if (!identity) return { reservedBlockType: null, page: null };
  if (identity.type !== "page") {
    return { reservedBlockType: identity.type, page: null };
  }
  const page = database.prepare(`
    SELECT page.library_id, page.parent_kind, page.parent_id, page.lifecycle,
      page.parent_revision, page.metadata_revision,
      placement.rank_key AS library_rank_key
    FROM pages page
    LEFT JOIN library_block_placements placement
      ON placement.block_id = page.block_id
      AND placement.library_id = page.library_id
    WHERE page.block_id = ?
  `).get(pageId) as PageAuthorityRow | undefined;
  if (!page) throw new Error(`Page ${pageId} has no canonical ownership row`);
  const request: PageLifecycleMutationRequest = {
    version: PAGE_LIFECYCLE_CONTRACT_VERSION,
    operationId: "internal:page-lifecycle-preflight",
    projectId: identity.project_id,
    storeEpoch,
    actor: { kind: "internal_preflight" },
    operation: {
      kind: "archive_page",
      pageId,
      expectedMetadataRevision: 1,
    },
  };
  const block = readBlock(database, request);
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const membershipCoordinate = readMembershipCoordinate(
    database,
    request,
    membership,
  );
  if (
    page.lifecycle !== block.lifecycle ||
    page.parent_revision !== block.location_revision ||
    page.metadata_revision !== block.metadata_revision
  ) {
    throw new Error(`Page ${pageId} canonical and compatibility coordinates diverge`);
  }
  if (page.parent_kind === "library" && page.library_rank_key === null) {
    throw new Error(`Library Page ${pageId} has no Library placement`);
  }
  return {
    reservedBlockType: null,
    page: {
      pageId,
      lifecycle: page.lifecycle,
      parent:
        page.parent_kind === "library"
          ? { kind: "library", libraryId: page.parent_id }
          : page.parent_kind === "page"
            ? { kind: "page", pageId: page.parent_id }
            : { kind: "data_source", dataSourceId: page.parent_id },
      libraryRankKey: page.library_rank_key,
      metadataRevision: page.metadata_revision,
      parentRevision: page.parent_revision,
      document: {
        documentId: document.document_id,
        generation: document.generation,
        headSeq: document.head_seq,
        readiness: document.readiness,
        authority: document.authority,
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      },
      membership: membershipCoordinate,
      restoreEvidence: readRestoreEvidence(
        database,
        request,
        block,
        document,
      ),
    },
  };
};

const lifecycleReadFailure = (
  code: PageLifecyclePreflightErrorCode,
  message: string,
  retryable = false,
): PageLifecyclePreflightResult => ({
  ok: false,
  error: { code, message, retryable },
});

/** Read every lifecycle precondition from one SQLite transaction. */
export const readPageLifecyclePreflightSnapshot = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): PageLifecyclePreflightResult => {
  if (
    !projectId ||
    projectId !== projectId.trim() ||
    !pageId ||
    pageId !== pageId.trim() ||
    projectId.length > 512 ||
    pageId.length > 512
  ) {
    return lifecycleReadFailure(
      "invalid_request",
      "Page lifecycle preflight requires canonical Project and Page identities",
    );
  }
  try {
    return database.transaction((): PageLifecyclePreflightResult => {
      const storeEpoch = readBlockStoreEpoch(database);
      if (!storeEpoch) {
        return lifecycleReadFailure(
          "store_not_initialized",
          "Block store metadata is missing",
          true,
        );
      }
      if (!projectExists(database, projectId)) {
        return lifecycleReadFailure(
          "project_not_found",
          `Project does not exist: ${projectId}`,
        );
      }
      const project = database.prepare(`
        SELECT library_id FROM projects WHERE id = ?
      `).get(projectId) as { readonly library_id: string } | undefined;
      if (!project) {
        return lifecycleReadFailure(
          "project_not_found",
          `Project does not exist: ${projectId}`,
        );
      }
      const identity = database.prepare(`
        SELECT type FROM blocks WHERE id = ?
      `).get(pageId) as { readonly type: string } | undefined;
      if (identity?.type === "page") {
        const authorization = authorizeProjectResourceInDatabase(database, {
          projectId,
          resource: { kind: "page", pageId },
          action: "read",
        });
        if (!authorization.allowed) {
          return lifecycleReadFailure(
            "authorization_denied",
            `Page lifecycle preflight denied: ${authorization.reason}`,
          );
        }
      }
      const databaseRead = readDatabaseModule(database, {
        version: 1,
        projectId,
        read: { target: { kind: "project_default" }, mode: "query" },
      });
      if (!databaseRead.ok) {
        const code = databaseRead.error.code;
        return lifecycleReadFailure(
          code === "project_not_found"
            ? "project_not_found"
            : code === "store_not_initialized"
              ? "store_not_initialized"
              : code === "authorization_denied"
                ? "authorization_denied"
                : code === "unknown"
                  ? "unknown"
                  : "state_corrupt",
          databaseRead.error.message,
          databaseRead.error.retryable,
        );
      }
      if (databaseRead.value.value.kind !== "query") {
        return lifecycleReadFailure(
          "state_corrupt",
          "Project default Database View authority is incomplete",
        );
      }
      const authority = readOwnedPageAuthority(
        database,
        storeEpoch,
        pageId,
      );
      const value: PageLifecyclePreflight = {
        version: 1,
        defaultView: databaseRead.value.value.value,
        reservedBlockType: authority.reservedBlockType,
        page: authority.page,
      };
      return {
        ok: true,
        value: {
          version: 1,
          projectId,
          libraryId: project.library_id,
          storeEpoch,
          changeLogSeq: readLifecycleChangeLogSeq(database),
          value,
        },
      };
    })();
  } catch (error) {
    return lifecycleReadFailure(
      error instanceof PageLifecycleRejection
        ? "state_corrupt"
        : "unknown",
      error instanceof Error ? error.message : String(error),
      !(error instanceof PageLifecycleRejection),
    );
  }
};

export const verifyPageDocumentContinuity = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): Readonly<{
  documentId: string;
  generation: number;
  headSeq: number;
  title: string;
}> | null => {
  const row = database
    .prepare(
      `
      SELECT
        document.id AS document_id,
        document.generation,
        document.head_seq,
        materialization.title
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      INNER JOIN document_materializations materialization
        ON materialization.document_id = document.id
       AND materialization.generation = document.generation
       AND materialization.projected_seq = document.head_seq
       AND materialization.schema_version = document.schema_version
      WHERE ownership.block_id = ? AND ownership.project_id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
    `,
    )
    .get(pageId, projectId) as
    | {
        readonly document_id: string;
        readonly generation: number;
        readonly head_seq: number;
        readonly title: string;
      }
    | undefined;
  if (!row) return null;
  return {
    documentId: row.document_id,
    generation: row.generation,
    headSeq: row.head_seq,
    title: row.title,
  };
};
