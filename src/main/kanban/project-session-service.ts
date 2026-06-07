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
} from "../../shared/types";

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
  project_id: string;
  thread_id: string;
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
    projectId: row.project_id,
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
    .prepare("SELECT * FROM project_session_threads WHERE session_id = ?")
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
    .prepare("SELECT * FROM project_session_threads WHERE thread_id = ?")
    .get(threadId) as DbProjectSessionThread | undefined;
  return row ? rowToThread(row) : null;
}

export function updateProjectSessionThreadNameByThreadId(
  threadId: string,
  threadName: string | null,
): ProjectSessionThreadLink | null {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return null;
  getDb().prepare(`
    UPDATE project_session_threads
    SET thread_name = ?, updated_at = ?
    WHERE thread_id = ?
  `).run(threadName?.trim() || null, Date.now(), normalizedThreadId);
  return getProjectSessionThreadLink(normalizedThreadId);
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
    ) VALUES (?, ?, ?, 0, ?, 0, 0, ?, ?, ?)
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

export function createProjectSessionTab(input: ProjectSessionTabCreateInput): ProjectSessionTab {
  const parsed = ProjectSessionTabCreateInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== parsed.projectId) {
    throw new Error("Tab project must match the owning session project");
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
  getDb().prepare(`
    INSERT INTO project_session_threads (
      session_id, project_id, thread_id, parent_thread_id, thread_name, thread_preview,
      model_provider, cwd, status_type, status_active_flags_json, archived, created_at, updated_at, linked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      parent_thread_id = COALESCE(excluded.parent_thread_id, project_session_threads.parent_thread_id),
      thread_name = COALESCE(excluded.thread_name, project_session_threads.thread_name),
      thread_preview = excluded.thread_preview,
      model_provider = excluded.model_provider,
      cwd = COALESCE(excluded.cwd, project_session_threads.cwd),
      status_type = excluded.status_type,
      status_active_flags_json = excluded.status_active_flags_json,
      archived = excluded.archived,
      updated_at = excluded.updated_at,
      linked_at = excluded.linked_at
  `).run(
    parsed.sessionId,
    parsed.projectId,
    parsed.threadId,
    parsed.parentThreadId ?? null,
    parsed.threadName ?? null,
    parsed.threadPreview ?? "",
    parsed.modelProvider ?? "",
    parsed.cwd ?? null,
    parsed.statusType ?? "notLoaded",
    JSON.stringify(parsed.statusActiveFlags ?? []),
    parsed.archived ? 1 : 0,
    parsed.createdAt ?? nowMs,
    parsed.updatedAt ?? nowMs,
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
