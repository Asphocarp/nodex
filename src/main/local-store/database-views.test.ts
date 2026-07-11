import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inlineDatabaseViewId } from "../../shared/database-views";
import { createCard, deleteCard } from "./cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "./database";
import {
  DatabaseViewStoreError,
  readDatabaseView,
  readDatabaseViewById,
  readDatabaseViewDefinition,
  upsertLegacyInlineDatabaseView,
} from "./database-views";
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

const withTempStore = async (run: () => Promise<void>): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-database-views-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    await run();
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const insertInlineViewBlock = (input: {
  sourceBlockId: string;
  hostCardId: string;
  hostProjectId: string;
}): string => {
  const database = getDb();
  const hostDocumentId = `document:${input.hostCardId}`;
  const head = database.prepare(`
    SELECT head_seq
    FROM documents
    WHERE id = ? AND project_id = ?
  `).get(hostDocumentId, input.hostProjectId) as { head_seq: number };
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'toggleListInlineView', 'active', 'document', ?, 1, 1, ?, ?)
  `).run(
    input.sourceBlockId,
    input.hostProjectId,
    hostDocumentId,
    now,
    now,
  );
  database.prepare(`
    INSERT INTO document_block_index (
      document_id, block_id, parent_block_id, ordinal,
      block_type, text, projected_seq
    ) VALUES (?, ?, NULL, 0, 'toggleListInlineView', '', ?)
  `).run(hostDocumentId, input.sourceBlockId, head.head_seq);
  return hostDocumentId;
};

const readErrorCode = (operation: () => void): string => {
  try {
    operation();
    return "none";
  } catch (error) {
    return error instanceof DatabaseViewStoreError ? error.code : "unexpected";
  }
};

describe("durable Database View store", () => {
  sqliteTest("atomically creates an idempotent legacy inline view and reads stable ordered summaries", async () => {
    await withTempStore(async () => {
      const hostProject = createProject({ name: "Host" });
      const sourceProject = createProject({ name: "Source" });
      const hostCard = await createCard(hostProject.id, "draft", {
        title: "Host Card",
      });
      const first = await createCard(sourceProject.id, "draft", {
        title: "First",
      });
      const second = await createCard(sourceProject.id, "draft", {
        title: "Second",
      });
      const sourceBlockId = "inline-view-block-a";
      const hostDocumentId = insertInlineViewBlock({
        sourceBlockId,
        hostCardId: hostCard.id,
        hostProjectId: hostProject.id,
      });
      const input = {
        sourceBlockId,
        hostDocumentId,
        hostProjectId: hostProject.id,
        name: "Project work",
        props: {
          sourceProjectId: sourceProject.id,
          rulesV2B64: "eyJtb2RlIjoiYWxsIn0",
          propertyOrderCsv: "priority,status",
          hiddenPropertiesCsv: "estimate",
          showEmptyEstimate: "true" as const,
          showEmptyPriority: "false" as const,
        },
      };

      const created = upsertLegacyInlineDatabaseView(input);
      expect(created.view.id).toBe(inlineDatabaseViewId(sourceBlockId));
      expect(created.view.projectId).toBe(sourceProject.id);
      expect(created.view.databaseBlockId).toBe(`database:${sourceProject.id}:primary`);
      expect(created.view.kind).toBe("list");
      expect(created.definitionChange).toBe("created");
      expect(created.positionsAdded).toBe(2);

      const unchanged = upsertLegacyInlineDatabaseView(input);
      expect(unchanged.definitionChange).toBe("unchanged");
      expect(unchanged.positionsAdded).toBe(0);
      expect(unchanged.view.createdAt).toBe(created.view.createdAt);
      expect(unchanged.view.updatedAt).toBe(created.view.updatedAt);

      const database = getDb();
      database.prepare(`
        UPDATE database_view_positions
        SET rank_key = CASE block_id WHEN ? THEN 'b' ELSE 'a' END,
            group_key = 'draft'
        WHERE view_id = ?
      `).run(first.id, created.view.id);
      const ordered = readDatabaseView(sourceProject.id, created.view.id);
      expect(ordered?.rows.map((row) => row.card.title).join(",")).toBe("Second,First");
      expect(ordered?.rows.map((row) => row.rankKey).join(",")).toBe("a,b");

      const third = await createCard(sourceProject.id, "draft", {
        title: "Third",
      });
      expect(readDatabaseView(sourceProject.id, created.view.id)?.rows.length).toBe(3);
      const reseeded = upsertLegacyInlineDatabaseView(input);
      expect(reseeded.definitionChange).toBe("unchanged");
      expect(reseeded.positionsAdded).toBe(1);
      expect(readDatabaseView(sourceProject.id, created.view.id)?.rows.length).toBe(3);

      expect(await deleteCard(sourceProject.id, "draft", third.id)).toBe(true);
      const afterDelete = readDatabaseView(sourceProject.id, created.view.id);
      expect(afterDelete?.rows.length).toBe(2);
      expect(afterDelete?.rows.some((row) => row.card.id === third.id) ?? true).toBe(false);

      expect(readDatabaseViewDefinition(hostProject.id, created.view.id) === null).toBe(true);
      expect(readDatabaseViewById(created.view.id)?.view.projectId).toBe(sourceProject.id);
      expect(readDatabaseView(sourceProject.id, "missing") === null).toBe(true);
      expect(second.id === first.id).toBe(false);
    });
  });

  sqliteTest("rejects stale host scope and deterministic identity reassignment without partial writes", async () => {
    await withTempStore(async () => {
      const hostProject = createProject({ name: "Host" });
      const firstSource = createProject({ name: "First source" });
      const secondSource = createProject({ name: "Second source" });
      const hostCard = await createCard(hostProject.id, "draft", {
        title: "Host Card",
      });
      const sourceBlockId = "inline-view-block-scope";
      const hostDocumentId = insertInlineViewBlock({
        sourceBlockId,
        hostCardId: hostCard.id,
        hostProjectId: hostProject.id,
      });

      expect(readErrorCode(() => upsertLegacyInlineDatabaseView({
        sourceBlockId,
        hostDocumentId: "document:wrong",
        hostProjectId: hostProject.id,
        props: { sourceProjectId: firstSource.id },
      }))).toBe("host_block_scope_mismatch");

      const created = upsertLegacyInlineDatabaseView({
        sourceBlockId,
        hostDocumentId,
        hostProjectId: hostProject.id,
        props: { sourceProjectId: firstSource.id },
      });
      expect(readErrorCode(() => upsertLegacyInlineDatabaseView({
        sourceBlockId,
        hostDocumentId,
        hostProjectId: hostProject.id,
        props: { sourceProjectId: secondSource.id },
      }))).toBe("view_identity_collision");

      const persisted = readDatabaseViewDefinition(firstSource.id, created.view.id);
      expect(persisted?.projectId).toBe(firstSource.id);
      expect(readDatabaseViewDefinition(secondSource.id, created.view.id) === null).toBe(true);
      const collisionCount = getDb().prepare(`
        SELECT COUNT(*) AS count
        FROM database_views
        WHERE id = ?
      `).get(created.view.id) as { count: number };
      expect(collisionCount.count).toBe(1);
    });
  });

  sqliteTest("rolls back the view definition when position seeding fails", async () => {
    await withTempStore(async () => {
      const hostProject = createProject({ name: "Host" });
      const sourceProject = createProject({ name: "Source" });
      const hostCard = await createCard(hostProject.id, "draft", {
        title: "Host Card",
      });
      await createCard(sourceProject.id, "draft", { title: "Source Card" });
      const sourceBlockId = "inline-view-block-rollback";
      const hostDocumentId = insertInlineViewBlock({
        sourceBlockId,
        hostCardId: hostCard.id,
        hostProjectId: hostProject.id,
      });
      const viewId = inlineDatabaseViewId(sourceBlockId);
      const database = getDb();
      database.exec(`
        CREATE TEMP TRIGGER fail_inline_view_position_seed
        BEFORE INSERT ON database_view_positions
        WHEN NEW.view_id = '${viewId}'
        BEGIN
          SELECT RAISE(ABORT, 'injected position failure');
        END;
      `);

      expect(readErrorCode(() => upsertLegacyInlineDatabaseView({
        sourceBlockId,
        hostDocumentId,
        hostProjectId: hostProject.id,
        props: { sourceProjectId: sourceProject.id },
      }))).toBe("unexpected");
      const persisted = database.prepare(`
        SELECT COUNT(*) AS count
        FROM database_views
        WHERE id = ?
      `).get(viewId) as { count: number };
      expect(persisted.count).toBe(0);
    });
  });
});
