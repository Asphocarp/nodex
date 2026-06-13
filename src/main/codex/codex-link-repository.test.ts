import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, createCard, createProject, initializeDatabase, updateProject } from "../kanban/db-service";
import {
  getCodexCardThreadLink,
  listCodexProjectThreads,
  updateCodexThreadArchived,
  updateCodexThreadName,
  updateCodexThreadStatus,
  upsertCodexThread,
  upsertCodexCardThreadLink,
} from "./codex-link-repository";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let projectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-links-"));
  process.env.KANBAN_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
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
    delete process.env.KANBAN_DIR;
  }
}

describe("codex-link-repository", () => {
  test("upserts and queries thread links", async () => {
    const ran = await withTempDatabase(async () => {
      const card = await createCard(projectId, "in_progress", { title: "Implement Codex integration" });

      const first = upsertCodexCardThreadLink({
        projectId: projectId,
        cardId: card.id,
        threadId: "thr_test_1",
        source: { parentThreadId: "thr_parent" },
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

      const second = upsertCodexCardThreadLink({
        projectId: projectId,
        cardId: card.id,
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

      const byProject = listCodexProjectThreads(projectId);
      expect(byProject.length).toBe(1);
      expect(byProject[0]?.threadId).toBe("thr_test_1");

      const byCard = listCodexProjectThreads(projectId, { cardId: card.id });
      expect(byCard.length).toBe(1);
      expect(byCard[0]?.cardId).toBe(card.id);
      expect(byCard[0]?.source?.parentThreadId).toBe("thr_parent");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("archives, renames, and status updates links", async () => {
    const ran = await withTempDatabase(async () => {
      const card = await createCard(projectId, "in_progress", { title: "Review links" });

      upsertCodexCardThreadLink({
        projectId: projectId,
        cardId: card.id,
        threadId: "thr_test_2",
      });

      const renamed = updateCodexThreadName("thr_test_2", "Renamed thread");
      expect(renamed?.threadName).toBe("Renamed thread");

      const statusUpdated = updateCodexThreadStatus("thr_test_2", "active", ["waitingOnUserInput"]);
      expect(statusUpdated?.statusType).toBe("active");
      expect(statusUpdated?.statusActiveFlags[0]).toBe("waitingOnUserInput");

      const archived = updateCodexThreadArchived("thr_test_2", true);
      expect(archived?.archived).toBe(true);

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
        cardId: null,
        threadId: "thr_projectless",
        threadName: "Projectless thread",
        statusType: "idle",
      });

      expect(projectOnly.projectId).toBe(projectId);
      expect(projectOnly.cardId ?? null).toBe(null);
      expect(projectless.projectId ?? null).toBe(null);
      expect(projectless.cardId ?? null).toBe(null);

      const byProject = listCodexProjectThreads(projectId);
      expect(byProject.length).toBe(1);
      expect(byProject[0]?.threadId).toBe("thr_project_only");

      const allThreads = JSON.stringify([
        getCodexCardThreadLink("thr_project_only")?.threadId,
        getCodexCardThreadLink("thr_projectless")?.threadId,
      ]);
      expect(allThreads).toBe(JSON.stringify(["thr_project_only", "thr_projectless"]));
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("project update keeps linked thread rows", async () => {
    const ran = await withTempDatabase(async () => {
      const card = await createCard(projectId, "in_progress", { title: "Rename project" });

      upsertCodexCardThreadLink({
        projectId: projectId,
        cardId: card.id,
        threadId: "thr_test_rename",
      });

      const updated = updateProject(projectId, {
        name: "Codex Renamed",
        sources: ["/tmp/codex-renamed"],
      });
      expect(updated?.id).toBe(projectId);
      expect(updated?.primaryWorkspaceRoot).toBe("/tmp/codex-renamed");

      const link = getCodexCardThreadLink("thr_test_rename");
      expect(link?.projectId).toBe(projectId);
    });

    if (!ran) expect(true).toBeTrue();
  });

});
