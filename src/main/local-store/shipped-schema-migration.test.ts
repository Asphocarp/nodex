import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { parseAssetSource } from "../../shared/assets";
import { createUuidV7 } from "../../shared/uuid-v7";
import { getDatabaseRowPage } from "./database-pages";
import { readPageDetailInDatabase } from "./page-detail";
import { getDatabasePath } from "./config";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { resetAssetPathCacheForTests } from "./assets";
import {
  createShippedV57SchemaFixture,
  CURRENT_SCHEMA_VERSION,
  SHIPPED_SCHEMA_VERSION,
} from "./schema";
import { migrateShippedSchemaStoreToCurrent } from "./shipped-schema-migration";
import { validateBackupStore } from "./backup-store-validation";
import { createShippedV26SchemaFixture } from "./shipped-schema-v26.test-fixture";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const INLINE_IMAGE = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const tempDirectories: string[] = [];

const sha256File = (filePath: string): string =>
  createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const normalizedSchema = (
  database: Database.Database,
): readonly Readonly<Record<string, string>>[] =>
  (
    database
      .prepare(
        `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as readonly {
      readonly type: string;
      readonly name: string;
      readonly tbl_name: string;
      readonly sql: string;
    }[]
  ).map((row) => ({
    type: row.type,
    name: row.name,
    table: row.tbl_name,
    sql: row.sql
      .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/gu, "$1")
      .replace(/\s+/gu, " ")
      .trim(),
  }));

const seedV57Store = (): {
  readonly directoryPath: string;
  readonly projectId: string;
  readonly cardId: string;
} => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directoryPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-schema-v57-import-"),
  );
  tempDirectories.push(directoryPath);
  process.env.NODEX_HOME = directoryPath;

  const database = new Database(getDatabasePath());
  database.pragma("foreign_keys = ON");
  createShippedV57SchemaFixture(database);
  const projectId = randomUUID();
  const cardId = createUuidV7();
  const now = "2026-07-14T00:00:00.000Z";
  const description = `<image source="${INLINE_IMAGE}">Imported pixel</image>`;
  database
    .prepare(
      `INSERT INTO projects (id, name, description, icon, created, updated)
       VALUES (?, 'Migrated project', '', '', ?, ?)`,
    )
    .run(projectId, now, now);
  database
    .prepare(
      `INSERT INTO project_order (project_id, "order", updated)
       VALUES (?, 0, ?)`,
    )
    .run(projectId, now);
  database
    .prepare(
      `INSERT INTO cards (
         id, project_id, status, title, description, description_preview,
         description_length, has_description, tags, revision, created, "order"
       ) VALUES (?, ?, 'backlog', 'Migrated Card', ?, 'Imported pixel', ?, 1,
         '["migration"]', 1, ?, 0)`,
    )
    .run(cardId, projectId, description, description.length, now);
  database.close();
  return { directoryPath, projectId, cardId };
};

const seedV26Store = (): {
  readonly directoryPath: string;
  readonly legacyProjectId: string;
  readonly cardId: string;
  readonly threadId: string;
  readonly sourceDatabasePath: string;
} => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directoryPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-schema-v26-import-"),
  );
  tempDirectories.push(directoryPath);
  process.env.NODEX_HOME = directoryPath;

  const sourceDatabasePath = path.join(directoryPath, "kanban.db");
  const database = new Database(sourceDatabasePath);
  database.pragma("foreign_keys = ON");
  createShippedV26SchemaFixture(database);
  const legacyProjectId = "legacy-project";
  const cardId = createUuidV7();
  const threadId = "thread:v26";
  const now = "2026-06-17T00:00:00.000Z";
  database
    .prepare(
      `INSERT INTO projects (
         id, name, description, icon, workspace_path, created
       ) VALUES (?, 'Legacy Project', '', '', ?, ?)`,
    )
    .run(legacyProjectId, path.join(directoryPath, "workspace"), now);
  database
    .prepare(
      `INSERT INTO cards (
         id, project_id, status, title, description, tags, revision,
         scheduled_start, scheduled_end, created, "order"
       ) VALUES (
         ?, ?, 'backlog', 'Legacy Card', 'Legacy body', '["v26"]', 3,
         '2026-06-18T09:00:00.000Z', '2026-06-18T10:00:00.000Z', ?, 0
       )`,
    )
    .run(cardId, legacyProjectId, now);
  database
    .prepare(
      `INSERT INTO codex_card_threads (
         thread_id, project_id, card_id, parent_thread_id, thread_name,
         thread_preview, model_provider, cwd, status_type,
         status_active_flags_json, archived, created_at, updated_at, linked_at
       ) VALUES (
         ?, ?, ?, 'parent:v26', 'Legacy thread', 'Thread preview', 'openai',
         '/tmp', 'idle', '[]', 0, 1, 2, ?
       )`,
    )
    .run(threadId, legacyProjectId, cardId, now);
  database
    .prepare(
      `INSERT INTO canvas (project_id, elements, app_state, files, updated)
       VALUES (?, '[]', '{}', '{}', ?)`,
    )
    .run(legacyProjectId, now);
  database.close();
  return {
    directoryPath,
    legacyProjectId,
    cardId,
    threadId,
    sourceDatabasePath,
  };
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("shipped schema through v58 staging and current startup migrations", () => {
  test("imports v26 through the legacy filename without exposing checkpoints", async () => {
    const source = seedV26Store();
    const sourceDatabaseHash = sha256File(source.sourceDatabasePath);

    await expect(
      initializeDatabase({
        injectFault: (point) => {
          if (point === "store_installed") {
            throw new Error("injected v26 install fault");
          }
        },
      }),
    ).rejects.toThrow("injected v26 install fault");

    expect(fs.existsSync(source.sourceDatabasePath)).toBe(false);
    expect(sha256File(getDatabasePath())).toBe(sourceDatabaseHash);
    const rolledBack = new Database(getDatabasePath(), { readonly: true });
    expect(rolledBack.pragma("user_version", { simple: true })).toBe(26);
    rolledBack.close();

    await initializeDatabase();
    const database = getDb();
    expect(database.pragma("user_version", { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    const project = database
      .prepare("SELECT id, name FROM projects WHERE name = 'Legacy Project'")
      .get() as { readonly id: string; readonly name: string };
    expect(project.id).not.toBe(source.legacyProjectId);
    expect(
      database
        .prepare("SELECT root FROM project_sources WHERE project_id = ?")
        .get(project.id),
    ).toEqual({ root: path.join(source.directoryPath, "workspace") });
    expect(
      database
        .prepare(
          `SELECT parent_thread_id, thread_name
           FROM codex_threads WHERE thread_id = ?`,
        )
        .get(source.threadId),
    ).toEqual({ parent_thread_id: "parent:v26", thread_name: "Legacy thread" });
    expect(
      database
        .prepare(
          `SELECT session.project_id, link.thread_id
           FROM project_session_threads link
           JOIN project_sessions session ON session.id = link.session_id
           WHERE link.thread_id = ?`,
        )
        .get(source.threadId),
    ).toEqual({ project_id: project.id, thread_id: source.threadId });
    expect(await getDatabaseRowPage(project.id, source.cardId)).toMatchObject({
      title: "Legacy Card",
      description: "Legacy body",
      status: "plan",
      tags: ["v26"],
    });
    expect(
      database
        .prepare(
          `SELECT property_key FROM block_properties
           WHERE property_key IN ('agent.blocked', 'agent.status')`,
        )
        .all(),
    ).toEqual([]);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
  }, 30_000);

  test("rolls back a failed install byte-for-byte, then publishes a validated store", async () => {
    const source = seedV57Store();
    const sourceDatabaseHash = sha256File(getDatabasePath());

    await expect(
      migrateShippedSchemaStoreToCurrent({
        injectFault: (point) => {
          if (point === "store_installed") {
            throw new Error("injected install fault");
          }
        },
      }),
    ).rejects.toThrow("injected install fault");

    expect(sha256File(getDatabasePath())).toBe(sourceDatabaseHash);
    const rolledBack = new Database(getDatabasePath(), { readonly: true });
    expect(rolledBack.pragma("user_version", { simple: true })).toBe(57);
    rolledBack.close();

    const result = await migrateShippedSchemaStoreToCurrent();
    expect(result).toEqual({
      migrated: true,
      sourceSchemaVersion: 57,
      installedSchemaVersion: SHIPPED_SCHEMA_VERSION,
    });
    await initializeDatabase();

    const card = await getDatabaseRowPage(source.projectId, source.cardId);
    expect(card?.title).toBe("Migrated Card");
    expect(card?.description).toContain("nodex://assets/legacy-card-");
    expect(card?.description).not.toContain("data:image/");
    const pageDetail = readPageDetailInDatabase(
      getDb(),
      source.projectId,
      source.cardId,
    );
    expect(pageDetail.ok).toBe(true);
    if (!pageDetail.ok) return;
    expect(pageDetail.value.page).toMatchObject({
      pageId: source.cardId,
      title: "Migrated Card",
      parent: { kind: "data_source" },
    });

    const parsed = parseAssetSource(
      /nodex:\/\/assets\/[^"\s]+/u.exec(card?.description ?? "")?.[0] ?? "",
    );
    expect(parsed).not.toBe(null);
    const assetPath = path.join(
      source.directoryPath,
      "assets",
      parsed?.fileName ?? "missing",
    );
    expect(fs.readFileSync(assetPath)).toEqual(PNG_BYTES);
    expect(
      validateBackupStore(getDatabasePath(), {
        assetsPath: path.join(source.directoryPath, "assets"),
      }).schemaVersion,
    ).toBe(CURRENT_SCHEMA_VERSION);

    const migratedSchema = normalizedSchema(getDb());
    closeDatabase();
    resetAssetPathCacheForTests();
    const freshDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-schema-current-fresh-"),
    );
    tempDirectories.push(freshDirectoryPath);
    process.env.NODEX_HOME = freshDirectoryPath;
    await initializeDatabase();
    expect(normalizedSchema(getDb())).toEqual(migratedSchema);
  }, 30_000);
});
