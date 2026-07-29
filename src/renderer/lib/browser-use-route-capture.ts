import type { BrowserSidebarCommand } from "../../shared/browser-sidebar";

type BrowserUseRouteCaptureCommand = Extract<
  BrowserSidebarCommand,
  { type: "capture-browser-use-route" }
>;

export interface BrowserUseRouteCaptureInput {
  browserConversationId: string | null;
  browserViewScopeId: string;
  codexSessionId: string | null;
  projectId: string | null;
}

export function buildBrowserUseRouteCaptureCommand(
  input: BrowserUseRouteCaptureInput,
): BrowserUseRouteCaptureCommand | null {
  if (
    !input.browserConversationId
    || !input.browserViewScopeId
    || !input.codexSessionId
  ) {
    return null;
  }
  return {
    type: "capture-browser-use-route",
    browserConversationId: input.browserConversationId,
    browserViewScopeId: input.browserViewScopeId,
    codexSessionId: input.codexSessionId,
    projectId: input.projectId,
  };
}
