import { BrowserSidebarService } from "./browser-sidebar-service";
import { CodexService, type CodexTerminalRuntimePort } from "./codex/codex-service";
import type { ResolvedCodexRuntime } from "./codex/codex-runtime";
import type { ProviderCredentialStore } from "./codex/provider-credential-store";
import type { CodexApplicationClient } from "./codex-runtime/CodexGatewayBridge";
import type { CodexAccountPromiseAdapter } from "./codex-application/CodexAccountPromiseAdapter";

export interface MainServiceComposition {
  readonly browserSidebarService: BrowserSidebarService;
  readonly codexService: CodexService;
}

export interface MainServiceCompositionInput {
  readonly locale: () => string;
  readonly terminalRuntime: CodexTerminalRuntimePort;
  readonly codexAccount?: CodexAccountPromiseAdapter;
  readonly codexClient?: CodexApplicationClient;
  readonly codexRuntime?: ResolvedCodexRuntime;
  readonly providerCredentialStore?: ProviderCredentialStore;
}

let activeComposition: MainServiceComposition | null = null;

/** Construct the process services without publishing globals or starting the Main runtime. */
export function createMainServiceComposition(
  input: MainServiceCompositionInput,
): MainServiceComposition {
  const browserSidebarService = new BrowserSidebarService();
  const codexService = new CodexService({
    browserTransferRuntime: browserSidebarService,
    computerUseRuntimeConfig: () => ({ locale: input.locale() }),
    terminalRuntime: input.terminalRuntime,
    ...(input.codexAccount === undefined ? {} : { accountRuntime: input.codexAccount }),
    ...(input.codexClient === undefined ? {} : { client: input.codexClient }),
    ...(input.codexRuntime === undefined ? {} : { runtime: input.codexRuntime }),
    ...(input.providerCredentialStore === undefined
      ? {}
      : { providerCredentialStore: input.providerCredentialStore }),
  });

  return { browserSidebarService, codexService };
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
