import {
  Menu,
  Notification,
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
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
  getKanbanDir,
  getWindowRestoreSettings,
  getPort,
} from "./kanban/config";
import { codexService } from "./codex/codex-service";
import { DesktopNotificationManager } from "./desktop-notification-manager";
import { configureInstanceScopePaths } from "./instance-scope";
import { parseCardDeepLink } from "../shared/card-deeplink";
import { WorkbenchResumeState } from "./workbench-resume-state";
import { WorkspaceState } from "./workspace-state";
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
const pendingCloseResolvers = new Map<number, () => void>();
const allowImmediateWindowClose = new Set<number>();
const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 1500;
let workbenchResumeState: WorkbenchResumeState | null = null;
let workspaceState: WorkspaceState | null = null;
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
  const createdWindow = createWindow(serverUrlForWindows, { restoreEligible: true, session });
  createdWindow.show();
  createdWindow.focus();
}

function createWindowSession(seed?: WindowSessionSeed): WindowSessionRecord {
  if (!workspaceState || !windowSessionState) {
    throw new Error("Window session state is unavailable");
  }
  const workspaceBootstrap = workspaceState.bootstrap();
  return windowSessionState.createSession(workspaceBootstrap.catalog, seed);
}

function openNewWindow(seed?: WindowSessionSeed): BrowserWindow | null {
  if (!serverUrlForWindows) return null;
  const session = createWindowSession(seed);
  const window = createWindow(serverUrlForWindows, { restoreEligible: false, session });
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

function resolveMacWindowTitle(session: WindowSessionRecord): string {
  const workspaceBootstrap = workspaceState?.bootstrap();
  const workspaceName = workspaceBootstrap?.catalog.workspaces
    .find((workspace) => workspace.id === session.workspaceId)
    ?.name
    .trim()
    || workspaceBootstrap?.activeWorkspace.name.trim();
  return workspaceName || "Nodex";
}

function syncMacWindowTitle(window: BrowserWindow, session?: WindowSessionRecord | null): void {
  if (process.platform !== "darwin") return;
  if (window.isDestroyed()) return;

  const resolvedSession = session ?? windowSessionState?.getSessionForWindow(window.webContents.id);
  window.setTitle(resolvedSession ? resolveMacWindowTitle(resolvedSession) : "Nodex");
}

function syncAllMacWindowTitles(): void {
  if (process.platform !== "darwin") return;

  for (const window of openWindows.values()) {
    syncMacWindowTitle(window);
  }
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

  const dockMenuTemplate: MenuItemConstructorOptions[] = [
    {
      label: "New Window",
      accelerator: "Command+N",
      click: () => {
        openNewWindow();
      },
    },
  ];
  app.dock?.setMenu(Menu.buildFromTemplate(dockMenuTemplate));

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
          accelerator: "Command+N",
          click: () => {
            openNewWindow();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
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

function queueCardDeepLink(cardId: string): void {
  pendingCardDeepLinkCardId = cardId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  resolvePendingCardDeepLink();
}

function handleIncomingDeepLink(value: string): boolean {
  const target = parseCardDeepLink(value);
  if (!target) {
    return false;
  }

  queueCardDeepLink(target.cardId);
  return true;
}

function extractDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const target = parseCardDeepLink(arg);
    if (!target) {
      continue;
    }

    queueCardDeepLink(target.cardId);
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
  options: { restoreEligible: boolean; session: WindowSessionRecord },
): BrowserWindow {
  const shouldUseSavedBounds = isWindowSessionBoundsVisible(
    options.session.bounds,
    screen.getAllDisplays(),
  );
  const savedBounds = shouldUseSavedBounds ? options.session.bounds : undefined;
  const window = new BrowserWindow({
    x: savedBounds?.x,
    y: savedBounds?.y,
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform === "darwin" ? { title: resolveMacWindowTitle(options.session) } : {}),
    ...(process.platform === "darwin" ? {} : { icon: appIconPath }),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
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

  // In dev mode, load the vite dev server URL
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  const webContentsId = window.webContents.id;
  openWindows.set(webContentsId, window);
  windowSessionState?.assignWindow(webContentsId, options.session.id);
  syncMacWindowTitle(window, options.session);
  lastFocusedWindowId = webContentsId;
  if (options.restoreEligible) {
    workbenchResumeState?.markWindowEligible(webContentsId);
  }

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
    maybeStartAutomaticAppUpdateChecks();
  });
  window.on("closed", () => {
    workbenchResumeState?.clearWindowEligibility(webContentsId);
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

  app.on("activate", () => {
    const currentServerUrl = serverUrlForWindows;
    if (!currentServerUrl) return;
    if (openWindows.size === 0) {
      const session = createWindowSession();
      createWindow(currentServerUrl, { restoreEligible: true, session });
      return;
    }
    focusLastWindow();
  });

  setAppInitializationStep({ phase: "done" });
  maybeStartAutomaticAppUpdateChecks();
}

configureInstanceScopePaths(app, getKanbanDir());

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const handledDeepLink = Boolean(extractDeepLinkFromArgv(argv));
    if (handledDeepLink) {
      return;
    }
    if (openNewWindow()) return;
    focusLastWindow();
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleIncomingDeepLink(url);
});

if (hasSingleInstanceLock) {
  extractDeepLinkFromArgv(process.argv);
  app.whenReady()
    .then(async () => {
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
      workbenchResumeState = new WorkbenchResumeState(app.getPath("userData"));
      workspaceState = new WorkspaceState(app.getPath("userData"), () =>
        workbenchResumeState?.readSnapshot() ?? null
      );
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
        onConsumeWorkbenchResume: (webContentsId) =>
          workbenchResumeState?.consumeSnapshotForWindow(webContentsId) ?? null,
        onSaveWorkbenchResume: (webContentsId, snapshot) =>
          workbenchResumeState?.saveSnapshotForWindow(
            webContentsId,
            lastFocusedWindowId,
            openWindows.size,
            snapshot,
          ) ?? false,
        onBootstrapWorkspaces: () => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          return workspaceState.bootstrap();
        },
        onCreateWorkspace: (_webContentsId, name, layout, icon) => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          const bootstrap = workspaceState.createWorkspace(name, layout, icon);
          syncAllMacWindowTitles();
          return bootstrap;
        },
        onRenameWorkspace: (_webContentsId, workspaceId, name, icon) => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          const bootstrap = workspaceState.renameWorkspace(workspaceId, name, icon);
          syncAllMacWindowTitles();
          return bootstrap;
        },
        onDeleteWorkspace: (_webContentsId, workspaceId) => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          const bootstrap = workspaceState.deleteWorkspace(workspaceId);
          syncAllMacWindowTitles();
          return bootstrap;
        },
        onSaveWorkspaceLayout: (webContentsId, workspaceId, layout) => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          if (openWindows.size > 1 && webContentsId !== lastFocusedWindowId) {
            return workspaceState.bootstrap();
          }
          return workspaceState.saveLayout(workspaceId, layout);
        },
        onSetActiveWorkspace: (webContentsId, workspaceId) => {
          if (!workspaceState) throw new Error("Workspace state is unavailable");
          if (openWindows.size > 1 && webContentsId !== lastFocusedWindowId) {
            return workspaceState.bootstrap();
          }
          return workspaceState.setActive(workspaceId);
        },
        onBootstrapWindowSession: (webContentsId) => {
          if (!workspaceState || !windowSessionState) {
            throw new Error("Window session state is unavailable");
          }
          const workspaceBootstrap = workspaceState.bootstrap();
          const session = windowSessionState.bootstrap(webContentsId, workspaceBootstrap.catalog);
          const window = openWindows.get(webContentsId);
          if (window) {
            syncMacWindowTitle(window, session);
          }
          const activeWorkspace = workspaceBootstrap.catalog.workspaces.find((workspace) => workspace.id === session.workspaceId)
            ?? workspaceBootstrap.activeWorkspace;
          return {
            catalog: workspaceBootstrap.catalog,
            activeWorkspace,
            session,
          };
        },
        onSaveWindowSessionLayout: (webContentsId, workspaceId, layout) => {
          if (!workspaceState || !windowSessionState) {
            throw new Error("Window session state is unavailable");
          }
          const workspaceBootstrap = workspaceState.bootstrap();
          const window = openWindows.get(webContentsId);
          const session = windowSessionState.saveLayout(
            webContentsId,
            workspaceId,
            layout,
            workspaceBootstrap.catalog,
            window && !window.isDestroyed() ? captureWindowSessionBounds(window) : undefined,
          );
          const shouldUpdateWorkspaceTemplate = openWindows.size <= 1 || webContentsId === lastFocusedWindowId;
          if (shouldUpdateWorkspaceTemplate) {
            workspaceState.setActive(session.workspaceId);
          }
          const nextWorkspaceBootstrap = shouldUpdateWorkspaceTemplate
            ? workspaceState.saveLayout(session.workspaceId, session.layout)
            : workspaceState.bootstrap();
          const activeWorkspace = nextWorkspaceBootstrap.catalog.workspaces.find((workspace) => workspace.id === session.workspaceId)
            ?? nextWorkspaceBootstrap.activeWorkspace;
          if (window) {
            syncMacWindowTitle(window, session);
          }
          return {
            catalog: nextWorkspaceBootstrap.catalog,
            activeWorkspace,
            session,
          };
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
      const workspaceBootstrap = workspaceState.bootstrap();
      const restorePolicy = getWindowRestoreSettings().policy;
      const startupSessions = windowSessionState.selectStartupSessions(
        restorePolicy,
        workspaceBootstrap.catalog,
      );
      for (const session of startupSessions) {
        createWindow(serverUrl, { restoreEligible: true, session });
      }
      await appInitializationPromise;
    })
    .catch((error: unknown) => {
      logger.error("Nodex failed to start", { error });
      app.quit();
    });
}

app.on("before-quit", () => {
  appQuitRequested = true;
  retainRestorableWindowSessions();
  logger.info("Nodex before-quit");
  ptyManager.killAll();
  void codexService.shutdown();
  void shutdownBackendLogger();
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
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection in main process", { reason });
});
