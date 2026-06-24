import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  createProject,
  deleteProject,
  listProjects,
  reorderProjects,
  setPinnedProjectOrder,
  setProjectPinned,
} from "./projects";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-projects-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
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
    delete process.env.NODEX_DIR;
  }
}

function projectNames(): string[] {
  return listProjects().map((project) => project.name);
}

describe("project service order and pinning", () => {
  test("reorders the full project order with same-set validation", async () => {
    const ran = await withTempDatabase(async () => {
      const alpha = createProject({ name: "Alpha" });
      const beta = createProject({ name: "Beta" });
      const gamma = createProject({ name: "Gamma" });

      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Gamma", "Beta", "Alpha"]));

      reorderProjects({
        orderedProjectIds: [alpha.id, gamma.id, beta.id, listProjects()[3]?.id ?? ""],
      });
      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Alpha", "Gamma", "Beta"]));

      let rejected = false;
      try {
        reorderProjects({ orderedProjectIds: [alpha.id, beta.id] });
      } catch {
        rejected = true;
      }
      expect(rejected).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("pins, unpins, and reorders pinned projects independently of project order", async () => {
    const ran = await withTempDatabase(async () => {
      const alpha = createProject({ name: "Alpha" });
      const beta = createProject({ name: "Beta" });
      const gamma = createProject({ name: "Gamma" });
      const defaultProject = listProjects().find((project) => project.name === "Default");
      if (!defaultProject) throw new Error("Missing default project");

      reorderProjects({
        orderedProjectIds: [alpha.id, beta.id, gamma.id, defaultProject.id],
      });

      const pinnedAlpha = setProjectPinned(alpha.id, { pinned: true });
      const pinnedGamma = setProjectPinned(gamma.id, { pinned: true });
      expect(pinnedAlpha?.pinned).toBeTrue();
      expect(pinnedAlpha?.pinnedOrder).toBe(0);
      expect(pinnedGamma?.pinnedOrder).toBe(1);

      const pinnedAgain = setProjectPinned(alpha.id, { pinned: true });
      expect(pinnedAgain?.pinnedOrder).toBe(0);

      setPinnedProjectOrder({ orderedProjectIds: [gamma.id, alpha.id] });
      const pinnedProjects = listProjects().filter((project) => project.pinned);
      expect(JSON.stringify(pinnedProjects.map((project) => project.name))).toBe(JSON.stringify(["Alpha", "Gamma"]));
      expect(listProjects().find((project) => project.id === gamma.id)?.pinnedOrder).toBe(0);
      expect(listProjects().find((project) => project.id === alpha.id)?.pinnedOrder).toBe(1);
      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Alpha", "Beta", "Gamma"]));

      let rejected = false;
      try {
        setPinnedProjectOrder({ orderedProjectIds: [alpha.id, beta.id] });
      } catch {
        rejected = true;
      }
      expect(rejected).toBeTrue();

      const unpinned = setProjectPinned(alpha.id, { pinned: false });
      expect(unpinned?.pinned).toBeFalse();
      expect(unpinned?.pinnedOrder).toBe(null);

      deleteProject(gamma.id);
      const pinnedRows = getDb().prepare("SELECT COUNT(*) AS count FROM pinned_project_order").get() as { count: number };
      expect(pinnedRows.count).toBe(0);
    });

    if (!ran) expect(true).toBeTrue();
  });
});
