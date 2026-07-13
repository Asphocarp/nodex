import type Database from "better-sqlite3";

export const LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER = [
  "card_project_transfer_write_fences",
  "card_search_units_fts",
  "card_search_units",
  "card_history_snapshots",
  "history",
  "description_revisions",
  "description_blocks",
  "foreign_reference_migrations",
  "legacy_card_shadow_jobs",
  "legacy_card_shadow_heads",
  "cards",
  "canvas",
] as const;

const tableExists = (
  database: Database.Database,
  tableName: string,
): boolean =>
  database
    .prepare(
      `SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) !== undefined;

/** Drop Card-first import storage after the staging candidate reaches parity. */
export const dropLegacyBlockFirstTables = (
  database: Database.Database,
): readonly string[] => {
  const dropped = LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER.filter((tableName) =>
    tableExists(database, tableName),
  );
  const drop = database.transaction(() => {
    database.exec(
      "DROP TRIGGER IF EXISTS cards_project_transfer_requires_write_fence",
    );
    for (const tableName of dropped) {
      database.exec(`DROP TABLE ${tableName}`);
    }
    const foreignKeyViolations = database.pragma(
      "foreign_key_check",
    ) as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Legacy cleanup left ${foreignKeyViolations.length} foreign-key violation(s)`,
      );
    }
    const integrity = database.pragma("integrity_check") as readonly {
      readonly integrity_check: string;
    }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error("Legacy cleanup failed SQLite integrity_check");
    }
  });
  drop.immediate();
  return dropped;
};
