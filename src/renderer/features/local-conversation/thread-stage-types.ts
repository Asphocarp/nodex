import type { ReactNode } from "react";
import type { ThreadGoal, FeedbackUploadParams } from "@nodex/codex-app-server-protocol/v2";
import type { ThreadMemoryMode } from "@nodex/codex-app-server-protocol";
import type {
  DatabasePage,
  PageRunInTarget,
  CodexAccountSnapshot,
  CodexApprovalResponse,
  CodexBackgroundTerminalRow,
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalSetupCodexStepResponse,
  CodexCollaborationModeKind,
  CodexPermissionState,
  CodexComposerIntent,
  CodexCollaborationModePreset,
  CodexConnectionState,
  CodexDictationStateSnapshot,
  CodexConversationCapabilityFlags,
  CodexConversationChildMembership,
  CodexConversationItem,
  CodexUserAttachment,
  CodexConversationLiveRequest,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexCanonicalServerRequest,
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationResponse,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexConversationTurnPagination,
  CodexModelOption,
  CodexPermissionMode,
  CodexPersonality,
  CodexPermissionRequestResponse,
  NodexAgentAuthorizationResponse,
  CodexProtocolRequestId,
  CodexPromptInput,
  CodexSteerTurnInput,
  CodexThreadGoalDraftInput,
  CodexThreadGoalMaterializedDraft,
  CodexThreadGoalSetActionInput,
  CodexThreadStatusType,
  CodexThreadSummary,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
  GitReviewSource,
  PanelId,
  ProtocolAppInfo,
  WorktreeEnvironmentOption,
  WorktreeStartMode,
} from "../../lib/types";
import type { ReviewOpenIntent } from "@/features/review/model/review-view-state";
import type { ComposerEnterBehavior } from "../../lib/composer-enter-behavior";
import type { CodexHooksSettingsTarget } from "../../lib/codex-hooks-route";
import type { CodexTurnScopedConversationRequest } from "./conversation-request-helpers";
import type { NewChatProjectSelectorOption } from "../../lib/new-chat-project-selector";
import type { NewChatStartInTarget } from "../../lib/new-chat-start-in-selector";
import type { ThreadWorkedForTiming } from "./thread-worked-for-time";

export interface NewChatProjectSelectorModel {
  projects: NewChatProjectSelectorOption[];
  selectedProjectId: string | null;
  disabled: boolean;
  canAddProject: boolean;
}

export interface NewChatStartInSelectorModel {
  target: NewChatStartInTarget;
  disabled: boolean;
  worktreeAvailable: boolean;
  environments: WorktreeEnvironmentOption[];
  environmentsLoading: boolean;
  selectedEnvironmentPath: string | null;
  worktreeStartMode: WorktreeStartMode;
  worktreeBranchPrefix: string;
}

export interface ThreadSummaryPanelAuxiliaryRow {
  id: string;
  title: string;
  status?: string | null;
  isResponseInProgress?: boolean;
  panelId?: PanelId;
  leafId?: string | null;
}

export interface ThreadSummaryPanelBrowserRow {
  id: string;
  title: string;
  displayUrl: string | null;
  url: string;
  faviconUrl: string | null;
  isAgentWorking: boolean;
  panelId?: PanelId;
  leafId?: string | null;
}

export interface ThreadSummaryPanelScheduledAutomationRow {
  id: string;
  name: string;
  scheduleSummary: string | null;
  nextRunLabel: string;
}

export interface ThreadSummaryPanelScheduledAutomationOpenInput {
  automationId?: string | null;
  createInput?: CodexScheduledAutomationCreateInput | null;
  mode?: "open" | "suggested-create" | "suggested-update";
  title: string;
  updateInput?: CodexScheduledAutomationUpdateInput | null;
}

export interface ThreadSummaryPanelGitReviewOpenInput {
  source: GitReviewSource;
}

export interface ThreadSummaryPanelGitActionInput {
  action: "commit-or-push" | "create-pull-request";
}

export interface ThreadSummaryPanelComputerUsePipState {
  visible: boolean;
}

export interface ThreadTurnDiffFileSidePanelTarget {
  cwd?: string | null;
  path: string;
  title: string;
  workspaceRoot?: string | null;
}

