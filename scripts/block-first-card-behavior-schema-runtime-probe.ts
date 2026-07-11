import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { getDatabasePath } from "../src/main/local-store/config";
import { CURRENT_SCHEMA_VERSION } from "../src/main/local-store/schema";

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

interface BehaviorFixture {
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly cardId: string;
  readonly cascadeCardId: string;
  readonly nonCardBlockId: string;
}

const insertLegacyCard = (
  database: Database.Database,
  projectId: string,
  cardId: string,
  order: number,
): void => {
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO cards (
        id, project_id, status, title, created, "order"
      ) VALUES (?, ?, 'draft', ?, ?, ?)
    `,
    )
    .run(cardId, projectId, cardId, now, order);
};

const seedBehaviorFixture = (database: Database.Database): BehaviorFixture => {
  const project = database
    .prepare("SELECT id FROM projects ORDER BY created ASC LIMIT 1")
    .get() as { readonly id: string };
  const now = new Date().toISOString();
  const otherProjectId = "behavior-project-other";
  database
    .prepare(
      `
      INSERT INTO projects (id, name, description, icon, created, updated)
      VALUES (?, 'Other behavior Project', '', '', ?, ?)
    `,
    )
    .run(otherProjectId, now, now);

  const cardId = "behavior-card";
  insertLegacyCard(database, project.id, cardId, 1);
  const cascadeCardId = "behavior-card-cascade-owner";
  const nonCardBlockId = "behavior-not-a-card";
  const insertBareBlock = database.prepare(
    `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 'space', NULL, 1, 1, ?, ?)
    `,
  );
  insertBareBlock.run(cascadeCardId, project.id, "card", now, now);
  insertBareBlock.run(nonCardBlockId, project.id, "paragraph", now, now);

  return {
    projectId: project.id,
    otherProjectId,
    cardId,
    cascadeCardId,
    nonCardBlockId,
  };
};

const insertBehaviorRows = (
  database: Database.Database,
  fixture: BehaviorFixture,
): void => {
  database
    .prepare(
      `
      INSERT INTO recurrence_exceptions (
        id, project_id, card_id, occurrence_start, exception_type,
        override_start, override_end, override_reminders_json, created
      ) VALUES (101, ?, ?, '2026-08-01T09:00:00.000Z', 'override_time',
        '2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z',
        '[{"offsetMinutes":15}]', '2026-07-11T00:00:00.000Z')
    `,
    )
    .run(fixture.projectId, fixture.cardId);
  database
    .prepare(
      `
      INSERT INTO reminder_receipts (
        id, project_id, card_id, occurrence_start,
        reminder_offset_minutes, delivered_at
      ) VALUES (201, ?, ?, '2026-08-01T09:00:00.000Z', 15,
        '2026-08-01T08:45:00.000Z')
    `,
    )
    .run(fixture.projectId, fixture.cardId);
  database
    .prepare(
      `
      INSERT INTO reminder_snoozes (
        id, project_id, card_id, occurrence_start,
        due_at, created_at, consumed_at
      ) VALUES (301, ?, ?, '2026-08-01T09:00:00.000Z',
        '2026-08-01T08:55:00.000Z', '2026-08-01T08:45:00.000Z', NULL)
    `,
    )
    .run(fixture.projectId, fixture.cardId);
};

const dropCardBehaviorV66Contract = (database: Database.Database): void => {
  database.exec(`
    DROP TRIGGER IF EXISTS recurrence_exceptions_require_card_block_insert;
    DROP TRIGGER IF EXISTS recurrence_exceptions_require_card_block_update;
    DROP TRIGGER IF EXISTS reminder_receipts_require_card_block_insert;
    DROP TRIGGER IF EXISTS reminder_receipts_require_card_block_update;
    DROP TRIGGER IF EXISTS reminder_snoozes_require_card_block_insert;
    DROP TRIGGER IF EXISTS reminder_snoozes_require_card_block_update;
    DROP TRIGGER IF EXISTS scheduled_card_index_require_card_block_insert;
    DROP TRIGGER IF EXISTS scheduled_card_index_require_card_block_update;
    DROP TRIGGER IF EXISTS card_behavior_records_guard_block_retype;
  `);
};

const downgradeBehaviorTablesToV65 = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  try {
    dropCardBehaviorV66Contract(database);
    database.exec(`
      CREATE TABLE recurrence_exceptions_v65 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        occurrence_start TEXT NOT NULL,
        exception_type TEXT NOT NULL,
        override_start TEXT,
        override_end TEXT,
        override_reminders_json TEXT,
        created TEXT NOT NULL,
        CHECK (exception_type IN ('skip', 'override_time'))
      );
      INSERT INTO recurrence_exceptions_v65
        SELECT * FROM recurrence_exceptions;

      CREATE TABLE reminder_receipts_v65 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        occurrence_start TEXT NOT NULL,
        reminder_offset_minutes INTEGER NOT NULL,
        delivered_at TEXT NOT NULL
      );
      INSERT INTO reminder_receipts_v65
        SELECT * FROM reminder_receipts;

      CREATE TABLE reminder_snoozes_v65 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        occurrence_start TEXT NOT NULL,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT
      );
      INSERT INTO reminder_snoozes_v65
        SELECT * FROM reminder_snoozes;

      DROP TABLE recurrence_exceptions;
      DROP TABLE reminder_receipts;
      DROP TABLE reminder_snoozes;
      ALTER TABLE recurrence_exceptions_v65 RENAME TO recurrence_exceptions;
      ALTER TABLE reminder_receipts_v65 RENAME TO reminder_receipts;
      ALTER TABLE reminder_snoozes_v65 RENAME TO reminder_snoozes;

      CREATE UNIQUE INDEX idx_recurrence_exceptions_unique
        ON recurrence_exceptions(project_id, card_id, occurrence_start);
      CREATE INDEX idx_recurrence_exceptions_lookup
        ON recurrence_exceptions(project_id, card_id, occurrence_start);
      CREATE UNIQUE INDEX idx_reminder_receipts_unique
        ON reminder_receipts(
          project_id, card_id, occurrence_start, reminder_offset_minutes
        );
      CREATE INDEX idx_reminder_receipts_lookup
        ON reminder_receipts(project_id, delivered_at DESC);
      CREATE INDEX idx_reminder_snoozes_lookup
        ON reminder_snoozes(project_id, due_at, consumed_at);
      PRAGMA user_version = 65;
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
};

