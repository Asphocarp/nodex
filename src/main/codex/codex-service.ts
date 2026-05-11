import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { produceWithPatches } from "immer";
import type { GetAuthStatusResponse } from "@nodex/codex-app-server-protocol";
import type { CollaborationModeListResponse } from "@nodex/codex-app-server-protocol/v2/CollaborationModeListResponse";
import type { ConfigBatchWriteParams } from "@nodex/codex-app-server-protocol/v2/ConfigBatchWriteParams";
import type { ConfigReadParams } from "@nodex/codex-app-server-protocol/v2/ConfigReadParams";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import type { CommandExecutionRequestApprovalParams } from "@nodex/codex-app-server-protocol/v2/CommandExecutionRequestApprovalParams";
import type { CommandExecutionRequestApprovalResponse } from "@nodex/codex-app-server-protocol/v2/CommandExecutionRequestApprovalResponse";
import type { GetAccountRateLimitsResponse } from "@nodex/codex-app-server-protocol/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@nodex/codex-app-server-protocol/v2/GetAccountResponse";
import type { LoginAccountResponse } from "@nodex/codex-app-server-protocol/v2/LoginAccountResponse";
import type { CancelLoginAccountResponse } from "@nodex/codex-app-server-protocol/v2/CancelLoginAccountResponse";
import type { FileChangeRequestApprovalParams } from "@nodex/codex-app-server-protocol/v2/FileChangeRequestApprovalParams";
import type { FileChangeRequestApprovalResponse } from "@nodex/codex-app-server-protocol/v2/FileChangeRequestApprovalResponse";
import type { McpServerElicitationRequestParams } from "@nodex/codex-app-server-protocol/v2/McpServerElicitationRequestParams";
import type { McpServerElicitationRequestResponse } from "@nodex/codex-app-server-protocol/v2/McpServerElicitationRequestResponse";
import type { ModelListResponse } from "@nodex/codex-app-server-protocol/v2/ModelListResponse";
import type { ThreadReadResponse } from "@nodex/codex-app-server-protocol/v2/ThreadReadResponse";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { ThreadRollbackResponse } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackResponse";
import type { ThreadResumeParams } from "@nodex/codex-app-server-protocol/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "@nodex/codex-app-server-protocol/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2/ThreadStartResponse";
import type { ThreadUnarchiveResponse } from "@nodex/codex-app-server-protocol/v2/ThreadUnarchiveResponse";
import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { TurnSteerParams } from "@nodex/codex-app-server-protocol/v2/TurnSteerParams";
import type { TurnSteerResponse } from "@nodex/codex-app-server-protocol/v2/TurnSteerResponse";
import type { ToolRequestUserInputParams } from "@nodex/codex-app-server-protocol/v2/ToolRequestUserInputParams";
import type { ToolRequestUserInputResponse } from "@nodex/codex-app-server-protocol/v2/ToolRequestUserInputResponse";
import type {
  CardRunInTarget,
  CodexAccountIdentity,
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexBackgroundTerminalRow,
  CodexComposerIntent,
  CodexConversationChildMembership,
  CodexConversationCapabilityFlags,
  CodexConversationItem,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexCollaborationModePreset,
  CodexConnectionState,
  CodexDictationStateSnapshot,
  CodexEvent,
  CodexHostMessage,
  CodexItemView,
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationRequest,
  CodexModelOption,
  CodexPlanImplementationServerRequest,
  CodexPendingSteer,
  CodexPermissionMode,
  CodexPermissionState,
  CodexQueuedFollowUp,
  CodexRateLimitsSnapshot,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexServiceTier,
  CodexTranscriptEntry,
  CodexTranscriptEntrySource,
  CodexThreadActiveFlag,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexThreadStatusType,
  CodexThreadSummary,
  CodexThreadStartProgressPhase,
  CodexThreadStartProgressStream,
  CodexTurnStartOptions,
  CodexTurnStatus,
  CodexThreadStartForCardInput,
  CodexTurnSummary,
  CodexUserAttachment,
  CodexUserInputRequest,
  CodexPromptAgentConfigInput,
  CodexPromptInput,
  ManagedWorktreeRecord,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentSettingsSnapshot,
  WorktreeStartMode,
} from "../../shared/types";
import { parseAssetSource } from "../../shared/assets";
import { parseInlineContent } from "../../shared/nfm";
import { parseCodexThreadTokenUsage } from "../../shared/schemas/codex";
import {
  buildPermissionModeConfigEdits,
  buildThreadPermissionOverrides,
  buildTurnPermissionOverrides,
  resolveCodexPermissionState,
} from "./codex-permission-resolver";
import {
  buildPlanImplementationRequestId,
  selectPrimaryConversationRequest,
} from "../../shared/codex-conversation-request";
import {
  buildAutomaticApprovalReviewSummary,
  normalizeAutomaticApprovalReviewPayload,
} from "../../shared/codex-transcript-special-items";
import {
  canMergeSyntheticTextDuplicate,
  mergeCodexItemView,
  resolveCodexItemPrimaryIdentityKey,
} from "../../shared/codex-item-identity";
import { mergeOrderedStringIds, upsertOrderedStringId } from "../../shared/codex-turn-order";
import * as dbService from "../kanban/db-service";
import { resolveAssetPath } from "../kanban/asset-service";
import { getKanbanDir } from "../kanban/config";
import {
  getCodexCardThreadLink,
  listCodexThreadLinks,
  listCodexProjectThreads,
  unlinkCodexThread,
  updateCodexThreadArchived,
  updateCodexThreadName,
  updateCodexThreadStatus,
  upsertCodexCardThreadLink,
} from "./codex-link-repository";
import {
  CodexAppServerClient,
  CodexRpcError,
  type CodexServerRequest,
  type CodexServerNotification,
} from "./codex-app-server-client";
import { readCodexSessionThreadDetail } from "./codex-session-store";
import { createManagedWorktree, removeManagedWorktree } from "./git-worktree-service";
import {
  buildCodexUserAttachmentsFromContent,
  buildTurnErrorItemView,
  normalizeThreadItem,
  resolveContextCompactionMarkdown,
} from "./codex-item-normalizer";
import {
  parseCodexReasoningBuffers,
  projectCodexReasoningSummary,
} from "./codex-reasoning-projection";
import {
  applyLiveTranscriptMutation,
  applyOptimisticUserPrompt,
  buildTranscriptFromBootstrapEvents,
  finalizeTurnTranscriptState,
  projectItemToLiveTranscriptEntry,
  reconcileCommittedUserPrompt,
  resolveThreadPreviewFromTranscript,
} from "./codex-transcript-projection";
import { shouldTerminalizeItemWithTurn } from "../../shared/codex-turn-terminalization";
import {
  buildCodexConversationSnapshot,
  buildCodexConversationTurn,
} from "./codex-conversation-snapshot";
import {
  convertImmerPatchesToCodexConversationStateUpdates,
} from "../../shared/codex-conversation-patches";
import { resolveCodexRuntime, type ResolvedCodexRuntime } from "./codex-runtime";
import { CodexThreadTitleStateStore } from "./thread-title-state";
import {
  buildThreadTitleGenerationPrompt,
  parseGeneratedThreadTitleResponse,
  THREAD_TITLE_MODEL,
  THREAD_TITLE_REASONING_EFFORT,
  THREAD_TITLE_SCHEMA,
  THREAD_TITLE_TIMEOUT_MS,
} from "./thread-title-generator";
import {
  listWorktreeEnvironmentOptions,
  readWorktreeEnvironmentDefinition,
  listWorktreeEnvironmentConfigs as listWorktreeEnvironmentConfigRecords,
  readWorktreeEnvironmentSettingsSnapshot as readWorktreeEnvironmentSettingsRecord,
  saveWorktreeEnvironmentSettingsSnapshot as saveWorktreeEnvironmentSettingsRecord,
} from "./worktree-environment-service";
import { getLogger } from "../logging/logger";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { CodexDictationService } from "./dictation-service";
import { requestChatGptDesktop } from "./chatgpt-desktop-request";

const codexLogger = getLogger({ subsystem: "codex", component: "service" });
const require = createRequire(import.meta.url);

interface ThreadRef {
  projectId: string;
  cardId: string;
  cwd: string | null;
}

interface PendingApproval {
  request: CodexApprovalRequest;
  resolve: (value: CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse) => void;
  reject: (reason?: unknown) => void;
}

interface PendingUserInput {
  request: CodexUserInputRequest;
  resolve: (value: { answers: Record<string, { answers: string[] }> }) => void;
  reject: (reason?: unknown) => void;
}

interface PendingMcpServerElicitation {
  request: CodexMcpServerElicitationRequest;
  resolve: (value: McpServerElicitationRequestResponse) => void;
  reject: (reason?: unknown) => void;
}

interface ParsedThreadStatus {
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
}

type StartTurnOverrides = CodexTurnStartOptions;

interface ResolvedThreadRunLocation {
  cwd: string;
  runInTarget: CardRunInTarget;
  createdManagedWorktree: boolean;
}

interface ThreadStartProgressUpdate {
  phase: CodexThreadStartProgressPhase;
  message: string;
  stream?: CodexThreadStartProgressStream;
  outputDelta?: string;
  clearOutput?: boolean;
}

interface BroadcastConversationSyncOptions {
  turnId?: string;
  syncDetail?: boolean;
  syncRequests?: boolean;
  syncQueuedFollowUps?: boolean;
  syncPendingSteers?: boolean;
  syncLatestCollaborationMode?: boolean;
  syncCapabilityFlags?: boolean;
  syncBackgroundTerminalRows?: boolean;
  syncChildMemberships?: boolean;
}

interface StructuredThreadTitleClient {
  startThread: (params: Record<string, unknown>) => Promise<unknown>;
  startTurn: (params: Record<string, unknown>) => Promise<unknown>;
  interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
  onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
}

interface RunStructuredThreadTitleInput {
  prompt: string;
  cwd: string | null;
  model: string;
  effort: CodexReasoningEffort | null;
  schema: Record<string, unknown>;
  config: Record<string, unknown> | null;
  timeoutMs?: number;
  client: StructuredThreadTitleClient;
  parse: (raw: string | null | undefined) => string | null;
}

interface GenerateThreadTitleAdapterInput {
  prompt: string;
  cwd: string | null;
  appServerConnection: {
    startThread: (params: Record<string, unknown>) => Promise<unknown>;
    startTurn: (params: Record<string, unknown>) => Promise<unknown>;
    interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
    registerInternalNotificationHandler: (
      handler: (notification: { method: string; params: unknown }) => void,
    ) => () => void;
  };
}

type CodexServiceOptions = {
  runtime?: ResolvedCodexRuntime;
  rateLimitsPollIntervalMs?: number;
};

type CodexConversationStreamRole = "owner" | "follower" | null;

interface CodexConversationRecord {
  detail: CodexThreadDetail | null;
  itemsByTurn: Map<string, Map<string, CodexItemView>>;
  planImplementationRequestsByTurnId: Map<string, CodexPlanImplementationServerRequest>;
  queuedFollowUps: CodexQueuedFollowUp[];
  pendingSteers: CodexPendingSteer[];
  latestCollaborationMode: CodexCollaborationModeState;
  resumeState: CodexConversationResumeState;
  streamRole: CodexConversationStreamRole;
  isStreaming: boolean;
}

type FrameTextDeltaTarget =
  | { type: "agentMessage" | "plan" }
  | { type: "reasoningSummary"; summaryIndex: number }
  | { type: "reasoningContent"; contentIndex: number };

interface FrameTextDeltaUpdate {
  threadId: string;
  turnId: string;
  itemId: string;
  target: FrameTextDeltaTarget;
  delta: string;
  observedAtMs: number;
}

interface OutputDeltaUpdate {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  truncated?: boolean;
}

const FRAME_TEXT_DELTA_FLUSH_MS = 16;
const OUTPUT_DELTA_FLUSH_MS = 50;
const MAX_COMMAND_OUTPUT_CHARS = 20_000;
const TRUNCATED_OUTPUT_PREFIX = "[output truncated]\n";
const RATE_LIMITS_POLL_INTERVAL_MS = 60_000;
const THREAD_FOLLOWER_COMMAND_APPROVAL_DECISION_METHOD = "thread-follower-command-approval-decision";
const THREAD_FOLLOWER_FILE_APPROVAL_DECISION_METHOD = "thread-follower-file-approval-decision";
const AUTOMATIC_APPROVAL_REVIEW_ITEM_TYPE = "automatic-approval-review";

