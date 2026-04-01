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
  CodexCollaborationModeKind,
  CodexCollaborationModePreset,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexMcpServerElicitationAction,
  CodexModelOption,
  CodexPermissionMode,
  CodexReasoningEffortOption,
  CodexSharedObject,
  CodexThreadSettings,
  CodexThreadStartForCardInput,
  CodexThreadSummary,
  CodexTurnStartOptions,
} from "../../lib/types";
import { applyCodexConversationStateUpdates } from "../../../shared/codex-conversation-patches";
import { DEFAULT_CODEX_HOST_ID } from "../../../shared/codex-host";
import {
  readCodexPermissionModes,
  writeCodexPermissionModes,
} from "../../lib/codex-permission-mode-settings";
import {
  resolveCodexReasoningEffortOptions,
  resolveCodexThreadSettings,
} from "../../lib/codex-thread-settings";
import { useCodexThreadSettings } from "../../lib/use-codex-thread-settings";
import { invoke } from "./local-conversation-deps";
import {
  subscribeCodexAppServerMessage,
  type CodexClientStatusChangedEvent,
  type CodexSharedObjectUpdatedEvent,
  type CodexThreadStreamStateChangedEvent,
  __resetCodexAppServerMessageBusForTests,
} from "./app-server-message-bus";
import {
  __resetLocalConversationHostBridgeForTests,
  startLocalConversationHostBridge,
} from "./local-conversation-host-bridge";

const INITIAL_CONNECTION: CodexConnectionState = {
  status: "disconnected",
  retries: 0,
};

const EMPTY_THREADS: CodexThreadSummary[] = [];
const EMPTY_DISMISSED_TURN_IDS: Record<string, string> = {};
const EMPTY_CONVERSATION_MAP: Record<string, CodexConversationSnapshot> = {};
const EMPTY_MODELS: CodexModelOption[] = [];

type StoreListener = () => void;
type ConversationListener = (conversation: CodexConversationSnapshot) => void;
type AnyConversationListener = (conversations: CodexConversationSnapshot[]) => void;
type ControlListener = () => void;

interface CodexThreadStartProgressState {
  projectId: string;
  cardId: string;
  phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
  message: string;
  outputText: string;
  outputCarriageReturnPending: boolean;
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

function areDismissedTurnIdsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
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

function cloneArray<T>(value: readonly T[]): T[] {
  return value.slice();
}

function buildConversationAnySnapshotKey(conversation: CodexConversationSnapshot): string {
  return JSON.stringify({
    id: conversation.threadId,
    updatedAt: conversation.updatedAt,
    resumeState: conversation.resumeState,
    statusType: conversation.statusType,
    statusActiveFlags: cloneArray(conversation.statusActiveFlags),
    requests: conversation.requests.map((request) => request.requestId),
    pendingSteers: conversation.pendingSteers.map((steer) => steer.steerId),
    queuedFollowUps: conversation.queuedFollowUps.map((followUp) => followUp.followUpId),
    turns: conversation.turns.map((turn) => ({
      turnId: turn.turnId,
      status: turn.status,
    })),
  });
}

function buildConversationMetaSnapshotKey(conversation: CodexConversationSnapshot): string {
  return JSON.stringify({
    id: conversation.threadId,
    projectId: conversation.projectId,
    cardId: conversation.cardId,
    archived: conversation.archived,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    threadName: conversation.threadName,
    threadPreview: conversation.threadPreview,
    statusType: conversation.statusType,
    statusActiveFlags: cloneArray(conversation.statusActiveFlags),
    resumeState: conversation.resumeState,
  });
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
  permissionModeByProject: ReadonlyMap<string, CodexPermissionMode>,
  projectId: string,
): CodexPermissionMode {
  return permissionModeByProject.get(projectId) ?? "custom";
}

export class CodexAppServerManager {
  private connection: CodexConnectionState = INITIAL_CONNECTION;
  private account: CodexAccountSnapshot | null = null;
  private availableModels: CodexModelOption[] = EMPTY_MODELS;
  private readonly threadSummariesByProject = new Map<string, CodexThreadSummary[]>();
  private readonly threadSummariesById = new Map<string, CodexThreadSummary>();
  private readonly conversationsById = new Map<string, CodexConversationSnapshot>();
  private readonly conversationVersionById = new Map<string, number>();
  private readonly composerIntentsByThread = new Map<string, CodexComposerIntent>();
  private readonly dismissedPlanImplementationTurnIdByThread = new Map<string, string>();
  private readonly permissionModeByProject = new Map<string, CodexPermissionMode>();
  private readonly threadStartProgressByTarget = new Map<string, CodexThreadStartProgressState>();
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
  private readonly lastAnySnapshotById = new Map<string, string>();
  private readonly lastMetaSnapshotById = new Map<string, string>();
  private lastAnyOrderKey: string | null = null;
  private lastMetaOrderKey: string | null = null;

