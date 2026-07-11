import type Database from "better-sqlite3";
import { rebuildCardReadModelProjection } from "./card-read-store";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";

/**
 * Rebuild property-derived disposable projections inside the caller's
 * authoritative SQLite transaction. This function deliberately does not open
 * a transaction: the property kernel must commit values, metadata revision,
 * scheduler freshness, read model, change cursor, and receipt as one unit.
 */
export const rebuildBlockPropertyMutationProjections = (
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
  updatedAt: string,
): void => {
  const uniqueCardIds = [...new Set(cardIds)].sort();
  if (uniqueCardIds.length === 0) return;
  refreshScheduledCardIndexProjection(
    database,
    projectId,
    uniqueCardIds,
    updatedAt,
  );
  rebuildCardReadModelProjection(database, projectId, uniqueCardIds);
};
