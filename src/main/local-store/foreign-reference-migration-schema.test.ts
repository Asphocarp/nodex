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

const withTempStore = async (
  run: (databasePath: string) => Promise<void>,
): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-foreign-reference-migration-"),
  );
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

interface LedgerFixture {
  readonly projectId: string;
  readonly hostBlockId: string;
  readonly hostDocumentId: string;
  readonly sourceBlockIds: readonly string[];
  readonly targetBlockId: string;
  readonly databaseViewId: string;
  readonly crossProjectTargetBlockId: string;
  readonly crossProjectDatabaseViewId: string;
}

const seedLedgerFixture = (database: Database.Database): LedgerFixture => {
  const project = database
    .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
    .get() as { id: string };
  const databaseView = database
    .prepare(
      "SELECT id FROM database_views WHERE project_id = ? AND is_primary = 1",
    )
    .get(project.id) as { id: string };
  const now = new Date().toISOString();
  const hostBlockId = "foreign-reference-host";
  const hostDocumentId = `document:${hostBlockId}`;
  const targetBlockId = "foreign-reference-target";
  const crossProjectId = "foreign-reference-cross-project";
  const crossProjectTargetBlockId = "foreign-reference-cross-target";
  const crossProjectDatabaseBlockId = `database:${crossProjectId}:primary`;
  const crossProjectDatabaseViewId = `database-view:${crossProjectId}:primary-kanban`;
  const sourceBlockIds = [
    "legacy-card-reference-a",
    "legacy-card-reference-b",
    "legacy-database-query",
    "legacy-cross-project-reference",
    "legacy-cross-project-card-reference",
    "legacy-cross-project-database-query",
  ] as const;
  const insertBlock = database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, 1, 1, ?, ?)
  `);

  const insertCard = database.prepare(`
    INSERT INTO cards (id, project_id, status, title, created, "order")
    VALUES (?, ?, 'in_progress', ?, ?, ?)
  `);
  insertCard.run(hostBlockId, project.id, "Host", now, 0);
  insertCard.run(targetBlockId, project.id, "Target", now, 1);
  database
    .prepare(
      `
      UPDATE documents
      SET readiness = 'ready', authority = 'ydoc_primary'
      WHERE id = ?
    `,
    )
    .run(hostDocumentId);
  for (const sourceBlockId of sourceBlockIds) {
    insertBlock.run(
      sourceBlockId,
      project.id,
      "paragraph",
      "document",
      hostDocumentId,
      now,
      now,
    );
  }

  database
    .prepare(
      `
      INSERT INTO projects (id, name, description, icon, created, updated)
      VALUES (?, 'Cross project', '', '', ?, ?)
    `,
    )
    .run(crossProjectId, now, now);
  insertBlock.run(
    crossProjectTargetBlockId,
    crossProjectId,
    "card",
    "space",
    null,
    now,
    now,
  );
  insertBlock.run(
    crossProjectDatabaseBlockId,
    crossProjectId,
    "database",
    "space",
    null,
    now,
    now,
  );
  database
    .prepare(
      `
      INSERT INTO database_capabilities (
        block_id, project_id, is_primary, schema_key, created_at, updated_at
      ) VALUES (?, ?, 1, 'nodex.database', ?, ?)
    `,
    )
    .run(crossProjectDatabaseBlockId, crossProjectId, now, now);
  database
    .prepare(
      `
      INSERT INTO database_views (
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, created_at, updated_at
      ) VALUES (?, ?, ?, 'Cross view', 'list', '{}', 1, ?, ?)
    `,
    )
    .run(
      crossProjectDatabaseViewId,
      crossProjectDatabaseBlockId,
      crossProjectId,
      now,
      now,
    );

  return {
    projectId: project.id,
    hostBlockId,
    hostDocumentId,
    sourceBlockIds,
    targetBlockId,
    databaseViewId: databaseView.id,
    crossProjectTargetBlockId,
    crossProjectDatabaseViewId,
  };
};

const insertLedgerRow = (
  database: Database.Database,
  fixture: LedgerFixture,
  input: {
    readonly sourceBlockId: string;
    readonly legacyKind: "card_ref" | "card_toggle" | "database_query";
    readonly legacyTargetBlockId?: string;
    readonly sourceFingerprint?: string;
    readonly targetBlockId?: string;
    readonly databaseViewId?: string;
    readonly recoveredCardId?: string;
    readonly status?: "pending" | "applying" | "applied" | "failed";
    readonly attemptCount?: number;
    readonly lastError?: string;
  },
): void => {
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO foreign_reference_migrations (
        source_block_id, host_document_id, host_block_id, project_id,
        legacy_kind, legacy_target_block_id, source_fingerprint, target_block_id,
        database_view_id, recovered_card_id,
        status, attempt_count, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.sourceBlockId,
      fixture.hostDocumentId,
      fixture.hostBlockId,
      fixture.projectId,
      input.legacyKind,
      input.legacyTargetBlockId ?? null,
      input.sourceFingerprint ?? "0".repeat(64),
      input.targetBlockId ?? null,
      input.databaseViewId ?? null,
      input.recoveredCardId ?? null,
      input.status ?? "pending",
      input.attemptCount ?? 0,
      input.lastError ?? null,
      now,
      now,
    );
};

const rejectsSql = (run: () => void): boolean => {
  try {
    run();
    return false;
  } catch {
    return true;
  }
};

describe("foreign reference migration ledger schema", () => {
  sqliteTest(
    "migrates v62 idempotently and preserves a resumable ledger without rebuilding Documents",
    async () => {
      await withTempStore(async (databasePath) => {
        const legacy = new Database(databasePath);
        legacy.pragma("foreign_keys = ON");
        const fixture = seedLedgerFixture(legacy);
        const nfm = `<card-ref project="${fixture.projectId}" card="${fixture.targetBlockId}" />`;
        legacy
          .prepare(
            `
            INSERT INTO document_materializations (
              document_id, generation, projected_seq, schema_version, title,
              nfm, plain_text, preview, block_tree_json, references_json,
              asset_refs_json, updated_at
            ) VALUES (?, 1, 0, 1, 'Host', ?, '', '', ?, ?, '[]', ?)
          `,
          )
          .run(
            fixture.hostDocumentId,
            nfm,
            JSON.stringify([
              {
                id: fixture.sourceBlockIds[0],
                type: "cardRef",
                props: {},
                children: [],
              },
            ]),
            JSON.stringify([
              {
                kind: "block",
                sourceBlockId: fixture.sourceBlockIds[0],
                targetBlockId: fixture.targetBlockId,
              },
            ]),
            new Date().toISOString(),
          );
        const beforeRetry = legacy
          .prepare(
            "SELECT COUNT(*) AS count FROM documents WHERE project_id = ?",
          )
          .get(fixture.projectId) as { count: number };
        legacy.exec(`
          DROP TABLE foreign_reference_migrations;
          PRAGMA user_version = 62;
        `);
        legacy.close();

        await initializeDatabase();
        closeDatabase();

        const migrated = new Database(databasePath);
        migrated.pragma("foreign_keys = ON");
        const recalculatedReferences = migrated
          .prepare(
            `
            SELECT references_json
            FROM document_materializations
            WHERE document_id = ?
          `,
          )
          .get(fixture.hostDocumentId) as { references_json: string };
        expect(
          (
            JSON.parse(recalculatedReferences.references_json) as Array<{
              kind: string;
            }>
          )[0]?.kind,
        ).toBe("legacy_card_projection");
        insertLedgerRow(migrated, fixture, {
          sourceBlockId: fixture.sourceBlockIds[0],
          legacyKind: "card_ref",
          targetBlockId: fixture.targetBlockId,
          status: "applying",
          attemptCount: 1,
        });
        migrated.pragma("user_version = 62");
        migrated.close();

        await initializeDatabase();
        closeDatabase();

        const retried = new Database(databasePath, { readonly: true });
        try {
          expect(
            retried.pragma("user_version", { simple: true }) as number,
          ).toBe(CURRENT_SCHEMA_VERSION);
          const row = retried
            .prepare(
              `
              SELECT status, attempt_count, target_block_id
              FROM foreign_reference_migrations
              WHERE source_block_id = ?
            `,
            )
            .get(fixture.sourceBlockIds[0]) as {
            status: string;
            attempt_count: number;
            target_block_id: string;
          };
          expect(row.status).toBe("applying");
          expect(row.attempt_count).toBe(1);
          expect(row.target_block_id).toBe(fixture.targetBlockId);
          const afterRetry = retried
            .prepare(
              "SELECT COUNT(*) AS count FROM documents WHERE project_id = ?",
            )
            .get(fixture.projectId) as { count: number };
          expect(afterRetry.count).toBe(beforeRetry.count);
          expect(
            (retried.pragma("foreign_key_check") as unknown[]).length,
          ).toBe(0);
        } finally {
          retried.close();
        }
      });
    },
  );

  sqliteTest(
    "enforces migration scope, target kind, terminal state, and recovery ownership",
    async () => {
      await withTempStore(async (databasePath) => {
        const database = new Database(databasePath);
        database.pragma("foreign_keys = ON");
        try {
          const fixture = seedLedgerFixture(database);
          insertLedgerRow(database, fixture, {
            sourceBlockId: fixture.sourceBlockIds[0],
            legacyKind: "card_toggle",
            targetBlockId: fixture.targetBlockId,
            recoveredCardId: fixture.targetBlockId,
            status: "applied",
            attemptCount: 1,
          });
          insertLedgerRow(database, fixture, {
            sourceBlockId: fixture.sourceBlockIds[2],
            legacyKind: "database_query",
            databaseViewId: fixture.databaseViewId,
            status: "applied",
            attemptCount: 1,
          });
          insertLedgerRow(database, fixture, {
            sourceBlockId: fixture.sourceBlockIds[1],
            legacyKind: "card_ref",
            targetBlockId: "missing-card-that-may-have-been-garbage-collected",
            status: "applied",
            attemptCount: 1,
          });
          insertLedgerRow(database, fixture, {
            sourceBlockId: fixture.sourceBlockIds[4],
            legacyKind: "card_ref",
            targetBlockId: fixture.crossProjectTargetBlockId,
            status: "applied",
            attemptCount: 1,
          });
          insertLedgerRow(database, fixture, {
            sourceBlockId: fixture.sourceBlockIds[5],
            legacyKind: "database_query",
            databaseViewId: fixture.crossProjectDatabaseViewId,
            status: "applied",
            attemptCount: 1,
          });

          expect(
            rejectsSql(() =>
              insertLedgerRow(database, fixture, {
                sourceBlockId: fixture.sourceBlockIds[3],
                legacyKind: "card_ref",
                status: "applied",
                attemptCount: 1,
              }),
            ),
          ).toBeTrue();
          expect(
            rejectsSql(() =>
              insertLedgerRow(database, fixture, {
                sourceBlockId: fixture.sourceBlockIds[3],
                legacyKind: "database_query",
                targetBlockId: fixture.targetBlockId,
              }),
            ),
          ).toBeTrue();
          expect(
            rejectsSql(() =>
              insertLedgerRow(database, fixture, {
                sourceBlockId: fixture.sourceBlockIds[3],
                legacyKind: "card_ref",
                targetBlockId: fixture.targetBlockId,
                recoveredCardId: fixture.targetBlockId,
                status: "applying",
                attemptCount: 1,
              }),
            ),
          ).toBeTrue();
          expect(
            rejectsSql(() =>
              insertLedgerRow(database, fixture, {
                sourceBlockId: fixture.sourceBlockIds[3],
                legacyKind: "card_ref",
                targetBlockId: fixture.targetBlockId,
                status: "failed",
                attemptCount: 1,
              }),
            ),
          ).toBeTrue();

          database
            .prepare(
              `
          UPDATE blocks
          SET containing_document_id = NULL, location_kind = 'space'
          WHERE id = ?
        `,
            )
            .run(fixture.sourceBlockIds[3]);
          expect(
            rejectsSql(() =>
              insertLedgerRow(database, fixture, {
                sourceBlockId: fixture.sourceBlockIds[3],
                legacyKind: "card_ref",
              }),
            ),
          ).toBeTrue();
          expect(
            (database.pragma("foreign_key_check") as unknown[]).length,
          ).toBe(0);
        } finally {
          database.close();
        }
      });
    },
  );

  sqliteTest(
    "rolls back v63 DDL when an incompatible ledger blocks migration",
    async () => {
      await withTempStore(async (databasePath) => {
        const legacy = new Database(databasePath);
        legacy.exec(`
        DROP TABLE foreign_reference_migrations;
        DROP INDEX idx_block_documents_owner_document_project;
        CREATE TABLE foreign_reference_migrations (
          source_block_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
        PRAGMA user_version = 62;
      `);
        legacy.close();

        let rejected = false;
        try {
          await initializeDatabase();
        } catch (error) {
          rejected = (error as Error).message.includes("status");
        }
        closeDatabase();
        expect(rejected).toBeTrue();

        const rolledBack = new Database(databasePath, { readonly: true });
        try {
          expect(
            rolledBack.pragma("user_version", { simple: true }) as number,
          ).toBe(62);
          const columns = rolledBack
            .prepare("PRAGMA table_info(foreign_reference_migrations)")
            .all() as Array<{ name: string }>;
          expect(JSON.stringify(columns.map((column) => column.name))).toBe(
            '["source_block_id"]',
          );
          const ownerIndex = rolledBack
            .prepare(
              `
            SELECT 1
            FROM sqlite_master
            WHERE type = 'index'
              AND name = 'idx_block_documents_owner_document_project'
          `,
            )
            .get();
          expect(ownerIndex === undefined).toBeTrue();
        } finally {
          rolledBack.close();
        }
      });
    },
  );
});
