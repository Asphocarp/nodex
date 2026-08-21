import type {
  CodexHeartbeatAutomationCollaborationMode,
  CodexHeartbeatAutomationPermissions,
  CodexScheduledAutomation,
} from "../../shared/types";

export const SCHEDULED_AUTOMATION_INTERVAL_MS = 30_000;
export const SCHEDULED_AUTOMATION_MAX_PER_TICK = 3;
export const SCHEDULED_AUTOMATION_LEASE_DURATION_MS = 15 * 60_000;
export const HEARTBEAT_RENDERER_STATE_TTL_MS = 2 * 60_000;

export interface CodexScheduledAutomationRunContext {
  readonly now: number;
  readonly reason: "scheduled";
  readonly leaseId?: string;
  readonly heartbeat?: CodexScheduledAutomationHeartbeatRunContext;
}

export class CodexScheduledAutomationRetryError extends Error {
  constructor(
    message: string,
    readonly retryDelayMs: number | null,
    readonly reasonCode: string,
  ) {
    super(message);
    this.name = "CodexScheduledAutomationRetryError";
  }
}

export interface CodexScheduledAutomationHeartbeatRendererState {
  readonly rendererClientId: string;
  readonly isEligible: boolean;
  readonly reason: string | null;
  readonly updatedAtMs: number;
}

export interface CodexScheduledAutomationHeartbeatRunContext {
  readonly automationsEnabled: boolean;
  readonly rendererState: CodexScheduledAutomationHeartbeatRendererState | null;
  readonly collaborationMode: CodexHeartbeatAutomationCollaborationMode | null;
  readonly permissions: CodexHeartbeatAutomationPermissions | null;
}

export interface CodexScheduledAutomationHeartbeatThreadStateInput {
  readonly threadId: string;
  readonly rendererClientId: string;
  readonly streamRole: "owner" | "follower" | null;
  readonly isEligible: boolean;
  readonly reason?: string | null;
  readonly collaborationMode?: CodexHeartbeatAutomationCollaborationMode | null;
  readonly permissions?: CodexHeartbeatAutomationPermissions | null;
}

export interface ScheduledAutomationHeartbeatState {
  readonly automationsEnabled: boolean;
  readonly rendererStates: ReadonlyMap<string, CodexScheduledAutomationHeartbeatRendererState>;
  readonly collaborationModes: ReadonlyMap<string, CodexHeartbeatAutomationCollaborationMode>;
  readonly permissions: ReadonlyMap<string, CodexHeartbeatAutomationPermissions>;
}

export const emptyHeartbeatState = (): ScheduledAutomationHeartbeatState => ({
  automationsEnabled: false,
  rendererStates: new Map(),
  collaborationModes: new Map(),
  permissions: new Map(),
});

export const updateHeartbeatEnabled = (
  state: ScheduledAutomationHeartbeatState,
  enabled: boolean,
): ScheduledAutomationHeartbeatState =>
  enabled
    ? { ...state, automationsEnabled: true }
    : {
        automationsEnabled: false,
        rendererStates: new Map(),
        collaborationModes: new Map(),
        permissions: new Map(),
      };

export const updateHeartbeatThreadState = (
  state: ScheduledAutomationHeartbeatState,
  input: CodexScheduledAutomationHeartbeatThreadStateInput,
  now: number,
): ScheduledAutomationHeartbeatState => {
  const threadId = input.threadId.trim();
  if (!threadId) return state;

  const rendererStates = new Map(state.rendererStates).set(threadId, {
    rendererClientId: input.rendererClientId,
    isEligible: input.streamRole === "owner" && input.isEligible,
    reason: input.streamRole === "owner" ? input.reason?.trim() || null : "not_conversation_owner",
    updatedAtMs: now,
  });
  const collaborationModes = new Map(state.collaborationModes);
  const permissions = new Map(state.permissions);
  if (input.collaborationMode == null) collaborationModes.delete(threadId);
  else collaborationModes.set(threadId, input.collaborationMode);
  if (input.permissions == null) permissions.delete(threadId);
  else permissions.set(threadId, input.permissions);
  return { ...state, rendererStates, collaborationModes, permissions };
};

export const heartbeatRunContext = (input: {
  readonly automation: CodexScheduledAutomation;
  readonly state: ScheduledAutomationHeartbeatState;
  readonly now: number;
}): CodexScheduledAutomationHeartbeatRunContext => {
  const targetThreadId = input.automation.targetThreadId?.trim() ?? "";
  const rendererState = input.state.rendererStates.get(targetThreadId) ?? null;
  return {
    automationsEnabled: input.state.automationsEnabled,
    rendererState:
      rendererState !== null &&
      input.now - rendererState.updatedAtMs <= HEARTBEAT_RENDERER_STATE_TTL_MS
        ? rendererState
        : null,
    collaborationMode: input.state.collaborationModes.get(targetThreadId) ?? null,
    permissions: input.state.permissions.get(targetThreadId) ?? null,
  };
};
