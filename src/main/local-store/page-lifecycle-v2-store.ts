import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  BlockDocumentCodecError,
  createPageDocumentGenesis,
  type BlockTreeNode,
  type PageDocumentGenesis,
} from "../../shared/block-documents/block-document-codec";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/page-document";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  DataSourceOptionRegistryError,
  dataSourceOptionRegistryConfig,
  parseDataSourceOptionRegistry,
  putDataSourceOption,
  validateDataSourceOptionSelection,
  type DataSourceOptionRegistry,
} from "../../shared/data-source-option-registry";
import {
  databaseGroupKeyForValue,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfigV2,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  FractionalRankError,
  planFractionalRank,
  type FractionalRankedItem,
} from "../../shared/fractional-rank";
import {
  PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
  PageLifecycleV2ContractError,
  parsePageLifecycleMutationCommandResultV2,
  parsePageLifecycleMutationRequestV2,
  type CreatePageOperationV2,
  type PageLifecycleMutationCommandErrorV2,
  type PageLifecycleMutationCommandResultV2,
  type PageLifecycleMutationRequestV2,
  type PageLifecycleOperationV2,
} from "../../shared/page-lifecycle-v2";
import type {
  PageLifecycleMembershipCoordinateV2,
  PageLifecycleOwnedBlockAuthorityV2,
  PageLifecyclePreflightErrorCodeV2,
  PageLifecyclePreflightResultV2,
  PageLifecycleRestoreEvidenceV2,
} from "../../shared/page-lifecycle-v2-runtime";
import {
  parseDataSourceId,
  type DataSourceId,
} from "../../shared/database-identities";
import { isWorkflowStatus, type WorkflowStatus } from "../../shared/workflow-status";
import { isUuidV7 } from "../../shared/uuid-v7";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  persistAuthoritativeOperationRejection,
  prepareAuthoritativeOperation,
  type AuthoritativeOperationEvidence,
  type PreparedAuthoritativeOperation,
} from "./authoritative-operation-receipts";
import {
  BlockDocumentStoreError,
  initializePageDocumentGenesis,
} from "./block-document-store";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import { readDatabaseModuleV2 } from "./database-module-v2-runtime";

const CANONICAL_SCHEMA_VERSION = 84;
const MUTATION_KIND = "page_lifecycle";

const REQUIRED_PROPERTIES = {
  status: "select",
  priority: "select",
  estimate: "select",
  tags: "multi_select",
  due_date: "date",
  scheduled_start: "datetime",
  scheduled_end: "datetime",
  assignee: "person",
} as const satisfies Readonly<Record<string, DatabasePropertyValueType>>;

const INTRINSIC_PROPERTIES = {
  "run.target": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.runInTarget,
  },
  "run.localPath": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.runInLocalPath,
  },
  "run.baseBranch": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.runInBaseBranch,
  },
  "run.worktreePath": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.runInWorktreePath,
  },
  "run.environmentPath": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.runInEnvironmentPath,
  },
  "schedule.isAllDay": {
    valueType: "boolean",
    read: (operation: CreatePageOperationV2) => operation.isAllDay,
  },
  "schedule.timezone": {
    valueType: "string",
    read: (operation: CreatePageOperationV2) => operation.scheduleTimezone,
  },
  "recurrence.config": {
    valueType: "json",
    read: (operation: CreatePageOperationV2) => operation.recurrence,
  },
  "reminders.config": {
    valueType: "json",
    read: (operation: CreatePageOperationV2) => operation.reminders,
  },
} as const;

export type PageLifecycleV2StoreFaultPoint =
  | "after_tag_options"
  | "after_identity"
  | "after_document_genesis"
  | "after_authority"
  | "after_projections"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyPageLifecycleMutationV2Options {
  readonly now?: () => string;
  readonly allocateBodyBlockId?: () => string;
  readonly allocateMembershipId?: () => string;
  readonly faultInjector?: (point: PageLifecycleV2StoreFaultPoint) => void;
}

interface SourceAuthorityRow {
  readonly data_source_id: string;
  readonly library_id: string;
  readonly database_block_id: string;
  readonly default_view_id: string | null;
  readonly view_id: string | null;
  readonly view_config_json: string | null;
}

interface PropertyRow {
  readonly data_source_id: string;
  readonly id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly schema_revision: number;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
}

interface ValidatedCreateValues {
  readonly registry: DataSourceOptionRegistry;
  readonly properties: ReadonlyMap<string, PropertyRow>;
  readonly values: ReadonlyMap<string, DatabaseJsonValue>;
  readonly compatibilityValues: Readonly<Record<string, DatabaseJsonValue>>;
}

interface ViewPlacement {
  readonly groupKey: string | null;
  readonly rankKey: string;
  readonly rebalanced: number;
}

interface AuthorityCommit {
  readonly pageId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly databaseId: string | null;
  readonly dataSourceId: DataSourceId | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly libraryRankKey: string | null;
  readonly viewRankKey: string | null;
  readonly createdBlockIds: readonly string[];
  readonly createdTagOptionIds: CreatePageOperationV2["tagOptionIds"];
  readonly targetBlockIds: readonly string[];
  readonly affectedDocumentIds: readonly string[];
  readonly affectedDatabaseIds: readonly string[];
  readonly fieldIntents: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changePayload: Readonly<Record<string, unknown>>;
}

class PageLifecycleV2Rejection extends Error {
  constructor(readonly error: PageLifecycleMutationCommandErrorV2) {
    super(error.message);
    this.name = "PageLifecycleV2Rejection";
  }
}

const makeError = (
  code: PageLifecycleMutationCommandErrorV2["code"],
  message: string,
  request?: Pick<PageLifecycleMutationRequestV2, "operationId" | "operation">,
  revisions: Pick<
    PageLifecycleMutationCommandErrorV2,
    "expectedRevision" | "actualRevision"
  > = {},
): PageLifecycleMutationCommandErrorV2 => ({
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
  code: PageLifecycleMutationCommandErrorV2["code"],
  message: string,
  request: PageLifecycleMutationRequestV2,
  revisions?: Pick<
    PageLifecycleMutationCommandErrorV2,
    "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new PageLifecycleV2Rejection(
    makeError(code, message, request, revisions),
  );
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const genesisUpdateId = (operationId: string): string =>
  `page-create-genesis-v2:${createHash("sha256").update(operationId).digest("hex")}`;

const readUserVersion = (database: Database.Database): number =>
  Number(database.pragma("user_version", { simple: true }));

const projectExists = (
  database: Database.Database,
  projectId: string,
): boolean =>
  database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !==
  undefined;

const readSourceAuthority = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
): SourceAuthorityRow => {
  const row = database.prepare(`
    SELECT
      source.id AS data_source_id,
      source.library_id,
      source.home_database_block_id AS database_block_id,
      container.default_view_id,
      view.id AS view_id,
      view.config_json AS view_config_json
    FROM data_sources source
    INNER JOIN database_containers container
      ON container.block_id = source.home_database_block_id
     AND container.library_id = source.library_id
    LEFT JOIN database_views view
      ON view.id = (
        SELECT candidate.id
        FROM database_views candidate
        WHERE candidate.database_block_id = container.block_id
          AND candidate.data_source_id = source.id
          AND candidate.lifecycle = 'active'
        ORDER BY
          CASE WHEN candidate.id = container.default_view_id THEN 0 ELSE 1 END,
          candidate.rank_key,
          candidate.id
        LIMIT 1
      )
    WHERE source.id = ? AND source.lifecycle = 'active'
  `).get(request.operation.dataSourceId) as SourceAuthorityRow | undefined;
  if (!row) {
    return reject(
      "data_source_not_found",
      `Data Source does not exist or is inactive: ${request.operation.dataSourceId}`,
      request,
    );
  }
  if (!row.view_id || !row.view_config_json) {
    return reject(
      "view_not_found",
      `Data Source ${request.operation.dataSourceId} has no active View`,
      request,
    );
  }
  return row;
};

const authorizeCreate = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
): void => {
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: request.projectId,
    resource: {
      kind: "data_source",
      dataSourceId: request.operation.dataSourceId,
    },
    action: "create_child",
  });
  if (authorization.allowed) return;
  reject(
    "authorization_denied",
    `Page creation in Data Source ${request.operation.dataSourceId} was denied: ${authorization.reason}`,
    request,
  );
};

const readProperties = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
): ReadonlyMap<string, PropertyRow> => {
  const rows = database.prepare(`
    SELECT data_source_id, id, value_type, config_json, schema_revision
    FROM data_source_properties
    WHERE data_source_id = ? AND lifecycle = 'active'
    ORDER BY id
  `).all(request.operation.dataSourceId) as readonly Omit<PropertyRow, "config">[];
  const properties = new Map<string, PropertyRow>();
  for (const row of rows) {
    let config: Readonly<Record<string, DatabaseJsonValue>>;
    try {
      config = parseDatabasePropertyConfig(
        row.value_type,
        JSON.parse(row.config_json) as unknown,
      );
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Data Source Property ${row.id} has invalid config: ${
          error instanceof Error ? error.message : String(error)
        }`,
        request,
      );
    }
    properties.set(row.id, { ...row, config });
  }
  for (const [propertyId, valueType] of Object.entries(REQUIRED_PROPERTIES)) {
    const property = properties.get(propertyId);
    if (property?.value_type === valueType) continue;
    if (propertyId === "tags" && !property) {
      return reject(
        "tags_property_not_found",
        `Data Source ${request.operation.dataSourceId} has no active tags Property`,
        request,
      );
    }
    reject(
      "database_schema_invalid",
      `Data Source ${request.operation.dataSourceId} requires active ${propertyId}:${valueType}`,
      request,
    );
  }
  return properties;
};

const readPropertyInputValue = (
  operation: CreatePageOperationV2,
  propertyId: keyof typeof REQUIRED_PROPERTIES,
  tags: DatabaseJsonValue,
): unknown => {
  switch (propertyId) {
    case "status":
      return operation.status;
    case "priority":
      return operation.priority;
    case "estimate":
      return operation.estimate;
    case "tags":
      return tags;
    case "due_date":
      return operation.dueDate;
    case "scheduled_start":
      return operation.scheduledStart;
    case "scheduled_end":
      return operation.scheduledEnd;
    case "assignee":
      return operation.assignee;
  }
};

const validateTagRegistry = (
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  tagsProperty: PropertyRow,
): DataSourceOptionRegistry => {
  if (
    tagsProperty.schema_revision !==
    request.operation.expectedTagsPropertyRevision
  ) {
    return reject(
      "tags_property_revision_conflict",
      `Tags Property revision changed for Data Source ${request.operation.dataSourceId}`,
      request,
      {
        expectedRevision: request.operation.expectedTagsPropertyRevision,
        actualRevision: tagsProperty.schema_revision,
      },
    );
  }
  let registry: DataSourceOptionRegistry;
  try {
    registry = parseDataSourceOptionRegistry({
      dataSourceId: tagsProperty.data_source_id,
      propertyId: tagsProperty.id,
      valueType: tagsProperty.value_type,
      config: tagsProperty.config,
    });
  } catch (error) {
    return reject(
      "database_schema_invalid",
      `Tags Property registry is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      request,
    );
  }

  const existingById = new Map(
    registry.options.map((option) => [option.optionId, option] as const),
  );
  const existingByName = new Map(
    registry.options.map((option) => [option.name, option] as const),
  );
  for (const option of request.operation.newTagOptions) {
    if (existingById.has(option.optionId)) {
      return reject(
        "tag_option_identity_conflict",
        `Tag option identity ${option.optionId} already exists`,
        request,
      );
    }
    const named = existingByName.get(option.name);
    if (named) {
      return reject(
        "tag_name_conflict",
        `Tag name ${JSON.stringify(option.name)} already belongs to ${named.optionId}`,
        request,
      );
    }
    try {
      registry = putDataSourceOption(registry, option);
    } catch (error) {
      if (
        error instanceof DataSourceOptionRegistryError &&
        error.code === "option_name_conflict"
      ) {
        return reject("tag_name_conflict", error.message, request);
      }
      return reject(
        "database_schema_invalid",
        error instanceof Error ? error.message : String(error),
        request,
      );
    }
    existingById.set(option.optionId, option);
    existingByName.set(option.name, option);
  }
  return registry;
};

