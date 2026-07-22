import type {
  ApprovalsReviewer as CodexAppServerApprovalsReviewer,
  AdditionalContextEntry as CodexAppServerAdditionalContextEntry,
  AppInfo as CodexAppServerAppInfo,
  AskForApproval as CodexAppServerAskForApproval,
  CommandAction as CodexAppServerCommandAction,
  CommandExecutionRequestApprovalParams as CodexAppServerCommandExecutionRequestApprovalParams,
  ConsumeAccountRateLimitResetCreditOutcome as CodexAppServerRateLimitResetOutcome,
  ConsumeAccountRateLimitResetCreditParams as CodexAppServerRateLimitResetInput,
  DynamicToolCallOutputContentItem as CodexAppServerDynamicToolCallOutputContentItem,
  DynamicToolCallParams as CodexAppServerDynamicToolCallParams,
  DynamicToolCallResponse as CodexAppServerDynamicToolCallResponse,
  ExecPolicyAmendment as CodexAppServerExecPolicyAmendment,
  ExperimentalFeature as CodexAppServerExperimentalFeature,
  ListMcpServerStatusResponse as CodexAppServerListMcpServerStatusResponse,
  McpResourceReadParams as CodexAppServerMcpResourceReadParams,
  McpResourceReadResponse as CodexAppServerMcpResourceReadResponse,
  McpServerElicitationAction as CodexAppServerMcpServerElicitationAction,
  McpServerElicitationRequestResponse as CodexAppServerMcpServerElicitationRequestResponse,
  McpServerStatus as CodexAppServerMcpServerStatus,
  McpToolCallError as CodexAppServerMcpToolCallError,
  McpToolCallResult as CodexAppServerMcpToolCallResult,
  ModelSafetyBufferingUpdatedNotification as CodexAppServerModelSafetyBufferingUpdatedNotification,
  NetworkApprovalContext as CodexAppServerNetworkApprovalContext,
  NetworkPolicyAmendment as CodexAppServerNetworkPolicyAmendment,
  Model as CodexAppServerModel,
  PatchChangeKind as CodexAppServerPatchChangeKind,
  PermissionsRequestApprovalParams as CodexAppServerPermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse as CodexAppServerPermissionsRequestApprovalResponse,
  RateLimitResetCredit as CodexAppServerRateLimitResetCredit,
  RateLimitResetCreditsSummary as CodexAppServerRateLimitResetCreditsSummary,
  SandboxMode as CodexAppServerSandboxMode,
  SandboxPolicy as CodexAppServerSandboxPolicy,
  ReviewStartParams as CodexAppServerReviewStartParams,
  ReviewStartResponse as CodexAppServerReviewStartResponse,
  ReviewTarget as CodexAppServerReviewTarget,
  ReasoningEffortOption as CodexAppServerReasoningEffortOption,
  ThreadActiveFlag as CodexAppServerThreadActiveFlag,
  ThreadGoal as CodexAppServerThreadGoal,
  ThreadGoalClearParams as CodexAppServerThreadGoalClearParams,
  ThreadGoalSetParams as CodexAppServerThreadGoalSetParams,
  ThreadBackgroundTerminalsListParams as CodexAppServerThreadBackgroundTerminalsListParams,
  ThreadBackgroundTerminalsTerminateParams as CodexAppServerThreadBackgroundTerminalsTerminateParams,
  ThreadBackgroundTerminal as CodexAppServerThreadBackgroundTerminal,
  ThreadCompactStartParams as CodexAppServerThreadCompactStartParams,
  ThreadMemoryModeSetParams as CodexAppServerThreadMemoryModeSetParams,
  ThreadRollbackParams as CodexAppServerThreadRollbackParams,
  ThreadStatus as CodexAppServerThreadStatus,
  ThreadSettings as CodexAppServerThreadSettings,
  ThreadSource as CodexAppServerThreadSource,
  ThreadItem as CodexAppServerThreadItem,
  ThreadTokenUsage as CodexAppServerThreadTokenUsage,
  TokenUsageBreakdown as CodexAppServerTokenUsageBreakdown,
  TurnItemsView as CodexAppServerTurnItemsView,
  TurnSteerParams as CodexAppServerTurnSteerParams,
  UserInput as CodexAppServerUserInput,
  ToolRequestUserInputOption as CodexAppServerUserInputOption,
  TurnStatus as CodexAppServerTurnStatus,
} from "@nodex/codex-app-server-protocol/v2";
import type {
  CollaborationMode as CodexAppServerCollaborationMode,
  ModeKind as CodexAppServerModeKind,
  Personality as CodexAppServerPersonality,
  ReasoningEffort as CodexAppServerReasoningEffort,
  RequestId as CodexAppServerRequestId,
  ServerNotification as CodexAppServerServerNotification,
  ThreadMemoryMode as CodexAppServerThreadMemoryMode,
} from "@nodex/codex-app-server-protocol";
import type { AgentExecutionProfile } from "./agent-runtime";
import type { PortableRichText } from "./block-documents/portable-rich-text";
import type { ProjectLifecycle } from "./library";
import type {
  CodexApprovalResponse,
} from "./codex-approval-response";
import type {
  NodexAgentAuthorizationRequest,
} from "./nodex-agent-tools";
export type {
  NodexAgentAuthorizationRequest,
  NodexAgentAuthorizationResponse,
} from "./nodex-agent-tools";
import type {
  CodexCanonicalConversationState,
  CodexCanonicalOptionPickerRequest,
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalServerRequest,
  CodexCanonicalSetupContextPickerRequest,
  CodexProtocolServerRequestOf,
  CodexCanonicalSetupCodexStepResponse,
} from "./codex-conversation-state/codex-conversation-state";

export type {
  CodexCanonicalConversationState,
  CodexCanonicalHookRun,
  CodexCanonicalHydrationContext,
  CodexCanonicalHydratedAttachment,
  CodexCanonicalHydratedPermissionContext,
  CodexCanonicalHydratedProfileTurnParams,
  CodexCanonicalHydratedSandboxTurnParams,
  CodexCanonicalHydratedThreadSettings,
  CodexCanonicalItem,
  CodexCanonicalLiveTurnParams,
  CodexCanonicalMcpElicitation,
  CodexCanonicalMcpToolParamDisplay,
  CodexCanonicalOptionPickerRequest,
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalPlanImplementationRequest,
  CodexCanonicalProtocolItem,
  CodexCanonicalProtocolRequest,
  CodexCanonicalRequestSyntheticItem,
  CodexCanonicalResumedProfileTurnParams,
  CodexCanonicalServerRequest,
  CodexCanonicalServerRequestExtension,
  CodexCanonicalSetupContextPickerRequest,
  CodexCanonicalSetupContextPickerResponse,
  CodexCanonicalSetupCodexStepResponse,
  CodexCanonicalThreadProtocol,
  CodexCanonicalTurnSidecar,
  CodexCanonicalTurnParams,
  CodexCanonicalTurnProtocol,
  CodexCanonicalTurnState,
  CodexCanonicalUserInputAnswers,
  CodexCanonicalUserInputOption,
  CodexCanonicalUserInputQuestion,
  CodexCanonicalWorktreeInitItem,
  CodexCanonicalWorktreeInitSetup,
  CodexProtocolRequestId,
  CodexProtocolServerRequest,
  CodexProtocolServerRequestOf,
  CodexProtocolThreadItem,
  CodexProtocolThreadItemOf,
  CreateCodexCanonicalConversationStateOptions,
  CreateCodexCanonicalHydratedConversationStateOptions,
} from "./codex-conversation-state/codex-conversation-state";
export type {
  CodexApprovalResponse,
  CodexCommandApprovalDecision,
  CodexFileApprovalDecision,
} from "./codex-approval-response";

export type Priority =
  "p0-critical" | "p1-high" | "p2-medium" | "p3-low" | "p4-later";

export type Estimate = "xs" | "s" | "m" | "l" | "xl";
export type ResourceBlockKind = "text" | "file" | "folder";
export type ResourceBlockMode = "materialized" | "link";

export type PageRunInTarget = "localProject" | "newWorktree" | "cloud";
export type WorktreeStartMode = "autoBranch" | "detachedHead";

export {
  WORKFLOW_STATUS_COLUMNS,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STATUS_ORDER,
  DEFAULT_WORKFLOW_STATUS,
  type WorkflowStatus,
} from "./workflow-status";
import type { WorkflowStatus } from "./workflow-status";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type RecurrenceEndCondition =
  { type: "never" } | { type: "untilDate"; untilDate: string };

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekdays?: number[];
  endCondition?: RecurrenceEndCondition;
}

export interface ReminderConfig {
  offsetMinutes: number;
}

export type OccurrenceEditScope = "this" | "this-and-future" | "all";

export interface OccurrenceTimingUpdates {
  scheduledStart?: Date;
  scheduledEnd?: Date;
  isAllDay?: boolean;
  recurrence?: RecurrenceConfig | null;
  reminders?: ReminderConfig[];
  scheduleTimezone?: string | null;
}

export type OccurrenceActionSource =
  "calendar" | "page-detail" | "notification" | "api";

/** Calendar projection of one scheduled Page occurrence. */
export interface PageOccurrence extends DatabasePage {
  pageId: string;
  statusName: string;
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
  thisAndFutureEquivalentToAll?: boolean;
}

export interface PageOccurrenceActionInput {
  /** Stable logical identity for exact retry across transport/session loss. */
  operationId: string;
  pageId: string;
  occurrenceStart: Date;
  source: OccurrenceActionSource;
}

export interface PageOccurrenceCompleteInput extends PageOccurrenceActionInput {
  /** Preallocated identity for the archived Page created by completion. */
  createdPageId: string;
}

export type PageOccurrenceUpdateInput = PageOccurrenceActionInput &
  (
    | {
        scope: "all";
        createdPageId?: never;
        updates: OccurrenceTimingUpdates;
      }
    | {
        scope: Exclude<OccurrenceEditScope, "all">;
        /** Preallocated identity if this command needs to detach or split a Page. */
        createdPageId: string;
        updates: OccurrenceTimingUpdates;
      }
  );

/** Compatibility projection for one Page row in a Database View. */
export interface DatabasePage {
  id: string;
  status: WorkflowStatus;
  archived: boolean;
  title: string;
  /** Canonical collaborative title authority; title is its plain-text projection. */
  richTitle: PortableRichText;
  description: string;
  priority?: Priority;
  estimate?: Estimate;
  tags: string[];
  dueDate?: Date;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  isAllDay?: boolean;
  recurrence?: RecurrenceConfig;
  reminders?: ReminderConfig[];
  scheduleTimezone?: string;
  assignee?: string;
  runInTarget?: PageRunInTarget;
  runInLocalPath?: string;
  runInBaseBranch?: string;
  runInWorktreePath?: string;
  runInEnvironmentPath?: string;
  revision?: number;
  created: Date;
  order: number;
}

export interface DatabasePageSummary extends Omit<DatabasePage, "description"> {
  descriptionPreview: string;
  descriptionLength: number;
  hasDescription: boolean;
}

export interface Column {
  id: WorkflowStatus;
  name: string;
  cards: DatabasePage[];
}

export interface Board {
  columns: Column[];
}

export interface BoardSummaryColumn {
  id: WorkflowStatus;
  name: string;
  cards: DatabasePageSummary[];
}

export interface BoardSummary {
  columns: BoardSummaryColumn[];
}

export interface BoardSummarySnapshot {
  readonly projectId: string;
  readonly libraryId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly board: BoardSummary;
}

export interface PageInput {
  status?: WorkflowStatus;
  title: string;
  description?: string;
  priority?: Priority | null;
  estimate?: Estimate | null;
  tags?: string[];
  dueDate?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  isAllDay?: boolean | null;
  recurrence?: RecurrenceConfig | null;
  reminders?: ReminderConfig[];
  scheduleTimezone?: string | null;
  assignee?: string;
  runInTarget?: PageRunInTarget;
  runInLocalPath?: string | null;
  runInBaseBranch?: string | null;
  runInWorktreePath?: string | null;
  runInEnvironmentPath?: string | null;
}

export interface PageCreateInput extends PageInput {
  id?: string;
}

export type PageUpdateField = keyof PageInput;

export type PageUpdateResult =
  | {
      status: "updated";
      projectId: string;
      pageId: string;
      revision: number;
      summary: DatabasePageSummary;
      changedFields: PageUpdateField[];
      didMutate: boolean;
    }
  | {
      status: "conflict";
      page: DatabasePage;
    }
  | {
      status: "not_found";
    };

export interface DatabaseRowsDetailsInput {
  pageIds: string[];
}

export interface PageSearchInput {
  /** Project access contexts whose effective grants define the search scope. */
  projectIds: string[];
  query: string;
  limit?: number;
}

export interface PageSearchResult {
  /** Project access context that authorized this result. */
  projectId: string;
  pageId: string;
  status: WorkflowStatus;
  score: number;
  excerpt: string;
}

export interface CommandPaletteThreadSummary {
  threadId: string;
  sessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  title: string;
  preview: string;
  cwd: string | null;
  gitBranch: string | null;
  projectless: boolean;
  pinned: boolean;
  pinnedOrder: number | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  createdAt: number;
  updatedAt: number;
}

export interface CommandPaletteThreadListInput {
  scope: "sidebar";
}

export interface CommandPaletteThreadSearchInput {
  query: string;
  limit?: number;
}

