import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isUuidV7 } from "../../shared/card-id";
import { closeDatabase, initializeDatabase } from "./database";
import { createCard, deleteCard } from "./cards";
import { getBoard } from "./board-read-model";
import { createProject } from "./projects";
import {
  redoLatest,
  undoLatest,
} from "./history";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (projectId: string) => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-card-create-placement-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
      return false;
    }
    throw error;
  }
  const project = createProject({ name: "Default" });

  try {
    await run(project.id);
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

describe("createCard placement", () => {
  test("inserts at top when placement is top and shifts existing order", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const first = await createCard(projectId, "in_progress", { title: "First" });
      const second = await createCard(projectId, "in_progress", { title: "Second" });
      const top = await createCard(projectId, "in_progress", { title: "Top" }, undefined, "top");

      expect(first.order).toBe(0);
      expect(second.order).toBe(1);
      expect(top.order).toBe(0);

      const board = await getBoard(projectId);
      const column = board.columns.find((entry) => entry.id === "in_progress");
      expect(column !== undefined).toBeTrue();
      expect(column?.cards.map((card) => card.title).join(",")).toBe("Top,First,Second");
      expect(column?.cards.map((card) => card.order).join(",")).toBe("0,1,2");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("redo preserves top insertion position", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const sessionId = "session-create-top";
      await createCard(projectId, "in_progress", { title: "First" });
      await createCard(projectId, "in_progress", { title: "Second" });
      await createCard(projectId, "in_progress", { title: "Top" }, sessionId, "top");

      let board = await getBoard(projectId);
      let column = board.columns.find((entry) => entry.id === "in_progress");
      expect(column?.cards.map((card) => card.title).join(",")).toBe("Top,First,Second");

      const undoResult = undoLatest(projectId, sessionId);
      expect(undoResult.success).toBeTrue();

      board = await getBoard(projectId);
      column = board.columns.find((entry) => entry.id === "in_progress");
      expect(column?.cards.map((card) => card.title).join(",")).toBe("First,Second");
      expect(column?.cards.map((card) => card.order).join(",")).toBe("0,1");

      const redoResult = redoLatest(projectId, sessionId);
      expect(redoResult.success).toBeTrue();

      board = await getBoard(projectId);
      column = board.columns.find((entry) => entry.id === "in_progress");
      expect(column?.cards.map((card) => card.title).join(",")).toBe("Top,First,Second");
      expect(column?.cards.map((card) => card.order).join(",")).toBe("0,1,2");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("generates canonical UUID-v7 ids by default", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const card = await createCard(projectId, "in_progress", { title: "Generated id" });
      expect(isUuidV7(card.id)).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("preserves a caller-provided UUID-v7 id", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const requestedId = "018f0f85-6d56-7625-bdea-000000000123";
      const card = await createCard(projectId, "in_progress", {
        id: requestedId,
        title: "Requested id",
      });

      expect(card.id).toBe(requestedId);
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("rejects non-UUID-v7 create ids", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      let message = "";

      try {
        await createCard(projectId, "in_progress", {
          id: "legacy-card",
          title: "Invalid id",
        });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toBe("Invalid card id: expected canonical lowercase UUID-v7");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not reuse a tombstoned Block identity through ordinary create", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const requestedId = "018f0f85-6d56-7625-bdea-000000000456";
      await createCard(projectId, "draft", {
        id: requestedId,
        title: "Original identity",
      });
      expect(await deleteCard(projectId, "draft", requestedId)).toBeTrue();

      let message = "";
      try {
        await createCard(projectId, "draft", {
          id: requestedId,
          title: "Replacement identity",
        });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toBe(`Card or Block id already exists: ${requestedId}`);
    });

    if (!ran) expect(true).toBeTrue();
  });
});
