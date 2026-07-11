import type {
  CodexConversationSource,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  CodexThreadSummary,
} from "../../shared/types";
import type { ThreadSource } from "@nodex/codex-app-server-protocol/v2/ThreadSource";
import {
  CodexThreadActiveFlagSchema,
  CodexThreadStatusTypeSchema,
} from "../../shared/schemas/codex";
import { parseJsonStringWithSchema } from "../../shared/schemas/storage";
import { getDb } from "../local-store/database";
import { requireProjectId } from "../local-store/projects";

interface DbCodexThread {
  project_id: string | null;
  thread_id: string;
  parent_thread_id: string | null;
  thread_name: string | null;
  thread_source: string | null;
  agent_nickname: string | null;
  agent_role: string | null;
  thread_preview: string;
  model_provider: string;
  cwd: string | null;
  managed_worktree_path: string | null;
  projectless_output_directory: string | null;
  projectless_workspace_browser_root: string | null;
  status_type: string;
  status_active_flags_json: string;
  archived: number;
  pinned: number;
  created_at: number;
  updated_at: number;
  linked_at: string;
}

interface DbCodexPinnedThread {
  thread_id: string;
  pinned_order: number;
}

const CODEX_THREAD_SUMMARY_COLUMNS = `
  t.project_id,
  t.thread_id,
  t.parent_thread_id,
  t.thread_name,
  t.thread_source,
  t.agent_nickname,
  t.agent_role,
  t.thread_preview,
  t.model_provider,
  t.cwd,
  t.managed_worktree_path,
  t.projectless_output_directory,
  t.projectless_workspace_browser_root,
  t.status_type,
  t.status_active_flags_json,
  t.archived,
  CASE WHEN p.thread_id IS NULL THEN 0 ELSE 1 END AS pinned,
  t.created_at,
  t.updated_at,
  t.linked_at
`;

export interface UpsertCodexThreadInput {
  projectId?: string | null;
  threadId: string;
  source?: CodexConversationSource | null;
  threadSource?: ThreadSource | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  threadName?: string | null;
  threadPreview?: string;
  modelProvider?: string;
  cwd?: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
  statusType?: CodexThreadStatusType;
  statusActiveFlags?: CodexThreadActiveFlag[];
  archived?: boolean;
  pinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
  linkedAt?: string;
}

function isStatusType(value: string): value is CodexThreadStatusType {
  return CodexThreadStatusTypeSchema.safeParse(value).success;
}

function parseStatusActiveFlags(raw: string): CodexThreadActiveFlag[] {
  return parseJsonStringWithSchema(raw, CodexThreadActiveFlagSchema.array(), []);
}

function rowToSummary(row: DbCodexThread): CodexThreadSummary {
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    source: row.parent_thread_id
      ? { parentThreadId: row.parent_thread_id }
      : null,
    threadName: row.thread_name,
    threadSource: row.thread_source,
    agentNickname: row.agent_nickname,
    agentRole: row.agent_role,
    threadPreview: row.thread_preview,
    modelProvider: row.model_provider,
    cwd: row.cwd,
    managedWorktreePath: row.managed_worktree_path,
    projectlessOutputDirectory: row.projectless_output_directory,
    projectlessWorkspaceBrowserRoot: row.projectless_workspace_browser_root,
    statusType: isStatusType(row.status_type) ? row.status_type : "notLoaded",
    statusActiveFlags: parseStatusActiveFlags(row.status_active_flags_json),
    archived: row.archived === 1,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkedAt: row.linked_at,
  };
}

