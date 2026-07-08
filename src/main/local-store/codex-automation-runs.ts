import { getDb } from "./database";
import type {
  CodexAutomationInboxItem,
  CodexAutomationRun,
  CodexAutomationRunStatus,
  CodexAutomationRunUnreadCounts,
} from "../../shared/types";

interface DbCodexAutomationRun {
  thread_id: string;
  automation_id: string;
  status: string;
  read_at: number | null;
  thread_title: string | null;
  source_cwd: string | null;
  inbox_title: string | null;
  inbox_summary: string | null;
  archived_user_message: string | null;
  archived_assistant_message: string | null;
  archived_reason: string | null;
  created_at: number;
  updated_at: number;
}

interface DbCodexAutomationInboxItem {
  id: string;
  automationId: string;
  automationName: string | null;
  title: string | null;
  description: string | null;
  archivedAssistantMessage: string | null;
  archivedUserMessage: string | null;
  archivedReason: string | null;
  sourceCwd: string | null;
  threadId: string;
  readAt: number | null;
  createdAt: number;
  status: string;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatus(value: string): CodexAutomationRunStatus {
  if (
    value === "IN_PROGRESS"
    || value === "PENDING_REVIEW"
    || value === "ACCEPTED"
    || value === "ARCHIVED"
  ) {
    return value;
  }
  throw new Error(`Unsupported automation run status: ${value}`);
}

function rowToAutomationRun(row: DbCodexAutomationRun): CodexAutomationRun {
  return {
    threadId: row.thread_id,
    automationId: row.automation_id,
    status: normalizeStatus(row.status),
    readAt: row.read_at,
    threadTitle: row.thread_title,
    sourceCwd: row.source_cwd,
    inboxTitle: row.inbox_title,
    inboxSummary: row.inbox_summary,
    archivedUserMessage: row.archived_user_message,
    archivedAssistantMessage: row.archived_assistant_message,
    archivedReason: row.archived_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToInboxItem(row: DbCodexAutomationInboxItem): CodexAutomationInboxItem {
  return {
    ...row,
    status: normalizeStatus(row.status),
  };
}

export function insertCodexAutomationRunInProgress(input: {
  threadId: string;
  automationId: string;
  threadTitle?: string | null;
  sourceCwd?: string | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO codex_automation_runs (
      thread_id,
      automation_id,
      status,
      thread_title,
      source_cwd,
      created_at,
      updated_at
    ) VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?, ?)
  `).run(
    input.threadId,
    input.automationId,
    normalizeText(input.threadTitle),
    normalizeText(input.sourceCwd),
    now,
    now,
  );

  return result.changes > 0;
}

export function getCodexAutomationRun(threadId: string): CodexAutomationRun | null {
  const row = getDb().prepare(`
    SELECT *
    FROM codex_automation_runs
    WHERE thread_id = ?
  `).get(threadId) as DbCodexAutomationRun | undefined;
  return row ? rowToAutomationRun(row) : null;
}

export function markCodexAutomationRunAccepted(threadId: string, now = Date.now()): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'ACCEPTED',
        updated_at = ?
    WHERE thread_id = ?
      AND status != 'ARCHIVED'
  `).run(now, threadId).changes > 0;
}

export function markCodexAutomationRunPendingReview(threadId: string, now = Date.now()): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'PENDING_REVIEW',
        updated_at = ?
    WHERE thread_id = ?
      AND status = 'IN_PROGRESS'
  `).run(now, threadId).changes > 0;
}

export function settleInterruptedCodexAutomationRuns(now = Date.now()): {
  archivedPendingCount: number;
  pendingReviewCount: number;
} {
  const archivedPending = getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'ARCHIVED',
        updated_at = ?,
        archived_reason = COALESCE(archived_reason, 'auto')
    WHERE status = 'IN_PROGRESS'
      AND thread_id LIKE 'pending:%'
  `).run(now);
  const pendingReview = getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'PENDING_REVIEW',
        updated_at = ?
    WHERE status = 'IN_PROGRESS'
  `).run(now);

  return {
    archivedPendingCount: archivedPending.changes,
    pendingReviewCount: pendingReview.changes,
  };
}

export function archiveCodexAutomationRun(
  threadId: string,
  archivedReason?: string | null,
  now = Date.now(),
): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'ARCHIVED',
        updated_at = ?,
        archived_reason = COALESCE(archived_reason, ?)
    WHERE thread_id = ?
  `).run(now, normalizeText(archivedReason), threadId).changes > 0;
}

export function unarchiveCodexAutomationRun(threadId: string, now = Date.now()): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET status = 'ACCEPTED',
        read_at = COALESCE(read_at, ?),
        updated_at = ?,
        archived_reason = NULL
    WHERE thread_id = ?
      AND status = 'ARCHIVED'
  `).run(now, now, threadId).changes > 0;
}

export function captureCodexAutomationArchiveMessages(input: {
  threadId: string;
  archivedUserMessage?: string | null;
  archivedAssistantMessage?: string | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET archived_user_message = ?,
        archived_assistant_message = ?,
        updated_at = ?
    WHERE thread_id = ?
  `).run(
    normalizeText(input.archivedUserMessage),
    normalizeText(input.archivedAssistantMessage),
    now,
    input.threadId,
  ).changes > 0;
}

