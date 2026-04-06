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
  CodexConversationItem,
  CodexConversationLiveRequest,
  CodexConversationResumeState,
  CodexMcpServerElicitationAction,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexModelOption,
  CodexPermissionMode,
  CodexThreadSummary,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexTurnDiffReviewTarget,
} from "../../lib/types";
import type { ComposerEnterBehavior } from "../../lib/composer-enter-behavior";
import type { CodexTurnScopedConversationRequest } from "./conversation-request-helpers";

export interface ThreadStageModelInput {
  projectId: string;
  projectWorkspacePath?: string | null;
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string;
    projectName: string;
    cardId: string;
    cardTitle: string;
    columnId: string;
    runInTarget?: CardRunInTarget;
  } | null;
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
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  dismissedPlanImplementationTurnIdByThread?: Record<string, string>;
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
}

export interface ThreadStageActions {
  onCollaborationModeChange: (mode: CodexCollaborationModeKind) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort: CodexReasoningEffort) => void;
  onPermissionModeChange: (mode: CodexPermissionMode) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onStartChatGptLogin: () => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onStartApiKeyLogin: (apiKey: string) => Promise<{ type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string }>;
  onCancelLogin: (loginId: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onStartThreadForCard: (input: { projectId: string; cardId: string; prompt: string }) => Promise<void>;
  onSendPrompt: (prompt: string, opts?: { collaborationMode?: CodexCollaborationModeKind }) => Promise<void>;
  onSteerPrompt: (turnId: string, prompt: string) => Promise<void>;
  onInterruptTurn: (turnId?: string) => Promise<void>;
  onRespondApproval: (requestId: string, decision: CodexApprovalDecision) => Promise<void>;
  onRespondUserInput: (requestId: string, answers: Record<string, string[]>) => Promise<void>;
  onRespondMcpElicitation: (requestId: string, action: CodexMcpServerElicitationAction) => Promise<void>;
  onResolvePlanImplementationRequest: (threadId: string, turnId: string) => void;
  onEnqueueQueuedFollowUp: (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null },
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
  canFork: boolean;
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
    | "workedFor"
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
    | "systemEvent"
    | "userInputResponse";
  entry: CodexConversationItem;
  status?: CodexConversationItem["status"];
  userMessageActions?: ThreadUserMessageActionsModel;
  showAssistantMessageActions?: boolean;
  searchUnitKey?: string;
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
  | ThreadMultiAgentGroupBlockModel;

export type ThreadBlockModel =
  | ThreadTranscriptBlockModel
  | ThreadExplorationGroupBlockModel
  | ThreadMultiAgentGroupBlockModel
  | ThreadThinkingPlaceholderBlockModel;

export interface ThreadTurnRenderBuckets {
  preUserItems: ThreadTranscriptBlockModel[];
  userItems: ThreadTranscriptBlockModel[];
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
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  searchableText: string;
  searchUnits: ThreadSearchUnitModel[];
  hasRenderableAgentBodyEntries: boolean;
  defaultAgentBodyCollapsed: boolean;
  collapsedMessageCount: number;
  workedForTimeLabel: string | null;
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
  dismissedPlanImplementationTurnId: string | null;
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

export interface ThreadStageModel {
  projectId: string;
  projectWorkspacePath?: string | null;
  conversation: CodexConversationSnapshot | null;
  resumeState: CodexConversationResumeState | null;
  activeTurn: CodexConversationTurn | null;
  isThreadRunning: boolean;
  isNewThreadTab: boolean;
  isCloudNewThreadTarget: boolean;
  newThreadTarget: ThreadStageModelInput["newThreadTarget"];
  threadStartProgress: ThreadStageModelInput["threadStartProgress"];
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
  title: string;
  openCardTarget: ThreadOpenCardTarget | null;
  activeThreadCardColumnId: string | null;
  body: ThreadBodyModel;
  composerShell: ThreadComposerShellModel;
}

export interface ThreadStageScreenProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  initialUiState?: ThreadBodyUiStateOverrides;
}

export interface ThreadBodyUiStateOverrides {
  collapsedAgentBodyByTurnId?: Record<string, boolean>;
}

export interface ThreadOpenCardDataState {
  loading: boolean;
  card: Card | null;
}