const validateCreateValues = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
): ValidatedCreateValues => {
  const properties = readProperties(database, request);
  const tagsProperty = properties.get("tags");
  if (!tagsProperty) {
    return reject(
      "tags_property_not_found",
      `Data Source ${request.operation.dataSourceId} has no active tags Property`,
      request,
    );
  }
  const registry = validateTagRegistry(request, tagsProperty);
  const effectiveProperties = new Map(properties);
  effectiveProperties.set("tags", {
    ...tagsProperty,
    config: dataSourceOptionRegistryConfig(registry),
  });
  let selectedTags: DatabaseJsonValue;
  try {
    selectedTags = validateDataSourceOptionSelection(
      registry,
      request.operation.tagOptionIds,
    ) as DatabaseJsonValue;
  } catch (error) {
    if (
      error instanceof DataSourceOptionRegistryError &&
      error.code === "invalid_selection"
    ) {
      return reject("tag_option_identity_conflict", error.message, request);
    }
    return reject(
      "database_schema_invalid",
      error instanceof Error ? error.message : String(error),
      request,
    );
  }

  const values = new Map<string, DatabaseJsonValue>();
  for (const propertyId of Object.keys(REQUIRED_PROPERTIES) as readonly (
    keyof typeof REQUIRED_PROPERTIES
  )[]) {
    const property = effectiveProperties.get(propertyId);
    if (!property) {
      return reject(
        "database_schema_invalid",
        `Data Source ${request.operation.dataSourceId} is missing Property ${propertyId}`,
        request,
      );
    }
    try {
      values.set(
        propertyId,
        normalizeDatabasePropertyValue(
          { valueType: property.value_type, config: property.config },
          readPropertyInputValue(
            request.operation,
            propertyId,
            selectedTags,
          ),
        ),
      );
    } catch (error) {
      return reject(
        "database_property_value_invalid",
        `Page value for Property ${propertyId} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        request,
      );
    }
  }

  const namesById = new Map<string, string>(
    registry.options.map((option) => [option.optionId, option.name] as const),
  );
  const compatibilityValues = Object.fromEntries(
    [...values].map(([propertyId, value]) => [
      propertyId,
      propertyId === "tags" && Array.isArray(value)
        ? value.map((optionId) => namesById.get(String(optionId)) ?? String(optionId))
        : value,
    ]),
  ) as Readonly<Record<string, DatabaseJsonValue>>;
  return {
    registry,
    properties: effectiveProperties,
    values,
    compatibilityValues,
  };
};

const createGenesis = (
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  options: ApplyPageLifecycleMutationV2Options,
): PageDocumentGenesis => {
  try {
    return createPageDocumentGenesis({
      documentId: `document:${request.operation.pageId}`,
      ...(request.operation.richTitle
        ? { richTitle: request.operation.richTitle }
        : { title: request.operation.title }),
      nfm: request.operation.nfm,
      ...(options.allocateBodyBlockId === undefined
        ? {}
        : { allocateBlockId: options.allocateBodyBlockId }),
    });
  } catch (error) {
    if (error instanceof BlockDocumentCodecError) {
      return reject(
        "invalid_page_lifecycle_request",
        error.message,
        request,
      );
    }
    throw error;
  }
};

const assertIdentitiesAvailable = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  membershipId: string,
  createdBlockIds: readonly string[],
): void => {
  if (!isUuidV7(request.operation.pageId)) {
    return reject(
      "invalid_page_lifecycle_request",
      "New Page Block id must be a canonical lowercase UUID-v7",
      request,
    );
  }
  const documentId = `document:${request.operation.pageId}`;
  const blockIds = uniqueSorted([request.operation.pageId, ...createdBlockIds]);
  const placeholders = blockIds.map(() => "?").join(", ");
  const blockCollision = database.prepare(`
    SELECT id FROM blocks WHERE id IN (${placeholders}) ORDER BY id LIMIT 1
  `).get(...blockIds) as { readonly id: string } | undefined;
  const collision = blockCollision
    ? `Block ${blockCollision.id}`
    : database.prepare("SELECT id FROM documents WHERE id = ?").get(documentId)
      ? `Document ${documentId}`
      : database.prepare(
          "SELECT id FROM data_source_page_memberships WHERE id = ?",
        ).get(membershipId)
        ? `membership ${membershipId}`
        : null;
  if (!collision) return;
  reject(
    "page_identity_collision",
    `Page creation identity collides with existing ${collision}`,
    request,
  );
};

const allocateViewPlacement = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  source: SourceAuthorityRow,
  values: ReadonlyMap<string, DatabaseJsonValue>,
  now: string,
): ViewPlacement => {
  if (!source.view_id || !source.view_config_json) {
    return reject(
      "view_not_found",
      `Data Source ${source.data_source_id} has no active View`,
      request,
    );
  }
  let groupPropertyId: string | null;
  try {
    groupPropertyId = parseDatabaseViewConfigV2(
      JSON.parse(source.view_config_json) as unknown,
    ).group?.propertyId ?? null;
  } catch (error) {
    return reject(
      "database_schema_invalid",
      `Default View ${source.view_id} has invalid config: ${
        error instanceof Error ? error.message : String(error)
      }`,
      request,
    );
  }
  const groupKey = databaseGroupKeyForValue(
    groupPropertyId === null ? undefined : values.get(groupPropertyId),
  );
  if (request.operation.beforeViewPageId !== undefined) {
    const anchor = database.prepare(`
      SELECT group_key
      FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(source.view_id, request.operation.beforeViewPageId) as
      | { readonly group_key: string | null }
      | undefined;
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `View anchor does not exist: ${request.operation.beforeViewPageId}`,
        request,
      );
    }
    if (anchor.group_key !== groupKey) {
      return reject(
        "position_anchor_group_mismatch",
        `View anchor ${request.operation.beforeViewPageId} belongs to another group`,
        request,
      );
    }
  }
  const items = database.prepare(`
    SELECT page_block_id AS id, rank_key AS rankKey
    FROM database_view_page_positions
    WHERE view_id = ? AND group_key IS ?
    ORDER BY rank_key, page_block_id
  `).all(source.view_id, groupKey) as readonly FractionalRankedItem[];
  let plan;
  try {
    plan = planFractionalRank({
      items,
      targetId: request.operation.pageId,
      ...(request.operation.beforeViewPageId === undefined
        ? {}
        : { beforeId: request.operation.beforeViewPageId }),
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
  const updateRank = database.prepare(`
    UPDATE database_view_page_positions
    SET rank_key = ?, updated_at = ?
    WHERE view_id = ? AND page_block_id = ?
  `);
  for (const [pageId, rankKey] of plan.rebalancedRankKeys) {
    updateRank.run(rankKey, now, source.view_id, pageId);
  }
  return {
    groupKey,
    rankKey: plan.rankKey,
    rebalanced: plan.rebalancedRankKeys.size,
  };
};

const persistTagOptions = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  validated: ValidatedCreateValues,
  now: string,
): number => {
  const tagsProperty = validated.properties.get("tags");
  if (!tagsProperty) {
    return reject(
      "tags_property_not_found",
      `Data Source ${request.operation.dataSourceId} has no tags Property`,
      request,
    );
  }
  if (request.operation.newTagOptions.length === 0) {
    return tagsProperty.schema_revision;
  }
  const configJson = stableStringifyBlockPropertyJson(
    dataSourceOptionRegistryConfig(validated.registry),
  );
  const updated = database.prepare(`
    UPDATE data_source_properties
    SET config_json = ?, schema_revision = schema_revision + 1, updated_at = ?
    WHERE data_source_id = ? AND id = 'tags' AND lifecycle = 'active'
      AND schema_revision = ?
  `).run(
    configJson,
    now,
    request.operation.dataSourceId,
    request.operation.expectedTagsPropertyRevision,
  );
  if (updated.changes !== 1) {
    return reject(
      "tags_property_revision_conflict",
      `Tags Property revision changed for Data Source ${request.operation.dataSourceId}`,
      request,
      {
        expectedRevision: request.operation.expectedTagsPropertyRevision,
        actualRevision: request.operation.expectedTagsPropertyRevision + 1,
      },
    );
  }
  return tagsProperty.schema_revision + 1;
};

const insertIntrinsicProperties = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  now: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const values: Record<string, DatabaseJsonValue> = {};
  const insert = database.prepare(`
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const [propertyKey, definition] of Object.entries(INTRINSIC_PROPERTIES)) {
    const value = definition.read(request.operation) as DatabaseJsonValue;
    values[propertyKey] = value;
    insert.run(
      request.operation.pageId,
      request.projectId,
      propertyKey,
      definition.valueType,
      stableStringifyBlockPropertyJson(value),
      now,
    );
  }
  return values;
};

const insertScheduledProjection = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  now: string,
): void => {
  database.prepare(`
    INSERT INTO scheduled_page_index (
      page_block_id, project_id, lifecycle, scheduled_start, scheduled_end,
      is_all_day, recurrence_json, reminders_json, schedule_timezone,
      source_metadata_revision, updated_at
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    request.operation.pageId,
    request.projectId,
    request.operation.scheduledStart,
    request.operation.scheduledEnd,
    request.operation.isAllDay ? 1 : 0,
    stableStringifyBlockPropertyJson(request.operation.recurrence),
    stableStringifyBlockPropertyJson(request.operation.reminders),
    request.operation.scheduleTimezone,
    now,
  );
};

const insertPageReadProjection = (input: {
  readonly database: Database.Database;
  readonly request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  };
  readonly source: SourceAuthorityRow;
  readonly membershipId: string;
  readonly view: ViewPlacement;
  readonly genesis: PageDocumentGenesis;
  readonly documentHeadSeq: number;
  readonly compatibilityValues: Readonly<Record<string, DatabaseJsonValue>>;
  readonly intrinsicValues: Readonly<Record<string, DatabaseJsonValue>>;
  readonly now: string;
}): void => {
  const databaseRevisions = Object.fromEntries(
    Object.keys(REQUIRED_PROPERTIES).map((propertyId) => [propertyId, 1]),
  );
  const intrinsicRevisions = Object.fromEntries(
    Object.keys(INTRINSIC_PROPERTIES).map((propertyId) => [propertyId, 1]),
  );
  input.database.prepare(`
    INSERT INTO page_read_model (
      page_block_id, project_id, lifecycle, location_kind,
      containing_document_id, containing_database_id, top_level_rank_key,
      location_revision, metadata_revision,
      document_id, document_generation, document_projected_seq,
      document_schema_version, document_authority,
      membership_id, database_block_id, view_id, view_group_key, view_rank_key,
      title, description_preview, description_length, has_description,
      database_values_json, intrinsic_properties_json, property_revisions_json,
      projection_version, created_at, updated_at
    ) VALUES (
      ?, ?, 'active', 'database', NULL, ?, NULL, 1, 1,
      ?, 1, ?, ?, 'ydoc_primary',
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
    )
  `).run(
    input.request.operation.pageId,
    input.request.projectId,
    input.source.database_block_id,
    `document:${input.request.operation.pageId}`,
    input.documentHeadSeq,
    PAGE_DOCUMENT_SCHEMA_VERSION,
    input.membershipId,
    input.source.database_block_id,
    input.source.view_id,
    input.view.groupKey,
    input.view.rankKey,
    input.genesis.materialization.title,
    input.genesis.materialization.preview,
    input.genesis.materialization.nfm.length,
    input.genesis.materialization.nfm.trim().length > 0 ? 1 : 0,
    stableStringifyBlockPropertyJson(input.compatibilityValues),
    stableStringifyBlockPropertyJson(input.intrinsicValues),
    stableStringifyBlockPropertyJson({
      database: databaseRevisions,
      intrinsic: intrinsicRevisions,
    }),
    input.now,
    input.now,
  );
};

const executeCreate = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: CreatePageOperationV2;
  },
  now: string,
  options: ApplyPageLifecycleMutationV2Options,
): AuthorityCommit => {
  const source = readSourceAuthority(database, request);
  authorizeCreate(database, request);
  const validated = validateCreateValues(database, request);
  const membershipId = options.allocateMembershipId?.() ?? randomUUID();
  const genesis = createGenesis(request, options);
  const createdBlockIds = flattenBlockIds(genesis.materialization.blockTree);
  try {
    assertIdentitiesAvailable(
      database,
      request,
      membershipId,
      createdBlockIds,
    );
    const placement = allocateViewPlacement(
      database,
      request,
      source,
      validated.values,
      now,
    );
    const tagsRevisionAfter = persistTagOptions(
      database,
      request,
      validated,
      now,
    );
    options.faultInjector?.("after_tag_options");

    const pageId = request.operation.pageId;
    const documentId = `document:${pageId}`;
    database.prepare(`
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'page', 'active', 'space', NULL, NULL, 1, 1, ?, ?)
    `).run(pageId, request.projectId, now, now);
    database.prepare(`
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, ?, ?, X'', '', 'pending_genesis',
        'legacy_shadow', NULL, ?, ?)
    `).run(
      documentId,
      request.projectId,
      PAGE_DOCUMENT_SCHEMA_KEY,
      PAGE_DOCUMENT_SCHEMA_VERSION,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(pageId, documentId, request.projectId, now);
    database.prepare(`
      INSERT INTO pages (
        block_id, library_id, document_id, parent_kind, parent_id,
        lifecycle, parent_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'data_source', ?, 'active', 1, 1, ?, ?)
    `).run(
      pageId,
      source.library_id,
      documentId,
      source.data_source_id,
      now,
      now,
    );
    const located = database.prepare(`
      UPDATE blocks
      SET location_kind = 'database', containing_document_id = NULL,
        containing_database_id = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND type = 'page'
    `).run(
      source.database_block_id,
      now,
      pageId,
      request.projectId,
    );
    if (located.changes !== 1) {
      return reject(
        "page_parent_invalid",
        `Page ${pageId} could not enter Database ${source.database_block_id}`,
        request,
      );
    }
    options.faultInjector?.("after_identity");

    const genesisAck = initializePageDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: genesisUpdateId(request.operationId),
      clientSessionId: request.clientSessionId ?? "page-lifecycle-v2-create",
      update: genesis.update,
      finalAuthority: "ydoc_primary",
    });
    options.faultInjector?.("after_document_genesis");

    database.prepare(`
      INSERT INTO data_source_page_memberships (
        id, data_source_id, page_block_id, revision, created_at, removed_at
      ) VALUES (?, ?, ?, 1, ?, NULL)
    `).run(membershipId, source.data_source_id, pageId, now);
    const insertValue = database.prepare(`
      INSERT INTO data_source_property_values (
        data_source_id, membership_id, property_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const [propertyId, value] of validated.values) {
      const property = validated.properties.get(propertyId);
      if (!property) {
        throw new Error(`Validated Property disappeared: ${propertyId}`);
      }
      insertValue.run(
        source.data_source_id,
        membershipId,
        propertyId,
        property.value_type,
        stableStringifyBlockPropertyJson(value),
        now,
      );
    }
    const intrinsicValues = insertIntrinsicProperties(database, request, now);
    if (!source.view_id) {
      return reject(
        "view_not_found",
        `Data Source ${source.data_source_id} has no active View`,
        request,
      );
    }
    database.prepare(`
      INSERT INTO database_view_page_positions (
        view_id, page_block_id, group_key, rank_key,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(
      source.view_id,
      pageId,
      placement.groupKey,
      placement.rankKey,
      now,
      now,
    );
    insertScheduledProjection(database, request, now);
    insertPageReadProjection({
      database,
      request,
      source,
      membershipId,
      view: placement,
      genesis,
      documentHeadSeq: genesisAck.headSeq,
      compatibilityValues: validated.compatibilityValues,
      intrinsicValues,
      now,
    });

    const createdTagOptionIds = request.operation.newTagOptions.map(
      (option) => option.optionId,
    );
    const tagsRevisionBefore = request.operation.expectedTagsPropertyRevision;
    return {
      pageId,
      lifecycle: "active",
      metadataRevision: 1,
      parentRevision: 1,
      documentId,
      documentGeneration: 1,
      documentHeadSeq: genesisAck.headSeq,
      databaseId: source.database_block_id,
      dataSourceId: request.operation.dataSourceId,
      membershipId,
      viewId: source.view_id,
      libraryRankKey: null,
      viewRankKey: placement.rankKey,
      createdBlockIds,
      createdTagOptionIds,
      targetBlockIds: uniqueSorted([
        pageId,
        source.database_block_id,
        ...createdBlockIds,
      ]),
      affectedDocumentIds: [documentId],
      affectedDatabaseIds: [source.database_block_id],
      fieldIntents: [
        { path: `pages.${pageId}`, operation: "create" },
        { path: `documents.${documentId}`, operation: "genesis" },
        {
          path: `dataSources.${source.data_source_id}.memberships.${membershipId}`,
          operation: "create",
        },
        ...createdTagOptionIds.map((optionId) => ({
          path: `dataSources.${source.data_source_id}.properties.tags.options.${optionId}`,
          operation: "add",
        })),
      ],
      changePayload: {
        operation: "create_page",
        pageId,
        documentId,
        databaseId: source.database_block_id,
        dataSourceId: source.data_source_id,
        membershipId,
        viewId: source.view_id,
        createdBlockIds,
        viewRankKey: placement.rankKey,
        rebalancedViewPositions: placement.rebalanced,
        createdTagOptionIds,
      },
      expectedRevisions: {
        blockMetadata: 0,
        blockLocation: 0,
        membership: 0,
        tagsProperty: tagsRevisionBefore,
      },
      committedRevisions: {
        blockMetadata: 1,
        blockLocation: 1,
        membership: 1,
        viewPosition: 1,
        tagsProperty: tagsRevisionAfter,
      },
    };
  } finally {
    genesis.document.destroy();
  }
};

interface ExistingPageAuthority {
  readonly id: string;
  readonly projectId: string;
  readonly libraryId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly locationKind: "space" | "document" | "database";
  readonly containingDocumentId: string | null;
  readonly containingDatabaseId: string | null;
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly parentKind: "library" | "page" | "data_source";
  readonly parentId: string;
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
}

interface CanonicalMembership {
  readonly id: string;
  readonly dataSourceId: DataSourceId;
  readonly databaseId: string;
  readonly revision: number;
  readonly removedAt: string | null;
}

interface CanonicalPosition {
  readonly viewId: string;
  readonly groupKey: string | null;
  readonly rankKey: string;
}

interface IndexedBlockState {
  readonly id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadataRevision: number;
}

interface IndexedPageClosure {
  readonly blocks: readonly IndexedBlockState[];
  readonly documentIds: readonly string[];
}

const requireRevision = (
  request: PageLifecycleMutationRequestV2,
  kind: "metadata" | "parent",
  expected: number,
  actual: number,
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

const readExistingPage = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
): ExistingPageAuthority => {
  const row = database.prepare(`
    SELECT
      block.id,
      block.project_id,
      block.type,
      block.lifecycle AS block_lifecycle,
      block.location_kind,
      block.containing_document_id,
      block.containing_database_id,
      block.metadata_revision AS block_metadata_revision,
      block.location_revision,
      page.library_id,
      page.lifecycle AS page_lifecycle,
      page.parent_kind,
      page.parent_id,
      page.metadata_revision AS page_metadata_revision,
      page.parent_revision,
      ownership.document_id,
      document.generation,
      document.head_seq,
      document.readiness,
      document.authority,
      document.schema_key,
      document.schema_version
    FROM blocks block
    LEFT JOIN pages page ON page.block_id = block.id
    LEFT JOIN block_documents ownership
      ON ownership.block_id = block.id
     AND ownership.project_id = block.project_id
    LEFT JOIN documents document
      ON document.id = ownership.document_id
     AND document.project_id = ownership.project_id
    WHERE block.id = ?
  `).get(request.operation.pageId) as
    | {
        readonly id: string;
        readonly project_id: string;
        readonly type: string;
        readonly block_lifecycle: ExistingPageAuthority["lifecycle"];
        readonly location_kind: ExistingPageAuthority["locationKind"];
        readonly containing_document_id: string | null;
        readonly containing_database_id: string | null;
        readonly block_metadata_revision: number;
        readonly location_revision: number;
        readonly library_id: string | null;
        readonly page_lifecycle: ExistingPageAuthority["lifecycle"] | null;
        readonly parent_kind: ExistingPageAuthority["parentKind"] | null;
        readonly parent_id: string | null;
        readonly page_metadata_revision: number | null;
        readonly parent_revision: number | null;
        readonly document_id: string | null;
        readonly generation: number | null;
        readonly head_seq: number | null;
        readonly readiness: string | null;
        readonly authority: string | null;
        readonly schema_key: string | null;
        readonly schema_version: number | null;
      }
    | undefined;
  if (!row || row.project_id !== request.projectId) {
    return reject(
      "page_not_found",
      `Page does not exist in Project ${request.projectId}: ${request.operation.pageId}`,
      request,
    );
  }
  if (row.type !== "page") {
    return reject(
      "page_type_mismatch",
      `Block ${row.id} is ${row.type}, not a Page`,
      request,
    );
  }
  if (
    !row.library_id ||
    !row.page_lifecycle ||
    !row.parent_kind ||
    !row.parent_id ||
    row.page_lifecycle !== row.block_lifecycle ||
    row.page_metadata_revision !== row.block_metadata_revision ||
    row.parent_revision !== row.location_revision
  ) {
    return reject(
      "page_parent_invalid",
      `Page ${row.id} canonical parent projection is missing or stale`,
      request,
    );
  }
  if (
    !row.document_id ||
    row.generation === null ||
    row.head_seq === null ||
    row.readiness !== "ready" ||
    row.authority !== "ydoc_primary" ||
    row.schema_key !== PAGE_DOCUMENT_SCHEMA_KEY ||
    row.schema_version !== PAGE_DOCUMENT_SCHEMA_VERSION
  ) {
    return reject(
      "document_state_corrupt",
      `Page ${row.id} does not own a current primary Page Document`,
      request,
    );
  }
  return {
    id: row.id,
    projectId: row.project_id,
    libraryId: row.library_id,
    lifecycle: row.block_lifecycle,
    locationKind: row.location_kind,
    containingDocumentId: row.containing_document_id,
    containingDatabaseId: row.containing_database_id,
    metadataRevision: row.block_metadata_revision,
    parentRevision: row.location_revision,
    parentKind: row.parent_kind,
    parentId: row.parent_id,
    documentId: row.document_id,
    documentGeneration: row.generation,
    documentHeadSeq: row.head_seq,
  };
};

const synchronizeCanonicalPageRevisions = (
  database: Database.Database,
  pageId: string,
  now: string,
): void => {
  const synchronized = database.prepare(`
    UPDATE pages
    SET lifecycle = (
          SELECT lifecycle FROM blocks WHERE id = pages.block_id
        ),
        parent_revision = (
          SELECT location_revision FROM blocks WHERE id = pages.block_id
        ),
        metadata_revision = (
          SELECT metadata_revision FROM blocks WHERE id = pages.block_id
        ),
        updated_at = ?
    WHERE block_id = ?
  `).run(now, pageId);
  if (synchronized.changes === 1) return;
  throw new Error(`Page ${pageId} lost its canonical authority row`);
};

const authorizeExistingPageWrite = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
): void => {
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: request.projectId,
    resource: { kind: "page", pageId: request.operation.pageId },
    action: "write",
  });
  if (authorization.allowed) return;
  reject(
    "authorization_denied",
    `Page lifecycle mutation was denied: ${authorization.reason}`,
    request,
  );
};

