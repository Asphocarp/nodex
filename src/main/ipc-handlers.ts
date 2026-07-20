import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from "electron";
import { performance } from "node:perf_hooks";
import { writeImageToClipboard } from "./clipboard-image-writer";
import { inspectClipboardPasteItems } from "./clipboard-paste-inspector";
import { prepareComposerPickedFiles } from "./composer-picked-files";
import * as boardReadModel from "./local-store/board-read-model";
import * as pagesStore from "./local-store/database-pages";
import {
  readProjectScopedDatabaseViewReference,
  resolveProjectScopedPageOwnershipPath,
  resolveProjectScopedPageTarget,
} from "./local-store/reference-reads";
import { registerPersistedAtomIpc } from "./persisted-atom-ipc";
import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import * as sqlInspection from "./local-store/sql-inspection";
import { terminalManager } from "./terminal-manager";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getCommandKeymapState,
  getCodexDeveloperInstructionSettings,
  getCodexGitSettings,
  getDiagnosticsSettings,
  getHistorySettings,
  getTelemetrySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
  resetCommandKeybindings,
  updateCommandKeybinding,
  updateCodexDeveloperInstructionSettings,
  updateCodexGitSettings,
  updateAppUpdateSettings,
  updateBackupSettings,
  updateDiagnosticsSettings,
  updateHistorySettings,
  updateTelemetrySettings,
  updateThreadNotificationSettings,
  updateWindowRestoreSettings,
} from "./local-store/config";
import { resolveAssetPath } from "./local-store/assets";
import { parseAssetSource } from "../shared/assets";
import { parseCodexApprovalResponse } from "../shared/codex-approval-response";
import { codexService } from "./codex/codex-service";
import {
  createCodexProjectlessWorkspace,
  parseCodexProjectlessThreadCwdInput,
} from "./codex/codex-projectless-workspace";
import type {
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
  CodexBackgroundProcessRunActionInput,
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
  CodexApprovalResponse,
  CodexCollaborationModeKind,
  CodexProtocolRequestId,
} from "../shared/types";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  RendererClientRouter,
  RendererClientWebContents,
} from "./codex/renderer-client-router";
import {
  ackRendererThreadOwnerNotification,
  broadcastCodexHostMessageToRendererClients,
  publishRendererThreadOwnerStreamState,
  runThreadFollowerActionThroughOwner,
  sendRendererOwnerHostMessage,
} from "./codex/owner-follower-ipc-bridge";
import { openFileLinkTarget } from "./file-link-opener";
import {
  isWorkspaceFileUserError,
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  toWorkspaceFileIpcError,
  WorkspaceFileUserError,
  writeWorkspaceFile,
} from "./workspace-files-service";
import { isTrustedWorkspaceFileIpcSender } from "./workspace-file-ipc-authorization";
import {
  WorkspaceDirectoryEntriesInputSchema,
  WorkspaceFileMetadataInputSchema,
  WorkspaceFileRequestSchema,
  WorkspaceFileWriteInputSchema,
} from "../shared/schemas/workspace-files";
import { dbNotifier } from "./local-store/notifier";
import { blockMutationWriter } from "./block-mutation-writer";
import { projectDeletionRuntime } from "./project-deletion-runtime";
import { renameProjectSessionChat } from "./project-session-rename-service";
import { captureMainException } from "./observability/sentry-main";
import { getLogger } from "./logging/logger";
import type { WorkbenchLayoutSnapshot } from "../shared/workbench-layout";
import type { IpcApi, IpcEvents } from "../shared/ipc-api";
import type {
  DocumentRelocationLeaseResponseRequest,
  ProjectScopedDocumentRelocationLeaseResponseRequest,
} from "../shared/block-documents/document-sync";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "../shared/window-session";
import { productFeatureGates } from "./product-feature-gates";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "../shared/native-context-menu";
import { buildSessionContextMenuIconSvg } from "../shared/session-context-menu-icons";
import {
  browserSidebarService,
  broadcastBrowserSidebarEvent,
} from "./browser-sidebar-service";
import {
  deleteProjectSessionTabWithBrowserCleanupUsing,
  deleteProjectSessionWithBrowserCleanupUsing,
  deleteProjectWithBrowserCleanupUsing,
} from "./project-session-browser-ownership";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";
import type { DesktopDocumentSyncPort } from "./core-client/desktop-document-sync-bridge";
import type { DesktopLibraryModuleBridge } from "./core-client/desktop-library-module-bridge";
import type { DesktopDatabaseModuleBridge } from "./core-client/desktop-database-module-bridge";
import type { DesktopAutomationModulePort } from "./core-client/desktop-automation-module-bridge";
import { createTypeScriptAutomationModulePort } from "./typescript-automation-module-port";
import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import { createTypeScriptStoreAdministrationPort } from "./typescript-store-administration-port";
import type { DesktopNotificationManager } from "./desktop-notification-manager";
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  readGitBranchState,
  watchGitBranch,
} from "./git-branch-service";
import {
  cancelGitAction,
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
  pushGitChanges,
  readGitActionStatus,
} from "./git-action-service";
import {
  applyGitReviewPatch,
  cancelGitReviewRequest,
  initializeGitRepositoryAndReadReviewSnapshot,
  readBranchDiffStats,
  readGitReviewBlameFile,
  readGitReviewBranchCommits,
  readGitReviewCatFile,
  readGitReviewDiff,
  readGitReviewPatch,
  readGitReviewRepositoryMetadata,
  readGitReviewSnapshot,
  readGitReviewSummary,
  resolveGitMergeBase,
  searchGitReview,
} from "./git-review-service";
import {
  subscribeGitReviewLiveQuery,
  type GitReviewLiveSubscription,
} from "./git-review-live-service";
import {
  createGhPr,
  createGhPrComment,
  mergeGhPr,
  readGhCliStatus,
  readGhPrChecks,
  readGhPrComments,
  readGhPrDiff,
  readGhPrStatus,
  updateGhPr,
} from "./github-pr-service";
import type {
  AppUpdateSettings,
  AppUpdateStatus,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexConversationThreadSettingsPatch,
  CodexPersonality,
  CodexSideChatStartInput,
  CodexThreadGoalSetActionInput,
  CodexThreadStartForSessionInput,
  CodexTurnStartOptions,
} from "../shared/types";
import type {
  BrowserBrowsingDataKind,
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarCommand,
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
} from "../shared/browser-sidebar";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeymapState,
} from "../shared/command-keybindings";
import { safeBroadcastToWindows, safeSendToWebContents } from "./ipc-safe-send";
import { RemoteHostedPipService } from "./remote-hosted-pip-service";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
  recordDevRuntimeMetricCounter,
} from "./dev-runtime-metrics";
import { registerCodexScheduledAutomationIpcHandlers } from "./codex-scheduled-automation-ipc-handlers";
import { registerCodexHooksIpcHandlers } from "./codex-hooks-ipc-handlers";
import {
  type DocumentSyncClientTarget,
  DocumentSyncHub,
  documentSyncUnauthorized,
} from "./document-sync-hub";
import { documentSyncHub as defaultDocumentSyncHub } from "./document-sync-runtime";
import {
  registerBlockPropertyMutationIpcHandler,
  registerLibraryBlockPropertyMutationIpcHandler,
} from "./block-property-mutation-ipc";
import {
  registerDatabaseModuleIpcHandlers,
} from "./database-module-ipc";
import { registerLibraryModuleIpcHandler } from "./library-module-ipc";
import { registerLibraryDatabaseModuleIpcHandler } from "./library-database-module-ipc";
import { registerPageDetailIpcHandler } from "./page-detail-ipc";
import { registerLibraryPageDetailIpcHandler } from "./library-page-detail-ipc";
import { registerDocumentMutationIpcHandler } from "./document-operation-ipc";
import { registerAdditionalDocumentCommandIpcHandler } from "./additional-document-command-ipc";
import { registerBlockTransferIpcHandler } from "./block-transfer-ipc";
import { registerDocumentHistoryIpcHandlers } from "./document-history-ipc";
import {
  registerPageLifecycleIpcHandler,
  registerPageLifecyclePreflightIpcHandler,
} from "./page-lifecycle-ipc";
import { registerPageHistoryIpcHandler } from "./page-history-ipc";
import {
  registerCodexPendingWorktreeIpcHandlers,
  type CodexPendingWorktreeIpcService,
} from "./codex/codex-pending-worktree-ipc";
import { registerStoreAdministrationIpcHandlers } from "./store-administration-ipc-handlers";

type TypedIpcHandler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

const ipcPayloadLogger = getLogger({
  subsystem: "ipc",
  component: "kanban-read-model",
});
const rendererDiagnosticsLogger = getLogger({
  subsystem: "renderer",
  component: "diagnostics",
});
function boardCardCount(board: {
  columns: Array<{ cards: unknown[] }>;
}): number {
  return board.columns.reduce((sum, column) => sum + column.cards.length, 0);
}

function requireNonBlankStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => (
    typeof item !== "string" || item.trim().length === 0
  ))) {
    throw new Error(`${label} must contain only non-empty strings`);
  }
  return [...value];
}

function registerHandle<Channel extends keyof IpcApi>(
  channel: Channel,
  listener: TypedIpcHandler<Channel>,
): void {
  // Make registration idempotent so hot-reloads cannot leave partial channel maps.
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...(args as IpcApi[Channel]["args"]));
    } catch (error) {
      if (!isWorkspaceFileUserError(error)) {
        captureMainException(error, {
          tags: {
            channel,
            mechanism: "ipc",
          },
          extra: {
            channel,
            senderWebContentsId: event.sender.id,
            argCount: args.length,
          },
        });
      }
      throw error;
    }
  });
}

function requireTrustedWorkspaceFileSender(event: IpcMainInvokeEvent): void {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (isTrustedWorkspaceFileIpcSender({
    hasOwnerWindow: ownerWindow !== null,
    senderType: event.sender.getType(),
    isMainFrame: event.senderFrame === event.sender.mainFrame,
  })) {
    return;
  }
  throw new WorkspaceFileUserError(
    "unauthorized_sender",
    "Workspace file access is available only to the top-level app renderer",
  );
}

async function runWorkspaceFileHandler<Result>(
  event: IpcMainInvokeEvent,
  action: () => Result | Promise<Result>,
): Promise<Result> {
  requireTrustedWorkspaceFileSender(event);
  try {
    return await action();
  } catch (error) {
    throw toWorkspaceFileIpcError(error);
  }
}

function broadcastIpcEvent<Channel extends keyof IpcEvents>(
  channel: Channel,
  payload: IpcEvents[Channel],
): void {
  safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, [payload]);
}