export interface ThreadSummaryPanelOutputSidePanelTarget {
  cwd?: string | null;
  path: string;
  title: string;
  workspaceRoot?: string | null;
}

export interface ThreadPlanSidePanelTarget {
  planKey: string;
  threadId: string;
  turnId: string;
  itemId: string;
  content: string;
  cwd: string | null;
  hideCodeBlocks?: boolean;
}

export interface ThreadPlanSidePanelState {
  rightPanelEnabled: boolean;
  activePlanKey: string | null;
  activeRightPanelTabId: string | null;
}

export type ThreadOpenSubagentStatus = "active" | "waiting" | "done";

export interface ThreadSubagentDiffStats {
  linesAdded: number;
  linesRemoved: number;
}

export interface ThreadOpenSubagentPayload {
  conversationId: string;
  displayName: string;
  agentRole: string | null;
  spawnModel: string | null;
  status: ThreadOpenSubagentStatus;
  statusSummary: string | null;
  showInlineActivity?: boolean;
  diffStats: ThreadSubagentDiffStats | null;
}

export interface ThreadOpenThreadContext {
  subagent?: ThreadOpenSubagentPayload;
}

export interface ThreadStageRouteInput {
  projectId: string;
  sessionId?: string | null;
  threadPinned?: boolean;
  threadActionShortcuts?: ThreadStageHeaderModel["shortcuts"];
  projectWorkspacePath?: string | null;
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string | null;
    projectName: string;
    sessionId: string;
    threadTitle?: string;
    runInTarget?: PageRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
  } | null;
  newThreadProjectSelector?: NewChatProjectSelectorModel | null;
  newThreadStartInSelector?: NewChatStartInSelectorModel | null;
  threadStartProgress: {
    runInTarget: PageRunInTarget;
    threadId?: string | null;
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  } | null;
  activeThreadId: string | null;
  activeThreadSummary: CodexThreadSummary | null;
  conversation: CodexConversationSnapshot | null;
  parentTurns: readonly CodexConversationTurn[];
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  connection: CodexConnectionState;
  account: CodexAccountSnapshot | null;
  availableModels: CodexModelOption[];
  collaborationModes: CodexCollaborationModePreset[];
  selectedCollaborationMode: CodexCollaborationModeKind;
  selectedModel: string;
  selectedReasoningEffort: CodexReasoningEffort;
  selectedPersonality?: CodexPersonality;
  reasoningEffortOptions: CodexReasoningEffortOption[];
  permissionMode: CodexPermissionMode;
  isQueueingEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  searchOpenTick: number;
  summarySideChatRows?: readonly ThreadSummaryPanelAuxiliaryRow[];
  summaryBrowserRows?: readonly ThreadSummaryPanelBrowserRow[];
  summaryScheduledAutomation?: ThreadSummaryPanelScheduledAutomationRow | null;
  summaryComputerUsePip?: ThreadSummaryPanelComputerUsePipState | null;
  planSidePanelState?: ThreadPlanSidePanelState | null;
  composerIntent: CodexComposerIntent | null;
  newThreadComposerIntent?: CodexComposerIntent | null;
  primaryRequest: CodexConversationLiveRequest | null;
  sideChatContext?: {
    parentThreadId: string;
    tabTitle: string;
  } | null;
}

