import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { resolveCardTarget } from "./card-targets";
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

describe("Card target read model", () => {
  sqliteTest("resolves a document-located Card with no Database membership", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-card-target-"));
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Target project" });
      const host = await createCard(project.id, "draft", {
        title: "Host",
      });
      const target = await createCard(project.id, "draft", {
        title: "Nested Card",
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
            DELETE FROM database_view_positions
            WHERE project_id = ? AND block_id = ?
          `).run(project.id, target.id);
          database.prepare(`
            UPDATE database_memberships
            SET removed_at = ?, revision = revision + 1
            WHERE project_id = ? AND card_block_id = ? AND removed_at IS NULL
          `).run(now, project.id, target.id);
          database.prepare(`
            UPDATE blocks
            SET location_kind = 'document', containing_document_id = ?,
                containing_database_id = NULL, location_revision = location_revision + 1,
                updated_at = ?
            WHERE id = ? AND project_id = ?
          `).run(hostDocument.document_id, now, target.id, project.id);
          database.prepare(`
            DELETE FROM card_read_model WHERE card_block_id = ?
          `).run(target.id);
          database.prepare(`
            INSERT INTO document_block_index (
              document_id, block_id, parent_block_id, ordinal,
              block_type, text, projected_seq
            ) VALUES (?, ?, NULL, 0, 'card', '', 0)
          `).run(hostDocument.document_id, target.id);
        })();

        const resolved = resolveCardTarget(target.id, database);
        expect(resolved.status).toBe("available");
        if (resolved.status !== "available") return;
        expect(resolved.card.projectId).toBe(project.id);
        expect(resolved.card.location).toEqual({
          kind: "document",
          documentId: hostDocument.document_id,
        });
        expect(resolved.card.content?.title).toBe("Nested Card");
        expect(resolved.card.content?.preview).toBe("Independent body");
        expect(resolved.card.documentId).toBe(`document:${target.id}`);
        expect(resolved.document.readiness).toBe("ready");

        const missing = resolveCardTarget("missing-card-id", database);
        expect(missing.status).toBe("missing");
        const databaseBlock = database.prepare(`
          SELECT block_id FROM database_capabilities
          WHERE project_id = ? AND is_primary = 1
        `).get(project.id) as { readonly block_id: string };
        const invalid = resolveCardTarget(databaseBlock.block_id, database);
        expect(invalid.status).toBe("invalid_target");
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
