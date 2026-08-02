import { app } from "electron";
import { browserSidebarService } from "./browser-sidebar-service";
import { CodexService } from "./codex/codex-service";
import { terminalManager } from "./terminal-manager";

terminalManager.configurePtyDataObserver(browserSidebarService);

export { browserSidebarService, terminalManager };
export const codexService = new CodexService({
  browserTransferRuntime: browserSidebarService,
  computerUseRuntimeConfig: () => ({ locale: app.getLocale() }),
});