  private readonly busUnsubscribers: Array<() => void> = [];
  private bootstrapStarted = false;
  private readonly resyncInFlight = new Set<string>();

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

  readProjectThreadSummaries(projectId: string): CodexThreadSummary[] {
    return this.threadSummariesByProject.get(projectId) ?? EMPTY_THREADS;
  }

  readThreadSummary(threadId: string): CodexThreadSummary | null {
    return this.threadSummariesById.get(threadId) ?? null;
  }

  readConversation(threadId: string): CodexConversationSnapshot | null {
    return this.conversationsById.get(threadId) ?? null;
  }

  readComposerIntent(threadId: string): CodexComposerIntent | null {
    return this.composerIntentsByThread.get(threadId) ?? null;
  }

  readDismissedPlanImplementationTurnId(threadId: string): string | null {
    return this.dismissedPlanImplementationTurnIdByThread.get(threadId) ?? null;
  }

  readPermissionMode(projectId: string): CodexPermissionMode {
    return resolveProjectPermissionMode(this.permissionModeByProject, projectId);
  }

  readThreadStartProgress(projectId: string, cardId: string): CodexThreadStartProgressState | null {
    return this.threadStartProgressByTarget.get(getThreadStartProgressTargetKey(projectId, cardId)) ?? null;
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

  removeAnyConversationMetaCallback(listener: AnyConversationListener): void {
    this.anyConversationMetaCallbacks.delete(listener);
  }

  hydrateThreadSummaries(projectId: string, threads: CodexThreadSummary[]): void {
    const sortedThreads = sortThreadSummaries(threads);
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
    const threads = (await invoke("codex:threads:list", projectId, opts)) as CodexThreadSummary[];
    this.hydrateThreadSummaries(projectId, threads);
    return threads;
  }

  async loadAvailableModels(): Promise<CodexModelOption[]> {
    const models = (await invoke("codex:model:list")) as CodexModelOption[];
    this.setAvailableModels(models);
    return models;
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
  }): Promise<{ threadId: string; projectId: string }> {
    return (await invoke("codex:thread:start-for-card", {
      ...input,
      permissionMode: this.readPermissionMode(input.projectId),
    })) as { threadId: string; projectId: string };
  }

