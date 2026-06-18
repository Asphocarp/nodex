import { randomUUID } from "node:crypto";
import { getDb } from "./db-service";
import { requireProjectId } from "./project-service";
import {
  ProjectSessionCreateInputSchema,
  ProjectSessionPanelActivateInputSchema,
  ProjectSessionPanelLayoutSchema,
  ProjectSessionPanelMaximizeInputSchema,
  ProjectSessionPanelMergeInputSchema,
  ProjectSessionPanelResizeInputSchema,
  ProjectSessionPanelSplitInputSchema,
  ProjectSessionPanelsSchema,
  ProjectSessionTabDeleteInputSchema,
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
import {
  activateProjectSessionPanelLeaf,
  findProjectSessionPanelLeaf,
  findProjectSessionPanelLeafForTab,
  flattenProjectSessionPanelTabIds,
  getProjectSessionPanelActiveLeaf,
  listProjectSessionPanelLeaves,
  makeProjectSessionPanelLayout,
  mergeProjectSessionPanelLeaf,
  moveProjectSessionPanelLeaf,
  moveProjectSessionPanelTab,
  normalizeProjectSessionPanelLayout,
  pruneEmptyProjectSessionPanelLeaves,
  removeProjectSessionPanelTab,
  reorderProjectSessionPanelLeafTabs,
  setProjectSessionPanelBranchRatio,
  setProjectSessionPanelMaximizedLeaf,
  splitProjectSessionPanelLeaf,
} from "../../shared/project-session-panel-layout";
import type {
  PanelId,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionListOptions,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelMaximizeInput,
  ProjectSessionPanelMergeInput,
  ProjectSessionPanelResizeInput,
  ProjectSessionPanelSplitInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionTab,
  ProjectSessionTabConfig,
  ProjectSessionTabCreateInput,
  ProjectSessionTabDeleteInput,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRawPanelState(value: unknown, panelId: PanelId): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const panelState = value[panelId];
  return isRecord(panelState) ? panelState : undefined;
}

function readPanelSize(value: unknown): Partial<ProjectSessionPanelState["size"]> {
  if (!isRecord(value)) return {};
  const size: Partial<ProjectSessionPanelState["size"]> = {};
  if (typeof value.widthPx === "number" && Number.isFinite(value.widthPx) && value.widthPx > 0) {
    size.widthPx = value.widthPx;
  }
  if (typeof value.heightPx === "number" && Number.isFinite(value.heightPx) && value.heightPx > 0) {
    size.heightPx = value.heightPx;
  }
  if (typeof value.fullWidth === "boolean") {
    size.fullWidth = value.fullWidth;
  }
  return size;
}

function makeDefaultPanelLayout(tabIds: string[], activeTabId: string | null): ProjectSessionPanelLayout {
  return makeProjectSessionPanelLayout(tabIds, activeTabId);
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
  return normalizeProjectSessionPanelLayout(parsed.data, tabIds);
}

function normalizePanelState(
  panelId: PanelId,
  rawState: Record<string, unknown> | undefined,
  tabs: ProjectSessionTab[],
  fallback?: { collapsed?: boolean; layout?: unknown },
): ProjectSessionPanelState {
  const tabIds = tabs.map((tab) => tab.id);
  const defaultState = makeDefaultPanelState(panelId, tabIds, tabIds[0] ?? null);
  const size = {
    ...defaultState.size,
    ...readPanelSize(rawState?.size),
  };

  return {
    collapsed: typeof rawState?.collapsed === "boolean"
      ? rawState.collapsed
      : fallback?.collapsed ?? defaultState.collapsed,
    layout: normalizePanelLayout(rawState?.layout ?? fallback?.layout ?? defaultState.layout, tabs),
    size,
  };
}

function parsePanelStates(row: DbProjectSession, tabs: ProjectSessionTab[]): Record<PanelId, ProjectSessionPanelState> {
  const rawPanels = parseJson(row.panel_state_json);
  const rightTabs = tabs.filter((tab) => tab.panelId === "right");
  const bottomTabs = tabs.filter((tab) => tab.panelId === "bottom");

  return {
    right: normalizePanelState("right", readRawPanelState(rawPanels, "right"), rightTabs),
    bottom: normalizePanelState("bottom", readRawPanelState(rawPanels, "bottom"), bottomTabs),
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

function stringifyProjectSessionTabConfig(
  ownerProjectId: string,
  config: ProjectSessionTabConfig,
): string {
  const targetProjectId = "projectId" in config && typeof config.projectId === "string"
    ? requireProjectId(config.projectId)
    : ownerProjectId;

  return JSON.stringify({ ...config, projectId: targetProjectId });
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

function ensureProjectExists(projectId: string): string {
  return requireProjectId(projectId);
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
  projectId = ensureProjectExists(projectId);
  const parsedOptions = ProjectSessionListOptionsSchema.parse(options) ?? {};
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
  const projectId = ensureProjectExists(parsed.projectId);

  const database = getDb();
  const now = new Date().toISOString();
  const maxOrder = database
    .prepare('SELECT MAX("order") AS maxOrder FROM project_sessions WHERE project_id = ?')
    .get(projectId) as { maxOrder: number | null } | undefined;
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
    projectId,
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
    const mergedPanels: Record<PanelId, ProjectSessionPanelState> = {
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
    const nextPanels: Record<PanelId, ProjectSessionPanelState> = {
      right: {
        ...mergedPanels.right,
        layout: normalizeProjectSessionPanelLayout(
          mergedPanels.right.layout,
          existing.tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id),
        ),
      },
      bottom: {
        ...mergedPanels.bottom,
        layout: normalizeProjectSessionPanelLayout(
          mergedPanels.bottom.layout,
          existing.tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id),
        ),
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
  projectId = ensureProjectExists(projectId);
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
  projectId = ensureProjectExists(projectId);
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
  options: { collapsed?: boolean; preferredActiveLeafId?: string | null } = {},
): Record<PanelId, ProjectSessionPanelState> {
  const panelTabs = tabs.filter((tab) => tab.panelId === panelId);
  const panelTabIds = panelTabs.map((tab) => tab.id);
  const currentLayout = session.panels[panelId].layout;
  const layout = normalizeProjectSessionPanelLayout(currentLayout, panelTabIds, {
    preferredActiveLeafId: options.preferredActiveLeafId,
    preferredActiveTabId: activeTabId,
  });

  return {
    ...session.panels,
    [panelId]: {
      ...session.panels[panelId],
      collapsed: options.collapsed ?? (panelTabIds.length === 0 ? true : session.panels[panelId].collapsed),
      layout,
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

function persistPanelStatesAndOrders(
  sessionId: string,
  panels: Record<PanelId, ProjectSessionPanelState>,
  panelIds: readonly PanelId[] = ["right", "bottom"],
): void {
  const database = getDb();
  const now = new Date().toISOString();
  const updateTabOrder = database.prepare(
    'UPDATE project_session_tabs SET panel_id = ?, "order" = ?, updated_at = ? WHERE id = ? AND session_id = ?',
  );

  for (const panelId of panelIds) {
    flattenProjectSessionPanelTabIds(panels[panelId].layout).forEach((tabId, index) => {
      updateTabOrder.run(panelId, index, now, tabId, sessionId);
    });
  }

  database
    .prepare(`
      UPDATE project_sessions
      SET panel_state_json = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      stringifyPanels(panels),
      now,
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

function findProjectSessionPanelLeafForOrderedTabs(
  layout: ProjectSessionPanelLayout,
  orderedTabIds: readonly string[],
) {
  if (orderedTabIds.length === 0) return getProjectSessionPanelActiveLeaf(layout);
  const selected = new Set(orderedTabIds);
  return listProjectSessionPanelLeaves(layout).find((leaf) =>
    leaf.tabIds.some((tabId) => selected.has(tabId))
  ) ?? null;
}

function parseProjectSessionTabDeleteInput(input: string | ProjectSessionTabDeleteInput): ProjectSessionTabDeleteInput {
  if (typeof input === "string") return { tabId: input };
  return ProjectSessionTabDeleteInputSchema.parse(input);
}

function cleanupPanelLayout(
  layout: ProjectSessionPanelLayout,
  tabIds: readonly string[],
  options: {
    preserveEmptyLeafIds?: readonly string[];
    preferredActiveLeafId?: string | null;
    preferredActiveTabId?: string | null;
  } = {},
) {
  const normalizeOptions = {
    preferredActiveLeafId: options.preferredActiveLeafId,
    preferredActiveTabId: options.preferredActiveTabId,
  };
  return pruneEmptyProjectSessionPanelLeaves(
    normalizeProjectSessionPanelLayout(layout, tabIds, normalizeOptions),
    {
      ...normalizeOptions,
      preserveLeafIds: options.preserveEmptyLeafIds,
    },
  );
}

function findSingletonTab(session: ProjectSession, kind: ProjectSessionTabCreateInput["kind"]): ProjectSessionTab | null {
  if (!PROJECT_SESSION_SINGLETON_TAB_KIND_SET.has(kind)) return null;
  return session.tabs.find((tab) => tab.kind === kind) ?? null;
}

export function createProjectSessionTab(input: ProjectSessionTabCreateInput): ProjectSessionTab {
  const parsed = ProjectSessionTabCreateInputSchema.parse(input);
  const projectId = ensureProjectExists(parsed.projectId);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== projectId) {
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
      projectId,
      parsed.panelId,
      parsed.kind,
      parsed.title,
      stringifyProjectSessionTabConfig(projectId, parsed.config),
      (maxOrder?.maxOrder ?? -1) + 1,
      now,
      now,
    );
    const tabs = getTabsForSession(parsed.sessionId);
    const panels = updatePanelStateForTabs(session, parsed.panelId, tabs, id, {
      collapsed: false,
      preferredActiveLeafId: parsed.targetLeafId,
    });
    persistPanelStatesAndOrders(parsed.sessionId, panels, [parsed.panelId]);
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
    values.push(stringifyProjectSessionTabConfig(row.project_id, parsed.config));
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

export function deleteProjectSessionTab(input: string | ProjectSessionTabDeleteInput): boolean {
  const parsed = parseProjectSessionTabDeleteInput(input);
  const tabId = parsed.tabId;
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
    const panelTabIds = tabs.filter((tab) => tab.panelId === panelId).map((tab) => tab.id);
    const layout = cleanupPanelLayout(
      removeProjectSessionPanelTab(session.panels[panelId].layout, tabId),
      panelTabIds,
      {
        preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
      },
    );
    const panels: Record<PanelId, ProjectSessionPanelState> = {
      ...session.panels,
      [panelId]: {
        ...session.panels[panelId],
        collapsed: panelTabIds.length === 0 ? true : session.panels[panelId].collapsed,
        layout,
      },
    };
    persistPanelStatesAndOrders(row.session_id, panels, [panelId]);
    return result.changes > 0;
  })();
  return deleted;
}

export function reorderProjectSessionTabs(input: ProjectSessionTabReorderInput): ProjectSession | null {
  const parsed = ProjectSessionTabReorderInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const panelTabs = session.tabs.filter((tab) => tab.panelId === parsed.panelId);
  const panelTabIds = panelTabs.map((tab) => tab.id);
  const normalizedLayout = normalizeProjectSessionPanelLayout(session.panels[parsed.panelId].layout, panelTabIds);
  const targetLeaf = parsed.leafId
    ? findProjectSessionPanelLeaf(normalizedLayout, parsed.leafId)
    : panelTabs.length === parsed.orderedTabIds.length
      ? getProjectSessionPanelActiveLeaf(normalizedLayout)
      : findProjectSessionPanelLeafForOrderedTabs(normalizedLayout, parsed.orderedTabIds);
  const leafId = targetLeaf?.id ?? getProjectSessionPanelActiveLeaf(normalizedLayout).id;
  const layout = reorderProjectSessionPanelLeafTabs(normalizedLayout, leafId, parsed.orderedTabIds);
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      layout,
    },
  };
  const database = getDb();

  database.transaction(() => {
    persistPanelStatesAndOrders(parsed.sessionId, panels, [parsed.panelId]);
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
  const sourcePanelTabIds = session.tabs
    .filter((tab) => tab.panelId === sourcePanelId)
    .map((tab) => tab.id);
  const sourceLayoutBeforeMove = normalizeProjectSessionPanelLayout(
    session.panels[sourcePanelId].layout,
    sourcePanelTabIds,
  );
  const sourceLeaf = findProjectSessionPanelLeafForTab(sourceLayoutBeforeMove, parsed.tabId);
  if (
    parsed.splitTarget
    && sourcePanelId === targetPanelId
    && sourceLeaf?.id === parsed.splitTarget.leafId
    && sourceLeaf.tabIds.length <= 1
  ) {
    return session;
  }

  database.transaction(() => {
    const sourceTabIds = session.tabs
      .filter((tab) => tab.panelId === sourcePanelId && tab.id !== parsed.tabId)
      .map((tab) => tab.id);
    const targetTabIds = session.tabs
      .filter((tab) => tab.panelId === targetPanelId || tab.id === parsed.tabId)
      .map((tab) => tab.id);
    const sourceLayout = cleanupPanelLayout(
      removeProjectSessionPanelTab(session.panels[sourcePanelId].layout, parsed.tabId),
      sourceTabIds,
      {
        preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
      },
    );
    const baseTargetLayout = sourcePanelId === targetPanelId
      ? sourceLayout
      : normalizeProjectSessionPanelLayout(session.panels[targetPanelId].layout, targetTabIds);
    let targetLayout = baseTargetLayout;
    if (
      parsed.splitTarget
      && sourcePanelId === targetPanelId
      && sourceLeaf
      && sourceLeaf.tabIds.length === 1
      && sourceLeaf.id !== parsed.splitTarget.leafId
    ) {
      targetLayout = moveProjectSessionPanelLeaf(sourceLayoutBeforeMove, {
        sourceLeafId: sourceLeaf.id,
        targetLeafId: parsed.splitTarget.leafId,
        side: parsed.splitTarget.side,
        newBranchId: randomUUID(),
      });
    } else if (parsed.splitTarget) {
      targetLayout = splitProjectSessionPanelLeaf(baseTargetLayout, {
        leafId: parsed.splitTarget.leafId,
        side: parsed.splitTarget.side,
        tabId: parsed.tabId,
        newLeafId: randomUUID(),
        newBranchId: randomUUID(),
      });
    } else {
      targetLayout = moveProjectSessionPanelTab(baseTargetLayout, {
        tabId: parsed.tabId,
        targetLeafId: parsed.targetLeafId,
        targetIndex: parsed.targetIndex,
      });
    }
    targetLayout = cleanupPanelLayout(targetLayout, targetTabIds, {
      preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
      preferredActiveTabId: parsed.tabId,
    });
    const panels: Record<PanelId, ProjectSessionPanelState> = {
      ...session.panels,
      [sourcePanelId]: {
        ...session.panels[sourcePanelId],
        collapsed: sourceTabIds.length === 0 ? true : session.panels[sourcePanelId].collapsed,
        layout: sourcePanelId === targetPanelId ? targetLayout : sourceLayout,
      },
      [targetPanelId]: {
        ...session.panels[targetPanelId],
        collapsed: false,
        layout: targetLayout,
      },
    };
    persistPanelStatesAndOrders(row.session_id, panels);
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

export function splitProjectSessionPanelGroup(input: ProjectSessionPanelSplitInput): ProjectSession | null {
  const parsed = ProjectSessionPanelSplitInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;
  if (parsed.tabId && !session.tabs.some((tab) => tab.id === parsed.tabId && tab.panelId === parsed.panelId)) {
    throw new Error("Tab does not belong to the target panel");
  }

  const panelTabIds = session.tabs.filter((tab) => tab.panelId === parsed.panelId).map((tab) => tab.id);
  const layout = cleanupPanelLayout(
    splitProjectSessionPanelLeaf(session.panels[parsed.panelId].layout, {
      leafId: parsed.leafId,
      side: parsed.side,
      tabId: parsed.tabId,
      newLeafId: randomUUID(),
      newBranchId: randomUUID(),
    }),
    panelTabIds,
    {
      preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
      preferredActiveLeafId: parsed.leafId,
      preferredActiveTabId: parsed.tabId ?? null,
    },
  );
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      collapsed: false,
      layout,
    },
  };
  getDb().transaction(() => persistPanelStatesAndOrders(parsed.sessionId, panels, [parsed.panelId]))();
  return getProjectSession(parsed.sessionId);
}

export function mergeProjectSessionPanelGroup(input: ProjectSessionPanelMergeInput): ProjectSession | null {
  const parsed = ProjectSessionPanelMergeInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const layout = mergeProjectSessionPanelLeaf(session.panels[parsed.panelId].layout, parsed.leafId);
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      layout,
    },
  };
  getDb().transaction(() => persistPanelStatesAndOrders(parsed.sessionId, panels, [parsed.panelId]))();
  return getProjectSession(parsed.sessionId);
}

export function activateProjectSessionPanelGroup(input: ProjectSessionPanelActivateInput): ProjectSession | null {
  const parsed = ProjectSessionPanelActivateInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const layout = activateProjectSessionPanelLeaf(
    session.panels[parsed.panelId].layout,
    parsed.leafId,
    parsed.tabId,
  );
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      layout,
    },
  };
  persistPanelStates(parsed.sessionId, panels);
  return getProjectSession(parsed.sessionId);
}

export function resizeProjectSessionPanelGroup(input: ProjectSessionPanelResizeInput): ProjectSession | null {
  const parsed = ProjectSessionPanelResizeInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const layout = setProjectSessionPanelBranchRatio(
    session.panels[parsed.panelId].layout,
    parsed.branchId,
    parsed.ratio,
  );
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      layout,
    },
  };
  persistPanelStates(parsed.sessionId, panels);
  return getProjectSession(parsed.sessionId);
}

export function maximizeProjectSessionPanelGroup(input: ProjectSessionPanelMaximizeInput): ProjectSession | null {
  const parsed = ProjectSessionPanelMaximizeInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const layout = setProjectSessionPanelMaximizedLeaf(session.panels[parsed.panelId].layout, parsed.leafId);
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      layout,
    },
  };
  persistPanelStates(parsed.sessionId, panels);
  return getProjectSession(parsed.sessionId);
}

export function updateProjectSessionTabState(tabId: string, stateKey: number, state: unknown): ProjectSessionTab | null {
  return updateProjectSessionTab(tabId, { stateKey, state });
}

export function upsertProjectSessionThreadLink(input: ProjectSessionThreadLinkInput): ProjectSessionThreadLink {
  const parsed = ProjectSessionThreadLinkInputSchema.parse(input);
  const projectId = ensureProjectExists(parsed.projectId);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== projectId) {
    throw new Error("Thread project must match the owning session project");
  }

  const nowMs = Date.now();
  const linkedAt = new Date().toISOString();
  const existing = getCodexThread(parsed.threadId);
  upsertCodexThread({
    projectId,
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
