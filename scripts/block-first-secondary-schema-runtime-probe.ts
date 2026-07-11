import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "../src/main/local-store/cards";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import { CURRENT_SCHEMA_VERSION } from "../src/main/local-store/schema";

const V65_TABLES = [
  "document_versions",
  "block_mutations",
  "block_search_units",
  "block_search_units_fts",
  "block_asset_refs",
  "card_read_model",
] as const;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const operationFails = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

const tableExists = (database: Database.Database, tableName: string): boolean =>
  database
    .prepare(
      `
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    )
    .get(tableName) !== undefined;

const dropV65Schema = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  try {
    database.exec(`
      DROP TABLE IF EXISTS block_search_units_fts;
      DROP TABLE IF EXISTS block_search_units;
      DROP TABLE IF EXISTS block_asset_refs;
      DROP TABLE IF EXISTS card_read_model;
      DROP TABLE IF EXISTS document_versions;
      DROP TABLE IF EXISTS block_mutations;
      PRAGMA user_version = 64;
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
};

const withTemporaryStore = async <T>(
  prefix: string,
  run: () => Promise<T>,
): Promise<T> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.NODEX_DIR = tempDir;
  try {
    return await run();
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previous;
    }
  }
};

const runMigrationProbe = (): Promise<{
  migratedToVersion: number;
  idempotentRowRetained: boolean;
}> =>
  withTemporaryStore("nodex-secondary-schema-migration-", async () => {
    await initializeDatabase();
    closeDatabase();
    let database = new Database(getDatabasePath());
    const project = database
      .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
      .get() as { id: string };
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { store_epoch: string };
    dropV65Schema(database);
    database.close();

    await initializeDatabase();
    closeDatabase();
    database = new Database(getDatabasePath());
    try {
      const version = database.pragma("user_version", { simple: true }) as number;
      invariant(version === CURRENT_SCHEMA_VERSION, "v64 did not migrate to v65");
      invariant(
        V65_TABLES.every((tableName) => tableExists(database, tableName)),
        "v65 foundation is incomplete",
      );
      invariant(
        (database.pragma("foreign_key_check") as unknown[]).length === 0,
        "v65 migration has foreign-key violations",
      );
      database
        .prepare(
          `
          INSERT INTO block_mutations (
            mutation_id, project_id, store_epoch, mutation_kind,
            request_hash, request_json, field_intents_json, outcome,
            result_json, recorded_at
          ) VALUES (
            'migration-probe', ?, ?, 'schema_probe', ?, '{}', '[]',
            'rejected', '{"code":"probe"}', ?
          )
        `,
        )
        .run(project.id, store.store_epoch, HASH_A, new Date().toISOString());
    } finally {
      database.close();
    }

    await initializeDatabase();
    closeDatabase();
    database = new Database(getDatabasePath(), { readonly: true });
    try {
      const retained = database
        .prepare(
          "SELECT outcome FROM block_mutations WHERE mutation_id = 'migration-probe'",
        )
        .get() as { outcome: string } | undefined;
      return {
        migratedToVersion: database.pragma("user_version", {
          simple: true,
        }) as number,
        idempotentRowRetained: retained?.outcome === "rejected",
      };
    } finally {
      database.close();
    }
  });

