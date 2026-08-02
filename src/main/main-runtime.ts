import {
  Menu,
  Notification,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  screen,
  session as electronSession,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { join, resolve } from "path";
import { performance } from "node:perf_hooks";
import type { AppInitializationStep } from "../shared/app-startup";
import {
  CORE_AUTHORITY_STATUS_CHANNEL,
  GET_CORE_AUTHORITY_STATUS_CHANNEL,
  RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL,
  RETRY_CORE_AUTHORITY_CHANNEL,
  type CoreAuthorityStatus,
} from "../shared/core-authority-status";
import type { AppUpdateStatus } from "../shared/types";
import {
  projectionScopeKey,
  type ProjectionScope,
} from "../shared/projection-stream";
import {
  disposeRemoteHostedPipRuntime,
  isRemoteHostedPipPrivacySettingsTerminationRequest,
  registerIpcHandlers,
} from "./ipc-handlers";
import { dbNotifier } from "./local-store/notifier";
import { getAssetsPathPrefix } from "./local-store/assets";
import {
  startAutomationReminderScheduler,
} from "./automation-reminder-scheduler";
import type { ReminderNotificationPayload } from "./reminder-notification";
import {
  browserSidebarService,
  codexService,
  terminalManager,
} from "./main-service-composition";
import { FileBrowserPageSnapshotStore } from "./browser/browser-page-store";
import { FileBrowserHistoryStore } from "./browser/browser-history-store";
import type { BrowserAuthorizedAttachment } from "./browser/browser-runtime-registry";
import { FileBrowserDownloadStore } from "./browser/browser-download-store";
import {
  BrowserDownloadService,
  configureBrowserDownloadService,
} from "./browser/browser-download-service";
import { BrowserCredentialVault } from "./browser/browser-credential-vault";
import { BrowserCredentialService } from "./browser/browser-credential-service";
import {
  BrowserProfileHelperClient,
  resolveBrowserProfileHelperExecutable,
} from "./browser/browser-profile-helper-client";
import { BrowserProfileImporter } from "./browser/browser-profile-importer";
import { BrowserSiteInfoProvider } from "./browser/browser-site-info-provider";
import { BrowserExtensionsProvider } from "./browser/browser-extensions-provider";
import { BrowserLocalServerPreferencesStore } from "./browser/browser-local-server-preferences";
import { configureBrowserProfileServices } from "./browser/browser-profile-services";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getCommandKeymapState,
  getHistorySettings,
  getNodexHome,
  getWindowRestoreSettings,
} from "./local-store/config";
import { createBrowserUsePeerAuthorizer } from "./browser-use/browser-use-peer-authorizer";
import { BrowserUseSessionRegistry } from "./browser-use/browser-use-session-registry";
import { BrowserUsePolicyStore } from "./browser-use/browser-use-policy-store";
import { BrowserUseSiteStatusPolicyService } from "./browser-use/site-status-policy-service";
import { DEFAULT_CHATGPT_BASE_URL } from "./codex/chatgpt-base-url";
import { NodexAgentAuthorizationBroker } from "./agent-tools/authorization-broker";
import {
  startCodexScheduledAutomationScheduler,
  type CodexScheduledAutomationScheduler,
} from "./codex-scheduled-automation-scheduler";
import { DesktopNotificationManager } from "./desktop-notification-manager";
import { composerAppshotService } from "./composer-appshot-service";
import {
  parsePageDeepLink,
  parseSessionDeepLink,
  parseViewDeepLink,
} from "../shared/nodex-deeplink";
import {
  isWindowSessionBoundsVisible,
  WindowSessionState,
  type AcquiredWindowSession,
  type WindowSessionCloseDisposition,
} from "./window-session-state";
import type {
  WindowSessionBounds,
  WindowSessionNewWindowRequest,
  WindowSessionRecord,
  WindowSessionSaveLayoutInput,
} from "../shared/window-session";
import { getWorkbenchSceneReturnLocation } from "../shared/workbench-layout";
import { getLogger, shutdownBackendLogger } from "./logging/logger";
import { AppUpdateService } from "./app-update-service";
import { createPackagedMacAppUpdater } from "./sparkle-mac-app-updater";
import { closeWindowsBeforeRuntimeShutdown } from "./runtime-quit-coordinator";
import { resolveCodexTitleBarOptions } from "./window-navigation-chrome";
import {
  CLOSE_PANEL_TAB_HOST_CHANNEL,
  CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL,
  CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL,
  NAVIGATE_BACK_HOST_CHANNEL,
  NAVIGATE_FORWARD_HOST_CHANNEL,
  REQUEST_NEW_WINDOW_HOST_CHANNEL,
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
} from "../shared/browser-sidebar";
import { resolveBrowserUseHostCapability } from "../shared/browser-use-host-capability";
import {
  isAllowedBrowserExternalUrl,
  isAllowedBrowserNavigationUrl,
} from "../shared/browser-url";
import { shouldGrantBrowserPermission } from "./browser/browser-session-permissions";
import {
  consumePendingBrowserWebviewAttachment,
  decideBrowserWebviewAttachment,
  parseBrowserWebviewInstanceId,
  registerPendingBrowserWebviewAttachment,
} from "./browser/browser-webview-attachment-policy";
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import {
  collectSecondInstancesForStartupReplay,
  requestsExplicitNewWindow,
} from "./main-runtime-startup-events";
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
import {
  buildNodexSetupMenuItems,
  buildWindowFileMenu,
  buildWorkbenchViewMenu,
} from "./application-menu";
import { installCliCommand } from "./cli-command-installer";
import { runAgentSkillSetup } from "./agent-skill-setup";
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
  type CoreAuthorityState,
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
import { registerManagedAssetProtocol } from "./managed-asset-protocol";
import { InitialProjectBootstrapService } from "./initial-project-bootstrap-service";
import {
  resolveInitialProjectProjectsDirectory,
} from "./initial-project/initial-project-filesystem";
import {
  resolveInitialProjectJournalPath,
} from "./initial-project/initial-project-journal-store";
// macOS uses the packaged bundle icon from the app resources.
// We only keep a PNG around for development Dock icon parity and non-macOS window icons.
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "../../resources/icon.png");
const appDockIcon = nativeImage.createFromPath(appIconPath);

