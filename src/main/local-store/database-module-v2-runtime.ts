import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import {
  isBuiltInDataSourcePropertyId,
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
  type DatabaseId,
  type DatabaseViewId,
  type DataSourceId,
  type DataSourceOptionId,
  type DataSourcePropertyId,
} from "../../shared/database-identities";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyOperationV2,
  type DatabaseApplyReceiptV2,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseContainerDescriptorV2,
  type DatabaseContainerRecordV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type LibraryDatabaseModuleReadRequestV2,
  type LibraryDatabaseModuleReadResultV2,
  type LibraryDatabaseApplyV2,
  type LibraryDatabaseApplyResultV2,
  type DatabaseModuleV2,
  type DatabaseReadValueV2,
  type DatabaseViewQueryResultV2,
  type DatabaseViewRecordV2,
  type DataSourceDescriptorV2,
  type DataSourcePageRowV2,
  type DataSourcePageValueV2,
  type PageIntrinsicPropertyValueV2,
  type DataSourcePropertyRecordV2,
  type DataSourceQueryResultV2,
  type DataSourceRecordV2,
  type DeleteDatabaseViewOperationV2,
  type DeleteDataSourcePropertyOperationV2,
  type DeleteDataSourceOptionOperationV2,
  type PositionDatabaseViewPageOperationV2,
  type PositionDatabaseViewPagesOperationV2,
  type PutDatabaseViewOperationV2,
  type PutDataSourcePropertyOperationV2,
  type PutDataSourceOptionOperationV2,
  type SetDataSourcePageValueOperationV2,
  type TransferDataSourcePageOperationV2,
} from "../../shared/database-module-v2";
import {
  bindDatabaseApplyV2,
  bindDatabaseModuleReadV2,
  parseDatabaseApplyResultV2,
} from "../../shared/database-module-v2-transport";
import {
  databaseGroupKeyForValue,
  evaluateDatabaseViewFilter,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfigV2,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type DatabaseViewConfigV2,
  type DatabaseViewFilterNode,
  type DatabaseViewKind,
  type DatabaseViewSort,
} from "../../shared/database-kernel";
import {
  dataSourceOptionRegistryConfig,
  DataSourceOptionRegistryError,
  deleteDataSourceOption,
  parseDataSourceOptionRegistry,
  putDataSourceOption,
  validateDataSourceOptionSelection,
  type DataSourceOptionRegistry,
} from "../../shared/data-source-option-registry";
import type {
  LibraryResource,
  ProjectResourceAction,
} from "../../shared/resource-authorization";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { NodexAgentResourceAccessOverlay } from "../../shared/nodex-agent-resource-access";
import { DEFAULT_WORKFLOW_STATUS } from "../../shared/workflow-status";
import {
  compareDatabaseViewOrderItems,
  type DatabaseViewOrderItem,
} from "./database-view-order";
import { planDatabaseFractionalRank } from "./database-fractional-rank";
import {
  DatabaseViewPositionPlanError,
  planDatabaseViewPositionRun,
  type LogicalDatabaseViewPositionItem,
} from "./database-view-position-plan";
import { readPagesInDatabase } from "./pages";
import {
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "./project-resource-grants";
import {
  authorizeContentResourceInDatabase,
  resolveContentResourceAuthorityInDatabase,
  type ContentResourceAuthority,
} from "./content-resource-authority";
import { libraryContentAccess } from "../../shared/content-access-context";
import { requireLocalProfileLibraryInDatabase } from "./local-profile-library";

const CANONICAL_DATABASE_SCHEMA_VERSION = 84;

interface ProjectRow {
  readonly id: string;
  readonly library_id: string;
  readonly database_block_id: string;
  readonly lifecycle: "active" | "inactive" | "archived";
}

interface DatabaseModuleReadAuthorityOptions {
  readonly authority?: FrozenNodexAgentTurnAuthority;
  readonly resourceAccess?: NodexAgentResourceAccessOverlay;
  readonly callId?: string;
  readonly contentAuthority?: Extract<
    ContentResourceAuthority,
    { readonly kind: "local_user_library" }
  >;
}

interface ContainerRow {
  readonly block_id: string;
  readonly library_id: string;
  readonly name: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly default_view_id: string | null;
  readonly access_revision: number;
  readonly metadata_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SourceRow {
  readonly id: string;
  readonly library_id: string;
  readonly home_database_block_id: string;
  readonly name: string;
  readonly schema_key: string;
  readonly schema_revision: number;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly rank_key: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PropertyRow {
  readonly data_source_id: string;
  readonly id: string;
  readonly name: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly schema_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly data_source_id: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
  readonly config_json: string;
  readonly revision: number;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly created_at: string;
  readonly updated_at: string;
}

interface MembershipRow {
  readonly id: string;
  readonly data_source_id: string;
  readonly page_block_id: string;
  readonly revision: number;
  readonly created_at: string;
  readonly group_key: string | null;
  readonly rank_key: string | null;
  readonly position_revision: number | null;
}

interface ValueRow {
  readonly membership_id: string;
  readonly property_id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly value_json: string;
  readonly revision: number;
}

interface StoredReceiptRow {
  readonly operation_id: string;
  readonly project_id: string;
  readonly library_id: string;
  readonly store_epoch: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly outcome: "committed" | "rejected";
  readonly result_json: string;
  readonly change_log_seq: number | null;
  readonly created_at: string;
}

interface ApplyAccumulator {
  readonly databaseIds: Set<DatabaseId>;
  readonly dataSourceIds: Set<DataSourceId>;
  readonly pageIds: Set<string>;
  readonly viewIds: Set<DatabaseViewId>;
  readonly revisions: Record<string, number>;
}

class DatabaseModuleV2StateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseModuleV2StateError";
  }
}

class DatabaseModuleV2Rejection extends Error {
  constructor(readonly error: DatabaseModuleErrorV2) {
    super(error.message);
    this.name = "DatabaseModuleV2Rejection";
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = <Identity extends string>(
  values: Iterable<Identity>,
): readonly Identity[] => [...new Set(values)].sort(compareStrings);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new DatabaseModuleV2StateError(`${label} contains invalid JSON`, {
      cause: error,
    });
  }
};

const parseDatabaseJson = (
  value: string,
  label: string,
): DatabaseJsonValue => parseJson(value, label) as DatabaseJsonValue;

const readSchemaVersion = (database: Database.Database): number =>
  database.pragma("user_version", { simple: true }) as number;

const requireCanonicalSchema = (database: Database.Database): void => {
  const version = readSchemaVersion(database);
  if (version === CANONICAL_DATABASE_SCHEMA_VERSION) return;
  throw new DatabaseModuleV2Rejection({
    code: "unsupported_operation",
    message:
      `Database Module v2 requires canonical schema v${CANONICAL_DATABASE_SCHEMA_VERSION}; received v${version}`,
    retryable: false,
  });
};

const readStoreEpoch = (database: Database.Database): string | null =>
  (database.prepare(`
    SELECT store_epoch AS storeEpoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly storeEpoch: string } | undefined)?.storeEpoch ?? null;

const readProject = (
  database: Database.Database,
  projectId: string,
): ProjectRow | null =>
  (database.prepare(`
    SELECT id, library_id, database_block_id, lifecycle
    FROM projects WHERE id = ?
  `).get(projectId) as ProjectRow | undefined) ?? null;

const readContainerRow = (
  database: Database.Database,
  databaseId: string,
): ContainerRow | null =>
  (database.prepare(`
    SELECT * FROM database_containers WHERE block_id = ?
  `).get(databaseId) as ContainerRow | undefined) ?? null;

const readSourceRow = (
  database: Database.Database,
  dataSourceId: string,
): SourceRow | null =>
  (database.prepare(`
    SELECT * FROM data_sources WHERE id = ?
  `).get(dataSourceId) as SourceRow | undefined) ?? null;

const readPropertyRow = (
  database: Database.Database,
  dataSourceId: string,
  propertyId: string,
): PropertyRow | null =>
  (database.prepare(`
    SELECT * FROM data_source_properties
    WHERE data_source_id = ? AND id = ?
  `).get(dataSourceId, propertyId) as PropertyRow | undefined) ?? null;

const readViewRow = (
  database: Database.Database,
  viewId: string,
): ViewRow | null =>
  (database.prepare(`
    SELECT * FROM database_views WHERE id = ?
  `).get(viewId) as ViewRow | undefined) ?? null;

const parsePropertyConfig = (
  row: PropertyRow,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const config = parseJson(
    row.config_json,
    `Property ${row.data_source_id}/${row.id} config`,
  );
  if (row.value_type !== "select" && row.value_type !== "multi_select") {
    return parseDatabasePropertyConfig(row.value_type, config);
  }
  const registry = parseDataSourceOptionRegistry({
    dataSourceId: row.data_source_id,
    propertyId: row.id,
    valueType: row.value_type,
    config,
  });
  return dataSourceOptionRegistryConfig(registry);
};

const readOptionRegistry = (row: PropertyRow): DataSourceOptionRegistry => {
  try {
    return parseDataSourceOptionRegistry({
      dataSourceId: row.data_source_id,
      propertyId: row.id,
      valueType: row.value_type,
      config: parseJson(
        row.config_json,
        `Property ${row.data_source_id}/${row.id} config`,
      ),
    });
  } catch (error) {
    if (!(error instanceof DataSourceOptionRegistryError)) throw error;
    throw new DatabaseModuleV2StateError(error.message, { cause: error });
  }
};

const rowToContainer = (row: ContainerRow): DatabaseContainerRecordV2 => ({
  databaseId: parseDatabaseId(row.block_id),
  libraryId: row.library_id,
  name: row.name,
  lifecycle: row.lifecycle,
  defaultViewId:
    row.default_view_id === null
      ? null
      : parseDatabaseViewId(row.default_view_id),
  accessRevision: row.access_revision,
  metadataRevision: row.metadata_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToSource = (row: SourceRow): DataSourceRecordV2 => ({
  dataSourceId: parseDataSourceId(row.id),
  libraryId: row.library_id,
  homeDatabaseId: parseDatabaseId(row.home_database_block_id),
  name: row.name,
  schemaKey: row.schema_key,
  schemaRevision: row.schema_revision,
  lifecycle: row.lifecycle,
  rankKey: row.rank_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToProperty = (row: PropertyRow): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(row.id),
  dataSourceId: parseDataSourceId(row.data_source_id),
  name: row.name,
  valueType: row.value_type,
  config: parsePropertyConfig(row),
  rankKey: row.rank_key,
  lifecycle: row.lifecycle,
  revision: row.schema_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToView = (
  database: Database.Database,
  row: ViewRow,
): DatabaseViewRecordV2 => {
  const container = readContainerRow(database, row.database_block_id);
  if (!container) {
    throw new DatabaseModuleV2StateError(
      `View ${row.id} has no owning Database`,
    );
  }
  return {
    viewId: parseDatabaseViewId(row.id),
    databaseId: parseDatabaseId(row.database_block_id),
    dataSourceId: parseDataSourceId(row.data_source_id),
    name: row.name,
    kind: row.kind,
    config: parseDatabaseViewConfigV2(
      parseJson(row.config_json, `View ${row.id} config`),
    ),
    isDefault: container.default_view_id === row.id,
    revision: row.revision,
    rankKey: row.rank_key,
    lifecycle: row.lifecycle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readProperties = (
  database: Database.Database,
  dataSourceId: string,
): readonly DataSourcePropertyRecordV2[] =>
  (database.prepare(`
    SELECT * FROM data_source_properties
    WHERE data_source_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
  `).all(dataSourceId) as readonly PropertyRow[]).map(rowToProperty);

const readViews = (
  database: Database.Database,
  databaseId: string,
): readonly DatabaseViewRecordV2[] =>
  (database.prepare(`
    SELECT * FROM database_views
    WHERE database_block_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
  `).all(databaseId) as readonly ViewRow[]).map((row) =>
    rowToView(database, row),
  );

export const readDatabaseContainerDescriptorV2InDatabase = (
  database: Database.Database,
  databaseId: string,
): DatabaseContainerDescriptorV2 | null => {
  const container = readContainerRow(database, databaseId);
  if (!container) return null;
  const sources = (database.prepare(`
    SELECT * FROM data_sources
    WHERE home_database_block_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
  `).all(databaseId) as readonly SourceRow[]).map(rowToSource);
  return {
    database: rowToContainer(container),
    dataSources: sources,
    views: readViews(database, databaseId),
  };
};

export const readDataSourceDescriptorV2InDatabase = (
  database: Database.Database,
  dataSourceId: string,
): DataSourceDescriptorV2 | null => {
  const source = readSourceRow(database, dataSourceId);
  if (!source) return null;
  return {
    dataSource: rowToSource(source),
    properties: readProperties(database, dataSourceId),
  };
};

const readMembershipRows = (
  database: Database.Database,
  dataSourceId: string,
  viewId: string | null,
): readonly MembershipRow[] =>
  database.prepare(`
    SELECT membership.id, membership.data_source_id,
      membership.page_block_id, membership.revision, membership.created_at,
      position.group_key, position.rank_key,
      position.revision AS position_revision
    FROM data_source_page_memberships membership
    INNER JOIN pages page
      ON page.block_id = membership.page_block_id
      AND page.parent_kind = 'data_source'
      AND page.parent_id = membership.data_source_id
      AND page.lifecycle = 'active'
    LEFT JOIN database_view_page_positions position
      ON position.view_id = ?
      AND position.page_block_id = membership.page_block_id
    WHERE membership.data_source_id = ? AND membership.removed_at IS NULL
    ORDER BY CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END,
      position.group_key, position.rank_key, membership.page_block_id
  `).all(viewId, dataSourceId) as readonly MembershipRow[];

const readValues = (
  database: Database.Database,
  dataSourceId: string,
  membershipIds: readonly string[],
): ReadonlyMap<string, Readonly<Record<string, DataSourcePageValueV2>>> => {
  if (membershipIds.length === 0) return new Map();
  const placeholders = membershipIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT value.membership_id, value.property_id, value.value_type,
      value.value_json, value.revision
    FROM data_source_property_values value
    INNER JOIN data_source_properties property
      ON property.data_source_id = value.data_source_id
      AND property.id = value.property_id
      AND property.lifecycle = 'active'
    WHERE value.data_source_id = ?
      AND value.membership_id IN (${placeholders})
    ORDER BY value.membership_id, value.property_id
  `).all(dataSourceId, ...membershipIds) as readonly ValueRow[];
  const result = new Map<
    string,
    Record<string, DataSourcePageValueV2>
  >();
  for (const row of rows) {
    const values = result.get(row.membership_id) ?? {};
    const propertyId = parseDataSourcePropertyId(row.property_id);
    values[propertyId] = {
      propertyId,
      valueType: row.value_type,
      value: parseDatabaseJson(
        row.value_json,
        `Property value ${dataSourceId}/${row.membership_id}/${row.property_id}`,
      ),
      revision: row.revision,
    };
    result.set(row.membership_id, values);
  }
  return result;
};

const readPageDatabaseProjection = (
  database: Database.Database,
  pageId: string,
): Readonly<{
  bodyNfm: string;
  intrinsicProperties: readonly PageIntrinsicPropertyValueV2[];
}> => {
  const body = database.prepare(`
    SELECT materialization.nfm AS bodyNfm
    FROM pages page
    INNER JOIN documents document ON document.id = page.document_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = document.id
      AND materialization.generation = document.generation
      AND materialization.projected_seq = document.head_seq
      AND materialization.schema_version = document.schema_version
    WHERE page.block_id = ?
  `).get(pageId) as { readonly bodyNfm: string } | undefined;
  if (!body) {
    throw new DatabaseModuleV2StateError(
      `Database Page ${pageId} has no exact-head body projection`,
    );
  }
  const properties = database.prepare(`
    SELECT property_key AS key, value_type AS valueType,
      value_json AS valueJson, revision
    FROM block_properties
    WHERE block_id = ?
    ORDER BY property_key
  `).all(pageId) as readonly {
    readonly key: string;
    readonly valueType: string;
    readonly valueJson: string;
    readonly revision: number;
  }[];
  return {
    bodyNfm: body.bodyNfm,
    intrinsicProperties: properties.map((property) => ({
      key: property.key,
      valueType: property.valueType,
      value: parseDatabaseJson(
        property.valueJson,
        `Page intrinsic Property ${pageId}/${property.key}`,
      ),
      revision: property.revision,
    })),
  };
};

const materializeRows = (
  database: Database.Database,
  input: Readonly<{
    dataSourceId: DataSourceId;
    viewId: DatabaseViewId | null;
    groupPropertyId: DataSourcePropertyId | null;
    filter: DatabaseViewFilterNode;
    sort: readonly DatabaseViewSort[];
    excludedPositionConsistencyPageIds?: ReadonlySet<string>;
  }>,
): {
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly rows: readonly DataSourcePageRowV2[];
} => {
  const properties = readProperties(database, input.dataSourceId).filter(
    (property) => property.lifecycle === "active",
  );
  const memberships = readMembershipRows(
    database,
    input.dataSourceId,
    input.viewId,
  );
  const pages = readPagesInDatabase(
    database,
    memberships.map((membership) => membership.page_block_id),
  );
  const values = readValues(
    database,
    input.dataSourceId,
    memberships.map((membership) => membership.id),
  );
  const rows = memberships.map((membership): DataSourcePageRowV2 => {
    const page = pages.get(membership.page_block_id);
    if (!page) {
      throw new DatabaseModuleV2StateError(
        `Membership ${membership.id} has no readable Page`,
      );
    }
    const pageProjection = readPageDatabaseProjection(
      database,
      membership.page_block_id,
    );
    const rowValues = values.get(membership.id) ?? {};
    const effectiveGroupKey = input.groupPropertyId === null
      ? membership.group_key
      : databaseGroupKeyForValue(
          rowValues[input.groupPropertyId]?.value,
        );
    if (
      input.groupPropertyId !== null &&
      membership.rank_key !== null &&
      membership.group_key !== effectiveGroupKey &&
      !input.excludedPositionConsistencyPageIds?.has(page.pageId)
    ) {
      throw new DatabaseModuleV2StateError(
        `View ${input.viewId} position for Page ${page.pageId} diverges from its grouping Property`,
      );
    }
    return {
      page,
      membership: {
        membershipId: membership.id,
        dataSourceId: input.dataSourceId,
        revision: membership.revision,
        createdAt: membership.created_at,
      },
      values: rowValues,
      position:
        membership.rank_key === null || membership.position_revision === null
          ? null
          : {
              groupKey: membership.group_key,
              rankKey: membership.rank_key,
              revision: membership.position_revision,
            },
      effectiveGroupKey,
      bodyNfm: pageProjection.bodyNfm,
      intrinsicProperties: pageProjection.intrinsicProperties,
    };
  });
  const visibleRows = rows.filter((row) =>
    evaluateDatabaseViewFilter(
      input.filter,
      (propertyId) => row.values[propertyId]?.value,
    ),
  );
  const orderItems = new Map(
    visibleRows.map((row) => [
      row.page.pageId,
      {
        pageId: row.page.pageId,
        title: row.page.title,
        createdAt: row.page.createdAt,
        rankKey: row.position?.rankKey ?? null,
        propertyValues: Object.fromEntries(
          Object.entries(row.values).map(([propertyId, value]) => [
            propertyId,
            value.value,
          ]),
        ),
      } satisfies DatabaseViewOrderItem,
    ] as const),
  );
  visibleRows.sort((left, right) => {
    const leftOrder = orderItems.get(left.page.pageId);
    const rightOrder = orderItems.get(right.page.pageId);
    if (!leftOrder || !rightOrder) {
      throw new DatabaseModuleV2StateError(
        "View order item disappeared during query",
      );
    }
    return compareDatabaseViewOrderItems(leftOrder, rightOrder, input.sort);
  });
  return { properties, rows: visibleRows };
};

const queryView = (
  database: Database.Database,
  viewId: DatabaseViewId,
): DatabaseViewQueryResultV2 | null => {
  const viewRow = readViewRow(database, viewId);
  if (!viewRow || viewRow.lifecycle !== "active") return null;
  const view = rowToView(database, viewRow);
  const container = readContainerRow(database, view.databaseId);
  const source = readSourceRow(database, view.dataSourceId);
  if (!container || !source) {
    throw new DatabaseModuleV2StateError(
      `View ${viewId} has missing Database or Data Source authority`,
    );
  }
  if (source.home_database_block_id !== container.block_id) {
    throw new DatabaseModuleV2StateError(
      `View ${viewId} targets a Data Source outside its home Database`,
    );
  }
  const materialized = materializeRows(database, {
    dataSourceId: view.dataSourceId,
    viewId: view.viewId,
    groupPropertyId: view.config.group?.propertyId
      ? parseDataSourcePropertyId(view.config.group.propertyId)
      : null,
    filter: view.config.filter,
    sort: view.config.sort,
  });
  return {
    database: rowToContainer(container),
    dataSource: rowToSource(source),
    view,
    properties: materialized.properties,
    rows: materialized.rows,
  };
};

const queryDataSource = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  filter: DatabaseViewFilterNode,
  sort: readonly DatabaseViewSort[],
): DataSourceQueryResultV2 | null => {
  const source = readSourceRow(database, dataSourceId);
  if (!source || source.lifecycle !== "active") return null;
  const container = readContainerRow(database, source.home_database_block_id);
  if (!container || container.lifecycle !== "active") return null;
  const materialized = materializeRows(database, {
    dataSourceId,
    viewId: null,
    groupPropertyId: null,
    filter,
    sort,
  });
  return {
    database: rowToContainer(container),
    dataSource: rowToSource(source),
    properties: materialized.properties,
    rows: materialized.rows,
  };
};