const readMembership = (
  database: Database.Database,
  pageId: string,
  options: { readonly includeRemoved?: boolean } = {},
): CanonicalMembership | null => {
  const row = database.prepare(`
    SELECT
      membership.id,
      membership.data_source_id,
      source.home_database_block_id AS database_id,
      membership.revision,
      membership.removed_at
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.page_block_id = ?
      AND (? = 1 OR membership.removed_at IS NULL)
    ORDER BY membership.removed_at IS NULL DESC, membership.id
    LIMIT 1
  `).get(pageId, options.includeRemoved ? 1 : 0) as
    | {
        readonly id: string;
        readonly data_source_id: DataSourceId;
        readonly database_id: string;
        readonly revision: number;
        readonly removed_at: string | null;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        dataSourceId: row.data_source_id,
        databaseId: row.database_id,
        revision: row.revision,
        removedAt: row.removed_at,
      }
    : null;
};

const assertPageParentAndMembership = (
  request: PageLifecycleMutationRequestV2,
  page: ExistingPageAuthority,
  membership: CanonicalMembership | null,
): void => {
  const validSourceParent =
    page.parentKind === "data_source" &&
    page.locationKind === "database" &&
    membership !== null &&
    membership.dataSourceId === page.parentId &&
    membership.databaseId === page.containingDatabaseId;
  const validLibraryParent =
    page.parentKind === "library" &&
    page.locationKind === "space" &&
    membership === null &&
    page.parentId === page.libraryId;
  const validNestedParent =
    page.parentKind === "page" &&
    page.locationKind === "document" &&
    membership === null &&
    page.containingDocumentId !== null;
  if (validSourceParent || validLibraryParent || validNestedParent) return;
  reject(
    "page_parent_invalid",
    `Page ${page.id} parent and Data Source membership disagree`,
    request,
  );
};

const readSelectedPosition = (
  database: Database.Database,
  pageId: string,
  dataSourceId: string,
): CanonicalPosition | null =>
  (database.prepare(`
    SELECT
      position.view_id AS viewId,
      position.group_key AS groupKey,
      position.rank_key AS rankKey
    FROM database_view_page_positions position
    INNER JOIN database_views view ON view.id = position.view_id
    INNER JOIN database_containers container
      ON container.block_id = view.database_block_id
    WHERE position.page_block_id = ?
      AND view.data_source_id = ?
      AND view.lifecycle = 'active'
    ORDER BY
      CASE WHEN view.id = container.default_view_id THEN 0 ELSE 1 END,
      view.rank_key,
      view.id
    LIMIT 1
  `).get(pageId, dataSourceId) as CanonicalPosition | undefined) ?? null;

