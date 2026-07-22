import type {
  ProjectSession,
  ProjectSessionTab,
  ProjectSessionTabDeleteInput,
} from "../shared/types";
import {
  requireProjectSessionBrowserTabId,
  type BrowserSidebarTabIdentity,
} from "../shared/browser-sidebar";

export interface ProjectSessionBrowserRuntime {
  closeBrowserConversation(browserConversationId: string): void | Promise<void>;
  closeBrowserProject?(projectId: string): void | Promise<void>;
  closeBrowserTab(identity: BrowserSidebarTabIdentity): void | Promise<void>;
}

function readDeleteTabId(input: string | ProjectSessionTabDeleteInput): string {
  return typeof input === "string" ? input : input.tabId;
}

export interface DeleteProjectSessionTabWithBrowserCleanupInput {
  readonly input: string | ProjectSessionTabDeleteInput;
  readonly browserRuntime: ProjectSessionBrowserRuntime;
  readonly getProjectSessionTab: (
    tabId: string,
  ) => ProjectSessionTab | null | Promise<ProjectSessionTab | null>;
  readonly deleteProjectSessionTab: (
    input: string | ProjectSessionTabDeleteInput,
  ) => boolean | Promise<boolean>;
  readonly getProjectSession: (
    sessionId: string,
  ) => ProjectSession | null | Promise<ProjectSession | null>;
}

export async function deleteProjectSessionTabWithBrowserCleanupUsing(
  input: DeleteProjectSessionTabWithBrowserCleanupInput,
): Promise<boolean> {
  const existingTab = await input.getProjectSessionTab(
    readDeleteTabId(input.input),
  );
  const deleted = await input.deleteProjectSessionTab(input.input);
  if (!deleted || existingTab?.kind !== "browser") return deleted;

  const browserTabId = requireProjectSessionBrowserTabId(existingTab);
  const remainingSession = await input.getProjectSession(existingTab.sessionId);
  const identityStillReferenced = remainingSession?.tabs.some((tab) =>
    tab.kind === "browser"
    && requireProjectSessionBrowserTabId(tab) === browserTabId
  ) === true;
  if (identityStillReferenced) return true;

  await input.browserRuntime.closeBrowserTab({
    browserConversationId: existingTab.sessionId,
    browserTabId,
  });
  return true;
}

export interface DeleteProjectSessionWithBrowserCleanupInput {
  readonly sessionId: string;
  readonly browserRuntime: ProjectSessionBrowserRuntime;
  readonly getProjectSession: (
    sessionId: string,
  ) => ProjectSession | null | Promise<ProjectSession | null>;
  readonly deleteProjectSession: (
    sessionId: string,
  ) => boolean | Promise<boolean>;
}

export async function deleteProjectSessionWithBrowserCleanupUsing(
  input: DeleteProjectSessionWithBrowserCleanupInput,
): Promise<boolean> {
  const existing = await input.getProjectSession(input.sessionId);
  const deleted = await input.deleteProjectSession(input.sessionId);
  if (!deleted || !existing) return deleted;

  await input.browserRuntime.closeBrowserConversation(existing.id);
  return true;
}
