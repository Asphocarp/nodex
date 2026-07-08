import type {
  CodexHeartbeatAutomationCollaborationMode,
  CodexHeartbeatAutomationPermissions,
  CodexScheduledAutomation,
} from "../shared/types";
import {
  listDueCodexScheduledAutomationRuns,
  reconcileCodexScheduledAutomations,
} from "./local-store/codex-scheduled-automations";
import { settleInterruptedCodexAutomationRuns } from "./local-store/codex-automation-runs";
import { getLogger } from "./logging/logger";

export const CODEX_SCHEDULED_AUTOMATION_SCHEDULER_INTERVAL_MS = 30_000;
export const CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK = 3;
export const CODEX_HEARTBEAT_AUTOMATION_RENDERER_STATE_TTL_MS = 2 * 60_000;

export interface CodexScheduledAutomationRunContext {
  now: number;
  reason: "scheduled";
  heartbeat?: CodexScheduledAutomationHeartbeatRunContext;
}

export interface CodexScheduledAutomationHeartbeatRendererState {
  isEligible: boolean;
  reason: string | null;
  updatedAtMs: number;
}

export interface CodexScheduledAutomationHeartbeatRunContext {
  automationsEnabled: boolean;
  rendererState: CodexScheduledAutomationHeartbeatRendererState | null;
  collaborationMode: CodexHeartbeatAutomationCollaborationMode | null;
  permissions: CodexHeartbeatAutomationPermissions | null;
}

export interface CodexScheduledAutomationHeartbeatThreadStateInput {
  threadId: string;
  isEligible: boolean;
  reason?: string | null;
  collaborationMode?: CodexHeartbeatAutomationCollaborationMode | null;
  permissions?: CodexHeartbeatAutomationPermissions | null;
}

export interface CodexScheduledAutomationScheduler {
  dispose: () => void;
  tick: () => Promise<void>;
  setHeartbeatAutomationsEnabled: (enabled: boolean) => void;
  setHeartbeatThreadRendererState: (input: CodexScheduledAutomationHeartbeatThreadStateInput) => void;
}