const openWindows = new Map<number, BrowserWindow>();
let lastFocusedWindowId: number | null = null;
let rendererHostReadyForWindows = false;
let disposeManagedAssetProtocol: (() => void) | null = null;
let stopReminderScheduler: (() => void) | null = null;
let runtimeReminderTick: (() => Promise<void>) | null = null;
let databaseReady = false;
let pendingPageDeepLinkPageId: string | null = null;
let pendingPageDeepLinkTarget: { projectId: string; pageId: string } | null = null;
let pendingViewDeepLinkViewId: string | null = null;
let pendingViewDeepLinkTarget: { projectId: string; viewId: string } | null = null;
let pendingSessionDeepLinkSessionId: string | null = null;
let pendingSessionDeepLinkTarget: { projectId: string | null; sessionId: string } | null = null;
const pendingCloseResolvers = new Map<number, () => void>();
const allowImmediateWindowClose = new Set<number>();
const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 1500;
let windowSessionState: WindowSessionState | null = null;
let appQuitRequested = false;
let appInitializationStep: AppInitializationStep = { phase: "opening" };
let appInitializationStepChangedAt = performance.now();
let appInitializationPromise: Promise<void> = Promise.resolve();
const rendererInitializationReports = new Set<number>();
let appUpdateService: AppUpdateService | null = null;
let browserUseSessionRegistry: BrowserUseSessionRegistry | null = null;
let disposeBrowserUseSessionRegistryBridge: (() => void) | null = null;
let scheduledAutomationScheduler: CodexScheduledAutomationScheduler | null = null;
let appPermissionHandlersRegistered = false;
let browserPermissionHandlersRegistered = false;
let rendererClientRouter: RendererClientRouter | null = null;
let desktopDataAuthorityRuntime: DesktopDataAuthorityRuntime | null = null;
let desktopAutomationModule: DesktopAutomationModulePort | null = null;
let desktopLibraryModule: DesktopLibraryModuleBridge | null = null;
let desktopStoreAdministration: DesktopStoreAdministrationPort | null = null;
let coreEventSubscription: CoreEventSubscription | null = null;
let coreAuthorityStatus: CoreAuthorityStatus = { kind: "ready" };
let releaseCoreAuthorityStatus: (() => void) | null = null;
let storeAdministrationBackupScheduler: StoreAdministrationBackupScheduler | null = null;
let storeAdministrationMaintenanceScheduler:
  StoreAdministrationMaintenanceScheduler | null = null;
let reminderResumeHandlerRegistered = false;
const desktopNotificationManager = new DesktopNotificationManager();
const logger = getLogger({ subsystem: "app" });

const isCoreAuthorityReady = (): boolean => coreAuthorityStatus.kind === "ready";

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
    isAuthorityAvailable: isCoreAuthorityReady,
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

  openNewWindow();
}

function openNewWindow(sourceWebContentsId?: number): BrowserWindow | null {
  if (!rendererHostReadyForWindows || !windowSessionState) return null;
  let acquired: AcquiredWindowSession | null = null;

  try {
    acquired = windowSessionState.acquireSessionForNewWindow(sourceWebContentsId);
    const window = createWindow({
      session: acquired.session,
    });
    window.show();
    window.focus();
    return window;
  } catch (error) {
    if (acquired?.kind === "reopened") {
      try {
        windowSessionState.rollbackReopenSession(acquired.previousRecord);
      } catch (rollbackError) {
        logger.error("Could not roll back failed Window Session acquisition", {
          error: rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
          windowSessionId: acquired.session.id,
        });
        captureMainException(rollbackError, {
          tags: {
            phase: "window-session-acquisition-rollback",
          },
        });
      }
    }
    logger.error("Could not open a new window", {
      error: error instanceof Error ? error.message : String(error),
      windowSessionId: acquired?.session.id,
    });
    captureMainException(error, {
      tags: {
        phase: "window-session-acquisition",
      },
    });
    return null;
  }
}

function requestNewWindowFromActiveWindow(): void {
  if (windowSessionState?.hasClosedSessionAvailable()) {
    openNewWindow();
    return;
  }
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? getLastFocusedWindow();
  if (!sourceWindow || sourceWindow.isDestroyed()) {
    openNewWindow();
    return;
  }
  const sourceWebContentsId = sourceWindow.webContents.id;
  if (
    rendererInitializationReports.has(sourceWebContentsId)
    && safeSendToWindow(sourceWindow, REQUEST_NEW_WINDOW_HOST_CHANNEL)
  ) {
    return;
  }
  openNewWindow(sourceWebContentsId);
}