const authorizationResourceForRead = (
  database: Database.Database,
  project: ProjectRow,
  request: DatabaseModuleReadRequestV2,
): LibraryResource | null => {
  const target = request.read.target;
  if (target.kind === "database") {
    return { kind: "database", databaseId: target.databaseId };
  }
  if (target.kind === "data_source") {
    return { kind: "data_source", dataSourceId: target.dataSourceId };
  }
  if (target.kind === "view") {
    return { kind: "view", viewId: target.viewId };
  }
  if (request.read.mode !== "query") {
    return { kind: "database", databaseId: project.database_block_id };
  }
  const defaultViewId = readContainerRow(
    database,
    project.database_block_id,
  )?.default_view_id;
  return defaultViewId ? { kind: "view", viewId: defaultViewId } : null;
};

const readCatalog = (
  database: Database.Database,
  project: ProjectRow,
  options: DatabaseModuleReadAuthorityOptions,
): readonly DatabaseContainerDescriptorV2[] => {
  const candidates = database.prepare(`
    SELECT block_id FROM database_containers
    WHERE library_id = ? AND lifecycle <> 'deleted'
    ORDER BY block_id
  `).all(project.library_id) as readonly { readonly block_id: string }[];
  return candidates.flatMap((candidate) => {
    const resource = {
      kind: "database" as const,
      databaseId: candidate.block_id,
    };
    const authorization = options.contentAuthority
      ? authorizeContentResourceInDatabase(database, {
          authority: options.contentAuthority,
          resource,
          action: "read",
        })
      : options.authority
      ? authorizeNodexAgentResourceInDatabase(database, {
          authority: options.authority,
          resource,
          action: "read",
          ...(options.resourceAccess
            ? { resourceAccess: options.resourceAccess }
            : {}),
          ...(options.callId ? { callId: options.callId } : {}),
          phase: "execute",
        })
      : authorizeProjectResourceInDatabase(database, {
          projectId: project.id,
          resource,
          action: "read",
        });
    if (
      !("allowed" in authorization) ||
      !authorization.allowed
    ) return [];
    const descriptor = readDatabaseContainerDescriptorV2InDatabase(
      database,
      candidate.block_id,
    );
    return descriptor ? [descriptor] : [];
  });
};

const readValue = (
  database: Database.Database,
  project: ProjectRow,
  request: DatabaseModuleReadRequestV2,
  options: DatabaseModuleReadAuthorityOptions,
): DatabaseReadValueV2 | null => {
  const target = request.read.target;
  if (target.kind === "project_default") {
    const descriptor = readDatabaseContainerDescriptorV2InDatabase(
      database,
      project.database_block_id,
    );
    if (!descriptor) return null;
    if (request.read.mode === "catalog") {
      return {
        kind: "catalog",
        databases: readCatalog(database, project, options),
      };
    }
    if (request.read.mode === "database") {
      return { kind: "database", value: descriptor };
    }
    const viewId = descriptor.database.defaultViewId;
    if (!viewId) return null;
    const value = queryView(database, viewId);
    return value ? { kind: "query", value } : null;
  }
  if (target.kind === "database") {
    const value = readDatabaseContainerDescriptorV2InDatabase(
      database,
      target.databaseId,
    );
    return value ? { kind: "database", value } : null;
  }
  if (target.kind === "data_source") {
    if (request.read.mode === "data_source") {
      const value = readDataSourceDescriptorV2InDatabase(
        database,
        target.dataSourceId,
      );
      return value ? { kind: "data_source", value } : null;
    }
    const queryRead = request.read as Extract<
      DatabaseModuleReadRequestV2["read"],
      {
        readonly target: { readonly kind: "data_source" };
        readonly mode: "query";
      }
    >;
    const value = queryDataSource(
      database,
      target.dataSourceId,
      queryRead.filter ?? {
        kind: "group",
        operator: "and",
        children: [],
      },
      queryRead.sort ?? [],
    );
    return value ? { kind: "data_source_query", value } : null;
  }
  const view = readViewRow(database, target.viewId);
  if (!view) return null;
  if (request.read.mode === "view") {
    return { kind: "view", value: rowToView(database, view) };
  }
  const value = queryView(database, target.viewId);
  return value ? { kind: "query", value } : null;
};

