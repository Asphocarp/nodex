import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
  DocumentSyncSubscriptionAck,
  DocumentSyncUnsubscribeAck,
} from "./block-documents/document-sync";
import type {
  OwnedBlockDocumentDescriptor,
  RelocationCommandResult,
} from "./block-documents/contracts";
import type { DocumentRelocationRequest } from "./block-documents/relocation-transport";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "./block-documents/document-operations";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
} from "./block-documents/document-history";
import type { DocumentHistoryCommandResult } from "./block-documents/document-history-transport";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "./block-property-mutations";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "./database-kernel";
import type {
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "./database-query";
import type { DatabaseChangeEvent } from "./database-events";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "./card-lifecycle";
import type { CardLifecyclePreflightResult } from "./card-lifecycle-runtime";
import type { ListCardHistoryRequest } from "./card-history";
import type { CardHistoryCommandResult } from "./card-history-transport";
import type {
  CardReferenceReadModel,
  ResolveCardReferenceInput,
} from "./block-references";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "./database-views";

import type {
  BackupRecord,
  BackupSettings,
  DiagnosticsSettings,
  HistorySettings,
  AppUpdateSettings,
  AppUpdateStatus,
  BoardSummary,
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexBackgroundProcessRow,
  CodexBackgroundProcessRunActionInput,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexConversationSnapshot,
  CodexConnectionState,
  CodexDictationStateSnapshot,
  ProtocolDynamicToolCallResponse,
  CodexCollaborationModePreset,
  CodexCollaborationModeState,
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
  CodexEvent,
  CodexOwnerAppServerRequestInput,
  CodexReviewStartParams,
  CodexReviewStartResponse,
  CodexRendererClientRequestMessage,
  CodexRendererClientResponseMessage,
  CodexAutomationRunsInboxResponse,
  CodexAutomationRunArchiveInput,
  CodexAutomationRunDeleteInput,
  CodexAutomationRunsUpdatedEvent,
  CodexAutomationRunUnarchiveInput,
  CodexAutomationRunMarkAllReadInput,
  CodexAutomationRunMarkAllReadResponse,
  CodexAutomationRunMutationResponse,
  CodexAutomationRunReadStateInput,
  CodexAutomationInboxItem,
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
  CodexScheduledAutomationChangedEvent,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationDeleteInput,
  CodexScheduledAutomationDeleteResponse,
  CodexScheduledAutomationListResponse,
  CodexScheduledAutomationMutationResponse,
  CodexScheduledAutomationRunNowInput,
  CodexScheduledAutomationRunNowResponse,
  CodexScheduledAutomationUpdateInput,
  CodexThreadFollowerActionInput,
  CodexThreadOwnerNotificationAckInput,
  CodexThreadOwnerStreamStatePublishInput,
  CodexSidebarRefreshPolicy,
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  BranchDiffStatsRequest,
  BranchDiffStatsResult,
  GitActionCancelInput,
  GitActionCancelResult,
  GitActionMutationResult,
  GitActionStatusRequest,
  GitActionStatusResult,
  GitApplyPatchInput,
  GitApplyPatchResult,
  GitCommitMessageGenerateInput,
  GitCommitMessageGenerateResult,
  GitCommitInput,
  GitPullRequestMessageGenerateInput,
  GitPullRequestMessageGenerateResult,
  GitPushInput,
  GitReviewBranchCommitsRequest,
  GitReviewBranchCommitsResult,
  GitMergeBaseRequest,
  GitMergeBaseResult,
  GitReviewBlameInput,
  GitReviewBlameResult,
  GitReviewCancelInput,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewPatchRequest,
  GitReviewPatchResult,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewSnapshot,
  GitReviewSnapshotRequest,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
  GhCliStatusResult,
  GhPrChecksRequest,
  GhPrChecksResult,
  GhPrCommentInput,
  GhPrCommentResult,
  GhPrCommentsRequest,
  GhPrCommentsResult,
  GhPrCreateInput,
  GhPrDiffRequest,
  GhPrDiffResult,
  GhPrMergeInput,
  GhPrMutationResult,
  GhPrStatusRequest,
  GhPrStatusResult,
  GhPrUpdateInput,
  ReviewDiffRequest,
  ReviewDiffResult,
  CodexHostMessage,
  CodexModelOption,
  CodexMcpServerElicitationResponse,
  CodexPermissionMode,
  CodexPermissionRequestResponse,
  CodexPermissionState,
  CodexSteerTurnInput,
  CodexSideChatStartInput,
  CodexSideChatStartResult,
  CodexThreadStartForSessionInput,
  CodexThreadGoalDraftInput,
  CodexThreadGoalSetActionInput,
  CodexThreadGoalMaterializedDraft,
  CodexThreadDetail,
  CodexThreadSummary,
  ProtocolAppInfo,
  ProtocolMcpResourceReadParams,
  ProtocolMcpResourceReadResponse,
  ProtocolMcpServerStatus,
  CodexTurnStartOptions,
  CodexTurnSummary,
  ManagedWorktreeRecord,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentSettingsSnapshot,
  UpdateWorktreeEnvironmentConfigInput,
  BlockDropImportInput,
  BlockDropImportResult,
  CalendarOccurrence,
  ClipboardPasteInspectionResult,
  CardDescriptionUpdateStartInput,
  CardUpdateResult,
  CardEditorDropInput,
  CardEditorDropResult,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
  Card,
  CardInput,
  CardSummary,
  CardsDetailsInput,
  CardSearchInput,
  CardSearchResult,
  CommandPaletteThreadContentSearchInput,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadIndexUpdatedEvent,
  CommandPaletteThreadListInput,
  CommandPaletteThreadSummary,
  CreateBackupInput,
  MoveCardInput,
  MoveCardToProjectInput,
  MoveCardToProjectResult,
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionForkInput,
  ProjectSessionForkResult,
  ProjectSessionListOptions,
  ProjectSessionSummary,
  ProjectSessionPanelState,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelEnsureRightLeafInput,
  ProjectSessionPanelEnsureRightLeafResult,
  ProjectSessionPanelMaximizeInput,
  ProjectSessionPanelMergeInput,
  ProjectSessionPanelResizeInput,
  ProjectSessionPanelSplitInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionRenameInput,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionTabDeleteInput,
  ProjectSessionTabMoveInput,
  ProjectSessionTabReorderInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionThreadLink,
  ProjectSessionThreadLinkInput,
  ProjectSessionUnreadInput,
  ProjectSessionUpdateInput,
  RestoreBackupInput,
  RestoreBackupResult,
  TelemetrySettings,
  TerminalAttachRequest,
  TerminalAttachedEvent,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalInitLogEvent,
  TerminalRunActionRequest,
  TerminalSessionSnapshot,
  TerminalSize,
  ThreadNotificationSettings,
  DesktopNotificationPayload,
  UpdateDiagnosticsSettingsInput,
  UpdateTelemetrySettingsInput,
  UpdateBackupSettingsInput,
  UpdateAppUpdateSettingsInput,
  UpdateHistorySettingsInput,
  UpdateThreadNotificationSettingsInput,
  UpdateWindowRestoreSettingsInput,
  WindowRestoreSettings,
  DesktopNotificationActionPayload,
  WorkspaceDirectoryEntriesInput,
  WorkspaceDirectoryEntriesResult,
  WorkspaceFileBinaryReadResult,
  WorkspaceFileMetadata,
  WorkspaceFileReadInput,
  WorkspaceFileReadResult,
  WorkspaceFileRequest,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
  WorkspacePathsExistInput,
  WorkspacePathsExistResult,
} from "./types";
import type {
  CrossWindowDragClaimInput,
  CrossWindowDragClaimResult,
  CrossWindowDragCompleteInput,
  CrossWindowDragPreview,
  CrossWindowDragSourceResult,
  CrossWindowDragStartInput,
} from "./cross-window-drag";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "./native-context-menu";
import type {
  CodexDesktopMessageFromView,
  RemoteHostedPipStreamStateChangedMessage,
  RemoteHostedPipVisibilityRequestedMessage,
} from "./remote-hosted-pip";
import type { WorkbenchLayoutSnapshot } from "./workbench-layout";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "./window-session";
import type { FileLinkOpenerId, FileLinkTarget } from "./file-link-openers";
import type {
  CommandKeybindingUpdate,
  CommandKeymapState,
} from "./command-keybindings";
import type {
  BrowserBrowsingDataClearResult,
  BrowserBrowsingDataKind,
  BrowserSidebarBrowserUseCaptureSurfaceEvent,
  BrowserSidebarBrowserUseViewportEvent,
  BrowserSidebarDestroyWebviewRequest,
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarCommand,
  BrowserSidebarCommandResult,
  BrowserSidebarLocalServersSnapshot,
  BrowserSidebarStateSnapshot,
  BrowserSidebarWebviewAttached,
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
} from "./browser-sidebar";
import type {
  FeedbackUploadParams,
  FeedbackUploadResponse,
  ThreadGoal,
} from "@nodex/codex-app-server-protocol/v2";
import type { ThreadMemoryMode } from "@nodex/codex-app-server-protocol";

export interface HistoryEntry {
  id: number;
  projectId: string;
  operation: "create" | "update" | "delete" | "move";
  cardId: string;
  status: Card["status"];
  archived: boolean;
  timestamp: string;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  fromStatus: Card["status"] | null;
  toStatus: Card["status"] | null;
  fromArchived: boolean | null;
  toArchived: boolean | null;
  fromOrder: number | null;
  toOrder: number | null;
  cardSnapshot: Card | null;
  sessionId: string | null;
  groupId: string | null;
  isUndone: boolean;
  undoOf: number | null;
}

export interface HistoryPanelFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface HistoryPanelSnapshotField {
  field: string;
  value: unknown;
}

export type ClipboardWriteImageResult =
  { ok: true } | { ok: false; message: string };

export interface ComposerPickedFile {
  label: string;
  path: string;
  bytes?: number;
  mimeType?: string;
  imageDataUrl?: string;
}

export interface HistoryPanelDescriptionDeltaBlock {
  changeType: "added" | "removed" | "replaced";
  blockType: string;
  beforeOrdinal: number | null;
  afterOrdinal: number | null;
  beforePreview: string | null;
  afterPreview: string | null;
  beforeNfm: string | null;
  afterNfm: string | null;
}

export interface HistoryPanelDescriptionSnapshotBlock {
  ordinal: number;
  blockType: string;
  preview: string;
  nfm: string;
}

export interface HistoryPanelDescriptionDelta {
  beforeBlockCount: number;
  afterBlockCount: number;
  beforeFullText: string | null;
  afterFullText: string | null;
  blocks: HistoryPanelDescriptionDeltaBlock[];
}

export interface HistoryPanelDescriptionSnapshot {
  blockCount: number;
  blocks: HistoryPanelDescriptionSnapshotBlock[];
}

export interface HistoryPanelSnapshot {
  fields: HistoryPanelSnapshotField[];
  description: HistoryPanelDescriptionSnapshot | null;
}

export interface HistoryPanelMove {
  fromStatus: Card["status"] | null;
  toStatus: Card["status"] | null;
  fromArchived: boolean | null;
  toArchived: boolean | null;
  fromOrder: number | null;
  toOrder: number | null;
}

export interface HistoryPanelEntry {
  id: number;
  projectId: string;
  operation: "create" | "update" | "delete" | "move";
  cardId: string;
  status: Card["status"];
  archived: boolean;
  timestamp: string;
  sessionId: string | null;
  groupId: string | null;
  isUndone: boolean;
  undoOf: number | null;
  summary: string | null;
  fieldChanges: HistoryPanelFieldChange[];
  move: HistoryPanelMove | null;
  descriptionChange: HistoryPanelDescriptionDelta | null;
  snapshot: HistoryPanelSnapshot | null;
  reconstructable: boolean;
  reconstructionUnavailableReason: string | null;
}

export interface HistoryCardVersionPreview {
  historyId: number;
  projectId: string;
  cardId: string;
  card: Card;
}

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

export interface UndoRedoResult extends UndoRedoState {
  success: boolean;
  entry?: { operation: string; cardId: string };
  error?: string;
}

export interface SchemaResult {
  tables: {
    name: string;
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      defaultValue: string | null;
      primaryKey: boolean;
    }[];
  }[];
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: string[];
}

