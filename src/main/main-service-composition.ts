import { BrowserSidebarService } from "./browser-sidebar-service";
import { CodexService } from "./codex/codex-service";
import { TerminalManager } from "./terminal-manager";

export interface MainServiceComposition {
  readonly browserSidebarService: BrowserSidebarService;
  readonly codexService: CodexService;
  readonly terminalManager: TerminalManager;
}

export interface MainServiceCompositionInput {
  readonly locale: () => string;
}

let activeComposition: MainServiceComposition | null = null;

/** Construct the process services without publishing globals or starting the Main runtime. */
export function createMainServiceComposition(
  input: MainServiceCompositionInput,
): MainServiceComposition {
  const browserSidebarService = new BrowserSidebarService();
  const terminalManager = new TerminalManager();
  terminalManager.configurePtyDataObserver(browserSidebarService);
  const codexService = new CodexService({
    browserTransferRuntime: browserSidebarService,
    computerUseRuntimeConfig: () => ({ locale: input.locale() }),
    terminalRuntime: {
      getSessionSnapshot: async (sessionId) => terminalManager.getSessionSnapshot(sessionId),
      getThreadSnapshot: async (threadId) => terminalManager.getThreadSnapshot(threadId),
      refreshSessionProcessMetrics: async (sessionIds) =>
        await terminalManager.refreshSessionProcessMetrics(sessionIds),
    },
  });

  return { browserSidebarService, codexService, terminalManager };
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