interface ForeignKeyRow {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string;
  readonly on_update: string;
  readonly on_delete: string;
}

const hasCompositeBlockForeignKey = (
  database: Database.Database,
  tableName: string,
): boolean => {
  const rows = database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as readonly ForeignKeyRow[];
  const blockRows = rows.filter((row) => row.table === "blocks");
  if (blockRows.length !== 2 || blockRows[0]?.id !== blockRows[1]?.id) {
    return false;
  }
  const mappings = new Map(blockRows.map((row) => [row.from, row.to]));
  return (
    mappings.get("card_id") === "id" &&
    mappings.get("project_id") === "project_id" &&
    blockRows.every(
      (row) => row.on_update === "CASCADE" && row.on_delete === "CASCADE",
    )
  );
};

const tableRowCount = (
  database: Database.Database,
  tableName: string,
): number =>
  (
    database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
      readonly count: number;
    }
  ).count;

const runFreshContractProbe = (): Promise<{
  readonly legacyDeleteRetained: boolean;
  readonly blockDeleteCascaded: boolean;
  readonly projectCascade: boolean;
  readonly dependencyRetypeGuard: boolean;
  readonly dependencyFreeRetype: boolean;
}> =>
  withTemporaryStore("nodex-card-behavior-fresh-", async () => {
    await initializeDatabase();
    closeDatabase();
    const database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    try {
      invariant(
        (database.pragma("user_version", { simple: true }) as number) ===
          CURRENT_SCHEMA_VERSION,
        "fresh store did not use the latest schema",
      );
      const fixture = seedBehaviorFixture(database);
      insertBehaviorRows(database, fixture);
      for (const tableName of [
        "recurrence_exceptions",
        "reminder_receipts",
        "reminder_snoozes",
      ]) {
        invariant(
          hasCompositeBlockForeignKey(database, tableName),
          `${tableName} does not use the composite Block owner FK`,
        );
      }

      invariant(
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO recurrence_exceptions (
                project_id, card_id, occurrence_start, exception_type, created
              ) VALUES (?, ?, '2026-09-01T00:00:00.000Z', 'skip', ?)
            `,
            )
            .run(
              fixture.projectId,
              fixture.nonCardBlockId,
              new Date().toISOString(),
            ),
        ),
        "a non-Card Block accepted a recurrence exception",
      );
      invariant(
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO reminder_receipts (
                project_id, card_id, occurrence_start,
                reminder_offset_minutes, delivered_at
              ) VALUES (?, ?, '2026-09-01T00:00:00.000Z', 5, ?)
            `,
            )
            .run(
              fixture.otherProjectId,
              fixture.cardId,
              new Date().toISOString(),
            ),
        ),
        "cross-Project Card behavior scope was accepted",
      );
      invariant(
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO reminder_snoozes (
                project_id, card_id, occurrence_start, due_at, created_at
              ) VALUES (?, 'missing-card', ?, ?, ?)
            `,
            )
            .run(
              fixture.projectId,
              "2026-09-01T00:00:00.000Z",
              "2026-09-01T00:05:00.000Z",
              new Date().toISOString(),
            ),
        ),
        "missing Card behavior owner was accepted",
      );
      invariant(
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO scheduled_card_index (
                card_block_id, project_id, lifecycle,
                source_metadata_revision, updated_at
              ) VALUES (?, ?, 'active', 1, ?)
            `,
            )
            .run(
              fixture.nonCardBlockId,
              fixture.projectId,
              new Date().toISOString(),
            ),
        ),
        "scheduled Card projection accepted a non-Card Block",
      );

      const dependencyRetypeGuard = operationFails(() =>
        database
          .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
          .run(fixture.cardId),
      );
      const dependencyFreeRetype = !operationFails(() =>
        database
          .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
          .run(fixture.cascadeCardId),
      );
      database
        .prepare("UPDATE blocks SET type = 'card' WHERE id = ?")
        .run(fixture.cascadeCardId);

      database.prepare("DELETE FROM cards WHERE id = ?").run(fixture.cardId);
      const legacyDeleteRetained = [
        "recurrence_exceptions",
        "reminder_receipts",
        "reminder_snoozes",
      ].every((tableName) => tableRowCount(database, tableName) === 1);
      for (const tableName of [
        "recurrence_exceptions",
        "reminder_receipts",
        "reminder_snoozes",
      ]) {
        database
          .prepare(`UPDATE ${tableName} SET card_id = ? WHERE card_id = ?`)
          .run(fixture.cascadeCardId, fixture.cardId);
      }
      database
        .prepare(
          `
          INSERT INTO scheduled_card_index (
            card_block_id, project_id, lifecycle,
            source_metadata_revision, updated_at
          ) VALUES (?, ?, 'active', 1, ?)
        `,
        )
        .run(
          fixture.cascadeCardId,
          fixture.projectId,
          new Date().toISOString(),
        );
      database
        .prepare("UPDATE blocks SET project_id = ? WHERE id = ?")
        .run(fixture.otherProjectId, fixture.cascadeCardId);
      const projectCascade =
        [
          "recurrence_exceptions",
          "reminder_receipts",
          "reminder_snoozes",
        ].every(
          (tableName) =>
            (
              database
                .prepare(
                  `SELECT project_id FROM ${tableName} WHERE card_id = ?`,
                )
                .get(fixture.cascadeCardId) as
                { readonly project_id: string } | undefined
            )?.project_id === fixture.otherProjectId,
        ) &&
        (
          database
            .prepare(
              `
              SELECT project_id FROM scheduled_card_index
              WHERE card_block_id = ?
            `,
            )
            .get(fixture.cascadeCardId) as
            { readonly project_id: string } | undefined
        )?.project_id === fixture.otherProjectId;
      database
        .prepare("DELETE FROM blocks WHERE id = ?")
        .run(fixture.cascadeCardId);
      const blockDeleteCascaded =
        [
          "recurrence_exceptions",
          "reminder_receipts",
          "reminder_snoozes",
        ].every((tableName) => tableRowCount(database, tableName) === 0) &&
        database
          .prepare("SELECT 1 FROM scheduled_card_index WHERE card_block_id = ?")
          .get(fixture.cascadeCardId) === undefined;
      invariant(
        (database.pragma("foreign_key_check") as unknown[]).length === 0,
        "fresh behavior contract left foreign-key violations",
      );
      return {
        legacyDeleteRetained,
        blockDeleteCascaded,
        projectCascade,
        dependencyRetypeGuard,
        dependencyFreeRetype,
      };
    } finally {
      database.close();
    }
  });

