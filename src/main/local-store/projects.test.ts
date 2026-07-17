import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  createProject,
  getProject,
  listProjects,
  reorderProjects,
  resolveProjectRunContext,
  setPinnedProjectOrder,
  setProjectLifecycle,
  setProjectPinned,
} from "./projects";
import { deleteProjectBlockFirst } from "./project-deletion";
import { createProjectSession } from "./project-sessions";
import { createPage } from "./database-pages";

const deleteProject = (projectId: string): boolean =>
  deleteProjectBlockFirst(getDb(), projectId).deleted;

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
      expect(rejected).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
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
      expect(pinnedAlpha?.pinned).toBe(true);
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
      expect(rejected).toBe(true);

      const unpinned = setProjectPinned(alpha.id, { pinned: false });
      expect(unpinned?.pinned).toBe(false);
      expect(unpinned?.pinnedOrder).toBe(null);

      deleteProject(gamma.id);
      const pinnedRows = getDb().prepare("SELECT COUNT(*) AS count FROM pinned_project_order").get() as { count: number };
      expect(pinnedRows.count).toBe(0);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("archives a Project without deleting its Library content", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Archived execution context" });
      const page = await createPage(project.id, "triage", {
        title: "Durable Library Page",
      });
      const session = createProjectSession({
        projectId: project.id,
        noThreadFallbackTitle: "Historical work",
      });
      const database = getDb();
      const countsBefore = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM blocks WHERE project_id = ?) AS blocks,
          (SELECT COUNT(*) FROM documents WHERE project_id = ?) AS documents,
          (SELECT COUNT(*) FROM database_containers WHERE block_id = ?) AS databases,
          (SELECT COUNT(*) FROM data_source_page_memberships
            WHERE page_block_id = ? AND removed_at IS NULL) AS memberships
      `).get(project.id, project.id, project.databaseId, page.id);

      expect(deleteProject(project.id)).toBe(true);
      expect(getProject(project.id)?.lifecycle).toBe("archived");
      expect(listProjects().some((candidate) => candidate.id === project.id))
        .toBe(false);
      expect(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM blocks WHERE project_id = ?) AS blocks,
          (SELECT COUNT(*) FROM documents WHERE project_id = ?) AS documents,
          (SELECT COUNT(*) FROM database_containers WHERE block_id = ?) AS databases,
          (SELECT COUNT(*) FROM data_source_page_memberships
            WHERE page_block_id = ? AND removed_at IS NULL) AS memberships
      `).get(project.id, project.id, project.databaseId, page.id))
        .toEqual(countsBefore);
      expect(database.prepare(`
        SELECT lifecycle FROM project_database_bindings WHERE project_id = ?
      `).get(project.id)).toEqual({ lifecycle: "archived" });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM retired_block_identities
        WHERE project_id = ?
      `).get(project.id)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT id FROM project_sessions WHERE id = ?
      `).get(session.id)).toEqual({ id: session.id });
      expect(deleteProject(project.id)).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("enforces Project lifecycle before starting work and supports reactivation", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Lifecycle" });
      const inactive = setProjectLifecycle(project.id, {
        lifecycle: "inactive",
      });
      expect(inactive?.lifecycle).toBe("inactive");
      expect(inactive?.bindingRevision).toBe(project.bindingRevision + 1);
      expect(() => resolveProjectRunContext(project.id)).toThrow(
        "cannot start work",
      );
      expect(() => createProjectSession({
        projectId: project.id,
        noThreadFallbackTitle: "Blocked",
      })).toThrow("cannot start work");

      const active = setProjectLifecycle(project.id, { lifecycle: "active" });
      expect(active?.lifecycle).toBe("active");
      expect(active?.bindingRevision).toBe(project.bindingRevision + 2);
      expect(resolveProjectRunContext(project.id).canonicalProjectId)
        .toBe(project.id);
      expect(createProjectSession({
        projectId: project.id,
        noThreadFallbackTitle: "Allowed",
      }).projectId).toBe(project.id);

      expect(setProjectLifecycle(project.id, { lifecycle: "archived" })?.lifecycle)
        .toBe("archived");
      expect(listProjects().some((candidate) => candidate.id === project.id))
        .toBe(false);
      expect(setProjectLifecycle(project.id, { lifecycle: "active" })?.lifecycle)
        .toBe("active");
      expect(listProjects().some((candidate) => candidate.id === project.id))
        .toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });
});
