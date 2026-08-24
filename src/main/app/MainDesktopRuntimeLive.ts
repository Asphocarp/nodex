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
import {
  CoreAuthority,
  CoreSessionAccess,
  live as coreAuthorityLive,
} from "../core-runtime/CoreAuthority";
import {
  CoreEventDelivery,
  CoreEventHub,
  live as coreEventHubLive,
} from "../core-runtime/CoreEventHub";
import { CoreModules, live as coreModulesLive } from "../core-runtime/CoreModules";
import {
  AutomationRoutingIndex,
  live as automationRoutingIndexLive,
} from "../core-runtime/AutomationRoutingIndex";
import {
  StoreAdministration,
  live as storeAdministrationLive,
} from "../core-runtime/StoreAdministration";
import { live as coreTransportLive } from "../core-runtime/CoreTransport";
import {
  DocumentLiveRuntime,
  live as documentLiveRuntimeLive,
} from "../core-runtime/DocumentLiveRuntime";
import {
  ProjectionDeliveryRuntime,
  live as projectionDeliveryRuntimeLive,
} from "../core-runtime/ProjectionDeliveryRuntime";
import {
  CoreApplicationProjectionRuntime,
  live as coreApplicationProjectionRuntimeLive,
} from "../core-runtime/CoreApplicationProjectionRuntime";
import { DesktopDocumentSessionRuntime, desktopDocumentSessionRuntimeLive } from "../core-client";
import {
  ProjectWorkspace,
  live as projectWorkspaceLive,
} from "../project-application/ProjectWorkspace";
import {
  AutomationApplication,
  live as automationApplicationLive,
} from "../automation-application/AutomationApplication";
import {
  AutomationExecution,
  live as automationExecutionLive,
} from "../automation-application/AutomationExecution";
import { DatabaseModule, live as databaseModuleLive } from "../database-application/DatabaseModule";
import { LibraryModule, live as libraryModuleLive } from "../library-application/LibraryModule";
import {
  NodexAgentApplication,
  live as nodexAgentApplicationLive,
} from "../nodex-agent-application/NodexAgentApplication";
import {
  NodexAgentDynamicTools,
  live as nodexAgentDynamicToolsLive,
} from "../nodex-agent-application/NodexAgentDynamicTools";
import {
  NodexAgentProtocolTools,
  live as nodexAgentProtocolToolsLive,
} from "../nodex-agent-application/NodexAgentProtocolTools";
import {
  NodexAgentResourceAccess,
  live as nodexAgentResourceAccessLive,
} from "../nodex-agent-application/NodexAgentResourceAccess";
import { resolveCodexRuntime } from "../codex/codex-runtime";
import { createElectronProviderCredentialStore } from "../platform/electron/ProviderCredentialStore";
import { CodexAccount, live as codexAccountLive } from "../codex-application/CodexAccount";
import {
  AgentProviderRuntime,
  live as agentProviderRuntimeLive,
} from "../codex-application/AgentProviderRuntime";
import {
  AgentImportRuntime,
  make as makeAgentImportRuntime,
} from "../codex-application/AgentImportRuntime";
import {
  NodexAgentAuthorizationRuntime,
  live as nodexAgentAuthorizationRuntimeLive,
} from "../codex-application/NodexAgentAuthorizationRuntime";
import { CodexConnection, live as codexConnectionLive } from "../codex-application/CodexConnection";
import { make as makeCodexConnectionLifecycle } from "../codex-application/CodexConnectionLifecycle";
import { CodexMedia, live as codexMediaLive } from "../codex-application/CodexMedia";
import { ChatGptDesktop, live as chatGptDesktopLive } from "../codex-application/ChatGptDesktop";
import {
  ComposerExternalSuggestions,
  live as composerExternalSuggestionsLive,
} from "../codex-application/ComposerExternalSuggestions";
import { ComposerCatalog, live as composerCatalogLive } from "../codex-application/ComposerCatalog";
import {
  ConversationCommands,
  live as conversationCommandsLive,
} from "../codex-application/ConversationCommands";
import {
  CodexConversationArchive,
  make as makeCodexConversationArchive,
} from "../codex-application/CodexConversationArchive";
import {
  CodexBackgroundProcesses,
  make as makeCodexBackgroundProcesses,
} from "../codex-application/CodexBackgroundProcesses";
import {
  CodexGitMessageGeneration,
  live as codexGitMessageGenerationLive,
} from "../codex-application/CodexGitMessageGeneration";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "../codex-application/ConversationRuntimeMap";
import {
  CodexPendingServerRequestRuntime,
  make as makeCodexPendingServerRequestRuntime,
} from "../codex-application/CodexPendingServerRequestRuntime";
import {
  CodexAppProtocolTools,
  make as makeCodexAppProtocolTools,
} from "../codex-application/CodexAppProtocolTools";
import {
  CodexServerRequestResponses,
  make as makeCodexServerRequestResponses,
} from "../codex-application/CodexServerRequestResponses";
import {
  CodexTurnCommands,
  make as makeCodexTurnCommands,
} from "../codex-application/CodexTurnCommands";
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
import {
  CodexActiveGoalContinuation,
  make as makeCodexActiveGoalContinuation,
} from "../codex-application/CodexActiveGoalContinuation";
import {
  CodexOwnerNotificationDrainRuntime,
  make as makeCodexOwnerNotificationDrainRuntime,
} from "../codex-application/CodexOwnerNotificationDrainRuntime";
import {
  CodexRendererConversationRegistry,
  make as makeCodexRendererConversationRegistry,
} from "../codex-application/CodexRendererConversationRegistry";
import {
  CodexRendererConversationCoordinator,
  make as makeCodexRendererConversationCoordinator,
} from "../codex-application/CodexRendererConversationCoordinator";
import {
  CodexRendererOwnerCommands,
  make as makeCodexRendererOwnerCommands,
} from "../codex-application/CodexRendererOwnerCommands";
import {
  CodexSidebarSyncRuntime,
  make as makeCodexSidebarSyncRuntime,
} from "../codex-application/CodexSidebarSyncRuntime";
import {
  CodexThreadCatalog,
  make as makeCodexThreadCatalog,
} from "../codex-application/CodexThreadCatalog";
import {
  CodexThreadReadState,
  make as makeCodexThreadReadState,
} from "../codex-application/CodexThreadReadState";
import { CodexGitProbe, make as makeCodexGitProbe } from "../codex-application/CodexGitProbe";
import {
  CodexExternalAgentImportRuntime,
  make as makeCodexExternalAgentImportRuntime,
} from "../codex-application/CodexExternalAgentImportRuntime";
import {
  CodexHeartbeatTurnCompletion,
  CodexHeartbeatTurnCompletionError,
  make as makeCodexHeartbeatTurnCompletion,
} from "../codex-application/CodexHeartbeatTurnCompletion";
import {
  CodexStructuredThreadTitle,
  CodexStructuredThreadTitleError,
  make as makeCodexStructuredThreadTitle,
} from "../codex-application/CodexStructuredThreadTitle";
import {
  CodexInternalThreadRegistry,
  make as makeCodexInternalThreadRegistry,
} from "../codex-application/CodexInternalThreadRegistry";
import {
  CodexNotificationAdmission,
  make as makeCodexNotificationAdmission,
} from "../codex-application/CodexNotificationAdmission";
import {
  CodexThreadHandoffRuntime,
  make as makeCodexThreadHandoffRuntime,
} from "../codex-application/CodexThreadHandoffRuntime";
import {
  CodexThreadExecution,
  live as codexThreadExecutionLive,
} from "../codex-application/CodexThreadExecution";
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
import {
  CodexConversationHistoryRuntime,
  make as makeCodexConversationHistoryRuntime,
} from "../codex-application/CodexConversationHistoryRuntime";
import {
  CodexConversationRelationships,
  make as makeCodexConversationRelationships,
} from "../codex-application/CodexConversationRelationships";
import {
  CodexSubagentCatalog,
  make as makeCodexSubagentCatalog,
} from "../codex-application/CodexSubagentCatalog";
import {
  CodexConversationContext,
  make as makeCodexConversationContext,
} from "../codex-application/CodexConversationContext";
import {
  CodexConversationProjection,
  make as makeCodexConversationProjection,
} from "../codex-application/CodexConversationProjection";
import {
  CodexThreadDirectory,
  make as makeCodexThreadDirectory,
} from "../codex-application/CodexThreadDirectory";
import {
  CodexConversationMaterialization,
  make as makeCodexConversationMaterialization,
} from "../codex-application/CodexConversationMaterialization";
import {
  CodexAutomationRunAcceptance,
  make as makeCodexAutomationRunAcceptance,
} from "../codex-application/CodexAutomationRunAcceptance";
import {
  CodexQueuedFollowUps,
  make as makeCodexQueuedFollowUps,
} from "../codex-application/CodexQueuedFollowUps";
import {
  CodexQueuedFollowUpDispatcher,
  make as makeCodexQueuedFollowUpDispatcher,
} from "../codex-application/CodexQueuedFollowUpDispatcher";
import {
  CodexTurnAuthority,
  make as makeCodexTurnAuthority,
} from "../codex-application/CodexTurnAuthority";
import {
  CodexTurnPreparation,
  make as makeCodexTurnPreparation,
} from "../codex-application/CodexTurnPreparation";
import {
  CodexConversationDeltaBufferRuntime,
  make as makeCodexConversationDeltaBufferRuntime,
} from "../codex-application/CodexConversationDeltaBufferRuntime";
import {
  CodexConversationResumeRuntime,
  make as makeCodexConversationResumeRuntime,
} from "../codex-application/CodexConversationResumeRuntime";
import {
  CodexFreshThreadLaunchRuntime,
  make as makeCodexFreshThreadLaunchRuntime,
} from "../codex-application/CodexFreshThreadLaunchRuntime";
import {
  CodexThreadLaunchCompletion,
  make as makeCodexThreadLaunchCompletion,
} from "../codex-application/CodexThreadLaunchCompletion";
import {
  CodexForkSidePanelTransfer,
  make as makeCodexForkSidePanelTransferRuntime,
} from "../codex-application/CodexForkSidePanelTransferRuntime";
import {
  CodexPostResumeGoalRuntime,
  make as makeCodexPostResumeGoalRuntime,
} from "../codex-application/CodexPostResumeGoalRuntime";
import {
  CodexThreadGoalRuntime,
  live as codexThreadGoalRuntimeLive,
} from "../codex-application/CodexThreadGoalRuntime";
import {
  CodexManualCompactionRuntime,
  live as codexManualCompactionRuntimeLive,
} from "../codex-application/CodexManualCompactionRuntime";
import {
  CodexThreadSettingsRuntime,
  make as makeCodexThreadSettingsRuntime,
} from "../codex-application/CodexThreadSettingsRuntime";
import {
  CodexThreadRollbackCommands,
  make as makeCodexThreadRollbackCommands,
} from "../codex-application/CodexThreadRollbackCommands";
import {
  CodexThreadTitlePersistence,
  make as makeCodexThreadTitlePersistence,
} from "../codex-application/CodexThreadTitlePersistence";
import {
  CodexRendererOwnerRetention,
  make as makeCodexRendererOwnerRetention,
} from "../codex-application/CodexRendererOwnerRetention";
import {
  CodexUserInputAutoResolution,
  make as makeCodexUserInputAutoResolution,
} from "../codex-application/CodexUserInputAutoResolution";
import {
  CodexApplicationEventHub,
  make as makeCodexApplicationEventHub,
} from "../codex-application/CodexApplicationEventHub";
import {
  CodexApplicationProtocol,
  make as makeCodexApplicationProtocol,
} from "../codex-application/CodexApplicationProtocol";
import { live as codexProtocolIngressLive } from "../codex-application/CodexProtocolIngress";
import {
  CodexThreadStartNotificationGate,
  make as makeCodexThreadStartNotificationGate,
} from "../codex-application/CodexThreadStartNotificationGate";
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
import {
  CodexPreferences,
  live as codexPreferencesLive,
} from "../codex-application/CodexPreferences";
import {
  CodexPermissions,
  live as codexPermissionsLive,
} from "../codex-application/CodexPermissions";
import {
  ExecutionHostRuntime,
  live as executionHostRuntimeLive,
  threadHostResolverLive,
} from "../codex-application/ExecutionHostRuntime";
import {
  ExecutionHostConfiguration,
  ManagedWorktreeConfiguration,
  live as executionHostConfigurationLive,
} from "../codex-application/ExecutionHostConfiguration";
import {
  ManagedWorktreeRuntime,
  live as managedWorktreeRuntimeLive,
} from "../codex-application/ManagedWorktreeRuntime";
import {
  ManagedWorktreeRetentionRuntime,
  live as managedWorktreeRetentionRuntimeLive,
} from "../codex-application/ManagedWorktreeRetentionRuntime";
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
import {
  CodexEphemeralThreadRouting,
  live as codexEphemeralThreadRoutingLive,
} from "../codex-runtime/CodexEphemeralThreadRouting";
import {
  CodexApplicationRequestInbox,
  make as makeCodexApplicationRequestInbox,
} from "../codex-runtime/CodexApplicationRequestInbox";
import * as CodexRuntimeLive from "../codex-runtime/CodexRuntimeLive";
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
import * as CodexWorkspaceIpc from "../ipc/handlers/CodexWorkspaceIpc";
import * as DictationIpc from "../ipc/handlers/DictationIpc";
import {
  ComputerUseRuntime,
  live as computerUseRuntimeLive,
} from "../host-runtime/ComputerUseRuntime";
import {
  DesktopToolRuntime,
  live as desktopToolRuntimeLive,
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
import { GitActions, live as gitActionsLive } from "../git-application/GitActions";
import {
  localLive as localWorktreeWorkerRuntimeLive,
  WorktreeWorkerRuntime,
} from "../host-runtime/WorktreeWorkerRuntime";
import {
  WorktreeEnvironmentRuntime,
  live as worktreeEnvironmentRuntimeLive,
} from "../host-runtime/WorktreeEnvironmentRuntime";
import {
  live as projectRuntimeLifecycleLive,
  ProjectRuntimeLifecycleRuntime,
} from "../host-runtime/ProjectRuntimeLifecycleRuntime";
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
import {
  BrowserApplication,
  live as browserApplicationLive,
} from "../browser-application/BrowserApplication";
import {
  BrowserUseRuntime,
  live as browserUseRuntimeLive,
} from "../host-runtime/BrowserUseRuntime";
import {
  BrowserProfileRuntime,
  live as browserProfileRuntimeLive,
} from "../host-runtime/BrowserProfileRuntime";
import {
  BrowserPresentationRuntime,
  live as browserPresentationRuntimeLive,
} from "../host-runtime/BrowserPresentationRuntime";
import {
  BrowserSiteStatusRuntime,
  live as browserSiteStatusRuntimeLive,
} from "../host-runtime/BrowserSiteStatusRuntime";
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
import { DictationRuntime, live as dictationRuntimeLive } from "../host-runtime/DictationRuntime";
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
  getCommandKeymapState,
  getHistorySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
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
import { ElectronPrivacy, live as electronPrivacyLive } from "../platform/electron/ElectronPrivacy";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import * as CodexSessionTransport from "../platform/node/CodexSessionTransport";
import { resolveCodexProcessEnvironment } from "../platform/node/CodexProcessEnvironment";
import * as TerminalProjectAdmission from "../terminal-runtime/TerminalProjectAdmission";
import * as TerminalRuntimeLive from "../terminal-runtime/TerminalRuntimeLive";
import * as WindowSessionCatalog from "../window-runtime/WindowSessionCatalog";
import { WindowRuntime, live as windowRuntimeLive } from "../window-runtime/WindowRuntime";
import { MainApplication, MainApplicationError } from "./MainApplication";
import { MainConfig } from "./MainConfig";
import { MainShutdown } from "./MainShutdown";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";
import { CODEX_INTEGRATION_CAPABILITIES } from "../../shared/codex-integration-capabilities";
import { APP_RENDERER_URL } from "../../shared/app-renderer-policy";
import {
  ApplicationWindowRuntime,
  live as applicationWindowRuntimeLive,
} from "../window-runtime/ApplicationWindowRuntime";
import { live as windowShutdownLive } from "../window-runtime/WindowShutdown";

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

    return yield* Effect.interruptible(
      Effect.gen(function* () {
        const runtimeStateHome = `${config.nodexHome}/agent`;
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
        const authorityFiber = yield* Layer.buildWithScope(authorityLayer, runtimeScope).pipe(
          Effect.mapError((cause) => runtimeError("core-authority", cause)),
          Effect.forkIn(runtimeScope, { startImmediately: true }),
        );
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
        const authorityContext = yield* Fiber.join(authorityFiber);
        const authority = Context.get(authorityContext, CoreAuthority);
        const access = Context.get(authorityContext, CoreSessionAccess);
        const coreModulesContext = yield* Layer.buildWithScope(
          coreModulesLive.pipe(Layer.provide(Layer.succeed(CoreSessionAccess, access))),
          runtimeScope,
        );
        const coreModules = Context.get(coreModulesContext, CoreModules);
        const projectWorkspaceContext = yield* Layer.buildWithScope(
          projectWorkspaceLive.pipe(Layer.provide(Layer.succeed(CoreModules, coreModules))),
          runtimeScope,
        );
        const projectWorkspace = Context.get(projectWorkspaceContext, ProjectWorkspace);
        const projectRuntimeLifecycleContext = yield* Layer.buildWithScope(
          projectRuntimeLifecycleLive,
          runtimeScope,
        );
        const projectRuntimeLifecycle = Context.get(
          projectRuntimeLifecycleContext,
          ProjectRuntimeLifecycleRuntime,
        );
        const ephemeralThreadRoutingContext = yield* Layer.buildWithScope(
          codexEphemeralThreadRoutingLive,
          runtimeScope,
        );
        const ephemeralThreadRouting = Context.get(
          ephemeralThreadRoutingContext,
          CodexEphemeralThreadRouting,
        );
        const threadHostResolverContext = yield* Layer.buildWithScope(
          threadHostResolverLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexEphemeralThreadRouting, ephemeralThreadRouting),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const threadHostResolver = Context.get(threadHostResolverContext, CodexThreadHostResolver);
        const applicationRequestInbox = yield* makeCodexApplicationRequestInbox.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationRuntimeContext = yield* Layer.buildWithScope(
          conversationRuntimeMapLive,
          runtimeScope,
        );
        const conversationRuntimes = Context.get(
          conversationRuntimeContext,
          ConversationRuntimeMap,
        );
        const pendingServerRequests = yield* makeCodexPendingServerRequestRuntime({
          respond: (_threadId, _requestId, occurrenceToken, response) =>
            applicationRequestInbox.settleOccurrenceToken(occurrenceToken, {
              kind: "result",
              value: response,
            }),
          reject: (_threadId, requestId, occurrenceToken, reason) =>
            applicationRequestInbox.settleOccurrenceToken(occurrenceToken, {
              kind: "error",
              error: CodexAppServerRequestError.internalError(
                "Codex application request failed",
                undefined,
                {
                  operation: "handle-request",
                  requestId: String(requestId),
                  cause: reason,
                },
              ),
            }),
        }).pipe(Effect.provideService(Scope.Scope, runtimeScope));
        const codexDependencies = Layer.mergeAll(
          CodexSessionTransport.nodeLive,
          Layer.succeed(CodexApplicationRequestInbox, applicationRequestInbox),
          Layer.succeed(CodexThreadHostResolver, threadHostResolver),
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
        const codexApplicationEvents = yield* makeCodexApplicationEventHub.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const ownerNotificationDrain = yield* makeCodexOwnerNotificationDrainRuntime().pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const rendererConversations = yield* makeCodexRendererConversationRegistry().pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadReadState = yield* makeCodexThreadReadState.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const userInputAutoResolution = yield* makeCodexUserInputAutoResolution.pipe(
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const rendererOwnerRetention = yield* makeCodexRendererOwnerRetention().pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const rendererConversationCoordinator =
          yield* makeCodexRendererConversationCoordinator.pipe(
            Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
            Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
            Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
            Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
            Effect.provideService(CodexRendererOwnerRetention, rendererOwnerRetention),
            Effect.provideService(CodexUserInputAutoResolution, userInputAutoResolution),
            Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
            Effect.provideService(Scope.Scope, runtimeScope),
          );
        const serverRequestResponses = yield* makeCodexServerRequestResponses.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerNotificationDrain),
          Effect.provideService(CodexPendingServerRequestRuntime, pendingServerRequests),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(CodexThreadReadState, threadReadState),
          Effect.provideService(CodexUserInputAutoResolution, userInputAutoResolution),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const electronNetContext = yield* Layer.buildWithScope(ElectronNet.live, runtimeScope);
        const electronNet = Context.get(electronNetContext, ElectronNet.ElectronNet);
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
        const browserSiteStatusContext = yield* Layer.buildWithScope(
          browserSiteStatusRuntimeLive.pipe(Layer.provide(Layer.succeed(ChatGptDesktop, chatGpt))),
          runtimeScope,
        );
        const browserSiteStatus = Context.get(browserSiteStatusContext, BrowserSiteStatusRuntime);
        const browserApplicationContext = yield* Layer.buildWithScope(
          browserApplicationLive(userDataPath).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(FileSystem.FileSystem, fileSystem),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
                Layer.succeed(BrowserSiteStatusRuntime, browserSiteStatus),
              ),
            ),
          ),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("browser-application", cause)));
        const browser = Context.get(browserApplicationContext, BrowserApplication);
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
            Layer.provide(
              Layer.merge(
                Layer.succeed(ElectronSessionHost, sessionHost),
                Layer.succeed(MainConfig, config),
              ),
            ),
          ),
          runtimeScope,
        );
        const mcpAppSandboxContext = yield* Layer.buildWithScope(
          mcpAppSandboxRuntimeLive({
            allowLocalDevelopment: !config.isPackaged,
            guestPreloadPath: `${__dirname}/../preload/mcp-app-sandbox-guest.js`,
            logger: getLogger({ subsystem: "mcp-app-sandbox" }),
            platform: config.platform as NodeJS.Platform,
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
        const electronPrivacyContext = yield* Layer.buildWithScope(
          electronPrivacyLive,
          runtimeScope,
        );
        const electronPrivacy = Context.get(electronPrivacyContext, ElectronPrivacy);
        const dictationContext = yield* Layer.buildWithScope(
          dictationRuntimeLive({
            preloadPath: `${__dirname}/../preload/global-dictation.js`,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronPrivacy, electronPrivacy),
                Layer.succeed(MainConfig, config),
                Layer.succeed(RendererClientRuntime, rendererClients),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
        const dictation = Context.get(dictationContext, DictationRuntime);
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
            browserSidebarEvents: browser.events,
            isThreadSurfacePresented: browser.projection.hasPresentedSurfaceForThread,
            platform: config.platform as NodeJS.Platform,
            preferenceFilePath: `${userDataPath}/remote-hosted-pip-preferences.json`,
          }).pipe(Layer.provide(Layer.succeed(CodexGateway, codexGateway))),
          runtimeScope,
        );
        const remoteHostedPip = Context.get(remoteHostedPipContext, RemoteHostedPipRuntime);
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
        const browserProfileContext = yield* Layer.buildWithScope(
          browserProfileRuntimeLive({
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
                Layer.succeed(BrowserProfileHelperPlatform, browserProfileHelper),
                Layer.succeed(BrowserApplication, browser),
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
        const browserUseContext = yield* Layer.buildWithScope(
          browserUseRuntimeLive({
            appVersion: config.appVersion,
            browserRuntime: codexRuntime.browserRuntime,
            environment: config.environment,
            isPackaged: config.isPackaged,
            platform: config.platform as NodeJS.Platform,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserApplication, browser),
                Layer.succeed(BrowserProfileRuntime, browserProfile),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
              ),
            ),
          ),
          runtimeScope,
        ).pipe(Effect.mapError((cause) => runtimeError("browser-use-runtime", cause)));
        const browserUse = Context.get(browserUseContext, BrowserUseRuntime);
        const desktopToolContext = yield* Layer.buildWithScope(
          desktopToolRuntimeLive({
            browserRuntime: codexRuntime.browserRuntime,
            runtimeStateHome,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserUseRuntime, browserUse),
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ComputerUseRuntime, computerUse),
              ),
            ),
          ),
          runtimeScope,
        );
        const desktopToolRuntime = Context.get(desktopToolContext, DesktopToolRuntime);
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
        const localWorktreeWorker = Context.get(localWorktreeWorkerContext, WorktreeWorkerRuntime);
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
        const codexGitMessageGenerationContext = yield* Layer.buildWithScope(
          codexGitMessageGenerationLive.pipe(
            Layer.provide(Layer.succeed(CodexGateway, codexGateway)),
          ),
          runtimeScope,
        );
        const codexGitMessageGeneration = Context.get(
          codexGitMessageGenerationContext,
          CodexGitMessageGeneration,
        );
        const gitActionsContext = yield* Layer.buildWithScope(
          gitActionsLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexGitMessageGeneration, codexGitMessageGeneration),
                Layer.succeed(GitActionOperationRuntime, gitActionOperations),
                Layer.succeed(GitWorkerRuntime, gitWorker),
              ),
            ),
          ),
          runtimeScope,
        );
        const gitActions = Context.get(gitActionsContext, GitActions);
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
        const browserPresentationContext = yield* Layer.buildWithScope(
          browserPresentationRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserProfileRuntime, browserProfile),
                Layer.succeed(BrowserApplication, browser),
                Layer.succeed(BrowserSiteStatusRuntime, browserSiteStatus),
                Layer.succeed(BrowserUseRuntime, browserUse),
              ),
            ),
          ),
          runtimeScope,
        );
        const browserPresentation = Context.get(
          browserPresentationContext,
          BrowserPresentationRuntime,
        );
        const codexMediaContext = yield* Layer.buildWithScope(
          codexMediaLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ChatGptDesktop, chatGpt),
                Layer.succeed(CodexAccount, codexAccountService),
                Layer.succeed(CodexApplicationEventHub, codexApplicationEvents),
                Layer.succeed(CodexConnection, codexConnectionService),
                Layer.succeed(DictationRuntime, dictation),
                Layer.succeed(ElectronNet.ElectronNet, electronNet),
              ),
            ),
          ),
          runtimeScope,
        );
        const codexMedia = Context.get(codexMediaContext, CodexMedia);
        yield* Layer.buildWithScope(
          DictationIpc.live().pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexMedia, codexMedia),
                Layer.succeed(DictationRuntime, dictation),
                Layer.succeed(ElectronDesktop, desktop),
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
                Layer.succeed(WindowRuntime, windows),
              ),
            ),
          ),
          runtimeScope,
        );
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
            browser: browser.guest,
            rendererConversations: rendererConversationCoordinator,
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
              Layer.mergeAll(
                Layer.succeed(ComposerAppshotRuntime, composerAppshots),
                Layer.succeed(ScopedCallbackRuntime, callbacks),
                windowShutdownLive(),
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
        const windowSessions = WindowSessionCatalog.WindowSessionCatalog.of({
          resolveForWebContents: (webContentsId) =>
            Effect.sync(() => windows.resolveSessionId(webContentsId)),
        });
        yield* Layer.buildWithScope(
          BrowserProfileIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(BrowserProfileRuntime, browserProfile),
                Layer.succeed(BrowserApplication, browser),
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
                Layer.succeed(BrowserApplication, browser),
                Layer.succeed(BrowserPresentationRuntime, browserPresentation),
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
        const automationRoutingContext = yield* Layer.buildWithScope(
          automationRoutingIndexLive.pipe(Layer.provide(Layer.succeed(CoreModules, coreModules))),
          runtimeScope,
        );
        const automationRouting = Context.get(automationRoutingContext, AutomationRoutingIndex);
        const automationApplicationContext = yield* Layer.buildWithScope(
          automationApplicationLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(AutomationRoutingIndex, automationRouting),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const automationApplication = Context.get(
          automationApplicationContext,
          AutomationApplication,
        );
        const applicationDataModulesContext = yield* Layer.buildWithScope(
          Layer.merge(libraryModuleLive, databaseModuleLive).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreSessionAccess, access),
              ),
            ),
          ),
          runtimeScope,
        );
        const libraryModule = Context.get(applicationDataModulesContext, LibraryModule);
        const databaseModule = Context.get(applicationDataModulesContext, DatabaseModule);
        const deepLinkContext = yield* Layer.buildWithScope(
          deepLinkRuntimeLive({
            focusWindow: applicationWindows.focusLast,
            windows,
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(LibraryModule, libraryModule),
                Layer.succeed(ProjectWorkspace, projectWorkspace),
              ),
            ),
          ),
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
        yield* deepLinks.extractFromArgv(config.argv);
        applicationWindows.openStartup(getWindowRestoreSettings().policy);
        const nodexAgentApplicationContext = yield* Layer.buildWithScope(
          nodexAgentApplicationLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(CoreSessionAccess, access),
                Layer.succeed(DatabaseModule, databaseModule),
              ),
            ),
          ),
          runtimeScope,
        );
        const nodexAgentApplication = Context.get(
          nodexAgentApplicationContext,
          NodexAgentApplication,
        );
        const nodexAgentDynamicToolsContext = yield* Layer.buildWithScope(
          nodexAgentDynamicToolsLive.pipe(
            Layer.provide(Layer.succeed(NodexAgentApplication, nodexAgentApplication)),
          ),
          runtimeScope,
        );
        const nodexAgentDynamicTools = Context.get(
          nodexAgentDynamicToolsContext,
          NodexAgentDynamicTools,
        );
        const storeAdministrationContext = yield* Layer.buildWithScope(
          storeAdministrationLive.pipe(Layer.provide(Layer.succeed(CoreModules, coreModules))),
          runtimeScope,
        );
        const storeAdministration = Context.get(storeAdministrationContext, StoreAdministration);
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
        const canvasPresenceContext = yield* Layer.buildWithScope(
          canvasPresenceRuntimeLive(),
          runtimeScope,
        );
        const canvasPresence = Context.get(canvasPresenceContext, CanvasPresenceRuntime);
        const documentLiveContext = yield* Layer.buildWithScope(
          documentLiveRuntimeLive,
          runtimeScope,
        );
        const documentLive = Context.get(documentLiveContext, DocumentLiveRuntime);
        const documentSessionContext = yield* Layer.buildWithScope(
          desktopDocumentSessionRuntimeLive({
            canvasPresenceHub: canvasPresence.hub,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(CoreSessionAccess, access),
                Layer.succeed(DocumentLiveRuntime, documentLive),
              ),
            ),
          ),
          runtimeScope,
        );
        const documentSync = Context.get(documentSessionContext, DesktopDocumentSessionRuntime);
        const executionHostConfigurationContext = yield* Layer.buildWithScope(
          executionHostConfigurationLive,
          runtimeScope,
        );
        const executionHostConfiguration = Context.get(
          executionHostConfigurationContext,
          ExecutionHostConfiguration,
        );
        const managedWorktreeConfiguration = Context.get(
          executionHostConfigurationContext,
          ManagedWorktreeConfiguration,
        );
        const executionHostContext = yield* Layer.buildWithScope(
          executionHostRuntimeLive({
            runtimeStateHome,
            nodexHome: config.nodexHome,
            remoteWorktreeWorkerBundlePath: `${__dirname}/remote-worktree-worker.cjs`,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(ExecutionHostConfiguration, executionHostConfiguration),
                Layer.succeed(ManagedWorktreeConfiguration, managedWorktreeConfiguration),
                Layer.succeed(WorktreeWorkerRuntime, localWorktreeWorker),
              ),
            ),
          ),
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
        const nodexAgentResourceAccessContext = yield* Layer.buildWithScope(
          nodexAgentResourceAccessLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreModules, coreModules),
              ),
            ),
          ),
          runtimeScope,
        );
        const nodexAgentResourceAccess = Context.get(
          nodexAgentResourceAccessContext,
          NodexAgentResourceAccess,
        );
        const nodexAgentAuthorizationContext = yield* Layer.buildWithScope(
          nodexAgentAuthorizationRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(NodexAgentResourceAccess, nodexAgentResourceAccess),
                Layer.succeed(RendererClientRuntime, rendererClients),
              ),
            ),
          ),
          runtimeScope,
        );
        const nodexAgentAuthorization = Context.get(
          nodexAgentAuthorizationContext,
          NodexAgentAuthorizationRuntime,
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
        const conversationContext = yield* makeCodexConversationContext.pipe(
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
        );
        const conversationProjection = yield* makeCodexConversationProjection.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
        );
        const threadDirectory = yield* makeCodexThreadDirectory.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationRelationships = yield* makeCodexConversationRelationships.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const internalThreadRegistry = yield* makeCodexInternalThreadRegistry.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadStartNotifications = yield* makeCodexThreadStartNotificationGate.pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const sidebarSync = yield* makeCodexSidebarSyncRuntime({
          foldPathCase: config.platform === "win32",
        }).pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexInternalThreadRegistry, internalThreadRegistry),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(
            DatabaseNotifierRuntime.DatabaseNotifierRuntime,
            databaseNotifications,
          ),
          Effect.provideService(ExecutionHostRuntime, executionHosts),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const gitProbe = makeCodexGitProbe({ environment: config.environment });
        const externalAgentImport = yield* makeCodexExternalAgentImportRuntime().pipe(
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const heartbeatTurnCompletion = yield* makeCodexHeartbeatTurnCompletion({
          events: codexGateway.events,
          resolveHost: (threadId) =>
            threadHostResolver.resolve(threadId).pipe(
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
        }).pipe(
          Effect.provideService(CodexInternalThreadRegistry, internalThreadRegistry),
          Effect.provideService(CodexThreadStartNotificationGate, threadStartNotifications),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadSettingsRuntime = yield* makeCodexThreadSettingsRuntime.pipe(
          Effect.provideService(AgentProviderRuntime, agentProviders),
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadGoalContext = yield* Layer.buildWithScope(
          codexThreadGoalRuntimeLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexConversationProjection, conversationProjection),
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CodexThreadSettingsRuntime, threadSettingsRuntime),
              ),
            ),
          ),
          runtimeScope,
        );
        const threadGoals = Context.get(threadGoalContext, CodexThreadGoalRuntime);
        const threadTitlePersistence = yield* makeCodexThreadTitlePersistence.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexSidebarSyncRuntime, sidebarSync),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationHistory = yield* makeCodexConversationHistoryRuntime.pipe(
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const subagentCatalog = yield* makeCodexSubagentCatalog.pipe(
          Effect.provideService(CodexConversationRelationships, conversationRelationships),
          Effect.provideService(CodexThreadDirectory, threadDirectory),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationMaterialization = yield* makeCodexConversationMaterialization.pipe(
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
        );
        const automationRunAcceptance = yield* makeCodexAutomationRunAcceptance.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CoreModules, coreModules),
        );
        const turnAuthority = yield* makeCodexTurnAuthority.pipe(
          Effect.provideService(CodexConversationContext, conversationContext),
          Effect.provideService(CoreAuthority, authority),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const notificationAdmission = yield* makeCodexNotificationAdmission.pipe(
          Effect.provideService(CodexInternalThreadRegistry, internalThreadRegistry),
          Effect.provideService(CodexSubagentCatalog, subagentCatalog),
          Effect.provideService(CodexTurnAuthority, turnAuthority),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const turnPreparation = yield* makeCodexTurnPreparation.pipe(
          Effect.provideService(AgentProviderRuntime, agentProviders),
          Effect.provideService(CodexAttachments, attachments),
          Effect.provideService(CodexConversationContext, conversationContext),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexPermissions, codexPermissions),
          Effect.provideService(CodexPreferences, preferences),
          Effect.provideService(CodexThreadSettingsRuntime, threadSettingsRuntime),
          Effect.provideService(ComposerCatalog, composerCatalogService),
        );
        const queuedFollowUps = yield* makeCodexQueuedFollowUps.pipe(
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const turnCommands = yield* makeCodexTurnCommands.pipe(
          Effect.provideService(CodexAutomationRunAcceptance, automationRunAcceptance),
          Effect.provideService(CodexConversationMaterialization, conversationMaterialization),
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(CodexQueuedFollowUps, queuedFollowUps),
          Effect.provideService(CodexTurnAuthority, turnAuthority),
          Effect.provideService(CodexTurnPreparation, turnPreparation),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CoreModules, coreModules),
          Effect.provideService(ProjectRuntimeLifecycleRuntime, projectRuntimeLifecycle),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const activeGoalContinuation = yield* makeCodexActiveGoalContinuation.pipe(
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(CodexThreadSettingsRuntime, threadSettingsRuntime),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadLaunchCompletion = yield* makeCodexThreadLaunchCompletion.pipe(
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexAttachments, attachments),
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(CoreModules, coreModules),
        );
        const freshThreadLaunch = yield* makeCodexFreshThreadLaunchRuntime.pipe(
          Effect.provideService(
            CodexRendererConversationCoordinator,
            rendererConversationCoordinator,
          ),
          Effect.provideService(CodexThreadLaunchCompletion, threadLaunchCompletion),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const queuedFollowUpDispatcher = yield* makeCodexQueuedFollowUpDispatcher.pipe(
          Effect.provideService(CodexConversationProjection, conversationProjection),
          Effect.provideService(CodexQueuedFollowUps, queuedFollowUps),
          Effect.provideService(CodexTurnCommands, turnCommands),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const conversationArchive = yield* makeCodexConversationArchive.pipe(
          Effect.provideService(AutomationApplication, automationApplication),
          Effect.provideService(AutomationRoutingIndex, automationRouting),
          Effect.provideService(CodexApplicationEventHub, codexApplicationEvents),
          Effect.provideService(CodexGateway, codexGateway),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(ManagedWorktreeRuntime, managedWorktrees),
          Effect.provideService(NodexAgentAuthorizationRuntime, nodexAgentAuthorization),
          Effect.provideService(ProjectWorkspace, projectWorkspace),
        );
        const conversationCommandsContext = yield* Layer.buildWithScope(
          conversationCommandsLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexConversationArchive, conversationArchive),
                Layer.succeed(CodexConversationProjection, conversationProjection),
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CodexQueuedFollowUps, queuedFollowUps),
                Layer.succeed(CodexServerRequestResponses, serverRequestResponses),
                Layer.succeed(CodexThreadGoalRuntime, threadGoals),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
              ),
            ),
          ),
          runtimeScope,
        );
        const conversationCommands = Context.get(conversationCommandsContext, ConversationCommands);
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
        const conversationDeltaBuffer = yield* makeCodexConversationDeltaBufferRuntime().pipe(
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const postResumeGoals = yield* makeCodexPostResumeGoalRuntime.pipe(
          Effect.provideService(CodexActiveGoalContinuation, activeGoalContinuation),
          Effect.provideService(CodexConversationHistoryRuntime, conversationHistory),
          Effect.provideService(CodexThreadGoalRuntime, threadGoals),
          Effect.provideService(ConversationRuntimeMap, conversationRuntimes),
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        const threadExecutionContext = yield* Layer.buildWithScope(
          codexThreadExecutionLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(CodexConversationProjection, conversationProjection),
                Layer.succeed(CodexGateway, codexGateway),
                Layer.succeed(CodexTurnCommands, turnCommands),
                Layer.succeed(ConversationCommands, conversationCommands),
                Layer.succeed(ConversationRuntimeMap, conversationRuntimes),
                Layer.succeed(CoreModules, coreModules),
                Layer.succeed(DesktopToolRuntime, desktopToolRuntime),
                Layer.succeed(ExecutionHostRuntime, executionHosts),
              ),
            ),
          ),
          runtimeScope,
        );
        const threadExecution = Context.get(threadExecutionContext, CodexThreadExecution);
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