export interface ThreadStageActions {
  onCollaborationModeChange: (mode: CodexCollaborationModeKind) => void | Promise<void>;
  onModelChange: (model: string) => void | Promise<void>;
  onReasoningEffortChange: (reasoningEffort: CodexReasoningEffort) => void | Promise<void>;
  onPersonalityChange?: (personality: CodexPersonality) => void | Promise<void>;
  onPermissionModeChange: (mode: CodexPermissionMode) => void | Promise<void>;
  onQueueingEnabledChange: (enabled: boolean) => void;
  onOpenSubagentsPanel?: () => void | Promise<void>;
  onComposerIdeContextEnabledChange?: (enabled: boolean) => void;
  onStartThreadForSession?: (input: {
    projectId: string | null;
    sessionId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadGoalDraft?: CodexThreadGoalDraftInput;
    threadGoalMaterializedDraft?: CodexThreadGoalMaterializedDraft;
    runInTarget?: PageRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
  }) => Promise<void>;
  onNewThreadStartInTargetChange?: (target: NewChatStartInTarget) => void;
  onNewThreadStartInEnvironmentChange?: (environmentPath: string | null) => void;
  onRefreshNewThreadStartInEnvironments?: () => Promise<void>;
  onOpenNewThreadLocalEnvironmentsSettings?: () => void;
  onOpenHooksSettings?: (target: CodexHooksSettingsTarget) => void;
  onNewThreadProjectChange?: (projectId: string) => void;
  onRequestNewChatProjectCreate?: () => void;
  onSendPrompt: (prompt: string, opts?: { collaborationMode?: CodexCollaborationModeKind; promptInput?: CodexPromptInput }) => Promise<void>;
  onOpenSideChat?: (input?: ThreadOpenSideChatInput) => Promise<void>;
  onOpenMcpAppSidePanel?: (input: ThreadMcpAppSidePanelInput) => Promise<void>;
  onOpenPlanInSidePanel?: (input: ThreadPlanSidePanelTarget) => void | Promise<void>;
  onClosePlanSidePanel?: (input: { planKey: string }) => void | Promise<void>;
  onOpenSummarySideChatRow?: (input: ThreadSummaryPanelAuxiliaryRowOpenInput) => void | Promise<void>;
  onOpenSummaryBrowserRow?: (input: ThreadSummaryPanelAuxiliaryRowOpenInput) => void | Promise<void>;
  onOpenSummaryScheduledAutomation?: (input: ThreadSummaryPanelScheduledAutomationOpenInput) => void | Promise<void>;
  onOpenSummaryOutputInSidePanel?: (target: ThreadSummaryPanelOutputSidePanelTarget) => boolean | Promise<boolean>;
  onOpenSummaryGitReview?: (input: ThreadSummaryPanelGitReviewOpenInput) => void | Promise<void>;
  onStartSummaryGitAction?: (input: ThreadSummaryPanelGitActionInput) => void | Promise<void>;
  onOpenProcessManager?: () => void | Promise<void>;
  onOpenBackgroundTerminalOutput?: (row: CodexBackgroundTerminalRow) => void | Promise<void>;
  onToggleSummaryComputerUsePip?: (nextVisible: boolean) => void | Promise<void>;
  onRequestRenameThread?: () => void;
  onArchiveThread?: () => void | Promise<void>;
  onToggleThreadPin?: () => void | Promise<void>;
  onCopyConversationMarkdown?: () => Promise<void>;
  onSteerPrompt: (input: Omit<CodexSteerTurnInput, "threadId">) => Promise<void>;
  onInterruptTurn: (turnId?: string) => Promise<void>;
  onRespondApproval: (
    requestId: CodexProtocolRequestId,
    response: CodexApprovalResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondUserInput: (
    requestId: CodexProtocolRequestId,
    answers: Record<string, string[]>,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondMcpElicitation: (
    requestId: CodexProtocolRequestId,
    response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondPermissionRequest?: (
    requestId: CodexProtocolRequestId,
    response: CodexPermissionRequestResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondNodexAgentAuthorization?: (
    requestId: string,
    response: NodexAgentAuthorizationResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondOptionPicker?: (
    requestId: CodexProtocolRequestId,
    response: CodexCanonicalOptionPickerResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondSetupCodexStep?: (
    requestId: CodexProtocolRequestId,
    response: CodexCanonicalSetupCodexStepResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onResolvePlanImplementationRequest: (threadId: string, turnId: string) => Promise<void>;
  onEnqueueQueuedFollowUp: (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null; promptInput?: CodexPromptInput },
  ) => Promise<void>;
  onRemoveQueuedFollowUp: (threadId: string, followUpId: string) => Promise<void>;
  onReorderQueuedFollowUps: (threadId: string, orderedFollowUpIds: string[]) => Promise<void>;
  onSendQueuedFollowUpNow: (threadId: string, followUpId: string) => Promise<void>;
  onEditQueuedFollowUp: (input: {
    threadId: string;
    followUpId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
  }) => Promise<void>;
  onEditLastUserTurn: (input: { threadId: string; turnId: string; message: string }) => Promise<void>;
  onForkFromTurn: (input: { threadId: string; turnId: string; message: string }) => Promise<void>;
  onCompactThread?: (threadId: string) => Promise<void>;
  onGetThreadGoal?: (threadId: string) => Promise<ThreadGoal | null>;
  onSetThreadGoal?: (input: CodexThreadGoalSetActionInput) => Promise<ThreadGoal | null>;
  onClearThreadGoal?: (threadId: string) => Promise<void>;
  onDismissThreadGoalResumeConfirmation?: (threadId: string) => Promise<void>;
  onSetThreadMemoryMode?: (input: { threadId: string; mode: ThreadMemoryMode }) => Promise<void>;
  onUploadFeedback?: (params: FeedbackUploadParams) => Promise<void>;
  onOpenStatusPanel?: (threadId: string) => void;
  onToggleDesktopPet?: () => void;
  onUnarchiveThread: (threadId: string, projectId: string) => Promise<void>;
  onOpenTurnDiffReview: (intent: ReviewOpenIntent) => void | Promise<void>;
  onOpenTurnDiffFileInSidePanel?: (target: ThreadTurnDiffFileSidePanelTarget) => void | Promise<void>;
  onConsumeComposerIntent: (threadId: string, focusNonce: number) => void;
  onConsumeNewThreadComposerIntent?: (sessionId: string, focusNonce: number) => void;
  onOpenThread: (threadId: string, context?: ThreadOpenThreadContext) => void | Promise<void>;
  onStopBackgroundAgents?: (threadIds: readonly string[]) => Promise<void>;
  onCleanBackgroundTerminals: (threadId: string) => Promise<void>;
}

export interface ThreadSummaryPanelAuxiliaryRowOpenInput {
  rowId: string;
  panelId: PanelId;
  leafId?: string | null;
}

export type ThreadOpenSideChatInput =
  | {
      kind?: "submit";
      prompt?: string;
      promptInput?: CodexPromptInput;
    }
  | {
      kind: "draft";
      draftPrompt: string;
    };

export interface ThreadRequestResponseContext {
  conversationId?: string | null;
}

export interface ThreadMcpWidgetCspModel {
  connectDomains?: string[];
  resourceDomains?: string[];
}

export interface ThreadMcpWidgetMetadataModel {
  domain: string | null;
  csp: ThreadMcpWidgetCspModel | null;
  heightHint: number | null;
  minFrameHeight: number | null;
  prefersBorder: boolean;
  isCollapsible: boolean;
}

export interface ThreadMcpAppSidePanelInput {
  mcpAppId: string;
  capabilityId: string;
  title: string;
  threadId: string;
  server: string;
  tool: string;
  resource: {
    uri: string;
    mode: "html";
    html: string;
    mimeType: string | null;
    metadata: ThreadMcpWidgetMetadataModel;
  };
}

export interface ThreadUserMessageActionsModel {
  canEdit: boolean;
  sentAtMs: number | null;
}

export interface ThreadAssistantMessageActionsModel {
  copyText: string | null;
  sentAtMs: number | null;
  canRate: boolean;
  canFork: boolean;
}

export interface ThreadRenderKeyedBlockFields {
  renderKey?: string;
}

export interface ThreadAssistantActionsBlockModel {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "assistantActions";
  entry: CodexConversationItem;
  actions: ThreadAssistantMessageActionsModel;
}

export interface ThreadThinkingPlaceholderBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  message?: string;
  type: "thinkingPlaceholder";
}

export interface ThreadWorkedForBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "workedFor";
  status: ThreadWorkedForTiming["status"];
  startedAtMs: number;
  completedAtMs: number | null;
}

export type ThreadSubagentActivityStatus = "started" | "updated" | "interrupted" | "done";

export interface ThreadSubagentActivityInlineRowModel {
  conversationId: string;
  displayName: string;
  agentRole: string | null;
  spawnModel: string | null;
  status: ThreadOpenSubagentStatus;
  activityStatus: ThreadSubagentActivityStatus;
  statusSummary: string | null;
  diffStats: ThreadSubagentDiffStats | null;
}

export interface ThreadTurnSubagentActivityState {
  hasActivity: boolean;
  hasActiveActivity: boolean;
}

export interface ThreadTranscriptBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type:
    | "userMessage"
    | "assistantMessage"
    | "reasoning"
    | "proposedPlan"
    | "todoList"
    | "exec"
    | "fileChange"
    | "turnDiff"
    | "mcpToolCall"
    | "dynamicToolCall"
    | "webSearch"
    | "hook"
    | "planImplementation"
    | "mcpServerElicitation"
    | "automationUpdate"
    | "generatedImage"
    | "imageView"
    | "permissionRequest"
    | "realtimeTranscript"
    | "streamError"
    | "systemError"
    | "remoteTaskCreated"
    | "personalityChanged"
    | "forkedFromConversation"
    | "modelChanged"
    | "modelRerouted"
    | "contextCompaction"
    | "worktreeInit"
    | "automaticApprovalReview"
    | "autoReviewInterruptionWarning"
    | "multiAgentAction"
    | "subagentActivityInlineGroup"
    | "steered"
    | "systemEvent"
    | "userInputResponse"
    | "userInput";
  entry: CodexConversationItem;
  status?: CodexConversationItem["status"];
  isTurnCancelled?: boolean;
  isMcpAppWidgetSuperseded?: boolean;
  automaticApprovalReviews?: CodexConversationItem[];
  userMessageActions?: ThreadUserMessageActionsModel;
  assistantMessageActions?: ThreadAssistantMessageActionsModel;
  assistantAfterBlocks?: ThreadBlockModel[];
  searchUnitKey?: string;
  hookFeedbackSources?: Array<
    NonNullable<CodexConversationTurn["hookRuns"]>[number]["run"]["source"]
  >;
  imageViewPaths?: string[];
  subagentActivityRows?: ThreadSubagentActivityInlineRowModel[];
  subagentActivityStatusLabel?: string;
}

export interface ThreadUserAttachmentStripBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "userAttachmentStrip";
  attachments: CodexUserAttachment[];
}

export interface ThreadGeneratedImageGalleryItemModel {
  id: string;
  previewSrc?: string;
  src: string;
}

export interface ThreadGeneratedImageGalleryBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "generatedImageGallery";
  images: ThreadGeneratedImageGalleryItemModel[];
  pendingImageCount: number;
}

export type ThreadAgentActivityGroupEntryModel = ThreadTranscriptBlockModel;

export interface ThreadAgentActivityGroupSummaryStats {
  createdFileCount: number;
  runningCreatedFileCount: number;
  stoppedCreatedFileCount: number;
  editedFileCount: number;
  runningEditedFileCount: number;
  deletedFileCount: number;
  runningDeletedFileCount: number;
  changedLineCount: number;
  runningCreatedLineCount: number;
  exploredFileCount: number;
  runningExploredFileCount: number;
  loadedToolCount: number;
  runningLoadedToolCount: number;
  searchCount: number;
  runningSearchCount: number;
  listCount: number;
  runningListCount: number;
  commandCount: number;
  runningCommandCount: number;
  completedWebSearchCommandCount: number;
  runningFolderCreationCommandCount: number;
  runningWebSearchCommandCount: number;
  deniedRequestCount: number;
  timedOutRequestCount: number;
  hookCount: number;
  runningHookCount: number;
  mcpToolCallCount: number;
  runningMcpToolCallCount: number;
  mcpToolCallSources: ThreadAgentActivityGroupMcpSourceStats[];
  webSearchCount: number;
  runningWebSearchCount: number;
}

export interface ThreadAgentActivityGroupMcpSourceStats {
  key: string;
  logoUrl: string | null;
  logoUrlDark: string | null;
  name: string;
  nativeAppReference: unknown | null;
  count: number;
  runningCount: number;
}

export type ThreadAgentActivityGroupActiveSummary =
  | {
    kind: "text";
    key: string;
    label: string;
  }
  | {
    kind: "fileChange";
    key: string;
    label: string;
    displayPath: string;
    additions: number;
    deletions: number;
  };

export interface ThreadAgentActivityGroupSummaryCues {
  runningSummary: ThreadAgentActivityGroupActiveSummary | null;
  continuitySummary: ThreadAgentActivityGroupActiveSummary | null;
}

export interface ThreadAgentActivityGroupBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "agentActivityGroup";
  canExpand?: boolean;
  entries: ThreadAgentActivityGroupEntryModel[];
  mcpApps?: readonly ProtocolAppInfo[];
  summary: string;
  summaryStats?: ThreadAgentActivityGroupSummaryStats;
  summaryParts?: string[];
  liveHeaderKind?: "active" | "thinking";
  runningSummary?: ThreadAgentActivityGroupActiveSummary | null;
  continuitySummary?: ThreadAgentActivityGroupActiveSummary | null;
  status?: CodexConversationItem["status"];
}

