import {
  Menu,
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  systemPreferences,
  type MenuItemConstructorOptions,
} from "electron";
import { join, resolve } from "path";
import { performance } from "node:perf_hooks";
import type { TerminalRunActionRequest, TerminalSessionSnapshot } from "../shared/types";
import { registerIpcHandlers } from "./ipc-handlers";
import type { GitWorkerHostPort } from "./host-runtime/HostWorkerRuntime";
import { dbNotifier } from "./local-store/notifier";
import type { BrowserSidebarService } from "./browser-sidebar-service";
import type { CodexService } from "./codex/codex-service";
import {
  getCommandKeymapState,
  getNodexHome,
  getWindowRestoreSettings,
} from "./local-store/config";
import { NodexAgentAuthorizationBroker } from "./agent-tools/authorization-broker";
import type { AcquiredWindowSession } from "./window-session-state";
import {
  captureWindowSessionBounds,
  type WindowRuntimeService,
} from "./window-runtime/WindowRuntime";
import type {
  WindowSessionNewWindowRequest,
  WindowSessionRecord,
  WindowSessionSaveLayoutInput,
} from "../shared/window-session";
import { getLogger } from "./logging/logger";
import { closeWindowsBeforeRuntimeShutdown } from "./runtime-quit-coordinator";
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
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import {
  collectSecondInstancesForStartupReplay,
  requestsExplicitNewWindow,
} from "./main-runtime-startup-events";
import { captureMainException } from "./observability/sentry-main";
import {
  getPrimaryCommandAccelerator,
  NEXT_PANEL_TAB_COMMAND_ID,
  PREVIOUS_PANEL_TAB_COMMAND_ID,
  toElectronAccelerator,
} from "../shared/command-keybindings";
import { safeSendToWindow } from "./ipc-safe-send";
import type { RendererClientRouter } from "./codex/renderer-client-router";
import type { ApplicationWindowRuntime } from "./window-runtime/ApplicationWindowRuntime";
import {
  buildNodexSetupMenuItems,
  buildWindowFileMenu,
  buildWorkbenchViewMenu,
} from "./application-menu";
import { installCliCommand } from "./cli-command-installer";
import { runAgentSkillSetup } from "./agent-skill-setup";
import {
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
  type DesktopAutomationModulePort,
  type DesktopDatabaseModuleBridge,
  type DesktopDataAuthorityRuntime,
  type DesktopLibraryModuleBridge,
  type DesktopDocumentSyncPort,
  type DesktopStoreAdministrationPort,
  type DesktopProjectWorkspacePort,
} from "./core-client";
import { createDesktopNodexAgentV3DynamicService } from "./core-client/desktop-nodex-agent-dynamic-service";
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
let browserSidebarService: BrowserSidebarService;
let codexService: CodexService;
let deepLinkRuntime: MainRuntimeStartupContext["deepLinks"];
let applicationWindowRuntime: ApplicationWindowRuntime["Service"];

let rendererHostReadyForWindows = false;
let windowRuntime: WindowRuntimeService | null = null;
let appInitializationPromise: Promise<void> = Promise.resolve();
let appUpdateRuntime: MainRuntimeStartupContext["appUpdateRuntime"] | null = null;
let desktopDataAuthorityRuntime: DesktopDataAuthorityRuntime | null = null;
const logger = getLogger({ subsystem: "app" });

function getLastFocusedWindow(): BrowserWindow | null {
  return windowRuntime?.getLastFocused() ?? null;
}

