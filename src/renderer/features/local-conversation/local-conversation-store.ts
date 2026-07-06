import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { ThreadMemoryMode } from "@nodex/codex-app-server-protocol";
import type {
  FeedbackUploadParams,
  ThreadGoal,
  ThreadRollbackResponse,
  ThreadSource,
  Turn,
  TurnStartResponse,
  UserInput,
} from "@nodex/codex-app-server-protocol/v2";
import type {
  CodexAccountSnapshot,
  CodexApprovalRequest,
  CodexApprovalDecision,
  CodexBackgroundTerminalRow,
  CardRunInTarget,
  CodexConversationSource,
  CodexConversationCapabilityFlags,
  CodexConversationChildMembership,
  CodexCommandAction,
  CodexConversationResumeState,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexCollaborationModePreset,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationItem,
  CodexItemStatus,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
  CodexConversationTurn,
  CodexDictationStateSnapshot,
  CodexConversationLiveRequest,
  CodexItemView,
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationRequest,
  CodexMcpServerElicitationResponse,
  CodexModelOption,
  CodexOwnerAppServerRequestInput,
  CodexPendingSteer,
  CodexPermissionMode,
  CodexPermissionRequest,
  CodexPermissionRequestResponse,
  CodexPermissionState,
  CodexQueuedFollowUp,
  CodexUserInputRequest,
  CodexRendererClientRequestMessage,
  CodexRendererClientResponseMessage,
  CodexRendererThreadRole,
  CodexRendererThreadRoleRequest,
  CodexSafetyBufferingState,
  CodexSideChatStartInput,
  CodexSideChatStartResult,
  CodexSteerTurnInput,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexThreadOwnerLoadCompleteHistoryResult,
  CodexThreadOwnerActionRequest,
  CodexThreadTokenUsage,
  CodexPromptInput,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexServiceTier,
  CodexSharedObject,
  CodexThreadSettings,
  CodexThreadStartForSessionInput,
  CodexThreadSummary,
  CodexTurnStartOptions,
} from "../../lib/types";
import { normalizeCodexMcpServerElicitationResponse } from "../../../shared/codex-mcp-elicitation";
import type { CodexThreadActiveFlag, CodexTurnStatus } from "../../../shared/types";
import {
  applyCodexConversationStateUpdates,
  buildCodexConversationStateUpdates,
} from "../../../shared/codex-conversation-patches";
import { DEFAULT_CODEX_HOST_ID } from "../../../shared/codex-host";
import { normalizeCodexManualThreadTitle } from "../../../shared/codex-thread-title";
import {
  hasCodexPendingContinuation,
  isCodexConversationDesktopNotificationEligible,
  normalizeDesktopNotificationText,
  parseCodexHeartbeatAssistantMessage,
  type CodexTurnCompleteNotificationEnvelope,
} from "../../../shared/codex-turn-notification";
import {
  buildCodexUserAttachmentsFromContent,
  buildTurnErrorItemView,
  normalizeThreadItem,
  projectCodexItemViewToTranscriptEntry,
  resolveContextCompactionMarkdown,
} from "../../../shared/codex-item-normalizer";
import {
  canMergeSyntheticTextDuplicate,
  mergeCodexItemView,
} from "../../../shared/codex-item-identity";
import {
  AUTO_REVIEW_INTERRUPTION_WARNING_PREFIX,
  buildAutomaticApprovalReviewSummary,
  normalizeAutomaticApprovalReviewPayload,
  shouldShowAutoReviewInterruptionWarning,
} from "../../../shared/codex-transcript-special-items";
import {
  parseCodexReasoningBuffers,
  projectCodexReasoningSummary,
} from "../../../shared/codex-reasoning-projection";
import {
  getTerminalInteractionBufferKey,
  parseTerminalInteractionInput,
} from "../../../shared/codex-terminal-interaction";
import {
  resolveCodexReasoningEffortOptions,
  resolveCodexThreadSettings,
} from "../../lib/codex-thread-settings";
import {
  buildCodexServiceTierRequestOverride,
  resolveCodexRequestServiceTier,
} from "../../lib/codex-service-tier-settings";
import { parseCodexThreadTokenUsage } from "../../../shared/schemas/codex";
import { useCodexThreadSettings } from "../../lib/use-codex-thread-settings";
import { useCodexServiceTierSettings } from "../../lib/use-codex-service-tier-settings";
import {
  logAssistantStreamingDebug,
  logAssistantStreamingDebugSampled,
} from "../../lib/assistant-streaming-debug";
import {
  invoke,
  subscribeCodexRendererClientRequests,
} from "./local-conversation-deps";
import {
  subscribeCodexAppServerMessage,
  type CodexClientStatusChangedEvent,
  type CodexErrorEvent,
  type CodexMcpNotificationEvent,
  type CodexSharedObjectUpdatedEvent,
  type CodexThreadDeletedEvent,
  type CodexThreadTitleUpdatedEvent,
  type CodexThreadOwnerNotificationEvent,
  type CodexThreadOwnerRequestEvent,
  type CodexThreadOwnerUnavailableEvent,
  type CodexThreadStreamStateChangedEvent,
  __resetCodexAppServerMessageBusForTests,
} from "./app-server-message-bus";
import {
  __resetLocalConversationHostBridgeForTests,
  startLocalConversationHostBridge,
} from "./local-conversation-host-bridge";
import {
  areConversationLiveRequestsEqual,
  selectPrimaryConversationRequest,
} from "./conversation-request-helpers";
import { LocalConversationStreamState } from "./local-conversation-stream-state";

const INITIAL_CONNECTION: CodexConnectionState = {
  status: "disconnected",
  retries: 0,
};

const EMPTY_THREADS: CodexThreadSummary[] = [];
const EMPTY_CONVERSATION_MAP: Record<string, CodexConversationSnapshot> = {};
const EMPTY_MODELS: CodexModelOption[] = [];
const EMPTY_TURNS: CodexConversationTurn[] = [];
const EMPTY_REQUESTS: CodexConversationServerRequest[] = [];
const EMPTY_PENDING_STEERS: CodexPendingSteer[] = [];
const EMPTY_QUEUED_FOLLOW_UPS: CodexQueuedFollowUp[] = [];
const EMPTY_BACKGROUND_TERMINAL_ROWS: CodexBackgroundTerminalRow[] = [];
const EMPTY_CHILD_MEMBERSHIPS: CodexConversationChildMembership[] = [];
const EMPTY_STATUS_ACTIVE_FLAGS: CodexConversationSnapshot["statusActiveFlags"] = [];
const DEFAULT_PERMISSION_STATE: CodexPermissionState = {
  mode: "custom",
  effectivePreset: "custom",
  availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
  approvalPolicy: null,
  approvalsReviewer: "user",
  sandboxMode: null,
  sandbox: null,
  guardianApprovalEnabled: false,
  configTarget: {
    source: "none",
    filePath: null,
  },
  customDescription: "Codex will use its built-in permission defaults.",
};
const EMPTY_CONVERSATION_SUMMARY_FIELDS = {
  threadId: null,
  projectId: null,
  threadName: null,
  threadPreview: "",
  modelProvider: null,
  cwd: null,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  linkedAt: "",
};
const EMPTY_CONVERSATION_CAPABILITY_FLAGS: CodexConversationCapabilityFlags = {
  canEditLastUserTurn: false,
  canForkFromTurn: false,
  canSearch: false,
  canCollapseTurns: false,
};
const DEFAULT_COLLABORATION_MODE_STATE: CodexCollaborationModeState = {
  mode: "default",
  settings: {
    model: "",
    reasoning_effort: null,
    developer_instructions: null,
  },
};

function hasOwnValue(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeThreadSettingsModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCodexServiceTier(value: unknown): CodexServiceTier {
  return value === "fast" ? "fast" : null;
}

function createOwnerQueuedFollowUp(
  threadId: string,
  prompt: string,
  opts?: CodexTurnStartOptions,
): CodexQueuedFollowUp {
  const createdAt = Date.now();
  return {
    followUpId: `follow-up:${threadId}:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    prompt,
    ...(opts?.promptInput ? { promptInput: opts.promptInput } : {}),
    createdAt,
    collaborationMode: opts?.collaborationMode ?? null,
    serviceTier: normalizeCodexServiceTier(opts?.serviceTier),
    pausedReason: null,
  };
}

function createOwnerPendingSteer(
  threadId: string,
  turnId: string,
  prompt: string,
): CodexPendingSteer {
  const createdAt = Date.now();
  return {
    steerId: `steer:${threadId}:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    turnId,
    prompt,
    createdAt,
  };
}

function getLatestInProgressTurnId(conversation: CodexConversationSnapshot): string | null {
  for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
    const turn = conversation.turns[index];
    if (turn?.status === "inProgress") return turn.turnId;
  }
  return null;
}

function resolveCodexDraftRequestSettings(
  input: {
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
  },
  resolvedSettings: Required<CodexThreadSettings>,
): {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
} {
  const model =
    normalizeThreadSettingsModel(input.model)
    ?? normalizeThreadSettingsModel(resolvedSettings.model)
    ?? undefined;
  const reasoningEffort = input.reasoningEffort ?? (
    model ? resolvedSettings.reasoningEffort : undefined
  );

  return {
    model,
    reasoningEffort,
  };
}

const DEFAULT_CODEX_DICTATION_STATE: CodexDictationStateSnapshot = {
  isEnabled: false,
  authMethod: null,
  isRealtimeVoiceActive: false,
  shortcutLabel: "Ctrl+M",
};
const OUTPUT_DELTA_FLUSH_MS = 50;
const OWNER_TEXT_DELTA_FLUSH_MS = 16;
const OWNER_TEXT_DELTA_TARGET_CHARS_PER_FRAME = 24;
const OWNER_TEXT_DELTA_MAX_DRAIN_FRAMES = 8;
const COMPLETE_HISTORY_WAIT_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_CHARS = 20_000;
const TRUNCATED_OUTPUT_PREFIX = "[output truncated]\n";

interface OwnerStreamRevisionResult {
  streamRevision?: number;
}

interface OwnerBooleanActionResult extends OwnerStreamRevisionResult {
  accepted: boolean;
}

type StoreListener = () => void;
type ConversationListener = (conversation: CodexConversationSnapshot) => void;
type AnyConversationListener = (conversations: CodexConversationSnapshot[]) => void;
type ControlListener = () => void;
type TurnCompletedListener = (payload: CodexTurnCompleteNotificationEnvelope) => void;
type ApprovalRequestListener = (payload: {
  conversationId: string;
  requestId: string;
  kind: "command" | "file";
  reason: string | null;
}) => void;
type UserInputRequestListener = (payload: {
  conversationId: string;
  requestId: string;
  turnId: string;
  questionCount: number;
  firstQuestion: string | null;
}) => void;

interface CodexThreadStartProgressState {
  projectId: string | null;
  sessionId: string | null;
  runInTarget: CardRunInTarget;
  threadId?: string | null;
  phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
  message: string;
  outputText: string;
  outputCarriageReturnPending: boolean;
  updatedAt: number;
}

interface CodexHostErrorState {
  message: string;
  detail?: string;
  updatedAt: number;
}

interface OutputDeltaUpdate {
  hostId: string;
  conversationId: string;
  turnId: string | null;
  itemId: string;
  delta: string;
  truncated?: boolean;
  ownerNotificationSequence?: number;
}

type OwnerTextDeltaTarget =
  | { type: "agentMessage" }
  | { type: "plan" }
  | { type: "reasoningSummary"; summaryIndex: number }
  | { type: "reasoningContent"; contentIndex: number };

interface OwnerTextDeltaUpdate {
  conversationId: string;
  turnId: string | null;
  itemId: string;
  delta: string;
  sequence: number;
  observedAtMs: number;
  target: OwnerTextDeltaTarget;
}

type ConversationNotifyMode = "default" | "sync";

interface OwnerTextDeltaFlushOptions {
  notifyMode?: ConversationNotifyMode;
}

type OwnerStreamPublishPatches = ReturnType<typeof buildCodexConversationStateUpdates>;

interface OwnerStreamPublishCursor {
  acceptedRevision: number;
  acceptedConversation: CodexConversationSnapshot;
  inFlight: boolean;
  dirty: boolean;
  maxOwnerNotificationSequence: number;
}

interface OwnerStreamPublishIdleWaiter {
  resolve: () => void;
}

interface OwnerTerminalInteractionPayload {
  threadId: string;
  turnId: string | null;
  itemId: string;
  stdin: string;
  observedAtMs: number;
}

function truncateBufferedOutput(input: {
  existingText: string;
  nextDelta: string;
  maxChars?: number;
}): { text: string; truncated: boolean } {
  const maxChars = input.maxChars ?? MAX_COMMAND_OUTPUT_CHARS;
  if (maxChars <= 0) {
    return { text: "", truncated: true };
  }

  if (input.nextDelta.length >= maxChars) {
    return {
      text: input.nextDelta.slice(-maxChars),
      truncated: true,
    };
  }

  const combined = `${input.existingText}${input.nextDelta}`;
  if (combined.length <= maxChars) {
    return {
      text: combined,
      truncated: false,
    };
  }

  return {
    text: combined.slice(-maxChars),
    truncated: true,
  };
}

function parseStoredAggregatedOutput(value: string | null | undefined): { text: string; truncated: boolean } {
  if (!value) {
    return { text: "", truncated: false };
  }

  if (!value.startsWith(TRUNCATED_OUTPUT_PREFIX)) {
    return { text: value, truncated: false };
  }

  return {
    text: value.slice(TRUNCATED_OUTPUT_PREFIX.length),
    truncated: true,
  };
}

function formatStoredAggregatedOutput(value: { text: string; truncated: boolean }): string {
  return value.truncated ? `${TRUNCATED_OUTPUT_PREFIX}${value.text}` : value.text;
}

function shouldWarnForMissingOutputDeltaTarget(): boolean {
  const meta = import.meta as ImportMeta & {
    env?: {
      MODE?: string;
      DEV?: boolean;
    };
  };
  return meta.env?.DEV === true || meta.env?.MODE === "development";
}

function warnMissingOutputDeltaTarget(message: string, update: OutputDeltaUpdate): void {
  if (!shouldWarnForMissingOutputDeltaTarget()) {
    return;
  }

  console.warn("[local-conversation-output-delta]", message, {
    conversationId: update.conversationId,
    turnId: update.turnId,
    itemId: update.itemId,
    deltaPreview: update.delta.slice(0, 80),
  });
}

interface RendererOwnerAppServerRequestClient {
  sendRequest<TResult>(
    conversationId: string,
    request: CodexOwnerAppServerRequestInput["request"],
  ): Promise<TResult>;
  rollbackThreadForEdit(
    conversationId: string,
    params: { threadId: string; turnId: string; numTurns: number },
  ): Promise<ThreadRollbackResponse>;
  forkConversationFromTurn(
    conversationId: string,
    params: { threadId: string; turnId: string; message: string },
  ): Promise<CodexThreadActionResult>;
  startTurn(
    conversationId: string,
    params: {
      threadId: string;
      prompt: string;
      opts?: CodexTurnStartOptions;
      clientUserMessageId: string;
      promptInput?: CodexPromptInput;
    },
  ): Promise<TurnStartResponse | unknown>;
  steerTurn(conversationId: string, params: CodexSteerTurnInput): Promise<{ turnId: string } | null>;
  interruptTurn(conversationId: string, params: { threadId: string; turnId?: string }): Promise<boolean>;
  updateThreadSettings(
    conversationId: string,
    params: { threadId: string; patch: CodexConversationThreadSettingsPatch },
  ): Promise<CodexConversationThreadSettings>;
  setThreadGoal(
    conversationId: string,
    params: { threadId: string; objective: string; tokenBudget?: number | null },
  ): Promise<ThreadGoal | null>;
  clearThreadGoal(conversationId: string, params: { threadId: string }): Promise<void>;
  setThreadMemoryMode(conversationId: string, params: { threadId: string; mode: ThreadMemoryMode }): Promise<void>;
  compactThread(conversationId: string, params: { threadId: string }): Promise<void>;
}

class IpcRendererOwnerAppServerRequestClient implements RendererOwnerAppServerRequestClient {
  async sendRequest<TResult>(
    conversationId: string,
    request: CodexOwnerAppServerRequestInput["request"],
  ): Promise<TResult> {
    return (await invoke("codex:thread-owner:app-server-request", {
      conversationId,
      request,
    } satisfies CodexOwnerAppServerRequestInput)) as TResult;
  }

  async rollbackThreadForEdit(
    conversationId: string,
    params: { threadId: string; turnId: string; numTurns: number },
  ): Promise<ThreadRollbackResponse> {
    return await this.sendRequest(conversationId, {
      method: "thread/rollback",
      params,
    });
  }

  async forkConversationFromTurn(
    conversationId: string,
    params: { threadId: string; turnId: string; message: string },
  ): Promise<CodexThreadActionResult> {
    return await this.sendRequest(conversationId, {
      method: "thread/fork",
      params,
    });
  }

  async startTurn(
    conversationId: string,
    params: {
      threadId: string;
      prompt: string;
      opts?: CodexTurnStartOptions;
      clientUserMessageId: string;
      promptInput?: CodexPromptInput;
    },
  ): Promise<TurnStartResponse | unknown> {
    return await this.sendRequest(conversationId, {
      method: "turn/start",
      params,
    });
  }

  async steerTurn(conversationId: string, params: CodexSteerTurnInput): Promise<{ turnId: string } | null> {
    return await this.sendRequest(conversationId, {
      method: "turn/steer",
      params,
    });
  }

  async interruptTurn(
    conversationId: string,
    params: { threadId: string; turnId?: string },
  ): Promise<boolean> {
    return await this.sendRequest(conversationId, {
      method: "turn/interrupt",
      params,
    });
  }

  async updateThreadSettings(
    conversationId: string,
    params: { threadId: string; patch: CodexConversationThreadSettingsPatch },
  ): Promise<CodexConversationThreadSettings> {
    return await this.sendRequest(conversationId, {
      method: "thread/settings/update",
      params,
    });
  }

  async setThreadGoal(
    conversationId: string,
    params: { threadId: string; objective: string; tokenBudget?: number | null },
  ): Promise<ThreadGoal | null> {
    return await this.sendRequest(conversationId, {
      method: "thread/goal/set",
      params,
    });
  }

  async clearThreadGoal(conversationId: string, params: { threadId: string }): Promise<void> {
    await this.sendRequest(conversationId, {
      method: "thread/goal/clear",
      params,
    });
  }

  async setThreadMemoryMode(
    conversationId: string,
    params: { threadId: string; mode: ThreadMemoryMode },
  ): Promise<void> {
    await this.sendRequest(conversationId, {
      method: "thread/memoryMode/set",
      params,
    });
  }

  async compactThread(conversationId: string, params: { threadId: string }): Promise<void> {
    await this.sendRequest(conversationId, {
      method: "thread/compact/start",
      params,
    });
  }
}

class OwnerTextDeltaQueue {
  private readonly buffers = new Map<string, OwnerTextDeltaUpdate>();
  private readonly drainCallbacks: Array<{ conversationId: string; callback: () => void }> = [];
  private flushHandle: ReturnType<typeof setTimeout> | number | null = null;
  private flushScheduler: "timeout" | "animationFrame" | null = null;
  private drainFramesRemaining: number | null = null;

  constructor(
    private readonly onFlush: (
      updates: OwnerTextDeltaUpdate[],
      options?: OwnerTextDeltaFlushOptions,
    ) => void,
    private readonly flushIntervalMs = OWNER_TEXT_DELTA_FLUSH_MS,
    private readonly targetCharsPerFrame = OWNER_TEXT_DELTA_TARGET_CHARS_PER_FRAME,
    private readonly maxDrainFrames = OWNER_TEXT_DELTA_MAX_DRAIN_FRAMES,
  ) {}

  enqueue(update: OwnerTextDeltaUpdate): void {
    const key = this.buildKey(update);
    const existing = this.buffers.get(key);
    this.buffers.set(key, {
      ...update,
      delta: `${existing?.delta ?? ""}${update.delta}`,
      sequence: Math.max(existing?.sequence ?? 0, update.sequence),
    });

    this.scheduleFlush();
  }

  flushNow(options: OwnerTextDeltaFlushOptions = {}): void {
    this.cancelScheduledFlush();
    if (this.buffers.size === 0) {
      this.finishDrainCallbacks();
      return;
    }

    const updates = Array.from(this.buffers.values());
    this.buffers.clear();
    this.drainFramesRemaining = null;
    this.onFlush(updates, options);
    this.finishDrainCallbacks();
  }

  drainBefore(conversationId: string, callback: () => void): boolean {
    const bufferedDeltaLength = this.getBufferedDeltaLength(conversationId);
    if (bufferedDeltaLength === 0) {
      return false;
    }

    if (!this.canUseAnimationFrame() || bufferedDeltaLength <= this.targetCharsPerFrame) {
      this.flushNow({ notifyMode: "sync" });
      return false;
    }

    this.drainCallbacks.push({ conversationId, callback });
    this.drainFramesRemaining = this.drainFramesRemaining ?? this.maxDrainFrames;
    this.scheduleFlush();
    return true;
  }

  cancel(): void {
    this.cancelScheduledFlush();
    this.buffers.clear();
    this.drainCallbacks.length = 0;
    this.drainFramesRemaining = null;
  }

  cancelConversation(conversationId: string): void {
    for (const [key, update] of this.buffers.entries()) {
      if (update.conversationId === conversationId) {
        this.buffers.delete(key);
      }
    }

    for (let index = this.drainCallbacks.length - 1; index >= 0; index -= 1) {
      if (this.drainCallbacks[index]?.conversationId === conversationId) {
        this.drainCallbacks.splice(index, 1);
      }
    }

    if (this.buffers.size === 0) {
      this.cancelScheduledFlush();
      this.drainFramesRemaining = null;
    }
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;

    const browserWindow = globalThis.window as Window | undefined;
    if (this.canUseAnimationFrame() && typeof browserWindow?.requestAnimationFrame === "function") {
      this.flushScheduler = "animationFrame";
      this.flushHandle = browserWindow.requestAnimationFrame(() => {
        this.flushHandle = null;
        this.flushScheduler = null;
        this.flushFrame();
      });
      return;
    }

    this.flushScheduler = "timeout";
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      this.flushScheduler = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }

  private flushFrame(): void {
    if (this.buffers.size === 0) {
      this.finishDrainCallbacks();
      return;
    }

    const updates: OwnerTextDeltaUpdate[] = [];
    for (const [key, update] of this.buffers.entries()) {
      const delta = update.delta.slice(0, this.getFrameDeltaLength(update));
      const remainingDelta = update.delta.slice(delta.length);
      updates.push({
        ...update,
        delta,
      });
      if (remainingDelta.length === 0) {
        this.buffers.delete(key);
      } else {
        this.buffers.set(key, {
          ...update,
          delta: remainingDelta,
        });
      }
    }

    if (updates.length > 0) {
      const notifyMode =
        this.drainCallbacks.length > 0 && this.buffers.size === 0
          ? "sync"
          : "default";
      this.onFlush(updates, { notifyMode });
    }

    if (this.drainFramesRemaining !== null) {
      this.drainFramesRemaining = Math.max(0, this.drainFramesRemaining - 1);
    }

    if (this.buffers.size > 0) {
      this.scheduleFlush();
      return;
    }

    this.finishDrainCallbacks();
  }

  private getFrameDeltaLength(update: OwnerTextDeltaUpdate): number {
    if (this.drainFramesRemaining === null) {
      return this.targetCharsPerFrame;
    }

    return Math.max(
      this.targetCharsPerFrame,
      Math.ceil(update.delta.length / this.drainFramesRemaining),
    );
  }

  private cancelScheduledFlush(): void {
    if (this.flushHandle === null) return;

    if (this.flushScheduler === "animationFrame") {
      const browserWindow = globalThis.window as Window | undefined;
      browserWindow?.cancelAnimationFrame?.(this.flushHandle as number);
    } else {
      clearTimeout(this.flushHandle as ReturnType<typeof setTimeout>);
    }
    this.flushHandle = null;
    this.flushScheduler = null;
  }

  private getBufferedDeltaLength(conversationId?: string): number {
    let length = 0;
    for (const update of this.buffers.values()) {
      if (conversationId && update.conversationId !== conversationId) continue;
      length += update.delta.length;
    }
    return length;
  }

  private finishDrainCallbacks(): void {
    this.drainFramesRemaining = null;
    if (this.drainCallbacks.length === 0) {
      return;
    }

    const callbacks = this.drainCallbacks.splice(0);
    for (const { callback } of callbacks) {
      callback();
    }
  }

  private canUseAnimationFrame(): boolean {
    const browserWindow = globalThis.window as Window | undefined;
    if (!browserWindow || typeof browserWindow.requestAnimationFrame !== "function") {
      return false;
    }
    const documentLike = globalThis.document as Document | undefined;
    return !documentLike || documentLike.visibilityState === "visible";
  }

  private buildKey(update: OwnerTextDeltaUpdate): string {
    const turnKey = update.turnId ?? "null";
    switch (update.target.type) {
      case "agentMessage":
      case "plan":
        return `${update.conversationId}:${turnKey}:${update.itemId}:${update.target.type}`;
      case "reasoningSummary":
        return `${update.conversationId}:${turnKey}:${update.itemId}:reasoningSummary:${update.target.summaryIndex}`;
      case "reasoningContent":
        return `${update.conversationId}:${turnKey}:${update.itemId}:reasoningContent:${update.target.contentIndex}`;
    }
  }
}

class OutputDeltaQueue {
  private readonly buffers = new Map<string, OutputDeltaUpdate>();
  private flushHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onFlush: (updates: OutputDeltaUpdate[]) => void,
    private readonly flushIntervalMs = OUTPUT_DELTA_FLUSH_MS,
  ) {}

  enqueue(update: OutputDeltaUpdate): void {
    const key = `${update.hostId}:${update.conversationId}:${update.turnId ?? "null"}:${update.itemId}`;
    const existing = this.buffers.get(key);
    const merged = truncateBufferedOutput({
      existingText: existing?.delta ?? "",
      nextDelta: update.delta,
    });
    this.buffers.set(key, {
      ...update,
      delta: merged.text,
      truncated: Boolean(existing?.truncated) || merged.truncated,
      ownerNotificationSequence: Math.max(
        existing?.ownerNotificationSequence ?? 0,
        update.ownerNotificationSequence ?? 0,
      ) || undefined,
    });
    this.scheduleFlush();
  }

  flushNow(): void {
    this.cancelScheduledFlush();
    if (this.buffers.size === 0) return;
    const updates = Array.from(this.buffers.values());
    this.buffers.clear();
    this.onFlush(updates);
  }

  cancel(): void {
    this.cancelScheduledFlush();
    this.buffers.clear();
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }

  private cancelScheduledFlush(): void {
    if (this.flushHandle === null) return;
    clearTimeout(this.flushHandle);
    this.flushHandle = null;
  }
}

