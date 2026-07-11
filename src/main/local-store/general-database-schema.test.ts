import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseGeneralDatabaseViewConfig } from "../../shared/database-kernel";
import {
  createLegacyInlineDatabaseViewConfig,
  evaluateDatabaseViewRows,
} from "../../shared/database-views";
import { getDatabasePath } from "./config";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { queryGeneralDatabaseView } from "./database-query";
import { readDatabaseView } from "./database-views";
import { createProject } from "./projects";
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

const withStore = async (
  prefix: string,
  run: (databasePath: string) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    closeDatabase();
    await run(getDatabasePath());
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previous;
    }
  }
};

const columns = (database: Database.Database, tableName: string): string[] =>
  (
    database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      readonly name: string;
    }>
  ).map((column) => column.name);

const downgradeToV66 = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  database.pragma("legacy_alter_table = ON");
  try {
    database.exec(`
      DROP INDEX IF EXISTS idx_database_views_primary;
      ALTER TABLE database_capabilities DROP COLUMN name;
      ALTER TABLE database_capabilities DROP COLUMN schema_revision;
      ALTER TABLE database_memberships DROP COLUMN revision;
      ALTER TABLE database_views RENAME TO database_views_v67_fixture;
      CREATE TABLE database_views (
        id TEXT PRIMARY KEY,
        database_block_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (id, project_id),
        FOREIGN KEY (database_block_id, project_id)
          REFERENCES database_capabilities(block_id, project_id) ON DELETE CASCADE,
        CHECK (kind IN ('kanban', 'list', 'calendar', 'canvas'))
      ) WITHOUT ROWID;
      INSERT INTO database_views (
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, created_at, updated_at
      )
      SELECT
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, created_at, updated_at
      FROM database_views_v67_fixture;
      DROP TABLE database_views_v67_fixture;
      ALTER TABLE database_view_positions DROP COLUMN revision;
      CREATE UNIQUE INDEX idx_database_views_primary
        ON database_views(database_block_id)
        WHERE is_primary = 1;
      PRAGMA user_version = 66;
    `);
  } finally {
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
  }
};

const schemaHasTemporaryReference = (database: Database.Database): boolean =>
  database
    .prepare(
      `
      SELECT 1 FROM sqlite_schema
      WHERE lower(sql) LIKE '%database_properties_v66%'
         OR lower(sql) LIKE '%database_property_values_v66%'
      LIMIT 1
    `,
    )
    .get() !== undefined;

