import type {
  ApprovalsReviewer as CodexAppServerApprovalsReviewer,
  AskForApproval as CodexAppServerAskForApproval,
  CommandAction as CodexAppServerCommandAction,
  CommandExecutionRequestApprovalParams as CodexAppServerCommandExecutionRequestApprovalParams,
  ExecPolicyAmendment as CodexAppServerExecPolicyAmendment,
  McpToolCallError as CodexAppServerMcpToolCallError,
  McpToolCallResult as CodexAppServerMcpToolCallResult,
  NetworkApprovalContext as CodexAppServerNetworkApprovalContext,
  SandboxMode as CodexAppServerSandboxMode,
  SandboxPolicy as CodexAppServerSandboxPolicy,
  ThreadItem as CodexAppServerThreadItem,
  UserInput as CodexAppServerUserInput,
} from "@nodex/codex-app-server-protocol/v2";

export type Priority = "p0-critical" | "p1-high" | "p2-medium" | "p3-low" | "p4-later";

export type Estimate = "xs" | "s" | "m" | "l" | "xl";
export type ResourceBlockKind = "text" | "file" | "folder";
export type ResourceBlockMode = "materialized" | "link";

export type CardRunInTarget = "localProject" | "newWorktree" | "cloud";
export type WorktreeStartMode = "autoBranch" | "detachedHead";

export {
  CARD_STATUS_COLUMNS,
  CARD_STATUS_LABELS,
  CARD_STATUS_ORDER,
  DEFAULT_CARD_STATUS,
  type CardStatus,
} from "./card-status";
import type { CardStatus } from "./card-status";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type RecurrenceEndCondition =
  | { type: "never" }
  | { type: "untilDate"; untilDate: string };

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
  | "calendar"
  | "card-stage"
  | "notification"
  | "api";

export interface CalendarOccurrence extends Card {
  cardId: string;
  statusName: string;
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
  thisAndFutureEquivalentToAll?: boolean;
}

export interface CardOccurrenceActionInput {
  cardId: string;
  occurrenceStart: Date;
  source: OccurrenceActionSource;
}

export interface CardOccurrenceUpdateInput extends CardOccurrenceActionInput {
  scope: OccurrenceEditScope;
  updates: OccurrenceTimingUpdates;
}

export interface Card {
  id: string;
  status: CardStatus;
  archived: boolean;
  title: string;
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
  agentBlocked: boolean;
  agentStatus?: string;
  runInTarget?: CardRunInTarget;
  runInLocalPath?: string;
  runInBaseBranch?: string;
  runInWorktreePath?: string;
  runInEnvironmentPath?: string;
  revision?: number;
  created: Date;
  order: number;
}

export interface Column {
  id: CardStatus;
  name: string;
  cards: Card[];
}

export interface Board {
  columns: Column[];
}

export interface CardInput {
  status?: CardStatus;
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
  agentBlocked?: boolean;
  agentStatus?: string;
  runInTarget?: CardRunInTarget;
  runInLocalPath?: string | null;
  runInBaseBranch?: string | null;
  runInWorktreePath?: string | null;
  runInEnvironmentPath?: string | null;
}

export interface CardCreateInput extends CardInput {
  id?: string;
}

export type CardUpdateResult =
  | {
      status: "updated";
      card: Card;
    }
  | {
      status: "conflict";
      card: Card;
    }
  | {
      status: "not_found";
    };

export type CardCreatePlacement = "top" | "bottom";

export interface MoveCardInput {
  cardId: string;
  fromStatus?: CardStatus;
  toStatus: CardStatus;
  // Insertion index after removing the dragged card from the target column.
  newOrder?: number;
  fieldPatch?: Pick<Partial<CardInput>, "priority" | "estimate">;
  groupId?: string;
}

export interface MoveCardsInput {
  cardIds: string[];
  fromStatus?: CardStatus;
  toStatus: CardStatus;
  // Insertion index after removing the dragged cards from the target column.
  newOrder?: number;
  fieldPatch?: Pick<Partial<CardInput>, "priority" | "estimate">;
  groupId?: string;
}

