import { describe, expect, test, vi } from "vitest";

import { startAutomationReminderScheduler } from "./automation-reminder-scheduler";
import type { DesktopAutomationModulePort } from "./core-client/desktop-automation-module-bridge";

type ReminderAuthority = Pick<
  DesktopAutomationModulePort,
  "claimDueReminders" | "completeReminderLease" | "failReminderLease"
>;

const claim = {
  leaseId: "reminder-lease:1",
  projectId: "project:one",
  pageId: "page:one",
  occurrenceStart: Date.parse("2026-07-20T01:00:00.000Z"),
  reminderOffsetMinutes: 30,
  dueAt: Date.parse("2026-07-20T00:30:00.000Z"),
  title: "Planning session",
  attempt: 1,
  expiresAt: Date.parse("2026-07-20T00:32:00.000Z"),
};

const authority = (): ReminderAuthority => ({
  claimDueReminders: vi.fn(async () => [claim]),
  completeReminderLease: vi.fn(async () => undefined),
  failReminderLease: vi.fn(async () => undefined),
});

describe("Automation reminder scheduler", () => {
  test("delivers claimed reminders and completes their native leases", async () => {
    const automation = authority();
    const onReminder = vi.fn();
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    let intervalMs = 0;
    let cleared = false;
    let authorityAvailable = false;
    const scheduler = startAutomationReminderScheduler({
      automation,
      isAuthorityAvailable: () => authorityAvailable,
      onReminder,
      intervalMs: 10_000,
      maxPerTick: 7,
      leaseDurationMs: 45_000,
      setIntervalImpl: (_callback, milliseconds) => {
        intervalMs = milliseconds;
        return timer;
      },
      clearIntervalImpl: (candidate) => {
        cleared = candidate === timer;
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    await Promise.resolve();
    expect(automation.claimDueReminders).not.toHaveBeenCalled();
    authorityAvailable = true;
    await scheduler.runNow();
    await vi.waitFor(() => {
      expect(automation.completeReminderLease).toHaveBeenCalledWith("reminder-lease:1");
    });
    expect(automation.claimDueReminders).toHaveBeenCalledWith(7, 45_000);
    expect(onReminder).toHaveBeenCalledWith({
      projectId: "project:one",
      pageId: "page:one",
      occurrenceStart: "2026-07-20T01:00:00.000Z",
      title: "Planning session",
      body: "Starts in 30 minutes",
      reminderOffsetMinutes: 30,
    });
    expect(automation.failReminderLease).not.toHaveBeenCalled();
    expect(intervalMs).toBe(10_000);

    scheduler.dispose();
    expect(cleared).toBe(true);
  });

  test("releases failed notification claims for a bounded retry", async () => {
    const automation = authority();
    const deliveryError = new Error("notification unavailable");
    const scheduler = startAutomationReminderScheduler({
      automation,
      onReminder: () => {
        throw deliveryError;
      },
      retryDelayMs: 12_000,
      setIntervalImpl: () => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    await vi.waitFor(() => {
      expect(automation.failReminderLease).toHaveBeenCalledWith(
        "reminder-lease:1",
        12_000,
        "notification_failed",
      );
    });
    expect(automation.completeReminderLease).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  test("defers claimed reminders if Core authority is lost before delivery", async () => {
    let authorityAvailable = true;
    let resolveClaims: (claims: (typeof claim)[]) => void = () => undefined;
    const automation: ReminderAuthority = {
      ...authority(),
      claimDueReminders: vi.fn(
        async () =>
          await new Promise<(typeof claim)[]>((resolve) => {
            resolveClaims = resolve;
          }),
      ),
    };
    const onReminder = vi.fn();
    const scheduler = startAutomationReminderScheduler({
      automation,
      isAuthorityAvailable: () => authorityAvailable,
      onReminder,
      retryDelayMs: 9_000,
      setIntervalImpl: () => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    await vi.waitFor(() => expect(automation.claimDueReminders).toHaveBeenCalledTimes(1));
    authorityAvailable = false;
    resolveClaims([claim]);

    await vi.waitFor(() => {
      expect(automation.failReminderLease).toHaveBeenCalledWith(
        "reminder-lease:1",
        9_000,
        "core_authority_unavailable",
      );
    });
    expect(onReminder).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