const readMembershipStatus = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  membership: CanonicalMembership,
): WorkflowStatus => {
  const row = database.prepare(`
    SELECT value_json
    FROM data_source_property_values
    WHERE data_source_id = ? AND membership_id = ? AND property_id = 'status'
  `).get(membership.dataSourceId, membership.id) as
    | { readonly value_json: string }
    | undefined;
  let status: unknown;
  try {
    status = row ? JSON.parse(row.value_json) : undefined;
  } catch {
    status = undefined;
  }
  if (isWorkflowStatus(status)) return status;
  return reject(
    "database_schema_invalid",
    `Membership ${membership.id} has no valid status value`,
    request,
  );
};

const readCurrentIndexedClosure = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  page: ExistingPageAuthority,
): IndexedPageClosure => {
  const blocks = new Map<string, IndexedBlockState>([[
    page.id,
    {
      id: page.id,
      lifecycle: page.lifecycle,
      metadataRevision: page.metadataRevision,
    },
  ]]);
  const documentIds = new Set<string>();
  const pendingOwnerIds = [page.id];
  while (pendingOwnerIds.length > 0) {
    const ownerId = pendingOwnerIds.shift();
    if (!ownerId) continue;
    const document = database.prepare(`
      SELECT
        document.id,
        document.generation,
        document.head_seq,
        document.readiness,
        document.authority,
        document.sync_engine,
        materialization.generation AS materialization_generation,
        materialization.projected_seq
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE ownership.block_id = ?
    `).get(ownerId) as
      | {
          readonly id: string;
          readonly generation: number;
          readonly head_seq: number;
          readonly readiness: string;
          readonly authority: string;
          readonly sync_engine: string;
          readonly materialization_generation: number | null;
          readonly projected_seq: number | null;
        }
      | undefined;
    if (!document) continue;
    if (
      documentIds.has(document.id) ||
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary" ||
      document.sync_engine !== "yjs" ||
      document.materialization_generation !== document.generation ||
      document.projected_seq !== document.head_seq
    ) {
      return reject(
        "document_state_corrupt",
        `Owned Document ${document.id} lacks an exact-head materialization`,
        request,
      );
    }
    documentIds.add(document.id);
    const indexed = database.prepare(`
      SELECT
        entry.block_id,
        entry.projected_seq,
        block.lifecycle,
        block.metadata_revision,
        block.location_kind,
        block.containing_document_id
      FROM document_block_index entry
      INNER JOIN blocks block ON block.id = entry.block_id
      WHERE entry.document_id = ?
      ORDER BY entry.block_id
    `).all(document.id) as readonly {
      readonly block_id: string;
      readonly projected_seq: number;
      readonly lifecycle: IndexedBlockState["lifecycle"];
      readonly metadata_revision: number;
      readonly location_kind: string;
      readonly containing_document_id: string | null;
    }[];
    for (const indexedBlock of indexed) {
      if (
        indexedBlock.projected_seq !== document.head_seq ||
        indexedBlock.location_kind !== "document" ||
        indexedBlock.containing_document_id !== document.id ||
        blocks.has(indexedBlock.block_id)
      ) {
        return reject(
          "document_state_corrupt",
          `Document ${document.id} has a stale or ambiguous Block index`,
          request,
        );
      }
      blocks.set(indexedBlock.block_id, {
        id: indexedBlock.block_id,
        lifecycle: indexedBlock.lifecycle,
        metadataRevision: indexedBlock.metadata_revision,
      });
      pendingOwnerIds.push(indexedBlock.block_id);
    }
  }
  return {
    blocks: [...blocks.values()].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    documentIds: [...documentIds].sort(compareStrings),
  };
};

const allocateLibraryRank = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  page: ExistingPageAuthority,
  beforeBlockId: string | undefined,
  now: string,
): { readonly rankKey: string; readonly rebalanced: number } => {
  if (beforeBlockId !== undefined) {
    const anchor = database.prepare(`
      SELECT 1 FROM library_block_placements
      WHERE library_id = ? AND block_id = ?
    `).get(page.libraryId, beforeBlockId);
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `Library placement anchor does not exist: ${beforeBlockId}`,
        request,
      );
    }
  }
  const items = database.prepare(`
    SELECT block_id AS id, rank_key AS rankKey
    FROM library_block_placements
    WHERE library_id = ?
    ORDER BY rank_key, block_id
  `).all(page.libraryId) as readonly FractionalRankedItem[];
  let plan;
  try {
    plan = planFractionalRank({
      items,
      targetId: page.id,
      ...(beforeBlockId === undefined ? {} : { beforeId: beforeBlockId }),
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
  const update = database.prepare(`
    UPDATE library_block_placements
    SET rank_key = ?, revision = revision + 1, updated_at = ?
    WHERE block_id = ? AND library_id = ?
  `);
  for (const [blockId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, now, blockId, page.libraryId);
  }
  return { rankKey: plan.rankKey, rebalanced: plan.rebalancedRankKeys.size };
};

const allocateExistingViewRank = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  input: {
    readonly viewId: string;
    readonly groupKey: string | null;
    readonly beforePageId?: string;
    readonly now: string;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  if (input.beforePageId !== undefined) {
    const anchor = database.prepare(`
      SELECT group_key FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(input.viewId, input.beforePageId) as
      | { readonly group_key: string | null }
      | undefined;
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `View anchor does not exist: ${input.beforePageId}`,
        request,
      );
    }
    if (anchor.group_key !== input.groupKey) {
      return reject(
        "position_anchor_group_mismatch",
        `View anchor ${input.beforePageId} belongs to another group`,
        request,
      );
    }
  }
  const items = database.prepare(`
    SELECT page_block_id AS id, rank_key AS rankKey
    FROM database_view_page_positions
    WHERE view_id = ? AND group_key IS ?
    ORDER BY rank_key, page_block_id
  `).all(input.viewId, input.groupKey) as readonly FractionalRankedItem[];
  let plan;
  try {
    plan = planFractionalRank({
      items,
      targetId: request.operation.pageId,
      ...(input.beforePageId === undefined
        ? {}
        : { beforeId: input.beforePageId }),
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
  const update = database.prepare(`
    UPDATE database_view_page_positions
    SET rank_key = ?, revision = revision + 1, updated_at = ?
    WHERE view_id = ? AND page_block_id = ?
  `);
  for (const [pageId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, input.now, input.viewId, pageId);
  }
  return { rankKey: plan.rankKey, rebalanced: plan.rebalancedRankKeys.size };
};

const parseStoredJson = (
  serialized: string,
  label: string,
): DatabaseJsonValue => {
  try {
    return JSON.parse(serialized) as DatabaseJsonValue;
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error });
  }
};

const readIntrinsicProjection = (
  database: Database.Database,
  pageId: string,
): {
  readonly values: Readonly<Record<string, DatabaseJsonValue>>;
  readonly revisions: Readonly<Record<string, number>>;
} => {
  const rows = database.prepare(`
    SELECT property_key, value_json, revision
    FROM block_properties
    WHERE block_id = ?
    ORDER BY property_key
  `).all(pageId) as readonly {
    readonly property_key: string;
    readonly value_json: string;
    readonly revision: number;
  }[];
  return {
    values: Object.fromEntries(rows.map((row) => [
      row.property_key,
      parseStoredJson(row.value_json, `Block Property ${row.property_key}`),
    ])),
    revisions: Object.fromEntries(rows.map((row) => [
      row.property_key,
      row.revision,
    ])),
  };
};

const readDatabaseProjection = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  membership: CanonicalMembership | null,
): {
  readonly values: Readonly<Record<string, DatabaseJsonValue>>;
  readonly revisions: Readonly<Record<string, number>>;
} => {
  if (!membership || membership.removedAt !== null) {
    return { values: {}, revisions: {} };
  }
  const rows = database.prepare(`
    SELECT
      value.property_id,
      value.value_json,
      value.revision,
      property.value_type,
      property.config_json
    FROM data_source_property_values value
    INNER JOIN data_source_properties property
      ON property.data_source_id = value.data_source_id
     AND property.id = value.property_id
     AND property.lifecycle = 'active'
    WHERE value.data_source_id = ? AND value.membership_id = ?
    ORDER BY value.property_id
  `).all(membership.dataSourceId, membership.id) as readonly {
    readonly property_id: string;
    readonly value_json: string;
    readonly revision: number;
    readonly value_type: DatabasePropertyValueType;
    readonly config_json: string;
  }[];
  const values: Record<string, DatabaseJsonValue> = {};
  const revisions: Record<string, number> = {};
  for (const row of rows) {
    const raw = parseStoredJson(
      row.value_json,
      `Data Source value ${membership.id}/${row.property_id}`,
    );
    if (row.property_id !== "tags") {
      try {
        const config = parseDatabasePropertyConfig(
          row.value_type,
          JSON.parse(row.config_json) as unknown,
        );
        const normalized = normalizeDatabasePropertyValue(
          { valueType: row.value_type, config },
          raw,
        );
        if (
          stableStringifyBlockPropertyJson(normalized) !==
          stableStringifyBlockPropertyJson(raw)
        ) {
          throw new Error("stored value is not canonical");
        }
        values[row.property_id] = normalized;
        revisions[row.property_id] = row.revision;
      } catch (error) {
        return reject(
          "database_schema_invalid",
          `Property ${row.property_id} projection is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
          request,
        );
      }
      continue;
    }
    let registry: DataSourceOptionRegistry;
    try {
      registry = parseDataSourceOptionRegistry({
        dataSourceId: membership.dataSourceId,
        propertyId: row.property_id,
        valueType: row.value_type,
        config: JSON.parse(row.config_json) as unknown,
      });
      const selected = validateDataSourceOptionSelection(registry, raw);
      if (!Array.isArray(selected)) throw new Error("Tags selection is not an array");
      const names = new Map<string, string>(
        registry.options.map((option) => [option.optionId, option.name]),
      );
      values[row.property_id] = selected.map((id) => {
        const name = names.get(id);
        if (name) return name;
        throw new Error(`Tags selection references unknown option ${id}`);
      });
      revisions[row.property_id] = row.revision;
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Tags projection is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        request,
      );
    }
  }
  const missing = Object.keys(REQUIRED_PROPERTIES).filter(
    (propertyId) => !(propertyId in values),
  );
  if (missing.length > 0) {
    return reject(
      "database_schema_invalid",
      `Membership ${membership.id} is missing Page values: ${missing.join(", ")}`,
      request,
    );
  }
  return { values, revisions };
};

const refreshCanonicalPageProjections = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  page: ExistingPageAuthority,
  now: string,
): void => {
  const current = readExistingPage(database, request);
  const membership = readMembership(database, page.id);
  const position = membership
    ? readSelectedPosition(database, page.id, membership.dataSourceId)
    : null;
  const databaseProjection = readDatabaseProjection(
    database,
    request,
    membership,
  );
  const intrinsic = readIntrinsicProjection(database, page.id);
  const libraryRank = database.prepare(`
    SELECT rank_key FROM library_block_placements WHERE block_id = ?
  `).get(page.id) as { readonly rank_key: string } | undefined;
  const updated = database.prepare(`
    UPDATE page_read_model
    SET
      lifecycle = ?,
      location_kind = ?,
      containing_document_id = ?,
      containing_database_id = ?,
      top_level_rank_key = ?,
      location_revision = ?,
      metadata_revision = ?,
      membership_id = ?,
      database_block_id = ?,
      view_id = ?,
      view_group_key = ?,
      view_rank_key = ?,
      database_values_json = ?,
      intrinsic_properties_json = ?,
      property_revisions_json = ?,
      updated_at = ?
    WHERE page_block_id = ? AND project_id = ?
  `).run(
    current.lifecycle,
    current.locationKind,
    current.containingDocumentId,
    current.containingDatabaseId,
    libraryRank?.rank_key ?? null,
    current.parentRevision,
    current.metadataRevision,
    membership?.id ?? null,
    membership?.databaseId ?? null,
    position?.viewId ?? null,
    position?.groupKey ?? null,
    position?.rankKey ?? null,
    stableStringifyBlockPropertyJson(databaseProjection.values),
    stableStringifyBlockPropertyJson(intrinsic.values),
    stableStringifyBlockPropertyJson({
      database: databaseProjection.revisions,
      intrinsic: intrinsic.revisions,
    }),
    now,
    page.id,
    page.projectId,
  );
  if (updated.changes !== 1) {
    return reject(
      "document_state_corrupt",
      `Page ${page.id} has no compatibility read projection`,
      request,
    );
  }

  const scheduledStart = databaseProjection.values.scheduled_start;
  const scheduledEnd = databaseProjection.values.scheduled_end;
  const isAllDay = intrinsic.values["schedule.isAllDay"];
  const recurrence = intrinsic.values["recurrence.config"];
  const reminders = intrinsic.values["reminders.config"];
  const timezone = intrinsic.values["schedule.timezone"];
  const hasScheduleBounds =
    typeof scheduledStart === "string" && typeof scheduledEnd === "string";
  database.prepare(`
    INSERT INTO scheduled_page_index (
      page_block_id, project_id, lifecycle, scheduled_start, scheduled_end,
      is_all_day, recurrence_json, reminders_json, schedule_timezone,
      source_metadata_revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_block_id) DO UPDATE SET
      lifecycle = excluded.lifecycle,
      scheduled_start = excluded.scheduled_start,
      scheduled_end = excluded.scheduled_end,
      is_all_day = excluded.is_all_day,
      recurrence_json = excluded.recurrence_json,
      reminders_json = excluded.reminders_json,
      schedule_timezone = excluded.schedule_timezone,
      source_metadata_revision = excluded.source_metadata_revision,
      updated_at = excluded.updated_at
  `).run(
    page.id,
    page.projectId,
    current.lifecycle,
    typeof scheduledStart === "string" ? scheduledStart : null,
    typeof scheduledEnd === "string" ? scheduledEnd : null,
    isAllDay === true && hasScheduleBounds ? 1 : 0,
    stableStringifyBlockPropertyJson(recurrence ?? null),
    stableStringifyBlockPropertyJson(
      Array.isArray(reminders) ? reminders : [],
    ),
    typeof timezone === "string" ? timezone : null,
    current.metadataRevision,
    now,
  );
};