const runContractProbe = (): Promise<{
  mutationRetryIdempotent: boolean;
  mutationCollisionRejected: boolean;
  immutableHistory: boolean;
  ftsProjectionWorks: boolean;
  futureProjectionRejected: boolean;
  noLegacyWriteBack: boolean;
}> =>
  withTemporaryStore("nodex-secondary-schema-contract-", async () => {
    await initializeDatabase();
    const project = createProject({ name: "Secondary schema contract" });
    const card = await createCard(project.id, "draft", {
      title: "Legacy sentinel",
    });
    closeDatabase();

    const database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const documentId = `document:${card.id}`;
    const bodyBlockId = "01900000-0000-7000-8000-000000000065";
    const databaseBlockId = `database:${project.id}:primary`;
    const now = new Date().toISOString();
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { store_epoch: string };

    try {
      database
        .prepare(
          `
          UPDATE documents
          SET readiness = 'ready', head_seq = 1, state_vector = X'01',
              state_hash = 'state-at-head-1', updated_at = ?
          WHERE id = ?
        `,
        )
        .run(now, documentId);
      database
        .prepare(
          `
          INSERT INTO document_materializations (
            document_id, generation, projected_seq, schema_version,
            title, nfm, plain_text, preview, block_tree_json,
            references_json, asset_refs_json, updated_at
          ) VALUES (?, 1, 1, 1, 'Canonical title', 'Canonical body',
            'Canonical body', 'Canonical body', '[]', '[]', '[]', ?)
        `,
        )
        .run(documentId, now);
      database
        .prepare(
          `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES (?, ?, 'image', 'active', 'document', ?, 1, 1, ?, ?)
        `,
        )
        .run(bodyBlockId, project.id, documentId, now, now);
      database
        .prepare(
          `
          INSERT INTO document_block_index (
            document_id, block_id, parent_block_id, ordinal,
            block_type, text, projected_seq
          ) VALUES (?, ?, NULL, 0, 'image', 'Canonical body', 1)
        `,
        )
        .run(documentId, bodyBlockId);

      database
        .prepare(
          `
          INSERT INTO document_versions (
            version_id, document_id, project_id, generation, base_head_seq,
            schema_key, schema_version, cause, actor_json, full_update_blob,
            state_vector, checkpoint_hash, byte_length, created_at
          ) VALUES (
            'version-1', ?, ?, 1, 1, 'nodex.card', 1, 'manual', '{}',
            ?, X'01', ?, 3, ?
          )
        `,
        )
        .run(documentId, project.id, Buffer.from([1, 2, 3]), HASH_A, now);

      const change = database
        .prepare(
          `
          INSERT INTO change_log (
            project_id, store_epoch, kind, operation_id, block_ids_json,
            document_ids_json, database_block_ids_json, payload_json,
            committed_at
          ) VALUES (?, ?, 'block_mutation', 'mutation-1', ?, ?, ?, '{}', ?)
        `,
        )
        .run(
          project.id,
          store.store_epoch,
          JSON.stringify([card.id]),
          JSON.stringify([documentId]),
          JSON.stringify([databaseBlockId]),
          now,
        );
      const insertMutationSql = `
        INSERT INTO block_mutations (
          mutation_id, project_id, store_epoch, mutation_kind, request_hash,
          request_json, target_block_ids_json, field_intents_json, outcome,
          result_json, change_log_seq, recorded_at
        ) VALUES (
          'mutation-1', ?, ?, 'set_property', ?, ?, ?, ?, 'committed',
          '{"status":"updated"}', ?, ?
        )
      `;
      const mutationValues = [
        project.id,
        store.store_epoch,
        HASH_A,
        JSON.stringify({ kind: "set_property", blockId: card.id }),
        JSON.stringify([card.id]),
        JSON.stringify([{ path: "database.priority", operation: "set" }]),
        Number(change.lastInsertRowid),
        now,
      ] as const;
      database.prepare(insertMutationSql).run(...mutationValues);
      const duplicate = database
        .prepare(`${insertMutationSql} ON CONFLICT(mutation_id) DO NOTHING`)
        .run(...mutationValues);
      const mutationCollisionRejected = operationFails(() => {
        database
          .prepare(`${insertMutationSql} ON CONFLICT(mutation_id) DO NOTHING`)
          .run(
            project.id,
            store.store_epoch,
            HASH_B,
            ...mutationValues.slice(3),
          );
      });

      database
        .prepare(
          `
          INSERT INTO block_search_units (
            unit_key, project_id, block_id, owner_block_id, document_id,
            document_generation, projected_seq, source_kind, field_key,
            text, text_hash, updated_at
          ) VALUES (
            'search-title', ?, ?, ?, ?, 1, 1, 'document_title', 'title',
            'Canonical title', ?, ?
          )
        `,
        )
        .run(project.id, card.id, card.id, documentId, HASH_A, now);
      database
        .prepare(
          `
          INSERT INTO block_asset_refs (
            document_id, block_id, owner_block_id, project_id,
            document_generation, projected_seq, role, ordinal, asset_uri,
            asset_hash, updated_at
          ) VALUES (?, ?, ?, ?, 1, 1, 'image', 0,
            'nodex-asset://canonical.png', ?, ?)
        `,
        )
        .run(documentId, bodyBlockId, card.id, project.id, HASH_B, now);
      database
        .prepare(
          `
          INSERT INTO card_read_model (
            card_block_id, project_id, lifecycle, location_kind,
            location_revision, metadata_revision, document_id,
            document_generation, document_projected_seq,
            document_schema_version, document_authority, membership_id,
            database_block_id, view_id, view_group_key, view_rank_key, title,
            description_preview, description_length, has_description,
            database_values_json, intrinsic_properties_json,
            property_revisions_json, created_at, updated_at
          ) VALUES (
            ?, ?, 'active', 'space', 1, 1, ?, 1, 1, 1,
            'legacy_shadow', ?, ?, ?, 'draft', 'rank-1', 'Canonical title',
            'Canonical body', 14, 1, '{"status":"draft"}', '{}',
            '{"status":1}', ?, ?
          )
        `,
        )
        .run(
          card.id,
          project.id,
          documentId,
          `membership:${card.id}`,
          databaseBlockId,
          `database-view:${project.id}:primary-kanban`,
          now,
          now,
        );

      const ftsHit = database
        .prepare(
          `
          SELECT unit.block_id
          FROM block_search_units_fts
          INNER JOIN block_search_units unit
            ON unit.rowid = block_search_units_fts.rowid
          WHERE block_search_units_fts MATCH 'canonical'
        `,
        )
        .get() as { block_id: string } | undefined;
      const titles = database
        .prepare(
          `
          SELECT card.title AS legacy_title, model.title AS projected_title
          FROM cards card
          INNER JOIN card_read_model model ON model.card_block_id = card.id
          WHERE card.id = ?
        `,
        )
        .get(card.id) as { legacy_title: string; projected_title: string };
      const futureProjectionRejected = operationFails(() => {
        database
          .prepare(
            "UPDATE card_read_model SET document_projected_seq = 2 WHERE card_block_id = ?",
          )
          .run(card.id);
      }) && operationFails(() => {
        database
          .prepare(
            `
            INSERT INTO block_search_units (
              unit_key, project_id, block_id, owner_block_id, document_id,
              document_generation, projected_seq, source_kind, field_key,
              text, text_hash, updated_at
            ) VALUES (
              'future-search', ?, ?, ?, ?, 1, 2, 'document_title', 'future',
              'Future', ?, ?
            )
          `,
          )
          .run(project.id, card.id, card.id, documentId, HASH_A, now);
      });

      invariant(
        (database.pragma("foreign_key_check") as unknown[]).length === 0,
        "secondary schema contract has foreign-key violations",
      );
      return {
        mutationRetryIdempotent: duplicate.changes === 0,
        mutationCollisionRejected,
        immutableHistory:
          operationFails(() => {
            database
              .prepare(
                "UPDATE document_versions SET cause = 'mutated' WHERE version_id = 'version-1'",
              )
              .run();
          }) &&
          operationFails(() => {
            database
              .prepare(
                "UPDATE block_mutations SET result_json = '{}' WHERE mutation_id = 'mutation-1'",
              )
              .run();
          }),
        ftsProjectionWorks: ftsHit?.block_id === card.id,
        futureProjectionRejected,
        noLegacyWriteBack:
          titles.legacy_title === "Legacy sentinel" &&
          titles.projected_title === "Canonical title",
      };
    } finally {
      database.close();
    }
  });

