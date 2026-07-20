import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import {
  getCodexThreadDynamicToolCatalogs,
  replaceCodexThreadDynamicToolCatalogs,
} from "./codex/codex-dynamic-tool-catalog-repository";
import {
  getCodexThread,
  listCodexThreadLinks,
  listPinnedCodexThreadIds,
  setCodexPinnedThreadOrder,
  setCodexThreadHasUnreadTurn,
  setCodexThreadPinned,
  unlinkCodexThread,
  updateCodexThreadArchived,
  updateCodexThreadName,
  upsertCodexThread,
} from "./codex/codex-link-repository";
import {
  getCodexProjectPermissionModeSelection,
  putCodexProjectPermissionModeSelection,
} from "./local-store/codex-project-permission-modes";
import {
  deleteCodexThreadWritableRoots,
  getCodexThreadWritableRoots,
  mergeCodexThreadWritableRoots,
  replaceCodexThreadWritableRoots,
} from "./local-store/codex-thread-writable-roots";
import {
  listCodexBackgroundProcesses,
  upsertCodexBackgroundProcess,
} from "./local-store/codex-background-processes";
import {
  listCodexProjectThreadOrders,
  moveCodexProjectThread,
  setCodexProjectThreadOrder,
} from "./local-store/codex-project-thread-move";
import {
  getCodexSidebarChatOrder,
  setCodexSidebarChatOrder,
} from "./local-store/codex-sidebar-chat-order";
import { projectDeletionRuntime } from "./project-deletion-runtime";
import { dbNotifier } from "./local-store/notifier";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
  DesktopProjectWorkspaceThreadPatch,
} from "./core-client/project-workspace-adapter";
import type { CodexThreadSummary } from "../shared/types";

const fromTypeScriptThread = (
  thread: CodexThreadSummary,
  pinnedOrderByThreadId: ReadonlyMap<string, number>,
  sessionId: string | null,
): DesktopProjectWorkspaceThread => {
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
    sessionId,
    forkedFromId: thread.forkedFromId ?? null,
    parentThreadId: thread.source?.parentThreadId ?? null,
    threadSource: thread.threadSource ?? null,
    serviceName: thread.serviceName ?? null,
    agentNickname: thread.agentNickname ?? null,
    agentRole: thread.agentRole ?? null,
    agentPath: thread.agentPath ?? null,
    threadName: thread.threadName,
    threadPreview: thread.threadPreview,
    modelProvider: thread.modelProvider,
    cwd: thread.cwd,
    managedWorktreePath: thread.managedWorktreePath ?? null,
    projectlessOutputDirectory: thread.projectlessOutputDirectory ?? null,
    projectlessWorkspaceBrowserRoot:
      thread.projectlessWorkspaceBrowserRoot ?? null,
    statusType: thread.statusType,
    statusActiveFlags: [...thread.statusActiveFlags],
    archived: thread.archived,
    pinnedOrder: pinnedOrderByThreadId.get(thread.threadId) ?? null,
    hasUnreadTurn: thread.hasUnreadTurn ?? false,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    linkedAt: thread.linkedAt,
  };
};

const readTypeScriptThread = (
  threadId: string,
): DesktopProjectWorkspaceThread | null => {
  const thread = getCodexThread(threadId);
  if (!thread) return null;
  const pinnedOrderByThreadId = new Map(
    listPinnedCodexThreadIds().map((id, index) => [id, index]),
  );
  const sessionLink = projectSessionService.getProjectSessionThreadLink(threadId);
  return fromTypeScriptThread(
    thread,
    pinnedOrderByThreadId,
    sessionLink?.sessionId ?? null,
  );
};

const readTypeScriptSidebar = (
  includeArchived: boolean,
): DesktopProjectWorkspaceSidebar => {
  const pinnedThreadIds = listPinnedCodexThreadIds();
  const pinnedOrderByThreadId = new Map(
    pinnedThreadIds.map((threadId, index) => [threadId, index]),
  );
  const threads = listCodexThreadLinks({ includeArchived }).flatMap((thread) => {
    const sessionLink = projectSessionService.getProjectSessionThreadLink(
      thread.threadId,
    );
    const session = sessionLink
      ? projectSessionService.getProjectSessionSummary(sessionLink.sessionId)
      : null;
    if (!includeArchived && session?.archived) return [];
    return [fromTypeScriptThread(
      thread,
      pinnedOrderByThreadId,
      session?.id ?? null,
    )];
  });
  return {
    threads,
    projectThreadOrders: listCodexProjectThreadOrders(),
    projectlessThreadOrder: getCodexSidebarChatOrder(),
  };
};

