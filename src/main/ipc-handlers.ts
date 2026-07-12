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
import * as backupService from "./local-store/backups";
import * as boardReadModel from "./local-store/board-read-model";
import * as cardOccurrences from "./local-store/card-occurrences";
import * as cardsStore from "./local-store/cards";
import { getDb } from "./local-store/database";
import { readCardMetadataPropertySnapshot } from "./local-store/card-metadata-property-snapshot";
import {
  readProjectScopedDatabaseViewReference,
  resolveProjectScopedCardReference,
} from "./local-store/reference-reads";
import {
  readPersistedAtomState,
  updatePersistedAtom,
} from "./local-store/persisted-atoms";
import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import * as sqlInspection from "./local-store/sql-inspection";
import { terminalManager } from "./terminal-manager";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getCommandKeymapState,
  getDiagnosticsSettings,
  getHistorySettings,
  getTelemetrySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
  resetCommandKeybindings,
  updateCommandKeybinding,
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
import { codexService } from "./codex/codex-service";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceCompleteInput,
  CardOccurrenceUpdateInput,
  CodexBackgroundProcessRunActionInput,
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
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
  getThreadGoalAttachmentsRoot,
  materializeThreadGoalDraft,
  readThreadGoalEditableObjective,
  removeOwnedThreadGoalAttachmentDirectory,
} from "./thread-goal-attachments";
import {
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  readWorkspacePathsExist,
  writeWorkspaceFile,
} from "./workspace-files-service";
import { dbNotifier } from "./local-store/notifier";
import { blockMutationWriter } from "./block-mutation-writer";
import { projectDeletionRuntime } from "./project-deletion-runtime";
import { renameProjectSessionChat } from "./project-session-rename-service";
import { captureMainException } from "./observability/sentry-main";
import { getLogger } from "./logging/logger";
import type { WorkbenchLayoutSnapshot } from "../shared/workbench-layout";
import type { IpcApi, IpcEvents } from "../shared/ipc-api";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "../shared/window-session";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "../shared/native-context-menu";
import { buildSessionContextMenuIconSvg } from "../shared/session-context-menu-icons";
import {
  browserSidebarService,
  broadcastBrowserSidebarEvent,
} from "./browser-sidebar-service";
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
  readGitReviewDiff,
  readGitReviewFileContents,
  readGitReviewPatch,
  readGitReviewSnapshot,
  readGitReviewSummary,
  resolveGitMergeBase,
  searchGitReview,
} from "./git-review-service";
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
  CodexConversationThreadSettingsPatch,
  CodexPromptInput,
  CodexThreadGoalSetActionInput,
} from "../shared/types";
import type {
  BrowserBrowsingDataKind,
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
import {
  type DocumentSyncClientTarget,
  DocumentSyncHub,
  documentSyncUnauthorized,
} from "./document-sync-hub";
import { documentSyncHub as defaultDocumentSyncHub } from "./document-sync-runtime";
import { registerBlockPropertyMutationIpcHandler } from "./block-property-mutation-ipc";
import {
  DATABASE_CATALOG_IPC_CHANNEL,
  DATABASE_MANAGEMENT_IPC_CHANNEL,
  PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL,
  PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
  registerDatabaseKernelIpcHandlers,
} from "./database-kernel-ipc";
import { registerDocumentMutationIpcHandler } from "./document-operation-ipc";
import { registerAdditionalDocumentCommandIpcHandler } from "./additional-document-command-ipc";
import { registerCardProjectTransferIpcHandler } from "./card-project-transfer-ipc";
import { registerBlockTransferIpcHandler } from "./block-transfer-ipc";
import { registerDocumentHistoryIpcHandlers } from "./document-history-ipc";
import {
  registerCardLifecycleIpcHandler,
  registerCardLifecyclePreflightIpcHandler,
} from "./card-lifecycle-ipc";
import { registerCardHistoryIpcHandler } from "./card-history-ipc";
import { registerCardMetadataPropertySnapshotIpcHandler } from "./card-metadata-property-snapshot-ipc";

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
      throw error;
    }
  });
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

