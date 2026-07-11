import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";

describe("main test runtime", () => {
  test("uses Electron 40.10.4 with its Node ABI and native SQLite addon", () => {
    expect(process.versions.electron).toBe("40.10.4");
    expect(process.versions.node).toBe("24.15.0");

    const database = new Database(":memory:");
    try {
      database.exec("CREATE TABLE runtime_contract (value TEXT NOT NULL)");
      database.prepare("INSERT INTO runtime_contract (value) VALUES (?)").run("electron");
      const row = database.prepare("SELECT value FROM runtime_contract").get() as { value: string };
      expect(row.value).toBe("electron");
    } finally {
      database.close();
    }
  });
});
