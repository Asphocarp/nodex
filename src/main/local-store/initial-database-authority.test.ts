import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  BUILT_IN_DATA_SOURCE_PROPERTY_IDS,
  createInitialDatabaseIdentities,
} from "../../shared/database-identities";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createInitialDatabaseAuthorityInDatabase } from "./initial-database-authority";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-initial-database-authority-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("independent initial Database authority", () => {
  test("creates one canonical root bundle without embedding parent identities", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const existing = database.prepare(`
      SELECT library_id FROM projects ORDER BY created LIMIT 1
    `).get() as { readonly library_id: string };
    const identities = createInitialDatabaseIdentities();
    const projectId = "independent-database-project";
    const now = "2026-07-18T04:00:00.000Z";

    database.transaction(() => {
      database.prepare(`
        INSERT INTO projects (
          id, library_id, database_block_id, lifecycle, binding_revision,
          name, description, icon, created, updated
        ) VALUES (?, ?, ?, 'active', 1, 'Independent', '', '', ?, ?)
      `).run(
        projectId,
        existing.library_id,
        identities.databaseId,
        now,
        now,
      );
      createInitialDatabaseAuthorityInDatabase(database, {
        projectId,
        libraryId: existing.library_id,
        identities,
        now,
      });
    }).immediate();

    expect(new Set(Object.values(identities)).size).toBe(3);
    expect(identities.databaseId).not.toContain(projectId);
    expect(identities.dataSourceId).not.toContain(identities.databaseId);
    expect(identities.viewId).not.toContain(identities.databaseId);
    expect(
      database.prepare(`
        SELECT database_block_id FROM project_database_bindings
        WHERE project_id = ?
      `).get(projectId),
    ).toEqual({ database_block_id: identities.databaseId });
    expect(
      database.prepare(`
        SELECT default_view_id FROM database_containers WHERE block_id = ?
      `).get(identities.databaseId),
    ).toEqual({ default_view_id: identities.viewId });
    expect(
      database.prepare(`
        SELECT id FROM data_source_properties WHERE data_source_id = ?
        ORDER BY rank_key, id
      `).all(identities.dataSourceId),
    ).toEqual(
      BUILT_IN_DATA_SOURCE_PROPERTY_IDS.map((id) => ({ id })),
    );
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("requires the caller to own the Project transaction", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database.prepare(`
      SELECT id, library_id FROM projects ORDER BY created LIMIT 1
    `).get() as { readonly id: string; readonly library_id: string };
    expect(() =>
      createInitialDatabaseAuthorityInDatabase(database, {
        projectId: project.id,
        libraryId: project.library_id,
        identities: createInitialDatabaseIdentities(),
        now: new Date().toISOString(),
      }),
    ).toThrow("requires an active transaction");
  });
});
