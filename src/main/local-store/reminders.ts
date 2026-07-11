import type { CalendarOccurrence } from "../../shared/types";
import { listCalendarOccurrences } from "./card-occurrences";
import { getDb } from "./database";
import { listProjects } from "./projects";
import { getLogger } from "../logging/logger";
import { readDueReminderSnoozes } from "./scheduled-card-store";

const DEFAULT_INTERVAL_MS = 30_000;
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const logger = getLogger({ subsystem: "reminders" });

export interface ReminderNotificationPayload {
  projectId: string;
  cardId: string;
  occurrenceStart: string;
  title: string;
  body: string;
  reminderOffsetMinutes: number;
}

interface PendingReminder {
  projectId: string;
  cardId: string;
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
  projectId: string,
  cardId: string,
  occurrenceStart: Date,
  reminderOffsetMinutes: number,
): boolean {
  const existing = getDb().prepare(`
    SELECT id FROM reminder_receipts
    WHERE project_id = ? AND card_id = ? AND occurrence_start = ? AND reminder_offset_minutes = ?
  `).get(projectId, cardId, occurrenceStart.toISOString(), reminderOffsetMinutes);
  return Boolean(existing);
}

function markReminderDelivered(pending: PendingReminder): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO reminder_receipts (
      project_id, card_id, occurrence_start, reminder_offset_minutes, delivered_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    pending.projectId,
    pending.cardId,
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
  occurrences: CalendarOccurrence[],
  now: Date,
): PendingReminder[] {
  const grouped = new Map<string, PendingReminder>();

  for (const occurrence of occurrences) {
    const reminders = occurrence.reminders ?? [];
    for (const reminder of reminders) {
      const dueAt = new Date(occurrence.occurrenceStart.getTime() - reminder.offsetMinutes * 60_000);
      if (dueAt.getTime() > now.getTime()) continue;
      if (dueAt.getTime() < now.getTime() - CATCH_UP_WINDOW_MS) continue;
      if (reminderReceiptExists(projectId, occurrence.cardId, occurrence.occurrenceStart, reminder.offsetMinutes)) {
        continue;
      }

      const key = `${projectId}:${occurrence.cardId}:${occurrence.occurrenceStart.toISOString()}`;
      const candidate: PendingReminder = {
        projectId,
        cardId: occurrence.cardId,
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
  const reminders: PendingReminder[] = [];

  for (const project of projects) {
    const windowStart = new Date(now.getTime() - CATCH_UP_WINDOW_MS);
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const occurrences = await listCalendarOccurrences(project.id, windowStart, windowEnd);
    reminders.push(...collectPendingForOccurrences(project.id, occurrences, now));
  }

  return reminders.sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
}

async function processDueSnoozes(now: Date, onReminder: (payload: ReminderNotificationPayload) => void): Promise<void> {
  const database = getDb();
  const rows = readDueReminderSnoozes(database, now);

  for (const row of rows) {
    const occurrenceStart = new Date(row.occurrenceStart);
    if (!reminderReceiptExists(row.projectId, row.cardId, occurrenceStart, -1)) {
      onReminder({
        projectId: row.projectId,
        cardId: row.cardId,
        occurrenceStart: row.occurrenceStart,
        title: row.title,
        body: "Snoozed reminder",
        reminderOffsetMinutes: -1,
      });
      getDb().prepare(`
        INSERT OR IGNORE INTO reminder_receipts (
          project_id, card_id, occurrence_start, reminder_offset_minutes, delivered_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(row.projectId, row.cardId, row.occurrenceStart, -1, new Date().toISOString());
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
      cardId: reminder.cardId,
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
  cardId: string,
  occurrenceStart: string,
  snoozeMinutes: number,
): Promise<void> {
  logger.info("Snoozing reminder", {
    projectId,
    cardId,
    occurrenceStart,
    snoozeMinutes,
  });
  const dueAt = new Date(Date.now() + Math.max(1, snoozeMinutes) * 60_000).toISOString();
  getDb().prepare(`
    INSERT INTO reminder_snoozes (
      project_id, card_id, occurrence_start, due_at, created_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    projectId,
    cardId,
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