function openClonedWindow(
  sourceWebContentsId: number,
  override: WindowSessionNewWindowRequest,
): BrowserWindow | null {
  if (!rendererHostReadyForWindows || !windowSessionState) return null;
  const session = windowSessionState.cloneSessionForWindow(
    sourceWebContentsId,
    override,
  );
  const window = createWindow({ session });
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

async function installCommandLineTool(): Promise<void> {
  try {
    const result = installCliCommand({
      environmentPath: process.env.PATH,
      sourcePath: join(process.resourcesPath, "bin/nodex"),
      targetPath: join(app.getPath("home"), ".local/bin/nodex"),
    });
    const statusMessage = result.status === "already-installed"
      ? "The Nodex command line tool is already installed."
      : result.status === "updated"
        ? "The Nodex command line tool was updated."
        : "The Nodex command line tool was installed.";
    const pathMessage = result.pathConfigured
      ? `Run it as:\n\nnodex --help\n\nInstalled link: ${result.targetPath}`
      : `Installed link: ${result.targetPath}\n\nAdd this line to your shell profile, then open a new terminal:\n\nexport PATH="$HOME/.local/bin:$PATH"`;
    await dialog.showMessageBox({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: statusMessage,
      detail: pathMessage,
    });
    await runAgentSkillSetup({
      cliPath: result.sourcePath,
      onlyWhenMissing: true,
      pathConfigured: result.pathConfigured,
      showMessageBox: (options) => dialog.showMessageBox(options),
    });
  } catch (error) {
    logger.error("Could not install the Nodex command line tool", { error });
    await dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "Could not install the Nodex command line tool.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function setupAgentSkills(): Promise<void> {
  await runAgentSkillSetup({
    cliPath: join(process.resourcesPath, "bin/nodex"),
    showMessageBox: (options) => dialog.showMessageBox(options),
  });
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
        requestNewWindowFromActiveWindow();
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
  const setupEnabled = app.isPackaged
    && (typeof app.isInApplicationsFolder !== "function"
      || app.isInApplicationsFolder());

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
        ...buildNodexSetupMenuItems({
          enabled: setupEnabled,
          onInstallCli: () => {
            void installCommandLineTool();
          },
          onSetupAgentSkills: () => {
            void setupAgentSkills();
          },
        }),
      ],
    } satisfies MenuItemConstructorOptions] : []),
    buildWindowFileMenu({
      commandKeymapState,
      onNewWindow: () => {
        requestNewWindowFromActiveWindow();
      },
      onCloseWindow: closeFocusedWindow,
    }),
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

function toRendererCoreAuthorityStatus(
  state: CoreAuthorityState,
): CoreAuthorityStatus {
  if (state.kind === "ready") return { kind: "ready" };
  if (state.kind === "recovering") {
    return { attempt: state.attempt, kind: "recovering" };
  }
  if (state.kind === "stopped") {
    return {
      circuitOpen: false,
      kind: "unavailable",
      message: "Nodex Core has stopped.",
    };
  }
  return {
    circuitOpen: state.circuitOpen,
    kind: "unavailable",
    message: state.circuitOpen
      ? "Nodex Core stopped repeatedly, so automatic recovery was paused."
      : "Nodex Core could not reconnect.",
  };
}

