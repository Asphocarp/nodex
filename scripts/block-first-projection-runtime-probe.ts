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

const dropProjectionFoundationToV61 = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  try {
    database.exec(`
      DROP TRIGGER IF EXISTS cards_block_foundation_after_insert;
      DROP TRIGGER IF EXISTS cards_block_foundation_after_local_update;
      DROP TRIGGER IF EXISTS cards_block_foundation_cross_project_requires_pending;
      DROP TRIGGER IF EXISTS cards_block_foundation_after_cross_project_update;
      DROP TRIGGER IF EXISTS cards_block_foundation_after_delete;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_insert;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_update;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_delete;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_insert;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_update;
      DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_delete;
      DROP TABLE IF EXISTS database_property_values;
      DROP TABLE IF EXISTS database_properties;
      DROP TABLE IF EXISTS scheduled_card_index;
      DROP TABLE IF EXISTS block_properties;

      ALTER TABLE document_materializations RENAME TO document_materializations_v62;
      CREATE TABLE document_materializations (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL CHECK (generation >= 1),
        projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
        nfm TEXT NOT NULL,
        plain_text TEXT NOT NULL,
        preview TEXT NOT NULL,
        block_tree_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      INSERT INTO document_materializations (
        document_id, generation, projected_seq, nfm, plain_text,
        preview, block_tree_json, updated_at
      )
      SELECT
        document_id, generation, projected_seq, nfm, plain_text,
        preview, block_tree_json, updated_at
      FROM document_materializations_v62;
      DROP TABLE document_materializations_v62;
      PRAGMA user_version = 61;
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
};

const tableExists = (database: Database.Database, table: string): boolean =>
  database
    .prepare(
      `
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `,
    )
    .get(table) !== undefined;

const runFreshAndAuthorityProbe = (): Promise<Record<string, boolean>> =>
  withTemporaryStore("nodex-block-projection-fresh-", async () => {
    await initializeDatabase();
    const firstProject = createProject({ name: "Projection fresh" });
    const secondProject = createProject({ name: "Projection target" });
    const card = await createCard(firstProject.id, "draft", {
      title: "Projection Card",
      description: "Body",
      priority: "p1-high",
      estimate: "m",
      tags: ["sync", "block"],
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
      scheduledStart: new Date("2026-08-02T09:00:00.000Z"),
      scheduledEnd: new Date("2026-08-02T10:00:00.000Z"),
      assignee: "asc",
      agentBlocked: true,
      agentStatus: "working",
      runInTarget: "newWorktree",
      recurrence: { frequency: "daily", interval: 1 },
      reminders: [{ offsetMinutes: 10 }],
      scheduleTimezone: "Asia/Shanghai",
    });
    const moving = await createCard(firstProject.id, "backlog", {
      title: "Moving Card",
      tags: ["move"],
    });
    closeDatabase();

    const database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const initialJobCount = database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM legacy_card_shadow_jobs WHERE card_id = ?
    `,
      )
      .get(card.id) as { count: number };
    invariant(
      initialJobCount.count === 1,
      "fresh Card insert lost its shadow job",
    );

    const projectionCounts = database
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM block_properties WHERE block_id = ?) AS intrinsic,
        (SELECT COUNT(*)
          FROM database_property_values value
          INNER JOIN database_memberships membership ON membership.id = value.membership_id
          WHERE membership.card_block_id = ?) AS database_values,
        (SELECT COUNT(*) FROM scheduled_card_index WHERE card_block_id = ?) AS schedule
    `,
      )
      .get(card.id, card.id, card.id) as {
      intrinsic: number;
      database_values: number;
      schedule: number;
    };
    invariant(
      projectionCounts.intrinsic === 11,
      "intrinsic properties were not seeded",
    );
    invariant(
      projectionCounts.database_values === 8,
      "Database values were not seeded",
    );
    invariant(projectionCounts.schedule === 1, "schedule index was not seeded");

    database
      .prepare(
        `
      UPDATE cards
      SET status = 'in_progress', priority = 'p0-critical',
          scheduled_start = '2026-08-03T09:00:00.000Z',
          scheduled_end = '2026-08-03T10:00:00.000Z',
          revision = revision + 1
      WHERE id = ?
    `,
      )
      .run(card.id);
    const metadataJobCount = database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM legacy_card_shadow_jobs WHERE card_id = ?
    `,
      )
      .get(card.id) as { count: number };
    invariant(
      metadataJobCount.count === 1,
      "metadata update entered content outbox",
    );
    const statusValue = database
      .prepare(
        `
      SELECT value.value_json
      FROM database_property_values value
      INNER JOIN database_properties property ON property.id = value.property_id
      INNER JOIN database_memberships membership ON membership.id = value.membership_id
      WHERE membership.card_block_id = ? AND property.key = 'status'
    `,
      )
      .get(card.id) as { value_json: string };
    invariant(
      statusValue.value_json === '"in_progress"',
      "status projection did not update",
    );

    database
      .prepare(
        `
      UPDATE documents SET readiness = 'ready', authority = 'ydoc_primary'
      WHERE id = ?
    `,
      )
      .run(`document:${card.id}`);
    database
      .prepare(
        `
      UPDATE cards SET status = 'done', archived = 1, revision = revision + 1
      WHERE id = ?
    `,
      )
      .run(card.id);
    invariant(
      operationFails(() => {
        database
          .prepare("UPDATE cards SET title = 'illegal' WHERE id = ?")
          .run(card.id);
      }),
      "primary title write was accepted",
    );
    invariant(
      operationFails(() => {
        database
          .prepare("UPDATE cards SET description = 'illegal' WHERE id = ?")
          .run(card.id);
      }),
      "primary description write was accepted",
    );
    const beforeDeleteJobs = database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM legacy_card_shadow_jobs WHERE card_id = ?
    `,
      )
      .get(card.id) as { count: number };
    database.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
    const afterDelete = database
      .prepare(
        `
      SELECT
        (SELECT lifecycle FROM blocks WHERE id = ?) AS lifecycle,
        (SELECT COUNT(*) FROM legacy_card_shadow_jobs WHERE card_id = ?) AS jobs
    `,
      )
      .get(card.id, card.id) as { lifecycle: string; jobs: number };
    invariant(
      afterDelete.lifecycle === "deleted",
      "primary delete did not tombstone Block",
    );
    invariant(
      afterDelete.jobs === beforeDeleteJobs.count,
      "primary delete entered content outbox",
    );

    database
      .prepare(
        `
      UPDATE cards SET project_id = ?, revision = revision + 1 WHERE id = ?
    `,
      )
      .run(secondProject.id, moving.id);
    const moved = database
      .prepare(
        `
      SELECT
        block.project_id,
        (SELECT COUNT(*) FROM block_properties WHERE block_id = block.id AND project_id = ?) AS intrinsic,
        (SELECT COUNT(*)
          FROM database_memberships membership
          INNER JOIN database_property_values value ON value.membership_id = membership.id
          WHERE membership.card_block_id = block.id
            AND membership.database_block_id = 'database:' || ? || ':primary'
            AND membership.removed_at IS NULL) AS database_values
      FROM blocks block WHERE block.id = ?
    `,
      )
      .get(secondProject.id, secondProject.id, moving.id) as {
      project_id: string;
      intrinsic: number;
      database_values: number;
    };
    invariant(
      moved.project_id === secondProject.id,
      "cross-Project Block scope diverged",
    );
    invariant(
      moved.intrinsic === 11,
      "cross-Project intrinsic properties diverged",
    );
    invariant(
      moved.database_values === 8,
      "cross-Project Database values diverged",
    );
    invariant(
      database.prepare("PRAGMA foreign_key_check").all().length === 0,
      "fresh schema has FK violations",
    );
    database.close();
    return {
      freshProjectionParity: true,
      insertRaceClosed: true,
      primaryAuthorityNarrowed: true,
      crossProjectParity: true,
    };
  });

const runMigrationProbe = (): Promise<Record<string, boolean>> =>
  withTemporaryStore("nodex-block-projection-migration-", async () => {
    await initializeDatabase();
    const project = createProject({ name: "Projection migration" });
    const card = await createCard(project.id, "in_review", {
      title: "Migrated projection title",
      tags: ["migration"],
    });
    closeDatabase();

    let database = new Database(getDatabasePath());
    database
      .prepare(
        `
      INSERT INTO document_materializations (
        document_id, generation, projected_seq, schema_version, title,
        nfm, plain_text, preview, block_tree_json, references_json,
        asset_refs_json, updated_at
      ) VALUES (?, 1, 0, 1, '', ?, '', '', ?, '[]', '[]', ?)
    `,
      )
      .run(
        `document:${card.id}`,
        '<card-ref project="space-a" card="target-card" />\n<image source="nodex://assets/image.png">Caption</image>',
        JSON.stringify([
          { id: "ref-block", type: "cardRef", props: {}, children: [] },
          { id: "image-block", type: "image", props: {}, children: [] },
        ]),
        new Date().toISOString(),
      );
    dropProjectionFoundationToV61(database);
    database.close();

    await initializeDatabase();
    closeDatabase();
    database = new Database(getDatabasePath());
    const version = database.pragma("user_version", { simple: true }) as number;
    invariant(
      version === CURRENT_SCHEMA_VERSION,
      "v61→v62 did not advance version",
    );
    const migrated = database
      .prepare(
        `
      SELECT title, references_json, asset_refs_json
      FROM document_materializations WHERE document_id = ?
    `,
      )
      .get(`document:${card.id}`) as {
      title: string;
      references_json: string;
      asset_refs_json: string;
    };
    invariant(
      migrated.title === "Migrated projection title",
      "title projection was not backfilled",
    );
    invariant(
      JSON.parse(migrated.references_json).length === 1,
      "reference projection was not backfilled",
    );
    invariant(
      JSON.parse(migrated.asset_refs_json).length === 1,
      "asset projection was not backfilled",
    );
    const countBefore = database
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM database_properties WHERE project_id = ?) AS definitions,
        (SELECT COUNT(*) FROM database_property_values WHERE project_id = ?) AS values_count,
        (SELECT COUNT(*) FROM block_properties WHERE project_id = ?) AS intrinsic
    `,
      )
      .get(project.id, project.id, project.id) as Record<string, number>;
    database.close();

    await initializeDatabase();
    closeDatabase();
    database = new Database(getDatabasePath());
    const countAfter = database
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM database_properties WHERE project_id = ?) AS definitions,
        (SELECT COUNT(*) FROM database_property_values WHERE project_id = ?) AS values_count,
        (SELECT COUNT(*) FROM block_properties WHERE project_id = ?) AS intrinsic
    `,
      )
      .get(project.id, project.id, project.id) as Record<string, number>;
    invariant(
      JSON.stringify(countAfter) === JSON.stringify(countBefore),
      "v62 startup duplicated projection identity",
    );
    invariant(
      database.prepare("PRAGMA foreign_key_check").all().length === 0,
      "migration has FK violations",
    );
    database.close();
    return { migrationParity: true, migrationIdempotent: true };
  });

const runRollbackProbe = (): Promise<Record<string, boolean>> =>
  withTemporaryStore("nodex-block-projection-rollback-", async () => {
    await initializeDatabase();
    const project = createProject({ name: "Projection rollback" });
    const card = await createCard(project.id, "draft", { title: "Rollback" });
    closeDatabase();
    let database = new Database(getDatabasePath());
    dropProjectionFoundationToV61(database);
    database
      .prepare("UPDATE cards SET tags = 'invalid-json' WHERE id = ?")
      .run(card.id);
    database.close();

    let failed = false;
    try {
      await initializeDatabase();
    } catch {
      failed = true;
    }
    closeDatabase();
    invariant(failed, "invalid projection source did not fail migration");
    database = new Database(getDatabasePath());
    const version = database.pragma("user_version", { simple: true }) as number;
    const columns = database.pragma(
      "table_info(document_materializations)",
    ) as Array<{ name: string }>;
    invariant(version === 61, "failed migration advanced schema version");
    invariant(
      !columns.some((column) => column.name === "title"),
      "failed migration retained DDL",
    );
    invariant(
      !tableExists(database, "block_properties"),
      "failed migration retained projection tables",
    );
    database.prepare("UPDATE cards SET tags = '[]' WHERE id = ?").run(card.id);
    database.close();
    await initializeDatabase();
    return { migrationRollbackAtomic: true };
  });

const run = async (): Promise<void> => {
  const result = {
    ...(await runFreshAndAuthorityProbe()),
    ...(await runMigrationProbe()),
    ...(await runRollbackProbe()),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
