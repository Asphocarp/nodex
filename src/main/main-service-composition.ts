import { BrowserSidebarService } from "./browser-sidebar-service";
import { CodexService, type CodexTerminalRuntimePort } from "./codex/codex-service";
import type { ResolvedCodexRuntime } from "./codex/codex-runtime";
import type { CodexApplicationClient } from "./codex-runtime/CodexApplicationClient";
import type { ComposerCatalogPromiseAdapter } from "./codex-application/ComposerCatalogPromiseAdapter";
import type { AgentProviderRuntimePromiseAdapter } from "./codex-application/AgentProviderRuntimePromiseAdapter";
import type { DesktopToolRuntimePromiseAdapter } from "./host-runtime/DesktopToolRuntime";
import type { CodexPreferences } from "./codex-application/CodexPreferences";
import type { CodexAttachments } from "./codex-application/CodexAttachments";
import type { ServerRequestResponsesPromiseAdapter } from "./codex-application/ServerRequestResponsesPromiseAdapter";
import type { RemoteHostedPipRuntimeAdapter } from "./host-runtime/RemoteHostedPipRuntime";
import type { ComputerUseSettingsRuntimeAdapter } from "./host-runtime/ComputerUseSettingsRuntime";

export interface MainServiceComposition {
  readonly browserSidebarService: BrowserSidebarService;
  readonly codexService: CodexService;
  readonly computerUseSettings: ComputerUseSettingsRuntimeAdapter;
  readonly desktopTools: DesktopToolRuntimePromiseAdapter;
  readonly remoteHostedPip: RemoteHostedPipRuntimeAdapter;
}

export interface MainServiceCompositionInput {
  readonly agentProviderRuntime: AgentProviderRuntimePromiseAdapter;
  readonly browserSidebarService: BrowserSidebarService;
  readonly computerUseSettings: ComputerUseSettingsRuntimeAdapter;
  readonly terminalRuntime: CodexTerminalRuntimePort;
  readonly runtimeStateHome: string;
  readonly composerCatalog: ComposerCatalogPromiseAdapter;
  readonly desktopTools: DesktopToolRuntimePromiseAdapter;
  readonly preferences: Pick<CodexPreferences["Service"], "current">;
  readonly remoteHostedPip: RemoteHostedPipRuntimeAdapter;
  readonly attachments: CodexAttachments["Service"]["legacy"];
  readonly serverRequestResponses: ServerRequestResponsesPromiseAdapter;
  readonly codexClient: CodexApplicationClient;
  readonly codexRuntime: ResolvedCodexRuntime;
}

let activeComposition: MainServiceComposition | null = null;

/** Construct the process services without publishing globals or starting the Main runtime. */
export function createMainServiceComposition(
  input: MainServiceCompositionInput,
): MainServiceComposition {
  const browserSidebarService = input.browserSidebarService;
  const codexService = new CodexService({
    browserTransferRuntime: browserSidebarService,
    agentProviderRuntime: input.agentProviderRuntime,
    terminalRuntime: input.terminalRuntime,
    runtimeStateHome: input.runtimeStateHome,
    composerCatalog: input.composerCatalog,
    desktopTools: input.desktopTools,
    preferences: input.preferences,
    attachments: input.attachments,
    serverRequestResponses: input.serverRequestResponses,
    client: input.codexClient,
    runtime: input.codexRuntime,
  });

  return {
    browserSidebarService,
    codexService,
    computerUseSettings: input.computerUseSettings,
    desktopTools: input.desktopTools,
    remoteHostedPip: input.remoteHostedPip,
  };
}

/**
 * Publish one explicitly constructed composition to legacy Main modules while they migrate to
 * constructor injection. The returned release is identity-safe, so stale scopes cannot clear a
 * newer composition.
 */
export function activateMainServiceComposition(composition: MainServiceComposition): () => void {
  if (activeComposition !== null) {
    throw new Error("Main service composition is already active");
  }
  activeComposition = composition;
  return () => {
    if (activeComposition === composition) activeComposition = null;
  };
}

export function getMainServiceComposition(): MainServiceComposition {
  if (activeComposition === null) {
    throw new Error("Main service composition has not been activated");
  }
  return activeComposition;
}