export interface ThreadPendingTurnRequestModel {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: CodexTurnScopedConversationRequest["type"];
  request: CodexTurnScopedConversationRequest;
}

export type ThreadRendererItemModel =
  | ThreadTranscriptBlockModel
  | ThreadWorkedForBlockModel
  | ThreadPendingTurnRequestModel;

export type ThreadAgentItemModel =
  | ThreadTranscriptBlockModel
  | ThreadWorkedForBlockModel;

/** Exact v2 activity-classifier result shape. `null` is the hidden result. */
export type ThreadAgentActivityGrouping = "groupable" | "standalone";

export interface ThreadAgentActivityItem<TItem = ThreadAgentItemModel> {
  item: TItem;
  grouping: ThreadAgentActivityGrouping;
}

export type ThreadAgentActivityClassification<TItem = ThreadAgentItemModel> =
  | ThreadAgentActivityItem<TItem>
  | null;

/** `sourceIndex` exists only between classification and final unit construction. */
export interface ThreadIndexedAgentActivityItem<TItem = ThreadAgentItemModel> {
  activityItem: ThreadAgentActivityItem<TItem>;
  sourceIndex: number;
}

export type ThreadAgentActivityUnit<TItem = ThreadAgentItemModel> =
  | {
      kind: "group";
      key: string;
      items: readonly [ThreadAgentActivityItem<TItem>, ...ThreadAgentActivityItem<TItem>[]];
    }
  | {
      kind: "standalone";
      key: string;
      item: ThreadAgentActivityItem<TItem>;
    };

