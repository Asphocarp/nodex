import type Database from "better-sqlite3";

import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "../../shared/block-property-mutations";
import type {
  DataSourcePageValue,
  DataSourcePropertyRecord,
} from "../../shared/database-module";
import type {
  PageDataSourceContext,
  PageDetail,
  PageDetailError,
  PageDetailResult,
  PageIntrinsicProperty,
} from "../../shared/page-detail";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import {
  readDatabaseContainerDescriptorInDatabase,
  readDataSourceDescriptorInDatabase,
} from "./database-module";
import { PageStoreStateError, readPageInDatabase } from "./pages";

interface ProjectRow {
  readonly id: string;
  readonly library_id: string;
}

interface DocumentRow {
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly schema_key: string;
  readonly schema_version: number;
}

interface IntrinsicPropertyRow {
  readonly property_key: string;
  readonly value_type: PageIntrinsicProperty["valueType"];
  readonly value_json: string;
  readonly revision: number;
}

interface MembershipRow {
  readonly id: string;
  readonly data_source_id: string;
  readonly revision: number;
  readonly created_at: string;
}

interface ValueRow {
  readonly property_id: string;
  readonly value_type: DataSourcePageValue["valueType"];
  readonly value_json: string;
  readonly revision: number;
}

class PageDetailStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PageDetailStateError";
  }
}

const normalizeIdentity = (value: string, label: string): string => {
  const normalized = value.trim();
  if (normalized && normalized.length <= 512) return normalized;
  throw new TypeError(`${label} must be a non-empty bounded identity`);
};

const parseJson = (value: string, label: string): BlockPropertyJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(JSON.parse(value) as unknown),
    ) as BlockPropertyJsonValue;
  } catch (error) {
    throw new PageDetailStateError(`${label} contains invalid JSON`, {
      cause: error,
    });
  }
};

const readIntrinsicProperties = (
  database: Database.Database,
  pageId: string,
): readonly PageIntrinsicProperty[] =>
  (database.prepare(`
    SELECT property_key, value_type, value_json, revision
    FROM block_properties
    WHERE block_id = ?
    ORDER BY property_key
  `).all(pageId) as readonly IntrinsicPropertyRow[]).map((row) => ({
    key: row.property_key,
    valueType: row.value_type,
    value: parseJson(row.value_json, `Page property ${pageId}/${row.property_key}`),
    revision: row.revision,
  }));

const readValues = (
  database: Database.Database,
  membershipId: string,
  properties: readonly DataSourcePropertyRecord[],
): Readonly<Record<string, DataSourcePageValue>> => {
  const propertyById = new Map(properties.map((property) => [property.propertyId, property]));
  const rows = database.prepare(`
    SELECT property_id, value_type, value_json, revision
    FROM data_source_property_values
    WHERE membership_id = ?
    ORDER BY property_id
  `).all(membershipId) as readonly ValueRow[];
  const values: Record<string, DataSourcePageValue> = {};
  for (const row of rows) {
    const property = propertyById.get(row.property_id);
    if (!property || property.lifecycle !== "active") continue;
    if (property.valueType !== row.value_type) {
      throw new PageDetailStateError(
        `Page value ${membershipId}/${row.property_id} diverges from its schema`,
      );
    }
    values[row.property_id] = {
      propertyId: row.property_id,
      valueType: row.value_type,
      value: parseJson(
        row.value_json,
        `Page value ${membershipId}/${row.property_id}`,
      ),
      revision: row.revision,
    };
  }
  return values;
};

