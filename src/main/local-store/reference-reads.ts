import type Database from "better-sqlite3";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import { resolvePageTarget } from "./page-targets";
import { getDb } from "./database";
import { readDatabaseViewById } from "./database-views";
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
  const model = readDatabaseViewById(input.databaseViewId, database);
  if (!model) return null;
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
