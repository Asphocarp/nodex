import { randomUUID } from "node:crypto";
import { getDb } from "./db-service";
import {
  ProjectSessionCreateInputSchema,
  ProjectSessionRightPaneLayoutSchema,
  ProjectSessionTabCreateInputSchema,
  ProjectSessionThreadLinkInputSchema,
  ProjectSessionUpdateInputSchema,
  parseProjectSessionTabConfig,
  parseProjectSessionTabUpdateInput,
} from "../../shared/schemas/project-sessions";
import type {
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionRightPaneLayout,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionThreadLink,
  ProjectSessionThreadLinkInput,
  ProjectSessionUpdateInput,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
} from "../../shared/types";
import {
  getCodexThread,
  upsertCodexThread,
} from "../codex/codex-link-repository";
import { PROJECT_SESSION_SINGLETON_TAB_KINDS } from "../../shared/types";

const PROJECT_SESSION_SINGLETON_TAB_KIND_SET = new Set<string>(PROJECT_SESSION_SINGLETON_TAB_KINDS);

interface DbProjectSession {
  id: string;
  project_id: string;
  title: string;
  is_overview: number;
  order: number;
  left_pane_collapsed: number;
  right_pane_collapsed: number;
  right_pane_layout_json: string;
  created_at: string;
  updated_at: string;
}

interface DbProjectSessionTab {
  id: string;
  session_id: string;
  project_id: string;
  kind: string;
  title: string;
  config_json: string;
  order: number;
  created_at: string;
  updated_at: string;
}

