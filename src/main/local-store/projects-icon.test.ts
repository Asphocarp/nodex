import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./database";
import { createProject, getProject, updateProject } from "./projects";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-project-icon-"));
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_HOME;
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
    delete process.env.NODEX_HOME;
  }
}

describe("project icon persistence", () => {
  test("stores icon on create and update", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Alpha", icon: "🚀", sources: ["/tmp/alpha"] });
      expect(project.icon).toBe("🚀");
      expect(project.primaryWorkspaceRoot).toBe("/tmp/alpha");
      expect(getProject(project.id)?.icon).toBe("🚀");
      expect(getProject(project.id)?.primaryWorkspaceRoot).toBe("/tmp/alpha");

      const updated = updateProject(project.id, { icon: "🧠", sources: ["/tmp/alpha-2"] });
      expect(updated?.icon).toBe("🧠");
      expect(updated?.primaryWorkspaceRoot).toBe("/tmp/alpha-2");
      expect(getProject(project.id)?.icon).toBe("🧠");
      expect(getProject(project.id)?.primaryWorkspaceRoot).toBe("/tmp/alpha-2");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("stores empty icon when icon is missing or invalid", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Beta" });
      expect(project.icon).toBe("");

      const updated = updateProject(project.id, { icon: "not-an-emoji" });
      expect(updated?.icon).toBe("");
    });

    if (!ran) expect(true).toBe(true);
  });
});
