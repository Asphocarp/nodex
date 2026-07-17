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
  resolveProjectScopedPageOwnershipPath,
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
      const restrictedProject = createProject({ name: "Restricted host" });
      const targetProject = createProject({ name: "Target" });
      const targetCard = await createPage(targetProject.id, "triage", {
        title: "Target Card",
      });
      const siblingCard = await createPage(targetProject.id, "triage", {
        title: "Sibling Card",
      });
      const nestedPage = await createPage(targetProject.id, "triage", {
        title: "Nested Page",
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
        database.prepare(`
          UPDATE data_source_page_memberships
          SET removed_at = ?, revision = revision + 1
          WHERE page_block_id = ? AND removed_at IS NULL
        `).run(now, nestedPage.id);
        database.prepare(`
          UPDATE pages
          SET parent_kind = 'page', parent_id = ?,
            parent_revision = parent_revision + 1, updated_at = ?
          WHERE block_id = ?
        `).run(targetCard.id, now, nestedPage.id);

        putProjectResourceGrantInDatabase(database, {
          projectId: hostProject.id,
          root: { kind: "database", databaseId: databaseBlock.block_id },
          access: "read",
        }, now);
        putProjectResourceGrantInDatabase(database, {
          projectId: restrictedProject.id,
          root: { kind: "page", pageId: nestedPage.id },
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
        expect(resolveProjectScopedPageOwnershipPath({
          requestingProjectId: hostProject.id,
          targetPageId: nestedPage.id,
        }, database)).toEqual({
          status: "available",
          targetPageId: nestedPage.id,
          ancestors: [{
            pageId: targetCard.id,
            title: "Target Card",
            lifecycle: "active",
          }],
        });
        expect(resolveProjectScopedPageOwnershipPath({
          requestingProjectId: hostProject.id,
          targetPageId: siblingCard.id,
        }, database)).toEqual({
          status: "available",
          targetPageId: siblingCard.id,
          ancestors: [],
        });
        expect(resolveProjectScopedPageOwnershipPath({
          requestingProjectId: restrictedProject.id,
          targetPageId: nestedPage.id,
        }, database)).toEqual({
          status: "available",
          targetPageId: nestedPage.id,
          ancestors: [],
        });
        expect(resolveProjectScopedPageOwnershipPath({
          requestingProjectId: hostProject.id,
          targetPageId: "missing-page",
        }, database)).toEqual({
          status: "missing",
          targetPageId: "missing-page",
        });
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
        expect(withoutHost?.rows.map((row) => row.page.id)).toEqual([
          siblingCard.id,
        ]);
        expect(resolveProjectScopedPageTarget({
          requestingProjectId: "missing-project",
          targetPageId: targetCard.id,
        }, database) === null).toBe(true);
        expect(resolveProjectScopedPageOwnershipPath({
          requestingProjectId: "missing-project",
          targetPageId: nestedPage.id,
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
