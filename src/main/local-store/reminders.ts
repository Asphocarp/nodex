import type { PageOccurrence } from "../../shared/types";
import { listPageOccurrences } from "./page-occurrences";
import { getDb } from "./database";
import { listProjects } from "./projects";
import { getLogger } from "../logging/logger";
import { readDueReminderSnoozes } from "./scheduled-page-store";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

const DEFAULT_INTERVAL_MS = 30_000;
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const logger = getLogger({ subsystem: "reminders" });

export interface ReminderNotificationPayload {
  projectId: string;
  pageId: string;
  occurrenceStart: string;
  title: string;
  body: string;
  reminderOffsetMinutes: number;
}

interface PendingReminder {
  projectId: string;
  /** Stable Page projection scope used only by the legacy receipt table. */
  receiptProjectId: string;
  pageId: string;
  occurrenceStart: Date;
  reminderOffsetMinutes: number;
  dueAt: Date;
  title: string;
}

export interface ReminderSchedulerOptions {
  intervalMs?: number;
  onReminder: (payload: ReminderNotificationPayload) => void;
}

function reminderReceiptExists(
  receiptProjectId: string,
  pageId: string,
  occurrenceStart: Date,
  reminderOffsetMinutes: number,
): boolean {
  const existing = getDb().prepare(`
    SELECT id FROM reminder_receipts
    WHERE project_id = ? AND page_id = ? AND occurrence_start = ? AND reminder_offset_minutes = ?
  `).get(receiptProjectId, pageId, occurrenceStart.toISOString(), reminderOffsetMinutes);
  return Boolean(existing);
}

function markReminderDelivered(pending: PendingReminder): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO reminder_receipts (
      project_id, page_id, occurrence_start, reminder_offset_minutes, delivered_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    pending.receiptProjectId,
    pending.pageId,
    pending.occurrenceStart.toISOString(),
    pending.reminderOffsetMinutes,
    new Date().toISOString(),
  );
}