export const readDatabaseModuleV2 = (
  database: Database.Database,
  input: DatabaseModuleReadRequestV2,
  options: DatabaseModuleReadAuthorityOptions = {},
): DatabaseModuleReadResultV2 => {
  let request: DatabaseModuleReadRequestV2;
  try {
    request = bindDatabaseModuleReadV2(input, input.projectId);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
  try {
    return database.transaction((): DatabaseModuleReadResultV2 => {
      requireCanonicalSchema(database);
      const storeEpoch = readStoreEpoch(database);
      if (!storeEpoch) {
        return {
          ok: false,
          error: {
            code: "store_not_initialized",
            message: "The Library store has no active epoch",
            retryable: false,
          },
        };
      }
      const project = readProject(database, request.projectId);
      if (!project) {
        return {
          ok: false,
          error: {
            code: "project_not_found",
            message: `Project does not exist: ${request.projectId}`,
            retryable: false,
          },
        };
      }
      const resource = authorizationResourceForRead(
        database,
        project,
        request,
      );
      if (!resource) {
        return {
          ok: false,
          error: {
            code: "resource_not_found",
            message: "The requested default Database resource does not exist",
            retryable: false,
          },
        };
      }
      const authorization = options.contentAuthority
        ? authorizeContentResourceInDatabase(database, {
            authority: options.contentAuthority,
            resource,
            action: "read",
          })
        : options.authority
        ? authorizeNodexAgentResourceInDatabase(database, {
            authority: options.authority,
            resource,
            action: "read",
            ...(options.resourceAccess
              ? { resourceAccess: options.resourceAccess }
              : {}),
            ...(options.callId ? { callId: options.callId } : {}),
            phase: "execute",
          })
        : authorizeProjectResourceInDatabase(database, {
            projectId: request.projectId,
            resource,
            action: "read",
          });
      if (!("allowed" in authorization) || !authorization.allowed) {
        const reason = "reason" in authorization
          ? authorization.reason
          : authorization.authorization.reason;
        return {
          ok: false,
          error: {
            code: "authorization_denied",
            message: `Database read denied: ${reason}`,
            retryable: false,
          },
        };
      }
      const change = database.prepare(`
        SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log
      `).get() as { readonly seq: number };
      const value = readValue(database, project, request, options);
      if (!value) {
        return {
          ok: false,
          error: {
            code: "resource_not_found",
            message: "The requested Database resource does not exist",
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        value: {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId: project.id,
          libraryId: project.library_id,
          storeEpoch,
          changeLogSeq: change.seq,
          value,
        },
      };
    })();
  } catch (error) {
    if (error instanceof DatabaseModuleV2Rejection) {
      return { ok: false, error: error.error };
    }
    if (
      error instanceof DatabaseModuleV2StateError ||
      error instanceof DataSourceOptionRegistryError
    ) {
      return {
        ok: false,
        error: {
          code: "state_corrupt",
          message: error.message,
          retryable: false,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "state_corrupt",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
};

export const readLibraryDatabaseModuleV2 = (
  database: Database.Database,
  input: LibraryDatabaseModuleReadRequestV2,
  actor: "app_window" | "http_loopback",
): LibraryDatabaseModuleReadResultV2 => {
  const local = requireLocalProfileLibraryInDatabase(database);
  const compatibilityProject = database.prepare(`
    SELECT id FROM projects
    WHERE library_id = ?
    ORDER BY created, id
    LIMIT 1
  `).get(local.libraryId) as { readonly id: string } | undefined;
  if (!compatibilityProject) {
    return {
      ok: false,
      error: {
        code: "project_not_found",
        message: "The local Library has no compatibility storage Project",
        retryable: false,
      },
    };
  }
  const authority = resolveContentResourceAuthorityInDatabase(database, {
    context: libraryContentAccess,
    actor,
  });
  if (authority.kind !== "local_user_library") {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Local Library authority could not be resolved",
        retryable: false,
      },
    };
  }
  const result = readDatabaseModuleV2(
    database,
    {
      version: input.version,
      projectId: compatibilityProject.id,
      read: input.read,
    },
    { contentAuthority: authority },
  );
  if (!result.ok) return result;
  const { projectId: _compatibilityProjectId, ...snapshot } = result.value;
  void _compatibilityProjectId;
  return {
    ok: true,
    value: {
      ...snapshot,
      accessContext: { kind: "library" },
    },
  };
};

const makeApplyError = (
  code: DatabaseModuleErrorV2["code"],
  message: string,
  request: Pick<DatabaseApplyV2, "operationId">,
  revisions: Readonly<{
    expectedRevision?: number;
    actualRevision?: number;
  }> = {},
): DatabaseModuleErrorV2 => ({
  code,
  message,
  retryable: false,
  operationId: request.operationId,
  ...(revisions.expectedRevision === undefined
    ? {}
    : { expectedRevision: revisions.expectedRevision }),
  ...(revisions.actualRevision === undefined
    ? {}
    : { actualRevision: revisions.actualRevision }),
});

const rejectApply = (
  code: DatabaseModuleErrorV2["code"],
  message: string,
  request: DatabaseApplyV2,
  revisions?: Readonly<{
    expectedRevision?: number;
    actualRevision?: number;
  }>,
): never => {
  throw new DatabaseModuleV2Rejection(
    makeApplyError(code, message, request, revisions),
  );
};

const requireApplyResource = <Value>(
  value: Value | null | undefined,
  message: string,
  request: DatabaseApplyV2,
): Value => {
  if (value !== null && value !== undefined) return value;
  return rejectApply("resource_not_found", message, request);
};

const requireAuthorization = (
  database: Database.Database,
  request: DatabaseApplyV2,
  resource: LibraryResource,
  action: ProjectResourceAction,
  options: DatabaseModuleApplyAuthorityOptions,
): void => {
  const authorization = options.contentAuthority
    ? authorizeContentResourceInDatabase(database, {
        authority: options.contentAuthority,
        resource,
        action,
      })
    : authorizeProjectResourceInDatabase(database, {
        projectId: request.projectId,
        resource,
        action,
      });
  if ("allowed" in authorization && authorization.allowed) return;
  const reason = "reason" in authorization
    ? authorization.reason
    : authorization.authorization.reason;
  rejectApply(
    "authorization_denied",
    `${action} denied for ${resource.kind}: ${reason}`,
    request,
  );
};

interface DatabaseModuleApplyAuthorityOptions {
  readonly contentAuthority?: Extract<
    ContentResourceAuthority,
    { readonly kind: "local_user_library" }
  >;
}

const requireRevision = (
  request: DatabaseApplyV2,
  label: string,
  expected: number,
  actual: number,
): void => {
  if (expected === actual) return;
  rejectApply(
    "revision_conflict",
    `${label} revision changed from ${expected} to ${actual}`,
    request,
    { expectedRevision: expected, actualRevision: actual },
  );
};

const requireOptionBackedProperty = (
  property: PropertyRow,
  request: DatabaseApplyV2,
): void => {
  if (
    property.value_type === "select" ||
    property.value_type === "multi_select"
  ) {
    return;
  }
  rejectApply(
    "invalid_request",
    `Property ${property.data_source_id}/${property.id} is not option-backed`,
    request,
  );
};

const rejectRegistryMutationError = (
  error: unknown,
  request: DatabaseApplyV2,
): never => {
  if (!(error instanceof DataSourceOptionRegistryError)) throw error;
  if (error.code === "option_name_conflict") {
    return rejectApply("identity_conflict", error.message, request);
  }
  if (error.code === "option_not_found") {
    return rejectApply("resource_not_found", error.message, request);
  }
  if (error.code === "option_in_use") {
    return rejectApply("unsupported_operation", error.message, request);
  }
  return rejectApply("invalid_request", error.message, request);
};

const readActiveMembership = (
  database: Database.Database,
  pageId: string,
  dataSourceId: string,
): MembershipRow | null =>
  (database.prepare(`
    SELECT id, data_source_id, page_block_id, revision, created_at,
      NULL AS group_key, NULL AS rank_key, NULL AS position_revision
    FROM data_source_page_memberships
    WHERE page_block_id = ? AND data_source_id = ? AND removed_at IS NULL
  `).get(pageId, dataSourceId) as MembershipRow | undefined) ?? null;

const updatePageMetadataRevision = (
  database: Database.Database,
  pageId: string,
  now: string,
): number => {
  const updated = database.prepare(`
    UPDATE blocks
    SET metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE id = ? AND type = 'page'
    RETURNING metadata_revision AS revision
  `).get(now, pageId) as { readonly revision: number } | undefined;
  if (!updated) {
    throw new DatabaseModuleV2StateError(`Page ${pageId} disappeared`);
  }
  const pageAuthority = database.prepare(`
    UPDATE pages SET metadata_revision = ?, updated_at = ?
    WHERE block_id = ? AND lifecycle <> 'deleted'
  `).run(updated.revision, now, pageId);
  if (pageAuthority.changes !== 1) {
    throw new DatabaseModuleV2StateError(
      `Page ${pageId} has no live authority projection`,
    );
  }
  return updated.revision;
};

const readJsonObject = (
  value: string,
  label: string,
): Record<string, unknown> => {
  const parsed = parseJson(value, label);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return { ...(parsed as Readonly<Record<string, unknown>>) };
  }
  throw new DatabaseModuleV2StateError(`${label} must be an object`);
};

const compatibilityValue = (
  registry: DataSourceOptionRegistry,
  value: DatabaseJsonValue,
): DatabaseJsonValue => {
  if (registry.propertyId !== "tags" || value === null) return value;
  if (!Array.isArray(value)) {
    throw new DatabaseModuleV2StateError(
      "The canonical tags value is not an option array",
    );
  }
  const namesById = new Map(
    registry.options.map((option) => [option.optionId, option.name] as const),
  );
  return value.map((optionId) => {
    if (typeof optionId !== "string") {
      throw new DatabaseModuleV2StateError(
        "The canonical tags value contains a non-string option",
      );
    }
    const name = namesById.get(optionId as DataSourceOptionId);
    if (name) return name;
    throw new DatabaseModuleV2StateError(
      `The canonical tags value references unknown option ${optionId}`,
    );
  });
};

const refreshPageCompatibilityProjection = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    propertyId: DataSourcePropertyId;
    value: DatabaseJsonValue;
    valueRevision: number;
    metadataRevision: number;
    registry: DataSourceOptionRegistry;
    now: string;
  }>,
): void => {
  const row = database.prepare(`
    SELECT database_values_json, property_revisions_json
    FROM page_read_model WHERE page_block_id = ?
  `).get(input.pageId) as
    | {
        readonly database_values_json: string;
        readonly property_revisions_json: string;
      }
    | undefined;
  if (!row) return;
  const databaseValues = readJsonObject(
    row.database_values_json,
    `Page read projection ${input.pageId} Database values`,
  );
  const propertyRevisions = readJsonObject(
    row.property_revisions_json,
    `Page read projection ${input.pageId} Property revisions`,
  );
  const databaseRevisions = propertyRevisions.database;
  if (
    typeof databaseRevisions !== "object" ||
    databaseRevisions === null ||
    Array.isArray(databaseRevisions)
  ) {
    throw new DatabaseModuleV2StateError(
      `Page read projection ${input.pageId} Database revisions must be an object`,
    );
  }
  databaseValues[input.propertyId] = compatibilityValue(
    input.registry,
    input.value,
  );
  propertyRevisions.database = {
    ...(databaseRevisions as Readonly<Record<string, unknown>>),
    [input.propertyId]: input.valueRevision,
  };
  database.prepare(`
    UPDATE page_read_model
    SET metadata_revision = ?, database_values_json = ?,
      property_revisions_json = ?, projection_version = projection_version + 1,
      updated_at = ?
    WHERE page_block_id = ?
  `).run(
    input.metadataRevision,
    stableStringifyDatabaseJson(databaseValues),
    stableStringifyDatabaseJson(propertyRevisions),
    input.now,
    input.pageId,
  );
};

const refreshRenamedTagCompatibilityValues = (
  database: Database.Database,
  input: Readonly<{
    dataSourceId: DataSourceId;
    previousRegistry: DataSourceOptionRegistry;
    registry: DataSourceOptionRegistry;
    now: string;
    accumulator: ApplyAccumulator;
  }>,
): void => {
  if (input.registry.propertyId !== "tags") return;
  const previousNamesById = new Map(
    input.previousRegistry.options.map((option) => [
      option.optionId,
      option.name,
    ] as const),
  );
  const renamedOptionIds = new Set(
    input.registry.options.flatMap((option) => {
      const previousName = previousNamesById.get(option.optionId);
      return previousName !== undefined && previousName !== option.name
        ? [option.optionId]
        : [];
    }),
  );
  if (renamedOptionIds.size === 0) return;
  const rows = database.prepare(`
    SELECT membership.page_block_id AS pageId, value.value_json AS valueJson
    FROM data_source_property_values value
    INNER JOIN data_source_page_memberships membership
      ON membership.id = value.membership_id
      AND membership.data_source_id = value.data_source_id
      AND membership.removed_at IS NULL
    WHERE value.data_source_id = ? AND value.property_id = 'tags'
  `).all(input.dataSourceId) as readonly {
    readonly pageId: string;
    readonly valueJson: string;
  }[];
  for (const row of rows) {
    const value = parseDatabaseJson(
      row.valueJson,
      `Tags value for Page ${row.pageId}`,
    );
    if (
      !Array.isArray(value) ||
      !value.some(
        (optionId) =>
          typeof optionId === "string" &&
          renamedOptionIds.has(optionId as DataSourceOptionId),
      )
    ) {
      continue;
    }
    const projection = database.prepare(`
      SELECT database_values_json FROM page_read_model WHERE page_block_id = ?
    `).get(row.pageId) as
      | { readonly database_values_json: string }
      | undefined;
    if (!projection) continue;
    const values = readJsonObject(
      projection.database_values_json,
      `Page read projection ${row.pageId} Database values`,
    );
    values.tags = compatibilityValue(
      input.registry,
      value,
    );
    const metadataRevision = updatePageMetadataRevision(
      database,
      row.pageId,
      input.now,
    );
    database.prepare(`
      UPDATE page_read_model
      SET metadata_revision = ?, database_values_json = ?,
        projection_version = projection_version + 1, updated_at = ?
      WHERE page_block_id = ?
    `).run(
      metadataRevision,
      stableStringifyDatabaseJson(values),
      input.now,
      row.pageId,
    );
    input.accumulator.pageIds.add(row.pageId);
    input.accumulator.revisions[
      `page:${row.pageId}:metadata`
    ] = metadataRevision;
  }
};

const readRankedItems = (
  database: Database.Database,
  input:
    | Readonly<{
        kind: "property";
        ownerId: DataSourceId;
      }>
    | Readonly<{
        kind: "view";
        ownerId: DatabaseId;
      }>,
): readonly { readonly id: string; readonly rankKey: string }[] => {
  if (input.kind === "property") {
    return database.prepare(`
      SELECT id, rank_key AS rankKey FROM data_source_properties
      WHERE data_source_id = ? AND lifecycle = 'active'
      ORDER BY rank_key, id
    `).all(input.ownerId) as readonly {
      readonly id: string;
      readonly rankKey: string;
    }[];
  }
  return database.prepare(`
    SELECT id, rank_key AS rankKey FROM database_views
    WHERE database_block_id = ? AND lifecycle = 'active'
    ORDER BY rank_key, id
  `).all(input.ownerId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[];
};

const applyRebalancedPropertyRanks = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  ranks: ReadonlyMap<string, string>,
): void => {
  if (ranks.size === 0) return;
  const update = database.prepare(`
    UPDATE data_source_properties SET rank_key = ?
    WHERE data_source_id = ? AND id = ?
  `);
  for (const [propertyId, rankKey] of ranks) {
    update.run(rankKey, dataSourceId, propertyId);
  }
};

const applyRebalancedViewRanks = (
  database: Database.Database,
  databaseId: DatabaseId,
  ranks: ReadonlyMap<string, string>,
): void => {
  if (ranks.size === 0) return;
  const update = database.prepare(`
    UPDATE database_views SET rank_key = ?
    WHERE database_block_id = ? AND id = ?
  `);
  for (const [viewId, rankKey] of ranks) {
    update.run(rankKey, databaseId, viewId);
  }
};

const collectViewPropertyIds = (
  config: DatabaseViewConfigV2,
): ReadonlySet<string> => {
  const propertyIds = new Set(config.display.propertyIds);
  if (config.group) propertyIds.add(config.group.propertyId);
  for (const sort of config.sort) {
    if (sort.field.kind === "property") {
      propertyIds.add(sort.field.propertyId);
    }
  }
  const visit = (filter: DatabaseViewFilterNode): void => {
    if (filter.kind === "clause") {
      propertyIds.add(filter.propertyId);
      return;
    }
    for (const child of filter.children) visit(child);
  };
  visit(config.filter);
  return propertyIds;
};

const propertyConfigForPut = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PutDataSourcePropertyOperationV2,
  existing: PropertyRow | null,
): Readonly<Record<string, DatabaseJsonValue>> => {
  if (existing?.value_type === operation.valueType) {
    return parsePropertyConfig(existing);
  }
  if (existing) {
    const persistedValues = database.prepare(`
      SELECT COUNT(*) AS count FROM data_source_property_values
      WHERE data_source_id = ? AND property_id = ?
    `).get(operation.dataSourceId, operation.propertyId) as {
      readonly count: number;
    };
    if (persistedValues.count > 0) {
      rejectApply(
        "unsupported_operation",
        `Property ${operation.dataSourceId}/${operation.propertyId} cannot change value type while values exist`,
        request,
      );
    }
  }
  if (
    operation.valueType !== "select" &&
    operation.valueType !== "multi_select"
  ) {
    return parseDatabasePropertyConfig(operation.valueType, {});
  }
  try {
    const registry = parseDataSourceOptionRegistry({
      dataSourceId: operation.dataSourceId,
      propertyId: operation.propertyId,
      valueType: operation.valueType,
      config: { options: [] },
    });
    return dataSourceOptionRegistryConfig(registry);
  } catch (error) {
    return rejectRegistryMutationError(error, request);
  }
};

const applyPutProperty = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PutDataSourcePropertyOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (source.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Data Source does not exist: ${operation.dataSourceId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "data_source", dataSourceId: operation.dataSourceId },
    "manage_schema",
    authorityOptions,
  );
  requireRevision(
    request,
    `Data Source ${operation.dataSourceId}`,
    operation.expectedDataSourceRevision,
    source.schema_revision,
  );
  const existing = readPropertyRow(
    database,
    operation.dataSourceId,
    operation.propertyId,
  );
  requireRevision(
    request,
    `Property ${operation.dataSourceId}/${operation.propertyId}`,
    operation.expectedPropertyRevision,
    existing?.schema_revision ?? 0,
  );
  const config = propertyConfigForPut(
    database,
    request,
    operation,
    existing,
  );
  const ranks = existing && operation.beforePropertyId === undefined
    ? {
        rankKey: existing.rank_key,
        rebalancedRankKeys: new Map<string, string>(),
      }
    : planDatabaseFractionalRank({
        items: readRankedItems(database, {
          kind: "property",
          ownerId: operation.dataSourceId,
        }),
        targetId: operation.propertyId,
        ...(operation.beforePropertyId === undefined
          ? {}
          : { beforeId: operation.beforePropertyId }),
      });
  applyRebalancedPropertyRanks(
    database,
    operation.dataSourceId,
    ranks.rebalancedRankKeys,
  );
  const propertyRevision = (existing?.schema_revision ?? 0) + 1;
  const sourceRevision = source.schema_revision + 1;
  database.prepare(`
    INSERT INTO data_source_properties (
      data_source_id, id, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(data_source_id, id) DO UPDATE SET
      name = excluded.name,
      value_type = excluded.value_type,
      config_json = excluded.config_json,
      rank_key = excluded.rank_key,
      lifecycle = 'active',
      schema_revision = excluded.schema_revision,
      updated_at = excluded.updated_at
  `).run(
    operation.dataSourceId,
    operation.propertyId,
    operation.name.trim(),
    operation.valueType,
    stableStringifyDatabaseJson(config),
    ranks.rankKey,
    propertyRevision,
    existing?.created_at ?? now,
    now,
  );
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, operation.dataSourceId);
  accumulator.databaseIds.add(parseDatabaseId(source.home_database_block_id));
  accumulator.dataSourceIds.add(operation.dataSourceId);
  accumulator.revisions[`source:${operation.dataSourceId}`] = sourceRevision;
  accumulator.revisions[
    `property:${operation.dataSourceId}:${operation.propertyId}`
  ] = propertyRevision;
};

