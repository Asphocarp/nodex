import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { closeDatabase, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { createProject } from "./projects";
import { resolveCardReference } from "./block-references";

const supportsBetterSqlite = (() => {
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
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

describe("Block reference read model", () => {
  sqliteTest("resolves the target Project and owned Document from global Block identity", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-block-reference-"));
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const sourceProject = createProject({ name: "Source" });
      const targetProject = createProject({ name: "Target" });
      const target = await createCard(targetProject.id, "draft", {
        title: "Cross-project target",
        description: "Target body",
      });
      closeDatabase();

      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        const resolved = resolveCardReference(target.id, database);
        expect(resolved.status).toBe("available");
        if (resolved.status !== "available") return;
        expect(resolved.projectId).toBe(targetProject.id);
        expect(resolved.projectId === sourceProject.id).toBe(false);
        expect(resolved.summary.title).toBe("Cross-project target");
        expect(resolved.document.documentId).toBe(`document:${target.id}`);
        expect(resolved.document.readiness).toBe("ready");

        const missing = resolveCardReference("missing-card-id", database);
        expect(missing.status).toBe("missing");
        const databaseBlock = database.prepare(`
          SELECT block_id FROM database_capabilities
          WHERE project_id = ? AND is_primary = 1
        `).get(targetProject.id) as { block_id: string };
        const invalid = resolveCardReference(databaseBlock.block_id, database);
        expect(invalid.status).toBe("invalid_target");
      } finally {
        database.close();
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });
});
