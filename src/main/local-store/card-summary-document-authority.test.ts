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
  createCard,
  getBoardSummary,
  readCardSummaryById,
} from "./cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "./database";
import { createProject } from "./projects";

const supportsBetterSqlite3 = (): boolean => {
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

const readBoardCard = async (projectId: string, cardId: string) => {
  const board = await getBoardSummary(projectId);
  return board.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId);
};

describe("Card summary Document authority", () => {
  sqliteTest("reads primary content from the committed materialization across restart", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-card-summary-authority-"));
    process.env.NODEX_DIR = tempDir;

    try {
      await initializeDatabase();
      const project = createProject({ name: "Summary authority" });
      const card = await createCard(project.id, "in_progress", {
        title: "Legacy title",
        description: "Legacy body",
        priority: "p1-high",
        estimate: "m",
        tags: ["alpha", "beta"],
        assignee: "Ada",
      });

      const initialById = readCardSummaryById(card.id);
      const initialBoard = await readBoardCard(project.id, card.id);
      expect(initialById?.title).toBe("Legacy title");
      expect(initialById?.descriptionPreview).toBe("Legacy body");
      expect(initialBoard?.title).toBe(initialById?.title);
      expect(initialBoard?.descriptionLength).toBe(initialById?.descriptionLength);

      const database = getDb();
      const descriptor = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        card.id,
      );
      const loaded = loadPrimaryBlockDocument(database, descriptor.documentId);
      try {
        const beforeEdit = Y.encodeStateVector(loaded.document);
        const envelope = openCardDocument(loaded.document);
        const bodyText = findFirstXmlText(envelope.body);
        expect(bodyText instanceof Y.XmlText).toBe(true);
        if (!bodyText) throw new Error("Expected the genesis paragraph text");

        loaded.document.transact(() => {
          envelope.title.delete(0, envelope.title.length);
          envelope.title.insert(0, "Primary title");
          bodyText.delete(0, bodyText.length);
          bodyText.insert(0, "Primary body after collaboration");
        }, "card-summary-authority-test");

        const update = Y.encodeStateAsUpdate(loaded.document, beforeEdit);
        applyBlockDocumentUpdate(database, {
          documentId: descriptor.documentId,
          storeEpoch: loaded.storeEpoch,
          generation: descriptor.generation,
          updateId: "card-summary-authority-update",
          clientSessionId: "card-summary-authority-window",
          baseHeadSeq: descriptor.headSeq,
          touchedBlockIds: [],
          update,
        });
      } finally {
        loaded.document.destroy();
      }

      closeDatabase();
      await initializeDatabase();

      const restartedById = readCardSummaryById(card.id);
      const restartedBoard = await readBoardCard(project.id, card.id);
      expect(restartedById?.title).toBe("Primary title");
      expect(restartedById?.descriptionPreview).toBe(
        "Primary body after collaboration",
      );
      expect(restartedById?.descriptionLength).toBe(
        "Primary body after collaboration".length,
      );
      expect(restartedById?.hasDescription).toBe(true);
      expect(restartedBoard?.title).toBe(restartedById?.title);
      expect(restartedBoard?.descriptionPreview).toBe(
        restartedById?.descriptionPreview,
      );
      expect(restartedBoard?.descriptionLength).toBe(
        restartedById?.descriptionLength,
      );
      expect(restartedBoard?.hasDescription).toBe(restartedById?.hasDescription);

      expect(restartedById?.status).toBe("in_progress");
      expect(restartedById?.priority).toBe("p1-high");
      expect(restartedById?.estimate).toBe("m");
      expect(restartedById?.tags.join(",")).toBe("alpha,beta");
      expect(restartedById?.assignee).toBe("Ada");
      expect(restartedBoard?.priority).toBe(restartedById?.priority);
      expect(restartedBoard?.tags.join(",")).toBe(
        restartedById?.tags.join(","),
      );
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });
});
