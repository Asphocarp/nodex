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
import type {
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexBackgroundTerminalRow,
  CodexConversationSource,
  CodexConversationCapabilityFlags,
  CodexConversationChildMembership,
  CodexConversationResumeState,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexCollaborationModePreset,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexDictationStateSnapshot,
  CodexConversationLiveRequest,
  CodexMcpServerElicitationAction,
  CodexModelOption,
  CodexPendingSteer,
  CodexPermissionMode,
  CodexPermissionState,
  CodexQueuedFollowUp,
  CodexThreadDetail,
  CodexReasoningEffortOption,
  CodexServiceTier,
  CodexSharedObject,
  CodexThreadSettings,
  CodexThreadStartForCardInput,
  CodexThreadSummary,
  CodexTurnStartOptions,
} from "../../lib/types";
import { applyCodexConversationStateUpdates } from "../../../shared/codex-conversation-patches";
import { DEFAULT_CODEX_HOST_ID } from "../../../shared/codex-host";
import { sanitizeCodexThreadTitlePrompt } from "../../../shared/codex-thread-title";
import {
  resolveCodexReasoningEffortOptions,
  resolveCodexThreadSettings,
} from "../../lib/codex-thread-settings";
import {
  buildCodexServiceTierRequestOverride,
  resolveCodexRequestServiceTier,
} from "../../lib/codex-service-tier-settings";
import { useCodexThreadSettings } from "../../lib/use-codex-thread-settings";
import { useCodexServiceTierSettings } from "../../lib/use-codex-service-tier-settings";
import { invoke } from "./local-conversation-deps";
import {
  subscribeCodexAppServerMessage,
  type CodexClientStatusChangedEvent,
  type CodexErrorEvent,
  type CodexSharedObjectUpdatedEvent,
  type CodexThreadTitleUpdatedEvent,
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
  cardId: null,
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
    model: "gpt-5.2-codex",
    reasoning_effort: "medium",
    developer_instructions: null,
  },
};

const DEFAULT_CODEX_DICTATION_STATE: CodexDictationStateSnapshot = {
  isEnabled: false,
  authMethod: null,
  isRealtimeVoiceActive: false,
  shortcutLabel: "Ctrl+M",
};

type StoreListener = () => void;
type ConversationListener = (conversation: CodexConversationSnapshot) => void;
type AnyConversationListener = (conversations: CodexConversationSnapshot[]) => void;
type ControlListener = () => void;
type TurnCompletedListener = (payload: {
  conversationId: string;
  turnId: string;
  lastAgentMessage: string | null;
}) => void;
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
  projectId: string;
  cardId: string;
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
    && left.cardId === right.cardId
    && left.source?.parentThreadId === right.source?.parentThreadId
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

