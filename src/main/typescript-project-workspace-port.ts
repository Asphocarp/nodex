import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import {
  getCodexThreadDynamicToolCatalogs,
  replaceCodexThreadDynamicToolCatalogs,
} from "./codex/codex-dynamic-tool-catalog-repository";
import { getCodexThread } from "./codex/codex-link-repository";
import {
  getCodexProjectPermissionModeSelection,
  putCodexProjectPermissionModeSelection,
} from "./local-store/codex-project-permission-modes";
import { getCodexThreadWritableRoots } from "./local-store/codex-thread-writable-roots";
import { projectDeletionRuntime } from "./project-deletion-runtime";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";

/** TypeScript-oracle implementation of the deep Project Workspace port. */
export const createTypeScriptProjectWorkspacePort = (
): DesktopProjectWorkspacePort => ({
  listProjects: async () => projectsStore.listProjects(),
  getProject: async (projectId) => projectsStore.getProject(projectId),
  readProjectPermissionMode: async (projectId) =>
    getCodexProjectPermissionModeSelection(projectId),
  setProjectPermissionMode: async (projectId, mode) => {
    putCodexProjectPermissionModeSelection(projectId, mode);
    return mode;
  },
  createProject: async (input) => projectsStore.createProject(input),
  updateProject: async (projectId, input) =>
    projectsStore.updateProject(projectId, input),
  reorderProjects: async (input) => projectsStore.reorderProjects(input),
  setProjectPinned: async (projectId, input) =>
    projectsStore.setProjectPinned(projectId, input),
  setPinnedProjectOrder: async (input) =>
    projectsStore.setPinnedProjectOrder(input),
  deleteProject: async (projectId) =>
    await projectDeletionRuntime.deleteProject(projectId),
  listProjectSessions: async (projectId, options) =>
    projectSessionService.listProjectSessions(projectId, options),
  listProjectSessionSummaries: async (projectId, options) =>
    projectSessionService.listProjectSessionSummaries(projectId, options),
  getProjectSession: async (sessionId) =>
    projectSessionService.getProjectSession(sessionId),
  updateProjectSession: async (sessionId, input) =>
    projectSessionService.updateProjectSession(sessionId, input),
  renameProjectSession: async (sessionId, input) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing || existing.thread) return existing;
    return projectSessionService.updateProjectSession(sessionId, {
      noThreadFallbackTitle: input.title,
    });
  },
  createProjectSession: async (input) =>
    projectSessionService.createProjectSession(input),
  deleteProjectSession: async (sessionId) =>
    projectSessionService.deleteProjectSession(sessionId),
  reorderProjectSessions: async (projectId, orderedSessionIds) =>
    projectSessionService.reorderProjectSessions(projectId, orderedSessionIds),
  setProjectSessionPinned: async (sessionId, input) =>
    projectSessionService.setProjectSessionPinned(sessionId, input),
  setPinnedProjectSessionOrder: async (projectId, input) =>
    projectSessionService.setPinnedProjectSessionOrder(projectId, input),
  archiveProjectSession: async (sessionId) =>
    projectSessionService.archiveProjectSession(sessionId),
  unarchiveProjectSession: async (sessionId) =>
    projectSessionService.unarchiveProjectSession(sessionId),
  markProjectSessionUnread: async (sessionId, input) =>
    projectSessionService.markProjectSessionUnread(sessionId, input),
  createProjectSessionTab: async (input) =>
    projectSessionService.createProjectSessionTab(input),
  splitProjectSessionPanelGroup: async (input) =>
    projectSessionService.splitProjectSessionPanelGroup(input),
  ensureProjectSessionPanelLeafToRight: async (input) =>
    projectSessionService.ensureProjectSessionPanelLeafToRight(input),
  mergeProjectSessionPanelGroup: async (input) =>
    projectSessionService.mergeProjectSessionPanelGroup(input),
  activateProjectSessionPanelGroup: async (input) =>
    projectSessionService.activateProjectSessionPanelGroup(input),
  resizeProjectSessionPanelGroup: async (input) =>
    projectSessionService.resizeProjectSessionPanelGroup(input),
  maximizeProjectSessionPanelGroup: async (input) =>
    projectSessionService.maximizeProjectSessionPanelGroup(input),
  reorderProjectSessionTabs: async (input) =>
    projectSessionService.reorderProjectSessionTabs(input),
  getProjectSessionTab: async (tabId) =>
    projectSessionService.getProjectSessionTab(tabId),
  updateProjectSessionTab: async (tabId, input) =>
    projectSessionService.updateProjectSessionTab(tabId, input),
  updateProjectSessionTabState: async (tabId, stateKey, state) =>
    projectSessionService.updateProjectSessionTabState(tabId, stateKey, state),
  updateProjectSessionPanel: async (sessionId, panelId, input) =>
    projectSessionService.updateProjectSessionPanel(sessionId, panelId, input),
  deleteProjectSessionTab: async (input) =>
    projectSessionService.deleteProjectSessionTab(input),
  moveProjectSessionTab: async (input) =>
    projectSessionService.moveProjectSessionTab(input),
  upsertProjectSessionThreadLink: async (input) =>
    projectSessionService.upsertProjectSessionThreadLink(input),
  detachProjectSessionThread: async (sessionId) =>
    projectSessionService.detachProjectSessionThread(sessionId),
  readThreadExecutionContext: async (threadId) => {
    const thread = getCodexThread(threadId);
    if (!thread) return null;
    return {
      threadId: thread.threadId,
      projectId: thread.projectId,
      permissionMode: thread.projectId
        ? getCodexProjectPermissionModeSelection(thread.projectId)
        : null,
      dynamicToolCatalogs: getCodexThreadDynamicToolCatalogs(threadId),
      writableRoots: getCodexThreadWritableRoots(threadId),
    };
  },
  replaceThreadDynamicToolCatalogs: async (threadId, catalogs) => {
    replaceCodexThreadDynamicToolCatalogs(threadId, catalogs);
    return getCodexThreadDynamicToolCatalogs(threadId);
  },
});