const existingPageCommit = (input: {
  readonly request: PageLifecycleMutationRequestV2;
  readonly page: ExistingPageAuthority;
  readonly membership: CanonicalMembership | null;
  readonly viewId?: string | null;
  readonly libraryRankKey?: string | null;
  readonly viewRankKey?: string | null;
  readonly targetBlockIds?: readonly string[];
  readonly affectedDocumentIds?: readonly string[];
  readonly fieldIntents?: AuthorityCommit["fieldIntents"];
  readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changePayload?: Readonly<Record<string, unknown>>;
}): AuthorityCommit => ({
  pageId: input.page.id,
  lifecycle: input.page.lifecycle,
  metadataRevision: input.page.metadataRevision,
  parentRevision: input.page.parentRevision,
  documentId: input.page.documentId,
  documentGeneration: input.page.documentGeneration,
  documentHeadSeq: input.page.documentHeadSeq,
  databaseId: input.membership?.databaseId ?? null,
  dataSourceId: input.membership?.dataSourceId ?? null,
  membershipId: input.membership?.id ?? null,
  viewId: input.viewId ?? null,
  libraryRankKey: input.libraryRankKey ?? null,
  viewRankKey: input.viewRankKey ?? null,
  createdBlockIds: [],
  createdTagOptionIds: [],
  targetBlockIds: uniqueSorted([
    input.page.id,
    ...(input.membership ? [input.membership.databaseId] : []),
    ...(input.targetBlockIds ?? []),
  ]),
  affectedDocumentIds: input.affectedDocumentIds ?? [input.page.documentId],
  affectedDatabaseIds: input.membership ? [input.membership.databaseId] : [],
  fieldIntents: input.fieldIntents ?? [{
    path: `pages.${input.page.id}`,
    operation: input.request.operation.kind,
  }],
  expectedRevisions: input.expectedRevisions,
  committedRevisions: input.committedRevisions,
  changePayload: {
    operation: input.request.operation.kind,
    pageId: input.page.id,
    lifecycle: input.page.lifecycle,
    metadataRevision: input.page.metadataRevision,
    parentRevision: input.page.parentRevision,
    ...(input.changePayload ?? {}),
  },
});

const executeLifecycleTransition = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "archive_page" | "unarchive_page" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const page = readExistingPage(database, request);
  authorizeExistingPageWrite(database, request);
  const membership = readMembership(database, page.id);
  assertPageParentAndMembership(request, page, membership);
  const expectedLifecycle =
    request.operation.kind === "archive_page" ? "active" : "archived";
  const targetLifecycle =
    request.operation.kind === "archive_page" ? "archived" : "active";
  if (page.lifecycle !== expectedLifecycle) {
    return reject(
      "page_lifecycle_conflict",
      `Page ${page.id} is ${page.lifecycle}; ${request.operation.kind} requires ${expectedLifecycle}`,
      request,
    );
  }
  requireRevision(
    request,
    "metadata",
    request.operation.expectedMetadataRevision,
    page.metadataRevision,
  );
  const nextMetadataRevision = page.metadataRevision + 1;
  const updated = database.prepare(`
    UPDATE blocks
    SET lifecycle = ?, metadata_revision = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = ?
      AND metadata_revision = ?
  `).run(
    targetLifecycle,
    nextMetadataRevision,
    now,
    page.id,
    page.projectId,
    expectedLifecycle,
    page.metadataRevision,
  );
  if (updated.changes !== 1) {
    throw new Error(`Page ${page.id} changed during lifecycle transition`);
  }
  synchronizeCanonicalPageRevisions(database, page.id, now);
  const committedPage = readExistingPage(database, request);
  refreshCanonicalPageProjections(database, request, committedPage, now);
  const position = membership
    ? readSelectedPosition(database, page.id, membership.dataSourceId)
    : null;
  const libraryRank = database.prepare(`
    SELECT rank_key FROM library_block_placements WHERE block_id = ?
  `).get(page.id) as { readonly rank_key: string } | undefined;
  return existingPageCommit({
    request,
    page: committedPage,
    membership,
    viewId: position?.viewId ?? null,
    libraryRankKey: libraryRank?.rank_key ?? null,
    viewRankKey: position?.rankKey ?? null,
    expectedRevisions: { blockMetadata: page.metadataRevision },
    committedRevisions: { blockMetadata: nextMetadataRevision },
  });
};

const executeMoveInLibrary = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "move_page_in_library" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const page = readExistingPage(database, request);
  authorizeExistingPageWrite(database, request);
  const membership = readMembership(database, page.id);
  assertPageParentAndMembership(request, page, membership);
  const placement = database.prepare(`
    SELECT rank_key FROM library_block_placements
    WHERE block_id = ? AND library_id = ?
  `).get(page.id, page.libraryId) as { readonly rank_key: string } | undefined;
  if (
    page.lifecycle === "deleted" ||
    page.parentKind !== "library" ||
    page.locationKind !== "space" ||
    membership !== null ||
    !placement
  ) {
    return reject(
      "page_parent_invalid",
      `Page ${page.id} is not a placed non-deleted Library Page`,
      request,
    );
  }
  requireRevision(
    request,
    "parent",
    request.operation.expectedParentRevision,
    page.parentRevision,
  );
  const rank = allocateLibraryRank(
    database,
    request,
    page,
    request.operation.beforeBlockId,
    now,
  );
  const updatedPlacement = database.prepare(`
    UPDATE library_block_placements
    SET rank_key = ?, revision = revision + 1, updated_at = ?
    WHERE block_id = ? AND library_id = ?
  `).run(rank.rankKey, now, page.id, page.libraryId);
  if (updatedPlacement.changes !== 1) {
    throw new Error(`Page ${page.id} lost its Library placement`);
  }
  const parentRevision = page.parentRevision + 1;
  const updatedPage = database.prepare(`
    UPDATE blocks SET location_revision = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND location_revision = ?
  `).run(
    parentRevision,
    now,
    page.id,
    page.projectId,
    page.parentRevision,
  );
  if (updatedPage.changes !== 1) {
    throw new Error(`Page ${page.id} changed during Library move`);
  }
  synchronizeCanonicalPageRevisions(database, page.id, now);
  const committedPage = readExistingPage(database, request);
  refreshCanonicalPageProjections(database, request, committedPage, now);
  return existingPageCommit({
    request,
    page: committedPage,
    membership: null,
    libraryRankKey: rank.rankKey,
    expectedRevisions: { blockLocation: page.parentRevision },
    committedRevisions: { blockLocation: parentRevision },
    changePayload: { rebalancedLibraryPlacements: rank.rebalanced },
  });
};

const executeDelete = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "delete_page" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const page = readExistingPage(database, request);
  authorizeExistingPageWrite(database, request);
  const membership = readMembership(database, page.id);
  assertPageParentAndMembership(request, page, membership);
  if (page.lifecycle === "deleted") {
    return reject(
      "page_lifecycle_conflict",
      `Page ${page.id} is already deleted`,
      request,
    );
  }
  if (page.parentKind === "page" || page.locationKind === "document") {
    return reject(
      "page_parent_invalid",
      `Nested Page ${page.id} must be removed through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    "metadata",
    request.operation.expectedMetadataRevision,
    page.metadataRevision,
  );
  requireRevision(
    request,
    "parent",
    request.operation.expectedParentRevision,
    page.parentRevision,
  );
  const closure = readCurrentIndexedClosure(database, request, page);
  const contentBlocks = closure.blocks.filter((block) => block.id !== page.id);
  const inactiveContent = contentBlocks.find(
    (block) => block.lifecycle !== "active",
  );
  if (inactiveContent) {
    return reject(
      "document_state_corrupt",
      `Indexed Block ${inactiveContent.id} is ${inactiveContent.lifecycle}, not active`,
      request,
    );
  }
  const position = membership
    ? readSelectedPosition(database, page.id, membership.dataSourceId)
    : null;
  const status = membership
    ? readMembershipStatus(database, request, membership)
    : null;
  const libraryPlacement = database.prepare(`
    SELECT rank_key FROM library_block_placements WHERE block_id = ?
  `).get(page.id) as { readonly rank_key: string } | undefined;
  if (page.parentKind === "library" && !libraryPlacement) {
    return reject(
      "page_parent_invalid",
      `Library Page ${page.id} has no placement`,
      request,
    );
  }

  database.prepare(
    "DELETE FROM database_view_page_positions WHERE page_block_id = ?",
  ).run(page.id);
  if (membership) {
    const removed = database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE id = ? AND data_source_id = ? AND removed_at IS NULL
        AND revision = ?
    `).run(
      now,
      membership.id,
      membership.dataSourceId,
      membership.revision,
    );
    if (removed.changes !== 1) {
      throw new Error(`Membership ${membership.id} changed during deletion`);
    }
  }
  database.prepare(
    "DELETE FROM library_block_placements WHERE block_id = ?",
  ).run(page.id);
  const metadataRevision = page.metadataRevision + 1;
  const parentRevision = page.parentRevision + 1;
  const updated = database.prepare(`
    UPDATE blocks
    SET lifecycle = 'deleted', metadata_revision = ?, location_revision = ?,
      updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = ?
      AND metadata_revision = ? AND location_revision = ?
  `).run(
    metadataRevision,
    parentRevision,
    now,
    page.id,
    page.projectId,
    page.lifecycle,
    page.metadataRevision,
    page.parentRevision,
  );
  if (updated.changes !== 1) {
    throw new Error(`Page ${page.id} changed during deletion`);
  }
  const tombstone = database.prepare(`
    UPDATE blocks
    SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1,
      updated_at = ?
    WHERE id = ? AND lifecycle = 'active' AND metadata_revision = ?
  `);
  const tombstonedBlocks = contentBlocks.map((block) => {
    const result = tombstone.run(now, block.id, block.metadataRevision);
    if (result.changes !== 1) {
      throw new Error(`Indexed Block ${block.id} changed during deletion`);
    }
    return {
      id: block.id,
      expectedMetadataRevision: block.metadataRevision,
      committedMetadataRevision: block.metadataRevision + 1,
    };
  });
  synchronizeCanonicalPageRevisions(database, page.id, now);
  const committedPage = readExistingPage(database, request);
  refreshCanonicalPageProjections(database, request, committedPage, now);
  const removedMembership = membership
    ? { ...membership, revision: membership.revision + 1, removedAt: now }
    : null;
  const indexedRevisions = Object.fromEntries(
    tombstonedBlocks.map((block) => [
      `indexedBlockMetadata:${block.id}`,
      block.expectedMetadataRevision,
    ]),
  );
  const committedIndexedRevisions = Object.fromEntries(
    tombstonedBlocks.map((block) => [
      `indexedBlockMetadata:${block.id}`,
      block.committedMetadataRevision,
    ]),
  );
  return existingPageCommit({
    request,
    page: committedPage,
    membership: removedMembership,
    viewId: position?.viewId ?? null,
    viewRankKey: null,
    targetBlockIds: closure.blocks.map((block) => block.id),
    affectedDocumentIds: closure.documentIds,
    fieldIntents: [
      { path: `pages.${page.id}.lifecycle`, operation: "delete" },
      ...tombstonedBlocks.map((block) => ({
        path: `blocks.${block.id}.lifecycle`,
        operation: "delete",
      })),
    ],
    expectedRevisions: {
      blockMetadata: page.metadataRevision,
      blockLocation: page.parentRevision,
      ...(membership ? { membership: membership.revision } : {}),
      ...indexedRevisions,
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: parentRevision,
      ...(membership ? { membership: membership.revision + 1 } : {}),
      ...committedIndexedRevisions,
    },
    changePayload: {
      previousLifecycle: page.lifecycle,
      removedMembershipId: membership?.id ?? null,
      removedDatabaseId: membership?.databaseId ?? null,
      removedDataSourceId: membership?.dataSourceId ?? null,
      removedViewId: position?.viewId ?? null,
      previousStatus: status,
      previousLibraryRankKey: libraryPlacement?.rank_key ?? null,
      previousViewRankKey: position?.rankKey ?? null,
      indexedDocumentIds: closure.documentIds,
      tombstonedBlocks,
    },
  });
};