export interface CommandPaletteThreadSearchResult {
  thread: CommandPaletteThreadSummary;
  snippet: string;
}

export type PageCreatePlacement =
  | "top"
  | "bottom"
  | { readonly beforePageId: string };

export interface MovePageInput {
  pageId: string;
  fromStatus?: WorkflowStatus;
  toStatus: WorkflowStatus;
  // Insertion index after removing the dragged card from the target column.
  newOrder?: number;
  fieldPatch?: Pick<Partial<PageInput>, "priority" | "estimate">;
  groupId?: string;
}

export interface MovePagesInput {
  pageIds: string[];
  fromStatus?: WorkflowStatus;
  toStatus: WorkflowStatus;
  // Insertion index after removing the dragged cards from the target column.
  newOrder?: number;
  fieldPatch?: Pick<Partial<PageInput>, "priority" | "estimate">;
  groupId?: string;
}

export interface ProjectSource {
  root: string;
  order: number;
}

export interface Project {
  id: string;
  libraryId: string;
  databaseId: string;
  lifecycle: ProjectLifecycle;
  bindingRevision: number;
  name: string;
  description: string;
  icon?: string;
  sources: ProjectSource[];
  primaryWorkspaceRoot: string | null;
  pinned: boolean;
  pinnedOrder: number | null;
  created: Date;
  updated: Date;
}

export interface ProjectCreateInput {
  name?: string;
  description?: string;
  icon?: string;
  sources?: string[];
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  icon?: string;
  sources?: string[];
}

export interface ProjectLifecycleInput {
  lifecycle: ProjectLifecycle;
}

export interface ProjectOrderInput {
  orderedProjectIds: string[];
}

export interface ProjectPinnedInput {
  pinned: boolean;
}

export interface ProjectPinnedOrderInput {
  orderedProjectIds: string[];
}

export type ProjectSessionDbView =
  "kanban" | "list" | "toggle-list" | "canvas" | "calendar";

export type ProjectSessionTabKind =
  "db_view" | "page_stage" | "terminal" | "browser" | "review" | "files";

export const PROJECT_SESSION_SINGLETON_TAB_KINDS = [
  "review",
] as const satisfies readonly ProjectSessionTabKind[];

export type ProjectSessionSingletonTabKind =
  (typeof PROJECT_SESSION_SINGLETON_TAB_KINDS)[number];

export interface ProjectSessionDbViewTabConfig {
  projectId: string;
  /**
   * Durable Database View identity. This is optional only at the input type
   * boundary while persisted pre-Block-first overview configs are normalized;
   * ProjectSession storage always resolves and returns it.
   */
  databaseViewId?: string;
  /** Window presentation mode. It never participates in tab identity. */
  view: ProjectSessionDbView;
}

export interface ProjectSessionPageStageTabConfig {
  projectId: string;
  pageId: string;
  titleSnapshot?: string;
}

export interface ProjectSessionTerminalTabConfig {
  terminalSessionId: string;
}

export type TerminalBackendKind = "local" | "remote";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalCreateRequest {
  sessionId: string;
  conversationId?: string | null;
  projectSessionId?: string | null;
  cwd?: string | null;
  size: TerminalSize;
  backendKind?: TerminalBackendKind;
  title?: string | null;
}

export interface TerminalAttachRequest {
  sessionId: string;
  conversationId?: string | null;
  projectSessionId?: string | null;
  cwd?: string | null;
  size: TerminalSize;
}

export interface TerminalRunActionRequest {
  sessionId: string;
  conversationId?: string | null;
  projectSessionId?: string | null;
  cwd?: string | null;
  command: string;
  title?: string | null;
  size?: TerminalSize | null;
}

export interface TerminalSessionSnapshot {
  sessionId: string;
  conversationId: string | null;
  projectSessionId: string | null;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: bigint | null;
  childProcessCount: number | null;
  processMetricsSampledAtMs: number | null;
  cwd: string | null;
  shell: string | null;
  title: string | null;
  backendKind: TerminalBackendKind;
  buffer: string;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
}

export interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

export interface TerminalInitLogEvent {
  sessionId: string;
  data: string;
  snapshot: TerminalSessionSnapshot;
}

export interface TerminalAttachedEvent {
  sessionId: string;
  snapshot: TerminalSessionSnapshot;
}

export interface TerminalErrorEvent {
  sessionId: string;
  message: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number | null;
}

export interface ProjectSessionProjectScopedTabConfig {
  projectId: string;
}

export interface ProjectSessionFilesTabConfig {
  projectId: string | null;
  hostId: "local";
  workspaceRoot: string | null;
  cwd: string | null;
  path?: string;
}

export interface ProjectSessionBrowserTabConfig {
  projectId: string | null;
  url?: string;
  title?: string;
  faviconUrl?: string;
  deviceToolbarVisible?: boolean;
}

export type ProjectSessionTabConfig =
  | ProjectSessionDbViewTabConfig
  | ProjectSessionPageStageTabConfig
  | ProjectSessionTerminalTabConfig
  | ProjectSessionBrowserTabConfig
  | ProjectSessionFilesTabConfig
  | ProjectSessionProjectScopedTabConfig;

export type WorkspaceFileHostId = "local";

export interface WorkspaceFileDirectoryEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  isSymlink: boolean;
}

export interface WorkspaceDirectoryEntriesInput {
  hostId?: WorkspaceFileHostId;
  workspaceRoot: string;
  directoryPath?: string;
  includeHidden?: boolean;
  directoriesOnly?: boolean;
}

export interface WorkspaceDirectoryEntriesResult {
  directoryPath: string;
  parentPath: string | null;
  entries: WorkspaceFileDirectoryEntry[];
}

export interface WorkspaceFileRequest {
  hostId?: WorkspaceFileHostId;
  path: string;
}

export interface WorkspaceFileMetadataInput extends WorkspaceFileRequest {
  contentSampleByteLimit?: number;
  contentSampleMaxFileBytes?: number;
}

export interface WorkspaceFileReadResult {
  contents: string;
}

export interface WorkspaceFileBinaryReadResult {
  contentsBase64: string | null;
  mimeType?: string;
}

export interface WorkspaceFileMetadata {
  isFile: boolean;
  createdAtMs: number | null;
  mtimeMs: number | null;
  sizeBytes: number | null;
  contentKind?: "text" | "binary";
}

export interface WorkspaceFileWriteInput extends WorkspaceFileRequest {
  content: string;
  expectedMtimeMs: number | null;
}

export type WorkspaceFileWriteResult =
  | { outcome: "saved"; mtimeMs: number | null }
  | { outcome: "conflict"; mtimeMs: number | null };

export interface ProjectSessionSplitLeaf {
  type: "leaf";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
  mruTabIds: string[];
}

export interface ProjectSessionSplitBranch {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  first: ProjectSessionPanelNode;
  second: ProjectSessionPanelNode;
  ratio: number;
}

export type ProjectSessionPanelNode =
  ProjectSessionSplitLeaf | ProjectSessionSplitBranch;

export interface ProjectSessionPanelLayoutV2 {
  version: 2;
  root: ProjectSessionPanelNode;
  activeLeafId: string;
  mruLeafIds: string[];
  maximizedLeafId?: string | null;
}

export type ProjectSessionPanelLayout = ProjectSessionPanelLayoutV2;

export type PanelId = "right" | "bottom";
export type ProjectSessionPanelSplitSide = "left" | "right" | "up" | "down";

export interface ProjectSessionPanelSize {
  widthPx?: number;
  heightPx?: number;
  fullWidth?: boolean;
}

export interface ProjectSessionPanelState {
  collapsed: boolean;
  layout: ProjectSessionPanelLayout;
  size: ProjectSessionPanelSize;
}

export interface ProjectSessionTab {
  id: string;
  sessionId: string;
  projectId: string | null;
  browserTabId: string | null;
  panelId: PanelId;
  kind: ProjectSessionTabKind;
  title: string;
  order: number;
  config: ProjectSessionTabConfig;
  stateKey: number;
  state: unknown;
  createdAt: string;
  updatedAt: string;
}

export type ProjectSessionBrowserTab = ProjectSessionTab & {
  browserTabId: string;
  kind: "browser";
  config: ProjectSessionBrowserTabConfig;
};

