import type Database from "better-sqlite3";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  DatabaseViewJsonValue,
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import { parseDatabaseViewId } from "../../shared/database-identities";
import { stableStringifyDatabaseJson } from "../../shared/database-kernel";
import { resolvePageTarget } from "./page-targets";
import { getDb } from "./database";
import { readDatabaseModuleV2 } from "./database-module-v2-runtime";
import { readDatabasePageSummariesByIds } from "./page-read-store";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

const projectScopeExists = (
  projectId: string,
  database: Database.Database,
): boolean => {
  if (!projectId || projectId !== projectId.trim() || projectId.length > 512) {
    return false;
  }
  return database.prepare(`
    SELECT 1
    FROM projects
    WHERE id = ?
    LIMIT 1
  `).get(projectId) !== undefined;
};

/**
 * Resolve a globally stable Page identity through current Project authority.
 * References carry no access: the binding or an explicit recursive grant must
 * independently authorize the target Page.
 */
export const resolveProjectScopedPageTarget = (
  input: ResolvePageTargetInput,
  database: Database.Database = getDb(),
): PageTargetReadModel | null => {
  if (!projectScopeExists(input.requestingProjectId, database)) return null;
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: input.requestingProjectId,
    resource: { kind: "page", pageId: input.targetPageId },
    action: "read",
  });
  if (!authorization.allowed) {
    return { status: "missing", targetPageId: input.targetPageId };
  }
  return resolvePageTarget(input.targetPageId, database);
};

/**
 * Read a durable Database View by global identity from a real host Project
 * scope. The returned definition carries the View's canonical owning Project.
 */
export const readProjectScopedDatabaseViewReference = (
  input: ReadDatabaseViewReferenceInput,
  database: Database.Database = getDb(),
): DatabaseViewReadModel | null => {
  if (!projectScopeExists(input.requestingProjectId, database)) return null;
  let viewId;
  try {
    viewId = parseDatabaseViewId(input.databaseViewId);
  } catch {
    return null;
  }
  const result = readDatabaseModuleV2(database, {
    version: 2,
    projectId: input.requestingProjectId,
    read: {
      target: { kind: "view", viewId },
      mode: "query",
    },
  });
  if (!result.ok) {
    if (
      result.error.code === "authorization_denied" ||
      result.error.code === "resource_not_found"
    ) {
      return null;
    }
    throw new Error(result.error.message);
  }
  if (result.value.value.kind !== "query") {
    throw new Error("Database View reference returned a non-query snapshot");
  }
  const query = result.value.value.value;
  const summaries = readDatabasePageSummariesByIds(
    database,
    query.rows.map((row) => row.page.pageId),
  );
  const summaryByPageId = new Map(summaries.map((page) => [page.id, page]));
  const model: DatabaseViewReadModel = {
    view: {
      id: query.view.viewId,
      databaseBlockId: query.view.databaseId,
      projectId: input.requestingProjectId,
      name: query.view.name,
      kind: query.view.kind,
      config: JSON.parse(
        stableStringifyDatabaseJson(query.view.config),
      ) as Readonly<Record<string, DatabaseViewJsonValue>>,
      isPrimary: query.database.defaultViewId === query.view.viewId,
      createdAt: query.view.createdAt,
      updatedAt: query.view.updatedAt,
    },
    rows: query.rows.map((row) => {
      const page = summaryByPageId.get(row.page.pageId);
      if (!page) {
        throw new Error(
          `Database View ${query.view.viewId} contains unreadable Page ${row.page.pageId}`,
        );
      }
      return {
        page,
        groupKey: row.effectiveGroupKey,
        rankKey: row.position?.rankKey ?? "ffffffffffffffffffffffffffffffff",
      };
    }),
  };
  const hostBlockId = input.hostBlockId && database.prepare(`
    SELECT 1
    FROM blocks
    WHERE id = ?
      AND project_id = ?
      AND type = 'page'
      AND lifecycle != 'deleted'
    LIMIT 1
  `).get(input.hostBlockId, input.requestingProjectId)
    ? input.hostBlockId
    : undefined;
  const rows = evaluateDatabaseViewRows(model, {
    ...(hostBlockId ? { hostBlockId } : {}),
  });
  if (rows === model.rows) return model;
  return { ...model, rows };
};