const remoteHostedPipService = new RemoteHostedPipService({
  broadcast: (channel, payload) => {
    broadcastIpcEvent(channel, payload);
  },
  resolveThreadIdForSession: (sessionId) =>
    projectSessionService.getProjectSession(sessionId)?.thread?.threadId ??
    null,
  sendToSender: (sender, channel, payload) => {
    sendIpcEvent(sender as Electron.WebContents, channel, payload);
  },
});

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
    remoteHostedPipService.handleBrowserUseStateSnapshot(snapshot);
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
  remoteHostedPipService.handleBrowserUseStateSnapshot(
    browserSidebarService.getBrowserUseStateSnapshot(),
  );
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
  ) => void;
}

function assertValidOccurrenceIpcInput(
  input: CardOccurrenceActionInput,
): void {
  if (
    typeof input?.operationId !== "string" ||
    input.operationId.length === 0 ||
    input.operationId.length > 512 ||
    input.operationId !== input.operationId.trim()
  ) {
    throw new Error("Missing or invalid occurrence operationId");
  }
  if (typeof input.cardId !== "string" || input.cardId.length === 0) {
    throw new Error("Missing or invalid occurrence cardId");
  }
  if (
    !(input.occurrenceStart instanceof Date) ||
    !Number.isFinite(input.occurrenceStart.getTime())
  ) {
    throw new Error("Missing or invalid occurrenceStart");
  }
  if (
    input.source !== "calendar" &&
    input.source !== "card-stage" &&
    input.source !== "notification" &&
    input.source !== "api"
  ) {
    throw new Error("Missing or invalid occurrence source");
  }
}

function assertValidOccurrenceCompleteIpcInput(
  input: CardOccurrenceCompleteInput,
): void {
  assertValidOccurrenceIpcInput(input);
  if (
    typeof input.createdCardId !== "string" ||
    input.createdCardId.length === 0 ||
    input.createdCardId !== input.createdCardId.trim()
  ) {
    throw new Error("Missing or invalid occurrence createdCardId");
  }
}

