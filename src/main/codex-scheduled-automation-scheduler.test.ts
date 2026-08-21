import { describe, expect, test } from "vite-plus/test";
import type { CodexScheduledAutomation } from "../shared/types";
import {
  CODEX_SCHEDULED_AUTOMATION_SCHEDULER_INTERVAL_MS,
  CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK,
  CodexScheduledAutomationRetryError,
  startCodexScheduledAutomationScheduler,
} from "./codex-scheduled-automation-scheduler";

function automation(id: string): CodexScheduledAutomation {
  return {
    id,
    definitionRevision: 1,
    kind: "cron",
    status: "ACTIVE",
    targetThreadId: null,
    name: id,
    prompt: "Run.",
    rrule: "FREQ=MINUTELY;INTERVAL=5",
    model: null,
    modelProvider: null,
    harnessId: null,
    reasoningEffort: null,
    serviceTier: null,
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
  test("settles native claims after execution and preserves retry intent", async () => {
    const completed: string[] = [];
    const failed: Array<{
      leaseId: string;
      retryDelayMs: number | null;
      reasonCode: string;
    }> = [];
    let claimCount = 0;
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      now: () => 500,
      setIntervalImpl: () =>
        ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: async () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      claimDueAutomations: async () => {
        claimCount += 1;
        if (claimCount > 1) return [];
        return [
          { leaseId: "lease:complete", definition: automation("complete") },
          { leaseId: "lease:retry", definition: automation("retry") },
          { leaseId: "lease:deferred", definition: automation("deferred") },
        ];
      },
      completeClaim: async (leaseId) => {
        completed.push(leaseId);
      },
      failClaim: async (leaseId, retryDelayMs, reasonCode) => {
        failed.push({ leaseId, retryDelayMs, reasonCode });
      },
      runAutomation: async (item, context) => {
        expect(context.leaseId).toBe(`lease:${item.id}`);
        if (item.id === "retry") {
          throw new CodexScheduledAutomationRetryError(
            "Renderer owner is unavailable",
            60_000,
            "renderer_owner_unavailable",
          );
        }
        if (item.id === "deferred") {
          throw new CodexScheduledAutomationRetryError(
            "Heartbeat automations are disabled",
            null,
            "heartbeat_disabled",
          );
        }
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toEqual(["lease:complete"]);
    expect(failed).toEqual([
      {
        leaseId: "lease:retry",
        retryDelayMs: 60_000,
        reasonCode: "renderer_owner_unavailable",
      },
      {
        leaseId: "lease:deferred",
        retryDelayMs: null,
        reasonCode: "heartbeat_disabled",
      },
    ]);
    scheduler.dispose();
  });

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
      claimDueAutomations: async (limit) => {
        expect(limit).toBe(CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK);
        return dueAutomations.slice(0, limit).map((definition) => ({
          leaseId: `lease:${definition.id}`,
          definition,
        }));
      },
      completeClaim: async () => undefined,
      failClaim: async () => undefined,
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
    let authorityAvailable = false;
    let resolveRun: () => void = () => undefined;
    let blockRun = true;
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      isAuthorityAvailable: () => authorityAvailable,
      now: () => 500,
      setIntervalImpl: () =>
        ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      claimDueAutomations: async () => {
        listCalls += 1;
        return [{ leaseId: "lease:slow", definition: automation("slow") }];
      },
      completeClaim: async () => undefined,
      failClaim: async () => undefined,
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
    expect(listCalls).toBe(0);
    authorityAvailable = true;
    const activeTick = scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listCalls).toBe(1);
    await scheduler.tick();
    expect(listCalls).toBe(1);

    resolveRun();
    await activeTick;
    await scheduler.tick();
    expect(listCalls).toBe(2);
    scheduler.dispose();
  });

  test("rechecks authority after initialization before claiming work", async () => {
    let authorityAvailable = true;
    let resolveInitialization: () => void = () => undefined;
    let claimCalls = 0;
    const claimDueAutomations = async () => {
      claimCalls += 1;
      return [];
    };
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      isAuthorityAvailable: () => authorityAvailable,
      setIntervalImpl: () =>
        ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: async () =>
        await new Promise((resolve) => {
          resolveInitialization = () =>
            resolve({
              archivedPendingCount: 0,
              pendingReviewCount: 0,
            });
        }),
      claimDueAutomations,
      completeClaim: async () => undefined,
      failClaim: async () => undefined,
      runAutomation: async () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    authorityAvailable = false;
    resolveInitialization();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(claimCalls).toBe(0);
    scheduler.dispose();
  });

  test("defers claims when authority is lost while claiming", async () => {
    let authorityAvailable = true;
    let resolveClaims: (
      claims: readonly { leaseId: string; definition: CodexScheduledAutomation }[],
    ) => void = () => undefined;
    const runIds: string[] = [];
    const failed: Array<{
      leaseId: string;
      retryDelayMs: number | null;
      reasonCode: string;
    }> = [];
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      intervalMs: 5_000,
      isAuthorityAvailable: () => authorityAvailable,
      setIntervalImpl: () =>
        ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: async () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      claimDueAutomations: async () =>
        await new Promise((resolve) => {
          resolveClaims = resolve;
        }),
      completeClaim: async () => undefined,
      failClaim: async (leaseId, retryDelayMs, reasonCode) => {
        failed.push({ leaseId, retryDelayMs, reasonCode });
      },
      runAutomation: async (item) => {
        runIds.push(item.id);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    authorityAvailable = false;
    resolveClaims([{ leaseId: "lease:deferred", definition: automation("deferred") }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runIds).toEqual([]);
    expect(failed).toEqual([
      {
        leaseId: "lease:deferred",
        retryDelayMs: 5_000,
        reasonCode: "core_authority_unavailable",
      },
    ]);
    scheduler.dispose();
  });

  test("passes heartbeat feature, renderer state, collaboration mode, and permissions to runs", async () => {
    let nowMs = 1_000;
    const contexts: unknown[] = [];
    const scheduler = startCodexScheduledAutomationScheduler({
      logger: logger(),
      now: () => nowMs,
      setIntervalImpl: () =>
        ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => undefined,
      settleInterruptedRuns: () => ({
        archivedPendingCount: 0,
        pendingReviewCount: 0,
      }),
      claimDueAutomations: async () => [
        {
          leaseId: "lease:heartbeat",
          definition: heartbeatAutomation("heartbeat"),
        },
      ],
      completeClaim: async () => undefined,
      failClaim: async () => undefined,
      runAutomation: async (_item, context) => {
        contexts.push(context);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
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
