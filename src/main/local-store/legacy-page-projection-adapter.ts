import type Database from "better-sqlite3";

export interface PageProjectionStorageCoordinates {
  readonly tableName: "page_read_model" | "card_read_model";
  readonly pageIdColumn: "page_block_id" | "card_block_id";
}

export type CanvasPageReferenceTable =
  | "canvas_page_references"
  | "canvas_card_references";

const tableExists = (
  database: Database.Database,
  tableName: string,
): boolean => database.prepare(`
  SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?
`).get(tableName) !== undefined;

export const readCanvasPageReferenceTable = (
  database: Database.Database,
): CanvasPageReferenceTable => tableExists(database, "canvas_page_references")
  ? "canvas_page_references"
  : "canvas_card_references";

/**
 * Migration-only discovery for the v76 projection names. Runtime stores use
 * the Page coordinates; release migrations may briefly need to rebuild a v76
 * projection before schema v77 publishes the physical rename.
 */
export const readPageProjectionStorageCoordinates = (
  database: Database.Database,
): PageProjectionStorageCoordinates => {
  if (tableExists(database, "page_read_model")) {
    return {
      tableName: "page_read_model",
      pageIdColumn: "page_block_id",
    };
  }
  if (tableExists(database, "card_read_model")) {
    return {
      tableName: "card_read_model",
      pageIdColumn: "card_block_id",
    };
  }
  throw new Error("Page read-model projection storage is missing");
};

export const withPageNamedProjectionStorage = <T>(
  database: Database.Database,
  operation: () => T,
): T => {
  const coordinates = readPageProjectionStorageCoordinates(database);
  if (coordinates.tableName === "page_read_model") return operation();

  database.exec(`
    ALTER TABLE database_memberships
      RENAME COLUMN card_block_id TO page_block_id;
    ALTER TABLE card_read_model RENAME TO page_read_model;
    ALTER TABLE page_read_model
      RENAME COLUMN card_block_id TO page_block_id;
  `);
  try {
    return operation();
  } finally {
    database.exec(`
      ALTER TABLE page_read_model
        RENAME COLUMN page_block_id TO card_block_id;
      ALTER TABLE page_read_model RENAME TO card_read_model;
      ALTER TABLE database_memberships
        RENAME COLUMN page_block_id TO card_block_id;
    `);
  }
};
