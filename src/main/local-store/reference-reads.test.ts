import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPage } from "./database-pages";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { putProjectResourceGrantInDatabase } from "./project-resource-grants";
import {
  readProjectScopedDatabaseViewReference,
  resolveProjectScopedPageTarget,
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
  sqliteTest("allows cross-Project targets only through an explicit resource grant", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-reference-read-"));
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const hostProject = createProject({ name: "Host" });
      const targetProject = createProject({ name: "Target" });
      const targetCard = await createPage(targetProject.id, "draft", {
        title: "Target Card",
      });
      const siblingCard = await createPage(targetProject.id, "draft", {
        title: "Sibling Card",
      });
      closeDatabase();

      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        const databaseBlock = database.prepare(`
          SELECT project.database_block_id AS block_id,
            container.default_view_id AS view_id
          FROM projects project
          INNER JOIN database_containers container
            ON container.block_id = project.database_block_id
          WHERE project.id = ?
        `).get(targetProject.id) as { block_id: string; view_id: string };
        const now = "2026-01-01T00:00:00.000Z";

        putProjectResourceGrantInDatabase(database, {
          projectId: hostProject.id,
          root: { kind: "database", databaseId: databaseBlock.block_id },
          access: "read",
        }, now);

        const card = resolveProjectScopedPageTarget({
          requestingProjectId: hostProject.id,
          targetPageId: targetCard.id,
        }, database);
        expect(card?.status).toBe("available");
        if (card?.status === "available") {
          expect(card.page.libraryId).toBe(targetProject.libraryId);
        }
        const view = readProjectScopedDatabaseViewReference({
          requestingProjectId: hostProject.id,
          databaseViewId: databaseBlock.view_id,
        }, database);
        expect(view?.view.projectId).toBe(hostProject.id);
        expect(view?.rows.length).toBe(2);
        const withoutHost = readProjectScopedDatabaseViewReference({
          requestingProjectId: targetProject.id,
          databaseViewId: databaseBlock.view_id,
          hostBlockId: targetCard.id,
        }, database);
        expect(withoutHost?.rows.map((row) => row.page.id).join(",")).toBe(
          siblingCard.id,
        );
        expect(resolveProjectScopedPageTarget({
          requestingProjectId: "missing-project",
          targetPageId: targetCard.id,
        }, database) === null).toBe(true);
        expect(readProjectScopedDatabaseViewReference({
          requestingProjectId: "missing-project",
          databaseViewId: databaseBlock.view_id,
        }, database) === null).toBe(true);
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