export function setCodexAutomationRunThreadTitle(
  threadId: string,
  threadTitle: string | null,
  now = Date.now(),
): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET thread_title = ?,
        updated_at = ?
    WHERE thread_id = ?
  `).run(normalizeText(threadTitle), now, threadId).changes > 0;
}

export function setCodexAutomationRunInboxItem(input: {
  threadId: string;
  inboxTitle?: string | null;
  inboxSummary?: string | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET inbox_title = ?,
        inbox_summary = ?,
        status = CASE WHEN status = 'IN_PROGRESS' THEN 'PENDING_REVIEW' ELSE status END,
        updated_at = ?
    WHERE thread_id = ?
  `).run(
    normalizeText(input.inboxTitle),
    normalizeText(input.inboxSummary),
    now,
    input.threadId,
  ).changes > 0;
}

export function replacePendingCodexAutomationRunThreadId(input: {
  pendingThreadId: string;
  threadId: string;
  now?: number;
}): boolean {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET thread_id = ?,
        updated_at = ?
    WHERE thread_id = ?
  `).run(input.threadId, input.now ?? Date.now(), input.pendingThreadId).changes > 0;
}

export function deleteCodexAutomationRun(threadId: string): boolean {
  return getDb().prepare(`
    DELETE FROM codex_automation_runs
    WHERE thread_id = ?
  `).run(threadId).changes > 0;
}

export function deleteCodexAutomationRunsForAutomation(automationId: string): number {
  return getDb().prepare(`
    DELETE FROM codex_automation_runs
    WHERE automation_id = ?
  `).run(automationId).changes;
}

export function listCodexAutomationInboxItems(limit = 100): CodexAutomationInboxItem[] {
  const rows = getDb().prepare(`
    SELECT
      runs.thread_id as id,
      runs.automation_id as automationId,
      automations.name as automationName,
      COALESCE(
        automations.name,
        NULLIF(runs.inbox_title, ''),
        runs.thread_title
      ) as title,
      COALESCE(
        NULLIF(runs.inbox_summary, ''),
        runs.archived_assistant_message,
        runs.archived_user_message,
        automations.prompt
      ) as description,
      runs.archived_assistant_message as archivedAssistantMessage,
      runs.archived_user_message as archivedUserMessage,
      runs.archived_reason as archivedReason,
      runs.source_cwd as sourceCwd,
      runs.thread_id as threadId,
      runs.read_at as readAt,
      runs.created_at as createdAt,
      runs.status as status
    FROM codex_automation_runs runs
    JOIN codex_scheduled_automations automations
      ON automations.automation_id = runs.automation_id
    WHERE runs.status IN ('IN_PROGRESS', 'PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED')
    ORDER BY
      runs.status = 'IN_PROGRESS' DESC,
      runs.status = 'PENDING_REVIEW' DESC,
      runs.created_at DESC
    LIMIT ?
  `).all(limit) as DbCodexAutomationInboxItem[];

  return rows.map(rowToInboxItem);
}

export function getCodexAutomationRunUnreadCounts(): CodexAutomationRunUnreadCounts {
  const rows = getDb().prepare(`
    SELECT
      automation_id as automationId,
      thread_id as threadId
    FROM codex_automation_runs
    WHERE read_at IS NULL
      AND status IN ('PENDING_REVIEW', 'ACCEPTED')
      AND automation_id IN (
        SELECT automation_id
        FROM codex_scheduled_automations
      )
  `).all() as Array<{ automationId: string; threadId: string }>;

  return {
    total: rows.length,
    automationIds: [...new Set(rows.map((row) => row.automationId))],
    unreadRuns: rows,
  };
}

export function setCodexAutomationRunReadAt(
  threadId: string,
  readAt: number | null,
): CodexAutomationInboxItem | null {
  const row = getDb().prepare(`
    UPDATE codex_automation_runs
    SET read_at = ?
    WHERE thread_id = ?
    RETURNING
      thread_id as id,
      automation_id as automationId,
      NULL as automationName,
      inbox_title as title,
      inbox_summary as description,
      archived_assistant_message as archivedAssistantMessage,
      archived_user_message as archivedUserMessage,
      archived_reason as archivedReason,
      source_cwd as sourceCwd,
      thread_id as threadId,
      read_at as readAt,
      created_at as createdAt,
      status as status
  `).get(readAt, threadId) as DbCodexAutomationInboxItem | undefined;

  return row ? rowToInboxItem(row) : null;
}

export function markAllCodexAutomationRunsRead(readAt = Date.now()): number {
  return getDb().prepare(`
    UPDATE codex_automation_runs
    SET read_at = ?
    WHERE read_at IS NULL
      AND status IN ('PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED')
      AND updated_at <= ?
      AND automation_id IN (
        SELECT automation_id
        FROM codex_scheduled_automations
      )
  `).run(readAt, readAt).changes;
}