export interface BoardChangeEvent {
  projectId: string;
  changeType: string;
  columnId: Card["status"];
  status: Card["status"];
  cardId?: string;
  summary?: CardSummary;
  mutationId?: string;
  metrics?: {
    workerDurationMs?: number;
    queueWaitMs?: number;
    transactionMs?: number;
  };
}

export type ProjectSessionChangeType =
  | "create"
  | "update"
  | "delete"
  | "reorder"
  | "pin"
  | "archive"
  | "unarchive"
  | "unread"
  | "link"
  | "thread";

export interface ProjectSessionsChangeEvent {
  projectId: string | null;
  changeType: ProjectSessionChangeType;
  sessionId?: string;
}

export interface ProjectsChangeEvent {
  projectId?: string;
  changeType: "create" | "update" | "delete" | "reorder" | "pin";
}

export type PersistedAtomState = Record<string, unknown>;

export interface PersistedAtomUpdate {
  key: string;
  value: unknown;
}

export interface GitBranchState {
  currentBranch: string | null;
  defaultBranch: string | null;
  branches: string[];
}

export interface GitBranchInput {
  cwd: string;
  branch: string;
}

export interface WorkspacePickDirectoryInput {
  title?: string;
  createDirectory?: boolean;
}

export interface RendererDiagnosticsLogInput {
  message: string;
  fields?: Record<string, unknown>;
}