export type ThreadAgentEntryModel =
  | ThreadAgentItemModel
  | ThreadAgentActivityGroupBlockModel;

export type ThreadAgentRenderEntryBlockModel = ThreadAgentItemModel;

export type ThreadAgentRenderUnit = (
  | {
      kind: "entry";
      block: ThreadAgentRenderEntryBlockModel;
    }
  | {
      kind: "agentActivityGroup";
      block: ThreadAgentActivityGroupBlockModel;
    }
) & {
  targetAttributes?: Record<"data-local-conversation-item-target-ids", string>;
};

export type ThreadBlockModel =
  | ThreadTranscriptBlockModel
  | ThreadAssistantActionsBlockModel
  | ThreadGeneratedImageGalleryBlockModel
  | ThreadUserAttachmentStripBlockModel
  | ThreadWorkedForBlockModel
  | ThreadAgentActivityGroupBlockModel
  | ThreadThinkingPlaceholderBlockModel;

export interface ThreadTurnRenderBuckets {
  preUserItems: ThreadTranscriptBlockModel[];
  userItems: ThreadTranscriptBlockModel[];
  latestAssistantMessage: ThreadTranscriptBlockModel | null;
  assistantItem: ThreadTranscriptBlockModel | null;
  systemEventItem: ThreadTranscriptBlockModel | null;
  approvalItem: ThreadPendingTurnRequestModel | null;
  userInputItem: ThreadPendingTurnRequestModel | null;
  interactiveRequestItem: ThreadPendingTurnRequestModel | null;
  permissionRequestItems: ThreadPendingTurnRequestModel[];
  mcpServerElicitationItems: ThreadTranscriptBlockModel[];
  toolOutputItems: ThreadTranscriptBlockModel[];
  todoListItem: ThreadTranscriptBlockModel | null;
  unifiedDiffItem: ThreadTranscriptBlockModel | null;
  proposedPlanItem: ThreadTranscriptBlockModel | null;
  planImplementationItem: ThreadTranscriptBlockModel | null;
  postAssistantItems: ThreadTranscriptBlockModel[];
  agentItems: ThreadAgentItemModel[];
  remoteTaskCreatedItems: ThreadTranscriptBlockModel[];
  personalityChangedItems: ThreadTranscriptBlockModel[];
  forkedFromConversationItems: ThreadTranscriptBlockModel[];
  modelChangedItems: ThreadTranscriptBlockModel[];
  modelReroutedItems: ThreadTranscriptBlockModel[];
  thinkingPlaceholderItem: ThreadThinkingPlaceholderBlockModel | null;
}

