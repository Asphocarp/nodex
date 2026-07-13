import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCard } from "./cards";
import { readCardDetail } from "./card-detail";
import { readDatabaseCardById } from "./card-read-store";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { createProject } from "./projects";

describe("Card Detail authority", () => {
  test("opens the same Card before and after it leaves its Database", async () => {
    closeDatabase();
    const previousDirectory = process.env.NODEX_DIR;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-card-detail-"),
    );
    process.env.NODEX_DIR = directory;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Card Detail" });
      const host = await createCard(project.id, "draft", { title: "Host" });
      const target = await createCard(project.id, "in_progress", {
        title: "Nested Card",
        description: "Independent body",
        agentStatus: "ready",
      });
      closeDatabase();

      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        const member = readCardDetail(project.id, target.id, database);
        expect(member?.databaseContext.kind).toBe("member");
        expect(member?.card.content?.title).toBe("Nested Card");
        expect(member?.card.documentId).toBe(`document:${target.id}`);

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
                containing_database_id = NULL,
                location_revision = location_revision + 1,
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

        const standalone = readCardDetail(project.id, target.id, database);
        expect(standalone?.databaseContext).toEqual({ kind: "standalone" });
        expect(standalone?.card.location).toEqual({
          kind: "document",
          documentId: hostDocument.document_id,
        });
        expect(standalone?.card.content?.preview).toBe("Independent body");
        expect(
          standalone?.properties.fields.find(
            (field) => field.field === "agentStatus",
          )?.value,
        ).toBe("ready");
        expect(
          standalone?.properties.fields.some(
            (field) => field.scope === "database",
          ),
        ).toBe(false);
        expect(() =>
          readDatabaseCardById(database, project.id, target.id),
        ).toThrow("is not an active Database row");
      } finally {
        database.close();
      }
    } finally {
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
      if (previousDirectory === undefined) {
        delete process.env.NODEX_DIR;
      } else {
        process.env.NODEX_DIR = previousDirectory;
      }
    }
  });
});
