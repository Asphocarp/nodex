import type {
  BrowserSidebarCommand,
  BrowserSidebarCommandResult,
} from "../../shared/browser-sidebar";

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
  if (!input.browserConversationId || !input.browserViewScopeId || !input.codexSessionId) {
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

export async function captureBrowserUseRoute(
  input: BrowserUseRouteCaptureInput,
  run: (command: BrowserUseRouteCaptureCommand) => Promise<BrowserSidebarCommandResult>,
): Promise<void> {
  const command = buildBrowserUseRouteCaptureCommand(input);
  if (!command) return;
  const result = await run(command);
  if (result.ok) return;
  throw new Error(result.message || "Browser Use route could not be captured");
}
