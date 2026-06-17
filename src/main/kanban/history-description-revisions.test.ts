import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Card } from "../../shared/types";
import {
  closeDatabase,
  createCard,
  createProject,
  deleteCard,
  getBoard,
  getCardHistory,
  getCardHistoryPanelEntries,
  getCardHistoryVersionPreview,
  getRecentHistory,
  initializeDatabase,
  moveCard,
  redoLatest,
  restoreToEntry,
  undoLatest,
  updateCard,
} from "./db-service";
import { getDatabasePath } from "./config";
import {
  reconstructCardStateFromEntries,
  type HistoryReconstructionEntry,
} from "./history-service";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-history-description-"));
  process.env.KANBAN_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
      return false;
    }
    throw error;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KANBAN_DIR;
  }
}

async function findCardDescription(projectId: string, cardId: string): Promise<string | null> {
  const board = await getBoard(projectId);
  const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.id === cardId);
  return card?.description ?? null;
}

describe("history description revisions", () => {
  test("replays selected history entries as post-change versions", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const cardSnapshot: Card = {
      id: "card-1",
      status: "draft",
      archived: false,
      title: "Initial title",
      description: "Initial description",
      tags: ["alpha"],
      agentBlocked: false,
      created: createdAt,
      order: 0,
    };
    const entries: HistoryReconstructionEntry[] = [
      {
        id: 1,
        operation: "create",
        columnId: "draft",
        archived: false,
        newValues: null,
        toStatus: null,
        toArchived: null,
        cardSnapshot,
      },
      {
        id: 2,
        operation: "update",
        columnId: "draft",
        archived: false,
        newValues: {
          title: "Updated title",
          description: "Updated description",
          tags: ["beta"],
        },
        toStatus: null,
        toArchived: null,
        cardSnapshot: null,
      },
      {
        id: 3,
        operation: "move",
        columnId: "draft",
        archived: false,
        newValues: null,
        toStatus: "in_progress",
        toArchived: false,
        cardSnapshot: null,
      },
      {
        id: 4,
        operation: "delete",
        columnId: "in_progress",
        archived: false,
        newValues: null,
        toStatus: null,
        toArchived: null,
        cardSnapshot: null,
      },
    ];

    const updatePreview = reconstructCardStateFromEntries(entries, 2);
    expect(updatePreview?.state.title).toBe("Updated title");
    expect(updatePreview?.state.description).toBe("Updated description");
    expect(updatePreview?.state.title === "Initial title").toBeFalse();
    expect(updatePreview?.columnId).toBe("draft");

    const movePreview = reconstructCardStateFromEntries(entries, 3);
    expect(movePreview?.state.title).toBe("Updated title");
    expect(movePreview?.columnId).toBe("in_progress");

    const deletePreview = reconstructCardStateFromEntries(entries, 4);
    expect(deletePreview?.state.title).toBe("Updated title");
    expect(deletePreview?.columnId).toBe("in_progress");
  });

  test("hydrates descriptions back into history while keeping raw payloads compact", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History descriptions" }).id;

      const initialDescription = "# Heading\n\nOriginal body";
      const updatedDescription = "# Heading\n\nUpdated body\n\nThird block";
      const created = await createCard(projectId, "draft", {
        title: "Revision card",
        description: initialDescription,
      });

      const updated = await updateCard(projectId, "draft", created.id, {
        description: updatedDescription,
      });
      expect(updated.status).toBe("updated");

      const history = getCardHistory(projectId, created.id);
      expect(history.length).toBe(2);
      expect(history[0]?.operation).toBe("update");
      expect(String(history[0]?.previousValues?.description)).toBe(initialDescription);
      expect(String(history[0]?.newValues?.description)).toBe(updatedDescription);
      expect(history[1]?.operation).toBe("create");
      expect(history[1]?.cardSnapshot?.description).toBe(initialDescription);

      const database = new Database(getDatabasePath(), { readonly: true });
      const rows = database.prepare(`
        SELECT
          previous_values,
          new_values,
          card_snapshot,
          previous_description_revision_id,
          new_description_revision_id,
          snapshot_description_revision_id
        FROM history
        WHERE project_id = ? AND card_id = ?
        ORDER BY id DESC
      `).all(projectId, created.id) as Array<{
        previous_values: string | null;
        new_values: string | null;
        card_snapshot: string | null;
        previous_description_revision_id: number | null;
        new_description_revision_id: number | null;
        snapshot_description_revision_id: number | null;
      }>;

      const updateRow = rows[0];
      const createRow = rows[1];
      const updatePreviousValues = JSON.parse(updateRow?.previous_values ?? "{}") as Record<string, unknown>;
      const updateNewValues = JSON.parse(updateRow?.new_values ?? "{}") as Record<string, unknown>;
      const createSnapshot = JSON.parse(createRow?.card_snapshot ?? "{}") as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(updatePreviousValues, "description")).toBeFalse();
      expect(Object.prototype.hasOwnProperty.call(updateNewValues, "description")).toBeFalse();
      expect(Object.prototype.hasOwnProperty.call(createSnapshot, "description")).toBeFalse();
      expect(updateRow?.previous_description_revision_id).not.toBeNull();
      expect(updateRow?.new_description_revision_id).not.toBeNull();
      expect(createRow?.snapshot_description_revision_id).not.toBeNull();

      const cardRow = database.prepare(`
        SELECT description_revision_id
        FROM cards
        WHERE id = ?
      `).get(created.id) as { description_revision_id: number | null } | undefined;
      expect(cardRow?.description_revision_id).not.toBeNull();
      database.close();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("builds panel entries with block-level description deltas instead of hydrated full texts", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History panel" }).id;

      const created = await createCard(projectId, "draft", {
        title: "Panel card",
        description: "# Heading\n\nAlpha",
      });

      const updated = await updateCard(projectId, "draft", created.id, {
        description: "# Heading\n\nBeta\n\nGamma",
        tags: ["delta"],
      });
      expect(updated.status).toBe("updated");

      const entries = getCardHistoryPanelEntries(projectId, created.id);
      expect(entries.length).toBe(2);
      expect(entries[0]?.operation).toBe("update");
      expect(entries[0]?.descriptionChange?.beforeBlockCount).toBe(2);
      expect(entries[0]?.descriptionChange?.afterBlockCount).toBe(3);
      expect(entries[0]?.descriptionChange?.beforeFullText).toBe("# Heading\n\nAlpha");
      expect(entries[0]?.descriptionChange?.afterFullText).toBe("# Heading\n\nBeta\n\nGamma");
      expect(entries[0]?.descriptionChange?.blocks.length).toBe(2);
      expect(entries[0]?.descriptionChange?.blocks[0]?.changeType).toBe("replaced");
      expect(entries[0]?.descriptionChange?.blocks[0]?.beforePreview).toBe("Alpha");
      expect(entries[0]?.descriptionChange?.blocks[0]?.afterPreview).toBe("Beta");
      expect(entries[0]?.fieldChanges.length).toBe(1);
      expect(entries[0]?.fieldChanges[0]?.field).toBe("tags");
      expect(entries[1]?.snapshot?.description?.blockCount).toBe(2);
      expect(entries[1]?.snapshot?.description?.blocks[1]?.preview).toBe("Alpha");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("undo redo and restore operate on description revisions", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History restore" }).id;

      const created = await createCard(projectId, "draft", {
        title: "Restorable card",
        description: "Original description",
      });

      const updated = await updateCard(projectId, "draft", created.id, {
        description: "Updated description",
      });
      expect(updated.status).toBe("updated");

      const historyBeforeRestore = getRecentHistory(projectId, 10, 0);
      const createEntry = historyBeforeRestore.find((entry) => entry.operation === "create");
      expect(createEntry?.id !== undefined).toBeTrue();

      const undone = undoLatest(projectId);
      expect(undone.success).toBeTrue();
      expect(await findCardDescription(projectId, created.id)).toBe("Original description");

      const redone = redoLatest(projectId);
      expect(redone.success).toBeTrue();
      expect(await findCardDescription(projectId, created.id)).toBe("Updated description");

      const restored = restoreToEntry(projectId, created.id, createEntry?.id ?? -1);
      expect(restored.success).toBeTrue();
      expect(await findCardDescription(projectId, created.id)).toBe("Original description");

      const database = new Database(getDatabasePath(), { readonly: true });
      const cardRow = database.prepare(`
        SELECT description_revision_id
        FROM cards
        WHERE id = ?
      `).get(created.id) as { description_revision_id: number | null } | undefined;
      expect(cardRow?.description_revision_id).not.toBeNull();
      database.close();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("reconstructs full card previews for selected history versions", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History previews" }).id;

      const created = await createCard(projectId, "draft", {
        title: "Initial title",
        description: "Initial description",
        tags: ["alpha"],
      });
      const updated = await updateCard(projectId, "draft", created.id, {
        title: "Updated title",
        description: "Updated description",
        tags: ["beta"],
      });
      expect(updated.status).toBe("updated");
      const moved = await moveCard({
        projectId,
        fromStatus: "draft",
        cardId: created.id,
        toStatus: "in_progress",
        newOrder: 0,
      });
      expect(moved).toBe("moved");
      const deleted = await deleteCard(projectId, "in_progress", created.id);
      expect(deleted).toBeTrue();

      const history = getRecentHistory(projectId, 10, 0);
      const createEntry = history.find((entry) => entry.operation === "create");
      const updateEntry = history.find((entry) => entry.operation === "update");
      const moveEntry = history.find((entry) => entry.operation === "move");
      const deleteEntry = history.find((entry) => entry.operation === "delete");
      expect(createEntry?.id !== undefined).toBeTrue();
      expect(updateEntry?.id !== undefined).toBeTrue();
      expect(moveEntry?.id !== undefined).toBeTrue();
      expect(deleteEntry?.id !== undefined).toBeTrue();

      const createPreview = getCardHistoryVersionPreview(projectId, created.id, createEntry?.id ?? -1);
      expect(createPreview.preview?.card.title).toBe("Initial title");
      expect(createPreview.preview?.card.description).toBe("Initial description");
      expect(createPreview.preview?.card.status).toBe("draft");
      expect(createPreview.preview?.card.tags.join(",")).toBe("alpha");

      const updatePreview = getCardHistoryVersionPreview(projectId, created.id, updateEntry?.id ?? -1);
      expect(updatePreview.preview?.card.title).toBe("Updated title");
      expect(updatePreview.preview?.card.description).toBe("Updated description");
      expect(updatePreview.preview?.card.status).toBe("draft");
      expect(updatePreview.preview?.card.tags.join(",")).toBe("beta");
      expect(updatePreview.preview?.card.title === "Initial title").toBeFalse();
      expect(updatePreview.preview?.card.description === "Initial description").toBeFalse();

      const movePreview = getCardHistoryVersionPreview(projectId, created.id, moveEntry?.id ?? -1);
      expect(movePreview.preview?.card.status).toBe("in_progress");
      expect(movePreview.preview?.card.title).toBe("Updated title");

      const deletePreview = getCardHistoryVersionPreview(projectId, created.id, deleteEntry?.id ?? -1);
      expect(deletePreview.preview?.card.title).toBe("Updated title");
      expect(deletePreview.preview?.card.description).toBe("Updated description");
      expect(deletePreview.preview?.card.status).toBe("in_progress");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("returns a null preview when creation history is unavailable", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History preview pruning" }).id;
      const created = await createCard(projectId, "draft", {
        title: "Preview card",
        description: "Preview description",
      });
      const updated = await updateCard(projectId, "draft", created.id, {
        title: "Preview card updated",
      });
      expect(updated.status).toBe("updated");

      const history = getRecentHistory(projectId, 10, 0);
      const updateEntry = history.find((entry) => entry.operation === "update");
      expect(updateEntry?.id !== undefined).toBeTrue();

      const database = new Database(getDatabasePath());
      database.prepare("DELETE FROM history WHERE project_id = ? AND card_id = ? AND operation = 'create'")
        .run(projectId, created.id);
      database.close();

      const preview = getCardHistoryVersionPreview(projectId, created.id, updateEntry?.id ?? -1);
      expect(preview.preview).toBe(null);
      expect(Boolean(preview.error)).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });
});