export function focusLastWindow(): void {
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
    windowRuntime?.isRendererInitialized(sourceWebContentsId) &&
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

export async function requestHostMicrophonePermission(): Promise<void> {
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

export function awaitMainInitialization(): Promise<void> {
  return appInitializationPromise;
}

function sendReminderOpenEvent(payload: {
  projectId: string;
  pageId: string;
  occurrenceStart: string;
}): void {
  const targetWindow = getLastFocusedWindow();
  safeSendToWindow(targetWindow, "reminder:open", [payload]);
}

function registerDeepLinkProtocol(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient("nodex", process.execPath, [resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient("nodex");
}

function createWindow(options: { session: WindowSessionRecord }): BrowserWindow {
  return applicationWindowRuntime.create(options.session);
}

async function publishCoreResync(eventHead: number): Promise<void> {
  const runtime = desktopDataAuthorityRuntime;
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
  projectionDelivery: MainRuntimeStartupContext["projectionDelivery"],
  markInitializationDone: MainRuntimeStartupContext["markInitializationDone"],
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
  const coreClient = desktopDataAuthorityRuntime.rootClient;

  let coreStreamInterruptionPublished = false;
  await startCoreEvents({
    initialAfter: coreClient.handshake.commit_head,
    onEvent: projectionDelivery.deliverTail,
    onCheckpoint: projectionDelivery.observeCheckpoint,
    onResyncRequired: async (resync) => {
      projectionDelivery.resetStream("event_gap");
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
        projectionDelivery.resetStream("reconnect");
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
  await deepLinkRuntime.markReady();
  await codexService.synchronizeAutomationRuntime();
  codexService.requestManagedWorktreeRetentionSweep();
  applicationSchedulers.activate({
    openReminder: (payload) => {
      focusLastWindow();
      sendReminderOpenEvent(payload);
    },
  });
  await markInitializationDone();
  logger.info("Desktop app initialization finished", {
    authorityAndServicesMs: Math.round(performance.now() - initializationStartedAt),
    servicesMs: Math.round(performance.now() - servicesStartedAt),
  });
  await appUpdateRuntime?.markApplicationReady();
}

export function publishCoreModuleEventToNotifiers(
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

export interface MainRuntimeStartupContext {
  appUpdateRuntime: {
    readonly check: () => Promise<unknown>;
    readonly currentStatus: () => import("../shared/types").AppUpdateStatus;
    readonly markApplicationReady: () => Promise<void>;
    readonly startAutomaticChecks: () => Promise<void>;
  };
  applicationWindows: ApplicationWindowRuntime["Service"];
  applicationSchedulers: ApplicationSchedulerRuntime["Service"];
  automationModule: DesktopAutomationModulePort;
  browserSidebarService: BrowserSidebarService;
  codexService: CodexService;
  dataAuthority: Promise<DesktopDataAuthorityRuntime>;
  databaseModule: DesktopDatabaseModuleBridge;
  deepLinks: {
    readonly extractFromArgv: (argv: readonly string[]) => Promise<string | null>;
    readonly flush: () => Promise<void>;
    readonly handle: (value: string) => Promise<boolean>;
    readonly markReady: () => Promise<void>;
  };
  documentSync: DesktopDocumentSyncPort;
  gitWorkerHost: GitWorkerHostPort;
  initialArgv: string[];
  libraryModule: DesktopLibraryModuleBridge;
  markInitializationDone: () => Promise<void>;
  projectWorkspace: DesktopProjectWorkspacePort;
  projectionDelivery: {
    readonly deliverTail: (envelope: CoreEventEnvelope) => Promise<void>;
    readonly observeCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
    readonly resetStream: (reason: "event_gap" | "reconnect" | "store_epoch_changed") => void;
  };
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
  activate(): void;
  handleOpenUrl(url: string): Promise<boolean>;
  handleSecondInstance(argv: string[]): Promise<boolean>;
  prepareQuit(): Promise<void>;
  shutdown(): Promise<void>;
}

let runtimeShutdownStarted = false;
let runtimeShutdownPromise: Promise<void> | null = null;
async function handleSecondInstanceArgv(argv: string[]): Promise<boolean> {
  const handledDeepLink = Boolean(await deepLinkRuntime.extractFromArgv(argv));
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

function collectStartupDeepLinks(context: MainRuntimeStartupContext): Promise<string[][]> {
  return collectSecondInstancesForStartupReplay(context, {
    consumeArgvDeepLink: async (argv) => Boolean(await context.deepLinks.extractFromArgv(argv)),
    consumeOpenUrlDeepLink: async (url) => {
      await context.deepLinks.handle(url);
    },
  });
}

function beginMainRuntimeShutdown(): void {
  if (runtimeShutdownStarted) return;
  runtimeShutdownStarted = true;
  rendererHostReadyForWindows = false;
  windowRuntime?.beginApplicationQuit();
  appUpdateRuntime = null;
  logger.info("Nodex before-quit");
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
  windowRuntime?.beginApplicationQuit();
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
  browserSidebarService = context.browserSidebarService;
  codexService = context.codexService;
  deepLinkRuntime = context.deepLinks;
  applicationWindowRuntime = context.applicationWindows;
  appUpdateRuntime = context.appUpdateRuntime;
  windowRuntime = context.windowRuntime;
  const startupSecondInstancesWithoutDeepLinks = await collectStartupDeepLinks(context);

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
  const documentSync = context.documentSync;
  const libraryModule = context.libraryModule;
  const databaseModule = context.databaseModule;
  const projectWorkspace = context.projectWorkspace;
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
    context.projectionDelivery,
    context.markInitializationDone,
  );
  rendererHostReadyForWindows = true;
  configureApplicationMenus();
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
    browserSidebarService,
    codexService,
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
        applicationWindowRuntime.syncTitle(window);
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
        applicationWindowRuntime.syncTitle(window);
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

  const restorePolicy = getWindowRestoreSettings().policy;
  const startupSessions = context.windowRuntime.selectStartupSessions(restorePolicy);
  for (const session of startupSessions) {
    createWindow({ session });
  }

  for (const argv of startupSecondInstancesWithoutDeepLinks) {
    await handleSecondInstanceArgv(argv);
  }

  await appInitializationPromise;

  return {
    activate: focusLastWindow,
    handleOpenUrl: context.deepLinks.handle,
    handleSecondInstance: handleSecondInstanceArgv,
    prepareQuit: prepareMainRuntimeQuit,
    shutdown: shutdownMainRuntime,
  };
}