const upsertTypeScriptThread = (
  threadId: string,
  patch: DesktopProjectWorkspaceThreadPatch,
): DesktopProjectWorkspaceThread => {
  const hasThreadName = Object.prototype.hasOwnProperty.call(patch, "threadName");
  upsertCodexThread({
    threadId,
    ...(Object.prototype.hasOwnProperty.call(patch, "projectId")
      ? { projectId: patch.projectId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "forkedFromId")
      ? { forkedFromId: patch.forkedFromId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "parentThreadId")
      ? {
          source: patch.parentThreadId
            ? { parentThreadId: patch.parentThreadId }
            : null,
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "threadName")
      ? { threadName: patch.threadName ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "threadSource")
      ? { threadSource: patch.threadSource ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "serviceName")
      ? { serviceName: patch.serviceName ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "agentNickname")
      ? { agentNickname: patch.agentNickname ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "agentRole")
      ? { agentRole: patch.agentRole ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "agentPath")
      ? { agentPath: patch.agentPath ?? null }
      : {}),
    ...(patch.threadPreview === undefined
      ? {}
      : { threadPreview: patch.threadPreview }),
    ...(patch.modelProvider === undefined
      ? {}
      : { modelProvider: patch.modelProvider }),
    ...(Object.prototype.hasOwnProperty.call(patch, "cwd")
      ? { cwd: patch.cwd ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "managedWorktreePath")
      ? { managedWorktreePath: patch.managedWorktreePath ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "projectlessOutputDirectory")
      ? { projectlessOutputDirectory: patch.projectlessOutputDirectory ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "projectlessWorkspaceBrowserRoot")
      ? {
          projectlessWorkspaceBrowserRoot:
            patch.projectlessWorkspaceBrowserRoot ?? null,
        }
      : {}),
    ...(patch.status === undefined
      ? {}
      : {
          statusType: patch.status.statusType,
          statusActiveFlags: [...patch.status.activeFlags],
        }),
    ...(patch.archived === undefined ? {} : { archived: patch.archived }),
    ...(patch.createdAt === undefined ? {} : { createdAt: patch.createdAt }),
    ...(patch.updatedAt === undefined ? {} : { updatedAt: patch.updatedAt }),
    ...(patch.linkedAt === undefined ? {} : { linkedAt: patch.linkedAt }),
  });
  if (hasThreadName && patch.threadName === null) {
    updateCodexThreadName(threadId, null);
  }
  const thread = readTypeScriptThread(threadId);
  if (!thread) throw new Error(`Unable to read upserted Codex Thread '${threadId}'`);
  return thread;
};

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
  upsertProjectSessionThreadLink: async (input) => {
    const link = projectSessionService.upsertProjectSessionThreadLink(input);
    dbNotifier.notifyProjectSessionsChanged(
      link.projectId,
      "create",
      link.sessionId,
    );
    return link;
  },
  detachProjectSessionThread: async (sessionId) =>
    projectSessionService.detachProjectSessionThread(sessionId),
  getThread: async (threadId) => readTypeScriptThread(threadId),
  setThreadUnread: async (threadId, unread) => {
    const summary = setCodexThreadHasUnreadTurn(threadId, unread);
    if (!summary) return null;
    const owners = projectSessionService.syncProjectSessionUnreadForThread(threadId);
    for (const owner of owners) {
      dbNotifier.notifyProjectSessionsChanged(
        owner.projectId,
        "unread",
        owner.sessionId,
      );
    }
    return readTypeScriptThread(threadId);
  },
  upsertThread: async (threadId, patch) => upsertTypeScriptThread(threadId, patch),
  updateThread: async (threadId, patch) => {
    if (!getCodexThread(threadId)) return null;
    return upsertTypeScriptThread(threadId, patch);
  },
  moveThread: async (input) => {
    const moved = moveCodexProjectThread({
      threadId: input.threadId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
      ...(input.beforeThreadId === undefined
        ? {}
        : { beforeThreadId: input.beforeThreadId }),
      ...(input.insertAtEnd === undefined
        ? {}
        : { insertAtEnd: input.insertAtEnd }),
      ...(input.useDefaultOrder === undefined
        ? {}
        : { useDefaultOrder: input.useDefaultOrder }),
      ...(input.metadata === undefined
        ? {}
        : { threadMetadataPatch: input.metadata }),
    });
    if (moved.sourceProjectId !== moved.targetProjectId) {
      dbNotifier.notifyProjectSessionsChanged(
        moved.sourceProjectId,
        "link",
        moved.sessionId,
      );
      dbNotifier.notifyProjectSessionsChanged(
        moved.targetProjectId,
        "link",
        moved.sessionId,
      );
    }
    const thread = readTypeScriptThread(input.threadId);
    if (!thread) {
      throw new Error(`Unable to read moved Codex Thread '${input.threadId}'`);
    }
    return { thread, sidebar: readTypeScriptSidebar(false) };
  },
  setThreadArchived: async (threadId, archived) => {
    if (!getCodexThread(threadId)) return readTypeScriptSidebar(false);
    updateCodexThreadArchived(threadId, archived);
    if (archived) {
      setCodexThreadPinned(threadId, false);
      setCodexThreadHasUnreadTurn(threadId, false);
    }
    const owners = projectSessionService.listProjectSessionThreadOwners(threadId);
    for (const owner of owners) {
      const session = archived
        ? projectSessionService.archiveProjectSession(owner.sessionId)
        : projectSessionService.unarchiveProjectSession(owner.sessionId);
      if (!session) continue;
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        archived ? "archive" : "unarchive",
        session.id,
      );
    }
    return readTypeScriptSidebar(false);
  },
  deleteThread: async (threadId) => {
    if (!getCodexThread(threadId)) {
      return { deleted: false, sidebar: readTypeScriptSidebar(false) };
    }
    const owners = projectSessionService.listProjectSessionThreadOwners(threadId);
    for (const owner of owners) {
      const session = projectSessionService.archiveProjectSession(owner.sessionId);
      projectSessionService.detachProjectSessionThread(owner.sessionId);
      if (!session) continue;
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "archive",
        session.id,
      );
    }
    setCodexThreadPinned(threadId, false);
    setCodexThreadHasUnreadTurn(threadId, false);
    const deleted = unlinkCodexThread(threadId);
    deleteCodexThreadWritableRoots(threadId);
    return { deleted, sidebar: readTypeScriptSidebar(false) };
  },
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
  mergeThreadWritableRoots: async (threadId, roots) =>
    mergeCodexThreadWritableRoots(threadId, roots),
  replaceThreadWritableRoots: async (threadId, roots) =>
    replaceCodexThreadWritableRoots(threadId, roots),
  listBackgroundProcesses: async (threadId) =>
    listCodexBackgroundProcesses(threadId),
  upsertBackgroundProcess: async (input, options) =>
    upsertCodexBackgroundProcess(input, options),
  readSidebar: async (includeArchived) =>
    readTypeScriptSidebar(includeArchived),
  setProjectThreadOrder: async (projectId, orderedThreadIds) => {
    setCodexProjectThreadOrder(projectId, orderedThreadIds);
    return readTypeScriptSidebar(false);
  },
  setProjectlessThreadOrder: async (input) => {
    setCodexSidebarChatOrder({
      threadIdsInDisplayOrder: [...input.threadIdsInDisplayOrder],
      visibleThreadIds: [...input.visibleThreadIds],
      nextVisibleThreadIds: [...input.nextVisibleThreadIds],
    });
    return readTypeScriptSidebar(false);
  },
  setThreadPinned: async (threadId, pinned, beforeThreadId) => {
    if (!getCodexThread(threadId)) return readTypeScriptSidebar(false);
    setCodexThreadPinned(threadId, pinned, beforeThreadId);
    const owners = projectSessionService.listProjectSessionThreadOwners(threadId);
    for (const owner of owners) {
      const session = projectSessionService.getProjectSession(owner.sessionId);
      if (!session) continue;
      projectSessionService.setProjectSessionPinned(session.id, { pinned });
      dbNotifier.notifyProjectSessionsChanged(
        session.projectId,
        "pin",
        session.id,
      );
    }
    return readTypeScriptSidebar(false);
  },
  reorderPinnedThreads: async (orderedThreadIds) => {
    setCodexPinnedThreadOrder(orderedThreadIds);
    return readTypeScriptSidebar(false);
  },
});