export function upsertCodexThread(input: UpsertCodexThreadInput): CodexThreadSummary {
  const database = getDb();
  const hasProjectIdInput = Object.prototype.hasOwnProperty.call(input, "projectId");
  const hasThreadSourceInput = Object.prototype.hasOwnProperty.call(input, "threadSource");
  const hasAgentNicknameInput = Object.prototype.hasOwnProperty.call(input, "agentNickname");
  const hasAgentRoleInput = Object.prototype.hasOwnProperty.call(input, "agentRole");
  const hasManagedWorktreePathInput = Object.prototype.hasOwnProperty.call(input, "managedWorktreePath");
  const hasArchivedInput = Object.prototype.hasOwnProperty.call(input, "archived");
  const hasProjectlessOutputDirectoryInput = Object.prototype.hasOwnProperty.call(input, "projectlessOutputDirectory");
  const hasProjectlessWorkspaceBrowserRootInput = Object.prototype.hasOwnProperty.call(input, "projectlessWorkspaceBrowserRoot");
  const projectId = hasProjectIdInput && input.projectId ? requireProjectId(input.projectId) : null;
  const nowMs = Date.now();
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : nowMs;
  const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : nowMs;
  const linkedAt = input.linkedAt || new Date().toISOString();

  database.prepare(`
    INSERT INTO codex_threads (
      project_id,
      thread_id,
      thread_name,
      thread_source,
      agent_nickname,
      agent_role,
      parent_thread_id,
      thread_preview,
      model_provider,
      cwd,
      managed_worktree_path,
      projectless_output_directory,
      projectless_workspace_browser_root,
      status_type,
      status_active_flags_json,
      archived,
      created_at,
      updated_at,
      linked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      project_id = CASE WHEN ? = 1 THEN excluded.project_id ELSE codex_threads.project_id END,
      thread_name = COALESCE(excluded.thread_name, codex_threads.thread_name),
      thread_source = CASE WHEN ? = 1 THEN excluded.thread_source ELSE codex_threads.thread_source END,
      agent_nickname = CASE WHEN ? = 1 THEN excluded.agent_nickname ELSE codex_threads.agent_nickname END,
      agent_role = CASE WHEN ? = 1 THEN excluded.agent_role ELSE codex_threads.agent_role END,
      parent_thread_id = COALESCE(excluded.parent_thread_id, codex_threads.parent_thread_id),
      thread_preview = excluded.thread_preview,
      model_provider = excluded.model_provider,
      cwd = COALESCE(excluded.cwd, codex_threads.cwd),
      managed_worktree_path = CASE WHEN ? = 1 THEN excluded.managed_worktree_path ELSE codex_threads.managed_worktree_path END,
      projectless_output_directory = CASE WHEN ? = 1 THEN excluded.projectless_output_directory ELSE codex_threads.projectless_output_directory END,
      projectless_workspace_browser_root = CASE WHEN ? = 1 THEN excluded.projectless_workspace_browser_root ELSE codex_threads.projectless_workspace_browser_root END,
      status_type = excluded.status_type,
      status_active_flags_json = excluded.status_active_flags_json,
      archived = CASE WHEN ? = 1 THEN excluded.archived ELSE codex_threads.archived END,
      updated_at = excluded.updated_at,
      linked_at = COALESCE(codex_threads.linked_at, excluded.linked_at)
  `).run(
    projectId,
    input.threadId,
    input.threadName ?? null,
    input.threadSource ?? null,
    input.agentNickname ?? null,
    input.agentRole ?? null,
    input.source?.parentThreadId ?? null,
    input.threadPreview ?? "",
    input.modelProvider ?? "",
    input.cwd ?? null,
    input.managedWorktreePath ?? null,
    input.projectlessOutputDirectory ?? null,
    input.projectlessWorkspaceBrowserRoot ?? null,
    input.statusType ?? "notLoaded",
    JSON.stringify(input.statusActiveFlags ?? []),
    input.archived ? 1 : 0,
    createdAt,
    updatedAt,
    linkedAt,
    hasProjectIdInput ? 1 : 0,
    hasThreadSourceInput ? 1 : 0,
    hasAgentNicknameInput ? 1 : 0,
    hasAgentRoleInput ? 1 : 0,
    hasManagedWorktreePathInput ? 1 : 0,
    hasProjectlessOutputDirectoryInput ? 1 : 0,
    hasProjectlessWorkspaceBrowserRootInput ? 1 : 0,
    hasArchivedInput ? 1 : 0,
  );
  if (Object.prototype.hasOwnProperty.call(input, "pinned")) {
    setCodexThreadPinned(input.threadId, input.pinned === true);
  }

  const record = getCodexThread(input.threadId);
  if (!record) {
    throw new Error(`Could not read persisted Codex thread ${input.threadId}`);
  }
  return record;
}

export function getCodexThread(threadId: string): CodexThreadSummary | null {
  const row = getDb().prepare(`
    SELECT ${CODEX_THREAD_SUMMARY_COLUMNS}
    FROM codex_threads t
    LEFT JOIN codex_pinned_threads p ON p.thread_id = t.thread_id
    WHERE t.thread_id = ?
  `).get(threadId) as DbCodexThread | undefined;
  return row ? rowToSummary(row) : null;
}

export function listCodexProjectThreads(
  projectId: string,
  opts?: { includeArchived?: boolean },
): CodexThreadSummary[] {
  projectId = requireProjectId(projectId);
  const includeArchived = opts?.includeArchived === true;

  const rows = getDb().prepare(`
    SELECT ${CODEX_THREAD_SUMMARY_COLUMNS}
    FROM codex_threads t
    LEFT JOIN codex_pinned_threads p ON p.thread_id = t.thread_id
    WHERE t.project_id = ?
      AND t.parent_thread_id IS NULL
      AND (? = 1 OR t.archived = 0)
    ORDER BY t.updated_at DESC
  `).all(projectId, includeArchived ? 1 : 0) as DbCodexThread[];

  return rows.map(rowToSummary);
}

