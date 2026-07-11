import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createUuidV7 } from "../../shared/card-id";
import { getCard } from "./cards";
import { getDatabasePath } from "./config";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER,
} from "./block-first-legacy-schema";
import {
  createBlockFirstPreFinalizationSchema,
  CURRENT_SCHEMA_VERSION,
  ensureBlockFoundationForProject,
  getSchemaMigrationTargets,
} from "./schema";

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-schema-v70-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
  return directory;
};

const tableNames = (database: Database.Database): readonly string[] =>
  (
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      )
      .all() as readonly { readonly name: string }[]
  ).map((row) => row.name);

const assertHealthy = (database: Database.Database): void => {
  expect(
    JSON.stringify(database.pragma("foreign_key_check") as unknown[]),
  ).toBe("[]");
  const integrity = database.pragma("integrity_check") as readonly {
    readonly integrity_check: string;
  }[];
  expect(integrity[0]?.integrity_check).toBe("ok");
};

const seedPreFinalizationStore = (): {
  readonly projectId: string;
  readonly now: string;
} => {
  useTempStore();
  const database = new Database(getDatabasePath());
  database.pragma("foreign_keys = ON");
  createBlockFirstPreFinalizationSchema(database);
  const projectId = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO projects (id, name, description, icon, created, updated) VALUES (?, 'Migration', '', '', ?, ?)",
    )
    .run(projectId, now, now);
  database
    .prepare(
      'INSERT INTO project_order (project_id, "order", updated) VALUES (?, 0, ?)',
    )
    .run(projectId, now);
  ensureBlockFoundationForProject(database, projectId, now);
  database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION - 1}`);
  database.close();
  return { projectId, now };
};

const seedLegacyCardSource = (
  projectId: string,
  now: string,
): string => {
  const cardId = createUuidV7();
  const database = getDb();
  database
    .prepare(
      `
      INSERT INTO cards (
        id, project_id, status, title, description,
        description_preview, description_length, has_description,
        tags, revision, created, "order"
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 1, '["migration"]', 1, ?, 0)
    `,
    )
    .run(
      cardId,
      projectId,
      "Migrated title",
      "Migrated body",
      "Migrated body",
      "Migrated body".length,
      now,
    );
  return cardId;
};

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("schema v70 Block-first finalization", () => {
  test("exposes the final migration edge", () => {
    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe(
      "[]",
    );
    expect(
      JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION - 1)),
    ).toBe(`[${CURRENT_SCHEMA_VERSION}]`);
    expect(
      JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION - 2)),
    ).toBe(`[${CURRENT_SCHEMA_VERSION - 1},${CURRENT_SCHEMA_VERSION}]`);
    expect(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION + 1)).toBe(null);
  });

  test("creates a healthy canonical fresh store without compatibility tables", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    const names = new Set(tableNames(database));
    for (const tableName of [
      "blocks",
      "documents",
      "block_documents",
      "document_updates",
      "database_capabilities",
      "database_memberships",
      "database_views",
      "card_read_model",
    ]) {
      expect(names.has(tableName)).toBe(true);
    }
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    assertHealthy(database);
  });

  test("drains one real legacy Card and drops migration storage atomically", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const cardId = seedLegacyCardSource(projectId, now);
    closeDatabase();

    await initializeDatabase();

    const database = getDb();
    const card = await getCard(projectId, cardId);
    expect(card?.title).toBe("Migrated title");
    expect(card?.description).toBe("Migrated body");
    const document = database
      .prepare(
        "SELECT readiness, authority FROM documents WHERE id = ?",
      )
      .get(`document:${cardId}`) as {
      readonly readiness: string;
      readonly authority: string;
    };
    expect(document.readiness).toBe("ready");
    expect(document.authority).toBe("ydoc_primary");
    const names = new Set(tableNames(database));
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    assertHealthy(database);
  });

  test("fails closed before table removal when legacy parity is terminally broken", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const cardId = seedLegacyCardSource(projectId, now);
    getDb()
      .prepare(
        `
        UPDATE legacy_card_shadow_jobs
        SET status = 'failed', last_error = 'fixture parity failure',
            completed_at = updated_at
        WHERE card_id = ?
      `,
      )
      .run(cardId);
    closeDatabase();

    let message = "";
    try {
      await initializeDatabase();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message.includes("could not reach Y.Doc parity")).toBe(true);
    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION - 1);
    const names = new Set(tableNames(database));
    expect(names.has("cards")).toBe(true);
    expect(names.has("legacy_card_shadow_jobs")).toBe(true);
    assertHealthy(database);
  });
});
