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
  archiveProjectSession,
  moveProjectSessionTab,
  reorderProjectSessionTabs,
  reorderProjectSessions,
  setPinnedProjectSessionOrder,
  setProjectSessionPinned,
  markProjectSessionUnread,
  updateProjectSessionPanel,
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
      expect(defaultSessions[0]?.panels.right.collapsed).toBeFalse();
      expect(defaultSessions[0]?.panels.right.size.fullWidth).toBeTrue();
      expect(defaultSessions[0]?.panels.bottom.collapsed).toBeTrue();
      expect(defaultSessions[0]?.tabs.length).toBe(1);
      expect(defaultSessions[0]?.tabs[0]?.panelId).toBe("right");
      expect(defaultSessions[0]?.tabs[0]?.kind).toBe("db_view");
      expect(JSON.stringify(defaultSessions[0]?.tabs[0]?.config)).toBe(
        JSON.stringify({ projectId: "default", view: "kanban" }),
      );

      createProject({ id: "alpha", name: "Alpha", workspacePath: "/tmp/alpha" });
      const alphaSessions = listProjectSessions("alpha");
      expect(alphaSessions.length).toBe(1);
      expect(alphaSessions[0]?.id).toBe("overview:alpha");
      expect(alphaSessions[0]?.panels.right.collapsed).toBeFalse();
      expect(alphaSessions[0]?.tabs[0]?.id).toBe("overview:alpha:db");
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("creates and reorders sessions and tabs with validated tab config", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: "default", title: "Build" });
      expect(session.isOverview).toBeFalse();
      expect(session.panels.right.collapsed).toBeTrue();
      expect(session.panels.bottom.collapsed).toBeTrue();

      const sessions = reorderProjectSessions("default", [session.id, "overview:default"]);
      expect(JSON.stringify(sessions.map((item) => item.id))).toBe(
        JSON.stringify(["overview:default", session.id]),
      );

      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId: "default",
          terminalSessionId: "term-1",
        },
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
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
        },
      });
      expect(updatedTerminal?.title).toBe("Shell");
      expect(JSON.stringify(updatedTerminal?.config)).toBe(
        JSON.stringify({ projectId: "default", terminalSessionId: "term-2" }),
      );

      const reordered = reorderProjectSessionTabs({
        sessionId: session.id,
        panelId: "right",
        orderedTabIds: [browser.id],
      });
      expect(reordered !== null).toBeTrue();
      expect(reordered?.tabs.find((tab) => tab.id === terminal.id)?.panelId).toBe("bottom");
      expect(reordered?.tabs.find((tab) => tab.id === browser.id)?.panelId).toBe("right");
      expect(reordered?.panels.right.layout.root.type).toBe("leaf");
      if (reordered?.panels.right.layout.root.type === "leaf") {
        expect(JSON.stringify(reordered.panels.right.layout.root.tabIds)).toBe(
          JSON.stringify([browser.id]),
        );
        expect(reordered.panels.right.layout.root.activeTabId).toBe(browser.id);
      }
      expect(reordered?.panels.bottom.layout.root.type).toBe("leaf");
      if (reordered?.panels.bottom.layout.root.type === "leaf") {
        expect(JSON.stringify(reordered.panels.bottom.layout.root.tabIds)).toBe(
          JSON.stringify([terminal.id]),
        );
        expect(reordered.panels.bottom.layout.root.activeTabId).toBe(terminal.id);
      }

      let validationMessage = "";
      try {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: "default",
          panelId: "bottom",
          kind: "terminal",
          title: "Broken",
          config: {
            projectId: "default",
          } as never,
        });
      } catch (error) {
        validationMessage = (error as Error).message;
      }
      expect(validationMessage.length > 0).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("pins, reorders pinned sessions, and archives without deleting sessions", async () => {
    const ran = await withTempDatabase(async () => {
      const alpha = createProjectSession({ projectId: "default", title: "Alpha" });
      const beta = createProjectSession({ projectId: "default", title: "Beta" });
      const gamma = createProjectSession({ projectId: "default", title: "Gamma" });

      const pinnedAlpha = setProjectSessionPinned(alpha.id, { pinned: true });
      const pinnedGamma = setProjectSessionPinned(gamma.id, { pinned: true });
      expect(pinnedAlpha?.pinned).toBeTrue();
      expect(pinnedAlpha?.pinnedOrder).toBe(0);
      expect(pinnedGamma?.pinnedOrder).toBe(1);

      let sessions = listProjectSessions("default");
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify(["overview:default", alpha.id, gamma.id, beta.id]),
      );

      sessions = setPinnedProjectSessionOrder("default", { orderedSessionIds: [gamma.id, alpha.id] });
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify(["overview:default", gamma.id, alpha.id, beta.id]),
      );

      const unreadGamma = markProjectSessionUnread(gamma.id, { unread: true });
      expect(unreadGamma?.unread).toBeTrue();
      const archivedGamma = archiveProjectSession(gamma.id);
      expect(archivedGamma?.archived).toBeTrue();
      expect(archivedGamma?.pinned).toBeFalse();
      expect(archivedGamma?.pinnedOrder).toBe(null);
      expect(archivedGamma?.unread).toBeFalse();

      sessions = listProjectSessions("default");
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify(["overview:default", alpha.id, beta.id]),
      );

      const archivedVisible = listProjectSessions("default", { includeArchived: true });
      expect(archivedVisible.some((session) => session.id === gamma.id)).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("returns existing fixed tabs instead of creating duplicate singleton tabs", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: "default", title: "Fixed tabs" });

      const dbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: "default", view: "kanban" },
      });
      const duplicateDbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "db_view",
        title: "Another DB View",
        config: { projectId: "default", view: "list" },
      });
      expect(duplicateDbView.id).toBe(dbView.id);

      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: "default" },
      });
      const duplicateReview = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "review",
        title: "Review changes",
        config: { projectId: "default" },
      });
      expect(duplicateReview.id).toBe(review.id);

      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "browser_placeholder",
        title: "Browser",
        config: {},
      });
      const duplicateBrowser = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "browser_placeholder",
        title: "Website",
        config: { url: "https://example.com" },
      });
      expect(duplicateBrowser.id).toBe(browser.id);

      const terminalOne = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: "default", terminalSessionId: "term-1" },
      });
      const terminalTwo = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: "default", terminalSessionId: "term-2" },
      });
      expect(terminalOne.id === terminalTwo.id).toBeFalse();

      const updated = getProjectSession(session.id);
      expect(updated?.tabs.filter((tab) => tab.kind === "db_view").length).toBe(1);
      expect(updated?.tabs.filter((tab) => tab.kind === "review").length).toBe(1);
      expect(updated?.tabs.filter((tab) => tab.kind === "browser_placeholder").length).toBe(1);
      expect(updated?.tabs.filter((tab) => tab.kind === "terminal").length).toBe(2);
      if (updated?.panels.bottom.layout.root.type === "leaf") {
        expect(updated.panels.bottom.layout.root.activeTabId).toBe(terminalTwo.id);
      }
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
      expect(updated.parentThreadId ?? null).toBe(null);
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

  test("updates panel state and moves tabs between panels while preserving state", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: "default", title: "Panels" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: "default" },
      });
      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: "default",
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: "default", terminalSessionId: "term-1" },
      });

      const stateful = updateProjectSessionTab(terminal.id, { stateKey: 2, state: { cwd: "/tmp/default" } });
      expect(stateful?.stateKey).toBe(2);
      expect(JSON.stringify(stateful?.state)).toBe(JSON.stringify({ cwd: "/tmp/default" }));

      const sized = updateProjectSessionPanel(session.id, "bottom", {
        collapsed: false,
        size: { heightPx: 360 },
      });
      expect(sized?.panels.bottom.collapsed).toBeFalse();
      expect(sized?.panels.bottom.size.heightPx).toBe(360);

      const moved = moveProjectSessionTab({
        tabId: terminal.id,
        targetPanelId: "right",
        targetIndex: 0,
      });
      expect(moved?.tabs.find((tab) => tab.id === terminal.id)?.panelId).toBe("right");
      expect(moved?.tabs.find((tab) => tab.id === terminal.id)?.stateKey).toBe(2);
      if (moved?.panels.right.layout.root.type === "leaf") {
        expect(moved.panels.right.layout.root.activeTabId).toBe(terminal.id);
        expect(JSON.stringify(moved.panels.right.layout.root.tabIds)).toBe(
          JSON.stringify([terminal.id, review.id]),
        );
      }
      if (moved?.panels.bottom.layout.root.type === "leaf") {
        expect(moved.panels.bottom.layout.root.activeTabId ?? null).toBe(null);
        expect(JSON.stringify(moved.panels.bottom.layout.root.tabIds)).toBe(JSON.stringify([]));
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});
