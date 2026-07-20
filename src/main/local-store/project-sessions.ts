import { randomUUID } from "node:crypto";
import { getDb } from "./database";
import { requireActiveProjectId, requireProjectId } from "./projects";
import {
  ProjectSessionCreateInputSchema,
  ProjectSessionPanelActivateInputSchema,
  ProjectSessionPanelEnsureRightLeafInputSchema,
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
  findNearestProjectSessionPanelLeafToRight,
  findProjectSessionPanelLeaf,
  findProjectSessionPanelLeafForTab,
  flattenProjectSessionPanelTabIds,
  getProjectSessionPanelActiveLeaf,
  insertProjectSessionPanelLeaf,
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
  ProjectSessionDbViewTabConfig,
  ProjectSessionListOptions,
  ProjectSessionSummary,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelEnsureRightLeafInput,
  ProjectSessionPanelEnsureRightLeafResult,
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
} from "../../shared/types";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
} from "../../shared/database-module-v2";
import { parseDatabaseViewId } from "../../shared/database-identities";
import { readDatabaseModuleV2 } from "./database-module-v2-runtime";
import {
  getCodexThread,
  upsertCodexThread,
} from "../codex/codex-link-repository";
import { PROJECT_SESSION_SINGLETON_TAB_KINDS } from "../../shared/types";
import {
  CodexThreadActiveFlagSchema,
  CodexThreadStatusTypeSchema,
} from "../../shared/schemas/codex";

const PROJECT_SESSION_SINGLETON_TAB_KIND_SET = new Set<string>(PROJECT_SESSION_SINGLETON_TAB_KINDS);
const DEFAULT_RIGHT_PANEL_WIDTH = 600;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;

interface DbProjectSession {
  id: string;
  project_id: string | null;
  no_thread_fallback_title: string;
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
  project_id: string | null;
  browser_tab_id: string | null;
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

type ResolvedProjectSessionDbViewTabConfig = ProjectSessionDbViewTabConfig & {
  readonly databaseViewId: string;
};

interface DbProjectSessionThread {
  session_id: string;
  thread_id: string;
  session_project_id: string | null;
  project_id: string | null;
  forked_from_id: string | null;
  parent_thread_id: string | null;
  thread_name: string | null;
  thread_preview: string;
  model_provider: string;
  cwd: string | null;
  managed_worktree_path: string | null;
  projectless_output_directory: string | null;
  projectless_workspace_browser_root: string | null;
  status_type: string;
  status_active_flags_json: string;
  archived: number;
  created_at: number;
  updated_at: number;
  linked_at: string;
}

interface DbProjectSessionSummaryRow {
  id: string;
  project_id: string | null;
  no_thread_fallback_title: string;
  order: number;
  pinned: number;
  pinned_order: number | null;
  archived: number;
  archived_at: string | null;
  unread: number;
  left_pane_collapsed: number;
  created_at: string;
  updated_at: string;
  thread_session_id: string | null;
  thread_linked_at: string | null;
  thread_thread_id: string | null;
  thread_project_id: string | null;
  thread_forked_from_id: string | null;
  thread_parent_thread_id: string | null;
  thread_thread_name: string | null;
  thread_thread_preview: string | null;
  thread_model_provider: string | null;
  thread_cwd: string | null;
  thread_managed_worktree_path: string | null;
  thread_projectless_output_directory: string | null;
  thread_projectless_workspace_browser_root: string | null;
  thread_status_type: string | null;
  thread_status_active_flags_json: string | null;
  thread_archived: number | null;
  thread_created_at: number | null;
  thread_updated_at: number | null;
}

export interface ProjectSessionThreadOwner {
  sessionId: string;
  projectId: string | null;
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

function resolveActiveDatabaseViewConfig(
  database: ReturnType<typeof getDb>,
  config: ProjectSessionDbViewTabConfig,
): ResolvedProjectSessionDbViewTabConfig {
  const projectId = requireProjectId(config.projectId);
  if (!config.databaseViewId) {
    const result = readDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: { target: { kind: "project_default" }, mode: "database" },
    });
    const descriptor = result.ok && result.value.value.kind === "database"
      ? result.value.value.value
      : null;
    const primaryView = descriptor?.views.find(
      (view) =>
        view.lifecycle === "active"
        && view.viewId === descriptor.database.defaultViewId,
    );
    if (!primaryView) {
      throw new Error(
        `Database View tab cannot resolve the active default View for Project ${projectId}`,
      );
    }
    return {
      projectId,
      databaseViewId: primaryView.viewId,
      view: config.view,
    };
  }