  async setThreadName(threadId: string, name: string, projectId: string): Promise<boolean> {
    const result = (await invoke("codex:thread:name:set", threadId, name)) as boolean;
    if (result) {
      await this.loadThreads(projectId);
    }
    return result;
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
    return (await invoke("codex:turn:interrupt", threadId, turnId)) as boolean;
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
    const current = this.permissionModeByProject.get(projectId);
    if (current === mode) {
      return;
    }

    this.permissionModeByProject.set(projectId, mode);
    writeCodexPermissionModes(Object.fromEntries(this.permissionModeByProject.entries()));
    this.notifyControlCallbacks();
    await invoke("codex:permission:mode:set", projectId, mode);
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

  resolvePlanImplementation(threadId: string, turnId: string): void {
    if (this.dismissedPlanImplementationTurnIdByThread.get(threadId) === turnId) {
      return;
    }

    this.dismissedPlanImplementationTurnIdByThread.set(threadId, turnId);
    this.notifyConversationCallbacks(threadId);
  }

  resetForTests(): void {
    this.connection = INITIAL_CONNECTION;
    this.account = null;
    this.availableModels = EMPTY_MODELS;
    this.threadSummariesByProject.clear();
    this.threadSummariesById.clear();
    this.conversationsById.clear();
    this.conversationVersionById.clear();
    this.composerIntentsByThread.clear();
    this.dismissedPlanImplementationTurnIdByThread.clear();
    this.permissionModeByProject.clear();
    this.threadStartProgressByTarget.clear();
    this.projectSummaryCallbacksByProject.clear();
    this.recentConversationIds.length = 0;
    this.streamingConversationIds.clear();
    this.streamRoles.clear();
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

  private async bootstrapAvailableModels(): Promise<void> {
    try {
      await this.loadAvailableModels();
    } catch {
      this.setAvailableModels([]);
    }
  }

  private async bootstrapPermissionModes(): Promise<void> {
    const stored = readCodexPermissionModes();
    let hasChange = false;
    for (const [projectId, mode] of Object.entries(stored)) {
      if (this.permissionModeByProject.get(projectId) === mode) {
        continue;
      }

      this.permissionModeByProject.set(projectId, mode);
      hasChange = true;
      void invoke("codex:permission:mode:set", projectId, mode).catch(() => {
        // ignore main-process availability errors on boot
      });
    }

    if (hasChange) {
      this.notifyControlCallbacks();
    }
  }

  private setAvailableModels(models: CodexModelOption[]): void {
    if (areModelsEqual(this.availableModels, models)) {
      return;
    }

    this.availableModels = models;
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

    for (const threadId of this.streamingConversationIds) {
      void this.requestThreadStreamSnapshot(threadId).catch(() => {});
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

  private applyThreadSummary(thread: CodexThreadSummary): void {
    const currentThreads = this.threadSummariesByProject.get(thread.projectId) ?? EMPTY_THREADS;
    const nextThreads = upsertThreadSummary(currentThreads, thread);
    this.threadSummariesById.set(thread.threadId, thread);
    this.ensureRecentConversationId(thread.threadId);
    if (areThreadSummariesEqual(currentThreads, nextThreads)) {
      this.notifyAnyConversationCallbacks({ forceMeta: true });
      return;
    }

    this.threadSummariesByProject.set(thread.projectId, nextThreads);
    this.notifyProjectThreadSummaries(thread.projectId);
    this.notifyAnyConversationCallbacks({ forceMeta: true });
  }

  private applyConversationSnapshot(
    threadId: string,
    conversation: CodexConversationSnapshot,
    version?: number,
  ): void {
    const currentConversation = this.conversationsById.get(threadId);
    if (currentConversation === conversation) {
      return;
    }

    this.conversationsById.set(threadId, conversation);
    this.ensureRecentConversationId(threadId);
    if (isConversationStreaming(conversation)) {
      this.streamingConversationIds.add(threadId);
    } else {
      this.streamingConversationIds.delete(threadId);
    }
    if (typeof version === "number") {
      this.conversationVersionById.set(threadId, version);
    }

    const existingSummary = this.threadSummariesById.get(threadId);
    const mergedSummary: CodexThreadSummary = {
      ...(existingSummary ?? conversation),
      ...conversation,
    };
    this.applyThreadSummary(mergedSummary);

    this.notifyConversationCallbacks(threadId);
    this.ensureChildConversationSnapshots(conversation);
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

    const anySnapshot = buildConversationAnySnapshotKey(conversation);
    const anyChanged = this.lastAnySnapshotById.get(threadId) !== anySnapshot;
    this.lastAnySnapshotById.set(threadId, anySnapshot);

    const metaSnapshot = buildConversationMetaSnapshotKey(conversation);
    const metaChanged = this.lastMetaSnapshotById.get(threadId) !== metaSnapshot;
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

export function resolveLocalConversationPlanImplementation(threadId: string, turnId: string): void {
  getDefaultLocalConversationManager().resolvePlanImplementation(threadId, turnId);
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

export function useDismissedPlanImplementationTurnIds(threadIds: readonly string[]): Record<string, string> {
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
        return EMPTY_DISMISSED_TURN_IDS;
      }

      let hasDismissedTurnId = false;
      const turnIds: Record<string, string> = {};
      for (const threadId of threadIds) {
        const manager = registry.getMaybeForConversationId(threadId) ?? registry.getDefault();
        const turnId = manager.readDismissedPlanImplementationTurnId(threadId);
        if (!turnId) {
          continue;
        }

        turnIds[threadId] = turnId;
        hasDismissedTurnId = true;
      }

      return hasDismissedTurnId ? turnIds : EMPTY_DISMISSED_TURN_IDS;
    },
    areDismissedTurnIdsEqual,
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

export function useCodexPermissionMode(projectId: string): CodexPermissionMode {
  return useManagerControlSelection((manager) => manager.readPermissionMode(projectId));
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
  const permissionMode = useCodexPermissionMode(activeProjectId);
  const {
    settings: storedThreadSettings,
    updateSettings: updateStoredThreadSettings,
  } = useCodexThreadSettings();

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
    const detail = await manager.startThreadForCard({
      ...input,
      permissionMode: manager.readPermissionMode(input.projectId),
      model: input.model ?? resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
    });
    await manager.loadThreads(input.projectId);
    return detail;
  }, [availableModels, manager, storedThreadSettings]);

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
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      model: resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      collaborationMode: opts?.collaborationMode,
    };
    return manager.startTurn(threadId, prompt, turnOpts);
  }, [activeProjectId, availableModels, manager, storedThreadSettings]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind | null },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: manager.readPermissionMode(resolvedProjectId),
      model: resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      collaborationMode: opts?.collaborationMode ?? undefined,
    };
    await manager.enqueueQueuedFollowUp(threadId, prompt, turnOpts);
  }, [activeProjectId, availableModels, manager, storedThreadSettings]);

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
