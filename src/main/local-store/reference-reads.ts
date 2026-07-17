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
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../../shared/page-ownership-paths";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import { parseDatabaseViewId } from "../../shared/database-identities";
import { stableStringifyDatabaseJson } from "../../shared/database-kernel";
import { resolvePageTarget } from "./page-targets";
import { PageHierarchyError, resolvePageHierarchy } from "./page-hierarchy";
import { readPagesInDatabase } from "./pages";
import { getDb } from "./database";
import { readDatabaseModuleV2 } from "./database-module-v2-runtime";
import { readDatabasePageSummariesByIds } from "./page-read-store";
import {
  authorizeProjectResourceInDatabase,
  readAuthorizedPageHierarchyPrefixInDatabase,
} from "./project-resource-grants";

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
 * Resolve the canonical owning Page chain in one authority-side read. The path
 * stops before the first ancestor that the requesting Project cannot read, so
 * renderer navigation never receives unauthorized Page identities or titles.
 */
export const resolveProjectScopedPageOwnershipPath = (
  input: ResolvePageOwnershipPathInput,
  database: Database.Database = getDb(),
): PageOwnershipPathReadModel | null => {
  if (!projectScopeExists(input.requestingProjectId, database)) return null;
  return database.transaction((): PageOwnershipPathReadModel => {
    let hierarchy;
    try {
      hierarchy = resolvePageHierarchy(database, input.targetPageId);
    } catch (error) {
      if (error instanceof PageHierarchyError && error.code === "page_not_found") {
        return { status: "missing", targetPageId: input.targetPageId };
      }
      throw error;
    }
    const visiblePageIds = readAuthorizedPageHierarchyPrefixInDatabase(database, {
      projectId: input.requestingProjectId,
      hierarchy,
    });
    if (visiblePageIds[0] !== input.targetPageId) {
      return { status: "missing", targetPageId: input.targetPageId };
    }

    const pages = readPagesInDatabase(database, visiblePageIds);
    const target = pages.get(input.targetPageId);
    if (!target || target.lifecycle === "deleted") {
      return { status: "missing", targetPageId: input.targetPageId };
    }
    const ancestors = visiblePageIds.slice(1).toReversed().map((pageId) => {
      const page = pages.get(pageId);
      if (!page || page.lifecycle === "deleted") {
        throw new Error(`Page ownership ancestor ${pageId} is unavailable`);
      }
      return {
        pageId: page.pageId,
        title: page.title,
        lifecycle: page.lifecycle,
      } as const;
    });

    return {
      status: "available",
      targetPageId: input.targetPageId,
      ancestors,
    };
  })();
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
