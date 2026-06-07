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

interface DbCodexThread {
  project_id: string | null;
  card_id: string | null;
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

export interface UpsertCodexThreadInput {
  projectId?: string | null;
  cardId?: string | null;
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

export interface LinkCodexThreadToCardInput extends UpsertCodexThreadInput {
  projectId: string;
  cardId: string;
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
    cardId: row.card_id,
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
  const nowMs = Date.now();
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : nowMs;
  const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : nowMs;
  const linkedAt = input.linkedAt || new Date().toISOString();

  database.prepare(`
    INSERT INTO codex_threads (
      project_id,
      card_id,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      project_id = COALESCE(excluded.project_id, codex_threads.project_id),
      card_id = COALESCE(excluded.card_id, codex_threads.card_id),
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
    input.projectId ?? null,
    input.cardId ?? null,
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

export function linkCodexThreadToCard(input: LinkCodexThreadToCardInput): CodexThreadSummary {
  const summary = upsertCodexThread(input);
  const linkedAt = input.linkedAt || summary.linkedAt || new Date().toISOString();
  getDb().prepare(`
    INSERT INTO codex_thread_card_links (thread_id, project_id, card_id, linked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      project_id = excluded.project_id,
      card_id = excluded.card_id,
      linked_at = excluded.linked_at
  `).run(input.threadId, input.projectId, input.cardId, linkedAt);
  return getCodexThread(input.threadId) ?? summary;
}

export function getCodexThread(threadId: string): CodexThreadSummary | null {
  const row = getDb().prepare(
    "SELECT * FROM codex_threads WHERE thread_id = ?"
  ).get(threadId) as DbCodexThread | undefined;
  return row ? rowToSummary(row) : null;
}

export function listCodexProjectThreads(
  projectId: string,
  opts?: { cardId?: string; includeArchived?: boolean },
): CodexThreadSummary[] {
  const includeArchived = opts?.includeArchived === true;
  const byCard = opts?.cardId;

  if (byCard) {
    const rows = getDb().prepare(`
      SELECT
        t.thread_id,
        t.project_id,
        COALESCE(t.card_id, l.card_id) AS card_id,
        t.parent_thread_id,
        t.thread_name,
        t.thread_preview,
        t.model_provider,
        t.cwd,
        t.status_type,
        t.status_active_flags_json,
        t.archived,
        t.created_at,
        t.updated_at,
        t.linked_at
      FROM codex_thread_card_links l
      JOIN codex_threads t ON t.thread_id = l.thread_id
      WHERE l.project_id = ?
        AND l.card_id = ?
        AND (? = 1 OR t.archived = 0)
      ORDER BY t.updated_at DESC
    `).all(projectId, byCard, includeArchived ? 1 : 0) as DbCodexThread[];
    return rows.map(rowToSummary);
  }

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

export const getCodexCardThreadLink = getCodexThread;
export const upsertCodexCardThreadLink = linkCodexThreadToCard;
