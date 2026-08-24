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
import { CoreAuthority, CoreSessionAccess } from "../core-runtime/CoreAuthority";
import {
  CoreEventDelivery,
  CoreEventHub,
  live as coreEventHubLive,
} from "../core-runtime/CoreEventHub";
import { CoreModules } from "../core-runtime/CoreModules";
import { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import { StoreAdministration } from "../core-runtime/StoreAdministration";
import {
  ProjectionDeliveryRuntime,
  live as projectionDeliveryRuntimeLive,
} from "../core-runtime/ProjectionDeliveryRuntime";
import {
  CoreApplicationProjectionRuntime,
  live as coreApplicationProjectionRuntimeLive,
} from "../core-runtime/CoreApplicationProjectionRuntime";
import { DesktopDocumentSessionRuntime } from "../core-client";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import { AutomationApplication } from "../automation-application/AutomationApplication";
import {
  AutomationExecution,
  live as automationExecutionLive,
} from "../automation-application/AutomationExecution";
import { DatabaseModule } from "../database-application/DatabaseModule";
import { LibraryModule } from "../library-application/LibraryModule";
import { NodexAgentDynamicTools } from "../nodex-agent-application/NodexAgentDynamicTools";
import {
  NodexAgentProtocolTools,
  live as nodexAgentProtocolToolsLive,
} from "../nodex-agent-application/NodexAgentProtocolTools";
import { NodexAgentResourceAccess } from "../nodex-agent-application/NodexAgentResourceAccess";
import { CodexAccount } from "../codex-application/CodexAccount";
import { AgentProviderRuntime } from "../codex-application/AgentProviderRuntime";
import {
  AgentImportRuntime,
  make as makeAgentImportRuntime,
} from "../codex-application/AgentImportRuntime";
import { NodexAgentAuthorizationRuntime } from "../codex-application/NodexAgentAuthorizationRuntime";
import { CodexConnection } from "../codex-application/CodexConnection";
import { make as makeCodexConnectionLifecycle } from "../codex-application/CodexConnectionLifecycle";
import { CodexMedia } from "../codex-application/CodexMedia";
import { ComposerExternalSuggestions } from "../codex-application/ComposerExternalSuggestions";
import { ComposerCatalog } from "../codex-application/ComposerCatalog";
import { ConversationCommands } from "../codex-application/ConversationCommands";
import {
  CodexBackgroundProcesses,
  make as makeCodexBackgroundProcesses,
} from "../codex-application/CodexBackgroundProcesses";
import { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import { CodexPendingServerRequestRuntime } from "../codex-application/CodexPendingServerRequestRuntime";
import {
  CodexAppProtocolTools,
  make as makeCodexAppProtocolTools,
} from "../codex-application/CodexAppProtocolTools";
import { CodexServerRequestResponses } from "../codex-application/CodexServerRequestResponses";
import { CodexTurnCommands } from "../codex-application/CodexTurnCommands";
import {
  CodexSideChatCommands,
  make as makeCodexSideChatCommands,
} from "../codex-application/CodexSideChatCommands";
import {
  CodexSessionThreadLaunch,
  make as makeCodexSessionThreadLaunch,
} from "../codex-application/CodexSessionThreadLaunch";
import {
  CodexConversationFork,
  make as makeCodexConversationFork,
} from "../codex-application/CodexConversationFork";
import {
  CodexForkTitlePolicy,
  make as makeCodexForkTitlePolicy,
} from "../codex-application/CodexForkTitlePolicy";
import {
  CodexProjectSessionFork,
  make as makeCodexProjectSessionFork,
} from "../codex-application/CodexProjectSessionFork";
import { CodexActiveGoalContinuation } from "../codex-application/CodexActiveGoalContinuation";
import { CodexOwnerNotificationDrainRuntime } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import { CodexRendererConversationRegistry } from "../codex-application/CodexRendererConversationRegistry";
import { CodexRendererConversationCoordinator } from "../codex-application/CodexRendererConversationCoordinator";
import {
  CodexRendererOwnerCommands,
  make as makeCodexRendererOwnerCommands,
} from "../codex-application/CodexRendererOwnerCommands";
import { CodexSidebarSyncRuntime } from "../codex-application/CodexSidebarSyncRuntime";
import {
  CodexThreadCatalog,
  make as makeCodexThreadCatalog,
} from "../codex-application/CodexThreadCatalog";
import { CodexThreadReadState } from "../codex-application/CodexThreadReadState";
import { CodexGitProbe } from "../codex-application/CodexGitProbe";
import { CodexExternalAgentImportRuntime } from "../codex-application/CodexExternalAgentImportRuntime";
import { CodexHeartbeatTurnCompletion } from "../codex-application/CodexHeartbeatTurnCompletion";
import { CodexStructuredThreadTitle } from "../codex-application/CodexStructuredThreadTitle";
import { CodexInternalThreadRegistry } from "../codex-application/CodexInternalThreadRegistry";
import { CodexNotificationAdmission } from "../codex-application/CodexNotificationAdmission";
import {
  CodexThreadHandoffRuntime,
  make as makeCodexThreadHandoffRuntime,
} from "../codex-application/CodexThreadHandoffRuntime";
import { CodexThreadExecution } from "../codex-application/CodexThreadExecution";
import {
  CrossHostThreadHandoff,
  live as crossHostThreadHandoffLive,
} from "../codex-application/CrossHostThreadHandoff";
import {
  ManagedWorktreeHandoff,
  live as managedWorktreeHandoffLive,
} from "../codex-application/ManagedWorktreeHandoff";
import {
  CodexPendingWorktreeRuntime,
  make as makeCodexPendingWorktreeRuntime,
} from "../codex-application/CodexPendingWorktreeRuntime";
import {
  CodexClientThreadIdentity,
  make as makeCodexClientThreadIdentity,
} from "../codex-application/CodexClientThreadIdentity";
import {
  CodexConversationCreation,
  make as makeCodexConversationCreation,
} from "../codex-application/CodexConversationCreation";
import { CodexConversationHistoryRuntime } from "../codex-application/CodexConversationHistoryRuntime";
import { CodexConversationRelationships } from "../codex-application/CodexConversationRelationships";
import { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import { CodexConversationContext } from "../codex-application/CodexConversationContext";
import { CodexConversationProjection } from "../codex-application/CodexConversationProjection";
import { CodexThreadDirectory } from "../codex-application/CodexThreadDirectory";
import { CodexQueuedFollowUps } from "../codex-application/CodexQueuedFollowUps";
import { CodexQueuedFollowUpDispatcher } from "../codex-application/CodexQueuedFollowUpDispatcher";
import { CodexTurnAuthority } from "../codex-application/CodexTurnAuthority";
import { CodexTurnPreparation } from "../codex-application/CodexTurnPreparation";
import { CodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import {
  CodexConversationResumeRuntime,
  make as makeCodexConversationResumeRuntime,
} from "../codex-application/CodexConversationResumeRuntime";
import { CodexFreshThreadLaunchRuntime } from "../codex-application/CodexFreshThreadLaunchRuntime";
import { CodexThreadLaunchCompletion } from "../codex-application/CodexThreadLaunchCompletion";
import {
  CodexForkSidePanelTransfer,
  make as makeCodexForkSidePanelTransferRuntime,
} from "../codex-application/CodexForkSidePanelTransferRuntime";
import { CodexPostResumeGoalRuntime } from "../codex-application/CodexPostResumeGoalRuntime";
import { CodexThreadGoalRuntime } from "../codex-application/CodexThreadGoalRuntime";
import {
  CodexManualCompactionRuntime,
  live as codexManualCompactionRuntimeLive,
} from "../codex-application/CodexManualCompactionRuntime";
import { CodexThreadSettingsRuntime } from "../codex-application/CodexThreadSettingsRuntime";
import {
  CodexThreadRollbackCommands,
  make as makeCodexThreadRollbackCommands,
} from "../codex-application/CodexThreadRollbackCommands";
import { CodexThreadTitlePersistence } from "../codex-application/CodexThreadTitlePersistence";
import { CodexUserInputAutoResolution } from "../codex-application/CodexUserInputAutoResolution";
import { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import {
  CodexApplicationProtocol,
  make as makeCodexApplicationProtocol,
} from "../codex-application/CodexApplicationProtocol";
import { live as codexProtocolIngressLive } from "../codex-application/CodexProtocolIngress";
import { CodexThreadStartNotificationGate } from "../codex-application/CodexThreadStartNotificationGate";
import {
  CodexAutomationTurnCompletion,
  live as codexAutomationTurnCompletionLive,
} from "../codex-application/CodexAutomationTurnCompletion";
import {
  CodexConversationLifecycle,
  make as makeCodexConversationLifecycle,
} from "../codex-application/CodexConversationLifecycle";
import {
  CodexAutomationInbox,
  live as codexAutomationInboxLive,
} from "../codex-application/CodexAutomationInbox";
import {
  CodexOneShotServerRequests,
  live as codexOneShotServerRequestsLive,
} from "../codex-application/CodexOneShotServerRequests";
import {
  CodexProtocolNotificationProjection,
  live as codexProtocolNotificationProjectionLive,
} from "../codex-application/CodexProtocolNotificationProjection";
import {
  CodexProtocolNotificationEffects,
  make as makeCodexProtocolNotificationEffects,
} from "../codex-application/CodexProtocolNotificationEffects";
import {
  CodexThreadDurableProjection,
  make as makeCodexThreadDurableProjection,
} from "../codex-application/CodexThreadDurableProjection";
import {
  ManagedWorktreeCatalog,
  make as makeManagedWorktreeCatalog,
} from "../codex-application/ManagedWorktreeCatalog";
import { resolveCodexThreadHandoffJournalPath } from "../codex/codex-thread-handoff-journal";
import { makeCodexThreadHandoffJournalStorage } from "../platform/CodexThreadHandoffJournalStorage";
import { CodexPreferences } from "../codex-application/CodexPreferences";
import { CodexPermissions } from "../codex-application/CodexPermissions";
import { ExecutionHostRuntime } from "../codex-application/ExecutionHostRuntime";
import { ManagedWorktreeConfiguration } from "../codex-application/ExecutionHostConfiguration";
import { ManagedWorktreeRuntime } from "../codex-application/ManagedWorktreeRuntime";
import {
  ManagedWorktreeRetentionRuntime,
  live as managedWorktreeRetentionRuntimeLive,
} from "../codex-application/ManagedWorktreeRetentionRuntime";
import { CodexAttachments } from "../codex-application/CodexAttachments";
import { CodexToolRuntime } from "../codex-application/CodexToolRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import { CodexEphemeralThreadRouting } from "../codex-runtime/CodexEphemeralThreadRouting";
import { CodexApplicationRequestInbox } from "../codex-runtime/CodexApplicationRequestInbox";
import * as ApplicationLocalStateIpc from "../ipc/handlers/ApplicationLocalStateIpc";
import * as ApplicationSettingsIpc from "../ipc/handlers/ApplicationSettingsIpc";
import * as AutomationIpc from "../ipc/handlers/AutomationIpc";
import * as CodexApplicationIpc from "../ipc/handlers/CodexApplicationIpc";
import * as CodexPendingWorktreeIpc from "../ipc/handlers/CodexPendingWorktreeIpc";
import * as CodexRendererIpc from "../ipc/handlers/CodexRendererIpc";
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
import { DesktopToolRuntime } from "../host-runtime/DesktopToolRuntime";
import { GitActions } from "../git-application/GitActions";
import { WorktreeEnvironmentRuntime } from "../host-runtime/WorktreeEnvironmentRuntime";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import {
  ProjectArchiveBlockers,
  live as projectArchiveBlockersLive,
} from "../project-application/ProjectArchiveBlockers";
import {
  ProjectLifecycleCommands,
  live as projectLifecycleCommandsLive,
} from "../project-application/ProjectLifecycleCommands";
import { BrowserProfileHelperPlatform } from "../browser/browser-profile-helper-client";
import { projectSessionIdFromTerminalSessionId } from "../browser/browser-local-server-runtime";
import { BrowserApplication } from "../browser-application/BrowserApplication";
import { BrowserUseRuntime } from "../host-runtime/BrowserUseRuntime";
import { AppUpdateRuntime } from "../host-runtime/AppUpdateRuntime";
import { DesktopNotificationRuntime } from "../host-runtime/DesktopNotificationRuntime";
import { RendererClientRuntime } from "../host-runtime/RendererClientRuntime";
import { DictationRuntime } from "../host-runtime/DictationRuntime";
import * as DatabaseNotifierRuntime from "../host-runtime/DatabaseNotifierRuntime";
import { live as codexThreadNotificationRuntimeLive } from "../host-runtime/CodexThreadNotificationRuntime";
import { live as codexRendererProjectionRuntimeLive } from "../host-runtime/CodexRendererProjectionRuntime";
import {
  ReminderSchedulerRuntime,
  live as reminderSchedulerRuntimeLive,
} from "../host-runtime/ReminderSchedulerRuntime";
import {
  ScheduledAutomationRuntime,
  live as scheduledAutomationRuntimeLive,
} from "../host-runtime/ScheduledAutomationRuntime";
import {
  StoreAdministrationSchedulerRuntime,
  live as storeAdministrationSchedulerRuntimeLive,
} from "../host-runtime/StoreAdministrationSchedulerRuntime";
import { DeepLinkRuntime } from "../host-runtime/DeepLinkRuntime";
import { ApplicationInitializationRuntime } from "../host-runtime/ApplicationInitializationRuntime";
import { ApplicationMenuRuntime } from "../host-runtime/ApplicationMenuRuntime";
import {
  InitialProjectBootstrapRuntime,
  live as initialProjectBootstrapRuntimeLive,
} from "../initial-project/InitialProjectBootstrapRuntime";
import { resolveInitialProjectProjectsDirectory } from "../initial-project/initial-project-filesystem";
import { resolveInitialProjectJournalPath } from "../initial-project/initial-project-journal-store";
import {
  getBackupSettings,
  getHistorySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
} from "../local-store/config";
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
import { CODEX_INTEGRATION_CAPABILITIES } from "../../shared/codex-integration-capabilities";
import { ApplicationWindowRuntime } from "../window-runtime/ApplicationWindowRuntime";
import * as CodexApplicationLive from "./CodexApplicationLive";
import * as ConversationApplicationLive from "./ConversationApplicationLive";
import * as CoreApplicationLive from "./CoreApplicationLive";
import * as HostApplicationLive from "./HostApplicationLive";
import * as ApplicationStateLive from "./ApplicationStateLive";
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
    const fileSystem = yield* FileSystem.FileSystem;
    const runtimeScope = yield* Scope.Scope;

    return yield* Effect.interruptible(
      Effect.gen(function* () {
        const applicationKernelContext = yield* Layer.buildWithScope(
          RendererIngressLive.live.pipe(
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
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("application-kernel", cause)));
        const windows = Context.get(applicationKernelContext, WindowRuntime);
        const initialization = Context.get(
          applicationKernelContext,
          ApplicationInitializationRuntime,
        );
        const authority = Context.get(applicationKernelContext, CoreAuthority);
        const access = Context.get(applicationKernelContext, CoreSessionAccess);
        const coreModules = Context.get(applicationKernelContext, CoreModules);
        const automationRouting = Context.get(applicationKernelContext, AutomationRoutingIndex);
        const automationApplication = Context.get(applicationKernelContext, AutomationApplication);
        const libraryModule = Context.get(applicationKernelContext, LibraryModule);
        const databaseModule = Context.get(applicationKernelContext, DatabaseModule);
        const storeAdministration = Context.get(applicationKernelContext, StoreAdministration);
        const worktreeEnvironments = Context.get(
          applicationKernelContext,
          WorktreeEnvironmentRuntime,
        );
        const documentSync = Context.get(applicationKernelContext, DesktopDocumentSessionRuntime);
        const nodexAgentDynamicTools = Context.get(
          applicationKernelContext,
          NodexAgentDynamicTools,
        );
        const nodexAgentResourceAccess = Context.get(
          applicationKernelContext,
          NodexAgentResourceAccess,
        );
        const projectWorkspace = Context.get(applicationKernelContext, ProjectWorkspace);
        const projectRuntimeLifecycle = Context.get(
          applicationKernelContext,
          ProjectRuntimeLifecycleRuntime,
        );
        const ephemeralThreadRouting = Context.get(
          applicationKernelContext,
          CodexEphemeralThreadRouting,
        );
        const threadHostResolver = Context.get(applicationKernelContext, CodexThreadHostResolver);
        const conversationRuntimes = Context.get(applicationKernelContext, ConversationRuntimeMap);
        const applicationRequestInbox = Context.get(
          applicationKernelContext,
          CodexApplicationRequestInbox,
        );
        const pendingServerRequests = Context.get(
          applicationKernelContext,
          CodexPendingServerRequestRuntime,
        );
        const codexGateway = Context.get(applicationKernelContext, CodexGateway);
        const codexPlatform = Context.get(
          applicationKernelContext,
          CodexApplicationLive.CodexPlatform,
        );
        const codexRuntime = codexPlatform.runtime;
        const runtimeStateHome = codexPlatform.runtimeStateHome;
        const codexApplicationEvents = Context.get(
          applicationKernelContext,
          CodexApplicationEventHub,
        );
        const ownerNotificationDrain = Context.get(
          applicationKernelContext,
          CodexOwnerNotificationDrainRuntime,
        );
        const rendererConversations = Context.get(
          applicationKernelContext,
          CodexRendererConversationRegistry,
        );
        const threadReadState = Context.get(applicationKernelContext, CodexThreadReadState);
        const userInputAutoResolution = Context.get(
          applicationKernelContext,
          CodexUserInputAutoResolution,
        );
        const rendererConversationCoordinator = Context.get(
          applicationKernelContext,
          CodexRendererConversationCoordinator,
        );
        const serverRequestResponses = Context.get(
          applicationKernelContext,
          CodexServerRequestResponses,
        );
        const preferences = Context.get(applicationKernelContext, CodexPreferences);
        const attachments = Context.get(applicationKernelContext, CodexAttachments);
        const codexPermissions = Context.get(applicationKernelContext, CodexPermissions);
        const agentProviders = Context.get(applicationKernelContext, AgentProviderRuntime);
        const codexAccountService = Context.get(applicationKernelContext, CodexAccount);
        const composerCatalogService = Context.get(applicationKernelContext, ComposerCatalog);
        const codexConnectionService = Context.get(applicationKernelContext, CodexConnection);
        const codexToolRuntimeService = Context.get(applicationKernelContext, CodexToolRuntime);
        const browser = Context.get(applicationKernelContext, BrowserApplication);
        const browserUse = Context.get(applicationKernelContext, BrowserUseRuntime);
        const desktopToolRuntime = Context.get(applicationKernelContext, DesktopToolRuntime);
        const gitActions = Context.get(applicationKernelContext, GitActions);
        const externalSuggestions = Context.get(
          applicationKernelContext,
          ComposerExternalSuggestions,
        );
        const managedWorktreeConfiguration = Context.get(
          applicationKernelContext,
          ManagedWorktreeConfiguration,
        );
        const executionHosts = Context.get(applicationKernelContext, ExecutionHostRuntime);
        const managedWorktrees = Context.get(applicationKernelContext, ManagedWorktreeRuntime);
        const appUpdates = Context.get(applicationKernelContext, AppUpdateRuntime);
        const desktopNotifications = Context.get(
          applicationKernelContext,
          DesktopNotificationRuntime,
        );
        const rendererClients = Context.get(applicationKernelContext, RendererClientRuntime);
        const dictation = Context.get(applicationKernelContext, DictationRuntime);
        const codexMedia = Context.get(applicationKernelContext, CodexMedia);
        const databaseNotifications = Context.get(
          applicationKernelContext,
          DatabaseNotifierRuntime.DatabaseNotifierRuntime,
        );
        const applicationWindows = Context.get(applicationKernelContext, ApplicationWindowRuntime);
        const applicationMenus = Context.get(applicationKernelContext, ApplicationMenuRuntime);
        const windowSessions = Context.get(
          applicationKernelContext,
          WindowSessionCatalog.WindowSessionCatalog,
        );
        const deepLinks = Context.get(applicationKernelContext, DeepLinkRuntime);
        const nodexAgentAuthorization = Context.get(
          applicationKernelContext,
          NodexAgentAuthorizationRuntime,
        );
        const conversationContext = Context.get(applicationKernelContext, CodexConversationContext);
        const conversationProjection = Context.get(
          applicationKernelContext,
          CodexConversationProjection,
        );
        const threadDirectory = Context.get(applicationKernelContext, CodexThreadDirectory);
        const conversationRelationships = Context.get(
          applicationKernelContext,
          CodexConversationRelationships,
        );
        const internalThreadRegistry = Context.get(
          applicationKernelContext,
          CodexInternalThreadRegistry,
        );
        const threadStartNotifications = Context.get(
          applicationKernelContext,
          CodexThreadStartNotificationGate,
        );
        const sidebarSync = Context.get(applicationKernelContext, CodexSidebarSyncRuntime);
        const gitProbe = Context.get(applicationKernelContext, CodexGitProbe);
        const externalAgentImport = Context.get(
          applicationKernelContext,
          CodexExternalAgentImportRuntime,
        );
        const heartbeatTurnCompletion = Context.get(
          applicationKernelContext,
          CodexHeartbeatTurnCompletion,
        );
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
        const turnAuthority = Context.get(applicationKernelContext, CodexTurnAuthority);
        const notificationAdmission = Context.get(
          applicationKernelContext,
          CodexNotificationAdmission,
        );
        const turnPreparation = Context.get(applicationKernelContext, CodexTurnPreparation);
        const queuedFollowUps = Context.get(applicationKernelContext, CodexQueuedFollowUps);
        const turnCommands = Context.get(applicationKernelContext, CodexTurnCommands);
        const activeGoalContinuation = Context.get(
          applicationKernelContext,
          CodexActiveGoalContinuation,
        );
        const threadLaunchCompletion = Context.get(
          applicationKernelContext,
          CodexThreadLaunchCompletion,
        );
        const freshThreadLaunch = Context.get(
          applicationKernelContext,
          CodexFreshThreadLaunchRuntime,
        );
        const queuedFollowUpDispatcher = Context.get(
          applicationKernelContext,
          CodexQueuedFollowUpDispatcher,
        );
        const conversationCommands = Context.get(applicationKernelContext, ConversationCommands);
        const conversationDeltaBuffer = Context.get(
          applicationKernelContext,
          CodexConversationDeltaBufferRuntime,
        );
        const postResumeGoals = Context.get(applicationKernelContext, CodexPostResumeGoalRuntime);
        const threadExecution = Context.get(applicationKernelContext, CodexThreadExecution);
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
        yield* Layer.buildWithScope(
          CodexApplicationIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(ElectronWindowHost, windowHost),
                Layer.succeed(MainConfig, config),
                Layer.succeed(AgentProviderRuntime, agentProviders),
                Layer.succeed(CodexAccount, codexAccountService),
                Layer.succeed(CodexConnection, codexConnectionService),
                Layer.succeed(CodexMedia, codexMedia),
                Layer.succeed(ComposerCatalog, composerCatalogService),
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(CodexPreferences, preferences),
                Layer.succeed(CodexAttachments, attachments),
                Layer.succeed(CodexToolRuntime, codexToolRuntimeService),
                Layer.succeed(ComposerExternalSuggestions, externalSuggestions),
              ),
            ),
          ),
          runtimeScope,
        );
        const threadCatalog = yield* makeCodexThreadCatalog({
          foldPathCase: config.platform === "win32",
        }).pipe(
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexInternalThreadRegistry, internalThreadRegistry),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadExecution, threadExecution),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const clientThreadIdentity = yield* makeCodexClientThreadIdentity(persistedAtoms).pipe(
          Effect.provideService(ProjectWorkspace, projectWorkspace),
        );
        const forkSidePanelTransfers = yield* makeCodexForkSidePanelTransferRuntime.pipe(
          Effect.provideService(BrowserApplication, browser),
          Effect.provideService(CodexClientThreadIdentity, clientThreadIdentity),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const forkTitlePolicy = yield* makeCodexForkTitlePolicy.pipe(
          Effect.provideService(CoreModules, coreModules),
        );
        const conversationFork = yield* makeCodexConversationFork.pipe(
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexForkTitlePolicy, forkTitlePolicy),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(CodexForkSidePanelTransfer, forkSidePanelTransfers),
          Effect.provideService(CodexThreadCatalog, threadCatalog),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexThreadTitlePersistence, threadTitlePersistence),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
        );
        const conversationCreation = yield* makeCodexConversationCreation.pipe(
          Effect.provideService(CodexAttachments, attachments),
          Effect.provideService(CodexClientThreadIdentity, clientThreadIdentity),
          Effect.provideService(CodexConversationFork, conversationFork),
          Effect.provideService(CodexForkSidePanelTransfer, forkSidePanelTransfers),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(CodexThreadLaunchCompletion, threadLaunchCompletion),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexThreadTitlePersistence, threadTitlePersistence),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(BrowserUseRuntime, browserUse),
          Effect.provideService(ManagedWorktreeRuntime, managedWorktrees),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
        );
        const pendingWorktrees = yield* makeCodexPendingWorktreeRuntime.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexAttachments, attachments),
          Effect.provideService(CodexConversationCreation, conversationCreation),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexGitProbe, gitProbe),
          Effect.provideService(ExecutionHostRuntime, executionHosts),
          Effect.provideService(ManagedWorktreeRuntime, managedWorktrees),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const managedWorktreeRetentionContext = yield* Layer.buildWithScope(
          managedWorktreeRetentionRuntimeLive({}).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(AutomationApplication, automationApplication),
                Layer.succeed(CodexPendingWorktreeRuntime, pendingWorktrees),
                Layer.succeed(ExecutionHostRuntime, executionHosts),
                Layer.succeed(ManagedWorktreeConfiguration, managedWorktreeConfiguration),
                Layer.succeed(ManagedWorktreeRuntime, managedWorktrees),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
              ),
            ),
          ),
          runtimeScope,
        );
        const managedWorktreeRetention = Context.get(
          managedWorktreeRetentionContext,
          ManagedWorktreeRetentionRuntime,
        );
        const crossHostThreadHandoffContext = yield* Layer.buildWithScope(
          crossHostThreadHandoffLive({
            relayBaseRoot: `${runtimeStateHome}/handoffs`,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ExecutionHostRuntime, executionHosts),
                Layer.succeed(FileSystem.FileSystem, fileSystem),
                Layer.succeed(ManagedWorktreeRuntime, managedWorktrees),
              ),
            ),
          ),
          runtimeScope,
        );
        const crossHostThreadHandoff = Context.get(
          crossHostThreadHandoffContext,
          CrossHostThreadHandoff,
        );
        const managedWorktreeHandoffContext = yield* Layer.buildWithScope(
          managedWorktreeHandoffLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(CrossHostThreadHandoff, crossHostThreadHandoff),
                Layer.succeed(ExecutionHostRuntime, executionHosts),
                Layer.succeed(ManagedWorktreeRetentionRuntime, managedWorktreeRetention),
                Layer.succeed(ManagedWorktreeRuntime, managedWorktrees),
              ),
            ),
          ),
          runtimeScope,
        );
        const managedWorktreeHandoff = Context.get(
          managedWorktreeHandoffContext,
          ManagedWorktreeHandoff,
        );
        const threadHandoffRuntime = yield* makeCodexThreadHandoffRuntime({
          storage: makeCodexThreadHandoffJournalStorage(
            resolveCodexThreadHandoffJournalPath(runtimeStateHome),
          ),
        }).pipe(
          Effect.provideService(CodexThreadExecution, threadExecution),
          Effect.provideService(ExecutionHostRuntime, executionHosts),
          Effect.provideService(ManagedWorktreeHandoff, managedWorktreeHandoff),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const agentImport = yield* makeAgentImportRuntime({ runtimeStateHome }).pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexExternalAgentImportRuntime, externalAgentImport),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexThreadTitlePersistence, threadTitlePersistence),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const manualCompactionContext = yield* Layer.buildWithScope(
          codexManualCompactionRuntimeLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexConversationProjection, conversationProjection),
                Layer.succeed(CodexGateway, codexGateway),
              ),
            ),
          ),
          runtimeScope,
        );
        const manualCompaction = Context.get(manualCompactionContext, CodexManualCompactionRuntime);
        const threadRollbackCommands = yield* makeCodexThreadRollbackCommands.pipe(
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
        );
        const projectSessionFork = yield* makeCodexProjectSessionFork.pipe(
          Effect.provideService(CodexConversationFork, conversationFork),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexForkSidePanelTransfer, forkSidePanelTransfers),
          Effect.provideService(CodexForkTitlePolicy, forkTitlePolicy),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(CodexPendingWorktreeRuntime, pendingWorktrees),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadSettingsRuntime, threadSettingsRuntime),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
        );
        const rendererOwnerCommands = yield* makeCodexRendererOwnerCommands.pipe(
          Effect.provideService(CodexConversationFork, conversationFork),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(CodexFreshThreadLaunchRuntime, freshThreadLaunch),
          Effect.provideService(CodexManualCompactionRuntime, manualCompaction),
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(CodexThreadSettingsRuntime, threadSettingsRuntime),
          Effect.provideService(CodexThreadRollbackCommands, threadRollbackCommands),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(ConversationCommands, conversationCommands),
        );
        const sideChatCommands = yield* makeCodexSideChatCommands.pipe(
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexThreadHostResolver, threadHostResolver),
          Effect.provideService(CodexEphemeralThreadRouting, ephemeralThreadRouting),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
        );
        const sessionThreadLaunch = yield* makeCodexSessionThreadLaunch.pipe(
          Effect.provideService(CodexAttachments, attachments),
          Effect.provideService(CodexFreshThreadLaunchRuntime, freshThreadLaunch),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexPendingWorktreeRuntime, pendingWorktrees),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadLaunchCompletion, threadLaunchCompletion),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(CodexTurnPreparation, turnPreparation),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const codexAppProtocolTools = yield* makeCodexAppProtocolTools.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(AutomationApplication, automationApplication),
          Effect.provideService(CodexConversationFork, conversationFork),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(CodexProjectSessionFork, projectSessionFork),
          Effect.provideService(CodexSessionThreadLaunch, sessionThreadLaunch),
          Effect.provideService(CodexThreadCatalog, threadCatalog),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadHandoffRuntime, threadHandoffRuntime),
          Effect.provideService(CodexThreadTitlePersistence, threadTitlePersistence),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(ConversationCommands, conversationCommands),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(TerminalSessions, terminals),
        );
        const automationInboxContext = yield* Layer.buildWithScope(
          codexAutomationInboxLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationRoutingIndex, automationRouting),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const automationInbox = Context.get(automationInboxContext, CodexAutomationInbox);
        const oneShotServerRequestsContext = yield* Layer.buildWithScope(
          codexOneShotServerRequestsLive,
          runtimeScope,
        );
        const oneShotServerRequests = Context.get(
          oneShotServerRequestsContext,
          CodexOneShotServerRequests,
        );
        const protocolNotificationProjectionContext = yield* Layer.buildWithScope(
          codexProtocolNotificationProjectionLive({
            supportsChatGptApps: CODEX_INTEGRATION_CAPABILITIES.chatGptApps,
          }).pipe(Layer.provide(Layer.succeed(CodexApplicationEventHub, codexApplicationEvents))),
          runtimeScope,
        );
        const protocolNotificationProjection = Context.get(
          protocolNotificationProjectionContext,
          CodexProtocolNotificationProjection,
        );
        const automationTurnCompletionContext = yield* Layer.buildWithScope(
          codexAutomationTurnCompletionLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationRoutingIndex, automationRouting),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const automationTurnCompletion = Context.get(
          automationTurnCompletionContext,
          CodexAutomationTurnCompletion,
        );
        const conversationLifecycle = yield* makeCodexConversationLifecycle.pipe(
          Effect.provideService(CodexActiveGoalContinuation, activeGoalContinuation),
          Effect.provideService(CodexConversationDeltaBufferRuntime, conversationDeltaBuffer),
          Effect.provideService(CodexManualCompactionRuntime, manualCompaction),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(CodexQueuedFollowUpDispatcher, queuedFollowUpDispatcher),
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(BrowserUseRuntime, browserUse),
        );
        const threadDurableProjection = yield* makeCodexThreadDurableProjection.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
        );
        const protocolNotificationEffects = yield* makeCodexProtocolNotificationEffects.pipe(
          Effect.provideService(CodexActiveGoalContinuation, activeGoalContinuation),
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexAutomationTurnCompletion, automationTurnCompletion),
          Effect.provideService(CodexConversationDeltaBufferRuntime, conversationDeltaBuffer),
          Effect.provideService(CodexConversationLifecycle, conversationLifecycle),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexManualCompactionRuntime, manualCompaction),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(
            CodexProtocolNotificationProjection,
            protocolNotificationProjection,
          ),
          Effect.provideService(CodexQueuedFollowUps, queuedFollowUps),
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CodexThreadDurableProjection, threadDurableProjection),
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(CodexUserInputAutoResolution, userInputAutoResolution),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(BrowserUseRuntime, browserUse),
        );
        const nodexAgentProtocolToolsContext = yield* Layer.buildWithScope(
          nodexAgentProtocolToolsLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexConversationContext, conversationContext),
                Layer.succeed(CodexRendererConversationRegistry, rendererConversations),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(NodexAgentAuthorizationRuntime, nodexAgentAuthorization),
                Layer.succeed(NodexAgentDynamicTools, nodexAgentDynamicTools),
                Layer.succeed(NodexAgentResourceAccess, nodexAgentResourceAccess),
              ),
            ),
          ),
          runtimeScope,
        );
        const nodexAgentProtocolTools = Context.get(
          nodexAgentProtocolToolsContext,
          NodexAgentProtocolTools,
        );
        const applicationProtocol = yield* makeCodexApplicationProtocol.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexAppProtocolTools, codexAppProtocolTools),
          Effect.provideService(CodexApplicationRequestInbox, applicationRequestInbox),
          Effect.provideService(CodexAutomationInbox, automationInbox),
          Effect.provideService(CodexOneShotServerRequests, oneShotServerRequests),
          Effect.provideService(CodexNotificationAdmission, notificationAdmission),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(CodexProtocolNotificationEffects, protocolNotificationEffects),
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(CodexUserInputAutoResolution, userInputAutoResolution),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(NodexAgentProtocolTools, nodexAgentProtocolTools),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        yield* Layer.buildWithScope(
          codexProtocolIngressLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexApplicationProtocol, applicationProtocol),
                Layer.succeed(CodexApplicationRequestInbox, applicationRequestInbox),
                Layer.succeed(CodexThreadStartNotificationGate, threadStartNotifications),
                Layer.succeed(MainShutdown, shutdown),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* makeCodexConnectionLifecycle.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexConnection, codexConnectionService),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(CodexProtocolNotificationEffects, protocolNotificationEffects),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(CodexUserInputAutoResolution, userInputAutoResolution),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationResume = yield* makeCodexConversationResumeRuntime.pipe(
          Effect.provideService(CodexApplicationProtocol, applicationProtocol),
          Effect.provideService(CodexConversationHistoryRuntime, conversationHistory),
          Effect.provideService(CodexFreshThreadLaunchRuntime, freshThreadLaunch),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(CodexPostResumeGoalRuntime, postResumeGoals),
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(CodexConversationRelationships, conversationRelationships),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const automationExecutionContext = yield* Layer.buildWithScope(
          automationExecutionLive({
            runtimeStateHome,
            runtimeVersion: codexRuntime.codexCompatibilityVersion ?? codexRuntime.version,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AgentProviderRuntime, agentProviders),
                Layer.succeed(AutomationApplication, automationApplication),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CodexGitProbe, gitProbe),
                Layer.succeed(CodexHeartbeatTurnCompletion, heartbeatTurnCompletion),
                Layer.succeed(CodexPermissions, codexPermissions),
                Layer.succeed(CodexRendererConversationRegistry, rendererConversations),
                Layer.succeed(CodexThreadDirectory, threadDirectory),
                Layer.succeed(CodexThreadStartNotificationGate, threadStartNotifications),
                Layer.succeed(CodexThreadSettingsRuntime, threadSettingsRuntime),
                Layer.succeed(CodexThreadTitlePersistence, threadTitlePersistence),
                Layer.succeed(CodexTurnAuthority, turnAuthority),
                Layer.succeed(CodexTurnCommands, turnCommands),
                Layer.succeed(ComposerCatalog, composerCatalogService),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
                Layer.succeed(DesktopToolRuntime, desktopToolRuntime),
                Layer.succeed(ExecutionHostRuntime, executionHosts),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ManagedWorktreeRetentionRuntime, managedWorktreeRetention),
                Layer.succeed(ManagedWorktreeRuntime, managedWorktrees),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
              ),
            ),
          ),
          runtimeScope,
        );
        const automationExecution = Context.get(automationExecutionContext, AutomationExecution);
        yield* threadHandoffRuntime.recover().pipe(
          Effect.catch((cause) =>
            Effect.sync(() => applicationLogger.error("Task handoff recovery failed", { cause })),
          ),
          Effect.forkIn(runtimeScope, { startImmediately: true }),
          Effect.asVoid,
        );
        const backgroundProcesses = yield* makeCodexBackgroundProcesses.pipe(
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.provideService(TerminalSessions, terminals),
        );
        const projectArchiveBlockersContext = yield* Layer.buildWithScope(
          projectArchiveBlockersLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexBackgroundProcesses, backgroundProcesses),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
                Layer.succeed(TerminalSessions, terminals),
              ),
            ),
          ),
          runtimeScope,
        );
        const projectArchiveBlockers = Context.get(
          projectArchiveBlockersContext,
          ProjectArchiveBlockers,
        );
        const projectLifecycleCommandsContext = yield* Layer.buildWithScope(
          projectLifecycleCommandsLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserApplication, browser),
                Layer.succeed(ProjectArchiveBlockers, projectArchiveBlockers),
                Layer.succeed(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
                Layer.succeed(TerminalSessions, terminals),
              ),
            ),
          ),
          runtimeScope,
        );
        const projectLifecycleCommands = Context.get(
          projectLifecycleCommandsContext,
          ProjectLifecycleCommands,
        );
        const managedWorktreeCatalog = yield* makeManagedWorktreeCatalog({
          defaultManagedRoot: `${config.nodexHome}/worktrees`,
        }).pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(ExecutionHostRuntime, executionHosts),
          Effect.provideService(ManagedWorktreeConfiguration, managedWorktreeConfiguration),
          Effect.provideService(ManagedWorktreeRetentionRuntime, managedWorktreeRetention),
          Effect.provideService(ManagedWorktreeRuntime, managedWorktrees),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        yield* SubscriptionRef.changes(executionHosts.activeSshHosts).pipe(
          Stream.runForEach(() => Effect.sync(sidebarSync.invalidate)),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        yield* Layer.buildWithScope(
          codexRendererProjectionRuntimeLive({
            coordinator: rendererConversationCoordinator,
            events: codexApplicationEvents,
            freshThreadLaunch,
            registry: rendererConversations,
            rendererClients,
            userInputAutoResolution,
            windows,
          }),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CodexRendererIpc.live({
            rendererClients,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(
                  CodexRendererConversationCoordinator,
                  rendererConversationCoordinator,
                ),
                Layer.succeed(CodexAppProtocolTools, codexAppProtocolTools),
                Layer.succeed(CodexRendererConversationRegistry, rendererConversations),
                Layer.succeed(CodexUserInputAutoResolution, userInputAutoResolution),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
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
        const initialProjectBootstrapContext = yield* Layer.buildWithScope(
          initialProjectBootstrapRuntimeLive({
            projectsDirectory: resolveInitialProjectProjectsDirectory({
              configuredDirectory: config.initialProjectsDirectory ?? undefined,
              documentsDirectory: config.documentsPath,
            }),
            journalPath: resolveInitialProjectJournalPath(config.nodexHome),
          }).pipe(Layer.provide(Layer.succeed(ProjectWorkspace, projectWorkspace))),
          runtimeScope,
        );
        const initialProjectBootstrap = Context.get(
          initialProjectBootstrapContext,
          InitialProjectBootstrapRuntime,
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
        const scheduledAutomationContext = yield* Layer.buildWithScope(
          scheduledAutomationRuntimeLive().pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationApplication, automationApplication),
                Layer.succeed(AutomationExecution, automationExecution),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(CoreAuthority, authority),
              ),
            ),
          ),
          runtimeScope,
        );
        const scheduledAutomations = Context.get(
          scheduledAutomationContext,
          ScheduledAutomationRuntime,
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
        const coreApplicationProjectionContext = yield* Layer.buildWithScope(
          coreApplicationProjectionRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationRoutingIndex, automationRouting),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(
                  DatabaseNotifierRuntime.DatabaseNotifierRuntime,
                  databaseNotifications,
                ),
              ),
            ),
          ),
          runtimeScope,
        );
        const coreApplicationProjection = Context.get(
          coreApplicationProjectionContext,
          CoreApplicationProjectionRuntime,
        );
        const projectionDeliveryContext = yield* Layer.buildWithScope(
          projectionDeliveryRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CoreApplicationProjectionRuntime, coreApplicationProjection),
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreSessionAccess, access),
                Layer.succeed(DesktopDocumentSessionRuntime, documentSync),
              ),
            ),
          ),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("projection-delivery", cause)));
        const projectionDelivery = Context.get(
          projectionDeliveryContext,
          ProjectionDeliveryRuntime,
        );
        const coreEventDelivery = Context.get(projectionDeliveryContext, CoreEventDelivery);
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
        const reminderSchedulerContext = yield* Layer.buildWithScope(
          reminderSchedulerRuntimeLive({}).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AutomationApplication, automationApplication),
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(ElectronDesktop, desktop),
              ),
            ),
          ),
          runtimeScope,
        );
        const reminderScheduler = Context.get(reminderSchedulerContext, ReminderSchedulerRuntime);
        const storeSchedulerContext = yield* Layer.buildWithScope(
          storeAdministrationSchedulerRuntimeLive({
            readBackupSettings: getBackupSettings,
            readBlockRetentionCount: () => getHistorySettings().retentionCount,
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(StoreAdministration, storeAdministration),
              ),
            ),
          ),
          runtimeScope,
        );
        const storeSchedulers = Context.get(
          storeSchedulerContext,
          StoreAdministrationSchedulerRuntime,
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
          const coreHandshake = yield* access.handshake.pipe(
            Effect.mapError((cause) => runtimeError("core-handshake", cause)),
          );
          const eventContext = yield* Layer.buildWithScope(
            coreEventHubLive({ initialAfter: coreHandshake.commit_head }).pipe(
              Layer.provide(
                Layer.merge(
                  Layer.succeed(CoreEventDelivery, coreEventDelivery),
                  Layer.merge(
                    Layer.succeed(CoreSessionAccess, access),
                    Layer.succeed(CoreAuthority, authority),
                  ),
                ),
              ),
            ),
            runtimeScope,
          );
          const hub = Context.get(eventContext, CoreEventHub);
          yield* SubscriptionRef.changes(hub.connection).pipe(
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
