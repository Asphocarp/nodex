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
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { join, resolve } from "path";
import { performance } from "node:perf_hooks";
import type { AppInitializationStep } from "../shared/app-startup";
import type { AppUpdateStatus } from "../shared/types";
import {
  projectionScopeKey,
  type ProjectionScope,
} from "../shared/projection-stream";
import { registerIpcHandlers } from "./ipc-handlers";
import {
  configureHttpContentModuleAuthorities,
  startHttpServer,
} from "./http-server";
import { dbNotifier } from "./local-store/notifier";
import { getAssetsPathPrefix } from "./local-store/assets";
import {
  startAutomationReminderScheduler,
} from "./automation-reminder-scheduler";
import type { ReminderNotificationPayload } from "./reminder-notification";
import { terminalManager } from "./terminal-manager";
import { browserSidebarService } from "./browser-sidebar-service";
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
import {
  initializeDesktopDataAuthority,
  createCoreProjectWorkspaceAdapter,
  createDesktopAutomationModuleBridge,
  createDesktopDatabaseModuleBridge,
  createDesktopLibraryModuleBridge,
  createDesktopDocumentSyncBridge,
  createDesktopProjectWorkspaceBridge,
  createDesktopStoreAdministrationBridge,
  mapCoreAutomationEvent,
  mapCoreDatabaseEvent,
  mapCoreLibraryDatabaseEvent,
  mapCoreLibraryEvent,
  mapCoreProjectWorkspaceEvent,
  mapCoreStoreAdministrationEvent,
  type CoreEventEnvelope,
  type CoreEventSubscription,
  type DesktopAutomationModulePort,
  type DesktopDataAuthorityRuntime,
  type DesktopLibraryModuleBridge,
  type DesktopStoreAdministrationPort,
} from "./core-client";
import { createDesktopNodexAgentV3DynamicService } from "./core-client/desktop-nodex-agent-dynamic-service";
import { superviseCoreEventStream } from "./core-client/core-event-stream-supervisor";
import { CoreEventCompatibilityError } from "./core-client/uds-http";
import { ProjectionInvalidationRouter } from "./core-client/projection-invalidation-router";
import {
  requireProjectionInvalidationRouter,
  setProjectionInvalidationRouter,
} from "./projection-invalidation-runtime";
import {
  allProjectSessionInvalidation,
  planCoreWorkspaceNotifications,
} from "./core-client/core-project-workspace-invalidation";
import { configureNodexAgentV3DynamicService } from "./codex/nodex-agent-dynamic-tool-runtime";
import { createDesktopNodexAgentAuthorityPort } from "./core-client/desktop-nodex-agent-authority";
import { createDesktopNodexAgentResourceAuthorityPort } from "./core-client/desktop-nodex-agent-resource-authority";
import {
  startStoreAdministrationBackupScheduler,
  type StoreAdministrationBackupScheduler,
} from "./store-administration-backup-scheduler";
import {
  startStoreAdministrationMaintenanceScheduler,
  type StoreAdministrationMaintenanceScheduler,
} from "./store-administration-maintenance-scheduler";
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
let runtimeReminderTick: (() => Promise<void>) | null = null;
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
let appInitializationStep: AppInitializationStep = { phase: "opening" };
let appInitializationStepChangedAt = performance.now();
let appInitializationPromise: Promise<void> = Promise.resolve();
const rendererInitializationReports = new Set<number>();
let appUpdateService: AppUpdateService | null = null;
let scheduledAutomationScheduler: CodexScheduledAutomationScheduler | null = null;
let appPermissionHandlersRegistered = false;
let rendererClientRouter: RendererClientRouter | null = null;
let desktopDataAuthorityRuntime: DesktopDataAuthorityRuntime | null = null;
let desktopAutomationModule: DesktopAutomationModulePort | null = null;
let desktopLibraryModule: DesktopLibraryModuleBridge | null = null;
let desktopStoreAdministration: DesktopStoreAdministrationPort | null = null;
let coreEventSubscription: CoreEventSubscription | null = null;
let storeAdministrationBackupScheduler: StoreAdministrationBackupScheduler | null = null;
let storeAdministrationMaintenanceScheduler:
  StoreAdministrationMaintenanceScheduler | null = null;