export interface MoveCardToProjectInput {
  cardId: string;
  sourceProjectId: string;
  sourceStatus?: CardStatus;
  targetProjectId: string;
  targetStatus?: CardStatus;
}

export interface MoveCardToProjectResult {
  cardId: string;
  sourceProjectId: string;
  sourceStatus: CardStatus;
  targetProjectId: string;
  targetStatus: CardStatus;
}

export interface BlockDropImportSourceUpdate {
  projectId: string;
  status?: CardStatus;
  cardId: string;
  updates: Partial<CardInput>;
}

export interface BlockDropImportInput {
  targetStatus: CardStatus;
  insertIndex?: number;
  cards: CardCreateInput[];
  sourceUpdates: BlockDropImportSourceUpdate[];
  groupId?: string;
}

export interface BlockDropImportResult {
  cards: Card[];
  groupId: string;
}

export interface CardDropMoveToEditorInput {
  sourceProjectId?: string;
  sourceCardId: string;
  sourceStatus?: CardStatus;
  sourceCards?: Array<{
    cardId: string;
    status?: CardStatus;
  }>;
  targetUpdates: BlockDropImportSourceUpdate[];
  groupId?: string;
}

export interface CardDropMoveToEditorResult {
  sourceCardId: string;
  sourceStatus: CardStatus;
  sourceCardIds: string[];
  updatedCardIds: string[];
  groupId: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  icon?: string;
  workspacePath?: string;
  created: Date;
}

export interface ProjectInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  workspacePath?: string | null;
}

export type ProjectSessionDbView = "kanban" | "list" | "toggle-list" | "canvas" | "calendar";

export type ProjectSessionTabKind =
  | "db_view"
  | "card_stage"
  | "terminal"
  | "browser_placeholder";

export interface ProjectSessionDbViewTabConfig {
  projectId: string;
  view: ProjectSessionDbView;
}

export interface ProjectSessionCardStageTabConfig {
  projectId: string;
  cardId: string;
  titleSnapshot?: string;
}

export interface ProjectSessionTerminalTabConfig {
  projectId: string;
  terminalSessionId: string;
  mode: "project" | "card";
  cardId?: string;
}

export interface ProjectSessionBrowserPlaceholderTabConfig {
  url?: string;
  title?: string;
}

export type ProjectSessionTabConfig =
  | ProjectSessionDbViewTabConfig
  | ProjectSessionCardStageTabConfig
  | ProjectSessionTerminalTabConfig
  | ProjectSessionBrowserPlaceholderTabConfig;