describe("general Database schema v67", () => {
  sqliteTest("creates the complete fresh authority schema", async () => {
    await withStore("nodex-database-schema-fresh-", (databasePath) => {
      const database = new Database(databasePath);
      try {
        expect(
          database.pragma("user_version", { simple: true }) as number,
        ).toBe(CURRENT_SCHEMA_VERSION);
        expect(
          columns(database, "database_capabilities").includes(
            "schema_revision",
          ),
        ).toBe(true);
        expect(
          columns(database, "database_memberships").includes("revision"),
        ).toBe(true);
        expect(
          columns(database, "database_views").includes("lifecycle"),
        ).toBe(true);
        expect(
          columns(database, "database_view_positions").includes("revision"),
        ).toBe(true);
        const propertySql = database
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'database_properties'",
          )
          .get() as { readonly sql: string };
        expect(
          propertySql.sql.includes("'text', 'number', 'checkbox'"),
        ).toBe(true);
        expect(JSON.stringify(database.pragma("foreign_key_check"))).toBe("[]");
        expect(
          (
            database.pragma("integrity_check") as Array<{
              integrity_check: string;
            }>
          )[0]?.integrity_check,
        ).toBe("ok");
        const primary = database
          .prepare(
            `
            SELECT view.config_json, view.rank_key, placement.rank_key AS placement_rank
            FROM database_views view
            INNER JOIN database_capabilities capability
              ON capability.block_id = view.database_block_id
             AND capability.is_primary = 1
            INNER JOIN top_level_block_placements placement
              ON placement.block_id = capability.block_id
            WHERE view.is_primary = 1 AND view.lifecycle = 'active'
            LIMIT 1
          `,
          )
          .get() as {
          readonly config_json: string;
          readonly rank_key: string;
          readonly placement_rank: string;
        };
        const config = parseGeneralDatabaseViewConfig(
          JSON.parse(primary.config_json),
        );
        expect(
          config.group?.propertyId.endsWith(":property:status") ?? false,
        ).toBe(true);
        expect(/^[0-9a-f]{32}$/.test(primary.rank_key)).toBe(true);
        expect(/^[0-9a-f]{32}$/.test(primary.placement_rank)).toBe(true);
      } finally {
        database.close();
      }
    });
  });

  sqliteTest(
    "creates strict primary Database authority for a post-v67 Project",
    async () => {
      await withStore("nodex-database-schema-project-", async () => {
        await initializeDatabase();
        const project = createProject({ name: "After v67" });
        const database = getDb();
        const row = database
          .prepare(
            `
          SELECT
            capability.schema_revision, view.config_json, view.rank_key,
            placement.rank_key AS placement_rank,
            status_property.rank_key AS status_rank
          FROM database_capabilities capability
          INNER JOIN database_views view
            ON view.database_block_id = capability.block_id
           AND view.is_primary = 1 AND view.lifecycle = 'active'
          INNER JOIN top_level_block_placements placement
            ON placement.block_id = capability.block_id
          INNER JOIN database_properties status_property
            ON status_property.database_block_id = capability.block_id
           AND status_property.key = 'status'
           AND status_property.lifecycle = 'active'
          WHERE capability.project_id = ? AND capability.is_primary = 1
        `,
          )
          .get(project.id) as {
          readonly schema_revision: number;
          readonly config_json: string;
          readonly rank_key: string;
          readonly placement_rank: string;
          readonly status_rank: string;
        };
        const config = parseGeneralDatabaseViewConfig(
          JSON.parse(row.config_json),
        );
        expect(row.schema_revision).toBe(1);
        expect(config.group?.propertyId).toBe(
          `database:${project.id}:primary:property:status`,
        );
        expect(
          [row.rank_key, row.placement_rank, row.status_rank].every((rank) =>
            /^[0-9a-f]{32}$/.test(rank),
          ),
        ).toBe(true);
        closeDatabase();
      });
    },
  );

  sqliteTest(
    "migrates v66 atomically without stale temporary schema references",
    async () => {
      await withStore(
        "nodex-database-schema-migrate-",
        async (databasePath) => {
          await initializeDatabase();
          const taggedProject = createProject({ name: "Legacy tags" });
          const taggedCard = await createCard(taggedProject.id, "draft", {
            title: "Tagged before v67",
          });
          closeDatabase();
          const legacy = new Database(databasePath);
          const owner = legacy
            .prepare(
              `
              SELECT block_id, project_id
              FROM database_capabilities
              WHERE is_primary = 1
              LIMIT 1
            `,
            )
            .get() as {
            readonly block_id: string;
            readonly project_id: string;
          };
          const legacyConfigJson = JSON.stringify(
            createLegacyInlineDatabaseViewConfig({
              sourceBlockId: "legacy-inline-source",
              props: {
                sourceProjectId: owner.project_id,
                propertyOrderCsv: "status,title",
                hiddenPropertiesCsv: "estimate",
              },
            }),
          );
          const legacyConfigFingerprint = createHash("sha256")
            .update(legacyConfigJson)
            .digest("hex");
          const now = new Date().toISOString();
          legacy
            .prepare(
              `
              INSERT INTO database_views (
                id, database_block_id, project_id, name, kind, config_json,
                is_primary, revision, rank_key, lifecycle, created_at, updated_at
              ) VALUES (
                'legacy-inline-view', ?, ?, 'Legacy inline', 'list', ?,
                0, 1, 'legacy-inline-rank', 'active', ?, ?
              )
            `,
            )
            .run(owner.block_id, owner.project_id, legacyConfigJson, now, now);
          downgradeToV66(legacy);
          legacy
            .prepare(
              `
              INSERT INTO database_property_values (
                membership_id, property_id, database_block_id, project_id,
                value_type, value_json, revision, updated_at
              ) SELECT
                membership.id, ?, membership.database_block_id,
                membership.project_id, 'multi_select', '["zeta","alpha"]',
                1, ?
              FROM database_memberships membership
              WHERE membership.card_block_id = ? AND membership.removed_at IS NULL
              ON CONFLICT(membership_id, property_id) DO UPDATE SET
                value_json = excluded.value_json,
                revision = database_property_values.revision + 1,
                updated_at = excluded.updated_at
            `,
            )
            .run(
              `database:${taggedProject.id}:primary:property:tags`,
              now,
              taggedCard.id,
            );
          legacy.close();

          await initializeDatabase();
          closeDatabase();
          const migrated = new Database(databasePath);
          try {
            expect(
              migrated.pragma("user_version", { simple: true }) as number,
            ).toBe(CURRENT_SCHEMA_VERSION);
            expect(schemaHasTemporaryReference(migrated)).toBe(false);
            expect(JSON.stringify(migrated.pragma("foreign_key_check"))).toBe(
              "[]",
            );
            expect(
              (
                migrated.pragma("integrity_check") as Array<{
                  integrity_check: string;
                }>
              )[0]?.integrity_check,
            ).toBe("ok");
            const ranks = migrated
              .prepare(
                `SELECT rank_key FROM database_views ORDER BY database_block_id, rank_key, id`,
              )
              .all() as Array<{ readonly rank_key: string }>;
            expect(
              ranks.every((row) => /^[0-9a-f]{32}$/.test(row.rank_key)),
            ).toBe(true);
            const primaryConfig = migrated
              .prepare(
                `
            SELECT view.config_json
            FROM database_views view
            INNER JOIN database_capabilities capability
              ON capability.block_id = view.database_block_id
             AND capability.project_id = view.project_id
            WHERE capability.is_primary = 1
              AND view.is_primary = 1
              AND view.lifecycle = 'active'
            LIMIT 1
          `,
              )
              .get() as { readonly config_json: string };
            expect(
              parseGeneralDatabaseViewConfig(
                JSON.parse(primaryConfig.config_json),
              ).group?.propertyId.endsWith(":property:status") ?? false,
            ).toBe(true);
            const migratedTags = migrated
              .prepare(
                `
                SELECT config_json
                FROM database_properties
                WHERE id = ?
              `,
              )
              .get(`database:${taggedProject.id}:primary:property:tags`) as {
              readonly config_json: string;
            };
            const tagsConfig = JSON.parse(migratedTags.config_json) as {
              readonly options: readonly { readonly id: string }[];
            };
            expect(
              tagsConfig.options.map((option) => option.id).join(","),
            ).toBe("alpha,zeta");
            const preservedLegacy = migrated
              .prepare(
                "SELECT config_json FROM database_views WHERE id = 'legacy-inline-view'",
              )
              .get() as { readonly config_json: string };
            expect(preservedLegacy.config_json).toBe(legacyConfigJson);
            expect(
              createHash("sha256")
                .update(preservedLegacy.config_json)
                .digest("hex"),
            ).toBe(legacyConfigFingerprint);
            const legacyReadModel = readDatabaseView(
              owner.project_id,
              "legacy-inline-view",
              migrated,
            );
            expect(legacyReadModel?.view.config.schemaKey).toBe(
              "nodex.database-view/legacy-inline",
            );
            expect(
              legacyReadModel
                ? evaluateDatabaseViewRows(legacyReadModel).length
                : -1,
            ).toBe(0);
            let genericQueryFailed = false;
            try {
              queryGeneralDatabaseView(
                owner.project_id,
                "legacy-inline-view",
                migrated,
              );
            } catch {
              genericQueryFailed = true;
            }
            expect(genericQueryFailed).toBe(true);
          } finally {
            migrated.close();
          }
        },
      );
    },
  );

  sqliteTest(
    "rolls back every v67 DDL change when the invariant audit fails",
    async () => {
      await withStore(
        "nodex-database-schema-rollback-",
        async (databasePath) => {
          const legacy = new Database(databasePath);
          downgradeToV66(legacy);
          const project = legacy
            .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
            .get() as { readonly id: string };
          const now = new Date().toISOString();
          legacy
            .prepare(
              `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES ('database-without-view', ?, 'database', 'active', 'space',
            NULL, 1, 1, ?, ?)
        `,
            )
            .run(project.id, now, now);
          legacy
            .prepare(
              `
          INSERT INTO database_capabilities (
            block_id, project_id, is_primary, schema_key, created_at, updated_at
          ) VALUES ('database-without-view', ?, 0, 'nodex.database', ?, ?)
        `,
            )
            .run(project.id, now, now);
          legacy.close();

          let failed = false;
          try {
            await initializeDatabase();
          } catch {
            failed = true;
          }
          closeDatabase();
          expect(failed).toBe(true);
          const rolledBack = new Database(databasePath);
          try {
            expect(
              rolledBack.pragma("user_version", { simple: true }) as number,
            ).toBe(66);
            expect(
              columns(rolledBack, "database_capabilities").includes("name"),
            ).toBe(false);
            expect(
              columns(rolledBack, "database_views").includes("lifecycle"),
            ).toBe(false);
            expect(schemaHasTemporaryReference(rolledBack)).toBe(false);
            expect(
              (
                rolledBack.pragma("integrity_check") as Array<{
                  integrity_check: string;
                }>
              )[0]?.integrity_check,
            ).toBe("ok");
          } finally {
            rolledBack.close();
          }
        },
      );
    },
  );
});
