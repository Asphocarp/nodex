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
  CodexServiceTier,
  GitApplyPatchInput,
  GitApplyPatchResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewSnapshot,
  GitReviewSource,
  CodexHostMessage,
  CodexModelOption,
  CodexPermissionMode,
  CodexPermissionState,
  CodexSteerTurnInput,
  CodexThreadStartForCardInput,
  CodexThreadDetail,
  CodexThreadSummary,
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
  ProjectInput,
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
} from "./types";
import type { WorkbenchResumeSnapshot } from "./workbench-resume";
import type {
  WorkbenchLayoutSnapshot,
  WorkspaceBootstrap,
} from "./workspace";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "./window-session";
import type {
  FileLinkOpenerId,
  FileLinkTarget,
} from "./file-link-openers";

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

export interface IpcApi {
  "projects:list": { args: []; result: Project[] };
  "projects:get": { args: [projectId: string]; result: Project | null };
  "projects:create": { args: [input: ProjectInput]; result: Project };
  "projects:rename": {
    args: [
      oldId: string,
      newId: string,
      updates?: { name?: string; description?: string; icon?: string; workspacePath?: string | null },
    ];
    result: Project | null;
  };
  "projects:delete": { args: [projectId: string]; result: boolean };
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
  "workbench:resume:consume": { args: []; result: WorkbenchResumeSnapshot | null };
  "workbench:resume:save": { args: [snapshot: WorkbenchResumeSnapshot]; result: boolean };
  "workspaces:bootstrap": { args: []; result: WorkspaceBootstrap };
  "workspaces:create": { args: [name: string, layout: WorkbenchLayoutSnapshot, icon?: string | null]; result: WorkspaceBootstrap };
  "workspaces:rename": { args: [workspaceId: string, name: string, icon?: string | null]; result: WorkspaceBootstrap };
  "workspaces:delete": { args: [workspaceId: string]; result: WorkspaceBootstrap };
  "workspaces:save-layout": {
    args: [workspaceId: string, layout: WorkbenchLayoutSnapshot];
    result: WorkspaceBootstrap;
  };
  "workspaces:set-active": { args: [workspaceId: string]; result: WorkspaceBootstrap };
  "window-sessions:bootstrap": { args: []; result: WindowSessionBootstrap };
  "window-sessions:save-layout": {
    args: [workspaceId: string, layout: WorkbenchLayoutSnapshot];
    result: WindowSessionBootstrap;
  };
  "window-sessions:update-bounds": {
    args: [bounds: WindowSessionBounds];
    result: void;
  };
  // Internal app lifecycle handshake used to flush renderer state before window close.
  "app:flush-before-close:done": { args: [webContentsId: number]; result: void };

  // Git review
  "git:review:snapshot": {
    args: [input: { cwd: string; source: GitReviewSource; baseRef?: string | null }];
    result: GitReviewSnapshot;
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
  "codex:thread:follow-up:enqueue": {
    args: [threadId: string, prompt: string, opts?: CodexTurnStartOptions];
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
  "reminder:open": { projectId: string; cardId: string; occurrenceStart: string };
  "pty:data": { sessionId: string; data: string };
  "pty:exit": { sessionId: string; exitCode: number };
  "codex:event": CodexEvent;
  "codex:host-message": CodexHostMessage;
  "desktop-notification:action": DesktopNotificationActionPayload & {
    conversationId: string | null;
    requestId: string | null;
  };
  "electron-window:focus-changed": { isFocused: boolean };
}
