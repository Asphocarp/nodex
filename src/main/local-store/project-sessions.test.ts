import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createPage } from "./database-pages";
import { createProject, listProjects, updateProject } from "./projects";
import {
  createProjectSession,
  createProjectSessionTab,
  deleteProjectSessionTab,
  detachProjectSessionThread,
  ensureProjectSessionPanelLeafToRight,
  getProjectSession,
  listProjectSessionThreadOwners,
  listProjectSessionSummaries,
  activateProjectSessionPanelGroup,
  listProjectSessions,
  listProjectlessSessions,
  archiveProjectSession,
  moveProjectSessionToProject,
  moveProjectSessionTab,
  reorderProjectSessionTabs,
  reorderProjectSessions,
  setPinnedProjectSessionOrder,
  setProjectSessionPinned,
  markProjectSessionUnread,
  splitProjectSessionPanelGroup,
  updateProjectSessionPanel,
  updateProjectSessionTab,
  upsertProjectSessionThreadLink,
} from "./project-sessions";
import {
  flattenProjectSessionPanelTabIds,
  getProjectSessionPanelActiveLeaf,
  listProjectSessionPanelLeaves,
} from "../../shared/project-session-panel-layout";
import { MAX_PROJECT_SESSION_TITLE_LENGTH } from "../../shared/schemas/project-sessions";
import {
  getCodexThread,
  setCodexThreadHasUnreadTurn,
  updateCodexThreadArchived,
  upsertCodexThread,
} from "../codex/codex-link-repository";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let projectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-project-sessions-"));
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

  const defaultProject = listProjects()[0];
  if (!defaultProject) throw new Error("Missing default project");
  projectId = defaultProject.id;

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function runValidation(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function readPrimaryDatabaseViewId(targetProjectId: string): string {
  const row = getDb().prepare(`
    SELECT view.id
    FROM database_views view
    INNER JOIN database_capabilities capability
      ON capability.block_id = view.database_block_id
      AND capability.project_id = view.project_id
      AND capability.is_primary = 1
    WHERE view.project_id = ?
      AND view.is_primary = 1
      AND view.lifecycle = 'active'
    LIMIT 1
  `).get(targetProjectId) as { readonly id: string } | undefined;
  if (!row) throw new Error(`Missing primary Database View for Project ${targetProjectId}`);
  return row.id;
}

function insertSecondaryDatabaseView(targetProjectId: string, viewId: string): void {
  const primary = getDb().prepare(`
    SELECT database_block_id, config_json
    FROM database_views
    WHERE id = ? AND project_id = ?
  `).get(readPrimaryDatabaseViewId(targetProjectId), targetProjectId) as {
    readonly database_block_id: string;
    readonly config_json: string;
  } | undefined;
  if (!primary) throw new Error(`Missing primary Database for Project ${targetProjectId}`);
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO database_views (
      id, database_block_id, project_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, 'List', 'list', ?, 0, 1, 'zzzzzzzz', 'active', ?, ?)
  `).run(viewId, primary.database_block_id, targetProjectId, primary.config_json, now, now);
}

describe("project session service", () => {
  test("creates an ordinary pinned Database View session for every new project", async () => {
    const ran = await withTempDatabase(async () => {
      const defaultProject = listProjects()[0];
      if (!defaultProject) throw new Error("Missing default project");
      const defaultSessions = listProjectSessions(defaultProject.id);
      expect(defaultSessions.length).toBe(1);
      expect(defaultSessions[0]?.id.includes(":") ?? true).toBe(false);
      expect(defaultSessions[0]?.noThreadFallbackTitle).toBe("Database View");
      expect(defaultSessions[0]?.displayTitle).toBe("Database View");
      expect(defaultSessions[0]?.pinned).toBe(true);
      expect(defaultSessions[0]?.pinnedOrder).toBe(0);
      expect(defaultSessions[0]?.leftPaneCollapsed).toBe(true);
      expect(defaultSessions[0]?.panels.right.collapsed).toBe(false);
      expect(defaultSessions[0]?.panels.right.size.fullWidth).toBe(true);
      expect(defaultSessions[0]?.panels.bottom.collapsed).toBe(true);
      expect(defaultSessions[0]?.tabs.length).toBe(1);
      expect(defaultSessions[0]?.tabs[0]?.panelId).toBe("right");
      expect(defaultSessions[0]?.tabs[0]?.kind).toBe("db_view");
      expect(JSON.stringify(defaultSessions[0]?.tabs[0]?.config)).toBe(
        JSON.stringify({
          projectId: defaultProject.id,
          databaseViewId: readPrimaryDatabaseViewId(defaultProject.id),
          view: "kanban",
        }),
      );

      const alphaProject = createProject({ name: "Alpha", sources: ["/tmp/alpha"] });
      const alphaSessions = listProjectSessions(alphaProject.id);
      expect(alphaSessions.length).toBe(1);
      expect(alphaSessions[0]?.id.includes(":") ?? true).toBe(false);
      expect(alphaSessions[0]?.displayTitle).toBe("Database View");
      expect(alphaSessions[0]?.pinned).toBe(true);
      expect(alphaSessions[0]?.panels.right.collapsed).toBe(false);
      expect(alphaSessions[0]?.tabs[0]?.kind).toBe("db_view");
      expect(alphaSessions[0]?.tabs[0]?.title).toBe("DB View");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not recreate the Database View session during listing after user removal", async () => {
    const ran = await withTempDatabase(async () => {
      const databaseView = listProjectSessions(projectId)[0];
      if (!databaseView) throw new Error("Missing Database View session");

      getDb().prepare("DELETE FROM project_sessions WHERE id = ?").run(databaseView.id);

      expect(listProjectSessions(projectId).length).toBe(0);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("lists lightweight project session summaries without panel or tab payloads", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Agent run",
      });
      createProjectSessionTab({
        sessionId: session.id,
        projectId,
        panelId: "right",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId,
          terminalSessionId: "terminal:summary-test",
        },
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId,
        threadId: "thread-summary-test",
        forkedFromId: "thread-summary-root",
        threadName: "Thread summary title",
        threadPreview: "Thread summary preview",
        modelProvider: "openai",
        managedWorktreePath: "/tmp/project/.worktrees/thread-summary-test",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      });

      const summary = listProjectSessionSummaries(projectId)
        .find((candidate) => candidate.id === session.id);
      const detail = getProjectSession(session.id);

      expect(summary !== undefined).toBe(true);
      expect(detail !== null).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(summary as object, "tabs")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(summary as object, "panels")).toBe(false);
      expect(summary?.displayTitle).toBe("Thread summary title");
      expect(summary?.thread?.threadId).toBe("thread-summary-test");
      expect(summary?.thread?.forkedFromId).toBe("thread-summary-root");
      expect(summary?.thread?.managedWorktreePath).toBe("/tmp/project/.worktrees/thread-summary-test");
      expect(detail?.thread?.forkedFromId).toBe("thread-summary-root");
      expect(detail?.tabs.length).toBe(1);
      expect(detail?.panels.right.collapsed).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("gives projectless browser tabs conversation-scoped identities while rejecting project-scoped tabs", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId: null,
        noThreadFallbackTitle: "External CLI chat",
      });

      expect(session.projectId ?? null).toBe(null);
      expect(listProjectSessions(null).length).toBe(1);
      expect(listProjectlessSessions().length).toBe(1);

      const defaultBrowser = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "right",
        clientTabId: "durable:default-browser",
        kind: "browser",
        title: "Browser",
        config: { projectId: null },
      });
      const allocatedBrowser = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "right",
        clientTabId: "durable:allocated-browser",
        kind: "browser",
        title: "Browser two",
        config: { projectId: null },
      });
      const explicitBrowser = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "bottom",
        kind: "browser",
        title: "Transferred browser",
        browserTabId: "source-browser-id",
        config: { projectId: null, url: "https://example.com" },
      });

      expect(defaultBrowser.id).toBe("durable:default-browser");
      expect(defaultBrowser.browserTabId === `${session.id}:legacy`).toBe(false);
      expect(allocatedBrowser.id).toBe("durable:allocated-browser");
      expect(allocatedBrowser.browserTabId === defaultBrowser.browserTabId).toBe(false);
      expect(allocatedBrowser.browserTabId === allocatedBrowser.id).toBe(false);
      expect(explicitBrowser.browserTabId).toBe("source-browser-id");
      expect(explicitBrowser.projectId ?? null).toBe(null);
      expect(explicitBrowser.config.projectId ?? null).toBe(null);

      const secondSession = createProjectSession({
        projectId: null,
        noThreadFallbackTitle: "Second external chat",
      });
      const sameIdentityInAnotherConversation = createProjectSessionTab({
        sessionId: secondSession.id,
        projectId: null,
        panelId: "right",
        kind: "browser",
        title: "Transferred browser",
        browserTabId: "source-browser-id",
        config: { projectId: null },
      });
      expect(sameIdentityInAnotherConversation.browserTabId).toBe("source-browser-id");

      const duplicatePanelReference = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "right",
        kind: "browser",
        title: "Duplicate identity",
        browserTabId: "source-browser-id",
        config: { projectId: null },
      });
      expect(duplicatePanelReference.browserTabId).toBe("source-browser-id");

      const error = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: null,
          panelId: "right",
          kind: "db_view",
          title: "DB View",
          config: { projectId, view: "kanban" },
        });
      });
      expect(error).toBe("Projectless sessions can only own browser tabs");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("re-homes browser-only sessions without changing browser conversation or tab identity", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId: null,
        noThreadFallbackTitle: "Portable browser",
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: null,
        panelId: "right",
        clientTabId: "durable:portable-browser",
        browserTabId: "named-browser",
        kind: "browser",
        title: "Browser",
        config: { projectId: null, url: "https://example.com" },
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: null,
        threadId: "thread-portable-browser",
        threadPreview: "Portable browser",
        modelProvider: "openai",
      });

      const scoped = moveProjectSessionToProject(session.id, projectId);
      const scopedBrowser = scoped?.tabs[0];
      expect(scoped?.id).toBe(session.id);
      expect(scoped?.projectId).toBe(projectId);
      expect(scoped?.thread?.projectId).toBe(projectId);
      expect(scopedBrowser?.id).toBe(browser.id);
      expect(scopedBrowser?.browserTabId).toBe(browser.browserTabId);
      expect(scopedBrowser?.projectId).toBe(projectId);
      expect(scopedBrowser?.config.projectId).toBe(projectId);
      expect(scopedBrowser && "url" in scopedBrowser.config ? scopedBrowser.config.url : null).toBe(
        "https://example.com",
      );
      expect(getCodexThread("thread-portable-browser")?.projectId).toBe(projectId);

      const projectless = moveProjectSessionToProject(session.id, null);
      const projectlessBrowser = projectless?.tabs[0];
      expect(projectless?.id).toBe(session.id);
      expect(projectless?.projectId ?? null).toBe(null);
      expect(projectless?.thread?.projectId ?? null).toBe(null);
      expect(projectlessBrowser?.id).toBe(browser.id);
      expect(projectlessBrowser?.browserTabId).toBe(browser.browserTabId);
      expect(projectlessBrowser?.projectId ?? null).toBe(null);
      expect(projectlessBrowser?.config.projectId ?? null).toBe(null);
      expect(getCodexThread("thread-portable-browser")?.projectId ?? null).toBe(null);

      const scopedSession = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Project-bound panel",
      });
      createProjectSessionTab({
        sessionId: scopedSession.id,
        projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId },
      });
      const error = runValidation(() => moveProjectSessionToProject(scopedSession.id, null));
      expect(error).toBe("Only empty or browser-only project sessions can move between projects");
      expect(getProjectSession(scopedSession.id)?.projectId).toBe(projectId);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("accepts 2000 character session and tab titles", async () => {
    const ran = await withTempDatabase(async () => {
      const longTitle = "x".repeat(MAX_PROJECT_SESSION_TITLE_LENGTH);
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: longTitle });
      expect(session.noThreadFallbackTitle.length).toBe(MAX_PROJECT_SESSION_TITLE_LENGTH);
      expect(session.displayTitle.length).toBe(MAX_PROJECT_SESSION_TITLE_LENGTH);

      const tab = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "page_stage",
        title: longTitle,
        config: { projectId: projectId, pageId: "card-long", titleSnapshot: longTitle },
      });
      expect(tab.title.length).toBe(MAX_PROJECT_SESSION_TITLE_LENGTH);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects session and tab titles above 2000 characters", async () => {
    const ran = await withTempDatabase(async () => {
      const tooLongTitle = "x".repeat(MAX_PROJECT_SESSION_TITLE_LENGTH + 1);
      const sessionError = runValidation(() => {
        createProjectSession({ projectId: projectId, noThreadFallbackTitle: tooLongTitle });
      });
      expect(
        sessionError?.includes(String(MAX_PROJECT_SESSION_TITLE_LENGTH)) ?? false,
      ).toBe(true);

      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Valid session" });
      const tabError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: projectId,
          panelId: "right",
          kind: "page_stage",
          title: tooLongTitle,
          config: { projectId: projectId, pageId: "card-too-long", titleSnapshot: tooLongTitle },
        });
      });
      expect(
        tabError?.includes(String(MAX_PROJECT_SESSION_TITLE_LENGTH)) ?? false,
      ).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("creates tabs with a supplied client tab id", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Client id session" });
      const tab = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        clientTabId: "tab:page-stage-preview",
        kind: "page_stage",
        title: "Card One",
        config: { projectId: projectId, pageId: "card-1", titleSnapshot: "Card One" },
      });
      const updated = getProjectSession(session.id);

      expect(tab.id).toBe("tab:page-stage-preview");
      expect(updated?.tabs.some((item) => item.id === "tab:page-stage-preview") ?? false).toBe(true);
      expect(getProjectSessionPanelActiveLeaf(updated!.panels.right.layout).activeTabId).toBe("tab:page-stage-preview");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects invalid or duplicate client tab ids", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Client id validation" });
      createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        clientTabId: "tab:page-stage-preview",
        kind: "page_stage",
        title: "Card One",
        config: { projectId: projectId, pageId: "card-1", titleSnapshot: "Card One" },
      });

      const invalidError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: projectId,
          panelId: "right",
          clientTabId: "tab/page-stage-preview",
          kind: "page_stage",
          title: "Card Two",
          config: { projectId: projectId, pageId: "card-2", titleSnapshot: "Card Two" },
        });
      });
      const duplicateError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId: projectId,
          panelId: "right",
          clientTabId: "tab:page-stage-preview",
          kind: "page_stage",
          title: "Card Three",
          config: { projectId: projectId, pageId: "card-3", titleSnapshot: "Card Three" },
        });
      });

      expect(invalidError !== null).toBe(true);
      expect(duplicateError?.includes("Project session tab id already exists") ?? false).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("loads a stored v1 panel layout as a fresh v2 layout from tab rows", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Legacy layout" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: projectId, terminalSessionId: "term-legacy" },
      });
      getDb().prepare(`
        UPDATE project_sessions
        SET panel_state_json = ?
        WHERE id = ?
      `).run(
        JSON.stringify({
          right: {
            collapsed: false,
            layout: {
              version: 1,
              root: { type: "leaf", id: "main", tabIds: ["stale"], activeTabId: "stale" },
            },
            size: { widthPx: 777, fullWidth: true },
          },
          bottom: {
            collapsed: false,
            layout: {
              version: 1,
              root: { type: "leaf", id: "bottom", tabIds: [], activeTabId: null },
            },
            size: { heightPx: 333 },
          },
        }),
        session.id,
      );

      const loaded = getProjectSession(session.id);
      expect(loaded?.panels.right.collapsed).toBe(false);
      expect(loaded?.panels.right.size.widthPx).toBe(777);
      expect(loaded?.panels.right.size.fullWidth).toBe(true);
      expect(loaded?.panels.right.layout.version).toBe(2);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(loaded!.panels.right.layout))).toBe(
        JSON.stringify([review.id]),
      );
      expect(loaded?.panels.bottom.collapsed).toBe(false);
      expect(loaded?.panels.bottom.size.heightPx).toBe(333);
      expect(loaded?.panels.bottom.layout.version).toBe(2);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(loaded!.panels.bottom.layout))).toBe(
        JSON.stringify([terminal.id]),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("creates and reorders sessions and tabs with validated tab config", async () => {
    const ran = await withTempDatabase(async () => {
      const databaseView = listProjectSessions(projectId)[0];
      if (!databaseView) throw new Error("Missing Database View session");
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Build" });
      expect(session.panels.right.collapsed).toBe(true);
      expect(session.panels.bottom.collapsed).toBe(true);

      const sessions = reorderProjectSessions(projectId, [session.id, databaseView.id]);
      expect(JSON.stringify(sessions.map((item) => item.id))).toBe(
        JSON.stringify([databaseView.id, session.id]),
      );

      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId: projectId,
          terminalSessionId: "term-1",
        },
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "browser",
        title: "Browser",
        config: {
          projectId: projectId,
          title: "Browser",
          url: "https://example.com",
        },
      });

      const updatedTerminal = updateProjectSessionTab(terminal.id, {
        title: "Shell",
        config: {
          projectId: projectId,
          terminalSessionId: "term-2",
        },
      });
      expect(updatedTerminal?.title).toBe("Shell");
      expect(JSON.stringify(updatedTerminal?.config)).toBe(
        JSON.stringify({ projectId: projectId, terminalSessionId: "term-2" }),
      );

      const reordered = reorderProjectSessionTabs({
        sessionId: session.id,
        panelId: "right",
        orderedTabIds: [browser.id],
      });
      expect(reordered !== null).toBe(true);
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
          projectId: projectId,
          panelId: "bottom",
          kind: "terminal",
          title: "Broken",
          config: {
            projectId: projectId,
          } as never,
        });
      } catch (error) {
        validationMessage = (error as Error).message;
      }
      expect(validationMessage.length > 0).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("preserves cross-project page-stage tab content project", async () => {
    const ran = await withTempDatabase(async () => {
      const alphaSession = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Alpha work" });
      const betaProject = createProject({ name: "Beta", sources: ["/tmp/beta"] });
      const betaCard = await createPage(betaProject.id, "in_progress", {
        title: "Beta card",
      });

      const tab = createProjectSessionTab({
        sessionId: alphaSession.id,
        projectId: projectId,
        panelId: "right",
        kind: "page_stage",
        title: "Beta card",
        config: { projectId: betaProject.id, pageId: betaCard.id, titleSnapshot: "Beta card" },
      });
      expect(tab.projectId).toBe(projectId);
      expect(JSON.stringify(tab.config)).toBe(
        JSON.stringify({ projectId: betaProject.id, pageId: betaCard.id, titleSnapshot: "Beta card" }),
      );

      const updated = updateProjectSessionTab(tab.id, {
        config: { projectId: betaProject.id, pageId: betaCard.id, titleSnapshot: "Beta card updated" },
      });
      expect(updated?.projectId).toBe(projectId);
      expect(JSON.stringify(updated?.config)).toBe(
        JSON.stringify({ projectId: betaProject.id, pageId: betaCard.id, titleSnapshot: "Beta card updated" }),
      );

      const reloaded = getProjectSession(alphaSession.id)?.tabs.find((item) => item.id === tab.id);
      expect(reloaded?.projectId).toBe(projectId);
      expect(JSON.stringify(reloaded?.config)).toBe(
        JSON.stringify({ projectId: betaProject.id, pageId: betaCard.id, titleSnapshot: "Beta card updated" }),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("inserts newly created project sessions at the top below pinned Database View", async () => {
    const ran = await withTempDatabase(async () => {
      const databaseView = listProjectSessions(projectId)[0];
      if (!databaseView) throw new Error("Missing Database View session");
      const first = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "First" });
      const second = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Second" });

      const sessions = listProjectSessions(projectId);
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify([databaseView.id, second.id, first.id]),
      );
      expect(sessions.find((session) => session.id === databaseView.id)?.order).toBe(2);
      expect(sessions.find((session) => session.id === second.id)?.order).toBe(0);
      expect(sessions.find((session) => session.id === first.id)?.order).toBe(1);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("pins, reorders pinned sessions, and archives without deleting sessions", async () => {
    const ran = await withTempDatabase(async () => {
      const databaseView = listProjectSessions(projectId)[0];
      if (!databaseView) throw new Error("Missing Database View session");
      const alpha = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Alpha" });
      const beta = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Beta" });
      const gamma = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Gamma" });

      const pinnedAlpha = setProjectSessionPinned(alpha.id, { pinned: true });
      const pinnedGamma = setProjectSessionPinned(gamma.id, { pinned: true });
      expect(pinnedAlpha?.pinned).toBe(true);
      expect(pinnedAlpha?.pinnedOrder).toBe(1);
      expect(pinnedGamma?.pinnedOrder).toBe(2);

      let sessions = listProjectSessions(projectId);
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify([databaseView.id, alpha.id, gamma.id, beta.id]),
      );

      sessions = setPinnedProjectSessionOrder(projectId, { orderedSessionIds: [gamma.id, alpha.id] });
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify([gamma.id, alpha.id, databaseView.id, beta.id]),
      );

      const unreadGamma = markProjectSessionUnread(gamma.id, { unread: true });
      expect(unreadGamma?.unread).toBe(true);
      const archivedGamma = archiveProjectSession(gamma.id);
      expect(archivedGamma?.archived).toBe(true);
      expect(archivedGamma?.pinned).toBe(false);
      expect(archivedGamma?.pinnedOrder).toBe(null);
      expect(archivedGamma?.unread).toBe(false);

      sessions = listProjectSessions(projectId);
      expect(JSON.stringify(sessions.map((session) => session.id))).toBe(
        JSON.stringify([alpha.id, databaseView.id, beta.id]),
      );

      const archivedVisible = listProjectSessions(projectId, { includeArchived: true });
      expect(archivedVisible.some((session) => session.id === gamma.id)).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("dedupes DB tabs by durable View identity and singleton tabs by kind", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Fixed tabs" });
      const betaProject = createProject({ name: "Beta", sources: ["/tmp/beta"] });
      const primaryViewId = readPrimaryDatabaseViewId(projectId);
      const secondaryViewId = "database-view:project-session:secondary";
      insertSecondaryDatabaseView(projectId, secondaryViewId);

      const dbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: projectId, databaseViewId: primaryViewId, view: "kanban" },
      });
      const duplicateDbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "Another DB View",
        config: { projectId: projectId, databaseViewId: primaryViewId, view: "list" },
      });
      expect(duplicateDbView.id).toBe(dbView.id);
      const secondaryDbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "Secondary DB View",
        config: { projectId: projectId, databaseViewId: secondaryViewId, view: "list" },
      });
      expect(secondaryDbView.id === dbView.id).toBe(false);
      const betaDbView = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "Beta DB View",
        config: { projectId: betaProject.id, view: "kanban" },
      });
      expect(betaDbView.id === dbView.id).toBe(false);

      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const duplicateReview = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review changes",
        config: { projectId: projectId },
      });
      expect(duplicateReview.id).toBe(review.id);

      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "browser",
        title: "Browser",
        config: { projectId: projectId },
      });
      const duplicateBrowser = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "browser",
        title: "Website",
        config: { projectId: projectId, url: "https://example.com" },
      });
      expect(duplicateBrowser.id === browser.id).toBe(false);

      const terminalOne = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: projectId, terminalSessionId: "term-1" },
      });
      const terminalTwo = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: projectId, terminalSessionId: "term-2" },
      });
      expect(terminalOne.id === terminalTwo.id).toBe(false);

      const updated = getProjectSession(session.id);
      expect(updated?.tabs.filter((tab) => tab.kind === "db_view").length).toBe(3);
      expect(updated?.tabs.filter((tab) => tab.kind === "review").length).toBe(1);
      expect(updated?.tabs.filter((tab) => tab.kind === "browser").length).toBe(2);
      expect(updated?.tabs.filter((tab) => tab.kind === "terminal").length).toBe(2);
      if (updated?.panels.bottom.layout.root.type === "leaf") {
        expect(updated.panels.bottom.layout.root.activeTabId).toBe(terminalTwo.id);
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects missing, deleted, and cross-Project Database View identities", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId,
        noThreadFallbackTitle: "View validation",
      });
      const betaProject = createProject({ name: "Beta", sources: ["/tmp/beta"] });
      const betaViewId = readPrimaryDatabaseViewId(betaProject.id);
      const deletedViewId = "database-view:project-session:deleted";
      insertSecondaryDatabaseView(projectId, deletedViewId);
      getDb().prepare(`
        UPDATE database_views
        SET lifecycle = 'deleted', updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), deletedViewId);

      const crossProjectError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId,
          panelId: "right",
          kind: "db_view",
          title: "Wrong Project",
          config: { projectId, databaseViewId: betaViewId, view: "kanban" },
        });
      });
      const missingError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId,
          panelId: "right",
          kind: "db_view",
          title: "Missing View",
          config: { projectId, databaseViewId: "database-view:missing", view: "list" },
        });
      });
      const deletedError = runValidation(() => {
        createProjectSessionTab({
          sessionId: session.id,
          projectId,
          panelId: "right",
          kind: "db_view",
          title: "Deleted View",
          config: { projectId, databaseViewId: deletedViewId, view: "list" },
        });
      });

      const validTab = createProjectSessionTab({
        sessionId: session.id,
        projectId,
        panelId: "right",
        kind: "db_view",
        title: "Primary View",
        config: {
          projectId,
          databaseViewId: readPrimaryDatabaseViewId(projectId),
          view: "kanban",
        },
      });
      const rejectedUpdate = runValidation(() => {
        updateProjectSessionTab(validTab.id, {
          config: { projectId, databaseViewId: betaViewId, view: "list" },
        });
      });

      expect(crossProjectError?.includes("was not found in Project") ?? false).toBe(true);
      expect(missingError?.includes("was not found in Project") ?? false).toBe(true);
      expect(deletedError?.includes("was not found in Project") ?? false).toBe(true);
      expect(rejectedUpdate?.includes("was not found in Project") ?? false).toBe(true);
      expect(
        (getProjectSession(session.id)?.tabs[0]?.config as { databaseViewId?: string })
          .databaseViewId,
      ).toBe(readPrimaryDatabaseViewId(projectId));
    });

    if (!ran) expect(true).toBe(true);
  });

  test("round-trips and restarts arbitrary Database View tabs by stable identity", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Durable View",
      });
      const viewId = "database-view:project-session:restart";
      insertSecondaryDatabaseView(projectId, viewId);
      const tab = createProjectSessionTab({
        sessionId: session.id,
        projectId,
        panelId: "right",
        kind: "db_view",
        title: "Research list",
        config: { projectId, databaseViewId: viewId, view: "list" },
      });
      const storedBeforeRestart = getDb().prepare(`
        SELECT config_json
        FROM project_session_tabs
        WHERE id = ?
      `).get(tab.id) as { readonly config_json: string };
      expect(storedBeforeRestart.config_json).toBe(JSON.stringify({
        projectId,
        databaseViewId: viewId,
        view: "list",
      }));

      closeDatabase();
      await initializeDatabase();
      const reloaded = getProjectSession(session.id)?.tabs.find(
        (candidate) => candidate.id === tab.id,
      );
      expect(JSON.stringify(reloaded?.config)).toBe(storedBeforeRestart.config_json);

      const duplicate = createProjectSessionTab({
        sessionId: session.id,
        projectId,
        panelId: "bottom",
        kind: "db_view",
        title: "Same identity",
        config: { projectId, databaseViewId: viewId, view: "kanban" },
      });
      expect(duplicate.id).toBe(tab.id);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("normalizes a legacy overview config once only through the active default View", async () => {
    const ran = await withTempDatabase(async () => {
      const overviewTab = getDb().prepare(`
        SELECT tab.id
        FROM project_session_tabs tab
        INNER JOIN project_sessions session ON session.id = tab.session_id
        WHERE session.project_id = ? AND tab.kind = 'db_view'
        ORDER BY session.created_at, tab.created_at
        LIMIT 1
      `).get(projectId) as { readonly id: string };
      getDb().prepare(`
        UPDATE project_session_tabs
        SET config_json = ?
        WHERE id = ?
      `).run(JSON.stringify({ projectId, view: "kanban" }), overviewTab.id);
      const rawBefore = getDb().prepare(`
        SELECT tab.id, tab.config_json, tab.updated_at
        FROM project_session_tabs tab
        INNER JOIN project_sessions session ON session.id = tab.session_id
        WHERE session.project_id = ? AND tab.kind = 'db_view'
        ORDER BY session.created_at, tab.created_at
        LIMIT 1
      `).get(projectId) as {
        readonly id: string;
        readonly config_json: string;
        readonly updated_at: string;
      };
      expect(rawBefore.config_json).toBe(JSON.stringify({ projectId, view: "kanban" }));

      const overview = listProjectSessions(projectId)[0];
      const normalized = getDb().prepare(`
        SELECT config_json, updated_at
        FROM project_session_tabs
        WHERE id = ?
      `).get(rawBefore.id) as {
        readonly config_json: string;
        readonly updated_at: string;
      };
      const expected = JSON.stringify({
        projectId,
        databaseViewId: readPrimaryDatabaseViewId(projectId),
        view: "kanban",
      });
      expect(JSON.stringify(overview?.tabs[0]?.config)).toBe(expected);
      expect(normalized.config_json).toBe(expected);

      listProjectSessions(projectId);
      const afterSecondRead = getDb().prepare(`
        SELECT config_json, updated_at
        FROM project_session_tabs
        WHERE id = ?
      `).get(rawBefore.id) as {
        readonly config_json: string;
        readonly updated_at: string;
      };
      expect(afterSecondRead.config_json).toBe(normalized.config_json);
      expect(afterSecondRead.updated_at).toBe(normalized.updated_at);

      getDb().prepare(`
        UPDATE database_views
        SET lifecycle = 'deleted', updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), readPrimaryDatabaseViewId(projectId));
      const unresolvedSession = createProjectSession({
        projectId,
        noThreadFallbackTitle: "No primary mapping",
      });
      const unresolvedError = runValidation(() => {
        createProjectSessionTab({
          sessionId: unresolvedSession.id,
          projectId,
          panelId: "right",
          kind: "db_view",
          title: "Legacy DB View",
          config: { projectId, view: "kanban" },
        });
      });
      expect(unresolvedError?.includes("cannot resolve the active default View") ?? false).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("attaches and detaches session-owned thread metadata", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Agent run" });
      const attached = upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: projectId,
        threadId: "thread-1",
        forkedFromId: "fork-root-1",
        parentThreadId: "parent-1",
        threadName: "Thread One",
        threadPreview: "Working on the redesign",
        modelProvider: "openai",
        cwd: "/tmp/project",
        managedWorktreePath: "/tmp/project/.worktrees/thread-1",
        projectlessOutputDirectory: "output",
        projectlessWorkspaceBrowserRoot: "workspace",
        statusType: "active",
        statusActiveFlags: ["waitingOnApproval"],
        archived: false,
        createdAt: 10,
        updatedAt: 20,
      });

      expect(attached.threadId).toBe("thread-1");
      expect(attached.forkedFromId).toBe("fork-root-1");
      expect(attached.parentThreadId).toBe("parent-1");
      expect(attached.threadName).toBe("Thread One");
      expect(attached.managedWorktreePath).toBe("/tmp/project/.worktrees/thread-1");
      expect(attached.projectlessOutputDirectory ?? null).toBe("output");
      expect(attached.projectlessWorkspaceBrowserRoot ?? null).toBe("workspace");
      expect(JSON.stringify(attached.statusActiveFlags)).toBe(JSON.stringify(["waitingOnApproval"]));
      expect(getProjectSession(session.id)?.displayTitle).toBe("Thread One");

      const updated = upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: projectId,
        threadId: "thread-2",
        threadPreview: "Follow-up",
      });
      expect(updated.threadId).toBe("thread-2");
      expect(updated.forkedFromId).toBe(null);
      expect(updated.parentThreadId ?? null).toBe(null);
      expect(updated.threadPreview).toBe("Follow-up");
      expect(updated.projectlessOutputDirectory ?? null).toBe(null);
      expect(updated.projectlessWorkspaceBrowserRoot ?? null).toBe(null);
      expect(getProjectSession(session.id)?.displayTitle).toBe("Follow-up");
      const owners = listProjectSessionThreadOwners("thread-2");
      expect(owners.length).toBe(1);
      expect(owners[0]?.sessionId).toBe(session.id);
      expect(owners[0]?.projectId).toBe(projectId);

      expect(detachProjectSessionThread(session.id)).toBe(true);
      expect(getProjectSession(session.id)?.thread === null).toBe(true);
      expect(getProjectSession(session.id)?.displayTitle).toBe("Agent run");
      expect(detachProjectSessionThread(session.id)).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects a second session owner without partially rewriting thread metadata", async () => {
    const ran = await withTempDatabase(async () => {
      const owner = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Owner",
      });
      const contender = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Contender",
      });
      upsertProjectSessionThreadLink({
        sessionId: owner.id,
        projectId,
        threadId: "thread-single-session-owner",
        threadName: "Original title",
      });

      expect(() => upsertProjectSessionThreadLink({
        sessionId: contender.id,
        projectId,
        threadId: "thread-single-session-owner",
        threadName: "Conflicting title",
      })).toThrow(
        `Thread thread-single-session-owner is already attached to project session ${owner.id}`,
      );

      expect(listProjectSessionThreadOwners("thread-single-session-owner")).toEqual([
        { sessionId: owner.id, projectId },
      ]);
      expect(getProjectSession(owner.id)?.thread?.threadName).toBe("Original title");
      expect(getProjectSession(contender.id)?.thread).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("inherits durable unread state when a session materializes its thread link", async () => {
    const ran = await withTempDatabase(async () => {
      const threadId = "thread-unread-before-session-link";
      upsertCodexThread({
        projectId,
        threadId,
        threadName: "Unread before materialization",
        threadPreview: "Unread before materialization",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      });
      expect(setCodexThreadHasUnreadTurn(threadId, true)?.hasUnreadTurn).toBe(true);

      const session = createProjectSession({
        projectId,
        noThreadFallbackTitle: "Unread session",
      });
      expect(getProjectSession(session.id)?.unread).toBe(false);

      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId,
        threadId,
        threadName: "Unread before materialization",
        threadPreview: "Unread before materialization",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      });

      expect(getProjectSession(session.id)?.unread).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("archive clears durable unread state across a fresh repository connection", async () => {
    const ran = await withTempDatabase(async () => {
      const threadId = "thread-archive-clears-unread";
      upsertCodexThread({
        projectId,
        threadId,
        threadName: "Archive clears unread",
        threadPreview: "Archive clears unread",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      });
      expect(setCodexThreadHasUnreadTurn(threadId, true)?.hasUnreadTurn).toBe(true);
      expect(updateCodexThreadArchived(threadId, true)?.archived).toBe(true);
      expect(getCodexThread(threadId)?.hasUnreadTurn).toBe(false);
      expect(setCodexThreadHasUnreadTurn(threadId, true)?.hasUnreadTurn).toBe(false);
      const unreadRow = getDb().prepare(
        "SELECT thread_id FROM codex_unread_threads WHERE thread_id = ?",
      ).get(threadId);
      expect(unreadRow === undefined).toBe(true);

      closeDatabase();
      await initializeDatabase();
      const fresh = getCodexThread(threadId);
      expect(fresh?.archived).toBe(true);
      expect(fresh?.hasUnreadTurn).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps session tab configs project-scoped after project name update", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Alpha", sources: ["/tmp/alpha"] });
      const sessions = listProjectSessions(project.id);
      const overview = sessions[0];
      expect(JSON.stringify(overview?.tabs[0]?.config)).toBe(
        JSON.stringify({
          projectId: project.id,
          databaseViewId: readPrimaryDatabaseViewId(project.id),
          view: "kanban",
        }),
      );

      const updated = updateProject(project.id, { name: "Beta" });
      expect(updated?.id).toBe(project.id);
      expect(updated?.name).toBe("Beta");

      const updatedSessions = listProjectSessions(project.id);
      expect(updatedSessions[0]?.projectId).toBe(project.id);
      expect(updatedSessions[0]?.tabs[0]?.projectId).toBe(project.id);
      expect(JSON.stringify(updatedSessions[0]?.tabs[0]?.config)).toBe(
        JSON.stringify({
          projectId: project.id,
          databaseViewId: readPrimaryDatabaseViewId(project.id),
          view: "kanban",
        }),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("updates panel state and moves tabs between panels while preserving state", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Panels" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const terminal = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "bottom",
        kind: "terminal",
        title: "Terminal",
        config: { projectId: projectId, terminalSessionId: "term-1" },
      });

      const stateful = updateProjectSessionTab(terminal.id, { stateKey: 2, state: { cwd: "/tmp/default" } });
      expect(stateful?.stateKey).toBe(2);
      expect(JSON.stringify(stateful?.state)).toBe(JSON.stringify({ cwd: "/tmp/default" }));

      const sized = updateProjectSessionPanel(session.id, "bottom", {
        collapsed: false,
        size: { heightPx: 360 },
      });
      expect(sized?.panels.bottom.collapsed).toBe(false);
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

    if (!ran) expect(true).toBe(true);
  });

  test("persists split group membership and leaf-scoped tab movement", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Split panels" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-1" },
      });

      const initial = getProjectSession(session.id);
      const initialLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      const split = splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        side: "right",
        tabId: shell.id,
      });
      expect(split?.panels.right.layout.root.type).toBe("split");
      expect(split?.panels.right.layout.version).toBe(2);
      const splitLeaves = split ? listProjectSessionPanelLeaves(split.panels.right.layout) : [];
      expect(splitLeaves.length).toBe(2);
      expect(getProjectSessionPanelActiveLeaf(split!.panels.right.layout).activeTabId).toBe(shell.id);

      const activeLeafId = split ? getProjectSessionPanelActiveLeaf(split.panels.right.layout).id : "";
      const moved = moveProjectSessionTab({
        tabId: shell.id,
        targetPanelId: "right",
        targetLeafId: initialLeafId,
        targetIndex: 0,
      });
      expect(moved?.tabs.find((tab) => tab.id === shell.id)?.panelId).toBe("right");
      expect(getProjectSessionPanelActiveLeaf(moved!.panels.right.layout).id).toBe(initialLeafId);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(moved!.panels.right.layout))).toBe(
        JSON.stringify([shell.id, review.id]),
      );

      const reordered = reorderProjectSessionTabs({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        orderedTabIds: [review.id, shell.id],
      });
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(reordered!.panels.right.layout))).toBe(
        JSON.stringify([review.id, shell.id]),
      );
      expect(reordered?.panels.right.layout.version).toBe(2);
      expect(activeLeafId.length > 0).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("creates a new tab in the requested target leaf", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Target leaf" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-target-leaf" },
      });
      const initial = getProjectSession(session.id);
      const initialLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      const split = splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        side: "right",
        tabId: shell.id,
      });
      expect(getProjectSessionPanelActiveLeaf(split!.panels.right.layout).activeTabId).toBe(shell.id);

      const card = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        targetLeafId: initialLeafId,
        kind: "page_stage",
        title: "Card One",
        config: { projectId: projectId, pageId: "card-1", titleSnapshot: "Card One" },
      });
      const updated = getProjectSession(session.id);
      const targetLeaf = listProjectSessionPanelLeaves(updated!.panels.right.layout)
        .find((leaf) => leaf.id === initialLeafId);

      expect(card.kind).toBe("page_stage");
      expect(JSON.stringify(targetLeaf?.tabIds ?? [])).toBe(JSON.stringify([review.id, card.id]));
      expect(getProjectSessionPanelActiveLeaf(updated!.panels.right.layout).id).toBe(initialLeafId);
      expect(getProjectSessionPanelActiveLeaf(updated!.panels.right.layout).activeTabId).toBe(card.id);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("ensures a right-side empty leaf and preserves full-width panel state", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Ensure right leaf" });
      const dbTab = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: projectId, view: "kanban" },
      });
      const before = updateProjectSessionPanel(session.id, "right", {
        size: { widthPx: 777, fullWidth: true },
      });
      const sourceLeafId = before ? getProjectSessionPanelActiveLeaf(before.panels.right.layout).id : "main";

      const ensured = ensureProjectSessionPanelLeafToRight({
        sessionId: session.id,
        panelId: "right",
        sourceLeafId,
      });
      const updated = getProjectSession(session.id);
      const leaves = updated ? listProjectSessionPanelLeaves(updated.panels.right.layout) : [];
      const sourceLeaf = leaves.find((leaf) => leaf.id === sourceLeafId);
      const targetLeaf = leaves.find((leaf) => leaf.id === ensured?.leafId);

      expect(ensured?.created).toBe(true);
      expect(leaves.length).toBe(2);
      expect(JSON.stringify(sourceLeaf?.tabIds ?? [])).toBe(JSON.stringify([dbTab.id]));
      expect(JSON.stringify(targetLeaf?.tabIds ?? [])).toBe(JSON.stringify([]));
      expect(updated?.panels.right.size.fullWidth).toBe(true);
      expect(getProjectSessionPanelActiveLeaf(updated!.panels.right.layout).id).toBe(ensured?.leafId ?? "");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("reuses an existing nearest right leaf instead of creating another one", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Reuse right leaf" });
      const dbTab = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: projectId, view: "kanban" },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-existing-right" },
      });
      const initial = getProjectSession(session.id);
      const sourceLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: sourceLeafId,
        side: "right",
        tabId: shell.id,
      });
      const split = getProjectSession(session.id);
      const rightLeaf = split
        ? listProjectSessionPanelLeaves(split.panels.right.layout).find((leaf) => leaf.tabIds.includes(shell.id))
        : null;

      const ensured = ensureProjectSessionPanelLeafToRight({
        sessionId: session.id,
        panelId: "right",
        sourceLeafId,
      });
      const updated = getProjectSession(session.id);

      expect(ensured?.created).toBe(false);
      expect(ensured?.leafId).toBe(rightLeaf?.id ?? "");
      expect(listProjectSessionPanelLeaves(updated!.panels.right.layout).length).toBe(2);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(updated!.panels.right.layout))).toBe(
        JSON.stringify([dbTab.id, shell.id]),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("edge-dropping a tab to the right of its own multi-tab group creates a sibling group", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Edge split" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-edge" },
      });
      const initial = getProjectSession(session.id);
      const leafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";

      const moved = moveProjectSessionTab({
        tabId: shell.id,
        targetPanelId: "right",
        splitTarget: { leafId, side: "right" },
      });
      const leaves = moved ? listProjectSessionPanelLeaves(moved.panels.right.layout) : [];

      expect(leaves.length).toBe(2);
      expect(JSON.stringify(leaves[0]?.tabIds ?? [])).toBe(JSON.stringify([review.id]));
      expect(JSON.stringify(leaves[1]?.tabIds ?? [])).toBe(JSON.stringify([shell.id]));
      expect(getProjectSessionPanelActiveLeaf(moved!.panels.right.layout).activeTabId).toBe(shell.id);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deleting the last durable tab in a split group removes the empty group", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Prune delete" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-delete" },
      });
      const initial = getProjectSession(session.id);
      const initialLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      const split = splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        side: "right",
        tabId: shell.id,
      });
      expect(split ? listProjectSessionPanelLeaves(split.panels.right.layout).length : 0).toBe(2);

      const deleted = deleteProjectSessionTab(shell.id);
      const next = getProjectSession(session.id);

      expect(deleted).toBe(true);
      expect(next ? listProjectSessionPanelLeaves(next.panels.right.layout).length : 0).toBe(1);
      expect(JSON.stringify(next ? flattenProjectSessionPanelTabIds(next.panels.right.layout) : [])).toBe(
        JSON.stringify([review.id]),
      );
      expect(next?.panels.right.collapsed ?? true).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deleting an active tab persists the preferred replacement tab", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Delete replacement" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "browser",
        title: "Browser",
        config: { projectId: projectId, title: "Browser", url: "https://example.com" },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-delete-replacement" },
      });
      const before = getProjectSession(session.id);
      const leafId = before ? getProjectSessionPanelActiveLeaf(before.panels.right.layout).id : "main";
      expect(getProjectSessionPanelActiveLeaf(before!.panels.right.layout).activeTabId).toBe(shell.id);

      const deleted = deleteProjectSessionTab({
        tabId: shell.id,
        preferredActiveLeafId: leafId,
        preferredActiveTabId: browser.id,
      });
      const next = getProjectSession(session.id);

      expect(deleted).toBe(true);
      const activeLeaf = getProjectSessionPanelActiveLeaf(next!.panels.right.layout);
      expect(activeLeaf.activeTabId).toBe(browser.id);
      expect(activeLeaf.mruTabIds[0]).toBe(browser.id);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(next!.panels.right.layout))).toBe(
        JSON.stringify([review.id, browser.id]),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("activating panel tabs persists leaf tab MRU order", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Panel MRU" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const browser = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "browser",
        title: "Browser",
        config: { projectId: projectId, title: "Browser", url: "https://example.com" },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-panel-mru" },
      });
      const before = getProjectSession(session.id);
      const leafId = before ? getProjectSessionPanelActiveLeaf(before.panels.right.layout).id : "main";

      activateProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId,
        tabId: review.id,
      });
      const activated = activateProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId,
        tabId: browser.id,
      });
      const activeLeaf = getProjectSessionPanelActiveLeaf(activated!.panels.right.layout);

      expect(activeLeaf.activeTabId).toBe(browser.id);
      expect(JSON.stringify(activeLeaf.mruTabIds.slice(0, 3))).toBe(
        JSON.stringify([browser.id, review.id, shell.id]),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("moving the last durable tab out of a group removes the empty source group", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Prune move" });
      const review = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-move" },
      });
      const initial = getProjectSession(session.id);
      const initialLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        side: "right",
        tabId: shell.id,
      });

      const moved = moveProjectSessionTab({
        tabId: shell.id,
        targetPanelId: "bottom",
      });

      expect(moved?.tabs.find((tab) => tab.id === shell.id)?.panelId).toBe("bottom");
      expect(listProjectSessionPanelLeaves(moved!.panels.right.layout).length).toBe(1);
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(moved!.panels.right.layout))).toBe(
        JSON.stringify([review.id]),
      );
      expect(JSON.stringify(flattenProjectSessionPanelTabIds(moved!.panels.bottom.layout))).toBe(
        JSON.stringify([shell.id]),
      );
    });

    if (!ran) expect(true).toBe(true);
  });

  test("preserveEmptyLeafIds keeps an otherwise empty source group for renderer-local tabs", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: projectId, noThreadFallbackTitle: "Preserve local" });
      createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "review",
        title: "Review",
        config: { projectId: projectId },
      });
      const shell = createProjectSessionTab({
        sessionId: session.id,
        projectId: projectId,
        panelId: "right",
        kind: "terminal",
        title: "Shell",
        config: { projectId: projectId, terminalSessionId: "term-preserve" },
      });
      const initial = getProjectSession(session.id);
      const initialLeafId = initial ? getProjectSessionPanelActiveLeaf(initial.panels.right.layout).id : "main";
      const split = splitProjectSessionPanelGroup({
        sessionId: session.id,
        panelId: "right",
        leafId: initialLeafId,
        side: "right",
        tabId: shell.id,
      });
      const sourceLeafId = split ? getProjectSessionPanelActiveLeaf(split.panels.right.layout).id : "";

      const moved = moveProjectSessionTab({
        tabId: shell.id,
        targetPanelId: "bottom",
        preserveEmptyLeafIds: [sourceLeafId],
      });
      const sourceLeaf = moved
        ? listProjectSessionPanelLeaves(moved.panels.right.layout).find((leaf) => leaf.id === sourceLeafId)
        : null;

      expect(sourceLeaf === null).toBe(false);
      expect(JSON.stringify(sourceLeaf?.tabIds ?? [])).toBe(JSON.stringify([]));
      expect(listProjectSessionPanelLeaves(moved!.panels.right.layout).length).toBe(2);
    });

    if (!ran) expect(true).toBe(true);
  });
});