export interface ThreadTurnModel {
  turnId: string | null;
  turnKey: string;
  turn: CodexConversationTurn | null;
  buckets: ThreadTurnRenderBuckets;
  agentActivitySourceItems: ThreadAgentItemModel[];
  leadingBlocks: ThreadBlockModel[];
  agentBodyUnits: ThreadAgentRenderUnit[];
  trailingBlocks: ThreadBlockModel[];
  blocks: ThreadBlockModel[];
  aboveComposerBlocks?: ThreadBlockModel[];
  workedForItem: ThreadWorkedForBlockModel | null;
  workedForTiming: ThreadWorkedForTiming | null;
  workedDurationMs: number | null;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  isAgentActivitySliceClosed?: boolean;
  isAgentActivityExploring?: boolean;
  searchableText: string;
  searchUnits: ThreadSearchUnitModel[];
  hasRenderableAgentBodyUnits: boolean;
  defaultAgentBodyCollapsed: boolean;
  collapsedMessageCount: number;
}

export interface ThreadSearchUnitModel {
  key: string;
  turnId: string | null;
  turnKey: string;
  text: string;
  blockType: "userMessage" | "assistantMessage";
}

export type ThreadUserMessageNavigationOutputType =
  | "app"
  | "website"
  | "google-drive"
  | "file"
  | "image"
  | "commit"
  | "pull-request"
  | "review";

