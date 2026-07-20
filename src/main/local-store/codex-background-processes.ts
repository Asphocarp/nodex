import { getDb } from "./database";
import type {
  CodexBackgroundProcessRecord,
  CodexBackgroundProcessRecordSource,
} from "../../shared/types";
export { makeCodexBackgroundProcessRecordId } from "../../shared/codex-background-processes";

const MAX_BACKGROUND_PROCESS_RECORDS = 200;

interface DbCodexBackgroundProcessRecord {
  process_record_id: string;
  thread_id: string;
  thread_title: string | null;
  item_id: string;
  turn_id: string | null;
  command: string;
  cwd: string | null;
  app_server_process_id: string | null;
  os_pid: number | null;
  terminal_session_id: string | null;
  source: string;
  started_at_ms: number;
  updated_at_ms: number;
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) return normalized;
  throw new Error(`${fieldName} is required`);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTimestamp(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function normalizeSource(source: CodexBackgroundProcessRecordSource): CodexBackgroundProcessRecordSource {
  if (source === "app-server" || source === "terminal-action") return source;
  throw new Error(`Unsupported background process source: ${String(source)}`);
}

function normalizeOsPid(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function rowToRecord(row: DbCodexBackgroundProcessRecord): CodexBackgroundProcessRecord {
  return {
    id: row.process_record_id,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    itemId: row.item_id,
    turnId: row.turn_id,
    command: row.command,
    cwd: row.cwd,
    processId: row.app_server_process_id,
    osPid: row.os_pid,
    terminalSessionId: row.terminal_session_id,
    source: normalizeSource(row.source as CodexBackgroundProcessRecordSource),
    startedAtMs: row.started_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function pruneBackgroundProcessRecords(): void {
  getDb().prepare(`
    DELETE FROM codex_background_processes
    WHERE process_record_id NOT IN (
      SELECT process_record_id
      FROM codex_background_processes
      ORDER BY updated_at_ms DESC, process_record_id ASC
      LIMIT ?
    )
  `).run(MAX_BACKGROUND_PROCESS_RECORDS);
}

export function listCodexBackgroundProcesses(threadId?: string | null): CodexBackgroundProcessRecord[] {
  const normalizedThreadId = normalizeNullableString(threadId);
  const rows = normalizedThreadId
    ? getDb().prepare(`
      SELECT
        process_record_id,
        thread_id,
        thread_title,
        item_id,
        turn_id,
        command,
        cwd,
        app_server_process_id,
        os_pid,
        terminal_session_id,
        source,
        started_at_ms,
        updated_at_ms
      FROM codex_background_processes
      WHERE thread_id = ?
      ORDER BY updated_at_ms DESC, process_record_id ASC
    `).all(normalizedThreadId) as DbCodexBackgroundProcessRecord[]
    : getDb().prepare(`
      SELECT
        process_record_id,
        thread_id,
        thread_title,
        item_id,
        turn_id,
        command,
        cwd,
        app_server_process_id,
        os_pid,
        terminal_session_id,
        source,
        started_at_ms,
        updated_at_ms
      FROM codex_background_processes
      ORDER BY updated_at_ms DESC, process_record_id ASC
    `).all() as DbCodexBackgroundProcessRecord[];

  return rows.map(rowToRecord);
}

export function upsertCodexBackgroundProcess(
  input: CodexBackgroundProcessRecord,
  options: { preserveStartedAt?: boolean } = {},
): CodexBackgroundProcessRecord {
  const now = Date.now();
  const id = normalizeRequiredString(input.id, "Background process record id");
  const threadId = normalizeRequiredString(input.threadId, "Thread id");
  const itemId = normalizeRequiredString(input.itemId, "Process item id");
  const command = normalizeRequiredString(input.command, "Process command");
  const source = normalizeSource(input.source);
  const startedAtMs = normalizeTimestamp(input.startedAtMs, now);
  const updatedAtMs = normalizeTimestamp(input.updatedAtMs, now);
  const preserveStartedAt = options.preserveStartedAt ?? true;

  getDb().prepare(`
    INSERT INTO codex_background_processes (
      process_record_id,
      thread_id,
      thread_title,
      item_id,
      turn_id,
      command,
      cwd,
      app_server_process_id,
      os_pid,
      terminal_session_id,
      source,
      started_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(process_record_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      thread_title = COALESCE(excluded.thread_title, codex_background_processes.thread_title),
      item_id = excluded.item_id,
      turn_id = COALESCE(excluded.turn_id, codex_background_processes.turn_id),
      command = excluded.command,
      cwd = COALESCE(excluded.cwd, codex_background_processes.cwd),
      app_server_process_id = COALESCE(excluded.app_server_process_id, codex_background_processes.app_server_process_id),
      os_pid = COALESCE(excluded.os_pid, codex_background_processes.os_pid),
      terminal_session_id = COALESCE(excluded.terminal_session_id, codex_background_processes.terminal_session_id),
      source = excluded.source,
      started_at_ms = CASE WHEN ? THEN codex_background_processes.started_at_ms ELSE excluded.started_at_ms END,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    id,
    threadId,
    normalizeNullableString(input.threadTitle),
    itemId,
    normalizeNullableString(input.turnId),
    command,
    normalizeNullableString(input.cwd),
    normalizeNullableString(input.processId),
    normalizeOsPid(input.osPid),
    normalizeNullableString(input.terminalSessionId),
    source,
    startedAtMs,
    updatedAtMs,
    preserveStartedAt ? 1 : 0,
  );

  pruneBackgroundProcessRecords();

  const record = listCodexBackgroundProcesses(threadId).find((candidate) => candidate.id === id);
  if (!record) {
    throw new Error(`Could not read persisted background process ${id}`);
  }
  return record;
}
