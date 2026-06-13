import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type OpenDialogOptions } from "electron";
import { writeImageToClipboard } from "./clipboard-image-writer";
import { inspectClipboardPasteItems } from "./clipboard-paste-inspector";
import { prepareComposerPickedFiles } from "./composer-picked-files";
import * as dbService from "./kanban/db-service";
import * as projectSessionService from "./kanban/project-session-service";
import * as backupService from "./kanban/backup-service";
import * as canvasService from "./kanban/canvas-service";
import * as ptyManager from "./pty-manager";
import {
  getAppUpdateSettings,
  getBackupSettings,
  getHistorySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
  updateAppUpdateSettings,
  updateBackupSettings,
  updateHistorySettings,
  updateThreadNotificationSettings,
  updateWindowRestoreSettings,
} from "./kanban/config";
import { resolveAssetPath } from "./kanban/asset-service";
import { parseAssetSource } from "../shared/assets";
import { codexService } from "./codex/codex-service";
import { openFileLinkTarget } from "./file-link-opener";
import {
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  readWorkspacePathsExist,
  writeWorkspaceFile,
} from "./workspace-files-service";
import { dbNotifier } from "./kanban/db-notifier";
import type { WorkbenchLayoutSnapshot } from "../shared/workbench-layout";
import type { IpcApi } from "../shared/ipc-api";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WindowSessionSeed,
} from "../shared/window-session";
import type { NativeContextMenuItem, NativeContextMenuOptions } from "../shared/native-context-menu";
import { buildSessionContextMenuIconSvg } from "../shared/session-context-menu-icons";
import {
  browserSidebarService,
  broadcastBrowserSidebarEvent,
} from "./browser-sidebar-service";
import type { DesktopNotificationManager } from "./desktop-notification-manager";
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  readGitBranchState,
  watchGitBranch,
} from "./git-branch-service";
import {
  applyGitReviewPatch,
  initializeGitRepositoryAndReadReviewSnapshot,
  readBranchDiffStats,
  readGitReviewDiff,
  readGitReviewFileContents,
  readGitReviewSnapshot,
  resolveGitMergeBase,
  searchGitReview,
} from "./git-review-service";
import type { AppUpdateSettings, AppUpdateStatus, CodexPromptInput } from "../shared/types";
import type {
  BrowserBrowsingDataKind,
  BrowserSidebarCommand,
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
} from "../shared/browser-sidebar";

type TypedIpcHandler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

