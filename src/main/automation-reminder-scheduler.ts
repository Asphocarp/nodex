import type {
  DesktopAutomationModulePort,
  DesktopReminderClaim,
} from "./core-client/desktop-automation-module-bridge";
import { getLogger } from "./logging/logger";
import {
  formatReminderBody,
  type ReminderNotificationPayload,
} from "./reminder-notification";

export const AUTOMATION_REMINDER_SCHEDULER_INTERVAL_MS = 30_000;
export const AUTOMATION_REMINDER_SCHEDULER_MAX_PER_TICK = 100;
export const AUTOMATION_REMINDER_LEASE_DURATION_MS = 2 * 60_000;
export const AUTOMATION_REMINDER_RETRY_DELAY_MS = 30_000;

type ReminderAuthority = Pick<
  DesktopAutomationModulePort,
  | "claimDueReminders"
  | "completeReminderLease"
  | "failReminderLease"
>;

interface ReminderSchedulerLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

type ReminderSchedulerTimer = ReturnType<typeof setInterval> & {
  unref?: () => void;
};

export interface StartAutomationReminderSchedulerOptions {
  readonly automation: ReminderAuthority;
  readonly onReminder: (
    payload: ReminderNotificationPayload,
  ) => void | Promise<void>;
  readonly intervalMs?: number;
  readonly maxPerTick?: number;
  readonly leaseDurationMs?: number;
  readonly retryDelayMs?: number;
  readonly setIntervalImpl?: (
    callback: () => void,
    milliseconds: number,
  ) => ReminderSchedulerTimer;
  readonly clearIntervalImpl?: (timer: ReminderSchedulerTimer) => void;
  readonly logger?: ReminderSchedulerLogger;
}

export interface AutomationReminderScheduler {
  readonly runNow: () => Promise<void>;
  readonly dispose: () => void;
}

const toNotification = (
  claim: DesktopReminderClaim,
): ReminderNotificationPayload => {
  const occurrenceStart = new Date(claim.occurrenceStart);
  if (!Number.isFinite(occurrenceStart.getTime())) {
    throw new Error("Reminder claim occurrence start is invalid");
  }
  return {
    projectId: claim.projectId,
    pageId: claim.pageId,
    occurrenceStart: occurrenceStart.toISOString(),
    title: claim.title,
    body: formatReminderBody(
      occurrenceStart,
      claim.reminderOffsetMinutes,
    ),
    reminderOffsetMinutes: claim.reminderOffsetMinutes,
  };
};

export function startAutomationReminderScheduler(
  options: StartAutomationReminderSchedulerOptions,
): AutomationReminderScheduler {
  const intervalMs = Math.max(
    5_000,
    options.intervalMs ?? AUTOMATION_REMINDER_SCHEDULER_INTERVAL_MS,
  );
  const maxPerTick = Math.max(
    1,
    Math.trunc(options.maxPerTick ?? AUTOMATION_REMINDER_SCHEDULER_MAX_PER_TICK),
  );
  const leaseDurationMs = Math.max(
    intervalMs,
    Math.trunc(options.leaseDurationMs ?? AUTOMATION_REMINDER_LEASE_DURATION_MS),
  );
  const retryDelayMs = Math.max(
    0,
    Math.trunc(options.retryDelayMs ?? AUTOMATION_REMINDER_RETRY_DELAY_MS),
  );
  const logger = options.logger
    ?? getLogger({ subsystem: "automation-reminders" });
  const setIntervalImpl = options.setIntervalImpl
    ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
  const clearIntervalImpl = options.clearIntervalImpl
    ?? ((timer) => clearInterval(timer));
  let disposed = false;
  let running = false;

  const deliver = async (claim: DesktopReminderClaim): Promise<void> => {
    try {
      await options.onReminder(toNotification(claim));
      await options.automation.completeReminderLease(claim.leaseId);
    } catch (error) {
      await options.automation.failReminderLease(
        claim.leaseId,
        retryDelayMs,
        "notification_failed",
      ).catch((settlementError) => {
        logger.warn("Reminder lease settlement failed", {
          leaseId: claim.leaseId,
          error: settlementError,
        });
      });
      logger.warn("Reminder delivery failed", {
        leaseId: claim.leaseId,
        projectId: claim.projectId,
        pageId: claim.pageId,
        error,
      });
    }
  };

  const runNow = async (): Promise<void> => {
    if (disposed || running) return;
    running = true;
    try {
      const claims = await options.automation.claimDueReminders(
        maxPerTick,
        leaseDurationMs,
      );
      await Promise.all(claims.map(deliver));
    } catch (error) {
      logger.debug("Reminder scheduler tick failed", { error });
    } finally {
      running = false;
    }
  };

  logger.info("Starting reminder scheduler", {
    intervalMs,
    maxPerTick,
    leaseDurationMs,
  });
  void runNow();
  const timer = setIntervalImpl(() => {
    void runNow();
  }, intervalMs);
  timer.unref?.();

  return {
    runNow,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearIntervalImpl(timer);
      logger.info("Stopped reminder scheduler");
    },
  };
}
