import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { openPageDocument } from "../../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import { createPage, searchPages } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { putProjectResourceGrantInDatabase } from "./project-resource-grants";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("better-sqlite3") &&
      message.includes("not yet supported")
    ) {
      return false;
    }
    throw error;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

const findFirstText = (
  root: Y.XmlFragment | Y.XmlElement,
): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = findFirstText(child);
    if (nested) return nested;
  }
  return null;
};

describe("authoritative Page search", () => {
  sqliteTest(
    "tracks remote Y.Doc content and relational status without legacy fallback",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-page-search-"),
      );
      process.env.NODEX_HOME = tempDir;
      try {
        await initializeDatabase();
        const project = createProject({ name: "Card search authority" });
        const otherProject = createProject({ name: "Other search scope" });
        const card = await createPage(project.id, "build", {
          title: "Search Card",
          description: "legacy-needle",
        });
        const database = getDb();
        const descriptor = getOwnedBlockDocumentDescriptor(
          database,
          project.id,
          card.id,
        );
        const loaded = loadPrimaryBlockDocument(
          database,
          descriptor.documentId,
        );
        try {
          const before = Y.encodeStateVector(loaded.document);
          const body = openPageDocument(loaded.document).body;
          const text = findFirstText(body);
          if (!text) throw new Error("Expected Card genesis text");
          loaded.document.transact(() => {
            text.delete(0, text.length);
            text.insert(0, "current-needle");
          }, "page-search-test");
          applyBlockDocumentUpdate(database, {
            documentId: descriptor.documentId,
            storeEpoch: loaded.storeEpoch,
            generation: loaded.head.generation,
            updateId: "page-search-current-body",
            clientSessionId: "page-search-window",
            baseHeadSeq: loaded.head.headSeq,
            touchedBlockIds: [],
            update: Y.encodeStateAsUpdate(loaded.document, before),
          });
        } finally {
          loaded.document.destroy();
        }

        database
          .prepare(
            `
        UPDATE data_source_property_values
        SET value_json = '"ship"', revision = revision + 1
        WHERE membership_id = (
            SELECT id FROM data_source_page_memberships
            WHERE page_block_id = ? AND removed_at IS NULL
          )
          AND property_id = 'status'
      `,
          )
          .run(card.id);
        database
          .prepare(
            "DELETE FROM database_view_page_positions WHERE page_block_id = ?",
          )
          .run(card.id);

        const oldResults = await searchPages({
          projectIds: [project.id],
          query: "legacy-needle",
        });
        const currentResults = await searchPages({
          projectIds: [project.id],
          query: "current-needle",
        });
        const wrongScope = await searchPages({
          projectIds: [otherProject.id],
          query: "current-needle",
        });

        expect(oldResults.length).toBe(0);
        expect(currentResults.length).toBe(1);
        expect(currentResults[0]?.pageId).toBe(card.id);
        expect(currentResults[0]?.status).toBe("ship");
        expect(
          currentResults[0]?.excerpt.includes("current-needle"),
        ).toBe(true);
        expect(wrongScope.length).toBe(0);

        putProjectResourceGrantInDatabase(database, {
          projectId: otherProject.id,
          root: { kind: "page", pageId: card.id },
          access: "read",
        });
        const granted = await searchPages({
          projectIds: [otherProject.id],
          query: "current-needle",
        });
        expect(granted).toMatchObject([
          { projectId: otherProject.id, pageId: card.id, status: "ship" },
        ]);
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_HOME;
      }
    },
  );
});
