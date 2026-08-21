import { performance } from "node:perf_hooks";
import type { TerminalRunActionRequest, TerminalSessionSnapshot } from "../shared/types";
import { registerIpcHandlers } from "./ipc-handlers";
import type { GitWorkerHostPort } from "./host-runtime/HostWorkerRuntime";
import type { BrowserSidebarService } from "./browser-sidebar-service";
import type { CodexService } from "./codex/codex-service";
import { getWindowRestoreSettings } from "./local-store/config";
import { NodexAgentAuthorizationBroker } from "./agent-tools/authorization-broker";
import { getLogger } from "./logging/logger";
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import {
  collectSecondInstancesForStartupReplay,
  requestsExplicitNewWindow,
} from "./main-runtime-startup-events";
import type { RendererClientRouter } from "./codex/renderer-client-router";
import type { ApplicationWindowRuntime } from "./window-runtime/ApplicationWindowRuntime";
import {
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
import { configureNodexAgentV3DynamicService } from "./codex/nodex-agent-dynamic-tool-runtime";
import { createDesktopNodexAgentAuthorityPort } from "./core-client/desktop-nodex-agent-authority";
import { createDesktopNodexAgentResourceAuthorityPort } from "./core-client/desktop-nodex-agent-resource-authority";
import type { ApplicationSchedulerRuntime } from "./host-runtime/ApplicationSchedulerRuntime";
import { InitialProjectBootstrapService } from "./initial-project-bootstrap-service";
const logger = getLogger({ subsystem: "app" });

async function initializeDesktopApp(
  authority: DesktopDataAuthorityRuntime,
  initialProjectBootstrap: InitialProjectBootstrapService,
  startCoreEvents: MainRuntimeStartupContext["startCoreEvents"],
  applicationSchedulers: ApplicationSchedulerRuntime["Service"],
  applicationWindows: ApplicationWindowRuntime["Service"],
  codexService: CodexService,
  coreApplicationProjection: MainRuntimeStartupContext["coreApplicationProjection"],
  deepLinks: MainRuntimeStartupContext["deepLinks"],
  projectionDelivery: MainRuntimeStartupContext["projectionDelivery"],
  markApplicationReady: MainRuntimeStartupContext["markApplicationReady"],
  markInitializationDone: MainRuntimeStartupContext["markInitializationDone"],
): Promise<void> {
  const initializationStartedAt = performance.now();
  const servicesStartedAt = performance.now();
  logger.info("Native Core authority ready", {
    ...authority.launch.timings,
    artifactValidationMs: Math.round(authority.launch.timings.artifactValidationMs),
    connectMs: Math.round(authority.launch.timings.connectMs),
    selectionMs: Math.round(authority.launch.timings.selectionMs),
    totalMs: Math.round(authority.launch.timings.totalMs),
  });
  const coreClient = authority.rootClient;

  let coreStreamInterruptionPublished = false;
  await startCoreEvents({
    initialAfter: coreClient.handshake.commit_head,
    onEvent: projectionDelivery.deliverTail,
    onCheckpoint: projectionDelivery.observeCheckpoint,
    onResyncRequired: async (resync) => {
      projectionDelivery.resetStream("event_gap");
      coreApplicationProjection.publishResync({
        commitSeq: resync.commit_head,
        libraryId: authority.identity.libraryId,
        storeEpoch: authority.identity.storeEpoch,
      });
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
      applicationWindows.seedInitialProjectPresentation(presentation);
    },
  });
  await deepLinks.markReady();
  await codexService.synchronizeAutomationRuntime();
  codexService.requestManagedWorktreeRetentionSweep();
  applicationSchedulers.activate({
    openReminder: applicationWindows.sendReminderOpen,
  });
  await markInitializationDone();
  logger.info("Desktop app initialization finished", {
    authorityAndServicesMs: Math.round(performance.now() - initializationStartedAt),
    servicesMs: Math.round(performance.now() - servicesStartedAt),
  });
  await markApplicationReady();
}

export interface MainRuntimeStartupContext {
  applicationWindows: ApplicationWindowRuntime["Service"];
  applicationSchedulers: ApplicationSchedulerRuntime["Service"];
  automationModule: DesktopAutomationModulePort;
  browserSidebarService: BrowserSidebarService;
  codexService: CodexService;
  coreApplicationProjection: {
    readonly publishResync: (input: {
      readonly commitSeq: number;
      readonly libraryId: string;
      readonly storeEpoch: string | null;
    }) => void;
  };
  dataAuthority: DesktopDataAuthorityRuntime;
  databaseModule: DesktopDatabaseModuleBridge;
  deepLinks: {
    readonly extractFromArgv: (argv: readonly string[]) => Promise<string | null>;
    readonly flush: () => Promise<void>;
    readonly handle: (value: string) => Promise<boolean>;
    readonly markReady: () => Promise<void>;
  };
  documentSync: DesktopDocumentSyncPort;
  gitWorkerHost: GitWorkerHostPort;
  initialProjectBootstrap: InitialProjectBootstrapService;
  initialArgv: string[];
  libraryModule: DesktopLibraryModuleBridge;
  markApplicationReady: () => Promise<void>;
  markInitializationDone: () => Promise<void>;
  onStoreRestored: () => void;
  projectWorkspace: DesktopProjectWorkspacePort;
  projectionDelivery: {
    readonly deliverTail: (envelope: CoreEventEnvelope) => Promise<void>;
    readonly observeCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
    readonly resetStream: (reason: "event_gap" | "reconnect" | "store_epoch_changed") => void;
  };
  rendererClientRouter: RendererClientRouter;
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

async function handleSecondInstanceArgv(
  argv: string[],
  context: Pick<MainRuntimeStartupContext, "applicationWindows" | "deepLinks">,
): Promise<boolean> {
  const handledDeepLink = Boolean(await context.deepLinks.extractFromArgv(argv));
  if (handledDeepLink) {
    return true;
  }

  if (requestsExplicitNewWindow(argv)) {
    context.applicationWindows.requestNew();
    return true;
  }
  context.applicationWindows.focusLast();
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

export async function runMainAppStartup(
  context: MainRuntimeStartupContext,
): Promise<MainRuntimeController> {
  const browserSidebarService = context.browserSidebarService;
  const codexService = context.codexService;
  const startupSecondInstancesWithoutDeepLinks = await collectStartupDeepLinks(context);

  const dataAuthorityRuntime = context.dataAuthority;
  const dataAuthority = Promise.resolve(dataAuthorityRuntime);
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
  const initialProjectBootstrap = context.initialProjectBootstrap;
  const initializationPromise = initializeDesktopApp(
    dataAuthorityRuntime,
    initialProjectBootstrap,
    context.startCoreEvents,
    context.applicationSchedulers,
    context.applicationWindows,
    codexService,
    context.coreApplicationProjection,
    context.deepLinks,
    context.projectionDelivery,
    context.markApplicationReady,
    context.markInitializationDone,
  );
  await codexService.reconcileCodexExecutionHosts().catch((error) => {
    logger.warn("Some configured SSH execution hosts are unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const notificationRendererRouter = context.rendererClientRouter;
  codexService.setNodexAgentAuthorizationBroker(
    new NodexAgentAuthorizationBroker({
      rendererClientRouter: notificationRendererRouter,
      readStoreEpoch: () => dataAuthorityRuntime.identity.storeEpoch,
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
    onStoreRestored: context.onStoreRestored,
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
    resolveWindowSessionId: context.applicationWindows.resolveSessionId,
    terminalRuntime: context.terminalRuntime,
  });

  const restorePolicy = getWindowRestoreSettings().policy;
  context.applicationWindows.openStartup(restorePolicy);

  for (const argv of startupSecondInstancesWithoutDeepLinks) {
    await handleSecondInstanceArgv(argv, context);
  }

  await initializationPromise;

  let shuttingDown = false;
  const beginShutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    context.applicationWindows.beginApplicationQuit();
    logger.info("Nodex before-quit");
  };

  return {
    activate: context.applicationWindows.focusLast,
    handleOpenUrl: context.deepLinks.handle,
    handleSecondInstance: (argv) => handleSecondInstanceArgv(argv, context),
    prepareQuit: async () => {
      if (shuttingDown) return;
      await context.applicationWindows.prepareQuit();
    },
    shutdown: async () => beginShutdown(),
  };
}
