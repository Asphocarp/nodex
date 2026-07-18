import {
  Menu,
  Notification,
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions,
} from "electron";
import { join, resolve } from "path";
import type {
  AppInitializationStep,
  DatabaseMigrationProgress,
} from "../shared/app-startup";
import type { AppUpdateStatus } from "../shared/types";
import { registerIpcHandlers } from "./ipc-handlers";
import { startHttpServer } from "./http-server";
import { findPageLocationById } from "./local-store/database-pages";
import { getDb, initializeDatabase } from "./local-store/database";
import * as projectSessionService from "./local-store/project-sessions";
import { dbNotifier } from "./local-store/notifier";
import {
  configureAutoBackupScheduler,
  stopAutoBackupScheduler,
} from "./local-store/backups";
import { getAssetsPathPrefix } from "./local-store/assets";
import { runReminderTick, snoozeReminder, startReminderScheduler } from "./local-store/reminders";
import { terminalManager } from "./terminal-manager";
import { blockMutationWriter } from "./block-mutation-writer";
import { startBlockDocumentCompactionScheduler } from "./block-document-compaction-scheduler";
import { createBlockDocumentCompactionRuntime } from "./block-document-compaction-runtime";
import {
  startBlockRetentionMaintenanceScheduler,
  type BlockRetentionMaintenanceScheduler,
} from "./block-retention-maintenance-scheduler";
import {
  startDocumentRevisionMaintenanceScheduler,
  type DocumentRevisionMaintenanceScheduler,
} from "./document-revision-maintenance-scheduler";
import { DOCUMENT_REVISION_MAINTENANCE_VERSION } from "../shared/block-documents/document-revision-maintenance";
import { readBlockStoreEpoch } from "./local-store/block-store-metadata";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getCommandKeymapState,
  getHistorySettings,
  getNodexHome,
  getWindowRestoreSettings,
  getPort,
} from "./local-store/config";
import { codexService } from "./codex/codex-service";
import { NodexAgentAuthorizationBroker } from "./agent-tools/authorization-broker";
import {
  startCodexScheduledAutomationScheduler,
  type CodexScheduledAutomationScheduler,
} from "./codex-scheduled-automation-scheduler";
import { DesktopNotificationManager } from "./desktop-notification-manager";
import { parsePageDeepLink, parseSessionDeepLink } from "../shared/page-deeplink";
import {
  isWindowSessionBoundsVisible,
  WindowSessionState,
} from "./window-session-state";
import type {
  WindowSessionBounds,
  WindowSessionRecord,
  WindowSessionSeed,
} from "../shared/window-session";
import { getLogger, shutdownBackendLogger } from "./logging/logger";
import { AppUpdateService } from "./app-update-service";
import { resolveCodexTitleBarOptions } from "./window-navigation-chrome";
import {
  CLOSE_PANEL_TAB_HOST_CHANNEL,
  CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL,
  CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL,
  NAVIGATE_BACK_HOST_CHANNEL,
  NAVIGATE_FORWARD_HOST_CHANNEL,
  WORKBENCH_CONTENT_SEARCH_COMMAND,
  WORKBENCH_THREAD_RENAME_COMMAND,
  WORKBENCH_SIDEBAR_TOGGLE_COMMAND,
  type WorkbenchContentSearchHostChannel,
  type WorkbenchPanelTabCloseHostChannel,
  type WorkbenchPanelTabCycleHostChannel,
  type WorkbenchThreadRenameHostChannel,
  type WorkbenchSidebarToggleHostChannel,
  type WorkbenchNavigationHostChannel,
} from "../shared/window-navigation";
import {
  EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL,
  type WorkbenchCommandInvocation,
} from "../shared/workbench-commands";
import {
  BROWSER_SIDEBAR_PARTITION,
  parseBrowserSidebarRoutePartition,
} from "../shared/browser-sidebar";
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import { collectSecondInstancesForStartupReplay } from "./main-runtime-startup-events";
import {
  captureMainException,
  captureMainMessage,
  shutdownMainSentry,
} from "./observability/sentry-main";
import { recordDevRuntimeMetricCounter } from "./dev-runtime-metrics";
import {
  getPrimaryCommandAccelerator,
  toElectronAccelerator,
} from "../shared/command-keybindings";
import {
  safeBroadcastToWindows,
  safeSendToWebContents,
  safeSendToWindow,
} from "./ipc-safe-send";
import {
  RendererClientRouter,
  type RendererClientRegistration,
} from "./codex/renderer-client-router";
import {
  resolveElectronWindowBackdrop,
  shouldUseOpaqueElectronWindowSurface,
} from "./electron-window-backdrop";
import { buildWorkbenchViewMenu } from "./application-menu";
import { shouldGrantAppRendererPermission } from "./renderer-permissions";
// macOS uses the packaged bundle icon from the app resources.
// We only keep a PNG around for development Dock icon parity and non-macOS window icons.
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "../../resources/icon.png");
const appDockIcon = nativeImage.createFromPath(appIconPath);

