import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCard } from "./cards";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { createProject } from "./projects";
import {
  LegacyCardShadowOutboxError,
  claimNextLegacyCardShadowJob,
  markLegacyCardShadowJobApplied,
  markLegacyCardShadowJobSuperseded,
} from "./legacy-card-shadow-outbox";

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

describe("legacy Card shadow outbox claims", () => {
  sqliteTest("claims in per-Card order, fences stale tokens, and reclaims expired work", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-shadow-claims-"));
    process.env.NODEX_DIR = tempDir;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Shadow claims" });
      const card = await createCard(project.id, "draft", { title: "First" });
      closeDatabase();
      const database = new Database(getDatabasePath());
      database.pragma("foreign_keys = ON");
      try {
        database.prepare(`
          UPDATE cards SET title = 'Second', revision = revision + 1 WHERE id = ?
        `).run(card.id);

        const first = claimNextLegacyCardShadowJob(database, {
          claimToken: "claim-1",
          now: new Date("2026-07-11T00:00:00.000Z"),
          leaseMs: 1_000,
        });
        expect(first?.sourceEventSeq).toBe(1);
        expect(claimNextLegacyCardShadowJob(database, {
          claimToken: "parallel",
          now: new Date("2026-07-11T00:00:00.500Z"),
        })).toBe(null);

        const reclaimed = claimNextLegacyCardShadowJob(database, {
          claimToken: "claim-2",
          now: new Date("2026-07-11T00:00:02.000Z"),
        });
        expect(reclaimed?.id).toBe(first?.id);
        expect(reclaimed?.attemptCount).toBe(2);

        let staleRejected = false;
        try {
          markLegacyCardShadowJobApplied(
            database,
            { id: first?.id ?? "", claimToken: "claim-1" },
            1,
          );
        } catch (error) {
          staleRejected = error instanceof LegacyCardShadowOutboxError;
        }
        expect(staleRejected).toBeTrue();

        if (!reclaimed) throw new Error("Expected reclaimed job");
        markLegacyCardShadowJobSuperseded(database, reclaimed);
        const second = claimNextLegacyCardShadowJob(database, {
          claimToken: "claim-3",
          now: new Date("2026-07-11T00:00:03.000Z"),
        });
        expect(second?.sourceEventSeq).toBe(2);
        if (!second) throw new Error("Expected second job");
        markLegacyCardShadowJobApplied(database, second, 1);
        expect(claimNextLegacyCardShadowJob(database)).toBe(null);
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
