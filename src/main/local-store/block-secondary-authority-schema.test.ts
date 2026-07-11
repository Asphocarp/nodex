import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { closeDatabase, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { createProject } from "./projects";
import { CURRENT_SCHEMA_VERSION } from "./schema";

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

const operationFails = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

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

describe("Block secondary authority schema", () => {
  sqliteTest("migrates v64 to v65 atomically and remains idempotent", async () => {
    await withTempStore("nodex-secondary-schema-", async (databasePath) => {
      const legacy = new Database(databasePath);
      const project = legacy
        .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
        .get() as { id: string };
      const store = legacy
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { store_epoch: string };
      dropV65Schema(legacy);
      legacy.close();

      await initializeDatabase();
      closeDatabase();

      const migrated = new Database(databasePath);
      try {
        expect(
          migrated.pragma("user_version", { simple: true }) as number,
        ).toBe(CURRENT_SCHEMA_VERSION);
        expect(
          V65_TABLES.every((tableName) => hasTable(migrated, tableName)),
        ).toBeTrue();
        expect(JSON.stringify(migrated.pragma("foreign_key_check"))).toBe("[]");

        migrated
          .prepare(
            `
            INSERT INTO block_mutations (
              mutation_id, project_id, store_epoch, mutation_kind,
              request_hash, request_json, field_intents_json, outcome,
              result_json, recorded_at
            ) VALUES (?, ?, ?, 'schema_probe', ?, '{}', '[]', 'rejected', ?, ?)
          `,
          )
          .run(
            "schema-probe-rejection",
            project.id,
            store.store_epoch,
            HASH_A,
            JSON.stringify({ code: "probe_rejected" }),
            new Date().toISOString(),
          );
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
            SELECT outcome, result_json
            FROM block_mutations
            WHERE mutation_id = 'schema-probe-rejection'
          `,
          )
          .get() as { outcome: string; result_json: string } | undefined;
        expect(retained?.outcome).toBe("rejected");
        expect(retained?.result_json).toBe(
          JSON.stringify({ code: "probe_rejected" }),
        );
      } finally {
        reopened.close();
      }
    });
  });

  sqliteTest(
    "enforces immutable operation evidence and rebuild-safe projection freshness",
    async () => {
      await withTempStore(
        "nodex-secondary-contracts-",
        async (databasePath) => {
          process.env.NODEX_DIR = path.dirname(databasePath);
          await initializeDatabase();
          const project = createProject({ name: "Projection contracts" });
          const card = await createCard(project.id, "draft", {
            title: "Legacy sentinel",
          });
          closeDatabase();

          const database = new Database(databasePath);
          database.pragma("foreign_keys = ON");
          const documentId = `document:${card.id}`;
          const bodyBlockId = "01900000-0000-7000-8000-000000000065";
          const membershipId = `membership:${card.id}`;
          const databaseBlockId = `database:${project.id}:primary`;
          const viewId = `database-view:${project.id}:primary-kanban`;
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
                  version_id, document_id, project_id, generation,
                  base_head_seq, schema_key, schema_version, cause, label,
                  actor_json, full_update_blob, state_vector, checkpoint_hash,
                  byte_length, created_at
                ) VALUES (
                  'version-1', ?, ?, 1, 1, 'nodex.card', 1,
                  'manual_checkpoint', 'Before replacement', '{}', ?, X'01', ?, 3, ?
                )
              `,
              )
              .run(documentId, project.id, Buffer.from([1, 2, 3]), HASH_A, now);

            const change = database
              .prepare(
                `
                INSERT INTO change_log (
                  project_id, store_epoch, kind, operation_id,
                  block_ids_json, document_ids_json,
                  database_block_ids_json, payload_json, committed_at
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
            const mutationValues: Array<string | number> = [
              "mutation-1",
              project.id,
              store.store_epoch,
              HASH_A,
              JSON.stringify({ kind: "set_property", blockId: card.id }),
              JSON.stringify([card.id]),
              JSON.stringify([documentId]),
              JSON.stringify([databaseBlockId]),
              JSON.stringify([
                { path: "database.priority", operation: "set" },
              ]),
              JSON.stringify({ "database.priority": 1 }),
              JSON.stringify({ status: "updated" }),
              JSON.stringify({ "database.priority": 2 }),
              JSON.stringify({ [documentId]: { generation: 1, headSeq: 1 } }),
              Number(change.lastInsertRowid),
              now,
            ];
            const insertMutationSql = `
              INSERT INTO block_mutations (
                mutation_id, project_id, store_epoch, mutation_kind,
                request_hash, request_json, target_block_ids_json,
                affected_document_ids_json, affected_database_block_ids_json,
                field_intents_json, expected_revisions_json, outcome,
                result_json, committed_revisions_json, document_heads_json,
                change_log_seq, recorded_at
              ) VALUES (?, ?, ?, 'set_property', ?, ?, ?, ?, ?, ?, ?,
                'committed', ?, ?, ?, ?, ?)
            `;
            const insertMutation = database.prepare(insertMutationSql);
            insertMutation.run(...mutationValues);
            const duplicate = database
              .prepare(`${insertMutationSql} ON CONFLICT(mutation_id) DO NOTHING`)
              .run(...mutationValues);
            expect(duplicate.changes).toBe(0);

            database
              .prepare(
                `
                INSERT INTO block_search_units (
                  unit_key, project_id, block_id, owner_block_id, document_id,
                  document_generation, projected_seq, source_revision,
                  source_kind, field_key, text, text_hash, updated_at
                ) VALUES ('search-title', ?, ?, ?, ?, 1, 1, NULL,
                  'document_title', 'title', 'Canonical title', ?, ?)
              `,
              )
              .run(project.id, card.id, card.id, documentId, HASH_A, now);
            database
              .prepare(
                `
                INSERT INTO block_asset_refs (
                  document_id, block_id, owner_block_id, project_id,
                  document_generation, projected_seq, role, ordinal,
                  asset_uri, asset_hash, updated_at
                ) VALUES (?, ?, ?, ?, 1, 1, 'image', 0,
                  'nodex-asset://canonical.png', ?, ?)
              `,
              )
              .run(
                documentId,
                bodyBlockId,
                card.id,
                project.id,
                HASH_B,
                now,
              );
            database
              .prepare(
                `
                INSERT INTO card_read_model (
                  card_block_id, project_id, lifecycle, location_kind,
                  containing_document_id, top_level_rank_key,
                  location_revision, metadata_revision, document_id,
                  document_generation, document_projected_seq,
                  document_schema_version, document_authority,
                  membership_id, database_block_id, view_id,
                  view_group_key, view_rank_key, title, description_preview,
                  description_length, has_description, database_values_json,
                  intrinsic_properties_json, property_revisions_json,
                  created_at, updated_at
                ) VALUES (?, ?, 'active', 'space', NULL, 'rank-1', 1, 1,
                  ?, 1, 1, 1, 'legacy_shadow', ?, ?, ?, 'draft', 'rank-1',
                  'Canonical title', 'Canonical body', 14, 1,
                  '{"status":"draft"}', '{}', '{"status":1}', ?, ?)
              `,
              )
              .run(
                card.id,
                project.id,
                documentId,
                membershipId,
                databaseBlockId,
                viewId,
                now,
                now,
              );

            const ftsHit = database
              .prepare(
                `
                SELECT unit.block_id
                FROM block_search_units_fts fts
                INNER JOIN block_search_units unit ON unit.rowid = fts.rowid
                WHERE block_search_units_fts MATCH 'canonical'
              `,
              )
              .get() as { block_id: string } | undefined;
            expect(ftsHit?.block_id).toBe(card.id);
            const authorities = database
              .prepare(
                `
                SELECT card.title AS legacy_title, read_model.title AS projected_title
                FROM cards card
                INNER JOIN card_read_model read_model
                  ON read_model.card_block_id = card.id
                WHERE card.id = ?
              `,
              )
              .get(card.id) as {
              legacy_title: string;
              projected_title: string;
            };
            expect(authorities.legacy_title).toBe("Legacy sentinel");
            expect(authorities.projected_title).toBe("Canonical title");

            expect(
              operationFails(() => {
                database
                  .prepare(
                    "UPDATE document_versions SET label = 'mutated' WHERE version_id = 'version-1'",
                  )
                  .run();
              }),
            ).toBeTrue();
            expect(
              operationFails(() => {
                database
                  .prepare(
                    "UPDATE block_mutations SET result_json = '{}' WHERE mutation_id = 'mutation-1'",
                  )
                  .run();
              }),
            ).toBeTrue();
            expect(
              operationFails(() => {
                database
                  .prepare(
                    `${insertMutationSql} ON CONFLICT(mutation_id) DO NOTHING`,
                  )
                  .run(
                    ...mutationValues.slice(0, 3),
                    HASH_B,
                    ...mutationValues.slice(4),
                  );
              }),
            ).toBeTrue();
            expect(
              operationFails(() => {
                database
                  .prepare(
                    `
                    INSERT INTO block_search_units (
                      unit_key, project_id, block_id, owner_block_id,
                      document_id, document_generation, projected_seq,
                      source_kind, field_key, text, text_hash, updated_at
                    ) VALUES ('future-search', ?, ?, ?, ?, 1, 2,
                      'document_title', 'future', 'Future', ?, ?)
                  `,
                  )
                  .run(
                    project.id,
                    card.id,
                    card.id,
                    documentId,
                    HASH_A,
                    now,
                  );
              }),
            ).toBeTrue();
            expect(
              operationFails(() => {
                database
                  .prepare(
                    "UPDATE card_read_model SET document_projected_seq = 2 WHERE card_block_id = ?",
                  )
                  .run(card.id);
              }),
            ).toBeTrue();
            expect(
              operationFails(() => {
                database
                  .prepare(
                    `
                    INSERT INTO block_asset_refs (
                      document_id, block_id, owner_block_id, project_id,
                      document_generation, projected_seq, role, ordinal,
                      asset_uri, updated_at
                    ) VALUES (?, ?, ?, ?, 1, 2, 'image', 1, 'future.png', ?)
                  `,
                  )
                  .run(documentId, bodyBlockId, card.id, project.id, now);
              }),
            ).toBeTrue();
            expect(JSON.stringify(database.pragma("foreign_key_check"))).toBe(
              "[]",
            );
          } finally {
            database.close();
          }
        },
      );
    },
  );

  sqliteTest("rolls every v65 DDL statement back on an incompatible table", async () => {
    await withTempStore(
      "nodex-secondary-schema-rollback-",
      async (databasePath) => {
        const legacy = new Database(databasePath);
        dropV65Schema(legacy);
        legacy.exec("CREATE TABLE block_mutations (mutation_id TEXT PRIMARY KEY)");
        legacy.close();

        let rejected = false;
        try {
          await initializeDatabase();
        } catch {
          rejected = true;
        } finally {
          closeDatabase();
        }
        expect(rejected).toBeTrue();

        const unchanged = new Database(databasePath, { readonly: true });
        try {
          expect(
            unchanged.pragma("user_version", { simple: true }) as number,
          ).toBe(64);
          expect(hasTable(unchanged, "block_mutations")).toBeTrue();
          expect(hasTable(unchanged, "document_versions")).toBeFalse();
          expect(hasTable(unchanged, "block_search_units")).toBeFalse();
          expect(hasTable(unchanged, "block_asset_refs")).toBeFalse();
          expect(hasTable(unchanged, "card_read_model")).toBeFalse();
          const columns = unchanged
            .prepare("PRAGMA table_info(block_mutations)")
            .all() as Array<{ name: string }>;
          expect(columns.map((column) => column.name).join(",")).toBe(
            "mutation_id",
          );
        } finally {
          unchanged.close();
        }
      },
    );
  });
});
