import type {
  ApprovalsReviewer as CodexAppServerApprovalsReviewer,
  AppInfo as CodexAppServerAppInfo,
  AskForApproval as CodexAppServerAskForApproval,
  CommandAction as CodexAppServerCommandAction,
  CommandExecutionOutputDeltaNotification as CodexAppServerCommandExecutionOutputDeltaNotification,
  CommandExecutionRequestApprovalParams as CodexAppServerCommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams as CodexAppServerFileChangeRequestApprovalParams,
  DynamicToolCallOutputContentItem as CodexAppServerDynamicToolCallOutputContentItem,
  DynamicToolCallParams as CodexAppServerDynamicToolCallParams,
  DynamicToolCallResponse as CodexAppServerDynamicToolCallResponse,
  ExecPolicyAmendment as CodexAppServerExecPolicyAmendment,
  ListMcpServerStatusResponse as CodexAppServerListMcpServerStatusResponse,
  McpResourceReadParams as CodexAppServerMcpResourceReadParams,
  McpResourceReadResponse as CodexAppServerMcpResourceReadResponse,
  McpServerElicitationRequestParams as CodexAppServerMcpServerElicitationRequestParams,
  McpServerElicitationRequestResponse as CodexAppServerMcpServerElicitationRequestResponse,
  McpServerStatus as CodexAppServerMcpServerStatus,
  McpToolCallError as CodexAppServerMcpToolCallError,
  McpToolCallResult as CodexAppServerMcpToolCallResult,
  NetworkApprovalContext as CodexAppServerNetworkApprovalContext,
  PermissionsRequestApprovalParams as CodexAppServerPermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse as CodexAppServerPermissionsRequestApprovalResponse,
  SandboxMode as CodexAppServerSandboxMode,
  SandboxPolicy as CodexAppServerSandboxPolicy,
  ReviewStartParams as CodexAppServerReviewStartParams,
  ReviewStartResponse as CodexAppServerReviewStartResponse,
  ReviewTarget as CodexAppServerReviewTarget,
  ThreadGoal as CodexAppServerThreadGoal,
  ThreadGoalSetParams as CodexAppServerThreadGoalSetParams,
  ThreadBackgroundTerminal as CodexAppServerThreadBackgroundTerminal,
  ThreadStatus as CodexAppServerThreadStatus,
  ThreadSettings as CodexAppServerThreadSettings,
  ThreadSource as CodexAppServerThreadSource,
  ThreadItem as CodexAppServerThreadItem,
  ToolRequestUserInputParams as CodexAppServerToolRequestUserInputParams,
  TurnItemsView as CodexAppServerTurnItemsView,
  UserInput as CodexAppServerUserInput,
} from "@nodex/codex-app-server-protocol/v2";
import type { ThreadMemoryMode as CodexAppServerThreadMemoryMode } from "@nodex/codex-app-server-protocol";

export type Priority =
  "p0-critical" | "p1-high" | "p2-medium" | "p3-low" | "p4-later";

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
  "calendar" | "card-stage" | "notification" | "api";

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

export interface CardSummary extends Omit<Card, "description"> {
  descriptionPreview: string;
  descriptionLength: number;
  hasDescription: boolean;
}

export interface Column {
  id: CardStatus;
  name: string;
  cards: Card[];
}

export interface Board {
  columns: Column[];
}

export interface BoardSummaryColumn {
  id: CardStatus;
  name: string;
  cards: CardSummary[];
}