interface DeleteEvidenceV2 {
  readonly previousLifecycle: "active" | "archived";
  readonly membershipId: string | null;
  readonly databaseId: string | null;
  readonly dataSourceId: DataSourceId | null;
  readonly viewId: string | null;
  readonly status: WorkflowStatus | null;
  readonly tombstonedBlocks: readonly Readonly<{
    readonly id: string;
    readonly committedMetadataRevision: number;
  }>[];
  readonly indexedDocumentIds: readonly string[];
}

const readObject = (
  value: unknown,
): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const parseStringList = (value: string): readonly string[] | null => {
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

const readDeleteEvidenceV2 = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "restore_page" }
    >;
  },
  page: ExistingPageAuthority,
): DeleteEvidenceV2 => {
  const row = database.prepare(`
    SELECT
      mutation.project_id,
      mutation.store_epoch,
      mutation.mutation_kind,
      mutation.request_hash,
      mutation.target_block_ids_json,
      mutation.affected_document_ids_json,
      mutation.affected_database_block_ids_json,
      mutation.outcome,
      mutation.result_json,
      mutation.change_log_seq,
      change.project_id AS change_project_id,
      change.store_epoch AS change_store_epoch,
      change.kind AS change_kind,
      change.operation_id AS change_operation_id,
      change.block_ids_json,
      change.document_ids_json,
      change.database_block_ids_json,
      change.payload_json
    FROM block_mutations mutation
    INNER JOIN change_log change ON change.seq = mutation.change_log_seq
    WHERE mutation.mutation_id = ?
  `).get(request.operation.deleteOperationId) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly mutation_kind: string;
        readonly request_hash: string;
        readonly target_block_ids_json: string;
        readonly affected_document_ids_json: string;
        readonly affected_database_block_ids_json: string;
        readonly outcome: string;
        readonly result_json: string;
        readonly change_log_seq: number;
        readonly change_project_id: string;
        readonly change_store_epoch: string;
        readonly change_kind: string;
        readonly change_operation_id: string | null;
        readonly block_ids_json: string;
        readonly document_ids_json: string;
        readonly database_block_ids_json: string;
        readonly payload_json: string;
      }
    | undefined;
  if (!row) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence does not exist: ${request.operation.deleteOperationId}`,
      request,
    );
  }
  if (
    row.project_id !== request.projectId ||
    row.store_epoch !== request.storeEpoch ||
    row.mutation_kind !== MUTATION_KIND ||
    row.outcome !== "committed" ||
    row.change_project_id !== row.project_id ||
    row.change_store_epoch !== row.store_epoch ||
    row.change_kind !== "block_mutation" ||
    row.change_operation_id !== request.operation.deleteOperationId ||
    row.block_ids_json !== row.target_block_ids_json ||
    row.document_ids_json !== row.affected_document_ids_json ||
    row.database_block_ids_json !== row.affected_database_block_ids_json
  ) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} has divergent ledger identity`,
      request,
    );
  }
  let result: PageLifecycleMutationCommandResultV2;
  let payload: Readonly<Record<string, unknown>>;
  try {
    result = parsePageLifecycleMutationCommandResultV2(
      JSON.parse(row.result_json) as unknown,
    );
    const candidate = readObject(JSON.parse(row.payload_json) as unknown);
    if (!candidate) throw new Error("change payload is not an object");
    payload = candidate;
  } catch (error) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is corrupt: ${
        error instanceof Error ? error.message : String(error)
      }`,
      request,
    );
  }
  if (!result.ok) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is not committed`,
      request,
    );
  }
  const receipt = result.value;
  const previousLifecycle = payload.previousLifecycle;
  const membershipId = payload.removedMembershipId;
  const databaseId = payload.removedDatabaseId;
  const rawDataSourceId = payload.removedDataSourceId;
  const viewId = payload.removedViewId;
  const status = payload.previousStatus;
  const rawTombstones = payload.tombstonedBlocks;
  const rawDocuments = payload.indexedDocumentIds;
  if (
    (previousLifecycle !== "active" && previousLifecycle !== "archived") ||
    (membershipId !== null && typeof membershipId !== "string") ||
    (databaseId !== null && typeof databaseId !== "string") ||
    (rawDataSourceId !== null && typeof rawDataSourceId !== "string") ||
    (viewId !== null && typeof viewId !== "string") ||
    (status !== null && !isWorkflowStatus(status)) ||
    !Array.isArray(rawTombstones) ||
    !Array.isArray(rawDocuments) ||
    rawDocuments.some((id) => typeof id !== "string")
  ) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} has invalid coordinates`,
      request,
    );
  }
  let dataSourceId: DataSourceId | null = null;
  try {
    dataSourceId = rawDataSourceId === null
      ? null
      : parseDataSourceId(rawDataSourceId);
  } catch {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} has an invalid Data Source`,
      request,
    );
  }
  const tombstonedBlocks = rawTombstones.flatMap((candidate) => {
    const block = readObject(candidate);
    return block &&
      typeof block.id === "string" &&
      Number.isSafeInteger(block.committedMetadataRevision) &&
      (block.committedMetadataRevision as number) >= 1
      ? [{
          id: block.id,
          committedMetadataRevision: block.committedMetadataRevision as number,
        }]
      : [];
  });
  const targetIds = parseStringList(row.target_block_ids_json);
  const documentIds = parseStringList(row.affected_document_ids_json);
  const databaseIds = parseStringList(row.affected_database_block_ids_json);
  const currentClosure = readCurrentIndexedClosure(database, request, page);
  const currentContent = currentClosure.blocks.filter(
    (block) => block.id !== page.id,
  );
  const expectedTargetIds = uniqueSorted([
    page.id,
    ...currentContent.map((block) => block.id),
    ...(databaseId === null ? [] : [databaseId as string]),
  ]);
  const evidenceMatches =
    payload.requestHash === row.request_hash &&
    payload.mutationKind === MUTATION_KIND &&
    payload.operation === "delete_page" &&
    payload.pageId === page.id &&
    receipt.operationId === request.operation.deleteOperationId &&
    receipt.operationKind === "delete_page" &&
    receipt.projectId === request.projectId &&
    receipt.storeEpoch === request.storeEpoch &&
    receipt.pageId === page.id &&
    receipt.lifecycle === "deleted" &&
    receipt.metadataRevision === page.metadataRevision &&
    receipt.parentRevision === page.parentRevision &&
    receipt.documentId === page.documentId &&
    receipt.documentGeneration === page.documentGeneration &&
    receipt.documentHeadSeq === page.documentHeadSeq &&
    receipt.membershipId === membershipId &&
    receipt.databaseId === databaseId &&
    receipt.dataSourceId === dataSourceId &&
    receipt.viewId === viewId &&
    receipt.changeLogSeq === row.change_log_seq &&
    tombstonedBlocks.length === rawTombstones.length &&
    uniqueSorted(tombstonedBlocks.map((block) => block.id)).join("\0") ===
      uniqueSorted(currentContent.map((block) => block.id)).join("\0") &&
    tombstonedBlocks.every((block) => {
      const current = currentContent.find((entry) => entry.id === block.id);
      return current?.lifecycle === "deleted" &&
        current.metadataRevision === block.committedMetadataRevision;
    }) &&
    uniqueSorted(rawDocuments as string[]).join("\0") ===
      currentClosure.documentIds.join("\0") &&
    targetIds !== null && targetIds.join("\0") === expectedTargetIds.join("\0") &&
    documentIds !== null &&
    documentIds.join("\0") === currentClosure.documentIds.join("\0") &&
    databaseIds !== null &&
    (databaseId === null
      ? databaseIds.length === 0
      : databaseIds.length === 1 && databaseIds[0] === databaseId);
  if (!evidenceMatches) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} does not name the current Page tombstone`,
      request,
    );
  }
  return {
    previousLifecycle,
    membershipId: membershipId as string | null,
    databaseId: databaseId as string | null,
    dataSourceId,
    viewId: viewId as string | null,
    status: status as WorkflowStatus | null,
    tombstonedBlocks,
    indexedDocumentIds: rawDocuments as string[],
  };
};

const executeRestore = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "restore_page" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const page = readExistingPage(database, request);
  authorizeExistingPageWrite(database, request);
  if (page.lifecycle !== "deleted") {
    return reject(
      "page_lifecycle_conflict",
      `Page ${page.id} is ${page.lifecycle}; restore requires deleted`,
      request,
    );
  }
  if (page.parentKind === "page" || page.locationKind === "document") {
    return reject(
      "page_parent_invalid",
      `Nested Page ${page.id} must be restored through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    "metadata",
    request.operation.expectedMetadataRevision,
    page.metadataRevision,
  );
  requireRevision(
    request,
    "parent",
    request.operation.expectedParentRevision,
    page.parentRevision,
  );
  if (readMembership(database, page.id)) {
    return reject(
      "page_lifecycle_conflict",
      `Deleted Page ${page.id} unexpectedly has an active membership`,
      request,
    );
  }
  const evidence = readDeleteEvidenceV2(database, request, page);
  const requestedMembership = request.operation.membership;
  const evidenceMatchesRequest =
    (requestedMembership === null && evidence.membershipId === null) ||
    (requestedMembership !== null &&
      requestedMembership.membershipId === evidence.membershipId &&
      requestedMembership.databaseId === evidence.databaseId &&
      requestedMembership.dataSourceId === evidence.dataSourceId &&
      requestedMembership.status === evidence.status &&
      (requestedMembership.position?.viewId ?? null) === evidence.viewId);
  if (!evidenceMatchesRequest) {
    return reject(
      "delete_evidence_invalid",
      `Restore membership does not match delete ${request.operation.deleteOperationId}`,
      request,
    );
  }
  if (
    (requestedMembership === null && page.parentKind !== "library") ||
    (requestedMembership !== null && page.parentKind !== "data_source")
  ) {
    return reject(
      "delete_evidence_invalid",
      `Restore parent does not match Page ${page.id} tombstone`,
      request,
    );
  }

  let membership: CanonicalMembership | null = null;
  let positionRank: { readonly rankKey: string; readonly rebalanced: number } | null = null;
  if (requestedMembership) {
    let requestedDataSourceId: DataSourceId;
    try {
      requestedDataSourceId = parseDataSourceId(requestedMembership.dataSourceId);
    } catch {
      return reject(
        "data_source_not_found",
        `Restore Data Source is invalid: ${requestedMembership.dataSourceId}`,
        request,
      );
    }
    const row = database.prepare(`
      SELECT
        membership.id,
        membership.data_source_id,
        source.home_database_block_id AS database_id,
        membership.revision,
        membership.removed_at
      FROM data_source_page_memberships membership
      INNER JOIN data_sources source
        ON source.id = membership.data_source_id
       AND source.lifecycle = 'active'
      WHERE membership.id = ?
        AND membership.data_source_id = ?
        AND membership.page_block_id = ?
        AND membership.removed_at IS NOT NULL
    `).get(
      requestedMembership.membershipId,
      requestedDataSourceId,
      page.id,
    ) as
      | {
          readonly id: string;
          readonly data_source_id: DataSourceId;
          readonly database_id: string;
          readonly revision: number;
          readonly removed_at: string;
        }
      | undefined;
    if (!row || row.database_id !== requestedMembership.databaseId) {
      return reject(
        "membership_not_found",
        `Removed membership ${requestedMembership.membershipId} is not restorable`,
        request,
      );
    }
    membership = {
      id: row.id,
      dataSourceId: row.data_source_id,
      databaseId: row.database_id,
      revision: row.revision,
      removedAt: row.removed_at,
    };
    const sourceAuthorization = authorizeProjectResourceInDatabase(database, {
      projectId: request.projectId,
      resource: { kind: "data_source", dataSourceId: requestedDataSourceId },
      action: "create_child",
    });
    if (!sourceAuthorization.allowed) {
      return reject(
        "authorization_denied",
        `Page restore in Data Source ${requestedDataSourceId} was denied: ${sourceAuthorization.reason}`,
        request,
      );
    }
    readDatabaseProjection(
      database,
      request,
      { ...membership, removedAt: null },
    );
    const persistedStatus = readMembershipStatus(database, request, membership);
    if (persistedStatus !== requestedMembership.status) {
      return reject(
        "delete_evidence_invalid",
        `Removed membership ${membership.id} changed status after delete`,
        request,
      );
    }
    if (requestedMembership.position) {
      const view = database.prepare(`
        SELECT 1 FROM database_views
        WHERE id = ? AND database_block_id = ? AND data_source_id = ?
          AND lifecycle = 'active'
      `).get(
        requestedMembership.position.viewId,
        requestedMembership.databaseId,
        requestedDataSourceId,
      );
      if (!view) {
        return reject(
          "view_not_found",
          `Restore View ${requestedMembership.position.viewId} is unavailable`,
          request,
        );
      }
      positionRank = allocateExistingViewRank(database, request, {
        viewId: requestedMembership.position.viewId,
        groupKey: databaseGroupKeyForValue(requestedMembership.status),
        ...(requestedMembership.position.beforeViewPageId === undefined
          ? {}
          : { beforePageId: requestedMembership.position.beforeViewPageId }),
        now,
      });
    }
  }

  const libraryRank = requestedMembership === null
    ? allocateLibraryRank(
        database,
        request,
        page,
        request.operation.beforeBlockId,
        now,
      )
    : null;
  const metadataRevision = page.metadataRevision + 1;
  const parentRevision = page.parentRevision + 1;
  const updatedPage = database.prepare(`
    UPDATE blocks
    SET lifecycle = ?, metadata_revision = ?, location_revision = ?,
      updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'deleted'
      AND metadata_revision = ? AND location_revision = ?
  `).run(
    evidence.previousLifecycle,
    metadataRevision,
    parentRevision,
    now,
    page.id,
    page.projectId,
    page.metadataRevision,
    page.parentRevision,
  );
  if (updatedPage.changes !== 1) {
    throw new Error(`Page ${page.id} changed during restore`);
  }
  const restoreBlock = database.prepare(`
    UPDATE blocks
    SET lifecycle = 'active', metadata_revision = metadata_revision + 1,
      updated_at = ?
    WHERE id = ? AND lifecycle = 'deleted' AND metadata_revision = ?
  `);
  const restoredBlocks = evidence.tombstonedBlocks.map((block) => {
    const restored = restoreBlock.run(
      now,
      block.id,
      block.committedMetadataRevision,
    );
    if (restored.changes !== 1) {
      throw new Error(`Indexed Block ${block.id} changed during restore`);
    }
    return {
      id: block.id,
      expectedMetadataRevision: block.committedMetadataRevision,
      committedMetadataRevision: block.committedMetadataRevision + 1,
    };
  });
  if (libraryRank) {
    database.prepare(`
      INSERT INTO library_block_placements (
        block_id, library_id, rank_key, revision, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)
    `).run(page.id, page.libraryId, libraryRank.rankKey, now, now);
  }
  let restoredMembership: CanonicalMembership | null = null;
  if (membership) {
    const restored = database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = NULL, revision = revision + 1
      WHERE id = ? AND data_source_id = ? AND removed_at IS NOT NULL
        AND revision = ?
    `).run(membership.id, membership.dataSourceId, membership.revision);
    if (restored.changes !== 1) {
      throw new Error(`Membership ${membership.id} changed during restore`);
    }
    restoredMembership = {
      ...membership,
      revision: membership.revision + 1,
      removedAt: null,
    };
    if (requestedMembership?.position && positionRank) {
      database.prepare(`
        INSERT INTO database_view_page_positions (
          view_id, page_block_id, group_key, rank_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(
        requestedMembership.position.viewId,
        page.id,
        databaseGroupKeyForValue(requestedMembership.status),
        positionRank.rankKey,
        now,
        now,
      );
    }
  }
  synchronizeCanonicalPageRevisions(database, page.id, now);
  const committedPage = readExistingPage(database, request);
  refreshCanonicalPageProjections(database, request, committedPage, now);
  const expectedIndexed = Object.fromEntries(restoredBlocks.map((block) => [
    `indexedBlockMetadata:${block.id}`,
    block.expectedMetadataRevision,
  ]));
  const committedIndexed = Object.fromEntries(restoredBlocks.map((block) => [
    `indexedBlockMetadata:${block.id}`,
    block.committedMetadataRevision,
  ]));
  return existingPageCommit({
    request,
    page: committedPage,
    membership: restoredMembership,
    viewId: requestedMembership?.position?.viewId ?? null,
    libraryRankKey: libraryRank?.rankKey ?? null,
    viewRankKey: positionRank?.rankKey ?? null,
    targetBlockIds: [page.id, ...restoredBlocks.map((block) => block.id)],
    affectedDocumentIds: evidence.indexedDocumentIds,
    fieldIntents: [
      { path: `pages.${page.id}.lifecycle`, operation: "restore" },
      ...restoredBlocks.map((block) => ({
        path: `blocks.${block.id}.lifecycle`,
        operation: "restore",
      })),
    ],
    expectedRevisions: {
      blockMetadata: page.metadataRevision,
      blockLocation: page.parentRevision,
      ...(membership ? { membership: membership.revision } : {}),
      ...expectedIndexed,
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: parentRevision,
      ...(restoredMembership
        ? { membership: restoredMembership.revision }
        : {}),
      ...(positionRank ? { viewPosition: 1 } : {}),
      ...committedIndexed,
    },
    changePayload: {
      deleteOperationId: request.operation.deleteOperationId,
      restoredLifecycle: evidence.previousLifecycle,
      restoredMembershipId: restoredMembership?.id ?? null,
      status: requestedMembership?.status ?? null,
      rebalancedLibraryPlacements: libraryRank?.rebalanced ?? 0,
      rebalancedViewPositions: positionRank?.rebalanced ?? 0,
      restoredBlockIds: [page.id, ...restoredBlocks.map((block) => block.id)],
      indexedDocumentIds: evidence.indexedDocumentIds,
    },
  });
};