export interface ProjectSessionThreadLink {
  sessionId: string;
  projectId: string | null;
  threadId: string;
  forkedFromId?: string | null;
  parentThreadId?: string;
  threadName?: string;
  threadPreview: string;
  modelProvider: string;
  executionProfile?: AgentExecutionProfile | null;
  cwd?: string;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export interface ProjectSession {
  id: string;
  projectId: string | null;
  noThreadFallbackTitle: string;
  displayTitle: string;
  order: number;
  pinned: boolean;
  pinnedOrder: number | null;
  archived: boolean;
  archivedAt: string | null;
  unread: boolean;
  leftPaneCollapsed: boolean;
  panels: Record<PanelId, ProjectSessionPanelState>;
  thread: ProjectSessionThreadLink | null;
  tabs: ProjectSessionTab[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectSessionSummary = Omit<ProjectSession, "panels" | "tabs">;

export interface ProjectSessionCreateInput {
  projectId: string | null;
  noThreadFallbackTitle: string;
}

export interface ProjectSessionListOptions {
  includeArchived?: boolean;
}

export interface ProjectSessionUpdateInput {
  noThreadFallbackTitle?: string;
  leftPaneCollapsed?: boolean;
  panels?: Partial<Record<PanelId, Partial<ProjectSessionPanelState>>>;
}

export interface ProjectSessionRenameInput {
  title: string;
}

export interface ProjectSessionPinnedInput {
  pinned: boolean;
}

export interface ProjectSessionPinnedOrderInput {
  orderedSessionIds: string[];
}

export interface ProjectSessionUnreadInput {
  unread: boolean;
}

export type ProjectSessionForkTarget = "local" | "newWorktree";

export interface ProjectSessionForkInput {
  target: ProjectSessionForkTarget;
  localEnvironmentConfigPath?: string | null;
  turnId?: string;
  message?: string;
  collaborationMode?: CodexCollaborationModeKind;
}

export interface ProjectSessionReadyForkResult {
  session: ProjectSession;
  threadId: string;
  composerIntent?: CodexComposerIntent;
}

export interface ProjectSessionPendingForkResult {
  pendingWorktreeId: string;
  clientThreadId: string;
}

export type ProjectSessionForkResult =
  | ProjectSessionReadyForkResult
  | ProjectSessionPendingForkResult;

export interface ProjectSessionTabCreateInput {
  sessionId: string;
  panelId: PanelId;
  targetLeafId?: string;
  clientTabId?: string;
  browserTabId?: string;
  kind: ProjectSessionTabKind;
  title: string;
  config: ProjectSessionTabConfig;
}

export interface ProjectSessionTabUpdateInput {
  title?: string;
  config?: ProjectSessionTabConfig;
  stateKey?: number;
  state?: unknown;
}

export interface ProjectSessionTabDeleteInput {
  tabId: string;
  preserveEmptyLeafIds?: string[];
  preferredActiveLeafId?: string | null;
  preferredActiveTabId?: string | null;
}

export interface ProjectSessionTabReorderInput {
  sessionId: string;
  panelId: PanelId;
  leafId?: string;
  orderedTabIds: string[];
}

export interface ProjectSessionTabMoveInput {
  tabId: string;
  targetPanelId: PanelId;
  targetLeafId?: string;
  targetIndex?: number;
  preserveEmptyLeafIds?: string[];
  splitTarget?: {
    leafId: string;
    side: ProjectSessionPanelSplitSide;
  };
}

export interface ProjectSessionPanelSplitInput {
  sessionId: string;
  panelId: PanelId;
  leafId: string;
  side: ProjectSessionPanelSplitSide;
  tabId?: string;
  preserveEmptyLeafIds?: string[];
}

export interface ProjectSessionPanelEnsureRightLeafInput {
  sessionId: string;
  panelId: PanelId;
  sourceLeafId: string;
}

export interface ProjectSessionPanelEnsureRightLeafResult {
  session: ProjectSession;
  leafId: string;
  created: boolean;
}

export interface ProjectSessionPanelMergeInput {
  sessionId: string;
  panelId: PanelId;
  leafId: string;
}

export interface ProjectSessionPanelActivateInput {
  sessionId: string;
  panelId: PanelId;
  leafId: string;
  tabId?: string | null;
}

export interface ProjectSessionPanelResizeInput {
  sessionId: string;
  panelId: PanelId;
  branchId: string;
  ratio: number;
}

export interface ProjectSessionPanelMaximizeInput {
  sessionId: string;
  panelId: PanelId;
  leafId: string | null;
}

export interface ProjectSessionThreadLinkInput {
  sessionId: string;
  projectId: string | null;
  threadId: string;
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  threadSource?: CodexAppServerThreadSource | null;
  serviceName?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  agentPath?: string | null;
  threadName?: string | null;
  threadPreview?: string;
  modelProvider?: string;
  executionProfile?: AgentExecutionProfile | null;
  cwd?: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
  statusType?: CodexThreadStatusType;
  statusActiveFlags?: CodexThreadActiveFlag[];
  archived?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type CodexSidebarThreadKind = "local" | "remote" | "pending-worktree";

export interface CodexSidebarThreadItem {
  key: string;
  kind: CodexSidebarThreadKind;
  pendingWorktreeId?: string;
  clientThreadId?: string;
  pinnedBeforeThreadId?: string | null;
  hostId: string;
  threadId: string;
  sessionId: string | null;
  projectId: string | null;
  title: string;
  preview: string;
  cwd: string | null;
  updatedAt: number;
  createdAt: number;
  pinned: boolean;
  pinnedOrder: number | null;
  unread: boolean;
  needsAttention?: boolean;
  archived: boolean;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  projectless: boolean;
  disabled: boolean;
}

export interface CodexSidebarSnapshot {
  items: CodexSidebarThreadItem[];
  pinnedThreadIds: string[];
  projectAssignments: Record<string, string>;
  projectlessThreadIds: string[];
  projectThreadOrders: Record<string, string[]>;
  projectlessThreadOrder: string[] | null;
  revision?: number;
  generatedAt: number;
}

export type CodexSidebarRefreshReason =
  | "mount"
  | "focus"
  | "heartbeat"
  | "host-message"
  | "project-change"
  | "session-change"
  | "manual"
  | "app-server-reconnect";

export type CodexSidebarRefreshPolicy = "read" | "stale" | "force";

export interface CodexSidebarSyncResult {
  snapshot: CodexSidebarSnapshot;
  source: "core" | "app-server";
  refreshed: boolean;
  refreshedAt: number;
  changedProjectIds: string[];
  projectlessChanged: boolean;
  materializedSessionIds: string[];
  failedThreadIds: string[];
}

export interface UploadedResourceAsset {
  source: string;
  name: string;
  mimeType: string;
  bytes: number;
}

export interface ClipboardPasteInspectionItem {
  path: string;
  kind: Exclude<ResourceBlockKind, "text">;
  name: string;
  mimeType?: string;
  bytes?: number;
}

export interface ClipboardPasteInspectionResult {
  items: ClipboardPasteInspectionItem[];
}

export interface ClipboardPastePayload {
  blocknoteHtml?: string;
  html?: string;
  markdown?: string;
  text?: string;
}

export type BackupTrigger = "manual" | "auto" | "pre-restore";

export interface BackupRecord {
  version: number;
  id: string;
  createdAt: string;
  trigger: BackupTrigger;
  label: string | null;
  includesAssets: boolean;
  dbBytes: number;
  assetsBytes: number;
  totalBytes: number;
}

export interface CreateBackupInput {
  trigger?: BackupTrigger;
  label?: string;
}

export interface BackupSettingsEnvOverrides {
  autoEnabled: boolean;
  intervalHours: boolean;
  retentionCount: boolean;
}

export interface HistorySettingsEnvOverrides {
  retentionCount: boolean;
}

export interface DiagnosticsSettingsEnvOverrides {
  enabled: boolean;
  dsn: boolean;
  environment: boolean;
  release: boolean;
  tracesSampleRate: boolean;
  replayEnabled: boolean;
  replaysSessionSampleRate: boolean;
  replaysOnErrorSampleRate: boolean;
}

export interface TelemetrySettingsEnvOverrides {
  enabled: boolean;
  clientKey: boolean;
  environment: boolean;
  autoCaptureEnabled: boolean;
}

export interface ManagedWorktreeRecord {
  threadId: string;
  projectId: string;
  projectName: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  threadName: string | null;
  path: string;
  exists: boolean;
  linkedAt: string;
}

export type WorktreeEnvironmentPlatform = "darwin" | "linux" | "win32";

export type WorktreeEnvironmentActionIcon = "tool" | "run" | "debug" | "test";

export interface WorktreeEnvironmentOption {
  path: string;
  name: string;
  hasSetupScript: boolean;
  hasCleanupScript: boolean;
  actionCount: number;
}

export interface WorktreeEnvironmentActionDefinition {
  id: string;
  name: string;
  icon: WorktreeEnvironmentActionIcon;
  command: string;
  platform: WorktreeEnvironmentPlatform | null;
}

export interface WorktreeEnvironmentScriptDefinition {
  script: string | null;
  platformScripts: Partial<Record<WorktreeEnvironmentPlatform, string>>;
}

export interface WorktreeEnvironmentDefinition {
  version: number;
  name: string;
  setup: WorktreeEnvironmentScriptDefinition;
  cleanup: WorktreeEnvironmentScriptDefinition;
  actions: WorktreeEnvironmentActionDefinition[];
}

export type WorktreeEnvironmentConfigState =
  "success" | "parseError" | "readError";

export interface WorktreeEnvironmentConfigRecord {
  configPath: string;
  fileName: string;
  state: WorktreeEnvironmentConfigState;
  exists: boolean;
  name: string;
  hasSetupScript: boolean;
  hasCleanupScript: boolean;
  actionCount: number;
  parseErrorMessage: string | null;
  readErrorMessage: string | null;
  environment: WorktreeEnvironmentDefinition | null;
}

export interface WorktreeEnvironmentSettingsSnapshot {
  projectId: string;
  projectName: string;
  workspacePath: string;
  configPath: string;
  nextConfigPath: string;
  configExists: boolean;
  configs: WorktreeEnvironmentConfigRecord[];
  environment: WorktreeEnvironmentDefinition | null;
  parseErrorMessage: string | null;
  readErrorMessage: string | null;
}

export interface UpdateWorktreeEnvironmentConfigInput {
  projectId: string;
  configPath: string;
  environment: WorktreeEnvironmentDefinition;
}

export interface BackupSettings {
  autoEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
  envOverrides: BackupSettingsEnvOverrides;
}

export interface UpdateBackupSettingsInput {
  autoEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
}

export interface HistorySettings {
  retentionCount: number;
  envOverrides: HistorySettingsEnvOverrides;
}

export interface UpdateHistorySettingsInput {
  retentionCount: number;
}

export interface DiagnosticsSettings {
  enabled: boolean;
  dsn: string;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  replayEnabled: boolean;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  envOverrides: DiagnosticsSettingsEnvOverrides;
}

export interface UpdateDiagnosticsSettingsInput {
  enabled: boolean;
  dsn: string;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  replayEnabled: boolean;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
}

export interface TelemetrySettings {
  enabled: boolean;
  clientKey: string;
  environment: string;
  autoCaptureEnabled: boolean;
  envOverrides: TelemetrySettingsEnvOverrides;
}

export interface UpdateTelemetrySettingsInput {
  enabled: boolean;
  clientKey: string;
  environment: string;
  autoCaptureEnabled: boolean;
}

export type ThreadNotificationTurnMode = "off" | "unfocused" | "always";

export interface ThreadNotificationSettings {
  turnMode: ThreadNotificationTurnMode;
  permissionsEnabled: boolean;
  questionsEnabled: boolean;
}

export interface UpdateThreadNotificationSettingsInput {
  turnMode: ThreadNotificationTurnMode;
  permissionsEnabled: boolean;
  questionsEnabled: boolean;
}

export type DesktopNotificationKind =
  "turn-complete" | "permission" | "question";

export interface DesktopNotificationAction {
  id: string;
  title: string;
  actionType: "approve" | "approve-for-session" | "decline";
}

export interface DesktopNotificationPayload {
  id: string;
  kind: DesktopNotificationKind;
  title: string;
  body: string;
  conversationId?: string;
  requestId?: CodexAppServerRequestId;
  approvalKind?: CodexApprovalKind;
  actions?: DesktopNotificationAction[];
  replyPlaceholder?: string;
}

export interface DesktopNotificationActionPayload {
  notificationId: string;
  actionId: string | null;
  actionType: "open" | "reply" | "approve" | "approve-for-session" | "decline";
  reply?: string;
}

export interface AppUpdateSettings {
  automaticChecksEnabled: boolean;
}

export interface UpdateAppUpdateSettingsInput {
  automaticChecksEnabled: boolean;
}

export type {
  UpdateWindowRestoreSettingsInput,
  WindowRestorePolicy,
  WindowRestoreSettings,
} from "./window-session";

export type AppUpdateStatusKind =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "upToDate"
  | "error";

export interface AppUpdateStatus {
  status: AppUpdateStatusKind;
  supported: boolean;
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  checkedAt: string | null;
  message: string | null;
}

export interface RestoreBackupInput {
  backupId: string;
  confirm: boolean;
  createSafetyBackup?: boolean;
}

export interface RestoreBackupResult {
  success: boolean;
  restoredBackupId: string;
  safetyBackupId?: string;
}

export type CodexThreadStatusType = CodexAppServerThreadStatus["type"];
export type CodexThreadActiveFlag = CodexAppServerThreadActiveFlag;
export type CodexThreadRuntimeStatus = CodexAppServerThreadStatus;

export interface CodexConnectionState {
  status: "starting" | "connected" | "disconnected" | "missingBinary" | "error";
  message?: string;
  retries: number;
  lastConnectedAt?: number;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface CodexRateLimitCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface CodexRateLimitsSnapshot {
  limitId?: string;
  limitName?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  credits?: CodexRateLimitCredits;
  planType?: string;
}

export type CodexRateLimitResetCredit = CodexAppServerRateLimitResetCredit;
export type CodexRateLimitResetInput = CodexAppServerRateLimitResetInput;
export type CodexRateLimitResetOutcome = CodexAppServerRateLimitResetOutcome;

export type CodexRateLimitResetCreditsSummary = Omit<
  CodexAppServerRateLimitResetCreditsSummary,
  "availableCount" | "credits"
> & {
  /** JSON-RPC transports expose the protocol's integer count as a JavaScript number. */
  availableCount: number;
  credits: CodexRateLimitResetCredit[] | null;
};

export type CodexAccountIdentity =
  { type: "apiKey" } | { type: "chatgpt"; email: string; planType: string };

export interface CodexAccountSnapshot {
  account: CodexAccountIdentity | null;
  requiresOpenAiAuth: boolean;
  pendingLogin?: {
    loginId: string;
    authUrl: string;
  } | null;
  rateLimits?: CodexRateLimitsSnapshot | null;
  rateLimitResetCredits?: CodexRateLimitResetCreditsSummary | null;
}

export interface CodexRateLimitResetResult {
  outcome: CodexRateLimitResetOutcome;
  account: CodexAccountSnapshot;
}

export interface CodexDictationStateSnapshot {
  isEnabled: boolean;
  authMethod: "chatgpt" | "apiKey" | null;
  isRealtimeVoiceActive: boolean;
  shortcutLabel: string;
}

export interface CodexConversationImageAssetResolveInput {
  hostId: string;
  pointer: string;
}

export type CodexConversationImageAssetResolveResult =
  | {
      ok: true;
      dataBase64: string;
      mimeType: string | null;
    }
  | {
      ok: false;
      message: string;
      status: number | null;
    };

export interface CodexThreadSummary {
  threadId: string;
  projectId: string | null;
  forkedFromId?: string | null;
  source: CodexConversationSource | null;
  ephemeral?: boolean;
  threadSource?: CodexAppServerThreadSource | null;
  serviceName?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  /** Source-derived AgentControl path used to distinguish modern inline subagents. */
  agentPath?: string | null;
  threadName: string | null;
  threadPreview: string;
  modelProvider: string;
  executionProfile?: AgentExecutionProfile | null;
  cwd: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: CodexApprovalsReviewer | null;
  sandbox?: CodexSandboxPolicy | null;
  latestTokenUsageInfo?: CodexThreadTokenUsage | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  threadRuntimeStatus?: CodexThreadRuntimeStatus | null;
  archived: boolean;
  pinned?: boolean;
  hasUnreadTurn?: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export type CodexScheduledAutomationKind = "cron" | "heartbeat";
export type CodexScheduledAutomationStatus = "ACTIVE" | "PAUSED" | "DELETED";
export type CodexScheduledAutomationExecutionEnvironment = "local" | "worktree";
export type CodexScheduledAutomationReasoningEffort = string;

export interface CodexScheduledAutomation {
  id: string;
  definitionRevision: number;
  kind: CodexScheduledAutomationKind;
  status: CodexScheduledAutomationStatus;
  targetThreadId: string | null;
  name: string;
  prompt: string;
  rrule: string | null;
  model: string | null;
  modelProvider: string | null;
  harnessId: string | null;
  reasoningEffort: CodexScheduledAutomationReasoningEffort | null;
  serviceTier: string | null;
  cwds: string[];
  executionEnvironment: CodexScheduledAutomationExecutionEnvironment;
  localEnvironmentConfigPath: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodexScheduledAutomationCreateInput {
  kind: CodexScheduledAutomationKind;
  targetThreadId?: string | null;
  name: string;
  prompt?: string | null;
  rrule?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  harnessId?: string | null;
  reasoningEffort?: CodexScheduledAutomationReasoningEffort | null;
  serviceTier?: string | null;
  cwds?: string[];
  executionEnvironment?: CodexScheduledAutomationExecutionEnvironment | null;
  localEnvironmentConfigPath?: string | null;
}

export interface CodexScheduledAutomationUpdateInput extends CodexScheduledAutomationCreateInput {
  id: string;
  status: CodexScheduledAutomationStatus;
}

export interface CodexScheduledAutomationListResponse {
  items: CodexScheduledAutomation[];
}

export type CodexScheduledAutomationDeleteStatus =
  | "store_unavailable"
  | "invalid_id"
  | "state_cleanup_failed"
  | "remove_failed"
  | "deleted"
  | "not_found";

export interface CodexScheduledAutomationDeleteResult {
  status: CodexScheduledAutomationDeleteStatus;
}

export interface CodexScheduledAutomationDeleteInput {
  id: string;
}

export interface CodexScheduledAutomationDeleteResponse {
  item: CodexScheduledAutomation | null;
  success: boolean;
  status: CodexScheduledAutomationDeleteStatus;
}

export interface CodexScheduledAutomationMutationResponse {
  item: CodexScheduledAutomation;
}

export interface CodexScheduledAutomationRunNowInput {
  id: string;
  collaborationMode?: CodexHeartbeatAutomationCollaborationMode | null;
  permissions?: CodexHeartbeatAutomationPermissions | null;
}

export interface CodexScheduledAutomationRunNowResponse {
  success: boolean;
}

export interface CodexHeartbeatAutomationsEnabledChangedInput {
  enabled: boolean;
}

export interface CodexHeartbeatAutomationThreadStateChangedInput {
  threadId: string;
  streamRole: "owner" | "follower" | null;
  isEligible: boolean;
  reason?: string | null;
  collaborationMode?: CodexHeartbeatAutomationCollaborationMode | null;
  permissions?: CodexHeartbeatAutomationPermissions | null;
}

export interface CodexAutomationRunArchiveInput {
  threadId: string;
  archivedAssistantMessage?: string | null;
  archivedUserMessage?: string | null;
  archivedReason?: string | null;
}

export interface CodexAutomationRunDeleteInput {
  threadId: string;
}

export interface CodexAutomationRunUnarchiveInput {
  threadId: string;
}

export interface CodexAutomationRunMutationResponse {
  success: boolean;
}

export type CodexAutomationRunStatus =
  | "IN_PROGRESS"
  | "PENDING_REVIEW"
  | "ACCEPTED"
  | "ARCHIVED";

export interface CodexAutomationRun {
  threadId: string;
  automationId: string;
  status: CodexAutomationRunStatus;
  readAt: number | null;
  threadTitle: string | null;
  sourceCwd: string | null;
  inboxTitle: string | null;
  inboxSummary: string | null;
  archivedUserMessage: string | null;
  archivedAssistantMessage: string | null;
  archivedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodexAutomationInboxItem {
  id: string;
  automationId: string;
  automationName: string | null;
  title: string | null;
  description: string | null;
  archivedAssistantMessage: string | null;
  archivedUserMessage: string | null;
  archivedReason: string | null;
  sourceCwd: string | null;
  threadId: string;
  readAt: number | null;
  createdAt: number;
  status: CodexAutomationRunStatus;
}

export interface CodexAutomationRunUnreadCounts {
  total: number;
  automationIds: string[];
  unreadRuns: Array<{
    automationId: string;
    threadId: string;
  }>;
}

export interface CodexAutomationRunsInboxResponse {
  items: CodexAutomationInboxItem[];
  unreadRunCounts: CodexAutomationRunUnreadCounts;
}

export interface CodexAutomationRunReadStateInput {
  threadId: string;
  readAt: number | null;
}

export interface CodexAutomationRunMarkAllReadInput {
  readAt: number;
}

export interface CodexAutomationRunMarkAllReadResponse {
  changedCount: number;
}

export interface CodexScheduledAutomationChangedEvent {
  automationId: string;
  targetThreadId: string | null;
  reason: "upsert" | "delete";
}

export interface CodexAutomationRunsUpdatedEvent {
  automationId?: string | null;
  threadId?: string | null;
  reason:
    | "archive"
    | "accepted"
    | "delete"
    | "mark-all-read"
    | "pending-insert"
    | "pending-replace"
    | "read-state"
    | "settle"
    | "turn-completed"
    | "unarchive";
}

export type CodexConversationResumeState =
  "needs_resume" | "resuming" | "resumed";

export interface CodexConversationSource {
  parentThreadId: string | null;
  sideConversation?: boolean;
  sideConversationParentNavigationPath?: string | null;
}

export type CodexReasoningEffort = CodexAppServerReasoningEffort;
export type CodexThreadDetailLevel =
  "STEPS_PROSE" | "STEPS_COMMANDS" | "STEPS_EXECUTION";
export interface CodexDeveloperInstructionSettings {
  detailLevel: CodexThreadDetailLevel;
}
export interface UpdateCodexDeveloperInstructionSettingsInput {
  detailLevel: CodexThreadDetailLevel;
}
export interface CodexGitSettings {
  branchPrefix: string;
  commitInstructions: string;
  pullRequestInstructions: string;
}
export interface UpdateCodexGitSettingsInput {
  branchPrefix?: string;
  commitInstructions?: string;
  pullRequestInstructions?: string;
}
export type CodexServiceTier = CodexAppServerThreadSettings["serviceTier"];
export type CodexApprovalPolicy = CodexAppServerAskForApproval;
export type CodexApprovalsReviewer = CodexAppServerApprovalsReviewer;
export type CodexSandboxMode = CodexAppServerSandboxMode;
export type CodexSandboxPolicy = CodexAppServerSandboxPolicy;

export type CodexCollaborationModeKind = CodexAppServerModeKind;

export type CodexCollaborationModeState = CodexAppServerCollaborationMode;

export interface CodexCollaborationModePreset {
  name: string;
  mode: CodexCollaborationModeKind;
  model: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
}

export type CodexHeartbeatAutomationCollaborationMode =
  | CodexCollaborationModeKind
  | CodexCollaborationModeState;

export interface CodexHeartbeatAutomationPermissions {
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: CodexApprovalsReviewer | null;
  sandboxPolicy?: CodexSandboxPolicy | null;
}

export interface CodexConversationThreadSettings {
  model: CodexAppServerThreadSettings["model"];
  reasoningEffort: CodexReasoningEffort | null;
  collaborationMode: CodexCollaborationModeState | null;
  personality: CodexPersonality | null;
}

export interface CodexConversationThreadSettingsPatch {
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  collaborationMode?: CodexCollaborationModeKind | null;
  personality?: CodexPersonality | null;
}

export type CodexPersonality = CodexAppServerPersonality;

export interface CodexThreadGoalSetActionInput extends CodexAppServerThreadGoalSetParams {
  appendTranscriptItem?: boolean;
  threadSettings?: CodexConversationThreadSettingsPatch;
}

export type CodexReasoningEffortOption = CodexAppServerReasoningEffortOption;

export type CodexModelOption = Pick<
  CodexAppServerModel,
  | "id"
  | "model"
  | "displayName"
  | "description"
  | "hidden"
  | "supportedReasoningEfforts"
  | "defaultReasoningEffort"
  | "isDefault"
>;

export interface CodexThreadSettings {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  detailLevel?: CodexThreadDetailLevel;
}

/** Composer-owned goal sources before pasted text is materialized to owned files. */
export interface CodexThreadGoalDraftInput {
  readonly objective: string;
  readonly pastedTextAttachments: readonly CodexThreadGoalPastedTextAttachmentInput[];
  readonly imageAttachments: readonly CodexThreadGoalImageAttachmentInput[];
}

export type CodexThreadGoalPastedTextAttachmentInput =
  | CodexPromptTextAttachmentInput
  | CodexPastedTextAttachment;

export interface CodexThreadGoalImageAttachmentInput {
  readonly src: string;
  readonly localPath?: string | null;
  readonly filename?: string | null;
}

/** Storage-safe pending goal whose pasted-text sources are fully materialized. */
export interface CodexThreadGoalFrozenDraft {
  readonly objective: string;
  readonly pastedTextAttachments: readonly CodexPastedTextAttachment[];
  readonly imageAttachments: readonly CodexThreadGoalImageAttachmentInput[];
}

export interface CodexThreadGoalMaterializedDraft {
  readonly objective: string;
  readonly attachmentDirectory: string | null;
}

export interface CodexThreadStartHeartbeatAutomationInput {
  name: string;
  prompt: string;
  rrule: string;
}

export interface CodexThreadStartMemoryPreferences {
  generateMemories: boolean;
  useMemories: boolean;
}

export interface CodexProjectlessWorkspace {
  cwd: string;
  outputDirectory: string;
  workspaceRoot: string;
}

export interface CodexProjectlessThreadCwdInput {
  prompt?: string | null;
  directoryName?: string | null;
  createSplitDirectories?: boolean;
}

export interface CodexThreadStartForSessionInput {
  projectId: string | null;
  sessionId: string;
  prompt: string;
  projectlessWorkspace?: CodexProjectlessWorkspace;
  promptInput?: CodexPromptInput;
  threadGoalDraft?: CodexThreadGoalDraftInput;
  threadGoalMaterializedDraft?: CodexThreadGoalMaterializedDraft;
  threadName?: string;
  skipAutoTitleGeneration?: boolean;
  model?: string;
  executionProfile?: AgentExecutionProfile;
  serviceTier?: CodexServiceTier;
  permissionMode?: CodexPermissionMode;
  permissionProfileId?: string;
  reasoningEffort?: CodexReasoningEffort;
  collaborationMode?: CodexCollaborationModeKind;
  memoryPreferences?: CodexThreadStartMemoryPreferences | null;
  mode?: string;
  threadStartKind?: string;
  baseInstructions?: string | null;
  additionalDeveloperInstructions?: string | null;
  runInTarget?: PageRunInTarget;
  runInEnvironmentPath?: string | null;
  worktreeStartMode?: WorktreeStartMode;
  worktreeBranchPrefix?: string;
  heartbeatAutomation?: CodexThreadStartHeartbeatAutomationInput | null;
}

export type CodexThreadStartForSessionResult =
  | {
      kind: "started";
      detail: CodexThreadDetail;
    }
  | {
      kind: "pending";
      pendingWorktreeId: string;
      clientThreadId: string;
    };

export interface CodexSideChatStartInput {
  parentThreadId: string;
  parentNavigationPath?: string | null;
  prompt?: string;
  promptInput?: CodexPromptInput;
  model?: string;
  serviceTier?: CodexServiceTier;
  permissionMode?: CodexPermissionMode;
  reasoningEffort?: CodexReasoningEffort;
  collaborationMode?: CodexCollaborationModeKind;
}

export interface CodexSideChatStartResult {
  parentThreadId: string;
  threadId: string;
  conversation: CodexConversationSnapshot;
}

export interface CodexTurnStartOptions {
  model?: string;
  serviceTier?: CodexServiceTier;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode?: CodexPermissionMode;
  collaborationMode?: CodexCollaborationModeKind;
  promptInput?: CodexPromptInput;
}

export interface CodexPromptImageInput {
  source: string;
  caption?: string;
}

export interface CodexPromptMentionInput {
  name: string;
  path: string;
}

export interface CodexPromptSkillInput {
  name: string;
  path: string;
}

export interface CodexPromptTextAttachmentInput {
  text: string;
  file?: CodexLiveFileAttachment;
  preview?: string;
  hostId?: string;
  characterCount?: number;
}

/** Exact app-side file attachment retained beside raw app-server turn input. */
export interface CodexLiveFileAttachment {
  [key: string]: unknown;
  label: string;
  path: string;
  fsPath: string;
  startLine?: number | null;
  endLine?: number | null;
  hostId?: string;
}

/** Exact pasted-text wrapper used to derive a display attachment from its owned source file. */
export interface CodexPastedTextAttachment {
  file: CodexLiveFileAttachment;
  preview: string;
  hostId?: string;
  characterCount?: number;
}

export type ReviewDiffAnnotationSide = "additions" | "deletions";

export type ReviewDiffCommentPositionSide = "left" | "right";

export interface ReviewDiffLineRange {
  side: ReviewDiffAnnotationSide;
  line: number;
  startSide?: ReviewDiffAnnotationSide;
  startLine?: number;
}

export interface ReviewDiffCommentPosition {
  side: ReviewDiffCommentPositionSide;
  path: string;
  line: number;
  start_line?: number;
  start_side?: ReviewDiffCommentPositionSide;
}

export interface CodexReviewDiffCommentAttachment {
  id: string;
  type: "comment";
  content: Array<{
    content_type: "text";
    text: string;
  }>;
  position: ReviewDiffCommentPosition;
  localDiffHunk?: string;
  source?: {
    kind: "review-diff";
    label?: string;
    sessionKey?: string;
  };
  createdAt: number;
}

export interface CodexPromptAgentConfigInput {
  mode?: string;
  model?: string;
  reasoning?: string;
  unknownAttributes?: string[];
}

export interface CodexPromptInput {
  text: string;
  textAttachments?: CodexPromptTextAttachmentInput[];
  fileAttachments?: CodexLiveFileAttachment[];
  addedFiles?: CodexLiveFileAttachment[];
  images?: CodexPromptImageInput[];
  mentions?: CodexPromptMentionInput[];
  skills?: CodexPromptSkillInput[];
  commentAttachments?: CodexReviewDiffCommentAttachment[];
  agentConfigs?: CodexPromptAgentConfigInput[];
}

/** One renderer-owned prompt compilation shared by optimistic state and RPC. */
export interface CodexPreparedPrompt {
  promptText: string;
  inputItems: CodexAppServerUserInput[];
  pendingInputItems: CodexAppServerUserInput[];
  fileAttachments: CodexLiveFileAttachment[];
  addedFiles: CodexLiveFileAttachment[];
  pastedTextAttachments: CodexPromptTextAttachmentInput[];
  additionalContext?: Record<string, CodexAppServerAdditionalContextEntry>;
  commentAttachments: CodexReviewDiffCommentAttachment[];
  agentConfigs: CodexPromptAgentConfigInput[];
}

export type CodexSteeringStatus = "pending" | "accepted";

export type CodexSteeringUserInput = CodexAppServerUserInput;

export interface CodexSteeringRestoreMessage {
  prompt: string;
  promptInput?: CodexPromptInput;
  collaborationMode?: CodexCollaborationModeKind | null;
  serviceTier?: CodexServiceTier;
}

export interface CodexSteerTurnInput {
  threadId: string;
  expectedTurnId?: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  collaborationMode?: CodexCollaborationModeKind | null;
  serviceTier?: CodexServiceTier;
}

export interface CodexComposerIntent {
  prompt: string;
  focusNonce: number;
  promptInput?: CodexPromptInput;
  clearText?: boolean;
  attachmentMode?: "append" | "replace";
}

export interface CodexThreadActionResult {
  threadId: string;
  composerIntent?: CodexComposerIntent;
  streamRevision?: number;
}

export type CodexOwnerAppServerRequest =
  | {
      method: "thread/rollback";
      params: CodexAppServerThreadRollbackParams & { turnId: string };
    }
  | {
      method: "thread/fork";
      params: { threadId: string; turnId: string; message: string };
    }
  | {
      method: "turn/start";
      params: {
        threadId: string;
        prompt: string;
        opts?: CodexTurnStartOptions;
        clientUserMessageId: string;
        preparedPrompt: CodexPreparedPrompt;
      };
    }
  | { method: "turn/steer"; params: CodexAppServerTurnSteerParams }
  | {
      method: "turn/interrupt";
      params: { threadId: string; turnId?: string };
    }
  | {
      method: "thread/settings/update";
      params: {
        threadId: string;
        patch: CodexConversationThreadSettingsPatch;
      };
    }
  | { method: "thread/goal/set"; params: CodexAppServerThreadGoalSetParams }
  | { method: "thread/goal/clear"; params: CodexAppServerThreadGoalClearParams }
  | { method: "thread/memoryMode/set"; params: CodexAppServerThreadMemoryModeSetParams }
  | { method: "thread/compact/start"; params: CodexAppServerThreadCompactStartParams }
  | {
      method: "thread/backgroundTerminals/list";
      params: CodexAppServerThreadBackgroundTerminalsListParams;
    }
  | {
      method: "thread/backgroundTerminals/terminate";
      params: CodexAppServerThreadBackgroundTerminalsTerminateParams;
    };

export type CodexOwnerAppServerRequestMethod = CodexOwnerAppServerRequest["method"];

export interface CodexOwnerAppServerRequestInput {
  conversationId: string;
  request: CodexOwnerAppServerRequest;
}

export type CodexPermissionPreset =
  "read-only" | "auto" | "guardian-approvals" | "full-access";
export type CodexPermissionMode =
  "auto" | "guardian-approvals" | "full-access" | "custom";
export type CodexAgentMode =
  | "read-only"
  | "auto"
  | "granular"
  | "guardian-approvals"
  | "full-access"
  | "custom";

export interface CodexPermissionConfigTarget {
  source: "user" | "project" | "none";
  filePath: string | null;
}

export interface CodexPermissionState {
  mode: CodexPermissionMode;
  effectivePreset: CodexPermissionPreset | "custom";
  availableModes: CodexPermissionMode[];
  approvalPolicy: CodexApprovalPolicy | null;
  approvalsReviewer: CodexApprovalsReviewer;
  sandboxMode: CodexSandboxMode | null;
  sandbox: CodexSandboxPolicy | null;
  autoReviewAvailable: boolean;
  configTarget: CodexPermissionConfigTarget;
  customDescription: string | null;
}

export type CodexTurnStatus = CodexAppServerTurnStatus;

export type CodexTokenUsageBreakdown = CodexAppServerTokenUsageBreakdown;

export type CodexThreadTokenUsage = CodexAppServerThreadTokenUsage;

export type CodexSafetyBufferingState = Pick<
  CodexAppServerModelSafetyBufferingUpdatedNotification,
  "useCases" | "reasons" | "showBufferingUi" | "fasterModel"
>;

export interface CodexTurnSummary {
  threadId: string;
  turnId: string | null;
  status: CodexTurnStatus;
  errorMessage?: string;
  diff?: string;
  itemIds: string[];
  turnStartedAtMs?: number | null;
  firstTurnWorkItemStartedAtMs?: number | null;
  finalAssistantStartedAtMs?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  commandExecutionStartedAtMsById?: Record<string, number>;
  interruptedCommandExecutionItemIds?: string[];
  hookRuns?: Array<
    import("./codex-conversation-state/codex-conversation-state").CodexCanonicalHookRun
  >;
  tokenUsage?: CodexThreadTokenUsage;
  safetyBuffering?: CodexSafetyBufferingState;
}

export type CodexItemNormalizedKind =
  | "userMessage"
  | "assistantMessage"
  | "reasoning"
  | "plan"
  | "userInputRequest"
  | "userInputResponse"
  | "commandExecution"
  | "fileChange"
  | "toolCall"
  | "hook"
  | "planImplementation"
  | "systemEvent";

export type CodexSemanticItemKind =
  | "userMessage"
  | "assistantMessage"
  | "reasoning"
  | "todoList"
  | "proposedPlan"
  | "exec"
  | "patch"
  | "diff"
  | "toolCall"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "automationUpdate"
  | "webSearch"
  | "imageView"
  | "generatedImage"
  | "subAgentActivity"
  | "workedFor"
  | "mcpServerElicitation"
  | "permissionRequest"
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
  | "steered"
  | "userInputResponse"
  | "hook"
  | "planImplementation"
  | "systemEvent";

export type CodexToolCallSubtype =
  "mcp" | "dynamic" | "webSearch" | "generic" | "command" | "fileChange";
export type CodexItemStatus =
  "inProgress" | "completed" | "failed" | "declined" | "interrupted";
export type CodexTranscriptEntryKind = CodexItemNormalizedKind;
export type CodexTranscriptEntryStatus = CodexItemStatus;
export type CodexTranscriptEntrySource =
  "live" | "bootstrap" | "replay";
export type CodexFileChangeKind = CodexAppServerPatchChangeKind["type"];
export type ReviewSkipReason =
  "binary" | "tooLarge" | "invalidText" | "unsupported";

export interface ReviewFileSafety {
  binary: boolean;
  tooLarge: boolean;
  invalidText: boolean;
  renderable: boolean;
  sizeBytes: number | null;
  mimeType: string | null;
  skipReason: ReviewSkipReason | null;
}

export interface CodexUserFileAttachment {
  type: "file";
  id: string;
  label: string;
  path: string;
  sourceKind: "mention" | "skill";
}

export interface CodexUserImageAttachment {
  type: "image";
  id: string;
  source: string;
  sourceKind: "local" | "remote";
  caption?: string;
}

export type CodexUserAttachment =
  CodexUserFileAttachment | CodexUserImageAttachment;

export type ProtocolThreadItem = CodexAppServerThreadItem;
export type ProtocolCommandExecutionItem = Extract<
  ProtocolThreadItem,
  { type: "commandExecution" }
>;
export type ProtocolMcpToolCallItem = Extract<
  ProtocolThreadItem,
  { type: "mcpToolCall" }
>;
export type ProtocolDynamicToolCallItem = Extract<
  ProtocolThreadItem,
  { type: "dynamicToolCall" }
>;
export type ProtocolDynamicToolCallOutputContentItem =
  CodexAppServerDynamicToolCallOutputContentItem;
export type ProtocolDynamicToolCallParams = CodexAppServerDynamicToolCallParams;
export type ProtocolDynamicToolCallResponse =
  CodexAppServerDynamicToolCallResponse;
export type ProtocolCommandAction = CodexAppServerCommandAction;
export type ProtocolMcpToolCallResult = CodexAppServerMcpToolCallResult;
export type ProtocolMcpToolCallError = CodexAppServerMcpToolCallError;
export type ProtocolMcpResourceReadParams = CodexAppServerMcpResourceReadParams;
export type ProtocolMcpResourceReadResponse =
  CodexAppServerMcpResourceReadResponse;
export type ProtocolMcpServerStatus = CodexAppServerMcpServerStatus;
export type ProtocolListMcpServerStatusResponse =
  CodexAppServerListMcpServerStatusResponse;
export type ProtocolAppInfo = CodexAppServerAppInfo;
export type ProtocolExperimentalFeature = CodexAppServerExperimentalFeature;
export type ProtocolCommandExecutionApprovalParams =
  CodexAppServerCommandExecutionRequestApprovalParams;
export type ProtocolExecPolicyAmendment = CodexAppServerExecPolicyAmendment;
export type ProtocolNetworkApprovalContext =
  CodexAppServerNetworkApprovalContext;

export type CodexCommandAction = ProtocolCommandAction;

export type CodexParsedCommand = (
  | { type: "read"; cmd: string; name: string; path: string }
  | { type: "list_files"; cmd: string; path: string | null }
  | { type: "search"; cmd: string; query: string | null; path: string | null }
  | { type: "unknown"; cmd: string }
) & { isFinished: boolean };

export interface CodexCommandExecutionAttachmentFields {
  /** Projected exec identity; split actions use `<raw item id>:<action index>`. */
  callId?: string;
  /** Raw commandExecution owner ID, present only when one raw item expands to multiple exec rows. */
  commandExecutionItemId?: string;
  command?: ProtocolCommandExecutionItem["command"] | null;
  cmd?: string[];
  cwd?: ProtocolCommandExecutionItem["cwd"] | null;
  processId?: ProtocolCommandExecutionItem["processId"];
  commandActions?: ProtocolCommandExecutionItem["commandActions"];
  aggregatedOutput?: ProtocolCommandExecutionItem["aggregatedOutput"];
  exitCode?: ProtocolCommandExecutionItem["exitCode"];
  durationMs?: ProtocolCommandExecutionItem["durationMs"];
  startedAtMs?: number;
  executionStatus?: CodexItemStatus;
  parsedCmd?: CodexParsedCommand;
  approvalRequestId?: CodexAppServerRequestId | null;
  approvalReason?: string | null;
  networkApprovalContext?: ProtocolNetworkApprovalContext | null;
  proposedExecpolicyAmendment?: ProtocolExecPolicyAmendment | null;
  proposedNetworkPolicyAmendments?: CodexNetworkPolicyAmendment[] | null;
  grantRoot?: string | null;
}

export type CodexFileChange =
  | {
      path: string;
      type: "add";
      content: string;
    }
  | {
      path: string;
      type: "delete";
      content: string;
    }
  | {
      path: string;
      type: "update";
      unifiedDiff: string;
      movePath: string | null;
    }
  | {
      path: string;
      type: "nonRenderable";
      originalType: CodexFileChangeKind;
      movePath: string | null;
      safety: ReviewFileSafety;
    };

export type CodexFileChangePatch =
  | {
      type: "add";
      content: string;
    }
  | {
      type: "delete";
      content: string;
    }
  | {
      type: "update";
      unifiedDiff: string;
      movePath: string | null;
    }
  | {
      type: "nonRenderable";
      originalType: CodexFileChangeKind;
      movePath: string | null;
      safety: ReviewFileSafety;
    };

export type CodexFileChangeMap = Record<string, CodexFileChangePatch>;

export interface CodexVisualizationActivity {
  path: string;
  kind: "create" | "update";
}

export interface CodexFileChangeView {
  label?: string;
  changes: CodexFileChangeMap;
  visualizationActivities?: CodexVisualizationActivity[];
  success?: boolean | null;
}

export interface CodexTurnDiffPatchBatch {
  cwd: string | null;
  changes: unknown[];
}

export type CodexTurnDiffReviewSource = "last-turn" | "selected-turn";

export interface CodexToolCallView {
  toolName: string;
  server?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  subtype: CodexToolCallSubtype;
}

export interface CodexMcpToolCallInvocation {
  server: ProtocolMcpToolCallItem["server"];
  tool: ProtocolMcpToolCallItem["tool"];
  arguments: ProtocolMcpToolCallItem["arguments"];
}

export type CodexMcpToolCallSource =
  | {
      kind: "browserUse";
      backend: "chrome" | "iab" | "cdp";
    }
  | {
      kind: "computerUse";
      app:
        | null
        | { kind: "appId"; appId: string }
        | { kind: "displayName"; displayName: string };
    };

export interface CodexMcpToolCallAnnotations {
  audience?: Array<"assistant" | "user">;
  priority?: number;
  lastModified?: string;
}

export interface CodexDynamicToolCallView {
  callId: ProtocolDynamicToolCallItem["id"];
  namespace: ProtocolDynamicToolCallItem["namespace"];
  tool: ProtocolDynamicToolCallItem["tool"];
  arguments: ProtocolDynamicToolCallItem["arguments"];
  status?: ProtocolDynamicToolCallItem["status"];
  contentItems?: ProtocolDynamicToolCallItem["contentItems"];
  success?: ProtocolDynamicToolCallItem["success"];
  durationMs?: ProtocolDynamicToolCallItem["durationMs"];
  completed: boolean;
}

export interface CodexAutomationUpdateView {
  callId: string;
  arguments: Record<string, unknown>;
  result: {
    automationId: string;
    mode: "create" | "update" | "delete" | null;
    deleteStatus?: "deleted" | "not_found";
    snapshot?: {
      kind: "cron" | "heartbeat";
      name: string;
      rrule: string;
    } | null;
  } | null;
}

export interface CodexWebSearchView {
  query: string;
  action: unknown;
  completed: boolean;
}

export interface CodexGeneratedImageView {
  src: string | null;
  status: string;
}

export interface CodexSubagentActivityView {
  agentThreadId: string;
  displayName: string | null;
  displayStatus: "active" | "updated" | "interrupted";
}

export interface CodexContextCompactionView {
  completed: boolean;
  source: "automatic" | "manual";
}

export type CodexMcpToolCallContentBlock =
  | {
      type: "text";
      text: string;
      annotations?: CodexMcpToolCallAnnotations;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: CodexMcpToolCallAnnotations;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: CodexMcpToolCallAnnotations;
    }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      annotations?: CodexMcpToolCallAnnotations;
    }
  | {
      type: "embedded_resource";
      resource: {
        uri: string;
        name?: string;
        title?: string;
        description?: string;
        mimeType?: string;
        text?: string;
        blob?: string;
        annotations?: CodexMcpToolCallAnnotations;
      };
    }
  | {
      type: "unknown";
      raw: unknown;
    };

export type CodexMcpToolCallNormalizedResult =
  | null
  | {
      type: "success";
      content: CodexMcpToolCallContentBlock[];
      structuredContent: ProtocolMcpToolCallResult["structuredContent"];
      raw: ProtocolMcpToolCallResult;
    }
  | {
      type: "error";
      kind: "protocol";
      error: string;
      rawError: ProtocolMcpToolCallError;
    };

// Renderer-facing normalized MCP state derived from protocol-owned raw tool-call payloads.
export interface CodexMcpToolCallView {
  callId: ProtocolMcpToolCallItem["id"];
  functionName: string;
  pluginId: ProtocolMcpToolCallItem["pluginId"];
  mcpAppResourceUri: ProtocolMcpToolCallItem["mcpAppResourceUri"];
  source: CodexMcpToolCallSource | null;
  invocation: CodexMcpToolCallInvocation;
  result: CodexMcpToolCallNormalizedResult;
  durationMs: ProtocolMcpToolCallItem["durationMs"];
  completed: boolean;
}

export interface CodexItemView extends CodexCommandExecutionAttachmentFields {
  threadId: string;
  turnId: string | null;
  itemId: string;
  /** Canonical raw owner; absent for app-owned params, request, hook, and diff overlays. */
  rawItemId?: string;
  /** Canonical raw discriminant used to stabilize aliased display rows without reparsing raw payloads. */
  rawItemType?: string;
  type: string;
  normalizedKind: CodexItemNormalizedKind;
  semanticKind?: CodexSemanticItemKind;
  assistantPhase?: string;
  timeLabel?: string;
  status?: CodexItemStatus;
  role?: "user" | "assistant";
  toolCall?: CodexToolCallView;
  mcpToolCall?: CodexMcpToolCallView;
  dynamicToolCall?: CodexDynamicToolCallView;
  automationUpdate?: CodexAutomationUpdateView;
  webSearch?: CodexWebSearchView;
  generatedImage?: CodexGeneratedImageView;
  subagentActivity?: CodexSubagentActivityView;
  contextCompaction?: CodexContextCompactionView;
  requestId?: CodexAppServerRequestId;
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  goal?: boolean;
  hookFeedback?: boolean;
  imageViewPaths?: string[];
  userAttachments?: CodexUserAttachment[];
  commentAttachments?: CodexReviewDiffCommentAttachment[];
  deliveryStatus?: "not-sent";
  steeringStatus?: CodexSteeringStatus;
  steeringInput?: CodexSteeringUserInput[];
  steeringCompareKey?: string;
  steeringRestoreMessage?: CodexSteeringRestoreMessage;
  steeringTargetTurnId?: string | null;
  steeringTargetTurnStartedAtMs?: number | null;
  acceptedUserMessageItemId?: string;
  additionalDetails?: string | null;
  willRetry?: boolean;
  userInputQuestions?: CodexUserInputQuestion[];
  userInputAnswers?: Record<string, string[]>;
  rawItem?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface CodexTranscriptEntry extends CodexCommandExecutionAttachmentFields {
  threadId: string;
  turnId: string | null;
  entryId?: string;
  itemId: string;
  /** Canonical raw owner; absent for app-owned params, request, hook, and diff overlays. */
  rawItemId?: string;
  /** Canonical raw discriminant used to stabilize aliased display rows without reparsing raw payloads. */
  rawItemType?: string;
  type: string;
  kind: CodexTranscriptEntryKind;
  semanticKind?: CodexSemanticItemKind;
  assistantPhase?: string;
  timeLabel?: string;
  status?: CodexTranscriptEntryStatus;
  role?: "user" | "assistant";
  source?: CodexTranscriptEntrySource;
  sequence?: number;
  toolCall?: CodexToolCallView;
  mcpToolCall?: CodexMcpToolCallView;
  dynamicToolCall?: CodexDynamicToolCallView;
  automationUpdate?: CodexAutomationUpdateView;
  webSearch?: CodexWebSearchView;
  generatedImage?: CodexGeneratedImageView;
  subagentActivity?: CodexSubagentActivityView;
  contextCompaction?: CodexContextCompactionView;
  requestId?: CodexAppServerRequestId;
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  goal?: boolean;
  hookFeedback?: boolean;
  imageViewPaths?: string[];
  userAttachments?: CodexUserAttachment[];
  commentAttachments?: CodexReviewDiffCommentAttachment[];
  deliveryStatus?: "not-sent";
  steeringStatus?: CodexSteeringStatus;
  steeringInput?: CodexSteeringUserInput[];
  steeringCompareKey?: string;
  steeringRestoreMessage?: CodexSteeringRestoreMessage;
  steeringTargetTurnId?: string | null;
  steeringTargetTurnStartedAtMs?: number | null;
  acceptedUserMessageItemId?: string;
  additionalDetails?: string | null;
  willRetry?: boolean;
  userInputQuestions?: CodexUserInputQuestion[];
  userInputAnswers?: Record<string, string[]>;
  rawItem?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface CodexThreadDetail extends CodexThreadSummary {
  latestCollaborationMode?: CodexCollaborationModeState;
  latestThreadSettings?: CodexConversationThreadSettings | null;
  turns: CodexTurnSummary[];
  transcript: CodexTranscriptEntry[];
}

export interface CodexConversationItem extends CodexTranscriptEntry {
  requestId?: CodexAppServerRequestId;
}

export interface CodexConversationTurn extends CodexTurnSummary {
  items: CodexConversationItem[];
}

export interface CodexConversationTurnPagination {
  olderCursor: string | null;
  backwardsCursor: string | null;
  oldestLoadedTurnId: string | null;
  isLoadingOlder: boolean;
  hasLoadedOldest: boolean;
  loadedTurnCount: number;
  itemsView: CodexAppServerTurnItemsView;
}

export type CodexApprovalKind = CodexApprovalResponse["kind"];
export type CodexNetworkApprovalContext = ProtocolNetworkApprovalContext;

export type CodexNetworkPolicyAmendment = CodexAppServerNetworkPolicyAmendment;

export type CodexApprovalDecision = CodexApprovalResponse["decision"];

export interface CodexApprovalRequest {
  type: "approval";
  requestId: CodexAppServerRequestId;
  kind: CodexApprovalKind;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  approvalRequestId?: CodexAppServerRequestId | null;
  callId?: string | null;
  reason?: string;
  command?: string;
  cwd?: string;
  approvalReason?: string;
  cmd?: string[];
  networkApprovalContext?: CodexNetworkApprovalContext | null;
  proposedExecpolicyAmendment?: ProtocolExecPolicyAmendment | null;
  proposedNetworkPolicyAmendments?: CodexNetworkPolicyAmendment[] | null;
  availableDecisions?: string[] | null;
  grantRoot?: string | null;
  commandActions?: CodexCommandAction[] | null;
  createdAt: number;
}

export type CodexUserInputOption = CodexAppServerUserInputOption;

export interface CodexUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret?: boolean;
  otherPlaceholder?: string;
  options?: CodexUserInputOption[];
}

export interface CodexUserInputRequest {
  type: "userInput";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexUserInputQuestion[];
  isOnboardingDynamicInput?: boolean;
  autoResolutionMs?: number | null;
  createdAt: number;
}

export interface CodexOptionPickerOption {
  label: string;
  description: string | null;
}

/** Renderer view model projected from the canonical raw request plane. */
export interface CodexOptionPickerRequest {
  type: "optionPicker";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  question: string;
  options: CodexOptionPickerOption[];
  allowMultiple: boolean;
  submitLabel: string | null;
  skipLabel: string | null;
  createdAt: number;
}

/** Renderer view model for the role/task/context setup request switch. */
export interface CodexSetupCodexStepRequest {
  type: "setupCodexStep";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  step: "role" | "task" | "context";
  createdAt: number;
}

export type CodexCanonicalInteractivePendingRequest =
  | CodexUserInputRequest
  | CodexOptionPickerRequest
  | CodexSetupCodexStepRequest;

export interface CodexPlanImplementationServerRequest {
  type: "implementPlan";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  planContent: string;
  createdAt: number;
}

export type CodexPlanImplementationRequest =
  CodexPlanImplementationServerRequest;

export interface CodexMcpElicitationOption {
  value: string;
  label: string;
  description?: string;
}

export interface CodexMcpServerElicitationRequest {
  type: "mcpServerElicitation";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: "generic" | "mcpToolCall" | "toolSuggestion";
  mode: "form" | "openai/form" | "url";
  serverName: string;
  message: string;
  url?: string;
  elicitationId?: string;
  requestedSchema?: unknown;
  meta?: unknown;
  createdAt: number;
}

export type CodexMcpServerElicitationAction = CodexAppServerMcpServerElicitationAction;
export type CodexMcpServerElicitationResponse =
  CodexAppServerMcpServerElicitationRequestResponse;

export interface CodexPermissionRequest {
  type: "permissionRequest";
  requestId: CodexAppServerRequestId;
  projectId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  reason: string | null;
  permissions: CodexAppServerPermissionsRequestApprovalParams["permissions"];
  response: CodexAppServerPermissionsRequestApprovalResponse | null;
  completed: boolean;
  createdAt: number;
}

export type CodexPermissionRequestResponse =
  CodexAppServerPermissionsRequestApprovalResponse;

export interface CodexPendingSteer {
  steerId: string;
  threadId: string;
  turnId: string;
  prompt: string;
  createdAt: number;
}

export interface CodexQueuedFollowUp {
  followUpId: string;
  threadId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  createdAt: number;
  collaborationMode?: CodexCollaborationModeKind | null;
  serviceTier: CodexServiceTier;
  pausedReason?: string | null;
}

export interface CodexBackgroundTerminalRow {
  id: string;
  turnId: string;
  command: string;
  cwd: string | null;
  processId?: number | string | null;
  previewLine: string | null;
}

export type CodexBackgroundProcessRecordSource =
  "app-server" | "terminal-action";

export type CodexBackgroundProcessStatus = "running" | "not-found";

export interface CodexBackgroundProcessRecord {
  id: string;
  threadId: string;
  threadTitle: string | null;
  itemId: string;
  turnId: string | null;
  command: string;
  cwd: string | null;
  processId: string | null;
  osPid: number | null;
  terminalSessionId: string | null;
  source: CodexBackgroundProcessRecordSource;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface CodexBackgroundProcessRow extends CodexBackgroundProcessRecord {
  status: CodexBackgroundProcessStatus;
  terminal: CodexAppServerThreadBackgroundTerminal | null;
  terminalSession: TerminalSessionSnapshot | null;
}

export interface CodexBackgroundProcessRunActionInput {
  threadId: string;
  threadTitle?: string | null;
  itemId: string;
  turnId?: string | null;
  command: string;
  cwd: string;
  terminalSessionId: string;
}

export type ReviewDiffSourceKind =
  "last-turn" | "unstaged" | "staged" | "branch" | "commit" | "pull-request";

export type GitReviewSource = "unstaged" | "staged" | "branch" | "commit";

export interface GitReviewSnapshotRequest {
  cwd: string;
  source: GitReviewSource;
  baseRef?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  operationSource?: string | null;
  requestId?: string | null;
  snapshotGeneration?: number | null;
  includeUntrackedFiles?: boolean;
}

export interface GitReviewBranchCommitsRequest {
  cwd: string;
  baseBranch?: string | null;
  operationSource?: string | null;
  requestId?: string | null;
}

export interface GitReviewBranchCommit {
  sha: string;
  committedAt: string;
  subject: string;
}

export interface GitReviewBranchCommitsResult {
  cwd: string;
  baseBranch: string | null;
  commits: GitReviewBranchCommit[];
  errorMessage: string | null;
}

export type ReviewDiffFilter = "last-turn" | GitReviewSource | "pull-request";

export type ReviewDiffSourceDescriptor =
  | { kind: "last-turn" }
  | { kind: "unstaged" }
  | { kind: "staged" }
  | { kind: "branch"; baseBranch?: string | null }
  | { kind: "commit"; commitSha: string; title?: string | null }
  | { kind: "pull-request"; prNumber: number; baseBranch?: string | null };

export interface ReviewPanelTabStateV1 {
  version: 1;
  source: ReviewDiffSourceDescriptor;
  diffMode: "unified" | "split";
  fileTreeOpen: boolean;
  sidePaneWidth: number;
  hideWhitespace: boolean;
  wrap: boolean;
  richPreview: boolean;
  fullFile: boolean;
  selectedPath: string | null;
  filter: string;
  expandedPaths: string[];
}

export type GitReviewFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "untracked";

export type ReviewDiffLoadStatus =
  | "loading"
  | "loaded"
  | "load-failed"
  | "timed-out"
  | "diff-too-large"
  | "binary"
  | "unsupported";

export type GitApplyPatchTarget = "staged" | "unstaged";

export type GitApplyPatchStatus = "success" | "partial-success" | "error";

export interface GitReviewFileSummary {
  path: string;
  previousPath: string | null;
  status: GitReviewFileStatus;
  rawStatus: string | null;
  oldOid: string | null;
  newOid: string | null;
  revision: string | null;
  additions: number | null;
  deletions: number | null;
  safety: ReviewFileSafety;
  /** null means repository attributes could not be resolved safely. */
  generated?: boolean | null;
}

export interface GitReviewSnapshot {
  cwd: string;
  source: GitReviewSource;
  patch: string;
  files: GitReviewFileSummary[];
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
  snapshotGeneration: number;
}

export interface ReviewDiffEntry extends GitReviewFileSummary {
  diff: string;
  loadStatus: ReviewDiffLoadStatus;
  renderKey: string;
  diffBytes: number;
  diffError: string | null;
  canApplyPatchActions: boolean;
  changedBytes: number;
  tooLarge: boolean;
  tooLargeReason: string | null;
}

export interface ReviewDiffRequest {
  cwd: string;
  source: GitReviewSource;
  sourceDescriptor?: ReviewDiffSourceDescriptor;
  files?: GitReviewDiffFileRequest[];
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  hostConfig?: Record<string, unknown> | null;
  operationSource?: string | null;
  requestId?: string | null;
  snapshotGeneration: number;
}

export interface GitReviewDiffFileRequest {
  path: string;
  previousPath?: string | null;
  status: GitReviewFileStatus;
  revision?: string | null;
}

export interface ReviewDiffSuccessResult {
  type: "success";
  cwd: string;
  source: GitReviewSource;
  patch: string;
  files: ReviewDiffEntry[];
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
  snapshotGeneration: number;
}

export type ReviewDiffResult =
  | ReviewDiffSuccessResult
  | {
      type: "stale-snapshot";
      source: GitReviewSource;
    };

export interface GitReviewPatchRequest {
  cwd: string;
  source: GitReviewSource;
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hostConfig?: Record<string, unknown> | null;
  operationSource?: string | null;
  requestId?: string | null;
}

export type GitReviewPatchDiff =
  | {
      type: "success";
      unifiedDiff: string;
      unifiedDiffBytes: number;
    }
  | {
      type: "error";
      errorMessage: string | null;
      outputLimitExceeded: boolean;
    };

export interface GitReviewPatchResult {
  cwd: string;
  source: GitReviewSource;
  diff: GitReviewPatchDiff;
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

export interface BranchDiffStatsRequest {
  cwd: string;
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  includeUntrackedFiles?: boolean;
  requestId?: string | null;
}

export interface BranchDiffStatsResult {
  cwd: string;
  baseRef: string | null;
  files: GitReviewFileSummary[];
  additions: number;
  deletions: number;
  isGitRepository: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

export interface GitReviewSummaryRequest {
  cwd: string;
  source: GitReviewSource;
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  requestId?: string | null;
  includeUntrackedFiles?: boolean;
}

export interface GitReviewStageCounts {
  stagedFileCount: number;
  unstagedFileCount: number;
  untrackedFileCount: number;
}

export type GitReviewSummaryResult =
  | {
      type: "success";
      source: GitReviewSource;
      files: GitReviewFileSummary[];
      snapshotGeneration: number;
      stageCounts: GitReviewStageCounts;
    }
  | {
      type: "error";
      source: GitReviewSource;
      errorMessage: string | null;
    };

export interface GitReviewRepositoryMetadataRequest {
  cwd: string;
  requestId?: string | null;
}

export interface GitReviewRepositoryMetadataResult {
  cwd: string;
  root: string | null;
  gitDir: string | null;
  commonDir: string | null;
  isGitRepository: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

export interface GitReviewBaseBranchRequest {
  cwd: string;
  requestId?: string | null;
}

export interface GitReviewBaseBranchResult {
  cwd: string;
  local: string | null;
  remote: string | null;
  errorMessage: string | null;
}

export type GitReviewLiveQuery =
  | {
      method: "review-summary";
      params: GitReviewSummaryRequest;
    }
  | {
      method: "branch-diff-stats";
      params: BranchDiffStatsRequest;
    }
  | {
      method: "branch-commits";
      params: GitReviewBranchCommitsRequest;
    }
  | {
      method: "base-branch";
      params: GitReviewBaseBranchRequest;
    };

export type GitReviewLiveQueryMethod = GitReviewLiveQuery["method"];

export interface GitReviewLiveSubscriptionInput {
  subscriptionId: string;
  query: GitReviewLiveQuery;
}

export interface GitReviewLiveSubscriptionStopInput {
  subscriptionId: string;
}

export type GitReviewLiveQueryResult =
  | {
      method: "review-summary";
      result: GitReviewSummaryResult;
    }
  | {
      method: "branch-diff-stats";
      result: BranchDiffStatsResult;
    }
  | {
      method: "branch-commits";
      result: GitReviewBranchCommitsResult;
    }
  | {
      method: "base-branch";
      result: GitReviewBaseBranchResult;
    };

export type GitReviewLiveEvent =
  | ({
      type: "git-live-query-updated";
      subscriptionId: string;
      generation: number;
      requiresRecovery: boolean;
      phase: "tracked" | "complete";
    } & GitReviewLiveQueryResult)
  | {
      type: "git-live-query-failed";
      subscriptionId: string;
      generation: number;
      requiresRecovery: boolean;
      method: GitReviewLiveQueryMethod;
      errorMessage: string;
    };

export interface GitActionStatusRequest {
  cwd: string;
}

export interface GitActionStatusResult {
  cwd: string;
  isGitRepository: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
  upstreamBranch: string | null;
  remotes: string[];
  hasHeadCommit: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasUntrackedFiles: boolean;
  hasUncommittedChanges: boolean;
  commitsAhead: number;
  canCommit: boolean;
  canPush: boolean;
  pushNeedsUpstream: boolean;
  errorMessage: string | null;
}

export type GitCommitNextStep = "commit" | "commit-and-push";

export interface GitCommitMessageGenerateInput {
  cwd: string;
  hostId?: string;
  draftMessage?: string;
  includeUnstaged?: boolean;
  operationId?: string;
}

export interface GitCommitMessageGenerateResult {
  cwd: string;
  status: "success" | "error";
  message: string | null;
  stderr: string;
  errorMessage: string | null;
}

export interface GitPullRequestMessageGenerateInput {
  cwd: string;
  hostId?: string;
  title?: string | null;
  body?: string | null;
  headBranch?: string | null;
  baseBranch?: string | null;
  operationId?: string;
}

export interface GitPullRequestMessageGenerateResult {
  cwd: string;
  status: "success" | "error";
  title: string | null;
  body: string | null;
  stderr: string;
  errorMessage: string | null;
}

export interface GitCommitInput {
  cwd: string;
  hostId?: string;
  message: string;
  includeUnstaged?: boolean;
  nextStep?: GitCommitNextStep;
  operationId?: string;
}

export interface GitPushInput {
  cwd: string;
  force?: boolean;
  operationId?: string;
}

export interface GitActionCancelInput {
  operationId: string;
}

export interface GitActionCancelResult {
  canceled: boolean;
}

export interface GitActionMutationResult {
  cwd: string;
  status: "success" | "error";
  branch: string | null;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

export interface GitMergeBaseRequest {
  cwd: string;
  gitRoot?: string | null;
  baseBranch: string;
}

export interface GitMergeBaseResult {
  cwd: string;
  baseBranch: string;
  mergeBaseSha: string | null;
  errorMessage: string | null;
}

export type CodexReviewTarget = CodexAppServerReviewTarget;
export type CodexReviewStartParams = CodexAppServerReviewStartParams;
export type CodexReviewStartResponse = CodexAppServerReviewStartResponse;

export interface GitReviewCatFileRequest {
  oid: string | null;
  path: string;
  fallbackToDisk?: boolean;
}

export type GitCatFileResult =
  | { type: "success"; lines: readonly string[] }
  | { type: "error"; error: { type: "not-found" | "unknown" } }
  | {
      type: "error";
      error: { type: "too-large"; limitBytes: number };
    };

export interface GitReviewCatFileInput {
  cwd: string;
  snapshotGeneration: number;
  requests: GitReviewCatFileRequest[];
}

export interface GitReviewCatFileOutput {
  snapshotGeneration: number;
  results: GitCatFileResult[];
}

export interface GitReviewSearchInput {
  cwd: string;
  source: GitReviewSource;
  query: string;
  baseBranch?: string | null;
  commitSha?: string | null;
  requestId?: string | null;
}

export interface GitReviewSearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface GitReviewSearchMatch {
  path: string;
  hunkId: "path" | `${number}`;
  lineStart: number;
  lineEnd: number;
  start: number;
  end: number;
  snippet: GitReviewSearchSnippet;
}

export type GitReviewSearchResult =
  | {
      type: "success";
      source: GitReviewSource;
      query: string;
      matches: GitReviewSearchMatch[];
      totalMatches: number;
      isCapped: boolean;
    }
  | {
      type: "error";
      source: GitReviewSource;
      query: string;
    };

export interface GitApplyPatchInput {
  cwd: string;
  diff: string;
  target: GitApplyPatchTarget;
  revert?: boolean;
  operationSource?: "thread_diff" | "review";
}

export interface GitApplyPatchResult {
  status: GitApplyPatchStatus;
  appliedPaths: string[];
  skippedPaths: string[];
  conflictedPaths: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface GitReviewCancelInput {
  requestId: string;
}

export interface GitReviewBlameInput {
  cwd: string;
  path: string;
  ref?: string | null;
}

export interface GitReviewBlameLine {
  line: number;
  commitSha: string;
  author: string | null;
  authorTime: number | null;
  summary: string | null;
}

export interface GitReviewBlameResult {
  cwd: string;
  path: string;
  ref: string | null;
  lines: GitReviewBlameLine[];
  errorMessage: string | null;
}

export type GhCliAvailability =
  "available" | "missing-gh" | "not-authenticated" | "missing-remote" | "error";

export interface GhCliStatusResult {
  cwd: string;
  available: boolean;
  status: GhCliAvailability;
  message: string | null;
}

export interface GhPrStatusRequest {
  cwd: string;
  prNumber?: number | null;
}

export interface GhPrStatusResult {
  cwd: string;
  available: boolean;
  status: "ready" | "disabled" | "error";
  disabledReason: GhCliAvailability | null;
  prNumber: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  mergeStateStatus: string | null;
  message: string | null;
}

export interface GhPrCheckRun {
  name: string;
  status: string | null;
  conclusion: string | null;
  detailsUrl: string | null;
}

export interface GhPrChecksRequest {
  cwd: string;
  prNumber?: number | null;
}

export interface GhPrChecksResult {
  cwd: string;
  available: boolean;
  disabledReason: GhCliAvailability | null;
  checks: GhPrCheckRun[];
  message: string | null;
}

export interface GhPrComment {
  id: string;
  path: string | null;
  line: number | null;
  side?: "LEFT" | "RIGHT" | null;
  startLine?: number | null;
  startSide?: "LEFT" | "RIGHT" | null;
  replyToId?: string | null;
  outdated?: boolean | null;
  body: string;
  author: string | null;
  url: string | null;
}

export interface GhPrCommentsRequest {
  cwd: string;
  prNumber?: number | null;
}

export interface GhPrCommentsResult {
  cwd: string;
  available: boolean;
  disabledReason: GhCliAvailability | null;
  comments: GhPrComment[];
  message: string | null;
}

export interface GhPrDiffRequest {
  cwd: string;
  prNumber?: number | null;
}

export interface GhPrDiffResult {
  cwd: string;
  available: boolean;
  disabledReason: GhCliAvailability | null;
  patch: string;
  message: string | null;
}

export interface GhPrBaseCommentInput {
  cwd: string;
  prNumber: number;
  body: string;
}

export interface GhPrIssueCommentInput extends GhPrBaseCommentInput {
  type?: "comment";
}

export interface GhPrInlineCommentInput extends GhPrBaseCommentInput {
  type: "inline";
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  commitSha?: string | null;
}

export interface GhPrReplyCommentInput extends GhPrBaseCommentInput {
  type: "reply";
  commentId: string;
}

export type GhPrCommentInput =
  GhPrIssueCommentInput | GhPrInlineCommentInput | GhPrReplyCommentInput;

export interface GhPrCommentResult {
  cwd: string;
  available: boolean;
  disabledReason: GhCliAvailability | null;
  url: string | null;
  message: string | null;
}

export interface GhPrMergeInput {
  cwd: string;
  prNumber: number;
  method?: "merge" | "squash" | "rebase";
}

export interface GhPrUpdateInput {
  cwd: string;
  prNumber: number;
  title?: string | null;
  body?: string | null;
}

export interface GhPrCreateInput {
  cwd: string;
  title: string;
  body?: string | null;
  base?: string | null;
  head?: string | null;
  draft?: boolean;
}

export interface GhPrMutationResult {
  cwd: string;
  available: boolean;
  disabledReason: GhCliAvailability | null;
  url: string | null;
  message: string | null;
}

export interface CodexConversationChildThreadMetadata {
  nickname?: string | null;
  displayName?: string | null;
  name?: string | null;
  model?: string | null;
  agentRole?: string | null;
}

export interface CodexConversationChildMembership {
  threadId: string;
  parentThreadId: string;
  role: "childApproval" | "backgroundChild";
  actorName?: string;
  displayName?: string | null;
  thread?: CodexConversationChildThreadMetadata | null;
  agentRole?: string | null;
  agentPath?: string | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
  statusType?: CodexThreadStatusType;
  showInlineActivity?: boolean;
}

export interface CodexConversationCapabilityFlags {
  canEditLastUserTurn: boolean;
  canForkFromTurn: boolean;
  canSearch: boolean;
  canCollapseTurns: boolean;
}

export type CodexConversationServerRequest =
  | CodexApprovalRequest
  | CodexUserInputRequest
  | CodexMcpServerElicitationRequest
  | CodexPermissionRequest
  | NodexAgentAuthorizationRequest
  | CodexPlanImplementationServerRequest;

export type CodexConversationLiveRequest =
  | CodexConversationServerRequest
  | CodexOptionPickerRequest
  | CodexSetupCodexStepRequest;

export interface CodexConversationSnapshot extends CodexThreadSummary {
  latestCollaborationMode?: CodexCollaborationModeState;
  latestThreadSettings?: CodexConversationThreadSettings | null;
  latestTokenUsageInfo?: CodexThreadTokenUsage | null;
  threadGoal?: CodexAppServerThreadGoal | null;
  completedThreadGoal?: CodexAppServerThreadGoal | null;
  threadGoalResumeConfirmation?: CodexAppServerThreadGoal | null;
  resumeState: CodexConversationResumeState;
  turnPagination?: CodexConversationTurnPagination;
  turns: CodexConversationTurn[];
  /** Lossless event document for owner/no-owner canonical reducer handoff. */
  canonicalState?: CodexCanonicalConversationState | null;
  /**
   * Ordered raw request authority. `requests` remains the temporary UI
   * projection until the request projection milestone removes that adapter.
   */
  canonicalRequests?: CodexCanonicalServerRequest[];
  /** App-side unread state is independent from the protocol thread snapshot. */
  hasUnreadTurn?: boolean;
  /** Exact explicit-read side effect; absent hydrated values read as zero. */
  unreadMessageCount?: number;
  requests: CodexConversationServerRequest[];
  queuedFollowUps: CodexQueuedFollowUp[];
  pendingSteers: CodexPendingSteer[];
  backgroundTerminalRows: CodexBackgroundTerminalRow[];
  childMemberships: CodexConversationChildMembership[];
  capabilityFlags: CodexConversationCapabilityFlags;
}

export interface CodexBackgroundSubagentThreadsHydrateInput {
  threadIds: string[];
  includeTurns?: boolean;
}

export interface CodexSubagentPanelHydrateInput {
  rootThreadId: string;
  threadIds?: string[];
  includeTurns?: boolean;
}

export type CodexConversationPatchPathSegment = string | number;

export interface CodexConversationStateUpdate {
  op: "add" | "replace" | "remove";
  path: CodexConversationPatchPathSegment[];
  value?: unknown;
}

export type CodexThreadStartProgressPhase =
  "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";

export type CodexThreadStartProgressStream = "info" | "stdout" | "stderr";

export type CodexEvent =
  | { type: "connection"; connection: CodexConnectionState }
  | { type: "account"; account: CodexAccountSnapshot }
  | { type: "rateLimits"; rateLimits: CodexRateLimitsSnapshot | null }
  | { type: "appsUpdated"; apps: ProtocolAppInfo[] }
  | { type: "threadSummary"; thread: CodexThreadSummary }
  | { type: "threadDeleted"; threadId: string }
  | { type: "threadArchivedState"; threadId: string; archived: boolean }
  | { type: "scheduledAutomationChanged"; event: CodexScheduledAutomationChangedEvent }
  | { type: "automationRunsUpdated"; event: CodexAutomationRunsUpdatedEvent }
  | {
      type: "threadStatus";
      threadId: string;
      statusType: CodexThreadStatusType;
      statusActiveFlags: CodexThreadActiveFlag[];
    }
  | { type: "turn"; turn: CodexTurnSummary }
  | { type: "approvalRequested"; request: CodexApprovalRequest }
  | {
      type: "approvalResolved";
      requestId: CodexAppServerRequestId;
      decision: CodexApprovalDecision;
    }
  | { type: "userInputRequested"; request: CodexUserInputRequest }
  | { type: "userInputResolved"; requestId: CodexAppServerRequestId }
  | {
      type: "threadStartProgress";
      projectId: string | null;
      sessionId: string | null;
      runInTarget: PageRunInTarget;
      threadId?: string | null;
      phase: CodexThreadStartProgressPhase;
      message: string;
      stream?: CodexThreadStartProgressStream;
      outputDelta?: string;
      clearOutput?: boolean;
      updatedAt: number;
    }
  | { type: "error"; message: string; detail?: string };

export type CodexPendingThreadRequest =
  CodexApprovalRequest | CodexUserInputRequest | CodexPlanImplementationRequest;

export type CodexSharedObject =
  | {
      objectType: "connection";
      objectId: "connection";
      value: CodexConnectionState;
    }
  | {
      objectType: "account";
      objectId: "account";
      value: CodexAccountSnapshot;
    }
  | {
      objectType: "rateLimits";
      objectId: "rateLimits";
      value: CodexRateLimitsSnapshot | null;
    }
  | {
      objectType: "threadSummary";
      objectId: string;
      value: CodexThreadSummary;
    }
  | {
      objectType: "conversationChildMemberships";
      objectId: string;
      value: {
        parentThreadId: string;
        childMemberships: CodexConversationChildMembership[];
      };
    }
  | {
      objectType: "threadStartProgress";
      objectId: string;
      value: {
        projectId: string | null;
        sessionId: string | null;
        runInTarget: PageRunInTarget;
        threadId?: string | null;
        phase: CodexThreadStartProgressPhase;
        message: string;
        stream?: CodexThreadStartProgressStream;
        outputDelta?: string;
        clearOutput?: boolean;
        updatedAt: number;
      };
    };

export type CodexThreadStreamStateChange =
  | {
      type: "snapshot";
      revision: number;
      conversationState: CodexConversationSnapshot;
    }
  | {
      type: "patches";
      baseRevision: number;
      revision: number;
      patches: CodexConversationStateUpdate[];
    };

export interface CodexRendererClientRequestMessage {
  requestId: string;
  method: string;
  params: unknown;
}

export type CodexRendererClientResponseMessage =
  | {
      type: "success";
      requestId: string;
      result: unknown;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
    };

export type CodexRendererThreadRole = "owner" | "follower";

export interface CodexRendererThreadRoleRequest {
  conversationId: string;
}

export type CodexThreadOwnerActionRequest =
  | {
      type: "startTurn";
      threadId: string;
      prompt: string;
      opts?: CodexTurnStartOptions;
    }
  | {
      type: "steerTurn";
      input: CodexSteerTurnInput;
    }
  | {
      type: "interruptTurn";
      threadId: string;
      turnId?: string;
    }
  | {
      type: "updateThreadSettings";
      threadId: string;
      patch: CodexConversationThreadSettingsPatch;
    }
  | {
      type: "compactThread";
      threadId: string;
    }
  | ({
      type: "setThreadGoal";
    } & CodexThreadGoalSetActionInput)
  | {
      type: "clearThreadGoal";
      threadId: string;
    }
  | {
      type: "dismissThreadGoalResumeConfirmation";
      threadId: string;
    }
  | {
      type: "setThreadMemoryMode";
      threadId: string;
      mode: CodexAppServerThreadMemoryMode;
    }
  | {
      type: "editLastUserTurn";
      threadId: string;
      turnId: string;
      message: string;
      opts?: { serviceTier?: CodexServiceTier };
    }
  | {
      type: "forkConversationFromTurn";
      threadId: string;
      turnId: string;
      message: string;
    }
  | {
      type: "loadCompleteHistory";
      threadId: string;
    }
  | {
      type: "enqueueQueuedFollowUp";
      threadId: string;
      prompt: string;
      opts?: CodexTurnStartOptions;
    }
  | {
      type: "removeQueuedFollowUp";
      threadId: string;
      followUpId: string;
    }
  | {
      type: "reorderQueuedFollowUps";
      threadId: string;
      orderedFollowUpIds: string[];
    }
  | {
      type: "sendQueuedFollowUpNow";
      threadId: string;
      followUpId: string;
    }
  | {
      type: "respondApproval";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      response: CodexApprovalResponse;
    }
  | {
      type: "respondUserInput";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      answers: Record<string, string[]>;
    }
  | {
      type: "respondMcpElicitation";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      response: CodexMcpServerElicitationResponse;
    }
  | {
      type: "respondPermissionRequest";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      response: CodexPermissionRequestResponse;
    }
  | {
      type: "respondOptionPicker";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      response: CodexCanonicalOptionPickerResponse;
    }
  | {
      type: "respondSetupCodexStep";
      conversationId: string;
      requestId: CodexAppServerRequestId;
      response: CodexCanonicalSetupCodexStepResponse;
    }
  | {
      type: "removePlanImplementationRequest";
      threadId: string;
      turnId: string;
    };

export interface CodexThreadFollowerActionInput {
  conversationId: string;
  action: CodexThreadOwnerActionRequest;
}

export interface CodexThreadOwnerLoadCompleteHistoryResult {
  revision: number;
}

export interface CodexThreadOwnerStreamStatePublishInput {
  conversationId: string;
  change: CodexThreadStreamStateChange;
  ownerNotificationSequence?: number;
}

export interface CodexThreadOwnerNotificationAckInput {
  conversationId: string;
  sequence: number;
}

export type CodexRendererConversationResumeResult =
  | {
      role: "owner";
      conversation: CodexConversationSnapshot;
      revision: number;
    }
  | {
      role: "follower";
      conversation: CodexConversationSnapshot;
      revision: number;
      ownerClientId: string;
    };

export type CodexThreadOwnerServerRequest =
  | CodexProtocolServerRequestOf<
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/permissions/requestApproval"
    | "item/tool/requestUserInput"
    | "item/tool/call"
    | "mcpServer/elicitation/request"
  >
  | CodexCanonicalOptionPickerRequest
  | CodexCanonicalSetupContextPickerRequest;

export const CODEX_THREAD_OWNER_NOTIFICATION_METHODS = [
  "thread/started",
  "thread/name/updated",
  "thread/settings/updated",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "model/safetyBuffering/updated",
  "hook/started",
  "hook/completed",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "guardianWarning",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "serverRequest/resolved",
  "model/rerouted",
  "error",
] as const satisfies readonly CodexAppServerServerNotification["method"][];

export type CodexThreadOwnerNotificationMethod =
  (typeof CODEX_THREAD_OWNER_NOTIFICATION_METHODS)[number];

export type CodexThreadOwnerNotification = Extract<
  CodexAppServerServerNotification,
  { method: CodexThreadOwnerNotificationMethod }
>;

const CODEX_THREAD_OWNER_NOTIFICATION_METHOD_SET: ReadonlySet<
  CodexAppServerServerNotification["method"]
> = new Set(CODEX_THREAD_OWNER_NOTIFICATION_METHODS);

export function isCodexThreadOwnerNotification(
  notification: CodexAppServerServerNotification,
): notification is CodexThreadOwnerNotification {
  return CODEX_THREAD_OWNER_NOTIFICATION_METHOD_SET.has(notification.method);
}

export function getCodexThreadOwnerNotificationThreadId(
  notification: CodexThreadOwnerNotification,
): string {
  if (notification.method === "thread/started") return notification.params.thread.id;
  return notification.params.threadId;
}

export type CodexMcpNotificationMessage = {
  type: "mcpNotification";
  hostId: string;
  notification: Extract<
    CodexAppServerServerNotification,
    { method: "item/commandExecution/outputDelta" }
  >;
};

export type CodexHostMessage =
  | {
      type: "sharedObjectUpdated";
      hostId: string;
      object: CodexSharedObject;
    }
  | {
      type: "threadStreamStateChanged";
      hostId: string;
      conversationId: string;
      change: CodexThreadStreamStateChange;
      version: number;
      sourceClientId?: string | null;
    }
  | {
      type: "threadOwnerNotification";
      hostId: string;
      sequence: number;
      notification: CodexThreadOwnerNotification;
    }
  | {
      type: "threadOwnerRequest";
      hostId: string;
      request: CodexThreadOwnerServerRequest;
      sequence: number;
    }
  | {
      type: "threadOwnerUnavailable";
      hostId: string;
      ownerClientId: string;
      conversationIds: string[];
    }
  | {
      type: "threadTitleUpdated";
      hostId: string;
      conversationId: string;
      title: string;
    }
  | {
      type: "threadReadStateChanged";
      hostId: string;
      conversationId: string;
      hasUnreadTurn: boolean;
    }
  | {
      type: "threadArchived";
      hostId: string;
      conversationId: string;
    }
  | {
      type: "threadDeleted";
      hostId: string;
      threadId: string;
    }
  | {
      type: "sidebarSyncUpdated";
      hostId: string;
      result: CodexSidebarSyncResult;
      reason: CodexSidebarRefreshReason;
    }
  | CodexMcpNotificationMessage
  | { type: "error"; hostId: string; message: string; detail?: string };
