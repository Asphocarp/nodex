import { describe, expect, test } from "vitest";
import type { CodexScheduledAutomation } from "../shared/types";
import {
  CODEX_SCHEDULED_AUTOMATION_SCHEDULER_INTERVAL_MS,
  CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK,
  startCodexScheduledAutomationScheduler,
} from "./codex-scheduled-automation-scheduler";

function automation(id: string): CodexScheduledAutomation {
  return {
    id,
    kind: "cron",
    status: "ACTIVE",
    targetThreadId: null,
    name: id,
    prompt: "Run.",
    rrule: "FREQ=MINUTELY;INTERVAL=5",
    model: null,
    reasoningEffort: null,
    cwds: ["/repo/project"],
    executionEnvironment: "worktree",
    localEnvironmentConfigPath: null,
    nextRunAt: 100,
    lastRunAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function heartbeatAutomation(id: string): CodexScheduledAutomation {
  return {
    ...automation(id),
    kind: "heartbeat",
    targetThreadId: "thread-follow-up",
    cwds: [],
    executionEnvironment: "local",
  };
}

function logger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

describe("codex scheduled automation scheduler", () => {
  test("settles startup state, reconciles automations, runs due items, and disposes the timer", async () => {
    const dueAutomations = [
      automation("first"),
      automation("second"),
      automation("third"),
      automation("fourth"),
    ];
    const runIds: string[] = [];
    let intervalMs = 0;
    let cleared = false;
    let unrefCalled = false;
    let runsUpdated = 0;
    const timer = {
      unref: () => {
        unrefCalled = true;
      },
    } as unknown as ReturnType<typeof setInterval>;

    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      now: () => 123,
      setIntervalImpl: (_callback, ms) => {
        intervalMs = ms;
        return timer;
      },
      clearIntervalImpl: (input) => {
        cleared = input === timer;
      },
      settleInterruptedRuns: () => ({
        archivedPendingCount: 1,
        pendingReviewCount: 0,
      }),
      reconcileAutomations: (now) => {
        expect(now).toBe(123);
        return 1;
      },
      listDueAutomations: (now, limit) => {
        expect(now).toBe(123);
        expect(limit).toBe(CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK);
        return dueAutomations.slice(0, limit);
      },
      onAutomationRunsUpdated: () => {
        runsUpdated += 1;
      },
      runAutomation: async (item) => {
        runIds.push(item.id);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(intervalMs).toBe(CODEX_SCHEDULED_AUTOMATION_SCHEDULER_INTERVAL_MS);
    expect(unrefCalled).toBe(true);
    expect(runsUpdated).toBe(1);
    expect(JSON.stringify(runIds)).toBe(JSON.stringify(["first", "second", "third"]));

    scheduler.dispose();
    expect(cleared).toBe(true);
  });

  test("skips overlapping ticks while a run is active", async () => {
    let listCalls = 0;
    let resolveRun: () => void = () => undefined;
    let blockRun = true;
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      now: () => 500,
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      reconcileAutomations: () => 0,
      listDueAutomations: () => {
        listCalls += 1;
        return [automation("slow")];
      },
      runAutomation: () => {
        if (!blockRun) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resolveRun = () => {
            blockRun = false;
            resolve();
          };
        });
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listCalls).toBe(1);
    await scheduler.tick();
    expect(listCalls).toBe(1);

    resolveRun();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await scheduler.tick();
    expect(listCalls).toBe(2);
    scheduler.dispose();
  });

  test("passes heartbeat feature, renderer state, collaboration mode, and permissions to runs", async () => {
    let nowMs = 1_000;
    const contexts: unknown[] = [];
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      now: () => nowMs,
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      reconcileAutomations: () => 0,
      listDueAutomations: () => [heartbeatAutomation("heartbeat")],
      runAutomation: async (_item, context) => {
        contexts.push(context);
      },
    });

    await Promise.resolve();
    const initial = contexts[0] as {
      heartbeat?: { automationsEnabled?: boolean };
    };
    expect(initial.heartbeat?.automationsEnabled).toBe(false);

    scheduler.setHeartbeatThreadRendererState({
      threadId: "thread-follow-up",
      rendererClientId: "renderer-owner",
      streamRole: "owner",
      isEligible: true,
      reason: null,
      collaborationMode: "plan",
      permissions: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/repo/project"],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
    });
    scheduler.setHeartbeatAutomationsEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await scheduler.tick();

    const enabled = contexts[contexts.length - 1] as {
      heartbeat?: {
        automationsEnabled?: boolean;
        rendererState?: {
          rendererClientId?: string;
          isEligible?: boolean;
          reason?: string | null;
        } | null;
        collaborationMode?: string | null;
        permissions?: { approvalPolicy?: string | null } | null;
      };
    };
    expect(enabled.heartbeat?.automationsEnabled).toBe(true);
    expect(enabled.heartbeat?.rendererState?.isEligible).toBe(true);
    expect(enabled.heartbeat?.rendererState?.rendererClientId).toBe("renderer-owner");
    expect(enabled.heartbeat?.rendererState?.reason).toBe(null);
    expect(enabled.heartbeat?.collaborationMode).toBe("plan");
    expect(enabled.heartbeat?.permissions?.approvalPolicy).toBe("on-request");

    nowMs += 121_000;
    await scheduler.tick();
    const stale = contexts[contexts.length - 1] as {
      heartbeat?: {
        rendererState?: unknown | null;
        collaborationMode?: string | null;
      };
    };
    expect(stale.heartbeat?.rendererState).toBe(null);
    expect(stale.heartbeat?.collaborationMode).toBe("plan");
    scheduler.dispose();
  });
});
