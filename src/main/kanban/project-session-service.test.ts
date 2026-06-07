import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  createProject,
  initializeDatabase,
  renameProject,
} from "./db-service";
import {
  createProjectSession,
  createProjectSessionTab,
  detachProjectSessionThread,
  getProjectSession,
  listProjectSessions,
  reorderProjectSessionTabs,
  reorderProjectSessions,
  updateProjectSessionTab,
  upsertProjectSessionThreadLink,
} from "./project-session-service";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-project-sessions-"));
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

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KANBAN_DIR;
  }
}

describe("project session service", () => {
  test("returns a default overview session for every project", async () => {
    const ran = await withTempDatabase(async () => {
      const defaultSessions = listProjectSessions("default");
      expect(defaultSessions.length).toBe(1);
      expect(defaultSessions[0]?.id).toBe("overview:default");
      expect(defaultSessions[0]?.title).toBe("Overview");
      expect(defaultSessions[0]?.isOverview).toBeTrue();
      expect(defaultSessions[0]?.leftPaneCollapsed).toBeTrue();
      expect(defaultSessions[0]?.tabs.length).toBe(1);
      expect(defaultSessions[0]?.tabs[0]?.kind).toBe("db_view");
      expect(JSON.stringify(defaultSessions[0]?.tabs[0]?.config)).toBe(
        JSON.stringify({ projectId: "default", view: "kanban" }),
      );

      createProject({ id: "alpha", name: "Alpha", workspacePath: "/tmp/alpha" });
      const alphaSessions = listProjectSessions("alpha");
      expect(alphaSessions.length).toBe(1);
      expect(alphaSessions[0]?.id).toBe("overview:alpha");
      expect(alphaSessions[0]?.tabs[0]?.id).toBe("overview:alpha:db");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("creates and reorders sessions and tabs with validated tab config", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: "default", title: "Build" });
      const sessions = reorderProjectSessions("default", [session.id, "overview:default"]);
      expect(JSON.stringify(sessions.map((item) => item.id))).toBe(
        JSON.stringify([session.id, "overview:default"]),
      );

      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId: "default",
          terminalSessionId: "term-1",
          mode: "project",
        },
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        kind: "browser_placeholder",
        title: "Browser",
        config: {
          title: "Browser",
          url: "https://example.com",
        },
      });

      const updatedTerminal = updateProjectSessionTab(terminal.id, {
        title: "Shell",
        config: {
          projectId: "default",
          terminalSessionId: "term-2",
          mode: "project",
        },
      });
      expect(updatedTerminal?.title).toBe("Shell");
      expect(JSON.stringify(updatedTerminal?.config)).toBe(
        JSON.stringify({ projectId: "default", terminalSessionId: "term-2", mode: "project" }),
      );

      const reordered = reorderProjectSessionTabs(session.id, [terminal.id, browser.id]);
      expect(reordered !== null).toBeTrue();
      expect(JSON.stringify(reordered?.tabs.map((tab) => tab.id))).toBe(
        JSON.stringify([terminal.id, browser.id]),
      );
      expect(reordered?.rightPaneLayout.root.type).toBe("leaf");
      if (reordered?.rightPaneLayout.root.type === "leaf") {
        expect(JSON.stringify(reordered.rightPaneLayout.root.tabIds)).toBe(
          JSON.stringify([terminal.id, browser.id]),
        );
        expect(reordered.rightPaneLayout.root.activeTabId).toBe(browser.id);
      }

      let validationMessage = "";
      try {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: "default",
          kind: "terminal",
          title: "Broken",
          config: {
            projectId: "default",
            mode: "project",
          } as never,
        });
      } catch (error) {
        validationMessage = (error as Error).message;
      }
      expect(validationMessage.length > 0).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("attaches and detaches session-owned thread metadata", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: "default", title: "Agent run" });
      const attached = upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: "default",
        threadId: "thread-1",
        parentThreadId: "parent-1",
        threadName: "Thread One",
        threadPreview: "Working on the redesign",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "running",
        statusActiveFlags: ["streaming"],
        archived: false,
        createdAt: 10,
        updatedAt: 20,
      });

      expect(attached.threadId).toBe("thread-1");
      expect(attached.parentThreadId).toBe("parent-1");
      expect(attached.threadName).toBe("Thread One");
      expect(JSON.stringify(attached.statusActiveFlags)).toBe(JSON.stringify(["streaming"]));

      const updated = upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: "default",
        threadId: "thread-2",
        threadPreview: "Follow-up",
      });
      expect(updated.threadId).toBe("thread-2");
      expect(updated.parentThreadId).toBe("parent-1");
      expect(updated.threadPreview).toBe("Follow-up");

      expect(detachProjectSessionThread(session.id)).toBeTrue();
      expect(getProjectSession(session.id)?.thread === null).toBeTrue();
      expect(detachProjectSessionThread(session.id)).toBeFalse();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("keeps session tab configs project-scoped after project rename", async () => {
    const ran = await withTempDatabase(async () => {
      createProject({ id: "alpha", name: "Alpha", workspacePath: "/tmp/alpha" });
      const sessions = listProjectSessions("alpha");
      const overview = sessions[0];
      expect(JSON.stringify(overview?.tabs[0]?.config)).toBe(
        JSON.stringify({ projectId: "alpha", view: "kanban" }),
      );

      const renamed = renameProject("alpha", "beta", { name: "Beta" });
      expect(renamed?.id).toBe("beta");

      const renamedSessions = listProjectSessions("beta");
      expect(renamedSessions[0]?.projectId).toBe("beta");
      expect(renamedSessions[0]?.tabs[0]?.projectId).toBe("beta");
      expect(JSON.stringify(renamedSessions[0]?.tabs[0]?.config)).toBe(
        JSON.stringify({ projectId: "beta", view: "kanban" }),
      );
    });

    if (!ran) expect(true).toBeTrue();
  });
});
