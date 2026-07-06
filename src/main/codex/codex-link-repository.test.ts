import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "../local-store/database";
import { createProject, updateProject } from "../local-store/projects";
import {
  getCodexThread,
  listPinnedCodexThreadIds,
  listCodexProjectThreads,
  setCodexThreadPinned,
  updateCodexThreadArchived,
  updateCodexThreadName,
  updateCodexThreadPinned,
  updateCodexThreadStatus,
  upsertCodexThread,
} from "./codex-link-repository";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let projectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-links-"));
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

  projectId = createProject({ name: "Codex", sources: ["/tmp/codex"] }).id;

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

describe("codex-link-repository", () => {
  test("upserts and queries thread links", async () => {
    const ran = await withTempDatabase(async () => {
      const first = upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_1",
        source: { parentThreadId: "thr_parent" },
        threadSource: "appServer",
        threadName: "Thread One",
        threadPreview: "Initial preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
      });

      expect(first.threadId).toBe("thr_test_1");
      expect(first.threadName).toBe("Thread One");
      expect(first.archived).toBe(false);
      expect(first.source?.parentThreadId).toBe("thr_parent");
      expect(first.threadSource).toBe("appServer");

      const second = upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_1",
        threadName: "Thread One Updated",
        threadPreview: "Updated preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "active",
        statusActiveFlags: ["waitingOnApproval"],
      });

      expect(second.threadName).toBe("Thread One Updated");
      expect(second.statusType).toBe("active");
      expect(second.statusActiveFlags.length).toBe(1);
      expect(second.source?.parentThreadId).toBe("thr_parent");
      expect(second.threadSource).toBe("appServer");

      const clearedSource = upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_1",
        threadSource: null,
      });
      expect(clearedSource.threadSource).toBe(null);

      const byProject = listCodexProjectThreads(projectId);
      expect(byProject.length).toBe(1);
      expect(byProject[0]?.threadId).toBe("thr_test_1");

      expect(byProject[0]?.source?.parentThreadId).toBe("thr_parent");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("archives, pins, renames, and status updates links", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_2",
      });

      const renamed = updateCodexThreadName("thr_test_2", "Renamed thread");
      expect(renamed?.threadName).toBe("Renamed thread");

      const statusUpdated = updateCodexThreadStatus("thr_test_2", "active", ["waitingOnUserInput"]);
      expect(statusUpdated?.statusType).toBe("active");
      expect(statusUpdated?.statusActiveFlags[0]).toBe("waitingOnUserInput");

      const archived = updateCodexThreadArchived("thr_test_2", true);
      expect(archived?.archived).toBe(true);

      const pinned = updateCodexThreadPinned("thr_test_2", true);
      expect(pinned?.pinned).toBe(true);

      const refreshed = upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_2",
        threadName: "Refreshed thread",
      });
      expect(refreshed.pinned).toBe(true);

      const visible = listCodexProjectThreads(projectId, { includeArchived: false });
      expect(visible.length).toBe(0);

      const withArchived = listCodexProjectThreads(projectId, { includeArchived: true });
      expect(withArchived.length).toBe(1);
      expect(withArchived[0]?.threadId).toBe("thr_test_2");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("stores project-only and projectless threads without card ownership", async () => {
    const ran = await withTempDatabase(async () => {
      const projectOnly = upsertCodexThread({
        projectId: projectId,
        threadId: "thr_project_only",
        threadName: "Project thread",
        cwd: "/tmp/codex",
        statusType: "idle",
      });
      const projectless = upsertCodexThread({
        projectId: null,
        threadId: "thr_projectless",
        threadName: "Projectless thread",
        statusType: "idle",
      });

      expect(projectOnly.projectId).toBe(projectId);
      expect(projectless.projectId ?? null).toBe(null);

      const byProject = listCodexProjectThreads(projectId);
      expect(byProject.length).toBe(1);
      expect(byProject[0]?.threadId).toBe("thr_project_only");

      const allThreads = JSON.stringify([
        getCodexThread("thr_project_only")?.threadId,
        getCodexThread("thr_projectless")?.threadId,
      ]);
      expect(allThreads).toBe(JSON.stringify(["thr_project_only", "thr_projectless"]));
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("project update keeps linked thread rows", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: projectId,
        threadId: "thr_test_rename",
      });

      const updated = updateProject(projectId, {
        name: "Codex Renamed",
        sources: ["/tmp/codex-renamed"],
      });
      expect(updated?.id).toBe(projectId);
      expect(updated?.primaryWorkspaceRoot).toBe("/tmp/codex-renamed");

      const link = getCodexThread("thr_test_rename");
      expect(link?.projectId).toBe(projectId);
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("orders global pinned threads and excludes archived rows", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({ projectId, threadId: "thr_pin_a" });
      upsertCodexThread({ projectId, threadId: "thr_pin_b" });
      upsertCodexThread({ projectId, threadId: "thr_pin_c" });

      expect(JSON.stringify(setCodexThreadPinned("thr_pin_b", true))).toBe(JSON.stringify(["thr_pin_b"]));
      expect(JSON.stringify(setCodexThreadPinned("thr_pin_a", true))).toBe(JSON.stringify(["thr_pin_b", "thr_pin_a"]));
      expect(JSON.stringify(setCodexThreadPinned("thr_pin_b", true))).toBe(JSON.stringify(["thr_pin_b", "thr_pin_a"]));
      expect(JSON.stringify(setCodexThreadPinned("thr_pin_c", true))).toBe(JSON.stringify(["thr_pin_b", "thr_pin_a", "thr_pin_c"]));

      updateCodexThreadArchived("thr_pin_b", true);
      expect(JSON.stringify(listPinnedCodexThreadIds())).toBe(JSON.stringify(["thr_pin_a", "thr_pin_c"]));

      expect(JSON.stringify(setCodexThreadPinned("thr_pin_a", false))).toBe(JSON.stringify(["thr_pin_c"]));
    });

    if (!ran) expect(true).toBeTrue();
  });

});
