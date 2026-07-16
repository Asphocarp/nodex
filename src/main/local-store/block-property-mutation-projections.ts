import type Database from "better-sqlite3";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";

/**
 * Rebuild property-derived disposable projections inside the caller's
 * authoritative SQLite transaction. This function deliberately does not open
 * a transaction: the property kernel must commit values, metadata revision,
 * scheduler freshness, read model, change cursor, and receipt as one unit.
 */
export const rebuildBlockPropertyMutationProjections = (
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
  updatedAt: string,
): void => {
  const uniquePageIds = [...new Set(pageIds)].sort();
  if (uniquePageIds.length === 0) return;
  refreshScheduledPageIndexProjection(
    database,
    projectId,
    uniquePageIds,
    updatedAt,
  );
  rebuildPageReadModelProjection(database, projectId, uniquePageIds);
};
