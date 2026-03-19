import type {
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  CodexThreadSummary,
} from "../../shared/types";
import { getDb } from "../kanban/db-service";

interface DbCodexCardThread {
  project_id: string;
  card_id: string;
  thread_id: string;
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

export interface UpsertCodexCardThreadInput {
  projectId: string;
  cardId: string;
  threadId: string;
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
  return value === "notLoaded" || value === "idle" || value === "systemError" || value === "active";
}

function parseStatusActiveFlags(raw: string): CodexThreadActiveFlag[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is CodexThreadActiveFlag =>
        value === "waitingOnApproval" || value === "waitingOnUserInput",
    );
  } catch {
    return [];
  }
}

function rowToSummary(row: DbCodexCardThread): CodexThreadSummary {
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    cardId: row.card_id,
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

export function upsertCodexCardThreadLink(input: UpsertCodexCardThreadInput): CodexThreadSummary {
  const database = getDb();
  const nowMs = Date.now();
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : nowMs;
  const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : nowMs;
  const linkedAt = input.linkedAt || new Date().toISOString();

  database.prepare(`
    INSERT INTO codex_card_threads (
      project_id,
      card_id,
      thread_id,
      thread_name,
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
      project_id = excluded.project_id,
      card_id = excluded.card_id,
      thread_name = excluded.thread_name,
      thread_preview = excluded.thread_preview,
      model_provider = excluded.model_provider,
      cwd = excluded.cwd,
      status_type = excluded.status_type,
      status_active_flags_json = excluded.status_active_flags_json,
      archived = excluded.archived,
      updated_at = excluded.updated_at,
      linked_at = excluded.linked_at
  `).run(
    input.projectId,
    input.cardId,
    input.threadId,
    input.threadName ?? null,
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

  const record = getCodexCardThreadLink(input.threadId);
  if (!record) {
    throw new Error(`Could not read persisted Codex thread link ${input.threadId}`);
  }
  return record;
}

export function getCodexCardThreadLink(threadId: string): CodexThreadSummary | null {
  const database = getDb();
  const row = database.prepare(
    "SELECT * FROM codex_card_threads WHERE thread_id = ?"
  ).get(threadId) as DbCodexCardThread | undefined;
  if (!row) return null;
  return rowToSummary(row);
}

export function listCodexProjectThreads(
  projectId: string,
  opts?: { cardId?: string; includeArchived?: boolean },
): CodexThreadSummary[] {
  const database = getDb();
  const includeArchived = opts?.includeArchived === true;
  const byCard = opts?.cardId;

  if (byCard) {
    const rows = database.prepare(`
      SELECT * FROM codex_card_threads
      WHERE project_id = ?
        AND card_id = ?
        AND (? = 1 OR archived = 0)
      ORDER BY updated_at DESC
    `).all(projectId, byCard, includeArchived ? 1 : 0) as DbCodexCardThread[];
    return rows.map(rowToSummary);
  }

  const rows = database.prepare(`
    SELECT * FROM codex_card_threads
    WHERE project_id = ?
      AND (? = 1 OR archived = 0)
    ORDER BY updated_at DESC
  `).all(projectId, includeArchived ? 1 : 0) as DbCodexCardThread[];

  return rows.map(rowToSummary);
}

export function listCodexThreadLinks(opts?: { includeArchived?: boolean }): CodexThreadSummary[] {
  const database = getDb();
  const includeArchived = opts?.includeArchived === true;

  const rows = database.prepare(`
    SELECT * FROM codex_card_threads
    WHERE (? = 1 OR archived = 0)
    ORDER BY updated_at DESC
  `).all(includeArchived ? 1 : 0) as DbCodexCardThread[];

  return rows.map(rowToSummary);
}

export function updateCodexThreadName(threadId: string, threadName: string | null): CodexThreadSummary | null {
  const database = getDb();
  const result = database.prepare(
    "UPDATE codex_card_threads SET thread_name = ?, updated_at = ? WHERE thread_id = ?"
  ).run(threadName, Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexCardThreadLink(threadId);
}

export function updateCodexThreadArchived(threadId: string, archived: boolean): CodexThreadSummary | null {
  const database = getDb();
  const result = database.prepare(
    "UPDATE codex_card_threads SET archived = ?, updated_at = ? WHERE thread_id = ?"
  ).run(archived ? 1 : 0, Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexCardThreadLink(threadId);
}

export function updateCodexThreadStatus(
  threadId: string,
  statusType: CodexThreadStatusType,
  statusActiveFlags: CodexThreadActiveFlag[],
): CodexThreadSummary | null {
  const database = getDb();
  const result = database.prepare(
    "UPDATE codex_card_threads SET status_type = ?, status_active_flags_json = ?, updated_at = ? WHERE thread_id = ?"
  ).run(statusType, JSON.stringify(statusActiveFlags), Date.now(), threadId);

  if (result.changes === 0) return null;
  return getCodexCardThreadLink(threadId);
}

export function unlinkCodexThread(threadId: string): boolean {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM codex_card_threads WHERE thread_id = ?")
    .run(threadId);

  return result.changes > 0;
}