const activeViewReferencingProperty = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  propertyId: DataSourcePropertyId,
): DatabaseViewId | null => {
  const views = database.prepare(`
    SELECT * FROM database_views
    WHERE data_source_id = ? AND lifecycle = 'active'
    ORDER BY id
  `).all(dataSourceId) as readonly ViewRow[];
  for (const view of views) {
    const config = parseDatabaseViewConfigV2(
      parseJson(view.config_json, `View ${view.id} config`),
    );
    if (collectViewPropertyIds(config).has(propertyId)) {
      return parseDatabaseViewId(view.id);
    }
  }
  return null;
};

const applyDeleteProperty = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: DeleteDataSourcePropertyOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (source.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Data Source does not exist: ${operation.dataSourceId}`,
      request,
    );
  }
  const property = requireApplyResource(
    readPropertyRow(database, operation.dataSourceId, operation.propertyId),
    `Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
    request,
  );
  if (property.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "data_source", dataSourceId: operation.dataSourceId },
    "manage_schema",
    authorityOptions,
  );
  requireRevision(
    request,
    `Data Source ${operation.dataSourceId}`,
    operation.expectedDataSourceRevision,
    source.schema_revision,
  );
  requireRevision(
    request,
    `Property ${operation.dataSourceId}/${operation.propertyId}`,
    operation.expectedPropertyRevision,
    property.schema_revision,
  );
  const referencingView = activeViewReferencingProperty(
    database,
    operation.dataSourceId,
    operation.propertyId,
  );
  if (referencingView) {
    rejectApply(
      "unsupported_operation",
      `Property ${operation.dataSourceId}/${operation.propertyId} is referenced by active View ${referencingView}`,
      request,
    );
  }
  const propertyRevision = property.schema_revision + 1;
  const sourceRevision = source.schema_revision + 1;
  database.prepare(`
    UPDATE data_source_properties
    SET lifecycle = 'deleted', schema_revision = ?, updated_at = ?
    WHERE data_source_id = ? AND id = ?
  `).run(
    propertyRevision,
    now,
    operation.dataSourceId,
    operation.propertyId,
  );
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, operation.dataSourceId);
  accumulator.databaseIds.add(parseDatabaseId(source.home_database_block_id));
  accumulator.dataSourceIds.add(operation.dataSourceId);
  accumulator.revisions[`source:${operation.dataSourceId}`] = sourceRevision;
  accumulator.revisions[
    `property:${operation.dataSourceId}:${operation.propertyId}`
  ] = propertyRevision;
};

const validateViewProperties = (
  database: Database.Database,
  request: DatabaseApplyV2,
  dataSourceId: DataSourceId,
  config: DatabaseViewConfigV2,
): void => {
  const knownPropertyIds = new Set(
    (database.prepare(`
      SELECT id FROM data_source_properties
      WHERE data_source_id = ? AND lifecycle = 'active'
    `).all(dataSourceId) as readonly { readonly id: string }[]).map(
      (row) => row.id,
    ),
  );
  for (const propertyId of collectViewPropertyIds(config)) {
    if (knownPropertyIds.has(propertyId)) continue;
    rejectApply(
      "invalid_request",
      `View references missing Data Source Property ${dataSourceId}/${propertyId}`,
      request,
    );
  }
};

const clearViewPositions = (
  database: Database.Database,
  viewId: DatabaseViewId,
  now: string,
): void => {
  database.prepare(`
    DELETE FROM database_view_page_positions WHERE view_id = ?
  `).run(viewId);
  database.prepare(`
    UPDATE page_read_model
    SET view_group_key = NULL, view_rank_key = NULL,
      projection_version = projection_version + 1, updated_at = ?
    WHERE view_id = ?
  `).run(now, viewId);
};

const clearViewProjection = (
  database: Database.Database,
  viewId: DatabaseViewId,
  now: string,
): void => {
  database.prepare(`
    UPDATE page_read_model
    SET view_id = NULL, view_group_key = NULL, view_rank_key = NULL,
      projection_version = projection_version + 1, updated_at = ?
    WHERE view_id = ?
  `).run(now, viewId);
};

const refreshDefaultViewProjection = (
  database: Database.Database,
  databaseId: DatabaseId,
  now: string,
): void => {
  const container = readContainerRow(database, databaseId);
  if (!container) {
    throw new DatabaseModuleV2StateError(
      `Database ${databaseId} disappeared during View projection refresh`,
    );
  }
  const defaultView = container.default_view_id
    ? readViewRow(database, container.default_view_id)
    : null;
  if (container.default_view_id && (!defaultView || defaultView.lifecycle !== "active")) {
    throw new DatabaseModuleV2StateError(
      `Database ${databaseId} has an invalid default View`,
    );
  }
  const projections = database.prepare(`
    SELECT projection.page_block_id AS pageId,
      membership.data_source_id AS dataSourceId
    FROM page_read_model projection
    LEFT JOIN data_source_page_memberships membership
      ON membership.id = projection.membership_id
      AND membership.removed_at IS NULL
    WHERE projection.database_block_id = ?
    ORDER BY projection.page_block_id
  `).all(databaseId) as readonly {
    readonly pageId: string;
    readonly dataSourceId: string | null;
  }[];
  const update = database.prepare(`
    UPDATE page_read_model
    SET view_id = ?, view_group_key = ?, view_rank_key = ?,
      projection_version = projection_version + 1, updated_at = ?
    WHERE page_block_id = ?
  `);
  for (const projection of projections) {
    const usesDefault =
      defaultView !== null &&
      defaultView.data_source_id === projection.dataSourceId;
    const position = usesDefault
      ? database.prepare(`
          SELECT group_key, rank_key FROM database_view_page_positions
          WHERE view_id = ? AND page_block_id = ?
        `).get(defaultView.id, projection.pageId) as
          | { readonly group_key: string | null; readonly rank_key: string }
          | undefined
      : undefined;
    update.run(
      usesDefault ? defaultView.id : null,
      position?.group_key ?? null,
      position?.rank_key ?? null,
      now,
      projection.pageId,
    );
  }
};

const applyPutView = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PutDatabaseViewOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const container = requireApplyResource(
    readContainerRow(database, operation.databaseId),
    `Database does not exist: ${operation.databaseId}`,
    request,
  );
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (
    container.lifecycle !== "active" ||
    source.lifecycle !== "active" ||
    source.home_database_block_id !== container.block_id
  ) {
    rejectApply(
      "resource_not_found",
      "View Database and Data Source must be active and share one home Database",
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "database", databaseId: operation.databaseId },
    "manage_views",
    authorityOptions,
  );
  const existing = readViewRow(database, operation.viewId);
  requireRevision(
    request,
    `View ${operation.viewId}`,
    operation.expectedRevision,
    existing?.revision ?? 0,
  );
  if (existing && existing.database_block_id !== operation.databaseId) {
    rejectApply(
      "identity_conflict",
      `View ${operation.viewId} belongs to another Database`,
      request,
    );
  }
  const config = parseDatabaseViewConfigV2(operation.config);
  validateViewProperties(
    database,
    request,
    operation.dataSourceId,
    config,
  );
  const existingConfig = existing
    ? parseDatabaseViewConfigV2(
        parseJson(existing.config_json, `View ${existing.id} config`),
      )
    : null;
  const sourceChanged =
    existing !== null && existing.data_source_id !== operation.dataSourceId;
  const groupChanged =
    existingConfig?.group?.propertyId !== config.group?.propertyId;
  if (existing && (sourceChanged || groupChanged)) {
    clearViewPositions(database, operation.viewId, now);
  }
  if (sourceChanged) {
    clearViewProjection(database, operation.viewId, now);
  }
  const ranks = existing && operation.beforeViewId === undefined
    ? {
        rankKey: existing.rank_key,
        rebalancedRankKeys: new Map<string, string>(),
      }
    : planDatabaseFractionalRank({
        items: readRankedItems(database, {
          kind: "view",
          ownerId: operation.databaseId,
        }),
        targetId: operation.viewId,
        ...(typeof operation.beforeViewId === "string"
          ? { beforeId: operation.beforeViewId }
          : {}),
      });
  applyRebalancedViewRanks(
    database,
    operation.databaseId,
    ranks.rebalancedRankKeys,
  );
  const revision = (existing?.revision ?? 0) + 1;
  database.prepare(`
    INSERT INTO database_views (
      id, database_block_id, data_source_id, name, kind, config_json,
      revision, rank_key, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      database_block_id = excluded.database_block_id,
      data_source_id = excluded.data_source_id,
      name = excluded.name,
      kind = excluded.kind,
      config_json = excluded.config_json,
      revision = excluded.revision,
      rank_key = excluded.rank_key,
      lifecycle = 'active',
      updated_at = excluded.updated_at
  `).run(
    operation.viewId,
    operation.databaseId,
    operation.dataSourceId,
    operation.name.trim(),
    operation.viewKind,
    stableStringifyDatabaseJson(config),
    revision,
    ranks.rankKey,
    existing?.created_at ?? now,
    now,
  );
  const metadata = database.prepare(`
    UPDATE database_containers
    SET default_view_id = CASE WHEN ? = 1 THEN ? ELSE default_view_id END,
      metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE block_id = ?
    RETURNING metadata_revision AS revision
  `).get(
    operation.isDefault ? 1 : 0,
    operation.viewId,
    now,
    operation.databaseId,
  ) as { readonly revision: number } | undefined;
  if (!metadata) {
    throw new DatabaseModuleV2StateError(
      `Database ${operation.databaseId} disappeared while writing View ${operation.viewId}`,
    );
  }
  if (
    operation.isDefault ||
    container.default_view_id === operation.viewId ||
    sourceChanged ||
    groupChanged
  ) {
    refreshDefaultViewProjection(database, operation.databaseId, now);
  }
  accumulator.databaseIds.add(operation.databaseId);
  accumulator.dataSourceIds.add(operation.dataSourceId);
  if (existing) {
    accumulator.dataSourceIds.add(parseDataSourceId(existing.data_source_id));
  }
  accumulator.viewIds.add(operation.viewId);
  accumulator.revisions[`view:${operation.viewId}`] = revision;
  accumulator.revisions[
    `database:${operation.databaseId}:metadata`
  ] = metadata.revision;
};

