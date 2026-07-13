import type Database from "better-sqlite3";
import type {
  CardTargetReadModel,
  ResolveCardTargetInput,
} from "../../shared/card-targets";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import { resolveCardTarget } from "./card-targets";
import { getDb } from "./database";
import { readDatabaseViewById } from "./database-views";

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
 * Resolve a globally stable Card identity from a real host Project scope.
 *
 * Nodex is currently a single-user local store, so every Project in the same
 * store is readable. Keeping the requesting scope explicit gives a future
 * remote authority one place to enforce ACLs without putting Project hints
 * back into canonical reference Blocks.
 */
export const resolveProjectScopedCardTarget = (
  input: ResolveCardTargetInput,
  database: Database.Database = getDb(),
): CardTargetReadModel | null => {
  if (!projectScopeExists(input.requestingProjectId, database)) return null;
  return resolveCardTarget(input.targetBlockId, database);
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
      AND type = 'card'
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
