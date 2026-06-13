import type {
  BackupRecord,
  BackupSettings,
  HistorySettings,
  AppUpdateSettings,
  AppUpdateStatus,
  Board,
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexThreadActionResult,
  CodexConversationSnapshot,
  CodexConnectionState,
  CodexDictationStateSnapshot,
  CodexCollaborationModePreset,
  CodexCollaborationModeState,
  CodexEvent,
  CodexReviewStartParams,
  CodexReviewStartResponse,
  CodexServiceTier,
  BranchDiffStatsRequest,
  BranchDiffStatsResult,
  GitApplyPatchInput,
  GitApplyPatchResult,
  GitMergeBaseRequest,
  GitMergeBaseResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewSnapshot,
  GitReviewSource,
  ReviewDiffRequest,
  ReviewDiffResult,
  CodexHostMessage,
  CodexModelOption,
  CodexPermissionMode,
  CodexPermissionState,
  CodexSteerTurnInput,
  CodexSideChatStartInput,
  CodexSideChatStartResult,
  CodexThreadStartForCardInput,
  CodexThreadStartForSessionInput,
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
  CardCreateInput,
  CardUpdateResult,
  CardDropMoveToEditorInput,
  CardDropMoveToEditorResult,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
  CanvasData,
  Card,
  CardInput,
  CardCreatePlacement,
  CreateBackupInput,
  MoveCardInput,
  MoveCardToProjectInput,
  MoveCardToProjectResult,
  MoveCardsInput,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionForkInput,
  ProjectSessionForkResult,
  ProjectSessionListOptions,
  ProjectSessionPanelState,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelMaximizeInput,
  ProjectSessionPanelMergeInput,
  ProjectSessionPanelResizeInput,
  ProjectSessionPanelSplitInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
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
  ThreadNotificationSettings,
  DesktopNotificationPayload,
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
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "./native-context-menu";
import type { WorkbenchLayoutSnapshot } from "./workbench-layout";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "./window-session";
import type {
  FileLinkOpenerId,
  FileLinkTarget,
} from "./file-link-openers";
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
  | { ok: true }
  | { ok: false; message: string };

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
  status: Card["status"];
  cardId?: string;
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
  | "thread";

export interface ProjectSessionsChangeEvent {
  projectId: string;
  changeType: ProjectSessionChangeType;
  sessionId?: string;
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

export interface IpcApi {
  "projects:list": { args: []; result: Project[] };
  "projects:get": { args: [projectId: string]; result: Project | null };
  "projects:create": { args: [input: ProjectCreateInput]; result: Project };
  "projects:update": {
    args: [projectId: string, updates: ProjectUpdateInput];
    result: Project | null;
  };
  "projects:pick-source-root": { args: []; result: string | null };
  "projects:delete": { args: [projectId: string]; result: boolean };
  "project-sessions:list": { args: [projectId: string, options?: ProjectSessionListOptions]; result: ProjectSession[] };
  "project-sessions:create": { args: [input: ProjectSessionCreateInput]; result: ProjectSession };
  "project-sessions:update": {
    args: [sessionId: string, input: ProjectSessionUpdateInput];
    result: ProjectSession | null;
  };
  "project-sessions:delete": { args: [sessionId: string]; result: boolean };
  "project-sessions:reorder": { args: [projectId: string, orderedSessionIds: string[]]; result: ProjectSession[] };
  "project-sessions:set-pinned": {
    args: [sessionId: string, input: ProjectSessionPinnedInput];
    result: ProjectSession | null;
  };
  "project-sessions:set-pinned-order": {
    args: [projectId: string, input: ProjectSessionPinnedOrderInput];
    result: ProjectSession[];
  };
  "project-sessions:archive": { args: [sessionId: string]; result: ProjectSession | null };
  "project-sessions:unarchive": { args: [sessionId: string]; result: ProjectSession | null };
  "project-sessions:mark-unread": {
    args: [sessionId: string, input: ProjectSessionUnreadInput];
    result: ProjectSession | null;
  };
  "project-sessions:fork": {
    args: [sessionId: string, input: ProjectSessionForkInput];
    result: ProjectSessionForkResult;
  };
  "project-session-tabs:create": { args: [input: ProjectSessionTabCreateInput]; result: ProjectSessionTab };
  "project-session-tabs:update": {
    args: [tabId: string, input: ProjectSessionTabUpdateInput];
    result: ProjectSessionTab | null;
  };
  "project-session-tabs:delete": { args: [input: string | ProjectSessionTabDeleteInput]; result: boolean };
  "project-session-panels:update": {
    args: [sessionId: string, panelId: "right" | "bottom", input: Partial<ProjectSessionPanelState>];
    result: ProjectSession | null;
  };
  "project-session-panels:split": { args: [input: ProjectSessionPanelSplitInput]; result: ProjectSession | null };
  "project-session-panels:merge": { args: [input: ProjectSessionPanelMergeInput]; result: ProjectSession | null };
  "project-session-panels:activate": { args: [input: ProjectSessionPanelActivateInput]; result: ProjectSession | null };
  "project-session-panels:resize": { args: [input: ProjectSessionPanelResizeInput]; result: ProjectSession | null };
  "project-session-panels:maximize": { args: [input: ProjectSessionPanelMaximizeInput]; result: ProjectSession | null };
  "project-session-tabs:state:update": {
    args: [tabId: string, stateKey: number, state: unknown];
    result: ProjectSessionTab | null;
  };
  "project-session-tabs:reorder": { args: [input: ProjectSessionTabReorderInput]; result: ProjectSession | null };
  "project-session-tabs:move": { args: [input: ProjectSessionTabMoveInput]; result: ProjectSession | null };
  "project-session-threads:attach": {
    args: [input: ProjectSessionThreadLinkInput];
    result: ProjectSessionThreadLink;
  };
  "project-session-threads:detach": { args: [sessionId: string]; result: boolean };
  "board:get": { args: [projectId: string]; result: Board };
  "card:create": {
    args: [projectId: string, status: Card["status"], input: CardCreateInput, sessionId?: string, placement?: CardCreatePlacement];
    result: Card;
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
  "card:get": {
    args: [projectId: string, cardId: string, status?: Card["status"]];
    result: Card | null;
  };
  "card:delete": {
    args: [projectId: string, status: Card["status"] | undefined, cardId: string, sessionId?: string];
    result: boolean;
  };
  "card:move": {
    args: [input: MoveCardInput & { projectId: string; sessionId?: string }];
    result: boolean;
  };
  "card:move-many": {
    args: [input: MoveCardsInput & { projectId: string; sessionId?: string }];
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
  "card:move-drop-to-editor": {
    args: [projectId: string, input: CardDropMoveToEditorInput, sessionId?: string];
    result: CardDropMoveToEditorResult;
  };
  "calendar:occurrences": {
    args: [projectId: string, windowStart: Date, windowEnd: Date, searchQuery?: string];
    result: { occurrences: CalendarOccurrence[] };
  };
  "card:occurrence:complete": {
    args: [projectId: string, input: CardOccurrenceActionInput, sessionId?: string];
    result: { success: boolean; error?: string };
  };
  "card:occurrence:skip": {
    args: [projectId: string, input: CardOccurrenceActionInput, sessionId?: string];
    result: { success: boolean; error?: string };
  };
  "card:occurrence:update": {
    args: [projectId: string, input: CardOccurrenceUpdateInput, sessionId?: string];
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
    args: [projectId: string, cardId: string, historyId: number, sessionId?: string];
    result: { success: boolean; error?: string };
  };
  "db:schema": { args: [projectId: string]; result: SchemaResult };
  "db:query": { args: [projectId: string, sql: string, params?: unknown[]]; result: QueryResult };
  "backup:list": { args: []; result: BackupRecord[] };
  "backup:create": { args: [input?: CreateBackupInput]; result: BackupRecord };
  "backup:delete": { args: [backupId: string]; result: { success: true; deletedBackupId: string } };
  "backup:restore": { args: [input: RestoreBackupInput]; result: RestoreBackupResult };
  "settings:backup:get": { args: []; result: BackupSettings };
  "settings:backup:update": { args: [input: UpdateBackupSettingsInput]; result: BackupSettings };
  "settings:history:get": { args: []; result: HistorySettings };
  "settings:history:update": { args: [input: UpdateHistorySettingsInput]; result: HistorySettings };
  "settings:thread-notifications:get": { args: []; result: ThreadNotificationSettings };
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
  "read-file": { args: [input: WorkspaceFileReadInput]; result: WorkspaceFileReadResult };
  "read-file-metadata": { args: [input: WorkspaceFileRequest]; result: WorkspaceFileMetadata };
  "read-file-binary": { args: [input: WorkspaceFileRequest]; result: WorkspaceFileBinaryReadResult };
  "write-file": { args: [input: WorkspaceFileWriteInput]; result: WorkspaceFileWriteResult };
  "paths-exist": { args: [input: WorkspacePathsExistInput]; result: WorkspacePathsExistResult };
  "open-file": {
    args: [target: FileLinkTarget, openerId: FileLinkOpenerId];
    result: boolean;
  };
  "canvas:get": { args: [projectId: string]; result: CanvasData | null };
  "canvas:save": { args: [projectId: string, data: CanvasData]; result: void };
  "asset:resolve-path": { args: [source: string]; result: string | null };
  "clipboard:write-image": { args: [input: { source: string }]; result: ClipboardWriteImageResult };
  "clipboard:inspect-paste": { args: []; result: ClipboardPasteInspectionResult };
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
  "app:flush-before-close:done": { args: [webContentsId: number]; result: void };

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
    args: [input: { cwd: string; source: GitReviewSource; baseRef?: string | null }];
    result: GitReviewSnapshot;
  };
  "git:review:diff": {
    args: [input: ReviewDiffRequest];
    result: ReviewDiffResult;
  };
  "git:review:branch-diff-stats": {
    args: [input: BranchDiffStatsRequest];
    result: BranchDiffStatsResult;
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
  "git:apply-patch": { args: [input: GitApplyPatchInput]; result: GitApplyPatchResult };
  "git:init": { args: [cwd: string]; result: GitReviewSnapshot };

  // Terminal
  "pty:spawn": {
    args: [sessionId: string, opts: { cols: number; rows: number; cwd?: string }];
    result: { success: boolean; error?: string };
  };
  "pty:write": { args: [sessionId: string, data: string]; result: void };
  "pty:resize": { args: [sessionId: string, cols: number, rows: number]; result: void };
  "pty:kill": { args: [sessionId: string]; result: void };
  "pty:pick-cwd": { args: []; result: string | null };

  // Codex
  "codex:connection:status": { args: []; result: CodexConnectionState };
  "codex:account:read": { args: []; result: CodexAccountSnapshot };
  "codex:dictation:state:read": { args: []; result: CodexDictationStateSnapshot };
  "codex:account:login:start": {
    args: [input: { type: "chatgpt" } | { type: "apiKey"; apiKey: string }];
    result: { type: "apiKey" } | { type: "chatgpt"; loginId: string; authUrl: string };
  };
  "codex:account:login:cancel": {
    args: [loginId: string];
    result: { status: "canceled" | "notFound" };
  };
  "codex:account:logout": { args: []; result: boolean };
  "codex:threads:list": {
    args: [projectId: string, opts?: { cardId?: string; includeArchived?: boolean }];
    result: CodexThreadSummary[];
  };
  "codex:model:list": {
    args: [];
    result: CodexModelOption[];
  };
  "codex:collaboration-mode:list": {
    args: [];
    result: CodexCollaborationModePreset[];
  };
  "codex:thread:start-for-card": {
    args: [CodexThreadStartForCardInput];
    result: CodexThreadDetail;
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
  "worktrees:list": { args: []; result: ManagedWorktreeRecord[] };
  "worktrees:environments:list": { args: [projectId: string]; result: WorktreeEnvironmentOption[] };
  "worktrees:environments:configs:list": { args: [projectId: string]; result: WorktreeEnvironmentConfigRecord[] };
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
  "codex:thread:name:set": {
    args: [threadId: string, name: string];
    result: boolean;
  };
  "codex:thread:title:generate": {
    args: [input: { hostId: string; prompt: string; cwd: string | null }];
    result: { title: string | null };
  };
  "codex:thread:archive": { args: [threadId: string]; result: boolean };
  "codex:thread:unarchive": { args: [threadId: string]; result: CodexThreadSummary | null };
  "codex:thread:collaboration-mode:set": {
    args: [threadId: string, collaborationMode: "default" | "plan"];
    result: CodexCollaborationModeState;
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
  "codex:thread:edit-last-user-turn": {
    args: [threadId: string, turnId: string, message: string, opts?: { serviceTier?: CodexServiceTier }];
    result: CodexThreadActionResult;
  };
  "codex:thread:fork-from-turn": {
    args: [threadId: string, turnId: string, message: string];
    result: CodexThreadActionResult;
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
    args: [threadId: string, objective: string, tokenBudget?: number | null];
    result: ThreadGoal | null;
  };
  "codex:thread:goal:clear": {
    args: [threadId: string];
    result: void;
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
    args: [requestId: string, action: "accept" | "decline" | "cancel"];
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
  "board-changed": BoardChangeEvent;
  "project-sessions-changed": ProjectSessionsChangeEvent;
  "reminder:open": { projectId: string; cardId: string; occurrenceStart: string };
  "pty:data": { sessionId: string; data: string };
  "pty:exit": { sessionId: string; exitCode: number };
  "codex:event": CodexEvent;
  "codex:host-message": CodexHostMessage;
  "browser-sidebar-state": BrowserSidebarStateSnapshot;
  "browser-sidebar-local-servers": BrowserSidebarLocalServersSnapshot;
  "browser-sidebar-browser-use-state": BrowserSidebarBrowserUseStateSnapshot;
  "browser-sidebar-browser-use-viewport": BrowserSidebarBrowserUseViewportEvent;
  "browser-sidebar-browser-use-capture-surface": BrowserSidebarBrowserUseCaptureSurfaceEvent;
  "browser-sidebar-browser-use-cursor-state": BrowserSidebarBrowserUseStateSnapshot["cursor"];
  "browser-sidebar-browser-use-page-released": { tabId: string };
  "browser-sidebar-webview-attached": BrowserSidebarWebviewAttached;
  "browser-sidebar-destroy-webview": BrowserSidebarDestroyWebviewRequest;
  "desktop-notification:action": DesktopNotificationActionPayload & {
    conversationId: string | null;
    requestId: string | null;
  };
  "electron-window:focus-changed": { isFocused: boolean };
}
