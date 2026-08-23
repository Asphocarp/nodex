import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, open as openFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { produceWithPatches } from "immer";
import * as Effect from "effect/Effect";
import type {
  CollaborationMode as CodexAppServerCollaborationMode,
  GetAuthStatusResponse,
  RequestId,
} from "@nodex/codex-app-server-protocol";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import type { DynamicToolCallParams } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import type { ModelListResponse } from "@nodex/codex-app-server-protocol/v2/ModelListResponse";
import type { ThreadListResponse } from "@nodex/codex-app-server-protocol/v2/ThreadListResponse";
import type { ThreadReadResponse } from "@nodex/codex-app-server-protocol/v2/ThreadReadResponse";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { ThreadListParams } from "@nodex/codex-app-server-protocol/v2/ThreadListParams";
import type { ThreadRollbackResponse } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackResponse";
import type { ThreadSource } from "@nodex/codex-app-server-protocol/v2/ThreadSource";
import type { ThreadSourceKind } from "@nodex/codex-app-server-protocol/v2/ThreadSourceKind";
import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2/ThreadItem";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import type { ThreadResumeParams } from "@nodex/codex-app-server-protocol/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "@nodex/codex-app-server-protocol/v2/ThreadResumeResponse";
import type { ThreadSettings } from "@nodex/codex-app-server-protocol/v2/ThreadSettings";
import type { ThreadSettingsUpdateResponse } from "@nodex/codex-app-server-protocol/v2/ThreadSettingsUpdateResponse";
import type { Thread } from "@nodex/codex-app-server-protocol/v2/Thread";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@nodex/codex-app-server-protocol/v2/ThreadTurnsListResponse";
import type { Turn } from "@nodex/codex-app-server-protocol/v2/Turn";
import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type {
  PageRunInTarget,
  CodexAgentMode,
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
  CodexHeartbeatAutomationCollaborationMode,
  CodexHeartbeatAutomationPermissions,
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
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  CodexSidebarThreadItem,
  CodexSteerTurnInput,
  CodexSteeringRestoreMessage,
  CodexSteeringUserInput,
  CodexGitSettings,
  CodexTranscriptEntry,
  CodexTranscriptEntrySource,
  CodexThreadActiveFlag,
  CodexThreadDetail,
  CodexThreadGoalDraftInput,
  CodexThreadRuntimeStatus,
  CodexThreadStatusType,
  CodexThreadSummary,
  CodexTurnDiffPatchBatch,
  CodexThreadStartProgressPhase,
  CodexThreadStartProgressStream,
  CodexThreadTokenUsage,
  CodexScheduledAutomation,
  CodexScheduledAutomationChangedEvent,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
  CodexScheduledAutomationRunNowInput,
  CodexThreadStartForSessionInput,
  CodexThreadStartMemoryPreferences,
  CodexThreadStreamCheckpoint,
  TerminalSessionSnapshot,
  CodexTurnStatus,
  CodexTurnSummary,
  CodexUserAttachment,
  CodexPromptAgentConfigInput,
  CodexPromptInput,
  CodexPromptTextAttachmentInput,
  Project,
  ProjectSession,
  ProjectSessionSummary,
} from "../../shared/types";
import type { ComposerCatalogPromiseAdapter } from "../codex-application/ComposerCatalogPromiseAdapter";
import type { CodexApplicationEventPublisher } from "../codex-application/CodexApplicationEventHub";
import type { CodexThreadGoalRuntimePromiseAdapter } from "../codex-application/CodexThreadGoalRuntimePromiseAdapter";
import { parseCodexPersonality } from "../codex-application/CodexPersonality";
import type { CodexPreferences } from "../codex-application/CodexPreferences";
import type { CodexPermissionsPromiseAdapter } from "../codex-application/CodexPermissionsPromiseAdapter";
import type { AgentProviderRuntimePromiseAdapter } from "../codex-application/AgentProviderRuntimePromiseAdapter";
import type { ManagedWorktreeRuntime } from "../codex-application/ManagedWorktreeRuntime";
import type { ManagedWorktreeRetentionRuntime } from "../codex-application/ManagedWorktreeRetentionRuntime";
import type {
  ExecutionHost,
  ExecutionHostRuntime,
} from "../codex-application/ExecutionHostRuntime";
import type { CodexSidebarSweepRuntimePromiseAdapter } from "../codex-application/CodexSidebarSweepRuntimePromiseAdapter";
import type { CodexGitProbePromiseAdapter } from "../codex-application/CodexGitProbePromiseAdapter";
import type { CodexHeartbeatTurnCompletionPromiseAdapter } from "../codex-application/CodexHeartbeatTurnCompletionPromiseAdapter";
import type { CodexStructuredThreadTitlePromiseAdapter } from "../codex-application/CodexStructuredThreadTitlePromiseAdapter";
import type { CodexDynamicToolsLaunchPromiseAdapter } from "../codex-application/CodexDynamicToolsLaunchPromiseAdapter";
import type { CodexThreadHandoffRuntime } from "../codex-application/CodexThreadHandoffRuntime";
import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserTransferConsumeInput,
} from "../../shared/codex-fork-browser-transfer";
import { parseAssetSource } from "../../shared/assets";
import {
  getTerminalInteractionBufferKey,
  parseTerminalInteractionInput,
} from "../../shared/codex-terminal-interaction";
import { stripCodexRemarkDirectiveLines } from "../../shared/codex-remark-directives";
import { CODEX_CLIENT_THREAD_ID_PREFIX } from "../../shared/codex-client-thread";
import {
  readCodexSidebarThreadContainerLocation,
  type CodexSidebarThreadMoveInput,
  type CodexSidebarThreadMoveResult,
  type CodexSidebarThreadMoveScope,
} from "../../shared/codex-sidebar-thread-move";
import { buildCodexDelegationInput } from "../../shared/codex-delegation";
import {
  buildCodexPendingWorktreeSetupRepairPrompt,
  buildCodexPendingWorktreeInitItem,
  canCreateCodexPendingWorktreeSetupRepair,
  CODEX_PENDING_WORKTREE_SETUP_REPAIR_LABEL,
  extractCodexUserRequestSection,
  type CodexPendingStartConversationParamsInput,
  type CodexPendingWorktreeCreateInput,
  type CodexPendingWorktreeCreateResult,
  type CodexPendingWorktreeEntry,
  type CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";
import {
  createCodexTextUserInput as createTextUserInput,
  prepareCodexPrompt,
} from "../../shared/codex-prompt-preparation";
import { parseCodexThreadTokenUsage } from "../../shared/schemas/codex";
import {
  PastedTextAttachmentManager,
  ThreadGoalAttachmentDirectoryManager,
} from "../thread-goal-attachments";
import type { CodexAttachments } from "../codex-application/CodexAttachments";
import type { CodexPendingServerRequestRuntimeService } from "../codex-application/CodexPendingServerRequestRuntime";
import type {
  CodexTurnCommandsService,
  CodexTurnStartOverrides,
} from "../codex-application/CodexTurnCommands";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  buildThreadPermissionOverrides,
  buildTurnPermissionOverrides,
} from "./codex-permission-resolver";
import { reconcileCodexThreadTimestamps } from "./codex-thread-timestamps";
import { resolveCodexThreadMaterializationOwner } from "./codex-thread-materialization-owner";
import {
  nodexAgentAuthorityFingerprint,
  type FrozenNodexAgentTurnAuthority,
} from "../../shared/nodex-agent-authority";
import type { NodexAgentResourceIntent } from "../../shared/nodex-agent-resource-access";
import { canAutoApproveNodexAgentWrite, resolveNodexAgentWriteAccess } from "./nodex-agent-access";
import type {
  NodexAgentAuthorityPort,
  NodexAgentTurnAuthorityLaunch,
} from "../nodex-agent-authority-port";
import type { NodexAgentResourceAuthorityPort } from "../nodex-agent-resource-authority-port";
import type { CodexActiveGoalContinuationLegacyPort } from "../codex-application/CodexActiveGoalContinuation";
import type { CodexOwnerNotificationDrainRuntimePromiseAdapter } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import type { CodexRendererConversationRegistryService } from "../codex-application/CodexRendererConversationRegistry";
import type { CodexRendererConversationCoordinatorService } from "../codex-application/CodexRendererConversationCoordinator";
import type {
  CodexSidebarRefreshOutcomeEvent,
  CodexSidebarSyncDecisionEvent,
  CodexSidebarSyncMetadata,
} from "../codex-application/CodexSidebarSyncRuntime";
import type { CodexSidebarSyncRuntimePromiseAdapter } from "../codex-application/CodexSidebarSyncRuntimePromiseAdapter";
import type { CodexUserInputAutoResolutionLegacyPort } from "../codex-application/CodexUserInputAutoResolution";
import {
  buildPlanImplementationRequestId,
  selectPrimaryBackgroundConversationRequest,
} from "../../shared/codex-conversation-request";
import {
  extractCodexThreadSubagentMetadata,
  getCodexSubagentOtherSource,
} from "../../shared/codex-subagent-metadata";
import {
  type CodexNotificationConversationFacts,
  type CodexThreadNotificationEvent,
} from "../../shared/codex-thread-notification";
import { hasCodexPendingContinuation } from "../../shared/codex-turn-notification";
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
  appendCodexCanonicalForkedFromConversationItem,
  appendCodexCanonicalWorktreeInitItem,
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
  type CodexCanonicalLiveTurnParams,
  type CodexCanonicalSteeringUserMessageItem,
  type CodexCanonicalTurnState,
  type CodexCanonicalWorktreeInitItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import {
  appendCodexCanonicalOptimisticFirstTurn,
  bindCodexCanonicalOptimisticTurn,
  failCodexCanonicalOptimisticTurn,
} from "../../shared/codex-conversation-state/codex-optimistic-turn";
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
import {
  REVIEW_DIFF_COMMENTS_ADDITIONAL_CONTEXT_KEY,
  serializeReviewDiffCommentAttachmentsForAdditionalContext,
} from "../../shared/review-diff-comments";
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
import {
  parseCodexReasoningSummary,
  resolveCodexReasoningSummary,
} from "../../shared/codex-reasoning-summary-policy";
import {
  buildCodexConversationSnapshot,
  buildCodexConversationTurn,
} from "./codex-conversation-snapshot";
import { convertImmerPatchesToCodexConversationStateUpdates } from "../../shared/codex-conversation-patches";
import { type CodexThreadStreamReplica } from "../../shared/codex-owner-follower-replication";
import type { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import type { CodexConversationAggregate } from "../codex-application/CodexConversationAggregate";
import {
  buildCollaborationModePayload,
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
  resolveCodexForkChildThreadTitleFromCatalog,
  resolveCodexForkSourceConversationTitle,
  type CodexForkTitleThread,
} from "../../shared/codex-thread-title";
import { getLogger } from "../logging/logger";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { NODEX_APP_TOOL_NAMESPACE } from "../../shared/nodex-agent-tools/identity";
import type { NodexAgentAccess } from "../../shared/nodex-agent-tools/read-runtime";
import { resolveDynamicToolCatalogBindings } from "./codex-dynamic-tool-catalog-bindings";
import type { NodexAgentAuthorizationPresentationTarget } from "../codex-application/NodexAgentAuthorizationRuntime";
import type { NodexAgentAuthorizationRuntimePromiseAdapter } from "../codex-application/NodexAgentAuthorizationRuntimePromiseAdapter";
import {
  buildNodexAgentDynamicToolSpecs,
  type NodexAgentDynamicTools,
} from "../nodex-agent-application/NodexAgentDynamicTools";
import {
  buildCodexAppMetaThreadToolSpecs,
  CODEX_APP_LOCAL_HOST_ID,
} from "./codex-app-meta-thread-tools";
import {
  getCodexClientThreadId,
  listCodexClientThreadIdentities,
  resolveCodexThreadIdForClientThreadId,
  setCodexClientThreadIdentity,
} from "./codex-client-thread-identity";
import type { PersistedAtomStore } from "../local-store/persisted-atoms";
import {
  CODEX_AUTOMATION_DEVELOPER_INSTRUCTIONS,
  buildCodexScheduledAutomationHeartbeatPrompt,
  buildCodexProjectlessThreadInstructions,
  buildCodexScheduledAutomationRunPrompt,
  parseCodexAutomationInboxItemDirective,
  resolveCodexScheduledAutomationModelSettings,
} from "../codex-scheduled-automation-runtime";
import { computeCodexScheduledAutomationIntervalMs } from "../local-store/codex-scheduled-automation-schedule";
import type { DesktopAutomationModulePort } from "../core-client/desktop-automation-module-bridge";
import type { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
  DesktopProjectWorkspaceThreadPatch,
} from "../core-client/project-workspace-adapter";
import { CodexScheduledAutomationRetryError } from "../host-runtime/ScheduledAutomationPolicy";
import {
  buildCodexNewConversationParams,
  parseCodexStoredShellEnvironment,
  type BuildCodexNewConversationParamsInput,
  type CodexStoredShellEnvironment,
} from "./codex-thread-launch-context";
import {
  CODEX_DEFAULT_FEATURE_OVERRIDES,
  buildCodexThreadConfigOverrides,
} from "./codex-thread-capabilities";
import { persistCodexWorktreeShellEnvironment } from "./codex-worktree-shell-environment";
import type {
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerOperation,
} from "./codex-worktree-worker-protocol";
import {
  evaluateCodexThreadHandoffCapability,
  type CodexThreadHandoffCapability,
} from "./codex-thread-handoff-capability";
import {
  normalizeWorktreePathForIdentity,
  resolveWorktreePathComparisonKey,
} from "./codex-managed-worktree-effects";
import { createCodexProjectlessWorkspace } from "./codex-projectless-workspace";
import {
  migrateLegacyCodexProjectlessWorkspace,
  repairCodexProjectlessWorkspace,
} from "./codex-projectless-workspace-repair";
import {
  appendMissingCodexProjectMoveSources,
  listMissingCodexProjectMoveSources,
  resolveCodexProjectlessThreadWorkspaceMove,
  resolveCodexProjectThreadWorkspaceMove,
  type CodexSidebarThreadWorkspaceMove,
  type CodexSidebarThreadWorkspaceState,
} from "./codex-sidebar-thread-move";
import {
  type CodexDynamicCreateModelProjection,
  type CodexDynamicCreateThreadInput,
} from "./codex-dynamic-thread-create";
import type { CodexResolvedDynamicDirectThreadTarget } from "./codex-dynamic-thread-target";
import {
  buildCodexDynamicPendingPermissionSelection,
  resolveCodexDynamicCreatePermissionSelection,
  type CodexDynamicCreatePermissionContext,
  type CodexDynamicCreatePermissionMode,
  type CodexDynamicCreatePermissionSelection,
} from "./codex-dynamic-create-permissions";
import {
  resolveCodexCreateThreadServiceTier,
  type CodexCreateThreadServiceTierSelector,
} from "./codex-dynamic-create-service-tier";
import { expandCodexDynamicCreateConfigProfile } from "./codex-dynamic-create-config";
import {
  augmentCodexDynamicFirstTurnPermissionContext,
  resolveCodexThreadVisualizationDirectory,
} from "./codex-dynamic-first-turn-context";
import type { CodexPendingWorktreeRuntimePromiseAdapter } from "../codex-application/CodexPendingWorktreeRuntimePromiseAdapter";
import type { CodexThreadSettingsRuntimePromiseAdapter } from "../codex-application/CodexThreadSettingsRuntimePromiseAdapter";
import type { CodexThreadTitlePersistencePromiseAdapter } from "../codex-application/CodexThreadTitlePersistencePromiseAdapter";
import type { CodexThreadCatalogPromiseAdapter } from "../codex-application/CodexThreadCatalogPromiseAdapter";
import {
  buildWorkspaceThreadSummary,
  hasSidebarThreadSummaryChanged,
  isInternalThreadSourceValue,
  isNonSidebarThreadWithoutParent,
  normalizeSidebarSessionFallbackTitle,
  parseThreadSourceValue,
  parseThreadStatus,
  resolveSidebarProjectIdForCwd,
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
  allocateCodexPendingWorktreeRequest,
  buildCodexPendingFirstTurnAttachments,
  buildCodexPendingThreadStartConfig,
  projectCodexPendingThreadStart,
  projectCodexPendingWorktreeLaunchLocation,
} from "./codex-pending-worktree-request";
import type { CodexForkSidePanelTransferRuntimePromiseAdapter } from "../codex-application/CodexForkSidePanelTransferRuntimePromiseAdapter";
import { type CodexForkBrowserRuntime } from "./codex-fork-browser-snapshot-adapter";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
} from "../dev-runtime-metrics";

const codexLogger = getLogger({ subsystem: "codex", component: "service" });
const CODEX_SIDEBAR_THREAD_SOURCE_KINDS = [] as const satisfies readonly ThreadSourceKind[];
const AUTO_REVIEW_REVIEWER_PROMPT_PREFIXES = [
  "The following is the Codex agent history",
  "The following is the Codex agent history added since your last approval assessment",
] as const;
const CODEX_HEARTBEAT_ROLLOUT_TAIL_BYTES = 256 * 1024;
const CODEX_HEARTBEAT_TERMINAL_ROLLOUT_EVENTS = new Set([
  "task_complete",
  "response_item",
  "event_msg",
]);
const CODEX_HEARTBEAT_ACTIVE_ROLLOUT_EVENTS = new Set([
  "response_item",
  "event_msg",
  "item",
  "unknown",
]);
const NODEX_AGENT_DYNAMIC_TOOL_SPECS = buildNodexAgentDynamicToolSpecs();

interface ThreadRef {
  projectId: string | null;
  cwd: string | null;
  executionProfile?: AgentExecutionProfile | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
}

interface CodexDynamicDirectConversationLaunchInput {
  readonly clientThreadId?: string;
  readonly createInput: CodexDynamicCreateThreadInput;
  readonly additionalDeveloperInstructions?: string | null;
  readonly baseInstructions?: string | null;
  readonly beforeFirstTurn?: (threadId: string) => Promise<void>;
  readonly firstTurnAdditionalContext?: TurnStartParams["additionalContext"];
  readonly firstTurnAttachments?: readonly CodexLiveFileAttachment[];
  readonly firstTurnCommentAttachments?: readonly CodexReviewDiffCommentAttachment[];
  readonly firstTurnInput?: TurnStartParams["input"];
  readonly initialTitle?: string;
  readonly managedWorktreePath?: string | null;
  readonly memoryPreferences?: CodexThreadStartMemoryPreferences | null;
  readonly modelProjection: CodexDynamicCreateModelProjection;
  readonly executionProfile?: AgentExecutionProfile | null;
  readonly mode?: string;
  readonly onThreadCreated?: (threadId: string) => void;
  readonly permissionSelection: CodexDynamicCreatePermissionSelection | null;
  readonly projectSessionId?: string;
  readonly serviceName?: string;
  readonly serviceTier: string | null;
  readonly sourceThreadId?: string;
  readonly threadSource?: ThreadSource;
  readonly threadStartKind?: string;
  readonly skipAutoTitleGeneration?: boolean;
  readonly target: CodexResolvedDynamicDirectThreadTarget;
  readonly worktreeInit?: CodexCanonicalWorktreeInitItem;
}

interface CodexScheduledAutomationHeartbeatRendererStateContext {
  rendererClientId: string;
  isEligible: boolean;
  reason: string | null;
  updatedAtMs?: number;
}

interface CodexScheduledAutomationHeartbeatRunContext {
  automationsEnabled: boolean;
  rendererState: CodexScheduledAutomationHeartbeatRendererStateContext | null;
  collaborationMode: CodexHeartbeatAutomationCollaborationMode | null;
  permissions: CodexHeartbeatAutomationPermissions | null;
}

interface CodexScheduledAutomationRunContext {
  now?: number;
  reason?: "scheduled" | "run-now";
  leaseId?: string;
  scheduleDispatched?: boolean;
  heartbeat?: CodexScheduledAutomationHeartbeatRunContext;
}

interface SidebarThreadSyncMetadata {
  changedProjectIds: Set<string>;
  projectlessChanged: boolean;
  materializedSessionIds: Set<string>;
  failedThreadIds: Set<string>;
}

interface CodexSidebarSweepState {
  readonly phase: "scan" | "reconcile";
  readonly sweepId: string;
  readonly cursor: string | null;
  readonly archived: boolean;
  readonly includeArchived: boolean;
  readonly projects: readonly Project[];
  readonly reason: CodexSidebarRefreshReason;
  readonly metadata: SidebarThreadSyncMetadata;
}

interface SidebarThreadMaterializationResult {
  summary: CodexThreadSummary | null;
  projectId: string | null;
  projectless: boolean;
  sessionId: string | null;
  materialized: boolean;
  changed: boolean;
  failed: boolean;
  changedProjectIds: Set<string>;
  projectlessChanged: boolean;
}

interface SidebarThreadSessionReconcileResult {
  session: ProjectSession | null;
  materialized: boolean;
  changedProjectIds: Set<string>;
  projectlessChanged: boolean;
}

function createEmptySidebarThreadMaterializationResult(): SidebarThreadMaterializationResult {
  return {
    summary: null,
    projectId: null,
    projectless: false,
    sessionId: null,
    materialized: false,
    changed: false,
    failed: false,
    changedProjectIds: new Set(),
    projectlessChanged: false,
  };
}

function createSidebarThreadSyncMetadata(): SidebarThreadSyncMetadata {
  return {
    changedProjectIds: new Set(),
    projectlessChanged: false,
    materializedSessionIds: new Set(),
    failedThreadIds: new Set(),
  };
}

function projectSidebarThreadSyncMetadata(
  metadata: SidebarThreadSyncMetadata,
): CodexSidebarSyncMetadata {
  return {
    changedProjectIds: [...metadata.changedProjectIds],
    projectlessChanged: metadata.projectlessChanged,
    materializedSessionIds: [...metadata.materializedSessionIds],
    failedThreadIds: [...metadata.failedThreadIds],
  };
}

function markSidebarSyncScopeChanged(
  metadata: Pick<SidebarThreadSyncMetadata, "changedProjectIds" | "projectlessChanged">,
  projectId: string | null | undefined,
): void {
  if (projectId) {
    metadata.changedProjectIds.add(projectId);
    return;
  }
  metadata.projectlessChanged = true;
}

