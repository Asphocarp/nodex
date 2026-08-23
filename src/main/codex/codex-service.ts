import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { produceWithPatches } from "immer";
import * as Effect from "effect/Effect";
import type {
  CollaborationMode as CodexAppServerCollaborationMode,
  RequestId,
} from "@nodex/codex-app-server-protocol";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import type { ThreadReadResponse } from "@nodex/codex-app-server-protocol/v2/ThreadReadResponse";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import type { ThreadResumeParams } from "@nodex/codex-app-server-protocol/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "@nodex/codex-app-server-protocol/v2/ThreadResumeResponse";
import type { ThreadSettings } from "@nodex/codex-app-server-protocol/v2/ThreadSettings";
import type { Thread } from "@nodex/codex-app-server-protocol/v2/Thread";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@nodex/codex-app-server-protocol/v2/ThreadTurnsListResponse";
import type { Turn } from "@nodex/codex-app-server-protocol/v2/Turn";
import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type {
  PageRunInTarget,
  CodexAutomationRunsUpdatedEvent,
  CodexBackgroundTerminalRow,
  CodexCanonicalServerRequest,
  CodexCanonicalConversationState,
  CodexComposerIntent,
  CodexConversationChildMembership,
  CodexConversationCapabilityFlags,
  CodexConversationItem,
  CodexConversationResumeState,
  CodexConversationThreadSettings,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexConversationTurnPagination,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexEvent,
  CodexHostMessage,
  CodexItemView,
  CodexLiveFileAttachment,
  CodexModelOption,
  CodexPlanImplementationServerRequest,
  CodexPendingSteer,
  CodexPreparedPrompt,
  CodexPermissionMode,
  CodexPermissionState,
  CodexProjectlessWorkspace,
  CodexQueuedFollowUp,
  CodexReviewDiffCommentAttachment,
  CodexReasoningEffort,
  CodexSteerTurnInput,
  CodexSteeringRestoreMessage,
  CodexSteeringUserInput,
  CodexGitSettings,
  CodexTranscriptEntry,
  CodexTranscriptEntrySource,
  CodexThreadActiveFlag,
  CodexThreadDetail,
  CodexThreadStatusType,
  CodexThreadSummary,
  CodexTurnDiffPatchBatch,
  CodexThreadStartProgressPhase,
  CodexThreadStartProgressStream,
  CodexThreadTokenUsage,
  CodexScheduledAutomationChangedEvent,
  CodexThreadStartForSessionInput,
  CodexThreadStreamCheckpoint,
  TerminalSessionSnapshot,
  CodexTurnStatus,
  CodexTurnSummary,
  CodexPromptAgentConfigInput,
  CodexPromptInput,
  CodexPromptTextAttachmentInput,
} from "../../shared/types";
import type { ComposerCatalogPromiseAdapter } from "../codex-application/ComposerCatalogPromiseAdapter";
import type { CodexApplicationEventPublisher } from "../codex-application/CodexApplicationEventHub";
import type { CodexThreadGoalRuntimePromiseAdapter } from "../codex-application/CodexThreadGoalRuntimePromiseAdapter";
import { parseCodexPersonality } from "../codex-application/CodexPersonality";
import type { CodexPreferences } from "../codex-application/CodexPreferences";
import type { CodexPermissionsPromiseAdapter } from "../codex-application/CodexPermissionsPromiseAdapter";
import type { AgentProviderRuntimePromiseAdapter } from "../codex-application/AgentProviderRuntimePromiseAdapter";
import type {
  ExecutionHost,
  ExecutionHostRuntime,
} from "../codex-application/ExecutionHostRuntime";
import type { CodexGitProbePromiseAdapter } from "../codex-application/CodexGitProbePromiseAdapter";
import type { CodexStructuredThreadTitlePromiseAdapter } from "../codex-application/CodexStructuredThreadTitlePromiseAdapter";
import type { CodexDynamicToolsLaunchPromiseAdapter } from "../codex-application/CodexDynamicToolsLaunchPromiseAdapter";
import type { CodexThreadHandoffRuntime } from "../codex-application/CodexThreadHandoffRuntime";
import { parseAssetSource } from "../../shared/assets";
import {
  getTerminalInteractionBufferKey,
  parseTerminalInteractionInput,
} from "../../shared/codex-terminal-interaction";
import {
  createCodexTextUserInput as createTextUserInput,
  prepareCodexPrompt,
} from "../../shared/codex-prompt-preparation";
import { parseCodexThreadTokenUsage } from "../../shared/schemas/codex";
import type { CodexAttachments } from "../codex-application/CodexAttachments";
import type { CodexPendingServerRequestRuntimeService } from "../codex-application/CodexPendingServerRequestRuntime";
import type {
  CodexTurnCommandsService,
  CodexTurnStartOverrides,
} from "../codex-application/CodexTurnCommands";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { reconcileCodexThreadTimestamps } from "./codex-thread-timestamps";
import { resolveCodexThreadMaterializationOwner } from "./codex-thread-materialization-owner";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type {
  NodexAgentAuthorityPort,
  NodexAgentTurnAuthorityLaunch,
} from "../nodex-agent-authority-port";
import type { CodexActiveGoalContinuationLegacyPort } from "../codex-application/CodexActiveGoalContinuation";
import type { CodexOwnerNotificationDrainRuntimePromiseAdapter } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import type { CodexRendererConversationRegistryService } from "../codex-application/CodexRendererConversationRegistry";
import type { CodexRendererConversationCoordinatorService } from "../codex-application/CodexRendererConversationCoordinator";
import type { CodexUserInputAutoResolutionLegacyPort } from "../codex-application/CodexUserInputAutoResolution";
import {
  buildPlanImplementationRequestId,
  selectPrimaryBackgroundConversationRequest,
} from "../../shared/codex-conversation-request";
import { extractCodexThreadSubagentMetadata } from "../../shared/codex-subagent-metadata";
import {
  type CodexNotificationConversationFacts,
  type CodexThreadNotificationEvent,
} from "../../shared/codex-thread-notification";
import { isRawCodexSubagentThreadIdLabel } from "../../shared/codex-subagent-display";
import {
  buildCodexTurnDiffFromPatchBatches,
  getCodexFileChangeList,
  resolveCodexPatchSuccess,
  stripCodexVisualizationDiffBlocks,
} from "../../shared/codex-file-change";
import {
  canMergeSyntheticTextDuplicate,
  mergeCodexItemView,
  resolveCodexItemPrimaryIdentityKey,
} from "../../shared/codex-item-identity";
import {
  reduceCodexConversationEventWithEffects,
  type CodexConversationReducerEffect,
} from "../../shared/codex-conversation-state/codex-conversation-reducer";
import {
  canonicalizeCodexCanonicalTurnStates,
  createCodexCanonicalWorkspacePermissionContext,
  createCodexCanonicalHydratedConversationState,
  isCodexCanonicalProtocolItem,
  mergeCodexCanonicalTurnStates,
  overlayCodexCanonicalTurnHydration,
  resolveCodexCanonicalHydratedCwd,
  resolveCodexCanonicalHydratedPermissionContext,
  resolveCodexCanonicalProjectlessCwd,
  type CodexCanonicalHydratedPermissionContext,
  type CodexCanonicalSteeringUserMessageItem,
  type CodexCanonicalTurnState,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { reduceCodexConversationTurnLifecycle } from "../../shared/codex-conversation-state/codex-turn-lifecycle";
import { appendCodexCanonicalThreadGoalTranscriptTurn } from "../../shared/codex-conversation-state/codex-thread-goal-transcript";
import { projectCodexHistoryRequestViews } from "../../shared/codex-conversation-state/codex-history-request-projection";
import { buildCodexSteeringCompareKey } from "../../shared/codex-conversation-state/codex-steering-compare";
import { removeCodexCanonicalSteeringItem } from "../../shared/codex-conversation-state/codex-steering-state";
import { applyCodexLifecycleProjectionDiff } from "../../shared/codex-conversation-state/codex-lifecycle-projection-diff";
import { buildCodexTurnOccurrenceKey } from "../../shared/codex-turn-identity";
import { reduceCodexConversationTerminalCommands } from "../../shared/codex-conversation-state/codex-command-execution-stream";
import {
  reduceCodexConversationFileChangePatch,
  reduceCodexConversationMcpToolCallProgress,
  type CodexFileChangePatchUpdate,
  type CodexMcpToolCallProgressUpdate,
} from "../../shared/codex-conversation-state/codex-file-change-stream";
import {
  applyCodexCanonicalPlanImplementationTurnStartedState,
  completeCodexCanonicalPlanImplementationRequest,
  createCodexCanonicalPlanImplementationRequest,
  reduceCodexConversationServerRequest,
  reduceCodexConversationServerRequestResolved,
  reduceCodexServerRequestRawState,
  reduceCodexServerRequestResolvedRawState,
  type CodexServerRequestRawLifecycleResult,
  type CodexServerRequestLifecycleResult,
  type CodexServerRequestRawState,
} from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import {
  mergeOrderedStringIds,
  removeOrderedStringIds,
  upsertOrderedStringIds,
} from "../../shared/codex-turn-order";
import { buildTurnErrorItemView } from "../../shared/codex-turn-error-projection";
import { CODEX_INTEGRATION_CAPABILITIES } from "../../shared/codex-integration-capabilities";
import type { CodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { resolveAssetPath } from "../local-store/assets";
import {
  getCodexDeveloperInstructionSettings,
  getCodexGitSettings,
  getNodexHome,
} from "../local-store/config";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  type CodexServerRequest,
  type CodexServerNotification,
} from "../codex-runtime/CodexApplicationProtocol";
import { CodexRpcError } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { CodexSessionStore } from "./codex-session-store";
import { buildCodexDesktopDeveloperInstructions } from "./codex-developer-instructions";
import {
  applyLiveTranscriptMutation,
  buildTranscriptFromBootstrapEvents,
  finalizeTurnTranscriptState,
  projectItemToLiveTranscriptEntry,
  projectTranscriptEntryToItemView,
  reconcileCommittedUserPrompt,
  resolveThreadPreviewFromTranscript,
} from "./codex-transcript-projection";
import { shouldTerminalizeItemWithTurn } from "../../shared/codex-turn-terminalization";
import { completeCodexMcpToolCallForTurn } from "../../shared/codex-mcp-tool-call";
import { parseCodexReasoningSummary } from "../../shared/codex-reasoning-summary-policy";
import {
  buildCodexConversationSnapshot,
  buildCodexConversationTurn,
} from "./codex-conversation-snapshot";
import { convertImmerPatchesToCodexConversationStateUpdates } from "../../shared/codex-conversation-patches";
import { type CodexThreadStreamReplica } from "../../shared/codex-owner-follower-replication";
import type { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import type { CodexConversationAggregate } from "../codex-application/CodexConversationAggregate";
import {
  buildCollaborationModeState,
  buildDefaultCollaborationModeState,
  normalizeCodexServiceTier,
  normalizeThreadSettingsModel,
} from "../codex-application/CodexThreadSettingsProjection";
import type { ResolvedCodexRuntime } from "./codex-runtime";
import type { DesktopToolRuntimePromiseAdapter } from "../host-runtime/DesktopToolRuntime";
import type { AgentExecutionProfile, AgentProviderCatalog } from "../../shared/agent-runtime";
import {
  cleanCodexAutoTitlePrompt,
  CODEX_THREAD_TITLE_PROMPT_MAX_CHARS,
  normalizeCodexManualThreadTitle,
  projectCodexMarkdownToPlainText,
} from "../../shared/codex-thread-title";
import { getLogger } from "../logging/logger";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { resolveDynamicToolCatalogBindings } from "./codex-dynamic-tool-catalog-bindings";
import type { NodexAgentAuthorizationRuntimePromiseAdapter } from "../codex-application/NodexAgentAuthorizationRuntimePromiseAdapter";
import { buildNodexAgentDynamicToolSpecs } from "../nodex-agent-application/NodexAgentDynamicTools";
import {
  buildCodexAppMetaThreadToolSpecs,
  CODEX_APP_LOCAL_HOST_ID,
} from "./codex-app-meta-thread-tools";
import type { PersistedAtomStore } from "../local-store/persisted-atoms";
import type { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
  DesktopProjectWorkspaceThreadPatch,
} from "../core-client/project-workspace-adapter";
import {
  buildCodexNewConversationParams,
  parseCodexStoredShellEnvironment,
  type BuildCodexNewConversationParamsInput,
  type CodexStoredShellEnvironment,
} from "./codex-thread-launch-context";
import { CODEX_DEFAULT_FEATURE_OVERRIDES } from "./codex-thread-capabilities";
import { persistCodexWorktreeShellEnvironment } from "./codex-worktree-shell-environment";
import type { CodexWorktreeWorkerOperation } from "./codex-worktree-worker-protocol";
import {
  evaluateCodexThreadHandoffCapability,
  type CodexThreadHandoffCapability,
} from "./codex-thread-handoff-capability";
import {
  migrateLegacyCodexProjectlessWorkspace,
  repairCodexProjectlessWorkspace,
} from "./codex-projectless-workspace-repair";
import type { CodexThreadSettingsRuntimePromiseAdapter } from "../codex-application/CodexThreadSettingsRuntimePromiseAdapter";
import type { CodexThreadTitlePersistencePromiseAdapter } from "../codex-application/CodexThreadTitlePersistencePromiseAdapter";
import {
  buildWorkspaceThreadSummary,
  parseThreadSourceValue,
  parseThreadStatus,
} from "../codex-application/CodexThreadCatalogProjection";
import type { ConversationCommands } from "../codex-application/ConversationCommands";
import type { CodexPostResumeGoalRuntimePromiseAdapter } from "../codex-application/CodexPostResumeGoalRuntimePromiseAdapter";
import type { CodexBackgroundSubagentMetadataRepair } from "../codex-application/CodexBackgroundSubagentMetadataRepair";
import type { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import type { CodexQueuedFollowUpDispatcher } from "../codex-application/CodexQueuedFollowUpDispatcher";
import type { CodexQueuedFollowUps } from "../codex-application/CodexQueuedFollowUps";
import type { CodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import type { CodexConversationResumeDemand } from "../codex-application/CodexConversationResumeRuntime";
import type { CodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import { rewriteExecutionWorkspaceRoots } from "./codex-execution-workspace-roots";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
} from "../dev-runtime-metrics";

const codexLogger = getLogger({ subsystem: "codex", component: "service" });
const NODEX_AGENT_DYNAMIC_TOOL_SPECS = buildNodexAgentDynamicToolSpecs();

interface ThreadRef {
  projectId: string | null;
  cwd: string | null;
  executionProfile?: AgentExecutionProfile | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
}

type DormantConversationSyncReason =
  | "cold-load"
  | "explicit-resync"
  | "owner-unavailable"
  | "inactive-owner-cleanup"
  | "durable-recovery";

type RequestConversationResumeOptions = Partial<Omit<CodexConversationResumeDemand, "threadId">>;

interface CodexConversationResumeSeed {
  readonly requestedCwd: string | null;
  readonly workspaceRoots: readonly string[];
  readonly permissionContext: CodexCanonicalHydratedPermissionContext;
  readonly collaborationMode?: CodexAppServerCollaborationMode | null;
  readonly syncDormantConversationSnapshot?: boolean;
}

interface CodexResumePermissionSelection {
  readonly context: CodexCanonicalHydratedPermissionContext;
  readonly shouldSendPermissions: boolean;
  readonly shouldSendApprovalsReviewer: boolean;
}

type StartTurnOverrides = CodexTurnStartOverrides;

interface AcceptedConversationDocumentSyncOptions {
  turnId?: string;
  syncDetail?: boolean;
  syncRequests?: boolean;
  syncQueuedFollowUps?: boolean;
  syncPendingSteers?: boolean;
  syncLatestCollaborationMode?: boolean;
  syncLatestThreadSettings?: boolean;
  syncCapabilityFlags?: boolean;
  syncBackgroundTerminalRows?: boolean;
  syncChildMemberships?: boolean;
}

type CodexCanonicalHydrationInput = Pick<
  ThreadResumeResponse,
  | "thread"
  | "model"
  | "serviceTier"
  | "multiAgentMode"
  | "reasoningEffort"
  | "cwd"
  | "approvalPolicy"
  | "approvalsReviewer"
  | "sandbox"
  | "activePermissionProfile"
  | "runtimeWorkspaceRoots"
> & {
  readonly sessionMeta?: {
    readonly cwd?: string | null;
  } | null;
};

interface CodexCanonicalHydrationOptions {
  readonly expectedThreadId?: string;
  readonly fallbackCwd?: string | null;
  readonly historyCwd?: string;
  readonly historyModel?: string;
  readonly historyPermissions?: CodexCanonicalHydratedPermissionContext;
  readonly historyReasoningEffort?: ThreadResumeResponse["reasoningEffort"];
  readonly latestModel?: string;
  readonly latestReasoningEffort?: ThreadResumeResponse["reasoningEffort"];
  readonly mergeExistingTurns?: boolean;
  readonly overlayResponseTurnParams?: boolean;
  readonly pendingRequests?: readonly CodexCanonicalServerRequest[];
  readonly responsePermissionFallback?: CodexCanonicalHydratedPermissionContext;
  readonly resolvedCwd?: string | null;
  readonly turns?: readonly Turn[];
}

type CodexServiceOptions = {
  conversationRuntimes: Pick<
    ConversationRuntimeMap["Service"],
    "conversation" | "currentConversation"
  >;
  applicationEvents: CodexApplicationEventPublisher;
  foldSidebarPathCase: boolean;
  agentProviderRuntime: AgentProviderRuntimePromiseAdapter;
  composerCatalog: ComposerCatalogPromiseAdapter;
  preferences: Pick<CodexPreferences["Service"], "current">;
  permissions: CodexPermissionsPromiseAdapter;
  client: CodexGatewayPromiseClient;
  desktopTools: DesktopToolRuntimePromiseAdapter;
  attachments: CodexAttachments["Service"]["legacy"];
  pendingServerRequests: CodexPendingServerRequestRuntimeService;
  controlPlane: Pick<ScopedCallbackRuntime["Service"], "fork" | "runPromise">;
  turnCommands: CodexTurnCommandsService;
  persistedAtoms: PersistedAtomStore;
  sessionStore: CodexSessionStore;
  runtime: ResolvedCodexRuntime;
  runtimeStateHome: string;
  nodexAgentAuthority: NodexAgentAuthorityPort;
  nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  automationRouting: Pick<
    AutomationRoutingIndex["Service"],
    "activeHeartbeatAutomationId" | "runAutomationId"
  >;
  projectWorkspace: DesktopProjectWorkspacePort;
  activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  rendererConversations: CodexRendererConversationRegistryService;
  rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  gitProbe: CodexGitProbePromiseAdapter;
  structuredThreadTitle: CodexStructuredThreadTitlePromiseAdapter;
  dynamicToolsLaunch: CodexDynamicToolsLaunchPromiseAdapter;
  threadHandoffRuntime: CodexThreadHandoffRuntime["Service"];
  threadSettingsRuntime: CodexThreadSettingsRuntimePromiseAdapter;
  threadTitlePersistence: CodexThreadTitlePersistencePromiseAdapter;
  conversationCommands: ConversationCommands["Service"];
  postResumeGoals: CodexPostResumeGoalRuntimePromiseAdapter;
  backgroundSubagentMetadataRepair: CodexBackgroundSubagentMetadataRepair["Service"];
  subagentCatalog: CodexSubagentCatalog["Service"];
  queuedFollowUps: CodexQueuedFollowUps["Service"];
  queuedFollowUpDispatcher: CodexQueuedFollowUpDispatcher["Service"];
  conversationDeltaBuffer: CodexConversationDeltaBufferRuntime["Service"];
  conversationResume: CodexConversationResumeRuntimePromiseAdapter;
  threadGoals: CodexThreadGoalRuntimePromiseAdapter;
  supportsChatGptApps?: boolean;
  isOpenAIFormElicitationsEnabled?: () => boolean;
  gitSettingsResolver?: () => CodexGitSettings;
  projectAwareDeveloperInstructionsResolver?: (input: {
    baseInstructions?: string | null;
    cwd: string;
    model?: string | null;
    threadId: string | null;
    threadToolsEnabled?: boolean;
  }) => Promise<string>;
  threadCodexConfigBuilder?: (
    cwd: string | null,
  ) => Promise<NonNullable<ThreadStartParams["config"]> | null>;
  projectlessHomeDirectory?: () => string;
  executionHosts: ExecutionHostRuntime["Service"];
  userInputAutoResolution: CodexUserInputAutoResolutionLegacyPort;
  terminalRuntime?: CodexTerminalRuntimePort;
};

export interface CodexTerminalRuntimePort {
  readonly getThreadSnapshot: (threadId: string) => Promise<TerminalSessionSnapshot | null>;
}

interface CodexConversationRecord {
  readonly threadId: string;
  detail: CodexThreadDetail | null;
  itemsByTurn: Map<string, Map<string, CodexItemView>>;
  planImplementationRequestsByTurnId: Map<string, CodexPlanImplementationServerRequest>;
  pendingSteers: CodexPendingSteer[];
  latestCollaborationMode: CodexCollaborationModeState;
  latestThreadSettings: CodexConversationThreadSettings | null;
  latestTokenUsageInfo: CodexThreadTokenUsage | null;
  threadGoal: ThreadGoal | null;
  completedThreadGoal: ThreadGoal | null;
  threadGoalResumeConfirmation: ThreadGoal | null;
}

interface CodexThreadReadMaterialization {
  readonly detail: CodexThreadDetail;
  readonly thread: Thread;
}

const THREAD_TURNS_PAGE_SIZE = 5;
const THREAD_TURNS_PAGE_ITEMS_VIEW = "full" as const;
const COMPLETE_TURN_PAGINATION: CodexConversationTurnPagination = {
  olderCursor: null,
  backwardsCursor: null,
  oldestLoadedTurnId: null,
  isLoadingOlder: false,
  hasLoadedOldest: true,
  loadedTurnCount: 0,
  itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
};

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

function readStringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function parseTurnDiff(value: unknown): string | undefined {
  const candidate = asRecord(value);
  if (!candidate) return undefined;

  const diff = candidate.diff;
  return typeof diff === "string" ? diff : undefined;
}

function applyThreadAgentMetadata<T extends CodexThreadSummary>(
  summary: T,
  candidate: Record<string, unknown>,
): T {
  const metadata = extractCodexThreadSubagentMetadata(candidate);
  return {
    ...summary,
    agentNickname: metadata.hasAgentNickname
      ? metadata.agentNickname
      : (summary.agentNickname ?? null),
    agentRole: metadata.hasAgentRole ? metadata.agentRole : (summary.agentRole ?? null),
  };
}

function shouldShowThreadGoalResumeConfirmation(status: ThreadGoal["status"]): boolean {
  return status === "paused" || status === "blocked" || status === "usageLimited";
}

function isRolloutMaterializationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const isLegacyRolloutError =
    normalized.includes("failed to load rollout") &&
    (normalized.includes("empty session file") ||
      normalized.includes("materialized") ||
      normalized.includes("is empty"));
  if (isLegacyRolloutError) return true;

  // Newer app-server responses can skip "failed to load rollout" and directly report
  // includeTurns preconditions before the first user turn is materialized.
  const isPreMaterializedThreadError =
    normalized.includes("not materialized yet") ||
    (normalized.includes("includeturns") && normalized.includes("before first user message")) ||
    normalized.includes("includeturns is unavailable");

  return isPreMaterializedThreadError;
}

function isRolloutMaterializationError(error: unknown): boolean {
  return error instanceof CodexRpcError && isRolloutMaterializationMessage(error.message);
}

type CodexUserInputItem = TurnStartParams["input"][number];

function parseEventThreadId(eventParams: Record<string, unknown> | null): string | null {
  if (!eventParams) return null;
  if (typeof eventParams.threadId === "string") return eventParams.threadId;
  const thread = asRecord(eventParams.thread);
  return typeof thread?.id === "string" ? thread.id : null;
}

interface PreparedPromptForTurn {
  promptText: string;
  inputItems: CodexUserInputItem[];
  pendingInputItems: CodexUserInputItem[];
  fileAttachments: CodexLiveFileAttachment[];
  addedFiles: CodexLiveFileAttachment[];
  pastedTextAttachments: CodexPromptTextAttachmentInput[];
  additionalContext?: TurnStartParams["additionalContext"];
  commentAttachments: CodexReviewDiffCommentAttachment[];
  agentConfigOverrides: {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
  };
}

function isSupportedImageUrl(source: string): boolean {
  return (
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("data:image/")
  );
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

  return candidate.receivers.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function isChildThreadSourceItem(item: CodexConversationItem): boolean {
  const normalizedType = normalizeTypeName(item.type);
  if (normalizedType.includes("collabagenttoolcall")) return true;

  const normalizedTool = normalizeTypeName(item.toolCall?.toolName);
  return normalizedTool === "spawnagent" || normalizedTool === "spawn_agent";
}

function makeTurnStatus(value: unknown): CodexTurnStatus {
  if (
    value === "completed" ||
    value === "interrupted" ||
    value === "failed" ||
    value === "inProgress"
  ) {
    return value;
  }
  if (value === "in_progress") return "inProgress";
  return "inProgress";
}

function asTerminalTurnStatus(
  status: CodexTurnStatus,
): Exclude<CodexTurnStatus, "inProgress"> | null {
  if (status === "inProgress") return null;
  return status;
}

function parseReasoningEffort(value: unknown): CodexReasoningEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) return null;
  return normalized;
}

function parseCollaborationModeKind(value: unknown): CodexCollaborationModeKind | null {
  if (value === "default" || value === "plan") return value;
  return null;
}

function parseNullableReasoningEffort(
  value: unknown,
  fallback: CodexReasoningEffort | null,
): CodexReasoningEffort | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  return parseReasoningEffort(value) ?? fallback;
}

function hasOwnValue(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Internal sentinel for the remaining class-local request projection. */
export const CodexApplicationRequestPending = Symbol.for(
  "nodex/main/codex-application/CodexApplicationRequestPending",
);

export class CodexService {
  private readonly foldSidebarPathCase: boolean;
  private readonly logger = codexLogger;
  private readonly client: CodexGatewayPromiseClient;
  private readonly applicationEvents: CodexApplicationEventPublisher;
  private readonly agentProviderRuntime: AgentProviderRuntimePromiseAdapter;
  private readonly composerCatalog: ComposerCatalogPromiseAdapter;
  private readonly preferences: Pick<CodexPreferences["Service"], "current">;
  private readonly permissions: CodexPermissionsPromiseAdapter;
  private readonly runtimeStateHome: string;
  private readonly runtimeVersion: string | null;
  private readonly desktopTools: DesktopToolRuntimePromiseAdapter;
  private readonly activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  private readonly ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  private readonly rendererConversations: CodexRendererConversationRegistryService;
  private readonly rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  private readonly gitProbe: CodexGitProbePromiseAdapter;
  private readonly structuredThreadTitle: CodexStructuredThreadTitlePromiseAdapter;
  private readonly dynamicToolsLaunch: CodexDynamicToolsLaunchPromiseAdapter;
  private readonly supportsChatGptApps: boolean;
  private readonly isOpenAIFormElicitationsEnabled: () => boolean;
  private readonly gitSettingsResolver: () => CodexGitSettings;
  private readonly projectAwareDeveloperInstructionsResolver:
    | ((input: {
        baseInstructions?: string | null;
        cwd: string;
        model?: string | null;
        threadId: string | null;
        threadToolsEnabled?: boolean;
      }) => Promise<string>)
    | null;
  private readonly threadCodexConfigBuilder:
    | ((cwd: string | null) => Promise<NonNullable<ThreadStartParams["config"]> | null>)
    | null;
  private readonly projectlessHomeDirectory: () => string;
  private readonly attachments: CodexAttachments["Service"]["legacy"];
  private readonly pendingServerRequests: CodexPendingServerRequestRuntimeService;
  private readonly controlPlane: Pick<ScopedCallbackRuntime["Service"], "fork" | "runPromise">;
  private readonly turnCommands: CodexTurnCommandsService;
  private readonly persistedAtoms: PersistedAtomStore;
  private readonly sessionStore: CodexSessionStore;
  private readonly executionHosts: ExecutionHostRuntime["Service"];
  private readonly threadHandoffRuntime: CodexThreadHandoffRuntime["Service"];
  private readonly terminalRuntime: NonNullable<CodexServiceOptions["terminalRuntime"]>;
  private readonly nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  private readonly automationRouting: CodexServiceOptions["automationRouting"];
  private readonly projectWorkspace: DesktopProjectWorkspacePort;
  private readonly workspaceThreadProjectionById = new Map<string, DesktopProjectWorkspaceThread>();
  private readonly nodexAgentAuthorityRegistry: NodexAgentAuthorityPort;

  private readonly conversationRecords = new Map<string, CodexConversationRecord>();
  private readonly conversationRuntimes: CodexServiceOptions["conversationRuntimes"];
  private readonly threadSettingsRuntime: CodexThreadSettingsRuntimePromiseAdapter;
  private readonly threadTitlePersistence: CodexThreadTitlePersistencePromiseAdapter;
  private readonly conversationCommands: ConversationCommands["Service"];
  private readonly postResumeGoals: CodexPostResumeGoalRuntimePromiseAdapter;
  private readonly backgroundSubagentMetadataRepair: CodexBackgroundSubagentMetadataRepair["Service"];
  private readonly subagentCatalog: CodexSubagentCatalog["Service"];
  private readonly queuedFollowUps: CodexQueuedFollowUps["Service"];
  private readonly queuedFollowUpDispatcher: CodexQueuedFollowUpDispatcher["Service"];
  private readonly conversationDeltaBuffer: CodexConversationDeltaBufferRuntime["Service"];
  private readonly conversationResume: CodexConversationResumeRuntimePromiseAdapter;
  private readonly threadGoals: CodexThreadGoalRuntimePromiseAdapter;
  private readonly deletedThreadIds = new Set<string>();
  private readonly userInputAutoResolution: CodexUserInputAutoResolutionLegacyPort;
  private readonly terminalInputBuffers = new Map<string, string>();

  constructor(options: CodexServiceOptions) {
    this.conversationRuntimes = options.conversationRuntimes;
    this.applicationEvents = options.applicationEvents;
    this.agentProviderRuntime = options.agentProviderRuntime;
    this.composerCatalog = options.composerCatalog;
    this.preferences = options.preferences;
    this.foldSidebarPathCase = options.foldSidebarPathCase;
    this.permissions = options.permissions;
    const runtime = options.runtime;
    this.runtimeVersion = runtime.codexCompatibilityVersion ?? runtime.version;
    this.desktopTools = options.desktopTools;
    this.terminalRuntime =
      options.terminalRuntime ??
      ({
        getThreadSnapshot: async () => null,
      } satisfies CodexTerminalRuntimePort);
    this.runtimeStateHome = path.resolve(options.runtimeStateHome);
    this.nodexAgentAuthorityRegistry = options.nodexAgentAuthority;
    this.nodexAgentAuthorization = options.nodexAgentAuthorization;
    this.automationRouting = options.automationRouting;
    this.projectWorkspace = options.projectWorkspace;
    this.executionHosts = options.executionHosts;
    this.attachments = options.attachments;
    this.pendingServerRequests = options.pendingServerRequests;
    this.controlPlane = options.controlPlane;
    this.turnCommands = options.turnCommands;
    this.persistedAtoms = options.persistedAtoms;
    this.sessionStore = options.sessionStore;
    this.activeGoalContinuation = options.activeGoalContinuation;
    this.ownerNotificationDrain = options.ownerNotificationDrain;
    this.rendererConversations = options.rendererConversations;
    this.rendererConversationCoordinator = options.rendererConversationCoordinator;
    this.gitProbe = options.gitProbe;
    this.structuredThreadTitle = options.structuredThreadTitle;
    this.dynamicToolsLaunch = options.dynamicToolsLaunch;
    this.threadHandoffRuntime = options.threadHandoffRuntime;
    this.threadSettingsRuntime = options.threadSettingsRuntime;
    this.threadTitlePersistence = options.threadTitlePersistence;
    this.conversationCommands = options.conversationCommands;
    this.postResumeGoals = options.postResumeGoals;
    this.backgroundSubagentMetadataRepair = options.backgroundSubagentMetadataRepair;
    this.subagentCatalog = options.subagentCatalog;
    this.queuedFollowUps = options.queuedFollowUps;
    this.queuedFollowUpDispatcher = options.queuedFollowUpDispatcher;
    this.conversationDeltaBuffer = options.conversationDeltaBuffer;
    this.conversationResume = options.conversationResume;
    this.threadGoals = options.threadGoals;
    this.supportsChatGptApps =
      options?.supportsChatGptApps ?? CODEX_INTEGRATION_CAPABILITIES.chatGptApps;
    this.isOpenAIFormElicitationsEnabled = options?.isOpenAIFormElicitationsEnabled ?? (() => true);
    this.gitSettingsResolver = options?.gitSettingsResolver ?? getCodexGitSettings;
    this.projectAwareDeveloperInstructionsResolver =
      options?.projectAwareDeveloperInstructionsResolver ?? null;
    this.threadCodexConfigBuilder =
      options?.threadCodexConfigBuilder ?? (() => this.desktopTools.threadConfig());
    this.projectlessHomeDirectory = options?.projectlessHomeDirectory ?? homedir;
    this.userInputAutoResolution = options.userInputAutoResolution;
    this.client = options.client;
  }

  private emitEvent(event: CodexEvent): void {
    this.applicationEvents.publish({ kind: "codex", value: event });
    this.emitHostMessagesForEvent(event);
  }

  private emitThreadNotificationEvent(event: CodexThreadNotificationEvent): void {
    this.applicationEvents.publish({ kind: "threadNotification", value: event });
  }

  private buildNotificationConversationFacts(threadId: string): CodexNotificationConversationFacts {
    const record = this.getMaybeConversationRecord(threadId);
    const detail = record?.detail ?? null;
    const summary = this.getThreadLinkSafely(threadId);
    const source = detail?.source ?? summary?.source ?? null;
    const localParentThreadId =
      source?.sideConversation === true ? null : (source?.parentThreadId ?? null);
    return {
      conversationId: threadId,
      title: detail?.threadName ?? summary?.threadName ?? null,
      threadSource: detail?.threadSource ?? summary?.threadSource ?? null,
      parentThreadId:
        (record ? this.readCanonicalConversationState(record.threadId) : null)?.protocol
          .parentThreadId ??
        localParentThreadId ??
        null,
      source:
        (record ? this.readCanonicalConversationState(record.threadId) : null)?.protocol.source ??
        source,
      sideConversationParentNavigationPath:
        detail?.source?.sideConversationParentNavigationPath ??
        summary?.source?.sideConversationParentNavigationPath ??
        null,
    };
  }

  private emitUserInputRequiredNotification(input: {
    threadId: string;
    requestId: RequestId;
    turnId: string;
    questionCount: number;
  }): void {
    this.emitThreadNotificationEvent({
      type: "user-input-requested",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversation: this.buildNotificationConversationFacts(input.threadId),
      requestId: input.requestId,
      turnId: input.turnId,
      questionCount: input.questionCount,
    });
  }

  notifyAutomationRunsUpdated(event: CodexAutomationRunsUpdatedEvent): void {
    this.emitEvent({ type: "automationRunsUpdated", event });
  }

  notifyScheduledAutomationChanged(event: CodexScheduledAutomationChangedEvent): void {
    this.emitEvent({ type: "scheduledAutomationChanged", event });
  }

  private emitScheduledAutomationChanged(event: CodexScheduledAutomationChangedEvent): void {
    this.notifyScheduledAutomationChanged(event);
  }

  private notifyAutomationRunThreadUpdated(
    threadId: string,
    reason: CodexAutomationRunsUpdatedEvent["reason"],
  ): void {
    this.notifyAutomationRunsUpdated({
      automationId: this.resolveAutomationIdForRunThread(threadId),
      threadId,
      reason,
    });
  }

  private resolveAutomationIdForRunThread(threadId: string): string | null {
    return this.automationRouting.runAutomationId(threadId);
  }

  private isCommandOnlyAutomationThread(threadId: string): boolean {
    if (this.rendererConversations.getOwnerClientId(threadId)) return false;
    return this.resolveAutomationIdForRunThread(threadId) !== null;
  }

  private resolveNotificationThreadId(notification: CodexServerNotification): string | null {
    const eventParams = asRecord(notification.params);
    const eventThreadId = parseEventThreadId(eventParams);
    if (eventThreadId) return eventThreadId;

    const turn = asRecord(eventParams?.turn);
    if (typeof turn?.threadId === "string") return turn.threadId;
    const item = asRecord(eventParams?.item);
    if (typeof item?.threadId === "string") return item.threadId;
    return null;
  }

  private emitHostMessage(message: CodexHostMessage): void {
    this.applicationEvents.publish({ kind: "hostMessage", value: message });
  }

  private resolveServerRequestThreadId(request: CodexServerRequest): string | null {
    return parseEventThreadId(asRecord(request.params));
  }

  private waitForRendererOwnerNotificationDrain(conversationId: string): Promise<void> {
    if (!this.rendererConversations.hasOwner(conversationId)) return Promise.resolve();
    return this.ownerNotificationDrain.awaitCurrent(conversationId);
  }

  private waitForFrameTextDeltaDrain(conversationId: string): Promise<void> {
    this.conversationDeltaBuffer.drainFrameText(conversationId);
    return Promise.resolve();
  }

  private clearOwnerNotificationDrain(conversationId: string): void {
    this.ownerNotificationDrain.clear(conversationId);
  }

  private releaseOwnerNotificationDrain(conversationId: string): void {
    this.ownerNotificationDrain.release(conversationId);
  }

  private getNextConversationVersion(threadId: string): number {
    return this.conversationAggregate(threadId).incrementVersion();
  }

  private setAcceptedConversationReplica(
    threadId: string,
    conversation: CodexConversationSnapshot,
    revision: number,
    ownerEpoch = this.rendererConversations.getOwnerEpoch(threadId) ??
      this.readConversationAggregate(threadId)?.checkpoint?.ownerEpoch ??
      0,
  ): CodexThreadStreamCheckpoint {
    return this.conversationAggregate(threadId).acceptReplica({
      ownerEpoch,
      revision,
      conversation,
    }).checkpoint;
  }

  private getAcceptedConversationReplica(threadId: string): CodexThreadStreamReplica | null {
    const aggregate = this.readConversationAggregate(threadId);
    const replica = aggregate?.acceptedReplica ?? null;
    if (!replica) return null;
    const expectedOwnerEpoch =
      this.rendererConversations.getOwnerEpoch(threadId) ?? aggregate?.checkpoint?.ownerEpoch ?? 0;
    if (replica.checkpoint.ownerEpoch === expectedOwnerEpoch) return replica;
    this.setAcceptedConversationReplica(
      threadId,
      replica.conversation,
      aggregate?.revision ?? 0,
      expectedOwnerEpoch,
    );
    return this.readConversationAggregate(threadId)?.acceptedReplica ?? null;
  }

  private storeDormantConversationSnapshot(
    threadId: string,
    conversation: CodexConversationSnapshot,
    _reason: DormantConversationSyncReason,
  ): void {
    void _reason;
    if (this.rendererConversations.hasOwner(threadId)) return;
    this.conversationAggregate(threadId).advanceReplica({
      conversation,
      ownerEpoch:
        this.rendererConversations.getOwnerEpoch(threadId) ??
        this.readConversationAggregate(threadId)?.checkpoint?.ownerEpoch ??
        0,
    });
  }

  private storeDormantConversationPatches(
    threadId: string,
    conversation: CodexConversationSnapshot,
    patches: ReturnType<typeof convertImmerPatchesToCodexConversationStateUpdates>,
  ): void {
    if (patches.length === 0) {
      return;
    }
    if (this.rendererConversations.hasOwner(threadId)) return;
    this.conversationAggregate(threadId).advanceReplica({
      conversation,
      ownerEpoch:
        this.rendererConversations.getOwnerEpoch(threadId) ??
        this.readConversationAggregate(threadId)?.checkpoint?.ownerEpoch ??
        0,
    });
  }

  private async promoteBrowserUseRouteForFirstTurn(input: {
    origin: CodexThreadStartForSessionInput["browserUsePresentationOrigin"];
    codexSessionId: string;
    projectId: string | null;
    expectedBrowserViewScopeId?: string;
  }): Promise<void> {
    if (!input.origin) return;
    if (
      input.expectedBrowserViewScopeId &&
      input.origin.browserViewScopeId !== input.expectedBrowserViewScopeId
    ) {
      throw new Error("Browser Use origin does not belong to this window");
    }
    await this.desktopTools.promoteBrowserUseRoute({
      ...input.origin,
      codexSessionId: input.codexSessionId,
      projectId: input.projectId,
    });
  }

  private async resolveExecutionHost(
    hostId: string,
    operation: CodexWorktreeWorkerOperation,
    signal?: AbortSignal,
  ): Promise<ExecutionHost> {
    return await this.controlPlane.runPromise(
      this.executionHosts.resolve(hostId, operation),
      signal ? { signal } : undefined,
    );
  }

  private rejectPendingDynamicToolCallsForThread(threadId: string, reason: unknown): void {
    this.pendingServerRequests.rejectDispatchedDynamicForThread(threadId, reason);
  }

  private mutateAcceptedConversationDocument(
    threadId: string,
    recipe: (draft: CodexConversationSnapshot) => void | CodexConversationSnapshot,
  ): void {
    const currentConversation =
      this.readConversationAggregate(threadId)?.acceptedReplica?.conversation;
    if (!currentConversation) {
      this.syncDormantConversationFromRecord(threadId, "durable-recovery");
      return;
    }

    try {
      const [nextConversation, patches] = produceWithPatches(currentConversation, recipe);
      this.storeDormantConversationPatches(
        threadId,
        nextConversation,
        convertImmerPatchesToCodexConversationStateUpdates(patches),
      );
    } catch (error) {
      this.logger.warn("Could not mutate accepted conversation document cache directly", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.syncDormantConversationFromRecord(threadId, "durable-recovery");
    }
  }

  private mutateAcceptedConversationDocumentSilently(
    threadId: string,
    recipe: (draft: CodexConversationSnapshot) => void | CodexConversationSnapshot,
  ): void {
    if (this.rendererConversations.hasOwner(threadId)) {
      return;
    }
    const currentConversation =
      this.readConversationAggregate(threadId)?.acceptedReplica?.conversation;
    if (!currentConversation) {
      return;
    }

    try {
      const [nextConversation] = produceWithPatches(currentConversation, recipe);
      this.setAcceptedConversationReplica(
        threadId,
        nextConversation,
        this.readConversationAggregate(threadId)?.revision ?? 0,
      );
    } catch (error) {
      this.logger.warn("Could not update accepted conversation document cache silently", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private syncAcceptedConversationDocumentSilently(
    threadId: string,
    options: { advanceRevision?: boolean } = {},
  ): number {
    if (this.rendererConversations.hasOwner(threadId)) {
      return this.readConversationAggregate(threadId)?.revision ?? 0;
    }
    const conversation = this.serializeConversationSnapshot(threadId);
    if (!conversation) {
      return this.readConversationAggregate(threadId)?.revision ?? 0;
    }
    if (options.advanceRevision === true) {
      const current = this.readConversationAggregate(threadId);
      this.setAcceptedConversationReplica(threadId, conversation, (current?.revision ?? 0) + 1);
      return (current?.revision ?? 0) + 1;
    }
    const revision = this.readConversationAggregate(threadId)?.revision ?? 0;
    this.setAcceptedConversationReplica(threadId, conversation, revision);
    return revision;
  }

  private syncDormantConversationFromRecord(
    threadId: string,
    reason: DormantConversationSyncReason,
  ): void {
    if (this.isCommandOnlyAutomationThread(threadId)) return;

    try {
      const conversation = this.serializeConversationSnapshot(threadId);
      if (!conversation) return;
      this.storeDormantConversationSnapshot(threadId, conversation, reason);
    } catch (error) {
      this.logger.warn("Could not refresh dormant conversation document", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private publishPostResumeGoalSnapshot(threadId: string): void {
    const conversation = this.serializeConversationSnapshot(threadId);
    if (!conversation) return;
    if (this.rendererConversations.hasOwner(threadId)) {
      const notification: CodexServerNotification = conversation.threadGoal
        ? {
            method: "thread/goal/updated",
            params: {
              threadId,
              turnId: null,
              goal: conversation.threadGoal,
            },
          }
        : {
            method: "thread/goal/cleared",
            params: { threadId },
          };
      this.rendererConversationCoordinator.forwardNotification(notification);
      return;
    }
    this.setAcceptedConversationReplica(
      threadId,
      conversation,
      this.readConversationAggregate(threadId)?.revision ?? 0,
    );
  }

  private applyAcceptedConversationSummary(
    draft: CodexConversationSnapshot,
    detail: CodexThreadDetail,
  ): void {
    draft.projectId = detail.projectId;
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
    draft.latestThreadSettings = detail.latestThreadSettings ?? null;
    draft.latestTokenUsageInfo = detail.latestTokenUsageInfo ?? null;
    draft.resumeState = this.resolveConversationResumeState(detail.threadId);
  }

  private replaceAcceptedConversationTurn(
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

  private syncAcceptedConversationDocument(
    threadId: string,
    options: AcceptedConversationDocumentSyncOptions,
  ): void {
    if (this.isCommandOnlyAutomationThread(threadId)) return;

    const requiresDetail = Boolean(
      options.turnId ||
      options.syncDetail ||
      options.syncCapabilityFlags ||
      options.syncChildMemberships,
    );
    const detail = requiresDetail ? this.serializeThreadDetail(threadId) : null;
    if (requiresDetail && !detail) {
      this.syncDormantConversationFromRecord(threadId, "durable-recovery");
      return;
    }

    const requests =
      options.syncRequests || options.syncCapabilityFlags
        ? this.listPendingConversationRequests(threadId)
        : null;
    const queuedFollowUps = options.syncQueuedFollowUps ? this.listQueuedFollowUps(threadId) : null;
    const pendingSteers = options.syncPendingSteers ? this.listPendingSteers(threadId) : null;
    const nextTurn =
      options.turnId && detail
        ? (() => {
            const turn = detail.turns.find((candidate) => candidate.turnId === options.turnId);
            return turn ? buildCodexConversationTurn(detail, turn) : null;
          })()
        : null;
    const latestCollaborationMode = options.syncLatestCollaborationMode
      ? this.getConversationRecord(threadId).latestCollaborationMode
      : null;
    const latestThreadSettings = options.syncLatestThreadSettings
      ? this.getConversationRecord(threadId).latestThreadSettings
      : undefined;
    const requestState =
      options.syncRequests || options.syncCapabilityFlags
        ? this.getConversationRecord(threadId)
        : null;

    this.mutateAcceptedConversationDocument(threadId, (draft) => {
      if (detail && (options.syncDetail || options.turnId)) {
        this.applyAcceptedConversationSummary(draft, detail);
      }
      if (options.turnId) {
        this.replaceAcceptedConversationTurn(draft, options.turnId, nextTurn);
      }
      if (requests) {
        draft.requests = requests;
      }
      if (requestState) {
        draft.canonicalRequests = [...this.readConversationServerRequests(requestState)];
        draft.hasUnreadTurn = this.conversationHasUnreadTurn(requestState.threadId);
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
      if (latestThreadSettings !== undefined) {
        draft.latestThreadSettings = latestThreadSettings;
      }
      if (detail && options.syncCapabilityFlags) {
        draft.capabilityFlags = this.buildConversationCapabilityFlags(
          detail,
          requests ?? draft.requests,
        );
      }
      if (options.syncBackgroundTerminalRows) {
        draft.backgroundTerminalRows = this.deriveConversationBackgroundTerminalRows(draft);
      }
      if (options.syncChildMemberships) {
        draft.childMemberships = this.deriveConversationChildMemberships(draft);
      }
    });
  }

  private areConversationChildThreadMetadataEqual(
    left: CodexConversationChildMembership["thread"] | undefined,
    right: CodexConversationChildMembership["thread"] | undefined,
  ): boolean {
    const normalizedLeft = left ?? null;
    const normalizedRight = right ?? null;
    if (normalizedLeft === normalizedRight) return true;
    if (!normalizedLeft || !normalizedRight) return false;
    return (
      normalizedLeft.nickname === normalizedRight.nickname &&
      normalizedLeft.displayName === normalizedRight.displayName &&
      normalizedLeft.name === normalizedRight.name &&
      normalizedLeft.model === normalizedRight.model &&
      normalizedLeft.agentRole === normalizedRight.agentRole
    );
  }

  private areConversationChildMembershipsEqual(
    left: readonly CodexConversationChildMembership[] | undefined,
    right: readonly CodexConversationChildMembership[],
  ): boolean {
    const normalizedLeft = left ?? [];
    if (normalizedLeft.length !== right.length) return false;
    for (let index = 0; index < normalizedLeft.length; index += 1) {
      const leftEntry = normalizedLeft[index];
      const rightEntry = right[index];
      if (!leftEntry || !rightEntry) return false;
      if (
        leftEntry.threadId !== rightEntry.threadId ||
        leftEntry.parentThreadId !== rightEntry.parentThreadId ||
        leftEntry.role !== rightEntry.role ||
        leftEntry.actorName !== rightEntry.actorName ||
        leftEntry.displayName !== rightEntry.displayName ||
        leftEntry.agentRole !== rightEntry.agentRole ||
        leftEntry.agentPath !== rightEntry.agentPath ||
        leftEntry.createdAtMs !== rightEntry.createdAtMs ||
        leftEntry.updatedAtMs !== rightEntry.updatedAtMs ||
        leftEntry.statusType !== rightEntry.statusType ||
        leftEntry.showInlineActivity !== rightEntry.showInlineActivity ||
        !this.areConversationChildThreadMetadataEqual(leftEntry.thread, rightEntry.thread)
      ) {
        return false;
      }
    }
    return true;
  }

  private emitConversationChildMembershipsUpdated(
    parentThreadId: string,
    childMemberships: CodexConversationChildMembership[],
  ): void {
    this.emitHostMessage({
      type: "sharedObjectUpdated",
      hostId: DEFAULT_CODEX_HOST_ID,
      object: {
        objectType: "conversationChildMemberships",
        objectId: parentThreadId,
        value: {
          parentThreadId,
          childMemberships,
        },
      },
    });
  }

  private syncParentChildMembershipMetadata(
    parentThreadId: string,
    options: { repairMissing?: boolean } = {},
  ): void {
    const conversation =
      this.readConversationAggregate(parentThreadId)?.acceptedReplica?.conversation ??
      this.buildConversationBaseSnapshot(parentThreadId);
    if (!conversation) return;
    this.syncParentChildMembershipMetadataFromConversation(conversation, options);
  }

  private syncParentChildMembershipMetadataFromConversation(
    conversation: CodexConversationSnapshot,
    options: { repairMissing?: boolean } = {},
  ): void {
    const parentThreadId = conversation.threadId;
    const childThreadIds = this.extractConversationChildThreadIds(conversation);
    const childThreadLinks = this.listChildThreadLinksSafely(parentThreadId);
    if (childThreadIds.length === 0 && childThreadLinks.length === 0) return;

    const childMemberships = this.deriveConversationChildMemberships(conversation);
    if (
      !this.areConversationChildMembershipsEqual(conversation.childMemberships, childMemberships)
    ) {
      this.mutateAcceptedConversationDocumentSilently(parentThreadId, (draft) => {
        draft.childMemberships = childMemberships;
      });
      this.emitConversationChildMembershipsUpdated(parentThreadId, childMemberships);
    }

    if (options.repairMissing !== false) {
      this.backgroundSubagentMetadataRepair.request(parentThreadId, childThreadIds);
    }
  }

  isBackgroundSubagentMetadataRepairNeeded(parentThreadId: string, childThreadId: string): boolean {
    const summary = this.getThreadLinkSafely(childThreadId);
    if (!summary) return true;
    if (summary.source?.parentThreadId && summary.source.parentThreadId !== parentThreadId)
      return false;
    const hasFriendlyDisplayName =
      Boolean(summary.agentNickname?.trim()) ||
      Boolean(
        summary.threadName?.trim() &&
        !isRawCodexSubagentThreadIdLabel(summary.threadName, childThreadId),
      );
    return !(summary.source?.parentThreadId === parentThreadId && hasFriendlyDisplayName);
  }

  /** Effect Module adapter operation; callers use backgroundSubagentMetadataRepair. */
  async repairBackgroundSubagentMetadata(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<boolean> {
    await this.readThread(childThreadId, false);
    const summary = this.getThreadLinkSafely(childThreadId);
    const hasFriendlyDisplayName =
      Boolean(summary?.agentNickname?.trim()) ||
      Boolean(
        summary?.threadName?.trim() &&
        !isRawCodexSubagentThreadIdLabel(summary.threadName, childThreadId),
      );
    const resolvedParentThreadId = summary?.source?.parentThreadId ?? parentThreadId;
    this.syncParentChildMembershipMetadata(resolvedParentThreadId, { repairMissing: false });
    return hasFriendlyDisplayName;
  }

  private syncAcceptedConversationSummary(
    threadId: string,
    options?: { syncCapabilityFlags?: boolean },
  ): void {
    this.syncAcceptedConversationDocument(threadId, {
      syncDetail: true,
      syncCapabilityFlags: options?.syncCapabilityFlags ?? false,
    });
  }

  private syncAcceptedConversationRequests(
    threadId: string,
    options?: { syncCapabilityFlags?: boolean },
  ): void {
    this.syncAcceptedConversationDocument(threadId, {
      syncRequests: true,
      syncCapabilityFlags: options?.syncCapabilityFlags ?? false,
    });
  }

  private syncAcceptedConversationTurnState(
    threadId: string,
    turnId: string,
    options?: {
      syncRequests?: boolean;
      syncCapabilityFlags?: boolean;
      syncBackgroundTerminalRows?: boolean;
      syncChildMemberships?: boolean;
    },
  ): void {
    this.syncAcceptedConversationDocument(threadId, {
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
        object:
          event.type === "connection"
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

    if (event.type === "threadDeleted") {
      this.emitHostMessage({
        type: "threadDeleted",
        hostId: DEFAULT_CODEX_HOST_ID,
        threadId: event.threadId,
      });
      return;
    }

    if (event.type === "threadArchivedState" && event.archived) {
      this.emitHostMessage({
        type: "threadArchived",
        hostId: DEFAULT_CODEX_HOST_ID,
        conversationId: event.threadId,
      });
      return;
    }

    if (event.type === "threadStartProgress") {
      this.emitHostMessage({
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: {
          objectType: "threadStartProgress",
          objectId: `${event.projectId}:${event.sessionId}`,
          value: {
            projectId: event.projectId,
            sessionId: event.sessionId,
            runInTarget: event.runInTarget,
            threadId: event.threadId,
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

  private syncDormantConversations(
    threadIds: string[] | undefined,
    reason: DormantConversationSyncReason,
  ): void {
    const nextThreadIds = (
      threadIds ?? [
        ...this.workspaceThreadProjectionById.keys(),
        ...this.conversationRecords.keys(),
      ]
    ).filter(
      (threadId, index, values) => threadId.length > 0 && values.indexOf(threadId) === index,
    );
    for (const threadId of nextThreadIds) {
      this.syncDormantConversationFromRecord(threadId, reason);
    }
  }

  private parseCollaborationModeStateFromProtocol(
    value: unknown,
    fallback: CodexCollaborationModeState,
  ): CodexCollaborationModeState | null {
    const candidate = asRecord(value);
    if (!candidate) return null;
    const mode = parseCollaborationModeKind(candidate.mode);
    if (!mode) return null;
    const settings = asRecord(candidate.settings);
    const model =
      normalizeThreadSettingsModel(settings?.model) ??
      normalizeThreadSettingsModel(fallback.settings.model) ??
      "";
    const rawReasoningEffort = settings
      ? hasOwnValue(settings, "reasoning_effort")
        ? settings.reasoning_effort
        : settings.reasoningEffort
      : undefined;
    const reasoningEffort = parseNullableReasoningEffort(
      rawReasoningEffort,
      fallback.settings.reasoning_effort,
    );

    return buildCollaborationModeState({
      collaborationMode: mode,
      model,
      reasoningEffort,
      fallback,
    });
  }

  private parseConversationThreadSettingsFromProtocol(
    value: unknown,
    fallback: CodexConversationThreadSettings | null,
    fallbackCollaborationMode: CodexCollaborationModeState,
  ): CodexConversationThreadSettings | null {
    const candidate = asRecord(value);
    if (!candidate) return null;
    const fallbackMode = fallback?.collaborationMode ?? fallbackCollaborationMode;
    const model =
      normalizeThreadSettingsModel(candidate.model) ??
      normalizeThreadSettingsModel(fallback?.model) ??
      normalizeThreadSettingsModel(fallbackMode.settings.model) ??
      "";
    const reasoningEffort = parseNullableReasoningEffort(
      hasOwnValue(candidate, "effort") ? candidate.effort : candidate.reasoningEffort,
      fallback?.reasoningEffort ?? fallbackMode.settings.reasoning_effort,
    );
    const collaborationMode =
      this.parseCollaborationModeStateFromProtocol(
        candidate.collaborationMode ?? candidate.collaboration_mode,
        buildCollaborationModeState({
          collaborationMode: fallbackMode.mode,
          model,
          reasoningEffort,
          fallback: fallbackMode,
        }),
      ) ??
      buildCollaborationModeState({
        collaborationMode: fallbackMode.mode,
        model,
        reasoningEffort,
        fallback: fallbackMode,
      });
    const parsedSummary = hasOwnValue(candidate, "summary")
      ? parseCodexReasoningSummary(candidate.summary)
      : undefined;

    return {
      model,
      modelProvider:
        normalizeThreadSettingsModel(candidate.modelProvider) ??
        normalizeThreadSettingsModel(fallback?.modelProvider) ??
        null,
      serviceTier: hasOwnValue(candidate, "serviceTier")
        ? normalizeCodexServiceTier(candidate.serviceTier)
        : (fallback?.serviceTier ?? null),
      reasoningEffort,
      summary: parsedSummary === undefined ? (fallback?.summary ?? null) : parsedSummary,
      collaborationMode,
      personality: hasOwnValue(candidate, "personality")
        ? parseCodexPersonality(candidate.personality)
        : (fallback?.personality ?? null),
    };
  }

  private applyLatestThreadSettingsForThread(
    threadId: string,
    latestThreadSettings: CodexConversationThreadSettings,
    protocolSettings?: ThreadSettings,
  ): void {
    const record = this.ensureConversationRecord(threadId);
    record.latestThreadSettings = latestThreadSettings;
    if (latestThreadSettings.collaborationMode) {
      record.latestCollaborationMode = latestThreadSettings.collaborationMode;
    }
    const canonical = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = canonical?.sidecar.hydrationContext ?? null;
    if (canonical && hydrationContext && !protocolSettings) {
      this.acceptCanonicalConversationState(threadId, {
        ...canonical,
        sidecar: {
          ...canonical.sidecar,
          hydrationContext: {
            ...hydrationContext,
            latestModel: latestThreadSettings.model ?? hydrationContext.latestModel,
            latestReasoningEffort: latestThreadSettings.reasoningEffort,
            latestThreadSettings: {
              ...(hydrationContext.latestThreadSettings ?? {}),
              model: latestThreadSettings.model ?? hydrationContext.latestModel,
              serviceTier: latestThreadSettings.serviceTier ?? null,
              effort: latestThreadSettings.reasoningEffort,
              summary: latestThreadSettings.summary ?? null,
              personality: latestThreadSettings.personality,
            },
          },
        },
      });
    } else if (canonical && hydrationContext && protocolSettings) {
      const currentPermissions = {
        activePermissionProfile: protocolSettings.activePermissionProfile,
        runtimeWorkspaceRoots: [...hydrationContext.currentPermissions.runtimeWorkspaceRoots],
        approvalPolicy: protocolSettings.approvalPolicy,
        approvalsReviewer: protocolSettings.approvalsReviewer,
        sandboxPolicy: protocolSettings.sandboxPolicy,
      } satisfies CodexCanonicalHydratedPermissionContext;
      this.acceptCanonicalConversationState(threadId, {
        ...canonical,
        sidecar: {
          ...canonical.sidecar,
          hydrationContext: {
            ...hydrationContext,
            model: protocolSettings.model,
            reasoningEffort: protocolSettings.effort,
            latestModel: protocolSettings.model,
            latestReasoningEffort: protocolSettings.effort,
            cwd: protocolSettings.cwd,
            latestThreadSettings: {
              cwd: protocolSettings.cwd,
              approvalPolicy: protocolSettings.approvalPolicy,
              approvalsReviewer: protocolSettings.approvalsReviewer,
              activePermissionProfile: protocolSettings.activePermissionProfile,
              sandboxPolicy: protocolSettings.sandboxPolicy,
              permissions: protocolSettings.activePermissionProfile?.id ?? null,
              model: protocolSettings.model,
              serviceTier: protocolSettings.serviceTier,
              effort: protocolSettings.effort,
              summary: protocolSettings.summary,
              multiAgentMode: protocolSettings.multiAgentMode,
              collaborationMode: protocolSettings.collaborationMode,
              personality: protocolSettings.personality,
            },
            currentPermissions,
          },
        },
      });
    }
    if (!record.detail) {
      return;
    }

    record.detail = {
      ...record.detail,
      ...(protocolSettings
        ? {
            cwd: protocolSettings.cwd,
            approvalPolicy: protocolSettings.approvalPolicy,
            approvalsReviewer: protocolSettings.approvalsReviewer,
            sandbox: protocolSettings.sandboxPolicy,
          }
        : {}),
      latestCollaborationMode: record.latestCollaborationMode,
      latestThreadSettings,
    };
  }

  private setLatestCollaborationModeForThread(
    threadId: string,
    latestCollaborationMode: CodexCollaborationModeState,
  ): void {
    const record = this.ensureConversationRecord(threadId);
    record.latestCollaborationMode = latestCollaborationMode;
    record.latestThreadSettings = {
      model: latestCollaborationMode.settings.model,
      modelProvider: record.latestThreadSettings?.modelProvider ?? null,
      serviceTier: record.latestThreadSettings?.serviceTier ?? null,
      reasoningEffort: latestCollaborationMode.settings.reasoning_effort,
      summary: record.latestThreadSettings?.summary ?? null,
      collaborationMode: latestCollaborationMode,
      personality: record.latestThreadSettings?.personality ?? this.preferences.current(),
    };
    const canonical = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = canonical?.sidecar.hydrationContext ?? null;
    if (canonical && hydrationContext) {
      this.acceptCanonicalConversationState(threadId, {
        ...canonical,
        sidecar: {
          ...canonical.sidecar,
          hydrationContext: {
            ...hydrationContext,
            latestModel: latestCollaborationMode.settings.model,
            latestReasoningEffort: latestCollaborationMode.settings.reasoning_effort,
            latestThreadSettings: {
              ...(hydrationContext.latestThreadSettings ?? {}),
              model: latestCollaborationMode.settings.model,
              effort: latestCollaborationMode.settings.reasoning_effort,
            },
          },
        },
      });
    }
    if (!record.detail) {
      return;
    }

    record.detail = {
      ...record.detail,
      latestCollaborationMode,
      latestThreadSettings: record.latestThreadSettings,
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

  private createConversationRecord(threadId: string): CodexConversationRecord {
    return {
      threadId,
      detail: null,
      itemsByTurn: new Map<string, Map<string, CodexItemView>>(),
      planImplementationRequestsByTurnId: new Map<string, CodexPlanImplementationServerRequest>(),
      pendingSteers: [],
      latestCollaborationMode: buildDefaultCollaborationModeState(),
      latestThreadSettings: null,
      latestTokenUsageInfo: null,
      threadGoal: null,
      completedThreadGoal: null,
      threadGoalResumeConfirmation: null,
    };
  }

  private getMaybeConversationRecord(threadId: string): CodexConversationRecord | null {
    return this.conversationRecords.get(threadId) ?? null;
  }

  private ensureConversationRecord(threadId: string): CodexConversationRecord {
    const existing = this.getMaybeConversationRecord(threadId);
    if (existing) return existing;
    const created = this.createConversationRecord(threadId);
    this.conversationAggregate(threadId).seedHasUnreadTurn(
      this.getThreadLinkSafely(threadId)?.hasUnreadTurn ?? false,
    );
    this.conversationRecords.set(threadId, created);
    return created;
  }

  private getConversationRecord(threadId: string): CodexConversationRecord {
    return this.ensureConversationRecord(threadId);
  }

  private conversationAggregate(threadId: string): CodexConversationAggregate {
    return this.conversationRuntimes.conversation(threadId);
  }

  private readConversationStreamRole(threadId: string) {
    return this.conversationRuntimes.currentConversation(threadId)?.readStreamRole() ?? null;
  }

  private setConversationStreamRole(threadId: string, role: "owner" | "follower" | null): void {
    this.conversationAggregate(threadId).setStreamRole(role);
  }

  private readConversationAggregate(threadId: string) {
    return this.conversationRuntimes.currentConversation(threadId)?.read() ?? null;
  }

  private readCanonicalConversationState(threadId: string): CodexCanonicalConversationState | null {
    return this.conversationRuntimes.currentConversation(threadId)?.readCanonicalState() ?? null;
  }

  private conversationHasUnreadTurn(threadId: string): boolean {
    return this.conversationRuntimes.currentConversation(threadId)?.readHasUnreadTurn() ?? false;
  }

  private readConversationTurnPagination(threadId: string): CodexConversationTurnPagination {
    return (
      this.conversationRuntimes.currentConversation(threadId)?.readTurnPagination() ??
      COMPLETE_TURN_PAGINATION
    );
  }

  private readConversationServerRequests(
    record: CodexConversationRecord,
  ): readonly CodexCanonicalServerRequest[] {
    return (
      this.conversationRuntimes.currentConversation(record.threadId)?.readServerRequests() ?? []
    );
  }

  private replaceConversationServerRequests(
    threadId: string,
    requests: readonly CodexCanonicalServerRequest[],
  ): void {
    this.conversationAggregate(threadId).replaceServerRequests(requests);
  }

  private acceptCanonicalConversationState(
    threadId: string,
    state: CodexCanonicalConversationState,
  ): CodexCanonicalConversationState {
    return this.conversationAggregate(threadId).acceptCanonicalState(state);
  }

  private resolveCanonicalResumePermissionContext(
    permissionState: CodexPermissionState,
    runtimeWorkspaceRoots: readonly string[],
    fallback: CodexCanonicalHydratedPermissionContext,
  ): CodexCanonicalHydratedPermissionContext {
    const activePermissionProfile =
      permissionState.effectivePreset === "read-only"
        ? { id: ":read-only", extends: null }
        : permissionState.effectivePreset === "full-access"
          ? { id: ":danger-full-access", extends: null }
          : permissionState.effectivePreset === "auto" ||
              permissionState.effectivePreset === "guardian-approvals"
            ? { id: ":workspace", extends: null }
            : fallback.activePermissionProfile;
    return {
      activePermissionProfile,
      runtimeWorkspaceRoots: [...runtimeWorkspaceRoots],
      approvalPolicy: permissionState.approvalPolicy ?? fallback.approvalPolicy,
      approvalsReviewer: permissionState.approvalsReviewer ?? fallback.approvalsReviewer,
      sandboxPolicy: permissionState.sandbox ?? fallback.sandboxPolicy,
    };
  }

  private buildThreadResumePermissionOverrides(
    selection: CodexResumePermissionSelection,
  ): Partial<
    Pick<
      ThreadResumeParams,
      "approvalPolicy" | "approvalsReviewer" | "sandbox" | "permissions" | "runtimeWorkspaceRoots"
    >
  > {
    const { context } = selection;
    const permissions = selection.shouldSendPermissions
      ? context.activePermissionProfile
        ? {
            approvalPolicy: context.approvalPolicy,
            permissions: context.activePermissionProfile.id,
            runtimeWorkspaceRoots: [...context.runtimeWorkspaceRoots],
          }
        : {
            approvalPolicy: context.approvalPolicy,
            sandbox:
              context.sandboxPolicy.type === "dangerFullAccess"
                ? ("danger-full-access" as const)
                : context.sandboxPolicy.type === "readOnly"
                  ? ("read-only" as const)
                  : context.sandboxPolicy.type === "workspaceWrite"
                    ? ("workspace-write" as const)
                    : null,
            runtimeWorkspaceRoots: [...context.runtimeWorkspaceRoots],
          }
      : {};
    if (!selection.shouldSendApprovalsReviewer) {
      return permissions;
    }

    return {
      ...permissions,
      approvalsReviewer: context.approvalsReviewer,
    };
  }

  private async readThreadWritableRoots(threadId: string): Promise<string[]> {
    const context = await this.projectWorkspace.readThreadExecutionContext(threadId);
    return [...(context?.writableRoots ?? [])];
  }

  private async resolvePendingWorktreeSourceWorkspaceRoots(input: {
    readonly projectId: string | null;
    readonly sourceThreadId: string;
    readonly sourceWorkspaceRoot: string;
  }): Promise<string[]> {
    const [projectContext, persistedRoots] = await Promise.all([
      input.projectId
        ? this.maybeResolveProjectRuntimeContext(input.projectId)
        : Promise.resolve(null),
      this.readThreadWritableRoots(input.sourceThreadId),
    ]);
    return rewriteExecutionWorkspaceRoots({
      sourcePrimary: input.sourceWorkspaceRoot,
      targetPrimary: input.sourceWorkspaceRoot,
      workspaceRoots: [...(projectContext?.workspaceRoots ?? []), ...persistedRoots],
    });
  }

  private async mergeThreadWritableRoots(
    threadId: string,
    roots: readonly string[],
  ): Promise<void> {
    await this.projectWorkspace.mergeThreadWritableRoots(threadId, roots);
  }

  /** Exact new-thread response repair at bundle 83197-83229. */
  private async reconcileThreadStartWritableRoots(
    response: ThreadStartResponse,
    requestedSandboxPolicy: TurnStartParams["sandboxPolicy"] | null | undefined,
  ): Promise<ThreadStartResponse> {
    if (requestedSandboxPolicy?.type !== "workspaceWrite") return response;
    const responseSandbox = response.sandbox;
    if (responseSandbox.type !== "workspaceWrite") return response;
    const hasMissingRoot = requestedSandboxPolicy.writableRoots.some(
      (root) => !responseSandbox.writableRoots.includes(root),
    );
    if (!hasMissingRoot) return response;

    await this.mergeThreadWritableRoots(response.thread.id, requestedSandboxPolicy.writableRoots);
    return {
      ...response,
      activePermissionProfile: null,
      sandbox: {
        ...responseSandbox,
        writableRoots: [
          ...responseSandbox.writableRoots,
          ...requestedSandboxPolicy.writableRoots.filter(
            (root) => !responseSandbox.writableRoots.includes(root),
          ),
        ],
      },
    };
  }

  /** Exact Y3e `D`: thread state wins; workspace defaults are last-resort only. */
  private resolveCanonicalPreResumePermissionContext(
    record: CodexConversationRecord,
    runtimeWorkspaceRoots: readonly string[],
    defaultWorkspaceRoots: readonly string[],
    projectless: boolean,
    persistedWritableRoots: readonly string[],
  ): CodexResumePermissionSelection {
    const hydrationContext =
      this.readCanonicalConversationState(record.threadId)?.sidecar.hydrationContext ?? null;
    const latestSettings = hydrationContext?.latestThreadSettings ?? null;
    const latestParams =
      this.readCanonicalConversationState(record.threadId)?.turns.at(-1)?.sidecar.params ?? null;
    const currentPermissions = hydrationContext?.currentPermissions ?? null;
    const defaults =
      projectless && defaultWorkspaceRoots.length === 0
        ? ({
            activePermissionProfile: { id: ":read-only", extends: null },
            runtimeWorkspaceRoots: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: {
              type: "readOnly",
              networkAccess: false,
            },
          } satisfies CodexCanonicalHydratedPermissionContext)
        : createCodexCanonicalWorkspacePermissionContext(defaultWorkspaceRoots);
    const turnPermissionProfile =
      latestParams && "permissions" in latestParams && typeof latestParams.permissions === "string"
        ? { id: latestParams.permissions, extends: null }
        : null;
    const selectedSandboxPolicy =
      latestSettings?.sandboxPolicy ??
      latestParams?.sandboxPolicy ??
      currentPermissions?.sandboxPolicy ??
      defaults.sandboxPolicy;
    const hasWritableRootChange =
      selectedSandboxPolicy.type === "workspaceWrite" &&
      persistedWritableRoots.some((root) => !selectedSandboxPolicy.writableRoots.includes(root));
    const sandboxPolicyWithKnownRoots =
      selectedSandboxPolicy.type === "workspaceWrite" && hasWritableRootChange
        ? {
            ...selectedSandboxPolicy,
            writableRoots: [
              ...selectedSandboxPolicy.writableRoots,
              ...persistedWritableRoots.filter(
                (root) => !selectedSandboxPolicy.writableRoots.includes(root),
              ),
            ],
          }
        : selectedSandboxPolicy;
    const sandboxPolicy =
      projectless &&
      sandboxPolicyWithKnownRoots.type === "workspaceWrite" &&
      !sandboxPolicyWithKnownRoots.writableRoots.some((root) => root !== "~")
        ? {
            type: "readOnly" as const,
            networkAccess: false,
          }
        : sandboxPolicyWithKnownRoots;
    return {
      context: {
        activePermissionProfile:
          latestSettings?.activePermissionProfile !== undefined
            ? latestSettings.activePermissionProfile
            : (turnPermissionProfile ??
              currentPermissions?.activePermissionProfile ??
              defaults.activePermissionProfile),
        runtimeWorkspaceRoots: [...runtimeWorkspaceRoots],
        approvalPolicy:
          latestSettings?.approvalPolicy ??
          latestParams?.approvalPolicy ??
          currentPermissions?.approvalPolicy ??
          defaults.approvalPolicy,
        approvalsReviewer:
          latestSettings?.approvalsReviewer ??
          latestParams?.approvalsReviewer ??
          currentPermissions?.approvalsReviewer ??
          defaults.approvalsReviewer,
        sandboxPolicy,
      },
      shouldSendPermissions:
        latestSettings !== null ||
        latestParams !== null ||
        currentPermissions?.activePermissionProfile?.id === ":danger-full-access" ||
        projectless ||
        hasWritableRootChange,
      shouldSendApprovalsReviewer:
        latestSettings?.approvalsReviewer != null ||
        latestParams?.approvalsReviewer != null ||
        currentPermissions?.approvalsReviewer != null,
    };
  }

  private hydrateCanonicalConversationState(
    input: CodexCanonicalHydrationInput,
    options: CodexCanonicalHydrationOptions = {},
  ): CodexCanonicalConversationState {
    if (options.expectedThreadId && input.thread.id !== options.expectedThreadId) {
      throw new Error(
        `Canonical hydration expected thread '${options.expectedThreadId}' but received '${input.thread.id}'`,
      );
    }

    const record = this.ensureConversationRecord(input.thread.id);
    const pendingRequests = options.pendingRequests ?? this.readConversationServerRequests(record);
    const responsePermissions = {
      activePermissionProfile: input.activePermissionProfile,
      runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
      approvalPolicy: input.approvalPolicy,
      approvalsReviewer: input.approvalsReviewer,
      sandboxPolicy: input.sandbox,
    } satisfies CodexCanonicalHydratedPermissionContext;
    const currentPermissions = options.responsePermissionFallback
      ? resolveCodexCanonicalHydratedPermissionContext({
          response: responsePermissions,
          previous: options.responsePermissionFallback,
        })
      : responsePermissions;
    const fallbackHydrationCwd =
      input.thread.cwd || input.sessionMeta?.cwd || input.cwd || options.fallbackCwd || "/";
    const currentCwd =
      options.resolvedCwd === undefined ? fallbackHydrationCwd : options.resolvedCwd;
    const historyPermissions = options.historyPermissions ?? currentPermissions;
    const thread: Thread = {
      ...input.thread,
      turns: [...(options.turns ?? input.thread.turns)],
    };
    const canonicalState = createCodexCanonicalHydratedConversationState(thread, {
      model: options.historyModel ?? input.model,
      reasoningEffort:
        options.historyReasoningEffort === undefined
          ? input.reasoningEffort
          : options.historyReasoningEffort,
      cwd: options.historyCwd ?? fallbackHydrationCwd,
      approvalPolicy: historyPermissions.approvalPolicy,
      approvalsReviewer: historyPermissions.approvalsReviewer,
      sandboxPolicy: historyPermissions.sandboxPolicy,
      activePermissionProfile: historyPermissions.activePermissionProfile,
      runtimeWorkspaceRoots: [...historyPermissions.runtimeWorkspaceRoots],
      pendingRequests,
      hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
    });
    const previousCanonical = this.readCanonicalConversationState(record.threadId);
    const mergedTurns =
      options.mergeExistingTurns && previousCanonical
        ? mergeCodexCanonicalTurnStates(previousCanonical.turns, canonicalState.turns)
        : canonicalState.turns;
    const turns = options.overlayResponseTurnParams
      ? overlayCodexCanonicalTurnHydration(mergedTurns, {
          approvalPolicy: input.approvalPolicy,
          approvalsReviewer: input.approvalsReviewer,
          sandboxPolicy: input.sandbox,
          model: input.model,
          cwd: currentCwd,
          effort: input.reasoningEffort,
        })
      : mergedTurns;
    const previousHydrationContext =
      this.readCanonicalConversationState(record.threadId)?.sidecar.hydrationContext ?? null;
    const latestModel =
      options.latestModel ??
      (options.mergeExistingTurns ? previousHydrationContext?.latestModel : null) ??
      input.model;
    const latestReasoningEffort =
      options.latestReasoningEffort === undefined
        ? input.reasoningEffort
        : options.latestReasoningEffort;
    const previousThreadSettings =
      this.readCanonicalConversationState(record.threadId)?.sidecar.latestThreadSettings ?? null;
    const latestThreadSettings: ThreadSettings = {
      cwd: currentCwd ?? fallbackHydrationCwd,
      approvalPolicy: currentPermissions.approvalPolicy,
      approvalsReviewer: currentPermissions.approvalsReviewer,
      sandboxPolicy: currentPermissions.sandboxPolicy,
      activePermissionProfile: currentPermissions.activePermissionProfile,
      model: latestModel,
      modelProvider: input.thread.modelProvider,
      serviceTier: input.serviceTier,
      effort: latestReasoningEffort,
      summary: previousThreadSettings?.summary ?? null,
      collaborationMode:
        record.latestThreadSettings?.collaborationMode ??
        previousThreadSettings?.collaborationMode ??
        record.latestCollaborationMode,
      multiAgentMode: input.multiAgentMode,
      personality:
        record.latestThreadSettings?.personality ?? previousThreadSettings?.personality ?? null,
    };
    const nextCanonicalState: CodexCanonicalConversationState = {
      ...canonicalState,
      turns: canonicalizeCodexCanonicalTurnStates(turns),
      requests: [...pendingRequests],
      sidecar: {
        hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
        latestThreadSettings,
        hydrationContext: {
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          latestModel,
          latestReasoningEffort,
          cwd: currentCwd,
          latestThreadSettings: {
            ...latestThreadSettings,
            permissions: currentPermissions.activePermissionProfile?.id ?? null,
          },
          currentPermissions,
        },
      },
    };
    return this.acceptCanonicalConversationState(record.threadId, nextCanonicalState);
  }

  private getThreadLinkSafely(threadId: string) {
    const detail = this.getMaybeConversationRecord(threadId)?.detail;
    if (detail) return detail;
    const thread = this.workspaceThreadProjectionById.get(threadId);
    if (thread) return this.buildWorkspaceThreadSummary(thread);
    return null;
  }

  private async resolveThreadServiceName(threadId: string): Promise<string | undefined> {
    const liveServiceName = this.getMaybeConversationRecord(threadId)?.detail?.serviceName;
    if (typeof liveServiceName === "string") return liveServiceName;

    const persistedServiceName = (await this.readWorkspaceThread(threadId))?.serviceName;
    return typeof persistedServiceName === "string" ? persistedServiceName : undefined;
  }

  private isConversationArchived(threadId: string): boolean {
    const record = this.getMaybeConversationRecord(threadId);
    if (record?.detail?.archived) return true;
    return this.getThreadLinkSafely(threadId)?.archived === true;
  }

  private applyCommittedConversationUnreadState(
    threadId: string,
    hasUnreadTurn: boolean,
    options: { readonly broadcast: boolean },
  ): void {
    const record = this.getMaybeConversationRecord(threadId);
    this.conversationAggregate(threadId).setHasUnreadTurn(
      hasUnreadTurn,
      !this.rendererConversations.hasOwner(threadId),
    );
    if (record?.detail) record.detail.hasUnreadTurn = hasUnreadTurn;
    if (!options.broadcast) return;
    this.emitHostMessage({
      type: "threadReadStateChanged",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: threadId,
      hasUnreadTurn,
    });
  }

  private listChildThreadLinksSafely(parentThreadId: string): CodexThreadSummary[] {
    return this.listThreadLinksSafely().filter(
      (thread) => thread.source?.parentThreadId === parentThreadId,
    );
  }

  private listThreadLinksSafely(): CodexThreadSummary[] {
    const summaries = new Map<string, CodexThreadSummary>();
    for (const thread of this.workspaceThreadProjectionById.values()) {
      const summary = this.buildWorkspaceThreadSummary(thread);
      summaries.set(summary.threadId, summary);
    }
    for (const [threadId, record] of this.conversationRecords) {
      if (record.detail) summaries.set(threadId, record.detail);
    }
    return [...summaries.values()];
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
          latestThreadSettings: record.latestThreadSettings,
          latestTokenUsageInfo: record.latestTokenUsageInfo,
          turns: [],
          transcript: [],
        }
      : {
          threadId,
          projectId: null,
          source: null,
          threadName: null,
          threadPreview: "",
          modelProvider: "",
          executionProfile: null,
          cwd: null,
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          hasUnreadTurn: this.conversationHasUnreadTurn(threadId),
          createdAt: 0,
          updatedAt: 0,
          linkedAt: new Date(0).toISOString(),
          latestCollaborationMode: record.latestCollaborationMode,
          latestThreadSettings: record.latestThreadSettings,
          latestTokenUsageInfo: record.latestTokenUsageInfo,
          turns: [],
          transcript: [],
        };
    return record.detail;
  }

  private setConversationResumeState(
    threadId: string,
    resumeState: CodexConversationResumeState,
  ): void {
    this.conversationAggregate(threadId).setResumeState(resumeState);
  }

  private resolveConversationResumeState(threadId: string): CodexConversationResumeState {
    return this.conversationRuntimes.currentConversation(threadId)?.readResumeState() ?? "resumed";
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
    this.conversationRuntimes.currentConversation(threadId)?.resetQueuedFollowUps(true);

    const nextSteers = this.listPendingSteers(threadId).filter((steer) =>
      retainedTurnIds.has(steer.turnId),
    );
    record.pendingSteers = nextSteers;
  }

  private clearThreadPendingRequestsForRemovedTurns(
    threadId: string,
    retainedTurnIds: ReadonlySet<string>,
    options: { readonly retainTurnless?: boolean } = {},
  ): void {
    const retainTurnless = options.retainTurnless ?? true;
    const shouldRetainTurn = (turnId: string): boolean =>
      (retainTurnless && turnId.length === 0) || retainedTurnIds.has(turnId);

    this.pendingServerRequests.rejectRemovedTurns(threadId, retainedTurnIds, options);

    const record = this.getMaybeConversationRecord(threadId);
    if (record) {
      const sourceRequests = this.readConversationServerRequests(record);
      const requests = sourceRequests.filter((request) => {
        const turnId = "turnId" in request.params ? request.params.turnId : null;
        return typeof turnId !== "string" || shouldRetainTurn(turnId);
      });
      if (requests.length !== sourceRequests.length) {
        this.replaceConversationServerRequests(threadId, requests);
      }
      this.userInputAutoResolution.reconcilePendingRequests(
        threadId,
        requests
          .filter((request) => request.method === "item/tool/requestUserInput")
          .map((request) => request.id),
      );
    }
  }

  private forgetThreadLocalState(threadId: string): void {
    this.clearThreadPendingRequestsForRemovedTurns(threadId, new Set(), {
      retainTurnless: false,
    });
    this.conversationRecords.delete(threadId);
    this.conversationRuntimes.currentConversation(threadId)?.reset();
    this.rendererConversations.clearConversation(threadId);
    this.userInputAutoResolution.clearConversation(threadId);
    this.rendererConversationCoordinator.reconcileOwnership(threadId);
    this.clearOwnerNotificationDrain(threadId);
    this.conversationDeltaBuffer.clear(threadId);
    this.activeGoalContinuation.clear(threadId);
    this.postResumeGoals.clear(threadId);
    this.conversationResume.clear(threadId);
    this.backgroundSubagentMetadataRepair.clear(threadId);
    this.subagentCatalog.clear(threadId);
    this.controlPlane.fork(
      this.queuedFollowUpDispatcher
        .cancel(threadId)
        .pipe(Effect.andThen(this.queuedFollowUps.clear(threadId))),
    );
  }

  private listQueuedFollowUps(threadId: string): CodexQueuedFollowUp[] {
    return [...this.queuedFollowUps.list(threadId)];
  }

  private listPendingSteers(threadId: string): CodexPendingSteer[] {
    return [...(this.getMaybeConversationRecord(threadId)?.pendingSteers ?? [])].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }

  private maybeDispatchQueuedFollowUp(threadId: string): void {
    this.controlPlane.fork(this.queuedFollowUps.requestDispatch(threadId));
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
    this.syncAcceptedConversationDocument(threadId, {
      syncPendingSteers: true,
    });
    return steerId;
  }

  private clearPendingSteer(threadId: string, steerId: string): void {
    const nextEntries = this.listPendingSteers(threadId).filter(
      (steer) => steer.steerId !== steerId,
    );
    if (nextEntries.length === 0) {
      this.ensureConversationRecord(threadId).pendingSteers = [];
    } else {
      this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    }
    this.syncAcceptedConversationDocument(threadId, {
      syncPendingSteers: true,
    });
  }

  private clearPendingSteerForConsumedPrompt(
    threadId: string,
    turnId: string,
    prompt: string,
  ): void {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;

    const nextEntries = this.listPendingSteers(threadId);
    const matchIndex = nextEntries.findIndex(
      (steer) => steer.turnId === turnId && steer.prompt.trim() === normalizedPrompt,
    );
    if (matchIndex < 0) return;

    nextEntries.splice(matchIndex, 1);
    this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    this.syncAcceptedConversationDocument(threadId, {
      syncPendingSteers: true,
    });
  }

  private clearPendingSteersForTurn(threadId: string, turnId: string, broadcast = true): void {
    const nextEntries = this.listPendingSteers(threadId).filter((steer) => steer.turnId !== turnId);
    if (nextEntries.length === this.listPendingSteers(threadId).length) return;
    this.ensureConversationRecord(threadId).pendingSteers = nextEntries;
    if (!broadcast) return;
    this.syncAcceptedConversationDocument(threadId, {
      syncPendingSteers: true,
    });
  }

  private emitThreadStartProgress(input: {
    projectId: string | null;
    sessionId: string | null;
    runInTarget: PageRunInTarget;
    threadId?: string | null;
    phase: CodexThreadStartProgressPhase;
    message: string;
    stream?: CodexThreadStartProgressStream;
    outputDelta?: string;
    clearOutput?: boolean;
  }): void {
    this.emitEvent({
      type: "threadStartProgress",
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget: input.runInTarget,
      threadId: input.threadId,
      phase: input.phase,
      message: input.message,
      stream: input.stream,
      outputDelta: input.outputDelta,
      clearOutput: input.clearOutput,
      updatedAt: Date.now(),
    });
  }

  private async readPermissionState(projectId: string | null): Promise<CodexPermissionState> {
    return await this.permissions.snapshot(projectId);
  }

  private async resolvePermissionStateForRequest(
    projectId: string | null,
    mode: CodexPermissionMode | undefined,
    workspaceRoots: readonly string[],
  ): Promise<{
    readonly state: CodexPermissionState;
    readonly verifiedBuiltinFullAccess: boolean;
  }> {
    return await this.permissions.resolve({ projectId, requestedMode: mode, workspaceRoots });
  }

  private async ensureClientReady(signal?: AbortSignal): Promise<void> {
    await this.client.start(signal ? { signal } : undefined);
    const readiness = await this.desktopTools.ensureReady();
    const pluginResult = readiness.plugins;
    const computerUseRuntime = readiness.computerUse;
    if (pluginResult?.status === "unavailable" && pluginResult.reason === "reconciliation-failed") {
      this.logger.warn("Browser plugin is unavailable after runtime verification", {
        message: pluginResult.message,
      });
    }
    if (
      computerUseRuntime?.status === "unavailable" &&
      computerUseRuntime.reason !== "architecture-unsupported" &&
      computerUseRuntime.reason !== "runtime-unavailable"
    ) {
      this.logger.warn("Computer Use runtime is unavailable", {
        message: computerUseRuntime.message,
        reason: computerUseRuntime.reason,
      });
    }
    if (
      pluginResult?.status === "ready" &&
      pluginResult.computerUse.status === "unavailable" &&
      pluginResult.computerUse.reason === "reconciliation-failed"
    ) {
      this.logger.warn("Computer Use plugin is unavailable", {
        message: pluginResult.computerUse.message,
      });
    }
  }

  private rememberWorkspaceThread(
    thread: DesktopProjectWorkspaceThread,
  ): DesktopProjectWorkspaceThread {
    this.workspaceThreadProjectionById.set(thread.threadId, thread);
    const record = this.getMaybeConversationRecord(thread.threadId);
    const detail = record?.detail;
    if (record && detail) {
      const summary = this.buildWorkspaceThreadSummary(thread);
      record.detail = {
        ...detail,
        ...summary,
        source: detail.source?.sideConversation === true ? detail.source : summary.source,
        turns: detail.turns,
        transcript: detail.transcript,
        latestCollaborationMode: detail.latestCollaborationMode,
        latestThreadSettings: detail.latestThreadSettings,
        latestTokenUsageInfo: detail.latestTokenUsageInfo,
      };
      this.conversationAggregate(thread.threadId).setHasUnreadTurn(
        summary.hasUnreadTurn ?? false,
        !this.rendererConversations.hasOwner(thread.threadId),
      );
    }
    return thread;
  }

  private rememberWorkspaceSidebar(
    sidebar: DesktopProjectWorkspaceSidebar,
  ): DesktopProjectWorkspaceSidebar {
    for (const thread of sidebar.threads) this.rememberWorkspaceThread(thread);
    return sidebar;
  }

  private async readWorkspaceThread(
    threadId: string,
  ): Promise<DesktopProjectWorkspaceThread | null> {
    const thread = await this.projectWorkspace.getThread(threadId);
    if (thread) return this.rememberWorkspaceThread(thread);
    this.workspaceThreadProjectionById.delete(threadId);
    return null;
  }

  private buildWorkspaceThreadSummary(
    thread: DesktopProjectWorkspaceThread,
    overrides: {
      readonly archived?: boolean;
      readonly hasUnreadTurn?: boolean;
      readonly pinnedOrder?: number | null;
    } = {},
  ): CodexThreadSummary {
    return buildWorkspaceThreadSummary(thread, overrides);
  }

  private async updateWorkspaceThreadSummary(
    threadId: string,
    patch: DesktopProjectWorkspaceThreadPatch,
  ): Promise<CodexThreadSummary | null> {
    const thread = await this.projectWorkspace.updateThread(threadId, patch);
    return thread ? this.buildWorkspaceThreadSummary(this.rememberWorkspaceThread(thread)) : null;
  }

  async listModels(): Promise<CodexModelOption[]> {
    return await this.composerCatalog.listModels();
  }

  private async listAgentProviderCatalog(options?: {
    refresh?: boolean;
  }): Promise<AgentProviderCatalog> {
    await this.ensureClientReady();
    return await this.agentProviderRuntime.list(options);
  }

  private async resolveAgentExecutionProfile(
    requested: AgentExecutionProfile | null | undefined,
  ): Promise<AgentExecutionProfile | null> {
    if (!requested) return null;
    return await this.agentProviderRuntime.resolveExecutionProfile(requested);
  }

  private async ensureAgentRuntimeCredentialReloaded(): Promise<void> {
    await this.agentProviderRuntime.ensureRuntimeReady();
  }

  private async resolveProjectAwareDeveloperInstructions(input: {
    baseInstructions?: string | null;
    cwd: string;
    model?: string | null;
    threadId: string | null;
    threadToolsEnabled?: boolean;
  }): Promise<string> {
    if (this.projectAwareDeveloperInstructionsResolver) {
      return await this.projectAwareDeveloperInstructionsResolver(input);
    }

    const isNonGitWorkspace = await this.resolveIsNonGitWorkspace(input.cwd);
    const heartbeatEnabled =
      input.threadId === null ? false : this.hasActiveHeartbeatForThread(input.threadId);
    return buildCodexDesktopDeveloperInstructions({
      baseInstructions: input.baseInstructions,
      gitSettings: this.gitSettingsResolver(),
      heartbeatEnabled,
      includeProseDetailLevelInstructions:
        getCodexDeveloperInstructionSettings().detailLevel === "STEPS_PROSE",
      isNonGitWorkspace,
      threadToolsEnabled: input.threadToolsEnabled,
      // Nodex does not package the target's workspace-dependencies runtime yet.
      workspaceDependenciesEnabled: false,
    });
  }

  private async buildMcpCodexConfig(
    cwd: string | null,
  ): Promise<NonNullable<ThreadStartParams["config"]> | null> {
    if (this.threadCodexConfigBuilder) {
      return await this.threadCodexConfigBuilder(cwd);
    }
    return null;
  }

  private hasActiveHeartbeatForThread(threadId: string): boolean {
    return this.automationRouting.activeHeartbeatAutomationId(threadId) !== null;
  }

  private async resolveIsNonGitWorkspace(cwd: string): Promise<boolean> {
    return await this.gitProbe.isNonGitWorkspace(cwd);
  }

  private async readWorktreeShellEnvironment(
    cwd: string,
  ): Promise<ReturnType<typeof parseCodexStoredShellEnvironment>> {
    const gitPath = await this.readGitPath(cwd, [
      "rev-parse",
      "--git-path",
      "codex-shell-environment.json",
    ]);
    if (!gitPath) return null;

    const configPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(cwd, gitPath);
    try {
      const parsed = parseCodexStoredShellEnvironment(
        JSON.parse(await readFile(configPath, "utf8")),
      );
      if (parsed) return parsed;
      this.logger.warn("Ignoring invalid worktree shell environment config", {
        configPath,
      });
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async persistWorktreeShellEnvironment(
    cwd: string,
    shellEnvironment: CodexStoredShellEnvironment | null,
  ): Promise<void> {
    await persistCodexWorktreeShellEnvironment({
      cwd,
      shellEnvironment,
      resolveGitPath: async (worktreeCwd, fileName) =>
        await this.readGitPath(worktreeCwd, ["rev-parse", "--git-path", fileName]),
    });
  }

  private async evaluateThreadHandoffCapability(
    sourceHostId: string,
    destinationHostId: string,
  ): Promise<CodexThreadHandoffCapability> {
    const crossHost = sourceHostId !== destinationHostId;
    const hosts = await this.controlPlane.runPromise(this.executionHosts.hosts());
    const byId = new Map(hosts.map((host) => [host.hostId, host]));
    const localTransactionEffects = (hostId: string): boolean =>
      ["prepare-handoff", "rollback-handoff", "cleanup-handoff"].every((operation) =>
        byId.get(hostId)?.capabilities.includes(operation as CodexWorktreeWorkerOperation),
      );
    const sourceTransactionEffects = crossHost
      ? ["export-handoff", "cleanup-transfer-handoff"].every((operation) =>
          byId.get(sourceHostId)?.capabilities.includes(operation as CodexWorktreeWorkerOperation),
        )
      : sourceHostId === CODEX_APP_LOCAL_HOST_ID && localTransactionEffects(sourceHostId);
    const destinationTransactionEffects = crossHost
      ? ["import-handoff", "cleanup-transfer-handoff"].every((operation) =>
          byId
            .get(destinationHostId)
            ?.capabilities.includes(operation as CodexWorktreeWorkerOperation),
        )
      : destinationHostId === CODEX_APP_LOCAL_HOST_ID && localTransactionEffects(destinationHostId);
    return evaluateCodexThreadHandoffCapability({
      runtimeVersion: this.runtimeVersion,
      appServer: {
        threadSettingsUpdate: this.threadSettingsRuntime.remoteUpdateSupport() !== "unsupported",
        threadResumeLocation: true,
        rolloutPathConsistency: true,
      },
      coreAtomicExecutionLocation: true,
      sourceHost: {
        available: byId.get(sourceHostId)?.capabilities.includes("create") ?? false,
        transactionEffects: sourceTransactionEffects,
      },
      destinationHost: {
        available: byId.get(destinationHostId)?.capabilities.includes("create") ?? false,
        transactionEffects: destinationTransactionEffects,
      },
      crossHost,
      crossHostTransfer:
        crossHost &&
        (byId.get(sourceHostId)?.supportsFileTransfer ?? false) &&
        (byId.get(destinationHostId)?.supportsFileTransfer ?? false),
    });
  }

  private evaluateLocalThreadHandoffCapability(): Promise<CodexThreadHandoffCapability> {
    return this.evaluateThreadHandoffCapability(CODEX_APP_LOCAL_HOST_ID, CODEX_APP_LOCAL_HOST_ID);
  }

  private async buildThreadHandoffToolOptions(): Promise<{
    readonly availableHandoffHosts: Array<{ id: string; displayName: string }>;
    readonly crossHostHandoffEnabled: boolean;
    readonly handoffEnabled: boolean;
  }> {
    const hosts = await this.controlPlane.runPromise(this.executionHosts.hosts());
    const availableHandoffHosts = hosts
      .filter((host) => host.supportsFileTransfer)
      .filter((host) => host.capabilities.includes("cleanup-transfer-handoff"))
      .filter(
        (host) =>
          host.capabilities.includes("export-handoff") ||
          host.capabilities.includes("import-handoff"),
      )
      .map((host) => ({ id: host.hostId, displayName: host.displayName }));
    return {
      availableHandoffHosts,
      crossHostHandoffEnabled: availableHandoffHosts.length >= 2,
      handoffEnabled:
        (
          await this.evaluateThreadHandoffCapability(
            CODEX_APP_LOCAL_HOST_ID,
            CODEX_APP_LOCAL_HOST_ID,
          )
        ).status === "available" || availableHandoffHosts.length >= 2,
    };
  }

  private async buildCodexDynamicToolSpecs(): Promise<DynamicToolSpec[]> {
    const handoff = await this.buildThreadHandoffToolOptions();
    return [...buildCodexAppMetaThreadToolSpecs(handoff), ...NODEX_AGENT_DYNAMIC_TOOL_SPECS];
  }

  private async buildNewConversationParams(
    input: BuildCodexNewConversationParamsInput,
  ): Promise<ThreadStartParams> {
    await this.ensureAgentRuntimeCredentialReloaded();
    return await buildCodexNewConversationParams(input, {
      readConfigRequirements: async () =>
        await this.client.request<"configRequirements/read", ConfigRequirementsReadResponse>(
          "configRequirements/read",
          undefined,
        ),
      buildMcpCodexConfig: async (cwd) => await this.buildMcpCodexConfig(cwd),
      readWorktreeShellEnvironment: async (cwd) => await this.readWorktreeShellEnvironment(cwd),
      readEffectiveConfig: async (cwd) => {
        const response = await this.client.request<"config/read", ConfigReadResponse>(
          "config/read",
          { includeLayers: false, cwd },
        );
        return response.config;
      },
      loadDynamicTools: async () => {
        try {
          return [
            ...buildCodexAppMetaThreadToolSpecs({
              availableModels: await this.listModels(),
              ...(await this.buildThreadHandoffToolOptions()),
            }),
            ...NODEX_AGENT_DYNAMIC_TOOL_SPECS,
          ];
        } catch (error) {
          this.logger.warn("Failed to load model-aware dynamic tools", { error });
          return await this.buildCodexDynamicToolSpecs();
        }
      },
      loadDynamicToolsWithDeadline: (operation) => this.dynamicToolsLaunch.load(operation),
      resolveDeveloperInstructions: async (developerInput) =>
        await this.resolveProjectAwareDeveloperInstructions({
          baseInstructions: developerInput.baseInstructions,
          cwd: developerInput.cwd,
          model: developerInput.model,
          threadId: developerInput.threadId,
          threadToolsEnabled: developerInput.threadToolsEnabled,
        }),
      onConfigRequirementsError: (error) => {
        this.logger.warn("Failed to load config requirements for service tier", { error });
      },
      onShellEnvironmentError: (error) => {
        this.logger.warn("Failed to apply worktree shell environment config", {
          cwd: input.cwd,
          error,
        });
      },
    });
  }

  private async persistDynamicToolCatalogsForLaunch(
    threadId: string,
    specs: ThreadStartParams["dynamicTools"],
  ): Promise<void> {
    await this.projectWorkspace.replaceThreadDynamicToolCatalogs(
      threadId,
      resolveDynamicToolCatalogBindings(specs),
    );
  }

  private async readGitPath(cwd: string, args: string[]): Promise<string | null> {
    return await this.gitProbe.readPath(cwd, args);
  }

  private async resolveAgentConfigOverrides(
    agentConfigs: CodexPromptAgentConfigInput[],
  ): Promise<PreparedPromptForTurn["agentConfigOverrides"]> {
    const overrides: PreparedPromptForTurn["agentConfigOverrides"] = {};
    let requestedModel: string | null = null;

    for (const config of agentConfigs) {
      const unknownAttributes = config.unknownAttributes ?? [];
      if (unknownAttributes.length > 0) {
        throw new Error(
          `Unsupported agent config ${unknownAttributes.length === 1 ? "attribute" : "attributes"}: ${unknownAttributes.join(", ")}`,
        );
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
      const visibleModel = models.find(
        (model) => !model.hidden && (model.id === requestedModel || model.model === requestedModel),
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

  private async preparePromptForTurn(
    prompt: string,
    promptInput?: CodexPromptInput,
    options: { readonly allowEmptyTextPlaceholder?: boolean } = {},
  ): Promise<PreparedPromptForTurn> {
    const prepared = await prepareCodexPrompt(prompt, promptInput, {
      resolveImageInput: (source) => this.resolvePromptImageInput(source),
      allowEmptyTextPlaceholder: options.allowEmptyTextPlaceholder,
    });

    return await this.materializePreparedPromptTextAttachments({
      promptText: prepared.promptText,
      inputItems: [...prepared.inputItems],
      pendingInputItems: [...prepared.pendingInputItems],
      fileAttachments: [...prepared.fileAttachments],
      addedFiles: [...prepared.addedFiles],
      pastedTextAttachments: [...prepared.pastedTextAttachments],
      ...(prepared.additionalContext ? { additionalContext: prepared.additionalContext } : {}),
      commentAttachments: [...prepared.commentAttachments],
      agentConfigOverrides: await this.resolveAgentConfigOverrides([...prepared.agentConfigs]),
    });
  }

  private async usePreparedPromptForTurn(
    prepared: CodexPreparedPrompt,
  ): Promise<PreparedPromptForTurn> {
    return await this.materializePreparedPromptTextAttachments({
      promptText: prepared.promptText,
      inputItems: [...prepared.inputItems],
      pendingInputItems: [...prepared.pendingInputItems],
      fileAttachments: [...prepared.fileAttachments],
      addedFiles: [...prepared.addedFiles],
      pastedTextAttachments: [...prepared.pastedTextAttachments],
      ...(prepared.additionalContext ? { additionalContext: prepared.additionalContext } : {}),
      commentAttachments: [...prepared.commentAttachments],
      agentConfigOverrides: await this.resolveAgentConfigOverrides([...prepared.agentConfigs]),
    });
  }

  private async materializePreparedPromptTextAttachments(
    prepared: PreparedPromptForTurn,
  ): Promise<PreparedPromptForTurn> {
    if (prepared.pastedTextAttachments.length === 0) return prepared;

    const manager = this.attachments.pastedText;
    const attachmentTexts = await Promise.all(
      prepared.pastedTextAttachments.map((attachment) =>
        "text" in attachment
          ? Promise.resolve(attachment.text)
          : manager.readRawSource(attachment.file),
      ),
    );
    const attachmentItems = attachmentTexts.flatMap((text) =>
      text.trim().length > 0 ? [createTextUserInput(text)] : [],
    );
    if (attachmentItems.length === 0) return prepared;

    const firstItem = prepared.inputItems[0];
    const insertAfterPrimaryText =
      firstItem?.type === "text" && firstItem.text === prepared.promptText;
    const insertionIndex = insertAfterPrimaryText ? 1 : 0;
    return {
      ...prepared,
      inputItems: [
        ...prepared.inputItems.slice(0, insertionIndex),
        ...attachmentItems,
        ...prepared.inputItems.slice(insertionIndex),
      ],
    };
  }

  private parseThreadRef(threadId: string): ThreadRef | null {
    const link = this.getThreadLinkSafely(threadId);
    const detail = this.getMaybeConversationRecord(threadId)?.detail ?? null;
    const source = link ?? detail;
    if (!source) return null;
    return {
      projectId: source.projectId,
      cwd: source.cwd,
      executionProfile: source.executionProfile,
      managedWorktreePath: source.managedWorktreePath ?? null,
      projectlessOutputDirectory: source.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: source.projectlessWorkspaceBrowserRoot ?? null,
    };
  }

  private async resolveProjectRuntimeContext(projectId: string): Promise<{
    canonicalProjectId: string;
    primaryWorkspaceRoot: string | null;
    workspaceRoots: string[];
  }> {
    const project = await this.projectWorkspace.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (project.lifecycle !== "active") {
      throw new Error(`Project ${projectId} is ${project.lifecycle} and cannot start work`);
    }
    const workspaceRoots = project.sources.map((source) => source.root);
    return {
      canonicalProjectId: project.id,
      primaryWorkspaceRoot: workspaceRoots[0] ?? null,
      workspaceRoots,
    };
  }

  private async maybeResolveProjectRuntimeContext(projectId: string): Promise<{
    canonicalProjectId: string;
    primaryWorkspaceRoot: string | null;
    workspaceRoots: string[];
  }> {
    return await this.resolveProjectRuntimeContext(projectId);
  }

  private async requirePrimaryWorkspaceRoot(projectId: string): Promise<{
    canonicalProjectId: string;
    primaryWorkspaceRoot: string;
    workspaceRoots: string[];
  }> {
    const context = await this.resolveProjectRuntimeContext(projectId);
    if (!context.primaryWorkspaceRoot) {
      throw new Error("Project requires at least one source folder for this action.");
    }
    return {
      canonicalProjectId: context.canonicalProjectId,
      primaryWorkspaceRoot: context.primaryWorkspaceRoot,
      workspaceRoots: context.workspaceRoots,
    };
  }

  private async createProjectlessThreadWorkspace(projectId: string): Promise<string> {
    const context = await this.resolveProjectRuntimeContext(projectId);
    const workspacePath = path.resolve(
      getNodexHome(),
      "projectless-workspaces",
      context.canonicalProjectId,
      randomUUID(),
    );
    mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
  }

  private async resolveLocalProjectThreadRoot(projectId: string): Promise<{
    cwd: string;
    workspaceRoots: string[];
  }> {
    const context = await this.resolveProjectRuntimeContext(projectId);
    if (context.primaryWorkspaceRoot) {
      return {
        cwd: context.primaryWorkspaceRoot,
        workspaceRoots: context.workspaceRoots,
      };
    }
    const cwd = await this.createProjectlessThreadWorkspace(projectId);
    return {
      cwd,
      workspaceRoots: [cwd],
    };
  }

  private asTurnSummary(
    threadId: string,
    turn: unknown,
  ): (CodexTurnSummary & { turnId: string }) | null {
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
          ? ((candidate.error as Record<string, unknown>).message as string)
          : undefined
        : undefined;
    const tokenUsage = parseCodexThreadTokenUsage(candidate.tokenUsage ?? candidate.token_usage);
    const interruptedCommandExecutionItemIds = Array.isArray(
      candidate.interruptedCommandExecutionItemIds,
    )
      ? candidate.interruptedCommandExecutionItemIds.filter(
          (value): value is string => typeof value === "string",
        )
      : Array.isArray(candidate.interrupted_command_execution_item_ids)
        ? candidate.interrupted_command_execution_item_ids.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
    const commandExecutionStartedAtMsByIdCandidate = asRecord(
      candidate.commandExecutionStartedAtMsById ?? candidate.command_execution_started_at_ms_by_id,
    );
    const commandExecutionStartedAtMsById = commandExecutionStartedAtMsByIdCandidate
      ? Object.fromEntries(
          Object.entries(commandExecutionStartedAtMsByIdCandidate).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1]),
          ),
        )
      : undefined;
    const startedAt = normalizeOptionalTimestamp(candidate.startedAt ?? candidate.started_at);
    const completedAt = normalizeOptionalTimestamp(candidate.completedAt ?? candidate.completed_at);
    const turnStartedAtMs =
      normalizeOptionalTimestamp(candidate.turnStartedAtMs ?? candidate.turn_started_at_ms) ??
      startedAt;
    const firstTurnWorkItemStartedAtMs = normalizeOptionalTimestamp(
      candidate.firstTurnWorkItemStartedAtMs ?? candidate.first_turn_work_item_started_at_ms,
    );
    const finalAssistantStartedAtMs =
      normalizeOptionalTimestamp(
        candidate.finalAssistantStartedAtMs ?? candidate.final_assistant_started_at_ms,
      ) ?? completedAt;

    const summary: CodexTurnSummary & { turnId: string } = {
      threadId,
      turnId: candidate.id,
      status: makeTurnStatus(candidate.status),
      errorMessage,
      itemIds,
      turnStartedAtMs,
      firstTurnWorkItemStartedAtMs,
      finalAssistantStartedAtMs,
      startedAt,
      completedAt,
      durationMs: getFiniteNumber(candidate.durationMs ?? candidate.duration_ms) ?? null,
      commandExecutionStartedAtMsById,
      interruptedCommandExecutionItemIds,
      tokenUsage,
    };
    if (Object.prototype.hasOwnProperty.call(candidate, "diff")) {
      summary.diff = parseTurnDiff(candidate);
    }
    return summary;
  }

  private buildCanonicalTurnSummary(
    threadId: string,
    turn: CodexCanonicalTurnState,
    itemIds: readonly string[],
  ): CodexTurnSummary {
    const turnId = turn.protocol.id;
    return {
      threadId,
      turnId,
      status: turn.protocol.status,
      errorMessage: turn.protocol.error?.message ?? undefined,
      ...(turn.sidecar.diff === null ? {} : { diff: turn.sidecar.diff }),
      itemIds: [...itemIds],
      turnStartedAtMs: turn.sidecar.turnStartedAtMs,
      ...(turn.sidecar.firstTurnWorkItemStartedAtMs === undefined
        ? {}
        : {
            firstTurnWorkItemStartedAtMs: turn.sidecar.firstTurnWorkItemStartedAtMs,
          }),
      finalAssistantStartedAtMs: turn.sidecar.finalAssistantStartedAtMs,
      startedAt: turn.sidecar.turnStartedAtMs,
      completedAt: turn.sidecar.completedAtMs ?? null,
      durationMs: turn.protocol.durationMs,
      ...(turn.sidecar.commandExecutionStartedAtMsById === undefined
        ? {}
        : {
            commandExecutionStartedAtMsById: {
              ...turn.sidecar.commandExecutionStartedAtMsById,
            },
          }),
      ...(turn.sidecar.interruptedCommandExecutionItemIds === undefined
        ? {}
        : {
            interruptedCommandExecutionItemIds: [
              ...turn.sidecar.interruptedCommandExecutionItemIds,
            ],
          }),
      ...(turn.sidecar.hookRuns === undefined ? {} : { hookRuns: [...turn.sidecar.hookRuns] }),
      ...(turn.sidecar.safetyBuffering === undefined
        ? {}
        : {
            safetyBuffering: {
              useCases: [...turn.sidecar.safetyBuffering.useCases],
              reasons: [...turn.sidecar.safetyBuffering.reasons],
              showBufferingUi: turn.sidecar.safetyBuffering.showBufferingUi,
              fasterModel: turn.sidecar.safetyBuffering.fasterModel,
            },
          }),
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
    const mergedCommandExecutionStartedAtMsById =
      existing.commandExecutionStartedAtMsById ?? turn.commandExecutionStartedAtMsById;
    detail.turns = detail.turns.map((candidate) =>
      candidate.turnId !== turn.turnId
        ? candidate
        : {
            ...existing,
            ...turn,
            errorMessage: turn.errorMessage ?? existing.errorMessage,
            turnStartedAtMs: turn.turnStartedAtMs ?? existing.turnStartedAtMs,
            firstTurnWorkItemStartedAtMs:
              turn.firstTurnWorkItemStartedAtMs ?? existing.firstTurnWorkItemStartedAtMs,
            finalAssistantStartedAtMs: options?.preferIncomingFinalAssistantStartedAtMs
              ? (turn.finalAssistantStartedAtMs ?? existing.finalAssistantStartedAtMs)
              : (existing.finalAssistantStartedAtMs ?? turn.finalAssistantStartedAtMs),
            startedAt: turn.startedAt ?? existing.startedAt,
            completedAt: turn.completedAt ?? existing.completedAt,
            durationMs: turn.durationMs ?? existing.durationMs,
            commandExecutionStartedAtMsById: mergedCommandExecutionStartedAtMsById,
            itemIds: mergedItemIds,
            interruptedCommandExecutionItemIds: mergedInterruptedCommandExecutionItemIds,
            tokenUsage: turn.tokenUsage ?? existing.tokenUsage,
            safetyBuffering: turn.safetyBuffering ?? existing.safetyBuffering,
          },
    );
  }

  private resolveLoadedCanonicalThread(threadId: string): Thread | null {
    const state = this.readCanonicalConversationState(threadId);
    if (!state) return null;

    return {
      ...state.protocol,
      turns: state.turns.flatMap((turn): Turn[] => {
        if (turn.protocol.id === null) return [];
        return [
          {
            ...turn.protocol,
            id: turn.protocol.id,
            items: turn.items.filter(isCodexCanonicalProtocolItem),
            startedAt: turn.sidecar.turnStartedAtMs,
            completedAt: turn.sidecar.completedAtMs ?? null,
          },
        ];
      }),
    };
  }

  private applyCanonicalLifecycleTurnProjection(input: {
    threadId: string;
    turnIndex: number;
    beforeTurn: CodexCanonicalTurnState | null;
    afterTurn: CodexCanonicalTurnState;
    observedAtMs: number;
    lifecycleStatus?: "inProgress" | "completed";
    preserveExistingUpdatedAt?: boolean;
  }): string | null {
    const targetTurnId = input.afterTurn.protocol.id;
    const record = this.getMaybeConversationRecord(input.threadId);
    const detail = record?.detail;
    if (!record || !detail) return null;
    record.itemsByTurn = new Map([...record.itemsByTurn].filter(([turnId]) => turnId !== null));

    const sourceTurnId = input.beforeTurn ? input.beforeTurn.protocol.id : targetTurnId;
    const existingTurn = detail.turns[input.turnIndex] ?? null;
    const existingItemIds = new Set(existingTurn?.itemIds ?? []);
    const currentTranscript =
      existingTurn === null
        ? []
        : detail.transcript.filter((entry) =>
            existingTurn.turnId === null
              ? existingItemIds.has(entry.itemId)
              : entry.turnId === sourceTurnId ||
                (sourceTurnId !== targetTurnId && entry.turnId === targetTurnId),
          );
    const cachedViews =
      sourceTurnId === null
        ? null
        : (record.itemsByTurn.get(sourceTurnId) ??
          (targetTurnId === null ? null : record.itemsByTurn.get(targetTurnId)));
    const currentViews = cachedViews
      ? [...cachedViews.values()]
      : currentTranscript.map(projectTranscriptEntryToItemView);
    const projection = applyCodexLifecycleProjectionDiff({
      threadId: input.threadId,
      turnKey: buildCodexTurnOccurrenceKey(targetTurnId, input.turnIndex),
      beforeTurn: input.beforeTurn,
      afterTurn: input.afterTurn,
      currentViews,
      currentTranscript,
      observedAtMs: input.observedAtMs,
      lifecycleStatus: input.lifecycleStatus,
      isBackgroundSubagentsEnabled: true,
      preserveExistingUpdatedAt: input.preserveExistingUpdatedAt,
    });
    const canonicalSummary = this.buildCanonicalTurnSummary(
      input.threadId,
      input.afterTurn,
      projection.itemIds,
    );

    const detailTurnIndex = existingTurn === null ? -1 : input.turnIndex;
    const projectedItemIds =
      targetTurnId === null
        ? [...new Set(projection.transcript.map((entry) => entry.itemId))]
        : [...projection.itemIds];
    const nextTurn: CodexTurnSummary = {
      ...(existingTurn ?? canonicalSummary),
      threadId: input.threadId,
      turnId: targetTurnId,
      status: canonicalSummary.status,
      errorMessage: input.afterTurn.protocol.error?.message ?? undefined,
      diff: input.afterTurn.sidecar.diff ?? undefined,
      durationMs: input.afterTurn.protocol.durationMs,
      itemIds: projectedItemIds,
      turnStartedAtMs: input.afterTurn.sidecar.turnStartedAtMs,
      firstTurnWorkItemStartedAtMs: input.afterTurn.sidecar.firstTurnWorkItemStartedAtMs,
      finalAssistantStartedAtMs: input.afterTurn.sidecar.finalAssistantStartedAtMs,
      startedAt: input.afterTurn.sidecar.turnStartedAtMs,
      completedAt: input.afterTurn.sidecar.completedAtMs ?? null,
      commandExecutionStartedAtMsById:
        input.afterTurn.sidecar.commandExecutionStartedAtMsById === undefined
          ? undefined
          : { ...input.afterTurn.sidecar.commandExecutionStartedAtMsById },
      interruptedCommandExecutionItemIds:
        input.afterTurn.sidecar.interruptedCommandExecutionItemIds === undefined
          ? undefined
          : [...input.afterTurn.sidecar.interruptedCommandExecutionItemIds],
      hookRuns:
        input.afterTurn.sidecar.hookRuns === undefined
          ? undefined
          : [...input.afterTurn.sidecar.hookRuns],
      safetyBuffering:
        input.afterTurn.sidecar.safetyBuffering === undefined
          ? undefined
          : {
              ...input.afterTurn.sidecar.safetyBuffering,
              useCases: [...input.afterTurn.sidecar.safetyBuffering.useCases],
              reasons: [...input.afterTurn.sidecar.safetyBuffering.reasons],
            },
    };
    if (detailTurnIndex >= 0) {
      detail.turns = detail.turns.map((turn, index) =>
        index === detailTurnIndex ? nextTurn : turn,
      );
    } else {
      const turnIndex = Math.min(input.turnIndex, detail.turns.length);
      detail.turns = [
        ...detail.turns.slice(0, turnIndex),
        nextTurn,
        ...detail.turns.slice(turnIndex),
      ];
    }

    if (sourceTurnId !== null && sourceTurnId !== targetTurnId) {
      record.itemsByTurn.delete(sourceTurnId);
    }
    if (targetTurnId !== null) {
      const nextItems = new Map<string, CodexItemView>();
      for (const view of projection.views) {
        nextItems.set(resolveCodexItemPrimaryIdentityKey(view), view);
      }
      record.itemsByTurn.set(targetTurnId, nextItems);
    }

    const matchingTranscriptIndexes = detail.transcript.flatMap((entry, index) => {
      if (existingTurn === null) return [];
      if (existingTurn.turnId === null) {
        return existingItemIds.has(entry.itemId) ? [index] : [];
      }
      return entry.turnId === sourceTurnId ||
        (sourceTurnId !== targetTurnId && entry.turnId === targetTurnId)
        ? [index]
        : [];
    });
    const previousTurnItemIds = new Set(detail.turns[input.turnIndex - 1]?.itemIds ?? []);
    const previousTranscriptIndex = detail.transcript.findLastIndex((entry) =>
      previousTurnItemIds.has(entry.itemId),
    );
    const insertionIndex =
      matchingTranscriptIndexes[0] ??
      (previousTranscriptIndex >= 0 ? previousTranscriptIndex + 1 : detail.transcript.length);
    const withoutChangedTurn = detail.transcript.filter((entry) => {
      if (existingTurn === null) return true;
      if (existingTurn.turnId === null) return !existingItemIds.has(entry.itemId);
      return entry.turnId !== sourceTurnId && entry.turnId !== targetTurnId;
    });
    withoutChangedTurn.splice(insertionIndex, 0, ...projection.transcript);
    this.setThreadTranscript(input.threadId, withoutChangedTurn);
    return targetTurnId;
  }

  private applyCanonicalTurnMutation(input: {
    threadId: string;
    turnId: string;
    before: CodexCanonicalConversationState;
    after: CodexCanonicalConversationState;
    observedAtMs?: number;
  }): boolean {
    if (input.after === input.before) return false;
    const record = this.getMaybeConversationRecord(input.threadId);
    if (!record) return false;

    const turnIndex = input.after.turns.findIndex((turn) => turn.protocol.id === input.turnId);
    const afterTurn = input.after.turns[turnIndex];
    if (!afterTurn) return false;
    this.acceptCanonicalConversationState(input.threadId, input.after);
    this.applyCanonicalLifecycleTurnProjection({
      threadId: input.threadId,
      turnIndex,
      beforeTurn: input.before.turns[turnIndex] ?? null,
      afterTurn,
      observedAtMs: input.observedAtMs ?? Date.now(),
    });
    return true;
  }

  private commitCanonicalLocalTurnMutation(input: {
    threadId: string;
    before: CodexCanonicalConversationState;
    after: CodexCanonicalConversationState;
    observedAtMs: number;
  }): void {
    if (input.after === input.before) return;
    const record = this.getMaybeConversationRecord(input.threadId);
    if (!record) return;

    this.acceptCanonicalConversationState(input.threadId, input.after);
    if (input.after.turns.length < input.before.turns.length) {
      if (!record.detail) return;
      const timeline = this.buildThreadTimelineFromCanonicalState(input.after);
      this.setConversationRecordDetail(
        {
          ...record.detail,
          ...timeline,
        },
        { preserveTurnPagination: true },
      );
      return;
    }
    for (const [turnIndex, afterTurn] of input.after.turns.entries()) {
      const beforeTurn = input.before.turns[turnIndex] ?? null;
      if (afterTurn === beforeTurn) continue;
      this.applyCanonicalLifecycleTurnProjection({
        threadId: input.threadId,
        turnIndex,
        beforeTurn,
        afterTurn,
        observedAtMs: input.observedAtMs,
      });
    }
  }

  private reduceCanonicalMainTurnMetadataNotification(
    notification: CodexServerNotification,
    observedAtMs: number,
  ): readonly string[] {
    const params = asRecord(notification.params);
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    if (!threadId) return [];
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) {
      this.logger.warn("Dropping turn metadata without canonical conversation state", {
        threadId,
        method: notification.method,
      });
      return [];
    }

    const result = reduceCodexConversationEventWithEffects(
      before,
      { type: "notification", notification },
      {
        now: () => observedAtMs,
        createId: () => randomUUID(),
      },
    );
    this.acceptCanonicalConversationState(threadId, result.state);
    const changedTurnIds: string[] = [];
    for (const [turnIndex, afterTurn] of result.state.turns.entries()) {
      const beforeTurn = before.turns[turnIndex] ?? null;
      if (afterTurn === beforeTurn) continue;
      const turnId = this.applyCanonicalLifecycleTurnProjection({
        threadId,
        turnIndex,
        beforeTurn,
        afterTurn,
        observedAtMs,
        preserveExistingUpdatedAt: true,
      });
      if (turnId) changedTurnIds.push(turnId);
    }

    for (const effect of result.effects) {
      if (effect.type === "markConversationStreaming") {
        this.conversationAggregate(threadId).setStreaming(true);
        continue;
      }
      if (effect.type === "touchConversationUpdatedAt" && record.detail) {
        record.detail = {
          ...record.detail,
          updatedAt: Math.max(record.detail.updatedAt, effect.observedAtMs),
        };
      }
    }
    return changedTurnIds;
  }

  private reduceCanonicalMainThreadMetadataNotification(
    notification: CodexServerNotification,
  ): readonly CodexConversationReducerEffect[] {
    const params = asRecord(notification.params);
    const threadId =
      typeof params?.threadId === "string"
        ? params.threadId
        : typeof asRecord(params?.thread)?.id === "string"
          ? (asRecord(params?.thread)?.id as string)
          : null;
    if (!threadId) return [];
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) {
      this.logger.warn("Dropping thread metadata without canonical conversation state", {
        threadId,
        method: notification.method,
      });
      return [];
    }

    const result = reduceCodexConversationEventWithEffects(
      before,
      { type: "notification", notification },
      {
        now: () => Date.now(),
        createId: () => randomUUID(),
      },
    );
    this.acceptCanonicalConversationState(threadId, result.state);
    this.projectCanonicalMainThreadMetadata(threadId);
    return result.effects;
  }

  private projectCanonicalMainThreadMetadata(threadId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    const canonical = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !canonical) return;
    const status = parseThreadStatus(canonical.protocol.status);
    const protocolSettings = canonical.sidecar.latestThreadSettings;
    const latestThreadSettings = protocolSettings
      ? this.parseConversationThreadSettingsFromProtocol(
          protocolSettings,
          record.latestThreadSettings,
          record.latestCollaborationMode,
        )
      : record.latestThreadSettings;
    record.latestThreadSettings = latestThreadSettings;
    if (latestThreadSettings?.collaborationMode) {
      record.latestCollaborationMode = latestThreadSettings.collaborationMode;
    }
    record.latestTokenUsageInfo = canonical.sidecar.latestTokenUsageInfo ?? null;
    record.threadGoal = canonical.sidecar.threadGoal ?? null;
    record.completedThreadGoal = canonical.sidecar.completedThreadGoal ?? null;
    record.threadGoalResumeConfirmation = canonical.sidecar.threadGoalResumeConfirmation ?? null;
    if (!record.detail) return;
    record.detail = {
      ...record.detail,
      threadName: canonical.protocol.name?.trim() || record.detail.threadName,
      cwd: canonical.protocol.cwd,
      modelProvider: canonical.protocol.modelProvider,
      statusType: status.statusType,
      statusActiveFlags: status.statusActiveFlags,
      threadRuntimeStatus: status.threadRuntimeStatus,
      latestCollaborationMode: record.latestCollaborationMode,
      latestThreadSettings,
      latestTokenUsageInfo: record.latestTokenUsageInfo,
    };
  }

  private publishCanonicalMainTurnMetadata(
    threadId: string,
    turnIds: readonly string[],
    ownerRouted: boolean,
  ): void {
    if (turnIds.length === 0) return;
    if (ownerRouted) {
      this.syncAcceptedConversationDocumentSilently(threadId);
      return;
    }
    for (const turnId of turnIds) {
      this.syncAcceptedConversationTurnState(threadId, turnId, {
        syncBackgroundTerminalRows: true,
        syncChildMemberships: true,
        syncCapabilityFlags: true,
      });
    }
  }

  private reduceCanonicalMainTurnLifecycle(input: {
    threadId: string;
    method: "turn/started" | "turn/completed";
    turn: Pick<Turn, "id" | "status" | "error" | "startedAt" | "completedAt" | "durationMs">;
    observedAtMs: number;
  }): string | null {
    const record = this.getMaybeConversationRecord(input.threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) return null;
    const result = reduceCodexConversationTurnLifecycle(before, {
      conversationId: input.threadId,
      method: input.method,
      turn: input.turn,
      observedAtMs: input.observedAtMs,
    });
    this.acceptCanonicalConversationState(record.threadId, result.state);
    let targetTurnId: string | null = null;
    for (const [turnIndex, afterTurn] of result.state.turns.entries()) {
      const beforeTurn = before.turns[turnIndex] ?? null;
      if (afterTurn === beforeTurn) continue;
      targetTurnId =
        this.applyCanonicalLifecycleTurnProjection({
          threadId: input.threadId,
          turnIndex,
          beforeTurn,
          afterTurn,
          observedAtMs: input.observedAtMs,
        }) ?? targetTurnId;
    }
    return targetTurnId;
  }

  private rebindRecordedTurn(input: {
    threadId: string;
    turnIndex: number;
    targetTurnId: string;
    status: CodexTurnStatus;
    turnStartedAtMs: number | null;
  }): CodexTurnSummary | null {
    const record = this.getMaybeConversationRecord(input.threadId);
    const detail = record?.detail;
    const sourceTurn = detail?.turns[input.turnIndex];
    if (!record || !detail || !sourceTurn) return null;
    const sourceTurnId = (sourceTurn as { turnId: string | null }).turnId;
    const reboundTurn: CodexTurnSummary = {
      ...sourceTurn,
      threadId: input.threadId,
      turnId: input.targetTurnId,
      status: input.status,
      turnStartedAtMs: input.turnStartedAtMs,
    };
    detail.turns = detail.turns.map((turn, index) =>
      index === input.turnIndex ? reboundTurn : turn,
    );
    detail.transcript = detail.transcript.map((entry) =>
      entry.turnId === sourceTurnId ? { ...entry, turnId: input.targetTurnId } : entry,
    );

    const sourceItems = record.itemsByTurn.get(sourceTurnId as string);
    if (sourceItems) {
      const reboundItems = new Map<string, CodexItemView>();
      for (const item of sourceItems.values()) {
        const reboundItem = { ...item, turnId: input.targetTurnId };
        reboundItems.set(resolveCodexItemPrimaryIdentityKey(reboundItem), reboundItem);
      }
      record.itemsByTurn.delete(sourceTurnId as string);
      record.itemsByTurn.set(input.targetTurnId, reboundItems);
    }

    return reboundTurn;
  }

  private upsertCanonicalTurnItem(
    threadId: string,
    turnId: string,
    itemId: string,
    fallbackStatus: CodexTurnStatus = "inProgress",
  ): CodexTurnSummary {
    return this.upsertCanonicalTurnItems(threadId, turnId, [itemId], fallbackStatus);
  }

  private upsertCanonicalTurnItems(
    threadId: string,
    turnId: string,
    itemIds: readonly string[],
    fallbackStatus: CodexTurnStatus = "inProgress",
  ): CodexTurnSummary {
    const existing = this.getKnownTurn(threadId, turnId);
    const nextItemIds = upsertOrderedStringIds([], itemIds);
    if (!existing) {
      const synthesizedTurn: CodexTurnSummary = {
        threadId,
        turnId,
        status: fallbackStatus,
        itemIds: nextItemIds,
      };
      this.mergeTurn(threadId, synthesizedTurn);
      return this.getKnownTurn(threadId, turnId) ?? synthesizedTurn;
    }

    const mergedItemIds = upsertOrderedStringIds(existing.itemIds, nextItemIds);
    if (mergedItemIds.length === existing.itemIds.length) {
      return existing;
    }

    return this.replaceCanonicalTurnItemIds(threadId, turnId, mergedItemIds) ?? existing;
  }

  private replaceCanonicalTurnItemIds(
    threadId: string,
    turnId: string,
    itemIds: readonly string[],
  ): CodexTurnSummary | null {
    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return null;
    const existing = detail.turns.find((turn) => turn.turnId === turnId);
    if (!existing) return null;

    const nextTurn: CodexTurnSummary = {
      ...existing,
      itemIds: [...itemIds],
    };
    detail.turns = detail.turns.map((turn) => (turn.turnId === turnId ? nextTurn : turn));
    return nextTurn;
  }

  private removeCanonicalTurnItems(
    threadId: string,
    turnId: string,
    itemIds: readonly string[],
  ): CodexTurnSummary | null {
    const existing = this.getKnownTurn(threadId, turnId);
    if (!existing) return null;

    const nextItemIds = removeOrderedStringIds(existing.itemIds, itemIds);
    if (nextItemIds.length === existing.itemIds.length) return existing;

    return this.replaceCanonicalTurnItemIds(threadId, turnId, nextItemIds) ?? existing;
  }

  private buildTransportOnlyServerRequestRawState(
    threadId: string,
    record: CodexConversationRecord,
  ): CodexServerRequestRawState {
    return {
      threadId,
      turns: [],
      requests: [...this.readConversationServerRequests(record)],
      hasUnreadTurn: this.conversationHasUnreadTurn(threadId),
    };
  }

  private applyTransportOnlyServerRequestRawLifecycleResult(
    threadId: string,
    result: CodexServerRequestRawLifecycleResult,
  ): void {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record || !result.stateChanged) return;

    const committed = this.conversationAggregate(threadId).commitServerRequestLifecycle({
      kind: "raw",
      lifecycle: result,
      observedAtMs: Date.now(),
      projectReplica: !this.rendererConversations.hasOwner(threadId),
    });
    if (committed.unreadChanged) {
      this.applicationEvents.publish({
        kind: "conversationReadStateCommitted",
        value: { threadId, hasUnreadTurn: committed.hasUnreadTurn },
      });
    }
  }

  private applyServerRequestCanonicalLifecycleResult(
    threadId: string,
    before: CodexCanonicalConversationState,
    result: CodexServerRequestLifecycleResult,
  ): void {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record || !result.stateChanged) return;

    const observedAtMs = Date.now();
    const committed = this.conversationAggregate(threadId).commitServerRequestLifecycle({
      kind: "canonical",
      before,
      lifecycle: result,
      observedAtMs,
      projectReplica: !this.rendererConversations.hasOwner(threadId),
    });
    if (committed.unreadChanged) {
      this.applicationEvents.publish({
        kind: "conversationReadStateCommitted",
        value: { threadId, hasUnreadTurn: committed.hasUnreadTurn },
      });
    }
    if (!record.detail) return;

    for (const mutation of result.turnMutations) {
      const afterTurn = result.state.turns[mutation.turnIndex];
      if (!afterTurn) continue;
      this.applyCanonicalLifecycleTurnProjection({
        threadId,
        turnIndex: mutation.turnIndex,
        beforeTurn: before.turns[mutation.turnIndex] ?? null,
        afterTurn,
        observedAtMs,
        preserveExistingUpdatedAt: true,
      });
    }
  }

  private consumeServerRequestLifecycleEffects(
    lifecycle: CodexServerRequestRawLifecycleResult | CodexServerRequestLifecycleResult,
  ): void {
    for (const effect of lifecycle.effects) {
      if (effect.type !== "refreshFileApprovalContext") continue;
      void this.requestConversationResume(effect.threadId, {
        syncDormantConversationSnapshots: false,
      }).catch((error) => {
        this.setConversationResumeState(effect.threadId, "needs_resume");
        this.logger.warn("Failed to resume subagent for file approval", {
          threadId: effect.threadId,
          error,
        });
      });
    }
  }

  private reduceIncomingServerRequest(
    threadId: string,
    request: CodexCanonicalServerRequest,
  ): CodexServerRequestRawLifecycleResult | CodexServerRequestLifecycleResult {
    if (threadId.length === 0 || this.isCommandOnlyAutomationThread(threadId)) {
      return this.reduceTransportOnlyIncomingServerRequest(threadId, request);
    }

    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) {
      const transportOnly = reduceCodexServerRequestRawState(
        {
          threadId,
          turns: [],
          requests: [],
          hasUnreadTurn: false,
        },
        request,
        {
          now: () => Date.now(),
          isOpenAIFormElicitationsEnabled: this.isOpenAIFormElicitationsEnabled(),
        },
      );
      if (!transportOnly.stateChanged) return transportOnly;
      this.logger.warn("Dropping server request without canonical conversation state", {
        threadId,
        requestId: request.id,
        method: request.method,
      });
      return {
        state: {
          threadId,
          turns: [],
          requests: [],
          hasUnreadTurn: false,
        },
        effects: [],
        disposition: "ignored",
        stateChanged: false,
        turnMutations: [],
        selectedRequests: [],
        selectedRequestIds: [],
      };
    }

    const result = reduceCodexConversationServerRequest(before, request, {
      now: () => Date.now(),
      isOpenAIFormElicitationsEnabled: this.isOpenAIFormElicitationsEnabled(),
    });
    if (result.stateChanged && this.isConversationArchived(threadId)) {
      this.logger.warn("Ignored Codex server request for archived conversation", {
        threadId,
        requestId: request.id,
        method: request.method,
      });
      return {
        ...result,
        state: before,
        disposition: "ignored",
        stateChanged: false,
        effects: [],
        turnMutations: [],
      };
    }
    this.applyServerRequestCanonicalLifecycleResult(threadId, before, result);
    this.consumeServerRequestLifecycleEffects(result);
    return result;
  }

  private reduceTransportOnlyIncomingServerRequest(
    threadId: string,
    request: CodexCanonicalServerRequest,
  ): CodexServerRequestRawLifecycleResult {
    const existingRecord = this.getMaybeConversationRecord(threadId);
    const record = existingRecord ?? this.createConversationRecord(threadId);
    const state = this.buildTransportOnlyServerRequestRawState(threadId, record);
    const result = reduceCodexServerRequestRawState(state, request, {
      now: () => Date.now(),
      isOpenAIFormElicitationsEnabled: this.isOpenAIFormElicitationsEnabled(),
    });
    if (result.stateChanged && this.isConversationArchived(threadId)) {
      this.logger.warn("Ignored Codex server request for archived conversation", {
        threadId,
        requestId: request.id,
        method: request.method,
      });
      return {
        ...result,
        state,
        disposition: "ignored",
        stateChanged: false,
        effects: [],
        turnMutations: [],
      };
    }
    if (!existingRecord && result.stateChanged) {
      this.conversationRecords.set(threadId, record);
    }
    this.applyTransportOnlyServerRequestRawLifecycleResult(threadId, result);
    this.consumeServerRequestLifecycleEffects(result);
    return result;
  }

  private applyFileChangePatchUpdate(
    update: CodexFileChangePatchUpdate,
    suppressConversationSync: boolean,
  ): void {
    const record = this.getMaybeConversationRecord(update.conversationId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before || before.turns.length === 0) return;

    const result = reduceCodexConversationFileChangePatch(before, update, {
      now: () => Date.now(),
    });
    this.acceptCanonicalConversationState(update.conversationId, result.state);
    if (result.disposition !== "applied") {
      this.logger.warn("Dropping fileChange/patchUpdated for missing turn", {
        threadId: update.conversationId,
        turnId: update.turnId,
        itemId: update.itemId,
      });
      return;
    }
    if (!result.stateChanged || !record.detail) return;
    const beforeTurn = before.turns[result.turnIndex] ?? null;
    const afterTurn = result.state.turns[result.turnIndex];
    if (!afterTurn) return;
    const sourceTurnId = beforeTurn?.protocol.id ?? null;
    const targetTurnId = this.applyCanonicalLifecycleTurnProjection({
      threadId: update.conversationId,
      turnIndex: result.turnIndex,
      beforeTurn,
      afterTurn,
      observedAtMs: Date.now(),
      preserveExistingUpdatedAt: true,
    });
    if (!targetTurnId) return;
    const didRebind = sourceTurnId !== targetTurnId;

    if (suppressConversationSync) {
      this.syncAcceptedConversationDocumentSilently(update.conversationId);
      return;
    }
    if (didRebind) {
      this.syncDormantConversationFromRecord(update.conversationId, "owner-unavailable");
      return;
    }
    this.syncAcceptedConversationTurnState(update.conversationId, targetTurnId, {
      syncBackgroundTerminalRows: true,
      syncCapabilityFlags: true,
    });
  }

  private applyMcpToolCallProgressUpdate(
    update: CodexMcpToolCallProgressUpdate,
    suppressConversationSync: boolean,
  ): void {
    const record = this.getMaybeConversationRecord(update.conversationId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before || before.turns.length === 0) return;

    const result = reduceCodexConversationMcpToolCallProgress(before, update, {
      now: () => Date.now(),
    });
    this.acceptCanonicalConversationState(update.conversationId, result.state);
    if (result.disposition !== "applied") return;
    if (result.matchedItemIndex >= 0) {
      this.logger.debug("Ignoring mcpToolCall progress message", {
        itemId: update.itemId,
        message: update.message,
      });
    } else {
      this.logger.error("Item not found in turn state", {
        itemId: update.itemId,
        expectedType: "mcpToolCall",
      });
    }
    if (!result.stateChanged || !record.detail) return;
    const afterTurn = result.state.turns[result.turnIndex];
    if (!afterTurn) return;
    this.applyCanonicalLifecycleTurnProjection({
      threadId: update.conversationId,
      turnIndex: result.turnIndex,
      beforeTurn: before.turns[result.turnIndex] ?? null,
      afterTurn,
      observedAtMs: Date.now(),
      preserveExistingUpdatedAt: true,
    });
    if (suppressConversationSync) {
      this.syncAcceptedConversationDocumentSilently(update.conversationId);
      return;
    }
    this.syncDormantConversationFromRecord(update.conversationId, "owner-unavailable");
  }

  private applyThreadGoalUpdated(threadId: string, goal: ThreadGoal): void {
    const record = this.ensureConversationRecord(threadId);
    record.threadGoal = goal;
    if (goal.status === "complete") {
      record.completedThreadGoal = goal;
    } else {
      record.completedThreadGoal = null;
    }
    if (!shouldShowThreadGoalResumeConfirmation(goal.status)) {
      record.threadGoalResumeConfirmation = null;
    }
  }

  private appendThreadGoalTranscriptTurn(threadId: string, goal: ThreadGoal): void {
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record?.detail || !before) return;
    const after = appendCodexCanonicalThreadGoalTranscriptTurn(before, goal);
    this.commitCanonicalLocalTurnMutation({
      threadId,
      before,
      after,
      observedAtMs: goal.updatedAt * 1_000,
    });
  }

  private shouldClearNewCompletedThreadGoal(threadId: string, goal: ThreadGoal): boolean {
    if (goal.status !== "complete") return false;
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return false;
    return record.completedThreadGoal?.updatedAt !== goal.updatedAt;
  }

  private scheduleCompletedThreadGoalClear(threadId: string): void {
    void this.threadGoals.clear(threadId).catch((error) => {
      this.logger.error("Failed to clear completed thread goal", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private applyThreadGoalHydratedAfterResume(threadId: string, goal: ThreadGoal | null): void {
    const record = this.ensureConversationRecord(threadId);
    record.threadGoal = goal;
    record.completedThreadGoal = goal?.status === "complete" ? goal : null;
    record.threadGoalResumeConfirmation = null;
  }

  private async hydrateThreadGoalAfterResume(
    threadId: string,
    expectedRevision: number,
  ): Promise<void> {
    await this.postResumeGoals.hydrate(threadId, expectedRevision);
  }

  /** Effect Module adapter operation; atomically preserves the conversation revision fence. */
  commitThreadGoalHydratedAfterResume(
    threadId: string,
    expectedRevision: number,
    goal: ThreadGoal | null,
  ): boolean {
    if ((this.readConversationAggregate(threadId)?.revision ?? 0) !== expectedRevision)
      return false;
    this.applyThreadGoalHydratedAfterResume(threadId, goal);
    this.publishPostResumeGoalSnapshot(threadId);
    return true;
  }

  requestActiveGoalContinuationAfterResume(threadId: string): void {
    this.maybeContinueActiveThreadGoal(threadId);
  }

  private startPostResumeGoalFlow(threadId: string, expectedRevision: number): void {
    this.postResumeGoals.request(threadId, expectedRevision);
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

  private buildMcpServerElicitationItemId(requestId: RequestId): string {
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
    this.reduceIncomingServerRequest(
      threadId,
      createCodexCanonicalPlanImplementationRequest(
        threadId,
        turnId,
        planContent,
        request.requestId,
      ),
    );
    return request;
  }

  private removePlanImplementationRequestFromRecord(threadId: string, turnId: string): void {
    const record = this.ensureConversationRecord(threadId);
    record.planImplementationRequestsByTurnId.delete(turnId);
    const canonical = this.readCanonicalConversationState(threadId);
    if (!canonical) return;
    this.acceptCanonicalConversationState(
      threadId,
      completeCodexCanonicalPlanImplementationRequest(canonical, turnId),
    );
  }

  private buildTurnDiffItemView(input: {
    threadId: string;
    turnId: string;
    diff: string;
    status?: CodexTurnStatus;
    patchBatches?: CodexTurnDiffPatchBatch[];
  }): CodexItemView {
    const existing = this.getRecordedItem(
      input.threadId,
      input.turnId,
      this.buildTurnDiffItemId(input.turnId),
    );
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

  private buildPatchBatchesFromItems(
    items: CodexItemView[],
    fallbackCwd: string | null,
  ): CodexTurnDiffPatchBatch[] {
    const batches: CodexTurnDiffPatchBatch[] = [];
    let cwd = fallbackCwd;
    for (const item of items) {
      if (
        item.normalizedKind === "commandExecution" &&
        item.cwd !== null &&
        item.cwd !== undefined
      ) {
        cwd = item.cwd;
        continue;
      }
      if (item.normalizedKind !== "fileChange" || item.semanticKind !== "patch") continue;
      if (resolveCodexPatchSuccess(item.status) === false) continue;
      const changes = getCodexFileChangeList(item.fileChange?.changes);
      if (changes.length === 0) continue;
      batches.push({
        cwd,
        changes,
      });
    }
    return batches;
  }

  private resolveProjectedTurnDiff(
    diff: string | undefined,
    patchBatches: readonly CodexTurnDiffPatchBatch[],
  ): string | undefined {
    if (typeof diff === "string" && diff.length > 0) {
      const withoutVisualizationBlocks = stripCodexVisualizationDiffBlocks(diff);
      return withoutVisualizationBlocks.length > 0 ? withoutVisualizationBlocks : undefined;
    }

    const fallbackDiff = buildCodexTurnDiffFromPatchBatches(patchBatches);
    return fallbackDiff.length > 0 ? fallbackDiff : undefined;
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
    return turnItemIds
      .map((itemId) => byItemId.get(itemId))
      .filter((item): item is CodexItemView => Boolean(item));
  }

  private buildLiveTurnErrorItemView(input: {
    threadId: string;
    turnId: string;
    message: string | null | undefined;
    additionalDetails?: string | null;
    willRetry: boolean;
  }): CodexItemView {
    const existing = this.getRecordedItem(
      input.threadId,
      input.turnId,
      this.buildTurnErrorItemId(input.turnId),
    );
    const now = Date.now();
    return buildTurnErrorItemView({
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
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

  private removeTranscriptEntry(threadId: string, entryId: string): void {
    const nextTranscript = this.getThreadTranscript(threadId).filter(
      (entry) => (entry.entryId ?? entry.itemId) !== entryId,
    );
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
    const fallbackCwd = this.getMaybeConversationRecord(threadId)?.detail?.cwd ?? null;
    const patchBatches = this.buildPatchBatchesFromItems(
      this.listKnownTurnItems(threadId, turnId),
      fallbackCwd,
    );
    const projectedDiff = this.resolveProjectedTurnDiff(diff, patchBatches);
    const hasPatchBatchChanges = patchBatches.some((batch) => batch.changes.length > 0);

    if (!projectedDiff && !hasPatchBatchChanges) {
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

    const item = this.buildTurnDiffItemView({
      threadId,
      turnId,
      diff: projectedDiff ?? "",
      status,
      patchBatches,
    });
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
      status: input.willRetry ? ("inProgress" as const) : ("failed" as const),
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
    return (
      this.getThreadTranscript(input.threadId).find(
        (entry) => (entry.entryId ?? entry.itemId) === item.itemId,
      ) ??
      projectItemToLiveTranscriptEntry(
        item,
        source,
        this.getThreadTranscript(input.threadId),
        this.getKnownTurn(input.threadId, input.turnId)?.itemIds,
      )
    );
  }

  private getKnownTurn(threadId: string, turnId: string): CodexTurnSummary | null {
    return (
      this.getMaybeConversationRecord(threadId)?.detail?.turns.find(
        (turn) => turn.turnId === turnId,
      ) ?? null
    );
  }

  private isAssistantTextItem(
    item:
      | Pick<CodexItemView, "normalizedKind" | "semanticKind" | "role" | "markdownText">
      | Pick<CodexTranscriptEntry, "kind" | "semanticKind" | "role" | "markdownText">,
  ): boolean {
    const kind = "normalizedKind" in item ? item.normalizedKind : item.kind;
    return (
      kind === "assistantMessage" ||
      item.semanticKind === "assistantMessage" ||
      item.role === "assistant"
    );
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

  private async applyThreadStatusLocal(
    threadId: string,
    statusType: CodexThreadStatusType,
    statusActiveFlags: readonly CodexThreadActiveFlag[],
  ): Promise<void> {
    const updated = await this.updateWorkspaceThreadSummary(threadId, {
      status: {
        statusType,
        activeFlags: statusActiveFlags,
      },
      updatedAt: Date.now(),
    });
    if (updated) this.emitEvent({ type: "threadSummary", thread: updated });
    this.emitEvent({
      type: "threadStatus",
      threadId,
      statusType,
      statusActiveFlags: [...statusActiveFlags],
    });
  }

  private async markThreadAsActive(threadId: string): Promise<void> {
    await this.applyThreadStatusLocal(threadId, "active", []);
  }

  private buildCanonicalSteeringUserMessageItem(input: {
    turnId: string;
    steerId: string;
    clientUserMessageId: string;
    inputItems: CodexSteeringUserInput[];
    attachments: readonly CodexLiveFileAttachment[];
    commentAttachments: readonly CodexReviewDiffCommentAttachment[];
    restoreMessage: CodexSteeringRestoreMessage;
    targetTurnStartedAtMs?: number | null;
  }): CodexCanonicalSteeringUserMessageItem {
    return {
      type: "steeringUserMessage",
      id: input.steerId,
      targetTurnId: input.turnId,
      targetTurnStartedAtMs: input.targetTurnStartedAtMs ?? null,
      status: "pending",
      clientUserMessageId: input.clientUserMessageId,
      input: input.inputItems,
      attachments: [...input.attachments],
      restoreMessage: {
        ...input.restoreMessage,
        context: {
          commentAttachments: [...input.commentAttachments],
        },
      },
      compareKey: buildCodexSteeringCompareKey(input.inputItems, input.commentAttachments),
    };
  }

  private removeSteeringUserMessage(threadId: string, steerId: string): void {
    const entry = this.getThreadTranscript(threadId).find(
      (candidate) => (candidate.entryId ?? candidate.itemId) === steerId,
    );
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!entry || entry.turnId === null || !record || !before) return;

    const after = removeCodexCanonicalSteeringItem(before, entry.turnId, steerId);
    this.applyCanonicalTurnMutation({
      threadId,
      turnId: entry.turnId,
      before,
      after,
    });
  }

  private listPendingSteeringEntries(threadId: string, turnId?: string): CodexTranscriptEntry[] {
    return this.getThreadTranscript(threadId).filter(
      (entry) =>
        entry.type === "steeringUserMessage" &&
        entry.steeringStatus === "pending" &&
        (!turnId || entry.turnId === turnId),
    );
  }

  private async restoreUnacceptedSteeringEntriesForTurn(
    threadId: string,
    turnId: string,
    reason: string,
  ): Promise<void> {
    const pendingEntries = this.listPendingSteeringEntries(threadId, turnId);
    if (pendingEntries.length === 0) return;

    for (const entry of pendingEntries) {
      const restoreMessage = entry.steeringRestoreMessage;
      this.removeSteeringUserMessage(threadId, entry.entryId ?? entry.itemId);
      if (!restoreMessage?.prompt.trim()) continue;
      await this.controlPlane.runPromise(
        this.queuedFollowUps.enqueue({
          threadId,
          prompt: restoreMessage.prompt,
          collaborationMode: restoreMessage.collaborationMode,
          serviceTier: restoreMessage.serviceTier,
          pausedReason: reason,
          promptInput: restoreMessage.promptInput,
          summary: restoreMessage.summary,
        }),
      );
    }
  }

  private async syncThreadStatusFromKnownTurns(threadId: string): Promise<void> {
    const hasInProgressTurn = this.listKnownTurns(threadId).some(
      (turn) => turn.status === "inProgress",
    );
    const statusType: CodexThreadStatusType = hasInProgressTurn ? "active" : "idle";
    await this.applyThreadStatusLocal(threadId, statusType, []);
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
      this.setThreadTranscript(
        threadId,
        finalizeTurnTranscriptState(this.getThreadTranscript(threadId), turnId, turnStatus),
      );
      return [];
    }

    const now = Date.now();
    const updatedItems: CodexItemView[] = [];

    for (const [itemKey, item] of byItem.entries()) {
      const mcpToolCall = item.mcpToolCall
        ? completeCodexMcpToolCallForTurn(item.mcpToolCall, turnStatus)
        : undefined;
      const shouldTerminalize = shouldTerminalizeItemWithTurn(item, turnStatus);
      const didCompleteMcp = mcpToolCall !== item.mcpToolCall;
      if (!shouldTerminalize && !didCompleteMcp) continue;

      const nextItem: CodexItemView = {
        ...item,
        ...(didCompleteMcp ? { mcpToolCall } : {}),
        ...(shouldTerminalize ? { status: terminalStatus } : {}),
        updatedAt: Math.max(item.updatedAt, now),
      };
      byItem.set(itemKey, nextItem);
      updatedItems.push(nextItem);
    }

    if (updatedItems.length === 0) {
      this.setThreadTranscript(
        threadId,
        finalizeTurnTranscriptState(this.getThreadTranscript(threadId), turnId, turnStatus),
      );
      return [];
    }
    record.itemsByTurn.set(turnId, byItem);
    const nextTranscript = finalizeTurnTranscriptState(
      this.getThreadTranscript(threadId),
      turnId,
      turnStatus,
    );
    this.setThreadTranscript(threadId, nextTranscript);
    return nextTranscript.filter(
      (entry) =>
        entry.turnId === turnId && updatedItems.some((item) => item.itemId === entry.itemId),
    );
  }

  private reconcileDetailTranscriptToTerminalTurnStatus(
    detail: CodexThreadDetail,
  ): CodexThreadDetail {
    if (detail.transcript.length === 0 || detail.turns.length === 0) return detail;

    let transcript = detail.transcript;
    for (const turn of detail.turns) {
      if (turn.turnId === null) continue;
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

  private async persistThreadDetailSummary(detail: CodexThreadDetail): Promise<void> {
    await this.updateWorkspaceThreadSummary(detail.threadId, {
      projectId: detail.projectId,
      parentThreadId: detail.source?.parentThreadId ?? null,
      threadSource: detail.threadSource ?? null,
      serviceName: detail.serviceName ?? null,
      agentNickname: detail.agentNickname ?? null,
      agentRole: detail.agentRole ?? null,
      agentPath: detail.agentPath ?? null,
      threadName: detail.threadName,
      threadPreview: detail.threadPreview,
      modelProvider: detail.modelProvider,
      executionProfile: detail.executionProfile,
      cwd: detail.cwd,
      managedWorktreePath: detail.managedWorktreePath ?? null,
      projectlessOutputDirectory: detail.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: detail.projectlessWorkspaceBrowserRoot ?? null,
      status: {
        statusType: detail.statusType,
        activeFlags: detail.statusActiveFlags,
      },
      archived: detail.archived,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      linkedAt: detail.linkedAt,
    });
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

    const persistedLink = this.getThreadLinkSafely(threadId);
    const historyHome = this.runtimeStateHome;
    const sessionMetadata = persistedLink
      ? null
      : this.sessionStore.readThreadMetadata(threadId, historyHome);
    const link: CodexThreadSummary = persistedLink ?? {
      threadId,
      projectId: null,
      source: sessionMetadata?.parentThreadId
        ? { parentThreadId: sessionMetadata.parentThreadId }
        : null,
      threadName: null,
      threadPreview: "",
      modelProvider: "",
      executionProfile: null,
      cwd: sessionMetadata?.cwd ?? null,
      statusType: "notLoaded",
      statusActiveFlags: [],
      archived: false,
      createdAt: 0,
      updatedAt: 0,
      linkedAt: new Date(0).toISOString(),
    };

    const sessionDetail = this.sessionStore.readThreadDetail({
      threadId,
      link,
      codexHome: historyHome,
    });
    if (!sessionDetail) return null;

    const reconciledDetail = this.reconcileDetailTranscriptToTerminalTurnStatus(sessionDetail);
    this.setConversationRecordDetail(reconciledDetail);
    this.ensureConversationRecord(threadId);
    if (
      this.readConversationStreamRole(threadId) === null &&
      !this.conversationAggregate(threadId).isStreaming()
    ) {
      this.setConversationResumeState(threadId, "needs_resume");
    }
    return reconciledDetail;
  }

  private mergeItem(
    item: CodexItemView,
    source: CodexTranscriptEntrySource = "live",
    options: { authoritativeLifecycleItem?: boolean } = {},
  ): CodexTranscriptEntry {
    if (item.turnId === null) {
      throw new Error("Nullable local turns must use canonical whole-turn projection");
    }
    this.ensureConversationDetail(item.threadId);
    const record = this.ensureConversationRecord(item.threadId);
    const byItem = record.itemsByTurn.get(item.turnId) ?? new Map<string, CodexItemView>();
    const primaryKey = resolveCodexItemPrimaryIdentityKey(item);

    let existingKey: string | null = null;
    let existing: CodexItemView | undefined = byItem.get(primaryKey);
    if (!existing && !options.authoritativeLifecycleItem) {
      for (const [candidateKey, candidate] of byItem.entries()) {
        if (!canMergeSyntheticTextDuplicate(candidate, item)) continue;
        existing = candidate;
        existingKey = candidateKey;
        break;
      }
    } else {
      existingKey = primaryKey;
    }

    const mergeCandidate =
      existing &&
      !options.authoritativeLifecycleItem &&
      item.normalizedKind === "commandExecution" &&
      item.aggregatedOutput == null &&
      existing.aggregatedOutput != null
        ? {
            ...item,
            aggregatedOutput: existing.aggregatedOutput,
            toolCall: item.toolCall
              ? {
                  ...item.toolCall,
                  result: item.toolCall.result ?? existing.aggregatedOutput,
                }
              : item.toolCall,
            rawItem:
              item.rawItem && typeof item.rawItem === "object"
                ? {
                    ...(item.rawItem as Record<string, unknown>),
                    aggregatedOutput: existing.aggregatedOutput,
                  }
                : item.rawItem,
          }
        : item;

    const mergedItem =
      existing && !options.authoritativeLifecycleItem
        ? {
            ...mergeCodexItemView(existing, mergeCandidate),
            updatedAt: Date.now(),
          }
        : mergeCandidate;

    if (existingKey && existingKey !== primaryKey) {
      byItem.delete(existingKey);
    }
    byItem.set(primaryKey, mergedItem);
    record.itemsByTurn.set(item.turnId, byItem);

    const currentTranscript = this.getThreadTranscript(item.threadId);
    const nextEntry = projectItemToLiveTranscriptEntry(
      mergedItem,
      source,
      currentTranscript,
      this.getKnownTurn(item.threadId, item.turnId)?.itemIds,
    );
    const existingTranscriptIndex = currentTranscript.findIndex(
      (entry) =>
        entry.threadId === nextEntry.threadId &&
        entry.turnId === nextEntry.turnId &&
        (entry.entryId ?? entry.itemId) === (nextEntry.entryId ?? nextEntry.itemId),
    );
    const authoritativeTranscript = options.authoritativeLifecycleItem
      ? existingTranscriptIndex >= 0
        ? currentTranscript.map((entry, index) =>
            index === existingTranscriptIndex
              ? {
                  ...nextEntry,
                  sequence: entry.sequence ?? nextEntry.sequence,
                }
              : entry,
          )
        : [...currentTranscript, nextEntry]
      : null;
    const nextTranscript =
      authoritativeTranscript ??
      (nextEntry.kind === "userMessage"
        ? reconcileCommittedUserPrompt(currentTranscript, nextEntry)
        : applyLiveTranscriptMutation(currentTranscript, { type: "upsert", entry: nextEntry }));
    this.setThreadTranscript(item.threadId, nextTranscript);
    if (nextEntry.kind === "userMessage" && nextEntry.markdownText) {
      this.clearPendingSteerForConsumedPrompt(item.threadId, item.turnId, nextEntry.markdownText);
    }
    return nextEntry;
  }

  private buildCompleteTurnPagination(loadedTurnCount: number): CodexConversationTurnPagination {
    return {
      ...COMPLETE_TURN_PAGINATION,
      loadedTurnCount,
    };
  }

  private normalizeTurnPagination(
    pagination: CodexConversationTurnPagination,
    loadedTurnCount: number,
  ): CodexConversationTurnPagination {
    return {
      olderCursor: pagination.olderCursor,
      backwardsCursor: pagination.backwardsCursor,
      oldestLoadedTurnId: pagination.oldestLoadedTurnId,
      isLoadingOlder: pagination.isLoadingOlder,
      hasLoadedOldest: pagination.hasLoadedOldest,
      loadedTurnCount,
      itemsView: pagination.itemsView,
    };
  }

  private buildTurnPaginationFromPage(
    page: NonNullable<ThreadResumeResponse["initialTurnsPage"]> | ThreadTurnsListResponse,
    loadedTurnCount: number,
    oldestLoadedTurnId: string | null,
  ): CodexConversationTurnPagination {
    return {
      olderCursor: page.nextCursor,
      backwardsCursor: page.backwardsCursor,
      oldestLoadedTurnId,
      isLoadingOlder: false,
      hasLoadedOldest: page.nextCursor === null,
      loadedTurnCount,
      itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
    };
  }

  private setConversationRecordDetail(
    detail: CodexThreadDetail,
    options?: {
      preserveTurnPagination?: boolean;
      turnPagination?: CodexConversationTurnPagination | null;
    },
  ): void {
    const record = this.ensureConversationRecord(detail.threadId);
    const retainedTurnIds = new Set(
      detail.turns.flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
    );
    this.clearThreadPendingRequestsForRemovedTurns(detail.threadId, retainedTurnIds);
    this.pruneThreadTransientState(detail.threadId, retainedTurnIds);
    record.latestThreadSettings = detail.latestThreadSettings ?? record.latestThreadSettings;
    record.latestTokenUsageInfo = detail.latestTokenUsageInfo ?? record.latestTokenUsageInfo;
    record.latestCollaborationMode =
      record.latestThreadSettings?.collaborationMode ??
      detail.latestCollaborationMode ??
      record.latestCollaborationMode;
    const previousDetail = record.detail;
    const serviceName =
      detail.serviceName === undefined ? previousDetail?.serviceName : detail.serviceName;
    record.detail = {
      ...detail,
      ...(serviceName === undefined ? {} : { serviceName }),
      approvalPolicy: detail.approvalPolicy ?? previousDetail?.approvalPolicy ?? null,
      approvalsReviewer: detail.approvalsReviewer ?? previousDetail?.approvalsReviewer ?? null,
      sandbox: detail.sandbox ?? previousDetail?.sandbox ?? null,
      latestCollaborationMode: record.latestCollaborationMode,
      latestThreadSettings: record.latestThreadSettings,
      latestTokenUsageInfo: record.latestTokenUsageInfo,
      turns: [...detail.turns],
      transcript: [...detail.transcript],
    };
    this.conversationAggregate(detail.threadId).initializeHistory(
      options?.turnPagination
        ? this.normalizeTurnPagination(options.turnPagination, detail.turns.length)
        : options?.preserveTurnPagination
          ? this.normalizeTurnPagination(
              this.readConversationTurnPagination(detail.threadId),
              detail.turns.length,
            )
          : this.buildCompleteTurnPagination(detail.turns.length),
      detail.turns.length,
    );
    const itemsByTurn = new Map<string, Map<string, CodexItemView>>();
    for (const entry of record.detail.transcript) {
      const item = projectTranscriptEntryToItemView(entry);
      if (item.turnId === null) continue;
      const byItem = itemsByTurn.get(item.turnId) ?? new Map<string, CodexItemView>();
      byItem.set(resolveCodexItemPrimaryIdentityKey(item), item);
      itemsByTurn.set(item.turnId, byItem);
    }
    record.itemsByTurn = itemsByTurn;
    const snapshot = this.buildConversationBaseSnapshot(detail.threadId);
    if (snapshot) this.conversationAggregate(detail.threadId).installSnapshot(snapshot);
  }

  private hydrateThreadDetail(detail: CodexThreadDetail): void {
    this.setConversationRecordDetail(detail);
  }

  private buildThreadTimelineFromCanonicalState(
    state: CodexCanonicalConversationState,
  ): Pick<CodexThreadDetail, "turns" | "transcript"> {
    const threadId = state.protocol.id;
    const turnSummaries: CodexTurnSummary[] = [];
    const itemViews: CodexItemView[] = [];
    const fallbackCwd = this.getThreadLinkSafely(threadId)?.cwd ?? null;
    const fallbackObservedAtMs = Date.now();

    for (const [turnIndex, turn] of state.turns.entries()) {
      const turnId = turn.protocol.id;
      const observedAtMs = turn.sidecar.turnStartedAtMs ?? fallbackObservedAtMs;
      const projection = applyCodexLifecycleProjectionDiff({
        threadId,
        turnKey: buildCodexTurnOccurrenceKey(turnId, turnIndex),
        beforeTurn: null,
        afterTurn: turn,
        currentViews: [],
        currentTranscript: [],
        observedAtMs,
        isBackgroundSubagentsEnabled: true,
      });
      const turnSummary = this.buildCanonicalTurnSummary(
        threadId,
        turn,
        turnId === null ? projection.transcript.map((entry) => entry.itemId) : projection.itemIds,
      );
      turnSummaries.push(turnSummary);

      const projectedTurnViews = [...projection.views];
      const patchBatches = this.buildPatchBatchesFromItems(
        projectedTurnViews,
        turn.sidecar.params.cwd ?? fallbackCwd,
      );
      const projectedDiff = this.resolveProjectedTurnDiff(turnSummary.diff, patchBatches);
      if (projectedDiff && turnId !== null) {
        projectedTurnViews.push(
          this.buildTurnDiffItemView({
            threadId,
            turnId,
            diff: projectedDiff,
            status: turnSummary.status,
            patchBatches,
          }),
        );
      }
      const turnItemViews =
        turnId === null
          ? projectedTurnViews
          : projectCodexHistoryRequestViews({
              threadId,
              turnId,
              cwd: turn.sidecar.params.cwd ?? fallbackCwd,
              items: projectedTurnViews,
              requests: state.requests,
              observedAtMs,
            });
      itemViews.push(...turnItemViews);
    }

    return {
      turns: turnSummaries,
      transcript: buildTranscriptFromBootstrapEvents({
        items: itemViews,
        source: "bootstrap",
      }),
    };
  }

  private buildThreadDetailFromCanonicalState(
    state: CodexCanonicalConversationState,
  ): CodexThreadDetail | null {
    return this.buildThreadDetailFromProtocol(
      state.protocol,
      this.buildThreadTimelineFromCanonicalState(state),
    );
  }

  private buildThreadDetailFromProtocol(
    thread: CodexCanonicalConversationState["protocol"],
    timeline: Pick<CodexThreadDetail, "turns" | "transcript">,
  ): CodexThreadDetail | null {
    const threadId = thread.id;
    const link = this.getThreadLinkSafely(threadId);
    if (!link) return null;

    const existingRecord = this.getMaybeConversationRecord(threadId);
    const parsedStatus = parseThreadStatus(thread.status);
    return applyThreadAgentMetadata(
      {
        ...link,
        threadPreview: resolveThreadPreviewFromTranscript(timeline.transcript, link.threadPreview),
        approvalPolicy: existingRecord?.detail?.approvalPolicy ?? null,
        approvalsReviewer: existingRecord?.detail?.approvalsReviewer ?? null,
        sandbox: existingRecord?.detail?.sandbox ?? null,
        latestCollaborationMode:
          existingRecord?.latestCollaborationMode ?? buildDefaultCollaborationModeState(),
        statusType: parsedStatus.statusType,
        statusActiveFlags: parsedStatus.statusActiveFlags,
        threadRuntimeStatus: parsedStatus.threadRuntimeStatus,
        turns: timeline.turns,
        transcript: timeline.transcript,
      },
      thread,
    );
  }

  private hydrateCanonicalThreadRead(thread: Thread): CodexCanonicalConversationState {
    const record = this.ensureConversationRecord(thread.id);
    const previousState = this.readCanonicalConversationState(record.threadId);
    const runtimeWorkspaceRoots: readonly string[] = [];
    const permissions = createCodexCanonicalWorkspacePermissionContext(runtimeWorkspaceRoots);
    const cwd = thread.cwd || "/";
    const model = "";
    const reasoningEffort = null;
    const hydrated = createCodexCanonicalHydratedConversationState(thread, {
      model,
      reasoningEffort,
      cwd,
      approvalPolicy: permissions.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer,
      sandboxPolicy: permissions.sandboxPolicy,
      activePermissionProfile: permissions.activePermissionProfile,
      runtimeWorkspaceRoots: [...runtimeWorkspaceRoots],
      pendingRequests: this.readConversationServerRequests(record),
      hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
    });
    const hydrationContext = hydrated.sidecar.hydrationContext;
    if (!hydrationContext) {
      throw new Error(`Canonical history hydration context missing for '${thread.id}'`);
    }

    const state: CodexCanonicalConversationState = {
      ...hydrated,
      sidecar: {
        ...previousState?.sidecar,
        ...hydrated.sidecar,
        hydrationContext,
      },
    };
    return this.acceptCanonicalConversationState(record.threadId, state);
  }

  private buildThreadDetailFromRead(
    thread: Thread,
    options: { preserveExistingTimeline?: boolean } = {},
  ): CodexThreadDetail | null {
    if (!options.preserveExistingTimeline) {
      return this.buildThreadDetailFromCanonicalState(this.hydrateCanonicalThreadRead(thread));
    }

    const { turns: _turns, ...protocol } = thread;
    void _turns;
    const existingDetail = options.preserveExistingTimeline
      ? (this.getMaybeConversationRecord(thread.id)?.detail ?? null)
      : null;
    return this.buildThreadDetailFromProtocol(protocol, {
      turns: existingDetail?.turns ?? [],
      transcript: existingDetail?.transcript ?? [],
    });
  }

  private async upsertLinkFromThread(
    thread: unknown,
    fallbackRef?: ThreadRef,
    fallbackCwd?: string | null,
  ): Promise<CodexThreadSummary | null> {
    if (typeof thread !== "object" || thread === null) return null;
    const candidate = thread as Record<string, unknown>;
    if (typeof candidate.id !== "string") return null;

    const existingThread = await this.readWorkspaceThread(candidate.id);
    const existing = existingThread ? this.buildWorkspaceThreadSummary(existingThread) : null;
    const materialization = this.buildWorkspaceThreadMaterialization({
      candidate,
      existing,
      ref: fallbackRef ?? null,
      fallbackCwd,
    });
    const { parsedStatus, patch: upsertInput } = materialization;
    const persisted = this.rememberWorkspaceThread(
      await this.projectWorkspace.upsertThread(candidate.id, upsertInput),
    );
    const summary = this.buildWorkspaceThreadSummary(persisted);

    const summaryWithAgentMetadata = applyThreadAgentMetadata(
      {
        ...summary,
        threadRuntimeStatus: parsedStatus.threadRuntimeStatus,
      },
      candidate,
    );
    return summaryWithAgentMetadata;
  }

  private buildWorkspaceThreadMaterialization(input: {
    readonly candidate: Record<string, unknown>;
    readonly existing: CodexThreadSummary | null;
    readonly ref: ThreadRef | null;
    readonly fallbackCwd?: string | null;
  }): {
    readonly parsedStatus: ReturnType<typeof parseThreadStatus>;
    readonly patch: DesktopProjectWorkspaceThreadPatch;
    readonly projectId: string | null;
    readonly resolvedCwd: string | null;
    readonly managedWorktreePath: string | null;
    readonly projectlessOutputDirectory: string | null;
    readonly projectlessWorkspaceBrowserRoot: string | null;
  } {
    const { candidate, existing, ref, fallbackCwd } = input;
    const parsedStatus = parseThreadStatus(candidate.status);
    const candidateProjectlessOutputDirectory =
      readStringField(candidate, "projectlessOutputDirectory") ??
      readStringField(candidate, "projectless_output_directory");
    const candidateProjectlessWorkspaceBrowserRoot =
      readStringField(candidate, "projectlessWorkspaceBrowserRoot") ??
      readStringField(candidate, "projectless_workspace_browser_root") ??
      readStringField(candidate, "projectlessWorkspaceRoot") ??
      readStringField(candidate, "projectless_workspace_root");

    const managedWorktreePath =
      readStringField(candidate, "managedWorktreePath") ??
      readStringField(candidate, "managed_worktree_path") ??
      existing?.managedWorktreePath ??
      ref?.managedWorktreePath ??
      null;
    const durableManagedCwd =
      existing?.managedWorktreePath && existing.cwd
        ? existing.cwd
        : ref?.managedWorktreePath && ref.cwd
          ? ref.cwd
          : null;
    const subagentMetadata = extractCodexThreadSubagentMetadata(candidate);
    const parentThreadId = subagentMetadata.parentThreadId;
    // Core owns a managed Task's execution location. app-server observations may
    // use an equivalent platform spelling (for example /private/var vs /var),
    // but must never split cwd from the durable managed-worktree identity.
    const resolvedCwd =
      durableManagedCwd ??
      (typeof candidate.cwd === "string"
        ? candidate.cwd
        : (existing?.cwd ?? ref?.cwd ?? (fallbackCwd?.trim() || null)));
    const projectlessOutputDirectory =
      candidateProjectlessOutputDirectory ??
      existing?.projectlessOutputDirectory ??
      ref?.projectlessOutputDirectory ??
      null;
    const projectlessWorkspaceBrowserRoot =
      candidateProjectlessWorkspaceBrowserRoot ??
      existing?.projectlessWorkspaceBrowserRoot ??
      ref?.projectlessWorkspaceBrowserRoot ??
      null;
    const projectId = resolveCodexThreadMaterializationOwner({
      existingThreadFound: existing !== null,
      existingProjectId: existing?.projectId ?? null,
      explicitInitialOwnerProvided: ref !== null,
      explicitInitialProjectId: ref?.projectId ?? null,
      inferredInitialProjectId: null,
    });
    const timestamps = reconcileCodexThreadTimestamps({
      threadId: candidate.id as string,
      observedCreatedAt: candidate.createdAt,
      observedUpdatedAt: candidate.updatedAt,
      observedRecencyAt: candidate.recencyAt,
      existing,
    });
    const patch: DesktopProjectWorkspaceThreadPatch = {
      ...(!existing ? { projectId } : {}),
      ...(parentThreadId ? { parentThreadId } : {}),
      threadSource: parseThreadSourceValue(candidate.threadSource),
      ...(typeof candidate.name === "string" ? { threadName: candidate.name } : {}),
      threadPreview: typeof candidate.preview === "string" ? candidate.preview : "",
      modelProvider: typeof candidate.modelProvider === "string" ? candidate.modelProvider : "",
      ...(existing?.executionProfile ? { executionProfile: existing.executionProfile } : {}),
      ...(resolvedCwd === null ? {} : { cwd: resolvedCwd }),
      managedWorktreePath,
      projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot,
      status: {
        statusType: parsedStatus.statusType,
        activeFlags: parsedStatus.statusActiveFlags,
      },
      archived: existing?.archived ?? false,
      ...(!existing ? { createdAt: timestamps.createdAt } : {}),
      updatedAt: timestamps.updatedAt,
      recencyAt: timestamps.recencyAt,
      ...(subagentMetadata.hasAgentNickname
        ? { agentNickname: subagentMetadata.agentNickname }
        : {}),
      ...(subagentMetadata.hasAgentRole ? { agentRole: subagentMetadata.agentRole } : {}),
      ...(subagentMetadata.hasAgentPath ? { agentPath: subagentMetadata.agentPath } : {}),
      ...(Object.prototype.hasOwnProperty.call(candidate, "serviceName") &&
      (typeof candidate.serviceName === "string" || candidate.serviceName === null)
        ? { serviceName: candidate.serviceName }
        : {}),
    };
    return {
      parsedStatus,
      patch,
      projectId,
      resolvedCwd,
      managedWorktreePath,
      projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot,
    };
  }

  private async upsertBackgroundSubagentThreadFromAppServerThread(
    thread: Record<string, unknown>,
    parentThreadId: string,
    fallbackCwd: string | null,
  ): Promise<CodexThreadSummary | null> {
    const threadId = typeof thread.id === "string" ? thread.id.trim() : "";
    if (!threadId) return null;
    this.deletedThreadIds.delete(threadId);

    const parentThread = await this.readWorkspaceThread(parentThreadId);
    const parentSummary = parentThread ? this.buildWorkspaceThreadSummary(parentThread) : null;
    const fallbackRef: ThreadRef = {
      projectId: parentSummary?.projectId ?? null,
      cwd: parentSummary?.cwd ?? fallbackCwd,
      projectlessOutputDirectory: parentSummary?.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: parentSummary?.projectlessWorkspaceBrowserRoot ?? null,
    };
    const summary = await this.upsertLinkFromThread(
      thread,
      fallbackRef,
      fallbackCwd ?? parentSummary?.cwd ?? null,
    );
    if (!summary) return null;

    this.subagentCatalog.observe(summary.threadId);
    this.syncParentChildMembershipMetadata(parentThreadId);
    return summary;
  }

  private async upsertWorkspaceSessionLinkFromThread(
    thread: unknown,
    input: { sessionId: string; projectId: string | null },
    options: {
      executionHostId?: string;
      fallbackCwd?: string | null;
      managedWorktreePath?: string | null;
      runtimeWorkspaceRoots?: readonly string[];
      projectlessOutputDirectory?: string | null;
      projectlessWorkspaceBrowserRoot?: string | null;
    } = {},
  ): Promise<CodexThreadSummary | null> {
    if (typeof thread !== "object" || thread === null) return null;
    const candidate = thread as Record<string, unknown>;
    if (typeof candidate.id !== "string") return null;

    const fallbackCwd = options.fallbackCwd?.trim() || null;
    const existingThread = await this.readWorkspaceThread(candidate.id);
    const existing = existingThread ? this.buildWorkspaceThreadSummary(existingThread) : null;
    const materialization = this.buildWorkspaceThreadMaterialization({
      candidate,
      existing,
      ref: {
        projectId: input.projectId,
        cwd: fallbackCwd,
        managedWorktreePath: options.managedWorktreePath ?? null,
        projectlessOutputDirectory: options.projectlessOutputDirectory ?? null,
        projectlessWorkspaceBrowserRoot: options.projectlessWorkspaceBrowserRoot ?? null,
      },
      fallbackCwd,
    });
    const { patch, parsedStatus } = materialization;

    await this.projectWorkspace.upsertProjectSessionThreadLink({
      sessionId: input.sessionId,
      projectId: input.projectId,
      threadId: candidate.id,
      forkedFromId: existing?.forkedFromId ?? null,
      parentThreadId: patch.parentThreadId ?? existing?.source?.parentThreadId ?? null,
      threadSource: patch.threadSource ?? null,
      ...(Object.prototype.hasOwnProperty.call(patch, "serviceName")
        ? { serviceName: patch.serviceName ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "agentNickname")
        ? { agentNickname: patch.agentNickname ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "agentRole")
        ? { agentRole: patch.agentRole ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "agentPath")
        ? { agentPath: patch.agentPath ?? null }
        : {}),
      threadName: patch.threadName ?? existing?.threadName ?? null,
      threadPreview: patch.threadPreview ?? existing?.threadPreview ?? "",
      modelProvider: patch.modelProvider ?? existing?.modelProvider ?? "",
      executionProfile: patch.executionProfile ?? existing?.executionProfile ?? null,
      executionHostId:
        options.executionHostId ?? existingThread?.executionHostId ?? CODEX_APP_LOCAL_HOST_ID,
      ...(options.runtimeWorkspaceRoots === undefined
        ? {}
        : { runtimeWorkspaceRoots: [...options.runtimeWorkspaceRoots] }),
      cwd: materialization.resolvedCwd,
      managedWorktreePath: materialization.managedWorktreePath,
      projectlessOutputDirectory: materialization.projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot: materialization.projectlessWorkspaceBrowserRoot,
      statusType: parsedStatus.statusType,
      statusActiveFlags: parsedStatus.statusActiveFlags,
      archived: existing?.archived ?? false,
      ...(patch.createdAt === undefined ? {} : { createdAt: patch.createdAt }),
      updatedAt: patch.updatedAt,
      recencyAt: patch.recencyAt,
    });
    const persisted = await this.readWorkspaceThread(candidate.id);
    if (!persisted) {
      throw new Error("Unable to read attached project session thread");
    }

    const summary = applyThreadAgentMetadata(
      {
        ...this.buildWorkspaceThreadSummary(persisted),
        threadRuntimeStatus: parsedStatus.threadRuntimeStatus,
      },
      candidate,
    );
    return summary;
  }

  private async parseWorkspacePath(projectId: string): Promise<string> {
    return (await this.requirePrimaryWorkspaceRoot(projectId)).primaryWorkspaceRoot;
  }

  private emitThreadTitleUpdated(threadId: string, title: string): void {
    const normalizedThreadId = threadId.trim();
    const normalizedTitle = title.trim();
    if (!normalizedThreadId || !normalizedTitle) {
      return;
    }

    this.emitHostMessage({
      type: "threadTitleUpdated",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: normalizedThreadId,
      title: normalizedTitle,
    });
  }

  private async hasThreadTitle(threadId: string): Promise<boolean> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return false;
    return Boolean(
      this.getMaybeConversationRecord(normalizedThreadId)?.detail?.threadName?.trim() ||
      (await this.readWorkspaceThread(normalizedThreadId))?.threadName?.trim(),
    );
  }

  private scheduleGeneratedThreadName(input: {
    threadId: string;
    prompt: string;
    cwd: string | null;
  }): void {
    const titlePrompt = input.prompt.trim();
    if (!titlePrompt) return;

    void this.generateAndPersistThreadName(input.threadId, titlePrompt, input.cwd);
  }

  private async generateAndPersistThreadName(
    threadId: string,
    titlePrompt: string,
    cwd: string | null,
  ): Promise<void> {
    if (await this.hasThreadTitle(threadId)) return;

    let title: string | null = null;
    try {
      title = await this.generateThreadTitleForPrompt(
        titlePrompt,
        cwd,
        await this.resolveThreadServiceName(threadId),
      );
    } catch (error) {
      this.logger.warn("Failed to generate thread title", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const normalizedTitle =
      title?.trim() ||
      normalizeCodexManualThreadTitle(
        projectCodexMarkdownToPlainText(
          cleanCodexAutoTitlePrompt(titlePrompt, CODEX_THREAD_TITLE_PROMPT_MAX_CHARS),
        ),
      ) ||
      "";
    if (!normalizedTitle) return;
    if (await this.hasThreadTitle(threadId)) return;

    await this.threadTitlePersistence.set({
      threadId,
      name: normalizedTitle,
      normalization: "trim",
    });
  }

  private async generateThreadTitleForPrompt(
    firstPrompt: string,
    cwd: string | null,
    serviceName?: string,
  ): Promise<string | null> {
    return await this.structuredThreadTitle.generate({
      prompt: firstPrompt,
      cwd,
      ...(serviceName === undefined ? {} : { serviceName }),
    });
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

  private async readThreadWithTurnsFlag(
    threadId: string,
    includeTurns: boolean,
  ): Promise<CodexThreadDetail | null> {
    const materialization = await this.readThreadMaterializationWithTurnsFlag(
      threadId,
      includeTurns,
    );
    return materialization?.detail ?? null;
  }

  private async readThreadMaterializationWithTurnsFlag(
    threadId: string,
    includeTurns: boolean,
  ): Promise<CodexThreadReadMaterialization | null> {
    const thread = await this.fetchThreadWithTurnsFlag(threadId, includeTurns);
    if (!thread) return null;
    return this.materializeReadThread(thread, includeTurns);
  }

  private async materializeReadThread(
    thread: Thread,
    includeTurns: boolean,
  ): Promise<CodexThreadReadMaterialization | null> {
    const threadSummary = await this.upsertLinkFromThread(thread);
    if (threadSummary?.source?.parentThreadId) {
      this.syncParentChildMembershipMetadata(threadSummary.source.parentThreadId, {
        repairMissing: false,
      });
    }
    const liveDetail = this.buildThreadDetailFromRead(thread, {
      preserveExistingTimeline: !includeTurns,
    });
    if (!liveDetail) return null;

    const reconciledDetail = this.reconcileDetailTranscriptToTerminalTurnStatus(liveDetail);
    this.setConversationRecordDetail(reconciledDetail);
    await this.persistThreadDetailSummary(reconciledDetail);
    return {
      detail: reconciledDetail,
      thread,
    };
  }

  private async fetchThreadWithTurnsFlag(
    threadId: string,
    includeTurns: boolean,
  ): Promise<Thread | null> {
    const startedAt = getDevRuntimeMetricStart();
    const result = await this.client.request<"thread/read", ThreadReadResponse>("thread/read", {
      threadId,
      includeTurns,
    });
    if (result.thread.id !== threadId) {
      throw new Error(
        `Codex thread/read expected '${threadId}' but received '${result.thread.id}'`,
      );
    }
    logDevRuntimeMetric("codex.thread.read", {
      threadId,
      includeTurns,
      approxPayloadBytes: approximateJsonPayloadBytes(result),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return result.thread;
  }

  private async persistProjectlessWorkspaceForThread(
    threadId: string,
    workspace: CodexProjectlessWorkspace,
  ): Promise<ThreadRef | null> {
    const existing = this.getThreadLinkSafely(threadId);
    if (!existing || existing.projectId !== null) return this.parseThreadRef(threadId);

    const workspaceChanged =
      existing.cwd !== workspace.cwd ||
      existing.projectlessOutputDirectory !== workspace.outputDirectory ||
      existing.projectlessWorkspaceBrowserRoot !== workspace.workspaceRoot;
    if (!workspaceChanged) return this.parseThreadRef(threadId);

    const summary = await this.updateWorkspaceThreadSummary(threadId, {
      cwd: workspace.cwd,
      projectlessOutputDirectory: workspace.outputDirectory,
      projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
    });
    if (!summary) return this.parseThreadRef(threadId);
    const detail = this.getMaybeConversationRecord(threadId)?.detail ?? null;
    if (detail?.projectId === null) {
      this.setConversationRecordDetail(
        {
          ...detail,
          cwd: workspace.cwd,
          projectlessOutputDirectory: workspace.outputDirectory,
          projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
        },
        { preserveTurnPagination: true },
      );
    }

    this.emitEvent({ type: "threadSummary", thread: summary });
    return {
      projectId: null,
      cwd: summary.cwd,
      managedWorktreePath: summary.managedWorktreePath ?? null,
      projectlessOutputDirectory: summary.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: summary.projectlessWorkspaceBrowserRoot ?? null,
    };
  }

  private async repairPersistedProjectlessWorkspaceForResume(input: {
    browserRoot: string | null;
    cwd: string | null;
    outputDirectory: string | null;
    prompt: string;
    threadId: string;
    writableRoots: readonly string[];
  }): Promise<ThreadRef | null> {
    const existing = this.getThreadLinkSafely(input.threadId);
    if (!existing || existing.projectId !== null) return this.parseThreadRef(input.threadId);

    const homeDirectory = this.projectlessHomeDirectory();
    let workspace: CodexProjectlessWorkspace | null = null;
    if (existing.cwd) {
      try {
        workspace = await migrateLegacyCodexProjectlessWorkspace({
          browserRoot: input.browserRoot,
          cwd: existing.cwd,
          homeDirectory,
          outputDirectory: input.outputDirectory,
        });
      } catch (error) {
        this.logger.warn("Failed to migrate legacy projectless workspace", {
          threadId: input.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    workspace ??= await repairCodexProjectlessWorkspace({
      browserRoot: input.browserRoot,
      cwd: input.cwd,
      homeDirectory,
      outputDirectory: input.outputDirectory,
      prompt: input.prompt,
      writableRoots: input.writableRoots,
    });
    if (!workspace) return this.parseThreadRef(input.threadId);
    return await this.persistProjectlessWorkspaceForThread(input.threadId, workspace);
  }

  private async resumeConversationRecord(
    threadId: string,
    seed?: CodexConversationResumeSeed,
    force = false,
  ): Promise<CodexThreadDetail | null> {
    await this.ensureClientReady();
    const persistedWorkspaceThread = await this.readWorkspaceThread(threadId);
    this.logger.info("Resuming Codex thread", { threadId });
    const record = this.ensureConversationRecord(threadId);
    if (
      !force &&
      this.readConversationStreamRole(threadId) !== null &&
      (this.resolveConversationResumeState(threadId) !== "needs_resume" ||
        this.conversationAggregate(threadId).isStreaming())
    ) {
      return this.serializeThreadDetail(threadId);
    }
    const pendingRequestsBeforeResume = [...this.readConversationServerRequests(record)];
    let threadRef: ThreadRef | null = persistedWorkspaceThread
      ? {
          projectId: persistedWorkspaceThread.projectId,
          cwd: persistedWorkspaceThread.cwd,
          executionProfile: persistedWorkspaceThread.executionProfile,
          managedWorktreePath: persistedWorkspaceThread.managedWorktreePath,
          projectlessOutputDirectory: persistedWorkspaceThread.projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot: persistedWorkspaceThread.projectlessWorkspaceBrowserRoot,
        }
      : this.parseThreadRef(threadId);
    const hasDurableManagedLocation = Boolean(threadRef?.managedWorktreePath && threadRef.cwd);
    const projectRuntimeContext = threadRef?.projectId
      ? await this.maybeResolveProjectRuntimeContext(threadRef.projectId)
      : null;
    const previousHydrationContext =
      this.readCanonicalConversationState(record.threadId)?.sidecar.hydrationContext ?? null;
    const projectless = threadRef?.projectId === null;
    const latestParams =
      this.readCanonicalConversationState(record.threadId)?.turns.at(-1)?.sidecar.params ?? null;
    const projectlessSandbox =
      previousHydrationContext?.latestThreadSettings?.sandboxPolicy ??
      latestParams?.sandboxPolicy ??
      null;
    const projectlessWritableRoots =
      projectlessSandbox?.type === "workspaceWrite"
        ? projectlessSandbox.writableRoots.filter((root) => root !== "~")
        : [];
    const projectlessWritableRoot =
      projectlessSandbox?.type === "workspaceWrite"
        ? (projectlessSandbox.writableRoots.find((root) => root !== "~") ?? null)
        : null;
    const projectlessFallbackCwd =
      projectlessWritableRoot ??
      seed?.workspaceRoots[0] ??
      projectRuntimeContext?.workspaceRoots[0] ??
      null;
    let previousConversationCwd = hasDurableManagedLocation
      ? (threadRef?.cwd ?? null)
      : (seed?.requestedCwd ??
        record.detail?.cwd ??
        this.getThreadLinkSafely(threadId)?.cwd ??
        null);
    if (projectless && !seed) {
      const persistedThread = this.getThreadLinkSafely(threadId);
      threadRef =
        (await this.repairPersistedProjectlessWorkspaceForResume({
          browserRoot: threadRef?.projectlessWorkspaceBrowserRoot ?? null,
          cwd: previousConversationCwd,
          outputDirectory: threadRef?.projectlessOutputDirectory ?? null,
          prompt:
            persistedThread?.threadName?.trim() ||
            persistedThread?.threadPreview?.trim() ||
            "new chat",
          threadId,
          writableRoots: projectlessWritableRoots,
        })) ?? threadRef;
      previousConversationCwd = threadRef?.cwd ?? previousConversationCwd;
    }
    const persistedProjectlessCwd = projectless ? (threadRef?.cwd ?? null) : null;
    let requestedCwd = resolveCodexCanonicalProjectlessCwd({
      cwd: previousConversationCwd,
      fallbackCwd: projectlessFallbackCwd,
      workspaceBrowserRoot: threadRef?.projectlessWorkspaceBrowserRoot ?? null,
      projectless,
    });
    const metadataThread = await this.fetchThreadWithTurnsFlag(threadId, false).catch((error) => {
      this.logger.warn("Failed to read Codex thread metadata before resume", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (metadataThread) {
      const rebasedCwd = hasDurableManagedLocation
        ? requestedCwd
        : requestedCwd && requestedCwd === persistedProjectlessCwd
          ? requestedCwd
          : resolveCodexCanonicalHydratedCwd({
              requestedCwd,
              responseCwd: null,
              threadCwd: metadataThread.cwd,
              fallbackCwd: requestedCwd,
            });
      requestedCwd = resolveCodexCanonicalProjectlessCwd({
        cwd: rebasedCwd,
        fallbackCwd: projectlessFallbackCwd,
        workspaceBrowserRoot: threadRef?.projectlessWorkspaceBrowserRoot ?? null,
        projectless,
      });
      const projectedMetadataThread =
        requestedCwd === null ? metadataThread : { ...metadataThread, cwd: requestedCwd };
      const metadataSummary = await this.upsertLinkFromThread(projectedMetadataThread);
      if (record.detail && metadataSummary) {
        record.detail = {
          ...record.detail,
          ...metadataSummary,
          turns: record.detail.turns,
          transcript: record.detail.transcript,
        };
      }
    }
    const persistedWritableRoots = await this.readThreadWritableRoots(threadId);
    const managedWorkspaceRoots = hasDurableManagedLocation
      ? [
          ...persistedWritableRoots,
          ...(persistedWritableRoots.length === 0 && threadRef?.managedWorktreePath
            ? [threadRef.managedWorktreePath]
            : []),
        ].filter((root, index, roots) => roots.indexOf(root) === index)
      : [];
    const fallbackWorkspaceRoots = hasDurableManagedLocation
      ? managedWorkspaceRoots
      : [
          ...(requestedCwd && requestedCwd !== "~" ? [requestedCwd] : []),
          ...(threadRef?.projectlessWorkspaceBrowserRoot &&
          threadRef.projectlessWorkspaceBrowserRoot !== "~"
            ? [threadRef.projectlessWorkspaceBrowserRoot]
            : []),
          ...(seed?.workspaceRoots ?? []).filter((root) => root !== "~"),
          ...(projectRuntimeContext?.workspaceRoots ?? []).filter((root) => root !== "~"),
        ].filter((root, index, roots) => roots.indexOf(root) === index);
    const preResumeWorkspaceRoots = hasDurableManagedLocation
      ? managedWorkspaceRoots
      : previousHydrationContext?.currentPermissions
        ? [...previousHydrationContext.currentPermissions.runtimeWorkspaceRoots]
        : fallbackWorkspaceRoots;
    const permissionWorkspaceRoots = projectless
      ? threadRef?.projectlessWorkspaceBrowserRoot &&
        threadRef.projectlessWorkspaceBrowserRoot !== "~"
        ? [threadRef.projectlessWorkspaceBrowserRoot]
        : projectlessWritableRoot
          ? [projectlessWritableRoot]
          : requestedCwd && requestedCwd !== "~" && requestedCwd !== previousConversationCwd
            ? [requestedCwd]
            : []
      : hasDurableManagedLocation
        ? managedWorkspaceRoots
        : fallbackWorkspaceRoots;
    const responseWorkspaceRoots = hasDurableManagedLocation
      ? managedWorkspaceRoots
      : [
          ...(previousHydrationContext?.currentPermissions.runtimeWorkspaceRoots ?? []),
          ...permissionWorkspaceRoots,
          ...persistedWritableRoots,
        ].filter((root, index, roots) => roots.indexOf(root) === index);
    const defaultPreResumePermissions =
      createCodexCanonicalWorkspacePermissionContext(fallbackWorkspaceRoots);
    const preResumePermissions =
      previousHydrationContext?.currentPermissions ?? defaultPreResumePermissions;
    const preResumeModel =
      record.latestThreadSettings?.model ??
      previousHydrationContext?.latestModel ??
      normalizeThreadSettingsModel(seed?.collaborationMode?.settings.model) ??
      "";
    const preResumeReasoningEffort =
      record.latestThreadSettings?.reasoningEffort ??
      previousHydrationContext?.latestReasoningEffort ??
      parseReasoningEffort(seed?.collaborationMode?.settings.reasoning_effort) ??
      null;

    const permissionSelection: CodexResumePermissionSelection = seed
      ? {
          context: seed.permissionContext,
          shouldSendPermissions: true,
          shouldSendApprovalsReviewer: true,
        }
      : (() => {
          const selection = this.resolveCanonicalPreResumePermissionContext(
            record,
            responseWorkspaceRoots,
            permissionWorkspaceRoots,
            projectless,
            persistedWritableRoots,
          );
          return hasDurableManagedLocation
            ? { ...selection, shouldSendPermissions: true }
            : selection;
        })();
    const responsePermissionFallback = permissionSelection.context;
    const latestServiceTier =
      previousHydrationContext?.latestThreadSettings?.serviceTier ??
      latestParams?.serviceTier ??
      null;
    const latestPersonality =
      previousHydrationContext?.latestThreadSettings?.personality ??
      latestParams?.personality ??
      null;
    const resumeCwd = requestedCwd ?? fallbackWorkspaceRoots[0] ?? "/";
    const launchPermissionParams = this.buildThreadResumePermissionOverrides({
      context: responsePermissionFallback,
      shouldSendPermissions: true,
      shouldSendApprovalsReviewer: true,
    });
    const resumeLaunchParams = await this.buildNewConversationParams({
      model: preResumeModel.trim() || null,
      executionProfile: threadRef?.executionProfile ?? null,
      serviceTier: latestServiceTier,
      cwd: resumeCwd,
      permissions: launchPermissionParams,
      defaultFeatureOverrides: CODEX_DEFAULT_FEATURE_OVERRIDES,
      personality: latestPersonality,
      skipDynamicTools: true,
      threadId,
    });
    const resumeParams: ThreadResumeParams = {
      threadId,
      history: null,
      path:
        metadataThread?.path ??
        this.readCanonicalConversationState(record.threadId)?.protocol.path ??
        null,
      model: threadRef?.executionProfile?.modelId ?? null,
      modelProvider: resumeLaunchParams.modelProvider,
      serviceTier: resumeLaunchParams.serviceTier,
      cwd: resumeLaunchParams.cwd,
      excludeTurns: true,
      initialTurnsPage: {
        limit: THREAD_TURNS_PAGE_SIZE,
        sortDirection: "desc",
        itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
      },
      config: resumeLaunchParams.config,
      baseInstructions: resumeLaunchParams.baseInstructions ?? undefined,
      developerInstructions: resumeLaunchParams.developerInstructions ?? undefined,
      personality: latestPersonality,
      ...this.buildThreadResumePermissionOverrides(permissionSelection),
    };
    const resumeRequestStartedAt = getDevRuntimeMetricStart();
    let result: ThreadResumeResponse;
    try {
      result = await this.client.request<"thread/resume", ThreadResumeResponse>(
        "thread/resume",
        resumeParams,
      );
      logDevRuntimeMetric("codex.thread.resume.app_server", {
        threadId,
        outcome: "success",
        usedPagedResume: true,
        initialTurnCount: result.initialTurnsPage?.data.length ?? null,
        hasNextCursor:
          result.initialTurnsPage?.nextCursor !== null &&
          result.initialTurnsPage?.nextCursor !== undefined,
        approxPayloadBytes: approximateJsonPayloadBytes(result),
        durationMs: getDevRuntimeMetricDurationMs(resumeRequestStartedAt),
      });
    } catch (error) {
      logDevRuntimeMetric("codex.thread.resume.app_server", {
        threadId,
        outcome: "error",
        usedPagedResume: true,
        error: error instanceof Error ? error.message : String(error),
        durationMs: getDevRuntimeMetricDurationMs(resumeRequestStartedAt),
      });
      throw error;
    }
    if (result.thread.id !== threadId) {
      throw new Error(
        `Canonical hydration expected thread '${threadId}' but received '${result.thread.id}'`,
      );
    }
    const resolvedCwd = hasDurableManagedLocation
      ? requestedCwd
      : resolveCodexCanonicalHydratedCwd({
          requestedCwd,
          responseCwd: result.cwd,
          threadCwd: result.thread.cwd,
          fallbackCwd: fallbackWorkspaceRoots[0] ?? preResumeWorkspaceRoots[0] ?? null,
        });
    const projectedThread =
      resolvedCwd === null ? result.thread : { ...result.thread, cwd: resolvedCwd };
    await this.upsertLinkFromThread(projectedThread);
    const rawInitialTurnsPage = result.initialTurnsPage;
    const initialTurnsPage = rawInitialTurnsPage ?? null;
    const initialTurns = initialTurnsPage === null ? null : [...initialTurnsPage.data].reverse();
    let canonicalTurns: readonly Turn[] = initialTurns ?? [];
    let historyPermissions = preResumePermissions;
    let historyCwd = requestedCwd || previousHydrationContext?.cwd || "/";
    let initialTurnsPageForPagination = initialTurnsPage;
    if (initialTurnsPage === null) {
      this.logger.warn(
        "Paged Codex thread resume returned no initial turns; falling back to full thread read",
        {
          threadId,
        },
      );
      const fallbackThread = await this.fetchThreadWithTurnsFlag(threadId, true);
      canonicalTurns = fallbackThread?.turns ?? [];
      historyPermissions = defaultPreResumePermissions;
      historyCwd = fallbackThread?.cwd || requestedCwd || previousHydrationContext?.cwd || "/";
      initialTurnsPageForPagination = null;
    }
    this.setThreadPermissionFields(threadId, {
      approvalPolicy: result.approvalPolicy,
      approvalsReviewer: result.approvalsReviewer,
      sandbox: result.sandbox,
    });
    const canonicalState = this.hydrateCanonicalConversationState(result, {
      expectedThreadId: threadId,
      historyCwd,
      historyModel: preResumeModel,
      historyPermissions,
      historyReasoningEffort: preResumeReasoningEffort,
      latestModel: result.model.trim() || preResumeModel,
      latestReasoningEffort: result.reasoningEffort ?? preResumeReasoningEffort,
      mergeExistingTurns: true,
      overlayResponseTurnParams: true,
      pendingRequests: pendingRequestsBeforeResume,
      responsePermissionFallback,
      resolvedCwd,
      turns: canonicalTurns,
    });
    const canonicalDetail = this.buildThreadDetailFromCanonicalState(canonicalState);
    if (!canonicalDetail) return null;
    const detail = this.reconcileDetailTranscriptToTerminalTurnStatus(canonicalDetail);
    this.setConversationRecordDetail(detail, {
      turnPagination: initialTurnsPageForPagination
        ? this.buildTurnPaginationFromPage(
            initialTurnsPageForPagination,
            detail.turns.length,
            initialTurns?.[0]?.id ?? null,
          )
        : this.buildCompleteTurnPagination(detail.turns.length),
    });
    const resumedModel = result.model.trim() || preResumeModel;
    const resumedReasoningEffort =
      parseReasoningEffort(result.reasoningEffort) ??
      parseReasoningEffort(preResumeReasoningEffort) ??
      null;
    const frozenCollaborationMode = seed?.collaborationMode
      ? ({
          mode: seed.collaborationMode.mode,
          settings: {
            model: seed.collaborationMode.settings.model,
            reasoning_effort: parseReasoningEffort(
              seed.collaborationMode.settings.reasoning_effort,
            ),
            developer_instructions: null,
          },
        } satisfies CodexCollaborationModeState)
      : null;
    const resumedCollaborationMode = buildCollaborationModeState({
      collaborationMode: "default",
      model: resumedModel,
      reasoningEffort: resumedReasoningEffort,
      fallback: frozenCollaborationMode,
    });
    const resumedSummary =
      record.latestThreadSettings?.summary !== undefined
        ? record.latestThreadSettings.summary
        : (previousHydrationContext?.latestThreadSettings?.summary ??
          latestParams?.summary ??
          null);
    this.setLatestCollaborationModeForThread(threadId, resumedCollaborationMode);
    this.applyLatestThreadSettingsForThread(threadId, {
      model: resumedModel,
      reasoningEffort: resumedReasoningEffort,
      summary: resumedSummary,
      collaborationMode: resumedCollaborationMode,
      personality: latestPersonality,
    });
    const resumedDetail = this.serializeThreadDetail(threadId) ?? detail;
    await this.persistThreadDetailSummary(resumedDetail);

    this.conversationAggregate(threadId).setStreaming(true);
    this.setConversationStreamRole(threadId, "owner");
    return resumedDetail;
  }

  async resumeThread(threadId: string): Promise<CodexThreadDetail | null> {
    return this.resumeThreadWithSeed(threadId);
  }

  private async resumeThreadWithSeed(
    threadId: string,
    seed?: CodexConversationResumeSeed,
    force = false,
  ): Promise<CodexThreadDetail | null> {
    const existingRecord = this.getMaybeConversationRecord(threadId);
    if (
      !force &&
      existingRecord !== null &&
      this.readConversationStreamRole(threadId) !== null &&
      (this.resolveConversationResumeState(threadId) !== "needs_resume" ||
        this.conversationAggregate(threadId).isStreaming())
    ) {
      return this.serializeThreadDetail(threadId);
    }

    this.setConversationResumeState(threadId, "resuming");

    try {
      const detail = await this.resumeConversationRecord(threadId, seed, force);
      this.setConversationResumeState(threadId, detail ? "resumed" : "needs_resume");
      await this.waitForRendererOwnerNotificationDrain(threadId);
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      if (detail) {
        let revision: number;
        if (seed?.syncDormantConversationSnapshot === false) {
          revision = this.syncAcceptedConversationDocumentSilently(threadId);
        } else {
          this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
          revision = this.readConversationAggregate(threadId)?.revision ?? 0;
        }
        this.startPostResumeGoalFlow(threadId, revision);
      }
      return detail;
    } catch (error) {
      this.setConversationResumeState(threadId, "needs_resume");
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      throw error;
    }
  }

  async requestConversationResume(
    threadId: string,
    options: RequestConversationResumeOptions = {},
  ): Promise<CodexConversationSnapshot | null> {
    return await this.conversationResume.resume({ threadId, ...options });
  }

  private resolveLatestEditableTurn(detail: CodexThreadDetail): CodexTurnSummary | null {
    const latestTurn = detail.turns.at(-1) ?? null;
    if (!latestTurn || latestTurn.status === "inProgress") return null;

    const hasUserMessage = detail.transcript.some(
      (entry) =>
        entry.turnId === latestTurn.turnId &&
        (entry.semanticKind === "userMessage" || entry.kind === "userMessage"),
    );
    if (!hasUserMessage) return null;

    return latestTurn;
  }

  private async materializeThreadDetailFromThreadPayload(
    thread: Thread,
    fallbackRef?: ThreadRef | null,
    fallbackCwd?: string | null,
    options: { preserveExistingTimeline?: boolean } = {},
  ): Promise<{ detail: CodexThreadDetail; summary: CodexThreadSummary | null }> {
    const summary = await this.upsertLinkFromThread(thread, fallbackRef ?? undefined, fallbackCwd);
    const directDetail = this.buildThreadDetailFromRead(thread, options);
    if (directDetail) {
      return { detail: directDetail, summary };
    }

    const fallbackDetail = this.serializeThreadDetail(thread.id);
    if (!fallbackDetail) {
      throw new Error(
        `Thread action completed but canonical conversation '${thread.id}' is unavailable`,
      );
    }
    return { detail: fallbackDetail, summary };
  }

  private maybeContinueActiveThreadGoal(threadId: string): void {
    this.activeGoalContinuation.request(threadId);
  }

  private async pauseActiveThreadGoalBeforeInterrupt(threadId: string): Promise<void> {
    const record = this.getMaybeConversationRecord(threadId);
    if (record?.threadGoal?.status !== "active") return;

    await this.threadGoals.set({
      threadId,
      status: "paused",
      dismissResumeConfirmation: true,
    });
  }

  /** Remaining app-server and dynamic-tool ingress delegates to the canonical Turn command. */
  async startTurn(
    threadId: string,
    prompt: string,
    overrides?: StartTurnOverrides,
  ): Promise<CodexTurnSummary | null> {
    return await this.controlPlane.runPromise(this.turnCommands.start(threadId, prompt, overrides));
  }

  async steerTurn(input: CodexSteerTurnInput): Promise<{ turnId: string } | null> {
    return await this.controlPlane.runPromise(this.turnCommands.steer(input));
  }

  private abandonOtherPendingRequestsById(threadId: string, requestId: RequestId): void {
    this.pendingServerRequests.abandonIdentity(threadId, requestId);
  }

  private syncPlanImplementationForTurn(threadId: string, turnId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    const byItem = record?.itemsByTurn.get(turnId);
    if (!byItem || byItem.size === 0) return;

    const items = this.listKnownTurnItems(threadId, turnId);
    let latestTodoList: CodexItemView | undefined;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.type !== "todo-list") continue;
      latestTodoList = item;
      break;
    }
    const todoPlan = asRecord(latestTodoList?.rawItem)?.plan;
    if (Array.isArray(todoPlan)) {
      const completedPlanStepCount = todoPlan.filter(
        (entry) => asRecord(entry)?.status === "completed",
      ).length;
      if (completedPlanStepCount < todoPlan.length) {
        this.logger.info("turn_completed_with_incomplete_plan", {
          conversationId: threadId,
          turnId,
          planStepCount: todoPlan.length,
          completedPlanStepCount,
        });
      }
    }

    let latestPlan: CodexItemView | undefined;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.type !== "plan") continue;
      latestPlan = item;
      break;
    }
    const planContent = latestPlan?.markdownText?.trim() ?? "";

    if (!latestPlan || planContent.length === 0) return;

    this.removePlanImplementationItemsForTurn(threadId, turnId);
    this.upsertCanonicalTurnItem(
      threadId,
      turnId,
      buildPlanImplementationRequestId(turnId),
      "completed",
    );
    const item = this.buildPlanImplementationItemView({
      threadId,
      turnId,
      planContent,
      isCompleted: false,
    });
    this.mergeItem(item);
    this.upsertPlanImplementationRequest(threadId, turnId, planContent, item.createdAt);
  }

  private removePlanImplementationItemsForTurn(threadId: string, turnId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    const byItem = record?.itemsByTurn.get(turnId);
    if (!record || !byItem) return;
    const removedItemIds: string[] = [];
    for (const [key, item] of byItem) {
      if (item.type !== "planImplementation") continue;
      removedItemIds.push(item.itemId);
      byItem.delete(key);
    }
    if (removedItemIds.length === 0) return;
    this.removeCanonicalTurnItems(threadId, turnId, removedItemIds);
    this.setThreadTranscript(
      threadId,
      this.getThreadTranscript(threadId).filter(
        (entry) => entry.turnId !== turnId || entry.type !== "planImplementation",
      ),
    );
  }

  private completePlanImplementationItemsForTurn(threadId: string, turnId: string): void {
    const byItem = this.getMaybeConversationRecord(threadId)?.itemsByTurn.get(turnId);
    if (!byItem) return;
    for (const item of byItem.values()) {
      if (item.type !== "planImplementation" || item.status === "completed") continue;
      this.mergeItem(
        {
          ...item,
          status: "completed",
          rawItem:
            typeof item.rawItem === "object" && item.rawItem !== null
              ? { ...item.rawItem, isCompleted: true }
              : item.rawItem,
        },
        "live",
        { authoritativeLifecycleItem: true },
      );
    }
  }

  private completeStalePlanImplementationItems(threadId: string, activeTurnId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return;
    const canonical = this.readCanonicalConversationState(threadId);
    if (canonical) {
      this.acceptCanonicalConversationState(
        threadId,
        applyCodexCanonicalPlanImplementationTurnStartedState(canonical, activeTurnId),
      );
    }
    for (const turnId of record.planImplementationRequestsByTurnId.keys()) {
      if (turnId === activeTurnId) continue;
      record.planImplementationRequestsByTurnId.delete(turnId);
    }

    const turns = this.listKnownTurns(threadId);
    for (const turn of turns) {
      if (turn.turnId === null || turn.turnId === activeTurnId) continue;
      this.completePlanImplementationItemsForTurn(threadId, turn.turnId);
    }
  }

  private async resolveDynamicThreadDetail(threadId: string): Promise<CodexThreadDetail> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) throw new Error("Thread id is required");

    await this.readWorkspaceThread(normalizedThreadId);
    const loaded = this.serializeThreadDetail(normalizedThreadId);
    if (loaded) return loaded;

    const link = this.getThreadLinkSafely(normalizedThreadId);
    if (!link) throw new Error(`No Codex thread found for threadId: ${normalizedThreadId}`);

    const read = await this.readThread(normalizedThreadId, false);
    if (read) return read;
    const reloaded = this.serializeThreadDetail(normalizedThreadId);
    if (reloaded) return reloaded;
    throw new Error(`Thread '${normalizedThreadId}' was not found`);
  }

  private resolveNodexAgentRootThreadId(threadId: string): string {
    let currentThreadId = threadId;
    const visited = new Set<string>();
    while (!visited.has(currentThreadId)) {
      visited.add(currentThreadId);
      const summary =
        this.getMaybeConversationRecord(currentThreadId)?.detail ??
        this.getThreadLinkSafely(currentThreadId);
      const parentThreadId = summary?.source?.parentThreadId?.trim();
      if (!parentThreadId) return currentThreadId;
      currentThreadId = parentThreadId;
    }
    return threadId;
  }

  private async beginNodexAgentTurnAuthority(
    threadId: string,
    builtinFullAccess: boolean,
    inheritedAuthority?: FrozenNodexAgentTurnAuthority | null,
  ): Promise<NodexAgentTurnAuthorityLaunch | null> {
    const rootThreadId = this.resolveNodexAgentRootThreadId(threadId);
    const actorProjectId =
      this.parseThreadRef(threadId)?.projectId ??
      this.parseThreadRef(rootThreadId)?.projectId ??
      null;
    if (!actorProjectId) return null;
    return await this.nodexAgentAuthorityRegistry.beginTurn({
      threadId,
      rootThreadId,
      actorProjectId,
      builtinFullAccess,
      inheritedAuthority,
    });
  }

  private clearApprovalRequestAttachment(
    threadId: string,
    turnId: string,
    requestId: RequestId,
  ): void {
    const record = this.getMaybeConversationRecord(threadId);
    const byItem = record?.itemsByTurn.get(turnId);
    if (!byItem) return;

    for (const [itemKey, item] of byItem.entries()) {
      if (item.approvalRequestId !== requestId) continue;
      if (item.type === "commandExecutionApproval") {
        byItem.delete(itemKey);
        this.removeTranscriptEntry(threadId, item.itemId);
        continue;
      }
      this.updateRequestProjectionItem({
        ...item,
        requestId: undefined,
        approvalRequestId: null,
        networkApprovalContext: null,
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
        grantRoot: null,
      });
    }
  }

  private removeStandalonePendingRequestProjection(
    threadId: string,
    turnId: string,
    requestId: RequestId,
    type: "requestUserInput",
  ): void {
    const byItem = this.getMaybeConversationRecord(threadId)?.itemsByTurn.get(turnId);
    if (!byItem) return;
    for (const [itemKey, item] of byItem.entries()) {
      if (item.type !== type || item.requestId !== requestId) continue;
      byItem.delete(itemKey);
      this.removeTranscriptEntry(threadId, item.itemId);
    }
  }

  /**
   * Approval linkage is a request projection, not a protocol item mutation.
   * Keep the canonical raw item and all protocol timestamps byte-for-byte stable.
   */
  private updateRequestProjectionItem(item: CodexItemView): void {
    if (item.turnId === null) return;
    const record = this.getMaybeConversationRecord(item.threadId);
    const byItem = record?.itemsByTurn.get(item.turnId);
    const detail = record?.detail;
    if (!byItem || !detail) return;

    const itemKey = resolveCodexItemPrimaryIdentityKey(item);
    if (!byItem.has(itemKey)) return;
    byItem.set(itemKey, item);

    const transcript = detail.transcript.map((entry) => {
      if (entry.turnId !== item.turnId || entry.itemId !== item.itemId) return entry;
      return {
        ...entry,
        approvalRequestId: item.approvalRequestId,
        networkApprovalContext: item.networkApprovalContext,
        proposedExecpolicyAmendment: item.proposedExecpolicyAmendment,
        grantRoot: item.grantRoot,
      };
    });
    this.setThreadTranscript(item.threadId, transcript);
  }

  private applyTerminalInteraction(input: {
    threadId: string;
    turnId: string | null;
    itemId: string;
    stdin: string;
  }): void {
    const bufferKey = getTerminalInteractionBufferKey(input.threadId, input.itemId);
    const parsed = parseTerminalInteractionInput(
      this.terminalInputBuffers.get(bufferKey) ?? "",
      input.stdin,
    );
    if (parsed.inputBuffer.length > 0) {
      this.terminalInputBuffers.set(bufferKey, parsed.inputBuffer);
    } else {
      this.terminalInputBuffers.delete(bufferKey);
    }
    if (parsed.commands.length === 0) return;

    const record = this.getMaybeConversationRecord(input.threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before || before.turns.length === 0) return;
    const result = reduceCodexConversationTerminalCommands(before, {
      conversationId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      commands: parsed.commands,
    });
    this.acceptCanonicalConversationState(input.threadId, result.state);
    if (result.disposition !== "applied") {
      this.logger.warn("Dropping commandExecution/terminalInteraction for missing item", {
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: input.itemId,
      });
      return;
    }
    if (!result.stateChanged || !record.detail) return;
    const afterTurn = result.state.turns[result.turnIndex];
    if (!afterTurn) return;
    this.applyCanonicalLifecycleTurnProjection({
      threadId: input.threadId,
      turnIndex: result.turnIndex,
      beforeTurn: before.turns[result.turnIndex] ?? null,
      afterTurn,
      observedAtMs: Date.now(),
      preserveExistingUpdatedAt: true,
    });
    this.syncCommandExecutionTurnToBroadcastCache(input.threadId, result.turnIndex);
  }

  private syncCommandExecutionTurnToBroadcastCache(threadId: string, turnIndex: number): void {
    const record = this.getMaybeConversationRecord(threadId);
    const detail = record?.detail;
    const sourceTurn = detail?.turns[turnIndex];
    if (!detail || !sourceTurn) return;
    const projectedTurn = buildCodexConversationTurn(detail, sourceTurn);
    const sourceTurnId = (sourceTurn as { turnId: string | null }).turnId;

    this.mutateAcceptedConversationDocumentSilently(threadId, (draft) => {
      if (draft.turns[turnIndex]?.turnId === sourceTurnId) {
        draft.turns[turnIndex] = projectedTurn;
        return;
      }

      for (let index = draft.turns.length - 1; index >= 0; index -= 1) {
        if (draft.turns[index]?.turnId !== sourceTurnId) continue;
        draft.turns[index] = projectedTurn;
        return;
      }
    });
  }

  private resolvePendingServerRequest(threadId: string, requestId: RequestId): void {
    this.rendererConversationCoordinator.clearRequestDelivery(threadId, requestId);
    this.emitThreadNotificationEvent({
      type: "request-resolved",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversationId: threadId,
      requestId,
    });
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return;
    const notification = {
      method: "serverRequest/resolved" as const,
      params: { threadId, requestId },
    };
    if (!this.readCanonicalConversationState(record.threadId)) {
      const transportOnly = this.buildTransportOnlyServerRequestRawState(threadId, record);
      const rawLifecycle = reduceCodexServerRequestResolvedRawState(transportOnly, notification, {
        now: () => Date.now(),
      });
      if (!rawLifecycle.stateChanged) return;
      this.applyTransportOnlyServerRequestRawLifecycleResult(threadId, rawLifecycle);
    } else {
      const before = this.readCanonicalConversationState(record.threadId);
      if (!before) return;
      const canonicalLifecycle = reduceCodexConversationServerRequestResolved(
        before,
        notification,
        { now: () => Date.now() },
      );
      if (!canonicalLifecycle.stateChanged) return;
      this.applyServerRequestCanonicalLifecycleResult(threadId, before, canonicalLifecycle);
    }

    this.logger.info("Resolving pending Codex server request from server notification", {
      requestId,
      pendingApproval: this.pendingServerRequests.has("approval", requestId),
      pendingUserInput: this.pendingServerRequests.has("user-input", requestId),
      pendingMcpElicitation: this.pendingServerRequests.has("mcp-elicitation", requestId),
      pendingPermissionRequest: this.pendingServerRequests.has("permission", requestId),
    });
    const pendingApprovals = this.pendingServerRequests.takeAll(
      "approval",
      requestId,
      (pending) => pending.request.threadId === threadId,
    );
    for (const pendingApproval of pendingApprovals) {
      this.pendingServerRequests.complete(pendingApproval, CODEX_SERVER_REQUEST_NO_RESPONSE);
      this.clearApprovalRequestAttachment(
        pendingApproval.request.threadId,
        pendingApproval.request.turnId,
        requestId,
      );
    }
    if (pendingApprovals.length > 0) {
      this.emitEvent({ type: "approvalResolved", requestId, decision: "cancel" });
    }

    const pendingUserInputs = this.pendingServerRequests.takeAll(
      "user-input",
      requestId,
      (pending) => pending.request.threadId === threadId,
    );
    for (const pendingUserInput of pendingUserInputs) {
      this.pendingServerRequests.complete(pendingUserInput, CODEX_SERVER_REQUEST_NO_RESPONSE);
      this.removeStandalonePendingRequestProjection(
        pendingUserInput.request.threadId,
        pendingUserInput.request.turnId,
        requestId,
        "requestUserInput",
      );
    }
    if (pendingUserInputs.length > 0) {
      this.emitEvent({ type: "userInputResolved", requestId });
    }

    for (const pendingMcpElicitation of this.pendingServerRequests.takeAll(
      "mcp-elicitation",
      requestId,
      (pending) => pending.request.threadId === threadId,
    )) {
      this.pendingServerRequests.complete(pendingMcpElicitation, CODEX_SERVER_REQUEST_NO_RESPONSE);
    }

    for (const pendingPermissionRequest of this.pendingServerRequests.takeAll(
      "permission",
      requestId,
      (pending) => pending.request.threadId === threadId,
    )) {
      this.pendingServerRequests.complete(
        pendingPermissionRequest,
        CODEX_SERVER_REQUEST_NO_RESPONSE,
      );
    }

    for (const pendingPrivateRequest of this.pendingServerRequests.takeAll(
      "private",
      requestId,
      (pending) => pending.request.params.threadId === threadId,
    )) {
      this.pendingServerRequests.complete(pendingPrivateRequest, CODEX_SERVER_REQUEST_NO_RESPONSE);
    }

    for (const pendingDynamicRequest of this.pendingServerRequests.takeAll(
      "dynamic-tool",
      requestId,
      (pending) => pending.disposition === "stored" && pending.request.params.threadId === threadId,
    )) {
      this.pendingServerRequests.complete(pendingDynamicRequest, CODEX_SERVER_REQUEST_NO_RESPONSE);
    }
  }

  private listPendingConversationRequests(threadId: string): CodexConversationServerRequest[] {
    const record = this.getConversationRecord(threadId);
    const requests: CodexConversationServerRequest[] = [];

    for (const request of this.readConversationServerRequests(record)) {
      if (
        request.method === "item/commandExecution/requestApproval" ||
        request.method === "item/fileChange/requestApproval"
      ) {
        const projected = this.pendingServerRequests.find(
          "approval",
          request.id,
          (pending) => pending.request.threadId === threadId,
        )?.request;
        if (projected?.threadId === threadId) requests.push(projected);
        continue;
      }
      if (request.method === "item/tool/requestUserInput") {
        const projected = this.pendingServerRequests.find(
          "user-input",
          request.id,
          (pending) => pending.request.threadId === threadId,
        )?.request;
        if (projected?.threadId === threadId) requests.push(projected);
        continue;
      }
      if (request.method === "mcpServer/elicitation/request") {
        const projected = this.pendingServerRequests.find(
          "mcp-elicitation",
          request.id,
          (pending) => pending.request.threadId === threadId,
        )?.request;
        if (projected?.threadId === threadId) requests.push(projected);
        continue;
      }
      if (request.method === "item/permissions/requestApproval") {
        const projected = this.pendingServerRequests.find(
          "permission",
          request.id,
          (pending) => pending.request.threadId === threadId,
        )?.request;
        if (projected?.threadId === threadId) requests.push(projected);
        continue;
      }
      if (request.method === "item/plan/requestImplementation") {
        const existing = record.planImplementationRequestsByTurnId.get(request.params.turnId);
        const itemId = buildPlanImplementationRequestId(request.params.turnId);
        const createdAt =
          existing?.createdAt ??
          this.getRecordedItem(threadId, request.params.turnId, itemId)?.createdAt ??
          record.detail?.updatedAt ??
          Date.now();
        requests.push(
          this.buildPlanImplementationServerRequest(
            threadId,
            request.params.turnId,
            itemId,
            request.params.planContent,
            createdAt,
          ),
        );
      }
    }

    return requests;
  }

  serializeThreadDetail(threadId: string): CodexThreadDetail | null {
    let record = this.getMaybeConversationRecord(threadId);
    let detail = record?.detail;
    let link = this.getThreadLinkSafely(threadId) ?? detail;
    if (!link) {
      const bootstrapped = this.bootstrapConversationRecordFromSession(threadId);
      if (!bootstrapped) return null;
      record = this.getMaybeConversationRecord(threadId);
      detail = record?.detail ?? bootstrapped;
      link = this.getThreadLinkSafely(threadId) ?? detail;
    }
    if (!link) return null;
    const turns = [...(detail?.turns ?? [])];
    const transcript = [...(detail?.transcript ?? [])];
    const transcriptUpdatedAt = transcript.reduce(
      (latest, entry) => Math.max(latest, entry.updatedAt),
      0,
    );

    return {
      ...link,
      threadSource: detail?.threadSource ?? link.threadSource ?? null,
      agentNickname: detail?.agentNickname ?? link.agentNickname ?? null,
      agentRole: detail?.agentRole ?? link.agentRole ?? null,
      threadName: link.threadName,
      threadPreview: resolveThreadPreviewFromTranscript(transcript, link.threadPreview),
      cwd: link.cwd,
      approvalPolicy: detail?.approvalPolicy ?? null,
      approvalsReviewer: detail?.approvalsReviewer ?? null,
      sandbox: detail?.sandbox ?? null,
      latestCollaborationMode:
        detail?.latestCollaborationMode ??
        record?.latestCollaborationMode ??
        buildDefaultCollaborationModeState(),
      latestThreadSettings: detail?.latestThreadSettings ?? record?.latestThreadSettings ?? null,
      latestTokenUsageInfo: detail?.latestTokenUsageInfo ?? record?.latestTokenUsageInfo ?? null,
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
    if (detail.source?.sideConversation === true) {
      return {
        canEditLastUserTurn: false,
        canForkFromTurn: false,
        canSearch: true,
        canCollapseTurns: true,
      };
    }

    const isConversationActionable = !detail.archived && detail.statusType !== "systemError";
    const latestTurnHasUserMessage =
      latestTurn !== null &&
      detail.transcript.some(
        (entry) =>
          entry.turnId === latestTurn.turnId &&
          (entry.semanticKind === "userMessage" || entry.kind === "userMessage"),
      );

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
      : (this.bootstrapConversationRecordFromSession(threadId) ??
        this.serializeThreadDetail(threadId));
    if (!detail) return null;
    const record = this.ensureConversationRecord(threadId);
    const requests = this.listPendingConversationRequests(threadId);

    const snapshot = buildCodexConversationSnapshot({
      detail,
      resumeState: this.resolveConversationResumeState(threadId),
      requests,
      canonicalState: this.readCanonicalConversationState(record.threadId),
      canonicalRequests: this.readConversationServerRequests(record),
      hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
      unreadMessageCount: this.readConversationAggregate(record.threadId)?.acceptedReplica
        ?.conversation.unreadMessageCount,
      queuedFollowUps: this.listQueuedFollowUps(threadId),
      pendingSteers: this.listPendingSteers(threadId),
      capabilityFlags: this.buildConversationCapabilityFlags(detail, requests),
      turnPagination: this.normalizeTurnPagination(
        this.readConversationTurnPagination(record.threadId),
        detail.turns.length,
      ),
      threadGoal: record.threadGoal,
      completedThreadGoal: record.completedThreadGoal,
      threadGoalResumeConfirmation: record.threadGoalResumeConfirmation,
    });
    const aggregate = this.conversationAggregate(threadId);
    const owned = aggregate.readSnapshot();
    if (!owned || owned.canonicalState !== snapshot.canonicalState) return snapshot;
    const reconciled = {
      ...snapshot,
      turns: owned.turns,
      resumeState: aggregate.readResumeState(),
      turnPagination: aggregate.readTurnPagination(),
      hasUnreadTurn: aggregate.readHasUnreadTurn(),
      ...(owned.unreadMessageCount === undefined
        ? {}
        : { unreadMessageCount: owned.unreadMessageCount }),
    };
    aggregate.installSnapshot(reconciled);
    return reconciled;
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

  private hasInlineSubagentReference(
    conversation: CodexConversationSnapshot,
    childThreadId: string,
  ): boolean {
    return conversation.turns.some((turn) =>
      turn.items.some((item) => item.subagentActivity?.agentThreadId === childThreadId),
    );
  }

  private formatConversationActorName(
    conversation: CodexConversationSnapshot | null,
    threadId: string,
    summary?: CodexThreadSummary | null,
  ): string {
    const threadName = conversation?.threadName?.trim();
    if (threadName) return threadName;
    const summaryName = summary?.threadName?.trim();
    if (summaryName) return summaryName;
    const nickname = conversation?.agentNickname?.trim() ?? summary?.agentNickname?.trim();
    if (nickname) return nickname.startsWith("@") ? nickname.slice(1) : nickname;
    const threadPreview = conversation?.threadPreview?.trim();
    if (threadPreview) return threadPreview;
    const summaryPreview = summary?.threadPreview?.trim();
    if (summaryPreview) return summaryPreview;
    return threadId;
  }

  private buildConversationChildThreadMetadata(
    conversation: CodexConversationSnapshot | null,
    summary?: CodexThreadSummary | null,
  ): CodexConversationChildMembership["thread"] {
    const displayName = conversation?.threadName?.trim() || summary?.threadName?.trim() || null;
    const nickname = conversation?.agentNickname?.trim() || summary?.agentNickname?.trim() || null;
    const agentRole = conversation?.agentRole?.trim() || summary?.agentRole?.trim() || null;
    const model = conversation?.modelProvider?.trim() || summary?.modelProvider?.trim() || null;
    if (!displayName && !nickname && !agentRole) return null;

    return {
      ...(displayName ? { displayName, name: displayName } : {}),
      nickname,
      model,
      agentRole,
    };
  }

  private deriveConversationChildMemberships(
    conversation: CodexConversationSnapshot,
  ): CodexConversationChildMembership[] {
    const childThreadSummaries = new Map(
      this.listChildThreadLinksSafely(conversation.threadId).map(
        (summary) => [summary.threadId, summary] as const,
      ),
    );
    const transcriptChildThreadIds = new Set(this.extractConversationChildThreadIds(conversation));
    const hasInlineSubagentActivity = conversation.turns.some((turn) =>
      turn.items.some((item) => item.subagentActivity !== undefined),
    );
    const childThreadIds = new Set([...transcriptChildThreadIds, ...childThreadSummaries.keys()]);

    return Array.from(childThreadIds).flatMap((childThreadId) => {
      if (this.deletedThreadIds.has(childThreadId)) return [];
      const childConversation = this.buildConversationBaseSnapshot(childThreadId);
      const childSummary =
        childThreadSummaries.get(childThreadId) ?? this.getThreadLinkSafely(childThreadId);
      if (childConversation?.archived || childSummary?.archived) return [];
      const primaryRequest = selectPrimaryBackgroundConversationRequest(childConversation);
      const thread = this.buildConversationChildThreadMetadata(childConversation, childSummary);
      const agentRole =
        childConversation?.agentRole?.trim() || childSummary?.agentRole?.trim() || null;
      const agentPath =
        childConversation?.agentPath?.trim() || childSummary?.agentPath?.trim() || null;
      const showInlineActivity = Boolean(
        agentPath ||
        this.hasInlineSubagentReference(conversation, childThreadId) ||
        (!transcriptChildThreadIds.has(childThreadId) && hasInlineSubagentActivity),
      );
      return [
        {
          threadId: childThreadId,
          parentThreadId: conversation.threadId,
          role: primaryRequest ? "childApproval" : "backgroundChild",
          actorName: this.formatConversationActorName(
            childConversation,
            childThreadId,
            childSummary,
          ),
          agentRole,
          agentPath,
          createdAtMs: childConversation?.createdAt ?? childSummary?.createdAt ?? null,
          updatedAtMs: childConversation?.updatedAt ?? childSummary?.updatedAt ?? null,
          statusType: childConversation?.statusType ?? childSummary?.statusType ?? "notLoaded",
          showInlineActivity,
          ...(thread ? { thread } : {}),
        },
      ];
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
      if (!turn || turn.turnId === null) {
        continue;
      }
      if (turnIndex === latestTurnIndex && turn.status === "inProgress") {
        continue;
      }

      const interruptedCommandExecutionItemIds = new Set(
        turn.interruptedCommandExecutionItemIds ?? [],
      );
      for (const item of turn.items) {
        if (
          !item ||
          item.kind !== "commandExecution" ||
          item.status !== "inProgress" ||
          interruptedCommandExecutionItemIds.has(item.itemId)
        ) {
          continue;
        }

        rows.push({
          turnId: turn.turnId,
          row: {
            id: item.itemId,
            turnId: turn.turnId,
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

  private listRecordedInterruptedCommandExecutionItemIds(
    threadId: string,
    turnId: string,
  ): string[] {
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

  private serializeConversationSnapshotIncludingArchived(
    threadId: string,
    visitedThreadIds = new Set<string>(),
  ): CodexConversationSnapshot | null {
    const baseConversation = this.buildConversationBaseSnapshot(threadId);
    if (!baseConversation) return null;
    if (visitedThreadIds.has(threadId)) return baseConversation;

    const childMemberships = this.deriveConversationChildMemberships(baseConversation);

    const snapshot = {
      ...baseConversation,
      childMemberships,
      backgroundTerminalRows: this.deriveConversationBackgroundTerminalRows(baseConversation),
    };
    this.conversationAggregate(threadId).installSnapshot(snapshot);
    return snapshot;
  }

  serializeConversationSnapshot(
    threadId: string,
    visitedThreadIds = new Set<string>(),
  ): CodexConversationSnapshot | null {
    if (this.isConversationArchived(threadId)) return null;
    return this.serializeConversationSnapshotIncludingArchived(threadId, visitedThreadIds);
  }
}

export function isRetryableCodexError(error: unknown): boolean {
  return error instanceof CodexRpcError && error.retryable;
}
