import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { primaryCanvasBlockId } from "../../shared/block-documents";
import {
  getOwnedBlockDocumentDescriptor,
  getOwnedDocumentDescriptor,
} from "./block-document-cutover";
import { createCard } from "./cards";
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

describe("owned Document descriptor lookup", () => {
  sqliteTest("dispatches Card and Canvas owners by registered sync engine", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-owned-document-descriptor-"),
    );
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Owned descriptor engines" });
      const card = await createCard(project.id, "draft", {
        title: "Yjs Card",
      });
      const database = getDb();

      const cardDescriptor = getOwnedDocumentDescriptor(
        database,
        project.id,
        card.id,
      );
      expect(cardDescriptor.sync.kind).toBe("yjs");
      if (cardDescriptor.sync.kind !== "yjs") {
        throw new Error("Expected a Yjs Card descriptor");
      }
      expect(cardDescriptor.sync.stateVector.byteLength).toBeGreaterThan(0);

      const canvasDescriptor = getOwnedDocumentDescriptor(
        database,
        project.id,
        primaryCanvasBlockId(project.id),
      );
      expect(canvasDescriptor.sync).toEqual({ kind: "canvas_scene" });
      expect("stateVector" in canvasDescriptor.sync).toBe(false);

      const legacyCanvasDescriptor = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        primaryCanvasBlockId(project.id),
      );
      expect(legacyCanvasDescriptor.authority).toBe("ydoc_primary");
      expect(legacyCanvasDescriptor.stateVector.byteLength).toBe(0);
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });
});