  const result = readDatabaseModuleV2(database, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId,
    read: {
      target: {
        kind: "view",
        viewId: parseDatabaseViewId(config.databaseViewId),
      },
      mode: "view",
    },
  });
  const activeView = result.ok && result.value.value.kind === "view"
    && result.value.value.value.lifecycle === "active"
    ? result.value.value.value
    : null;
  if (!activeView) {
    throw new Error(
      `Active Database View ${config.databaseViewId} was not found in Project ${projectId}`,
    );
  }

  return {
    projectId,
    databaseViewId: activeView.viewId,
    view: config.view,
  };
}

function parseStoredProjectSessionTabConfig(
  database: ReturnType<typeof getDb>,
  row: DbProjectSessionTab,
): { readonly config: ProjectSessionTabConfig; readonly updatedAt: string } {
  const parsed = parseProjectSessionTabConfig(row.kind, parseJson(row.config_json));
  if (row.kind === "page_stage") {
    const configJson = JSON.stringify(parsed);
    if (configJson === row.config_json) {
      return { config: parsed, updatedAt: row.updated_at };
    }
    const updatedAt = new Date().toISOString();
    database.prepare(`
      UPDATE project_session_tabs
      SET config_json = ?, updated_at = ?
      WHERE id = ? AND config_json = ?
    `).run(configJson, updatedAt, row.id, row.config_json);
    return { config: parsed, updatedAt };
  }
  if (row.kind !== "db_view") {
    return { config: parsed, updatedAt: row.updated_at };
  }

  const resolved = resolveActiveDatabaseViewConfig(
    database,
    parsed as ProjectSessionDbViewTabConfig,
  );
  if ((parsed as ProjectSessionDbViewTabConfig).databaseViewId) {
    return { config: resolved, updatedAt: row.updated_at };
  }

  const configJson = JSON.stringify(resolved);
  const updatedAt = new Date().toISOString();
  database.prepare(`
    UPDATE project_session_tabs
    SET config_json = ?, updated_at = ?
    WHERE id = ? AND config_json = ?
  `).run(configJson, updatedAt, row.id, row.config_json);
  return { config: resolved, updatedAt };
}

function rowToTab(
  row: DbProjectSessionTab,
  database: ReturnType<typeof getDb> = getDb(),
): ProjectSessionTab {
  const normalized = parseStoredProjectSessionTabConfig(database, row);
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    browserTabId: row.browser_tab_id,
    panelId: row.panel_id === "bottom" ? "bottom" : "right",
    kind: row.kind as ProjectSessionTab["kind"],
    title: row.title,
    order: row.order,
    config: normalized.config,
    stateKey: row.state_key,
    state: parseJson(row.state_json),
    createdAt: row.created_at,
    updatedAt: normalized.updatedAt,
  };
}

export function stringifyProjectSessionTabConfig(
  ownerProjectId: string | null,
  config: ProjectSessionTabConfig,
): string {
  const configuredProjectId = "projectId" in config ? config.projectId : ownerProjectId;
  const targetProjectId = configuredProjectId === null
    ? null
    : requireProjectId(configuredProjectId);

  return JSON.stringify({ ...config, projectId: targetProjectId });
}

function parseStatusActiveFlags(value: string) {
  const parsed = parseJson(value);
  const result = CodexThreadActiveFlagSchema.array().safeParse(parsed);
  return result.success ? result.data : [];
}

function parseStatusType(value: string) {
  const result = CodexThreadStatusTypeSchema.safeParse(value);
  return result.success ? result.data : "notLoaded" as const;
}

function rowToThread(row: DbProjectSessionThread): ProjectSessionThreadLink {
  return {
    sessionId: row.session_id,
    projectId: row.project_id ?? row.session_project_id,
    threadId: row.thread_id,
    forkedFromId: row.forked_from_id,
    parentThreadId: row.parent_thread_id || undefined,
    threadName: row.thread_name || undefined,
    threadPreview: row.thread_preview,
    modelProvider: row.model_provider,
    cwd: row.cwd || undefined,
    managedWorktreePath: row.managed_worktree_path,
    projectlessOutputDirectory: row.projectless_output_directory,
    projectlessWorkspaceBrowserRoot: row.projectless_workspace_browser_root,
    statusType: parseStatusType(row.status_type),
    statusActiveFlags: parseStatusActiveFlags(row.status_active_flags_json),
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkedAt: row.linked_at,
  };
}