function mergeSidebarThreadMaterialization(
  metadata: SidebarThreadSyncMetadata,
  result: SidebarThreadMaterializationResult,
): void {
  if (!result.summary) return;
  if (result.failed) metadata.failedThreadIds.add(result.summary.threadId);
  if (result.sessionId && result.materialized)
    metadata.materializedSessionIds.add(result.sessionId);

  for (const projectId of result.changedProjectIds) {
    metadata.changedProjectIds.add(projectId);
  }
  if (result.projectlessChanged) metadata.projectlessChanged = true;

  if (!result.changed && !result.materialized) return;
  markSidebarSyncScopeChanged(metadata, result.projectId);
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

type CodexBrowserTransferStateReader = Pick<
  CodexForkBrowserRuntime,
  "getBrowserUseStateSnapshot" | "getStateSnapshot"
>;

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
  nodexAgentDynamicTools: Pick<NodexAgentDynamicTools["Service"], "execute">;
  nodexAgentAuthority: NodexAgentAuthorityPort;
  nodexAgentResourceAuthority: NodexAgentResourceAuthorityPort;
  nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  automationModule: DesktopAutomationModulePort;
  automationRouting: Pick<
    AutomationRoutingIndex["Service"],
    "activeHeartbeatAutomationId" | "runAutomationId"
  >;
  projectWorkspace: DesktopProjectWorkspacePort;
  activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  rendererConversations: CodexRendererConversationRegistryService;
  rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  sidebarSync: CodexSidebarSyncRuntimePromiseAdapter;
  sidebarSweep: CodexSidebarSweepRuntimePromiseAdapter;
  gitProbe: CodexGitProbePromiseAdapter;
  heartbeatTurnCompletion: CodexHeartbeatTurnCompletionPromiseAdapter;
  structuredThreadTitle: CodexStructuredThreadTitlePromiseAdapter;
  dynamicToolsLaunch: CodexDynamicToolsLaunchPromiseAdapter;
  threadHandoffRuntime: CodexThreadHandoffRuntime["Service"];
  pendingWorktrees: CodexPendingWorktreeRuntimePromiseAdapter;
  threadSettingsRuntime: CodexThreadSettingsRuntimePromiseAdapter;
  threadTitlePersistence: CodexThreadTitlePersistencePromiseAdapter;
  threadCatalog: CodexThreadCatalogPromiseAdapter;
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
  managedWorktrees: ManagedWorktreeRuntime["Service"];
  managedWorktreeRetention: ManagedWorktreeRetentionRuntime["Service"];
  browserTransferStateReader?: CodexBrowserTransferStateReader;
  forkSidePanelTransferLifecycle?: CodexForkSidePanelTransferRuntimePromiseAdapter;
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

interface CodexPersistentForkMaterialization {
  readonly detail: CodexThreadDetail;
  readonly summary: CodexThreadSummary | null;
}

interface CodexPersistentForkResult extends CodexPersistentForkMaterialization {
  readonly forkResponse: ThreadForkResponse;
  readonly resolvedCwd: string | null;
  readonly threadId: string;
}

interface CodexAutomationArchiveMessages {
  archivedUserMessage: string | null;
  archivedAssistantMessage: string | null;
}

const THREAD_TURNS_PAGE_SIZE = 5;
const AUTOMATION_ARCHIVE_TURN_CAPTURE_LIMIT = 20;
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
function normalizeAutomationArchiveText(value: string | null | undefined): string | null {
  const trimmed = stripCodexRemarkDirectiveLines(value);
  return trimmed.length > 0 ? trimmed : null;
}

function hasAutomationArchiveMessages(messages: CodexAutomationArchiveMessages): boolean {
  return messages.archivedUserMessage !== null || messages.archivedAssistantMessage !== null;
}

function formatAutomationArchiveAttachment(attachment: CodexUserAttachment): string | null {
  if (attachment.type === "image") {
    return `image: ${attachment.source}`;
  }

  if (attachment.sourceKind === "skill") {
    return `skill: ${attachment.label} (${attachment.path})`;
  }

  return `mention: ${attachment.label} (${attachment.path})`;
}

function readAutomationArchiveContentString(
  candidate: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeNonEmptyString(candidate[key]);
    if (value) return value;
  }
  return null;
}

function formatAutomationArchiveRawContentEntry(entry: unknown): string | null {
  const candidate = asRecord(entry);
  if (!candidate) return null;

  const type = normalizeNonEmptyString(candidate.type);
  if (type === "text") {
    return readAutomationArchiveContentString(candidate, ["text"]);
  }

  if (type === "image") {
    const url = readAutomationArchiveContentString(candidate, ["url", "source"]);
    return url ? `image: ${url}` : null;
  }

  if (type === "localImage") {
    const imagePath = readAutomationArchiveContentString(candidate, ["path", "source"]);
    return imagePath ? `localImage: ${imagePath}` : null;
  }

  if (type === "skill" || type === "mention") {
    const name = readAutomationArchiveContentString(candidate, ["name"]);
    const itemPath = readAutomationArchiveContentString(candidate, ["path"]);
    if (!name || !itemPath) return null;
    return `${type}: ${name} (${itemPath})`;
  }

  return null;
}

function formatAutomationArchiveRawUserMessage(entry: CodexTranscriptEntry): string | null {
  const rawItem = asRecord(entry.rawItem);
  const content = Array.isArray(rawItem?.content) ? rawItem.content : null;
  if (!content) return null;

  const lines = content
    .map((item) => formatAutomationArchiveRawContentEntry(item))
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) return null;
  return lines.join("\n");
}

function formatAutomationArchiveUserMessage(entry: CodexTranscriptEntry): string | null {
  const rawMessage = formatAutomationArchiveRawUserMessage(entry);
  if (rawMessage) return rawMessage;

  const lines: string[] = [];
  const text = normalizeAutomationArchiveText(entry.markdownText);
  if (text) {
    lines.push(text);
  }

  for (const attachment of entry.userAttachments ?? []) {
    const formatted = formatAutomationArchiveAttachment(attachment);
    if (!formatted) continue;
    lines.push(formatted);
  }

  if (lines.length === 0) return null;
  return lines.join("\n");
}

function formatAutomationArchiveProtocolUserMessage(
  item: Extract<ThreadItem, { type: "userMessage" }>,
): string | null {
  const lines = item.content.flatMap((entry): string[] => {
    switch (entry.type) {
      case "text": {
        const text = normalizeNonEmptyString(entry.text);
        return text ? [text] : [];
      }
      case "image":
        return [`image: ${entry.url}`];
      case "localImage":
        return [`localImage: ${entry.path}`];
      case "audio":
        return [`audio: ${entry.url}`];
      case "localAudio":
        return [`localAudio: ${entry.path}`];
      case "skill":
      case "mention":
        return [`${entry.type}: ${entry.name} (${entry.path})`];
    }
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function resolveAutomationArchiveMessagesFromProtocolTurns(
  turns: readonly Turn[],
): CodexAutomationArchiveMessages {
  let archivedUserMessage: string | null = null;
  let archivedAssistantMessage: string | null = null;

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item) continue;

      if (archivedUserMessage === null && item.type === "userMessage") {
        archivedUserMessage = formatAutomationArchiveProtocolUserMessage(item);
      }
      if (archivedAssistantMessage === null && item.type === "agentMessage") {
        archivedAssistantMessage = normalizeAutomationArchiveText(item.text);
      }
      if (archivedUserMessage !== null && archivedAssistantMessage !== null) {
        return { archivedUserMessage, archivedAssistantMessage };
      }
    }
  }

  return { archivedUserMessage, archivedAssistantMessage };
}

const THREAD_START_EXPERIMENTAL_RAW_EVENTS = false;

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

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasRunningAgentState(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  if (record.status === "running") return true;

  const agentStates = asRecord(record.agentsStates);
  if (agentStates && Object.values(agentStates).some(hasRunningAgentState)) {
    return true;
  }

  return hasRunningAgentState(record.action);
}

function hasRunningCollabAgentTranscriptEntry(entries: readonly CodexTranscriptEntry[]): boolean {
  return entries.some((entry) => {
    const toolArgs = asRecord(entry.toolCall?.args);
    if (hasRunningAgentState(toolArgs)) return true;
    const rawItem = asRecord(entry.rawItem);
    if (rawItem?.type !== "collabAgentToolCall" && rawItem?.type !== "collab_agent_tool_call") {
      return false;
    }
    return hasRunningAgentState(rawItem);
  });
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

function parseThreadParentThreadId(thread: Record<string, unknown>): string | null {
  return extractCodexThreadSubagentMetadata(thread).parentThreadId;
}

function isGuardianSubagentSource(source: unknown): boolean {
  return getCodexSubagentOtherSource(source)?.toLowerCase() === "guardian";
}

function isPotentialAutoReviewReviewerPreview(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return AUTO_REVIEW_REVIEWER_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function isConfirmedAutoReviewReviewerMetadata(
  sessionStore: CodexSessionStore,
  threadId: string,
  runtimeStateHome: string,
): boolean {
  const metadata = sessionStore.readThreadMetadata(threadId, runtimeStateHome);
  if (!metadata) return false;
  const threadSource = parseThreadSourceValue(metadata.threadSource);
  return threadSource === "subagent" && isGuardianSubagentSource(metadata.source);
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

function isThreadNotFoundError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("thread not found") ||
    (message.includes("thread") && message.includes("not found"))
  );
}

function isUnsupportedStateDbOnlyThreadListError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("usestatedbonly") &&
    (message.includes("unknown field") ||
      message.includes("invalid params") ||
      message.includes("deserialize") ||
      message.includes("experimentalapi"))
  );
}

