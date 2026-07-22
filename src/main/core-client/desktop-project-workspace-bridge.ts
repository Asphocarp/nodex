import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { CoreEventEnvelope } from "./types";
import {
  createCoreProjectWorkspaceAdapter,
  type DesktopProjectWorkspacePort,
} from "./project-workspace-adapter";

export interface DesktopProjectWorkspaceBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export function createDesktopProjectWorkspaceBridge(
  input: DesktopProjectWorkspaceBridgeInput,
): DesktopProjectWorkspacePort {
  let coreAdapter: DesktopProjectWorkspacePort | null = null;

  const resolve = async (): Promise<DesktopProjectWorkspacePort> => {
    const runtime = await input.authority;
    coreAdapter ??= createCoreProjectWorkspaceAdapter(runtime.rootClient);
    return coreAdapter;
  };

  return {
    listProjects: async () => await (await resolve()).listProjects(),
    getProject: async (projectId) =>
      await (await resolve()).getProject(projectId),
    readProjectPermissionMode: async (projectId) =>
      await (await resolve()).readProjectPermissionMode(projectId),
    setProjectPermissionMode: async (projectId, mode) =>
      await (await resolve()).setProjectPermissionMode(projectId, mode),
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
    getThread: async (threadId) =>
      await (await resolve()).getThread(threadId),
    upsertThread: async (threadId, patch) =>
      await (await resolve()).upsertThread(threadId, patch),
    updateThread: async (threadId, patch) =>
      await (await resolve()).updateThread(threadId, patch),
    moveThread: async (input) =>
      await (await resolve()).moveThread(input),
    setThreadUnread: async (threadId, unread) =>
      await (await resolve()).setThreadUnread(threadId, unread),
    setThreadArchived: async (threadId, archived) =>
      await (await resolve()).setThreadArchived(threadId, archived),
    deleteThread: async (threadId) =>
      await (await resolve()).deleteThread(threadId),
    readThreadExecutionContext: async (threadId) =>
      await (await resolve()).readThreadExecutionContext(threadId),
    replaceThreadDynamicToolCatalogs: async (threadId, catalogs) =>
      await (await resolve()).replaceThreadDynamicToolCatalogs(
        threadId,
        catalogs,
      ),
    mergeThreadWritableRoots: async (threadId, roots) =>
      await (await resolve()).mergeThreadWritableRoots(threadId, roots),
    replaceThreadWritableRoots: async (threadId, roots) =>
      await (await resolve()).replaceThreadWritableRoots(threadId, roots),
    listBackgroundProcesses: async (threadId) =>
      await (await resolve()).listBackgroundProcesses(threadId),
    upsertBackgroundProcess: async (processInput, options) =>
      await (await resolve()).upsertBackgroundProcess(processInput, options),
    readSidebar: async (includeArchived) =>
      await (await resolve()).readSidebar(includeArchived),
    setProjectThreadOrder: async (projectId, orderedThreadIds) =>
      await (await resolve()).setProjectThreadOrder(
        projectId,
        orderedThreadIds,
      ),
    setProjectlessThreadOrder: async (orderInput) =>
      await (await resolve()).setProjectlessThreadOrder(orderInput),
    setThreadPinned: async (threadId, pinned, beforeThreadId) =>
      await (await resolve()).setThreadPinned(
        threadId,
        pinned,
        beforeThreadId,
      ),
    reorderPinnedThreads: async (orderedThreadIds) =>
      await (await resolve()).reorderPinnedThreads(orderedThreadIds),
  };
}

export interface CoreProjectWorkspaceInvalidation {
  readonly projectCatalogChange?: import("../../shared/core-modules/project-workspace-module").ProjectCatalogChangeKind;
  readonly projectIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly threadIds: readonly string[];
  readonly sessionSummaryScopes: readonly import("../../shared/core-modules/project-workspace-module").ProjectSessionInvalidationScope[];
  readonly sessionDetailIds: readonly string[];
}

export function mapCoreProjectWorkspaceEvent(
  envelope: CoreEventEnvelope,
): CoreProjectWorkspaceInvalidation | null {
  const payload = envelope.event.payload;
  if (payload.module !== "project_workspace") return null;
  return {
    projectCatalogChange: payload.event.project_catalog_change ?? undefined,
    projectIds: payload.event.project_ids,
    sessionIds: payload.event.session_ids,
    threadIds: payload.event.thread_ids,
    sessionSummaryScopes: payload.event.session_summary_scopes.map((scope) => {
      if (scope.kind !== "project") return scope;
      return { kind: scope.kind, projectId: scope.project_id };
    }),
    sessionDetailIds: payload.event.session_detail_ids,
  };
}
