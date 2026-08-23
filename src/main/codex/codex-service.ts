import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, open as openFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { produceWithPatches } from "immer";
import type {
  CollaborationMode as CodexAppServerCollaborationMode,
  GetAuthStatusResponse,
  RequestId,
} from "@nodex/codex-app-server-protocol";
import type { AppInfo } from "@nodex/codex-app-server-protocol/v2/AppInfo";
import type { ConfigReadParams } from "@nodex/codex-app-server-protocol/v2/ConfigReadParams";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import type { ExternalAgentConfigImportCompletedNotification } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigImportCompletedNotification";
import type { ExternalAgentConfigImportProgressNotification } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigImportProgressNotification";
import type { ExternalAgentConfigMigrationItem } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigMigrationItem";
import type { CommandExecutionRequestApprovalResponse } from "@nodex/codex-app-server-protocol/v2/CommandExecutionRequestApprovalResponse";
import type { DynamicToolCallParams } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import type { FsGetMetadataResponse } from "@nodex/codex-app-server-protocol/v2/FsGetMetadataResponse";
import type { FileChangeRequestApprovalParams } from "@nodex/codex-app-server-protocol/v2/FileChangeRequestApprovalParams";
import type { FileChangeRequestApprovalResponse } from "@nodex/codex-app-server-protocol/v2/FileChangeRequestApprovalResponse";
import type { McpServerElicitationRequestResponse } from "@nodex/codex-app-server-protocol/v2/McpServerElicitationRequestResponse";
import type { ModelListResponse } from "@nodex/codex-app-server-protocol/v2/ModelListResponse";
import type { PermissionsRequestApprovalResponse } from "@nodex/codex-app-server-protocol/v2/PermissionsRequestApprovalResponse";
import type { ThreadListResponse } from "@nodex/codex-app-server-protocol/v2/ThreadListResponse";
import type { ThreadReadResponse } from "@nodex/codex-app-server-protocol/v2/ThreadReadResponse";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { ThreadDeleteResponse } from "@nodex/codex-app-server-protocol/v2/ThreadDeleteResponse";
import type { ThreadListParams } from "@nodex/codex-app-server-protocol/v2/ThreadListParams";
import type { ThreadRollbackResponse } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackResponse";
import type { ThreadSource } from "@nodex/codex-app-server-protocol/v2/ThreadSource";
import type { ThreadSourceKind } from "@nodex/codex-app-server-protocol/v2/ThreadSourceKind";
import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2/ThreadItem";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import type { ThreadResumeParams } from "@nodex/codex-app-server-protocol/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "@nodex/codex-app-server-protocol/v2/ThreadResumeResponse";
import type { ThreadSettings } from "@nodex/codex-app-server-protocol/v2/ThreadSettings";
import type { ThreadSettingsUpdateParams } from "@nodex/codex-app-server-protocol/v2/ThreadSettingsUpdateParams";
import type { ThreadSettingsUpdateResponse } from "@nodex/codex-app-server-protocol/v2/ThreadSettingsUpdateResponse";
import type { Thread } from "@nodex/codex-app-server-protocol/v2/Thread";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@nodex/codex-app-server-protocol/v2/ThreadTurnsListResponse";
import type { Turn } from "@nodex/codex-app-server-protocol/v2/Turn";
import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { TurnSteerParams } from "@nodex/codex-app-server-protocol/v2/TurnSteerParams";
import type { TurnSteerResponse } from "@nodex/codex-app-server-protocol/v2/TurnSteerResponse";
import type { ToolRequestUserInputResponse } from "@nodex/codex-app-server-protocol/v2/ToolRequestUserInputResponse";
import type {
  PageRunInTarget,
  CodexAgentMode,
  CodexAutomationRunsUpdatedEvent,
  CodexApprovalRequest,
  CodexBackgroundTerminalRow,
  CodexCanonicalServerRequest,
  CodexCanonicalConversationState,
  CodexComposerIntent,
  CodexConversationChildMembership,
  CodexConversationCapabilityFlags,
  CodexConversationItem,
  CodexConversationResumeState,
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexConversationTurnPagination,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexConnectionState,
  CodexEvent,
  CodexHeartbeatAutomationCollaborationMode,
  CodexHeartbeatAutomationPermissions,
  CodexHostMessage,
  CodexItemView,
  CodexLiveFileAttachment,
  CodexMcpServerElicitationRequest,
  CodexModelOption,
  CodexPermissionRequest,
  CodexPlanImplementationServerRequest,
  CodexPendingSteer,
  CodexPreparedPrompt,
  CodexPermissionMode,
  CodexPermissionState,
  CodexPersonality,
  CodexProjectlessWorkspace,
  CodexQueuedFollowUp,
  CodexReviewDiffCommentAttachment,
  CodexReasoningEffort,
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  CodexSidebarThreadItem,
  CodexSideChatStartInput,
  CodexSideChatStartResult,
  CodexSteerTurnInput,
  CodexSteeringRestoreMessage,
  CodexSteeringUserInput,
  CodexServiceTier,
  CodexGitSettings,
  CodexTranscriptEntry,
  CodexTranscriptEntrySource,
  CodexThreadActiveFlag,
  CodexThreadActionResult,
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
  CodexScheduledAutomationDeleteStatus,
  CodexScheduledAutomationExecutionEnvironment,
  CodexScheduledAutomationReasoningEffort,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpdateInput,
  CodexScheduledAutomationRunNowInput,
  CodexThreadStartForSessionInput,
  CodexThreadStartForSessionResult,
  CodexThreadStartMemoryPreferences,
  CodexThreadStreamCheckpoint,
  TerminalSessionSnapshot,
  CodexTurnStatus,
  CodexTurnSummary,
  CodexUserAttachment,
  CodexUserInputRequest,
  CodexPromptAgentConfigInput,
  CodexPromptInput,
  CodexPromptTextAttachmentInput,
  Project,
  ProjectSession,
  ProjectSessionSummary,
  ProjectSessionForkInput,
  ProjectSessionForkResult,
  WorktreeStartMode,
} from "../../shared/types";
import type { ComposerCatalogPromiseAdapter } from "../codex-application/ComposerCatalogPromiseAdapter";
import type { CodexApplicationEventPublisher } from "../codex-application/CodexApplicationEventHub";
import type { CodexManualCompactionProjectionPort } from "../codex-application/CodexManualCompactionRuntime";
import type { CodexManualCompactionRuntimePromiseAdapter } from "../codex-application/CodexManualCompactionRuntimePromiseAdapter";
import type { CodexThreadGoalProjectionPort } from "../codex-application/CodexThreadGoalRuntime";
import type { CodexThreadGoalRuntimePromiseAdapter } from "../codex-application/CodexThreadGoalRuntimePromiseAdapter";
import type {
  CodexPreparedThreadSettingsUpdate,
  CodexThreadSettingsUpdateCommand,
} from "../codex-application/CodexThreadSettingsRuntime";
import type { CodexPreparedThreadRollback } from "../codex-application/CodexThreadRollbackCommands";
import { parseCodexPersonality } from "../codex-application/CodexPersonality";
import type { CodexPreferences } from "../codex-application/CodexPreferences";
import type { CodexPermissionsPromiseAdapter } from "../codex-application/CodexPermissionsPromiseAdapter";
import type { AgentProviderRuntimePromiseAdapter } from "../codex-application/AgentProviderRuntimePromiseAdapter";
import type { ManagedWorktreeRuntimePromiseAdapter } from "../codex-application/ManagedWorktreeRuntimePromiseAdapter";
import type { CodexSidebarSweepRuntimePromiseAdapter } from "../codex-application/CodexSidebarSweepRuntimePromiseAdapter";
import type { CodexGitProbePromiseAdapter } from "../codex-application/CodexGitProbePromiseAdapter";
import type { CodexExternalAgentImportRuntimePromiseAdapter } from "../codex-application/CodexExternalAgentImportRuntimePromiseAdapter";
import type { CodexHeartbeatTurnCompletionPromiseAdapter } from "../codex-application/CodexHeartbeatTurnCompletionPromiseAdapter";
import type { CodexStructuredThreadTitlePromiseAdapter } from "../codex-application/CodexStructuredThreadTitlePromiseAdapter";
import type { CodexDynamicToolsLaunchPromiseAdapter } from "../codex-application/CodexDynamicToolsLaunchPromiseAdapter";
import type {
  CodexThreadHandoffPromiseEffects,
  CodexThreadHandoffRuntimePromiseAdapter,
} from "../codex-application/CodexThreadHandoffRuntimePromiseAdapter";
import type { CodexThreadHandoffPreparation } from "../codex-application/CodexThreadHandoffRuntime";
import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserTransferConsumeInput,
  CodexForkBrowserSceneContext,
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
  summarizeCodexPendingWorktreeLabel,
  type CodexPendingStartConversationParamsInput,
  type CodexPendingWorktreeCreateInput,
  type CodexPendingWorktreeCreateResult,
  type CodexPendingWorktreeEntry,
  type CodexPendingWorktreeStartingState,
  type CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";
import {
  createCodexTextUserInput as createTextUserInput,
  prepareCodexPrompt,
} from "../../shared/codex-prompt-preparation";
import { parseCodexThreadTokenUsage } from "../../shared/schemas/codex";
import { ProjectSessionForkInputSchema } from "../../shared/schemas/project-sessions";
import {
  PastedTextAttachmentManager,
  ThreadGoalAttachmentDirectoryManager,
} from "../thread-goal-attachments";
import type { CodexAttachments } from "../codex-application/CodexAttachments";
import type { CodexBackgroundProcessConversationProjection } from "../codex-application/CodexBackgroundProcesses";
import type { CodexPendingServerRequestRuntimeService } from "../codex-application/CodexPendingServerRequestRuntime";
import type {
  CodexPreparedTurnStart,
  CodexPreparedTurnSteer,
  CodexTurnStartOverrides,
} from "../codex-application/CodexTurnCommands";
import type { CodexTurnCommandsPromiseAdapter } from "../codex-application/CodexTurnCommandsPromiseAdapter";
import { SIDE_CHAT_DEVELOPER_INSTRUCTIONS } from "../codex-application/CodexSideChatPolicy";
import type {
  CodexCommittedSideChat,
  CodexPreparedSideChat,
} from "../codex-application/CodexSideChatCommands";
import type {
  CodexCommittedSessionThreadLaunch,
  CodexPreparedSessionThreadLaunch,
  CodexPreparedSessionThreadCompletion,
  CodexSessionThreadLaunchContext,
} from "../codex-application/CodexSessionThreadLaunch";
import { CodexApplicationRequestPending } from "../codex-application/ApprovalCoordinator";
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
  hasCodexSubagentSource,
} from "../../shared/codex-subagent-metadata";
import {
  type CodexNotificationConversationFacts,
  type CodexThreadNotificationEvent,
} from "../../shared/codex-thread-notification";
import {
  hasCodexPendingContinuation,
  parseCodexHeartbeatAssistantMessage,
} from "../../shared/codex-turn-notification";
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
  type CodexItemLifecycleNotification,
} from "../../shared/codex-conversation-state/codex-conversation-reducer";
import {
  appendCodexCanonicalForkedFromConversationItem,
  appendCodexCanonicalWorktreeInitItem,
  canonicalizeCodexCanonicalTurnStates,
  createCodexCanonicalWorkspacePermissionContext,
  createCodexCanonicalHydratedConversationState,
  isCodexCanonicalProtocolItem,
  mergeCodexCanonicalOlderTurnStates,
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
  appendCodexCanonicalOptimisticTurn,
  bindCodexCanonicalOptimisticTurn,
  failCodexCanonicalOptimisticTurn,
} from "../../shared/codex-conversation-state/codex-optimistic-turn";
import { reduceCodexConversationTurnLifecycle } from "../../shared/codex-conversation-state/codex-turn-lifecycle";
import {
  reduceCodexConversationThreadGoalResumeConfirmationDismissed,
  reduceCodexConversationThreadGoalUpdated,
} from "../../shared/codex-conversation-state/codex-thread-metadata";
import { appendCodexCanonicalThreadGoalTranscriptTurn } from "../../shared/codex-conversation-state/codex-thread-goal-transcript";
import { reduceCodexBackgroundTerminalCleanup } from "../../shared/codex-conversation-state/codex-background-terminal-cleanup";
import { projectCodexHistoryRequestViews } from "../../shared/codex-conversation-state/codex-history-request-projection";
import { buildCodexSteeringCompareKey } from "../../shared/codex-conversation-state/codex-steering-compare";
import {
  removeCodexCanonicalSteeringItem,
  upsertCodexCanonicalSteeringItem,
} from "../../shared/codex-conversation-state/codex-steering-state";
import { applyCodexLifecycleProjectionDiff } from "../../shared/codex-conversation-state/codex-lifecycle-projection-diff";
import { buildCodexTurnOccurrenceKey } from "../../shared/codex-turn-identity";
import {
  isCodexFrameTextDeltaNotification,
  toCodexFrameTextDelta,
} from "../../shared/codex-conversation-state/codex-frame-text-delta";
import {
  isCodexCommandOutputNotification,
  reduceCodexConversationTerminalCommands,
  toCodexCommandOutputUpdate,
} from "../../shared/codex-conversation-state/codex-command-execution-stream";
import {
  isCodexFileChangePatchUpdatedNotification,
  isCodexMcpToolCallProgressNotification,
  reduceCodexConversationFileChangePatch,
  reduceCodexConversationMcpToolCallProgress,
  toCodexFileChangePatchUpdate,
  toCodexMcpToolCallProgressUpdate,
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
import { normalizeCodexAppInfoLogos } from "../../shared/codex-app-info";
import { CODEX_INTEGRATION_CAPABILITIES } from "../../shared/codex-integration-capabilities";
import type { CodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { resolveAssetPath } from "../local-store/assets";
import {
  getCodexDeveloperInstructionSettings,
  getCodexGitSettings,
  getKnownManagedWorktreeRoots,
  getNodexHome,
} from "../local-store/config";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerRequest,
  type CodexServerNotification,
} from "../codex-runtime/CodexApplicationProtocol";
import { CodexRpcError } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { CodexSessionStore } from "./codex-session-store";
import {
  createManagedWorktree,
  resolveManagedWorktreeDefaultStartingState,
} from "./git-worktree-service";
import { buildCodexDesktopDeveloperInstructions } from "./codex-developer-instructions";
import {
  resolveCodexForkWorkspaceInheritance,
  type CodexForkWorkspaceInheritance,
} from "./codex-fork-workspace-inheritance";
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
import type { ResolvedCodexRuntime } from "./codex-runtime";
import type { DesktopToolRuntimePromiseAdapter } from "../host-runtime/DesktopToolRuntime";
import type {
  AgentExecutionProfile,
  AgentExecutionProfileChange,
  AgentModelOption,
  AgentProviderCatalog,
} from "../../shared/agent-runtime";
import type { AgentImportProgress } from "../../shared/agent-import";
import type { NativeSessionCandidate } from "./agent-import-operations";
import {
  cleanCodexAutoTitlePrompt,
  CODEX_THREAD_TITLE_PROMPT_MAX_CHARS,
  normalizeCodexManualThreadTitle,
  projectCodexMarkdownToPlainText,
  resolveCodexForkChildThreadTitleFromCatalog,
  resolveCodexForkSourceConversationTitle,
  type CodexForkTitleThread,
} from "../../shared/codex-thread-title";
import { readWorktreeEnvironmentDefinition } from "./worktree-environment-service";
import { getLogger } from "../logging/logger";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { isCodexAppDynamicTool } from "../../shared/codex-dynamic-tool-identity";
import { NODEX_APP_TOOL_NAMESPACE } from "../../shared/nodex-agent-tools/identity";
import type { NodexAgentAccess } from "../../shared/nodex-agent-tools/read-runtime";
import { resolveDynamicToolCatalogBindings } from "./codex-dynamic-tool-catalog-bindings";
import type { NodexAgentAuthorizationPresentationTarget } from "../codex-application/NodexAgentAuthorizationRuntime";
import type { NodexAgentAuthorizationRuntimePromiseAdapter } from "../codex-application/NodexAgentAuthorizationRuntimePromiseAdapter";
import {
  buildNodexAgentDynamicToolSpecs,
  executeNodexAgentDynamicToolCall,
} from "./nodex-agent-dynamic-tool-runtime";
import type { NodexAgentV3DynamicService } from "../agent-tools/dynamic-service-v3";
import {
  buildCodexAppDynamicToolFailure,
  buildCodexAppDynamicToolSuccess,
  buildCodexAppMetaThreadToolSpecs,
  AUTOMATION_UPDATE_TOOL_NAME,
  CODEX_APP_HANDOFF_MAX_WAIT_MS,
  CODEX_APP_LOCAL_HOST_DISPLAY_NAME,
  CODEX_APP_LOCAL_HOST_ID,
  CODEX_APP_READ_THREAD_DEFAULT_MAX_OUTPUT_CHARS,
  CODEX_APP_READ_THREAD_DEFAULT_TURN_LIMIT,
  CODEX_APP_READ_THREAD_MAX_OUTPUT_CHARS,
  CODEX_APP_READ_THREAD_MAX_TURN_LIMIT,
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
  type CodexLaunchPermissionParams,
  type CodexStoredShellEnvironment,
} from "./codex-thread-launch-context";
import {
  CODEX_DEFAULT_FEATURE_OVERRIDES,
  buildCodexThreadConfigOverrides,
} from "./codex-thread-capabilities";
import {
  persistCodexWorktreeShellEnvironment,
  runCodexWorktreeSetupScript,
} from "./codex-worktree-shell-environment";
import type {
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerPort,
  CodexWorktreeWorkerPreparedHandoff,
} from "./codex-worktree-worker-port";
import { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import { CodexCrossHostThreadHandoffService } from "./codex-cross-host-thread-handoff";
import {
  evaluateCodexThreadHandoffCapability,
  type CodexThreadHandoffCapability,
} from "./codex-thread-handoff-capability";
import {
  type CodexThreadExecutionLocation,
  type CodexThreadHandoffJournalEntry,
} from "./codex-thread-handoff-journal";
import {
  normalizeWorktreePathForIdentity,
  resolveWorktreePathComparisonKey,
} from "./codex-managed-worktree-effects";
import {
  createCodexProjectlessWorkspace,
  parseCodexProjectlessWorkspace,
} from "./codex-projectless-workspace";
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
  parseCodexDynamicCreateThreadInput,
  projectCodexDynamicCreateModel,
  validateCodexDynamicCreateModelReasoning,
  type CodexDynamicCreateModelProjection,
  type CodexDynamicCreateThreadInput,
} from "./codex-dynamic-thread-create";
import {
  resolveCodexDynamicCreateTarget,
  type CodexResolvedDynamicDirectThreadTarget,
  type CodexResolvedDynamicThreadTarget,
} from "./codex-dynamic-thread-target";
import {
  buildCodexDynamicCreatePermissionContextForMode,
  buildCodexDynamicPendingPermissionSelection,
  inferCodexDynamicCreatePermissionMode,
  isCodexDynamicCreatePermissionMode,
  resolveCodexDynamicCreatePermissionSelection,
  type CodexDynamicCreatePermissionContext,
  type CodexDynamicCreatePermissionMode,
  type CodexDynamicCreatePermissionSelection,
  type CodexDynamicCreatePermissionSource,
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
import type { ConversationCommandsPromiseAdapter } from "../codex-application/ConversationCommandsPromiseAdapter";
import type { CodexPostResumeGoalRuntimePromiseAdapter } from "../codex-application/CodexPostResumeGoalRuntimePromiseAdapter";
import type { CodexConversationHistoryRuntimePromiseAdapter } from "../codex-application/CodexConversationHistoryRuntimePromiseAdapter";
import type { CodexBackgroundSubagentMetadataRepair } from "../codex-application/CodexBackgroundSubagentMetadataRepair";
import type { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import type { CodexQueuedFollowUpRuntimePromiseAdapter } from "../codex-application/CodexQueuedFollowUpRuntimePromiseAdapter";
import type { CodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import type {
  CodexConversationResumeDemand,
  CodexConversationResumeOutcome,
} from "../codex-application/CodexConversationResumeRuntime";
import type { CodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import {
  projectCodexGatewayThreadReadThread,
  type CodexGatewayThreadReadThread,
} from "../codex-runtime/CodexGatewayProtocolProjection";
import type {
  CodexBufferedConversationEvent,
  CodexBufferedConversationRequest,
  CodexConversationEventBufferPhase,
} from "../codex-application/CodexConversationEventBufferRuntime";
import type { CodexConversationEventBufferRuntimePromiseAdapter } from "../codex-application/CodexConversationEventBufferRuntimePromiseAdapter";
import type {
  CodexFreshThreadLaunch,
  CodexPreparedFreshThreadFirstTurn,
} from "../codex-application/CodexFreshThreadLaunchRuntime";
import type { CodexFreshThreadLaunchRuntimePromiseAdapter } from "../codex-application/CodexFreshThreadLaunchRuntimePromiseAdapter";
import {
  isExecutionWorkspacePathWithinRoot,
  rewriteExecutionWorkspaceRoots,
} from "./codex-execution-workspace-roots";
import {
  allocateCodexPendingWorktreeRequest,
  appendCodexPendingPastedTextAttachments,
  buildCodexPendingComposerPrompt,
  buildCodexPendingFirstTurnAttachments,
  buildCodexPendingStartConversationParams,
  buildCodexPendingThreadStartConfig,
  dedupeCodexLiveFileAttachments,
  projectCodexPendingThreadStart,
  projectCodexPendingWorktreeLaunchLocation,
  shouldSendCodexPendingPermissionOverrides,
} from "./codex-pending-worktree-request";
import { captureCodexOrdinaryBrowserTransfer } from "./codex-browser-transfer-capture";
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

interface CodexDynamicCreateDestinationSnapshot {
  readonly rawConfig: ConfigReadResponse["config"];
  readonly expandedConfig: ConfigReadResponse["config"];
}

interface CodexDynamicToolExecutionContext {
  readonly permissionMode?: CodexDynamicCreatePermissionMode;
  readonly serviceTierSelector?: CodexCreateThreadServiceTierSelector;
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

type AutomationUpdateMode =
  | "list"
  | "view"
  | "create"
  | "suggested_create"
  | "update"
  | "suggested_update"
  | "delete";

type AutomationUpdateDestination = "local" | "worktree" | "thread";

type ParsedAutomationUpdateArgs =
  | { mode: "list"; query: string | null; limit: number }
  | { mode: "view"; id: string }
  | { mode: "delete"; id: string }
  | ParsedAutomationUpdateUpsertArgs;

interface ParsedAutomationUpdateUpsertArgs {
  mode: "create" | "suggested_create" | "update" | "suggested_update";
  id?: string;
  kind: "cron" | "heartbeat";
  name: string;
  prompt: string;
  rrule: string;
  status: CodexScheduledAutomationStatus;
  cwds?: string[];
  destination?: AutomationUpdateDestination;
  executionEnvironment?: CodexScheduledAutomationExecutionEnvironment;
  localEnvironmentConfigPath?: string | null;
  model?: string | null;
  reasoningEffort?: CodexScheduledAutomationReasoningEffort | null;
  targetThreadId?: string;
}

interface AutomationUpdateToolResult {
  automationId: string;
  mode?: "create" | "update" | "delete";
  deleteStatus?: "deleted" | "not_found";
  snapshot?: {
    kind: "cron" | "heartbeat";
    name: string;
    rrule: string | null;
  } | null;
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

interface HandleNotificationOptions {
  bypassResumeBuffer?: boolean;
}

type StartTurnOverrides = CodexTurnStartOverrides;

interface DormantConversationSyncOptions {
  syncDormantConversationUpdates?: boolean;
}

interface MainOwnedStartTurnOptions extends DormantConversationSyncOptions {
  stateOwner?: "main";
}

interface RendererOwnedStartTurnOptions {
  stateOwner: "renderer";
}

interface ResolvedThreadRunLocation {
  cwd: string;
  workspaceRoots: string[];
  runInTarget: PageRunInTarget;
  managedWorktreePath: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
}

interface ThreadStartProgressUpdate {
  runInTarget?: PageRunInTarget;
  threadId?: string | null;
  phase: CodexThreadStartProgressPhase;
  message: string;
  stream?: CodexThreadStartProgressStream;
  outputDelta?: string;
  clearOutput?: boolean;
}

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

interface InternalThreadMetadata {
  kind: "thread-title" | "non-sidebar";
  threadSource: ThreadSource | null;
  ephemeral: boolean;
  createdAt: number;
}

type CodexBrowserTransferStateReader = Pick<
  CodexForkBrowserRuntime,
  "getBrowserUseStateSnapshot" | "getStateSnapshot"
>;

type CodexManagedWorktreeSettingsPort = {
  readonly listKnownRoots: () => string[];
};

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
  turnCommands: CodexTurnCommandsPromiseAdapter;
  persistedAtoms: PersistedAtomStore;
  sessionStore: CodexSessionStore;
  runtime: ResolvedCodexRuntime;
  runtimeStateHome: string;
  nodexAgentDynamicService: NodexAgentV3DynamicService | null;
  nodexAgentAuthority: NodexAgentAuthorityPort;
  nodexAgentResourceAuthority: NodexAgentResourceAuthorityPort;
  nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  automationModule: DesktopAutomationModulePort;
  projectWorkspace: DesktopProjectWorkspacePort;
  activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  rendererConversations: CodexRendererConversationRegistryService;
  rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  sidebarSync: CodexSidebarSyncRuntimePromiseAdapter;
  sidebarSweep: CodexSidebarSweepRuntimePromiseAdapter;
  gitProbe: CodexGitProbePromiseAdapter;
  externalAgentImport: CodexExternalAgentImportRuntimePromiseAdapter;
  heartbeatTurnCompletion: CodexHeartbeatTurnCompletionPromiseAdapter;
  structuredThreadTitle: CodexStructuredThreadTitlePromiseAdapter;
  dynamicToolsLaunch: CodexDynamicToolsLaunchPromiseAdapter;
  threadHandoffRuntime: CodexThreadHandoffRuntimePromiseAdapter;
  pendingWorktrees: CodexPendingWorktreeRuntimePromiseAdapter;
  threadSettingsRuntime: CodexThreadSettingsRuntimePromiseAdapter;
  threadTitlePersistence: CodexThreadTitlePersistencePromiseAdapter;
  threadCatalog: CodexThreadCatalogPromiseAdapter;
  conversationCommands: ConversationCommandsPromiseAdapter;
  postResumeGoals: CodexPostResumeGoalRuntimePromiseAdapter;
  conversationHistory: CodexConversationHistoryRuntimePromiseAdapter;
  backgroundSubagentMetadataRepair: CodexBackgroundSubagentMetadataRepair["Service"];
  subagentCatalog: CodexSubagentCatalog["Service"];
  queuedFollowUps: CodexQueuedFollowUpRuntimePromiseAdapter;
  conversationDeltaBuffer: CodexConversationDeltaBufferRuntime["Service"];
  conversationResume: CodexConversationResumeRuntimePromiseAdapter;
  conversationEventBuffer: CodexConversationEventBufferRuntimePromiseAdapter;
  freshThreadLaunch: CodexFreshThreadLaunchRuntimePromiseAdapter;
  manualCompaction: CodexManualCompactionRuntimePromiseAdapter;
  threadGoals: CodexThreadGoalRuntimePromiseAdapter;
  supportsChatGptApps?: boolean;
  isOpenAIFormElicitationsEnabled?: () => boolean;
  gitSettingsResolver?: () => CodexGitSettings;
  managedWorktreeSettingsPort?: CodexManagedWorktreeSettingsPort;
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
  loadWorktreeSetupBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  executionHosts: CodexExecutionHostRegistry;
  managedWorktrees: ManagedWorktreeRuntimePromiseAdapter;
  requestManagedWorktreeRetention: () => void;
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

interface CodexOlderTurnHydrationContext {
  readonly model: string;
  readonly reasoningEffort: NonNullable<TurnStartParams["effort"]> | null;
  readonly cwd: string;
  readonly approvalPolicy: NonNullable<TurnStartParams["approvalPolicy"]>;
  readonly approvalsReviewer: NonNullable<TurnStartParams["approvalsReviewer"]>;
  readonly sandboxPolicy: NonNullable<TurnStartParams["sandboxPolicy"]>;
}

interface SideChatDetailInput {
  parentThreadId: string;
  projectId: string | null;
  projectlessOutputDirectory: string | null;
  projectlessWorkspaceBrowserRoot: string | null;
  parentNavigationPath: string | null;
  forkResponse: ThreadForkResponse;
  resolvedCwd: string | null;
  latestCollaborationMode: CodexCollaborationModeState;
  executionProfile: AgentExecutionProfile | null;
}

interface SideChatParentWorkspace {
  readonly cwd: string;
  readonly inheritance: CodexForkWorkspaceInheritance;
  readonly workspaceRoots: readonly string[];
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
const WORKTREE_LOG_STATUS_MESSAGE = "Creating a worktree and running setup.";
const CODEX_SAME_DIRECTORY_FORK_CONTINUATION =
  "The fork contains completed history only. If the source thread was running, the active turn and unfinished response are not in the child. Send a follow-up message to threadId only if the task requires work to continue there.";

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

function hasPendingSteeringTranscriptEntry(entries: readonly CodexTranscriptEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.steeringStatus === "pending") return true;
    const rawItem = asRecord(entry.rawItem);
    return rawItem?.type === "steeringUserMessage" && rawItem.status === "pending";
  });
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

function isSubagentThreadSpawnSource(source: unknown): boolean {
  return extractCodexThreadSubagentMetadata({ source }).parentThreadId !== null;
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

function hasNestedRolloutMaterializationError(error: unknown): boolean {
  let current: unknown = error;
  const visited = new Set<object>();
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error && isRolloutMaterializationMessage(current.message)) return true;
    const record = current as { readonly cause?: unknown; readonly message?: unknown };
    if (typeof record.message === "string" && isRolloutMaterializationMessage(record.message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function isThreadNotFoundError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("thread not found") ||
    (message.includes("thread") && message.includes("not found"))
  );
}

function isThreadArchivedError(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes(" is archived") ||
    (message.includes("session") && message.includes("archived"))
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

function previewText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isPathWithinOrEqual(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeCodexServiceTier(value: unknown): CodexServiceTier {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized !== "standard" ? normalized : null;
}

function formatServiceTierForReporting(value: unknown): string {
  return normalizeCodexServiceTier(value) ?? "standard";
}

function buildServiceTierParams(value: unknown): { serviceTier?: string } {
  const normalized = normalizeCodexServiceTier(value);
  return normalized ? { serviceTier: normalized } : {};
}

function preserveSupportedAgentProfileValue(
  current: string | null,
  requestedFallback: string | null,
  supported: readonly { readonly value: string | null }[],
): string | null {
  if (current === null) return null;
  return supported.some((option) => option.value === current) ? current : requestedFallback;
}

function mergeAgentModelChange(
  current: AgentExecutionProfile,
  requested: AgentExecutionProfile,
  model: AgentModelOption | null,
): AgentExecutionProfile {
  if (!model) {
    return {
      ...requested,
      providerId: current.providerId,
      harnessId: current.harnessId,
    };
  }

  return {
    ...current,
    modelId: requested.modelId,
    reasoningEffort: preserveSupportedAgentProfileValue(
      current.reasoningEffort,
      requested.reasoningEffort,
      model.supportedReasoningEfforts,
    ),
    serviceTier: preserveSupportedAgentProfileValue(
      current.serviceTier,
      requested.serviceTier,
      model.supportedServiceTiers,
    ),
  };
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

function parseEventTurnId(eventParams: Record<string, unknown> | null): string | null {
  if (!eventParams) return null;
  if (typeof eventParams.turnId === "string") return eventParams.turnId;
  const turn = asRecord(eventParams.turn);
  return typeof turn?.id === "string" ? turn.id : null;
}

function buildAutoTitlePromptFromTextItems(inputItems: readonly CodexUserInputItem[]): string {
  const rawPrompt = inputItems
    .map((item) => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
  if (!rawPrompt) return "";

  const cleaned = cleanCodexAutoTitlePrompt(rawPrompt, rawPrompt.length).trim();
  return cleaned.length > CODEX_THREAD_TITLE_PROMPT_MAX_CHARS
    ? cleaned.slice(0, CODEX_THREAD_TITLE_PROMPT_MAX_CHARS)
    : cleaned;
}

function buildInitialAutoTitlePromptItems(input: {
  promptText: string;
  promptInput?: CodexPromptInput;
}): CodexUserInputItem[] {
  const textItems = input.promptText.trim() ? [createTextUserInput(input.promptText.trim())] : [];
  const pastedTextExcerpts = (input.promptInput?.textAttachments ?? [])
    .map((attachment) =>
      ("text" in attachment ? attachment.text.trim() : attachment.preview.trim()).slice(
        0,
        CODEX_THREAD_TITLE_PROMPT_MAX_CHARS,
      ),
    )
    .filter((text) => text.length > 0);
  if (pastedTextExcerpts.length === 0) {
    return textItems;
  }

  return [...textItems, createTextUserInput(`\n\n${pastedTextExcerpts.join("\n\n")}`)];
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

interface CodexTurnStartTransactionState {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly rendererOwnsState: boolean;
  readonly syncDormantConversationUpdates: boolean;
  readonly record: CodexConversationRecord;
  readonly promptText: string;
  readonly permissionDecision: {
    readonly state: CodexPermissionState;
    readonly verifiedBuiltinFullAccess: boolean;
  };
  readonly permissionMode: CodexPermissionMode;
  readonly effectiveModel: string | null;
  readonly effectiveServiceTier: CodexServiceTier;
  readonly effectiveReasoningEffort: CodexReasoningEffort | null | undefined;
  readonly effectiveCollaborationMode: CodexCollaborationModeKind | null | undefined;
  readonly reasoningSummary: TurnStartParams["summary"];
  readonly collaborationMode: TurnStartParams["collaborationMode"] | null;
  readonly clientUserMessageId: string;
  canonicalParams: CodexCanonicalLiveTurnParams<
    CodexLiveFileAttachment,
    CodexReviewDiffCommentAttachment
  > | null;
  readonly startedAt: number;
  workspacePath: string | null;
  workspaceRoots: string[];
  turnPermissionOverrides: Partial<TurnStartParams>;
  authorityLaunch: NodexAgentTurnAuthorityLaunch | null | undefined;
  optimisticStartedAt: number | null;
  protocolCommitted: boolean;
  readonly buildRequest: () => TurnStartParams;
}

interface CodexTurnSteerTransactionState {
  readonly threadId: string;
  readonly expectedTurnId: string;
  readonly steerId: string;
  readonly syncDormantConversationUpdates: boolean;
  readonly canonicalSteer: CodexCanonicalSteeringUserMessageItem;
  optimisticAdmitted: boolean;
}

interface CodexSideChatPreparationState {
  readonly input: CodexSideChatStartInput;
  readonly parentWorkspace: SideChatParentWorkspace;
  readonly latestCollaborationMode: CodexCollaborationModeState;
  readonly executionProfile: AgentExecutionProfile | null;
  readonly startedAt: number;
}

interface CodexSideChatCommittedState extends CodexSideChatPreparationState {
  readonly threadId: string;
}

interface CodexSessionThreadLaunchBaseState {
  readonly input: CodexThreadStartForSessionInput;
  readonly context: CodexSessionThreadLaunchContext;
  readonly session: ProjectSession;
  readonly preparedPrompt: PreparedPromptForTurn;
  readonly effectiveModel: string | null;
  readonly effectiveReasoningEffort: CodexReasoningEffort | undefined;
  readonly effectiveCollaborationMode: CodexCollaborationModeKind | undefined;
  readonly executionProfile: AgentExecutionProfile | null;
  readonly explicitThreadName: string | null;
  readonly startedAt: number;
}

type CodexSessionPendingWorktreePreparationState = CodexSessionThreadLaunchBaseState;

interface CodexSessionThreadLaunchPreparationState extends CodexSessionThreadLaunchBaseState {
  readonly prompt: string;
  readonly materializedGoalObjective: string;
  readonly runLocation: ResolvedThreadRunLocation;
  readonly permissionDecision: {
    readonly state: CodexPermissionState;
    readonly verifiedBuiltinFullAccess: boolean;
  };
  readonly turnPermissionOverrides: ReturnType<typeof buildTurnPermissionOverrides>;
}

interface CodexSessionThreadLaunchCommittedState extends CodexSessionThreadLaunchPreparationState {
  readonly threadStart: ThreadStartResponse;
  readonly link: CodexThreadSummary;
  readonly effectiveCwd: string;
}

interface CodexFreshThreadFirstTurnTransactionState {
  readonly launch: CodexFreshThreadLaunch;
  authorityLaunch: NodexAgentTurnAuthorityLaunch | null;
  protocolAccepted: boolean;
}

interface CodexThreadRollbackTransactionState {
  readonly threadId: string;
  readonly fallbackRef: ThreadRef | null;
  readonly fallbackCwd: string | null;
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

async function runWorktreeSetupScript(input: {
  script: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  loadBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  signal?: AbortSignal;
  onOutput?: (output: { stream: "stdout" | "stderr"; data: string }) => void;
}): Promise<CodexStoredShellEnvironment | null> {
  const startedAt = Date.now();
  codexLogger.info("Starting worktree setup script", {
    cwd: input.cwd,
    scriptPreview: previewText(input.script, 200),
  });
  try {
    const shellEnvironment = await runCodexWorktreeSetupScript({
      ...input,
      onCaptureError: (error) => {
        codexLogger.warn("Failed to capture worktree shell environment", {
          cwd: input.cwd,
          error,
        });
      },
      onShellEnvironmentError: (error) => {
        codexLogger.warn("Failed to load interactive login-shell environment", {
          cwd: input.cwd,
          error,
        });
      },
    });
    if (input.signal?.aborted) {
      throw new Error("Request canceled");
    }
    codexLogger.info("Worktree setup script completed", {
      cwd: input.cwd,
      durationMs: Date.now() - startedAt,
    });
    return shellEnvironment;
  } catch (error) {
    codexLogger.error("Worktree setup script failed", {
      cwd: input.cwd,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
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

function normalizeThreadSettingsModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
  private readonly nodexAgentDynamicService: NodexAgentV3DynamicService | null;
  private readonly runtimeVersion: string | null;
  private readonly desktopTools: DesktopToolRuntimePromiseAdapter;
  private readonly activeGoalContinuation: CodexActiveGoalContinuationLegacyPort;
  private readonly ownerNotificationDrain: CodexOwnerNotificationDrainRuntimePromiseAdapter;
  private readonly rendererConversations: CodexRendererConversationRegistryService;
  private readonly rendererConversationCoordinator: CodexRendererConversationCoordinatorService;
  private readonly sidebarSync: CodexSidebarSyncRuntimePromiseAdapter;
  private readonly sidebarSweep: CodexSidebarSweepRuntimePromiseAdapter;
  private readonly gitProbe: CodexGitProbePromiseAdapter;
  private readonly externalAgentImport: CodexExternalAgentImportRuntimePromiseAdapter;
  private readonly heartbeatTurnCompletion: CodexHeartbeatTurnCompletionPromiseAdapter;
  private readonly structuredThreadTitle: CodexStructuredThreadTitlePromiseAdapter;
  private readonly dynamicToolsLaunch: CodexDynamicToolsLaunchPromiseAdapter;
  private readonly supportsChatGptApps: boolean;
  private readonly isOpenAIFormElicitationsEnabled: () => boolean;
  private readonly gitSettingsResolver: () => CodexGitSettings;
  private readonly managedWorktreeSettingsPort: CodexManagedWorktreeSettingsPort;
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
  private readonly turnCommands: CodexTurnCommandsPromiseAdapter;
  private readonly persistedAtoms: PersistedAtomStore;
  private readonly sessionStore: CodexSessionStore;
  private readonly loadWorktreeSetupBaseEnvironment: (() => Promise<NodeJS.ProcessEnv>) | undefined;
  private readonly executionHosts: CodexExecutionHostRegistry;
  private readonly managedWorktreeLifecycle: ManagedWorktreeRuntimePromiseAdapter;
  private readonly requestManagedWorktreeRetention: () => void;
  private readonly crossHostThreadHandoff: CodexCrossHostThreadHandoffService;
  private readonly threadHandoffRuntime: CodexThreadHandoffRuntimePromiseAdapter;
  private readonly browserTransferStateReader: CodexServiceOptions["browserTransferStateReader"];
  private readonly forkSidePanelTransferLifecycle: CodexServiceOptions["forkSidePanelTransferLifecycle"];
  private readonly terminalRuntime: NonNullable<CodexServiceOptions["terminalRuntime"]>;
  private readonly nodexAgentAuthorization: NodexAgentAuthorizationRuntimePromiseAdapter;
  private readonly automationModule: DesktopAutomationModulePort;
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
  private readonly conversationCommands: ConversationCommandsPromiseAdapter;
  private readonly postResumeGoals: CodexPostResumeGoalRuntimePromiseAdapter;
  private readonly conversationHistory: CodexConversationHistoryRuntimePromiseAdapter;
  private readonly backgroundSubagentMetadataRepair: CodexBackgroundSubagentMetadataRepair["Service"];
  private readonly subagentCatalog: CodexSubagentCatalog["Service"];
  private readonly queuedFollowUps: CodexQueuedFollowUpRuntimePromiseAdapter;
  private readonly conversationDeltaBuffer: CodexConversationDeltaBufferRuntime["Service"];
  private readonly conversationResume: CodexConversationResumeRuntimePromiseAdapter;
  private readonly conversationEventBuffer: CodexConversationEventBufferRuntimePromiseAdapter;
  private readonly freshThreadLaunch: CodexFreshThreadLaunchRuntimePromiseAdapter;
  private readonly manualCompaction: CodexManualCompactionRuntimePromiseAdapter;
  private readonly threadGoals: CodexThreadGoalRuntimePromiseAdapter;
  private readonly internalThreadIds = new Map<string, InternalThreadMetadata>();
  private readonly deletedThreadIds = new Set<string>();
  private readonly inheritedNodexAuthorityBySubagentThreadId = new Map<
    string,
    FrozenNodexAgentTurnAuthority
  >();
  private readonly userInputAutoResolution: CodexUserInputAutoResolutionLegacyPort;
  private readonly terminalInputBuffers = new Map<string, string>();
  private lastConnectionStatus: CodexConnectionState["status"] = "disconnected";
  private sidebarUseStateDbOnlyThreadList = true;

  /** Temporary canonical projection port while conversation state is still owned by this class. */
  readonly manualCompactionProjection: CodexManualCompactionProjectionPort = {
    read: (threadId) => this.readCanonicalConversationState(threadId) ?? null,
    commit: (input) => this.commitCanonicalLocalTurnMutation(input),
    publish: (threadId, turnId) => {
      if (turnId === null) {
        this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
        return;
      }
      this.syncAcceptedConversationTurnState(threadId, turnId, {
        syncBackgroundTerminalRows: true,
        syncCapabilityFlags: true,
      });
    },
  };

  /** Temporary canonical projection port while conversation state is still owned by this class. */
  readonly threadGoalProjection: CodexThreadGoalProjectionPort = {
    applySet: ({ threadId, goal, appendTranscriptItem, dismissResumeConfirmation, objective }) => {
      const record = this.getMaybeConversationRecord(threadId);
      const before = record ? this.readCanonicalConversationState(record.threadId) : null;
      if (record && before) {
        const updated = reduceCodexConversationThreadGoalUpdated(before, threadId, goal).state;
        this.acceptCanonicalConversationState(
          threadId,
          dismissResumeConfirmation
            ? reduceCodexConversationThreadGoalResumeConfirmationDismissed(updated, threadId)
            : updated,
        );
        this.projectCanonicalMainThreadMetadata(threadId);
      } else {
        this.applyThreadGoalUpdated(threadId, goal);
        if (dismissResumeConfirmation && record) record.threadGoalResumeConfirmation = null;
      }
      if (appendTranscriptItem && objective !== null) {
        this.appendThreadGoalTranscriptTurn(threadId, goal);
      }
      this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
    },
  };

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
    this.nodexAgentDynamicService = options.nodexAgentDynamicService;
    this.nodexAgentAuthorityRegistry = options.nodexAgentAuthority;
    this.nodexAgentResourceAuthority = options.nodexAgentResourceAuthority;
    this.nodexAgentAuthorization = options.nodexAgentAuthorization;
    this.automationModule = options.automationModule;
    this.projectWorkspace = options.projectWorkspace;
    this.executionHosts = options.executionHosts;
    this.attachments = options.attachments;
    this.pendingServerRequests = options.pendingServerRequests;
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
    this.externalAgentImport = options.externalAgentImport;
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
    this.conversationHistory = options.conversationHistory;
    this.backgroundSubagentMetadataRepair = options.backgroundSubagentMetadataRepair;
    this.subagentCatalog = options.subagentCatalog;
    this.queuedFollowUps = options.queuedFollowUps;
    this.conversationDeltaBuffer = options.conversationDeltaBuffer;
    this.conversationResume = options.conversationResume;
    this.conversationEventBuffer = options.conversationEventBuffer;
    this.freshThreadLaunch = options.freshThreadLaunch;
    this.manualCompaction = options.manualCompaction;
    this.threadGoals = options.threadGoals;
    this.supportsChatGptApps =
      options?.supportsChatGptApps ?? CODEX_INTEGRATION_CAPABILITIES.chatGptApps;
    this.isOpenAIFormElicitationsEnabled = options?.isOpenAIFormElicitationsEnabled ?? (() => true);
    this.gitSettingsResolver = options?.gitSettingsResolver ?? getCodexGitSettings;
    this.managedWorktreeSettingsPort = options?.managedWorktreeSettingsPort ?? {
      listKnownRoots: getKnownManagedWorktreeRoots,
    };
    this.projectAwareDeveloperInstructionsResolver =
      options?.projectAwareDeveloperInstructionsResolver ?? null;
    this.threadCodexConfigBuilder =
      options?.threadCodexConfigBuilder ?? (() => this.desktopTools.threadConfig());
    this.projectlessHomeDirectory = options?.projectlessHomeDirectory ?? homedir;
    this.loadWorktreeSetupBaseEnvironment = options?.loadWorktreeSetupBaseEnvironment;
    this.managedWorktreeLifecycle = options.managedWorktrees;
    this.requestManagedWorktreeRetention = options.requestManagedWorktreeRetention;
    this.crossHostThreadHandoff = new CodexCrossHostThreadHandoffService({
      executionHosts: this.executionHosts,
      relayBaseRoot: path.join(this.runtimeStateHome, "handoffs"),
    });
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

  observeConnection(connection: CodexConnectionState): void {
    const wasConnected = this.lastConnectionStatus === "connected";
    this.lastConnectionStatus = connection.status;
    if (wasConnected && connection.status !== "connected") {
      this.userInputAutoResolution.handleDisconnect();
      this.clearPendingServerRequestsAfterDisconnect();
    }
    this.emitEvent({ type: "connection", connection });
    if (connection.status !== "connected" || connection.retries <= 0 || wasConnected) return;
    this.markConversationsNeedResumeAfterReconnect();
    void this.sidebarSync.sync({
      policy: "stale",
      reason: "app-server-reconnect",
    });
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
    return this.automationModule.peekRunAutomationId(threadId);
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

  private markInternalThread(
    threadId: string,
    metadata: Omit<InternalThreadMetadata, "createdAt">,
  ): void {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    this.internalThreadIds.set(normalizedThreadId, {
      ...metadata,
      createdAt: Date.now(),
    });
  }

  private clearInternalThread(threadId: string): void {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    this.internalThreadIds.delete(normalizedThreadId);
  }

  registerStructuredThreadTitleThread(threadId: string): void {
    this.markInternalThread(threadId, {
      kind: "thread-title",
      threadSource: "system",
      ephemeral: true,
    });
  }

  releaseStructuredThreadTitleThread(threadId: string): void {
    this.clearInternalThread(threadId);
  }

  private registerInternalThreadFromStartedNotification(
    notification: CodexServerNotification,
  ): void {
    if (notification.method !== "thread/started") return;
    const thread = asRecord(notification.params.thread);
    if (!thread) return;

    const threadSource = parseThreadSourceValue(thread.threadSource);
    const isThreadTitleHelper = thread.ephemeral === true && threadSource === "system";
    const isNonSidebarHelper =
      !parseThreadParentThreadId(thread) && isNonSidebarThreadWithoutParent(thread);
    if (!isThreadTitleHelper && !isNonSidebarHelper) return;

    const threadId = typeof thread.id === "string" ? thread.id : null;
    if (!threadId) return;

    this.markInternalThread(threadId, {
      kind: isThreadTitleHelper ? "thread-title" : "non-sidebar",
      threadSource,
      ephemeral: thread.ephemeral === true,
    });
  }

  private async registerSubagentThreadFromStartedNotification(
    notification: CodexServerNotification,
  ): Promise<void> {
    if (notification.method !== "thread/started") return;
    const thread = asRecord(notification.params.thread);
    if (
      !thread ||
      (!parseThreadParentThreadId(thread) &&
        !isSubagentThreadSpawnSource(thread.source) &&
        !hasCodexSubagentSource(thread.source))
    )
      return;

    const threadId = typeof thread.id === "string" ? thread.id.trim() : "";
    if (threadId.length === 0) return;
    this.subagentCatalog.observe(threadId);
    const parentThreadId = parseThreadParentThreadId(thread);
    if (!parentThreadId || this.inheritedNodexAuthorityBySubagentThreadId.has(threadId)) {
      return;
    }
    const parentTurnId =
      [...this.listKnownTurns(parentThreadId)]
        .reverse()
        .find((turn) => turn.status === "inProgress" && turn.turnId)?.turnId ?? null;
    if (!parentTurnId) return;
    const parentRootThreadId = this.resolveNodexAgentRootThreadId(parentThreadId);
    const parentProjectId =
      this.parseThreadRef(parentThreadId)?.projectId ??
      this.parseThreadRef(parentRootThreadId)?.projectId ??
      null;
    if (!parentProjectId) return;
    const parentAuthority = await this.nodexAgentAuthorityRegistry.capture({
      threadId: parentThreadId,
      turnId: parentTurnId,
      rootThreadId: parentRootThreadId,
      actorProjectId: parentProjectId,
    });
    if (parentAuthority?.scope !== "library") return;
    this.inheritedNodexAuthorityBySubagentThreadId.set(threadId, parentAuthority);
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

  async routeAppServerNotification(notification: CodexServerNotification): Promise<void> {
    if (notification.method === "turn/started") {
      const params = asRecord(notification.params);
      const threadId = parseEventThreadId(params);
      const turnId = parseEventTurnId(params);
      if (threadId && turnId) {
        try {
          const inherited = this.inheritedNodexAuthorityBySubagentThreadId.get(threadId);
          if (inherited) {
            this.inheritedNodexAuthorityBySubagentThreadId.delete(threadId);
            await this.nodexAgentAuthorityRegistry.inheritTurn(
              {
                threadId,
                turnId,
                rootThreadId: inherited.rootThreadId,
                actorProjectId: inherited.actorProjectId,
              },
              inherited,
            );
          } else {
            await this.nodexAgentAuthorityRegistry.observeTurnStarted(threadId, turnId);
          }
        } catch (error) {
          this.logger.error("Failed to bind Nodex Agent Turn authority", {
            threadId,
            turnId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.registerInternalThreadFromStartedNotification(notification);
    await this.registerSubagentThreadFromStartedNotification(notification);
    const threadId = this.resolveNotificationThreadId(notification);
    if (threadId && this.internalThreadIds.has(threadId)) {
      this.logger.debug("Suppressed internal Codex thread notification from visible pipeline", {
        threadId,
        method: notification.method,
        kind: this.internalThreadIds.get(threadId)?.kind ?? null,
      });
      return;
    }
    if (this.subagentCatalog.shouldDropDelta(notification.method, threadId)) {
      this.logger.debug("Dropped unopened background subagent delta notification", {
        threadId,
        method: notification.method,
        reason: "background_subagent_delta_filter",
      });
      return;
    }

    await this.handleNotification(notification);
  }

  private emitHostMessage(message: CodexHostMessage): void {
    this.applicationEvents.publish({ kind: "hostMessage", value: message });
  }

  private beginResumeNotificationBuffer(threadId: string): boolean {
    return this.conversationEventBuffer.beginResume(threadId);
  }

  private hasResumeNotificationBuffer(threadId: string): boolean {
    return this.conversationEventBuffer.hasResume(threadId);
  }

  private beginThreadStartNotificationDeferral(): void {
    this.conversationEventBuffer.beginThreadStartDeferral();
  }

  private bufferNotificationForReplayIfNeeded(
    notification: CodexServerNotification,
    options: HandleNotificationOptions = {},
  ): boolean {
    const threadId = parseEventThreadId(asRecord(notification.params));
    if (!threadId) return false;
    return this.conversationEventBuffer.offerNotification({
      threadId,
      notification,
      bypassResume: options.bypassResumeBuffer,
      startsThread: notification.method === "thread/started",
    });
  }

  private async completeThreadStartNotificationDeferral(threadId: string | null): Promise<void> {
    await this.conversationEventBuffer.completeThreadStartDeferral(threadId);
  }

  private async endThreadStartNotificationDeferral(): Promise<void> {
    await this.conversationEventBuffer.endThreadStartDeferral();
  }

  private bufferServerRequestForReplayIfNeeded(request: CodexServerRequest): boolean {
    const threadId = this.resolveServerRequestThreadId(request);
    if (!threadId) return false;
    return this.conversationEventBuffer.offerRequest({
      threadId,
      request,
      completion: () =>
        this.pendingServerRequests.completion(
          threadId,
          request.id,
          request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
        ),
    });
  }

  private async replayBufferedResumeNotifications(threadId: string): Promise<void> {
    await this.conversationEventBuffer.releaseResume(threadId);
  }

  private async releaseConversationResumeBufferCore(threadId: string): Promise<void> {
    await this.replayBufferedResumeNotifications(threadId);
    await this.waitForRendererOwnerNotificationDrain(threadId);
    this.rendererConversationCoordinator.reconcileOwnership(threadId);
  }

  private discardConversationResumeBuffer(threadId: string, reason: unknown): void {
    this.conversationEventBuffer.discardResume(threadId, reason);
    this.rendererConversationCoordinator.reconcileOwnership(threadId);
  }

  async releaseConversationResumeBufferForModule(threadId: string): Promise<boolean> {
    await this.releaseConversationResumeBufferCore(threadId);
    const revision = this.readConversationAggregate(threadId)?.revision ?? 0;
    if (this.postResumeGoals.release(threadId, revision)) return true;

    this.scheduleRemainingThreadTurnsLoad(threadId);
    return true;
  }

  /** Effect Module adapter operation; replays one request after its lifecycle fence opens. */
  async replayBufferedConversationRequest(input: {
    readonly phase: CodexConversationEventBufferPhase;
    readonly threadId: string;
    readonly event: CodexBufferedConversationRequest;
  }): Promise<void> {
    try {
      const response = await this.handleServerRequestNow(input.event.request);
      if (response !== CodexApplicationRequestPending) input.event.resolve(response);
    } catch (error) {
      input.event.reject(error);
    }
  }

  /** Effect Module adapter operation; re-enters canonical notification handling. */
  async replayBufferedConversationNotification(input: {
    readonly phase: CodexConversationEventBufferPhase;
    readonly threadId: string;
    readonly notification: CodexServerNotification;
  }): Promise<void> {
    await this.handleNotification(input.notification);
  }

  recordThreadStartReplayFailure(input: {
    readonly threadId: string;
    readonly cause: unknown;
  }): void {
    this.logger.error("Failed to replay deferred thread-start event", {
      threadId: input.threadId,
      error: input.cause,
    });
  }

  /** Effect Module adapter operation; compacts replay without duplicating canonical raw deltas. */
  compactBufferedConversationEvents(
    threadId: string,
    events: readonly CodexBufferedConversationEvent[],
  ): CodexBufferedConversationEvent[] {
    const buildKey = (method: string, turnId: string | null, itemId: string): string =>
      `${method}:${turnId ?? ""}:${itemId}`;
    const completedAgentDeltaKeys = new Set<string>();
    const bufferedDeltasByKey = new Map<
      string,
      {
        method: "item/agentMessage/delta" | "item/commandExecution/outputDelta";
        turnId: string | null;
        itemId: string;
        text: string[];
      }
    >();

    for (const event of events) {
      if (event.type !== "notification") continue;
      const payload = asRecord(event.notification.params);
      if (parseEventThreadId(payload) !== threadId) continue;

      if (event.notification.method === "item/completed") {
        const item = asRecord(payload?.item);
        if (item?.type !== "agentMessage" || typeof item.id !== "string") continue;
        completedAgentDeltaKeys.add(
          buildKey("item/agentMessage/delta", parseEventTurnId(payload), item.id),
        );
        continue;
      }
      if (
        event.notification.method !== "item/agentMessage/delta" &&
        event.notification.method !== "item/commandExecution/outputDelta"
      ) {
        continue;
      }
      const itemId = typeof payload?.itemId === "string" ? payload.itemId : null;
      const delta = typeof payload?.delta === "string" ? payload.delta : null;
      if (!itemId || delta === null) continue;
      const turnId = parseEventTurnId(payload);
      const key = buildKey(event.notification.method, turnId, itemId);
      const existing = bufferedDeltasByKey.get(key);
      if (existing) {
        existing.text.push(delta);
      } else {
        bufferedDeltasByKey.set(key, {
          method: event.notification.method,
          turnId,
          itemId,
          text: [delta],
        });
      }
    }

    const duplicateCharactersByKey = new Map<string, number>();
    const canonicalTurns = this.readCanonicalConversationState(threadId)?.turns ?? [];
    for (const [key, buffered] of bufferedDeltasByKey) {
      const turn = canonicalTurns.find((candidate) => candidate.protocol.id === buffered.turnId);
      const item = turn?.items.find(
        (candidate) =>
          candidate.id === buffered.itemId &&
          (buffered.method === "item/agentMessage/delta"
            ? candidate.type === "agentMessage"
            : candidate.type === "commandExecution"),
      );
      const existingText =
        buffered.method === "item/agentMessage/delta" && item?.type === "agentMessage"
          ? item.text
          : buffered.method === "item/commandExecution/outputDelta" &&
              item?.type === "commandExecution"
            ? item.aggregatedOutput
            : null;
      const fullDelta = buffered.text.join("");
      duplicateCharactersByKey.set(
        key,
        existingText !== null && existingText.endsWith(fullDelta) ? fullDelta.length : 0,
      );
    }

    const deduped: CodexBufferedConversationEvent[] = [];
    for (const event of events) {
      if (event.type === "request") {
        deduped.push(event);
        continue;
      }
      if (
        event.notification.method !== "item/agentMessage/delta" &&
        event.notification.method !== "item/commandExecution/outputDelta"
      ) {
        deduped.push(event);
        continue;
      }
      const payload = asRecord(event.notification.params);
      const itemId = typeof payload?.itemId === "string" ? payload.itemId : null;
      const delta = typeof payload?.delta === "string" ? payload.delta : null;
      if (!itemId || delta === null) continue;
      const key = buildKey(event.notification.method, parseEventTurnId(payload), itemId);
      if (
        event.notification.method === "item/agentMessage/delta" &&
        completedAgentDeltaKeys.has(key)
      ) {
        continue;
      }
      const duplicateCharacters = duplicateCharactersByKey.get(key) ?? 0;
      const consumedCharacters = Math.min(duplicateCharacters, delta.length);
      duplicateCharactersByKey.set(key, duplicateCharacters - consumedCharacters);
      const remainingDelta = delta.slice(consumedCharacters);
      if (!remainingDelta) continue;
      if (remainingDelta === delta) {
        deduped.push(event);
        continue;
      }
      if (event.notification.method === "item/agentMessage/delta") {
        deduped.push({
          type: "notification",
          notification: {
            ...event.notification,
            params: { ...event.notification.params, delta: remainingDelta },
          },
        });
        continue;
      }
      deduped.push({
        type: "notification",
        notification: {
          ...event.notification,
          params: { ...event.notification.params, delta: remainingDelta },
        },
      });
    }
    return deduped;
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

  /** Temporary projection port until handoff recovery owns the canonical Thread location model. */
  async recoverThreadHandoffs(): Promise<void> {
    await this.threadHandoffRuntime.recover(this.buildThreadExecutionLocationEffects());
  }

  /** Test-only replacement seam for the execution host's worktree worker adapter. */
  setWorktreeWorkerPort(hostId: string, port: CodexWorktreeWorkerPort, managedRoot?: string): void {
    const current = this.executionHosts.getDescriptor(hostId);
    const effectiveManagedRoot = managedRoot ?? current?.managedRoot;
    if (!effectiveManagedRoot) throw new Error(`Execution host is unavailable: ${hostId}`);
    const fileTransfer = this.executionHosts.hasFileTransfer(hostId)
      ? this.executionHosts.requireFileTransfer(hostId)
      : undefined;
    this.executionHosts.register({
      hostId,
      displayName: current?.displayName ?? hostId,
      kind: hostId === CODEX_APP_LOCAL_HOST_ID ? "local" : "ssh",
      nodexHome: current?.nodexHome,
      codexHome: current?.codexHome,
      managedRoot: effectiveManagedRoot,
      handoffStagingRoot: current?.handoffStagingRoot,
      ...(hostId === CODEX_APP_LOCAL_HOST_ID
        ? { knownManagedRoots: this.managedWorktreeSettingsPort.listKnownRoots() }
        : {}),
      repositoryRoots: current?.repositoryRoots,
      worktreeWorker: port,
      ...(fileTransfer ? { fileTransfer } : {}),
      capabilities: [
        "create",
        "list",
        "inspect",
        "snapshot",
        "remove",
        "restore",
        "set-owner",
        "prepare-handoff",
        "rollback-handoff",
        "cleanup-handoff",
        "export-handoff",
        "import-handoff",
        "cleanup-transfer-handoff",
      ],
    });
  }

  handleExecutionHostTopologyChanged(): void {
    this.invalidateSidebarSnapshotCache();
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

  private buildDefaultCollaborationModeState(): CodexCollaborationModeState {
    return {
      mode: "default",
      settings: {
        model: "",
        reasoning_effort: null,
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
    const model =
      normalizeThreadSettingsModel(input.model) ??
      normalizeThreadSettingsModel(fallback.settings.model) ??
      "";
    const reasoningEffort =
      input.reasoningEffort !== undefined
        ? input.reasoningEffort
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

  private buildConversationThreadSettings(input: {
    model?: string | null;
    modelProvider?: string | null;
    serviceTier?: string | null;
    reasoningEffort?: CodexReasoningEffort | null;
    summary?: CodexConversationThreadSettings["summary"];
    collaborationMode?: CodexCollaborationModeKind | null;
    personality?: CodexPersonality | null;
    fallback?: CodexConversationThreadSettings | null;
    fallbackCollaborationMode?: CodexCollaborationModeState | null;
  }): CodexConversationThreadSettings {
    const fallbackCollaborationMode =
      input.fallback?.collaborationMode ??
      input.fallbackCollaborationMode ??
      this.buildDefaultCollaborationModeState();
    const model =
      normalizeThreadSettingsModel(input.model) ??
      normalizeThreadSettingsModel(input.fallback?.model) ??
      normalizeThreadSettingsModel(fallbackCollaborationMode.settings.model) ??
      "";
    const reasoningEffort =
      input.reasoningEffort !== undefined
        ? input.reasoningEffort
        : (input.fallback?.reasoningEffort ?? fallbackCollaborationMode.settings.reasoning_effort);
    const collaborationMode = this.buildCollaborationModeState({
      collaborationMode: input.collaborationMode ?? fallbackCollaborationMode.mode,
      model,
      reasoningEffort,
      fallback: fallbackCollaborationMode,
    });

    return {
      model,
      modelProvider:
        normalizeThreadSettingsModel(input.modelProvider) ??
        normalizeThreadSettingsModel(input.fallback?.modelProvider) ??
        null,
      serviceTier:
        input.serviceTier !== undefined
          ? normalizeCodexServiceTier(input.serviceTier)
          : (input.fallback?.serviceTier ?? null),
      reasoningEffort: reasoningEffort ?? null,
      summary: input.summary !== undefined ? input.summary : (input.fallback?.summary ?? null),
      collaborationMode,
      personality:
        input.personality !== undefined ? input.personality : (input.fallback?.personality ?? null),
    };
  }

  private mergeThreadSettingsPatch(
    threadId: string,
    patch: CodexConversationThreadSettingsPatch,
  ): CodexConversationThreadSettings {
    const record = this.getConversationRecord(threadId);
    const executionProfile = patch.executionProfile;
    return this.buildConversationThreadSettings({
      model:
        executionProfile?.modelId ??
        (hasOwnValue(patch, "model") ? (patch.model ?? null) : undefined),
      modelProvider: executionProfile?.providerId,
      serviceTier: executionProfile
        ? executionProfile.serviceTier
        : hasOwnValue(patch, "serviceTier")
          ? (patch.serviceTier ?? null)
          : undefined,
      reasoningEffort: executionProfile
        ? executionProfile.reasoningEffort
        : hasOwnValue(patch, "reasoningEffort")
          ? (patch.reasoningEffort ?? null)
          : undefined,
      summary: hasOwnValue(patch, "summary") ? (patch.summary ?? null) : undefined,
      collaborationMode: hasOwnValue(patch, "collaborationMode")
        ? (patch.collaborationMode ?? "default")
        : undefined,
      personality: hasOwnValue(patch, "personality") ? (patch.personality ?? null) : undefined,
      fallback: record.latestThreadSettings,
      fallbackCollaborationMode: record.latestCollaborationMode,
    });
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

    return this.buildCollaborationModeState({
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
        this.buildCollaborationModeState({
          collaborationMode: fallbackMode.mode,
          model,
          reasoningEffort,
          fallback: fallbackMode,
        }),
      ) ??
      this.buildCollaborationModeState({
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
      latestCollaborationMode: this.buildDefaultCollaborationModeState(),
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

  private mergeCanonicalOlderTurnPage(
    threadId: string,
    rawTurns: readonly Turn[],
    oldestLoadedTurnId: string | null,
    pageHydrationContext: CodexOlderTurnHydrationContext,
  ): CodexCanonicalConversationState {
    const record = this.ensureConversationRecord(threadId);
    const current = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = current?.sidecar.hydrationContext ?? null;
    if (!current || !hydrationContext) {
      throw new Error(
        `Cannot merge canonical history for '${threadId}' without complete hydration context`,
      );
    }

    const pageState = createCodexCanonicalHydratedConversationState(
      {
        ...current.protocol,
        turns: [...rawTurns],
      },
      {
        model: pageHydrationContext.model,
        reasoningEffort: pageHydrationContext.reasoningEffort,
        cwd: pageHydrationContext.cwd,
        approvalPolicy: pageHydrationContext.approvalPolicy,
        approvalsReviewer: pageHydrationContext.approvalsReviewer,
        sandboxPolicy: pageHydrationContext.sandboxPolicy,
        activePermissionProfile: null,
        runtimeWorkspaceRoots: [],
        pendingRequests: current.requests,
        hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
      },
    );
    const nextCanonicalState: CodexCanonicalConversationState = {
      ...current,
      turns: mergeCodexCanonicalOlderTurnStates({
        olderTurns: pageState.turns,
        currentTurns: current.turns,
        oldestLoadedTurnId,
      }),
      requests: [...current.requests],
      sidecar: {
        ...current.sidecar,
        hasUnreadTurn: this.conversationHasUnreadTurn(record.threadId),
      },
    };
    return this.acceptCanonicalConversationState(record.threadId, nextCanonicalState);
  }

  /** Exact `GQe`: snapshot page hydration settings before the network request starts. */
  private resolveCanonicalOlderTurnHydrationContext(
    threadId: string,
  ): CodexOlderTurnHydrationContext {
    const record = this.ensureConversationRecord(threadId);
    const canonical = this.readCanonicalConversationState(record.threadId);
    const hydrationContext = canonical?.sidecar.hydrationContext ?? null;
    if (!canonical || !hydrationContext) {
      throw new Error(
        `Cannot load canonical history for '${threadId}' without complete hydration context`,
      );
    }

    const latestParams = canonical.turns.at(-1)?.sidecar.params ?? null;
    const latestSettings = hydrationContext.latestThreadSettings;
    const cwd = latestSettings?.cwd ?? hydrationContext.cwd ?? latestParams?.cwd ?? "/";
    const defaultPermissions = createCodexCanonicalWorkspacePermissionContext([cwd]);
    const currentPermissions = hydrationContext.currentPermissions;
    return {
      model: record.latestThreadSettings?.model ?? hydrationContext.latestModel,
      reasoningEffort: record.latestThreadSettings
        ? record.latestThreadSettings.reasoningEffort
        : hydrationContext.latestReasoningEffort,
      cwd,
      approvalPolicy:
        latestSettings?.approvalPolicy ??
        latestParams?.approvalPolicy ??
        currentPermissions.approvalPolicy ??
        defaultPermissions.approvalPolicy,
      approvalsReviewer:
        latestSettings?.approvalsReviewer ??
        latestParams?.approvalsReviewer ??
        currentPermissions.approvalsReviewer ??
        defaultPermissions.approvalsReviewer,
      sandboxPolicy:
        latestSettings?.sandboxPolicy ??
        latestParams?.sandboxPolicy ??
        currentPermissions.sandboxPolicy ??
        defaultPermissions.sandboxPolicy,
    };
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

  private markAllConversationRecordsNeedResumeAfterReconnect(): void {
    const knownThreadIds = new Set<string>([
      ...this.workspaceThreadProjectionById.keys(),
      ...this.conversationRecords.keys(),
    ]);

    for (const threadId of knownThreadIds) {
      if (!threadId) continue;
      this.ensureConversationRecord(threadId);
      this.setConversationResumeState(threadId, "needs_resume");
      this.setConversationStreamRole(threadId, null);
      this.conversationAggregate(threadId).setStreaming(false);
    }

    this.syncDormantConversations(Array.from(knownThreadIds), "durable-recovery");
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
    this.queuedFollowUps.reset(threadId);

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
    this.manualCompaction.clear(threadId);
    this.activeGoalContinuation.clear(threadId);
    this.postResumeGoals.clear(threadId);
    this.conversationHistory.clear(threadId);
    this.conversationResume.clear(threadId);
    this.conversationEventBuffer.clear(
      threadId,
      new Error(`Codex Thread '${threadId}' local state was cleared`),
    );
    this.freshThreadLaunch.clear(threadId);
    this.backgroundSubagentMetadataRepair.clear(threadId);
    this.subagentCatalog.clear(threadId);
    this.queuedFollowUps.clear(threadId);
  }

  private listQueuedFollowUps(threadId: string): CodexQueuedFollowUp[] {
    return [...this.queuedFollowUps.list(threadId)];
  }

  private listPendingSteers(threadId: string): CodexPendingSteer[] {
    return [...(this.getMaybeConversationRecord(threadId)?.pendingSteers ?? [])].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }

  private clearPausedQueuedFollowUps(threadId: string, broadcast = true): void {
    this.queuedFollowUps.clearPaused(threadId, broadcast);
  }

  private hasActiveTurn(threadId: string): boolean {
    return this.listKnownTurns(threadId).some((turn) => turn.status === "inProgress");
  }

  /** Effect Module adapter operation; queue ordering and pause policy live in the runtime. */
  isQueuedFollowUpSubmissionEligible(threadId: string): boolean {
    return !this.hasActiveTurn(threadId);
  }

  private maybeDispatchQueuedFollowUp(threadId: string): void {
    this.queuedFollowUps.request(threadId);
  }

  /** Effect Module projection operation; the runtime has already committed the queue revision. */
  projectQueuedFollowUps(threadId: string, entries: readonly CodexQueuedFollowUp[]): void {
    if (this.isCommandOnlyAutomationThread(threadId)) return;
    this.mutateAcceptedConversationDocument(threadId, (draft) => {
      draft.queuedFollowUps = [...entries];
    });
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

  /** Effect Module adapter operation; submits an already claimed follow-up. */
  async submitQueuedFollowUp(threadId: string, followUp: CodexQueuedFollowUp): Promise<void> {
    const knownTurns = this.listKnownTurns(threadId);
    let activeTurnId: string | null = null;
    for (let index = knownTurns.length - 1; index >= 0; index -= 1) {
      const turn = knownTurns[index];
      if (turn?.status !== "inProgress") continue;
      activeTurnId = turn.turnId;
      break;
    }

    if (activeTurnId) {
      await this.steerTurn({
        threadId,
        expectedTurnId: activeTurnId,
        prompt: followUp.prompt,
        ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
        collaborationMode: followUp.collaborationMode,
        serviceTier: followUp.serviceTier,
        summary: followUp.summary,
      });
      return;
    }

    await this.startTurn(threadId, followUp.prompt, {
      collaborationMode: followUp.collaborationMode ?? undefined,
      serviceTier: followUp.serviceTier,
      summary: followUp.summary,
      ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
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

  projectAgentImportProgress(progress: AgentImportProgress): void {
    this.applicationEvents.publish({ kind: "agentImportProgress", value: progress });
  }

  async importClaudeAgentConfiguration(
    migrationItems: readonly ExternalAgentConfigMigrationItem[],
    onProgress: (progress: ExternalAgentConfigImportProgressNotification) => void,
  ): Promise<ExternalAgentConfigImportCompletedNotification> {
    const completed = await this.externalAgentImport.run(migrationItems, onProgress);
    await this.materializeImportedClaudeThreads(completed);
    return completed;
  }

  private async materializeImportedClaudeThreads(
    completed: ExternalAgentConfigImportCompletedNotification,
  ): Promise<void> {
    const importedThreadIds = completed.itemTypeResults.flatMap((result) =>
      result.itemType === "SESSIONS"
        ? result.successes.flatMap((success) => (success.target ? [success.target] : []))
        : [],
    );
    for (const threadId of importedThreadIds) {
      try {
        const response = await this.client.request<"thread/read", ThreadReadResponse>(
          "thread/read",
          {
            includeTurns: true,
            threadId,
          },
        );
        await this.materializeImportedThread(response.thread);
      } catch (error) {
        this.logger.warn("Could not materialize an imported Claude Code thread", {
          error: error instanceof Error ? error.message : String(error),
          threadId,
        });
      }
    }
    await this.sidebarSync.sync({ policy: "force", reason: "host-message" });
  }

  async importRolloutSession(session: NativeSessionCandidate): Promise<string> {
    await this.ensureClientReady();
    const cwd = existsSync(session.cwd) ? session.cwd : this.projectlessHomeDirectory();
    const fork = await this.client.request<"thread/fork", ThreadForkResponse>("thread/fork", {
      cwd,
      excludeTurns: false,
      path: session.sourcePath,
      threadId: session.sourceThreadId,
      threadSource: "user",
      config: buildCodexThreadConfigOverrides(),
    });
    const threadId = fork.thread.id.trim();
    if (!threadId) throw new Error("Imported rollout did not return a thread id");

    try {
      const projectedThread = {
        ...fork.thread,
        cwd:
          resolveCodexCanonicalHydratedCwd({
            fallbackCwd: cwd,
            requestedCwd: cwd,
            responseCwd: fork.cwd,
            threadCwd: fork.thread.cwd,
          }) ?? cwd,
      };
      await this.materializeImportedThread(projectedThread);
      if (session.title && !fork.thread.name?.trim()) {
        await this.threadTitlePersistence.setRequired({
          threadId,
          name: session.title,
          normalization: "trim",
        });
      }
      return threadId;
    } catch (error) {
      await this.client
        .request<"thread/delete", ThreadDeleteResponse>("thread/delete", {
          threadId,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async materializeImportedThread(thread: Thread): Promise<void> {
    const cwd = thread.cwd?.trim() || this.projectlessHomeDirectory();
    const materialized = await this.materializeThreadDetailFromThreadPayload(
      thread,
      {
        cwd,
        managedWorktreePath: null,
        projectId: null,
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
      },
      cwd,
    );
    this.setConversationRecordDetail({
      ...materialized.detail,
      executionProfile: null,
      projectId: null,
    });
    this.setConversationResumeState(thread.id, "needs_resume");
    if (materialized.summary) {
      const summary =
        (await this.updateWorkspaceThreadSummary(thread.id, {
          executionProfile: null,
        })) ?? materialized.summary;
      this.emitEvent({ type: "threadSummary", thread: summary });
    }
    await this.emitSidebarCatalogChangedForThread(thread.id, "host-message");
  }

  listPendingWorktrees(): readonly CodexPendingWorktreeEntry[] {
    return this.pendingWorktreeRuntime.list();
  }

  projectPendingWorktreeSnapshot(entries: readonly CodexPendingWorktreeEntry[]): void {
    this.invalidateSidebarSnapshotCache();
    this.applicationEvents.publish({ kind: "pendingWorktreesChanged", value: entries });
  }

  createPendingWorktree(input: CodexPendingWorktreeCreateInput): CodexPendingWorktreeCreateResult {
    this.worktreeWorkerForHost(input.hostId, "create");
    const allocated = allocateCodexPendingWorktreeRequest(input);
    this.pendingWorktreeRuntime.create(allocated.request);
    return allocated.result;
  }

  async createPendingWorktreeSetupRepair(
    hostId: string,
    pendingWorktreeId: string,
    agentMode: CodexAgentMode,
  ): Promise<CodexPendingWorktreeCreateResult> {
    this.worktreeWorkerForHost(hostId, "create");
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

  retryPendingWorktree(hostId: string, pendingWorktreeId: string): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.retry(pendingWorktreeId);
  }

  async workLocallyFromPendingWorktree(
    hostId: string,
    pendingWorktreeId: string,
  ): Promise<{ readonly threadId: string }> {
    this.worktreeWorkerForHost(hostId, "create");
    return await this.pendingWorktreeRuntime.workLocally(pendingWorktreeId);
  }

  continuePendingWorktree(hostId: string, pendingWorktreeId: string): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.continueWithoutSetup(pendingWorktreeId);
  }

  cancelPendingWorktree(hostId: string, pendingWorktreeId: string): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.cancel(pendingWorktreeId);
  }

  dismissPendingWorktree(hostId: string, pendingWorktreeId: string): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.dismiss(pendingWorktreeId);
  }

  renamePendingWorktree(hostId: string, pendingWorktreeId: string, label: string): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.rename(pendingWorktreeId, label);
  }

  setPendingWorktreePinned(hostId: string, pendingWorktreeId: string, isPinned: boolean): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.setPinned(pendingWorktreeId, isPinned);
  }

  setPendingWorktreePinnedBeforeThreadId(
    hostId: string,
    pendingWorktreeId: string,
    beforeThreadId: string | null,
  ): void {
    this.worktreeWorkerForHost(hostId, "create");
    this.pendingWorktreeRuntime.setPinnedBeforeThreadId(pendingWorktreeId, beforeThreadId);
  }

  clearPendingWorktreeAttention(hostId: string, pendingWorktreeId: string): void {
    this.worktreeWorkerForHost(hostId, "create");
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

  private worktreeWorkerForHost(
    hostId: string,
    operation: CodexWorktreeWorkerOperation,
  ): CodexWorktreeWorkerPort {
    return this.executionHosts.requireWorktreeWorker(hostId, operation);
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

  /** Effect Module projection operation; callers use CodexThreadCatalog.resolve. */
  async readThreadForCatalog(threadId: string): Promise<DesktopProjectWorkspaceThread | null> {
    return await this.readWorkspaceThread(threadId);
  }

  /** Effect Module projection operation; callers use CodexThreadCatalog.resolve. */
  async materializeThreadForCatalog(thread: unknown): Promise<CodexThreadSummary | null> {
    return await this.upsertLinkFromThread(thread);
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
    const projectAssignments: Record<string, string> = {};
    const projectlessThreadIds: string[] = [];
    const items = tasks.map((task): CodexSidebarThreadItem => {
      const thread = task.thread;
      const hostId = thread.executionHostId || DEFAULT_CODEX_HOST_ID;
      const isLocalHost = hostId === CODEX_APP_LOCAL_HOST_ID;
      const hostDisplayName = this.executionHosts.getDescriptor(hostId)?.displayName ?? hostId;
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

  async materializeSubagentThreadReadForModule(
    thread: CodexGatewayThreadReadThread,
    includeTurns: boolean,
  ): Promise<void> {
    await this.materializeReadThread(projectCodexGatewayThreadReadThread(thread), includeTurns);
  }

  shouldRetrySubagentReadWithoutTurnsForModule(cause: unknown): boolean {
    return hasNestedRolloutMaterializationError(cause);
  }

  readSubagentWorkspaceThreadForModule(
    threadId: string,
  ): Promise<DesktopProjectWorkspaceThread | null> {
    return this.readWorkspaceThread(threadId);
  }

  readSubagentCanonicalParentForModule(threadId: string): string | null | undefined {
    return this.getMaybeConversationRecord(threadId)?.detail?.source?.parentThreadId;
  }

  materializeSubagentThreadForModule(input: {
    readonly thread: Record<string, unknown>;
    readonly parentThreadId: string;
    readonly fallbackCwd: string | null;
  }): Promise<CodexThreadSummary | null> {
    return this.upsertBackgroundSubagentThreadFromAppServerThread(
      input.thread,
      input.parentThreadId,
      input.fallbackCwd,
    );
  }

  publishSubagentSummaryForModule(summary: CodexThreadSummary): void {
    this.emitEvent({ type: "threadSummary", thread: summary });
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

  private async validateAndPersistThreadExecutionProfile(
    threadId: string,
    requested: AgentExecutionProfile,
    change?: AgentExecutionProfileChange,
  ): Promise<AgentExecutionProfile> {
    const workspaceThread = await this.readWorkspaceThread(threadId);
    if (!workspaceThread) {
      throw new Error(`Cannot update execution settings for unknown thread '${threadId}'`);
    }

    const current = workspaceThread.executionProfile ?? null;
    const modelChangeCatalog =
      current && change === "model" ? await this.listAgentProviderCatalog() : null;
    const requestedModel =
      modelChangeCatalog?.providers
        .find((provider) => provider.id === current?.providerId)
        ?.models.find((model) => model.modelId === requested.modelId) ?? null;
    let requestedUpdate = requested;
    if (current && change === "model") {
      requestedUpdate = mergeAgentModelChange(current, requested, requestedModel);
    } else if (current && change === "reasoningEffort") {
      requestedUpdate = {
        ...current,
        reasoningEffort: requested.reasoningEffort,
      };
    } else if (current && change === "serviceTier") {
      requestedUpdate = {
        ...current,
        serviceTier: requested.serviceTier,
      };
    }
    const resolved = await this.resolveAgentExecutionProfile(requestedUpdate);
    if (!resolved) {
      throw new Error("The requested execution profile is unavailable");
    }

    const boundProviderId =
      current?.providerId ?? normalizeThreadSettingsModel(workspaceThread.modelProvider);
    if (boundProviderId && resolved.providerId !== boundProviderId) {
      throw new Error("Start a new thread to change provider");
    }
    if (current && resolved.harnessId !== current.harnessId) {
      throw new Error("Start a new thread to change the agent harness");
    }

    const currentModelId =
      current?.modelId ??
      normalizeThreadSettingsModel(
        this.getMaybeConversationRecord(threadId)?.latestThreadSettings?.model,
      );
    if (currentModelId && resolved.modelId !== currentModelId) {
      const catalog = modelChangeCatalog ?? (await this.listAgentProviderCatalog());
      const model = catalog.providers
        .find((provider) => provider.id === resolved.providerId)
        ?.models.find((candidate) => candidate.modelId === resolved.modelId);
      if (!model || model.switchPolicy !== "same-thread") {
        throw new Error("Start a new thread to use this model");
      }
    }

    const updated = await this.updateWorkspaceThreadSummary(threadId, {
      modelProvider: resolved.providerId,
      executionProfile: resolved,
    });
    if (!updated) {
      throw new Error(`Unable to persist execution settings for '${threadId}'`);
    }

    const record = this.getMaybeConversationRecord(threadId);
    if (record?.detail) {
      record.detail = {
        ...record.detail,
        modelProvider: resolved.providerId,
        executionProfile: resolved,
      };
    }
    this.invalidateSidebarSnapshotCache();
    this.emitEvent({ type: "threadSummary", thread: updated });
    await this.emitSidebarCatalogChangedForThread(threadId, "host-message");
    return resolved;
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
      return await this.buildCollaborationModePayload({ collaborationMode: mode });
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
        dynamicTools: this.buildCodexDynamicToolSpecs(),
        experimentalRawEvents: THREAD_START_EXPERIMENTAL_RAW_EVENTS,
        mockExperimentalField: null,
        serviceTier: executionProfile?.serviceTier ?? null,
        runtimeWorkspaceRoots: [...runLocation.workspaceRoots],
        ...threadPermissionOverrides,
      };
      let effectiveCwd = runLocation.cwd;

      this.beginThreadStartNotificationDeferral();
      try {
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
            await this.managedWorktreeLifecycle.setOwner({
              hostId: CODEX_APP_LOCAL_HOST_ID,
              worktreeGitRoot: managedWorktreePath,
              ownerThreadId: link.threadId,
            });
          } catch (error) {
            this.logger.warn("Scheduled automation worktree has no owner metadata", {
              automationId: input.automation.id,
              threadId: link.threadId,
              error,
            });
          } finally {
            this.managedWorktreeLifecycle.releaseNewborn(
              CODEX_APP_LOCAL_HOST_ID,
              managedWorktreePath,
            );
            this.requestManagedWorktreeRetention();
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
        await this.persistDynamicToolCatalogsForLaunch(
          link.threadId,
          threadStartParams.dynamicTools,
        );
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
        await this.completeThreadStartNotificationDeferral(link.threadId);
      } finally {
        await this.endThreadStartNotificationDeferral();
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
          await this.managedWorktreeLifecycle
            .remove({
              hostId: CODEX_APP_LOCAL_HOST_ID,
              worktreeGitRoot: managedWorktreePath,
              reason: "failed-create",
            })
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
    const workerResult = await this.worktreeWorkerForHost(CODEX_APP_LOCAL_HOST_ID, "create")
      .create(
        {
          requestId: `automation:${input.automation.id}:${randomUUID()}`,
          hostId: CODEX_APP_LOCAL_HOST_ID,
          repositoryPath: input.sourceCwd,
          nodexHome: getNodexHome(),
          managedRoot: this.executionHosts.requireManagedRoot(CODEX_APP_LOCAL_HOST_ID),
          projectId: input.automation.id,
          targetId: input.automation.id,
          threadTitle: input.automation.name,
          startingState: branchName ? { type: "branch", branchName } : null,
          localEnvironmentConfigPath: selectedEnvironmentPath,
          setUpSyncedBranch: true,
          propagateLocalWorkspaceFiles: true,
        },
        {
          ...(input.signal ? { signal: input.signal } : {}),
          onEvent: (event) => {
            if (event.type !== "path-allocated") return;
            allocatedWorktreeGitRoot = event.worktreeGitRoot;
            this.managedWorktreeLifecycle.registerNewborn(
              CODEX_APP_LOCAL_HOST_ID,
              event.worktreeGitRoot,
            );
          },
        },
      )
      .catch((error) => {
        if (allocatedWorktreeGitRoot) {
          this.managedWorktreeLifecycle.releaseNewborn(
            CODEX_APP_LOCAL_HOST_ID,
            allocatedWorktreeGitRoot,
          );
        }
        throw error;
      });
    const worktreeGitRoot = path.resolve(workerResult.worktreeGitRoot);
    const worktreeWorkspaceRoot = path.resolve(workerResult.worktreeWorkspaceRoot);
    if (workerResult.setupError) {
      await this.managedWorktreeLifecycle
        .remove({
          hostId: CODEX_APP_LOCAL_HOST_ID,
          worktreeGitRoot,
          reason: "failed-create",
        })
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
    return this.automationModule.peekActiveHeartbeatAutomationId(threadId) !== null;
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

  private async resolveThreadExecutionLocation(
    threadId: string,
  ): Promise<CodexThreadExecutionLocation> {
    const thread = await this.readWorkspaceThread(threadId);
    if (!thread) throw new Error(`Task not found: ${threadId}`);
    if (!this.executionHosts.getDescriptor(thread.executionHostId)) {
      throw new Error(`Execution host ${thread.executionHostId} is unavailable for task handoff.`);
    }
    const cwd = thread.cwd?.trim();
    if (!cwd || !path.isAbsolute(cwd)) {
      throw new Error("Task handoff requires an absolute working directory.");
    }
    const persistedRoots = await this.readThreadWritableRoots(threadId);
    const primary = persistedRoots[0]?.trim();
    if (!primary || !path.isAbsolute(primary)) {
      throw new Error("Task handoff requires a canonical primary workspace root.");
    }
    return {
      hostId: thread.executionHostId,
      cwd,
      workspaceRoots: rewriteExecutionWorkspaceRoots({
        sourcePrimary: primary,
        targetPrimary: primary,
        workspaceRoots: [primary, ...persistedRoots],
      }),
      managedWorktreePath: thread.managedWorktreePath,
      projectId: thread.projectId,
      projectlessOutputDirectory: thread.projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot,
    };
  }

  private resolveHandoffDestinationCwd(input: {
    readonly source: CodexThreadExecutionLocation;
    readonly sourcePrimary: string;
    readonly targetPrimary: string;
  }): string {
    const relative = path.relative(input.sourcePrimary, input.source.cwd);
    if (relative === "") return input.targetPrimary;
    if (relative.startsWith("..") || path.isAbsolute(relative)) return input.source.cwd;
    return path.join(input.targetPrimary, relative);
  }

  private async prepareThreadExecutionDestination(
    entry: CodexThreadHandoffJournalEntry,
    onPhase: Parameters<CodexThreadHandoffPromiseEffects["prepareDestination"]>[1],
    signal: AbortSignal,
  ): Promise<CodexThreadHandoffPreparation> {
    signal.throwIfAborted();
    if (!entry.source.projectId) {
      throw new Error("Move this task into a Project before handing it to a managed worktree.");
    }
    const project = await this.projectWorkspace.getProject(entry.source.projectId);
    if (!project) throw new Error("Task Project is unavailable during handoff.");
    const destinationHostId = entry.requestedDestinationHostId ?? entry.source.hostId;
    if (destinationHostId !== entry.source.hostId) {
      const sourcePrimary =
        entry.source.workspaceRoots[0] ?? entry.source.managedWorktreePath ?? entry.source.cwd;
      const thread = await this.readWorkspaceThread(entry.threadId);
      const metadata = await this.client.requestOnHost<ThreadReadResponse>(
        entry.source.hostId,
        "thread/read",
        { threadId: entry.threadId, includeTurns: false },
        { signal },
      );
      const sourceRolloutPath = metadata.thread.path?.trim() ?? "";
      if (!sourceRolloutPath || !path.isAbsolute(sourceRolloutPath)) {
        throw new Error("Cross-host handoff requires a persisted source rollout.");
      }
      const destinationRepositoryPaths =
        destinationHostId === CODEX_APP_LOCAL_HOST_ID
          ? project.sources
              .map((source) => source.root.trim())
              .filter((root) => path.isAbsolute(root))
          : this.executionHosts.requireRepositoryRoots(destinationHostId);
      const additionalRoots = entry.source.workspaceRoots.filter(
        (root) => !isExecutionWorkspacePathWithinRoot(root, sourcePrimary),
      );
      for (const additionalRoot of additionalRoots) {
        let additionalMetadata: FsGetMetadataResponse;
        try {
          additionalMetadata = await this.client.requestOnHost<FsGetMetadataResponse>(
            destinationHostId,
            "fs/getMetadata",
            { path: additionalRoot },
            { signal },
          );
        } catch {
          throw new Error(
            `Destination host cannot preserve additional workspace root ${additionalRoot}.`,
          );
        }
        if (!additionalMetadata.isDirectory || additionalMetadata.isSymlink) {
          throw new Error(
            `Destination host additional workspace root is not a safe directory: ${additionalRoot}.`,
          );
        }
      }
      const prepared = await this.crossHostThreadHandoff.prepare({
        operationId: entry.operationId,
        threadId: entry.threadId,
        threadTitle: thread?.threadName?.trim() || thread?.threadPreview?.trim() || entry.threadId,
        projectId: entry.source.projectId,
        sourceHostId: entry.source.hostId,
        destinationHostId,
        sourceCwd: entry.source.cwd,
        sourceWorkspaceRoot: sourcePrimary,
        sourceManagedWorktreePath: entry.source.managedWorktreePath,
        sourceRolloutPath,
        destinationRepositoryPaths,
        onPathAllocated: (allocated) => {
          this.managedWorktreeLifecycle.registerNewborn(
            allocated.hostId,
            allocated.worktreeGitRoot,
          );
        },
        onPhase,
        signal,
      });
      const targetPrimary = prepared.destinationWorkspaceRoot;
      return {
        prepared,
        destination: {
          ...entry.source,
          hostId: destinationHostId,
          cwd: this.resolveHandoffDestinationCwd({
            source: entry.source,
            sourcePrimary,
            targetPrimary,
          }),
          workspaceRoots: rewriteExecutionWorkspaceRoots({
            sourcePrimary,
            targetPrimary,
            workspaceRoots: entry.source.workspaceRoots,
          }),
          managedWorktreePath: prepared.managedWorktreePath,
        },
      };
    }
    if (entry.source.hostId !== CODEX_APP_LOCAL_HOST_ID) {
      throw new Error(
        "Current-host checkout/worktree toggling is only configured on the local host.",
      );
    }
    const checkoutRoot = project?.sources[0]?.root.trim() ?? "";
    if (!checkoutRoot || !path.isAbsolute(checkoutRoot)) {
      throw new Error("The task Project has no local checkout destination.");
    }
    const sourcePrimary =
      entry.source.workspaceRoots[0] ?? entry.source.managedWorktreePath ?? checkoutRoot;
    const worker = this.executionHosts.requireWorktreeWorker(
      CODEX_APP_LOCAL_HOST_ID,
      "prepare-handoff",
    );
    const thread = await this.readWorkspaceThread(entry.threadId);
    let allocatedWorktreePath: string | null = null;
    let prepared: CodexWorktreeWorkerPreparedHandoff;
    try {
      prepared = await worker.prepareHandoff(
        {
          requestId: entry.operationId,
          hostId: CODEX_APP_LOCAL_HOST_ID,
          managedRoot: this.executionHosts.requireManagedRoot(CODEX_APP_LOCAL_HOST_ID),
          nodexHome: getNodexHome(),
          projectId: entry.source.projectId,
          threadId: entry.threadId,
          threadTitle:
            thread?.threadName?.trim() || thread?.threadPreview?.trim() || entry.threadId,
          sourceCwd: entry.source.cwd,
          sourceWorkspaceRoot: sourcePrimary,
          sourceManagedWorktreePath: entry.source.managedWorktreePath,
          destinationCheckoutRoot: entry.source.managedWorktreePath ? checkoutRoot : null,
        },
        {
          signal,
          onEvent: (event) => {
            if (event.type === "path-allocated") {
              allocatedWorktreePath = event.worktreeGitRoot;
              this.managedWorktreeLifecycle.registerNewborn(
                CODEX_APP_LOCAL_HOST_ID,
                event.worktreeGitRoot,
              );
              return;
            }
            if (event.type !== "handoff-progress") return;
            onPhase(
              event.step,
              event.status === "failed"
                ? "error"
                : event.status === "completed" || event.status === "skipped"
                  ? "success"
                  : "running",
            );
          },
        },
      );
    } catch (error) {
      if (allocatedWorktreePath) {
        this.managedWorktreeLifecycle.releaseNewborn(
          CODEX_APP_LOCAL_HOST_ID,
          allocatedWorktreePath,
        );
      }
      throw error;
    }
    const targetPrimary = prepared.destinationWorkspaceRoot;
    const destinationCwd = this.resolveHandoffDestinationCwd({
      source: entry.source,
      sourcePrimary,
      targetPrimary,
    });
    return {
      prepared,
      destination: {
        ...entry.source,
        cwd: destinationCwd,
        workspaceRoots: rewriteExecutionWorkspaceRoots({
          sourcePrimary,
          targetPrimary,
          workspaceRoots: entry.source.workspaceRoots,
        }),
        managedWorktreePath:
          prepared.direction === "to-worktree" ? prepared.managedWorktreePath : null,
      },
    };
  }

  private async stopThreadForExecutionHandoff(
    threadId: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    let activeTurn = [...this.listKnownTurns(threadId)]
      .reverse()
      .find((turn) => turn.status === "inProgress" && turn.turnId);
    if (!activeTurn) {
      const thread = await this.readWorkspaceThread(threadId);
      if (thread?.statusType === "active") {
        await this.readThread(threadId, true);
        activeTurn = [...this.listKnownTurns(threadId)]
          .reverse()
          .find((turn) => turn.status === "inProgress" && turn.turnId);
      }
    }
    if (!activeTurn?.turnId) return;
    await this.conversationCommands.interrupt(threadId, activeTurn.turnId);
    signal.throwIfAborted();
    const terminal = this.getKnownTurn(threadId, activeTurn.turnId);
    if (terminal?.status === "inProgress") {
      throw new Error("The active turn did not stop before task handoff.");
    }
  }

  private resolveHandoffPermissionContext(
    threadId: string,
    workspaceRoots: readonly string[],
  ): CodexCanonicalHydratedPermissionContext {
    const existing =
      this.readCanonicalConversationState(threadId)?.sidecar.hydrationContext?.currentPermissions;
    if (!existing) return createCodexCanonicalWorkspacePermissionContext(workspaceRoots);
    return {
      ...existing,
      runtimeWorkspaceRoots: [...workspaceRoots],
      sandboxPolicy:
        existing.sandboxPolicy.type === "workspaceWrite"
          ? { ...existing.sandboxPolicy, writableRoots: [...workspaceRoots] }
          : existing.sandboxPolicy,
    };
  }

  private async switchThreadExecutionRuntime(
    threadId: string,
    location: CodexThreadExecutionLocation,
    preparation: CodexThreadHandoffPreparation | null,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    if (preparation?.prepared.direction === "cross-host") {
      const prepared = preparation.prepared;
      const rolloutPath =
        location.hostId === prepared.destinationHostId
          ? prepared.destinationRollout.path
          : location.hostId === prepared.sourceHostId
            ? prepared.sourceRollout.path
            : null;
      if (!rolloutPath) {
        throw new Error(`Cross-host handoff has no rollout for execution host ${location.hostId}.`);
      }
      const permissions = this.resolveHandoffPermissionContext(threadId, location.workspaceRoots);
      const response = await this.client.requestOnHost<ThreadResumeResponse>(
        location.hostId,
        "thread/resume",
        {
          threadId,
          history: null,
          path: rolloutPath,
          cwd: location.cwd,
          runtimeWorkspaceRoots: [...location.workspaceRoots],
          config: buildCodexThreadConfigOverrides(),
          excludeTurns: true,
          ...this.buildThreadResumePermissionOverrides({
            context: permissions,
            shouldSendPermissions: true,
            shouldSendApprovalsReviewer: true,
          }),
        } satisfies ThreadResumeParams,
        { signal },
      );
      this.assertThreadExecutionRuntimeLocation(threadId, location, response);
      return;
    }
    await this.ensureClientReady(signal);
    const metadata = await this.client.request<"thread/read", ThreadReadResponse>(
      "thread/read",
      {
        threadId,
        includeTurns: false,
      },
      { signal },
    );
    const permissions = this.resolveHandoffPermissionContext(threadId, location.workspaceRoots);
    if (metadata.thread.status.type !== "notLoaded") {
      const settings: ThreadSettingsUpdateParams = {
        threadId,
        cwd: location.cwd,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        ...(permissions.activePermissionProfile
          ? { permissions: permissions.activePermissionProfile.id }
          : { sandboxPolicy: permissions.sandboxPolicy }),
      };
      await this.client.request<"thread/settings/update", ThreadSettingsUpdateResponse>(
        "thread/settings/update",
        settings,
        { signal },
      );
      this.threadSettingsRuntime.recordRemoteUpdateSupported();
    }
    const response = await this.client.request<"thread/resume", ThreadResumeResponse>(
      "thread/resume",
      {
        threadId,
        history: null,
        path: metadata.thread.path,
        cwd: location.cwd,
        runtimeWorkspaceRoots: [...location.workspaceRoots],
        config: {
          ...((await this.buildMcpCodexConfig(location.cwd)) ?? {}),
          ...buildCodexThreadConfigOverrides(),
        },
        excludeTurns: true,
        ...this.buildThreadResumePermissionOverrides({
          context: permissions,
          shouldSendPermissions: true,
          shouldSendApprovalsReviewer: true,
        }),
      },
      { signal },
    );
    this.assertThreadExecutionRuntimeLocation(threadId, location, response);
  }

  private assertThreadExecutionRuntimeLocation(
    threadId: string,
    location: CodexThreadExecutionLocation,
    response: ThreadResumeResponse,
  ): void {
    if (response.thread.id !== threadId) {
      throw new Error(`Task handoff resumed unexpected thread '${response.thread.id}'.`);
    }
    if (path.resolve(response.cwd) !== path.resolve(location.cwd)) {
      throw new Error("Task handoff runtime did not accept the destination working directory.");
    }
    const expectedRoots = location.workspaceRoots.map((root) => path.resolve(root));
    const actualRoots = response.runtimeWorkspaceRoots.map((root) => path.resolve(root));
    if (
      expectedRoots.length !== actualRoots.length ||
      expectedRoots.some((root, index) => root !== actualRoots[index])
    ) {
      throw new Error("Task handoff runtime did not accept the destination workspace roots.");
    }
  }

  private async commitThreadExecutionLocation(
    threadId: string,
    location: CodexThreadExecutionLocation,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const updated = await this.projectWorkspace.setThreadExecutionLocation(threadId, {
      executionHostId: location.hostId,
      cwd: location.cwd,
      managedWorktreePath: location.managedWorktreePath,
      runtimeWorkspaceRoots: [...location.workspaceRoots],
      projectlessOutputDirectory: location.projectlessOutputDirectory,
      projectlessWorkspaceBrowserRoot: location.projectlessWorkspaceBrowserRoot,
    });
    if (!updated) throw new Error(`Task not found during handoff commit: ${threadId}`);
    signal.throwIfAborted();
    this.rememberWorkspaceThread(updated);
  }

  private async projectThreadExecutionLocation(
    threadId: string,
    location: CodexThreadExecutionLocation,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const thread = await this.readWorkspaceThread(threadId);
    if (!thread) throw new Error(`Task not found during handoff projection: ${threadId}`);
    this.applySidebarThreadWorkspaceMoveToRecord({
      threadId,
      targetProjectId: thread.projectId,
      move: {
        next: {
          cwd: location.cwd,
          managedWorktreePath: location.managedWorktreePath,
          projectlessOutputDirectory: location.projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot: location.projectlessWorkspaceBrowserRoot,
        },
        runtimeWorkspaceRoots: [...location.workspaceRoots],
      },
    });
    const metadata = createSidebarThreadSyncMetadata();
    markSidebarSyncScopeChanged(metadata, thread.projectId);
    await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "session-change");
    signal.throwIfAborted();
  }

  private async transferThreadExecutionOwner(
    threadId: string,
    preparation: CodexThreadHandoffPreparation,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const worktreeGitRoot = preparation.prepared.managedWorktreePath;
    try {
      await this.managedWorktreeLifecycle.setOwner({
        hostId: preparation.destination.hostId,
        worktreeGitRoot,
        ownerThreadId: threadId,
      });
    } finally {
      if (
        preparation.prepared.direction === "to-worktree" ||
        preparation.prepared.direction === "cross-host"
      ) {
        this.managedWorktreeLifecycle.releaseNewborn(
          preparation.destination.hostId,
          worktreeGitRoot,
        );
      }
      this.requestManagedWorktreeRetention();
    }
  }

  private async rollbackThreadExecutionPreparation(
    preparation: CodexThreadHandoffPreparation,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    signal.throwIfAborted();
    if (preparation.prepared.direction === "cross-host") return [];
    const hostId = preparation.destination.hostId;
    const worker = this.executionHosts.requireWorktreeWorker(hostId, "rollback-handoff");
    try {
      const result = await worker.rollbackHandoff(
        {
          requestId: `handoff:rollback:${randomUUID()}`,
          hostId,
          managedRoot: this.executionHosts.resolveManagedRoot(
            hostId,
            preparation.prepared.managedWorktreePath,
          ),
          prepared: preparation.prepared,
        },
        {
          signal,
          onEvent: () => undefined,
        },
      );
      return result.warnings;
    } finally {
      if (preparation.prepared.direction === "to-worktree") {
        this.managedWorktreeLifecycle.releaseNewborn(
          hostId,
          preparation.prepared.managedWorktreePath,
        );
      }
    }
  }

  private async cleanupThreadExecutionPreparation(
    preparation: CodexThreadHandoffPreparation,
    outcome: "committed" | "rolled-back",
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    signal.throwIfAborted();
    if (preparation.prepared.direction === "cross-host") {
      const prepared = preparation.prepared;
      const warnings: string[] = [];
      try {
        if (outcome === "committed" && prepared.sourceManagedWorktreePath) {
          try {
            const removed = await this.managedWorktreeLifecycle.remove({
              hostId: prepared.sourceHostId,
              worktreeGitRoot: prepared.sourceManagedWorktreePath,
              reason: "handoff",
            });
            warnings.push(...removed.warnings);
          } catch (error) {
            warnings.push(
              `source worktree cleanup: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        warnings.push(...(await this.crossHostThreadHandoff.cleanup(prepared, outcome, signal)));
        return warnings;
      } finally {
        this.managedWorktreeLifecycle.releaseNewborn(
          prepared.destinationHostId,
          prepared.managedWorktreePath,
        );
      }
    }
    const hostId = preparation.destination.hostId;
    const worker = this.executionHosts.requireWorktreeWorker(hostId, "cleanup-handoff");
    const result = await worker.cleanupHandoff(
      {
        requestId: `handoff:cleanup:${randomUUID()}`,
        hostId,
        managedRoot: this.executionHosts.resolveManagedRoot(
          hostId,
          preparation.prepared.managedWorktreePath,
        ),
        prepared: preparation.prepared,
        outcome,
      },
      { signal },
    );
    return result.warnings;
  }

  private buildThreadExecutionLocationEffects(): CodexThreadHandoffPromiseEffects {
    return {
      resolveSource: async (threadId, signal) => {
        signal.throwIfAborted();
        return await this.resolveThreadExecutionLocation(threadId);
      },
      readCanonicalLocation: async (threadId, signal) => {
        signal.throwIfAborted();
        try {
          const location = await this.resolveThreadExecutionLocation(threadId);
          signal.throwIfAborted();
          return location;
        } catch (error) {
          signal.throwIfAborted();
          this.logger.warn("Failed to read canonical task location during handoff recovery", {
            threadId,
            error,
          });
          return null;
        }
      },
      stopActiveTurn: async (threadId, signal) =>
        await this.stopThreadForExecutionHandoff(threadId, signal),
      prepareDestination: async (entry, onPhase, signal) =>
        await this.prepareThreadExecutionDestination(entry, onPhase, signal),
      switchRuntime: async (threadId, location, preparation, signal) =>
        await this.switchThreadExecutionRuntime(threadId, location, preparation, signal),
      commitLocation: async (threadId, location, signal) =>
        await this.commitThreadExecutionLocation(threadId, location, signal),
      projectLocation: async (threadId, location, signal) =>
        await this.projectThreadExecutionLocation(threadId, location, signal),
      transferOwner: async (threadId, preparation, signal) =>
        await this.transferThreadExecutionOwner(threadId, preparation, signal),
      cleanup: async (preparation, outcome, signal) =>
        await this.cleanupThreadExecutionPreparation(preparation, outcome, signal),
      rollbackPreparation: async (preparation, signal) =>
        await this.rollbackThreadExecutionPreparation(preparation, signal),
      sendFollowUp: async (threadId, prompt, signal) => {
        signal.throwIfAborted();
        const result = await this.startTurn(threadId, prompt);
        signal.throwIfAborted();
        if (!result) throw new Error("The follow-up turn was not accepted after task handoff.");
      },
    };
  }

  private evaluateThreadHandoffCapability(
    sourceHostId: string,
    destinationHostId: string,
  ): CodexThreadHandoffCapability {
    const crossHost = sourceHostId !== destinationHostId;
    const availableHostIds = new Set(this.executionHosts.listHostIds());
    const localTransactionEffects = (hostId: string): boolean =>
      ["prepare-handoff", "rollback-handoff", "cleanup-handoff"].every((operation) =>
        this.executionHosts.hasCapability(hostId, operation as CodexWorktreeWorkerOperation),
      );
    const sourceTransactionEffects = crossHost
      ? ["export-handoff", "cleanup-transfer-handoff"].every((operation) =>
          this.executionHosts.hasCapability(
            sourceHostId,
            operation as CodexWorktreeWorkerOperation,
          ),
        )
      : sourceHostId === CODEX_APP_LOCAL_HOST_ID && localTransactionEffects(sourceHostId);
    const destinationTransactionEffects = crossHost
      ? ["import-handoff", "cleanup-transfer-handoff"].every((operation) =>
          this.executionHosts.hasCapability(
            destinationHostId,
            operation as CodexWorktreeWorkerOperation,
          ),
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
        available:
          this.executionHosts.hasCapability(sourceHostId, "create") &&
          availableHostIds.has(sourceHostId),
        transactionEffects: sourceTransactionEffects,
      },
      destinationHost: {
        available:
          this.executionHosts.hasCapability(destinationHostId, "create") &&
          availableHostIds.has(destinationHostId),
        transactionEffects: destinationTransactionEffects,
      },
      crossHost,
      crossHostTransfer:
        crossHost &&
        this.executionHosts.hasFileTransfer(sourceHostId) &&
        this.executionHosts.hasFileTransfer(destinationHostId),
    });
  }

  private evaluateLocalThreadHandoffCapability(): CodexThreadHandoffCapability {
    return this.evaluateThreadHandoffCapability(CODEX_APP_LOCAL_HOST_ID, CODEX_APP_LOCAL_HOST_ID);
  }

  private buildThreadHandoffToolOptions(): {
    readonly availableHandoffHosts: Array<{ id: string; displayName: string }>;
    readonly crossHostHandoffEnabled: boolean;
    readonly handoffEnabled: boolean;
  } {
    const availableHandoffHosts = this.executionHosts
      .listDescriptors()
      .filter((host) => this.executionHosts.hasFileTransfer(host.hostId))
      .filter((host) => this.executionHosts.hasCapability(host.hostId, "cleanup-transfer-handoff"))
      .filter(
        (host) =>
          this.executionHosts.hasCapability(host.hostId, "export-handoff") ||
          this.executionHosts.hasCapability(host.hostId, "import-handoff"),
      )
      .map((host) => ({ id: host.hostId, displayName: host.displayName }));
    return {
      availableHandoffHosts,
      crossHostHandoffEnabled: availableHandoffHosts.length >= 2,
      handoffEnabled:
        this.evaluateThreadHandoffCapability(CODEX_APP_LOCAL_HOST_ID, CODEX_APP_LOCAL_HOST_ID)
          .status === "available" || availableHandoffHosts.length >= 2,
    };
  }

  private buildCodexDynamicToolSpecs(): DynamicToolSpec[] {
    const handoff = this.buildThreadHandoffToolOptions();
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
              ...this.buildThreadHandoffToolOptions(),
            }),
            ...NODEX_AGENT_DYNAMIC_TOOL_SPECS,
          ];
        } catch (error) {
          this.logger.warn("Failed to load model-aware dynamic tools", { error });
          return this.buildCodexDynamicToolSpecs();
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

  private buildCollaborationModePayload(input: {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexReasoningEffort | null;
  }): CodexAppServerCollaborationMode | null {
    const selectedMode = input.collaborationMode;
    if (!selectedMode) return null;

    const modelCandidate = input.model ?? null;
    const model =
      typeof modelCandidate === "string" && modelCandidate.trim().length > 0
        ? modelCandidate.trim()
        : null;
    if (!model) return null;
    const reasoningEffort = input.reasoningEffort ?? null;

    return {
      mode: selectedMode,
      settings: {
        model,
        reasoning_effort: reasoningEffort,
        developer_instructions: null,
      },
    };
  }

  private async buildThreadSettingsUpdateParams(
    threadId: string,
    patch: CodexConversationThreadSettingsPatch,
    nextSettings: CodexConversationThreadSettings,
  ): Promise<ThreadSettingsUpdateParams> {
    const params: ThreadSettingsUpdateParams = { threadId };
    const executionProfile = patch.executionProfile;
    if (executionProfile || hasOwnValue(patch, "model")) {
      params.model = executionProfile?.modelId ?? patch.model ?? null;
    }
    if (executionProfile || hasOwnValue(patch, "serviceTier")) {
      params.serviceTier = executionProfile?.serviceTier ?? patch.serviceTier ?? null;
    }
    if (executionProfile || hasOwnValue(patch, "reasoningEffort")) {
      params.effort = executionProfile?.reasoningEffort ?? patch.reasoningEffort ?? null;
    }
    if (hasOwnValue(patch, "summary")) {
      params.summary = patch.summary ?? null;
    }
    if (
      executionProfile ||
      hasOwnValue(patch, "model") ||
      hasOwnValue(patch, "reasoningEffort") ||
      hasOwnValue(patch, "collaborationMode")
    ) {
      const selectedMode =
        patch.collaborationMode ?? nextSettings.collaborationMode?.mode ?? "default";
      params.collaborationMode = await this.buildCollaborationModePayload({
        collaborationMode: selectedMode,
        model: normalizeThreadSettingsModel(nextSettings.model) ?? undefined,
        reasoningEffort: nextSettings.reasoningEffort,
      });
    }
    if (hasOwnValue(patch, "personality")) {
      params.personality = patch.personality ?? null;
    }

    return params;
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

  private async resolveSessionThreadRunLocation(input: {
    projectId: string | null;
    projectlessWorkspace?: CodexThreadStartForSessionInput["projectlessWorkspace"];
    sessionId: string;
    sessionTitle?: string | null;
    threadTitle?: string | null;
    runInTarget?: PageRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
    signal?: AbortSignal;
    onProgress?: (update: ThreadStartProgressUpdate) => void;
  }): Promise<ResolvedThreadRunLocation> {
    const runInTarget = input.runInTarget ?? "localProject";

    if (runInTarget === "cloud") {
      throw new Error(
        "Cloud run target is not available yet. Choose Work locally or New worktree.",
      );
    }

    if (input.projectId === null) {
      if (runInTarget !== "localProject") {
        throw new Error("Projectless threads can only work locally");
      }
      const workspace = parseCodexProjectlessWorkspace(input.projectlessWorkspace);
      return {
        cwd: workspace.cwd,
        workspaceRoots: [workspace.workspaceRoot],
        runInTarget: "localProject",
        managedWorktreePath: null,
        projectlessOutputDirectory: workspace.outputDirectory,
        projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
      };
    }

    if (runInTarget !== "newWorktree") {
      const localContext = await this.resolveLocalProjectThreadRoot(input.projectId);
      return {
        cwd: localContext.cwd,
        workspaceRoots: localContext.workspaceRoots,
        runInTarget: "localProject",
        managedWorktreePath: null,
      };
    }

    if (input.signal?.aborted) {
      throw new Error("Request canceled");
    }

    const projectContext = await this.requirePrimaryWorkspaceRoot(input.projectId);
    const workspacePath = projectContext.primaryWorkspaceRoot;

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
      nodexHome: getNodexHome(),
      managedRoot: this.executionHosts.requireManagedRoot(CODEX_APP_LOCAL_HOST_ID),
      projectId: projectContext.canonicalProjectId,
      targetId: input.sessionId,
      threadTitle: input.threadTitle?.trim() || input.sessionTitle?.trim() || input.sessionId,
      branchPrefix: this.gitSettingsResolver().branchPrefix,
      preferredBaseBranch: null,
      mode: input.worktreeStartMode ?? "detachedHead",
      signal: input.signal,
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
    const worktreeGitRoot = path.resolve(createdWorktree.worktreeGitRoot);
    const worktreeWorkspaceRoot = path.resolve(createdWorktree.worktreeWorkspaceRoot);
    if (input.signal?.aborted) {
      await this.managedWorktreeLifecycle
        .remove({
          hostId: CODEX_APP_LOCAL_HOST_ID,
          worktreeGitRoot,
          reason: "cancel",
        })
        .catch(() => undefined);
      throw new Error("Request canceled");
    }
    input.onProgress?.({
      phase: "creatingWorktree",
      message: WORKTREE_LOG_STATUS_MESSAGE,
      stream: "info",
      outputDelta: `Worktree created at ${worktreeWorkspaceRoot}\n`,
    });

    const selectedEnvironmentPath = input.runInEnvironmentPath?.trim() || null;
    if (selectedEnvironmentPath) {
      try {
        const environmentDefinition = await readWorktreeEnvironmentDefinition({
          workspacePath,
          environmentPath: selectedEnvironmentPath,
        });
        let shellEnvironment: CodexStoredShellEnvironment | null = null;
        if (environmentDefinition.setupScript) {
          input.onProgress?.({
            phase: "runningSetup",
            message: WORKTREE_LOG_STATUS_MESSAGE,
            stream: "info",
            outputDelta: `Running setup script ${environmentDefinition.path}\n`,
          });
          shellEnvironment = await runWorktreeSetupScript({
            script: environmentDefinition.setupScript,
            cwd: worktreeWorkspaceRoot,
            loadBaseEnvironment: this.loadWorktreeSetupBaseEnvironment,
            signal: input.signal,
            environment: {
              CODEX_SOURCE_TREE_PATH: workspacePath,
              CODEX_WORKTREE_PATH: worktreeWorkspaceRoot,
            },
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
          if (input.signal?.aborted) {
            throw new Error("Request canceled");
          }
          input.onProgress?.({
            phase: "runningSetup",
            message: WORKTREE_LOG_STATUS_MESSAGE,
            stream: "info",
            outputDelta: "Setup script completed\n",
          });
        }
        try {
          await this.persistWorktreeShellEnvironment(worktreeWorkspaceRoot, shellEnvironment);
        } catch (error) {
          const message = `Failed to store worktree shell environment: ${String(error)}`;
          this.logger.warn(message, {
            cwd: worktreeWorkspaceRoot,
            error,
          });
          input.onProgress?.({
            phase: "runningSetup",
            message: WORKTREE_LOG_STATUS_MESSAGE,
            stream: "stderr",
            outputDelta: `${message}\n`,
          });
        }
      } catch (error) {
        await this.managedWorktreeLifecycle
          .remove({
            hostId: CODEX_APP_LOCAL_HOST_ID,
            worktreeGitRoot,
            reason: "failed-create",
          })
          .catch(() => undefined);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to set up new worktree using environment '${selectedEnvironmentPath}': ${errorMessage}`,
          { cause: error },
        );
      }
    }

    if (input.signal?.aborted) {
      await this.managedWorktreeLifecycle
        .remove({
          hostId: CODEX_APP_LOCAL_HOST_ID,
          worktreeGitRoot,
          reason: "cancel",
        })
        .catch(() => undefined);
      throw new Error("Request canceled");
    }

    return {
      cwd: worktreeWorkspaceRoot,
      workspaceRoots: rewriteExecutionWorkspaceRoots({
        sourcePrimary: workspacePath,
        targetPrimary: worktreeWorkspaceRoot,
        workspaceRoots: projectContext.workspaceRoots,
      }),
      runInTarget,
      managedWorktreePath: worktreeGitRoot,
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

  private reduceCanonicalMainItemLifecycle(
    notification: CodexItemLifecycleNotification,
  ): string | null {
    const threadId = notification.params.threadId;
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) {
      this.logger.warn("Dropping item lifecycle without canonical conversation state", {
        threadId,
        method: notification.method,
        itemId: notification.params.item.id,
      });
      return null;
    }

    const observedAtMs = Date.now();
    const result = reduceCodexConversationEventWithEffects(
      before,
      { type: "notification", notification },
      {
        now: () => observedAtMs,
        consumeContextCompactionSource: () => this.manualCompaction.consumeSource(threadId),
        resolveCollabReceiverThread: (receiverThreadId) =>
          this.resolveLoadedCanonicalThread(receiverThreadId),
      },
    );
    this.acceptCanonicalConversationState(threadId, result.state);

    for (const effect of result.effects) {
      if (effect.type === "markConversationStreaming") {
        this.conversationAggregate(threadId).setStreaming(true);
        continue;
      }
      if (effect.type !== "hydrateCollabThreads") continue;
      for (const receiverThreadId of effect.receiverThreadIds) {
        void this.readThread(receiverThreadId, true).catch((error) => {
          this.logger.warn("Failed to hydrate collaboration receiver thread", {
            threadId,
            receiverThreadId,
            error,
          });
        });
      }
    }

    let changedTurnId: string | null = null;
    for (const [turnIndex, afterTurn] of result.state.turns.entries()) {
      const beforeTurn = before.turns[turnIndex] ?? null;
      if (afterTurn === beforeTurn) continue;
      changedTurnId =
        this.applyCanonicalLifecycleTurnProjection({
          threadId,
          turnIndex,
          beforeTurn,
          afterTurn,
          observedAtMs,
          lifecycleStatus: notification.method === "item/started" ? "inProgress" : "completed",
        }) ?? changedTurnId;
    }
    return changedTurnId;
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
      await this.queuedFollowUps.enqueue({
        threadId,
        prompt: restoreMessage.prompt,
        collaborationMode: restoreMessage.collaborationMode,
        serviceTier: restoreMessage.serviceTier,
        pausedReason: reason,
        promptInput: restoreMessage.promptInput,
        summary: restoreMessage.summary,
      });
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
          existingRecord?.latestCollaborationMode ?? this.buildDefaultCollaborationModeState(),
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

  private buildSideChatDetailFromForkPayload(input: SideChatDetailInput): CodexThreadDetail {
    const thread = input.forkResponse.thread;
    const forkedThreadId = thread.id;
    if (typeof forkedThreadId !== "string" || forkedThreadId.length === 0) {
      throw new Error("Thread fork did not return a valid thread id");
    }
    const timestamps = reconcileCodexThreadTimestamps({
      threadId: forkedThreadId,
      observedCreatedAt: thread.createdAt,
      observedUpdatedAt: thread.updatedAt,
      observedRecencyAt: thread.recencyAt,
      existing: null,
    });

    return applyThreadAgentMetadata(
      {
        threadId: forkedThreadId,
        projectId: input.projectId,
        source: {
          parentThreadId: input.parentThreadId,
          sideConversation: true,
          sideConversationParentNavigationPath: input.parentNavigationPath,
        },
        ephemeral: true,
        threadSource: parseThreadSourceValue(thread.threadSource) ?? "user",
        threadName: typeof thread.name === "string" ? thread.name : null,
        threadPreview: typeof thread.preview === "string" ? thread.preview : "",
        modelProvider:
          typeof thread.modelProvider === "string"
            ? thread.modelProvider
            : input.forkResponse.modelProvider,
        executionProfile: input.executionProfile,
        cwd: input.resolvedCwd,
        projectlessOutputDirectory: input.projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot: input.projectlessWorkspaceBrowserRoot,
        approvalPolicy: input.forkResponse.approvalPolicy,
        approvalsReviewer: input.forkResponse.approvalsReviewer,
        sandbox: input.forkResponse.sandbox,
        statusType: "idle",
        statusActiveFlags: [],
        threadRuntimeStatus: { type: "idle" },
        archived: false,
        hasUnreadTurn: false,
        createdAt: timestamps.createdAt,
        updatedAt: timestamps.updatedAt,
        recencyAt: timestamps.recencyAt,
        linkedAt: new Date().toISOString(),
        latestCollaborationMode: input.latestCollaborationMode,
        latestThreadSettings: {
          model: input.latestCollaborationMode.settings.model,
          reasoningEffort: input.latestCollaborationMode.settings.reasoning_effort,
          collaborationMode: input.latestCollaborationMode,
          personality: this.preferences.current(),
        },
        turns: [],
        transcript: [],
      },
      thread as unknown as Record<string, unknown>,
    );
  }

  private async resolveSideChatParentWorkspace(
    parentThreadId: string,
    parentDetail: CodexThreadDetail,
  ): Promise<SideChatParentWorkspace> {
    const inheritedWorkspace = resolveCodexForkWorkspaceInheritance(parentDetail);
    const parentCwd = parentDetail.cwd?.trim() ?? "";
    const sandboxWritableRoots =
      parentDetail.sandbox?.type === "workspaceWrite"
        ? parentDetail.sandbox.writableRoots
            .map((root) => root.trim())
            .filter((root) => root.length > 0 && root !== "~")
        : [];
    if (parentDetail.projectId) {
      if (parentCwd) {
        return {
          cwd: parentCwd,
          inheritance: inheritedWorkspace,
          workspaceRoots: [parentCwd, ...sandboxWritableRoots.filter((root) => root !== parentCwd)],
        };
      }
      const projectContext = await this.resolveLocalProjectThreadRoot(parentDetail.projectId);
      return {
        cwd: projectContext.cwd,
        inheritance: inheritedWorkspace,
        workspaceRoots: projectContext.workspaceRoots,
      };
    }

    let repairedParent: ThreadRef | null;
    try {
      const persistedWritableRoots = await this.readThreadWritableRoots(parentThreadId);
      repairedParent = await this.repairPersistedProjectlessWorkspaceForResume({
        browserRoot: parentDetail.projectlessWorkspaceBrowserRoot ?? null,
        cwd: parentDetail.cwd,
        outputDirectory: parentDetail.projectlessOutputDirectory ?? null,
        prompt: parentDetail.threadName?.trim() || parentDetail.threadPreview.trim() || "new chat",
        threadId: parentThreadId,
        writableRoots: [
          ...persistedWritableRoots,
          ...sandboxWritableRoots.filter((root) => !persistedWritableRoots.includes(root)),
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Projectless side chat workspace repair failed: ${message}`, {
        cause: error,
      });
    }

    const repairedCwd = repairedParent?.cwd?.trim() ?? "";
    if (!repairedCwd) {
      throw new Error(
        "Projectless side chat requires a workspace, but its parent workspace could not be repaired",
      );
    }

    const repairedInheritance = resolveCodexForkWorkspaceInheritance({
      projectId: null,
      projectlessOutputDirectory: repairedParent?.projectlessOutputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: repairedParent?.projectlessWorkspaceBrowserRoot ?? null,
    });
    return {
      cwd: repairedCwd,
      inheritance: repairedInheritance,
      workspaceRoots: [repairedCwd],
    };
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

  /** Effect Module projection operation; callers use threadTitlePersistence instead. */
  applyThreadNameLocal(
    threadId: string,
    name: string,
    options: DormantConversationSyncOptions = {},
  ): void {
    this.emitThreadTitleUpdated(threadId, name);
    const detail = this.getMaybeConversationRecord(threadId)?.detail;
    if (detail) {
      detail.threadName = name;
    }
    const updated = detail ?? this.getThreadLinkSafely(threadId);
    if (updated) {
      this.emitEvent({ type: "threadSummary", thread: updated });
    }
    if (options.syncDormantConversationUpdates === false) {
      this.syncAcceptedConversationDocumentSilently(threadId);
    } else {
      this.syncAcceptedConversationSummary(threadId, { syncCapabilityFlags: true });
    }
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

  private async enqueueSessionPendingWorktreeStart(input: {
    readonly request: CodexThreadStartForSessionInput & { readonly projectId: string };
    readonly session: ProjectSession;
    readonly preparedPrompt: PreparedPromptForTurn;
    readonly effectiveModel: string | null;
    readonly effectiveReasoningEffort: CodexReasoningEffort | undefined;
    readonly effectiveCollaborationMode: CodexCollaborationModeKind | undefined;
    readonly executionProfile: AgentExecutionProfile | null;
    readonly explicitThreadName: string | null;
    readonly browserViewScopeId: string;
    readonly signal?: AbortSignal;
  }): Promise<Extract<CodexThreadStartForSessionResult, { readonly kind: "pending" }>> {
    if (input.signal?.aborted) throw new Error("Request canceled");
    if (
      input.request.browserUsePresentationOrigin &&
      input.request.browserUsePresentationOrigin.browserViewScopeId !== input.browserViewScopeId
    ) {
      throw new Error("Browser Use origin does not belong to this window");
    }

    const projectContext = await this.requirePrimaryWorkspaceRoot(input.request.projectId);
    const sourceWorkspaceRoot = projectContext.primaryWorkspaceRoot;
    const [startingState, destinationSnapshot] = await Promise.all([
      input.request.worktreeStartingState
        ? Promise.resolve(input.request.worktreeStartingState)
        : resolveManagedWorktreeDefaultStartingState(sourceWorkspaceRoot, input.signal),
      this.readDynamicCreateDestinationSnapshot({
        launchMode: "direct",
        projectId: input.request.projectId,
        cwd: sourceWorkspaceRoot,
        workspaceRoots: projectContext.workspaceRoots,
        workspaceKind: "project",
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
      }),
    ]);
    if (input.signal?.aborted) throw new Error("Request canceled");

    const permissionDecision = await this.resolvePermissionStateForRequest(
      input.request.projectId,
      input.request.permissionMode,
      projectContext.workspaceRoots,
    );
    const effectivePermissionState = permissionDecision.state;
    const collaborationMode = await this.buildCollaborationModePayload({
      ...(input.effectiveCollaborationMode
        ? { collaborationMode: input.effectiveCollaborationMode }
        : input.effectiveModel
          ? { collaborationMode: "default" as const }
          : {}),
      ...(input.effectiveModel ? { model: input.effectiveModel } : {}),
      ...(input.effectiveReasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.effectiveReasoningEffort }),
    });
    const configOverrides =
      collaborationMode === null && input.effectiveReasoningEffort
        ? { model_reasoning_effort: input.effectiveReasoningEffort }
        : undefined;
    const frozenReasoningEffort =
      parseReasoningEffort(collaborationMode?.settings.reasoning_effort) ??
      input.effectiveReasoningEffort ??
      parseReasoningEffort(destinationSnapshot.expandedConfig.model_reasoning_effort) ??
      null;
    const shouldSendPermissionOverrides = shouldSendCodexPendingPermissionOverrides({
      effectivePreset: effectivePermissionState.effectivePreset,
      ...(input.request.permissionProfileId === undefined
        ? {}
        : { permissionProfileId: input.request.permissionProfileId }),
    });
    const goalPastedTextAttachments = input.request.threadGoalDraft?.pastedTextAttachments ?? [];
    const promptPastedTextAttachmentCount = input.preparedPrompt.pastedTextAttachments.length;
    const pastedTextAttachmentManager = await this.getPastedTextAttachmentManager();
    const materializedPastedText = await pastedTextAttachmentManager.materializeSources([
      ...input.preparedPrompt.pastedTextAttachments,
      ...goalPastedTextAttachments,
    ]);
    let didTransferPastedTextOwnership = false;

    try {
      if (input.signal?.aborted) throw new Error("Request canceled");
      const promptPastedTextAttachments = materializedPastedText.attachments.slice(
        0,
        promptPastedTextAttachmentCount,
      );
      const materializedGoalPastedTextAttachments = materializedPastedText.attachments.slice(
        promptPastedTextAttachmentCount,
      );
      const threadGoalDraft = input.request.threadGoalDraft
        ? {
            objective: input.request.threadGoalDraft.objective,
            pastedTextAttachments: materializedGoalPastedTextAttachments,
            imageAttachments: input.request.threadGoalDraft.imageAttachments.map(
              ({ src, localPath, filename }) => ({ src, localPath, filename }),
            ),
          }
        : null;
      const pastedTextAttachments = [
        ...promptPastedTextAttachments,
        ...materializedGoalPastedTextAttachments,
      ];
      const pendingPrompt = buildCodexPendingComposerPrompt({
        prompt: input.preparedPrompt.promptText,
        fileAttachments: input.preparedPrompt.fileAttachments,
        pastedTextAttachments,
        addedFiles: input.preparedPrompt.addedFiles,
      });
      const startConversationParamsInput = buildCodexPendingStartConversationParams({
        input: replaceFirstTextInput(input.preparedPrompt.pendingInputItems, pendingPrompt),
        commentAttachments: [...input.preparedPrompt.commentAttachments],
        sourceWorkspaceRoot,
        sourceWorkspaceRoots: projectContext.workspaceRoots,
        fileAttachments: appendCodexPendingPastedTextAttachments(
          input.preparedPrompt.fileAttachments,
          pastedTextAttachments,
        ),
        addedFiles: input.preparedPrompt.addedFiles,
        agentMode: effectivePermissionState.mode,
        permissionProfileId: input.request.permissionProfileId,
        shouldSendPermissionOverrides,
        model: null,
        executionProfile: input.executionProfile,
        serviceTier:
          input.executionProfile?.serviceTier ??
          normalizeCodexServiceTier(input.request.serviceTier),
        reasoningEffort: frozenReasoningEffort,
        collaborationMode,
        config: destinationSnapshot.expandedConfig,
        configOverrides,
        memoryPreferences: input.request.memoryPreferences,
        ...(input.request.mode === undefined ? {} : { mode: input.request.mode }),
        ...(input.request.threadStartKind === undefined
          ? {}
          : { threadStartKind: input.request.threadStartKind }),
        ...(input.request.baseInstructions === undefined
          ? {}
          : { baseInstructions: input.request.baseInstructions }),
        ...(input.request.additionalDeveloperInstructions === undefined
          ? {}
          : {
              additionalDeveloperInstructions: input.request.additionalDeveloperInstructions,
            }),
        threadSource: "user",
        workspaceKind: "project",
        projectAssignment: {
          projectKind: "local",
          projectId: input.request.projectId,
          path: sourceWorkspaceRoot,
          pendingCoreUpdate: false,
        },
        serviceName: undefined,
      });
      const selectedEnvironmentPath = input.request.runInEnvironmentPath?.trim() || null;
      const browserTransferStateReader = this.browserTransferStateReader;
      const browserTransfer = browserTransferStateReader
        ? captureCodexOrdinaryBrowserTransfer({
            browserState: browserTransferStateReader.getStateSnapshot(),
            browserUseState: browserTransferStateReader.getBrowserUseStateSnapshot(),
            browserViewScopeId: input.browserViewScopeId,
            enabled: true,
            session: input.session,
          })
        : null;
      const created = this.createPendingWorktree({
        hostId: CODEX_APP_LOCAL_HOST_ID,
        label: summarizeCodexPendingWorktreeLabel(pendingPrompt),
        ...(input.explicitThreadName ? { initialThreadTitle: input.explicitThreadName } : {}),
        ...(browserTransfer ?? {}),
        sourceWorkspaceRoot,
        startingState,
        localEnvironmentConfigPath: selectedEnvironmentPath,
        launchMode: "start-conversation",
        prompt: pendingPrompt,
        startConversationParamsInput,
        projectSessionId: input.request.sessionId,
        threadStartHostId: CODEX_APP_LOCAL_HOST_ID,
        threadGoalDraft,
        heartbeatAutomation: input.request.heartbeatAutomation ?? null,
        skipAutoTitleGeneration: input.request.skipAutoTitleGeneration === true,
        ...(input.request.browserUsePresentationOrigin
          ? {
              browserUsePresentationOrigin: input.request.browserUsePresentationOrigin,
            }
          : {}),
        sourceConversationId: null,
        sourceCollaborationMode: null,
      });
      didTransferPastedTextOwnership = true;
      if (!created.clientThreadId) {
        throw new Error("Pending conversation did not allocate a client thread id");
      }
      return {
        kind: "pending",
        pendingWorktreeId: created.pendingWorktreeId,
        clientThreadId: created.clientThreadId,
      };
    } catch (error) {
      if (!didTransferPastedTextOwnership) {
        await Promise.allSettled(
          materializedPastedText.createdAttachmentPaths.map((path) =>
            pastedTextAttachmentManager.remove(path),
          ),
        );
      }
      throw error;
    }
  }

  async prepareSessionThreadLaunchForModule(
    input: CodexThreadStartForSessionInput,
    context: CodexSessionThreadLaunchContext,
    signal: AbortSignal,
  ): Promise<CodexPreparedSessionThreadLaunch> {
    const startedAt = Date.now();
    signal.throwIfAborted();
    await this.ensureClientReady();
    const session = await this.projectWorkspace.getProjectSession(input.sessionId);
    signal.throwIfAborted();
    if (!session) {
      throw new Error(`Project session not found: ${input.sessionId}`);
    }
    if (session.projectId !== input.projectId) {
      throw new Error("Thread project must match the owning session project");
    }
    if (session.thread) {
      throw new Error(
        `Project session is already linked to Codex thread: ${session.thread.threadId}`,
      );
    }

    const requestedRunInTarget = input.runInTarget ?? "localProject";
    if (input.projectId === null && requestedRunInTarget !== "localProject") {
      throw new Error("Projectless threads can only work locally");
    }
    if (input.projectId !== null && input.projectlessWorkspace !== undefined) {
      throw new Error("Project threads cannot use a projectless workspace");
    }
    const executionProfile = await this.resolveAgentExecutionProfile(input.executionProfile);
    const preparedPrompt = await this.preparePromptForTurn(
      input.prompt,
      input.promptInput,
      requestedRunInTarget === "newWorktree" ? { allowEmptyTextPlaceholder: true } : {},
    );
    signal.throwIfAborted();
    const prompt = preparedPrompt.promptText;
    const materializedGoalObjective = input.threadGoalMaterializedDraft?.objective.trim() ?? "";
    const effectiveModel =
      executionProfile?.modelId ??
      normalizeThreadSettingsModel(preparedPrompt.agentConfigOverrides.model) ??
      normalizeThreadSettingsModel(input.model);
    const effectiveReasoningEffort =
      executionProfile?.reasoningEffort ??
      preparedPrompt.agentConfigOverrides.reasoningEffort ??
      input.reasoningEffort;
    const effectiveCollaborationMode =
      preparedPrompt.agentConfigOverrides.collaborationMode ?? input.collaborationMode;
    const explicitThreadName = input.threadName
      ? normalizeCodexManualThreadTitle(input.threadName)
      : null;

    if (requestedRunInTarget === "newWorktree") {
      if (input.projectId === null) {
        throw new Error("Projectless threads can only work locally");
      }
      return {
        kind: "pending",
        sessionId: input.sessionId,
        state: {
          input,
          context,
          session,
          preparedPrompt,
          effectiveModel,
          effectiveReasoningEffort,
          effectiveCollaborationMode,
          executionProfile,
          explicitThreadName,
          startedAt,
        } satisfies CodexSessionPendingWorktreePreparationState,
      };
    }

    this.emitThreadStartProgress({
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget: requestedRunInTarget,
      phase: "startingThread",
      message: "Sending message…",
      clearOutput: true,
    });
    const runLocation = await this.resolveSessionThreadRunLocation({
      projectId: input.projectId,
      projectlessWorkspace: input.projectlessWorkspace,
      sessionId: input.sessionId,
      sessionTitle: session.noThreadFallbackTitle,
      threadTitle: explicitThreadName,
      runInTarget: input.runInTarget,
      runInEnvironmentPath: input.runInEnvironmentPath,
      signal,
      onProgress: (update) => {
        this.emitThreadStartProgress({
          projectId: input.projectId,
          sessionId: input.sessionId,
          ...update,
          runInTarget: update.runInTarget ?? "newWorktree",
          threadId: update.threadId,
        });
      },
    });
    signal.throwIfAborted();
    const permissionDecision = await this.resolvePermissionStateForRequest(
      input.projectId,
      input.permissionMode,
      runLocation.workspaceRoots,
    );
    signal.throwIfAborted();
    const effectivePermissionState = permissionDecision.state;
    const permissionMode = effectivePermissionState.mode;
    const turnPermissionOverrides = buildTurnPermissionOverrides({
      permissionState: effectivePermissionState,
      workspaceRoots: runLocation.workspaceRoots,
    });
    const threadPermissionOverrides = buildThreadPermissionOverrides({
      permissionState: effectivePermissionState,
    });

    this.logger.info("Starting Codex thread for project session", {
      projectId: input.projectId,
      sessionId: input.sessionId,
      cwd: runLocation.cwd,
      runInTarget: runLocation.runInTarget,
      model: effectiveModel ?? null,
      serviceTier: formatServiceTierForReporting(input.serviceTier),
      permissionMode,
      reasoningEffort: effectiveReasoningEffort ?? null,
      collaborationMode: effectiveCollaborationMode ?? null,
      hasExplicitThreadName: Boolean(explicitThreadName),
      promptLength: prompt.length,
      promptPreview: previewText(prompt),
    });
    this.emitThreadStartProgress({
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget: runLocation.runInTarget,
      phase: "startingThread",
      message: "Sending message…",
      stream: runLocation.runInTarget === "newWorktree" ? "info" : undefined,
      outputDelta:
        runLocation.runInTarget === "newWorktree" ? "[info] Starting Codex thread\n" : undefined,
    });

    const launchPermissions: CodexLaunchPermissionParams | null =
      effectivePermissionState.effectivePreset === "custom" ? null : threadPermissionOverrides;
    const projectlessDeveloperInstructions =
      input.projectId === null
        ? buildCodexProjectlessThreadInstructions({
            cwd: runLocation.cwd,
            outputDirectory: runLocation.projectlessOutputDirectory ?? null,
            workspaceBrowserRoot: runLocation.projectlessWorkspaceBrowserRoot ?? null,
          })
        : null;
    const additionalDeveloperInstructions =
      [input.additionalDeveloperInstructions?.trim() || null, projectlessDeveloperInstructions]
        .filter((value): value is string => value !== null)
        .join("\n\n") || null;
    const threadStartParams: ThreadStartParams = {
      ...(await this.buildNewConversationParams({
        model: effectiveModel ?? null,
        executionProfile,
        serviceTier: executionProfile?.serviceTier ?? normalizeCodexServiceTier(input.serviceTier),
        cwd: runLocation.cwd,
        permissions: launchPermissions,
        defaultFeatureOverrides: CODEX_DEFAULT_FEATURE_OVERRIDES,
        personality: this.preferences.current(),
        baseInstructions: input.baseInstructions,
        additionalDeveloperInstructions,
        mode: input.mode,
        threadStartKind: input.threadStartKind,
      })),
      runtimeWorkspaceRoots: runLocation.workspaceRoots,
    };
    signal.throwIfAborted();
    return {
      kind: "immediate",
      sessionId: input.sessionId,
      request: threadStartParams,
      state: {
        input,
        context,
        session,
        preparedPrompt,
        prompt,
        materializedGoalObjective,
        effectiveModel,
        effectiveReasoningEffort,
        effectiveCollaborationMode,
        executionProfile,
        explicitThreadName,
        runLocation,
        permissionDecision,
        turnPermissionOverrides,
        startedAt,
      } satisfies CodexSessionThreadLaunchPreparationState,
    };
  }

  private readSessionThreadLaunchBase(
    prepared: CodexPreparedSessionThreadLaunch,
  ): CodexSessionThreadLaunchBaseState {
    const state = prepared.state as CodexSessionThreadLaunchBaseState;
    if (prepared.sessionId !== state.input.sessionId) {
      throw new Error("Session Thread launch identity changed");
    }
    return state;
  }

  private readSessionThreadLaunchPreparation(
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
  ): CodexSessionThreadLaunchPreparationState {
    return this.readSessionThreadLaunchBase(prepared) as CodexSessionThreadLaunchPreparationState;
  }

  private async assertSessionThreadLaunchAdmission(
    prepared: CodexPreparedSessionThreadLaunch,
  ): Promise<ProjectSession> {
    const state = this.readSessionThreadLaunchBase(prepared);
    const latestSession = await this.projectWorkspace.getProjectSession(state.input.sessionId);
    if (!latestSession || latestSession.projectId !== state.input.projectId) {
      throw new Error("Project Session ownership changed while starting its Thread");
    }
    if (latestSession.thread) {
      throw new Error(
        `Project session is already linked to Codex thread: ${latestSession.thread.threadId}`,
      );
    }
    if (state.input.projectId) {
      const project = await this.projectWorkspace.getProject(state.input.projectId);
      if (project?.lifecycle !== "active") {
        throw new Error("Codex Threads cannot be started for an inactive or removed Project");
      }
    }
    return latestSession;
  }

  async enqueuePendingSessionThreadLaunchForModule(
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "pending" }>,
    signal: AbortSignal,
  ): Promise<Extract<CodexThreadStartForSessionResult, { readonly kind: "pending" }>> {
    const state = this.readSessionThreadLaunchBase(
      prepared,
    ) as CodexSessionPendingWorktreePreparationState;
    const session = await this.assertSessionThreadLaunchAdmission(prepared);
    signal.throwIfAborted();
    if (state.input.projectId === null) {
      throw new Error("Projectless threads cannot create managed worktrees");
    }
    return await this.enqueueSessionPendingWorktreeStart({
      request: { ...state.input, projectId: state.input.projectId },
      session,
      preparedPrompt: state.preparedPrompt,
      effectiveModel: state.effectiveModel,
      effectiveReasoningEffort: state.effectiveReasoningEffort,
      effectiveCollaborationMode: state.effectiveCollaborationMode,
      executionProfile: state.executionProfile,
      explicitThreadName: state.explicitThreadName,
      browserViewScopeId: state.context.browserViewScopeId,
      signal,
    });
  }

  async beginSessionThreadLaunchForModule(
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
  ): Promise<void> {
    await this.assertSessionThreadLaunchAdmission(prepared);
    this.beginThreadStartNotificationDeferral();
  }

  async commitSessionThreadLaunchForModule(
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
    response: ThreadStartResponse,
  ): Promise<CodexCommittedSessionThreadLaunch> {
    const state = this.readSessionThreadLaunchPreparation(prepared);
    const { input, executionProfile, permissionDecision, runLocation } = state;
    const effectivePermissionState = permissionDecision.state;
    const threadId = response.thread.id.trim();
    if (!threadId || threadId !== response.thread.id) {
      throw new Error("Thread start did not return a valid thread id");
    }

    const effectiveCwd =
      resolveCodexCanonicalHydratedCwd({
        requestedCwd: runLocation.cwd,
        responseCwd: response.cwd,
        threadCwd: response.thread.cwd,
        fallbackCwd: runLocation.cwd,
      }) ?? runLocation.cwd;
    const projectedThread = { ...response.thread, cwd: effectiveCwd };
    let link = await this.upsertWorkspaceSessionLinkFromThread(
      projectedThread,
      {
        projectId: input.projectId,
        sessionId: input.sessionId,
      },
      {
        executionHostId: CODEX_APP_LOCAL_HOST_ID,
        fallbackCwd: effectiveCwd,
        managedWorktreePath: runLocation.managedWorktreePath,
        runtimeWorkspaceRoots: runLocation.workspaceRoots,
        projectlessOutputDirectory: runLocation.projectlessOutputDirectory ?? null,
        projectlessWorkspaceBrowserRoot: runLocation.projectlessWorkspaceBrowserRoot ?? null,
      },
    );
    if (!link) {
      throw new Error("Codex thread/start returned an invalid thread payload");
    }
    if (executionProfile) {
      link =
        (await this.updateWorkspaceThreadSummary(link.threadId, {
          modelProvider: executionProfile.providerId,
          executionProfile,
        })) ?? link;
    }
    const threadStart = await this.reconcileThreadStartWritableRoots(
      response,
      effectivePermissionState.sandbox,
    );
    await this.persistDynamicToolCatalogsForLaunch(link.threadId, prepared.request.dynamicTools);
    this.requestManagedWorktreeRetention();
    this.setThreadPermissionFields(link.threadId, {
      approvalPolicy: threadStart.approvalPolicy,
      approvalsReviewer: threadStart.approvalsReviewer,
      sandbox: threadStart.sandbox,
    });
    this.hydrateCanonicalConversationState(threadStart, {
      fallbackCwd: runLocation.cwd,
      resolvedCwd: effectiveCwd,
      responsePermissionFallback: this.resolveCanonicalResumePermissionContext(
        effectivePermissionState,
        runLocation.workspaceRoots,
        createCodexCanonicalWorkspacePermissionContext(runLocation.workspaceRoots),
      ),
    });
    await this.completeThreadStartNotificationDeferral(link.threadId);
    return {
      sessionId: prepared.sessionId,
      threadId: link.threadId,
      state: {
        ...state,
        threadStart,
        link,
        effectiveCwd,
      } satisfies CodexSessionThreadLaunchCommittedState,
    };
  }

  async endSessionThreadLaunchForModule(
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
  ): Promise<void> {
    this.readSessionThreadLaunchPreparation(prepared);
    await this.endThreadStartNotificationDeferral();
  }

  async prepareSessionThreadLaunchCompletionForModule(
    committed: CodexCommittedSessionThreadLaunch,
  ): Promise<CodexPreparedSessionThreadCompletion> {
    const state = committed.state as CodexSessionThreadLaunchCommittedState;
    if (
      committed.sessionId !== state.input.sessionId ||
      committed.threadId !== state.link.threadId
    ) {
      throw new Error("Committed Session Thread launch identity changed");
    }
    const {
      context,
      effectiveCollaborationMode,
      effectiveModel,
      effectiveReasoningEffort,
      effectiveCwd,
      executionProfile,
      explicitThreadName,
      input,
      link,
      materializedGoalObjective,
      permissionDecision,
      preparedPrompt,
      prompt,
      runLocation,
      startedAt,
      threadStart,
      turnPermissionOverrides,
    } = state;
    const effectivePermissionState = permissionDecision.state;

    await this.promoteBrowserUseRouteForFirstTurn({
      origin: input.browserUsePresentationOrigin,
      codexSessionId: link.threadId,
      projectId: input.projectId,
      expectedBrowserViewScopeId: context.browserViewScopeId,
    });
    this.logger.info("Created Codex thread for project session", {
      projectId: input.projectId,
      sessionId: input.sessionId,
      threadId: link.threadId,
      cwd: runLocation.cwd,
    });
    this.emitThreadStartProgress({
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget: runLocation.runInTarget,
      threadId: link.threadId,
      phase: "startingThread",
      message: "Sending message…",
      stream: runLocation.runInTarget === "newWorktree" ? "info" : undefined,
      outputDelta:
        runLocation.runInTarget === "newWorktree"
          ? "[info] Codex thread created. Sending first message\n"
          : undefined,
    });

    if (explicitThreadName) {
      await this.threadTitlePersistence.setRequired({
        threadId: link.threadId,
        name: explicitThreadName,
        normalization: "trim",
      });
    }
    if (!explicitThreadName && input.skipAutoTitleGeneration !== true) {
      const titlePrompt = buildAutoTitlePromptFromTextItems(
        buildInitialAutoTitlePromptItems({
          promptText: prompt,
          promptInput: input.promptInput,
        }),
      );
      this.scheduleGeneratedThreadName({
        threadId: link.threadId,
        prompt: titlePrompt,
        cwd: effectiveCwd,
      });
    }

    const collaborationMode = await this.buildCollaborationModePayload({
      collaborationMode: effectiveCollaborationMode,
      model: effectiveModel ?? undefined,
      reasoningEffort: effectiveReasoningEffort,
    });
    const firstTurnReasoningSummary = resolveCodexReasoningSummary({
      explicitSummary:
        input.summary !== undefined ? parseCodexReasoningSummary(input.summary) : undefined,
    });
    const firstTurnRecord = this.getConversationRecord(link.threadId);
    this.applyLatestThreadSettingsForThread(
      link.threadId,
      this.buildConversationThreadSettings({
        model: effectiveModel ?? null,
        modelProvider: executionProfile?.providerId ?? null,
        serviceTier: executionProfile?.serviceTier ?? threadStart.serviceTier,
        reasoningEffort: effectiveReasoningEffort ?? null,
        summary: firstTurnReasoningSummary,
        collaborationMode:
          effectiveCollaborationMode ?? firstTurnRecord.latestCollaborationMode.mode,
        fallback: firstTurnRecord.latestThreadSettings,
        fallbackCollaborationMode: firstTurnRecord.latestCollaborationMode,
      }),
    );

    const firstTurnInput =
      materializedGoalObjective.length > 0
        ? replaceFirstTextInput(preparedPrompt.inputItems, `/goal ${materializedGoalObjective}`)
        : preparedPrompt.inputItems;
    const firstTurnAttachments = buildCodexPendingFirstTurnAttachments({
      fileAttachments: preparedPrompt.fileAttachments,
      addedFiles: preparedPrompt.addedFiles,
      threadGoalDraft: input.threadGoalDraft,
    });
    const clientUserMessageId = randomUUID();
    const ownerClientId = context.ownerClientId?.trim() || null;
    if (ownerClientId) {
      if (this.rendererConversations.isClientDisposed(ownerClientId)) {
        throw new Error(`Renderer client '${ownerClientId}' is unavailable`);
      }
      const turnStartParams: CodexAppPrivateTurnStartParams = {
        threadId: link.threadId,
        clientUserMessageId,
        input: firstTurnInput,
        responsesapiClientMetadata: {
          workspace_kind: input.projectId === null ? "projectless" : "project",
        },
        cwd: effectiveCwd,
        ...(preparedPrompt.additionalContext
          ? { additionalContext: preparedPrompt.additionalContext }
          : {}),
        ...turnPermissionOverrides,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...buildServiceTierParams(input.serviceTier),
        ...(effectiveReasoningEffort ? { effort: effectiveReasoningEffort } : {}),
        summary: firstTurnReasoningSummary,
        ...(collaborationMode ? { collaborationMode } : {}),
        attachments: firstTurnAttachments,
      };
      const record = this.getConversationRecord(link.threadId);
      const canonicalState = this.readCanonicalConversationState(record.threadId);
      const hydration = canonicalState?.sidecar.hydrationContext;
      if (!canonicalState || !hydration) {
        throw new Error("Codex thread/start did not initialize canonical conversation state");
      }
      const firstTurnPermissionContext = hydration.currentPermissions;
      const canonicalTurnParams: CodexCanonicalLiveTurnParams<
        CodexLiveFileAttachment,
        CodexReviewDiffCommentAttachment
      > = {
        ...turnStartParams,
        cwd: effectiveCwd,
        approvalPolicy: turnStartParams.approvalPolicy ?? firstTurnPermissionContext.approvalPolicy,
        approvalsReviewer:
          turnStartParams.approvalsReviewer ?? firstTurnPermissionContext.approvalsReviewer,
        sandboxPolicy: turnStartParams.sandboxPolicy ?? firstTurnPermissionContext.sandboxPolicy,
        permissions: firstTurnPermissionContext.activePermissionProfile?.id ?? null,
        runtimeWorkspaceRoots: firstTurnPermissionContext.activePermissionProfile
          ? [...firstTurnPermissionContext.runtimeWorkspaceRoots]
          : null,
        useAppServerPermissionDefault: effectivePermissionState.effectivePreset === "custom",
        model: collaborationMode ? null : (effectiveModel ?? threadStart.model),
        serviceTier: normalizeCodexServiceTier(input.serviceTier) ?? threadStart.serviceTier,
        effort: collaborationMode
          ? null
          : (effectiveReasoningEffort ?? threadStart.reasoningEffort),
        multiAgentMode: "explicitRequestOnly",
        summary: firstTurnReasoningSummary,
        personality: this.preferences.current(),
        outputSchema: null,
        collaborationMode,
        attachments: firstTurnAttachments,
        commentAttachments: [...preparedPrompt.commentAttachments],
      };
      const launchId = randomUUID();
      this.syncDormantConversationFromRecord(link.threadId, "owner-unavailable");
      const detail = this.serializeThreadDetail(link.threadId);
      if (!detail) {
        throw new Error("Thread was created but could not be loaded");
      }
      this.registerFreshThreadLaunch({
        launchId,
        rendererClientId: ownerClientId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        threadId: link.threadId,
        runInTarget: runLocation.runInTarget,
        startedAt,
        clientUserMessageId,
        canonicalParams: canonicalTurnParams,
        turnStartParams,
        verifiedBuiltinFullAccess: permissionDecision.verifiedBuiltinFullAccess,
        goalObjective: materializedGoalObjective,
        rawGoalDraft: input.threadGoalDraft ?? null,
        heartbeatAutomation: input.heartbeatAutomation,
      });
      this.logger.info("Prepared first Codex turn for renderer ownership", {
        threadId: link.threadId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        durationMs: Date.now() - startedAt,
      });
      return {
        kind: "complete",
        result: {
          kind: "started",
          detail,
          freshLaunch: {
            launchId,
            threadId: link.threadId,
            clientUserMessageId,
            canonicalParams: canonicalTurnParams,
          },
        },
      };
    }

    const preparedFirstTurn: CodexPreparedPrompt = {
      promptText:
        materializedGoalObjective.length > 0
          ? `/goal ${materializedGoalObjective}`
          : preparedPrompt.promptText,
      inputItems: [...firstTurnInput] as CodexPreparedPrompt["inputItems"],
      pendingInputItems: [
        ...preparedPrompt.pendingInputItems,
      ] as CodexPreparedPrompt["pendingInputItems"],
      fileAttachments: [...firstTurnAttachments],
      addedFiles: [],
      pastedTextAttachments: [],
      ...(preparedPrompt.additionalContext
        ? {
            additionalContext:
              preparedPrompt.additionalContext as CodexPreparedPrompt["additionalContext"],
          }
        : {}),
      commentAttachments: [...preparedPrompt.commentAttachments],
      agentConfigs: [],
    };
    return {
      kind: "main-owned-first-turn",
      sessionId: input.sessionId,
      threadId: link.threadId,
      prompt: preparedFirstTurn.promptText,
      overrides: {
        clientUserMessageId,
        preparedPrompt: preparedFirstTurn,
        responsesapiClientMetadata: {
          workspace_kind: input.projectId === null ? "projectless" : "project",
        },
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(input.serviceTier === undefined ? {} : { serviceTier: input.serviceTier }),
        ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
        ...(effectiveReasoningEffort === undefined
          ? {}
          : { reasoningEffort: effectiveReasoningEffort }),
        summary: firstTurnReasoningSummary,
        ...(effectiveCollaborationMode === undefined
          ? {}
          : { collaborationMode: effectiveCollaborationMode }),
      },
      state: committed.state,
    };
  }

  async finishSessionThreadLaunchFirstTurnForModule(
    prepared: Extract<
      CodexPreparedSessionThreadCompletion,
      { readonly kind: "main-owned-first-turn" }
    >,
    startedTurn: CodexTurnSummary,
  ): Promise<CodexThreadStartForSessionResult> {
    const state = prepared.state as CodexSessionThreadLaunchCommittedState;
    if (prepared.sessionId !== state.input.sessionId || prepared.threadId !== state.link.threadId) {
      throw new Error("Prepared Session first Turn identity changed");
    }
    const { input, link, materializedGoalObjective, runLocation, startedAt } = state;
    await this.applyStartedSessionThreadGoal({
      threadId: link.threadId,
      objective: materializedGoalObjective,
      rawDraft: input.threadGoalDraft ?? null,
    });
    if (runLocation.runInTarget === "newWorktree" && input.projectId !== null) {
      await this.createHeartbeatAutomationForStartedWorktreeThread({
        projectId: input.projectId,
        sessionId: input.sessionId,
        threadId: link.threadId,
        heartbeatAutomation: input.heartbeatAutomation,
      });
    }
    this.logger.info("Started first Codex turn for project session", {
      threadId: link.threadId,
      turnId: startedTurn.turnId,
      durationMs: Date.now() - startedAt,
    });
    this.syncDormantConversationFromRecord(link.threadId, "owner-unavailable");
    const detail = this.serializeThreadDetail(link.threadId);
    if (!detail) {
      throw new Error("Thread was created but could not be loaded");
    }
    this.logger.info("Codex thread for project session is ready", {
      threadId: link.threadId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      cwd: runLocation.cwd,
      durationMs: Date.now() - startedAt,
    });
    this.emitThreadStartProgress({
      projectId: input.projectId,
      sessionId: input.sessionId,
      runInTarget: runLocation.runInTarget,
      threadId: link.threadId,
      phase: "ready",
      message: runLocation.runInTarget === "newWorktree" ? "Worktree ready." : "Message sent.",
      stream: runLocation.runInTarget === "newWorktree" ? "info" : undefined,
      outputDelta:
        runLocation.runInTarget === "newWorktree" ? "[info] Worktree ready.\n" : undefined,
    });
    return { kind: "started", detail };
  }

  async failSessionThreadLaunchForModule(input: {
    readonly request: CodexThreadStartForSessionInput;
    readonly prepared: CodexPreparedSessionThreadLaunch | null;
    readonly committedThreadId: string | null;
    readonly cause: unknown;
  }): Promise<void> {
    const preparedState = input.prepared ? this.readSessionThreadLaunchBase(input.prepared) : null;
    const request = input.request;
    const startedAt = preparedState?.startedAt ?? Date.now();
    const runInTarget =
      input.prepared?.kind === "immediate"
        ? this.readSessionThreadLaunchPreparation(input.prepared).runLocation.runInTarget
        : (request.runInTarget ?? "localProject");
    this.logger.error("Failed to start Codex thread for project session", {
      projectId: request.projectId,
      sessionId: request.sessionId,
      durationMs: Date.now() - startedAt,
      error: input.cause,
    });
    if (!input.committedThreadId && request.threadGoalMaterializedDraft?.attachmentDirectory) {
      await this.attachments.goals
        .removeDirectory(request.threadGoalMaterializedDraft.attachmentDirectory)
        .catch(() => undefined);
    }
    if ((request.runInTarget ?? "localProject") === "newWorktree") return;
    this.emitThreadStartProgress({
      projectId: request.projectId,
      sessionId: request.sessionId,
      runInTarget,
      threadId: input.committedThreadId,
      phase: "failed",
      message: "Message could not be sent.",
      stream: "stderr",
    });
  }

  async forkProjectSessionThread(
    sessionId: string,
    input: ProjectSessionForkInput,
    sourceSceneContext?: CodexForkBrowserSceneContext,
  ): Promise<ProjectSessionForkResult> {
    await this.ensureClientReady();

    const parsed = ProjectSessionForkInputSchema.parse(input);
    const sourceSession = await this.projectWorkspace.getProjectSession(sessionId);
    if (!sourceSession) {
      throw new Error(`Project session not found: ${sessionId}`);
    }
    if (!sourceSession.thread) {
      throw new Error("Session has no Codex thread to fork");
    }
    if (
      sourceSceneContext &&
      (sourceSceneContext.scene.owner.kind !== "session" ||
        sourceSceneContext.scene.owner.sessionId !== sourceSession.id)
    ) {
      throw new Error("Fork source Scene does not belong to the source session");
    }
    const sourceThread = sourceSession.thread;
    const sourceWorkspaceInheritance = resolveCodexForkWorkspaceInheritance(sourceThread);
    if (!sourceThread.cwd) {
      throw new Error("Session thread has no working directory to fork");
    }
    const sourceProjectId = sourceSession.projectId;
    const sourceThreadId = sourceThread.threadId;
    let sourceDetail = parsed.turnId
      ? (this.serializeThreadDetail(sourceThreadId) ??
        (await this.readThread(sourceThreadId, true)))
      : null;
    if (parsed.turnId && !sourceDetail) {
      throw new Error(`Thread '${sourceThreadId}' could not be loaded for turn-scoped fork`);
    }
    if (parsed.turnId) {
      await this.conversationHistory.loadComplete(sourceThreadId, false);
      sourceDetail = this.serializeThreadDetail(sourceThreadId) ?? sourceDetail;
    }
    const sourceTurn =
      parsed.turnId && sourceDetail
        ? sourceDetail.turns.find((turn) => turn.turnId === parsed.turnId)
        : null;
    if (parsed.turnId && !sourceTurn) {
      throw new Error(`Turn '${parsed.turnId}' was not found in thread '${sourceThreadId}'`);
    }
    const sourceTurnIndex =
      parsed.turnId && sourceDetail
        ? sourceDetail.turns.findIndex((turn) => turn.turnId === parsed.turnId)
        : -1;
    const trailingTurnCount =
      sourceTurnIndex < 0 || !sourceDetail ? 0 : sourceDetail.turns.length - sourceTurnIndex - 1;
    const sourceTitle = this.resolveForkedFromConversationTitle(sourceDetail ?? sourceThread);
    const forkThreadTitle = this.resolveUserFacingForkThreadTitle(sourceDetail ?? sourceThread);
    if (parsed.target === "newWorktree") {
      const sourceWorkspaceRoots = await this.resolvePendingWorktreeSourceWorkspaceRoots({
        projectId: sourceProjectId,
        sourceThreadId,
        sourceWorkspaceRoot: sourceThread.cwd,
      });
      const created = this.createPendingWorktree({
        hostId: CODEX_APP_LOCAL_HOST_ID,
        label: forkThreadTitle ?? "New task",
        ...(forkThreadTitle ? { initialThreadTitle: forkThreadTitle } : {}),
        sourceWorkspaceRoot: sourceThread.cwd,
        sourceWorkspaceRoots,
        startingState: { type: "working-tree" },
        localEnvironmentConfigPath: parsed.localEnvironmentConfigPath ?? null,
        launchMode: "fork-conversation",
        projectAssignment:
          sourceProjectId === null
            ? null
            : {
                projectKind: "local",
                projectId: sourceProjectId,
                path: sourceThread.cwd,
                pendingCoreUpdate: false,
              },
        prompt: "Continue this task in a new worktree",
        startConversationParamsInput: null,
        sourceConversationId: sourceThreadId,
        sourceCollaborationMode:
          sourceDetail?.latestCollaborationMode ??
          this.serializeThreadDetail(sourceThreadId)?.latestCollaborationMode ??
          null,
        targetTurnId: parsed.turnId ?? null,
        threadSource: "user",
      });
      await this.forkSidePanelTransferLifecycle?.capturePending({
        pendingWorktreeId: created.pendingWorktreeId,
        sourceConversationId: sourceThreadId,
        sourceWorkspaceRoot: sourceThread.cwd,
        ...(sourceSceneContext ? { sourceSceneContext } : {}),
      });
      if (!created.clientThreadId) {
        throw new Error("Pending fork did not allocate a client thread id");
      }
      return {
        pendingWorktreeId: created.pendingWorktreeId,
        clientThreadId: created.clientThreadId,
      };
    }
    const runLocation = {
      cwd: sourceThread.cwd,
      workspaceRoots: [sourceThread.cwd],
      runInTarget: "localProject" as const,
      managedWorktreePath: null,
    };

    const shouldDeferThreadStarted = sourceProjectId !== null;
    if (shouldDeferThreadStarted) {
      this.beginThreadStartNotificationDeferral();
    }
    let threadStartDeferralOpen = shouldDeferThreadStarted;
    const nextSessionBox: {
      value: ProjectSession | null;
    } = { value: null };
    let createdSessionId: string | null = null;
    let summary: CodexThreadSummary;
    let detail: CodexThreadDetail;
    let worktreeOwnershipTransferred = false;
    const materializeSessionFork = async (
      projectedThread: Thread,
      resolvedCwd: string | null,
    ): Promise<CodexPersistentForkMaterialization> => {
      const nextSession =
        nextSessionBox.value ??
        (await this.projectWorkspace.createProjectSession({
          projectId: sourceProjectId,
          noThreadFallbackTitle: sourceSession.displayTitle,
        }));
      if (nextSessionBox.value === null) createdSessionId = nextSession.id;
      nextSessionBox.value = nextSession;
      const attachedSummary = await this.upsertWorkspaceSessionLinkFromThread(
        projectedThread,
        {
          projectId: sourceProjectId,
          sessionId: nextSession.id,
        },
        {
          executionHostId: CODEX_APP_LOCAL_HOST_ID,
          fallbackCwd: resolvedCwd ?? runLocation.cwd,
          managedWorktreePath: runLocation.managedWorktreePath,
          runtimeWorkspaceRoots: runLocation.workspaceRoots,
          projectlessOutputDirectory: sourceWorkspaceInheritance.projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot:
            sourceWorkspaceInheritance.projectlessWorkspaceBrowserRoot,
        },
      );
      if (!attachedSummary) {
        throw new Error("Thread fork completed but could not be attached to a project session");
      }
      worktreeOwnershipTransferred = true;
      this.requestManagedWorktreeRetention();
      const projectedDetail =
        this.buildThreadDetailFromRead(projectedThread, {
          preserveExistingTimeline: true,
        }) ?? this.serializeThreadDetail(projectedThread.id);
      if (!projectedDetail) {
        throw new Error(
          `Thread fork completed but canonical conversation '${projectedThread.id}' is unavailable`,
        );
      }
      return { detail: projectedDetail, summary: attachedSummary };
    };
    try {
      const fork = await this.forkAndResumePersistentConversation({
        sourceThreadId,
        requestedCwd: runLocation.cwd,
        workspaceRoots: runLocation.workspaceRoots,
        threadSource: "user",
        materialize: materializeSessionFork,
      });
      const forkedThreadId = fork.threadId;
      const resolvedCwd = fork.resolvedCwd;
      detail = fork.detail;
      if (!fork.summary) {
        throw new Error("Thread fork completed without a project-session summary");
      }
      summary = fork.summary;
      if (threadStartDeferralOpen) {
        await this.completeThreadStartNotificationDeferral(forkedThreadId);
        await this.endThreadStartNotificationDeferral();
        threadStartDeferralOpen = false;
      }
      if (trailingTurnCount > 0) {
        const rollbackResponse = await this.client.request<
          "thread/rollback",
          ThreadRollbackResponse
        >("thread/rollback", {
          threadId: forkedThreadId,
          numTurns: trailingTurnCount,
        });
        const rollbackMaterialized = await this.applyForkRollbackResponse({
          threadId: forkedThreadId,
          response: rollbackResponse,
          fallbackRef: this.parseThreadRef(forkedThreadId),
          fallbackCwd: resolvedCwd ?? runLocation.cwd,
          materialize: materializeSessionFork,
        });
        detail = rollbackMaterialized.detail;
        summary = rollbackMaterialized.summary ?? summary;
      }
      if (parsed.collaborationMode) {
        const latestCollaborationMode = this.buildCollaborationModeState({
          collaborationMode: parsed.collaborationMode,
          fallback: detail.latestCollaborationMode,
        });
        this.setLatestCollaborationModeForThread(detail.threadId, latestCollaborationMode);
      }
      this.appendForkedFromConversationMarker(forkedThreadId, sourceThreadId, sourceTitle);
      this.syncDormantConversationFromRecord(forkedThreadId, "owner-unavailable");
    } catch (error) {
      if (createdSessionId && !worktreeOwnershipTransferred) {
        await this.projectWorkspace.deleteProjectSession(createdSessionId).catch(() => undefined);
        nextSessionBox.value = null;
      }
      if (runLocation.managedWorktreePath && !worktreeOwnershipTransferred) {
        await this.managedWorktreeLifecycle
          .remove({
            hostId: CODEX_APP_LOCAL_HOST_ID,
            worktreeGitRoot: runLocation.managedWorktreePath,
            reason: "failed-create",
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      if (threadStartDeferralOpen) {
        await this.endThreadStartNotificationDeferral();
      }
    }
    this.emitEvent({ type: "threadSummary", thread: summary });
    if (forkThreadTitle) {
      await this.threadTitlePersistence.set({
        threadId: detail.threadId,
        name: forkThreadTitle,
        normalization: "manual",
      });
    }
    await this.forkSidePanelTransferLifecycle?.stageDirect({
      sourceConversationId: sourceThreadId,
      targetConversationId: detail.threadId,
      ...(sourceSceneContext ? { sourceSceneContext } : {}),
    });

    const nextSession = nextSessionBox.value;
    if (!nextSession) {
      throw new Error("Forked project session was not created");
    }
    const session = await this.projectWorkspace.getProjectSession(nextSession.id);
    if (!session) {
      throw new Error("Forked project session could not be loaded");
    }

    return {
      session,
      threadId: summary.threadId,
      ...(parsed.turnId ? { composerIntent: this.buildComposerIntent("") } : {}),
    };
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

  async readConversationSnapshotForModule(
    threadId: string,
  ): Promise<CodexConversationSnapshot | null> {
    const startedAt = getDevRuntimeMetricStart();
    const existingConversation = this.serializeConversationSnapshot(threadId);
    if (existingConversation) {
      this.syncDormantConversationFromRecord(threadId, "explicit-resync");
      logDevRuntimeMetric("codex.thread.snapshot.request", {
        threadId,
        cacheHit: true,
        turnCount: existingConversation.turns.length,
        childMembershipCount: existingConversation.childMemberships.length,
        approxPayloadBytes: approximateJsonPayloadBytes(existingConversation),
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      return existingConversation;
    }

    logDevRuntimeMetric("codex.thread.snapshot.request", {
      threadId,
      cacheHit: false,
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return null;
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
    const resumedCollaborationMode = this.buildCollaborationModeState({
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

    const ownsResumeBuffer = this.beginResumeNotificationBuffer(threadId);
    if (ownsResumeBuffer) {
      this.setConversationResumeState(threadId, "resuming");
    }

    try {
      const detail = await this.resumeConversationRecord(threadId, seed, force);
      if (ownsResumeBuffer) {
        this.setConversationResumeState(threadId, detail ? "resumed" : "needs_resume");
        await this.releaseConversationResumeBufferCore(threadId);
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
      }
      return detail;
    } catch (error) {
      if (ownsResumeBuffer) {
        this.setConversationResumeState(threadId, "needs_resume");
        this.discardConversationResumeBuffer(threadId, error);
      }
      throw error;
    }
  }

  async requestConversationResume(
    threadId: string,
    options: RequestConversationResumeOptions = {},
  ): Promise<CodexConversationSnapshot | null> {
    return await this.conversationResume.resume({ threadId, ...options });
  }

  recordConversationResumeOutcome(outcome: CodexConversationResumeOutcome): void {
    const result = outcome.result;
    if (outcome.join && outcome.error === undefined) {
      this.logger.debug("Joined in-flight Codex thread resume", {
        threadId: outcome.input.threadId,
      });
    }
    logDevRuntimeMetric("codex.thread.resume.request", {
      threadId: outcome.input.threadId,
      outcome: outcome.error === undefined ? "success" : "error",
      join: outcome.join,
      syncDormantConversationSnapshots: outcome.input.syncDormantConversationSnapshots,
      replayBufferedNotifications: outcome.input.replayBufferedNotifications,
      ...(outcome.error === undefined
        ? {
            hasSnapshot: result != null,
            turnCount: result?.turns.length ?? null,
            childMembershipCount: result?.childMemberships.length ?? null,
            approxPayloadBytes: result ? approximateJsonPayloadBytes(result) : null,
          }
        : {
            error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
          }),
      durationMs: outcome.durationMs,
    });
  }

  /** Effect Module adapter operation; runs one admitted resume demand. */
  async runConversationResume(
    input: CodexConversationResumeDemand,
  ): Promise<CodexConversationSnapshot | null> {
    const { threadId } = input;
    await this.readWorkspaceThread(threadId);
    const syncDormantConversationSnapshots = input.syncDormantConversationSnapshots;
    const replayBufferedNotifications = input.replayBufferedNotifications;
    const syncOrEmitSnapshot = (): number => {
      if (syncDormantConversationSnapshots) {
        this.syncDormantConversationFromRecord(threadId, "explicit-resync");
        return this.readConversationAggregate(threadId)?.revision ?? 0;
      }

      return this.syncAcceptedConversationDocumentSilently(threadId);
    };

    const existingLink = this.getThreadLinkSafely(threadId);
    if (existingLink?.archived) {
      this.ensureConversationDetail(threadId);
      this.setConversationResumeState(threadId, "needs_resume");
      syncOrEmitSnapshot();
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      return this.serializeConversationSnapshotIncludingArchived(threadId);
    }

    const existingRecord = this.getMaybeConversationRecord(threadId);
    if (
      existingRecord &&
      this.readConversationStreamRole(threadId) !== null &&
      (this.resolveConversationResumeState(threadId) !== "needs_resume" ||
        this.conversationAggregate(threadId).isStreaming())
    ) {
      const hadDeferredBuffer = this.hasResumeNotificationBuffer(threadId);
      if (replayBufferedNotifications && hadDeferredBuffer) {
        await this.releaseConversationResumeBufferCore(threadId);
      }
      const revision = syncOrEmitSnapshot();
      if (replayBufferedNotifications && hadDeferredBuffer) {
        if (!this.postResumeGoals.release(threadId, revision)) {
          this.startPostResumeGoalFlow(threadId, revision);
        }
      }
      return this.serializeConversationSnapshot(threadId);
    }

    this.beginResumeNotificationBuffer(threadId);
    this.setConversationResumeState(threadId, "resuming");
    this.ensureConversationDetail(threadId);
    syncOrEmitSnapshot();

    try {
      const detail = await this.resumeThreadWithSeed(threadId, undefined, true);
      if (!detail) {
        await this.releaseConversationResumeBufferCore(threadId);
        this.setConversationResumeState(threadId, "needs_resume");
        syncOrEmitSnapshot();
        this.rendererConversationCoordinator.reconcileOwnership(threadId);
        return null;
      }

      this.setConversationResumeState(threadId, "resumed");
      if (replayBufferedNotifications) {
        await this.releaseConversationResumeBufferCore(threadId);
      }
      const revision = syncOrEmitSnapshot();
      if (replayBufferedNotifications) {
        this.startPostResumeGoalFlow(threadId, revision);
      } else {
        this.postResumeGoals.defer(threadId);
      }
      return this.serializeConversationSnapshot(threadId);
    } catch (error) {
      this.discardConversationResumeBuffer(threadId, error);
      this.postResumeGoals.clear(threadId);
      this.setConversationResumeState(threadId, "needs_resume");
      this.ensureConversationRecord(threadId);
      this.setConversationStreamRole(threadId, null);
      this.conversationAggregate(threadId).setStreaming(false);
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      if (isThreadArchivedError(error)) {
        this.rememberWorkspaceSidebar(
          await this.projectWorkspace.setThreadArchived(threadId, true),
        );
        const persisted = await this.readWorkspaceThread(threadId);
        if (persisted) {
          this.emitEvent({
            type: "threadSummary",
            thread: this.buildWorkspaceThreadSummary(persisted),
          });
        }
        const detail = this.ensureConversationDetail(threadId);
        if (detail) {
          detail.archived = true;
        }
        this.emitEvent({ type: "threadArchivedState", threadId, archived: true });
        const metadata = createSidebarThreadSyncMetadata();
        markSidebarSyncScopeChanged(metadata, persisted?.projectId ?? detail?.projectId ?? null);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
        syncOrEmitSnapshot();
        return this.serializeConversationSnapshotIncludingArchived(threadId);
      }
      syncOrEmitSnapshot();
      throw error;
    }
  }

  private registerFreshThreadLaunch(launch: CodexFreshThreadLaunch): void {
    this.freshThreadLaunch.register(launch);
  }

  abandonFreshThreadLaunch(launch: CodexFreshThreadLaunch, reason: unknown): void {
    if (this.hasResumeNotificationBuffer(launch.threadId)) {
      this.discardConversationResumeBuffer(launch.threadId, reason);
    }
    this.emitThreadStartProgress({
      projectId: launch.projectId,
      sessionId: launch.sessionId,
      runInTarget: launch.runInTarget,
      threadId: launch.threadId,
      phase: "failed",
      message: "Message could not be sent because its window closed.",
      stream: "stderr",
    });
  }

  /** Effect Module adapter operation; callers use conversationHistory instead. */
  async loadConversationHistory(input: {
    readonly threadId: string;
    readonly loadCompleteHistory: boolean;
    readonly broadcastResult: boolean;
  }): Promise<void> {
    const { threadId, loadCompleteHistory, broadcastResult } = input;
    for (;;) {
      const record = this.getMaybeConversationRecord(threadId);
      const pagination = this.readConversationTurnPagination(threadId);
      if (
        !record ||
        pagination.isLoadingOlder ||
        pagination.olderCursor === null ||
        pagination.hasLoadedOldest
      ) {
        return;
      }
      const pageHydrationContext = this.resolveCanonicalOlderTurnHydrationContext(threadId);
      const status = loadCompleteHistory
        ? await this.loadRemainingThreadTurns(threadId, pageHydrationContext, { broadcastResult })
        : await this.loadOlderThreadTurnsPage(
            threadId,
            {
              broadcastLoading: broadcastResult,
              broadcastResult,
            },
            pageHydrationContext,
          );
      if (status === "loaded") return;
    }
  }

  private async loadOlderThreadTurnsPage(
    threadId: string,
    options: { broadcastLoading: boolean; broadcastResult: boolean },
    pageHydrationContext: CodexOlderTurnHydrationContext,
  ): Promise<"loaded" | "stale"> {
    await this.ensureClientReady();
    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return "loaded";

    const aggregate = this.conversationAggregate(threadId);
    const pagination = aggregate.readTurnPagination();
    if (pagination.hasLoadedOldest || pagination.olderCursor === null) {
      aggregate.initializeHistory(
        this.buildCompleteTurnPagination(detail.turns.length),
        detail.turns.length,
      );
      const snapshot = this.serializeConversationSnapshot(threadId);
      if (snapshot && options.broadcastResult) {
        this.storeDormantConversationSnapshot(threadId, snapshot, "explicit-resync");
      }
      return "loaded";
    }

    const fence = aggregate.beginHistoryLoad(detail.turns.length);
    if (!fence) return "stale";
    const requestedCursor = fence.olderCursor;
    const requestedOldestLoadedTurnId = fence.oldestLoadedTurnId;
    if (options.broadcastLoading) {
      const loadingSnapshot = this.serializeConversationSnapshot(threadId);
      if (loadingSnapshot) {
        this.storeDormantConversationSnapshot(threadId, loadingSnapshot, "explicit-resync");
      }
    }

    try {
      const page = await this.client.request<"thread/turns/list", ThreadTurnsListResponse>(
        "thread/turns/list",
        {
          threadId,
          cursor: requestedCursor,
          limit: THREAD_TURNS_PAGE_SIZE,
          sortDirection: "desc",
          itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
        },
      );
      const currentDetail = this.ensureConversationDetail(threadId);
      if (!currentDetail) {
        aggregate.failHistoryLoad(fence);
        return "loaded";
      }
      if (!aggregate.isHistoryLoadCurrent(fence)) return "stale";

      if (page.nextCursor === requestedCursor) {
        throw new Error("Codex older-turn pagination did not advance its cursor");
      }

      const rawPageTurns = [...page.data].reverse();
      const canonicalState = this.mergeCanonicalOlderTurnPage(
        threadId,
        rawPageTurns,
        requestedOldestLoadedTurnId,
        pageHydrationContext,
      );
      const mergedDetail = this.buildThreadDetailFromCanonicalState(canonicalState);
      if (!mergedDetail) {
        throw new Error(`Canonical history projection failed for '${threadId}'`);
      }
      this.setConversationRecordDetail(mergedDetail, { preserveTurnPagination: true });
      const nextPagination = this.buildTurnPaginationFromPage(
        page,
        mergedDetail.turns.length,
        rawPageTurns[0]?.id ?? requestedOldestLoadedTurnId,
      );
      if (!aggregate.commitHistoryLoad(fence, nextPagination, mergedDetail.turns.length)) {
        return "stale";
      }
      await this.persistThreadDetailSummary(mergedDetail);
      const snapshot = this.serializeConversationSnapshot(threadId);
      if (snapshot && options.broadcastResult) {
        this.storeDormantConversationSnapshot(threadId, snapshot, "explicit-resync");
      }
      return "loaded";
    } catch (error) {
      if (!aggregate.isHistoryLoadCurrent(fence)) return "stale";
      this.logger.warn("Failed to load older Codex thread turns", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      aggregate.failHistoryLoad(fence);
      throw error;
    }
  }

  scheduleRemainingThreadTurnsLoad(threadId: string): void {
    this.conversationHistory.requestRemaining(threadId);
  }

  shouldLoadRemainingThreadTurns(threadId: string): boolean {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return false;
    const pagination = this.readConversationTurnPagination(threadId);
    return !(pagination.olderCursor === null || pagination.hasLoadedOldest === true);
  }

  private async loadRemainingThreadTurns(
    threadId: string,
    pageHydrationContext: CodexOlderTurnHydrationContext,
    options: { broadcastResult: boolean },
  ): Promise<"loaded" | "stale"> {
    await this.ensureClientReady();
    const detail = this.ensureConversationDetail(threadId);
    if (!detail) return "loaded";

    const aggregate = this.conversationAggregate(threadId);
    const pagination = aggregate.readTurnPagination();
    const requestedCursor = pagination.olderCursor;
    if (pagination.hasLoadedOldest || requestedCursor === null) {
      aggregate.initializeHistory(
        this.buildCompleteTurnPagination(detail.turns.length),
        detail.turns.length,
      );
      return "loaded";
    }
    const fence = aggregate.beginHistoryLoad(detail.turns.length);
    if (!fence) return "stale";
    const requestedOldestLoadedTurnId = fence.oldestLoadedTurnId;

    const hydratedPages: Turn[][] = [];
    let cursor: string | null = requestedCursor;
    let lastPage: ThreadTurnsListResponse | null = null;
    try {
      while (cursor !== null) {
        const page: ThreadTurnsListResponse = await this.client.request<
          "thread/turns/list",
          ThreadTurnsListResponse
        >("thread/turns/list", {
          threadId,
          cursor,
          limit: THREAD_TURNS_PAGE_SIZE,
          sortDirection: "desc",
          itemsView: THREAD_TURNS_PAGE_ITEMS_VIEW,
        });
        if (!aggregate.isHistoryLoadCurrent(fence)) return "stale";
        if (page.nextCursor === cursor) {
          throw new Error("Codex older-turn pagination did not advance its cursor");
        }
        hydratedPages.push([...page.data].reverse());
        lastPage = page;
        cursor = page.nextCursor;
      }

      const currentDetail = this.ensureConversationDetail(threadId);
      if (!currentDetail || !lastPage) {
        aggregate.failHistoryLoad(fence);
        return "loaded";
      }
      if (!aggregate.isHistoryLoadCurrent(fence)) return "stale";
      const rawTurns = hydratedPages.reverse().flat();
      const canonicalState = this.mergeCanonicalOlderTurnPage(
        threadId,
        rawTurns,
        requestedOldestLoadedTurnId,
        pageHydrationContext,
      );
      const combinedPage: ThreadTurnsListResponse = {
        data: [...rawTurns].reverse(),
        nextCursor: null,
        backwardsCursor: lastPage.backwardsCursor,
      };
      const mergedDetail = this.buildThreadDetailFromCanonicalState(canonicalState);
      if (!mergedDetail) {
        throw new Error(`Canonical history projection failed for '${threadId}'`);
      }
      this.setConversationRecordDetail(mergedDetail, { preserveTurnPagination: true });
      const nextPagination = this.buildTurnPaginationFromPage(
        combinedPage,
        mergedDetail.turns.length,
        rawTurns[0]?.id ?? requestedOldestLoadedTurnId,
      );
      if (!aggregate.commitHistoryLoad(fence, nextPagination, mergedDetail.turns.length)) {
        return "stale";
      }
      await this.persistThreadDetailSummary(mergedDetail);
      const snapshot = this.serializeConversationSnapshot(threadId);
      if (snapshot && options.broadcastResult) {
        this.storeDormantConversationSnapshot(threadId, snapshot, "explicit-resync");
      }
      return "loaded";
    } catch (error) {
      if (!aggregate.isHistoryLoadCurrent(fence)) return "stale";
      this.logger.warn("Failed to load older Codex thread turns", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      aggregate.failHistoryLoad(fence);
      throw error;
    }
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

  prepareRendererOwnedThreadRollbackForModule(input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly numTurns: number;
  }): CodexPreparedThreadRollback {
    if (input.numTurns !== 1) {
      throw new Error("Owner thread/rollback currently supports numTurns: 1");
    }
    const currentDetail = this.serializeThreadDetail(input.threadId);
    if (!currentDetail) {
      throw new Error(`Thread '${input.threadId}' was not found`);
    }
    const latestEditableTurn = this.resolveLatestEditableTurn(currentDetail);
    if (!latestEditableTurn || latestEditableTurn.turnId !== input.turnId) {
      throw new Error("Only the latest completed user turn can be edited");
    }
    return {
      threadId: input.threadId,
      request: { threadId: input.threadId, numTurns: input.numTurns },
      state: {
        threadId: input.threadId,
        fallbackRef: this.parseThreadRef(input.threadId),
        fallbackCwd: currentDetail.cwd,
      } satisfies CodexThreadRollbackTransactionState,
    };
  }

  async commitRendererOwnedThreadRollbackForModule(
    prepared: CodexPreparedThreadRollback,
    response: ThreadRollbackResponse,
  ): Promise<ThreadRollbackResponse> {
    const transaction = prepared.state as CodexThreadRollbackTransactionState;
    if (transaction.threadId !== prepared.threadId) {
      throw new Error("Renderer-owned Thread rollback identity changed");
    }
    await this.applyForkRollbackResponse({
      threadId: prepared.threadId,
      response,
      fallbackRef: transaction.fallbackRef,
      fallbackCwd: transaction.fallbackCwd,
    });
    this.syncAcceptedConversationDocumentSilently(prepared.threadId);
    return response;
  }

  async forkRendererOwnedThreadFromTurnForModule(input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly message: string;
  }): Promise<CodexThreadActionResult> {
    await this.waitForRendererOwnerNotificationDrain(input.threadId);
    if (!input.turnId.trim()) throw new Error("Owner thread/fork requires a turnId");
    return await this.forkConversationFromTurn(input.threadId, input.turnId, input.message, {
      syncDormantConversationUpdates: false,
    });
  }

  prepareFreshThreadFirstTurnForModule(
    launch: CodexFreshThreadLaunch,
  ): CodexPreparedFreshThreadFirstTurn {
    const { attachments: _attachments, ...request } = launch.turnStartParams;
    return {
      launchId: launch.launchId,
      ownerClientId: launch.rendererClientId,
      projectId: launch.projectId,
      threadId: launch.threadId,
      request,
      state: {
        launch,
        authorityLaunch: null,
        protocolAccepted: false,
      } satisfies CodexFreshThreadFirstTurnTransactionState,
    };
  }

  private readFreshThreadFirstTurnTransaction(
    prepared: CodexPreparedFreshThreadFirstTurn,
  ): CodexFreshThreadFirstTurnTransactionState {
    const transaction = prepared.state as CodexFreshThreadFirstTurnTransactionState;
    if (
      prepared.threadId !== transaction.launch.threadId ||
      prepared.projectId !== transaction.launch.projectId ||
      prepared.launchId !== transaction.launch.launchId ||
      prepared.ownerClientId !== transaction.launch.rendererClientId
    ) {
      throw new Error("Fresh Thread first Turn identity changed");
    }
    return transaction;
  }

  async beginFreshThreadFirstTurnForModule(
    prepared: CodexPreparedFreshThreadFirstTurn,
  ): Promise<void> {
    const transaction = this.readFreshThreadFirstTurnTransaction(prepared);
    if (prepared.projectId) {
      const project = await this.projectWorkspace.getProject(prepared.projectId);
      if (project?.lifecycle !== "active") {
        throw new Error("Codex turns cannot be started for an inactive or removed project");
      }
    }
    transaction.authorityLaunch = await this.beginNodexAgentTurnAuthority(
      prepared.threadId,
      transaction.launch.verifiedBuiltinFullAccess,
    );
  }

  async commitFreshThreadFirstTurnForModule(
    prepared: CodexPreparedFreshThreadFirstTurn,
    response: TurnStartResponse,
  ): Promise<TurnStartResponse> {
    const transaction = this.readFreshThreadFirstTurnTransaction(prepared);
    const { launch } = transaction;
    const { threadId } = launch;
    if (!this.asTurnSummary(threadId, response.turn)) {
      throw new Error("Codex turn/start returned an invalid turn payload");
    }
    transaction.protocolAccepted = true;
    await this.nodexAgentAuthorityRegistry.bindTurn(transaction.authorityLaunch, response.turn.id);
    return response;
  }

  async finishFreshThreadFirstTurnForModule(
    prepared: CodexPreparedFreshThreadFirstTurn,
    response: TurnStartResponse,
  ): Promise<TurnStartResponse> {
    const transaction = this.readFreshThreadFirstTurnTransaction(prepared);
    const { launch } = transaction;
    const { threadId } = launch;
    await this.markAutomationRunAcceptedForUserContinuation(threadId).catch((error) => {
      this.logger.warn("Could not mark fresh thread continuation accepted", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await this.markThreadAsActive(threadId).catch((error) => {
      this.logger.warn("Could not project fresh thread active status", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await this.applyStartedSessionThreadGoal({
      threadId,
      objective: launch.goalObjective,
      rawDraft: launch.rawGoalDraft,
    }).catch((error) => {
      this.logger.warn("Started fresh thread but could not apply its goal", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    if (launch.runInTarget === "newWorktree" && launch.projectId !== null) {
      await this.createHeartbeatAutomationForStartedWorktreeThread({
        projectId: launch.projectId,
        sessionId: launch.sessionId,
        threadId,
        heartbeatAutomation: launch.heartbeatAutomation,
      }).catch((error) => {
        this.logger.warn("Started fresh thread but could not create its heartbeat", {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    this.logger.info("Started renderer-owned first Codex turn", {
      threadId,
      turnId: response.turn.id,
      durationMs: Date.now() - launch.startedAt,
    });
    this.emitThreadStartProgress({
      projectId: launch.projectId,
      sessionId: launch.sessionId,
      runInTarget: launch.runInTarget,
      threadId,
      phase: "ready",
      message: launch.runInTarget === "newWorktree" ? "Worktree ready." : "Message sent.",
      stream: launch.runInTarget === "newWorktree" ? "info" : undefined,
      outputDelta: launch.runInTarget === "newWorktree" ? "[info] Worktree ready.\n" : undefined,
    });
    return response;
  }

  rollbackFreshThreadFirstTurnForModule(prepared: CodexPreparedFreshThreadFirstTurn): void {
    const transaction = this.readFreshThreadFirstTurnTransaction(prepared);
    if (transaction.protocolAccepted) return;
    this.nodexAgentAuthorityRegistry.abortTurn(transaction.authorityLaunch);
    const { launch } = transaction;
    this.emitThreadStartProgress({
      projectId: launch.projectId,
      sessionId: launch.sessionId,
      runInTarget: launch.runInTarget,
      threadId: launch.threadId,
      phase: "failed",
      message: "Message could not be sent.",
      stream: "stderr",
    });
  }

  async forkConversationFromTurn(
    threadId: string,
    turnId: string,
    _message: string,
    options: { syncDormantConversationUpdates?: boolean } = {},
  ): Promise<CodexThreadActionResult> {
    await this.ensureClientReady();

    await this.conversationHistory.loadComplete(threadId, false);
    const currentDetail =
      this.serializeThreadDetail(threadId) ?? (await this.readThread(threadId, true));
    if (!currentDetail) {
      throw new Error(`Thread '${threadId}' was not found`);
    }

    const sourceTurn = currentDetail.turns.find((turn) => turn.turnId === turnId);
    if (!sourceTurn) {
      throw new Error(`Turn '${turnId}' was not found in thread '${threadId}'`);
    }

    const sourceTurnIndex = currentDetail.turns.findIndex((turn) => turn.turnId === turnId);
    const trailingTurnCount = currentDetail.turns.length - sourceTurnIndex - 1;

    const sourceTitle = this.resolveForkedFromConversationTitle(currentDetail);
    const forkThreadTitle = this.resolveUserFacingForkThreadTitle(currentDetail);

    const threadRef = this.parseThreadRef(threadId);
    if (!threadRef) {
      throw new Error(`Thread '${threadId}' is not linked to a project card`);
    }
    const forkWorkspaceRoots = threadRef.projectId
      ? ((await this.maybeResolveProjectRuntimeContext(threadRef.projectId))?.workspaceRoots ?? [])
      : [currentDetail.cwd].filter((cwd): cwd is string => cwd !== null);

    const shouldDeferThreadStarted = threadRef.projectId !== null;
    if (shouldDeferThreadStarted) {
      this.beginThreadStartNotificationDeferral();
    }
    let threadStartDeferralOpen = shouldDeferThreadStarted;
    let detail: CodexThreadDetail;
    let summary: CodexThreadSummary | null;
    try {
      const fork = await this.forkAndResumePersistentConversation({
        sourceThreadId: threadId,
        requestedCwd: currentDetail.cwd,
        workspaceRoots: forkWorkspaceRoots,
        syncDormantConversationSnapshot: options.syncDormantConversationUpdates !== false,
        threadSource: "user",
        materialize: (projectedThread, resolvedCwd) =>
          this.materializeThreadDetailFromThreadPayload(
            projectedThread,
            threadRef,
            resolvedCwd ?? currentDetail.cwd,
            { preserveExistingTimeline: true },
          ),
      });
      const forkedThreadId = fork.threadId;
      const resolvedCwd = fork.resolvedCwd;
      detail = fork.detail;
      summary = fork.summary;
      if (threadStartDeferralOpen) {
        await this.completeThreadStartNotificationDeferral(forkedThreadId);
        await this.endThreadStartNotificationDeferral();
        threadStartDeferralOpen = false;
      }
      if (trailingTurnCount > 0) {
        const rollbackResponse = await this.client.request<
          "thread/rollback",
          ThreadRollbackResponse
        >("thread/rollback", {
          threadId: forkedThreadId,
          numTurns: trailingTurnCount,
        });
        const rollbackMaterialized = await this.applyForkRollbackResponse({
          threadId: forkedThreadId,
          response: rollbackResponse,
          fallbackRef: threadRef,
          fallbackCwd: resolvedCwd ?? currentDetail.cwd,
        });
        detail = rollbackMaterialized.detail;
        summary = rollbackMaterialized.summary ?? summary;
      }
      this.appendForkedFromConversationMarker(forkedThreadId, threadId, sourceTitle);
      if (options.syncDormantConversationUpdates === false) {
        this.syncAcceptedConversationDocumentSilently(forkedThreadId);
      } else {
        this.syncDormantConversationFromRecord(forkedThreadId, "owner-unavailable");
      }
    } finally {
      if (threadStartDeferralOpen) {
        await this.endThreadStartNotificationDeferral();
      }
    }

    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
    }
    if (forkThreadTitle) {
      await this.threadTitlePersistence.set({
        threadId: detail.threadId,
        name: forkThreadTitle,
        normalization: "manual",
        syncDormantConversationUpdates: options.syncDormantConversationUpdates,
      });
    }
    await this.forkSidePanelTransferLifecycle?.stageDirect({
      sourceConversationId: threadId,
      targetConversationId: detail.threadId,
    });
    return {
      threadId: detail.threadId,
      composerIntent: this.buildComposerIntent(""),
    };
  }

  async prepareSideChatForModule(
    input: CodexSideChatStartInput,
    signal: AbortSignal,
  ): Promise<CodexPreparedSideChat> {
    signal.throwIfAborted();
    await this.ensureClientReady();

    const parentThreadId = input.parentThreadId.trim();
    if (!parentThreadId) {
      throw new Error("Side chat requires a parent thread");
    }

    const parentDetail =
      this.serializeThreadDetail(parentThreadId) ?? (await this.readThread(parentThreadId, false));
    signal.throwIfAborted();
    if (!parentDetail) {
      throw new Error(`Parent thread '${parentThreadId}' was not found`);
    }
    if (parentDetail.source?.sideConversation === true) {
      throw new Error("Side chats cannot be started from another side chat");
    }
    const parentWorkspace = await this.resolveSideChatParentWorkspace(parentThreadId, parentDetail);
    const { cwd } = parentWorkspace;
    const projectAwareDeveloperInstructions = await this.resolveProjectAwareDeveloperInstructions({
      cwd,
      model: input.model ?? parentDetail.latestCollaborationMode?.settings.model ?? null,
      threadId: parentThreadId,
    });
    signal.throwIfAborted();
    const developerInstructions = projectAwareDeveloperInstructions.trim()
      ? `${projectAwareDeveloperInstructions}\n\n${SIDE_CHAT_DEVELOPER_INSTRUCTIONS}`
      : SIDE_CHAT_DEVELOPER_INSTRUCTIONS;
    const executionProfile = parentDetail.executionProfile
      ? {
          ...parentDetail.executionProfile,
          modelId: input.model ?? parentDetail.executionProfile.modelId,
          reasoningEffort: input.reasoningEffort ?? parentDetail.executionProfile.reasoningEffort,
          serviceTier: input.serviceTier ?? parentDetail.executionProfile.serviceTier,
        }
      : null;
    const mcpConfig = await this.buildMcpCodexConfig(cwd);
    signal.throwIfAborted();
    const config = {
      ...(mcpConfig ?? {}),
      ...(executionProfile?.harnessId ? { harness: executionProfile.harnessId } : {}),
      ...(input.reasoningEffort || executionProfile?.reasoningEffort
        ? {
            model_reasoning_effort: input.reasoningEffort ?? executionProfile?.reasoningEffort,
          }
        : {}),
      ...buildCodexThreadConfigOverrides(),
    };
    const latestCollaborationMode = this.buildCollaborationModeState({
      collaborationMode: input.collaborationMode,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      fallback: parentDetail.latestCollaborationMode,
    });
    const startedAt = Date.now();

    this.logger.info("Starting Codex side chat", {
      parentThreadId,
      projectId: parentWorkspace.inheritance.projectId,
      cwd,
      model: input.model ?? null,
      serviceTier: formatServiceTierForReporting(input.serviceTier),
      permissionMode: input.permissionMode ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      collaborationMode: input.collaborationMode ?? null,
      hasInitialPrompt: Boolean(input.prompt?.trim() || input.promptInput),
    });

    const forkParams: ThreadForkParams = {
      threadId: parentThreadId,
      path: null,
      cwd,
      threadSource: "user",
      config,
      developerInstructions,
      ephemeral: true,
      excludeTurns: true,
      ...(input.model || executionProfile?.modelId
        ? { model: input.model ?? executionProfile?.modelId }
        : {}),
      ...(executionProfile
        ? {
            modelProvider: executionProfile.providerId,
            serviceTier: executionProfile.serviceTier,
          }
        : {}),
    };
    const promptInput = input.promptInput
      ? {
          ...input.promptInput,
          text: input.prompt?.trim() ?? input.promptInput.text,
        }
      : undefined;
    const hasInitialPrompt = Boolean(
      input.prompt?.trim() ||
      promptInput?.textAttachments?.some((attachment) =>
        "text" in attachment ? attachment.text.trim().length > 0 : true,
      ) ||
      promptInput?.images?.length ||
      promptInput?.mentions?.length ||
      promptInput?.skills?.length ||
      promptInput?.commentAttachments?.length,
    );
    return {
      parentThreadId,
      forkRequest: forkParams,
      initialTurn: hasInitialPrompt
        ? {
            prompt: input.prompt?.trim() ?? promptInput?.text ?? "",
            overrides: {
              promptInput,
              model: input.model,
              serviceTier: input.serviceTier,
              permissionMode: input.permissionMode,
              reasoningEffort: input.reasoningEffort,
              collaborationMode: input.collaborationMode,
            },
          }
        : null,
      state: {
        input,
        parentWorkspace,
        latestCollaborationMode,
        executionProfile,
        startedAt,
      } satisfies CodexSideChatPreparationState,
    };
  }

  private readSideChatPreparation(prepared: CodexPreparedSideChat): CodexSideChatPreparationState {
    const state = prepared.state as CodexSideChatPreparationState;
    if (prepared.parentThreadId !== state.input.parentThreadId.trim()) {
      throw new Error("Side chat parent identity changed");
    }
    return state;
  }

  async commitSideChatForkForModule(
    prepared: CodexPreparedSideChat,
    forkResult: ThreadForkResponse,
  ): Promise<CodexCommittedSideChat> {
    const state = this.readSideChatPreparation(prepared);
    const { input, parentWorkspace, latestCollaborationMode, executionProfile } = state;
    const forkedThreadId = forkResult.thread.id.trim();
    if (!forkedThreadId || forkedThreadId !== forkResult.thread.id) {
      throw new Error("Thread fork did not return a valid thread id");
    }

    const { cwd, workspaceRoots } = parentWorkspace;
    const resolvedCwd = resolveCodexCanonicalHydratedCwd({
      requestedCwd: cwd,
      responseCwd: forkResult.cwd,
      threadCwd: forkResult.thread.cwd,
      fallbackCwd: workspaceRoots[0] ?? cwd,
    });
    this.hydrateCanonicalConversationState(forkResult, {
      fallbackCwd: cwd,
      resolvedCwd,
      turns: [],
    });

    const detail = this.buildSideChatDetailFromForkPayload({
      parentThreadId: prepared.parentThreadId,
      ...parentWorkspace.inheritance,
      parentNavigationPath: input.parentNavigationPath?.trim() || null,
      forkResponse: forkResult,
      resolvedCwd,
      latestCollaborationMode,
      executionProfile,
    });
    this.setConversationRecordDetail(detail);
    this.setConversationResumeState(forkedThreadId, "resumed");
    this.ensureConversationRecord(forkedThreadId);
    this.conversationAggregate(forkedThreadId).setStreaming(true);
    this.setConversationStreamRole(forkedThreadId, "owner");
    this.syncDormantConversationFromRecord(forkedThreadId, "owner-unavailable");

    return {
      parentThreadId: prepared.parentThreadId,
      threadId: forkedThreadId,
      initialTurn: prepared.initialTurn,
      state: {
        ...state,
        threadId: forkedThreadId,
      } satisfies CodexSideChatCommittedState,
    };
  }

  async finishSideChatForModule(
    committed: CodexCommittedSideChat,
  ): Promise<CodexSideChatStartResult> {
    const state = committed.state as CodexSideChatCommittedState;
    if (state.threadId !== committed.threadId) {
      throw new Error("Committed side chat identity changed");
    }
    const conversation = this.serializeConversationSnapshot(committed.threadId);
    if (!conversation) {
      throw new Error(`Side chat '${committed.threadId}' was created but could not be loaded`);
    }

    this.logger.info("Codex side chat is ready", {
      parentThreadId: committed.parentThreadId,
      threadId: committed.threadId,
      durationMs: Date.now() - state.startedAt,
    });
    return {
      parentThreadId: committed.parentThreadId,
      threadId: committed.threadId,
      conversation,
    };
  }

  inspectSideChatForModule(threadId: string): { parentThreadId: string } | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    const record = this.getMaybeConversationRecord(normalizedThreadId);
    const source = record?.detail?.source;
    if (source?.sideConversation !== true || !source.parentThreadId) return null;
    return { parentThreadId: source.parentThreadId };
  }

  discardSideChatProjectionForModule(threadId: string): void {
    this.forgetThreadLocalState(threadId.trim());
  }

  rollbackSideChatProjectionForModule(threadId: string): void {
    this.forgetThreadLocalState(threadId.trim());
  }

  /** Effect Module adapter operation; callers use threadTitlePersistence instead. */
  async persistThreadTitleInProjectWorkspace(threadId: string, name: string): Promise<void> {
    const summary = await this.updateWorkspaceThreadSummary(threadId, {
      threadName: name,
    });
    if (summary) {
      this.emitEvent({ type: "threadSummary", thread: summary });
    }
    await this.emitSidebarCatalogChangedForThread(threadId, "host-message");
  }

  private async deleteHeartbeatAutomationForArchivedThread(threadId: string): Promise<void> {
    const automationId = this.automationModule.peekActiveHeartbeatAutomationId(threadId);
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
      await this.managedWorktreeLifecycle.setOwner({
        hostId,
        worktreeGitRoot,
        ownerThreadId: replacement.threadId,
      });
      return;
    }

    const comparisonKey = await resolveWorktreePathComparisonKey(worktreeGitRoot);
    const permanentRoots = await Promise.all(
      lifecycle.projects
        .flatMap((project) => project.sourceRoots)
        .map(resolveWorktreePathComparisonKey),
    );
    if (hostId === CODEX_APP_LOCAL_HOST_ID && permanentRoots.includes(comparisonKey)) return;
    if (this.managedWorktreeLifecycle.isNewborn(hostId, worktreeGitRoot)) return;

    await this.managedWorktreeLifecycle.remove({
      hostId,
      worktreeGitRoot,
      reason,
    });
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
    this.requestManagedWorktreeRetention();
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

  /** Effect Module adapter operation; the runtime owns ordering, remote I/O, and fallback policy. */
  async prepareThreadSettingsUpdate(
    input: CodexThreadSettingsUpdateCommand,
    signal: AbortSignal,
  ): Promise<CodexPreparedThreadSettingsUpdate> {
    signal.throwIfAborted();
    const executionProfile = input.patch.executionProfile
      ? await this.validateAndPersistThreadExecutionProfile(
          input.threadId,
          input.patch.executionProfile,
          input.patch.executionProfileChange,
        )
      : null;
    signal.throwIfAborted();
    const validatedPatch = executionProfile ? { ...input.patch, executionProfile } : input.patch;
    const nextSettings = this.mergeThreadSettingsPatch(input.threadId, validatedPatch);
    this.applyLatestThreadSettingsForThread(input.threadId, nextSettings);
    if (input.syncDormantConversationUpdates ?? true) {
      this.syncAcceptedConversationDocument(input.threadId, {
        syncLatestCollaborationMode: true,
        syncLatestThreadSettings: true,
      });
    }
    const params = await this.buildThreadSettingsUpdateParams(
      input.threadId,
      validatedPatch,
      nextSettings,
    );
    signal.throwIfAborted();
    return { nextSettings, params };
  }

  private async ensureReasoningSummaryForGoalContinuation(threadId: string): Promise<void> {
    const record = this.getConversationRecord(threadId);
    const summary = resolveCodexReasoningSummary({
      configuredSummary: record.latestThreadSettings?.summary,
    });
    if (record.latestThreadSettings?.summary === summary) return;

    await this.threadSettingsRuntime.update({ threadId, patch: { summary } });
  }

  private hasPendingThreadGoalSteering(threadId: string, record: CodexConversationRecord): boolean {
    if (this.listPendingSteers(threadId).length > 0) return true;
    return hasPendingSteeringTranscriptEntry(record.detail?.transcript ?? []);
  }

  private hasInProgressThreadGoalWork(threadId: string, record: CodexConversationRecord): boolean {
    if (record.detail?.statusType === "active") return true;
    if ((record.detail?.statusActiveFlags.length ?? 0) > 0) return true;
    if (this.listKnownTurns(threadId).some((turn) => turn.status === "inProgress")) return true;
    return hasRunningCollabAgentTranscriptEntry(record.detail?.transcript ?? []);
  }

  private canContinueActiveThreadGoal(threadId: string): boolean {
    const record = this.getMaybeConversationRecord(threadId);
    if (!record) return false;
    if (this.resolveConversationResumeState(threadId) !== "resumed") return false;
    if (record.threadGoal?.status !== "active") return false;
    if (this.readConversationServerRequests(record).length > 0) return false;
    if (this.hasPendingThreadGoalSteering(threadId, record)) return false;
    if (this.readConversationStreamRole(threadId) !== "owner") return false;
    if (!this.conversationAggregate(threadId).isStreaming()) return false;
    if (this.hasInProgressThreadGoalWork(threadId, record)) return false;
    return true;
  }

  private async continueActiveThreadGoalWithEmptyTurn(threadId: string): Promise<void> {
    const record = this.getMaybeConversationRecord(threadId);
    const detail = record?.detail ?? this.serializeThreadDetail(threadId);
    const params: TurnStartParams = {
      threadId,
      input: [],
      ...(detail?.cwd ? { cwd: detail.cwd } : {}),
      summary: resolveCodexReasoningSummary({
        configuredSummary: record?.latestThreadSettings?.summary,
      }),
    };
    const projectId = this.parseThreadRef(threadId)?.projectId ?? null;
    const permissionDecision = await this.resolvePermissionStateForRequest(
      projectId,
      undefined,
      detail?.cwd ? [detail.cwd] : [],
    );
    const authorityLaunch = await this.beginNodexAgentTurnAuthority(
      threadId,
      permissionDecision.verifiedBuiltinFullAccess,
    );
    try {
      const response = await this.client.request<"turn/start", TurnStartResponse>(
        "turn/start",
        params,
      );
      await this.nodexAgentAuthorityRegistry.bindTurn(authorityLaunch, response.turn.id);
    } catch (error) {
      this.nodexAgentAuthorityRegistry.abortTurn(authorityLaunch);
      throw error;
    }
  }

  isActiveThreadGoalContinuationCandidate(threadId: string): boolean {
    return this.canContinueActiveThreadGoal(threadId);
  }

  async runActiveThreadGoalContinuation(threadId: string): Promise<void> {
    if (!this.canContinueActiveThreadGoal(threadId)) return;

    await this.threadSettingsRuntime.awaitCurrent(threadId);
    if (!this.canContinueActiveThreadGoal(threadId)) return;

    await this.ensureReasoningSummaryForGoalContinuation(threadId);
    if (this.threadSettingsRuntime.remoteUpdateSupport() === "unsupported") {
      await this.continueActiveThreadGoalWithEmptyTurn(threadId);
      return;
    }

    await this.threadGoals.set({ threadId, status: "active" });
  }

  private maybeContinueActiveThreadGoal(threadId: string): void {
    if (!this.canContinueActiveThreadGoal(threadId)) return;
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

  /** Prepares the isolated state consumed by one admitted Turn transaction. */
  async prepareTurnStartForModule(input: {
    readonly threadId: string;
    readonly prompt: string;
    readonly overrides?: StartTurnOverrides;
    readonly rendererOwnsState: boolean;
    readonly syncDormantConversationUpdates: boolean;
    readonly signal: AbortSignal;
  }): Promise<CodexPreparedTurnStart> {
    input.signal.throwIfAborted();
    await this.ensureClientReady();
    await this.ensureAgentRuntimeCredentialReloaded();
    await this.threadSettingsRuntime.awaitCurrent(input.threadId);
    input.signal.throwIfAborted();

    const preparedPrompt = input.overrides?.preparedPrompt
      ? await this.usePreparedPromptForTurn(input.overrides.preparedPrompt)
      : await this.preparePromptForTurn(input.prompt, input.overrides?.promptInput);
    input.signal.throwIfAborted();
    const promptText = preparedPrompt.promptText;
    const record = this.getConversationRecord(input.threadId);
    const latestThreadSettings = record.latestThreadSettings;
    const fallbackCollaborationMode =
      latestThreadSettings?.collaborationMode ?? record.latestCollaborationMode;
    const effectiveModel =
      normalizeThreadSettingsModel(preparedPrompt.agentConfigOverrides.model) ??
      normalizeThreadSettingsModel(input.overrides?.model) ??
      normalizeThreadSettingsModel(latestThreadSettings?.model) ??
      normalizeThreadSettingsModel(fallbackCollaborationMode.settings.model);
    const effectiveReasoningEffort =
      preparedPrompt.agentConfigOverrides.reasoningEffort ??
      input.overrides?.reasoningEffort ??
      latestThreadSettings?.reasoningEffort ??
      fallbackCollaborationMode.settings.reasoning_effort;
    const hasExplicitServiceTier = Boolean(
      input.overrides && hasOwnValue(input.overrides, "serviceTier"),
    );
    const effectiveServiceTier = hasExplicitServiceTier
      ? normalizeCodexServiceTier(input.overrides?.serviceTier)
      : normalizeCodexServiceTier(latestThreadSettings?.serviceTier);
    const effectiveCollaborationMode =
      preparedPrompt.agentConfigOverrides.collaborationMode ??
      input.overrides?.collaborationMode ??
      latestThreadSettings?.collaborationMode?.mode ??
      fallbackCollaborationMode.mode;
    const explicitReasoningSummary =
      input.overrides && hasOwnValue(input.overrides, "summary")
        ? parseCodexReasoningSummary(input.overrides.summary)
        : undefined;
    const reasoningSummary = resolveCodexReasoningSummary({
      configuredSummary: latestThreadSettings?.summary,
      explicitSummary: explicitReasoningSummary,
    });

    const threadRef = this.parseThreadRef(input.threadId);
    const threadCwd = threadRef?.cwd?.trim() || null;
    const projectRunContext =
      !threadCwd && threadRef?.projectId
        ? await this.maybeResolveProjectRuntimeContext(threadRef.projectId)
        : null;
    const fallbackWorkspacePath =
      !threadCwd && !projectRunContext?.primaryWorkspaceRoot && threadRef?.projectId
        ? await this.parseWorkspacePath(threadRef.projectId)
        : null;
    const workspacePath =
      threadCwd || projectRunContext?.primaryWorkspaceRoot || fallbackWorkspacePath || null;
    const workspaceRoots = threadCwd
      ? [threadCwd]
      : (projectRunContext?.workspaceRoots ??
        (fallbackWorkspacePath ? [fallbackWorkspacePath] : []));
    const permissionDecision = await this.resolvePermissionStateForRequest(
      threadRef?.projectId ?? null,
      input.overrides?.permissionMode,
      workspaceRoots,
    );
    input.signal.throwIfAborted();
    const permissionState = permissionDecision.state;
    const turnPermissionOverrides = buildTurnPermissionOverrides({
      permissionState,
      workspaceRoots,
    });
    this.applyThreadPermissionState(input.threadId, permissionState);
    const collaborationMode = await this.buildCollaborationModePayload({
      collaborationMode: effectiveCollaborationMode,
      model: effectiveModel ?? undefined,
      reasoningEffort: effectiveReasoningEffort,
    });
    this.applyLatestThreadSettingsForThread(
      input.threadId,
      this.buildConversationThreadSettings({
        model: effectiveModel,
        modelProvider: threadRef?.executionProfile?.providerId,
        serviceTier: effectiveServiceTier,
        reasoningEffort: effectiveReasoningEffort ?? null,
        summary: reasoningSummary,
        collaborationMode: effectiveCollaborationMode,
        fallback: latestThreadSettings,
        fallbackCollaborationMode,
      }),
    );

    let transaction!: CodexTurnStartTransactionState;
    const buildRequest = (): TurnStartParams => ({
      threadId: input.threadId,
      clientUserMessageId: transaction.clientUserMessageId,
      ...(transaction.workspacePath ? { cwd: transaction.workspacePath } : {}),
      ...(preparedPrompt.additionalContext
        ? { additionalContext: preparedPrompt.additionalContext }
        : {}),
      ...transaction.turnPermissionOverrides,
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(effectiveServiceTier ? { serviceTier: effectiveServiceTier } : {}),
      ...(effectiveReasoningEffort ? { effort: effectiveReasoningEffort } : {}),
      summary: reasoningSummary,
      ...(collaborationMode ? { collaborationMode } : {}),
      ...(input.overrides?.responsesapiClientMetadata
        ? { responsesapiClientMetadata: input.overrides.responsesapiClientMetadata }
        : {}),
      input: preparedPrompt.inputItems,
    });
    transaction = {
      threadId: input.threadId,
      projectId: threadRef?.projectId ?? null,
      rendererOwnsState: input.rendererOwnsState,
      syncDormantConversationUpdates: input.syncDormantConversationUpdates,
      record,
      promptText,
      permissionDecision,
      permissionMode: permissionState.mode,
      effectiveModel,
      effectiveServiceTier,
      effectiveReasoningEffort,
      effectiveCollaborationMode,
      reasoningSummary,
      collaborationMode,
      clientUserMessageId: input.overrides?.clientUserMessageId ?? randomUUID(),
      canonicalParams: null,
      startedAt: Date.now(),
      workspacePath,
      workspaceRoots,
      turnPermissionOverrides,
      authorityLaunch: undefined,
      optimisticStartedAt: null,
      protocolCommitted: false,
      buildRequest,
    };

    const canonicalState = this.readCanonicalConversationState(record.threadId);
    const hydration = canonicalState?.sidecar.hydrationContext;
    const canonicalPermissionContext = hydration
      ? this.resolveCanonicalResumePermissionContext(
          permissionState,
          workspaceRoots,
          hydration.currentPermissions,
        )
      : null;
    transaction.canonicalParams =
      canonicalState && hydration && canonicalPermissionContext
        ? ({
            ...buildRequest(),
            cwd: workspacePath,
            approvalPolicy: canonicalPermissionContext.approvalPolicy,
            approvalsReviewer: canonicalPermissionContext.approvalsReviewer,
            sandboxPolicy: canonicalPermissionContext.sandboxPolicy,
            permissions: canonicalPermissionContext.activePermissionProfile?.id ?? null,
            runtimeWorkspaceRoots: canonicalPermissionContext.activePermissionProfile
              ? [...canonicalPermissionContext.runtimeWorkspaceRoots]
              : null,
            useAppServerPermissionDefault: permissionState.effectivePreset === "custom",
            model: collaborationMode ? null : effectiveModel,
            serviceTier: hasExplicitServiceTier
              ? effectiveServiceTier
              : latestThreadSettings?.serviceTier !== undefined
                ? effectiveServiceTier
                : (hydration.latestThreadSettings?.serviceTier ?? null),
            effort: collaborationMode ? null : (effectiveReasoningEffort ?? null),
            multiAgentMode: hydration.latestThreadSettings?.multiAgentMode ?? "explicitRequestOnly",
            summary: reasoningSummary,
            personality: latestThreadSettings?.personality ?? this.preferences.current(),
            outputSchema: null,
            collaborationMode,
            attachments: dedupeCodexLiveFileAttachments([
              ...preparedPrompt.fileAttachments,
              ...preparedPrompt.addedFiles,
            ]),
            commentAttachments: [...preparedPrompt.commentAttachments],
          } satisfies CodexCanonicalLiveTurnParams<
            CodexLiveFileAttachment,
            CodexReviewDiffCommentAttachment
          >)
        : null;

    return {
      threadId: input.threadId,
      projectId: transaction.projectId,
      request: buildRequest() as unknown as CodexPreparedTurnStart["request"],
      rendererOwnsState: input.rendererOwnsState,
      state: transaction,
    };
  }

  private readTurnStartTransaction(
    prepared: CodexPreparedTurnStart,
  ): CodexTurnStartTransactionState {
    const transaction = prepared.state as CodexTurnStartTransactionState;
    if (transaction.threadId !== prepared.threadId) {
      throw new Error("Turn start transaction identity changed");
    }
    return transaction;
  }

  async beginTurnStartForModule(prepared: CodexPreparedTurnStart): Promise<void> {
    const transaction = this.readTurnStartTransaction(prepared);
    if (transaction.projectId) {
      const project = await this.projectWorkspace.getProject(transaction.projectId);
      if (project?.lifecycle !== "active") {
        throw new Error("Codex turns cannot be started for an inactive or removed project");
      }
    }
    transaction.authorityLaunch = await this.beginNodexAgentTurnAuthority(
      transaction.threadId,
      transaction.permissionDecision.verifiedBuiltinFullAccess,
    );
    this.logger.info("Starting Codex turn", {
      threadId: transaction.threadId,
      projectId: transaction.projectId,
      cwd: transaction.workspacePath,
      permissionMode: transaction.permissionMode,
      model: transaction.effectiveModel ?? null,
      serviceTier: formatServiceTierForReporting(transaction.effectiveServiceTier),
      reasoningEffort: transaction.effectiveReasoningEffort ?? null,
      reasoningSummary: transaction.reasoningSummary,
      collaborationMode: transaction.effectiveCollaborationMode ?? null,
      promptLength: transaction.promptText.length,
      promptPreview: previewText(transaction.promptText),
    });
    if (!transaction.canonicalParams || transaction.rendererOwnsState) return;

    const beforeAppend = this.readCanonicalConversationState(transaction.threadId);
    if (!beforeAppend) {
      throw new Error("Cannot start a canonical turn before conversation hydration");
    }
    const optimisticStartedAt = Date.now();
    transaction.optimisticStartedAt = optimisticStartedAt;
    const afterAppend = appendCodexCanonicalOptimisticTurn(beforeAppend, {
      params: transaction.canonicalParams,
      currentCollaborationModel: transaction.record.latestCollaborationMode.settings.model,
      startedAtMs: optimisticStartedAt,
    });
    this.commitCanonicalLocalTurnMutation({
      threadId: transaction.threadId,
      before: beforeAppend,
      after: afterAppend,
      observedAtMs: optimisticStartedAt,
    });
    this.conversationAggregate(transaction.threadId).setStreaming(true);
    await this.markThreadAsActive(transaction.threadId);
    this.syncDormantConversationFromRecord(transaction.threadId, "owner-unavailable");
  }

  async recoverTurnStartForModule(
    prepared: CodexPreparedTurnStart,
    signal: AbortSignal,
  ): Promise<CodexPreparedTurnStart["request"]> {
    const transaction = this.readTurnStartTransaction(prepared);
    signal.throwIfAborted();
    this.logger.warn("Codex turn start hit missing thread; attempting resume", {
      threadId: transaction.threadId,
    });
    const recoveredDetail = await this.resumeThreadWithSeed(transaction.threadId, undefined, true);
    if (!recoveredDetail) {
      throw new Error(
        `Thread '${transaction.threadId}' could not be resumed after turn/start failed`,
      );
    }
    signal.throwIfAborted();
    transaction.workspacePath = recoveredDetail.cwd;
    transaction.workspaceRoots = [
      ...(transaction.workspacePath ? [transaction.workspacePath] : []),
      ...transaction.workspaceRoots,
    ].filter((root, index, roots) => roots.indexOf(root) === index);
    transaction.turnPermissionOverrides = buildTurnPermissionOverrides({
      permissionState: transaction.permissionDecision.state,
      workspaceRoots: transaction.workspaceRoots,
    });
    return transaction.buildRequest() as unknown as CodexPreparedTurnStart["request"];
  }

  async commitTurnStartForModule(
    prepared: CodexPreparedTurnStart,
    response: TurnStartResponse,
  ): Promise<CodexTurnSummary | TurnStartResponse | null> {
    const transaction = this.readTurnStartTransaction(prepared);
    const usedCanonicalTransaction =
      !transaction.rendererOwnsState && transaction.canonicalParams !== null;
    if (usedCanonicalTransaction) {
      if (!this.asTurnSummary(transaction.threadId, response.turn)) {
        throw new Error("Codex turn/start returned an invalid turn payload");
      }
      await this.nodexAgentAuthorityRegistry.bindTurn(
        transaction.authorityLaunch ?? null,
        response.turn.id,
      );
      const beforeBind = this.readCanonicalConversationState(transaction.threadId);
      if (!beforeBind || !transaction.canonicalParams) {
        throw new Error("Canonical conversation state disappeared during turn/start");
      }
      const stateWithPendingTurn = beforeBind.turns.some(
        (turn) => turn.sidecar.params.clientUserMessageId === transaction.clientUserMessageId,
      )
        ? beforeBind
        : appendCodexCanonicalOptimisticTurn(beforeBind, {
            params: transaction.canonicalParams,
            currentCollaborationModel: transaction.record.latestCollaborationMode.settings.model,
            startedAtMs: transaction.optimisticStartedAt ?? Date.now(),
          });
      const afterBind = bindCodexCanonicalOptimisticTurn(
        stateWithPendingTurn,
        transaction.clientUserMessageId,
        response.turn,
      );
      if (!afterBind.turns.some((turn) => turn.protocol.id === response.turn.id)) {
        throw new Error("Codex turn/start could not bind its canonical optimistic turn");
      }
      this.commitCanonicalLocalTurnMutation({
        threadId: transaction.threadId,
        before: beforeBind,
        after: afterBind,
        observedAtMs: Date.now(),
      });
    } else {
      await this.nodexAgentAuthorityRegistry.bindTurn(
        transaction.authorityLaunch ?? null,
        response.turn.id,
      );
    }
    transaction.protocolCommitted = true;

    await this.markAutomationRunAcceptedForUserContinuation(transaction.threadId);
    if (transaction.rendererOwnsState) {
      await this.markThreadAsActive(transaction.threadId);
      return response;
    }

    const startedTurn = this.asTurnSummary(transaction.threadId, response.turn);
    if (startedTurn) {
      const observedTurn: CodexTurnSummary & { turnId: string } = {
        ...startedTurn,
        turnStartedAtMs: startedTurn.turnStartedAtMs ?? Date.now(),
      };
      this.clearPausedQueuedFollowUps(transaction.threadId, false);
      if (!usedCanonicalTransaction) {
        this.mergeTurn(transaction.threadId, observedTurn);
        await this.markThreadAsActive(transaction.threadId);
      }
      if (transaction.syncDormantConversationUpdates) {
        this.syncDormantConversationFromRecord(transaction.threadId, "owner-unavailable");
      }
      this.logger.info("Started Codex turn", {
        threadId: transaction.threadId,
        turnId: observedTurn.turnId,
        durationMs: Date.now() - transaction.startedAt,
      });
      return this.getKnownTurn(transaction.threadId, observedTurn.turnId) ?? observedTurn;
    }

    await this.markThreadAsActive(transaction.threadId);
    this.clearPausedQueuedFollowUps(transaction.threadId, false);
    if (transaction.syncDormantConversationUpdates) {
      this.syncDormantConversationFromRecord(transaction.threadId, "owner-unavailable");
    }
    const detail = this.serializeThreadDetail(transaction.threadId);
    if (!detail || detail.turns.length === 0) return null;
    this.logger.info("Started Codex turn from canonical conversation state", {
      threadId: transaction.threadId,
      durationMs: Date.now() - transaction.startedAt,
    });
    return detail.turns[detail.turns.length - 1];
  }

  rollbackTurnStartForModule(prepared: CodexPreparedTurnStart): void {
    const transaction = this.readTurnStartTransaction(prepared);
    if (transaction.protocolCommitted) return;
    this.nodexAgentAuthorityRegistry.abortTurn(transaction.authorityLaunch ?? null);
    if (!transaction.canonicalParams || transaction.rendererOwnsState) return;
    const beforeFailure = this.readCanonicalConversationState(transaction.threadId);
    if (!beforeFailure) return;
    const afterFailure = failCodexCanonicalOptimisticTurn(
      beforeFailure,
      transaction.clientUserMessageId,
      randomUUID(),
    );
    this.commitCanonicalLocalTurnMutation({
      threadId: transaction.threadId,
      before: beforeFailure,
      after: afterFailure,
      observedAtMs: Date.now(),
    });
    this.syncDormantConversationFromRecord(transaction.threadId, "owner-unavailable");
  }

  async startTurn(
    threadId: string,
    prompt: string,
    overrides: StartTurnOverrides | undefined,
    options: RendererOwnedStartTurnOptions,
  ): Promise<TurnStartResponse>;
  async startTurn(
    threadId: string,
    prompt: string,
    overrides?: StartTurnOverrides,
    options?: MainOwnedStartTurnOptions,
  ): Promise<CodexTurnSummary | null>;
  async startTurn(
    threadId: string,
    prompt: string,
    overrides?: StartTurnOverrides,
    options: MainOwnedStartTurnOptions | RendererOwnedStartTurnOptions = {},
  ): Promise<CodexTurnSummary | TurnStartResponse | null> {
    return options.stateOwner === "renderer"
      ? await this.turnCommands.startRendererOwned(threadId, prompt, overrides)
      : await this.turnCommands.start(threadId, prompt, overrides, {
          syncDormantConversationUpdates: options.syncDormantConversationUpdates,
        });
  }

  async prepareTurnSteerForModule(input: {
    readonly command: CodexSteerTurnInput;
    readonly steerId: string;
    readonly syncDormantConversationUpdates: boolean;
    readonly signal: AbortSignal;
  }): Promise<CodexPreparedTurnSteer> {
    input.signal.throwIfAborted();
    await this.ensureClientReady();
    const command = input.command;
    const threadId = command.threadId;
    const preparedPrompt = await this.preparePromptForTurn(command.prompt, command.promptInput);
    input.signal.throwIfAborted();
    if (
      preparedPrompt.agentConfigOverrides.collaborationMode ||
      preparedPrompt.agentConfigOverrides.model ||
      preparedPrompt.agentConfigOverrides.reasoningEffort
    ) {
      throw new Error(
        "Agent config cannot be steered into a running turn. Wait for the turn to finish or queue a follow-up.",
      );
    }
    const promptText = preparedPrompt.promptText.trim();
    if (!promptText) {
      throw new Error("Turn steer requires a non-empty prompt");
    }
    const activeTurn = command.expectedTurnId
      ? this.getKnownTurn(threadId, command.expectedTurnId)
      : ([...this.listKnownTurns(threadId)]
          .reverse()
          .find((turn) => turn.status === "inProgress") ?? null);
    const expectedTurnId = command.expectedTurnId ?? activeTurn?.turnId ?? null;
    if (!expectedTurnId) {
      throw new Error(
        "Nodex is already running. Wait for the active turn to load or queue the follow-up instead.",
      );
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
      clientUserMessageId: input.steerId,
      input: preparedPrompt.inputItems,
      ...(preparedPrompt.additionalContext
        ? { additionalContext: preparedPrompt.additionalContext }
        : {}),
    };
    const restoreMessage: CodexSteeringRestoreMessage = {
      prompt: command.prompt,
      ...(command.promptInput ? { promptInput: command.promptInput } : {}),
      collaborationMode: command.collaborationMode ?? null,
      serviceTier: normalizeCodexServiceTier(command.serviceTier),
      ...(command.summary !== undefined ? { summary: command.summary } : {}),
    };
    const canonicalBefore = this.readCanonicalConversationState(threadId);
    if (!canonicalBefore) {
      throw new Error(`Cannot steer '${threadId}' before canonical conversation state is loaded`);
    }
    const canonicalSteer = this.buildCanonicalSteeringUserMessageItem({
      turnId: expectedTurnId,
      steerId: input.steerId,
      clientUserMessageId: input.steerId,
      inputItems: preparedPrompt.inputItems,
      attachments: dedupeCodexLiveFileAttachments([
        ...preparedPrompt.fileAttachments,
        ...preparedPrompt.addedFiles,
      ]),
      commentAttachments: preparedPrompt.commentAttachments,
      restoreMessage,
      targetTurnStartedAtMs: activeTurn?.turnStartedAtMs ?? activeTurn?.startedAt ?? null,
    });
    const canonicalAfter = upsertCodexCanonicalSteeringItem(
      canonicalBefore,
      expectedTurnId,
      canonicalSteer,
    );
    if (canonicalAfter === canonicalBefore) {
      throw new Error(`Cannot steer missing canonical turn '${expectedTurnId}'`);
    }

    return {
      threadId,
      request: steerParams,
      fallbackStart: {
        prompt: command.prompt,
        overrides: {
          collaborationMode: command.collaborationMode ?? undefined,
          serviceTier: command.serviceTier,
          summary: command.summary,
          ...(command.promptInput ? { promptInput: command.promptInput } : {}),
        },
        syncDormantConversationUpdates: input.syncDormantConversationUpdates,
      },
      state: {
        threadId,
        expectedTurnId,
        steerId: input.steerId,
        syncDormantConversationUpdates: input.syncDormantConversationUpdates,
        canonicalSteer,
        optimisticAdmitted: false,
      } satisfies CodexTurnSteerTransactionState,
    };
  }

  private readTurnSteerTransaction(
    prepared: CodexPreparedTurnSteer,
  ): CodexTurnSteerTransactionState {
    const transaction = prepared.state as CodexTurnSteerTransactionState;
    if (transaction.threadId !== prepared.threadId) {
      throw new Error("Turn steer transaction identity changed");
    }
    return transaction;
  }

  beginTurnSteerForModule(prepared: CodexPreparedTurnSteer): void {
    const transaction = this.readTurnSteerTransaction(prepared);
    const record = this.getMaybeConversationRecord(transaction.threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) {
      throw new Error(
        `Cannot steer '${transaction.threadId}' before canonical conversation state is loaded`,
      );
    }
    const after = upsertCodexCanonicalSteeringItem(
      before,
      transaction.expectedTurnId,
      transaction.canonicalSteer,
    );
    if (after === before) {
      throw new Error(`Cannot steer missing canonical turn '${transaction.expectedTurnId}'`);
    }
    transaction.optimisticAdmitted = true;
    this.applyCanonicalTurnMutation({
      threadId: transaction.threadId,
      turnId: transaction.expectedTurnId,
      before,
      after,
    });
    if (!transaction.syncDormantConversationUpdates) return;
    this.syncAcceptedConversationTurnState(transaction.threadId, transaction.expectedTurnId, {
      syncBackgroundTerminalRows: true,
      syncCapabilityFlags: true,
    });
  }

  async commitTurnSteerForModule(
    prepared: CodexPreparedTurnSteer,
    response: TurnSteerResponse,
  ): Promise<{ turnId: string } | null> {
    const transaction = this.readTurnSteerTransaction(prepared);
    if (typeof response.turnId !== "string") {
      this.rollbackTurnSteerForModule(prepared);
      this.logger.warn("Codex turn steer returned no turn id", {
        threadId: transaction.threadId,
        expectedTurnId: transaction.expectedTurnId,
      });
      return null;
    }
    this.clearPausedQueuedFollowUps(transaction.threadId);
    this.logger.info("Steered Codex turn", {
      threadId: transaction.threadId,
      expectedTurnId: transaction.expectedTurnId,
      turnId: response.turnId,
    });
    return { turnId: response.turnId };
  }

  rollbackTurnSteerForModule(prepared: CodexPreparedTurnSteer): void {
    const transaction = this.readTurnSteerTransaction(prepared);
    if (!transaction.optimisticAdmitted) return;
    transaction.optimisticAdmitted = false;
    const record = this.getMaybeConversationRecord(transaction.threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (record && before) {
      const after = removeCodexCanonicalSteeringItem(
        before,
        transaction.expectedTurnId,
        transaction.steerId,
      );
      if (after !== before) {
        this.applyCanonicalTurnMutation({
          threadId: transaction.threadId,
          turnId: transaction.expectedTurnId,
          before,
          after,
        });
      }
    }
    if (!transaction.syncDormantConversationUpdates) return;
    this.syncAcceptedConversationTurnState(transaction.threadId, transaction.expectedTurnId, {
      syncBackgroundTerminalRows: true,
      syncCapabilityFlags: true,
    });
  }

  async steerTurn(
    input: CodexSteerTurnInput,
    options: DormantConversationSyncOptions = {},
  ): Promise<{ turnId: string } | null> {
    return await this.turnCommands.steer(input, options);
  }

  async prepareTurnInterruptForModule(threadId: string, turnId?: string): Promise<string> {
    const resolvedTurnId = await this.resolveInterruptTurnId(threadId, turnId);
    if (!resolvedTurnId) {
      throw new Error("Could not determine which turn to interrupt");
    }
    await this.pauseActiveThreadGoalBeforeInterrupt(threadId);
    return resolvedTurnId;
  }

  async applyTurnInterruptForModule(input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly syncDormantConversationUpdates: boolean;
  }): Promise<boolean> {
    const knownTurn = this.getKnownTurn(input.threadId, input.turnId);
    if (!knownTurn || knownTurn.status !== "inProgress") {
      return true;
    }

    const interruptedTurn: CodexTurnSummary = {
      ...knownTurn,
      status: "interrupted",
      interruptedCommandExecutionItemIds: [
        ...(knownTurn.interruptedCommandExecutionItemIds ?? []),
        ...this.listRecordedInterruptedCommandExecutionItemIds(input.threadId, input.turnId),
      ],
    };
    this.mergeTurn(input.threadId, interruptedTurn);
    await this.syncThreadStatusFromKnownTurns(input.threadId);
    this.reconcileTurnItemsToTerminalStatus(input.threadId, input.turnId, "interrupted");
    this.emitEvent({ type: "turn", turn: interruptedTurn });
    if (input.syncDormantConversationUpdates) {
      this.syncDormantConversationFromRecord(input.threadId, "owner-unavailable");
    }
    this.maybeDispatchQueuedFollowUp(input.threadId);
    return true;
  }

  readBackgroundTerminalTurnIdsForModule(threadId: string): readonly string[] | null {
    const conversation = this.serializeConversationSnapshot(threadId);
    if (!conversation) return null;
    return [
      ...new Set(this.collectBackgroundTerminalRows(conversation).map(({ turnId }) => turnId)),
    ];
  }

  applyBackgroundTerminalsCleanedForModule(threadId: string): void {
    this.markBackgroundTerminalsInterruptedSilently(threadId);
  }

  /** Temporary read-only projection while the conversation replica remains in this class. */
  readBackgroundProcessProjectionForModule(
    threadId: string,
  ): CodexBackgroundProcessConversationProjection {
    const detail = this.getMaybeConversationRecord(threadId)?.detail;
    return {
      threadTitle: detail?.threadName?.trim() || detail?.threadPreview?.trim() || null,
      terminalItems:
        detail?.transcript.flatMap((item) =>
          item.kind === "commandExecution"
            ? [
                {
                  itemId: item.itemId,
                  processId:
                    item.processId === null || item.processId === undefined
                      ? null
                      : String(item.processId),
                  turnId: item.turnId,
                  createdAt: item.createdAt,
                },
              ]
            : [],
        ) ?? [],
    };
  }

  private markBackgroundTerminalsInterruptedSilently(threadId: string): void {
    const record = this.getMaybeConversationRecord(threadId);
    const before = record ? this.readCanonicalConversationState(record.threadId) : null;
    if (!record || !before) return;
    const after = reduceCodexBackgroundTerminalCleanup(before);
    if (after === before) return;
    this.acceptCanonicalConversationState(threadId, after);
    after.turns.forEach((turn, turnIndex) => {
      if (turn === before.turns[turnIndex]) return;
      this.applyCanonicalLifecycleTurnProjection({
        threadId,
        turnIndex,
        beforeTurn: before.turns[turnIndex] ?? null,
        afterTurn: turn,
        observedAtMs: Date.now(),
        preserveExistingUpdatedAt: true,
      });
    });
    this.syncAcceptedConversationDocumentSilently(threadId);
  }

  private clearPendingServerRequestsAfterDisconnect(): void {
    for (const { threadId, requestId } of this.pendingServerRequests.disconnectIdentities()) {
      this.resolvePendingServerRequest(threadId, requestId);
    }
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

  private buildDynamicToolSuccess(value: unknown): DynamicToolCallResponse {
    return buildCodexAppDynamicToolSuccess(value);
  }

  private buildDynamicToolTextSuccess(text: string): DynamicToolCallResponse {
    return {
      contentItems: [{ type: "inputText", text }],
      success: true,
    };
  }

  private buildDynamicToolFailure(message: string): DynamicToolCallResponse {
    return buildCodexAppDynamicToolFailure(message);
  }

  private buildAutomationUpdateToolResponse(
    result?: AutomationUpdateToolResult,
  ): DynamicToolCallResponse {
    const text =
      result == null
        ? "Rendered automation card in the app."
        : result.mode === "create"
          ? "Created automation in the app."
          : result.mode === "update"
            ? "Updated automation in the app."
            : result.deleteStatus === "not_found"
              ? "Automation already does not exist in the app."
              : "Deleted automation in the app.";

    return {
      contentItems: [
        { type: "inputText", text },
        ...(result == null ? [] : [{ type: "inputText" as const, text: JSON.stringify(result) }]),
      ],
      success: true,
    };
  }

  private clampDynamicInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  private truncateDynamicOutput(value: string, maxChars: number): string {
    if (maxChars <= 0) return "";
    if (value.length <= maxChars) return value;
    return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
  }

  private parseDynamicString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseDynamicReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
    if (value === "low" || value === "medium" || value === "high" || value === "xhigh")
      return value;
    return undefined;
  }

  private parseAutomationUpdateMode(value: unknown): AutomationUpdateMode | null {
    if (
      value === "view" ||
      value === "list" ||
      value === "create" ||
      value === "suggested_create" ||
      value === "update" ||
      value === "suggested_update" ||
      value === "delete"
    ) {
      return value;
    }
    return null;
  }

  private parseAutomationUpdateStatus(value: unknown): CodexScheduledAutomationStatus | null {
    if (value === "ACTIVE" || value === "PAUSED") return value;
    return null;
  }

  private parseAutomationExecutionEnvironment(
    value: unknown,
  ): CodexScheduledAutomationExecutionEnvironment | null {
    if (value === "local" || value === "worktree") return value;
    return null;
  }

  private parseAutomationDestination(value: unknown): AutomationUpdateDestination | undefined {
    if (value === undefined) return undefined;
    if (value === "local" || value === "worktree" || value === "thread") return value;
    throw new Error("destination is invalid");
  }

  private parseAutomationReasoningEffort(
    value: unknown,
  ): CodexScheduledAutomationReasoningEffort | null {
    if (
      value === "none" ||
      value === "minimal" ||
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh" ||
      value === "max"
    ) {
      return value;
    }
    return null;
  }

  private parseAutomationCwds(value: unknown): string[] | null {
    const normalizeItems = (items: unknown[]): string[] =>
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

    if (Array.isArray(value)) {
      return normalizeItems(value);
    }

    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return Array.isArray(parsed) ? normalizeItems(parsed) : null;
      } catch {
        return null;
      }
    }

    return normalizeItems(trimmed.split(","));
  }

  private parseAutomationLocalEnvironmentConfigPath(
    args: Record<string, unknown>,
  ): string | null | undefined {
    if (!Object.prototype.hasOwnProperty.call(args, "localEnvironmentConfigPath")) return undefined;
    const value = args.localEnvironmentConfigPath;
    if (value === null) return null;
    const normalized = this.parseDynamicString(value);
    if (normalized) return normalized;
    throw new Error("localEnvironmentConfigPath is invalid");
  }

  private parseAutomationUpdateArgs(args: Record<string, unknown>): ParsedAutomationUpdateArgs {
    const mode = this.parseAutomationUpdateMode(args.mode);
    if (!mode) throw new Error("mode is invalid");

    if (mode === "list") {
      return {
        mode,
        query: this.parseDynamicString(args.query),
        limit: this.clampDynamicInt(args.limit, 20, 1, 100),
      };
    }

    if (mode === "view" || mode === "delete") {
      const id = this.parseDynamicString(args.id);
      if (!id) throw new Error("id is required");
      return { mode, id };
    }

    const kind = args.kind;
    if (kind !== "cron" && kind !== "heartbeat") throw new Error("kind is invalid");

    const name = this.parseDynamicString(args.name);
    const prompt = this.parseDynamicString(args.prompt);
    const rrule = this.parseDynamicString(args.rrule);
    const status = this.parseAutomationUpdateStatus(args.status);
    if (!name) throw new Error("name is required");
    if (!prompt) throw new Error("prompt is required");
    if (!rrule) throw new Error("rrule is required");
    if (!status) throw new Error("status is invalid");

    const destination = this.parseAutomationDestination(args.destination);
    const id =
      mode === "update" || mode === "suggested_update"
        ? this.parseDynamicString(args.id)
        : undefined;
    if ((mode === "update" || mode === "suggested_update") && !id) {
      throw new Error("id is required");
    }

    if (kind === "heartbeat") {
      const targetThreadId = this.parseDynamicString(args.targetThreadId) ?? undefined;
      if (!targetThreadId && destination !== "thread") {
        throw new Error("Missing targetThreadId or destination=thread");
      }
      return {
        mode,
        id: id ?? undefined,
        kind,
        name,
        prompt,
        rrule,
        status,
        destination,
        targetThreadId,
      };
    }

    const cwds = this.parseAutomationCwds(args.cwds);
    const executionEnvironment = this.parseAutomationExecutionEnvironment(
      args.executionEnvironment,
    );
    const model = this.parseDynamicString(args.model);
    const reasoningEffort = this.parseAutomationReasoningEffort(args.reasoningEffort);
    const localEnvironmentConfigPath = this.parseAutomationLocalEnvironmentConfigPath(args);
    if (cwds === null) throw new Error("cwds is invalid");
    if (!executionEnvironment) throw new Error("executionEnvironment is invalid");
    if (!model) throw new Error("model is required");
    if (!reasoningEffort) throw new Error("reasoningEffort is invalid");

    return {
      mode,
      id: id ?? undefined,
      kind,
      name,
      prompt,
      rrule,
      status,
      cwds,
      destination,
      executionEnvironment,
      localEnvironmentConfigPath,
      model,
      reasoningEffort,
    };
  }

  private automationUpdateArgsUseUnsafeImmediateSetup(args: ParsedAutomationUpdateArgs): boolean {
    if (args.mode !== "create" && args.mode !== "update") return false;
    if (args.kind !== "cron" || args.executionEnvironment !== "worktree") return false;
    if (args.mode === "create") return args.localEnvironmentConfigPath != null;
    return (
      args.localEnvironmentConfigPath === undefined || args.localEnvironmentConfigPath !== null
    );
  }

  private async assertAutomationUpdateHeartbeatTargetIsLocalThread(
    args: ParsedAutomationUpdateArgs,
    currentThreadId: string,
  ): Promise<void> {
    if (args.mode !== "create" && args.mode !== "update") return;
    if (args.kind !== "heartbeat") return;

    const targetThreadId = (args.targetThreadId ?? currentThreadId).trim();
    if (!targetThreadId) {
      throw new Error("Automations are only supported for local threads.");
    }

    if (targetThreadId === currentThreadId) return;
    if (await this.readWorkspaceThread(targetThreadId)) return;
    if (this.serializeThreadDetail(targetThreadId)) return;

    throw new Error("Automations are only supported for local threads.");
  }

  private buildAutomationCreateInput(
    args: ParsedAutomationUpdateUpsertArgs,
    currentThreadId: string,
  ): CodexScheduledAutomationCreateInput {
    if (args.kind === "heartbeat") {
      return {
        kind: "heartbeat",
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        targetThreadId: args.targetThreadId ?? currentThreadId,
        model: null,
        reasoningEffort: null,
      };
    }

    return {
      kind: "cron",
      name: args.name,
      prompt: args.prompt,
      rrule: args.rrule,
      cwds: args.cwds ?? [],
      executionEnvironment: args.executionEnvironment ?? "worktree",
      localEnvironmentConfigPath: args.localEnvironmentConfigPath ?? null,
      model: args.model ?? null,
      reasoningEffort: args.reasoningEffort ?? null,
    };
  }

  private buildAutomationUpdateInput(
    args: ParsedAutomationUpdateUpsertArgs & { id: string },
    currentThreadId: string,
  ): CodexScheduledAutomationUpdateInput {
    if (args.kind === "heartbeat") {
      return {
        id: args.id,
        kind: "heartbeat",
        status: args.status,
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        targetThreadId: args.targetThreadId ?? currentThreadId,
        model: null,
        reasoningEffort: null,
      };
    }

    return {
      id: args.id,
      kind: "cron",
      status: args.status,
      name: args.name,
      prompt: args.prompt,
      rrule: args.rrule,
      cwds: args.cwds ?? [],
      executionEnvironment: args.executionEnvironment ?? "worktree",
      ...(args.localEnvironmentConfigPath === undefined
        ? {}
        : { localEnvironmentConfigPath: args.localEnvironmentConfigPath }),
      model: args.model ?? null,
      reasoningEffort: args.reasoningEffort ?? null,
    };
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

  private buildAutomationDeleteFailureMessage(
    status: CodexScheduledAutomationDeleteStatus,
  ): string {
    switch (status) {
      case "invalid_id":
        return "Automation id was invalid.";
      case "store_unavailable":
        return "Automation storage is unavailable.";
      case "state_cleanup_failed":
        return "Automation scheduling state could not be updated.";
      case "remove_failed":
        return "Automation still exists after the app tried to delete it.";
      case "deleted":
      case "not_found":
        return "Automation was not deleted.";
    }
  }

  private buildAutomationUpdateErrorMessage(error: unknown, mode: AutomationUpdateMode): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "That thread already has an active heartbeat.") {
      return "This thread already has an active heartbeat automation. Only one automation can be attached to this thread. Either update the existing automation, or confirm with the user what they would like you to do. Don't make a workaround cron automation unless the user explicitly asked for that.";
    }
    if (
      message ===
      "Automation does not exist in the app and could not be updated. It may have been deleted manually by the user."
    ) {
      return message;
    }
    if (message) return message;
    return `Failed to ${mode} automation.`;
  }

  private async handleAutomationUpdateDynamicToolCall(
    params: DynamicToolCallParams,
    args: Record<string, unknown>,
  ): Promise<DynamicToolCallResponse> {
    let parsed: ParsedAutomationUpdateArgs;
    try {
      parsed = this.parseAutomationUpdateArgs(args);
    } catch (error) {
      return this.buildDynamicToolFailure(
        `${AUTOMATION_UPDATE_TOOL_NAME} received invalid arguments: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }

    if (this.automationUpdateArgsUseUnsafeImmediateSetup(parsed)) {
      return this.buildDynamicToolFailure(
        "For safety, automations created by the model cannot immediately run a worktree local environment setup script. Use suggested_create or suggested_update so the user can review and approve the setup-capable automation, or set localEnvironmentConfigPath to null.",
      );
    }

    try {
      await this.assertAutomationUpdateHeartbeatTargetIsLocalThread(parsed, params.threadId);

      if (parsed.mode === "list") {
        const query = parsed.query?.toLowerCase() ?? "";
        const definitions = (await this.automationModule.listDefinitions())
          .filter((automation) => {
            if (!query) return true;
            return [automation.id, automation.name, automation.prompt]
              .join(" ")
              .toLowerCase()
              .includes(query);
          })
          .slice(0, parsed.limit)
          .map((automation) => ({
            id: automation.id,
            kind: automation.kind,
            status: automation.status,
            name: automation.name,
            prompt: automation.prompt,
            rrule: automation.rrule,
            targetThreadId: automation.targetThreadId,
            nextRunAt: automation.nextRunAt,
          }));
        return this.buildDynamicToolSuccess({
          query: parsed.query,
          automations: definitions,
        });
      }

      if (
        parsed.mode === "view" ||
        parsed.mode === "suggested_create" ||
        parsed.mode === "suggested_update"
      ) {
        return this.buildAutomationUpdateToolResponse();
      }

      if (parsed.mode === "create") {
        const automation = await this.automationModule.createDefinition(
          this.buildAutomationCreateInput(parsed, params.threadId),
        );
        this.emitScheduledAutomationChanged({
          automationId: automation.id,
          targetThreadId: automation.targetThreadId,
          reason: "upsert",
        });
        return this.buildAutomationUpdateToolResponse({
          automationId: automation.id,
          mode: "create",
        });
      }

      if (parsed.mode === "update") {
        if (!parsed.id) throw new Error("id is required");
        const current = await this.automationModule.getDefinition(parsed.id);
        if (!current) {
          throw new Error(
            "Automation does not exist in the app and could not be updated. It may have been deleted manually by the user.",
          );
        }
        const updateInput = await this.prepareScheduledAutomationInput(
          this.buildAutomationUpdateInput({ ...parsed, id: parsed.id }, params.threadId),
          current,
        );
        const automation = await this.automationModule.updateDefinition(updateInput);
        if (!automation) {
          throw new Error(
            "Automation does not exist in the app and could not be updated. It may have been deleted manually by the user.",
          );
        }
        this.emitScheduledAutomationChanged({
          automationId: automation.id,
          targetThreadId: automation.targetThreadId,
          reason: "upsert",
        });
        return this.buildAutomationUpdateToolResponse({
          automationId: automation.id,
          mode: "update",
        });
      }

      if (parsed.mode === "delete") {
        const automationId = parsed.id;
        const result = await this.automationModule.deleteDefinition(automationId);
        if (!result.success) {
          return this.buildDynamicToolFailure(
            this.buildAutomationDeleteFailureMessage(result.status),
          );
        }
        const existing = result.item;
        if (result.deletedRunCount > 0) {
          this.notifyAutomationRunsUpdated({
            automationId: existing?.id ?? automationId,
            threadId: null,
            reason: "delete",
          });
        }
        this.emitScheduledAutomationChanged({
          automationId: existing?.id ?? automationId,
          targetThreadId: existing?.targetThreadId ?? null,
          reason: "delete",
        });
        return this.buildAutomationUpdateToolResponse({
          automationId,
          mode: "delete",
          deleteStatus: result.status === "not_found" ? "not_found" : "deleted",
          snapshot:
            existing == null
              ? null
              : {
                  kind: existing.kind,
                  name: existing.name,
                  rrule: existing.rrule,
                },
        });
      }

      return this.buildAutomationUpdateToolResponse();
    } catch (error) {
      return this.buildDynamicToolFailure(
        this.buildAutomationUpdateErrorMessage(error, parsed.mode),
      );
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

  private listDynamicThreadSummaries(): CodexThreadSummary[] {
    const byId = new Map<string, CodexThreadSummary>();
    for (const summary of this.listThreadLinksSafely()) {
      byId.set(summary.threadId, summary);
    }
    for (const threadId of this.conversationRecords.keys()) {
      const detail = this.serializeThreadDetail(threadId);
      if (!detail) continue;
      byId.set(detail.threadId, {
        threadId: detail.threadId,
        projectId: detail.projectId,
        source: detail.source,
        ephemeral: detail.ephemeral,
        threadSource: detail.threadSource ?? null,
        threadName: detail.threadName,
        threadPreview: detail.threadPreview,
        modelProvider: detail.modelProvider,
        executionProfile: detail.executionProfile,
        cwd: detail.cwd,
        approvalPolicy: detail.approvalPolicy,
        approvalsReviewer: detail.approvalsReviewer,
        sandbox: detail.sandbox,
        statusType: detail.statusType,
        statusActiveFlags: detail.statusActiveFlags,
        archived: detail.archived,
        pinned: detail.pinned,
        hasUnreadTurn: detail.hasUnreadTurn,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        linkedAt: detail.linkedAt,
      });
    }
    return Array.from(byId.values()).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private serializeDynamicThreadItem(
    item: CodexTranscriptEntry,
    includeOutputs: boolean,
    maxOutputCharsPerItem: number,
  ): Record<string, unknown> {
    if (item.semanticKind === "userMessage" || item.kind === "userMessage") {
      return {
        type: "userMessage",
        id: item.itemId,
        text: item.markdownText ?? "",
      };
    }

    if (item.semanticKind === "assistantMessage" || item.kind === "assistantMessage") {
      return {
        type: "agentMessage",
        id: item.itemId,
        text: item.markdownText ?? "",
        phase: item.assistantPhase ?? null,
      };
    }

    if (item.semanticKind === "reasoning") {
      return {
        type: "reasoning",
        id: item.itemId,
        summary: item.markdownText ?? "",
        ...(includeOutputs
          ? { content: this.truncateDynamicOutput(item.markdownText ?? "", maxOutputCharsPerItem) }
          : {}),
      };
    }

    if (item.kind === "commandExecution") {
      return {
        type: "commandExecution",
        id: item.itemId,
        command: item.command ?? null,
        cwd: item.cwd ?? null,
        status: item.status ?? null,
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
        ...(includeOutputs && item.aggregatedOutput != null
          ? { output: this.truncateDynamicOutput(item.aggregatedOutput, maxOutputCharsPerItem) }
          : {}),
      };
    }

    if (item.kind === "fileChange") {
      return {
        type: "fileChange",
        id: item.itemId,
        status: item.status ?? null,
        changes: getCodexFileChangeList(item.fileChange?.changes).map((change) => {
          const diff =
            change.type === "update"
              ? change.unifiedDiff
              : change.type === "nonRenderable"
                ? ""
                : change.content;
          return {
            path: change.path,
            kind: change.type === "nonRenderable" ? change.originalType : change.type,
            ...(includeOutputs
              ? {
                  diff: this.truncateDynamicOutput(diff, maxOutputCharsPerItem),
                }
              : {}),
          };
        }),
      };
    }

    if (item.semanticKind === "mcpToolCall" && item.mcpToolCall) {
      return {
        type: "mcpToolCall",
        id: item.itemId,
        server: item.mcpToolCall.invocation.server,
        tool: item.mcpToolCall.invocation.tool,
        arguments: item.mcpToolCall.invocation.arguments,
        status: item.status ?? null,
        durationMs: item.mcpToolCall.durationMs,
      };
    }

    if (item.semanticKind === "dynamicToolCall" && item.dynamicToolCall) {
      return {
        type: "dynamicToolCall",
        id: item.itemId,
        tool: item.dynamicToolCall.tool,
        arguments: item.dynamicToolCall.arguments,
        status: item.dynamicToolCall.status,
        success: item.dynamicToolCall.success,
        durationMs: item.dynamicToolCall.durationMs,
        text: item.markdownText ?? null,
      };
    }

    return {
      type: item.semanticKind ?? item.kind,
      id: item.itemId,
      status: item.status ?? null,
      text: item.markdownText ?? null,
    };
  }

  private async buildDynamicReadThreadResponse(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
    if (!threadId) throw new Error("read_thread requires threadId");

    const detail = await this.resolveDynamicThreadDetail(threadId);
    const executionHostId =
      (await this.readWorkspaceThread(threadId))?.executionHostId ?? CODEX_APP_LOCAL_HOST_ID;

    const cursor =
      typeof args.cursor === "string" && args.cursor.trim() ? args.cursor.trim() : null;
    const turnLimit = this.clampDynamicInt(
      args.turnLimit,
      CODEX_APP_READ_THREAD_DEFAULT_TURN_LIMIT,
      1,
      CODEX_APP_READ_THREAD_MAX_TURN_LIMIT,
    );
    const includeOutputs = args.includeOutputs === true;
    const maxOutputCharsPerItem = this.clampDynamicInt(
      args.maxOutputCharsPerItem,
      CODEX_APP_READ_THREAD_DEFAULT_MAX_OUTPUT_CHARS,
      0,
      CODEX_APP_READ_THREAD_MAX_OUTPUT_CHARS,
    );
    const cursorIndex =
      cursor === null
        ? detail.turns.length
        : detail.turns.findIndex((turn) => turn.turnId === cursor);
    if (cursorIndex < 0) throw new Error(`Unknown cursor for thread ${threadId}: ${cursor}`);

    const precedingTurns = detail.turns.slice(0, cursorIndex);
    const pageTurns = precedingTurns
      .filter((turn): turn is CodexTurnSummary & { turnId: string } => turn.turnId !== null)
      .slice(-turnLimit)
      .reverse();
    const pageTurnIds = new Set(pageTurns.map((turn) => turn.turnId));
    const entriesByTurn = detail.transcript.reduce<Map<string, CodexTranscriptEntry[]>>(
      (acc, entry) => {
        if (entry.turnId === null) return acc;
        if (!pageTurnIds.has(entry.turnId)) return acc;
        const entries = acc.get(entry.turnId) ?? [];
        entries.push(entry);
        acc.set(entry.turnId, entries);
        return acc;
      },
      new Map(),
    );

    return {
      schemaVersion: 1,
      thread: {
        id: detail.threadId,
        hostId: executionHostId,
        title: detail.threadName,
        preview: detail.threadPreview,
        status: {
          type: detail.statusType,
          ...(detail.statusActiveFlags.length > 0 ? { activeFlags: detail.statusActiveFlags } : {}),
        },
        cwd: detail.cwd,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      },
      page: {
        order: "newest_first",
        limit: turnLimit,
        nextCursor:
          precedingTurns.length > pageTurns.length ? (pageTurns.at(-1)?.turnId ?? null) : null,
        hasMore: precedingTurns.length > pageTurns.length,
      },
      turns: pageTurns.map((turn) => ({
        id: turn.turnId,
        status: turn.status,
        error: turn.errorMessage ? { message: turn.errorMessage, additionalDetails: null } : null,
        startedAt: turn.startedAt ?? turn.turnStartedAtMs ?? null,
        firstTurnWorkItemStartedAtMs: turn.firstTurnWorkItemStartedAtMs ?? null,
        completedAt: turn.completedAt ?? null,
        durationMs: turn.durationMs ?? null,
        items: (entriesByTurn.get(turn.turnId) ?? []).map((entry) =>
          this.serializeDynamicThreadItem(entry, includeOutputs, maxOutputCharsPerItem),
        ),
      })),
    };
  }

  private async buildDynamicReadThreadTerminalResponse(threadId: string): Promise<string> {
    const snapshot = await this.terminalRuntime.getThreadSnapshot(threadId);
    if (!snapshot) {
      return "No app terminal session is attached to this thread yet.";
    }

    const lines = [
      `cwd: ${snapshot.cwd ?? "(unknown)"}`,
      `shell: ${snapshot.shell ?? "(unknown)"}`,
    ];
    if (snapshot.truncated) {
      lines.push(`[showing latest ${snapshot.buffer.length.toLocaleString()} characters]`);
    }
    lines.push("```terminal", snapshot.buffer, "```");
    return lines.join("\n");
  }

  private async resolveDynamicCreatePermissions(
    sourceThreadId: string,
    target: CodexResolvedDynamicThreadTarget,
    destinationSnapshot?: CodexDynamicCreateDestinationSnapshot,
    hostMode: CodexDynamicCreatePermissionMode = "auto",
  ): Promise<CodexDynamicCreatePermissionSelection> {
    const sourceRecord = this.getMaybeConversationRecord(sourceThreadId);
    const sourceHydration = sourceRecord
      ? (this.readCanonicalConversationState(sourceRecord.threadId)?.sidecar.hydrationContext ??
        null)
      : null;
    const sourceContext = sourceHydration?.currentPermissions ?? null;
    const sourceMode = sourceContext ? inferCodexDynamicCreatePermissionMode(sourceContext) : null;
    const source: CodexDynamicCreatePermissionSource | null =
      sourceContext && sourceMode
        ? {
            hostId: CODEX_APP_LOCAL_HOST_ID,
            cwd:
              sourceHydration?.cwd ??
              sourceRecord?.detail?.cwd ??
              this.getThreadLinkSafely(sourceThreadId)?.cwd ??
              null,
            mode: sourceMode,
            context: sourceContext,
          }
        : null;
    const snapshot =
      destinationSnapshot ?? (await this.readDynamicCreateDestinationSnapshot(target));
    const destinationContext = buildCodexDynamicCreatePermissionContextForMode({
      mode: hostMode,
      workspaceRoots: target.workspaceRoots,
      config: snapshot.rawConfig,
    });

    return resolveCodexDynamicCreatePermissionSelection({
      source,
      destination: {
        hostId: CODEX_APP_LOCAL_HOST_ID,
        cwd: target.cwd,
        defaultMode: hostMode,
        defaultContext: destinationContext,
        workspaceRoots: target.workspaceRoots,
      },
    });
  }

  private async readDynamicCreateDestinationSnapshot(
    target: CodexResolvedDynamicThreadTarget,
  ): Promise<CodexDynamicCreateDestinationSnapshot> {
    await this.ensureClientReady();
    const configResult = await this.client.request<"config/read", ConfigReadResponse>(
      "config/read",
      {
        includeLayers: false,
        cwd: target.cwd,
      } satisfies ConfigReadParams,
    );
    return {
      rawConfig: configResult.config,
      expandedConfig: expandCodexDynamicCreateConfigProfile(configResult.config),
    };
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

  private buildDynamicPendingStartConversationParams(input: {
    readonly destinationSnapshot: CodexDynamicCreateDestinationSnapshot;
    readonly modelProjection: CodexDynamicCreateModelProjection;
    readonly permissionSelection: CodexDynamicCreatePermissionSelection;
    readonly prompt: string;
    readonly projectId: string;
    readonly serviceName?: string;
    readonly serviceTier: string | null;
    readonly sourceThreadId: string;
    readonly targetCwd: string;
    readonly targetWorkspaceRoots: readonly string[];
  }): CodexPendingStartConversationParamsInput {
    return buildCodexPendingStartConversationParams({
      input: buildCodexDelegationInput({
        sourceThreadId: input.sourceThreadId,
        input: input.prompt,
      }),
      commentAttachments: [],
      sourceWorkspaceRoot: input.targetCwd,
      sourceWorkspaceRoots: input.targetWorkspaceRoots,
      fileAttachments: [],
      addedFiles: [],
      agentMode: input.permissionSelection.mode,
      permissionProfileId: input.permissionSelection.sourcePermissionProfileId,
      shouldSendPermissionOverrides: true,
      model: null,
      executionProfile: null,
      serviceTier: input.serviceTier,
      reasoningEffort: null,
      collaborationMode: input.modelProjection.collaborationMode,
      config: {
        ...input.destinationSnapshot.expandedConfig,
      } as CodexPendingStartConversationParamsInput["config"],
      ...(input.modelProjection.configOverrides === null
        ? {}
        : { configOverrides: input.modelProjection.configOverrides }),
      threadSource: "subagent",
      workspaceKind: "project",
      projectAssignment: {
        projectKind: "local",
        projectId: input.projectId,
        pendingCoreUpdate: false,
      },
      serviceName: input.serviceName,
    });
  }

  private enqueueDynamicPendingWorktree(input: {
    readonly createInput: CodexDynamicCreateThreadInput;
    readonly destinationSnapshot: CodexDynamicCreateDestinationSnapshot;
    readonly modelProjection: CodexDynamicCreateModelProjection;
    readonly permissionSelection: CodexDynamicCreatePermissionSelection;
    readonly serviceTier: string | null;
    readonly serviceName?: string;
    readonly sourceThreadId: string;
    readonly startingState: CodexPendingWorktreeStartingState;
    readonly target: Extract<CodexResolvedDynamicThreadTarget, { launchMode: "worktree" }>;
  }): { readonly clientThreadId: string } {
    const startConversationParamsInput = this.buildDynamicPendingStartConversationParams({
      destinationSnapshot: input.destinationSnapshot,
      modelProjection: input.modelProjection,
      permissionSelection: input.permissionSelection,
      prompt: input.createInput.prompt,
      projectId: input.target.projectId,
      ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
      serviceTier: input.serviceTier,
      sourceThreadId: input.sourceThreadId,
      targetCwd: input.target.cwd,
      targetWorkspaceRoots: input.target.workspaceRoots,
    });

    const created = this.createPendingWorktree({
      hostId: CODEX_APP_LOCAL_HOST_ID,
      label: summarizeCodexPendingWorktreeLabel(input.createInput.prompt),
      initialThreadTitle: undefined,
      sourceWorkspaceRoot: input.target.cwd,
      startingState: input.startingState,
      localEnvironmentConfigPath: null,
      launchMode: "start-conversation",
      prompt: input.createInput.prompt,
      startConversationParamsInput,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    });
    if (!created.clientThreadId) {
      throw new Error("Pending conversation did not allocate a client thread id");
    }
    return { clientThreadId: created.clientThreadId };
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
    const workerResult = await this.worktreeWorkerForHost(entry.hostId, "create")
      .create(
        {
          requestId: `${entry.id}:${String(entry.attempt)}`,
          hostId: entry.hostId,
          repositoryPath: entry.sourceWorkspaceRoot,
          nodexHome: getNodexHome(),
          managedRoot: this.executionHosts.requireManagedRoot(entry.hostId),
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
        {
          signal: context.signal,
          onEvent: (event) => {
            if (event.type === "path-allocated") {
              allocatedWorktreeGitRoot = event.worktreeGitRoot;
              this.managedWorktreeLifecycle.registerNewborn(entry.hostId, event.worktreeGitRoot);
            }
            context.onEvent(event);
          },
        },
      )
      .catch((error) => {
        if (allocatedWorktreeGitRoot) {
          this.managedWorktreeLifecycle.releaseNewborn(entry.hostId, allocatedWorktreeGitRoot);
        }
        throw error;
      });
    const result = {
      worktreeGitRoot: workerResult.worktreeGitRoot,
      worktreeWorkspaceRoot: workerResult.worktreeWorkspaceRoot,
    };
    const throwCanceledAfterCreate = async (cause?: unknown): Promise<never> => {
      await this.managedWorktreeLifecycle
        .remove({
          hostId: entry.hostId,
          worktreeGitRoot: workerResult.worktreeGitRoot,
          reason: "cancel",
        })
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
      await this.conversationHistory.loadComplete(entry.sourceConversationId, false);
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
        await this.managedWorktreeLifecycle.setOwner({
          hostId: entry.hostId,
          worktreeGitRoot: entry.worktreeGitRoot,
          ownerThreadId: threadId,
        });
      } catch (error) {
        this.logger.warn("Worktree conversation started without owner metadata", {
          pendingWorktreeId: entry.id,
          threadId,
          error,
        });
      } finally {
        this.managedWorktreeLifecycle.releaseNewborn(entry.hostId, entry.worktreeGitRoot);
        this.requestManagedWorktreeRetention();
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
    const shouldDeferThreadStarted = input.target.projectId !== null;
    if (shouldDeferThreadStarted) this.beginThreadStartNotificationDeferral();

    let threadStart: ThreadStartResponse;
    let detail: CodexThreadDetail;
    let effectiveCwd = input.target.cwd;
    let projectedThread: Thread | null = null;
    let responsePermissionContext: CodexDynamicCreatePermissionContext | null = null;
    try {
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
      await this.persistDynamicToolCatalogsForLaunch(
        detail.threadId,
        threadStartParams.dynamicTools,
      );
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
      if (shouldDeferThreadStarted) {
        // The deferred notification runs the generic sidebar materializer. A
        // caller-provided Session must already own the Thread before replay,
        // otherwise that fallback creates a second Session and wins the Core
        // uniqueness race.
        await this.completeThreadStartNotificationDeferral(detail.threadId);
      }
    } finally {
      if (shouldDeferThreadStarted) await this.endThreadStartNotificationDeferral();
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
    const latestCollaborationMode = this.buildCollaborationModeState({
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

    return await executeNodexAgentDynamicToolCall(params, {
      service: this.nodexAgentDynamicService,
      toolsetRevision,
      authority,
      access,
      ...(taskResourceAccess ? { resourceAccess: taskResourceAccess } : {}),
      ...(authority
        ? {
            recordTaskResourceAccess: (grants) => broker.extendTaskAccess(authority, grants),
          }
        : {}),
      resolveResourceAccess: async (intents: readonly NodexAgentResourceIntent[]) => {
        if (!authority) {
          return {
            kind: "denied" as const,
            intent: intents[0] ?? {
              target: { kind: "library", libraryId: "unavailable" },
              action: "read",
            },
            reason: "project_not_found" as const,
          };
        }
        const currentTaskAccess = await broker.getTaskAccess(authority);
        return await this.nodexAgentResourceAuthority.plan({
          authority,
          callId: params.callId,
          intents,
          ...(currentTaskAccess ? { taskAccess: currentTaskAccess } : {}),
        });
      },
      authorize: async (authorization) => {
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
      },
    });
  }

  private async handleDynamicToolCall(
    params: DynamicToolCallParams,
    context: CodexDynamicToolExecutionContext = {},
    frozenNodexAuthority?: FrozenNodexAgentTurnAuthority | null,
  ): Promise<DynamicToolCallResponse> {
    const args = asRecord(params.arguments) ?? {};

    try {
      if (params.namespace === NODEX_APP_TOOL_NAMESPACE) {
        return await this.handleNodexAgentDynamicToolCall(params, frozenNodexAuthority);
      }
      if (!isCodexAppDynamicTool(params)) {
        const namespace = params.namespace ?? "<none>";
        return this.buildDynamicToolFailure(`Unsupported dynamic tool namespace: ${namespace}`);
      }

      if (params.tool === "setup_codex_step") {
        const isValidStep =
          Object.keys(args).length === 1 &&
          (args.step === "role" ||
            args.step === "task" ||
            args.step === "context" ||
            args.step === "complete");
        if (!isValidStep) {
          return this.buildDynamicToolFailure("setup_codex_step received invalid arguments.");
        }
        if (args.step !== "complete") {
          return this.buildDynamicToolFailure(
            "setup_codex_step interactive steps must be handled by the app.",
          );
        }
        return this.buildDynamicToolSuccess({ completed: true });
      }

      if (params.tool === AUTOMATION_UPDATE_TOOL_NAME) {
        return await this.handleAutomationUpdateDynamicToolCall(params, args);
      }

      if (params.tool === "read_thread_terminal") {
        return this.buildDynamicToolTextSuccess(
          await this.buildDynamicReadThreadTerminalResponse(params.threadId),
        );
      }

      if (params.tool === "list_projects") {
        if (Object.keys(args).length > 0)
          throw new Error("list_projects received invalid arguments.");
        const projects = (await this.projectWorkspace.listProjects()).map((project) => ({
          projectId: project.id,
          projectKind: "local",
          label: project.name,
          ...(project.primaryWorkspaceRoot ? { path: project.primaryWorkspaceRoot } : {}),
          hostId: CODEX_APP_LOCAL_HOST_ID,
          hostDisplayName: CODEX_APP_LOCAL_HOST_DISPLAY_NAME,
        }));
        return this.buildDynamicToolSuccess({ schemaVersion: 1, projects });
      }

      if (params.tool === "list_threads") {
        const limit = this.clampDynamicInt(args.limit, 10, 1, 50);
        const rawQuery = typeof args.query === "string" ? args.query.trim() : "";
        const query = rawQuery.toLowerCase();
        const threads = this.listDynamicThreadSummaries()
          .filter((thread) => {
            if (!query) return true;
            return [
              thread.threadId,
              thread.threadName ?? "",
              thread.threadPreview,
              thread.cwd ?? "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(query);
          })
          .slice(0, limit)
          .map((thread) => ({
            id: thread.threadId,
            hostId: CODEX_APP_LOCAL_HOST_ID,
            title: thread.threadName?.trim() || thread.threadPreview.trim() || thread.threadId,
            preview: thread.threadPreview,
            status: thread.statusType,
            cwd: thread.cwd,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          }));
        return this.buildDynamicToolSuccess({
          schemaVersion: 1,
          query: rawQuery.length > 0 ? rawQuery : null,
          threads,
        });
      }

      if (params.tool === "read_thread") {
        return this.buildDynamicToolSuccess(await this.buildDynamicReadThreadResponse(args));
      }

      if (params.tool === "send_message_to_thread") {
        const threadId = this.parseDynamicString(args.threadId) ?? "";
        const prompt = this.parseDynamicString(args.prompt) ?? "";
        if (!threadId || !prompt)
          throw new Error("send_message_to_thread requires threadId and prompt");
        await this.resolveDynamicThreadDetail(threadId);
        await this.startTurn(threadId, prompt, {
          model: this.parseDynamicString(args.model) ?? undefined,
          reasoningEffort: this.parseDynamicReasoningEffort(args.thinking),
        });
        return this.buildDynamicToolSuccess({ threadId });
      }

      if (params.tool === "set_thread_title") {
        const threadId = this.parseDynamicString(args.threadId) ?? "";
        const title = this.parseDynamicString(args.title) ?? "";
        if (!threadId || !title) throw new Error("set_thread_title requires threadId and title");
        await this.resolveDynamicThreadDetail(threadId);
        await this.threadTitlePersistence.set({
          threadId,
          name: title,
          normalization: "manual",
        });
        return this.buildDynamicToolSuccess({ threadId, title });
      }

      if (params.tool === "set_thread_archived") {
        const threadId = this.parseDynamicString(args.threadId) ?? params.threadId;
        if (!threadId || typeof args.archived !== "boolean") {
          throw new Error("set_thread_archived requires threadId and archived");
        }
        await this.resolveDynamicThreadDetail(threadId);
        if (args.archived) await this.conversationCommands.archive(threadId);
        else await this.conversationCommands.unarchive(threadId);
        return this.buildDynamicToolSuccess({ threadId, archived: args.archived });
      }

      if (params.tool === "set_thread_pinned") {
        const threadId = this.parseDynamicString(args.threadId) ?? "";
        if (!threadId || typeof args.pinned !== "boolean") {
          throw new Error("set_thread_pinned requires threadId and pinned");
        }
        await this.threadCatalog.setPinned(threadId, args.pinned);
        return this.buildDynamicToolSuccess({ threadId, pinned: args.pinned });
      }

      if (params.tool === "fork_thread") {
        const sourceThreadId = this.parseDynamicString(args.threadId) ?? params.threadId;
        const sourceDetail = await this.resolveDynamicThreadDetail(sourceThreadId);
        const environment = asRecord(args.environment);
        if (environment?.type === "worktree") {
          if (!sourceDetail.cwd) {
            throw new Error("A Git repository is required to continue in a new worktree");
          }
          const sourceRef = this.parseThreadRef(sourceThreadId);
          const initialThreadTitle = this.resolveUserFacingForkThreadTitle(sourceDetail);
          const sourceWorkspaceRoots = await this.resolvePendingWorktreeSourceWorkspaceRoots({
            projectId: sourceRef?.projectId ?? null,
            sourceThreadId,
            sourceWorkspaceRoot: sourceDetail.cwd,
          });
          const created = this.createPendingWorktree({
            hostId: CODEX_APP_LOCAL_HOST_ID,
            label: initialThreadTitle ?? "New task",
            ...(initialThreadTitle ? { initialThreadTitle } : {}),
            sourceWorkspaceRoot: sourceDetail.cwd,
            sourceWorkspaceRoots,
            startingState: { type: "working-tree" },
            localEnvironmentConfigPath: null,
            launchMode: "fork-conversation",
            projectAssignment: sourceRef?.projectId
              ? {
                  projectKind: "local",
                  projectId: sourceRef.projectId,
                  path: sourceDetail.cwd,
                  pendingCoreUpdate: false,
                }
              : null,
            prompt: "Continue this task in a new worktree",
            startConversationParamsInput: null,
            sourceConversationId: sourceThreadId,
            sourceCollaborationMode: sourceDetail.latestCollaborationMode ?? null,
            targetTurnId: null,
            threadSource: "subagent",
          });
          await this.forkSidePanelTransferLifecycle?.capturePending({
            pendingWorktreeId: created.pendingWorktreeId,
            sourceConversationId: sourceThreadId,
            sourceWorkspaceRoot: sourceDetail.cwd,
          });
          return this.buildDynamicToolSuccess({
            pendingWorktreeId: created.pendingWorktreeId,
          });
        }
        if (environment && environment.type !== "same-directory") {
          throw new Error("fork_thread received invalid arguments.");
        }
        const sourceRef = this.parseThreadRef(sourceThreadId);
        const sourceWorkspaceRoots = sourceRef?.projectId
          ? ((await this.maybeResolveProjectRuntimeContext(sourceRef.projectId))?.workspaceRoots ??
            [])
          : [sourceDetail.cwd].filter((cwd): cwd is string => cwd !== null);
        const shouldDeferThreadStarted =
          sourceRef?.projectId !== null && sourceRef?.projectId !== undefined;
        if (shouldDeferThreadStarted) {
          this.beginThreadStartNotificationDeferral();
        }
        let detail: CodexThreadDetail;
        let summary: CodexThreadSummary | null;
        try {
          const fork = await this.forkAndResumePersistentConversation({
            sourceThreadId,
            requestedCwd: sourceDetail.cwd,
            workspaceRoots: sourceWorkspaceRoots,
            threadSource: "subagent",
            materialize: (projectedThread, resolvedCwd) =>
              this.materializeThreadDetailFromThreadPayload(
                projectedThread,
                sourceRef,
                resolvedCwd ?? sourceDetail.cwd,
                { preserveExistingTimeline: true },
              ),
          });
          const forkedThreadId = fork.threadId;
          detail = fork.detail;
          summary = fork.summary;
          this.appendForkedFromConversationMarker(
            forkedThreadId,
            sourceThreadId,
            this.resolveForkedFromConversationTitle(sourceDetail),
          );
          this.syncDormantConversationFromRecord(forkedThreadId, "owner-unavailable");
          if (shouldDeferThreadStarted) {
            await this.completeThreadStartNotificationDeferral(forkedThreadId);
          }
        } finally {
          if (shouldDeferThreadStarted) {
            await this.endThreadStartNotificationDeferral();
          }
        }
        if (summary) this.emitEvent({ type: "threadSummary", thread: summary });
        await this.forkSidePanelTransferLifecycle?.stageDirect({
          sourceConversationId: sourceThreadId,
          targetConversationId: detail.threadId,
        });
        return this.buildDynamicToolSuccess({
          environment: { type: "same-directory" },
          sourceThreadId,
          threadId: detail.threadId,
          continuation: CODEX_SAME_DIRECTORY_FORK_CONTINUATION,
        });
      }

      if (params.tool === "create_thread") {
        const createInput = parseCodexDynamicCreateThreadInput(args);
        if (!createInput) throw new Error("create_thread received invalid arguments.");
        if (createInput.model !== undefined && createInput.thinking !== undefined) {
          const validationError = validateCodexDynamicCreateModelReasoning(
            createInput.model,
            createInput.thinking,
            await this.listModels(),
          );
          if (validationError) throw new Error(validationError);
        }
        const target = await resolveCodexDynamicCreateTarget(
          {
            prompt: createInput.prompt,
            target: createInput.target,
          },
          {
            getProject: async (projectId) => await this.projectWorkspace.getProject(projectId),
            createProjectlessWorkspace: async (workspaceInput) =>
              await createCodexProjectlessWorkspace(workspaceInput),
          },
        );
        const modelProjection = projectCodexDynamicCreateModel(
          createInput.model,
          createInput.thinking,
        );
        const sourceServiceName = await this.resolveThreadServiceName(params.threadId);
        const destinationSnapshot = await this.readDynamicCreateDestinationSnapshot(target);
        const hostPermissionMode = isCodexDynamicCreatePermissionMode(context.permissionMode)
          ? context.permissionMode
          : "auto";
        const [permissionSelection, serviceTier, pendingStartingState] = await Promise.all([
          this.resolveDynamicCreatePermissions(
            params.threadId,
            target,
            destinationSnapshot,
            hostPermissionMode,
          ),
          this.resolveDynamicCreateServiceTier(
            {
              cwd: target.cwd,
              model: modelProjection.collaborationMode?.settings.model ?? null,
            },
            context.serviceTierSelector,
          ),
          target.launchMode === "worktree"
            ? target.startingState
              ? Promise.resolve(target.startingState)
              : resolveManagedWorktreeDefaultStartingState(target.cwd)
            : Promise.resolve(null),
        ]);
        if (target.launchMode === "worktree") {
          if (!pendingStartingState) {
            throw new Error("Worktree create_thread requires a starting state");
          }
          return this.buildDynamicToolSuccess(
            this.enqueueDynamicPendingWorktree({
              createInput,
              destinationSnapshot,
              modelProjection,
              permissionSelection,
              ...(sourceServiceName === undefined ? {} : { serviceName: sourceServiceName }),
              serviceTier,
              sourceThreadId: params.threadId,
              startingState: pendingStartingState,
              target,
            }),
          );
        }
        return this.buildDynamicToolSuccess(
          await this.startDynamicCreatedConversation({
            createInput,
            modelProjection,
            permissionSelection,
            ...(sourceServiceName === undefined ? {} : { serviceName: sourceServiceName }),
            serviceTier,
            sourceThreadId: params.threadId,
            target,
          }),
        );
      }

      if (params.tool === "handoff_thread") {
        const threadId = this.parseDynamicString(args.threadId) ?? "";
        if (!threadId) throw new Error("handoff_thread requires threadId");
        if (threadId === params.threadId) {
          throw new Error("A thread cannot hand itself off. Choose another thread.");
        }
        const requestedDestinationHostId = this.parseDynamicString(args.destinationHostId);
        if (!requestedDestinationHostId) {
          const localCapability = this.evaluateLocalThreadHandoffCapability();
          if (localCapability.status !== "available") {
            throw new Error(
              `Task handoff is unavailable because its transactional runtime is not ready (${localCapability.reasons.join(", ")}).`,
            );
          }
        }
        await this.resolveDynamicThreadDetail(threadId);
        const targetThread = await this.readWorkspaceThread(threadId);
        if (!targetThread) throw new Error(`No task found for handoff: ${threadId}`);
        const destinationHostId = requestedDestinationHostId ?? targetThread.executionHostId;
        const destinationHost = this.executionHosts.getDescriptor(destinationHostId);
        if (!destinationHost) {
          throw new Error(`Host ${destinationHostId} is not available for task handoff.`);
        }
        const capability = this.evaluateThreadHandoffCapability(
          targetThread.executionHostId,
          destinationHostId,
        );
        if (capability.status !== "available") {
          throw new Error(
            `Task handoff is unavailable because its transactional runtime is not ready (${capability.reasons.join(", ")}).`,
          );
        }
        const operationId = params.callId || randomUUID();
        const existing = await this.threadHandoffRuntime.get(operationId);
        if (existing) return this.buildDynamicToolSuccess(existing);
        const operation = await this.threadHandoffRuntime.launch(
          {
            operationId,
            threadId,
            destinationHostId: requestedDestinationHostId,
            destinationHostDisplayName: destinationHost.displayName,
            followUpPrompt: this.parseDynamicString(args.followUpPrompt),
          },
          this.buildThreadExecutionLocationEffects(),
        );
        return this.buildDynamicToolSuccess(operation);
      }

      if (params.tool === "get_handoff_status") {
        const operationId = this.parseDynamicString(args.operationId) ?? "";
        if (!operationId) throw new Error("get_handoff_status requires operationId");
        const afterRevision =
          typeof args.afterRevision === "number" &&
          Number.isInteger(args.afterRevision) &&
          args.afterRevision >= 0
            ? args.afterRevision
            : null;
        const waitMs = this.clampDynamicInt(args.waitMs, 0, 0, CODEX_APP_HANDOFF_MAX_WAIT_MS);
        const operation = await this.threadHandoffRuntime.waitForRevision(
          operationId,
          afterRevision,
          waitMs,
        );
        if (!operation) {
          throw new Error(`No thread handoff operation found for operationId ${operationId}.`);
        }
        return this.buildDynamicToolSuccess(operation);
      }

      return this.buildDynamicToolFailure(`Unsupported dynamic tool: ${params.tool}`);
    } catch (error) {
      return this.buildDynamicToolFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private async handleDynamicToolCallRequest(
    request: Extract<CodexServerRequest, { method: "item/tool/call" }>,
  ): Promise<
    | DynamicToolCallResponse
    | typeof CODEX_SERVER_REQUEST_NO_RESPONSE
    | typeof CodexApplicationRequestPending
  > {
    const threadId = request.params.threadId;
    const lifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (lifecycle.disposition === "responded") {
      const responseEffect = lifecycle.effects.find(
        (effect) => effect.type === "respond" && effect.method === request.method,
      );
      if (responseEffect?.type === "respond") {
        return responseEffect.response as DynamicToolCallResponse;
      }
      return this.buildDynamicToolFailure(`${request.params.tool} received invalid arguments.`);
    }
    if (lifecycle.disposition !== "stored" && lifecycle.disposition !== "dispatched") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }
    if (lifecycle.disposition === "dispatched" && this.isConversationArchived(threadId)) {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const isStoredSpecialRequest = lifecycle.disposition === "stored";
    const nodexAuthority =
      request.params.namespace === NODEX_APP_TOOL_NAMESPACE
        ? await this.captureNodexAgentTurnAuthority(request.params)
        : null;
    if (!isStoredSpecialRequest && !threadId) {
      this.logger.warn("Ignored Codex dynamic tool call without a thread id", {
        requestId: request.id,
        tool: request.params.tool,
      });
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    if (
      !isStoredSpecialRequest &&
      (request.params.namespace === NODEX_APP_TOOL_NAMESPACE ||
        !this.rendererConversations.hasOwner(threadId))
    ) {
      return await this.handleDynamicToolCall(request.params, {}, nodexAuthority);
    }

    const pending = this.pendingServerRequests.register({
      kind: "dynamic-tool",
      request,
      nodexAuthority,
      disposition: isStoredSpecialRequest ? "stored" : "dispatched",
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });

    const dynamicArgs = asRecord(request.params.arguments);
    const shouldNotifyUserInput =
      isStoredSpecialRequest &&
      (request.params.tool === "request_option_picker" ||
        request.params.tool === "request_onboarding_input" ||
        (request.params.tool === "setup_codex_step" && dynamicArgs?.step !== "complete"));
    if (shouldNotifyUserInput) {
      this.emitUserInputRequiredNotification({
        threadId,
        requestId: request.id,
        turnId: request.params.turnId,
        questionCount: 0,
      });
    }

    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest({
      id: request.id,
      method: "item/tool/call",
      params: request.params,
    });
    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      return CodexApplicationRequestPending;
    }

    if (isStoredSpecialRequest) {
      this.syncAcceptedConversationRequests(threadId, { syncCapabilityFlags: true });
      return CodexApplicationRequestPending;
    }

    const claimed = this.pendingServerRequests.takeFirst(
      "dynamic-tool",
      request.id,
      (candidate) => candidate === pending,
    );
    if (claimed) this.pendingServerRequests.discard(claimed);
    return await this.handleDynamicToolCall(request.params, {}, nodexAuthority);
  }

  async respondToDynamicToolCall(
    requestId: RequestId,
    conversationId?: string,
    context: CodexDynamicToolExecutionContext = {},
  ): Promise<DynamicToolCallResponse | null> {
    const pending = this.pendingServerRequests.takeFirst(
      "dynamic-tool",
      requestId,
      (candidate) =>
        candidate.disposition === "dispatched" &&
        (conversationId === undefined || candidate.request.params.threadId === conversationId),
    );
    if (!pending) return null;

    try {
      const response = await this.handleDynamicToolCall(
        pending.request.params,
        context,
        pending.nodexAuthority,
      );
      this.pendingServerRequests.complete(pending, response);
      return response;
    } catch (error) {
      this.pendingServerRequests.reject(pending, error);
      throw error;
    }
  }

  async handleServerRequest(request: CodexServerRequest): Promise<unknown> {
    this.logger.info("Handling Codex server request", {
      requestId: String(request.id),
      method: request.method,
    });

    if (request.method === "currentTime/read") {
      return this.handleServerRequestNow(request);
    }

    if (this.bufferServerRequestForReplayIfNeeded(request)) {
      return CodexApplicationRequestPending;
    }

    return this.handleServerRequestNow(request);
  }

  private async handleServerRequestNow(request: CodexServerRequest): Promise<unknown> {
    if (request.method === "inbox-items-create") {
      return this.handleInboxItemsCreateRequest(request.params);
    }

    if (request.method === "item/commandExecution/requestApproval") {
      return this.handleApprovalRequest(request);
    }

    if (request.method === "item/fileChange/requestApproval") {
      return this.handleApprovalRequest(request);
    }

    if (request.method === "item/permissions/requestApproval") {
      return this.handlePermissionsRequestApproval(request);
    }

    if (request.method === "item/tool/requestUserInput") {
      return this.handleRequestUserInput(request);
    }

    if (request.method === "mcpServer/elicitation/request") {
      return this.handleMcpServerElicitationRequest(request);
    }

    if (
      request.method === "item/tool/requestOptionPicker" ||
      request.method === "item/tool/requestSetupCodexContextPicker"
    ) {
      return this.handlePrivateServerRequest(request);
    }

    if (request.method === "item/tool/call") {
      return this.handleDynamicToolCallRequest(request);
    }

    if (
      request.method === "currentTime/read" ||
      request.method === "account/chatgptAuthTokens/refresh" ||
      request.method === "attestation/generate" ||
      request.method === "applyPatchApproval" ||
      request.method === "execCommandApproval"
    ) {
      return this.handleOneShotServerRequest(request);
    }

    this.logger.warn("Ignored unsupported Codex server request", {
      requestId: String((request as { id: RequestId }).id),
      method: (request as { method: string }).method,
    });
    return CODEX_SERVER_REQUEST_NO_RESPONSE;
  }

  private handleOneShotServerRequest(
    request: Extract<
      CodexServerRequest,
      {
        method:
          | "currentTime/read"
          | "account/chatgptAuthTokens/refresh"
          | "attestation/generate"
          | "applyPatchApproval"
          | "execCommandApproval";
      }
    >,
  ): unknown {
    const threadId = this.resolveServerRequestThreadId(request) ?? "";
    const lifecycle = reduceCodexServerRequestRawState(
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
    const response = lifecycle.effects.find((effect) => effect.type === "respond");
    if (response?.type === "respond") return response.response;

    if (
      request.method === "account/chatgptAuthTokens/refresh" ||
      request.method === "attestation/generate"
    ) {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
      this.logger.warn("Ignored legacy Codex approval request", {
        requestId: String(request.id),
        method: request.method,
      });
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }
    return CODEX_SERVER_REQUEST_NO_RESPONSE;
  }

  private async handlePrivateServerRequest(
    request: Extract<
      CodexServerRequest,
      {
        method: "item/tool/requestOptionPicker" | "item/tool/requestSetupCodexContextPicker";
      }
    >,
  ): Promise<unknown | typeof CodexApplicationRequestPending> {
    const threadId = request.params.threadId;
    if (typeof threadId !== "string" || threadId.length === 0) {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }
    const lifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (lifecycle.disposition !== "stored") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    this.pendingServerRequests.register({
      kind: "private",
      request,
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });
    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest(request);
    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
    }
    if (request.method === "item/tool/requestOptionPicker") {
      this.emitUserInputRequiredNotification({
        threadId,
        requestId: request.id,
        turnId: request.params.turnId,
        questionCount: 0,
      });
    }
    return CodexApplicationRequestPending;
  }

  private async handleInboxItemsCreateRequest(params: unknown): Promise<{
    items: Array<{
      id: string;
      title: string | null;
      description: string | null;
      threadId: string | null;
    }>;
  }> {
    const payload = asRecord(params);
    if (!payload || !Array.isArray(payload.items)) {
      return { items: [] };
    }

    const conversationId = normalizeNonEmptyString(payload.conversationId);
    const turnId = normalizeNonEmptyString(payload.turnId);
    const fallbackId = conversationId ?? turnId ?? randomUUID();
    const items: Array<{
      id: string;
      title: string | null;
      description: string | null;
      threadId: string | null;
    }> = [];

    for (const [index, candidate] of payload.items.entries()) {
      const item = asRecord(candidate);
      if (!item) continue;

      const explicitId = normalizeNonEmptyString(item.id);
      const id =
        explicitId ?? (payload.items.length > 1 ? `${fallbackId}-${index + 1}` : fallbackId);
      const title = normalizeNonEmptyString(item.title);
      const description =
        normalizeNonEmptyString(item.description) ??
        normalizeNonEmptyString(item.summary) ??
        normalizeNonEmptyString(item.subtitle);
      const threadId = normalizeNonEmptyString(item.threadId) ?? conversationId ?? id;

      items.push({
        id,
        title,
        description,
        threadId,
      });
      try {
        const updated = await this.automationModule.setRunInboxItem({
          threadId,
          inboxTitle: title,
          inboxSummary: description,
        });
        if (updated) {
          this.notifyAutomationRunThreadUpdated(threadId, "turn-completed");
        }
      } catch (error) {
        this.logger.warn("Failed to persist scheduled automation inbox item", {
          threadId,
          error,
        });
      }
    }

    return { items };
  }

  private async handleApprovalRequest(
    request: Extract<
      CodexServerRequest,
      {
        method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
      }
    >,
  ): Promise<
    | CommandExecutionRequestApprovalResponse
    | FileChangeRequestApprovalResponse
    | typeof CODEX_SERVER_REQUEST_NO_RESPONSE
    | typeof CodexApplicationRequestPending
  > {
    const protocolRequestId = request.id;
    const requestId = protocolRequestId;
    const params = request.params;
    const kind = request.method === "item/commandExecution/requestApproval" ? "command" : "file";
    const threadId = params.threadId;
    const turnId = params.turnId;
    const itemId = params.itemId;

    if (typeof threadId !== "string" || threadId.length === 0) {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const ingressLifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (ingressLifecycle.disposition !== "stored") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const ref = this.parseThreadRef(threadId);

    const payload: CodexApprovalRequest = {
      type: "approval",
      requestId,
      kind,
      projectId: ref?.projectId ?? null,
      threadId,
      turnId,
      itemId,
      approvalId: "approvalId" in params ? (params.approvalId ?? null) : null,
      approvalRequestId: requestId,
      callId: itemId,
      reason: params.reason ?? undefined,
      command: "command" in params ? (params.command ?? undefined) : undefined,
      cwd: "cwd" in params ? (params.cwd ?? undefined) : undefined,
      approvalReason: params.reason ?? undefined,
      cmd:
        "command" in params && typeof params.command === "string"
          ? params.command.split(" ").filter((segment) => segment.trim().length > 0)
          : undefined,
      networkApprovalContext:
        "networkApprovalContext" in params
          ? params.networkApprovalContext
            ? {
                host: params.networkApprovalContext.host,
                protocol: params.networkApprovalContext.protocol,
              }
            : null
          : null,
      proposedExecpolicyAmendment:
        "proposedExecpolicyAmendment" in params
          ? (params.proposedExecpolicyAmendment ?? null)
          : null,
      proposedNetworkPolicyAmendments:
        "proposedNetworkPolicyAmendments" in params
          ? (params.proposedNetworkPolicyAmendments?.map((amendment) => ({
              host: amendment.host,
              action: amendment.action,
            })) ?? null)
          : null,
      availableDecisions:
        "availableDecisions" in params
          ? (params.availableDecisions
              ?.map((decision) =>
                typeof decision === "string" ? decision : (Object.keys(decision)[0] ?? ""),
              )
              .filter((decision) => decision.length > 0) ?? null)
          : null,
      grantRoot: "grantRoot" in params ? (params.grantRoot ?? null) : null,
      commandActions: "commandActions" in params ? (params.commandActions ?? null) : null,
      createdAt: Date.now(),
    };

    if (request.method === "item/commandExecution/requestApproval") {
      this.attachCommandExecutionApprovalRequest(request);
    } else {
      this.attachFileChangeApprovalRequest(requestId, request.params);
    }

    this.logger.info("Received Codex approval request", {
      requestId,
      kind,
      projectId: payload.projectId,
      threadId,
      turnId,
      itemId,
      command: payload.command ?? null,
      cwd: payload.cwd ?? null,
      reason: payload.reason ?? null,
    });
    this.pendingServerRequests.register({
      kind: "approval",
      request: payload,
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });
    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest(request);

    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
    }
    this.emitEvent({ type: "approvalRequested", request: payload });
    this.emitThreadNotificationEvent({
      type: "approval-requested",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversation: this.buildNotificationConversationFacts(threadId),
      requestId,
      turnId,
      approvalKind: kind === "command" ? "commandExecution" : "fileChange",
      reason: payload.reason ?? null,
    });
    return CodexApplicationRequestPending;
  }

  private attachCommandExecutionApprovalRequest(
    request: Extract<CodexServerRequest, { method: "item/commandExecution/requestApproval" }>,
  ): void {
    this.applyStandalonePendingRequestProjection(request);
  }

  private applyStandalonePendingRequestProjection(
    request: Extract<
      CodexServerRequest,
      {
        method:
          | "item/commandExecution/requestApproval"
          | "item/tool/requestUserInput"
          | "item/permissions/requestApproval";
      }
    >,
  ): void {
    const { threadId, turnId } = request.params;
    const record = this.getMaybeConversationRecord(threadId);
    if (!record?.detail?.turns.some((turn) => turn.turnId === turnId)) return;
    const canonicalTurn = (
      record ? this.readCanonicalConversationState(record.threadId) : null
    )?.turns.find((turn) => turn.protocol.id === turnId);
    const projected = projectCodexHistoryRequestViews({
      threadId,
      turnId,
      cwd: canonicalTurn?.sidecar.params.cwd ?? record?.detail?.cwd ?? null,
      items: this.listKnownTurnItems(threadId, turnId),
      requests: [request],
    });
    const requestItems = projected.filter(
      (item) =>
        item.requestId === request.id &&
        (item.type === "commandExecutionApproval" ||
          item.type === "requestUserInput" ||
          item.type === "permissionRequest"),
    );
    for (const requestItem of requestItems) {
      const existing = this.getRecordedItem(threadId, turnId, requestItem.itemId);
      if (existing?.requestId === request.id) continue;
      this.mergeItem(requestItem);
    }
  }

  private attachFileChangeApprovalRequest(
    requestId: RequestId,
    params: FileChangeRequestApprovalParams,
  ): void {
    const existing = this.getRecordedItem(params.threadId, params.turnId, params.itemId);
    if (!existing) {
      return;
    }

    this.updateRequestProjectionItem({
      ...existing,
      requestId,
      approvalRequestId: requestId,
      grantRoot: params.grantRoot ?? existing.grantRoot ?? null,
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

  private async handlePermissionsRequestApproval(
    request: Extract<CodexServerRequest, { method: "item/permissions/requestApproval" }>,
  ): Promise<
    | PermissionsRequestApprovalResponse
    | typeof CODEX_SERVER_REQUEST_NO_RESPONSE
    | typeof CodexApplicationRequestPending
  > {
    const protocolRequestId = request.id;
    const params = request.params;
    const requestId = protocolRequestId;
    const threadId = params.threadId;
    const turnId = params.turnId;
    const itemId = params.itemId;

    if (typeof threadId !== "string") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }
    const ingressLifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (ingressLifecycle.disposition !== "stored") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const ref = this.parseThreadRef(threadId);
    const payload: CodexPermissionRequest = {
      type: "permissionRequest",
      requestId,
      projectId: ref?.projectId ?? null,
      threadId,
      turnId,
      itemId,
      cwd: params.cwd,
      reason: params.reason,
      permissions: params.permissions,
      response: null,
      completed: false,
      createdAt: params.startedAtMs,
    };

    this.logger.info("Received Codex permissions request", {
      requestId,
      projectId: payload.projectId,
      threadId,
      turnId,
      itemId,
      cwd: payload.cwd,
      reason: payload.reason,
    });
    this.pendingServerRequests.register({
      kind: "permission",
      request: payload,
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });
    this.applyStandalonePendingRequestProjection(request);

    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest({
      id: protocolRequestId,
      method: "item/permissions/requestApproval",
      params,
    });
    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
    }
    this.emitThreadNotificationEvent({
      type: "approval-requested",
      hostId: DEFAULT_CODEX_HOST_ID,
      conversation: this.buildNotificationConversationFacts(threadId),
      requestId,
      turnId,
      approvalKind: "permissionRequest",
      reason: payload.reason ?? null,
    });
    return CodexApplicationRequestPending;
  }

  private async handleRequestUserInput(
    request: Extract<CodexServerRequest, { method: "item/tool/requestUserInput" }>,
  ): Promise<
    | ToolRequestUserInputResponse
    | typeof CODEX_SERVER_REQUEST_NO_RESPONSE
    | typeof CodexApplicationRequestPending
  > {
    const protocolRequestId = request.id;
    const params = request.params;
    const requestId = protocolRequestId;
    const threadId = params.threadId;
    const turnId = params.turnId;
    const itemId = params.itemId;

    if (typeof threadId !== "string" || threadId.length === 0) {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }
    const ingressLifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (ingressLifecycle.disposition !== "stored") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
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
      threadId,
      turnId,
      itemId,
      questions,
      isBlocking: params.isBlocking,
      autoResolutionMs: params.autoResolutionMs,
      createdAt: Date.now(),
    };

    this.logger.info("Received Codex user-input request", {
      requestId,
      projectId: payload.projectId,
      threadId,
      turnId,
      itemId,
      questionCount: questions.length,
      questionIds: questions.map((question) => question.id),
    });
    this.pendingServerRequests.register({
      kind: "user-input",
      request: payload,
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });
    if (!params.isBlocking) {
      this.userInputAutoResolution.observeRequest(threadId, requestId);
    }
    this.applyStandalonePendingRequestProjection(request);
    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest({
      id: protocolRequestId,
      method: "item/tool/requestUserInput",
      params,
    });
    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
    }
    this.emitEvent({ type: "userInputRequested", request: payload });
    this.emitUserInputRequiredNotification({
      threadId,
      requestId,
      turnId,
      questionCount: questions.length,
    });
    return CodexApplicationRequestPending;
  }

  private async handleMcpServerElicitationRequest(
    request: Extract<CodexServerRequest, { method: "mcpServer/elicitation/request" }>,
  ): Promise<
    | McpServerElicitationRequestResponse
    | typeof CODEX_SERVER_REQUEST_NO_RESPONSE
    | typeof CodexApplicationRequestPending
  > {
    const protocolRequestId = request.id;
    const params = request.params;
    const requestId = protocolRequestId;
    const threadId = params.threadId;
    if (typeof threadId !== "string") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const lifecycle = this.reduceIncomingServerRequest(threadId, request);
    if (lifecycle.disposition === "responded") {
      const responseEffect = lifecycle.effects.find(
        (effect) => effect.type === "respond" && effect.method === request.method,
      );
      this.logger.info("Declining unsupported Codex MCP elicitation request", {
        requestId,
        threadId,
        mode: params.mode,
        serverName: params.serverName,
      });
      return responseEffect?.type === "respond"
        ? (responseEffect.response as McpServerElicitationRequestResponse)
        : { action: "decline", content: null, _meta: null };
    }
    if (lifecycle.disposition !== "stored") {
      return CODEX_SERVER_REQUEST_NO_RESPONSE;
    }

    const ref = this.parseThreadRef(threadId);
    const payload: CodexMcpServerElicitationRequest = {
      type: "mcpServerElicitation",
      requestId,
      projectId: ref?.projectId ?? null,
      threadId,
      turnId: params.turnId ?? "",
      itemId: this.buildMcpServerElicitationItemId(requestId),
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

    this.logger.info("Received Codex MCP elicitation request", {
      requestId,
      projectId: payload.projectId,
      threadId,
      turnId: payload.turnId,
      mode: params.mode,
      serverName: params.serverName,
    });
    this.pendingServerRequests.register({
      kind: "mcp-elicitation",
      request: payload,
      occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
    });
    const ownerRouted = this.rendererConversationCoordinator.forwardServerRequest({
      id: protocolRequestId,
      method: "mcpServer/elicitation/request",
      params,
    });
    if (ownerRouted) {
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
    }
    return CodexApplicationRequestPending;
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

  private async handleNotification(
    notification: CodexServerNotification,
    options: HandleNotificationOptions = {},
  ): Promise<void> {
    if (this.bufferNotificationForReplayIfNeeded(notification, options)) {
      return;
    }
    const { method, params } = notification;
    const commandOnlyThreadId = this.resolveNotificationThreadId(notification);
    if (commandOnlyThreadId && this.isCommandOnlyAutomationThread(commandOnlyThreadId)) {
      if (method === "turn/completed") {
        await this.recordAutomationTurnCompleted(commandOnlyThreadId, params.turn);
      }
      if (method === "serverRequest/resolved") {
        const requestId = params.requestId;
        this.resolvePendingServerRequest(commandOnlyThreadId, requestId);
      }
      this.logger.debug(
        "Suppressed command-only automation notification from conversation pipeline",
        {
          threadId: commandOnlyThreadId,
          method,
        },
      );
      return;
    }

    if (method === "thread/started") {
      const thread =
        typeof params === "object" && params !== null
          ? (params as Record<string, unknown>).thread
          : null;
      const threadRecord = asRecord(thread);
      const parentThreadId = threadRecord ? parseThreadParentThreadId(threadRecord) : null;

      if (threadRecord && parentThreadId) {
        const summary = await this.upsertBackgroundSubagentThreadFromAppServerThread(
          threadRecord,
          parentThreadId,
          typeof threadRecord.cwd === "string" ? threadRecord.cwd : null,
        );
        if (summary) {
          this.logger.info("Received Codex subagent thread started notification", {
            threadId: summary.threadId,
            parentThreadId,
            projectId: summary.projectId,
          });
          this.emitEvent({ type: "threadSummary", thread: summary });
        }
        return;
      }

      const result = await this.upsertSidebarThreadFromAppServerThread(thread, {
        projects: await this.projectWorkspace.listProjects(),
        includeArchived: false,
        reason: "host-message",
      });
      const summary = result.summary;
      if (summary) {
        if (this.readCanonicalConversationState(summary.threadId)) {
          this.reduceCanonicalMainThreadMetadataNotification(notification);
        }
        const ownerRouted = this.rendererConversationCoordinator.forwardNotificationForConversation(
          summary.threadId,
          notification,
        );
        this.logger.info("Received Codex thread started notification", {
          threadId: summary.threadId,
          projectId: summary.projectId,
          sessionId: result.sessionId,
          materialized: result.materialized,
        });
        this.emitEvent({ type: "threadSummary", thread: summary });
        if (!ownerRouted) {
          this.syncDormantConversationFromRecord(summary.threadId, "owner-unavailable");
        }
        const metadata = createSidebarThreadSyncMetadata();
        mergeSidebarThreadMaterialization(metadata, result);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      }
      return;
    }

    if (method === "app/list/updated") {
      if (!this.supportsChatGptApps) return;
      const payload = asRecord(params);
      if (!payload || !Array.isArray(payload.data)) return;
      if (!payload.data.every((app) => asRecord(app) !== null)) return;

      this.emitEvent({
        type: "appsUpdated",
        apps: normalizeCodexAppInfoLogos(payload.data as AppInfo[]),
      });
      return;
    }

    if (method === "thread/status/changed") {
      const payload = params;

      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const parsed = parseThreadStatus(payload.status);
      const effects = this.reduceCanonicalMainThreadMetadataNotification(notification);
      this.logger.info("Received Codex thread status change", {
        threadId: payload.threadId,
        statusType: parsed.statusType,
        statusActiveFlags: parsed.statusActiveFlags,
      });
      const updated = await this.updateWorkspaceThreadSummary(payload.threadId, {
        status: {
          statusType: parsed.statusType,
          activeFlags: parsed.statusActiveFlags,
        },
      });
      if (updated) {
        const updatedWithRuntimeStatus = {
          ...updated,
          threadRuntimeStatus: parsed.threadRuntimeStatus,
        };
        this.emitEvent({ type: "threadSummary", thread: updatedWithRuntimeStatus });
        const metadata = createSidebarThreadSyncMetadata();
        markSidebarSyncScopeChanged(metadata, updated.projectId);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
        if (updatedWithRuntimeStatus.source?.parentThreadId) {
          this.syncParentChildMembershipMetadata(updatedWithRuntimeStatus.source.parentThreadId, {
            repairMissing: false,
          });
        }
      } else {
        this.scheduleSidebarNotificationSync(method, payload.threadId);
      }
      if (!ownerRouted) {
        this.syncAcceptedConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      } else {
        this.syncAcceptedConversationDocumentSilently(payload.threadId);
      }
      this.emitEvent({
        type: "threadStatus",
        threadId: payload.threadId,
        statusType: parsed.statusType,
        statusActiveFlags: parsed.statusActiveFlags,
      });
      if (!ownerRouted && effects.some((effect) => effect.type === "continueGoalIfIdle")) {
        void this.maybeContinueActiveThreadGoal(payload.threadId);
      }
      return;
    }

    if (method === "thread/archived" || method === "thread/unarchived") {
      const payload =
        typeof params === "object" && params !== null ? (params as Record<string, unknown>) : null;
      if (!payload || typeof payload.threadId !== "string") return;
      const archived = method === "thread/archived";
      this.logger.info("Received Codex thread archived state change", {
        threadId: payload.threadId,
        archived,
      });
      const previous = await this.readWorkspaceThread(payload.threadId);
      const hadUnreadState = Boolean(
        previous?.hasUnreadTurn ||
        this.readConversationAggregate(payload.threadId)?.preHydrationHasUnreadTurn ||
        this.readConversationAggregate(payload.threadId)?.canonicalState?.sidecar.hasUnreadTurn,
      );
      this.rememberWorkspaceSidebar(
        await this.projectWorkspace.setThreadArchived(payload.threadId, archived),
      );
      const persisted = await this.readWorkspaceThread(payload.threadId);
      const updated = persisted ? this.buildWorkspaceThreadSummary(persisted) : null;
      if (!previous) {
        if (!archived) this.scheduleSidebarNotificationSync(method, payload.threadId);
      }
      const metadata = createSidebarThreadSyncMetadata();
      if (previous) markSidebarSyncScopeChanged(metadata, previous.projectId);
      if (archived) {
        this.applyCommittedConversationUnreadState(payload.threadId, false, {
          broadcast: hadUnreadState,
        });
        await this.deleteHeartbeatAutomationForArchivedThread(payload.threadId);
      }
      if (updated) {
        this.emitEvent({ type: "threadSummary", thread: updated });
        if (updated.source?.parentThreadId) {
          this.syncParentChildMembershipMetadata(updated.source.parentThreadId, {
            repairMissing: false,
          });
        }
      }
      this.emitEvent({ type: "threadArchivedState", threadId: payload.threadId, archived });
      if (archived) {
        this.forgetThreadLocalState(payload.threadId);
      } else {
        const record = this.getMaybeConversationRecord(payload.threadId);
        if (record?.detail) record.detail.archived = false;
        this.syncAcceptedConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      }
      await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      return;
    }

    if (method === "thread/deleted") {
      const payload =
        typeof params === "object" && params !== null ? (params as Record<string, unknown>) : null;
      if (!payload || typeof payload.threadId !== "string") return;
      this.logger.info("Received Codex thread deleted notification", {
        threadId: payload.threadId,
      });
      const metadata = createSidebarThreadSyncMetadata();
      const existingThread = await this.readWorkspaceThread(payload.threadId);
      if (existingThread) markSidebarSyncScopeChanged(metadata, existingThread.projectId);
      const hadUnreadState = Boolean(
        existingThread?.hasUnreadTurn ||
        this.readConversationAggregate(payload.threadId)?.preHydrationHasUnreadTurn ||
        this.readConversationAggregate(payload.threadId)?.canonicalState?.sidecar.hasUnreadTurn,
      );
      const deleted = await this.projectWorkspace.deleteThread(payload.threadId);
      if (deleted.deleted) {
        this.workspaceThreadProjectionById.delete(payload.threadId);
      }
      this.applyCommittedConversationUnreadState(payload.threadId, false, {
        broadcast: hadUnreadState,
      });
      this.forgetThreadLocalState(payload.threadId);
      this.deletedThreadIds.add(payload.threadId);
      try {
        await this.desktopTools.releaseBrowserUseSession(payload.threadId);
      } catch (error) {
        this.logger.warn("Browser Use session release failed after thread deletion", {
          error: error instanceof Error ? error.message : String(error),
          threadId: payload.threadId,
        });
      }
      if (existingThread?.parentThreadId) {
        this.syncParentChildMembershipMetadata(existingThread.parentThreadId, {
          repairMissing: false,
        });
      }
      this.emitEvent({ type: "threadDeleted", threadId: payload.threadId });
      await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      return;
    }

    if (method === "thread/name/updated") {
      const payload = params;
      const name = payload.threadName ?? null;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      if (name?.trim()) {
        this.reduceCanonicalMainThreadMetadataNotification(notification);
      }
      const updated = await this.updateWorkspaceThreadSummary(payload.threadId, {
        threadName: name,
      });
      if (updated) {
        this.emitEvent({ type: "threadSummary", thread: updated });
        const metadata = createSidebarThreadSyncMetadata();
        markSidebarSyncScopeChanged(metadata, updated.projectId);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      } else {
        this.scheduleSidebarNotificationSync(method, payload.threadId);
      }
      if (!ownerRouted) {
        this.syncAcceptedConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      } else {
        this.syncAcceptedConversationDocumentSilently(payload.threadId);
      }
      return;
    }

    if (method === "thread/settings/updated") {
      const payload = params;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);

      const workspaceThread = await this.readWorkspaceThread(payload.threadId);
      const known = workspaceThread ? this.buildWorkspaceThreadSummary(workspaceThread) : null;
      if (!known && !this.getMaybeConversationRecord(payload.threadId)) {
        this.scheduleSidebarNotificationSync(method, payload.threadId);
        return;
      }

      this.reduceCanonicalMainThreadMetadataNotification(notification);

      if (known) {
        this.emitEvent({ type: "threadSummary", thread: known });
      }
      if (!ownerRouted) {
        this.syncAcceptedConversationDocument(payload.threadId, {
          syncDetail: true,
          syncLatestCollaborationMode: true,
          syncLatestThreadSettings: true,
          syncCapabilityFlags: true,
        });
      } else {
        this.syncAcceptedConversationDocumentSilently(payload.threadId);
      }
      if (known) {
        const metadata = createSidebarThreadSyncMetadata();
        markSidebarSyncScopeChanged(metadata, known.projectId);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      }
      return;
    }

    if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
      const payload = params;
      const goal = notification.method === "thread/goal/updated" ? notification.params.goal : null;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const shouldClearCompletedGoal =
        !ownerRouted && goal
          ? this.shouldClearNewCompletedThreadGoal(payload.threadId, goal)
          : false;
      const effects = this.reduceCanonicalMainThreadMetadataNotification(notification);
      if (
        shouldClearCompletedGoal ||
        (!ownerRouted && effects.some((effect) => effect.type === "clearCompletedGoal"))
      ) {
        this.scheduleCompletedThreadGoalClear(payload.threadId);
      }

      const workspaceThread = await this.readWorkspaceThread(payload.threadId);
      const known = workspaceThread ? this.buildWorkspaceThreadSummary(workspaceThread) : null;
      if (!known) {
        if (!ownerRouted) {
          this.scheduleSidebarNotificationSync(method, payload.threadId);
        }
        return;
      }

      this.emitEvent({ type: "threadSummary", thread: known });
      if (!ownerRouted) {
        this.syncAcceptedConversationSummary(payload.threadId, { syncCapabilityFlags: true });
        const metadata = createSidebarThreadSyncMetadata();
        markSidebarSyncScopeChanged(metadata, known.projectId);
        await this.emitWorkspaceSidebarSyncUpdatedFromMetadata(metadata, "host-message");
      } else {
        this.syncAcceptedConversationDocumentSilently(payload.threadId);
      }
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      const payload = params;

      const tokenUsage = parseCodexThreadTokenUsage(payload.tokenUsage);
      if (!tokenUsage) return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      this.reduceCanonicalMainThreadMetadataNotification(notification);
      if (!ownerRouted) {
        this.syncAcceptedConversationSummary(payload.threadId, { syncCapabilityFlags: true });
      } else {
        this.syncAcceptedConversationDocumentSilently(payload.threadId);
      }
      return;
    }

    if (method === "turn/started" || method === "turn/completed") {
      const payload = params;
      const { threadId, turn: turnRecord } = payload;
      if (method === "turn/completed") {
        this.scheduleSidebarNotificationSync(method, threadId);
      }

      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      if (method !== "turn/started" && !ownerRouted) {
        await this.waitForRendererOwnerNotificationDrain(threadId);
        if (method === "turn/completed") {
          await this.waitForFrameTextDeltaDrain(threadId);
        }
      }

      const turn = this.asTurnSummary(threadId, turnRecord);
      if (!turn) return;
      const observedAtMs = Date.now();
      const observedTurn: CodexTurnSummary & { turnId: string } =
        method === "turn/started"
          ? {
              ...turn,
              turnStartedAtMs: turn.turnStartedAtMs ?? observedAtMs,
            }
          : turn;
      this.logger.info("Received Codex turn lifecycle notification", {
        threadId,
        turnId: observedTurn.turnId,
        status: observedTurn.status,
      });
      const canonicalTurnId = this.reduceCanonicalMainTurnLifecycle({
        threadId,
        method,
        observedAtMs,
        turn: {
          id: observedTurn.turnId,
          status: observedTurn.status,
          error: turnRecord.error,
          startedAt: turnRecord.startedAt,
          completedAt: turnRecord.completedAt,
          durationMs: turnRecord.durationMs,
        },
      });
      if (!canonicalTurnId) return;
      const mergedTurn = this.getKnownTurn(threadId, canonicalTurnId);
      if (!mergedTurn || mergedTurn.turnId === null) return;
      if (mergedTurn.status !== "inProgress") {
        this.syncTurnDiffItem(threadId, mergedTurn.turnId, mergedTurn.diff, mergedTurn.status);
      }
      this.reconcileTurnItemsToTerminalStatus(threadId, mergedTurn.turnId, mergedTurn.status);
      if (mergedTurn.status !== "inProgress") {
        await this.restoreUnacceptedSteeringEntriesForTurn(
          threadId,
          mergedTurn.turnId,
          mergedTurn.status === "interrupted"
            ? "Turn was interrupted before the steer was accepted"
            : "Turn ended before the steer was accepted",
        );
      }
      this.emitEvent({ type: "turn", turn: mergedTurn });
      if (method === "turn/completed" && mergedTurn.status !== "inProgress") {
        const lastAgentMessage = this.resolveNotificationLastAgentMessage(
          threadId,
          mergedTurn.turnId,
          turnRecord,
        );
        this.emitThreadNotificationEvent({
          type: "turn-completed",
          hostId: DEFAULT_CODEX_HOST_ID,
          conversation: this.buildNotificationConversationFacts(threadId),
          turnId: mergedTurn.turnId,
          status: mergedTurn.status,
          lastAgentMessage,
          heartbeatAssistantMessage: parseCodexHeartbeatAssistantMessage(lastAgentMessage),
          automationNotificationDecision: null,
          hasPendingContinuation: this.hasPendingNotificationContinuation(
            threadId,
            mergedTurn.status,
          ),
        });
      }
      try {
        if (method === "turn/started") {
          await this.desktopTools.turnStarted({
            sessionId: threadId,
            turnId: mergedTurn.turnId,
          });
        } else {
          await this.desktopTools.turnEnded({
            sessionId: threadId,
            turnId: mergedTurn.turnId,
          });
        }
      } catch (error) {
        this.logger.warn("Browser Use turn lifecycle synchronization failed", {
          error: error instanceof Error ? error.message : String(error),
          method,
          threadId,
          turnId: mergedTurn.turnId,
        });
      }
      await this.syncThreadStatusFromKnownTurns(threadId);
      if (method === "turn/completed") {
        void this.recordAutomationTurnCompleted(threadId, turnRecord);
      }
      if (!ownerRouted) {
        this.syncDormantConversationFromRecord(threadId, "owner-unavailable");
      }
      if (mergedTurn.status !== "inProgress") {
        this.maybeDispatchQueuedFollowUp(threadId);
      }
      this.rendererConversationCoordinator.reconcileOwnership(threadId);
      return;
    }

    if (method === "turn/plan/updated") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string" || typeof payload.turnId !== "string")
        return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (method === "model/safetyBuffering/updated") {
      const payload = asRecord(params);
      if (
        !payload ||
        typeof payload.threadId !== "string" ||
        !Array.isArray(payload.useCases) ||
        !Array.isArray(payload.reasons) ||
        typeof payload.showBufferingUi !== "boolean"
      ) {
        return;
      }
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      if (typeof payload.turnId !== "string") return;
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      const turn = this.getKnownTurn(payload.threadId, payload.turnId);
      if (turn) this.emitEvent({ type: "turn", turn });
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (method === "hook/started" || method === "hook/completed") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string") return;
      const run = asRecord(payload.run);
      if (!run) return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (method === "turn/diff/updated") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string" || typeof payload.turnId !== "string")
        return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      const turn = this.getKnownTurn(payload.threadId, payload.turnId);
      if (turn) this.emitEvent({ type: "turn", turn });
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (method === "model/rerouted") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string") return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (
      method === "item/autoApprovalReview/started" ||
      method === "item/autoApprovalReview/completed"
    ) {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string") return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (method === "guardianWarning") {
      const payload = asRecord(params);
      if (!payload || typeof payload.threadId !== "string") return;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
      this.publishCanonicalMainTurnMetadata(payload.threadId, turnIds, ownerRouted);
      return;
    }

    if (notification.method === "item/started" || notification.method === "item/completed") {
      const payload = notification.params;
      const { threadId } = payload;
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);

      if (method === "item/completed" && !ownerRouted) {
        await this.waitForRendererOwnerNotificationDrain(threadId);
        await this.waitForFrameTextDeltaDrain(threadId);
      }

      const turnId = this.reduceCanonicalMainItemLifecycle(notification);
      if (!turnId) {
        if (ownerRouted) this.rendererConversationCoordinator.reconcileOwnership(threadId);
        return;
      }
      if (method === "item/completed" && payload.item.type === "fileChange") {
        const turn = this.getKnownTurn(threadId, turnId);
        if (turn && turn.status !== "inProgress") {
          this.syncTurnDiffItem(threadId, turnId, turn.diff, turn.status);
        }
      }
      if (ownerRouted) {
        this.rendererConversationCoordinator.reconcileOwnership(threadId);
        return;
      }
      this.syncAcceptedConversationTurnState(threadId, turnId, {
        syncBackgroundTerminalRows: true,
        syncChildMemberships: true,
        syncCapabilityFlags: true,
      });
      return;
    }

    if (
      method === "item/agentMessage/delta" ||
      method === "item/plan/delta" ||
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta"
    ) {
      if (!isCodexFrameTextDeltaNotification(notification)) return;
      const frameTextDelta = toCodexFrameTextDelta(notification);
      if (this.rendererConversationCoordinator.forwardNotification(notification)) {
        this.conversationDeltaBuffer.enqueueFrameText(frameTextDelta);
        return;
      }
      this.conversationDeltaBuffer.enqueueFrameText(frameTextDelta);
      return;
    }

    if (method === "item/reasoning/summaryPartAdded") {
      const payload = asRecord(params);
      if (
        !payload ||
        typeof payload.threadId !== "string" ||
        typeof payload.turnId !== "string" ||
        typeof payload.itemId !== "string" ||
        typeof payload.summaryIndex !== "number"
      ) {
        return;
      }
      this.rendererConversationCoordinator.forwardNotification(notification);
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      if (!isCodexCommandOutputNotification(notification)) return;
      const update = toCodexCommandOutputUpdate(notification);
      if (this.rendererConversationCoordinator.forwardNotification(notification)) {
        this.conversationDeltaBuffer.enqueueCommandOutput(update);
        return;
      }

      if (update.turnId !== null) {
        this.emitHostMessage({
          type: "mcpNotification",
          hostId: DEFAULT_CODEX_HOST_ID,
          notification,
        });
      }
      this.conversationDeltaBuffer.enqueueCommandOutput(update);
      return;
    }

    if (method === "item/commandExecution/terminalInteraction") {
      const payload = asRecord(params);
      if (
        !payload ||
        typeof payload.threadId !== "string" ||
        typeof payload.itemId !== "string" ||
        typeof payload.stdin !== "string"
      ) {
        return;
      }

      this.rendererConversationCoordinator.forwardNotification(notification);
      this.applyTerminalInteraction({
        threadId: payload.threadId,
        turnId: typeof payload.turnId === "string" ? payload.turnId : null,
        itemId: payload.itemId,
        stdin: payload.stdin,
      });
      return;
    }

    if (method === "item/fileChange/outputDelta") {
      const payload = asRecord(params);
      if (
        !payload ||
        typeof payload.threadId !== "string" ||
        typeof payload.turnId !== "string" ||
        typeof payload.itemId !== "string" ||
        typeof payload.delta !== "string"
      ) {
        return;
      }
      this.rendererConversationCoordinator.forwardNotification(notification);
      return;
    }

    if (method === "item/fileChange/patchUpdated") {
      if (!isCodexFileChangePatchUpdatedNotification(notification)) return;
      const update = toCodexFileChangePatchUpdate(notification);
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      this.applyFileChangePatchUpdate(update, ownerRouted);
      return;
    }

    if (method === "item/mcpToolCall/progress") {
      if (!isCodexMcpToolCallProgressNotification(notification)) return;
      const update = toCodexMcpToolCallProgressUpdate(notification);
      const ownerRouted = this.rendererConversationCoordinator.forwardNotification(notification);
      this.applyMcpToolCallProgressUpdate(update, ownerRouted);
      return;
    }

    if (method === "serverRequest/resolved") {
      const payload = asRecord(params);
      if (!payload) return;
      const requestId = payload.requestId ?? payload.request_id;
      if (typeof requestId !== "string" && typeof requestId !== "number") return;
      const threadId = payload.threadId;
      if (typeof threadId !== "string") return;
      this.userInputAutoResolution.observeServerResolution(threadId, requestId);
      this.rendererConversationCoordinator.forwardNotification(notification);
      this.resolvePendingServerRequest(threadId, requestId);
      return;
    }

    if (method === "error") {
      const payload =
        typeof params === "object" && params !== null ? (params as Record<string, unknown>) : null;
      const threadId = typeof payload?.threadId === "string" ? payload.threadId : null;
      const turnId = typeof payload?.turnId === "string" ? payload.turnId : null;
      const errorRecord =
        typeof payload?.error === "object" && payload.error !== null
          ? (payload.error as Record<string, unknown>)
          : null;
      const message =
        typeof errorRecord?.message === "string" ? errorRecord.message : "Codex error";
      const additionalDetails =
        typeof errorRecord?.additionalDetails === "string" ? errorRecord.additionalDetails : null;
      const ownerRouted =
        threadId && turnId && errorRecord
          ? this.rendererConversationCoordinator.forwardNotification(notification)
          : false;

      if (threadId && turnId) {
        const turnIds = this.reduceCanonicalMainTurnMetadataNotification(notification, Date.now());
        this.publishCanonicalMainTurnMetadata(threadId, turnIds, Boolean(ownerRouted));
      }

      this.emitEvent({ type: "error", message, detail: additionalDetails ?? undefined });
    }
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
        this.buildDefaultCollaborationModeState(),
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