export interface IpcApi {
  "cards:history:list": {
    args: [request: ListCardHistoryRequest];
    result: CardHistoryCommandResult;
  };
  "block-documents:mutate": {
    args: [
      projectId: string,
      documentId: string,
      request: DocumentMutationRequest,
    ];
    result: DocumentOperationCommandResult;
  };
  "block-documents:history:checkpoint": {
    args: [
      projectId: string,
      documentId: string,
      request: CreateDocumentVersionCheckpoint,
    ];
    result: DocumentHistoryCommandResult<CreatedDocumentVersionSummary>;
  };
  "block-documents:history:list": {
    args: [request: ListDocumentVersions];
    result: DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>;
  };
  "block-documents:history:get": {
    args: [request: GetDocumentVersion];
    result: DocumentHistoryCommandResult<DocumentVersionDetail>;
  };
  "block-documents:history:restore": {
    args: [
      projectId: string,
      documentId: string,
      request: DocumentMutationRequest,
    ];
    result: DocumentOperationCommandResult;
  };
  "block-properties:mutate": {
    args: [projectId: string, request: BlockPropertyMutationRequest];
    result: BlockPropertyMutationCommandResult;
  };
  "cards:lifecycle:preflight": {
    args: [projectId: string, cardId: string];
    result: CardLifecyclePreflightResult;
  };
  "cards:lifecycle:apply": {
    args: [projectId: string, request: CardLifecycleMutationRequest];
    result: CardLifecycleMutationCommandResult;
  };
  "databases:mutate": {
    args: [projectId: string, request: DatabaseMutationRequest];
    result: DatabaseMutationCommandResult;
  };
  "databases:descriptor:get": {
    args: [projectId: string, databaseBlockId: string];
    result: DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
  };
  "databases:primary:get": {
    args: [projectId: string];
    result: DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
  };
  "database-views:primary:snapshot": {
    args: [projectId: string];
    result: PrimaryDatabaseViewSnapshotCommandResult;
  };
  "database-views:snapshot": {
    args: [projectId: string, viewId: string];
    result: DatabaseViewSnapshotCommandResult;
  };
  "database-views:query": {
    args: [projectId: string, viewId: string];
    result: DatabaseReadCommandResult<GeneralDatabaseViewQuery>;
  };
  "block-reference:card:resolve": {
    args: [input: ResolveCardReferenceInput];
    result: CardReferenceReadModel | null;
  };
  "database-view:reference:get": {
    args: [input: ReadDatabaseViewReferenceInput];
    result: DatabaseViewReadModel | null;
  };
  "block-document:owned:get": {
    args: [projectId: string, ownerBlockId: string];
    result: OwnedBlockDocumentDescriptor;
  };
  "block-document:owned:prepare": {
    args: [projectId: string, ownerBlockId: string];
    result: DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>;
  };
  "document-sync:subscribe": {
    args: [request: DocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncSubscriptionAck>;
  };
  "document-sync:unsubscribe": {
    args: [request: DocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncUnsubscribeAck>;
  };
  "document-sync:sync": {
    args: [request: DocumentSyncRequest];
    result: DocumentSyncCommandResult<DocumentSyncResponse>;
  };
  "document-sync:apply": {
    args: [request: DocumentSyncApplyRequest];
    result: DocumentSyncCommandResult<DocumentSyncApplyAck>;
  };
  "document-sync:awareness:publish": {
    args: [request: DocumentAwarenessPublishRequest];
    result: DocumentSyncCommandResult<DocumentAwarenessPublishAck>;
  };
  "document-sync:relocation-lease:respond": {
    args: [request: DocumentRelocationLeaseResponseRequest];
    result: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
  };
  "document-sync:relocate": {
    args: [request: DocumentRelocationRequest];
    result: RelocationCommandResult;
  };
  "diagnostics:renderer-log": {
    args: [input: RendererDiagnosticsLogInput];
    result: void;
  };
  "codex-desktop:message-from-view": {
    args: [message: CodexDesktopMessageFromView];
    result: void;
  };
  "persisted-atom:sync-request": { args: []; result: PersistedAtomState };
  "persisted-atom:update": {
    args: [update: PersistedAtomUpdate];
    result: PersistedAtomState;
  };
  "projects:list": { args: []; result: Project[] };
  "projects:get": { args: [projectId: string]; result: Project | null };
  "projects:create": { args: [input: ProjectCreateInput]; result: Project };
  "projects:update": {
    args: [projectId: string, updates: ProjectUpdateInput];
    result: Project | null;
  };
  "projects:reorder": { args: [input: ProjectOrderInput]; result: Project[] };
  "projects:set-pinned": {
    args: [projectId: string, input: ProjectPinnedInput];
    result: Project | null;
  };
  "projects:set-pinned-order": {
    args: [input: ProjectPinnedOrderInput];
    result: Project[];
  };
  "projects:pick-source-root": { args: []; result: string | null };
  "workspace:pick-directory": {
    args: [input?: WorkspacePickDirectoryInput];
    result: string | null;
  };
  "projects:delete": { args: [projectId: string]; result: boolean };
  "project-sessions:list": {
    args: [projectId: string | null, options?: ProjectSessionListOptions];
    result: ProjectSession[];
  };
  "project-sessions:list-summaries": {
    args: [projectId: string | null, options?: ProjectSessionListOptions];
    result: ProjectSessionSummary[];
  };
  "project-sessions:get": {
    args: [sessionId: string];
    result: ProjectSession | null;
  };
  "project-sessions:create": {
    args: [input: ProjectSessionCreateInput];
    result: ProjectSession;
  };
  "project-sessions:update": {
    args: [sessionId: string, input: ProjectSessionUpdateInput];
    result: ProjectSession | null;
  };
  "project-sessions:rename": {
    args: [sessionId: string, input: ProjectSessionRenameInput];
    result: ProjectSession | null;
  };
  "project-sessions:delete": { args: [sessionId: string]; result: boolean };
  "project-sessions:reorder": {
    args: [projectId: string, orderedSessionIds: string[]];
    result: ProjectSession[];
  };
  "project-sessions:set-pinned": {
    args: [sessionId: string, input: ProjectSessionPinnedInput];
    result: ProjectSession | null;
  };
  "project-sessions:set-pinned-order": {
    args: [projectId: string, input: ProjectSessionPinnedOrderInput];
    result: ProjectSession[];
  };
  "project-sessions:archive": {
    args: [sessionId: string];
    result: ProjectSession | null;
  };
  "project-sessions:unarchive": {
    args: [sessionId: string];
    result: ProjectSession | null;
  };
  "project-sessions:mark-unread": {
    args: [sessionId: string, input: ProjectSessionUnreadInput];
    result: ProjectSession | null;
  };
  "project-sessions:fork": {
    args: [sessionId: string, input: ProjectSessionForkInput];
    result: ProjectSessionForkResult;
  };
  "project-session-tabs:create": {
    args: [input: ProjectSessionTabCreateInput];
    result: ProjectSessionTab;
  };
  "project-session-tabs:update": {
    args: [tabId: string, input: ProjectSessionTabUpdateInput];
    result: ProjectSessionTab | null;
  };
  "project-session-tabs:delete": {
    args: [input: string | ProjectSessionTabDeleteInput];
    result: boolean;
  };
  "project-session-panels:update": {
    args: [
      sessionId: string,
      panelId: "right" | "bottom",
      input: Partial<ProjectSessionPanelState>,
    ];
    result: ProjectSession | null;
  };
  "project-session-panels:split": {
    args: [input: ProjectSessionPanelSplitInput];
    result: ProjectSession | null;
  };
  "project-session-panels:ensure-right-leaf": {
    args: [input: ProjectSessionPanelEnsureRightLeafInput];
    result: ProjectSessionPanelEnsureRightLeafResult | null;
  };
  "project-session-panels:merge": {
    args: [input: ProjectSessionPanelMergeInput];
    result: ProjectSession | null;
  };
  "project-session-panels:activate": {
    args: [input: ProjectSessionPanelActivateInput];
    result: ProjectSession | null;
  };
  "project-session-panels:resize": {
    args: [input: ProjectSessionPanelResizeInput];
    result: ProjectSession | null;
  };
  "project-session-panels:maximize": {
    args: [input: ProjectSessionPanelMaximizeInput];
    result: ProjectSession | null;
  };
  "project-session-tabs:state:update": {
    args: [tabId: string, stateKey: number, state: unknown];
    result: ProjectSessionTab | null;
  };
  "project-session-tabs:reorder": {
    args: [input: ProjectSessionTabReorderInput];
    result: ProjectSession | null;
  };
  "project-session-tabs:move": {
    args: [input: ProjectSessionTabMoveInput];
    result: ProjectSession | null;
  };
  "project-session-threads:attach": {
    args: [input: ProjectSessionThreadLinkInput];
    result: ProjectSessionThreadLink;
  };
  "project-session-threads:detach": {
    args: [sessionId: string];
    result: boolean;
  };
  "board:summary:get": { args: [projectId: string]; result: BoardSummary };
  "cards:details:get": {
    args: [projectId: string, input: CardsDetailsInput];
    result: Card[];
  };
  "cards:search": {
    args: [input: CardSearchInput];
    result: CardSearchResult[];
  };
  "card:update": {
    args: [
      projectId: string,
      status: Card["status"] | undefined,
      cardId: string,
      updates: Partial<CardInput>,
      sessionId?: string,
      expectedRevision?: number,
    ];
    result: CardUpdateResult;
  };
  "card:description:update:start": {
    args: [input: CardDescriptionUpdateStartInput];
    result: { stagingId: string };
  };
  "card:description:update:chunk": {
    args: [stagingId: string, chunk: string];
    result: { ok: true; bytes: number };
  };
  "card:description:update:finish": {
    args: [stagingId: string];
    result: CardUpdateResult;
  };
  "card:description:update:abort": {
    args: [stagingId: string];
    result: boolean;
  };
  "card:get": {
    args: [projectId: string, cardId: string, status?: Card["status"]];
    result: Card | null;
  };
  "card:move": {
    args: [input: MoveCardInput & { projectId: string; sessionId?: string }];
    result: boolean;
  };
  "card:move-to-project": {
    args: [input: MoveCardToProjectInput & { sessionId?: string }];
    result: MoveCardToProjectResult;
  };
  "card:import-block-drop": {
    args: [projectId: string, input: BlockDropImportInput, sessionId?: string];
    result: BlockDropImportResult;
  };
  "card:apply-editor-drop": {
    args: [projectId: string, input: CardEditorDropInput, sessionId?: string];
    result: CardEditorDropResult;
  };
  "cross-window-drag:start": {
    args: [input: CrossWindowDragStartInput];
    result: boolean;
  };
  "cross-window-drag:active:get": {
    args: [];
    result: CrossWindowDragPreview | null;
  };
  "cross-window-drag:claim": {
    args: [input: CrossWindowDragClaimInput];
    result: CrossWindowDragClaimResult;
  };
  "cross-window-drag:source-ended": {
    args: [sessionId: string];
    result: boolean;
  };
  "cross-window-drag:complete": {
    args: [input: CrossWindowDragCompleteInput];
    result: boolean;
  };
  "cross-window-drag:discard": {
    args: [sessionId: string];
    result: boolean;
  };
  "calendar:occurrences": {
    args: [
      projectId: string,
      windowStart: Date,
      windowEnd: Date,
      searchQuery?: string,
    ];
    result: { occurrences: CalendarOccurrence[] };
  };
  "card:occurrence:complete": {
    args: [
      projectId: string,
      input: CardOccurrenceActionInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "card:occurrence:skip": {
    args: [
      projectId: string,
      input: CardOccurrenceActionInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "card:occurrence:update": {
    args: [
      projectId: string,
      input: CardOccurrenceUpdateInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "history:recent": {
    args: [projectId: string, sessionId?: string];
    result: UndoRedoState & { entries: HistoryEntry[] };
  };
  "history:card": {
    args: [projectId: string, cardId: string];
    result: { entries: HistoryPanelEntry[] };
  };
  "history:card-version-preview": {
    args: [projectId: string, cardId: string, historyId: number];
    result: { preview: HistoryCardVersionPreview | null; error?: string };
  };
  "history:undo": {
    args: [projectId: string, sessionId?: string];
    result: UndoRedoResult;
  };
  "history:redo": {
    args: [projectId: string, sessionId?: string];
    result: UndoRedoResult;
  };
  "history:revert": {
    args: [projectId: string, historyId: number, sessionId?: string];
    result: { success: boolean; error?: string };
  };
  "history:restore": {
    args: [
      projectId: string,
      cardId: string,
      historyId: number,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "db:schema": { args: [projectId: string]; result: SchemaResult };
  "db:query": {
    args: [projectId: string, sql: string, params?: unknown[]];
    result: QueryResult;
  };
  "backup:list": { args: []; result: BackupRecord[] };
  "backup:create": { args: [input?: CreateBackupInput]; result: BackupRecord };
  "backup:delete": {
    args: [backupId: string];
    result: { success: true; deletedBackupId: string };
  };
  "backup:restore": {
    args: [input: RestoreBackupInput];
    result: RestoreBackupResult;
  };
  "settings:backup:get": { args: []; result: BackupSettings };
  "settings:backup:update": {
    args: [input: UpdateBackupSettingsInput];
    result: BackupSettings;
  };
  "settings:history:get": { args: []; result: HistorySettings };
  "settings:history:update": {
    args: [input: UpdateHistorySettingsInput];
    result: HistorySettings;
  };
  "settings:diagnostics:get": { args: []; result: DiagnosticsSettings };
  "settings:diagnostics:update": {
    args: [input: UpdateDiagnosticsSettingsInput];
    result: DiagnosticsSettings;
  };
  "settings:telemetry:get": { args: []; result: TelemetrySettings };
  "settings:telemetry:update": {
    args: [input: UpdateTelemetrySettingsInput];
    result: TelemetrySettings;
  };
  "settings:thread-notifications:get": {
    args: [];
    result: ThreadNotificationSettings;
  };
  "settings:thread-notifications:update": {
    args: [input: UpdateThreadNotificationSettingsInput];
    result: ThreadNotificationSettings;
  };
  "desktop-notification:show": {
    args: [notification: DesktopNotificationPayload];
    result: void;
  };
  "desktop-notification:hide": {
    args: [conversationId: string];
    result: void;
  };
  "electron-window:focus:get": { args: []; result: boolean };
  "native-context-menu:show": {
    args: [items: NativeContextMenuItem[], options?: NativeContextMenuOptions];
    result: string | null;
  };
  "settings:app-updates:get": { args: []; result: AppUpdateSettings };
  "settings:app-updates:update": {
    args: [input: UpdateAppUpdateSettingsInput];
    result: AppUpdateSettings;
  };
  "settings:window-restore:get": { args: []; result: WindowRestoreSettings };
  "settings:window-restore:update": {
    args: [input: UpdateWindowRestoreSettingsInput];
    result: WindowRestoreSettings;
  };
  "codex-command-keymap-state": { args: []; result: CommandKeymapState };
  "set-codex-command-keybinding": {
    args: [commandId: string, update: CommandKeybindingUpdate];
    result: CommandKeymapState;
  };
  "reset-codex-command-keybindings": { args: []; result: CommandKeymapState };
  "global-dictation-capture-fn-hotkey": { args: []; result: string | null };
  "app:update:status": { args: []; result: AppUpdateStatus };
  "app:update:check": { args: []; result: AppUpdateStatus };
  "app:update:install": { args: []; result: boolean };
  "shell:open-file-link": {
    args: [target: FileLinkTarget, openerId: FileLinkOpenerId];
    result: boolean;
  };
  "workspace-directory-entries": {
    args: [input: WorkspaceDirectoryEntriesInput];
    result: WorkspaceDirectoryEntriesResult;
  };
  "remote-workspace-directory-entries": {
    args: [input: WorkspaceDirectoryEntriesInput];
    result: WorkspaceDirectoryEntriesResult;
  };
  "read-file": {
    args: [input: WorkspaceFileReadInput];
    result: WorkspaceFileReadResult;
  };
  "read-file-metadata": {
    args: [input: WorkspaceFileRequest];
    result: WorkspaceFileMetadata;
  };
  "read-file-binary": {
    args: [input: WorkspaceFileRequest];
    result: WorkspaceFileBinaryReadResult;
  };
  "write-file": {
    args: [input: WorkspaceFileWriteInput];
    result: WorkspaceFileWriteResult;
  };
  "paths-exist": {
    args: [input: WorkspacePathsExistInput];
    result: WorkspacePathsExistResult;
  };
  "open-file": {
    args: [target: FileLinkTarget, openerId: FileLinkOpenerId];
    result: boolean;
  };
  "asset:resolve-path": { args: [source: string]; result: string | null };
  "clipboard:write-image": {
    args: [input: { source: string }];
    result: ClipboardWriteImageResult;
  };
  "clipboard:inspect-paste": {
    args: [];
    result: ClipboardPasteInspectionResult;
  };
  "composer:pick-files": {
    args: [input: { imagesOnly: boolean; title: string }];
    result: ComposerPickedFile[];
  };
  "window:show-emoji-panel": { args: []; result: boolean };
  "window:new": { args: [seed?: WindowSessionSeed]; result: boolean };
  "window-sessions:bootstrap": { args: []; result: WindowSessionBootstrap };
  "window-sessions:save-layout": {
    args: [layout: WorkbenchLayoutSnapshot];
    result: WindowSessionBootstrap;
  };
  "window-sessions:update-bounds": {
    args: [bounds: WindowSessionBounds];
    result: void;
  };
  // Internal app lifecycle handshake used to flush renderer state before window close.
  "app:flush-before-close:done": {
    args: [webContentsId: number];
    result: void;
  };

  // Browser sidebar
  "browser-sidebar-command": {
    args: [command: BrowserSidebarCommand];
    result: BrowserSidebarCommandResult;
  };
  "browser-browsing-data-clear": {
    args: [kind: BrowserBrowsingDataKind];
    result: BrowserBrowsingDataClearResult;
  };
  "browser-sidebar-webview-host-created": {
    args: [event: BrowserSidebarWebviewHostCreated];
    result: BrowserSidebarCommandResult;
  };
  "browser-sidebar-webview-destroyed": {
    args: [event: BrowserSidebarWebviewDestroyed];
    result: BrowserSidebarCommandResult;
  };

  // Git branch state
  "git:branch:state": {
    args: [cwd: string];
    result: GitBranchState;
  };
  "git:branch:checkout": {
    args: [input: GitBranchInput];
    result: GitBranchState;
  };
  "git:branch:create": {
    args: [input: GitBranchInput];
    result: GitBranchState;
  };
  "git:branch:watch:start": {
    args: [cwd: string];
    result: void;
  };
  "git:branch:watch:stop": {
    args: [];
    result: void;
  };

  // Git review
  "git:review:snapshot": {
    args: [input: GitReviewSnapshotRequest];
    result: GitReviewSnapshot;
  };
  "git:review:summary": {
    args: [input: GitReviewSummaryRequest];
    result: GitReviewSummaryResult;
  };
  "git:review:diff": {
    args: [input: ReviewDiffRequest];
    result: ReviewDiffResult;
  };
  "git:review:cancel": {
    args: [input: GitReviewCancelInput];
    result: { cancelled: boolean };
  };
  "git:review:branch-diff-stats": {
    args: [input: BranchDiffStatsRequest];
    result: BranchDiffStatsResult;
  };
  "git:review:branch-commits": {
    args: [input: GitReviewBranchCommitsRequest];
    result: GitReviewBranchCommitsResult;
  };
  "git:merge-base": {
    args: [input: GitMergeBaseRequest];
    result: GitMergeBaseResult;
  };
  "git:review:file-contents": {
    args: [input: GitReviewFileContentsInput];
    result: GitReviewFileContents;
  };
  "git:review:search": {
    args: [input: GitReviewSearchInput];
    result: GitReviewSearchResult;
  };
  "git:review:patch": {
    args: [input: GitReviewPatchRequest];
    result: GitReviewPatchResult;
  };
  "git:review:blame-file": {
    args: [input: GitReviewBlameInput];
    result: GitReviewBlameResult;
  };
  "git:apply-patch": {
    args: [input: GitApplyPatchInput];
    result: GitApplyPatchResult;
  };
  "git:init": { args: [cwd: string]; result: GitReviewSnapshot };
  "git:action:status": {
    args: [input: GitActionStatusRequest];
    result: GitActionStatusResult;
  };
  "git:action:commit-message:generate": {
    args: [input: GitCommitMessageGenerateInput];
    result: GitCommitMessageGenerateResult;
  };
  "git:action:pull-request-message:generate": {
    args: [input: GitPullRequestMessageGenerateInput];
    result: GitPullRequestMessageGenerateResult;
  };
  "git:action:commit": {
    args: [input: GitCommitInput];
    result: GitActionMutationResult;
  };
  "git:action:push": {
    args: [input: GitPushInput];
    result: GitActionMutationResult;
  };
  "git:action:cancel": {
    args: [input: GitActionCancelInput];
    result: GitActionCancelResult;
  };

  // GitHub pull request review
  "gh-cli-status": {
    args: [input: { cwd: string }];
    result: GhCliStatusResult;
  };
  "gh-pr-status": {
    args: [input: GhPrStatusRequest];
    result: GhPrStatusResult;
  };
  "gh-pr-checks": {
    args: [input: GhPrChecksRequest];
    result: GhPrChecksResult;
  };
  "gh-pr-comments": {
    args: [input: GhPrCommentsRequest];
    result: GhPrCommentsResult;
  };
  "gh-pr-diff": { args: [input: GhPrDiffRequest]; result: GhPrDiffResult };
  "gh-pr-comment": {
    args: [input: GhPrCommentInput];
    result: GhPrCommentResult;
  };
  "gh-pr-merge": { args: [input: GhPrMergeInput]; result: GhPrMutationResult };
  "gh-pr-update": {
    args: [input: GhPrUpdateInput];
    result: GhPrMutationResult;
  };
  "gh-pr-create": {
    args: [input: GhPrCreateInput];
    result: GhPrMutationResult;
  };

  // Terminal
  "terminal-create": { args: [input: TerminalCreateRequest]; result: void };
  "terminal-attach": { args: [input: TerminalAttachRequest]; result: void };
  "terminal-write": { args: [sessionId: string, data: string]; result: void };
  "terminal-run-action": {
    args: [input: TerminalRunActionRequest];
    result: void;
  };
  "terminal-session:snapshot": {
    args: [sessionId: string];
    result: TerminalSessionSnapshot | null;
  };
  "terminal-resize": {
    args: [sessionId: string, size: TerminalSize];
    result: void;
  };
  "terminal-close": { args: [sessionId: string]; result: void };
  "thread-terminal-snapshot": {
    args: [threadId: string];
    result: TerminalSessionSnapshot | null;
  };

  // Codex
  "codex:connection:status": { args: []; result: CodexConnectionState };
  "codex:account:read": { args: []; result: CodexAccountSnapshot };
  "codex:dictation:state:read": {
    args: [];
    result: CodexDictationStateSnapshot;
  };
  "codex:account:login:start": {
    args: [input: { type: "chatgpt" } | { type: "apiKey"; apiKey: string }];
    result:
      | { type: "apiKey" }
      | { type: "chatgpt"; loginId: string; authUrl: string };
  };
  "codex:account:login:cancel": {
    args: [loginId: string];
    result: { status: "canceled" | "notFound" };
  };
  "codex:account:logout": { args: []; result: boolean };
  "codex:threads:list": {
    args: [projectId: string, opts?: { includeArchived?: boolean }];
    result: CodexThreadSummary[];
  };
  "codex:sidebar:snapshot": {
    args: [input?: { includeArchived?: boolean; refresh?: boolean }];
    result: CodexSidebarSnapshot;
  };
  "codex:sidebar:sync": {
    args: [
      input?: {
        includeArchived?: boolean;
        policy?: CodexSidebarRefreshPolicy;
        reason?: CodexSidebarRefreshReason;
      },
    ];
    result: CodexSidebarSyncResult;
  };
  "codex:threads:pinned:list": {
    args: [];
    result: string[];
  };
  "codex:threads:pinned:set": {
    args: [threadId: string, input: { pinned: boolean }];
    result: CodexSidebarSnapshot;
  };
  "codex:thread:ensure-session": {
    args: [threadId: string];
    result: ProjectSession | null;
  };
  "codex:threads:palette:list": {
    args: [input: CommandPaletteThreadListInput];
    result: CommandPaletteThreadSummary[];
  };
  "codex:threads:palette:search-content": {
    args: [input: CommandPaletteThreadContentSearchInput];
    result: CommandPaletteThreadContentSearchResult[];
  };
  "codex:thread:summary:get": {
    args: [threadId: string];
    result: CodexThreadSummary | null;
  };
  "codex:scheduled-automations:list": {
    args: [];
    result: CodexScheduledAutomationListResponse;
  };
  "codex:scheduled-automations:create": {
    args: [input: CodexScheduledAutomationCreateInput];
    result: CodexScheduledAutomationMutationResponse;
  };
  "codex:scheduled-automations:update": {
    args: [input: CodexScheduledAutomationUpdateInput];
    result: CodexScheduledAutomationMutationResponse;
  };
  "codex:scheduled-automations:delete": {
    args: [input: CodexScheduledAutomationDeleteInput];
    result: CodexScheduledAutomationDeleteResponse;
  };
  "codex:scheduled-automations:run-now": {
    args: [input: CodexScheduledAutomationRunNowInput];
    result: CodexScheduledAutomationRunNowResponse;
  };
  "codex:scheduled-automations:heartbeat-enabled-changed": {
    args: [input: CodexHeartbeatAutomationsEnabledChangedInput];
    result: { success: boolean };
  };
  "codex:scheduled-automations:heartbeat-thread-state-changed": {
    args: [input: CodexHeartbeatAutomationThreadStateChangedInput];
    result: { success: boolean };
  };
  "codex:automation-runs:archive": {
    args: [input: CodexAutomationRunArchiveInput];
    result: CodexAutomationRunMutationResponse;
  };
  "codex:automation-runs:delete": {
    args: [input: CodexAutomationRunDeleteInput];
    result: CodexAutomationRunMutationResponse;
  };
  "codex:automation-runs:unarchive": {
    args: [input: CodexAutomationRunUnarchiveInput];
    result: CodexAutomationRunMutationResponse;
  };
  "codex:automation-runs:inbox-items": {
    args: [limit?: number];
    result: CodexAutomationRunsInboxResponse;
  };
  "codex:automation-runs:set-read-state": {
    args: [input: CodexAutomationRunReadStateInput];
    result: CodexAutomationInboxItem | null;
  };
  "codex:automation-runs:mark-all-read": {
    args: [input: CodexAutomationRunMarkAllReadInput];
    result: CodexAutomationRunMarkAllReadResponse;
  };
  "codex:model:list": {
    args: [];
    result: CodexModelOption[];
  };
  "codex:collaboration-mode:list": {
    args: [];
    result: CodexCollaborationModePreset[];
  };
  "codex:thread:start-for-session": {
    args: [CodexThreadStartForSessionInput];
    result: CodexThreadDetail;
  };
  "codex:thread:side-chat:start": {
    args: [CodexSideChatStartInput];
    result: CodexSideChatStartResult;
  };
  "codex:thread:side-chat:discard": {
    args: [threadId: string];
    result: boolean;
  };
  "codex:renderer-client:id": {
    args: [];
    result: string | null;
  };
  "codex:renderer-client:response": {
    args: [response: CodexRendererClientResponseMessage];
    result: boolean;
  };
  "codex:thread-owner:stream-state:publish": {
    args: [input: CodexThreadOwnerStreamStatePublishInput];
    result: boolean;
  };
  "codex:thread:resume-buffer:release": {
    args: [threadId: string];
    result: boolean;
  };
  "codex:thread-owner:notification:ack": {
    args: [input: CodexThreadOwnerNotificationAckInput];
    result: boolean;
  };
  "codex:thread-owner:app-server-request": {
    args: [input: CodexOwnerAppServerRequestInput];
    result: unknown;
  };
  "codex:thread-follower:action": {
    args: [input: CodexThreadFollowerActionInput];
    result: unknown;
  };
  "codex:dynamic-tool-call:respond": {
    args: [requestId: string];
    result: ProtocolDynamicToolCallResponse | null;
  };
  "worktrees:list": { args: []; result: ManagedWorktreeRecord[] };
  "worktrees:environments:list": {
    args: [projectId: string];
    result: WorktreeEnvironmentOption[];
  };
  "worktrees:environments:configs:list": {
    args: [projectId: string];
    result: WorktreeEnvironmentConfigRecord[];
  };
  "worktrees:environments:config:read": {
    args: [projectId: string, configPath?: string | null];
    result: WorktreeEnvironmentSettingsSnapshot;
  };
  "worktrees:environments:config:save": {
    args: [input: UpdateWorktreeEnvironmentConfigInput];
    result: WorktreeEnvironmentSettingsSnapshot;
  };
  "worktrees:delete": { args: [threadId: string]; result: boolean };
  "codex:thread:snapshot:request": {
    args: [threadId: string];
    result: CodexConversationSnapshot | null;
  };
  "codex:thread:resume:request": {
    args: [threadId: string];
    result: CodexConversationSnapshot | null;
  };
  "codex:thread:background-subagents:hydrate": {
    args: [input: CodexBackgroundSubagentThreadsHydrateInput];
    result: CodexThreadSummary[];
  };
  "codex:subagent-thread:opened": {
    args: [threadId: string];
    result: boolean;
  };
  "codex:thread:view-active:set": {
    args: [input: { threadId: string; active: boolean }];
    result: boolean;
  };
  "codex:thread:turns:load-older": {
    args: [threadId: string];
    result: CodexConversationSnapshot | null;
  };
  "codex:thread:turns:load-complete": {
    args: [threadId: string];
    result: CodexConversationSnapshot | null;
  };
  "codex:thread:name:set": {
    args: [threadId: string, name: string];
    result: boolean;
  };
  "codex:thread:name:set-generated": {
    args: [threadId: string, name: string];
    result: boolean;
  };
  "codex:thread:title:generate": {
    args: [input: { hostId: string; prompt: string; cwd: string | null }];
    result: { title: string | null };
  };
  "codex:thread:archive": { args: [threadId: string]; result: boolean };
  "codex:thread:unarchive": {
    args: [threadId: string];
    result: CodexThreadSummary | null;
  };
  "codex:thread:collaboration-mode:set": {
    args: [threadId: string, collaborationMode: "default" | "plan"];
    result: CodexCollaborationModeState;
  };
  "codex:thread:settings:update": {
    args: [threadId: string, patch: CodexConversationThreadSettingsPatch];
    result: CodexConversationThreadSettings;
  };
  "codex:thread:plan-implementation:remove": {
    args: [threadId: string, turnId: string];
    result: boolean;
  };
  "codex:turn:start": {
    args: [threadId: string, prompt: string, opts?: CodexTurnStartOptions];
    result: CodexTurnSummary | null;
  };
  "codex:review:start": {
    args: [input: CodexReviewStartParams];
    result: CodexReviewStartResponse;
  };
  "codex:thread:follow-up:enqueue": {
    args: [threadId: string, prompt: string, opts?: CodexTurnStartOptions];
    result: void;
  };
  "codex:thread:follow-up:remove": {
    args: [threadId: string, followUpId: string];
    result: void;
  };
  "codex:thread:follow-up:reorder": {
    args: [threadId: string, orderedFollowUpIds: string[]];
    result: void;
  };
  "codex:thread:follow-up:send-now": {
    args: [threadId: string, followUpId: string];
    result: void;
  };
  "codex:thread:compact:start": {
    args: [threadId: string];
    result: void;
  };
  "codex:thread:goal:get": {
    args: [threadId: string];
    result: ThreadGoal | null;
  };
  "codex:thread:goal:set": {
    args: [params: CodexThreadGoalSetActionInput];
    result: ThreadGoal | null;
  };
  "codex:thread:goal:clear": {
    args: [threadId: string];
    result: void;
  };
  "codex:thread:goal:materialize-draft": {
    args: [draft: CodexThreadGoalDraftInput];
    result: CodexThreadGoalMaterializedDraft;
  };
  "codex:thread:goal:materialized-cleanup": {
    args: [attachmentDirectory: string | null];
    result: void;
  };
  "codex:thread:goal:editable-objective:read": {
    args: [objective: string];
    result: string;
  };
  "codex:thread:memory-mode:set": {
    args: [threadId: string, mode: ThreadMemoryMode];
    result: void;
  };
  "codex:feedback:upload": {
    args: [params: FeedbackUploadParams];
    result: FeedbackUploadResponse | void;
  };
  "codex:turn:steer": {
    args: [input: CodexSteerTurnInput];
    result: { turnId: string } | null;
  };
  "codex:turn:interrupt": {
    args: [threadId: string, turnId?: string];
    result: boolean;
  };
  "codex:thread:background-terminals:clean": {
    args: [threadId: string];
    result: boolean;
  };
  "codex:thread:background-terminals:clean-silent": {
    args: [threadId: string];
    result: boolean;
  };
  "codex:thread:background-terminals:list": {
    args: [threadId: string];
    result: ThreadBackgroundTerminal[];
  };
  "codex:thread:background-processes:list": {
    args: [
      input: {
        threadId: string;
        observedTerminals?: ThreadBackgroundTerminal[];
      },
    ];
    result: CodexBackgroundProcessRow[];
  };
  "codex:thread:background-processes:run-action": {
    args: [input: CodexBackgroundProcessRunActionInput];
    result: CodexBackgroundProcessRow[];
  };
  "codex:thread:background-terminals:terminate": {
    args: [input: { threadId: string; processId: string }];
    result: boolean;
  };
  "codex:mcp-resource:read": {
    args: [params: ProtocolMcpResourceReadParams];
    result: ProtocolMcpResourceReadResponse;
  };
  "codex:mcp-apps:list": {
    args: [threadId?: string | null];
    result: ProtocolAppInfo[];
  };
  "codex:mcp-server-statuses:list": {
    args: [threadId?: string | null];
    result: ProtocolMcpServerStatus[];
  };
  "codex:approval:respond": {
    args: [requestId: string, decision: CodexApprovalDecision];
    result: boolean;
  };
  "codex:user-input:respond": {
    args: [requestId: string, answers: Record<string, string[]>];
    result: boolean;
  };
  "codex:mcp-elicitation:respond": {
    args: [requestId: string, response: CodexMcpServerElicitationResponse];
    result: boolean;
  };
  "codex:permission-request:respond": {
    args: [requestId: string, response: CodexPermissionRequestResponse];
    result: boolean;
  };
  "codex:permission:mode:set": {
    args: [projectId: string, mode: CodexPermissionMode];
    result: CodexPermissionState;
  };
  "codex:permission:mode:get": {
    args: [projectId: string];
    result: CodexPermissionMode;
  };
  "codex:permission:state:get": {
    args: [projectId: string];
    result: CodexPermissionState;
  };
  "codex:permission:config-value:set": {
    args: [projectId: string, keyPath: string, value: unknown];
    result: CodexPermissionState;
  };
  "codex:permission:custom-description:get": {
    args: [projectId: string];
    result: string;
  };
}

export interface IpcEvents {
  "document-sync:event": DocumentSyncRealtimeEvent;
  "cross-window-drag:active-changed": CrossWindowDragPreview | null;
  "cross-window-drag:source-result": CrossWindowDragSourceResult;
  "persisted-atom:updated": PersistedAtomUpdate;
  "board-changed": BoardChangeEvent;
  "database-changed": DatabaseChangeEvent;
  "projects-changed": ProjectsChangeEvent;
  "project-sessions-changed": ProjectSessionsChangeEvent;
  "reminder:open": {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  };
  "terminal-data": TerminalDataEvent;
  "terminal-init-log": TerminalInitLogEvent;
  "terminal-attached": TerminalAttachedEvent;
  "terminal-error": TerminalErrorEvent;
  "terminal-exit": TerminalExitEvent;
  "codex:event": CodexEvent;
  "codex:host-message": CodexHostMessage;
  "codex:renderer-client:request": CodexRendererClientRequestMessage;
  "codex:threads:palette:index-updated": CommandPaletteThreadIndexUpdatedEvent;
  "codex:scheduled-automations:changed": CodexScheduledAutomationChangedEvent;
  "codex:automation-runs:updated": CodexAutomationRunsUpdatedEvent;
  "browser-sidebar-state": BrowserSidebarStateSnapshot;
  "browser-sidebar-local-servers": BrowserSidebarLocalServersSnapshot;
  "browser-sidebar-browser-use-state": BrowserSidebarBrowserUseStateSnapshot;
  "browser-sidebar-browser-use-viewport": BrowserSidebarBrowserUseViewportEvent;
  "browser-sidebar-browser-use-capture-surface": BrowserSidebarBrowserUseCaptureSurfaceEvent;
  "browser-sidebar-browser-use-cursor-state": BrowserSidebarBrowserUseStateSnapshot["cursor"];
  "browser-sidebar-browser-use-page-released": { tabId: string };
  "browser-sidebar-webview-attached": BrowserSidebarWebviewAttached;
  "browser-sidebar-destroy-webview": BrowserSidebarDestroyWebviewRequest;
  "remote-hosted-pip-stream-state-changed": RemoteHostedPipStreamStateChangedMessage;
  "remote-hosted-pip-visibility-requested": RemoteHostedPipVisibilityRequestedMessage;
  "desktop-notification:action": DesktopNotificationActionPayload & {
    conversationId: string | null;
    requestId: string | null;
  };
  "electron-window:focus-changed": { isFocused: boolean };
  "electron-window-opaque-surface-changed": {
    opaqueWindowSurfaceEnabled: boolean;
  };
}