const runV65MigrationProbe = (): Promise<{
  readonly migratedVersion: number;
  readonly dataPreserved: boolean;
  readonly indexesPreserved: boolean;
  readonly uniquenessPreserved: boolean;
  readonly autoincrementPreserved: boolean;
}> =>
  withTemporaryStore("nodex-card-behavior-v65-", async () => {
    await initializeDatabase();
    closeDatabase();
    let database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const fixture = seedBehaviorFixture(database);
    insertBehaviorRows(database, fixture);
    downgradeBehaviorTablesToV65(database);
    database.close();

    await initializeDatabase();
    closeDatabase();
    database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    try {
      const exception = database
        .prepare(
          `
          SELECT * FROM recurrence_exceptions WHERE id = 101
        `,
        )
        .get() as
        | {
            readonly project_id: string;
            readonly card_id: string;
            readonly exception_type: string;
            readonly override_start: string | null;
            readonly override_end: string | null;
            readonly override_reminders_json: string | null;
          }
        | undefined;
      const receipt = database
        .prepare("SELECT * FROM reminder_receipts WHERE id = 201")
        .get() as
        | {
            readonly reminder_offset_minutes: number;
            readonly delivered_at: string;
          }
        | undefined;
      const snooze = database
        .prepare("SELECT * FROM reminder_snoozes WHERE id = 301")
        .get() as { readonly consumed_at: string | null } | undefined;
      const dataPreserved =
        exception?.project_id === fixture.projectId &&
        exception.card_id === fixture.cardId &&
        exception.exception_type === "override_time" &&
        exception.override_start === "2026-08-01T10:00:00.000Z" &&
        exception.override_end === "2026-08-01T11:00:00.000Z" &&
        exception.override_reminders_json === '[{"offsetMinutes":15}]' &&
        receipt?.reminder_offset_minutes === 15 &&
        receipt.delivered_at === "2026-08-01T08:45:00.000Z" &&
        snooze?.consumed_at === null;
      const indexNames = new Set(
        (
          database
            .prepare(
              `
              SELECT name FROM sqlite_master
              WHERE type = 'index' AND name LIKE 'idx_%reminder%'
                 OR type = 'index' AND name LIKE 'idx_recurrence_exceptions_%'
            `,
            )
            .all() as readonly { readonly name: string }[]
        ).map((row) => row.name),
      );
      const indexesPreserved = [
        "idx_recurrence_exceptions_unique",
        "idx_recurrence_exceptions_lookup",
        "idx_reminder_receipts_unique",
        "idx_reminder_receipts_lookup",
        "idx_reminder_snoozes_lookup",
      ].every((indexName) => indexNames.has(indexName));
      const uniquenessPreserved =
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO recurrence_exceptions (
                project_id, card_id, occurrence_start, exception_type, created
              ) VALUES (?, ?, '2026-08-01T09:00:00.000Z', 'skip', ?)
            `,
            )
            .run(fixture.projectId, fixture.cardId, new Date().toISOString()),
        ) &&
        operationFails(() =>
          database
            .prepare(
              `
              INSERT INTO reminder_receipts (
                project_id, card_id, occurrence_start,
                reminder_offset_minutes, delivered_at
              ) VALUES (?, ?, '2026-08-01T09:00:00.000Z', 15, ?)
            `,
            )
            .run(fixture.projectId, fixture.cardId, new Date().toISOString()),
        );
      const inserted = database
        .prepare(
          `
          INSERT INTO reminder_receipts (
            project_id, card_id, occurrence_start,
            reminder_offset_minutes, delivered_at
          ) VALUES (?, ?, '2026-08-02T09:00:00.000Z', 5, ?)
        `,
        )
        .run(fixture.projectId, fixture.cardId, new Date().toISOString());
      const autoincrementPreserved = Number(inserted.lastInsertRowid) > 201;
      invariant(
        [
          "recurrence_exceptions",
          "reminder_receipts",
          "reminder_snoozes",
        ].every((tableName) =>
          hasCompositeBlockForeignKey(database, tableName),
        ) && (database.pragma("foreign_key_check") as unknown[]).length === 0,
        "v65 migration did not install a valid Block FK contract",
      );
      return {
        migratedVersion: database.pragma("user_version", {
          simple: true,
        }) as number,
        dataPreserved,
        indexesPreserved,
        uniquenessPreserved,
        autoincrementPreserved,
      };
    } finally {
      database.close();
    }
  });

const runRollbackProbe = (): Promise<{
  readonly rejectedCrossProjectData: boolean;
  readonly versionRolledBack: boolean;
  readonly schemaRolledBack: boolean;
  readonly dataRetained: boolean;
}> =>
  withTemporaryStore("nodex-card-behavior-rollback-", async () => {
    await initializeDatabase();
    closeDatabase();
    let database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const fixture = seedBehaviorFixture(database);
    downgradeBehaviorTablesToV65(database);
    database
      .prepare(
        `
        INSERT INTO recurrence_exceptions (
          project_id, card_id, occurrence_start, exception_type, created
        ) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 'skip', ?)
      `,
      )
      .run(fixture.otherProjectId, fixture.cardId, new Date().toISOString());
    database.close();

    let rejectedCrossProjectData = false;
    try {
      await initializeDatabase();
    } catch {
      rejectedCrossProjectData = true;
    } finally {
      closeDatabase();
    }

    database = new Database(getDatabasePath());
    try {
      const versionRolledBack =
        (database.pragma("user_version", { simple: true }) as number) === 65;
      const tableSql = database
        .prepare(
          `
          SELECT sql FROM sqlite_master
          WHERE type = 'table' AND name = 'recurrence_exceptions'
        `,
        )
        .get() as { readonly sql: string } | undefined;
      const schemaRolledBack =
        (tableSql?.sql ?? "").includes("REFERENCES cards") &&
        database
          .prepare(
            `
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name LIKE '%_v66'
          `,
          )
          .get() === undefined;
      const dataRetained =
        tableRowCount(database, "recurrence_exceptions") === 1;
      return {
        rejectedCrossProjectData,
        versionRolledBack,
        schemaRolledBack,
        dataRetained,
      };
    } finally {
      database.close();
    }
  });

const run = async (): Promise<void> => {
  const fresh = await runFreshContractProbe();
  invariant(
    fresh.legacyDeleteRetained &&
      fresh.blockDeleteCascaded &&
      fresh.projectCascade &&
      fresh.dependencyRetypeGuard &&
      fresh.dependencyFreeRetype,
    `fresh Card behavior ownership contract failed: ${JSON.stringify(fresh)}`,
  );
  const migration = await runV65MigrationProbe();
  invariant(
    migration.migratedVersion === CURRENT_SCHEMA_VERSION &&
      migration.dataPreserved &&
      migration.indexesPreserved &&
      migration.uniquenessPreserved &&
      migration.autoincrementPreserved,
    "v65 Card behavior migration failed",
  );
  const rollback = await runRollbackProbe();
  invariant(
    rollback.rejectedCrossProjectData &&
      rollback.versionRolledBack &&
      rollback.schemaRolledBack &&
      rollback.dataRetained,
    "failed v65 migration did not roll back atomically",
  );
  process.stdout.write(
    `${JSON.stringify({
      freshCompositeBlockAuthority: true,
      cardTypeGuard: fresh.dependencyRetypeGuard,
      dependencyFreeRetype: fresh.dependencyFreeRetype,
      legacyDeleteRetained: fresh.legacyDeleteRetained,
      blockDeleteCascaded: fresh.blockDeleteCascaded,
      projectCascade: fresh.projectCascade,
      migratedVersion: migration.migratedVersion,
      dataPreserved: migration.dataPreserved,
      indexesPreserved: migration.indexesPreserved,
      uniquenessPreserved: migration.uniquenessPreserved,
      autoincrementPreserved: migration.autoincrementPreserved,
      invalidScopeRollback: rollback.schemaRolledBack,
    })}\n`,
  );
};

void run();