function rowToSummaryThread(row: DbProjectSessionSummaryRow): ProjectSessionThreadLink | null {
  if (!row.thread_session_id || !row.thread_thread_id || row.thread_linked_at === null) return null;
  return rowToThread({
    session_id: row.thread_session_id,
    linked_at: row.thread_linked_at,
    session_project_id: row.project_id,
    project_id: row.thread_project_id,
    thread_id: row.thread_thread_id,
    forked_from_id: row.thread_forked_from_id,
    parent_thread_id: row.thread_parent_thread_id,
    thread_name: row.thread_thread_name,
    thread_preview: row.thread_thread_preview ?? "",
    model_provider: row.thread_model_provider ?? "openai",
    cwd: row.thread_cwd,
    managed_worktree_path: row.thread_managed_worktree_path,
    projectless_output_directory: row.thread_projectless_output_directory,
    projectless_workspace_browser_root: row.thread_projectless_workspace_browser_root,
    status_type: row.thread_status_type ?? "notLoaded",
    status_active_flags_json: row.thread_status_active_flags_json ?? "[]",
    archived: row.thread_archived ?? 0,
    created_at: row.thread_created_at ?? 0,
    updated_at: row.thread_updated_at ?? 0,
  });
}

function firstNonEmptyTitle(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function resolveProjectSessionDisplayTitle(input: {
  noThreadFallbackTitle: string;
  thread: ProjectSessionThreadLink | null;
}): string {
  return firstNonEmptyTitle(
    input.thread?.threadName,
    input.thread?.threadPreview,
    input.noThreadFallbackTitle,
  ) ?? "New thread";
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
  const tabs = tabRows.map((tabRow) => rowToTab(tabRow, database));
  const threadRow = database
    .prepare(`
      SELECT
        pst.session_id,
        pst.linked_at,
        ps.project_id AS session_project_id,
        t.thread_id,
        t.project_id,
        t.forked_from_id,
        t.parent_thread_id,
        t.thread_name,
        t.thread_preview,
        t.model_provider,
        t.cwd,
        t.managed_worktree_path,
        t.projectless_output_directory,
        t.projectless_workspace_browser_root,
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

  const thread = threadRow ? rowToThread(threadRow) : null;
  const noThreadFallbackTitle = row.no_thread_fallback_title;

  return {
    id: row.id,
    projectId: row.project_id,
    noThreadFallbackTitle,
    displayTitle: resolveProjectSessionDisplayTitle({
      noThreadFallbackTitle,
      thread,
    }),
    order: row.order,
    pinned: row.pinned === 1,
    pinnedOrder: row.pinned_order,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    unread: row.unread === 1,
    leftPaneCollapsed: row.left_pane_collapsed === 1,
    panels: parsePanelStates(row, tabs),
    thread,
    tabs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSessionSummary(row: DbProjectSessionSummaryRow): ProjectSessionSummary {
  const thread = rowToSummaryThread(row);
  const noThreadFallbackTitle = row.no_thread_fallback_title;
  return {
    id: row.id,
    projectId: row.project_id,
    noThreadFallbackTitle,
    displayTitle: resolveProjectSessionDisplayTitle({
      noThreadFallbackTitle,
      thread,
    }),
    order: row.order,
    pinned: row.pinned === 1,
    pinnedOrder: row.pinned_order,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    unread: row.unread === 1,
    leftPaneCollapsed: row.left_pane_collapsed === 1,
    thread,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureProjectExists(projectId: string): string {
  return requireProjectId(projectId);
}

function normalizeProjectSessionProjectId(projectId: string | null): string | null {
  if (projectId === null) return null;
  return ensureProjectExists(projectId);
}

function normalizeNewProjectSessionProjectId(
  projectId: string | null,
): string | null {
  if (projectId === null) return null;
  return requireActiveProjectId(projectId);
}

function projectSessionWhereClause(projectId: string | null): {
  sql: string;
  values: Array<string | number>;
} {
  if (projectId === null) {
    return { sql: "project_id IS NULL", values: [] };
  }
  return { sql: "project_id = ?", values: [projectId] };
}

export function listProjectSessions(
  projectId: string | null,
  options?: ProjectSessionListOptions,
): ProjectSession[] {
  projectId = normalizeProjectSessionProjectId(projectId);
  const parsedOptions = ProjectSessionListOptionsSchema.parse(options) ?? {};
  const projectWhere = projectSessionWhereClause(projectId);
  const rows = getDb()
    .prepare(`
      SELECT *
      FROM project_sessions
      WHERE ${projectWhere.sql}
        AND (? = 1 OR archived = 0)
      ORDER BY
        CASE WHEN pinned = 1 THEN 0 ELSE 1 END ASC,
        CASE
          WHEN pinned = 1 THEN COALESCE(pinned_order, 9223372036854775807)
          ELSE "order"
        END ASC,
        created_at ASC
    `)
    .all(...projectWhere.values, parsedOptions.includeArchived === true ? 1 : 0) as DbProjectSession[];
  return rows.map(buildSession);
}

function projectSessionSummarySelectSql(whereSql: string): string {
  return `
    SELECT
      ps.id,
      ps.project_id,
      ps.no_thread_fallback_title,
      ps."order",
      ps.pinned,
      ps.pinned_order,
      ps.archived,
      ps.archived_at,
      ps.unread,
      ps.left_pane_collapsed,
      ps.created_at,
      ps.updated_at,
      pst.session_id AS thread_session_id,
      pst.linked_at AS thread_linked_at,
      t.thread_id AS thread_thread_id,
      t.project_id AS thread_project_id,
      t.forked_from_id AS thread_forked_from_id,
      t.parent_thread_id AS thread_parent_thread_id,
      t.thread_name AS thread_thread_name,
      t.thread_preview AS thread_thread_preview,
      t.model_provider AS thread_model_provider,
      t.cwd AS thread_cwd,
      t.managed_worktree_path AS thread_managed_worktree_path,
      t.projectless_output_directory AS thread_projectless_output_directory,
      t.projectless_workspace_browser_root AS thread_projectless_workspace_browser_root,
      t.status_type AS thread_status_type,
      t.status_active_flags_json AS thread_status_active_flags_json,
      t.archived AS thread_archived,
      t.created_at AS thread_created_at,
      t.updated_at AS thread_updated_at
    FROM project_sessions ps
    LEFT JOIN project_session_threads pst ON pst.session_id = ps.id
    LEFT JOIN codex_threads t ON t.thread_id = pst.thread_id
    WHERE ${whereSql}
      AND (? = 1 OR ps.archived = 0)
    ORDER BY
      CASE WHEN ps.pinned = 1 THEN 0 ELSE 1 END ASC,
      CASE
        WHEN ps.pinned = 1 THEN COALESCE(ps.pinned_order, 9223372036854775807)
        ELSE ps."order"
      END ASC,
      ps.created_at ASC
  `;
}

export function listProjectSessionSummaries(
  projectId: string | null,
  options?: ProjectSessionListOptions,
): ProjectSessionSummary[] {
  projectId = normalizeProjectSessionProjectId(projectId);
  const parsedOptions = ProjectSessionListOptionsSchema.parse(options) ?? {};
  const whereSql = projectId === null ? "ps.project_id IS NULL" : "ps.project_id = ?";
  const rows = getDb()
    .prepare(projectSessionSummarySelectSql(whereSql))
    .all(
      ...(projectId === null ? [] : [projectId]),
      parsedOptions.includeArchived === true ? 1 : 0,
    ) as DbProjectSessionSummaryRow[];
  return rows.map(buildSessionSummary);
}

export function listProjectlessSessions(options?: ProjectSessionListOptions): ProjectSession[] {
  return listProjectSessions(null, options);
}

export function listProjectlessSessionSummaries(options?: ProjectSessionListOptions): ProjectSessionSummary[] {
  return listProjectSessionSummaries(null, options);
}

export function getProjectSession(sessionId: string): ProjectSession | null {
  const row = getDb()
    .prepare("SELECT * FROM project_sessions WHERE id = ?")
    .get(sessionId) as DbProjectSession | undefined;
  return row ? buildSession(row) : null;
}

export function getProjectSessionSummary(sessionId: string): ProjectSessionSummary | null {
  const row = getDb()
    .prepare(`${projectSessionSummarySelectSql("ps.id = ?")} LIMIT 1`)
    .get(sessionId, 1) as DbProjectSessionSummaryRow | undefined;
  return row ? buildSessionSummary(row) : null;
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
        t.forked_from_id,
        t.parent_thread_id,
        t.thread_name,
        t.thread_preview,
        t.model_provider,
        t.cwd,
        t.managed_worktree_path,
        t.projectless_output_directory,
        t.projectless_workspace_browser_root,
        t.status_type,
        t.status_active_flags_json,
        t.archived,
        t.created_at,
        t.updated_at
      FROM project_session_threads pst
      JOIN project_sessions ps ON ps.id = pst.session_id
      JOIN codex_threads t ON t.thread_id = pst.thread_id
      WHERE pst.thread_id = ?
      ORDER BY pst.linked_at ASC, pst.session_id ASC
      LIMIT 1
    `)
    .get(threadId) as DbProjectSessionThread | undefined;
  return row ? rowToThread(row) : null;
}

export function listProjectSessionThreadOwners(threadId: string): ProjectSessionThreadOwner[] {
  return getDb()
    .prepare(`
      SELECT
        pst.session_id AS sessionId,
        ps.project_id AS projectId
      FROM project_session_threads pst
      JOIN project_sessions ps ON ps.id = pst.session_id
      WHERE pst.thread_id = ?
      ORDER BY pst.linked_at ASC, pst.session_id ASC
    `)
    .all(threadId) as ProjectSessionThreadOwner[];
}

export function createProjectSession(input: ProjectSessionCreateInput): ProjectSession {
  const parsed = ProjectSessionCreateInputSchema.parse(input);
  const projectId = normalizeNewProjectSessionProjectId(parsed.projectId);

  const database = getDb();
  const now = new Date().toISOString();
  const projectWhere = projectSessionWhereClause(projectId);
  const order = 0;
  const id = randomUUID();
  const panels = {
    right: makeDefaultPanelState("right", [], null),
    bottom: makeDefaultPanelState("bottom", [], null),
  } satisfies Record<PanelId, ProjectSessionPanelState>;

  const insert = database.transaction(() => {
    database.prepare(`
      UPDATE project_sessions
      SET "order" = "order" + 1, updated_at = ?
      WHERE ${projectWhere.sql}
        AND "order" >= ?
    `).run(now, ...projectWhere.values, order);

    database.prepare(`
      INSERT INTO project_sessions (
        id, project_id, no_thread_fallback_title, "order", pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, NULL, 0, NULL, 0, 0, ?, ?, ?)
    `).run(
      id,
      projectId,
      parsed.noThreadFallbackTitle,
      order,
      stringifyPanels(panels),
      now,
      now,
    );
  });
  insert();

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
  if (parsed.noThreadFallbackTitle !== undefined) {
    fields.push("no_thread_fallback_title = ?");
    values.push(parsed.noThreadFallbackTitle);
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

  const result = getDb().prepare("DELETE FROM project_sessions WHERE id = ?").run(sessionId);
  return result.changes > 0;
}

export function moveProjectSessionToProject(sessionId: string, projectId: string | null): ProjectSession | null {
  const existing = getProjectSession(sessionId);
  if (!existing) return null;

  const nextProjectId = projectId === null ? null : ensureProjectExists(projectId);
  if (existing.projectId === nextProjectId) return existing;
  if (existing.tabs.some((tab) => tab.kind !== "browser")) {
    throw new Error("Only empty or browser-only project sessions can move between projects");
  }

  const database = getDb();
  const now = new Date().toISOString();
  const targetWhere = projectSessionWhereClause(nextProjectId);
  const nextPinnedOrder = existing.pinned
    ? ((database
      .prepare(`
        SELECT MAX(pinned_order) AS maxPinnedOrder
        FROM project_sessions
        WHERE ${targetWhere.sql} AND pinned = 1 AND archived = 0
      `)
      .get(...targetWhere.values) as { maxPinnedOrder: number | null } | undefined)?.maxPinnedOrder ?? -1) + 1
    : null;

  const move = database.transaction(() => {
    database.prepare(`
      UPDATE project_sessions
      SET "order" = "order" + 1, updated_at = ?
      WHERE ${targetWhere.sql}
        AND "order" >= 0
    `).run(now, ...targetWhere.values);

    database.prepare(`
      UPDATE project_sessions
      SET project_id = ?,
          "order" = 0,
          pinned_order = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextProjectId, nextPinnedOrder, now, sessionId);

    const updateBrowserTab = database.prepare(`
      UPDATE project_session_tabs
      SET project_id = ?,
          config_json = ?,
          updated_at = ?
      WHERE id = ?
    `);
    for (const tab of existing.tabs) {
      if (tab.kind !== "browser") continue;
      updateBrowserTab.run(
        nextProjectId,
        stringifyProjectSessionTabConfig(nextProjectId, {
          ...tab.config,
          projectId: nextProjectId,
        }),
        now,
        tab.id,
      );
    }

    database.prepare(`
      UPDATE codex_threads
      SET project_id = ?
      WHERE thread_id IN (
        SELECT thread_id
        FROM project_session_threads
        WHERE session_id = ?
      )
    `).run(nextProjectId, sessionId);
  });
  move();

  return getProjectSession(sessionId);
}

export function reorderProjectSessions(projectId: string, orderedSessionIds: string[]): ProjectSession[] {
  projectId = ensureProjectExists(projectId);
  const existing = listProjectSessions(projectId);
  const existingIds = new Set(existing.map((session) => session.id));
  const selected = orderedSessionIds.filter((sessionId) => existingIds.has(sessionId));
  const remaining = existing.map((session) => session.id).filter((sessionId) => !selected.includes(sessionId));
  const finalOrder = [...selected, ...remaining];
  const byId = new Map(existing.map((session) => [session.id, session]));
  const pinnedOrder = finalOrder.filter((sessionId) => byId.get(sessionId)?.pinned === true);
  const now = new Date().toISOString();

  const database = getDb();
  const updateOrder = database.prepare('UPDATE project_sessions SET "order" = ?, updated_at = ? WHERE id = ? AND project_id = ?');
  const updatePinnedOrder = database.prepare("UPDATE project_sessions SET pinned_order = ?, updated_at = ? WHERE id = ? AND project_id = ? AND pinned = 1");
  const tx = database.transaction(() => {
    finalOrder.forEach((sessionId, index) => updateOrder.run(index, now, sessionId, projectId));
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

  const database = getDb();
  const now = new Date().toISOString();
  if (parsed.pinned) {
    const projectWhere = projectSessionWhereClause(existing.projectId);
    const maxPinnedOrder = database
      .prepare(`
        SELECT MAX(pinned_order) AS maxPinnedOrder
        FROM project_sessions
        WHERE ${projectWhere.sql} AND pinned = 1 AND archived = 0
      `)
      .get(...projectWhere.values) as { maxPinnedOrder: number | null } | undefined;
    const nextPinnedOrder = existing.pinned && existing.pinnedOrder !== null
      ? existing.pinnedOrder
      : (maxPinnedOrder?.maxPinnedOrder ?? -1) + 1;

    database.prepare(`
      UPDATE project_sessions
      SET pinned = 1, pinned_order = ?, updated_at = ?
      WHERE id = ?
    `).run(nextPinnedOrder, now, sessionId);
    return getProjectSession(sessionId);
  }

  database.prepare(`
    UPDATE project_sessions
    SET pinned = 0, pinned_order = NULL, updated_at = ?
    WHERE id = ?
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
    .filter((session) => session.pinned && !session.archived);
  const existingIds = new Set(existing.map((session) => session.id));
  const selected = parsed.orderedSessionIds.filter((sessionId) => existingIds.has(sessionId));
  const remaining = existing.map((session) => session.id).filter((sessionId) => !selected.includes(sessionId));
  const finalOrder = [...selected, ...remaining];
  const now = new Date().toISOString();

  const update = getDb().prepare(`
    UPDATE project_sessions
    SET pinned_order = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND pinned = 1
  `);
  getDb().transaction(() => {
    finalOrder.forEach((sessionId, index) => update.run(index, now, sessionId, projectId));
  })();

  return listProjectSessions(projectId);
}

export function archiveProjectSession(sessionId: string): ProjectSession | null {
  const existing = getProjectSession(sessionId);
  if (!existing) return null;

  getDb().prepare(`
    UPDATE project_sessions
    SET archived = 1,
        archived_at = ?,
        pinned = 0,
        pinned_order = NULL,
        unread = 0,
        updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), sessionId);
  return getProjectSession(sessionId);
}

export function unarchiveProjectSession(sessionId: string): ProjectSession | null {
  const existing = getProjectSession(sessionId);
  if (!existing) return null;

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE project_sessions
    SET archived = 0,
        archived_at = NULL,
        updated_at = ?
    WHERE id = ?
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

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE project_sessions
    SET unread = ?, updated_at = ?
    WHERE id = ?
  `).run(parsed.unread ? 1 : 0, now, sessionId);
  return getProjectSession(sessionId);
}

export function syncProjectSessionUnreadForThread(
  threadId: string,
): ProjectSessionThreadOwner[] {
  const owners = listProjectSessionThreadOwners(threadId);
  if (owners.length === 0) return owners;
  const database = getDb();
  const now = new Date().toISOString();
  const read = database.prepare(`
    SELECT
      ps.unread AS unread,
      CASE WHEN EXISTS (
        SELECT 1
        FROM project_session_threads pst
        JOIN codex_unread_threads unread ON unread.thread_id = pst.thread_id
        WHERE pst.session_id = ps.id
      ) THEN 1 ELSE 0 END AS expected_unread
    FROM project_sessions ps
    WHERE ps.id = ?
  `);
  const update = database.prepare(`
    UPDATE project_sessions
    SET unread = ?, updated_at = ?
    WHERE id = ?
  `);
  const changedOwners: ProjectSessionThreadOwner[] = [];
  const sync = database.transaction(() => {
    for (const owner of owners) {
      const row = read.get(owner.sessionId) as {
        unread: number;
        expected_unread: number;
      } | undefined;
      if (!row || row.unread === row.expected_unread) continue;
      update.run(row.expected_unread, now, owner.sessionId);
      changedOwners.push(owner);
    }
  });
  sync();
  return changedOwners;
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
  const database = getDb();
  return (database
    .prepare(`
      SELECT *
      FROM project_session_tabs
      WHERE session_id = ?
      ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END ASC, "order" ASC, created_at ASC
    `)
    .all(sessionId) as DbProjectSessionTab[]).map((row) => rowToTab(row, database));
}

export function getProjectSessionTab(tabId: string): ProjectSessionTab | null {
  const row = getDb()
    .prepare("SELECT * FROM project_session_tabs WHERE id = ?")
    .get(tabId) as DbProjectSessionTab | undefined;
  return row ? rowToTab(row) : null;
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

function findDbViewTab(
  session: ProjectSession,
  databaseViewId: string,
  excludedTabId?: string,
): ProjectSessionTab | null {
  return session.tabs.find((tab) =>
    tab.kind === "db_view"
    && tab.id !== excludedTabId
    && "databaseViewId" in tab.config
    && tab.config.databaseViewId === databaseViewId
  ) ?? null;
}

export function createProjectSessionTab(input: ProjectSessionTabCreateInput): ProjectSessionTab {
  const parsed = ProjectSessionTabCreateInputSchema.parse(input);
  const database = getDb();
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  const projectId = parsed.projectId === null ? null : ensureProjectExists(parsed.projectId);
  if (projectId === null && parsed.kind !== "browser") {
    throw new Error("Projectless sessions can only own browser tabs");
  }
  if (session.projectId !== projectId) {
    throw new Error("Tab project must match the owning session project");
  }
  if (parsed.kind === "browser" && parsed.config.projectId !== projectId) {
    throw new Error("Browser tab config project must match the owning session project");
  }
  if (parsed.kind !== "browser" && parsed.browserTabId !== undefined) {
    throw new Error("Only browser tabs can have a browser identity");
  }

  const existingSingleton = findSingletonTab(session, parsed.kind);
  if (existingSingleton) {
    const panels = updatePanelStateForTabs(session, existingSingleton.panelId, session.tabs, existingSingleton.id, {
      collapsed: false,
    });
    persistPanelStates(parsed.sessionId, panels);
    return getProjectSession(parsed.sessionId)?.tabs.find((tab) => tab.id === existingSingleton.id) ?? existingSingleton;
  }

  let config = parsed.config;
  if (parsed.kind === "db_view") {
    if (parsed.config.projectId === null) {
      throw new Error("Database view tabs require a project");
    }
    const resolved = resolveActiveDatabaseViewConfig(
      database,
      parsed.config as ProjectSessionDbViewTabConfig,
    );
    config = resolved;
    const existingDbView = findDbViewTab(session, resolved.databaseViewId);
    if (existingDbView) {
      const panels = updatePanelStateForTabs(session, existingDbView.panelId, session.tabs, existingDbView.id, {
        collapsed: false,
      });
      persistPanelStates(parsed.sessionId, panels);
      return getProjectSession(parsed.sessionId)?.tabs.find((tab) => tab.id === existingDbView.id) ?? existingDbView;
    }
  }

  const now = new Date().toISOString();
  const maxOrder = database
    .prepare('SELECT MAX("order") AS maxOrder FROM project_session_tabs WHERE session_id = ? AND panel_id = ?')
    .get(parsed.sessionId, parsed.panelId) as { maxOrder: number | null } | undefined;
  const id = parsed.clientTabId ?? randomUUID();
  const browserTabId = parsed.kind === "browser"
    ? parsed.browserTabId ?? randomUUID()
    : null;

  const existingTabWithId = database
    .prepare("SELECT id FROM project_session_tabs WHERE id = ?")
    .get(id) as { id: string } | undefined;
  if (existingTabWithId) {
    throw new Error(`Project session tab id already exists: ${id}`);
  }
  database.transaction(() => {
    database.prepare(`
      INSERT INTO project_session_tabs (
        id, session_id, project_id, browser_tab_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '{}', ?, ?, ?)
    `).run(
      id,
      parsed.sessionId,
      projectId,
      browserTabId,
      parsed.panelId,
      parsed.kind,
      parsed.title,
      stringifyProjectSessionTabConfig(projectId, config),
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
    const config = row.kind === "db_view"
      ? resolveActiveDatabaseViewConfig(
        database,
        parsed.config as ProjectSessionDbViewTabConfig,
      )
      : parsed.config;
    if (row.kind === "db_view") {
      const session = getProjectSession(row.session_id);
      const duplicate = session
        ? findDbViewTab(
          session,
          (config as ResolvedProjectSessionDbViewTabConfig).databaseViewId,
          tabId,
        )
        : null;
      if (duplicate) {
        throw new Error(
          `Database View ${(config as ResolvedProjectSessionDbViewTabConfig).databaseViewId} is already open in this session`,
        );
      }
    } else if (row.kind === "browser" && parsed.config.projectId !== row.project_id) {
      throw new Error("Browser tab config project must match the owning session project");
    }
    fields.push("config_json = ?");
    values.push(stringifyProjectSessionTabConfig(row.project_id, config));
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
      removeProjectSessionPanelTab(session.panels[panelId].layout, tabId, {
        preferredActiveLeafId: parsed.preferredActiveLeafId,
        preferredActiveTabId: parsed.preferredActiveTabId,
      }),
      panelTabIds,
      {
        preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
        preferredActiveLeafId: parsed.preferredActiveLeafId,
        preferredActiveTabId: parsed.preferredActiveTabId,
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

export function ensureProjectSessionPanelLeafToRight(
  input: ProjectSessionPanelEnsureRightLeafInput,
): ProjectSessionPanelEnsureRightLeafResult | null {
  const parsed = ProjectSessionPanelEnsureRightLeafInputSchema.parse(input);
  const session = getProjectSession(parsed.sessionId);
  if (!session) return null;

  const panelTabIds = session.tabs.filter((tab) => tab.panelId === parsed.panelId).map((tab) => tab.id);
  const layout = normalizeProjectSessionPanelLayout(
    session.panels[parsed.panelId].layout,
    panelTabIds,
    { preferredActiveLeafId: parsed.sourceLeafId },
  );
  const sourceLeaf = findProjectSessionPanelLeaf(layout, parsed.sourceLeafId);
  if (!sourceLeaf) return null;

  const existingLeafId = findNearestProjectSessionPanelLeafToRight(layout, sourceLeaf.id);
  if (existingLeafId) {
    return {
      session,
      leafId: existingLeafId,
      created: false,
    };
  }

  const leafId = randomUUID();
  const nextLayout = insertProjectSessionPanelLeaf(layout, {
    leafId: sourceLeaf.id,
    side: "right",
    newLeafId: leafId,
    newBranchId: randomUUID(),
  });
  const panels: Record<PanelId, ProjectSessionPanelState> = {
    ...session.panels,
    [parsed.panelId]: {
      ...session.panels[parsed.panelId],
      collapsed: false,
      layout: nextLayout,
    },
  };

  getDb().transaction(() => persistPanelStatesAndOrders(parsed.sessionId, panels, [parsed.panelId]))();
  const nextSession = getProjectSession(parsed.sessionId);
  if (!nextSession) return null;
  return {
    session: nextSession,
    leafId,
    created: true,
  };
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
  const projectId = normalizeProjectSessionProjectId(parsed.projectId);
  const session = getProjectSession(parsed.sessionId);
  if (!session) throw new Error(`Project session not found: ${parsed.sessionId}`);
  if (session.projectId !== projectId) {
    throw new Error("Thread project must match the owning session project");
  }

  const database = getDb();
  const attach = database.transaction((): ProjectSessionThreadLink => {
    const conflictingOwner = listProjectSessionThreadOwners(parsed.threadId)
      .find((owner) => owner.sessionId !== parsed.sessionId);
    if (conflictingOwner) {
      throw new Error(
        `Thread ${parsed.threadId} is already attached to project session ${conflictingOwner.sessionId}`,
      );
    }

    const nowMs = Date.now();
    const linkedAt = new Date().toISOString();
    const existing = getCodexThread(parsed.threadId);
    const hasForkedFromIdInput = Object.prototype.hasOwnProperty.call(parsed, "forkedFromId");
    const hasManagedWorktreePathInput = Object.prototype.hasOwnProperty.call(parsed, "managedWorktreePath");
    upsertCodexThread({
      projectId,
      threadId: parsed.threadId,
      forkedFromId: hasForkedFromIdInput
        ? (parsed.forkedFromId ?? null)
        : (existing?.forkedFromId ?? null),
      source: parsed.parentThreadId
        ? { parentThreadId: parsed.parentThreadId }
        : existing?.source ?? null,
      threadName: parsed.threadName ?? existing?.threadName ?? null,
      threadPreview: parsed.threadPreview ?? existing?.threadPreview ?? "",
      modelProvider: parsed.modelProvider ?? existing?.modelProvider ?? "",
      cwd: parsed.cwd ?? existing?.cwd ?? null,
      managedWorktreePath: hasManagedWorktreePathInput
        ? (parsed.managedWorktreePath ?? null)
        : (existing?.managedWorktreePath ?? null),
      projectlessOutputDirectory: parsed.projectlessOutputDirectory ?? existing?.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: parsed.projectlessWorkspaceBrowserRoot ?? existing?.projectlessWorkspaceBrowserRoot ?? null,
      statusType: parsed.statusType,
      statusActiveFlags: parsed.statusActiveFlags,
      archived: parsed.archived ?? existing?.archived ?? false,
      createdAt: parsed.createdAt ?? existing?.createdAt ?? nowMs,
      updatedAt: parsed.updatedAt ?? nowMs,
      linkedAt: existing?.linkedAt ?? linkedAt,
    });

    database.prepare(`
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

    syncProjectSessionUnreadForThread(parsed.threadId);

    const link = getProjectSession(parsed.sessionId)?.thread;
    if (!link) throw new Error("Unable to attach project session thread");
    return link;
  });

  return attach.immediate();
}

export function detachProjectSessionThread(sessionId: string): boolean {
  const result = getDb().prepare("DELETE FROM project_session_threads WHERE session_id = ?").run(sessionId);
  return result.changes > 0;
}
