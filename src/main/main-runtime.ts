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
import { findCardLocationById, initializeDatabase } from "./kanban/db-service";
import * as projectSessionService from "./kanban/project-session-service";
import { dbNotifier } from "./kanban/db-notifier";
import {
  configureAutoBackupScheduler,
  stopAutoBackupScheduler,
} from "./kanban/backup-service";
import { getAssetsPathPrefix } from "./kanban/asset-service";
import { runReminderTick, snoozeReminder, startReminderScheduler } from "./kanban/reminder-service";
import * as ptyManager from "./pty-manager";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getCommandKeymapState,
  getKanbanDir,
  getWindowRestoreSettings,
  getPort,
} from "./kanban/config";
import { codexService } from "./codex/codex-service";
import { DesktopNotificationManager } from "./desktop-notification-manager";
import { parseCardDeepLink, parseSessionDeepLink } from "../shared/card-deeplink";
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
  WORKBENCH_THREAD_RENAME_COMMAND,
  WORKBENCH_SIDEBAR_TOGGLE_COMMAND,
  type WorkbenchPanelTabCloseHostChannel,
  type WorkbenchPanelTabCycleHostChannel,
  type WorkbenchThreadRenameHostChannel,
  type WorkbenchSidebarToggleHostChannel,
  type WorkbenchNavigationHostChannel,
} from "../shared/window-navigation";
import { BROWSER_SIDEBAR_PARTITION } from "../shared/browser-sidebar";
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import { collectSecondInstancesForStartupReplay } from "./main-runtime-startup-events";
import {
  captureMainException,
  captureMainMessage,
  shutdownMainSentry,
} from "./observability/sentry-main";
import {
  getPrimaryCommandAccelerator,
  toElectronAccelerator,
} from "../shared/command-keybindings";
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
let pendingCardDeepLinkCardId: string | null = null;
let pendingCardDeepLinkTarget: { projectId: string; cardId: string } | null = null;
let pendingSessionDeepLinkSessionId: string | null = null;
let pendingSessionDeepLinkTarget: { projectId: string; sessionId: string } | null = null;
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
let mediaPermissionHandlersRegistered = false;
const desktopNotificationManager = new DesktopNotificationManager();
const logger = getLogger({ subsystem: "app" });

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

function configureMacWindowMenus(): void {
  if (process.platform !== "darwin") return;

  const commandKeymapState = getCommandKeymapState();
  const menuAccelerator = (commandId: string, fallback: string): string => {
    return toElectronAccelerator(getPrimaryCommandAccelerator(commandKeymapState, commandId)) ?? fallback;
  };

  const dockMenuTemplate: MenuItemConstructorOptions[] = [
    {
      label: "New Window",
      accelerator: menuAccelerator("newWindow", "CommandOrControl+Shift+N"),
      click: () => {
        openNewWindow();
      },
    },
  ];
  app.dock?.setMenu(Menu.buildFromTemplate(dockMenuTemplate));

  const sendNavigationMessage = (
    channel:
      | WorkbenchNavigationHostChannel
      | WorkbenchSidebarToggleHostChannel
      | WorkbenchThreadRenameHostChannel
      | WorkbenchPanelTabCycleHostChannel
      | WorkbenchPanelTabCloseHostChannel,
  ) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
    if (!targetWindow || targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(channel);
  };

  const closeFocusedWindow = () => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
    if (!targetWindow || targetWindow.isDestroyed()) return;
    targetWindow.close();
  };

  const appMenuTemplate: MenuItemConstructorOptions[] = [
    {
      role: "appMenu",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => {
            void appUpdateService?.checkForUpdates("manual");
          },
        },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: menuAccelerator("newWindow", "CommandOrControl+Shift+N"),
          click: () => {
            openNewWindow();
          },
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: menuAccelerator("closeWindow", "CommandOrControl+Shift+W"),
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
          accelerator: menuAccelerator("navigateBack", "CommandOrControl+["),
          click: () => {
            sendNavigationMessage(NAVIGATE_BACK_HOST_CHANNEL);
          },
        },
        {
          label: "Forward",
          accelerator: menuAccelerator("navigateForward", "CommandOrControl+]"),
          click: () => {
            sendNavigationMessage(NAVIGATE_FORWARD_HOST_CHANNEL);
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
          accelerator: menuAccelerator("closeTab", "CommandOrControl+W"),
          click: () => {
            sendNavigationMessage(CLOSE_PANEL_TAB_HOST_CHANNEL);
          },
        },
        { type: "separator" },
        {
          label: WORKBENCH_SIDEBAR_TOGGLE_COMMAND.label,
          accelerator: menuAccelerator("toggleSidebar", "CommandOrControl+B"),
          click: () => {
            sendNavigationMessage(WORKBENCH_SIDEBAR_TOGGLE_COMMAND.hostChannel);
          },
        },
        {
          label: WORKBENCH_THREAD_RENAME_COMMAND.label,
          accelerator: menuAccelerator("renameThread", "CommandOrControl+Alt+R"),
          click: () => {
            sendNavigationMessage(WORKBENCH_THREAD_RENAME_COMMAND.hostChannel);
          },
        },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));
}