function formatReminderBody(occurrenceStart: Date, offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return "Starts now";
  }
  if (offsetMinutes < 60) {
    return `Starts in ${offsetMinutes} minute${offsetMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(offsetMinutes / 60);
  if (offsetMinutes % 60 === 0 && hours < 24) {
    return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(offsetMinutes / (60 * 24));
  if (offsetMinutes % (60 * 24) === 0) {
    return `Starts in ${days} day${days === 1 ? "" : "s"}`;
  }
  return `Starts at ${occurrenceStart.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function collectPendingForOccurrences(
  projectId: string,
  occurrences: PageOccurrence[],
  now: Date,
): PendingReminder[] {
  const grouped = new Map<string, PendingReminder>();
  const database = getDb();

  for (const occurrence of occurrences) {
    const reminders = occurrence.reminders ?? [];
    for (const reminder of reminders) {
      const dueAt = new Date(occurrence.occurrenceStart.getTime() - reminder.offsetMinutes * 60_000);
      if (dueAt.getTime() > now.getTime()) continue;
      if (dueAt.getTime() < now.getTime() - CATCH_UP_WINDOW_MS) continue;
      const owner = database.prepare(`
        SELECT project_id AS receiptProjectId FROM blocks WHERE id = ?
      `).get(occurrence.pageId) as
        | { readonly receiptProjectId: string }
        | undefined;
      if (!owner) continue;
      if (reminderReceiptExists(owner.receiptProjectId, occurrence.pageId, occurrence.occurrenceStart, reminder.offsetMinutes)) {
        continue;
      }

      const key = `${occurrence.pageId}:${occurrence.occurrenceStart.toISOString()}`;
      const candidate: PendingReminder = {
        projectId,
        receiptProjectId: owner.receiptProjectId,
        pageId: occurrence.pageId,
        occurrenceStart: occurrence.occurrenceStart,
        reminderOffsetMinutes: reminder.offsetMinutes,
        dueAt,
        title: occurrence.title,
      };
      const current = grouped.get(key);
      if (!current || candidate.dueAt.getTime() > current.dueAt.getTime()) {
        grouped.set(key, candidate);
      }
    }
  }

  return [...grouped.values()];
}

async function collectPendingReminders(now: Date): Promise<PendingReminder[]> {
  const projects = listProjects();
  const reminders = new Map<string, PendingReminder>();

  for (const project of projects) {
    if (project.lifecycle !== "active") continue;
    const windowStart = new Date(now.getTime() - CATCH_UP_WINDOW_MS);
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const occurrences = await listPageOccurrences(project.id, windowStart, windowEnd);
    for (const reminder of collectPendingForOccurrences(project.id, occurrences, now)) {
      const key = `${reminder.pageId}:${reminder.occurrenceStart.toISOString()}:${reminder.reminderOffsetMinutes}`;
      const existing = reminders.get(key);
      if (!existing || (
        reminder.projectId === reminder.receiptProjectId &&
        existing.projectId !== existing.receiptProjectId
      )) {
        reminders.set(key, reminder);
      }
    }
  }

  return [...reminders.values()].sort(
    (left, right) => left.dueAt.getTime() - right.dueAt.getTime(),
  );
}

async function processDueSnoozes(now: Date, onReminder: (payload: ReminderNotificationPayload) => void): Promise<void> {
  const database = getDb();
  const rows = readDueReminderSnoozes(database, now);

  for (const row of rows) {
    const occurrenceStart = new Date(row.occurrenceStart);
    if (!reminderReceiptExists(row.receiptProjectId, row.pageId, occurrenceStart, -1)) {
      onReminder({
        projectId: row.projectId,
        pageId: row.pageId,
        occurrenceStart: row.occurrenceStart,
        title: row.title,
        body: "Snoozed reminder",
        reminderOffsetMinutes: -1,
      });
      getDb().prepare(`
        INSERT OR IGNORE INTO reminder_receipts (
          project_id, page_id, occurrence_start, reminder_offset_minutes, delivered_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(row.receiptProjectId, row.pageId, row.occurrenceStart, -1, new Date().toISOString());
    }
    database.prepare("UPDATE reminder_snoozes SET consumed_at = ? WHERE id = ?")
      .run(now.toISOString(), row.id);
  }
}

export async function runReminderTick(onReminder: (payload: ReminderNotificationPayload) => void): Promise<void> {
  const now = new Date();
  const pending = await collectPendingReminders(now);

  logger.debug("Running reminder tick", {
    pendingCount: pending.length,
    now: now.toISOString(),
  });

  for (const reminder of pending) {
    onReminder({
      projectId: reminder.projectId,
      pageId: reminder.pageId,
      occurrenceStart: reminder.occurrenceStart.toISOString(),
      title: reminder.title,
      body: formatReminderBody(reminder.occurrenceStart, reminder.reminderOffsetMinutes),
      reminderOffsetMinutes: reminder.reminderOffsetMinutes,
    });
    markReminderDelivered(reminder);
  }

  await processDueSnoozes(now, onReminder);
}

export async function snoozeReminder(
  projectId: string,
  pageId: string,
  occurrenceStart: string,
  snoozeMinutes: number,
): Promise<void> {
  const database = getDb();
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId,
    resource: { kind: "page", pageId },
    action: "read",
  });
  if (!authorization.allowed || authorization.projectLifecycle !== "active") {
    const reason = authorization.allowed
      ? "project_read_only"
      : authorization.reason;
    throw new Error(`Reminder snooze denied: ${reason}`);
  }
  logger.info("Snoozing reminder", {
    projectId,
    pageId,
    occurrenceStart,
    snoozeMinutes,
  });
  const dueAt = new Date(Date.now() + Math.max(1, snoozeMinutes) * 60_000).toISOString();
  database.prepare(`
    INSERT INTO reminder_snoozes (
      project_id, page_id, occurrence_start, due_at, created_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    projectId,
    pageId,
    occurrenceStart,
    dueAt,
    new Date().toISOString(),
  );
}

export function startReminderScheduler(options: ReminderSchedulerOptions): () => void {
  const intervalMs = Math.max(5_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  logger.info("Starting reminder scheduler", { intervalMs });

  const run = () => {
    void runReminderTick(options.onReminder).catch((error) => {
      logger.error("Reminder tick failed", { error });
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    logger.info("Stopped reminder scheduler");
  };
}
