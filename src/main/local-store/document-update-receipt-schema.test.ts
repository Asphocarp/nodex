import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
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

const withTempStore = async (
  run: (databasePath: string) => Promise<void>,
): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-update-receipt-"));
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

const seedV60Update = (
  database: Database.Database,
  update: Buffer,
): { readonly documentId: string } => {
  const project = database.prepare(`
    SELECT id FROM projects ORDER BY created LIMIT 1
  `).get() as { id: string };
  const now = new Date().toISOString();
  const blockId = "receipt-migration-card";
  const documentId = `document:${blockId}`;
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `).run(blockId, project.id, now, now);
  database.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, state_hash, readiness, authority, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
              'pending_genesis', 'legacy_shadow', ?, ?)
  `).run(documentId, project.id, now, now);
  database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(blockId, documentId, project.id, now);
  database.prepare(`
    INSERT INTO document_updates (
      document_id, generation, seq, update_id, client_session_id,
      base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
    ) VALUES (?, 1, 1, 'v60-update', 'legacy-client', 0,
              '["client-hint"]', ?, ?, ?)
  `).run(documentId, update, "a".repeat(64), now);
  database.exec(`
    DROP TABLE document_update_receipts;
    PRAGMA user_version = 60;
  `);
  return { documentId };
};

describe("document update receipt schema", () => {
  sqliteTest("migrates v60 update metadata into durable receipts", async () => {
    await withTempStore(async (databasePath) => {
      const legacy = new Database(databasePath);
      const { documentId } = seedV60Update(legacy, Buffer.from([1, 2, 3]));
      legacy.close();

      await initializeDatabase();
      closeDatabase();
      const migrated = new Database(databasePath, { readonly: true });
      try {
        expect(migrated.pragma("user_version", { simple: true }) as number).toBe(
          CURRENT_SCHEMA_VERSION,
        );
        const receipt = migrated.prepare(`
          SELECT seq, client_touched_block_ids_json,
                 derived_touched_block_ids_json, derivation_version,
                 update_hash, update_byte_length
          FROM document_update_receipts
          WHERE document_id = ? AND update_id = 'v60-update'
        `).get(documentId) as {
          seq: number;
          client_touched_block_ids_json: string;
          derived_touched_block_ids_json: string;
          derivation_version: number;
          update_hash: string;
          update_byte_length: number;
        };
        expect(receipt.seq).toBe(1);
        expect(receipt.client_touched_block_ids_json).toBe('["client-hint"]');
        expect(receipt.derived_touched_block_ids_json).toBe("[]");
        expect(receipt.derivation_version).toBe(0);
        expect(receipt.update_hash).toBe("a".repeat(64));
        expect(receipt.update_byte_length).toBe(3);
      } finally {
        migrated.close();
      }
    });
  });

  sqliteTest("rolls v61 DDL and receipt backfill back together", async () => {
    await withTempStore(async (databasePath) => {
      const legacy = new Database(databasePath);
      seedV60Update(legacy, Buffer.alloc(0));
      legacy.close();

      let rejected = false;
      try {
        await initializeDatabase();
      } catch (error) {
        rejected = (error as Error).message.includes("update_byte_length");
      }
      closeDatabase();
      expect(rejected).toBeTrue();

      const rolledBack = new Database(databasePath, { readonly: true });
      try {
        expect(rolledBack.pragma("user_version", { simple: true }) as number).toBe(60);
        const receiptTable = rolledBack.prepare(`
          SELECT 1 FROM sqlite_master
          WHERE type = 'table' AND name = 'document_update_receipts'
        `).get();
        expect(receiptTable === undefined).toBeTrue();
      } finally {
        rolledBack.close();
      }
    });
  });
});
