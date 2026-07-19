import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { CoreEventEnvelope } from "./types";
import {
  createCoreProjectWorkspaceAdapter,
  type DesktopProjectWorkspacePort,
} from "./project-workspace-adapter";

export interface DesktopProjectWorkspaceBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: DesktopProjectWorkspacePort;
}

export function createDesktopProjectWorkspaceBridge(
  input: DesktopProjectWorkspaceBridgeInput,
): DesktopProjectWorkspacePort {
  let coreAdapter: DesktopProjectWorkspacePort | null = null;

  const resolve = async (): Promise<DesktopProjectWorkspacePort> => {
    const runtime = await input.authority;
    if (runtime.backend === "typescript") return input.typescript;
    coreAdapter ??= createCoreProjectWorkspaceAdapter(runtime.rootClient);
    return coreAdapter;
  };

  return {
    listProjects: async () => await (await resolve()).listProjects(),
    getProject: async (projectId) =>
      await (await resolve()).getProject(projectId),
    createProject: async (projectInput) =>
      await (await resolve()).createProject(projectInput),
    updateProject: async (projectId, projectInput) =>
      await (await resolve()).updateProject(projectId, projectInput),
    reorderProjects: async (projectInput) =>
      await (await resolve()).reorderProjects(projectInput),
    setProjectPinned: async (projectId, projectInput) =>
      await (await resolve()).setProjectPinned(projectId, projectInput),
    setPinnedProjectOrder: async (projectInput) =>
      await (await resolve()).setPinnedProjectOrder(projectInput),
    deleteProject: async (projectId) =>
      await (await resolve()).deleteProject(projectId),
    listProjectSessions: async (projectId, options) =>
      await (await resolve()).listProjectSessions(projectId, options),
    listProjectSessionSummaries: async (projectId, options) =>
      await (await resolve()).listProjectSessionSummaries(projectId, options),
    getProjectSession: async (sessionId) =>
      await (await resolve()).getProjectSession(sessionId),
    updateProjectSession: async (sessionId, sessionInput) =>
      await (await resolve()).updateProjectSession(sessionId, sessionInput),
    renameProjectSession: async (sessionId, sessionInput) =>
      await (await resolve()).renameProjectSession(sessionId, sessionInput),
    createProjectSession: async (sessionInput) =>
      await (await resolve()).createProjectSession(sessionInput),
    deleteProjectSession: async (sessionId) =>
      await (await resolve()).deleteProjectSession(sessionId),
    reorderProjectSessions: async (projectId, orderedSessionIds) =>
      await (await resolve()).reorderProjectSessions(
        projectId,
        orderedSessionIds,
      ),
    setProjectSessionPinned: async (sessionId, sessionInput) =>
      await (await resolve()).setProjectSessionPinned(sessionId, sessionInput),
    setPinnedProjectSessionOrder: async (projectId, sessionInput) =>
      await (await resolve()).setPinnedProjectSessionOrder(
        projectId,
        sessionInput,
      ),
    archiveProjectSession: async (sessionId) =>
      await (await resolve()).archiveProjectSession(sessionId),
    unarchiveProjectSession: async (sessionId) =>
      await (await resolve()).unarchiveProjectSession(sessionId),
    markProjectSessionUnread: async (sessionId, sessionInput) =>
      await (await resolve()).markProjectSessionUnread(sessionId, sessionInput),
    createProjectSessionTab: async (tabInput) =>
      await (await resolve()).createProjectSessionTab(tabInput),
    splitProjectSessionPanelGroup: async (panelInput) =>
      await (await resolve()).splitProjectSessionPanelGroup(panelInput),
    ensureProjectSessionPanelLeafToRight: async (panelInput) =>
      await (await resolve()).ensureProjectSessionPanelLeafToRight(panelInput),
    mergeProjectSessionPanelGroup: async (panelInput) =>
      await (await resolve()).mergeProjectSessionPanelGroup(panelInput),
    activateProjectSessionPanelGroup: async (panelInput) =>
      await (await resolve()).activateProjectSessionPanelGroup(panelInput),
    resizeProjectSessionPanelGroup: async (panelInput) =>
      await (await resolve()).resizeProjectSessionPanelGroup(panelInput),
    maximizeProjectSessionPanelGroup: async (panelInput) =>
      await (await resolve()).maximizeProjectSessionPanelGroup(panelInput),
    reorderProjectSessionTabs: async (tabInput) =>
      await (await resolve()).reorderProjectSessionTabs(tabInput),
    getProjectSessionTab: async (tabId) =>
      await (await resolve()).getProjectSessionTab(tabId),
    updateProjectSessionTab: async (tabId, tabInput) =>
      await (await resolve()).updateProjectSessionTab(tabId, tabInput),
    updateProjectSessionTabState: async (tabId, stateKey, state) =>
      await (await resolve()).updateProjectSessionTabState(
        tabId,
        stateKey,
        state,
      ),
    updateProjectSessionPanel: async (sessionId, panelId, panelInput) =>
      await (await resolve()).updateProjectSessionPanel(
        sessionId,
        panelId,
        panelInput,
      ),
    deleteProjectSessionTab: async (tabInput) =>
      await (await resolve()).deleteProjectSessionTab(tabInput),
    moveProjectSessionTab: async (tabInput) =>
      await (await resolve()).moveProjectSessionTab(tabInput),
    upsertProjectSessionThreadLink: async (threadInput) =>
      await (await resolve()).upsertProjectSessionThreadLink(threadInput),
    detachProjectSessionThread: async (sessionId) =>
      await (await resolve()).detachProjectSessionThread(sessionId),
  };
}

export interface CoreProjectWorkspaceInvalidation {
  readonly projectIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly threadIds: readonly string[];
}

export function mapCoreProjectWorkspaceEvent(
  envelope: CoreEventEnvelope,
): CoreProjectWorkspaceInvalidation | null {
  const payload = envelope.event.payload;
  if (payload.module !== "project_workspace") return null;
  return {
    projectIds: payload.event.project_ids,
    sessionIds: payload.event.session_ids,
    threadIds: payload.event.thread_ids,
  };
}