function isPathWithinOrEqual(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildHeartbeatPermissionOverrides(
  permissions: CodexHeartbeatAutomationPermissions,
): Pick<TurnStartParams, "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"> {
  return {
    ...(permissions.approvalPolicy ? { approvalPolicy: permissions.approvalPolicy } : {}),
    ...(permissions.approvalsReviewer ? { approvalsReviewer: permissions.approvalsReviewer } : {}),
    ...(permissions.sandboxPolicy ? { sandboxPolicy: permissions.sandboxPolicy } : {}),
  };
}

async function readLatestHeartbeatRolloutEvent(rolloutPath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof openFile>> | null = null;
  try {
    handle = await openFile(rolloutPath, "r");
    const stats = await handle.stat();
    if (stats.size <= 0) return null;

    const bytesToRead = Math.min(stats.size, CODEX_HEARTBEAT_ROLLOUT_TAIL_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, stats.size - bytesToRead);
    const lines = buffer.toString("utf8").split("\n");
    if (stats.size > bytesToRead) lines.shift();

    let latestEvent: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const record = asRecord(parsed);
        const event = typeof record?.event === "string" ? record.event : null;
        if (event && CODEX_HEARTBEAT_TERMINAL_ROLLOUT_EVENTS.has(event)) {
          latestEvent = event;
        }
      } catch {
        continue;
      }
    }

    return latestEvent;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
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

/** Electron retains this app-private sidecar in the raw turn/start JSON payload. */
type CodexAppPrivateTurnStartParams = TurnStartParams & {
  readonly attachments: readonly CodexLiveFileAttachment[];
};

function buildReviewDiffCommentAdditionalContext(
  commentAttachments: readonly CodexReviewDiffCommentAttachment[],
): TurnStartParams["additionalContext"] | undefined {
  if (commentAttachments.length === 0) return undefined;
  return {
    [REVIEW_DIFF_COMMENTS_ADDITIONAL_CONTEXT_KEY]: {
      kind: "application",
      value: serializeReviewDiffCommentAttachmentsForAdditionalContext(commentAttachments),
    },
  };
}

function replaceFirstTextInput(
  inputItems: readonly CodexUserInputItem[],
  text: string,
): CodexUserInputItem[] {
  let replaced = false;
  const nextItems = inputItems.map((item) => {
    if (replaced || item.type !== "text") return item;
    replaced = true;
    return { ...item, text };
  });
  if (!replaced) {
    throw new Error("Pending goal conversation requires a text input");
  }
  return nextItems;
}

interface CodexPendingMaterializedGoal {
  readonly objective: string;
  readonly attachmentDirectory: string | null;
  readonly directoryManager: ThreadGoalAttachmentDirectoryManager;
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

function isUnsupportedThreadSettingsUpdateError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  if (error.code === -32601) return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("method not found") ||
    message.includes("unknown method") ||
    (message.includes("thread/settings/update") && message.includes("unsupported"))
  );
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
  private readonly nodexAgentDynamicTools: CodexServiceOptions["nodexAgentDynamicTools"];
  private readonly runtimeVersion: string | null;
  private readonly desktopTools: DesktopToolRuntimePromiseAdapter;
  private readonly activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  private readonly ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  private readonly rendererConversations: CodexRendererConversationRegistryService;
  private readonly rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  private readonly sidebarSync: CodexSidebarSyncRuntimePromiseAdapter;
  private readonly sidebarSweep: CodexSidebarSweepRuntimePromiseAdapter;
  private readonly gitProbe: CodexGitProbePromiseAdapter;
  private readonly heartbeatTurnCompletion: CodexHeartbeatTurnCompletionPromiseAdapter;
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
  private readonly managedWorktreeLifecycle: ManagedWorktreeRuntime["Service"];
  private readonly managedWorktreeRetention: ManagedWorktreeRetentionRuntime["Service"];
  private readonly threadHandoffRuntime: CodexThreadHandoffRuntime["Service"];
  private readonly browserTransferStateReader: CodexServiceOptions["browserTransferStateReader"];
  private readonly forkSidePanelTransferLifecycle: CodexServiceOptions["forkSidePanelTransferLifecycle"];
  private readonly terminalRuntime: NonNullable<CodexServiceOptions["terminalRuntime"]>;
  private readonly nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  private readonly automationModule: DesktopAutomationModulePort;
  private readonly automationRouting: CodexServiceOptions["automationRouting"];
  private readonly projectWorkspace: DesktopProjectWorkspacePort;
  private readonly workspaceThreadProjectionById = new Map<string, DesktopProjectWorkspaceThread>();
  private readonly nodexAgentAuthorityRegistry: NodexAgentAuthorityPort;
  private readonly nodexAgentResourceAuthority: NodexAgentResourceAuthorityPort;

  private readonly conversationRecords = new Map<string, CodexConversationRecord>();
  private readonly conversationRuntimes: CodexServiceOptions["conversationRuntimes"];
  private readonly pendingWorktreeRuntime: CodexPendingWorktreeRuntimePromiseAdapter;
  private readonly threadSettingsRuntime: CodexThreadSettingsRuntimePromiseAdapter;
  private readonly threadTitlePersistence: CodexThreadTitlePersistencePromiseAdapter;
  private readonly threadCatalog: CodexThreadCatalogPromiseAdapter;
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
  private sidebarUseStateDbOnlyThreadList = true;

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
    this.nodexAgentDynamicTools = options.nodexAgentDynamicTools;
    this.nodexAgentAuthorityRegistry = options.nodexAgentAuthority;
    this.nodexAgentResourceAuthority = options.nodexAgentResourceAuthority;
    this.nodexAgentAuthorization = options.nodexAgentAuthorization;
    this.automationModule = options.automationModule;
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
    this.sidebarSync = options.sidebarSync;
    this.sidebarSweep = options.sidebarSweep;
    this.gitProbe = options.gitProbe;
    this.heartbeatTurnCompletion = options.heartbeatTurnCompletion;
    this.structuredThreadTitle = options.structuredThreadTitle;
    this.dynamicToolsLaunch = options.dynamicToolsLaunch;
    this.threadHandoffRuntime = options.threadHandoffRuntime;
    this.pendingWorktreeRuntime = options.pendingWorktrees;
    this.threadSettingsRuntime = options.threadSettingsRuntime;
    this.threadTitlePersistence = options.threadTitlePersistence;
    this.threadCatalog = options.threadCatalog;
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
    this.managedWorktreeLifecycle = options.managedWorktrees;
    this.managedWorktreeRetention = options.managedWorktreeRetention;
    this.browserTransferStateReader = options?.browserTransferStateReader;
    this.forkSidePanelTransferLifecycle = options?.forkSidePanelTransferLifecycle;
    this.userInputAutoResolution = options.userInputAutoResolution;
    this.client = options.client;
  }

  resolveThreadExecutionHostId(threadId: string): string {
    return (
      this.workspaceThreadProjectionById.get(threadId.trim())?.executionHostId ??
      CODEX_APP_LOCAL_HOST_ID
    );
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

  private async createHeartbeatAutomationForStartedWorktreeThread(input: {
    projectId: string;
    sessionId: string;
    threadId: string;
    heartbeatAutomation?: CodexThreadStartForSessionInput["heartbeatAutomation"];
    emitStartProgress?: boolean;
  }): Promise<"not-requested" | "created" | "failed"> {
    const seed = input.heartbeatAutomation;
    if (!seed) return "not-requested";
    try {
      const automation = await this.automationModule.createDefinition({
        kind: "heartbeat",
        name: seed.name,
        prompt: seed.prompt,
        rrule: seed.rrule,
        targetThreadId: input.threadId,
        model: null,
        reasoningEffort: null,
      });
      this.emitScheduledAutomationChanged({
        automationId: automation.id,
        targetThreadId: automation.targetThreadId,
        reason: "upsert",
      });
      return "created";
    } catch (error) {
      this.logger.warn("Started worktree chat but could not create heartbeat automation", {
        threadId: input.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (input.emitStartProgress !== false) {
        this.emitThreadStartProgress({
          projectId: input.projectId,
          sessionId: input.sessionId,
          runInTarget: "newWorktree",
          threadId: input.threadId,
          phase: "startingThread",
          message: "Started task, but could not create the heartbeat",
          stream: "stderr",
          outputDelta: "[stderr] Started task, but could not create the heartbeat\n",
        });
      }
      return "failed";
    }
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

  private async markAutomationRunAcceptedForUserContinuation(threadId: string): Promise<void> {
    try {
      const updated = await this.automationModule.acceptRun(threadId);
      if (updated) {
        this.notifyAutomationRunThreadUpdated(threadId, "accepted");
      }
    } catch (error) {
      this.logger.warn("Failed to mark scheduled automation run accepted", {
        threadId,
        error,
      });
    }
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

  handleExecutionHostTopologyChanged(): void {
    this.invalidateSidebarSnapshotCache();
  }

  private scheduleManagedWorktreeRetention(): void {
    this.controlPlane.fork(this.managedWorktreeRetention.request);
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

  listPendingWorktrees(): readonly CodexPendingWorktreeEntry[] {
    return this.pendingWorktreeRuntime.list();
  }

  projectPendingWorktreeSnapshot(entries: readonly CodexPendingWorktreeEntry[]): void {
    this.invalidateSidebarSnapshotCache();
    this.applicationEvents.publish({ kind: "pendingWorktreesChanged", value: entries });
  }

  createPendingWorktree(input: CodexPendingWorktreeCreateInput): CodexPendingWorktreeCreateResult {
    const allocated = allocateCodexPendingWorktreeRequest(input);
    this.pendingWorktreeRuntime.create(allocated.request);
    return allocated.result;
  }

  async createPendingWorktreeSetupRepair(
    _hostId: string,
    pendingWorktreeId: string,
    agentMode: CodexAgentMode,
  ): Promise<CodexPendingWorktreeCreateResult> {
    const entry = this.pendingWorktreeRuntime
      .list()
      .find((candidate) => candidate.id === pendingWorktreeId);
    if (!entry || !canCreateCodexPendingWorktreeSetupRepair(entry)) {
      throw new Error(`Pending worktree cannot start setup repair: ${pendingWorktreeId}`);
    }

    const prompt = buildCodexPendingWorktreeSetupRepairPrompt(entry);
    const model =
      entry.launchMode === "start-conversation"
        ? (entry.startConversationParamsInput.collaborationMode?.settings.model ?? null)
        : entry.launchMode === "fork-conversation"
          ? (entry.sourceCollaborationMode?.settings.model ?? null)
          : null;
    const serviceTier = await this.resolveDynamicCreateServiceTier({
      cwd: entry.sourceWorkspaceRoot,
      model,
    });
    const startConversationParamsInput =
      entry.launchMode === "start-conversation"
        ? {
            ...entry.startConversationParamsInput,
            input: [{ type: "text" as const, text: prompt, text_elements: [] }],
            commentAttachments: [],
            workspaceRoots: [...entry.startConversationParamsInput.workspaceRoots],
            cwd: entry.sourceWorkspaceRoot,
            fileAttachments: [],
            addedFiles: [],
            threadSource: "system" as const,
            serviceTier,
          }
        : await this.buildPendingWorktreeSetupRepairStartParams({
            entry,
            prompt,
            serviceTier,
            agentMode,
          });

    return this.createPendingWorktree({
      hostId: entry.hostId,
      label: CODEX_PENDING_WORKTREE_SETUP_REPAIR_LABEL,
      initialThreadTitle: CODEX_PENDING_WORKTREE_SETUP_REPAIR_LABEL,
      sourceWorkspaceRoot: entry.sourceWorkspaceRoot,
      startingState: entry.startingState,
      localEnvironmentConfigPath: null,
      launchMode: "start-conversation",
      prompt,
      startConversationParamsInput,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    });
  }

  private async buildPendingWorktreeSetupRepairStartParams(input: {
    readonly entry: Exclude<
      CodexPendingWorktreeEntry,
      { readonly launchMode: "start-conversation" }
    >;
    readonly prompt: string;
    readonly serviceTier: string | null;
    readonly agentMode: CodexAgentMode;
  }): Promise<CodexPendingStartConversationParamsInput> {
    await this.ensureClientReady();
    const configResult = await this.client.request<"config/read", ConfigReadResponse>(
      "config/read",
      { includeLayers: false, cwd: input.entry.sourceWorkspaceRoot },
    );

    return {
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      commentAttachments: [],
      workspaceRoots: [...input.entry.sourceWorkspaceRoots],
      cwd: input.entry.sourceWorkspaceRoot,
      fileAttachments: [],
      addedFiles: [],
      agentMode: input.agentMode,
      shouldSendPermissionOverrides: true,
      model: null,
      serviceTier: input.serviceTier,
      reasoningEffort: null,
      collaborationMode:
        input.entry.launchMode === "fork-conversation" ? input.entry.sourceCollaborationMode : null,
      config: expandCodexDynamicCreateConfigProfile(configResult.config),
      threadSource: "system",
      workspaceKind: "project",
    };
  }

  retryPendingWorktree(_hostId: string, pendingWorktreeId: string): void {
    this.pendingWorktreeRuntime.retry(pendingWorktreeId);
  }

  async workLocallyFromPendingWorktree(
    _hostId: string,
    pendingWorktreeId: string,
  ): Promise<{ readonly threadId: string }> {
    return await this.pendingWorktreeRuntime.workLocally(pendingWorktreeId);
  }

  continuePendingWorktree(_hostId: string, pendingWorktreeId: string): void {
    this.pendingWorktreeRuntime.continueWithoutSetup(pendingWorktreeId);
  }

  cancelPendingWorktree(_hostId: string, pendingWorktreeId: string): void {
    this.pendingWorktreeRuntime.cancel(pendingWorktreeId);
  }

  dismissPendingWorktree(_hostId: string, pendingWorktreeId: string): void {
    this.pendingWorktreeRuntime.dismiss(pendingWorktreeId);
  }

  renamePendingWorktree(_hostId: string, pendingWorktreeId: string, label: string): void {
    this.pendingWorktreeRuntime.rename(pendingWorktreeId, label);
  }

  setPendingWorktreePinned(_hostId: string, pendingWorktreeId: string, isPinned: boolean): void {
    this.pendingWorktreeRuntime.setPinned(pendingWorktreeId, isPinned);
  }

  setPendingWorktreePinnedBeforeThreadId(
    _hostId: string,
    pendingWorktreeId: string,
    beforeThreadId: string | null,
  ): void {
    this.pendingWorktreeRuntime.setPinnedBeforeThreadId(pendingWorktreeId, beforeThreadId);
  }

  clearPendingWorktreeAttention(_hostId: string, pendingWorktreeId: string): void {
    this.pendingWorktreeRuntime.clearAttention(pendingWorktreeId);
  }

  private async resolveForkBrowserProjectSession(
    conversationId: string,
  ): Promise<ProjectSession | null> {
    const directSession = await this.projectWorkspace.getProjectSession(conversationId);
    if (directSession) return directSession;

    const resolvedThreadId =
      resolveCodexThreadIdForClientThreadId(
        this.persistedAtoms,
        CODEX_APP_LOCAL_HOST_ID,
        conversationId,
      ) ?? conversationId;
    const thread = await this.readWorkspaceThread(resolvedThreadId);
    if (!thread?.sessionId) return null;
    return await this.projectWorkspace.getProjectSession(thread.sessionId);
  }

  async resolveForkBrowserConversationId(conversationId: string): Promise<string> {
    return (
      (await this.resolveForkBrowserProjectSession(conversationId))?.id ??
      getCodexClientThreadId(this.persistedAtoms, CODEX_APP_LOCAL_HOST_ID, conversationId) ??
      conversationId
    );
  }

  async discardPendingForkSidePanelTransfer(pendingWorktreeId: string): Promise<void> {
    await this.forkSidePanelTransferLifecycle?.discardPending(pendingWorktreeId);
  }

  async consumeForkSidePanelTransfer(
    input: CodexForkBrowserTransferConsumeInput,
  ): Promise<CodexForkBrowserSidePanelSnapshot | null> {
    const session = await this.projectWorkspace.getProjectSession(input.targetProjectSessionId);
    if (!session || session.thread?.threadId !== input.targetConversationId) {
      throw new Error("Target project session does not own the conversation");
    }
    return (await this.forkSidePanelTransferLifecycle?.consumeTarget(input)) ?? null;
  }

  private assertLocalPendingWorktreeHost(hostId: string): void {
    if (hostId === CODEX_APP_LOCAL_HOST_ID) return;
    throw new Error(`Local environment host is unavailable: ${hostId}`);
  }

  resolvePendingWorktreeThread(
    clientThreadId: string,
  ): CodexPendingWorktreeThreadResolution | null {
    const pendingResolution = this.pendingWorktreeRuntime.resolveThread(clientThreadId);
    const threadId = resolveCodexThreadIdForClientThreadId(
      this.persistedAtoms,
      CODEX_APP_LOCAL_HOST_ID,
      clientThreadId,
    );
    if (threadId) return { state: "succeeded", clientThreadId, threadId };
    return pendingResolution;
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

  /** Effect Module projection operation; callers use CodexThreadCatalog. */
  readThreadCatalogProjection(threadId: string): DesktopProjectWorkspaceThread | null {
    return this.workspaceThreadProjectionById.get(threadId) ?? null;
  }

  /** Effect Module policy projection; callers use CodexThreadCatalog.ensureSession. */
  shouldHideThreadForCatalog(summary: CodexThreadSummary): boolean {
    return this.shouldHidePersistedNonSidebarThread(summary);
  }

  /** Effect Module projection operation; callers use CodexThreadCatalog.ensureSession. */
  async hideThreadForCatalog(threadId: string): Promise<void> {
    await this.hideNonSidebarThreadMaterialization(threadId, "manual");
  }

  /** Temporary synchronous projection seam for application Modules committing Core Threads. */
  projectWorkspaceThreadFromModule(thread: DesktopProjectWorkspaceThread): void {
    this.rememberWorkspaceThread(thread);
  }

  /** Effect Module adapter operation; materializes the first app-server window. */
  async refreshSidebarThreadsForSync(input: {
    includeArchived: boolean;
    reason: CodexSidebarRefreshReason;
  }): Promise<CodexSidebarSyncMetadata> {
    return projectSidebarThreadSyncMetadata(await this.refreshSidebarThreadsFromAppServer(input));
  }

  /** Effect Module adapter operation; emits an already policy-approved projection. */
  emitSidebarSyncUpdated(result: CodexSidebarSyncResult, reason: CodexSidebarRefreshReason): void {
    logDevRuntimeMetric("codex.sidebar.sync_updated_emit", {
      emitted: true,
      reason,
      source: result.source,
      refreshed: result.refreshed,
      itemCount: result.snapshot.items.length,
      changedProjectCount: result.changedProjectIds.length,
      projectlessChanged: result.projectlessChanged,
      materializedSessionCount: result.materializedSessionIds.length,
      failedThreadCount: result.failedThreadIds.length,
      approxPayloadBytes: approximateJsonPayloadBytes(result),
    });
    this.emitHostMessage({
      type: "sidebarSyncUpdated",
      hostId: DEFAULT_CODEX_HOST_ID,
      result,
      reason,
    });
  }

  private invalidateSidebarSnapshotCache(): void {
    this.sidebarSync.invalidate();
  }

  recordSidebarSyncDecision(event: CodexSidebarSyncDecisionEvent): void {
    const result = event.result;
    logDevRuntimeMetric("codex.sidebar.sync", {
      decision: event.decision,
      policy: event.policy,
      reason: event.reason,
      includeArchived: event.includeArchived,
      source: result.source,
      refreshed: result.refreshed,
      itemCount: result.snapshot.items.length,
      changedProjectCount: result.changedProjectIds.length,
      projectlessChanged: result.projectlessChanged,
      materializedSessionCount: result.materializedSessionIds.length,
      failedThreadCount: result.failedThreadIds.length,
      approxPayloadBytes: approximateJsonPayloadBytes(result),
      durationMs: event.durationMs,
      cacheAgeMs: event.cacheAgeMs,
      backoffRemainingMs: event.backoffRemainingMs,
    });
  }

  recordSidebarRefreshOutcome(event: CodexSidebarRefreshOutcomeEvent): void {
    const result = event.result;
    if (event.outcome === "error") {
      this.logger.warn("Could not sync sidebar threads from app-server", {
        reason: event.reason,
        error: event.error instanceof Error ? event.error.message : String(event.error),
      });
    }
    logDevRuntimeMetric("codex.sidebar.refresh", {
      outcome: event.outcome,
      reason: event.reason,
      includeArchived: event.includeArchived,
      ...(event.error
        ? { error: event.error instanceof Error ? event.error.message : String(event.error) }
        : {}),
      ...(event.nextBackoffMs === undefined ? {} : { nextBackoffMs: event.nextBackoffMs }),
      itemCount: result?.snapshot.items.length,
      changedProjectCount: result?.changedProjectIds.length,
      projectlessChanged: result?.projectlessChanged,
      materializedSessionCount: result?.materializedSessionIds.length,
      failedThreadCount: result?.failedThreadIds.length,
      approxPayloadBytes: result ? approximateJsonPayloadBytes(result) : null,
      durationMs: event.durationMs,
    });
  }

  /** Effect Module adapter operation; builds a snapshot at the supplied revision fence. */
  async buildBoundedWorkspaceSidebarSnapshot(
    includeArchived: boolean,
    revisionAtStart: number,
  ): Promise<CodexSidebarSnapshot> {
    const overview = await this.projectWorkspace.readSidebarOverview(includeArchived);
    const tasks = overview.items.filter(
      (
        task,
      ): task is ProjectSessionSummary & {
        thread: NonNullable<ProjectSessionSummary["thread"]>;
      } => task.thread !== null && !task.thread.parentThreadId,
    );
    const clientThreadIdByThreadId = new Map(
      listCodexClientThreadIdentities(
        this.persistedAtoms,
        CODEX_APP_LOCAL_HOST_ID,
        tasks.map((task) => task.thread.threadId),
      ).map(({ threadId, clientThreadId }) => [threadId, clientThreadId] as const),
    );
    const hostDisplayNameById = new Map(
      (await this.controlPlane.runPromise(this.executionHosts.hosts())).map((host) => [
        host.hostId,
        host.displayName,
      ]),
    );
    const projectAssignments: Record<string, string> = {};
    const projectlessThreadIds: string[] = [];
    const items = tasks.map((task): CodexSidebarThreadItem => {
      const thread = task.thread;
      const hostId = thread.executionHostId || DEFAULT_CODEX_HOST_ID;
      const isLocalHost = hostId === CODEX_APP_LOCAL_HOST_ID;
      const hostDisplayName = hostDisplayNameById.get(hostId) ?? hostId;
      const managedWorktreePath = thread.managedWorktreePath ?? null;
      const projectId = task.projectId ?? thread.projectId;
      if (projectId) projectAssignments[thread.threadId] = projectId;
      else projectlessThreadIds.push(thread.threadId);
      const clientThreadId = clientThreadIdByThreadId.get(thread.threadId) ?? null;
      return {
        key: `${isLocalHost ? "local" : "remote"}:${clientThreadId ?? thread.threadId}`,
        kind: isLocalHost ? "local" : "remote",
        runLocation: managedWorktreePath
          ? isLocalHost
            ? { kind: "local-worktree", path: managedWorktreePath, phase: "ready" }
            : {
                kind: "remote-worktree",
                hostId,
                hostDisplayName,
                path: managedWorktreePath,
                phase: "ready",
              }
          : isLocalHost
            ? { kind: "local-checkout" }
            : { kind: "remote-checkout", hostId, hostDisplayName },
        ...(clientThreadId ? { clientThreadId } : {}),
        hostId,
        threadId: thread.threadId,
        parentThreadId: thread.parentThreadId ?? null,
        sessionId: task.id,
        projectId,
        title: task.displayTitle,
        preview: thread.threadPreview,
        cwd: thread.cwd ?? null,
        updatedAt: thread.updatedAt,
        recencyAt: thread.recencyAt ?? null,
        createdAt: thread.createdAt,
        pinned: task.pinned,
        pinnedOrder: task.pinnedOrder,
        unread: task.unread,
        archived: task.archived || thread.archived,
        statusType: thread.statusType,
        statusActiveFlags: [...thread.statusActiveFlags],
        projectless: projectId === null,
        disabled: false,
      };
    });
    const snapshot: CodexSidebarSnapshot = {
      items,
      pinnedThreadIds: items.map((item) => item.threadId),
      projectAssignments,
      projectlessThreadIds,
      revision: revisionAtStart,
      generatedAt: Date.now(),
    };
    return snapshot;
  }

  private async buildSidebarThreadMoveScope(
    projectId: string | null,
  ): Promise<CodexSidebarThreadMoveScope> {
    return { projectId };
  }

  private async buildSidebarThreadMoveSuccess(input: {
    threadId: string;
    sourceProjectId: string | null;
    targetProjectId: string | null;
    operationId: string;
    projectionRevision: number;
  }): Promise<CodexSidebarThreadMoveResult> {
    return {
      status: "moved",
      threadId: input.threadId,
      source: await this.buildSidebarThreadMoveScope(input.sourceProjectId),
      destination: await this.buildSidebarThreadMoveScope(input.targetProjectId),
      operationId: input.operationId,
      projectionRevision: input.projectionRevision,
    };
  }

  private assertSidebarThreadMoveSource(input: {
    sourceContainerId: CodexSidebarThreadMoveInput["sourceContainerId"];
    sourceProjectId: string | null;
    pinned: boolean;
  }): void {
    const sourceLocation = readCodexSidebarThreadContainerLocation(input.sourceContainerId);
    if (sourceLocation === null) {
      throw new Error(`Unsupported local sidebar task source: ${input.sourceContainerId}`);
    }
    if (sourceLocation.projectId !== input.sourceProjectId) {
      throw new Error("Sidebar task source project changed during drag");
    }
    if (sourceLocation.pinned !== input.pinned) {
      throw new Error("Sidebar task pin lane changed during drag");
    }
  }

  private async syncLoadedSidebarThreadWorkspaceMove(input: {
    threadId: string;
    wasLoaded: boolean;
    previous: CodexSidebarThreadWorkspaceState;
    move: CodexSidebarThreadWorkspaceMove;
  }): Promise<void> {
    if (!input.wasLoaded) return;
    if (input.previous.cwd === input.move.next.cwd) return;
    if (this.threadSettingsRuntime.remoteUpdateSupport() === "unsupported") return;
    try {
      await this.ensureClientReady();
      await this.client.request<"thread/settings/update", ThreadSettingsUpdateResponse>(
        "thread/settings/update",
        {
          threadId: input.threadId,
          cwd: input.move.next.cwd,
        },
      );
      this.threadSettingsRuntime.recordRemoteUpdateSupported();
    } catch (error) {
      if (isUnsupportedThreadSettingsUpdateError(error)) {
        this.threadSettingsRuntime.recordRemoteUpdateUnsupported();
        this.logger.warn(
          "Codex app-server does not support workspace updates for loaded sidebar tasks",
          { threadId: input.threadId },
        );
        return;
      }
      if (isThreadNotFoundError(error)) {
        this.logger.info(
          "Sidebar task unloaded before its runtime workspace could be synchronized",
          { threadId: input.threadId },
        );
        return;
      }
      this.logger.warn("Could not synchronize the loaded task workspace after moving it", {
        threadId: input.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private applySidebarThreadWorkspaceMoveToRecord(input: {
    threadId: string;
    targetProjectId: string | null;
    move: CodexSidebarThreadWorkspaceMove;
  }): void {
    const record = this.conversationRecords.get(input.threadId);
    if (!record) return;

    if (record.detail) {
      record.detail = {
        ...record.detail,
        projectId: input.targetProjectId,
        cwd: input.move.next.cwd,
        managedWorktreePath: input.move.next.managedWorktreePath,
        projectlessOutputDirectory: input.move.next.projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot: input.move.next.projectlessWorkspaceBrowserRoot,
      };
    }
    const canonical = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = canonical?.sidecar.hydrationContext ?? null;
    if (canonical && hydrationContext) {
      this.acceptCanonicalConversationState(input.threadId, {
        ...canonical,
        sidecar: {
          ...canonical.sidecar,
          hydrationContext: {
            ...hydrationContext,
            cwd: input.move.next.cwd,
            latestThreadSettings: {
              ...(hydrationContext.latestThreadSettings ?? {}),
              cwd: input.move.next.cwd,
            },
            currentPermissions: {
              ...hydrationContext.currentPermissions,
              runtimeWorkspaceRoots: [...input.move.runtimeWorkspaceRoots],
            },
          },
        },
      });
    }
    this.syncAcceptedConversationDocument(input.threadId, { syncDetail: true });
  }

  /** Effect Module projection operation; callers use CodexThreadCatalog.move. */
  async applySidebarThreadMove(
    input: CodexSidebarThreadMoveInput,
  ): Promise<CodexSidebarThreadMoveResult> {
    const threadId = input.threadId.trim();
    let workspaceThread = await this.readWorkspaceThread(threadId);
    if (!workspaceThread) throw new Error(`Task not found: ${threadId}`);

    const sourceProjectId = workspaceThread.projectId;
    const pinned = workspaceThread.pinnedOrder !== null;
    this.assertSidebarThreadMoveSource({
      sourceContainerId: input.sourceContainerId,
      sourceProjectId,
      pinned,
    });

    const targetLocation = readCodexSidebarThreadContainerLocation(input.targetContainerId);
    if (targetLocation === null) {
      throw new Error(`Unsupported local sidebar task target: ${input.targetContainerId}`);
    }
    const targetProjectId = targetLocation.projectId;
    if (input.projectAccessGrant && input.projectAccessGrant.targetProjectId !== targetProjectId) {
      throw new Error("Sidebar task Project access grant does not match its target");
    }
    if (targetProjectId === sourceProjectId && input.projectAccessGrant) {
      throw new Error("Sidebar task Project access grant requires a cross-Project move");
    }

    const [sourceProject, targetProject] = await Promise.all([
      sourceProjectId === null
        ? Promise.resolve(null)
        : this.projectWorkspace.getProject(sourceProjectId),
      targetProjectId === null
        ? Promise.resolve(null)
        : this.projectWorkspace.getProject(targetProjectId),
    ]);
    if (targetProjectId !== null && !targetProject) {
      throw new Error(`Project not found: ${targetProjectId}`);
    }
    if (sourceProjectId !== null && !sourceProject) {
      throw new Error(`Project not found: ${sourceProjectId}`);
    }
    const missingProjectSources =
      targetProject === null
        ? []
        : listMissingCodexProjectMoveSources(sourceProject, targetProject);
    let targetProjectForMove = targetProject;
    let projectAccessGrant:
      | NonNullable<Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]["projectAccessGrant"]>
      | undefined;
    if (missingProjectSources.length > 0) {
      if (!targetProject || targetProjectId === null) {
        throw new Error("Target Project is unavailable during access confirmation");
      }
      const grant = input.projectAccessGrant;
      const grantMatches =
        grant !== undefined &&
        grant.targetProjectId === targetProjectId &&
        grant.expectedBindingRevision === targetProject.bindingRevision &&
        grant.missingProjectSources.length === missingProjectSources.length &&
        grant.missingProjectSources.every((root, index) => root === missingProjectSources[index]);
      if (!grantMatches) {
        return {
          status: "confirmation-required",
          reason: "target-project-needs-source-access",
          threadId,
          targetProjectId,
          targetBindingRevision: targetProject.bindingRevision,
          missingProjectSources,
          targetProjectName: targetProject.name,
        };
      }
      targetProjectForMove = appendMissingCodexProjectMoveSources(
        targetProject,
        missingProjectSources,
      );
      projectAccessGrant = {
        expectedTargetBindingRevision: targetProject.bindingRevision,
        missingProjectSources,
      };
    }

    workspaceThread = await this.readWorkspaceThread(threadId);
    if (!workspaceThread || workspaceThread.projectId !== sourceProjectId) {
      throw new Error("Sidebar task source project changed during move preparation");
    }
    const summary = this.buildWorkspaceThreadSummary(workspaceThread);

    const previousWorkspace: CodexSidebarThreadWorkspaceState = {
      cwd: summary.cwd,
      managedWorktreePath: summary.managedWorktreePath ?? null,
      projectlessOutputDirectory: summary.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: summary.projectlessWorkspaceBrowserRoot ?? null,
    };
    const workspaceMove =
      sourceProjectId === targetProjectId
        ? {
            next: previousWorkspace,
            runtimeWorkspaceRoots: await this.readThreadWritableRoots(threadId),
          }
        : targetProjectForMove
          ? await resolveCodexProjectThreadWorkspaceMove({
              current: previousWorkspace,
              targetProject: targetProjectForMove,
              threadTitle: summary.threadName ?? summary.threadPreview ?? threadId,
              createProjectlessWorkspace: async (workspaceInput) =>
                await createCodexProjectlessWorkspace(workspaceInput),
            })
          : resolveCodexProjectlessThreadWorkspaceMove({
              current: previousWorkspace,
              persistedRuntimeWorkspaceRoots: await this.readThreadWritableRoots(threadId),
            });
    const moved = await this.projectWorkspace.moveThread({
      threadId,
      sourceProjectId,
      targetProjectId,
      ...(sourceProjectId === targetProjectId
        ? {}
        : { runtimeWorkspaceRoots: workspaceMove.runtimeWorkspaceRoots }),
      ...(projectAccessGrant === undefined ? {} : { projectAccessGrant }),
      ...(targetLocation.pinned
        ? {
            useDefaultOrder: true,
          }
        : {
            beforeThreadId: input.beforeThreadId,
            ...(input.afterThreadId === undefined ? {} : { afterThreadId: input.afterThreadId }),
            ...(input.insertAtEnd ? { insertAtEnd: true } : {}),
            ...(input.useDefaultOrder ? { useDefaultOrder: true } : {}),
          }),
      ...(sourceProjectId === targetProjectId
        ? {}
        : {
            metadata: {
              cwd: workspaceMove.next.cwd,
              managedWorktreePath: workspaceMove.next.managedWorktreePath,
              projectlessOutputDirectory: workspaceMove.next.projectlessOutputDirectory,
              projectlessWorkspaceBrowserRoot: workspaceMove.next.projectlessWorkspaceBrowserRoot,
            },
          }),
    });
    this.rememberWorkspaceThread(moved.thread);

    await this.syncLoadedSidebarThreadWorkspaceMove({
      threadId,
      wasLoaded: workspaceThread.statusType !== "notLoaded",
      previous: previousWorkspace,
      move: workspaceMove,
    });
    if (pinned || targetLocation.pinned) {
      try {
        this.rememberWorkspaceSidebar(
          await this.projectWorkspace.setThreadPinned(
            threadId,
            targetLocation.pinned,
            targetLocation.pinned ? (input.beforeThreadId ?? null) : undefined,
          ),
        );
      } catch (error) {
        this.logger.warn("Failed to save sidebar pin state after moving task", {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.applySidebarThreadWorkspaceMoveToRecord({
      threadId,
      targetProjectId,
      move: workspaceMove,
    });

    const metadata = createSidebarThreadSyncMetadata();
    markSidebarSyncScopeChanged(metadata, sourceProjectId);
    markSidebarSyncScopeChanged(metadata, targetProjectId);
    await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "session-change");
    return await this.buildSidebarThreadMoveSuccess({
      threadId,
      sourceProjectId,
      targetProjectId,
      operationId: moved.operationId,
      projectionRevision: moved.projectionRevision,
    });
  }

  private async retireChildSidebarSession(thread: DesktopProjectWorkspaceThread): Promise<void> {
    if (!thread.parentThreadId || !thread.sessionId) return;
    const repaired = await this.projectWorkspace.updateThread(thread.threadId, {
      parentThreadId: thread.parentThreadId,
    });
    if (!repaired) {
      throw new Error(`Child Thread '${thread.threadId}' disappeared during sidebar repair`);
    }
    this.invalidateSidebarSnapshotCache();
  }

  private async refreshSidebarThreadsFromAppServer(input: {
    includeArchived: boolean;
    reason: CodexSidebarRefreshReason;
  }): Promise<SidebarThreadSyncMetadata> {
    const startedAt = getDevRuntimeMetricStart();
    await this.ensureClientReady();
    await this.sidebarSweep.cancel();

    const projects = await this.projectWorkspace.listProjects();
    const metadata = createSidebarThreadSyncMetadata();
    const sweepId = randomUUID();

    try {
      const response = await this.requestSidebarThreadList({
        cursor: null,
        archived: false,
      });
      const observedThreadIds = await this.materializeSidebarThreadListWindow(response, {
        projects,
        includeArchived: input.includeArchived,
        reason: input.reason,
        metadata,
      });
      if (observedThreadIds.length > 0) {
        await this.projectWorkspace.observeAppServerThreadWindow(sweepId, observedThreadIds);
      }
      const continuation: CodexSidebarSweepState = {
        phase: "scan",
        sweepId,
        cursor: response.nextCursor,
        archived: response.nextCursor === null,
        includeArchived: input.includeArchived,
        projects,
        reason: input.reason,
        metadata,
      };
      await this.sidebarSweep.start(continuation, (state) => this.advanceSidebarThreadSweep(state));

      logDevRuntimeMetric("codex.sidebar.refresh_thread_list", {
        outcome: "success",
        reason: input.reason,
        includeArchived: input.includeArchived,
        projectCount: projects.length,
        pageCount: 1,
        threadCount: response.data.length,
        continuationScheduled: true,
        changedProjectCount: metadata.changedProjectIds.size,
        projectlessChanged: metadata.projectlessChanged,
        materializedSessionCount: metadata.materializedSessionIds.size,
        failedThreadCount: metadata.failedThreadIds.size,
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      return metadata;
    } catch (error) {
      logDevRuntimeMetric("codex.sidebar.refresh_thread_list", {
        outcome: "error",
        reason: input.reason,
        includeArchived: input.includeArchived,
        projectCount: projects.length,
        error: error instanceof Error ? error.message : String(error),
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      throw error;
    }
  }

  private async materializeSidebarThreadListWindow(
    response: ThreadListResponse,
    input: {
      projects: readonly Project[];
      includeArchived: boolean;
      reason: CodexSidebarRefreshReason;
      metadata: SidebarThreadSyncMetadata;
    },
  ): Promise<string[]> {
    const observedThreadIds: string[] = [];
    for (const thread of response.data) {
      const result = await this.upsertSidebarThreadFromAppServerThread(thread, {
        projects: input.projects,
        includeArchived: input.includeArchived,
        reason: input.reason,
      });
      mergeSidebarThreadMaterialization(input.metadata, result);
      if (result.summary && !result.summary.source?.parentThreadId) {
        observedThreadIds.push(result.summary.threadId);
      }
    }
    return observedThreadIds;
  }

  private async advanceSidebarThreadSweep(
    state: CodexSidebarSweepState,
  ): Promise<CodexSidebarSweepState | null> {
    if (state.phase === "reconcile") {
      const reconciled = await this.projectWorkspace.reconcileAppServerThreadSweep(
        state.sweepId,
        100,
      );
      for (const projectId of reconciled.projectIds) {
        markSidebarSyncScopeChanged(state.metadata, projectId);
      }
      if (reconciled.threadIds.length > 0) {
        state.metadata.projectlessChanged = true;
      }
      if (reconciled.threadIds.length === 100) return state;

      await this.sidebarSync.publish({
        includeArchived: state.includeArchived,
        source: "app-server",
        refreshed: true,
        refreshedAt: Date.now(),
        metadata: projectSidebarThreadSyncMetadata(state.metadata),
        reason: state.reason,
      });
      return null;
    }

    const response = await this.requestSidebarThreadList({
      cursor: state.cursor,
      archived: state.archived,
    });
    const observedThreadIds = await this.materializeSidebarThreadListWindow(response, state);
    if (observedThreadIds.length > 0) {
      await this.projectWorkspace.observeAppServerThreadWindow(state.sweepId, observedThreadIds);
    }
    if (response.nextCursor) {
      return { ...state, cursor: response.nextCursor };
    }
    if (!state.archived) {
      return { ...state, cursor: null, archived: true };
    }
    return { ...state, phase: "reconcile", cursor: null };
  }

  private async requestSidebarThreadList(input: {
    cursor: string | null;
    archived: boolean;
  }): Promise<ThreadListResponse> {
    const startedAt = getDevRuntimeMetricStart();
    const createParams = (useStateDbOnly: boolean): ThreadListParams => ({
      cursor: input.cursor,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      modelProviders: null,
      sourceKinds: [...CODEX_SIDEBAR_THREAD_SOURCE_KINDS],
      archived: input.archived,
      ...(useStateDbOnly ? { useStateDbOnly: true } : {}),
    });

    try {
      const useStateDbOnly = this.sidebarUseStateDbOnlyThreadList;
      const response = await this.client.request<"thread/list", ThreadListResponse>(
        "thread/list",
        createParams(useStateDbOnly),
      );
      logDevRuntimeMetric("codex.sidebar.thread_list.page", {
        outcome: "success",
        archived: input.archived,
        cursorPresent: input.cursor !== null,
        useStateDbOnly,
        rowCount: response.data.length,
        hasNextCursor: response.nextCursor !== null,
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      return response;
    } catch (error) {
      if (
        !this.sidebarUseStateDbOnlyThreadList ||
        !isUnsupportedStateDbOnlyThreadListError(error)
      ) {
        logDevRuntimeMetric("codex.sidebar.thread_list.page", {
          outcome: "error",
          archived: input.archived,
          cursorPresent: input.cursor !== null,
          useStateDbOnly: this.sidebarUseStateDbOnlyThreadList,
          error: error instanceof Error ? error.message : String(error),
          durationMs: getDevRuntimeMetricDurationMs(startedAt),
        });
        throw error;
      }

      this.sidebarUseStateDbOnlyThreadList = false;
      this.logger.warn(
        "Codex app-server does not support state DB thread listing; falling back to rollout scan",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      const response = await this.client.request<"thread/list", ThreadListResponse>(
        "thread/list",
        createParams(false),
      );
      logDevRuntimeMetric("codex.sidebar.thread_list.page", {
        outcome: "fallback-success",
        archived: input.archived,
        cursorPresent: input.cursor !== null,
        useStateDbOnly: false,
        rowCount: response.data.length,
        hasNextCursor: response.nextCursor !== null,
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      return response;
    }
  }

  private async upsertSidebarThreadFromAppServerThread(
    thread: unknown,
    input: {
      projects: readonly Project[];
      includeArchived: boolean;
      reason: CodexSidebarRefreshReason;
    },
  ): Promise<SidebarThreadMaterializationResult> {
    const empty = createEmptySidebarThreadMaterializationResult();
    if (typeof thread !== "object" || thread === null) return empty;

    const candidate = thread as Record<string, unknown>;
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) return empty;
    if (candidate.ephemeral === true) return empty;

    const cwd = typeof candidate.cwd === "string" ? candidate.cwd : null;
    const parentThreadId = parseThreadParentThreadId(candidate);
    if (parentThreadId) {
      const previousThread = await this.readWorkspaceThread(candidate.id);
      const previousSummary = previousThread
        ? this.buildWorkspaceThreadSummary(previousThread)
        : null;
      const summary = await this.upsertBackgroundSubagentThreadFromAppServerThread(
        candidate,
        parentThreadId,
        cwd,
      );
      return {
        ...empty,
        summary,
        projectId: summary?.projectId ?? null,
        changed: summary ? hasSidebarThreadSummaryChanged(previousSummary, summary) : false,
      };
    }
    if (isNonSidebarThreadWithoutParent(candidate)) {
      return this.hideNonSidebarThreadMaterialization(candidate.id, input.reason);
    }

    const previousThread = await this.readWorkspaceThread(candidate.id);
    const previousSummary = previousThread
      ? this.buildWorkspaceThreadSummary(previousThread)
      : null;
    const inferredProjectId = resolveSidebarProjectIdForCwd(
      cwd,
      input.projects,
      this.foldSidebarPathCase,
    );
    const projectId = resolveCodexThreadMaterializationOwner({
      existingThreadFound: previousThread !== null,
      existingProjectId: previousThread?.projectId ?? null,
      explicitInitialOwnerProvided: false,
      explicitInitialProjectId: null,
      inferredInitialProjectId: inferredProjectId,
    });
    const summary = await this.upsertLinkFromThread(thread, { projectId, cwd }, cwd);
    if (!summary) return empty;
    const changed = hasSidebarThreadSummaryChanged(previousSummary, summary);
    if (!input.includeArchived && summary.archived) {
      return {
        ...empty,
        summary,
        projectId: summary.projectId,
        projectless: summary.projectId === null,
        changed,
      };
    }
    if (summary.ephemeral || summary.source?.sideConversation) {
      return {
        ...empty,
        summary,
        projectId: summary.projectId,
        projectless: summary.projectId === null,
        changed,
      };
    }

    try {
      const sessionResult = await this.reconcileSidebarThreadSession(summary);
      if (previousSummary?.projectId !== summary.projectId) {
        markSidebarSyncScopeChanged(sessionResult, previousSummary?.projectId ?? null);
        markSidebarSyncScopeChanged(sessionResult, summary.projectId);
      }
      const sessionId =
        sessionResult.session?.id ??
        (await this.readWorkspaceThread(summary.threadId))?.sessionId ??
        null;
      return {
        summary,
        projectId: summary.projectId,
        projectless: summary.projectId === null,
        sessionId,
        materialized: sessionResult.materialized,
        changed,
        failed: false,
        changedProjectIds: sessionResult.changedProjectIds,
        projectlessChanged: sessionResult.projectlessChanged,
      };
    } catch (error) {
      const existingThread = await this.readWorkspaceThread(summary.threadId);
      this.logger.warn("Could not materialize sidebar thread session", {
        reason: input.reason,
        threadId: summary.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        summary,
        projectId: summary.projectId,
        projectless: summary.projectId === null,
        sessionId: existingThread?.sessionId ?? null,
        materialized: false,
        changed,
        failed: true,
        changedProjectIds: new Set(),
        projectlessChanged: false,
      };
    }
  }

  private async hideNonSidebarThreadMaterialization(
    threadId: string,
    reason: CodexSidebarRefreshReason,
  ): Promise<SidebarThreadMaterializationResult> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return createEmptySidebarThreadMaterializationResult();

    const previous = await this.readWorkspaceThread(normalizedThreadId);
    if (!previous) return createEmptySidebarThreadMaterializationResult();

    const previousSummary = this.buildWorkspaceThreadSummary(previous);
    const changedProjectIds = new Set<string>();
    let projectlessChanged = previous.projectId === null;
    if (previous.projectId) changedProjectIds.add(previous.projectId);

    const owner = previous.sessionId
      ? await this.projectWorkspace.getProjectSession(previous.sessionId)
      : null;
    await this.projectWorkspace.setThreadArchived(normalizedThreadId, true);
    const detached = previous.sessionId
      ? await this.projectWorkspace.detachProjectSessionThread(previous.sessionId)
      : false;
    const archived = await this.readWorkspaceThread(normalizedThreadId);
    const archivedSummary = archived
      ? this.buildWorkspaceThreadSummary(archived, {
          archived: true,
          hasUnreadTurn: false,
          pinnedOrder: null,
        })
      : previousSummary;
    const changed =
      !previous.archived || previous.pinnedOrder !== null || previous.hasUnreadTurn || detached;
    if (owner?.projectId) {
      changedProjectIds.add(owner.projectId);
    } else if (owner) {
      projectlessChanged = true;
    }

    if (changed) {
      this.invalidateSidebarSnapshotCache();
      this.logger.info("Hid non-sidebar Codex thread from sidebar materialization", {
        threadId: normalizedThreadId,
        reason,
        ownerCount: owner ? 1 : 0,
      });
    }

    return {
      ...createEmptySidebarThreadMaterializationResult(),
      summary: archivedSummary,
      projectId: archivedSummary.projectId,
      projectless: archivedSummary.projectId === null,
      changed,
      changedProjectIds,
      projectlessChanged,
    };
  }

  private shouldHidePersistedNonSidebarThread(summary: CodexThreadSummary): boolean {
    if (summary.source?.parentThreadId) return false;

    const threadSource = parseThreadSourceValue(summary.threadSource);
    if (isInternalThreadSourceValue(threadSource)) return true;
    if (!isPotentialAutoReviewReviewerPreview(summary.threadPreview)) return false;
    return isConfirmedAutoReviewReviewerMetadata(
      this.sessionStore,
      summary.threadId,
      this.runtimeStateHome,
    );
  }

  private async createSidebarThreadSessionFromSummary(
    summary: CodexThreadSummary,
  ): Promise<ProjectSession> {
    if (summary.source?.parentThreadId) {
      throw new Error(`Child Thread '${summary.threadId}' cannot own a sidebar Session`);
    }
    const session = await this.projectWorkspace.createProjectSession({
      projectId: summary.projectId,
      noThreadFallbackTitle: normalizeSidebarSessionFallbackTitle(summary),
    });
    try {
      await this.projectWorkspace.upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: summary.projectId,
        threadId: summary.threadId,
        forkedFromId: summary.forkedFromId,
        parentThreadId: summary.source?.parentThreadId ?? null,
        threadName: summary.threadName,
        threadPreview: summary.threadPreview,
        modelProvider: summary.modelProvider,
        executionProfile: summary.executionProfile,
        cwd: summary.cwd,
        managedWorktreePath: summary.managedWorktreePath ?? null,
        projectlessOutputDirectory: summary.projectlessOutputDirectory ?? null,
        projectlessWorkspaceBrowserRoot: summary.projectlessWorkspaceBrowserRoot ?? null,
        statusType: summary.statusType,
        statusActiveFlags: summary.statusActiveFlags,
        archived: summary.archived,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        recencyAt: summary.recencyAt,
      });
      if (summary.pinned) {
        await this.projectWorkspace.setProjectSessionPinned(session.id, {
          pinned: true,
        });
      }
    } catch (error) {
      await this.projectWorkspace.deleteProjectSession(session.id);
      throw error;
    }

    const linked = await this.projectWorkspace.getProjectSession(session.id);
    if (!linked?.thread) {
      throw new Error(`Unable to materialize sidebar Session for '${summary.threadId}'`);
    }
    return linked;
  }

  private async reconcileSidebarThreadSession(
    summary: CodexThreadSummary,
  ): Promise<SidebarThreadSessionReconcileResult> {
    const changedProjectIds = new Set<string>();
    const result: SidebarThreadSessionReconcileResult = {
      session: null,
      materialized: false,
      changedProjectIds,
      projectlessChanged: false,
    };
    if (summary.archived || summary.ephemeral || summary.source?.sideConversation) return result;
    if (summary.source?.parentThreadId) {
      const child = await this.readWorkspaceThread(summary.threadId);
      if (child) await this.retireChildSidebarSession(child);
      return result;
    }

    const thread = await this.readWorkspaceThread(summary.threadId);
    if (!thread?.sessionId) {
      const session = await this.createSidebarThreadSessionFromSummary(summary);
      result.session = session;
      result.materialized = true;
      markSidebarSyncScopeChanged(result, session.projectId);
      return result;
    }

    const existingSession = await this.projectWorkspace.getProjectSession(thread.sessionId);
    if (!existingSession) {
      throw new Error(`Owning Project Session '${thread.sessionId}' is unavailable`);
    }

    if (existingSession.projectId === summary.projectId) {
      result.session = existingSession;
      return result;
    }
    throw new Error(
      `Thread '${summary.threadId}' and Session '${existingSession.id}' disagree on Project ownership`,
    );
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

  private async emitWorkspaceSidebarSyncUpdatedFromMetadata(
    metadata: SidebarThreadSyncMetadata,
    reason: CodexSidebarRefreshReason,
    options: { readonly force?: boolean } = {},
  ): Promise<CodexSidebarSyncResult> {
    this.invalidateSidebarSnapshotCache();
    return await this.sidebarSync.publish({
      includeArchived: false,
      source: "core",
      refreshed: false,
      metadata: projectSidebarThreadSyncMetadata(metadata),
      reason,
      forceEmit: options.force,
    });
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

  async prepareScheduledAutomationInput<
    Input extends CodexScheduledAutomationCreateInput | CodexScheduledAutomationUpdateInput,
  >(input: Input, current?: CodexScheduledAutomation | null): Promise<Input> {
    const providerId = input.modelProvider?.trim() || current?.modelProvider?.trim();
    if (!providerId) return input;
    const requestedModelId = input.model?.trim();
    const modelId = requestedModelId || current?.model?.trim();
    if (!modelId) {
      throw new Error("A scheduled automation provider requires a model");
    }
    const modelChanged = Boolean(
      current?.model && requestedModelId && requestedModelId !== current.model,
    );
    const profile = await this.resolveAgentExecutionProfile({
      providerId,
      modelId,
      harnessId: modelChanged ? null : (input.harnessId ?? current?.harnessId ?? null),
      reasoningEffort:
        input.reasoningEffort ?? (modelChanged ? null : current?.reasoningEffort) ?? null,
      serviceTier: input.serviceTier ?? current?.serviceTier ?? null,
    });
    if (!profile) throw new Error("Scheduled automation execution profile is unavailable");
    return {
      ...input,
      model: profile.modelId,
      modelProvider: profile.providerId,
      harnessId: profile.harnessId,
      reasoningEffort: profile.reasoningEffort,
      serviceTier: profile.serviceTier,
    };
  }

  private async ensureAgentRuntimeCredentialReloaded(): Promise<void> {
    await this.agentProviderRuntime.ensureRuntimeReady();
  }

  async runScheduledAutomationNow(
    input: CodexScheduledAutomationRunNowInput,
    rendererClientId: string | null = null,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.ensureClientReady(signal);

    const automation = await this.automationModule.getDefinition(input.id);
    if (!automation) {
      throw new Error("Automation not found.");
    }

    if (automation.kind === "heartbeat") {
      await this.runHeartbeatScheduledAutomation(
        automation,
        {
          now: Date.now(),
          reason: "run-now",
          heartbeat: {
            automationsEnabled: true,
            rendererState: rendererClientId
              ? {
                  rendererClientId,
                  isEligible: true,
                  reason: null,
                  updatedAtMs: Date.now(),
                }
              : null,
            collaborationMode: input.collaborationMode ?? null,
            permissions: input.permissions ?? null,
          },
        },
        signal,
      );
      return;
    }

    await this.runScheduledAutomation(
      automation,
      {
        now: Date.now(),
        reason: "run-now",
      },
      signal,
    );
  }

  async runScheduledAutomation(
    automation: CodexScheduledAutomation,
    context: CodexScheduledAutomationRunContext = {},
    signal?: AbortSignal,
  ): Promise<void> {
    await this.ensureClientReady(signal);

    if (automation.kind === "heartbeat") {
      await this.runHeartbeatScheduledAutomation(
        automation,
        {
          now: context.now ?? Date.now(),
          reason: context.reason ?? "scheduled",
          leaseId: context.leaseId,
          scheduleDispatched: context.scheduleDispatched,
          heartbeat: context.heartbeat,
        },
        signal,
      );
      return;
    }

    await this.runCronScheduledAutomation(
      automation,
      context.now ?? Date.now(),
      context.leaseId !== undefined || context.scheduleDispatched === true,
      signal,
    );
  }

  private async runHeartbeatScheduledAutomation(
    automation: CodexScheduledAutomation,
    context: Required<Pick<CodexScheduledAutomationRunContext, "now" | "reason">> & {
      leaseId?: string;
      scheduleDispatched?: boolean;
      heartbeat?: CodexScheduledAutomationHeartbeatRunContext;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const targetThreadId = automation.targetThreadId?.trim() ?? "";
    if (!targetThreadId) {
      if (context.reason === "run-now") throw new Error("Heartbeat thread not found.");
      await this.deferHeartbeatAutomation(automation, context, "heartbeat_thread_missing");
      return;
    }

    if (context.reason === "scheduled" && context.heartbeat?.automationsEnabled !== true) {
      if (context.leaseId !== undefined) {
        throw new CodexScheduledAutomationRetryError(
          "Heartbeat automations are disabled.",
          null,
          "heartbeat_disabled",
        );
      }
      await this.automationModule.rescheduleDefinition(
        automation.id,
        automation.definitionRevision,
        {},
      );
      this.logger.debug("Heartbeat automation skipped: feature disabled", {
        automationId: automation.id,
        targetThreadId,
      });
      return;
    }

    const targetThreadResult = await this.readHeartbeatTargetThread(targetThreadId, signal).catch(
      () => null,
    );
    signal?.throwIfAborted();
    if (!targetThreadResult) {
      if (context.reason === "run-now") throw new Error("Heartbeat thread not found.");
      await this.deferHeartbeatAutomation(automation, context, "heartbeat_thread_missing");
      this.logger.warn("Heartbeat automation skipped: thread missing", {
        automationId: automation.id,
        targetThreadId,
      });
      return;
    }
    const targetThread = targetThreadResult.thread;

    const rendererBlockReason = this.resolveHeartbeatRendererBlockReason(
      targetThreadId,
      context.heartbeat?.rendererState ?? null,
    );
    if (rendererBlockReason) {
      if (context.reason === "run-now")
        throw new Error("Heartbeat thread is not eligible right now.");
      await this.deferHeartbeatAutomation(automation, context, rendererBlockReason);
      this.logger.debug("Heartbeat automation blocked by renderer state", {
        automationId: automation.id,
        targetThreadId,
        blockReason: rendererBlockReason,
      });
      return;
    }

    const collaborationMode = await this.resolveHeartbeatCollaborationMode(
      context.heartbeat?.collaborationMode ?? null,
    );
    signal?.throwIfAborted();
    if (!collaborationMode) {
      if (context.reason === "run-now") throw new Error("Heartbeat thread mode is still loading.");
      await this.deferHeartbeatAutomation(automation, context, "heartbeat_mode_unavailable");
      this.logger.debug("Heartbeat automation waiting for renderer mode state", {
        automationId: automation.id,
        targetThreadId,
      });
      return;
    }

    const threadBlockReason = await this.resolveHeartbeatThreadBlockReason(
      targetThread.threadRuntimeStatus ?? null,
      targetThreadResult.rolloutPath,
    );
    signal?.throwIfAborted();
    if (threadBlockReason) {
      if (context.reason === "run-now") throw new Error("Heartbeat thread is busy right now.");
      await this.deferHeartbeatAutomation(automation, context, threadBlockReason);
      this.logger.debug("Heartbeat automation blocked by thread state", {
        automationId: automation.id,
        targetThreadId,
        blockReason: threadBlockReason,
      });
      return;
    }

    const cooldownAt = this.resolveHeartbeatCooldownAt(automation, targetThread);
    if (context.reason === "scheduled" && cooldownAt !== null && cooldownAt > context.now) {
      if (context.leaseId !== undefined) {
        throw new CodexScheduledAutomationRetryError(
          "Heartbeat automation is still cooling down.",
          Math.max(1, cooldownAt - context.now),
          "heartbeat_cooldown",
        );
      }
      await this.automationModule.rescheduleDefinition(
        automation.id,
        automation.definitionRevision,
        { notBefore: cooldownAt },
      );
      this.logger.debug("Heartbeat automation skipped: not due yet", {
        automationId: automation.id,
        targetThreadId,
        nextCooldownAt: cooldownAt,
      });
      return;
    }

    if (context.leaseId === undefined && context.scheduleDispatched !== true) {
      const dispatchedAutomation = await this.automationModule.dispatchDefinitionNow(automation.id);
      if (!dispatchedAutomation) {
        throw new Error("Automation not found.");
      }
    }

    await this.startHeartbeatScheduledAutomationTurn({
      automation,
      targetThread,
      rolloutPath: targetThreadResult.rolloutPath,
      now: context.now,
      collaborationMode,
      permissions: context.heartbeat?.permissions ?? null,
      waitForCompletion: context.reason === "scheduled",
      signal,
    });
  }

  private async recordHeartbeatRetry(automation: CodexScheduledAutomation): Promise<void> {
    await this.automationModule.rescheduleDefinition(automation.id, automation.definitionRevision, {
      retryWithinMs: 60_000,
    });
  }

  private async deferHeartbeatAutomation(
    automation: CodexScheduledAutomation,
    context: Pick<CodexScheduledAutomationRunContext, "leaseId" | "now"> & {
      now: number;
    },
    reasonCode: string,
  ): Promise<void> {
    if (context.leaseId !== undefined) {
      throw new CodexScheduledAutomationRetryError(
        "Heartbeat automation is temporarily blocked.",
        60_000,
        reasonCode,
      );
    }
    await this.recordHeartbeatRetry(automation);
  }

  private resolveHeartbeatRendererBlockReason(
    threadId: string,
    state: CodexScheduledAutomationHeartbeatRendererStateContext | null,
  ): string | null {
    if (!state) return "renderer_owner_lease_missing";
    if (this.rendererConversations.getOwnerClientId(threadId) !== state.rendererClientId) {
      return "renderer_owner_lease_stale";
    }
    if (state.isEligible) return null;
    return state.reason?.trim() || "renderer_ineligible";
  }

  private async readHeartbeatTargetThread(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<{ thread: CodexThreadDetail; rolloutPath: string | null } | null> {
    const result = await this.client.request<"thread/read", ThreadReadResponse>(
      "thread/read",
      {
        threadId,
        includeTurns: false,
      },
      { signal },
    );
    if (result.thread.id !== threadId) {
      throw new Error(
        `Codex thread/read expected '${threadId}' but received '${result.thread.id}'`,
      );
    }
    await this.upsertLinkFromThread(result.thread);
    const thread = this.buildThreadDetailFromRead(result.thread, {
      preserveExistingTimeline: true,
    });
    if (!thread) return null;
    const payload = asRecord(result.thread);
    const rolloutPath =
      typeof payload?.path === "string" && payload.path.trim().length > 0 ? payload.path : null;
    return { thread, rolloutPath };
  }

  private async resolveHeartbeatThreadBlockReason(
    status: CodexThreadRuntimeStatus | null,
    rolloutPath: string | null,
  ): Promise<string | null> {
    if (status?.type !== "active") return null;
    const activeFlags = status.activeFlags ?? [];
    if (activeFlags.includes("waitingOnUserInput")) return "waiting_on_user_input";
    if (activeFlags.includes("waitingOnApproval")) return "waiting_on_approval";
    if (activeFlags.length > 0) return "active_with_flags";
    if (!rolloutPath) return "active_without_rollout_path";

    const latestEvent = await readLatestHeartbeatRolloutEvent(rolloutPath);
    if (latestEvent === "task_complete") return null;
    if (latestEvent && CODEX_HEARTBEAT_ACTIVE_ROLLOUT_EVENTS.has(latestEvent)) {
      return "active_recent_rollout_activity";
    }
    return "active_without_terminal_event";
  }

  private resolveHeartbeatCooldownAt(
    automation: CodexScheduledAutomation,
    thread: CodexThreadDetail,
  ): number | null {
    const intervalMs = computeCodexScheduledAutomationIntervalMs(automation.rrule);
    if (intervalMs === null) return null;

    const candidates = [automation.lastRunAt, thread.updatedAt].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (candidates.length === 0) return null;
    return Math.max(...candidates) + intervalMs;
  }

  private async resolveHeartbeatCollaborationMode(
    mode: CodexHeartbeatAutomationCollaborationMode | null,
  ): Promise<CodexAppServerCollaborationMode | null> {
    if (!mode) return null;
    if (typeof mode === "string") {
      return await buildCollaborationModePayload({ collaborationMode: mode });
    }

    return {
      mode: mode.mode,
      settings: {
        model: mode.settings.model,
        reasoning_effort: mode.settings.reasoning_effort,
        developer_instructions: mode.settings.developer_instructions,
      },
    };
  }

  private async startHeartbeatScheduledAutomationTurn(input: {
    automation: CodexScheduledAutomation;
    targetThread: CodexThreadDetail;
    rolloutPath: string | null;
    now: number;
    collaborationMode: CodexAppServerCollaborationMode;
    permissions: CodexHeartbeatAutomationPermissions | null;
    waitForCompletion: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const requestedCwd = input.targetThread.cwd || "/";
    const existingPermissions = createCodexCanonicalWorkspacePermissionContext([requestedCwd]);
    const explicitSandbox = input.permissions?.sandboxPolicy ?? null;
    const explicitPermissionProfile =
      explicitSandbox?.type === "dangerFullAccess"
        ? { id: ":danger-full-access", extends: null }
        : explicitSandbox?.type === "readOnly"
          ? { id: ":read-only", extends: null }
          : explicitSandbox?.type === "workspaceWrite"
            ? { id: ":workspace", extends: null }
            : existingPermissions.activePermissionProfile;
    const permissionContext = input.permissions
      ? {
          turnOverrides: buildHeartbeatPermissionOverrides(input.permissions),
          canonicalFallback: {
            ...existingPermissions,
            activePermissionProfile: explicitPermissionProfile,
            approvalPolicy: input.permissions.approvalPolicy ?? existingPermissions.approvalPolicy,
            approvalsReviewer:
              input.permissions.approvalsReviewer ?? existingPermissions.approvalsReviewer,
            sandboxPolicy: input.permissions.sandboxPolicy ?? existingPermissions.sandboxPolicy,
          } satisfies CodexCanonicalHydratedPermissionContext,
        }
      : await this.resolveHeartbeatPermissionContext(requestedCwd);
    const resumedThread = await this.resumeHeartbeatTargetThread(
      input.targetThread,
      input.rolloutPath,
      input.signal,
    );
    const permissionOverrides = permissionContext.turnOverrides;
    const prompt = buildCodexScheduledAutomationHeartbeatPrompt(input.automation, input.now);
    const turnStartParams: TurnStartParams = {
      threadId: resumedThread.threadId,
      input: [createTextUserInput(prompt)],
      cwd: resumedThread.cwd,
      ...permissionOverrides,
      model: input.targetThread.executionProfile?.modelId ?? null,
      effort: input.targetThread.executionProfile?.reasoningEffort ?? null,
      serviceTier: input.targetThread.executionProfile?.serviceTier ?? null,
      summary: "auto",
      personality: null,
      outputSchema: null,
      collaborationMode: input.collaborationMode,
    };
    const actorProjectId = this.parseThreadRef(resumedThread.threadId)?.projectId ?? null;
    const actorPermissionDecision =
      actorProjectId && !input.permissions
        ? await this.permissions.resolve({
            projectId: actorProjectId,
            workspaceRoots: [resumedThread.cwd],
          })
        : null;
    const authorityLaunch = await this.beginNodexAgentTurnAuthority(
      resumedThread.threadId,
      actorPermissionDecision?.verifiedBuiltinFullAccess ?? false,
    );
    let turnStart: TurnStartResponse;
    try {
      turnStart = input.waitForCompletion
        ? await this.heartbeatTurnCompletion.startAndWait(turnStartParams, {
            signal: input.signal,
          })
        : await this.client.request<"turn/start", TurnStartResponse>(
            "turn/start",
            turnStartParams,
            {
              signal: input.signal,
            },
          );
      await this.nodexAgentAuthorityRegistry.bindTurn(authorityLaunch, turnStart.turn.id);
    } catch (error) {
      this.nodexAgentAuthorityRegistry.abortTurn(authorityLaunch);
      throw error;
    }
  }

  private async resumeHeartbeatTargetThread(
    thread: CodexThreadDetail,
    rolloutPath: string | null,
    signal?: AbortSignal,
  ): Promise<{ threadId: string; cwd: string }> {
    const executionProfile = thread.executionProfile ?? null;
    const browserUseConfig = await this.buildMcpCodexConfig(thread.cwd);
    const result = await this.client.request<"thread/resume", ThreadResumeResponse>(
      "thread/resume",
      {
        threadId: thread.threadId,
        history: null,
        path: rolloutPath,
        model: executionProfile?.modelId ?? null,
        modelProvider: executionProfile?.providerId ?? null,
        serviceTier: executionProfile?.serviceTier ?? null,
        cwd: thread.cwd,
        approvalPolicy: null,
        sandbox: null,
        config: {
          ...(browserUseConfig ?? {}),
          ...buildCodexThreadConfigOverrides(),
          ...(executionProfile?.harnessId ? { harness: executionProfile.harnessId } : {}),
          ...(executionProfile?.reasoningEffort
            ? { model_reasoning_effort: executionProfile.reasoningEffort }
            : {}),
        },
        personality: null,
        excludeTurns: true,
      },
      { signal },
    );
    if (result.thread.id !== thread.threadId) {
      throw new Error(
        `Heartbeat resume expected thread '${thread.threadId}' but received '${result.thread.id}'`,
      );
    }
    const resolvedCwd =
      resolveCodexCanonicalHydratedCwd({
        requestedCwd: thread.cwd,
        responseCwd: result.cwd,
        threadCwd: result.thread.cwd,
        fallbackCwd: thread.cwd,
      }) ?? "/";
    await this.upsertLinkFromThread({ ...result.thread, cwd: resolvedCwd });
    return {
      threadId: result.thread.id,
      cwd: resolvedCwd,
    };
  }

  private async resolveHeartbeatPermissionContext(cwd: string) {
    const permissionState = await this.permissions.resolveAutomation([cwd]);
    return {
      turnOverrides: buildTurnPermissionOverrides({
        permissionState,
        workspaceRoots: [cwd],
      }),
      canonicalFallback: this.resolveCanonicalResumePermissionContext(
        permissionState,
        [cwd],
        createCodexCanonicalWorkspacePermissionContext([cwd]),
      ),
    };
  }

  private async runCronScheduledAutomation(
    automation: CodexScheduledAutomation,
    now: number,
    scheduleDispatched: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const cwds = automation.cwds.map((cwd) => cwd.trim()).filter((cwd) => cwd.length > 0);
    if (cwds.length === 0) {
      this.logger.warn("Scheduled automation run skipped because no folders are configured", {
        automationId: automation.id,
      });
      return;
    }

    if (!scheduleDispatched) {
      const dispatchedAutomation = await this.automationModule.dispatchDefinitionNow(automation.id);
      if (!dispatchedAutomation) {
        throw new Error("Automation not found.");
      }
    }

    let models: CodexModelOption[] = [];
    try {
      models = await this.listModels();
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn("Failed to load models for scheduled automation run", {
        automationId: automation.id,
        error,
      });
    }
    const modelSettings = resolveCodexScheduledAutomationModelSettings({
      automation,
      models,
    });
    const prompt = buildCodexScheduledAutomationRunPrompt(automation);
    const errors: unknown[] = [];

    for (const cwd of cwds) {
      try {
        await this.startCronScheduledAutomationRun({
          automation,
          cwd,
          prompt,
          model: modelSettings.model,
          reasoningEffort: modelSettings.reasoningEffort,
          now,
          signal,
        });
      } catch (error) {
        signal?.throwIfAborted();
        errors.push(error);
        this.logger.warn("Scheduled automation run failed", {
          automationId: automation.id,
          cwd,
          error,
        });
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private async startCronScheduledAutomationRun(input: {
    automation: CodexScheduledAutomation;
    cwd: string;
    prompt: string;
    model: string | null;
    reasoningEffort: string | null;
    now: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const pendingThreadId = `pending:${randomUUID()}`;
    const pendingInserted = await this.automationModule.beginRun({
      threadId: pendingThreadId,
      automationId: input.automation.id,
      threadTitle: input.automation.name,
      sourceCwd: input.cwd,
    });
    if (pendingInserted) {
      this.notifyAutomationRunsUpdated({
        automationId: input.automation.id,
        threadId: pendingThreadId,
        reason: "pending-insert",
      });
    }

    let link: CodexThreadSummary | null = null;
    let threadStart: ThreadStartResponse | null = null;
    let managedWorktreePath: string | null = null;
    let projectlessOutputDirectory: string | null = null;
    try {
      const executionProfile =
        input.automation.modelProvider && input.model
          ? await this.resolveAgentExecutionProfile({
              providerId: input.automation.modelProvider,
              modelId: input.model,
              harnessId: input.automation.harnessId,
              reasoningEffort: input.reasoningEffort,
              serviceTier: input.automation.serviceTier,
            })
          : null;
      const runLocation = await this.resolveCronScheduledAutomationRunLocation({
        automation: input.automation,
        sourceCwd: input.cwd,
        now: input.now,
        signal: input.signal,
      });
      managedWorktreePath = runLocation.managedWorktreePath;
      projectlessOutputDirectory = runLocation.projectlessOutputDirectory;
      const threadWorkspaceRoots = runLocation.projectlessOutputDirectory
        ? []
        : runLocation.workspaceRoots;
      const turnWorkspaceRoots = await this.resolveCronScheduledAutomationWorkspaceRoots({
        automationId: input.automation.id,
        sourceCwd: input.cwd,
        runLocation,
      });
      const [threadPermissionState, turnPermissionState] = await Promise.all([
        this.permissions.resolveAutomation(threadWorkspaceRoots),
        this.permissions.resolveAutomation(turnWorkspaceRoots),
      ]);
      const threadPermissionOverrides = buildThreadPermissionOverrides({
        permissionState: threadPermissionState,
      });
      const turnPermissionOverrides = buildTurnPermissionOverrides({
        permissionState: turnPermissionState,
        workspaceRoots: turnWorkspaceRoots,
      });
      const developerInstructions = [
        buildCodexDesktopDeveloperInstructions({
          baseInstructions: CODEX_AUTOMATION_DEVELOPER_INSTRUCTIONS,
          isNonGitWorkspace: true,
          threadToolsEnabled: true,
          workspaceDependenciesEnabled: false,
        }),
        runLocation.projectlessOutputDirectory
          ? buildCodexProjectlessThreadInstructions({
              cwd: runLocation.cwd,
              outputDirectory: runLocation.projectlessOutputDirectory,
              workspaceBrowserRoot: runLocation.projectlessWorkspaceBrowserRoot,
            })
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n\n");
      const threadStartParams: ThreadStartParams = {
        cwd: runLocation.cwd,
        model: input.model,
        modelProvider: executionProfile?.providerId ?? null,
        config: {
          ...((await this.buildMcpCodexConfig(runLocation.cwd)) ?? {}),
          ...(executionProfile?.harnessId ? { harness: executionProfile.harnessId } : {}),
          ...(executionProfile?.reasoningEffort
            ? { model_reasoning_effort: executionProfile.reasoningEffort }
            : {}),
          ...buildCodexThreadConfigOverrides(),
        },
        developerInstructions,
        personality: null,
        ephemeral: null,
        threadSource: "automation",
        dynamicTools: await this.buildCodexDynamicToolSpecs(),
        experimentalRawEvents: THREAD_START_EXPERIMENTAL_RAW_EVENTS,
        mockExperimentalField: null,
        serviceTier: executionProfile?.serviceTier ?? null,
        runtimeWorkspaceRoots: [...runLocation.workspaceRoots],
        ...threadPermissionOverrides,
      };
      let effectiveCwd = runLocation.cwd;

      threadStart = await this.client.request<"thread/start", ThreadStartResponse>(
        "thread/start",
        threadStartParams,
        { signal: input.signal },
      );
      effectiveCwd =
        resolveCodexCanonicalHydratedCwd({
          requestedCwd: runLocation.cwd,
          responseCwd: threadStart.cwd,
          threadCwd: threadStart.thread.cwd,
          fallbackCwd: runLocation.cwd,
        }) ?? runLocation.cwd;
      const projectedThread = { ...threadStart.thread, cwd: effectiveCwd };
      link = await this.upsertLinkFromThread(
        projectedThread,
        {
          projectId: null,
          cwd: effectiveCwd,
          managedWorktreePath,
          projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot: runLocation.projectlessWorkspaceBrowserRoot,
        },
        effectiveCwd,
      );
      if (!link) {
        throw new Error("Codex thread/start returned an invalid thread payload");
      }
      await this.projectWorkspace.replaceThreadWritableRoots(link.threadId, turnWorkspaceRoots);
      if (managedWorktreePath) {
        try {
          await this.controlPlane.runPromise(
            this.managedWorktreeLifecycle.setOwner({
              hostId: CODEX_APP_LOCAL_HOST_ID,
              worktreeGitRoot: managedWorktreePath,
              ownerThreadId: link.threadId,
            }),
          );
        } catch (error) {
          this.logger.warn("Scheduled automation worktree has no owner metadata", {
            automationId: input.automation.id,
            threadId: link.threadId,
            error,
          });
        } finally {
          await this.controlPlane.runPromise(
            this.managedWorktreeLifecycle.releaseNewborn({
              hostId: CODEX_APP_LOCAL_HOST_ID,
              worktreeGitRoot: managedWorktreePath,
            }),
          );
          this.scheduleManagedWorktreeRetention();
        }
      }
      if (executionProfile) {
        link =
          (await this.updateWorkspaceThreadSummary(link.threadId, {
            modelProvider: executionProfile.providerId,
            executionProfile,
          })) ?? link;
      }
      threadStart = await this.reconcileThreadStartWritableRoots(
        threadStart,
        threadPermissionState.sandbox,
      );
      await this.persistDynamicToolCatalogsForLaunch(link.threadId, threadStartParams.dynamicTools);
      const replacedPendingRun = await this.automationModule.replacePendingRunThread({
        pendingThreadId,
        threadId: link.threadId,
      });
      if (replacedPendingRun) {
        this.notifyAutomationRunsUpdated({
          automationId: input.automation.id,
          threadId: link.threadId,
          reason: "pending-replace",
        });
      } else {
        const realRunInserted = await this.automationModule.beginRun({
          threadId: link.threadId,
          automationId: input.automation.id,
          threadTitle: input.automation.name,
          sourceCwd: input.cwd,
        });
        if (realRunInserted) {
          this.notifyAutomationRunsUpdated({
            automationId: input.automation.id,
            threadId: link.threadId,
            reason: "pending-insert",
          });
        }
      }
      await this.automationModule.setRunThreadTitle(link.threadId, input.automation.name);

      try {
        await this.threadTitlePersistence.set({
          threadId: link.threadId,
          name: input.automation.name,
          normalization: "trim",
        });
      } catch (error) {
        this.logger.warn("Failed to set scheduled automation thread title", {
          automationId: input.automation.id,
          threadId: link.threadId,
          error,
        });
      }

      const turnStartParams: TurnStartParams = {
        threadId: link.threadId,
        input: [createTextUserInput(input.prompt)],
        cwd: effectiveCwd,
        ...turnPermissionOverrides,
        model: input.model,
        effort: input.reasoningEffort,
        serviceTier: executionProfile?.serviceTier ?? null,
        summary: "auto",
        personality: null,
        outputSchema: null,
        collaborationMode: null,
      };
      await this.client.request<"turn/start", TurnStartResponse>("turn/start", turnStartParams, {
        signal: input.signal,
      });
    } catch (error) {
      if (!link) {
        const archived = await this.automationModule.archiveRun(
          {
            threadId: pendingThreadId,
            archivedReason: "auto",
          },
          {
            archivedUserMessage: null,
            archivedAssistantMessage: null,
          },
        );
        if (archived) {
          this.notifyAutomationRunsUpdated({
            automationId: input.automation.id,
            threadId: pendingThreadId,
            reason: "archive",
          });
        }
        if (managedWorktreePath) {
          await this.controlPlane
            .runPromise(
              this.managedWorktreeLifecycle.remove({
                hostId: CODEX_APP_LOCAL_HOST_ID,
                worktreeGitRoot: managedWorktreePath,
                reason: "failed-create",
              }),
            )
            .catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async resolveCronScheduledAutomationRunLocation(input: {
    automation: CodexScheduledAutomation;
    sourceCwd: string;
    now: number;
    signal?: AbortSignal;
  }): Promise<{
    cwd: string;
    workspaceRoots: string[];
    managedWorktreePath: string | null;
    projectlessOutputDirectory: string | null;
    projectlessWorkspaceBrowserRoot: string | null;
  }> {
    if (input.sourceCwd === "~") {
      return this.createProjectlessAutomationRunLocation({
        automation: input.automation,
        now: input.now,
      });
    }

    if (input.automation.executionEnvironment !== "worktree") {
      return {
        cwd: input.sourceCwd,
        workspaceRoots: [input.sourceCwd],
        managedWorktreePath: null,
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
      };
    }

    const selectedEnvironmentPath = input.automation.localEnvironmentConfigPath?.trim() || null;
    const branchName = await this.resolveAutomationWorktreeStartingBranch(input.sourceCwd);
    let allocatedWorktreeGitRoot: string | null = null;
    const host = await this.resolveExecutionHost(CODEX_APP_LOCAL_HOST_ID, "create", input.signal);
    const workerResult = await this.controlPlane
      .runPromise(
        host.request(
          {
            operation: "create",
            input: {
              requestId: `automation:${input.automation.id}:${randomUUID()}`,
              hostId: CODEX_APP_LOCAL_HOST_ID,
              repositoryPath: input.sourceCwd,
              nodexHome: getNodexHome(),
              managedRoot: host.descriptor.managedRoot,
              projectId: input.automation.id,
              targetId: input.automation.id,
              threadTitle: input.automation.name,
              startingState: branchName ? { type: "branch", branchName } : null,
              localEnvironmentConfigPath: selectedEnvironmentPath,
              setUpSyncedBranch: true,
              propagateLocalWorkspaceFiles: true,
            },
          },
          {
            onEvent: (event) =>
              event.type === "path-allocated"
                ? Effect.sync(() => {
                    allocatedWorktreeGitRoot = event.worktreeGitRoot;
                  }).pipe(
                    Effect.andThen(
                      this.managedWorktreeLifecycle.registerNewborn({
                        hostId: CODEX_APP_LOCAL_HOST_ID,
                        worktreeGitRoot: event.worktreeGitRoot,
                      }),
                    ),
                  )
                : Effect.void,
          },
        ),
        input.signal ? { signal: input.signal } : undefined,
      )
      .catch(async (error) => {
        if (allocatedWorktreeGitRoot) {
          await this.controlPlane.runPromise(
            this.managedWorktreeLifecycle.releaseNewborn({
              hostId: CODEX_APP_LOCAL_HOST_ID,
              worktreeGitRoot: allocatedWorktreeGitRoot,
            }),
          );
        }
        throw error;
      });
    const worktreeGitRoot = path.resolve(workerResult.worktreeGitRoot);
    const worktreeWorkspaceRoot = path.resolve(workerResult.worktreeWorkspaceRoot);
    if (workerResult.setupError) {
      await this.controlPlane
        .runPromise(
          this.managedWorktreeLifecycle.remove({
            hostId: CODEX_APP_LOCAL_HOST_ID,
            worktreeGitRoot,
            reason: "failed-create",
          }),
        )
        .catch(() => undefined);
      throw new Error(
        `Failed to set up scheduled automation worktree using environment '${selectedEnvironmentPath}': ${workerResult.setupError}`,
      );
    }
    await this.persistWorktreeShellEnvironment(
      worktreeWorkspaceRoot,
      workerResult.shellEnvironment,
    ).catch((error) => {
      this.logger.warn("Failed to store scheduled automation worktree shell environment", {
        cwd: worktreeWorkspaceRoot,
        error,
      });
    });

    return {
      cwd: worktreeWorkspaceRoot,
      workspaceRoots: rewriteExecutionWorkspaceRoots({
        sourcePrimary: input.sourceCwd,
        targetPrimary: worktreeWorkspaceRoot,
        workspaceRoots: [input.sourceCwd],
      }),
      managedWorktreePath: worktreeGitRoot,
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
    };
  }

  private async resolveAutomationWorktreeStartingBranch(sourceCwd: string): Promise<string | null> {
    return await this.readGitPath(sourceCwd, ["branch", "--show-current"]);
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

  private async resolveCronScheduledAutomationWorkspaceRoots(input: {
    automationId: string;
    sourceCwd: string;
    runLocation: {
      cwd: string;
      workspaceRoots: string[];
      projectlessOutputDirectory: string | null;
    };
  }): Promise<string[]> {
    if (input.runLocation.projectlessOutputDirectory) return [];

    const roots = [
      input.runLocation.cwd,
      path.join(this.runtimeStateHome, "automations", input.automationId),
      ...input.runLocation.workspaceRoots,
    ];

    const worktreeGitRoot = await this.readGitPath(input.runLocation.cwd, [
      "rev-parse",
      "--show-toplevel",
    ]);
    const sourceGitRoot = await this.readGitPath(input.sourceCwd, ["rev-parse", "--show-toplevel"]);
    if (worktreeGitRoot) roots.push(worktreeGitRoot);

    const commonDirCwd = worktreeGitRoot ?? sourceGitRoot ?? input.runLocation.cwd;
    const gitCommonDir = await this.readGitPath(commonDirCwd, ["rev-parse", "--git-common-dir"]);
    if (gitCommonDir) {
      roots.push(
        path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(commonDirCwd, gitCommonDir),
      );
    } else if (sourceGitRoot) {
      roots.push(path.join(sourceGitRoot, ".git"));
    }

    return this.uniqueResolvedPaths(roots);
  }

  private async readGitPath(cwd: string, args: string[]): Promise<string | null> {
    return await this.gitProbe.readPath(cwd, args);
  }

  private uniqueResolvedPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const candidate of paths) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const resolved = path.resolve(trimmed);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      result.push(resolved);
    }
    return result;
  }

  private async createProjectlessAutomationRunLocation(input: {
    automation: CodexScheduledAutomation;
    now: number;
  }): Promise<{
    cwd: string;
    workspaceRoots: string[];
    managedWorktreePath: null;
    projectlessOutputDirectory: string;
    projectlessWorkspaceBrowserRoot: string;
  }> {
    const workspace = await createCodexProjectlessWorkspace({
      createSplitDirectories: true,
      date: new Date(input.now),
      prompt: input.automation.prompt,
    });
    return {
      cwd: workspace.cwd,
      workspaceRoots: [],
      managedWorktreePath: null,
      projectlessOutputDirectory: workspace.outputDirectory,
      projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
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

    const manager = await this.getPastedTextAttachmentManager();
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

  private resolveAutomationInboxItemFromProtocolTurn(turn: Turn): {
    readonly title: string;
    readonly summary: string;
  } | null {
    const markdown =
      [...(Array.isArray(turn.items) ? turn.items : [])]
        .reverse()
        .find((item) => item.type === "agentMessage")
        ?.text.trim() ?? "";
    if (!markdown) return null;

    const directive = parseCodexAutomationInboxItemDirective(markdown);
    if (!directive) return null;
    return directive;
  }

  private resolveNotificationLastAgentMessage(
    threadId: string,
    turnId: string,
    rawTurn: Turn,
  ): string | null {
    const canonicalTurn = this.readCanonicalConversationState(threadId)?.turns.find(
      (turn) => turn.protocol.id === turnId,
    );
    for (let index = (canonicalTurn?.items.length ?? 0) - 1; index >= 0; index -= 1) {
      const item = canonicalTurn?.items[index];
      if (item?.type !== "agentMessage") continue;
      const text = item.text.trim();
      if (text.length > 0) return text;
    }

    const transcript = this.getMaybeConversationRecord(threadId)?.detail?.transcript ?? [];
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const item = transcript[index];
      if (!item || item.turnId !== turnId || !this.isAssistantTextItem(item)) continue;
      const text = item.markdownText?.trim() ?? "";
      if (text.length > 0) return text;
    }

    const items = Array.isArray(rawTurn.items) ? rawTurn.items : [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.type !== "agentMessage") continue;
      const text = item.text.trim();
      if (text.length > 0) return text;
    }
    return null;
  }

  private isNotificationConversationActive(threadId: string): boolean {
    const record = this.getMaybeConversationRecord(threadId);
    const detail = record?.detail;
    const workspaceThread = this.workspaceThreadProjectionById.get(threadId);
    if (detail?.threadRuntimeStatus?.type === "active") return true;
    if (detail?.statusType === "active") return true;
    if (workspaceThread?.statusType === "active") return true;
    if (this.listKnownTurns(threadId).some((turn) => turn.status === "inProgress")) {
      return true;
    }
    return hasRunningCollabAgentTranscriptEntry(detail?.transcript ?? []);
  }

  private hasActiveNotificationDescendant(threadId: string): boolean {
    const knownThreadIds = new Set([
      ...this.conversationRecords.keys(),
      ...this.workspaceThreadProjectionById.keys(),
    ]);
    for (const candidateThreadId of knownThreadIds) {
      if (candidateThreadId === threadId) continue;
      if (!this.isNotificationConversationActive(candidateThreadId)) continue;

      const visited = new Set<string>([candidateThreadId]);
      let parentThreadId =
        this.buildNotificationConversationFacts(candidateThreadId).parentThreadId;
      while (parentThreadId && !visited.has(parentThreadId)) {
        if (parentThreadId === threadId) return true;
        visited.add(parentThreadId);
        parentThreadId = this.buildNotificationConversationFacts(parentThreadId).parentThreadId;
      }
    }
    return false;
  }

  private hasPendingNotificationContinuation(
    threadId: string,
    terminalStatus: "completed" | "failed" | "interrupted",
  ): boolean {
    const queuedHead = this.listQueuedFollowUps(threadId)[0];
    const record = this.getMaybeConversationRecord(threadId);
    const turns = this.listKnownTurns(threadId);
    return hasCodexPendingContinuation({
      terminalStatus,
      queuedResourceLoading: false,
      queuedHeadPausedReason: queuedHead ? (queuedHead.pausedReason ?? null) : undefined,
      threadGoalStatus: record?.threadGoal?.status ?? null,
      latestMergedTurnStatus: turns.at(-1)?.status ?? null,
      hasRunningCollabAgent: hasRunningCollabAgentTranscriptEntry(record?.detail?.transcript ?? []),
      hasActiveDescendant: this.hasActiveNotificationDescendant(threadId),
    });
  }

  private async recordAutomationTurnCompleted(threadId: string, turn: Turn): Promise<void> {
    const directive = this.resolveAutomationInboxItemFromProtocolTurn(turn);
    try {
      const updated = await this.automationModule.completeRunForReview({
        threadId,
        inboxTitle: directive?.title ?? null,
        inboxSummary: directive?.summary ?? null,
      });
      if (updated) {
        this.notifyAutomationRunThreadUpdated(threadId, "turn-completed");
      }
    } catch (error) {
      this.logger.warn("Failed to complete scheduled automation run", {
        threadId,
        turnId: turn.id,
        error,
      });
    }
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
    await this.emitSidebarCatalogChangedForThread(detail.threadId, "host-message");
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
    if (hasSidebarThreadSummaryChanged(existing, summaryWithAgentMetadata)) {
      this.invalidateSidebarSnapshotCache();
    }
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
    if (hasSidebarThreadSummaryChanged(existing, summary)) {
      this.invalidateSidebarSnapshotCache();
    }
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

  private async emitSidebarCatalogChangedForThread(
    threadId: string,
    reason: CodexSidebarRefreshReason,
  ): Promise<void> {
    const thread = await this.readWorkspaceThread(threadId);
    const projectId =
      thread?.projectId ?? this.getMaybeConversationRecord(threadId)?.detail?.projectId;
    const metadata = createSidebarThreadSyncMetadata();
    if (projectId !== undefined) markSidebarSyncScopeChanged(metadata, projectId);
    await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, reason);
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

    this.invalidateSidebarSnapshotCache();
    this.emitEvent({ type: "threadSummary", thread: summary });
    await this.emitSidebarCatalogChangedForThread(threadId, "host-message");
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

  /** Persistent branch kernel corresponding to exact `i6e`; callers own assignment and rollback policy. */
  private async forkAndResumePersistentConversation(input: {
    readonly collaborationMode?: CodexAppServerCollaborationMode | null;
    readonly sourceThreadId: string;
    readonly requestedCwd: string | null;
    readonly sourceWorkspaceRoot?: string;
    readonly workspaceRoots: readonly string[];
    readonly threadSource: NonNullable<ThreadForkParams["threadSource"]>;
    readonly syncDormantConversationSnapshot?: boolean;
    readonly materialize: (
      thread: Thread,
      resolvedCwd: string | null,
      response: ThreadForkResponse,
    ) => CodexPersistentForkMaterialization | Promise<CodexPersistentForkMaterialization>;
  }): Promise<CodexPersistentForkResult> {
    const sourceExecutionProfile =
      this.getThreadLinkSafely(input.sourceThreadId)?.executionProfile ?? null;
    const mcpConfig = await this.buildMcpCodexConfig(
      input.requestedCwd ?? input.workspaceRoots[0] ?? null,
    );
    const config = {
      ...(mcpConfig ?? {}),
      ...(sourceExecutionProfile?.harnessId ? { harness: sourceExecutionProfile.harnessId } : {}),
      ...(sourceExecutionProfile?.reasoningEffort
        ? { model_reasoning_effort: sourceExecutionProfile.reasoningEffort }
        : {}),
      ...buildCodexThreadConfigOverrides(),
    };
    const forkResponse = await this.client.request<"thread/fork", ThreadForkResponse>(
      "thread/fork",
      {
        threadId: input.sourceThreadId,
        path: null,
        model: sourceExecutionProfile?.modelId ?? null,
        modelProvider: sourceExecutionProfile?.providerId ?? null,
        serviceTier: sourceExecutionProfile?.serviceTier ?? null,
        cwd: input.requestedCwd,
        threadSource: input.threadSource,
        config: Object.keys(config).length > 0 ? config : undefined,
      },
    );
    const threadId = forkResponse.thread.id;
    if (typeof threadId !== "string" || threadId.length === 0) {
      throw new Error("Thread fork did not return a valid thread id");
    }
    const resolvedCwd = resolveCodexCanonicalHydratedCwd({
      requestedCwd: input.requestedCwd,
      responseCwd: forkResponse.cwd,
      threadCwd: forkResponse.thread.cwd,
      fallbackCwd: input.workspaceRoots[0] ?? input.requestedCwd,
    });
    const projectedThread =
      resolvedCwd === null ? forkResponse.thread : { ...forkResponse.thread, cwd: resolvedCwd };
    let materialized = await input.materialize(projectedThread, resolvedCwd, forkResponse);
    if (sourceExecutionProfile) {
      const summary = await this.updateWorkspaceThreadSummary(threadId, {
        modelProvider: sourceExecutionProfile.providerId,
        executionProfile: sourceExecutionProfile,
      });
      materialized = {
        summary: summary ?? materialized.summary,
        detail: {
          ...materialized.detail,
          modelProvider: sourceExecutionProfile.providerId,
          executionProfile: sourceExecutionProfile,
        },
      };
    }
    const sourceExecutionContext = await this.projectWorkspace.readThreadExecutionContext(
      input.sourceThreadId,
    );
    await this.projectWorkspace.replaceThreadDynamicToolCatalogs(
      threadId,
      sourceExecutionContext?.dynamicToolCatalogs ?? [],
    );
    this.setConversationRecordDetail(materialized.detail);
    await this.projectWorkspace.replaceThreadWritableRoots(threadId, input.workspaceRoots);
    const rewriteForkRoots = (roots: readonly string[]): string[] =>
      input.sourceWorkspaceRoot && input.workspaceRoots[0]
        ? rewriteExecutionWorkspaceRoots({
            sourcePrimary: input.sourceWorkspaceRoot,
            targetPrimary: input.workspaceRoots[0],
            workspaceRoots: [...input.workspaceRoots, ...roots],
          })
        : rewriteExecutionWorkspaceRoots({
            sourcePrimary: input.workspaceRoots[0] ?? "",
            targetPrimary: input.workspaceRoots[0] ?? "",
            workspaceRoots: [...input.workspaceRoots, ...roots],
          });
    const forkRuntimeWorkspaceRoots = rewriteForkRoots(forkResponse.runtimeWorkspaceRoots);
    const forkSandbox =
      forkResponse.sandbox.type === "workspaceWrite"
        ? {
            ...forkResponse.sandbox,
            writableRoots: rewriteForkRoots(forkResponse.sandbox.writableRoots),
          }
        : forkResponse.sandbox;
    const forkPermissions = {
      activePermissionProfile: forkResponse.activePermissionProfile,
      runtimeWorkspaceRoots: forkRuntimeWorkspaceRoots,
      approvalPolicy: forkResponse.approvalPolicy,
      approvalsReviewer: forkResponse.approvalsReviewer,
      sandboxPolicy: forkSandbox,
    } satisfies CodexCanonicalHydratedPermissionContext;
    this.setConversationResumeState(threadId, "needs_resume");
    const resumedDetail = await this.resumeThreadWithSeed(threadId, {
      requestedCwd: resolvedCwd,
      workspaceRoots: input.workspaceRoots,
      collaborationMode: input.collaborationMode ?? null,
      syncDormantConversationSnapshot: input.syncDormantConversationSnapshot,
      permissionContext: forkPermissions,
    });
    if (!resumedDetail) {
      throw new Error(`Forked thread '${threadId}' could not be resumed`);
    }

    return {
      ...materialized,
      forkResponse,
      resolvedCwd,
      threadId,
      detail: resumedDetail,
    };
  }

  private resolveForkedFromConversationTitle(detail: {
    readonly threadId: string;
    readonly threadName?: string | null;
  }): string | null {
    const record = this.getMaybeConversationRecord(detail.threadId);
    const hasEligibleFirstTurn =
      (record ? this.readCanonicalConversationState(record.threadId) : null) !== null &&
      this.readConversationTurnPagination(detail.threadId).hasLoadedOldest === true;
    const firstTurnParams = hasEligibleFirstTurn
      ? this.readCanonicalConversationState(detail.threadId)?.turns[0]?.sidecar.params
      : undefined;
    return resolveCodexForkSourceConversationTitle({
      explicitTitle: detail.threadName,
      firstTurnInput: firstTurnParams?.input,
      firstTurnCommentAttachments: firstTurnParams?.commentAttachments,
    });
  }

  private resolveUserFacingForkThreadTitle(source: {
    readonly threadId: string;
    readonly threadName?: string | null;
    readonly forkedFromId?: string | null;
  }): string | null {
    const storedThreads = this.listThreadLinksSafely().map((summary) => ({
      conversationId: summary.threadId,
      forkedFromId: summary.forkedFromId ?? null,
      title: summary.threadName,
      archived: summary.archived,
    }));
    const storedThreadsById = new Map(
      storedThreads.map((thread) => [thread.conversationId, thread]),
    );
    const activeThreads = [...this.conversationRecords].map(([threadId, record]) => ({
      conversationId: threadId,
      forkedFromId:
        this.readCanonicalConversationState(record.threadId)?.protocol.forkedFromId ??
        storedThreadsById.get(threadId)?.forkedFromId ??
        null,
      title: record.detail?.threadName ?? storedThreadsById.get(threadId)?.title ?? null,
    }));
    return resolveCodexForkChildThreadTitleFromCatalog({
      source: {
        conversationId: source.threadId,
        forkedFromId: source.forkedFromId ?? null,
        title: source.threadName ?? null,
      },
      storedThreads,
      activeThreads,
      pendingForks: this.pendingWorktreeRuntime
        .list()
        .filter((entry) => entry.launchMode === "fork-conversation")
        .map(
          (entry) =>
            ({
              conversationId: entry.id,
              forkedFromId: entry.sourceConversationId,
              title: entry.initialThreadTitle ?? entry.label,
            }) satisfies CodexForkTitleThread,
        ),
    });
  }

  private appendForkedFromConversationMarker(
    targetThreadId: string,
    sourceThreadId: string,
    sourceTitle: string | null,
  ): void {
    this.ensureConversationRecord(targetThreadId);
    const before = this.readCanonicalConversationState(targetThreadId);
    if (!before) {
      throw new Error(`Forked thread '${targetThreadId}' has no canonical conversation state`);
    }
    const after = appendCodexCanonicalForkedFromConversationItem(before, {
      id: randomUUID(),
      type: "forkedFromConversation",
      sourceConversationId: sourceThreadId,
      sourceConversationTitle: sourceTitle,
    });
    this.commitCanonicalLocalTurnMutation({
      threadId: targetThreadId,
      before,
      after,
      observedAtMs: Date.now(),
    });
  }

  private async applyForkRollbackResponse(input: {
    readonly threadId: string;
    readonly response: ThreadRollbackResponse;
    readonly fallbackRef: ThreadRef | null;
    readonly fallbackCwd: string | null;
    readonly materialize?: (
      thread: Thread,
      resolvedCwd: string,
    ) => CodexPersistentForkMaterialization | Promise<CodexPersistentForkMaterialization>;
  }): Promise<CodexPersistentForkMaterialization> {
    if (input.response.thread.id !== input.threadId) {
      throw new Error(
        `Codex thread/rollback expected '${input.threadId}' but received '${input.response.thread.id}'`,
      );
    }
    const record = this.ensureConversationRecord(input.threadId);
    const previousCanonical = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = previousCanonical?.sidecar.hydrationContext ?? null;
    const cwd = input.response.thread.cwd || hydrationContext?.cwd || input.fallbackCwd || "/";
    const historyPermissions = createCodexCanonicalWorkspacePermissionContext(
      cwd === "~" ? [] : [cwd],
    );
    const replacement = createCodexCanonicalHydratedConversationState(input.response.thread, {
      model: hydrationContext?.latestModel ?? hydrationContext?.model ?? "",
      reasoningEffort:
        hydrationContext?.latestReasoningEffort ?? hydrationContext?.reasoningEffort ?? null,
      cwd,
      approvalPolicy: historyPermissions.approvalPolicy,
      approvalsReviewer: historyPermissions.approvalsReviewer,
      sandboxPolicy: historyPermissions.sandboxPolicy,
      activePermissionProfile: historyPermissions.activePermissionProfile,
      runtimeWorkspaceRoots: [...historyPermissions.runtimeWorkspaceRoots],
      pendingRequests: [],
      hasUnreadTurn: false,
    });
    this.acceptCanonicalConversationState(record.threadId, {
      ...replacement,
      requests: [],
      sidecar: {
        hasUnreadTurn: false,
        hydrationContext: hydrationContext
          ? {
              ...hydrationContext,
              cwd,
            }
          : replacement.sidecar.hydrationContext,
      },
    });
    this.conversationAggregate(record.threadId).setHasUnreadTurn(false, false);
    this.setConversationResumeState(record.threadId, "resumed");

    const { detail, summary } = input.materialize
      ? await input.materialize(input.response.thread, cwd)
      : await this.materializeThreadDetailFromThreadPayload(
          input.response.thread,
          input.fallbackRef,
          cwd,
        );
    this.setConversationRecordDetail(detail, {
      turnPagination: this.buildCompleteTurnPagination(detail.turns.length),
    });
    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
    }
    return { detail, summary };
  }

  private async deleteHeartbeatAutomationForArchivedThread(threadId: string): Promise<void> {
    const automationId = this.automationRouting.activeHeartbeatAutomationId(threadId);
    if (!automationId) return;
    try {
      const deleted = await this.automationModule.deleteDefinition(automationId);
      if (!deleted.success) return;
      this.logger.info("Deleted heartbeat automation for archived thread", {
        automationId,
        threadId,
      });
      this.emitScheduledAutomationChanged({
        automationId,
        targetThreadId: threadId,
        reason: "delete",
      });
    } catch (error) {
      this.logger.warn("Failed to delete heartbeat automation for archived thread", {
        threadId,
        error,
      });
    }
  }

  private async reconcileArchivedThreadManagedWorktree(
    archivedThread: DesktopProjectWorkspaceThread,
    reason: "archive" | "automation-archive",
  ): Promise<void> {
    const worktreeGitRoot = archivedThread.managedWorktreePath?.trim();
    if (!worktreeGitRoot) return;
    const hostId = archivedThread.executionHostId;
    const lifecycle = await this.projectWorkspace.readManagedWorktreeLifecycleSnapshot();
    const normalizedPath = normalizeWorktreePathForIdentity(worktreeGitRoot);
    const replacements = lifecycle.consumers
      .filter(
        (consumer) =>
          consumer.threadId !== archivedThread.threadId &&
          !consumer.archived &&
          consumer.executionHostId === hostId &&
          normalizeWorktreePathForIdentity(consumer.managedWorktreePath) === normalizedPath &&
          consumer.cwd !== null &&
          isPathWithinOrEqual(worktreeGitRoot, consumer.cwd),
      )
      .sort((left, right) => {
        const activeDelta =
          Number(right.statusType === "active") - Number(left.statusType === "active");
        return activeDelta || right.updatedAt - left.updatedAt;
      });
    const replacement = replacements[0];
    if (replacement) {
      await this.controlPlane.runPromise(
        this.managedWorktreeLifecycle.setOwner({
          hostId,
          worktreeGitRoot,
          ownerThreadId: replacement.threadId,
        }),
      );
      return;
    }

    const comparisonKey = await resolveWorktreePathComparisonKey(worktreeGitRoot);
    const permanentRoots = await Promise.all(
      lifecycle.projects
        .flatMap((project) => project.sourceRoots)
        .map(resolveWorktreePathComparisonKey),
    );
    if (hostId === CODEX_APP_LOCAL_HOST_ID && permanentRoots.includes(comparisonKey)) return;
    if (
      await this.controlPlane.runPromise(
        this.managedWorktreeLifecycle.isNewborn({ hostId, worktreeGitRoot }),
      )
    ) {
      return;
    }

    await this.controlPlane.runPromise(
      this.managedWorktreeLifecycle.remove({ hostId, worktreeGitRoot, reason }),
    );
  }

  /** Effect Module projection operation; callers use ConversationCommands.archive. */
  async applyThreadArchiveProjection(threadId: string): Promise<boolean> {
    await this.nodexAgentAuthorization.revokeRoot(this.resolveNodexAgentRootThreadId(threadId));
    const isAutomationRun = this.resolveAutomationIdForRunThread(threadId) !== null;
    if (isAutomationRun) {
      const messages = await this.resolveAutomationArchiveMessages(threadId);
      const archived = await this.automationModule.archiveRun(
        { threadId, archivedReason: "auto" },
        messages,
      );
      if (archived) {
        this.notifyAutomationRunThreadUpdated(threadId, "archive");
      }
    }
    await this.deleteHeartbeatAutomationForArchivedThread(threadId);
    const previous = await this.readWorkspaceThread(threadId);
    const hadUnreadState = Boolean(
      previous?.hasUnreadTurn ||
      this.readConversationAggregate(threadId)?.preHydrationHasUnreadTurn ||
      this.readConversationAggregate(threadId)?.canonicalState?.sidecar.hasUnreadTurn,
    );
    this.rememberWorkspaceSidebar(await this.projectWorkspace.setThreadArchived(threadId, true));
    if (previous) {
      await this.reconcileArchivedThreadManagedWorktree(
        previous,
        isAutomationRun ? "automation-archive" : "archive",
      ).catch((error) => {
        this.logger.warn("Archived thread worktree cleanup was retained for recovery", {
          threadId,
          hostId: previous.executionHostId,
          worktreeGitRoot: previous.managedWorktreePath,
          error,
        });
      });
    }
    this.scheduleManagedWorktreeRetention();
    await this.readWorkspaceThread(threadId);
    this.applyCommittedConversationUnreadState(threadId, false, {
      broadcast: hadUnreadState,
    });
    this.emitEvent({ type: "threadArchivedState", threadId, archived: true });
    this.forgetThreadLocalState(threadId);
    const metadata = createSidebarThreadSyncMetadata();
    if (previous) markSidebarSyncScopeChanged(metadata, previous.projectId);
    await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
    return true;
  }

  async resolveAutomationArchiveMessages(
    threadId: string,
  ): Promise<CodexAutomationArchiveMessages> {
    const localMessages = this.resolveAutomationArchiveMessagesFromTranscript(
      this.getThreadTranscript(threadId),
    );
    if (hasAutomationArchiveMessages(localMessages)) {
      return localMessages;
    }

    return await this.readAutomationArchiveMessagesFromThreadTurns(threadId);
  }

  private resolveAutomationArchiveMessagesFromTranscript(
    transcript: readonly CodexTranscriptEntry[],
  ): CodexAutomationArchiveMessages {
    let archivedUserMessage: string | null = null;
    let archivedAssistantMessage: string | null = null;

    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const entry = transcript[index];
      if (!entry) continue;

      if (archivedUserMessage === null && entry.kind === "userMessage") {
        archivedUserMessage = formatAutomationArchiveUserMessage(entry);
      }
      if (archivedAssistantMessage === null && entry.kind === "assistantMessage") {
        archivedAssistantMessage = normalizeAutomationArchiveText(entry.markdownText);
      }
      if (archivedUserMessage !== null && archivedAssistantMessage !== null) break;
    }

    return {
      archivedUserMessage,
      archivedAssistantMessage,
    };
  }

  private async readAutomationArchiveMessagesFromThreadTurns(
    threadId: string,
  ): Promise<CodexAutomationArchiveMessages> {
    try {
      await this.ensureClientReady();
      const page = await this.client.request<"thread/turns/list", ThreadTurnsListResponse>(
        "thread/turns/list",
        {
          threadId,
          limit: AUTOMATION_ARCHIVE_TURN_CAPTURE_LIMIT,
          sortDirection: "desc",
          itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
        },
      );
      return resolveAutomationArchiveMessagesFromProtocolTurns([...page.data].reverse());
    } catch (error) {
      this.logger.warn("Failed to list thread turns for automation archive", {
        threadId,
        error,
      });
      return {
        archivedUserMessage: null,
        archivedAssistantMessage: null,
      };
    }
  }

  /** Effect Module projection operation; callers use ConversationCommands.unarchive. */
  async applyThreadUnarchiveProjection(threadId: string): Promise<CodexThreadSummary | null> {
    const previous = await this.readWorkspaceThread(threadId);
    this.rememberWorkspaceSidebar(await this.projectWorkspace.setThreadArchived(threadId, false));
    const persisted = await this.readWorkspaceThread(threadId);
    const summary = persisted ? this.buildWorkspaceThreadSummary(persisted) : null;
    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
      this.emitEvent({ type: "threadArchivedState", threadId, archived: false });
    }
    const record = this.getMaybeConversationRecord(threadId);
    if (record?.detail) record.detail.archived = false;
    this.syncAcceptedConversationSummary(threadId, { syncCapabilityFlags: true });
    const metadata = createSidebarThreadSyncMetadata();
    if (previous) markSidebarSyncScopeChanged(metadata, previous.projectId);
    await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");

    return summary;
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

  private async resolveDynamicCreateServiceTier(
    input: {
      readonly cwd: string;
      readonly model: string | null;
    },
    selector?: CodexCreateThreadServiceTierSelector,
  ): Promise<string | null> {
    return await resolveCodexCreateThreadServiceTier(
      {
        destinationHostId: CODEX_APP_LOCAL_HOST_ID,
        destinationCwd: input.cwd,
        model: input.model,
        ...(selector === undefined ? {} : { selector }),
      },
      {
        readAuth: async () => {
          const response = await this.client.request<"getAuthStatus", GetAuthStatusResponse>(
            "getAuthStatus",
            { includeToken: false, refreshToken: false },
          );
          return response.authMethod;
        },
        readRequirements: async () =>
          await this.client.request<"configRequirements/read", ConfigRequirementsReadResponse>(
            "configRequirements/read",
            undefined,
          ),
        readConfig: async () => {
          const response = await this.client.request<"config/read", ConfigReadResponse>(
            "config/read",
            { includeLayers: false, cwd: null },
          );
          return response.config;
        },
        listModels: async (params) =>
          await this.client.request<"model/list", ModelListResponse>("model/list", {
            includeHidden: params.includeHidden,
            cursor: params.cursor,
            limit: params.limit,
          }),
        onError: ({ phase, error }) => {
          this.logger.warn("Failed to resolve dynamic create-thread service tier", {
            phase,
            error,
          });
        },
      },
    );
  }

  async createPendingManagedWorktree(
    entry: CodexPendingWorktreeEntry,
    context: {
      readonly signal: AbortSignal;
      readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
    },
  ): Promise<{
    readonly worktreeGitRoot: string;
    readonly worktreeWorkspaceRoot: string;
    readonly setupError: string | null;
  }> {
    const selectedEnvironmentPath = entry.localEnvironmentConfigPath?.trim() || null;
    let allocatedWorktreeGitRoot: string | null = null;
    const host = await this.resolveExecutionHost(entry.hostId, "create", context.signal);
    const workerResult = await this.controlPlane
      .runPromise(
        host.request(
          {
            operation: "create",
            input: {
              requestId: `${entry.id}:${String(entry.attempt)}`,
              hostId: entry.hostId,
              repositoryPath: entry.sourceWorkspaceRoot,
              nodexHome: getNodexHome(),
              managedRoot: host.descriptor.managedRoot,
              projectId:
                entry.launchMode === "start-conversation"
                  ? (entry.startConversationParamsInput.projectAssignment?.projectId ?? entry.id)
                  : entry.id,
              targetId: entry.id,
              threadTitle: entry.label,
              startingState: entry.startingState ?? null,
              localEnvironmentConfigPath: selectedEnvironmentPath,
              setUpSyncedBranch: entry.launchMode !== "create-stable-worktree",
              propagateLocalWorkspaceFiles: entry.hostId === CODEX_APP_LOCAL_HOST_ID,
            },
          },
          {
            onEvent: (event) =>
              Effect.sync(() => {
                if (event.type === "path-allocated") {
                  allocatedWorktreeGitRoot = event.worktreeGitRoot;
                }
                context.onEvent(event);
              }).pipe(
                Effect.andThen(
                  event.type === "path-allocated"
                    ? this.managedWorktreeLifecycle.registerNewborn({
                        hostId: entry.hostId,
                        worktreeGitRoot: event.worktreeGitRoot,
                      })
                    : Effect.void,
                ),
              ),
          },
        ),
        { signal: context.signal },
      )
      .catch(async (error) => {
        if (allocatedWorktreeGitRoot) {
          await this.controlPlane.runPromise(
            this.managedWorktreeLifecycle.releaseNewborn({
              hostId: entry.hostId,
              worktreeGitRoot: allocatedWorktreeGitRoot,
            }),
          );
        }
        throw error;
      });
    const result = {
      worktreeGitRoot: workerResult.worktreeGitRoot,
      worktreeWorkspaceRoot: workerResult.worktreeWorkspaceRoot,
    };
    const throwCanceledAfterCreate = async (cause?: unknown): Promise<never> => {
      await this.controlPlane
        .runPromise(
          this.managedWorktreeLifecycle.remove({
            hostId: entry.hostId,
            worktreeGitRoot: workerResult.worktreeGitRoot,
            reason: "cancel",
          }),
        )
        .catch((cleanupError) => {
          this.logger.warn("Failed to clean a canceled pending worktree", {
            pendingWorktreeId: entry.id,
            worktreeGitRoot: workerResult.worktreeGitRoot,
            error: cleanupError,
          });
        });
      if (cause instanceof Error) throw cause;
      throw new Error("Request canceled");
    };
    if (context.signal.aborted) return await throwCanceledAfterCreate();
    if (workerResult.setupError !== null) {
      return { ...result, setupError: workerResult.setupError };
    }
    if (workerResult.shellEnvironment !== null) {
      await this.persistWorktreeShellEnvironment(
        workerResult.worktreeWorkspaceRoot,
        workerResult.shellEnvironment,
      ).catch((error) => {
        if (context.signal.aborted) return throwCanceledAfterCreate(error);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("Failed to store pending worktree shell environment", {
          cwd: workerResult.worktreeWorkspaceRoot,
          error,
        });
        context.onEvent({
          operation: "create",
          type: "output",
          phase: "setup",
          stream: "stderr",
          data: `[stderr] Failed to store worktree shell environment: ${message}\n`,
        });
      });
    }
    if (context.signal.aborted) return await throwCanceledAfterCreate();
    return { ...result, setupError: null };
  }

  private rebaseDynamicPendingPermissions(
    entry: Extract<CodexPendingWorktreeEntry, { launchMode: "start-conversation" }>,
    workspaceRoots: readonly string[],
  ): CodexDynamicCreatePermissionSelection {
    const params = entry.startConversationParamsInput;
    const workspaceRoot = workspaceRoots[0];
    if (!workspaceRoot) throw new Error("Pending worktree requires a primary workspace root");
    return buildCodexDynamicPendingPermissionSelection({
      mode: params.agentMode,
      workspaceRoot,
      workspaceRoots,
      config: params.config,
      ...(params.permissionProfileId === undefined
        ? {}
        : { permissionProfileId: params.permissionProfileId }),
    });
  }

  private async getPastedTextAttachmentManager(): Promise<PastedTextAttachmentManager> {
    return this.attachments.pastedText;
  }

  private async getThreadGoalDirectoryManager(): Promise<ThreadGoalAttachmentDirectoryManager> {
    return this.attachments.goals;
  }

  async cleanupPendingGoalSources(entry: CodexPendingWorktreeEntry): Promise<void> {
    if (entry.launchMode !== "start-conversation" || entry.threadGoalDraft == null) return;
    await (
      await this.getPastedTextAttachmentManager()
    ).cleanupGoalSources(entry.threadGoalDraft, entry.threadStartHostId ?? entry.hostId);
  }

  private async applyStartedSessionThreadGoal(input: {
    readonly threadId: string;
    readonly objective: string;
    readonly rawDraft: CodexThreadGoalDraftInput | null;
  }): Promise<void> {
    if (input.objective.length === 0) return;
    await this.threadGoals.set({
      threadId: input.threadId,
      objective: input.objective,
      status: "active",
      appendTranscriptItem: false,
    });
    if (input.rawDraft === null) return;
    await (
      await this.getPastedTextAttachmentManager()
    ).cleanupGoalSources(input.rawDraft, CODEX_APP_LOCAL_HOST_ID);
  }

  private async materializePendingWorktreeGoal(
    entry: Extract<CodexPendingWorktreeEntry, { readonly launchMode: "start-conversation" }>,
  ): Promise<CodexPendingMaterializedGoal | null> {
    const draft = entry.threadGoalDraft;
    if (!draft) return null;

    const directoryManager = await this.getThreadGoalDirectoryManager();
    const materialized = await directoryManager.materializeDraft(draft);
    return { ...materialized, directoryManager };
  }

  private async cleanupPendingMaterializedGoal(
    goal: CodexPendingMaterializedGoal | null,
  ): Promise<void> {
    if (!goal?.attachmentDirectory) return;
    await goal.directoryManager.removeDirectory(goal.attachmentDirectory).catch(() => undefined);
  }

  async launchPendingWorktreeConversation(
    entry: CodexPendingWorktreeEntry,
    workspaceRoot: string,
    context: {
      readonly onThreadCreated: (threadId: string) => void;
      readonly includeWorktreeInit: boolean;
    },
  ): Promise<{ readonly threadId: string }> {
    if (entry.launchMode === "create-stable-worktree") {
      throw new Error(`Unsupported pending worktree launch mode: ${entry.launchMode}`);
    }
    const initialTitle = (
      entry.labelEdited ? entry.label : (entry.initialThreadTitle ?? "")
    ).trim();
    const worktreeInit = context.includeWorktreeInit
      ? buildCodexPendingWorktreeInitItem(entry)
      : null;
    if (context.includeWorktreeInit && !worktreeInit) {
      throw new Error(`Pending worktree is not ready to launch: ${entry.id}`);
    }
    const result =
      entry.launchMode === "fork-conversation"
        ? {
            ...(await this.launchPendingWorktreeFork(entry, workspaceRoot, worktreeInit)),
            materializedGoal: null,
          }
        : await this.launchPendingWorktreeStart(
            entry,
            workspaceRoot,
            worktreeInit,
            initialTitle,
            context.onThreadCreated,
            context.includeWorktreeInit,
          );
    if (!context.includeWorktreeInit) {
      await this.forkSidePanelTransferLifecycle?.promotePending({
        pendingWorktreeId: entry.id,
        targetConversationId: result.threadId,
        targetWorkspaceRoot: workspaceRoot,
      });
      this.persistClientThreadIdentity(result.threadId, entry.clientThreadId);
      context.onThreadCreated(result.threadId);
      return result;
    }
    this.persistClientThreadIdentity(result.threadId, entry.clientThreadId);
    await this.forkSidePanelTransferLifecycle?.promotePending({
      pendingWorktreeId: entry.id,
      targetConversationId: result.threadId,
      targetWorkspaceRoot: workspaceRoot,
    });
    context.onThreadCreated(result.threadId);
    await Promise.all([
      this.applyPendingWorktreeConversationMetadata({
        entry,
        includeWorktreeInit: context.includeWorktreeInit,
        initialTitle,
        threadId: result.threadId,
        materializedGoal: result.materializedGoal,
      }),
      this.createPendingWorktreeHeartbeat(entry, result.threadId),
    ]);
    await this.cleanupPendingGoalSources(entry);
    return result;
  }

  private async createPendingWorktreeHeartbeat(
    entry: Exclude<CodexPendingWorktreeEntry, { readonly launchMode: "create-stable-worktree" }>,
    threadId: string,
  ): Promise<void> {
    if (entry.launchMode !== "start-conversation") return;
    const projectId = entry.startConversationParamsInput.projectAssignment?.projectId;
    if (!entry.projectSessionId || !projectId) return;
    const outcome = await this.createHeartbeatAutomationForStartedWorktreeThread({
      projectId,
      sessionId: entry.projectSessionId,
      threadId,
      heartbeatAutomation: entry.heartbeatAutomation,
      emitStartProgress: false,
    });
    if (outcome !== "failed") return;
    this.applicationEvents.publish({
      kind: "pendingWorktreeWarning",
      value: {
        clientThreadId: entry.clientThreadId,
        kind: "heartbeat-automation-create-failed",
        message: "Started task, but could not create the heartbeat",
        pendingWorktreeId: entry.id,
        threadId,
      },
    });
  }

  private async launchPendingWorktreeStart(
    entry: Extract<CodexPendingWorktreeEntry, { readonly launchMode: "start-conversation" }>,
    workspaceRoot: string,
    worktreeInit: CodexCanonicalWorktreeInitItem | null,
    initialTitle: string,
    onThreadCreated: (threadId: string) => void,
    includeWorktreeInit: boolean,
  ): Promise<{
    readonly threadId: string;
    readonly materializedGoal: CodexPendingMaterializedGoal | null;
  }> {
    const params = entry.startConversationParamsInput;
    const launchLocation = projectCodexPendingWorktreeLaunchLocation({
      params,
      sourceWorkspaceRoot: entry.sourceWorkspaceRoot,
      worktreeWorkspaceRoot: workspaceRoot,
    });
    const permissionSelection = params.shouldSendPermissionOverrides
      ? this.rebaseDynamicPendingPermissions(entry, launchLocation.workspaceRoots)
      : null;
    const projectId = launchLocation.projectAssignment?.projectId ?? null;
    const modelProjection = {
      collaborationMode: params.collaborationMode,
      configOverrides: params.configOverrides ?? null,
    } as CodexDynamicCreateModelProjection;
    const materializedGoal = includeWorktreeInit
      ? await this.materializePendingWorktreeGoal(entry)
      : null;
    const firstTurnInput = materializedGoal
      ? replaceFirstTextInput(params.input, `/goal ${materializedGoal.objective}`)
      : [...params.input];
    const prompt = materializedGoal?.objective ?? extractCodexUserRequestSection(entry.prompt);
    const additionalContext = buildReviewDiffCommentAdditionalContext(params.commentAttachments);
    const firstTurnAttachments = buildCodexPendingFirstTurnAttachments({
      fileAttachments: params.fileAttachments,
      addedFiles: params.addedFiles,
      threadGoalDraft: includeWorktreeInit && materializedGoal ? entry.threadGoalDraft : null,
    });
    let coreCreated = false;

    try {
      const result = await this.startDynamicCreatedConversation(
        {
          clientThreadId: entry.clientThreadId,
          createInput: {
            prompt,
            target: projectId
              ? { type: "project", projectId, environment: { type: "local" } }
              : { type: "projectless" },
          },
          ...(params.additionalDeveloperInstructions === undefined
            ? {}
            : { additionalDeveloperInstructions: params.additionalDeveloperInstructions }),
          ...(params.baseInstructions === undefined
            ? {}
            : { baseInstructions: params.baseInstructions }),
          ...(entry.browserUsePresentationOrigin
            ? {
                beforeFirstTurn: async (threadId: string) => {
                  await this.promoteBrowserUseRouteForFirstTurn({
                    origin: entry.browserUsePresentationOrigin,
                    codexSessionId: threadId,
                    projectId,
                  });
                },
              }
            : {}),
          ...(additionalContext ? { firstTurnAdditionalContext: additionalContext } : {}),
          firstTurnAttachments,
          firstTurnCommentAttachments: [...params.commentAttachments],
          firstTurnInput,
          ...(initialTitle ? { initialTitle } : {}),
          managedWorktreePath: worktreeInit ? entry.worktreeGitRoot : null,
          ...(params.memoryPreferences === undefined
            ? {}
            : { memoryPreferences: params.memoryPreferences }),
          modelProjection,
          executionProfile: params.executionProfile,
          ...(params.mode === undefined ? {} : { mode: params.mode }),
          onThreadCreated: (threadId) => {
            coreCreated = true;
            onThreadCreated(threadId);
          },
          permissionSelection,
          ...(entry.projectSessionId ? { projectSessionId: entry.projectSessionId } : {}),
          ...(params.serviceName === undefined ? {} : { serviceName: params.serviceName }),
          serviceTier: params.serviceTier,
          skipAutoTitleGeneration:
            initialTitle.length > 0 || entry.skipAutoTitleGeneration === true,
          target: {
            launchMode: "direct",
            projectId,
            cwd: launchLocation.cwd,
            workspaceRoots: [...launchLocation.workspaceRoots],
            workspaceKind: params.workspaceKind,
            projectlessOutputDirectory: null,
            projectlessWorkspaceBrowserRoot: null,
          },
          threadSource: params.threadSource,
          ...(params.threadStartKind === undefined
            ? {}
            : { threadStartKind: params.threadStartKind }),
          ...(worktreeInit ? { worktreeInit } : {}),
        },
        { persistClientThreadIdentity: false },
      );
      return { ...result, materializedGoal };
    } catch (error) {
      if (!coreCreated) {
        await this.cleanupPendingMaterializedGoal(materializedGoal);
      }
      throw error;
    }
  }

  private async launchPendingWorktreeFork(
    entry: Extract<CodexPendingWorktreeEntry, { readonly launchMode: "fork-conversation" }>,
    workspaceRoot: string,
    worktreeInit: CodexCanonicalWorktreeInitItem | null,
  ): Promise<{ readonly threadId: string }> {
    let source = await this.resolveDynamicThreadDetail(entry.sourceConversationId);
    let trailingTurnCount = 0;
    if (entry.targetTurnId) {
      source = this.serializeThreadDetail(entry.sourceConversationId) ?? source;
      const sourceTurnIndex = source.turns.findIndex((turn) => turn.turnId === entry.targetTurnId);
      if (sourceTurnIndex < 0) {
        throw new Error(
          `Turn '${entry.targetTurnId}' was not found in thread '${entry.sourceConversationId}'`,
        );
      }
      trailingTurnCount = source.turns.length - sourceTurnIndex - 1;
    }
    const projectId =
      entry.projectAssignment?.projectId ??
      this.getThreadLinkSafely(entry.sourceConversationId)?.projectId ??
      null;
    const workspaceRoots = rewriteExecutionWorkspaceRoots({
      sourcePrimary: entry.sourceWorkspaceRoot,
      targetPrimary: workspaceRoot,
      workspaceRoots: entry.sourceWorkspaceRoots,
    });
    const fork = await this.forkAndResumePersistentConversation({
      sourceThreadId: entry.sourceConversationId,
      collaborationMode: entry.sourceCollaborationMode,
      requestedCwd: workspaceRoot,
      sourceWorkspaceRoot: entry.sourceWorkspaceRoot,
      workspaceRoots,
      threadSource: entry.threadSource ?? "user",
      materialize: (thread, resolvedCwd) =>
        this.materializeThreadDetailFromThreadPayload(
          thread,
          {
            projectId,
            cwd: resolvedCwd ?? workspaceRoot,
            managedWorktreePath: worktreeInit ? entry.worktreeGitRoot : null,
          },
          resolvedCwd ?? workspaceRoot,
          { preserveExistingTimeline: true },
        ),
    });
    if (trailingTurnCount > 0) {
      const rollbackResponse = await this.client.request<"thread/rollback", ThreadRollbackResponse>(
        "thread/rollback",
        {
          threadId: fork.threadId,
          numTurns: trailingTurnCount,
        },
      );
      await this.applyForkRollbackResponse({
        threadId: fork.threadId,
        response: rollbackResponse,
        fallbackRef: this.parseThreadRef(fork.threadId),
        fallbackCwd: fork.resolvedCwd ?? workspaceRoot,
      });
    }
    this.appendForkedFromConversationMarker(
      fork.threadId,
      entry.sourceConversationId,
      this.resolveForkedFromConversationTitle(source),
    );
    if (worktreeInit) {
      this.ensureConversationRecord(fork.threadId);
      const before = this.readCanonicalConversationState(fork.threadId);
      if (!before) {
        throw new Error(`Forked thread '${fork.threadId}' has no canonical conversation state`);
      }
      const after = appendCodexCanonicalWorktreeInitItem(before, worktreeInit, "new-turn");
      this.commitCanonicalLocalTurnMutation({
        threadId: fork.threadId,
        before,
        after,
        observedAtMs: Date.now(),
      });
    }
    this.syncDormantConversationFromRecord(fork.threadId, "owner-unavailable");
    return { threadId: fork.threadId };
  }

  private async applyPendingWorktreeConversationMetadata(input: {
    readonly entry: Exclude<
      CodexPendingWorktreeEntry,
      { readonly launchMode: "create-stable-worktree" }
    >;
    readonly includeWorktreeInit: boolean;
    readonly initialTitle: string;
    readonly materializedGoal: CodexPendingMaterializedGoal | null;
    readonly threadId: string;
  }): Promise<void> {
    const { entry, includeWorktreeInit, initialTitle, materializedGoal, threadId } = input;
    const onlyIfUntitled = entry.initialThreadTitle == null && entry.labelEdited;
    if (entry.isPinned) {
      try {
        await this.threadCatalog.setPinned(threadId, true, entry.pinnedBeforeThreadId);
      } catch (error) {
        this.logger.warn("Worktree conversation started without pinned metadata", {
          pendingWorktreeId: entry.id,
          threadId,
          error,
        });
      }
    }
    if (initialTitle) {
      const currentTitle = this.getThreadLinkSafely(threadId)?.threadName?.trim() ?? "";
      if (!onlyIfUntitled || !currentTitle) {
        await this.threadTitlePersistence.set({
          threadId,
          name: initialTitle,
          normalization: "manual",
        });
      }
    }
    if (includeWorktreeInit && entry.worktreeGitRoot) {
      try {
        await this.controlPlane.runPromise(
          this.managedWorktreeLifecycle.setOwner({
            hostId: entry.hostId,
            worktreeGitRoot: entry.worktreeGitRoot,
            ownerThreadId: threadId,
          }),
        );
      } catch (error) {
        this.logger.warn("Worktree conversation started without owner metadata", {
          pendingWorktreeId: entry.id,
          threadId,
          error,
        });
      } finally {
        await this.controlPlane.runPromise(
          this.managedWorktreeLifecycle.releaseNewborn({
            hostId: entry.hostId,
            worktreeGitRoot: entry.worktreeGitRoot,
          }),
        );
        this.scheduleManagedWorktreeRetention();
      }
    }
    if (materializedGoal) {
      const goal = await this.threadGoals.set({
        threadId,
        objective: materializedGoal.objective,
        status: "active",
        appendTranscriptItem: false,
      });
      if (!goal) {
        throw new Error(`Pending worktree thread '${threadId}' could not retain its goal`);
      }
    }
  }

  /** Exact `HQ`: thread-start response wins, except the full-access fallback. */
  private resolveDynamicCreateResponsePermissionContext(
    response: ThreadStartResponse,
    requested: CodexDynamicCreatePermissionContext | null,
  ): CodexDynamicCreatePermissionContext {
    if (requested === null) {
      return {
        activePermissionProfile: response.activePermissionProfile,
        runtimeWorkspaceRoots: [...response.runtimeWorkspaceRoots],
        approvalPolicy: response.approvalPolicy,
        approvalsReviewer: response.approvalsReviewer,
        sandboxPolicy: response.sandbox,
      };
    }
    const requestedProfile = requested.activePermissionProfile;
    if (
      response.activePermissionProfile === null &&
      requestedProfile?.id === ":danger-full-access"
    ) {
      return requested;
    }
    return {
      activePermissionProfile:
        response.activePermissionProfile ??
        (requestedProfile !== null && !requestedProfile.id.startsWith(":")
          ? requestedProfile
          : null),
      runtimeWorkspaceRoots: [...response.runtimeWorkspaceRoots],
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      sandboxPolicy: response.sandbox,
    };
  }

  private async resolveDynamicCreateFirstTurnPermissions(input: {
    readonly cwd: string;
    readonly mode: CodexDynamicCreatePermissionMode;
    readonly responseContext: CodexDynamicCreatePermissionContext;
    readonly threadId: string;
  }): Promise<CodexDynamicCreatePermissionSelection> {
    let retainedWritableRoots: string[] = [];
    try {
      retainedWritableRoots = await this.readThreadWritableRoots(input.threadId);
    } catch (error) {
      this.logger.warn("Failed to load dynamic create-thread writable roots", {
        threadId: input.threadId,
        error,
      });
    }

    const visualizationDirectory =
      input.responseContext.sandboxPolicy.type === "workspaceWrite"
        ? resolveCodexThreadVisualizationDirectory(this.runtimeStateHome, input.threadId)
        : null;
    if (visualizationDirectory) {
      await mkdir(visualizationDirectory, { recursive: true });
    }
    const context = augmentCodexDynamicFirstTurnPermissionContext({
      context: input.responseContext,
      cwd: input.cwd,
      retainedWritableRoots,
      visualizationDirectory,
    });

    return resolveCodexDynamicCreatePermissionSelection({
      source: null,
      destination: {
        hostId: CODEX_APP_LOCAL_HOST_ID,
        cwd: input.cwd,
        defaultMode: input.mode,
        defaultContext: context,
        workspaceRoots: [],
      },
    });
  }

  private async failDynamicCreateOptimisticTurn(
    threadId: string,
    clientUserMessageId: string,
    previousPermissionContext: CodexCanonicalHydratedPermissionContext,
    previousStatus: {
      readonly statusType: CodexThreadStatusType;
      readonly statusActiveFlags: readonly CodexThreadActiveFlag[];
    },
  ): Promise<void> {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return;
    const before = this.readCanonicalConversationState(threadId);
    if (before) {
      const failed = failCodexCanonicalOptimisticTurn(before, clientUserMessageId, randomUUID());
      const hydrationContext = failed.sidecar.hydrationContext;
      const after = hydrationContext
        ? {
            ...failed,
            sidecar: {
              ...failed.sidecar,
              hydrationContext: {
                ...hydrationContext,
                currentPermissions: previousPermissionContext,
              },
            },
          }
        : failed;
      this.commitCanonicalLocalTurnMutation({
        threadId,
        before,
        after,
        observedAtMs: Date.now(),
      });
    }
    const detail = record.detail;
    if (detail) {
      record.detail = {
        ...detail,
        statusType: previousStatus.statusType,
        statusActiveFlags: [...previousStatus.statusActiveFlags],
      };
    }
    await this.applyThreadStatusLocal(threadId, previousStatus.statusType, [
      ...previousStatus.statusActiveFlags,
    ]);
    this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
  }

  private dispatchDynamicCreateFirstTurn(input: {
    readonly additionalContext?: TurnStartParams["additionalContext"];
    readonly attachments: readonly CodexLiveFileAttachment[];
    readonly clientUserMessageId: string;
    readonly collaborationMode: CodexDynamicCreateModelProjection["collaborationMode"];
    readonly cwd: string;
    readonly inputItems: TurnStartParams["input"];
    readonly nodexBuiltinFullAccess: boolean;
    readonly permissionOverrides?: CodexDynamicCreatePermissionSelection["turnParams"];
    readonly reasoningEffort: TurnStartParams["effort"];
    readonly reasoningSummary: NonNullable<TurnStartParams["summary"]>;
    readonly previousPermissionContext: CodexCanonicalHydratedPermissionContext;
    readonly previousStatus: {
      readonly statusType: CodexThreadStatusType;
      readonly statusActiveFlags: readonly CodexThreadActiveFlag[];
    };
    readonly serviceTier: string | null;
    readonly threadId: string;
    readonly threadModel: string;
    readonly useAppServerPermissionDefault: boolean;
    readonly workspaceKind: CodexResolvedDynamicDirectThreadTarget["workspaceKind"];
  }): Promise<void> {
    return (async () => {
      const authorityLaunch = await this.beginNodexAgentTurnAuthority(
        input.threadId,
        input.nodexBuiltinFullAccess,
      );
      try {
        const permissionParams: Pick<
          TurnStartParams,
          | "approvalPolicy"
          | "approvalsReviewer"
          | "permissions"
          | "runtimeWorkspaceRoots"
          | "sandboxPolicy"
        > = input.useAppServerPermissionDefault
          ? {
              approvalPolicy: null,
              approvalsReviewer: null,
              sandboxPolicy: null,
              permissions: null,
              runtimeWorkspaceRoots: null,
            }
          : (input.permissionOverrides ?? {});
        const turnStartParams: CodexAppPrivateTurnStartParams = {
          threadId: input.threadId,
          clientUserMessageId: input.clientUserMessageId,
          input: input.inputItems,
          cwd: input.cwd,
          ...(input.additionalContext ? { additionalContext: input.additionalContext } : {}),
          ...permissionParams,
          responsesapiClientMetadata: {
            workspace_kind: input.workspaceKind,
          },
          model: input.collaborationMode === null ? input.threadModel : null,
          serviceTier: input.serviceTier,
          effort: input.collaborationMode === null ? input.reasoningEffort : null,
          multiAgentMode: "explicitRequestOnly",
          summary: input.reasoningSummary,
          personality: null,
          outputSchema: null,
          collaborationMode: input.collaborationMode,
          attachments: input.attachments,
        };
        const response = await this.client.request<"turn/start", TurnStartResponse>(
          "turn/start",
          turnStartParams,
        );
        await this.nodexAgentAuthorityRegistry.bindTurn(authorityLaunch, response.turn.id);
        const record = this.getMaybeConversationRecord(input.threadId);
        const before = this.readCanonicalConversationState(input.threadId);
        if (record && before) {
          const after = bindCodexCanonicalOptimisticTurn(
            before,
            input.clientUserMessageId,
            response.turn,
          );
          this.commitCanonicalLocalTurnMutation({
            threadId: input.threadId,
            before,
            after,
            observedAtMs: Date.now(),
          });
        }
        await this.markThreadAsActive(input.threadId);
        this.syncDormantConversationFromRecord(input.threadId, "owner-unavailable");
      } catch (error) {
        this.nodexAgentAuthorityRegistry.abortTurn(authorityLaunch);
        this.logger.error("Background first turn failed", {
          threadId: input.threadId,
          error,
        });
        await this.failDynamicCreateOptimisticTurn(
          input.threadId,
          input.clientUserMessageId,
          input.previousPermissionContext,
          input.previousStatus,
        );
        throw error;
      }
    })();
  }

  private async startDynamicCreatedConversation(
    input: CodexDynamicDirectConversationLaunchInput,
    options: { readonly persistClientThreadIdentity?: boolean } = {},
  ): Promise<{ readonly threadId: string; readonly projectlessOutputDirectory?: string }> {
    const clientThreadId =
      input.clientThreadId ?? `${CODEX_CLIENT_THREAD_ID_PREFIX}${randomUUID()}`;
    const projectlessDeveloperInstructions =
      input.target.workspaceKind === "projectless"
        ? buildCodexProjectlessThreadInstructions({
            cwd: input.target.cwd,
            outputDirectory: input.target.projectlessOutputDirectory,
            workspaceBrowserRoot: input.target.projectlessWorkspaceBrowserRoot,
          })
        : null;
    const additionalDeveloperInstructions =
      input.additionalDeveloperInstructions === undefined
        ? projectlessDeveloperInstructions
        : input.additionalDeveloperInstructions;
    const threadStartProjection = projectCodexPendingThreadStart({
      defaultFeatureOverrides: CODEX_DEFAULT_FEATURE_OVERRIDES,
      frozen: {
        ...(input.modelProjection.configOverrides === null
          ? {}
          : { configOverrides: input.modelProjection.configOverrides }),
        ...(input.memoryPreferences === undefined
          ? {}
          : { memoryPreferences: input.memoryPreferences }),
      },
    });
    if (input.projectSessionId) {
      const session = await this.projectWorkspace.getProjectSession(input.projectSessionId);
      if (!session) {
        throw new Error(`Project session not found: ${input.projectSessionId}`);
      }
      if (session.projectId !== input.target.projectId) {
        throw new Error("Pending thread project must match the owning session project");
      }
    }
    const baseThreadStartParams = await this.buildNewConversationParams({
      cwd: input.target.cwd,
      model: input.modelProjection.collaborationMode?.settings.model ?? null,
      executionProfile: input.executionProfile ?? null,
      serviceTier: input.serviceTier,
      permissions: input.permissionSelection?.launchParams ?? null,
      defaultFeatureOverrides: threadStartProjection.defaultFeatureOverrides,
      personality: this.preferences.current(),
      additionalDeveloperInstructions,
      ...(input.baseInstructions === undefined ? {} : { baseInstructions: input.baseInstructions }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      threadSource: input.threadSource ?? "subagent",
      ...(input.threadStartKind === undefined ? {} : { threadStartKind: input.threadStartKind }),
      ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
    });
    const threadStartParams: ThreadStartParams = {
      ...baseThreadStartParams,
      config: buildCodexPendingThreadStartConfig(
        baseThreadStartParams.config,
        threadStartProjection,
      ),
      runtimeWorkspaceRoots: [...input.target.workspaceRoots],
    };
    let threadStart: ThreadStartResponse;
    let detail: CodexThreadDetail;
    let effectiveCwd = input.target.cwd;
    let projectedThread: Thread | null = null;
    let responsePermissionContext: CodexDynamicCreatePermissionContext | null = null;
    threadStart = await this.client.request<"thread/start", ThreadStartResponse>(
      "thread/start",
      threadStartParams,
    );
    effectiveCwd =
      resolveCodexCanonicalHydratedCwd({
        requestedCwd: input.target.cwd,
        responseCwd: threadStart.cwd,
        threadCwd: threadStart.thread.cwd,
        fallbackCwd: input.target.cwd,
      }) ?? input.target.cwd;
    projectedThread = {
      ...threadStart.thread,
      cwd: effectiveCwd,
      ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
    };
    const fallbackRef: ThreadRef = {
      projectId: input.target.projectId,
      cwd: effectiveCwd,
      managedWorktreePath: input.managedWorktreePath ?? null,
      projectlessOutputDirectory: input.target.projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot: input.target.projectlessWorkspaceBrowserRoot,
    };
    ({ detail } = await this.materializeThreadDetailFromThreadPayload(
      projectedThread,
      fallbackRef,
      effectiveCwd,
    ));
    if (input.executionProfile) {
      await this.updateWorkspaceThreadSummary(detail.threadId, {
        modelProvider: input.executionProfile.providerId,
        executionProfile: input.executionProfile,
      });
      detail = {
        ...detail,
        modelProvider: input.executionProfile.providerId,
        executionProfile: input.executionProfile,
      };
    }
    if (input.permissionSelection) {
      threadStart = await this.reconcileThreadStartWritableRoots(
        threadStart,
        input.permissionSelection.context.sandboxPolicy,
      );
    }
    responsePermissionContext = this.resolveDynamicCreateResponsePermissionContext(
      threadStart,
      input.permissionSelection?.context ?? null,
    );
    await this.persistDynamicToolCatalogsForLaunch(detail.threadId, threadStartParams.dynamicTools);
    await this.projectWorkspace.replaceThreadWritableRoots(
      detail.threadId,
      input.target.workspaceRoots,
    );
    this.setConversationRecordDetail(detail);
    this.hydrateCanonicalConversationState(threadStart, {
      fallbackCwd: input.target.cwd,
      resolvedCwd: effectiveCwd,
      responsePermissionFallback: {
        ...responsePermissionContext,
        runtimeWorkspaceRoots: [...(responsePermissionContext.runtimeWorkspaceRoots ?? [])],
      },
    });
    if (input.projectSessionId) {
      const attachedSummary = await this.upsertWorkspaceSessionLinkFromThread(
        projectedThread,
        {
          projectId: input.target.projectId,
          sessionId: input.projectSessionId,
        },
        {
          executionHostId: CODEX_APP_LOCAL_HOST_ID,
          fallbackCwd: effectiveCwd,
          managedWorktreePath: input.managedWorktreePath ?? null,
          runtimeWorkspaceRoots: input.target.workspaceRoots,
        },
      );
      if (!attachedSummary) {
        throw new Error("Pending thread could not be attached to its project session");
      }
    }
    const threadId = detail.threadId;
    if (input.initialTitle?.trim()) {
      await this.threadTitlePersistence.set({
        threadId,
        name: input.initialTitle,
        normalization: "manual",
      });
    }
    if (!responsePermissionContext) {
      throw new Error("Thread start did not resolve its permission context");
    }
    const turnPermissionSelection = input.permissionSelection
      ? await this.resolveDynamicCreateFirstTurnPermissions({
          cwd: effectiveCwd,
          mode: input.permissionSelection.mode,
          responseContext: responsePermissionContext,
          threadId,
        })
      : null;
    const collaborationMode = input.modelProjection.collaborationMode;
    const effectiveModel =
      input.executionProfile?.modelId ?? collaborationMode?.settings.model ?? threadStart.model;
    const effectiveReasoningEffort =
      input.executionProfile?.reasoningEffort ??
      collaborationMode?.settings.reasoning_effort ??
      parseReasoningEffort(threadStart.reasoningEffort);
    const previousPermissionContext: CodexCanonicalHydratedPermissionContext = {
      activePermissionProfile: responsePermissionContext.activePermissionProfile,
      runtimeWorkspaceRoots: [...(responsePermissionContext.runtimeWorkspaceRoots ?? [])],
      approvalPolicy: responsePermissionContext.approvalPolicy,
      approvalsReviewer: responsePermissionContext.approvalsReviewer,
      sandboxPolicy: responsePermissionContext.sandboxPolicy,
    };
    const firstTurnPermissionContext: CodexCanonicalHydratedPermissionContext =
      turnPermissionSelection
        ? {
            activePermissionProfile: turnPermissionSelection.context.activePermissionProfile,
            runtimeWorkspaceRoots: [
              ...(turnPermissionSelection.context.runtimeWorkspaceRoots ?? []),
            ],
            approvalPolicy: turnPermissionSelection.context.approvalPolicy,
            approvalsReviewer: turnPermissionSelection.context.approvalsReviewer,
            sandboxPolicy: turnPermissionSelection.context.sandboxPolicy,
          }
        : {
            activePermissionProfile: responsePermissionContext.activePermissionProfile,
            runtimeWorkspaceRoots: [...(responsePermissionContext.runtimeWorkspaceRoots ?? [])],
            approvalPolicy: responsePermissionContext.approvalPolicy,
            approvalsReviewer: responsePermissionContext.approvalsReviewer,
            sandboxPolicy: responsePermissionContext.sandboxPolicy,
          };
    const latestCollaborationMode = buildCollaborationModeState({
      collaborationMode: "default",
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
    });
    const record = this.ensureConversationRecord(threadId);
    const firstTurnReasoningSummary = resolveCodexReasoningSummary({
      configuredSummary: record.latestThreadSettings?.summary,
    });
    this.setLatestCollaborationModeForThread(threadId, latestCollaborationMode);
    this.applyLatestThreadSettingsForThread(threadId, {
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
      summary: firstTurnReasoningSummary,
      collaborationMode: latestCollaborationMode,
      personality: this.preferences.current(),
    });
    const previousStatus = {
      statusType: detail.statusType,
      statusActiveFlags: [...detail.statusActiveFlags],
    };
    await input.beforeFirstTurn?.(threadId);
    this.conversationAggregate(threadId).setStreaming(true);
    this.setConversationStreamRole(threadId, "owner");
    const clientUserMessageId = randomUUID();
    const delegatedInput =
      input.firstTurnInput ??
      (() => {
        if (!input.sourceThreadId) {
          throw new Error("Dynamic delegated thread requires a source thread id");
        }
        return buildCodexDelegationInput({
          sourceThreadId: input.sourceThreadId,
          input: input.createInput.prompt,
        });
      })();
    const firstTurnAttachments = input.firstTurnAttachments ?? [];
    const startedAt = Date.now();
    const turnParams: CodexCanonicalLiveTurnParams = {
      threadId,
      clientUserMessageId,
      input: delegatedInput,
      ...(input.firstTurnAdditionalContext
        ? { additionalContext: input.firstTurnAdditionalContext }
        : {}),
      responsesapiClientMetadata: {
        workspace_kind: input.target.workspaceKind,
      },
      cwd: effectiveCwd,
      approvalPolicy: firstTurnPermissionContext.approvalPolicy,
      approvalsReviewer: firstTurnPermissionContext.approvalsReviewer,
      permissions: firstTurnPermissionContext.activePermissionProfile?.id ?? null,
      runtimeWorkspaceRoots: firstTurnPermissionContext.activePermissionProfile
        ? [...(firstTurnPermissionContext.runtimeWorkspaceRoots ?? [])]
        : null,
      sandboxPolicy: firstTurnPermissionContext.sandboxPolicy,
      useAppServerPermissionDefault: input.permissionSelection === null,
      model: collaborationMode === null ? threadStart.model : null,
      serviceTier: threadStart.serviceTier ?? input.serviceTier,
      effort: collaborationMode === null ? threadStart.reasoningEffort : null,
      multiAgentMode: "explicitRequestOnly",
      summary: firstTurnReasoningSummary,
      personality: null,
      outputSchema: null,
      collaborationMode,
      attachments: firstTurnAttachments,
      ...(input.firstTurnCommentAttachments
        ? { commentAttachments: [...input.firstTurnCommentAttachments] }
        : {}),
    };
    const before = this.readCanonicalConversationState(threadId);
    if (before) {
      // Worktree initialization is app-owned activity for the first Turn. It
      // is staged before server items so the Turn renders user → activity →
      // assistant and keeps the activity under the worked-time disclosure.
      const optimisticState = appendCodexCanonicalOptimisticFirstTurn(
        before,
        {
          params: turnParams,
          currentCollaborationModel: record.latestCollaborationMode.settings.model,
          startedAtMs: startedAt,
        },
        input.worktreeInit,
      );
      const hydrationContext = optimisticState.sidecar.hydrationContext;
      const after = hydrationContext
        ? {
            ...optimisticState,
            sidecar: {
              ...optimisticState.sidecar,
              hydrationContext: {
                ...hydrationContext,
                currentPermissions: firstTurnPermissionContext,
              },
            },
          }
        : optimisticState;
      this.commitCanonicalLocalTurnMutation({
        threadId,
        before,
        after,
        observedAtMs: startedAt,
      });
    }
    if (input.skipAutoTitleGeneration !== true) {
      this.scheduleGeneratedThreadName({
        threadId,
        prompt: input.createInput.prompt,
        cwd: effectiveCwd,
      });
    }
    const currentDetail = record.detail ?? detail;
    record.detail = {
      ...currentDetail,
      statusType: "active",
      statusActiveFlags: [],
    };
    await this.markThreadAsActive(threadId);
    this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
    const permissionDecision =
      input.projectSessionId && input.target.projectId && input.permissionSelection
        ? await this.permissions.resolve({
            projectId: input.target.projectId,
            requestedMode:
              input.permissionSelection.mode === "full-access" ? "full-access" : undefined,
            workspaceRoots: input.target.workspaceRoots,
          })
        : null;
    const firstTurnPromise = this.dispatchDynamicCreateFirstTurn({
      ...(input.firstTurnAdditionalContext
        ? { additionalContext: input.firstTurnAdditionalContext }
        : {}),
      attachments: firstTurnAttachments,
      clientUserMessageId,
      collaborationMode,
      cwd: effectiveCwd,
      inputItems: delegatedInput,
      nodexBuiltinFullAccess:
        input.permissionSelection?.mode === "full-access" &&
        permissionDecision?.verifiedBuiltinFullAccess === true,
      ...(turnPermissionSelection
        ? { permissionOverrides: turnPermissionSelection.turnParams }
        : {}),
      previousPermissionContext,
      previousStatus,
      reasoningEffort: effectiveReasoningEffort,
      reasoningSummary: firstTurnReasoningSummary,
      serviceTier: threadStart.serviceTier ?? input.serviceTier,
      threadId,
      threadModel: threadStart.model,
      useAppServerPermissionDefault: input.permissionSelection === null,
      workspaceKind: input.target.workspaceKind,
    });
    void firstTurnPromise.catch(() => undefined);
    input.onThreadCreated?.(threadId);
    if (options.persistClientThreadIdentity !== false) {
      this.persistClientThreadIdentity(threadId, clientThreadId);
    }

    return {
      threadId,
      ...(input.target.workspaceKind === "projectless" &&
      input.target.projectlessOutputDirectory !== null
        ? { projectlessOutputDirectory: input.target.projectlessOutputDirectory }
        : {}),
    };
  }

  private persistClientThreadIdentity(threadId: string, clientThreadId: string): void {
    if (
      !setCodexClientThreadIdentity(this.persistedAtoms, {
        hostId: CODEX_APP_LOCAL_HOST_ID,
        threadId,
        clientThreadId,
      })
    ) {
      throw new Error(`Invalid client thread identity for ${threadId}`);
    }
    this.invalidateSidebarSnapshotCache();
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

  private async captureNodexAgentTurnAuthority(
    params: DynamicToolCallParams,
  ): Promise<FrozenNodexAgentTurnAuthority | null> {
    const rootThreadId = this.resolveNodexAgentRootThreadId(params.threadId);
    const actorProjectId =
      this.parseThreadRef(params.threadId)?.projectId ??
      this.parseThreadRef(rootThreadId)?.projectId ??
      null;
    if (!actorProjectId) return null;
    const captureInput = {
      threadId: params.threadId,
      turnId: params.turnId,
      rootThreadId,
      actorProjectId,
    };
    const persisted = await this.nodexAgentAuthorityRegistry.capturePersisted(captureInput);
    if (persisted) return persisted;
    if (await this.nodexAgentAuthorityRegistry.hasRecordedAuthority(captureInput)) {
      return null;
    }
    return await this.nodexAgentAuthorityRegistry.capture(captureInput);
  }

  private resolveNodexAgentAuthorizationPresentation(
    threadId: string,
    turnId: string,
    rootThreadId: string,
  ): NodexAgentAuthorizationPresentationTarget | null {
    const directClientId = this.rendererConversations.resolvePresentationClient(threadId);
    if (directClientId) {
      return {
        clientId: directClientId,
        threadId,
        turnId,
      };
    }

    if (rootThreadId === threadId) return null;
    const rootClientId = this.rendererConversations.resolvePresentationClient(rootThreadId);
    if (!rootClientId) return null;
    const rootTurnId =
      [...this.listKnownTurns(rootThreadId)].reverse().find((turn) => turn.turnId !== null)
        ?.turnId ?? null;
    if (!rootTurnId) return null;
    return {
      clientId: rootClientId,
      threadId: rootThreadId,
      turnId: rootTurnId,
    };
  }

  private async handleNodexAgentDynamicToolCall(
    params: DynamicToolCallParams,
    frozenAuthority?: FrozenNodexAgentTurnAuthority | null,
  ): Promise<DynamicToolCallResponse> {
    const rootThreadId = this.resolveNodexAgentRootThreadId(params.threadId);
    const authority =
      frozenAuthority === undefined
        ? await this.captureNodexAgentTurnAuthority(params)
        : frozenAuthority;
    const projectId = authority?.actorProjectId ?? null;
    const broker = this.nodexAgentAuthorization;
    const writeAccess: NodexAgentAccess["write"] = resolveNodexAgentWriteAccess({
      authorityScope: authority?.scope ?? null,
      hasActorProject: projectId !== null,
    });
    const access: NodexAgentAccess = {
      read: "allowed",
      write: writeAccess,
      domains: ["document", "placement", "database"],
    };
    const executionContext = await this.projectWorkspace.readThreadExecutionContext(
      params.threadId,
    );
    const toolsetRevision =
      executionContext?.dynamicToolCatalogs.find(
        (catalog) => catalog.namespace === NODEX_APP_TOOL_NAMESPACE,
      )?.toolsetRevision ?? null;
    const taskResourceAccess = authority ? await broker.getTaskAccess(authority) : undefined;

    return await this.controlPlane.runPromise(
      this.nodexAgentDynamicTools.execute(params, {
        toolsetRevision,
        authority,
        access,
        ...(taskResourceAccess ? { resourceAccess: taskResourceAccess } : {}),
        ...(authority
          ? {
              recordTaskResourceAccess: (grants) =>
                Effect.promise(() => broker.extendTaskAccess(authority, grants)),
            }
          : {}),
        resolveResourceAccess: (intents: readonly NodexAgentResourceIntent[]) => {
          if (!authority) {
            return Effect.succeed({
              kind: "denied" as const,
              intent: intents[0] ?? {
                target: { kind: "library", libraryId: "unavailable" },
                action: "read",
              },
              reason: "project_not_found" as const,
            });
          }
          return Effect.promise(async () => {
            const currentTaskAccess = await broker.getTaskAccess(authority);
            return await this.nodexAgentResourceAuthority.plan({
              authority,
              callId: params.callId,
              intents,
              ...(currentTaskAccess ? { taskAccess: currentTaskAccess } : {}),
            });
          });
        },
        authorize: (authorization) =>
          Effect.promise(async () => {
            if (authority?.scope === "library") {
              const current = await this.captureNodexAgentTurnAuthority(params);
              if (canAutoApproveNodexAgentWrite(authority, current)) {
                return { decision: "allow_once" };
              }
              return "unavailable";
            }
            if (!authority) return "unavailable";
            const currentPresentation = this.resolveNodexAgentAuthorizationPresentation(
              params.threadId,
              params.turnId,
              rootThreadId,
            );
            const isAuthorityCurrent = async (): Promise<boolean> => {
              const currentRootThreadId = this.resolveNodexAgentRootThreadId(params.threadId);
              const currentProjectId =
                this.parseThreadRef(params.threadId)?.projectId ??
                this.parseThreadRef(currentRootThreadId)?.projectId ??
                null;
              const currentAuthority = await this.captureNodexAgentTurnAuthority(params);
              return (
                currentRootThreadId === rootThreadId &&
                currentProjectId === projectId &&
                currentAuthority !== null &&
                nodexAgentAuthorityFingerprint(currentAuthority) ===
                  nodexAgentAuthorityFingerprint(authority)
              );
            };
            const decision = await broker.authorize({
              ...authorization,
              rootThreadId,
              authority,
              presentation: currentPresentation,
              isAuthorityCurrent,
            });
            return (await isAuthorityCurrent()) ? decision : "unavailable";
          }),
      }),
    );
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

  private scheduleSidebarNotificationSync(notificationMethod: string, threadId: string): void {
    this.sidebarSync.scheduleNotification({
      notificationMethod,
      threadId,
    });
  }

  recordSidebarNotificationScheduled(input: {
    readonly notificationMethod: string;
    readonly threadId: string;
    readonly minimumSyncGeneration: number;
  }): void {
    this.logger.debug("Scheduling sidebar thread-list sync from app-server notification", {
      ...input,
    });
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