const executeAuthority = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  now: string,
  options: ApplyPageLifecycleMutationV2Options,
): AuthorityCommit => {
  switch (request.operation.kind) {
    case "create_page":
      return executeCreate(
        database,
        request as PageLifecycleMutationRequestV2 & {
          readonly operation: CreatePageOperationV2;
        },
        now,
        options,
      );
    case "archive_page":
    case "unarchive_page":
      return executeLifecycleTransition(
        database,
        request as PageLifecycleMutationRequestV2 & {
          readonly operation: Extract<
            PageLifecycleOperationV2,
            { readonly kind: "archive_page" | "unarchive_page" }
          >;
        },
        now,
      );
    case "delete_page":
      return executeDelete(
        database,
        request as PageLifecycleMutationRequestV2 & {
          readonly operation: Extract<
            PageLifecycleOperationV2,
            { readonly kind: "delete_page" }
          >;
        },
        now,
      );
    case "restore_page":
      return executeRestore(
        database,
        request as PageLifecycleMutationRequestV2 & {
          readonly operation: Extract<
            PageLifecycleOperationV2,
            { readonly kind: "restore_page" }
          >;
        },
        now,
      );
    case "move_page_in_library":
      return executeMoveInLibrary(
        database,
        request as PageLifecycleMutationRequestV2 & {
          readonly operation: Extract<
            PageLifecycleOperationV2,
            { readonly kind: "move_page_in_library" }
          >;
        },
        now,
      );
  }
};

const logicalRequest = (
  request: PageLifecycleMutationRequestV2,
): Readonly<Record<string, unknown>> => ({
  version: PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
  projectId: request.projectId,
  operation: request.operation,
});

const prepareOperation = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
): PreparedAuthoritativeOperation<PageLifecycleMutationCommandResultV2> =>
  prepareAuthoritativeOperation(
    database,
    {
      operationId: request.operationId,
      projectId: request.projectId,
      mutationKind: MUTATION_KIND,
      logicalRequest: logicalRequest(request),
      actor: request.actor,
      clientSessionId: request.clientSessionId,
    },
    parsePageLifecycleMutationCommandResultV2,
  );

