import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { performance } from "node:perf_hooks";
import { CoreAuthority } from "../core-runtime/CoreAuthority";
import { CoreEventHub } from "../core-runtime/CoreEventHub";
import { CoreModules } from "../core-runtime/CoreModules";
import { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import { StoreAdministration } from "../core-runtime/StoreAdministration";
import { ProjectionDeliveryRuntime } from "../core-runtime/ProjectionDeliveryRuntime";
import { DesktopDocumentSessionRuntime } from "../core-client";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import { AutomationApplication } from "../automation-application/AutomationApplication";
import { AutomationExecution } from "../automation-application/AutomationExecution";
import { DatabaseModule } from "../database-application/DatabaseModule";
import { LibraryModule } from "../library-application/LibraryModule";
import { AgentImportRuntime } from "../codex-application/AgentImportRuntime";
import { ConversationCommands } from "../codex-application/ConversationCommands";
import { CodexBackgroundProcesses } from "../codex-application/CodexBackgroundProcesses";
import { CodexServerRequestResponses } from "../codex-application/CodexServerRequestResponses";
import { CodexTurnCommands } from "../codex-application/CodexTurnCommands";
import { CodexSideChatCommands } from "../codex-application/CodexSideChatCommands";
import { CodexSessionThreadLaunch } from "../codex-application/CodexSessionThreadLaunch";
import { CodexProjectSessionFork } from "../codex-application/CodexProjectSessionFork";
import { CodexRendererConversationRegistry } from "../codex-application/CodexRendererConversationRegistry";
import { CodexRendererOwnerCommands } from "../codex-application/CodexRendererOwnerCommands";
import { CodexSidebarSyncRuntime } from "../codex-application/CodexSidebarSyncRuntime";
import { CodexThreadCatalog } from "../codex-application/CodexThreadCatalog";
import { CodexThreadReadState } from "../codex-application/CodexThreadReadState";
import { CodexStructuredThreadTitle } from "../codex-application/CodexStructuredThreadTitle";
import { CodexThreadHandoffRuntime } from "../codex-application/CodexThreadHandoffRuntime";
import { CodexPendingWorktreeRuntime } from "../codex-application/CodexPendingWorktreeRuntime";
import { CodexClientThreadIdentity } from "../codex-application/CodexClientThreadIdentity";
import { CodexConversationHistoryRuntime } from "../codex-application/CodexConversationHistoryRuntime";
import { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import { CodexQueuedFollowUps } from "../codex-application/CodexQueuedFollowUps";
import { CodexQueuedFollowUpDispatcher } from "../codex-application/CodexQueuedFollowUpDispatcher";
import { CodexConversationResumeRuntime } from "../codex-application/CodexConversationResumeRuntime";
import { CodexFreshThreadLaunchRuntime } from "../codex-application/CodexFreshThreadLaunchRuntime";
import { CodexForkSidePanelTransfer } from "../codex-application/CodexForkSidePanelTransferRuntime";
import { CodexThreadGoalRuntime } from "../codex-application/CodexThreadGoalRuntime";
import { CodexManualCompactionRuntime } from "../codex-application/CodexManualCompactionRuntime";
import { CodexThreadSettingsRuntime } from "../codex-application/CodexThreadSettingsRuntime";
import { CodexThreadTitlePersistence } from "../codex-application/CodexThreadTitlePersistence";
import { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import { ManagedWorktreeCatalog } from "../codex-application/ManagedWorktreeCatalog";
import { ExecutionHostRuntime } from "../codex-application/ExecutionHostRuntime";
import { ManagedWorktreeRetentionRuntime } from "../codex-application/ManagedWorktreeRetentionRuntime";
import * as ApplicationLocalStateIpc from "../ipc/handlers/ApplicationLocalStateIpc";
import * as ApplicationSettingsIpc from "../ipc/handlers/ApplicationSettingsIpc";
import * as AutomationIpc from "../ipc/handlers/AutomationIpc";
import * as CodexPendingWorktreeIpc from "../ipc/handlers/CodexPendingWorktreeIpc";
import * as CoreDocumentIpc from "../ipc/handlers/CoreDocumentIpc";
import * as CoreMutationIpc from "../ipc/handlers/CoreMutationIpc";
import * as DatabaseProjectionIpc from "../ipc/handlers/DatabaseProjectionIpc";
import * as GitApplicationIpc from "../ipc/handlers/GitApplicationIpc";
import * as NativeShellIpc from "../ipc/handlers/NativeShellIpc";
import * as ManagedMediaIpc from "../ipc/handlers/ManagedMediaIpc";
import * as ProjectionDeliveryIpc from "../ipc/handlers/ProjectionDeliveryIpc";
import * as PageSearchIpc from "../ipc/handlers/PageSearchIpc";
import * as ProjectWorkspaceIpc from "../ipc/handlers/ProjectWorkspaceIpc";
import * as StoreAdministrationIpc from "../ipc/handlers/StoreAdministrationIpc";
import * as TerminalIpc from "../ipc/handlers/TerminalIpc";
import * as WorktreeEnvironmentIpc from "../ipc/handlers/WorktreeEnvironmentIpc";
import * as CodexWorkspaceIpc from "../ipc/handlers/CodexWorkspaceIpc";
import { GitActions } from "../git-application/GitActions";
import { WorktreeEnvironmentRuntime } from "../host-runtime/WorktreeEnvironmentRuntime";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { ProjectLifecycleCommands } from "../project-application/ProjectLifecycleCommands";
import { BrowserProfileHelperPlatform } from "../browser/browser-profile-helper-client";
import { projectSessionIdFromTerminalSessionId } from "../browser/browser-local-server-runtime";
import { BrowserApplication } from "../browser-application/BrowserApplication";
import { AppUpdateRuntime } from "../host-runtime/AppUpdateRuntime";
import { DesktopNotificationRuntime } from "../host-runtime/DesktopNotificationRuntime";
import { RendererClientRuntime } from "../host-runtime/RendererClientRuntime";
import { DictationRuntime } from "../host-runtime/DictationRuntime";
import { live as codexThreadNotificationRuntimeLive } from "../host-runtime/CodexThreadNotificationRuntime";
import { ReminderSchedulerRuntime } from "../host-runtime/ReminderSchedulerRuntime";
import { ScheduledAutomationRuntime } from "../host-runtime/ScheduledAutomationRuntime";
import { StoreAdministrationSchedulerRuntime } from "../host-runtime/StoreAdministrationSchedulerRuntime";
import { DeepLinkRuntime } from "../host-runtime/DeepLinkRuntime";
import { ApplicationInitializationRuntime } from "../host-runtime/ApplicationInitializationRuntime";
import { ApplicationMenuRuntime } from "../host-runtime/ApplicationMenuRuntime";
import { InitialProjectBootstrapRuntime } from "../initial-project/InitialProjectBootstrapRuntime";
import { getThreadNotificationSettings, getWindowRestoreSettings } from "../local-store/config";
import { makePersistedAtomStore } from "../local-store/persisted-atoms";
import { requestsExplicitNewWindow } from "../main-runtime-startup-events";
import { getLogger } from "../logging/logger";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronDesktop } from "../platform/electron/ElectronDesktop";
import { ElectronIpc, ElectronSyncIpc } from "../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import * as TerminalProjectAdmission from "../terminal-runtime/TerminalProjectAdmission";
import * as TerminalRuntimeLive from "../terminal-runtime/TerminalRuntimeLive";
import * as WindowSessionCatalog from "../window-runtime/WindowSessionCatalog";
import { WindowRuntime } from "../window-runtime/WindowRuntime";
import { MainApplication, MainApplicationError } from "./MainApplication";
import { MainConfig } from "./MainConfig";
import { MainShutdown } from "./MainShutdown";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";
import { ApplicationWindowRuntime } from "../window-runtime/ApplicationWindowRuntime";
import * as CodexApplicationLive from "./CodexApplicationLive";
import * as ConversationApplicationLive from "./ConversationApplicationLive";
import * as CoreApplicationLive from "./CoreApplicationLive";
import * as HostApplicationLive from "./HostApplicationLive";
import * as ApplicationStateLive from "./ApplicationStateLive";
import * as ApplicationOperationsLive from "./ApplicationOperationsLive";
import * as RendererIngressLive from "./RendererIngressLive";
import * as WindowApplicationLive from "./WindowApplicationLive";

const runtimeError = (operation: string, cause: unknown) =>
  new MainApplicationError({ phase: "startup", operation, cause });

const notificationLogger = getLogger({ component: "codex-thread-notification-runtime" });
const applicationLogger = getLogger({ subsystem: "app" });

/** Fully acquired production desktop application. */
export const live: Layer.Layer<
  MainApplication,
  MainApplicationError,
  | ElectronApp
  | ElectronDesktop
  | ElectronIpc
  | ElectronSyncIpc
  | ElectronSessionHost
  | ElectronWindowHost
  | FileSystem.FileSystem
  | BrowserProfileHelperPlatform
  | MainConfig
  | MainShutdown
  | ScopedCallbackRuntime
  | TerminalSessions
> = Layer.effect(
  MainApplication,
  Effect.gen(function* () {
    const desktop = yield* ElectronDesktop;
    const ipc = yield* ElectronIpc;
    const windowHost = yield* ElectronWindowHost;
    const config = yield* MainConfig;
    const shutdown = yield* MainShutdown;
    const callbacks = yield* ScopedCallbackRuntime;
    const terminals = yield* TerminalSessions;
    const runtimeScope = yield* Scope.Scope;

    return yield* Effect.interruptible(
      Effect.gen(function* () {
        const applicationKernelContext = yield* Layer.buildWithScope(
          RendererIngressLive.live.pipe(
            Layer.provideMerge(
              ApplicationOperationsLive.live.pipe(
                Layer.provideMerge(
                  ConversationApplicationLive.live.pipe(
                    Layer.provideMerge(
                      WindowApplicationLive.live.pipe(
                        Layer.provideMerge(
                          HostApplicationLive.live.pipe(
                            Layer.provideMerge(
                              CodexApplicationLive.live.pipe(
                                Layer.provideMerge(
                                  CoreApplicationLive.live.pipe(
                                    Layer.provideMerge(ApplicationStateLive.live),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("application-kernel", cause)));
        const windows = Context.get(applicationKernelContext, WindowRuntime);
        const initialization = Context.get(
          applicationKernelContext,
          ApplicationInitializationRuntime,
        );
        const authority = Context.get(applicationKernelContext, CoreAuthority);
        const coreModules = Context.get(applicationKernelContext, CoreModules);
        const automationRouting = Context.get(applicationKernelContext, AutomationRoutingIndex);
        const automationApplication = Context.get(applicationKernelContext, AutomationApplication);
        const automationExecution = Context.get(applicationKernelContext, AutomationExecution);
        const backgroundProcesses = Context.get(applicationKernelContext, CodexBackgroundProcesses);
        const projectLifecycleCommands = Context.get(
          applicationKernelContext,
          ProjectLifecycleCommands,
        );
        const managedWorktreeCatalog = Context.get(
          applicationKernelContext,
          ManagedWorktreeCatalog,
        );
        const initialProjectBootstrap = Context.get(
          applicationKernelContext,
          InitialProjectBootstrapRuntime,
        );
        const scheduledAutomations = Context.get(
          applicationKernelContext,
          ScheduledAutomationRuntime,
        );
        const projectionDelivery = Context.get(applicationKernelContext, ProjectionDeliveryRuntime);
        const coreEventHub = Context.get(applicationKernelContext, CoreEventHub);
        const reminderScheduler = Context.get(applicationKernelContext, ReminderSchedulerRuntime);
        const storeSchedulers = Context.get(
          applicationKernelContext,
          StoreAdministrationSchedulerRuntime,
        );
        const libraryModule = Context.get(applicationKernelContext, LibraryModule);
        const databaseModule = Context.get(applicationKernelContext, DatabaseModule);
        const storeAdministration = Context.get(applicationKernelContext, StoreAdministration);
        const worktreeEnvironments = Context.get(
          applicationKernelContext,
          WorktreeEnvironmentRuntime,
        );
        const documentSync = Context.get(applicationKernelContext, DesktopDocumentSessionRuntime);
        const projectWorkspace = Context.get(applicationKernelContext, ProjectWorkspace);
        const projectRuntimeLifecycle = Context.get(
          applicationKernelContext,
          ProjectRuntimeLifecycleRuntime,
        );
        const codexApplicationEvents = Context.get(
          applicationKernelContext,
          CodexApplicationEventHub,
        );
        const rendererConversations = Context.get(
          applicationKernelContext,
          CodexRendererConversationRegistry,
        );
        const threadReadState = Context.get(applicationKernelContext, CodexThreadReadState);
        const serverRequestResponses = Context.get(
          applicationKernelContext,
          CodexServerRequestResponses,
        );
        const browser = Context.get(applicationKernelContext, BrowserApplication);
        const gitActions = Context.get(applicationKernelContext, GitActions);
        const executionHosts = Context.get(applicationKernelContext, ExecutionHostRuntime);
        const appUpdates = Context.get(applicationKernelContext, AppUpdateRuntime);
        const desktopNotifications = Context.get(
          applicationKernelContext,
          DesktopNotificationRuntime,
        );
        const rendererClients = Context.get(applicationKernelContext, RendererClientRuntime);
        const dictation = Context.get(applicationKernelContext, DictationRuntime);
        const applicationWindows = Context.get(applicationKernelContext, ApplicationWindowRuntime);
        const applicationMenus = Context.get(applicationKernelContext, ApplicationMenuRuntime);
        const windowSessions = Context.get(
          applicationKernelContext,
          WindowSessionCatalog.WindowSessionCatalog,
        );
        const deepLinks = Context.get(applicationKernelContext, DeepLinkRuntime);
        const sidebarSync = Context.get(applicationKernelContext, CodexSidebarSyncRuntime);
        const structuredThreadTitle = Context.get(
          applicationKernelContext,
          CodexStructuredThreadTitle,
        );
        const threadSettingsRuntime = Context.get(
          applicationKernelContext,
          CodexThreadSettingsRuntime,
        );
        const threadGoals = Context.get(applicationKernelContext, CodexThreadGoalRuntime);
        const threadTitlePersistence = Context.get(
          applicationKernelContext,
          CodexThreadTitlePersistence,
        );
        const conversationHistory = Context.get(
          applicationKernelContext,
          CodexConversationHistoryRuntime,
        );
        const subagentCatalog = Context.get(applicationKernelContext, CodexSubagentCatalog);
        const queuedFollowUps = Context.get(applicationKernelContext, CodexQueuedFollowUps);
        const turnCommands = Context.get(applicationKernelContext, CodexTurnCommands);
        const freshThreadLaunch = Context.get(
          applicationKernelContext,
          CodexFreshThreadLaunchRuntime,
        );
        const queuedFollowUpDispatcher = Context.get(
          applicationKernelContext,
          CodexQueuedFollowUpDispatcher,
        );
        const conversationCommands = Context.get(applicationKernelContext, ConversationCommands);
        const threadCatalog = Context.get(applicationKernelContext, CodexThreadCatalog);
        const clientThreadIdentity = Context.get(
          applicationKernelContext,
          CodexClientThreadIdentity,
        );
        const forkSidePanelTransfers = Context.get(
          applicationKernelContext,
          CodexForkSidePanelTransfer,
        );
        const pendingWorktrees = Context.get(applicationKernelContext, CodexPendingWorktreeRuntime);
        const managedWorktreeRetention = Context.get(
          applicationKernelContext,
          ManagedWorktreeRetentionRuntime,
        );
        const threadHandoffRuntime = Context.get(
          applicationKernelContext,
          CodexThreadHandoffRuntime,
        );
        const agentImport = Context.get(applicationKernelContext, AgentImportRuntime);
        const manualCompaction = Context.get(
          applicationKernelContext,
          CodexManualCompactionRuntime,
        );
        const projectSessionFork = Context.get(applicationKernelContext, CodexProjectSessionFork);
        const rendererOwnerCommands = Context.get(
          applicationKernelContext,
          CodexRendererOwnerCommands,
        );
        const sideChatCommands = Context.get(applicationKernelContext, CodexSideChatCommands);
        const sessionThreadLaunch = Context.get(applicationKernelContext, CodexSessionThreadLaunch);
        const conversationResume = Context.get(
          applicationKernelContext,
          CodexConversationResumeRuntime,
        );
        yield* terminals.events.pipe(
          Stream.runForEach((event) => {
            if (event.channel !== "terminal-data") return Effect.void;
            const projectSessionId = projectSessionIdFromTerminalSessionId(event.payload.sessionId);
            if (!projectSessionId) return Effect.void;
            return projectWorkspace.getProjectSession(projectSessionId).pipe(
              Effect.flatMap((session) =>
                typeof session?.projectId === "string"
                  ? browser.localServers.observePtyData(session.projectId, event.payload.data)
                  : Effect.void,
              ),
              Effect.catch((cause) =>
                Effect.sync(() =>
                  applicationLogger.warn("Failed to observe terminal local-server output", {
                    cause,
                    terminalSessionId: event.payload.sessionId,
                  }),
                ),
              ),
            );
          }),
          Effect.forkIn(runtimeScope),
        );
        yield* applicationWindows.rendererLoaded.pipe(
          Stream.runForEach(() =>
            Effect.all([deepLinks.flush, appUpdates.startAutomaticChecks], {
              concurrency: 2,
            }).pipe(Effect.asVoid),
          ),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        yield* deepLinks.extractFromArgv(config.argv);
        applicationWindows.openStartup(getWindowRestoreSettings().policy);
        const persistedAtoms = makePersistedAtomStore(config.nodexHome);
        yield* threadHandoffRuntime.recover().pipe(
          Effect.catch((cause) =>
            Effect.sync(() => applicationLogger.error("Task handoff recovery failed", { cause })),
          ),
          Effect.forkIn(runtimeScope, { startImmediately: true }),
          Effect.asVoid,
        );
        yield* SubscriptionRef.changes(executionHosts.activeSshHosts).pipe(
          Stream.runForEach(() => Effect.sync(sidebarSync.invalidate)),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        yield* Layer.buildWithScope(
          CodexPendingWorktreeIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexClientThreadIdentity, clientThreadIdentity),
                Layer.succeed(CodexForkSidePanelTransfer, forkSidePanelTransfers),
                Layer.succeed(CodexPendingWorktreeRuntime, pendingWorktrees),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CoreDocumentIpc.live({
            documents: documentSync,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(DatabaseModule, databaseModule),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(LibraryModule, libraryModule),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CoreMutationIpc.live({
            documents: documentSync,
            rendererClients,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(DatabaseModule, databaseModule),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(LibraryModule, libraryModule),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          DatabaseProjectionIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(DatabaseModule, databaseModule),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ProjectWorkspaceIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(BrowserApplication, browser),
                Layer.succeed(CodexProjectSessionFork, projectSessionFork),
                Layer.succeed(CodexThreadTitlePersistence, threadTitlePersistence),
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ProjectLifecycleCommands, projectLifecycleCommands),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          AutomationIpc.live({
            rendererClients,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationApplication, automationApplication),
                Layer.succeed(AutomationExecution, automationExecution),
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ScheduledAutomationRuntime, scheduledAutomations),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          StoreAdministrationIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(MainShutdown, shutdown),
                Layer.succeed(StoreAdministration, storeAdministration),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          NativeShellIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ManagedMediaIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          GitApplicationIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(GitActions, gitActions),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ApplicationLocalStateIpc.live({ persistedAtoms }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          PageSearchIpc.live({}).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(LibraryModule, libraryModule),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ProjectionDeliveryIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ProjectionDeliveryRuntime, projectionDelivery),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ApplicationSettingsIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ApplicationMenuRuntime, applicationMenus),
                Layer.succeed(DictationRuntime, dictation),
                Layer.succeed(StoreAdministrationSchedulerRuntime, storeSchedulers),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );

        const terminalDependencies = Layer.mergeAll(
          Layer.succeed(ElectronIpc, ipc),
          Layer.succeed(ElectronWindowHost, windowHost),
          Layer.succeed(ScopedCallbackRuntime, callbacks),
          Layer.succeed(TerminalSessions, terminals),
          TerminalProjectAdmission.live.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
              ),
            ),
          ),
          Layer.succeed(WindowSessionCatalog.WindowSessionCatalog, windowSessions),
        );
        yield* Layer.buildWithScope(
          TerminalIpc.live.pipe(Layer.provide(terminalDependencies)),
          runtimeScope,
        );

        const initializationStartedAt = performance.now();
        const initialize = Effect.gen(function* () {
          applicationLogger.info("Native Core authority ready", {
            ...authority.initialLaunch.timings,
            artifactValidationMs: Math.round(authority.initialLaunch.timings.artifactValidationMs),
            connectMs: Math.round(authority.initialLaunch.timings.connectMs),
            selectionMs: Math.round(authority.initialLaunch.timings.selectionMs),
            totalMs: Math.round(authority.initialLaunch.timings.totalMs),
          });
          let coreStreamInterruptionPublished = false;
          yield* SubscriptionRef.changes(coreEventHub.connection).pipe(
            Stream.runForEach((connection) => {
              if (connection.kind === "ready") {
                coreStreamInterruptionPublished = false;
                return Effect.void;
              }
              if (connection.kind === "backing-off") {
                if (coreStreamInterruptionPublished) return Effect.void;
                coreStreamInterruptionPublished = true;
                return projectionDelivery
                  .resetStream("reconnect")
                  .pipe(
                    Effect.andThen(
                      Effect.sync(() =>
                        applicationLogger.warn(
                          "Native Core event stream interrupted; reconnecting",
                          { error: connection.error },
                        ),
                      ),
                    ),
                  );
              }
              if (connection.kind === "failed") {
                return Effect.sync(() =>
                  applicationLogger.error("Native Core event supervisor terminated unexpectedly", {
                    error: connection.error,
                  }),
                );
              }
              return Effect.void;
            }),
            Effect.forkIn(runtimeScope),
            Effect.asVoid,
          );
          yield* initialProjectBootstrap
            .ensure((presentation) =>
              Effect.sync(() => applicationWindows.seedInitialProjectPresentation(presentation)),
            )
            .pipe(Effect.mapError((cause) => runtimeError("initial-project-bootstrap", cause)));
          yield* deepLinks.markReady;
          yield* automationRouting.synchronize.pipe(
            Effect.mapError((cause) => runtimeError("synchronize-automations", cause)),
          );
          yield* managedWorktreeRetention.request;
          yield* Effect.all(
            [
              reminderScheduler.activate({
                openReminder: applicationWindows.sendReminderOpen,
              }),
              scheduledAutomations.activate,
              storeSchedulers.activate,
            ],
            { concurrency: "unbounded", discard: true },
          );
        });
        const initializationFiber = yield* initialize.pipe(Effect.forkIn(runtimeScope));

        yield* executionHosts.reconcile().pipe(
          Effect.mapError((cause) => runtimeError("reconcile-execution-hosts", cause)),
          Effect.catch((error) =>
            Effect.sync(() =>
              applicationLogger.warn("Some configured SSH execution hosts are unavailable", {
                error,
              }),
            ),
          ),
        );
        yield* Layer.buildWithScope(
          WorktreeEnvironmentIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
                Layer.succeed(WorktreeEnvironmentRuntime, worktreeEnvironments),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CodexWorkspaceIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
                Layer.succeed(ManagedWorktreeCatalog, managedWorktreeCatalog),
                Layer.succeed(CodexManualCompactionRuntime, manualCompaction),
                Layer.succeed(CodexThreadGoalRuntime, threadGoals),
                Layer.succeed(CodexThreadSettingsRuntime, threadSettingsRuntime),
                Layer.succeed(CodexThreadCatalog, threadCatalog),
                Layer.succeed(CodexThreadTitlePersistence, threadTitlePersistence),
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(CodexSidebarSyncRuntime, sidebarSync),
                Layer.succeed(CodexThreadReadState, threadReadState),
                Layer.succeed(AgentImportRuntime, agentImport),
                Layer.succeed(CodexConversationHistoryRuntime, conversationHistory),
                Layer.succeed(CodexConversationResumeRuntime, conversationResume),
                Layer.succeed(CodexQueuedFollowUps, queuedFollowUps),
                Layer.succeed(CodexQueuedFollowUpDispatcher, queuedFollowUpDispatcher),
                Layer.succeed(CodexFreshThreadLaunchRuntime, freshThreadLaunch),
                Layer.succeed(CodexStructuredThreadTitle, structuredThreadTitle),
                Layer.succeed(CodexBackgroundProcesses, backgroundProcesses),
                Layer.succeed(CodexSubagentCatalog, subagentCatalog),
                Layer.succeed(CodexServerRequestResponses, serverRequestResponses),
                Layer.succeed(CodexTurnCommands, turnCommands),
                Layer.succeed(CodexSideChatCommands, sideChatCommands),
                Layer.succeed(CodexSessionThreadLaunch, sessionThreadLaunch),
                Layer.succeed(CodexRendererOwnerCommands, rendererOwnerCommands),
                Layer.succeed(RendererClientRuntime, rendererClients),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Fiber.join(initializationFiber);
        yield* initialization.markDone;
        applicationLogger.info("Desktop app initialization finished", {
          durationMs: Math.round(performance.now() - initializationStartedAt),
        });
        yield* appUpdates.markApplicationReady;

        const application = MainApplication.of({
          activate: Effect.sync(applicationWindows.focusLast),
          handleBootstrapEvent: (event) => {
            if (event.type === "open-url") {
              return deepLinks.handle(event.url).pipe(
                Effect.mapError((cause) => runtimeError("handle-open-url", cause)),
                Effect.asVoid,
              );
            }
            return deepLinks.extractFromArgv(event.argv).pipe(
              Effect.tap((handled) =>
                handled
                  ? Effect.void
                  : Effect.sync(() => {
                      if (requestsExplicitNewWindow([...event.argv])) {
                        applicationWindows.requestNew();
                        return;
                      }
                      applicationWindows.focusLast();
                    }),
              ),
              Effect.mapError((cause) => runtimeError("handle-second-instance", cause)),
              Effect.asVoid,
            );
          },
        });
        yield* Layer.buildWithScope(
          codexThreadNotificationRuntimeLive({
            events: codexApplicationEvents,
            getSettings: getThreadNotificationSettings,
            isAppForegrounded: () => rendererConversations.hasForegroundClient(),
            isConversationPresentedInForeground: (conversationId) =>
              rendererConversations.isPresentedInForeground(conversationId),
            resolveTargetClientId: (conversationId) => {
              const presenting =
                rendererConversations.resolvePresentedSurfaceClient(conversationId);
              if (presenting) return presenting;
              const fallbackWindow = windows.getLastFocused();
              if (!fallbackWindow) return null;
              return rendererClients.getClientIdForWebContentsId(fallbackWindow.webContents.id);
            },
            showNotification: (notification, targetClientId, onAction) => {
              const webContentsId = rendererClients.getWebContentsIdForClientId(targetClientId);
              if (webContentsId === null) return;
              const targetWindow = windows.get(webContentsId);
              if (!targetWindow || targetWindow.isDestroyed()) return;
              desktopNotifications.show(notification, targetWindow.webContents, onAction);
            },
            dismissNotification: desktopNotifications.dismiss,
            dispatchAction: (targetClientId, action) =>
              rendererClients.sendToClient(targetClientId, "desktop-notification:action", [action]),
            focusTargetClient: (targetClientId) => {
              const webContentsId = rendererClients.getWebContentsIdForClientId(targetClientId);
              if (webContentsId === null) return;
              const targetWindow = windows.get(webContentsId);
              if (!targetWindow || targetWindow.isDestroyed()) return;
              if (targetWindow.isMinimized()) targetWindow.restore();
              targetWindow.show();
              targetWindow.focus();
            },
            logger: notificationLogger,
          }),
          runtimeScope,
        );
        yield* Scope.addFinalizer(
          runtimeScope,
          Effect.sync(() => {
            applicationWindows.beginApplicationQuit();
            applicationLogger.info("Nodex Main Scope closing");
          }),
        );
        return application;
      }),
    ).pipe(
      Effect.mapError((cause) =>
        Schema.is(MainApplicationError)(cause) ? cause : runtimeError("startup", cause),
      ),
    );
  }),
);

export const productionLive = live.pipe(Layer.provideMerge(TerminalRuntimeLive.live));
