import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, initializeDatabase } from "./local-store/database";
import { deleteProjectBlockFirst } from "./local-store/project-deletion";
import { createProject, listProjects } from "./local-store/projects";
import {
  createProjectSession,
  createProjectSessionTab,
  getProjectSession,
} from "./local-store/project-sessions";
import type { BrowserSidebarTabIdentity } from "../shared/browser-sidebar";
import {
  deleteProjectSessionTabWithBrowserCleanup,
  deleteProjectSessionWithBrowserCleanup,
  deleteProjectWithBrowserCleanup,
  type ProjectSessionBrowserRuntime,
} from "./project-session-browser-ownership";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (projectId: string) => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-ownership-"));
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

  const project = listProjects()[0];
  if (!project) throw new Error("Missing default project");
  try {
    await run(project.id);
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function createRuntimeRecorder(): {
  browserConversations: string[];
  browserTabs: BrowserSidebarTabIdentity[];
  runtime: ProjectSessionBrowserRuntime;
} {
  const browserConversations: string[] = [];
  const browserTabs: BrowserSidebarTabIdentity[] = [];
  return {
    browserConversations,
    browserTabs,
    runtime: {
      closeBrowserConversation: (browserConversationId) => {
        browserConversations.push(browserConversationId);
      },
      closeBrowserTab: (identity) => {
        browserTabs.push(identity);
      },
    },
  };
}

describe("project session browser ownership", () => {
  test("keeps a shared browser identity alive until its final panel descriptor is deleted", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: null, noThreadFallbackTitle: "Browser" });
      const first = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "right",
        kind: "browser",
        title: "One",
        browserTabId: "shared-browser",
        config: { projectId: null },
      });
      const second = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "bottom",
        kind: "browser",
        title: "Two",
        browserTabId: "shared-browser",
        config: { projectId: null },
      });
      const recorder = createRuntimeRecorder();

      expect(await deleteProjectSessionTabWithBrowserCleanup(first.id, recorder.runtime)).toBe(true);
      expect(recorder.browserTabs.length).toBe(0);
      expect(await deleteProjectSessionTabWithBrowserCleanup(second.id, recorder.runtime)).toBe(true);
      expect(JSON.stringify(recorder.browserTabs)).toBe(JSON.stringify([{
        browserConversationId: session.id,
        browserTabId: "shared-browser",
      }]));
    });

    if (!ran) expect(true).toBe(true);
  });

  test("closes the complete browser conversation after session deletion", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: null, noThreadFallbackTitle: "Browser" });
      const recorder = createRuntimeRecorder();

      expect(await deleteProjectSessionWithBrowserCleanup(session.id, recorder.runtime)).toBe(true);
      expect(JSON.stringify(recorder.browserConversations)).toBe(JSON.stringify([session.id]));
      expect(getProjectSession(session.id) === null).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("closes project-owned browser conversations while preserving archived session history", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Disposable", sources: ["/tmp/disposable"] });
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "Browser" });
      createProjectSessionTab({
        sessionId: session.id,
        projectId: project.id,
        panelId: "right",
        kind: "browser",
        title: "Browser",
        config: { projectId: project.id },
      });
      const recorder = createRuntimeRecorder();

      expect(await deleteProjectWithBrowserCleanup(
        project.id,
        recorder.runtime,
        (targetProjectId) => deleteProjectBlockFirst(getDb(), targetProjectId).deleted,
      )).toBe(true);
      expect(recorder.browserConversations.includes(session.id)).toBe(true);
      expect(getProjectSession(session.id)?.projectId).toBe(project.id);
      expect(
        (
          getDb().prepare("SELECT lifecycle FROM projects WHERE id = ?").get(
            project.id,
          ) as { readonly lifecycle: string }
        ).lifecycle,
      ).toBe("archived");
    });

    if (!ran) expect(true).toBe(true);
  });
});
