import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import {
  DATABASE_MODULE_CONTRACT_VERSION,
  type DatabaseApply,
  type DatabaseApplyOperation,
  type DatabaseApplyReceipt,
  type DatabaseApplyResult,
  type DatabaseContainerDescriptor,
  type DatabaseContainerRecord,
  type DatabaseModule,
  type DatabaseModuleError,
  type DatabaseModuleReadRequest,
  type DatabaseModuleReadResult,
  type DatabaseModuleReadSnapshot,
  type DatabaseRead,
  type DatabaseReadValue,
  type DatabaseViewQueryResult,
  type DatabaseViewRecord,
  type DataSourceQueryResult,
  type DataSourceDescriptor,
  type DataSourcePageRow,
  type DataSourcePageValue,
  type DataSourcePropertyRecord,
  type DataSourceRecord,
} from "../../shared/database-module";
import {
  evaluateDatabaseViewFilter,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfig,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type DatabaseViewConfig,
  type DatabaseViewFilterNode,
  type DatabaseViewKind,
  type DatabaseViewSort,
} from "../../shared/database-kernel";
import type { Page } from "../../shared/page";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { NodexAgentResourceAccessOverlay } from "../../shared/nodex-agent-resource-access";
import type {
  LibraryResource,
  ProjectResourceAction,
} from "../../shared/resource-authorization";
import { planDatabaseFractionalRank } from "./database-fractional-rank";
import {
  DatabaseViewPositionPlanError,
  planDatabaseViewPositionRun,
  type LogicalDatabaseViewPositionItem,
} from "./database-view-position-plan";
import {
  compareDatabaseViewOrderItems,
  type DatabaseViewOrderItem,
} from "./database-view-order";
import { getDb } from "./database";
import {
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
  putProjectResourceGrantInDatabase,
} from "./project-resource-grants";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";
import { readPagesInDatabase } from "./pages";

interface ProjectRow {
  readonly id: string;
  readonly library_id: string;
  readonly database_block_id: string;
  readonly lifecycle: "active" | "inactive" | "archived";
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
  readonly id: string;
  readonly data_source_id: string;
  readonly key: string;
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
  readonly is_primary: number;
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
  readonly databaseIds: Set<string>;
  readonly dataSourceIds: Set<string>;
  readonly pageIds: Set<string>;
  readonly viewIds: Set<string>;
  readonly revisions: Record<string, number>;
  readonly schedulePageIds: Set<string>;
}

class DatabaseModuleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseModuleStateError";
  }
}

class DatabaseModuleRejection extends Error {
  constructor(readonly error: DatabaseModuleError) {
    super(error.message);
    this.name = "DatabaseModuleRejection";
  }
}

