import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { readBlockStoreEpoch } from "./block-store-metadata";
import { maintainStoreBlockRetention } from "./block-retention-maintenance-store";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";

describe("store-wide Block retention maintenance", () => {
  test("runs every Project under one current store-epoch fence", async () => {
    closeDatabase();
    const previousDirectory = process.env.NODEX_HOME;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-block-retention-store-"),
    );
    process.env.NODEX_HOME = directory;
    try {
      await initializeDatabase();
      const database = getDb();
      createProject({ name: "Second retention Project" });
      const storeEpoch = readBlockStoreEpoch(database);
      if (!storeEpoch) throw new Error("Retention store has no epoch");

      const result = maintainStoreBlockRetention(database, {
        storeEpoch,
        retainNewestDeletedBlocks: 123,
      });

      expect(result.storeEpoch).toBe(storeEpoch);
      expect(result.retainNewestDeletedBlocks).toBe(123);
      expect(result.projectResults.length).toBe(2);
      expect(result.failedCandidateCount).toBe(0);
      expect(() =>
        maintainStoreBlockRetention(database, {
          storeEpoch: "stale-epoch",
          retainNewestDeletedBlocks: 123,
        }),
      ).toThrow("store epoch changed");
    } finally {
      closeDatabase();
      if (previousDirectory === undefined) delete process.env.NODEX_HOME;
      else process.env.NODEX_HOME = previousDirectory;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