interface SchedulerLogger {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

type SchedulerTimer = ReturnType<typeof setInterval> & {
  unref?: () => void;
};

export interface StartCodexScheduledAutomationSchedulerOptions {
  intervalMs?: number;
  maxPerTick?: number;
  now?: () => number;
  runAutomation: (
    automation: CodexScheduledAutomation,
    context: CodexScheduledAutomationRunContext,
  ) => Promise<void>;
  listDueAutomations?: (now: number, limit: number) => CodexScheduledAutomation[];
  reconcileAutomations?: (now: number) => number;
  settleInterruptedRuns?: () => {
    archivedPendingCount: number;
    pendingReviewCount: number;
  };
  onAutomationRunsUpdated?: () => void;
  setIntervalImpl?: (callback: () => void, ms: number) => SchedulerTimer;
  clearIntervalImpl?: (timer: SchedulerTimer) => void;
  logger?: SchedulerLogger;
}

export function startCodexScheduledAutomationScheduler(
  options: StartCodexScheduledAutomationSchedulerOptions,
): CodexScheduledAutomationScheduler {
  const intervalMs = Math.max(5_000, options.intervalMs ?? CODEX_SCHEDULED_AUTOMATION_SCHEDULER_INTERVAL_MS);
  const maxPerTick = Math.max(1, options.maxPerTick ?? CODEX_SCHEDULED_AUTOMATION_SCHEDULER_MAX_PER_TICK);
  const now = options.now ?? Date.now;
  const logger = options.logger ?? getLogger({ subsystem: "codex-scheduled-automations" });
  const listDueAutomations = options.listDueAutomations ?? listDueCodexScheduledAutomationRuns;
  const reconcileAutomations = options.reconcileAutomations ?? reconcileCodexScheduledAutomations;
  const settleInterruptedRuns = options.settleInterruptedRuns ?? settleInterruptedCodexAutomationRuns;
  const setIntervalImpl = options.setIntervalImpl ?? ((callback, ms) => setInterval(callback, ms));
  const clearIntervalImpl = options.clearIntervalImpl ?? ((timer) => clearInterval(timer));
  let disposed = false;
  let running = false;
  let heartbeatAutomationsEnabled = false;
  const heartbeatThreadRendererStates = new Map<string, CodexScheduledAutomationHeartbeatRendererState>();
  const heartbeatThreadCollaborationModes = new Map<string, CodexHeartbeatAutomationCollaborationMode>();
  const heartbeatThreadPermissions = new Map<string, CodexHeartbeatAutomationPermissions>();

  logger.info("Starting scheduled automation scheduler", { intervalMs, maxPerTick });

  try {
    const settled = settleInterruptedRuns();
    if (settled.archivedPendingCount > 0 || settled.pendingReviewCount > 0) {
      options.onAutomationRunsUpdated?.();
    }
  } catch (error) {
    logger.warn("Failed to settle interrupted scheduled automation runs", { error });
  }

  try {
    reconcileAutomations(now());
  } catch (error) {
    logger.warn("Failed to reconcile scheduled automations", { error });
  }

  const tick = async (): Promise<void> => {
    if (disposed) return;
    if (running) return;

    running = true;
    const tickNow = now();
    try {
      const dueAutomations = listDueAutomations(tickNow, maxPerTick);
      await Promise.all(dueAutomations.map(async (automation) => {
        try {
          await options.runAutomation(automation, {
            now: tickNow,
            reason: "scheduled",
            ...(automation.kind === "heartbeat"
              ? {
                  heartbeat: buildHeartbeatRunContext({
                    automation,
                    automationsEnabled: heartbeatAutomationsEnabled,
                    rendererStates: heartbeatThreadRendererStates,
                    collaborationModes: heartbeatThreadCollaborationModes,
                    permissions: heartbeatThreadPermissions,
                    now: tickNow,
                  }),
                }
              : {}),
          });
        } catch (error) {
          logger.warn("Scheduled automation run failed", {
            automationId: automation.id,
            error,
          });
        }
      }));
    } catch (error) {
      logger.debug("Scheduled automation scheduler tick failed", { error });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setIntervalImpl(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearIntervalImpl(timer);
      logger.info("Stopped scheduled automation scheduler");
    },
    tick,
    setHeartbeatAutomationsEnabled: (enabled) => {
      heartbeatAutomationsEnabled = enabled;
      if (!enabled) {
        heartbeatThreadRendererStates.clear();
        heartbeatThreadCollaborationModes.clear();
        heartbeatThreadPermissions.clear();
        return;
      }

      void tick();
    },
    setHeartbeatThreadRendererState: (input) => {
      const threadId = input.threadId.trim();
      if (!threadId) return;

      heartbeatThreadRendererStates.set(threadId, {
        isEligible: input.isEligible,
        reason: input.reason?.trim() || null,
        updatedAtMs: now(),
      });

      if (input.collaborationMode == null) {
        heartbeatThreadCollaborationModes.delete(threadId);
      } else {
        heartbeatThreadCollaborationModes.set(threadId, input.collaborationMode);
      }

      if (input.permissions == null) {
        heartbeatThreadPermissions.delete(threadId);
      } else {
        heartbeatThreadPermissions.set(threadId, input.permissions);
      }
    },
  };
}

function buildHeartbeatRunContext(input: {
  automation: CodexScheduledAutomation;
  automationsEnabled: boolean;
  rendererStates: Map<string, CodexScheduledAutomationHeartbeatRendererState>;
  collaborationModes: Map<string, CodexHeartbeatAutomationCollaborationMode>;
  permissions: Map<string, CodexHeartbeatAutomationPermissions>;
  now: number;
}): CodexScheduledAutomationHeartbeatRunContext {
  const targetThreadId = input.automation.targetThreadId?.trim() ?? "";
  const rendererState = getFreshRendererState({
    threadId: targetThreadId,
    states: input.rendererStates,
    now: input.now,
  });

  return {
    automationsEnabled: input.automationsEnabled,
    rendererState,
    collaborationMode: input.collaborationModes.get(targetThreadId) ?? null,
    permissions: input.permissions.get(targetThreadId) ?? null,
  };
}

function getFreshRendererState(input: {
  threadId: string;
  states: Map<string, CodexScheduledAutomationHeartbeatRendererState>;
  now: number;
}): CodexScheduledAutomationHeartbeatRendererState | null {
  const state = input.states.get(input.threadId) ?? null;
  if (!state) return null;
  if (input.now - state.updatedAtMs <= CODEX_HEARTBEAT_AUTOMATION_RENDERER_STATE_TTL_MS) {
    return state;
  }

  input.states.delete(input.threadId);
  return null;
}
