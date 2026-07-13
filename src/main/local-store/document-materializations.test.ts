import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import {
  DocumentMaterializationStoreError,
  persistCardDocumentMaterialization,
} from "./document-materializations";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

describe("document materialization store", () => {
  sqliteTest("persists the complete content projection through one row", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE document_materializations (
          document_id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          projected_seq INTEGER NOT NULL,
          schema_version INTEGER NOT NULL,
          title TEXT NOT NULL,
          title_rich_json TEXT NOT NULL,
          title_rich_hash TEXT NOT NULL,
          nfm TEXT NOT NULL,
          plain_text TEXT NOT NULL,
          preview TEXT NOT NULL,
          block_tree_json TEXT NOT NULL,
          references_json TEXT NOT NULL,
          asset_refs_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) WITHOUT ROWID
      `);
      persistCardDocumentMaterialization(database, {
        documentId: "document:test",
        generation: 1,
        projectedSeq: 7,
        updatedAt: "2026-07-11T00:00:00.000Z",
        materialization: {
          schemaVersion: 1,
          title: "Canonical title",
          richTitle: [
            { type: "text", text: "Canonical title", styles: {} },
          ],
          nfm: "Body",
          plainText: "Body",
          preview: "Body",
          blockTree: [
            {
              id: "body-block",
              type: "paragraph",
              props: {},
              content: "Body",
              children: [],
            },
          ],
          references: [
            {
              kind: "block",
              sourceBlockId: "body-block",
              targetBlockId: "target-block",
            },
          ],
          assetRefs: [
            {
              sourceBlockId: "body-block",
              kind: "attachment",
              source: "nodex://assets/file.txt",
              managedFileName: "file.txt",
            },
          ],
        },
      });

      const row = database
        .prepare(
          `
        SELECT projected_seq, title, title_rich_json, title_rich_hash,
               references_json, asset_refs_json
        FROM document_materializations WHERE document_id = 'document:test'
      `,
        )
        .get() as {
        projected_seq: number;
        title: string;
        title_rich_json: string;
        title_rich_hash: string;
        references_json: string;
        asset_refs_json: string;
      };
      expect(row.projected_seq).toBe(7);
      expect(row.title).toBe("Canonical title");
      expect(JSON.parse(row.title_rich_json)).toEqual([
        { type: "text", text: "Canonical title", styles: {} },
      ]);
      expect(row.title_rich_hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.parse(row.references_json).length).toBe(1);
      expect(JSON.parse(row.asset_refs_json).length).toBe(1);
    } finally {
      database.close();
    }
  });

  test("rejects invalid projection sequence before touching SQLite", () => {
    let rejected = false;
    try {
      persistCardDocumentMaterialization({} as Database.Database, {
        documentId: "document:test",
        generation: 1,
        projectedSeq: -1,
        materialization: {
          schemaVersion: 1,
          title: "",
          richTitle: [],
          nfm: "",
          plainText: "",
          preview: "",
          blockTree: [],
          references: [],
          assetRefs: [],
        },
      });
    } catch (error) {
      rejected = error instanceof DocumentMaterializationStoreError;
    }
    expect(rejected).toBe(true);
  });
});
