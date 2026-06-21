import type {
  CodexConversationSource,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  CodexThreadSummary,
} from "../../shared/types";
import {
  CodexThreadActiveFlagSchema,
  CodexThreadStatusTypeSchema,
} from "../../shared/schemas/codex";
import { parseJsonStringWithSchema } from "../../shared/schemas/storage";
import { getDb } from "../kanban/db-service";
import { requireProjectId } from "../kanban/project-service";

interface DbCodexThread {
  project_id: string | null;
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

interface DbCodexPinnedThread {
  thread_id: string;
  pinned_order: number;
}

export interface UpsertCodexThreadInput {
  projectId?: string | null;
  threadId: string;
  source?: CodexConversationSource | null;
  threadName?: string | null;
  threadPreview?: string;
  modelProvider?: string;
  cwd?: string | null;
  statusType?: CodexThreadStatusType;
  statusActiveFlags?: CodexThreadActiveFlag[];
  archived?: boolean;
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
    threadPreview: row.thread_preview,
    modelProvider: row.model_provider,
    cwd: row.cwd,
    statusType: isStatusType(row.status_type) ? row.status_type : "notLoaded",
    statusActiveFlags: parseStatusActiveFlags(row.status_active_flags_json),
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkedAt: row.linked_at,
  };
}

export function upsertCodexThread(input: UpsertCodexThreadInput): CodexThreadSummary {
  const database = getDb();
  const projectId = input.projectId ? requireProjectId(input.projectId) : null;
  const nowMs = Date.now();
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : nowMs;
  const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : nowMs;
  const linkedAt = input.linkedAt || new Date().toISOString();

  database.prepare(`
    INSERT INTO codex_threads (
      project_id,
      thread_id,
      thread_name,
      parent_thread_id,
      thread_preview,
      model_provider,
      cwd,
      status_type,
      status_active_flags_json,
      archived,
      created_at,
      updated_at,
      linked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      project_id = COALESCE(excluded.project_id, codex_threads.project_id),
      thread_name = COALESCE(excluded.thread_name, codex_threads.thread_name),
      parent_thread_id = COALESCE(excluded.parent_thread_id, codex_threads.parent_thread_id),
      thread_preview = excluded.thread_preview,
      model_provider = excluded.model_provider,
      cwd = COALESCE(excluded.cwd, codex_threads.cwd),
      status_type = excluded.status_type,
      status_active_flags_json = excluded.status_active_flags_json,
      archived = excluded.archived,
      updated_at = excluded.updated_at,
      linked_at = COALESCE(codex_threads.linked_at, excluded.linked_at)
  `).run(
    projectId,
    input.threadId,
    input.threadName ?? null,
    input.source?.parentThreadId ?? null,
    input.threadPreview ?? "",
    input.modelProvider ?? "",
    input.cwd ?? null,
    input.statusType ?? "notLoaded",
    JSON.stringify(input.statusActiveFlags ?? []),
    input.archived ? 1 : 0,
    createdAt,
    updatedAt,
    linkedAt,
  );

  const record = getCodexThread(input.threadId);
  if (!record) {
    throw new Error(`Could not read persisted Codex thread ${input.threadId}`);
  }
  return record;
}

export function getCodexThread(threadId: string): CodexThreadSummary | null {
  const row = getDb().prepare(
    "SELECT * FROM codex_threads WHERE thread_id = ?"
  ).get(threadId) as DbCodexThread | undefined;
  return row ? rowToSummary(row) : null;
}

export function listCodexProjectThreads(
  projectId: string,
  opts?: { includeArchived?: boolean },
): CodexThreadSummary[] {
  projectId = requireProjectId(projectId);
  const includeArchived = opts?.includeArchived === true;

  const rows = getDb().prepare(`
    SELECT * FROM codex_threads
    WHERE project_id = ?
      AND (? = 1 OR archived = 0)
    ORDER BY updated_at DESC
  `).all(projectId, includeArchived ? 1 : 0) as DbCodexThread[];

  return rows.map(rowToSummary);
}

export function listCodexThreadLinks(opts?: { includeArchived?: boolean }): CodexThreadSummary[] {
  const includeArchived = opts?.includeArchived === true;

  const rows = getDb().prepare(`
    SELECT * FROM codex_threads
    WHERE (? = 1 OR archived = 0)
    ORDER BY updated_at DESC
  `).all(includeArchived ? 1 : 0) as DbCodexThread[];

  return rows.map(rowToSummary);
}

export function listPinnedCodexThreadIds(): string[] {
  const rows = getDb().prepare(`
    SELECT p.thread_id, p.pinned_order
    FROM codex_pinned_threads p
    JOIN codex_threads t ON t.thread_id = p.thread_id
    WHERE t.archived = 0
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
