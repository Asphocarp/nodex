import { randomUUID } from "node:crypto";
import { getDb } from "./db-service";
import {
  ProjectSessionCreateInputSchema,
  ProjectSessionPanelLayoutSchema,
  ProjectSessionPanelsSchema,
  ProjectSessionTabMoveInputSchema,
  ProjectSessionTabCreateInputSchema,
  ProjectSessionTabReorderInputSchema,
  ProjectSessionPinnedInputSchema,
  ProjectSessionPinnedOrderInputSchema,
  ProjectSessionUnreadInputSchema,
  ProjectSessionListOptionsSchema,
  ProjectSessionThreadLinkInputSchema,
  ProjectSessionUpdateInputSchema,
  parseProjectSessionTabConfig,
  parseProjectSessionTabUpdateInput,
} from "../../shared/schemas/project-sessions";
import type {
  PanelId,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionListOptions,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionTabMoveInput,
  ProjectSessionTabReorderInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionThreadLink,
  ProjectSessionThreadLinkInput,
  ProjectSessionUnreadInput,
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
const DEFAULT_RIGHT_PANEL_WIDTH = 600;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;

interface DbProjectSession {
  id: string;
  project_id: string;
  title: string;
  is_overview: number;
  order: number;
  pinned: number;
  pinned_order: number | null;
  archived: number;
  archived_at: string | null;
  unread: number;
  left_pane_collapsed: number;
  panel_state_json: string;
  created_at: string;
  updated_at: string;
}

interface DbProjectSessionTab {
  id: string;
  session_id: string;
  project_id: string;
  panel_id: string;
  kind: string;
  title: string;
  config_json: string;
  state_key: number;
  state_json: string;
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

function makeDefaultPanelLayout(tabIds: string[], activeTabId: string | null): ProjectSessionPanelLayout {
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

function makeDefaultPanelState(panelId: PanelId, tabIds: string[], activeTabId: string | null): ProjectSessionPanelState {
  return {
    collapsed: panelId === "right" ? true : tabIds.length === 0,
    layout: makeDefaultPanelLayout(tabIds, activeTabId),
    size: panelId === "right"
      ? { widthPx: DEFAULT_RIGHT_PANEL_WIDTH, fullWidth: false }
      : { heightPx: DEFAULT_BOTTOM_PANEL_HEIGHT },
  };
}

function makeOverviewSessionId(projectId: string): string {
  return `overview:${projectId}`;
}

function makeOverviewDbTabId(projectId: string): string {
  return `overview:${projectId}:db`;
}

function normalizePanelLayout(value: unknown, tabs: ProjectSessionTab[]): ProjectSessionPanelLayout {
  const parsed = ProjectSessionPanelLayoutSchema.safeParse(value);
  const tabIds = tabs.map((tab) => tab.id);
  if (!parsed.success) return makeDefaultPanelLayout(tabIds, tabIds[0] ?? null);

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

function normalizePanelState(
  panelId: PanelId,
  rawState: ProjectSessionPanelState | undefined,
  tabs: ProjectSessionTab[],
  fallback?: { collapsed?: boolean; layout?: ProjectSessionPanelLayout },
): ProjectSessionPanelState {
  const tabIds = tabs.map((tab) => tab.id);
  const defaultState = makeDefaultPanelState(panelId, tabIds, tabIds[0] ?? null);
  const size = {
    ...defaultState.size,
    ...(rawState?.size ?? {}),
  };

  return {
    collapsed: rawState?.collapsed ?? fallback?.collapsed ?? defaultState.collapsed,
    layout: normalizePanelLayout(rawState?.layout ?? fallback?.layout ?? defaultState.layout, tabs),
    size,
  };
}

function parsePanelStates(row: DbProjectSession, tabs: ProjectSessionTab[]): Record<PanelId, ProjectSessionPanelState> {
  const parsed = ProjectSessionPanelsSchema.safeParse(parseJson(row.panel_state_json));
  const rightTabs = tabs.filter((tab) => tab.panelId === "right");
  const bottomTabs = tabs.filter((tab) => tab.panelId === "bottom");

  return {
    right: normalizePanelState("right", parsed.success ? parsed.data.right : undefined, rightTabs),
    bottom: normalizePanelState("bottom", parsed.success ? parsed.data.bottom : undefined, bottomTabs),
  };
}

function stringifyPanels(panels: Record<PanelId, ProjectSessionPanelState>): string {
  return JSON.stringify(ProjectSessionPanelsSchema.parse(panels));
}

function rowToTab(row: DbProjectSessionTab): ProjectSessionTab {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    panelId: row.panel_id === "bottom" ? "bottom" : "right",
    kind: row.kind as ProjectSessionTab["kind"],
    title: row.title,
    order: row.order,
    config: parseProjectSessionTabConfig(row.kind, parseJson(row.config_json)),
    stateKey: row.state_key,
    state: parseJson(row.state_json),
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
    .prepare(`
      SELECT *
      FROM project_session_tabs
      WHERE session_id = ?
      ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END ASC, "order" ASC, created_at ASC
    `)
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
    pinned: row.pinned === 1,
    pinnedOrder: row.pinned_order,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    unread: row.unread === 1,
    leftPaneCollapsed: row.left_pane_collapsed === 1,
    panels: parsePanelStates(row, tabs),
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
    const rightLayout = makeDefaultPanelLayout([tabId], tabId);
    const panels = {
      right: {
        collapsed: false,
        layout: rightLayout,
        size: { widthPx: DEFAULT_RIGHT_PANEL_WIDTH, fullWidth: true },
      },
      bottom: makeDefaultPanelState("bottom", [], null),
    } satisfies Record<PanelId, ProjectSessionPanelState>;
    database.prepare(`
      INSERT OR IGNORE INTO project_sessions (
        id, project_id, title, is_overview, "order", pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      ) VALUES (?, ?, 'Overview', 1, 0, 0, NULL, 0, NULL, 0, 1, ?, ?, ?)
    `).run(
      sessionId,
      projectId,
      stringifyPanels(panels),
      now,
      now,
    );
    database.prepare(`
      INSERT OR IGNORE INTO project_session_tabs (
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, 'right', 'db_view', 'DB View', ?, 0, '{}', 0, ?, ?)
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

export function listProjectSessions(
  projectId: string,
  options?: ProjectSessionListOptions,
): ProjectSession[] {
  const parsedOptions = ProjectSessionListOptionsSchema.parse(options) ?? {};
  ensureProjectExists(projectId);
  ensureOverviewSession(projectId);
  const rows = getDb()
    .prepare(`
      SELECT *
      FROM project_sessions
      WHERE project_id = ?
        AND (? = 1 OR archived = 0)
      ORDER BY
        CASE
          WHEN is_overview = 1 THEN 0
          WHEN pinned = 1 THEN 1
          ELSE 2
        END ASC,
        CASE
          WHEN pinned = 1 THEN COALESCE(pinned_order, 9223372036854775807)
          ELSE "order"
        END ASC,
        created_at ASC
    `)
    .all(projectId, parsedOptions.includeArchived === true ? 1 : 0) as DbProjectSession[];
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
  const panels = {
    right: makeDefaultPanelState("right", [], null),
    bottom: makeDefaultPanelState("bottom", [], null),
  } satisfies Record<PanelId, ProjectSessionPanelState>;

  database.prepare(`
    INSERT INTO project_sessions (
      id, project_id, title, is_overview, "order", pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
      panel_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, 0, NULL, 0, NULL, 0, 0, ?, ?, ?)
  `).run(
    id,
    parsed.projectId,
    parsed.title,
    (maxOrder?.maxOrder ?? -1) + 1,
    stringifyPanels(panels),
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
  if (parsed.panels !== undefined) {
    const nextPanels: Record<PanelId, ProjectSessionPanelState> = {
      right: {
        ...existing.panels.right,
        ...parsed.panels.right,
        size: {
          ...existing.panels.right.size,
          ...(parsed.panels.right?.size ?? {}),
        },
      },
      bottom: {
        ...existing.panels.bottom,
        ...parsed.panels.bottom,
        size: {
          ...existing.panels.bottom.size,
          ...(parsed.panels.bottom?.size ?? {}),
        },
      },
    };
    fields.push("panel_state_json = ?");
    values.push(stringifyPanels(nextPanels));
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
  const movableSessions = existing.filter((session) => !session.isOverview);
  const existingIds = new Set(movableSessions.map((session) => session.id));
  const selected = orderedSessionIds.filter((sessionId) => existingIds.has(sessionId));
  const remaining = movableSessions.map((session) => session.id).filter((sessionId) => !selected.includes(sessionId));
  const finalOrder = [...selected, ...remaining];
  const byId = new Map(movableSessions.map((session) => [session.id, session]));
  const pinnedOrder = finalOrder.filter((sessionId) => byId.get(sessionId)?.pinned === true);
  const now = new Date().toISOString();

  const database = getDb();
  const updateOrder = database.prepare('UPDATE project_sessions SET "order" = ?, updated_at = ? WHERE id = ? AND project_id = ? AND is_overview = 0');
  const updatePinnedOrder = database.prepare("UPDATE project_sessions SET pinned_order = ?, updated_at = ? WHERE id = ? AND project_id = ? AND pinned = 1 AND is_overview = 0");
  const tx = database.transaction(() => {
    finalOrder.forEach((sessionId, index) => updateOrder.run(index + 1, now, sessionId, projectId));
    pinnedOrder.forEach((sessionId, index) => updatePinnedOrder.run(index, now, sessionId, projectId));
  });
  tx();
  return listProjectSessions(projectId);
}

export function setProjectSessionPinned(
  sessionId: string,
  input: ProjectSessionPinnedInput,
): ProjectSession | null {
  const parsed = ProjectSessionPinnedInputSchema.parse(input);
  const existing = getProjectSession(sessionId);
  if (!existing) return null;
  if (existing.isOverview) throw new Error("Overview session cannot be pinned");

  const database = getDb();
  const now = new Date().toISOString();
  if (parsed.pinned) {
    const maxPinnedOrder = database
      .prepare(`
        SELECT MAX(pinned_order) AS maxPinnedOrder
        FROM project_sessions
        WHERE project_id = ? AND pinned = 1 AND archived = 0
      `)
      .get(existing.projectId) as { maxPinnedOrder: number | null } | undefined;
    const nextPinnedOrder = existing.pinned && existing.pinnedOrder !== null
      ? existing.pinnedOrder
      : (maxPinnedOrder?.maxPinnedOrder ?? -1) + 1;

    database.prepare(`
      UPDATE project_sessions
      SET pinned = 1, pinned_order = ?, updated_at = ?
      WHERE id = ? AND is_overview = 0
    `).run(nextPinnedOrder, now, sessionId);
    return getProjectSession(sessionId);
  }

  database.prepare(`
    UPDATE project_sessions
    SET pinned = 0, pinned_order = NULL, updated_at = ?
    WHERE id = ? AND is_overview = 0
  `).run(now, sessionId);
  return getProjectSession(sessionId);
}

export function setPinnedProjectSessionOrder(
  projectId: string,
  input: ProjectSessionPinnedOrderInput,
): ProjectSession[] {
  const parsed = ProjectSessionPinnedOrderInputSchema.parse(input);
  ensureProjectExists(projectId);
  const existing = listProjectSessions(projectId, { includeArchived: true })
    .filter((session) => session.pinned && !session.archived && !session.isOverview);
  const existingIds = new Set(existing.map((session) => session.id));
  const selected = parsed.orderedSessionIds.filter((sessionId) => existingIds.has(sessionId));
  const remaining = existing.map((session) => session.id).filter((sessionId) => !selected.includes(sessionId));
  const finalOrder = [...selected, ...remaining];
  const now = new Date().toISOString();

  const update = getDb().prepare(`
    UPDATE project_sessions
    SET pinned_order = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND pinned = 1 AND is_overview = 0
  `);
  getDb().transaction(() => {
    finalOrder.forEach((sessionId, index) => update.run(index, now, sessionId, projectId));
  })();

  return listProjectSessions(projectId);
}

export function archiveProjectSession(sessionId: string): ProjectSession | null {
  const existing = getProjectSession(sessionId);
  if (!existing) return null;
  if (existing.isOverview) throw new Error("Overview session cannot be archived");

  getDb().prepare(`
    UPDATE project_sessions
    SET archived = 1,
        archived_at = ?,
        pinned = 0,
        pinned_order = NULL,
        unread = 0,
        updated_at = ?
    WHERE id = ? AND is_overview = 0
  `).run(new Date().toISOString(), new Date().toISOString(), sessionId);
  return getProjectSession(sessionId);
}

export function unarchiveProjectSession(sessionId: string): ProjectSession | null {
  const existing = getProjectSession(sessionId);
  if (!existing) return null;
  if (existing.isOverview) throw new Error("Overview session cannot be unarchived");

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE project_sessions
    SET archived = 0,
        archived_at = NULL,
        updated_at = ?
    WHERE id = ? AND is_overview = 0
  `).run(now, sessionId);
  return getProjectSession(sessionId);
}

export function markProjectSessionUnread(
  sessionId: string,
  input: ProjectSessionUnreadInput,
): ProjectSession | null {
  const parsed = ProjectSessionUnreadInputSchema.parse(input);
  const existing = getProjectSession(sessionId);
  if (!existing) return null;
  if (existing.isOverview && parsed.unread) {
    throw new Error("Overview session cannot be marked unread");
  }

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE project_sessions
    SET unread = ?, updated_at = ?
    WHERE id = ?
  `).run(parsed.unread ? 1 : 0, now, sessionId);
  return getProjectSession(sessionId);
}

function updatePanelStateForTabs(
  session: ProjectSession,
  panelId: PanelId,
  tabs: ProjectSessionTab[],
  activeTabId: string | null,
  options: { collapsed?: boolean } = {},
): Record<PanelId, ProjectSessionPanelState> {
  const panelTabs = tabs.filter((tab) => tab.panelId === panelId);
  const panelTabIds = panelTabs.map((tab) => tab.id);
  const activeId = activeTabId && panelTabIds.includes(activeTabId)
    ? activeTabId
    : panelTabIds[0] ?? null;

  return {
    ...session.panels,
    [panelId]: {
      ...session.panels[panelId],
      collapsed: options.collapsed ?? (panelTabIds.length === 0 ? true : session.panels[panelId].collapsed),
      layout: makeDefaultPanelLayout(panelTabIds, activeId),
    },
  };
}

function persistPanelStates(sessionId: string, panels: Record<PanelId, ProjectSessionPanelState>): void {
  getDb()
    .prepare(`
      UPDATE project_sessions
      SET panel_state_json = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      stringifyPanels(panels),
      new Date().toISOString(),
      sessionId,
    );
}

function getTabsForSession(sessionId: string): ProjectSessionTab[] {
  return (getDb()
    .prepare(`
      SELECT *
      FROM project_session_tabs
      WHERE session_id = ?
      ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END ASC, "order" ASC, created_at ASC
    `)
    .all(sessionId) as DbProjectSessionTab[]).map(rowToTab);
}

function getPanelTabOrder(session: ProjectSession, panelId: PanelId): string[] {
  const root = session.panels[panelId].layout.root;
  if (root.type !== "leaf") return session.tabs.filter((tab) => tab.panelId === panelId).map((tab) => tab.id);
  return root.tabIds;
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
    const panels = updatePanelStateForTabs(session, existingSingleton.panelId, session.tabs, existingSingleton.id, {
      collapsed: false,
    });
    persistPanelStates(parsed.sessionId, panels);
    return getProjectSession(parsed.sessionId)?.tabs.find((tab) => tab.id === existingSingleton.id) ?? existingSingleton;
  }

  const database = getDb();
  const now = new Date().toISOString();
  const maxOrder = database
    .prepare('SELECT MAX("order") AS maxOrder FROM project_session_tabs WHERE session_id = ? AND panel_id = ?')
    .get(parsed.sessionId, parsed.panelId) as { maxOrder: number | null } | undefined;
  const id = randomUUID();

  database.transaction(() => {
    database.prepare(`
      INSERT INTO project_session_tabs (
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}', ?, ?, ?)
    `).run(
      id,
      parsed.sessionId,
      parsed.projectId,
      parsed.panelId,
      parsed.kind,
      parsed.title,
      JSON.stringify(parsed.config),
      (maxOrder?.maxOrder ?? -1) + 1,
      now,
      now,
    );
    const tabs = getTabsForSession(parsed.sessionId);
    const panels = updatePanelStateForTabs(session, parsed.panelId, tabs, id, { collapsed: false });
    persistPanelStates(parsed.sessionId, panels);
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
  const values: Array<string | number> = [];
  if (parsed.title !== undefined) {
    fields.push("title = ?");
    values.push(parsed.title);
  }
  if (parsed.config !== undefined) {
    fields.push("config_json = ?");
    values.push(JSON.stringify(parsed.config));
  }
  if (parsed.stateKey !== undefined) {
    fields.push("state_key = ?");
    values.push(parsed.stateKey);
  }
  if ("state" in parsed) {
    fields.push("state_json = ?");
    values.push(JSON.stringify(parsed.state ?? null));
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
  const session = getProjectSession(row.session_id);
  if (!session) return false;
  const panelId = row.panel_id === "bottom" ? "bottom" : "right";

  const deleted = database.transaction(() => {
    const result = database.prepare("DELETE FROM project_session_tabs WHERE id = ?").run(tabId);
    const tabs = getTabsForSession(row.session_id);
    const existingActiveId = session.panels[panelId].layout.root.type === "leaf"
      ? session.panels[panelId].layout.root.activeTabId
      : null;
    const activeTabId = existingActiveId && existingActiveId !== tabId
      ? existingActiveId
      : tabs.find((tab) => tab.panelId === panelId)?.id ?? null;
    const panels = updatePanelStateForTabs(session, panelId, tabs, activeTabId);
    persistPanelStates(row.session_id, panels);
    return result.changes > 0;
  })();
  return deleted;
}

export function reorderProjectSessionTabs(input: ProjectSessionTabReorderInput): ProjectSession | null {
  const parsed = ProjectSessionTabReorderInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const panelTabs = session.tabs.filter((tab) => tab.panelId === parsed.panelId);
  const existingIds = new Set(panelTabs.map((tab) => tab.id));
  const selected = parsed.orderedTabIds.filter((tabId) => existingIds.has(tabId));
  const remaining = panelTabs.map((tab) => tab.id).filter((tabId) => !selected.includes(tabId));
  const finalOrder = [...selected, ...remaining];
  const now = new Date().toISOString();
  const database = getDb();
  const update = database.prepare('UPDATE project_session_tabs SET "order" = ?, updated_at = ? WHERE id = ? AND session_id = ? AND panel_id = ?');

  database.transaction(() => {
    finalOrder.forEach((tabId, index) => update.run(index, now, tabId, parsed.sessionId, parsed.panelId));
    const tabs = getTabsForSession(parsed.sessionId);
    const root = session.panels[parsed.panelId].layout.root;
    const activeTabId = root.type === "leaf"
      ? root.activeTabId
      : finalOrder[0] ?? null;
    const panels = updatePanelStateForTabs(session, parsed.panelId, tabs, activeTabId);
    persistPanelStates(parsed.sessionId, panels);
  })();

  return getProjectSession(parsed.sessionId);
}

export function moveProjectSessionTab(input: ProjectSessionTabMoveInput): ProjectSession | null {
  const parsed = ProjectSessionTabMoveInputSchema.parse(input);
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM project_session_tabs WHERE id = ?")
    .get(parsed.tabId) as DbProjectSessionTab | undefined;
  if (!row) return null;

  const session = getProjectSession(row.session_id);
  if (!session) return null;
  const sourcePanelId: PanelId = row.panel_id === "bottom" ? "bottom" : "right";
  const targetPanelId = parsed.targetPanelId;
  const now = new Date().toISOString();

  const writePanelOrder = database.prepare(
    'UPDATE project_session_tabs SET panel_id = ?, "order" = ?, updated_at = ? WHERE id = ? AND session_id = ?',
  );

  database.transaction(() => {
    const sourceOrder = getPanelTabOrder(session, sourcePanelId).filter((tabId) => tabId !== parsed.tabId);
    const targetOrderBase = sourcePanelId === targetPanelId
      ? sourceOrder
      : getPanelTabOrder(session, targetPanelId).filter((tabId) => tabId !== parsed.tabId);
    const targetIndex = Math.min(parsed.targetIndex ?? targetOrderBase.length, targetOrderBase.length);
    const targetOrder = [...targetOrderBase];
    targetOrder.splice(targetIndex, 0, parsed.tabId);

    sourceOrder.forEach((tabId, index) => {
      writePanelOrder.run(sourcePanelId, index, now, tabId, row.session_id);
    });
    targetOrder.forEach((tabId, index) => {
      writePanelOrder.run(targetPanelId, index, now, tabId, row.session_id);
    });

    const tabs = getTabsForSession(row.session_id);
    const sourceActive = session.panels[sourcePanelId].layout.root.type === "leaf"
      ? session.panels[sourcePanelId].layout.root.activeTabId
      : null;
    const sourcePanels = updatePanelStateForTabs(
      session,
      sourcePanelId,
      tabs,
      sourceActive === parsed.tabId ? sourceOrder[0] ?? null : sourceActive,
    );
    const nextSession = { ...session, panels: sourcePanels, tabs } satisfies ProjectSession;
    const panels = updatePanelStateForTabs(nextSession, targetPanelId, tabs, parsed.tabId, {
      collapsed: false,
    });
    persistPanelStates(row.session_id, panels);
  })();

  return getProjectSession(row.session_id);
}

export function updateProjectSessionPanel(
  sessionId: string,
  panelId: PanelId,
  input: Partial<ProjectSessionPanelState>,
): ProjectSession | null {
  return updateProjectSession(sessionId, { panels: { [panelId]: input } });
}

export function updateProjectSessionTabState(tabId: string, stateKey: number, state: unknown): ProjectSessionTab | null {
  return updateProjectSessionTab(tabId, { stateKey, state });
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
