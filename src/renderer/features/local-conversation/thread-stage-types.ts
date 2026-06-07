import type { ReactNode } from "react";
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
  CodexConversationItem,
  CodexUserAttachment,
  CodexConversationLiveRequest,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexMcpServerElicitationAction,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexModelOption,
  CodexPermissionMode,
  CodexPromptInput,
  CodexSteerTurnInput,
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

export interface ThreadStageRouteInput {
  projectId: string;
  projectWorkspacePath?: string | null;
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string;
    projectName: string;
    cardId?: string;
    cardTitle?: string;
    columnId?: string;
    sessionId?: string;
    threadTitle?: string;
    runInTarget?: CardRunInTarget;
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: WorktreeStartMode;
    worktreeBranchPrefix?: string | null;
  } | null;
  newThreadProjectSelector?: NewChatProjectSelectorModel | null;
  newThreadStartInSelector?: NewChatStartInSelectorModel | null;
  showHeaderSeparator: boolean;
  activeThreadCardColumnId: string | null;
  threadStartProgress: {
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
  composerIntent: CodexComposerIntent | null;
  primaryRequest: CodexConversationLiveRequest | null;
}

export interface ThreadStageActions {
  onCollaborationModeChange: (mode: CodexCollaborationModeKind) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort: CodexReasoningEffort) => void;
  onPermissionModeChange: (mode: CodexPermissionMode) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
  onComposerIdeContextEnabledChange?: (enabled: boolean) => void;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onStartChatGptLogin: () => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onStartApiKeyLogin: (apiKey: string) => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onCancelLogin: (loginId: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onStartThreadForCard: (input: { projectId: string; cardId: string; prompt: string; promptInput?: CodexPromptInput }) => Promise<void>;
  onStartThreadForSession?: (input: {
    projectId: string;
    sessionId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
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
  onSteerPrompt: (input: Omit<CodexSteerTurnInput, "threadId">) => Promise<void>;
  onInterruptTurn: (turnId?: string) => Promise<void>;
  onRespondApproval: (requestId: string, decision: CodexApprovalDecision) => Promise<void>;
  onRespondUserInput: (requestId: string, answers: Record<string, string[]>) => Promise<void>;
  onRespondMcpElicitation: (requestId: string, action: CodexMcpServerElicitationAction) => Promise<void>;
  onResolvePlanImplementationRequest: (threadId: string, turnId: string) => Promise<void>;
  onEnqueueQueuedFollowUp: (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null; promptInput?: CodexPromptInput },
  ) => Promise<void>;
  onRemoveQueuedFollowUp: (threadId: string, followUpId: string) => Promise<void>;
  onReorderQueuedFollowUps: (threadId: string, orderedFollowUpIds: string[]) => Promise<void>;
  onSendQueuedFollowUpNow: (threadId: string, followUpId: string) => Promise<void>;
  onEditQueuedFollowUp: (input: { threadId: string; followUpId: string; prompt: string }) => Promise<void>;
  onEditLastUserTurn: (input: { threadId: string; turnId: string; message: string }) => Promise<void>;
  onForkFromTurn: (input: { threadId: string; turnId: string; message: string }) => Promise<void>;
  onOpenTurnDiffReview: (target: CodexTurnDiffReviewTarget) => void;
  onConsumeComposerIntent: (threadId: string, focusNonce: number) => void;
  onOpenThread: (threadId: string) => void;
  onCleanBackgroundTerminals: (threadId: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
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

export interface ThreadOpenCardTarget {
  cardId: string;
  title: string;
  columnId: string | null;
}

export interface ThreadThinkingPlaceholderBlockModel {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "thinkingPlaceholder";
}

export interface ThreadTranscriptBlockModel {
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
    | "multiAgentAction"
    | "steered"
    | "workedFor"
    | "systemEvent"
    | "userInputResponse";
  entry: CodexConversationItem;
  status?: CodexConversationItem["status"];
  userMessageActions?: ThreadUserMessageActionsModel;
  assistantMessageActions?: ThreadAssistantMessageActionsModel;
  searchUnitKey?: string;
}

export interface ThreadUserAttachmentStripBlockModel {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "userAttachmentStrip";
  attachments: CodexUserAttachment[];
}

export interface ThreadWorkedForAdornmentModel {
  id: string;
  turnId: string;
  anchorBlockId: string;
  timeLabel: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadExplorationGroupBlockModel {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "explorationGroup";
  entries: CodexConversationItem[];
  summary: string;
  status?: CodexConversationItem["status"];
}

export interface ThreadMultiAgentGroupBlockModel {
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

export type ThreadCollapsedToolActivityEntryModel =
  | ThreadTranscriptBlockModel
  | ThreadExplorationGroupBlockModel;

export interface ThreadCollapsedToolActivitySummaryStats {
  createdFileCount: number;
  runningCreatedFileCount: number;
  stoppedCreatedFileCount: number;
  editedFileCount: number;
  runningEditedFileCount: number;
  deletedFileCount: number;
  runningDeletedFileCount: number;
  exploredFileCount: number;
  runningExploredFileCount: number;
  searchCount: number;
  runningSearchCount: number;
  listCount: number;
  runningListCount: number;
  commandCount: number;
  runningCommandCount: number;
  approvedRequestCount: number;
  deniedRequestCount: number;
  hookCount: number;
  runningHookCount: number;
  mcpToolCallCount: number;
  mcpToolCallSources: Array<{ name: string; count: number }>;
  webSearchCount: number;
  runningWebSearchCount: number;
}

export interface ThreadCollapsedToolActivityBlockModel {
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
  status?: CodexConversationItem["status"];
}

export interface ThreadPendingTurnRequestModel {
  id: string;
  turnId: string;
  createdAt: number;
  updatedAt: number;
  searchableText: string;
  type: "approval" | "userInput" | "implementPlan";
  request: CodexTurnScopedConversationRequest;
}

export type ThreadRendererItemModel =
  | ThreadTranscriptBlockModel
  | ThreadPendingTurnRequestModel;

export type ThreadAgentEntryModel =
  | ThreadTranscriptBlockModel
  | ThreadExplorationGroupBlockModel
  | ThreadMultiAgentGroupBlockModel
  | ThreadCollapsedToolActivityBlockModel;

export type ThreadBlockModel =
  | ThreadTranscriptBlockModel
  | ThreadAssistantActionsBlockModel
  | ThreadUserAttachmentStripBlockModel
  | ThreadExplorationGroupBlockModel
  | ThreadMultiAgentGroupBlockModel
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
  agentItems: ThreadTranscriptBlockModel[];
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
  agentBodyEntries: ThreadAgentEntryModel[];
  trailingBlocks: ThreadBlockModel[];
  blocks: ThreadBlockModel[];
  aboveComposerBlocks?: ThreadBlockModel[];
  workedForAdornment: ThreadWorkedForAdornmentModel | null;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  searchableText: string;
  searchUnits: ThreadSearchUnitModel[];
  hasRenderableAgentBodyEntries: boolean;
  defaultAgentBodyCollapsed: boolean;
  collapsedMessageCount: number;
}

export interface ThreadSearchUnitModel {
  key: string;
  turnId: string;
  text: string;
  blockType: "userMessage" | "assistantMessage";
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
  displayText: string;
  collaborationMode?: CodexCollaborationModeKind | null;
  pausedReason?: string | null;
}

export interface ThreadComposerShellBackgroundAgentRowModel {
  conversationId: string;
  displayName: string;
  actorName: string;
  status: "active" | "waiting" | "done";
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
  cardId: string | null;
  title: string;
  showSeparator: boolean;
  openCardTarget: ThreadOpenCardTarget | null;
  activeThreadCardColumnId: string | null;
  connection: CodexConnectionState;
  account: CodexAccountSnapshot | null;
}

export interface ThreadBodySurfaceModel {
  threadId: string | null;
  cwd: string | null;
  turns: CodexConversationTurn[];
  requests: CodexConversationServerRequest[];
  resumeState: CodexConversationResumeState | null;
  statusType: CodexThreadStatusType | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  body: ThreadBodyModel;
  parentTurns: readonly CodexConversationTurn[];
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  threadStartProgress: {
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
  header: ReactNode;
  body: ReactNode;
  footer: ReactNode;
}

export interface ThreadBodyUiStateOverrides {
  collapsedAgentBodyByTurnId?: Record<string, boolean>;
}

export interface ThreadOpenCardDataState {
  loading: boolean;
  card: Card | null;
}
