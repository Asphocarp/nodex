import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPage } from "./database-pages";
import {
  readPageTargetContentChangedEvent,
  resolvePageTarget,
} from "./page-targets";
import { closeDatabase, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { createProject } from "./projects";

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

describe("Page target read model", () => {
  sqliteTest("resolves a Page with no Database membership", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-card-target-"));
    process.env.NODEX_HOME = tempDir;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Target project" });
      const host = await createPage(project.id, "triage", {
        title: "Host",
      });
      const target = await createPage(project.id, "triage", {
        title: "Nested Page",
        description: "Independent body",
      });
      closeDatabase();

      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        const hostDocument = database.prepare(`
          SELECT document_id FROM block_documents WHERE block_id = ?
        `).get(host.id) as { readonly document_id: string };
        const now = new Date().toISOString();
        database.transaction(() => {
          database.prepare(`
            DELETE FROM database_view_page_positions
            WHERE page_block_id = ?
          `).run(target.id);
          database.prepare(`
            UPDATE data_source_page_memberships
            SET removed_at = ?, revision = revision + 1
            WHERE page_block_id = ? AND removed_at IS NULL
          `).run(now, target.id);
          database.prepare(`
            UPDATE pages
            SET parent_kind = 'page', parent_id = ?,
                parent_revision = parent_revision + 1, updated_at = ?
            WHERE block_id = ? AND library_id = ?
          `).run(host.id, now, target.id, project.libraryId);
          database.prepare(`
            UPDATE blocks
            SET location_kind = 'document', containing_document_id = ?,
                containing_database_id = NULL, location_revision = location_revision + 1,
                updated_at = ?
            WHERE id = ? AND project_id = ?
          `).run(hostDocument.document_id, now, target.id, project.id);
          database.prepare(`
            DELETE FROM page_read_model WHERE page_block_id = ?
          `).run(target.id);
          database.prepare(`
            INSERT INTO document_block_index (
              document_id, block_id, parent_block_id, ordinal,
              block_type, text, projected_seq
            ) VALUES (?, ?, NULL, 0, 'page', '', 0)
          `).run(hostDocument.document_id, target.id);
        })();

        const resolved = resolvePageTarget(target.id, database);
        expect(resolved.status).toBe("available");
        if (resolved.status !== "available") return;
        expect(resolved.page.libraryId).toBe(project.libraryId);
        expect(resolved.page.parent).toEqual({
          kind: "page",
          pageId: host.id,
        });
        expect(resolved.page.title).toBe("Nested Page");
        expect(resolved.page.preview).toBe("Independent body");
        expect(resolved.page.documentId).toBe(`document:${target.id}`);
        expect(resolved.document.readiness).toBe("ready");
        expect(
          readPageTargetContentChangedEvent(database, resolved.page.documentId),
        ).toEqual({
          libraryId: project.libraryId,
          targetPageId: target.id,
          changeKind: "content",
          document: {
            id: resolved.page.documentId,
            generation: resolved.page.documentGeneration,
            headSeq: resolved.page.documentHeadSeq,
          },
        });

        const missing = resolvePageTarget("missing-page-id", database);
        expect(missing.status).toBe("missing");
        const databaseBlock = database.prepare(`
          SELECT database_block_id AS block_id FROM project_database_bindings
          WHERE project_id = ? AND lifecycle = 'active'
        `).get(project.id) as { readonly block_id: string };
        const invalid = resolvePageTarget(databaseBlock.block_id, database);
        expect(invalid.status).toBe("invalid_target");
      } finally {
        database.close();
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_HOME;
    }
  });
});