let reminderResumeHandlerRegistered = false;
const desktopNotificationManager = new DesktopNotificationManager();
const logger = getLogger({ subsystem: "app" });
function showReminderNotification(
  payload: ReminderNotificationPayload,
): void {
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
    const automation = desktopAutomationModule;
    if (!automation) return;
    const minutes = index === 0 ? 10 : 60;
    void automation.snoozeReminder(
      payload.projectId,
      payload.pageId,
      payload.occurrenceStart,
      minutes,
    ).catch((error) => {
      logger.warn("Failed to snooze reminder", {
        projectId: payload.projectId,
        pageId: payload.pageId,
        error,
      });
    });
  });
  notification.show();
}

function startRuntimeReminderDelivery(): void {
  if (stopReminderScheduler || runtimeShutdownStarted) return;
  const automation = desktopAutomationModule;
  if (!automation) {
    logger.warn("Reminder scheduler deferred: Automation module unavailable");
    return;
  }
  const scheduler = startAutomationReminderScheduler({
    automation,
    onReminder: showReminderNotification,
  });
  runtimeReminderTick = scheduler.runNow;
  stopReminderScheduler = scheduler.dispose;
  if (reminderResumeHandlerRegistered) return;
  reminderResumeHandlerRegistered = true;
  powerMonitor.on("resume", () => {
    void runtimeReminderTick?.();
  });
}

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
  if (appInitializationStep.phase === "done") return;
  if (appInitializationStep.phase === "migrating" && step.phase === "opening") return;
  if (
    appInitializationStep.phase === step.phase
    && (
      step.phase !== "migrating"
      || (
        appInitializationStep.phase === "migrating"
        && appInitializationStep.fromVersion === step.fromVersion
        && appInitializationStep.toVersion === step.toVersion
      )
    )
  ) return;
  const now = performance.now();
  logger.info("App initialization phase changed", {
    previousPhase: appInitializationStep.phase,
    phase: step.phase,
    previousPhaseDurationMs: Math.round(now - appInitializationStepChangedAt),
  });
  appInitializationStep = step;
  appInitializationStepChangedAt = now;
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

function registerInitializationIpcHandlers(): void {
  ipcMain.removeHandler("app:await-initialization");
  ipcMain.handle("app:await-initialization", (event) => {
    safeSendToWebContents(event.sender, "app:init-step", [appInitializationStep]);
    return appInitializationPromise;
  });
  ipcMain.removeAllListeners("app:renderer-initialization-finished");
  ipcMain.on("app:renderer-initialization-finished", (event, input: unknown) => {
    if (!openWindows.has(event.sender.id) || rendererInitializationReports.has(event.sender.id)) {
      return;
    }
    if (typeof input !== "object" || input === null || Array.isArray(input)) return;
    const candidate = input as { durationMs?: unknown; outcome?: unknown };
    if (
      typeof candidate.durationMs !== "number"
      || !Number.isFinite(candidate.durationMs)
      || candidate.durationMs < 0
      || candidate.durationMs > 10 * 60_000
      || (candidate.outcome !== "ready" && candidate.outcome !== "failed")
    ) return;
    rendererInitializationReports.add(event.sender.id);
    logger.info("Renderer initialization finished", {
      durationMs: Math.round(candidate.durationMs),
      outcome: candidate.outcome,
      webContentsId: event.sender.id,
    });
  });
}

interface ProjectionIpcSenderSubscriptions {
  readonly sender: WebContents;
  readonly releases: Map<string, () => void>;
  readonly onDestroyed: () => void;
}

const projectionIpcSubscriptions =
  new Map<number, ProjectionIpcSenderSubscriptions>();

