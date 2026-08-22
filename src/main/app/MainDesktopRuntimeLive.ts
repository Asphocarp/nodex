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
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { ExternalAgentConfigMigrationItem } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigMigrationItem";
import {
  CoreAuthority,
  CoreSessionAccess,
  live as coreAuthorityLive,
} from "../core-runtime/CoreAuthority";
import {
  CoreEventHub,
  deliveryFrom as coreDeliveryFrom,
  live as coreEventHubLive,
} from "../core-runtime/CoreEventHub";
import { CoreModules, live as coreModulesLive } from "../core-runtime/CoreModules";
import { coreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { live as coreTransportLive } from "../core-runtime/CoreTransport";
import { makeDesktopDataAuthority } from "../core-runtime/DesktopCoreAdapter";
import {
  ProjectionDeliveryRuntime,
  live as projectionDeliveryRuntimeLive,
} from "../core-runtime/ProjectionDeliveryRuntime";
import {
  CoreApplicationProjectionRuntime,
  live as coreApplicationProjectionRuntimeLive,
} from "../core-runtime/CoreApplicationProjectionRuntime";
import {
  createDesktopAutomationModuleBridge,
  createDesktopDatabaseModuleBridge,
  createDesktopDocumentSyncBridge,
  createDesktopLibraryModuleBridge,
  createDesktopProjectWorkspaceBridge,
  createDesktopStoreAdministrationBridge,
} from "../core-client";
import { createDesktopNodexAgentAuthorityPort } from "../core-client/desktop-nodex-agent-authority";
import { createDesktopNodexAgentV3DynamicService } from "../core-client/desktop-nodex-agent-dynamic-service";
import { createDesktopNodexAgentResourceAuthorityPort } from "../core-client/desktop-nodex-agent-resource-authority";
import { resolveCodexRuntime } from "../codex/codex-runtime";
import { CodexService } from "../codex/codex-service";
import { CodexSessionStore } from "../codex/codex-session-store";
import { AgentImportOperations } from "../codex/agent-import-operations";
import { createElectronProviderCredentialStore } from "../platform/electron/ProviderCredentialStore";
import { CodexAccount, live as codexAccountLive } from "../codex-application/CodexAccount";
import {
  AgentProviderRuntime,
  live as agentProviderRuntimeLive,
} from "../codex-application/AgentProviderRuntime";
import { makeAgentProviderRuntimePromiseAdapter } from "../codex-application/AgentProviderRuntimePromiseAdapter";
import {
  AgentImportOperationsError,
  make as makeAgentImportRuntime,
} from "../codex-application/AgentImportRuntime";
import { makeAgentImportRuntimePromiseAdapter } from "../codex-application/AgentImportRuntimePromiseAdapter";
import {
  NodexAgentAuthorizationPersistenceError,
  NodexAgentAuthorizationRuntime,
  live as nodexAgentAuthorizationRuntimeLive,
} from "../codex-application/NodexAgentAuthorizationRuntime";
import { makeNodexAgentAuthorizationRuntimePromiseAdapter } from "../codex-application/NodexAgentAuthorizationRuntimePromiseAdapter";
import { CodexConnection, live as codexConnectionLive } from "../codex-application/CodexConnection";
import { CodexMedia, live as codexMediaLive } from "../codex-application/CodexMedia";
import { ChatGptDesktop, live as chatGptDesktopLive } from "../codex-application/ChatGptDesktop";
import {
  ComposerExternalSuggestions,
  live as composerExternalSuggestionsLive,
} from "../codex-application/ComposerExternalSuggestions";
import { ComposerCatalog, live as composerCatalogLive } from "../codex-application/ComposerCatalog";
import { makeComposerCatalogPromiseAdapter } from "../codex-application/ComposerCatalogPromiseAdapter";
import {
  ConversationCommands,
  live as conversationCommandsLive,
} from "../codex-application/ConversationCommands";
import { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import {
  ApprovalCoordinator,
  CodexGlobalServerRequestRuntime,
  applicationRequestDispatcherLive,
} from "../codex-application/ApprovalCoordinator";
import { make as makeCodexPendingServerRequestRuntime } from "../codex-application/CodexPendingServerRequestRuntime";
import { makeCodexPendingServerRequestRuntimePromiseAdapter } from "../codex-application/CodexPendingServerRequestRuntimePromiseAdapter";
import {
  CodexActiveGoalContinuationError,
  make as makeCodexActiveGoalContinuation,
} from "../codex-application/CodexActiveGoalContinuation";
import { makeCodexActiveGoalContinuationCallbackAdapter } from "../codex-application/CodexActiveGoalContinuationCallbackAdapter";
import {
  CodexNotificationRoutingError,
  make as makeCodexNotificationRouting,
} from "../codex-application/CodexNotificationRouting";
import { live as codexApplicationIngressRuntimeLive } from "../codex-application/CodexApplicationIngressRuntime";
import { make as makeCodexOwnerNotificationDrainRuntime } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import { makeCodexOwnerNotificationDrainRuntimePromiseAdapter } from "../codex-application/CodexOwnerNotificationDrainRuntimePromiseAdapter";
import { make as makeCodexRendererConversationRuntime } from "../codex-application/CodexRendererConversationRuntime";
import {
  CodexSidebarSyncError,
  make as makeCodexSidebarSyncRuntime,
} from "../codex-application/CodexSidebarSyncRuntime";
import { makeCodexSidebarSyncRuntimePromiseAdapter } from "../codex-application/CodexSidebarSyncRuntimePromiseAdapter";
import { make as makeCodexSidebarSweepRuntime } from "../codex-application/CodexSidebarSweepRuntime";
import { makeCodexSidebarSweepRuntimePromiseAdapter } from "../codex-application/CodexSidebarSweepRuntimePromiseAdapter";
import { make as makeCodexGitProbe } from "../codex-application/CodexGitProbe";
import { makeCodexGitProbePromiseAdapter } from "../codex-application/CodexGitProbePromiseAdapter";
import {
  CodexExternalAgentImportError,
  make as makeCodexExternalAgentImportRuntime,
} from "../codex-application/CodexExternalAgentImportRuntime";
import { makeCodexExternalAgentImportRuntimePromiseAdapter } from "../codex-application/CodexExternalAgentImportRuntimePromiseAdapter";
import {
  CodexHeartbeatTurnCompletionError,
  make as makeCodexHeartbeatTurnCompletion,
} from "../codex-application/CodexHeartbeatTurnCompletion";
import { makeCodexHeartbeatTurnCompletionPromiseAdapter } from "../codex-application/CodexHeartbeatTurnCompletionPromiseAdapter";
import {
  CodexStructuredThreadTitleError,
  make as makeCodexStructuredThreadTitle,
} from "../codex-application/CodexStructuredThreadTitle";
import { makeCodexStructuredThreadTitlePromiseAdapter } from "../codex-application/CodexStructuredThreadTitlePromiseAdapter";
import { make as makeCodexDynamicToolsLaunch } from "../codex-application/CodexDynamicToolsLaunch";
import { makeCodexDynamicToolsLaunchPromiseAdapter } from "../codex-application/CodexDynamicToolsLaunchPromiseAdapter";
import { make as makeCodexSidebarThreadMoveRuntime } from "../codex-application/CodexSidebarThreadMoveRuntime";
import { makeCodexSidebarThreadMoveRuntimePromiseAdapter } from "../codex-application/CodexSidebarThreadMoveRuntimePromiseAdapter";
import { make as makeCodexThreadHandoffRuntime } from "../codex-application/CodexThreadHandoffRuntime";
import { makeCodexThreadHandoffRuntimePromiseAdapter } from "../codex-application/CodexThreadHandoffRuntimePromiseAdapter";
import {
  CodexPendingWorktreeEffectError,
  make as makeCodexPendingWorktreeRuntime,
} from "../codex-application/CodexPendingWorktreeRuntime";
import { makeCodexPendingWorktreeRuntimePromiseAdapter } from "../codex-application/CodexPendingWorktreeRuntimePromiseAdapter";
import {
  CodexConversationHistoryError,
  make as makeCodexConversationHistoryRuntime,
} from "../codex-application/CodexConversationHistoryRuntime";
import { makeCodexConversationHistoryRuntimePromiseAdapter } from "../codex-application/CodexConversationHistoryRuntimePromiseAdapter";
import {
  CodexBackgroundSubagentMetadataRepairError,
  make as makeCodexBackgroundSubagentMetadataRepair,
} from "../codex-application/CodexBackgroundSubagentMetadataRepair";
import {
  CodexQueuedFollowUpDispatchError,
  make as makeCodexQueuedFollowUpDispatchRuntime,
} from "../codex-application/CodexQueuedFollowUpDispatchRuntime";
import { make as makeCodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import { makeCodexConversationDeltaBufferRuntimePromiseAdapter } from "../codex-application/CodexConversationDeltaBufferRuntimePromiseAdapter";
import {
  CodexConversationResumeError,
  make as makeCodexConversationResumeRuntime,
} from "../codex-application/CodexConversationResumeRuntime";
import { makeCodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import {
  CodexConversationEventBufferError,
  make as makeCodexConversationEventBufferRuntime,
} from "../codex-application/CodexConversationEventBufferRuntime";
import { makeCodexConversationEventBufferRuntimePromiseAdapter } from "../codex-application/CodexConversationEventBufferRuntimePromiseAdapter";
import {
  type CodexFreshThreadLaunch,
  CodexFreshThreadLaunchError,
  make as makeCodexFreshThreadLaunchRuntime,
} from "../codex-application/CodexFreshThreadLaunchRuntime";
import { makeCodexFreshThreadLaunchRuntimePromiseAdapter } from "../codex-application/CodexFreshThreadLaunchRuntimePromiseAdapter";
import {
  CodexForkSidePanelAdapterError,
  make as makeCodexForkSidePanelTransferRuntime,
} from "../codex-application/CodexForkSidePanelTransferRuntime";
import { makeCodexForkSidePanelTransferRuntimePromiseAdapter } from "../codex-application/CodexForkSidePanelTransferRuntimePromiseAdapter";
import {
  CodexPostResumeGoalError,
  make as makeCodexPostResumeGoalRuntime,
} from "../codex-application/CodexPostResumeGoalRuntime";
import { makeCodexPostResumeGoalRuntimePromiseAdapter } from "../codex-application/CodexPostResumeGoalRuntimePromiseAdapter";
import { make as makeCodexThreadSettingsRuntime } from "../codex-application/CodexThreadSettingsRuntime";
import { makeCodexThreadSettingsRuntimePromiseAdapter } from "../codex-application/CodexThreadSettingsRuntimePromiseAdapter";
import {
  CodexThreadTitlePersistenceEffectError,
  make as makeCodexThreadTitlePersistence,
} from "../codex-application/CodexThreadTitlePersistence";
import { makeCodexThreadTitlePersistencePromiseAdapter } from "../codex-application/CodexThreadTitlePersistencePromiseAdapter";
import {
  CodexRendererOwnerRetentionError,
  make as makeCodexRendererOwnerRetention,
} from "../codex-application/CodexRendererOwnerRetention";
import { makeCodexRendererOwnerRetentionCallbackAdapter } from "../codex-application/CodexRendererOwnerRetentionCallbackAdapter";
import {
  CodexUserInputAutoResolution,
  make as makeCodexUserInputAutoResolution,
} from "../codex-application/CodexUserInputAutoResolution";
import { makeCodexUserInputAutoResolutionPromiseAdapter } from "../codex-application/CodexUserInputAutoResolutionPromiseAdapter";
import { make as makeCodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import { requestHandlingLive } from "../codex-application/CodexApplicationLayers";
import { resolveCodexThreadHandoffJournalPath } from "../codex/codex-thread-handoff-journal";
import { createCodexForkBrowserSnapshotAdapter } from "../codex/codex-fork-browser-snapshot-adapter";
import { makeCodexThreadHandoffJournalStorage } from "../platform/CodexThreadHandoffJournalStorage";
import {
  CodexPreferences,
  live as codexPreferencesLive,
} from "../codex-application/CodexPreferences";
import {
  CodexPermissions,
  live as codexPermissionsLive,
} from "../codex-application/CodexPermissions";
import { makeCodexPermissionsPromiseAdapter } from "../codex-application/CodexPermissionsPromiseAdapter";
import {
  ExecutionHostRuntime,
  live as executionHostRuntimeLive,
} from "../codex-application/ExecutionHostRuntime";
import {
  ManagedWorktreeRuntime,
  live as managedWorktreeRuntimeLive,
} from "../codex-application/ManagedWorktreeRuntime";
import { makeManagedWorktreeRuntimePromiseAdapter } from "../codex-application/ManagedWorktreeRuntimePromiseAdapter";
import {
  ManagedWorktreeRetentionRuntime,
  live as managedWorktreeRetentionRuntimeLive,
} from "../codex-application/ManagedWorktreeRetentionRuntime";
import { makeManagedWorktreeRetentionRuntimePromiseAdapter } from "../codex-application/ManagedWorktreeRetentionRuntimePromiseAdapter";
import { CODEX_APP_LOCAL_HOST_ID } from "../codex/codex-app-meta-thread-tools";
import {
  CodexAttachments,
  live as codexAttachmentsLive,
} from "../codex-application/CodexAttachments";
import { getThreadGoalAttachmentsRoot } from "../thread-goal-attachments";
import {
  CodexToolRuntime,
  live as codexToolRuntimeLive,
} from "../codex-application/CodexToolRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import { makeCodexApplicationServerRequests } from "../codex-runtime/CodexApplicationServerRequests";
import { makeCodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
import * as CodexRuntimeLive from "../codex-runtime/CodexRuntimeLive";
import { CodexServerRequestRuntime } from "../codex-runtime/CodexServerRequestRuntime";
import * as AppUpdateIpc from "../ipc/handlers/AppUpdateIpc";
import * as ApplicationLifecycleIpc from "../ipc/handlers/ApplicationLifecycleIpc";
import * as ApplicationLocalStateIpc from "../ipc/handlers/ApplicationLocalStateIpc";
import * as ApplicationSettingsIpc from "../ipc/handlers/ApplicationSettingsIpc";
import * as ApplicationSyncIpc from "../ipc/handlers/ApplicationSyncIpc";
import * as ApplicationWindowIpc from "../ipc/handlers/ApplicationWindowIpc";
import * as AutomationIpc from "../ipc/handlers/AutomationIpc";
import * as CodexApplicationIpc from "../ipc/handlers/CodexApplicationIpc";
import * as CodexPendingWorktreeIpc from "../ipc/handlers/CodexPendingWorktreeIpc";
import * as CodexPermissionsIpc from "../ipc/handlers/CodexPermissionsIpc";
import * as CodexRendererIpc from "../ipc/handlers/CodexRendererIpc";
import * as ExecutionHostIpc from "../ipc/handlers/ExecutionHostIpc";
import * as BrowserProfileIpc from "../ipc/handlers/BrowserProfileIpc";
import * as BrowserSidebarIpc from "../ipc/handlers/BrowserSidebarIpc";
import * as ComputerUseSettingsIpc from "../ipc/handlers/ComputerUseSettingsIpc";
import * as ComposerAppshotIpc from "../ipc/handlers/ComposerAppshotIpc";
import * as CoreAuthorityIpc from "../ipc/handlers/CoreAuthorityIpc";
import * as CoreDocumentIpc from "../ipc/handlers/CoreDocumentIpc";
import * as CoreMutationIpc from "../ipc/handlers/CoreMutationIpc";
import * as DatabaseProjectionIpc from "../ipc/handlers/DatabaseProjectionIpc";
import * as GitWorkerIpc from "../ipc/handlers/GitWorkerIpc";
import * as GitApplicationIpc from "../ipc/handlers/GitApplicationIpc";
import * as NativeShellIpc from "../ipc/handlers/NativeShellIpc";
import * as ManagedMediaIpc from "../ipc/handlers/ManagedMediaIpc";
import * as ProjectionDeliveryIpc from "../ipc/handlers/ProjectionDeliveryIpc";
import * as PageSearchIpc from "../ipc/handlers/PageSearchIpc";
import * as ProjectWorkspaceIpc from "../ipc/handlers/ProjectWorkspaceIpc";
import * as RemoteHostedPipIpc from "../ipc/handlers/RemoteHostedPipIpc";
import * as StoreAdministrationIpc from "../ipc/handlers/StoreAdministrationIpc";
import * as TerminalIpc from "../ipc/handlers/TerminalIpc";
import * as WorktreeEnvironmentIpc from "../ipc/handlers/WorktreeEnvironmentIpc";
import * as WorkspaceFileIpc from "../ipc/handlers/WorkspaceFileIpc";
import { codexIpcLive } from "../ipc-handlers";
import {
  ComputerUseRuntime,
  live as computerUseRuntimeLive,
} from "../host-runtime/ComputerUseRuntime";
import {
  DesktopToolRuntime,
  live as desktopToolRuntimeLive,
  makeDesktopToolRuntimePromiseAdapter,
} from "../host-runtime/DesktopToolRuntime";
import {
  RemoteHostedPipRuntime,
  live as remoteHostedPipRuntimeLive,
} from "../host-runtime/RemoteHostedPipRuntime";
import {
  ComputerUseSettingsRuntime,
  live as computerUseSettingsRuntimeLive,
} from "../host-runtime/ComputerUseSettingsRuntime";
import {
  GitActionOperationRuntime,
  live as gitActionOperationRuntimeLive,
} from "../host-runtime/GitActionOperationRuntime";
import { GitWorkerRuntime, live as gitWorkerRuntimeLive } from "../host-runtime/GitWorkerRuntime";
import {
  LocalWorktreeWorkerRuntime,
  live as localWorktreeWorkerRuntimeLive,
} from "../host-runtime/LocalWorktreeWorkerRuntime";
import {
  WorktreeEnvironmentRuntime,
  live as worktreeEnvironmentRuntimeLive,
} from "../host-runtime/WorktreeEnvironmentRuntime";
import {
  WorktreeShellEnvironmentRuntime,
  live as worktreeShellEnvironmentRuntimeLive,
} from "../host-runtime/WorktreeShellEnvironmentRuntime";
import {
  live as projectRuntimeLifecycleLive,
  ProjectRuntimeLifecycleRuntime,
} from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { makeProjectRuntimeLifecyclePromiseAdapter } from "../host-runtime/ProjectRuntimeLifecycleRuntimePromiseAdapter";
import { BrowserProfileHelperPlatform } from "../browser/browser-profile-helper-client";
import { projectSessionIdFromTerminalSessionId } from "../browser/browser-local-server-runtime";
import {
  BrowserUseRuntime,
  live as browserUseRuntimeLive,
} from "../host-runtime/BrowserUseRuntime";
import {
  BrowserProfileRuntime,
  live as browserProfileRuntimeLive,
} from "../host-runtime/BrowserProfileRuntime";
import {
  BrowserSidebarRuntime,
  live as browserSidebarRuntimeLive,
} from "../host-runtime/BrowserSidebarRuntime";
import { AppUpdateRuntime, live as appUpdateRuntimeLive } from "../host-runtime/AppUpdateRuntime";
import * as AppProtocolRuntime from "../host-runtime/AppProtocolRuntime";
import * as SessionPolicyRuntime from "../host-runtime/SessionPolicyRuntime";
import {
  DesktopNotificationRuntime,
  live as desktopNotificationRuntimeLive,
} from "../host-runtime/DesktopNotificationRuntime";
import {
  RendererClientRuntime,
  live as rendererClientRuntimeLive,
} from "../host-runtime/RendererClientRuntime";
import {
  ComposerAppshotRuntime,
  live as composerAppshotRuntimeLive,
} from "../host-runtime/ComposerAppshotRuntime";
import * as DatabaseNotifierRuntime from "../host-runtime/DatabaseNotifierRuntime";
import {
  CanvasPresenceRuntime,
  live as canvasPresenceRuntimeLive,
} from "../host-runtime/CanvasPresenceRuntime";
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
import {
  McpAppSandboxRuntime,
  live as mcpAppSandboxRuntimeLive,
} from "../host-runtime/McpAppSandboxRuntime";
import { DeepLinkRuntime, live as deepLinkRuntimeLive } from "../host-runtime/DeepLinkRuntime";
import {
  ApplicationInitializationRuntime,
  live as applicationInitializationRuntimeLive,
} from "../host-runtime/ApplicationInitializationRuntime";
import {
  ApplicationMenuRuntime,
  live as applicationMenuRuntimeLive,
} from "../host-runtime/ApplicationMenuRuntime";
import {
  ApplicationHostRuntime,
  live as applicationHostRuntimeLive,
} from "../host-runtime/ApplicationHostRuntime";
import {
  InitialProjectBootstrapRuntime,
  live as initialProjectBootstrapRuntimeLive,
} from "../initial-project/InitialProjectBootstrapRuntime";
import { resolveInitialProjectProjectsDirectory } from "../initial-project/initial-project-filesystem";
import { resolveInitialProjectJournalPath } from "../initial-project/initial-project-journal-store";
import {
  getBackupSettings,
  getCodexExecutionHostSettings,
  getCommandKeymapState,
  getHistorySettings,
  getKnownManagedWorktreeRoots,
  getManagedWorktreeSettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
  updateCodexExecutionHostSettings,
} from "../local-store/config";
import { makePersistedAtomStore } from "../local-store/persisted-atoms";
import { requestsExplicitNewWindow } from "../main-runtime-startup-events";
import { getLogger } from "../logging/logger";
import { captureMainException } from "../observability/sentry-main";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronDesktop } from "../platform/electron/ElectronDesktop";
import { ElectronIpc, ElectronSyncIpc } from "../platform/electron/ElectronIpc";
import * as ElectronNet from "../platform/electron/ElectronNet";
import * as ProviderCredentials from "../platform/electron/ProviderCredentials";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import * as CodexSessionTransport from "../platform/node/CodexSessionTransport";
import { resolveCodexProcessEnvironment } from "../platform/node/CodexProcessEnvironment";
import * as TerminalProjectAdmission from "../terminal-runtime/TerminalProjectAdmission";
import * as TerminalRuntimeLive from "../terminal-runtime/TerminalRuntimeLive";
import * as WindowSessionCatalog from "../window-runtime/WindowSessionCatalog";
import { WindowRuntime, live as windowRuntimeLive } from "../window-runtime/WindowRuntime";
import { MainConfig } from "./MainConfig";
import { MainRuntime, MainRuntimeError } from "./MainRuntimeLive";
import { MainShutdown } from "./MainShutdown";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";
import { CODEX_INTEGRATION_CAPABILITIES } from "../../shared/codex-integration-capabilities";
import { APP_RENDERER_URL } from "../../shared/app-renderer-policy";
import {
  ApplicationWindowRuntime,
  live as applicationWindowRuntimeLive,
} from "../window-runtime/ApplicationWindowRuntime";

const runtimeError = (operation: string, cause: unknown) =>
  new MainRuntimeError({ operation, cause });

const deliveryError = (operation: string, cause: unknown) =>
  coreRuntimeError({ operation, reason: "delivery", retryable: false, cause });

const notificationLogger = getLogger({ component: "codex-thread-notification-runtime" });
const applicationLogger = getLogger({ subsystem: "app" });

type MainDesktopController = Omit<MainRuntime["Service"], "start">;

/** Production Main runtime owner while feature Layers replace the remaining application Modules. */
export const live: Layer.Layer<
  MainRuntime,
  MainRuntimeError,
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
  MainRuntime,
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const desktop = yield* ElectronDesktop;
    const ipc = yield* ElectronIpc;
    const syncIpc = yield* ElectronSyncIpc;
    const sessionHost = yield* ElectronSessionHost;
    const windowHost = yield* ElectronWindowHost;
    const config = yield* MainConfig;
    const shutdown = yield* MainShutdown;
    const callbacks = yield* ScopedCallbackRuntime;
    const terminals = yield* TerminalSessions;
    const fileSystem = yield* FileSystem.FileSystem;
    const browserProfileHelper = yield* BrowserProfileHelperPlatform;
    const runtimeScope = yield* Scope.Scope;
    const locale = yield* electron.locale;
    const userDataPath = yield* electron.userDataPath;
    let controller: MainDesktopController | null = null;
    let isPrivacySettingsTerminationRequest: (() => boolean) | null = null;
    let started = false;

    const requireController = (
      operation: string,
    ): Effect.Effect<MainDesktopController, MainRuntimeError> =>
      Effect.suspend(() =>
        controller === null
          ? Effect.fail(runtimeError(operation, new Error("Main runtime has not started")))
          : Effect.succeed(controller),
      );

    const start = Effect.uninterruptible(
      Effect.gen(function* () {
        if (started)
          return yield* runtimeError("startup", new Error("Main runtime already started"));
        started = true;
        const codexRuntime = yield* Effect.try({
          try: () =>
            resolveCodexRuntime({
              isPackaged: config.isPackaged,
              projectRootPath: config.projectRootPath,
              resourcesPath: config.resourcesPath,
            }),
          catch: (cause) => runtimeError("resolve-codex-runtime", cause),
        });
        const providerCredentialStore = yield* Effect.try({
          try: createElectronProviderCredentialStore,
          catch: (cause) => runtimeError("provider-credential-store", cause),
        });
        const runtimeStateHome = `${config.nodexHome}/agent`;
        const projectRuntimeLifecycleContext = yield* Layer.buildWithScope(
          projectRuntimeLifecycleLive,
          runtimeScope,
        );
        const projectRuntimeLifecycle = Context.get(
          projectRuntimeLifecycleContext,
          ProjectRuntimeLifecycleRuntime,
        );
        const projectRuntimeLifecycleAdapter = makeProjectRuntimeLifecyclePromiseAdapter(
          projectRuntimeLifecycle,
          callbacks,
        );
        let codexService: CodexService | undefined;
        const requireCodexService = (): CodexService => {
          const service = codexService;
          if (!service) throw new Error("CodexService is not constructed");
          return service;
        };
        const resolveCodexThreadHost = (threadId: string) =>
          Effect.sync(
            () => codexService?.resolveThreadExecutionHostId(threadId) ?? CODEX_APP_LOCAL_HOST_ID,
          );
        const applicationServerRequests = CodexGlobalServerRequestRuntime.of(
          makeCodexApplicationServerRequests({
            current: () => {
              const service = codexService;
              return service === undefined
                ? null
                : { handle: (request) => service.handleServerRequest(request) };
            },
          }),
        );
        const requestHandlingContext = yield* Layer.buildWithScope(
          requestHandlingLive.pipe(
            Layer.provide(
              Layer.succeed(CodexGlobalServerRequestRuntime, applicationServerRequests),
            ),
          ),
          runtimeScope,
        );
        const conversationRuntimes = Context.get(requestHandlingContext, ConversationRuntimeMap);
        const serverRequests = Context.get(requestHandlingContext, CodexServerRequestRuntime);
        const approvalCoordinator = Context.get(requestHandlingContext, ApprovalCoordinator);
        const pendingServerRequests = yield* makeCodexPendingServerRequestRuntime({
          respond: (threadId, _requestId, occurrenceToken, response) =>
            approvalCoordinator.respondToken(threadId, occurrenceToken, response),
          reject: (threadId, requestId, occurrenceToken, reason) =>
            approvalCoordinator.rejectToken(
              threadId,
              occurrenceToken,
              CodexAppServerRequestError.internalError(
                "Codex application request failed",
                undefined,
                {
                  operation: "handle-request",
                  requestId: String(requestId),
                  cause: reason,
                },
              ),
            ),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const codexDependencies = Layer.mergeAll(
          CodexSessionTransport.nodeLive,
          Layer.succeed(CodexServerRequestRuntime, serverRequests),
          Layer.succeed(
            CodexThreadHostResolver,
            CodexThreadHostResolver.of({
              resolve: resolveCodexThreadHost,
            }),
          ),
        );
        const codexContext = yield* Layer.buildWithScope(
          CodexRuntimeLive.live({
            local: {
              hostId: "local",
              command: codexRuntime.binaryPath,
              args: ["app-server", "--listen", "stdio://"],
              env: {},
              resolveEnv: () =>
                resolveCodexProcessEnvironment({
                  additionalSearchPaths: codexRuntime.additionalSearchPaths,
                  pathDelimiter: config.platform === "win32" ? ";" : ":",
                  providerCredentialStore,
                  runtimeStateHome,
                }),
              forceTermination: "2 seconds",
              initializeParams: {
                clientInfo: { name: "nodex", title: "Nodex", version: "0.5.0" },
                capabilities: {
                  experimentalApi: true,
                  extensions: { "openai/form": {} },
                  requestAttestation: false,
                },
              },
              initializeTimeout: "20 seconds",
              expectedCodexHome: runtimeStateHome,
            },
            requestTimeout: "180 seconds",
          }).pipe(Layer.provide(codexDependencies)),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("codex-runtime", cause)));
        const codexGateway = Context.get(codexContext, CodexGateway);
        const codexClient = makeCodexGatewayPromiseClient(codexGateway, callbacks);
        const electronNetContext = yield* Layer.buildWithScope(ElectronNet.live, runtimeScope);
        const electronNet = Context.get(electronNetContext, ElectronNet.ElectronNet);
        const browserSidebarContext = yield* Layer.buildWithScope(
          browserSidebarRuntimeLive(userDataPath).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(FileSystem.FileSystem, fileSystem),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
              ),
            ),
          ),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("browser-sidebar-runtime", cause)));
        const browserSidebar = Context.get(browserSidebarContext, BrowserSidebarRuntime);
        const browserSidebarService = browserSidebar.browser;
        const appUpdateContext = yield* Layer.buildWithScope(
          appUpdateRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronApp, electron),
                Layer.succeed(ElectronWindowHost, windowHost),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
              ),
            ),
          ),
          runtimeScope,
        );
        const appUpdates = Context.get(appUpdateContext, AppUpdateRuntime);
        yield* Layer.buildWithScope(
          AppUpdateIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AppUpdateRuntime, appUpdates),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          AppProtocolRuntime.live.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(ElectronSessionHost, sessionHost),
                Layer.succeed(MainConfig, config),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          SessionPolicyRuntime.live.pipe(
            Layer.provide(Layer.succeed(ElectronSessionHost, sessionHost)),
          ),
          runtimeScope,
        );
        const mcpAppSandboxContext = yield* Layer.buildWithScope(
          mcpAppSandboxRuntimeLive({
            allowLocalDevelopment: !config.isPackaged,
            guestPreloadPath: `${__dirname}/../preload/mcp-app-sandbox-guest.js`,
            logger: getLogger({ subsystem: "mcp-app-sandbox" }),
          }),
          runtimeScope,
        );
        const mcpAppSandbox = Context.get(mcpAppSandboxContext, McpAppSandboxRuntime);
        const desktopNotificationContext = yield* Layer.buildWithScope(
          desktopNotificationRuntimeLive.pipe(Layer.provide(Layer.succeed(MainConfig, config))),
          runtimeScope,
        );
        const desktopNotifications = Context.get(
          desktopNotificationContext,
          DesktopNotificationRuntime,
        );
        const rendererClientContext = yield* Layer.buildWithScope(
          rendererClientRuntimeLive(),
          runtimeScope,
        );
        const rendererClients = Context.get(rendererClientContext, RendererClientRuntime);
        const windowRuntimeContext = yield* Layer.buildWithScope(
          windowRuntimeLive(userDataPath, config.platform as NodeJS.Platform),
          runtimeScope,
        );
        const windows = Context.get(windowRuntimeContext, WindowRuntime);
        const initializationContext = yield* Layer.buildWithScope(
          applicationInitializationRuntimeLive(windows),
          runtimeScope,
        );
        const initialization = Context.get(initializationContext, ApplicationInitializationRuntime);
        const databaseNotifierContext = yield* Layer.buildWithScope(
          DatabaseNotifierRuntime.live.pipe(Layer.provide(Layer.succeed(WindowRuntime, windows))),
          runtimeScope,
        );
        const databaseNotifications = Context.get(
          databaseNotifierContext,
          DatabaseNotifierRuntime.DatabaseNotifierRuntime,
        );
        const remoteHostedPipContext = yield* Layer.buildWithScope(
          remoteHostedPipRuntimeLive({
            browserSidebarEvents: browserSidebar.events,
            browserSidebarService,
            platform: config.platform as NodeJS.Platform,
            preferenceFilePath: `${userDataPath}/remote-hosted-pip-preferences.json`,
          }).pipe(Layer.provide(Layer.succeed(CodexGateway, codexGateway))),
          runtimeScope,
        );
        const remoteHostedPip = Context.get(remoteHostedPipContext, RemoteHostedPipRuntime);
        isPrivacySettingsTerminationRequest = remoteHostedPip.isPrivacySettingsTerminationRequest;
        yield* Layer.buildWithScope(
          RemoteHostedPipIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(RemoteHostedPipRuntime, remoteHostedPip),
              ),
            ),
          ),
          runtimeScope,
        );
        const conversationCommandsContext = yield* Layer.buildWithScope(
          conversationCommandsLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
              ),
            ),
          ),
          runtimeScope,
        );
        const conversationCommands = Context.get(conversationCommandsContext, ConversationCommands);
        const preferencesContext = yield* Layer.buildWithScope(codexPreferencesLive, runtimeScope);
        const preferences = Context.get(preferencesContext, CodexPreferences);
        const attachmentsContext = yield* Layer.buildWithScope(
          codexAttachmentsLive(getThreadGoalAttachmentsRoot(runtimeStateHome)),
          runtimeScope,
        );
        const attachments = Context.get(attachmentsContext, CodexAttachments);
        const computerUseContext = yield* Layer.buildWithScope(
          computerUseRuntimeLive({
            browserRuntime: codexRuntime.browserRuntime,
            peerAuthorizationMode: codexRuntime.source === "bundled" ? "packaged" : "development",
            platform: config.platform as NodeJS.Platform,
            runtimeConfig: () => ({ locale }),
            runtimeStateHome,
          }).pipe(Layer.provide(Layer.succeed(ScopedCallbackRuntime, callbacks))),
          runtimeScope,
        );
        const computerUse = Context.get(computerUseContext, ComputerUseRuntime);
        const desktopToolContext = yield* Layer.buildWithScope(
          desktopToolRuntimeLive({
            browserRuntime: codexRuntime.browserRuntime,
            runtimeStateHome,
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ComputerUseRuntime, computerUse),
              ),
            ),
          ),
          runtimeScope,
        );
        const desktopToolRuntime = Context.get(desktopToolContext, DesktopToolRuntime);
        const desktopTools = makeDesktopToolRuntimePromiseAdapter(desktopToolRuntime, callbacks);
        const browserUseContext = yield* Layer.buildWithScope(
          browserUseRuntimeLive({
            appVersion: config.appVersion,
            browserRuntime: codexRuntime.browserRuntime,
            browserEvents: browserSidebar.events,
            browserSidebar: browserSidebarService,
            environment: config.environment,
            isPackaged: config.isPackaged,
            platform: config.platform as NodeJS.Platform,
          }).pipe(Layer.provide(Layer.succeed(DesktopToolRuntime, desktopToolRuntime))),
          runtimeScope,
        );
        const browserUse = Context.get(browserUseContext, BrowserUseRuntime);
        const computerUseSettingsContext = yield* Layer.buildWithScope(
          computerUseSettingsRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  DesktopToolRuntime,
                  Context.get(desktopToolContext, DesktopToolRuntime),
                ),
                Layer.succeed(
                  RemoteHostedPipRuntime,
                  Context.get(remoteHostedPipContext, RemoteHostedPipRuntime),
                ),
                Layer.succeed(MainConfig, config),
              ),
            ),
          ),
          runtimeScope,
        );
        const computerUseSettings = Context.get(
          computerUseSettingsContext,
          ComputerUseSettingsRuntime,
        );
        yield* Layer.buildWithScope(
          ComputerUseSettingsIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ComputerUseSettingsRuntime, computerUseSettings),
              ),
            ),
          ),
          runtimeScope,
        );
        const localWorktreeWorkerContext = yield* Layer.buildWithScope(
          localWorktreeWorkerRuntimeLive({
            hostId: CODEX_APP_LOCAL_HOST_ID,
            workerPath: `${__dirname}/worktree-worker.js`,
            onInfrastructureError: (error) => {
              applicationLogger.error("Worktree worker infrastructure failed", {
                error: error.message,
              });
              captureMainException(error, { tags: { component: "worktree-worker" } });
            },
          }),
          runtimeScope,
        );
        const localWorktreeWorker = Context.get(
          localWorktreeWorkerContext,
          LocalWorktreeWorkerRuntime,
        );
        const gitWorkerContext = yield* Layer.buildWithScope(
          gitWorkerRuntimeLive({
            workerPath: `${__dirname}/git-worker.js`,
            onInfrastructureError: (error, context) => {
              applicationLogger.error("Git worker infrastructure failed", {
                epoch: context.epoch,
                error: error.message,
                phase: context.phase,
              });
              captureMainException(error, {
                tags: { component: "git-worker", phase: context.phase },
                extra: { epoch: context.epoch },
              });
            },
            onPerformanceOperation: (metric) =>
              applicationLogger.debug("Git worker operation", metric),
          }),
          runtimeScope,
        );
        const gitWorker = Context.get(gitWorkerContext, GitWorkerRuntime);
        const gitActionOperationContext = yield* Layer.buildWithScope(
          gitActionOperationRuntimeLive,
          runtimeScope,
        );
        const gitActionOperations = Context.get(
          gitActionOperationContext,
          GitActionOperationRuntime,
        );
        yield* Layer.buildWithScope(
          GitWorkerIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(GitWorkerRuntime, gitWorker),
                Layer.succeed(MainConfig, config),
              ),
            ),
          ),
          runtimeScope,
        );
        const providerCredentialsContext = yield* Layer.buildWithScope(
          ProviderCredentials.fromStore(providerCredentialStore),
          runtimeScope,
        );
        const providerCredentials = Context.get(
          providerCredentialsContext,
          ProviderCredentials.ProviderCredentials,
        );
        const agentProviderContext = yield* Layer.buildWithScope(
          agentProviderRuntimeLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ProviderCredentials.ProviderCredentials, providerCredentials),
              ),
            ),
          ),
          runtimeScope,
        );
        const agentProviders = Context.get(agentProviderContext, AgentProviderRuntime);
        const agentProviderRuntime = makeAgentProviderRuntimePromiseAdapter(
          agentProviders,
          callbacks,
        );
        const codexAccountContext = yield* Layer.buildWithScope(
          codexAccountLive({ pollInterval: "60 seconds" }).pipe(
            Layer.provide(Layer.succeed(CodexGateway, codexGateway)),
          ),
          runtimeScope,
        );
        const codexAccountService = Context.get(codexAccountContext, CodexAccount);
        const composerCatalogContext = yield* Layer.buildWithScope(
          composerCatalogLive.pipe(Layer.provide(Layer.succeed(CodexGateway, codexGateway))),
          runtimeScope,
        );
        const composerCatalogService = Context.get(composerCatalogContext, ComposerCatalog);
        const codexConnectionContext = yield* Layer.buildWithScope(
          codexConnectionLive.pipe(Layer.provide(Layer.succeed(CodexGateway, codexGateway))),
          runtimeScope,
        );
        const codexConnectionService = Context.get(codexConnectionContext, CodexConnection);
        const composerCatalog = makeComposerCatalogPromiseAdapter(
          composerCatalogService,
          callbacks,
        );
        const codexToolRuntimeContext = yield* Layer.buildWithScope(
          codexToolRuntimeLive({
            supportsChatGptApps: CODEX_INTEGRATION_CAPABILITIES.chatGptApps,
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CodexAccount, codexAccountService),
              ),
            ),
          ),
          runtimeScope,
        );
        const codexToolRuntimeService = Context.get(codexToolRuntimeContext, CodexToolRuntime);
        const chatGptContext = yield* Layer.buildWithScope(
          chatGptDesktopLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
              ),
            ),
          ),
          runtimeScope,
        );
        const chatGpt = Context.get(chatGptContext, ChatGptDesktop);
        const browserProfileContext = yield* Layer.buildWithScope(
          browserProfileRuntimeLive({
            browserSidebar: browserSidebarService,
            environment: config.environment,
            homeDirectory: config.homeDirectory,
            isPackaged: config.isPackaged,
            nodexHome: config.nodexHome,
            projectRootPath: config.projectRootPath,
            platform: config.platform,
            resourcesPath: config.resourcesPath,
            userDataPath,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ChatGptDesktop, chatGpt),
                Layer.succeed(BrowserProfileHelperPlatform, browserProfileHelper),
                Layer.succeed(ElectronApp, electron),
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(FileSystem.FileSystem, fileSystem),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
                Layer.succeed(ElectronSessionHost, sessionHost),
                Layer.succeed(ElectronWindowHost, windowHost),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
              ),
            ),
          ),
          runtimeScope,
        );
        const browserProfile = Context.get(browserProfileContext, BrowserProfileRuntime);
        yield* browserUse.install({
          grantDownload: (identity, sourceUrl, ttlMs) =>
            browserProfile.download.grantAgentDownload(identity, sourceUrl, ttlMs),
          policyStore: browserProfile.policy,
          releaseCredentialOwner: browserProfile.credentials.releaseOwner,
        });
        const codexMediaContext = yield* Layer.buildWithScope(
          codexMediaLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ChatGptDesktop, chatGpt),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
              ),
            ),
          ),
          runtimeScope,
        );
        const codexMedia = Context.get(codexMediaContext, CodexMedia);
        const externalSuggestionsContext = yield* Layer.buildWithScope(
          composerExternalSuggestionsLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ChatGptDesktop, chatGpt),
              ),
            ),
          ),
          runtimeScope,
        );
        const externalSuggestions = Context.get(
          externalSuggestionsContext,
          ComposerExternalSuggestions,
        );
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
        yield* terminals.events.pipe(
          Stream.runForEach((event) => {
            if (event.channel !== "terminal-data") return Effect.void;
            const projectSessionId = projectSessionIdFromTerminalSessionId(event.payload.sessionId);
            if (!projectSessionId) return Effect.void;
            return Effect.tryPromise(() =>
              projectWorkspace.getProjectSession(projectSessionId),
            ).pipe(
              Effect.flatMap((session) =>
                typeof session?.projectId === "string"
                  ? browserSidebar.localServers.observePtyData(
                      session.projectId,
                      event.payload.data,
                    )
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
        const applicationHostContext = yield* Layer.buildWithScope(
          applicationHostRuntimeLive().pipe(Layer.provide(Layer.succeed(MainConfig, config))),
          runtimeScope,
        );
        const applicationHost = Context.get(applicationHostContext, ApplicationHostRuntime);
        yield* Layer.buildWithScope(
          ApplicationSyncIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronSyncIpc, syncIpc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          WorkspaceFileIpc.live().pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          ApplicationLifecycleIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ApplicationHostRuntime, applicationHost),
                Layer.succeed(ApplicationInitializationRuntime, initialization),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const windowSessions = WindowSessionCatalog.WindowSessionCatalog.of({
          resolveForWebContents: (webContentsId) =>
            Effect.sync(() => windows.resolveSessionId(webContentsId)),
        });
        yield* Layer.buildWithScope(
          BrowserProfileIpc.live({ browserSidebar: browserSidebarService }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserProfileRuntime, browserProfile),
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(ElectronWindowHost, windowHost),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowSessionCatalog.WindowSessionCatalog, windowSessions),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          BrowserSidebarIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserSidebarRuntime, browserSidebar),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(ElectronWindowHost, windowHost),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowSessionCatalog.WindowSessionCatalog, windowSessions),
              ),
            ),
          ),
          runtimeScope,
        );
        const authorityLayer = coreAuthorityLive().pipe(
          Layer.provide(
            Layer.merge(
              coreTransportLive({
                appResourcesPath: config.isPackaged ? config.resourcesPath : undefined,
                buildId: `nodex-desktop/${config.appVersion}`,
                isPackaged: config.isPackaged,
                nodexHome: config.nodexHome,
                onAuthorityProcessExit: (event) => {
                  void callbacks.runPromise(initialization.observeAuthorityExit(event));
                },
                onStartupEvent: (event) => {
                  void callbacks.runPromise(initialization.observeCoreStartup(event));
                },
                repositoryRoot: config.projectRootPath,
              }),
              Layer.succeed(MainShutdown, shutdown),
            ),
          ),
        );
        const authorityContext = yield* Layer.buildWithScope(authorityLayer, runtimeScope).pipe(
          Effect.mapError((cause) => runtimeError("core-authority", cause)),
        );
        const authority = Context.get(authorityContext, CoreAuthority);
        const access = Context.get(authorityContext, CoreSessionAccess);
        yield* Layer.buildWithScope(
          CoreAuthorityIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const coreModulesContext = yield* Layer.buildWithScope(
          coreModulesLive.pipe(Layer.provide(Layer.succeed(CoreSessionAccess, access))),
          runtimeScope,
        );
        const coreModules = Context.get(coreModulesContext, CoreModules);
        const worktreeEnvironmentContext = yield* Layer.buildWithScope(
          worktreeEnvironmentRuntimeLive.pipe(
            Layer.provide(Layer.succeed(CoreModules, coreModules)),
          ),
          runtimeScope,
        );
        const worktreeEnvironments = Context.get(
          worktreeEnvironmentContext,
          WorktreeEnvironmentRuntime,
        );
        const worktreeShellEnvironmentContext = yield* Layer.buildWithScope(
          worktreeShellEnvironmentRuntimeLive({
            baseEnvironment: config.environment,
            platform: config.platform as NodeJS.Platform,
          }),
          runtimeScope,
        );
        const worktreeShellEnvironment = Context.get(
          worktreeShellEnvironmentContext,
          WorktreeShellEnvironmentRuntime,
        );
        const dataAuthority = yield* makeDesktopDataAuthority(callbacks).pipe(
          Effect.provideService(CoreAuthority, authority),
          Effect.provideService(CoreSessionAccess, access),
        );
        const legacyDataAuthority = Promise.resolve(dataAuthority);
        const automationModule = createDesktopAutomationModuleBridge({
          authority: legacyDataAuthority,
        });
        const storeAdministration = createDesktopStoreAdministrationBridge({
          authority: legacyDataAuthority,
        });
        const canvasPresenceContext = yield* Layer.buildWithScope(
          canvasPresenceRuntimeLive(),
          runtimeScope,
        );
        const canvasPresence = Context.get(canvasPresenceContext, CanvasPresenceRuntime);
        const documentSync = createDesktopDocumentSyncBridge({
          authority: legacyDataAuthority,
          canvasPresenceHub: canvasPresence.hub,
        });
        const libraryModule = createDesktopLibraryModuleBridge({ authority: legacyDataAuthority });
        const databaseModule = createDesktopDatabaseModuleBridge({
          authority: legacyDataAuthority,
        });
        const projectWorkspace = createDesktopProjectWorkspaceBridge({
          authority: legacyDataAuthority,
        });
        const nodexAgentDynamicService = createDesktopNodexAgentV3DynamicService({
          authority: legacyDataAuthority,
          projectWorkspace,
          databaseModule,
          documentSync,
        });
        const executionHostContext = yield* Layer.buildWithScope(
          executionHostRuntimeLive({
            runtimeStateHome,
            nodexHome: config.nodexHome,
            remoteWorktreeWorkerBundlePath: `${__dirname}/remote-worktree-worker.cjs`,
            localWorktreeWorker: localWorktreeWorker.port,
            settings: {
              read: getCodexExecutionHostSettings,
              update: updateCodexExecutionHostSettings,
            },
            managedWorktrees: {
              read: getManagedWorktreeSettings,
              listKnownRoots: getKnownManagedWorktreeRoots,
            },
          }).pipe(Layer.provide(Layer.succeed(CodexGateway, codexGateway))),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("construct-execution-hosts", cause)));
        const executionHosts = Context.get(executionHostContext, ExecutionHostRuntime);
        const managedWorktreeContext = yield* Layer.buildWithScope(
          managedWorktreeRuntimeLive.pipe(
            Layer.provide(Layer.succeed(ExecutionHostRuntime, executionHosts)),
          ),
          runtimeScope,
        );
        const managedWorktrees = Context.get(managedWorktreeContext, ManagedWorktreeRuntime);
        const managedWorktreeRetentionContext = yield* Layer.buildWithScope(
          managedWorktreeRetentionRuntimeLive(),
          runtimeScope,
        );
        const managedWorktreeRetention = Context.get(
          managedWorktreeRetentionContext,
          ManagedWorktreeRetentionRuntime,
        );
        yield* Layer.buildWithScope(
          ExecutionHostIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(ExecutionHostRuntime, executionHosts),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const codexPermissionsContext = yield* Layer.buildWithScope(
          codexPermissionsLive({ runtimeStateHome }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const codexPermissions = Context.get(codexPermissionsContext, CodexPermissions);
        yield* Layer.buildWithScope(
          CodexPermissionsIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexPermissions, codexPermissions),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const persistedAtoms = makePersistedAtomStore(config.nodexHome);
        const codexSessionStore = new CodexSessionStore();
        yield* Scope.addFinalizer(
          runtimeScope,
          Effect.sync(() => codexSessionStore.clear()),
        );
        const isActiveGoalContinuationCandidate = (conversationId: string) =>
          codexService?.isActiveThreadGoalContinuationCandidate(conversationId) === true;
        const activeGoalContinuation = yield* makeCodexActiveGoalContinuation({
          isEligible: isActiveGoalContinuationCandidate,
          continueGoal: (conversationId) =>
            Effect.tryPromise({
              try: () => requireCodexService().runActiveThreadGoalContinuation(conversationId),
              catch: (cause) => new CodexActiveGoalContinuationError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const activeGoalContinuationCallbacks =
          yield* makeCodexActiveGoalContinuationCallbackAdapter(activeGoalContinuation).pipe(
            Effect.provideService(Scope.Scope, runtimeScope),
          );
        const notificationRouting = yield* makeCodexNotificationRouting({
          route: (notification) =>
            Effect.tryPromise({
              try: () => requireCodexService().routeAppServerNotification(notification),
              catch: (cause) => new CodexNotificationRoutingError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const ownerNotificationDrain = yield* makeCodexOwnerNotificationDrainRuntime().pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const rendererConversations = yield* makeCodexRendererConversationRuntime().pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const sidebarSync = yield* makeCodexSidebarSyncRuntime({
          refresh: (input) =>
            Effect.tryPromise({
              try: () => requireCodexService().refreshSidebarThreadsForSync(input),
              catch: (cause) => new CodexSidebarSyncError({ cause }),
            }),
          buildSnapshot: (includeArchived, revision) =>
            Effect.tryPromise({
              try: () =>
                requireCodexService().buildBoundedWorkspaceSidebarSnapshot(
                  includeArchived,
                  revision,
                ),
              catch: (cause) => new CodexSidebarSyncError({ cause }),
            }),
          emit: (result, reason) => requireCodexService().emitSidebarSyncUpdated(result, reason),
          subscribeInvalidation: (invalidate) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                databaseNotifications.notifier.on("project-sessions-changed", invalidate);
              }),
              () =>
                Effect.sync(() => {
                  databaseNotifications.notifier.off("project-sessions-changed", invalidate);
                }),
            ),
          observeDecision: (event) => requireCodexService().recordSidebarSyncDecision(event),
          observeRefresh: (event) => requireCodexService().recordSidebarRefreshOutcome(event),
          observeNotificationScheduled: (event) =>
            requireCodexService().recordSidebarNotificationScheduled(event),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const sidebarSweep = yield* makeCodexSidebarSweepRuntime().pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const gitProbe = makeCodexGitProbe({ environment: config.environment });
        const externalAgentImport = yield* makeCodexExternalAgentImportRuntime({
          hostId: codexGateway.localHostId,
          events: codexGateway.events,
          request: (items) =>
            codexGateway
              .requestLocal("externalAgentConfig/import", {
                migrationItems: [...items],
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CodexExternalAgentImportError({
                      reason: "request-failed",
                      message:
                        cause instanceof Error
                          ? cause.message
                          : "Could not start the Claude Code import",
                      cause,
                    }),
                ),
              ),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const heartbeatTurnCompletion = yield* makeCodexHeartbeatTurnCompletion({
          events: codexGateway.events,
          resolveHost: (threadId) =>
            resolveCodexThreadHost(threadId).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexHeartbeatTurnCompletionError({
                    reason: "request-failed",
                    message: `Could not resolve the execution host for heartbeat thread ${threadId}`,
                    cause,
                    threadId,
                  }),
              ),
            ),
          request: (hostId, params) =>
            codexGateway.requestOnHost(hostId, "turn/start", params).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexHeartbeatTurnCompletionError({
                    reason: "request-failed",
                    message: `Could not start the heartbeat turn on host ${hostId}`,
                    cause,
                    threadId: params.threadId,
                  }),
              ),
            ),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const structuredThreadTitle = yield* makeCodexStructuredThreadTitle({
          hostId: codexGateway.localHostId,
          events: codexGateway.events,
          startThread: (params) =>
            codexGateway.requestLocal("thread/start", params).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexStructuredThreadTitleError({
                    reason: "request-failed",
                    message: "Structured thread title thread/start failed",
                    cause,
                  }),
              ),
            ),
          startTurn: (params) =>
            codexGateway.requestLocal("turn/start", params).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexStructuredThreadTitleError({
                    reason: "request-failed",
                    message: "Structured thread title turn/start failed",
                    cause,
                    threadId: params.threadId,
                  }),
              ),
            ),
          interruptTurn: (threadId, turnId) =>
            codexGateway.requestLocal("turn/interrupt", { threadId, turnId }).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexStructuredThreadTitleError({
                    reason: "request-failed",
                    message: "Structured thread title turn/interrupt failed",
                    cause,
                    threadId,
                    turnId,
                  }),
              ),
            ),
          unsubscribeThread: (threadId) =>
            codexGateway.requestLocal("thread/unsubscribe", { threadId }).pipe(
              Effect.mapError(
                (cause) =>
                  new CodexStructuredThreadTitleError({
                    reason: "request-failed",
                    message: "Structured thread title thread/unsubscribe failed",
                    cause,
                    threadId,
                  }),
              ),
            ),
          registerInternalThread: (threadId) =>
            Effect.sync(() => requireCodexService().registerStructuredThreadTitleThread(threadId)),
          releaseInternalThread: (threadId) =>
            Effect.sync(() => requireCodexService().releaseStructuredThreadTitleThread(threadId)),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const dynamicToolsLaunch = makeCodexDynamicToolsLaunch();
        const sidebarThreadMoveRuntime = yield* makeCodexSidebarThreadMoveRuntime;
        const threadSettingsRuntime = yield* makeCodexThreadSettingsRuntime.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadTitlePersistence = yield* makeCodexThreadTitlePersistence({
          setRemote: ({ threadId, name }) =>
            Effect.tryPromise({
              try: () => requireCodexService().setThreadTitleOnAppServer(threadId, name),
              catch: (cause) => new CodexThreadTitlePersistenceEffectError({ cause }),
            }),
          persistWorkspace: ({ threadId, name }) =>
            Effect.tryPromise({
              try: () => requireCodexService().persistThreadTitleInProjectWorkspace(threadId, name),
              catch: (cause) => new CodexThreadTitlePersistenceEffectError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const conversationHistory = yield* makeCodexConversationHistoryRuntime({
          shouldLoadRemaining: (threadId) =>
            requireCodexService().shouldLoadRemainingThreadTurns(threadId),
          load: (input) =>
            Effect.tryPromise({
              try: () => requireCodexService().loadConversationHistory(input),
              catch: (cause) => new CodexConversationHistoryError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const conversationResume = yield* makeCodexConversationResumeRuntime({
          run: (input) =>
            Effect.tryPromise({
              try: () => requireCodexService().runConversationResume(input),
              catch: (cause) => new CodexConversationResumeError({ cause }),
            }),
          observe: (outcome) => requireCodexService().recordConversationResumeOutcome(outcome),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const conversationEventBuffer = yield* makeCodexConversationEventBufferRuntime({
          compact: (threadId, events) =>
            requireCodexService().compactBufferedConversationEvents(threadId, events),
          replayNotification: (input) =>
            Effect.tryPromise({
              try: () => requireCodexService().replayBufferedConversationNotification(input),
              catch: (cause) =>
                new CodexConversationEventBufferError({
                  cause,
                  phase: input.phase,
                  threadId: input.threadId,
                }),
            }),
          replayRequest: (input) =>
            Effect.promise(() => requireCodexService().replayBufferedConversationRequest(input)),
          reportThreadStartReplayFailure: (input) =>
            requireCodexService().recordThreadStartReplayFailure(input),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const freshThreadLaunchError = (launch: CodexFreshThreadLaunch, cause: unknown) =>
          new CodexFreshThreadLaunchError(
            "operation-failed",
            {
              launchId: launch.launchId,
              ownerClientId: launch.rendererClientId,
              threadId: launch.threadId,
            },
            { cause },
          );
        const freshThreadLaunch = yield* makeCodexFreshThreadLaunchRuntime({
          adopt: (launch) =>
            Effect.tryPromise({
              try: () => requireCodexService().adoptFreshThreadLaunch(launch),
              catch: (cause) => freshThreadLaunchError(launch, cause),
            }),
          readAdopted: (launch) =>
            Effect.tryPromise({
              try: () => requireCodexService().readAdoptedFreshThreadLaunch(launch),
              catch: (cause) => freshThreadLaunchError(launch, cause),
            }),
          start: (launch) =>
            Effect.tryPromise({
              try: () => requireCodexService().runFreshThreadLaunchFirstTurn(launch),
              catch: (cause) => freshThreadLaunchError(launch, cause),
            }),
          abandon: (launch, reason) =>
            requireCodexService().abandonFreshThreadLaunch(launch, reason),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const backgroundSubagentMetadataRepair = yield* makeCodexBackgroundSubagentMetadataRepair({
          isRepairNeeded: (parentThreadId, childThreadId) =>
            requireCodexService().isBackgroundSubagentMetadataRepairNeeded(
              parentThreadId,
              childThreadId,
            ),
          repair: (parentThreadId, childThreadId) =>
            Effect.tryPromise({
              try: () =>
                requireCodexService().repairBackgroundSubagentMetadata(
                  parentThreadId,
                  childThreadId,
                ),
              catch: (cause) => new CodexBackgroundSubagentMetadataRepairError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const queuedFollowUpDispatch = yield* makeCodexQueuedFollowUpDispatchRuntime({
          isEligible: (threadId) =>
            requireCodexService().isQueuedFollowUpDispatchEligible(threadId),
          take: (threadId) => requireCodexService().takeQueuedFollowUpForDispatch(threadId),
          submit: (threadId, followUp) =>
            Effect.tryPromise({
              try: () => requireCodexService().submitQueuedFollowUp(threadId, followUp),
              catch: (cause) => new CodexQueuedFollowUpDispatchError({ cause }),
            }),
          restore: (threadId, followUp, reason) =>
            requireCodexService().restoreQueuedFollowUp(threadId, followUp, reason),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const conversationDeltaBuffer = yield* makeCodexConversationDeltaBufferRuntime({
          flushFrameText: (updates) => requireCodexService().applyFrameTextDeltas(updates),
          flushCommandOutput: (updates) => requireCodexService().applyOutputDeltas(updates),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const postResumeGoals = yield* makeCodexPostResumeGoalRuntime({
          load: (threadId) =>
            Effect.tryPromise({
              try: () => requireCodexService().loadThreadGoalAfterResume(threadId),
              catch: (cause) => new CodexPostResumeGoalError({ cause }),
            }),
          commit: (threadId, expectedRevision, goal) =>
            requireCodexService().commitThreadGoalHydratedAfterResume(
              threadId,
              expectedRevision,
              goal,
            ),
          requestContinuation: (threadId) =>
            requireCodexService().requestActiveGoalContinuationAfterResume(threadId),
          scheduleRemainingTurns: conversationHistory.requestRemaining,
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const threadHandoffRuntime = yield* makeCodexThreadHandoffRuntime({
          scope: runtimeScope,
          storage: makeCodexThreadHandoffJournalStorage(
            resolveCodexThreadHandoffJournalPath(runtimeStateHome),
          ),
          resolveHostDisplayName: (hostId) =>
            executionHosts.registry.getDescriptor(hostId)?.displayName ?? hostId,
        });
        const pendingWorktrees = yield* makeCodexPendingWorktreeRuntime({
          createWorktree: (entry, onEvent) =>
            Effect.tryPromise({
              try: (signal) =>
                requireCodexService().createPendingManagedWorktree(entry, {
                  signal,
                  onEvent,
                }),
              catch: (cause) =>
                new CodexPendingWorktreeEffectError({ operation: "create-worktree", cause }),
            }),
          launchConversation: (entry, workspaceRoot, context) =>
            Effect.tryPromise({
              try: () =>
                requireCodexService().launchPendingWorktreeConversation(
                  entry,
                  workspaceRoot,
                  context,
                ),
              catch: (cause) =>
                new CodexPendingWorktreeEffectError({
                  operation: "launch-conversation",
                  cause,
                }),
            }),
          removeWorktree: (hostId, worktreeGitRoot) =>
            managedWorktrees.remove({ hostId, worktreeGitRoot, reason: "cancel" }).pipe(
              Effect.asVoid,
              Effect.mapError(
                (cause) =>
                  new CodexPendingWorktreeEffectError({
                    operation: "remove-worktree",
                    cause,
                  }),
              ),
            ),
          cleanupGoalSources: (entry) =>
            Effect.tryPromise({
              try: () => requireCodexService().cleanupPendingGoalSources(entry),
              catch: (cause) =>
                new CodexPendingWorktreeEffectError({
                  operation: "cleanup-goal-sources",
                  cause,
                }),
            }),
          registerStableProject: (workspaceRoots, label) =>
            Effect.tryPromise({
              try: () =>
                projectWorkspace.createProject({
                  name: label,
                  sources: [...workspaceRoots],
                }),
              catch: (cause) =>
                new CodexPendingWorktreeEffectError({
                  operation: "register-stable-project",
                  cause,
                }),
            }).pipe(Effect.asVoid),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        yield* pendingWorktrees.changes.pipe(
          Stream.runForEach((entries) =>
            Effect.sync(() => requireCodexService().projectPendingWorktreeSnapshot(entries)),
          ),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        const isInactiveRendererOwnerCandidate = (conversationId: string) =>
          codexService?.isInactiveRendererOwnerCandidate(conversationId) === true;
        const rendererOwnerRetention = yield* makeCodexRendererOwnerRetention({
          isCandidate: isInactiveRendererOwnerCandidate,
          unsubscribe: (conversationId) =>
            codexGateway
              .requestForThread(conversationId, "thread/unsubscribe", {
                threadId: conversationId,
              })
              .pipe(
                Effect.asVoid,
                Effect.mapError((cause) => new CodexRendererOwnerRetentionError({ cause })),
              ),
          commitCleanup: (conversationId) =>
            Effect.sync(() => {
              requireCodexService().commitInactiveRendererOwnerCleanup(conversationId);
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const rendererOwnerRetentionCallbacks =
          yield* makeCodexRendererOwnerRetentionCallbackAdapter(rendererOwnerRetention, {
            isCandidate: isInactiveRendererOwnerCandidate,
          }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const userInputAutoResolution = yield* makeCodexUserInputAutoResolution({
          isConversationPresented: (conversationId) =>
            codexService?.isRendererConversationPresentedInForeground(conversationId) === true,
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const codexApplicationEvents = yield* makeCodexApplicationEventHub.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const forkBrowserSnapshotAdapter = createCodexForkBrowserSnapshotAdapter({
          getProjectSession: (projectSessionId) =>
            projectWorkspace.getProjectSession(projectSessionId),
          resolveBrowserConversationId: (conversationId) =>
            requireCodexService().resolveForkBrowserConversationId(conversationId),
          runtime: browserSidebarService,
        });
        const forkSidePanelTransfers = yield* makeCodexForkSidePanelTransferRuntime({
          capture: (sourceConversationId, sourceSceneContext) =>
            Effect.tryPromise({
              try: () =>
                forkBrowserSnapshotAdapter.capture(sourceConversationId, sourceSceneContext),
              catch: (cause) => new CodexForkSidePanelAdapterError({ cause }),
            }),
          rebase: (snapshot, input) =>
            Effect.tryPromise({
              try: () => forkBrowserSnapshotAdapter.rebase(snapshot, input),
              catch: (cause) => new CodexForkSidePanelAdapterError({ cause }),
            }),
          apply: (snapshot, input) =>
            Effect.tryPromise({
              try: () => forkBrowserSnapshotAdapter.apply(snapshot, input),
              catch: (cause) => new CodexForkSidePanelAdapterError({ cause }),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const agentImportOperations = new AgentImportOperations({
          runtimeStateHome,
          detectClaude: () =>
            callbacks.runPromise(
              codexGateway
                .requestLocal("externalAgentConfig/detect", { includeHome: true, cwds: [] })
                .pipe(
                  Effect.map(
                    (response) =>
                      response.items as unknown as readonly ExternalAgentConfigMigrationItem[],
                  ),
                ),
            ),
          importClaude: (items, onProgress) =>
            requireCodexService().importClaudeAgentConfiguration(items, onProgress),
          forkSession: (session) => requireCodexService().importRolloutSession(session),
          applyConfigEdits: (edits) =>
            callbacks.runPromise(
              edits.length === 0
                ? Effect.void
                : codexGateway
                    .requestLocal("config/batchWrite", {
                      edits: edits.map((edit) => ({
                        keyPath: edit.keyPath,
                        mergeStrategy: "upsert" as const,
                        value:
                          edit.value as ClientRequestParamsByMethod["config/batchWrite"]["edits"][number]["value"],
                      })),
                      reloadUserConfig: true,
                    })
                    .pipe(Effect.asVoid),
            ),
        });
        const agentImport = yield* makeAgentImportRuntime(
          {
            scan: (sourceKind, selectedSourceHome, now) =>
              Effect.tryPromise({
                try: () => agentImportOperations.scan(sourceKind, selectedSourceHome, now),
                catch: (cause) => new AgentImportOperationsError({ operation: "scan", cause }),
              }),
            apply: (input, scan, importId, startedAt, emitProgress) =>
              Effect.tryPromise({
                try: () =>
                  agentImportOperations.apply(input, scan, importId, startedAt, emitProgress),
                catch: (cause) => new AgentImportOperationsError({ operation: "apply", cause }),
              }),
            makeImportId: Effect.try({
              try: () => agentImportOperations.makeImportId(),
              catch: (cause) => new AgentImportOperationsError({ operation: "id", cause }),
            }),
          },
          (progress) =>
            Effect.sync(() => requireCodexService().projectAgentImportProgress(progress)),
        ).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const dataAuthorityPromise = Promise.resolve(dataAuthority);
        const nodexAgentResourceAuthority = createDesktopNodexAgentResourceAuthorityPort({
          authority: dataAuthorityPromise,
        });
        const nodexAgentAuthorizationContext = yield* Layer.buildWithScope(
          nodexAgentAuthorizationRuntimeLive({
            readStoreEpoch: () => dataAuthority.identity.storeEpoch,
            persistProjectGrants: (input) =>
              Effect.tryPromise({
                try: () => nodexAgentResourceAuthority.persistProjectGrants(input),
                catch: (cause) => new NodexAgentAuthorizationPersistenceError({ cause }),
              }),
          }).pipe(Layer.provide(Layer.succeed(RendererClientRuntime, rendererClients))),
          runtimeScope,
        );
        const nodexAgentAuthorization = Context.get(
          nodexAgentAuthorizationContext,
          NodexAgentAuthorizationRuntime,
        );
        codexService = yield* Effect.try({
          try: () => {
            return new CodexService({
              applicationEvents: codexApplicationEvents,
              browserTransferStateReader: browserSidebarService,
              forkSidePanelTransferLifecycle: makeCodexForkSidePanelTransferRuntimePromiseAdapter(
                forkSidePanelTransfers,
                callbacks,
              ),
              agentImport: makeAgentImportRuntimePromiseAdapter(agentImport, callbacks),
              agentProviderRuntime,
              composerCatalog,
              desktopTools,
              preferences,
              permissions: makeCodexPermissionsPromiseAdapter(codexPermissions, callbacks),
              persistedAtoms,
              attachments: attachments.legacy,
              pendingServerRequests: makeCodexPendingServerRequestRuntimePromiseAdapter(
                pendingServerRequests,
                callbacks,
              ),
              activeGoalContinuation: activeGoalContinuationCallbacks,
              ownerNotificationDrain: makeCodexOwnerNotificationDrainRuntimePromiseAdapter(
                ownerNotificationDrain,
                callbacks,
              ),
              rendererConversations,
              rendererOwnerRetention: rendererOwnerRetentionCallbacks,
              sidebarSync: makeCodexSidebarSyncRuntimePromiseAdapter(sidebarSync, callbacks),
              sidebarSweep: makeCodexSidebarSweepRuntimePromiseAdapter(sidebarSweep, callbacks),
              gitProbe: makeCodexGitProbePromiseAdapter(gitProbe, callbacks),
              externalAgentImport: makeCodexExternalAgentImportRuntimePromiseAdapter(
                externalAgentImport,
                callbacks,
              ),
              heartbeatTurnCompletion: makeCodexHeartbeatTurnCompletionPromiseAdapter(
                heartbeatTurnCompletion,
                callbacks,
              ),
              structuredThreadTitle: makeCodexStructuredThreadTitlePromiseAdapter(
                structuredThreadTitle,
                callbacks,
              ),
              dynamicToolsLaunch: makeCodexDynamicToolsLaunchPromiseAdapter(
                dynamicToolsLaunch,
                callbacks,
              ),
              sidebarThreadMoveRuntime: makeCodexSidebarThreadMoveRuntimePromiseAdapter(
                sidebarThreadMoveRuntime,
                callbacks,
              ),
              threadHandoffRuntime: makeCodexThreadHandoffRuntimePromiseAdapter(
                threadHandoffRuntime,
                callbacks,
              ),
              pendingWorktrees: makeCodexPendingWorktreeRuntimePromiseAdapter(
                pendingWorktrees,
                callbacks,
              ),
              threadSettingsRuntime: makeCodexThreadSettingsRuntimePromiseAdapter(
                threadSettingsRuntime,
                callbacks,
              ),
              threadTitlePersistence: makeCodexThreadTitlePersistencePromiseAdapter(
                threadTitlePersistence,
                callbacks,
              ),
              postResumeGoals: makeCodexPostResumeGoalRuntimePromiseAdapter(
                postResumeGoals,
                callbacks,
              ),
              conversationHistory: makeCodexConversationHistoryRuntimePromiseAdapter(
                conversationHistory,
                callbacks,
              ),
              backgroundSubagentMetadataRepair,
              queuedFollowUpDispatch,
              conversationDeltaBuffer: makeCodexConversationDeltaBufferRuntimePromiseAdapter(
                conversationDeltaBuffer,
                callbacks,
              ),
              conversationResume: makeCodexConversationResumeRuntimePromiseAdapter(
                conversationResume,
                callbacks,
              ),
              conversationEventBuffer: makeCodexConversationEventBufferRuntimePromiseAdapter(
                conversationEventBuffer,
                callbacks,
              ),
              freshThreadLaunch: makeCodexFreshThreadLaunchRuntimePromiseAdapter(
                freshThreadLaunch,
                callbacks,
              ),
              userInputAutoResolution: makeCodexUserInputAutoResolutionPromiseAdapter(
                userInputAutoResolution,
                callbacks,
              ),
              sessionStore: codexSessionStore,
              client: codexClient,
              runtime: codexRuntime,
              runtimeStateHome,
              nodexAgentDynamicService,
              nodexAgentAuthorization: makeNodexAgentAuthorizationRuntimePromiseAdapter(
                nodexAgentAuthorization,
                callbacks,
              ),
              loadWorktreeSetupBaseEnvironment: () =>
                callbacks.runPromise(worktreeShellEnvironment.load),
              executionHosts: executionHosts.registry,
              managedWorktrees: makeManagedWorktreeRuntimePromiseAdapter(
                managedWorktrees,
                callbacks,
              ),
              managedWorktreeRetention: makeManagedWorktreeRetentionRuntimePromiseAdapter(
                managedWorktreeRetention,
                callbacks,
              ),
              projectRuntimeLifecycle: projectRuntimeLifecycleAdapter,
              terminalRuntime: {
                getSessionSnapshot: (sessionId) =>
                  callbacks.runPromise(terminals.getSessionSnapshot(sessionId)),
                getThreadSnapshot: (threadId) =>
                  callbacks.runPromise(terminals.getThreadSnapshot(threadId)),
                refreshSessionProcessMetrics: (sessionIds) =>
                  callbacks.runPromise(terminals.refreshSessionProcessMetrics(sessionIds)),
              },
            });
          },
          catch: (cause) => runtimeError("construct-codex-application", cause),
        });
        yield* Layer.buildWithScope(
          codexApplicationIngressRuntimeLive({
            connections: codexConnectionService.changes,
            events: codexGateway.events,
            observeConnection: (connection) => codexService.observeConnection(connection),
            offerNotification: notificationRouting.offer,
          }),
          runtimeScope,
        );
        yield* SubscriptionRef.changes(executionHosts.activeSshHosts).pipe(
          Stream.runForEach(() =>
            Effect.sync(() => codexService.handleExecutionHostTopologyChanged()),
          ),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        yield* Layer.buildWithScope(
          codexRendererProjectionRuntimeLive({
            codex: codexService,
            events: codexApplicationEvents,
            rendererClients,
            userInputAutoResolution,
            windows,
          }),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CodexRendererIpc.live({
            codex: codexService,
            rendererClients,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(CodexUserInputAutoResolution, userInputAutoResolution),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        yield* Layer.buildWithScope(
          CodexPendingWorktreeIpc.live({ codex: codexService }).pipe(
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
          applicationRequestDispatcherLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
                Layer.succeed(CodexGlobalServerRequestRuntime, applicationServerRequests),
              ),
            ),
          ),
          runtimeScope,
        );
        const initialProjectBootstrapContext = yield* Layer.buildWithScope(
          initialProjectBootstrapRuntimeLive({
            projectWorkspace,
            projectsDirectory: resolveInitialProjectProjectsDirectory({
              configuredDirectory: config.initialProjectsDirectory ?? undefined,
              documentsDirectory: config.documentsPath,
            }),
            journalPath: resolveInitialProjectJournalPath(config.nodexHome),
          }),
          runtimeScope,
        );
        const initialProjectBootstrap = Context.get(
          initialProjectBootstrapContext,
          InitialProjectBootstrapRuntime,
        );
        yield* Layer.buildWithScope(
          CoreDocumentIpc.live({
            database: databaseModule,
            documents: documentSync,
            library: libraryModule,
          }).pipe(
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
          CoreMutationIpc.live({
            database: databaseModule,
            documents: documentSync,
            library: libraryModule,
            rendererClients,
          }).pipe(
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
          DatabaseProjectionIpc.live({ database: databaseModule }).pipe(
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
          ProjectWorkspaceIpc.live({
            codex: codexService,
            projects: projectWorkspace,
            terminals: {
              listLiveSessionsForOwners: (input) =>
                callbacks.runPromise(terminals.listLiveSessionsForOwners(input)),
              discardExitedSessionsForOwners: (input) =>
                callbacks.runPromise(terminals.discardExitedSessionsForOwners(input)),
            },
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(BrowserSidebarRuntime, browserSidebar),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const scheduledAutomationContext = yield* Layer.buildWithScope(
          scheduledAutomationRuntimeLive({
            automation: automationModule,
            run: (automation, context) => codexService.runScheduledAutomation(automation, context),
            notifyRunsUpdated: () => {
              codexService.notifyAutomationRunsUpdated({
                automationId: null,
                threadId: null,
                reason: "settle",
              });
            },
          }).pipe(Layer.provide(Layer.succeed(CoreAuthority, authority))),
          runtimeScope,
        );
        const scheduledAutomations = Context.get(
          scheduledAutomationContext,
          ScheduledAutomationRuntime,
        );
        yield* Layer.buildWithScope(
          AutomationIpc.live({
            automation: automationModule,
            codex: codexService,
            rendererClients,
            onHeartbeatAutomationsEnabledChanged: (input) => {
              callbacks.fork(scheduledAutomations.setHeartbeatAutomationsEnabled(input.enabled));
            },
            onHeartbeatAutomationThreadStateChanged: (input, rendererClientId) => {
              callbacks.fork(
                scheduledAutomations.setHeartbeatThreadRendererState({
                  ...input,
                  rendererClientId,
                }),
              );
            },
          }).pipe(
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
          StoreAdministrationIpc.live({
            administration: storeAdministration,
            onStoreRestored: Effect.sleep("250 millis").pipe(
              Effect.andThen(electron.relaunch),
              Effect.andThen(electron.exit(0)),
            ),
          }).pipe(
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
          GitApplicationIpc.live({ codex: codexService }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(GitActionOperationRuntime, gitActionOperations),
                Layer.succeed(GitWorkerRuntime, gitWorker),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
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
          PageSearchIpc.live({ library: libraryModule }).pipe(
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
        const composerAppshotContext = yield* Layer.buildWithScope(
          composerAppshotRuntimeLive.pipe(Layer.provide(Layer.succeed(MainConfig, config))),
          runtimeScope,
        );
        const composerAppshots = Context.get(composerAppshotContext, ComposerAppshotRuntime);
        yield* Layer.buildWithScope(
          ComposerAppshotIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ComposerAppshotRuntime, composerAppshots),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const applicationWindowContext = yield* Layer.buildWithScope(
          applicationWindowRuntimeLive({
            appUpdates,
            browserSidebar: browserSidebarService,
            codex: codexService,
            desktopNotifications,
            iconPath: config.isPackaged
              ? `${config.resourcesPath}/icon.png`
              : `${config.projectRootPath}/resources/icon.png`,
            mcpAppSandbox,
            platform: config.platform as NodeJS.Platform,
            preloadPath: `${__dirname}/../preload/index.js`,
            rendererClients,
            rendererUrl: config.rendererUrl ?? APP_RENDERER_URL,
            windows,
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(ComposerAppshotRuntime, composerAppshots),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
              ),
            ),
          ),
          runtimeScope,
        );
        const applicationWindows = Context.get(applicationWindowContext, ApplicationWindowRuntime);
        yield* Layer.buildWithScope(
          ApplicationWindowIpc.live().pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ApplicationWindowRuntime, applicationWindows),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const deepLinkContext = yield* Layer.buildWithScope(
          deepLinkRuntimeLive({
            focusWindow: applicationWindows.focusLast,
            library: libraryModule,
            projectWorkspace,
            windows,
          }),
          runtimeScope,
        );
        const deepLinks = Context.get(deepLinkContext, DeepLinkRuntime);
        yield* applicationWindows.rendererLoaded.pipe(
          Stream.runForEach(() =>
            Effect.all([deepLinks.flush, appUpdates.startAutomaticChecks], {
              concurrency: 2,
            }).pipe(Effect.asVoid),
          ),
          Effect.forkIn(runtimeScope),
          Effect.asVoid,
        );
        const applicationMenuContext = yield* Layer.buildWithScope(
          applicationMenuRuntimeLive({
            checkForUpdates: appUpdates.check,
            environmentPath: config.environmentPath ?? undefined,
            initialCommandKeymap: getCommandKeymapState(),
            isPackaged: config.isPackaged,
            platform: config.platform as NodeJS.Platform,
            requestNewWindow: applicationWindows.requestNew,
            resourcesPath: config.resourcesPath,
            showMessage: desktop.showMessage,
            windows,
          }).pipe(Layer.provide(Layer.succeed(ScopedCallbackRuntime, callbacks))),
          runtimeScope,
        );
        const applicationMenus = Context.get(applicationMenuContext, ApplicationMenuRuntime);
        const coreApplicationProjectionContext = yield* Layer.buildWithScope(
          coreApplicationProjectionRuntimeLive({
            automation: {
              notifyAutomationRunsUpdated: (event) =>
                codexService.notifyAutomationRunsUpdated(event),
              notifyScheduledAutomationChanged: (event) =>
                codexService.notifyScheduledAutomationChanged(event),
              synchronize: Effect.promise(() => codexService.synchronizeAutomationRuntime()),
            },
            notifier: databaseNotifications.notifier,
          }).pipe(Layer.provide(Layer.succeed(ScopedCallbackRuntime, callbacks))),
          runtimeScope,
        );
        const coreApplicationProjection = Context.get(
          coreApplicationProjectionContext,
          CoreApplicationProjectionRuntime,
        );
        const projectionDeliveryContext = yield* Layer.buildWithScope(
          projectionDeliveryRuntimeLive({
            authority: dataAuthority,
            documentSync,
            onNotification: coreApplicationProjection.publish,
          }),
          runtimeScope,
        );
        const projectionDelivery = Context.get(
          projectionDeliveryContext,
          ProjectionDeliveryRuntime,
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
        const reminderSchedulerContext = yield* Layer.buildWithScope(
          reminderSchedulerRuntimeLive({ automation: automationModule }).pipe(
            Layer.provide(
              Layer.merge(
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
            administration: storeAdministration,
            readBackupSettings: getBackupSettings,
            readBlockRetentionCount: () => getHistorySettings().retentionCount,
          }).pipe(Layer.provide(Layer.succeed(CoreAuthority, authority))),
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

        yield* deepLinks.extractFromArgv(config.argv);
        codexService.setNodexAgentAuthorityPort(
          createDesktopNodexAgentAuthorityPort({ authority: dataAuthorityPromise }),
        );
        codexService.setNodexAgentResourceAuthorityPort(nodexAgentResourceAuthority);
        codexService.setAutomationModule(automationModule);
        codexService.setProjectWorkspacePort(projectWorkspace);
        const initializationStartedAt = performance.now();
        const initialize = Effect.gen(function* () {
          applicationLogger.info("Native Core authority ready", {
            ...dataAuthority.launch.timings,
            artifactValidationMs: Math.round(dataAuthority.launch.timings.artifactValidationMs),
            connectMs: Math.round(dataAuthority.launch.timings.connectMs),
            selectionMs: Math.round(dataAuthority.launch.timings.selectionMs),
            totalMs: Math.round(dataAuthority.launch.timings.totalMs),
          });
          let coreStreamInterruptionPublished = false;
          const delivery = coreDeliveryFrom({
            event: (event) =>
              projectionDelivery
                .deliverTail(event)
                .pipe(Effect.mapError((cause) => deliveryError("events.deliver", cause))),
            checkpoint: (checkpoint) =>
              projectionDelivery
                .observeCheckpoint(checkpoint)
                .pipe(Effect.mapError((cause) => deliveryError("events.checkpoint", cause))),
            resync: (boundary) =>
              projectionDelivery.resetStream("event_gap").pipe(
                Effect.andThen(
                  Effect.sync(() =>
                    coreApplicationProjection.publishResync({
                      commitSeq: boundary.commit_head,
                      libraryId: dataAuthority.identity.libraryId,
                      storeEpoch: dataAuthority.identity.storeEpoch,
                    }),
                  ),
                ),
              ),
          });
          const eventContext = yield* Layer.buildWithScope(
            coreEventHubLive({ initialAfter: dataAuthority.rootClient.handshake.commit_head }).pipe(
              Layer.provide(Layer.merge(Layer.succeed(CoreSessionAccess, access), delivery)),
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
          yield* Effect.tryPromise({
            try: () => codexService.synchronizeAutomationRuntime(),
            catch: (cause) => runtimeError("synchronize-automations", cause),
          });
          codexService.requestManagedWorktreeRetentionSweep();
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
          yield* initialization.markDone;
          applicationLogger.info("Desktop app initialization finished", {
            durationMs: Math.round(performance.now() - initializationStartedAt),
          });
          yield* appUpdates.markApplicationReady;
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
          codexIpcLive({
            codexService,
            projectWorkspace,
            rendererClientRouter: rendererClients,
            terminalRuntime: {
              runAction: (input) =>
                callbacks.runPromise(
                  terminals.runAction(
                    {
                      webContentsId: input.webContentsId,
                      windowSessionId: input.windowSessionId,
                    },
                    input.request,
                  ),
                ),
            },
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        applicationWindows.openStartup(getWindowRestoreSettings().policy);
        yield* Fiber.join(initializationFiber);

        controller = {
          activate: Effect.sync(applicationWindows.focusLast),
          prepareQuit: Effect.tryPromise({
            try: applicationWindows.prepareQuit,
            catch: (cause) => runtimeError("prepare-quit", cause),
          }).pipe(Effect.as("continue" as const)),
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
        };
        yield* Layer.buildWithScope(
          codexThreadNotificationRuntimeLive({
            events: codexApplicationEvents,
            getSettings: getThreadNotificationSettings,
            isAppForegrounded: () => codexService.hasForegroundRendererClient(),
            isConversationPresentedInForeground: (conversationId) =>
              codexService.isRendererConversationPresentedInForeground(conversationId),
            resolveTargetClientId: (conversationId) => {
              const presenting = codexService.resolveRendererPresentedSurfaceClient(conversationId);
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
      }),
    ).pipe(
      Effect.mapError((cause) =>
        Schema.is(MainRuntimeError)(cause) ? cause : runtimeError("startup", cause),
      ),
    );

    return MainRuntime.of({
      activate: requireController("activate").pipe(Effect.flatMap((runtime) => runtime.activate)),
      start,
      prepareQuit: requireController("prepare-quit").pipe(
        Effect.flatMap((runtime) =>
          isPrivacySettingsTerminationRequest?.() === true
            ? Effect.succeed("defer" as const)
            : runtime.prepareQuit,
        ),
      ),
      handleBootstrapEvent: (event) =>
        requireController("bootstrap-event").pipe(
          Effect.flatMap((runtime) => runtime.handleBootstrapEvent(event)),
        ),
    });
  }),
);

export const productionLive = live.pipe(Layer.provideMerge(TerminalRuntimeLive.live));