const validateReplay = (
  request: PageLifecycleMutationRequestV2,
  prepared: PreparedAuthoritativeOperation<PageLifecycleMutationCommandResultV2>,
): PageLifecycleMutationCommandResultV2 | null => {
  if (prepared.kind !== "replay") return null;
  if (!prepared.result.ok) {
    if (prepared.outcome === "rejected") return prepared.result;
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Page lifecycle v2 operation ${request.operationId} stored a rejected committed result`,
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
      `Page lifecycle v2 operation ${request.operationId} stored a divergent receipt`,
    );
  }
  return { ok: true, value: { ...receipt, duplicate: true } };
};

const persistRejection = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  evidence: AuthoritativeOperationEvidence,
  error: PageLifecycleMutationCommandErrorV2,
  now: string,
): PageLifecycleMutationCommandResultV2 => {
  const result: PageLifecycleMutationCommandResultV2 = { ok: false, error };
  const targetExists = database.prepare(
    "SELECT 1 FROM blocks WHERE id = ? AND project_id = ?",
  ).get(request.operation.pageId, request.projectId);
  return persistAuthoritativeOperationRejection(database, {
    evidence,
    targetBlockIds: targetExists ? [request.operation.pageId] : [],
    fieldIntents: [
      {
        path: `pages.${request.operation.pageId}`,
        operation: request.operation.kind,
      },
    ],
    rejectedAt: now,
    result,
  });
};

const makeReceipt = (
  request: PageLifecycleMutationRequestV2,
  commit: AuthorityCommit,
  changeLogSeq: number,
  now: string,
): PageLifecycleMutationCommandResultV2 => ({
  ok: true,
  value: {
    version: PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
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
    dataSourceId: commit.dataSourceId,
    membershipId: commit.membershipId,
    viewId: commit.viewId,
    libraryRankKey: commit.libraryRankKey,
    viewRankKey: commit.viewRankKey,
    createdBlockIds: commit.createdBlockIds,
    createdTagOptionIds: commit.createdTagOptionIds,
    changeLogSeq,
    committedAt: now,
  },
});

const isRequestIdentity = (
  value: unknown,
): value is Pick<PageLifecycleMutationRequestV2, "operationId" | "operation"> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const request = value as Readonly<Record<string, unknown>>;
  if (typeof request.operationId !== "string") return false;
  const operation = request.operation;
  return (
    typeof operation === "object" &&
    operation !== null &&
    !Array.isArray(operation) &&
    typeof (operation as Readonly<Record<string, unknown>>).pageId === "string"
  );
};

/**
 * Canonical schema-v81 Page lifecycle authority. Every v2 operation executes
 * only against Page, Data Source, View, projection, and immutable receipt
 * authorities.
 */
export const applyPageLifecycleMutationV2 = (
  database: Database.Database,
  rawRequest: unknown,
  options: ApplyPageLifecycleMutationV2Options = {},
): PageLifecycleMutationCommandResultV2 => {
  let parsed: PageLifecycleMutationRequestV2;
  try {
    parsed = parsePageLifecycleMutationRequestV2(rawRequest);
  } catch (error) {
    if (!(error instanceof PageLifecycleV2ContractError)) throw error;
    return {
      ok: false,
      error: makeError(
        "invalid_page_lifecycle_request",
        error.message,
        isRequestIdentity(rawRequest) ? rawRequest : undefined,
      ),
    };
  }
  const request = parsed;
  if (readUserVersion(database) !== CANONICAL_SCHEMA_VERSION) {
    return {
      ok: false,
      error: makeError(
        "invalid_page_lifecycle_request",
        `Page Lifecycle v2 authority requires canonical schema v${CANONICAL_SCHEMA_VERSION}`,
        request,
      ),
    };
  }

  const inject = (point: PageLifecycleV2StoreFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): PageLifecycleMutationCommandResultV2 => {
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

    let prepared: PreparedAuthoritativeOperation<PageLifecycleMutationCommandResultV2>;
    try {
      prepared = prepareOperation(database, request);
      const replay = validateReplay(request, prepared);
      if (replay) return replay;
    } catch (error) {
      if (error instanceof AuthoritativeOperationReceiptError) {
        return {
          ok: false,
          error: makeError(error.code, error.message, request),
        };
      }
      throw error;
    }
    if (prepared.kind !== "new") {
      throw new Error("Page Lifecycle v2 replay escaped validation");
    }

    const now = options.now?.() ?? new Date().toISOString();
    let commit: AuthorityCommit;
    try {
      commit = database.transaction(() =>
        executeAuthority(database, request, now, options),
      )();
    } catch (error) {
      const rejection =
        error instanceof PageLifecycleV2Rejection
          ? error.error
          : error instanceof BlockDocumentCodecError ||
              error instanceof BlockDocumentStoreError
            ? makeError(
                "invalid_page_lifecycle_request",
                error.message,
                request,
              )
            : null;
      if (!rejection) throw error;
      const result = persistRejection(
        database,
        request,
        prepared.evidence,
        rejection,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return result;
    }
    inject("after_authority");
    inject("after_projections");
    const persisted = persistAuthoritativeOperationReceipt(database, {
      evidence: prepared.evidence,
      targetBlockIds: commit.targetBlockIds,
      affectedDocumentIds: commit.affectedDocumentIds,
      affectedDatabaseBlockIds: commit.affectedDatabaseIds,
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
    inject("after_ledger");
    inject("before_commit");
    return persisted.result;
  });
  const result = apply.immediate();
  inject("after_commit");
  return result;
};

const readLifecycleChangeLogSeqV2 = (database: Database.Database): number =>
  (database.prepare(`
    SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log
  `).get() as { readonly seq: number }).seq;

const internalLifecycleRequestV2 = (input: {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly pageId: string;
}): PageLifecycleMutationRequestV2 => ({
  version: PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
  operationId: "internal:page-lifecycle-v2-preflight",
  projectId: input.projectId,
  storeEpoch: input.storeEpoch,
  actor: { kind: "internal_preflight" },
  operation: {
    kind: "archive_page",
    pageId: input.pageId,
    expectedMetadataRevision: 0,
  },
});

const readMembershipCoordinateV2 = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  membership: CanonicalMembership | null,
): PageLifecycleMembershipCoordinateV2 | null => {
  if (!membership) return null;
  const row = database.prepare(`
    WITH selected_view AS (
      SELECT view.id, view.revision
      FROM database_views view
      INNER JOIN database_containers container
        ON container.block_id = view.database_block_id
      WHERE view.data_source_id = ?
        AND view.lifecycle = 'active'
      ORDER BY
        CASE WHEN view.id = container.default_view_id THEN 0 ELSE 1 END,
        view.rank_key,
        view.id
      LIMIT 1
    )
    SELECT
      selected_view.id AS view_id,
      selected_view.revision AS view_revision,
      property.id AS status_property_id,
      value.revision AS status_value_revision,
      value.value_json,
      position.group_key,
      position.rank_key,
      position.revision AS position_revision
    FROM selected_view
    INNER JOIN data_source_properties property
      ON property.data_source_id = ?
     AND property.id = 'status'
     AND property.lifecycle = 'active'
     AND property.value_type = 'select'
    INNER JOIN data_source_property_values value
      ON value.data_source_id = property.data_source_id
     AND value.membership_id = ?
     AND value.property_id = property.id
    LEFT JOIN database_view_page_positions position
      ON position.view_id = selected_view.id
     AND position.page_block_id = ?
  `).get(
    membership.dataSourceId,
    membership.dataSourceId,
    membership.id,
    request.operation.pageId,
  ) as
    | {
        readonly view_id: string;
        readonly view_revision: number;
        readonly status_property_id: string;
        readonly status_value_revision: number;
        readonly value_json: string;
        readonly group_key: string | null;
        readonly rank_key: string | null;
        readonly position_revision: number | null;
      }
    | undefined;
  if (!row) {
    return reject(
      "database_schema_invalid",
      `Page ${request.operation.pageId} membership has no active View/status coordinate`,
      request,
    );
  }
  let status: unknown;
  try {
    status = JSON.parse(row.value_json) as unknown;
  } catch {
    status = undefined;
  }
  if (!isWorkflowStatus(status)) {
    return reject(
      "database_property_value_invalid",
      `Page ${request.operation.pageId} membership has an invalid status value`,
      request,
    );
  }
  const hasPosition = row.rank_key !== null && row.position_revision !== null;
  if (
    hasPosition &&
    row.group_key !== databaseGroupKeyForValue(status)
  ) {
    return reject(
      "database_property_value_invalid",
      `Page ${request.operation.pageId} status and View position diverge`,
      request,
    );
  }
  if (
    (row.rank_key === null) !== (row.position_revision === null)
  ) {
    return reject(
      "database_schema_invalid",
      `Page ${request.operation.pageId} has an incomplete View position`,
      request,
    );
  }
  return {
    membershipId: membership.id,
    databaseId: membership.databaseId,
    dataSourceId: membership.dataSourceId,
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

const readLatestDeleteOperationIdV2 = (
  database: Database.Database,
  projectId: string,
  storeEpoch: string,
  pageId: string,
): string | null =>
  (database.prepare(`
    SELECT mutation_id
    FROM block_mutations
    WHERE project_id = ?
      AND store_epoch = ?
      AND mutation_kind = ?
      AND outcome = 'committed'
      AND json_extract(request_json, '$.version') = ?
      AND json_extract(request_json, '$.operation.kind') = 'delete_page'
      AND json_extract(request_json, '$.operation.pageId') = ?
    ORDER BY change_log_seq DESC
    LIMIT 1
  `).get(
    projectId,
    storeEpoch,
    MUTATION_KIND,
    PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
    pageId,
  ) as { readonly mutation_id: string } | undefined)?.mutation_id ?? null;

const readRestoreEvidenceV2ForPreflight = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
  page: ExistingPageAuthority,
): PageLifecycleRestoreEvidenceV2 | null => {
  if (page.lifecycle !== "deleted") return null;
  const deleteOperationId = readLatestDeleteOperationIdV2(
    database,
    request.projectId,
    request.storeEpoch,
    page.id,
  );
  if (!deleteOperationId) {
    return reject(
      "delete_evidence_invalid",
      `Deleted Page ${page.id} has no committed v2 delete receipt`,
      request,
    );
  }
  const evidenceRequest: PageLifecycleMutationRequestV2 & {
    readonly operation: Extract<
      PageLifecycleOperationV2,
      { readonly kind: "restore_page" }
    >;
  } = {
    ...request,
    operation: {
      kind: "restore_page",
      pageId: page.id,
      deleteOperationId,
      expectedMetadataRevision: page.metadataRevision,
      expectedParentRevision: page.parentRevision,
      membership: null,
    },
  };
  const evidence = readDeleteEvidenceV2(
    database,
    evidenceRequest,
    page,
  );
  const membership =
    evidence.membershipId &&
    evidence.databaseId &&
    evidence.dataSourceId &&
    evidence.status
      ? {
          membershipId: evidence.membershipId,
          databaseId: evidence.databaseId,
          dataSourceId: evidence.dataSourceId,
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

const readOwnedPageAuthorityV2 = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly pageId: string;
  },
): {
  readonly reservedBlockType: string | null;
  readonly page: PageLifecycleOwnedBlockAuthorityV2 | null;
} => {
  const identity = database.prepare(`
    SELECT type, project_id FROM blocks WHERE id = ?
  `).get(input.pageId) as
    | { readonly type: string; readonly project_id: string }
    | undefined;
  if (!identity) return { reservedBlockType: null, page: null };
  if (identity.type !== "page" || identity.project_id !== input.projectId) {
    return { reservedBlockType: identity.type, page: null };
  }
  const request = internalLifecycleRequestV2(input);
  const page = readExistingPage(database, request);
  const membership = readMembership(database, page.id);
  const parentMembership = page.lifecycle === "deleted"
    ? readMembership(database, page.id, { includeRemoved: true })
    : membership;
  assertPageParentAndMembership(request, page, parentMembership);
  const libraryPlacement = database.prepare(`
    SELECT rank_key
    FROM library_block_placements
    WHERE library_id = ? AND block_id = ?
  `).get(page.libraryId, page.id) as
    | { readonly rank_key: string }
    | undefined;
  if (page.parentKind === "library" && !libraryPlacement) {
    return reject(
      "page_parent_invalid",
      `Library Page ${page.id} has no Library placement`,
      request,
    );
  }
  return {
    reservedBlockType: null,
    page: {
      pageId: page.id,
      lifecycle: page.lifecycle,
      parent:
        page.parentKind === "library"
          ? { kind: "library", libraryId: page.parentId }
          : page.parentKind === "page"
            ? { kind: "page", pageId: page.parentId }
            : { kind: "data_source", dataSourceId: page.parentId },
      libraryRankKey: libraryPlacement?.rank_key ?? null,
      metadataRevision: page.metadataRevision,
      parentRevision: page.parentRevision,
      document: {
        documentId: page.documentId,
        generation: page.documentGeneration,
        headSeq: page.documentHeadSeq,
        readiness: "ready",
        authority: "ydoc_primary",
        schemaKey: PAGE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
      },
      membership: readMembershipCoordinateV2(database, request, membership),
      restoreEvidence: readRestoreEvidenceV2ForPreflight(
        database,
        request,
        page,
      ),
    },
  };
};

const lifecycleReadFailureV2 = (
  code: PageLifecyclePreflightErrorCodeV2,
  message: string,
  retryable = false,
): PageLifecyclePreflightResultV2 => ({
  ok: false,
  error: { code, message, retryable },
});

/**
 * Read one type-closed lifecycle compiler snapshot from canonical schema-v81
 * authority. The preflight never consults the removed v1 Database Module.
 */
export const readPageLifecyclePreflightSnapshotV2 = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): PageLifecyclePreflightResultV2 => {
  if (
    !projectId ||
    projectId !== projectId.trim() ||
    !pageId ||
    pageId !== pageId.trim() ||
    projectId.length > 512 ||
    pageId.length > 512
  ) {
    return lifecycleReadFailureV2(
      "invalid_request",
      "Page lifecycle v2 preflight requires canonical Project and Page identities",
    );
  }
  try {
    return database.transaction((): PageLifecyclePreflightResultV2 => {
      if (readUserVersion(database) !== CANONICAL_SCHEMA_VERSION) {
        return lifecycleReadFailureV2(
          "state_corrupt",
          `Page lifecycle v2 preflight requires canonical schema v${CANONICAL_SCHEMA_VERSION}`,
        );
      }
      const storeEpoch = readBlockStoreEpoch(database);
      if (!storeEpoch) {
        return lifecycleReadFailureV2(
          "store_not_initialized",
          "Block store metadata is missing",
          true,
        );
      }
      const project = database.prepare(`
        SELECT library_id FROM projects WHERE id = ?
      `).get(projectId) as { readonly library_id: string } | undefined;
      if (!project) {
        return lifecycleReadFailureV2(
          "project_not_found",
          `Project does not exist: ${projectId}`,
        );
      }
      const identity = database.prepare(`
        SELECT type, project_id FROM blocks WHERE id = ?
      `).get(pageId) as
        | { readonly type: string; readonly project_id: string }
        | undefined;
      if (identity?.type === "page" && identity.project_id === projectId) {
        const authorization = authorizeProjectResourceInDatabase(database, {
          projectId,
          resource: { kind: "page", pageId },
          action: "read",
        });
        if (!authorization.allowed) {
          return lifecycleReadFailureV2(
            "authorization_denied",
            `Page lifecycle v2 preflight denied: ${authorization.reason}`,
          );
        }
      }
      const databaseRead = readDatabaseModuleV2(database, {
        version: 2,
        projectId,
        read: { target: { kind: "project_default" }, mode: "query" },
      });
      if (!databaseRead.ok) {
        return lifecycleReadFailureV2(
          databaseRead.error.code === "project_not_found"
            ? "project_not_found"
            : databaseRead.error.code === "store_not_initialized"
              ? "store_not_initialized"
              : databaseRead.error.code === "authorization_denied"
                ? "authorization_denied"
                : databaseRead.error.code === "unknown"
                  ? "unknown"
                  : "state_corrupt",
          databaseRead.error.message,
          databaseRead.error.retryable,
        );
      }
      if (databaseRead.value.value.kind !== "query") {
        return lifecycleReadFailureV2(
          "state_corrupt",
          "Project default Database View v2 authority is incomplete",
        );
      }
      const query = databaseRead.value.value.value;
      const tagsProperty = query.properties.find(
        (property) => property.propertyId === "tags",
      );
      if (
        !tagsProperty ||
        tagsProperty.dataSourceId !== query.dataSource.dataSourceId ||
        tagsProperty.valueType !== "multi_select" ||
        tagsProperty.lifecycle !== "active"
      ) {
        return lifecycleReadFailureV2(
          "state_corrupt",
          "Project default Data Source has no active multi-select tags Property",
        );
      }
      const authority = readOwnedPageAuthorityV2(database, {
        projectId,
        storeEpoch,
        pageId,
      });
      return {
        ok: true,
        value: {
          version: 2,
          projectId,
          libraryId: project.library_id,
          storeEpoch,
          changeLogSeq: readLifecycleChangeLogSeqV2(database),
          value: {
            version: 2,
            defaultView: query,
            tagsProperty: {
              propertyId: tagsProperty.propertyId,
              dataSourceId: tagsProperty.dataSourceId,
              valueType: tagsProperty.valueType,
              lifecycle: tagsProperty.lifecycle,
              revision: tagsProperty.revision,
              config: tagsProperty.config,
            },
            reservedBlockType: authority.reservedBlockType,
            page: authority.page,
          },
        },
      };
    })();
  } catch (error) {
    if (error instanceof PageLifecycleV2Rejection) {
      return lifecycleReadFailureV2("state_corrupt", error.message);
    }
    return lifecycleReadFailureV2(
      "unknown",
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
};