function registerProjectionStreamIpcHandlers(): void {
  const releaseSender = (senderId: number): void => {
    const state = projectionIpcSubscriptions.get(senderId);
    if (!state) return;
    projectionIpcSubscriptions.delete(senderId);
    state.sender.removeListener("destroyed", state.onDestroyed);
    for (const release of state.releases.values()) release();
    state.releases.clear();
  };
  const ensureSender = (sender: WebContents): ProjectionIpcSenderSubscriptions => {
    const existing = projectionIpcSubscriptions.get(sender.id);
    if (existing) return existing;
    const state: ProjectionIpcSenderSubscriptions = {
      sender,
      releases: new Map(),
      onDestroyed: () => releaseSender(sender.id),
    };
    projectionIpcSubscriptions.set(sender.id, state);
    sender.once("destroyed", state.onDestroyed);
    return state;
  };
  const unsubscribe = (senderId: number, scope: ProjectionScope) => {
    const state = projectionIpcSubscriptions.get(senderId);
    if (!state) return;
    const key = projectionScopeKey(scope);
    state.releases.get(key)?.();
    state.releases.delete(key);
    if (state.releases.size === 0) releaseSender(senderId);
  };

  ipcMain.removeHandler("projection-stream:subscribe");
  ipcMain.handle("projection-stream:subscribe", (event, scope: ProjectionScope) => {
    unsubscribe(event.sender.id, scope);
    const state = ensureSender(event.sender);
    const key = projectionScopeKey(scope);
    const release = requireProjectionRouter().subscribe(scope, (message) => {
      safeSendToWebContents(event.sender, "projection-stream:message", [message]);
    });
    state.releases.set(key, release);
  });

  ipcMain.removeHandler("projection-stream:unsubscribe");
  ipcMain.handle("projection-stream:unsubscribe", (event, scope: ProjectionScope) => {
    unsubscribe(event.sender.id, scope);
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

async function resolvePendingPageDeepLink(): Promise<void> {
  if (!databaseReady) {
    return;
  }

  if (!pendingPageDeepLinkPageId) {
    flushPendingPageDeepLink();
    return;
  }

  const pageId = pendingPageDeepLinkPageId;
  const location = desktopLibraryModule
    ? await desktopLibraryModule.findPageLocation(pageId)
    : null;
  if (pendingPageDeepLinkPageId !== pageId) {
    return;
  }
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

async function resolvePendingSessionDeepLink(): Promise<void> {
  if (!databaseReady) {
    return;
  }

  if (!pendingSessionDeepLinkSessionId) {
    flushPendingSessionDeepLink();
    return;
  }

  const sessionId = pendingSessionDeepLinkSessionId;
  pendingSessionDeepLinkSessionId = null;
  const session = desktopDataAuthorityRuntime
    ? await createCoreProjectWorkspaceAdapter(
        desktopDataAuthorityRuntime.rootClient,
      ).getProjectSession(sessionId)
    : null;
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
  void resolvePendingPageDeepLink().catch((error) => {
    logger.warn("Page deep-link resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function queueSessionDeepLink(sessionId: string): void {
  pendingSessionDeepLinkSessionId = sessionId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  void resolvePendingSessionDeepLink();
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
  const windowCreatedAt = performance.now();
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
    logger.info("Renderer document finished loading", {
      durationMs: Math.round(performance.now() - windowCreatedAt),
      webContentsId,
    });
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
    rendererInitializationReports.delete(webContentsId);
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

let databaseNotifierBridgesRegistered = false;

function registerDatabaseNotifierBridges(): void {
  if (databaseNotifierBridgesRegistered) return;
  databaseNotifierBridgesRegistered = true;

  dbNotifier.on("board-changed", (event) => {
    broadcastToWindows("board-changed", event);
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
        summaryScopeCount: event.summaryScopes.length,
        changeType: event.changeType,
        detailScope: event.detailInvalidation.kind,
        detailSessionCount: event.detailInvalidation.kind === "sessions"
          ? event.detailInvalidation.sessionIds.length
          : 0,
        windowCount: openWindows.size,
      },
      { groupBy: ["changeType", "windowCount"] },
    );
    broadcastToWindows("project-sessions-changed", event);
  });
  dbNotifier.on("projects-changed", (event) => {
    broadcastToWindows("projects-changed", event);
  });
}

async function publishCoreResync(eventHead: number): Promise<void> {
  const runtime = desktopDataAuthorityRuntime;
  if (runtime) {
    await requireProjectionRouter().resync({
      storeEpoch: runtime.rootClient.handshake.store_epoch,
      changeLogSeq: eventHead,
    }, "event_gap");
  }
  dbNotifier.notifyLibraryNavigationChanged({
    version: 1,
    libraryId: runtime?.rootClient.handshake.library_id ?? "",
    storeEpoch: runtime?.rootClient.handshake.store_epoch ?? null,
    changeLogSeq: eventHead,
    changeKind: "content",
    affectedParentKeys: ["library", "catalog"],
    affectedPageIds: [],
    affectedDatabaseIds: [],
    affectedViewIds: [],
  });
  dbNotifier.notifyProjectsChanged("update");
  dbNotifier.notifyProjectSessionInvalidation(
    allProjectSessionInvalidation(),
  );
}

async function initializeDesktopApp(
  serverPort: number,
  authority: Promise<DesktopDataAuthorityRuntime>,
): Promise<void> {
  const initializationStartedAt = performance.now();
  desktopDataAuthorityRuntime = await authority;
  const servicesStartedAt = performance.now();
  logger.info("Native Core authority ready", {
    ...desktopDataAuthorityRuntime.launch.timings,
    artifactValidationMs: Math.round(
      desktopDataAuthorityRuntime.launch.timings.artifactValidationMs,
    ),
    connectMs: Math.round(desktopDataAuthorityRuntime.launch.timings.connectMs),
    selectionMs: Math.round(desktopDataAuthorityRuntime.launch.timings.selectionMs),
    totalMs: Math.round(desktopDataAuthorityRuntime.launch.timings.totalMs),
  });
  registerDatabaseNotifierBridges();
  const coreClient = desktopDataAuthorityRuntime.rootClient;
  setProjectionInvalidationRouter(new ProjectionInvalidationRouter({
    libraryId: coreClient.handshake.library_id,
    initialCursor: {
      storeEpoch: coreClient.handshake.store_epoch,
      changeLogSeq: coreClient.handshake.event_head,
    },
    filterForProject: async (projectId, impact) =>
      await coreClient.filterProjectionImpactForProject(projectId, impact),
    onListenerError: (error, scope) => {
      logger.warn("Projection stream listener failed", {
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onAuthorizationError: (error, scope) => {
      logger.warn("Projection impact authorization failed closed", {
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  }));

  coreEventSubscription = superviseCoreEventStream({
    initialAfter: coreClient.handshake.event_head,
    open: (after, onEvent, onResyncRequired) =>
      coreClient.openEventStream(
        after,
        onEvent,
        onResyncRequired,
      ),
    onEvent: publishCoreModuleEvent,
    onResyncRequired: async (resync) => {
      await publishCoreResync(resync.event_head);
    },
    onInterrupted: (error) => {
      if (runtimeShutdownStarted) return;
      if (error instanceof CoreEventCompatibilityError) {
        logger.error("Native Core event contract changed; runtime rebind is required", {
          error: error.message,
        });
        return;
      }
      void requireProjectionRouter().resync({
        storeEpoch: coreClient.handshake.store_epoch,
        changeLogSeq: requireProjectionRouter().cursor.changeLogSeq,
      }, "reconnect");
      logger.warn("Native Core event stream interrupted; reconnecting", {
        error: error instanceof Error
          ? error.message
          : error === null
            ? "stream ended"
            : String(error),
      });
    },
  });
  void coreEventSubscription.done.catch((error) => {
    if (runtimeShutdownStarted || error instanceof CoreEventCompatibilityError) return;
    logger.error("Native Core event supervisor terminated unexpectedly", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  databaseReady = true;
  await resolvePendingPageDeepLink();
  await resolvePendingSessionDeepLink();
  startHttpServer(serverPort);
  configureRuntimeBackupScheduler(getBackupSettings());
  startRuntimeStoreMaintenanceScheduler();
  startRuntimeReminderDelivery();
  await codexService.synchronizeAutomationRuntime();
  startRuntimeScheduledAutomationScheduler();
  registerDesktopActivationHandler();
  setAppInitializationStep({ phase: "done" });
  logger.info("Desktop app initialization finished", {
    authorityAndServicesMs: Math.round(performance.now() - initializationStartedAt),
    servicesMs: Math.round(performance.now() - servicesStartedAt),
  });
  maybeStartAutomaticAppUpdateChecks();
}

function requireProjectionRouter(): ProjectionInvalidationRouter {
  return requireProjectionInvalidationRouter();
}

async function publishCoreModuleEvent(envelope: CoreEventEnvelope): Promise<void> {
  if (!desktopDataAuthorityRuntime) return;
  await requireProjectionRouter().accept(envelope);
  publishCoreModuleEventToNotifiers(
    envelope,
    desktopDataAuthorityRuntime.rootClient.handshake.library_id,
  );
}

function publishCoreModuleEventToNotifiers(
  envelope: CoreEventEnvelope,
  libraryId: string,
): void {
  const administrationEvent = mapCoreStoreAdministrationEvent(envelope);
  if (administrationEvent) return;
  const automationEvent = mapCoreAutomationEvent(envelope);
  if (automationEvent) {
    void codexService.synchronizeAutomationRuntime().catch((error) => {
      logger.warn("Failed to refresh Automation runtime cache", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    for (const automationId of automationEvent.automationIds) {
      codexService.notifyScheduledAutomationChanged({
        automationId,
        targetThreadId: null,
        reason: "upsert",
      });
    }
    if (
      automationEvent.automationIds.length > 0
      || automationEvent.runIds.length > 0
    ) {
      codexService.notifyAutomationRunsUpdated({
        automationId: automationEvent.automationIds.length === 1
          ? automationEvent.automationIds[0] ?? null
          : null,
        threadId: automationEvent.runIds.length === 1
          ? automationEvent.runIds[0] ?? null
          : null,
        reason: "settle",
      });
    }
    return;
  }
  const databaseEvent = mapCoreDatabaseEvent(
    envelope,
    libraryId,
  );
  if (databaseEvent) {
    dbNotifier.notifyDatabaseChanged(databaseEvent);
    return;
  }
  const libraryDatabaseEvent = mapCoreLibraryDatabaseEvent(
    envelope,
    libraryId,
  );
  if (libraryDatabaseEvent) {
    dbNotifier.notifyLibraryNavigationChanged(libraryDatabaseEvent);
    return;
  }
  const libraryEvent = mapCoreLibraryEvent(
    envelope,
    libraryId,
  );
  if (libraryEvent) {
    dbNotifier.notifyLibraryNavigationChanged(libraryEvent);
    return;
  }
  const workspaceEvent = mapCoreProjectWorkspaceEvent(envelope);
  if (!workspaceEvent) return;
  const notifications = planCoreWorkspaceNotifications(workspaceEvent);
  if (notifications.project) {
    dbNotifier.notifyProjectsChanged(
      notifications.project.changeType,
      notifications.project.projectId,
    );
  }
  if (notifications.sessions) {
    dbNotifier.notifyProjectSessionInvalidation(notifications.sessions);
  }
}

function configureRuntimeBackupScheduler(settings: {
  readonly autoEnabled: boolean;
  readonly intervalHours: number;
  readonly retentionCount: number;
}): void {
  storeAdministrationBackupScheduler?.dispose();
  storeAdministrationBackupScheduler = null;
  storeAdministrationMaintenanceScheduler?.dispose();
  storeAdministrationMaintenanceScheduler = null;
  const administration = desktopStoreAdministration;
  if (!administration) return;
  storeAdministrationBackupScheduler = startStoreAdministrationBackupScheduler({
    administration,
    enabled: settings.autoEnabled,
    intervalHours: settings.intervalHours,
    retentionCount: settings.retentionCount,
  });
}

function startRuntimeStoreMaintenanceScheduler(): void {
  if (
    !desktopStoreAdministration
    || storeAdministrationMaintenanceScheduler
  ) {
    return;
  }
  storeAdministrationMaintenanceScheduler =
    startStoreAdministrationMaintenanceScheduler({
      administration: desktopStoreAdministration,
      readBlockRetentionCount: () => getHistorySettings().retentionCount,
    });
}

let desktopActivationHandlerRegistered = false;

function registerDesktopActivationHandler(): void {
  if (desktopActivationHandlerRegistered) return;
  desktopActivationHandlerRegistered = true;
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
}

function startRuntimeScheduledAutomationScheduler(): void {
  if (runtimeShutdownStarted) return;
  if (scheduledAutomationScheduler) return;
  const automationModule = desktopAutomationModule;
  if (!automationModule) {
    logger.warn("Scheduled automation scheduler deferred: module unavailable");
    return;
  }

  scheduledAutomationScheduler = startCodexScheduledAutomationScheduler({
    claimDueAutomations: async (limit) =>
      await automationModule.claimDueDefinitions(limit, 15 * 60_000),
    completeClaim: async (leaseId) => {
      await automationModule.completeLease(leaseId);
    },
    failClaim: async (leaseId, retryDelayMs, reasonCode) => {
      await automationModule.failLease(leaseId, retryDelayMs, reasonCode);
    },
    settleInterruptedRuns: async () =>
      await automationModule.settleInterruptedRuns(),
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
  coreEventSubscription?.close();
  coreEventSubscription = null;
  for (const state of projectionIpcSubscriptions.values()) {
    state.sender.removeListener("destroyed", state.onDestroyed);
    for (const release of state.releases.values()) release();
  }
  projectionIpcSubscriptions.clear();
  setProjectionInvalidationRouter(null);
  storeAdministrationBackupScheduler?.dispose();
  storeAdministrationBackupScheduler = null;
  if (stopReminderScheduler) {
    stopReminderScheduler();
    stopReminderScheduler = null;
  }
  runtimeReminderTick = null;
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
      "Codex service",
      () => codexService.shutdown(),
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
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
    storeAdministrationBackupScheduler?.dispose();
    storeAdministrationBackupScheduler = null;
    if (stopReminderScheduler) {
      stopReminderScheduler();
      stopReminderScheduler = null;
    }
    runtimeReminderTick = null;

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
  setAppInitializationStep({ phase: "opening" });
  const dataAuthority = initializeDesktopDataAuthority({
    appResourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    buildId: `nodex-desktop/${app.getVersion()}`,
    isPackaged: app.isPackaged,
    nodexHome: getNodexHome(),
    onStartupEvent: (event) => {
      if (event.kind === "migration_started") {
        setAppInitializationStep({
          phase: "migrating",
          fromVersion: event.fromVersion,
          toVersion: event.toVersion,
        });
        logger.info("Native Core Store migration started", {
          fromVersion: event.fromVersion,
          toVersion: event.toVersion,
        });
        return;
      }
      if (event.kind === "candidate_checked") {
        logger.info("Native Core candidate checked", {
          artifactHashMs: event.artifactHashMs,
        });
        return;
      }
      logger.info("Native Core Store ready", {
        createdFresh: event.createdFresh,
        migratedFromVersion: event.migratedFromVersion,
        storeOpenMs: event.storeOpenMs,
      });
    },
    repositoryRoot: app.getAppPath(),
  });
  codexService.setNodexAgentAuthorityPort(
    createDesktopNodexAgentAuthorityPort({
      authority: dataAuthority,
    }),
  );
  const nodexAgentResourceAuthority = createDesktopNodexAgentResourceAuthorityPort({
    authority: dataAuthority,
  });
  codexService.setNodexAgentResourceAuthorityPort(
    nodexAgentResourceAuthority,
  );
  const automationModule = createDesktopAutomationModuleBridge({
    authority: dataAuthority,
  });
  desktopAutomationModule = automationModule;
  codexService.setAutomationModule(automationModule);
  const storeAdministration = createDesktopStoreAdministrationBridge({
    authority: dataAuthority,
  });
  desktopStoreAdministration = storeAdministration;
  const onStoreRestored = (): void => {
    const restart = setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 250);
    restart.unref?.();
  };
  const libraryModule = createDesktopLibraryModuleBridge({
    authority: dataAuthority,
    resolveProjectId: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const projectId = windowSessionState
        ?.getSessionForWindow(event.sender.id)
        ?.layout.dbProjectId.trim();
      if (!projectId || projectId === "default") return null;
      return projectId;
    },
  });
  desktopLibraryModule = libraryModule;
  const documentSync = createDesktopDocumentSyncBridge({
    authority: dataAuthority,
  });
  const databaseModule = createDesktopDatabaseModuleBridge({
    authority: dataAuthority,
  });
  const projectWorkspace = createDesktopProjectWorkspaceBridge({
    authority: dataAuthority,
  });
  browserSidebarService.setProjectSessionResolver(async (sessionId) =>
    (await projectWorkspace.getProjectSession(sessionId))?.projectId ?? null
  );
  codexService.setProjectWorkspacePort(projectWorkspace);
  configureNodexAgentV3DynamicService(
    createDesktopNodexAgentV3DynamicService({
      authority: dataAuthority,
      projectWorkspace,
      databaseModule,
      documentSync,
    }),
  );
  configureHttpContentModuleAuthorities({
    referenceReads: {
      resolvePageOwnershipPath: (input) =>
        libraryModule.resolvePageOwnershipPath(input),
      resolvePageTarget: (input) => libraryModule.resolvePageTarget(input),
      readDatabaseViewReference: (input) =>
        databaseModule.resolveDatabaseViewReference(input),
    },
    propertyMutations: {
      project: (request) => libraryModule.applyBlockPropertyMutation(request),
      library: (input) =>
        libraryModule.applyLibraryBlockPropertyMutation(input),
    },
    database: {
      read: (request) => databaseModule.read(request),
      apply: (request) => databaseModule.apply(request),
    },
    library: {
      read: (request) => libraryModule.read(request),
      apply: (request) => libraryModule.applyTrustedLibrary(request),
    },
    libraryDatabase: {
      read: (request) => databaseModule.readLibrary(request, "http_loopback"),
      apply: (request) => databaseModule.applyLibrary(request, {
        actor: { kind: "http_loopback" },
        accessActor: "http_loopback",
      }),
    },
    pageDetail: {
      read: (projectId, pageId) =>
        libraryModule.readProjectPageDetail(projectId, pageId),
    },
    libraryPageDetail: {
      read: (pageId) =>
        libraryModule.readLibraryPageDetail(pageId, "http_loopback"),
    },
    pageLifecyclePreflight: {
      readPreflight: (projectId, pageId) =>
        libraryModule.readPageLifecyclePreflight(projectId, pageId),
    },
    pageLifecycle: {
      applyMutation: (request) =>
        libraryModule.applyPageLifecycleMutation(request),
    },
    projectWorkspace,
    databaseProjections: databaseModule,
    pageSearch: libraryModule,
    automation: automationModule,
    storeAdministration: {
      port: storeAdministration,
      onBackupSettingsChanged: configureRuntimeBackupScheduler,
      onStoreRestored,
    },
    documentSync: {
      realtime: documentSync,
      getOwnedDocumentDescriptor: (projectId, ownerBlockId) =>
        documentSync.getOwnedDocumentDescriptor(projectId, ownerBlockId),
      prepareOwnedBlockDocument: (projectId, ownerBlockId) =>
        documentSync.prepareOwnedBlockDocument(projectId, ownerBlockId),
      prepareLibraryOwnedBlockDocument: (ownerBlockId) =>
        documentSync.prepareLibraryOwnedBlockDocument(ownerBlockId),
    },
    documentMutation: {
      applyMutation: (request) => documentSync.applyDocumentMutation(request),
    },
    additionalDocumentCommand: {
      applyCommand: (request) =>
        documentSync.applyAdditionalDocumentCommand(request),
    },
    blockTransfer: {
      transfer: (intent) => documentSync.transferBlocks(intent),
    },
    documentHistory: {
      createCheckpoint: (request) => documentSync.createCheckpoint(request),
      listVersions: (request) => documentSync.listVersions(request),
      getVersion: (request) => documentSync.getVersion(request),
      restoreVersion: (request) => documentSync.applyDocumentMutation(request),
    },
    pageHistory: {
      listHistory: (request) => libraryModule.listPageHistory(request),
    },
  });
  appInitializationPromise = initializeDesktopApp(serverPort, dataAuthority);

  const serverUrl = `http://127.0.0.1:${serverPort}`;
  serverUrlForWindows = serverUrl;
  configureApplicationMenus();
  registerInitializationIpcHandlers();
  registerProjectionStreamIpcHandlers();
  rendererClientRouter = new RendererClientRouter();
  codexService.setNodexAgentAuthorizationBroker(new NodexAgentAuthorizationBroker({
    rendererClientRouter,
    readStoreEpoch: () => {
      const runtime = desktopDataAuthorityRuntime;
      if (!runtime) return null;
      return runtime.rootClient.handshake.store_epoch;
    },
    persistProjectGrants: async (input) =>
      await nodexAgentResourceAuthority.persistProjectGrants(input),
  }));
  registerIpcHandlers({
    automationModule,
    storeAdministration,
    onBackupSettingsChanged: configureRuntimeBackupScheduler,
    onStoreRestored,
    documentSync,
    projectWorkspace,
    libraryModule,
    databaseModule,
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