const normalizeIdentity = (value: string, label: string): string => {
  const normalized = value.trim();
  if (normalized && normalized.length <= 512) return normalized;
  throw new TypeError(`${label} must be a non-empty bounded identity`);
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

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

const parseJsonValue = (value: string, label: string): DatabaseJsonValue => {
  try {
    return JSON.parse(value) as DatabaseJsonValue;
  } catch {
    throw new DatabaseModuleStateError(`${label} contains invalid JSON`);
  }
};

const rowToContainer = (row: ContainerRow): DatabaseContainerRecord => ({
  databaseId: row.block_id,
  libraryId: row.library_id,
  name: row.name,
  lifecycle: row.lifecycle,
  defaultViewId: row.default_view_id,
  accessRevision: row.access_revision,
  metadataRevision: row.metadata_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToSource = (row: SourceRow): DataSourceRecord => ({
  dataSourceId: row.id,
  libraryId: row.library_id,
  homeDatabaseId: row.home_database_block_id,
  name: row.name,
  schemaKey: row.schema_key,
  schemaRevision: row.schema_revision,
  lifecycle: row.lifecycle,
  rankKey: row.rank_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToProperty = (row: PropertyRow): DataSourcePropertyRecord => ({
  propertyId: row.id,
  dataSourceId: row.data_source_id,
  key: row.key,
  name: row.name,
  valueType: row.value_type,
  config: parseDatabasePropertyConfig(
    row.value_type,
    parseJsonValue(row.config_json, `Property ${row.id} config`),
  ),
  rankKey: row.rank_key,
  lifecycle: row.lifecycle,
  revision: row.schema_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToView = (row: ViewRow): DatabaseViewRecord => ({
  viewId: row.id,
  databaseId: row.database_block_id,
  dataSourceId: row.data_source_id,
  name: row.name,
  kind: row.kind,
  config: parseDatabaseViewConfig(
    parseJsonValue(row.config_json, `View ${row.id} config`),
  ),
  isDefault: row.is_primary === 1,
  revision: row.revision,
  rankKey: row.rank_key,
  lifecycle: row.lifecycle,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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

const readViewRow = (
  database: Database.Database,
  viewId: string,
): ViewRow | null =>
  (database.prepare(`
    SELECT id, database_block_id, data_source_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at
    FROM database_views WHERE id = ?
  `).get(viewId) as ViewRow | undefined) ?? null;

const readProperties = (
  database: Database.Database,
  dataSourceId: string,
): readonly DataSourcePropertyRecord[] =>
  (database.prepare(`
    SELECT * FROM data_source_properties
    WHERE data_source_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
  `).all(dataSourceId) as readonly PropertyRow[]).map(rowToProperty);

const readViews = (
  database: Database.Database,
  databaseId: string,
): readonly DatabaseViewRecord[] =>
  (database.prepare(`
    SELECT id, database_block_id, data_source_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at
    FROM database_views
    WHERE database_block_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
  `).all(databaseId) as readonly ViewRow[]).map(rowToView);

export const readDatabaseContainerDescriptorInDatabase = (
  database: Database.Database,
  databaseId: string,
): DatabaseContainerDescriptor | null => {
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

export const readDataSourceDescriptorInDatabase = (
  database: Database.Database,
  dataSourceId: string,
): DataSourceDescriptor | null => {
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

const readPageSummaries = (
  database: Database.Database,
  pageIds: readonly string[],
): ReadonlyMap<string, Page> => readPagesInDatabase(database, pageIds);

const readValues = (
  database: Database.Database,
  membershipIds: readonly string[],
): ReadonlyMap<string, Readonly<Record<string, DataSourcePageValue>>> => {
  if (membershipIds.length === 0) return new Map();
  const placeholders = membershipIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT value.membership_id, value.property_id, value.value_type,
      value.value_json, value.revision
    FROM data_source_property_values value
    INNER JOIN data_source_properties property
      ON property.id = value.property_id
      AND property.data_source_id = value.data_source_id
      AND property.lifecycle = 'active'
    WHERE value.membership_id IN (${placeholders})
    ORDER BY value.membership_id, value.property_id
  `).all(...membershipIds) as readonly ValueRow[];
  const result = new Map<string, Record<string, DataSourcePageValue>>();
  for (const row of rows) {
    const values = result.get(row.membership_id) ?? {};
    values[row.property_id] = {
      propertyId: row.property_id,
      valueType: row.value_type,
      value: parseJsonValue(
        row.value_json,
        `Property value ${row.membership_id}/${row.property_id}`,
      ),
      revision: row.revision,
    };
    result.set(row.membership_id, values);
  }
  return result;
};

const isEmptyValue = (value: DatabaseJsonValue | undefined): boolean =>
  value === undefined
  || value === null
  || value === ""
  || (Array.isArray(value) && value.length === 0);

const groupKeyForValue = (
  value: DatabaseJsonValue | undefined,
): string | null => {
  if (isEmptyValue(value)) return null;
  if (typeof value === "string") return value;
  return stableStringifyDatabaseJson(value);
};

const materializeDataSourceRows = (
  database: Database.Database,
  input: {
    readonly dataSourceId: string;
    readonly viewId: string | null;
    readonly groupPropertyId: string | null;
    readonly filter: DatabaseViewFilterNode;
    readonly sort: readonly DatabaseViewSort[];
    readonly excludedPositionConsistencyPageIds?: ReadonlySet<string>;
  },
): {
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly rows: readonly DataSourcePageRow[];
} => {
  const properties = readProperties(database, input.dataSourceId)
    .filter((property) => property.lifecycle === "active");
  const memberships = readMembershipRows(
    database,
    input.dataSourceId,
    input.viewId,
  );
  const pages = readPageSummaries(
    database,
    memberships.map((membership) => membership.page_block_id),
  );
  const values = readValues(
    database,
    memberships.map((membership) => membership.id),
  );
  const rows = memberships.map((membership): DataSourcePageRow => {
    const page = pages.get(membership.page_block_id);
    if (!page) {
      throw new DatabaseModuleStateError(
        `Membership ${membership.id} has no readable Page`,
      );
    }
    const rowValues = values.get(membership.id) ?? {};
    const effectiveGroupKey = input.groupPropertyId === null
      ? membership.group_key
      : groupKeyForValue(rowValues[input.groupPropertyId]?.value);
    if (
      input.groupPropertyId !== null
      && membership.rank_key !== null
      && membership.group_key !== effectiveGroupKey
      && !input.excludedPositionConsistencyPageIds?.has(page.pageId)
    ) {
      throw new DatabaseModuleStateError(
        `View ${input.viewId} position for Page ${page.pageId} diverges from its grouping property`,
      );
    }
    return {
      page,
      membership: {
        membershipId: membership.id,
        dataSourceId: membership.data_source_id,
        revision: membership.revision,
        createdAt: membership.created_at,
      },
      values: rowValues,
      position: membership.rank_key === null
          || membership.position_revision === null
        ? null
        : {
            groupKey: membership.group_key,
            rankKey: membership.rank_key,
            revision: membership.position_revision,
          },
      effectiveGroupKey,
    };
  });
  const visibleRows = rows.filter((row) => evaluateDatabaseViewFilter(
    input.filter,
    (propertyId) => row.values[propertyId]?.value,
  ));
  const orderItems = new Map(visibleRows.map((row) => [
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
  ] as const));
  visibleRows.sort((left, right) => {
    const leftOrder = orderItems.get(left.page.pageId);
    const rightOrder = orderItems.get(right.page.pageId);
    if (!leftOrder || !rightOrder) {
      throw new DatabaseModuleStateError("View order item disappeared during query");
    }
    return compareDatabaseViewOrderItems(leftOrder, rightOrder, input.sort);
  });
  return { properties, rows: visibleRows };
};

const queryView = (
  database: Database.Database,
  viewId: string,
): DatabaseViewQueryResult | null => {
  const viewRow = readViewRow(database, viewId);
  if (!viewRow || viewRow.lifecycle !== "active") return null;
  const view = rowToView(viewRow);
  const container = readContainerRow(database, view.databaseId);
  const source = readSourceRow(database, view.dataSourceId);
  if (!container || !source) {
    throw new DatabaseModuleStateError(
      `View ${viewId} has missing Container or Data Source authority`,
    );
  }
  if (source.home_database_block_id !== container.block_id) {
    throw new DatabaseModuleStateError(
      `View ${viewId} targets a Data Source outside its home Database`,
    );
  }
  const materialized = materializeDataSourceRows(database, {
    dataSourceId: source.id,
    viewId: view.viewId,
    groupPropertyId: view.config.group?.propertyId ?? null,
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

/**
 * Internal composition seam for callers that already execute inside the
 * Database Module's trusted transaction and authorization boundary.
 */
export const queryDatabaseViewInDatabase = queryView;

const queryDataSource = (
  database: Database.Database,
  dataSourceId: string,
  filter: DatabaseViewFilterNode,
  sort: readonly DatabaseViewSort[],
): DataSourceQueryResult | null => {
  const source = readSourceRow(database, dataSourceId);
  if (!source || source.lifecycle !== "active") return null;
  const container = readContainerRow(database, source.home_database_block_id);
  if (!container || container.lifecycle !== "active") return null;
  const materialized = materializeDataSourceRows(database, {
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
  project: ProjectRow,
  request: DatabaseModuleReadRequest,
  database: Database.Database,
): LibraryResource | null => {
  const target = request.read.target;
  if (target.kind === "project_default") {
    if (request.read.mode !== "query") {
      return { kind: "database", databaseId: project.database_block_id };
    }
    const defaultView = readContainerRow(
      database,
      project.database_block_id,
    )?.default_view_id;
    return defaultView ? { kind: "view", viewId: defaultView } : null;
  }
  if (target.kind === "database") {
    return { kind: "database", databaseId: target.databaseId };
  }
  if (target.kind === "data_source") {
    return { kind: "data_source", dataSourceId: target.dataSourceId };
  }
  return { kind: "view", viewId: target.viewId };
};

const readValue = (
  database: Database.Database,
  project: ProjectRow,
  request: DatabaseModuleReadRequest,
  authority?: FrozenNodexAgentTurnAuthority,
  resourceAccess?: NodexAgentResourceAccessOverlay,
  callId?: string,
): DatabaseReadValue | null => {
  const target = request.read.target;
  if (target.kind === "project_default") {
    const descriptor = readDatabaseContainerDescriptorInDatabase(
      database,
      project.database_block_id,
    );
    if (!descriptor) return null;
    if (request.read.mode === "catalog") {
      const ids = authority?.scope === "library"
        ? (database.prepare(`
            SELECT block_id AS databaseId
            FROM database_containers
            WHERE library_id = ? AND lifecycle <> 'deleted'
            ORDER BY block_id
          `).all(authority.libraryId) as readonly {
            readonly databaseId: string;
          }[]).map((row) => row.databaseId)
        : (() => {
            const grantedDatabaseIds = database.prepare(`
              SELECT root_id AS databaseId
              FROM project_resource_grants
              WHERE project_id = ? AND root_kind = 'database'
                AND lifecycle = 'active'
              ORDER BY created_at, id
            `).all(project.id) as readonly { readonly databaseId: string }[];
            const temporaryDatabaseIds = authority && resourceAccess
              ? resourceAccess.grants.flatMap((grant) => {
                  if (grant.root.kind !== "database") return [];
                  const authorization = authorizeNodexAgentResourceInDatabase(
                    database,
                    {
                      authority,
                      resource: {
                        kind: "database",
                        databaseId: grant.root.databaseId,
                      },
                      action: "read",
                      resourceAccess,
                      ...(callId ? { callId } : {}),
                      phase: "execute",
                    },
                  );
                  return authorization.allowed ? [grant.root.databaseId] : [];
                })
              : [];
            return uniqueSorted([
              project.database_block_id,
              ...grantedDatabaseIds.map((row) => row.databaseId),
              ...temporaryDatabaseIds,
            ]);
          })();
      return {
        kind: "catalog",
        databases: ids.flatMap((databaseId) => {
          const value = readDatabaseContainerDescriptorInDatabase(
            database,
            databaseId,
          );
          return value ? [value] : [];
        }),
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
    const value = readDatabaseContainerDescriptorInDatabase(
      database,
      target.databaseId,
    );
    return value ? { kind: "database", value } : null;
  }
  if (request.read.target.kind === "data_source") {
    if (request.read.mode === "query") {
      const queryRead = request.read as Extract<
        DatabaseRead,
        { readonly target: { readonly kind: "data_source" }; readonly mode: "query" }
      >;
      if (queryRead.sort?.some((sort) => sort.field.kind === "manual")) {
        throw new TypeError("Data Source queries cannot use manual View order");
      }
      const value = queryDataSource(
        database,
        queryRead.target.dataSourceId,
        queryRead.filter ?? {
          kind: "group",
          operator: "and",
          children: [],
        },
        queryRead.sort ?? [],
      );
      return value ? { kind: "data_source_query", value } : null;
    }
    const value = readDataSourceDescriptorInDatabase(
      database,
      request.read.target.dataSourceId,
    );
    return value ? { kind: "data_source", value } : null;
  }
  if (request.read.target.kind !== "view") return null;
  const view = readViewRow(database, request.read.target.viewId);
  if (!view) return null;
  if (request.read.mode === "view") {
    return { kind: "view", value: rowToView(view) };
  }
  const value = queryView(database, request.read.target.viewId);
  return value ? { kind: "query", value } : null;
};

export const readDatabaseModule = (
  database: Database.Database,
  request: DatabaseModuleReadRequest,
  options: {
    readonly afterCursorRead?: () => void;
    readonly authority?: FrozenNodexAgentTurnAuthority;
    readonly resourceAccess?: NodexAgentResourceAccessOverlay;
    readonly callId?: string;
  } = {},
): DatabaseModuleReadResult => {
  try {
    if (request.version !== DATABASE_MODULE_CONTRACT_VERSION) {
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Unsupported Database Module contract version",
          retryable: false,
        },
      };
    }
    const projectId = normalizeIdentity(request.projectId, "projectId");
    return database.transaction((): DatabaseModuleReadResult => {
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
      const project = readProject(database, projectId);
      if (!project) {
        return {
          ok: false,
          error: {
            code: "project_not_found",
            message: `Project does not exist: ${projectId}`,
            retryable: false,
          },
        };
      }
      const resource = authorizationResourceForRead(project, request, database);
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
      const authorization = options.authority
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
            projectId,
            resource,
            action: "read",
          });
      if (!authorization.allowed) {
        return {
          ok: false,
          error: {
            code: "authorization_denied",
            message: `Database read denied: ${authorization.reason}`,
            retryable: false,
          },
        };
      }
      const change = database.prepare(`
        SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log
      `).get() as { readonly seq: number };
      options.afterCursorRead?.();
      const value = readValue(
        database,
        project,
        request,
        options.authority,
        options.resourceAccess,
        options.callId,
      );
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
      const snapshot: DatabaseModuleReadSnapshot = {
        version: DATABASE_MODULE_CONTRACT_VERSION,
        projectId,
        libraryId: project.library_id,
        storeEpoch,
        changeLogSeq: change.seq,
        value,
      };
      return { ok: true, value: snapshot };
    })();
  } catch (error) {
    if (error instanceof DatabaseModuleStateError) {
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
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
};

// Apply helpers are kept below the read model so the Module exposes one deep
// Interface while retaining a testable, pure mapping layer for each operation.

const makeApplyError = (
  code: DatabaseModuleError["code"],
  message: string,
  request: Pick<DatabaseApply, "operationId">,
  revisions: Readonly<{
    expectedRevision?: number;
    actualRevision?: number;
  }> = {},
): DatabaseModuleError => ({
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
  code: DatabaseModuleError["code"],
  message: string,
  request: DatabaseApply,
  revisions?: Readonly<{
    expectedRevision?: number;
    actualRevision?: number;
  }>,
): never => {
  throw new DatabaseModuleRejection(
    makeApplyError(code, message, request, revisions),
  );
};

const requireApplyResource = <Value>(
  value: Value | null | undefined,
  message: string,
  request: DatabaseApply,
): Value => {
  if (value !== null && value !== undefined) return value;
  return rejectApply("resource_not_found", message, request);
};

const requireAuthorization = (
  database: Database.Database,
  request: DatabaseApply,
  resource: LibraryResource,
  action: ProjectResourceAction,
): void => {
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: request.projectId,
    resource,
    action,
  });
  if (authorization.allowed) return;
  rejectApply(
    "authorization_denied",
    `${action} denied for ${resource.kind}: ${authorization.reason}`,
    request,
  );
};

const requireRevision = (
  request: DatabaseApply,
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

const readSourceProjectId = (
  database: Database.Database,
  source: SourceRow,
): string => {
  const owner = database.prepare(`
    SELECT project_id AS projectId FROM blocks WHERE id = ?
  `).get(source.home_database_block_id) as
    | { readonly projectId: string }
    | undefined;
  if (owner) return owner.projectId;
  throw new DatabaseModuleStateError(
    `Data Source ${source.id} has no legacy projection owner`,
  );
};

const readPageProjectId = (
  database: Database.Database,
  pageId: string,
): string => {
  const row = database.prepare(`
    SELECT project_id AS projectId FROM blocks WHERE id = ?
  `).get(pageId) as { readonly projectId: string } | undefined;
  if (row) return row.projectId;
  throw new DatabaseModuleStateError(`Page ${pageId} has no Block identity`);
};

const updatePageMetadataProjection = (
  database: Database.Database,
  pageId: string,
  now: string,
): number => {
  const updated = database.prepare(`
    UPDATE blocks
    SET metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE id = ? AND type IN ('page', 'page')
    RETURNING metadata_revision AS revision
  `).get(now, pageId) as { readonly revision: number } | undefined;
  if (updated) return updated.revision;
  throw new DatabaseModuleStateError(`Page ${pageId} disappeared`);
};

const isInitialSource = (source: SourceRow): boolean =>
  source.id === `${source.home_database_block_id}:data-source:initial`;

const readRankedItems = (
  database: Database.Database,
  table: "data_source_properties" | "database_views",
  ownerColumn: "data_source_id" | "database_block_id",
  ownerId: string,
): readonly { readonly id: string; readonly rankKey: string }[] =>
  (database.prepare(`
    SELECT id, rank_key AS rankKey FROM ${table}
    WHERE ${ownerColumn} = ? AND lifecycle = 'active'
    ORDER BY rank_key, id
  `).all(ownerId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[]);

const applyRebalancedRanks = (
  database: Database.Database,
  table: "data_source_properties" | "database_views",
  ranks: ReadonlyMap<string, string>,
): void => {
  if (ranks.size === 0) return;
  const update = database.prepare(`
    UPDATE ${table} SET rank_key = ? WHERE id = ?
  `);
  for (const [id, rankKey] of ranks) update.run(rankKey, id);
};

const mirrorProperty = (
  database: Database.Database,
  source: SourceRow,
  property: Readonly<{
    id: string;
    key: string;
    name: string;
    valueType: DatabasePropertyValueType;
    configJson: string;
    rankKey: string;
    lifecycle: "active" | "deleted";
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>,
): void => {
  if (!isInitialSource(source)) return;
  const projectId = readSourceProjectId(database, source);
  database.prepare(`
    INSERT INTO database_properties (
      id, database_block_id, project_id, key, name, value_type,
      config_json, rank_key, lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      key = excluded.key,
      name = excluded.name,
      value_type = excluded.value_type,
      config_json = excluded.config_json,
      rank_key = excluded.rank_key,
      lifecycle = excluded.lifecycle,
      schema_revision = excluded.schema_revision,
      updated_at = excluded.updated_at
  `).run(
    property.id,
    source.home_database_block_id,
    projectId,
    property.key,
    property.name,
    property.valueType,
    property.configJson,
    property.rankKey,
    property.lifecycle,
    property.revision,
    property.createdAt,
    property.updatedAt,
  );
};

const synchronizeLegacySourceRevision = (
  database: Database.Database,
  source: SourceRow,
  revision: number,
  now: string,
): void => {
  if (!isInitialSource(source)) return;
  database.prepare(`
    UPDATE database_capabilities
    SET schema_revision = ?, updated_at = ?
    WHERE block_id = ?
  `).run(revision, now, source.home_database_block_id);
};

const applyPutProperty = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "put_property" }>,
  now: string,
  accumulator: ApplyAccumulator,
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
    { kind: "data_source", dataSourceId: source.id },
    "manage_schema",
  );
  requireRevision(
    request,
    `Data Source ${source.id}`,
    operation.expectedDataSourceRevision,
    source.schema_revision,
  );
  const existing = database.prepare(`
    SELECT * FROM data_source_properties WHERE id = ? AND data_source_id = ?
  `).get(operation.propertyId, source.id) as PropertyRow | undefined;
  requireRevision(
    request,
    `Property ${operation.propertyId}`,
    operation.expectedPropertyRevision,
    existing?.schema_revision ?? 0,
  );
  const config = parseDatabasePropertyConfig(
    operation.valueType,
    operation.config,
  );
  const ranks = planDatabaseFractionalRank({
    items: readRankedItems(
      database,
      "data_source_properties",
      "data_source_id",
      source.id,
    ),
    targetId: operation.propertyId,
    ...(operation.beforePropertyId === undefined
      ? {}
      : { beforeId: operation.beforePropertyId }),
  });
  applyRebalancedRanks(
    database,
    "data_source_properties",
    ranks.rebalancedRankKeys,
  );
  if (isInitialSource(source)) {
    const mirrorRank = database.prepare(`
      UPDATE database_properties SET rank_key = ? WHERE id = ?
    `);
    for (const [id, rankKey] of ranks.rebalancedRankKeys) {
      mirrorRank.run(rankKey, id);
    }
  }
  const propertyRevision = (existing?.schema_revision ?? 0) + 1;
  const sourceRevision = source.schema_revision + 1;
  const createdAt = existing?.created_at ?? now;
  const configJson = stableStringifyDatabaseJson(config);
  database.prepare(`
    INSERT INTO data_source_properties (
      id, data_source_id, key, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data_source_id = excluded.data_source_id,
      key = excluded.key,
      name = excluded.name,
      value_type = excluded.value_type,
      config_json = excluded.config_json,
      rank_key = excluded.rank_key,
      lifecycle = 'active',
      schema_revision = excluded.schema_revision,
      updated_at = excluded.updated_at
  `).run(
    operation.propertyId,
    source.id,
    operation.key.trim(),
    operation.name.trim(),
    operation.valueType,
    configJson,
    ranks.rankKey,
    propertyRevision,
    createdAt,
    now,
  );
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, source.id);
  mirrorProperty(database, source, {
    id: operation.propertyId,
    key: operation.key.trim(),
    name: operation.name.trim(),
    valueType: operation.valueType,
    configJson,
    rankKey: ranks.rankKey,
    lifecycle: "active",
    revision: propertyRevision,
    createdAt,
    updatedAt: now,
  });
  synchronizeLegacySourceRevision(database, source, sourceRevision, now);
  accumulator.databaseIds.add(source.home_database_block_id);
  accumulator.dataSourceIds.add(source.id);
  accumulator.revisions[`source:${source.id}`] = sourceRevision;
  accumulator.revisions[`property:${operation.propertyId}`] = propertyRevision;
};

const applyDeleteProperty = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "delete_property" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  const property = requireApplyResource(database.prepare(`
    SELECT * FROM data_source_properties WHERE id = ? AND data_source_id = ?
  `).get(operation.propertyId, operation.dataSourceId) as PropertyRow | undefined,
  `Property does not exist: ${operation.propertyId}`,
  request);
  if (property.lifecycle !== "active") {
    rejectApply(
      "resource_not_found",
      `Active property does not exist: ${operation.propertyId}`,
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "data_source", dataSourceId: source.id },
    "manage_schema",
  );
  requireRevision(
    request,
    `Data Source ${source.id}`,
    operation.expectedDataSourceRevision,
    source.schema_revision,
  );
  requireRevision(
    request,
    `Property ${property.id}`,
    operation.expectedPropertyRevision,
    property.schema_revision,
  );
  const propertyRevision = property.schema_revision + 1;
  const sourceRevision = source.schema_revision + 1;
  database.prepare(`
    UPDATE data_source_properties
    SET lifecycle = 'deleted', schema_revision = ?, updated_at = ?
    WHERE id = ?
  `).run(propertyRevision, now, property.id);
  database.prepare(`
    UPDATE data_sources SET schema_revision = ?, updated_at = ? WHERE id = ?
  `).run(sourceRevision, now, source.id);
  mirrorProperty(database, source, {
    id: property.id,
    key: property.key,
    name: property.name,
    valueType: property.value_type,
    configJson: property.config_json,
    rankKey: property.rank_key,
    lifecycle: "deleted",
    revision: propertyRevision,
    createdAt: property.created_at,
    updatedAt: now,
  });
  synchronizeLegacySourceRevision(database, source, sourceRevision, now);
  accumulator.databaseIds.add(source.home_database_block_id);
  accumulator.dataSourceIds.add(source.id);
  accumulator.revisions[`source:${source.id}`] = sourceRevision;
  accumulator.revisions[`property:${property.id}`] = propertyRevision;
};

const readActiveMembership = (
  database: Database.Database,
  pageId: string,
  dataSourceId?: string,
): (MembershipRow & { readonly removed_at: string | null }) | null => {
  const row = database.prepare(`
    SELECT id, data_source_id, page_block_id, revision, created_at,
      NULL AS group_key, NULL AS rank_key, NULL AS position_revision,
      removed_at
    FROM data_source_page_memberships
    WHERE page_block_id = ? AND removed_at IS NULL
      ${dataSourceId === undefined ? "" : "AND data_source_id = ?"}
  `).get(...(dataSourceId === undefined
    ? [pageId]
    : [pageId, dataSourceId])) as
      | (MembershipRow & { readonly removed_at: string | null })
      | undefined;
  return row ?? null;
};

const applySetValue = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "set_value" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  requireAuthorization(
    database,
    request,
    { kind: "page", pageId: operation.pageId },
    "write",
  );
  const source = requireApplyResource(
    readSourceRow(database, operation.dataSourceId),
    `Data Source does not exist: ${operation.dataSourceId}`,
    request,
  );
  const property = requireApplyResource(database.prepare(`
    SELECT * FROM data_source_properties
    WHERE id = ? AND data_source_id = ? AND lifecycle = 'active'
  `).get(operation.propertyId, operation.dataSourceId) as PropertyRow | undefined,
  `Active property does not exist: ${operation.propertyId}`,
  request);
  const membership = requireApplyResource(
    readActiveMembership(
      database,
      operation.pageId,
      operation.dataSourceId,
    ),
    `Page ${operation.pageId} has no active Data Source membership`,
    request,
  );
  const page = requireApplyResource(database.prepare(`
    SELECT parent_kind, parent_id FROM pages WHERE block_id = ?
  `).get(operation.pageId) as
    | { readonly parent_kind: string; readonly parent_id: string }
    | undefined,
  `Page does not exist: ${operation.pageId}`,
  request);
  if (page.parent_kind !== "data_source" || page.parent_id !== source.id) {
    rejectApply(
      "resource_not_found",
      `Page ${operation.pageId} is not an active row in Data Source ${operation.dataSourceId}`,
      request,
    );
  }
  const existing = database.prepare(`
    SELECT revision FROM data_source_property_values
    WHERE membership_id = ? AND property_id = ?
  `).get(membership.id, property.id) as
    | { readonly revision: number }
    | undefined;
  requireRevision(
    request,
    `Value ${membership.id}/${property.id}`,
    operation.expectedValueRevision,
    existing?.revision ?? 0,
  );
  const value = normalizeDatabasePropertyValue(
    {
      valueType: property.value_type,
      config: parseDatabasePropertyConfig(
        property.value_type,
        parseJsonValue(property.config_json, `Property ${property.id} config`),
      ),
    },
    operation.value,
  );
  const revision = (existing?.revision ?? 0) + 1;
  const valueJson = stableStringifyDatabaseJson(value);
  database.prepare(`
    INSERT INTO data_source_property_values (
      membership_id, property_id, data_source_id, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(membership_id, property_id) DO UPDATE SET
      data_source_id = excluded.data_source_id,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `).run(
    membership.id,
    property.id,
    source.id,
    property.value_type,
    valueJson,
    revision,
    now,
  );
  if (isInitialSource(source)) {
    const projectId = readPageProjectId(database, operation.pageId);
    database.prepare(`
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(membership_id, property_id) DO UPDATE SET
        value_type = excluded.value_type,
        value_json = excluded.value_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      membership.id,
      property.id,
      source.home_database_block_id,
      projectId,
      property.value_type,
      valueJson,
      revision,
      now,
    );
  }
  const groupedKey = groupKeyForValue(value);
  const groupedViews = (database.prepare(`
    SELECT id, database_block_id, data_source_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at
    FROM database_views
    WHERE data_source_id = ? AND lifecycle = 'active'
  `).all(source.id) as readonly ViewRow[])
    .map(rowToView)
    .filter((view) => view.config.group?.propertyId === property.id);
  for (const view of groupedViews) {
    const hasExplicitPosition = request.operations.some(
      (candidate) =>
        (candidate.kind === "position_page"
          && candidate.viewId === view.viewId
          && candidate.pageId === operation.pageId)
        || (candidate.kind === "position_pages"
          && candidate.viewId === view.viewId
          && candidate.pages.some(
            (entry) => entry.pageId === operation.pageId,
          )),
    );
    if (hasExplicitPosition) continue;
    const updated = database.prepare(`
      UPDATE database_view_page_positions
      SET group_key = ?, revision = revision + 1, updated_at = ?
      WHERE view_id = ? AND page_block_id = ?
      RETURNING revision
    `).get(groupedKey, now, view.viewId, operation.pageId) as
      | { readonly revision: number }
      | undefined;
    if (!updated) continue;
    database.prepare(`
      UPDATE database_view_positions
      SET group_key = ?, revision = ?, updated_at = ?
      WHERE view_id = ? AND block_id = ?
    `).run(
      groupedKey,
      updated.revision,
      now,
      view.viewId,
      operation.pageId,
    );
    accumulator.revisions[
      `position:${view.viewId}:${operation.pageId}`
    ] = updated.revision;
  }
  const metadataRevision = updatePageMetadataProjection(
    database,
    operation.pageId,
    now,
  );
  accumulator.databaseIds.add(source.home_database_block_id);
  accumulator.dataSourceIds.add(source.id);
  accumulator.pageIds.add(operation.pageId);
  accumulator.schedulePageIds.add(operation.pageId);
  accumulator.revisions[`value:${membership.id}:${property.id}`] = revision;
  accumulator.revisions[`page:${operation.pageId}:metadata`] = metadataRevision;
};

const applyAddRemoveValue = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<
    DatabaseApplyOperation,
    { readonly kind: "add_remove_value" }
  >,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  const property = requireApplyResource(database.prepare(`
    SELECT * FROM data_source_properties
    WHERE id = ? AND data_source_id = ? AND lifecycle = 'active'
  `).get(operation.propertyId, operation.dataSourceId) as PropertyRow | undefined,
  `Active property does not exist: ${operation.propertyId}`,
  request);
  if (property.value_type !== "multi_select") {
    rejectApply(
      "invalid_request",
      `Property ${property.id} does not support set-like updates`,
      request,
    );
  }
  const membership = requireApplyResource(
    readActiveMembership(database, operation.pageId, operation.dataSourceId),
    `Page ${operation.pageId} has no active Data Source membership`,
    request,
  );
  const existing = database.prepare(`
    SELECT value_json AS valueJson, revision
    FROM data_source_property_values
    WHERE membership_id = ? AND property_id = ?
  `).get(membership.id, property.id) as
    | { readonly valueJson: string; readonly revision: number }
    | undefined;
  const parsed = existing
    ? parseJsonValue(existing.valueJson, `Value ${membership.id}/${property.id}`)
    : [];
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    rejectApply(
      "state_corrupt",
      `Multi-select value ${membership.id}/${property.id} is not a string array`,
      request,
    );
    return;
  }
  const next = new Set(parsed);
  for (const value of operation.remove) next.delete(value);
  for (const value of operation.add) next.add(value);
  const currentValue = [...parsed].sort(compareStrings);
  const nextValue = [...next].sort(compareStrings);
  if (
    nextValue.length === currentValue.length
    && nextValue.every((value, index) => value === currentValue[index])
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
  );
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
  for (const [id, rankKey] of ranks.rebalancedRankKeys) {
    update.run(rankKey, now, id);
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
  dataSourceId: string,
  pageId: string,
): string => `membership:${createHash("sha256")
  .update(dataSourceId)
  .update("\0")
  .update(pageId)
  .digest("hex")}`;

const requireAcyclicPageParent = (
  database: Database.Database,
  pageId: string,
  targetPageId: string,
  request: DatabaseApply,
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

const applyTransferPage = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "transfer_page" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  requireAuthorization(
    database,
    request,
    { kind: "page", pageId: operation.pageId },
    "move",
  );
  const page = requireApplyResource(database.prepare(`
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
  request);
  requireRevision(
    request,
    `Page ${page.block_id} parent`,
    operation.expectedParentRevision,
    page.parent_revision,
  );
  const activeMembership = readActiveMembership(database, page.block_id);
  requireRevision(
    request,
    `Page ${page.block_id} active membership`,
    operation.expectedActiveMembershipRevision,
    activeMembership?.revision ?? 0,
  );

  let affectedDatabaseId: string | null = null;
  let affectedSourceId: string | null = null;
  if (activeMembership) {
    const previousSource = readSourceRow(
      database,
      activeMembership.data_source_id,
    );
    affectedDatabaseId = previousSource?.home_database_block_id ?? null;
    affectedSourceId = previousSource?.id ?? null;
    database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE id = ? AND removed_at IS NULL
    `).run(now, activeMembership.id);
    database.prepare(`
      UPDATE database_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE id = ? AND removed_at IS NULL
    `).run(now, activeMembership.id);
  }
  database.prepare(`
    DELETE FROM database_view_page_positions WHERE page_block_id = ?
  `).run(page.block_id);
  database.prepare(`
    DELETE FROM database_view_positions WHERE block_id = ?
  `).run(page.block_id);

  if (operation.target.kind === "library") {
    if (operation.target.libraryId !== page.library_id) {
      rejectApply(
        "authorization_denied",
        "A Page cannot move to another Library",
        request,
      );
    }
    const projectId = readPageProjectId(database, page.block_id);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'space', containing_document_id = NULL,
        containing_database_id = NULL,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1,
        updated_at = ?
      WHERE id = ?
    `).run(now, page.block_id);
    appendTopLevelPlacement(database, projectId, page.block_id, now);
    const retainedAccess = authorizeProjectResourceInDatabase(database, {
      projectId: request.projectId,
      resource: { kind: "page", pageId: page.block_id },
      action: "write",
    });
    if (!retainedAccess.allowed) {
      putProjectResourceGrantInDatabase(database, {
        projectId: request.projectId,
        root: { kind: "page", pageId: page.block_id },
        access: "read_write",
      }, now);
    }
  } else if (operation.target.kind === "page") {
    const targetPage = requireApplyResource(database.prepare(`
      SELECT block_id, library_id, document_id
      FROM pages
      WHERE block_id = ? AND lifecycle <> 'deleted'
    `).get(operation.target.pageId) as
      | {
          readonly block_id: string;
          readonly library_id: string;
          readonly document_id: string;
        }
      | undefined,
    `Target Page does not exist: ${operation.target.pageId}`,
    request);
    if (targetPage.library_id !== page.library_id) {
      rejectApply(
        "resource_not_found",
        `Target Page does not exist: ${operation.target.pageId}`,
        request,
      );
    }
    requireAuthorization(
      database,
      request,
      { kind: "page", pageId: targetPage.block_id },
      "create_child",
    );
    requireAcyclicPageParent(
      database,
      page.block_id,
      targetPage.block_id,
      request,
    );
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(page.block_id);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'document', containing_document_id = ?,
        containing_database_id = NULL,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1,
        updated_at = ?
      WHERE id = ?
    `).run(targetPage.document_id, now, page.block_id);
  } else {
    const source = requireApplyResource(
      readSourceRow(database, operation.target.dataSourceId),
      `Target Data Source does not exist: ${operation.target.dataSourceId}`,
      request,
    );
    if (source.library_id !== page.library_id) {
      rejectApply(
        "resource_not_found",
        `Target Data Source does not exist: ${operation.target.dataSourceId}`,
        request,
      );
    }
    if (source.lifecycle !== "active") {
      rejectApply(
        "resource_not_found",
        `Target Data Source does not exist: ${operation.target.dataSourceId}`,
        request,
      );
    }
    requireAuthorization(
      database,
      request,
      { kind: "data_source", dataSourceId: source.id },
      "create_child",
    );
    if (activeMembership?.data_source_id === source.id) {
      rejectApply(
        "unsupported_operation",
        `Page ${page.block_id} already belongs to Data Source ${source.id}`,
        request,
      );
    }
    const targetHistory = database.prepare(`
      SELECT id, revision, removed_at, created_at
      FROM data_source_page_memberships
      WHERE data_source_id = ? AND page_block_id = ?
    `).get(source.id, page.block_id) as
      | {
          readonly id: string;
          readonly revision: number;
          readonly removed_at: string | null;
          readonly created_at: string;
        }
      | undefined;
    const membershipId = targetHistory?.id
      ?? deterministicMembershipId(source.id, page.block_id);
    const targetRevision = (targetHistory?.revision ?? 0) + 1;
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
      membershipId,
      source.id,
      page.block_id,
      targetRevision,
      targetHistory?.created_at ?? now,
    );
    const targetProjectId = readSourceProjectId(database, source);
    const currentProjectId = readPageProjectId(database, page.block_id);
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(page.block_id);
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'database', containing_document_id = NULL,
        containing_database_id = ?,
        location_revision = location_revision + 1,
        metadata_revision = metadata_revision + 1,
        updated_at = ?
      WHERE id = ?
    `).run(source.home_database_block_id, now, page.block_id);
    database.prepare(`
      UPDATE pages
      SET parent_kind = 'data_source', parent_id = ?,
        parent_revision = (
          SELECT location_revision FROM blocks WHERE id = pages.block_id
        ),
        metadata_revision = (
          SELECT metadata_revision FROM blocks WHERE id = pages.block_id
        ),
        updated_at = ?
      WHERE block_id = ?
    `).run(source.id, now, page.block_id);
    if (isInitialSource(source) && targetProjectId === currentProjectId) {
      database.prepare(`
        INSERT INTO database_memberships (
          id, database_block_id, page_block_id, project_id,
          revision, created_at, removed_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          database_block_id = excluded.database_block_id,
          page_block_id = excluded.page_block_id,
          project_id = excluded.project_id,
          revision = excluded.revision,
          removed_at = NULL
      `).run(
        membershipId,
        source.home_database_block_id,
        page.block_id,
        targetProjectId,
        targetRevision,
        targetHistory?.created_at ?? now,
      );
    }
    affectedDatabaseId = source.home_database_block_id;
    affectedSourceId = source.id;
    accumulator.revisions[`membership:${membershipId}`] = targetRevision;
  }

  const updatedPage = database.prepare(`
    SELECT parent_revision AS parentRevision,
      metadata_revision AS metadataRevision
    FROM pages WHERE block_id = ?
  `).get(page.block_id) as {
    readonly parentRevision: number;
    readonly metadataRevision: number;
  };
  if (affectedDatabaseId) accumulator.databaseIds.add(affectedDatabaseId);
  if (affectedSourceId) accumulator.dataSourceIds.add(affectedSourceId);
  accumulator.pageIds.add(page.block_id);
  accumulator.schedulePageIds.add(page.block_id);
  accumulator.revisions[`page:${page.block_id}:parent`] =
    updatedPage.parentRevision;
  accumulator.revisions[`page:${page.block_id}:metadata`] =
    updatedPage.metadataRevision;
};

const collectViewPropertyIds = (
  config: DatabaseViewConfig,
): ReadonlySet<string> => {
  const ids = new Set<string>(config.display.propertyIds);
  if (config.group) ids.add(config.group.propertyId);
  for (const sort of config.sort) {
    if (sort.field.kind === "property") ids.add(sort.field.propertyId);
  }
  const visit = (node: DatabaseViewConfig["filter"]): void => {
    if (node.kind === "clause") {
      ids.add(node.propertyId);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(config.filter);
  return ids;
};

const validateViewProperties = (
  database: Database.Database,
  request: DatabaseApply,
  source: SourceRow,
  config: DatabaseViewConfig,
): void => {
  const knownIds = new Set(
    (database.prepare(`
      SELECT id FROM data_source_properties
      WHERE data_source_id = ? AND lifecycle = 'active'
    `).all(source.id) as readonly { readonly id: string }[])
      .map((row) => row.id),
  );
  for (const propertyId of collectViewPropertyIds(config)) {
    if (knownIds.has(propertyId)) continue;
    rejectApply(
      "invalid_request",
      `View references missing Data Source property ${propertyId}`,
      request,
    );
  }
};

const applyPutView = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "put_view" }>,
  now: string,
  accumulator: ApplyAccumulator,
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
  if (source.home_database_block_id !== container.block_id) {
    rejectApply(
      "resource_not_found",
      "View Container and Data Source must share one home Database",
      request,
    );
  }
  requireAuthorization(
    database,
    request,
    { kind: "database", databaseId: container.block_id },
    "manage_views",
  );
  const existing = readViewRow(database, operation.viewId);
  requireRevision(
    request,
    `View ${operation.viewId}`,
    operation.expectedRevision,
    existing?.revision ?? 0,
  );
  if (existing && existing.database_block_id !== container.block_id) {
    rejectApply(
      "operation_id_collision",
      `View ${operation.viewId} belongs to another Database`,
      request,
    );
  }
  const config = parseDatabaseViewConfig(operation.config);
  validateViewProperties(database, request, source, config);
  const ranks = existing && operation.beforeViewId === undefined
    ? {
        rankKey: existing.rank_key,
        rebalancedRankKeys: new Map<string, string>(),
      }
    : planDatabaseFractionalRank({
        items: readRankedItems(
          database,
          "database_views",
          "database_block_id",
          container.block_id,
        ),
        targetId: operation.viewId,
        ...(typeof operation.beforeViewId === "string"
          ? { beforeId: operation.beforeViewId }
          : {}),
      });
  applyRebalancedRanks(
    database,
    "database_views",
    ranks.rebalancedRankKeys,
  );
  if (operation.isDefault) {
    database.prepare(`
      UPDATE database_views
      SET is_primary = 0, revision = revision + 1, updated_at = ?
      WHERE database_block_id = ? AND is_primary = 1 AND id <> ?
    `).run(now, container.block_id, operation.viewId);
  }
  const projectId = (database.prepare(`
    SELECT project_id AS projectId FROM blocks WHERE id = ?
  `).get(container.block_id) as { readonly projectId: string }).projectId;
  const revision = (existing?.revision ?? 0) + 1;
  database.prepare(`
    INSERT INTO database_views (
      id, database_block_id, project_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at,
      data_source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      database_block_id = excluded.database_block_id,
      project_id = excluded.project_id,
      name = excluded.name,
      kind = excluded.kind,
      config_json = excluded.config_json,
      is_primary = excluded.is_primary,
      revision = excluded.revision,
      rank_key = excluded.rank_key,
      lifecycle = 'active',
      updated_at = excluded.updated_at,
      data_source_id = excluded.data_source_id
  `).run(
    operation.viewId,
    container.block_id,
    projectId,
    operation.name.trim(),
    operation.viewKind,
    stableStringifyDatabaseJson(config),
    operation.isDefault ? 1 : 0,
    revision,
    ranks.rankKey,
    existing?.created_at ?? now,
    now,
    source.id,
  );
  database.prepare(`
    UPDATE database_containers
    SET default_view_id = CASE WHEN ? = 1 THEN ? ELSE default_view_id END,
      metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE block_id = ?
  `).run(
    operation.isDefault ? 1 : 0,
    operation.viewId,
    now,
    container.block_id,
  );
  accumulator.databaseIds.add(container.block_id);
  accumulator.dataSourceIds.add(source.id);
  accumulator.viewIds.add(operation.viewId);
  accumulator.revisions[`view:${operation.viewId}`] = revision;
};

const applyDeleteView = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "delete_view" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  const view = requireApplyResource(
    readViewRow(database, operation.viewId),
    `View does not exist: ${operation.viewId}`,
    request,
  );
  if (
    view.database_block_id !== operation.databaseId
    || view.lifecycle !== "active"
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
  );
  requireRevision(
    request,
    `View ${view.id}`,
    operation.expectedRevision,
    view.revision,
  );
  const revision = view.revision + 1;
  database.prepare(`
    UPDATE database_views
    SET lifecycle = 'deleted', is_primary = 0, revision = ?, updated_at = ?
    WHERE id = ?
  `).run(revision, now, view.id);
  database.prepare(`
    UPDATE database_containers
    SET default_view_id = CASE WHEN default_view_id = ? THEN NULL
      ELSE default_view_id END,
      metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE block_id = ?
  `).run(view.id, now, operation.databaseId);
  accumulator.databaseIds.add(operation.databaseId);
  accumulator.dataSourceIds.add(view.data_source_id);
  accumulator.viewIds.add(operation.viewId);
  accumulator.revisions[`view:${view.id}`] = revision;
};

const readLogicalPositionItems = (
  database: Database.Database,
  input: {
    readonly view: DatabaseViewRecord;
    readonly groupKey: string | null;
    readonly excludedPageIds: ReadonlySet<string>;
    readonly positionConsistencyExemptPageIds: ReadonlySet<string>;
  },
): readonly LogicalDatabaseViewPositionItem[] => {
  const materialized = materializeDataSourceRows(database, {
    dataSourceId: input.view.dataSourceId,
    viewId: input.view.viewId,
    groupPropertyId: input.view.config.group?.propertyId ?? null,
    filter: { kind: "group", operator: "and", children: [] },
    sort: input.view.config.sort,
    excludedPositionConsistencyPageIds:
      input.positionConsistencyExemptPageIds,
  });
  return materialized.rows.flatMap(
    (row): readonly LogicalDatabaseViewPositionItem[] => {
      if (
        input.excludedPageIds.has(row.page.pageId)
        || row.effectiveGroupKey !== input.groupKey
      ) {
        return [];
      }
      return [{
        pageId: row.page.pageId,
        rankKey: row.position?.rankKey ?? null,
      }];
    },
  );
};

interface PositionRunEntry {
  readonly pageId: string;
  readonly expectedPositionRevision: number;
}

const explicitlyPositionedPageIds = (
  request: DatabaseApply,
  viewId: string,
): ReadonlySet<string> => new Set(request.operations.flatMap((operation) => {
  if (operation.kind === "position_page" && operation.viewId === viewId) {
    return [operation.pageId];
  }
  if (operation.kind === "position_pages" && operation.viewId === viewId) {
    return operation.pages.map((entry) => entry.pageId);
  }
  return [];
}));

const applyPositionRun = (
  database: Database.Database,
  request: DatabaseApply,
  operation: {
    readonly viewId: string;
    readonly pages: readonly PositionRunEntry[];
    readonly groupKey: string | null;
    readonly beforePageId?: string;
  },
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  const pageIds = operation.pages.map((entry) => entry.pageId);
  if (new Set(pageIds).size !== pageIds.length) {
    rejectApply("invalid_request", "Bulk View position Page IDs must be unique", request);
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
    rejectApply("resource_not_found", `Active View does not exist: ${operation.viewId}`, request);
  }
  const view = rowToView(viewRow);
  requireAuthorization(database, request, { kind: "view", viewId: view.viewId }, "read");

  const validated = operation.pages.map((entry) => {
    requireAuthorization(database, request, { kind: "page", pageId: entry.pageId }, "write");
    const membership = requireApplyResource(
      readActiveMembership(database, entry.pageId, view.dataSourceId),
      `Page ${entry.pageId} is not in View ${view.viewId}'s Data Source`,
      request,
    );
    const existing = database.prepare(`
      SELECT revision FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(view.viewId, entry.pageId) as { readonly revision: number } | undefined;
    requireRevision(
      request,
      `View position ${view.viewId}/${entry.pageId}`,
      entry.expectedPositionRevision,
      existing?.revision ?? 0,
    );
    if (view.config.group) {
      const value = database.prepare(`
        SELECT value.value_json AS valueJson
        FROM data_source_property_values value
        WHERE value.membership_id = ? AND value.property_id = ?
      `).get(membership.id, view.config.group.propertyId) as
        | { readonly valueJson: string }
        | undefined;
      const effectiveGroup = groupKeyForValue(
        value ? parseJsonValue(value.valueJson, "Grouped property value") : undefined,
      );
      if (operation.groupKey !== effectiveGroup) {
        rejectApply(
          "invalid_request",
          `Position group ${operation.groupKey ?? "null"} does not match grouped property ${effectiveGroup ?? "null"}`,
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

  const ranks = (() => {
    try {
      return planDatabaseViewPositionRun({
        logicalGroupOrder: readLogicalPositionItems(database, {
          view,
          groupKey: operation.groupKey,
          excludedPageIds: new Set(pageIds),
          positionConsistencyExemptPageIds: requestPositionPageIds,
        }),
        movedPageIds: pageIds,
        rankDirection: view.config.sort.find(
          (entry) => entry.field.kind === "manual",
        )?.direction ?? "asc",
        ...(operation.beforePageId === undefined
          ? {}
          : { beforePageId: operation.beforePageId }),
      });
    } catch (error) {
      if (!(error instanceof DatabaseViewPositionPlanError)) throw error;
      return rejectApply(
        "invalid_request",
        error.message,
        request,
      );
    }
  })();

  const putCanonical = database.prepare(`
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
  const putLegacy = database.prepare(`
    INSERT INTO database_view_positions (
      view_id, block_id, project_id, group_key, rank_key, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(view_id, block_id) DO UPDATE SET
      group_key = excluded.group_key,
      rank_key = excluded.rank_key,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `);
  const updateCanonicalRank = database.prepare(`
    UPDATE database_view_page_positions SET rank_key = ?, updated_at = ?
    WHERE view_id = ? AND page_block_id = ?
  `);
  const updateLegacyRank = database.prepare(`
    UPDATE database_view_positions SET rank_key = ?, updated_at = ?
    WHERE view_id = ? AND block_id = ?
  `);
  for (const write of ranks.siblingWrites) {
    if (write.kind === "materialize") {
      if (requestPositionPageIds.has(write.pageId)) continue;
      putCanonical.run(
        view.viewId,
        write.pageId,
        operation.groupKey,
        write.rankKey,
        1,
        now,
        now,
      );
      putLegacy.run(
        view.viewId,
        write.pageId,
        readPageProjectId(database, write.pageId),
        operation.groupKey,
        write.rankKey,
        1,
        now,
        now,
      );
      continue;
    }
    const canonical = updateCanonicalRank.run(
      write.rankKey,
      now,
      view.viewId,
      write.pageId,
    );
    const legacy = updateLegacyRank.run(
      write.rankKey,
      now,
      view.viewId,
      write.pageId,
    );
    if (canonical.changes === 1 && legacy.changes === 1) continue;
    throw new DatabaseModuleStateError(
      `View ${view.viewId} sibling position disappeared during rank maintenance`,
    );
  }
  for (const { entry, existing } of validated) {
    const rankKey = ranks.movedRankKeys.get(entry.pageId);
    if (!rankKey) throw new DatabaseModuleStateError(`Rank plan omitted Page ${entry.pageId}`);
    const revision = (existing?.revision ?? 0) + 1;
    putCanonical.run(
      view.viewId,
      entry.pageId,
      operation.groupKey,
      rankKey,
      revision,
      now,
      now,
    );
    putLegacy.run(
      view.viewId,
      entry.pageId,
      readPageProjectId(database, entry.pageId),
      operation.groupKey,
      rankKey,
      revision,
      now,
      now,
    );
    const metadataRevision = updatePageMetadataProjection(database, entry.pageId, now);
    accumulator.pageIds.add(entry.pageId);
    accumulator.revisions[`position:${view.viewId}:${entry.pageId}`] = revision;
    accumulator.revisions[`page:${entry.pageId}:metadata`] = metadataRevision;
  }
  accumulator.databaseIds.add(view.databaseId);
  accumulator.dataSourceIds.add(view.dataSourceId);
  accumulator.viewIds.add(view.viewId);
};

const applyPositionPage = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "position_page" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => applyPositionRun(database, request, {
  viewId: operation.viewId,
  pages: [{
    pageId: operation.pageId,
    expectedPositionRevision: operation.expectedPositionRevision,
  }],
  groupKey: operation.groupKey,
  ...(operation.beforePageId === undefined
    ? {}
    : { beforePageId: operation.beforePageId }),
}, now, accumulator);

const applyPositionPages = (
  database: Database.Database,
  request: DatabaseApply,
  operation: Extract<DatabaseApplyOperation, { readonly kind: "position_pages" }>,
  now: string,
  accumulator: ApplyAccumulator,
): void => applyPositionRun(database, request, operation, now, accumulator);

const executeOperation = (
  database: Database.Database,
  request: DatabaseApply,
  operation: DatabaseApplyOperation,
  now: string,
  accumulator: ApplyAccumulator,
): void => {
  switch (operation.kind) {
    case "put_property":
      applyPutProperty(database, request, operation, now, accumulator);
      return;
    case "delete_property":
      applyDeleteProperty(database, request, operation, now, accumulator);
      return;
    case "set_value":
      applySetValue(database, request, operation, now, accumulator);
      return;
    case "set_values":
      for (const value of operation.values) {
        applySetValue(
          database,
          request,
          { kind: "set_value", ...value },
          now,
          accumulator,
        );
      }
      return;
    case "add_remove_value":
      applyAddRemoveValue(database, request, operation, now, accumulator);
      return;
    case "transfer_page":
      applyTransferPage(database, request, operation, now, accumulator);
      return;
    case "put_view":
      applyPutView(database, request, operation, now, accumulator);
      return;
    case "delete_view":
      applyDeleteView(database, request, operation, now, accumulator);
      return;
    case "position_page":
      applyPositionPage(database, request, operation, now, accumulator);
      return;
    case "position_pages":
      applyPositionPages(database, request, operation, now, accumulator);
      return;
  }
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
    request: DatabaseApply;
    project: ProjectRow;
    requestJson: string;
    requestHash: string;
    outcome: "committed" | "rejected";
    result: DatabaseApplyReceipt | DatabaseModuleError;
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
  request: DatabaseApply,
  requestHash: string,
): DatabaseApplyResult => {
  if (
    stored.request_hash !== requestHash
    || stored.project_id !== request.projectId
    || stored.store_epoch !== request.storeEpoch
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
  const parsed = JSON.parse(stored.result_json) as
    | DatabaseApplyReceipt
    | DatabaseModuleError;
  if (stored.outcome === "rejected") {
    return { ok: false, error: parsed as DatabaseModuleError };
  }
  const receipt = parsed as DatabaseApplyReceipt;
  return { ok: true, value: { ...receipt, duplicate: true } };
};

const refreshCompatibilityProjections = (
  database: Database.Database,
  accumulator: ApplyAccumulator,
  now: string,
): void => {
  const pageIdsByProject = new Map<string, string[]>();
  for (const pageId of accumulator.pageIds) {
    const projectId = readPageProjectId(database, pageId);
    const pageIds = pageIdsByProject.get(projectId) ?? [];
    pageIds.push(pageId);
    pageIdsByProject.set(projectId, pageIds);
  }
  for (const [projectId, pageIds] of pageIdsByProject) {
    rebuildPageReadModelProjection(database, projectId, pageIds);
  }

  const scheduleIdsByProject = new Map<string, string[]>();
  for (const pageId of accumulator.schedulePageIds) {
    const projectId = readPageProjectId(database, pageId);
    const pageIds = scheduleIdsByProject.get(projectId) ?? [];
    pageIds.push(pageId);
    scheduleIdsByProject.set(projectId, pageIds);
  }
  for (const [projectId, pageIds] of scheduleIdsByProject) {
    refreshScheduledPageIndexProjection(database, projectId, pageIds, now);
  }
};

const persistDatabaseModuleChange = (
  database: Database.Database,
  request: DatabaseApply,
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
    stableStringifyDatabaseJson(uniqueSorted([
      ...pageIds,
      ...databaseIds,
    ])),
    stableStringifyDatabaseJson(databaseIds),
    stableStringifyDatabaseJson({
      version: DATABASE_MODULE_CONTRACT_VERSION,
      mutationKind: "database_module_apply",
      operationKinds: request.operations.map((operation) => operation.kind),
      requestHash,
      affectedDataSourceIds: uniqueSorted(accumulator.dataSourceIds),
      committedRevisions: accumulator.revisions,
    }),
    now,
  );
  const sequence = Number(inserted.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new DatabaseModuleStateError(
    "SQLite returned an invalid Database Module change sequence",
  );
};

const validateApplyRequest = (request: DatabaseApply): void => {
  if (request.version !== DATABASE_MODULE_CONTRACT_VERSION) {
    throw new TypeError("Unsupported Database Module contract version");
  }
  normalizeIdentity(request.operationId, "operationId");
  normalizeIdentity(request.projectId, "projectId");
  normalizeIdentity(request.storeEpoch, "storeEpoch");
  if (request.operations.length < 1 || request.operations.length > 64) {
    throw new TypeError("Database apply requires between 1 and 64 operations");
  }
};

export const applyDatabaseModule = (
  database: Database.Database,
  request: DatabaseApply,
  options: Readonly<{ now?: () => string }> = {},
): DatabaseApplyResult => {
  try {
    validateApplyRequest(request);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        operationId: request.operationId,
      },
    };
  }
  const requestJson = stableStringifyDatabaseJson(request);
  const requestHash = sha256(requestJson);
  const now = options.now?.() ?? new Date().toISOString();
  const apply = database.transaction((): DatabaseApplyResult => {
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
      schedulePageIds: new Set(),
    };
    try {
      database.transaction(() => {
        for (const operation of request.operations) {
          executeOperation(database, request, operation, now, accumulator);
        }
        refreshCompatibilityProjections(database, accumulator, now);
      })();
    } catch (error) {
      if (!(error instanceof DatabaseModuleRejection)) throw error;
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
    const changeLogSeq = persistDatabaseModuleChange(
      database,
      request,
      requestHash,
      accumulator,
      now,
    );
    const receipt: DatabaseApplyReceipt = {
      version: DATABASE_MODULE_CONTRACT_VERSION,
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

export const createSqliteDatabaseModule = (
  database: Database.Database = getDb(),
): DatabaseModule => ({
  read: async (input) => readDatabaseModule(database, input),
  apply: async (input) => applyDatabaseModule(database, input),
});