const openWindows = new Map<number, BrowserWindow>();
let lastFocusedWindowId: number | null = null;
let serverUrlForWindows: string | null = null;
let stopReminderScheduler: (() => void) | null = null;
let databaseReady = false;
let pendingPageDeepLinkPageId: string | null = null;
let pendingPageDeepLinkTarget: { projectId: string; pageId: string } | null = null;
let pendingSessionDeepLinkSessionId: string | null = null;
let pendingSessionDeepLinkTarget: { projectId: string | null; sessionId: string } | null = null;
const pendingCloseResolvers = new Map<number, () => void>();
const allowImmediateWindowClose = new Set<number>();
const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 1500;
let windowSessionState: WindowSessionState | null = null;
let appQuitRequested = false;
let lastClosedWindowSessionId: string | null = null;
let appInitializationStep: AppInitializationStep = { phase: "app_waiting" };
let latestDatabaseMigrationProgress: DatabaseMigrationProgress | null = null;
let appInitializationPromise: Promise<void> = Promise.resolve();
let appUpdateService: AppUpdateService | null = null;
let scheduledAutomationScheduler: CodexScheduledAutomationScheduler | null = null;
let blockRetentionMaintenanceScheduler: BlockRetentionMaintenanceScheduler | null = null;
let documentRevisionMaintenanceScheduler: DocumentRevisionMaintenanceScheduler | null = null;
let appPermissionHandlersRegistered = false;
let rendererClientRouter: RendererClientRouter | null = null;
const desktopNotificationManager = new DesktopNotificationManager();
const logger = getLogger({ subsystem: "app" });
const blockDocumentCompactionRuntime = createBlockDocumentCompactionRuntime(
  () =>
    startBlockDocumentCompactionScheduler({
      writer: blockMutationWriter,
      readStoreEpoch: () => readBlockStoreEpoch(getDb()),
      onResult: (result) => {
        if (result.selectedDocumentCount === 0) return;
        logger.info("Block Document compaction pass completed", {
          documentCount: result.selectedDocumentCount,
          updateCount: result.selectedUpdateCount,
          updateBytes: result.selectedUpdateBytes,
        });
      },
      onError: (error) => {
        logger.warn("Block Document compaction pass deferred", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }),
);

const startBlockRetentionMaintenanceRuntime = (): void => {
  if (blockRetentionMaintenanceScheduler) return;
  blockRetentionMaintenanceScheduler = startBlockRetentionMaintenanceScheduler({
    writer: blockMutationWriter,
    readStoreEpoch: () => readBlockStoreEpoch(getDb()),
    readRetentionCount: () => getHistorySettings().retentionCount,
    onResult: (result) => {
      if (
        result.collectedCandidateCount === 0 &&
        result.coveredCandidateCount === 0 &&
        result.retainedCandidateCount === 0 &&
        result.failedCandidateCount === 0
      ) {
        return;
      }
      logger.info("Block retention maintenance pass completed", {
        collectedCandidateCount: result.collectedCandidateCount,
        coveredCandidateCount: result.coveredCandidateCount,
        retainedCandidateCount: result.retainedCandidateCount,
        failedCandidateCount: result.failedCandidateCount,
        collectedBlockCount: result.collectedBlockCount,
      });
    },
    onError: (error) => {
      logger.warn("Block retention maintenance pass deferred", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
};

const startDocumentRevisionMaintenanceRuntime = (): void => {
  if (documentRevisionMaintenanceScheduler) return;
  documentRevisionMaintenanceScheduler =
    startDocumentRevisionMaintenanceScheduler({
      writer: blockMutationWriter,
      readStoreEpoch: () => readBlockStoreEpoch(getDb()),
      onResult: (result) => {
        if (
          result.finalizedDocumentCount === 0 &&
          result.alreadyCoveredDocumentCount === 0 &&
          result.staleSessionCount === 0 &&
          result.failedDocumentCount === 0
        ) {
          return;
        }
        if (result.failedDocumentCount > 0) {
          logger.warn("Document revision maintenance pass was incomplete", result);
          return;
        }
        logger.info("Document revision maintenance pass completed", result);
      },
      onError: (error) => {
        logger.warn("Document revision maintenance pass deferred", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
};
const electronWindowOpaqueSurfaceModes = new Map<number, boolean>();

function shouldManageElectronWindowBackdrop(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function applyElectronWindowBackdrop(window: BrowserWindow, force = false): void {
  if (!shouldManageElectronWindowBackdrop()) return;
  if (window.isDestroyed()) return;

  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const opaqueWindowSurfaceEnabled = shouldUseOpaqueElectronWindowSurface({
    bounds,
    isFocused: window.isFocused(),
    platform: process.platform,
    scaleFactor: display.scaleFactor,
  });

  if (!force && electronWindowOpaqueSurfaceModes.get(window.id) === opaqueWindowSurfaceEnabled) {
    return;
  }

  const backdrop = resolveElectronWindowBackdrop({
    opaqueWindowSurfaceEnabled,
    platform: process.platform,
    prefersDarkColors: nativeTheme.shouldUseDarkColors,
  });

  try {
    window.setBackgroundColor(backdrop.backgroundColor);
    if (process.platform === "darwin") {
      window.setVibrancy(backdrop.vibrancy as Parameters<BrowserWindow["setVibrancy"]>[0]);
    }
    if (process.platform === "win32") {
      window.setBackgroundMaterial(
        backdrop.backgroundMaterial as Parameters<BrowserWindow["setBackgroundMaterial"]>[0],
      );
    }
    electronWindowOpaqueSurfaceModes.set(window.id, opaqueWindowSurfaceEnabled);
    safeSendToWindow(window, "electron-window-opaque-surface-changed", [
      { opaqueWindowSurfaceEnabled },
    ]);
  } catch (error) {
    logger.warn("Failed to apply Electron window backdrop", {
      error: error instanceof Error ? error.message : String(error),
      windowId: window.id,
    });
  }
}

function resolveUnsupportedAppUpdateStatus(): AppUpdateStatus {
  return {
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
    message: "App updates are only available in packaged macOS builds.",
  };
}

function getLastFocusedWindow(): BrowserWindow | null {
  if (lastFocusedWindowId !== null) {
    const remembered = openWindows.get(lastFocusedWindowId);
    if (remembered && !remembered.isDestroyed()) return remembered;
  }

  for (const window of openWindows.values()) {
    if (window.isDestroyed()) continue;
    return window;
  }

  return null;
}

function focusLastWindow(): void {
  const existingWindow = getLastFocusedWindow();
  if (existingWindow) {
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.show();
    existingWindow.focus();
    return;
  }

  if (!serverUrlForWindows) return;
  const session = createWindowSession();
  const createdWindow = createWindow(serverUrlForWindows, { session });
  createdWindow.show();
  createdWindow.focus();
}

function createWindowSession(seed?: WindowSessionSeed): WindowSessionRecord {
  if (!windowSessionState) {
    throw new Error("Window session state is unavailable");
  }
  return windowSessionState.createSession(seed);
}

function openNewWindow(seed?: WindowSessionSeed): BrowserWindow | null {
  if (!serverUrlForWindows) return null;
  const session = createWindowSession(seed);
  const window = createWindow(serverUrlForWindows, { session });
  window.show();
  window.focus();
  return window;
}

function captureWindowSessionBounds(window: BrowserWindow): WindowSessionBounds {
  const bounds = window.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    mode: window.isFullScreen() ? "fullscreen" : window.isMaximized() ? "maximized" : "normal",
  };
}

function syncMacWindowTitle(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  if (window.isDestroyed()) return;
  window.setTitle("Nodex");
}

async function requestHostMicrophonePermission(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const currentStatus = systemPreferences.getMediaAccessStatus("microphone");
  if (currentStatus === "granted") {
    return;
  }

  try {
    await systemPreferences.askForMediaAccess("microphone");
  } catch (error) {
    logger.warn("Could not request macOS microphone permission", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function configureApplicationMenus(
  commandKeymapState = getCommandKeymapState(),
): void {
  const menuAccelerator = (commandId: string): string | undefined => {
    return toElectronAccelerator(getPrimaryCommandAccelerator(commandKeymapState, commandId));
  };

  const dockMenuTemplate: MenuItemConstructorOptions[] = [
    {
      label: "New Window",
      accelerator: menuAccelerator("newWindow"),
      click: () => {
        openNewWindow();
      },
    },
  ];
  app.dock?.setMenu(Menu.buildFromTemplate(dockMenuTemplate));

  const sendWorkbenchCommand = (invocation: WorkbenchCommandInvocation) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
    safeSendToWindow(targetWindow, EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL, [invocation]);
  };

  const sendNavigationMessage = (
    channel:
      | WorkbenchNavigationHostChannel
      | WorkbenchSidebarToggleHostChannel
      | WorkbenchThreadRenameHostChannel
      | WorkbenchContentSearchHostChannel
      | WorkbenchPanelTabCycleHostChannel
      | WorkbenchPanelTabCloseHostChannel,
  ) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
    safeSendToWindow(targetWindow, channel);
  };

  const closeFocusedWindow = () => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
    if (!targetWindow || targetWindow.isDestroyed()) return;
    targetWindow.close();
  };

  const appMenuTemplate: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{
      role: "appMenu",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => {
            void appUpdateService?.checkForUpdates("manual");
          },
        },
      ],
    } satisfies MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: menuAccelerator("newWindow"),
          click: () => {
            openNewWindow();
          },
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: menuAccelerator("closeWindow"),
          click: closeFocusedWindow,
        },
      ],
    },
    { role: "editMenu" },
    {
      label: "Navigate",
      submenu: [
        {
          label: "Back",
          accelerator: menuAccelerator("navigateBack"),
          click: () => {
            sendNavigationMessage(NAVIGATE_BACK_HOST_CHANNEL);
          },
        },
        {
          label: "Forward",
          accelerator: menuAccelerator("navigateForward"),
          click: () => {
            sendNavigationMessage(NAVIGATE_FORWARD_HOST_CHANNEL);
          },
        },
        { type: "separator" },
        {
          label: WORKBENCH_CONTENT_SEARCH_COMMAND.label,
          accelerator: menuAccelerator(WORKBENCH_CONTENT_SEARCH_COMMAND.id),
          click: () => {
            sendNavigationMessage(WORKBENCH_CONTENT_SEARCH_COMMAND.hostChannel);
          },
        },
        { type: "separator" },
        {
          label: "Previous Panel Tab",
          accelerator: "CommandOrControl+Shift+[",
          click: () => {
            sendNavigationMessage(CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL);
          },
        },
        {
          label: "Next Panel Tab",
          accelerator: "CommandOrControl+Shift+]",
          click: () => {
            sendNavigationMessage(CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL);
          },
        },
        {
          label: "Close Panel Tab",
          accelerator: menuAccelerator("closeTab"),
          click: () => {
            sendNavigationMessage(CLOSE_PANEL_TAB_HOST_CHANNEL);
          },
        },
        { type: "separator" },
        {
          label: WORKBENCH_SIDEBAR_TOGGLE_COMMAND.label,
          accelerator: menuAccelerator("toggleSidebar"),
          click: () => {
            sendNavigationMessage(WORKBENCH_SIDEBAR_TOGGLE_COMMAND.hostChannel);
          },
        },
        {
          label: WORKBENCH_THREAD_RENAME_COMMAND.label,
          accelerator: menuAccelerator("renameThread"),
          click: () => {
            sendNavigationMessage(WORKBENCH_THREAD_RENAME_COMMAND.hostChannel);
          },
        },
      ],
    },
    buildWorkbenchViewMenu(commandKeymapState, sendWorkbenchCommand),
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));
}

function broadcastToWindows(channel: string, payload: unknown): void {
  safeBroadcastToWindows(openWindows.values(), channel, [payload]);
}

function setAppInitializationStep(step: AppInitializationStep): void {
  appInitializationStep = step;
  broadcastToWindows("app:init-step", step);
}

function broadcastAppUpdateStatus(status: AppUpdateStatus): void {
  broadcastToWindows("app:update-status", status);
}

function maybeStartAutomaticAppUpdateChecks(): void {
  if (!appUpdateService) {
    return;
  }

  if (appInitializationStep.phase !== "done" || openWindows.size === 0) {
    return;
  }

  appUpdateService.maybeStartAutomaticChecks(getAppUpdateSettings());
}

function publishDatabaseMigrationProgress(progress: DatabaseMigrationProgress): void {
  latestDatabaseMigrationProgress = progress;
  broadcastToWindows("db:migration-progress", progress);
}

function registerInitializationIpcHandlers(): void {
  ipcMain.removeHandler("app:await-initialization");
  ipcMain.handle("app:await-initialization", (event) => {
    safeSendToWebContents(event.sender, "app:init-step", [appInitializationStep]);
    if (latestDatabaseMigrationProgress) {
      safeSendToWebContents(event.sender, "db:migration-progress", [latestDatabaseMigrationProgress]);
    }
    return appInitializationPromise;
  });
}

function sendReminderOpenEvent(payload: {
  projectId: string;
  pageId: string;
  occurrenceStart: string;
}): void {
  const targetWindow = getLastFocusedWindow();
  safeSendToWindow(targetWindow, "reminder:open", [payload]);
}

function flushPendingPageDeepLink(): void {
  if (!pendingPageDeepLinkTarget) {
    return;
  }

  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.webContents.isDestroyed() || targetWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  if (safeSendToWindow(targetWindow, "deeplink:open-page", [pendingPageDeepLinkTarget])) {
    pendingPageDeepLinkTarget = null;
  }
}

function flushPendingSessionDeepLink(): void {
  if (!pendingSessionDeepLinkTarget) {
    return;
  }

  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.webContents.isDestroyed() || targetWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  if (safeSendToWindow(targetWindow, "deeplink:open-session", [pendingSessionDeepLinkTarget])) {
    pendingSessionDeepLinkTarget = null;
  }
}

function resolvePendingPageDeepLink(): void {
  if (!databaseReady) {
    return;
  }

  if (!pendingPageDeepLinkPageId) {
    flushPendingPageDeepLink();
    return;
  }

  const pageId = pendingPageDeepLinkPageId;
  const location = findPageLocationById(pageId);
  pendingPageDeepLinkPageId = null;
  if (!location) {
    return;
  }

  pendingPageDeepLinkTarget = {
    projectId: location.projectId,
    pageId,
  };

  flushPendingPageDeepLink();
}

function resolvePendingSessionDeepLink(): void {
  if (!databaseReady) {
    return;
  }

  if (!pendingSessionDeepLinkSessionId) {
    flushPendingSessionDeepLink();
    return;
  }

  const sessionId = pendingSessionDeepLinkSessionId;
  const session = projectSessionService.getProjectSession(sessionId);
  pendingSessionDeepLinkSessionId = null;
  if (!session) {
    return;
  }

  pendingSessionDeepLinkTarget = {
    projectId: session.projectId,
    sessionId,
  };

  flushPendingSessionDeepLink();
}

function queuePageDeepLink(pageId: string): void {
  pendingPageDeepLinkPageId = pageId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  resolvePendingPageDeepLink();
}

function queueSessionDeepLink(sessionId: string): void {
  pendingSessionDeepLinkSessionId = sessionId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  resolvePendingSessionDeepLink();
}

function handleIncomingDeepLink(value: string): boolean {
  const sessionTarget = parseSessionDeepLink(value);
  if (sessionTarget) {
    queueSessionDeepLink(sessionTarget.sessionId);
    return true;
  }

  const pageTarget = parsePageDeepLink(value);
  if (!pageTarget) {
    return false;
  }

  queuePageDeepLink(pageTarget.pageId);
  return true;
}

function extractDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const sessionTarget = parseSessionDeepLink(arg);
    if (sessionTarget) {
      queueSessionDeepLink(sessionTarget.sessionId);
      return arg;
    }

    const pageTarget = parsePageDeepLink(arg);
    if (!pageTarget) {
      continue;
    }

    queuePageDeepLink(pageTarget.pageId);
    return arg;
  }

  return null;
}

function registerDeepLinkProtocol(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient("nodex", process.execPath, [resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient("nodex");
}

function createWindow(
  serverUrl: string,
  options: { session: WindowSessionRecord },
): BrowserWindow {
  const shouldUseSavedBounds = isWindowSessionBoundsVisible(
    options.session.bounds,
    screen.getAllDisplays(),
  );
  const savedBounds = shouldUseSavedBounds ? options.session.bounds : undefined;
  const titleBarOptions = resolveCodexTitleBarOptions({
    platform: process.platform,
    windowZoom: 1,
    isDark: nativeTheme.shouldUseDarkColors,
  });
  const window = new BrowserWindow({
    x: savedBounds?.x,
    y: savedBounds?.y,
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform === "darwin" ? { title: "Nodex" } : {}),
    ...(process.platform === "darwin" ? {} : { icon: appIconPath }),
    ...titleBarOptions,
    ...(process.platform === "darwin"
      ? {
          vibrancy: "menu" as const,
          visualEffectState: "followWindow" as const,
          backgroundColor: "#00000000",
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
      additionalArguments: [
        `--nodex-server-url=${serverUrl}`,
        `--nodex-asset-path-prefix=${encodeURIComponent(getAssetsPathPrefix())}`,
      ],
    },
  });

  if (!appPermissionHandlersRegistered) {
    const electronSession = window.webContents.session;
    electronSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
      return shouldGrantAppRendererPermission({
        permission,
        webContentsType: webContents?.getType() ?? null,
        isMainFrame: details.isMainFrame,
      });
    });
    electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(shouldGrantAppRendererPermission({
        permission,
        webContentsType: webContents.getType(),
        isMainFrame: details.isMainFrame,
      }));
    });
    appPermissionHandlersRegistered = true;
  }

  // Open external links in the system browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const webviewParams = params as typeof params & {
      "data-browser-sidebar-browser-tab-id"?: string;
      "data-browser-sidebar-conversation-id"?: string;
      nodeintegration?: string;
      preload?: string;
      webpreferences?: string;
    };
    const routeIdentity = parseBrowserSidebarRoutePartition(params.partition);
    if (
      routeIdentity === null
      || webviewParams["data-browser-sidebar-conversation-id"]
        !== routeIdentity.browserConversationId
      || webviewParams["data-browser-sidebar-browser-tab-id"]
        !== routeIdentity.browserTabId
    ) {
      event.preventDefault();
      return;
    }
    params.partition = BROWSER_SIDEBAR_PARTITION;
    delete webviewParams.nodeintegration;
    delete webviewParams.preload;
    delete webviewParams.webpreferences;
    delete webPreferences.preload;
    delete (webPreferences as typeof webPreferences & { preloadURL?: string }).preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  // In dev mode, load the vite dev server URL
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  const webContentsId = window.webContents.id;
  openWindows.set(webContentsId, window);
  let rendererClientRegistration: RendererClientRegistration | null = null;
  if (rendererClientRouter) {
    rendererClientRegistration = rendererClientRouter.register(window.webContents);
  }
  windowSessionState?.assignWindow(webContentsId, options.session.id);
  syncMacWindowTitle(window);
  applyElectronWindowBackdrop(window, true);
  lastFocusedWindowId = webContentsId;

  const refreshWindowBackdropForTheme = () => {
    applyElectronWindowBackdrop(window, true);
  };
  nativeTheme.on("updated", refreshWindowBackdropForTheme);

  if (savedBounds?.mode === "maximized") {
    window.maximize();
  } else if (savedBounds?.mode === "fullscreen") {
    window.setFullScreen(true);
  }

  const closeHandler = (event: Electron.Event) => {
    if (allowImmediateWindowClose.has(webContentsId)) {
      allowImmediateWindowClose.delete(webContentsId);
      return;
    }

    if (pendingCloseResolvers.has(webContentsId)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    const finishClose = () => {
      pendingCloseResolvers.delete(webContentsId);
      allowImmediateWindowClose.add(webContentsId);
      windowSessionState?.updateBounds(webContentsId, captureWindowSessionBounds(window));
      const sessionId = windowSessionState?.getSessionIdForWindow(webContentsId);
      if (!appQuitRequested && openWindows.size === 1 && sessionId) {
        lastClosedWindowSessionId = sessionId;
      }
      if (window.isDestroyed()) return;
      window.close();
    };

    const timeout = setTimeout(finishClose, WINDOW_CLOSE_FLUSH_TIMEOUT_MS);
    pendingCloseResolvers.set(webContentsId, () => {
      clearTimeout(timeout);
      finishClose();
    });

    if (!safeSendToWindow(window, "app:flush-before-close", [webContentsId])) {
      finishClose();
    }
  };

  window.on("close", closeHandler);
  window.on("focus", () => {
    lastFocusedWindowId = webContentsId;
    windowSessionState?.markFocused(webContentsId);
    applyElectronWindowBackdrop(window);
    safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: true }]);
  });
  window.on("resize", () => {
    if (window.isDestroyed()) return;
    windowSessionState?.updateBounds(webContentsId, captureWindowSessionBounds(window));
    applyElectronWindowBackdrop(window);
  });
  window.on("move", () => {
    if (window.isDestroyed()) return;
    windowSessionState?.updateBounds(webContentsId, captureWindowSessionBounds(window));
    applyElectronWindowBackdrop(window);
  });
  window.on("blur", () => {
    applyElectronWindowBackdrop(window);
    safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: false }]);
  });
  window.webContents.on("did-finish-load", () => {
    syncMacWindowTitle(window);
    applyElectronWindowBackdrop(window, true);
    const appUpdateStatus = appUpdateService?.getStatus();
    if (appUpdateStatus) {
      safeSendToWindow(window, "app:update-status", [appUpdateStatus]);
    }
    flushPendingPageDeepLink();
    flushPendingSessionDeepLink();
    maybeStartAutomaticAppUpdateChecks();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logger.error("Renderer process gone", {
      webContentsId,
      reason: details.reason,
      exitCode: details.exitCode,
    });
    captureMainMessage("Renderer process gone", {
      tags: {
        reason: details.reason,
      },
      extra: {
        webContentsId,
        exitCode: details.exitCode,
      },
    });
  });
  window.on("closed", () => {
    rendererClientRegistration?.dispose();
    rendererClientRegistration = null;
    nativeTheme.off("updated", refreshWindowBackdropForTheme);
    windowSessionState?.clearWindow(webContentsId);
    pendingCloseResolvers.delete(webContentsId);
    allowImmediateWindowClose.delete(webContentsId);
    electronWindowOpaqueSurfaceModes.delete(window.id);
    openWindows.delete(webContentsId);
    if (lastFocusedWindowId === webContentsId) {
      lastFocusedWindowId = null;
    }
  });

  return window;
}