const applyDeleteView = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: DeleteDatabaseViewOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const container = requireApplyResource(
    readContainerRow(database, operation.databaseId),
    `Database does not exist: ${operation.databaseId}`,
    request,
  );
  const view = requireApplyResource(
    readViewRow(database, operation.viewId),
    `View does not exist: ${operation.viewId}`,
    request,
  );
  if (
    view.database_block_id !== operation.databaseId ||
    view.lifecycle !== "active"
  ) {
    rejectApply(
      "resource_not_found",
      `Active View does not exist: ${operation.viewId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "database", databaseId: operation.databaseId },
    "manage_views",
    authorityOptions,
  );
  requireRevision(
    request,
    `View ${operation.viewId}`,
    operation.expectedRevision,
    view.revision,
  );
  const wasDefault = container.default_view_id === operation.viewId;
  if (wasDefault) {
    database.prepare(`
      UPDATE database_containers
      SET default_view_id = NULL, metadata_revision = metadata_revision + 1,
        updated_at = ?
      WHERE block_id = ?
    `).run(now, operation.databaseId);
  } else {
    database.prepare(`
      UPDATE database_containers
      SET metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE block_id = ?
    `).run(now, operation.databaseId);
  }
  clearViewProjection(database, operation.viewId, now);
  database.prepare(`
    DELETE FROM database_view_page_positions WHERE view_id = ?
  `).run(operation.viewId);
  const revision = view.revision + 1;
  database.prepare(`
    UPDATE database_views
    SET lifecycle = 'deleted', revision = ?, updated_at = ?
    WHERE id = ?
  `).run(revision, now, operation.viewId);
  if (wasDefault) {
    refreshDefaultViewProjection(database, operation.databaseId, now);
  }
  const metadata = readContainerRow(database, operation.databaseId);
  if (!metadata) {
    throw new DatabaseModuleV2StateError(
      `Database ${operation.databaseId} disappeared while deleting View ${operation.viewId}`,
    );
  }
  accumulator.databaseIds.add(operation.databaseId);
  accumulator.dataSourceIds.add(parseDataSourceId(view.data_source_id));
  accumulator.viewIds.add(operation.viewId);
  accumulator.revisions[`view:${operation.viewId}`] = revision;
  accumulator.revisions[
    `database:${operation.databaseId}:metadata`
  ] = metadata.metadata_revision;
};

const applyPutOption = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PutDataSourceOptionOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (source.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Data Source does not exist: ${operation.dataSourceId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "data_source", dataSourceId: operation.dataSourceId },
    "manage_schema",
    authorityOptions,
  );
  const property = requireApplyResource(
    readPropertyRow(database, operation.dataSourceId, operation.propertyId),
    `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
    request,
  );
  if (property.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
      request,
    );
  }
  requireOptionBackedProperty(property, request);
  requireRevision(
    request,
    `Property ${operation.dataSourceId}/${operation.propertyId}`,
    operation.expectedPropertyRevision,
    property.schema_revision,
  );
  const registry = readOptionRegistry(property);
  let next: DataSourceOptionRegistry;
  try {
    next = putDataSourceOption(registry, {
      optionId: operation.optionId,
      name: operation.name,
      ...(operation.color === undefined ? {} : { color: operation.color }),
    });
  } catch (error) {
    return rejectRegistryMutationError(error, request);
  }
  if (next === registry) {
    accumulator.revisions[
      `property:${operation.dataSourceId}:${operation.propertyId}`
    ] = property.schema_revision;
    return;
  }
  const propertyRevision = property.schema_revision + 1;
  const sourceRevision = source.schema_revision + 1;
  database.prepare(`
    UPDATE data_source_properties
    SET config_json = ?, schema_revision = ?, updated_at = ?
    WHERE data_source_id = ? AND id = ?
  `).run(
    stableStringifyDatabaseJson(dataSourceOptionRegistryConfig(next)),
    propertyRevision,
    now,
    operation.dataSourceId,
    operation.propertyId,
  );
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, operation.dataSourceId);
  refreshRenamedTagCompatibilityValues(database, {
    dataSourceId: operation.dataSourceId,
    previousRegistry: registry,
    registry: next,
    now,
    accumulator,
  });
  accumulator.databaseIds.add(parseDatabaseId(source.home_database_block_id));
  accumulator.dataSourceIds.add(operation.dataSourceId);
  accumulator.revisions[`source:${operation.dataSourceId}`] = sourceRevision;
  accumulator.revisions[
    `property:${operation.dataSourceId}:${operation.propertyId}`
  ] = propertyRevision;
};

const applyDeleteOption = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: DeleteDataSourceOptionOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (source.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Data Source does not exist: ${operation.dataSourceId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "data_source", dataSourceId: operation.dataSourceId },
    "manage_schema",
    authorityOptions,
  );
  const property = requireApplyResource(
    readPropertyRow(database, operation.dataSourceId, operation.propertyId),
    `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
    request,
  );
  if (property.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
      request,
    );
  }
  requireOptionBackedProperty(property, request);
  requireRevision(
    request,
    `Property ${operation.dataSourceId}/${operation.propertyId}`,
    operation.expectedPropertyRevision,
    property.schema_revision,
  );
  const registry = readOptionRegistry(property);
  const selectedValues = (database.prepare(`
    SELECT value_json FROM data_source_property_values
    WHERE data_source_id = ? AND property_id = ?
    ORDER BY membership_id
  `).all(operation.dataSourceId, operation.propertyId) as readonly {
    readonly value_json: string;
  }[]).map((row) =>
    parseJson(
      row.value_json,
      `Property selection ${operation.dataSourceId}/${operation.propertyId}`,
    ),
  );
  try {
    for (const value of selectedValues) {
      validateDataSourceOptionSelection(registry, value);
    }
  } catch (error) {
    if (!(error instanceof DataSourceOptionRegistryError)) throw error;
    throw new DatabaseModuleV2StateError(error.message, { cause: error });
  }
  let next: DataSourceOptionRegistry;
  try {
    next = deleteDataSourceOption(registry, {
      optionId: operation.optionId,
      selectedValues,
    });
  } catch (error) {
    return rejectRegistryMutationError(error, request);
  }
  const propertyRevision = property.schema_revision + 1;
  const sourceRevision = source.schema_revision + 1;
  database.prepare(`
    UPDATE data_source_properties
    SET config_json = ?, schema_revision = ?, updated_at = ?
    WHERE data_source_id = ? AND id = ?
  `).run(
    stableStringifyDatabaseJson(dataSourceOptionRegistryConfig(next)),
    propertyRevision,
    now,
    operation.dataSourceId,
    operation.propertyId,
  );
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, operation.dataSourceId);
  accumulator.databaseIds.add(parseDatabaseId(source.home_database_block_id));
  accumulator.dataSourceIds.add(operation.dataSourceId);
  accumulator.revisions[`source:${operation.dataSourceId}`] = sourceRevision;
  accumulator.revisions[
    `property:${operation.dataSourceId}:${operation.propertyId}`
  ] = propertyRevision;
};

const readCurrentValue = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  membershipId: string,
  propertyId: DataSourcePropertyId,
): { readonly value: DatabaseJsonValue; readonly revision: number } | null => {
  const row = database.prepare(`
    SELECT value_json, revision FROM data_source_property_values
    WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
  `).get(dataSourceId, membershipId, propertyId) as
    | { readonly value_json: string; readonly revision: number }
    | undefined;
  return row
    ? {
        value: parseDatabaseJson(
          row.value_json,
          `Property value ${dataSourceId}/${membershipId}/${propertyId}`,
        ),
        revision: row.revision,
      }
    : null;
};

const updateGroupedPositions = (
  database: Database.Database,
  input: Readonly<{
    dataSourceId: DataSourceId;
    propertyId: DataSourcePropertyId;
    pageId: string;
    value: DatabaseJsonValue;
    now: string;
    accumulator: ApplyAccumulator;
  }>,
): void => {
  const views = database.prepare(`
    SELECT * FROM database_views
    WHERE data_source_id = ? AND lifecycle = 'active'
    ORDER BY id
  `).all(input.dataSourceId) as readonly ViewRow[];
  const groupKey = databaseGroupKeyForValue(input.value);
  for (const row of views) {
    const config = parseDatabaseViewConfigV2(
      parseJson(row.config_json, `View ${row.id} config`),
    );
    if (config.group?.propertyId !== input.propertyId) continue;
    const updated = database.prepare(`
      UPDATE database_view_page_positions
      SET group_key = ?, revision = revision + 1, updated_at = ?
      WHERE view_id = ? AND page_block_id = ?
      RETURNING revision
    `).get(groupKey, input.now, row.id, input.pageId) as
      | { readonly revision: number }
      | undefined;
    if (!updated) continue;
    database.prepare(`
      UPDATE page_read_model
      SET view_group_key = ?, projection_version = projection_version + 1,
        updated_at = ?
      WHERE page_block_id = ? AND view_id = ?
    `).run(groupKey, input.now, input.pageId, row.id);
    const viewId = parseDatabaseViewId(row.id);
    input.accumulator.viewIds.add(viewId);
    input.accumulator.revisions[
      `position:${viewId}:${input.pageId}`
    ] = updated.revision;
  }
};

const applySetValue = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: SetDataSourcePageValueOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  requireAuthorization(
    database,
    request,
    { kind: "page", pageId: operation.pageId },
    "write",
    authorityOptions,
  );
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  if (source.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Data Source does not exist: ${operation.dataSourceId}`,
      request,
    );
  }
  const property = requireApplyResource(
    readPropertyRow(database, operation.dataSourceId, operation.propertyId),
    `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
    request,
  );
  if (property.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
      request,
    );
  }
  requireOptionBackedProperty(property, request);
  const registry = readOptionRegistry(property);
  const membership = requireApplyResource(
    readActiveMembership(
      database,
      operation.pageId,
      operation.dataSourceId,
    ),
    `Page ${operation.pageId} has no active membership in Data Source ${operation.dataSourceId}`,
    request,
  );
  const page = requireApplyResource(
    database.prepare(`
      SELECT parent_kind, parent_id FROM pages
      WHERE block_id = ? AND lifecycle <> 'deleted'
    `).get(operation.pageId) as
      | { readonly parent_kind: string; readonly parent_id: string }
      | undefined,
    `Page does not exist: ${operation.pageId}`,
    request,
  );
  if (page.parent_kind !== "data_source" || page.parent_id !== source.id) {
    rejectApply(
      "resource_not_found",
      `Page ${operation.pageId} is not an active row in Data Source ${operation.dataSourceId}`,
      request,
    );
  }
  const existing = readCurrentValue(
    database,
    operation.dataSourceId,
    membership.id,
    operation.propertyId,
  );
  requireRevision(
    request,
    `Value ${operation.dataSourceId}/${membership.id}/${operation.propertyId}`,
    operation.expectedValueRevision,
    existing?.revision ?? 0,
  );
  let value: DatabaseJsonValue;
  try {
    value = validateDataSourceOptionSelection(
      registry,
      operation.value,
    ) as DatabaseJsonValue;
  } catch (error) {
    return rejectRegistryMutationError(error, request);
  }
  const revision = (existing?.revision ?? 0) + 1;
  database.prepare(`
    INSERT INTO data_source_property_values (
      data_source_id, membership_id, property_id, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_source_id, membership_id, property_id) DO UPDATE SET
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `).run(
    operation.dataSourceId,
    membership.id,
    operation.propertyId,
    property.value_type,
    stableStringifyDatabaseJson(value),
    revision,
    now,
  );
  updateGroupedPositions(database, {
    dataSourceId: operation.dataSourceId,
    propertyId: operation.propertyId,
    pageId: operation.pageId,
    value,
    now,
    accumulator,
  });
  const metadataRevision = updatePageMetadataRevision(
    database,
    operation.pageId,
    now,
  );
  refreshPageCompatibilityProjection(database, {
    pageId: operation.pageId,
    propertyId: operation.propertyId,
    value,
    valueRevision: revision,
    metadataRevision,
    registry,
    now,
  });
  accumulator.databaseIds.add(parseDatabaseId(source.home_database_block_id));
  accumulator.dataSourceIds.add(operation.dataSourceId);
  accumulator.pageIds.add(operation.pageId);
  accumulator.revisions[
    `value:${operation.dataSourceId}:${membership.id}:${operation.propertyId}`
  ] = revision;
  accumulator.revisions[
    `page:${operation.pageId}:metadata`
  ] = metadataRevision;
};

const applyAddRemoveValue = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: Extract<
    DatabaseApplyOperationV2,
    { readonly kind: "add_remove_value" }
  >,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  requireAuthorization(
    database,
    request,
    { kind: "page", pageId: operation.pageId },
    "write",
    authorityOptions,
  );
  const property = requireApplyResource(
    readPropertyRow(database, operation.dataSourceId, operation.propertyId),
    `Active Property does not exist: ${operation.dataSourceId}/${operation.propertyId}`,
    request,
  );
  if (property.lifecycle !== "active" || property.value_type !== "multi_select") {
    rejectApply(
      "invalid_request",
      `Property ${operation.dataSourceId}/${operation.propertyId} does not support set-like option updates`,
      request,
    );
  }
  const registry = readOptionRegistry(property);
  const membership = requireApplyResource(
    readActiveMembership(
      database,
      operation.pageId,
      operation.dataSourceId,
    ),
    `Page ${operation.pageId} has no active membership in Data Source ${operation.dataSourceId}`,
    request,
  );
  const existing = readCurrentValue(
    database,
    operation.dataSourceId,
    membership.id,
    operation.propertyId,
  );
  let current: readonly string[];
  try {
    const selection = validateDataSourceOptionSelection(
      registry,
      existing?.value ?? [],
    );
    current = selection === null
      ? []
      : typeof selection === "string"
        ? [selection]
        : selection;
  } catch (error) {
    if (!(error instanceof DataSourceOptionRegistryError)) throw error;
    throw new DatabaseModuleV2StateError(error.message, { cause: error });
  }
  try {
    validateDataSourceOptionSelection(registry, operation.add);
    validateDataSourceOptionSelection(registry, operation.remove);
  } catch (error) {
    return rejectRegistryMutationError(error, request);
  }
  const next = new Set(current);
  for (const optionId of operation.remove) next.delete(optionId);
  for (const optionId of operation.add) next.add(optionId);
  const nextValue = [...next].sort(compareStrings);
  if (
    nextValue.length === current.length &&
    nextValue.every((value, index) => value === current[index])
  ) {
    return;
  }
  applySetValue(
    database,
    request,
    {
      kind: "set_value",
      pageId: operation.pageId,
      dataSourceId: operation.dataSourceId,
      propertyId: operation.propertyId,
      expectedValueRevision: existing?.revision ?? 0,
      value: nextValue,
    },
    now,
    accumulator,
    authorityOptions,
  );
};

const readPageProjectId = (
  database: Database.Database,
  pageId: string,
): string => {
  const row = database.prepare(`
    SELECT project_id AS projectId FROM blocks WHERE id = ? AND type = 'page'
  `).get(pageId) as { readonly projectId: string } | undefined;
  if (row) return row.projectId;
  throw new DatabaseModuleV2StateError(`Page ${pageId} has no Block identity`);
};

const appendTopLevelPlacement = (
  database: Database.Database,
  projectId: string,
  pageId: string,
  now: string,
): void => {
  const items = database.prepare(`
    SELECT block_id AS id, rank_key AS rankKey
    FROM top_level_block_placements
    WHERE project_id = ? ORDER BY rank_key, block_id
  `).all(projectId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[];
  const ranks = planDatabaseFractionalRank({ items, targetId: pageId });
  const update = database.prepare(`
    UPDATE top_level_block_placements SET rank_key = ?, updated_at = ?
    WHERE block_id = ?
  `);
  for (const [blockId, rankKey] of ranks.rebalancedRankKeys) {
    update.run(rankKey, now, blockId);
  }
  database.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(block_id) DO UPDATE SET
      project_id = excluded.project_id,
      rank_key = excluded.rank_key,
      updated_at = excluded.updated_at
  `).run(pageId, projectId, ranks.rankKey, now, now);
};

const deterministicMembershipId = (
  dataSourceId: DataSourceId,
  pageId: string,
): string =>
  `membership:${createHash("sha256")
    .update(dataSourceId)
    .update("\0")
    .update(pageId)
    .digest("hex")}`;