export function listCodexThreadLinks(opts?: { includeArchived?: boolean }): CodexThreadSummary[] {
  const includeArchived = opts?.includeArchived === true;

  const rows = getDb().prepare(`
    SELECT ${CODEX_THREAD_SUMMARY_COLUMNS}
    FROM codex_threads t
    LEFT JOIN codex_pinned_threads p ON p.thread_id = t.thread_id
    WHERE t.parent_thread_id IS NULL
      AND (? = 1 OR t.archived = 0)
    ORDER BY t.updated_at DESC
  `).all(includeArchived ? 1 : 0) as DbCodexThread[];

  return rows.map(rowToSummary);
}

export function listCodexChildThreadLinks(parentThreadId: string): CodexThreadSummary[] {
  const normalizedParentThreadId = typeof parentThreadId === "string" ? parentThreadId.trim() : "";
  if (!normalizedParentThreadId) return [];

  const rows = getDb().prepare(`
    SELECT ${CODEX_THREAD_SUMMARY_COLUMNS}
    FROM codex_threads t
    LEFT JOIN codex_pinned_threads p ON p.thread_id = t.thread_id
    WHERE t.parent_thread_id = ?
      AND t.archived = 0
    ORDER BY t.created_at ASC, t.thread_id ASC
  `).all(normalizedParentThreadId) as DbCodexThread[];

  return rows.map(rowToSummary);
}

export function listPinnedCodexThreadIds(): string[] {
  const rows = getDb().prepare(`
    SELECT p.thread_id, p.pinned_order
    FROM codex_pinned_threads p
    JOIN codex_threads t ON t.thread_id = p.thread_id
    WHERE t.archived = 0
      AND t.parent_thread_id IS NULL
    ORDER BY p.pinned_order ASC, p.created_at ASC, p.thread_id ASC
  `).all() as DbCodexPinnedThread[];

  return rows.map((row) => row.thread_id);
}

export function setCodexThreadPinned(threadId: string, pinned: boolean): string[] {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return listPinnedCodexThreadIds();

  const database = getDb();
  if (!pinned) {
    database.prepare("DELETE FROM codex_pinned_threads WHERE thread_id = ?").run(normalizedThreadId);
    return listPinnedCodexThreadIds();
  }

  const existing = database
    .prepare("SELECT pinned_order FROM codex_pinned_threads WHERE thread_id = ?")
    .get(normalizedThreadId) as { pinned_order: number } | undefined;
  if (existing) return listPinnedCodexThreadIds();

  const maxPinned = database
    .prepare("SELECT MAX(pinned_order) AS maxPinnedOrder FROM codex_pinned_threads")
    .get() as { maxPinnedOrder: number | null } | undefined;
  const now = new Date().toISOString();

  database.prepare(`
    INSERT OR IGNORE INTO codex_pinned_threads (
      thread_id,
      pinned_order,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(
    normalizedThreadId,
    (maxPinned?.maxPinnedOrder ?? -1) + 1,
    now,
    now,
  );

  return listPinnedCodexThreadIds();
}

export function updateCodexThreadName(threadId: string, threadName: string | null): CodexThreadSummary | null {
  const result = getDb().prepare(
    "UPDATE codex_threads SET thread_name = ?, updated_at = ? WHERE thread_id = ?"
  ).run(threadName, Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexThread(threadId);
}

export function updateCodexThreadArchived(threadId: string, archived: boolean): CodexThreadSummary | null {
  const result = getDb().prepare(
    "UPDATE codex_threads SET archived = ?, updated_at = ? WHERE thread_id = ?"
  ).run(archived ? 1 : 0, Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexThread(threadId);
}

export function updateCodexThreadPinned(threadId: string, pinned: boolean): CodexThreadSummary | null {
  const existing = getCodexThread(threadId);
  if (!existing) return null;
  setCodexThreadPinned(threadId, pinned);
  return getCodexThread(threadId);
}

export function updateCodexThreadStatus(
  threadId: string,
  statusType: CodexThreadStatusType,
  statusActiveFlags: CodexThreadActiveFlag[],
): CodexThreadSummary | null {
  const result = getDb().prepare(
    "UPDATE codex_threads SET status_type = ?, status_active_flags_json = ?, updated_at = ? WHERE thread_id = ?"
  ).run(statusType, JSON.stringify(statusActiveFlags), Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexThread(threadId);
}

export function unlinkCodexThread(threadId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM codex_threads WHERE thread_id = ?")
    .run(threadId);

  return result.changes > 0;
}