function broadcastToWindows(channel: string, payload: unknown): void {
  for (const window of openWindows.values()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
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
    event.sender.send("app:init-step", appInitializationStep);
    if (latestDatabaseMigrationProgress) {
      event.sender.send("db:migration-progress", latestDatabaseMigrationProgress);
    }
    return appInitializationPromise;
  });
}

function sendReminderOpenEvent(payload: {
  projectId: string;
  cardId: string;
  occurrenceStart: string;
}): void {
  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.webContents.send("reminder:open", payload);
}

function flushPendingCardDeepLink(): void {
  if (!pendingCardDeepLinkTarget) {
    return;
  }

  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  targetWindow.webContents.send("deeplink:open-card", pendingCardDeepLinkTarget);
  pendingCardDeepLinkTarget = null;
}

function flushPendingSessionDeepLink(): void {
  if (!pendingSessionDeepLinkTarget) {
    return;
  }

  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  targetWindow.webContents.send("deeplink:open-session", pendingSessionDeepLinkTarget);
  pendingSessionDeepLinkTarget = null;
}

function resolvePendingCardDeepLink(): void {
  if (!databaseReady) {
    return;
  }

  if (!pendingCardDeepLinkCardId) {
    flushPendingCardDeepLink();
    return;
  }

  const cardId = pendingCardDeepLinkCardId;
  const location = findCardLocationById(cardId);
  pendingCardDeepLinkCardId = null;
  if (!location) {
    return;
  }

  pendingCardDeepLinkTarget = {
    projectId: location.projectId,
    cardId,
  };

  flushPendingCardDeepLink();
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

function queueCardDeepLink(cardId: string): void {
  pendingCardDeepLinkCardId = cardId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  resolvePendingCardDeepLink();
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

  const cardTarget = parseCardDeepLink(value);
  if (!cardTarget) {
    return false;
  }

  queueCardDeepLink(cardTarget.cardId);
  return true;
}

function extractDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const sessionTarget = parseSessionDeepLink(arg);
    if (sessionTarget) {
      queueSessionDeepLink(sessionTarget.sessionId);
      return arg;
    }

    const cardTarget = parseCardDeepLink(arg);
    if (!cardTarget) {
      continue;
    }

    queueCardDeepLink(cardTarget.cardId);
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
      additionalArguments: [
        `--nodex-server-url=${serverUrl}`,
        `--nodex-asset-path-prefix=${encodeURIComponent(getAssetsPathPrefix())}`,
      ],
    },
  });

  if (!mediaPermissionHandlersRegistered) {
    const electronSession = window.webContents.session;
    electronSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission === "media") return true;
      return false;
    });
    electronSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "media");
    });
    mediaPermissionHandlersRegistered = true;
  }

  // Open external links in the system browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    const webviewParams = params as typeof params & {
      nodeintegration?: string;
      preload?: string;
      webpreferences?: string;
    };
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
  windowSessionState?.assignWindow(webContentsId, options.session.id);
  syncMacWindowTitle(window);
  lastFocusedWindowId = webContentsId;

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

    try {
      window.webContents.send("app:flush-before-close", webContentsId);
    } catch {
      finishClose();
    }
  };

  window.on("close", closeHandler);
  window.on("focus", () => {
    lastFocusedWindowId = webContentsId;
    windowSessionState?.markFocused(webContentsId);
    if (!window.isDestroyed()) {
      window.webContents.send("electron-window:focus-changed", { isFocused: true });
    }
  });
  window.on("resize", () => {
    if (window.isDestroyed()) return;
    windowSessionState?.updateBounds(webContentsId, captureWindowSessionBounds(window));
  });
  window.on("move", () => {
    if (window.isDestroyed()) return;
    windowSessionState?.updateBounds(webContentsId, captureWindowSessionBounds(window));
  });
  window.on("blur", () => {
    if (!window.isDestroyed()) {
      window.webContents.send("electron-window:focus-changed", { isFocused: false });
    }
  });
  window.webContents.on("did-finish-load", () => {
    syncMacWindowTitle(window);
    const appUpdateStatus = appUpdateService?.getStatus();
    if (appUpdateStatus) {
      window.webContents.send("app:update-status", appUpdateStatus);
    }
    flushPendingCardDeepLink();
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
    windowSessionState?.clearWindow(webContentsId);
    pendingCloseResolvers.delete(webContentsId);
    allowImmediateWindowClose.delete(webContentsId);
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
  databaseReady = true;
  resolvePendingCardDeepLink();
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
          cardId: payload.cardId,
          occurrenceStart: payload.occurrenceStart,
        });
      });

      notification.on("action", (_, index) => {
        const minutes = index === 0 ? 10 : 60;
        void snoozeReminder(
          payload.projectId,
          payload.cardId,
          payload.occurrenceStart,
          minutes,
        );
      });

      notification.show();
    },
  });

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
          cardId: payload.cardId,
          occurrenceStart: payload.occurrenceStart,
        });
      });
      notification.show();
    });
  });

  dbNotifier.on("board-changed", (event) => {
    broadcastToWindows("board-changed", event);
  });
  dbNotifier.on("project-sessions-changed", (event) => {
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

export interface MainRuntimeStartupContext {
  initialArgv: string[];
  startupEvents?: BootstrapRuntimeEvent[];
}

export interface MainRuntimeController {
  handleOpenUrl(url: string): boolean;
  handleSecondInstance(argv: string[]): boolean;
  shutdown(): void;
}

let runtimeLifecycleHandlersRegistered = false;
let runtimeShutdownStarted = false;

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

function shutdownMainRuntime(): void {
  if (runtimeShutdownStarted) return;
  runtimeShutdownStarted = true;
  appQuitRequested = true;
  retainRestorableWindowSessions();
  logger.info("Nodex before-quit");
  ptyManager.killAll();
  void codexService.shutdown();
  void shutdownMainSentry();
  void shutdownBackendLogger();
}

function registerRuntimeLifecycleHandlers(): void {
  if (runtimeLifecycleHandlersRegistered) return;
  runtimeLifecycleHandlersRegistered = true;

  app.on("before-quit", () => {
    shutdownMainRuntime();
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
    kanbanDir: getKanbanDir(),
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
  configureMacWindowMenus();
  registerInitializationIpcHandlers();
  registerIpcHandlers({
    desktopNotificationManager,
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
    onCommandKeybindingsChanged: () => {
      configureMacWindowMenus();
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
