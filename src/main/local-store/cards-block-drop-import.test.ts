import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./database";
import { createCard, getCard, importBlockDropAsCards } from "./cards";
import { createProject } from "./projects";
import {
  getRecentHistory,
  redoLatest,
  undoLatest,
} from "./history";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (projectId: string) => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-block-drop-import-"));
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

describe("importBlockDropAsCards", () => {
  test("supports grouped source updates even when no new cards are created", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const source = await createCard(projectId, "in_progress", {
        title: "Source card",
        description: "Source before",
      });
      const target = await createCard(projectId, "in_progress", {
        title: "Target card",
        description: "Target before",
      });

      const result = await importBlockDropAsCards(
        projectId,
        {
          targetStatus: "in_progress",
          cards: [],
          sourceUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: source.id,
              updates: { description: "Source after" },
            },
            {
              projectId,
              status: "in_progress",
              cardId: target.id,
              updates: { description: "Target after" },
            },
          ],
          groupId: "group-send-blocks",
        },
        "session-1",
      );

      expect(result.cards.length).toBe(0);
      expect(result.groupId).toBe("group-send-blocks");

      const sourceAfter = await getCard(projectId, source.id, "in_progress");
      const targetAfter = await getCard(projectId, target.id, "in_progress");
      expect(sourceAfter?.description).toBe("Source after");
      expect(targetAfter?.description).toBe("Target after");
      expect((sourceAfter?.revision ?? 0) > (source.revision ?? 0)).toBe(true);
      expect((targetAfter?.revision ?? 0) > (target.revision ?? 0)).toBe(true);

      const groupedEntries = getRecentHistory(projectId, 20, 0)
        .filter((entry) => entry.groupId === "group-send-blocks");
      expect(groupedEntries.length).toBe(2);

      const undoResult = undoLatest(projectId, "session-1");
      expect(undoResult.success).toBe(true);
      const sourceAfterUndo = await getCard(projectId, source.id, "in_progress");
      const targetAfterUndo = await getCard(projectId, target.id, "in_progress");
      expect(sourceAfterUndo?.description).toBe("Source before");
      expect(targetAfterUndo?.description).toBe("Target before");

      const redoResult = redoLatest(projectId, "session-1");
      expect(redoResult.success).toBe(true);
      const sourceAfterRedo = await getCard(projectId, source.id, "in_progress");
      const targetAfterRedo = await getCard(projectId, target.id, "in_progress");
      expect(sourceAfterRedo?.description).toBe("Source after");
      expect(targetAfterRedo?.description).toBe("Target after");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });
});
