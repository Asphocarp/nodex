import { getDb } from "./database";
import type {
  CodexScheduledAutomation,
  CodexScheduledAutomationKind,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpsertInput,
} from "../../shared/types";

interface DbCodexScheduledAutomation {
  automation_id: string;
  kind: string;
  status: string;
  target_thread_id: string | null;
  name: string;
  rrule: string | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) return normalized;
  throw new Error(`${fieldName} is required`);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeKind(kind: CodexScheduledAutomationKind): CodexScheduledAutomationKind {
  if (kind === "cron" || kind === "heartbeat") return kind;
  throw new Error(`Unsupported scheduled automation kind: ${String(kind)}`);
}

function normalizeStatus(status: CodexScheduledAutomationStatus): CodexScheduledAutomationStatus {
  if (status === "ACTIVE" || status === "PAUSED" || status === "DELETED") return status;
  throw new Error(`Unsupported scheduled automation status: ${String(status)}`);
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (Number.isFinite(value)) return Math.trunc(value);
  return null;
}

function rowToAutomation(row: DbCodexScheduledAutomation): CodexScheduledAutomation {
  return {
    id: row.automation_id,
    kind: normalizeKind(row.kind as CodexScheduledAutomationKind),
    status: normalizeStatus(row.status as CodexScheduledAutomationStatus),
    targetThreadId: row.target_thread_id,
    name: row.name,
    rrule: row.rrule,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCodexScheduledAutomations(): CodexScheduledAutomation[] {
  const rows = getDb().prepare(`
    SELECT
      automation_id,
      kind,
      status,
      target_thread_id,
      name,
      rrule,
      next_run_at,
      created_at,
      updated_at
    FROM codex_scheduled_automations
    ORDER BY created_at ASC, automation_id ASC
  `).all() as DbCodexScheduledAutomation[];

  return rows.map(rowToAutomation);
}

export function getCodexScheduledAutomation(automationId: string): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const row = getDb().prepare(`
    SELECT
      automation_id,
      kind,
      status,
      target_thread_id,
      name,
      rrule,
      next_run_at,
      created_at,
      updated_at
    FROM codex_scheduled_automations
    WHERE automation_id = ?
  `).get(normalizedId) as DbCodexScheduledAutomation | undefined;

  return row ? rowToAutomation(row) : null;
}

export function upsertCodexScheduledAutomation(
  input: CodexScheduledAutomationUpsertInput,
): CodexScheduledAutomation {
  const automationId = normalizeId(input.id, "Scheduled automation id");
  const kind = normalizeKind(input.kind);
  const status = normalizeStatus(input.status);
  const targetThreadId = normalizeNullableString(input.targetThreadId);
  const name = normalizeId(input.name, "Scheduled automation name");
  const rrule = normalizeNullableString(input.rrule);
  const nextRunAt = normalizeTimestamp(input.nextRunAt);
  const now = Date.now();
  const createdAt = normalizeTimestamp(input.createdAt) ?? now;
  const updatedAt = normalizeTimestamp(input.updatedAt) ?? now;

  getDb().prepare(`
    INSERT INTO codex_scheduled_automations (
      automation_id,
      kind,
      status,
      target_thread_id,
      name,
      rrule,
      next_run_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(automation_id) DO UPDATE SET
      kind = excluded.kind,
      status = excluded.status,
      target_thread_id = excluded.target_thread_id,
      name = excluded.name,
      rrule = excluded.rrule,
      next_run_at = excluded.next_run_at,
      updated_at = excluded.updated_at
  `).run(
    automationId,
    kind,
    status,
    targetThreadId,
    name,
    rrule,
    nextRunAt,
    createdAt,
    updatedAt,
  );

  const automation = getCodexScheduledAutomation(automationId);
  if (!automation) {
    throw new Error(`Could not read persisted scheduled automation ${automationId}`);
  }

  return automation;
}

export function deleteCodexScheduledAutomation(automationId: string): boolean {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const result = getDb().prepare(`
    DELETE FROM codex_scheduled_automations
    WHERE automation_id = ?
  `).run(normalizedId);

  return result.changes > 0;
}
