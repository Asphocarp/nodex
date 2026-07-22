import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseRequest,
  DocumentRelocationLeaseResponseAck,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
  DocumentSyncSubscriptionAck,
  DocumentSyncUnsubscribeAck,
  ProjectScopedDocumentAwarenessPublishRequest,
  ProjectScopedDocumentRelocationLeaseResponseRequest,
  ProjectScopedDocumentSyncApplyRequest,
  ProjectScopedDocumentSyncRequest,
  ProjectScopedDocumentSyncSubscribeRequest,
} from "./block-documents/document-sync";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationRequest,
  CanvasSceneSubscribeRequest,
  CanvasSceneSubscriptionCommandResult,
  CanvasSceneSyncCommandResult,
  CanvasSceneSyncRequest,
} from "./block-documents/canvas-scene-sync";
import type {
  LibraryOwnedDocumentDescriptor,
  OwnedDocumentDescriptor,
} from "./block-documents/contracts";
import type { BlockTransferCommandResult } from "./block-transfer";
import type { PublicBlockTransferIntent } from "./block-transfer-transport";
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
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
  LibraryBlockPropertyMutationCommandResultV2,
  LibraryBlockPropertyMutationRequestV2,
} from "./block-property-mutations-v2";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseModuleReadResultV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseApplyResultV2,
} from "./database-module-v2";
import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "./library-module";
import type { DatabaseChangeEvent } from "./database-events";
import type {
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "./page-lifecycle-v2";
import type { PageLifecyclePreflightResultV2 } from "./page-lifecycle-v2-runtime";
import type { ListPageHistoryRequest } from "./page-history";
import type { PageHistoryCommandResult } from "./page-history-transport";
import type {
  LibraryPageDetailResult,
  PageDetailResult,
} from "./page-detail";
import type { AdditionalDocumentCommandResult } from "./additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "./additional-document-command-transport";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "./page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "./page-ownership-paths";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "./database-views";
import type {
  CodexSidebarThreadMoveInput,
  CodexSidebarThreadMoveResult,
  CodexSidebarChatsThreadOrderInput,
  CodexSidebarChatsThreadOrderResult,
  CodexSidebarProjectThreadOrderInput,
  CodexSidebarProjectThreadOrderResult,
} from "./codex-sidebar-thread-move";
import type {
  CodexHooksChangedEvent,
  CodexHooksListInput,
  CodexHooksListResponse,
  CodexHooksStateUpdateInput,
} from "./codex-hooks";
import type {
  AgentProviderCatalog,
  AgentProviderCredentialDeleteInput,
  AgentProviderCredentialMutationInput,
  AgentProviderCredentialMutationResult,
} from "./agent-runtime";
import type {
  AgentImportApplyInput,
  AgentImportProgress,
  AgentImportResult,
  AgentImportScan,
  AgentImportScanInput,
} from "./agent-import";

import type {
  BackupRecord,
  BackupSettings,
  DiagnosticsSettings,
  HistorySettings,
  AppUpdateSettings,
  AppUpdateStatus,
  BoardSummarySnapshot,
  CodexAccountSnapshot,
  CodexRateLimitResetInput,
  CodexRateLimitResetResult,
  CodexApprovalResponse,
  CodexApprovalKind,
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalSetupContextPickerResponse,
  CodexCanonicalSetupCodexStepResponse,
  CodexBackgroundProcessRow,
  CodexBackgroundProcessRunActionInput,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexConversationSnapshot,
  CodexConnectionState,
  CodexDeveloperInstructionSettings,
  CodexGitSettings,
  CodexDictationStateSnapshot,
  CodexConversationImageAssetResolveInput,
  CodexConversationImageAssetResolveResult,
  ProtocolDynamicToolCallResponse,
  CodexCollaborationModePreset,
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
  CodexPersonality,
  CodexEvent,
  CodexOwnerAppServerRequestInput,
  CodexAgentMode,
  CodexReviewStartParams,
  CodexReviewStartResponse,
  CodexRendererClientRequestMessage,
  CodexRendererClientResponseMessage,
  CodexRendererConversationResumeResult,
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
  GitReviewCatFileInput,
  GitReviewCatFileOutput,
  GitReviewLiveSubscriptionInput,
  GitReviewLiveSubscriptionStopInput,
  GitReviewLiveEvent,
  GitReviewRepositoryMetadataRequest,
  GitReviewRepositoryMetadataResult,
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
  CodexProtocolRequestId,
  CodexPermissionState,
  CodexProjectlessThreadCwdInput,
  CodexProjectlessWorkspace,
  CodexSteerTurnInput,
  CodexSideChatStartInput,
  CodexSideChatStartResult,
  CodexThreadStartForSessionInput,
  CodexThreadStartForSessionResult,
  CodexThreadGoalDraftInput,
  CodexThreadGoalSetActionInput,
  CodexThreadGoalMaterializedDraft,
  CodexThreadSummary,
  ProtocolAppInfo,
  ProtocolExperimentalFeature,
  ProtocolMcpResourceReadParams,
  ProtocolMcpResourceReadResponse,
  ProtocolListMcpServerStatusResponse,
  CodexTurnStartOptions,
  CodexTurnSummary,
  ManagedWorktreeRecord,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentSettingsSnapshot,
  UpdateWorktreeEnvironmentConfigInput,
  UpdateCodexDeveloperInstructionSettingsInput,
  UpdateCodexGitSettingsInput,
  PageOccurrence,
  ClipboardPasteInspectionResult,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
  DatabasePage,
  DatabasePageSummary,
  DatabaseRowsDetailsInput,
  PageSearchInput,
  PageSearchResult,
  CommandPaletteThreadSearchInput,
  CommandPaletteThreadSearchResult,
  CommandPaletteThreadListInput,
  CommandPaletteThreadSummary,
  CreateBackupInput,
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
  WorkspaceFileMetadataInput,
  WorkspaceFileMetadata,
  WorkspaceFileReadResult,
  WorkspaceFileRequest,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from "./types";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "./native-context-menu";
import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeCreateResult,
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
  CodexPendingWorktreeWarningEvent,
  CodexPendingWorktreesChangedEvent,
} from "./codex-pending-worktree";
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
import type { ProductFeatureGates } from "./product-feature-gates";
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
  BrowserSidebarTabIdentity,
  BrowserSidebarWebviewAttached,
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
  BrowserUseCursorState,
} from "./browser-sidebar";
import type {
  FeedbackUploadParams,
  FeedbackUploadResponse,
  ThreadGoal,
} from "@nodex/codex-app-server-protocol/v2";
import type { ThreadMemoryMode } from "@nodex/codex-app-server-protocol";

