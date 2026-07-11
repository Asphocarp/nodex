import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("better-sqlite3") && message.includes("not yet supported")
  );
};

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const V64_TABLES = [
  "change_log",
  "block_relocations",
  "block_relocation_members",
  "block_relocation_source_states",
  "document_recovery_artifacts",
] as const;

const dropV64Schema = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  try {
    database.exec(`
      DROP TABLE IF EXISTS block_relocation_members;
      DROP TABLE IF EXISTS block_relocation_source_states;
      DROP TABLE IF EXISTS document_recovery_artifacts;
      DROP TABLE IF EXISTS block_relocations;
      DROP TABLE IF EXISTS change_log;
      PRAGMA user_version = 63;
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
};

const withTempStore = async (
  prefix: string,
  run: (databasePath: string) => Promise<void>,
): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    closeDatabase();
    await run(getDatabasePath());
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const hasTable = (database: Database.Database, tableName: string): boolean =>
  database
    .prepare(
      `
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    )
    .get(tableName) !== undefined;

describe("atomic Block relocation schema", () => {
  sqliteTest(
    "migrates v63 to v64 atomically and remains idempotent",
    async () => {
      await withTempStore("nodex-relocation-schema-", async (databasePath) => {
        const legacy = new Database(databasePath);
        const project = legacy
          .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
          .get() as { id: string };
        const store = legacy
          .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
          .get() as { store_epoch: string };
        dropV64Schema(legacy);
        legacy.close();

        await initializeDatabase();
        closeDatabase();

        const migrated = new Database(databasePath);
        try {
          const version = migrated.pragma("user_version", {
            simple: true,
          }) as number;
          expect(version).toBe(CURRENT_SCHEMA_VERSION);
          expect(
            V64_TABLES.every((tableName) => hasTable(migrated, tableName)),
          ).toBe(true);
          expect(JSON.stringify(migrated.pragma("foreign_key_check"))).toBe(
            "[]",
          );

          migrated
            .prepare(
              `
            INSERT INTO change_log (
              project_id, store_epoch, kind, operation_id, block_ids_json,
              document_ids_json, database_block_ids_json, payload_json,
              committed_at
            ) VALUES (?, ?, 'schema_probe', 'probe-1', '[]', '[]', '[]', '{}', ?)
          `,
            )
            .run(project.id, store.store_epoch, new Date().toISOString());
        } finally {
          migrated.close();
        }

        await initializeDatabase();
        closeDatabase();
        const reopened = new Database(databasePath, { readonly: true });
        try {
          const retained = reopened
            .prepare(
              `
            SELECT COUNT(*) AS count
            FROM change_log
            WHERE project_id = ? AND operation_id = 'probe-1'
          `,
            )
            .get(project.id) as { count: number };
          expect(retained.count).toBe(1);
        } finally {
          reopened.close();
        }
      });
    },
  );

  sqliteTest(
    "rolls every v64 DDL statement back when one table is incompatible",
    async () => {
      await withTempStore(
        "nodex-relocation-schema-rollback-",
        async (databasePath) => {
          const legacy = new Database(databasePath);
          dropV64Schema(legacy);
          legacy.exec("CREATE TABLE change_log (seq INTEGER PRIMARY KEY)");
          legacy.close();

          let rejected = false;
          try {
            await initializeDatabase();
          } catch {
            rejected = true;
          } finally {
            closeDatabase();
          }
          expect(rejected).toBe(true);

          const unchanged = new Database(databasePath, { readonly: true });
          try {
            expect(
              unchanged.pragma("user_version", { simple: true }) as number,
            ).toBe(63);
            expect(hasTable(unchanged, "change_log")).toBe(true);
            expect(hasTable(unchanged, "block_relocations")).toBe(false);
            expect(hasTable(unchanged, "block_relocation_members")).toBe(false);
            expect(
              hasTable(unchanged, "block_relocation_source_states"),
            ).toBe(false);
            expect(
              hasTable(unchanged, "document_recovery_artifacts"),
            ).toBe(false);
            const columns = unchanged
              .prepare("PRAGMA table_info(change_log)")
              .all() as Array<{ name: string }>;
            expect(columns.map((column) => column.name).join(",")).toBe("seq");
          } finally {
            unchanged.close();
          }
        },
      );
    },
  );
});