export interface ThreadUserMessageNavigationOutput {
  id: string;
  type: ThreadUserMessageNavigationOutputType;
  label: string;
}

export interface ThreadUserMessageNavigationItem {
  id: string;
  turnId: string | null;
  turnKey: string;
  ordinal: number;
  label: string;
  responsePreview: string;
  outputs: ThreadUserMessageNavigationOutput[];
  isHeartbeat: boolean;
}

export interface ThreadBodyModel {
  threadId: string | null;
  turnCount: number;
  isThreadRunning: boolean;
  activeTurnId: string | null;
  latestTurnId: string | null;
  emptyState:
    | { type: "none" }
    | { type: "newThread"; title: string; description: string }
    | { type: "noThread"; title: string; description: string }
    | { type: "emptyThread"; title: string; description: string }
    | { type: "archivedThread"; title: string; description: string }
    | { type: "resumingThread"; title: string; description: string; status: CodexConversationResumeState };
  showThreadStartProgressPanel: boolean;
}

export interface ThreadComposerShellPendingRequestModel {
  request: CodexConversationLiveRequest;
  conversationId: string;
  surface: "activeThread" | "backgroundThread";
  actorName?: string | null;
  requestItem?: CodexConversationItem | null;
}

export interface ThreadComposerShellPendingSteerRowModel {
  steerId: string;
  threadId: string;
  turnId: string;
  prompt: string;
  displayText: string;
}

export interface ThreadComposerShellQueuedFollowUpRowModel {
  followUpId: string;
  threadId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  displayText: string;
  collaborationMode?: CodexCollaborationModeKind | null;
  pausedReason?: string | null;
}

export interface ThreadComposerShellBackgroundAgentRowModel {
  conversationId: string;
  parentConversationId: string;
  parentTurnKey: string | null;
  displayName: string;
  actorName: string;
  agentRole: string | null;
  spawnModel: string | null;
  status: "active" | "waiting" | "done";
  statusSummary: string | null;
  lastAssistantMessage: string | null;
  lastAssistantMessageAtMs: number | null;
  recencyAtMs: number;
  showInlineActivity: boolean;
  diffStats: ThreadSubagentDiffStats | null;
  role: "childApproval" | "backgroundChild";
}

