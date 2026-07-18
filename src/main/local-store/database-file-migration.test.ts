import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacyDatabaseFileName } from "./database-file-migration";

function withTempLocalStore(run: (nodexHome: string) => void): void {
  const nodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-db-file-migration-"));
  try {
    run(nodexHome);
  } finally {
    fs.rmSync(nodexHome, { recursive: true, force: true });
  }
}

describe("legacy database filename migration", () => {
  test("moves the legacy database and sidecars when only legacy files exist", () => {
    withTempLocalStore((nodexHome) => {
      fs.writeFileSync(path.join(nodexHome, "kanban.db"), "primary", "utf8");
      fs.writeFileSync(path.join(nodexHome, "kanban.db-wal"), "wal", "utf8");
      fs.writeFileSync(path.join(nodexHome, "kanban.db-shm"), "shm", "utf8");

      migrateLegacyDatabaseFileName(nodexHome);

      expect(fs.existsSync(path.join(nodexHome, "kanban.db"))).toBe(false);
      expect(fs.existsSync(path.join(nodexHome, "kanban.db-wal"))).toBe(false);
      expect(fs.existsSync(path.join(nodexHome, "kanban.db-shm"))).toBe(false);
      expect(fs.readFileSync(path.join(nodexHome, "nodex.db"), "utf8")).toBe("primary");
      expect(fs.readFileSync(path.join(nodexHome, "nodex.db-wal"), "utf8")).toBe("wal");
      expect(fs.readFileSync(path.join(nodexHome, "nodex.db-shm"), "utf8")).toBe("shm");
    });
  });

  test("leaves legacy files untouched when the new database already exists", () => {
    withTempLocalStore((nodexHome) => {
      fs.writeFileSync(path.join(nodexHome, "kanban.db"), "legacy", "utf8");
      fs.writeFileSync(path.join(nodexHome, "nodex.db"), "current", "utf8");

      migrateLegacyDatabaseFileName(nodexHome);

      expect(fs.readFileSync(path.join(nodexHome, "kanban.db"), "utf8")).toBe("legacy");
      expect(fs.readFileSync(path.join(nodexHome, "nodex.db"), "utf8")).toBe("current");
    });
  });

  test("does not mix old and new sidecars", () => {
    withTempLocalStore((nodexHome) => {
      fs.writeFileSync(path.join(nodexHome, "kanban.db"), "legacy-primary", "utf8");
      fs.writeFileSync(path.join(nodexHome, "kanban.db-wal"), "legacy-wal", "utf8");
      fs.writeFileSync(path.join(nodexHome, "nodex.db-wal"), "current-wal", "utf8");

      migrateLegacyDatabaseFileName(nodexHome);

      expect(fs.existsSync(path.join(nodexHome, "nodex.db"))).toBe(false);
      expect(fs.readFileSync(path.join(nodexHome, "kanban.db"), "utf8")).toBe("legacy-primary");
      expect(fs.readFileSync(path.join(nodexHome, "kanban.db-wal"), "utf8")).toBe("legacy-wal");
      expect(fs.readFileSync(path.join(nodexHome, "nodex.db-wal"), "utf8")).toBe("current-wal");
    });
  });
});