function retainRestorableWindowSessions(): void {
  if (!windowSessionState) return;

  for (const [webContentsId, window] of openWindows) {
    if (window.isDestroyed()) continue;
    windowSessionState.updateBounds(webContentsId, captureWindowSessionBounds(window));
  }

  const openSessionIds = [...openWindows.keys()]
    .map((webContentsId) => windowSessionState?.getSessionIdForWindow(webContentsId) ?? null)
    .filter((sessionId): sessionId is string => typeof sessionId === "string");

  if (openSessionIds.length > 0) {
    windowSessionState.retainSessions(openSessionIds);
    return;
  }

  if (lastClosedWindowSessionId) {
    windowSessionState.retainSessions([lastClosedWindowSessionId]);
  }
}

async function initializeDesktopApp(serverPort: number): Promise<void> {
  await initializeDatabase({
    onMigrationProgress: (progress) => {
      setAppInitializationStep({ phase: "sqlite_waiting" });
      publishDatabaseMigrationProgress(progress);
    },
  });
  blockDocumentCompactionRuntime.start();
  startBlockRetentionMaintenanceRuntime();
  startDocumentRevisionMaintenanceRuntime();
  databaseReady = true;
  resolvePendingPageDeepLink();
  resolvePendingSessionDeepLink();

  startHttpServer(serverPort);

  const backupSettings = getBackupSettings();
  configureAutoBackupScheduler({
    enabled: backupSettings.autoEnabled,
    intervalHours: backupSettings.intervalHours,
    retentionCount: backupSettings.retentionCount,
  });

  stopReminderScheduler = startReminderScheduler({
    onReminder: (payload) => {
      if (!Notification.isSupported()) return;

      const notification = new Notification({
        title: payload.title,
        body: payload.body,
        actions: [
          { type: "button", text: "Snooze 10m" },
          { type: "button", text: "Snooze 1h" },
        ],
      });

      notification.on("click", () => {
        focusLastWindow();
        sendReminderOpenEvent({
          projectId: payload.projectId,
          pageId: payload.pageId,
          occurrenceStart: payload.occurrenceStart,
        });
      });

      notification.on("action", (_, index) => {
        const minutes = index === 0 ? 10 : 60;
        void snoozeReminder(
          payload.projectId,
          payload.pageId,
          payload.occurrenceStart,
          minutes,
        );
      });

      notification.show();
    },
  });

  startRuntimeScheduledAutomationScheduler();

  powerMonitor.on("resume", () => {
    void runReminderTick((payload) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: payload.title,
        body: payload.body,
      });
      notification.on("click", () => {
        focusLastWindow();
        sendReminderOpenEvent({
          projectId: payload.projectId,
          pageId: payload.pageId,
          occurrenceStart: payload.occurrenceStart,
        });
      });
      notification.show();
    });
  });

  dbNotifier.on("board-changed", (event) => {
    broadcastToWindows("board-changed", event);
  });
  dbNotifier.on("page-target-changed", (event) => {
    broadcastToWindows("page-target-changed", event);
  });
  dbNotifier.on("page-ownership-paths-changed", (event) => {
    broadcastToWindows("page-ownership-paths-changed", event);
  });
  dbNotifier.on("database-changed", (event) => {
    broadcastToWindows("database-changed", event);
  });
  dbNotifier.on("library-navigation-changed", (event) => {
    broadcastToWindows("library-navigation-changed", event);
  });
  dbNotifier.on("project-sessions-changed", (event) => {
    recordDevRuntimeMetricCounter(
      "db.project_sessions_changed.broadcast",
      {
        projectId: event.projectId,
        changeType: event.changeType,
        sessionId: event.sessionId ?? null,
        windowCount: openWindows.size,
      },
      { groupBy: ["projectId", "changeType", "windowCount"] },
    );
    broadcastToWindows("project-sessions-changed", event);
  });
  dbNotifier.on("projects-changed", (event) => {
    broadcastToWindows("projects-changed", event);
  });

  app.on("activate", () => {
    const currentServerUrl = serverUrlForWindows;
    if (!currentServerUrl) return;
    if (openWindows.size === 0) {
      const session = createWindowSession();
      createWindow(currentServerUrl, { session });
      return;
    }
    focusLastWindow();
  });

  setAppInitializationStep({ phase: "done" });
  maybeStartAutomaticAppUpdateChecks();
}