function assertValidOccurrenceUpdateIpcInput(
  input: CardOccurrenceUpdateInput,
): void {
  assertValidOccurrenceIpcInput(input);
  if (
    input.scope !== "this" &&
    input.scope !== "this-and-future" &&
    input.scope !== "all"
  ) {
    throw new Error("Missing or invalid occurrence scope");
  }
  if (input.scope === "all" && "createdCardId" in input) {
    throw new Error("Occurrence scope all must not include createdCardId");
  }
  if (
    input.scope !== "all" &&
    (typeof input.createdCardId !== "string" ||
      input.createdCardId.length === 0 ||
      input.createdCardId !== input.createdCardId.trim())
  ) {
    throw new Error("Missing or invalid occurrence createdCardId");
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
  ensureBrowserSidebarEventBridge();
  const documentSyncHub = options.documentSyncHub ?? defaultDocumentSyncHub;

  const gitBranchWatches = new Map<
    number,
    { cwd: string; dispose: () => void }
  >();
  const gitBranchWatchCleanupBound = new Set<number>();

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
  registerHandle("codex:dynamic-tool-call:respond", (_, requestId: string) =>
    codexService.respondToDynamicToolCall(requestId),
  );

  registerHandle("document-sync:subscribe", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.subscribe(target, request);
  });
  registerHandle("block-reference:card:resolve", (_, input) =>
    resolveProjectScopedCardReference(input),
  );
  registerHandle("database-view:reference:get", (_, input) =>
    readProjectScopedDatabaseViewReference(input),
  );
  registerHandle(
    "block-document:owned:get",
    async (_, projectId, ownerBlockId) =>
      (
        await blockMutationWriter.getOwnedDocumentDescriptor(
          projectId,
          ownerBlockId,
        )
      ).result,
  );
  registerHandle(
    "block-document:owned:prepare",
    async (_, projectId, ownerBlockId) =>
      await blockMutationWriter.prepareOwnedBlockDocument(
        projectId,
        ownerBlockId,
      ),
  );
  registerHandle("document-sync:unsubscribe", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.unsubscribe(target, request);
  });
  registerHandle("document-sync:sync", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.sync(target, request);
  });
  registerHandle("document-sync:apply", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.applyUpdate(target, request);
  });
  registerHandle("canvas-scene:subscribe", (event, request) => {
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
    return documentSyncHub.subscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:unsubscribe", (event, request) => {
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
    return documentSyncHub.unsubscribeCanvasScene(target, request);
  });
  registerHandle("canvas-scene:sync", (event, request) => {
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
    return documentSyncHub.syncCanvasScene(target, request);
  });
  registerHandle("canvas-scene:apply", (event, request) => {
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
    return documentSyncHub.applyCanvasSceneMutation(target, request);
  });
  registerHandle("document-sync:awareness:publish", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.publishAwareness(target, request);
  });
  registerHandle("document-sync:relocation-lease:respond", (event, request) => {
    const target = resolveDocumentSyncTarget(event);
    if (!target) {
      return documentSyncUnauthorized();
    }
    return documentSyncHub.respondToRelocationLease(target, request);
  });
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

  registerCardMetadataPropertySnapshotIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, cardBlockId) =>
        listener(event, projectId, cardBlockId),
      );
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    readSnapshot: (projectId, cardBlockId) =>
      readCardMetadataPropertySnapshot(getDb(), projectId, cardBlockId),
  });

  registerDatabaseKernelIpcHandlers({
    registerHandle: (channel, listener) => {
      if (
        channel === DATABASE_CATALOG_IPC_CHANNEL ||
        channel === DATABASE_MANAGEMENT_IPC_CHANNEL ||
        channel === PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL ||
        channel === PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL
      ) {
        registerHandle(channel, (event, projectId) =>
          listener(event, projectId) as
            | IpcApi[typeof channel]["result"]
            | Promise<IpcApi[typeof channel]["result"]>,
        );
        return;
      }
      registerHandle(channel, (event, projectId, value) =>
        listener(event, projectId, value) as
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
        clientSessionId: clientId,
        actor: { kind: "electron_renderer", clientId },
      };
    },
    applyMutation: async (request) =>
      (await blockMutationWriter.applyDatabaseMutation(request)).result,
    readDescriptor: async (projectId, databaseBlockId) =>
      (
        await blockMutationWriter.readDatabaseDescriptor(
          projectId,
          databaseBlockId,
        )
      ).result,
    readCatalog: async (projectId) =>
      (await blockMutationWriter.readDatabaseCatalog(projectId)).result,
    readManagement: async (projectId) =>
      (await blockMutationWriter.readDatabaseManagement(projectId)).result,
    readPrimaryDescriptor: async (projectId) =>
      (await blockMutationWriter.readPrimaryDatabaseDescriptor(projectId))
        .result,
    readPrimaryViewSnapshot: async (projectId) =>
      (await blockMutationWriter.readPrimaryDatabaseViewSnapshot(projectId))
        .result,
    readViewSnapshot: async (projectId, viewId) =>
      (await blockMutationWriter.readDatabaseViewSnapshot(projectId, viewId))
        .result,
    queryView: async (projectId, viewId) =>
      (await blockMutationWriter.queryDatabaseView(projectId, viewId)).result,
  });

  registerCardLifecyclePreflightIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, projectId, cardId) =>
        listener(event, projectId, cardId),
      );
    },
    readPreflight: async (projectId, cardId) =>
      (await blockMutationWriter.readCardLifecyclePreflight(projectId, cardId))
        .result,
  });

  registerCardLifecycleIpcHandler({
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
      (await blockMutationWriter.applyCardLifecycleMutation(request)).result,
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
      documentSyncHub.applyAdditionalDocumentCommand(request),
  });

  registerCardProjectTransferIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, sourceProjectId, intent) =>
        listener(event, sourceProjectId, intent),
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
    transfer: (intent) => documentSyncHub.transferCardProject(intent),
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
    transfer: (intent) => documentSyncHub.transferBlocks(intent),
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
      blockMutationWriter.createDocumentVersionCheckpoint(request),
    listVersions: (request) => blockMutationWriter.listDocumentVersions(request),
    getVersion: (request) => blockMutationWriter.getDocumentVersion(request),
    restoreVersion: (request) =>
      documentSyncHub.applyDocumentMutation(request),
  });

  registerCardHistoryIpcHandler({
    registerHandle: (channel, listener) => {
      registerHandle(channel, (event, request) => listener(event, request));
    },
    isTrustedEvent: (rawEvent) =>
      resolveDocumentSyncTarget(rawEvent as IpcMainInvokeEvent) !== null,
    listHistory: (request) => blockMutationWriter.listCardHistory(request),
  });

  registerHandle("persisted-atom:sync-request", () => readPersistedAtomState());
  registerHandle("persisted-atom:update", (_, update) => {
    const state = updatePersistedAtom(update);
    safeBroadcastToWindows(
      BrowserWindow.getAllWindows(),
      "persisted-atom:updated",
      [update],
    );
    return state;
  });

  // Projects
  registerHandle("projects:list", () => projectsStore.listProjects());

  registerHandle("projects:get", (_, projectId: string) =>
    projectsStore.getProject(projectId),
  );

  registerHandle("projects:create", (_, input) =>
    projectsStore.createProject(input),
  );

  registerHandle("projects:update", (_, projectId: string, updates) =>
    projectsStore.updateProject(projectId, updates),
  );

  registerHandle("projects:reorder", (_, input) =>
    projectsStore.reorderProjects(input),
  );

  registerHandle("projects:set-pinned", (_, projectId: string, input) =>
    projectsStore.setProjectPinned(projectId, input),
  );

  registerHandle("projects:set-pinned-order", (_, input) =>
    projectsStore.setPinnedProjectOrder(input),
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
    await projectDeletionRuntime.deleteProject(projectId),
  );

  // Project sessions
  registerHandle(
    "project-sessions:list",
    (_, projectId: string | null, options) => {
      const startedAt = getDevRuntimeMetricStart();
      const sessions = projectSessionService.listProjectSessions(
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
    (_, projectId: string | null, options) => {
      const startedAt = getDevRuntimeMetricStart();
      const sessions = projectSessionService.listProjectSessionSummaries(
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

  registerHandle("project-sessions:get", (_, sessionId: string) => {
    const startedAt = getDevRuntimeMetricStart();
    const session = projectSessionService.getProjectSession(sessionId);
    logDevRuntimeMetric("ipc.project_sessions_get", {
      sessionId,
      found: session !== null,
      tabCount: session?.tabs.length ?? 0,
      approxPayloadBytes: approximateJsonPayloadBytes(session),
      durationMs: getDevRuntimeMetricDurationMs(startedAt),
    });
    return session;
  });

  registerHandle("project-sessions:create", (_, input) => {
    const session = projectSessionService.createProjectSession(input);
    dbNotifier.notifyProjectSessionsChanged(
      session.projectId,
      "create",
      session.id,
    );
    return session;
  });

  registerHandle("project-sessions:update", (_, sessionId: string, input) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    const session = projectSessionService.updateProjectSession(
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
      getProjectSession: projectSessionService.getProjectSession,
      updateProjectSession: projectSessionService.updateProjectSession,
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

  registerHandle("project-sessions:delete", (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    const success = projectSessionService.deleteProjectSession(sessionId);
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
    (_, projectId: string, orderedSessionIds: string[]) => {
      const sessions = projectSessionService.reorderProjectSessions(
        projectId,
        orderedSessionIds,
      );
      dbNotifier.notifyProjectSessionsChanged(projectId, "reorder");
      return sessions;
    },
  );

  registerHandle(
    "project-sessions:set-pinned",
    (_, sessionId: string, input) => {
      const session = projectSessionService.setProjectSessionPinned(
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
    (_, projectId: string, input) => {
      const sessions = projectSessionService.setPinnedProjectSessionOrder(
        projectId,
        input,
      );
      dbNotifier.notifyProjectSessionsChanged(projectId, "pin");
      return sessions;
    },
  );

  registerHandle("project-sessions:archive", async (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.archiveProjectSession(sessionId);
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
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.unarchiveProjectSession(sessionId);
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
    (_, sessionId: string, input) => {
      const session = projectSessionService.markProjectSessionUnread(
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
      dbNotifier.notifyProjectSessionsChanged(
        result.session.projectId,
        "create",
        result.session.id,
      );
      return result;
    },
  );

  registerHandle("project-session-tabs:create", (_, input) =>
    projectSessionService.createProjectSessionTab(input),
  );

  registerHandle("project-session-tabs:update", (_, tabId: string, input) =>
    projectSessionService.updateProjectSessionTab(tabId, input),
  );

  registerHandle(
    "project-session-panels:update",
    (_, sessionId: string, panelId, input) =>
      projectSessionService.updateProjectSessionPanel(
        sessionId,
        panelId,
        input,
      ),
  );

  registerHandle("project-session-panels:split", (_, input) =>
    projectSessionService.splitProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:ensure-right-leaf", (_, input) =>
    projectSessionService.ensureProjectSessionPanelLeafToRight(input),
  );

  registerHandle("project-session-panels:merge", (_, input) =>
    projectSessionService.mergeProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:activate", (_, input) =>
    projectSessionService.activateProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:resize", (_, input) =>
    projectSessionService.resizeProjectSessionPanelGroup(input),
  );

  registerHandle("project-session-panels:maximize", (_, input) =>
    projectSessionService.maximizeProjectSessionPanelGroup(input),
  );

  registerHandle(
    "project-session-tabs:state:update",
    (_, tabId: string, stateKey: number, state) =>
      projectSessionService.updateProjectSessionTabState(
        tabId,
        stateKey,
        state,
      ),
  );

  registerHandle("project-session-tabs:delete", (_, input) =>
    projectSessionService.deleteProjectSessionTab(input),
  );

  registerHandle("project-session-tabs:reorder", (_, input) =>
    projectSessionService.reorderProjectSessionTabs(input),
  );

  registerHandle("project-session-tabs:move", (_, input) =>
    projectSessionService.moveProjectSessionTab(input),
  );

  registerHandle("project-session-threads:attach", (_, input) => {
    const link = projectSessionService.upsertProjectSessionThreadLink(input);
    dbNotifier.notifyProjectSessionsChanged(
      link.projectId,
      "link",
      link.sessionId,
    );
    return link;
  });

  registerHandle("project-session-threads:detach", (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    const success = projectSessionService.detachProjectSessionThread(sessionId);
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
    const board = await boardReadModel.getBoardSummary(projectId);
    ipcPayloadLogger.info("board summary payload served", {
      channel: "board:summary:get",
      projectId,
      cardCount: boardCardCount(board),
      approxPayloadBytes: approximateJsonPayloadBytes(board),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return board;
  });

  // Cards
  registerHandle("cards:details:get", async (_, projectId, input) => {
    const startedAt = performance.now();
    const cards = await boardReadModel.getCardsDetails(projectId, input);
    ipcPayloadLogger.info("card details payload served", {
      channel: "cards:details:get",
      projectId,
      requestedCardCount: input.cardIds.length,
      cardCount: cards.length,
      approxPayloadBytes: approximateJsonPayloadBytes(cards),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return cards;
  });

  registerHandle("cards:search", async (_, input) => {
    const startedAt = performance.now();
    const results = await boardReadModel.searchCards(input);
    ipcPayloadLogger.info("card search payload served", {
      channel: "cards:search",
      projectCount: input.projectIds.length,
      resultCount: results.length,
      approxPayloadBytes: approximateJsonPayloadBytes(results),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return results;
  });

  registerHandle(
    "card:get",
    (_, projectId: string, cardId: string, status?: string) =>
      cardsStore.getCard(
        projectId,
        cardId,
        status as Parameters<typeof cardsStore.getCard>[2],
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
      cardOccurrences
        .listCalendarOccurrences(projectId, windowStart, windowEnd, searchQuery)
        .then((occurrences) => ({ occurrences })),
  );

  registerHandle(
    "card:occurrence:complete",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceCompleteIpcInput(input);
      const envelope = await blockMutationWriter.completeCardOccurrence(
        projectId,
        input,
        sessionId,
      );
      return envelope.result;
    },
  );

  registerHandle(
    "card:occurrence:skip",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceIpcInput(input);
      const envelope = await blockMutationWriter.skipCardOccurrence(
        projectId,
        input,
        sessionId,
      );
      return envelope.result;
    },
  );

  registerHandle(
    "card:occurrence:update",
    async (_, projectId: string, input, sessionId?: string) => {
      assertValidOccurrenceUpdateIpcInput(input);
      const envelope = await blockMutationWriter.updateCardOccurrence(
        projectId,
        input,
        sessionId,
      );
      return envelope.result;
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

  // Backups
  registerHandle("backup:list", () => backupService.listBackups());

  registerHandle("backup:create", (_, input) =>
    backupService.createBackup({ trigger: "manual", label: input?.label }),
  );

  registerHandle("backup:delete", (_, backupId: string) =>
    backupService.deleteBackup(backupId),
  );

  registerHandle("backup:restore", (_, input) =>
    backupService.restoreBackup(input),
  );

  registerHandle("settings:backup:get", () => getBackupSettings());

  registerHandle("settings:backup:update", (_, input) => {
    const settings = updateBackupSettings(input);
    backupService.configureAutoBackupScheduler({
      enabled: settings.autoEnabled,
      intervalHours: settings.intervalHours,
      retentionCount: settings.retentionCount,
    });
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

  registerHandle("workspace-directory-entries", (_, input) =>
    listWorkspaceDirectoryEntries(input),
  );

  registerHandle("remote-workspace-directory-entries", (_, input) =>
    listWorkspaceDirectoryEntries(input),
  );

  registerHandle("read-file", (_, input) => readWorkspaceFile(input));

  registerHandle("read-file-metadata", (_, input) =>
    readWorkspaceFileMetadata(input),
  );

  registerHandle("read-file-binary", (_, input) =>
    readWorkspaceFileBinary(input),
  );

  registerHandle("write-file", (_, input) => writeWorkspaceFile(input));

  registerHandle("paths-exist", (_, input) => readWorkspacePathsExist(input));

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

  registerHandle("git:review:file-contents", (_, input) => {
    return readGitReviewFileContents(input);
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

  registerHandle("codex:dictation:state:read", () =>
    codexService.readDictationStateSnapshot(),
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

  registerHandle("codex:threads:pinned:list", () =>
    codexService.listPinnedThreads(),
  );

  registerHandle("codex:threads:pinned:set", (_, threadId: string, input) =>
    codexService.setThreadPinned(threadId, input.pinned),
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
    runScheduledAutomationNow: (input) =>
      codexService.runScheduledAutomationNow(input),
    captureAutomationArchiveMessages: (threadId) =>
      codexService.captureAutomationArchiveMessages(threadId),
    unarchiveThread: (threadId) => codexService.unarchiveThread(threadId),
    broadcastScheduledAutomationChanged,
    broadcastAutomationRunsUpdated: (event) => {
      broadcastIpcEvent("codex:automation-runs:updated", event);
    },
    onHeartbeatAutomationsEnabledChanged:
      options.onHeartbeatAutomationsEnabledChanged,
    onHeartbeatAutomationThreadStateChanged:
      options.onHeartbeatAutomationThreadStateChanged,
  });

  registerHandle("codex:model:list", () => codexService.listModels());

  registerHandle("codex:collaboration-mode:list", () =>
    codexService.listCollaborationModes(),
  );

  registerHandle(
    "codex:thread:start-for-session",
    async (
      event,
      input: {
        projectId: string;
        sessionId: string;
        prompt: string;
        promptInput?: CodexPromptInput;
        threadGoalDraft?: {
          objective: string;
          attachmentDirectory?: string | null;
        };
        threadName?: string;
        skipAutoTitleGeneration?: boolean;
        model?: string;
        serviceTier?: null | "fast";
        permissionMode?:
          "auto" | "guardian-approvals" | "full-access" | "custom";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        collaborationMode?: "default" | "plan";
        runInTarget?: "localProject" | "newWorktree" | "cloud";
        runInEnvironmentPath?: string | null;
        worktreeStartMode?: "autoBranch" | "detachedHead";
        worktreeBranchPrefix?: string;
        heartbeatAutomation?: {
          name: string;
          prompt: string;
          rrule: string;
        } | null;
      },
    ) => {
      const detail = await codexService.startThreadForSession(input);
      return detail;
    },
  );

  registerHandle(
    "codex:thread:side-chat:start",
    (
      _,
      input: {
        projectId: string;
        parentThreadId: string;
        parentNavigationPath?: string | null;
        prompt?: string;
        promptInput?: CodexPromptInput;
        model?: string;
        serviceTier?: null | "fast";
        permissionMode?:
          "auto" | "guardian-approvals" | "full-access" | "custom";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        collaborationMode?: "default" | "plan";
      },
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

  registerHandle("codex:thread:resume:request", (_, threadId: string) =>
    codexService.requestRendererConversationResume(threadId),
  );

  registerHandle(
    "codex:thread:background-subagents:hydrate",
    (_, input: CodexBackgroundSubagentThreadsHydrateInput) =>
      codexService.hydrateBackgroundSubagentThreads(input),
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
    (_, threadId: string, collaborationMode: "default" | "plan") =>
      codexService.setConversationCollaborationMode(
        threadId,
        collaborationMode,
      ),
  );

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
      opts?: {
        model?: string;
        serviceTier?: null | "fast";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        permissionMode?:
          "auto" | "guardian-approvals" | "full-access" | "custom";
        collaborationMode?: "default" | "plan";
        promptInput?: CodexPromptInput;
      },
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
      opts?: {
        model?: string;
        serviceTier?: null | "fast";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        permissionMode?:
          "auto" | "guardian-approvals" | "full-access" | "custom";
        collaborationMode?: "default" | "plan";
        promptInput?: CodexPromptInput;
      },
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
    materializeThreadGoalDraft({
      attachmentsRoot: getThreadGoalAttachmentsRoot(app.getPath("userData")),
      draft,
    }),
  );

  registerHandle(
    "codex:thread:goal:materialized-cleanup",
    (_, attachmentDirectory) =>
      removeOwnedThreadGoalAttachmentDirectory(
        attachmentDirectory,
        getThreadGoalAttachmentsRoot(app.getPath("userData")),
      ),
  );

  registerHandle("codex:thread:goal:editable-objective:read", (_, objective) =>
    readThreadGoalEditableObjective({
      attachmentsRoot: getThreadGoalAttachmentsRoot(app.getPath("userData")),
      objective,
    }),
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

  registerHandle("codex:mcp-apps:list", (_, threadId?: string | null) =>
    codexService.listMcpApps(threadId),
  );

  registerHandle(
    "codex:mcp-server-statuses:list",
    (_, threadId?: string | null) =>
      codexService.listMcpServerStatuses(threadId),
  );

  registerHandle("codex:approval:respond", (_, requestId: string, decision) =>
    codexService.respondToApproval(requestId, decision),
  );

  registerHandle("codex:user-input:respond", (_, requestId: string, answers) =>
    codexService.respondToUserInput(requestId, answers),
  );

  registerHandle(
    "codex:mcp-elicitation:respond",
    (_, requestId: string, response) =>
      codexService.respondToMcpServerElicitation(requestId, response),
  );

  registerHandle(
    "codex:permission-request:respond",
    (_, requestId: string, response) =>
      codexService.respondToPermissionRequest(requestId, response),
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
