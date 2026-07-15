import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { openCardDocument } from "../../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import {
  CardReadStoreError,
  rebuildCardReadModelProjection,
} from "./card-read-store";
import {
  createCard,
  getBoard,
  getDatabaseRowCard,
  getDatabaseRowsDetails,
  readColumn,
} from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";

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

const findFirstXmlText = (
  root: Y.XmlFragment | Y.XmlElement,
): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = findFirstXmlText(child);
    if (nested) return nested;
  }
  return null;
};

const editPrimaryCardDocument = (
  database: Database.Database,
  documentId: string,
  title: string,
  body: string,
): void => {
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const beforeEdit = Y.encodeStateVector(loaded.document);
    const envelope = openCardDocument(loaded.document);
    const bodyText = findFirstXmlText(envelope.body);
    if (!bodyText) throw new Error("Expected the genesis paragraph text");

    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
      bodyText.delete(0, bodyText.length);
      bodyText.insert(0, body);
    }, "card-read-store-test");

    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: `card-read-store:${title}`,
      clientSessionId: "card-read-store-window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, beforeEdit),
    });
  } finally {
    loaded.document.destroy();
  }
};

const updateDatabaseValue = (
  database: Database.Database,
  cardId: string,
  key: string,
  value: unknown,
): void => {
  database
    .prepare(
      `
    UPDATE database_property_values
    SET value_json = ?, revision = revision + 1,
        updated_at = '2026-07-11T00:00:00.000Z'
    WHERE membership_id = (
        SELECT id FROM database_memberships
        WHERE card_block_id = ? AND removed_at IS NULL
      )
      AND property_id = database_block_id || ':property:' || ?
  `,
    )
    .run(JSON.stringify(value), cardId, key);
};

const updateIntrinsicValue = (
  database: Database.Database,
  cardId: string,
  key: string,
  value: unknown,
): void => {
  database
    .prepare(
      `
    UPDATE block_properties
    SET value_json = ?, revision = revision + 1,
        updated_at = '2026-07-11T00:00:00.000Z'
    WHERE block_id = ? AND property_key = ?
  `,
    )
    .run(JSON.stringify(value), cardId, key);
};

const readBoardCard = async (projectId: string, cardId: string) => {
  const board = await getBoard(projectId);
  return board.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId);
};