function registerHandle<Channel extends keyof IpcApi>(
  channel: Channel,
  listener: TypedIpcHandler<Channel>,
): void {
  // Make registration idempotent so hot-reloads cannot leave partial channel maps.
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

function buildNativeContextMenuTemplate(
  items: NativeContextMenuItem[],
  onSelect: (id: string) => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }

    const enabled = item.enabled !== false;
    const icon = item.iconKey
      ? nativeImage.createFromDataURL(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSessionContextMenuIconSvg(item.iconKey))}`,
        )
      : undefined;
    icon?.setTemplateImage(true);

    const base = {
      id: item.id,
      label: item.label,
      enabled,
      accelerator: item.accelerator,
      toolTip: item.tooltip,
      icon,
    } satisfies MenuItemConstructorOptions;

    if (item.type === "submenu") {
      return {
        ...base,
        submenu: buildNativeContextMenuTemplate(item.submenu, onSelect),
      } satisfies MenuItemConstructorOptions;
    }

    if (item.type === "checkbox") {
      return {
        ...base,
        type: "checkbox",
        checked: item.checked === true,
        click: () => {
          if (enabled) onSelect(item.id);
        },
      } satisfies MenuItemConstructorOptions;
    }

    return {
      ...base,
      click: () => {
        if (enabled) onSelect(item.id);
      },
    } satisfies MenuItemConstructorOptions;
  });
}

function showNativeContextMenu(
  window: BrowserWindow | null,
  items: NativeContextMenuItem[],
  options: NativeContextMenuOptions | undefined,
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedId: string | null = null;
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(selectedId);
    };

    const menu = Menu.buildFromTemplate(
      buildNativeContextMenuTemplate(items, (id) => {
        selectedId = id;
      }),
    );

    menu.popup({
      window: window ?? undefined,
      x: typeof options?.x === "number" ? Math.round(options.x) : undefined,
      y: typeof options?.y === "number" ? Math.round(options.y) : undefined,
      positioningItem: options?.positioningItem,
      callback: finish,
    });
  });
}

let browserSidebarEventBridgeRegistered = false;

function ensureBrowserSidebarEventBridge(): void {
  if (browserSidebarEventBridgeRegistered) return;
  browserSidebarEventBridgeRegistered = true;
  browserSidebarService.on("state", (snapshot) => broadcastBrowserSidebarEvent("state", snapshot));
  browserSidebarService.on("localServers", (snapshot) => broadcastBrowserSidebarEvent("localServers", snapshot));
  browserSidebarService.on("browserUseState", (snapshot) => broadcastBrowserSidebarEvent("browserUseState", snapshot));
  browserSidebarService.on("browserUseViewport", (event) => broadcastBrowserSidebarEvent("browserUseViewport", event));
  browserSidebarService.on("browserUseCaptureSurface", (event) => broadcastBrowserSidebarEvent("browserUseCaptureSurface", event));
  browserSidebarService.on("browserUseCursor", (event) => broadcastBrowserSidebarEvent("browserUseCursor", event));
  browserSidebarService.on("pageReleased", (event) => broadcastBrowserSidebarEvent("pageReleased", event));
  browserSidebarService.on("webviewAttached", (event) => broadcastBrowserSidebarEvent("webviewAttached", event));
  browserSidebarService.on("destroyWebview", (event) => broadcastBrowserSidebarEvent("destroyWebview", event));
}

interface RegisterIpcHandlersOptions {
  onCreateWindow?: (seed?: WindowSessionSeed) => void;
  onBootstrapWindowSession?: (webContentsId: number) => WindowSessionBootstrap;
  onSaveWindowSessionLayout?: (
    webContentsId: number,
    layout: WorkbenchLayoutSnapshot,
  ) => WindowSessionBootstrap;
  onUpdateWindowSessionBounds?: (webContentsId: number, bounds: WindowSessionBounds) => void;
  desktopNotificationManager?: DesktopNotificationManager;
  onGetAppUpdateStatus?: () => AppUpdateStatus;
  onCheckForAppUpdate?: () => Promise<AppUpdateStatus>;
  onInstallAppUpdate?: () => boolean;
  onAppUpdateSettingsChanged?: (settings: AppUpdateSettings) => void;
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions = {}): void {
  ensureBrowserSidebarEventBridge();

  const gitBranchWatches = new Map<number, { cwd: string; dispose: () => void }>();
  const gitBranchWatchCleanupBound = new Set<number>();

  const focusNotificationOriginWindow = (window: BrowserWindow | null): void => {
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  };

  const stopGitBranchWatch = (webContentsId: number) => {
    const activeWatch = gitBranchWatches.get(webContentsId);
    if (!activeWatch) return;
    activeWatch.dispose();
    gitBranchWatches.delete(webContentsId);
  };

  codexService.on("event", (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send("codex:event", event);
    }
  });
  codexService.on("hostMessage", (message) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send("codex:host-message", message);
    }
  });

  // Projects
  registerHandle("projects:list", () => dbService.listProjects());

  registerHandle("projects:get", (_, projectId: string) =>
    dbService.getProject(projectId)
  );

  registerHandle("projects:create", (_, input) =>
    dbService.createProject(input)
  );

  registerHandle("projects:update", (_, projectId: string, updates) =>
    dbService.updateProject(projectId, updates)
  );

  registerHandle("projects:pick-source-root", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: "Choose source folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  registerHandle("projects:delete", (_, projectId: string) =>
    dbService.deleteProject(projectId)
  );

  // Project sessions
  registerHandle("project-sessions:list", (_, projectId: string, options) =>
    projectSessionService.listProjectSessions(projectId, options)
  );

  registerHandle("project-sessions:create", (_, input) => {
    const session = projectSessionService.createProjectSession(input);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "create", session.id);
    return session;
  });

  registerHandle("project-sessions:update", async (_, sessionId: string, input) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    const nextTitle = typeof input?.title === "string" ? input.title : null;
    if (nextTitle !== null && existing.thread) {
      await codexService.setThreadName(existing.thread.threadId, nextTitle);
    }
    const session = projectSessionService.updateProjectSession(sessionId, input);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(session.projectId, "update", session.id);
    }
    return session;
  });

  registerHandle("project-sessions:delete", (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    const success = projectSessionService.deleteProjectSession(sessionId);
    if (success && existing) {
      dbNotifier.notifyProjectSessionsChanged(existing.projectId, "delete", sessionId);
    }
    return success;
  });

  registerHandle("project-sessions:reorder", (_, projectId: string, orderedSessionIds: string[]) => {
    const sessions = projectSessionService.reorderProjectSessions(projectId, orderedSessionIds);
    dbNotifier.notifyProjectSessionsChanged(projectId, "reorder");
    return sessions;
  });

  registerHandle("project-sessions:set-pinned", (_, sessionId: string, input) => {
    const session = projectSessionService.setProjectSessionPinned(sessionId, input);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(session.projectId, "pin", session.id);
    }
    return session;
  });

  registerHandle("project-sessions:set-pinned-order", (_, projectId: string, input) => {
    const sessions = projectSessionService.setPinnedProjectSessionOrder(projectId, input);
    dbNotifier.notifyProjectSessionsChanged(projectId, "pin");
    return sessions;
  });

  registerHandle("project-sessions:archive", async (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.archiveProjectSession(sessionId);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(session.projectId, "archive", session.id);
    }
    return session;
  });

  registerHandle("project-sessions:unarchive", async (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return null;
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.unarchiveProjectSession(sessionId);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(session.projectId, "unarchive", session.id);
    }
    return session;
  });

  registerHandle("project-sessions:mark-unread", (_, sessionId: string, input) => {
    const session = projectSessionService.markProjectSessionUnread(sessionId, input);
    if (session) {
      dbNotifier.notifyProjectSessionsChanged(session.projectId, "unread", session.id);
    }
    return session;
  });

  registerHandle("project-sessions:fork", async (_, sessionId: string, input) => {
    const result = await codexService.forkProjectSessionThread(sessionId, input);
    dbNotifier.notifyProjectSessionsChanged(result.session.projectId, "create", result.session.id);
    return result;
  });

  registerHandle("project-session-tabs:create", (_, input) =>
    projectSessionService.createProjectSessionTab(input)
  );

  registerHandle("project-session-tabs:update", (_, tabId: string, input) =>
    projectSessionService.updateProjectSessionTab(tabId, input)
  );

  registerHandle("project-session-panels:update", (_, sessionId: string, panelId, input) =>
    projectSessionService.updateProjectSessionPanel(sessionId, panelId, input)
  );

  registerHandle("project-session-panels:split", (_, input) =>
    projectSessionService.splitProjectSessionPanelGroup(input)
  );

  registerHandle("project-session-panels:merge", (_, input) =>
    projectSessionService.mergeProjectSessionPanelGroup(input)
  );

  registerHandle("project-session-panels:activate", (_, input) =>
    projectSessionService.activateProjectSessionPanelGroup(input)
  );

  registerHandle("project-session-panels:resize", (_, input) =>
    projectSessionService.resizeProjectSessionPanelGroup(input)
  );

  registerHandle("project-session-panels:maximize", (_, input) =>
    projectSessionService.maximizeProjectSessionPanelGroup(input)
  );

  registerHandle("project-session-tabs:state:update", (_, tabId: string, stateKey: number, state) =>
    projectSessionService.updateProjectSessionTabState(tabId, stateKey, state)
  );

  registerHandle("project-session-tabs:delete", (_, input) =>
    projectSessionService.deleteProjectSessionTab(input)
  );

  registerHandle("project-session-tabs:reorder", (_, input) =>
    projectSessionService.reorderProjectSessionTabs(input)
  );

  registerHandle("project-session-tabs:move", (_, input) =>
    projectSessionService.moveProjectSessionTab(input)
  );

  registerHandle("project-session-threads:attach", (_, input) => {
    const link = projectSessionService.upsertProjectSessionThreadLink(input);
    dbNotifier.notifyProjectSessionsChanged(link.projectId, "thread", link.sessionId);
    return link;
  });

  registerHandle("project-session-threads:detach", (_, sessionId: string) => {
    const existing = projectSessionService.getProjectSession(sessionId);
    const success = projectSessionService.detachProjectSessionThread(sessionId);
    if (success && existing) {
      dbNotifier.notifyProjectSessionsChanged(existing.projectId, "thread", sessionId);
    }
    return success;
  });

  // Board
  registerHandle("board:get", (_, projectId: string) =>
    dbService.getBoard(projectId)
  );

  // Cards
  registerHandle("card:create", (_, projectId, columnId, input, sessionId?, placement?) =>
    dbService.createCard(projectId, columnId, input, sessionId, placement)
  );

  registerHandle("card:update", async (_, projectId, columnId, cardId, updates, sessionId?, expectedRevision?) => {
    return dbService.updateCard(
      projectId,
      columnId || undefined,
      cardId,
      updates,
      sessionId,
      expectedRevision,
    );
  });

  registerHandle("card:get", (_, projectId: string, cardId: string, status?: string) =>
    dbService.getCard(projectId, cardId, status as Parameters<typeof dbService.getCard>[2])
  );

  registerHandle("card:delete", (_, projectId, columnId, cardId, sessionId?) =>
    dbService.deleteCard(projectId, columnId || undefined, cardId, sessionId)
  );

  registerHandle("card:move", async (_, input) => {
    const result = await dbService.moveCard(input);
    return result === "moved";
  });

  registerHandle("card:move-many", async (_, input) => {
    const result = await dbService.moveCards(input);
    return result === "moved";
  });

  registerHandle("card:move-to-project", async (_, input) => {
    const result = await dbService.moveCardToProject(input);
    if (result === "wrong_column") throw new Error("Card is no longer in the expected column");
    if (result === "not_found") throw new Error("Card not found");
    if (result === "target_project_not_found") throw new Error("Target project not found");
    return result;
  });

  registerHandle("card:import-block-drop", (_, projectId: string, input, sessionId?: string) =>
    dbService.importBlockDropAsCards(projectId, input, sessionId)
  );

  registerHandle("card:move-drop-to-editor", (_, projectId: string, input, sessionId?: string) =>
    dbService.moveCardDropToEditor(projectId, input, sessionId)
  );

  registerHandle("calendar:occurrences", (_, projectId: string, windowStart: Date, windowEnd: Date, searchQuery?: string) =>
    dbService.listCalendarOccurrences(projectId, windowStart, windowEnd, searchQuery).then((occurrences) => ({ occurrences }))
  );

  registerHandle("card:occurrence:complete", (_, projectId: string, input, sessionId?: string) =>
    dbService.completeCardOccurrence(projectId, input, sessionId)
  );

  registerHandle("card:occurrence:skip", (_, projectId: string, input, sessionId?: string) =>
    dbService.skipCardOccurrence(projectId, input, sessionId)
  );

  registerHandle("card:occurrence:update", (_, projectId: string, input, sessionId?: string) =>
    dbService.updateCardOccurrence(projectId, input, sessionId)
  );

  // History
  registerHandle("history:recent", (_, projectId: string, sessionId?: string) => {
    const entries = dbService.getRecentHistory(projectId);
    const state = dbService.getUndoRedoState(projectId, sessionId);
    return { ...state, entries };
  });

  registerHandle("history:card", (_, projectId: string, cardId: string) => {
    const entries = dbService.getCardHistoryPanelEntries(projectId, cardId);
    return { entries };
  });

  registerHandle("history:undo", (_, projectId: string, sessionId?: string) =>
    dbService.undoLatest(projectId, sessionId)
  );

  registerHandle("history:redo", (_, projectId: string, sessionId?: string) =>
    dbService.redoLatest(projectId, sessionId)
  );

  registerHandle("history:revert", (_, projectId: string, historyId: number, sessionId?: string) =>
    dbService.revertEntry(projectId, historyId, sessionId)
  );

  registerHandle("history:restore", (_, projectId: string, cardId: string, historyId: number, sessionId?: string) =>
    dbService.restoreToEntry(projectId, cardId, historyId, sessionId)
  );

  // Database introspection
  registerHandle("db:schema", (_event, projectId: string) => {
    void projectId;
    return dbService.getSchema();
  });

  registerHandle("db:query", (_, projectId: string, sql: string, params?: unknown[]) => {
    void projectId;
    return dbService.executeReadOnlyQuery(sql, params as (string | number | null)[] | undefined);
  });

  // Backups
  registerHandle("backup:list", () => backupService.listBackups());

  registerHandle("backup:create", (_, input) =>
    backupService.createBackup({ trigger: "manual", label: input?.label })
  );

  registerHandle("backup:delete", (_, backupId: string) =>
    backupService.deleteBackup(backupId)
  );

  registerHandle("backup:restore", (_, input) =>
    backupService.restoreBackup(input)
  );

  registerHandle("settings:backup:get", () => getBackupSettings());

  registerHandle("settings:backup:update", (_, input) => {
    const settings = updateBackupSettings(input);
    backupService.configureAutoBackupScheduler({
      enabled: settings.autoEnabled,
      intervalHours: settings.intervalHours,
      retentionCount: settings.retentionCount,
    });
    return settings;
  });

  registerHandle("settings:history:get", () => getHistorySettings());

  registerHandle("settings:history:update", (_, input) =>
    updateHistorySettings(input)
  );

  registerHandle("settings:thread-notifications:get", () => getThreadNotificationSettings());

  registerHandle("settings:thread-notifications:update", (_, input) =>
    updateThreadNotificationSettings(input)
  );

  registerHandle("desktop-notification:show", (event, notification) => {
    if (!options.desktopNotificationManager) {
      return;
    }

    const originWindow = BrowserWindow.fromWebContents(event.sender);
    options.desktopNotificationManager.showNotification(notification, event.sender, (action) => {
      if (action.actionType === "open") {
        focusNotificationOriginWindow(originWindow);
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop-notification:action", {
          ...action,
          conversationId: notification.conversationId ?? null,
          requestId: notification.requestId ?? null,
        });
      }
    });
  });

  registerHandle("desktop-notification:hide", (_, conversationId: string) => {
    options.desktopNotificationManager?.dismissByConversationId(conversationId ?? null);
  });

  registerHandle("electron-window:focus:get", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFocused() ?? false;
  });

  registerHandle("native-context-menu:show", async (event, items: NativeContextMenuItem[], menuOptions?: NativeContextMenuOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return await showNativeContextMenu(window, items, menuOptions);
  });

  registerHandle("settings:app-updates:get", () => getAppUpdateSettings());

  registerHandle("settings:app-updates:update", (_, input) => {
    const settings = updateAppUpdateSettings(input);
    options.onAppUpdateSettingsChanged?.(settings);
    return settings;
  });

  registerHandle("settings:window-restore:get", () => getWindowRestoreSettings());

  registerHandle("settings:window-restore:update", (_, input) =>
    updateWindowRestoreSettings(input)
  );

  registerHandle("app:update:status", () =>
    options.onGetAppUpdateStatus?.() ?? {
      status: "unsupported",
      supported: false,
      currentVersion: app.getVersion(),
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      progressPercent: null,
      transferredBytes: null,
      totalBytes: null,
      checkedAt: null,
      message: "App updates are unavailable.",
    }
  );

  registerHandle("app:update:check", async () =>
    options.onCheckForAppUpdate?.() ?? {
      status: "unsupported",
      supported: false,
      currentVersion: app.getVersion(),
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      progressPercent: null,
      transferredBytes: null,
      totalBytes: null,
      checkedAt: null,
      message: "App updates are unavailable.",
    }
  );

  registerHandle("app:update:install", () => options.onInstallAppUpdate?.() ?? false);

  registerHandle("shell:open-file-link", (_, target, openerId) =>
    openFileLinkTarget(target, openerId)
  );

  registerHandle("workspace-directory-entries", (_, input) =>
    listWorkspaceDirectoryEntries(input)
  );

  registerHandle("remote-workspace-directory-entries", (_, input) =>
    listWorkspaceDirectoryEntries(input)
  );

  registerHandle("read-file", (_, input) =>
    readWorkspaceFile(input)
  );

  registerHandle("read-file-metadata", (_, input) =>
    readWorkspaceFileMetadata(input)
  );

  registerHandle("read-file-binary", (_, input) =>
    readWorkspaceFileBinary(input)
  );

  registerHandle("write-file", (_, input) =>
    writeWorkspaceFile(input)
  );

  registerHandle("paths-exist", (_, input) =>
    readWorkspacePathsExist(input)
  );

  registerHandle("open-file", (_, target, openerId) =>
    openFileLinkTarget(target, openerId)
  );

  // Canvas
  registerHandle("canvas:get", (_, projectId: string) =>
    canvasService.getCanvas(projectId)
  );

  registerHandle("canvas:save", (_, projectId: string, data) =>
    canvasService.saveCanvas(projectId, data)
  );

  registerHandle("window:show-emoji-panel", () => {
    if (process.platform !== "darwin") return false;
    app.showEmojiPanel();
    return true;
  });

  registerHandle("window:new", (_, seed?: WindowSessionSeed) => {
    if (!options.onCreateWindow) return false;
    options.onCreateWindow(seed);
    return true;
  });

  registerHandle("window-sessions:bootstrap", (event) => {
    if (!options.onBootstrapWindowSession) {
      throw new Error("Window session state is unavailable");
    }
    return options.onBootstrapWindowSession(event.sender.id);
  });

  registerHandle("window-sessions:save-layout", (
    event,
    layout: WorkbenchLayoutSnapshot,
  ) => {
    if (!options.onSaveWindowSessionLayout) {
      throw new Error("Window session state is unavailable");
    }
    return options.onSaveWindowSessionLayout(event.sender.id, layout);
  });

  registerHandle("window-sessions:update-bounds", (event, bounds: WindowSessionBounds) => {
    options.onUpdateWindowSessionBounds?.(event.sender.id, bounds);
  });

  registerHandle("git:branch:state", (_, cwd: string) => {
    return readGitBranchState(cwd);
  });

  registerHandle("git:branch:checkout", (_, input: { cwd: string; branch: string }) => {
    return checkoutGitBranch(input);
  });

  registerHandle("git:branch:create", (_, input: { cwd: string; branch: string }) => {
    return createAndCheckoutGitBranch(input);
  });

  registerHandle("git:review:snapshot", (_, input: {
    cwd: string;
    source: "unstaged" | "staged" | "branch";
    baseRef?: string | null;
    hideWhitespace?: boolean;
  }) => {
    return readGitReviewSnapshot(input);
  });

  registerHandle("git:review:diff", (_, input) => {
    return readGitReviewDiff(input);
  });

  registerHandle("git:review:branch-diff-stats", (_, input) => {
    return readBranchDiffStats(input);
  });

  registerHandle("git:merge-base", (_, input) => {
    return resolveGitMergeBase(input);
  });

  registerHandle("git:review:file-contents", (_, input) => {
    return readGitReviewFileContents(input);
  });

  registerHandle("git:review:search", (_, input) => {
    return searchGitReview(input);
  });

  registerHandle("git:apply-patch", (_, input) => {
    return applyGitReviewPatch(input);
  });

  registerHandle("git:init", (_, cwd: string) => {
    return initializeGitRepositoryAndReadReviewSnapshot(cwd);
  });

  registerHandle("git:branch:watch:start", async (event, cwd: string) => {
    const sender = event.sender;
    const webContentsId = sender.id;
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : "";

    if (!normalizedCwd) {
      stopGitBranchWatch(webContentsId);
      return;
    }

    const existingWatch = gitBranchWatches.get(webContentsId);
    if (existingWatch?.cwd === normalizedCwd) {
      return;
    }

    stopGitBranchWatch(webContentsId);

    if (!gitBranchWatchCleanupBound.has(webContentsId)) {
      gitBranchWatchCleanupBound.add(webContentsId);
      sender.once("destroyed", () => {
        stopGitBranchWatch(webContentsId);
        gitBranchWatchCleanupBound.delete(webContentsId);
      });
    }

    const dispose = await watchGitBranch(normalizedCwd, () => {
      if (sender.isDestroyed()) {
        stopGitBranchWatch(webContentsId);
        return;
      }
      sender.send("git:branch:changed", { cwd: normalizedCwd });
    });

    if (sender.isDestroyed()) {
      dispose();
      stopGitBranchWatch(webContentsId);
      return;
    }

    gitBranchWatches.set(webContentsId, {
      cwd: normalizedCwd,
      dispose,
    });
  });

  registerHandle("git:branch:watch:stop", (event) => {
    stopGitBranchWatch(event.sender.id);
  });

  // Assets
  registerHandle("asset:resolve-path", (_, source: string) => {
    if (typeof source !== "string") return null;

    const parsed = parseAssetSource(source);
    if (!parsed) return null;

    try {
      return resolveAssetPath(parsed.fileName);
    } catch {
      return null;
    }
  });

  registerHandle("clipboard:write-image", async (_, input: { source?: string }) => {
    if (typeof input?.source !== "string") {
      return { ok: false, message: "Could not copy image." } as const;
    }

    return writeImageToClipboard(input.source);
  });

  registerHandle("clipboard:inspect-paste", () =>
    inspectClipboardPasteItems()
  );

  registerHandle("composer:pick-files", async (_, input?: { imagesOnly?: boolean; title?: string }) => {
    const imagesOnly = input?.imagesOnly === true;
    const result = await dialog.showOpenDialog({
      title: typeof input?.title === "string" ? input.title : imagesOnly ? "Select photos" : "Select files",
      properties: ["openFile", "multiSelections"],
      ...(imagesOnly
        ? {
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif"],
              },
            ],
          }
        : {}),
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return prepareComposerPickedFiles(result.filePaths);
  });

  // Browser sidebar
  registerHandle("browser-sidebar-command", async (_event, command: BrowserSidebarCommand) =>
    browserSidebarService.handleCommand(command)
  );

  registerHandle("browser-browsing-data-clear", async (_event, kind: BrowserBrowsingDataKind) =>
    browserSidebarService.clearBrowsingData(kind)
  );
  registerHandle("browser-sidebar-webview-host-created", async (_event, event: BrowserSidebarWebviewHostCreated) =>
    browserSidebarService.handleWebviewHostCreated(event)
  );
  registerHandle("browser-sidebar-webview-destroyed", async (_event, event: BrowserSidebarWebviewDestroyed) =>
    browserSidebarService.handleWebviewDestroyed(event)
  );

  // Terminal
  registerHandle(
    "pty:spawn",
    (event, sessionId: string, opts: { cols: number; rows: number; cwd?: string }) => {
      const sender = event.sender;
      return ptyManager.spawn(
        sessionId,
        opts,
        (data) => {
          browserSidebarService.observePtyData(sessionId, data);
          if (!sender.isDestroyed()) sender.send("pty:data", { sessionId, data });
        },
        (exitCode) => { if (!sender.isDestroyed()) sender.send("pty:exit", { sessionId, exitCode }); },
      );
    },
  );

  registerHandle("pty:write", (_, sessionId: string, data: string) => {
    ptyManager.write(sessionId, data);
  });

  registerHandle("pty:resize", (_, sessionId: string, cols: number, rows: number) => {
    ptyManager.resize(sessionId, cols, rows);
  });

  registerHandle("pty:kill", (_, sessionId: string) => {
    ptyManager.kill(sessionId);
  });

  registerHandle("pty:pick-cwd", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Codex
  registerHandle("codex:connection:status", () => codexService.getConnectionState());

  registerHandle("codex:account:read", () => codexService.readAccountSnapshot());

  registerHandle("codex:dictation:state:read", () => codexService.readDictationStateSnapshot());

  registerHandle("codex:account:login:start", (_, input) => codexService.startAccountLogin(input));

  registerHandle("codex:account:login:cancel", (_, loginId: string) =>
    codexService.cancelAccountLogin(loginId)
  );

  registerHandle("codex:account:logout", () => codexService.logoutAccount());

  registerHandle("codex:threads:list", (_, projectId: string, opts?: { cardId?: string; includeArchived?: boolean }) =>
    codexService.listProjectThreads(projectId, opts)
  );

  registerHandle("codex:model:list", () =>
    codexService.listModels()
  );

  registerHandle("codex:collaboration-mode:list", () =>
    codexService.listCollaborationModes()
  );

  registerHandle(
    "codex:thread:start-for-card",
    (
      _,
      input: {
        projectId: string;
        cardId: string;
        prompt: string;
        promptInput?: CodexPromptInput;
        threadName?: string;
        model?: string;
        serviceTier?: null | "fast";
        permissionMode?: "auto" | "guardian-approvals" | "full-access" | "custom";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        collaborationMode?: "default" | "plan";
        worktreeStartMode?: "autoBranch" | "detachedHead";
        worktreeBranchPrefix?: string;
      },
    ) =>
      codexService.startThreadForCard(input),
  );

  registerHandle(
    "codex:thread:start-for-session",
    (
      _,
      input: {
        projectId: string;
        sessionId: string;
        prompt: string;
        promptInput?: CodexPromptInput;
        threadName?: string;
        model?: string;
        serviceTier?: null | "fast";
        permissionMode?: "auto" | "guardian-approvals" | "full-access" | "custom";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        collaborationMode?: "default" | "plan";
        runInTarget?: "localProject" | "newWorktree" | "cloud";
        runInEnvironmentPath?: string | null;
        worktreeStartMode?: "autoBranch" | "detachedHead";
        worktreeBranchPrefix?: string;
      },
    ) =>
      codexService.startThreadForSession(input),
  );

  registerHandle(
    "codex:thread:side-chat:start",
    (
      _,
      input: {
        projectId: string;
        parentThreadId: string;
        parentNavigationPath?: string | null;
        prompt?: string;
        promptInput?: CodexPromptInput;
        model?: string;
        serviceTier?: null | "fast";
        permissionMode?: "auto" | "guardian-approvals" | "full-access" | "custom";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        collaborationMode?: "default" | "plan";
      },
    ) =>
      codexService.startSideChat(input),
  );

  registerHandle("codex:thread:side-chat:discard", (_, threadId: string) =>
    codexService.discardSideChat(threadId)
  );

  registerHandle("worktrees:list", () =>
    codexService.listManagedWorktrees()
  );

  registerHandle("worktrees:environments:list", (_, projectId: string) =>
    codexService.listWorktreeEnvironments(projectId)
  );

  registerHandle("worktrees:environments:configs:list", (_, projectId: string) =>
    codexService.listWorktreeEnvironmentConfigs(projectId)
  );

  registerHandle("worktrees:environments:config:read", (_, projectId: string, configPath?: string | null) =>
    codexService.readWorktreeEnvironmentConfig(projectId, configPath)
  );

  registerHandle("worktrees:environments:config:save", (_, input) =>
    codexService.saveWorktreeEnvironmentConfig(input)
  );

  registerHandle("worktrees:delete", (_, threadId: string) =>
    codexService.deleteManagedWorktree(threadId)
  );

  registerHandle("codex:thread:snapshot:request", (_, threadId: string) =>
    codexService.requestConversationSnapshot(threadId)
  );

  registerHandle("codex:thread:resume:request", (_, threadId: string) =>
    codexService.requestConversationResume(threadId)
  );

  registerHandle("codex:thread:name:set", (_, threadId: string, name: string) =>
    codexService.setThreadName(threadId, name)
  );

  registerHandle(
    "codex:thread:title:generate",
    (
      _,
      input: { hostId: string; prompt: string; cwd: string | null },
    ) => {
      void input.hostId;
      return codexService.generateThreadTitle({
        prompt: input.prompt,
        cwd: input.cwd,
      });
    },
  );

  registerHandle("codex:thread:archive", (_, threadId: string) =>
    codexService.archiveThread(threadId)
  );

  registerHandle("codex:thread:unarchive", (_, threadId: string) =>
    codexService.unarchiveThread(threadId)
  );

  registerHandle(
    "codex:thread:collaboration-mode:set",
    (_, threadId: string, collaborationMode: "default" | "plan") =>
      codexService.setConversationCollaborationMode(threadId, collaborationMode),
  );
  registerHandle(
    "codex:thread:plan-implementation:remove",
    (_, threadId: string, turnId: string) =>
      codexService.removePlanImplementationRequest(threadId, turnId),
  );

  registerHandle(
    "codex:turn:start",
    (
      _,
      threadId: string,
      prompt: string,
      opts?: {
        model?: string;
        serviceTier?: null | "fast";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        permissionMode?: "auto" | "guardian-approvals" | "full-access" | "custom";
        collaborationMode?: "default" | "plan";
        promptInput?: CodexPromptInput;
      },
    ) =>
      codexService.startTurn(threadId, prompt, opts),
  );

  registerHandle("codex:review:start", (_, input) =>
    codexService.startReview(input)
  );

  registerHandle(
    "codex:thread:follow-up:enqueue",
    (
      _,
      threadId: string,
      prompt: string,
      opts?: {
        model?: string;
        serviceTier?: null | "fast";
        reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
        permissionMode?: "auto" | "guardian-approvals" | "full-access" | "custom";
        collaborationMode?: "default" | "plan";
        promptInput?: CodexPromptInput;
      },
    ) =>
      codexService.enqueueQueuedFollowUpPrompt(threadId, prompt, opts),
  );

  registerHandle(
    "codex:thread:follow-up:remove",
    (_, threadId: string, followUpId: string) =>
      codexService.removeQueuedFollowUp(threadId, followUpId),
  );

  registerHandle(
    "codex:thread:follow-up:reorder",
    (_, threadId: string, orderedFollowUpIds: string[]) =>
      codexService.reorderQueuedFollowUps(threadId, orderedFollowUpIds),
  );

  registerHandle(
    "codex:thread:follow-up:send-now",
    (_, threadId: string, followUpId: string) =>
      codexService.sendQueuedFollowUpNow(threadId, followUpId),
  );

  registerHandle(
    "codex:thread:edit-last-user-turn",
    (_, threadId: string, turnId: string, message: string, opts?: { serviceTier?: null | "fast" }) =>
      codexService.editLastUserTurn(threadId, turnId, message, opts),
  );

  registerHandle(
    "codex:thread:fork-from-turn",
    (_, threadId: string, turnId: string, message: string) =>
      codexService.forkConversationFromTurn(threadId, turnId, message),
  );

  registerHandle("codex:thread:compact:start", (_, threadId: string) =>
    codexService.startThreadCompaction(threadId)
  );

  registerHandle("codex:thread:goal:get", (_, threadId: string) =>
    codexService.getThreadGoal(threadId)
  );

  registerHandle("codex:thread:goal:set", (_, threadId: string, objective: string, tokenBudget?: number | null) =>
    codexService.setThreadGoal({ threadId, objective, tokenBudget })
  );

  registerHandle("codex:thread:goal:clear", (_, threadId: string) =>
    codexService.clearThreadGoal(threadId)
  );

  registerHandle("codex:thread:memory-mode:set", (_, threadId: string, mode: "enabled" | "disabled") =>
    codexService.setThreadMemoryMode({ threadId, mode })
  );

  registerHandle("codex:feedback:upload", (_, params) =>
    codexService.uploadFeedback(params)
  );

  registerHandle(
    "codex:turn:steer",
    (_, input) => codexService.steerTurn(input),
  );

  registerHandle("codex:turn:interrupt", (_, threadId: string, turnId?: string) =>
    codexService.interruptTurn(threadId, turnId)
  );

  registerHandle("codex:thread:background-terminals:clean", (_, threadId: string) =>
    codexService.cleanBackgroundTerminals(threadId)
  );

  registerHandle("codex:mcp-resource:read", (_, params) =>
    codexService.readMcpResource(params)
  );

  registerHandle("codex:mcp-apps:list", (_, threadId?: string | null) =>
    codexService.listMcpApps(threadId)
  );

  registerHandle("codex:mcp-server-statuses:list", (_, threadId?: string | null) =>
    codexService.listMcpServerStatuses(threadId)
  );

  registerHandle("codex:approval:respond", (_, requestId: string, decision) =>
    codexService.respondToApproval(requestId, decision)
  );

  registerHandle("codex:user-input:respond", (_, requestId: string, answers) =>
    codexService.respondToUserInput(requestId, answers)
  );

  registerHandle("codex:mcp-elicitation:respond", (_, requestId: string, action: "accept" | "decline" | "cancel") =>
    codexService.respondToMcpServerElicitation(requestId, action)
  );

  registerHandle("codex:permission:mode:set", async (
    _,
    projectId: string,
    mode: "auto" | "guardian-approvals" | "full-access" | "custom",
  ) => {
    return await codexService.setProjectPermissionMode(projectId, mode);
  });

  registerHandle("codex:permission:mode:get", async (_, projectId: string) => {
    return await codexService.getProjectPermissionMode(projectId);
  });

  registerHandle("codex:permission:state:get", async (_, projectId: string) => {
    return await codexService.getPermissionState(projectId);
  });

  registerHandle("codex:permission:config-value:set", async (_, projectId: string, keyPath: string, value: unknown) => {
    return await codexService.setPermissionConfigValue(projectId, keyPath, value);
  });

  registerHandle("codex:permission:custom-description:get", async (_, projectId: string) => {
    return await codexService.getCustomPermissionModeDescription(projectId);
  });
}