function getThreadStartProgressTargetKey(projectId: string, cardId: string): string {
  return `${projectId}:${cardId}`;
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
  projectId: string;
  cardId: string;
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
  cardId: string | null;
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
    cardId: conversation.cardId,
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
    && left.cardId === right.cardId
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
    && left.cardId === right.cardId
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
  const nextSource = typeof conversation.source === "object" && conversation.source !== null
    ? {
        parentThreadId:
          typeof conversation.source.parentThreadId === "string" && conversation.source.parentThreadId.trim().length > 0
            ? conversation.source.parentThreadId
            : null,
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
    || nextThreadName !== conversation.threadName
    || nextThreadPreview !== conversation.threadPreview
    || nextCreatedAt !== conversation.createdAt
    || nextUpdatedAt !== conversation.updatedAt;

  if (!didChange) {
    return conversation;
  }

  return {
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
  };
}

function normalizeDesktopNotificationText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildRecentConversationOrderKey(conversations: readonly CodexConversationSnapshot[]): string {
  return conversations
    .map((conversation) =>
      `${conversation.threadId}:${conversation.updatedAt}:${conversation.resumeState}:${conversation.statusType}`,
    )
    .join("|");
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
  private readonly primaryConversationRequestByThread = new Map<string, CodexConversationLiveRequest | null>();
  private readonly conversationVersionById = new Map<string, number>();
  private readonly composerIntentsByThread = new Map<string, CodexComposerIntent>();
  private readonly permissionStateByProject = new Map<string, CodexPermissionState>();
  private readonly permissionStateLoadsInFlightByProject = new Map<string, Promise<CodexPermissionState>>();
  private readonly threadStartProgressByTarget = new Map<string, CodexThreadStartProgressState>();
  private readonly threadTitlesById = new Map<string, string>();
  private readonly interruptedTurnIdsByThread = new Map<string, Set<string>>();
  private readonly recentConversationIds: string[] = [];
  private readonly streamingConversationIds = new Set<string>();
  private readonly streamRoles = new Map<string, "owner" | "follower">();

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

  readComposerIntent(threadId: string): CodexComposerIntent | null {
    return this.composerIntentsByThread.get(threadId) ?? null;
  }

  readPermissionMode(projectId: string): CodexPermissionMode {
    return resolveProjectPermissionMode(this.permissionStateByProject, projectId);
  }

  readPermissionState(projectId: string): CodexPermissionState {
    return resolveProjectPermissionState(this.permissionStateByProject, projectId);
  }

  readThreadStartProgress(projectId: string, cardId: string): CodexThreadStartProgressState | null {
    return this.threadStartProgressByTarget.get(getThreadStartProgressTargetKey(projectId, cardId)) ?? null;
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
    opts?: { cardId?: string; includeArchived?: boolean },
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
    opts?: { cardId?: string; includeArchived?: boolean },
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
    const conversation = (await invoke("codex:thread:resume:request", threadId)) as CodexConversationSnapshot | null;
    if (conversation) {
      this.applyConversationSnapshot(threadId, conversation);
      this.streamRoles.set(threadId, "owner");
    }
    return conversation;
  }

  async startThreadForCard(input: CodexThreadStartForCardInput & {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexThreadSettings["reasoningEffort"];
  }): Promise<CodexThreadDetail> {
    await this.loadPermissionState(input.projectId);
    const detail = (await invoke("codex:thread:start-for-card", {
      ...input,
      permissionMode: this.readPermissionMode(input.projectId),
    })) as CodexThreadDetail;

    if (!detail.threadName?.trim()) {
      void this.generateAndPersistThreadTitle({
        threadId: detail.threadId,
        projectId: detail.projectId,
        prompt: input.prompt,
        cwd: detail.cwd,
      });
    }

    return detail;
  }

  async setThreadName(threadId: string, name: string, projectId: string): Promise<boolean> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return false;
    }

    this.applyThreadTitleUpdate(threadId, normalizedName);
    try {
      const result = (await invoke("codex:thread:name:set", threadId, normalizedName)) as boolean;
      if (!result) {
        void this.loadThreads(projectId).catch(() => {});
      }
      return result;
    } catch (error) {
      void this.loadThreads(projectId).catch(() => {});
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

  async startTurn(threadId: string, prompt: string, opts?: CodexTurnStartOptions): Promise<unknown> {
    return invoke("codex:turn:start", threadId, prompt, opts);
  }

  async setLatestCollaborationModeForConversation(
    threadId: string,
    mode: CodexCollaborationModeKind,
  ): Promise<CodexCollaborationModeState> {
    const currentConversation = this.conversationsById.get(threadId);
    const nextMode: CodexCollaborationModeState = {
      ...(currentConversation?.latestCollaborationMode ?? DEFAULT_COLLABORATION_MODE_STATE),
      mode,
    };
    if (currentConversation && currentConversation.latestCollaborationMode?.mode !== mode) {
      this.applyConversationSnapshot(threadId, {
        ...currentConversation,
        latestCollaborationMode: nextMode,
      });
      this.streamRoles.set(threadId, "owner");
    }

    try {
      const persistedMode = (await invoke(
        "codex:thread:collaboration-mode:set",
        threadId,
        mode,
      )) as CodexCollaborationModeState;
      const refreshedConversation = this.conversationsById.get(threadId);
      if (refreshedConversation) {
        this.applyConversationSnapshot(threadId, {
          ...refreshedConversation,
          latestCollaborationMode: persistedMode,
        });
        this.streamRoles.set(threadId, "owner");
      }
      return persistedMode;
    } catch (error) {
      this.resyncConversation(threadId);
      throw error;
    }
  }

  async enqueueQueuedFollowUp(threadId: string, prompt: string, opts?: CodexTurnStartOptions): Promise<void> {
    await invoke("codex:thread:follow-up:enqueue", threadId, prompt, opts);
  }

  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<{ turnId: string } | null> {
    const promptText = prompt.trim();
    if (!promptText) {
      throw new Error("Turn steer requires a non-empty prompt");
    }

    return (await invoke("codex:turn:steer", threadId, turnId, promptText)) as { turnId: string } | null;
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<boolean> {
    const interruptedTurnId = this.resolveInterruptTurnId(threadId, turnId);
    if (interruptedTurnId) {
      this.markTurnInterrupted(threadId, interruptedTurnId);
    }

    try {
      const interrupted = (await invoke("codex:turn:interrupt", threadId, turnId)) as boolean;
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

  async respondApproval(requestId: string, decision: CodexApprovalDecision): Promise<boolean> {
    return (await invoke("codex:approval:respond", requestId, decision)) as boolean;
  }

  async respondUserInput(requestId: string, answers: Record<string, string[]>): Promise<boolean> {
    return (await invoke("codex:user-input:respond", requestId, answers)) as boolean;
  }

  async respondMcpElicitation(requestId: string, action: CodexMcpServerElicitationAction): Promise<boolean> {
    return (await invoke("codex:mcp-elicitation:respond", requestId, action)) as boolean;
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
    const currentConversation = this.conversationsById.get(threadId);
    if (currentConversation) {
      const nextTurns = currentConversation.turns.map((turn) => {
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
      this.applyConversationSnapshot(threadId, {
        ...currentConversation,
        turns: nextTurns,
        requests: currentConversation.requests.filter((request) =>
          request.type !== "implementPlan" || request.turnId !== turnId
        ),
      });
      this.streamRoles.set(threadId, "owner");
    }

    try {
      return (await invoke("codex:thread:plan-implementation:remove", threadId, turnId)) as boolean;
    } catch (error) {
      this.resyncConversation(threadId);
      throw error;
    }
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
    this.composerIntentsByThread.clear();
    this.permissionStateByProject.clear();
    this.permissionStateLoadsInFlightByProject.clear();
    this.threadStartProgressByTarget.clear();
    this.threadTitlesById.clear();
    this.interruptedTurnIdsByThread.clear();
    this.projectSummaryCallbacksByProject.clear();
    this.recentConversationIds.length = 0;
    this.streamingConversationIds.clear();
    this.streamRoles.clear();
    this.lastHostError = null;
    this.lastAnySnapshotById.clear();
    this.lastMetaSnapshotById.clear();
    this.lastAnyOrderKey = null;
    this.lastMetaOrderKey = null;
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
    for (const threadId of this.streamingConversationIds) {
      void this.requestThreadStreamSnapshot(threadId).catch(() => {});
    }
  }

  private handleThreadTitleUpdated(event: CodexThreadTitleUpdatedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    this.applyThreadTitleUpdate(event.conversationId, event.title);
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

  private handleThreadStreamStateChanged(event: CodexThreadStreamStateChangedEvent): void {
    if (event.hostId !== this.hostId) {
      return;
    }

    const currentVersion = this.conversationVersionById.get(event.conversationId) ?? 0;
    if (event.version <= currentVersion) {
      return;
    }

    if (event.change.type === "snapshot") {
      this.applyConversationSnapshot(event.conversationId, event.change.conversationState, event.version);
      this.streamRoles.set(event.conversationId, "follower");
      return;
    }

    const currentConversation = this.conversationsById.get(event.conversationId);
    if (!currentConversation) {
      this.resyncConversation(event.conversationId);
      return;
    }

    try {
      const nextConversation = applyCodexConversationStateUpdates(
        currentConversation,
        event.change.patches,
      );
      this.applyConversationSnapshot(event.conversationId, nextConversation, event.version);
      this.streamRoles.set(event.conversationId, "follower");
    } catch {
      this.resyncConversation(event.conversationId);
    }
  }

  private applyThreadStartProgress(event: Extract<CodexSharedObject, { objectType: "threadStartProgress" }>["value"]): void {
    const targetKey = getThreadStartProgressTargetKey(event.projectId, event.cardId);
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
      cardId: event.cardId,
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

  private async generateAndPersistThreadTitle(input: {
    threadId: string;
    projectId: string;
    prompt: string;
    cwd: string | null;
  }): Promise<void> {
    const existingSummary = this.threadSummariesById.get(input.threadId);
    if (existingSummary?.threadName?.trim()) {
      return;
    }

    const normalizedPrompt = sanitizeCodexThreadTitlePrompt(input.prompt);
    if (!normalizedPrompt) {
      return;
    }

    try {
      const result = (await invoke("codex:thread:title:generate", {
        hostId: this.hostId,
        prompt: normalizedPrompt,
        cwd: input.cwd,
      })) as { title: string | null };

      const title = result.title?.trim() ?? "";
      if (!title) {
        return;
      }

      this.applyThreadTitleUpdate(input.threadId, title);
      await this.setThreadName(input.threadId, title, input.projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handleHostError({
        hostId: this.hostId,
        message: "Could not generate thread title",
        detail: message,
      });
    }
  }

  private applyThreadSummary(thread: CodexThreadSummary): void {
    const nextThread = this.withCachedThreadTitle(thread);
    if (nextThread.threadName?.trim()) {
      this.threadTitlesById.set(nextThread.threadId, nextThread.threadName);
    }

    const currentThreads = this.threadSummariesByProject.get(nextThread.projectId) ?? EMPTY_THREADS;
    const nextThreads = upsertThreadSummary(currentThreads, nextThread);
    this.threadSummariesById.set(nextThread.threadId, nextThread);
    this.ensureRecentConversationId(nextThread.threadId);
    if (areThreadSummariesEqual(currentThreads, nextThreads)) {
      this.notifyAnyConversationCallbacks({ forceMeta: true });
      return;
    }

    this.threadSummariesByProject.set(nextThread.projectId, nextThreads);
    this.notifyProjectThreadSummaries(nextThread.projectId);
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
          lastAgentMessage,
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

      const message = normalizeDesktopNotificationText(item.markdownText);
      if (message) {
        return message;
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
    this.ensureRecentConversationId(threadId);
    if (isConversationStreaming(nextConversation)) {
      this.streamingConversationIds.add(threadId);
    } else {
      this.streamingConversationIds.delete(threadId);
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

    this.notifyConversationCallbacks(threadId);
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

  private resyncConversation(threadId: string): void {
    if (this.resyncInFlight.has(threadId)) {
      return;
    }

    this.resyncInFlight.add(threadId);
    void this.requestThreadStreamSnapshot(threadId)
      .catch(() => {})
      .finally(() => {
        this.resyncInFlight.delete(threadId);
      });
  }

  private notifyConversationCallbacks(threadId: string): void {
    const conversation = this.conversationsById.get(threadId);
    if (!conversation) {
      return;
    }

    const callbacks = this.conversationCallbacks.get(threadId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(conversation);
      }
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
    manager.start();
    return () => {
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
    && left.cardId === right.cardId
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
        cardId: conversation.cardId,
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
  cardId: string | null,
): Omit<CodexThreadStartProgressState, "outputCarriageReturnPending"> | null {
  return useManagerControlSelection(
    (manager) => {
      if (!projectId || !cardId) {
        return null;
      }

      const progress = manager.readThreadStartProgress(projectId, cardId);
      if (!progress) {
        return null;
      }

      return {
        projectId: progress.projectId,
        cardId: progress.cardId,
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
    async (projectId: string, opts?: { cardId?: string; includeArchived?: boolean }) => manager.loadThreads(projectId, opts),
    [manager],
  );
  const loadModels = useCallback(async () => manager.loadAvailableModels(), [manager]);
  const listCollaborationModes = useCallback(async () => manager.listCollaborationModes(), [manager]);

  const startThreadForCard = useCallback(async (
    input: CodexThreadStartForCardInput & {
      collaborationMode?: CodexCollaborationModeKind;
      worktreeStartMode?: "autoBranch" | "detachedHead";
      worktreeBranchPrefix?: string;
    },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const effectiveServiceTier = resolveCodexRequestServiceTier(input, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(input.projectId);
    const detail = await manager.startThreadForCard({
      ...input,
      permissionMode: manager.readPermissionMode(input.projectId),
      model: input.model ?? resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    });
    await manager.loadThreads(input.projectId);
    return detail;
  }, [availableModels, manager, serviceTierSettings.serviceTier, storedThreadSettings]);

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
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const effectiveServiceTier = resolveCodexRequestServiceTier(opts, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(resolvedProjectId);
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      model: resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      collaborationMode: opts?.collaborationMode,
      ...(opts?.promptInput ? { promptInput: opts.promptInput } : {}),
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    };
    return manager.startTurn(threadId, prompt, turnOpts);
  }, [activeProjectId, availableModels, manager, serviceTierSettings.serviceTier, storedThreadSettings]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind | null; serviceTier?: CodexServiceTier; promptInput?: CodexTurnStartOptions["promptInput"] },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const effectiveServiceTier = resolveCodexRequestServiceTier(opts, serviceTierSettings.serviceTier);
    await manager.loadPermissionState(resolvedProjectId);
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      model: resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      collaborationMode: opts?.collaborationMode ?? undefined,
      ...(opts?.promptInput ? { promptInput: opts.promptInput } : {}),
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    };
    await manager.enqueueQueuedFollowUp(threadId, prompt, turnOpts);
  }, [activeProjectId, availableModels, manager, serviceTierSettings.serviceTier, storedThreadSettings]);

  const steerTurn = useCallback(
    async (threadId: string, turnId: string, prompt: string) => manager.steerTurn(threadId, turnId, prompt),
    [manager],
  );
  const interruptTurn = useCallback(
    async (threadId: string, turnId?: string) => manager.interruptTurn(threadId, turnId),
    [manager],
  );
  const respondApproval = useCallback(
    async (requestId: string, decision: CodexApprovalDecision) => manager.respondApproval(requestId, decision),
    [manager],
  );
  const respondUserInput = useCallback(
    async (requestId: string, answers: Record<string, string[]>) => manager.respondUserInput(requestId, answers),
    [manager],
  );
  const respondMcpElicitation = useCallback(
    async (requestId: string, action: CodexMcpServerElicitationAction) => manager.respondMcpElicitation(requestId, action),
    [manager],
  );
  const setPermissionMode = useCallback(
    async (projectId: string, mode: CodexPermissionMode) => manager.setPermissionMode(projectId, mode),
    [manager],
  );
  const setThreadModel = useCallback((model: string) => {
    updateStoredThreadSettings({ model });
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
    startThreadForCard,
    setThreadName,
    archiveThread,
    unarchiveThread,
    startTurn,
    enqueueQueuedFollowUp,
    steerTurn,
    interruptTurn,
    respondApproval,
    respondUserInput,
    respondMcpElicitation,
    setPermissionMode,
    setThreadModel,
    setThreadReasoningEffort,
  };
}