describe("authoritative Card reads", () => {
  sqliteTest(
    "reads Database members without manual View positions at the stable tail",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-card-read-unpositioned-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        const project = createProject({ name: "Unpositioned Database rows" });
        const positioned = await createCard(project.id, "backlog", {
          title: "Positioned",
        });
        const unpositioned = await createCard(project.id, "backlog", {
          title: "Unpositioned",
        });
        const database = getDb();
        database
          .prepare(
            "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
          )
          .run(unpositioned.id, project.id);

        const byId = await getDatabaseRowCard(project.id, unpositioned.id);
        const board = await getBoard(project.id);
        const backlog = board.columns.find((column) => column.id === "backlog");

        expect(byId?.status).toBe("backlog");
        expect(byId?.order).toBe(Number.MAX_SAFE_INTEGER);
        expect(backlog?.cards.map((card) => card.id)).toEqual([
          positioned.id,
          unpositioned.id,
        ]);
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_DIR;
      }
    },
  );

  sqliteTest(
    "assembles every full Card API from Block, Document, and relational metadata authorities",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-card-read-store-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        const project = createProject({ name: "Authoritative Card reads" });
        const created = await createCard(project.id, "in_progress", {
          title: "Legacy title",
          description: "Legacy body",
          priority: "p1-high",
          estimate: "m",
          tags: ["legacy"],
          assignee: "Legacy owner",
          runInBaseBranch: "legacy-branch",
        });
        const database = getDb();
        const descriptor = getOwnedBlockDocumentDescriptor(
          database,
          project.id,
          created.id,
        );

        editPrimaryCardDocument(
          database,
          descriptor.documentId,
          "Primary title",
          "Primary body",
        );

        updateDatabaseValue(database, created.id, "priority", "p0-critical");
        updateDatabaseValue(database, created.id, "estimate", "xl");
        updateDatabaseValue(database, created.id, "tags", [
          "relational",
          "fresh",
        ]);
        updateDatabaseValue(
          database,
          created.id,
          "assignee",
          "Relational owner",
        );
        updateIntrinsicValue(
          database,
          created.id,
          "run.baseBranch",
          "relational-branch",
        );
        updateIntrinsicValue(database, created.id, "run.target", "newWorktree");
        database
          .prepare(
            `
        UPDATE blocks
        SET metadata_revision = metadata_revision + 1,
            updated_at = '2026-07-11T00:00:00.000Z'
        WHERE id = ?
      `,
          )
          .run(created.id);

        expect(
          database
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
            )
            .get() === undefined,
        ).toBe(true);

        const byId = await getDatabaseRowCard(project.id, created.id);
        const details = await getDatabaseRowsDetails(project.id, {
          cardIds: [created.id],
        });
        const column = await readColumn(project.id, "in_progress");
        const boardCard = await readBoardCard(project.id, created.id);
        for (const card of [byId, details[0], column.cards[0], boardCard]) {
          expect(card?.title).toBe("Primary title");
          expect(card?.richTitle).toEqual([
            { type: "text", text: "Primary title", styles: {} },
          ]);
          expect(card?.description).toBe("Primary body");
          expect(card?.priority).toBe("p0-critical");
          expect(card?.estimate).toBe("xl");
          expect(card?.tags.join(",")).toBe("relational,fresh");
          expect(card?.assignee).toBe("Relational owner");
          expect(card?.runInBaseBranch).toBe("relational-branch");
          expect(card?.runInTarget).toBe("newWorktree");
        }
        expect(
          (await getDatabaseRowCard(project.id, created.id, "done")) === null,
        ).toBe(true);

        database.transaction(() => {
          rebuildCardReadModelProjection(database, project.id, [created.id]);
        })();
        const projection = database
          .prepare(
            `
        SELECT title, description_preview, document_projected_seq,
               database_values_json, intrinsic_properties_json
        FROM card_read_model WHERE card_block_id = ?
      `,
          )
          .get(created.id) as {
          title: string;
          description_preview: string;
          document_projected_seq: number;
          database_values_json: string;
          intrinsic_properties_json: string;
        };
        expect(projection.title).toBe("Primary title");
        expect(projection.description_preview).toBe("Primary body");
        expect(JSON.parse(projection.database_values_json).priority).toBe(
          "p0-critical",
        );
        expect(
          JSON.parse(projection.intrinsic_properties_json)["run.baseBranch"],
        ).toBe("relational-branch");

        closeDatabase();
        await initializeDatabase();
        const restarted = await getDatabaseRowCard(project.id, created.id);
        expect(restarted?.title).toBe("Primary title");
        expect(restarted?.description).toBe("Primary body");
        expect(restarted?.priority).toBe("p0-critical");
        expect(restarted?.runInBaseBranch).toBe("relational-branch");
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_DIR;
      }
    },
  );

  sqliteTest(
    "fails closed instead of serving a stale materialization or Card projection",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-card-read-freshness-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        const project = createProject({ name: "Card read freshness" });
        const created = await createCard(project.id, "draft", {
          title: "Fresh title",
          description: "Fresh body",
        });
        const database = getDb();
        const descriptor = getOwnedBlockDocumentDescriptor(
          database,
          project.id,
          created.id,
        );
        database.transaction(() => {
          rebuildCardReadModelProjection(database, project.id, [created.id]);
        })();

        database
          .prepare(
            `
        UPDATE documents SET head_seq = head_seq + 1 WHERE id = ?
      `,
          )
          .run(descriptor.documentId);

        let errorCode: string | null = null;
        try {
          await getDatabaseRowCard(project.id, created.id);
        } catch (error) {
          errorCode =
            error instanceof CardReadStoreError ? error.code : "unexpected";
        }
        expect(errorCode).toBe("card_materialization_stale");

        const staleProjection = database
          .prepare(
            `
        SELECT title FROM card_read_model WHERE card_block_id = ?
      `,
          )
          .get(created.id) as { title: string };
        expect(staleProjection.title).toBe("Fresh title");

        database
          .prepare(
            `
        UPDATE document_materializations
        SET projected_seq = projected_seq + 1
        WHERE document_id = ?
      `,
          )
          .run(descriptor.documentId);
        const recovered = await getDatabaseRowCard(project.id, created.id);
        expect(recovered?.title).toBe("Fresh title");

        closeDatabase();
        await initializeDatabase();
        expect((await getDatabaseRowCard(project.id, created.id))?.description).toBe(
          "Fresh body",
        );
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_DIR;
      }
    },
  );
});