async function showDirectoryPicker(
  event: IpcMainInvokeEvent,
  options: OpenDialogOptions,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

function sendIpcEvent<Channel extends keyof IpcEvents>(
  sender: Electron.WebContents,
  channel: Channel,
  payload: IpcEvents[Channel],
): void {
  safeSendToWebContents(sender, channel, [payload]);
}

let resolveRemoteHostedPipThreadId = async (
  sessionId: string,
): Promise<string | null> =>
  projectSessionService.getProjectSession(sessionId)?.thread?.threadId ?? null;

const remoteHostedPipService = new RemoteHostedPipService({
  broadcast: (channel, payload) => {
    broadcastIpcEvent(channel, payload);
  },
  resolveThreadIdForSession: async (sessionId) =>
    await resolveRemoteHostedPipThreadId(sessionId),
  sendToSender: (sender, channel, payload) => {
    sendIpcEvent(sender as Electron.WebContents, channel, payload);
  },
});

function refreshRemoteHostedPipState(
  snapshot: BrowserSidebarBrowserUseStateSnapshot,
): void {
  void remoteHostedPipService.handleBrowserUseStateSnapshot(snapshot).catch(
    (error) => {
      ipcPayloadLogger.warn("Could not resolve remote hosted PIP Thread state", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

function buildNativeContextMenuTemplate(
  items: NativeContextMenuItem[],
  onSelect: (id: string) => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }

    const enabled = item.enabled !== false;
    const icon = item.iconKey
      ? nativeImage.createFromDataURL(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSessionContextMenuIconSvg(item.iconKey))}`,
        )
      : undefined;
    icon?.setTemplateImage(true);

    const base = {
      id: item.id,
      label: item.label,
      enabled,
      accelerator: item.accelerator,
      toolTip: item.tooltip,
      icon,
    } satisfies MenuItemConstructorOptions;

    if (item.type === "submenu") {
      return {
        ...base,
        submenu: buildNativeContextMenuTemplate(item.submenu, onSelect),
      } satisfies MenuItemConstructorOptions;
    }

    if (item.type === "checkbox") {
      return {
        ...base,
        type: "checkbox",
        checked: item.checked === true,
        click: () => {
          if (enabled) onSelect(item.id);
        },
      } satisfies MenuItemConstructorOptions;
    }

    return {
      ...base,
      click: () => {
        if (enabled) onSelect(item.id);
      },
    } satisfies MenuItemConstructorOptions;
  });
}

function showNativeContextMenu(
  window: BrowserWindow | null,
  items: NativeContextMenuItem[],
  options: NativeContextMenuOptions | undefined,
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedId: string | null = null;
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(selectedId);
    };

    const menu = Menu.buildFromTemplate(
      buildNativeContextMenuTemplate(items, (id) => {
        selectedId = id;
      }),
    );

    menu.popup({
      window: window ?? undefined,
      x: typeof options?.x === "number" ? Math.round(options.x) : undefined,
      y: typeof options?.y === "number" ? Math.round(options.y) : undefined,
      positioningItem: options?.positioningItem,
      callback: finish,
    });
  });
}

let browserSidebarEventBridgeRegistered = false;

const omitProjectScope = <Request extends { readonly projectId: string }>(
  request: Request,
): Omit<Request, "projectId"> => {
  const { projectId, ...unscoped } = request;
  void projectId;
  return unscoped;
};

const omitRelocationLeaseProjectScope = (
  request: ProjectScopedDocumentRelocationLeaseResponseRequest,
): DocumentRelocationLeaseResponseRequest => {
  const boundary = {
    leaseId: request.leaseId,
    documentId: request.documentId,
    clientSessionId: request.clientSessionId,
    storeEpoch: request.storeEpoch,
    generation: request.generation,
    headSeq: request.headSeq,
  };
  if (request.response === "ack") {
    return { ...boundary, response: "ack" };
  }
  return {
    ...boundary,
    response: "nack",
    reason: request.reason,
    message: request.message,
  };
};

function ensureBrowserSidebarEventBridge(): void {
  if (browserSidebarEventBridgeRegistered) return;
  browserSidebarEventBridgeRegistered = true;
  browserSidebarService.on("state", (snapshot) =>
    broadcastBrowserSidebarEvent("state", snapshot),
  );
  browserSidebarService.on("localServers", (snapshot) =>
    broadcastBrowserSidebarEvent("localServers", snapshot),
  );
  browserSidebarService.on("browserUseState", (snapshot) => {
    refreshRemoteHostedPipState(snapshot);
    broadcastBrowserSidebarEvent("browserUseState", snapshot);
  });
  browserSidebarService.on("browserUseViewport", (event) =>
    broadcastBrowserSidebarEvent("browserUseViewport", event),
  );
  browserSidebarService.on("browserUseCaptureSurface", (event) =>
    broadcastBrowserSidebarEvent("browserUseCaptureSurface", event),
  );
  browserSidebarService.on("browserUseCursor", (event) =>
    broadcastBrowserSidebarEvent("browserUseCursor", event),
  );
  browserSidebarService.on("pageReleased", (event) =>
    broadcastBrowserSidebarEvent("pageReleased", event),
  );
  browserSidebarService.on("webviewAttached", (event) =>
    broadcastBrowserSidebarEvent("webviewAttached", event),
  );
  browserSidebarService.on("destroyWebview", (event) =>
    broadcastBrowserSidebarEvent("destroyWebview", event),
  );
  refreshRemoteHostedPipState(browserSidebarService.getBrowserUseStateSnapshot());
}

function broadcastCommandKeymapState(state: CommandKeymapState): void {
  safeBroadcastToWindows(
    BrowserWindow.getAllWindows(),
    COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
    [state],
  );
}

function refreshBrowserSidebarCommandAccelerators(): void {
  // Browser sidebar shortcut registration is renderer-owned in Nodex today.
}

interface RegisterIpcHandlersOptions {
  documentSyncHub?: DocumentSyncHub;
  onCreateWindow?: (seed?: WindowSessionSeed) => void;
  onBootstrapWindowSession?: (webContentsId: number) => WindowSessionBootstrap;
  onSaveWindowSessionLayout?: (
    webContentsId: number,
    layout: WorkbenchLayoutSnapshot,
  ) => WindowSessionBootstrap;
  onUpdateWindowSessionBounds?: (
    webContentsId: number,
    bounds: WindowSessionBounds,
  ) => void;
  desktopNotificationManager?: DesktopNotificationManager;
  onGetAppUpdateStatus?: () => AppUpdateStatus;
  onCheckForAppUpdate?: () => Promise<AppUpdateStatus>;
  onInstallAppUpdate?: () => boolean;
  onAppUpdateSettingsChanged?: (settings: AppUpdateSettings) => void;
  onCommandKeybindingsChanged?: (state: CommandKeymapState) => void;
  rendererClientRouter?: RendererClientRouter;
  onHeartbeatAutomationsEnabledChanged?: (
    input: CodexHeartbeatAutomationsEnabledChangedInput,
  ) => void;
  onHeartbeatAutomationThreadStateChanged?: (
    input: CodexHeartbeatAutomationThreadStateChangedInput,
    rendererClientId: string | null,
  ) => void;
  libraryModule?: Pick<
    DesktopLibraryModuleBridge,
    | "apply"
    | "read"
    | "readProjectPageDetail"
    | "readLibraryPageDetail"
    | "listPageHistory"
    | "searchPages"
    | "resolvePageTarget"
    | "resolvePageOwnershipPath"
    | "readPageLifecyclePreflight"
  >;
  databaseModule?: Pick<
    DesktopDatabaseModuleBridge,
    | "read"
    | "apply"
    | "readLibrary"
    | "applyLibrary"
    | "getBoardSummary"
    | "getDatabaseRowsDetails"
    | "getDatabaseRowPage"
    | "resolveDatabaseViewReference"
  >;
  automationModule?: DesktopAutomationModulePort;
  storeAdministration?: DesktopStoreAdministrationPort;
  onBackupSettingsChanged?: (settings: ReturnType<typeof getBackupSettings>) => void;
  onStoreRestored?: () => void;
  projectWorkspace?: DesktopProjectWorkspacePort;
  documentSync?: DesktopDocumentSyncPort;
}

function assertValidOccurrenceIpcInput(
  input: PageOccurrenceActionInput,
): void {
  if (
    typeof input?.operationId !== "string" ||
    input.operationId.length === 0 ||
    input.operationId.length > 512 ||
    input.operationId !== input.operationId.trim()
  ) {
    throw new Error("Missing or invalid occurrence operationId");
  }
  if (typeof input.pageId !== "string" || input.pageId.length === 0) {
    throw new Error("Missing or invalid occurrence pageId");
  }
  if (
    !(input.occurrenceStart instanceof Date) ||
    !Number.isFinite(input.occurrenceStart.getTime())
  ) {
    throw new Error("Missing or invalid occurrenceStart");
  }
  if (
    input.source !== "calendar" &&
    input.source !== "page-detail" &&
    input.source !== "notification" &&
    input.source !== "api"
  ) {
    throw new Error("Missing or invalid occurrence source");
  }
}

function assertValidOccurrenceCompleteIpcInput(
  input: PageOccurrenceCompleteInput,
): void {
  assertValidOccurrenceIpcInput(input);
  if (
    typeof input.createdPageId !== "string" ||
    input.createdPageId.length === 0 ||
    input.createdPageId !== input.createdPageId.trim()
  ) {
    throw new Error("Missing or invalid occurrence createdPageId");
  }
}

function assertValidOccurrenceUpdateIpcInput(
  input: PageOccurrenceUpdateInput,
): void {
  assertValidOccurrenceIpcInput(input);
  if (
    input.scope !== "this" &&
    input.scope !== "this-and-future" &&
    input.scope !== "all"
  ) {
    throw new Error("Missing or invalid occurrence scope");
  }
  if (input.scope === "all" && "createdPageId" in input) {
    throw new Error("Occurrence scope all must not include createdPageId");
  }
  if (
    input.scope !== "all" &&
    (typeof input.createdPageId !== "string" ||
      input.createdPageId.length === 0 ||
      input.createdPageId !== input.createdPageId.trim())
  ) {
    throw new Error("Missing or invalid occurrence createdPageId");
  }
  if (
    typeof input.updates !== "object" ||
    input.updates === null ||
    Array.isArray(input.updates)
  ) {
    throw new Error("Missing or invalid occurrence updates");
  }
}

export function registerIpcHandlers(
  options: RegisterIpcHandlersOptions = {},
): void {
  const documentSyncHub = options.documentSyncHub ?? defaultDocumentSyncHub;
  const storeAdministration = options.storeAdministration
    ?? createTypeScriptStoreAdministrationPort();
  const automationModule = options.automationModule
    ?? createTypeScriptAutomationModulePort();
  const projectWorkspace: DesktopProjectWorkspacePort =
    options.projectWorkspace ?? {
      listProjects: async () => projectsStore.listProjects(),
      getProject: async (projectId) => projectsStore.getProject(projectId),
      createProject: async (input) => projectsStore.createProject(input),
      updateProject: async (projectId, input) =>
        projectsStore.updateProject(projectId, input),
      reorderProjects: async (input) => projectsStore.reorderProjects(input),
      setProjectPinned: async (projectId, input) =>
        projectsStore.setProjectPinned(projectId, input),
      setPinnedProjectOrder: async (input) =>
        projectsStore.setPinnedProjectOrder(input),
      deleteProject: async (projectId) =>
        await projectDeletionRuntime.deleteProject(projectId),
      listProjectSessions: async (projectId, listOptions) =>
        projectSessionService.listProjectSessions(projectId, listOptions),
      listProjectSessionSummaries: async (projectId, listOptions) =>
        projectSessionService.listProjectSessionSummaries(
          projectId,
          listOptions,
        ),
      getProjectSession: async (sessionId) =>
        projectSessionService.getProjectSession(sessionId),
      updateProjectSession: async (sessionId, input) =>
        projectSessionService.updateProjectSession(sessionId, input),
      renameProjectSession: async (sessionId, input) => {
        const existing = projectSessionService.getProjectSession(sessionId);
        if (!existing || existing.thread) return existing;
        return projectSessionService.updateProjectSession(sessionId, {
          noThreadFallbackTitle: input.title,
        });
      },
      createProjectSession: async (input) =>
        projectSessionService.createProjectSession(input),
      deleteProjectSession: async (sessionId) =>
        projectSessionService.deleteProjectSession(sessionId),
      reorderProjectSessions: async (projectId, orderedSessionIds) =>
        projectSessionService.reorderProjectSessions(
          projectId,
          orderedSessionIds,
        ),
      setProjectSessionPinned: async (sessionId, input) =>
        projectSessionService.setProjectSessionPinned(sessionId, input),
      setPinnedProjectSessionOrder: async (projectId, input) =>
        projectSessionService.setPinnedProjectSessionOrder(projectId, input),
      archiveProjectSession: async (sessionId) =>
        projectSessionService.archiveProjectSession(sessionId),
      unarchiveProjectSession: async (sessionId) =>
        projectSessionService.unarchiveProjectSession(sessionId),
      markProjectSessionUnread: async (sessionId, input) =>
        projectSessionService.markProjectSessionUnread(sessionId, input),
      createProjectSessionTab: async (input) =>
        projectSessionService.createProjectSessionTab(input),
      splitProjectSessionPanelGroup: async (input) =>
        projectSessionService.splitProjectSessionPanelGroup(input),
      ensureProjectSessionPanelLeafToRight: async (input) =>
        projectSessionService.ensureProjectSessionPanelLeafToRight(input),
      mergeProjectSessionPanelGroup: async (input) =>
        projectSessionService.mergeProjectSessionPanelGroup(input),
      activateProjectSessionPanelGroup: async (input) =>
        projectSessionService.activateProjectSessionPanelGroup(input),
      resizeProjectSessionPanelGroup: async (input) =>
        projectSessionService.resizeProjectSessionPanelGroup(input),
      maximizeProjectSessionPanelGroup: async (input) =>
        projectSessionService.maximizeProjectSessionPanelGroup(input),
      reorderProjectSessionTabs: async (input) =>
        projectSessionService.reorderProjectSessionTabs(input),
      getProjectSessionTab: async (tabId) =>
        projectSessionService.getProjectSessionTab(tabId),
      updateProjectSessionTab: async (tabId, input) =>
        projectSessionService.updateProjectSessionTab(tabId, input),
      updateProjectSessionTabState: async (tabId, stateKey, state) =>
        projectSessionService.updateProjectSessionTabState(
          tabId,
          stateKey,
          state,
        ),
      updateProjectSessionPanel: async (sessionId, panelId, input) =>
        projectSessionService.updateProjectSessionPanel(
          sessionId,
          panelId,
          input,
        ),
      deleteProjectSessionTab: async (input) =>
        projectSessionService.deleteProjectSessionTab(input),
      moveProjectSessionTab: async (input) =>
        projectSessionService.moveProjectSessionTab(input),
      upsertProjectSessionThreadLink: async (input) =>
        projectSessionService.upsertProjectSessionThreadLink(input),
      detachProjectSessionThread: async (sessionId) =>
        projectSessionService.detachProjectSessionThread(sessionId),
    };
  resolveRemoteHostedPipThreadId = async (sessionId) =>
    (await projectWorkspace.getProjectSession(sessionId))?.thread?.threadId ?? null;
  ensureBrowserSidebarEventBridge();

  const gitBranchWatches = new Map<
    number,
    { cwd: string; dispose: () => void }
  >();
  const gitBranchWatchCleanupBound = new Set<number>();
  const gitReviewWatches = new Map<string, GitReviewLiveSubscription>();
  const gitReviewWatchCleanupBound = new Set<number>();

  const focusNotificationOriginWindow = (
    window: BrowserWindow | null,
  ): void => {
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  };

  const stopGitBranchWatch = (webContentsId: number) => {
    const activeWatch = gitBranchWatches.get(webContentsId);
    if (!activeWatch) return;
    activeWatch.dispose();
    gitBranchWatches.delete(webContentsId);
  };

  const stopGitReviewWatch = (
    webContentsId: number,
    subscriptionId: string,
  ) => {
    const key = `${webContentsId}:${subscriptionId}`;
    gitReviewWatches.get(key)?.dispose();
    gitReviewWatches.delete(key);
  };

  const stopAllGitReviewWatches = (webContentsId: number) => {
    const prefix = `${webContentsId}:`;
    for (const [key, subscription] of gitReviewWatches) {
      if (!key.startsWith(prefix)) continue;
      subscription.dispose();
      gitReviewWatches.delete(key);
    }
  };

  const resolveRendererClientId = (event: IpcMainInvokeEvent): string | null =>
    options.rendererClientRouter?.ensureClient(
      event.sender as RendererClientWebContents,
    ).clientId ?? null;

  const resolveDocumentSyncTarget = (
    event: IpcMainInvokeEvent,
  ): DocumentSyncClientTarget | null => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.sender.getType() !== "window") {
      return null;
    }
    if (event.senderFrame !== event.sender.mainFrame) {
      return null;
    }
    return event.sender;
  };

  const createGitCommitMessageGenerator =
    (hostId: string | undefined) =>
    async ({
      cwd,
      prompt,
      signal,
    }: {
      cwd: string;
      prompt: string;
      signal?: AbortSignal;
    }) => {
      if (signal?.aborted) return null;
      const message = await codexService.generateCommitMessage({
        hostId,
        prompt,
        cwd,
      });
      return signal?.aborted ? null : message;
    };

  const createGitPullRequestMessageGenerator =
    (hostId: string | undefined) =>
    async ({
      cwd,
      prompt,
      signal,
    }: {
      cwd: string;
      prompt: string;
      signal?: AbortSignal;
    }) => {
      if (signal?.aborted) return null;
      const message = await codexService.generatePullRequestMessage({
        hostId,
        prompt,
        cwd,
      });
      return signal?.aborted ? null : message;
    };

  const broadcastRendererClientMessage = (
    channel: string,
    args: readonly unknown[],
    optionsOverride?: {
      sourceClientId?: string | null;
      includeSource?: boolean;
    },
  ) => {
    if (options.rendererClientRouter) {
      return options.rendererClientRouter.broadcast(
        channel,
        args,
        optionsOverride,
      );
    }

    return safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, args);
  };

  codexService.on("event", (event) => {
    broadcastRendererClientMessage("codex:event", [event]);
    if (event.type === "scheduledAutomationChanged") {
      safeBroadcastToWindows(
        BrowserWindow.getAllWindows(),
        "codex:scheduled-automations:changed",
        [event.event],
      );
    }
    if (event.type === "automationRunsUpdated") {
      broadcastIpcEvent("codex:automation-runs:updated", event.event);
    }
  });
  codexService.on("hostMessage", (message) => {
    broadcastCodexHostMessageToRendererClients(
      options.rendererClientRouter,
      (channel, args) =>
        safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, args),
      message,
    );
  });
  codexService.on(
    "rendererOwnerHostMessage",
    (event: { targetClientId: string; message: unknown }) => {
      sendRendererOwnerHostMessage(options.rendererClientRouter, event);
    },
  );
  codexService.on("threadSearchIndexUpdated", (event) => {
    safeBroadcastToWindows(
      BrowserWindow.getAllWindows(),
      "codex:threads:palette:index-updated",
      [event],
    );
  });

  registerCodexPendingWorktreeIpcHandlers({
    registerHandle,
    service: codexService as unknown as CodexPendingWorktreeIpcService,
    subscribePendingWorktreesChanged: (listener) => {
      codexService.on("pendingWorktreesChanged", listener);
    },
    broadcastPendingWorktreesChanged: (entries) => {
      broadcastIpcEvent("codex:pending-worktrees:changed", entries);
    },
  });
  codexService.on("pendingWorktreeWarning", (event) => {
    broadcastIpcEvent("codex:pending-worktree:warning", event);
  });
  registerHandle(
    "codex:pending-worktree:discard-fork-side-panel-transfer",
    (_, pendingWorktreeId) => {
      if (!pendingWorktreeId.trim()) throw new Error("Pending worktree id is required");
      codexService.discardPendingForkSidePanelTransfer(pendingWorktreeId);
    },
  );
  registerHandle("codex:fork-side-panel-transfer:consume", async (_, input) => {
    const consumed = codexService.consumeForkSidePanelTransfer(input);
    if (!consumed) return false;
    const session = await projectWorkspace.getProjectSession(
      input.targetProjectSessionId,
    );
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "update",
        session.id,
      );
    }
    return true;
  });

  registerHandle("diagnostics:renderer-log", (_, input) => {
    if (process.env.NODEX_ASSISTANT_STREAMING_DEBUG !== "1") {
      return;
    }
    rendererDiagnosticsLogger.info(input.message, input.fields);
  });
  registerHandle("codex-desktop:message-from-view", (event, message) => {
    remoteHostedPipService.handleDesktopMessageFromView(event.sender, message);
  });

  registerHandle("codex:renderer-client:id", (event) =>
    resolveRendererClientId(event),
  );
  registerHandle(
    "codex:renderer-client:response",
    (event, response) =>
      options.rendererClientRouter?.handleResponse(
        event.sender as RendererClientWebContents,
        response,
      ) ?? false,
  );
  options.rendererClientRouter?.addClientDisposedListener((event) => {
    codexService.handleRendererClientDisposed(event.clientId);
  });
  registerHandle("codex:thread-owner:stream-state:publish", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return publishRendererThreadOwnerStreamState(
      codexService,
      sourceClientId,
      input,
    );
  });
  registerHandle("codex:thread-owner:notification:ack", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return ackRendererThreadOwnerNotification(
      codexService,
      sourceClientId,
      input,
    );
  });
  registerHandle("codex:thread-owner:pending-requests:replay", (event, threadId) => {
    const sourceClientId = resolveRendererClientId(event);
    return codexService.replayRendererOwnerPendingRequests(threadId, sourceClientId);
  });
  registerHandle(
    "codex:thread-owner:app-server-request",
    async (event, input) => {
      const sourceClientId = resolveRendererClientId(event);
      return await codexService.handleRendererOwnerAppServerRequest(
        sourceClientId,
        input,
      );
    },
  );
  registerHandle("codex:thread-follower:action", async (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return await runThreadFollowerActionThroughOwner(
      codexService,
      options.rendererClientRouter,
      sourceClientId,
      input,
    );
  });
  registerHandle("codex:dynamic-tool-call:respond", (
    _,
    conversationId: string,
    requestId: CodexProtocolRequestId,
    context,
  ) =>
    codexService.respondToDynamicToolCall(requestId, conversationId, context),
  );

  registerHandle("document-sync:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.subscribe(
        { kind: "project", projectId: request.projectId },
        target,
        omitProjectScope(request),
      );
    }
    const authorization = await blockMutationWriter.authorizeDocumentAccess({
      projectId: request.projectId,
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.subscribe(target, omitProjectScope(request));
  });
  registerHandle("page-target:resolve", (_, input) =>
    options.libraryModule?.resolvePageTarget(input)
      ?? resolveProjectScopedPageTarget(input),
  );
  registerHandle("page-ownership-path:resolve", (_, input) =>
    options.libraryModule?.resolvePageOwnershipPath(input)
      ?? resolveProjectScopedPageOwnershipPath(input),
  );
  registerHandle("database-view:reference:get", (_, input) =>
    options.databaseModule?.resolveDatabaseViewReference(input)
      ?? readProjectScopedDatabaseViewReference(input),
  );
  registerHandle(
    "block-document:owned:get",
    async (_, projectId, ownerBlockId) => {
      if (options.documentSync) {
        return await options.documentSync.getOwnedDocumentDescriptor(
          projectId,
          ownerBlockId,
        );
      }
      return (
        await blockMutationWriter.getOwnedDocumentDescriptor(
          projectId,
          ownerBlockId,
        )
      ).result;
    },
  );
  registerHandle(
    "block-document:owned:prepare",
    async (_, projectId, ownerBlockId) => {
      if (options.documentSync) {
        return await options.documentSync.prepareOwnedBlockDocument(
          projectId,
          ownerBlockId,
        );
      }
      return await blockMutationWriter.prepareOwnedBlockDocument(
        projectId,
        ownerBlockId,
      );
    },
  );
  registerHandle(
    "library-block-document:owned:prepare",
    async (_, ownerBlockId) => {
      if (options.documentSync) {
        return await options.documentSync.prepareLibraryOwnedBlockDocument(
          ownerBlockId,
        );
      }
      return await blockMutationWriter.prepareLibraryOwnedBlockDocument(
        ownerBlockId,
      );
    },
  );
  registerHandle("document-sync:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.unsubscribe(
        { kind: "project", projectId: request.projectId },
        target,
        omitProjectScope(request),
      );
    }
    return documentSyncHub.unsubscribe(target, omitProjectScope(request));
  });
  registerHandle("document-sync:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.sync(
        { kind: "project", projectId: request.projectId },
        target,
        omitProjectScope(request),
      );
    }
    const authorization = await blockMutationWriter.authorizeDocumentAccess({
      projectId: request.projectId,
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.sync(target, omitProjectScope(request));
  });
  registerHandle("document-sync:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.applyUpdate(
        { kind: "project", projectId: request.projectId },
        target,
        omitProjectScope(request),
      );
    }
    const authorization = await blockMutationWriter.authorizeDocumentAccess({
      projectId: request.projectId,
      documentId: request.documentId,
      access: "write",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.applyUpdate(target, omitProjectScope(request));
  });
  registerHandle("canvas-scene:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "project_scope_mismatch" as const,
          message: "Canvas scene subscription is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    if (options.documentSync) {
      return await options.documentSync.subscribeCanvasScene(target, request);
    }
    return documentSyncHub.subscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "project_scope_mismatch" as const,
          message: "Canvas scene subscription is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    if (options.documentSync) {
      return await options.documentSync.unsubscribeCanvasScene(target, request);
    }
    return documentSyncHub.unsubscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "project_scope_mismatch" as const,
          message: "Canvas scene sync is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    if (options.documentSync) {
      return await options.documentSync.syncCanvasScene(target, request);
    }
    return documentSyncHub.syncCanvasScene(target, request);
  });
  registerHandle("canvas-scene:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "project_scope_mismatch" as const,
          message: "Canvas scene mutation is unauthorized",
          retryable: false,
          resetRequired: false,
          mutationId: request.mutationId,
        },
      };
    }
    if (options.documentSync) {
      return await options.documentSync.applyCanvasSceneMutation(
        target,
        request,
      );
    }
    return documentSyncHub.applyCanvasSceneMutation(target, request);
  });
  registerHandle("document-sync:awareness:publish", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.publishAwareness(
        { kind: "project", projectId: request.projectId },
        target,
        omitProjectScope(request),
      );
    }
    const authorization = await blockMutationWriter.authorizeDocumentAccess({
      projectId: request.projectId,
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.publishAwareness(
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("document-sync:relocation-lease:respond", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    if (options.documentSync) {
      return await options.documentSync.respondToRelocationLease(
        { kind: "project", projectId: request.projectId },
        target,
        omitRelocationLeaseProjectScope(request),
      );
    }
    const authorization = await blockMutationWriter.authorizeDocumentAccess({
      projectId: request.projectId,
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.respondToRelocationLease(
      target,
      omitRelocationLeaseProjectScope(request),
    );
  });
  registerHandle("library-document-sync:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    if (options.documentSync) {
      return await options.documentSync.subscribe(
        { kind: "library" },
        target,
        request,
      );
    }
    const authorization = await blockMutationWriter.authorizeLibraryDocumentAccess({
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.subscribe(target, request);
  });
  registerHandle("library-document-sync:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    if (options.documentSync) {
      return await options.documentSync.unsubscribe(
        { kind: "library" },
        target,
        request,
      );
    }
    return documentSyncHub.unsubscribe(target, request);
  });
  registerHandle("library-document-sync:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    if (options.documentSync) {
      return await options.documentSync.sync(
        { kind: "library" },
        target,
        request,
      );
    }
    const authorization = await blockMutationWriter.authorizeLibraryDocumentAccess({
      documentId: request.documentId,
      access: "read",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.sync(target, request);
  });
  registerHandle("library-document-sync:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    if (options.documentSync) {
      return await options.documentSync.applyUpdate(
        { kind: "library" },
        target,
        request,
      );
    }
    const authorization = await blockMutationWriter.authorizeLibraryDocumentAccess({
      documentId: request.documentId,
      access: "write",
    });
    if (!authorization.ok) return authorization;
    return documentSyncHub.applyUpdate(target, request);
  });
  registerHandle(
    "library-document-sync:awareness:publish",
    async (event, request) => {
      const target = resolveDocumentSyncTarget(event);
      if (!target) return documentSyncUnauthorized();
      if (options.documentSync) {
        return await options.documentSync.publishAwareness(
          { kind: "library" },
          target,
          request,
        );
      }
      const authorization = await blockMutationWriter.authorizeLibraryDocumentAccess({
        documentId: request.documentId,
        access: "read",
      });
      if (!authorization.ok) return authorization;
      return documentSyncHub.publishAwareness(target, request);
    },
  );
  registerHandle(
    "library-document-sync:relocation-lease:respond",
    async (event, request) => {
      const target = resolveDocumentSyncTarget(event);
      if (!target) return documentSyncUnauthorized();
      if (options.documentSync) {
        return await options.documentSync.respondToRelocationLease(
          { kind: "library" },
          target,
          request,
        );
      }
      const authorization = await blockMutationWriter.authorizeLibraryDocumentAccess({
        documentId: request.documentId,
        access: "read",
      });
      if (!authorization.ok) return authorization;
      return documentSyncHub.respondToRelocationLease(target, request);
    },
  );
  registerBlockPropertyMutationIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) =>
        listener(event, projectId, request),
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: {
          kind: "electron_renderer",
          clientId,
        },
      };
    },
    applyMutation: async (request) =>
      (await blockMutationWriter.applyBlockPropertyMutation(request)).result,
  });
  registerLibraryBlockPropertyMutationIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) => listener(event, request));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyMutation: async (input) =>
      (await blockMutationWriter.applyLibraryBlockPropertyMutation(input)).result,
  });

  registerDatabaseModuleIpcHandlers({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) =>
        listener(event, projectId, request) as
          | IpcApi[typeof channel]["result"]
          | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        actor: { kind: "electron_renderer", clientId },
      };
    },
    apply: options.databaseModule?.apply ?? (async (request) =>
      (await blockMutationWriter.applyDatabaseModule(request)).result),
    read: options.databaseModule?.read ?? (async (request) =>
      (await blockMutationWriter.readDatabaseModule(request)).result),
  });

  registerLibraryModuleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) =>
        listener(event, request) as
          | IpcApi[typeof channel]["result"]
          | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: options.libraryModule?.read ?? (async (request) =>
      (await blockMutationWriter.readLibraryModule(request)).result),
    apply: options.libraryModule?.apply ?? (async (request) =>
      (await blockMutationWriter.applyLibraryModule(request)).result),
  });

  registerLibraryDatabaseModuleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) =>
        listener(event, request) as
          | IpcApi[typeof channel]["result"]
          | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: options.databaseModule?.readLibrary ?? ((request) =>
      blockMutationWriter.readLibraryDatabaseModule(request, "app_window")),
    apply: options.databaseModule?.applyLibrary ?? ((request) =>
      blockMutationWriter.applyLibraryDatabaseModule(
        request,
        { kind: "electron_renderer" },
        "app_window",
      )),
  });

  registerPageDetailIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, pageId) =>
        listener(event, projectId, pageId),
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: options.libraryModule?.readProjectPageDetail ??
      (async (projectId, pageId) =>
        (await blockMutationWriter.readPageDetail(projectId, pageId)).result),
  });

  registerLibraryPageDetailIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, pageId) => listener(event, pageId));
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: options.libraryModule?.readLibraryPageDetail ??
      (async (pageId) =>
        (
          await blockMutationWriter.readLibraryPageDetail(
            pageId,
            "app_window",
          )
        ).result),
  });

  registerPageLifecyclePreflightIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, pageId) =>
        listener(event, projectId, pageId),
      );
    },
    readPreflight: options.libraryModule?.readPageLifecyclePreflight ??
      (async (projectId, pageId) =>
        (
          await blockMutationWriter.readPageLifecyclePreflight(
            projectId,
            pageId,
          )
        ).result),
  });

  registerPageLifecycleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) =>
        listener(event, projectId, request),
      );
    },
    getTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyMutation: async (request) =>
      (await blockMutationWriter.applyPageLifecycleMutation(request)).result,
  });

  registerDocumentMutationIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, documentId, request) =>
        listener(event, projectId, documentId, request),
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: {
          kind: "electron_renderer",
          clientId,
        },
      };
    },
    applyMutation: (request) =>
      options.documentSync?.applyDocumentMutation(request) ??
      documentSyncHub.applyDocumentMutation(request),
  });

  registerAdditionalDocumentCommandIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) =>
        listener(event, projectId, request),
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyCommand: (request) =>
      options.documentSync
        ? options.documentSync.applyAdditionalDocumentCommand(request)
        : documentSyncHub.applyAdditionalDocumentCommand(request),
  });

  registerBlockTransferIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, intent) =>
        listener(event, projectId, intent),
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    transfer: (intent) => options.documentSync
      ? options.documentSync.transferBlocks(intent)
      : documentSyncHub.transferBlocks(intent),
  });

  registerDocumentHistoryIpcHandlers({
    registerHandle: (channel, listener) => {
      if (channel === "block-documents:history:checkpoint") {
        registerHandle(channel, (event, projectId, documentId, request) =>
          listener(event, projectId, documentId, request) as
            | IpcApi["block-documents:history:checkpoint"]["result"]
            | Promise<IpcApi["block-documents:history:checkpoint"]["result"]>,
        );
        return;
      }
      if (channel === "block-documents:history:list") {
        registerHandle(
          channel,
          (event, request) =>
            listener(event, request) as
              | IpcApi["block-documents:history:list"]["result"]
              | Promise<IpcApi["block-documents:history:list"]["result"]>,
        );
        return;
      }
      if (channel === "block-documents:history:get") {
        registerHandle(
          channel,
          (event, request) =>
            listener(event, request) as
              | IpcApi["block-documents:history:get"]["result"]
              | Promise<IpcApi["block-documents:history:get"]["result"]>,
        );
        return;
      }
      registerHandle(channel, (event, projectId, documentId, request) =>
        listener(event, projectId, documentId, request) as
          | IpcApi["block-documents:history:restore"]["result"]
          | Promise<IpcApi["block-documents:history:restore"]["result"]>,
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId =
        resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    createCheckpoint: (request) =>
      options.documentSync?.createCheckpoint(request) ??
      blockMutationWriter.createDocumentVersionCheckpoint(request),
    listVersions: (request) =>
      options.documentSync?.listVersions(request) ??
      blockMutationWriter.listDocumentVersions(request),
    getVersion: (request) =>
      options.documentSync?.getVersion(request) ??
      blockMutationWriter.getDocumentVersion(request),
    restoreVersion: (request) =>
      options.documentSync?.restoreVersion(request) ??
      documentSyncHub.applyDocumentMutation(request),
  });

  registerPageHistoryIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) => listener(event, request));
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    listHistory: options.libraryModule?.listPageHistory ??
      ((request) => blockMutationWriter.listPageHistory(request)),
  });

  registerPersistedAtomIpc({
    registerSync: (listener) => {
      registerHandle("persisted-atom:sync-request", listener);
    },
    registerMutation: (listener) => {
      registerHandle("persisted-atom:update", (event, mutation) =>
        listener(String(event.sender.id), mutation));
    },
    broadcast: (persistedEvent) => {
      safeBroadcastToWindows(
        BrowserWindow.getAllWindows(),
        "persisted-atom:updated",
        [persistedEvent],
      );
    },
  });

  // Projects
  registerHandle("projects:list", async () =>
    await projectWorkspace.listProjects(),
  );

  registerHandle("projects:get", async (_, projectId: string) =>
    await projectWorkspace.getProject(projectId),
  );

  registerHandle("projects:create", async (_, input) =>
    await projectWorkspace.createProject(input),
  );

  registerHandle("projects:update", async (_, projectId: string, updates) =>
    await projectWorkspace.updateProject(projectId, updates),
  );

  registerHandle("projects:reorder", async (_, input) =>
    await projectWorkspace.reorderProjects(input),
  );

  registerHandle("projects:set-pinned", async (_, projectId: string, input) =>
    await projectWorkspace.setProjectPinned(projectId, input),
  );

  registerHandle("projects:set-pinned-order", async (_, input) =>
    await projectWorkspace.setPinnedProjectOrder(input),
  );

  registerHandle("projects:pick-source-root", async (event) => {
    return showDirectoryPicker(event, {
      title: "Choose source folder",
      properties: ["openDirectory", "createDirectory"],
    });
  });

  registerHandle("workspace:pick-directory", async (event, input) => {
    return showDirectoryPicker(event, {
      title: typeof input?.title === "string" ? input.title : "Choose folder",
      properties:
        input?.createDirectory === true
          ? ["openDirectory", "createDirectory"]
          : ["openDirectory"],
    });
  });

  registerHandle("projects:delete", async (_, projectId: string) =>
    await deleteProjectWithBrowserCleanupUsing({
      projectId,
      browserRuntime: browserSidebarService,
      deleteProject: projectWorkspace.deleteProject,
      getProject: projectWorkspace.getProject,
      listProjectSessions: async (targetProjectId) =>
        await projectWorkspace.listProjectSessions(targetProjectId, {
          includeArchived: true,
        }),
    }),
  );

  // Project sessions
  registerHandle(
    "project-sessions:list",
    async (_, projectId: string | null, options) => {
      const startedAt = getDevRuntimeMetricStart();
      const sessions = await projectWorkspace.listProjectSessions(
        projectId,
        options,
      );
      const approxPayloadBytes = approximateJsonPayloadBytes(sessions);
      logDevRuntimeMetric("ipc.project_sessions_list", {
        projectId,
        includeArchived: options?.includeArchived === true,
        sessionCount: sessions.length,
        tabCount: sessions.reduce(
          (sum, session) => sum + session.tabs.length,
          0,
        ),
        linkedThreadCount: sessions.filter((session) => session.thread !== null)
          .length,
        approxPayloadBytes,
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      recordDevRuntimeMetricCounter(
        "ipc.project_sessions_list.burst_window",
        {
          projectId,
          includeArchived: options?.includeArchived === true,
          approxPayloadBytes,
        },
        {
          groupBy: ["projectId", "includeArchived"],
          windowMs: 1_000,
          burstThreshold: 5,
          burstMetric: "ipc.project_sessions_list.burst",
        },
      );
      return sessions;
    },
  );

  registerHandle(
    "project-sessions:list-summaries",
    async (_, projectId: string | null, options) => {
      const startedAt = getDevRuntimeMetricStart();
      const sessions = await projectWorkspace.listProjectSessionSummaries(
        projectId,
        options,
      );
      const approxPayloadBytes = approximateJsonPayloadBytes(sessions);
      logDevRuntimeMetric("ipc.project_sessions_list_summaries", {
        projectId,
        includeArchived: options?.includeArchived === true,
        sessionCount: sessions.length,
        linkedThreadCount: sessions.filter((session) => session.thread !== null)
          .length,
        approxPayloadBytes,
        durationMs: getDevRuntimeMetricDurationMs(startedAt),
      });
      recordDevRuntimeMetricCounter(
        "ipc.project_sessions_list_summaries.burst_window",
        {
          projectId,
          includeArchived: options?.includeArchived === true,
          approxPayloadBytes,
        },
        {
          groupBy: ["projectId", "includeArchived"],
          windowMs: 1_000,
          burstThreshold: 10,
          burstMetric: "ipc.project_sessions_list_summaries.burst",
        },
      );
      return sessions;
    },
  );

  registerHandle("project-sessions:get", async (_, sessionId: string) => {
    const startedAt = getDevRuntimeMetricStart();
    const session = await projectWorkspace.getProjectSession(sessionId);
    logDevRuntimeMetric("ipc.project_sessions_get", {
      sessionId,
      found: session !== null,
      tabCount: session?.tabs.length ?? 0,
      approxPayloadBytes: approximateJsonPayloadBytes(session),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return session;
  });

  registerHandle("project-sessions:create", async (_, input) => {
    const session = await projectWorkspace.createProjectSession(input);
    dbNotifier.notifyProjectSessionsChanged(
      session.projectId,
      "create",
      session.id,
    );
    return session;
  });

  registerHandle("project-sessions:update", async (_, sessionId: string, input) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    if (!existing) return null;
    const session = await projectWorkspace.updateProjectSession(
      sessionId,
      input,
    );
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "update",
        session.id,
      );
    }
    return session;
  });

  registerHandle("project-sessions:rename", (_, sessionId: string, input) =>
    renameProjectSessionChat(sessionId, input, {
      getProjectSession: projectWorkspace.getProjectSession,
      renameProjectSession: projectWorkspace.renameProjectSession,
      setThreadName: (threadId, rawTitle) =>
        codexService.setThreadName(threadId, rawTitle),
      notifyProjectSessionsChanged: (projectId, changeType, sessionId) => {
        dbNotifier.notifyProjectSessionsChanged(
          projectId,
          changeType,
          sessionId,
        );
      },
    }),
  );

  registerHandle("project-sessions:delete", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    const success = await deleteProjectSessionWithBrowserCleanupUsing({
      sessionId,
      browserRuntime: browserSidebarService,
      getProjectSession: projectWorkspace.getProjectSession,
      deleteProjectSession: projectWorkspace.deleteProjectSession,
    });
    if (success && existing) {
      dbNotifier.notifyProjectSessionsChanged(
        existing.projectId,
        "delete",
        sessionId,
      );
    }
    return success;
  });

  registerHandle(
    "project-sessions:reorder",
    async (_, projectId: string, orderedSessionIds: string[]) => {
      const sessions = await projectWorkspace.reorderProjectSessions(
        projectId,
        orderedSessionIds,
      );
      dbNotifier.notifyProjectSessionsChanged(projectId, "reorder");
      return sessions;
    },
  );

  registerHandle(
    "project-sessions:set-pinned",
    async (_, sessionId: string, input) => {
      const session = await projectWorkspace.setProjectSessionPinned(
        sessionId,
        input,
      );
      if (session) {
        dbNotifier.notifyProjectSessionsChanged(
          session.projectId,
          "pin",
          session.id,
        );
      }
      return session;
    },
  );

  registerHandle(
    "project-sessions:set-pinned-order",
    async (_, projectId: string, input) => {
      const sessions = await projectWorkspace.setPinnedProjectSessionOrder(
        projectId,
        input,
      );
      dbNotifier.notifyProjectSessionsChanged(projectId, "pin");
      return sessions;
    },
  );

  registerHandle("project-sessions:archive", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
    }
    const session = await projectWorkspace.archiveProjectSession(sessionId);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "archive",
        session.id,
      );
    }
    return session;
  });

  registerHandle("project-sessions:unarchive", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
    }
    const session = await projectWorkspace.unarchiveProjectSession(sessionId);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "unarchive",
        session.id,
      );
    }
    return session;
  });

  registerHandle(
    "project-sessions:mark-unread",
    async (_, sessionId: string, input) => {
      const session = await projectWorkspace.markProjectSessionUnread(
        sessionId,
        input,
      );
      if (session) {
        dbNotifier.notifyProjectSessionsChanged(
          session.projectId,
          "unread",
          session.id,
        );
      }
      return session;
    },
  );

  registerHandle(
    "project-sessions:fork",
    async (_, sessionId: string, input) => {
      const result = await codexService.forkProjectSessionThread(
        sessionId,
        input,
      );
      if ("session" in result) {
        dbNotifier.notifyProjectSessionsChanged(
          result.session.projectId,
          "create",
          result.session.id,
        );
      }
      return result;
    },
  );

  registerHandle("project-session-tabs:create", async (_, input) =>
    await projectWorkspace.createProjectSessionTab(input),
  );

  registerHandle("project-session-tabs:update", async (_, tabId: string, input) =>
    await projectWorkspace.updateProjectSessionTab(tabId, input),
  );

  registerHandle(
    "project-session-panels:update",
    async (_, sessionId: string, panelId, input) =>
      await projectWorkspace.updateProjectSessionPanel(
        sessionId,
        panelId,
        input,
      ),
  );

  registerHandle("project-session-panels:split", async (_, input) =>
    await projectWorkspace.splitProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:ensure-right-leaf", async (_, input) =>
    await projectWorkspace.ensureProjectSessionPanelLeafToRight(input),
  );

  registerHandle("project-session-panels:merge", async (_, input) =>
    await projectWorkspace.mergeProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:activate", async (_, input) =>
    await projectWorkspace.activateProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:resize", async (_, input) =>
    await projectWorkspace.resizeProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:maximize", async (_, input) =>
    await projectWorkspace.maximizeProjectSessionPanelGroup(input),
  );

  registerHandle(
    "project-session-tabs:state:update",
    async (_, tabId: string, stateKey: number, state) =>
      await projectWorkspace.updateProjectSessionTabState(
        tabId,
        stateKey,
        state,
      ),
  );

  registerHandle("project-session-tabs:delete", async (_, input) =>
    await deleteProjectSessionTabWithBrowserCleanupUsing({
      input,
      browserRuntime: browserSidebarService,
      getProjectSessionTab: projectWorkspace.getProjectSessionTab,
      deleteProjectSessionTab: projectWorkspace.deleteProjectSessionTab,
      getProjectSession: projectWorkspace.getProjectSession,
    }),
  );

  registerHandle("project-session-tabs:reorder", async (_, input) =>
    await projectWorkspace.reorderProjectSessionTabs(input),
  );

  registerHandle("project-session-tabs:move", async (_, input) =>
    await projectWorkspace.moveProjectSessionTab(input),
  );

  registerHandle("project-session-threads:attach", async (_, input) => {
    const link = await projectWorkspace.upsertProjectSessionThreadLink(input);
    dbNotifier.notifyProjectSessionsChanged(
      link.projectId,
      "link",
      link.sessionId,
    );
    return link;
  });

  registerHandle("project-session-threads:detach", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    const success = await projectWorkspace.detachProjectSessionThread(sessionId);
    if (success && existing) {
      dbNotifier.notifyProjectSessionsChanged(
        existing.projectId,
        "link",
        sessionId,
      );
    }
    return success;
  });

  // Board
  registerHandle("board:summary:get", async (_, projectId: string) => {
    const startedAt = performance.now();
    const board = options.databaseModule
      ? await options.databaseModule.getBoardSummary(projectId)
      : await boardReadModel.getBoardSummary(projectId);
    ipcPayloadLogger.info("board summary payload served", {
      channel: "board:summary:get",
      projectId,
      cardCount: boardCardCount(board),
      approxPayloadBytes: approximateJsonPayloadBytes(board),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return board;
  });

  // Database Pages
  registerHandle("database-rows:details:get", async (_, projectId, input) => {
    const startedAt = performance.now();
    const pages = options.databaseModule
      ? await options.databaseModule.getDatabaseRowsDetails(projectId, input)
      : await boardReadModel.getDatabaseRowsDetails(projectId, input);
    ipcPayloadLogger.info("database row details payload served", {
      channel: "database-rows:details:get",
      projectId,
      requestedPageCount: input.pageIds.length,
      pageCount: pages.length,
      approxPayloadBytes: approximateJsonPayloadBytes(pages),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return pages;
  });

  registerHandle("pages:search", async (_, input) => {
    const startedAt = performance.now();
    const results = options.libraryModule
      ? await options.libraryModule.searchPages(input)
      : await boardReadModel.searchPages(input);
    ipcPayloadLogger.info("page search payload served", {
      channel: "pages:search",
      projectCount: input.projectIds.length,
      resultCount: results.length,
      approxPayloadBytes: approximateJsonPayloadBytes(results),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return results;
  });

  registerHandle(
    "database-row:get",
    (_, projectId: string, pageId: string, status?: string) =>
      options.databaseModule
        ? options.databaseModule.getDatabaseRowPage(
            projectId,
            pageId,
            status as Parameters<typeof pagesStore.getDatabaseRowPage>[2],
          )
        : pagesStore.getDatabaseRowPage(
            projectId,
            pageId,
            status as Parameters<typeof pagesStore.getDatabaseRowPage>[2],
          ),
  );

  registerHandle(
    "calendar:occurrences",
    (
      _,
      projectId: string,
      windowStart: Date,
      windowEnd: Date,
      searchQuery?: string,
    ) =>
      automationModule
        .listPageOccurrences(projectId, windowStart, windowEnd, searchQuery)
        .then((occurrences) => ({ occurrences })),
  );

  registerHandle(
    "page:occurrence:complete",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceCompleteIpcInput(input);
      return await automationModule.completePageOccurrence(
        projectId,
        input,
        sessionId,
      );
    },
  );

  registerHandle(
    "page:occurrence:skip",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceIpcInput(input);
      return await automationModule.skipPageOccurrence(
        projectId,
        input,
        sessionId,
      );
    },
  );

  registerHandle(
    "page:occurrence:update",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceUpdateIpcInput(input);
      return await automationModule.updatePageOccurrence(
        projectId,
        input,
        sessionId,
      );
    },
  );

  // Database introspection
  registerHandle("db:schema", (_event, projectId: string) => {
    void projectId;
    return sqlInspection.getSchema();
  });

  registerHandle(
    "db:query",
    (_, projectId: string, sql: string, params?: unknown[]) => {
      void projectId;
      return sqlInspection.executeReadOnlyQuery(
        sql,
        params as (string | number | null)[] | undefined,
      );
    },
  );

  registerStoreAdministrationIpcHandlers({
    registerHandle,
    administration: storeAdministration,
    onStoreRestored: options.onStoreRestored,
  });

  registerHandle("settings:backup:get", () => getBackupSettings());

  registerHandle("settings:backup:update", (_, input) => {
    const settings = updateBackupSettings(input);
    options.onBackupSettingsChanged?.(settings);
    return settings;
  });

  registerHandle("settings:history:get", () => getHistorySettings());

  registerHandle("settings:history:update", (_, input) =>
    updateHistorySettings(input),
  );

  registerHandle("settings:diagnostics:get", () => getDiagnosticsSettings());

  registerHandle("settings:diagnostics:update", (_, input) =>
    updateDiagnosticsSettings(input),
  );

  registerHandle("settings:telemetry:get", () => getTelemetrySettings());

  registerHandle("settings:telemetry:update", (_, input) =>
    updateTelemetrySettings(input),
  );

  registerHandle("settings:thread-notifications:get", () =>
    getThreadNotificationSettings(),
  );

  registerHandle("settings:thread-notifications:update", (_, input) =>
    updateThreadNotificationSettings(input),
  );

  registerHandle("settings:codex-developer:get", () =>
    getCodexDeveloperInstructionSettings(),
  );

  registerHandle("settings:codex-developer:update", (_, input) =>
    updateCodexDeveloperInstructionSettings(input),
  );

  registerHandle("settings:git:get", () => getCodexGitSettings());

  registerHandle("settings:git:update", (_, input) =>
    updateCodexGitSettings(input),
  );

  registerHandle("desktop-notification:show", (event, notification) => {
    if (!options.desktopNotificationManager) {
      return;
    }

    const originWindow = BrowserWindow.fromWebContents(event.sender);
    options.desktopNotificationManager.showNotification(
      notification,
      event.sender,
      (action) => {
        if (action.actionType === "open") {
          focusNotificationOriginWindow(originWindow);
        }

        safeSendToWebContents(event.sender, "desktop-notification:action", [
          {
            ...action,
            conversationId: notification.conversationId ?? null,
            requestId: notification.requestId ?? null,
            approvalKind: notification.approvalKind ?? null,
          },
        ]);
      },
    );
  });

  registerHandle("desktop-notification:hide", (_, conversationId: string) => {
    options.desktopNotificationManager?.dismissByConversationId(
      conversationId ?? null,
    );
  });

  registerHandle("electron-window:focus:get", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFocused() ?? false;
  });

  registerHandle(
    "native-context-menu:show",
    async (
      event,
      items: NativeContextMenuItem[],
      menuOptions?: NativeContextMenuOptions,
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return await showNativeContextMenu(window, items, menuOptions);
    },
  );

  registerHandle("settings:app-updates:get", () => getAppUpdateSettings());

  registerHandle("settings:app-updates:update", (_, input) => {
    const settings = updateAppUpdateSettings(input);
    options.onAppUpdateSettingsChanged?.(settings);
    return settings;
  });

  registerHandle("settings:window-restore:get", () =>
    getWindowRestoreSettings(),
  );

  registerHandle("settings:window-restore:update", (_, input) =>
    updateWindowRestoreSettings(input),
  );

  registerHandle("codex-command-keymap-state", () => getCommandKeymapState());

  registerHandle("set-codex-command-keybinding", (_, commandId, update) => {
    const state = updateCommandKeybinding(commandId, update);
    refreshBrowserSidebarCommandAccelerators();
    options.onCommandKeybindingsChanged?.(state);
    broadcastCommandKeymapState(state);
    return state;
  });

  registerHandle("reset-codex-command-keybindings", () => {
    const state = resetCommandKeybindings();
    refreshBrowserSidebarCommandAccelerators();
    options.onCommandKeybindingsChanged?.(state);
    broadcastCommandKeymapState(state);
    return state;
  });

  registerHandle("global-dictation-capture-fn-hotkey", () => null);

  registerHandle(
    "app:update:status",
    () =>
      options.onGetAppUpdateStatus?.() ??
      ({
        status: "unsupported",
        supported: false,
        currentVersion: app.getVersion(),
        availableVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
        checkedAt: null,
        message: "App updates are unavailable.",
      } satisfies AppUpdateStatus),
  );

  registerHandle(
    "app:update:check",
    async () =>
      options.onCheckForAppUpdate?.() ??
      ({
        status: "unsupported",
        supported: false,
        currentVersion: app.getVersion(),
        availableVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
        checkedAt: null,
        message: "App updates are unavailable.",
      } satisfies AppUpdateStatus),
  );

  registerHandle(
    "app:update:install",
    () => options.onInstallAppUpdate?.() ?? false,
  );

  registerHandle("shell:open-file-link", (_, target, openerId) =>
    openFileLinkTarget(target, openerId),
  );

  registerHandle("workspace-directory-entries", (event, input) =>
    runWorkspaceFileHandler(event, () => listWorkspaceDirectoryEntries(
      WorkspaceDirectoryEntriesInputSchema.parse(input),
    )),
  );

  registerHandle("read-file", (event, input) =>
    runWorkspaceFileHandler(event, () => readWorkspaceFile(
      WorkspaceFileRequestSchema.parse(input),
    )),
  );

  registerHandle("read-file-metadata", (event, input) =>
    runWorkspaceFileHandler(event, () => readWorkspaceFileMetadata(
      WorkspaceFileMetadataInputSchema.parse(input),
    )),
  );

  registerHandle("read-file-binary", (event, input) =>
    runWorkspaceFileHandler(event, () => readWorkspaceFileBinary(
      WorkspaceFileRequestSchema.parse(input),
    )),
  );

  registerHandle("write-file", (event, input) =>
    runWorkspaceFileHandler(event, () => writeWorkspaceFile(
      WorkspaceFileWriteInputSchema.parse(input),
    )),
  );

  registerHandle("open-file", (_, target, openerId) =>
    openFileLinkTarget(target, openerId),
  );

  registerHandle("window:show-emoji-panel", () => {
    if (process.platform !== "darwin") return false;
    app.showEmojiPanel();
    return true;
  });

  registerHandle("window:new", (_, seed?: WindowSessionSeed) => {
    if (!options.onCreateWindow) return false;
    options.onCreateWindow(seed);
    return true;
  });

  registerHandle("app:feature-gates:get", () => productFeatureGates);

  registerHandle("window-sessions:bootstrap", (event) => {
    if (!options.onBootstrapWindowSession) {
      throw new Error("Window session state is unavailable");
    }
    return options.onBootstrapWindowSession(event.sender.id);
  });

  registerHandle(
    "window-sessions:save-layout",
    (event, layout: WorkbenchLayoutSnapshot) => {
      if (!options.onSaveWindowSessionLayout) {
        throw new Error("Window session state is unavailable");
      }
      return options.onSaveWindowSessionLayout(event.sender.id, layout);
    },
  );

  registerHandle(
    "window-sessions:update-bounds",
    (event, bounds: WindowSessionBounds) => {
      options.onUpdateWindowSessionBounds?.(event.sender.id, bounds);
    },
  );

  registerHandle("git:branch:state", (_, cwd: string) => {
    return readGitBranchState(cwd);
  });

  registerHandle(
    "git:branch:checkout",
    (_, input: { cwd: string; branch: string }) => {
      return checkoutGitBranch(input);
    },
  );

  registerHandle(
    "git:branch:create",
    (_, input: { cwd: string; branch: string }) => {
      return createAndCheckoutGitBranch(input);
    },
  );

  registerHandle(
    "git:review:snapshot",
    (
      _,
      input: {
        cwd: string;
        source: "unstaged" | "staged" | "branch" | "commit";
        baseRef?: string | null;
        commitSha?: string | null;
        hideWhitespace?: boolean;
      },
    ) => {
      return readGitReviewSnapshot(input);
    },
  );

  registerHandle("git:review:summary", (_, input) => {
    return readGitReviewSummary(input);
  });

  registerHandle("git:review:repository-metadata", (_, input) => {
    return readGitReviewRepositoryMetadata(input);
  });

  registerHandle("git:live-query:subscribe", (event, input) => {
    const sender = event.sender;
    const webContentsId = sender.id;
    stopGitReviewWatch(webContentsId, input.subscriptionId);

    if (!gitReviewWatchCleanupBound.has(webContentsId)) {
      gitReviewWatchCleanupBound.add(webContentsId);
      sender.once("destroyed", () => {
        stopAllGitReviewWatches(webContentsId);
        gitReviewWatchCleanupBound.delete(webContentsId);
      });
    }

    const subscription = subscribeGitReviewLiveQuery({
      subscriptionId: input.subscriptionId,
      query: input.query,
      publish: (payload) => {
        if (sender.isDestroyed()) {
          stopGitReviewWatch(webContentsId, input.subscriptionId);
          return;
        }
        safeSendToWebContents(sender, "git:live-query:event", [payload]);
      },
    });
    gitReviewWatches.set(
      `${webContentsId}:${input.subscriptionId}`,
      subscription,
    );
  });

  registerHandle("git:live-query:unsubscribe", (event, input) => {
    stopGitReviewWatch(event.sender.id, input.subscriptionId);
  });

  registerHandle("git:live-query:recover", (event, input) => {
    const key = `${event.sender.id}:${input.subscriptionId}`;
    return gitReviewWatches.get(key)?.recover();
  });

  registerHandle("git:live-query:refresh-repository", (event, input) => {
    const key = `${event.sender.id}:${input.subscriptionId}`;
    return gitReviewWatches.get(key)?.refresh();
  });

  registerHandle("git:review:diff", (_, input) => {
    return readGitReviewDiff(input);
  });

  registerHandle("git:review:cancel", (_, input) => {
    return cancelGitReviewRequest(input);
  });

  registerHandle("git:review:branch-diff-stats", (_, input) => {
    return readBranchDiffStats(input);
  });

  registerHandle("git:review:branch-commits", (_, input) => {
    return readGitReviewBranchCommits(input);
  });

  registerHandle("git:merge-base", (_, input) => {
    return resolveGitMergeBase(input);
  });

  registerHandle("git:review:cat-file", (_, input) => {
    return readGitReviewCatFile(input);
  });

  registerHandle("git:review:search", (_, input) => {
    return searchGitReview(input);
  });

  registerHandle("git:review:patch", (_, input) => {
    return readGitReviewPatch(input);
  });

  registerHandle("git:review:blame-file", (_, input) => {
    return readGitReviewBlameFile(input);
  });

  registerHandle("git:apply-patch", (_, input) => {
    return applyGitReviewPatch(input);
  });

  registerHandle("git:init", (_, cwd: string) => {
    return initializeGitRepositoryAndReadReviewSnapshot(cwd);
  });

  registerHandle("git:action:status", (_, input) => {
    return readGitActionStatus(input);
  });

  registerHandle("git:action:commit-message:generate", (_, input) => {
    return generateGitCommitMessage(input, {
      generateCommitMessage: createGitCommitMessageGenerator(input.hostId),
    });
  });

  registerHandle("git:action:pull-request-message:generate", (_, input) => {
    return generateGitPullRequestMessage(input, {
      generatePullRequestMessage: createGitPullRequestMessageGenerator(
        input.hostId,
      ),
    });
  });

  registerHandle("git:action:commit", (_, input) => {
    return commitGitChanges(input, {
      generateCommitMessage: createGitCommitMessageGenerator(input.hostId),
    });
  });

  registerHandle("git:action:push", (_, input) => {
    return pushGitChanges(input);
  });

  registerHandle("git:action:cancel", (_, input) => {
    return cancelGitAction(input);
  });

  registerHandle("gh-cli-status", (_, input) => {
    return readGhCliStatus(input);
  });

  registerHandle("gh-pr-status", (_, input) => {
    return readGhPrStatus(input);
  });

  registerHandle("gh-pr-checks", (_, input) => {
    return readGhPrChecks(input);
  });

  registerHandle("gh-pr-comments", (_, input) => {
    return readGhPrComments(input);
  });

  registerHandle("gh-pr-diff", (_, input) => {
    return readGhPrDiff(input);
  });

  registerHandle("gh-pr-comment", (_, input) => {
    return createGhPrComment(input);
  });

  registerHandle("gh-pr-merge", (_, input) => {
    return mergeGhPr(input);
  });

  registerHandle("gh-pr-update", (_, input) => {
    return updateGhPr(input);
  });

  registerHandle("gh-pr-create", (_, input) => {
    return createGhPr(input);
  });

  registerHandle("git:branch:watch:start", async (event, cwd: string) => {
    const sender = event.sender;
    const webContentsId = sender.id;
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : "";

    if (!normalizedCwd) {
      stopGitBranchWatch(webContentsId);
      return;
    }

    const existingWatch = gitBranchWatches.get(webContentsId);
    if (existingWatch?.cwd === normalizedCwd) {
      return;
    }

    stopGitBranchWatch(webContentsId);

    if (!gitBranchWatchCleanupBound.has(webContentsId)) {
      gitBranchWatchCleanupBound.add(webContentsId);
      sender.once("destroyed", () => {
        stopGitBranchWatch(webContentsId);
        gitBranchWatchCleanupBound.delete(webContentsId);
      });
    }

    const dispose = await watchGitBranch(normalizedCwd, () => {
      if (sender.isDestroyed()) {
        stopGitBranchWatch(webContentsId);
        return;
      }
      safeSendToWebContents(sender, "git:branch:changed", [
        { cwd: normalizedCwd },
      ]);
    });

    if (sender.isDestroyed()) {
      dispose();
      stopGitBranchWatch(webContentsId);
      return;
    }

    gitBranchWatches.set(webContentsId, {
      cwd: normalizedCwd,
      dispose,
    });
  });

  registerHandle("git:branch:watch:stop", (event) => {
    stopGitBranchWatch(event.sender.id);
  });

  // Assets
  registerHandle("asset:resolve-path", (_, source: string) => {
    if (typeof source !== "string") return null;

    const parsed = parseAssetSource(source);
    if (!parsed) return null;

    try {
      return resolveAssetPath(parsed.fileName);
    } catch {
      return null;
    }
  });

  registerHandle(
    "clipboard:write-image",
    async (_, input: { source?: string }) => {
      if (typeof input?.source !== "string") {
        return { ok: false, message: "Could not copy image." } as const;
      }

      return writeImageToClipboard(input.source);
    },
  );

  registerHandle("clipboard:inspect-paste", () => inspectClipboardPasteItems());

  registerHandle(
    "composer:pick-files",
    async (_, input?: { imagesOnly?: boolean; title?: string }) => {
      const imagesOnly = input?.imagesOnly === true;
      const result = await dialog.showOpenDialog({
        title:
          typeof input?.title === "string"
            ? input.title
            : imagesOnly
              ? "Select photos"
              : "Select files",
        properties: ["openFile", "multiSelections"],
        ...(imagesOnly
          ? {
              filters: [
                {
                  name: "Images",
                  extensions: [
                    "png",
                    "jpg",
                    "jpeg",
                    "gif",
                    "webp",
                    "bmp",
                    "tiff",
                    "tif",
                    "heic",
                    "heif",
                  ],
                },
              ],
            }
          : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      return prepareComposerPickedFiles(result.filePaths);
    },
  );

  // Browser sidebar
  registerHandle(
    "browser-sidebar-command",
    async (_event, command: BrowserSidebarCommand) =>
      browserSidebarService.handleCommand(command),
  );

  registerHandle(
    "browser-browsing-data-clear",
    async (_event, kind: BrowserBrowsingDataKind) =>
      browserSidebarService.clearBrowsingData(kind),
  );
  registerHandle(
    "browser-sidebar-webview-host-created",
    async (_event, event: BrowserSidebarWebviewHostCreated) =>
      browserSidebarService.handleWebviewHostCreated(event),
  );
  registerHandle(
    "browser-sidebar-webview-destroyed",
    async (_event, event: BrowserSidebarWebviewDestroyed) =>
      browserSidebarService.handleWebviewDestroyed(event),
  );

  // Terminal
  registerHandle("terminal-create", (event, input) => {
    const sender = event.sender;
    terminalManager.create(sender, input, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("terminal-attach", (event, input) => {
    const sender = event.sender;
    terminalManager.attach(sender, input, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("terminal-write", (event, sessionId: string, data: string) => {
    const sender = event.sender;
    terminalManager.write(sender, sessionId, data, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("terminal-run-action", async (event, input) => {
    const sender = event.sender;
    await terminalManager.runAction(sender, input, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("terminal-session:snapshot", (_, sessionId: string) =>
    terminalManager.getSessionSnapshot(sessionId),
  );

  registerHandle("terminal-resize", (event, sessionId: string, size) => {
    const sender = event.sender;
    terminalManager.resize(sender, sessionId, size, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("terminal-close", (event, sessionId: string) => {
    const sender = event.sender;
    terminalManager.close(sender, sessionId, (channel, payload) => {
      sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
    });
  });

  registerHandle("thread-terminal-snapshot", (_, threadId: string) =>
    terminalManager.getThreadSnapshot(threadId),
  );

  // Codex
  registerHandle("codex:connection:status", () =>
    codexService.getConnectionState(),
  );

  registerHandle("codex:account:read", () =>
    codexService.readAccountSnapshot(),
  );

  registerHandle("codex:account:rate-limit-reset:consume", (_, input) =>
    codexService.consumeAccountRateLimitResetCredit(input),
  );

  registerHandle("codex:dictation:state:read", () =>
    codexService.readDictationStateSnapshot(),
  );

  registerHandle("codex:conversation-image-asset:resolve", (_, input) =>
    codexService.resolveConversationImageAsset(input),
  );

  registerHandle("codex:account:login:start", (_, input) =>
    codexService.startAccountLogin(input),
  );

  registerHandle("codex:account:login:cancel", (_, loginId: string) =>
    codexService.cancelAccountLogin(loginId),
  );

  registerHandle("codex:account:logout", () => codexService.logoutAccount());

  registerHandle(
    "codex:threads:list",
    (_, projectId: string, opts?: { includeArchived?: boolean }) =>
      codexService.listProjectThreads(projectId, opts),
  );

  registerHandle("codex:sidebar:snapshot", async (_, input) => {
    const startedAt = getDevRuntimeMetricStart();
    const snapshot = await codexService.syncSidebarThreads(input);
    logDevRuntimeMetric("ipc.codex_sidebar_snapshot", {
      refresh: input?.refresh === true,
      includeArchived: input?.includeArchived === true,
      itemCount: snapshot.items.length,
      pinnedThreadCount: snapshot.pinnedThreadIds.length,
      projectAssignmentCount: Object.keys(snapshot.projectAssignments).length,
      projectlessThreadCount: snapshot.projectlessThreadIds.length,
      approxPayloadBytes: approximateJsonPayloadBytes(snapshot),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return snapshot;
  });

  registerHandle("codex:sidebar:sync", async (_, input) => {
    const startedAt = getDevRuntimeMetricStart();
    const result = await codexService.syncSidebarThreadsDetailed(input);
    const approxPayloadBytes = approximateJsonPayloadBytes(result);
    logDevRuntimeMetric("ipc.codex_sidebar_sync", {
      policy: input?.policy ?? "stale",
      reason: input?.reason ?? "manual",
      includeArchived: input?.includeArchived === true,
      source: result.source,
      refreshed: result.refreshed,
      itemCount: result.snapshot.items.length,
      changedProjectCount: result.changedProjectIds.length,
      projectlessChanged: result.projectlessChanged,
      materializedSessionCount: result.materializedSessionIds.length,
      failedThreadCount: result.failedThreadIds.length,
      approxPayloadBytes,
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    recordDevRuntimeMetricCounter(
      "ipc.codex_sidebar_sync.burst_window",
      {
        policy: input?.policy ?? "stale",
        reason: input?.reason ?? "manual",
        includeArchived: input?.includeArchived === true,
        approxPayloadBytes,
      },
      {
        groupBy: ["policy", "reason", "includeArchived"],
        windowMs: 1_000,
        burstThreshold: 5,
        burstMetric: "ipc.codex_sidebar_sync.burst",
      },
    );
    return result;
  });

  registerHandle("codex:sidebar:thread:move", (_, input) =>
    codexService.moveSidebarThread(input),
  );

  registerHandle("codex:sidebar:project-thread-order:set", (_, input) =>
    codexService.setSidebarProjectThreadOrder(input),
  );

  registerHandle("codex:sidebar:chats-thread-order:set", (_, input) =>
    codexService.setSidebarChatsThreadOrder(input),
  );

  registerHandle("codex:threads:pinned:list", () =>
    codexService.listPinnedThreads(),
  );

  registerHandle("codex:threads:pinned:set", (_, threadId: string, input) =>
    codexService.setThreadPinned(threadId, input.pinned),
  );

  registerHandle("codex:threads:pinned:reorder", (_, orderedThreadIds) =>
    codexService.setPinnedThreadOrder(
      requireNonBlankStringArray(orderedThreadIds, "Pinned thread order"),
    ),
  );

  registerHandle("codex:thread:ensure-session", (_, threadId: string) =>
    codexService.ensureSidebarThreadSession(threadId),
  );

  registerHandle("codex:threads:palette:list", (_, input) =>
    codexService.listCommandPaletteThreads(input),
  );

  registerHandle("codex:threads:palette:search-content", (_, input) =>
    codexService.searchCommandPaletteThreadContent(input),
  );

  registerHandle("codex:thread:summary:get", (_, threadId: string) =>
    codexService.resolveThreadSummary(threadId),
  );

  const broadcastScheduledAutomationChanged = (
    automationId: string,
    targetThreadId: string | null,
    reason: "upsert" | "delete",
  ) => {
    safeBroadcastToWindows(
      BrowserWindow.getAllWindows(),
      "codex:scheduled-automations:changed",
      [
        {
          automationId,
          targetThreadId,
          reason,
        },
      ],
    );
  };

  registerCodexScheduledAutomationIpcHandlers({
    registerHandle,
    automationModule,
    runScheduledAutomationNow: (input, rendererClientId) =>
      codexService.runScheduledAutomationNow(input, rendererClientId),
    resolveAutomationArchiveMessages: (threadId) =>
      codexService.resolveAutomationArchiveMessages(threadId),
    unarchiveThread: (threadId) => codexService.unarchiveThread(threadId),
    broadcastScheduledAutomationChanged,
    broadcastAutomationRunsUpdated: (event) => {
      broadcastIpcEvent("codex:automation-runs:updated", event);
    },
    onHeartbeatAutomationsEnabledChanged:
      options.onHeartbeatAutomationsEnabledChanged,
    resolveRendererClientId: (event) =>
      resolveRendererClientId(event as IpcMainInvokeEvent),
    onHeartbeatAutomationThreadStateChanged:
      options.onHeartbeatAutomationThreadStateChanged,
  });

  registerHandle("codex:model:list", () => codexService.listModels());

  registerCodexHooksIpcHandlers({
    registerHandle,
    listHooks: (input) => codexService.listHooks(input),
    updateHooksState: (input) => codexService.updateHooksState(input),
    broadcastHooksChanged: (event) => {
      broadcastIpcEvent("codex:hooks:changed", event);
    },
  });

  registerHandle("codex:collaboration-mode:list", () =>
    codexService.listCollaborationModes(),
  );

  registerHandle("codex:projectless-thread-cwd", (_, rawInput) => {
    const input = parseCodexProjectlessThreadCwdInput(rawInput);
    return createCodexProjectlessWorkspace({
      prompt: input.prompt,
      directoryName: input.directoryName,
      createSplitDirectories: input.createSplitDirectories !== false,
    });
  });

  registerHandle(
    "codex:thread:start-for-session",
    async (
      event,
      input: CodexThreadStartForSessionInput,
    ) => {
      const controller = new AbortController();
      const abortWhenRendererCloses = (): void => controller.abort();
      event.sender.once("destroyed", abortWhenRendererCloses);
      try {
        return await codexService.startThreadForSession(input, {
          signal: controller.signal,
        });
      } finally {
        event.sender.removeListener("destroyed", abortWhenRendererCloses);
      }
    },
  );

  registerHandle(
    "codex:thread:side-chat:start",
    (
      _,
      input: CodexSideChatStartInput,
    ) => codexService.startSideChat(input),
  );

  registerHandle("codex:thread:side-chat:discard", (_, threadId: string) =>
    codexService.discardSideChat(threadId),
  );

  registerHandle("worktrees:list", () => codexService.listManagedWorktrees());

  registerHandle("worktrees:environments:list", (_, projectId: string) =>
    codexService.listWorktreeEnvironments(projectId),
  );

  registerHandle(
    "worktrees:environments:configs:list",
    (_, projectId: string) =>
      codexService.listWorktreeEnvironmentConfigs(projectId),
  );

  registerHandle(
    "worktrees:environments:configs:list-for-workspace",
    (_, hostId: string, workspaceRoot: string) =>
      codexService.listWorktreeEnvironmentConfigsForWorkspace(hostId, workspaceRoot),
  );

  registerHandle(
    "worktrees:environments:config:read",
    (_, projectId: string, configPath?: string | null) =>
      codexService.readWorktreeEnvironmentConfig(projectId, configPath),
  );

  registerHandle("worktrees:environments:config:save", (_, input) =>
    codexService.saveWorktreeEnvironmentConfig(input),
  );

  registerHandle("worktrees:delete", (_, threadId: string) =>
    codexService.deleteManagedWorktree(threadId),
  );

  registerHandle("codex:thread:snapshot:request", (_, threadId: string) =>
    codexService.requestConversationSnapshot(threadId),
  );

  registerHandle("codex:thread:resume:request", (event, threadId: string) => {
    const ownerClientId = resolveRendererClientId(event);
    if (!ownerClientId) {
      throw new Error("Renderer client is not registered");
    }
    return codexService.requestRendererConversationResume(threadId, ownerClientId);
  });

  registerHandle(
    "codex:thread:background-subagents:hydrate",
    (_, input: CodexBackgroundSubagentThreadsHydrateInput) =>
      codexService.hydrateBackgroundSubagentThreads(input),
  );

  registerHandle(
    "codex:thread:subagents-panel:hydrate",
    (_, input: CodexSubagentPanelHydrateInput) =>
      codexService.hydrateSubagentPanel(input),
  );

  registerHandle("codex:subagent-thread:opened", (_, threadId: string) =>
    codexService.markSubagentThreadOpened(threadId),
  );

  registerHandle("codex:thread:resume-buffer:release", (_, threadId: string) =>
    codexService.releaseConversationResumeBuffer(threadId),
  );

  registerHandle(
    "codex:thread:view-active:set",
    (event, input: { threadId?: unknown; active?: unknown }) => {
      if (typeof input.threadId !== "string") return false;
      const clientId = resolveRendererClientId(event);
      if (!clientId) return false;
      codexService.setRendererConversationViewActive(
        input.threadId,
        clientId,
        input.active === true,
      );
      return true;
    },
  );

  registerHandle("codex:thread:turns:load-older", (_, threadId: string) =>
    codexService.loadOlderThreadTurns(threadId),
  );
  registerHandle("codex:thread:turns:load-complete", (_, threadId: string) =>
    codexService.loadCompleteThreadHistory(threadId),
  );

  registerHandle("codex:thread:name:set", (_, threadId: string, name: string) =>
    codexService.setThreadName(threadId, name),
  );

  registerHandle(
    "codex:thread:name:set-generated",
    (_, threadId: string, name: string) =>
      codexService.setGeneratedThreadName(threadId, name),
  );

  registerHandle(
    "codex:thread:title:generate",
    (_, input: { hostId: string; prompt: string; cwd: string | null }) => {
      void input.hostId;
      return codexService.generateThreadTitle({
        prompt: input.prompt,
        cwd: input.cwd,
      });
    },
  );

  registerHandle("codex:thread:archive", (_, threadId: string) =>
    codexService.archiveThread(threadId),
  );

  registerHandle("codex:thread:unarchive", (_, threadId: string) =>
    codexService.unarchiveThread(threadId),
  );

  registerHandle(
    "codex:thread:collaboration-mode:set",
    (_, threadId: string, collaborationMode: CodexCollaborationModeKind) =>
      codexService.setConversationCollaborationMode(
        threadId,
        collaborationMode,
      ),
  );

  registerHandle("codex:personality:get", () => codexService.getPersonality());
  registerHandle("codex:personality:set", (_, personality: CodexPersonality) => {
    codexService.setPersonality(personality);
  });

  registerHandle(
    "codex:thread:settings:update",
    (_, threadId: string, patch: CodexConversationThreadSettingsPatch) =>
      codexService.updateThreadSettingsForNextTurn(threadId, patch),
  );

  registerHandle(
    "codex:thread:plan-implementation:remove",
    (_, threadId: string, turnId: string) =>
      codexService.removePlanImplementationRequest(threadId, turnId),
  );

  registerHandle(
    "codex:turn:start",
    (
      _,
      threadId: string,
      prompt: string,
      opts?: CodexTurnStartOptions,
    ) => {
      return codexService.startTurn(threadId, prompt, opts);
    },
  );

  registerHandle("codex:review:start", (_, input) =>
    codexService.startReview(input),
  );

  registerHandle(
    "codex:thread:follow-up:enqueue",
    (
      _,
      threadId: string,
      prompt: string,
      opts?: CodexTurnStartOptions,
    ) => codexService.enqueueQueuedFollowUpPrompt(threadId, prompt, opts),
  );

  registerHandle(
    "codex:thread:follow-up:remove",
    (_, threadId: string, followUpId: string) =>
      codexService.removeQueuedFollowUp(threadId, followUpId),
  );

  registerHandle(
    "codex:thread:follow-up:reorder",
    (_, threadId: string, orderedFollowUpIds: string[]) =>
      codexService.reorderQueuedFollowUps(threadId, orderedFollowUpIds),
  );

  registerHandle(
    "codex:thread:follow-up:send-now",
    (_, threadId: string, followUpId: string) =>
      codexService.sendQueuedFollowUpNow(threadId, followUpId),
  );

  registerHandle("codex:thread:compact:start", (_, threadId: string) =>
    codexService.startThreadCompaction(threadId),
  );

  registerHandle("codex:thread:goal:get", (_, threadId: string) =>
    codexService.getThreadGoal(threadId),
  );

  registerHandle(
    "codex:thread:goal:set",
    (_, params: CodexThreadGoalSetActionInput) =>
      codexService.setThreadGoal(params),
  );

  registerHandle("codex:thread:goal:clear", (_, threadId: string) =>
    codexService.clearThreadGoal(threadId),
  );

  registerHandle("codex:thread:goal:materialize-draft", (_, draft) =>
    codexService.materializeThreadGoalDraft(draft),
  );

  registerHandle(
    "codex:thread:goal:materialized-cleanup",
    (_, attachmentDirectory) =>
      codexService.cleanupThreadGoalMaterializedDraft(attachmentDirectory),
  );

  registerHandle("codex:thread:goal:editable-objective:read", (_, objective) =>
    codexService.readThreadGoalEditableObjective(objective),
  );

  registerHandle(
    "codex:thread:memory-mode:set",
    (_, threadId: string, mode: "enabled" | "disabled") =>
      codexService.setThreadMemoryMode({ threadId, mode }),
  );

  registerHandle("codex:feedback:upload", (_, params) =>
    codexService.uploadFeedback(params),
  );

  registerHandle("codex:turn:steer", (_, input) =>
    codexService.steerTurn(input),
  );

  registerHandle(
    "codex:turn:interrupt",
    (_, threadId: string, turnId?: string) =>
      codexService.interruptTurn(threadId, turnId),
  );

  registerHandle(
    "codex:thread:background-terminals:clean",
    (_, threadId: string) => codexService.cleanBackgroundTerminals(threadId),
  );

  registerHandle(
    "codex:thread:background-terminals:clean-silent",
    (_, threadId: string) =>
      codexService.cleanBackgroundTerminalsSilently(threadId),
  );

  registerHandle(
    "codex:thread:background-terminals:list",
    (_, threadId: string) => codexService.listBackgroundTerminals(threadId),
  );

  registerHandle(
    "codex:thread:background-processes:list",
    (
      _,
      input: {
        threadId: string;
        observedTerminals?: ThreadBackgroundTerminal[];
      },
    ) => codexService.listBackgroundProcessRows(input),
  );

  registerHandle(
    "codex:thread:background-processes:run-action",
    async (event, input: CodexBackgroundProcessRunActionInput) => {
      const sender = event.sender;
      codexService.registerBackgroundProcessRunAction(input);
      await terminalManager.runAction(
        sender,
        {
          sessionId: input.terminalSessionId,
          conversationId: input.threadId,
          cwd: input.cwd,
          command: input.command,
          title: input.command,
        },
        (channel, payload) => {
          sendIpcEvent(sender, channel, payload as IpcEvents[typeof channel]);
        },
      );
      return codexService.listBackgroundProcessRows({
        threadId: input.threadId,
        observedTerminals: [],
      });
    },
  );

  registerHandle(
    "codex:thread:background-terminals:terminate",
    (_, input: { threadId: string; processId: string }) =>
      codexService.terminateBackgroundTerminal(input),
  );

  registerHandle("codex:mcp-resource:read", (_, params) =>
    codexService.readMcpResource(params),
  );

  registerHandle("codex:mcp-apps:list", () =>
    codexService.listMcpApps(),
  );

  registerHandle("codex:experimental-features:list", () =>
    codexService.listExperimentalFeatures(),
  );

  registerHandle(
    "codex:mcp-server-statuses:list",
    () => codexService.listMcpServerStatuses(),
  );

  registerHandle("codex:approval:respond", (
    _,
    conversationId: string,
    requestId: CodexProtocolRequestId,
    response: CodexApprovalResponse,
  ) => {
    const parsedResponse = parseCodexApprovalResponse(response);
    if (!parsedResponse) {
      throw new Error("Invalid Codex approval response for approval kind.");
    }
    return codexService.respondToApproval(requestId, parsedResponse, conversationId);
  },
  );

  registerHandle("codex:user-input:respond", (
    _,
    conversationId: string,
    requestId: CodexProtocolRequestId,
    answers,
  ) =>
    codexService.respondToUserInput(requestId, answers, conversationId),
  );

  registerHandle(
    "codex:mcp-elicitation:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
      codexService.respondToMcpServerElicitation(requestId, response, conversationId),
  );

  registerHandle(
    "codex:permission-request:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
      codexService.respondToPermissionRequest(requestId, response, conversationId),
  );

  registerHandle(
    "codex:option-picker:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
      codexService.respondToOptionPicker(conversationId, requestId, response),
  );

  registerHandle(
    "codex:setup-context-picker:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
      codexService.respondToSetupContextPicker(conversationId, requestId, response),
  );

  registerHandle(
    "codex:setup-codex-step:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
      codexService.respondToSetupCodexStep(conversationId, requestId, response),
  );

  registerHandle(
    "codex:conversation-unread:set",
    (_, conversationId: string, hasUnreadTurn: boolean) =>
      codexService.setConversationUnreadState(conversationId, hasUnreadTurn),
  );

  registerHandle(
    "codex:permission:mode:set",
    async (
      _,
      projectId: string,
      mode: "auto" | "guardian-approvals" | "full-access" | "custom",
    ) => {
      return await codexService.setProjectPermissionMode(projectId, mode);
    },
  );

  registerHandle("codex:permission:mode:get", async (_, projectId: string) => {
    return await codexService.getProjectPermissionMode(projectId);
  });

  registerHandle("codex:permission:state:get", async (_, projectId: string) => {
    return await codexService.getPermissionState(projectId);
  });

  registerHandle(
    "codex:permission:config-value:set",
    async (_, projectId: string, keyPath: string, value: unknown) => {
      return await codexService.setPermissionConfigValue(
        projectId,
        keyPath,
        value,
      );
    },
  );

  registerHandle(
    "codex:permission:custom-description:get",
    async (_, projectId: string) => {
      return await codexService.getCustomPermissionModeDescription(projectId);
    },
  );
}