const runRollbackProbe = (): Promise<{
  rejected: boolean;
  versionAfterFailure: number;
  partialTables: number;
}> =>
  withTemporaryStore("nodex-secondary-schema-rollback-", async () => {
    await initializeDatabase();
    closeDatabase();
    let database = new Database(getDatabasePath());
    dropV65Schema(database);
    database.exec("CREATE TABLE block_mutations (mutation_id TEXT PRIMARY KEY)");
    database.close();

    let rejected = false;
    try {
      await initializeDatabase();
    } catch {
      rejected = true;
    } finally {
      closeDatabase();
    }

    database = new Database(getDatabasePath(), { readonly: true });
    try {
      const partialTables = V65_TABLES.filter(
        (tableName) =>
          tableName !== "block_mutations" && tableExists(database, tableName),
      ).length;
      return {
        rejected,
        versionAfterFailure: database.pragma("user_version", {
          simple: true,
        }) as number,
        partialTables,
      };
    } finally {
      database.close();
    }
  });

const main = async (): Promise<void> => {
  const migration = await runMigrationProbe();
  invariant(
    migration.migratedToVersion === CURRENT_SCHEMA_VERSION &&
      migration.idempotentRowRetained,
    "v65 migration/idempotency probe failed",
  );
  const contracts = await runContractProbe();
  invariant(
    Object.values(contracts).every(Boolean),
    "v65 authority/freshness contract probe failed",
  );
  const rollback = await runRollbackProbe();
  invariant(
    rollback.rejected &&
      rollback.versionAfterFailure === 64 &&
      rollback.partialTables === 0,
    "v65 rollback probe failed",
  );
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      migration,
      contracts,
      rollback,
    })}\n`,
  );
};

void main();
