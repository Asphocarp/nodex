import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { CURRENT_SCHEMA_VERSION } from "../src/main/local-store/schema";

const V64_TABLES = [
  "change_log",
  "block_relocations",
  "block_relocation_members",
  "block_relocation_source_states",
  "document_recovery_artifacts",
] as const;

const assert = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const hasTable = (database: Database.Database, tableName: string): boolean =>
  database
    .prepare(
      `
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    )
    .get(tableName) !== undefined;

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

const verifyCommittedLedgerInsertOrder = (
  database: Database.Database,
  projectId: string,
  storeEpoch: string,
): void => {
  const now = new Date().toISOString();
  const sourceCardId = "relocation-schema-source-card";
  const targetCardId = "relocation-schema-target-card";
  const sourceDocumentId = `document:${sourceCardId}`;
  const targetDocumentId = `document:${targetCardId}`;
  const requestHash = "a".repeat(64);
  const sourceUpdateId = `relocation:${requestHash}:source`;
  const targetUpdateId = `relocation:${requestHash}:target`;
  const insert = database.transaction(() => {
    database
      .prepare(
        `
        INSERT INTO cards (id, project_id, status, title, created, "order")
        VALUES (?, ?, 'draft', ?, ?, ?)
      `,
      )
      .run(sourceCardId, projectId, "Source", now, 0);
    database
      .prepare(
        `
        INSERT INTO cards (id, project_id, status, title, created, "order")
        VALUES (?, ?, 'draft', ?, ?, ?)
      `,
      )
      .run(targetCardId, projectId, "Target", now, 1);
    database
      .prepare(
        `
        UPDATE documents
        SET readiness = 'ready', authority = 'ydoc_primary',
            head_seq = 1, state_vector = X'00', state_hash = ?, updated_at = ?
        WHERE id IN (?, ?)
      `,
      )
      .run("0".repeat(64), now, sourceDocumentId, targetDocumentId);

    const insertBlock = database.prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'paragraph', 'active', 'document', ?, 1, 1, ?, ?)
    `,
    );
    insertBlock.run("relocation-root", projectId, sourceDocumentId, now, now);
    insertBlock.run("relocation-child", projectId, sourceDocumentId, now, now);
    insertBlock.run("relocation-parent", projectId, targetDocumentId, now, now);
    insertBlock.run("relocation-anchor", projectId, targetDocumentId, now, now);

    const insertReceipt = database.prepare(
      `
      INSERT INTO document_update_receipts (
        document_id, generation, seq, update_id, client_session_id,
        base_head_seq, client_touched_block_ids_json,
        derived_touched_block_ids_json, derivation_version, update_hash,
        update_byte_length, committed_at
      ) VALUES (?, 1, 1, ?, 'relocation:internal', 0, '[]', '[]', 1, ?, 1, ?)
    `,
    );
    insertReceipt.run(sourceDocumentId, sourceUpdateId, "1".repeat(64), now);
    insertReceipt.run(targetDocumentId, targetUpdateId, "2".repeat(64), now);

    const change = database
      .prepare(
        `
        INSERT INTO change_log (
          project_id, store_epoch, kind, operation_id, block_ids_json,
          document_ids_json, database_block_ids_json, payload_json,
          committed_at
        ) VALUES (
          ?, ?, 'block_relocation', 'relocation-schema-probe',
          '["relocation-root","relocation-child"]', ?, '[]', '{}', ?
        )
      `,
      )
      .run(
        projectId,
        storeEpoch,
        JSON.stringify([sourceDocumentId, targetDocumentId]),
        now,
      );

    database
      .prepare(
        `
        UPDATE blocks
        SET containing_document_id = ?, location_revision = 2, updated_at = ?
        WHERE id IN ('relocation-root', 'relocation-child')
      `,
      )
      .run(targetDocumentId, now);

    database
      .prepare(
        `
        INSERT INTO block_relocations (
          id, project_id, target_project_id, store_epoch, request_hash,
          request_json, source_document_id, source_generation,
          source_base_head_seq, target_kind, target_document_id,
          target_generation, target_base_head_seq, target_parent_block_id,
          target_before_block_id, root_block_ids_json,
          expected_location_revisions_json, source_update_id,
          source_committed_seq, target_update_id, target_committed_seq,
          final_location_revisions_json, result_json, change_log_seq,
          committed_at
        ) VALUES (
          'relocation-schema-probe', ?, ?, ?, ?, '{}', ?, 1, 0,
          'document', ?, 1, 0, 'relocation-parent', 'relocation-anchor',
          '["relocation-root"]', '{"relocation-root":1}', ?, 1, ?, 1,
          '{"relocation-root":2,"relocation-child":2}', '{}', ?, ?
        )
      `,
      )
      .run(
        projectId,
        projectId,
        storeEpoch,
        requestHash,
        sourceDocumentId,
        targetDocumentId,
        sourceUpdateId,
        targetUpdateId,
        Number(change.lastInsertRowid),
        now,
      );

    database
      .prepare(
        `
        INSERT INTO block_relocation_source_states (
          relocation_id, document_id, project_id, generation, head_seq,
          pre_state_vector, pre_full_update, pre_full_update_byte_length,
          pre_state_hash, captured_at
        ) VALUES (
          'relocation-schema-probe', ?, ?, 1, 0, X'00', X'00', 1, ?, ?
        )
      `,
      )
      .run(sourceDocumentId, projectId, "3".repeat(64), now);

    const insertMember = database.prepare(
      `
      INSERT INTO block_relocation_members (
        relocation_id, block_id, tree_ordinal, is_root, source_project_id,
        final_project_id, source_location_revision, final_location_revision
      ) VALUES (
        'relocation-schema-probe', ?, ?, ?, ?, ?, 1, 2
      )
    `,
    );
    insertMember.run("relocation-root", 0, 1, projectId, projectId);
    insertMember.run("relocation-child", 1, 0, projectId, projectId);
  });
  insert();

  const memberCount = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM block_relocation_members
      WHERE relocation_id = 'relocation-schema-probe'
    `,
    )
    .get() as { count: number };
  assert(
    memberCount.count === 2,
    "committed relocation members were not stored",
  );
};

const withTempStore = async (
  prefix: string,
  run: (databasePath: string) => Promise<void>,
): Promise<void> => {
  closeDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    closeDatabase();
    await run(getDatabasePath());
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const main = async (): Promise<void> => {
  let migratedAtomically = false;
  let remainedIdempotent = false;
  let rolledBackAtomically = false;

  await withTempStore(
    "nodex-relocation-schema-probe-",
    async (databasePath) => {
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
      assert(
        (migrated.pragma("user_version", { simple: true }) as number) ===
          CURRENT_SCHEMA_VERSION,
        "v63 database did not advance to the current schema",
      );
      assert(
        V64_TABLES.every((tableName) => hasTable(migrated, tableName)),
        "v64 relocation schema is incomplete",
      );
      assert(
        (migrated.pragma("foreign_key_check") as readonly unknown[]).length ===
          0,
        "v64 relocation schema has foreign-key violations",
      );
      verifyCommittedLedgerInsertOrder(migrated, project.id, store.store_epoch);
      migrated
        .prepare(
          `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, 'schema_probe', 'probe-1', '[]', '[]', '[]', '{}', ?)
    `,
        )
        .run(project.id, store.store_epoch, new Date().toISOString());
      migrated.close();
      migratedAtomically = true;

      await initializeDatabase();
      closeDatabase();
      const reopened = new Database(databasePath, { readonly: true });
      const retained = reopened
        .prepare(
          `
      SELECT COUNT(*) AS count
      FROM change_log
      WHERE operation_id = 'probe-1'
    `,
        )
        .get() as { count: number };
      assert(
        retained.count === 1,
        "reopening current schema changed its ledger",
      );
      reopened.close();
      remainedIdempotent = true;
    },
  );

  await withTempStore(
    "nodex-relocation-schema-rollback-probe-",
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
      assert(rejected, "incompatible v64 DDL was accepted");

      const unchanged = new Database(databasePath, { readonly: true });
      assert(
        (unchanged.pragma("user_version", { simple: true }) as number) === 63,
        "failed v64 migration advanced user_version",
      );
      assert(
        !hasTable(unchanged, "block_relocations") &&
          !hasTable(unchanged, "block_relocation_members") &&
          !hasTable(unchanged, "block_relocation_source_states") &&
          !hasTable(unchanged, "document_recovery_artifacts"),
        "failed v64 migration leaked partial DDL",
      );
      unchanged.close();
      rolledBackAtomically = true;
    },
  );

  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      migratedAtomically,
      remainedIdempotent,
      rolledBackAtomically,
    })}\n`,
  );
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