const readDataSourceContext = (
  database: Database.Database,
  pageId: string,
  dataSourceId: string | null,
): PageDataSourceContext => {
  if (!dataSourceId) return { kind: "standalone" };
  const memberships = database.prepare(`
    SELECT id, data_source_id, revision, created_at
    FROM data_source_page_memberships
    WHERE page_block_id = ? AND removed_at IS NULL
    ORDER BY id
  `).all(pageId) as readonly MembershipRow[];
  if (memberships.length !== 1 || memberships[0]?.data_source_id !== dataSourceId) {
    throw new PageDetailStateError(
      `Page ${pageId} has no exclusive matching Data Source membership`,
    );
  }
  const membership = memberships[0];
  const source = readDataSourceDescriptorInDatabase(database, dataSourceId);
  if (!source || source.dataSource.lifecycle === "deleted") {
    throw new PageDetailStateError(
      `Page ${pageId} points to missing Data Source ${dataSourceId}`,
    );
  }
  const container = readDatabaseContainerDescriptorInDatabase(
    database,
    source.dataSource.homeDatabaseId,
  );
  if (!container || container.database.lifecycle === "deleted") {
    throw new PageDetailStateError(
      `Data Source ${dataSourceId} has no active Database Container`,
    );
  }
  return {
    kind: "member",
    membership: {
      membershipId: membership.id,
      dataSourceId: membership.data_source_id,
      revision: membership.revision,
      createdAt: membership.created_at,
    },
    database: container.database,
    dataSource: source.dataSource,
    properties: source.properties.filter((property) => property.lifecycle === "active"),
    values: readValues(database, membership.id, source.properties),
  };
};

const failure = (
  code: PageDetailError["code"],
  message: string,
  retryable = false,
): PageDetailResult => ({ ok: false, error: { code, message, retryable } });

export const readPageDetailInDatabase = (
  database: Database.Database,
  rawProjectId: string,
  rawPageId: string,
): PageDetailResult => {
  let projectId: string;
  let pageId: string;
  try {
    projectId = normalizeIdentity(rawProjectId, "projectId");
    pageId = normalizeIdentity(rawPageId, "pageId");
  } catch (error) {
    return failure(
      "invalid_request",
      error instanceof Error ? error.message : "Page Detail scope is invalid",
    );
  }
  try {
    return database.transaction((): PageDetailResult => {
      const store = database.prepare(`
        SELECT store_epoch AS storeEpoch
        FROM block_store_metadata WHERE id = 1
      `).get() as { readonly storeEpoch: string } | undefined;
      if (!store) {
        return failure("store_not_initialized", "The Library store is not initialized");
      }
      const project = database.prepare(`
        SELECT id, library_id FROM projects WHERE id = ?
      `).get(projectId) as ProjectRow | undefined;
      if (!project) return failure("project_not_found", "Project does not exist");
      const page = readPageInDatabase(database, pageId);
      if (!page || page.lifecycle === "deleted") {
        return failure("page_not_found", "Page does not exist");
      }
      const authorization = authorizeProjectResourceInDatabase(database, {
        projectId,
        resource: { kind: "page", pageId },
        action: "read",
      });
      if (!authorization.allowed) {
        return failure(
          "authorization_denied",
          `Page read denied: ${authorization.reason}`,
        );
      }
      const document = database.prepare(`
        SELECT readiness, schema_key, schema_version
        FROM documents WHERE id = ?
      `).get(page.documentId) as DocumentRow | undefined;
      if (!document) {
        throw new PageDetailStateError(
          `Page ${pageId} has no owned Document authority`,
        );
      }
      const change = database.prepare(`
        SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log
      `).get() as { readonly seq: number };
      const detail: PageDetail = {
        version: 1,
        projectId,
        libraryId: project.library_id,
        storeEpoch: store.storeEpoch,
        changeLogSeq: change.seq,
        page,
        document: {
          readiness: document.readiness,
          schemaKey: document.schema_key,
          schemaVersion: document.schema_version,
        },
        intrinsicProperties: readIntrinsicProperties(database, pageId),
        dataSourceContext: readDataSourceContext(
          database,
          pageId,
          page.parent.kind === "data_source" ? page.parent.dataSourceId : null,
        ),
      };
      return { ok: true, value: detail };
    })();
  } catch (error) {
    if (error instanceof PageDetailStateError || error instanceof PageStoreStateError) {
      return failure("page_detail_corrupt", error.message);
    }
    return failure(
      "unknown",
      error instanceof Error ? error.message : "Page Detail is unavailable",
      true,
    );
  }
};
