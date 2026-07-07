import type { ReactNode } from "react";
import type { ThreadGoal, FeedbackUploadParams } from "@nodex/codex-app-server-protocol/v2";
import type { ThreadMemoryMode } from "@nodex/codex-app-server-protocol";
import type {
  Card,
  CardRunInTarget,
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexBackgroundTerminalRow,
  CodexCollaborationModeKind,
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
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationResponse,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexConversationTurnPagination,
  CodexModelOption,
  CodexPermissionMode,
  CodexPermissionRequestResponse,
  CodexPromptInput,
  CodexSteerTurnInput,
  CodexThreadGoalDraftInput,
  CodexThreadGoalSetActionInput,
  CodexThreadStatusType,
  CodexThreadSummary,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexTurnDiffReviewTarget,
  WorktreeEnvironmentOption,
  WorktreeStartMode,
} from "../../lib/types";
import type { ComposerEnterBehavior } from "../../lib/composer-enter-behavior";
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
}

export interface ThreadTurnDiffFileSidePanelTarget {
  path: string;
  title: string;
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
  projectWorkspacePath?: string | null;
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string;
    projectName: string;
    sessionId: string;
    threadTitle?: string;
    runInTarget?: CardRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
  } | null;
  newThreadProjectSelector?: NewChatProjectSelectorModel | null;
  newThreadStartInSelector?: NewChatStartInSelectorModel | null;
  threadStartProgress: {
    runInTarget: CardRunInTarget;
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
  reasoningEffortOptions: CodexReasoningEffortOption[];
  permissionMode: CodexPermissionMode;
  isQueueingEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  searchOpenTick: number;
  summarySideChatRows?: readonly ThreadSummaryPanelAuxiliaryRow[];
  summaryBrowserRows?: readonly ThreadSummaryPanelAuxiliaryRow[];
  planSidePanelState?: ThreadPlanSidePanelState | null;
  composerIntent: CodexComposerIntent | null;
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
  onPermissionModeChange: (mode: CodexPermissionMode) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
  onComposerIdeContextEnabledChange?: (enabled: boolean) => void;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onStartChatGptLogin: () => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onStartApiKeyLogin: (apiKey: string) => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onCancelLogin: (loginId: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onStartThreadForSession?: (input: {
    projectId: string;
    sessionId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadGoalDraft?: CodexThreadGoalDraftInput;
    runInTarget?: CardRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
  }) => Promise<void>;
  onNewThreadStartInTargetChange?: (target: NewChatStartInTarget) => void;
  onNewThreadStartInEnvironmentChange?: (environmentPath: string | null) => void;
  onRefreshNewThreadStartInEnvironments?: () => Promise<void>;
  onOpenNewThreadLocalEnvironmentsSettings?: () => void;
  onNewThreadProjectChange?: (projectId: string) => void;
  onRequestNewChatProjectCreate?: () => void;
  onSendPrompt: (prompt: string, opts?: { collaborationMode?: CodexCollaborationModeKind; promptInput?: CodexPromptInput }) => Promise<void>;
  onOpenSideChat?: (input?: ThreadOpenSideChatInput) => Promise<void>;
  onOpenMcpAppSidePanel?: (input: ThreadMcpAppSidePanelInput) => Promise<void>;
  onOpenPlanInSidePanel?: (input: ThreadPlanSidePanelTarget) => void | Promise<void>;
  onClosePlanSidePanel?: (input: { planKey: string }) => void | Promise<void>;
  onRequestRenameThread?: () => void;
  onSteerPrompt: (input: Omit<CodexSteerTurnInput, "threadId">) => Promise<void>;
  onInterruptTurn: (turnId?: string) => Promise<void>;
  onRespondApproval: (
    requestId: string,
    decision: CodexApprovalDecision,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondUserInput: (
    requestId: string,
    answers: Record<string, string[]>,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondMcpElicitation: (
    requestId: string,
    response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse,
    context?: ThreadRequestResponseContext,
  ) => Promise<void>;
  onRespondPermissionRequest?: (
    requestId: string,
    response: CodexPermissionRequestResponse,
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
  onOpenTurnDiffReview: (target: CodexTurnDiffReviewTarget) => void;
  onOpenTurnDiffFileInSidePanel?: (target: ThreadTurnDiffFileSidePanelTarget) => void | Promise<void>;
  onConsumeComposerIntent: (threadId: string, focusNonce: number) => void;
  onOpenThread: (threadId: string, context?: ThreadOpenThreadContext) => void | Promise<void>;
  onStopBackgroundAgents?: (threadIds: readonly string[]) => Promise<void>;
  onCleanBackgroundTerminals: (threadId: string) => Promise<void>;
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
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "assistantActions";
  entry: CodexConversationItem;
  actions: ThreadAssistantMessageActionsModel;
}

export interface ThreadThinkingPlaceholderBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "thinkingPlaceholder";
}

export interface ThreadWorkedForBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
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

export interface ThreadTranscriptBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
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
    | "streamError"
    | "systemError"
    | "remoteTaskCreated"
    | "personalityChanged"
    | "forkedFromConversation"
    | "modelChanged"
    | "modelRerouted"
    | "contextCompaction"
    | "automaticApprovalReview"
    | "autoReviewInterruptionWarning"
    | "multiAgentAction"
    | "subagentActivityInlineGroup"
    | "steered"
    | "systemEvent"
    | "userInputResponse";
  entry: CodexConversationItem;
  status?: CodexConversationItem["status"];
  isTurnCancelled?: boolean;
  automaticApprovalReviews?: CodexConversationItem[];
  userMessageActions?: ThreadUserMessageActionsModel;
  assistantMessageActions?: ThreadAssistantMessageActionsModel;
  assistantAfterBlocks?: ThreadBlockModel[];
  searchUnitKey?: string;
  subagentActivityRows?: ThreadSubagentActivityInlineRowModel[];
  subagentActivityStatusLabel?: string;
}

export interface ThreadUserAttachmentStripBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "userAttachmentStrip";
  attachments: CodexUserAttachment[];
}

export interface ThreadExplorationGroupBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "explorationGroup";
  entries: CodexConversationItem[];
  summary: string;
  status?: CodexConversationItem["status"];
  automaticApprovalReviews?: CodexConversationItem[];
}

export interface ThreadMultiAgentGroupBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "multiAgentGroup";
  entries: CodexConversationItem[];
  summary: string;
  status?: CodexConversationItem["status"];
}

export interface ThreadWebSearchGroupBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "webSearchGroup";
  entries: Array<ThreadTranscriptBlockModel & { type: "webSearch" }>;
  status?: CodexConversationItem["status"];
}

export interface ThreadPendingMcpToolCallsBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "pendingMcpToolCalls";
  entries: Array<ThreadTranscriptBlockModel & { type: "mcpToolCall" }>;
  summary: string;
  status?: CodexConversationItem["status"];
}

export interface ThreadDynamicToolCallGroupBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "dynamicToolCallGroup";
  entries: Array<ThreadTranscriptBlockModel & { type: "dynamicToolCall" }>;
  summary: string;
  summaryParts?: Array<{ key: string; label: string; count: number }>;
  canExpand?: boolean;
  repeatCount: number;
  status?: CodexConversationItem["status"];
}

export type ThreadCollapsedToolActivityEntryModel =
  | ThreadTranscriptBlockModel
  | ThreadExplorationGroupBlockModel
  | ThreadWebSearchGroupBlockModel;

export interface ThreadCollapsedToolActivitySummaryStats {
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
  mcpToolCallSources: ThreadCollapsedToolActivityMcpSourceStats[];
  webSearchCount: number;
  runningWebSearchCount: number;
}

export interface ThreadCollapsedToolActivityMcpSourceStats {
  key: string;
  logoUrl: string | null;
  logoUrlDark: string | null;
  name: string;
  nativeAppReference: unknown | null;
  count: number;
  runningCount: number;
}

export type ThreadCollapsedToolActivityActiveSummary =
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

export interface ThreadCollapsedToolActivitySummaryCues {
  runningSummary: ThreadCollapsedToolActivityActiveSummary | null;
  continuitySummary: ThreadCollapsedToolActivityActiveSummary | null;
}

