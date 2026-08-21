import {
  Menu,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { join, resolve } from "path";
import { performance } from "node:perf_hooks";
import type { AppInitializationStep } from "../shared/app-startup";
import { APP_RENDERER_URL } from "../shared/app-renderer-policy";
import {
  CORE_AUTHORITY_STATUS_CHANNEL,
  GET_CORE_AUTHORITY_STATUS_CHANNEL,
  RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL,
  RETRY_CORE_AUTHORITY_CHANNEL,
  type CoreAuthorityStatus,
} from "../shared/core-authority-status";
import type { TerminalRunActionRequest, TerminalSessionSnapshot } from "../shared/types";
import { registerIpcHandlers } from "./ipc-handlers";
import type { GitWorkerHostPort } from "./host-runtime/HostWorkerRuntime";
import { dbNotifier } from "./local-store/notifier";
import { getMainServiceComposition } from "./main-service-composition";
import type { BrowserAuthorizedAttachment } from "./browser/browser-runtime-registry";
import { McpAppSandboxHost } from "./mcp-app/mcp-app-sandbox-host";
import {
  getCommandKeymapState,
  getNodexHome,
  getWindowRestoreSettings,
} from "./local-store/config";
import { NodexAgentAuthorizationBroker } from "./agent-tools/authorization-broker";
import type { DesktopNotificationManager } from "./desktop-notification-manager";
import { composerAppshotService } from "./composer-appshot-service";
import {
  parsePageDeepLink,
  parseSessionDeepLink,
  parseViewDeepLink,
} from "../shared/nodex-deeplink";
import {
  isWindowSessionBoundsVisible,
  type AcquiredWindowSession,
  type WindowSessionCloseDisposition,
} from "./window-session-state";
import type { WindowRuntimeService } from "./window-runtime/WindowRuntime";
import type {
  WindowSessionBounds,
  WindowSessionNewWindowRequest,
  WindowSessionRecord,
  WindowSessionSaveLayoutInput,
} from "../shared/window-session";
import { getLogger } from "./logging/logger";
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
import { BROWSER_SIDEBAR_PARTITION } from "../shared/browser-sidebar";
import { isAllowedBrowserExternalUrl } from "../shared/browser-url";
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
import { captureMainException, captureMainMessage } from "./observability/sentry-main";
import { recordDevRuntimeMetricCounter } from "./dev-runtime-metrics";
import {
  getPrimaryCommandAccelerator,
  NEXT_PANEL_TAB_COMMAND_ID,
  PREVIOUS_PANEL_TAB_COMMAND_ID,
  toElectronAccelerator,
} from "../shared/command-keybindings";
import { safeBroadcastToWindows, safeSendToWebContents, safeSendToWindow } from "./ipc-safe-send";
import {
  type RendererClientRouter,
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
import {
  createCoreProjectWorkspaceAdapter,
  createDesktopDatabaseModuleBridge,
  createDesktopLibraryModuleBridge,
  createDesktopDocumentSyncBridge,
  createDesktopProjectWorkspaceBridge,
  mapCoreAutomationEvent,
  mapCoreDatabaseEvent,
  mapCoreLibraryDatabaseEvent,
  mapCoreLibraryEvent,
  mapCoreProjectWorkspaceEvent,
  mapCoreStoreAdministrationEvent,
  type CoreAuthorizedDeliveryAtom,
  type CoreEventEnvelope,
  type CoreEventReplayRequired,
  type CoreStreamCheckpoint,
  type CoreAuthorityState,
  type DesktopAutomationModulePort,
  type DesktopDataAuthorityRuntime,
  type DesktopLibraryModuleBridge,
  type DesktopDocumentSyncPort,
  type DesktopStoreAdministrationPort,
} from "./core-client";
import { createDesktopNodexAgentV3DynamicService } from "./core-client/desktop-nodex-agent-dynamic-service";
import type { CoreAuthorityProcessExit, CoreStartupEvent } from "./core-client/core-launcher";
import { LocalCommitCoordinator } from "./core-client/local-commit-coordinator";
import { revocationsFromVisibilityDelta } from "../shared/local-commit-delivery";
import { ScopedProjectionLiveSupervisor } from "./core-client/scoped-projection-live-supervisor";
import { RecipientDeliveryRouter } from "./core-client/recipient-delivery-router";
import { LocalCommitAudienceBroker } from "./core-client/local-commit-audience-broker";
import {
  projectionScopeDeliveryAddress,
  DeliveryAddress,
  type RecipientAdmissionResult,
} from "../shared/recipient-delivery";
import {
  allProjectSessionInvalidation,
  planCoreWorkspaceNotifications,
} from "./core-client/core-project-workspace-invalidation";
import { configureNodexAgentV3DynamicService } from "./codex/nodex-agent-dynamic-tool-runtime";
import { createDesktopNodexAgentAuthorityPort } from "./core-client/desktop-nodex-agent-authority";
import { createDesktopNodexAgentResourceAuthorityPort } from "./core-client/desktop-nodex-agent-resource-authority";
import type { ApplicationSchedulerRuntime } from "./host-runtime/ApplicationSchedulerRuntime";
import { InitialProjectBootstrapService } from "./initial-project-bootstrap-service";
import { resolveInitialProjectProjectsDirectory } from "./initial-project/initial-project-filesystem";
import { resolveInitialProjectJournalPath } from "./initial-project/initial-project-journal-store";
// macOS uses the packaged bundle icon from the app resources.
// We only keep a PNG around for development Dock icon parity and non-macOS window icons.
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "../../resources/icon.png");
const appDockIcon = nativeImage.createFromPath(appIconPath);
const { browserSidebarService, codexService } = getMainServiceComposition();

let rendererHostReadyForWindows = false;
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
let windowRuntime: WindowRuntimeService | null = null;
let appQuitRequested = false;
let appInitializationStep: AppInitializationStep = { phase: "opening" };
let appInitializationStepChangedAt = performance.now();
let appInitializationPromise: Promise<void> = Promise.resolve();
const rendererInitializationReports = new Set<number>();
let appUpdateRuntime: MainRuntimeStartupContext["appUpdateRuntime"] | null = null;
let rendererClientRouter: RendererClientRouter | null = null;
let desktopDataAuthorityRuntime: DesktopDataAuthorityRuntime | null = null;
let desktopLibraryModule: DesktopLibraryModuleBridge | null = null;
let desktopDocumentSync: DesktopDocumentSyncPort | null = null;
let localCommitCoordinator: LocalCommitCoordinator | null = null;
let scopedProjectionLiveSupervisor: ScopedProjectionLiveSupervisor | null = null;
let recipientDeliveryRouter: RecipientDeliveryRouter | null = null;
let localCommitAudienceBroker: LocalCommitAudienceBroker | null = null;
let coreAuthorityStatus: CoreAuthorityStatus = { kind: "ready" };
let releaseCoreAuthorityStatus: (() => void) | null = null;
const logger = getLogger({ subsystem: "app" });
let desktopNotificationManager: DesktopNotificationManager | null = null;

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

function getLastFocusedWindow(): BrowserWindow | null {
  return windowRuntime?.getLastFocused() ?? null;
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
  const windows = windowRuntime;
  if (!rendererHostReadyForWindows || !windows) return null;
  let acquired: AcquiredWindowSession | null = null;

  try {
    acquired = windows.acquireSessionForNewWindow(sourceWebContentsId);
    const window = createWindow({
      session: acquired.session,
    });
    window.show();
    window.focus();
    return window;
  } catch (error) {
    if (acquired?.kind === "reopened") {
      try {
        windows.rollbackReopenSession(acquired.previousRecord);
      } catch (rollbackError) {
        logger.error("Could not roll back failed Window Session acquisition", {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
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
  if (windowRuntime?.hasClosedSessionAvailable()) {
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
    rendererInitializationReports.has(sourceWebContentsId) &&
    safeSendToWindow(sourceWindow, REQUEST_NEW_WINDOW_HOST_CHANNEL)
  ) {
    return;
  }
  openNewWindow(sourceWebContentsId);
}

function openClonedWindow(
  sourceWebContentsId: number,
  override: WindowSessionNewWindowRequest,
): BrowserWindow | null {
  const windows = windowRuntime;
  if (!rendererHostReadyForWindows || !windows) return null;
  const session = windows.cloneSessionForWindow(sourceWebContentsId, override);
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
    const statusMessage =
      result.status === "already-installed"
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

function configureApplicationMenus(commandKeymapState = getCommandKeymapState()): void {
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
  const setupEnabled =
    app.isPackaged &&
    (typeof app.isInApplicationsFolder !== "function" || app.isInApplicationsFolder());

  const appMenuTemplate: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            role: "appMenu",
            submenu: [
              {
                label: "Check for Updates…",
                click: () => {
                  void appUpdateRuntime?.check();
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
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
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
          accelerator: menuAccelerator(PREVIOUS_PANEL_TAB_COMMAND_ID),
          click: () => {
            sendNavigationMessage(CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL);
          },
        },
        {
          label: "Next Panel Tab",
          accelerator: menuAccelerator(NEXT_PANEL_TAB_COMMAND_ID),
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
  safeBroadcastToWindows(windowRuntime?.all() ?? [], channel, [payload]);
}

function setAppInitializationStep(step: AppInitializationStep): void {
  if (appInitializationStep.phase === "done") return;
  if (appInitializationStep.phase === "migrating" && step.phase === "opening") return;
  if (
    appInitializationStep.phase === step.phase &&
    (step.phase !== "migrating" ||
      (appInitializationStep.phase === "migrating" &&
        appInitializationStep.fromVersion === step.fromVersion &&
        appInitializationStep.toVersion === step.toVersion &&
        appInitializationStep.completed === step.completed &&
        appInitializationStep.total === step.total))
  )
    return;
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

export function publishCoreStartupEvent(event: CoreStartupEvent): void {
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
    logger.info("Native Core candidate checked", { artifactHashMs: event.artifactHashMs });
    return;
  }
  if (event.kind === "migration_progress") {
    if (appInitializationStep.phase === "migrating") {
      setAppInitializationStep({
        ...appInitializationStep,
        completed: event.completed,
        total: event.total,
      });
    }
    return;
  }
  if (event.kind === "migration_heartbeat") return;
  logger.info("Native Core Store ready", {
    createdFresh: event.createdFresh,
    migratedFromVersion: event.migratedFromVersion,
    storeOpenMs: event.storeOpenMs,
  });
  setAppInitializationStep({ phase: "opening_workspace" });
}

export function publishCoreAuthorityProcessExit(event: CoreAuthorityProcessExit): void {
  logger.error("Native Core authority process exited", {
    code: event.code,
    processId: event.processId,
    signal: event.signal,
    stderr: event.stderr || undefined,
  });
}

function toRendererCoreAuthorityStatus(state: CoreAuthorityState): CoreAuthorityStatus {
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
    previous.kind === next.kind &&
    (next.kind === "ready" ||
      (previous.kind === "recovering" &&
        next.kind === "recovering" &&
        previous.attempt === next.attempt) ||
      (previous.kind === "unavailable" &&
        next.kind === "unavailable" &&
        previous.circuitOpen === next.circuitOpen &&
        previous.message === next.message))
  )
    return;
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
  }
  broadcastToWindows(CORE_AUTHORITY_STATUS_CHANNEL, next);
}

function maybeStartAutomaticAppUpdateChecks(): void {
  if (!appUpdateRuntime) return;
  if (appInitializationStep.phase !== "done" || (windowRuntime?.count() ?? 0) === 0) {
    return;
  }
  void appUpdateRuntime.startAutomaticChecks();
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
    if (!windowRuntime?.has(event.sender.id)) {
      throw new Error("Core recovery requires an active Nodex window");
    }
    const runtime = desktopDataAuthorityRuntime;
    if (!runtime) throw new Error("Native Core authority is not initialized");
    await runtime.retryCoreNow();
  });
  ipcMain.removeHandler(RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL);
  ipcMain.handle(RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL, (event) => {
    if (!windowRuntime?.has(event.sender.id)) {
      throw new Error("Core relaunch requires an active Nodex window");
    }
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 0);
  });
  ipcMain.removeAllListeners("app:renderer-initialization-finished");
  ipcMain.on("app:renderer-initialization-finished", (event, input: unknown) => {
    if (
      !windowRuntime?.has(event.sender.id) ||
      rendererInitializationReports.has(event.sender.id)
    ) {
      return;
    }
    if (typeof input !== "object" || input === null || Array.isArray(input)) return;
    const candidate = input as { durationMs?: unknown; outcome?: unknown };
    if (
      typeof candidate.durationMs !== "number" ||
      !Number.isFinite(candidate.durationMs) ||
      candidate.durationMs < 0 ||
      candidate.durationMs > 10 * 60_000 ||
      (candidate.outcome !== "ready" && candidate.outcome !== "failed")
    )
      return;
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

const projectionIpcSubscriptions = new Map<number, ProjectionIpcSenderSubscriptions>();

function refreshScopedProjectionLiveScopes(): void {
  localCommitAudienceBroker?.refreshScopes();
}

function registerProjectionStreamIpcHandlers(): void {
  recipientDeliveryRouter ??= new RecipientDeliveryRouter({
    send: (sender, channel, envelope) => safeSendToWebContents(sender, channel, [envelope]),
  });
  const recipientRouter = recipientDeliveryRouter;
  localCommitAudienceBroker ??= new LocalCommitAudienceBroker({
    router: recipientRouter,
    onScopesChanged: (scopes) => scopedProjectionLiveSupervisor?.setScopes(scopes),
    resolveLibraryId: () => desktopDataAuthorityRuntime?.identity.libraryId ?? null,
  });
  const audienceBroker = localCommitAudienceBroker;
  const requireOwnedMainFrame = (event: Electron.IpcMainInvokeEvent): void => {
    if (event.senderFrame !== event.sender.mainFrame || !windowRuntime?.has(event.sender.id)) {
      throw new Error("Local commit audience sender is not an owned main frame");
    }
  };
  const releaseSender = (senderId: number, clearRecipientRecovery: boolean): void => {
    const state = projectionIpcSubscriptions.get(senderId);
    if (!state) return;
    projectionIpcSubscriptions.delete(senderId);
    state.sender.removeListener("destroyed", state.onDestroyed);
    for (const release of state.releases.values()) release();
    state.releases.clear();
    if (clearRecipientRecovery) audienceBroker.releaseSender(senderId);
  };
  const ensureSender = (sender: WebContents): ProjectionIpcSenderSubscriptions => {
    const existing = projectionIpcSubscriptions.get(sender.id);
    if (existing) return existing;
    const state: ProjectionIpcSenderSubscriptions = {
      sender,
      releases: new Map(),
      onDestroyed: () => releaseSender(sender.id, true),
    };
    projectionIpcSubscriptions.set(sender.id, state);
    sender.once("destroyed", state.onDestroyed);
    return state;
  };
  const unsubscribe = (senderId: number, address: DeliveryAddress) => {
    const state = projectionIpcSubscriptions.get(senderId);
    if (!state) return;
    const key = JSON.stringify(address);
    state.releases.get(key)?.();
    state.releases.delete(key);
    if (state.releases.size === 0) releaseSender(senderId, false);
  };

  ipcMain.removeHandler("local-commit-audience:subscribe");
  ipcMain.handle("local-commit-audience:subscribe", (event, address: DeliveryAddress) => {
    requireOwnedMainFrame(event);
    unsubscribe(event.sender.id, address);
    const state = ensureSender(event.sender);
    state.releases.set(JSON.stringify(address), audienceBroker.subscribe(event.sender, address));
  });

  ipcMain.removeHandler("local-commit-audience:unsubscribe");
  ipcMain.handle("local-commit-audience:unsubscribe", (event, address: DeliveryAddress) => {
    requireOwnedMainFrame(event);
    unsubscribe(event.sender.id, address);
  });

  ipcMain.removeHandler("recipient-delivery:admit");
  ipcMain.handle("recipient-delivery:admit", (event, result: RecipientAdmissionResult) => {
    requireOwnedMainFrame(event);
    return recipientRouter.admit(event.sender.id, result);
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

function createWindow(options: { session: WindowSessionRecord }): BrowserWindow {
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  composerAppshotService.observeWindow(window);
  const mcpAppSandboxHost = new McpAppSandboxHost(window.webContents, {
    allowLocalDevelopment: !app.isPackaged,
    guestPreloadPath: join(__dirname, "../preload/mcp-app-sandbox-guest.js"),
    logger: logger.child({ subsystem: "mcp-app-sandbox" }),
  });
  mcpAppSandboxHost.installForOwner();
  const pendingBrowserWebviewAttachments = new Map<number, BrowserAuthorizedAttachment>();
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
    if (mcpAppSandboxHost.handlesPartition(webviewParams.partition)) {
      mcpAppSandboxHost.handleWillAttach(event, webPreferences, webviewParams);
      return;
    }
    const instanceId = parseBrowserWebviewInstanceId(webviewParams.instanceId);
    if (instanceId === null || pendingBrowserWebviewAttachments.has(instanceId)) {
      logger.warn("Rejected Browser webview attachment", {
        reason: instanceId === null ? "invalid-instance-id" : "duplicate-instance-id",
        webContentsId: window.webContents.id,
      });
      event.preventDefault();
      return;
    }
    const decision = decideBrowserWebviewAttachment({
      authorizeAttachment: (route) =>
        browserSidebarService.authorizeWebviewAttachment(window.webContents.id, route),
      isRegisteredBrowserStorage: (identity, browserStorageId) =>
        browserSidebarService.isRegisteredBrowserStorage(identity, browserStorageId),
      ownerBrowserViewScopeId: windowRuntime?.resolveSessionId(window.webContents.id) ?? null,
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
      browserSidebarService.revokeAuthorizedWebviewAttachment(decision.authorization.attachToken);
      logger.warn("Rejected Browser webview attachment", {
        reason: registration.reason,
        browserConversationId: decision.authorization.browserConversationId,
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
    if (mcpAppSandboxHost.handleDidAttach(guestWebContents)) return;
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
    const ownership = browserSidebarService.consumeAuthorizedWebviewAttachment(
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
    browserSidebarService.prepareAttachedWebviewHistoryRestore(ownership, guestWebContentsId);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? APP_RENDERER_URL;
  void window.loadURL(rendererUrl).catch((error) => {
    logger.error("Could not load the application renderer", { error, rendererUrl });
  });

  const webContentsId = window.webContents.id;
  const windows = windowRuntime;
  if (!windows) {
    window.destroy();
    throw new Error("Window runtime is unavailable");
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
    windows.markFocused(webContentsId);
    applyElectronWindowBackdrop(window);
    safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: true }]);
    codexService.setRendererClientForegrounded(rendererClientRegistration?.clientId, true);
  });
  window.on("resize", () => {
    if (window.isDestroyed()) return;
    windows.updateBounds(webContentsId, captureWindowSessionBounds(window));
    applyElectronWindowBackdrop(window);
  });
  window.on("move", () => {
    if (window.isDestroyed()) return;
    windows.updateBounds(webContentsId, captureWindowSessionBounds(window));
    applyElectronWindowBackdrop(window);
  });
  window.on("blur", () => {
    applyElectronWindowBackdrop(window);
    safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: false }]);
    codexService.setRendererClientForegrounded(rendererClientRegistration?.clientId, false);
  });
  window.webContents.on("did-finish-load", () => {
    logger.info("Renderer document finished loading", {
      durationMs: Math.round(performance.now() - windowCreatedAt),
      webContentsId,
    });
    syncMacWindowTitle(window);
    applyElectronWindowBackdrop(window, true);
    const appUpdateStatus = appUpdateRuntime?.currentStatus();
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
    desktopNotificationManager?.dismissByOriginWebContentsId(webContentsId);
    codexService.setRendererClientForegrounded(rendererClientRegistration?.clientId, false);
    try {
      windows.release(webContentsId, {
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
  });

  try {
    windows.attach(window, options.session.id);
  } catch (error) {
    window.destroy();
    throw error;
  }
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
        detailSessionCount:
          event.detailInvalidation.kind === "sessions"
            ? event.detailInvalidation.sessionIds.length
            : 0,
        windowCount: windowRuntime?.count() ?? 0,
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
    localCommitCoordinator?.resetStream("event_gap");
  }
  dbNotifier.notifyLibraryNavigationChanged({
    version: 1,
    libraryId: runtime?.identity.libraryId ?? "",
    storeEpoch: runtime?.identity.storeEpoch ?? null,
    commitSeq: eventHead,
    changeKind: "content",
    affectedParentKeys: ["library", "catalog"],
    affectedPageIds: [],
    affectedDatabaseIds: [],
    affectedViewIds: [],
  });
  dbNotifier.notifyProjectsChanged("update");
  dbNotifier.notifyProjectSessionInvalidation(allProjectSessionInvalidation());
}

async function initializeDesktopApp(
  authority: Promise<DesktopDataAuthorityRuntime>,
  initialProjectBootstrap: InitialProjectBootstrapService,
  startCoreEvents: MainRuntimeStartupContext["startCoreEvents"],
  applicationSchedulers: ApplicationSchedulerRuntime["Service"],
): Promise<void> {
  const initializationStartedAt = performance.now();
  desktopDataAuthorityRuntime = await authority;
  releaseCoreAuthorityStatus?.();
  releaseCoreAuthorityStatus = desktopDataAuthorityRuntime.subscribeToCoreAuthority(
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
  localCommitCoordinator = new LocalCommitCoordinator({
    expectedLibraryId: coreIdentity.libraryId,
    expectedStoreEpoch: coreIdentity.storeEpoch,
    onDocument: (packet, documentId) => {
      desktopDocumentSync?.publishDocumentEffects(packet, documentId);
    },
    onProjection: () => undefined,
    onNotification: (packet, effect) => {
      const envelope: CoreEventEnvelope = {
        transport_version: coreClient.handshake.selected_transport_version,
        packet,
      };
      publishCoreModuleEventToNotifiers(envelope, effect, coreIdentity.libraryId);
    },
    onVisibility: (packet, delta) => {
      for (const revocation of revocationsFromVisibilityDelta(delta)) {
        if (revocation.resource_kind === "document") {
          desktopDocumentSync?.publishResourceRevocation(packet, revocation);
        }
      }
    },
    onError: (failure) => {
      logger.error("LocalCommit delivery lane failed", {
        lane: failure.lane,
        laneKey: failure.laneKey,
        commitSeq: failure.packet.manifest.identity.commit_seq,
        storeEpoch: failure.packet.manifest.identity.store_epoch,
        error: failure.error instanceof Error ? failure.error.message : String(failure.error),
      });
      if (failure.lane !== "projection" && failure.lane !== "visibility") return;
      localCommitAudienceBroker?.reset(
        {
          storeEpoch: failure.packet.manifest.identity.store_epoch,
          commitSeq: failure.packet.manifest.identity.commit_seq,
        },
        "integrity_failure",
        [failure.packet.delivery_address],
      );
    },
  });
  scopedProjectionLiveSupervisor = new ScopedProjectionLiveSupervisor({
    open: (scopes, onEvent, onRepair, signal) =>
      coreClient.openProjectionEventStream(scopes, onEvent, onRepair, signal),
    onPacket: (envelope) => {
      localCommitCoordinator?.admit(envelope.packet, "projection_live");
      localCommitAudienceBroker?.publish(envelope.packet);
    },
    onBarrier: (barrier, scopes, resetScopes) => {
      const storeEpochChanged = barrier.store_epoch !== coreIdentity.storeEpoch;
      localCommitAudienceBroker?.installLeases(
        barrier.recipient_leases,
        {
          storeEpoch: barrier.store_epoch,
          commitSeq: barrier.commit_head,
        },
        (storeEpochChanged ? scopes : resetScopes).map(projectionScopeDeliveryAddress),
        storeEpochChanged ? "store_epoch_replacement" : "stream_gap",
      );
    },
    onRepair: (repair) => {
      localCommitAudienceBroker?.reset(
        {
          storeEpoch: repair.store_epoch,
          commitSeq: repair.commit_head,
        },
        repair.reason === "identity_changed" ? "store_epoch_replacement" : "stream_gap",
      );
    },
    onError: (error) => {
      logger.warn("Scoped Projection live broker interrupted", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  refreshScopedProjectionLiveScopes();

  let coreStreamInterruptionPublished = false;
  await startCoreEvents({
    initialAfter: coreClient.handshake.commit_head,
    onEvent: publishCoreModuleEvent,
    onCheckpoint: (checkpoint) => {
      localCommitCoordinator?.observeCheckpoint(checkpoint);
    },
    onResyncRequired: async (resync) => {
      await publishCoreResync(resync.commit_head);
    },
    onConnectionStateChanged: (state, error) => {
      if (state === "connected") {
        coreStreamInterruptionPublished = false;
        return;
      }
      if (state === "interrupted") {
        if (coreStreamInterruptionPublished) return;
        coreStreamInterruptionPublished = true;
        localCommitCoordinator?.resetStream("reconnect");
        logger.warn("Native Core event stream interrupted; reconnecting", {
          error:
            error instanceof Error
              ? error.message
              : error === undefined
                ? undefined
                : String(error),
        });
        return;
      }
      logger.error("Native Core event supervisor terminated unexpectedly", {
        error:
          error instanceof Error ? error.message : error === undefined ? undefined : String(error),
      });
    },
  });
  await initialProjectBootstrap.ensureInitialProject({
    onProvisioned: async (presentation) => {
      const windows = windowRuntime;
      if (!windows) {
        throw new Error("Window runtime is unavailable during initial Project bootstrap");
      }
      windows.seedInitialProjectPresentation(presentation);
    },
  });
  databaseReady = true;
  await resolvePendingPageDeepLink();
  await resolvePendingSessionDeepLink();
  await resolvePendingViewDeepLink();
  await codexService.synchronizeAutomationRuntime();
  codexService.requestManagedWorktreeRetentionSweep();
  applicationSchedulers.activate({
    openReminder: (payload) => {
      focusLastWindow();
      sendReminderOpenEvent(payload);
    },
  });
  registerDesktopActivationHandler();
  setAppInitializationStep({ phase: "done" });
  logger.info("Desktop app initialization finished", {
    authorityAndServicesMs: Math.round(performance.now() - initializationStartedAt),
    servicesMs: Math.round(performance.now() - servicesStartedAt),
  });
  await appUpdateRuntime?.markApplicationReady();
}

async function publishCoreModuleEvent(envelope: CoreEventEnvelope): Promise<void> {
  if (!desktopDataAuthorityRuntime || !localCommitCoordinator) return;
  await localCommitCoordinator.admitAndWait(envelope.packet, "tailer");
}

function publishCoreModuleEventToNotifiers(
  envelope: CoreEventEnvelope,
  effect: CoreAuthorizedDeliveryAtom,
  libraryId: string,
): void {
  const administrationEvent = mapCoreStoreAdministrationEvent(effect);
  if (administrationEvent) return;
  const automationEvent = mapCoreAutomationEvent(effect);
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
    if (automationEvent.automationIds.length > 0 || automationEvent.runIds.length > 0) {
      codexService.notifyAutomationRunsUpdated({
        automationId:
          automationEvent.automationIds.length === 1
            ? (automationEvent.automationIds[0] ?? null)
            : null,
        threadId: automationEvent.runIds.length === 1 ? (automationEvent.runIds[0] ?? null) : null,
        reason: "settle",
      });
    }
    return;
  }
  const databaseEvent = mapCoreDatabaseEvent(envelope, effect, libraryId);
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
  const libraryDatabaseEvent = mapCoreLibraryDatabaseEvent(envelope, effect, libraryId);
  if (libraryDatabaseEvent) {
    dbNotifier.notifyLibraryNavigationChanged(libraryDatabaseEvent);
    return;
  }
  const libraryEvent = mapCoreLibraryEvent(envelope, effect, libraryId);
  if (libraryEvent) {
    dbNotifier.notifyLibraryNavigationChanged(libraryEvent);
    return;
  }
  const workspaceEvent = mapCoreProjectWorkspaceEvent(effect);
  if (!workspaceEvent) return;
  const notifications = planCoreWorkspaceNotifications(workspaceEvent);
  if (notifications.project) {
    dbNotifier.notifyProjectsChanged(
      notifications.project.changeType,
      notifications.project.projectId,
    );
  }
  if (notifications.invalidateStandaloneRoots) {
    dbNotifier.notifyLibraryNavigationChanged({
      version: 1,
      libraryId,
      storeEpoch: envelope.packet.manifest.identity.store_epoch,
      commitSeq: envelope.packet.manifest.identity.commit_seq,
      changeKind: "lifecycle",
      affectedParentKeys: ["standalone_roots"],
      affectedPageIds: [],
      affectedDatabaseIds: [],
      affectedViewIds: [],
    });
  }
  if (notifications.sessions) {
    dbNotifier.notifyProjectSessionInvalidation(notifications.sessions);
  }
}

let desktopActivationHandlerRegistered = false;

function registerDesktopActivationHandler(): void {
  if (desktopActivationHandlerRegistered) return;
  desktopActivationHandlerRegistered = true;
  app.on("activate", () => {
    focusLastWindow();
  });
}

export interface MainRuntimeStartupContext {
  appUpdateRuntime: {
    readonly check: () => Promise<unknown>;
    readonly currentStatus: () => import("../shared/types").AppUpdateStatus;
    readonly markApplicationReady: () => Promise<void>;
    readonly startAutomaticChecks: () => Promise<void>;
  };
  applicationSchedulers: ApplicationSchedulerRuntime["Service"];
  automationModule: DesktopAutomationModulePort;
  dataAuthority: Promise<DesktopDataAuthorityRuntime>;
  desktopNotificationManager: DesktopNotificationManager;
  gitWorkerHost: GitWorkerHostPort;
  initialArgv: string[];
  rendererClientRouter: RendererClientRouter;
  windowRuntime: WindowRuntimeService;
  startupEvents?: BootstrapRuntimeEvent[];
  storeAdministration: DesktopStoreAdministrationPort;
  startCoreEvents: (input: {
    readonly initialAfter: number;
    readonly onEvent: (event: CoreEventEnvelope) => Promise<void>;
    readonly onCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
    readonly onResyncRequired: (boundary: CoreEventReplayRequired) => Promise<void>;
    readonly onConnectionStateChanged: (
      state: "connected" | "interrupted" | "failed",
      error?: unknown,
    ) => void;
  }) => Promise<void>;
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

export interface MainRuntimeController {
  handleOpenUrl(url: string): boolean;
  handleSecondInstance(argv: string[]): boolean;
  prepareQuit(): Promise<void>;
  shutdown(): Promise<void>;
}

let runtimeShutdownStarted = false;
let runtimeShutdownPromise: Promise<void> | null = null;
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
  appUpdateRuntime = null;
  desktopNotificationManager = null;
  rendererClientRouter = null;
  logger.info("Nodex before-quit");
  scopedProjectionLiveSupervisor?.stop();
  scopedProjectionLiveSupervisor = null;
  localCommitCoordinator = null;
  desktopDocumentSync = null;
  releaseCoreAuthorityStatus?.();
  releaseCoreAuthorityStatus = null;
  for (const state of projectionIpcSubscriptions.values()) {
    state.sender.removeListener("destroyed", state.onDestroyed);
    for (const release of state.releases.values()) release();
    state.releases.clear();
  }
  projectionIpcSubscriptions.clear();
  localCommitAudienceBroker?.dispose();
  localCommitAudienceBroker = null;
  recipientDeliveryRouter = null;
  windowRuntime = null;
}

function shutdownMainRuntime(): Promise<void> {
  beginMainRuntimeShutdown();
  if (runtimeShutdownPromise) {
    return runtimeShutdownPromise;
  }

  runtimeShutdownPromise = Promise.resolve();
  return runtimeShutdownPromise;
}

async function prepareMainRuntimeQuit(): Promise<void> {
  if (runtimeShutdownStarted) return;
  appQuitRequested = true;
  rendererHostReadyForWindows = false;
  await closeWindowsBeforeRuntimeShutdown(BrowserWindow.getAllWindows());
}

/** Release any Main resources acquired before startup reached its controller handoff. */
export function shutdownFailedMainAppStartup(): Promise<void> {
  return shutdownMainRuntime();
}

export async function runMainAppStartup(
  context: MainRuntimeStartupContext,
): Promise<MainRuntimeController> {
  appUpdateRuntime = context.appUpdateRuntime;
  desktopNotificationManager = context.desktopNotificationManager;
  rendererClientRouter = context.rendererClientRouter;
  windowRuntime = context.windowRuntime;
  const startupSecondInstancesWithoutDeepLinks = collectStartupDeepLinks(context);

  logger.info("Nodex main process starting", {
    packaged: app.isPackaged,
    platform: process.platform,
    pid: process.pid,
    nodexHome: getNodexHome(),
  });
  if (process.platform === "win32") {
    app.setAppUserModelId("app.jyu.nodex");
  }
  registerDeepLinkProtocol();
  // Packaged macOS builds use the bundle icon; dev still needs an explicit Dock icon override.
  if (process.platform === "darwin" && !app.isPackaged && !appDockIcon.isEmpty()) {
    app.dock?.setIcon(appDockIcon);
  }
  setAppInitializationStep({ phase: "opening" });
  const dataAuthority = context.dataAuthority;
  codexService.setNodexAgentAuthorityPort(
    createDesktopNodexAgentAuthorityPort({
      authority: dataAuthority,
    }),
  );
  const nodexAgentResourceAuthority = createDesktopNodexAgentResourceAuthorityPort({
    authority: dataAuthority,
  });
  codexService.setNodexAgentResourceAuthorityPort(nodexAgentResourceAuthority);
  const automationModule = context.automationModule;
  codexService.setAutomationModule(automationModule);
  const storeAdministration = context.storeAdministration;
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
  desktopDocumentSync = documentSync;
  const libraryModule = createDesktopLibraryModuleBridge({
    authority: dataAuthority,
  });
  desktopLibraryModule = libraryModule;
  const databaseModule = createDesktopDatabaseModuleBridge({
    authority: dataAuthority,
  });
  const projectWorkspace = createDesktopProjectWorkspaceBridge({
    authority: dataAuthority,
  });
  browserSidebarService.setProjectSessionResolver(
    async (sessionId) => (await projectWorkspace.getProjectSession(sessionId))?.projectId ?? null,
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
    context.startCoreEvents,
    context.applicationSchedulers,
  );
  rendererHostReadyForWindows = true;
  configureApplicationMenus();
  registerInitializationIpcHandlers();
  registerProjectionStreamIpcHandlers();
  await codexService.reconcileCodexExecutionHosts().catch((error) => {
    logger.warn("Some configured SSH execution hosts are unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const notificationRendererRouter = context.rendererClientRouter;
  codexService.setNodexAgentAuthorizationBroker(
    new NodexAgentAuthorizationBroker({
      rendererClientRouter: notificationRendererRouter,
      readStoreEpoch: () => {
        const runtime = desktopDataAuthorityRuntime;
        if (!runtime) return null;
        return runtime.identity.storeEpoch;
      },
      persistProjectGrants: async (input) =>
        await nodexAgentResourceAuthority.persistProjectGrants(input),
    }),
  );
  registerIpcHandlers({
    automationModule,
    gitWorkerHost: context.gitWorkerHost,
    storeAdministration,
    onBackupSettingsChanged: context.applicationSchedulers.configureBackup,
    onStoreRestored,
    documentSync,
    projectWorkspace,
    libraryModule,
    databaseModule,
    rendererClientRouter: notificationRendererRouter,
    onHeartbeatAutomationsEnabledChanged: (input) => {
      context.applicationSchedulers.setHeartbeatAutomationsEnabled(input.enabled);
    },
    onHeartbeatAutomationThreadStateChanged: (input, rendererClientId) => {
      if (!rendererClientId) return;
      context.applicationSchedulers.setHeartbeatThreadRendererState({
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
      const windows = windowRuntime;
      if (!windows) {
        throw new Error("Window runtime is unavailable");
      }
      const session = windows.bootstrap(webContentsId);
      const window = windows.get(webContentsId);
      if (window) {
        syncMacWindowTitle(window);
      }
      return { session };
    },
    onSaveWindowSessionLayout: (webContentsId, input: WindowSessionSaveLayoutInput) => {
      const windows = windowRuntime;
      if (!windows) {
        throw new Error("Window runtime is unavailable");
      }
      const window = windows.get(webContentsId);
      const session = windows.saveLayout(
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
      windowRuntime?.updateBounds(webContentsId, bounds);
    },
    resolveWindowSessionId: (webContentsId) =>
      windowRuntime?.resolveSessionId(webContentsId) ?? null,
    onCommandKeybindingsChanged: (state) => {
      configureApplicationMenus(state);
    },
    terminalRuntime: context.terminalRuntime,
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
  const startupSessions = context.windowRuntime.selectStartupSessions(restorePolicy);
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
    prepareQuit: prepareMainRuntimeQuit,
    shutdown: shutdownMainRuntime,
  };
}