const requireAcyclicPageParent = (
  database: Database.Database,
  pageId: string,
  targetPageId: string,
  request: DatabaseApplyV2,
): void => {
  if (pageId === targetPageId) {
    rejectApply(
      "unsupported_operation",
      "A Page cannot be its own parent",
      request,
    );
  }
  const cycle = database.prepare(`
    WITH RECURSIVE ancestors(page_id, parent_kind, parent_id, depth) AS (
      SELECT block_id, parent_kind, parent_id, 0
      FROM pages WHERE block_id = ?
      UNION ALL
      SELECT parent.block_id, parent.parent_kind, parent.parent_id,
        ancestors.depth + 1
      FROM ancestors
      INNER JOIN pages parent
        ON ancestors.parent_kind = 'page'
        AND parent.block_id = ancestors.parent_id
      WHERE ancestors.depth < 512
    )
    SELECT 1 FROM ancestors WHERE page_id = ? LIMIT 1
  `).get(targetPageId, pageId);
  if (!cycle) return;
  rejectApply(
    "unsupported_operation",
    `Moving Page ${pageId} below ${targetPageId} would create a cycle`,
    request,
  );
};

const defaultValueForBuiltInProperty = (
  property: PropertyRow,
): DatabaseJsonValue => {
  if (property.id === "tags") return [];
  if (property.id === "status") {
    const registry = readOptionRegistry(property);
    return registry.options.some(
      (option) => option.optionId === DEFAULT_WORKFLOW_STATUS,
    )
      ? DEFAULT_WORKFLOW_STATUS
      : null;
  }
  return null;
};

const mapTagsBetweenSources = (
  sourceProperty: PropertyRow,
  sourceValue: DatabaseJsonValue,
  targetProperty: PropertyRow,
): DatabaseJsonValue => {
  const sourceRegistry = readOptionRegistry(sourceProperty);
  const targetRegistry = readOptionRegistry(targetProperty);
  const selected = validateDataSourceOptionSelection(
    sourceRegistry,
    sourceValue,
  );
  if (selected === null) return [];
  if (typeof selected === "string") {
    throw new DatabaseModuleV2StateError(
      `Tags Property ${sourceProperty.data_source_id}/tags has scalar state`,
    );
  }
  const sourceNames = new Map(
    sourceRegistry.options.map((option) => [
      option.optionId,
      option.name,
    ] as const),
  );
  const targetIds = new Map(
    targetRegistry.options.map((option) => [
      option.name,
      option.optionId,
    ] as const),
  );
  return selected.flatMap((optionId) => {
    const name = sourceNames.get(optionId);
    const targetId = name ? targetIds.get(name) : undefined;
    return targetId ? [targetId] : [];
  });
};

const transferValueForProperty = (
  sourceProperty: PropertyRow | null,
  sourceValue: DatabaseJsonValue | null,
  targetProperty: PropertyRow,
): DatabaseJsonValue => {
  if (!sourceProperty || sourceValue === null) {
    return defaultValueForBuiltInProperty(targetProperty);
  }
  if (
    sourceProperty.value_type !== targetProperty.value_type ||
    sourceProperty.lifecycle !== "active"
  ) {
    return defaultValueForBuiltInProperty(targetProperty);
  }
  if (targetProperty.id === "tags") {
    return mapTagsBetweenSources(
      sourceProperty,
      sourceValue,
      targetProperty,
    );
  }
  if (
    targetProperty.value_type === "select" ||
    targetProperty.value_type === "multi_select"
  ) {
    try {
      return validateDataSourceOptionSelection(
        readOptionRegistry(targetProperty),
        sourceValue,
      ) as DatabaseJsonValue;
    } catch (error) {
      if (!(error instanceof DataSourceOptionRegistryError)) throw error;
      return defaultValueForBuiltInProperty(targetProperty);
    }
  }
  try {
    return normalizeDatabasePropertyValue(
      {
        valueType: targetProperty.value_type,
        config: parsePropertyConfig(targetProperty),
      },
      sourceValue,
    );
  } catch {
    return defaultValueForBuiltInProperty(targetProperty);
  }
};

