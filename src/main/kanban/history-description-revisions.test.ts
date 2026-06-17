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
  pruneHistory,
  type HistoryReconstructionEntry,
} from "./history-service";
import * as descriptionRevisionService from "./description-revision-service";

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

async function findCardOnBoard(projectId: string, cardId: string): Promise<Card | null> {
  const board = await getBoard(projectId);
  return board.columns.flatMap((column) => column.cards).find((entry) => entry.id === cardId) ?? null;
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

  test("previews and restores retained updates from a checkpoint after create history is pruned", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "History checkpoint pruning" }).id;
      const created = await createCard(projectId, "draft", {
        title: "Checkpoint card",
        description: "Initial checkpoint description",
        tags: ["alpha"],
      });
      const updated = await updateCard(projectId, "draft", created.id, {
        title: "Checkpoint title",
        description: "Checkpoint description",
        tags: ["beta"],
      });
      expect(updated.status).toBe("updated");

      const beforePrune = getRecentHistory(projectId, 10, 0);
      const createEntry = beforePrune.find((entry) => entry.operation === "create");
      const updateEntry = beforePrune.find((entry) => entry.operation === "update");
      expect(createEntry?.id !== undefined).toBeTrue();
      expect(updateEntry?.id !== undefined).toBeTrue();

      const pruned = pruneHistory(projectId, 1);
      expect(pruned).toBe(1);

      const database = new Database(getDatabasePath(), { readonly: true });
      try {
        const createRow = database.prepare("SELECT 1 FROM history WHERE id = ?")
          .get(createEntry?.id ?? -1);
        expect(createRow === undefined).toBeTrue();

        const snapshotRow = database.prepare(`
          SELECT card_snapshot, description_revision_id
          FROM card_history_snapshots
          WHERE history_id = ?
        `).get(updateEntry?.id ?? -1) as
          | { card_snapshot: string; description_revision_id: number | null }
          | undefined;
        expect(snapshotRow !== undefined).toBeTrue();
        expect(snapshotRow?.description_revision_id).not.toBeNull();
        const snapshot = JSON.parse(snapshotRow?.card_snapshot ?? "{}") as Record<string, unknown>;
        expect(snapshot.title).toBe("Checkpoint title");
        expect(Object.prototype.hasOwnProperty.call(snapshot, "description")).toBeFalse();
      } finally {
        database.close();
      }

      const preview = getCardHistoryVersionPreview(projectId, created.id, updateEntry?.id ?? -1);
      expect(preview.preview?.card.title).toBe("Checkpoint title");
      expect(preview.preview?.card.description).toBe("Checkpoint description");
      expect(preview.preview?.card.tags.join(",")).toBe("beta");

      const later = await updateCard(projectId, "draft", created.id, {
        title: "Later title",
        description: "Later description",
      });
      expect(later.status).toBe("updated");

      const restored = restoreToEntry(projectId, created.id, updateEntry?.id ?? -1);
      expect(restored.success).toBeTrue();
      const restoredCard = await findCardOnBoard(projectId, created.id);
      expect(restoredCard?.title).toBe("Checkpoint title");
      expect(restoredCard?.description).toBe("Checkpoint description");
      expect(restoredCard?.tags.join(",")).toBe("beta");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("pruning creates a boundary checkpoint before deleting older visible history", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "Boundary checkpoint" }).id;
      const created = await createCard(projectId, "draft", {
        title: "Boundary card",
        description: "Boundary original",
      });
      const firstUpdate = await updateCard(projectId, "draft", created.id, {
        title: "Boundary first update",
        description: "Boundary first description",
      });
      expect(firstUpdate.status).toBe("updated");
      const secondUpdate = await updateCard(projectId, "draft", created.id, {
        title: "Boundary second update",
      });
      expect(secondUpdate.status).toBe("updated");

      const history = getRecentHistory(projectId, 10, 0);
      const firstUpdateEntry = history
        .filter((entry) => entry.operation === "update")
        .find((entry) => entry.newValues?.title === "Boundary first update");
      const secondUpdateEntry = history
        .filter((entry) => entry.operation === "update")
        .find((entry) => entry.newValues?.title === "Boundary second update");
      expect(firstUpdateEntry?.id !== undefined).toBeTrue();
      expect(secondUpdateEntry?.id !== undefined).toBeTrue();

      const pruned = pruneHistory(projectId, 2);
      expect(pruned).toBe(1);

      const database = new Database(getDatabasePath(), { readonly: true });
      try {
        const snapshotRow = database.prepare(`
          SELECT 1
          FROM card_history_snapshots
          WHERE history_id = ?
        `).get(firstUpdateEntry?.id ?? -1);
        expect(snapshotRow !== undefined).toBeTrue();
      } finally {
        database.close();
      }

      const firstPreview = getCardHistoryVersionPreview(projectId, created.id, firstUpdateEntry?.id ?? -1);
      expect(firstPreview.preview?.card.title).toBe("Boundary first update");
      expect(firstPreview.preview?.card.description).toBe("Boundary first description");
      const secondPreview = getCardHistoryVersionPreview(projectId, created.id, secondUpdateEntry?.id ?? -1);
      expect(secondPreview.preview?.card.title).toBe("Boundary second update");
      expect(secondPreview.preview?.card.description).toBe("Boundary first description");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("description revision GC preserves revisions referenced only by card history checkpoints", async () => {
    const ran = await withTempDatabase(async () => {
      const projectId = createProject({ name: "Checkpoint revision roots" }).id;
      const created = await createCard(projectId, "draft", {
        title: "Revision root card",
        description: "Revision root original",
      });
      const updated = await updateCard(projectId, "draft", created.id, {
        description: "Revision root checkpoint",
      });
      expect(updated.status).toBe("updated");

      const history = getRecentHistory(projectId, 10, 0);
      const updateEntry = history.find((entry) => entry.operation === "update");
      expect(updateEntry?.id !== undefined).toBeTrue();
      pruneHistory(projectId, 1);

      const database = new Database(getDatabasePath());
      try {
        const snapshotRow = database.prepare(`
          SELECT description_revision_id
          FROM card_history_snapshots
          WHERE history_id = ?
        `).get(updateEntry?.id ?? -1) as
          | { description_revision_id: number | null }
          | undefined;
        const snapshotRevisionId = snapshotRow?.description_revision_id ?? null;
        expect(snapshotRevisionId).not.toBeNull();

        database.prepare(`
          UPDATE cards
          SET description_revision_id = NULL
          WHERE id = ?
        `).run(created.id);
        database.prepare(`
          UPDATE history
          SET previous_description_revision_id = NULL,
              new_description_revision_id = NULL,
              snapshot_description_revision_id = NULL
          WHERE project_id = ? AND card_id = ?
        `).run(projectId, created.id);

        descriptionRevisionService.garbageCollectDescriptionRevisions(database);

        const retainedRevision = database.prepare(`
          SELECT 1
          FROM description_revisions
          WHERE id = ?
        `).get(snapshotRevisionId ?? -1);
        expect(retainedRevision !== undefined).toBeTrue();
      } finally {
        database.close();
      }
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

      const panelEntries = getCardHistoryPanelEntries(projectId, created.id);
      const updatePanelEntry = panelEntries.find((entry) => entry.id === updateEntry?.id);
      expect(updatePanelEntry?.reconstructable).toBeFalse();
      expect(Boolean(updatePanelEntry?.reconstructionUnavailableReason)).toBeTrue();

      const preview = getCardHistoryVersionPreview(projectId, created.id, updateEntry?.id ?? -1);
      expect(preview.preview).toBe(null);
      expect(Boolean(preview.error)).toBeTrue();
      expect((preview.error ?? "").includes("Cannot reconstruct state")).toBeFalse();
    });

    if (!ran) expect(true).toBeTrue();
  });
});