export interface BoardSummary {
  columns: BoardSummaryColumn[];
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

export type CardUpdateField = keyof CardInput;

export type CardUpdateResult =
  | {
      status: "updated";
      projectId: string;
      cardId: string;
      revision: number;
      summary: CardSummary;
      changedFields: CardUpdateField[];
      didMutate: boolean;
    }
  | {
      status: "conflict";
      card: Card;
    }
  | {
      status: "not_found";
    };

export interface CardDescriptionUpdateStartInput {
  projectId: string;
  columnId?: Card["status"];
  cardId: string;
  sessionId?: string;
  expectedRevision?: number;
}

export interface CardsDetailsInput {
  cardIds: string[];
}

export interface CardSearchInput {
  projectIds: string[];
  query: string;
  limit?: number;
}

export interface CardSearchResult {
  projectId: string;
  cardId: string;
  status: CardStatus;
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
  projectless: boolean;
  pinned: boolean;
  pinnedOrder: number | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export interface CommandPaletteThreadListInput {
  scope: "sidebar";
}

export interface CommandPaletteThreadContentSearchInput {
  scope: "sidebar";
  query: string;
  limit?: number;
}

export interface CommandPaletteThreadIndexUpdatedEvent {
  generation: number;
  reason: "backfill";
}

export interface CommandPaletteSearchSnippetSegment {
  text: string;
  highlight: boolean;
}

export interface CommandPaletteThreadContentSearchResult {
  threadId: string;
  snippet: string;
  score: number;
  matchKind: "fts";
  snippetSegments?: CommandPaletteSearchSnippetSegment[];
}

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

export interface ProjectSource {
  root: string;
  order: number;
}

export interface Project {
  id: string;
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
  "db_view" | "card_stage" | "terminal" | "browser" | "review" | "files";

export const PROJECT_SESSION_SINGLETON_TAB_KINDS = [
  "review",
] as const satisfies readonly ProjectSessionTabKind[];

export type ProjectSessionSingletonTabKind =
  (typeof PROJECT_SESSION_SINGLETON_TAB_KINDS)[number];

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
  projectId?: string | null;
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
  projectId: string;
  hostId: "local";
  workspaceRoot: string;
  path?: string;
}

export interface ProjectSessionBrowserTabConfig {
  projectId: string;
  url?: string;
  title?: string;
  faviconUrl?: string;
  deviceToolbarVisible?: boolean;
}

export type ProjectSessionTabConfig =
  | ProjectSessionDbViewTabConfig
  | ProjectSessionCardStageTabConfig
  | ProjectSessionTerminalTabConfig
  | ProjectSessionBrowserTabConfig
  | ProjectSessionFilesTabConfig
  | ProjectSessionProjectScopedTabConfig;

export type WorkspaceFileHostId = "local";

export type WorkspaceFileEntryKind = "directory" | "file" | "symlink" | "other";

export interface WorkspaceFileDirectoryEntry {
  name: string;
  path: string;
  kind: WorkspaceFileEntryKind;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modifiedAtMs: number;
  hidden: boolean;
}

export interface WorkspaceDirectoryEntriesInput {
  hostId?: WorkspaceFileHostId;
  workspaceRoot: string;
  path?: string;
  includeHidden?: boolean;
  includeGenerated?: boolean;
}

export interface WorkspaceDirectoryEntriesResult {
  hostId: WorkspaceFileHostId;
  workspaceRoot: string;
  path: string;
  entries: WorkspaceFileDirectoryEntry[];
}

export interface WorkspaceFileRequest {
  hostId?: WorkspaceFileHostId;
  workspaceRoot?: string;
  path: string;
}

export interface WorkspaceFileReadInput extends WorkspaceFileRequest {
  maxBytes?: number;
}

export interface WorkspaceFileReadResult {
  path: string;
  content: string;
  encoding: "utf8";
  size: number;
  truncated: boolean;
  binary: boolean;
}

export interface WorkspaceFileBinaryReadResult {
  path: string;
  dataBase64: string;
  size: number;
  mimeType: string | null;
}

export interface WorkspaceFileMetadata {
  path: string;
  kind: WorkspaceFileEntryKind;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  createdAtMs: number;
  modifiedAtMs: number;
  binary: boolean;
  mimeType: string | null;
}

export interface WorkspaceFileWriteInput extends WorkspaceFileRequest {
  content: string;
}

export interface WorkspaceFileWriteResult {
  path: string;
  size: number;
  modifiedAtMs: number;
}

export interface WorkspacePathsExistInput {
  hostId?: WorkspaceFileHostId;
  paths: string[];
}

export interface WorkspacePathsExistResult {
  paths: Record<string, boolean>;
}

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
  projectId: string;
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

export interface ProjectSessionThreadLink {
  sessionId: string;
  projectId: string | null;
  threadId: string;
  parentThreadId?: string;
  threadName?: string;
  threadPreview: string;
  modelProvider: string;
  cwd?: string;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  statusType: string;
  statusActiveFlags: string[];
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
  worktreeStartMode?: WorktreeStartMode;
  worktreeBranchPrefix?: string;
  turnId?: string;
  message?: string;
  collaborationMode?: CodexCollaborationModeKind;
}

export interface ProjectSessionForkResult {
  session: ProjectSession;
  threadId: string;
  composerIntent?: CodexComposerIntent;
}

export interface ProjectSessionTabCreateInput {
  sessionId: string;
  projectId: string;
  panelId: PanelId;
  targetLeafId?: string;
  clientTabId?: string;
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
  parentThreadId?: string | null;
  threadName?: string | null;
  threadPreview?: string;
  modelProvider?: string;
  cwd?: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  statusType?: string;
  statusActiveFlags?: string[];
  archived?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type CodexSidebarThreadKind = "local" | "remote" | "pending-worktree";

export interface CodexSidebarThreadItem {
  key: string;
  kind: CodexSidebarThreadKind;
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
  source: "sqlite" | "app-server";
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

export type CodexThreadStatusType =
  "notLoaded" | "idle" | "systemError" | "active";
export type CodexThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
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
  source: CodexConversationSource | null;
  ephemeral?: boolean;
  threadSource?: CodexAppServerThreadSource | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  threadName: string | null;
  threadPreview: string;
  modelProvider: string;
  cwd: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: CodexApprovalsReviewer | null;
  sandbox?: CodexSandboxPolicy | null;
  latestTokenUsageInfo?: CodexThreadTokenUsage | null;
  statusType: CodexThreadStatusType;
  statusActiveFlags: CodexThreadActiveFlag[];
  threadRuntimeStatus?: CodexThreadRuntimeStatus | null;
  archived: boolean;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  linkedAt: string;
}

export type CodexScheduledAutomationKind = "cron" | "heartbeat";
export type CodexScheduledAutomationStatus = "ACTIVE" | "PAUSED" | "DELETED";

export interface CodexScheduledAutomation {
  id: string;
  kind: CodexScheduledAutomationKind;
  status: CodexScheduledAutomationStatus;
  targetThreadId: string | null;
  name: string;
  rrule: string | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodexScheduledAutomationUpsertInput {
  id: string;
  kind: CodexScheduledAutomationKind;
  status: CodexScheduledAutomationStatus;
  targetThreadId?: string | null;
  name: string;
  rrule?: string | null;
  nextRunAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface CodexScheduledAutomationChangedEvent {
  automationId: string;
  targetThreadId: string | null;
  reason: "upsert" | "delete";
}

export type CodexConversationResumeState =
  "needs_resume" | "resuming" | "resumed";

export interface CodexConversationSource {
  parentThreadId: string | null;
  sideConversation?: boolean;
  sideConversationParentNavigationPath?: string | null;
}

export type CodexReasoningEffort =
  "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexThreadDetailLevel =
  "STEPS_PROSE" | "STEPS_COMMANDS" | "STEPS_EXECUTION";
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

export interface CodexConversationThreadSettings {
  model: CodexAppServerThreadSettings["model"];
  reasoningEffort: CodexReasoningEffort | null;
  collaborationMode: CodexCollaborationModeState | null;
}

export interface CodexConversationThreadSettingsPatch {
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  collaborationMode?: CodexCollaborationModeKind | null;
}

export interface CodexThreadGoalSetActionInput extends CodexAppServerThreadGoalSetParams {
  appendTranscriptItem?: boolean;
  threadSettings?: CodexConversationThreadSettingsPatch;
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

export interface CodexThreadGoalDraftInput {
  objective: string;
  pastedTextAttachments?: CodexThreadGoalPastedTextAttachmentInput[];
  imageAttachments?: CodexThreadGoalImageAttachmentInput[];
  attachmentDirectory?: string | null;
}

export interface CodexThreadGoalPastedTextAttachmentInput {
  text: string;
}

export interface CodexThreadGoalImageAttachmentInput {
  source: string;
  localPath?: string | null;
  filename?: string | null;
}

export interface CodexThreadGoalMaterializedDraft {
  objective: string;
  attachmentDirectory: string | null;
}

export interface CodexThreadStartForSessionInput {
  projectId: string;
  sessionId: string;
  prompt: string;
  promptInput?: CodexPromptInput;
  threadGoalDraft?: CodexThreadGoalDraftInput;
  threadName?: string;
  skipAutoTitleGeneration?: boolean;
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

export interface CodexSideChatStartInput {
  projectId: string;
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
  images?: CodexPromptImageInput[];
  mentions?: CodexPromptMentionInput[];
  skills?: CodexPromptSkillInput[];
  commentAttachments?: CodexReviewDiffCommentAttachment[];
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
  promptInput?: CodexPromptInput;
}

export interface CodexThreadActionResult {
  threadId: string;
  composerIntent?: CodexComposerIntent;
  streamRevision?: number;
}

export type CodexOwnerAppServerRequestMethod =
  | "thread/rollback"
  | "thread/fork"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt"
  | "thread/settings/update"
  | "thread/goal/set"
  | "thread/goal/clear"
  | "thread/memoryMode/set"
  | "thread/compact/start"
  | "thread/backgroundTerminals/list"
  | "thread/backgroundTerminals/terminate";

export interface CodexOwnerAppServerRequestInput {
  conversationId: string;
  request: {
    method: CodexOwnerAppServerRequestMethod;
    params: unknown;
  };
}

export type CodexPermissionPreset =
  "read-only" | "auto" | "guardian-approvals" | "full-access";
export type CodexPermissionMode =
  "auto" | "guardian-approvals" | "full-access" | "custom";

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

export type CodexTurnStatus =
  "inProgress" | "completed" | "interrupted" | "failed";

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

export interface CodexSafetyBufferingState {
  useCases: string[];
  reasons: string[];
  showBufferingUi: boolean;
  fasterModel: string | null;
}

export interface CodexTurnSummary {
  threadId: string;
  turnId: string;
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
  interruptedCommandExecutionItemIds?: string[];
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
  | "webSearch"
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
  "live" | "bootstrap" | "replay" | "optimistic";
export type CodexFileChangeKind = "add" | "delete" | "update";
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
export type ProtocolCommandExecutionApprovalParams =
  CodexAppServerCommandExecutionRequestApprovalParams;
export type ProtocolCommandExecutionOutputDeltaNotification =
  CodexAppServerCommandExecutionOutputDeltaNotification;
export type ProtocolExecPolicyAmendment = CodexAppServerExecPolicyAmendment;
export type ProtocolNetworkApprovalContext =
  CodexAppServerNetworkApprovalContext;

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

export interface CodexFileChangeView {
  label?: string;
  changes: CodexFileChangeMap;
}

export interface CodexTurnDiffPatchBatch {
  cwd: string | null;
  changes: unknown[];
}

export type CodexTurnDiffReviewSource = "last-turn" | "selected-turn";

export interface CodexTurnDiffReviewTarget {
  type: "turnDiff";
  threadId: string;
  turnId: string;
  entryId: string;
  patch: string;
  cwd: string | null;
  showRevertButton: boolean;
  path?: string | null;
  patchBatches?: CodexTurnDiffPatchBatch[];
  source?: CodexTurnDiffReviewSource;
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

export interface CodexDynamicToolCallView {
  callId: ProtocolDynamicToolCallItem["id"];
  namespace: ProtocolDynamicToolCallItem["namespace"];
  tool: ProtocolDynamicToolCallItem["tool"];
  arguments: ProtocolDynamicToolCallItem["arguments"];
  status: ProtocolDynamicToolCallItem["status"];
  contentItems: ProtocolDynamicToolCallItem["contentItems"];
  success: ProtocolDynamicToolCallItem["success"];
  durationMs: ProtocolDynamicToolCallItem["durationMs"];
  completed: boolean;
}

export type CodexMcpToolCallContentBlock =
  | {
      type: "text";
      text: string;
      annotations?: unknown;
      meta?: unknown;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: unknown;
      meta?: unknown;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: unknown;
      meta?: unknown;
    }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      annotations?: unknown;
      meta?: unknown;
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
        meta?: unknown;
      };
      meta?: unknown;
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
      meta?: unknown;
      raw: {
        content: unknown[];
        structuredContent: unknown;
        meta?: unknown;
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
  pluginId?: ProtocolMcpToolCallItem["pluginId"];
  mcpAppResourceUri?: ProtocolMcpToolCallItem["mcpAppResourceUri"] | null;
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
  dynamicToolCall?: CodexDynamicToolCallView;
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  goal?: boolean;
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
  dynamicToolCall?: CodexDynamicToolCallView;
  fileChange?: CodexFileChangeView;
  markdownText?: string;
  goal?: boolean;
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
  latestThreadSettings?: CodexConversationThreadSettings | null;
  turns: CodexTurnSummary[];
  transcript: CodexTranscriptEntry[];
}

export interface CodexConversationItem extends CodexTranscriptEntry {
  requestId?: string;
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
  requestId: string;
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

export type CodexMcpServerElicitationAction = "accept" | "decline" | "cancel";
export type CodexMcpServerElicitationResponse =
  CodexAppServerMcpServerElicitationRequestResponse;

export interface CodexPermissionRequest {
  type: "permissionRequest";
  requestId: string;
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
  files?: string[];
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  hostConfig?: Record<string, unknown> | null;
  operationSource?: string | null;
  requestId?: string | null;
}

export interface ReviewDiffResult {
  cwd: string;
  source: GitReviewSource;
  patch: string;
  files: ReviewDiffEntry[];
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

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
}

export interface GitReviewSummaryResult {
  cwd: string;
  source: GitReviewSource;
  baseRef: string | null;
  commitSha: string | null;
  files: GitReviewFileSummary[];
  additions: number;
  deletions: number;
  isGitRepository: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

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

export interface GitReviewFileContentsInput {
  cwd: string;
  source: GitReviewSource;
  path: string;
  previousPath?: string | null;
  baseRef?: string | null;
  commitSha?: string | null;
}

export interface GitReviewFileContents {
  path: string;
  previousPath: string | null;
  oldText: string | null;
  newText: string | null;
  oldExists: boolean;
  newExists: boolean;
  oldStatus: ReviewDiffLoadStatus;
  newStatus: ReviewDiffLoadStatus;
  safety: ReviewFileSafety;
  errorMessage: string | null;
}

export interface GitReviewSearchInput {
  cwd: string;
  source: GitReviewSource;
  query: string;
  baseRef?: string | null;
  baseBranch?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  limit?: number;
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
  | CodexPlanImplementationServerRequest;

export type CodexConversationLiveRequest = CodexConversationServerRequest;

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
  | { type: "threadSummary"; thread: CodexThreadSummary }
  | { type: "threadDeleted"; threadId: string }
  | { type: "threadArchivedState"; threadId: string; archived: boolean }
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
      requestId: string;
      decision: CodexApprovalDecision;
    }
  | { type: "userInputRequested"; request: CodexUserInputRequest }
  | { type: "userInputResolved"; requestId: string }
  | {
      type: "threadStartProgress";
      projectId: string | null;
      sessionId: string | null;
      runInTarget: CardRunInTarget;
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
        runInTarget: CardRunInTarget;
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
      requestId: string;
      decision: CodexApprovalDecision;
    }
  | {
      type: "respondUserInput";
      requestId: string;
      answers: Record<string, string[]>;
    }
  | {
      type: "respondMcpElicitation";
      requestId: string;
      response: CodexMcpServerElicitationResponse;
    }
  | {
      type: "respondPermissionRequest";
      requestId: string;
      response: CodexPermissionRequestResponse;
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

export type CodexThreadOwnerServerRequest =
  | {
      id: string;
      method: "item/commandExecution/requestApproval";
      params: CodexAppServerCommandExecutionRequestApprovalParams;
    }
  | {
      id: string;
      method: "item/fileChange/requestApproval";
      params: CodexAppServerFileChangeRequestApprovalParams;
    }
  | {
      id: string;
      method: "item/permissions/requestApproval";
      params: CodexAppServerPermissionsRequestApprovalParams;
    }
  | {
      id: string;
      method: "item/tool/requestUserInput";
      params: CodexAppServerToolRequestUserInputParams;
    }
  | {
      id: string;
      method: "item/tool/call";
      params: CodexAppServerDynamicToolCallParams;
    }
  | {
      id: string;
      method: "mcpServer/elicitation/request";
      params: CodexAppServerMcpServerElicitationRequestParams;
    };

export type CodexThreadOwnerNotificationMethod =
  | "thread/started"
  | "thread/name/updated"
  | "thread/settings/updated"
  | "thread/status/changed"
  | "thread/tokenUsage/updated"
  | "thread/goal/updated"
  | "thread/goal/cleared"
  | "turn/started"
  | "turn/completed"
  | "turn/interrupted"
  | "turn/failed"
  | "turn/diff/updated"
  | "turn/plan/updated"
  | "model/safetyBuffering/updated"
  | "hook/started"
  | "hook/completed"
  | "item/autoApprovalReview/started"
  | "item/autoApprovalReview/completed"
  | "guardianWarning"
  | "item/started"
  | "item/completed"
  | "item/agentMessage/delta"
  | "item/plan/delta"
  | "item/reasoning/summaryTextDelta"
  | "item/reasoning/summaryPartAdded"
  | "item/reasoning/textDelta"
  | "item/commandExecution/outputDelta"
  | "item/commandExecution/terminalInteraction"
  | "item/fileChange/outputDelta"
  | "item/fileChange/patchUpdated"
  | "item/mcpToolCall/progress"
  | "serverRequest/resolved"
  | "model/rerouted"
  | "error";

export type CodexMcpNotificationMessage = {
  type: "mcpNotification";
  hostId: string;
  method: "item/commandExecution/outputDelta";
  params: ProtocolCommandExecutionOutputDeltaNotification;
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
      method: CodexThreadOwnerNotificationMethod;
      sequence: number;
      params: unknown;
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