export interface ProjectSessionSplitLeaf {
  type: "leaf";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export interface ProjectSessionSplitBranch {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  first: ProjectSessionRightPaneNode;
  second: ProjectSessionRightPaneNode;
  ratio: number;
}

export type ProjectSessionRightPaneNode = ProjectSessionSplitLeaf | ProjectSessionSplitBranch;

export interface ProjectSessionRightPaneLayout {
  version: 1;
  root: ProjectSessionRightPaneNode;
}

export interface ProjectSessionTab {
  id: string;
  sessionId: string;
  projectId: string;
  kind: ProjectSessionTabKind;
  title: string;
  order: number;
  config: ProjectSessionTabConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSessionThreadLink {
  sessionId: string;
  projectId: string;
  threadId: string;
  parentThreadId?: string;
  threadName?: string;
  threadPreview: string;
  modelProvider: string;
  cwd?: string;
  statusType: string;
  statusActiveFlags: string[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export interface ProjectSession {
  id: string;
  projectId: string;
  title: string;
  isOverview: boolean;
  order: number;
  leftPaneCollapsed: boolean;
  rightPaneCollapsed: boolean;
  rightPaneLayout: ProjectSessionRightPaneLayout;
  thread: ProjectSessionThreadLink | null;
  tabs: ProjectSessionTab[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSessionCreateInput {
  projectId: string;
  title: string;
}

export interface ProjectSessionUpdateInput {
  title?: string;
  leftPaneCollapsed?: boolean;
  rightPaneCollapsed?: boolean;
  rightPaneLayout?: ProjectSessionRightPaneLayout;
}

export interface ProjectSessionTabCreateInput {
  sessionId: string;
  projectId: string;
  kind: ProjectSessionTabKind;
  title: string;
  config: ProjectSessionTabConfig;
}

export interface ProjectSessionTabUpdateInput {
  title?: string;
  config?: ProjectSessionTabConfig;
}

export interface ProjectSessionThreadLinkInput {
  sessionId: string;
  projectId: string;
  threadId: string;
  parentThreadId?: string | null;
  threadName?: string | null;
  threadPreview?: string;
  modelProvider?: string;
  cwd?: string | null;
  statusType?: string;
  statusActiveFlags?: string[];
  archived?: boolean;
  createdAt?: number;
  updatedAt?: number;
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

export interface ManagedWorktreeRecord {
  threadId: string;
  projectId: string;
  projectName: string | null;
  cardId: string;
  cardTitle: string | null;
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

export type WorktreeEnvironmentConfigState = "success" | "parseError" | "readError";

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

export type DesktopNotificationKind = "turn-complete" | "permission" | "question";

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
  requestId?: string;
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

export interface CanvasData {
  elements: string;
  appState: string;
  files: string;
  updated: string;
}

export type CodexThreadStatusType = "notLoaded" | "idle" | "systemError" | "active";
export type CodexThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

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

export type CodexAccountIdentity =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string; planType: string };

export interface CodexAccountSnapshot {
  account: CodexAccountIdentity | null;
  requiresOpenAiAuth: boolean;
  pendingLogin?: {
    loginId: string;
    authUrl: string;
  } | null;
  rateLimits?: CodexRateLimitsSnapshot | null;
}

export interface CodexDictationStateSnapshot {
  isEnabled: boolean;
  authMethod: "chatgpt" | "apiKey" | null;
  isRealtimeVoiceActive: boolean;
  shortcutLabel: string;
}

export interface CodexThreadSummary {
  threadId: string;
  projectId: string | null;
  cardId: string | null;
  source: CodexConversationSource | null;
  threadName: string | null;
  threadPreview: string;
  modelProvider: string;
  cwd: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: CodexApprovalsReviewer | null;
  sandbox?: CodexSandboxPolicy | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export type CodexConversationResumeState = "needs_resume" | "resuming" | "resumed";

export interface CodexConversationSource {
  parentThreadId: string | null;
}

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexThreadDetailLevel = "STEPS_PROSE" | "STEPS_COMMANDS" | "STEPS_EXECUTION";
export type CodexServiceTier = "fast" | null;
export type CodexApprovalPolicy = CodexAppServerAskForApproval;
export type CodexApprovalsReviewer = CodexAppServerApprovalsReviewer;
export type CodexSandboxMode = CodexAppServerSandboxMode;
export type CodexSandboxPolicy = CodexAppServerSandboxPolicy;

export type CodexCollaborationModeKind = "default" | "plan";

export interface CodexCollaborationModeState {
  mode: CodexCollaborationModeKind;
  settings: {
    model: string;
    reasoning_effort: CodexReasoningEffort | null;
    developer_instructions: null;
  };
}

export interface CodexCollaborationModePreset {
  name: string;
  mode: CodexCollaborationModeKind;
  model: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: CodexReasoningEffort;
  description: string;
}

export interface CodexModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: CodexReasoningEffort;
  isDefault: boolean;
}

export interface CodexThreadSettings {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  detailLevel?: CodexThreadDetailLevel;
}

export interface CodexThreadStartForCardInput {
  projectId: string;
  cardId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  threadName?: string;
  model?: string;
  serviceTier?: CodexServiceTier;
  permissionMode?: CodexPermissionMode;
  reasoningEffort?: CodexReasoningEffort;
  collaborationMode?: CodexCollaborationModeKind;
  worktreeStartMode?: WorktreeStartMode;
  worktreeBranchPrefix?: string;
}

export interface CodexThreadStartForSessionInput {
  projectId: string;
  sessionId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  threadName?: string;
  model?: string;
  serviceTier?: CodexServiceTier;
  permissionMode?: CodexPermissionMode;
  reasoningEffort?: CodexReasoningEffort;
  collaborationMode?: CodexCollaborationModeKind;
  runInTarget?: CardRunInTarget;
  runInEnvironmentPath?: string | null;
  worktreeStartMode?: WorktreeStartMode;
  worktreeBranchPrefix?: string;
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

export interface CodexPromptAgentConfigInput {
  mode?: string;
  model?: string;
  reasoning?: string;
  unknownAttributes?: string[];
}

export interface CodexPromptInput {
  text: string;
  images?: CodexPromptImageInput[];
  mentions?: CodexPromptMentionInput[];
  skills?: CodexPromptSkillInput[];
  agentConfigs?: CodexPromptAgentConfigInput[];
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
}

export interface CodexThreadActionResult {
  threadId: string;
  composerIntent: CodexComposerIntent;
}

export type CodexPermissionPreset = "read-only" | "auto" | "guardian-approvals" | "full-access";
export type CodexPermissionMode = "auto" | "guardian-approvals" | "full-access" | "custom";

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
  guardianApprovalEnabled: boolean;
  configTarget: CodexPermissionConfigTarget;
  customDescription: string | null;
}

export type CodexTurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

export interface CodexTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexThreadTokenUsage {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface CodexTurnSummary {
  threadId: string;
  turnId: string;
  status: CodexTurnStatus;
  errorMessage?: string;
  diff?: string;
  itemIds: string[];
  turnStartedAtMs?: number | null;
  finalAssistantStartedAtMs?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  interruptedCommandExecutionItemIds?: string[];
  tokenUsage?: CodexThreadTokenUsage;
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
  | "webSearch"
  | "workedFor"
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
  | "userInputResponse"
  | "hook"
  | "planImplementation"
  | "systemEvent";

export type CodexToolCallSubtype = "mcp" | "webSearch" | "generic" | "command" | "fileChange";
export type CodexItemStatus = "inProgress" | "completed" | "failed" | "declined" | "interrupted";
export type CodexTranscriptEntryKind = CodexItemNormalizedKind;
export type CodexTranscriptEntryStatus = CodexItemStatus;
export type CodexTranscriptEntrySource = "live" | "bootstrap" | "replay" | "optimistic";
export type CodexFileChangeKind = "add" | "delete" | "update";

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
  | CodexUserFileAttachment
  | CodexUserImageAttachment;

export type ProtocolThreadItem = CodexAppServerThreadItem;
export type ProtocolCommandExecutionItem = Extract<ProtocolThreadItem, { type: "commandExecution" }>;
export type ProtocolMcpToolCallItem = Extract<ProtocolThreadItem, { type: "mcpToolCall" }>;
export type ProtocolCommandAction = CodexAppServerCommandAction;
export type ProtocolMcpToolCallResult = CodexAppServerMcpToolCallResult;
export type ProtocolMcpToolCallError = CodexAppServerMcpToolCallError;
export type ProtocolCommandExecutionApprovalParams = CodexAppServerCommandExecutionRequestApprovalParams;
export type ProtocolExecPolicyAmendment = CodexAppServerExecPolicyAmendment;
export type ProtocolNetworkApprovalContext = CodexAppServerNetworkApprovalContext;

export type CodexCommandAction = ProtocolCommandAction;

export interface CodexCommandExecutionAttachmentFields {
  command?: ProtocolCommandExecutionItem["command"] | null;
  cwd?: ProtocolCommandExecutionItem["cwd"] | null;
  processId?: ProtocolCommandExecutionItem["processId"];
  commandActions?: ProtocolCommandExecutionItem["commandActions"];
  aggregatedOutput?: ProtocolCommandExecutionItem["aggregatedOutput"];
  exitCode?: ProtocolCommandExecutionItem["exitCode"];
  durationMs?: ProtocolCommandExecutionItem["durationMs"];
  approvalRequestId?: string | null;
  networkApprovalContext?: ProtocolNetworkApprovalContext | null;
  proposedExecpolicyAmendment?: ProtocolExecPolicyAmendment | null;
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
    };

export interface CodexFileChangeView {
  label?: string;
  paths: string[];
  changes: CodexFileChange[];
  diffs: string[];
}

export interface CodexTurnDiffReviewTarget {
  type: "turnDiff";
  threadId: string;
  turnId: string;
  entryId: string;
  patch: string;
  cwd: string | null;
  showRevertButton: boolean;
}

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
  arguments: unknown;
}

export type CodexMcpToolCallContentBlock =
  | {
      type: "text";
      text: string;
      annotations?: unknown;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: unknown;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: unknown;
    }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      annotations?: unknown;
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
        annotations?: unknown;
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
      structuredContent: unknown;
      raw: {
        content: unknown[];
        structuredContent: unknown;
      };
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
  invocation: CodexMcpToolCallInvocation;
  result: CodexMcpToolCallNormalizedResult;
  durationMs: ProtocolMcpToolCallItem["durationMs"];
  completed: boolean;
}

export interface CodexItemView extends CodexCommandExecutionAttachmentFields {
  threadId: string;
  turnId: string;
  itemId: string;
  type: string;
  normalizedKind: CodexItemNormalizedKind;
  semanticKind?: CodexSemanticItemKind;
  assistantPhase?: string;
  timeLabel?: string;
  status?: CodexItemStatus;
  role?: "user" | "assistant";
  toolCall?: CodexToolCallView;
  mcpToolCall?: CodexMcpToolCallView;
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  userAttachments?: CodexUserAttachment[];
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
  turnId: string;
  entryId?: string;
  itemId: string;
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
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  userAttachments?: CodexUserAttachment[];
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
  turns: CodexTurnSummary[];
  transcript: CodexTranscriptEntry[];
}

export interface CodexConversationItem extends CodexTranscriptEntry {
  requestId?: string;
}

export interface CodexConversationTurn extends CodexTurnSummary {
  items: CodexConversationItem[];
}

export type CodexApprovalKind = "command" | "file";
export type CodexNetworkApprovalContext = ProtocolNetworkApprovalContext;

export interface CodexNetworkPolicyAmendment {
  host: string;
  action: "allow" | "deny";
}

export type CodexApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ProtocolExecPolicyAmendment;
      };
    }
  | {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: CodexNetworkPolicyAmendment;
      };
    };

export interface CodexApprovalRequest {
  type: "approval";
  requestId: string;
  kind: CodexApprovalKind;
  projectId: string | null;
  cardId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  approvalRequestId?: string | null;
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

export interface CodexUserInputOption {
  label: string;
  description: string;
}

export interface CodexUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options?: CodexUserInputOption[];
}

export interface CodexUserInputRequest {
  type: "userInput";
  requestId: string;
  projectId: string | null;
  cardId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexUserInputQuestion[];
  createdAt: number;
}

export interface CodexPlanImplementationServerRequest {
  type: "implementPlan";
  requestId: string;
  projectId: string | null;
  cardId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  planContent: string;
  createdAt: number;
}

export type CodexPlanImplementationRequest = CodexPlanImplementationServerRequest;

export interface CodexMcpElicitationOption {
  value: string;
  label: string;
  description?: string;
}

export interface CodexMcpServerElicitationRequest {
  type: "mcpServerElicitation";
  requestId: string;
  projectId: string | null;
  cardId: string | null;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: "generic" | "mcpToolCall" | "toolSuggestion";
  mode: "form" | "url";
  serverName: string;
  message: string;
  url?: string;
  elicitationId?: string;
  requestedSchema?: unknown;
  meta?: unknown;
  createdAt: number;
}

export type CodexMcpServerElicitationAction = "accept" | "decline" | "cancel";

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
  command: string;
  cwd: string | null;
  processId?: number | string | null;
  previewLine: string | null;
}

export type GitReviewSource = "unstaged" | "staged" | "branch";

export type GitReviewFileStatus = "modified" | "added" | "deleted" | "renamed";

export type GitApplyPatchTarget = "staged" | "unstaged";

export type GitApplyPatchStatus = "success" | "partial-success" | "error";

export interface GitReviewFileSummary {
  path: string;
  previousPath: string | null;
  status: GitReviewFileStatus;
  additions: number;
  deletions: number;
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
}

export interface GitReviewFileContentsInput {
  cwd: string;
  source: GitReviewSource;
  path: string;
  previousPath?: string | null;
  baseRef?: string | null;
}

export interface GitReviewFileContents {
  path: string;
  previousPath: string | null;
  oldText: string | null;
  newText: string | null;
  oldExists: boolean;
  newExists: boolean;
  errorMessage: string | null;
}

export interface GitReviewSearchInput {
  cwd: string;
  source: GitReviewSource;
  query: string;
  baseRef?: string | null;
}

export interface GitReviewSearchResult {
  query: string;
  matchingPaths: string[];
}

export interface GitApplyPatchInput {
  cwd: string;
  diff: string;
  target: GitApplyPatchTarget;
  revert?: boolean;
}

export interface GitApplyPatchResult {
  status: GitApplyPatchStatus;
  appliedPaths: string[];
  skippedPaths: string[];
  conflictedPaths: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CodexConversationChildMembership {
  threadId: string;
  parentThreadId: string;
  role: "childApproval" | "backgroundChild";
  actorName?: string;
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
  | CodexPlanImplementationServerRequest;

export type CodexConversationLiveRequest = CodexConversationServerRequest;

export interface CodexConversationSnapshot extends CodexThreadSummary {
  latestCollaborationMode?: CodexCollaborationModeState;
  resumeState: CodexConversationResumeState;
  turns: CodexConversationTurn[];
  requests: CodexConversationServerRequest[];
  queuedFollowUps: CodexQueuedFollowUp[];
  pendingSteers: CodexPendingSteer[];
  backgroundTerminalRows: CodexBackgroundTerminalRow[];
  childMemberships: CodexConversationChildMembership[];
  capabilityFlags: CodexConversationCapabilityFlags;
}

export type CodexConversationPatchPathSegment = string | number;

export interface CodexConversationStateUpdate {
  op: "add" | "replace" | "remove";
  path: CodexConversationPatchPathSegment[];
  value?: unknown;
}

export type CodexThreadStartProgressPhase =
  | "creatingWorktree"
  | "runningSetup"
  | "startingThread"
  | "ready"
  | "failed";

export type CodexThreadStartProgressStream = "info" | "stdout" | "stderr";

export type CodexEvent =
  | { type: "connection"; connection: CodexConnectionState }
  | { type: "account"; account: CodexAccountSnapshot }
  | { type: "rateLimits"; rateLimits: CodexRateLimitsSnapshot | null }
  | { type: "threadSummary"; thread: CodexThreadSummary }
  | { type: "threadArchivedState"; threadId: string; archived: boolean }
  | {
      type: "threadStatus";
      threadId: string;
      statusType: CodexThreadStatusType;
      statusActiveFlags: CodexThreadActiveFlag[];
    }
  | { type: "turn"; turn: CodexTurnSummary }
  | { type: "approvalRequested"; request: CodexApprovalRequest }
  | { type: "approvalResolved"; requestId: string; decision: CodexApprovalDecision }
  | { type: "userInputRequested"; request: CodexUserInputRequest }
  | { type: "userInputResolved"; requestId: string }
  | {
      type: "threadStartProgress";
      projectId: string | null;
      cardId: string | null;
      phase: CodexThreadStartProgressPhase;
      message: string;
      stream?: CodexThreadStartProgressStream;
      outputDelta?: string;
      clearOutput?: boolean;
      updatedAt: number;
    }
  | { type: "error"; message: string; detail?: string };

export type CodexPendingThreadRequest =
  | CodexApprovalRequest
  | CodexUserInputRequest
  | CodexPlanImplementationRequest;

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
      objectType: "threadStartProgress";
      objectId: string;
      value: {
        projectId: string | null;
        cardId: string | null;
        phase: CodexThreadStartProgressPhase;
        message: string;
        stream?: CodexThreadStartProgressStream;
        outputDelta?: string;
        clearOutput?: boolean;
        updatedAt: number;
      };
    };

export type CodexThreadStreamStateChange =
  | { type: "snapshot"; conversationState: CodexConversationSnapshot }
  | { type: "patches"; patches: CodexConversationStateUpdate[] };

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
      type: "threadTitleUpdated";
      hostId: string;
      conversationId: string;
      title: string;
    }
  | { type: "error"; hostId: string; message: string; detail?: string };
