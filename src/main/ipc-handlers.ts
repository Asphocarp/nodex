import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from "electron";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { writeImageToClipboard } from "./clipboard-image-writer";
import { writeStructuralClipboard } from "./clipboard-structural-writer";
import { inspectClipboardPasteItems, readClipboardPastePayload } from "./clipboard-paste-inspector";
import {
  COMPOSER_IMAGE_FILE_EXTENSIONS,
  prepareComposerPickedFiles,
} from "./composer-picked-files";
import { registerPersistedAtomIpc } from "./persisted-atom-ipc";
import type { BrowserSidebarService } from "./browser-sidebar-service";
import type { CodexService } from "./codex/codex-service";
import {
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
  updateBackupSettings,
  updateDiagnosticsSettings,
  updateHistorySettings,
  updateTelemetrySettings,
  updateThreadNotificationSettings,
  updateWindowRestoreSettings,
} from "./local-store/config";
import {
  materializeCanvasImage,
  materializeLocalResource,
  readManagedAssetImage,
  readManagedAssetPreview,
  resolveAssetPath,
  saveUploadedImage,
  saveUploadedResource,
} from "./local-store/assets";
import { parseAssetSource } from "../shared/assets";
import { CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL } from "../shared/clipboard-paste";
import {
  FILE_PATH_INSPECT_SYNC_CHANNEL,
  MANAGED_ASSET_RESOLVE_PATH_SYNC_CHANNEL,
  PRELOAD_FILE_PATH_MAX_LENGTH,
} from "../shared/preload-file-access";
import { parseCodexApprovalResponse } from "../shared/codex-approval-response";
import {
  parseCodexUserInputAutoResolutionActivityInput,
  parseCodexUserInputAutoResolutionTarget,
} from "../shared/codex-user-input-auto-resolution";
import { composerAppshotService } from "./composer-appshot-service";
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
  CodexHostMessage,
  CodexProtocolRequestId,
  DatabasePage,
  TerminalRunActionRequest,
  TerminalSessionSnapshot,
  UpdateWorktreeEnvironmentConfigInput,
} from "../shared/types";
import type { ProjectionCursor } from "../shared/projection-stream";
import type {
  AgentImportApplyInput,
  AgentImportScanInput,
  AgentImportSourceKind,
} from "../shared/agent-import";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  RendererClientRouter,
  RendererClientWebContents,
} from "./codex/renderer-client-router";
import {
  acknowledgeRendererFollowerSnapshotApplied,
  ackRendererThreadOwnerNotification,
  broadcastCodexHostMessageToRendererClients,
  publishRendererThreadOwnerStreamState,
  requestRendererThreadStreamResync,
  runThreadFollowerActionThroughOwner,
  sendRendererOwnerHostMessage,
  sendRendererThreadStreamControlRelay,
  sendRendererThreadStreamRelay,
} from "./codex/owner-follower-ipc-bridge";
import { openFileLinkTarget } from "./file-link-opener";
import { parseExternalNavigationUrl } from "./external-navigation";
import {
  isWorkspaceFileUserError,
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  searchWorkspaceFiles,
  toWorkspaceFileIpcError,
  WorkspaceFileUserError,
  writeWorkspaceFile,
} from "./workspace-files-service";
import { requireTrustedAppRendererSender as requireTrustedAppRendererSenderWithOrigin } from "./platform/electron/TrustedRendererSender";
import { localFileWatchHost, type FileWatchSession } from "./file-watch-host";
import {
  WorkspaceDirectoryEntriesInputSchema,
  WorkspaceFileMetadataInputSchema,
  WorkspaceFileRequestSchema,
  WorkspaceFileSearchInputSchema,
  WorkspaceFileTextReadInputSchema,
  WorkspaceFileWatchStopInputSchema,
  WorkspaceFileWriteInputSchema,
} from "../shared/schemas/workspace-files";
import { renameProjectSessionChat } from "./project-session-rename-service";
import { captureMainException } from "./observability/sentry-main";
import { getLogger } from "./logging/logger";
import type { IpcApi, IpcEvents } from "../shared/ipc-api";
import { WorkbenchSceneSnapshotSchema } from "../shared/schemas/workbench-scene";
import { readThirdPartyNotices } from "./third-party-notices";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "../shared/native-context-menu";
import { buildSessionContextMenuIconSvg } from "../shared/session-context-menu-icons";
import { deleteProjectSessionWithBrowserCleanupUsing } from "./project-session-browser-ownership";
import {
  createProjectLifecycleService,
  runWithTerminalProjectAdmission,
} from "./project-lifecycle-service";
import { ProjectLifecycleInputSchema } from "../shared/schemas/projects";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";
import type { DesktopDocumentSyncPort } from "./core-client/desktop-document-sync-bridge";
import type { DesktopLibraryModuleBridge } from "./core-client/desktop-library-module-bridge";
import { createProjectWithDefaultSource } from "./default-project-source";
import { resolveNodexProjectsDirectory } from "./nodex-projects-directory";
import type { DesktopDatabaseModuleBridge } from "./core-client/desktop-database-module-bridge";
import type { CoreResult } from "../shared/core-result";
import { cancellableCoreResultFrom, coreResultFrom } from "./core-result-ipc";
import type { DesktopAutomationModulePort } from "./core-client/desktop-automation-module-bridge";
import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import type { GitWorkerHost } from "./git-worker-host";
import { readGitRepositoryIdentity } from "./git-repository-identity-service";
import {
  cancelGitAction,
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
  pushGitChanges,
  type GitActionWorkerPort,
} from "./git-action-service";
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
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexConversationThreadSettingsPatch,
  CodexSideChatStartInput,
  CodexThreadGoalSetActionInput,
  CodexThreadStartForSessionInput,
  CodexTurnStartOptions,
} from "../shared/types";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeymapState,
} from "../shared/command-keybindings";
import { safeBroadcastToWindows, safeSendToWebContents } from "./ipc-safe-send";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
  recordDevRuntimeMetricCounter,
} from "./dev-runtime-metrics";
import { registerCodexScheduledAutomationIpcHandlers } from "./codex-scheduled-automation-ipc-handlers";
import { type DocumentSyncClientTarget, documentSyncUnauthorized } from "./document-sync-transport";
import {
  registerBlockPropertyMutationIpcHandler,
  registerLibraryBlockPropertyMutationIpcHandler,
} from "./block-property-mutation-ipc";
import { registerDatabaseModuleIpcHandlers } from "./database-module-ipc";
import { registerLibraryModuleIpcHandler } from "./library-module-ipc";
import { registerLibraryDatabaseModuleIpcHandler } from "./library-database-module-ipc";
import { registerPageDetailIpcHandler } from "./page-detail-ipc";
import { registerLibraryPageDetailIpcHandler } from "./library-page-detail-ipc";
import { registerDocumentMutationIpcHandler } from "./document-operation-ipc";
import { registerAdditionalDocumentCommandIpcHandler } from "./additional-document-command-ipc";
import {
  registerBlockTransferIpcHandler,
  registerBlockTransferUndoIpcHandler,
} from "./block-transfer-ipc";
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
  component: "board-read-model",
});
const rendererDiagnosticsLogger = getLogger({
  subsystem: "renderer",
  component: "diagnostics",
});
function requireNonBlankStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
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

type CoreResultChannelValue<Channel extends keyof IpcApi> =
  IpcApi[Channel]["result"] extends CoreResult<infer Value> ? Value : never;

/**
 * Registers a Core-backed channel behind the `CoreResult` envelope:
 * typed Core errors travel as data instead of being flattened into IPC error
 * strings, so the renderer can classify cursor rejections and retryable
 * failures without matching message text. Non-Core failures still throw.
 */
function registerCoreResultHandle<Channel extends keyof IpcApi>(
  channel: Channel,
  read: (
    event: IpcMainInvokeEvent,
    ...args: IpcApi[Channel]["args"]
  ) => Promise<CoreResultChannelValue<Channel>>,
): void {
  registerHandle(channel, (async (event, ...args) => {
    return await coreResultFrom(async () => await read(event, ...args));
  }) as TypedIpcHandler<Channel>);
}

function requireTrustedWorkspaceFileSender(event: IpcMainInvokeEvent): void {
  try {
    requireTrustedAppRendererSender(event, "Workspace file access");
  } catch {
    throw new WorkspaceFileUserError(
      "unauthorized_sender",
      "Workspace file access is available only to the top-level app renderer",
    );
  }
}

function requireTrustedAppRendererSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  capabilityName: string,
): void {
  requireTrustedAppRendererSenderWithOrigin(
    event,
    capabilityName,
    process.env.ELECTRON_RENDERER_URL ?? null,
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

async function showDirectoriesPicker(
  event: IpcMainInvokeEvent,
  options: OpenDialogOptions,
): Promise<string[]> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return result.filePaths;
}

function sendIpcEvent<Channel extends keyof IpcEvents>(
  sender: Electron.WebContents,
  channel: Channel,
  payload: IpcEvents[Channel],
): void {
  safeSendToWebContents(sender, channel, [payload]);
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

const omitProjectScope = <Request extends { readonly projectId: string }>(
  request: Request,
): Omit<Request, "projectId"> => {
  const { projectId, ...unscoped } = request;
  void projectId;
  return unscoped;
};

function broadcastCommandKeymapState(state: CommandKeymapState): void {
  safeBroadcastToWindows(BrowserWindow.getAllWindows(), COMMAND_KEYBINDINGS_CHANGED_CHANNEL, [
    state,
  ]);
}

function refreshBrowserSidebarCommandAccelerators(): void {
  // Browser sidebar shortcut registration is renderer-owned in Nodex today.
}

interface RegisterIpcHandlersOptions {
  browserSidebarService: BrowserSidebarService;
  codexService: CodexService;
  gitWorkerHost?: Pick<GitWorkerHost, "requestFromMain">;
  resolveWindowSessionId?: (webContentsId: number) => string | null;
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
    | "pageSearchMetadata"
    | "pageSearchFacets"
    | "resolvePageTarget"
    | "resolvePageOwnershipPath"
    | "readPageLifecyclePreflight"
    | "applyPageLifecycleMutation"
    | "applyBlockPropertyMutation"
    | "applyLibraryBlockPropertyMutation"
  >;
  databaseModule?: Pick<
    DesktopDatabaseModuleBridge,
    | "read"
    | "apply"
    | "readLibrary"
    | "applyLibrary"
    | "getDatabaseViewWindow"
    | "getDatabaseListWindow"
    | "getDatabaseViewGroups"
    | "getLibraryDatabaseViewWindow"
    | "getLibraryDatabaseListWindow"
    | "getLibraryDatabaseViewGroups"
    | "getDatabaseRowPage"
    | "resolveDatabaseViewReference"
  >;
  automationModule?: DesktopAutomationModulePort;
  storeAdministration?: DesktopStoreAdministrationPort;
  onBackupSettingsChanged?: (settings: ReturnType<typeof getBackupSettings>) => void;
  onStoreRestored?: () => void;
  projectWorkspace?: DesktopProjectWorkspacePort;
  documentSync?: DesktopDocumentSyncPort;
  terminalRuntime?: {
    readonly listLiveSessionsForOwners: (input: {
      readonly conversationIds: ReadonlySet<string>;
      readonly projectSessionIds: ReadonlySet<string>;
    }) => Promise<readonly TerminalSessionSnapshot[]>;
    readonly discardExitedSessionsForOwners: (input: {
      readonly conversationIds: ReadonlySet<string>;
      readonly projectSessionIds: ReadonlySet<string>;
    }) => Promise<readonly string[]>;
    readonly runAction: (input: {
      readonly webContentsId: number;
      readonly windowSessionId: string;
      readonly request: TerminalRunActionRequest;
    }) => Promise<void>;
  };
}

const createUnconfiguredIpcAuthority = <Port extends object>(name: string): Port =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} is unavailable before Rust Core initialization`);
      },
    },
  ) as Port;

function assertValidOccurrenceIpcInput(input: PageOccurrenceActionInput): void {
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

function assertValidWorktreeEnvironmentSaveInput(
  input: UpdateWorktreeEnvironmentConfigInput,
): void {
  const revision = input?.expectedRevision;
  if (revision === null || (typeof revision === "string" && /^sha256:[a-f0-9]{64}$/.test(revision)))
    return;

  throw new Error("Invalid local environment revision");
}

function assertValidOccurrenceCompleteIpcInput(input: PageOccurrenceCompleteInput): void {
  assertValidOccurrenceIpcInput(input);
  if (
    typeof input.createdPageId !== "string" ||
    input.createdPageId.length === 0 ||
    input.createdPageId !== input.createdPageId.trim()
  ) {
    throw new Error("Missing or invalid occurrence createdPageId");
  }
}

function assertValidOccurrenceUpdateIpcInput(input: PageOccurrenceUpdateInput): void {
  assertValidOccurrenceIpcInput(input);
  if (input.scope !== "this" && input.scope !== "this-and-future" && input.scope !== "all") {
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
  if (typeof input.updates !== "object" || input.updates === null || Array.isArray(input.updates)) {
    throw new Error("Missing or invalid occurrence updates");
  }
}

function createGitActionWorkerPort(
  host: Pick<GitWorkerHost, "requestFromMain"> | undefined,
): GitActionWorkerPort {
  const requireHost = (): Pick<GitWorkerHost, "requestFromMain"> => {
    if (host) return host;
    throw new Error("Git worker is unavailable.");
  };

  return {
    readStatus: async (cwd, signal) =>
      await requireHost().requestFromMain({
        method: "action-status",
        params: { cwd },
        signal,
      }),
    readReviewPatch: async (input, signal) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await requireHost().requestFromMain({
          method: "review-patch",
          params: input,
          signal,
        });
        if (!("type" in result) || result.type !== "stale-snapshot") {
          return result as import("../shared/types").GitReviewPatchResult;
        }
      }
      throw new Error("Git repository changed while preparing the message.");
    },
    commit: async (input, signal) =>
      await requireHost().requestFromMain({
        method: "commit",
        params: { ...input, nextStep: "commit" },
        signal,
      }),
    refreshRepository: async (cwd) => {
      await requireHost().requestFromMain({
        method: "refresh-repository",
        params: { cwd },
      });
    },
  };
}

const pageSearchRequests = new Map<string, AbortController>();

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  const { browserSidebarService, codexService } = options;
  ipcMain.removeAllListeners(CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL);
  ipcMain.on(CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL, (event) => {
    try {
      requireTrustedAppRendererSender(event, "Clipboard paste inspection");
      event.returnValue = inspectClipboardPasteItems();
    } catch (error) {
      captureMainException(error, {
        tags: {
          channel: CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL,
          mechanism: "ipc-sync",
        },
        extra: {
          senderWebContentsId: event.sender.id,
        },
      });
      event.returnValue = { items: [] };
    }
  });
  ipcMain.removeAllListeners(MANAGED_ASSET_RESOLVE_PATH_SYNC_CHANNEL);
  ipcMain.on(MANAGED_ASSET_RESOLVE_PATH_SYNC_CHANNEL, (event, source: unknown) => {
    try {
      requireTrustedAppRendererSender(event, "Managed asset path access");
      if (typeof source !== "string") {
        event.returnValue = null;
        return;
      }
      const parsed = parseAssetSource(source);
      event.returnValue = parsed ? resolveAssetPath(parsed.fileName) : null;
    } catch {
      event.returnValue = null;
    }
  });
  ipcMain.removeAllListeners(FILE_PATH_INSPECT_SYNC_CHANNEL);
  ipcMain.on(FILE_PATH_INSPECT_SYNC_CHANNEL, (event, value: unknown) => {
    try {
      requireTrustedAppRendererSender(event, "Local file inspection");
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > PRELOAD_FILE_PATH_MAX_LENGTH ||
        value.includes("\0") ||
        !isAbsolute(value)
      ) {
        event.returnValue = null;
        return;
      }
      const stats = lstatSync(value);
      if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
        event.returnValue = null;
        return;
      }
      event.returnValue = {
        path: value,
        kind: stats.isDirectory() ? "folder" : "file",
        name: basename(value),
        ...(stats.isFile() ? { bytes: stats.size } : {}),
      };
    } catch {
      event.returnValue = null;
    }
  });
  const gitActionWorker = createGitActionWorkerPort(options.gitWorkerHost);
  interface SharedWorkspaceFileWatch {
    session: FileWatchSession;
    subscriptionIds: Set<string>;
  }
  const workspaceFileWatchSubscriptions = new Map<
    string,
    {
      ownerId: number;
      sharedKey: string;
    }
  >();
  const workspaceFileWatchSessions = new Map<string, Promise<SharedWorkspaceFileWatch>>();
  const workspaceFileWatchDestroyListeners = new Set<number>();
  const disposeWorkspaceFileWatchesForOwner = async (ownerId: number) => {
    for (const [subscriptionId, subscription] of workspaceFileWatchSubscriptions) {
      if (subscription.ownerId === ownerId) {
        workspaceFileWatchSubscriptions.delete(subscriptionId);
      }
    }
    const sharedKeyPrefix = `${ownerId}\0`;
    const pendingDisposals: Promise<void>[] = [];
    for (const [sharedKey, sharedPromise] of workspaceFileWatchSessions) {
      if (!sharedKey.startsWith(sharedKeyPrefix)) continue;
      workspaceFileWatchSessions.delete(sharedKey);
      pendingDisposals.push(
        sharedPromise.then(async (shared) => await shared.session.dispose()).catch(() => {}),
      );
    }
    await Promise.all(pendingDisposals);
  };
  const storeAdministration =
    options.storeAdministration ??
    createUnconfiguredIpcAuthority<DesktopStoreAdministrationPort>(
      "Store Administration authority",
    );
  const automationModule =
    options.automationModule ??
    createUnconfiguredIpcAuthority<DesktopAutomationModulePort>("Automation authority");
  const projectWorkspace: DesktopProjectWorkspacePort =
    options.projectWorkspace ?? createUnconfiguredIpcAuthority("Project Workspace authority");
  const requireBrowserViewScope = (senderId: number, scopeId: string): void => {
    const expectedScopeId = options.resolveWindowSessionId?.(senderId) ?? null;
    if (!expectedScopeId || expectedScopeId !== scopeId) {
      throw new Error("Browser view scope does not belong to the requesting window");
    }
  };
  const requireAssignedWindowSessionId = (senderId: number): string => {
    const windowSessionId = options.resolveWindowSessionId?.(senderId) ?? null;
    if (!windowSessionId) {
      throw new Error("The requesting window has no assigned Window Session");
    }
    return windowSessionId;
  };
  const projectLifecycleService = createProjectLifecycleService({
    projectWorkspace,
    browserRuntime: browserSidebarService,
    listCodexBlockers: (threadIds) => codexService.listProjectArchiveBlockers(threadIds),
    listBackgroundProcessRows: async (threadId) =>
      await codexService.listBackgroundProcessRows({ threadId }),
    listLiveTerminalSessions: (input) =>
      options.terminalRuntime?.listLiveSessionsForOwners(input) ?? Promise.resolve([]),
    discardExitedTerminalSessions: (input) =>
      options.terminalRuntime?.discardExitedSessionsForOwners(input) ?? Promise.resolve([]),
  });
  const documentSync =
    options.documentSync ??
    createUnconfiguredIpcAuthority<DesktopDocumentSyncPort>("Document authority");
  const libraryModule =
    options.libraryModule ??
    createUnconfiguredIpcAuthority<NonNullable<RegisterIpcHandlersOptions["libraryModule"]>>(
      "Library authority",
    );
  const databaseModule =
    options.databaseModule ??
    createUnconfiguredIpcAuthority<NonNullable<RegisterIpcHandlersOptions["databaseModule"]>>(
      "Database authority",
    );
  const resolveRendererClientId = (event: IpcMainInvokeEvent): string | null =>
    options.rendererClientRouter?.ensureClient(event.sender as RendererClientWebContents)
      .clientId ?? null;

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
    async ({ cwd, prompt, signal }: { cwd: string; prompt: string; signal?: AbortSignal }) => {
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
    async ({ cwd, prompt, signal }: { cwd: string; prompt: string; signal?: AbortSignal }) => {
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
      return options.rendererClientRouter.broadcast(channel, args, optionsOverride);
    }

    return safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, args);
  };

  codexService.on("event", (event) => {
    broadcastRendererClientMessage("codex:event", [event]);
    if (event.type === "scheduledAutomationChanged") {
      safeBroadcastToWindows(BrowserWindow.getAllWindows(), "codex:scheduled-automations:changed", [
        event.event,
      ]);
    }
    if (event.type === "automationRunsUpdated") {
      broadcastIpcEvent("codex:automation-runs:updated", event.event);
    }
  });
  codexService.on("hostMessage", (message) => {
    const targetClientIds =
      message.type === "threadStreamStateChanged"
        ? codexService.getRendererConversationFollowerClientIds(message.conversationId)
        : undefined;
    if (message.type === "threadStreamStateChanged" && targetClientIds !== undefined) {
      if (targetClientIds === null) return;
      const delivery = sendRendererThreadStreamRelay(
        options.rendererClientRouter,
        targetClientIds,
        message.sourceClientId,
        message,
      );
      codexService.handleRendererClientDeliveryFailure([
        ...delivery.unavailableClientIds,
        ...delivery.failedClientIds,
      ]);
      return;
    }
    broadcastCodexHostMessageToRendererClients(
      options.rendererClientRouter,
      (channel, args) => safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, args),
      message,
    );
  });
  codexService.on("userInputAutoResolutionChanged", (change) => {
    broadcastIpcEvent("codex:user-input:auto-resolution:changed", change);
  });
  codexService.on(
    "rendererOwnerHostMessage",
    (event: { targetClientId: string; message: unknown }) => {
      sendRendererOwnerHostMessage(options.rendererClientRouter, event);
    },
  );
  codexService.on(
    "rendererThreadStreamRelay",
    (event: {
      targetClientIds: readonly string[];
      sourceClientId: string | null;
      message: CodexHostMessage;
    }) => {
      const delivery = sendRendererThreadStreamRelay(
        options.rendererClientRouter,
        event.targetClientIds,
        event.sourceClientId,
        event.message,
      );
      codexService.handleRendererClientDeliveryFailure([
        ...delivery.unavailableClientIds,
        ...delivery.failedClientIds,
      ]);
    },
  );
  codexService.on(
    "rendererThreadStreamControlRelay",
    (event: {
      targetClientIds: readonly string[];
      message: Extract<
        CodexHostMessage,
        { type: "threadStreamFollowersChanged" | "threadStreamTransportReset" }
      >;
    }) => {
      const delivery = sendRendererThreadStreamControlRelay(
        options.rendererClientRouter,
        event.targetClientIds,
        event.message,
      );
      codexService.handleRendererClientDeliveryFailure([
        ...delivery.unavailableClientIds,
        ...delivery.failedClientIds,
      ]);
    },
  );

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
  codexService.on("agentImportProgress", (event) => {
    broadcastIpcEvent("agent-import:progress", event);
  });
  registerHandle(
    "codex:pending-worktree:discard-fork-side-panel-transfer",
    (_, pendingWorktreeId) => {
      if (!pendingWorktreeId.trim()) throw new Error("Pending worktree id is required");
      codexService.discardPendingForkSidePanelTransfer(pendingWorktreeId);
    },
  );
  registerHandle("codex:fork-side-panel-transfer:consume", async (event, input) => {
    requireBrowserViewScope(event.sender.id, input.targetBrowserViewScopeId);
    return await codexService.consumeForkSidePanelTransfer(input);
  });

  registerHandle("diagnostics:renderer-log", (_, input) => {
    if (process.env.NODEX_ASSISTANT_STREAMING_DEBUG !== "1") {
      return;
    }
    rendererDiagnosticsLogger.info(input.message, input.fields);
  });
  registerHandle("codex:renderer-client:id", (event) => resolveRendererClientId(event));
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
  options.rendererClientRouter?.addClientConnectedListener((event) => {
    codexService.handleRendererClientConnected(event.clientId);
  });
  registerHandle("codex:thread-owner:stream-state:publish", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return publishRendererThreadOwnerStreamState(codexService, sourceClientId, input);
  });
  registerHandle("codex:thread-follower:snapshot-applied", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return acknowledgeRendererFollowerSnapshotApplied(codexService, sourceClientId, input);
  });
  registerHandle("codex:thread:stream-resync:request", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return requestRendererThreadStreamResync(codexService, sourceClientId, input);
  });
  registerHandle("codex:thread-owner:notification:ack", (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return ackRendererThreadOwnerNotification(codexService, sourceClientId, input);
  });
  registerHandle("codex:thread-owner:pending-requests:replay", (event, threadId) => {
    const sourceClientId = resolveRendererClientId(event);
    return codexService.replayRendererOwnerPendingRequests(threadId, sourceClientId);
  });
  registerHandle("codex:thread-owner:app-server-request", async (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return await codexService.handleRendererOwnerAppServerRequest(sourceClientId, input);
  });
  registerHandle("codex:thread-follower:action", async (event, input) => {
    const sourceClientId = resolveRendererClientId(event);
    return await runThreadFollowerActionThroughOwner(
      codexService,
      options.rendererClientRouter,
      sourceClientId,
      input,
    );
  });
  registerHandle(
    "codex:dynamic-tool-call:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, context) =>
      codexService.respondToDynamicToolCall(requestId, conversationId, context),
  );

  registerHandle("document-sync:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return await documentSync.subscribe(
      { kind: "project", projectId: request.projectId },
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("page-target:resolve", (_, input) => libraryModule.resolvePageTarget(input));
  registerHandle("page-ownership-path:resolve", (_, input) =>
    libraryModule.resolvePageOwnershipPath(input),
  );
  registerHandle("database-view:reference:get", (_, input) =>
    databaseModule.resolveDatabaseViewReference(input),
  );
  registerHandle("block-document:owned:get", async (_, projectId, ownerBlockId) => {
    return await documentSync.getOwnedDocumentDescriptor(projectId, ownerBlockId);
  });
  registerHandle("block-document:owned:prepare", async (_, projectId, ownerBlockId) => {
    return await documentSync.prepareOwnedBlockDocument(projectId, ownerBlockId);
  });
  registerHandle("library-block-document:owned:prepare", async (_, ownerBlockId) => {
    return await documentSync.prepareLibraryOwnedBlockDocument(ownerBlockId);
  });
  registerHandle("document-sync:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return await documentSync.unsubscribe(
      { kind: "project", projectId: request.projectId },
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("document-sync:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return await documentSync.sync(
      { kind: "project", projectId: request.projectId },
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("document-sync:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return await documentSync.applyUpdate(
      { kind: "project", projectId: request.projectId },
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("canvas-scene:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas scene subscription is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    return await documentSync.subscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas scene subscription is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    return await documentSync.unsubscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas scene sync is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    return await documentSync.syncCanvasScene(target, request);
  });
  registerHandle("canvas-scene:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas scene mutation is unauthorized",
          retryable: false,
          resetRequired: false,
          mutationId: request.mutationId,
        },
      };
    }
    return await documentSync.applyCanvasSceneMutation(target, request);
  });
  registerHandle("canvas-scene:presence:publish", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "unauthorized" as const,
          message: "Canvas presence publication is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    return await documentSync.publishCanvasPresence(target, request);
  });
  registerHandle("canvas-scene:compaction:read", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas compaction read is unauthorized",
          retryable: false,
          resetRequired: false,
        },
      };
    }
    return await documentSync.readCanvasSceneCompaction(target, request);
  });
  registerHandle("canvas-scene:compaction:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "access_scope_mismatch" as const,
          message: "Canvas compaction is unauthorized",
          retryable: false,
          resetRequired: false,
          mutationId: request.mutationId,
        },
      };
    }
    return await documentSync.compactCanvasScene(target, request);
  });
  registerHandle("document-sync:awareness:publish", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return await documentSync.publishAwareness(
      { kind: "project", projectId: request.projectId },
      target,
      omitProjectScope(request),
    );
  });
  registerHandle("library-document-sync:subscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    return await documentSync.subscribe({ kind: "library" }, target, request);
  });
  registerHandle("library-document-sync:unsubscribe", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    return await documentSync.unsubscribe({ kind: "library" }, target, request);
  });
  registerHandle("library-document-sync:sync", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    return await documentSync.sync({ kind: "library" }, target, request);
  });
  registerHandle("library-document-sync:apply", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    return await documentSync.applyUpdate({ kind: "library" }, target, request);
  });
  registerHandle("library-document-sync:awareness:publish", async (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) return documentSyncUnauthorized();
    return await documentSync.publishAwareness({ kind: "library" }, target, request);
  });
  registerBlockPropertyMutationIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) => listener(event, projectId, request));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: {
          kind: "electron_renderer",
          clientId,
        },
      };
    },
    applyMutation: libraryModule.applyBlockPropertyMutation,
  });
  registerLibraryBlockPropertyMutationIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) => listener(event, request));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyMutation: libraryModule.applyLibraryBlockPropertyMutation,
  });

  registerDatabaseModuleIpcHandlers({
    registerHandle: (channel, listener) => {
      registerHandle(
        channel,
        (event, projectId, request) =>
          listener(event, projectId, request) as
            | IpcApi[typeof channel]["result"]
            | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        actor: { kind: "electron_renderer", clientId },
      };
    },
    apply: databaseModule.apply,
    read: databaseModule.read,
  });

  registerLibraryModuleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(
        channel,
        (event, accessContext, request) =>
          listener(event, accessContext, request) as
            | IpcApi[typeof channel]["result"]
            | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: libraryModule.read,
    apply: libraryModule.apply,
  });

  registerLibraryDatabaseModuleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(
        channel,
        (event, request) =>
          listener(event, request) as
            | IpcApi[typeof channel]["result"]
            | Promise<IpcApi[typeof channel]["result"]>,
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: databaseModule.readLibrary,
    apply: databaseModule.applyLibrary,
  });

  registerPageDetailIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, pageId, minimumCommitSeq) =>
        listener(event, projectId, pageId, minimumCommitSeq),
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: libraryModule.readProjectPageDetail,
  });

  registerLibraryPageDetailIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, pageId, minimumCommitSeq) =>
        listener(event, pageId, minimumCommitSeq),
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    read: (pageId, minimumCommitSeq) =>
      libraryModule.readLibraryPageDetail(pageId, undefined, minimumCommitSeq),
  });

  registerPageLifecyclePreflightIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, pageId) => listener(event, projectId, pageId));
    },
    readPreflight: libraryModule.readPageLifecyclePreflight,
  });

  registerPageLifecycleIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) => listener(event, projectId, request));
    },
    getTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyMutation: libraryModule.applyPageLifecycleMutation,
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
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: {
          kind: "electron_renderer",
          clientId,
        },
      };
    },
    applyMutation: documentSync.applyDocumentMutation,
  });

  registerAdditionalDocumentCommandIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, request) => listener(event, projectId, request));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyCommand: documentSync.applyAdditionalDocumentCommand,
  });

  registerBlockTransferIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, intent) => listener(event, projectId, intent));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    transfer: documentSync.transferBlocks,
  });

  registerBlockTransferUndoIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, intent) => listener(event, projectId, intent));
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      return resolveDocumentSyncTarget(event);
    },
    undo: documentSync.undoBlockTransfer,
  });

  registerDocumentHistoryIpcHandlers({
    registerHandle: (channel, listener) => {
      if (channel === "block-documents:history:checkpoint") {
        registerHandle(
          channel,
          (event, projectId, documentId, request) =>
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
      registerHandle(
        channel,
        (event, projectId, documentId, request) =>
          listener(event, projectId, documentId, request) as
            | IpcApi["block-documents:history:restore"]["result"]
            | Promise<IpcApi["block-documents:history:restore"]["result"]>,
      );
    },
    resolveTrustedIdentity: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const target = resolveDocumentSyncTarget(event);
      if (!target) return null;
      const clientId = resolveRendererClientId(event) ?? `electron-window:${target.id}`;
      return {
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    createCheckpoint: documentSync.createCheckpoint,
    listVersions: documentSync.listVersions,
    getVersion: documentSync.getVersion,
    restoreVersion: documentSync.restoreVersion,
  });

  registerPageHistoryIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) => listener(event, request));
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    listHistory: libraryModule.listPageHistory,
  });

  registerPersistedAtomIpc({
    registerSync: (listener) => {
      registerHandle("persisted-atom:sync-request", listener);
    },
    registerMutation: (listener) => {
      registerHandle("persisted-atom:update", (event, mutation) =>
        listener(String(event.sender.id), mutation),
      );
    },
    broadcast: (persistedEvent) => {
      safeBroadcastToWindows(BrowserWindow.getAllWindows(), "persisted-atom:updated", [
        persistedEvent,
      ]);
    },
  });

  // Projects
  registerHandle(
    "projects:list",
    async (_, input) => await projectWorkspace.listProjectWindow(input),
  );

  registerHandle(
    "projects:get",
    async (_, projectId: string) => await projectWorkspace.getProject(projectId),
  );

  registerHandle(
    "projects:activity-summaries",
    async (_, projectIds: string[]) =>
      await projectWorkspace.readProjectActivitySummaries(projectIds),
  );

  registerCoreResultHandle(
    "projects:create",
    async (_, input) =>
      await createProjectWithDefaultSource(input, {
        projectsDirectory: resolveNodexProjectsDirectory(app.getPath("documents")),
        createProject: async (projectInput) => await projectWorkspace.createProject(projectInput),
      }),
  );

  registerCoreResultHandle(
    "projects:update",
    async (_, projectId: string, updates) =>
      await projectWorkspace.updateProject(projectId, updates),
  );

  registerHandle(
    "projects:reorder",
    async (_, input) => await projectWorkspace.reorderProjects(input),
  );

  registerHandle(
    "projects:set-pinned",
    async (_, projectId: string, input) =>
      await projectWorkspace.setProjectPinned(projectId, input),
  );

  registerHandle(
    "projects:set-pinned-order",
    async (_, input) => await projectWorkspace.setPinnedProjectOrder(input),
  );

  registerHandle("projects:pick-source-roots", async (event) => {
    return showDirectoriesPicker(event, {
      title: "Select Project Root",
      properties: ["openDirectory", "createDirectory", "multiSelections"],
    });
  });

  registerHandle("workspace:pick-directory", async (event, input) => {
    return showDirectoryPicker(event, {
      title: typeof input?.title === "string" ? input.title : "Choose folder",
      properties:
        input?.createDirectory === true ? ["openDirectory", "createDirectory"] : ["openDirectory"],
    });
  });

  registerHandle("projects:set-lifecycle", async (_, projectId: string, input) => {
    const parsed = ProjectLifecycleInputSchema.parse(input);
    return await projectLifecycleService.setLifecycle(projectId, parsed.lifecycle);
  });

  // Project sessions
  registerHandle("workspace:tasks:list", async (_, projectId: string | null, input) => {
    const startedAt = getDevRuntimeMetricStart();
    const window = await projectWorkspace.listProjectSessionSummaryWindow(projectId, input);
    logDevRuntimeMetric("ipc.workspace_tasks_list", {
      projectId,
      includeArchived: input?.includeArchived === true,
      requestedFirst: input?.first ?? 50,
      itemCount: window.items.length,
      hasMore: window.hasMore,
      approxPayloadBytes: approximateJsonPayloadBytes(window),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return window;
  });

  registerHandle("project-sessions:get", async (_, sessionId: string) => {
    const startedAt = getDevRuntimeMetricStart();
    const session = await projectWorkspace.getProjectSession(sessionId);
    logDevRuntimeMetric("ipc.project_sessions_get", {
      sessionId,
      found: session !== null,
      approxPayloadBytes: approximateJsonPayloadBytes(session),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return session;
  });

  registerHandle(
    "project-sessions:create",
    async (_, input) => await projectWorkspace.createProjectSession(input),
  );

  registerHandle(
    "project-sessions:ensure-default-draft",
    async (_, projectId) => await projectWorkspace.ensureDefaultDraftProjectSession(projectId),
  );

  registerHandle("project-sessions:update", async (_, sessionId: string, input) => {
    return await projectWorkspace.updateProjectSession(sessionId, input);
  });

  registerHandle("project-sessions:rename", (_, sessionId: string, input) =>
    renameProjectSessionChat(sessionId, input, {
      getProjectSession: projectWorkspace.getProjectSession,
      renameProjectSession: projectWorkspace.renameProjectSession,
      setThreadName: (threadId, rawTitle) => codexService.setThreadName(threadId, rawTitle),
    }),
  );

  registerHandle("project-sessions:delete", async (_, sessionId: string) => {
    return await deleteProjectSessionWithBrowserCleanupUsing({
      sessionId,
      browserRuntime: browserSidebarService,
      deleteProjectSession: projectWorkspace.deleteProjectSession,
    });
  });

  registerHandle(
    "project-sessions:reorder",
    async (_, projectId: string | null, orderedSessionIds: string[]) =>
      await projectWorkspace.reorderProjectSessions(projectId, orderedSessionIds),
  );

  registerHandle(
    "project-sessions:set-pinned",
    async (_, sessionId: string, input) =>
      await projectWorkspace.setProjectSessionPinned(sessionId, input),
  );

  registerHandle(
    "project-sessions:set-pinned-order",
    async (_, projectId: string, input) =>
      await projectWorkspace.setPinnedProjectSessionOrder(projectId, input),
  );

  registerHandle("project-sessions:archive", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
      return await projectWorkspace.getProjectSession(sessionId);
    }
    return await projectWorkspace.archiveProjectSession(sessionId);
  });

  registerHandle("project-sessions:unarchive", async (_, sessionId: string) => {
    const existing = await projectWorkspace.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
      return await projectWorkspace.getProjectSession(sessionId);
    }
    return await projectWorkspace.unarchiveProjectSession(sessionId);
  });

  registerHandle(
    "project-sessions:mark-unread",
    async (_, sessionId: string, input) =>
      await projectWorkspace.markProjectSessionUnread(sessionId, input),
  );

  registerHandle(
    "project-sessions:fork",
    async (event, sessionId: string, input, sourceSceneContext) => {
      if (sourceSceneContext) {
        requireBrowserViewScope(event.sender.id, sourceSceneContext.browserViewScopeId);
      }
      const parsedSceneContext = sourceSceneContext
        ? {
            browserViewScopeId: sourceSceneContext.browserViewScopeId,
            scene: WorkbenchSceneSnapshotSchema.parse(sourceSceneContext.scene),
          }
        : undefined;
      return await codexService.forkProjectSessionThread(sessionId, input, parsedSceneContext);
    },
  );

  registerHandle(
    "project-session-threads:attach",
    async (_, input) => await projectWorkspace.upsertProjectSessionThreadLink(input),
  );

  registerHandle(
    "project-session-threads:detach",
    async (_, sessionId: string) => await projectWorkspace.detachProjectSessionThread(sessionId),
  );

  registerCoreResultHandle("database:view-window:get", async (_, projectId, input) => {
    const startedAt = performance.now();
    const window = await databaseModule.getDatabaseViewWindow(projectId, input);
    ipcPayloadLogger.info("Database View window payload served", {
      channel: "database:view-window:get",
      projectId,
      rowCount: window.rows.length,
      hasContinuation: window.nextCursor !== null,
      approxPayloadBytes: approximateJsonPayloadBytes(window),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return window;
  });

  registerCoreResultHandle("database:list-window:get", async (_, projectId, input) => {
    const startedAt = performance.now();
    const window = await databaseModule.getDatabaseListWindow(projectId, input);
    ipcPayloadLogger.info("Database List window payload served", {
      channel: "database:list-window:get",
      projectId,
      rowCount: window.rows.length,
      hasContinuation: window.nextCursor !== null,
      approxPayloadBytes: approximateJsonPayloadBytes(window),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return window;
  });

  registerCoreResultHandle(
    "database:view-groups:get",
    async (_, projectId, input) => await databaseModule.getDatabaseViewGroups(projectId, input),
  );

  registerCoreResultHandle("library-database:view-window:get", async (_, input) => {
    const startedAt = performance.now();
    const window = await databaseModule.getLibraryDatabaseViewWindow(input);
    ipcPayloadLogger.info("Library Database View window payload served", {
      channel: "library-database:view-window:get",
      rowCount: window.rows.length,
      hasContinuation: window.nextCursor !== null,
      approxPayloadBytes: approximateJsonPayloadBytes(window),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return window;
  });

  registerCoreResultHandle("library-database:list-window:get", async (_, input) => {
    const startedAt = performance.now();
    const window = await databaseModule.getLibraryDatabaseListWindow(input);
    ipcPayloadLogger.info("Library Database List window payload served", {
      channel: "library-database:list-window:get",
      rowCount: window.rows.length,
      hasContinuation: window.nextCursor !== null,
      approxPayloadBytes: approximateJsonPayloadBytes(window),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return window;
  });

  registerCoreResultHandle(
    "library-database:view-groups:get",
    async (_, input) => await databaseModule.getLibraryDatabaseViewGroups(input),
  );

  // Database Pages
  registerHandle("pages:search", async (event, requestId, input) => {
    if (!requestId || requestId.length > 128 || requestId.trim() !== requestId) {
      throw new Error("Page search request identity is invalid");
    }
    const key = `${event.sender.id}:${requestId}`;
    if (pageSearchRequests.has(key)) {
      throw new Error("Page search request identity is already active");
    }
    const controller = new AbortController();
    pageSearchRequests.set(key, controller);
    const startedAt = performance.now();
    try {
      const result = await cancellableCoreResultFrom(
        controller.signal,
        async () => await libraryModule.searchPages(input, controller.signal),
      );
      if (result.status === "cancelled") return result;
      const snapshot = result.value;
      ipcPayloadLogger.info("page search payload served", {
        channel: "pages:search",
        projectCount: input.projectIds.length,
        resultCount: snapshot.results.length,
        approxPayloadBytes: approximateJsonPayloadBytes(snapshot),
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { status: "completed" as const, snapshot };
    } finally {
      if (pageSearchRequests.get(key) === controller) {
        pageSearchRequests.delete(key);
      }
    }
  });

  registerHandle("pages:search:cancel", (event, requestId) => {
    const controller = pageSearchRequests.get(`${event.sender.id}:${requestId}`);
    if (!controller) return false;
    controller.abort();
    return true;
  });

  registerHandle("pages:search-metadata", async (_, projectIds, pageIds) => {
    const startedAt = performance.now();
    const snapshot = await libraryModule.pageSearchMetadata(projectIds, pageIds);
    ipcPayloadLogger.info("page search metadata payload served", {
      channel: "pages:search-metadata",
      projectCount: projectIds.length,
      resultCount: snapshot.documents.length,
      approxPayloadBytes: approximateJsonPayloadBytes(snapshot),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return snapshot;
  });

  registerHandle(
    "pages:search-facets",
    async (_, projectIds) => await libraryModule.pageSearchFacets(projectIds),
  );

  registerHandle(
    "database-row:get",
    (
      _,
      projectId: string,
      pageId: string,
      status?: string,
      minimumCommitCursor?: ProjectionCursor,
    ) =>
      databaseModule.getDatabaseRowPage(
        projectId,
        pageId,
        status as DatabasePage["status"] | undefined,
        minimumCommitCursor,
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
      after?: string | null,
    ) =>
      automationModule
        .listPageOccurrences(projectId, windowStart, windowEnd, searchQuery, after)
        .then((window) => ({
          occurrences: [...window.items],
          nextCursor: window.nextCursor,
        })),
  );

  registerHandle(
    "page:occurrence:complete",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceCompleteIpcInput(input);
      return await automationModule.completePageOccurrence(projectId, input, sessionId);
    },
  );

  registerHandle(
    "page:occurrence:skip",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceIpcInput(input);
      return await automationModule.skipPageOccurrence(projectId, input, sessionId);
    },
  );

  registerHandle(
    "page:occurrence:update",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceUpdateIpcInput(input);
      return await automationModule.updatePageOccurrence(projectId, input, sessionId);
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

  registerHandle("settings:history:update", (_, input) => updateHistorySettings(input));

  registerHandle("settings:diagnostics:get", () => getDiagnosticsSettings());

  registerHandle("settings:diagnostics:update", (_, input) => updateDiagnosticsSettings(input));

  registerHandle("settings:telemetry:get", () => getTelemetrySettings());

  registerHandle("settings:telemetry:update", (_, input) => updateTelemetrySettings(input));

  registerHandle("settings:thread-notifications:get", () => getThreadNotificationSettings());

  registerHandle("settings:thread-notifications:update", (_, input) =>
    updateThreadNotificationSettings(input),
  );

  registerHandle("settings:codex-developer:get", () => getCodexDeveloperInstructionSettings());

  registerHandle("settings:codex-developer:update", (_, input) =>
    updateCodexDeveloperInstructionSettings(input),
  );

  registerHandle("settings:git:get", () => getCodexGitSettings());

  registerHandle("settings:git:update", (_, input) => updateCodexGitSettings(input));

  registerHandle("settings:third-party-notices:get", () =>
    readThirdPartyNotices({
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
  );

  registerHandle(
    "native-context-menu:show",
    async (event, items: NativeContextMenuItem[], menuOptions?: NativeContextMenuOptions) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return await showNativeContextMenu(window, items, menuOptions);
    },
  );

  registerHandle("settings:window-restore:get", () => getWindowRestoreSettings());

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

  registerHandle("shell:open-file-link", (_, target, openerId) =>
    openFileLinkTarget(target, openerId),
  );
  registerHandle("shell:open-external-url", async (event, value) => {
    requireTrustedAppRendererSender(event, "external navigation");
    const url = parseExternalNavigationUrl(value);
    await shell.openExternal(url.toString());
    return true;
  });
  registerHandle("shell:open-path-default", async (_, inputPath) => {
    const normalizedPath = inputPath.trim();
    if (!isAbsolute(normalizedPath)) return false;
    return (await shell.openPath(normalizedPath)) === "";
  });
  registerHandle("shell:path-context:get", () => ({
    homeDirectory: homedir(),
    separator: sep === "\\" ? ("\\" as const) : ("/" as const),
  }));

  registerHandle("workspace-directory-entries", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      listWorkspaceDirectoryEntries(WorkspaceDirectoryEntriesInputSchema.parse(input)),
    ),
  );

  registerHandle("workspace-file-search", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      searchWorkspaceFiles(WorkspaceFileSearchInputSchema.parse(input)),
    ),
  );

  registerHandle("read-file", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      readWorkspaceFile(WorkspaceFileTextReadInputSchema.parse(input)),
    ),
  );

  registerHandle("read-file-metadata", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      readWorkspaceFileMetadata(WorkspaceFileMetadataInputSchema.parse(input)),
    ),
  );

  registerHandle("read-file-binary", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      readWorkspaceFileBinary(WorkspaceFileRequestSchema.parse(input)),
    ),
  );

  registerHandle("write-file", (event, input) =>
    runWorkspaceFileHandler(event, () =>
      writeWorkspaceFile(WorkspaceFileWriteInputSchema.parse(input)),
    ),
  );

  registerHandle("workspace-file-watch:start", (event, input) =>
    runWorkspaceFileHandler(event, async () => {
      const request = WorkspaceFileRequestSchema.parse(input);
      const ownerId = event.sender.id;
      const watchedPath = resolve(request.path);
      const sharedKey = `${ownerId}\0${watchedPath}`;
      const subscriptionId = randomUUID();
      if (!workspaceFileWatchDestroyListeners.has(ownerId)) {
        workspaceFileWatchDestroyListeners.add(ownerId);
        event.sender.once("destroyed", () => {
          workspaceFileWatchDestroyListeners.delete(ownerId);
          void disposeWorkspaceFileWatchesForOwner(ownerId);
        });
      }
      let sharedPromise = workspaceFileWatchSessions.get(sharedKey);
      if (!sharedPromise) {
        const subscriptionIds = new Set<string>();
        sharedPromise = localFileWatchHost
          .startFileWatch({
            path: dirname(watchedPath),
            recursive: false,
            renameEventHandling: "changed-path-with-parent-directory",
            onChange: ({ changedPaths }) => {
              const exactPathChanged =
                changedPaths.length === 0 ||
                changedPaths.some((changedPath) => resolve(changedPath) === watchedPath);
              if (!exactPathChanged || event.sender.isDestroyed()) return;
              for (const activeSubscriptionId of subscriptionIds) {
                sendIpcEvent(event.sender, "workspace-file:changed", {
                  subscriptionId: activeSubscriptionId,
                  path: watchedPath,
                });
              }
            },
          })
          .then((session) => ({
            session,
            subscriptionIds,
          }))
          .catch((error: unknown) => {
            workspaceFileWatchSessions.delete(sharedKey);
            throw error;
          });
        workspaceFileWatchSessions.set(sharedKey, sharedPromise);
        const createdPromise = sharedPromise;
        void createdPromise
          .then((shared) =>
            shared.session.closed.then(() => {
              if (workspaceFileWatchSessions.get(sharedKey) !== createdPromise) return;
              workspaceFileWatchSessions.delete(sharedKey);
              for (const activeSubscriptionId of shared.subscriptionIds) {
                workspaceFileWatchSubscriptions.delete(activeSubscriptionId);
              }
            }),
          )
          .catch(() => {});
      }

      const shared = await sharedPromise;
      if (event.sender.isDestroyed()) {
        workspaceFileWatchSessions.delete(sharedKey);
        await shared.session.dispose();
        throw new WorkspaceFileUserError(
          "unauthorized_sender",
          "Workspace file watcher owner is no longer available",
        );
      }
      shared.subscriptionIds.add(subscriptionId);
      workspaceFileWatchSubscriptions.set(subscriptionId, {
        ownerId,
        sharedKey,
      });
      return { subscriptionId };
    }),
  );

  registerHandle("workspace-file-watch:stop", (event, input) =>
    runWorkspaceFileHandler(event, async () => {
      const request = WorkspaceFileWatchStopInputSchema.parse(input);
      const subscription = workspaceFileWatchSubscriptions.get(request.subscriptionId);
      if (!subscription || subscription.ownerId !== event.sender.id) return;
      workspaceFileWatchSubscriptions.delete(request.subscriptionId);
      const sharedPromise = workspaceFileWatchSessions.get(subscription.sharedKey);
      if (!sharedPromise) return;
      const shared = await sharedPromise;
      shared.subscriptionIds.delete(request.subscriptionId);
      if (shared.subscriptionIds.size > 0) return;
      workspaceFileWatchSessions.delete(subscription.sharedKey);
      await shared.session.dispose();
    }),
  );

  registerHandle("open-file", (_, target, openerId) => openFileLinkTarget(target, openerId));

  registerHandle("git:repository:identity", (_, cwd: string) => {
    return readGitRepositoryIdentity(cwd);
  });

  registerHandle("git:action:commit-message:generate", (_, input) => {
    return generateGitCommitMessage(input, {
      gitWorker: gitActionWorker,
      generateCommitMessage: createGitCommitMessageGenerator(input.hostId),
    });
  });

  registerHandle("git:action:pull-request-message:generate", (_, input) => {
    return generateGitPullRequestMessage(input, {
      gitWorker: gitActionWorker,
      generatePullRequestMessage: createGitPullRequestMessageGenerator(input.hostId),
    });
  });

  registerHandle("git:action:commit", async (_, input) => {
    return await commitGitChanges(input, {
      gitWorker: gitActionWorker,
      generateCommitMessage: createGitCommitMessageGenerator(input.hostId),
    });
  });

  registerHandle("git:action:push", async (_, input) => {
    const result = await pushGitChanges(input);
    await options.gitWorkerHost
      ?.requestFromMain({
        method: "refresh-repository",
        params: { cwd: input.cwd },
      })
      .catch(() => undefined);
    return result;
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

  // Assets
  registerHandle("asset:resolve-path", (event, source: string) => {
    requireTrustedAppRendererSender(event, "Managed asset path access");
    if (typeof source !== "string") return null;

    const parsed = parseAssetSource(source);
    if (!parsed) return null;

    try {
      return resolveAssetPath(parsed.fileName);
    } catch {
      return null;
    }
  });
  registerHandle("asset:image:save", (event, input) => {
    requireTrustedAppRendererSender(event, "Managed image writes");
    return saveUploadedImage(input);
  });
  registerHandle("asset:canvas-image:materialize", (event, input) => {
    requireTrustedAppRendererSender(event, "Managed Canvas image writes");
    return materializeCanvasImage(input);
  });
  registerHandle("asset:image:read", (event, source) => {
    requireTrustedAppRendererSender(event, "Managed image reads");
    return readManagedAssetImage(source);
  });
  registerHandle("asset:resource:save", (event, input) => {
    requireTrustedAppRendererSender(event, "Managed resource writes");
    return saveUploadedResource(input);
  });
  registerHandle("asset:resource:materialize", (event, localPath) => {
    requireTrustedAppRendererSender(event, "Managed resource imports");
    if (typeof localPath !== "string") {
      throw new Error("Local resource path is required");
    }
    return materializeLocalResource(localPath);
  });
  registerHandle("asset:preview:read", (event, input) => {
    requireTrustedAppRendererSender(event, "Managed asset previews");
    return readManagedAssetPreview(input);
  });

  registerHandle("clipboard:write-image", async (event, input: { source?: string }) => {
    requireTrustedAppRendererSender(event, "Clipboard image writes");
    if (typeof input?.source !== "string") {
      return { ok: false, message: "Could not copy image." } as const;
    }

    return writeImageToClipboard(input.source);
  });

  registerHandle("clipboard:write-structural", (event, input) => {
    requireTrustedAppRendererSender(event, "Structural clipboard writes");
    return writeStructuralClipboard(input);
  });

  registerHandle("clipboard:read-paste", (event) => {
    requireTrustedAppRendererSender(event, "Clipboard paste reads");
    return readClipboardPastePayload();
  });

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
                  extensions: [...COMPOSER_IMAGE_FILE_EXTENSIONS],
                },
              ],
            }
          : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      return prepareComposerPickedFiles(result.filePaths);
    },
  );

  // Codex
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

  registerHandle("codex:sidebar:thread:move", (_, input) => codexService.moveSidebarThread(input));

  registerHandle("codex:threads:pinned:list", async () => await codexService.listPinnedThreads());

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

  registerHandle("codex:threads:palette:search", (_, input) =>
    codexService.searchCommandPaletteThreads(input),
  );

  registerHandle("codex:thread:summary:get", (_, threadId: string) =>
    codexService.resolveThreadSummary(threadId),
  );

  const broadcastScheduledAutomationChanged = (
    automationId: string,
    targetThreadId: string | null,
    reason: "upsert" | "delete",
  ) => {
    safeBroadcastToWindows(BrowserWindow.getAllWindows(), "codex:scheduled-automations:changed", [
      {
        automationId,
        targetThreadId,
        reason,
      },
    ]);
  };

  registerCodexScheduledAutomationIpcHandlers({
    registerHandle,
    automationModule,
    prepareCreateInput: (input) => codexService.prepareScheduledAutomationInput(input),
    prepareUpdateInput: (input, current) =>
      codexService.prepareScheduledAutomationInput(input, current),
    runScheduledAutomationNow: (input, rendererClientId) =>
      codexService.runScheduledAutomationNow(input, rendererClientId),
    resolveAutomationArchiveMessages: (threadId) =>
      codexService.resolveAutomationArchiveMessages(threadId),
    unarchiveThread: (threadId) => codexService.unarchiveThread(threadId),
    broadcastScheduledAutomationChanged,
    broadcastAutomationRunsUpdated: (event) => {
      broadcastIpcEvent("codex:automation-runs:updated", event);
    },
    onHeartbeatAutomationsEnabledChanged: options.onHeartbeatAutomationsEnabledChanged,
    resolveRendererClientId: (event) => resolveRendererClientId(event as IpcMainInvokeEvent),
    onHeartbeatAutomationThreadStateChanged: options.onHeartbeatAutomationThreadStateChanged,
  });

  registerHandle("codex:composer-appshot:target", () => composerAppshotService.readTarget());
  registerHandle("codex:composer-appshot:capture", (_, input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.targetId !== "string" ||
      !input.targetId.trim() ||
      input.targetId.length > 512
    ) {
      throw new Error("Invalid Appshot capture target");
    }
    return composerAppshotService.capture(input.targetId.trim());
  });

  const parseAgentImportSourceKind = (value: unknown): AgentImportSourceKind => {
    if (value === "claude-code" || value === "codex" || value === "open-interpreter") {
      return value;
    }
    throw new Error("Invalid agent import source");
  };
  registerHandle("agent-import:scan", (_, input: AgentImportScanInput) => {
    const sourceKind = parseAgentImportSourceKind(input?.sourceKind);
    return codexService.scanAgentImport(sourceKind);
  });
  registerHandle("agent-import:scan-picked-home", async (event, input: AgentImportScanInput) => {
    const sourceKind = parseAgentImportSourceKind(input?.sourceKind);
    if (sourceKind === "claude-code") {
      throw new Error("Claude Code imports use its standard home directory");
    }
    const sourceHome = await showDirectoryPicker(event, {
      buttonLabel: "Scan",
      message: "The selected directory is read-only during import.",
      properties: ["openDirectory"],
      title: `Select ${sourceKind === "codex" ? "Codex" : "Open Interpreter"} home`,
    });
    if (!sourceHome) return null;
    return await codexService.scanAgentImport(sourceKind, sourceHome);
  });
  registerHandle("agent-import:apply", (_, input: AgentImportApplyInput) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.scanId !== "string" ||
      !Array.isArray(input.itemIds) ||
      !input.itemIds.every((itemId) => typeof itemId === "string")
    ) {
      throw new Error("Invalid agent import selection");
    }
    return codexService.applyAgentImport({
      itemIds: input.itemIds,
      scanId: input.scanId,
    });
  });

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
    async (event, input: CodexThreadStartForSessionInput) => {
      const controller = new AbortController();
      const abortWhenRendererCloses = (): void => controller.abort();
      event.sender.once("destroyed", abortWhenRendererCloses);
      try {
        return await codexService.startThreadForSession(input, {
          signal: controller.signal,
          browserViewScopeId:
            options.resolveWindowSessionId?.(event.sender.id) ?? `headless:${input.sessionId}`,
          ownerClientId: resolveRendererClientId(event),
        });
      } finally {
        event.sender.removeListener("destroyed", abortWhenRendererCloses);
      }
    },
  );

  registerHandle("codex:thread:side-chat:start", (_, input: CodexSideChatStartInput) =>
    codexService.startSideChat(input),
  );

  registerHandle("codex:thread:side-chat:discard", (_, threadId: string) =>
    codexService.discardSideChat(threadId),
  );

  registerHandle("worktrees:list", () => codexService.listManagedWorktrees());
  registerHandle("worktrees:settings:get", () => codexService.getManagedWorktreeSettings());
  registerHandle("worktrees:settings:update", (_, input) =>
    codexService.updateManagedWorktreeSettings(input),
  );
  registerHandle("worktrees:execution-hosts:get", () =>
    codexService.getCodexExecutionHostSettings(),
  );
  registerHandle("worktrees:execution-hosts:update", (_, input) =>
    codexService.updateCodexExecutionHostSettings(input),
  );
  registerHandle("worktrees:thread:availability", (_, threadId: string) =>
    codexService.inspectThreadManagedWorktree(threadId),
  );
  registerHandle("worktrees:thread:restore", (_, threadId: string) =>
    codexService.restoreThreadManagedWorktree(threadId),
  );

  registerHandle("worktrees:environments:list", (_, projectId: string) =>
    codexService.listWorktreeEnvironments(projectId),
  );

  registerHandle("worktrees:environments:configs:list", (_, projectId: string) =>
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

  registerHandle("worktrees:environments:config:save", (_, input) => {
    assertValidWorktreeEnvironmentSaveInput(input);
    return codexService.saveWorktreeEnvironmentConfig(input);
  });

  registerHandle("worktrees:delete", (_, hostId: string, worktreePath: string) =>
    codexService.deleteManagedWorktree(hostId, worktreePath),
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

  registerHandle("codex:thread:fresh-owner:adopt", (event, threadId: string, launchId: string) => {
    const ownerClientId = resolveRendererClientId(event);
    if (!ownerClientId) {
      throw new Error("Renderer client is not registered");
    }
    return codexService.requestRendererFreshConversationAdoption(threadId, launchId, ownerClientId);
  });

  registerHandle(
    "codex:thread:background-subagents:hydrate",
    (_, input: CodexBackgroundSubagentThreadsHydrateInput) =>
      codexService.hydrateBackgroundSubagentThreads(input),
  );

  registerHandle(
    "codex:thread:subagents-panel:hydrate",
    (_, input: CodexSubagentPanelHydrateInput) => codexService.hydrateSubagentPanel(input),
  );

  registerHandle("codex:subagent-thread:opened", (_, threadId: string) =>
    codexService.markSubagentThreadOpened(threadId),
  );

  registerHandle("codex:thread:resume-buffer:release", (_, threadId: string) =>
    codexService.releaseConversationResumeBuffer(threadId),
  );

  registerHandle("codex:thread:view-active:set", (event, input: unknown) => {
    if (typeof input !== "object" || input === null) return false;
    const threadId =
      "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
    if (!threadId) return false;
    const clientId = resolveRendererClientId(event);
    if (!clientId) return false;
    codexService.setRendererConversationViewActive(
      threadId,
      clientId,
      "active" in input && input.active === true,
    );
    return true;
  });

  registerHandle("codex:thread:stream-following:set", (event, input: unknown) => {
    if (typeof input !== "object" || input === null) return false;
    const threadId =
      "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
    if (!threadId) return false;
    const clientId = resolveRendererClientId(event);
    if (!clientId) return false;
    return codexService.setRendererConversationFollowing(
      threadId,
      clientId,
      "following" in input && input.following === true,
      {
        forceSnapshot: "reannounce" in input && input.reannounce === true,
      },
    );
  });

  registerHandle("codex:thread:presentation:set", (event, input: unknown) => {
    if (typeof input !== "object" || input === null) return false;
    const threadId =
      "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
    const surfaceId =
      "surfaceId" in input && typeof input.surfaceId === "string" ? input.surfaceId.trim() : "";
    if (!threadId || !surfaceId) return false;
    const clientId = resolveRendererClientId(event);
    if (!clientId) return false;
    codexService.setRendererConversationPresented(
      threadId,
      clientId,
      surfaceId,
      "presented" in input && input.presented === true,
    );
    return true;
  });

  registerHandle("codex:user-input:auto-resolution:snapshot", () =>
    codexService.getUserInputAutoResolutionSnapshot(),
  );

  registerHandle("codex:user-input:auto-resolution:activity", (event, input: unknown) => {
    const conversationId = parseCodexUserInputAutoResolutionActivityInput(input);
    if (conversationId === null) return false;
    const clientId = resolveRendererClientId(event);
    if (!clientId) return false;
    return codexService.recordUserInputAutoResolutionActivity(conversationId, clientId);
  });

  registerHandle("codex:user-input:auto-resolution:snooze", (event, input: unknown) => {
    const target = parseCodexUserInputAutoResolutionTarget(input);
    if (target === null) return false;
    const clientId = resolveRendererClientId(event);
    if (!clientId) return false;
    return codexService.snoozeUserInputAutoResolution(
      target.conversationId,
      target.requestId,
      clientId,
    );
  });

  registerHandle("codex:thread:turns:load-older", (_, threadId: string) =>
    codexService.loadOlderThreadTurns(threadId),
  );
  registerHandle("codex:thread:turns:load-complete", (_, threadId: string) =>
    codexService.loadCompleteThreadHistory(threadId),
  );

  registerHandle("codex:thread:name:set", (_, threadId: string, name: string) =>
    codexService.setThreadName(threadId, name),
  );

  registerHandle("codex:thread:name:set-generated", (_, threadId: string, name: string) =>
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
      codexService.setConversationCollaborationMode(threadId, collaborationMode),
  );

  registerHandle(
    "codex:thread:settings:update",
    (_, threadId: string, patch: CodexConversationThreadSettingsPatch) =>
      codexService.updateThreadSettingsForNextTurn(threadId, patch),
  );

  registerHandle("codex:thread:plan-implementation:remove", (_, threadId: string, turnId: string) =>
    codexService.removePlanImplementationRequest(threadId, turnId),
  );

  registerHandle(
    "codex:turn:start",
    (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) => {
      return codexService.startTurn(threadId, prompt, opts);
    },
  );

  registerHandle("codex:review:start", (_, input) => codexService.startReview(input));

  registerHandle(
    "codex:thread:follow-up:enqueue",
    (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) =>
      codexService.enqueueQueuedFollowUpPrompt(threadId, prompt, opts),
  );

  registerHandle("codex:thread:follow-up:remove", (_, threadId: string, followUpId: string) =>
    codexService.removeQueuedFollowUp(threadId, followUpId),
  );

  registerHandle(
    "codex:thread:follow-up:reorder",
    (_, threadId: string, orderedFollowUpIds: string[]) =>
      codexService.reorderQueuedFollowUps(threadId, orderedFollowUpIds),
  );

  registerHandle("codex:thread:follow-up:send-now", (_, threadId: string, followUpId: string) =>
    codexService.sendQueuedFollowUpNow(threadId, followUpId),
  );

  registerHandle("codex:thread:compact:start", (_, threadId: string) =>
    codexService.startThreadCompaction(threadId),
  );

  registerHandle("codex:thread:goal:get", (_, threadId: string) =>
    codexService.getThreadGoal(threadId),
  );

  registerHandle("codex:thread:goal:set", (_, params: CodexThreadGoalSetActionInput) =>
    codexService.setThreadGoal(params),
  );

  registerHandle("codex:thread:goal:clear", (_, threadId: string) =>
    codexService.clearThreadGoal(threadId),
  );

  registerHandle("codex:turn:steer", (_, input) => codexService.steerTurn(input));

  registerHandle("codex:turn:interrupt", (_, threadId: string, turnId?: string) =>
    codexService.interruptTurn(threadId, turnId),
  );

  registerHandle("codex:thread:background-terminals:clean", (_, threadId: string) =>
    codexService.cleanBackgroundTerminals(threadId),
  );

  registerHandle("codex:thread:background-terminals:clean-silent", (_, threadId: string) =>
    codexService.cleanBackgroundTerminalsSilently(threadId),
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
      const terminalInput = {
        sessionId: input.terminalSessionId,
        conversationId: input.threadId,
        cwd: input.cwd,
        command: input.command,
        title: input.command,
      };
      await runWithTerminalProjectAdmission(projectWorkspace, terminalInput, async () => {
        await codexService.registerBackgroundProcessRunAction(input);
        if (!options.terminalRuntime) throw new Error("Terminal runtime is unavailable");
        await options.terminalRuntime.runAction({
          webContentsId: sender.id,
          windowSessionId: requireAssignedWindowSessionId(sender.id),
          request: terminalInput,
        });
      });
      return codexService.listBackgroundProcessRows({
        threadId: input.threadId,
        observedTerminals: [],
      });
    },
  );

  registerHandle("mcp-app:open-external", async (event, value) => {
    requireTrustedAppRendererSender(event, "MCP external navigation");
    if (value.length > 8_192) throw new Error("MCP external URL is too long");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("MCP external navigation requires a credential-free HTTPS URL");
    }
    await shell.openExternal(url.toString());
  });

  registerHandle(
    "codex:approval:respond",
    (
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

  registerHandle(
    "codex:user-input:respond",
    (_, conversationId: string, requestId: CodexProtocolRequestId, answers) =>
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
      projectId: string | null,
      mode: "auto" | "guardian-approvals" | "full-access" | "custom",
    ) => {
      return await codexService.setProjectPermissionMode(projectId, mode);
    },
  );

  registerHandle("codex:permission:mode:get", async (_, projectId: string | null) => {
    return await codexService.getProjectPermissionMode(projectId);
  });

  registerHandle("codex:permission:state:get", async (_, projectId: string | null) => {
    return await codexService.getPermissionState(projectId);
  });

  registerHandle(
    "codex:permission:config-value:set",
    async (_, projectId: string | null, keyPath: string, value: unknown) => {
      return await codexService.setPermissionConfigValue(projectId, keyPath, value);
    },
  );

  registerHandle("codex:permission:custom-description:get", async (_, projectId: string | null) => {
    return await codexService.getCustomPermissionModeDescription(projectId);
  });
}