export type ClipboardWriteImageResult =
  { ok: true } | { ok: false; message: string };

export interface ComposerPickedFile {
  label: string;
  path: string;
  bytes?: number;
  mimeType?: string;
  imageDataUrl?: string;
}

export interface BoardChangeEvent {
  projectId: string;
  storeEpoch?: string;
  changeLogSeq?: number;
  changeType: string;
  columnId: DatabasePage["status"];
  status: DatabasePage["status"];
  pageId?: string;
  summary?: DatabasePageSummary;
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
  | "move"
  | "reorder"
  | "pin"
  | "archive"
  | "unarchive"
  | "unread"
  | "link"
  | "thread";

export type ProjectSessionInvalidationScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "projectless" }
  | { readonly kind: "all" };

export type ProjectSessionDetailInvalidation =
  | { readonly kind: "sessions"; readonly sessionIds: readonly string[] }
  | { readonly kind: "all" };

export interface ProjectSessionsChangeEvent {
  readonly summaryScopes: readonly ProjectSessionInvalidationScope[];
  readonly detailInvalidation: ProjectSessionDetailInvalidation;
  readonly changeType: ProjectSessionChangeType;
}

export interface ProjectsChangeEvent {
  projectId?: string;
  changeType:
    | "create"
    | "update"
    | "metadata"
    | "sources"
    | "lifecycle"
    | "delete"
    | "reorder"
    | "pin";
}