export interface ThreadComposerShellModel {
  activeRequest: ThreadComposerShellPendingRequestModel | null;
  backgroundRequest: ThreadComposerShellPendingRequestModel | null;
  pendingSteerRows: ThreadComposerShellPendingSteerRowModel[];
  queuedFollowUpRows: ThreadComposerShellQueuedFollowUpRowModel[];
  backgroundAgentRows: ThreadComposerShellBackgroundAgentRowModel[];
  backgroundTerminalRows: CodexBackgroundTerminalRow[];
  showRequestCards: boolean;
  showComposer: boolean;
  showApprovalMode: boolean;
}

export interface ThreadStageHeaderModel {
  projectId: string;
  sessionId: string | null;
  threadId: string | null;
  title: string;
  cwd: string | null;
  pinned?: boolean;
  shortcuts?: {
    togglePin?: string;
    rename?: string;
    archive?: string;
    openSideTask?: string;
    copyConversationMarkdown?: string;
  };
  showSideChatAction?: boolean;
}

export type ThreadSummaryPanelMode = "hidden" | "pinned" | "popover";

export interface ThreadBodySurfaceModel {
  projectId: string;
  hostId: string;
  sessionId?: string | null;
  threadId: string | null;
  isSideChat: boolean;
  cwd: string | null;
  turns: CodexConversationTurn[];
  turnPagination?: CodexConversationTurnPagination | null;
  requests: CodexConversationServerRequest[];
  canonicalRequests?: CodexCanonicalServerRequest[];
  resumeState: CodexConversationResumeState | null;
  statusType: CodexThreadStatusType | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  body: ThreadBodyModel;
  parentTurns: readonly CodexConversationTurn[];
  childMemberships: readonly CodexConversationChildMembership[];
  backgroundAgentRows?: readonly ThreadComposerShellBackgroundAgentRowModel[];
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  threadStartProgress: {
    runInTarget: PageRunInTarget;
    threadId?: string | null;
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  } | null;
}

export interface ThreadFooterModel {
  projectId: string;
  projectWorkspacePath?: string | null;
  threadId: string | null;
  cwd: string | null;
  account: CodexAccountSnapshot | null;
  conversation: CodexConversationSnapshot | null;
  resumeState: CodexConversationResumeState | null;
  activeTurn: CodexConversationTurn | null;
  isThreadRunning: boolean;
  isNewThreadTab: boolean;
  isCloudNewThreadTarget: boolean;
  newThreadTarget: ThreadStageRouteInput["newThreadTarget"];
  newThreadProjectSelector?: ThreadStageRouteInput["newThreadProjectSelector"];
  newThreadStartInSelector?: ThreadStageRouteInput["newThreadStartInSelector"];
  composerShell: ThreadComposerShellModel;
  body: ThreadBodyModel;
  collaborationModes: CodexCollaborationModePreset[];
  selectedCollaborationMode: CodexCollaborationModeKind;
  selectedModel: string;
  availableModels: CodexModelOption[];
  selectedReasoningEffort: CodexReasoningEffort;
  selectedPersonality?: CodexPersonality;
  reasoningEffortOptions: CodexReasoningEffortOption[];
  permissionMode: CodexPermissionMode;
  permissionState?: CodexPermissionState;
  isQueueingEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  composerIntent: CodexComposerIntent | null;
  newThreadComposerIntent?: CodexComposerIntent | null;
  composerScopeIdentity?: string | null;
  dictation: CodexDictationStateSnapshot;
  composerIdeContext?: {
    isConnected: boolean;
    isEnabled: boolean;
  };
  composerPlugins?: {
    name: string;
    path: string;
  }[];
}

export interface ThreadStageScreenProps {
  header?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  floatingContent?: ReactNode;
  contentShiftX?: number;
  onReadInteraction?: () => void;
}

export interface ThreadBodyUiStateOverrides {
  collapsedAgentBodyByTurnId?: Record<string, boolean>;
}

export interface ThreadOpenPageDataState {
  loading: boolean;
  card: DatabasePage | null;
}