function isVisibleDocumentAvailable(): boolean {
  const browserGlobals = globalThis as typeof globalThis & {
    document?: { visibilityState?: string };
  };
  return browserGlobals.document?.visibilityState === "visible";
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

function parseStoredAggregatedOutput(
  value: string | null | undefined,
): { text: string; truncated: boolean } {
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

function formatStoredAggregatedOutput(
  value: { text: string; truncated: boolean },
): string {
  return value.truncated ? `${TRUNCATED_OUTPUT_PREFIX}${value.text}` : value.text;
}

class FrameTextDeltaQueue {
  private readonly buffers = new Map<string, FrameTextDeltaUpdate>();
  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  private frameHandle: number | null = null;

  constructor(
    private readonly onFlush: (updates: FrameTextDeltaUpdate[]) => void,
    private readonly flushIntervalMs = FRAME_TEXT_DELTA_FLUSH_MS,
  ) {}

  enqueue(update: FrameTextDeltaUpdate): void {
    const key = this.buildKey(update);
    const existing = this.buffers.get(key);
    this.buffers.set(key, {
      ...update,
      delta: `${existing?.delta ?? ""}${update.delta}`,
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
    if (this.flushHandle !== null || this.frameHandle !== null) return;
    const browserGlobals = globalThis as typeof globalThis & {
      requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
    };
    if (typeof browserGlobals.requestAnimationFrame === "function" && isVisibleDocumentAvailable()) {
      this.frameHandle = browserGlobals.requestAnimationFrame(() => {
        this.frameHandle = null;
        this.flushNow();
      });
      return;
    }

    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }

  private cancelScheduledFlush(): void {
    if (this.flushHandle !== null) {
      clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
    if (this.frameHandle !== null) {
      const browserGlobals = globalThis as typeof globalThis & {
        cancelAnimationFrame?: (handle: number) => void;
      };
      browserGlobals.cancelAnimationFrame?.(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private buildKey(update: FrameTextDeltaUpdate): string {
    switch (update.target.type) {
      case "agentMessage":
      case "plan":
        return `${update.threadId}:${update.turnId}:${update.itemId}:${update.target.type}`;
      case "reasoningSummary":
        return `${update.threadId}:${update.turnId}:${update.itemId}:reasoningSummary:${update.target.summaryIndex}`;
      case "reasoningContent":
        return `${update.threadId}:${update.turnId}:${update.itemId}:reasoningContent:${update.target.contentIndex}`;
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
    const key = `${update.threadId}:${update.turnId}:${update.itemId}`;
    const existing = this.buffers.get(key);
    const merged = truncateBufferedOutput({
      existingText: existing?.delta ?? "",
      nextDelta: update.delta,
    });
    this.buffers.set(key, {
      ...update,
      delta: merged.text,
      truncated: Boolean(existing?.truncated) || merged.truncated,
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

function isUnavailableSqliteBindingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

type DefaultCodexRuntimeOptions = {
  isPackaged: boolean;
  projectRootPath?: string;
  resourcesPath?: string;
};

const THREAD_START_EXPERIMENTAL_RAW_EVENTS = false;
const THREAD_START_PERSIST_EXTENDED_HISTORY = true;
const THREAD_RESUME_PERSIST_EXTENDED_HISTORY = true;
const WORKTREE_SETUP_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const WORKTREE_LOG_STATUS_MESSAGE = "Creating a worktree and running setup.";

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  if (value > 10_000_000_000) return Math.floor(value);
  return Math.floor(value * 1000);
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return normalizeTimestamp(value);
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function parseTurnDiff(value: unknown): string | undefined {
  const candidate = asRecord(value);
  if (!candidate) return undefined;

  const diff = candidate.diff;
  return typeof diff === "string" && diff.length > 0 ? diff : undefined;
}

function resolveHomeDir(): string {
  const envHome = process.env.HOME?.trim();
  if (envHome) return envHome;
  return homedir();
}

function resolveCodexHomeDir(): string {
  const envCodexHome = process.env.CODEX_HOME?.trim();
  if (envCodexHome) return envCodexHome;
  return path.join(resolveHomeDir(), ".codex");
}

function parseThreadStatusType(value: unknown): CodexThreadStatusType | null {
  if (value === "active" || value === "idle" || value === "systemError" || value === "notLoaded") {
    return value;
  }
  if (value === "system_error") return "systemError";
  if (value === "not_loaded") return "notLoaded";
  return null;
}

function parseThreadActiveFlags(value: unknown): CodexThreadActiveFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (flag): flag is CodexThreadActiveFlag =>
      flag === "waitingOnApproval" || flag === "waitingOnUserInput",
  );
}

function parseThreadStatus(status: unknown): ParsedThreadStatus {
  const directStatus = parseThreadStatusType(status);
  if (directStatus) {
    return {
      statusType: directStatus,
      statusActiveFlags: [],
    };
  }

  if (typeof status !== "object" || status === null) {
    return { statusType: "notLoaded", statusActiveFlags: [] };
  }

  const candidate = status as {
    type?: unknown;
    status?: unknown;
    isActive?: unknown;
    activeFlags?: unknown;
    active_flags?: unknown;
  };
  const statusType = parseThreadStatusType(candidate.type) ?? parseThreadStatusType(candidate.status);
  if (statusType === "active") {
    const activeFlags = parseThreadActiveFlags(candidate.activeFlags ?? candidate.active_flags);
    return {
      statusType: "active",
      statusActiveFlags: activeFlags,
    };
  }

  if (statusType) {
    return {
      statusType,
      statusActiveFlags: [],
    };
  }

  if (typeof candidate.isActive === "boolean") {
    return {
      statusType: candidate.isActive ? "active" : "idle",
      statusActiveFlags: [],
    };
  }

  return { statusType: "notLoaded", statusActiveFlags: [] };
}

function parseThreadSourceParentThreadId(source: unknown): string | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }

  const candidate = source as Record<string, unknown>;
  if ("subAgent" in candidate) {
    return parseThreadSourceParentThreadId(candidate.subAgent);
  }
  if ("subagent" in candidate) {
    return parseThreadSourceParentThreadId(candidate.subagent);
  }
  if (!("thread_spawn" in candidate)) {
    return null;
  }

  const threadSpawn = candidate.thread_spawn;
  if (typeof threadSpawn !== "object" || threadSpawn === null) {
    return null;
  }

  const parentThreadId = (threadSpawn as Record<string, unknown>).parent_thread_id;
  return typeof parentThreadId === "string" && parentThreadId.trim().length > 0
    ? parentThreadId
    : null;
}

function isRolloutMaterializationError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();

  const isLegacyRolloutError =
    message.includes("failed to load rollout") &&
    (message.includes("empty session file") || message.includes("materialized") || message.includes("is empty"));
  if (isLegacyRolloutError) return true;

  // Newer app-server responses can skip "failed to load rollout" and directly report
  // includeTurns preconditions before the first user turn is materialized.
  const isPreMaterializedThreadError =
    message.includes("not materialized yet") ||
    (message.includes("includeturns") && message.includes("before first user message")) ||
    message.includes("includeturns is unavailable");

  return isPreMaterializedThreadError;
}

function isThreadNotFoundError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return message.includes("thread not found") || (message.includes("thread") && message.includes("not found"));
}

function isPathWithin(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(parentDir, candidatePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function truncateLastLines(value: string, maxLines = 12): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(lines.length - maxLines).join("\n");
}

function previewText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeCodexServiceTier(value: unknown): CodexServiceTier {
  return value === "fast" ? "fast" : null;
}

function formatServiceTierForReporting(value: unknown): "standard" | "fast" {
  return normalizeCodexServiceTier(value) ?? "standard";
}

function buildServiceTierParams(value: unknown): { serviceTier?: "fast" } {
  const normalized = normalizeCodexServiceTier(value);
  return normalized === "fast" ? { serviceTier: normalized } : {};
}

function createTextUserInput(text: string): TurnStartParams["input"][number] {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

type CodexUserInputItem = TurnStartParams["input"][number];

interface PreparedPromptForTurn {
  promptText: string;
  inputItems: CodexUserInputItem[];
  agentConfigOverrides: {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
  };
}

function isSupportedImageUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://") || source.startsWith("data:image/");
}

function parsePromptAgentConfigLine(line: string): CodexPromptAgentConfigInput | null {
  const trimmed = line.trim();
  const parsed = parseInlineContent(trimmed);
  if (parsed.length !== 1) return null;
  const [item] = parsed;
  if (item?.type !== "agentConfig") return null;
  return {
    ...(item.mode ? { mode: item.mode } : {}),
    ...(item.model ? { model: item.model } : {}),
    ...(item.reasoning ? { reasoning: item.reasoning } : {}),
    ...(item.unknownAttributes?.length ? { unknownAttributes: item.unknownAttributes } : {}),
  };
}

function splitPromptTextAndAgentConfigLines(prompt: string): {
  text: string;
  agentConfigs: CodexPromptAgentConfigInput[];
} {
  const agentConfigs: CodexPromptAgentConfigInput[] = [];
  const textLines: string[] = [];

  for (const line of prompt.replace(/\r\n/g, "\n").split("\n")) {
    const agentConfig = parsePromptAgentConfigLine(line);
    if (!agentConfig) {
      textLines.push(line);
      continue;
    }
    agentConfigs.push(agentConfig);
  }

  return {
    text: textLines.join("\n").trim(),
    agentConfigs,
  };
}

function validateReasoningEffortInput(value: string): CodexReasoningEffort | null {
  return parseReasoningEffort(value);
}

function validateCollaborationModeInput(value: string): CodexCollaborationModeKind | null {
  return parseCollaborationModeKind(value);
}

function normalizeTypeName(type: string | undefined): string {
  if (!type) return "";
  return type.replace(/[_\-\s]/g, "").toLowerCase();
}

function extractReceiverThreadIds(item: CodexConversationItem): string[] {
  const args = item.toolCall?.args;
  if (!args || typeof args !== "object") return [];

  const candidate = args as { receivers?: unknown };
  if (!Array.isArray(candidate.receivers)) return [];

  return candidate.receivers.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function isChildThreadSourceItem(item: CodexConversationItem): boolean {
  const normalizedType = normalizeTypeName(item.type);
  if (normalizedType.includes("collabagenttoolcall")) return true;

  const normalizedTool = normalizeTypeName(item.toolCall?.toolName);
  return normalizedTool === "spawnagent" || normalizedTool === "spawn_agent";
}

function resolveDefaultCodexRuntime(): ResolvedCodexRuntime {
  const resolveRuntimeOptions = (): DefaultCodexRuntimeOptions => {
    try {
      const electronModule = require("electron") as { app?: { isPackaged?: boolean } };
      const isPackaged = Boolean(electronModule.app?.isPackaged);
      return {
        isPackaged,
        projectRootPath: isPackaged ? undefined : process.cwd(),
        resourcesPath: process.resourcesPath,
      };
    } catch {
      return {
        isPackaged: false,
        projectRootPath: process.cwd(),
        resourcesPath: process.resourcesPath,
      };
    }
  };

  const buildDeferredRuntime = (options: DefaultCodexRuntimeOptions): ResolvedCodexRuntime => {
    if (!options.isPackaged) {
      const projectRootPath = options.projectRootPath?.trim();
      if (!projectRootPath) {
        throw new Error("Unpackaged Codex runtime resolution requires a project root path");
      }

      const runtimeRoot = path.join(projectRootPath, ".generated", "codex-runtime", "bin");
      return {
        source: "staged",
        binaryPath: path.join(runtimeRoot, "codex"),
        additionalSearchPaths: [runtimeRoot],
        version: null,
        metadataPath: path.join(runtimeRoot, "runtime.json"),
        missingBinaryMessage: "Pinned Codex runtime is missing or incomplete. Run `bun run stage:codex-runtime:mac`.",
      };
    }

    const resourcesPath = options.resourcesPath?.trim();
    if (!resourcesPath) {
      throw new Error("Packaged Codex runtime resolution requires process.resourcesPath");
    }

    const runtimeRoot = path.join(resourcesPath, "bin");
    return {
      source: "bundled",
      binaryPath: path.join(runtimeRoot, "codex"),
      additionalSearchPaths: [runtimeRoot],
      version: null,
      metadataPath: path.join(runtimeRoot, "runtime.json"),
      missingBinaryMessage: "Bundled Codex runtime is missing or corrupted. Reinstall Nodex.",
    };
  };

  const runtimeOptions = resolveRuntimeOptions();

  try {
    return resolveCodexRuntime(runtimeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Codex runtime is missing or incomplete under")) {
      return buildDeferredRuntime(runtimeOptions);
    }
    throw error;
  }
}

function appendOutputTail(currentTail: string, chunk: string, maxChars = 64_000): string {
  const merged = `${currentTail}${chunk}`;
  if (merged.length <= maxChars) return merged;
  return merged.slice(merged.length - maxChars);
}

function runWorktreeSetupScript(input: {
  script: string;
  cwd: string;
  onOutput?: (output: { stream: "stdout" | "stderr"; data: string }) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    codexLogger.info("Starting worktree setup script", {
      cwd: input.cwd,
      scriptPreview: previewText(input.script, 200),
    });
    const child = spawn(
      "bash",
      ["-euo", "pipefail", "-c", input.script],
      {
        cwd: input.cwd,
        env: process.env,
        windowsHide: true,
      },
    );
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdoutTail = "";
    let stderrTail = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 250).unref();
    }, WORKTREE_SETUP_SCRIPT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (!text) return;
      stdoutTail = appendOutputTail(stdoutTail, text);
      input.onOutput?.({ stream: "stdout", data: text });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (!text) return;
      stderrTail = appendOutputTail(stderrTail, text);
      input.onOutput?.({ stream: "stderr", data: text });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      codexLogger.error("Worktree setup script process errored", {
        cwd: input.cwd,
        durationMs: Date.now() - startedAt,
        error,
      });
      reject(new Error(`Worktree environment setup script failed.\n${String(error)}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      const trailingStdout = stdoutDecoder.end();
      if (trailingStdout) {
        stdoutTail = appendOutputTail(stdoutTail, trailingStdout);
        input.onOutput?.({ stream: "stdout", data: trailingStdout });
      }

      const trailingStderr = stderrDecoder.end();
      if (trailingStderr) {
        stderrTail = appendOutputTail(stderrTail, trailingStderr);
        input.onOutput?.({ stream: "stderr", data: trailingStderr });
      }

      if (code === 0 && !timedOut) {
        codexLogger.info("Worktree setup script completed", {
          cwd: input.cwd,
          durationMs: Date.now() - startedAt,
        });
        resolve();
        return;
      }

      const timeoutLine = timedOut
        ? `Setup script timed out after ${Math.round(WORKTREE_SETUP_SCRIPT_TIMEOUT_MS / 1000)}s.`
        : "";
      const output = [timeoutLine, truncateLastLines(stdoutTail), truncateLastLines(stderrTail)]
        .filter((chunk) => chunk.length > 0)
        .join("\n");
      const detail = output ? `\n${output}` : "";
      codexLogger.error("Worktree setup script failed", {
        cwd: input.cwd,
        durationMs: Date.now() - startedAt,
        timedOut,
        exitCode: code,
        output,
      });
      reject(new Error(`Worktree environment setup script failed.${detail}`));
    });
  });
}

function isNewerLinkTime(currentLinkedAt: string, candidateLinkedAt: string): boolean {
  const currentMs = Date.parse(currentLinkedAt);
  const candidateMs = Date.parse(candidateLinkedAt);
  if (Number.isFinite(currentMs) && Number.isFinite(candidateMs)) {
    return candidateMs > currentMs;
  }
  return candidateLinkedAt > currentLinkedAt;
}

function makeTurnStatus(value: unknown): CodexTurnStatus {
  if (value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress") {
    return value;
  }
  if (value === "in_progress") return "inProgress";
  return "inProgress";
}

function resolveNotificationTurnStatus(method: string): CodexTurnStatus | null {
  if (method === "turn/started") return "inProgress";
  if (method === "turn/completed") return "completed";
  if (method === "turn/interrupted") return "interrupted";
  if (method === "turn/failed") return "failed";
  return null;
}

function asTerminalTurnStatus(status: CodexTurnStatus): Exclude<CodexTurnStatus, "inProgress"> | null {
  if (status === "inProgress") return null;
  return status;
}

function emptyAccountSnapshot(): CodexAccountSnapshot {
  return {
    account: null,
    requiresOpenAiAuth: true,
    pendingLogin: null,
    rateLimits: null,
  };
}

function parseRateLimitsSnapshot(value: unknown): CodexRateLimitsSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const primary =
    typeof candidate.primary === "object" && candidate.primary !== null
      ? {
          usedPercent:
            typeof (candidate.primary as Record<string, unknown>).usedPercent === "number"
              ? (candidate.primary as Record<string, unknown>).usedPercent as number
              : 0,
          windowDurationMins:
            typeof (candidate.primary as Record<string, unknown>).windowDurationMins === "number"
              ? (candidate.primary as Record<string, unknown>).windowDurationMins as number
              : undefined,
          resetsAt:
            typeof (candidate.primary as Record<string, unknown>).resetsAt === "number"
              ? normalizeTimestamp((candidate.primary as Record<string, unknown>).resetsAt)
              : undefined,
        }
      : undefined;

  const secondary =
    typeof candidate.secondary === "object" && candidate.secondary !== null
      ? {
          usedPercent:
            typeof (candidate.secondary as Record<string, unknown>).usedPercent === "number"
              ? (candidate.secondary as Record<string, unknown>).usedPercent as number
              : 0,
          windowDurationMins:
            typeof (candidate.secondary as Record<string, unknown>).windowDurationMins === "number"
              ? (candidate.secondary as Record<string, unknown>).windowDurationMins as number
              : undefined,
          resetsAt:
            typeof (candidate.secondary as Record<string, unknown>).resetsAt === "number"
              ? normalizeTimestamp((candidate.secondary as Record<string, unknown>).resetsAt)
              : undefined,
        }
      : undefined;

  const credits =
    typeof candidate.credits === "object" && candidate.credits !== null
      ? {
          hasCredits: Boolean((candidate.credits as Record<string, unknown>).hasCredits),
          unlimited: Boolean((candidate.credits as Record<string, unknown>).unlimited),
          balance:
            typeof (candidate.credits as Record<string, unknown>).balance === "string"
              ? (candidate.credits as Record<string, unknown>).balance as string
              : undefined,
        }
      : undefined;

  return {
    limitId: typeof candidate.limitId === "string" ? candidate.limitId : undefined,
    limitName: typeof candidate.limitName === "string" ? candidate.limitName : undefined,
    primary,
    secondary,
    credits,
    planType: typeof candidate.planType === "string" ? candidate.planType : undefined,
  };
}

function parseAccountIdentity(value: unknown): CodexAccountIdentity | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "apiKey") {
    return { type: "apiKey" };
  }
  if (candidate.type === "chatgpt") {
    return {
      type: "chatgpt",
      email: typeof candidate.email === "string" ? candidate.email : "",
      planType: typeof candidate.planType === "string" ? candidate.planType : "unknown",
    };
  }
  return null;
}

function parseReasoningEffort(value: unknown): CodexReasoningEffort | null {
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

function parseCollaborationModeKind(value: unknown): CodexCollaborationModeKind | null {
  if (value === "default" || value === "plan") return value;
  return null;
}

function parseReasoningEffortOption(value: unknown): CodexReasoningEffortOption | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const reasoningEffort = parseReasoningEffort(candidate.reasoningEffort ?? candidate.reasoning_effort);
  if (!reasoningEffort) return null;

  return {
    reasoningEffort,
    description: typeof candidate.description === "string" ? candidate.description : "",
  };
}

function parseCollaborationModePreset(value: unknown): CodexCollaborationModePreset | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const mode = parseCollaborationModeKind(
    candidate.mode
      ?? candidate.mode_kind
      ?? candidate.modeKind
      ?? candidate.kind,
  );
  if (!mode) return null;

  const name = typeof candidate.name === "string" && candidate.name.trim().length > 0
    ? candidate.name.trim()
    : mode === "plan"
      ? "Plan"
      : "Default";

  const model = candidate.model === null
    ? null
    : typeof candidate.model === "string" && candidate.model.trim().length > 0
      ? candidate.model
      : null;

  const rawReasoningEffort = Object.prototype.hasOwnProperty.call(candidate, "reasoningEffort")
    ? candidate.reasoningEffort
    : (
      Object.prototype.hasOwnProperty.call(candidate, "reasoning_effort")
        ? candidate.reasoning_effort
        : undefined
    );
  let reasoningEffort: CodexReasoningEffort | null | undefined;
  if (rawReasoningEffort === null) {
    reasoningEffort = null;
  } else if (rawReasoningEffort === undefined) {
    reasoningEffort = undefined;
  } else {
    reasoningEffort = parseReasoningEffort(rawReasoningEffort);
    if (!reasoningEffort) reasoningEffort = undefined;
  }

  return {
    name,
    mode,
    model,
    reasoningEffort,
  };
}

function parseModelOption(value: unknown): CodexModelOption | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.model !== "string") return null;

  const rawSupportedReasoningEfforts = candidate.supportedReasoningEfforts ?? candidate.supported_reasoning_efforts;
  const supportedReasoningEfforts = Array.isArray(rawSupportedReasoningEfforts)
    ? rawSupportedReasoningEfforts
        .map(parseReasoningEffortOption)
        .filter((option): option is CodexReasoningEffortOption => option !== null)
    : [];

  const defaultReasoningEffort =
    parseReasoningEffort(candidate.defaultReasoningEffort ?? candidate.default_reasoning_effort) ??
    supportedReasoningEfforts[0]?.reasoningEffort ??
    "high";

  return {
    id: candidate.id,
    model: candidate.model,
    displayName:
      typeof candidate.displayName === "string"
        ? candidate.displayName
        : typeof candidate.display_name === "string"
          ? candidate.display_name
          : candidate.id,
    description: typeof candidate.description === "string" ? candidate.description : "",
    hidden: Boolean(candidate.hidden),
    supportedReasoningEfforts,
    defaultReasoningEffort,
    isDefault: Boolean(candidate.isDefault ?? candidate.is_default),
  };
}

export class CodexService extends EventEmitter {
  private readonly logger = codexLogger;
  private readonly client: CodexAppServerClient;
  private readonly rateLimitsPollIntervalMs: number;

  private readonly permissionStateByProject = new Map<string, CodexPermissionState>();
  private readonly collaborationModePresets = new Map<CodexCollaborationModeKind, CodexCollaborationModePreset>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly pendingUserInputs = new Map<string, PendingUserInput>();
  private readonly pendingMcpElicitations = new Map<string, PendingMcpServerElicitation>();
  private readonly conversationRecords = new Map<string, CodexConversationRecord>();
  private readonly lastBroadcastConversationById = new Map<string, CodexConversationSnapshot>();
  private readonly conversationVersionById = new Map<string, number>();
  private readonly queuedFollowUpDispatchInFlight = new Set<string>();
  private readonly frameTextDeltaQueue = new FrameTextDeltaQueue((updates) => {
    this.applyFrameTextDeltas(updates);
  });
  private readonly outputDeltaQueue = new OutputDeltaQueue((updates) => {
    this.applyOutputDeltas(updates);
  });
  private readonly threadTitleState = new CodexThreadTitleStateStore(getKanbanDir());
  private readonly dictationService = new CodexDictationService({
    readConfig: async () => await this.readConfigForDictation(),
    readAuthStatus: async (input) => await this.readAuthStatusForDictation(input),
    requestChatGptDesktop: async (input) => {
      const electron = await import("electron");
      return await requestChatGptDesktop({
        readAuthStatus: async (requestInput) => await this.readAuthStatusForDictation(requestInput),
        fetchImpl: async (url, init) => await electron.net.fetch(url, init),
        getAppVersion: () => electron.app.getVersion(),
      }, input);
    },
  });

  private accountSnapshot: CodexAccountSnapshot = emptyAccountSnapshot();
  private syntheticItemIdCounter = 0;
  private lastConnectionStatus: CodexConnectionState["status"] = "disconnected";
  private threadTitleBackfillPromise: Promise<void> | null = null;
  private rateLimitsPollHandle: ReturnType<typeof setInterval> | null = null;
  private rateLimitsPollInFlight = false;

  constructor(options?: CodexServiceOptions) {
    super();

    const runtime = options?.runtime ?? resolveDefaultCodexRuntime();
    this.rateLimitsPollIntervalMs = options?.rateLimitsPollIntervalMs ?? RATE_LIMITS_POLL_INTERVAL_MS;

    this.client = new CodexAppServerClient({
      binaryPath: runtime.binaryPath,
      additionalSearchPaths: runtime.additionalSearchPaths,
      missingBinaryMessage: runtime.missingBinaryMessage,
      clientInfo: {
        name: "nodex",
        title: "Nodex",
        version: "0.5.0",
      },
    });

    this.client.setServerRequestHandler(async (request) => this.handleServerRequest(request));

    this.client.on("connection", (connection) => {
      const wasConnected = this.lastConnectionStatus === "connected";
      this.lastConnectionStatus = connection.status;
      this.emitEvent({ type: "connection", connection });
      this.syncRateLimitsPolling();
      if (connection.status === "connected") {
        void this.backfillPendingThreadTitles();
      }
      if (connection.status === "connected" && connection.retries > 0 && !wasConnected) {
        this.markConversationsNeedResumeAfterReconnect();
      }
    });

    this.client.on("notification", ({ method, params }: CodexServerNotification) => {
      void this.handleNotification(method, params);
    });

    this.client.on("stderr", (line: string) => {
      if (!line.trim()) return;
      this.logger.warn("Received Codex stderr line", { line });
      this.emitEvent({ type: "error", message: "Codex stderr", detail: line.trim() });
    });

    this.client.on("protocolError", (message: string) => {
      this.logger.error("Received Codex protocol error", { message });
      this.emitEvent({ type: "error", message });
    });
  }

  private emitEvent(event: CodexEvent): void {
    this.emit("event", event);
    this.emitHostMessagesForEvent(event);
  }

  private emitHostMessage(message: CodexHostMessage): void {
    this.emit("hostMessage", message);
  }

  private getNextConversationVersion(threadId: string): number {
    const nextVersion = (this.conversationVersionById.get(threadId) ?? 0) + 1;
    this.conversationVersionById.set(threadId, nextVersion);
    return nextVersion;
  }

  private emitThreadStreamSnapshot(
    threadId: string,
    conversation: CodexConversationSnapshot,
  ): void {
    this.lastBroadcastConversationById.set(threadId, conversation);
    this.emitHostMessage({
      type: "threadStreamStateChanged",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState: conversation,
      },
      version: this.getNextConversationVersion(threadId),
      sourceClientId: null,
    });
  }

  private emitThreadStreamPatches(
    threadId: string,
    conversation: CodexConversationSnapshot,
    patches: ReturnType<typeof convertImmerPatchesToCodexConversationStateUpdates>,
  ): void {
    if (patches.length === 0) {
      return;
    }

    this.lastBroadcastConversationById.set(threadId, conversation);
    this.emitHostMessage({
      type: "threadStreamStateChanged",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: threadId,
      change: {
        type: "patches",
        patches,
      },
      version: this.getNextConversationVersion(threadId),
      sourceClientId: null,
    });
  }

  private mutateBroadcastConversationState(
    threadId: string,
    recipe: (draft: CodexConversationSnapshot) => void | CodexConversationSnapshot,
  ): void {
    const currentConversation = this.lastBroadcastConversationById.get(threadId);
    if (!currentConversation) {
      this.emitThreadStreamSnapshotFromRecord(threadId);
      return;
    }

    try {
      const [nextConversation, patches] = produceWithPatches(currentConversation, recipe);
      this.emitThreadStreamPatches(
        threadId,
        nextConversation,
        convertImmerPatchesToCodexConversationStateUpdates(patches),
      );
    } catch (error) {
      this.logger.warn("Could not mutate broadcast conversation cache directly", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitThreadStreamSnapshotFromRecord(threadId);
    }
  }

  private emitThreadStreamSnapshotFromRecord(threadId: string): void {
    try {
      const conversation = this.serializeConversationSnapshot(threadId);
      if (!conversation) return;
      this.emitThreadStreamSnapshot(threadId, conversation);
    } catch (error) {
      this.logger.warn("Could not serialize conversation snapshot for host message", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private applyBroadcastConversationSummary(
    draft: CodexConversationSnapshot,
    detail: CodexThreadDetail,
  ): void {
    draft.projectId = detail.projectId;
    draft.cardId = detail.cardId;
    draft.threadName = detail.threadName;
    draft.threadPreview = detail.threadPreview;
    draft.modelProvider = detail.modelProvider;
    draft.cwd = detail.cwd;
    draft.statusType = detail.statusType;
    draft.statusActiveFlags = [...detail.statusActiveFlags];
    draft.archived = detail.archived;
    draft.createdAt = detail.createdAt;
    draft.updatedAt = detail.updatedAt;
    draft.linkedAt = detail.linkedAt;
    draft.latestCollaborationMode = detail.latestCollaborationMode;
    draft.resumeState = this.resolveConversationResumeState(detail.threadId);
  }

  private replaceBroadcastConversationTurn(
    draft: CodexConversationSnapshot,
    turnId: string,
    nextTurn: CodexConversationSnapshot["turns"][number] | null,
  ): void {
    const existingIndex = draft.turns.findIndex((turn) => turn.turnId === turnId);
    if (!nextTurn) {
      if (existingIndex >= 0) {
        draft.turns.splice(existingIndex, 1);
      }
      return;
    }

    if (existingIndex >= 0) {
      draft.turns[existingIndex] = nextTurn;
      return;
    }

    draft.turns.push(nextTurn);
  }

  private syncBroadcastConversation(threadId: string, options: BroadcastConversationSyncOptions): void {
    const requiresDetail = Boolean(
      options.turnId
      || options.syncDetail
      || options.syncCapabilityFlags
      || options.syncChildMemberships,
    );
    const detail = requiresDetail ? this.serializeThreadDetail(threadId) : null;
    if (requiresDetail && !detail) {
      this.emitThreadStreamSnapshotFromRecord(threadId);
      return;
    }

    const requests = options.syncRequests || options.syncCapabilityFlags
      ? this.listPendingConversationRequests(threadId)
      : null;
    const queuedFollowUps = options.syncQueuedFollowUps ? this.listQueuedFollowUps(threadId) : null;
    const pendingSteers = options.syncPendingSteers ? this.listPendingSteers(threadId) : null;
    const nextTurn = options.turnId && detail
      ? (() => {
          const turn = detail.turns.find((candidate) => candidate.turnId === options.turnId);
          return turn ? buildCodexConversationTurn(detail, turn) : null;
        })()
      : null;
    const latestCollaborationMode = options.syncLatestCollaborationMode
      ? this.getConversationRecord(threadId).latestCollaborationMode
      : null;

    this.mutateBroadcastConversationState(threadId, (draft) => {
      if (detail && (options.syncDetail || options.turnId)) {
        this.applyBroadcastConversationSummary(draft, detail);
      }
      if (options.turnId) {
        this.replaceBroadcastConversationTurn(draft, options.turnId, nextTurn);
      }
      if (requests) {
        draft.requests = requests;
      }
      if (queuedFollowUps) {
        draft.queuedFollowUps = queuedFollowUps;
      }
      if (pendingSteers) {
        draft.pendingSteers = pendingSteers;
      }
      if (latestCollaborationMode) {
        draft.latestCollaborationMode = latestCollaborationMode;
      }
      if (detail && options.syncCapabilityFlags) {
        draft.capabilityFlags = this.buildConversationCapabilityFlags(detail, requests ?? draft.requests);
      }
      if (options.syncBackgroundTerminalRows) {
        draft.backgroundTerminalRows = this.deriveConversationBackgroundTerminalRows(draft);
      }
      if (options.syncChildMemberships) {
        draft.childMemberships = this.deriveConversationChildMemberships(draft, new Set([threadId]));
      }
    });
  }

  private syncBroadcastConversationSummary(
    threadId: string,
    options?: { syncCapabilityFlags?: boolean },
  ): void {
    this.syncBroadcastConversation(threadId, {
      syncDetail: true,
      syncCapabilityFlags: options?.syncCapabilityFlags ?? false,
    });
  }

  private syncBroadcastConversationRequests(
    threadId: string,
    options?: { syncCapabilityFlags?: boolean },
  ): void {
    this.syncBroadcastConversation(threadId, {
      syncRequests: true,
      syncCapabilityFlags: options?.syncCapabilityFlags ?? false,
    });
  }

  private syncBroadcastConversationTurnState(
    threadId: string,
    turnId: string,
    options?: {
      syncRequests?: boolean;
      syncCapabilityFlags?: boolean;
      syncBackgroundTerminalRows?: boolean;
      syncChildMemberships?: boolean;
    },
  ): void {
    this.syncBroadcastConversation(threadId, {
      turnId,
      syncRequests: options?.syncRequests ?? false,
      syncCapabilityFlags: options?.syncCapabilityFlags ?? false,
      syncBackgroundTerminalRows: options?.syncBackgroundTerminalRows ?? false,
      syncChildMemberships: options?.syncChildMemberships ?? false,
    });
  }

  private emitHostMessagesForEvent(event: CodexEvent): void {
    if (event.type === "connection" || event.type === "account" || event.type === "rateLimits") {
      this.emitHostMessage({
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: event.type === "connection"
          ? {
              objectType: "connection",
              objectId: "connection",
              value: event.connection,
            }
          : event.type === "account"
            ? {
                objectType: "account",
                objectId: "account",
                value: event.account,
              }
            : {
                objectType: "rateLimits",
                objectId: "rateLimits",
                value: event.rateLimits,
              },
      });
      return;
    }

    if (event.type === "error") {
      this.emitHostMessage({
        ...event,
        hostId: DEFAULT_CODEX_HOST_ID,
      });
      return;
    }

    if (event.type === "threadSummary") {
      if (event.thread.threadName?.trim()) {
        this.emitThreadTitleUpdated(event.thread.threadId, event.thread.threadName);
      }
      this.emitHostMessage({
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: {
          objectType: "threadSummary",
          objectId: event.thread.threadId,
          value: event.thread,
        },
      });
      return;
    }

    if (event.type === "threadStartProgress") {
      this.emitHostMessage({
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: {
          objectType: "threadStartProgress",
          objectId: `${event.projectId}:${event.cardId}`,
          value: {
            projectId: event.projectId,
            cardId: event.cardId,
            phase: event.phase,
            message: event.message,
            stream: event.stream,
            outputDelta: event.outputDelta,
            clearOutput: event.clearOutput,
            updatedAt: event.updatedAt,
          },
        },
      });
    }
  }

  private emitThreadStreamSnapshots(threadIds?: string[]): void {
    const nextThreadIds = (threadIds ?? listCodexThreadLinks({ includeArchived: true }).map((thread) => thread.threadId))
      .filter((threadId, index, values) => threadId.length > 0 && values.indexOf(threadId) === index);
    for (const threadId of nextThreadIds) {
      this.emitThreadStreamSnapshotFromRecord(threadId);
    }
  }

  private buildDefaultCollaborationModeState(): CodexCollaborationModeState {
    const preset = this.collaborationModePresets.get("default");
    return {
      mode: "default",
      settings: {
        model: preset?.model ?? "gpt-5.2-codex",
        reasoning_effort: preset?.reasoningEffort ?? "medium",
        developer_instructions: null,
      },
    };
  }

  private buildCollaborationModeState(input: {
    collaborationMode?: CodexCollaborationModeKind | null;
    model?: string | null;
    reasoningEffort?: CodexReasoningEffort | null;
    fallback?: CodexCollaborationModeState | null;
  }): CodexCollaborationModeState {
    const fallback = input.fallback ?? this.buildDefaultCollaborationModeState();
    const mode = input.collaborationMode ?? fallback.mode;
    const preset = this.collaborationModePresets.get(mode);
    const modelCandidate = input.model ?? preset?.model ?? fallback.settings.model;
    const model = typeof modelCandidate === "string" && modelCandidate.trim().length > 0
      ? modelCandidate.trim()
      : fallback.settings.model;
    const presetReasoningEffort = preset?.reasoningEffort;
    const reasoningEffort = input.reasoningEffort !== undefined
      ? input.reasoningEffort
      : presetReasoningEffort !== undefined
        ? presetReasoningEffort
        : fallback.settings.reasoning_effort;

    return {
      mode,
      settings: {
        model,
        reasoning_effort: reasoningEffort ?? null,
        developer_instructions: null,
      },
    };
  }

  private setLatestCollaborationModeForThread(
    threadId: string,
    latestCollaborationMode: CodexCollaborationModeState,
  ): void {
    const record = this.ensureConversationRecord(threadId);
    record.latestCollaborationMode = latestCollaborationMode;
    if (!record.detail) {
      return;
    }

    record.detail = {
      ...record.detail,
      latestCollaborationMode,
    };
  }

  private setThreadPermissionFields(
    threadId: string,
    fields: Pick<CodexThreadSummary, "approvalPolicy" | "approvalsReviewer" | "sandbox">,
  ): void {
    const record = this.ensureConversationRecord(threadId);
    const nextFields = {
      approvalPolicy: fields.approvalPolicy ?? null,
      approvalsReviewer: fields.approvalsReviewer ?? null,
      sandbox: fields.sandbox ?? null,
    };

    if (record.detail) {
      record.detail = {
        ...record.detail,
        ...nextFields,
      };
      return;
    }

    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return;
    record.detail = {
      ...detail,
      ...nextFields,
    };
  }

  private applyThreadPermissionState(
    threadId: string,
    permissionState: CodexPermissionState,
  ): void {
    this.setThreadPermissionFields(threadId, {
      approvalPolicy: permissionState.approvalPolicy,
      approvalsReviewer: permissionState.approvalsReviewer,
      sandbox: permissionState.sandbox,
    });
  }

  private createConversationRecord(): CodexConversationRecord {
    return {
      detail: null,
      itemsByTurn: new Map<string, Map<string, CodexItemView>>(),
      planImplementationRequestsByTurnId: new Map<string, CodexPlanImplementationServerRequest>(),
      queuedFollowUps: [],
      pendingSteers: [],
      latestCollaborationMode: this.buildDefaultCollaborationModeState(),
      resumeState: "resumed",
      streamRole: null,
      isStreaming: false,
    };
  }

  private getMaybeConversationRecord(threadId: string): CodexConversationRecord | null {
    return this.conversationRecords.get(threadId) ?? null;
  }

  private ensureConversationRecord(threadId: string): CodexConversationRecord {
    const existing = this.getMaybeConversationRecord(threadId);
    if (existing) return existing;
    const created = this.createConversationRecord();
    this.conversationRecords.set(threadId, created);
    return created;
  }

  private getConversationRecord(threadId: string): CodexConversationRecord {
    return this.ensureConversationRecord(threadId);
  }

  private getThreadLinkSafely(threadId: string) {
    try {
      return getCodexCardThreadLink(threadId);
    } catch (error) {
      if (isUnavailableSqliteBindingError(error)) return null;
      throw error;
    }
  }

  private ensureConversationDetail(threadId: string): CodexThreadDetail | null {
    const record = this.ensureConversationRecord(threadId);
    if (record.detail) return record.detail;

    const link = this.getThreadLinkSafely(threadId);
    record.detail = link
      ? {
          ...link,
          threadName: link.threadName,
          threadPreview: link.threadPreview,
          cwd: link.cwd,
          latestCollaborationMode: record.latestCollaborationMode,
          turns: [],
          transcript: [],
        }
      : {
          threadId,
          projectId: "",
          cardId: "",
          source: null,
          threadName: null,
          threadPreview: "",
          modelProvider: "",
          cwd: null,
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 0,
          updatedAt: 0,
          linkedAt: new Date(0).toISOString(),
          latestCollaborationMode: record.latestCollaborationMode,
          turns: [],
          transcript: [],
        };
    return record.detail;
  }

  private setConversationResumeState(threadId: string, resumeState: CodexConversationResumeState): void {
    const record = this.getConversationRecord(threadId);
    record.resumeState = resumeState;
  }

  private resolveConversationResumeState(threadId: string): CodexConversationResumeState {
    return this.getMaybeConversationRecord(threadId)?.resumeState ?? "resumed";
  }

  private markAllConversationRecordsNeedResumeAfterReconnect(): void {
    const knownThreadIds = new Set<string>([
      ...listCodexThreadLinks({ includeArchived: true }).map((thread) => thread.threadId),
      ...this.conversationRecords.keys(),
    ]);

    for (const threadId of knownThreadIds) {
      if (!threadId) continue;
      const record = this.ensureConversationRecord(threadId);
      record.resumeState = "needs_resume";
      record.streamRole = null;
      record.isStreaming = false;
    }

    this.emitThreadStreamSnapshots(Array.from(knownThreadIds));
  }

  private markConversationsNeedResumeAfterReconnect(): void {
    this.markAllConversationRecordsNeedResumeAfterReconnect();
  }

  private buildComposerIntent(prompt: string): CodexComposerIntent {
    return {
      prompt,
      focusNonce: Date.now(),
    };
  }

  private pruneThreadTransientState(threadId: string, retainedTurnIds: ReadonlySet<string>): void {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return;
    record.queuedFollowUps = [];

    const nextSteers = this.listPendingSteers(threadId).filter((steer) => retainedTurnIds.has(steer.turnId));
    record.pendingSteers = nextSteers;
  }

  private clearThreadPendingRequestsForRemovedTurns(threadId: string, retainedTurnIds: ReadonlySet<string>): void {
    for (const [requestId, pending] of [...this.pendingApprovals.entries()]) {
      if (pending.request.threadId !== threadId) continue;
      if (retainedTurnIds.has(pending.request.turnId)) continue;
      pending.reject(new Error("Approval request cleared after thread history changed"));
      this.pendingApprovals.delete(requestId);
    }

    for (const [requestId, pending] of [...this.pendingUserInputs.entries()]) {
      if (pending.request.threadId !== threadId) continue;
      if (retainedTurnIds.has(pending.request.turnId)) continue;
      pending.reject(new Error("User input request cleared after thread history changed"));
      this.pendingUserInputs.delete(requestId);
    }

    for (const [requestId, pending] of [...this.pendingMcpElicitations.entries()]) {
      if (pending.request.threadId !== threadId) continue;
      if (retainedTurnIds.has(pending.request.turnId)) continue;
      pending.reject(new Error("MCP elicitation cleared after thread history changed"));
      this.pendingMcpElicitations.delete(requestId);
    }
  }

  private listQueuedFollowUps(threadId: string): CodexQueuedFollowUp[] {
    return [...(this.getMaybeConversationRecord(threadId)?.queuedFollowUps ?? [])]
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private listPendingSteers(threadId: string): CodexPendingSteer[] {
    return [...(this.getMaybeConversationRecord(threadId)?.pendingSteers ?? [])]
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private clearPausedQueuedFollowUps(threadId: string, broadcast = true): void {
    const existing = this.listQueuedFollowUps(threadId);
    if (existing.length === 0) return;

    let changed = false;
    const nextEntries = existing.map((followUp) => {
      if (!followUp.pausedReason) return followUp;
      changed = true;
      return {
        ...followUp,
        pausedReason: null,
      };
    });

    if (!changed) return;
    this.ensureConversationRecord(threadId).queuedFollowUps = nextEntries;
    if (!broadcast) return;
    this.syncBroadcastConversation(threadId, {
      syncQueuedFollowUps: true,
    });
  }

  private hasActiveTurn(threadId: string): boolean {
    return this.listKnownTurns(threadId).some((turn) => turn.status === "inProgress");
  }

  private canDispatchQueuedFollowUp(threadId: string): boolean {
    if (this.queuedFollowUpDispatchInFlight.has(threadId)) return false;
    if (this.hasActiveTurn(threadId)) return false;

    const nextFollowUp = this.listQueuedFollowUps(threadId)[0];
    if (!nextFollowUp) return false;
    if (nextFollowUp.pausedReason) return false;

    return true;
  }

  private maybeDispatchQueuedFollowUp(threadId: string): void {
    if (!this.canDispatchQueuedFollowUp(threadId)) return;

    this.queuedFollowUpDispatchInFlight.add(threadId);
    void this.dispatchNextQueuedFollowUp(threadId).finally(() => {
      this.queuedFollowUpDispatchInFlight.delete(threadId);
    });
  }

  private async dispatchNextQueuedFollowUp(threadId: string): Promise<void> {
    if (this.hasActiveTurn(threadId)) return;

    const nextFollowUp = this.listQueuedFollowUps(threadId)[0];
    if (!nextFollowUp || nextFollowUp.pausedReason) return;

    this.dequeueQueuedFollowUp(threadId, nextFollowUp.followUpId);
    try {
      await this.submitQueuedFollowUp(threadId, nextFollowUp);
    } catch (error) {
      this.restoreQueuedFollowUp(
        threadId,
        nextFollowUp,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private enqueueQueuedFollowUp(
    threadId: string,
    prompt: string,
    collaborationMode?: CodexCollaborationModeKind | null,
    serviceTier?: CodexServiceTier,
  ): string {
    const followUpId = `follow-up:${threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const nextEntries = [
      ...this.listQueuedFollowUps(threadId),
      {
        followUpId,
        threadId,
        prompt,
        createdAt: Date.now(),
        collaborationMode: collaborationMode ?? null,
        serviceTier: normalizeCodexServiceTier(serviceTier),
        pausedReason: null,
      },
    ];
    this.ensureConversationRecord(threadId).queuedFollowUps = nextEntries;
    this.syncBroadcastConversation(threadId, {
      syncQueuedFollowUps: true,
    });
    return followUpId;
  }

  private dequeueQueuedFollowUp(threadId: string, followUpId: string): void {
    const nextEntries = this.listQueuedFollowUps(threadId).filter((followUp) => followUp.followUpId !== followUpId);
    if (nextEntries.length === 0) {
      this.ensureConversationRecord(threadId).queuedFollowUps = [];
    } else {
      this.ensureConversationRecord(threadId).queuedFollowUps = nextEntries;
    }
    this.syncBroadcastConversation(threadId, {
      syncQueuedFollowUps: true,
    });
  }

  private getQueuedFollowUp(threadId: string, followUpId: string): CodexQueuedFollowUp | null {
    return this.listQueuedFollowUps(threadId).find((followUp) => followUp.followUpId === followUpId) ?? null;
  }

  private restoreQueuedFollowUp(
    threadId: string,
    followUp: CodexQueuedFollowUp,
    reason?: string | null,
  ): void {
    const existing = this.listQueuedFollowUps(threadId).filter((entry) => entry.followUpId !== followUp.followUpId);
    this.ensureConversationRecord(threadId).queuedFollowUps = [
      {
        ...followUp,
        pausedReason: reason ?? null,
      },
      ...existing,
    ];
    this.syncBroadcastConversation(threadId, {
      syncQueuedFollowUps: true,
    });
  }

  removeQueuedFollowUp(threadId: string, followUpId: string): void {
    if (!this.getQueuedFollowUp(threadId, followUpId)) return;
    this.dequeueQueuedFollowUp(threadId, followUpId);
  }

  reorderQueuedFollowUps(threadId: string, orderedFollowUpIds: string[]): void {
    const existing = this.listQueuedFollowUps(threadId);
    if (existing.length <= 1) return;

    const byId = new Map(existing.map((followUp) => [followUp.followUpId, followUp]));
    const ordered = orderedFollowUpIds
      .map((followUpId) => byId.get(followUpId) ?? null)
      .filter((followUp): followUp is CodexQueuedFollowUp => followUp !== null);
    const seen = new Set(ordered.map((followUp) => followUp.followUpId));
    const nextEntries = [...ordered, ...existing.filter((followUp) => !seen.has(followUp.followUpId))];

    this.ensureConversationRecord(threadId).queuedFollowUps = nextEntries;
    this.syncBroadcastConversation(threadId, {
      syncQueuedFollowUps: true,
    });
  }

  async enqueueQueuedFollowUpPrompt(
    threadId: string,
    prompt: string,
    overrides?: StartTurnOverrides,
  ): Promise<void> {
    const promptText = prompt.trim();
    if (!promptText) {
      throw new Error("Queued follow-up requires a non-empty prompt");
    }

    this.enqueueQueuedFollowUp(
      threadId,
      promptText,
      overrides?.collaborationMode,
      overrides?.serviceTier,
    );
  }

  private recordPendingSteer(threadId: string, turnId: string, prompt: string): string {
    const steerId = `steer:${threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const nextEntries = [
      ...this.listPendingSteers(threadId),
      {
        steerId,
        threadId,
        turnId,
        prompt,
        createdAt: Date.now(),
      },
    ];
    this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    this.syncBroadcastConversation(threadId, {
      syncPendingSteers: true,
    });
    return steerId;
  }

  private clearPendingSteer(threadId: string, steerId: string): void {
    const nextEntries = this.listPendingSteers(threadId).filter((steer) => steer.steerId !== steerId);
    if (nextEntries.length === 0) {
      this.ensureConversationRecord(threadId).pendingSteers = [];
    } else {
      this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    }
    this.syncBroadcastConversation(threadId, {
      syncPendingSteers: true,
    });
  }

  private clearPendingSteerForConsumedPrompt(threadId: string, turnId: string, prompt: string): void {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;

    const nextEntries = this.listPendingSteers(threadId);
    const matchIndex = nextEntries.findIndex((steer) =>
      steer.turnId === turnId && steer.prompt.trim() === normalizedPrompt
    );
    if (matchIndex < 0) return;

    nextEntries.splice(matchIndex, 1);
    this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    this.syncBroadcastConversation(threadId, {
      syncPendingSteers: true,
    });
  }

  private clearPendingSteersForTurn(threadId: string, turnId: string, broadcast = true): void {
    const nextEntries = this.listPendingSteers(threadId).filter((steer) => steer.turnId !== turnId);
    if (nextEntries.length === this.listPendingSteers(threadId).length) return;
    this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    if (!broadcast) return;
    this.syncBroadcastConversation(threadId, {
      syncPendingSteers: true,
    });
  }

  private async submitQueuedFollowUp(threadId: string, followUp: CodexQueuedFollowUp): Promise<void> {
    const knownTurns = this.listKnownTurns(threadId);
    let activeTurnId: string | null = null;
    for (let index = knownTurns.length - 1; index >= 0; index -= 1) {
      const turn = knownTurns[index];
      if (turn?.status !== "inProgress") continue;
      activeTurnId = turn.turnId;
      break;
    }

    try {
      if (activeTurnId) {
        await this.steerTurn(threadId, activeTurnId, followUp.prompt);
        return;
      }

      await this.startTurn(threadId, followUp.prompt, {
        collaborationMode: followUp.collaborationMode ?? undefined,
        serviceTier: followUp.serviceTier,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.restoreQueuedFollowUp(threadId, followUp, message);
      throw error;
    }
  }

  private emitThreadStartProgress(input: {
    projectId: string;
    cardId: string;
    phase: CodexThreadStartProgressPhase;
    message: string;
    stream?: CodexThreadStartProgressStream;
    outputDelta?: string;
    clearOutput?: boolean;
  }): void {
    this.emitEvent({
      type: "threadStartProgress",
      projectId: input.projectId,
      cardId: input.cardId,
      phase: input.phase,
      message: input.message,
      stream: input.stream,
      outputDelta: input.outputDelta,
      clearOutput: input.clearOutput,
      updatedAt: Date.now(),
    });
  }

  private async readPermissionState(projectId: string | null): Promise<CodexPermissionState> {
    if (!projectId) {
      return {
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
    }

    const cached = this.permissionStateByProject.get(projectId);
    if (cached) {
      return cached;
    }

    let workspacePath: string | null = null;
    try {
      const project = dbService.getProject(projectId);
      workspacePath = project?.workspacePath?.trim() || null;
    } catch (error) {
      if (!isUnavailableSqliteBindingError(error)) {
        throw error;
      }
    }

    try {
      await this.ensureClientReady();

      const [configResult, requirementsResult] = await Promise.all([
        this.client.request<"config/read", ConfigReadResponse>("config/read", {
          includeLayers: true,
        } satisfies ConfigReadParams),
        this.client.request<"configRequirements/read", ConfigRequirementsReadResponse>("configRequirements/read", undefined),
      ]);

      const nextState = resolveCodexPermissionState({
        config: configResult.config,
        origins: configResult.origins,
        requirements: requirementsResult.requirements,
        defaultUserConfigPath: path.join(resolveCodexHomeDir(), "config.toml"),
        workspacePath,
      });
      this.permissionStateByProject.set(projectId, nextState);
      return nextState;
    } catch {
      const fallbackState = this.buildFallbackPermissionState(
        this.permissionStateByProject.get(projectId)?.mode ?? "auto",
        workspacePath,
        this.permissionStateByProject.get(projectId) ?? null,
      );
      this.permissionStateByProject.set(projectId, fallbackState);
      return fallbackState;
    }
  }

  private buildFallbackPermissionState(
    mode: CodexPermissionMode,
    workspacePath: string | null,
    previous: CodexPermissionState | null,
  ): CodexPermissionState {
    const configTarget = previous?.configTarget ?? {
      source: "user" as const,
      filePath: path.join(resolveCodexHomeDir(), "config.toml"),
    };

    if (mode === "custom") {
      return {
        mode: "custom",
        effectivePreset: "custom",
        availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
        approvalPolicy: previous?.approvalPolicy ?? null,
        approvalsReviewer: previous?.approvalsReviewer ?? "user",
        sandboxMode: previous?.sandboxMode ?? null,
        sandbox: previous?.sandbox ?? null,
        guardianApprovalEnabled: previous?.guardianApprovalEnabled ?? false,
        configTarget,
        customDescription: previous?.customDescription ?? "Codex will use its built-in permission defaults.",
      };
    }

    const guardianApprovalEnabled = previous?.guardianApprovalEnabled ?? true;
    const approvalsReviewer = mode === "guardian-approvals" && guardianApprovalEnabled
      ? "auto_review"
      : "user";
    const sandbox = mode === "full-access"
      ? { type: "dangerFullAccess" as const }
      : workspacePath
        ? {
            type: "workspaceWrite" as const,
            writableRoots: [workspacePath],
            readOnlyAccess: { type: "fullAccess" as const },
            networkAccess: previous?.sandbox?.type === "workspaceWrite"
              ? previous.sandbox.networkAccess
              : false,
            excludeTmpdirEnvVar: previous?.sandbox?.type === "workspaceWrite"
              ? previous.sandbox.excludeTmpdirEnvVar
              : false,
            excludeSlashTmp: previous?.sandbox?.type === "workspaceWrite"
              ? previous.sandbox.excludeSlashTmp
              : false,
          }
        : null;

    return {
      mode,
      effectivePreset: mode === "guardian-approvals" && !guardianApprovalEnabled ? "auto" : mode,
      availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
      approvalPolicy: mode === "full-access" ? "never" : "on-request",
      approvalsReviewer,
      sandboxMode: mode === "full-access" ? "danger-full-access" : "workspace-write",
      sandbox,
      guardianApprovalEnabled,
      configTarget,
      customDescription: previous?.customDescription ?? "Codex will use its built-in permission defaults.",
    };
  }

  private resolvePermissionStateForRequest(
    permissionState: CodexPermissionState,
    mode: CodexPermissionMode | undefined,
    workspacePath: string | null,
  ): CodexPermissionState {
    if (!mode || mode === permissionState.mode) {
      return permissionState;
    }

    return this.buildFallbackPermissionState(mode, workspacePath, permissionState);
  }

  private invalidatePermissionState(projectId: string | null): void {
    if (!projectId) return;
    this.permissionStateByProject.delete(projectId);
  }

  async getPermissionState(projectId: string): Promise<CodexPermissionState> {
    return await this.readPermissionState(projectId);
  }

  async getCustomPermissionModeDescription(projectId: string): Promise<string> {
    const state = await this.readPermissionState(projectId);
    return state.customDescription ?? "Codex will use its built-in permission defaults.";
  }

  async setProjectPermissionMode(projectId: string, mode: CodexPermissionMode): Promise<CodexPermissionState> {
    const current = await this.readPermissionState(projectId);
    if (!current.availableModes.includes(mode)) {
      return current;
    }

    const edits = buildPermissionModeConfigEdits(mode);
    if (edits.length === 0) {
      const nextState = this.buildFallbackPermissionState(mode, null, current);
      this.permissionStateByProject.set(projectId, nextState);
      return nextState;
    }

    const params: ConfigBatchWriteParams = {
      edits,
      filePath: current.configTarget.filePath,
      reloadUserConfig: current.configTarget.source === "user",
    };
    try {
      await this.client.request("config/batchWrite", params);
    } catch {
      const nextState = this.buildFallbackPermissionState(mode, null, current);
      this.permissionStateByProject.set(projectId, nextState);
      return nextState;
    }
    this.invalidatePermissionState(projectId);
    const nextState = await this.readPermissionState(projectId);
    if (mode !== "custom" && nextState.mode !== mode) {
      const fallbackState = this.buildFallbackPermissionState(mode, null, nextState);
      this.permissionStateByProject.set(projectId, fallbackState);
      return fallbackState;
    }
    return nextState;
  }

  async setPermissionConfigValue(
    projectId: string,
    keyPath: string,
    value: unknown,
  ): Promise<CodexPermissionState> {
    const current = await this.readPermissionState(projectId);
    try {
      await this.client.request("config/value/write", {
        keyPath,
        value,
        filePath: current.configTarget.filePath,
        reloadUserConfig: current.configTarget.source === "user",
      });
    } catch {
      return current;
    }
    this.invalidatePermissionState(projectId);
    return await this.readPermissionState(projectId);
  }

  async getProjectPermissionMode(projectId: string): Promise<CodexPermissionMode> {
    return (await this.readPermissionState(projectId)).mode;
  }

  getConnectionState() {
    return this.client.getState();
  }

  private shouldPollRateLimits(): boolean {
    if (this.rateLimitsPollIntervalMs <= 0) return false;
    if (this.lastConnectionStatus !== "connected") return false;
    if (this.accountSnapshot.account === null) return false;
    return true;
  }

  private syncRateLimitsPolling(): void {
    if (!this.shouldPollRateLimits()) {
      this.stopRateLimitsPolling();
      return;
    }

    if (this.rateLimitsPollHandle !== null) {
      return;
    }

    this.rateLimitsPollHandle = setInterval(() => {
      void this.pollRateLimits();
    }, this.rateLimitsPollIntervalMs);
  }

  private stopRateLimitsPolling(): void {
    if (this.rateLimitsPollHandle === null) return;
    clearInterval(this.rateLimitsPollHandle);
    this.rateLimitsPollHandle = null;
  }

  private async pollRateLimits(): Promise<void> {
    if (!this.shouldPollRateLimits()) {
      this.stopRateLimitsPolling();
      return;
    }

    if (this.rateLimitsPollInFlight) return;
    this.rateLimitsPollInFlight = true;

    try {
      await this.refreshRateLimitsSnapshot();
    } catch (error) {
      this.logger.debug("Could not refresh Codex rate limits snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.rateLimitsPollInFlight = false;
      if (!this.shouldPollRateLimits()) {
        this.stopRateLimitsPolling();
      }
    }
  }

  private async refreshRateLimitsSnapshot(): Promise<CodexRateLimitsSnapshot | null> {
    const rateLimitResult = await this.client.request<"account/rateLimits/read", GetAccountRateLimitsResponse>(
      "account/rateLimits/read",
    ).catch(() => ({ rateLimits: null, rateLimitsByLimitId: null }));

    const parsed = parseRateLimitsSnapshot(rateLimitResult.rateLimits ?? null);
    this.accountSnapshot = {
      ...this.accountSnapshot,
      rateLimits: parsed,
    };
    this.syncRateLimitsPolling();
    this.emitEvent({ type: "rateLimits", rateLimits: parsed });
    this.emitEvent({ type: "account", account: this.accountSnapshot });
    return parsed;
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Codex service", {
      pendingApprovals: this.pendingApprovals.size,
      pendingUserInputs: this.pendingUserInputs.size,
      pendingMcpElicitations: this.pendingMcpElicitations.size,
    });
    this.frameTextDeltaQueue.cancel();
    this.outputDeltaQueue.cancel();
    this.stopRateLimitsPolling();
    for (const pending of this.pendingApprovals.values()) {
      pending.reject(new Error("Codex service shutting down"));
    }
    this.pendingApprovals.clear();

    for (const pending of this.pendingUserInputs.values()) {
      pending.reject(new Error("Codex service shutting down"));
    }
    this.pendingUserInputs.clear();

    for (const pending of this.pendingMcpElicitations.values()) {
      pending.reject(new Error("Codex service shutting down"));
    }
    this.pendingMcpElicitations.clear();

    await this.client.stop();
  }

  private async ensureClientReady(): Promise<void> {
    await this.client.start();
    await this.backfillPendingThreadTitles();
  }

  async readAccountSnapshot(): Promise<CodexAccountSnapshot> {
    await this.ensureClientReady();

    const accountResult = await this.client.request<"account/read", GetAccountResponse>("account/read", {
      refreshToken: false,
    });

    this.accountSnapshot = {
      account: parseAccountIdentity(accountResult.account ?? null),
      requiresOpenAiAuth: Boolean(accountResult.requiresOpenaiAuth),
      pendingLogin: this.accountSnapshot.pendingLogin ?? null,
      rateLimits: await this.refreshRateLimitsSnapshotForRead(),
    };
    this.syncRateLimitsPolling();

    this.logger.info("Read Codex account snapshot", {
      accountType: this.accountSnapshot.account?.type ?? null,
      requiresOpenAiAuth: this.accountSnapshot.requiresOpenAiAuth,
      hasRateLimits: Boolean(this.accountSnapshot.rateLimits),
    });
    this.emitEvent({ type: "account", account: this.accountSnapshot });
    return this.accountSnapshot;
  }

  private async refreshRateLimitsSnapshotForRead(): Promise<CodexRateLimitsSnapshot | null> {
    const rateLimitResult = await this.client.request<"account/rateLimits/read", GetAccountRateLimitsResponse>(
      "account/rateLimits/read",
    ).catch(() => ({ rateLimits: null, rateLimitsByLimitId: null }));
    return parseRateLimitsSnapshot(rateLimitResult.rateLimits ?? null);
  }

  async startAccountLogin(
    input: { type: "chatgpt" } | { type: "apiKey"; apiKey: string },
  ): Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }> {
    await this.ensureClientReady();

    if (input.type === "apiKey") {
      await this.client.request("account/login/start", {
        type: "apiKey",
        apiKey: input.apiKey,
      });
      await this.readAccountSnapshot();
      return { type: "apiKey" };
    }

    const result = await this.client.request<"account/login/start", LoginAccountResponse>(
      "account/login/start",
      { type: "chatgpt" },
    );

    const response: { type: "chatgpt"; loginId: string; authUrl: string } = {
      type: "chatgpt",
      loginId: result.type === "chatgpt" ? result.loginId : "",
      authUrl: result.type === "chatgpt" ? result.authUrl : "",
    };

    this.accountSnapshot = {
      ...this.accountSnapshot,
      pendingLogin: {
        loginId: response.loginId,
        authUrl: response.authUrl,
      },
    };

    this.emitEvent({ type: "account", account: this.accountSnapshot });
    return response;
  }

  async cancelAccountLogin(loginId: string): Promise<{ status: "canceled" | "notFound" }> {
    await this.ensureClientReady();

    const result = await this.client.request<"account/login/cancel", CancelLoginAccountResponse>("account/login/cancel", {
      loginId,
    });

    if (this.accountSnapshot.pendingLogin?.loginId === loginId) {
      this.accountSnapshot = {
        ...this.accountSnapshot,
        pendingLogin: null,
      };
      this.emitEvent({ type: "account", account: this.accountSnapshot });
    }

    return {
      status: result.status === "canceled" ? "canceled" : "notFound",
    };
  }

  async logoutAccount(): Promise<boolean> {
    await this.ensureClientReady();
    await this.client.request("account/logout");
    this.accountSnapshot = emptyAccountSnapshot();
    this.syncRateLimitsPolling();
    this.emitEvent({ type: "account", account: this.accountSnapshot });
    return true;
  }

  async readDictationStateSnapshot(): Promise<CodexDictationStateSnapshot> {
    await this.ensureClientReady();
    return await this.dictationService.readState();
  }

  async transcribeDictation(input: {
    contentType: string;
    base64Payload: string;
  }): Promise<string> {
    await this.ensureClientReady();
    return await this.dictationService.transcribe(input);
  }

  async listProjectThreads(
    projectId: string,
    opts?: { cardId?: string; includeArchived?: boolean },
  ): Promise<CodexThreadSummary[]> {
    return listCodexProjectThreads(projectId, opts);
  }

  async listWorktreeEnvironments(projectId: string): Promise<WorktreeEnvironmentOption[]> {
    const project = dbService.getProject(projectId);
    const workspacePath = project?.workspacePath?.trim();
    if (!workspacePath) return [];
    try {
      return await listWorktreeEnvironmentOptions(workspacePath);
    } catch {
      return [];
    }
  }

  async listWorktreeEnvironmentConfigs(projectId: string): Promise<WorktreeEnvironmentConfigRecord[]> {
    const project = dbService.getProject(projectId);
    const workspacePath = project?.workspacePath?.trim();
    if (!workspacePath) return [];

    try {
      return await listWorktreeEnvironmentConfigRecords(workspacePath);
    } catch {
      return [];
    }
  }

  async readWorktreeEnvironmentConfig(
    projectId: string,
    configPath?: string | null,
  ): Promise<WorktreeEnvironmentSettingsSnapshot> {
    const project = dbService.getProject(projectId);
    const workspacePath = project?.workspacePath?.trim();
    if (!project || !workspacePath) {
      throw new Error("Project workspace path is required for local environments.");
    }

    return readWorktreeEnvironmentSettingsRecord({
      projectId,
      projectName: project.name,
      workspacePath,
      configPath,
    });
  }

  async saveWorktreeEnvironmentConfig(
    input: UpdateWorktreeEnvironmentConfigInput,
  ): Promise<WorktreeEnvironmentSettingsSnapshot> {
    const project = dbService.getProject(input.projectId);
    const workspacePath = project?.workspacePath?.trim();
    if (!project || !workspacePath) {
      throw new Error("Project workspace path is required for local environments.");
    }

    return saveWorktreeEnvironmentSettingsRecord({
      ...input,
      projectName: project.name,
      workspacePath,
    });
  }

  async listManagedWorktrees(): Promise<ManagedWorktreeRecord[]> {
    const managedRoot = path.resolve(getKanbanDir(), "worktrees");
    const links = listCodexThreadLinks({ includeArchived: true });
    const recordsByPath = links.reduce<Map<string, ManagedWorktreeRecord>>((acc, link) => {
      const cwd = link.cwd?.trim();
      if (!cwd) return acc;

      const resolvedPath = path.resolve(cwd);
      if (!isPathWithin(managedRoot, resolvedPath)) return acc;

      const existing = acc.get(resolvedPath);
      if (existing && !isNewerLinkTime(existing.linkedAt, link.linkedAt)) {
        return acc;
      }

      const project = dbService.getProject(link.projectId);
      const card = dbService.getCardSync(link.projectId, link.cardId);

      acc.set(resolvedPath, {
        threadId: link.threadId,
        projectId: link.projectId,
        projectName: project?.name ?? null,
        cardId: link.cardId,
        cardTitle: card?.title ?? null,
        threadName: link.threadName,
        path: resolvedPath,
        exists: existsSync(resolvedPath),
        linkedAt: link.linkedAt,
      });
      return acc;
    }, new Map<string, ManagedWorktreeRecord>());

    const records = Array.from(recordsByPath.values());

    records.sort((left, right) => right.linkedAt.localeCompare(left.linkedAt));
    return records;
  }

  /** Remove a managed worktree directory. Returns true if deletion was performed. */
  async deleteManagedWorktree(threadId: string): Promise<boolean> {
    const managedRoot = path.resolve(getKanbanDir(), "worktrees");
    const link = this.getThreadLinkSafely(threadId);
    if (!link) return false;

    const cwd = link.cwd?.trim();
    if (!cwd) return false;

    const resolvedPath = path.resolve(cwd);
    if (!isPathWithin(managedRoot, resolvedPath)) return false;

    await removeManagedWorktree(resolvedPath);

    const linkedThreadIds = listCodexThreadLinks({ includeArchived: true })
      .filter((candidate) => {
        const candidateCwd = candidate.cwd?.trim();
        if (!candidateCwd) return false;
        return path.resolve(candidateCwd) === resolvedPath;
      })
      .map((candidate) => candidate.threadId);

    const threadIdsToUnlink = Array.from(new Set([threadId, ...linkedThreadIds]));

    let removedAnyLink = false;
    for (const linkedThreadId of threadIdsToUnlink) {
      removedAnyLink = unlinkCodexThread(linkedThreadId) || removedAnyLink;
    }

    return removedAnyLink;
  }

  async listModels(): Promise<CodexModelOption[]> {
    await this.ensureClientReady();

    const result = await this.client.request<"model/list", ModelListResponse>("model/list", {});

    return result.data
      .map(parseModelOption)
      .filter((option): option is CodexModelOption => option !== null);
  }

  private async readConfigForDictation(): Promise<ConfigReadResponse> {
    return await this.client.request<"config/read", ConfigReadResponse>("config/read", {
      includeLayers: false,
    } satisfies ConfigReadParams);
  }

  private async readAuthStatusForDictation(input: {
    includeToken: boolean;
    refreshToken: boolean;
  }): Promise<GetAuthStatusResponse> {
    return await this.client.request<"getAuthStatus", GetAuthStatusResponse>("getAuthStatus", input);
  }

  async listCollaborationModes(): Promise<CodexCollaborationModePreset[]> {
    await this.ensureClientReady();

    const result = await this.client.request<"collaborationMode/list", CollaborationModeListResponse>("collaborationMode/list", {});
    const presets = result.data
      .map(parseCollaborationModePreset)
      .filter((preset): preset is CodexCollaborationModePreset => preset !== null)
      .filter((preset) => preset.mode === "default" || preset.mode === "plan");

    this.collaborationModePresets.clear();
    for (const preset of presets) {
      if (this.collaborationModePresets.has(preset.mode)) continue;
      this.collaborationModePresets.set(preset.mode, preset);
    }

    return presets;
  }

  private buildCollaborationModePayload(input: {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
  }): { mode: CodexCollaborationModeKind; settings: { model: string; reasoning_effort: CodexReasoningEffort | null; developer_instructions: null } } | null {
    const selectedMode = input.collaborationMode;
    if (!selectedMode) return null;

    const preset = this.collaborationModePresets.get(selectedMode);
    const modelCandidate = input.model ?? preset?.model ?? null;
    const model = typeof modelCandidate === "string" && modelCandidate.trim().length > 0
      ? modelCandidate.trim()
      : null;
    if (!model) return null;
    const reasoningEffort = input.reasoningEffort ?? preset?.reasoningEffort ?? null;

    return {
      mode: selectedMode,
      settings: {
        model,
        reasoning_effort: reasoningEffort,
        developer_instructions: null,
      },
    };
  }

  private async resolveAgentConfigOverrides(
    agentConfigs: CodexPromptAgentConfigInput[],
  ): Promise<PreparedPromptForTurn["agentConfigOverrides"]> {
    const overrides: PreparedPromptForTurn["agentConfigOverrides"] = {};
    let requestedModel: string | null = null;

    for (const config of agentConfigs) {
      const unknownAttributes = config.unknownAttributes ?? [];
      if (unknownAttributes.length > 0) {
        throw new Error(`Unsupported agent config ${unknownAttributes.length === 1 ? "attribute" : "attributes"}: ${unknownAttributes.join(", ")}`);
      }

      if (config.mode !== undefined) {
        const mode = validateCollaborationModeInput(config.mode);
        if (!mode) {
          throw new Error(`Unsupported agent config mode: ${config.mode}`);
        }
        overrides.collaborationMode = mode;
      }

      if (config.reasoning !== undefined) {
        const reasoningEffort = validateReasoningEffortInput(config.reasoning);
        if (!reasoningEffort) {
          throw new Error(`Unsupported agent config reasoning: ${config.reasoning}`);
        }
        overrides.reasoningEffort = reasoningEffort;
      }

      if (config.model !== undefined) {
        requestedModel = config.model;
      }
    }

    if (requestedModel !== null) {
      const models = await this.listModels();
      const visibleModel = models.find((model) =>
        !model.hidden && (model.id === requestedModel || model.model === requestedModel)
      );
      if (!visibleModel) {
        throw new Error(`Unsupported agent config model: ${requestedModel}`);
      }
      overrides.model = visibleModel.id;
    }

    return overrides;
  }

  private resolvePromptImageInput(source: string): CodexUserInputItem {
    const normalizedSource = source.trim();
    if (isSupportedImageUrl(normalizedSource)) {
      return { type: "image", url: normalizedSource };
    }

    const parsedAsset = parseAssetSource(normalizedSource);
    if (parsedAsset) {
      return { type: "localImage", path: resolveAssetPath(parsedAsset.fileName) };
    }

    if (path.isAbsolute(normalizedSource)) {
      return { type: "localImage", path: normalizedSource };
    }

    throw new Error(`Unsupported image source: ${normalizedSource}`);
  }

  private resolvePromptMentionInput(input: { name: string; path: string }): CodexUserInputItem {
    const name = input.name.trim();
    const mentionPath = input.path.trim();
    if (!name || !mentionPath) {
      throw new Error("Mention input requires a name and path");
    }
    return { type: "mention", name, path: mentionPath };
  }

  private resolvePromptSkillInput(input: { name: string; path: string }): CodexUserInputItem {
    const name = input.name.trim();
    const skillPath = input.path.trim();
    if (!name || !skillPath) {
      throw new Error("Skill input requires a name and path");
    }
    return { type: "skill", name, path: skillPath };
  }

  private async preparePromptForTurn(
    prompt: string,
    promptInput?: CodexPromptInput,
  ): Promise<PreparedPromptForTurn> {
    const parsedPrompt = promptInput
      ? {
        text: promptInput.text.trim(),
        agentConfigs: promptInput.agentConfigs ?? [],
      }
      : splitPromptTextAndAgentConfigLines(prompt);
    const promptText = parsedPrompt.text.trim();
    const imageItems = (promptInput?.images ?? []).map((image) => this.resolvePromptImageInput(image.source));
    const mentionItems = (promptInput?.mentions ?? []).map((mention) => this.resolvePromptMentionInput(mention));
    const skillItems = (promptInput?.skills ?? []).map((skill) => this.resolvePromptSkillInput(skill));
    const inputItems: CodexUserInputItem[] = [
      ...(promptText ? [createTextUserInput(promptText)] : []),
      ...imageItems,
      ...mentionItems,
      ...skillItems,
    ];

    if (inputItems.length === 0) {
      throw new Error("Prompt requires non-empty text or at least one image");
    }

    return {
      promptText,
      inputItems,
      agentConfigOverrides: await this.resolveAgentConfigOverrides(parsedPrompt.agentConfigs),
    };
  }

  private parseThreadRef(threadId: string): ThreadRef | null {
    const link = this.getThreadLinkSafely(threadId);
    if (!link) return null;
    return {
      projectId: link.projectId,
      cardId: link.cardId,
      cwd: link.cwd,
    };
  }

  private async resolveThreadRunLocation(input: {
    projectId: string;
    cardId: string;
    threadTitle?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
    onProgress?: (update: ThreadStartProgressUpdate) => void;
  }): Promise<ResolvedThreadRunLocation> {
    const cardRecord = await dbService.getCard(input.projectId, input.cardId);
    if (!cardRecord) {
      throw new Error(`Card '${input.cardId}' not found in project '${input.projectId}'`);
    }

    const runInTarget = cardRecord.runInTarget ?? "localProject";

    if (runInTarget === "cloud") {
      throw new Error("Cloud run target is not available yet. Choose Local project or New worktree.");
    }

    const workspacePath = this.parseWorkspacePath(input.projectId);

    if (runInTarget === "newWorktree") {
      const managedRoot = path.resolve(getKanbanDir(), "worktrees");
      const persistedWorktreePath = cardRecord.runInWorktreePath?.trim();
      if (persistedWorktreePath) {
        const resolvedPersistedPath = path.resolve(persistedWorktreePath);
        if (isPathWithin(managedRoot, resolvedPersistedPath) && existsSync(resolvedPersistedPath)) {
          return {
            cwd: resolvedPersistedPath,
            runInTarget,
            createdManagedWorktree: false,
          };
        }
      }

      input.onProgress?.({
        phase: "creatingWorktree",
        message: WORKTREE_LOG_STATUS_MESSAGE,
        clearOutput: true,
      });
      input.onProgress?.({
        phase: "creatingWorktree",
        message: WORKTREE_LOG_STATUS_MESSAGE,
        stream: "info",
        outputDelta: "[info] Starting worktree creation\n",
      });

      const createdWorktree = await createManagedWorktree({
        repositoryPath: workspacePath,
        serverDir: getKanbanDir(),
        projectId: input.projectId,
        cardId: input.cardId,
        threadTitle: input.threadTitle?.trim() || cardRecord.title.trim() || cardRecord.id,
        branchPrefix: input.worktreeBranchPrefix,
        preferredBaseBranch: cardRecord.runInBaseBranch ?? null,
        mode: input.worktreeStartMode ?? "detachedHead",
        onLog: (output) => {
          if (!output.data) return;
          input.onProgress?.({
            phase: "creatingWorktree",
            message: WORKTREE_LOG_STATUS_MESSAGE,
            stream: output.stream,
            outputDelta: output.data,
          });
        },
      });
      const resolvedWorktreePath = path.resolve(createdWorktree.cwd);
      input.onProgress?.({
        phase: "creatingWorktree",
        message: WORKTREE_LOG_STATUS_MESSAGE,
        stream: "info",
        outputDelta: `Worktree created at ${resolvedWorktreePath}\n`,
      });

      const selectedEnvironmentPath = cardRecord.runInEnvironmentPath?.trim() || null;
      if (selectedEnvironmentPath) {
        try {
          const environmentDefinition = await readWorktreeEnvironmentDefinition({
            workspacePath,
            environmentPath: selectedEnvironmentPath,
          });
          if (environmentDefinition.setupScript) {
            input.onProgress?.({
              phase: "runningSetup",
              message: WORKTREE_LOG_STATUS_MESSAGE,
              stream: "info",
              outputDelta: `Running setup script ${environmentDefinition.path}\n`,
            });
            await runWorktreeSetupScript({
              script: environmentDefinition.setupScript,
              cwd: resolvedWorktreePath,
              onOutput: (output) => {
                if (!output.data) return;
                input.onProgress?.({
                  phase: "runningSetup",
                  message: WORKTREE_LOG_STATUS_MESSAGE,
                  stream: output.stream,
                  outputDelta: output.data,
                });
              },
            });
            input.onProgress?.({
              phase: "runningSetup",
              message: WORKTREE_LOG_STATUS_MESSAGE,
              stream: "info",
              outputDelta: "Setup script completed\n",
            });
          }
        } catch (error) {
          await removeManagedWorktree(resolvedWorktreePath).catch(() => undefined);
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to set up new worktree using environment '${selectedEnvironmentPath}': ${errorMessage}`,
          );
        }
      }

      const updated = await dbService.updateCard(
        input.projectId,
        cardRecord.status,
        input.cardId,
        { runInWorktreePath: resolvedWorktreePath },
      );
      if (updated.status !== "updated") {
        await removeManagedWorktree(resolvedWorktreePath).catch(() => undefined);
        throw new Error(`Card '${input.cardId}' no longer exists while persisting managed worktree path`);
      }
      return {
        cwd: resolvedWorktreePath,
        runInTarget,
        createdManagedWorktree: true,
      };
    }

    const localOverride = cardRecord.runInLocalPath?.trim();
    if (!localOverride) {
      return {
        cwd: workspacePath,
        runInTarget: "localProject",
        createdManagedWorktree: false,
      };
    }

    const resolvedLocalPath = path.isAbsolute(localOverride)
      ? localOverride
      : path.resolve(workspacePath, localOverride);
    if (!existsSync(resolvedLocalPath)) {
      throw new Error(`Run-in local folder does not exist: ${resolvedLocalPath}`);
    }

    return {
      cwd: resolvedLocalPath,
      runInTarget: "localProject",
      createdManagedWorktree: false,
    };
  }

  private asTurnSummary(threadId: string, turn: unknown): CodexTurnSummary | null {
    if (typeof turn !== "object" || turn === null) return null;
    const candidate = turn as Record<string, unknown>;
    if (typeof candidate.id !== "string") return null;

    const items = Array.isArray(candidate.items) ? candidate.items : [];
    const itemIds = items
      .map((item) => {
        if (typeof item !== "object" || item === null) return null;
        const i = item as Record<string, unknown>;
        return typeof i.id === "string" ? i.id : null;
      })
      .filter((value): value is string => Boolean(value));

    const errorMessage =
      typeof candidate.error === "object" && candidate.error !== null
        ? typeof (candidate.error as Record<string, unknown>).message === "string"
          ? (candidate.error as Record<string, unknown>).message as string
          : undefined
        : undefined;
    const tokenUsage = parseCodexThreadTokenUsage(candidate.tokenUsage ?? candidate.token_usage);
    const interruptedCommandExecutionItemIds = Array.isArray(candidate.interruptedCommandExecutionItemIds)
      ? candidate.interruptedCommandExecutionItemIds.filter((value): value is string => typeof value === "string")
      : Array.isArray(candidate.interrupted_command_execution_item_ids)
        ? candidate.interrupted_command_execution_item_ids.filter((value): value is string => typeof value === "string")
        : [];
    const startedAt = normalizeOptionalTimestamp(candidate.startedAt ?? candidate.started_at);
    const completedAt = normalizeOptionalTimestamp(candidate.completedAt ?? candidate.completed_at);
    const turnStartedAtMs =
      normalizeOptionalTimestamp(candidate.turnStartedAtMs ?? candidate.turn_started_at_ms) ?? startedAt;
    const finalAssistantStartedAtMs =
      normalizeOptionalTimestamp(candidate.finalAssistantStartedAtMs ?? candidate.final_assistant_started_at_ms)
      ?? completedAt;

    return {
      threadId,
      turnId: candidate.id,
      status: makeTurnStatus(candidate.status),
      errorMessage,
      diff: parseTurnDiff(candidate),
      itemIds,
      turnStartedAtMs,
      finalAssistantStartedAtMs,
      startedAt,
      completedAt,
      durationMs: getFiniteNumber(candidate.durationMs ?? candidate.duration_ms) ?? null,
      interruptedCommandExecutionItemIds,
      tokenUsage,
    };
  }

  private mergeTurn(
    threadId: string,
    turn: CodexTurnSummary,
    options?: { preferIncomingFinalAssistantStartedAtMs?: boolean },
  ): void {
    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return;

    const existing = detail.turns.find((candidate) => candidate.turnId === turn.turnId);
    if (!existing) {
      detail.turns = [...detail.turns, turn];
      return;
    }

    const mergedItemIds = mergeOrderedStringIds(existing.itemIds, turn.itemIds);
    const mergedInterruptedCommandExecutionItemIds = mergeOrderedStringIds(
      existing.interruptedCommandExecutionItemIds ?? [],
      turn.interruptedCommandExecutionItemIds ?? [],
    );
    detail.turns = detail.turns.map((candidate) =>
      candidate.turnId !== turn.turnId
        ? candidate
        : {
            ...existing,
            ...turn,
            errorMessage: turn.errorMessage ?? existing.errorMessage,
            turnStartedAtMs: turn.turnStartedAtMs ?? existing.turnStartedAtMs,
            finalAssistantStartedAtMs: options?.preferIncomingFinalAssistantStartedAtMs
              ? turn.finalAssistantStartedAtMs ?? existing.finalAssistantStartedAtMs
              : existing.finalAssistantStartedAtMs ?? turn.finalAssistantStartedAtMs,
            startedAt: turn.startedAt ?? existing.startedAt,
            completedAt: turn.completedAt ?? existing.completedAt,
            durationMs: turn.durationMs ?? existing.durationMs,
            itemIds: mergedItemIds,
            interruptedCommandExecutionItemIds: mergedInterruptedCommandExecutionItemIds,
            tokenUsage: turn.tokenUsage ?? existing.tokenUsage,
          });
  }

  private markFinalAssistantStartedAt(
    threadId: string,
    turnId: string,
    observedAtMs = Date.now(),
  ): CodexTurnSummary | null {
    const existing = this.getKnownTurn(threadId, turnId);
    const nextTurn: CodexTurnSummary = {
      ...(existing ?? {
        threadId,
        turnId,
        status: "inProgress" as const,
        itemIds: [],
      }),
      turnStartedAtMs: existing?.turnStartedAtMs ?? observedAtMs,
      finalAssistantStartedAtMs: observedAtMs,
    };
    this.mergeTurn(threadId, nextTurn, {
      preferIncomingFinalAssistantStartedAtMs: true,
    });
    return this.getKnownTurn(threadId, turnId) ?? nextTurn;
  }

  private upsertCanonicalTurnItem(
    threadId: string,
    turnId: string,
    itemId: string,
    fallbackStatus: CodexTurnStatus = "inProgress",
  ): CodexTurnSummary {
    const existing = this.getKnownTurn(threadId, turnId);
    if (!existing) {
      const synthesizedTurn: CodexTurnSummary = {
        threadId,
        turnId,
        status: fallbackStatus,
        itemIds: [itemId],
      };
      this.mergeTurn(threadId, synthesizedTurn);
      return this.getKnownTurn(threadId, turnId) ?? synthesizedTurn;
    }

    const nextItemIds = upsertOrderedStringId(existing.itemIds, itemId);
    if (nextItemIds.length === existing.itemIds.length) {
      return existing;
    }

    const nextTurn: CodexTurnSummary = {
      ...existing,
      itemIds: nextItemIds,
    };
    this.mergeTurn(threadId, nextTurn);
    return this.getKnownTurn(threadId, turnId) ?? nextTurn;
  }

  private listKnownTurns(threadId: string): CodexTurnSummary[] {
    return [...(this.getMaybeConversationRecord(threadId)?.detail?.turns ?? [])];
  }

  private getRecordedItem(threadId: string, turnId: string, itemId: string): CodexItemView | null {
    const byItem = this.getMaybeConversationRecord(threadId)?.itemsByTurn.get(turnId);
    if (!byItem) return null;

    const itemKey = resolveCodexItemPrimaryIdentityKey({ turnId, itemId });
    return byItem.get(itemKey) ?? null;
  }

  private buildTurnDiffItemId(turnId: string): string {
    return `turn-diff:${turnId}`;
  }

  private buildTurnErrorItemId(turnId: string): string {
    return `error:${turnId}`;
  }

  private buildTodoListItemId(turnId: string): string {
    return `todo-list:${turnId}`;
  }

  private buildMcpServerElicitationItemId(requestId: string): string {
    return `mcp-server-elicitation-${requestId}`;
  }

  private buildPlanImplementationServerRequest(
    threadId: string,
    turnId: string,
    itemId: string,
    planContent: string,
    createdAt: number,
  ): CodexPlanImplementationServerRequest {
    const detail = this.ensureConversationDetail(threadId);

    return {
      type: "implementPlan",
      requestId: buildPlanImplementationRequestId(turnId),
      projectId: detail?.projectId ?? null,
      cardId: detail?.cardId ?? null,
      threadId,
      turnId,
      itemId,
      planContent,
      createdAt,
    };
  }

  private upsertPlanImplementationRequest(
    threadId: string,
    turnId: string,
    planContent: string,
    itemCreatedAt: number,
  ): CodexPlanImplementationServerRequest {
    const record = this.ensureConversationRecord(threadId);
    const itemId = buildPlanImplementationRequestId(turnId);
    const existing = record.planImplementationRequestsByTurnId.get(turnId);
    const request = this.buildPlanImplementationServerRequest(
      threadId,
      turnId,
      itemId,
      planContent,
      existing?.createdAt ?? itemCreatedAt,
    );
    record.planImplementationRequestsByTurnId.set(turnId, request);
    return request;
  }

  private removePlanImplementationRequestFromRecord(threadId: string, turnId: string): void {
    this.ensureConversationRecord(threadId).planImplementationRequestsByTurnId.delete(turnId);
  }

  private syncPlanImplementationRequestFromRecordedItem(threadId: string, turnId: string): void {
    const item = this.getRecordedItem(threadId, turnId, buildPlanImplementationRequestId(turnId));
    const planContent = item?.markdownText?.trim() ?? "";
    if (!item || item.status === "completed" || planContent.length === 0) {
      this.removePlanImplementationRequestFromRecord(threadId, turnId);
      return;
    }

    this.upsertPlanImplementationRequest(
      threadId,
      turnId,
      planContent,
      item.createdAt,
    );
  }

  private reconcilePlanImplementationRequests(threadId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record?.detail) {
      return;
    }

    const knownTurnIds = new Set(record.detail.turns.map((turn) => turn.turnId));
    for (const turnId of Array.from(record.planImplementationRequestsByTurnId.keys())) {
      if (!knownTurnIds.has(turnId)) {
        record.planImplementationRequestsByTurnId.delete(turnId);
      }
    }

    for (const turn of record.detail.turns) {
      this.syncPlanImplementationRequestFromRecordedItem(threadId, turn.turnId);
    }
  }

  private buildUserInputResponseItemId(requestId: string): string {
    return `user-input-response-${requestId}`;
  }

  private resolveLiveTurnId(threadId: string, turnId: string | null | undefined): string | null {
    if (typeof turnId === "string" && turnId.trim().length > 0) return turnId;
    const turns = this.listKnownTurns(threadId);
    return turns[turns.length - 1]?.turnId ?? null;
  }

  private buildTurnDiffItemView(input: {
    threadId: string;
    turnId: string;
    diff: string;
    status?: CodexTurnStatus;
    patchBatches?: Array<{ cwd: string | null; changes: unknown[] }>;
  }): CodexItemView {
    const existing = this.getRecordedItem(input.threadId, input.turnId, this.buildTurnDiffItemId(input.turnId));
    const cwd = this.getMaybeConversationRecord(input.threadId)?.detail?.cwd;
    const now = Date.now();
    const itemId = this.buildTurnDiffItemId(input.turnId);
    const status =
      input.status === "inProgress"
        ? "inProgress"
        : input.status === "failed"
          ? "failed"
          : input.status === "interrupted"
            ? "interrupted"
            : "completed";

    return {
      threadId: input.threadId,
      turnId: input.turnId,
      itemId,
      type: "turn_diff",
      normalizedKind: "systemEvent",
      semanticKind: "diff",
      status,
      rawItem: {
        id: itemId,
        type: "turn-diff",
        unifiedDiff: input.diff,
        patchBatches: input.patchBatches ?? [],
        showRevertButton: true,
        ...(typeof cwd === "string" && cwd.trim().length > 0 ? { cwd } : {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private buildPatchBatchesFromItems(items: CodexItemView[], fallbackCwd: string | null): Array<{ cwd: string | null; changes: unknown[] }> {
    return items.flatMap((item) => {
      if (item.normalizedKind !== "fileChange" || item.semanticKind !== "patch") return [];
      if (item.status === "failed" || item.status === "declined" || item.status === "interrupted") return [];
      const changes = item.fileChange?.changes ?? [];
      if (changes.length === 0) return [];
      return [{
        cwd: item.cwd ?? fallbackCwd,
        changes,
      }];
    });
  }

  private buildUnifiedDiffFromPatchItems(items: CodexItemView[]): string | undefined {
    const diff = items
      .filter((item) => item.normalizedKind === "fileChange" && item.semanticKind === "patch")
      .filter((item) => item.status !== "failed" && item.status !== "declined" && item.status !== "interrupted")
      .flatMap((item) => item.fileChange?.diffs ?? [])
      .map((patch) => patch.trimEnd())
      .filter((patch) => patch.length > 0)
      .join("\n");
    return diff.length > 0 ? `${diff}\n` : undefined;
  }

  private listKnownTurnItems(threadId: string, turnId: string): CodexItemView[] {
    const byItem = this.getMaybeConversationRecord(threadId)?.itemsByTurn.get(turnId);
    if (!byItem) return [];
    const turnItemIds = this.getKnownTurn(threadId, turnId)?.itemIds ?? [];
    if (turnItemIds.length === 0) return [...byItem.values()];

    const byItemId = new Map<string, CodexItemView>();
    for (const item of byItem.values()) {
      byItemId.set(item.itemId, item);
    }
    return turnItemIds.map((itemId) => byItemId.get(itemId)).filter((item): item is CodexItemView => Boolean(item));
  }

  private buildLiveTurnErrorItemView(input: {
    threadId: string;
    turnId: string;
    message: string | null | undefined;
    additionalDetails?: string | null;
    willRetry: boolean;
  }): CodexItemView {
    const existing = this.getRecordedItem(input.threadId, input.turnId, this.buildTurnErrorItemId(input.turnId));
    const now = Date.now();
    return buildTurnErrorItemView({
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private buildTodoListItemView(input: {
    threadId: string;
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
  }): CodexItemView {
    const existing = this.getRecordedItem(input.threadId, input.turnId, this.buildTodoListItemId(input.turnId));
    const now = Date.now();
    const itemId = this.buildTodoListItemId(input.turnId);
    const planMarkdown = input.plan
      .map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : " "}] ${step.step}`)
      .join("\n");

    return {
      threadId: input.threadId,
      turnId: input.turnId,
      itemId,
      type: "todo-list",
      normalizedKind: "plan",
      semanticKind: "todoList",
      status: input.plan.every((step) => step.status === "completed") ? "completed" : "inProgress",
      markdownText: planMarkdown,
      rawItem: {
        id: itemId,
        type: "todo-list",
        explanation: input.explanation,
        plan: input.plan,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private buildPlanImplementationItemView(input: {
    threadId: string;
    turnId: string;
    planContent: string;
    isCompleted: boolean;
  }): CodexItemView {
    const itemId = buildPlanImplementationRequestId(input.turnId);
    const existing = this.getRecordedItem(input.threadId, input.turnId, itemId);
    const now = Date.now();

    return {
      threadId: input.threadId,
      turnId: input.turnId,
      itemId,
      type: "planImplementation",
      normalizedKind: "planImplementation",
      semanticKind: "planImplementation",
      status: input.isCompleted ? "completed" : "inProgress",
      markdownText: input.planContent,
      rawItem: {
        id: itemId,
        type: "planImplementation",
        turnId: input.turnId,
        planContent: input.planContent,
        isCompleted: input.isCompleted,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private buildHookItemView(input: {
    threadId: string;
    turnId: string;
    run: Record<string, unknown>;
  }): CodexItemView | null {
    const runId = typeof input.run.id === "string" ? input.run.id : null;
    if (!runId) return null;

    const existing = this.getRecordedItem(input.threadId, input.turnId, runId);
    const now = Date.now();
    const status =
      typeof input.run.status === "string"
        ? input.run.status === "running"
          ? "inProgress"
          : input.run.status === "failed"
            ? "failed"
            : input.run.status === "blocked"
              ? "declined"
              : input.run.status === "stopped"
                ? "interrupted"
                : "completed"
        : "inProgress";
    const statusMessage = typeof input.run.statusMessage === "string" ? input.run.statusMessage : null;

    return {
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: runId,
      type: "hook",
      normalizedKind: "hook",
      semanticKind: "hook",
      status,
      markdownText: statusMessage ?? "Hook",
      rawItem: {
        id: runId,
        type: "hook",
        run: input.run,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private removeTranscriptEntry(threadId: string, entryId: string): void {
    const nextTranscript = this.getThreadTranscript(threadId).filter((entry) => (entry.entryId ?? entry.itemId) !== entryId);
    this.setThreadTranscript(
      threadId,
      buildTranscriptFromBootstrapEvents({
        transcript: nextTranscript,
        source: "live",
      }),
    );
  }

  private syncTurnDiffItem(
    threadId: string,
    turnId: string,
    diff: string | undefined,
    status?: CodexTurnStatus,
    source: CodexTranscriptEntrySource = "live",
  ): void {
    const record = this.ensureConversationRecord(threadId);
    const itemId = this.buildTurnDiffItemId(turnId);
    const itemKey = resolveCodexItemPrimaryIdentityKey({ turnId, itemId });
    const byItem = record.itemsByTurn.get(turnId) ?? new Map<string, CodexItemView>();

    if (!diff) {
      if (byItem.has(itemKey)) {
        byItem.delete(itemKey);
        if (byItem.size === 0) {
          record.itemsByTurn.delete(turnId);
        } else {
          record.itemsByTurn.set(turnId, byItem);
        }
      }
      this.removeTranscriptEntry(threadId, itemId);
      return;
    }

    const fallbackCwd = this.getMaybeConversationRecord(threadId)?.detail?.cwd ?? null;
    const patchBatches = this.buildPatchBatchesFromItems(this.listKnownTurnItems(threadId, turnId), fallbackCwd);
    const item = this.buildTurnDiffItemView({ threadId, turnId, diff, status, patchBatches });
    byItem.set(itemKey, item);
    record.itemsByTurn.set(turnId, byItem);

    const entry = projectItemToLiveTranscriptEntry(
      item,
      source,
      this.getThreadTranscript(threadId),
      this.getKnownTurn(threadId, turnId)?.itemIds,
    );
    this.setThreadTranscript(
      threadId,
      applyLiveTranscriptMutation(this.getThreadTranscript(threadId), {
        type: "upsert",
        entry,
      }),
    );
  }

  private syncTurnErrorItem(
    input: {
      threadId: string;
      turnId: string;
      message: string | null | undefined;
      additionalDetails?: string | null;
      willRetry: boolean;
    },
    source: CodexTranscriptEntrySource = "live",
  ): CodexTranscriptEntry {
    const item = this.buildLiveTurnErrorItemView(input);
    const turn = this.getKnownTurn(input.threadId, input.turnId) ?? {
      threadId: input.threadId,
      turnId: input.turnId,
      status: input.willRetry ? "inProgress" as const : "failed" as const,
      errorMessage: item.markdownText,
      itemIds: [item.itemId],
    };

    this.mergeTurn(input.threadId, {
      ...turn,
      status: input.willRetry ? turn.status : "failed",
      errorMessage: item.markdownText,
      itemIds: [item.itemId],
    });
    this.mergeItem(item, source);
    return this.getThreadTranscript(input.threadId).find((entry) => (entry.entryId ?? entry.itemId) === item.itemId)
      ?? projectItemToLiveTranscriptEntry(
        item,
        source,
        this.getThreadTranscript(input.threadId),
        this.getKnownTurn(input.threadId, input.turnId)?.itemIds,
      );
  }

  private getKnownTurn(threadId: string, turnId: string): CodexTurnSummary | null {
    return this.getMaybeConversationRecord(threadId)?.detail?.turns.find((turn) => turn.turnId === turnId) ?? null;
  }

  private getInterruptTargetTurnId(threadId: string): string | null {
    const turns = this.listKnownTurns(threadId);
    if (turns.length === 0) return null;

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.status === "inProgress") return turn.turnId;
    }

    return turns[turns.length - 1]?.turnId ?? null;
  }

  private markThreadAsActive(threadId: string): void {
    const updated = updateCodexThreadStatus(threadId, "active", []);
    if (updated) {
      this.emitEvent({ type: "threadSummary", thread: updated });
    }
    this.emitEvent({
      type: "threadStatus",
      threadId,
      statusType: "active",
      statusActiveFlags: [],
    });
  }

  private seedTurnWithOptimisticUserMessage(
    threadId: string,
    turnId: string,
    promptText: string,
    userAttachments?: CodexUserAttachment[],
    itemId?: string,
  ): CodexTranscriptEntry {
    const createdAt = Date.now();
    const resolvedItemId = itemId ?? `item-${++this.syntheticItemIdCounter}`;
    const item: CodexItemView = {
      threadId,
      turnId,
      itemId: resolvedItemId,
      type: "userMessage",
      normalizedKind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      markdownText: promptText,
      userAttachments,
      createdAt,
      updatedAt: createdAt,
    };

    const turn = this.getKnownTurn(threadId, turnId);
    if (turn && !turn.itemIds.includes(item.itemId)) {
      this.mergeTurn(threadId, {
        ...turn,
        itemIds: [...turn.itemIds, item.itemId],
      });
    }

    this.mergeItem(item, "optimistic");
    return this.getThreadTranscript(threadId).find((entry) => entry.entryId === item.itemId)
      ?? {
        threadId,
        turnId,
        entryId: item.itemId,
        itemId: item.itemId,
        type: item.type,
        kind: item.normalizedKind,
        semanticKind: item.semanticKind,
        status: item.status,
        role: item.role,
        source: "optimistic",
        sequence: 0,
        markdownText: item.markdownText,
        userAttachments: item.userAttachments,
        createdAt,
        updatedAt: createdAt,
      };
  }

  private syncThreadStatusFromKnownTurns(threadId: string): void {
    const hasInProgressTurn = this.listKnownTurns(threadId).some((turn) => turn.status === "inProgress");
    const statusType: CodexThreadStatusType = hasInProgressTurn ? "active" : "idle";
    const updated = updateCodexThreadStatus(threadId, statusType, []);
    if (updated) {
      this.emitEvent({ type: "threadSummary", thread: updated });
    }
    this.emitEvent({
      type: "threadStatus",
      threadId,
      statusType,
      statusActiveFlags: [],
    });
  }

  private async resolveInterruptTurnId(threadId: string, turnId?: string): Promise<string | null> {
    if (typeof turnId === "string" && turnId.trim().length > 0) return turnId;

    const cachedTurnId = this.getInterruptTargetTurnId(threadId);
    if (cachedTurnId) return cachedTurnId;

    await this.readThread(threadId, true).catch(() => null);
    return this.getInterruptTargetTurnId(threadId);
  }

  private reconcileTurnItemsToTerminalStatus(
    threadId: string,
    turnId: string,
    turnStatus: CodexTurnStatus,
  ): CodexTranscriptEntry[] {
    const terminalStatus = asTerminalTurnStatus(turnStatus);
    if (!terminalStatus) return [];

    const record = this.ensureConversationRecord(threadId);
    const byItem = record.itemsByTurn.get(turnId);
    if (!byItem || byItem.size === 0) {
      this.setThreadTranscript(threadId, finalizeTurnTranscriptState(this.getThreadTranscript(threadId), turnId, turnStatus));
      return [];
    }

    const now = Date.now();
    const updatedItems: CodexItemView[] = [];

    for (const [itemKey, item] of byItem.entries()) {
      if (!shouldTerminalizeItemWithTurn(item, turnStatus)) continue;
      const nextItem: CodexItemView = {
        ...item,
        status: terminalStatus,
        updatedAt: Math.max(item.updatedAt, now),
      };
      byItem.set(itemKey, nextItem);
      updatedItems.push(nextItem);
    }

    if (updatedItems.length === 0) {
      this.setThreadTranscript(threadId, finalizeTurnTranscriptState(this.getThreadTranscript(threadId), turnId, turnStatus));
      return [];
    }
    record.itemsByTurn.set(turnId, byItem);
    const nextTranscript = finalizeTurnTranscriptState(this.getThreadTranscript(threadId), turnId, turnStatus);
    this.setThreadTranscript(threadId, nextTranscript);
    return nextTranscript.filter((entry) =>
      entry.turnId === turnId && updatedItems.some((item) => item.itemId === entry.itemId)
    );
  }

  private reconcileDetailTranscriptToTerminalTurnStatus(detail: CodexThreadDetail): CodexThreadDetail {
    if (detail.transcript.length === 0 || detail.turns.length === 0) return detail;

    let transcript = detail.transcript;
    for (const turn of detail.turns) {
      transcript = finalizeTurnTranscriptState(transcript, turn.turnId, turn.status);
    }

    return {
      ...detail,
      transcript,
    };
  }

  private getThreadTranscript(threadId: string): CodexTranscriptEntry[] {
    return [...(this.getMaybeConversationRecord(threadId)?.detail?.transcript ?? [])];
  }

  private setThreadTranscript(threadId: string, transcript: CodexTranscriptEntry[]): void {
    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return;
    detail.transcript = transcript;
  }

  private hasKnownThreadDetail(threadId: string): boolean {
    const detail = this.getMaybeConversationRecord(threadId)?.detail;
    if (!detail) return false;
    return detail.turns.length > 0 || detail.transcript.length > 0;
  }

  private bootstrapConversationRecordFromSession(threadId: string): CodexThreadDetail | null {
    if (this.hasKnownThreadDetail(threadId)) {
      return this.serializeThreadDetail(threadId);
    }

    const link = this.getThreadLinkSafely(threadId);
    if (!link) return null;

    const sessionDetail = readCodexSessionThreadDetail({
      threadId,
      link,
    });
    if (!sessionDetail) return null;

    const reconciledDetail = this.reconcileDetailTranscriptToTerminalTurnStatus(sessionDetail);
    upsertCodexCardThreadLink({
      projectId: link.projectId,
      cardId: link.cardId,
      threadId,
      source: link.source,
      threadName: reconciledDetail.threadName ?? link.threadName,
      threadPreview: reconciledDetail.threadPreview || link.threadPreview,
      cwd: reconciledDetail.cwd ?? link.cwd,
      statusType: link.statusType,
      statusActiveFlags: link.statusActiveFlags,
      archived: link.archived,
      createdAt: reconciledDetail.createdAt || link.createdAt,
      updatedAt: Math.max(link.updatedAt, reconciledDetail.updatedAt),
      linkedAt: link.linkedAt,
    });
    this.setConversationRecordDetail(reconciledDetail);
    const record = this.ensureConversationRecord(threadId);
    if (record.streamRole === null && !record.isStreaming) {
      record.resumeState = "needs_resume";
    }
    return reconciledDetail;
  }

  private parseReasoningBuffers(item: CodexItemView): { summary: string[]; content: string[] } {
    return parseCodexReasoningBuffers(item.rawItem);
  }

  private upsertAutomaticApprovalReviewItem(
    payload: Record<string, unknown>,
    fallbackStatus: "inProgress" | "completed",
  ): CodexTranscriptEntry | null {
    const threadId = typeof payload.threadId === "string" ? payload.threadId : null;
    const turnId = typeof payload.turnId === "string" ? payload.turnId : null;
    const targetItemId = typeof payload.targetItemId === "string" ? payload.targetItemId : null;
    if (!threadId || !turnId || !targetItemId) return null;

    const review = normalizeAutomaticApprovalReviewPayload(payload, targetItemId);
    if (!review) return null;

    const itemId = `${AUTOMATIC_APPROVAL_REVIEW_ITEM_TYPE}:${targetItemId}`;
    const now = Date.now();
    this.upsertCanonicalTurnItem(threadId, turnId, itemId, "inProgress");
    return this.mergeItem({
      threadId,
      turnId,
      itemId,
      type: AUTOMATIC_APPROVAL_REVIEW_ITEM_TYPE,
      normalizedKind: "systemEvent",
      semanticKind: "automaticApprovalReview",
      status: review.status === "inProgress" ? "inProgress" : fallbackStatus,
      markdownText: buildAutomaticApprovalReviewSummary(review),
      rawItem: {
        id: itemId,
        type: AUTOMATIC_APPROVAL_REVIEW_ITEM_TYPE,
        targetItemId,
        review: {
          status: review.status,
          riskScore: review.riskScore,
          riskLevel: review.riskLevel,
          rationale: review.rationale,
        },
        action: review.action,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  private mergeItem(item: CodexItemView, source: CodexTranscriptEntrySource = "live"): CodexTranscriptEntry {
    this.ensureConversationDetail(item.threadId);
    const record = this.ensureConversationRecord(item.threadId);
    const byItem = record.itemsByTurn.get(item.turnId) ?? new Map<string, CodexItemView>();
    const primaryKey = resolveCodexItemPrimaryIdentityKey(item);

    let existingKey: string | null = null;
    let existing: CodexItemView | undefined = byItem.get(primaryKey);
    if (!existing) {
      for (const [candidateKey, candidate] of byItem.entries()) {
        if (!canMergeSyntheticTextDuplicate(candidate, item)) continue;
        existing = candidate;
        existingKey = candidateKey;
        break;
      }
    } else {
      existingKey = primaryKey;
    }

    const mergedItem = existing
      ? {
          ...mergeCodexItemView(existing, item),
          updatedAt: Date.now(),
        }
      : item;

    if (existingKey && existingKey !== primaryKey) {
      byItem.delete(existingKey);
    }
    byItem.set(
      primaryKey,
      mergedItem,
    );
    record.itemsByTurn.set(item.turnId, byItem);

    const currentTranscript = this.getThreadTranscript(item.threadId);
    const nextEntry = projectItemToLiveTranscriptEntry(
      mergedItem,
      source,
      currentTranscript,
      this.getKnownTurn(item.threadId, item.turnId)?.itemIds,
    );
    const nextTranscript = source === "optimistic" && nextEntry.kind === "userMessage"
      ? applyOptimisticUserPrompt({
          transcript: currentTranscript,
          threadId: nextEntry.threadId,
          turnId: nextEntry.turnId,
          entryId: nextEntry.entryId ?? nextEntry.itemId,
          promptText: nextEntry.markdownText ?? "",
          userAttachments: nextEntry.userAttachments,
          createdAt: nextEntry.createdAt,
        })
      : nextEntry.kind === "userMessage"
        ? reconcileCommittedUserPrompt(currentTranscript, nextEntry)
        : applyLiveTranscriptMutation(currentTranscript, { type: "upsert", entry: nextEntry });
    this.setThreadTranscript(item.threadId, nextTranscript);
    if (source !== "optimistic" && nextEntry.kind === "userMessage" && nextEntry.markdownText) {
      this.clearPendingSteerForConsumedPrompt(item.threadId, item.turnId, nextEntry.markdownText);
    }
    return nextEntry;
  }

  private setConversationRecordDetail(detail: CodexThreadDetail): void {
    const record = this.ensureConversationRecord(detail.threadId);
    const retainedTurnIds = new Set(detail.turns.map((turn) => turn.turnId));
    this.clearThreadPendingRequestsForRemovedTurns(detail.threadId, retainedTurnIds);
    this.pruneThreadTransientState(detail.threadId, retainedTurnIds);
    record.latestCollaborationMode = detail.latestCollaborationMode ?? record.latestCollaborationMode;
    const previousDetail = record.detail;
    record.detail = {
      ...detail,
      approvalPolicy: detail.approvalPolicy ?? previousDetail?.approvalPolicy ?? null,
      approvalsReviewer: detail.approvalsReviewer ?? previousDetail?.approvalsReviewer ?? null,
      sandbox: detail.sandbox ?? previousDetail?.sandbox ?? null,
      latestCollaborationMode: record.latestCollaborationMode,
      turns: [...detail.turns],
      transcript: [...detail.transcript],
    };
    record.itemsByTurn = new Map<string, Map<string, CodexItemView>>();
  }

  private hydrateThreadDetail(detail: CodexThreadDetail): void {
    this.setConversationRecordDetail(detail);
  }

  private buildThreadDetailFromRead(thread: unknown): CodexThreadDetail | null {
    if (typeof thread !== "object" || thread === null) return null;
    const candidate = thread as Record<string, unknown>;

    if (typeof candidate.id !== "string") return null;
    const threadId = candidate.id;

    const link = this.getThreadLinkSafely(threadId);
    if (!link) return null;

    const turns = Array.isArray(candidate.turns) ? candidate.turns : [];
    const turnSummaries: CodexTurnSummary[] = [];
    const itemViews: CodexItemView[] = [];

    for (const turn of turns) {
      const turnSummary = this.asTurnSummary(threadId, turn);
      if (!turnSummary) continue;
      turnSummaries.push(turnSummary);

      const turnRecord = turn as Record<string, unknown>;
      const items = Array.isArray(turnRecord.items) ? turnRecord.items : [];
      const turnItemViews: CodexItemView[] = [];
      for (const item of items) {
        const itemView = normalizeThreadItem(item, threadId, turnSummary.turnId);
        if (!itemView) continue;
        itemViews.push(itemView);
        turnItemViews.push(itemView);
      }

      const turnError =
        typeof turnRecord.error === "object" && turnRecord.error !== null
          ? turnRecord.error as Record<string, unknown>
          : null;
      if (turnError) {
        const message = typeof turnError.message === "string" ? turnError.message : turnSummary.errorMessage ?? null;
        const additionalDetails =
          typeof turnError.additionalDetails === "string"
            ? turnError.additionalDetails
            : null;
        itemViews.push(buildTurnErrorItemView({
          threadId,
          turnId: turnSummary.turnId,
          message,
          additionalDetails,
          willRetry: false,
        }));
      }

      const fallbackCwd = this.getThreadLinkSafely(threadId)?.cwd ?? null;
      const patchBatches = this.buildPatchBatchesFromItems(turnItemViews, fallbackCwd);
      const synthesizedDiff = this.buildUnifiedDiffFromPatchItems(turnItemViews);
      const turnDiff = patchBatches.length > 0 ? (synthesizedDiff ?? turnSummary.diff) : turnSummary.diff;
      if (turnDiff) {
        itemViews.push(this.buildTurnDiffItemView({
          threadId,
          turnId: turnSummary.turnId,
          diff: turnDiff,
          status: turnSummary.status,
          patchBatches,
        }));
      }
    }

    const transcript = buildTranscriptFromBootstrapEvents({
      items: itemViews,
      source: "live",
    });

    const existingRecord = this.getMaybeConversationRecord(threadId);
    return {
      ...link,
      approvalPolicy: existingRecord?.detail?.approvalPolicy ?? null,
      approvalsReviewer: existingRecord?.detail?.approvalsReviewer ?? null,
      sandbox: existingRecord?.detail?.sandbox ?? null,
      latestCollaborationMode: existingRecord?.latestCollaborationMode ?? this.buildDefaultCollaborationModeState(),
      turns: turnSummaries,
      transcript,
    };
  }

  private upsertLinkFromThread(
    thread: unknown,
    fallbackRef?: ThreadRef,
    fallbackCwd?: string | null,
  ): CodexThreadSummary | null {
    if (typeof thread !== "object" || thread === null) return null;
    const candidate = thread as Record<string, unknown>;
    if (typeof candidate.id !== "string") return null;

    const existing = this.getThreadLinkSafely(candidate.id);
    const ref = fallbackRef ??
      (existing
        ? {
            projectId: existing.projectId,
            cardId: existing.cardId,
          }
        : null);

    if (!ref) return null;

    const parsedStatus = parseThreadStatus(candidate.status);

    const parentThreadId = parseThreadSourceParentThreadId(candidate.source);
    const summary = upsertCodexCardThreadLink({
      projectId: ref.projectId,
      cardId: ref.cardId,
      threadId: candidate.id,
      source: parentThreadId ? { parentThreadId } : null,
      threadName: typeof candidate.name === "string" ? candidate.name : null,
      threadPreview: typeof candidate.preview === "string" ? candidate.preview : "",
      modelProvider: typeof candidate.modelProvider === "string" ? candidate.modelProvider : "",
      cwd: typeof candidate.cwd === "string"
        ? candidate.cwd
        : (existing?.cwd ?? (fallbackCwd?.trim() || null)),
      statusType: parsedStatus.statusType,
      statusActiveFlags: parsedStatus.statusActiveFlags,
      archived: existing?.archived ?? false,
      createdAt: normalizeTimestamp(candidate.createdAt),
      updatedAt: normalizeTimestamp(candidate.updatedAt),
      linkedAt: existing?.linkedAt,
    });

    if (summary?.threadName?.trim()) {
      this.threadTitleState.setTitle(summary.threadId, summary.threadName);
    }

    return summary;
  }

  private parseWorkspacePath(projectId: string): string {
    const project = dbService.getProject(projectId);
    if (!project) {
      throw new Error(`Project '${projectId}' not found`);
    }

    const workspacePath = project.workspacePath?.trim();
    if (!workspacePath) {
      throw new Error(`Project '${projectId}' must configure workspace path before using Codex threads`);
    }

    return workspacePath;
  }

  private emitThreadTitleUpdated(threadId: string, title: string): void {
    const normalizedThreadId = threadId.trim();
    const normalizedTitle = title.trim();
    if (!normalizedThreadId || !normalizedTitle) {
      return;
    }

    this.threadTitleState.setTitle(normalizedThreadId, normalizedTitle);
    this.emitHostMessage({
      type: "threadTitleUpdated",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: normalizedThreadId,
      title: normalizedTitle,
    });
  }

  private async backfillPendingThreadTitles(): Promise<void> {
    if (this.threadTitleBackfillPromise) {
      return this.threadTitleBackfillPromise;
    }

    this.threadTitleBackfillPromise = (async () => {
      const pendingBackfill = this.threadTitleState.readPendingBackfill();
      if (pendingBackfill.order.length === 0) {
        return;
      }

      const completedThreadIds: string[] = [];
      for (const threadId of pendingBackfill.order) {
        const title = pendingBackfill.titles[threadId];
        if (!title) {
          continue;
        }

        try {
          await this.client.request("thread/name/set", {
            threadId,
            name: title,
          });
          completedThreadIds.push(threadId);
        } catch (error) {
          this.logger.warn("Could not backfill cached thread title", {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.threadTitleState.clearPendingBackfill(completedThreadIds);
    })().finally(() => {
      this.threadTitleBackfillPromise = null;
    });

    return this.threadTitleBackfillPromise;
  }

  private async runStructuredThreadTitle(input: RunStructuredThreadTitleInput): Promise<string | null> {
    const timeoutMs = input.timeoutMs ?? THREAD_TITLE_TIMEOUT_MS;
    return await new Promise<string | null>((resolve, reject) => {
      let isSettled = false;
      let bufferedAssistantText = "";
      let timeoutHandle: NodeJS.Timeout | null = null;
      let activeThreadId: string | null = null;
      let activeTurnId: string | null = null;
      let unsubscribe: (() => void) | null = null;

      const complete = (title: string | null) => {
        if (isSettled) return;
        isSettled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        resolve(title);
      };

      const fail = (error: unknown) => {
        if (isSettled) return;
        isSettled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        reject(error);
      };

      const parseEventThreadId = (eventParams: Record<string, unknown> | null): string | null => {
        if (!eventParams) return null;
        if (typeof eventParams.threadId === "string") return eventParams.threadId;
        const thread = asRecord(eventParams.thread);
        if (typeof thread?.id === "string") return thread.id;
        return null;
      };

      const parseEventTurnId = (eventParams: Record<string, unknown> | null): string | null => {
        if (!eventParams) return null;
        if (typeof eventParams.turnId === "string") return eventParams.turnId;
        const turn = asRecord(eventParams.turn);
        if (typeof turn?.id === "string") return turn.id;
        return null;
      };

      const parseThreadIdFromStartResult = (startResult: unknown): string | null => {
        const resultRecord = asRecord(startResult);
        if (!resultRecord) return null;
        if (typeof resultRecord.threadId === "string") return resultRecord.threadId;
        const thread = asRecord(resultRecord.thread);
        if (typeof thread?.id === "string") return thread.id;
        if (typeof resultRecord.id === "string") return resultRecord.id;
        return null;
      };

      const parseTurnIdFromStartResult = (startResult: unknown): string | null => {
        const resultRecord = asRecord(startResult);
        if (!resultRecord) return null;
        if (typeof resultRecord.turnId === "string") return resultRecord.turnId;
        const turn = asRecord(resultRecord.turn);
        if (typeof turn?.id === "string") return turn.id;
        if (typeof resultRecord.id === "string") return resultRecord.id;
        return null;
      };

      const isEventForActiveThreadAndTurn = (eventParams: Record<string, unknown> | null): boolean => {
        const eventThreadId = parseEventThreadId(eventParams);
        if (!activeThreadId || !eventThreadId || eventThreadId !== activeThreadId) {
          return false;
        }

        const eventTurnId = parseEventTurnId(eventParams);
        if (activeTurnId && (!eventTurnId || eventTurnId !== activeTurnId)) {
          return false;
        }

        return true;
      };

      unsubscribe = input.client.onNotification(({ method, params }) => {
        if (isSettled) return;
        if (
          method !== "turn/started" &&
          method !== "item/agentMessage/delta" &&
          method !== "item/completed" &&
          method !== "turn/completed"
        ) {
          return;
        }

        const eventParams = asRecord(params);
        if (!isEventForActiveThreadAndTurn(eventParams)) return;

        if (method === "turn/started") {
          const eventThreadId = parseEventThreadId(eventParams);
          const eventTurnId = parseEventTurnId(eventParams);
          if (!activeThreadId && eventThreadId) activeThreadId = eventThreadId;
          if (!activeTurnId && eventTurnId) activeTurnId = eventTurnId;
          return;
        }

        if (method === "item/agentMessage/delta") {
          const deltaText = typeof eventParams?.delta === "string"
            ? eventParams.delta
            : typeof asRecord(eventParams?.item)?.delta === "string"
              ? asRecord(eventParams?.item)?.delta as string
              : "";
          if (deltaText) bufferedAssistantText += deltaText;
          return;
        }

        if (method === "item/completed") {
          const item = asRecord(eventParams?.item);
          const itemType = typeof item?.type === "string" ? item.type : "";
          if (itemType !== "agentMessage") return;
          const itemText = typeof item?.text === "string"
            ? item.text
            : typeof item?.markdownText === "string"
              ? item.markdownText
              : "";
          bufferedAssistantText = itemText;
          return;
        }

        const status = typeof eventParams?.status === "string"
          ? eventParams.status
          : typeof asRecord(eventParams?.turn)?.status === "string"
            ? asRecord(eventParams?.turn)?.status as string
            : "";
        if (status !== "completed") {
          fail(new Error("Structured turn did not complete."));
          return;
        }
        try {
          complete(input.parse(bufferedAssistantText));
        } catch (error) {
          fail(error);
        }
      });

      timeoutHandle = setTimeout(() => {
        if (activeThreadId && activeTurnId) {
          void input.client.interruptTurn({ threadId: activeThreadId, turnId: activeTurnId }).catch(() => undefined);
        }
        fail(new Error("Timed out while generating thread title"));
      }, timeoutMs);

      void (async () => {
        const threadConfig = input.effort === null
          ? (input.config ?? null)
          : { ...(input.config ?? {}), model_reasoning_effort: input.effort };

        const startedThread = await input.client.startThread({
          model: input.model,
          modelProvider: null,
          cwd: input.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          config: threadConfig,
          baseInstructions: null,
          developerInstructions: null,
          personality: null,
          ephemeral: true,
          experimentalRawEvents: false,
          dynamicTools: null,
          persistExtendedHistory: false,
        });

        activeThreadId = parseThreadIdFromStartResult(startedThread);
        if (!activeThreadId) {
          throw new Error("thread/start did not return a valid thread id");
        }

        const startedTurn = await input.client.startTurn({
          threadId: activeThreadId,
          input: [{ type: "text", text: input.prompt, text_elements: [] }],
          cwd: null,
          approvalPolicy: null,
          sandboxPolicy: null,
          model: null,
          effort: null,
          summary: "auto",
          personality: null,
          outputSchema: input.schema,
          collaborationMode: null,
        });

        activeTurnId = parseTurnIdFromStartResult(startedTurn);
        if (!activeTurnId) {
          throw new Error("turn/start did not return a valid turn id");
        }
      })().catch((error) => {
        fail(error);
      });
    });
  }

  private async generateThreadTitleWithStructuredTurn(input: {
    prompt: string;
    cwd: string | null;
    client: StructuredThreadTitleClient;
  }): Promise<string | null> {
    const userPrompt = input.prompt.trim();
    if (!userPrompt) return null;

    const titlePrompt = buildThreadTitleGenerationPrompt(userPrompt);
    if (!titlePrompt) return null;

    return await this.runStructuredThreadTitle({
      prompt: titlePrompt,
      cwd: input.cwd,
      model: THREAD_TITLE_MODEL,
      effort: THREAD_TITLE_REASONING_EFFORT,
      schema: THREAD_TITLE_SCHEMA,
      config: { web_search: "disabled" },
      timeoutMs: THREAD_TITLE_TIMEOUT_MS,
      client: input.client,
      parse: parseGeneratedThreadTitleResponse,
    });
  }

  private async generateThreadTitleViaAdapter(input: GenerateThreadTitleAdapterInput): Promise<string | null> {
    return await this.generateThreadTitleWithStructuredTurn({
      prompt: input.prompt,
      cwd: input.cwd,
      client: {
        startThread: (params) => input.appServerConnection.startThread(params),
        startTurn: (params) => input.appServerConnection.startTurn(params),
        interruptTurn: (params) => input.appServerConnection.interruptTurn(params),
        onNotification: (handler) => input.appServerConnection.registerInternalNotificationHandler(handler),
      },
    });
  }

  private async generateThreadTitleForPrompt(firstPrompt: string, cwd: string | null): Promise<string | null> {
    return await this.generateThreadTitleViaAdapter({
      prompt: firstPrompt,
      cwd,
      appServerConnection: {
        startThread: (params) => this.client.request("thread/start", params as ThreadStartParams),
        startTurn: (params) => this.client.request("turn/start", params as TurnStartParams),
        interruptTurn: (params) => this.client.request("turn/interrupt", params),
        registerInternalNotificationHandler: (handler) => {
          this.client.on("notification", handler);
          return () => {
            this.client.off("notification", handler);
          };
        },
      },
    });
  }

  async generateThreadTitle(input: {
    prompt: string;
    cwd: string | null;
  }): Promise<{ title: string | null }> {
    await this.ensureClientReady();
    const title = await this.generateThreadTitleForPrompt(input.prompt, input.cwd);
    return {
      title,
    };
  }

  async startThreadForCard(input: CodexThreadStartForCardInput): Promise<CodexThreadDetail> {
    await this.ensureClientReady();

    const preparedPrompt = await this.preparePromptForTurn(input.prompt, input.promptInput);
    const prompt = preparedPrompt.promptText;
    const effectiveModel = preparedPrompt.agentConfigOverrides.model ?? input.model;
    const effectiveReasoningEffort = preparedPrompt.agentConfigOverrides.reasoningEffort ?? input.reasoningEffort;
    const effectiveCollaborationMode = preparedPrompt.agentConfigOverrides.collaborationMode ?? input.collaborationMode;
    const explicitThreadName = input.threadName?.trim() || null;
    const startedAt = Date.now();
    const resolvedPermissionState = await this.readPermissionState(input.projectId);
    const permissionState = this.resolvePermissionStateForRequest(
      resolvedPermissionState,
      input.permissionMode,
      null,
    );
    const permissionMode = permissionState.mode;

    this.logger.info("Starting Codex thread for card", {
      projectId: input.projectId,
      cardId: input.cardId,
      model: effectiveModel ?? null,
      serviceTier: formatServiceTierForReporting(input.serviceTier),
      permissionMode,
      reasoningEffort: effectiveReasoningEffort ?? null,
      collaborationMode: effectiveCollaborationMode ?? null,
      worktreeStartMode: input.worktreeStartMode ?? null,
      hasExplicitThreadName: Boolean(explicitThreadName),
      promptLength: prompt.length,
      promptPreview: previewText(prompt),
    });

    let hasThreadStartProgress = false;
    try {
      const runLocation = await this.resolveThreadRunLocation({
        projectId: input.projectId,
        cardId: input.cardId,
        threadTitle: explicitThreadName,
        worktreeStartMode: input.worktreeStartMode,
        worktreeBranchPrefix: input.worktreeBranchPrefix,
        onProgress: (update) => {
          hasThreadStartProgress = true;
          this.emitThreadStartProgress({
            projectId: input.projectId,
            cardId: input.cardId,
            phase: update.phase,
            message: update.message,
            stream: update.stream,
            outputDelta: update.outputDelta,
            clearOutput: update.clearOutput,
          });
        },
      });
      const effectivePermissionState = this.resolvePermissionStateForRequest(
        permissionState,
        input.permissionMode,
        runLocation.cwd,
      );
      const turnPermissionOverrides = buildTurnPermissionOverrides({
        permissionState: effectivePermissionState,
        workspacePath: runLocation.cwd,
      });
      const threadPermissionOverrides = buildThreadPermissionOverrides({
        permissionState: effectivePermissionState,
      });
      this.logger.info("Resolved Codex thread run location", {
        projectId: input.projectId,
        cardId: input.cardId,
        cwd: runLocation.cwd,
        runInTarget: runLocation.runInTarget,
        createdManagedWorktree: runLocation.createdManagedWorktree,
      });

      if (runLocation.createdManagedWorktree) {
        this.emitThreadStartProgress({
          projectId: input.projectId,
          cardId: input.cardId,
          phase: "startingThread",
          message: "Starting thread in prepared worktree.",
          stream: "info",
          outputDelta: "[info] Starting thread\n",
        });
      }

      const threadStartParams: ThreadStartParams = {
        cwd: runLocation.cwd,
        model: effectiveModel ?? null,
        ...buildServiceTierParams(input.serviceTier),
        experimentalRawEvents: THREAD_START_EXPERIMENTAL_RAW_EVENTS,
        persistExtendedHistory: THREAD_START_PERSIST_EXTENDED_HISTORY,
        ...threadPermissionOverrides,
      };
      const threadStart = await this.client.request<"thread/start", ThreadStartResponse>("thread/start", threadStartParams);

      const link = this.upsertLinkFromThread(threadStart.thread, {
        projectId: input.projectId,
        cardId: input.cardId,
        cwd: runLocation.cwd,
      }, runLocation.cwd);

      if (!link) {
        throw new Error("Codex thread/start returned an invalid thread payload");
      }
      this.setThreadPermissionFields(link.threadId, {
        approvalPolicy: threadStart.approvalPolicy,
        approvalsReviewer: threadStart.approvalsReviewer,
        sandbox: threadStart.sandbox,
      });

      this.logger.info("Created Codex thread", {
        projectId: input.projectId,
        cardId: input.cardId,
        threadId: link.threadId,
        cwd: runLocation.cwd,
      });

      if (explicitThreadName) {
        await this.client.request("thread/name/set", {
          threadId: link.threadId,
          name: explicitThreadName,
        });
        const updatedThread = updateCodexThreadName(link.threadId, explicitThreadName);
        this.emitThreadTitleUpdated(link.threadId, explicitThreadName);
        if (updatedThread) {
          this.emitEvent({ type: "threadSummary", thread: updatedThread });
        }
      }

      const collaborationMode = this.buildCollaborationModePayload({
        collaborationMode: effectiveCollaborationMode,
        model: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
      });
      if (effectiveCollaborationMode) {
        this.setLatestCollaborationModeForThread(link.threadId, this.buildCollaborationModeState({
          collaborationMode: effectiveCollaborationMode,
          model: effectiveModel ?? null,
          reasoningEffort: effectiveReasoningEffort ?? null,
          fallback: this.getConversationRecord(link.threadId).latestCollaborationMode,
        }));
      }

      const turnStartParams: TurnStartParams = {
        threadId: link.threadId,
        input: preparedPrompt.inputItems,
        cwd: runLocation.cwd,
        ...turnPermissionOverrides,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...buildServiceTierParams(input.serviceTier),
        ...(effectiveReasoningEffort ? { effort: effectiveReasoningEffort } : {}),
        ...(collaborationMode ? { collaborationMode } : {}),
      };
      const turnStart = await this.client.request<"turn/start", TurnStartResponse>("turn/start", turnStartParams);
      const startedTurn = this.asTurnSummary(link.threadId, turnStart.turn);
      if (startedTurn) {
        const observedTurn: CodexTurnSummary = {
          ...startedTurn,
          turnStartedAtMs: startedTurn.turnStartedAtMs ?? Date.now(),
        };
        this.mergeTurn(link.threadId, observedTurn);
        const optimisticUserAttachments = buildCodexUserAttachmentsFromContent(
          preparedPrompt.inputItems,
          `optimistic:${observedTurn.turnId}`,
        );
        this.seedTurnWithOptimisticUserMessage(
          link.threadId,
          observedTurn.turnId,
          prompt,
          optimisticUserAttachments.length > 0 ? optimisticUserAttachments : undefined,
        );
        this.logger.info("Started first Codex turn", {
          threadId: link.threadId,
          turnId: observedTurn.turnId,
          durationMs: Date.now() - startedAt,
        });
      }
      this.markThreadAsActive(link.threadId);
      this.emitThreadStreamSnapshotFromRecord(link.threadId);

      const detail = this.serializeThreadDetail(link.threadId);
      if (!detail) {
        throw new Error("Thread was created but could not be loaded");
      }

      if (runLocation.createdManagedWorktree) {
        this.emitThreadStartProgress({
          projectId: input.projectId,
          cardId: input.cardId,
          phase: "ready",
          message: "Worktree ready.",
          stream: "info",
          outputDelta: "[info] Worktree ready.\n",
        });
      }

      this.logger.info("Codex thread for card is ready", {
        threadId: link.threadId,
        projectId: input.projectId,
        cardId: input.cardId,
        durationMs: Date.now() - startedAt,
      });
      return detail;
    } catch (error) {
      this.logger.error("Failed to start Codex thread for card", {
        projectId: input.projectId,
        cardId: input.cardId,
        durationMs: Date.now() - startedAt,
        error,
      });
      if (hasThreadStartProgress) {
        const detail = error instanceof Error ? error.message : String(error);
        this.emitThreadStartProgress({
          projectId: input.projectId,
          cardId: input.cardId,
          phase: "failed",
          message: "Worktree setup failed.",
          stream: "stderr",
          outputDelta: `[stderr] ${detail}\n`,
        });
      }
      throw error;
    }
  }

  async readThread(threadId: string, includeTurns = true): Promise<CodexThreadDetail | null> {
    await this.ensureClientReady();
    try {
      return await this.readThreadWithTurnsFlag(threadId, includeTurns);
    } catch (error) {
      if (!includeTurns || !isRolloutMaterializationError(error)) throw error;
      return this.readThreadWithTurnsFlag(threadId, false);
    }
  }

  async requestConversationSnapshot(threadId: string): Promise<CodexConversationSnapshot | null> {
    const existingConversation = this.serializeConversationSnapshot(threadId);
    if (existingConversation) {
      this.emitThreadStreamSnapshotFromRecord(threadId);
      return existingConversation;
    }

    return null;
  }

  private async readThreadWithTurnsFlag(
    threadId: string,
    includeTurns: boolean,
  ): Promise<CodexThreadDetail | null> {
    const result = await this.client.request<"thread/read", ThreadReadResponse>("thread/read", {
      threadId,
      includeTurns,
    });

    this.upsertLinkFromThread(result.thread);
    const liveDetail = this.buildThreadDetailFromRead(result.thread);
    if (!liveDetail) return null;

    const reconciledDetail = this.reconcileDetailTranscriptToTerminalTurnStatus(liveDetail);
    this.setConversationRecordDetail(reconciledDetail);
    return reconciledDetail;
  }

  private async resumeConversationRecord(threadId: string): Promise<CodexThreadDetail | null> {
    await this.ensureClientReady();
    this.logger.info("Resuming Codex thread", { threadId });
    const record = this.ensureConversationRecord(threadId);
    if (record.streamRole === "follower") {
      return this.serializeThreadDetail(threadId);
    }

    const threadRef = this.parseThreadRef(threadId);
    const permissionState = await this.readPermissionState(threadRef?.projectId ?? null);
    const resumeParams: ThreadResumeParams = {
      threadId,
      persistExtendedHistory: THREAD_RESUME_PERSIST_EXTENDED_HISTORY,
      ...buildThreadPermissionOverrides({
        permissionState,
      }),
    };
    const result = await this.client.request<"thread/resume", ThreadResumeResponse>("thread/resume", resumeParams);
    this.upsertLinkFromThread(result.thread);
    const liveDetail = this.buildThreadDetailFromRead(result.thread);
    if (!liveDetail) return null;
    this.setThreadPermissionFields(threadId, {
      approvalPolicy: result.approvalPolicy,
      approvalsReviewer: result.approvalsReviewer,
      sandbox: result.sandbox,
    });

    const detail = this.reconcileDetailTranscriptToTerminalTurnStatus(liveDetail);
    this.setConversationRecordDetail(detail);

    record.isStreaming = true;
    record.streamRole = "owner";
    return detail;
  }

  async resumeThread(threadId: string): Promise<CodexThreadDetail | null> {
    return this.resumeConversationRecord(threadId);
  }

  async requestConversationResume(threadId: string): Promise<CodexConversationSnapshot | null> {
    this.setConversationResumeState(threadId, "resuming");
    this.ensureConversationDetail(threadId);
    this.emitThreadStreamSnapshotFromRecord(threadId);

    try {
      const detail = await this.resumeThread(threadId);
      if (!detail) {
        this.setConversationResumeState(threadId, "needs_resume");
        this.emitThreadStreamSnapshotFromRecord(threadId);
        return null;
      }

      this.setConversationResumeState(threadId, "resumed");
      this.emitThreadStreamSnapshotFromRecord(threadId);
      return this.serializeConversationSnapshot(threadId);
    } catch (error) {
      this.setConversationResumeState(threadId, "needs_resume");
      const record = this.ensureConversationRecord(threadId);
      record.streamRole = null;
      record.isStreaming = false;
      this.emitThreadStreamSnapshotFromRecord(threadId);
      throw error;
    }
  }

  private resolveLatestEditableTurn(detail: CodexThreadDetail): CodexTurnSummary | null {
    const latestTurn = detail.turns.at(-1) ?? null;
    if (!latestTurn || latestTurn.status === "inProgress") return null;

    const hasUserMessage = detail.transcript.some((entry) =>
      entry.turnId === latestTurn.turnId &&
      (entry.semanticKind === "userMessage" || entry.kind === "userMessage"));
    if (!hasUserMessage) return null;

    return latestTurn;
  }

  private materializeThreadDetailFromThreadPayload(
    thread: unknown,
    fallbackRef?: ThreadRef | null,
    fallbackCwd?: string | null,
  ): { detail: CodexThreadDetail; summary: CodexThreadSummary | null } {
    const summary = this.upsertLinkFromThread(thread, fallbackRef ?? undefined, fallbackCwd);
    const directDetail = this.buildThreadDetailFromRead(thread);
    if (directDetail) {
      return { detail: directDetail, summary };
    }

    const threadId =
      typeof thread === "object" &&
      thread !== null &&
      typeof (thread as Record<string, unknown>).id === "string"
        ? (thread as Record<string, unknown>).id as string
        : null;
    if (!threadId) {
      throw new Error("Thread action did not return a valid thread id");
    }

    const fallbackDetail = this.serializeThreadDetail(threadId);
    if (!fallbackDetail) {
      throw new Error(`Thread action completed but canonical conversation '${threadId}' is unavailable`);
    }
    return { detail: fallbackDetail, summary };
  }

  async editLastUserTurn(
    threadId: string,
    turnId: string,
    message: string,
    opts?: { serviceTier?: CodexServiceTier },
  ): Promise<CodexThreadActionResult> {
    await this.ensureClientReady();

    const currentDetail = this.serializeThreadDetail(threadId);
    if (!currentDetail) {
      throw new Error(`Thread '${threadId}' was not found`);
    }

    const latestEditableTurn = this.resolveLatestEditableTurn(currentDetail);
    if (!latestEditableTurn || latestEditableTurn.turnId !== turnId) {
      throw new Error("Only the latest completed user turn can be edited");
    }

    const rollbackResult = await this.client.request<"thread/rollback", ThreadRollbackResponse>("thread/rollback", {
      threadId,
      numTurns: 1,
    });
    const threadRef = this.parseThreadRef(threadId);
    const { detail, summary } = this.materializeThreadDetailFromThreadPayload(
      rollbackResult.thread,
      threadRef,
      currentDetail.cwd,
    );
    this.setConversationRecordDetail(detail);

    try {
      await this.startTurn(threadId, message, {
        serviceTier: opts?.serviceTier,
      });
    } catch (error) {
      if (summary) {
        this.emitEvent({ type: "threadSummary", thread: summary });
      }
      this.emitThreadStreamSnapshotFromRecord(threadId);
      throw error;
    }

    this.emitThreadStreamSnapshotFromRecord(threadId);

    return {
      threadId,
      composerIntent: this.buildComposerIntent(message),
    };
  }

  async forkConversationFromTurn(
    threadId: string,
    turnId: string,
    message: string,
  ): Promise<CodexThreadActionResult> {
    await this.ensureClientReady();

    const currentDetail = this.serializeThreadDetail(threadId);
    if (!currentDetail) {
      throw new Error(`Thread '${threadId}' was not found`);
    }

    const sourceTurnIndex = currentDetail.turns.findIndex((turn) => turn.turnId === turnId);
    if (sourceTurnIndex < 0) {
      throw new Error(`Turn '${turnId}' was not found in thread '${threadId}'`);
    }

    const sourceTurn = currentDetail.turns[sourceTurnIndex];
    if (!sourceTurn || sourceTurn.status === "inProgress") {
      throw new Error("Only completed turns can be forked");
    }

    const threadRef = this.parseThreadRef(threadId);
    if (!threadRef) {
      throw new Error(`Thread '${threadId}' is not linked to a project card`);
    }

    // Keep older-turn branching manager-owned. The visible Codex Electron bundle
    // proves that renderer sends targetTurnId to the manager, but it does not
    // prove a non-null path-based fork call in practice. For parity, fork the
    // latest thread in main and trim the new branch back to the selected turn.
    const forkParams: ThreadForkParams = {
      threadId,
      cwd: currentDetail.cwd,
      persistExtendedHistory: true,
    };
    const forkResult = await this.client.request<"thread/fork", ThreadForkResponse>("thread/fork", forkParams);
    const forkedThreadId = forkResult.thread.id;
    if (typeof forkedThreadId !== "string" || forkedThreadId.length === 0) {
      throw new Error("Thread fork did not return a valid thread id");
    }

    const turnsToDrop = currentDetail.turns.length - sourceTurnIndex - 1;
    const finalThreadPayload = turnsToDrop > 0
      ? (await this.client.request<"thread/rollback", ThreadRollbackResponse>("thread/rollback", {
          threadId: forkedThreadId,
          numTurns: turnsToDrop,
        })).thread
      : forkResult.thread;

    const { detail, summary } = this.materializeThreadDetailFromThreadPayload(
      finalThreadPayload,
      threadRef,
      currentDetail.cwd,
    );
    this.setConversationRecordDetail(detail);

    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
    }
    this.emitThreadStreamSnapshotFromRecord(detail.threadId);

    return {
      threadId: detail.threadId,
      composerIntent: this.buildComposerIntent(message),
    };
  }

  async setThreadName(threadId: string, name: string): Promise<boolean> {
    await this.ensureClientReady();
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Thread name requires a non-empty value");
    }

    await this.client.request("thread/name/set", {
      threadId,
      name: normalizedName,
    });

    this.emitThreadTitleUpdated(threadId, normalizedName);
    updateCodexThreadName(threadId, normalizedName);
    const updated = this.getThreadLinkSafely(threadId);
    if (updated) {
      this.emitEvent({ type: "threadSummary", thread: updated });
    }
    this.syncBroadcastConversationSummary(threadId, { syncCapabilityFlags: true });
    return true;
  }

  async archiveThread(threadId: string): Promise<boolean> {
    await this.ensureClientReady();
    await this.client.request("thread/archive", { threadId });
    updateCodexThreadArchived(threadId, true);
    this.emitEvent({ type: "threadArchivedState", threadId, archived: true });
    this.syncBroadcastConversationSummary(threadId, { syncCapabilityFlags: true });
    return true;
  }

  async unarchiveThread(threadId: string): Promise<CodexThreadSummary | null> {
    await this.ensureClientReady();
    const result = await this.client.request<"thread/unarchive", ThreadUnarchiveResponse>("thread/unarchive", { threadId });

    const summary = this.upsertLinkFromThread(result.thread) ?? updateCodexThreadArchived(threadId, false);
    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
      this.emitEvent({ type: "threadArchivedState", threadId, archived: false });
    }
    this.syncBroadcastConversationSummary(threadId, { syncCapabilityFlags: true });

    return summary;
  }

  async setConversationCollaborationMode(
    threadId: string,
    collaborationMode: CodexCollaborationModeKind,
  ): Promise<CodexCollaborationModeState> {
    await this.ensureClientReady();
    const nextMode = this.buildCollaborationModeState({
      collaborationMode,
      fallback: this.getConversationRecord(threadId).latestCollaborationMode,
    });
    this.setLatestCollaborationModeForThread(threadId, nextMode);
    this.syncBroadcastConversation(threadId, {
      syncLatestCollaborationMode: true,
    });
    return nextMode;
  }

  async startTurn(
    threadId: string,
    prompt: string,
    overrides?: StartTurnOverrides,
  ): Promise<CodexTurnSummary | null> {
    await this.ensureClientReady();

    const preparedPrompt = await this.preparePromptForTurn(prompt, overrides?.promptInput);
    const promptText = preparedPrompt.promptText;
    const effectiveModel = preparedPrompt.agentConfigOverrides.model ?? overrides?.model;
    const effectiveReasoningEffort = preparedPrompt.agentConfigOverrides.reasoningEffort ?? overrides?.reasoningEffort;
    const effectiveCollaborationMode = preparedPrompt.agentConfigOverrides.collaborationMode ?? overrides?.collaborationMode;

    const threadRef = this.parseThreadRef(threadId);
    const workspacePath = threadRef?.cwd?.trim()
      || (threadRef ? this.parseWorkspacePath(threadRef.projectId) : null);
    const resolvedPermissionState = await this.readPermissionState(threadRef?.projectId ?? null);
    const permissionState = this.resolvePermissionStateForRequest(
      resolvedPermissionState,
      overrides?.permissionMode,
      workspacePath,
    );
    const permissionMode = permissionState.mode;
    const turnPermissionOverrides = buildTurnPermissionOverrides({
      permissionState,
      workspacePath,
    });
    this.applyThreadPermissionState(threadId, permissionState);
    const collaborationMode = this.buildCollaborationModePayload({
      collaborationMode: effectiveCollaborationMode,
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
    });
    if (effectiveCollaborationMode) {
      this.setLatestCollaborationModeForThread(threadId, this.buildCollaborationModeState({
        collaborationMode: effectiveCollaborationMode,
        model: effectiveModel ?? null,
        reasoningEffort: effectiveReasoningEffort ?? null,
        fallback: this.getConversationRecord(threadId).latestCollaborationMode,
      }));
    }
    const startedAt = Date.now();

    this.logger.info("Starting Codex turn", {
      threadId,
      projectId: threadRef?.projectId ?? null,
      cardId: threadRef?.cardId ?? null,
      cwd: workspacePath,
      permissionMode,
      model: effectiveModel ?? null,
      serviceTier: formatServiceTierForReporting(overrides?.serviceTier),
      reasoningEffort: effectiveReasoningEffort ?? null,
      collaborationMode: effectiveCollaborationMode ?? null,
      promptLength: promptText.length,
      promptPreview: previewText(promptText),
    });

    const startTurnRequest = () => {
      const turnStartParams: TurnStartParams = {
        threadId,
        ...(workspacePath ? { cwd: workspacePath } : {}),
        ...turnPermissionOverrides,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...buildServiceTierParams(overrides?.serviceTier),
        ...(effectiveReasoningEffort ? { effort: effectiveReasoningEffort } : {}),
        ...(collaborationMode ? { collaborationMode } : {}),
        input: preparedPrompt.inputItems,
      };
      return this.client.request<"turn/start", TurnStartResponse>("turn/start", turnStartParams);
    };

    let turnStartResult: TurnStartResponse;
    try {
      turnStartResult = await startTurnRequest();
    } catch (error) {
      if (!isThreadNotFoundError(error)) throw error;

      this.logger.warn("Codex turn start hit missing thread; attempting resume", { threadId, error });
      await this.client.request("thread/resume", {
        threadId,
        persistExtendedHistory: THREAD_RESUME_PERSIST_EXTENDED_HISTORY,
        ...buildThreadPermissionOverrides({
          permissionState,
        }),
      });
      turnStartResult = await startTurnRequest();
    }

    const startedTurn = this.asTurnSummary(threadId, turnStartResult.turn);
    if (startedTurn) {
      const observedTurn: CodexTurnSummary = {
        ...startedTurn,
        turnStartedAtMs: startedTurn.turnStartedAtMs ?? Date.now(),
      };
      this.mergeTurn(threadId, observedTurn);
      const optimisticUserAttachments = buildCodexUserAttachmentsFromContent(
        preparedPrompt.inputItems,
        `optimistic:${observedTurn.turnId}`,
      );
      this.seedTurnWithOptimisticUserMessage(
        threadId,
        observedTurn.turnId,
        promptText,
        optimisticUserAttachments.length > 0 ? optimisticUserAttachments : undefined,
      );
      this.clearPausedQueuedFollowUps(threadId, false);
      this.markThreadAsActive(threadId);
      this.emitThreadStreamSnapshotFromRecord(threadId);
      this.logger.info("Started Codex turn", {
        threadId,
        turnId: observedTurn.turnId,
        durationMs: Date.now() - startedAt,
      });
      return this.getKnownTurn(threadId, observedTurn.turnId) ?? observedTurn;
    }

    this.markThreadAsActive(threadId);
    this.clearPausedQueuedFollowUps(threadId, false);
    this.emitThreadStreamSnapshotFromRecord(threadId);
    const detail = this.serializeThreadDetail(threadId);
    if (!detail || detail.turns.length === 0) return null;
    this.logger.info("Started Codex turn from canonical conversation state", {
      threadId,
      durationMs: Date.now() - startedAt,
    });
    return detail.turns[detail.turns.length - 1];
  }

  async sendQueuedFollowUpNow(threadId: string, followUpId: string): Promise<void> {
    const followUp = this.getQueuedFollowUp(threadId, followUpId);
    if (!followUp) return;
    this.dequeueQueuedFollowUp(threadId, followUpId);
    try {
      await this.submitQueuedFollowUp(threadId, followUp);
    } catch (error) {
      this.restoreQueuedFollowUp(
        threadId,
        followUp,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async steerTurn(
    threadId: string,
    expectedTurnId: string,
    prompt: string,
  ): Promise<{ turnId: string } | null> {
    await this.ensureClientReady();

    const parsedPrompt = splitPromptTextAndAgentConfigLines(prompt);
    if (parsedPrompt.agentConfigs.length > 0) {
      throw new Error("Agent config cannot be steered into a running turn. Wait for the turn to finish or queue a follow-up.");
    }
    const promptText = parsedPrompt.text.trim();
    if (!promptText) {
      throw new Error("Turn steer requires a non-empty prompt");
    }

    this.logger.info("Steering Codex turn", {
      threadId,
      expectedTurnId,
      promptLength: promptText.length,
      promptPreview: previewText(promptText),
    });

    const steerParams: TurnSteerParams = {
      threadId,
      expectedTurnId,
      input: [createTextUserInput(promptText)],
    };
    const steerId = this.recordPendingSteer(threadId, expectedTurnId, promptText);
    let result: TurnSteerResponse;
    try {
      result = await this.client.request<"turn/steer", TurnSteerResponse>("turn/steer", steerParams);
    } catch (error) {
      this.clearPendingSteer(threadId, steerId);
      throw error;
    }

    if (typeof result.turnId !== "string") {
      this.clearPendingSteer(threadId, steerId);
      this.logger.warn("Codex turn steer returned no turn id", { threadId, expectedTurnId });
      return null;
    }
    this.clearPausedQueuedFollowUps(threadId);
    this.logger.info("Steered Codex turn", {
      threadId,
      expectedTurnId,
      turnId: result.turnId,
    });
    return { turnId: result.turnId };
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<boolean> {
    await this.ensureClientReady();

    const resolvedTurnId = await this.resolveInterruptTurnId(threadId, turnId);
    if (!resolvedTurnId) {
      throw new Error("Could not determine which turn to interrupt");
    }

    this.logger.warn("Interrupting Codex turn", {
      threadId,
      requestedTurnId: turnId ?? null,
      resolvedTurnId,
    });

    await this.client.request("turn/interrupt", {
      threadId,
      turnId: resolvedTurnId,
    });

    const knownTurn = this.getKnownTurn(threadId, resolvedTurnId);
    if (!knownTurn || knownTurn.status !== "inProgress") {
      return true;
    }

    const interruptedTurn: CodexTurnSummary = {
      ...knownTurn,
      status: "interrupted",
      interruptedCommandExecutionItemIds: [
        ...(knownTurn.interruptedCommandExecutionItemIds ?? []),
        ...this.listRecordedInterruptedCommandExecutionItemIds(threadId, resolvedTurnId),
      ],
    };
    this.mergeTurn(threadId, interruptedTurn);
    this.syncThreadStatusFromKnownTurns(threadId);
    this.reconcileTurnItemsToTerminalStatus(threadId, resolvedTurnId, "interrupted");
    this.emitEvent({ type: "turn", turn: interruptedTurn });
    this.emitThreadStreamSnapshotFromRecord(threadId);
    this.maybeDispatchQueuedFollowUp(threadId);
    return true;
  }

  async cleanBackgroundTerminals(threadId: string): Promise<boolean> {
    await this.ensureClientReady();

    const conversation = this.serializeConversationSnapshot(threadId);
    if (!conversation) {
      return false;
    }

    const backgroundTerminalTurnIds = [...new Set(
      this.collectBackgroundTerminalRows(conversation).map(({ turnId }) => turnId),
    )];
    if (backgroundTerminalTurnIds.length === 0) {
      return true;
    }

    this.logger.warn("Cleaning background terminals", {
      threadId,
      turnIds: backgroundTerminalTurnIds,
    });

    for (const backgroundTurnId of backgroundTerminalTurnIds) {
      await this.interruptTurn(threadId, backgroundTurnId);
    }

    return true;
  }

  async respondToApproval(requestId: string, decision: CodexApprovalDecision): Promise<boolean> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    const record = this.getConversationRecord(pending.request.threadId);

    this.logger.info("Resolving Codex approval request", {
      requestId,
      decision,
      kind: pending.request.kind,
      threadId: pending.request.threadId,
      turnId: pending.request.turnId,
      streamRole: record.streamRole,
    });
    if (record.streamRole === "follower") {
      await this.client.request(
        pending.request.kind === "command"
          ? THREAD_FOLLOWER_COMMAND_APPROVAL_DECISION_METHOD
          : THREAD_FOLLOWER_FILE_APPROVAL_DECISION_METHOD,
        {
          conversationId: pending.request.threadId,
          requestId,
          decision,
        },
      );
      this.pendingApprovals.delete(requestId);
    } else {
      pending.resolve({ decision });
      this.pendingApprovals.delete(requestId);
    }
    this.clearApprovalRequestAttachment(
      pending.request.threadId,
      pending.request.turnId,
      pending.request.itemId,
      requestId,
    );
    this.emitEvent({ type: "approvalResolved", requestId, decision });
    this.syncBroadcastConversationTurnState(pending.request.threadId, pending.request.turnId, {
      syncRequests: true,
      syncCapabilityFlags: true,
    });
    return true;
  }

  async respondToUserInput(
    requestId: string,
    answers: Record<string, string[]>,
  ): Promise<boolean> {
    const pending = this.pendingUserInputs.get(requestId);
    if (!pending) return false;

    const normalizedAnswers = Object.entries(answers).reduce<Record<string, { answers: string[] }>>(
      (acc, [questionId, values]) => {
        if (!Array.isArray(values)) {
          acc[questionId] = { answers: [] };
          return acc;
        }
        acc[questionId] = {
          answers: values.filter((value): value is string => typeof value === "string"),
        };
        return acc;
      },
      {},
    );
    const transcriptAnswers = Object.entries(normalizedAnswers).reduce<Record<string, string[]>>((acc, [questionId, value]) => {
      acc[questionId] = value.answers;
      return acc;
    }, {});

    pending.resolve({ answers: normalizedAnswers });
    this.pendingUserInputs.delete(requestId);
    this.logger.info("Resolving Codex user-input request", {
      requestId,
      threadId: pending.request.threadId,
      turnId: pending.request.turnId,
      questionCount: pending.request.questions.length,
      answeredQuestionCount: Object.keys(normalizedAnswers).length,
    });
    const resolvedEntry = this.upsertResolvedUserInputItem(pending.request, transcriptAnswers);
    void resolvedEntry;
    this.emitEvent({ type: "userInputResolved", requestId });
    this.syncBroadcastConversationTurnState(pending.request.threadId, pending.request.turnId, {
      syncRequests: true,
      syncCapabilityFlags: true,
    });
    return true;
  }

  async respondToMcpServerElicitation(
    requestId: string,
    action: CodexMcpServerElicitationAction,
  ): Promise<boolean> {
    const pending = this.pendingMcpElicitations.get(requestId);
    if (!pending) return false;

    this.logger.info("Resolving Codex MCP elicitation request", {
      requestId,
      action,
      threadId: pending.request.threadId,
      turnId: pending.request.turnId,
    });

    pending.resolve({
      action,
      content: null,
      _meta: null,
    });
    this.pendingMcpElicitations.delete(requestId);
    void this.upsertMcpServerElicitationItem(pending.request, {
      completed: true,
      action,
    });
    this.syncBroadcastConversationTurnState(pending.request.threadId, pending.request.turnId, {
      syncRequests: true,
      syncCapabilityFlags: true,
    });
    return true;
  }

  private upsertResolvedUserInputItem(
    request: CodexUserInputRequest,
    answers: Record<string, string[]>,
  ): CodexTranscriptEntry | null {
    const itemId = this.buildUserInputResponseItemId(request.requestId);
    this.upsertCanonicalTurnItem(request.threadId, request.turnId, itemId, "inProgress");
    return this.mergeItem({
      threadId: request.threadId,
      turnId: request.turnId,
      itemId,
      type: "request_user_input",
      normalizedKind: "userInputResponse",
      semanticKind: "userInputResponse",
      status: "completed",
      markdownText: request.questions.length === 1 ? "Asked 1 question" : `Asked ${request.questions.length} questions`,
      userInputQuestions: request.questions,
      userInputAnswers: answers,
      rawItem: {
        id: itemId,
        type: "userInputResponse",
        requestId: request.requestId,
        turnId: request.turnId,
        questions: request.questions,
        answers,
        completed: true,
      },
      createdAt: request.createdAt,
      updatedAt: Date.now(),
    });
  }

  private upsertMcpServerElicitationItem(
    request: CodexMcpServerElicitationRequest,
    options: { completed: boolean; action?: CodexMcpServerElicitationAction | null },
  ): CodexTranscriptEntry | null {
    const itemId = this.buildMcpServerElicitationItemId(request.requestId);
    this.upsertCanonicalTurnItem(request.threadId, request.turnId, itemId, "inProgress");
    return this.mergeItem({
      threadId: request.threadId,
      turnId: request.turnId,
      itemId,
      type: "mcpServerElicitation",
      normalizedKind: "systemEvent",
      semanticKind: "mcpServerElicitation",
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
        action: options.action ?? null,
        serverName: request.serverName,
        message: request.message,
      },
      createdAt: request.createdAt,
      updatedAt: Date.now(),
    });
  }

  private syncPlanImplementationForTurn(threadId: string, turnId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    const byItem = record?.itemsByTurn.get(turnId);
    if (!byItem || byItem.size === 0) return;

    const items = Array.from(byItem.values());
    const latestPlan = items
      .filter((item) => item.type === "plan" && (item.markdownText?.trim().length ?? 0) > 0)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .at(-1);
    const planContent = latestPlan?.markdownText?.trim() ?? "";
    const existing = this.getRecordedItem(threadId, turnId, buildPlanImplementationRequestId(turnId));

    if (planContent.length === 0) {
      this.removePlanImplementationRequestFromRecord(threadId, turnId);
      if (!existing) return;
      this.mergeItem(this.buildPlanImplementationItemView({
        threadId,
        turnId,
        planContent: existing.markdownText ?? "",
        isCompleted: true,
      }));
      return;
    }

    this.upsertCanonicalTurnItem(threadId, turnId, buildPlanImplementationRequestId(turnId), "completed");
    const item = this.buildPlanImplementationItemView({
      threadId,
      turnId,
      planContent,
      isCompleted: false,
    });
    this.mergeItem(item);
    this.upsertPlanImplementationRequest(threadId, turnId, planContent, item.createdAt);
  }

  private completeStalePlanImplementationItems(threadId: string, activeTurnId: string): void {
    const turns = this.listKnownTurns(threadId);
    for (const turn of turns) {
      if (turn.turnId === activeTurnId) continue;
      this.removePlanImplementationRequestFromRecord(threadId, turn.turnId);
      const existing = this.getRecordedItem(threadId, turn.turnId, buildPlanImplementationRequestId(turn.turnId));
      if (!existing || existing.status === "completed") continue;
      this.mergeItem(this.buildPlanImplementationItemView({
        threadId,
        turnId: turn.turnId,
        planContent: existing.markdownText ?? "",
        isCompleted: true,
      }));
    }
  }

  async removePlanImplementationRequest(threadId: string, turnId: string): Promise<boolean> {
    const existing = this.getRecordedItem(threadId, turnId, buildPlanImplementationRequestId(turnId));
    this.removePlanImplementationRequestFromRecord(threadId, turnId);

    if (existing && existing.status !== "completed") {
      this.mergeItem(this.buildPlanImplementationItemView({
        threadId,
        turnId,
        planContent: existing.markdownText ?? "",
        isCompleted: true,
      }));
    }

    this.syncBroadcastConversationTurnState(threadId, turnId, {
      syncRequests: true,
      syncCapabilityFlags: true,
    });
    return true;
  }

  private async handleServerRequest(request: CodexServerRequest): Promise<unknown> {
    this.logger.info("Handling Codex server request", {
      requestId: String(request.id),
      method: request.method,
    });

    if (request.method === "item/commandExecution/requestApproval") {
      return this.handleApprovalRequest(
        String(request.id),
        request.params as CommandExecutionRequestApprovalParams,
        "command",
      );
    }

    if (request.method === "item/fileChange/requestApproval") {
      return this.handleApprovalRequest(
        String(request.id),
        request.params as FileChangeRequestApprovalParams,
        "file",
      );
    }

    if (request.method === "item/tool/requestUserInput") {
      return this.handleRequestUserInput(String(request.id), request.params as ToolRequestUserInputParams);
    }

    if (request.method === "mcpServer/elicitation/request") {
      return this.handleMcpServerElicitationRequest(
        String(request.id),
        request.params as McpServerElicitationRequestParams,
      );
    }

    if (request.method === "item/tool/call") {
      throw new Error("Dynamic tool calls are not supported in this Nodex release");
    }

    throw new Error(`Unsupported server request method: ${request.method}`);
  }

  private async handleApprovalRequest(
    requestId: string,
    params: CommandExecutionRequestApprovalParams | FileChangeRequestApprovalParams,
    kind: "command" | "file",
  ): Promise<CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse> {
    const threadId = params.threadId;
    const turnId = params.turnId;
    const itemId = params.itemId;

    if (!threadId || !turnId || !itemId) {
      return { decision: "decline" as const };
    }

    const ref = this.parseThreadRef(threadId);

    const payload: CodexApprovalRequest = {
      type: "approval",
      requestId,
      kind,
      projectId: ref?.projectId ?? null,
      cardId: ref?.cardId ?? null,
      threadId,
      turnId,
      itemId,
      approvalId: "approvalId" in params ? params.approvalId ?? null : null,
      approvalRequestId: requestId,
      callId: itemId,
      reason: params.reason ?? undefined,
      command: "command" in params ? params.command ?? undefined : undefined,
      cwd: "cwd" in params ? params.cwd ?? undefined : undefined,
      approvalReason: params.reason ?? undefined,
      cmd: "command" in params && typeof params.command === "string"
        ? params.command.split(" ").filter((segment) => segment.trim().length > 0)
        : undefined,
      networkApprovalContext: "networkApprovalContext" in params
        ? params.networkApprovalContext
          ? {
              host: params.networkApprovalContext.host,
              protocol: params.networkApprovalContext.protocol,
            }
          : null
        : null,
      proposedExecpolicyAmendment: "proposedExecpolicyAmendment" in params
        ? params.proposedExecpolicyAmendment ?? null
        : null,
      proposedNetworkPolicyAmendments: "proposedNetworkPolicyAmendments" in params
        ? params.proposedNetworkPolicyAmendments?.map((amendment) => ({
            host: amendment.host,
            action: amendment.action,
          })) ?? null
        : null,
      availableDecisions: "availableDecisions" in params
        ? params.availableDecisions?.map((decision) =>
            typeof decision === "string" ? decision : Object.keys(decision)[0] ?? ""
          ).filter((decision) => decision.length > 0) ?? null
        : null,
      grantRoot: "grantRoot" in params ? params.grantRoot ?? null : null,
      commandActions: "commandActions" in params ? params.commandActions ?? null : null,
      createdAt: Date.now(),
    };

    const permissionState = await this.readPermissionState(ref?.projectId ?? null);
    const mode = permissionState.mode;
    this.logger.info("Received Codex approval request", {
      requestId,
      kind,
      projectId: payload.projectId,
      cardId: payload.cardId,
      threadId,
      turnId,
      itemId,
      mode,
      command: payload.command ?? null,
      cwd: payload.cwd ?? null,
      reason: payload.reason ?? null,
    });
    if (permissionState.effectivePreset === "full-access") {
      this.logger.warn("Auto-accepting Codex approval request due to full-access mode", {
        requestId,
        kind,
        threadId,
        turnId,
      });
      this.emitEvent({ type: "approvalResolved", requestId, decision: "accept" });
      return { decision: "accept" };
    }

    if (kind === "command") {
      this.attachCommandExecutionApprovalRequest(requestId, params as CommandExecutionRequestApprovalParams);
    } else {
      this.attachFileChangeApprovalRequest(requestId, params as FileChangeRequestApprovalParams);
    }

    return await new Promise<CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse>((resolve, reject) => {
      this.pendingApprovals.set(requestId, {
        request: payload,
        resolve,
        reject,
      });
      if (kind === "command") {
        this.syncBroadcastConversationTurnState(threadId, turnId, {
          syncRequests: true,
          syncCapabilityFlags: true,
        });
      } else {
        this.syncBroadcastConversationRequests(threadId, { syncCapabilityFlags: true });
      }
      this.emitEvent({ type: "approvalRequested", request: payload });
    });
  }

  private attachCommandExecutionApprovalRequest(
    requestId: string,
    params: CommandExecutionRequestApprovalParams,
  ): void {
    const existing = this.getRecordedItem(params.threadId, params.turnId, params.itemId);
    const existingRawItem = asRecord(existing?.rawItem);
    const now = Date.now();
    const command = params.command ?? existing?.command ?? "";
    const cwd = params.cwd ?? existing?.cwd ?? null;
    const commandActions = params.commandActions ?? existing?.commandActions ?? [];
    const next: CodexItemView = {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      type: existing?.type ?? "commandExecution",
      normalizedKind: "commandExecution",
      semanticKind: existing?.semanticKind ?? "exec",
      status: existing?.status ?? "inProgress",
      toolCall: {
        subtype: "command",
        toolName: "bash",
        args: {
          command,
          cwd: cwd ?? undefined,
          commandActions: commandActions.length > 0 ? commandActions : undefined,
        },
        result: existing?.aggregatedOutput ?? undefined,
        error: existing?.toolCall?.error,
      },
      command,
      cwd,
      processId: existing?.processId ?? null,
      commandActions,
      aggregatedOutput: existing?.aggregatedOutput ?? null,
      exitCode: existing?.exitCode ?? null,
      durationMs: existing?.durationMs ?? null,
      approvalRequestId: requestId,
      networkApprovalContext: params.networkApprovalContext ?? null,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
      grantRoot: existing?.grantRoot ?? null,
      rawItem: {
        ...(existingRawItem ?? {}),
        id: params.itemId,
        type: existing?.type ?? "commandExecution",
        command,
        cwd,
        commandActions,
        approvalRequestId: requestId,
        networkApprovalContext: params.networkApprovalContext ?? null,
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const turn = this.getKnownTurn(params.threadId, params.turnId);
    if (turn && !turn.itemIds.includes(params.itemId)) {
      this.mergeTurn(params.threadId, {
        ...turn,
        itemIds: [...turn.itemIds, params.itemId],
      });
    }

    this.mergeItem(next);
  }

  private attachFileChangeApprovalRequest(
    requestId: string,
    params: FileChangeRequestApprovalParams,
  ): void {
    const existing = this.getRecordedItem(params.threadId, params.turnId, params.itemId);
    if (!existing) {
      return;
    }

    this.mergeItem({
      ...existing,
      approvalRequestId: requestId,
      grantRoot: params.grantRoot ?? existing.grantRoot ?? null,
      rawItem: {
        ...(asRecord(existing.rawItem) ?? {}),
        approvalRequestId: requestId,
        grantRoot: params.grantRoot ?? existing.grantRoot ?? null,
      },
      updatedAt: Date.now(),
    });
  }

  private clearApprovalRequestAttachment(
    threadId: string,
    turnId: string,
    itemId: string,
    requestId: string,
  ): void {
    const existing = this.getRecordedItem(threadId, turnId, itemId);
    if (!existing || existing.approvalRequestId !== requestId) {
      return;
    }

    this.mergeItem({
      ...existing,
      approvalRequestId: null,
      networkApprovalContext: null,
      proposedExecpolicyAmendment: null,
      grantRoot: null,
      updatedAt: Date.now(),
    });
  }

  private async handleRequestUserInput(
    requestId: string,
    params: ToolRequestUserInputParams,
  ): Promise<ToolRequestUserInputResponse> {
    const threadId = params.threadId;
    const turnId = params.turnId;
    const itemId = params.itemId;

    if (!threadId || !turnId || !itemId) {
      throw new Error("Invalid tool request_user_input payload");
    }

    const ref = this.parseThreadRef(threadId);
    const questions = params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isOther: question.isOther,
      isSecret: question.isSecret,
      options: question.options?.map((option) => ({
        label: option.label,
        description: option.description,
      })),
    }));

    const payload: CodexUserInputRequest = {
      type: "userInput",
      requestId,
      projectId: ref?.projectId ?? null,
      cardId: ref?.cardId ?? null,
      threadId,
      turnId,
      itemId,
      questions,
      createdAt: Date.now(),
    };

    this.logger.info("Received Codex user-input request", {
      requestId,
      projectId: payload.projectId,
      cardId: payload.cardId,
      threadId,
      turnId,
      itemId,
      questionCount: questions.length,
      questionIds: questions.map((question) => question.id),
    });
    return await new Promise<{ answers: Record<string, { answers: string[] }> }>((resolve, reject) => {
      this.pendingUserInputs.set(requestId, {
        request: payload,
        resolve,
        reject,
      });
      this.syncBroadcastConversationRequests(threadId, { syncCapabilityFlags: true });
      this.emitEvent({ type: "userInputRequested", request: payload });
    });
  }

  private async handleMcpServerElicitationRequest(
    requestId: string,
    params: McpServerElicitationRequestParams,
  ): Promise<McpServerElicitationRequestResponse> {
    const threadId = params.threadId;
    if (!threadId) {
      return { action: "cancel", content: null, _meta: null };
    }

    const ref = this.parseThreadRef(threadId);
    const payload: CodexMcpServerElicitationRequest = {
      type: "mcpServerElicitation",
      requestId,
      projectId: ref?.projectId ?? null,
      cardId: ref?.cardId ?? null,
      threadId,
      turnId: params.turnId ?? requestId,
      itemId: requestId,
      kind: params.mode === "url" ? "toolSuggestion" : "generic",
      mode: params.mode,
      serverName: params.serverName,
      message: params.message,
      url: params.mode === "url" ? params.url : undefined,
      elicitationId: params.mode === "url" ? params.elicitationId : undefined,
      requestedSchema: params.mode === "form" ? params.requestedSchema : undefined,
      meta: params._meta,
      createdAt: Date.now(),
    };

    this.logger.info("Received Codex MCP elicitation request", {
      requestId,
      projectId: payload.projectId,
      cardId: payload.cardId,
      threadId,
      turnId: payload.turnId,
      mode: params.mode,
      serverName: params.serverName,
    });
    void this.upsertMcpServerElicitationItem(payload, {
      completed: false,
      action: null,
    });

    return await new Promise<McpServerElicitationRequestResponse>((resolve, reject) => {
      this.pendingMcpElicitations.set(requestId, {
        request: payload,
        resolve,
        reject,
      });
      this.syncBroadcastConversationTurnState(threadId, payload.turnId, {
        syncRequests: true,
        syncCapabilityFlags: true,
      });
    });
  }

  private applyFrameTextDeltas(updates: FrameTextDeltaUpdate[]): void {
    if (updates.length === 0) return;

    const updatesByThreadId = new Map<string, FrameTextDeltaUpdate[]>();
    for (const update of updates) {
      this.ensureConversationDetail(update.threadId);
      const record = this.ensureConversationRecord(update.threadId);
      const byItem = record.itemsByTurn.get(update.turnId) ?? new Map<string, CodexItemView>();
      const itemKey = resolveCodexItemPrimaryIdentityKey({
        turnId: update.turnId,
        itemId: update.itemId,
      });
      const existing = byItem.get(itemKey);
      const now = Date.now();

      if (!existing) {
        this.logger.warn("Skipping frame-text delta for unknown conversation item", {
          threadId: update.threadId,
          turnId: update.turnId,
          itemId: update.itemId,
          target: update.target.type,
          deltaPreview: previewText(update.delta),
        });
        continue;
      }

      if (update.target.type === "agentMessage" || update.target.type === "plan") {
        if (update.target.type === "agentMessage") {
          this.markFinalAssistantStartedAt(update.threadId, update.turnId, update.observedAtMs);
        }
        const nextText = `${existing.markdownText ?? ""}${update.delta}`;
        const next: CodexItemView = {
          ...existing,
          markdownText: nextText,
          updatedAt: now,
        };

        byItem.set(itemKey, next);
        record.itemsByTurn.set(update.turnId, byItem);
        const entry = projectItemToLiveTranscriptEntry(
          next,
          "live",
          this.getThreadTranscript(update.threadId),
          this.getKnownTurn(update.threadId, update.turnId)?.itemIds,
        );
        this.setThreadTranscript(
          update.threadId,
          applyLiveTranscriptMutation(this.getThreadTranscript(update.threadId), {
            type: "upsert",
            entry,
          }),
        );
        const threadUpdates = updatesByThreadId.get(update.threadId);
        if (threadUpdates) {
          threadUpdates.push(update);
        } else {
          updatesByThreadId.set(update.threadId, [update]);
        }
        continue;
      }

      const existingBuffers = this.parseReasoningBuffers(existing);
      const nextSummary = [...existingBuffers.summary];
      const nextContent = [...existingBuffers.content];
      if (update.target.type === "reasoningSummary") {
        while (nextSummary.length <= update.target.summaryIndex) nextSummary.push("");
        nextSummary[update.target.summaryIndex] = `${nextSummary[update.target.summaryIndex] ?? ""}${update.delta}`;
      } else if (update.target.type === "reasoningContent") {
        while (nextContent.length <= update.target.contentIndex) nextContent.push("");
        nextContent[update.target.contentIndex] = `${nextContent[update.target.contentIndex] ?? ""}${update.delta}`;
      } else {
        continue;
      }

      const next: CodexItemView = {
        ...existing,
        markdownText: projectCodexReasoningSummary(nextSummary),
        rawItem: {
          ...(asRecord(existing.rawItem) ?? {}),
          id: update.itemId,
          type: "reasoning",
          summary: nextSummary,
          content: nextContent,
        },
        updatedAt: now,
      };

      byItem.set(itemKey, next);
      record.itemsByTurn.set(update.turnId, byItem);
      const entry = projectItemToLiveTranscriptEntry(
        next,
        "live",
        this.getThreadTranscript(update.threadId),
        this.getKnownTurn(update.threadId, update.turnId)?.itemIds,
      );
      this.setThreadTranscript(
        update.threadId,
        applyLiveTranscriptMutation(this.getThreadTranscript(update.threadId), {
          type: "upsert",
          entry,
        }),
      );
      const threadUpdates = updatesByThreadId.get(update.threadId);
      if (threadUpdates) {
        threadUpdates.push(update);
      } else {
        updatesByThreadId.set(update.threadId, [update]);
      }
    }

    if (updatesByThreadId.size === 0) return;
    for (const [threadId, threadUpdates] of updatesByThreadId.entries()) {
      this.mutateBroadcastConversationState(threadId, (draft) => {
        for (const update of threadUpdates) {
          const turn = draft.turns.find((candidate) => candidate.turnId === update.turnId);
          if (!turn) {
            throw new Error(`Missing broadcast turn for frame-text delta: ${update.turnId}`);
          }

          const item = turn.items.find((candidate) => candidate.itemId === update.itemId);
          if (!item) {
            throw new Error(`Missing broadcast item for frame-text delta: ${update.itemId}`);
          }

          switch (update.target.type) {
            case "agentMessage":
              turn.turnStartedAtMs = turn.turnStartedAtMs ?? update.observedAtMs;
              turn.finalAssistantStartedAtMs = update.observedAtMs;
              item.markdownText = `${item.markdownText ?? ""}${update.delta}`;
              break;
            case "plan":
              item.markdownText = `${item.markdownText ?? ""}${update.delta}`;
              break;
            case "reasoningSummary": {
              const rawItem = item.rawItem && typeof item.rawItem === "object"
                ? { ...(item.rawItem as Record<string, unknown>) }
                : {};
              const existingSummary = Array.isArray(rawItem.summary)
                ? rawItem.summary.map((value) => String(value ?? ""))
                : [];
              while (existingSummary.length <= update.target.summaryIndex) existingSummary.push("");
              existingSummary[update.target.summaryIndex] =
                `${existingSummary[update.target.summaryIndex] ?? ""}${update.delta}`;
              rawItem.summary = existingSummary;
              item.rawItem = rawItem;
              item.markdownText = projectCodexReasoningSummary(existingSummary);
              break;
            }
            case "reasoningContent": {
              const rawItem = item.rawItem && typeof item.rawItem === "object"
                ? { ...(item.rawItem as Record<string, unknown>) }
                : {};
              const existingContent = Array.isArray(rawItem.content)
                ? rawItem.content.map((value) => String(value ?? ""))
                : [];
              while (existingContent.length <= update.target.contentIndex) existingContent.push("");
              existingContent[update.target.contentIndex] =
                `${existingContent[update.target.contentIndex] ?? ""}${update.delta}`;
              rawItem.content = existingContent;
              item.rawItem = rawItem;
              break;
            }
          }
        }
      });
    }
  }

  private applyOutputDeltas(updates: OutputDeltaUpdate[]): void {
    if (updates.length === 0) return;

    const updatesByThreadId = new Map<string, OutputDeltaUpdate[]>();
    for (const update of updates) {
      this.ensureConversationDetail(update.threadId);
      const record = this.ensureConversationRecord(update.threadId);
      const byItem = record.itemsByTurn.get(update.turnId) ?? new Map<string, CodexItemView>();
      const itemKey = resolveCodexItemPrimaryIdentityKey({
        turnId: update.turnId,
        itemId: update.itemId,
      });
      const existing = byItem.get(itemKey);
      const now = Date.now();
      if (!existing) {
        this.logger.warn("Skipping command output delta for unknown conversation item", {
          threadId: update.threadId,
          turnId: update.turnId,
          itemId: update.itemId,
          deltaPreview: previewText(update.delta),
        });
        continue;
      }

      const currentOutput = parseStoredAggregatedOutput(existing?.aggregatedOutput);
      const mergedOutput = truncateBufferedOutput({
        existingText: currentOutput.text,
        nextDelta: update.delta,
      });
      const nextOutput = formatStoredAggregatedOutput({
        text: mergedOutput.text,
        truncated: currentOutput.truncated || Boolean(update.truncated) || mergedOutput.truncated,
      });
      const next: CodexItemView = {
        ...existing,
        command: existing.command ?? "",
        cwd: existing.cwd ?? null,
        processId: existing.processId ?? null,
        commandActions: existing.commandActions ?? [],
        aggregatedOutput: nextOutput,
        exitCode: existing.exitCode ?? null,
        durationMs: existing.durationMs ?? null,
        toolCall: existing.toolCall
          ? {
              ...existing.toolCall,
              result: nextOutput,
            }
          : existing.toolCall,
        rawItem: {
          ...(asRecord(existing.rawItem) ?? {}),
          aggregatedOutput: nextOutput,
        },
        updatedAt: now,
      };

      byItem.set(itemKey, next);
      record.itemsByTurn.set(update.turnId, byItem);
      const entry = projectItemToLiveTranscriptEntry(
        next,
        "live",
        this.getThreadTranscript(update.threadId),
        this.getKnownTurn(update.threadId, update.turnId)?.itemIds,
      );
      this.setThreadTranscript(
        update.threadId,
        applyLiveTranscriptMutation(this.getThreadTranscript(update.threadId), {
          type: "upsert",
          entry,
        }),
      );
      const threadUpdates = updatesByThreadId.get(update.threadId);
      if (threadUpdates) {
        threadUpdates.push(update);
      } else {
        updatesByThreadId.set(update.threadId, [update]);
      }
    }

    if (updatesByThreadId.size === 0) return;
    for (const [threadId, threadUpdates] of updatesByThreadId.entries()) {
      this.mutateBroadcastConversationState(threadId, (draft) => {
        for (const update of threadUpdates) {
          const turn = draft.turns.find((candidate) => candidate.turnId === update.turnId);
          if (!turn) {
            throw new Error(`Missing broadcast turn for output delta: ${update.turnId}`);
          }

          const item = turn.items.find((candidate) => candidate.itemId === update.itemId);
          if (!item) {
            throw new Error(`Missing broadcast item for output delta: ${update.itemId}`);
          }

          const currentOutput = parseStoredAggregatedOutput(item.aggregatedOutput);
          const mergedOutput = truncateBufferedOutput({
            existingText: currentOutput.text,
            nextDelta: update.delta,
          });
          const nextOutput = formatStoredAggregatedOutput({
            text: mergedOutput.text,
            truncated: currentOutput.truncated || Boolean(update.truncated) || mergedOutput.truncated,
          });
          item.aggregatedOutput = nextOutput;
          if (item.toolCall) {
            item.toolCall = {
              ...item.toolCall,
              result: nextOutput,
            };
          }
          if (item.rawItem && typeof item.rawItem === "object") {
            item.rawItem = {
              ...(item.rawItem as Record<string, unknown>),
              aggregatedOutput: nextOutput,
            };
          }
        }
      });
    }
  }

  private resolvePendingServerRequest(requestId: string): void {
    let emittedApprovalResolved = false;
    let emittedUserInputResolved = false;

    this.logger.info("Resolving pending Codex server request from server notification", {
      requestId,
      pendingApproval: this.pendingApprovals.has(requestId),
      pendingUserInput: this.pendingUserInputs.has(requestId),
      pendingMcpElicitation: this.pendingMcpElicitations.has(requestId),
    });

    const pendingApproval = this.pendingApprovals.get(requestId);
    if (pendingApproval) {
      pendingApproval.resolve({ decision: "cancel" });
      this.pendingApprovals.delete(requestId);
      this.clearApprovalRequestAttachment(
        pendingApproval.request.threadId,
        pendingApproval.request.turnId,
        pendingApproval.request.itemId,
        String(requestId),
      );
      this.emitEvent({ type: "approvalResolved", requestId, decision: "cancel" });
      this.syncBroadcastConversationTurnState(pendingApproval.request.threadId, pendingApproval.request.turnId, {
        syncRequests: true,
        syncCapabilityFlags: true,
      });
      emittedApprovalResolved = true;
    }

    const pendingUserInput = this.pendingUserInputs.get(requestId);
    if (pendingUserInput) {
      pendingUserInput.resolve({ answers: {} });
      this.pendingUserInputs.delete(requestId);
      this.emitEvent({ type: "userInputResolved", requestId });
      this.syncBroadcastConversationRequests(pendingUserInput.request.threadId, { syncCapabilityFlags: true });
      emittedUserInputResolved = true;
    }

    const pendingMcpElicitation = this.pendingMcpElicitations.get(requestId);
    if (pendingMcpElicitation) {
      pendingMcpElicitation.resolve({ action: "cancel", content: null, _meta: null });
      this.pendingMcpElicitations.delete(requestId);
      this.syncBroadcastConversationRequests(pendingMcpElicitation.request.threadId, { syncCapabilityFlags: true });
    }

    if (!emittedApprovalResolved) {
      this.emitEvent({ type: "approvalResolved", requestId, decision: "cancel" });
    }
    if (!emittedUserInputResolved) {
      this.emitEvent({ type: "userInputResolved", requestId });
    }
  }

  private listPendingConversationRequests(threadId: string): CodexConversationServerRequest[] {
    this.reconcilePlanImplementationRequests(threadId);
    const approvals = Array.from(this.pendingApprovals.values())
      .map((pending) => pending.request)
      .filter((request) => request.threadId === threadId);
    const userInputs = Array.from(this.pendingUserInputs.values())
      .map((pending) => pending.request)
      .filter((request) => request.threadId === threadId);
    const mcpElicitations = Array.from(this.pendingMcpElicitations.values())
      .map((pending) => pending.request)
      .filter((request) => request.threadId === threadId);
    const planImplementationRequests = Array.from(
      this.getConversationRecord(threadId).planImplementationRequestsByTurnId.values(),
    );

    return [...approvals, ...userInputs, ...mcpElicitations, ...planImplementationRequests]
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private async handleNotification(method: string, params: unknown): Promise<void> {
    if (method === "thread/started") {
      const thread =
        typeof params === "object" && params !== null
          ? (params as Record<string, unknown>).thread
          : null;

      const summary = this.upsertLinkFromThread(thread);
      if (summary) {
        this.logger.info("Received Codex thread started notification", {
          threadId: summary.threadId,
          projectId: summary.projectId,
          cardId: summary.cardId,
        });
        this.emitEvent({ type: "threadSummary", thread: summary });
        this.emitThreadStreamSnapshotFromRecord(summary.threadId);
      }
      return;
    }

    if (method === "thread/status/changed") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;

      if (!payload || typeof payload.threadId !== "string") return;

      const parsed = parseThreadStatus(payload.status);
      this.logger.info("Received Codex thread status change", {
        threadId: payload.threadId,
        statusType: parsed.statusType,
        statusActiveFlags: parsed.statusActiveFlags,
      });
      const updated = updateCodexThreadStatus(payload.threadId, parsed.statusType, parsed.statusActiveFlags);
      if (updated) {
        this.emitEvent({ type: "threadSummary", thread: updated });
      }
      this.syncBroadcastConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      this.emitEvent({
        type: "threadStatus",
        threadId: payload.threadId,
        statusType: parsed.statusType,
        statusActiveFlags: parsed.statusActiveFlags,
      });
      return;
    }

    if (method === "thread/archived" || method === "thread/unarchived") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload || typeof payload.threadId !== "string") return;
      const archived = method === "thread/archived";
      this.logger.info("Received Codex thread archived state change", {
        threadId: payload.threadId,
        archived,
      });
      const updated = updateCodexThreadArchived(payload.threadId, archived);
      if (updated) {
        this.emitEvent({ type: "threadSummary", thread: updated });
      }
      this.syncBroadcastConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      this.emitEvent({ type: "threadArchivedState", threadId: payload.threadId, archived });
      return;
    }

    if (method === "thread/name/updated") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload || typeof payload.threadId !== "string") return;
      const name = typeof payload.threadName === "string" ? payload.threadName : null;
      const updated = updateCodexThreadName(payload.threadId, name);
      if (updated) {
        this.emitEvent({ type: "threadSummary", thread: updated });
      }
      this.syncBroadcastConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string" || typeof payload.turnId !== "string") return;

      const tokenUsage = parseCodexThreadTokenUsage(payload.tokenUsage ?? payload.token_usage);
      if (!tokenUsage) return;

      const turn = this.getKnownTurn(payload.threadId, payload.turnId) ?? {
        threadId: payload.threadId,
        turnId: payload.turnId,
        status: "inProgress" as const,
        itemIds: [],
      };

      const nextTurn: CodexTurnSummary = {
        ...turn,
        tokenUsage,
      };

      this.mergeTurn(payload.threadId, nextTurn);
      this.emitEvent({ type: "turn", turn: nextTurn });
      this.syncBroadcastConversationTurnState(payload.threadId, payload.turnId);
      return;
    }

    if (
      method === "turn/started" ||
      method === "turn/completed" ||
      method === "turn/interrupted" ||
      method === "turn/failed"
    ) {
      if (method !== "turn/started") {
        this.frameTextDeltaQueue.flushNow();
        this.outputDeltaQueue.flushNow();
      }
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload) return;

      const fallbackStatus = resolveNotificationTurnStatus(method);
      const turnRecord = (() => {
        if (typeof payload.turn === "object" && payload.turn !== null) {
          return { ...(payload.turn as Record<string, unknown>) };
        }
        if (typeof payload.turnId === "string") {
          return {
            id: payload.turnId,
            status: payload.status,
          } as Record<string, unknown>;
        }
        return null;
      })();
      if (!turnRecord) return;
      if (!Object.prototype.hasOwnProperty.call(turnRecord, "status")) {
        turnRecord.status = payload.status;
      }
      if (turnRecord.status === undefined && fallbackStatus) {
        turnRecord.status = fallbackStatus;
      }

      const threadId =
        typeof payload.threadId === "string"
          ? payload.threadId
          : typeof turnRecord.threadId === "string"
            ? turnRecord.threadId
            : null;
      if (!threadId) return;

      const turn = this.asTurnSummary(threadId, turnRecord);
      if (!turn) return;
      const observedTurn: CodexTurnSummary = method === "turn/started"
        ? {
            ...turn,
            turnStartedAtMs: turn.turnStartedAtMs ?? Date.now(),
          }
        : turn;
      this.logger.info("Received Codex turn lifecycle notification", {
        threadId,
        turnId: observedTurn.turnId,
        status: observedTurn.status,
      });
      this.mergeTurn(threadId, observedTurn);
      const mergedTurn = this.getKnownTurn(threadId, observedTurn.turnId) ?? observedTurn;
      if (method === "turn/started") {
        this.completeStalePlanImplementationItems(threadId, mergedTurn.turnId);
      }
      const synthesizedPatchDiff = this.buildUnifiedDiffFromPatchItems(
        this.listKnownTurnItems(threadId, mergedTurn.turnId),
      );
      if (synthesizedPatchDiff || Object.prototype.hasOwnProperty.call(turnRecord, "diff")) {
        this.syncTurnDiffItem(threadId, mergedTurn.turnId, synthesizedPatchDiff ?? mergedTurn.diff, mergedTurn.status);
      }
      if (mergedTurn.status === "completed") {
        this.syncPlanImplementationForTurn(threadId, mergedTurn.turnId);
      }
      this.syncThreadStatusFromKnownTurns(threadId);
      this.reconcileTurnItemsToTerminalStatus(threadId, mergedTurn.turnId, mergedTurn.status);
      if (mergedTurn.status !== "inProgress") {
        this.clearPendingSteersForTurn(threadId, mergedTurn.turnId, false);
      }
      this.emitEvent({ type: "turn", turn: mergedTurn });
      this.emitThreadStreamSnapshotFromRecord(threadId);
      if (mergedTurn.status !== "inProgress") {
        this.maybeDispatchQueuedFollowUp(threadId);
      }
      return;
    }

    if (method === "turn/plan/updated") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string" || typeof payload.turnId !== "string") return;
      const plan = Array.isArray(payload.plan)
        ? payload.plan.flatMap((candidate) => {
            const parsed = asRecord(candidate);
            if (!parsed || typeof parsed.step !== "string" || typeof parsed.status !== "string") return [];
            return [{ step: parsed.step, status: parsed.status }];
          })
        : [];
      const explanation = typeof payload.explanation === "string" ? payload.explanation : null;
      const item = this.buildTodoListItemView({
        threadId: payload.threadId,
        turnId: payload.turnId,
        explanation,
        plan,
      });
      this.upsertCanonicalTurnItem(payload.threadId, payload.turnId, item.itemId, "inProgress");
      this.mergeItem(item);
      this.syncBroadcastConversationTurnState(payload.threadId, payload.turnId, {
        syncBackgroundTerminalRows: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (method === "hook/started" || method === "hook/completed") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string") return;
      const turnId = this.resolveLiveTurnId(payload.threadId, typeof payload.turnId === "string" ? payload.turnId : null);
      if (!turnId) return;
      const run = asRecord(payload.run);
      if (!run) return;
      const item = this.buildHookItemView({
        threadId: payload.threadId,
        turnId,
        run,
      });
      if (!item) return;
      this.upsertCanonicalTurnItem(payload.threadId, turnId, item.itemId, "inProgress");
      this.mergeItem(item);
      this.syncBroadcastConversationTurnState(payload.threadId, turnId, {
        syncBackgroundTerminalRows: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (method === "turn/diff/updated") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string" || typeof payload.turnId !== "string") return;
      const diff = typeof payload.diff === "string" && payload.diff.length > 0 ? payload.diff : undefined;
      const existingTurn = this.getKnownTurn(payload.threadId, payload.turnId) ?? {
        threadId: payload.threadId,
        turnId: payload.turnId,
        status: "inProgress" as const,
        itemIds: [],
      };
      const nextTurn: CodexTurnSummary = {
        ...existingTurn,
        diff,
      };

      this.mergeTurn(payload.threadId, nextTurn);
      this.syncTurnDiffItem(payload.threadId, payload.turnId, diff, nextTurn.status);
      this.emitEvent({ type: "turn", turn: nextTurn });
      this.syncBroadcastConversationTurnState(payload.threadId, payload.turnId, {
        syncBackgroundTerminalRows: true,
        syncChildMemberships: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      const payload = asRecord(params);
      if (!payload) return;
      const lifecycleStatus = method === "item/autoApprovalReview/started" ? "inProgress" as const : "completed" as const;
      const entry = this.upsertAutomaticApprovalReviewItem(payload, lifecycleStatus);
      if (!entry) return;
      this.syncBroadcastConversationTurnState(entry.threadId, entry.turnId, {
        syncBackgroundTerminalRows: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      this.frameTextDeltaQueue.flushNow();
      this.outputDeltaQueue.flushNow();
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload) return;
      if (typeof payload.threadId !== "string" || typeof payload.turnId !== "string") return;

      const lifecycleStatus = method === "item/started" ? "inProgress" as const : "completed" as const;
      const normalizedItem = normalizeThreadItem(payload.item, payload.threadId, payload.turnId);
      if (!normalizedItem) return;
      const item = normalizedItem.status
          ? normalizedItem
          : {
              ...normalizedItem,
              status: lifecycleStatus,
              markdownText: normalizedItem.semanticKind === "contextCompaction"
                ? resolveContextCompactionMarkdown(lifecycleStatus)
                : normalizedItem.markdownText,
            };
      this.upsertCanonicalTurnItem(payload.threadId, payload.turnId, item.itemId, "inProgress");
      this.mergeItem(item);
      if (item.normalizedKind === "assistantMessage" || item.semanticKind === "assistantMessage") {
        this.markFinalAssistantStartedAt(payload.threadId, payload.turnId);
      }
      this.syncBroadcastConversationTurnState(payload.threadId, payload.turnId, {
        syncBackgroundTerminalRows: true,
        syncChildMemberships: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (
      method === "item/agentMessage/delta"
      || method === "item/plan/delta"
      || method === "item/reasoning/summaryTextDelta"
      || method === "item/reasoning/textDelta"
    ) {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload) return;
      if (
        typeof payload.threadId !== "string" ||
        typeof payload.turnId !== "string" ||
        typeof payload.itemId !== "string" ||
        typeof payload.delta !== "string"
      ) {
        return;
      }
      const observedAtMs = Date.now();
      if (method === "item/agentMessage/delta" || method === "item/plan/delta") {
        if (method === "item/agentMessage/delta") {
          this.markFinalAssistantStartedAt(payload.threadId, payload.turnId, observedAtMs);
        }
        this.frameTextDeltaQueue.enqueue({
          threadId: payload.threadId,
          turnId: payload.turnId,
          itemId: payload.itemId,
          delta: payload.delta,
          observedAtMs,
          target: {
            type: method === "item/plan/delta" ? "plan" : "agentMessage",
          },
        });
        return;
      }

      if (method === "item/reasoning/summaryTextDelta") {
        if (typeof payload.summaryIndex !== "number") return;
        this.frameTextDeltaQueue.enqueue({
          threadId: payload.threadId,
          turnId: payload.turnId,
          itemId: payload.itemId,
          delta: payload.delta,
          observedAtMs,
          target: {
            type: "reasoningSummary",
            summaryIndex: payload.summaryIndex,
          },
        });
        return;
      }

      if (typeof payload.contentIndex !== "number") return;
      this.frameTextDeltaQueue.enqueue({
        threadId: payload.threadId,
        turnId: payload.turnId,
        itemId: payload.itemId,
        delta: payload.delta,
        observedAtMs,
        target: {
          type: "reasoningContent",
          contentIndex: payload.contentIndex,
        },
      });
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      if (!payload) return;
      if (
        typeof payload.threadId !== "string"
        || typeof payload.turnId !== "string"
        || typeof payload.itemId !== "string"
        || typeof payload.delta !== "string"
      ) {
        return;
      }
      this.outputDeltaQueue.enqueue({
        threadId: payload.threadId,
        turnId: payload.turnId,
        itemId: payload.itemId,
        delta: payload.delta,
      });
      return;
    }

    if (method === "item/fileChange/patchUpdated") {
      const payload = asRecord(params);
      if (
        !payload
        || typeof payload.threadId !== "string"
        || typeof payload.turnId !== "string"
        || typeof payload.itemId !== "string"
        || !Array.isArray(payload.changes)
      ) {
        return;
      }

      const normalizedItem = normalizeThreadItem({
        id: payload.itemId,
        type: "fileChange",
        status: "inProgress",
        changes: payload.changes,
      }, payload.threadId, payload.turnId);
      if (!normalizedItem) return;

      this.upsertCanonicalTurnItem(payload.threadId, payload.turnId, normalizedItem.itemId, "inProgress");
      this.mergeItem(normalizedItem);
      this.syncBroadcastConversationTurnState(payload.threadId, payload.turnId, {
        syncBackgroundTerminalRows: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (method === "serverRequest/resolved") {
      const payload = asRecord(params);
      const requestId = payload?.requestId ?? payload?.request_id;
      if (requestId === undefined || requestId === null) return;
      this.resolvePendingServerRequest(String(requestId));
      return;
    }

    if (method === "account/rateLimits/updated") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;

      const parsed = parseRateLimitsSnapshot(payload?.rateLimits ?? null);
      this.accountSnapshot = {
        ...this.accountSnapshot,
        rateLimits: parsed,
      };
      this.syncRateLimitsPolling();
      this.emitEvent({ type: "rateLimits", rateLimits: parsed });
      this.emitEvent({ type: "account", account: this.accountSnapshot });
      return;
    }

    if (method === "account/updated") {
      await this.readAccountSnapshot().catch(() => {
        // keep previous state
      });
      return;
    }

    if (method === "account/login/completed") {
      this.accountSnapshot = {
        ...this.accountSnapshot,
        pendingLogin: null,
      };
      this.emitEvent({ type: "account", account: this.accountSnapshot });
      await this.readAccountSnapshot().catch(() => {
        // keep previous state
      });
      return;
    }

    if (method === "error") {
      const payload =
        typeof params === "object" && params !== null
          ? params as Record<string, unknown>
          : null;
      const threadId = typeof payload?.threadId === "string" ? payload.threadId : null;
      const turnId = typeof payload?.turnId === "string" ? payload.turnId : null;
      const errorRecord =
        typeof payload?.error === "object" && payload.error !== null
          ? payload.error as Record<string, unknown>
          : null;
      const message = typeof errorRecord?.message === "string" ? errorRecord.message : "Codex error";
      const additionalDetails =
        typeof errorRecord?.additionalDetails === "string"
          ? errorRecord.additionalDetails
          : null;
      const willRetry = Boolean(payload?.willRetry);

      if (threadId && turnId) {
        this.syncTurnErrorItem({
          threadId,
          turnId,
          message,
          additionalDetails,
          willRetry,
        });
        this.syncBroadcastConversationTurnState(threadId, turnId, {
          syncBackgroundTerminalRows: true,
          syncCapabilityFlags: true,
        });
      }

      this.emitEvent({ type: "error", message, detail: additionalDetails ?? undefined });
    }
  }

  serializeThreadDetail(threadId: string): CodexThreadDetail | null {
    const link = this.getThreadLinkSafely(threadId);
    if (!link) return null;
    const record = this.getMaybeConversationRecord(threadId);
    const detail = record?.detail;
    const turns = [...(detail?.turns ?? [])];
    const transcript = [...(detail?.transcript ?? [])];
    const transcriptUpdatedAt = transcript.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0);

    return {
      ...link,
      threadName: link.threadName,
      threadPreview: resolveThreadPreviewFromTranscript(
        transcript,
        link.threadPreview,
      ),
      cwd: link.cwd,
      approvalPolicy: detail?.approvalPolicy ?? null,
      approvalsReviewer: detail?.approvalsReviewer ?? null,
      sandbox: detail?.sandbox ?? null,
      latestCollaborationMode: detail?.latestCollaborationMode ?? record?.latestCollaborationMode ?? this.buildDefaultCollaborationModeState(),
      updatedAt: Math.max(link.updatedAt, transcriptUpdatedAt),
      turns,
      transcript,
    };
  }

  private buildConversationCapabilityFlags(
    detail: CodexThreadDetail,
    requests: CodexConversationServerRequest[],
  ): CodexConversationCapabilityFlags {
    const latestTurn = detail.turns.at(-1) ?? null;
    const isConversationActionable = !detail.archived && detail.statusType !== "systemError";
    const latestTurnHasUserMessage = latestTurn !== null
      && detail.transcript.some((entry) =>
        entry.turnId === latestTurn.turnId &&
        (entry.semanticKind === "userMessage" || entry.kind === "userMessage"));

    return {
      canEditLastUserTurn: Boolean(
        isConversationActionable &&
        latestTurn &&
        latestTurn.status !== "inProgress" &&
        latestTurnHasUserMessage &&
        requests.every((request) => request.turnId !== latestTurn.turnId),
      ),
      canForkFromTurn: Boolean(isConversationActionable && detail.turns.length > 0),
      canSearch: true,
      canCollapseTurns: true,
    };
  }

  private buildConversationBaseSnapshot(threadId: string): CodexConversationSnapshot | null {
    const detail = this.hasKnownThreadDetail(threadId)
      ? this.serializeThreadDetail(threadId)
      : (this.bootstrapConversationRecordFromSession(threadId) ?? this.serializeThreadDetail(threadId));
    if (!detail) return null;
    const requests = this.listPendingConversationRequests(threadId);

    return buildCodexConversationSnapshot({
      detail,
      resumeState: this.resolveConversationResumeState(threadId),
      requests,
      queuedFollowUps: this.listQueuedFollowUps(threadId),
      pendingSteers: this.listPendingSteers(threadId),
      capabilityFlags: this.buildConversationCapabilityFlags(detail, requests),
    });
  }

  private extractConversationChildThreadIds(conversation: CodexConversationSnapshot): string[] {
    const childThreadIds = new Set<string>();

    for (const turn of conversation.turns) {
      for (const item of turn.items) {
        if (!isChildThreadSourceItem(item)) continue;
        for (const receiverThreadId of extractReceiverThreadIds(item)) {
          if (receiverThreadId === conversation.threadId) continue;
          childThreadIds.add(receiverThreadId);
        }
      }
    }

    return Array.from(childThreadIds);
  }

  private formatConversationActorName(
    conversation: CodexConversationSnapshot | null,
    threadId: string,
  ): string {
    const threadName = conversation?.threadName?.trim();
    if (threadName) return threadName;
    const threadPreview = conversation?.threadPreview?.trim();
    if (threadPreview) return threadPreview;
    return threadId;
  }

  private deriveConversationChildMemberships(
    conversation: CodexConversationSnapshot,
    visitedThreadIds: Set<string>,
  ): CodexConversationChildMembership[] {
    return this.extractConversationChildThreadIds(conversation).map((childThreadId) => {
      const childConversation = visitedThreadIds.has(childThreadId)
        ? this.buildConversationBaseSnapshot(childThreadId)
        : this.serializeConversationSnapshot(childThreadId, visitedThreadIds);
      const primaryRequest = selectPrimaryConversationRequest(childConversation);
      return {
        threadId: childThreadId,
        parentThreadId: conversation.threadId,
        role: primaryRequest?.type === "approval" ? "childApproval" : "backgroundChild",
        actorName: this.formatConversationActorName(childConversation, childThreadId),
      };
    });
  }

  private extractBackgroundTerminalCommand(item: CodexConversationItem): string {
    return item.command ?? "";
  }

  private extractBackgroundTerminalCwd(item: CodexConversationItem): string | null {
    return item.cwd ?? null;
  }

  private extractBackgroundTerminalProcessId(item: CodexConversationItem): string | null {
    return item.processId ?? null;
  }

  private extractBackgroundTerminalPreviewLine(item: CodexConversationItem): string | null {
    const output = item.aggregatedOutput ?? null;
    if (!output) return null;

    const lines = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length === 0 ? null : (lines.at(-1) ?? null);
  }

  private collectBackgroundTerminalRows(
    conversation: CodexConversationSnapshot,
  ): Array<{ row: CodexBackgroundTerminalRow; turnId: string }> {
    if (conversation.turns.length === 0) {
      return [];
    }

    const latestTurnIndex = conversation.turns.length - 1;
    const rows: Array<{ row: CodexBackgroundTerminalRow; turnId: string }> = [];

    for (let turnIndex = latestTurnIndex; turnIndex >= 0; turnIndex -= 1) {
      const turn = conversation.turns[turnIndex];
      if (!turn) {
        continue;
      }
      if (turnIndex === latestTurnIndex && turn.status === "inProgress") {
        continue;
      }

      const interruptedCommandExecutionItemIds = new Set(turn.interruptedCommandExecutionItemIds ?? []);
      for (const item of turn.items) {
        if (
          !item
          || item.kind !== "commandExecution"
          || item.status !== "inProgress"
          || interruptedCommandExecutionItemIds.has(item.itemId)
        ) {
          continue;
        }

        rows.push({
          turnId: turn.turnId,
          row: {
            id: item.itemId,
            command: this.extractBackgroundTerminalCommand(item),
            cwd: this.extractBackgroundTerminalCwd(item),
            processId: this.extractBackgroundTerminalProcessId(item),
            previewLine: this.extractBackgroundTerminalPreviewLine(item),
          },
        });
      }
    }

    return rows;
  }

  private deriveConversationBackgroundTerminalRows(
    conversation: CodexConversationSnapshot,
  ): CodexBackgroundTerminalRow[] {
    return this.collectBackgroundTerminalRows(conversation).map(({ row }) => row);
  }

  private listRecordedInterruptedCommandExecutionItemIds(threadId: string, turnId: string): string[] {
    const byItem = this.getMaybeConversationRecord(threadId)?.itemsByTurn.get(turnId);
    if (!byItem || byItem.size === 0) {
      return [];
    }

    const interruptedIds: string[] = [];
    for (const item of byItem.values()) {
      if (item.normalizedKind !== "commandExecution") {
        continue;
      }
      if (item.status !== "inProgress") {
        continue;
      }
      interruptedIds.push(item.itemId);
    }

    return interruptedIds;
  }

  serializeConversationSnapshot(threadId: string, visitedThreadIds = new Set<string>()): CodexConversationSnapshot | null {
    const baseConversation = this.buildConversationBaseSnapshot(threadId);
    if (!baseConversation) return null;
    if (visitedThreadIds.has(threadId)) return baseConversation;

    const nextVisitedThreadIds = new Set(visitedThreadIds);
    nextVisitedThreadIds.add(threadId);
    const childMemberships = this.deriveConversationChildMemberships(baseConversation, nextVisitedThreadIds);

    return {
      ...baseConversation,
      childMemberships,
      backgroundTerminalRows: this.deriveConversationBackgroundTerminalRows(baseConversation),
    };
  }
}

export const codexService = new CodexService();

export function isRetryableCodexError(error: unknown): boolean {
  return error instanceof CodexRpcError && error.retryable;
}
