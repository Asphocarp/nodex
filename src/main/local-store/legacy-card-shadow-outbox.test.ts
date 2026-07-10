import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { CURRENT_SCHEMA_VERSION } from "./schema";

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

function dropV60ShadowOutbox(database: Database.Database): void {
  database.exec(`
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_insert;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_update;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_delete;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_insert;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_update;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_delete;
    DROP TRIGGER IF EXISTS legacy_card_shadow_jobs_reject_id_collision;
    DROP TABLE IF EXISTS legacy_card_shadow_jobs;
    DROP TABLE IF EXISTS legacy_card_shadow_heads;
    PRAGMA user_version = 59;
  `);
}

async function withTempStore(run: () => Promise<void>): Promise<void> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-shadow-outbox-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    await run();
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

interface ShadowJobRow {
  id: string;
  source_event_seq: number;
  project_id: string;
  previous_project_id: string | null;
  document_id: string;
  expected_document_generation: number;
  expected_document_head_seq: number;
  expected_document_readiness: string;
  expected_document_authority: string;
  source_revision: number;
  operation: string;
  status: string;
}

describe("legacy Card shadow outbox", () => {
  sqliteTest("migrates v59 Cards and records every authoritative mutation in a stable ledger", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Shadow outbox source" });
      const targetProject = createProject({ name: "Shadow outbox target" });
      const card = await createCard(project.id, "draft", { title: "Initial" });
      closeDatabase();

      let database = new Database(getDatabasePath());
      dropV60ShadowOutbox(database);
      database.close();

      await initializeDatabase();
      closeDatabase();
      database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        const version = database.pragma("user_version", { simple: true }) as number;
        expect(version).toBe(CURRENT_SCHEMA_VERSION);

        const genesisJob = database.prepare(`
          SELECT * FROM legacy_card_shadow_jobs
          WHERE card_id = ? AND source_event_seq = 1
        `).get(card.id) as ShadowJobRow | undefined;
        expect(genesisJob?.id).toBe(`legacy-shadow:${card.id}:00000000000000000001`);
        expect(genesisJob?.project_id).toBe(project.id);
        expect(genesisJob?.previous_project_id).toBe(null);
        expect(genesisJob?.document_id).toBe(`document:${card.id}`);
        expect(genesisJob?.expected_document_generation).toBe(1);
        expect(genesisJob?.expected_document_head_seq).toBe(0);
        expect(genesisJob?.expected_document_readiness).toBe("pending_genesis");
        expect(genesisJob?.expected_document_authority).toBe("legacy_shadow");
        expect(genesisJob?.source_revision).toBe(1);
        expect(genesisJob?.operation).toBe("insert");
        expect(genesisJob?.status).toBe("pending");

        database.prepare(`
          UPDATE cards
          SET title = 'Second', revision = revision + 1
          WHERE id = ?
        `).run(card.id);
        database.prepare(`
          UPDATE cards
          SET "order" = "order" + 1
          WHERE id = ?
        `).run(card.id);
        database.prepare(`
          UPDATE cards
          SET description_preview = 'projection-only'
          WHERE id = ?
        `).run(card.id);
        database.prepare(`
          UPDATE cards
          SET project_id = ?, revision = revision + 1
          WHERE id = ?
        `).run(targetProject.id, card.id);

        const jobsBeforeDelete = database.prepare(`
          SELECT *
          FROM legacy_card_shadow_jobs
          WHERE card_id = ?
          ORDER BY source_event_seq
        `).all(card.id) as ShadowJobRow[];
        expect(jobsBeforeDelete.length).toBe(4);
        expect(jobsBeforeDelete[1]?.operation).toBe("update");
        expect(jobsBeforeDelete[1]?.source_revision).toBe(2);
        expect(jobsBeforeDelete[2]?.operation).toBe("update");
        expect(jobsBeforeDelete[2]?.source_revision).toBe(2);
        expect(jobsBeforeDelete[3]?.project_id).toBe(targetProject.id);
        expect(jobsBeforeDelete[3]?.previous_project_id).toBe(project.id);
        expect(jobsBeforeDelete[3]?.source_revision).toBe(3);

        const firstClaim = database.prepare(`
          UPDATE legacy_card_shadow_jobs
          SET status = 'processing', claim_token = 'claim-1',
              claimed_at = '2026-07-11T00:00:00.000Z',
              claim_expires_at = '2026-07-11T00:01:00.000Z',
              attempt_count = attempt_count + 1,
              updated_at = '2026-07-11T00:00:00.000Z'
          WHERE id = ? AND status = 'pending'
        `).run(genesisJob?.id ?? "");
        const duplicateClaim = database.prepare(`
          UPDATE legacy_card_shadow_jobs
          SET status = 'processing', claim_token = 'claim-2',
              claimed_at = '2026-07-11T00:00:00.000Z',
              claim_expires_at = '2026-07-11T00:01:00.000Z',
              attempt_count = attempt_count + 1,
              updated_at = '2026-07-11T00:00:00.000Z'
          WHERE id = ? AND status = 'pending'
        `).run(genesisJob?.id ?? "");
        expect(firstClaim.changes).toBe(1);
        expect(duplicateClaim.changes).toBe(0);
        expect(operationFails(() => {
          database.prepare(`
            UPDATE legacy_card_shadow_jobs
            SET status = 'processing', claim_token = 'parallel-claim',
                claimed_at = '2026-07-11T00:00:00.000Z',
                claim_expires_at = '2026-07-11T00:01:00.000Z',
                attempt_count = attempt_count + 1,
                updated_at = '2026-07-11T00:00:00.000Z'
            WHERE card_id = ? AND source_event_seq = 2
          `).run(card.id);
        })).toBeTrue();

        database.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
        const deleteJob = database.prepare(`
          SELECT operation, source_event_seq, project_id, source_revision
          FROM legacy_card_shadow_jobs
          WHERE card_id = ?
          ORDER BY source_event_seq DESC
          LIMIT 1
        `).get(card.id) as {
          operation: string;
          source_event_seq: number;
          project_id: string;
          source_revision: number;
        };
        expect(deleteJob.operation).toBe("delete");
        expect(deleteJob.source_event_seq).toBe(5);
        expect(deleteJob.project_id).toBe(targetProject.id);
        expect(deleteJob.source_revision).toBe(3);
        expect((database.pragma("foreign_key_check") as unknown[]).length).toBe(0);
      } finally {
        database.close();
      }
    });
  });

  sqliteTest("rolls v60 DDL and seed rows back together when source revision is corrupt", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Corrupt v59 source" });
      const card = await createCard(project.id, "draft", { title: "Invalid revision" });
      closeDatabase();

      const legacy = new Database(getDatabasePath());
      dropV60ShadowOutbox(legacy);
      legacy.prepare("UPDATE cards SET revision = 0 WHERE id = ?").run(card.id);
      legacy.close();

      let migrationFailed = false;
      try {
        await initializeDatabase();
      } catch (error) {
        migrationFailed = error instanceof Error && error.message.includes("CHECK constraint failed");
      }
      expect(migrationFailed).toBeTrue();
      closeDatabase();

      const rolledBack = new Database(getDatabasePath(), { readonly: true });
      try {
        expect(rolledBack.pragma("user_version", { simple: true }) as number).toBe(59);
        const tables = rolledBack.prepare(`
          SELECT COUNT(*) AS count
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('legacy_card_shadow_heads', 'legacy_card_shadow_jobs')
        `).get() as { count: number };
        expect(tables.count).toBe(0);
      } finally {
        rolledBack.close();
      }
    });
  });

  sqliteTest("rejects legacy authority writes after a Card becomes Y.Doc-primary", async () => {
    await withTempStore(async () => {
      const project = createProject({ name: "Primary authority guard" });
      const card = await createCard(project.id, "draft", { title: "Primary" });
      closeDatabase();

      const database = new Database(getDatabasePath());
      try {
        database.prepare(`
          UPDATE documents
          SET readiness = 'ready', authority = 'ydoc_primary'
          WHERE id = ?
        `).run(`document:${card.id}`);
        expect(operationFails(() => {
          database.prepare(`
            UPDATE cards SET title = 'Illegal legacy write', revision = revision + 1
            WHERE id = ?
          `).run(card.id);
        })).toBeTrue();
        expect(operationFails(() => {
          database.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
        })).toBeTrue();

        const projectionUpdate = database.prepare(`
          UPDATE cards SET description_preview = 'rebuildable projection'
          WHERE id = ?
        `).run(card.id);
        expect(projectionUpdate.changes).toBe(1);
      } finally {
        database.close();
      }
    });
  });
});
