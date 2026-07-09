import type {
  ProjectSessionTabDeleteInput,
} from "../shared/types";
import {
  requireProjectSessionBrowserTabId,
  type BrowserSidebarTabIdentity,
} from "../shared/browser-sidebar";
import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import { projectDeletionRuntime } from "./project-deletion-runtime";

export interface ProjectSessionBrowserRuntime {
  closeBrowserConversation(browserConversationId: string): void | Promise<void>;
  closeBrowserProject?(projectId: string): void | Promise<void>;
  closeBrowserTab(identity: BrowserSidebarTabIdentity): void | Promise<void>;
}

function readDeleteTabId(input: string | ProjectSessionTabDeleteInput): string {
  return typeof input === "string" ? input : input.tabId;
}

export async function deleteProjectSessionTabWithBrowserCleanup(
  input: string | ProjectSessionTabDeleteInput,
  browserRuntime: ProjectSessionBrowserRuntime,
): Promise<boolean> {
  const existingTab = projectSessionService.getProjectSessionTab(readDeleteTabId(input));
  const deleted = projectSessionService.deleteProjectSessionTab(input);
  if (!deleted || existingTab?.kind !== "browser") return deleted;

  const browserTabId = requireProjectSessionBrowserTabId(existingTab);
  const remainingSession = projectSessionService.getProjectSession(existingTab.sessionId);
  const identityStillReferenced = remainingSession?.tabs.some((tab) =>
    tab.kind === "browser"
    && requireProjectSessionBrowserTabId(tab) === browserTabId
  ) === true;
  if (identityStillReferenced) return true;

  await browserRuntime.closeBrowserTab({
    browserConversationId: existingTab.sessionId,
    browserTabId,
  });
  return true;
}

export async function deleteProjectSessionWithBrowserCleanup(
  sessionId: string,
  browserRuntime: ProjectSessionBrowserRuntime,
): Promise<boolean> {
  const existing = projectSessionService.getProjectSession(sessionId);
  const deleted = projectSessionService.deleteProjectSession(sessionId);
  if (!deleted || !existing) return deleted;

  await browserRuntime.closeBrowserConversation(existing.id);
  return true;
}

export async function deleteProjectWithBrowserCleanup(
  projectId: string,
  browserRuntime: ProjectSessionBrowserRuntime,
  deleteProject: (projectId: string) => boolean | Promise<boolean> = projectDeletionRuntime.deleteProject,
): Promise<boolean> {
  const canonicalProjectId = projectsStore.resolveProjectId(projectId);
  const sessions = canonicalProjectId
    ? projectSessionService.listProjectSessions(canonicalProjectId, { includeArchived: true })
    : [];
  const deleted = await deleteProject(projectId);
  if (!deleted) return false;

  for (const session of sessions) {
    await browserRuntime.closeBrowserConversation(session.id);
  }
  await browserRuntime.closeBrowserProject?.(canonicalProjectId ?? projectId);
  return true;
}
