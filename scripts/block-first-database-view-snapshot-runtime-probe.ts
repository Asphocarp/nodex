import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { getDatabasePath } from "../src/main/local-store/config";
import { readDatabaseViewSnapshot } from "../src/main/local-store/database-kernel";
import { createProject } from "../src/main/local-store/projects";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-view-snapshot-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Database snapshot isolation" });
    const database = getDb();
    const seed = database.prepare(`
      SELECT view.id, view.name, metadata.store_epoch
      FROM database_views view
      CROSS JOIN block_store_metadata metadata
      WHERE view.project_id = ?
        AND view.is_primary = 1
        AND view.lifecycle = 'active'
        AND metadata.id = 1
      LIMIT 1
    `).get(project.id) as {
      readonly id: string;
      readonly name: string;
      readonly store_epoch: string;
    };
    const concurrentName = `${seed.name} after concurrent commit`;
    const concurrent = new Database(getDatabasePath());
    try {
      concurrent.pragma("busy_timeout = 2000");
      const snapshot = readDatabaseViewSnapshot(
        database,
        project.id,
        seed.id,
        {
          afterCursorRead: () => {
            concurrent.transaction(() => {
              concurrent.prepare(`
                UPDATE database_views
                SET name = ?, updated_at = ?
                WHERE id = ? AND project_id = ?
              `).run(
                concurrentName,
                "2026-07-12T01:00:00.000Z",
                seed.id,
                project.id,
              );
              concurrent.prepare(`
                INSERT INTO change_log (
                  project_id, store_epoch, kind, operation_id,
                  block_ids_json, document_ids_json,
                  database_block_ids_json, payload_json, committed_at
                ) VALUES (?, ?, 'database_snapshot_probe', ?, '[]', '[]', '[]', '{}', ?)
              `).run(
                project.id,
                seed.store_epoch,
                "database-view-snapshot-concurrent-write",
                "2026-07-12T01:00:00.000Z",
              );
            }).immediate();
          },
        },
      );
      invariant(snapshot.ok, "Selected Database View snapshot failed");
      invariant(
        snapshot.value.descriptor.changeLogSeq ===
          snapshot.value.query.changeLogSeq,
        "Descriptor and query cursors diverged",
      );
      invariant(
        snapshot.value.query.value?.view.name === seed.name,
        "Snapshot value observed a commit newer than its cursor",
      );
      const current = database.prepare(`
        SELECT view.name,
               (SELECT MAX(seq) FROM change_log WHERE project_id = ?) AS seq
        FROM database_views view
        WHERE view.id = ? AND view.project_id = ?
      `).get(project.id, seed.id, project.id) as {
        readonly name: string;
        readonly seq: number;
      };
      invariant(current.name === concurrentName, "Concurrent commit did not persist");
      invariant(
        current.seq > snapshot.value.query.changeLogSeq,
        "Concurrent commit did not advance the durable cursor",
      );
      process.stdout.write(`${JSON.stringify({
        atomicCursorAndValue: true,
        crossConnectionCommit: true,
        selectedViewIdentity: true,
      })}\n`);
    } finally {
      concurrent.close();
    }
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousNodexDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousNodexDir;
    }
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