function sortThreadSummaries(threads: CodexThreadSummary[]): CodexThreadSummary[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

function upsertThreadSummary(
  threads: CodexThreadSummary[],
  thread: CodexThreadSummary,
): CodexThreadSummary[] {
  const existing = threads.find((candidate) => candidate.threadId === thread.threadId);
  if (!existing) {
    return sortThreadSummaries([thread, ...threads]);
  }

  return sortThreadSummaries(
    threads.map((candidate) => candidate.threadId === thread.threadId ? thread : candidate),
  );
}

function areThreadSummariesEqual(
  left: CodexThreadSummary[],
  right: CodexThreadSummary[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!areThreadSummariesStructurallyEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function areThreadSummariesStructurallyEqual(
  left: CodexThreadSummary,
  right: CodexThreadSummary,
): boolean {
  return (
    left.threadId === right.threadId
    && left.projectId === right.projectId
    && left.source?.parentThreadId === right.source?.parentThreadId
    && left.source?.sideConversation === right.source?.sideConversation
    && left.source?.sideConversationParentNavigationPath === right.source?.sideConversationParentNavigationPath
    && left.ephemeral === right.ephemeral
    && left.threadSource === right.threadSource
    && left.threadName === right.threadName
    && left.threadPreview === right.threadPreview
    && left.modelProvider === right.modelProvider
    && left.cwd === right.cwd
    && left.statusType === right.statusType
    && left.statusActiveFlags.join("|") === right.statusActiveFlags.join("|")
    && left.archived === right.archived
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.linkedAt === right.linkedAt
  );
}

function areConversationMapSelectionsEqual(
  left: Record<string, CodexConversationSnapshot>,
  right: Record<string, CodexConversationSnapshot>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function subscribeSet<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOrCreateListenerSet<T>(
  callbacksByKey: Map<string, Set<T>>,
  key: string,
): Set<T> {
  const existing = callbacksByKey.get(key);
  if (existing) {
    return existing;
  }

  const listeners = new Set<T>();
  callbacksByKey.set(key, listeners);
  return listeners;
}

function cleanupListenerSet<T>(
  callbacksByKey: Map<string, Set<T>>,
  key: string,
): void {
  const listeners = callbacksByKey.get(key);
  if (listeners && listeners.size === 0) {
    callbacksByKey.delete(key);
  }
}

function getThreadStartProgressTargetKey(projectId: string | null, sessionId: string | null): string {
  return `${projectId ?? "projectless"}:${sessionId ?? "sessionless"}`;
}

function applyTerminalOutputDelta(input: {
  existingText: string;
  outputDelta: string;
  outputCarriageReturnPending: boolean;
}): { outputText: string; outputCarriageReturnPending: boolean } {
  let outputText = input.existingText;
  let outputCarriageReturnPending = input.outputCarriageReturnPending;

  for (const character of input.outputDelta) {
    if (outputCarriageReturnPending) {
      if (character === "\n") {
        outputText += "\n";
        outputCarriageReturnPending = false;
        continue;
      }

      const lastLineBreakIndex = outputText.lastIndexOf("\n");
      outputText = lastLineBreakIndex >= 0 ? outputText.slice(0, lastLineBreakIndex + 1) : "";
      outputCarriageReturnPending = false;
    }

    if (character === "\r") {
      outputCarriageReturnPending = true;
      continue;
    }

    if (character === "\b") {
      if (outputText.length > 0) {
        outputText = outputText.slice(0, -1);
      }
      continue;
    }

    outputText += character;
  }

  return {
    outputText,
    outputCarriageReturnPending,
  };
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

interface ConversationAnyProjection {
  id: string;
  requestsRef: readonly unknown[];
  turnsLength: number;
  lastTurnId: string | null;
  lastTurnStatus: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  title: string | null;
  resumeState: CodexConversationSnapshot["resumeState"];
  statusType: CodexConversationSnapshot["statusType"];
  statusActiveFlags: readonly string[];
  cwd: string | null;
}

interface ConversationMetaProjection {
  id: string;
  projectId: string | null;
  archived: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  title: string | null;
  threadPreview: string;
  resumeState: CodexConversationSnapshot["resumeState"];
  statusType: CodexConversationSnapshot["statusType"];
  statusActiveFlags: readonly string[];
}

interface ConversationSummaryFields {
  threadId: string | null;
  projectId: string | null;
  threadName: string | null;
  threadPreview: string;
  modelProvider: string | null;
  cwd: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

function buildConversationAnyProjection(conversation: CodexConversationSnapshot): ConversationAnyProjection {
  const lastTurn = conversation.turns[conversation.turns.length - 1] ?? null;
  return {
    id: conversation.threadId,
    requestsRef: conversation.requests,
    turnsLength: conversation.turns.length,
    lastTurnId: lastTurn?.turnId ?? null,
    lastTurnStatus: lastTurn?.status ?? null,
    createdAtMs: conversation.createdAt,
    updatedAtMs: conversation.updatedAt,
    title: conversation.threadName?.trim() || conversation.threadPreview?.trim() || null,
    resumeState: conversation.resumeState,
    statusType: conversation.statusType,
    statusActiveFlags: conversation.statusActiveFlags,
    cwd: conversation.cwd,
  };
}

function buildConversationMetaProjection(conversation: CodexConversationSnapshot): ConversationMetaProjection {
  return {
    id: conversation.threadId,
    projectId: conversation.projectId,
    archived: conversation.archived,
    createdAtMs: conversation.createdAt,
    updatedAtMs: conversation.updatedAt,
    title: conversation.threadName?.trim() || null,
    threadPreview: conversation.threadPreview,
    resumeState: conversation.resumeState,
    statusType: conversation.statusType,
    statusActiveFlags: conversation.statusActiveFlags,
  };
}

function areConversationAnyProjectionsEqual(
  left: ConversationAnyProjection,
  right: ConversationAnyProjection,
): boolean {
  return (
    left.id === right.id
    && left.requestsRef === right.requestsRef
    && left.turnsLength === right.turnsLength
    && left.lastTurnId === right.lastTurnId
    && left.lastTurnStatus === right.lastTurnStatus
    && left.createdAtMs === right.createdAtMs
    && left.updatedAtMs === right.updatedAtMs
    && left.title === right.title
    && left.resumeState === right.resumeState
    && left.statusType === right.statusType
    && areStringArraysEqual(left.statusActiveFlags, right.statusActiveFlags)
    && left.cwd === right.cwd
  );
}

function areConversationMetaProjectionsEqual(
  left: ConversationMetaProjection,
  right: ConversationMetaProjection,
): boolean {
  return (
    left.id === right.id
    && left.projectId === right.projectId
    && left.archived === right.archived
    && left.createdAtMs === right.createdAtMs
    && left.updatedAtMs === right.updatedAtMs
    && left.title === right.title
    && left.threadPreview === right.threadPreview
    && left.resumeState === right.resumeState
    && left.statusType === right.statusType
    && areStringArraysEqual(left.statusActiveFlags, right.statusActiveFlags)
  );
}

function areConversationSummaryFieldsEqual(
  left: ConversationSummaryFields,
  right: ConversationSummaryFields,
): boolean {
  return (
    left.threadId === right.threadId
    && left.projectId === right.projectId
    && left.threadName === right.threadName
    && left.threadPreview === right.threadPreview
    && left.modelProvider === right.modelProvider
    && left.cwd === right.cwd
    && left.archived === right.archived
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.linkedAt === right.linkedAt
  );
}

function isConversationUserMessageItem(item: CodexConversationItem): boolean {
  return item.kind === "userMessage" || item.semanticKind === "userMessage";
}

function conversationTurnHasUserMessage(turn: CodexConversationTurn): boolean {
  return turn.items.some(isConversationUserMessageItem);
}

function resolveLatestEditableUserTurnId(conversation: CodexConversationSnapshot): string | null {
  const latestTurn = conversation.turns.at(-1) ?? null;
  if (!latestTurn || latestTurn.status === "inProgress") return null;
  if (!conversationTurnHasUserMessage(latestTurn)) return null;

  const hasPendingRequest = conversation.requests.some((request) => request.turnId === latestTurn.turnId);
  if (hasPendingRequest) return null;

  return latestTurn.turnId;
}

function areConversationCapabilityFlagsEqual(
  left: CodexConversationCapabilityFlags | undefined,
  right: CodexConversationCapabilityFlags,
): boolean {
  return Boolean(
    left
      && left.canEditLastUserTurn === right.canEditLastUserTurn
      && left.canForkFromTurn === right.canForkFromTurn
      && left.canSearch === right.canSearch
      && left.canCollapseTurns === right.canCollapseTurns,
  );
}

function deriveConversationCapabilityFlags(
  conversation: CodexConversationSnapshot,
): CodexConversationCapabilityFlags {
  if (conversation.source?.sideConversation === true) {
    return {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: true,
      canCollapseTurns: true,
    };
  }

  const isConversationActionable = !conversation.archived && conversation.statusType !== "systemError";
  return {
    canEditLastUserTurn: Boolean(isConversationActionable && resolveLatestEditableUserTurnId(conversation)),
    canForkFromTurn: Boolean(isConversationActionable && conversation.turns.length > 0),
    canSearch: true,
    canCollapseTurns: true,
  };
}

function normalizeConversationSnapshot(
  conversation: CodexConversationSnapshot,
): CodexConversationSnapshot {
  const nextTurns = Array.isArray(conversation.turns) ? conversation.turns : [];
  const nextRequests = Array.isArray(conversation.requests) ? conversation.requests : [];
  const nextPendingSteers = Array.isArray(conversation.pendingSteers) ? conversation.pendingSteers : [];
  const nextQueuedFollowUps = Array.isArray(conversation.queuedFollowUps) ? conversation.queuedFollowUps : [];
  const nextBackgroundTerminalRows = Array.isArray(conversation.backgroundTerminalRows)
    ? conversation.backgroundTerminalRows
    : [];
  const nextChildMemberships = Array.isArray(conversation.childMemberships)
    ? conversation.childMemberships
    : [];
  const nextStatusActiveFlags = Array.isArray(conversation.statusActiveFlags)
    ? conversation.statusActiveFlags
    : [];
  const nextThreadName = typeof conversation.threadName === "string" ? conversation.threadName : "";
  const nextThreadPreview = typeof conversation.threadPreview === "string" ? conversation.threadPreview : "";
  const nextCreatedAt = Number.isFinite(conversation.createdAt) ? conversation.createdAt : 0;
  const nextUpdatedAt = Number.isFinite(conversation.updatedAt) ? conversation.updatedAt : nextCreatedAt;
  const nextSource: CodexConversationSource | null = typeof conversation.source === "object" && conversation.source !== null
    ? {
        parentThreadId:
          typeof conversation.source.parentThreadId === "string" && conversation.source.parentThreadId.trim().length > 0
            ? conversation.source.parentThreadId
            : null,
        ...(conversation.source.sideConversation === true ? { sideConversation: true } : {}),
        ...(typeof conversation.source.sideConversationParentNavigationPath === "string"
          ? { sideConversationParentNavigationPath: conversation.source.sideConversationParentNavigationPath }
          : conversation.source.sideConversation === true
            ? { sideConversationParentNavigationPath: null }
            : {}),
      }
    : null;

  const didChange =
    nextTurns !== conversation.turns
    || nextRequests !== conversation.requests
    || nextPendingSteers !== conversation.pendingSteers
    || nextQueuedFollowUps !== conversation.queuedFollowUps
    || nextBackgroundTerminalRows !== conversation.backgroundTerminalRows
    || nextChildMemberships !== conversation.childMemberships
    || nextStatusActiveFlags !== conversation.statusActiveFlags
    || nextSource?.parentThreadId !== conversation.source?.parentThreadId
    || nextSource?.sideConversation !== conversation.source?.sideConversation
    || nextSource?.sideConversationParentNavigationPath !== conversation.source?.sideConversationParentNavigationPath
    || nextThreadName !== conversation.threadName
    || nextThreadPreview !== conversation.threadPreview
    || nextCreatedAt !== conversation.createdAt
    || nextUpdatedAt !== conversation.updatedAt;

  const normalizedConversation = didChange
    ? {
        ...conversation,
        source: nextSource,
        threadName: nextThreadName,
        threadPreview: nextThreadPreview,
        createdAt: nextCreatedAt,
        updatedAt: nextUpdatedAt,
        turns: nextTurns,
        requests: nextRequests,
        pendingSteers: nextPendingSteers,
        queuedFollowUps: nextQueuedFollowUps,
        backgroundTerminalRows: nextBackgroundTerminalRows,
        childMemberships: nextChildMemberships,
        statusActiveFlags: nextStatusActiveFlags,
      }
    : conversation;
  const nextCapabilityFlags = deriveConversationCapabilityFlags(normalizedConversation);

  if (areConversationCapabilityFlagsEqual(normalizedConversation.capabilityFlags, nextCapabilityFlags)) {
    return normalizedConversation;
  }

  return {
    ...normalizedConversation,
    capabilityFlags: nextCapabilityFlags,
  };
}

function isRunningCommandExecutionItem(item: CodexConversationItem): boolean {
  return item.kind === "commandExecution" && item.status === "inProgress";
}

function applyOwnerBackgroundTerminalCleanupToConversation(
  conversation: CodexConversationSnapshot,
): CodexConversationSnapshot | null {
  const nextTurns = conversation.turns.map((turn) => {
    const runningCommandIds = turn.items
      .filter(isRunningCommandExecutionItem)
      .map((item) => item.itemId);
    if (runningCommandIds.length === 0) {
      return turn;
    }

    const nextInterruptedIds = new Set(turn.interruptedCommandExecutionItemIds ?? []);
    const previousSize = nextInterruptedIds.size;
    for (const itemId of runningCommandIds) {
      nextInterruptedIds.add(itemId);
    }
    if (nextInterruptedIds.size === previousSize) {
      return turn;
    }

    return {
      ...turn,
      interruptedCommandExecutionItemIds: [...nextInterruptedIds],
    };
  });

  const hadBackgroundRows = conversation.backgroundTerminalRows.length > 0;
  const didChangeTurns = nextTurns.some((turn, index) => turn !== conversation.turns[index]);
  if (!didChangeTurns && !hadBackgroundRows) {
    return null;
  }

  return {
    ...conversation,
    turns: nextTurns,
    backgroundTerminalRows: hadBackgroundRows ? [] : conversation.backgroundTerminalRows,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function isProseRecord(record: Record<string, unknown>): boolean {
  return record.role === "assistant" ||
    record.kind === "assistantMessage" ||
    record.kind === "plan" ||
    record.kind === "reasoning" ||
    record.semanticKind === "assistantMessage" ||
    record.semanticKind === "proposedPlan" ||
    record.semanticKind === "reasoning";
}

function isInProgressProsePatchValue(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.status === "inProgress" &&
      typeof record.markdownText === "string" &&
      isProseRecord(record),
  );
}

function patchValueContainsInProgressProse(value: unknown): boolean {
  if (isInProgressProsePatchValue(value)) return true;
  if (!Array.isArray(value)) return false;

  return value.some((entry) => patchValueContainsInProgressProse(entry));
}

function conversationHasInProgressProseItem(conversation: CodexConversationSnapshot): boolean {
  for (const turn of conversation.turns) {
    for (const item of turn.items) {
      if (
        item.status === "inProgress" &&
        typeof item.markdownText === "string" &&
        isProseRecord(item as unknown as Record<string, unknown>)
      ) {
        return true;
      }
    }
  }

  return false;
}

function shouldSynchronouslyNotifyStreamingProsePatch(
  nextConversation: CodexConversationSnapshot,
  patches: OwnerStreamPublishPatches,
): boolean {
  for (const patch of patches) {
    if (patch.path.includes("markdownText") && conversationHasInProgressProseItem(nextConversation)) {
      return true;
    }

    if (patch.op !== "remove" && patchValueContainsInProgressProse(patch.value)) {
      return true;
    }
  }

  return false;
}

function getString(candidate: Record<string, unknown>, key: string): string | null {
  const value = candidate[key];
  return typeof value === "string" ? value : null;
}

function getNumber(candidate: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getOwnerLatestTurnIndex(conversation: CodexConversationSnapshot): number {
  return conversation.turns.length > 0 ? conversation.turns.length - 1 : -1;
}

function getOwnerTurnId(turn: CodexConversationTurn): string | null {
  const value = (turn as { turnId?: unknown }).turnId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function replaceOwnerTurnAt(
  conversation: CodexConversationSnapshot,
  turnIndex: number,
  turn: CodexConversationTurn,
): CodexConversationSnapshot {
  const turns = [...conversation.turns];
  turns[turnIndex] = turn;
  return {
    ...conversation,
    turns,
  };
}

function appendOwnerTurn(
  conversation: CodexConversationSnapshot,
  turn: CodexConversationTurn,
): CodexConversationSnapshot {
  return {
    ...conversation,
    turns: [...conversation.turns, turn],
  };
}

function isOwnerCompletedEmptyPlaceholderTurn(turn: CodexConversationTurn): boolean {
  return getOwnerTurnId(turn) === null
    && turn.status === "completed"
    && turn.errorMessage == null
    && turn.items.length === 0;
}

interface OwnerTurnResolutionOptions {
  rebindLatestInProgressPlaceholder?: boolean;
  synthesizeMissingTurn?: boolean;
  allowCompletedEmptyPlaceholderRebind?: boolean;
  observedAtMs?: number;
}

function resolveOwnerTurnReference(
  conversation: CodexConversationSnapshot,
  turnId: string | null,
  options: OwnerTurnResolutionOptions = {},
): {
  conversation: CodexConversationSnapshot;
  turnIndex: number;
} | null {
  const latestTurnIndex = getOwnerLatestTurnIndex(conversation);
  if (latestTurnIndex < 0) return null;

  if (turnId === null) {
    return {
      conversation,
      turnIndex: latestTurnIndex,
    };
  }

  const existingTurnIndex = conversation.turns.findIndex((turn) => getOwnerTurnId(turn) === turnId);
  if (existingTurnIndex >= 0) {
    return {
      conversation,
      turnIndex: existingTurnIndex,
    };
  }

  const latestTurn = conversation.turns[latestTurnIndex];
  if (!latestTurn) return null;

  const observedAtMs = options.observedAtMs ?? Date.now();
  if (
    options.rebindLatestInProgressPlaceholder &&
    getOwnerTurnId(latestTurn) === null &&
    latestTurn.status === "inProgress"
  ) {
    const nextTurn: CodexConversationTurn = {
      ...latestTurn,
      turnId,
      turnStartedAtMs: latestTurn.turnStartedAtMs ?? observedAtMs,
    };
    return {
      conversation: replaceOwnerTurnAt(conversation, latestTurnIndex, nextTurn),
      turnIndex: latestTurnIndex,
    };
  }

  if (
    options.allowCompletedEmptyPlaceholderRebind !== false &&
    conversation.turns.length === 1 &&
    isOwnerCompletedEmptyPlaceholderTurn(latestTurn)
  ) {
    const nextTurn: CodexConversationTurn = {
      ...latestTurn,
      turnId,
      status: "inProgress",
      turnStartedAtMs: latestTurn.turnStartedAtMs ?? observedAtMs,
    };
    return {
      conversation: replaceOwnerTurnAt(conversation, latestTurnIndex, nextTurn),
      turnIndex: latestTurnIndex,
    };
  }

  if (options.synthesizeMissingTurn) {
    const synthesizedTurn: CodexConversationTurn = {
      ...latestTurn,
      turnId,
      status: "inProgress",
      errorMessage: undefined,
      diff: undefined,
      durationMs: null,
      turnStartedAtMs: observedAtMs,
      firstTurnWorkItemStartedAtMs: null,
      finalAssistantStartedAtMs: null,
      itemIds: [],
      items: [],
    };
    return {
      conversation: appendOwnerTurn(conversation, synthesizedTurn),
      turnIndex: conversation.turns.length,
    };
  }

  return null;
}

function findOwnerTurnItemByItemId(
  conversation: CodexConversationSnapshot,
  itemId: string,
): {
  turnIndex: number;
  itemIndex: number;
  turn: CodexConversationTurn;
  item: CodexConversationItem;
} | null {
  for (let turnIndex = conversation.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = conversation.turns[turnIndex];
    if (!turn) continue;

    const itemIndex = turn.items.findIndex((candidate) => candidate.itemId === itemId);
    const item = itemIndex >= 0 ? turn.items[itemIndex] : null;
    if (item) {
      return {
        turnIndex,
        itemIndex,
        turn,
        item,
      };
    }
  }

  return null;
}

function readOwnerStreamingDebugItemState(
  conversation: CodexConversationSnapshot,
  itemId: string,
): Record<string, unknown> {
  const target = findOwnerTurnItemByItemId(conversation, itemId);
  if (!target) {
    return { found: false };
  }

  return {
    found: true,
    turnId: target.turn.turnId ?? null,
    turnStatus: target.turn.status,
    itemStatus: target.item.status ?? null,
    itemKind: target.item.kind,
    itemSemanticKind: target.item.semanticKind ?? null,
    markdownLength: target.item.markdownText?.length ?? 0,
  };
}

function buildUnknownCommandActions(commands: readonly string[]): CodexCommandAction[] {
  return commands.map((command) => ({
    type: "unknown",
    command,
  }));
}

function applyOwnerTerminalInteractionToConversation(
  conversation: CodexConversationSnapshot,
  payload: OwnerTerminalInteractionPayload,
  commands: readonly string[],
): CodexConversationSnapshot | null {
  if (commands.length === 0) return conversation;

  const target = findOwnerTurnItemByItemId(conversation, payload.itemId);
  if (!target || target.item.kind !== "commandExecution") return null;

  const { turnIndex, itemIndex, turn, item } = target;
  const commandActions = [
    ...(item.commandActions ?? []),
    ...buildUnknownCommandActions(commands),
  ];
  const toolCallArgs = item.toolCall?.args && typeof item.toolCall.args === "object"
    ? {
        ...(item.toolCall.args as Record<string, unknown>),
        commandActions,
      }
    : item.toolCall?.args;
  const rawItem = item.rawItem && typeof item.rawItem === "object"
    ? {
        ...(item.rawItem as Record<string, unknown>),
        commandActions,
      }
    : item.rawItem;
  const nextItem: CodexConversationItem = {
    ...item,
    commandActions,
    updatedAt: payload.observedAtMs,
    toolCall: item.toolCall
      ? {
          ...item.toolCall,
          args: toolCallArgs,
        }
      : item.toolCall,
    rawItem,
  };
  const nextItems = [...turn.items];
  nextItems[itemIndex] = nextItem;
  const nextTurns = [...conversation.turns];
  nextTurns[turnIndex] = {
    ...turn,
    items: nextItems,
  };

  return {
    ...conversation,
    turns: nextTurns,
  };
}

function buildRecentConversationOrderKey(conversations: readonly CodexConversationSnapshot[]): string {
  return conversations
    .map((conversation) =>
      `${conversation.threadId}:${conversation.updatedAt}:${conversation.resumeState}:${conversation.statusType}`,
    )
    .join("|");
}

function ownerTextDeltaItemMatchesTarget(
  item: CodexConversationItem,
  target: OwnerTextDeltaTarget,
): boolean {
  if (target.type === "agentMessage") {
    return item.kind === "assistantMessage" || item.semanticKind === "assistantMessage";
  }

  if (target.type === "plan") {
    return item.kind === "plan" || item.semanticKind === "proposedPlan";
  }

  return item.kind === "reasoning" || item.semanticKind === "reasoning";
}

function applyOwnerTextDeltaToConversation(
  conversation: CodexConversationSnapshot,
  update: OwnerTextDeltaUpdate,
): CodexConversationSnapshot | null {
  const resolved = resolveOwnerTurnReference(conversation, update.turnId, {
    observedAtMs: update.observedAtMs,
  });
  if (!resolved) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex]!;
  const itemIndex = turn.items.findIndex((item) => item.itemId === update.itemId);
  if (itemIndex < 0) return null;

  const item = turn.items[itemIndex]!;
  if (!ownerTextDeltaItemMatchesTarget(item, update.target)) return null;

  const shouldMarkItemInProgress =
    item.status !== "failed" &&
    item.status !== "interrupted";
  let nextItem = item;
  if (update.target.type === "agentMessage" || update.target.type === "plan") {
    nextItem = {
      ...item,
      status: shouldMarkItemInProgress ? "inProgress" : item.status,
      markdownText: `${item.markdownText ?? ""}${update.delta}`,
      updatedAt: update.observedAtMs,
    };
  } else {
    const buffers = parseCodexReasoningBuffers(item.rawItem);
    const summary = [...buffers.summary];
    const content = [...buffers.content];
    if (update.target.type === "reasoningSummary") {
      while (summary.length <= update.target.summaryIndex) summary.push("");
      summary[update.target.summaryIndex] = `${summary[update.target.summaryIndex] ?? ""}${update.delta}`;
    } else {
      while (content.length <= update.target.contentIndex) content.push("");
      content[update.target.contentIndex] = `${content[update.target.contentIndex] ?? ""}${update.delta}`;
    }
    nextItem = {
      ...item,
      status: shouldMarkItemInProgress ? "inProgress" : item.status,
      markdownText: projectCodexReasoningSummary(summary),
      rawItem: {
        ...(typeof item.rawItem === "object" && item.rawItem !== null ? item.rawItem as Record<string, unknown> : {}),
        summary,
        content,
      },
      updatedAt: update.observedAtMs,
    };
  }

  const nextItems = [...turn.items];
  nextItems[itemIndex] = nextItem;
  const nextTurn: CodexConversationTurn = {
    ...turn,
    ...(update.target.type === "agentMessage"
      ? {
          turnStartedAtMs: turn.turnStartedAtMs ?? update.observedAtMs,
          finalAssistantStartedAtMs: update.observedAtMs,
        }
      : {}),
    itemIds: turn.itemIds,
    items: nextItems,
  };
  const nextTurns = [...resolved.conversation.turns];
  nextTurns[resolved.turnIndex] = nextTurn;

  return {
    ...resolved.conversation,
    turns: nextTurns,
    updatedAt: Math.max(resolved.conversation.updatedAt, update.observedAtMs),
  };
}

interface OwnerItemLifecyclePayload {
  threadId: string;
  turnId: string | null;
  item: unknown;
  observedAtMs: number;
}

function parseOwnerItemLifecyclePayload(
  method: "item/started" | "item/completed",
  params: unknown,
): OwnerItemLifecyclePayload | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  if (!threadId || !Object.prototype.hasOwnProperty.call(payload, "item")) {
    return null;
  }

  const observedAtMs = getNumber(
    payload,
    method === "item/started"
      ? ["startedAtMs", "started_at_ms"]
      : ["completedAtMs", "completed_at_ms"],
  ) ?? Date.now();

  return {
    threadId,
    turnId,
    item: payload.item,
    observedAtMs,
  };
}

function getProtocolItemType(item: unknown): string | null {
  const candidate = asRecord(item);
  return candidate ? getString(candidate, "type") : null;
}

function isFirstOwnerTurnWorkItem(item: CodexConversationItem): boolean {
  if (item.kind === "userMessage" || item.kind === "assistantMessage") {
    return false;
  }

  switch (item.semanticKind) {
    case "modelChanged":
    case "modelRerouted":
    case "remoteTaskCreated":
    case "personalityChanged":
    case "forkedFromConversation":
    case "steered":
      return false;
    default:
      return true;
  }
}

function normalizeOwnerLifecycleItem(
  payload: OwnerItemLifecyclePayload,
  lifecycleStatus: "inProgress" | "completed",
  turnId: string,
): CodexConversationItem | null {
  const normalizedItem = normalizeThreadItem(payload.item, payload.threadId, turnId);
  if (!normalizedItem) return null;

  if (normalizedItem.status) {
    return projectCodexItemViewToTranscriptEntry(normalizedItem, "live", 0);
  }

  return projectCodexItemViewToTranscriptEntry({
    ...normalizedItem,
    status: lifecycleStatus,
    markdownText: normalizedItem.semanticKind === "contextCompaction"
      ? resolveContextCompactionMarkdown(lifecycleStatus)
      : normalizedItem.markdownText,
  }, "live", 0);
}

function canCompleteWithoutStartedItem(protocolItemType: string | null): boolean {
  return protocolItemType === "userMessage"
    || protocolItemType === "hookPrompt"
    || protocolItemType === "subAgentActivity";
}

function projectConversationItemToIdentityView(item: CodexConversationItem): CodexItemView {
  return {
    ...item,
    normalizedKind: item.kind,
  } as CodexItemView;
}

function canMergeOwnerConversationItem(
  existing: CodexConversationItem,
  incoming: CodexConversationItem,
): boolean {
  return canMergeSyntheticTextDuplicate(
    projectConversationItemToIdentityView(existing),
    projectConversationItemToIdentityView(incoming),
  );
}

function mergeOwnerConversationItem(
  existing: CodexConversationItem,
  incoming: CodexConversationItem,
): CodexConversationItem {
  const { normalizedKind, ...merged } = mergeCodexItemView(
    projectConversationItemToIdentityView(existing),
    projectConversationItemToIdentityView(incoming),
  );

  return {
    ...existing,
    ...merged,
    entryId: merged.itemId,
    kind: normalizedKind,
    source: incoming.source ?? existing.source,
    sequence: existing.sequence ?? incoming.sequence,
    requestId: incoming.requestId ?? existing.requestId,
  };
}

function findOwnerConversationItemMergeIndex(
  items: CodexConversationItem[],
  incoming: CodexConversationItem,
): number {
  const primaryIndex = items.findIndex((candidate) => candidate.itemId === incoming.itemId);
  if (primaryIndex >= 0) return primaryIndex;

  return items.findIndex((candidate) => canMergeOwnerConversationItem(candidate, incoming));
}

function applyOwnerItemLifecycleToConversation(
  conversation: CodexConversationSnapshot,
  method: "item/started" | "item/completed",
  payload: OwnerItemLifecyclePayload,
): CodexConversationSnapshot | null {
  const lifecycleStatus = method === "item/started" ? "inProgress" : "completed";
  const protocolItemType = getProtocolItemType(payload.item);
  const resolved = (() => {
    if (method === "item/started") {
      return resolveOwnerTurnReference(conversation, payload.turnId, {
        rebindLatestInProgressPlaceholder: protocolItemType === "contextCompaction",
        synthesizeMissingTurn: true,
        observedAtMs: payload.observedAtMs,
      });
    }

    if (protocolItemType === "userMessage") {
      return resolveOwnerTurnReference(conversation, payload.turnId, {
        observedAtMs: payload.observedAtMs,
      });
    }

    if (payload.turnId === null) {
      return resolveOwnerTurnReference(conversation, null, {
        observedAtMs: payload.observedAtMs,
      });
    }

    return resolveOwnerTurnReference(conversation, payload.turnId, {
      allowCompletedEmptyPlaceholderRebind: false,
      observedAtMs: payload.observedAtMs,
    });
  })();
  if (!resolved) return null;

  const resolvedTurnId = getOwnerTurnId(resolved.conversation.turns[resolved.turnIndex]!);
  if (!resolvedTurnId) return null;

  const item = normalizeOwnerLifecycleItem(payload, lifecycleStatus, resolvedTurnId);
  if (!item) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex]!;
  const existingItemIndex = findOwnerConversationItemMergeIndex(turn.items, item);
  if (
    method === "item/completed" &&
    existingItemIndex < 0 &&
    !canCompleteWithoutStartedItem(protocolItemType)
  ) {
    return null;
  }

  const nextItem: CodexConversationItem = existingItemIndex >= 0
    ? mergeOwnerConversationItem(turn.items[existingItemIndex]!, item)
    : {
        ...item,
        sequence: turn.items.length,
      };
  const nextItems = [...turn.items];
  if (existingItemIndex >= 0) {
    nextItems[existingItemIndex] = nextItem;
  } else {
    nextItems.push(nextItem);
  }

  const nextItemIds = nextItems.map((nextTurnItem) => nextTurnItem.itemId);
  const shouldMarkAssistantStarted =
    method === "item/started" &&
    (nextItem.kind === "assistantMessage" || nextItem.semanticKind === "assistantMessage");
  const shouldMarkWorkItemStarted =
    isFirstOwnerTurnWorkItem(nextItem) &&
    turn.firstTurnWorkItemStartedAtMs == null;
  const nextTurn: CodexConversationTurn = {
    ...turn,
    status: method === "item/started" ? "inProgress" : turn.status,
    turnStartedAtMs: turn.turnStartedAtMs ?? payload.observedAtMs,
    firstTurnWorkItemStartedAtMs: shouldMarkWorkItemStarted
      ? payload.observedAtMs
      : turn.firstTurnWorkItemStartedAtMs,
    finalAssistantStartedAtMs: shouldMarkAssistantStarted
      ? payload.observedAtMs
      : turn.finalAssistantStartedAtMs,
    itemIds: nextItemIds,
    items: nextItems,
  };
  const nextTurns = [...resolved.conversation.turns];
  nextTurns[resolved.turnIndex] = nextTurn;

  return {
    ...resolved.conversation,
    turns: nextTurns,
    updatedAt: Math.max(resolved.conversation.updatedAt, payload.observedAtMs, nextItem.updatedAt),
  };
}

interface OwnerFileChangePatchUpdatedPayload {
  threadId: string;
  turnId: string | null;
  itemId: string;
  changes: unknown[];
  observedAtMs: number;
}

function parseOwnerFileChangePatchUpdatedPayload(params: unknown): OwnerFileChangePatchUpdatedPayload | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const itemId = getString(payload, "itemId");
  if (!threadId || !itemId || !Array.isArray(payload.changes)) return null;

  return {
    threadId,
    turnId: getString(payload, "turnId"),
    itemId,
    changes: payload.changes,
    observedAtMs: Date.now(),
  };
}

function buildOwnerFileChangePatchItem(
  payload: OwnerFileChangePatchUpdatedPayload,
  turnId: string,
  existing: CodexConversationItem | null,
): CodexConversationItem | null {
  const normalizedItem = normalizeThreadItem({
    id: payload.itemId,
    type: "fileChange",
    status: "inProgress",
    changes: payload.changes,
  }, payload.threadId, turnId);
  if (!normalizedItem) return null;

  return projectCodexItemViewToTranscriptEntry({
    ...normalizedItem,
    status: normalizedItem.status ?? "inProgress",
    createdAt: existing?.createdAt ?? normalizedItem.createdAt,
    updatedAt: payload.observedAtMs,
  }, "live", existing?.sequence ?? 0);
}

function applyOwnerFileChangePatchUpdatedToConversation(
  conversation: CodexConversationSnapshot,
  payload: OwnerFileChangePatchUpdatedPayload,
): CodexConversationSnapshot | null {
  const resolved = resolveOwnerTurnReference(conversation, payload.turnId, {
    rebindLatestInProgressPlaceholder: true,
    observedAtMs: payload.observedAtMs,
  });
  if (!resolved) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex];
  if (!turn) return null;

  const resolvedTurnId = getOwnerTurnId(turn);
  if (!resolvedTurnId) return null;

  const existingItemIndex = turn.items.findIndex((item) =>
    item.itemId === payload.itemId && item.kind === "fileChange"
  );
  const existingItem = existingItemIndex >= 0 ? turn.items[existingItemIndex] ?? null : null;
  const nextItem = buildOwnerFileChangePatchItem(payload, resolvedTurnId, existingItem);
  if (!nextItem) return null;

  const sequencedItem: CodexConversationItem = existingItem
    ? {
        ...nextItem,
        createdAt: existingItem.createdAt,
        sequence: existingItem.sequence,
      }
    : {
        ...nextItem,
        sequence: turn.items.length,
      };

  const nextItems = [...turn.items];
  if (existingItemIndex >= 0) {
    nextItems[existingItemIndex] = sequencedItem;
  } else {
    nextItems.push(sequencedItem);
  }

  const existingItemIds = Array.isArray(turn.itemIds) ? turn.itemIds : [];
  const nextItemIds = existingItemIds.includes(sequencedItem.itemId)
    ? existingItemIds
    : [...existingItemIds, sequencedItem.itemId];
  const nextTurn: CodexConversationTurn = {
    ...turn,
    turnStartedAtMs: turn.turnStartedAtMs ?? payload.observedAtMs,
    firstTurnWorkItemStartedAtMs: turn.firstTurnWorkItemStartedAtMs ?? payload.observedAtMs,
    itemIds: nextItemIds,
    items: nextItems,
  };
  const nextTurns = [...resolved.conversation.turns];
  nextTurns[resolved.turnIndex] = nextTurn;

  return {
    ...resolved.conversation,
    turns: nextTurns,
    updatedAt: Math.max(resolved.conversation.updatedAt, payload.observedAtMs, sequencedItem.updatedAt),
  };
}

type OwnerTurnLifecycleMethod = "turn/started" | "turn/completed" | "turn/interrupted" | "turn/failed";

interface OwnerTurnLifecyclePayload {
  threadId: string;
  turnId: string;
  status: CodexTurnStatus;
  errorMessage?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  turnStartedAtMs?: number | null;
  durationMs?: number | null;
  observedAtMs: number;
}

function normalizeOwnerTurnStatus(value: unknown, fallback: CodexTurnStatus): CodexTurnStatus {
  if (value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress") {
    return value;
  }
  if (value === "in_progress") return "inProgress";
  return fallback;
}

function fallbackTurnStatusForMethod(method: OwnerTurnLifecycleMethod): CodexTurnStatus {
  if (method === "turn/started") return "inProgress";
  if (method === "turn/interrupted") return "interrupted";
  if (method === "turn/failed") return "failed";
  return "completed";
}

function normalizeOwnerTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 0 && value < 10_000_000_000) return value * 1000;
  return value;
}

function parseOwnerTurnErrorMessage(value: unknown): string | undefined {
  const candidate = asRecord(value);
  if (!candidate) return undefined;
  const message = getString(candidate, "message");
  return message ?? undefined;
}

function buildOwnerTextUserInput(text: string): UserInput {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

function isLikelyLocalImageSource(source: string): boolean {
  return source.startsWith("/") || source.startsWith("file://");
}

function buildOwnerUserInputItemsFromPromptInput(
  prompt: string,
  promptInput?: CodexPromptInput,
): UserInput[] {
  const input = promptInput ?? { text: prompt };
  const items: UserInput[] = [];
  const primaryText = input.text.trim();
  if (primaryText) {
    items.push(buildOwnerTextUserInput(primaryText));
  }

  for (const attachment of input.textAttachments ?? []) {
    const text = attachment.text.trim();
    if (text) {
      items.push(buildOwnerTextUserInput(text));
    }
  }

  for (const image of input.images ?? []) {
    const source = image.source.trim();
    if (!source) continue;
    items.push(isLikelyLocalImageSource(source)
      ? { type: "localImage", path: source.replace(/^file:\/\//, "") }
      : { type: "image", url: source });
  }

  for (const mention of input.mentions ?? []) {
    const name = mention.name.trim();
    const path = mention.path.trim();
    if (name && path) {
      items.push({ type: "mention", name, path });
    }
  }

  for (const skill of input.skills ?? []) {
    const name = skill.name.trim();
    const path = skill.path.trim();
    if (name && path) {
      items.push({ type: "skill", name, path });
    }
  }

  return items.length > 0 ? items : [buildOwnerTextUserInput(prompt.trim())];
}

function buildOwnerPromptInputFromUserInputItems(items: readonly UserInput[], fallbackText: string): CodexPromptInput {
  const promptInput: CodexPromptInput = { text: fallbackText };
  const textAttachments: CodexPromptInput["textAttachments"] = [];
  const images: CodexPromptInput["images"] = [];
  const mentions: CodexPromptInput["mentions"] = [];
  const skills: CodexPromptInput["skills"] = [];
  let didUsePrimaryText = false;

  for (const item of items) {
    if (item.type === "text") {
      const text = item.text.trim();
      if (!text) continue;
      if (!didUsePrimaryText) {
        promptInput.text = text;
        didUsePrimaryText = true;
      } else {
        textAttachments.push({ text });
      }
      continue;
    }

    if (item.type === "image") {
      images.push({ source: item.url });
      continue;
    }

    if (item.type === "localImage") {
      images.push({ source: item.path });
      continue;
    }

    if (item.type === "mention") {
      mentions.push({ name: item.name, path: item.path });
      continue;
    }

    if (item.type === "skill") {
      skills.push({ name: item.name, path: item.path });
    }
  }

  if (!didUsePrimaryText) {
    promptInput.text = fallbackText;
  }
  if (textAttachments.length > 0) promptInput.textAttachments = textAttachments;
  if (images.length > 0) promptInput.images = images;
  if (mentions.length > 0) promptInput.mentions = mentions;
  if (skills.length > 0) promptInput.skills = skills;
  return promptInput;
}

function readOwnerUserInputItemsFromItem(item: CodexConversationItem): UserInput[] {
  const rawItem = asRecord(item.rawItem);
  const content = Array.isArray(rawItem?.content) ? rawItem.content : [];
  const items: UserInput[] = [];

  for (const entry of content) {
    const input = asRecord(entry);
    if (!input) continue;
    const type = typeof input?.type === "string" ? input.type : "";
    if (type === "text") {
      const text = typeof input.text === "string" ? input.text : "";
      items.push(buildOwnerTextUserInput(text));
      continue;
    }
    if (type === "image") {
      const url = typeof input.url === "string"
        ? input.url
        : typeof input.source === "string"
          ? input.source
          : "";
      if (url) items.push({ type: "image", url });
      continue;
    }
    if (type === "localImage") {
      const path = typeof input.path === "string"
        ? input.path
        : typeof input.source === "string"
          ? input.source
          : "";
      if (path) items.push({ type: "localImage", path });
      continue;
    }
    if (type === "mention") {
      const name = typeof input.name === "string" ? input.name : "";
      const path = typeof input.path === "string" ? input.path : "";
      if (name && path) items.push({ type: "mention", name, path });
      continue;
    }
    if (type === "skill") {
      const name = typeof input.name === "string" ? input.name : "";
      const path = typeof input.path === "string" ? input.path : "";
      if (name && path) items.push({ type: "skill", name, path });
    }
  }

  if (items.length > 0) return items;

  const fallbackText = item.markdownText?.trim() ?? "";
  return fallbackText ? [buildOwnerTextUserInput(fallbackText)] : [];
}

function buildOwnerEditReplacementPromptInput(
  turn: CodexConversationTurn,
  replacementText: string,
): CodexPromptInput {
  const userItem = turn.items.find(isConversationUserMessageItem) ?? null;
  if (!userItem) return { text: replacementText };

  const inputItems = readOwnerUserInputItemsFromItem(userItem);
  if (inputItems.length === 0) return { text: replacementText };

  let didReplaceText = false;
  const replacementItems = inputItems.map((item) => {
    if (item.type !== "text" || didReplaceText) return item;
    didReplaceText = true;
    return buildOwnerTextUserInput(replacementText);
  });
  if (!didReplaceText) {
    replacementItems.unshift(buildOwnerTextUserInput(replacementText));
  }

  return buildOwnerPromptInputFromUserInputItems(replacementItems, replacementText);
}

function createOwnerClientUserMessageId(): string {
  const cryptoWithRandomUuid = globalThis.crypto as Crypto | undefined;
  const randomId = cryptoWithRandomUuid?.randomUUID?.();
  if (randomId) return randomId;

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildOwnerOptimisticTurnId(clientUserMessageId: string): string {
  return `replay:owner-turn:${clientUserMessageId}`;
}

function buildOwnerOptimisticUserItemId(clientUserMessageId: string): string {
  return `replay:owner-user:${clientUserMessageId}`;
}

function isOwnerOptimisticTurn(turn: CodexConversationTurn): boolean {
  return typeof turn.turnId === "string" && turn.turnId.startsWith("replay:owner-turn:");
}

function readOwnerClientUserMessageIdFromItem(item: CodexConversationItem): string | null {
  const rawItem = asRecord(item.rawItem);
  const rawClientId = rawItem?.clientUserMessageId ?? rawItem?.clientId;
  return typeof rawClientId === "string" && rawClientId.trim().length > 0
    ? rawClientId.trim()
    : null;
}

function ownerTurnContainsClientUserMessageId(
  turn: CodexConversationTurn,
  clientUserMessageId: string,
): boolean {
  return turn.items.some((item) => readOwnerClientUserMessageIdFromItem(item) === clientUserMessageId);
}

function buildOwnerOptimisticTurn(input: {
  threadId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  clientUserMessageId: string;
  observedAtMs: number;
}): CodexConversationTurn {
  const turnId = buildOwnerOptimisticTurnId(input.clientUserMessageId);
  const itemId = buildOwnerOptimisticUserItemId(input.clientUserMessageId);
  const content = buildOwnerUserInputItemsFromPromptInput(input.prompt, input.promptInput);
  const promptText = (input.promptInput?.text ?? input.prompt).trim();
  const userAttachments = buildCodexUserAttachmentsFromContent(content, itemId);
  const userItem: CodexConversationItem = {
    threadId: input.threadId,
    turnId,
    entryId: itemId,
    itemId,
    type: "userMessage",
    kind: "userMessage",
    semanticKind: "userMessage",
    status: "completed",
    role: "user",
    source: "optimistic",
    sequence: 0,
    markdownText: promptText,
    ...(userAttachments.length > 0 ? { userAttachments } : {}),
    rawItem: {
      id: itemId,
      type: "userMessage",
      clientUserMessageId: input.clientUserMessageId,
      content,
    },
    createdAt: input.observedAtMs,
    updatedAt: input.observedAtMs,
  };

  return {
    threadId: input.threadId,
    turnId,
    status: "inProgress",
    itemIds: [itemId],
    turnStartedAtMs: input.observedAtMs,
    firstTurnWorkItemStartedAtMs: null,
    finalAssistantStartedAtMs: null,
    startedAt: input.observedAtMs,
    completedAt: null,
    durationMs: null,
    items: [userItem],
  };
}

function appendOwnerOptimisticTurn(
  conversation: CodexConversationSnapshot,
  turn: CodexConversationTurn,
): CodexConversationSnapshot {
  return {
    ...conversation,
    turns: [...conversation.turns, turn],
    requests: [],
    statusType: "active",
    statusActiveFlags: [],
    updatedAt: Math.max(conversation.updatedAt, turn.turnStartedAtMs ?? Date.now()),
  };
}

function buildOwnerTurnSummaryFromProtocolTurn(
  threadId: string,
  turn: Turn,
): Omit<CodexConversationTurn, "items"> {
  const startedAt = normalizeOwnerTimestamp(turn.startedAt);
  const completedAt = normalizeOwnerTimestamp(turn.completedAt);
  return {
    threadId,
    turnId: turn.id,
    status: normalizeOwnerTurnStatus(turn.status, "inProgress"),
    errorMessage: parseOwnerTurnErrorMessage(turn.error),
    itemIds: turn.items.map((item) => {
      const itemRecord = asRecord(item);
      return getString(itemRecord ?? {}, "id") ?? "";
    }).filter((itemId) => itemId.length > 0),
    turnStartedAtMs: startedAt,
    firstTurnWorkItemStartedAtMs: null,
    finalAssistantStartedAtMs: null,
    startedAt,
    completedAt,
    durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null,
  };
}

function projectOwnerProtocolTurn(threadId: string, turn: Turn): CodexConversationTurn {
  const items: CodexConversationItem[] = [];
  turn.items.forEach((item, index) => {
    const normalizedItem = normalizeThreadItem(item, threadId, turn.id);
    if (!normalizedItem) return;
    items.push({
      ...projectCodexItemViewToTranscriptEntry(normalizedItem, "bootstrap", index),
      sequence: index,
    });
  });
  const summary = buildOwnerTurnSummaryFromProtocolTurn(threadId, turn);

  return {
    ...summary,
    itemIds: items.map((item) => item.itemId),
    items,
  };
}

function materializeOwnerRollbackConversation(
  currentConversation: CodexConversationSnapshot,
  rollbackResponse: ThreadRollbackResponse,
): CodexConversationSnapshot {
  const thread = rollbackResponse.thread;
  const now = Date.now();
  const createdAt = normalizeOwnerThreadTimestamp(thread.createdAt, currentConversation.createdAt);
  const updatedAt = normalizeOwnerThreadTimestamp(thread.updatedAt, now);
  const statusPayload = parseOwnerThreadStatusPayload({
    threadId: thread.id,
    status: thread.status,
  });
  const threadTurns = Array.isArray(thread.turns) ? thread.turns : [];
  const turns = threadTurns.map((turn) => projectOwnerProtocolTurn(thread.id, turn));

  return normalizeConversationSnapshot({
    ...currentConversation,
    threadId: thread.id,
    source: {
      ...currentConversation.source,
      parentThreadId: thread.parentThreadId ?? currentConversation.source?.parentThreadId ?? null,
    },
    ephemeral: thread.ephemeral,
    threadSource: parseOwnerThreadSourceValue(thread.threadSource) ?? currentConversation.threadSource ?? null,
    threadPreview: typeof thread.preview === "string" ? thread.preview : currentConversation.threadPreview,
    modelProvider: typeof thread.modelProvider === "string" ? thread.modelProvider : currentConversation.modelProvider,
    cwd: typeof thread.cwd === "string" ? thread.cwd : currentConversation.cwd,
    statusType: statusPayload?.statusType ?? currentConversation.statusType,
    statusActiveFlags: statusPayload?.statusActiveFlags ?? currentConversation.statusActiveFlags,
    createdAt,
    updatedAt,
    resumeState: "resumed",
    turnPagination: {
      olderCursor: null,
      backwardsCursor: null,
      oldestLoadedTurnId: turns[0]?.turnId ?? null,
      isLoadingOlder: false,
      hasLoadedOldest: true,
      loadedTurnCount: turns.length,
      itemsView: "full",
    },
    turns,
    requests: [],
  });
}

function parseOwnerTurnStartResult(
  threadId: string,
  result: unknown,
): Omit<CodexConversationTurn, "items"> | null {
  const record = asRecord(result);
  if (!record) return null;
  const turnRecord = asRecord(record?.turn);
  if (turnRecord) {
    const turn = record.turn as Turn;
    return buildOwnerTurnSummaryFromProtocolTurn(threadId, turn);
  }

  const turnId = typeof record?.turnId === "string"
    ? record.turnId
    : typeof record?.id === "string"
      ? record.id
      : null;
  if (!turnId) return null;

  const status = normalizeOwnerTurnStatus(record?.status, "inProgress");
  return {
    threadId,
    turnId,
    status,
    errorMessage: parseOwnerTurnErrorMessage(record?.error),
    itemIds: [],
    turnStartedAtMs: normalizeOwnerTimestamp(record?.turnStartedAtMs ?? record?.startedAt) ?? Date.now(),
    firstTurnWorkItemStartedAtMs: null,
    finalAssistantStartedAtMs: null,
    startedAt: normalizeOwnerTimestamp(record?.startedAt),
    completedAt: normalizeOwnerTimestamp(record?.completedAt),
    durationMs: typeof record?.durationMs === "number" ? record.durationMs : null,
  };
}

function rebindOwnerOptimisticTurn(
  conversation: CodexConversationSnapshot,
  clientUserMessageId: string,
  startedTurn: Omit<CodexConversationTurn, "items"> | null,
): CodexConversationSnapshot | null {
  if (!startedTurn) return null;

  const existingTurnIndex = conversation.turns.findIndex((turn) => turn.turnId === startedTurn.turnId);
  if (existingTurnIndex >= 0) {
    return conversation;
  }

  const optimisticTurnIndex = conversation.turns.findIndex((turn) =>
    turn.turnId === buildOwnerOptimisticTurnId(clientUserMessageId) ||
    ownerTurnContainsClientUserMessageId(turn, clientUserMessageId)
  );
  const optimisticTurn = optimisticTurnIndex >= 0 ? conversation.turns[optimisticTurnIndex] : null;
  if (!optimisticTurn) return null;

  const nextItems = optimisticTurn.items.map((item) => ({
    ...item,
    turnId: startedTurn.turnId,
  }));
  const nextTurn: CodexConversationTurn = {
    ...optimisticTurn,
    ...startedTurn,
    itemIds: nextItems.map((item) => item.itemId),
    items: nextItems,
  };
  const nextTurns = [...conversation.turns];
  nextTurns[optimisticTurnIndex] = nextTurn;

  return {
    ...conversation,
    turns: nextTurns,
    updatedAt: Math.max(conversation.updatedAt, startedTurn.turnStartedAtMs ?? Date.now()),
  };
}

function applyOwnerStartFailureToConversation(
  conversation: CodexConversationSnapshot,
  clientUserMessageId: string,
  error: unknown,
): CodexConversationSnapshot | null {
  const turnIndex = conversation.turns.findIndex((turn) =>
    turn.turnId === buildOwnerOptimisticTurnId(clientUserMessageId) ||
    ownerTurnContainsClientUserMessageId(turn, clientUserMessageId)
  );
  const turn = turnIndex >= 0 ? conversation.turns[turnIndex] : null;
  if (!turn) return null;

  const observedAtMs = Date.now();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const nextTurn: CodexConversationTurn = {
    ...turn,
    status: "failed",
    errorMessage,
    completedAt: observedAtMs,
    durationMs: turn.turnStartedAtMs ? Math.max(0, observedAtMs - turn.turnStartedAtMs) : turn.durationMs,
  };
  const nextTurns = [...conversation.turns];
  nextTurns[turnIndex] = nextTurn;

  return {
    ...conversation,
    statusType: "idle",
    statusActiveFlags: [],
    turns: nextTurns,
    updatedAt: Math.max(conversation.updatedAt, observedAtMs),
  };
}

function parseOwnerTurnLifecyclePayload(
  method: OwnerTurnLifecycleMethod,
  params: unknown,
): OwnerTurnLifecyclePayload | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const fallbackStatus = fallbackTurnStatusForMethod(method);
  const turnRecord = asRecord(payload.turn) ?? (
    typeof payload.turnId === "string"
      ? {
          id: payload.turnId,
          status: payload.status,
        }
      : null
  );
  if (!turnRecord) return null;

  const threadId = getString(payload, "threadId") ?? getString(turnRecord, "threadId");
  const turnId = getString(turnRecord, "id") ?? getString(payload, "turnId");
  if (!threadId || !turnId) return null;

  const status = normalizeOwnerTurnStatus(
    Object.prototype.hasOwnProperty.call(turnRecord, "status") ? turnRecord.status : payload.status,
    fallbackStatus,
  );
  const startedAt = normalizeOwnerTimestamp(turnRecord.startedAt ?? turnRecord.started_at);
  const completedAt = normalizeOwnerTimestamp(turnRecord.completedAt ?? turnRecord.completed_at);
  const turnStartedAtMs =
    normalizeOwnerTimestamp(turnRecord.turnStartedAtMs ?? turnRecord.turn_started_at_ms) ?? startedAt;
  const observedAtMs = method === "turn/started"
    ? turnStartedAtMs ?? Date.now()
    : completedAt ?? Date.now();

  return {
    threadId,
    turnId,
    status,
    errorMessage: parseOwnerTurnErrorMessage(turnRecord.error),
    startedAt,
    completedAt,
    turnStartedAtMs,
    durationMs: getNumber(turnRecord, ["durationMs", "duration_ms"]),
    observedAtMs,
  };
}

function applyOwnerTurnLifecycleToConversation(
  conversation: CodexConversationSnapshot,
  method: OwnerTurnLifecycleMethod,
  payload: OwnerTurnLifecyclePayload,
): CodexConversationSnapshot | null {
  const existingTurnIndex = conversation.turns.findIndex((turn) => turn.turnId === payload.turnId);
  const optimisticTurnIndex = method === "turn/started" && existingTurnIndex < 0
    ? conversation.turns.findLastIndex((turn) => turn.status === "inProgress" && isOwnerOptimisticTurn(turn))
    : -1;
  const turnIndex = existingTurnIndex >= 0 ? existingTurnIndex : optimisticTurnIndex;
  if (turnIndex < 0 && method !== "turn/started") {
    return null;
  }

  const existingTurn: CodexConversationTurn = turnIndex >= 0
    ? conversation.turns[turnIndex]!
    : {
        threadId: payload.threadId,
        turnId: payload.turnId,
        status: payload.status,
        itemIds: [],
        items: [],
      };
  const nextTurn: CodexConversationTurn = {
    ...existingTurn,
    turnId: payload.turnId,
    status: payload.status,
    errorMessage: payload.errorMessage ?? existingTurn.errorMessage,
    turnStartedAtMs: existingTurn.turnStartedAtMs ?? payload.turnStartedAtMs ?? payload.observedAtMs,
    startedAt: payload.startedAt ?? existingTurn.startedAt,
    completedAt: payload.completedAt ?? existingTurn.completedAt,
    durationMs: payload.durationMs ?? existingTurn.durationMs,
  };
  const nextTurns = [...conversation.turns];
  if (turnIndex >= 0) {
    nextTurns[turnIndex] = nextTurn;
  } else {
    nextTurns.push(nextTurn);
  }

  const nextRequests = method === "turn/started"
    ? conversation.requests.filter((request) =>
        request.type !== "implementPlan" || request.turnId === payload.turnId
      )
    : conversation.requests;
  const hasInProgressTurn = nextTurns.some((turn) => turn.status === "inProgress");

  return {
    ...conversation,
    statusType: hasInProgressTurn ? "active" : "idle",
    statusActiveFlags: hasInProgressTurn ? conversation.statusActiveFlags : [],
    turns: nextTurns,
    requests: nextRequests,
    updatedAt: Math.max(conversation.updatedAt, payload.observedAtMs),
  };
}

function normalizeOwnerThreadTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value > 10_000_000_000) return Math.floor(value);
  return Math.floor(value * 1000);
}

function parseOwnerThreadSourceParentThreadId(source: unknown): string | null {
  const candidate = asRecord(source);
  if (!candidate) return null;
  if ("subAgent" in candidate) {
    return parseOwnerThreadSourceParentThreadId(candidate.subAgent);
  }
  if ("subagent" in candidate) {
    return parseOwnerThreadSourceParentThreadId(candidate.subagent);
  }
  const threadSpawn = asRecord(candidate.thread_spawn);
  const parentThreadId = threadSpawn?.parent_thread_id;
  return typeof parentThreadId === "string" && parentThreadId.trim().length > 0
    ? parentThreadId
    : null;
}

function parseOwnerThreadSourceValue(value: unknown): ThreadSource | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseOwnerThreadStartedPayload(params: unknown): {
  threadId: string;
  parentThreadId: string | null;
  threadSource: ThreadSource | null;
  threadName: string | null;
  threadPreview: string | null;
  modelProvider: string | null;
  cwd: string | null;
  statusType: CodexConversationSnapshot["statusType"] | null;
  statusActiveFlags: CodexThreadActiveFlag[];
  ephemeral: boolean | null;
  createdAt: number | null;
  updatedAt: number | null;
} | null {
  const payload = asRecord(params);
  const thread = asRecord(payload?.thread);
  if (!thread) return null;

  const threadId = getString(thread, "id");
  if (!threadId) return null;

  const threadName = getString(thread, "name")?.trim() || null;
  const statusPayload = {
    threadId,
    status: thread.status,
  };
  const parsedStatus = parseOwnerThreadStatusPayload(statusPayload);
  const explicitParentThreadId = getString(thread, "parentThreadId");
  const parentThreadId = explicitParentThreadId && explicitParentThreadId.trim().length > 0
    ? explicitParentThreadId
    : parseOwnerThreadSourceParentThreadId(thread.source);

  return {
    threadId,
    parentThreadId,
    threadSource: parseOwnerThreadSourceValue(thread.threadSource),
    threadName,
    threadPreview: getString(thread, "preview"),
    modelProvider: getString(thread, "modelProvider"),
    cwd: getString(thread, "cwd"),
    statusType: parsedStatus?.statusType ?? null,
    statusActiveFlags: parsedStatus?.statusActiveFlags ?? [],
    ephemeral: typeof thread.ephemeral === "boolean" ? thread.ephemeral : null,
    createdAt: typeof thread.createdAt === "number" ? thread.createdAt : null,
    updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : null,
  };
}

function applyOwnerThreadStartedToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadStartedPayload>>,
): CodexConversationSnapshot | null {
  const source: CodexConversationSource | null = payload.parentThreadId
    ? { parentThreadId: payload.parentThreadId }
    : conversation.source;

  return {
    ...conversation,
    source,
    ephemeral: payload.ephemeral ?? conversation.ephemeral,
    threadSource: payload.threadSource ?? conversation.threadSource ?? null,
    threadName: payload.threadName ?? conversation.threadName,
    threadPreview: payload.threadPreview ?? conversation.threadPreview,
    modelProvider: payload.modelProvider ?? conversation.modelProvider,
    cwd: payload.cwd ?? conversation.cwd,
    statusType: payload.statusType ?? conversation.statusType,
    statusActiveFlags: payload.statusType === "active"
      ? payload.statusActiveFlags
      : payload.statusType
        ? []
        : conversation.statusActiveFlags,
    createdAt: payload.createdAt === null
      ? conversation.createdAt
      : normalizeOwnerThreadTimestamp(payload.createdAt, conversation.createdAt),
    updatedAt: payload.updatedAt === null
      ? Math.max(conversation.updatedAt, Date.now())
      : normalizeOwnerThreadTimestamp(payload.updatedAt, conversation.updatedAt),
    resumeState: "resumed",
  };
}

function normalizeOwnerThreadStatusType(value: unknown): CodexConversationSnapshot["statusType"] | null {
  if (value === "notLoaded" || value === "idle" || value === "systemError" || value === "active") {
    return value;
  }
  if (value === "not_loaded") return "notLoaded";
  if (value === "system_error") return "systemError";
  return null;
}

function parseOwnerThreadStatusFlags(value: unknown): CodexThreadActiveFlag[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is CodexThreadActiveFlag =>
        entry === "waitingOnApproval" || entry === "waitingOnUserInput"
      )
    : [];
}

function parseOwnerThreadStatusPayload(params: unknown): {
  threadId: string;
  statusType: CodexConversationSnapshot["statusType"];
  statusActiveFlags: CodexThreadActiveFlag[];
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  if (!threadId) return null;

  const status = asRecord(payload.status);
  const statusType = status
    ? normalizeOwnerThreadStatusType(status.type ?? status.status)
    : normalizeOwnerThreadStatusType(payload.status);
  if (!statusType) return null;

  return {
    threadId,
    statusType,
    statusActiveFlags: statusType === "active"
      ? parseOwnerThreadStatusFlags(status?.activeFlags ?? status?.active_flags)
      : [],
  };
}

function applyOwnerThreadStatusToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadStatusPayload>>,
): CodexConversationSnapshot | null {
  if (
    conversation.statusType === payload.statusType &&
    areStringArraysEqual(conversation.statusActiveFlags, payload.statusActiveFlags)
  ) {
    return conversation;
  }

  return {
    ...conversation,
    statusType: payload.statusType,
    statusActiveFlags: payload.statusActiveFlags,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function shouldShowOwnerThreadGoalResumeConfirmation(status: ThreadGoal["status"]): boolean {
  return status === "paused" || status === "blocked" || status === "usageLimited";
}

function parseOwnerThreadGoal(value: unknown): ThreadGoal | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const threadId = getString(candidate, "threadId");
  const objective = getString(candidate, "objective");
  const status = candidate.status;
  const tokenBudget = candidate.tokenBudget;
  const tokensUsed = candidate.tokensUsed;
  const timeUsedSeconds = candidate.timeUsedSeconds;
  const createdAt = candidate.createdAt;
  const updatedAt = candidate.updatedAt;
  if (
    !threadId ||
    !objective ||
    (
      status !== "active" &&
      status !== "paused" &&
      status !== "blocked" &&
      status !== "usageLimited" &&
      status !== "budgetLimited" &&
      status !== "complete"
    ) ||
    typeof tokensUsed !== "number" ||
    typeof timeUsedSeconds !== "number" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number"
  ) {
    return null;
  }

  return {
    threadId,
    objective,
    status,
    tokenBudget: typeof tokenBudget === "number" ? tokenBudget : null,
    tokensUsed,
    timeUsedSeconds,
    createdAt,
    updatedAt,
  };
}

function parseOwnerThreadGoalUpdatedPayload(params: unknown): {
  threadId: string;
  goal: ThreadGoal;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const goal = parseOwnerThreadGoal(payload.goal);
  if (!threadId || !goal) return null;

  return {
    threadId,
    goal,
  };
}

function parseOwnerThreadGoalClearedPayload(params: unknown): {
  threadId: string;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  return threadId ? { threadId } : null;
}

function applyOwnerThreadGoalUpdatedToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadGoalUpdatedPayload>>,
): CodexConversationSnapshot | null {
  return {
    ...conversation,
    threadGoal: payload.goal,
    completedThreadGoal: payload.goal.status === "complete" ? payload.goal : null,
    threadGoalResumeConfirmation: shouldShowOwnerThreadGoalResumeConfirmation(payload.goal.status)
      ? conversation.threadGoalResumeConfirmation ?? null
      : null,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function applyOwnerThreadGoalClearedToConversation(
  conversation: CodexConversationSnapshot,
): CodexConversationSnapshot | null {
  return {
    ...conversation,
    threadGoal: null,
    threadGoalResumeConfirmation: null,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function parseOwnerThreadNamePayload(params: unknown): {
  threadId: string;
  threadName: string;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const threadName = (getString(payload, "threadName") ?? getString(payload, "name"))?.trim() ?? "";
  if (!threadId || threadName.length === 0) return null;

  return {
    threadId,
    threadName,
  };
}

function applyOwnerThreadNameToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadNamePayload>>,
): CodexConversationSnapshot | null {
  if (conversation.threadName === payload.threadName) return conversation;

  return {
    ...conversation,
    threadName: payload.threadName,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function normalizeOwnerReasoningEffort(value: unknown): CodexReasoningEffort | null {
  if (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return null;
}

function normalizeOwnerCollaborationMode(value: unknown): CodexCollaborationModeKind | null {
  if (value === "default" || value === "plan") return value;
  return null;
}

function parseOwnerThreadSettingsPayload(params: unknown): {
  threadId: string;
  threadSettings: Record<string, unknown>;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const threadSettings = asRecord(payload.threadSettings ?? payload.thread_settings);
  if (!threadId || !threadSettings) return null;

  return {
    threadId,
    threadSettings,
  };
}

function buildOwnerConversationThreadSettings(
  conversation: CodexConversationSnapshot,
  threadSettings: Record<string, unknown>,
): CodexConversationThreadSettings {
  const fallbackMode =
    conversation.latestThreadSettings?.collaborationMode
    ?? conversation.latestCollaborationMode
    ?? DEFAULT_COLLABORATION_MODE_STATE;
  const model =
    normalizeThreadSettingsModel(threadSettings.model)
    ?? normalizeThreadSettingsModel(conversation.latestThreadSettings?.model)
    ?? normalizeThreadSettingsModel(fallbackMode.settings.model)
    ?? "";
  const reasoningEffort =
    normalizeOwnerReasoningEffort(
      hasOwnValue(threadSettings, "effort") ? threadSettings.effort : threadSettings.reasoningEffort,
    )
    ?? conversation.latestThreadSettings?.reasoningEffort
    ?? fallbackMode.settings.reasoning_effort
    ?? null;
  const collaborationModeValue = threadSettings.collaborationMode ?? threadSettings.collaboration_mode;
  const collaborationModeRecord = asRecord(collaborationModeValue);
  const collaborationSettings = asRecord(collaborationModeRecord?.settings);
  const mode =
    normalizeOwnerCollaborationMode(
      typeof collaborationModeValue === "string" ? collaborationModeValue : collaborationModeRecord?.mode,
    )
    ?? fallbackMode.mode
    ?? "default";
  const collaborationModel =
    normalizeThreadSettingsModel(collaborationSettings?.model)
    ?? model;
  const collaborationReasoningEffort =
    normalizeOwnerReasoningEffort(
      collaborationSettings?.reasoning_effort ?? collaborationSettings?.reasoningEffort,
    )
    ?? reasoningEffort
    ?? null;

  return {
    model,
    reasoningEffort,
    collaborationMode: {
      mode,
      settings: {
        model: collaborationModel,
        reasoning_effort: collaborationReasoningEffort,
        developer_instructions: null,
      },
    },
  };
}

function areOwnerThreadSettingsEqual(
  left: CodexConversationThreadSettings | null | undefined,
  right: CodexConversationThreadSettings,
): boolean {
  if (!left || !right.collaborationMode) return false;

  return Boolean(left)
    && left?.model === right.model
    && left.reasoningEffort === right.reasoningEffort
    && left.collaborationMode?.mode === right.collaborationMode.mode
    && left.collaborationMode?.settings.model === right.collaborationMode.settings.model
    && left.collaborationMode?.settings.reasoning_effort === right.collaborationMode.settings.reasoning_effort;
}

function applyOwnerThreadSettingsToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadSettingsPayload>>,
): CodexConversationSnapshot | null {
  const latestThreadSettings = buildOwnerConversationThreadSettings(conversation, payload.threadSettings);
  if (areOwnerThreadSettingsEqual(conversation.latestThreadSettings, latestThreadSettings)) {
    return conversation;
  }

  return {
    ...conversation,
    latestThreadSettings,
    latestCollaborationMode: latestThreadSettings.collaborationMode ?? DEFAULT_COLLABORATION_MODE_STATE,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function parseOwnerThreadTokenUsagePayload(params: unknown): {
  threadId: string;
  tokenUsage: CodexThreadTokenUsage;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const tokenUsage = parseCodexThreadTokenUsage(payload.tokenUsage ?? payload.token_usage);
  if (!threadId || !tokenUsage) return null;

  return {
    threadId,
    tokenUsage,
  };
}

function applyOwnerThreadTokenUsageToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerThreadTokenUsagePayload>>,
): CodexConversationSnapshot | null {
  const observedAtMs = Date.now();

  return {
    ...conversation,
    latestTokenUsageInfo: payload.tokenUsage,
    updatedAt: Math.max(conversation.updatedAt, observedAtMs),
  };
}

function parseOwnerTurnDiffPayload(params: unknown): {
  threadId: string;
  turnId: string;
  diff?: string;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  if (!threadId || !turnId) return null;

  return {
    threadId,
    turnId,
    diff: typeof payload.diff === "string" ? payload.diff : undefined,
  };
}

function applyOwnerTurnDiffToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerTurnDiffPayload>>,
): CodexConversationSnapshot | null {
  const turnIndex = conversation.turns.findIndex((turn) => turn.turnId === payload.turnId);
  if (turnIndex < 0) return null;

  const turn = conversation.turns[turnIndex]!;
  if (turn.diff === payload.diff) return conversation;

  const nextTurns = [...conversation.turns];
  nextTurns[turnIndex] = {
    ...turn,
    diff: payload.diff,
  };
  return {
    ...conversation,
    turns: nextTurns,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function upsertOwnerTurnItem(
  conversation: CodexConversationSnapshot,
  turnId: string,
  item: CodexConversationItem,
): CodexConversationSnapshot | null {
  const turnIndex = conversation.turns.findIndex((turn) => turn.turnId === turnId);
  if (turnIndex < 0) return null;

  const turn = conversation.turns[turnIndex]!;
  const existingItemIndex = turn.items.findIndex((candidate) => candidate.itemId === item.itemId);
  const nextItem: CodexConversationItem = existingItemIndex >= 0
    ? {
        ...item,
        createdAt: turn.items[existingItemIndex]?.createdAt ?? item.createdAt,
        sequence: turn.items[existingItemIndex]?.sequence ?? item.sequence,
      }
    : {
        ...item,
        sequence: turn.items.length,
      };
  const nextItems = [...turn.items];
  if (existingItemIndex >= 0) {
    nextItems[existingItemIndex] = nextItem;
  } else {
    nextItems.push(nextItem);
  }

  const nextItemIds = turn.itemIds.includes(nextItem.itemId)
    ? turn.itemIds
    : [...turn.itemIds, nextItem.itemId];
  const nextTurns = [...conversation.turns];
  nextTurns[turnIndex] = {
    ...turn,
    itemIds: nextItemIds,
    items: nextItems,
  };

  return {
    ...conversation,
    turns: nextTurns,
    updatedAt: Math.max(conversation.updatedAt, nextItem.updatedAt),
  };
}

function parseOwnerTurnPlanPayload(params: unknown): {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  if (!threadId || !turnId) return null;

  return {
    threadId,
    turnId,
    explanation: typeof payload.explanation === "string" ? payload.explanation : null,
    plan: Array.isArray(payload.plan)
      ? payload.plan.flatMap((candidate) => {
          const parsed = asRecord(candidate);
          if (!parsed || typeof parsed.step !== "string" || typeof parsed.status !== "string") return [];
          return [{ step: parsed.step, status: parsed.status }];
        })
      : [],
  };
}

function buildOwnerTodoListItem(
  payload: NonNullable<ReturnType<typeof parseOwnerTurnPlanPayload>>,
  existing: CodexConversationItem | null,
): CodexConversationItem {
  const now = Date.now();
  const itemId = `todo-list:${payload.turnId}`;
  const planMarkdown = payload.plan
    .map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : " "}] ${step.step}`)
    .join("\n");

  return projectCodexItemViewToTranscriptEntry({
    threadId: payload.threadId,
    turnId: payload.turnId,
    itemId,
    type: "todo-list",
    normalizedKind: "plan",
    semanticKind: "todoList",
    status: payload.plan.every((step) => step.status === "completed") ? "completed" : "inProgress",
    markdownText: planMarkdown,
    rawItem: {
      id: itemId,
      type: "todo-list",
      explanation: payload.explanation,
      plan: payload.plan,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }, "live", existing?.sequence ?? 0);
}

function applyOwnerTurnPlanToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerTurnPlanPayload>>,
): CodexConversationSnapshot | null {
  const turn = conversation.turns.find((candidate) => candidate.turnId === payload.turnId);
  const existing = turn?.items.find((item) => item.itemId === `todo-list:${payload.turnId}`) ?? null;
  return upsertOwnerTurnItem(conversation, payload.turnId, buildOwnerTodoListItem(payload, existing));
}

function parseOwnerSafetyBufferingPayload(params: unknown): {
  threadId: string;
  turnId: string | null;
  safetyBuffering: CodexSafetyBufferingState;
  observedAtMs: number;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  if (!threadId) return null;
  if (!Array.isArray(payload.useCases)) return null;
  if (!Array.isArray(payload.reasons)) return null;
  if (typeof payload.showBufferingUi !== "boolean") return null;

  return {
    threadId,
    turnId: getString(payload, "turnId"),
    observedAtMs: Date.now(),
    safetyBuffering: {
      useCases: payload.useCases.map((value) => String(value ?? "")),
      reasons: payload.reasons.map((value) => String(value ?? "")),
      showBufferingUi: payload.showBufferingUi,
      fasterModel: getString(payload, "fasterModel"),
    },
  };
}

function applyOwnerSafetyBufferingToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerSafetyBufferingPayload>>,
): CodexConversationSnapshot | null {
  const resolved = resolveOwnerTurnReference(conversation, payload.turnId, {
    observedAtMs: payload.observedAtMs,
  });
  if (!resolved) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex];
  if (!turn) return null;

  const nextConversation = replaceOwnerTurnAt(resolved.conversation, resolved.turnIndex, {
    ...turn,
    safetyBuffering: payload.safetyBuffering,
  });
  return {
    ...nextConversation,
    updatedAt: Math.max(nextConversation.updatedAt, payload.observedAtMs),
  };
}

function parseOwnerHookPayload(params: unknown): {
  threadId: string;
  turnId: string | null;
  run: Record<string, unknown>;
  observedAtMs: number;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const run = asRecord(payload.run);
  if (!threadId || !run || typeof run.id !== "string") return null;

  return {
    threadId,
    turnId: getString(payload, "turnId"),
    run,
    observedAtMs: Date.now(),
  };
}

function mapOwnerHookStatus(status: unknown): CodexItemStatus {
  if (typeof status !== "string") return "inProgress";
  if (status === "running") return "inProgress";
  if (status === "failed") return "failed";
  if (status === "blocked") return "declined";
  if (status === "stopped") return "interrupted";
  return "completed";
}

function buildOwnerHookItem(
  payload: NonNullable<ReturnType<typeof parseOwnerHookPayload>>,
  turnId: string,
  existing: CodexConversationItem | null,
): CodexConversationItem {
  const now = payload.observedAtMs;
  const runId = String(payload.run.id);
  const statusMessage = typeof payload.run.statusMessage === "string" ? payload.run.statusMessage : null;

  return projectCodexItemViewToTranscriptEntry({
    threadId: payload.threadId,
    turnId,
    itemId: runId,
    type: "hook",
    normalizedKind: "hook",
    semanticKind: "hook",
    status: mapOwnerHookStatus(payload.run.status),
    markdownText: statusMessage ?? "Hook",
    rawItem: {
      id: runId,
      type: "hook",
      run: payload.run,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }, "live", existing?.sequence ?? 0);
}

function applyOwnerHookToConversation(
  conversation: CodexConversationSnapshot,
  method: "hook/started" | "hook/completed",
  payload: NonNullable<ReturnType<typeof parseOwnerHookPayload>>,
): CodexConversationSnapshot | null {
  const resolved = resolveOwnerTurnReference(conversation, payload.turnId, {
    rebindLatestInProgressPlaceholder: method === "hook/started",
    observedAtMs: payload.observedAtMs,
  });
  if (!resolved) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex];
  if (!turn) return null;

  const resolvedTurnId = getOwnerTurnId(turn);
  if (!resolvedTurnId) return null;

  const existingItemIndex = turn.items.findIndex((item) => item.itemId === payload.run.id);
  const existingItem = existingItemIndex >= 0 ? turn.items[existingItemIndex] ?? null : null;
  const nextItem = buildOwnerHookItem(payload, resolvedTurnId, existingItem);
  const nextItems = [...turn.items];
  if (existingItemIndex >= 0) {
    nextItems[existingItemIndex] = nextItem;
  } else {
    nextItems.push({
      ...nextItem,
      sequence: turn.items.length,
    });
  }

  const nextItemIds = turn.itemIds.includes(nextItem.itemId)
    ? turn.itemIds
    : [...turn.itemIds, nextItem.itemId];
  const nextTurn: CodexConversationTurn = {
    ...turn,
    status: turn.status === "completed" ? "completed" : "inProgress",
    itemIds: nextItemIds,
    items: nextItems,
  };
  const nextConversation = replaceOwnerTurnAt(resolved.conversation, resolved.turnIndex, nextTurn);
  return {
    ...nextConversation,
    updatedAt: Math.max(nextConversation.updatedAt, payload.observedAtMs),
  };
}

function parseOwnerAutomaticApprovalReviewPayload(params: unknown): {
  threadId: string;
  turnId: string;
  reviewId: string;
  targetItemId: string | null;
  review: NonNullable<ReturnType<typeof normalizeAutomaticApprovalReviewPayload>>;
  action: unknown;
  observedAtMs: number;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  const reviewId = getString(payload, "reviewId");
  if (!threadId || !turnId || !reviewId) return null;

  const targetItemId = getString(payload, "targetItemId");
  const review = normalizeAutomaticApprovalReviewPayload(payload, targetItemId);
  if (!review) return null;

  return {
    threadId,
    turnId,
    reviewId,
    targetItemId: review.targetItemId,
    review,
    action: Object.prototype.hasOwnProperty.call(payload, "action") ? payload.action : null,
    observedAtMs: Date.now(),
  };
}

function buildOwnerAutomaticApprovalReviewItem(
  payload: NonNullable<ReturnType<typeof parseOwnerAutomaticApprovalReviewPayload>>,
  existing: CodexConversationItem | null,
): CodexConversationItem {
  const itemId = `automatic-approval-review:${payload.reviewId}`;
  const existingRaw = asRecord(existing?.rawItem);
  const existingStartedAtMs = existingRaw ? getNumber(existingRaw, ["startedAtMs"]) : null;
  const startedAtMs = existingStartedAtMs ?? payload.observedAtMs;
  const completedAtMs = payload.review.status === "inProgress" ? null : payload.observedAtMs;

  return projectCodexItemViewToTranscriptEntry({
    threadId: payload.threadId,
    turnId: payload.turnId,
    itemId,
    type: "automaticApprovalReview",
    normalizedKind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: payload.review.status === "inProgress" ? "inProgress" : "completed",
    markdownText: buildAutomaticApprovalReviewSummary(payload.review),
    rawItem: {
      id: itemId,
      type: "automaticApprovalReview",
      targetItemId: payload.targetItemId,
      action: payload.action,
      startedAtMs,
      completedAtMs,
      status: payload.review.status,
      riskScore: payload.review.riskScore,
      riskLevel: payload.review.riskLevel,
      userAuthorization: payload.review.userAuthorization,
      rationale: payload.review.rationale,
    },
    createdAt: existing?.createdAt ?? startedAtMs,
    updatedAt: payload.observedAtMs,
  }, "live", existing?.sequence ?? 0);
}

function applyOwnerAutomaticApprovalReviewToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerAutomaticApprovalReviewPayload>>,
): CodexConversationSnapshot | null {
  const resolved = resolveOwnerTurnReference(conversation, payload.turnId, {
    observedAtMs: payload.observedAtMs,
  });
  if (!resolved) return null;

  const turn = resolved.conversation.turns[resolved.turnIndex];
  if (!turn) return null;

  const itemId = `automatic-approval-review:${payload.reviewId}`;
  const existingItemIndex = turn.items.findIndex((item) => item.itemId === itemId);
  const existingItem = existingItemIndex >= 0 ? turn.items[existingItemIndex] ?? null : null;
  const nextItem = buildOwnerAutomaticApprovalReviewItem(payload, existingItem);
  const nextItems = [...turn.items];
  if (existingItemIndex >= 0) {
    nextItems[existingItemIndex] = nextItem;
  } else {
    nextItems.push({
      ...nextItem,
      sequence: turn.items.length,
    });
  }

  const nextItemIds = turn.itemIds.includes(nextItem.itemId)
    ? turn.itemIds
    : [...turn.itemIds, nextItem.itemId];
  const nextConversation = replaceOwnerTurnAt(resolved.conversation, resolved.turnIndex, {
    ...turn,
    itemIds: nextItemIds,
    items: nextItems,
  });
  return {
    ...nextConversation,
    updatedAt: Math.max(nextConversation.updatedAt, payload.observedAtMs),
  };
}

function parseOwnerGuardianWarningPayload(params: unknown): {
  threadId: string;
  observedAtMs: number;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  if (!threadId || !shouldShowAutoReviewInterruptionWarning(payload)) return null;

  return {
    threadId,
    observedAtMs: Date.now(),
  };
}

function createOwnerGeneratedItemId(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function buildOwnerAutoReviewInterruptionWarningItem(
  payload: NonNullable<ReturnType<typeof parseOwnerGuardianWarningPayload>>,
  turnId: string,
  sequence: number,
): CodexConversationItem {
  const itemId = createOwnerGeneratedItemId("auto-review-interruption-warning");

  return projectCodexItemViewToTranscriptEntry({
    threadId: payload.threadId,
    turnId,
    itemId,
    type: "autoReviewInterruptionWarning",
    normalizedKind: "systemEvent",
    semanticKind: "autoReviewInterruptionWarning",
    status: "completed",
    markdownText: AUTO_REVIEW_INTERRUPTION_WARNING_PREFIX,
    rawItem: {
      id: itemId,
      type: "autoReviewInterruptionWarning",
    },
    createdAt: payload.observedAtMs,
    updatedAt: payload.observedAtMs,
  }, "live", sequence);
}

function applyOwnerGuardianWarningToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerGuardianWarningPayload>>,
): CodexConversationSnapshot | null {
  const latestTurnIndex = getOwnerLatestTurnIndex(conversation);
  if (latestTurnIndex < 0) return null;

  const turn = conversation.turns[latestTurnIndex];
  if (!turn) return null;

  const turnId = getOwnerTurnId(turn);
  if (!turnId) return null;

  const nextItem = buildOwnerAutoReviewInterruptionWarningItem(payload, turnId, turn.items.length);
  const nextTurn: CodexConversationTurn = {
    ...turn,
    itemIds: [...turn.itemIds, nextItem.itemId],
    items: [...turn.items, nextItem],
  };
  const nextConversation = replaceOwnerTurnAt(conversation, latestTurnIndex, nextTurn);
  return {
    ...nextConversation,
    updatedAt: Math.max(nextConversation.updatedAt, payload.observedAtMs),
  };
}

function parseOwnerModelReroutedPayload(params: unknown): {
  threadId: string;
  turnId: string;
  fromModel: string | null;
  toModel: string | null;
  reason: string | null;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  if (!threadId || !turnId) return null;

  return {
    threadId,
    turnId,
    fromModel: getString(payload, "fromModel"),
    toModel: getString(payload, "toModel"),
    reason: getString(payload, "reason"),
  };
}

function applyOwnerModelReroutedToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerModelReroutedPayload>>,
): CodexConversationSnapshot | null {
  const now = Date.now();
  const itemId = `model-rerouted:${payload.turnId}:${now}`;
  const item: CodexConversationItem = {
    threadId: payload.threadId,
    turnId: payload.turnId,
    itemId,
    type: "modelRerouted",
    kind: "systemEvent",
    semanticKind: "modelRerouted",
    status: "completed",
    rawItem: {
      id: itemId,
      type: "modelRerouted",
      fromModel: payload.fromModel,
      toModel: payload.toModel,
      reason: payload.reason,
    },
    createdAt: now,
    updatedAt: now,
  };

  return upsertOwnerTurnItem(conversation, payload.turnId, item);
}

function parseOwnerErrorPayload(params: unknown): {
  threadId: string;
  turnId: string;
  message: string;
  additionalDetails: string | null;
  willRetry: boolean;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const turnId = getString(payload, "turnId");
  const error = asRecord(payload.error);
  if (!threadId || !turnId || !error) return null;

  return {
    threadId,
    turnId,
    message: getString(error, "message") ?? "Codex error",
    additionalDetails: getString(error, "additionalDetails"),
    willRetry: Boolean(payload.willRetry),
  };
}

function applyOwnerErrorToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerErrorPayload>>,
): CodexConversationSnapshot | null {
  const turn = conversation.turns.find((candidate) => candidate.turnId === payload.turnId);
  const existing = turn?.items.find((item) => item.itemId === `error:${payload.turnId}`) ?? null;
  const item = projectCodexItemViewToTranscriptEntry(
    buildTurnErrorItemView({
      ...payload,
      createdAt: existing?.createdAt,
      updatedAt: Date.now(),
    }),
    "live",
    existing?.sequence ?? 0,
  );

  return upsertOwnerTurnItem(conversation, payload.turnId, item);
}

function parseOwnerServerRequestResolvedPayload(params: unknown): {
  threadId: string;
  requestId: string;
} | null {
  const payload = asRecord(params);
  if (!payload) return null;

  const threadId = getString(payload, "threadId");
  const requestIdValue = payload.requestId ?? payload.request_id;
  if (!threadId || requestIdValue === undefined || requestIdValue === null) return null;

  return {
    threadId,
    requestId: String(requestIdValue),
  };
}

function applyOwnerServerRequestResolvedToConversation(
  conversation: CodexConversationSnapshot,
  payload: NonNullable<ReturnType<typeof parseOwnerServerRequestResolvedPayload>>,
): CodexConversationSnapshot | null {
  const request = conversation.requests.find((candidate) => candidate.requestId === payload.requestId) ?? null;
  if (!request) return conversation;

  const nextRequests = conversation.requests.filter((candidate) => candidate.requestId !== payload.requestId);
  let nextTurns = conversation.turns;

  if (request?.type === "approval") {
    const turnIndex = conversation.turns.findIndex((turn) => turn.turnId === request.turnId);
    const turn = turnIndex >= 0 ? conversation.turns[turnIndex] : null;
    const itemIndex = turn?.items.findIndex((item) =>
      item.itemId === request.itemId && item.approvalRequestId === payload.requestId
    ) ?? -1;

    if (turn && turnIndex >= 0 && itemIndex >= 0) {
      const item = turn.items[itemIndex]!;
      const nextItems = [...turn.items];
      nextItems[itemIndex] = {
        ...item,
        approvalRequestId: null,
        networkApprovalContext: null,
        proposedExecpolicyAmendment: null,
        grantRoot: null,
        updatedAt: Date.now(),
      };
      nextTurns = [...conversation.turns];
      nextTurns[turnIndex] = {
        ...turn,
        items: nextItems,
      };
    }
  }

  if (request?.type === "userInput") {
    nextTurns = upsertResolvedOwnerUserInputSyntheticItem(conversation, request, {})?.turns ?? nextTurns;
  }

  if (request?.type === "mcpServerElicitation") {
    nextTurns = upsertResolvedOwnerMcpElicitationSyntheticItem(conversation, request, {
      completed: true,
      action: null,
    })?.turns ?? nextTurns;
  }

  if (request?.type === "permissionRequest") {
    nextTurns = upsertOwnerPermissionRequestSyntheticItem(conversation, request, {
      completed: true,
      response: request.response,
    })?.turns ?? nextTurns;
  }

  return {
    ...conversation,
    requests: nextRequests,
    turns: nextTurns,
    statusActiveFlags: nextRequests.length === 0 ? [] : conversation.statusActiveFlags,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function normalizeOwnerApprovalAvailableDecisions(value: readonly unknown[] | null | undefined): string[] | null {
  if (!value || value.length === 0) return null;

  const decisions = value
    .map((decision) => {
      if (typeof decision === "string") return decision;
      const record = asRecord(decision);
      return record ? Object.keys(record)[0] ?? "" : "";
    })
    .filter((decision) => decision.length > 0);

  return decisions.length > 0 ? decisions : null;
}

function buildOwnerCommandApprovalRequest(
  conversation: CodexConversationSnapshot,
  requestId: string,
  params: Extract<CodexThreadOwnerRequestEvent["request"], { method: "item/commandExecution/requestApproval" }>["params"],
): CodexApprovalRequest {
  const command = params.command ?? "";
  const commandActions = params.commandActions ?? null;
  const commandActionCommands = commandActions
    ?.map((action) => action.command)
    .filter((command): command is string => typeof command === "string" && command.trim().length > 0) ?? [];

  return {
    type: "approval",
    requestId,
    kind: "command",
    projectId: conversation.projectId,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    approvalId: params.approvalId ?? null,
    approvalRequestId: requestId,
    callId: params.itemId,
    reason: params.reason ?? undefined,
    command: command || undefined,
    cwd: params.cwd ?? undefined,
    approvalReason: params.reason ?? undefined,
    cmd: commandActionCommands.length > 0
      ? commandActionCommands
      : command.trim().length > 0
        ? command.split(" ").filter((segment) => segment.trim().length > 0)
        : undefined,
    networkApprovalContext: params.networkApprovalContext
      ? {
          host: params.networkApprovalContext.host,
          protocol: params.networkApprovalContext.protocol,
        }
      : null,
    proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
    proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments?.map((amendment) => ({
      host: amendment.host,
      action: amendment.action,
    })) ?? null,
    availableDecisions: normalizeOwnerApprovalAvailableDecisions(params.availableDecisions),
    grantRoot: null,
    commandActions,
    createdAt: params.startedAtMs,
  };
}

function buildOwnerFileApprovalRequest(
  conversation: CodexConversationSnapshot,
  requestId: string,
  params: Extract<CodexThreadOwnerRequestEvent["request"], { method: "item/fileChange/requestApproval" }>["params"],
): CodexApprovalRequest {
  return {
    type: "approval",
    requestId,
    kind: "file",
    projectId: conversation.projectId,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    approvalRequestId: requestId,
    callId: params.itemId,
    reason: params.reason ?? undefined,
    approvalReason: params.reason ?? undefined,
    networkApprovalContext: null,
    proposedExecpolicyAmendment: null,
    proposedNetworkPolicyAmendments: null,
    availableDecisions: null,
    grantRoot: params.grantRoot ?? null,
    commandActions: null,
    createdAt: params.startedAtMs,
  };
}

function buildOwnerUserInputRequest(
  conversation: CodexConversationSnapshot,
  requestId: string,
  params: Extract<CodexThreadOwnerRequestEvent["request"], { method: "item/tool/requestUserInput" }>["params"],
): CodexUserInputRequest {
  return {
    type: "userInput",
    requestId,
    projectId: conversation.projectId,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    questions: params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isOther: question.isOther,
      isSecret: question.isSecret,
      options: question.options?.map((option) => ({
        label: option.label,
        description: option.description,
      })),
    })),
    createdAt: Date.now(),
  };
}

function buildOwnerMcpElicitationRequest(
  conversation: CodexConversationSnapshot,
  requestId: string,
  params: Extract<CodexThreadOwnerRequestEvent["request"], { method: "mcpServer/elicitation/request" }>["params"],
): CodexMcpServerElicitationRequest {
  return {
    type: "mcpServerElicitation",
    requestId,
    projectId: conversation.projectId,
    threadId: params.threadId,
    turnId: params.turnId ?? requestId,
    itemId: requestId,
    kind: params.mode === "url" ? "toolSuggestion" : "generic",
    mode: params.mode,
    serverName: params.serverName,
    message: params.message,
    url: params.mode === "url" ? params.url : undefined,
    elicitationId: params.mode === "url" ? params.elicitationId : undefined,
    requestedSchema: params.mode !== "url" ? params.requestedSchema : undefined,
    meta: params._meta,
    createdAt: Date.now(),
  };
}

function buildOwnerPermissionRequest(
  conversation: CodexConversationSnapshot,
  requestId: string,
  params: Extract<CodexThreadOwnerRequestEvent["request"], { method: "item/permissions/requestApproval" }>["params"],
): CodexPermissionRequest {
  return {
    type: "permissionRequest",
    requestId,
    projectId: conversation.projectId,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    cwd: params.cwd,
    reason: params.reason,
    permissions: params.permissions,
    response: null,
    completed: false,
    createdAt: params.startedAtMs,
  };
}

function upsertOwnerConversationRequest<TRequest extends CodexConversationServerRequest>(
  conversation: CodexConversationSnapshot,
  request: TRequest,
): CodexConversationSnapshot {
  return {
    ...conversation,
    requests: [
      ...conversation.requests.filter((candidate) => candidate.requestId !== request.requestId),
      request,
    ],
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function updateOwnerTurnItem(
  conversation: CodexConversationSnapshot,
  turnId: string,
  itemId: string,
  buildItem: (item: CodexConversationItem) => CodexConversationItem,
): CodexConversationSnapshot | null {
  const turnIndex = conversation.turns.findIndex((turn) => turn.turnId === turnId);
  if (turnIndex < 0) return conversation;

  const turn = conversation.turns[turnIndex]!;
  const itemIndex = turn.items.findIndex((item) => item.itemId === itemId);
  if (itemIndex < 0) return conversation;

  const nextItems = [...turn.items];
  nextItems[itemIndex] = buildItem(turn.items[itemIndex]!);
  const nextTurns = [...conversation.turns];
  nextTurns[turnIndex] = {
    ...turn,
    items: nextItems,
  };

  return {
    ...conversation,
    turns: nextTurns,
    updatedAt: Math.max(conversation.updatedAt, Date.now()),
  };
}

function attachOwnerApprovalRequestToItem(
  conversation: CodexConversationSnapshot,
  request: CodexApprovalRequest,
): CodexConversationSnapshot {
  const attached = updateOwnerTurnItem(conversation, request.turnId, request.itemId, (item) => ({
    ...item,
    approvalRequestId: request.requestId,
    networkApprovalContext: request.networkApprovalContext ?? item.networkApprovalContext ?? null,
    proposedExecpolicyAmendment: request.proposedExecpolicyAmendment ?? item.proposedExecpolicyAmendment ?? null,
    grantRoot: request.grantRoot ?? item.grantRoot ?? null,
    updatedAt: Date.now(),
  }));

  return attached ?? conversation;
}

function formatOwnerAskedQuestionLabel(questionCount: number): string {
  return questionCount === 1 ? "Asked 1 question" : `Asked ${questionCount} questions`;
}

function buildOwnerUserInputSyntheticItem(
  request: CodexUserInputRequest,
  answers: Record<string, string[]>,
  completed: boolean,
): CodexConversationItem {
  const itemId = `user-input-response-${request.requestId}`;
  const now = Date.now();
  return {
    threadId: request.threadId,
    turnId: request.turnId,
    entryId: itemId,
    itemId,
    type: "request_user_input",
    kind: "userInputResponse",
    semanticKind: "userInputResponse",
    source: "live",
    status: completed ? "completed" : "inProgress",
    markdownText: formatOwnerAskedQuestionLabel(request.questions.length),
    userInputQuestions: request.questions,
    userInputAnswers: answers,
    rawItem: {
      id: itemId,
      type: "userInputResponse",
      requestId: request.requestId,
      turnId: request.turnId,
      questions: request.questions,
      answers,
      completed,
    },
    createdAt: request.createdAt,
    updatedAt: now,
  };
}

function upsertOwnerUserInputSyntheticItem(
  conversation: CodexConversationSnapshot,
  request: CodexUserInputRequest,
  answers: Record<string, string[]>,
  completed: boolean,
): CodexConversationSnapshot | null {
  return upsertOwnerTurnItem(
    conversation,
    request.turnId,
    buildOwnerUserInputSyntheticItem(request, answers, completed),
  );
}

function upsertResolvedOwnerUserInputSyntheticItem(
  conversation: CodexConversationSnapshot,
  request: CodexUserInputRequest,
  answers: Record<string, string[]>,
): CodexConversationSnapshot | null {
  return upsertOwnerUserInputSyntheticItem(conversation, request, answers, true);
}

function buildOwnerMcpElicitationSyntheticItem(
  request: CodexMcpServerElicitationRequest,
  options: { completed: boolean; action: CodexMcpServerElicitationAction | null },
): CodexConversationItem {
  const itemId = `mcp-server-elicitation-${request.requestId}`;
  const now = Date.now();
  return {
    threadId: request.threadId,
    turnId: request.turnId,
    entryId: itemId,
    itemId,
    type: "mcpServerElicitation",
    kind: "systemEvent",
    semanticKind: "mcpServerElicitation",
    source: "live",
    status: options.completed ? "completed" : "inProgress",
    markdownText: request.message,
    rawItem: {
      id: itemId,
      type: "mcpServerElicitation",
      requestId: request.requestId,
      turnId: request.turnId,
      elicitation: {
        kind: request.kind,
        mode: request.mode,
        serverName: request.serverName,
        message: request.message,
        url: request.url,
        elicitationId: request.elicitationId,
        requestedSchema: request.requestedSchema,
        meta: request.meta,
      },
      completed: options.completed,
      action: options.action,
      serverName: request.serverName,
      message: request.message,
    },
    createdAt: request.createdAt,
    updatedAt: now,
  };
}

function upsertResolvedOwnerMcpElicitationSyntheticItem(
  conversation: CodexConversationSnapshot,
  request: CodexMcpServerElicitationRequest,
  options: { completed: boolean; action: CodexMcpServerElicitationAction | null },
): CodexConversationSnapshot | null {
  return upsertOwnerTurnItem(
    conversation,
    request.turnId,
    buildOwnerMcpElicitationSyntheticItem(request, options),
  );
}

function buildOwnerPermissionRequestSyntheticItem(
  request: CodexPermissionRequest,
  options: { completed: boolean; response: CodexPermissionRequestResponse | null },
): CodexConversationItem {
  const itemId = `permission-request-${request.requestId}`;
  const now = Date.now();
  return {
    threadId: request.threadId,
    turnId: request.turnId,
    entryId: itemId,
    itemId,
    type: "permissionRequest",
    kind: "systemEvent",
    semanticKind: "permissionRequest",
    source: "live",
    status: options.completed ? "completed" : "inProgress",
    markdownText: request.reason ?? "Permission request",
    rawItem: {
      id: itemId,
      type: "permissionRequest",
      requestId: request.requestId,
      turnId: request.turnId,
      reason: request.reason,
      permissions: request.permissions,
      completed: options.completed,
      response: options.response,
    },
    createdAt: request.createdAt,
    updatedAt: now,
  };
}

function upsertOwnerPermissionRequestSyntheticItem(
  conversation: CodexConversationSnapshot,
  request: CodexPermissionRequest,
  options: { completed: boolean; response: CodexPermissionRequestResponse | null },
): CodexConversationSnapshot | null {
  return upsertOwnerTurnItem(
    conversation,
    request.turnId,
    buildOwnerPermissionRequestSyntheticItem(request, options),
  );
}

function applyOwnerApprovalResponseToConversation(
  conversation: CodexConversationSnapshot,
  requestId: string,
): CodexConversationSnapshot | null {
  const request = conversation.requests.find((candidate) =>
    candidate.requestId === requestId && candidate.type === "approval"
  );
  if (!request || request.type !== "approval") return conversation;

  return applyOwnerServerRequestResolvedToConversation(conversation, {
    threadId: request.threadId,
    requestId,
  });
}

function applyOwnerUserInputResponseToConversation(
  conversation: CodexConversationSnapshot,
  requestId: string,
  answers: Record<string, string[]>,
): CodexConversationSnapshot | null {
  const request = conversation.requests.find((candidate) =>
    candidate.requestId === requestId && candidate.type === "userInput"
  );
  if (!request || request.type !== "userInput") return conversation;

  const withSyntheticItem = upsertOwnerUserInputSyntheticItem(conversation, request, answers, true) ?? conversation;
  return {
    ...withSyntheticItem,
    requests: withSyntheticItem.requests.filter((candidate) => candidate.requestId !== requestId),
    statusActiveFlags: withSyntheticItem.requests.length <= 1 ? [] : withSyntheticItem.statusActiveFlags,
    updatedAt: Math.max(withSyntheticItem.updatedAt, Date.now()),
  };
}

function applyOwnerMcpElicitationResponseToConversation(
  conversation: CodexConversationSnapshot,
  requestId: string,
  action: CodexMcpServerElicitationAction,
): CodexConversationSnapshot | null {
  const request = conversation.requests.find((candidate) =>
    candidate.requestId === requestId && candidate.type === "mcpServerElicitation"
  );
  if (!request || request.type !== "mcpServerElicitation") return conversation;

  const withSyntheticItem = upsertResolvedOwnerMcpElicitationSyntheticItem(conversation, request, {
    completed: true,
    action,
  }) ?? conversation;
  return {
    ...withSyntheticItem,
    requests: withSyntheticItem.requests.filter((candidate) => candidate.requestId !== requestId),
    statusActiveFlags: withSyntheticItem.requests.length <= 1 ? [] : withSyntheticItem.statusActiveFlags,
    updatedAt: Math.max(withSyntheticItem.updatedAt, Date.now()),
  };
}

function applyOwnerPermissionRequestResponseToConversation(
  conversation: CodexConversationSnapshot,
  requestId: string,
  response: CodexPermissionRequestResponse,
): CodexConversationSnapshot | null {
  const request = conversation.requests.find((candidate) =>
    candidate.requestId === requestId && candidate.type === "permissionRequest"
  );
  if (!request || request.type !== "permissionRequest") return conversation;

  const completedRequest: CodexPermissionRequest = {
    ...request,
    completed: true,
    response,
  };
  const withSyntheticItem = upsertOwnerPermissionRequestSyntheticItem(conversation, completedRequest, {
    completed: true,
    response,
  }) ?? conversation;
  return {
    ...withSyntheticItem,
    requests: withSyntheticItem.requests.filter((candidate) => candidate.requestId !== requestId),
    statusActiveFlags: withSyntheticItem.requests.length <= 1 ? [] : withSyntheticItem.statusActiveFlags,
    updatedAt: Math.max(withSyntheticItem.updatedAt, Date.now()),
  };
}

function applyOwnerServerRequestToConversation(
  conversation: CodexConversationSnapshot,
  request: CodexThreadOwnerRequestEvent["request"],
): CodexConversationSnapshot | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const approvalRequest = buildOwnerCommandApprovalRequest(conversation, request.id, request.params);
      return attachOwnerApprovalRequestToItem(
        upsertOwnerConversationRequest(conversation, approvalRequest),
        approvalRequest,
      );
    }
    case "item/fileChange/requestApproval": {
      const approvalRequest = buildOwnerFileApprovalRequest(conversation, request.id, request.params);
      return attachOwnerApprovalRequestToItem(
        upsertOwnerConversationRequest(conversation, approvalRequest),
        approvalRequest,
      );
    }
    case "item/tool/requestUserInput": {
      const userInputRequest = buildOwnerUserInputRequest(conversation, request.id, request.params);
      const withRequest = upsertOwnerConversationRequest(conversation, userInputRequest);
      return upsertOwnerUserInputSyntheticItem(withRequest, userInputRequest, {}, false) ?? withRequest;
    }
    case "item/tool/call":
      return null;
    case "mcpServer/elicitation/request": {
      const elicitationRequest = buildOwnerMcpElicitationRequest(conversation, request.id, request.params);
      const withRequest = upsertOwnerConversationRequest(conversation, elicitationRequest);
      return upsertOwnerTurnItem(
        withRequest,
        elicitationRequest.turnId,
        buildOwnerMcpElicitationSyntheticItem(elicitationRequest, {
          completed: false,
          action: null,
        }),
      ) ?? withRequest;
    }
    case "item/permissions/requestApproval": {
      const permissionRequest = buildOwnerPermissionRequest(conversation, request.id, request.params);
      const withRequest = upsertOwnerConversationRequest(conversation, permissionRequest);
      return upsertOwnerPermissionRequestSyntheticItem(withRequest, permissionRequest, {
        completed: false,
        response: null,
      }) ?? withRequest;
    }
  }

  return null;
}

function isConversationStreaming(conversation: CodexConversationSnapshot): boolean {
  return conversation.turns.some((turn) => turn.status === "inProgress");
}

function resolveProjectPermissionMode(
  permissionStateByProject: ReadonlyMap<string, CodexPermissionState>,
  projectId: string,
): CodexPermissionMode {
  return permissionStateByProject.get(projectId)?.mode ?? DEFAULT_PERMISSION_STATE.mode;
}

function resolveProjectPermissionState(
  permissionStateByProject: ReadonlyMap<string, CodexPermissionState>,
  projectId: string,
): CodexPermissionState {
  return permissionStateByProject.get(projectId) ?? DEFAULT_PERMISSION_STATE;
}

function arePermissionStatesEqual(left: CodexPermissionState, right: CodexPermissionState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class CodexAppServerManager {
  private connection: CodexConnectionState = INITIAL_CONNECTION;
  private account: CodexAccountSnapshot | null = null;
  private dictationState: CodexDictationStateSnapshot = DEFAULT_CODEX_DICTATION_STATE;
  private availableModels: CodexModelOption[] = EMPTY_MODELS;
  private readonly threadSummariesByProject = new Map<string, CodexThreadSummary[]>();
  private readonly threadSummariesById = new Map<string, CodexThreadSummary>();
  private readonly loadedThreadSummariesByProject = new Set<string>();
  private readonly threadSummaryLoadsInFlightByProject = new Map<string, Promise<CodexThreadSummary[]>>();
  private readonly conversationsById = new Map<string, CodexConversationSnapshot>();
  private readonly olderTurnLoadsInFlightByThread = new Map<string, Promise<CodexConversationSnapshot | null>>();
  private readonly primaryConversationRequestByThread = new Map<string, CodexConversationLiveRequest | null>();
  private readonly conversationVersionById = new Map<string, number>();
  private readonly streamState = new LocalConversationStreamState();
  private readonly composerIntentsByThread = new Map<string, CodexComposerIntent>();
  private readonly permissionStateByProject = new Map<string, CodexPermissionState>();
  private readonly permissionStateLoadsInFlightByProject = new Map<string, Promise<CodexPermissionState>>();
  private readonly threadStartProgressByTarget = new Map<string, CodexThreadStartProgressState>();
  private readonly threadTitlesById = new Map<string, string>();
  private readonly interruptedTurnIdsByThread = new Map<string, Set<string>>();
  private readonly recentConversationIds: string[] = [];
  private readonly ownerTextDeltaQueue = new OwnerTextDeltaQueue((updates, options) => {
    this.applyOwnerTextDeltas(updates, options);
  });
  private readonly outputDeltaQueue = new OutputDeltaQueue((updates) => {
    this.applyOutputDeltas(updates);
  });
  private readonly ownerRollbackTombstonesByConversationId = new Map<string, Set<string>>();
  private readonly ownerStreamPublishCursorsByConversationId = new Map<string, OwnerStreamPublishCursor>();
  private readonly ownerStreamPublishIdleWaitersByConversationId = new Map<string, Set<OwnerStreamPublishIdleWaiter>>();
  private readonly terminalInputBuffers = new Map<string, string>();
  private readonly ownerQueuedFollowUpDispatchInFlight = new Set<string>();
  private readonly ownerAppServerRequestClient = new IpcRendererOwnerAppServerRequestClient();

  private readonly connectionCallbacks = new Set<StoreListener>();
  private readonly accountCallbacks = new Set<StoreListener>();
  private readonly controlCallbacks = new Set<ControlListener>();
  private readonly projectSummaryCallbacksByProject = new Map<string, Set<StoreListener>>();
  private readonly conversationCallbacks = new Map<string, Set<ConversationListener>>();
  private anyConversationCallbacks = new Set<AnyConversationListener>();
  private anyConversationMetaCallbacks = new Set<AnyConversationListener>();
  private readonly turnCompletedListeners = new Set<TurnCompletedListener>();
  private readonly approvalRequestListeners = new Set<ApprovalRequestListener>();
  private readonly userInputRequestListeners = new Set<UserInputRequestListener>();
  private readonly lastAnySnapshotById = new Map<string, ConversationAnyProjection>();
  private readonly lastMetaSnapshotById = new Map<string, ConversationMetaProjection>();
  private lastAnyOrderKey: string | null = null;
  private lastMetaOrderKey: string | null = null;

  private readonly busUnsubscribers: Array<() => void> = [];
  private bootstrapStarted = false;
  private readonly resyncInFlight = new Set<string>();
  private lastHostError: CodexHostErrorState | null = null;

  constructor(private readonly hostId: string) {
    this.busUnsubscribers.push(
      subscribeCodexAppServerMessage("shared-object-updated", (event) => {
        this.handleSharedObjectUpdated(event);
      }),
      subscribeCodexAppServerMessage("thread-stream-state-changed", (event) => {
        this.handleThreadStreamStateChanged(event);
      }),
      subscribeCodexAppServerMessage("client-status-changed", (event) => {
        this.handleClientStatusChanged(event);
      }),
      subscribeCodexAppServerMessage("thread-title-updated", (event) => {
        this.handleThreadTitleUpdated(event);
      }),
      subscribeCodexAppServerMessage("thread-deleted", (event) => {
        this.handleThreadDeleted(event);
      }),
      subscribeCodexAppServerMessage("thread-owner-notification", (event) => {
        this.handleThreadOwnerNotification(event);
      }),
      subscribeCodexAppServerMessage("thread-owner-request", (event) => {
        this.handleThreadOwnerRequest(event);
      }),
      subscribeCodexAppServerMessage("thread-owner-unavailable", (event) => {
        this.handleThreadOwnerUnavailable(event);
      }),
      subscribeCodexAppServerMessage("mcp-notification", (event) => {
        this.handleMcpNotification(event);
      }),
      subscribeCodexAppServerMessage("error", (event) => {
        this.handleHostError(event);
      }),
    );
  }

  getHostId(): string {
    return this.hostId;
  }

  start(): void {
    if (this.bootstrapStarted) {
      return;
    }

    this.bootstrapStarted = true;
    void this.bootstrapAccountAndConnection();
    void this.bootstrapDictationState();
    void this.bootstrapAvailableModels();
    void this.bootstrapPermissionModes();
  }

  stop(): void {
    // Host bridge lifecycle is provider-owned; manager subscriptions stay attached
    // for the lifetime of the manager instance, mirroring the upstream manager graph.
  }

  destroy(): void {
    this.ownerTextDeltaQueue.cancel();
    this.outputDeltaQueue.cancel();
    this.ownerRollbackTombstonesByConversationId.clear();
    this.cancelOwnerStreamPublishQueues();
    this.terminalInputBuffers.clear();
    while (this.busUnsubscribers.length > 0) {
      this.busUnsubscribers.pop()?.();
    }
  }

  readConnection(): CodexConnectionState {
    return this.connection;
  }

  readAccount(): CodexAccountSnapshot | null {
    return this.account;
  }

  readAvailableModels(): CodexModelOption[] {
    return this.availableModels;
  }

  readDictationState(): CodexDictationStateSnapshot {
    return this.dictationState;
  }

  readProjectThreadSummaries(projectId: string): CodexThreadSummary[] {
    return this.threadSummariesByProject.get(projectId) ?? EMPTY_THREADS;
  }

  readThreadSummary(threadId: string): CodexThreadSummary | null {
    return this.threadSummariesById.get(threadId) ?? null;
  }

  readConversation(threadId: string): CodexConversationSnapshot | null {
    return this.conversationsById.get(threadId) ?? null;
  }

  readPrimaryConversationRequest(threadId: string): CodexConversationLiveRequest | null {
    return this.primaryConversationRequestByThread.get(threadId) ?? null;
  }

  readConversationCollaborationMode(threadId: string): CodexCollaborationModeState | null {
    return this.conversationsById.get(threadId)?.latestCollaborationMode ?? null;
  }

  readConversationThreadSettings(threadId: string): CodexConversationThreadSettings | null {
    return this.conversationsById.get(threadId)?.latestThreadSettings ?? null;
  }

  readComposerIntent(threadId: string): CodexComposerIntent | null {
    return this.composerIntentsByThread.get(threadId) ?? null;
  }

  readPermissionMode(projectId: string): CodexPermissionMode {
    return resolveProjectPermissionMode(this.permissionStateByProject, projectId);
  }

  readPermissionState(projectId: string): CodexPermissionState {
    return resolveProjectPermissionState(this.permissionStateByProject, projectId);
  }

  readThreadStartProgress(projectId: string, sessionId: string): CodexThreadStartProgressState | null {
    return this.threadStartProgressByTarget.get(getThreadStartProgressTargetKey(projectId, sessionId)) ?? null;
  }

  readLastHostError(): CodexHostErrorState | null {
    return this.lastHostError;
  }

  readRecentConversations(): CodexConversationSnapshot[] {
    const conversations: CodexConversationSnapshot[] = [];
    for (const threadId of this.recentConversationIds) {
      const conversation = this.conversationsById.get(threadId);
      if (conversation) {
        conversations.push(conversation);
      }
    }
    return conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  subscribeConnection(listener: StoreListener): () => void {
    this.start();
    return subscribeSet(this.connectionCallbacks, listener);
  }

  subscribeAccount(listener: StoreListener): () => void {
    this.start();
    return subscribeSet(this.accountCallbacks, listener);
  }

  subscribeControl(listener: ControlListener): () => void {
    this.start();
    return subscribeSet(this.controlCallbacks, listener);
  }

  subscribeProjectThreadSummaries(projectId: string, listener: StoreListener): () => void {
    this.start();
    const listeners = getOrCreateListenerSet(this.projectSummaryCallbacksByProject, projectId);
    this.ensureProjectThreadSummariesLoaded(projectId);
    const unsubscribe = subscribeSet(listeners, listener);
    return () => {
      unsubscribe();
      cleanupListenerSet(this.projectSummaryCallbacksByProject, projectId);
    };
  }

  addConversationCallback(threadId: string, listener: ConversationListener): () => void {
    this.start();
    const listeners = getOrCreateListenerSet(this.conversationCallbacks, threadId);
    const unsubscribe = subscribeSet(listeners, listener);
    return () => {
      unsubscribe();
      cleanupListenerSet(this.conversationCallbacks, threadId);
    };
  }

  removeConversationCallback(threadId: string, listener: ConversationListener): void {
    const listeners = this.conversationCallbacks.get(threadId);
    if (!listeners) {
      return;
    }

    listeners.delete(listener);
    cleanupListenerSet(this.conversationCallbacks, threadId);
  }

  addAnyConversationCallback(listener: AnyConversationListener): () => void {
    this.start();
    return subscribeSet(this.anyConversationCallbacks, listener);
  }

  removeAnyConversationCallback(listener: AnyConversationListener): void {
    this.anyConversationCallbacks.delete(listener);
  }

  addAnyConversationMetaCallback(listener: AnyConversationListener): () => void {
    this.start();
    return subscribeSet(this.anyConversationMetaCallbacks, listener);
  }

  addTurnCompletedListener(listener: TurnCompletedListener): () => void {
    this.start();
    return subscribeSet(this.turnCompletedListeners, listener);
  }

  addApprovalRequestListener(listener: ApprovalRequestListener): () => void {
    this.start();
    return subscribeSet(this.approvalRequestListeners, listener);
  }

  addUserInputRequestListener(listener: UserInputRequestListener): () => void {
    this.start();
    return subscribeSet(this.userInputRequestListeners, listener);
  }

  removeAnyConversationMetaCallback(listener: AnyConversationListener): void {
    this.anyConversationMetaCallbacks.delete(listener);
  }

  hydrateThreadSummaries(projectId: string, threads: CodexThreadSummary[]): void {
    const normalizedThreads = threads.map((thread) => {
      const nextThread = this.withCachedThreadTitle(thread);
      if (nextThread.threadName?.trim()) {
        this.threadTitlesById.set(nextThread.threadId, nextThread.threadName);
      }
      return nextThread;
    });
    const sortedThreads = sortThreadSummaries(normalizedThreads);
    this.loadedThreadSummariesByProject.add(projectId);
    const current = this.threadSummariesByProject.get(projectId) ?? EMPTY_THREADS;
    if (areThreadSummariesEqual(current, sortedThreads)) {
      return;
    }

    this.threadSummariesByProject.set(projectId, sortedThreads);
    for (const thread of sortedThreads) {
      this.threadSummariesById.set(thread.threadId, thread);
      this.ensureRecentConversationId(thread.threadId);
    }
    this.notifyProjectThreadSummaries(projectId);
    this.notifyAnyConversationCallbacks({ forceMeta: true });
  }

  async loadThreads(
    projectId: string,
    opts?: { includeArchived?: boolean },
  ): Promise<CodexThreadSummary[]> {
    if (!opts && this.threadSummaryLoadsInFlightByProject.has(projectId)) {
      return this.threadSummaryLoadsInFlightByProject.get(projectId)!;
    }

    const loadPromise = this.loadThreadsFromHost(projectId, opts);
    if (!opts) {
      this.threadSummaryLoadsInFlightByProject.set(projectId, loadPromise);
    }

    try {
      return await loadPromise;
    } finally {
      if (!opts) {
        this.threadSummaryLoadsInFlightByProject.delete(projectId);
      }
    }
  }

  private async loadThreadsFromHost(
    projectId: string,
    opts?: { includeArchived?: boolean },
  ): Promise<CodexThreadSummary[]> {
    const threads = (await invoke("codex:threads:list", projectId, opts)) as CodexThreadSummary[];
    this.hydrateThreadSummaries(projectId, threads);
    return threads;
  }

  async loadAvailableModels(): Promise<CodexModelOption[]> {
    const models = (await invoke("codex:model:list")) as CodexModelOption[];
    this.setAvailableModels(models);
    return models;
  }

  async loadDictationState(): Promise<CodexDictationStateSnapshot> {
    const nextState = (await invoke("codex:dictation:state:read")) as CodexDictationStateSnapshot;
    this.setDictationState(nextState);
    return nextState;
  }

  async listCollaborationModes(): Promise<CodexCollaborationModePreset[]> {
    return (await invoke("codex:collaboration-mode:list")) as CodexCollaborationModePreset[];
  }

  async requestThreadStreamSnapshot(threadId: string): Promise<CodexConversationSnapshot | null> {
    const conversation = (await invoke("codex:thread:snapshot:request", threadId)) as CodexConversationSnapshot | null;
    if (conversation) {
      this.applyConversationSnapshot(threadId, conversation);
    }
    return conversation;
  }

  async requestThreadStreamResume(threadId: string): Promise<CodexConversationSnapshot | null> {
    const baseRevision = this.streamState.getRevision(threadId) ?? 0;
    this.markConversationResumeState(threadId, "resuming");

    try {
      const conversation = (await invoke("codex:thread:resume:request", threadId)) as CodexConversationSnapshot | null;
      if (conversation) {
        this.applyConversationSnapshot(threadId, conversation);
        this.streamState.markOwner(threadId, baseRevision);
        await this.publishOwnerSnapshotTransaction(
          threadId,
          conversation,
          "owner resume",
        );
        await invoke("codex:thread:resume-buffer:release", threadId);
        const latestConversation = this.conversationsById.get(threadId) ?? conversation;
        return latestConversation;
      }
      this.markConversationResumeState(threadId, "needs_resume");
      return conversation;
    } catch (error) {
      await this.releaseResumeBufferAfterFailedResume(threadId);
      this.markConversationResumeState(threadId, "needs_resume");
      throw error;
    }
  }

  private markConversationResumeState(
    threadId: string,
    resumeState: CodexConversationSnapshot["resumeState"],
  ): void {
    const conversation = this.conversationsById.get(threadId);
    if (!conversation || conversation.resumeState === resumeState) {
      return;
    }

    this.applyConversationSnapshot(threadId, {
      ...conversation,
      resumeState,
    });
  }

  private async releaseResumeBufferAfterFailedResume(threadId: string): Promise<void> {
    try {
      await invoke("codex:thread:resume-buffer:release", threadId);
    } catch {
    }
  }

  async setThreadViewActive(threadId: string, active: boolean): Promise<boolean> {
    return (await invoke("codex:thread:view-active:set", {
      threadId,
      active,
    })) as boolean;
  }

  requestThreadOlderTurns(threadId: string): Promise<CodexConversationSnapshot | null> {
    const existing = this.olderTurnLoadsInFlightByThread.get(threadId);
    if (existing) return existing;

    const loadPromise = (async () => {
      if (this.isFollowerForConversation(threadId)) {
        await this.waitForCompleteHistoryFromOwner(threadId);
        return this.conversationsById.get(threadId) ?? null;
      }

      const conversation = (await invoke("codex:thread:turns:load-older", threadId)) as CodexConversationSnapshot | null;
      if (conversation) {
        this.applyConversationSnapshot(threadId, conversation);
      }
      return conversation;
    })();

    this.olderTurnLoadsInFlightByThread.set(threadId, loadPromise);
    void loadPromise.finally(() => {
      if (this.olderTurnLoadsInFlightByThread.get(threadId) === loadPromise) {
        this.olderTurnLoadsInFlightByThread.delete(threadId);
      }
    });
    return loadPromise;
  }

  private async loadCompleteHistoryAsOwner(threadId: string): Promise<CodexThreadOwnerLoadCompleteHistoryResult> {
    const conversation = (await invoke(
      "codex:thread:turns:load-complete",
      threadId,
    )) as CodexConversationSnapshot | null;
    const currentRevision = this.streamState.getRevision(threadId) ?? 0;
    if (!conversation) {
      return { revision: currentRevision };
    }

    return {
      revision: await this.publishOwnerSnapshotTransaction(
        threadId,
        conversation,
        "complete history",
      ),
    };
  }

  private async publishOwnerSnapshotTransaction(
    threadId: string,
    conversation: CodexConversationSnapshot,
    label: string,
  ): Promise<number> {
    await this.waitForOwnerStreamPublishIdle(threadId);
    const role = this.streamState.getRole(threadId);
    const currentRevision = this.streamState.getRevision(threadId) ?? 0;
    const currentConversation = this.conversationsById.get(threadId) ?? conversation;
    if (!role || role.role !== "owner") {
      throw new Error(`Cannot publish ${label} snapshot because renderer is not owner for ${threadId}`);
    }

    const cursor = this.ensureOwnerStreamPublishCursor(
      threadId,
      currentRevision,
      currentConversation,
    );
    if (cursor.inFlight || cursor.dirty) {
      throw new Error(`Cannot publish ${label} snapshot because owner stream cursor is still busy for ${threadId}`);
    }

    const revision = cursor.acceptedRevision + 1;
    cursor.inFlight = true;
    this.applyConversationSnapshot(threadId, conversation);
    const latestConversation = this.conversationsById.get(threadId) ?? conversation;
    const accepted = await this.dispatchOwnerStreamSnapshot(threadId, revision, latestConversation);
    if (this.ownerStreamPublishCursorsByConversationId.get(threadId) !== cursor) {
      throw new Error(`Could not publish ${label} snapshot for ${threadId}`);
    }
    if (!accepted) {
      cursor.inFlight = false;
      this.markOwnerStreamPublishUnavailable(threadId);
      throw new Error(`Could not publish ${label} snapshot for ${threadId}`);
    }

    cursor.acceptedRevision = revision;
    cursor.acceptedConversation = latestConversation;
    cursor.inFlight = false;
    this.streamState.recordOwnerRevision(threadId, revision);
    this.processOwnerStreamPublishCursor(threadId);
    this.resolveOwnerStreamPublishIdleWaiters(threadId);
    return revision;
  }

  private async publishOwnerActionSnapshotMutation(
    threadId: string,
    label: string,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
  ): Promise<number> {
    const currentConversation = this.conversationsById.get(threadId);
    const currentRevision = this.streamState.getRevision(threadId) ?? 0;
    if (!currentConversation) {
      throw new Error(`Cannot publish ${label} because conversation ${threadId} is unavailable`);
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (!nextConversation || nextConversation === currentConversation) {
      return currentRevision;
    }
    if (buildCodexConversationStateUpdates(currentConversation, nextConversation).length === 0) {
      return currentRevision;
    }

    return await this.publishOwnerSnapshotTransaction(threadId, nextConversation, label);
  }

  async startThreadForSession(input: CodexThreadStartForSessionInput & {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexThreadSettings["reasoningEffort"];
  }): Promise<CodexThreadDetail> {
    const runInTarget = input.runInTarget ?? "localProject";
    const progressTargetKey = getThreadStartProgressTargetKey(input.projectId, input.sessionId);
    this.applyThreadStartProgress({
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget,
      threadId: null,
      phase: "startingThread",
      message: "Sending message…",
      clearOutput: true,
      updatedAt: Date.now(),
    });

    try {
      await this.loadPermissionState(input.projectId);
      const detail = (await invoke("codex:thread:start-for-session", {
        ...input,
        permissionMode: this.readPermissionMode(input.projectId),
      })) as CodexThreadDetail;

      await this.requestThreadStreamSnapshot(detail.threadId).catch(() => null);
      return detail;
    } catch (error) {
      const currentProgress = this.threadStartProgressByTarget.get(progressTargetKey);
      if (currentProgress?.phase !== "failed") {
        this.applyThreadStartProgress({
          projectId: input.projectId,
          sessionId: input.sessionId,
          runInTarget,
          threadId: currentProgress?.threadId ?? null,
          phase: "failed",
          message: "Message could not be sent.",
          updatedAt: Date.now(),
        });
      }
      throw error;
    }
  }

  async startSideChat(input: CodexSideChatStartInput): Promise<CodexSideChatStartResult> {
    await this.loadPermissionState(input.projectId);
    const result = (await invoke("codex:thread:side-chat:start", {
      ...input,
      permissionMode: input.permissionMode ?? this.readPermissionMode(input.projectId),
    })) as CodexSideChatStartResult;
    this.applyConversationSnapshot(result.threadId, result.conversation);
    return result;
  }

  async discardSideChat(threadId: string): Promise<boolean> {
    const result = (await invoke("codex:thread:side-chat:discard", threadId)) as boolean;
    if (result) {
      this.removeThreadLocalState(threadId);
    }
    return result;
  }

  async setThreadName(threadId: string, name: string, projectId: string | null): Promise<boolean> {
    const normalizedName = normalizeCodexManualThreadTitle(name);
    if (!normalizedName) {
      return false;
    }

    this.applyThreadTitleUpdate(threadId, normalizedName);
    try {
      const result = (await invoke("codex:thread:name:set", threadId, normalizedName)) as boolean;
      if (!result) {
        if (projectId) void this.loadThreads(projectId).catch(() => {});
      }
      return result;
    } catch (error) {
      if (projectId) void this.loadThreads(projectId).catch(() => {});
      throw error;
    }
  }

  async archiveThread(threadId: string, projectId: string): Promise<boolean> {
    const result = (await invoke("codex:thread:archive", threadId)) as boolean;
    if (result) {
      await this.loadThreads(projectId);
    }
    return result;
  }

  async unarchiveThread(threadId: string, projectId: string): Promise<CodexThreadSummary | null> {
    const result = (await invoke("codex:thread:unarchive", threadId)) as CodexThreadSummary | null;
    await this.loadThreads(projectId, { includeArchived: true });
    return result;
  }

  private isFollowerForConversation(conversationId: string): boolean {
    const role = this.streamState.getRole(conversationId);
    return role?.role === "follower" && typeof role.ownerClientId === "string" && role.ownerClientId.length > 0;
  }

  private assertOwnerForConversation(conversationId: string): void {
    if (this.streamState.getRole(conversationId)?.role === "owner") return;
    throw new Error(`Renderer is not owner for conversation ${conversationId}`);
  }

  private async ensureOwnerForConversationAction(conversationId: string, label: string): Promise<void> {
    const role = this.streamState.getRole(conversationId);
    if (role?.role === "owner") {
      return;
    }
    if (role?.role === "follower") {
      throw new Error(`Cannot run ${label} locally while following another owner for ${conversationId}`);
    }

    const conversation = await this.requestThreadStreamResume(conversationId);
    if (!conversation || this.streamState.getRole(conversationId)?.role !== "owner") {
      throw new Error(`Cannot run ${label} because conversation ${conversationId} could not become renderer-owned`);
    }
  }

  getThreadRoleForRendererClientRequest(conversationId: string): CodexRendererThreadRole {
    return this.streamState.getRole(conversationId)?.role === "owner" ? "owner" : "follower";
  }

  private findConversationIdForRequest(requestId: string): string | null {
    for (const conversation of this.conversationsById.values()) {
      if (conversation.requests.some((request) => request.requestId === requestId)) {
        return conversation.threadId;
      }
    }
    return null;
  }

  private findFollowerConversationIdForRequest(requestId: string): string | null {
    const conversationId = this.findConversationIdForRequest(requestId);
    if (!conversationId || !this.isFollowerForConversation(conversationId)) return null;
    return conversationId;
  }

  private findOwnerRoutedConversationIdForRequestResponse(
    requestId: string,
    conversationId?: string | null,
  ): string | null {
    const explicitConversationId = conversationId?.trim() || null;
    if (explicitConversationId) {
      if (this.isFollowerForConversation(explicitConversationId)) {
        return explicitConversationId;
      }

      const conversation = this.conversationsById.get(explicitConversationId);
      const requestStillVisible = conversation?.requests.some((request) => request.requestId === requestId) === true;
      if (requestStillVisible && conversation?.resumeState === "needs_resume") {
        return explicitConversationId;
      }

      return null;
    }

    return this.findFollowerConversationIdForRequest(requestId);
  }

  private assertOwnerForRequest(requestId: string): void {
    const conversationId = this.findConversationIdForRequest(requestId);
    if (!conversationId) {
      throw new Error(`Could not resolve conversation for request ${requestId}`);
    }
    this.assertOwnerForConversation(conversationId);
  }

  private async runFollowerActionThroughOwner<TResult>(
    conversationId: string,
    action: CodexThreadOwnerActionRequest,
    options: {
      fallback?: () => Promise<TResult>;
      fallbackOnTimeout?: boolean;
    } = {},
  ): Promise<TResult> {
    try {
      return (await invoke("codex:thread-follower:action", {
        conversationId,
        action,
      })) as TResult;
    } catch (error) {
      if (!this.isUnavailableOwnerActionError(error, options.fallbackOnTimeout === true)) {
        throw error;
      }
      this.markConversationNeedsResumeAfterUnavailableOwner(conversationId);
      if (!options.fallback) {
        throw error;
      }

      await this.requestThreadStreamResume(conversationId);
      return await options.fallback();
    }
  }

  private isUnavailableOwnerActionError(error: unknown, includeTimeout: boolean): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("no-client-found") ||
      message.includes("No renderer owner") ||
      (includeTimeout && (
        message.includes("timeout") ||
        message.includes("timed out")
      ))
    );
  }

  private markConversationNeedsResumeAfterUnavailableOwner(conversationId: string): void {
    const role = this.streamState.getRole(conversationId);
    if (role?.role === "follower") {
      this.streamState.markOwnerUnavailable(role.ownerClientId);
    }
    const conversation = this.conversationsById.get(conversationId);
    if (conversation && conversation.resumeState !== "needs_resume") {
      this.applyConversationSnapshot(conversationId, {
        ...conversation,
        resumeState: "needs_resume",
      });
    }
  }

  private async runFollowerRequestResponseThroughOwner(
    conversationId: string,
    action: CodexThreadOwnerActionRequest,
  ): Promise<boolean> {
    try {
      return this.readOwnerBooleanActionResult(
        await this.runFollowerActionThroughOwner<unknown>(conversationId, action),
      );
    } catch (error) {
      if (this.isUnavailableOwnerActionError(error, false)) {
        return false;
      }
      throw error;
    }
  }

  private async waitForCompleteHistoryFromOwner(threadId: string): Promise<void> {
    const role = this.streamState.getRole(threadId);
    if (role?.role !== "follower" || !role.ownerClientId) return;

    const result = await this.runFollowerActionThroughOwner<CodexThreadOwnerLoadCompleteHistoryResult>(
      threadId,
      {
        type: "loadCompleteHistory",
        threadId,
      },
    );
    await this.streamState.waitForRevision({
      conversationId: threadId,
      ownerClientId: role.ownerClientId,
      revision: result.revision,
      timeoutMs: COMPLETE_HISTORY_WAIT_TIMEOUT_MS,
    });
  }

  private async waitForFollowerActionStreamRevision(
    threadId: string,
    result: unknown,
  ): Promise<void> {
    const streamRevision = this.readOwnerStreamRevision(result);
    if (streamRevision === null) return;

    const role = this.streamState.getRole(threadId);
    if (role?.role !== "follower" || !role.ownerClientId) return;

    await this.streamState.waitForRevision({
      conversationId: threadId,
      ownerClientId: role.ownerClientId,
      revision: streamRevision,
      timeoutMs: COMPLETE_HISTORY_WAIT_TIMEOUT_MS,
    });
  }

  private withOwnerStreamRevision<TResult>(result: TResult, streamRevision: number): TResult {
    if (typeof result === "object" && result !== null && !Array.isArray(result)) {
      return {
        ...result,
        streamRevision,
      };
    }

    return result;
  }

  private buildOwnerStreamRevisionResult(streamRevision: number): OwnerStreamRevisionResult {
    return { streamRevision };
  }

  private readOwnerStreamRevision(result: unknown): number | null {
    const resultRecord = asRecord(result);
    return typeof resultRecord?.streamRevision === "number" ? resultRecord.streamRevision : null;
  }

  private readOwnerBooleanActionResult(result: unknown): boolean {
    const resultRecord = asRecord(result);
    if (typeof resultRecord?.accepted === "boolean") return resultRecord.accepted;
    if (typeof resultRecord?.ok === "boolean") return resultRecord.ok;
    return result === true;
  }

  async handleThreadOwnerActionRequest(action: CodexThreadOwnerActionRequest): Promise<unknown> {
    switch (action.type) {
      case "startTurn":
        this.assertOwnerForConversation(action.threadId);
        return await this.startTurnAsOwner(action.threadId, action.prompt, action.opts);
      case "steerTurn":
        this.assertOwnerForConversation(action.input.threadId);
        return await this.steerTurnAsOwner(action.input);
      case "interruptTurn":
        this.assertOwnerForConversation(action.threadId);
        return await this.interruptTurnAsOwner(action.threadId, action.turnId);
      case "updateThreadSettings":
        this.assertOwnerForConversation(action.threadId);
        return await this.setThreadSettingsForConversationAsOwner(action.threadId, action.patch);
      case "compactThread":
        this.assertOwnerForConversation(action.threadId);
        await this.compactThreadAsOwner(action.threadId);
        return null;
      case "setThreadGoal":
        this.assertOwnerForConversation(action.threadId);
        return await this.setThreadGoalAsOwner({
          threadId: action.threadId,
          objective: action.objective,
          tokenBudget: action.tokenBudget,
        });
      case "clearThreadGoal":
        this.assertOwnerForConversation(action.threadId);
        return await this.clearThreadGoalAsOwner(action.threadId);
      case "setThreadMemoryMode":
        this.assertOwnerForConversation(action.threadId);
        await this.setThreadMemoryModeAsOwner({
          threadId: action.threadId,
          mode: action.mode,
        });
        return null;
      case "editLastUserTurn":
        this.assertOwnerForConversation(action.threadId);
        return await this.editLastUserTurnAsOwner(action.threadId, action.turnId, action.message, action.opts);
      case "forkConversationFromTurn":
        this.assertOwnerForConversation(action.threadId);
        return await this.forkConversationFromTurnAsOwner(action.threadId, action.turnId, action.message);
      case "loadCompleteHistory":
        this.assertOwnerForConversation(action.threadId);
        return await this.loadCompleteHistoryAsOwner(action.threadId);
      case "enqueueQueuedFollowUp":
        this.assertOwnerForConversation(action.threadId);
        return await this.enqueueQueuedFollowUpAsOwner(action.threadId, action.prompt, action.opts);
      case "removeQueuedFollowUp":
        this.assertOwnerForConversation(action.threadId);
        return await this.removeQueuedFollowUpAsOwner(action.threadId, action.followUpId);
      case "reorderQueuedFollowUps":
        this.assertOwnerForConversation(action.threadId);
        return await this.reorderQueuedFollowUpsAsOwner(action.threadId, action.orderedFollowUpIds);
      case "sendQueuedFollowUpNow":
        this.assertOwnerForConversation(action.threadId);
        return await this.sendQueuedFollowUpNowAsOwner(action.threadId, action.followUpId);
      case "respondApproval":
        this.assertOwnerForRequest(action.requestId);
        return await this.respondApprovalAsOwner(action.requestId, action.decision);
      case "respondUserInput":
        this.assertOwnerForRequest(action.requestId);
        return await this.respondUserInputAsOwner(action.requestId, action.answers);
      case "respondMcpElicitation":
        this.assertOwnerForRequest(action.requestId);
        return await this.respondMcpElicitationAsOwner(action.requestId, action.response);
      case "respondPermissionRequest":
        this.assertOwnerForRequest(action.requestId);
        return await this.respondPermissionRequestAsOwner(action.requestId, action.response);
      case "removePlanImplementationRequest":
        this.assertOwnerForConversation(action.threadId);
        return await this.removePlanImplementationRequestAsOwner(action.threadId, action.turnId);
    }
  }

  async startTurn(threadId: string, prompt: string, opts?: CodexTurnStartOptions): Promise<unknown> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner(threadId, {
        type: "startTurn",
        threadId,
        prompt,
        opts,
      }, {
        fallback: () => this.startTurnAsOwner(threadId, prompt, opts),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return result;
    }

    return await this.startTurnAsOwner(threadId, prompt, opts);
  }

  private async startTurnAsOwner(threadId: string, prompt: string, opts?: CodexTurnStartOptions): Promise<unknown> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      return invoke("codex:turn:start", threadId, prompt, opts);
    }

    return await this.startTurnAsOwnerLocalTransaction(threadId, prompt, opts);
  }

  private async startTurnAsOwnerLocalTransaction(
    threadId: string,
    prompt: string,
    opts?: CodexTurnStartOptions,
  ): Promise<unknown> {
    const promptInput = opts?.promptInput;
    const clientUserMessageId = createOwnerClientUserMessageId();
    const optimisticTurn = buildOwnerOptimisticTurn({
      threadId,
      prompt,
      promptInput,
      clientUserMessageId,
      observedAtMs: Date.now(),
    });

    const optimisticRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "turn start optimistic",
      (conversation) => appendOwnerOptimisticTurn(conversation, optimisticTurn),
    );

    try {
      const startResult = await this.ownerAppServerRequestClient.startTurn(threadId, {
        threadId,
        prompt,
        opts,
        clientUserMessageId,
        ...(promptInput ? { promptInput } : {}),
      });
      const startedTurn = parseOwnerTurnStartResult(threadId, startResult);
      const streamRevision = await this.publishOwnerActionSnapshotMutation(
        threadId,
        "turn start rebind",
        (conversation) => rebindOwnerOptimisticTurn(conversation, clientUserMessageId, startedTurn),
      );

      return this.withOwnerStreamRevision(startedTurn, streamRevision || optimisticRevision);
    } catch (error) {
      await this.publishOwnerActionSnapshotMutation(
        threadId,
        "turn start failure",
        (conversation) => applyOwnerStartFailureToConversation(conversation, clientUserMessageId, error),
      );
      throw error;
    }
  }

  async setThreadSettingsForConversation(
    threadId: string,
    patch: CodexConversationThreadSettingsPatch,
  ): Promise<CodexConversationThreadSettings> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<CodexConversationThreadSettings>(threadId, {
        type: "updateThreadSettings",
        threadId,
        patch,
      }, {
        fallback: () => this.setThreadSettingsForConversationAsOwner(threadId, patch),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return result;
    }

    return await this.setThreadSettingsForConversationAsOwner(threadId, patch);
  }

  private async setThreadSettingsForConversationAsOwner(
    threadId: string,
    patch: CodexConversationThreadSettingsPatch,
  ): Promise<CodexConversationThreadSettings> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      const persistedSettings = (await invoke(
        "codex:thread:settings:update",
        threadId,
        patch,
      )) as CodexConversationThreadSettings;
      const refreshedConversation = this.conversationsById.get(threadId);
      if (refreshedConversation) {
        const persistedConversation: CodexConversationSnapshot = {
          ...refreshedConversation,
          latestCollaborationMode: persistedSettings.collaborationMode ?? refreshedConversation.latestCollaborationMode,
          latestThreadSettings: persistedSettings,
        };
        this.applyConversationSnapshot(threadId, persistedConversation);
      }
      return persistedSettings;
    }

    const persistedSettings = await this.ownerAppServerRequestClient.updateThreadSettings(threadId, {
      threadId,
      patch,
    });
    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "thread settings update",
      (conversation) => ({
        ...conversation,
        latestCollaborationMode: persistedSettings.collaborationMode ?? conversation.latestCollaborationMode,
        latestThreadSettings: persistedSettings,
      }),
    );
    return this.withOwnerStreamRevision(persistedSettings, streamRevision);
  }

  async setLatestCollaborationModeForConversation(
    threadId: string,
    mode: CodexCollaborationModeKind,
  ): Promise<CodexCollaborationModeState> {
    const persistedSettings = await this.setThreadSettingsForConversation(threadId, { collaborationMode: mode });
    return persistedSettings.collaborationMode ?? DEFAULT_COLLABORATION_MODE_STATE;
  }

  async enqueueQueuedFollowUp(threadId: string, prompt: string, opts?: CodexTurnStartOptions): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "enqueueQueuedFollowUp",
        threadId,
        prompt,
        opts,
      }, {
        fallback: () => this.enqueueQueuedFollowUpAsOwner(threadId, prompt, opts),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return;
    }

    await this.enqueueQueuedFollowUpAsOwner(threadId, prompt, opts);
  }

  private async enqueueQueuedFollowUpAsOwner(
    threadId: string,
    prompt: string,
    opts?: CodexTurnStartOptions,
  ): Promise<OwnerStreamRevisionResult | void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:follow-up:enqueue", threadId, prompt, opts);
      return;
    }

    const promptText = prompt.trim();
    if (!promptText) {
      throw new Error("Queued follow-up requires a non-empty prompt");
    }

    const followUp = createOwnerQueuedFollowUp(threadId, promptText, opts);
    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "queued follow-up enqueue",
      (conversation) => ({
        ...conversation,
        queuedFollowUps: [...conversation.queuedFollowUps, followUp],
      }),
    );
    return this.buildOwnerStreamRevisionResult(streamRevision);
  }

  private async restoreOwnerQueuedFollowUp(
    threadId: string,
    followUp: CodexQueuedFollowUp,
    reason?: string | null,
  ): Promise<void> {
    await this.publishOwnerActionSnapshotMutation(
      threadId,
      "queued follow-up restore",
      (conversation) => {
        const existing = conversation.queuedFollowUps.filter((entry) => entry.followUpId !== followUp.followUpId);
        return {
          ...conversation,
          queuedFollowUps: [
            {
              ...followUp,
              pausedReason: reason ?? null,
            },
            ...existing,
          ],
        };
      },
    );
  }

  private async submitOwnerQueuedFollowUp(
    threadId: string,
    followUp: CodexQueuedFollowUp,
  ): Promise<unknown> {
    const conversation = this.conversationsById.get(threadId);
    const activeTurnId = conversation ? getLatestInProgressTurnId(conversation) : null;
    if (activeTurnId) {
      return await this.steerTurnAsOwner({
        threadId,
        expectedTurnId: activeTurnId,
        prompt: followUp.prompt,
        ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
        collaborationMode: followUp.collaborationMode,
        serviceTier: followUp.serviceTier,
      });
      return;
    }

    return await this.startTurnAsOwner(threadId, followUp.prompt, {
      collaborationMode: followUp.collaborationMode ?? undefined,
      serviceTier: followUp.serviceTier,
      ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
    });
  }

  private maybeDispatchOwnerQueuedFollowUp(threadId: string): void {
    if (this.ownerQueuedFollowUpDispatchInFlight.has(threadId)) return;
    if (this.streamState.getRole(threadId)?.role !== "owner") return;

    const conversation = this.conversationsById.get(threadId);
    if (!conversation) return;
    if (getLatestInProgressTurnId(conversation)) return;

    const nextFollowUp = conversation.queuedFollowUps
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt)[0] ?? null;
    if (!nextFollowUp || nextFollowUp.pausedReason) return;

    this.ownerQueuedFollowUpDispatchInFlight.add(threadId);
    void this.dispatchOwnerQueuedFollowUp(threadId, nextFollowUp)
      .catch(() => {})
      .finally(() => {
        this.ownerQueuedFollowUpDispatchInFlight.delete(threadId);
      });
  }

  private async dispatchOwnerQueuedFollowUp(
    threadId: string,
    followUp: CodexQueuedFollowUp,
  ): Promise<void> {
    const currentConversation = this.conversationsById.get(threadId);
    if (!currentConversation || getLatestInProgressTurnId(currentConversation)) return;

    await this.publishOwnerActionSnapshotMutation(
      threadId,
      "queued follow-up dispatch",
      (conversation) => ({
        ...conversation,
        queuedFollowUps: conversation.queuedFollowUps.filter((entry) => entry.followUpId !== followUp.followUpId),
      }),
    );

    try {
      await this.submitOwnerQueuedFollowUp(threadId, followUp);
    } catch (error) {
      await this.restoreOwnerQueuedFollowUp(
        threadId,
        followUp,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async dequeueOwnerQueuedFollowUp(
    threadId: string,
    followUpId: string,
    label: string,
  ): Promise<{ followUp: CodexQueuedFollowUp | null; streamRevision: number | null }> {
    const conversation = this.conversationsById.get(threadId);
    const followUp = conversation?.queuedFollowUps.find((entry) => entry.followUpId === followUpId) ?? null;
    if (!followUp) return { followUp: null, streamRevision: null };

    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      label,
      (currentConversation) => ({
        ...currentConversation,
        queuedFollowUps: currentConversation.queuedFollowUps.filter((entry) => entry.followUpId !== followUpId),
      }),
    );
    return { followUp, streamRevision };
  }

  async removeQueuedFollowUp(threadId: string, followUpId: string): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "removeQueuedFollowUp",
        threadId,
        followUpId,
      }, {
        fallback: () => this.removeQueuedFollowUpAsOwner(threadId, followUpId),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return;
    }

    await this.removeQueuedFollowUpAsOwner(threadId, followUpId);
  }

  private async removeQueuedFollowUpAsOwner(threadId: string, followUpId: string): Promise<OwnerStreamRevisionResult | void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:follow-up:remove", threadId, followUpId);
      return;
    }

    const result = await this.dequeueOwnerQueuedFollowUp(threadId, followUpId, "queued follow-up remove");
    return typeof result.streamRevision === "number"
      ? this.buildOwnerStreamRevisionResult(result.streamRevision)
      : undefined;
  }

  async reorderQueuedFollowUps(threadId: string, orderedFollowUpIds: string[]): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "reorderQueuedFollowUps",
        threadId,
        orderedFollowUpIds,
      }, {
        fallback: () => this.reorderQueuedFollowUpsAsOwner(threadId, orderedFollowUpIds),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return;
    }

    await this.reorderQueuedFollowUpsAsOwner(threadId, orderedFollowUpIds);
  }

  private async reorderQueuedFollowUpsAsOwner(
    threadId: string,
    orderedFollowUpIds: string[],
  ): Promise<OwnerStreamRevisionResult | void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:follow-up:reorder", threadId, orderedFollowUpIds);
      return;
    }

    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "queued follow-up reorder",
      (conversation) => {
        if (conversation.queuedFollowUps.length <= 1) return null;

        const byId = new Map(conversation.queuedFollowUps.map((followUp) => [followUp.followUpId, followUp]));
        const ordered = orderedFollowUpIds
          .map((followUpId) => byId.get(followUpId) ?? null)
          .filter((followUp): followUp is CodexQueuedFollowUp => followUp !== null);
        const seen = new Set(ordered.map((followUp) => followUp.followUpId));
        return {
          ...conversation,
          queuedFollowUps: [
            ...ordered,
            ...conversation.queuedFollowUps.filter((followUp) => !seen.has(followUp.followUpId)),
          ],
        };
      },
    );
    return this.buildOwnerStreamRevisionResult(streamRevision);
  }

  async sendQueuedFollowUpNow(threadId: string, followUpId: string): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "sendQueuedFollowUpNow",
        threadId,
        followUpId,
      }, {
        fallback: () => this.sendQueuedFollowUpNowAsOwner(threadId, followUpId),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return;
    }

    await this.sendQueuedFollowUpNowAsOwner(threadId, followUpId);
  }

  private async sendQueuedFollowUpNowAsOwner(threadId: string, followUpId: string): Promise<OwnerStreamRevisionResult | void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:follow-up:send-now", threadId, followUpId);
      return;
    }

    const { followUp, streamRevision } = await this.dequeueOwnerQueuedFollowUp(
      threadId,
      followUpId,
      "queued follow-up send-now",
    );
    if (!followUp) return;

    try {
      const submitResult = await this.submitOwnerQueuedFollowUp(threadId, followUp);
      return this.buildOwnerStreamRevisionResult(
        this.readOwnerStreamRevision(submitResult) ?? streamRevision ?? (this.streamState.getRevision(threadId) ?? 0),
      );
    } catch (error) {
      await this.restoreOwnerQueuedFollowUp(
        threadId,
        followUp,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async editLastUserTurn(
    threadId: string,
    turnId: string,
    message: string,
    opts?: { serviceTier?: CodexServiceTier },
  ): Promise<CodexThreadActionResult> {
    if (this.isFollowerForConversation(threadId)) {
      await this.waitForCompleteHistoryFromOwner(threadId);
      const result = await this.runFollowerActionThroughOwner<CodexThreadActionResult>(threadId, {
        type: "editLastUserTurn",
        threadId,
        turnId,
        message,
        opts,
      }, {
        fallback: () => this.editLastUserTurnAsOwner(threadId, turnId, message, opts),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return result;
    }

    return await this.editLastUserTurnAsOwner(threadId, turnId, message, opts);
  }

  private async editLastUserTurnAsOwner(
    threadId: string,
    turnId: string,
    message: string,
    opts?: { serviceTier?: CodexServiceTier },
  ): Promise<CodexThreadActionResult> {
    const role = this.streamState.getRole(threadId);
    if (role?.role !== "owner") {
      await this.ensureOwnerForConversationAction(threadId, "edit last user turn");
    }

    const conversation = this.conversationsById.get(threadId);
    if (!conversation) {
      throw new Error(`Thread '${threadId}' was not found`);
    }

    if (resolveLatestEditableUserTurnId(conversation) !== turnId) {
      throw new Error("Only the latest completed user turn can be edited");
    }

    await this.waitForOwnerStreamPublishIdle(threadId);

    const targetTurn = conversation.turns.find((turn) => turn.turnId === turnId);
    if (!targetTurn) {
      throw new Error("Only the latest completed user turn can be edited");
    }
    const replacementPromptInput = buildOwnerEditReplacementPromptInput(targetTurn, message);
    const rollbackResult = await this.ownerAppServerRequestClient.rollbackThreadForEdit(threadId, {
      threadId,
      turnId,
      numTurns: 1,
    });
    const rollbackConversation = materializeOwnerRollbackConversation(conversation, rollbackResult);
    this.rememberOwnerRollbackTombstones(threadId, conversation, rollbackConversation);
    const streamRevision = await this.publishOwnerSnapshotTransaction(
      threadId,
      rollbackConversation,
      "edit rollback",
    );

    const startResult = await this.startTurnAsOwnerLocalTransaction(threadId, message, {
      ...opts,
      promptInput: replacementPromptInput,
    });
    const startRevision = asRecord(startResult)?.streamRevision;

    return {
      threadId,
      streamRevision: typeof startRevision === "number" ? startRevision : streamRevision,
    };
  }

  async forkConversationFromTurn(
    threadId: string,
    turnId: string,
    message: string,
  ): Promise<CodexThreadActionResult> {
    if (this.isFollowerForConversation(threadId)) {
      await this.waitForCompleteHistoryFromOwner(threadId);
      return await this.runFollowerActionThroughOwner(threadId, {
        type: "forkConversationFromTurn",
        threadId,
        turnId,
        message,
      }, {
        fallback: () => this.forkConversationFromTurnAsOwner(threadId, turnId, message),
      });
    }

    return await this.forkConversationFromTurnAsOwner(threadId, turnId, message);
  }

  private async forkConversationFromTurnAsOwner(
    threadId: string,
    turnId: string,
    message: string,
  ): Promise<CodexThreadActionResult> {
    const role = this.streamState.getRole(threadId);
    if (role?.role !== "owner") {
      await this.ensureOwnerForConversationAction(threadId, "fork conversation from turn");
    }

    return await this.ownerAppServerRequestClient.forkConversationFromTurn(threadId, {
      threadId,
      turnId,
      message,
    });
  }

  async compactThread(threadId: string): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      await this.runFollowerActionThroughOwner(threadId, {
        type: "compactThread",
        threadId,
      }, {
        fallback: () => this.compactThreadAsOwner(threadId),
      });
      return;
    }

    await this.compactThreadAsOwner(threadId);
  }

  private async compactThreadAsOwner(threadId: string): Promise<void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:compact:start", threadId);
      return;
    }
    await this.ownerAppServerRequestClient.compactThread(threadId, { threadId });
  }

  async getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
    return (await invoke("codex:thread:goal:get", threadId)) as ThreadGoal | null;
  }

  async setThreadGoal(input: {
    threadId: string;
    objective: string;
    tokenBudget?: number | null;
  }): Promise<ThreadGoal | null> {
    if (this.isFollowerForConversation(input.threadId)) {
      const result = await this.runFollowerActionThroughOwner<ThreadGoal | null>(input.threadId, {
        type: "setThreadGoal",
        threadId: input.threadId,
        objective: input.objective,
        tokenBudget: input.tokenBudget,
      }, {
        fallback: () => this.setThreadGoalAsOwner(input),
      });
      await this.waitForFollowerActionStreamRevision(input.threadId, result);
      return result;
    }

    return await this.setThreadGoalAsOwner(input);
  }

  private async setThreadGoalAsOwner(input: {
    threadId: string;
    objective: string;
    tokenBudget?: number | null;
  }): Promise<ThreadGoal | null> {
    if (this.streamState.getRole(input.threadId)?.role !== "owner") {
      return (await invoke(
        "codex:thread:goal:set",
        input.threadId,
        input.objective,
        input.tokenBudget,
      )) as ThreadGoal | null;
    }
    const goal = await this.ownerAppServerRequestClient.setThreadGoal(input.threadId, {
      threadId: input.threadId,
      objective: input.objective,
      tokenBudget: input.tokenBudget ?? null,
    });
    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      input.threadId,
      "thread goal set",
      (conversation) => ({
        ...conversation,
        threadGoal: goal,
        completedThreadGoal: goal?.status === "complete" ? goal : null,
        threadGoalResumeConfirmation: goal && shouldShowOwnerThreadGoalResumeConfirmation(goal.status)
          ? conversation.threadGoalResumeConfirmation ?? null
          : null,
      }),
    );
    return goal ? this.withOwnerStreamRevision(goal, streamRevision) : goal;
  }

  async clearThreadGoal(threadId: string): Promise<void> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "clearThreadGoal",
        threadId,
      }, {
        fallback: () => this.clearThreadGoalAsOwner(threadId),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return;
    }

    await this.clearThreadGoalAsOwner(threadId);
  }

  private async clearThreadGoalAsOwner(threadId: string): Promise<OwnerStreamRevisionResult | void> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      await invoke("codex:thread:goal:clear", threadId);
      return;
    }
    await this.ownerAppServerRequestClient.clearThreadGoal(threadId, { threadId });
    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "thread goal clear",
      (conversation) => ({
        ...conversation,
        threadGoal: null,
        threadGoalResumeConfirmation: null,
      }),
    );
    return this.buildOwnerStreamRevisionResult(streamRevision);
  }

  async setThreadMemoryMode(input: { threadId: string; mode: ThreadMemoryMode }): Promise<void> {
    if (this.isFollowerForConversation(input.threadId)) {
      await this.runFollowerActionThroughOwner(input.threadId, {
        type: "setThreadMemoryMode",
        threadId: input.threadId,
        mode: input.mode,
      }, {
        fallback: () => this.setThreadMemoryModeAsOwner(input),
      });
      return;
    }

    await this.setThreadMemoryModeAsOwner(input);
  }

  private async setThreadMemoryModeAsOwner(input: { threadId: string; mode: ThreadMemoryMode }): Promise<void> {
    if (this.streamState.getRole(input.threadId)?.role !== "owner") {
      await invoke("codex:thread:memory-mode:set", input.threadId, input.mode);
      return;
    }
    await this.ownerAppServerRequestClient.setThreadMemoryMode(input.threadId, {
      threadId: input.threadId,
      mode: input.mode,
    });
  }

  async uploadFeedback(params: FeedbackUploadParams): Promise<void> {
    await invoke("codex:feedback:upload", params);
  }

  async cleanBackgroundTerminals(threadId: string): Promise<boolean> {
    if (this.isFollowerForConversation(threadId)) {
      throw new Error("Please continue this conversation on the window where it was started.");
    }

    if (this.streamState.getRole(threadId)?.role === "owner") {
      const cleaned = (await invoke("codex:thread:background-terminals:clean-silent", threadId)) as boolean;
      if (cleaned) {
        this.applyOwnerSilentConversationMutation(
          threadId,
          applyOwnerBackgroundTerminalCleanupToConversation,
        );
      }
      return cleaned;
    }

    return (await invoke("codex:thread:background-terminals:clean", threadId)) as boolean;
  }

  async steerTurn(input: CodexSteerTurnInput): Promise<{ turnId: string } | null> {
    const promptText = input.prompt.trim();
    if (!promptText) {
      throw new Error("Turn steer requires a non-empty prompt");
    }
    const normalizedInput = {
      ...input,
      prompt: promptText,
    };

    if (this.isFollowerForConversation(input.threadId)) {
      const result = await this.runFollowerActionThroughOwner<{ turnId: string } | null>(input.threadId, {
        type: "steerTurn",
        input: normalizedInput,
      }, {
        fallback: () => this.steerTurnAsOwner(normalizedInput),
      });
      await this.waitForFollowerActionStreamRevision(input.threadId, result);
      return result;
    }

    return await this.steerTurnAsOwner(normalizedInput);
  }

  private async steerTurnAsOwner(input: CodexSteerTurnInput): Promise<{ turnId: string } | null> {
    if (this.streamState.getRole(input.threadId)?.role !== "owner") {
      return (await invoke("codex:turn:steer", {
        ...input,
      })) as { turnId: string } | null;
    }

    const conversation = this.conversationsById.get(input.threadId);
    if (!conversation) {
      throw new Error(`Thread '${input.threadId}' was not found`);
    }

    const expectedTurnId = input.expectedTurnId ?? getLatestInProgressTurnId(conversation);
    if (!expectedTurnId) {
      throw new Error("Codex is already running. Wait for the active turn to load or queue the follow-up instead.");
    }

    const pendingSteer = createOwnerPendingSteer(input.threadId, expectedTurnId, input.prompt);
    await this.publishOwnerActionSnapshotMutation(
      input.threadId,
      "pending steer add",
      (currentConversation) => ({
        ...currentConversation,
        pendingSteers: [
          ...currentConversation.pendingSteers,
          pendingSteer,
        ],
      }),
    );

    let result: { turnId: string } | null = null;
    let streamRevision = this.streamState.getRevision(input.threadId) ?? 0;
    try {
      result = await this.ownerAppServerRequestClient.steerTurn(input.threadId, {
        ...input,
        expectedTurnId,
        threadId: input.threadId,
      });
    } finally {
      streamRevision = await this.publishOwnerActionSnapshotMutation(
        input.threadId,
        "pending steer clear",
        (currentConversation) => ({
          ...currentConversation,
          pendingSteers: currentConversation.pendingSteers.filter((entry) => entry.steerId !== pendingSteer.steerId),
        }),
      );
    }
    return result ? this.withOwnerStreamRevision(result, streamRevision) : result;
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<boolean> {
    if (this.isFollowerForConversation(threadId)) {
      return await this.runFollowerActionThroughOwner(threadId, {
        type: "interruptTurn",
        threadId,
      }, {
        fallback: () => this.interruptTurnAsOwner(threadId),
        fallbackOnTimeout: true,
      });
    }

    return await this.interruptTurnAsOwner(threadId, turnId);
  }

  private async interruptTurnAsOwner(threadId: string, turnId?: string): Promise<boolean> {
    const interruptedTurnId = this.resolveInterruptTurnId(threadId, turnId);
    if (interruptedTurnId) {
      this.markTurnInterrupted(threadId, interruptedTurnId);
    }

    try {
      const interrupted = this.streamState.getRole(threadId)?.role === "owner"
        ? await this.ownerAppServerRequestClient.interruptTurn(threadId, { threadId, turnId: interruptedTurnId ?? turnId })
        : (await invoke("codex:turn:interrupt", threadId, turnId)) as boolean;
      if (!interrupted && interruptedTurnId) {
        this.unmarkTurnInterrupted(threadId, interruptedTurnId);
      }
      return interrupted;
    } catch (error) {
      if (interruptedTurnId) {
        this.unmarkTurnInterrupted(threadId, interruptedTurnId);
      }
      throw error;
    }
  }

  async respondApproval(
    requestId: string,
    decision: CodexApprovalDecision,
    conversationId?: string | null,
  ): Promise<boolean> {
    const followerConversationId = this.findOwnerRoutedConversationIdForRequestResponse(requestId, conversationId);
    if (followerConversationId) {
      return await this.runFollowerRequestResponseThroughOwner(followerConversationId, {
        type: "respondApproval",
        requestId,
        decision,
      });
    }

    return await this.respondApprovalAsOwner(requestId, decision);
  }

  private async respondApprovalAsOwner(requestId: string, decision: CodexApprovalDecision): Promise<boolean> {
    const conversationId = this.findConversationIdForRequest(requestId);
    const accepted = (await invoke("codex:approval:respond", requestId, decision)) as boolean;
    if (accepted && conversationId) {
      this.publishOwnerActionConversationMutation(conversationId, (conversation) =>
        applyOwnerApprovalResponseToConversation(conversation, requestId)
      );
    }
    return accepted;
  }

  async respondUserInput(
    requestId: string,
    answers: Record<string, string[]>,
    conversationId?: string | null,
  ): Promise<boolean> {
    const followerConversationId = this.findOwnerRoutedConversationIdForRequestResponse(requestId, conversationId);
    if (followerConversationId) {
      return await this.runFollowerRequestResponseThroughOwner(followerConversationId, {
        type: "respondUserInput",
        requestId,
        answers,
      });
    }

    return await this.respondUserInputAsOwner(requestId, answers);
  }

  private async respondUserInputAsOwner(requestId: string, answers: Record<string, string[]>): Promise<boolean> {
    const conversationId = this.findConversationIdForRequest(requestId);
    const accepted = (await invoke("codex:user-input:respond", requestId, answers)) as boolean;
    if (accepted && conversationId) {
      this.publishOwnerActionConversationMutation(conversationId, (conversation) =>
        applyOwnerUserInputResponseToConversation(conversation, requestId, answers)
      );
    }
    return accepted;
  }

  async respondMcpElicitation(
    requestId: string,
    response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse,
    conversationId?: string | null,
  ): Promise<boolean> {
    const normalizedResponse = normalizeCodexMcpServerElicitationResponse(response);
    const followerConversationId = this.findOwnerRoutedConversationIdForRequestResponse(requestId, conversationId);
    if (followerConversationId) {
      return await this.runFollowerRequestResponseThroughOwner(followerConversationId, {
        type: "respondMcpElicitation",
        requestId,
        response: normalizedResponse,
      });
    }

    return await this.respondMcpElicitationAsOwner(requestId, normalizedResponse);
  }

  private async respondMcpElicitationAsOwner(
    requestId: string,
    response: CodexMcpServerElicitationResponse,
  ): Promise<boolean> {
    const conversationId = this.findConversationIdForRequest(requestId);
    const accepted = (await invoke("codex:mcp-elicitation:respond", requestId, response)) as boolean;
    if (accepted && conversationId) {
      this.publishOwnerActionConversationMutation(conversationId, (conversation) =>
        applyOwnerMcpElicitationResponseToConversation(conversation, requestId, response.action)
      );
    }
    return accepted;
  }

  async respondPermissionRequest(
    requestId: string,
    response: CodexPermissionRequestResponse,
    conversationId?: string | null,
  ): Promise<boolean> {
    const followerConversationId = this.findOwnerRoutedConversationIdForRequestResponse(requestId, conversationId);
    if (followerConversationId) {
      return await this.runFollowerRequestResponseThroughOwner(followerConversationId, {
        type: "respondPermissionRequest",
        requestId,
        response,
      });
    }

    return await this.respondPermissionRequestAsOwner(requestId, response);
  }

  private async respondPermissionRequestAsOwner(
    requestId: string,
    response: CodexPermissionRequestResponse,
  ): Promise<boolean> {
    const conversationId = this.findConversationIdForRequest(requestId);
    const accepted = (await invoke("codex:permission-request:respond", requestId, response)) as boolean;
    if (accepted && conversationId) {
      this.publishOwnerActionConversationMutation(conversationId, (conversation) =>
        applyOwnerPermissionRequestResponseToConversation(conversation, requestId, response)
      );
    }
    return accepted;
  }

  async setPermissionMode(projectId: string, mode: CodexPermissionMode): Promise<void> {
    const current = this.permissionStateByProject.get(projectId);
    if (current?.mode === mode) {
      return;
    }

    const nextState = (await invoke("codex:permission:mode:set", projectId, mode)) as CodexPermissionState;
    this.applyPermissionState(projectId, nextState);
  }

  setComposerIntent(threadId: string, composerIntent: CodexComposerIntent): void {
    const currentIntent = this.composerIntentsByThread.get(threadId);
    if (
      currentIntent
      && currentIntent.prompt === composerIntent.prompt
      && currentIntent.focusNonce === composerIntent.focusNonce
    ) {
      return;
    }

    this.composerIntentsByThread.set(threadId, composerIntent);
    this.notifyConversationCallbacks(threadId);
  }

  consumeComposerIntent(threadId: string, focusNonce: number): void {
    const currentIntent = this.composerIntentsByThread.get(threadId);
    if (!currentIntent || currentIntent.focusNonce !== focusNonce) {
      return;
    }

    this.composerIntentsByThread.delete(threadId);
    this.notifyConversationCallbacks(threadId);
  }

  async removePlanImplementationRequest(threadId: string, turnId: string): Promise<boolean> {
    if (this.isFollowerForConversation(threadId)) {
      const result = await this.runFollowerActionThroughOwner<unknown>(threadId, {
        type: "removePlanImplementationRequest",
        threadId,
        turnId,
      }, {
        fallback: () => this.removePlanImplementationRequestAsOwner(threadId, turnId),
      });
      await this.waitForFollowerActionStreamRevision(threadId, result);
      return this.readOwnerBooleanActionResult(result);
    }

    return this.readOwnerBooleanActionResult(
      await this.removePlanImplementationRequestAsOwner(threadId, turnId),
    );
  }

  private async removePlanImplementationRequestAsOwner(
    threadId: string,
    turnId: string,
  ): Promise<OwnerBooleanActionResult> {
    if (this.streamState.getRole(threadId)?.role !== "owner") {
      return {
        accepted: (await invoke("codex:thread:plan-implementation:remove", threadId, turnId)) as boolean,
      };
    }

    const streamRevision = await this.publishOwnerActionSnapshotMutation(
      threadId,
      "plan implementation remove",
      (conversation) => {
        const nextTurns = conversation.turns.map((turn) => {
          if (turn.turnId !== turnId) {
            return turn;
          }

          return {
            ...turn,
            items: turn.items.map((item) =>
              item.itemId !== `implement-plan:${turnId}`
                ? item
                : {
                    ...item,
                    status: "completed" as const,
                    rawItem: typeof item.rawItem === "object" && item.rawItem !== null
                      ? {
                          ...item.rawItem,
                          isCompleted: true,
                        }
                      : item.rawItem,
                  }),
          };
        });
        return {
          ...conversation,
          turns: nextTurns,
          requests: conversation.requests.filter((request) =>
            request.type !== "implementPlan" || request.turnId !== turnId
          ),
        };
      },
    );

    return {
      accepted: (await invoke("codex:thread:plan-implementation:remove", threadId, turnId)) as boolean,
      streamRevision,
    };
  }

  resetForTests(): void {
    this.connection = INITIAL_CONNECTION;
    this.account = null;
    this.dictationState = DEFAULT_CODEX_DICTATION_STATE;
    this.availableModels = EMPTY_MODELS;
    this.threadSummariesByProject.clear();
    this.threadSummariesById.clear();
    this.loadedThreadSummariesByProject.clear();
    this.threadSummaryLoadsInFlightByProject.clear();
    this.conversationsById.clear();
    this.conversationVersionById.clear();
    this.streamState.reset();
    this.composerIntentsByThread.clear();
    this.permissionStateByProject.clear();
    this.permissionStateLoadsInFlightByProject.clear();
    this.threadStartProgressByTarget.clear();
    this.threadTitlesById.clear();
    this.interruptedTurnIdsByThread.clear();
    this.projectSummaryCallbacksByProject.clear();
    this.recentConversationIds.length = 0;
    this.lastHostError = null;
    this.lastAnySnapshotById.clear();
    this.lastMetaSnapshotById.clear();
    this.lastAnyOrderKey = null;
    this.lastMetaOrderKey = null;
    this.ownerTextDeltaQueue.cancel();
    this.outputDeltaQueue.cancel();
    this.cancelOwnerStreamPublishQueues();
    this.terminalInputBuffers.clear();
    this.ownerQueuedFollowUpDispatchInFlight.clear();
    this.bootstrapStarted = false;
    this.resyncInFlight.clear();
    this.stop();
  }

  private async bootstrapAccountAndConnection(): Promise<void> {
    try {
      const account = (await invoke("codex:account:read")) as CodexAccountSnapshot;
      this.handleSharedObjectUpdated({
        hostId: this.hostId,
        object: {
          objectType: "account",
          objectId: "account",
          value: account,
        },
      });
    } catch {
      // host messages stay authoritative if bootstrap fails
    }

    try {
      const connection = (await invoke("codex:connection:status")) as CodexConnectionState;
      this.handleSharedObjectUpdated({
        hostId: this.hostId,
        object: {
          objectType: "connection",
          objectId: "connection",
          value: connection,
        },
      });
    } catch {
      // host messages stay authoritative if bootstrap fails
    }
  }

  private async bootstrapDictationState(): Promise<void> {
    try {
      await this.loadDictationState();
    } catch {
      this.setDictationState(DEFAULT_CODEX_DICTATION_STATE);
    }
  }

  private async bootstrapAvailableModels(): Promise<void> {
    try {
      await this.loadAvailableModels();
    } catch {
      this.setAvailableModels([]);
    }
  }

  private async bootstrapPermissionModes(): Promise<void> {
    // Permission state is loaded lazily per project from the main process.
  }

  async loadPermissionState(projectId: string): Promise<CodexPermissionState> {
    const inFlight = this.permissionStateLoadsInFlightByProject.get(projectId);
    if (inFlight) {
      return await inFlight;
    }

    const loadPromise = (async () => {
      const nextState = (await invoke("codex:permission:state:get", projectId)) as CodexPermissionState;
      this.applyPermissionState(projectId, nextState);
      return nextState;
    })();
    this.permissionStateLoadsInFlightByProject.set(projectId, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.permissionStateLoadsInFlightByProject.delete(projectId);
    }
  }

  private applyPermissionState(projectId: string, nextState: CodexPermissionState): void {
    const current = this.permissionStateByProject.get(projectId);
    if (current && arePermissionStatesEqual(current, nextState)) {
      return;
    }

    this.permissionStateByProject.set(projectId, nextState);
    this.notifyControlCallbacks();
  }

  private setAvailableModels(models: CodexModelOption[]): void {
    if (areModelsEqual(this.availableModels, models)) {
      return;
    }

    this.availableModels = models;
    this.notifyControlCallbacks();
  }

  private setDictationState(nextState: CodexDictationStateSnapshot): void {
    if (
      this.dictationState.isEnabled === nextState.isEnabled
      && this.dictationState.authMethod === nextState.authMethod
      && this.dictationState.isRealtimeVoiceActive === nextState.isRealtimeVoiceActive
      && this.dictationState.shortcutLabel === nextState.shortcutLabel
    ) {
      return;
    }

    this.dictationState = nextState;
    this.notifyControlCallbacks();
  }

  private handleSharedObjectUpdated(event: CodexSharedObjectUpdatedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    const sharedObject = event.object;
    if (sharedObject.objectType === "connection") {
      if (this.connection !== sharedObject.value) {
        this.connection = sharedObject.value;
        this.notifyListeners(this.connectionCallbacks);
      }
      return;
    }

    if (sharedObject.objectType === "account") {
      if (this.account === sharedObject.value) {
        return;
      }

      this.account = sharedObject.value;
      this.notifyListeners(this.accountCallbacks);
      void this.loadDictationState().catch(() => {});
      return;
    }

    if (sharedObject.objectType === "rateLimits") {
      if (!this.account) {
        return;
      }

      this.account = {
        ...this.account,
        rateLimits: sharedObject.value,
      };
      this.notifyListeners(this.accountCallbacks);
      return;
    }

    if (sharedObject.objectType === "threadSummary") {
      this.applyThreadSummary(sharedObject.value);
      return;
    }

    if (sharedObject.objectType === "threadStartProgress") {
      this.applyThreadStartProgress(sharedObject.value);
    }
  }

  private handleClientStatusChanged(event: CodexClientStatusChangedEvent): void {
    if (event.hostId !== this.hostId || event.status !== "connected") {
      return;
    }

    void this.loadDictationState().catch(() => {});
    for (const threadId of this.streamState.getStreamingConversationIds()) {
      if (this.streamState.getRole(threadId)?.role === "owner") {
        continue;
      }
      void this.requestThreadStreamSnapshot(threadId).catch(() => {});
    }
  }

  private handleThreadTitleUpdated(event: CodexThreadTitleUpdatedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    this.applyThreadTitleUpdate(event.conversationId, event.title);
  }

  private handleThreadDeleted(event: CodexThreadDeletedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    this.removeThreadLocalState(event.threadId);
  }

  private handleHostError(event: CodexErrorEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    this.lastHostError = {
      message: event.message,
      detail: event.detail,
      updatedAt: Date.now(),
    };
    console.error("[codex-host-error]", event.message, event.detail ?? "");
    this.notifyControlCallbacks();
  }

  private handleThreadOwnerNotification(event: CodexThreadOwnerNotificationEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }
    if (typeof event.sequence !== "number") return;

    if (
      event.method === "thread/started" ||
      event.method === "thread/name/updated" ||
      event.method === "thread/settings/updated" ||
      event.method === "thread/status/changed" ||
      event.method === "thread/tokenUsage/updated" ||
      event.method === "thread/goal/updated" ||
      event.method === "thread/goal/cleared"
    ) {
      this.handleOwnerThreadNotification(event);
      return;
    }

    if (
      event.method === "turn/diff/updated" ||
      event.method === "turn/plan/updated" ||
      event.method === "model/safetyBuffering/updated" ||
      event.method === "hook/started" ||
      event.method === "hook/completed" ||
      event.method === "item/autoApprovalReview/started" ||
      event.method === "item/autoApprovalReview/completed" ||
      event.method === "guardianWarning" ||
      event.method === "model/rerouted"
    ) {
      this.handleOwnerTurnMutationNotification(event);
      return;
    }

    if (
      event.method === "turn/started" ||
      event.method === "turn/completed" ||
      event.method === "turn/interrupted" ||
      event.method === "turn/failed"
    ) {
      this.handleOwnerTurnLifecycleNotification(event);
      return;
    }

    if (event.method === "item/started" || event.method === "item/completed") {
      this.handleOwnerItemLifecycleNotification(event);
      return;
    }

    if (event.method === "item/fileChange/patchUpdated") {
      this.handleOwnerFileChangePatchUpdatedNotification(event);
      return;
    }

    if (
      event.method === "item/reasoning/summaryPartAdded" ||
      event.method === "item/fileChange/outputDelta" ||
      event.method === "item/mcpToolCall/progress"
    ) {
      this.handleOwnerNoopItemNotification(event);
      return;
    }

    if (event.method === "serverRequest/resolved") {
      this.handleOwnerServerRequestResolvedNotification(event);
      return;
    }

    if (event.method === "error") {
      this.handleOwnerErrorNotification(event);
      return;
    }

    if (event.method === "item/commandExecution/terminalInteraction") {
      this.handleOwnerTerminalInteractionNotification(event);
      return;
    }

    const payload =
      typeof event.params === "object" && event.params !== null
        ? event.params as Record<string, unknown>
        : null;
    if (!payload) return;
    if (
      typeof payload.threadId !== "string" ||
      typeof payload.itemId !== "string" ||
      typeof payload.delta !== "string"
    ) {
      return;
    }
    const turnId = getString(payload, "turnId");
    if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [turnId, payload.itemId], event.sequence)) {
      return;
    }

    const observedAtMs = Date.now();
    if (event.method === "item/commandExecution/outputDelta") {
      this.outputDeltaQueue.enqueue({
        hostId: event.hostId,
        conversationId: payload.threadId,
        turnId,
        itemId: payload.itemId,
        delta: payload.delta,
        ownerNotificationSequence: event.sequence,
      });
      return;
    }

    if (event.method === "item/agentMessage/delta" || event.method === "item/plan/delta") {
      logAssistantStreamingDebugSampled(
        "renderer-owner-delta-received",
        `${payload.threadId}:${turnId ?? "latest"}:${payload.itemId}:${event.method}`,
        {
          method: event.method,
          sequence: event.sequence,
          threadId: payload.threadId,
          turnId,
          itemId: payload.itemId,
          deltaLength: payload.delta.length,
        },
      );
      this.ownerTextDeltaQueue.enqueue({
        conversationId: payload.threadId,
        turnId,
        itemId: payload.itemId,
        delta: payload.delta,
        sequence: event.sequence,
        observedAtMs,
        target: {
          type: event.method === "item/plan/delta" ? "plan" : "agentMessage",
        },
      });
      return;
    }

    if (event.method === "item/reasoning/summaryTextDelta") {
      if (typeof payload.summaryIndex !== "number") return;
      this.ownerTextDeltaQueue.enqueue({
        conversationId: payload.threadId,
        turnId,
        itemId: payload.itemId,
        delta: payload.delta,
        sequence: event.sequence,
        observedAtMs,
        target: {
          type: "reasoningSummary",
          summaryIndex: payload.summaryIndex,
        },
      });
      return;
    }

    if (event.method !== "item/reasoning/textDelta" || typeof payload.contentIndex !== "number") return;
    this.ownerTextDeltaQueue.enqueue({
      conversationId: payload.threadId,
      turnId,
      itemId: payload.itemId,
      delta: payload.delta,
      sequence: event.sequence,
      observedAtMs,
      target: {
        type: "reasoningContent",
        contentIndex: payload.contentIndex,
      },
    });
  }

  private handleThreadOwnerRequest(event: CodexThreadOwnerRequestEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }
    if (typeof event.sequence !== "number") return;

    const conversationId = event.request.params.threadId;
    if (!conversationId) {
      void this.ackOwnerNotification("", event.sequence);
      return;
    }

    if (event.request.method === "item/tool/call") {
      void this.handleOwnerDynamicToolCallRequest(event, conversationId);
      return;
    }

    this.publishOwnerConversationMutation(
      conversationId,
      event.sequence,
      (conversation) => applyOwnerServerRequestToConversation(conversation, event.request),
    );
  }

  private async handleOwnerDynamicToolCallRequest(
    event: CodexThreadOwnerRequestEvent,
    conversationId: string,
  ): Promise<void> {
    const role = this.streamState.getRole(conversationId);
    if (role?.role !== "owner") {
      this.handleOwnerReducerUnavailable(conversationId);
      await this.ackOwnerNotification(conversationId, event.sequence);
      return;
    }

    try {
      await invoke("codex:dynamic-tool-call:respond", event.request.id);
    } finally {
      await this.ackOwnerNotification(conversationId, event.sequence);
    }
  }

  private handleOwnerThreadNotification(event: CodexThreadOwnerNotificationEvent): void {
    if (event.method === "thread/started") {
      const payload = parseOwnerThreadStartedPayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationSnapshotMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadStartedToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "thread/goal/updated") {
      const payload = parseOwnerThreadGoalUpdatedPayload(event.params);
      if (!payload) return;
      const currentConversation = this.conversationsById.get(payload.threadId);
      const shouldClearCompletedGoal =
        payload.goal.status === "complete" &&
        currentConversation != null &&
        currentConversation.completedThreadGoal?.updatedAt !== payload.goal.updatedAt;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadGoalUpdatedToConversation(conversation, payload),
      );
      if (shouldClearCompletedGoal) {
        void this.clearThreadGoal(payload.threadId).catch(() => {});
      }
      return;
    }

    if (event.method === "thread/goal/cleared") {
      const payload = parseOwnerThreadGoalClearedPayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadGoalClearedToConversation(conversation),
      );
      return;
    }

    if (event.method === "thread/name/updated") {
      const payload = parseOwnerThreadNamePayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadNameToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "thread/settings/updated") {
      const payload = parseOwnerThreadSettingsPayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadSettingsToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "thread/tokenUsage/updated") {
      const payload = parseOwnerThreadTokenUsagePayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerThreadTokenUsageToConversation(conversation, payload),
      );
      return;
    }

    const payload = parseOwnerThreadStatusPayload(event.params);
    if (!payload) return;

    this.publishOwnerConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerThreadStatusToConversation(conversation, payload),
    );
  }

  private handleOwnerTurnMutationNotification(event: CodexThreadOwnerNotificationEvent): void {
    if (event.method === "guardianWarning") {
      const payload = parseOwnerGuardianWarningPayload(event.params);
      if (!payload) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerGuardianWarningToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "item/autoApprovalReview/started" || event.method === "item/autoApprovalReview/completed") {
      const payload = parseOwnerAutomaticApprovalReviewPayload(event.params);
      if (!payload) return;
      if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId, payload.targetItemId], event.sequence)) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerAutomaticApprovalReviewToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "hook/started" || event.method === "hook/completed") {
      const method = event.method;
      const payload = parseOwnerHookPayload(event.params);
      if (!payload) return;
      if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerHookToConversation(conversation, method, payload),
      );
      return;
    }

    if (event.method === "model/safetyBuffering/updated") {
      const payload = parseOwnerSafetyBufferingPayload(event.params);
      if (!payload) return;
      if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerSafetyBufferingToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "turn/plan/updated") {
      const payload = parseOwnerTurnPlanPayload(event.params);
      if (!payload) return;
      if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerTurnPlanToConversation(conversation, payload),
      );
      return;
    }

    if (event.method === "model/rerouted") {
      const payload = parseOwnerModelReroutedPayload(event.params);
      if (!payload) return;
      if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;
      this.publishOwnerConversationMutation(
        payload.threadId,
        event.sequence,
        (conversation) => applyOwnerModelReroutedToConversation(conversation, payload),
      );
      return;
    }

    const payload = parseOwnerTurnDiffPayload(event.params);
    if (!payload) return;
    if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;

    this.publishOwnerConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerTurnDiffToConversation(conversation, payload),
    );
  }

  private handleOwnerTurnLifecycleNotification(event: CodexThreadOwnerNotificationEvent): void {
    const method = event.method;
    if (
      method !== "turn/started" &&
      method !== "turn/completed" &&
      method !== "turn/interrupted" &&
      method !== "turn/failed"
    ) {
      return;
    }

    const payload = parseOwnerTurnLifecyclePayload(method, event.params);
    if (!payload) return;
    if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId], event.sequence)) return;

    logAssistantStreamingDebug("renderer-owner-turn-lifecycle", {
      method,
      sequence: event.sequence,
      threadId: payload.threadId,
      turnId: payload.turnId,
      status: payload.status,
    });

    if (
      method !== "turn/started" &&
      this.ownerTextDeltaQueue.drainBefore(payload.threadId, () => {
        this.applyOwnerTurnLifecycleNotification(method, payload, event.sequence);
      })
    ) {
      return;
    }

    this.applyOwnerTurnLifecycleNotification(method, payload, event.sequence);
  }

  private applyOwnerTurnLifecycleNotification(
    method: OwnerTurnLifecycleMethod,
    payload: OwnerTurnLifecyclePayload,
    ownerNotificationSequence: number,
  ): void {
    this.publishOwnerConversationSnapshotMutation(
      payload.threadId,
      ownerNotificationSequence,
      (conversation) => applyOwnerTurnLifecycleToConversation(conversation, method, payload),
    );
    if (method !== "turn/started") {
      this.maybeDispatchOwnerQueuedFollowUp(payload.threadId);
    }
  }

  private handleOwnerItemLifecycleNotification(event: CodexThreadOwnerNotificationEvent): void {
    const method = event.method;
    if (method !== "item/started" && method !== "item/completed") {
      return;
    }

    const payload = parseOwnerItemLifecyclePayload(method, event.params);
    if (!payload) return;

    const itemRecord = asRecord(payload.item);
    const itemId = itemRecord
      ? getString(itemRecord, "id") ?? getString(itemRecord, "itemId")
      : null;
    if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId, itemId], event.sequence)) {
      return;
    }
    logAssistantStreamingDebug("renderer-owner-item-lifecycle", {
      method,
      sequence: event.sequence,
      threadId: payload.threadId,
      turnId: payload.turnId,
      itemId,
      itemType: getProtocolItemType(payload.item),
      itemStatus: itemRecord ? getString(itemRecord, "status") : null,
    });

    if (
      method === "item/completed" &&
      this.ownerTextDeltaQueue.drainBefore(payload.threadId, () => {
        this.applyOwnerItemLifecycleNotification(method, payload, event.sequence);
      })
    ) {
      return;
    }

    this.applyOwnerItemLifecycleNotification(method, payload, event.sequence);
  }

  private applyOwnerItemLifecycleNotification(
    method: "item/started" | "item/completed",
    payload: OwnerItemLifecyclePayload,
    ownerNotificationSequence: number,
  ): void {
    this.publishOwnerConversationMutation(
      payload.threadId,
      ownerNotificationSequence,
      (conversation) => applyOwnerItemLifecycleToConversation(conversation, method, payload),
    );
  }

  private handleOwnerFileChangePatchUpdatedNotification(event: CodexThreadOwnerNotificationEvent): void {
    const payload = parseOwnerFileChangePatchUpdatedPayload(event.params);
    if (!payload) return;
    if (this.ackOwnerNotificationIfTombstoned(payload.threadId, [payload.turnId, payload.itemId], event.sequence)) {
      return;
    }

    this.applyOwnerLocalConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerFileChangePatchUpdatedToConversation(conversation, payload),
    );
  }

  private handleOwnerNoopItemNotification(event: CodexThreadOwnerNotificationEvent): void {
    const payload = typeof event.params === "object" && event.params !== null
      ? event.params as Record<string, unknown>
      : null;
    if (
      !payload ||
      typeof payload.threadId !== "string" ||
      typeof payload.turnId !== "string" ||
      typeof payload.itemId !== "string"
    ) {
      return;
    }

    if (event.method === "item/reasoning/summaryPartAdded" && typeof payload.summaryIndex !== "number") {
      return;
    }

    if (event.method === "item/fileChange/outputDelta" && typeof payload.delta !== "string") {
      return;
    }

    if (event.method === "item/mcpToolCall/progress" && typeof payload.message !== "string") {
      return;
    }

    void this.ackOwnerNotification(payload.threadId, event.sequence);
  }

  private handleOwnerTerminalInteractionNotification(event: CodexThreadOwnerNotificationEvent): void {
    const payload = typeof event.params === "object" && event.params !== null
      ? event.params as Record<string, unknown>
      : null;
    if (
      !payload ||
      typeof payload.threadId !== "string" ||
      typeof payload.itemId !== "string" ||
      typeof payload.stdin !== "string"
    ) {
      return;
    }

    const bufferKey = getTerminalInteractionBufferKey(payload.threadId, payload.itemId);
    if (this.ackOwnerNotificationIfTombstoned(
      payload.threadId,
      [getString(payload, "turnId"), payload.itemId],
      event.sequence,
    )) {
      return;
    }
    const parsed = parseTerminalInteractionInput(
      this.terminalInputBuffers.get(bufferKey) ?? "",
      payload.stdin,
    );
    if (parsed.inputBuffer.length > 0) {
      this.terminalInputBuffers.set(bufferKey, parsed.inputBuffer);
    } else {
      this.terminalInputBuffers.delete(bufferKey);
    }

    const terminalPayload: OwnerTerminalInteractionPayload = {
      threadId: payload.threadId,
      turnId: getString(payload, "turnId"),
      itemId: payload.itemId,
      stdin: payload.stdin,
      observedAtMs: Date.now(),
    };
    this.applyOwnerLocalConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerTerminalInteractionToConversation(
        conversation,
        terminalPayload,
        parsed.commands,
      ),
    );
  }

  private handleOwnerServerRequestResolvedNotification(event: CodexThreadOwnerNotificationEvent): void {
    const payload = parseOwnerServerRequestResolvedPayload(event.params);
    if (!payload) return;

    this.publishOwnerConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerServerRequestResolvedToConversation(conversation, payload),
    );
  }

  private handleOwnerErrorNotification(event: CodexThreadOwnerNotificationEvent): void {
    const payload = parseOwnerErrorPayload(event.params);
    if (!payload) return;

    this.publishOwnerConversationMutation(
      payload.threadId,
      event.sequence,
      (conversation) => applyOwnerErrorToConversation(conversation, payload),
    );
  }

  private handleThreadOwnerUnavailable(event: CodexThreadOwnerUnavailableEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    const targetConversationIds = new Set([
      ...this.streamState.markOwnerUnavailable(event.ownerClientId),
      ...event.conversationIds,
    ]);
    for (const conversationId of targetConversationIds) {
      if (this.streamState.getRole(conversationId)?.role === "owner") continue;

      const conversation = this.conversationsById.get(conversationId);
      if (!conversation || conversation.resumeState === "needs_resume") continue;

      this.applyConversationSnapshot(conversationId, {
        ...conversation,
        resumeState: "needs_resume",
      });
    }
  }

  private handleMcpNotification(event: CodexMcpNotificationEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    if (event.method !== "item/commandExecution/outputDelta") {
      return;
    }

    this.outputDeltaQueue.enqueue({
      hostId: event.hostId,
      conversationId: event.params.threadId,
      turnId: event.params.turnId,
      itemId: event.params.itemId,
      delta: event.params.delta,
    });
  }

  private applyOwnerTextDeltas(
    updates: OwnerTextDeltaUpdate[],
    options: OwnerTextDeltaFlushOptions = {},
  ): void {
    if (updates.length === 0) return;

    const updatesByConversationId = new Map<string, OwnerTextDeltaUpdate[]>();
    for (const update of updates) {
      const existing = updatesByConversationId.get(update.conversationId);
      if (existing) {
        existing.push(update);
      } else {
        updatesByConversationId.set(update.conversationId, [update]);
      }
    }

    for (const [conversationId, conversationUpdates] of updatesByConversationId.entries()) {
      const maxSequence = conversationUpdates.reduce(
        (max, update) => Math.max(max, update.sequence),
        0,
      );
      this.publishOwnerConversationMutation(
        conversationId,
        maxSequence,
        (currentConversation) => {
          let nextConversation = currentConversation;
          for (const update of conversationUpdates) {
            const beforeState = readOwnerStreamingDebugItemState(nextConversation, update.itemId);
            const appliedConversation = applyOwnerTextDeltaToConversation(nextConversation, update);
            nextConversation = appliedConversation ?? nextConversation;

            if (update.target.type === "agentMessage" || update.target.type === "plan") {
              const afterState = readOwnerStreamingDebugItemState(nextConversation, update.itemId);
              const turnStatus = afterState.turnStatus;
              const itemStatus = afterState.itemStatus;
              logAssistantStreamingDebugSampled(
                "renderer-owner-delta-applied",
                `${conversationId}:${update.turnId ?? "latest"}:${update.itemId}:${update.target.type}`,
                {
                  conversationId,
                  turnId: update.turnId,
                  itemId: update.itemId,
                  targetType: update.target.type,
                  sequence: update.sequence,
                  deltaLength: update.delta.length,
                  applied: appliedConversation !== null,
                  beforeState,
                  afterState,
                  wouldAnimateAssistantMarkdown:
                    update.target.type === "agentMessage" &&
                    turnStatus === "inProgress" &&
                    itemStatus === "inProgress",
                },
              );
            }
          }
          return nextConversation;
        },
        { notifyMode: options.notifyMode ?? "default" },
      );
    }
  }

  private ensureOwnerStreamPublishCursor(
    conversationId: string,
    acceptedRevision: number,
    acceptedConversation: CodexConversationSnapshot,
  ): OwnerStreamPublishCursor {
    const existing = this.ownerStreamPublishCursorsByConversationId.get(conversationId);
    if (existing) {
      return existing;
    }

    const cursor: OwnerStreamPublishCursor = {
      acceptedRevision,
      acceptedConversation,
      inFlight: false,
      dirty: false,
      maxOwnerNotificationSequence: 0,
    };
    this.ownerStreamPublishCursorsByConversationId.set(conversationId, cursor);
    return cursor;
  }

  private adoptOwnerStreamLocalBase(conversationId: string, conversation: CodexConversationSnapshot): void {
    const cursor = this.ownerStreamPublishCursorsByConversationId.get(conversationId);
    if (!cursor || cursor.inFlight || cursor.dirty) {
      return;
    }

    cursor.acceptedConversation = conversation;
  }

  private isOwnerStreamPublishIdle(conversationId: string): boolean {
    const cursor = this.ownerStreamPublishCursorsByConversationId.get(conversationId);
    if (cursor && (cursor.inFlight || cursor.dirty)) {
      return false;
    }
    return true;
  }

  private waitForOwnerStreamPublishIdle(conversationId: string): Promise<void> {
    if (this.isOwnerStreamPublishIdle(conversationId)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const waiter: OwnerStreamPublishIdleWaiter = { resolve };
      const waiters = this.ownerStreamPublishIdleWaitersByConversationId.get(conversationId);
      if (waiters) {
        waiters.add(waiter);
        return;
      }
      this.ownerStreamPublishIdleWaitersByConversationId.set(conversationId, new Set([waiter]));
    });
  }

  private resolveOwnerStreamPublishIdleWaiters(conversationId: string): void {
    if (!this.isOwnerStreamPublishIdle(conversationId)) {
      return;
    }

    const waiters = this.ownerStreamPublishIdleWaitersByConversationId.get(conversationId);
    if (!waiters) {
      return;
    }

    this.ownerStreamPublishIdleWaitersByConversationId.delete(conversationId);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private queueOwnerStreamCursorPublish(
    conversationId: string,
    ownerNotificationSequence: number,
    cursor: OwnerStreamPublishCursor,
  ): void {
    cursor.dirty = true;
    cursor.maxOwnerNotificationSequence = Math.max(
      cursor.maxOwnerNotificationSequence,
      ownerNotificationSequence,
    );
    this.processOwnerStreamPublishCursor(conversationId);
  }

  private processOwnerStreamPublishCursor(conversationId: string): void {
    const cursor = this.ownerStreamPublishCursorsByConversationId.get(conversationId);
    if (!cursor || cursor.inFlight || !cursor.dirty) {
      return;
    }

    const conversation = this.conversationsById.get(conversationId);
    const role = this.streamState.getRole(conversationId);
    if (!conversation || !role || role.role !== "owner") {
      this.markOwnerStreamPublishUnavailable(conversationId);
      return;
    }

    const patches = buildCodexConversationStateUpdates(cursor.acceptedConversation, conversation);
    const ownerNotificationSequence = cursor.maxOwnerNotificationSequence;
    cursor.dirty = false;
    cursor.maxOwnerNotificationSequence = 0;

    if (patches.length === 0) {
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      if (cursor.dirty) {
        this.processOwnerStreamPublishCursor(conversationId);
      } else {
        this.resolveOwnerStreamPublishIdleWaiters(conversationId);
      }
      return;
    }

    const baseRevision = cursor.acceptedRevision;
    const revision = baseRevision + 1;
    const publishedConversation = conversation;
    cursor.inFlight = true;

    void (async () => {
      const accepted = await this.dispatchOwnerStreamPatches(
        conversationId,
        baseRevision,
        revision,
        patches,
        ownerNotificationSequence || undefined,
      );

      if (this.ownerStreamPublishCursorsByConversationId.get(conversationId) !== cursor) {
        return;
      }

      if (accepted) {
        cursor.acceptedRevision = revision;
        cursor.acceptedConversation = publishedConversation;
        cursor.inFlight = false;
        this.streamState.recordOwnerRevision(conversationId, revision);
        this.processOwnerStreamPublishCursor(conversationId);
        this.resolveOwnerStreamPublishIdleWaiters(conversationId);
        return;
      }

      await this.repairOwnerStreamPublishCursor(
        conversationId,
        cursor,
        ownerNotificationSequence,
      );
    })();
  }

  private async repairOwnerStreamPublishCursor(
    conversationId: string,
    cursor: OwnerStreamPublishCursor,
    failedOwnerNotificationSequence: number,
  ): Promise<void> {
    const conversation = this.conversationsById.get(conversationId);
    const role = this.streamState.getRole(conversationId);
    if (!conversation || !role || role.role !== "owner") {
      cursor.inFlight = false;
      this.markOwnerStreamPublishUnavailable(conversationId);
      return;
    }

    const ownerNotificationSequence = Math.max(
      failedOwnerNotificationSequence,
      cursor.maxOwnerNotificationSequence,
    );
    cursor.dirty = false;
    cursor.maxOwnerNotificationSequence = 0;
    const revision = cursor.acceptedRevision + 1;
    const accepted = await this.dispatchOwnerStreamSnapshot(
      conversationId,
      revision,
      conversation,
      ownerNotificationSequence || undefined,
    );

    if (this.ownerStreamPublishCursorsByConversationId.get(conversationId) !== cursor) {
      return;
    }

    if (!accepted) {
      cursor.inFlight = false;
      this.markOwnerStreamPublishUnavailable(conversationId);
      return;
    }

    cursor.acceptedRevision = revision;
    cursor.acceptedConversation = conversation;
    cursor.inFlight = false;
    this.streamState.recordOwnerRevision(conversationId, revision);
    this.processOwnerStreamPublishCursor(conversationId);
    this.resolveOwnerStreamPublishIdleWaiters(conversationId);
  }

  private publishOwnerConversationMutation(
    conversationId: string,
    ownerNotificationSequence: number,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
    options: { notifyMode?: ConversationNotifyMode } = {},
  ): void {
    const role = this.streamState.getRole(conversationId);
    const acceptedRevision = this.streamState.getRevision(conversationId);
    const currentConversation = this.conversationsById.get(conversationId);
    if (!currentConversation || !role || role.role !== "owner" || typeof acceptedRevision !== "number") {
      this.handleOwnerReducerUnavailable(conversationId);
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (!nextConversation || nextConversation === currentConversation) {
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    if (buildCodexConversationStateUpdates(currentConversation, nextConversation).length === 0) {
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    const cursor = this.ensureOwnerStreamPublishCursor(
      conversationId,
      acceptedRevision,
      currentConversation,
    );
    this.applyConversationSnapshot(
      conversationId,
      nextConversation,
      undefined,
      options.notifyMode ?? "default",
    );
    this.queueOwnerStreamCursorPublish(conversationId, ownerNotificationSequence, cursor);
  }

  private publishOwnerConversationSnapshotMutation(
    conversationId: string,
    ownerNotificationSequence: number,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
  ): void {
    const role = this.streamState.getRole(conversationId);
    const acceptedRevision = this.streamState.getRevision(conversationId);
    const currentConversation = this.conversationsById.get(conversationId);
    if (!currentConversation || !role || role.role !== "owner" || typeof acceptedRevision !== "number") {
      this.handleOwnerReducerUnavailable(conversationId);
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (!nextConversation || nextConversation === currentConversation) {
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    const cursor = this.ensureOwnerStreamPublishCursor(
      conversationId,
      acceptedRevision,
      currentConversation,
    );
    this.applyConversationSnapshot(conversationId, nextConversation);
    this.queueOwnerStreamCursorPublish(conversationId, ownerNotificationSequence, cursor);
  }

  private applyOwnerLocalConversationMutation(
    conversationId: string,
    ownerNotificationSequence: number,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
  ): void {
    const role = this.streamState.getRole(conversationId);
    const baseRevision = this.streamState.getRevision(conversationId);
    const currentConversation = this.conversationsById.get(conversationId);
    if (!currentConversation || !role || role.role !== "owner" || typeof baseRevision !== "number") {
      this.handleOwnerReducerUnavailable(conversationId);
      void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
      return;
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (nextConversation && nextConversation !== currentConversation) {
      this.applyConversationSnapshot(conversationId, nextConversation);
      this.adoptOwnerStreamLocalBase(conversationId, nextConversation);
    }

    void this.ackOwnerNotification(conversationId, ownerNotificationSequence);
  }

  private applyOwnerSilentConversationMutation(
    conversationId: string,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
  ): void {
    const role = this.streamState.getRole(conversationId);
    const currentConversation = this.conversationsById.get(conversationId);
    if (!currentConversation || !role || role.role !== "owner") {
      this.handleOwnerReducerUnavailable(conversationId);
      return;
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (nextConversation && nextConversation !== currentConversation) {
      this.applyConversationSnapshot(conversationId, nextConversation);
      this.adoptOwnerStreamLocalBase(conversationId, nextConversation);
    }
  }

  private publishOwnerActionConversationMutation(
    conversationId: string,
    buildNextConversation: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot | null,
  ): void {
    const role = this.streamState.getRole(conversationId);
    const acceptedRevision = this.streamState.getRevision(conversationId);
    const currentConversation = this.conversationsById.get(conversationId);
    if (!currentConversation || !role || role.role !== "owner" || typeof acceptedRevision !== "number") {
      this.handleOwnerReducerUnavailable(conversationId);
      return;
    }

    const nextConversation = buildNextConversation(currentConversation);
    if (!nextConversation || nextConversation === currentConversation) {
      return;
    }

    if (buildCodexConversationStateUpdates(currentConversation, nextConversation).length === 0) {
      return;
    }

    const cursor = this.ensureOwnerStreamPublishCursor(
      conversationId,
      acceptedRevision,
      currentConversation,
    );
    this.applyConversationSnapshot(conversationId, nextConversation);
    this.queueOwnerStreamCursorPublish(conversationId, 0, cursor);
  }

  private async ackOwnerNotification(conversationId: string, sequence: number): Promise<void> {
    if (sequence <= 0) return;

    try {
      await invoke("codex:thread-owner:notification:ack", {
        conversationId,
        sequence,
      });
    } catch {
      this.markOwnerStreamPublishUnavailable(conversationId);
    }
  }

  private async dispatchOwnerStreamPatches(
    conversationId: string,
    baseRevision: number,
    revision: number,
    patches: OwnerStreamPublishPatches,
    ownerNotificationSequence?: number,
  ): Promise<boolean> {
    try {
      const accepted = (await invoke("codex:thread-owner:stream-state:publish", {
        conversationId,
        change: {
          type: "patches",
          baseRevision,
          revision,
          patches,
        },
        ownerNotificationSequence,
      })) as boolean;
      return accepted === true;
    } catch {
      return false;
    }
  }

  private async dispatchOwnerStreamSnapshot(
    conversationId: string,
    revision: number,
    conversation: CodexConversationSnapshot,
    ownerNotificationSequence?: number,
  ): Promise<boolean> {
    try {
      const accepted = (await invoke("codex:thread-owner:stream-state:publish", {
        conversationId,
        change: {
          type: "snapshot",
          revision,
          conversationState: conversation,
        },
        ownerNotificationSequence,
      })) as boolean;
      return accepted === true;
    } catch {
      return false;
    }
  }

  private cancelOwnerStreamPublishQueues(conversationId?: string): void {
    if (typeof conversationId === "string") {
      this.ownerStreamPublishCursorsByConversationId.delete(conversationId);
      this.resolveOwnerStreamPublishIdleWaiters(conversationId);
      return;
    }

    this.ownerStreamPublishCursorsByConversationId.clear();
    for (const conversationId of this.ownerStreamPublishIdleWaitersByConversationId.keys()) {
      this.resolveOwnerStreamPublishIdleWaiters(conversationId);
    }
  }

  private markOwnerStreamPublishUnavailable(conversationId: string): void {
    this.ownerTextDeltaQueue.cancelConversation(conversationId);
    this.cancelOwnerStreamPublishQueues(conversationId);
    const conversation = this.conversationsById.get(conversationId);
    if (!conversation) {
      this.streamState.removeConversation(conversationId);
      return;
    }

    if (conversation.resumeState !== "needs_resume") {
      this.applyConversationSnapshot(conversationId, {
        ...conversation,
        resumeState: "needs_resume",
      });
    }
    this.streamState.removeConversation(conversationId);
  }

  private handleOwnerReducerUnavailable(conversationId: string): void {
    if (this.streamState.getRole(conversationId)?.role === "follower") {
      return;
    }

    this.markOwnerStreamPublishUnavailable(conversationId);
  }

  private applyOutputDeltas(updates: OutputDeltaUpdate[]): void {
    if (updates.length === 0) {
      return;
    }

    const updatesByConversationId = new Map<string, OutputDeltaUpdate[]>();
    for (const update of updates) {
      const existing = updatesByConversationId.get(update.conversationId);
      if (existing) {
        existing.push(update);
      } else {
        updatesByConversationId.set(update.conversationId, [update]);
      }
    }

    for (const [conversationId, conversationUpdates] of updatesByConversationId.entries()) {
      const maxOwnerSequence = conversationUpdates.reduce(
        (max, update) => Math.max(max, update.ownerNotificationSequence ?? 0),
        0,
      );
      const baseRevision = this.streamState.getRevision(conversationId);
      const currentConversation = this.conversationsById.get(conversationId);
      if (!currentConversation) {
        for (const update of conversationUpdates) {
          warnMissingOutputDeltaTarget("Skipping command output delta for unknown conversation", update);
        }
        void this.ackOwnerNotification(conversationId, maxOwnerSequence);
        continue;
      }

      if (maxOwnerSequence > 0) {
        const role = this.streamState.getRole(conversationId);
        if (!role || role.role !== "owner" || typeof baseRevision !== "number") {
          this.handleOwnerReducerUnavailable(conversationId);
          void this.ackOwnerNotification(conversationId, maxOwnerSequence);
          continue;
        }
      }

      let nextConversation = currentConversation;
      for (const update of conversationUpdates) {
        const target = findOwnerTurnItemByItemId(nextConversation, update.itemId);
        if (!target) {
          warnMissingOutputDeltaTarget("Skipping command output delta for unknown item", update);
          continue;
        }
        const { turnIndex, itemIndex, turn, item } = target;

        const currentOutput = parseStoredAggregatedOutput(item.aggregatedOutput);
        const mergedOutput = truncateBufferedOutput({
          existingText: currentOutput.text,
          nextDelta: update.delta,
        });
        const nextOutput = formatStoredAggregatedOutput({
          text: mergedOutput.text,
          truncated: currentOutput.truncated || Boolean(update.truncated) || mergedOutput.truncated,
        });
        const rawItem = item.rawItem && typeof item.rawItem === "object"
          ? {
              ...(item.rawItem as Record<string, unknown>),
              aggregatedOutput: nextOutput,
            }
          : item.rawItem;
        const nextItem: CodexConversationItem = {
          ...item,
          aggregatedOutput: nextOutput,
          updatedAt: Date.now(),
          toolCall: item.toolCall
            ? {
                ...item.toolCall,
                result: nextOutput,
              }
            : item.toolCall,
          rawItem,
        };
        const nextItems = [...turn.items];
        nextItems[itemIndex] = nextItem;
        const nextTurns = [...nextConversation.turns];
        nextTurns[turnIndex] = {
          ...turn,
          items: nextItems,
        };
        nextConversation = {
          ...nextConversation,
          turns: nextTurns,
        };
      }

      if (nextConversation === currentConversation) {
        void this.ackOwnerNotification(conversationId, maxOwnerSequence);
        continue;
      }

      this.applyConversationSnapshot(conversationId, nextConversation);
      this.adoptOwnerStreamLocalBase(conversationId, nextConversation);
      void this.ackOwnerNotification(conversationId, maxOwnerSequence);
    }
  }

  private handleThreadStreamStateChanged(event: CodexThreadStreamStateChangedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    const currentVersion = this.conversationVersionById.get(event.conversationId) ?? 0;
    if (event.version <= currentVersion) {
      return;
    }

    this.outputDeltaQueue.flushNow();

    const sourceClientId = event.sourceClientId ?? null;
    const existingRole = this.streamState.getRole(event.conversationId);
    if (existingRole?.role === "owner") {
      return;
    }

    if (event.change.type === "snapshot") {
      this.ownerStreamPublishCursorsByConversationId.delete(event.conversationId);
      this.applyConversationSnapshot(event.conversationId, event.change.conversationState, event.version);
      this.streamState.acceptSnapshot({
        conversationId: event.conversationId,
        revision: event.change.revision,
        sourceClientId,
      });
      return;
    }

    const patchDecision = this.streamState.evaluatePatch({
      conversationId: event.conversationId,
      baseRevision: event.change.baseRevision,
      sourceClientId,
    });
    if (patchDecision.type !== "apply") {
      return;
    }

    const currentConversation = this.conversationsById.get(event.conversationId);
    if (!currentConversation) {
      return;
    }

    try {
      const nextConversation = applyCodexConversationStateUpdates(
        currentConversation,
        event.change.patches,
      );
      this.applyConversationSnapshot(
        event.conversationId,
        nextConversation,
        event.version,
        shouldSynchronouslyNotifyStreamingProsePatch(nextConversation, event.change.patches)
          ? "sync"
          : "default",
      );
      this.streamState.acceptPatch({
        conversationId: event.conversationId,
        revision: event.change.revision,
        sourceClientId,
      });
    } catch {
    }
  }

  private applyThreadStartProgress(event: Extract<CodexSharedObject, { objectType: "threadStartProgress" }>["value"]): void {
    const targetKey = getThreadStartProgressTargetKey(event.projectId, event.sessionId);
    const previous = this.threadStartProgressByTarget.get(targetKey);
    const previousText = event.clearOutput ? "" : previous?.outputText ?? "";
    const previousCarriageReturnPending = event.clearOutput
      ? false
      : previous?.outputCarriageReturnPending ?? false;
    const mergedOutput = event.outputDelta
      ? applyTerminalOutputDelta({
          existingText: previousText,
          outputDelta: event.outputDelta,
          outputCarriageReturnPending: previousCarriageReturnPending,
        })
      : {
          outputText: previousText,
          outputCarriageReturnPending: previousCarriageReturnPending,
        };

    const nextState: CodexThreadStartProgressState = {
      projectId: event.projectId,
      sessionId: event.sessionId,
      runInTarget: event.runInTarget,
      threadId: event.threadId,
      phase: event.phase,
      message: event.message,
      outputText: mergedOutput.outputText,
      outputCarriageReturnPending: mergedOutput.outputCarriageReturnPending,
      updatedAt: event.updatedAt,
    };
    if (areThreadStartProgressStatesEqual(previous, nextState)) {
      return;
    }

    this.threadStartProgressByTarget.set(targetKey, nextState);
    this.notifyControlCallbacks();
  }

  private withCachedThreadTitle(thread: CodexThreadSummary): CodexThreadSummary {
    if (thread.threadName?.trim()) {
      return thread;
    }

    const cachedTitle = this.threadTitlesById.get(thread.threadId);
    if (!cachedTitle) {
      return thread;
    }

    return {
      ...thread,
      threadName: cachedTitle,
    };
  }

  private withCachedConversationTitle(conversation: CodexConversationSnapshot): CodexConversationSnapshot {
    if (conversation.threadName?.trim()) {
      return conversation;
    }

    const cachedTitle = this.threadTitlesById.get(conversation.threadId);
    if (!cachedTitle) {
      return conversation;
    }

    return {
      ...conversation,
      threadName: cachedTitle,
    };
  }

  private applyThreadTitleUpdate(threadId: string, title: string): void {
    const normalizedThreadId = threadId.trim();
    const normalizedTitle = title.trim();
    if (!normalizedThreadId || !normalizedTitle) {
      return;
    }

    if (this.threadTitlesById.get(normalizedThreadId) === normalizedTitle) {
      return;
    }

    this.threadTitlesById.set(normalizedThreadId, normalizedTitle);
    const summary = this.threadSummariesById.get(normalizedThreadId);
    if (summary && summary.threadName !== normalizedTitle) {
      this.applyThreadSummary({
        ...summary,
        threadName: normalizedTitle,
      });
    }

    const conversation = this.conversationsById.get(normalizedThreadId);
    if (conversation && conversation.threadName !== normalizedTitle) {
      this.applyConversationSnapshot(normalizedThreadId, {
        ...conversation,
        threadName: normalizedTitle,
      });
      return;
    }

    this.notifyAnyConversationCallbacks({ forceMeta: true });
  }

  private applyThreadSummary(thread: CodexThreadSummary): void {
    const nextThread = this.withCachedThreadTitle(thread);
    if (nextThread.threadName?.trim()) {
      this.threadTitlesById.set(nextThread.threadId, nextThread.threadName);
    }

    this.threadSummariesById.set(nextThread.threadId, nextThread);
    if (!isCodexConversationDesktopNotificationEligible({
      ephemeral: nextThread.ephemeral,
      threadSource: nextThread.threadSource,
      source: nextThread.source,
    })) {
      this.notifyAnyConversationCallbacks({ forceMeta: true });
      return;
    }

    this.ensureRecentConversationId(nextThread.threadId);
    if (!nextThread.projectId) {
      this.notifyAnyConversationCallbacks({ forceMeta: true });
      return;
    }

    const currentThreads = this.threadSummariesByProject.get(nextThread.projectId) ?? EMPTY_THREADS;
    const nextThreads = upsertThreadSummary(currentThreads, nextThread);
    if (areThreadSummariesEqual(currentThreads, nextThreads)) {
      this.notifyAnyConversationCallbacks({ forceMeta: true });
      return;
    }

    this.threadSummariesByProject.set(nextThread.projectId, nextThreads);
    this.notifyProjectThreadSummaries(nextThread.projectId);
    this.notifyAnyConversationCallbacks({ forceMeta: true });
  }

  private removeThreadLocalState(threadId: string): void {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      return;
    }

    const changedProjectIds = new Set<string>();
    const existingSummary = this.threadSummariesById.get(normalizedThreadId);
    if (existingSummary?.projectId) {
      changedProjectIds.add(existingSummary.projectId);
    }

    this.threadSummariesById.delete(normalizedThreadId);
    this.conversationsById.delete(normalizedThreadId);
    this.primaryConversationRequestByThread.delete(normalizedThreadId);
    this.conversationVersionById.delete(normalizedThreadId);
    this.streamState.removeConversation(normalizedThreadId);
    this.cancelOwnerStreamPublishQueues(normalizedThreadId);
    this.ownerRollbackTombstonesByConversationId.delete(normalizedThreadId);
    this.composerIntentsByThread.delete(normalizedThreadId);
    this.interruptedTurnIdsByThread.delete(normalizedThreadId);
    this.resyncInFlight.delete(normalizedThreadId);

    for (const [projectId, threads] of this.threadSummariesByProject.entries()) {
      const nextThreads = threads.filter((thread) => thread.threadId !== normalizedThreadId);
      if (nextThreads.length === threads.length) {
        continue;
      }

      changedProjectIds.add(projectId);
      this.threadSummariesByProject.set(projectId, nextThreads);
    }

    for (let index = this.recentConversationIds.length - 1; index >= 0; index -= 1) {
      if (this.recentConversationIds[index] === normalizedThreadId) {
        this.recentConversationIds.splice(index, 1);
      }
    }

    this.notifyConversationCallbacks(normalizedThreadId);
    for (const projectId of changedProjectIds) {
      this.notifyProjectThreadSummaries(projectId);
    }
    this.notifyAnyConversationCallbacks({ forceMeta: true });
  }

  private ensureProjectThreadSummariesLoaded(projectId: string): void {
    if (this.loadedThreadSummariesByProject.has(projectId)) {
      return;
    }

    if (this.threadSummaryLoadsInFlightByProject.has(projectId)) {
      return;
    }

    void this.loadThreads(projectId).catch(() => {});
  }

  private emitNotificationEvents(
    currentConversation: CodexConversationSnapshot,
    nextConversation: CodexConversationSnapshot,
  ): void {
    if (!isCodexConversationDesktopNotificationEligible(nextConversation)) {
      return;
    }

    this.emitTurnCompletedEvents(currentConversation, nextConversation);
    this.emitRequestNotificationEvents(currentConversation, nextConversation);
  }

  private emitTurnCompletedEvents(
    currentConversation: CodexConversationSnapshot,
    nextConversation: CodexConversationSnapshot,
  ): void {
    if (this.turnCompletedListeners.size === 0) {
      return;
    }

    const currentTurnsById = new Map(
      currentConversation.turns.map((turn) => [turn.turnId, turn] as const),
    );
    for (const nextTurn of nextConversation.turns) {
      const previousTurn = currentTurnsById.get(nextTurn.turnId);
      if (!previousTurn || previousTurn.status !== "inProgress" || nextTurn.status === previousTurn.status) {
        continue;
      }
      if (this.wasTurnInterrupted(nextConversation.threadId, nextTurn.turnId)) {
        this.unmarkTurnInterrupted(nextConversation.threadId, nextTurn.turnId);
        continue;
      }
      if (nextTurn.status !== "completed" && nextTurn.status !== "failed") {
        continue;
      }

      const lastAgentMessage = this.findLastAgentMessageForTurn(nextTurn);
      for (const listener of this.turnCompletedListeners) {
        listener({
          conversationId: nextConversation.threadId,
          turnId: nextTurn.turnId,
          status: nextTurn.status,
          lastAgentMessage,
          heartbeatAssistantMessage: parseCodexHeartbeatAssistantMessage(lastAgentMessage),
          hasPendingContinuation: hasCodexPendingContinuation(nextConversation),
        });
      }
    }
  }

  private findLastAgentMessageForTurn(turn: CodexConversationTurn): string | null {
    for (let index = turn.items.length - 1; index >= 0; index -= 1) {
      const item = turn.items[index];
      if (!item) {
        continue;
      }
      if (item.role !== "assistant" && item.semanticKind !== "assistantMessage") {
        continue;
      }

      const markdownText = typeof item.markdownText === "string" ? item.markdownText : null;
      if (normalizeDesktopNotificationText(markdownText)) {
        return markdownText;
      }
    }

    return null;
  }

  private resolveInterruptTurnId(threadId: string, turnId?: string): string | null {
    if (typeof turnId === "string" && turnId.trim().length > 0) {
      return turnId;
    }

    const conversation = this.conversationsById.get(threadId);
    if (!conversation) {
      return null;
    }

    for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
      const turn = conversation.turns[index];
      if (turn?.status === "inProgress") {
        return turn.turnId;
      }
    }

    return null;
  }

  private markTurnInterrupted(threadId: string, turnId: string): void {
    const existing = this.interruptedTurnIdsByThread.get(threadId);
    if (existing) {
      existing.add(turnId);
      return;
    }

    this.interruptedTurnIdsByThread.set(threadId, new Set([turnId]));
  }

  private unmarkTurnInterrupted(threadId: string, turnId: string): void {
    const interruptedTurnIds = this.interruptedTurnIdsByThread.get(threadId);
    if (!interruptedTurnIds) {
      return;
    }

    interruptedTurnIds.delete(turnId);
    if (interruptedTurnIds.size === 0) {
      this.interruptedTurnIdsByThread.delete(threadId);
    }
  }

  private wasTurnInterrupted(threadId: string, turnId: string): boolean {
    return this.interruptedTurnIdsByThread.get(threadId)?.has(turnId) ?? false;
  }

  private rememberOwnerRollbackTombstones(
    threadId: string,
    before: CodexConversationSnapshot,
    after: CodexConversationSnapshot,
  ): void {
    const liveIds = new Set<string>();
    for (const turn of after.turns) {
      if (turn.turnId) liveIds.add(turn.turnId);
      for (const itemId of turn.itemIds) {
        liveIds.add(itemId);
      }
      for (const item of turn.items) {
        liveIds.add(item.itemId);
      }
    }

    const tombstones = this.ownerRollbackTombstonesByConversationId.get(threadId) ?? new Set<string>();
    for (const turn of before.turns) {
      if (turn.turnId && !liveIds.has(turn.turnId)) {
        tombstones.add(turn.turnId);
      }
      for (const itemId of turn.itemIds) {
        if (!liveIds.has(itemId)) {
          tombstones.add(itemId);
        }
      }
      for (const item of turn.items) {
        if (!liveIds.has(item.itemId)) {
          tombstones.add(item.itemId);
        }
      }
    }

    if (tombstones.size > 0) {
      this.ownerRollbackTombstonesByConversationId.set(threadId, tombstones);
    }
  }

  private isOwnerRollbackTombstoned(threadId: string, ids: readonly (string | null | undefined)[]): boolean {
    const tombstones = this.ownerRollbackTombstonesByConversationId.get(threadId);
    if (!tombstones) return false;

    return ids.some((id) => typeof id === "string" && tombstones.has(id));
  }

  private ackOwnerNotificationIfTombstoned(
    threadId: string,
    ids: readonly (string | null | undefined)[],
    sequence: number,
  ): boolean {
    if (!this.isOwnerRollbackTombstoned(threadId, ids)) return false;

    void this.ackOwnerNotification(threadId, sequence);
    return true;
  }

  private emitRequestNotificationEvents(
    currentConversation: CodexConversationSnapshot,
    nextConversation: CodexConversationSnapshot,
  ): void {
    if (this.approvalRequestListeners.size === 0 && this.userInputRequestListeners.size === 0) {
      return;
    }

    const seenRequestIds = new Set(currentConversation.requests.map((request) => request.requestId));
    for (const request of nextConversation.requests) {
      if (seenRequestIds.has(request.requestId)) {
        continue;
      }

      if (request.type === "approval") {
        for (const listener of this.approvalRequestListeners) {
          listener({
            conversationId: nextConversation.threadId,
            requestId: request.requestId,
            kind: request.kind,
            reason: request.reason ?? null,
          });
        }
        continue;
      }

      if (request.type !== "userInput") {
        continue;
      }

      const firstQuestion = normalizeDesktopNotificationText(request.questions[0]?.question ?? null);
      for (const listener of this.userInputRequestListeners) {
        listener({
          conversationId: nextConversation.threadId,
          requestId: request.requestId,
          turnId: request.turnId,
          questionCount: request.questions.length,
          firstQuestion,
        });
      }
    }
  }

  private applyConversationSnapshot(
    threadId: string,
    conversation: CodexConversationSnapshot,
    version?: number,
    notifyMode: ConversationNotifyMode = "default",
  ): void {
    const nextConversation = this.withCachedConversationTitle(
      normalizeConversationSnapshot(conversation),
    );
    const currentConversation = this.conversationsById.get(threadId);
    if (currentConversation === nextConversation) {
      return;
    }

    if (nextConversation.threadName?.trim()) {
      this.threadTitlesById.set(threadId, nextConversation.threadName);
    }

    if (currentConversation) {
      this.emitNotificationEvents(currentConversation, nextConversation);
    }

    for (const turn of nextConversation.turns) {
      if (turn.status === "interrupted") {
        this.unmarkTurnInterrupted(threadId, turn.turnId);
      }
    }

    this.conversationsById.set(threadId, nextConversation);
    const previousPrimaryRequest = this.primaryConversationRequestByThread.get(threadId) ?? null;
    const nextPrimaryRequest = selectPrimaryConversationRequest(nextConversation);
    this.primaryConversationRequestByThread.set(
      threadId,
      areConversationLiveRequestsEqual(previousPrimaryRequest, nextPrimaryRequest)
        ? previousPrimaryRequest
        : nextPrimaryRequest,
    );
    if (isCodexConversationDesktopNotificationEligible(nextConversation)) {
      this.ensureRecentConversationId(threadId);
    }
    if (isConversationStreaming(nextConversation)) {
      this.streamState.setStreaming(threadId, true);
    } else {
      this.streamState.setStreaming(threadId, false);
    }
    if (typeof version === "number") {
      this.conversationVersionById.set(threadId, version);
    }

    const existingSummary = this.threadSummariesById.get(threadId);
    const mergedSummary: CodexThreadSummary = {
      ...(existingSummary ?? nextConversation),
      ...nextConversation,
    };
    this.applyThreadSummary(mergedSummary);

    this.notifyConversationCallbacks(threadId, notifyMode);
    this.ensureChildConversationSnapshots(nextConversation);
  }

  private ensureChildConversationSnapshots(conversation: CodexConversationSnapshot): void {
    for (const membership of conversation.childMemberships) {
      const childThreadId = membership.threadId;
      const childConversation = this.conversationsById.get(childThreadId);
      if (childConversation && childConversation.turns.length > 0) {
        continue;
      }

      if (this.resyncInFlight.has(childThreadId)) {
        continue;
      }

      this.resyncInFlight.add(childThreadId);
      void this.requestThreadStreamSnapshot(childThreadId)
        .catch(() => {})
        .finally(() => {
          this.resyncInFlight.delete(childThreadId);
        });
    }
  }

  private notifyConversationCallbacks(
    threadId: string,
    notifyMode: ConversationNotifyMode = "default",
  ): void {
    const conversation = this.conversationsById.get(threadId);
    if (!conversation) {
      return;
    }

    const callbacks = this.conversationCallbacks.get(threadId);
    const notifyConversation = () => {
      if (!callbacks) return;

      for (const callback of callbacks) {
        callback(conversation);
      }
    };

    if (notifyMode === "sync") {
      flushSync(notifyConversation);
    } else {
      notifyConversation();
    }

    const anySnapshot = buildConversationAnyProjection(conversation);
    const previousAnySnapshot = this.lastAnySnapshotById.get(threadId);
    const anyChanged = !previousAnySnapshot
      || !areConversationAnyProjectionsEqual(previousAnySnapshot, anySnapshot);
    this.lastAnySnapshotById.set(threadId, anySnapshot);

    const metaSnapshot = buildConversationMetaProjection(conversation);
    const previousMetaSnapshot = this.lastMetaSnapshotById.get(threadId);
    const metaChanged = !previousMetaSnapshot
      || !areConversationMetaProjectionsEqual(previousMetaSnapshot, metaSnapshot);
    this.lastMetaSnapshotById.set(threadId, metaSnapshot);

    if (anyChanged || metaChanged) {
      this.notifyAnyConversationCallbacks({
        forceAny: anyChanged,
        forceMeta: metaChanged,
      });
    }
  }

  private notifyAnyConversationCallbacks({
    forceAny = false,
    forceMeta = false,
  }: {
    forceAny?: boolean;
    forceMeta?: boolean;
  } = {}): void {
    const conversations = this.readRecentConversations();
    const orderKey = buildRecentConversationOrderKey(conversations);
    const shouldNotifyAny = forceAny || orderKey !== this.lastAnyOrderKey;
    const shouldNotifyMeta = forceMeta || orderKey !== this.lastMetaOrderKey;

    if (shouldNotifyAny) {
      this.lastAnyOrderKey = orderKey;
      for (const callback of this.anyConversationCallbacks) {
        callback(conversations);
      }
    }

    if (shouldNotifyMeta) {
      this.lastMetaOrderKey = orderKey;
      for (const callback of this.anyConversationMetaCallbacks) {
        callback(conversations);
      }
    }
  }

  private notifyControlCallbacks(): void {
    this.notifyListeners(this.controlCallbacks);
  }

  private notifyProjectThreadSummaries(projectId: string): void {
    this.notifyListeners(this.projectSummaryCallbacksByProject.get(projectId));
  }

  private notifyListeners<T extends StoreListener | ControlListener>(
    listeners: Set<T> | undefined,
  ): void {
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener();
    }
  }

  private ensureRecentConversationId(threadId: string): void {
    if (this.recentConversationIds.includes(threadId)) {
      return;
    }

    this.recentConversationIds.unshift(threadId);
  }
}

export class CodexAppServerManagerRegistry {
  private readonly managers = new Map<string, CodexAppServerManager>();
  private readonly callbacks = new Set<StoreListener>();

  addManager(manager: CodexAppServerManager): void {
    this.managers.set(manager.getHostId(), manager);
    this.notifyRegistryChanged();
  }

  addRegistryCallback(listener: StoreListener): () => void {
    return subscribeSet(this.callbacks, listener);
  }

  deleteManager(hostId: string): void {
    const manager = this.managers.get(hostId);
    if (!manager) {
      return;
    }

    manager.destroy();
    this.managers.delete(hostId);
    this.notifyRegistryChanged();
  }

  getAll(): CodexAppServerManager[] {
    return Array.from(this.managers.values());
  }

  getDefault(): CodexAppServerManager {
    return this.getForHostId(DEFAULT_CODEX_HOST_ID);
  }

  getForHostId(hostId: string): CodexAppServerManager {
    const existing = this.managers.get(hostId);
    if (existing) {
      return existing;
    }

    const manager = new CodexAppServerManager(hostId);
    this.managers.set(hostId, manager);
    this.notifyRegistryChanged();
    return manager;
  }

  getForConversationId(conversationId: string): CodexAppServerManager {
    const manager = this.getMaybeForConversationId(conversationId);
    if (manager) {
      return manager;
    }

    throw new Error(`No CodexAppServerManager registered for conversationId: ${conversationId}`);
  }

  getMaybeForConversationId(conversationId: string): CodexAppServerManager | null {
    for (const manager of this.managers.values()) {
      if (manager.readConversation(conversationId) || manager.readThreadSummary(conversationId)) {
        return manager;
      }
    }

    return null;
  }

  notifyRegistryChanged(): void {
    for (const callback of this.callbacks) {
      callback();
    }
  }

  resetForTests(): void {
    for (const manager of this.managers.values()) {
      manager.resetForTests();
      manager.destroy();
    }
    this.managers.clear();
    this.callbacks.clear();
  }
}

const codexAppServerRegistry = new CodexAppServerManagerRegistry();

function getDefaultLocalConversationManager(): CodexAppServerManager {
  return codexAppServerRegistry.getDefault();
}

let rendererClientRequestBridgeRefCount = 0;
let unsubscribeRendererClientRequests: (() => void) | null = null;
let rendererClientRequestManager: CodexAppServerManager | null = null;

function isCodexThreadOwnerActionRequest(value: unknown): value is CodexThreadOwnerActionRequest {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isCodexRendererThreadRoleRequest(value: unknown): value is CodexRendererThreadRoleRequest {
  return typeof value === "object" && value !== null && typeof (value as { conversationId?: unknown }).conversationId === "string";
}

async function buildRendererClientResponse(
  manager: CodexAppServerManager,
  message: CodexRendererClientRequestMessage,
): Promise<CodexRendererClientResponseMessage> {
  try {
    if (message.method === "thread-role") {
      if (!isCodexRendererThreadRoleRequest(message.params)) {
        throw new Error("Invalid thread role request");
      }

      return {
        type: "success",
        requestId: message.requestId,
        result: manager.getThreadRoleForRendererClientRequest(message.params.conversationId),
      };
    }

    if (message.method !== "thread-owner-action") {
      throw new Error(`Unsupported renderer client request method ${message.method}`);
    }
    if (!isCodexThreadOwnerActionRequest(message.params)) {
      throw new Error("Invalid thread owner action request");
    }

    const result = await manager.handleThreadOwnerActionRequest(message.params);
    return {
      type: "success",
      requestId: message.requestId,
      result,
    };
  } catch (error) {
    return {
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function startLocalConversationRendererClientRequestBridge(manager: CodexAppServerManager): () => void {
  rendererClientRequestBridgeRefCount += 1;
  rendererClientRequestManager = manager;
  if (!unsubscribeRendererClientRequests) {
    unsubscribeRendererClientRequests = subscribeCodexRendererClientRequests((message) => {
      const activeManager = rendererClientRequestManager;
      if (!activeManager) return;

      void (async () => {
        const response = await buildRendererClientResponse(activeManager, message);
        await invoke("codex:renderer-client:response", response);
      })();
    });
  }

  return () => {
    rendererClientRequestBridgeRefCount = Math.max(0, rendererClientRequestBridgeRefCount - 1);
    if (rendererClientRequestBridgeRefCount > 0) return;

    rendererClientRequestManager = null;
    unsubscribeRendererClientRequests?.();
    unsubscribeRendererClientRequests = null;
  };
}

const CodexAppServerRegistryContext = createContext<CodexAppServerManagerRegistry>(codexAppServerRegistry);

export function LocalConversationProvider({
  children,
  hostId = DEFAULT_CODEX_HOST_ID,
}: {
  children: ReactNode;
  hostId?: string;
}) {
  const registry = codexAppServerRegistry;
  const manager = useMemo(
    () => registry.getForHostId(hostId),
    [hostId, registry],
  );

  useEffect(() => {
    const stopHostBridge = startLocalConversationHostBridge();
    const stopRendererClientRequestBridge = startLocalConversationRendererClientRequestBridge(manager);
    manager.start();
    return () => {
      stopRendererClientRequestBridge();
      stopHostBridge();
    };
  }, [manager]);

  return createElement(
    CodexAppServerRegistryContext.Provider,
    { value: registry },
    children,
  );
}

export function useCodexAppServerRegistry(): CodexAppServerManagerRegistry {
  const registry = useContext(CodexAppServerRegistryContext);
  return useExternalSelector(
    (listener) => registry.addRegistryCallback(listener),
    () => registry,
  );
}

export function useDefaultCodexAppServerManager(): CodexAppServerManager {
  const registry = useCodexAppServerRegistry();
  return useExternalSelector(
    (listener) => registry.addRegistryCallback(listener),
    () => registry.getDefault(),
  );
}

function useExternalSelector<T>(
  subscribe: (listener: StoreListener) => () => void,
  getSnapshot: () => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as T,
  });

  return useSyncExternalStore(
    subscribe,
    () => {
      const nextValue = getSnapshot();
      if (cacheRef.current.hasValue && isEqual(cacheRef.current.value, nextValue)) {
        return cacheRef.current.value;
      }

      cacheRef.current = {
        hasValue: true,
        value: nextValue,
      };
      return nextValue;
    },
  );
}

export function useMaybeCodexAppServerManagerForConversationId(
  conversationId: string | null,
): CodexAppServerManager | null {
  const registry = useCodexAppServerRegistry();
  return useExternalSelector(
    (listener) => {
      if (!conversationId) {
        return () => {};
      }

      const managerUnsubscribers = new Map<string, () => void>();
      const bindManagers = () => {
        const managers = registry.getAll();
        const nextHostIds = new Set(managers.map((manager) => manager.getHostId()));
        for (const [hostId, unsubscribe] of managerUnsubscribers.entries()) {
          if (!nextHostIds.has(hostId)) {
            unsubscribe();
            managerUnsubscribers.delete(hostId);
          }
        }

        for (const manager of managers) {
          const hostId = manager.getHostId();
          if (managerUnsubscribers.has(hostId)) {
            continue;
          }

          const unsubscribeConversation = manager.addConversationCallback(
            conversationId,
            () => {
              listener();
            },
          );
          const unsubscribeMeta = manager.addAnyConversationMetaCallback(() => {
            listener();
          });
          managerUnsubscribers.set(hostId, () => {
            unsubscribeConversation();
            unsubscribeMeta();
          });
        }
      };

      bindManagers();
      const unsubscribeRegistry = registry.addRegistryCallback(() => {
        bindManagers();
        listener();
      });

      return () => {
        unsubscribeRegistry();
        for (const unsubscribe of managerUnsubscribers.values()) {
          unsubscribe();
        }
      };
    },
    () => {
      if (!conversationId) {
        return null;
      }

      return registry.getMaybeForConversationId(conversationId);
    },
  );
}

export function useCodexAppServerManagerForConversationId(
  conversationId: string | null,
): CodexAppServerManager {
  const manager = useMaybeCodexAppServerManagerForConversationId(conversationId);
  const defaultManager = useDefaultCodexAppServerManager();
  return manager ?? defaultManager;
}

export function useCodexConversationValue<T>(
  conversationId: string | null,
  selector: (conversation: CodexConversationSnapshot | null) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const manager = useCodexAppServerManagerForConversationId(conversationId);
  return useExternalSelector(
    (listener) =>
      conversationId
        ? manager.addConversationCallback(conversationId, () => {
            listener();
          })
        : () => {},
    () => selector(conversationId ? manager.readConversation(conversationId) : null),
    isEqual,
  );
}

function useManagerControlSelection<T>(
  selector: (manager: CodexAppServerManager) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const manager = useDefaultCodexAppServerManager();
  return useExternalSelector(
    (listener) => manager.subscribeControl(listener),
    () => selector(manager),
    isEqual,
  );
}

function areModelsEqual(left: CodexModelOption[], right: CodexModelOption[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function areThreadStartProgressStatesEqual(
  left: CodexThreadStartProgressState | undefined | null,
  right: CodexThreadStartProgressState | undefined | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.projectId === right.projectId
    && left.sessionId === right.sessionId
    && left.runInTarget === right.runInTarget
    && left.threadId === right.threadId
    && left.phase === right.phase
    && left.message === right.message
    && left.outputText === right.outputText
    && left.outputCarriageReturnPending === right.outputCarriageReturnPending
    && left.updatedAt === right.updatedAt
  );
}

export function hydrateLocalConversationThreadSummaries(
  projectId: string,
  threads: CodexThreadSummary[],
): void {
  getDefaultLocalConversationManager().hydrateThreadSummaries(projectId, threads);
}

export function requestLocalConversationSnapshot(threadId: string): Promise<CodexConversationSnapshot | null> {
  return getDefaultLocalConversationManager().requestThreadStreamSnapshot(threadId);
}

export function requestLocalConversationResume(threadId: string): Promise<CodexConversationSnapshot | null> {
  return getDefaultLocalConversationManager().requestThreadStreamResume(threadId);
}

export function setLocalConversationThreadViewActive(threadId: string, active: boolean): Promise<boolean> {
  return getDefaultLocalConversationManager().setThreadViewActive(threadId, active);
}

export function requestLocalConversationOlderTurns(threadId: string): Promise<CodexConversationSnapshot | null> {
  return getDefaultLocalConversationManager().requestThreadOlderTurns(threadId);
}

export function setLocalConversationComposerIntent(threadId: string, composerIntent: CodexComposerIntent): void {
  getDefaultLocalConversationManager().setComposerIntent(threadId, composerIntent);
}

export function consumeLocalConversationComposerIntent(threadId: string, focusNonce: number): void {
  getDefaultLocalConversationManager().consumeComposerIntent(threadId, focusNonce);
}

export function removeLocalConversationPlanImplementationRequest(threadId: string, turnId: string): Promise<boolean> {
  return getDefaultLocalConversationManager().removePlanImplementationRequest(threadId, turnId);
}

export function setLocalConversationCollaborationMode(
  threadId: string,
  mode: CodexCollaborationModeKind,
): Promise<CodexCollaborationModeState> {
  return getDefaultLocalConversationManager().setLatestCollaborationModeForConversation(threadId, mode);
}

export function readLocalConversation(threadId: string): CodexConversationSnapshot | null {
  return getDefaultLocalConversationManager().readConversation(threadId);
}

export function __resetLocalConversationStoreForTests(): void {
  codexAppServerRegistry.resetForTests();
  rendererClientRequestBridgeRefCount = 0;
  rendererClientRequestManager = null;
  unsubscribeRendererClientRequests?.();
  unsubscribeRendererClientRequests = null;
  __resetLocalConversationHostBridgeForTests();
  __resetCodexAppServerMessageBusForTests();
}

export function useProjectThreadSummaries(projectId: string): CodexThreadSummary[] {
  const manager = useDefaultCodexAppServerManager();
  return useExternalSelector(
    (listener) => manager.subscribeProjectThreadSummaries(projectId, listener),
    () => manager.readProjectThreadSummaries(projectId),
  );
}

export function useConversation(threadId: string | null): CodexConversationSnapshot | null {
  return useCodexConversationValue(threadId, (conversation) => conversation);
}

export function useConversationSummaryFields(
  threadId: string | null,
): ConversationSummaryFields {
  return useCodexConversationValue(
    threadId,
    (conversation) => {
      if (!conversation) {
        return EMPTY_CONVERSATION_SUMMARY_FIELDS;
      }

      return {
        threadId: conversation.threadId,
        projectId: conversation.projectId,
        threadName: conversation.threadName,
        threadPreview: conversation.threadPreview,
        modelProvider: conversation.modelProvider,
        cwd: conversation.cwd,
        archived: conversation.archived,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        linkedAt: conversation.linkedAt,
      };
    },
    areConversationSummaryFieldsEqual,
  );
}

export function useConversationTurns(
  threadId: string | null,
): CodexConversationTurn[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.turns ?? EMPTY_TURNS,
  );
}

export function useConversationRequests(
  threadId: string | null,
): CodexConversationServerRequest[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.requests ?? EMPTY_REQUESTS,
  );
}

export function useConversationCwd(
  threadId: string | null,
): string | null {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.cwd ?? null,
  );
}

export function useConversationResumeState(
  threadId: string | null,
): CodexConversationResumeState | null {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.resumeState ?? null,
  );
}

export function useConversationStatusType(
  threadId: string | null,
): CodexConversationSnapshot["statusType"] | null {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.statusType ?? null,
  );
}

export function useConversationStatusActiveFlags(
  threadId: string | null,
): CodexConversationSnapshot["statusActiveFlags"] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.statusActiveFlags ?? EMPTY_STATUS_ACTIVE_FLAGS,
  );
}

export function useConversationCapabilityFlags(
  threadId: string | null,
): CodexConversationCapabilityFlags {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.capabilityFlags ?? EMPTY_CONVERSATION_CAPABILITY_FLAGS,
  );
}

export function useConversationChildMemberships(
  threadId: string | null,
): CodexConversationChildMembership[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.childMemberships ?? EMPTY_CHILD_MEMBERSHIPS,
  );
}

export function useConversationPendingSteers(
  threadId: string | null,
): CodexPendingSteer[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.pendingSteers ?? EMPTY_PENDING_STEERS,
  );
}

export function useConversationQueuedFollowUps(
  threadId: string | null,
): CodexQueuedFollowUp[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.queuedFollowUps ?? EMPTY_QUEUED_FOLLOW_UPS,
  );
}

export function useConversationBackgroundTerminalRows(
  threadId: string | null,
): CodexBackgroundTerminalRow[] {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.backgroundTerminalRows ?? EMPTY_BACKGROUND_TERMINAL_ROWS,
  );
}

export function useConversationSource(
  threadId: string | null,
): CodexConversationSource | null {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.source ?? null,
    (left, right) => left?.parentThreadId === right?.parentThreadId,
  );
}

export function useConversationParentThreadId(
  threadId: string | null,
): string | null {
  return useCodexConversationValue(
    threadId,
    (conversation) => conversation?.source?.parentThreadId ?? null,
  );
}

export function useConversationPrimaryRequest(
  threadId: string | null,
): CodexConversationLiveRequest | null {
  const manager = useCodexAppServerManagerForConversationId(threadId);
  return useExternalSelector(
    (listener) =>
      threadId
        ? manager.addConversationCallback(threadId, () => {
            listener();
          })
        : () => {},
    () => (threadId ? manager.readPrimaryConversationRequest(threadId) : null),
    areConversationLiveRequestsEqual,
  );
}

export function useConversationCollaborationMode(
  threadId: string | null,
): CodexCollaborationModeState | null {
  return useCodexConversationValue(threadId, (conversation) => conversation?.latestCollaborationMode ?? null);
}

export function useConversationThreadSettings(
  threadId: string | null,
): CodexConversationThreadSettings | null {
  return useCodexConversationValue(threadId, (conversation) => conversation?.latestThreadSettings ?? null);
}

export function useConversationSubset(threadIds: readonly string[]): Record<string, CodexConversationSnapshot> {
  const registry = useCodexAppServerRegistry();
  return useExternalSelector(
    (listener) => {
      if (threadIds.length === 0) {
        return () => {};
      }

      const unsubs = threadIds.map((threadId) => {
        const manager = registry.getMaybeForConversationId(threadId) ?? registry.getDefault();
        return manager.addConversationCallback(threadId, () => {
          listener();
        });
      });

      const unsubscribeRegistry = registry.addRegistryCallback(listener);
      return () => {
        unsubscribeRegistry();
        for (const unsubscribe of unsubs) {
          unsubscribe();
        }
      };
    },
    () => {
      if (threadIds.length === 0) {
        return EMPTY_CONVERSATION_MAP;
      }

      let hasConversation = false;
      const conversations: Record<string, CodexConversationSnapshot> = {};
      for (const threadId of threadIds) {
        const manager = registry.getMaybeForConversationId(threadId) ?? registry.getDefault();
        const conversation = manager.readConversation(threadId);
        if (!conversation) {
          continue;
        }

        conversations[threadId] = conversation;
        hasConversation = true;
      }

      return hasConversation ? conversations : EMPTY_CONVERSATION_MAP;
    },
    areConversationMapSelectionsEqual,
  );
}

export function useComposerIntent(threadId: string | null): CodexComposerIntent | null {
  const manager = useCodexAppServerManagerForConversationId(threadId);
  return useExternalSelector(
    (listener) =>
      threadId
        ? manager.addConversationCallback(threadId, () => {
            listener();
          })
        : () => {},
    () => (threadId ? manager.readComposerIntent(threadId) : null),
  );
}

export function useLocalConversationConnection(): CodexConnectionState {
  const manager = useDefaultCodexAppServerManager();
  return useExternalSelector(
    (listener) => manager.subscribeConnection(listener),
    () => manager.readConnection(),
  );
}

export function useLocalConversationAccount(): CodexAccountSnapshot | null {
  const manager = useDefaultCodexAppServerManager();
  return useExternalSelector(
    (listener) => manager.subscribeAccount(listener),
    () => manager.readAccount(),
  );
}

export function useCodexAvailableModels(): CodexModelOption[] {
  return useManagerControlSelection((manager) => manager.readAvailableModels(), areModelsEqual);
}

export function useCodexDictationState(): CodexDictationStateSnapshot {
  return useManagerControlSelection(
    (manager) => manager.readDictationState(),
    (left, right) =>
      left.isEnabled === right.isEnabled
      && left.authMethod === right.authMethod
      && left.isRealtimeVoiceActive === right.isRealtimeVoiceActive
      && left.shortcutLabel === right.shortcutLabel,
  );
}

export function useCodexPermissionMode(projectId: string): CodexPermissionMode {
  return useCodexPermissionState(projectId).mode;
}

export function useCodexPermissionState(projectId: string): CodexPermissionState {
  const manager = useDefaultCodexAppServerManager();
  useEffect(() => {
    if (!projectId) {
      return;
    }

    void manager.loadPermissionState(projectId).catch(() => {
      // main-process authority will retry on the next interaction
    });
  }, [manager, projectId]);

  return useManagerControlSelection(
    (managed) => managed.readPermissionState(projectId),
    arePermissionStatesEqual,
  );
}

export function useCodexLastHostError(): CodexHostErrorState | null {
  return useManagerControlSelection((manager) => manager.readLastHostError());
}

export function useCodexThreadStartProgress(
  projectId: string | null,
  sessionId: string | null,
): Omit<CodexThreadStartProgressState, "outputCarriageReturnPending"> | null {
  return useManagerControlSelection(
    (manager) => {
      if (!projectId || !sessionId) {
        return null;
      }

      const progress = manager.readThreadStartProgress(projectId, sessionId);
      if (!progress) {
        return null;
      }

      return {
        projectId: progress.projectId,
        sessionId: progress.sessionId,
        runInTarget: progress.runInTarget,
        threadId: progress.threadId,
        phase: progress.phase,
        message: progress.message,
        outputText: progress.outputText,
        updatedAt: progress.updatedAt,
      };
    },
    (left, right) => JSON.stringify(left) === JSON.stringify(right),
  );
}

export function useCodexAppServerControl(activeProjectId: string) {
  const manager = useDefaultCodexAppServerManager();
  const availableModels = useCodexAvailableModels();
  const permissionState = useCodexPermissionState(activeProjectId);
  const permissionMode = permissionState.mode;
  const {
    settings: storedThreadSettings,
    updateSettings: updateStoredThreadSettings,
  } = useCodexThreadSettings();
  const { serviceTierSettings } = useCodexServiceTierSettings();

  const threadSettings = useMemo(
    () => resolveCodexThreadSettings(storedThreadSettings, availableModels),
    [availableModels, storedThreadSettings],
  );
  const reasoningEffortOptions = useMemo<CodexReasoningEffortOption[]>(
    () => [...resolveCodexReasoningEffortOptions(threadSettings.model, availableModels)],
    [availableModels, threadSettings.model],
  );

  const loadThreads = useCallback(
    async (projectId: string, opts?: { includeArchived?: boolean }) => manager.loadThreads(projectId, opts),
    [manager],
  );
  const loadModels = useCallback(async () => manager.loadAvailableModels(), [manager]);
  const listCollaborationModes = useCallback(async () => manager.listCollaborationModes(), [manager]);
  const requestThreadStreamSnapshot = useCallback(
    async (threadId: string) => manager.requestThreadStreamSnapshot(threadId),
    [manager],
  );

  const startThreadForSession = useCallback(async (
    input: CodexThreadStartForSessionInput & {
      collaborationMode?: CodexCollaborationModeKind;
    },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const requestSettings = resolveCodexDraftRequestSettings(input, resolvedSettings);
    const effectiveServiceTier = resolveCodexRequestServiceTier(input, serviceTierSettings.serviceTier);
    const detail = await manager.startThreadForSession({
      ...input,
      ...requestSettings,
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    });
    await manager.loadThreads(input.projectId);
    return detail;
  }, [availableModels, manager, serviceTierSettings.serviceTier, storedThreadSettings]);

  const startSideChat = useCallback(async (
    input: CodexSideChatStartInput,
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const requestSettings = resolveCodexDraftRequestSettings(input, resolvedSettings);
    const effectiveServiceTier = resolveCodexRequestServiceTier(input, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(input.projectId);
    return manager.startSideChat({
      ...input,
      permissionMode: manager.readPermissionMode(input.projectId),
      ...requestSettings,
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    });
  }, [availableModels, manager, serviceTierSettings.serviceTier, storedThreadSettings]);

  const discardSideChat = useCallback(
    async (threadId: string) => manager.discardSideChat(threadId),
    [manager],
  );

  const setThreadName = useCallback(
    async (threadId: string, name: string, projectId: string) => manager.setThreadName(threadId, name, projectId),
    [manager],
  );
  const archiveThread = useCallback(
    async (threadId: string, projectId: string) => manager.archiveThread(threadId, projectId),
    [manager],
  );
  const unarchiveThread = useCallback(
    async (threadId: string, projectId: string) => manager.unarchiveThread(threadId, projectId),
    [manager],
  );

  const startTurn = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind; serviceTier?: CodexServiceTier; promptInput?: CodexTurnStartOptions["promptInput"] },
  ) => {
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const effectiveServiceTier = resolveCodexRequestServiceTier(opts, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(resolvedProjectId);
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      collaborationMode: opts?.collaborationMode,
      ...(opts?.promptInput ? { promptInput: opts.promptInput } : {}),
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    };
    return manager.startTurn(threadId, prompt, turnOpts);
  }, [activeProjectId, manager, serviceTierSettings.serviceTier]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind | null; serviceTier?: CodexServiceTier; promptInput?: CodexTurnStartOptions["promptInput"] },
  ) => {
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const effectiveServiceTier = resolveCodexRequestServiceTier(opts, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(resolvedProjectId);
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      collaborationMode: opts?.collaborationMode ?? undefined,
      ...(opts?.promptInput ? { promptInput: opts.promptInput } : {}),
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    };
    await manager.enqueueQueuedFollowUp(threadId, prompt, turnOpts);
  }, [activeProjectId, manager, serviceTierSettings.serviceTier]);

  const removeQueuedFollowUp = useCallback(
    async (threadId: string, followUpId: string) => manager.removeQueuedFollowUp(threadId, followUpId),
    [manager],
  );
  const reorderQueuedFollowUps = useCallback(
    async (threadId: string, orderedFollowUpIds: string[]) => manager.reorderQueuedFollowUps(threadId, orderedFollowUpIds),
    [manager],
  );
  const sendQueuedFollowUpNow = useCallback(
    async (threadId: string, followUpId: string) => manager.sendQueuedFollowUpNow(threadId, followUpId),
    [manager],
  );
  const editLastUserTurn = useCallback(async (
    threadId: string,
    turnId: string,
    message: string,
    opts?: { serviceTier?: CodexServiceTier },
  ) => {
    const effectiveServiceTier = resolveCodexRequestServiceTier(opts, serviceTierSettings.serviceTier);
    return manager.editLastUserTurn(
      threadId,
      turnId,
      message,
      buildCodexServiceTierRequestOverride(effectiveServiceTier),
    );
  }, [manager, serviceTierSettings.serviceTier]);
  const forkConversationFromTurn = useCallback(
    async (threadId: string, turnId: string, message: string) =>
      manager.forkConversationFromTurn(threadId, turnId, message),
    [manager],
  );
  const compactThread = useCallback(
    async (threadId: string) => manager.compactThread(threadId),
    [manager],
  );
  const getThreadGoal = useCallback(
    async (threadId: string) => manager.getThreadGoal(threadId),
    [manager],
  );
  const setThreadGoal = useCallback(
    async (input: { threadId: string; objective: string; tokenBudget?: number | null }) => manager.setThreadGoal(input),
    [manager],
  );
  const clearThreadGoal = useCallback(
    async (threadId: string) => manager.clearThreadGoal(threadId),
    [manager],
  );
  const setThreadMemoryMode = useCallback(
    async (input: { threadId: string; mode: ThreadMemoryMode }) => manager.setThreadMemoryMode(input),
    [manager],
  );
  const uploadFeedback = useCallback(
    async (params: FeedbackUploadParams) => manager.uploadFeedback(params),
    [manager],
  );
  const cleanBackgroundTerminals = useCallback(
    async (threadId: string) => manager.cleanBackgroundTerminals(threadId),
    [manager],
  );
  const setComposerIntent = useCallback(
    (threadId: string, composerIntent: CodexComposerIntent) => manager.setComposerIntent(threadId, composerIntent),
    [manager],
  );
  const consumeComposerIntent = useCallback(
    (threadId: string, focusNonce: number) => manager.consumeComposerIntent(threadId, focusNonce),
    [manager],
  );
  const setConversationCollaborationMode = useCallback(
    async (threadId: string, mode: CodexCollaborationModeKind) =>
      manager.setLatestCollaborationModeForConversation(threadId, mode),
    [manager],
  );
  const setConversationThreadSettings = useCallback(
    async (threadId: string, patch: CodexConversationThreadSettingsPatch) =>
      manager.setThreadSettingsForConversation(threadId, patch),
    [manager],
  );
  const removePlanImplementationRequest = useCallback(
    async (threadId: string, turnId: string) => manager.removePlanImplementationRequest(threadId, turnId),
    [manager],
  );

  const steerTurn = useCallback(
    async (input: CodexSteerTurnInput) => {
      const effectiveServiceTier = resolveCodexRequestServiceTier(input, serviceTierSettings.serviceTier);
      return manager.steerTurn({
        ...input,
        ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
      });
    },
    [manager, serviceTierSettings.serviceTier],
  );
  const interruptTurn = useCallback(
    async (threadId: string, turnId?: string) => manager.interruptTurn(threadId, turnId),
    [manager],
  );
  const respondApproval = useCallback(
    async (requestId: string, decision: CodexApprovalDecision, conversationId?: string | null) =>
      manager.respondApproval(requestId, decision, conversationId),
    [manager],
  );
  const respondUserInput = useCallback(
    async (requestId: string, answers: Record<string, string[]>, conversationId?: string | null) =>
      manager.respondUserInput(requestId, answers, conversationId),
    [manager],
  );
  const respondMcpElicitation = useCallback(
    async (
      requestId: string,
      response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse,
      conversationId?: string | null,
    ) => manager.respondMcpElicitation(requestId, response, conversationId),
    [manager],
  );
  const respondPermissionRequest = useCallback(
    async (requestId: string, response: CodexPermissionRequestResponse, conversationId?: string | null) =>
      manager.respondPermissionRequest(requestId, response, conversationId),
    [manager],
  );
  const setPermissionMode = useCallback(
    async (projectId: string, mode: CodexPermissionMode) => manager.setPermissionMode(projectId, mode),
    [manager],
  );
  const setThreadModel = useCallback((model: string) => {
    const normalizedModel = normalizeThreadSettingsModel(model);
    if (!normalizedModel) {
      return;
    }

    updateStoredThreadSettings({ model: normalizedModel });
  }, [updateStoredThreadSettings]);
  const setThreadReasoningEffort = useCallback((reasoningEffort: CodexThreadSettings["reasoningEffort"]) => {
    if (!reasoningEffort) {
      return;
    }

    updateStoredThreadSettings({ reasoningEffort });
  }, [updateStoredThreadSettings]);

  return {
    availableModels,
    threadSettings,
    reasoningEffortOptions,
    permissionState,
    permissionMode,
    loadThreads,
    loadModels,
    listCollaborationModes,
    requestThreadStreamSnapshot,
    startThreadForSession,
    startSideChat,
    discardSideChat,
    setThreadName,
    archiveThread,
    unarchiveThread,
    startTurn,
    enqueueQueuedFollowUp,
    removeQueuedFollowUp,
    reorderQueuedFollowUps,
    sendQueuedFollowUpNow,
    editLastUserTurn,
    forkConversationFromTurn,
    compactThread,
    getThreadGoal,
    setThreadGoal,
    clearThreadGoal,
    setThreadMemoryMode,
    uploadFeedback,
    cleanBackgroundTerminals,
    setComposerIntent,
    consumeComposerIntent,
    setConversationCollaborationMode,
    setConversationThreadSettings,
    removePlanImplementationRequest,
    steerTurn,
    interruptTurn,
    respondApproval,
    respondUserInput,
    respondMcpElicitation,
    respondPermissionRequest,
    setPermissionMode,
    setThreadModel,
    setThreadReasoningEffort,
  };
}