export interface ThreadCollapsedToolActivityBlockModel extends ThreadRenderKeyedBlockFields {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "collapsedToolActivity";
  entries: ThreadCollapsedToolActivityEntryModel[];
  summary: string;
  summaryStats?: ThreadCollapsedToolActivitySummaryStats;
  summaryParts?: string[];
  runningSummary?: ThreadCollapsedToolActivityActiveSummary | null;
  continuitySummary?: ThreadCollapsedToolActivityActiveSummary | null;
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

export type ThreadAgentEntryModel =
  | ThreadAgentItemModel
  | ThreadExplorationGroupBlockModel
  | ThreadMultiAgentGroupBlockModel
  | ThreadWebSearchGroupBlockModel
  | ThreadPendingMcpToolCallsBlockModel
  | ThreadDynamicToolCallGroupBlockModel
  | ThreadCollapsedToolActivityBlockModel;

export type ThreadAgentRenderEntryBlockModel =
  | ThreadAgentItemModel
  | ThreadExplorationGroupBlockModel;

export type ThreadAgentRenderUnit =
  | {
      kind: "entry";
      block: ThreadAgentRenderEntryBlockModel;
    }
  | {
      kind: "webSearchGroup";
      block: ThreadWebSearchGroupBlockModel;
    }
  | {
      kind: "multiAgentGroup";
      block: ThreadMultiAgentGroupBlockModel;
    }
  | {
      kind: "collapsedToolActivity";
      block: ThreadCollapsedToolActivityBlockModel;
    }
  | {
      kind: "dynamicToolCallGroup";
      block: ThreadDynamicToolCallGroupBlockModel;
    }
  | {
      kind: "pendingMcpToolCalls";
      block: ThreadPendingMcpToolCallsBlockModel;
    };

export type ThreadBlockModel =
  | ThreadTranscriptBlockModel
  | ThreadAssistantActionsBlockModel
  | ThreadUserAttachmentStripBlockModel
  | ThreadWorkedForBlockModel
  | ThreadExplorationGroupBlockModel
  | ThreadMultiAgentGroupBlockModel
  | ThreadWebSearchGroupBlockModel
  | ThreadPendingMcpToolCallsBlockModel
  | ThreadDynamicToolCallGroupBlockModel
  | ThreadCollapsedToolActivityBlockModel
  | ThreadThinkingPlaceholderBlockModel;

export interface ThreadTurnRenderBuckets {
  preUserItems: ThreadTranscriptBlockModel[];
  userItems: ThreadTranscriptBlockModel[];
  latestAssistantMessage: ThreadTranscriptBlockModel | null;
  assistantItem: ThreadTranscriptBlockModel | null;
  systemEventItem: ThreadTranscriptBlockModel | null;
  approvalItem: ThreadPendingTurnRequestModel | null;
  userInputItem: ThreadPendingTurnRequestModel | null;
  mcpServerElicitationItems: ThreadTranscriptBlockModel[];
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
  turnId: string;
  turn: CodexConversationTurn | null;
  buckets: ThreadTurnRenderBuckets;
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
  searchableText: string;
  searchUnits: ThreadSearchUnitModel[];
  hasRenderableAgentBodyUnits: boolean;
  defaultAgentBodyCollapsed: boolean;
  collapsedMessageCount: number;
}

export interface ThreadSearchUnitModel {
  key: string;
  turnId: string;
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
  turnId: string;
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
  hasAboveComposerBlocks: boolean;
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
  parentTurnKey: string | null;
  displayName: string;
  actorName: string;
  agentRole: string | null;
  spawnModel: string | null;
  status: "active" | "waiting" | "done";
  statusSummary: string | null;
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
  threadId: string | null;
  title: string;
  connection: CodexConnectionState;
  account: CodexAccountSnapshot | null;
  showSideChatAction?: boolean;
}

export type ThreadSummaryPanelMode = "hidden" | "pinned" | "popover";

export interface ThreadBodySurfaceModel {
  projectId: string;
  threadId: string | null;
  isSideChat: boolean;
  cwd: string | null;
  turns: CodexConversationTurn[];
  turnPagination?: CodexConversationTurnPagination | null;
  requests: CodexConversationServerRequest[];
  resumeState: CodexConversationResumeState | null;
  statusType: CodexThreadStatusType | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  body: ThreadBodyModel;
  parentTurns: readonly CodexConversationTurn[];
  childMemberships: readonly CodexConversationChildMembership[];
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  threadStartProgress: {
    runInTarget: CardRunInTarget;
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
  reasoningEffortOptions: CodexReasoningEffortOption[];
  permissionMode: CodexPermissionMode;
  isQueueingEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  composerIntent: CodexComposerIntent | null;
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
}

export interface ThreadBodyUiStateOverrides {
  collapsedAgentBodyByTurnId?: Record<string, boolean>;
}

export interface ThreadOpenCardDataState {
  loading: boolean;
  card: Card | null;
}
