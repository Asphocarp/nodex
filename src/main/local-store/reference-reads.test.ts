import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { runLegacyCardShadowProcessorProbe } from "./legacy-card-shadow-processor";
import { createProject } from "./projects";
import {
  readProjectScopedDatabaseViewReference,
  resolveProjectScopedCardReference,
} from "./reference-reads";

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("better-sqlite3") && message.includes("not yet supported")) {
      return false;
    }
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

describe("Project-scoped canonical reference reads", () => {
  sqliteTest("allows cross-Project targets only from an existing host scope", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-reference-read-"));
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const hostProject = createProject({ name: "Host" });
      const targetProject = createProject({ name: "Target" });
      const targetCard = await createCard(targetProject.id, "draft", {
        title: "Target Card",
      });
      const siblingCard = await createCard(targetProject.id, "draft", {
        title: "Sibling Card",
      });
      closeDatabase();

      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        runLegacyCardShadowProcessorProbe(database);
        const databaseBlock = database.prepare(`
          SELECT block_id
          FROM database_capabilities
          WHERE project_id = ? AND is_primary = 1
        `).get(targetProject.id) as { block_id: string };
        const now = "2026-01-01T00:00:00.000Z";
        const legacyConfig = JSON.stringify({
          schemaKey: "nodex.database-view/legacy-inline",
          schemaVersion: 1,
          filter: { any: [] },
          sort: [{ field: "board-order", direction: "asc" }],
          options: { includeHostCard: false },
        });
        database.prepare(`
          INSERT INTO database_views (
            id, database_block_id, project_id, name, kind,
            config_json, is_primary, created_at, updated_at
          ) VALUES (?, ?, ?, 'Target view', 'list', ?, 0, ?, ?)
        `).run(
          "view:target",
          databaseBlock.block_id,
          targetProject.id,
          legacyConfig,
          now,
          now,
        );
        const insertPosition = database.prepare(`
          INSERT INTO database_view_positions (
            view_id, block_id, project_id, group_key, rank_key,
            created_at, updated_at
          ) VALUES ('view:target', ?, ?, 'draft', ?, ?, ?)
        `);
        insertPosition.run(targetCard.id, targetProject.id, "a", now, now);
        insertPosition.run(siblingCard.id, targetProject.id, "b", now, now);

        const card = resolveProjectScopedCardReference({
          requestingProjectId: hostProject.id,
          targetBlockId: targetCard.id,
        }, database);
        expect(card?.status).toBe("available");
        if (card?.status === "available") {
          expect(card.projectId).toBe(targetProject.id);
        }
        const view = readProjectScopedDatabaseViewReference({
          requestingProjectId: hostProject.id,
          databaseViewId: "view:target",
        }, database);
        expect(view?.view.projectId).toBe(targetProject.id);
        expect(view?.rows.length).toBe(2);
        const withoutHost = readProjectScopedDatabaseViewReference({
          requestingProjectId: targetProject.id,
          databaseViewId: "view:target",
          hostBlockId: targetCard.id,
        }, database);
        expect(withoutHost?.rows.map((row) => row.card.id).join(",")).toBe(
          siblingCard.id,
        );
        expect(resolveProjectScopedCardReference({
          requestingProjectId: "missing-project",
          targetBlockId: targetCard.id,
        }, database) === null).toBeTrue();
        expect(readProjectScopedDatabaseViewReference({
          requestingProjectId: "missing-project",
          databaseViewId: "view:target",
        }, database) === null).toBeTrue();
      } finally {
        database.close();
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });
});
