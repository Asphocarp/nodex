import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { performance } from "node:perf_hooks";
import { NodexAgentAuthorizationBroker } from "../agent-tools/authorization-broker";
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
import { configureNodexAgentV3DynamicService } from "../codex/nodex-agent-dynamic-tool-runtime";
import { createElectronProviderCredentialStore } from "../codex/electron-provider-credential-store";
import { CodexAccount, live as codexAccountLive } from "../codex-application/CodexAccount";
import {
  AgentProviderRuntime,
  live as agentProviderRuntimeLive,
} from "../codex-application/AgentProviderRuntime";
import { makeAgentProviderRuntimePromiseAdapter } from "../codex-application/AgentProviderRuntimePromiseAdapter";
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
import { makeServerRequestResponsesPromiseAdapter } from "../codex-application/ServerRequestResponsesPromiseAdapter";
import { requestHandlingLive } from "../codex-application/CodexApplicationLayers";
import {
  CodexPreferences,
  live as codexPreferencesLive,
} from "../codex-application/CodexPreferences";
import {
  CodexAttachments,
  live as codexAttachmentsLive,
} from "../codex-application/CodexAttachments";
import { getThreadGoalAttachmentsRoot } from "../thread-goal-attachments";
import {
  CodexToolRuntime,
  live as codexToolRuntimeLive,
} from "../codex-application/CodexToolRuntime";
import { CodexEndpointMap } from "../codex-runtime/CodexEndpointMap";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexGatewayBridge } from "../codex-runtime/CodexGatewayBridge";
import { CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import * as CodexRuntimeLive from "../codex-runtime/CodexRuntimeLive";
import { CodexServerRequestRuntime } from "../codex-runtime/CodexServerRequestRuntime";
import * as AppUpdateIpc from "../ipc/handlers/AppUpdateIpc";
import * as ApplicationLifecycleIpc from "../ipc/handlers/ApplicationLifecycleIpc";
import * as ApplicationSettingsIpc from "../ipc/handlers/ApplicationSettingsIpc";
import * as ApplicationSyncIpc from "../ipc/handlers/ApplicationSyncIpc";
import * as ApplicationWindowIpc from "../ipc/handlers/ApplicationWindowIpc";
import * as CodexApplicationIpc from "../ipc/handlers/CodexApplicationIpc";
import * as BrowserProfileIpc from "../ipc/handlers/BrowserProfileIpc";
import * as BrowserSidebarIpc from "../ipc/handlers/BrowserSidebarIpc";
import * as ComputerUseSettingsIpc from "../ipc/handlers/ComputerUseSettingsIpc";
import * as CoreAuthorityIpc from "../ipc/handlers/CoreAuthorityIpc";
import * as CoreDocumentIpc from "../ipc/handlers/CoreDocumentIpc";
import * as GitWorkerIpc from "../ipc/handlers/GitWorkerIpc";
import * as ProjectionDeliveryIpc from "../ipc/handlers/ProjectionDeliveryIpc";
import * as PageSearchIpc from "../ipc/handlers/PageSearchIpc";
import * as RemoteHostedPipIpc from "../ipc/handlers/RemoteHostedPipIpc";
import * as TerminalIpc from "../ipc/handlers/TerminalIpc";
import * as WorkspaceFileIpc from "../ipc/handlers/WorkspaceFileIpc";
import { registerIpcHandlers } from "../ipc-handlers";
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
  HostWorkerRuntime,
  live as hostWorkerRuntimeLive,
} from "../host-runtime/HostWorkerRuntime";
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
import * as DatabaseNotifierRuntime from "../host-runtime/DatabaseNotifierRuntime";
import { live as codexThreadNotificationRuntimeLive } from "../host-runtime/CodexThreadNotificationRuntime";
import { live as codexRendererProjectionRuntimeLive } from "../host-runtime/CodexRendererProjectionRuntime";
import {
  ApplicationSchedulerRuntime,
  live as applicationSchedulerRuntimeLive,
} from "../host-runtime/ApplicationSchedulerRuntime";
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
import { InitialProjectBootstrapService } from "../initial-project-bootstrap-service";
import { resolveInitialProjectProjectsDirectory } from "../initial-project/initial-project-filesystem";
import { resolveInitialProjectJournalPath } from "../initial-project/initial-project-journal-store";
import {
  getBackupSettings,
  getCommandKeymapState,
  getHistorySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
} from "../local-store/config";
import { requestsExplicitNewWindow } from "../main-runtime-startup-events";
import { getLogger } from "../logging/logger";
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
        const codexBridge = new CodexGatewayBridge(callbacks);
        const applicationServerRequests = CodexGlobalServerRequestRuntime.of(
          codexBridge.applicationServerRequests(),
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
        const codexDependencies = Layer.mergeAll(
          CodexSessionTransport.nodeLive,
          Layer.succeed(CodexServerRequestRuntime, serverRequests),
          Layer.succeed(
            CodexThreadHostResolver,
            CodexThreadHostResolver.of({
              resolve: (threadId) => codexBridge.resolveThreadHost(threadId),
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
        const codexEndpoints = Context.get(codexContext, CodexEndpointMap);
        const browserSidebarContext = yield* Layer.buildWithScope(
          browserSidebarRuntimeLive(userDataPath),
          runtimeScope,
        );
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
          rendererClientRuntimeLive,
          runtimeScope,
        );
        const rendererClients = Context.get(rendererClientContext, RendererClientRuntime);
        const windowRuntimeContext = yield* Layer.buildWithScope(
          windowRuntimeLive(userDataPath),
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
            browserSidebarService,
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
            runtimeConfig: () => ({ locale }),
            runtimeStateHome,
          }),
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
            browserSidebar: browserSidebarService,
            environment: process.env,
            isPackaged: config.isPackaged,
            platform: config.platform as NodeJS.Platform,
          }).pipe(Layer.provide(Layer.succeed(DesktopToolRuntime, desktopToolRuntime))),
          runtimeScope,
        );
        const browserUse = Context.get(browserUseContext, BrowserUseRuntime);
        const computerUseSettingsContext = yield* Layer.buildWithScope(
          computerUseSettingsRuntimeLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(
                  DesktopToolRuntime,
                  Context.get(desktopToolContext, DesktopToolRuntime),
                ),
                Layer.succeed(
                  RemoteHostedPipRuntime,
                  Context.get(remoteHostedPipContext, RemoteHostedPipRuntime),
                ),
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
        const hostWorkerContext = yield* Layer.buildWithScope(
          hostWorkerRuntimeLive({
            gitWorkerPath: `${__dirname}/git-worker.js`,
            worktreeWorkerPath: `${__dirname}/worktree-worker.js`,
          }),
          runtimeScope,
        );
        const hostWorkers = Context.get(hostWorkerContext, HostWorkerRuntime);
        yield* Layer.buildWithScope(
          GitWorkerIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ElectronIpc, ipc),
                Layer.succeed(MainConfig, config),
                Layer.succeed(HostWorkerRuntime, hostWorkers),
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
        const browserProfileContext = yield* Layer.buildWithScope(
          browserProfileRuntimeLive({
            browserSidebar: browserSidebarService,
            isPackaged: config.isPackaged,
            nodexHome: config.nodexHome,
            projectRootPath: config.projectRootPath,
            resourcesPath: config.resourcesPath,
            userDataPath,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ChatGptDesktop, chatGpt),
                Layer.succeed(ElectronApp, electron),
                Layer.succeed(ElectronDesktop, desktop),
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
          policyStore: browserProfile.services.usePolicyStore,
          releaseCredentialOwner: (ownerWebContentsId) =>
            browserProfile.services.credentialService.releaseOwner(ownerWebContentsId),
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
        codexBridge.attach(codexGateway, codexEndpoints);
        yield* codexBridge.events.pipe(
          Stream.runForEach((event) => Effect.sync(() => codexBridge.observe(event))),
          Effect.forkIn(runtimeScope),
        );

        const codexService = yield* Effect.try({
          try: () => {
            return new CodexService({
              browserTransferRuntime: browserSidebarService,
              agentProviderRuntime,
              composerCatalog,
              desktopTools,
              preferences,
              attachments: attachments.legacy,
              serverRequestResponses: makeServerRequestResponsesPromiseAdapter(
                approvalCoordinator,
                callbacks,
              ),
              client: codexBridge,
              runtime: codexRuntime,
              runtimeStateHome,
              worktreeWorkerPort: hostWorkers.worktree,
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
        yield* Scope.addFinalizer(
          runtimeScope,
          Effect.tryPromise({
            try: () => codexService.shutdown(),
            catch: (cause) => runtimeError("shutdown-codex-application", cause),
          }).pipe(
            Effect.timeout("15 seconds"),
            Effect.catch((error) =>
              Effect.logWarning("Could not fully close the Codex application runtime").pipe(
                Effect.annotateLogs({ error: String(error) }),
              ),
            ),
          ),
        );
        yield* Layer.buildWithScope(
          codexRendererProjectionRuntimeLive({
            codex: codexService,
            rendererClients: rendererClients.router,
            windows,
          }),
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
        yield* terminals.events.pipe(
          Stream.runForEach((event) =>
            event.channel === "terminal-data"
              ? Effect.sync(() =>
                  browserSidebarService.observePtyData(event.payload.sessionId, event.payload.data),
                )
              : Effect.void,
          ),
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
                Layer.succeed(ScopedCallbackRuntime, callbacks),
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
        const documentSync = createDesktopDocumentSyncBridge({ authority: legacyDataAuthority });
        const libraryModule = createDesktopLibraryModuleBridge({ authority: legacyDataAuthority });
        const databaseModule = createDesktopDatabaseModuleBridge({
          authority: legacyDataAuthority,
        });
        const projectWorkspace = createDesktopProjectWorkspaceBridge({
          authority: legacyDataAuthority,
        });
        const initialProjectBootstrap = new InitialProjectBootstrapService({
          projectWorkspace,
          projectsDirectory: resolveInitialProjectProjectsDirectory({
            configuredDirectory: config.initialProjectsDirectory ?? undefined,
            documentsDirectory: config.documentsPath,
          }),
          journalPath: resolveInitialProjectJournalPath(config.nodexHome),
        });
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
        const applicationWindowContext = yield* Layer.buildWithScope(
          applicationWindowRuntimeLive({
            appUpdates,
            browserSidebar: browserSidebarService,
            codex: codexService,
            desktopNotifications: desktopNotifications.manager,
            iconPath: config.isPackaged
              ? `${config.resourcesPath}/icon.png`
              : `${config.projectRootPath}/resources/icon.png`,
            mcpAppSandbox,
            preloadPath: `${__dirname}/../preload/index.js`,
            rendererClients: rendererClients.router,
            rendererUrl: config.rendererUrl ?? APP_RENDERER_URL,
            windows,
          }).pipe(Layer.provide(Layer.succeed(ScopedCallbackRuntime, callbacks))),
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
        const applicationSchedulerContext = yield* Layer.buildWithScope(
          applicationSchedulerRuntimeLive({
            automation: automationModule,
            storeAdministration,
            readBackupSettings: getBackupSettings,
            readBlockRetentionCount: () => getHistorySettings().retentionCount,
            runScheduledAutomation: (automation, context) =>
              codexService.runScheduledAutomation(automation, context),
            notifyAutomationRunsUpdated: () => {
              codexService.notifyAutomationRunsUpdated({
                automationId: null,
                threadId: null,
                reason: "settle",
              });
            },
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(ElectronDesktop, desktop),
              ),
            ),
          ),
          runtimeScope,
        );
        const applicationSchedulers = Context.get(
          applicationSchedulerContext,
          ApplicationSchedulerRuntime,
        );
        yield* Layer.buildWithScope(
          ApplicationSettingsIpc.live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ApplicationMenuRuntime, applicationMenus),
                Layer.succeed(ApplicationSchedulerRuntime, applicationSchedulers),
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
            Layer.provide(Layer.succeed(CoreModules, coreModules)),
          ),
          Layer.succeed(WindowSessionCatalog.WindowSessionCatalog, windowSessions),
        );
        yield* Layer.buildWithScope(
          TerminalIpc.live.pipe(Layer.provide(terminalDependencies)),
          runtimeScope,
        );

        yield* deepLinks.extractFromArgv(config.argv);
        const dataAuthorityPromise = Promise.resolve(dataAuthority);
        const nodexAgentResourceAuthority = createDesktopNodexAgentResourceAuthorityPort({
          authority: dataAuthorityPromise,
        });
        codexService.setNodexAgentAuthorityPort(
          createDesktopNodexAgentAuthorityPort({ authority: dataAuthorityPromise }),
        );
        codexService.setNodexAgentResourceAuthorityPort(nodexAgentResourceAuthority);
        codexService.setAutomationModule(automationModule);
        codexService.setProjectWorkspacePort(projectWorkspace);
        browserSidebarService.setProjectSessionResolver((sessionId) =>
          projectWorkspace
            .getProjectSession(sessionId)
            .then((session) => session?.projectId ?? null),
        );
        configureNodexAgentV3DynamicService(
          createDesktopNodexAgentV3DynamicService({
            authority: dataAuthorityPromise,
            projectWorkspace,
            databaseModule,
            documentSync,
          }),
        );
        codexService.setNodexAgentAuthorizationBroker(
          new NodexAgentAuthorizationBroker({
            rendererClientRouter: rendererClients.router,
            readStoreEpoch: () => dataAuthority.identity.storeEpoch,
            persistProjectGrants: (input) =>
              nodexAgentResourceAuthority.persistProjectGrants(input),
          }),
        );

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
              Effect.sync(() => projectionDelivery.observeCheckpoint(checkpoint)),
            resync: (boundary) =>
              Effect.sync(() => {
                projectionDelivery.resetStream("event_gap");
                coreApplicationProjection.publishResync({
                  commitSeq: boundary.commit_head,
                  libraryId: dataAuthority.identity.libraryId,
                  storeEpoch: dataAuthority.identity.storeEpoch,
                });
              }),
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
                return Effect.sync(() => {
                  projectionDelivery.resetStream("reconnect");
                  applicationLogger.warn("Native Core event stream interrupted; reconnecting", {
                    error: connection.error,
                  });
                });
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
          yield* Effect.tryPromise({
            try: () =>
              initialProjectBootstrap.ensureInitialProject({
                onProvisioned: (presentation) => {
                  applicationWindows.seedInitialProjectPresentation(presentation);
                  return Promise.resolve();
                },
              }),
            catch: (cause) => runtimeError("initial-project-bootstrap", cause),
          });
          yield* deepLinks.markReady;
          yield* Effect.tryPromise({
            try: () => codexService.synchronizeAutomationRuntime(),
            catch: (cause) => runtimeError("synchronize-automations", cause),
          });
          codexService.requestManagedWorktreeRetentionSweep();
          applicationSchedulers.activate({ openReminder: applicationWindows.sendReminderOpen });
          yield* initialization.markDone;
          applicationLogger.info("Desktop app initialization finished", {
            durationMs: Math.round(performance.now() - initializationStartedAt),
          });
          yield* appUpdates.markApplicationReady;
        });
        const initializationFiber = yield* initialize.pipe(Effect.forkIn(runtimeScope));

        yield* Effect.tryPromise({
          try: () => codexService.reconcileCodexExecutionHosts(),
          catch: (cause) => runtimeError("reconcile-execution-hosts", cause),
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              applicationLogger.warn("Some configured SSH execution hosts are unavailable", {
                error,
              }),
            ),
          ),
        );
        yield* Effect.try({
          try: () =>
            registerIpcHandlers({
              automationModule,
              browserSidebarService,
              codexService,
              gitWorkerHost: hostWorkers.git,
              storeAdministration,
              onStoreRestored: () => {
                callbacks.fork(
                  Effect.sleep("250 millis").pipe(
                    Effect.andThen(electron.relaunch),
                    Effect.andThen(electron.exit(0)),
                  ),
                );
              },
              documentSync,
              projectWorkspace,
              libraryModule,
              databaseModule,
              rendererClientRouter: rendererClients.router,
              onHeartbeatAutomationsEnabledChanged: (input) => {
                applicationSchedulers.setHeartbeatAutomationsEnabled(input.enabled);
              },
              onHeartbeatAutomationThreadStateChanged: (input, rendererClientId) => {
                if (!rendererClientId) return;
                applicationSchedulers.setHeartbeatThreadRendererState({
                  ...input,
                  rendererClientId,
                });
              },
              resolveWindowSessionId: applicationWindows.resolveSessionId,
              terminalRuntime: {
                listLiveSessionsForOwners: (input) =>
                  callbacks.runPromise(terminals.listLiveSessionsForOwners(input)),
                discardExitedSessionsForOwners: (input) =>
                  callbacks.runPromise(terminals.discardExitedSessionsForOwners(input)),
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
            }),
          catch: (cause) => runtimeError("register-legacy-ipc", cause),
        });
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
            source: codexService,
            getSettings: getThreadNotificationSettings,
            isAppForegrounded: () => codexService.hasForegroundRendererClient(),
            isConversationPresentedInForeground: (conversationId) =>
              codexService.isRendererConversationPresentedInForeground(conversationId),
            resolveTargetClientId: (conversationId) => {
              const presenting = codexService.resolveRendererPresentedSurfaceClient(conversationId);
              if (presenting) return presenting;
              const fallbackWindow = windows.getLastFocused();
              if (!fallbackWindow) return null;
              return rendererClients.router.getClientIdForWebContentsId(
                fallbackWindow.webContents.id,
              );
            },
            showNotification: (notification, targetClientId, onAction) => {
              const webContentsId =
                rendererClients.router.getWebContentsIdForClientId(targetClientId);
              if (webContentsId === null) return;
              const targetWindow = windows.get(webContentsId);
              if (!targetWindow || targetWindow.isDestroyed()) return;
              desktopNotifications.manager.showNotification(
                notification,
                targetWindow.webContents,
                onAction,
              );
            },
            dismissNotification: (selector) => desktopNotifications.manager.dismiss(selector),
            dispatchAction: (targetClientId, action) =>
              rendererClients.router.sendToClient(targetClientId, "desktop-notification:action", [
                action,
              ]),
            focusTargetClient: (targetClientId) => {
              const webContentsId =
                rendererClients.router.getWebContentsIdForClientId(targetClientId);
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