function startRuntimeScheduledAutomationScheduler(): void {
  if (runtimeShutdownStarted) return;
  if (scheduledAutomationScheduler) return;

  scheduledAutomationScheduler = startCodexScheduledAutomationScheduler({
    runAutomation: async (automation, context) => {
      await codexService.runScheduledAutomation(automation, context);
    },
    onAutomationRunsUpdated: () => {
      codexService.notifyAutomationRunsUpdated({
        automationId: null,
        threadId: null,
        reason: "settle",
      });
    },
  });
}

export interface MainRuntimeStartupContext {
  initialArgv: string[];
  startupEvents?: BootstrapRuntimeEvent[];
}

export interface MainRuntimeController {
  handleOpenUrl(url: string): boolean;
  handleSecondInstance(argv: string[]): boolean;
  shutdown(): Promise<void>;
}

let runtimeLifecycleHandlersRegistered = false;
let runtimeShutdownStarted = false;
let runtimeShutdownCompleted = false;
let runtimeShutdownPromise: Promise<void> | null = null;
let runtimeQuitContinuationStarted = false;
const RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS = 15_000;

function handleSecondInstanceArgv(argv: string[]): boolean {
  const handledDeepLink = Boolean(extractDeepLinkFromArgv(argv));
  if (handledDeepLink) {
    return true;
  }

  if (openNewWindow()) return true;
  focusLastWindow();
  return false;
}

