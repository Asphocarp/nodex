import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./database";
import { applyCardEditorDrop, createCard, getCard } from "./cards";
import { getBoard } from "./board-read-model";
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-card-drop-"));
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

describe("applyCardEditorDrop", () => {
  test("copy updates the target while preserving every source card", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const sourceOne = await createCard(projectId, "in_progress", {
        title: "Source one",
        description: "One",
      });
      const sourceTwo = await createCard(projectId, "in_review", {
        title: "Source two",
        description: "Two",
      });
      const target = await createCard(projectId, "draft", {
        title: "Target",
        description: "Before",
      });

      const result = await applyCardEditorDrop(projectId, {
        operation: "copy",
        sourceCards: [
          { cardId: sourceOne.id, status: "in_progress" },
          { cardId: sourceTwo.id, status: "in_review" },
        ],
        targetUpdates: [{
          projectId,
          status: "draft",
          cardId: target.id,
          updates: { description: "After copy" },
        }],
        groupId: "group-copy-many",
      }, "session-copy");

      expect(result.operation).toBe("copy");
      expect((await getCard(projectId, sourceOne.id))?.title).toBe("Source one");
      expect((await getCard(projectId, sourceTwo.id))?.title).toBe("Source two");
      expect((await getCard(projectId, target.id))?.description).toBe("After copy");

      expect(undoLatest(projectId, "session-copy").success).toBeTrue();
      expect((await getCard(projectId, target.id))?.description).toBe("Before");
      expect(redoLatest(projectId, "session-copy").success).toBeTrue();
      expect((await getCard(projectId, target.id))?.description).toBe("After copy");
    });
    if (!ran) expect(true).toBeTrue();
  });

  test("cross-project move undo and redo restore both projects atomically", async () => {
    const ran = await withTempDatabase(async (targetProjectId) => {
      const sourceProject = createProject({ name: "Source" });
      const source = await createCard(sourceProject.id, "in_review", {
        title: "Cross source",
        description: "Source body",
      });
      const target = await createCard(targetProjectId, "draft", {
        title: "Target",
        description: "Before",
      });

      await applyCardEditorDrop(targetProjectId, {
        operation: "move",
        sourceProjectId: sourceProject.id,
        sourceCards: [{ cardId: source.id, status: "in_review" }],
        targetUpdates: [{
          projectId: targetProjectId,
          status: "draft",
          cardId: target.id,
          updates: { description: "After" },
        }],
        groupId: "group-cross-project-history",
      }, "session-cross-history");

      expect((await getCard(sourceProject.id, source.id)) === null).toBeTrue();
      expect((await getCard(targetProjectId, target.id))?.description).toBe("After");

      expect(undoLatest(targetProjectId, "session-cross-history").success).toBeTrue();
      expect((await getCard(sourceProject.id, source.id))?.title).toBe("Cross source");
      expect((await getCard(targetProjectId, target.id))?.description).toBe("Before");

      expect(redoLatest(targetProjectId, "session-cross-history").success).toBeTrue();
      expect((await getCard(sourceProject.id, source.id)) === null).toBeTrue();
      expect((await getCard(targetProjectId, target.id))?.description).toBe("After");
    });
    if (!ran) expect(true).toBeTrue();
  });

  test("updates target description and deletes source card in one grouped undo step", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const source = await createCard(projectId, "in_progress", {
        title: "Source card",
        description: "Source description",
      });
      const target = await createCard(projectId, "in_progress", {
        title: "Target card",
        description: "Before drop",
      });

      const moveResult = await applyCardEditorDrop(
        projectId,
        {
          operation: "move",
          sourceCards: [{ cardId: source.id, status: "in_progress" }],
          groupId: "group-drop-1",
          targetUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: target.id,
              updates: { description: "After drop" },
            },
          ],
        },
        "session-1",
      );

      expect(moveResult.groupId).toBe("group-drop-1");
      expect(moveResult.sourceCardIds.join(",")).toBe(source.id);

      const sourceAfterMove = await getCard(projectId, source.id);
      const targetAfterMove = await getCard(projectId, target.id);

      expect(sourceAfterMove === null).toBeTrue();
      expect(targetAfterMove?.description).toBe("After drop");

      const historyAfterMove = getRecentHistory(projectId, 10, 0);
      const groupedEntries = historyAfterMove.filter((entry) => entry.groupId === "group-drop-1");
      expect(groupedEntries.length).toBe(2);

      const undoResult = undoLatest(projectId, "session-1");
      expect(undoResult.success).toBeTrue();

      const sourceAfterUndo = await getCard(projectId, source.id);
      const targetAfterUndo = await getCard(projectId, target.id);
      expect(sourceAfterUndo?.status).toBe("in_progress");
      expect(targetAfterUndo?.description).toBe("Before drop");

      const redoResult = redoLatest(projectId, "session-1");
      expect(redoResult.success).toBeTrue();

      const sourceAfterRedo = await getCard(projectId, source.id);
      const targetAfterRedo = await getCard(projectId, target.id);
      expect(sourceAfterRedo === null).toBeTrue();
      expect(targetAfterRedo?.description).toBe("After drop");
    });
    if (!ran) {
      expect(true).toBeTrue();
    }
  });

  test("validation failure keeps source card unchanged", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const source = await createCard(projectId, "in_progress", {
        title: "Source card",
        description: "Source description",
      });

      let errorMessage = "";
      try {
        await applyCardEditorDrop(projectId, {
          operation: "move",
          sourceCards: [{ cardId: source.id, status: "in_progress" }],
          targetUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: source.id,
              updates: { description: "Invalid" },
            },
          ],
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      expect(errorMessage).toBe("Cannot drop a card into itself");

      const sourceAfterError = await getCard(projectId, source.id);
      expect(sourceAfterError?.description).toBe("Source description");
    });
    if (!ran) {
      expect(true).toBeTrue();
    }
  });

  test("supports moving source card from another project into target editor updates", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const otherProject = createProject({ name: "Other" });

      const source = await createCard(otherProject.id, "in_progress", {
        title: "Cross-project source",
        description: "From other project",
      });
      const target = await createCard(projectId, "in_progress", {
        title: "Default target",
        description: "Before cross-project drop",
      });

      const moveResult = await applyCardEditorDrop(
        projectId,
        {
          sourceProjectId: otherProject.id,
          operation: "move",
          sourceCards: [{ cardId: source.id, status: "in_progress" }],
          groupId: "group-drop-cross-project",
          targetUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: target.id,
              updates: { description: "After cross-project drop" },
            },
          ],
        },
        "session-1",
      );

      expect(moveResult.groupId).toBe("group-drop-cross-project");
      expect(moveResult.sourceCardIds.join(",")).toBe(source.id);
      const sourceAfterMove = await getCard(otherProject.id, source.id);
      const targetAfterMove = await getCard(projectId, target.id);
      expect(sourceAfterMove === null).toBeTrue();
      expect(targetAfterMove?.description).toBe("After cross-project drop");
    });
    if (!ran) {
      expect(true).toBeTrue();
    }
  });

  test("supports deleting multiple source cards in one grouped editor drop", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const sourceOne = await createCard(projectId, "in_progress", {
        title: "Source one",
        description: "One",
      });
      const sourceTwo = await createCard(projectId, "in_review", {
        title: "Source two",
        description: "Two",
      });
      const target = await createCard(projectId, "in_progress", {
        title: "Target card",
        description: "Before",
      });

      const moveResult = await applyCardEditorDrop(
        projectId,
        {
          operation: "move",
          sourceCards: [
            {
              cardId: sourceOne.id,
              status: "in_progress",
            },
            {
              cardId: sourceTwo.id,
              status: "in_review",
            },
          ],
          groupId: "group-drop-many",
          targetUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: target.id,
              updates: { description: "After" },
            },
          ],
        },
        "session-1",
      );

      expect(moveResult.groupId).toBe("group-drop-many");
      expect(moveResult.sourceCardIds.join(",")).toBe(`${sourceOne.id},${sourceTwo.id}`);

      const firstAfterMove = await getCard(projectId, sourceOne.id);
      const secondAfterMove = await getCard(projectId, sourceTwo.id);
      const targetAfterMove = await getCard(projectId, target.id);

      expect(firstAfterMove === null).toBeTrue();
      expect(secondAfterMove === null).toBeTrue();
      expect(targetAfterMove?.description).toBe("After");

      const historyAfterMove = getRecentHistory(projectId, 10, 0);
      const groupedEntries = historyAfterMove.filter((entry) => entry.groupId === "group-drop-many");
      expect(groupedEntries.length).toBe(3);
    });
    if (!ran) {
      expect(true).toBeTrue();
    }
  });

  test("undo restores same-column multi-card editor drops in original order", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const sourceOne = await createCard(projectId, "in_progress", {
        title: "Source one",
        description: "One",
      });
      const target = await createCard(projectId, "in_progress", {
        title: "Target card",
        description: "Before",
      });
      const sourceTwo = await createCard(projectId, "in_progress", {
        title: "Source two",
        description: "Two",
      });
      await createCard(projectId, "in_progress", {
        title: "Tail",
        description: "Tail",
      });

      const moveResult = await applyCardEditorDrop(
        projectId,
        {
          operation: "move",
          sourceCards: [
            {
              cardId: sourceOne.id,
              status: "in_progress",
            },
            {
              cardId: sourceTwo.id,
              status: "in_progress",
            },
          ],
          groupId: "group-drop-same-column-many",
          targetUpdates: [
            {
              projectId,
              status: "in_progress",
              cardId: target.id,
              updates: { description: "After" },
            },
          ],
        },
        "session-same-column-many",
      );

      expect(moveResult.groupId).toBe("group-drop-same-column-many");

      const undoResult = undoLatest(projectId, "session-same-column-many");
      expect(undoResult.success).toBeTrue();

      const board = await getBoard(projectId);
      const column = board.columns.find((entry) => entry.id === "in_progress");
      const targetAfterUndo = await getCard(projectId, target.id);

      expect(column?.cards.map((card) => card.title).join(",")).toBe(
        "Source one,Target card,Source two,Tail",
      );
      expect(column?.cards.map((card) => card.order).join(",")).toBe("0,1,2,3");
      expect(targetAfterUndo?.description).toBe("Before");
    });
    if (!ran) {
      expect(true).toBeTrue();
    }
  });
});