export type PersistedAtomState = Record<string, unknown>;

/** Main-internal compatibility input for values that are not renderer mutations. */
export interface PersistedAtomUpdate {
  key: string;
  value: unknown;
}

export interface PersistedAtomSnapshot {
  revision: number;
  values: PersistedAtomState;
}

export interface PersistedAtomMutation extends PersistedAtomUpdate {
  mutationId: string;
}

export interface PersistedAtomEvent extends PersistedAtomMutation {
  revision: number;
  originRendererId: string | null;
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
  "projection-stream:subscribe": {
    args: [scope: import("./projection-stream").ProjectionScope];
    result: void;
  };
  "projection-stream:unsubscribe": {
    args: [scope: import("./projection-stream").ProjectionScope];
    result: void;
  };
  "pages:detail:get": {
    args: [projectId: string, pageId: string];
    result: PageDetailResult;
  };
  "pages:history:list": {
    args: [request: ListPageHistoryRequest];
    result: PageHistoryCommandResult;
  };
  "block-documents:mutate": {
    args: [
      projectId: string,
      documentId: string,
      request: DocumentMutationRequest,
    ];
    result: DocumentOperationCommandResult;
  };
  "block-documents:command": {
    args: [projectId: string, request: PublicAdditionalDocumentCommandRequest];
    result: AdditionalDocumentCommandResult;
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
    args: [projectId: string, request: BlockPropertyMutationRequestV2];
    result: BlockPropertyMutationCommandResultV2;
  };
  "library-block-properties:mutate": {
    args: [request: LibraryBlockPropertyMutationRequestV2];
    result: LibraryBlockPropertyMutationCommandResultV2;
  };
  "pages:lifecycle:preflight": {
    args: [projectId: string, pageId: string];
    result: PageLifecyclePreflightResultV2;
  };
  "pages:lifecycle:apply": {
    args: [projectId: string, request: PageLifecycleMutationRequestV2];
    result: PageLifecycleMutationCommandResultV2;
  };
  "database-module:read": {
    args: [projectId: string, request: DatabaseModuleReadRequestV2];
    result: DatabaseModuleReadResultV2;
  };
  "database-module:apply": {
    args: [projectId: string, request: DatabaseApplyV2];
    result: DatabaseApplyResultV2;
  };
  "library-module:read": {
    args: [request: LibraryModuleReadRequest];
    result: LibraryModuleReadResult;
  };
  "library-module:apply": {
    args: [request: LibraryModuleApplyRequest];
    result: LibraryModuleApplyResult;
  };
  "library-database-module:read": {
    args: [request: LibraryDatabaseModuleReadRequestV2];
    result: LibraryDatabaseModuleReadResultV2;
  };
  "library-database-module:apply": {
    args: [request: LibraryDatabaseApplyV2];
    result: LibraryDatabaseApplyResultV2;
  };
  "library-pages:detail:get": {
    args: [pageId: string];
    result: LibraryPageDetailResult;
  };
  "page-target:resolve": {
    args: [input: ResolvePageTargetInput];
    result: PageTargetReadModel | null;
  };
  "page-ownership-path:resolve": {
    args: [input: ResolvePageOwnershipPathInput];
    result: PageOwnershipPathReadModel | null;
  };
  "database-view:reference:get": {
    args: [input: ReadDatabaseViewReferenceInput];
    result: DatabaseViewReadModel | null;
  };
  "block-document:owned:get": {
    args: [projectId: string, ownerBlockId: string];
    result: OwnedDocumentDescriptor;
  };
  "block-document:owned:prepare": {
    args: [projectId: string, ownerBlockId: string];
    result: DocumentSyncCommandResult<OwnedDocumentDescriptor>;
  };
  "library-block-document:owned:prepare": {
    args: [ownerBlockId: string];
    result: DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>;
  };
  "document-sync:subscribe": {
    args: [request: ProjectScopedDocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncSubscriptionAck>;
  };
  "document-sync:unsubscribe": {
    args: [request: ProjectScopedDocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncUnsubscribeAck>;
  };
  "document-sync:sync": {
    args: [request: ProjectScopedDocumentSyncRequest];
    result: DocumentSyncCommandResult<DocumentSyncResponse>;
  };
  "document-sync:apply": {
    args: [request: ProjectScopedDocumentSyncApplyRequest];
    result: DocumentSyncCommandResult<DocumentSyncApplyAck>;
  };
  "canvas-scene:subscribe": {
    args: [request: CanvasSceneSubscribeRequest];
    result: CanvasSceneSubscriptionCommandResult;
  };
  "canvas-scene:unsubscribe": {
    args: [request: CanvasSceneSubscribeRequest];
    result: CanvasSceneSubscriptionCommandResult;
  };
  "canvas-scene:sync": {
    args: [request: CanvasSceneSyncRequest];
    result: CanvasSceneSyncCommandResult;
  };
  "canvas-scene:apply": {
    args: [request: CanvasSceneMutationRequest];
    result: CanvasSceneMutationCommandResult;
  };
  "document-sync:awareness:publish": {
    args: [request: ProjectScopedDocumentAwarenessPublishRequest];
    result: DocumentSyncCommandResult<DocumentAwarenessPublishAck>;
  };
  "document-sync:relocation-lease:respond": {
    args: [request: ProjectScopedDocumentRelocationLeaseResponseRequest];
    result: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
  };
  "library-document-sync:subscribe": {
    args: [request: DocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncSubscriptionAck>;
  };
  "library-document-sync:unsubscribe": {
    args: [request: DocumentSyncSubscribeRequest];
    result: DocumentSyncCommandResult<DocumentSyncUnsubscribeAck>;
  };
  "library-document-sync:sync": {
    args: [request: DocumentSyncRequest];
    result: DocumentSyncCommandResult<DocumentSyncResponse>;
  };
  "library-document-sync:apply": {
    args: [request: DocumentSyncApplyRequest];
    result: DocumentSyncCommandResult<DocumentSyncApplyAck>;
  };
  "library-document-sync:awareness:publish": {
    args: [request: DocumentAwarenessPublishRequest];
    result: DocumentSyncCommandResult<DocumentAwarenessPublishAck>;
  };
  "library-document-sync:relocation-lease:respond": {
    args: [request: DocumentRelocationLeaseResponseRequest];
    result: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
  };
  "blocks:transfer": {
    args: [projectId: string, intent: PublicBlockTransferIntent];
    result: BlockTransferCommandResult;
  };
  "diagnostics:renderer-log": {
    args: [input: RendererDiagnosticsLogInput];
    result: void;
  };
  "codex-desktop:message-from-view": {
    args: [message: CodexDesktopMessageFromView];
    result: void;
  };
  "persisted-atom:sync-request": { args: []; result: PersistedAtomSnapshot };
  "persisted-atom:update": {
    args: [mutation: PersistedAtomMutation];
    result: PersistedAtomEvent;
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
  "board:summary:get": { args: [projectId: string]; result: BoardSummarySnapshot };
  "database-rows:details:get": {
    args: [projectId: string, input: DatabaseRowsDetailsInput];
    result: DatabasePage[];
  };
  "pages:search": {
    args: [input: PageSearchInput];
    result: PageSearchResult[];
  };
  "database-row:get": {
    args: [projectId: string, pageId: string, status?: DatabasePage["status"]];
    result: DatabasePage | null;
  };
  "calendar:occurrences": {
    args: [
      projectId: string,
      windowStart: Date,
      windowEnd: Date,
      searchQuery?: string,
    ];
    result: { occurrences: PageOccurrence[] };
  };
  "page:occurrence:complete": {
    args: [
      projectId: string,
      input: PageOccurrenceCompleteInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "page:occurrence:skip": {
    args: [
      projectId: string,
      input: PageOccurrenceActionInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
  };
  "page:occurrence:update": {
    args: [
      projectId: string,
      input: PageOccurrenceUpdateInput,
      sessionId?: string,
    ];
    result: { success: boolean; error?: string };
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
  "settings:codex-developer:get": {
    args: [];
    result: CodexDeveloperInstructionSettings;
  };
  "settings:codex-developer:update": {
    args: [input: UpdateCodexDeveloperInstructionSettingsInput];
    result: CodexDeveloperInstructionSettings;
  };
  "settings:git:get": { args: []; result: CodexGitSettings };
  "settings:git:update": {
    args: [input: UpdateCodexGitSettingsInput];
    result: CodexGitSettings;
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
  "read-file": {
    args: [input: WorkspaceFileRequest];
    result: WorkspaceFileReadResult;
  };
  "read-file-metadata": {
    args: [input: WorkspaceFileMetadataInput];
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
  "app:feature-gates:get": { args: []; result: ProductFeatureGates };
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
  "git:review:repository-metadata": {
    args: [input: GitReviewRepositoryMetadataRequest];
    result: GitReviewRepositoryMetadataResult;
  };
  "git:live-query:subscribe": {
    args: [input: GitReviewLiveSubscriptionInput];
    result: void;
  };
  "git:live-query:unsubscribe": {
    args: [input: GitReviewLiveSubscriptionStopInput];
    result: void;
  };
  "git:live-query:recover": {
    args: [input: GitReviewLiveSubscriptionStopInput];
    result: void;
  };
  "git:live-query:refresh-repository": {
    args: [input: GitReviewLiveSubscriptionStopInput];
    result: void;
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
  "git:review:cat-file": {
    args: [input: GitReviewCatFileInput];
    result: GitReviewCatFileOutput;
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
  "codex:account:rate-limit-reset:consume": {
    args: [input: CodexRateLimitResetInput];
    result: CodexRateLimitResetResult;
  };
  "codex:dictation:state:read": {
    args: [];
    result: CodexDictationStateSnapshot;
  };
  "codex:conversation-image-asset:resolve": {
    args: [input: CodexConversationImageAssetResolveInput];
    result: CodexConversationImageAssetResolveResult;
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
  "codex:sidebar:thread:move": {
    args: [input: CodexSidebarThreadMoveInput];
    result: CodexSidebarThreadMoveResult;
  };
  "codex:sidebar:project-thread-order:set": {
    args: [input: CodexSidebarProjectThreadOrderInput];
    result: CodexSidebarProjectThreadOrderResult;
  };
  "codex:sidebar:chats-thread-order:set": {
    args: [input: CodexSidebarChatsThreadOrderInput];
    result: CodexSidebarChatsThreadOrderResult;
  };
  "codex:threads:pinned:list": {
    args: [];
    result: string[];
  };
  "codex:threads:pinned:set": {
    args: [threadId: string, input: { pinned: boolean }];
    result: CodexSidebarSnapshot;
  };
  "codex:threads:pinned:reorder": {
    args: [orderedThreadIds: string[]];
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
  "codex:threads:palette:search": {
    args: [input: CommandPaletteThreadSearchInput];
    result: CommandPaletteThreadSearchResult[];
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
  "agent-runtime:catalog:get": {
    args: [options?: { refresh?: boolean }];
    result: AgentProviderCatalog;
  };
  "agent-runtime:credential:set": {
    args: [input: AgentProviderCredentialMutationInput];
    result: AgentProviderCredentialMutationResult;
  };
  "agent-runtime:credential:delete": {
    args: [input: AgentProviderCredentialDeleteInput];
    result: AgentProviderCredentialMutationResult;
  };
  "agent-import:scan": {
    args: [input: AgentImportScanInput];
    result: AgentImportScan;
  };
  "agent-import:scan-picked-home": {
    args: [input: AgentImportScanInput];
    result: AgentImportScan | null;
  };
  "agent-import:apply": {
    args: [input: AgentImportApplyInput];
    result: AgentImportResult;
  };
  "codex:hooks:list": {
    args: [input: CodexHooksListInput];
    result: CodexHooksListResponse;
  };
  "codex:hooks:state:update": {
    args: [input: CodexHooksStateUpdateInput];
    result: void;
  };
  "codex:collaboration-mode:list": {
    args: [];
    result: CodexCollaborationModePreset[];
  };
  "codex:projectless-thread-cwd": {
    args: [input: CodexProjectlessThreadCwdInput];
    result: CodexProjectlessWorkspace;
  };
  "codex:thread:start-for-session": {
    args: [CodexThreadStartForSessionInput];
    result: CodexThreadStartForSessionResult;
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
  "codex:thread-owner:pending-requests:replay": {
    args: [threadId: string];
    result: number;
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
    args: [
      conversationId: string,
      requestId: CodexProtocolRequestId,
      context: {
        permissionMode: CodexAgentMode;
        serviceTierSelector:
          | { type: "standard" }
          | { type: "custom"; serviceTier: string };
      },
    ];
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
  "worktrees:environments:configs:list-for-workspace": {
    args: [hostId: string, workspaceRoot: string];
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
  "codex:pending-worktrees:list": {
    args: [];
    result: CodexPendingWorktreeEntry[];
  };
  "codex:pending-worktree:create": {
    args: [input: CodexPendingWorktreeCreateInput];
    result: CodexPendingWorktreeCreateResult;
  };
  "codex:pending-worktree:auto-fix": {
    args: [hostId: string, pendingWorktreeId: string, agentMode: CodexAgentMode];
    result: CodexPendingWorktreeCreateResult;
  };
  "codex:pending-worktree:retry": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:work-locally": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:continue": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:cancel": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:dismiss": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:rename": {
    args: [hostId: string, pendingWorktreeId: string, label: string];
    result: void;
  };
  "codex:pending-worktree:set-pinned": {
    args: [hostId: string, pendingWorktreeId: string, isPinned: boolean];
    result: void;
  };
  "codex:pending-worktree:set-pinned-before-thread": {
    args: [hostId: string, pendingWorktreeId: string, beforeThreadId: string | null];
    result: void;
  };
  "codex:pending-worktree:clear-attention": {
    args: [hostId: string, pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:discard-fork-side-panel-transfer": {
    args: [pendingWorktreeId: string];
    result: void;
  };
  "codex:pending-worktree:resolve-thread": {
    args: [clientThreadId: string];
    result: CodexPendingWorktreeThreadResolution | null;
  };
  "codex:fork-side-panel-transfer:consume": {
    args: [input: {
      routeKind: "local-thread";
      targetConversationId: string;
      targetProjectSessionId: string;
    }];
    result: boolean;
  };
  "codex:thread:snapshot:request": {
    args: [threadId: string];
    result: CodexConversationSnapshot | null;
  };
  "codex:thread:resume:request": {
    args: [threadId: string];
    result: CodexRendererConversationResumeResult | null;
  };
  "codex:thread:background-subagents:hydrate": {
    args: [input: CodexBackgroundSubagentThreadsHydrateInput];
    result: CodexThreadSummary[];
  };
  "codex:thread:subagents-panel:hydrate": {
    args: [input: CodexSubagentPanelHydrateInput];
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
    args: [threadId: string, collaborationMode: CodexCollaborationModeKind];
    result: CodexCollaborationModeState;
  };
  "codex:personality:get": { args: []; result: CodexPersonality };
  "codex:personality:set": { args: [personality: CodexPersonality]; result: void };
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
    args: [];
    result: ProtocolAppInfo[];
  };
  "codex:experimental-features:list": {
    args: [];
    result: ProtocolExperimentalFeature[];
  };
  "codex:mcp-server-statuses:list": {
    args: [];
    result: ProtocolListMcpServerStatusResponse;
  };
  "codex:approval:respond": {
    args: [
      conversationId: string,
      requestId: CodexProtocolRequestId,
      response: CodexApprovalResponse,
    ];
    result: boolean;
  };
  "codex:user-input:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, answers: Record<string, string[]>];
    result: boolean;
  };
  "codex:mcp-elicitation:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, response: CodexMcpServerElicitationResponse];
    result: boolean;
  };
  "codex:permission-request:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, response: CodexPermissionRequestResponse];
    result: boolean;
  };
  "codex:option-picker:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, response: CodexCanonicalOptionPickerResponse];
    result: boolean;
  };
  "codex:setup-context-picker:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, response: CodexCanonicalSetupContextPickerResponse];
    result: boolean;
  };
  "codex:setup-codex-step:respond": {
    args: [conversationId: string, requestId: CodexProtocolRequestId, response: CodexCanonicalSetupCodexStepResponse];
    result: boolean;
  };
  "codex:conversation-unread:set": {
    args: [conversationId: string, hasUnreadTurn: boolean];
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
  "agent-import:progress": AgentImportProgress;
  "git:live-query:event": GitReviewLiveEvent;
  "document-sync:event": DocumentSyncRealtimeEvent;
  "persisted-atom:updated": PersistedAtomEvent;
  "projection-stream:message": import("./projection-stream").ProjectionStreamMessage;
  "board-changed": BoardChangeEvent;
  "page-ownership-paths-changed": import("./page-ownership-path-events").PageOwnershipPathsChangedEvent;
  "database-changed": DatabaseChangeEvent;
  "library-navigation-changed": import("./library-events").LibraryNavigationChangedEvent;
  "projects-changed": ProjectsChangeEvent;
  "project-sessions-changed": ProjectSessionsChangeEvent;
  "reminder:open": {
    projectId: string;
    pageId: string;
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
  "codex:scheduled-automations:changed": CodexScheduledAutomationChangedEvent;
  "codex:automation-runs:updated": CodexAutomationRunsUpdatedEvent;
  "codex:hooks:changed": CodexHooksChangedEvent;
  "codex:pending-worktrees:changed": CodexPendingWorktreesChangedEvent;
  "codex:pending-worktree:warning": CodexPendingWorktreeWarningEvent;
  "browser-sidebar-state": BrowserSidebarStateSnapshot;
  "browser-sidebar-local-servers": BrowserSidebarLocalServersSnapshot;
  "browser-sidebar-browser-use-state": BrowserSidebarBrowserUseStateSnapshot;
  "browser-sidebar-browser-use-viewport": BrowserSidebarBrowserUseViewportEvent;
  "browser-sidebar-browser-use-capture-surface": BrowserSidebarBrowserUseCaptureSurfaceEvent;
  "browser-sidebar-browser-use-cursor-state": BrowserUseCursorState;
  "browser-sidebar-browser-use-page-released": BrowserSidebarTabIdentity;
  "browser-sidebar-webview-attached": BrowserSidebarWebviewAttached;
  "browser-sidebar-destroy-webview": BrowserSidebarDestroyWebviewRequest;
  "remote-hosted-pip-stream-state-changed": RemoteHostedPipStreamStateChangedMessage;
  "remote-hosted-pip-visibility-requested": RemoteHostedPipVisibilityRequestedMessage;
  "desktop-notification:action": DesktopNotificationActionPayload & {
    conversationId: string | null;
    requestId: CodexProtocolRequestId | null;
    approvalKind: CodexApprovalKind | null;
  };
  "electron-window:focus-changed": { isFocused: boolean };
  "electron-window-opaque-surface-changed": {
    opaqueWindowSurfaceEnabled: boolean;
  };
}
