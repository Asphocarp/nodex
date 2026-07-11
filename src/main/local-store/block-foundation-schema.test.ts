import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { createCard, deleteCard } from "./cards";
import { createProject, deleteProject } from "./projects";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const FOUNDATION_TABLES_IN_DELETE_ORDER = [
  "legacy_card_shadow_jobs",
  "legacy_card_shadow_heads",
  "database_view_positions",
  "database_views",
  "database_memberships",
  "database_capabilities",
  "document_block_index",
  "document_materializations",
  "document_snapshots",
  "document_updates",
  "document_update_receipts",
  "block_documents",
  "top_level_block_placements",
  "blocks",
  "documents",
  "block_store_metadata",
] as const;

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

function supportsBetterSqlite3(): boolean {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }
}

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

function operationFails(operation: () => void): boolean {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
}

function clearBlockFoundation(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");
  try {
    for (const tableName of FOUNDATION_TABLES_IN_DELETE_ORDER) {
      database.exec(`DELETE FROM ${tableName}`);
    }
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

async function withTempStore(run: (tempDir: string) => Promise<void>): Promise<void> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-block-foundation-"));
  process.env.NODEX_DIR = tempDir;

  try {
    await initializeDatabase();
    await run(tempDir);
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

describe("block-first schema foundation", () => {
  sqliteTest("seeds a durable store epoch and one primary Database for every new Project", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Fresh space" });
      closeDatabase();

      const database = new Database(getDatabasePath(), { readonly: true });
      try {
        const epoch = database.prepare(`
          SELECT store_epoch
          FROM block_store_metadata
          WHERE id = 1
        `).get() as { store_epoch: string } | undefined;
        expect(Boolean(epoch?.store_epoch)).toBeTrue();

        const primaryDatabase = database.prepare(`
          SELECT block.id, capability.is_primary, view.kind
          FROM blocks block
          INNER JOIN database_capabilities capability ON capability.block_id = block.id
          INNER JOIN database_views view ON view.database_block_id = block.id
          WHERE block.project_id = ?
            AND block.type = 'database'
            AND capability.is_primary = 1
            AND view.is_primary = 1
        `).get(project.id) as { id: string; is_primary: number; kind: string } | undefined;
        expect(primaryDatabase?.id).toBe(`database:${project.id}:primary`);
        expect(primaryDatabase?.is_primary).toBe(1);
        expect(primaryDatabase?.kind).toBe("kanban");
      } finally {
        database.close();
      }
    });
  });

  sqliteTest("keeps post-v59 Card shells aligned through create, metadata update, and delete", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Continuous shadow space" });
      const card = await createCard(project.id, "draft", { title: "Shadowed Card" });
      closeDatabase();

      const database = new Database(getDatabasePath(), { readonly: false });
      try {
        const created = database.prepare(`
          SELECT block.lifecycle, document.readiness, membership.removed_at, position.group_key
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          INNER JOIN database_view_positions position ON position.block_id = block.id
          WHERE block.id = ?
        `).get(card.id) as {
          lifecycle: string;
          readiness: string;
          removed_at: string | null;
          group_key: string;
        } | undefined;
        expect(created?.lifecycle).toBe("active");
        expect(created?.readiness).toBe("pending_genesis");
        expect(created?.removed_at).toBe(null);
        expect(created?.group_key).toBe("draft");

        database.prepare(`
          UPDATE cards
          SET status = 'done', "order" = 9, revision = revision + 1
          WHERE id = ?
        `).run(card.id);
        const updated = database.prepare(`
          SELECT position.group_key, position.rank_key,
                 document.genesis_source_revision, card.revision
          FROM cards card
          INNER JOIN block_documents ownership ON ownership.block_id = card.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_view_positions position ON position.block_id = card.id
          WHERE card.id = ?
        `).get(card.id) as {
          group_key: string;
          rank_key: string;
          genesis_source_revision: number;
          revision: number;
        };
        expect(updated.group_key).toBe("done");
        expect(updated.rank_key).toBe("00000000000000000009");
        expect(updated.genesis_source_revision).toBe(updated.revision);
      } finally {
        database.close();
      }

      await initializeDatabase();
      expect(await deleteCard(project.id, "done", card.id)).toBeTrue();
      closeDatabase();

      const deletedDatabase = new Database(getDatabasePath(), { readonly: true });
      try {
        const deleted = deletedDatabase.prepare(`
          SELECT block.lifecycle, membership.removed_at,
                 (SELECT COUNT(*) FROM top_level_block_placements WHERE block_id = block.id) AS placements,
                 (SELECT COUNT(*) FROM database_view_positions WHERE block_id = block.id) AS positions
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          WHERE block.id = ?
        `).get(card.id) as {
          lifecycle: string;
          removed_at: string | null;
          placements: number;
          positions: number;
        };
        expect(deleted.lifecycle).toBe("deleted");
        expect(deleted.removed_at === null).toBeFalse();
        expect(deleted.placements).toBe(0);
        expect(deleted.positions).toBe(0);
      } finally {
        deletedDatabase.close();
      }
    });
  });

  sqliteTest("migrates Card identity into pending document shells idempotently and enforces ownership", async () => {
    await withTempStore(async (tempDir) => {
      const project = createProject({ name: "Migrated space" });
      const first = await createCard(project.id, "in_progress", { title: "First" });
      const second = await createCard(project.id, "backlog", { title: "Second" });
      closeDatabase();

      const legacy = new Database(getDatabasePath(), { readonly: false });
      try {
        clearBlockFoundation(legacy);
        legacy.pragma("user_version = 58");
      } finally {
        legacy.close();
      }

      await initializeDatabase();
      closeDatabase();

      let database = new Database(getDatabasePath(), { readonly: false });
      let storeEpoch = "";
      try {
        const version = database.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        expect(version.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const migrated = database.prepare(`
          SELECT
            block.id,
            block.type,
            document.id AS document_id,
            document.readiness,
            document.authority,
            ownership.project_id,
            membership.database_block_id,
            position.group_key
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_memberships membership
            ON membership.card_block_id = block.id AND membership.removed_at IS NULL
          INNER JOIN database_view_positions position ON position.block_id = block.id
          WHERE block.id = ?
        `).get(first.id) as {
          id: string;
          type: string;
          document_id: string;
          readiness: string;
          authority: string;
          project_id: string;
          database_block_id: string;
          group_key: string;
        } | undefined;
        expect(migrated?.id).toBe(first.id);
        expect(migrated?.type).toBe("card");
        expect(migrated?.document_id).toBe(`document:${first.id}`);
        expect(migrated?.readiness).toBe("pending_genesis");
        expect(migrated?.authority).toBe("legacy_shadow");
        expect(migrated?.project_id).toBe(project.id);
        expect(migrated?.database_block_id).toBe(`database:${project.id}:primary`);
        expect(migrated?.group_key).toBe("in_progress");

        database.prepare(`
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind, containing_document_id,
            location_revision, metadata_revision, created_at, updated_at
          ) VALUES ('contained-block', ?, 'paragraph', 'active', 'document', ?, 1, 1, ?, ?)
        `).run(
          project.id,
          `document:${first.id}`,
          new Date().toISOString(),
          new Date().toISOString(),
        );
        expect(operationFails(() => {
          database.prepare(`
            UPDATE top_level_block_placements
            SET block_id = ?
            WHERE block_id = ?
          `).run("contained-block", first.id);
        })).toBeTrue();

        database.prepare(`
          INSERT INTO document_block_index (
            document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq
          ) VALUES (?, 'contained-block', NULL, 0, 'paragraph', '', 0)
        `).run(`document:${first.id}`);
        expect(operationFails(() => {
          database.prepare(`
            UPDATE document_block_index
            SET document_id = ?
            WHERE block_id = 'contained-block'
          `).run(`document:${second.id}`);
        })).toBeTrue();

        expect(operationFails(() => {
          database.prepare("DELETE FROM documents WHERE id = ?").run(`document:${first.id}`);
        })).toBeTrue();
        database.prepare("DELETE FROM blocks WHERE id = 'contained-block'").run();
        expect(operationFails(() => {
          database.prepare("DELETE FROM blocks WHERE id = ?").run(first.id);
        })).toBeTrue();
        expect(operationFails(() => {
          database.prepare("DELETE FROM documents WHERE id = ?").run(`document:${first.id}`);
        })).toBeTrue();

        const epochRow = database.prepare(`
          SELECT store_epoch FROM block_store_metadata WHERE id = 1
        `).get() as { store_epoch: string };
        storeEpoch = epochRow.store_epoch;

        database.prepare(`
          INSERT INTO document_updates (
            document_id, generation, seq, update_id, client_session_id,
            base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
          ) VALUES (?, 1, 1, 'update-1', 'client-1', 0, '[]', ?, 'hash-1', ?)
        `).run(`document:${first.id}`, Buffer.from([1]), new Date().toISOString());
        expect(operationFails(() => {
          database.prepare(`
            INSERT INTO document_updates (
              document_id, generation, seq, update_id, client_session_id,
              base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
            ) VALUES (?, 1, 2, 'update-1', 'client-2', 0, '[]', ?, 'hash-2', ?)
          `).run(`document:${first.id}`, Buffer.from([2]), new Date().toISOString());
        })).toBeTrue();

        expect(operationFails(() => {
          database.prepare(`
            UPDATE block_documents
            SET document_id = ?
            WHERE block_id = ?
          `).run(`document:${second.id}`, first.id);
        })).toBeTrue();

        const secondDatabaseBlockId = `database:${project.id}:secondary`;
        database.prepare(`
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind, containing_document_id,
            location_revision, metadata_revision, created_at, updated_at
          ) VALUES (?, ?, 'database', 'active', 'space', NULL, 1, 1, ?, ?)
        `).run(secondDatabaseBlockId, project.id, new Date().toISOString(), new Date().toISOString());
        database.prepare(`
          INSERT INTO database_capabilities (
            block_id, project_id, is_primary, schema_key, created_at, updated_at
          ) VALUES (?, ?, 0, 'nodex.database', ?, ?)
        `).run(secondDatabaseBlockId, project.id, new Date().toISOString(), new Date().toISOString());
        expect(operationFails(() => {
          database.prepare(`
            UPDATE database_capabilities
            SET block_id = ?
            WHERE block_id = ?
          `).run(first.id, secondDatabaseBlockId);
        })).toBeTrue();
        expect(operationFails(() => {
          database.prepare(`
            INSERT INTO database_memberships (
              id, database_block_id, card_block_id, project_id, created_at, removed_at
            ) VALUES ('duplicate-membership', ?, ?, ?, ?, NULL)
          `).run(secondDatabaseBlockId, first.id, project.id, new Date().toISOString());
        })).toBeTrue();
        expect(operationFails(() => {
          database
            .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
            .run(secondDatabaseBlockId);
        })).toBeTrue();
        expect(operationFails(() => {
          database
            .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
            .run(first.id);
        })).toBeTrue();

        const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
        expect(foreignKeyProblems.length).toBe(0);
      } finally {
        database.close();
      }

      const safetyRoot = path.join(tempDir, "migration-backups");
      const safetyDirectories = fs.readdirSync(safetyRoot);
      expect(safetyDirectories.length).toBe(1);
      const safetyDatabase = new Database(
        path.join(safetyRoot, safetyDirectories[0] ?? "", "nodex.db"),
        { readonly: true },
      );
      try {
        const safetyVersion = safetyDatabase.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        expect(safetyVersion.user_version).toBe(58);
        const legacyCard = safetyDatabase.prepare("SELECT id FROM cards WHERE id = ?").get(first.id) as
          | { id: string }
          | undefined;
        expect(legacyCard?.id).toBe(first.id);
      } finally {
        safetyDatabase.close();
      }

      database = new Database(getDatabasePath(), { readonly: false });
      database.pragma("user_version = 58");
      database.close();
      await initializeDatabase();
      closeDatabase();

      database = new Database(getDatabasePath(), { readonly: true });
      try {
        const counts = database.prepare(`
          SELECT
            (SELECT COUNT(*) FROM blocks WHERE type = 'card') AS cards,
            (SELECT COUNT(*) FROM block_documents) AS ownerships,
            (SELECT COUNT(*) FROM database_memberships WHERE removed_at IS NULL) AS memberships,
            (SELECT COUNT(*) FROM block_store_metadata) AS metadata_rows,
            (SELECT store_epoch FROM block_store_metadata WHERE id = 1) AS store_epoch
        `).get() as {
          cards: number;
          ownerships: number;
          memberships: number;
          metadata_rows: number;
          store_epoch: string;
        };
        expect(counts.cards).toBe(2);
        expect(counts.ownerships).toBe(2);
        expect(counts.memberships).toBe(2);
        expect(counts.metadata_rows).toBe(1);
        expect(counts.store_epoch).toBe(storeEpoch);
      } finally {
        database.close();
      }
    });
  });

  sqliteTest("deletes a Project through the explicit Block foundation cleanup order", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Disposable space" });
      await createCard(project.id, "draft", { title: "Disposable Card" });
      closeDatabase();

      const legacy = new Database(getDatabasePath(), { readonly: false });
      legacy.pragma("user_version = 58");
      legacy.close();
      await initializeDatabase();

      expect(deleteProject(project.id)).toBeTrue();
      closeDatabase();

      const database = new Database(getDatabasePath(), { readonly: true });
      try {
        const counts = database.prepare(`
          SELECT
            (SELECT COUNT(*) FROM projects WHERE id = ?) AS projects,
            (SELECT COUNT(*) FROM blocks WHERE project_id = ?) AS blocks,
            (SELECT COUNT(*) FROM documents WHERE project_id = ?) AS documents,
            (SELECT COUNT(*) FROM block_documents WHERE project_id = ?) AS ownerships,
            (SELECT COUNT(*) FROM database_capabilities WHERE project_id = ?) AS capabilities,
            (SELECT COUNT(*) FROM database_memberships WHERE project_id = ?) AS memberships,
            (SELECT COUNT(*) FROM database_views WHERE project_id = ?) AS views,
            (SELECT COUNT(*) FROM database_view_positions WHERE project_id = ?) AS positions
        `).get(
          project.id,
          project.id,
          project.id,
          project.id,
          project.id,
          project.id,
          project.id,
          project.id,
        ) as {
          projects: number;
          blocks: number;
          documents: number;
          ownerships: number;
          capabilities: number;
          memberships: number;
          views: number;
          positions: number;
        };

        expect(counts.projects).toBe(0);
        expect(counts.blocks).toBe(0);
        expect(counts.documents).toBe(0);
        expect(counts.ownerships).toBe(0);
        expect(counts.capabilities).toBe(0);
        expect(counts.memberships).toBe(0);
        expect(counts.views).toBe(0);
        expect(counts.positions).toBe(0);
        expect(database.prepare("PRAGMA foreign_key_check").all().length).toBe(0);
      } finally {
        database.close();
      }
    });
  });

  sqliteTest("rolls back all v59 shadow rows when Card seeding fails", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Faulted migration" });
      await createCard(project.id, "draft", { title: "Will fail" });
      closeDatabase();

      const legacy = new Database(getDatabasePath(), { readonly: false });
      try {
        clearBlockFoundation(legacy);
        legacy.exec(`
          CREATE TRIGGER fail_v59_card_seed
          BEFORE INSERT ON blocks
          WHEN NEW.type = 'card'
          BEGIN
            SELECT RAISE(ABORT, 'injected v59 migration failure');
          END;
          PRAGMA user_version = 58;
        `);
      } finally {
        legacy.close();
      }

      let failed = false;
      try {
        await initializeDatabase();
      } catch (error) {
        failed = (error as Error).message.includes("injected v59 migration failure");
      }
      expect(failed).toBeTrue();
      closeDatabase();

      const rolledBack = new Database(getDatabasePath(), { readonly: true });
      try {
        const version = rolledBack.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        const blockCount = rolledBack.prepare("SELECT COUNT(*) AS count FROM blocks").get() as {
          count: number;
        };
        const metadataCount = rolledBack.prepare(`
          SELECT COUNT(*) AS count FROM block_store_metadata
        `).get() as { count: number };
        expect(version.user_version).toBe(58);
        expect(blockCount.count).toBe(0);
        expect(metadataCount.count).toBe(0);
      } finally {
        rolledBack.close();
      }
    });
  });
});