function collectStartupDeepLinks(context: MainRuntimeStartupContext): string[][] {
  return collectSecondInstancesForStartupReplay(context, {
    consumeArgvDeepLink: (argv) => Boolean(extractDeepLinkFromArgv(argv)),
    consumeOpenUrlDeepLink: (url) => {
      handleIncomingDeepLink(url);
    },
  });
}

function beginMainRuntimeShutdown(): void {
  if (runtimeShutdownStarted) return;
  runtimeShutdownStarted = true;
  appQuitRequested = true;
  retainRestorableWindowSessions();
  logger.info("Nodex before-quit");
  blockDocumentCompactionRuntime.dispose();
  blockRetentionMaintenanceScheduler?.dispose();
  blockRetentionMaintenanceScheduler = null;
  documentRevisionMaintenanceScheduler?.dispose();
  documentRevisionMaintenanceScheduler = null;
  stopAutoBackupScheduler();
  if (stopReminderScheduler) {
    stopReminderScheduler();
    stopReminderScheduler = null;
  }
  scheduledAutomationScheduler?.dispose();
  scheduledAutomationScheduler = null;
  terminalManager.killAll();
}

async function settleRuntimeShutdownStep(
  name: string,
  operation: () => Promise<unknown>,
  timeoutMs?: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const pending = operation();
    if (timeoutMs === undefined) {
      await pending;
      return;
    }
    await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${name} did not stop within ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } catch (error) {
    logger.warn(`${name} failed during shutdown`, {
      error: error instanceof Error ? error.message : String(error),
    });
    captureMainException(error, {
      tags: { phase: "runtime-shutdown", component: name },
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function shutdownMainRuntime(): Promise<void> {
  beginMainRuntimeShutdown();
  if (runtimeShutdownPromise) {
    return runtimeShutdownPromise;
  }

  runtimeShutdownPromise = (async () => {
    await settleRuntimeShutdownStep(
      "Document revision flush",
      async () => {
        const storeEpoch = readBlockStoreEpoch(getDb());
        if (!storeEpoch) return;
        while (true) {
          const { result } =
            await blockMutationWriter.maintainDocumentRevisionHistory({
              version: DOCUMENT_REVISION_MAINTENANCE_VERSION,
              storeEpoch,
              now: new Date().toISOString(),
              force: true,
            });
          if (result.failedDocumentCount > 0) {
            throw new Error(
              `Document revision flush left ${result.failedDocumentCount} session(s) unresolved`,
            );
          }
          if (result.scannedDocumentCount === 0) return;
        }
      },
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    await Promise.all([
      settleRuntimeShutdownStep(
        "Block mutation writer",
        () => blockMutationWriter.shutdown(),
      ),
      settleRuntimeShutdownStep(
        "Codex service",
        () => codexService.shutdown(),
        RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
      ),
    ]);
    await settleRuntimeShutdownStep(
      "Main diagnostics",
      () => shutdownMainSentry(),
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    await settleRuntimeShutdownStep(
      "Backend logger",
      () => shutdownBackendLogger(),
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    runtimeShutdownCompleted = true;
  })();
  return runtimeShutdownPromise;
}

function registerRuntimeLifecycleHandlers(): void {
  if (runtimeLifecycleHandlersRegistered) return;
  runtimeLifecycleHandlersRegistered = true;

  app.on("before-quit", () => {
    beginMainRuntimeShutdown();
  });

  app.on("will-quit", (event) => {
    if (runtimeShutdownCompleted) return;
    event.preventDefault();
    if (runtimeQuitContinuationStarted) return;
    runtimeQuitContinuationStarted = true;
    void shutdownMainRuntime().finally(() => {
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    logger.info("All windows closed");
    stopAutoBackupScheduler();
    if (stopReminderScheduler) {
      stopReminderScheduler();
      stopReminderScheduler = null;
    }

    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception in main process", { error });
    captureMainException(error, {
      tags: { phase: "runtime", kind: "uncaughtException" },
    });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection in main process", { reason });
    captureMainException(reason, {
      tags: { phase: "runtime", kind: "unhandledRejection" },
    });
  });
}

export async function runMainAppStartup(
  context: MainRuntimeStartupContext,
): Promise<MainRuntimeController> {
  registerRuntimeLifecycleHandlers();
  const startupSecondInstancesWithoutDeepLinks = collectStartupDeepLinks(context);

  logger.info("Nodex main process starting", {
    packaged: app.isPackaged,
    platform: process.platform,
    pid: process.pid,
    nodexHome: getNodexHome(),
  });
  registerDeepLinkProtocol();
  // Packaged macOS builds use the bundle icon; dev still needs an explicit Dock icon override.
  if (process.platform === "darwin" && !app.isPackaged && !appDockIcon.isEmpty()) {
    app.dock?.setIcon(appDockIcon);
  }
  windowSessionState = new WindowSessionState(app.getPath("userData"));
  appUpdateService = new AppUpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    logger,
    platform: process.platform,
  });
  appUpdateService.onStatusChange((status) => {
    broadcastAppUpdateStatus(status);
  });
  appUpdateService.initialize();

  const serverPort = getPort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  serverUrlForWindows = serverUrl;
  configureApplicationMenus();
  registerInitializationIpcHandlers();
  rendererClientRouter = new RendererClientRouter();
  codexService.setNodexAgentAuthorizationBroker(new NodexAgentAuthorizationBroker({
    rendererClientRouter,
    persistProjectGrants: async (input) =>
      await blockMutationWriter.persistNodexAgentProjectResourceGrants(input),
  }));
  registerIpcHandlers({
    rendererClientRouter,
    desktopNotificationManager,
    onHeartbeatAutomationsEnabledChanged: (input) => {
      scheduledAutomationScheduler?.setHeartbeatAutomationsEnabled(input.enabled);
    },
    onHeartbeatAutomationThreadStateChanged: (input, rendererClientId) => {
      if (!rendererClientId) return;
      scheduledAutomationScheduler?.setHeartbeatThreadRendererState({
        ...input,
        rendererClientId,
      });
    },
    onCreateWindow: (seed) => {
      openNewWindow(seed);
    },
    onBootstrapWindowSession: (webContentsId) => {
      if (!windowSessionState) {
        throw new Error("Window session state is unavailable");
      }
      const session = windowSessionState.bootstrap(webContentsId);
      const window = openWindows.get(webContentsId);
      if (window) {
        syncMacWindowTitle(window);
      }
      return { session };
    },
    onSaveWindowSessionLayout: (webContentsId, layout) => {
      if (!windowSessionState) {
        throw new Error("Window session state is unavailable");
      }
      const window = openWindows.get(webContentsId);
      const session = windowSessionState.saveLayout(
        webContentsId,
        layout,
        window && !window.isDestroyed() ? captureWindowSessionBounds(window) : undefined,
      );
      if (window) {
        syncMacWindowTitle(window);
      }
      return { session };
    },
    onUpdateWindowSessionBounds: (webContentsId, bounds) => {
      windowSessionState?.updateBounds(webContentsId, bounds);
    },
    onGetAppUpdateStatus: () =>
      appUpdateService?.getStatus() ?? resolveUnsupportedAppUpdateStatus(),
    onCheckForAppUpdate: async () =>
      await (appUpdateService?.checkForUpdates("manual")
        ?? Promise.resolve(resolveUnsupportedAppUpdateStatus())),
    onInstallAppUpdate: () => appUpdateService?.installUpdateAndRestart() ?? false,
    onAppUpdateSettingsChanged: () => {
      maybeStartAutomaticAppUpdateChecks();
    },
    onCommandKeybindingsChanged: (state) => {
      configureApplicationMenus(state);
    },
  });

  ipcMain.removeHandler("app:flush-before-close:done");
  ipcMain.handle("app:flush-before-close:done", (_, webContentsId: number) => {
    const resolve = pendingCloseResolvers.get(webContentsId);
    if (!resolve) return;
    resolve();
  });
  ipcMain.removeAllListeners("electron-request-microphone-permission");
  ipcMain.on("electron-request-microphone-permission", () => {
    void requestHostMicrophonePermission();
  });

  appInitializationPromise = initializeDesktopApp(serverPort);
  const restorePolicy = getWindowRestoreSettings().policy;
  const startupSessions = windowSessionState.selectStartupSessions(restorePolicy);
  for (const session of startupSessions) {
    createWindow(serverUrl, { session });
  }

  for (const argv of startupSecondInstancesWithoutDeepLinks) {
    handleSecondInstanceArgv(argv);
  }

  await appInitializationPromise;

  return {
    handleOpenUrl: handleIncomingDeepLink,
    handleSecondInstance: handleSecondInstanceArgv,
    shutdown: shutdownMainRuntime,
  };
}