const ensureTransferredBuiltInValues = (
  database: Database.Database,
  input: Readonly<{
    sourceMembership: MembershipRow | null;
    sourceDataSourceId: DataSourceId | null;
    targetMembershipId: string;
    targetDataSourceId: DataSourceId;
    now: string;
    accumulator: ApplyAccumulator;
  }>,
): void => {
  const targetProperties = database.prepare(`
    SELECT * FROM data_source_properties
    WHERE data_source_id = ? AND lifecycle = 'active'
    ORDER BY id
  `).all(input.targetDataSourceId) as readonly PropertyRow[];
  const insert = database.prepare(`
    INSERT INTO data_source_property_values (
      data_source_id, membership_id, property_id, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const targetProperty of targetProperties) {
    if (!isBuiltInDataSourcePropertyId(targetProperty.id)) continue;
    const existing = database.prepare(`
      SELECT revision FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
    `).get(
      input.targetDataSourceId,
      input.targetMembershipId,
      targetProperty.id,
    ) as { readonly revision: number } | undefined;
    if (existing) continue;
    const sourceProperty = input.sourceDataSourceId
      ? readPropertyRow(
          database,
          input.sourceDataSourceId,
          targetProperty.id,
        )
      : null;
    const sourceStored =
      input.sourceMembership && input.sourceDataSourceId
        ? readCurrentValue(
            database,
            input.sourceDataSourceId,
            input.sourceMembership.id,
            parseDataSourcePropertyId(targetProperty.id),
          )
        : null;
    const value = transferValueForProperty(
      sourceProperty,
      sourceStored?.value ?? null,
      targetProperty,
    );
    insert.run(
      input.targetDataSourceId,
      input.targetMembershipId,
      targetProperty.id,
      targetProperty.value_type,
      stableStringifyDatabaseJson(value),
      input.now,
    );
    input.accumulator.revisions[
      `value:${input.targetDataSourceId}:${input.targetMembershipId}:${targetProperty.id}`
    ] = 1;
  }
};

const readCompatibilityValues = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  membershipId: string,
): Readonly<{
  values: Readonly<Record<string, DatabaseJsonValue>>;
  revisions: Readonly<Record<string, number>>;
}> => {
  const rows = database.prepare(`
    SELECT property.*, value.value_json, value.revision AS value_revision
    FROM data_source_properties property
    LEFT JOIN data_source_property_values value
      ON value.data_source_id = property.data_source_id
      AND value.property_id = property.id
      AND value.membership_id = ?
    WHERE property.data_source_id = ? AND property.lifecycle = 'active'
    ORDER BY property.id
  `).all(membershipId, dataSourceId) as readonly (PropertyRow & {
    readonly value_json: string | null;
    readonly value_revision: number | null;
  })[];
  const values: Record<string, DatabaseJsonValue> = {};
  const revisions: Record<string, number> = {};
  for (const row of rows) {
    if (!isBuiltInDataSourcePropertyId(row.id) || row.value_json === null) {
      continue;
    }
    const value = parseDatabaseJson(
      row.value_json,
      `Property value ${dataSourceId}/${membershipId}/${row.id}`,
    );
    values[row.id] =
      row.id === "tags"
        ? compatibilityValue(readOptionRegistry(row), value)
        : value;
    if (row.value_revision !== null) revisions[row.id] = row.value_revision;
  }
  return { values, revisions };
};

const readPreferredViewPlacement = (
  database: Database.Database,
  dataSourceId: DataSourceId,
  pageId: string,
): Readonly<{
  viewId: DatabaseViewId | null;
  groupKey: string | null;
  rankKey: string | null;
}> => {
  const view = database.prepare(`
    SELECT view.id
    FROM data_sources source
    INNER JOIN database_containers container
      ON container.block_id = source.home_database_block_id
    INNER JOIN database_views view
      ON view.database_block_id = container.block_id
      AND view.data_source_id = source.id
      AND view.lifecycle = 'active'
    WHERE source.id = ?
    ORDER BY CASE WHEN view.id = container.default_view_id THEN 0 ELSE 1 END,
      view.rank_key, view.id
    LIMIT 1
  `).get(dataSourceId) as { readonly id: string } | undefined;
  if (!view) return { viewId: null, groupKey: null, rankKey: null };
  const position = database.prepare(`
    SELECT group_key, rank_key FROM database_view_page_positions
    WHERE view_id = ? AND page_block_id = ?
  `).get(view.id, pageId) as
    | { readonly group_key: string | null; readonly rank_key: string }
    | undefined;
  return {
    viewId: parseDatabaseViewId(view.id),
    groupKey: position?.group_key ?? null,
    rankKey: position?.rank_key ?? null,
  };
};

const refreshTransferredPageProjection = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    targetMembershipId: string | null;
    targetDataSourceId: DataSourceId | null;
    now: string;
  }>,
): void => {
  const authority = database.prepare(`
    SELECT block.project_id, block.lifecycle, block.location_kind,
      block.containing_document_id, block.containing_database_id,
      block.location_revision, block.metadata_revision,
      placement.rank_key AS top_level_rank_key
    FROM blocks block
    LEFT JOIN top_level_block_placements placement
      ON placement.block_id = block.id
    WHERE block.id = ? AND block.type = 'page'
  `).get(input.pageId) as
    | {
        readonly project_id: string;
        readonly lifecycle: "active" | "archived" | "deleted";
        readonly location_kind: "space" | "document" | "database";
        readonly containing_document_id: string | null;
        readonly containing_database_id: string | null;
        readonly location_revision: number;
        readonly metadata_revision: number;
        readonly top_level_rank_key: string | null;
      }
    | undefined;
  if (!authority) {
    throw new DatabaseModuleV2StateError(
      `Page ${input.pageId} disappeared during transfer projection`,
    );
  }
  const compatibility =
    input.targetMembershipId && input.targetDataSourceId
      ? readCompatibilityValues(
          database,
          input.targetDataSourceId,
          input.targetMembershipId,
        )
      : { values: {}, revisions: {} };
  const view = input.targetDataSourceId
    ? readPreferredViewPlacement(
        database,
        input.targetDataSourceId,
        input.pageId,
      )
    : { viewId: null, groupKey: null, rankKey: null };
  const projection = database.prepare(`
    SELECT property_revisions_json FROM page_read_model WHERE page_block_id = ?
  `).get(input.pageId) as
    | { readonly property_revisions_json: string }
    | undefined;
  if (!projection) {
    throw new DatabaseModuleV2StateError(
      `Page ${input.pageId} has no compatibility projection`,
    );
  }
  const propertyRevisions = readJsonObject(
    projection.property_revisions_json,
    `Page read projection ${input.pageId} Property revisions`,
  );
  propertyRevisions.database = compatibility.revisions;
  const updated = database.prepare(`
    UPDATE page_read_model
    SET project_id = ?, lifecycle = ?, location_kind = ?,
      containing_document_id = ?, containing_database_id = ?,
      top_level_rank_key = ?, location_revision = ?, metadata_revision = ?,
      membership_id = ?, database_block_id = ?, view_id = ?,
      view_group_key = ?, view_rank_key = ?, database_values_json = ?,
      property_revisions_json = ?, projection_version = projection_version + 1,
      updated_at = ?
    WHERE page_block_id = ?
  `).run(
    authority.project_id,
    authority.lifecycle,
    authority.location_kind,
    authority.containing_document_id,
    authority.containing_database_id,
    authority.top_level_rank_key,
    authority.location_revision,
    authority.metadata_revision,
    input.targetMembershipId,
    authority.containing_database_id,
    view.viewId,
    view.groupKey,
    view.rankKey,
    stableStringifyDatabaseJson(compatibility.values),
    stableStringifyDatabaseJson(propertyRevisions),
    input.now,
    input.pageId,
  );
  if (updated.changes !== 1) {
    throw new DatabaseModuleV2StateError(
      `Page ${input.pageId} compatibility projection disappeared`,
    );
  }
  const scheduledStart = compatibility.values.scheduled_start;
  const scheduledEnd = compatibility.values.scheduled_end;
  const hasSchedule =
    (scheduledStart === null || typeof scheduledStart === "string") &&
    (scheduledEnd === null || typeof scheduledEnd === "string") &&
    scheduledStart !== undefined &&
    scheduledEnd !== undefined;
  const schedule = database.prepare(`
    UPDATE scheduled_page_index
    SET lifecycle = ?, scheduled_start = ?, scheduled_end = ?,
      is_all_day = CASE
        WHEN ? = 1 AND ? IS NOT NULL AND ? IS NOT NULL THEN is_all_day
        ELSE 0
      END,
      source_metadata_revision = ?, updated_at = ?
    WHERE page_block_id = ?
  `).run(
    authority.lifecycle,
    hasSchedule ? scheduledStart : null,
    hasSchedule ? scheduledEnd : null,
    hasSchedule ? 1 : 0,
    hasSchedule ? scheduledStart : null,
    hasSchedule ? scheduledEnd : null,
    authority.metadata_revision,
    input.now,
    input.pageId,
  );
  if (schedule.changes !== 1) {
    throw new DatabaseModuleV2StateError(
      `Page ${input.pageId} has no scheduled compatibility projection`,
    );
  }
};

const applyTransferPage = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: TransferDataSourcePageOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  allowPageParentTransition = false,
  authorityOptions: DatabaseModuleApplyAuthorityOptions = {},
): void => {
  const page = requireApplyResource(
    database.prepare(`
      SELECT block_id, library_id, parent_kind, parent_id, parent_revision
      FROM pages WHERE block_id = ? AND lifecycle <> 'deleted'
    `).get(operation.pageId) as
      | {
          readonly block_id: string;
          readonly library_id: string;
          readonly parent_kind: "library" | "page" | "data_source";
          readonly parent_id: string;
          readonly parent_revision: number;
        }
      | undefined,
    `Page does not exist: ${operation.pageId}`,
    request,
  );
  if (
    !allowPageParentTransition &&
    (page.parent_kind === "page" || operation.target.kind === "page")
  ) {
    rejectApply(
      "unsupported_operation",
      "Page-parent transitions require BlockTransfer Document authority",
      request,
    );
  }
  if (!allowPageParentTransition) {
    requireAuthorization(
      database,
      request,
      { kind: "page", pageId: operation.pageId },
      "move",
      authorityOptions,
    );
  }
  requireRevision(
    request,
    `Page ${operation.pageId} parent`,
    operation.expectedParentRevision,
    page.parent_revision,
  );
  const activeMembership = database.prepare(`
    SELECT id, data_source_id, page_block_id, revision, created_at,
      NULL AS group_key, NULL AS rank_key, NULL AS position_revision
    FROM data_source_page_memberships
    WHERE page_block_id = ? AND removed_at IS NULL
  `).get(operation.pageId) as MembershipRow | undefined;
  requireRevision(
    request,
    `Page ${operation.pageId} active membership`,
    operation.expectedActiveMembershipRevision,
    activeMembership?.revision ?? 0,
  );
  const previousSource = activeMembership
    ? readSourceRow(database, activeMembership.data_source_id)
    : null;
  const positionedViews = database.prepare(`
    SELECT view_id FROM database_view_page_positions WHERE page_block_id = ?
  `).all(operation.pageId) as readonly { readonly view_id: string }[];
  if (activeMembership) {
    const removedRevision = activeMembership.revision + 1;
    database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = ?
      WHERE id = ? AND removed_at IS NULL
    `).run(now, removedRevision, activeMembership.id);
    accumulator.revisions[
      `membership:${activeMembership.data_source_id}:${activeMembership.id}`
    ] = removedRevision;
  }
  database.prepare(`
    DELETE FROM database_view_page_positions WHERE page_block_id = ?
  `).run(operation.pageId);
  for (const position of positionedViews) {
    accumulator.viewIds.add(parseDatabaseViewId(position.view_id));
  }
  let targetMembershipId: string | null = null;
  let targetDataSourceId: DataSourceId | null = null;

  if (operation.target.kind === "library") {
    if (operation.target.libraryId !== page.library_id) {
      rejectApply(
        "authorization_denied",
        "A Page cannot move to another Library",
        request,
      );
    }
    const projectId = readPageProjectId(database, operation.pageId);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'space', containing_document_id = NULL,
        containing_database_id = NULL,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE id = ?
    `).run(now, operation.pageId);
    appendTopLevelPlacement(database, projectId, operation.pageId, now);
    const libraryPlacement = database.prepare(`
      INSERT INTO library_block_placements (
        block_id, library_id, rank_key, revision, created_at, updated_at
      )
      SELECT placement.block_id, project.library_id, placement.rank_key,
        1, placement.created_at, placement.updated_at
      FROM top_level_block_placements placement
      INNER JOIN projects project ON project.id = placement.project_id
      WHERE placement.block_id = ?
      ON CONFLICT(block_id) DO UPDATE SET
        library_id = excluded.library_id,
        rank_key = excluded.rank_key,
        revision = library_block_placements.revision + 1,
        updated_at = excluded.updated_at
    `).run(operation.pageId);
    if (libraryPlacement.changes !== 1) {
      throw new DatabaseModuleV2StateError(
        `Page ${operation.pageId} has no canonical Library placement`,
      );
    }
  } else if (operation.target.kind === "page") {
    const targetPage = requireApplyResource(
      database.prepare(`
        SELECT block_id, library_id, document_id
        FROM pages WHERE block_id = ? AND lifecycle <> 'deleted'
      `).get(operation.target.pageId) as
        | {
            readonly block_id: string;
            readonly library_id: string;
            readonly document_id: string;
          }
        | undefined,
      `Target Page does not exist: ${operation.target.pageId}`,
      request,
    );
    if (targetPage.library_id !== page.library_id) {
      rejectApply(
        "resource_not_found",
        `Target Page does not exist: ${operation.target.pageId}`,
        request,
      );
    }
    if (!allowPageParentTransition) {
      requireAuthorization(
        database,
        request,
        { kind: "page", pageId: targetPage.block_id },
        "create_child",
        authorityOptions,
      );
    }
    requireAcyclicPageParent(
      database,
      operation.pageId,
      targetPage.block_id,
      request,
    );
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(operation.pageId);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'document', containing_document_id = ?,
        containing_database_id = NULL,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE id = ?
    `).run(targetPage.document_id, now, operation.pageId);
  } else {
    const targetSource = requireApplyResource(
      readSourceRow(database, operation.target.dataSourceId),
      `Target Data Source does not exist: ${operation.target.dataSourceId}`,
      request,
    );
    if (
      targetSource.library_id !== page.library_id ||
      targetSource.lifecycle !== "active"
    ) {
      rejectApply(
        "resource_not_found",
        `Target Data Source does not exist: ${operation.target.dataSourceId}`,
        request,
      );
    }
    if (!allowPageParentTransition) {
      requireAuthorization(
        database,
        request,
        { kind: "data_source", dataSourceId: operation.target.dataSourceId },
        "create_child",
        authorityOptions,
      );
    }
    if (activeMembership?.data_source_id === targetSource.id) {
      rejectApply(
        "unsupported_operation",
        `Page ${operation.pageId} already belongs to Data Source ${targetSource.id}`,
        request,
      );
    }
    const targetHistory = database.prepare(`
      SELECT id, revision, created_at
      FROM data_source_page_memberships
      WHERE data_source_id = ? AND page_block_id = ?
    `).get(targetSource.id, operation.pageId) as
      | {
          readonly id: string;
          readonly revision: number;
          readonly created_at: string;
        }
      | undefined;
    targetMembershipId =
      targetHistory?.id ??
      deterministicMembershipId(
        operation.target.dataSourceId,
        operation.pageId,
      );
    if (!targetHistory) {
      const collision = database.prepare(`
        SELECT data_source_id, page_block_id
        FROM data_source_page_memberships WHERE id = ?
      `).get(targetMembershipId) as
        | { readonly data_source_id: string; readonly page_block_id: string }
        | undefined;
      if (collision) {
        rejectApply(
          "identity_conflict",
          `Membership identity ${targetMembershipId} already belongs to another Page or Data Source`,
          request,
        );
      }
    }
    const targetRevision = (targetHistory?.revision ?? 0) + 1;
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(operation.pageId);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'database', containing_document_id = NULL,
        containing_database_id = ?,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE id = ?
    `).run(
      targetSource.home_database_block_id,
      now,
      operation.pageId,
    );
    database.prepare(`
      INSERT INTO data_source_page_memberships (
        id, data_source_id, page_block_id, revision, created_at, removed_at
      ) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        data_source_id = excluded.data_source_id,
        page_block_id = excluded.page_block_id,
        revision = excluded.revision,
        removed_at = NULL
    `).run(
      targetMembershipId,
      targetSource.id,
      operation.pageId,
      targetRevision,
      targetHistory?.created_at ?? now,
    );
    targetDataSourceId = operation.target.dataSourceId;
    ensureTransferredBuiltInValues(database, {
      sourceMembership: activeMembership ?? null,
      sourceDataSourceId: activeMembership
        ? parseDataSourceId(activeMembership.data_source_id)
        : null,
      targetMembershipId,
      targetDataSourceId,
      now,
      accumulator,
    });
    accumulator.revisions[
      `membership:${targetSource.id}:${targetMembershipId}`
    ] = targetRevision;
    accumulator.databaseIds.add(
      parseDatabaseId(targetSource.home_database_block_id),
    );
    accumulator.dataSourceIds.add(operation.target.dataSourceId);
  }

  if (operation.target.kind !== "library") {
    database.prepare(`
      DELETE FROM library_block_placements WHERE block_id = ?
    `).run(operation.pageId);
  }
  const parentKind = operation.target.kind === "library"
    ? "library"
    : operation.target.kind === "page"
      ? "page"
      : "data_source";
  const parentId = operation.target.kind === "library"
    ? operation.target.libraryId
    : operation.target.kind === "page"
      ? operation.target.pageId
      : operation.target.dataSourceId;
  const updatedParent = database.prepare(`
    UPDATE pages
    SET parent_kind = ?, parent_id = ?,
      parent_revision = parent_revision + 1,
      metadata_revision = metadata_revision + 1,
      updated_at = ?
    WHERE block_id = ? AND parent_revision = ?
  `).run(
    parentKind,
    parentId,
    now,
    operation.pageId,
    operation.expectedParentRevision,
  );
  if (updatedParent.changes !== 1) {
    throw new DatabaseModuleV2StateError(
      `Page ${operation.pageId} parent authority changed during transfer`,
    );
  }

  refreshTransferredPageProjection(database, {
    pageId: operation.pageId,
    targetMembershipId,
    targetDataSourceId,
    now,
  });
  const updatedPage = database.prepare(`
    SELECT parent_revision AS parentRevision,
      metadata_revision AS metadataRevision
    FROM pages WHERE block_id = ?
  `).get(operation.pageId) as
    | { readonly parentRevision: number; readonly metadataRevision: number }
    | undefined;
  if (!updatedPage) {
    throw new DatabaseModuleV2StateError(
      `Page ${operation.pageId} disappeared after transfer`,
    );
  }
  if (previousSource) {
    accumulator.databaseIds.add(
      parseDatabaseId(previousSource.home_database_block_id),
    );
    accumulator.dataSourceIds.add(parseDataSourceId(previousSource.id));
  }
  accumulator.pageIds.add(operation.pageId);
  accumulator.revisions[`page:${operation.pageId}:parent`] =
    updatedPage.parentRevision;
  accumulator.revisions[`page:${operation.pageId}:metadata`] =
    updatedPage.metadataRevision;
};

export type BlockTransferPageParentTransitionResultV2 =
  | {
      readonly ok: true;
      readonly value: Readonly<{
        affectedDatabaseIds: readonly DatabaseId[];
        affectedDataSourceIds: readonly DataSourceId[];
        affectedPageIds: readonly string[];
        affectedViewIds: readonly DatabaseViewId[];
        committedRevisions: Readonly<Record<string, number>>;
      }>;
    }
  | { readonly ok: false; readonly error: DatabaseModuleErrorV2 };

/**
 * Trusted BlockTransfer seam for Page-parent transitions. The caller must stage
 * the corresponding source/target Document update in the same outer writer
 * transaction before invoking this relational transition.
 */
export const transitionPageParentForBlockTransferV2 = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: TransferDataSourcePageOperationV2,
  now: string,
): BlockTransferPageParentTransitionResultV2 => {
  const accumulator: ApplyAccumulator = {
    databaseIds: new Set(),
    dataSourceIds: new Set(),
    pageIds: new Set(),
    viewIds: new Set(),
    revisions: {},
  };
  try {
    applyTransferPage(
      database,
      request,
      operation,
      now,
      accumulator,
      true,
    );
    return {
      ok: true,
      value: {
        affectedDatabaseIds: uniqueSorted(accumulator.databaseIds),
        affectedDataSourceIds: uniqueSorted(accumulator.dataSourceIds),
        affectedPageIds: uniqueSorted(accumulator.pageIds),
        affectedViewIds: uniqueSorted(accumulator.viewIds),
        committedRevisions: accumulator.revisions,
      },
    };
  } catch (error) {
    if (!(error instanceof DatabaseModuleV2Rejection)) throw error;
    return { ok: false, error: error.error };
  }
};

interface PositionRunEntry {
  readonly pageId: string;
  readonly expectedPositionRevision: number;
}

const explicitlyPositionedPageIds = (
  request: DatabaseApplyV2,
  viewId: DatabaseViewId,
): ReadonlySet<string> =>
  new Set(
    request.operations.flatMap((operation) => {
      if (operation.kind === "position_page" && operation.viewId === viewId) {
        return [operation.pageId];
      }
      if (operation.kind === "position_pages" && operation.viewId === viewId) {
        return operation.pages.map((page) => page.pageId);
      }
      return [];
    }),
  );

const readLogicalPositionItems = (
  database: Database.Database,
  input: Readonly<{
    view: DatabaseViewRecordV2;
    groupKey: string | null;
    excludedPageIds: ReadonlySet<string>;
    positionConsistencyExemptPageIds: ReadonlySet<string>;
  }>,
): readonly LogicalDatabaseViewPositionItem[] => {
  const materialized = materializeRows(database, {
    dataSourceId: input.view.dataSourceId,
    viewId: input.view.viewId,
    groupPropertyId: input.view.config.group?.propertyId
      ? parseDataSourcePropertyId(input.view.config.group.propertyId)
      : null,
    filter: { kind: "group", operator: "and", children: [] },
    sort: input.view.config.sort,
    excludedPositionConsistencyPageIds:
      input.positionConsistencyExemptPageIds,
  });
  return materialized.rows.flatMap((row) => {
    if (
      input.excludedPageIds.has(row.page.pageId) ||
      row.effectiveGroupKey !== input.groupKey
    ) {
      return [];
    }
    return [{
      pageId: row.page.pageId,
      rankKey: row.position?.rankKey ?? null,
    } satisfies LogicalDatabaseViewPositionItem];
  });
};

const refreshMovedPositionProjection = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    viewId: DatabaseViewId;
    groupKey: string | null;
    rankKey: string;
    metadataRevision: number;
    now: string;
  }>,
): void => {
  database.prepare(`
    UPDATE page_read_model
    SET metadata_revision = ?,
      view_group_key = CASE WHEN view_id = ? THEN ? ELSE view_group_key END,
      view_rank_key = CASE WHEN view_id = ? THEN ? ELSE view_rank_key END,
      projection_version = projection_version + 1, updated_at = ?
    WHERE page_block_id = ?
  `).run(
    input.metadataRevision,
    input.viewId,
    input.groupKey,
    input.viewId,
    input.rankKey,
    input.now,
    input.pageId,
  );
};

const refreshSiblingPositionProjection = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    viewId: DatabaseViewId;
    groupKey: string | null;
    rankKey: string;
    now: string;
  }>,
): void => {
  database.prepare(`
    UPDATE page_read_model
    SET view_group_key = ?, view_rank_key = ?,
      projection_version = projection_version + 1, updated_at = ?
    WHERE page_block_id = ? AND view_id = ?
  `).run(
    input.groupKey,
    input.rankKey,
    input.now,
    input.pageId,
    input.viewId,
  );
};

const applyPositionRun = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: Readonly<{
    viewId: DatabaseViewId;
    pages: readonly PositionRunEntry[];
    groupKey: string | null;
    beforePageId?: string;
  }>,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  const pageIds = operation.pages.map((page) => page.pageId);
  if (new Set(pageIds).size !== pageIds.length) {
    rejectApply(
      "invalid_request",
      "Bulk View position Page IDs must be unique",
      request,
    );
  }
  if (operation.beforePageId && pageIds.includes(operation.beforePageId)) {
    rejectApply(
      "invalid_request",
      "Bulk View position anchor must be outside the moved Page set",
      request,
    );
  }
  const viewRow = requireApplyResource(
    readViewRow(database, operation.viewId),
    `View does not exist: ${operation.viewId}`,
    request,
  );
  if (viewRow.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active View does not exist: ${operation.viewId}`,
      request,
    );
  }
  const view = rowToView(database, viewRow);
  requireAuthorization(
    database,
    request,
    { kind: "view", viewId: operation.viewId },
    "read",
    authorityOptions,
  );
  const validated = operation.pages.map((entry) => {
    requireAuthorization(
      database,
      request,
      { kind: "page", pageId: entry.pageId },
      "write",
      authorityOptions,
    );
    const membership = requireApplyResource(
      readActiveMembership(database, entry.pageId, view.dataSourceId),
      `Page ${entry.pageId} is not in View ${view.viewId}'s Data Source`,
      request,
    );
    const existing = database.prepare(`
      SELECT revision FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(view.viewId, entry.pageId) as
      | { readonly revision: number }
      | undefined;
    requireRevision(
      request,
      `View position ${view.viewId}/${entry.pageId}`,
      entry.expectedPositionRevision,
      existing?.revision ?? 0,
    );
    if (view.config.group) {
      const value = database.prepare(`
        SELECT value_json AS valueJson
        FROM data_source_property_values
        WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
      `).get(
        view.dataSourceId,
        membership.id,
        view.config.group.propertyId,
      ) as { readonly valueJson: string } | undefined;
      const effectiveGroupKey = databaseGroupKeyForValue(
        value
          ? parseDatabaseJson(value.valueJson, "Grouped Property value")
          : undefined,
      );
      if (operation.groupKey !== effectiveGroupKey) {
        rejectApply(
          "invalid_request",
          `Position group ${operation.groupKey ?? "null"} does not match grouped Property ${effectiveGroupKey ?? "null"}`,
          request,
        );
      }
    }
    return { entry, existing };
  });
  const requestPositionPageIds = explicitlyPositionedPageIds(
    request,
    view.viewId,
  );
  let ranks: ReturnType<typeof planDatabaseViewPositionRun>;
  try {
    ranks = planDatabaseViewPositionRun({
      logicalGroupOrder: readLogicalPositionItems(database, {
        view,
        groupKey: operation.groupKey,
        excludedPageIds: new Set(pageIds),
        positionConsistencyExemptPageIds: requestPositionPageIds,
      }),
      movedPageIds: pageIds,
      rankDirection: view.config.sort.find(
        (sort) => sort.field.kind === "manual",
      )?.direction ?? "asc",
      ...(operation.beforePageId === undefined
        ? {}
        : { beforePageId: operation.beforePageId }),
    });
  } catch (error) {
    if (!(error instanceof DatabaseViewPositionPlanError)) throw error;
    return rejectApply("invalid_request", error.message, request);
  }
  const putPosition = database.prepare(`
    INSERT INTO database_view_page_positions (
      view_id, page_block_id, group_key, rank_key, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(view_id, page_block_id) DO UPDATE SET
      group_key = excluded.group_key,
      rank_key = excluded.rank_key,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `);
  const updateRank = database.prepare(`
    UPDATE database_view_page_positions SET rank_key = ?, updated_at = ?
    WHERE view_id = ? AND page_block_id = ?
  `);
  for (const write of ranks.siblingWrites) {
    if (write.kind === "materialize") {
      if (requestPositionPageIds.has(write.pageId)) continue;
      putPosition.run(
        view.viewId,
        write.pageId,
        operation.groupKey,
        write.rankKey,
        1,
        now,
        now,
      );
    } else {
      const updated = updateRank.run(
        write.rankKey,
        now,
        view.viewId,
        write.pageId,
      );
      if (updated.changes !== 1) {
        throw new DatabaseModuleV2StateError(
          `View ${view.viewId} sibling position disappeared during rank maintenance`,
        );
      }
    }
    refreshSiblingPositionProjection(database, {
      pageId: write.pageId,
      viewId: view.viewId,
      groupKey: operation.groupKey,
      rankKey: write.rankKey,
      now,
    });
  }
  for (const { entry, existing } of validated) {
    const rankKey = ranks.movedRankKeys.get(entry.pageId);
    if (!rankKey) {
      throw new DatabaseModuleV2StateError(
        `Rank plan omitted Page ${entry.pageId}`,
      );
    }
    const revision = (existing?.revision ?? 0) + 1;
    putPosition.run(
      view.viewId,
      entry.pageId,
      operation.groupKey,
      rankKey,
      revision,
      now,
      now,
    );
    const metadataRevision = updatePageMetadataRevision(
      database,
      entry.pageId,
      now,
    );
    refreshMovedPositionProjection(database, {
      pageId: entry.pageId,
      viewId: view.viewId,
      groupKey: operation.groupKey,
      rankKey,
      metadataRevision,
      now,
    });
    accumulator.pageIds.add(entry.pageId);
    accumulator.revisions[
      `position:${view.viewId}:${entry.pageId}`
    ] = revision;
    accumulator.revisions[
      `page:${entry.pageId}:metadata`
    ] = metadataRevision;
  }
  accumulator.databaseIds.add(view.databaseId);
  accumulator.dataSourceIds.add(view.dataSourceId);
  accumulator.viewIds.add(view.viewId);
};

const applyPositionPage = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PositionDatabaseViewPageOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void =>
  applyPositionRun(
    database,
    request,
    {
      viewId: operation.viewId,
      pages: [{
        pageId: operation.pageId,
        expectedPositionRevision: operation.expectedPositionRevision,
      }],
      groupKey: operation.groupKey,
      ...(operation.beforePageId === undefined
        ? {}
        : { beforePageId: operation.beforePageId }),
    },
    now,
    accumulator,
    authorityOptions,
  );

const applyPositionPages = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: PositionDatabaseViewPagesOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void =>
  applyPositionRun(
    database,
    request,
    operation,
    now,
    accumulator,
    authorityOptions,
  );

const executeOperation = (
  database: Database.Database,
  request: DatabaseApplyV2,
  operation: DatabaseApplyOperationV2,
  now: string,
  accumulator: ApplyAccumulator,
  authorityOptions: DatabaseModuleApplyAuthorityOptions,
): void => {
  if (operation.kind === "put_property") {
    applyPutProperty(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "delete_property") {
    applyDeleteProperty(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "put_option") {
    applyPutOption(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "delete_option") {
    applyDeleteOption(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "set_value") {
    applySetValue(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "set_values") {
    for (const value of operation.values) {
      applySetValue(
        database,
        request,
        { kind: "set_value", ...value },
        now,
        accumulator,
        authorityOptions,
      );
    }
    return;
  }
  if (operation.kind === "add_remove_value") {
    applyAddRemoveValue(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "transfer_page") {
    applyTransferPage(
      database,
      request,
      operation,
      now,
      accumulator,
      false,
      authorityOptions,
    );
    return;
  }
  if (operation.kind === "put_view") {
    applyPutView(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "delete_view") {
    applyDeleteView(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  if (operation.kind === "position_page") {
    applyPositionPage(database, request, operation, now, accumulator, authorityOptions);
    return;
  }
  applyPositionPages(database, request, operation, now, accumulator, authorityOptions);
};

const readStoredReceipt = (
  database: Database.Database,
  operationId: string,
): StoredReceiptRow | null =>
  (database.prepare(`
    SELECT * FROM database_module_receipts WHERE operation_id = ?
  `).get(operationId) as StoredReceiptRow | undefined) ?? null;

const persistReceipt = (
  database: Database.Database,
  input: Readonly<{
    request: DatabaseApplyV2;
    project: ProjectRow;
    requestJson: string;
    requestHash: string;
    outcome: "committed" | "rejected";
    result: DatabaseApplyReceiptV2 | DatabaseModuleErrorV2;
    changeLogSeq: number | null;
    now: string;
  }>,
): void => {
  database.prepare(`
    INSERT INTO database_module_receipts (
      operation_id, project_id, library_id, store_epoch,
      request_hash, request_json, outcome, result_json,
      change_log_seq, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.request.operationId,
    input.project.id,
    input.project.library_id,
    input.request.storeEpoch,
    input.requestHash,
    input.requestJson,
    input.outcome,
    stableStringifyDatabaseJson(input.result),
    input.changeLogSeq,
    input.now,
  );
};

const loadStoredResult = (
  stored: StoredReceiptRow,
  request: DatabaseApplyV2,
  requestHash: string,
): DatabaseApplyResultV2 => {
  if (
    stored.request_hash !== requestHash ||
    stored.project_id !== request.projectId ||
    stored.store_epoch !== request.storeEpoch
  ) {
    return {
      ok: false,
      error: makeApplyError(
        "operation_id_collision",
        `Operation identity ${request.operationId} was already used for another Database intent`,
        request,
      ),
    };
  }
  const parsed = parseDatabaseApplyResultV2(
    stored.outcome === "committed"
      ? { ok: true, value: parseJson(stored.result_json, "Stored v2 receipt") }
      : { ok: false, error: parseJson(stored.result_json, "Stored v2 rejection") },
  );
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, duplicate: true } };
};

const persistChange = (
  database: Database.Database,
  request: DatabaseApplyV2,
  requestHash: string,
  accumulator: ApplyAccumulator,
  now: string,
): number => {
  const pageIds = uniqueSorted(accumulator.pageIds);
  const databaseIds = uniqueSorted(accumulator.databaseIds);
  const inserted = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    request.projectId,
    request.storeEpoch,
    request.operationId,
    stableStringifyDatabaseJson(uniqueSorted([...pageIds, ...databaseIds])),
    stableStringifyDatabaseJson(databaseIds),
    stableStringifyDatabaseJson({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      mutationKind: "database_module_apply_v2",
      operationKinds: request.operations.map((operation) => operation.kind),
      requestHash,
      affectedDataSourceIds: uniqueSorted(accumulator.dataSourceIds),
      affectedViewIds: uniqueSorted(accumulator.viewIds),
      committedRevisions: accumulator.revisions,
    }),
    now,
  );
  const sequence = Number(inserted.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new DatabaseModuleV2StateError(
    "SQLite returned an invalid Database Module v2 change sequence",
  );
};

export const applyDatabaseModuleV2 = (
  database: Database.Database,
  input: DatabaseApplyV2,
  options: Readonly<{
    now?: () => string;
    contentAuthority?: Extract<
      ContentResourceAuthority,
      { readonly kind: "local_user_library" }
    >;
  }> = {},
): DatabaseApplyResultV2 => {
  let request: DatabaseApplyV2;
  try {
    request = bindDatabaseApplyV2(input, input.projectId, {
      actor: input.actor,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        operationId: input.operationId,
      },
    };
  }
  const requestJson = stableStringifyDatabaseJson(request);
  const requestHash = sha256(requestJson);
  const now = options.now?.() ?? new Date().toISOString();
  const apply = database.transaction((): DatabaseApplyResultV2 => {
    requireCanonicalSchema(database);
    const storeEpoch = readStoreEpoch(database);
    if (storeEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeApplyError(
          "store_not_initialized",
          `Apply belongs to store epoch ${request.storeEpoch}; current epoch is ${storeEpoch ?? "missing"}`,
          request,
        ),
      };
    }
    const stored = readStoredReceipt(database, request.operationId);
    if (stored) return loadStoredResult(stored, request, requestHash);
    const project = readProject(database, request.projectId);
    if (!project) {
      return {
        ok: false,
        error: makeApplyError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }
    const accumulator: ApplyAccumulator = {
      databaseIds: new Set(),
      dataSourceIds: new Set(),
      pageIds: new Set(),
      viewIds: new Set(),
      revisions: {},
    };
    try {
      database.transaction(() => {
        for (const operation of request.operations) {
          executeOperation(database, request, operation, now, accumulator, {
            ...(options.contentAuthority
              ? { contentAuthority: options.contentAuthority }
              : {}),
          });
        }
      })();
    } catch (error) {
      if (!(error instanceof DatabaseModuleV2Rejection)) throw error;
      persistReceipt(database, {
        request,
        project,
        requestJson,
        requestHash,
        outcome: "rejected",
        result: error.error,
        changeLogSeq: null,
        now,
      });
      return { ok: false, error: error.error };
    }
    const changeLogSeq = persistChange(
      database,
      request,
      requestHash,
      accumulator,
      now,
    );
    const receipt: DatabaseApplyReceiptV2 = {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: request.operationId,
      projectId: project.id,
      libraryId: project.library_id,
      storeEpoch: request.storeEpoch,
      duplicate: false,
      operationKinds: request.operations.map((operation) => operation.kind),
      affectedDatabaseIds: uniqueSorted(accumulator.databaseIds),
      affectedDataSourceIds: uniqueSorted(accumulator.dataSourceIds),
      affectedPageIds: uniqueSorted(accumulator.pageIds),
      affectedViewIds: uniqueSorted(accumulator.viewIds),
      committedRevisions: accumulator.revisions,
      changeLogSeq,
      committedAt: now,
    };
    persistReceipt(database, {
      request,
      project,
      requestJson,
      requestHash,
      outcome: "committed",
      result: receipt,
      changeLogSeq,
      now,
    });
    return { ok: true, value: receipt };
  });
  try {
    return apply.immediate();
  } catch (error) {
    if (error instanceof DatabaseModuleV2Rejection) {
      return { ok: false, error: error.error };
    }
    return {
      ok: false,
      error: {
        code: "state_corrupt",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        operationId: request.operationId,
      },
    };
  }
};

export const applyLibraryDatabaseModuleV2 = (
  database: Database.Database,
  input: LibraryDatabaseApplyV2,
  actor: DatabaseApplyV2["actor"],
  accessActor: "app_window" | "http_loopback",
): LibraryDatabaseApplyResultV2 => {
  const local = requireLocalProfileLibraryInDatabase(database);
  const compatibilityProject = database.prepare(`
    SELECT id FROM projects
    WHERE library_id = ?
    ORDER BY created, id
    LIMIT 1
  `).get(local.libraryId) as { readonly id: string } | undefined;
  if (!compatibilityProject) {
    return {
      ok: false,
      error: {
        code: "project_not_found",
        message: "The local Library has no compatibility storage Project",
        retryable: false,
        operationId: input.operationId,
      },
    };
  }
  const authority = resolveContentResourceAuthorityInDatabase(database, {
    context: libraryContentAccess,
    actor: accessActor,
  });
  if (authority.kind !== "local_user_library") {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Local Library authority could not be resolved",
        retryable: false,
        operationId: input.operationId,
      },
    };
  }
  const result = applyDatabaseModuleV2(
    database,
    {
      ...input,
      projectId: compatibilityProject.id,
      actor,
    },
    { contentAuthority: authority },
  );
  if (!result.ok) return result;
  const { projectId: _compatibilityProjectId, ...receipt } = result.value;
  void _compatibilityProjectId;
  return {
    ok: true,
    value: {
      ...receipt,
      accessContext: { kind: "library" },
    },
  };
};

/** Canonical schema-v81 Database Module adapter. */
export const createSqliteDatabaseModuleV2 = (
  database: Database.Database,
): DatabaseModuleV2 => ({
  read: async (input) => readDatabaseModuleV2(database, input),
  apply: async (input) => applyDatabaseModuleV2(database, input),
});