interface DbProjectSessionThread {
  session_id: string;
  thread_id: string;
  session_project_id: string;
  project_id: string | null;
  card_id: string | null;
  parent_thread_id: string | null;
  thread_name: string | null;
  thread_preview: string;
  model_provider: string;
  cwd: string | null;
  status_type: string;
  status_active_flags_json: string;
  archived: number;
  created_at: number;
  updated_at: number;
  linked_at: string;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function makeDefaultRightPaneLayout(tabIds: string[], activeTabId: string | null): ProjectSessionRightPaneLayout {
  return {
    version: 1,
    root: {
      type: "leaf",
      id: "main",
      tabIds,
      activeTabId,
    },
  };
}

function makeOverviewSessionId(projectId: string): string {
  return `overview:${projectId}`;
}

function makeOverviewDbTabId(projectId: string): string {
  return `overview:${projectId}:db`;
}

function normalizeRightPaneLayout(value: string, tabs: ProjectSessionTab[]): ProjectSessionRightPaneLayout {
  const parsed = ProjectSessionRightPaneLayoutSchema.safeParse(parseJson(value));
  const tabIds = tabs.map((tab) => tab.id);
  if (!parsed.success) return makeDefaultRightPaneLayout(tabIds, tabIds[0] ?? null);

  if (parsed.data.root.type !== "leaf") return parsed.data;

  const knownTabIds = new Set(tabIds);
  const layoutTabIds = parsed.data.root.tabIds.filter((tabId) => knownTabIds.has(tabId));
  for (const tabId of tabIds) {
    if (!layoutTabIds.includes(tabId)) layoutTabIds.push(tabId);
  }

  const activeTabId = parsed.data.root.activeTabId && knownTabIds.has(parsed.data.root.activeTabId)
    ? parsed.data.root.activeTabId
    : layoutTabIds[0] ?? null;

  return {
    ...parsed.data,
    root: {
      ...parsed.data.root,
      tabIds: layoutTabIds,
      activeTabId,
    },
  };
}

function stringifyLayout(layout: ProjectSessionRightPaneLayout): string {
  return JSON.stringify(ProjectSessionRightPaneLayoutSchema.parse(layout));
}

function rowToTab(row: DbProjectSessionTab): ProjectSessionTab {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    kind: row.kind as ProjectSessionTab["kind"],
    title: row.title,
    order: row.order,
    config: parseProjectSessionTabConfig(row.kind, parseJson(row.config_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStatusActiveFlags(value: string): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function rowToThread(row: DbProjectSessionThread): ProjectSessionThreadLink {
  return {
    sessionId: row.session_id,
    projectId: row.project_id ?? row.session_project_id,
    threadId: row.thread_id,
    parentThreadId: row.parent_thread_id || undefined,
    threadName: row.thread_name || undefined,
    threadPreview: row.thread_preview,
    modelProvider: row.model_provider,
    cwd: row.cwd || undefined,
    statusType: row.status_type,
    statusActiveFlags: parseStatusActiveFlags(row.status_active_flags_json),
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkedAt: row.linked_at,
  };
}

function buildSession(row: DbProjectSession): ProjectSession {
  const database = getDb();
  const tabRows = database
    .prepare('SELECT * FROM project_session_tabs WHERE session_id = ? ORDER BY "order" ASC, created_at ASC')
    .all(row.id) as DbProjectSessionTab[];
  const tabs = tabRows.map(rowToTab);
  const threadRow = database
    .prepare(`
      SELECT
        pst.session_id,
        pst.linked_at,
        ps.project_id AS session_project_id,
        t.thread_id,
        t.project_id,
        t.card_id,
        t.parent_thread_id,
        t.thread_name,
        t.thread_preview,
        t.model_provider,
        t.cwd,
        t.status_type,
        t.status_active_flags_json,
        t.archived,
        t.created_at,
        t.updated_at
      FROM project_session_threads pst
      JOIN project_sessions ps ON ps.id = pst.session_id
      JOIN codex_threads t ON t.thread_id = pst.thread_id
      WHERE pst.session_id = ?
    `)
    .get(row.id) as DbProjectSessionThread | undefined;

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isOverview: row.is_overview === 1,
    order: row.order,
    leftPaneCollapsed: row.left_pane_collapsed === 1,
    rightPaneCollapsed: row.right_pane_collapsed === 1,
    rightPaneLayout: normalizeRightPaneLayout(row.right_pane_layout_json, tabs),
    thread: threadRow ? rowToThread(threadRow) : null,
    tabs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureProjectExists(projectId: string): void {
  const project = getDb().prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
}

function ensureOverviewSession(projectId: string): void {
  const database = getDb();
  const overview = database
    .prepare("SELECT 1 FROM project_sessions WHERE project_id = ? AND is_overview = 1")
    .get(projectId);
  if (overview) return;

  const now = new Date().toISOString();
  const sessionId = makeOverviewSessionId(projectId);
  const tabId = makeOverviewDbTabId(projectId);
  const insert = database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO project_sessions (
        id, project_id, title, is_overview, "order", left_pane_collapsed,
        right_pane_collapsed, right_pane_layout_json, created_at, updated_at
      ) VALUES (?, ?, 'Overview', 1, 0, 1, 0, ?, ?, ?)
    `).run(
      sessionId,
      projectId,
      stringifyLayout(makeDefaultRightPaneLayout([tabId], tabId)),
      now,
      now,
    );
    database.prepare(`
      INSERT OR IGNORE INTO project_session_tabs (
        id, session_id, project_id, kind, title, config_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, 'db_view', 'DB View', ?, 0, ?, ?)
    `).run(
      tabId,
      sessionId,
      projectId,
      JSON.stringify({ projectId, view: "kanban" }),
      now,
      now,
    );
  });
  insert();
}

export function listProjectSessions(projectId: string): ProjectSession[] {
  ensureProjectExists(projectId);
  ensureOverviewSession(projectId);
  const rows = getDb()
    .prepare('SELECT * FROM project_sessions WHERE project_id = ? ORDER BY "order" ASC, created_at ASC')
    .all(projectId) as DbProjectSession[];
  return rows.map(buildSession);
}

export function getProjectSession(sessionId: string): ProjectSession | null {
  const row = getDb()
    .prepare("SELECT * FROM project_sessions WHERE id = ?")
    .get(sessionId) as DbProjectSession | undefined;
  return row ? buildSession(row) : null;
}

export function getProjectSessionThreadLink(threadId: string): ProjectSessionThreadLink | null {
  const row = getDb()
    .prepare(`
      SELECT
        pst.session_id,
        pst.linked_at,
        ps.project_id AS session_project_id,
        t.thread_id,
        t.project_id,
        t.card_id,
        t.parent_thread_id,
        t.thread_name,
        t.thread_preview,
        t.model_provider,
        t.cwd,
        t.status_type,
        t.status_active_flags_json,
        t.archived,
        t.created_at,
        t.updated_at
      FROM project_session_threads pst
      JOIN project_sessions ps ON ps.id = pst.session_id
      JOIN codex_threads t ON t.thread_id = pst.thread_id
      WHERE pst.thread_id = ?
    `)
    .get(threadId) as DbProjectSessionThread | undefined;
  return row ? rowToThread(row) : null;
}

export function createProjectSession(input: ProjectSessionCreateInput): ProjectSession {
  const parsed = ProjectSessionCreateInputSchema.parse(input);
  ensureProjectExists(parsed.projectId);

  const database = getDb();
  const now = new Date().toISOString();
  const maxOrder = database
    .prepare('SELECT MAX("order") AS maxOrder FROM project_sessions WHERE project_id = ?')
    .get(parsed.projectId) as { maxOrder: number | null } | undefined;
  const id = randomUUID();

  database.prepare(`
    INSERT INTO project_sessions (
      id, project_id, title, is_overview, "order", left_pane_collapsed,
      right_pane_collapsed, right_pane_layout_json, created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, 0, 1, ?, ?, ?)
  `).run(
    id,
    parsed.projectId,
    parsed.title,
    (maxOrder?.maxOrder ?? -1) + 1,
    stringifyLayout(makeDefaultRightPaneLayout([], null)),
    now,
    now,
  );

  const session = getProjectSession(id);
  if (!session) throw new Error("Unable to create project session");
  return session;
}

export function updateProjectSession(sessionId: string, input: ProjectSessionUpdateInput): ProjectSession | null {
  const parsed = ProjectSessionUpdateInputSchema.parse(input);
  const existing = getProjectSession(sessionId);
  if (!existing) return null;

  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (parsed.title !== undefined) {
    fields.push("title = ?");
    values.push(parsed.title);
  }
  if (parsed.leftPaneCollapsed !== undefined) {
    fields.push("left_pane_collapsed = ?");
    values.push(parsed.leftPaneCollapsed ? 1 : 0);
  }
  if (parsed.rightPaneCollapsed !== undefined) {
    fields.push("right_pane_collapsed = ?");
    values.push(parsed.rightPaneCollapsed ? 1 : 0);
  }
  if (parsed.rightPaneLayout !== undefined) {
    fields.push("right_pane_layout_json = ?");
    values.push(stringifyLayout(parsed.rightPaneLayout));
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(new Date().toISOString(), sessionId);
  getDb().prepare(`UPDATE project_sessions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProjectSession(sessionId);
}

export function deleteProjectSession(sessionId: string): boolean {
  const existing = getProjectSession(sessionId);
  if (!existing) return false;
  if (existing.isOverview) throw new Error("Overview session cannot be deleted");

  const result = getDb().prepare("DELETE FROM project_sessions WHERE id = ?").run(sessionId);
  return result.changes > 0;
}

export function reorderProjectSessions(projectId: string, orderedSessionIds: string[]): ProjectSession[] {
  ensureProjectExists(projectId);
  const existing = listProjectSessions(projectId);
  const existingIds = new Set(existing.map((session) => session.id));
  const selected = orderedSessionIds.filter((sessionId) => existingIds.has(sessionId));
  const remaining = existing.map((session) => session.id).filter((sessionId) => !selected.includes(sessionId));
  const finalOrder = [...selected, ...remaining];
  const now = new Date().toISOString();

  const database = getDb();
  const update = database.prepare('UPDATE project_sessions SET "order" = ?, updated_at = ? WHERE id = ? AND project_id = ?');
  const tx = database.transaction(() => {
    finalOrder.forEach((sessionId, index) => update.run(index, now, sessionId, projectId));
  });
  tx();
  return listProjectSessions(projectId);
}

function updateSessionLayoutForTabs(sessionId: string, tabs: ProjectSessionTab[], activeTabId: string | null): void {
  const layout = makeDefaultRightPaneLayout(tabs.map((tab) => tab.id), activeTabId);
  getDb()
    .prepare("UPDATE project_sessions SET right_pane_layout_json = ?, updated_at = ? WHERE id = ?")
    .run(stringifyLayout(layout), new Date().toISOString(), sessionId);
}

function findSingletonTab(session: ProjectSession, kind: ProjectSessionTabCreateInput["kind"]): ProjectSessionTab | null {
  if (!PROJECT_SESSION_SINGLETON_TAB_KIND_SET.has(kind)) return null;
  return session.tabs.find((tab) => tab.kind === kind) ?? null;
}

export function createProjectSessionTab(input: ProjectSessionTabCreateInput): ProjectSessionTab {
  const parsed = ProjectSessionTabCreateInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== parsed.projectId) {
    throw new Error("Tab project must match the owning session project");
  }

  const existingSingleton = findSingletonTab(session, parsed.kind);
  if (existingSingleton) {
    updateSessionLayoutForTabs(parsed.sessionId, session.tabs, existingSingleton.id);
    return getProjectSession(parsed.sessionId)?.tabs.find((tab) => tab.id === existingSingleton.id) ?? existingSingleton;
  }

  const database = getDb();
  const now = new Date().toISOString();
  const maxOrder = database
    .prepare('SELECT MAX("order") AS maxOrder FROM project_session_tabs WHERE session_id = ?')
    .get(parsed.sessionId) as { maxOrder: number | null } | undefined;
  const id = randomUUID();

  database.transaction(() => {
    database.prepare(`
      INSERT INTO project_session_tabs (
        id, session_id, project_id, kind, title, config_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.sessionId,
      parsed.projectId,
      parsed.kind,
      parsed.title,
      JSON.stringify(parsed.config),
      (maxOrder?.maxOrder ?? -1) + 1,
      now,
      now,
    );
    const tabs = (database
      .prepare('SELECT * FROM project_session_tabs WHERE session_id = ? ORDER BY "order" ASC, created_at ASC')
      .all(parsed.sessionId) as DbProjectSessionTab[]).map(rowToTab);
    updateSessionLayoutForTabs(parsed.sessionId, tabs, id);
  })();

  const created = getProjectSession(parsed.sessionId)?.tabs.find((tab) => tab.id === id);
  if (!created) throw new Error("Unable to create project session tab");
  return created;
}

export function updateProjectSessionTab(tabId: string, input: ProjectSessionTabUpdateInput): ProjectSessionTab | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM project_session_tabs WHERE id = ?")
    .get(tabId) as DbProjectSessionTab | undefined;
  if (!row) return null;

  const parsed = parseProjectSessionTabUpdateInput(row.kind, input);
  const fields: string[] = [];
  const values: string[] = [];
  if (parsed.title !== undefined) {
    fields.push("title = ?");
    values.push(parsed.title);
  }
  if (parsed.config !== undefined) {
    fields.push("config_json = ?");
    values.push(JSON.stringify(parsed.config));
  }
  if (fields.length === 0) return rowToTab(row);

  fields.push("updated_at = ?");
  values.push(new Date().toISOString(), tabId);
  database.prepare(`UPDATE project_session_tabs SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  const nextRow = database
    .prepare("SELECT * FROM project_session_tabs WHERE id = ?")
    .get(tabId) as DbProjectSessionTab | undefined;
  return nextRow ? rowToTab(nextRow) : null;
}

export function deleteProjectSessionTab(tabId: string): boolean {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM project_session_tabs WHERE id = ?")
    .get(tabId) as DbProjectSessionTab | undefined;
  if (!row) return false;

  const deleted = database.transaction(() => {
    const result = database.prepare("DELETE FROM project_session_tabs WHERE id = ?").run(tabId);
    const tabs = (database
      .prepare('SELECT * FROM project_session_tabs WHERE session_id = ? ORDER BY "order" ASC, created_at ASC')
      .all(row.session_id) as DbProjectSessionTab[]).map(rowToTab);
    updateSessionLayoutForTabs(row.session_id, tabs, tabs[0]?.id ?? null);
    return result.changes > 0;
  })();
  return deleted;
}

export function reorderProjectSessionTabs(sessionId: string, orderedTabIds: string[]): ProjectSession | null {
  const session = getProjectSession(sessionId);
  if (!session) return null;

  const existingIds = new Set(session.tabs.map((tab) => tab.id));
  const selected = orderedTabIds.filter((tabId) => existingIds.has(tabId));
  const remaining = session.tabs.map((tab) => tab.id).filter((tabId) => !selected.includes(tabId));
  const finalOrder = [...selected, ...remaining];
  const now = new Date().toISOString();
  const database = getDb();
  const update = database.prepare('UPDATE project_session_tabs SET "order" = ?, updated_at = ? WHERE id = ? AND session_id = ?');

  database.transaction(() => {
    finalOrder.forEach((tabId, index) => update.run(index, now, tabId, sessionId));
    const tabs = (database
      .prepare('SELECT * FROM project_session_tabs WHERE session_id = ? ORDER BY "order" ASC, created_at ASC')
      .all(sessionId) as DbProjectSessionTab[]).map(rowToTab);
    updateSessionLayoutForTabs(sessionId, tabs, session.rightPaneLayout.root.type === "leaf" ? session.rightPaneLayout.root.activeTabId : tabs[0]?.id ?? null);
  })();

  return getProjectSession(sessionId);
}

export function upsertProjectSessionThreadLink(input: ProjectSessionThreadLinkInput): ProjectSessionThreadLink {
  const parsed = ProjectSessionThreadLinkInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== parsed.projectId) {
    throw new Error("Thread project must match the owning session project");
  }

  const nowMs = Date.now();
  const linkedAt = new Date().toISOString();
  const existing = getCodexThread(parsed.threadId);
  upsertCodexThread({
    projectId: parsed.projectId,
    cardId: existing?.cardId ?? null,
    threadId: parsed.threadId,
    source: parsed.parentThreadId
      ? { parentThreadId: parsed.parentThreadId }
      : existing?.source ?? null,
    threadName: parsed.threadName ?? existing?.threadName ?? null,
    threadPreview: parsed.threadPreview ?? existing?.threadPreview ?? "",
    modelProvider: parsed.modelProvider ?? existing?.modelProvider ?? "",
    cwd: parsed.cwd ?? existing?.cwd ?? null,
    statusType: parsed.statusType as CodexThreadStatusType | undefined,
    statusActiveFlags: parsed.statusActiveFlags as CodexThreadActiveFlag[] | undefined,
    archived: parsed.archived ?? existing?.archived ?? false,
    createdAt: parsed.createdAt ?? existing?.createdAt ?? nowMs,
    updatedAt: parsed.updatedAt ?? nowMs,
    linkedAt: existing?.linkedAt ?? linkedAt,
  });

  getDb().prepare(`
    INSERT INTO project_session_threads (
      session_id, thread_id, linked_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      linked_at = excluded.linked_at
  `).run(
    parsed.sessionId,
    parsed.threadId,
    linkedAt,
  );

  const link = getProjectSession(parsed.sessionId)?.thread;
  if (!link) throw new Error("Unable to attach project session thread");
  return link;
}

export function detachProjectSessionThread(sessionId: string): boolean {
  const result = getDb().prepare("DELETE FROM project_session_threads WHERE session_id = ?").run(sessionId);
  return result.changes > 0;
}