function publishCoreAuthorityStatus(state: CoreAuthorityState): void {
  const next = toRendererCoreAuthorityStatus(state);
  const previous = coreAuthorityStatus;
  if (
    previous.kind === next.kind
    && (
      next.kind === "ready"
      || (
        previous.kind === "recovering"
        && next.kind === "recovering"
        && previous.attempt === next.attempt
      )
      || (
        previous.kind === "unavailable"
        && next.kind === "unavailable"
        && previous.circuitOpen === next.circuitOpen
        && previous.message === next.message
      )
    )
  ) return;
  coreAuthorityStatus = next;
  if (next.kind === "recovering") {
    logger.warn("Native Core generation recovery started", {
      attempt: next.attempt,
    });
  } else if (next.kind === "unavailable") {
    logger.error("Native Core authority is unavailable", {
      circuitOpen: next.circuitOpen,
    });
  } else if (previous.kind !== "ready") {
    logger.info("Native Core authority recovered");
    void runtimeReminderTick?.();
    void scheduledAutomationScheduler?.tick();
  }
  broadcastToWindows(CORE_AUTHORITY_STATUS_CHANNEL, next);
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
  ipcMain.removeHandler(GET_CORE_AUTHORITY_STATUS_CHANNEL);
  ipcMain.handle(GET_CORE_AUTHORITY_STATUS_CHANNEL, () => coreAuthorityStatus);
  ipcMain.removeHandler(RETRY_CORE_AUTHORITY_CHANNEL);
  ipcMain.handle(RETRY_CORE_AUTHORITY_CHANNEL, async (event) => {
    if (!openWindows.has(event.sender.id)) {
      throw new Error("Core recovery requires an active Nodex window");
    }
    const runtime = desktopDataAuthorityRuntime;
    if (!runtime) throw new Error("Native Core authority is not initialized");
    await runtime.retryCoreNow();
  });
  ipcMain.removeHandler(RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL);
  ipcMain.handle(RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL, (event) => {
    if (!openWindows.has(event.sender.id)) {
      throw new Error("Core relaunch requires an active Nodex window");
    }
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 0);
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

function flushPendingViewDeepLink(): void {
  if (!pendingViewDeepLinkTarget) {
    return;
  }

  const targetWindow = getLastFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.webContents.isDestroyed() || targetWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  if (safeSendToWindow(targetWindow, "deeplink:open-view", [pendingViewDeepLinkTarget])) {
    pendingViewDeepLinkTarget = null;
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

async function resolvePendingViewDeepLink(): Promise<void> {
  if (!databaseReady) {
    return;
  }

  if (!pendingViewDeepLinkViewId) {
    flushPendingViewDeepLink();
    return;
  }

  const viewId = pendingViewDeepLinkViewId;
  const location = desktopLibraryModule
    ? await desktopLibraryModule.findViewLocation(viewId)
    : null;
  if (pendingViewDeepLinkViewId !== viewId) {
    return;
  }
  pendingViewDeepLinkViewId = null;
  if (!location) {
    return;
  }

  pendingViewDeepLinkTarget = {
    projectId: location.projectId,
    viewId,
  };

  flushPendingViewDeepLink();
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

function queueViewDeepLink(viewId: string): void {
  pendingViewDeepLinkViewId = viewId;

  if (!databaseReady) {
    return;
  }

  focusLastWindow();
  void resolvePendingViewDeepLink().catch((error) => {
    logger.warn("View deep-link resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function handleIncomingDeepLink(value: string): boolean {
  const sessionTarget = parseSessionDeepLink(value);
  if (sessionTarget) {
    queueSessionDeepLink(sessionTarget.sessionId);
    return true;
  }

  const viewTarget = parseViewDeepLink(value);
  if (viewTarget) {
    queueViewDeepLink(viewTarget.viewId);
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

    const viewTarget = parseViewDeepLink(arg);
    if (viewTarget) {
      queueViewDeepLink(viewTarget.viewId);
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
        `--nodex-asset-path-prefix=${encodeURIComponent(getAssetsPathPrefix())}`,
      ],
    },
  });
  composerAppshotService.observeWindow(window);
  const pendingBrowserWebviewAttachments =
    new Map<number, BrowserAuthorizedAttachment>();
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
  if (!browserPermissionHandlersRegistered) {
    const browserSession = electronSession.fromPartition(BROWSER_SIDEBAR_PARTITION);
    browserSession.setPermissionCheckHandler(
      (_webContents, permission, _origin, details) =>
        shouldGrantBrowserPermission({
          permission,
          isMainFrame: details.isMainFrame,
        }),
    );
    browserSession.setPermissionRequestHandler(
      (_webContents, permission, callback, details) => {
        callback(shouldGrantBrowserPermission({
          permission,
          isMainFrame: details.isMainFrame,
        }));
      },
    );
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const shouldBlockTopFrame =
        details.resourceType === "mainFrame"
        && !isAllowedBrowserNavigationUrl(details.url);
      callback({ cancel: shouldBlockTopFrame });
    });
    browserPermissionHandlersRegistered = true;
  }

  // Open external links in the system browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const webviewParams = params as typeof params & {
      instanceId?: number | string;
      nodeintegration?: string;
      preload?: string;
      webpreferences?: string;
    };
    const instanceId = parseBrowserWebviewInstanceId(
      webviewParams.instanceId,
    );
    if (
      instanceId === null
      || pendingBrowserWebviewAttachments.has(instanceId)
    ) {
      logger.warn("Rejected Browser webview attachment", {
        reason: instanceId === null
          ? "invalid-instance-id"
          : "duplicate-instance-id",
        webContentsId: window.webContents.id,
      });
      event.preventDefault();
      return;
    }
    const decision = decideBrowserWebviewAttachment({
      authorizeAttachment: (route) =>
        browserSidebarService.authorizeWebviewAttachment(
          window.webContents.id,
          route,
        ),
      isRegisteredBrowserStorage: (identity, browserStorageId) =>
        browserSidebarService.isRegisteredBrowserStorage(
          identity,
          browserStorageId,
        ),
      ownerBrowserViewScopeId:
        windowSessionState?.getSessionIdForWindow(window.webContents.id) ?? null,
      partition: params.partition,
      revokeAuthorizedAttachment: (attachToken) =>
        browserSidebarService.revokeAuthorizedWebviewAttachment(attachToken),
      src: params.src,
    });
    if (!decision.ok) {
      logger.warn("Rejected Browser webview attachment", {
        reason: decision.reason,
        browserConversationId: decision.route?.browserConversationId,
        browserViewScopeId: decision.route?.browserViewScopeId,
        browserTabId: decision.route?.browserTabId,
        webContentsId: window.webContents.id,
      });
      event.preventDefault();
      return;
    }
    const registration = registerPendingBrowserWebviewAttachment(
      pendingBrowserWebviewAttachments,
      instanceId,
      decision.authorization,
    );
    if (!registration.ok) {
      browserSidebarService.revokeAuthorizedWebviewAttachment(
        decision.authorization.attachToken,
      );
      logger.warn("Rejected Browser webview attachment", {
        reason: registration.reason,
        browserConversationId:
          decision.authorization.browserConversationId,
        browserViewScopeId: decision.authorization.browserViewScopeId,
        browserTabId: decision.authorization.browserTabId,
        webContentsId: window.webContents.id,
      });
      event.preventDefault();
      return;
    }
    Object.assign(webPreferences, {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: join(__dirname, "../preload/browser-guest.js"),
      plugins: false,
      partition: BROWSER_SIDEBAR_PARTITION,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    params.partition = BROWSER_SIDEBAR_PARTITION;
    delete webviewParams.nodeintegration;
    delete webviewParams.preload;
    delete webviewParams.webpreferences;
    delete (webPreferences as typeof webPreferences & { preloadURL?: string }).preloadURL;
  });
  window.webContents.on("did-attach-webview", (_event, guestWebContents) => {
    const guestWebContentsId = guestWebContents.id;
    const pendingAttachment = consumePendingBrowserWebviewAttachment(
      pendingBrowserWebviewAttachments,
      (
        guestWebContents as typeof guestWebContents & {
          viewInstanceId?: number | string;
        }
      ).viewInstanceId,
    );
    if (!pendingAttachment) {
      logger.warn("Rejected unmatched Browser webview attachment", {
        guestWebContentsId,
        ownerWebContentsId: window.webContents.id,
      });
      guestWebContents.close();
      return;
    }
    const ownership =
      browserSidebarService.consumeAuthorizedWebviewAttachment(
        pendingAttachment.attachToken,
        window.webContents.id,
        guestWebContentsId,
      );
    if (!ownership) {
      logger.warn("Rejected unauthorized Browser webview attachment", {
        browserConversationId: pendingAttachment.browserConversationId,
        browserViewScopeId: pendingAttachment.browserViewScopeId,
        browserTabId: pendingAttachment.browserTabId,
        guestWebContentsId,
        ownerWebContentsId: window.webContents.id,
      });
      guestWebContents.close();
      return;
    }
    browserSidebarService.registerAttachedWebviewOwnership(
      window.webContents.id,
      guestWebContentsId,
      ownership,
      ownership.browserStorageId,
    );
    browserSidebarService.prepareAttachedWebviewHistoryRestore(
      ownership,
      guestWebContentsId,
    );
  });

  // In dev mode, load the vite dev server URL
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  const webContentsId = window.webContents.id;
  if (!windowSessionState) {
    window.destroy();
    throw new Error("Window session state is unavailable");
  }

  let rendererClientRegistration: RendererClientRegistration | null = null;
  if (rendererClientRouter) {
    rendererClientRegistration = rendererClientRouter.register(window.webContents);
    codexService.setRendererClientForegrounded(
      rendererClientRegistration.clientId,
      window.isFocused(),
    );
  }
  syncMacWindowTitle(window);
  applyElectronWindowBackdrop(window, true);

  const refreshWindowBackdropForTheme = () => {
    applyElectronWindowBackdrop(window, true);
  };
  nativeTheme.on("updated", refreshWindowBackdropForTheme);

  if (savedBounds?.mode === "maximized") {
    window.maximize();
  } else if (savedBounds?.mode === "fullscreen") {
    window.setFullScreen(true);
  }

  let closeDisposition: WindowSessionCloseDisposition = "unexpected";
  let finalCloseBounds: WindowSessionBounds | undefined;

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
      if (window.isDestroyed()) {
        allowImmediateWindowClose.delete(webContentsId);
        return;
      }
      allowImmediateWindowClose.add(webContentsId);
      finalCloseBounds = captureWindowSessionBounds(window);
      closeDisposition = appQuitRequested ? "app-quit" : "user-close";
      window.close();
    };

    const timeout = setTimeout(finishClose, WINDOW_CLOSE_FLUSH_TIMEOUT_MS);
    pendingCloseResolvers.set(webContentsId, () => {
      clearTimeout(timeout);
      finishClose();
    });

    if (!safeSendToWindow(window, "app:flush-before-close", [webContentsId])) {
      clearTimeout(timeout);
      finishClose();
    }
  };

  window.on("close", closeHandler);
  window.on("focus", () => {
    lastFocusedWindowId = webContentsId;
    windowSessionState?.markFocused(webContentsId);
    applyElectronWindowBackdrop(window);
    safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: true }]);
    codexService.setRendererClientForegrounded(
      rendererClientRegistration?.clientId,
      true,
    );
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
    codexService.setRendererClientForegrounded(
      rendererClientRegistration?.clientId,
      false,
    );
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
    flushPendingViewDeepLink();
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
    browserSidebarService.releaseRendererOwner(webContentsId);
    codexService.setRendererClientForegrounded(
      rendererClientRegistration?.clientId,
      false,
    );
    try {
      windowSessionState?.detachWindow(webContentsId, {
        disposition: closeDisposition,
        bounds: finalCloseBounds,
      });
    } catch (error) {
      logger.error("Could not finalize Window Session close", {
        error: error instanceof Error ? error.message : String(error),
        webContentsId,
      });
      captureMainException(error, {
        tags: {
          phase: "window-session-close",
        },
        extra: {
          webContentsId,
        },
      });
    }
    rendererClientRegistration?.dispose();
    rendererClientRegistration = null;
    nativeTheme.off("updated", refreshWindowBackdropForTheme);
    pendingCloseResolvers.delete(webContentsId);
    allowImmediateWindowClose.delete(webContentsId);
    electronWindowOpaqueSurfaceModes.delete(window.id);
    rendererInitializationReports.delete(webContentsId);
    openWindows.delete(webContentsId);
    if (lastFocusedWindowId === webContentsId) {
      lastFocusedWindowId = null;
    }
  });

  try {
    windowSessionState.attachWindow(webContentsId, options.session.id);
  } catch (error) {
    window.destroy();
    throw error;
  }
  openWindows.set(webContentsId, window);
  lastFocusedWindowId = webContentsId;
  return window;
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
      storeEpoch: runtime.identity.storeEpoch,
      changeLogSeq: eventHead,
    }, "event_gap");
  }
  dbNotifier.notifyLibraryNavigationChanged({
    version: 1,
    libraryId: runtime?.identity.libraryId ?? "",
    storeEpoch: runtime?.identity.storeEpoch ?? null,
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
  authority: Promise<DesktopDataAuthorityRuntime>,
  initialProjectBootstrap: InitialProjectBootstrapService,
): Promise<void> {
  const initializationStartedAt = performance.now();
  desktopDataAuthorityRuntime = await authority;
  releaseCoreAuthorityStatus?.();
  releaseCoreAuthorityStatus =
    desktopDataAuthorityRuntime.subscribeToCoreAuthority(
      publishCoreAuthorityStatus,
    );
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
  const coreIdentity = desktopDataAuthorityRuntime.identity;
  let coreStreamInterruptionPublished = false;
  setProjectionInvalidationRouter(new ProjectionInvalidationRouter({
    libraryId: coreIdentity.libraryId,
    initialCursor: {
      storeEpoch: coreIdentity.storeEpoch,
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
    open: (after, onEvent, onResyncRequired, signal) =>
      coreClient.openEventStream(
        after,
        onEvent,
        onResyncRequired,
        signal,
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
      if (coreStreamInterruptionPublished) return;
      coreStreamInterruptionPublished = true;
      void requireProjectionRouter().resync({
        storeEpoch: coreIdentity.storeEpoch,
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
    onConnectionStateChanged: (state) => {
      if (state === "connected") coreStreamInterruptionPublished = false;
    },
  });
  void coreEventSubscription.done.catch((error) => {
    if (runtimeShutdownStarted || error instanceof CoreEventCompatibilityError) return;
    logger.error("Native Core event supervisor terminated unexpectedly", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await initialProjectBootstrap.ensureInitialProject({
    onProvisioned: async (presentation) => {
      const state = windowSessionState;
      if (!state) {
        throw new Error("Window Session state is unavailable during initial Project bootstrap");
      }
      state.seedInitialProjectPresentation(presentation);
    },
  });
  databaseReady = true;
  await resolvePendingPageDeepLink();
  await resolvePendingSessionDeepLink();
  await resolvePendingViewDeepLink();
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
    desktopDataAuthorityRuntime.identity.libraryId,
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
    if ((databaseEvent.affectedViewIds ?? []).length > 0) {
      // The Project catalog read model projects the primary Database default
      // View, so Database View structure changes must also refresh
      // projects:list consumers.
      dbNotifier.notifyProjectsChanged("update", databaseEvent.projectId);
    }
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
    isAuthorityAvailable: isCoreAuthorityReady,
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
      isAuthorityAvailable: isCoreAuthorityReady,
      readBlockRetentionCount: () => getHistorySettings().retentionCount,
    });
}

let desktopActivationHandlerRegistered = false;

function registerDesktopActivationHandler(): void {
  if (desktopActivationHandlerRegistered) return;
  desktopActivationHandlerRegistered = true;
  app.on("activate", () => {
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
    isAuthorityAvailable: isCoreAuthorityReady,
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

  if (requestsExplicitNewWindow(argv)) {
    requestNewWindowFromActiveWindow();
    return true;
  }
  focusLastWindow();
  return true;
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
  rendererHostReadyForWindows = false;
  appQuitRequested = true;
  logger.info("Nodex before-quit");
  coreEventSubscription?.close();
  coreEventSubscription = null;
  releaseCoreAuthorityStatus?.();
  releaseCoreAuthorityStatus = null;
  desktopDataAuthorityRuntime?.close();
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
    disposeManagedAssetProtocol?.();
    disposeManagedAssetProtocol = null;
    await settleRuntimeShutdownStep(
      "App updater",
      async () => {
        await appUpdateService?.dispose();
        appUpdateService = null;
      },
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    await settleRuntimeShutdownStep(
      "Remote hosted PiP",
      async () => {
        disposeRemoteHostedPipRuntime();
      },
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    await settleRuntimeShutdownStep(
      "Codex service",
      () => codexService.shutdown(),
      RUNTIME_SHUTDOWN_STEP_TIMEOUT_MS,
    );
    await settleRuntimeShutdownStep(
      "Browser Use session registry",
      async () => {
        disposeBrowserUseSessionRegistryBridge?.();
        disposeBrowserUseSessionRegistryBridge = null;
        await browserUseSessionRegistry?.dispose();
        browserUseSessionRegistry = null;
        codexService.setBrowserUseTurnLifecycle(null);
        codexService.setBrowserUseBackendAvailabilityResolver(() => []);
      },
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

  app.on("before-quit", (event) => {
    if (isRemoteHostedPipPrivacySettingsTerminationRequest()) {
      event.preventDefault();
      return;
    }
    if (runtimeShutdownCompleted) return;
    event.preventDefault();
    if (runtimeQuitContinuationStarted) return;
    runtimeQuitContinuationStarted = true;
    appQuitRequested = true;
    rendererHostReadyForWindows = false;
    void closeWindowsBeforeRuntimeShutdown(BrowserWindow.getAllWindows())
      .then(() => shutdownMainRuntime())
      .catch((error: unknown) => {
        logger.error("Runtime quit coordination failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        captureMainException(error, {
          tags: { phase: "runtime-shutdown", component: "quit-coordinator" },
        });
      })
      .finally(() => {
        runtimeShutdownCompleted = true;
        app.quit();
      });
  });

  app.on("will-quit", (event) => {
    if (runtimeShutdownCompleted) return;
    event.preventDefault();
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
  disposeManagedAssetProtocol?.();
  disposeManagedAssetProtocol = registerManagedAssetProtocol(
    electronSession.defaultSession,
    {
      logError: (message, error) => logger.warn(message, { error }),
    },
  );
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
  browserSidebarService.setPageStore(new FileBrowserPageSnapshotStore({
    filePath: join(
      app.getPath("userData"),
      "browser-sidebar-page-states.json",
    ),
  }));
  browserSidebarService.setHistoryStore(new FileBrowserHistoryStore({
    filePath: join(
      app.getPath("userData"),
      "browser-history.json",
    ),
  }));
  const browserSession = electronSession.fromPartition(BROWSER_SIDEBAR_PARTITION);
  const browserUsePolicyStore = new BrowserUsePolicyStore(
    join(getNodexHome(), "agent", "browser", "config.toml"),
  );
  await browserUsePolicyStore.initialize();
  browserSidebarService.setSiteStatusPolicy(
    new BrowserUseSiteStatusPolicyService({
      apiBaseUrl: DEFAULT_CHATGPT_BASE_URL,
      fetchImpl: async (url, init) => await net.fetch(url, init),
      getAppVersion: () => app.getVersion(),
      logger,
      readAuthStatus: async (input) =>
        await codexService.readAuthStatusForDesktopService(input),
    }),
  );
  const browserCredentialVault = new BrowserCredentialVault({
    filePath: join(
      getNodexHome(),
      "secrets",
      "browser-credentials.v1.json",
    ),
    encryption: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plaintext) => safeStorage.encryptString(plaintext),
      decryptString: (ciphertext) => safeStorage.decryptString(ciphertext),
    },
  });
  const browserCredentialService = new BrowserCredentialService({
    vault: browserCredentialVault,
    resolveGuest: (identity) => browserSidebarService.getWebContentsForTab(identity),
    resolveGuestIdentity: (webContentsId) =>
      browserSidebarService.getIdentityForWebContents(webContentsId),
    resolveGuestOwner: (webContentsId) =>
      browserSidebarService.getOwnerWebContentsIdForGuest(webContentsId),
  });
  configureBrowserProfileServices({
    credentialService: browserCredentialService,
    extensionsProvider: new BrowserExtensionsProvider(
      browserSession.extensions ?? null,
    ),
    localServerPreferencesStore: new BrowserLocalServerPreferencesStore(
      join(
        app.getPath("userData"),
        "browser-local-server-preferences.json",
      ),
    ),
    profileImporter: new BrowserProfileImporter({
      cookieStore: browserSession.cookies,
      credentialVault: browserCredentialVault,
      helper: new BrowserProfileHelperClient({
        executablePath: resolveBrowserProfileHelperExecutable({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          repositoryRoot: app.getAppPath(),
        }),
      }),
    }),
    siteInfoProvider: new BrowserSiteInfoProvider(
      browserSidebarService,
      browserSession.cookies,
    ),
    usePolicyStore: browserUsePolicyStore,
  });
  const browserRuntime = codexService.getBrowserRuntimeAvailability();
  const browserUseHostCapability = resolveBrowserUseHostCapability({
    browserRuntimeStatus: browserRuntime.status,
    environment: process.env,
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
  logger.info("Browser Use host capability resolved", {
    availableBackends: browserUseHostCapability.availableBackends,
    peerVerificationMode: browserUseHostCapability.peerAuthorizationMode,
    reason: browserUseHostCapability.status === "unavailable"
      ? browserUseHostCapability.reason
      : null,
    runtimeStatus: browserRuntime.status,
    status: browserUseHostCapability.status,
  });
  const browserUsePeerAuthorizer = createBrowserUsePeerAuthorizer({
    addonPath:
      browserUseHostCapability.status === "available"
        && browserRuntime.status === "available"
      ? browserRuntime.bundle.paths.peerAuthorization
      : null,
    mode: browserUseHostCapability.peerAuthorizationMode,
  });
  browserUseSessionRegistry = new BrowserUseSessionRegistry({
    appVersion: app.getVersion(),
    browserService: browserSidebarService,
    buildFlavor: browserRuntime.status === "available"
      ? browserRuntime.bundle.manifest.buildFlavor
      : "unavailable",
    enabled: browserUseHostCapability.status === "available",
    nativePipeEvents: {
      onAuthorizationError: (error) => {
        logger.warn("Browser Use native pipe peer authorization failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
      onInvalidMessage: (error) => {
        logger.warn("Browser Use native pipe received an invalid message", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
      onListening: () => {
        logger.info("Browser Use native pipe listening");
      },
      onRejectedSocket: (result) => {
        logger.warn("Browser Use native pipe rejected a socket peer", {
          reason: result.reason ?? "unauthorized",
        });
      },
      onRequestCompleted: (event) => {
        logger.debug("Browser Use native pipe request completed", event);
      },
      onRequestStarted: (event) => {
        logger.debug("Browser Use native pipe request started", event);
      },
      onSocketError: (error) => {
        logger.warn("Browser Use native pipe socket failed", {
          error: error.message,
        });
      },
    },
    policyStore: browserUsePolicyStore,
    socketPeerAuthorizer: browserUsePeerAuthorizer,
  });
  browserSidebarService.setBrowserUseRouteCaptureHandler(async (event) => {
    const registry = browserUseSessionRegistry;
    if (!registry || registry.availableBackends().length === 0) return;
    await registry.captureRoute({
      browserConversationId: event.browserConversationId,
      browserViewScopeId: event.browserViewScopeId,
      codexSessionId: event.codexSessionId,
      ownerWebContentsId: event.ownerWebContentsId,
      projectId: event.projectId,
    });
  });
  const ownerReleasedListener = (event: { ownerWebContentsId: number }) => {
    browserCredentialService.releaseOwner(event.ownerWebContentsId);
    void browserUseSessionRegistry?.releaseOwner(event.ownerWebContentsId);
  };
  const cursorArrivedListener = (event: {
    browserConversationId: string;
    browserViewScopeId: string;
    browserTabId: string;
    moveSequence: number;
    ownerWebContentsId: number | null;
  }) => {
    if (event.ownerWebContentsId === null) return;
    browserUseSessionRegistry?.notifyCursorArrived({
      ...event,
      ownerWebContentsId: event.ownerWebContentsId,
    });
  };
  browserSidebarService.on("browserUseOwnerReleased", ownerReleasedListener);
  browserSidebarService.on("browserUseCursorArrived", cursorArrivedListener);
  disposeBrowserUseSessionRegistryBridge = () => {
    browserSidebarService.setBrowserUseRouteCaptureHandler(null);
    codexService.setBrowserUseRoutePromoter(null);
    browserSidebarService.off("browserUseOwnerReleased", ownerReleasedListener);
    browserSidebarService.off("browserUseCursorArrived", cursorArrivedListener);
  };
  codexService.setBrowserUseBackendAvailabilityResolver(
    () => browserUseSessionRegistry?.availableBackends() ?? [],
  );
  codexService.setBrowserUseTurnLifecycle(browserUseSessionRegistry);
  codexService.setBrowserUseRoutePromoter({
    promote: async (input) => {
      await browserSidebarService.promoteBrowserUseRoute(input);
    },
  });
  const browserDownloadService = new BrowserDownloadService({
    downloadsDirectory: app.getPath("downloads"),
    isAgentControlled: (identity) =>
      browserSidebarService.isBrowserUseIdentity(identity),
    onSnapshot: (snapshot) => {
      const activeDownloadKeys = new Set(
        snapshot.downloads
          .filter((download) =>
            download.status === "starting"
            || download.status === "progressing"
            || download.status === "paused"
          )
          .map((download) =>
            `${download.browserConversationId}\0${download.browserViewScopeId}`
            + `\0${download.browserTabId}`
          ),
      );
      for (const tab of browserSidebarService.getStateSnapshot().tabs) {
        browserSidebarService.setDownloadActive(
          tab,
          activeDownloadKeys.has(
            `${tab.browserConversationId}\0${tab.browserViewScopeId}`
            + `\0${tab.browserTabId}`,
          ),
        );
      }
      for (const browserWindow of BrowserWindow.getAllWindows()) {
        safeSendToWindow(browserWindow, "browser-downloads-state", [snapshot]);
      }
    },
    resolveIdentity: (webContentsId) =>
      browserSidebarService.getIdentityForWebContents(webContentsId),
    shell,
    store: new FileBrowserDownloadStore(join(
      app.getPath("userData"),
      "browser-downloads.json",
    )),
  });
  configureBrowserDownloadService(browserDownloadService);
  void browserDownloadService.initialize(
    browserSession,
  ).catch((error) => {
    logger.error("Could not initialize Browser download history", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const packagedMacAppUpdater = (() => {
    if (!app.isPackaged || process.platform !== "darwin") return null;
    if (process.arch !== "arm64" && process.arch !== "x64") return null;
    try {
      return createPackagedMacAppUpdater({
        applicationBundlePath: resolve(process.resourcesPath, "..", ".."),
        architecture: process.arch,
        resourcesPath: process.resourcesPath,
      });
    } catch (error) {
      logger.error("Packaged Sparkle runtime is invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  appUpdateService = new AppUpdateService({
    currentVersion: app.getVersion(),
    isInApplicationsFolder: process.platform !== "darwin"
      || typeof app.isInApplicationsFolder !== "function"
      || app.isInApplicationsFolder(),
    isPackaged: app.isPackaged,
    logger,
    platform: process.platform,
    updater: packagedMacAppUpdater,
  });
  appUpdateService.onStatusChange((status) => {
    broadcastAppUpdateStatus(status);
  });
  appUpdateService.initialize();

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
  const documentSync = createDesktopDocumentSyncBridge({
    authority: dataAuthority,
  });
  const libraryModule = createDesktopLibraryModuleBridge({
    authority: dataAuthority,
    resolveProjectId: (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent;
      const layout = windowSessionState
        ?.getSessionForWindow(event.sender.id)
        ?.layout;
      const sceneLocation = layout
        ? getWorkbenchSceneReturnLocation(layout.location)
        : null;
      const projectId = sceneLocation?.kind === "project"
        ? sceneLocation.projectId.trim()
        : sceneLocation?.kind === "session"
          ? sceneLocation.projectContextId?.trim()
          : null;
      if (!projectId) return null;
      return projectId;
    },
    publishDocumentCommits: documentSync.publishDocumentCommits,
  });
  desktopLibraryModule = libraryModule;
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
  const initialProjectBootstrap = new InitialProjectBootstrapService({
    projectWorkspace,
    projectsDirectory: resolveInitialProjectProjectsDirectory({
      configuredDirectory: process.env.NODEX_INITIAL_PROJECTS_DIR,
      documentsDirectory: app.getPath("documents"),
    }),
    journalPath: resolveInitialProjectJournalPath(getNodexHome()),
  });
  appInitializationPromise = initializeDesktopApp(
    dataAuthority,
    initialProjectBootstrap,
  );
  rendererHostReadyForWindows = true;
  configureApplicationMenus();
  registerInitializationIpcHandlers();
  registerProjectionStreamIpcHandlers();
  rendererClientRouter = new RendererClientRouter();
  codexService.setNodexAgentAuthorizationBroker(new NodexAgentAuthorizationBroker({
    rendererClientRouter,
    readStoreEpoch: () => {
      const runtime = desktopDataAuthorityRuntime;
      if (!runtime) return null;
      return runtime.identity.storeEpoch;
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
    onCreateWindow: (sourceWebContentsId, request) => {
      if (request.activeProjectSessionId === undefined) {
        openNewWindow(sourceWebContentsId);
        return;
      }
      openClonedWindow(sourceWebContentsId, request);
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
    onSaveWindowSessionLayout: (webContentsId, input: WindowSessionSaveLayoutInput) => {
      if (!windowSessionState) {
        throw new Error("Window session state is unavailable");
      }
      const window = openWindows.get(webContentsId);
      const session = windowSessionState.saveLayout(
        webContentsId,
        input,
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
    resolveWindowSessionId: (webContentsId) =>
      windowSessionState?.getSessionIdForWindow(webContentsId) ?? null,
    onGetAppUpdateStatus: () =>
      appUpdateService?.getStatus() ?? resolveUnsupportedAppUpdateStatus(),
    onCheckForAppUpdate: async () =>
      await (appUpdateService?.checkForUpdates("manual")
        ?? Promise.resolve(resolveUnsupportedAppUpdateStatus())),
    onInstallAppUpdate: async () => await (
      appUpdateService?.installUpdateAndRestart() ?? Promise.resolve(false)
    ),
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
    createWindow({ session });
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
