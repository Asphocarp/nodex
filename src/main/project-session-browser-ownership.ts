import type {
  Project,
  ProjectSession,
  ProjectSessionTab,
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
  return await deleteProjectSessionTabWithBrowserCleanupUsing({
    input,
    browserRuntime,
    getProjectSessionTab: async (tabId) =>
      projectSessionService.getProjectSessionTab(tabId),
    deleteProjectSessionTab: async (tabInput) =>
      projectSessionService.deleteProjectSessionTab(tabInput),
    getProjectSession: async (sessionId) =>
      projectSessionService.getProjectSession(sessionId),
  });
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

export async function deleteProjectSessionWithBrowserCleanup(
  sessionId: string,
  browserRuntime: ProjectSessionBrowserRuntime,
): Promise<boolean> {
  return await deleteProjectSessionWithBrowserCleanupUsing({
    sessionId,
    browserRuntime,
    getProjectSession: async (targetSessionId) =>
      projectSessionService.getProjectSession(targetSessionId),
    deleteProjectSession: async (targetSessionId) =>
      projectSessionService.deleteProjectSession(targetSessionId),
  });
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

export async function deleteProjectWithBrowserCleanup(
  projectId: string,
  browserRuntime: ProjectSessionBrowserRuntime,
  deleteProject: (projectId: string) => boolean | Promise<boolean> = projectDeletionRuntime.deleteProject,
): Promise<boolean> {
  return await deleteProjectWithBrowserCleanupUsing({
    projectId,
    browserRuntime,
    deleteProject,
    getProject: async (targetProjectId) =>
      projectsStore.getProject(targetProjectId),
    listProjectSessions: async (targetProjectId) =>
      projectSessionService.listProjectSessions(targetProjectId, {
        includeArchived: true,
      }),
  });
}

export interface DeleteProjectWithBrowserCleanupInput {
  readonly projectId: string;
  readonly browserRuntime: ProjectSessionBrowserRuntime;
  readonly deleteProject: (projectId: string) => boolean | Promise<boolean>;
  readonly getProject: (projectId: string) => Project | null | Promise<Project | null>;
  readonly listProjectSessions: (
    projectId: string,
  ) => ProjectSession[] | Promise<ProjectSession[]>;
}

export async function deleteProjectWithBrowserCleanupUsing(
  input: DeleteProjectWithBrowserCleanupInput,
): Promise<boolean> {
  const project = await input.getProject(input.projectId);
  const canonicalProjectId = project?.id ?? null;
  const sessions = canonicalProjectId
    ? await input.listProjectSessions(canonicalProjectId)
    : [];
  const deleted = await input.deleteProject(input.projectId);
  if (!deleted) return false;

  for (const session of sessions) {
    await input.browserRuntime.closeBrowserConversation(session.id);
  }
  await input.browserRuntime.closeBrowserProject?.(
    canonicalProjectId ?? input.projectId,
  );
  return true;
}
