import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchShell } from "@/components/workbench/workbench-shell";
import { LocalConversationProvider } from "@/features/local-conversation";
import { DesktopNotificationController } from "@/features/local-conversation/desktop-notification-controller";
import { HeartbeatAutomationController } from "@/features/local-conversation/heartbeat-automation-controller";
import { LocalConversationViewStateCleanupController } from "@/features/local-conversation/view/local-conversation-view-state-cleanup-controller";
import type {
  ContentSearchDomain,
  ContentSearchOpenRequest,
  ContentSearchOpenSource,
} from "@/features/content-search/content-search-context";
import { useProjects } from "@/lib/use-projects";
import {
  resolvePagesStageSelectionForPage,
  resolveSlidingWindowFocusIntent,
  resolveExpandedStages,
  resolveSlidingWindowShift,
  STAGE_ORDER,
  useWorkbenchState,
  type StageId,
  type StageNavDirection,
  type WorkbenchView,
} from "@/lib/use-workbench-state";
import { usePageStageState } from "@/lib/use-page-stage";
import {
  shouldUseRendererWorkbenchCommandFallback,
  useWorkbenchShortcuts,
} from "@/lib/use-workbench-shortcuts";
import { useCommandKeymapState } from "@/lib/use-command-keymap-state";
import type { CommandMenuMode, CommandMenuOpenRequest } from "@/lib/command-palette";
import { invoke } from "@/lib/api";
import { registerAppCloseFlushHandler } from "@/lib/app-close-flush";
import { pageEditorSessionRegistry } from "@/lib/page-editor-session-registry";
import { NodexModalHost } from "@/lib/modal-registry";
import {
  readNavigationHistoryState,
  recordNavigationTransition,
  writeNavigationHistoryState,
  type NavigationHistoryState,
  type NavigationSnapshot,
} from "@/lib/workbench-navigation-history";
import {
  bootstrapWindowSession,
  saveWindowSessionLayout,
} from "@/lib/window-sessions";
import { loadProductFeatureGates } from "@/lib/product-feature-gates";
import { AppStartupScreen } from "@/components/app-startup-screen";
import { NodexToastProvider } from "@/components/ui/toast";
import type { OpenPageStageOptions } from "@/components/kanban/open-page-stage";
import type { PageStageSessionSnapshot } from "@/components/kanban/page-stage/types";
import type {
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
  WorkbenchLayoutSnapshot,
  WindowSessionBootstrap,
} from "@/lib/types";
import type { AppInitializationStep } from "../shared/app-startup";
import {
  DEFAULT_PRODUCT_FEATURE_GATES,
  type ProductFeatureGates,
} from "../shared/product-feature-gates";
import type {
  WorkbenchCommandId,
  WorkbenchCommandInvocation,
  WorkbenchCommandRequest,
  WorkbenchCommandSource,
} from "../shared/workbench-commands";
import type {
  WorkbenchNavigationCommandRequest,
  WorkbenchNavigationDirection,
  WorkbenchNavigationCommandSource,
  WorkbenchPanelTabCycleCommandRequest,
  WorkbenchPanelTabCycleDirection,
  WorkbenchPanelTabCloseCommandRequest,
  WorkbenchSidebarToggleCommandSource,
  WorkbenchThreadRenameCommandRequest,
  WorkbenchThreadRenameCommandSource,
} from "../shared/window-navigation";

const WORKBENCH_V2_FLAG_KEY = "workbenchV2";
const rendererBootstrapStartedAt = performance.now();

function readWorkbenchV2Flag(): boolean {
  try {
    return localStorage.getItem(WORKBENCH_V2_FLAG_KEY) !== "false";
  } catch {
    return true;
  }
}

function findProjectById(projects: readonly Project[], projectId: string | null): Project | null {
  if (!projectId) return null;
  return projects.find((project) => project.id === projectId) ?? null;
}

function readProjectQueryParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URL(window.location.href).searchParams.get("project")?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function replaceProjectQueryParam(projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("project") === projectId) return;
    if (projectId) url.searchParams.set("project", projectId);
    else url.searchParams.delete("project");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore URL replacement failures; state reconciliation still selects the canonical project.
  }
}

function WorkbenchApp({
  initialWindowSessionBootstrap,
  productFeatureGates,
}: {
  initialWindowSessionBootstrap: WindowSessionBootstrap;
  productFeatureGates: ProductFeatureGates;
}) {
  const workbenchV2Enabled = readWorkbenchV2Flag();
  const {
    projects,
    hasMoreProjects,
    loadingMoreProjects,
    loadMoreProjects,
    loading,
    ready: projectsReady,
    error: projectsError,
    refresh: refreshProjects,
    createProject,
    archiveProject,
    updateProject,
    reorderProjects,
    setProjectPinned,
    setPinnedProjectOrder,
  } = useProjects();
  const {
    dbProjectId,
    threadsProjectId,
    projectRefs,
    activeView,
    activeSearchQuery,
    activeDbViewPrefs,
    viewsByProject,
    searchByProject,
    dbViewPrefsByProject,
    sidebar,
    focusedStage,
    stageNavDirection,
    pagesTabs,
    activePagesTabId,
    threadsTabs,
    activeThreadsTabId,
    filesTabs,
    activeFilesTabId,
    stagePanelWidths,
    slidingWindowPaneCount,
    recentPageSessions,
    activeRecentSessionId,
    setDbProject: setDbProjectState,
    setThreadsProjectId: setThreadsProjectIdState,
    setView: setWorkbenchView,
    setSearchQuery,
    setDbViewPrefs,
    setSidebarCollapsed,
    setSidebarWidth,
    setSidebarCollapsibleSectionCollapsed,
    setFocusedStage: setFocusedStageState,
    setSidebarStageExpanded,
    isSidebarStageExpanded,
    setSidebarSectionExpanded,
    isSidebarSectionExpanded,
    setSidebarSectionShowAll,
    isSidebarSectionShowAll,
    setActivePagesTab: setActivePagesTabState,
    setActiveThreadsTab: setActiveThreadsTabState,
    setThreadsTabs,
    setActiveFilesTab: setActiveFilesTabState,
    setStagePanelWidths,
    stepSlidingWindowPaneCount,
    recordRecentPageLeave,
    selectRecentPageSession: selectRecentPageSessionState,
    setActiveRecentPageSession: setActiveRecentPageSessionState,
    closeRecentPageSession,
    reorderRecentPageSessions,
    sessionViewsBySessionId,
    setSessionView,
    buildLayoutSnapshot,
  } = useWorkbenchState(projects, {
    initialLayoutSnapshot: initialWindowSessionBootstrap.session.layout,
    projectsReady,
  });
  const [projectPickerOpenTick, setProjectPickerOpenTick] = useState(0);
  const [taskSearchOpenTick, setTaskSearchOpenTick] = useState(0);
  const [contentSearchOpenRequest, setContentSearchOpenRequest] =
    useState<ContentSearchOpenRequest | null>(null);
  const [commandPaletteOpenTick, setCommandPaletteOpenTick] = useState(0);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState("");
  const [commandPaletteInitialMode, setCommandPaletteInitialMode] = useState<CommandMenuMode>("root");
  const [sidebarToggleRequest, setSidebarToggleRequest] = useState<{
    tick: number;
    source: WorkbenchSidebarToggleCommandSource;
  }>({ tick: 0, source: "keyboard_shortcut" });
  const sidebarToggleHandlerRef = useRef<((source: WorkbenchSidebarToggleCommandSource) => void) | null>(null);
  const [workbenchNavigationCommandRequest, setWorkbenchNavigationCommandRequest] =
    useState<WorkbenchNavigationCommandRequest | null>(null);
  const [workbenchPanelTabCycleRequest, setWorkbenchPanelTabCycleRequest] =
    useState<WorkbenchPanelTabCycleCommandRequest | null>(null);
  const [workbenchPanelTabCloseRequest, setWorkbenchPanelTabCloseRequest] =
    useState<WorkbenchPanelTabCloseCommandRequest | null>(null);
  const [threadRenameRequest, setThreadRenameRequest] =
    useState<WorkbenchThreadRenameCommandRequest | null>(null);
  const [workbenchCommandRequest, setWorkbenchCommandRequest] =
    useState<WorkbenchCommandRequest | null>(null);
  const [settingsToggleTick, setSettingsToggleTick] = useState(0);
  const [keyboardShortcutsSettingsOpenTick, setKeyboardShortcutsSettingsOpenTick] = useState(0);
  const [activeProjectSessionId, setActiveProjectSessionId] = useState<string | null>(
    initialWindowSessionBootstrap.session.layout.activeProjectSessionId ?? null,
  );

  const {
    state: pageStageState,
    openPageStage: openPageStageState,
    closePageStage: closePageStageState,
    pageStagePageId,
  } = usePageStageState(initialWindowSessionBootstrap.session.layout.pageStage ?? null);
  const pageStageCloseRef = useRef<(() => Promise<void>) | null>(null);
  const pageStagePersistRef = useRef<(() => Promise<void>) | null>(null);
  const pageStageSessionSnapshotRef = useRef<PageStageSessionSnapshot | null>(null);

  const [pendingReminderOpen, setPendingReminderOpen] = useState<{
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  } | null>(null);
  const [pendingDeepLinkOpen, setPendingDeepLinkOpen] = useState<{
    projectId: string;
    pageId: string;
  } | null>(null);
  const [pendingSessionDeepLinkOpen, setPendingSessionDeepLinkOpen] = useState<{
    projectId: string | null;
    sessionId: string;
  } | null>(null);
  const pageStageStateRef = useRef(pageStageState);
  const resumeValidationStartedRef = useRef(false);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>(() => readNavigationHistoryState());
  const latestLayoutRef = useRef<WorkbenchLayoutSnapshot>(
    initialWindowSessionBootstrap.session.layout,
  );
  const latestSerializedLayoutRef = useRef(
    JSON.stringify(initialWindowSessionBootstrap.session.layout),
  );
  const layoutRevisionRef = useRef(
    initialWindowSessionBootstrap.session.layoutRevision,
  );
  const layoutSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const layoutSaveTimerRef = useRef<number | null>(null);
  const reconciledProjectQueryRef = useRef<string | null>(null);

  useEffect(() => {
    pageStageStateRef.current = pageStageState;
  }, [pageStageState]);

  useEffect(() => {
    if (projects.length === 0) return;
    const queryProjectId = readProjectQueryParam();
    if (!queryProjectId || reconciledProjectQueryRef.current === queryProjectId) return;
    const project = findProjectById(projects, queryProjectId);
    if (!project) return;
    reconciledProjectQueryRef.current = queryProjectId;
    setDbProjectState(project.id);
    setThreadsProjectIdState(project.id);
    replaceProjectQueryParam(project.id);
  }, [projects, setDbProjectState, setThreadsProjectIdState]);

  const currentLayout = useMemo(
    () => buildLayoutSnapshot(pageStageState, activeProjectSessionId),
    [activeProjectSessionId, buildLayoutSnapshot, pageStageState],
  );

  useEffect(() => {
    latestLayoutRef.current = currentLayout;
    const serialized = JSON.stringify(currentLayout);
    if (serialized === latestSerializedLayoutRef.current) return;
    latestSerializedLayoutRef.current = serialized;
    layoutRevisionRef.current += 1;
  }, [currentLayout]);

  const flushWindowSessionLayout = useCallback(async () => {
    const input = {
      sessionId: initialWindowSessionBootstrap.session.id,
      revision: layoutRevisionRef.current,
      layout: latestLayoutRef.current,
    };
    const save = layoutSaveChainRef.current.then(async () => {
      const accepted = await saveWindowSessionLayout(input);
      layoutRevisionRef.current = Math.max(
        layoutRevisionRef.current,
        accepted.session.layoutRevision,
      );
    });
    layoutSaveChainRef.current = save.catch(() => undefined);
    await save;
  }, [initialWindowSessionBootstrap.session.id]);

  useEffect(() => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
    }

    layoutSaveTimerRef.current = window.setTimeout(() => {
      layoutSaveTimerRef.current = null;
      void flushWindowSessionLayout();
    }, 350);

    return () => {
      if (layoutSaveTimerRef.current === null) return;
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    };
  }, [currentLayout, flushWindowSessionLayout]);

  const resolvedDbProjectId = useMemo(() => {
    const project = findProjectById(projects, dbProjectId);
    return project?.id ?? null;
  }, [dbProjectId, projects]);

  const resolvedView = useMemo<WorkbenchView>(
    () => resolvedDbProjectId
      ? viewsByProject[resolvedDbProjectId] ?? activeView
      : activeView,
    [viewsByProject, resolvedDbProjectId, activeView],
  );

  const resolvedSearchQuery = useMemo(
    () => resolvedDbProjectId
      ? searchByProject[resolvedDbProjectId] ?? activeSearchQuery
      : activeSearchQuery,
    [searchByProject, resolvedDbProjectId, activeSearchQuery],
  );
  const currentNavigationSnapshot = useMemo<NavigationSnapshot>(() => ({
    dbProjectId: resolvedDbProjectId,
    activeView: resolvedView,
    focusedStage,
    stageNavDirection,
    pageStage: pageStageState,
    activePagesTabId,
    activeRecentSessionId,
    threadsProjectId,
    activeThreadsTabId,
    activeFilesTabId,
  }), [
    activePagesTabId,
    activeFilesTabId,
    activeRecentSessionId,
    activeThreadsTabId,
    pageStageState,
    focusedStage,
    resolvedDbProjectId,
    resolvedView,
    stageNavDirection,
    threadsProjectId,
  ]);
  const currentNavigationSnapshotRef = useRef(currentNavigationSnapshot);

  useEffect(() => {
    currentNavigationSnapshotRef.current = currentNavigationSnapshot;
  }, [currentNavigationSnapshot]);

  useEffect(() => {
    writeNavigationHistoryState(navigationHistory);
  }, [navigationHistory]);

  const resolveProjectView = useCallback((projectId: string | null): WorkbenchView => {
    return projectId ? viewsByProject[projectId] ?? "kanban" : "kanban";
  }, [viewsByProject]);

  const recordNavigation = useCallback((nextSnapshot: NavigationSnapshot) => {
    setNavigationHistory((prev) => recordNavigationTransition(prev, currentNavigationSnapshotRef.current, nextSnapshot));
  }, []);

  useEffect(() => {
    return registerAppCloseFlushHandler(async () => {
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
      await pageStagePersistRef.current?.();
      await pageEditorSessionRegistry.persistAll();
      await flushWindowSessionLayout();
    });
  }, [
    flushWindowSessionLayout,
  ]);

  useEffect(() => {
    if (!projectsReady) return;
    if (resumeValidationStartedRef.current) return;
    resumeValidationStartedRef.current = true;
    const initialLayout = initialWindowSessionBootstrap.session.layout;

    let cancelled = false;
    void (async () => {
      const invalidRecentSessionIds = await Promise.all(
        initialLayout.recentPageSessions.slice(0, 10).map(async (session) => {
          try {
            const result = await invoke(
              "pages:detail:get",
              session.projectId,
              session.pageId,
            );
            return !result.ok && result.error.code === "page_not_found"
              ? session.id
              : null;
          } catch {
            return null;
          }
        }),
      );

      let activeCardMissing = false;
      if (initialLayout.pageStage.open && initialLayout.pageStage.pageId) {
        try {
          const result = await invoke(
            "pages:detail:get",
            initialLayout.pageStage.projectId,
            initialLayout.pageStage.pageId,
          );
          activeCardMissing =
            !result.ok && result.error.code === "page_not_found";
        } catch {
          activeCardMissing = false;
        }
      }

      if (cancelled) return;

      invalidRecentSessionIds
        .filter((sessionId): sessionId is string => typeof sessionId === "string")
        .forEach((sessionId) => {
          closeRecentPageSession(sessionId);
        });

      if (!activeCardMissing) return;

      const matchingSession = initialLayout.recentPageSessions.find((session) =>
        session.projectId === initialLayout.pageStage.projectId
        && session.pageId === initialLayout.pageStage.pageId
      );
      if (matchingSession) {
        closeRecentPageSession(matchingSession.id);
      }

      const currentPageStageState = pageStageStateRef.current;
      if (
        currentPageStageState.open
        && currentPageStageState.projectId === initialLayout.pageStage.projectId
        && currentPageStageState.pageId === initialLayout.pageStage.pageId
      ) {
        closePageStageState();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [closePageStageState, closeRecentPageSession, initialWindowSessionBootstrap.session.layout, projectsReady]);

  const handleCreateProject = useCallback(
    async (input: ProjectCreateInput) => {
      const result = await createProject(input);
      if (result) {
        setDbProjectState(result.id);
        setThreadsProjectIdState(result.id);
      }
      return result;
    },
    [createProject, setDbProjectState, setThreadsProjectIdState],
  );

  const handleArchiveProject = useCallback(
    async (projectId: string) => await archiveProject(projectId),
    [archiveProject],
  );

  const handleUpdateProject = useCallback(
    async (projectId: string, updates: ProjectUpdateInput) =>
      await updateProject(projectId, updates),
    [updateProject],
  );

  const handleReorderProjects = useCallback(
    async (input: ProjectOrderInput) => await reorderProjects(input),
    [reorderProjects],
  );

  const handleSetProjectPinned = useCallback(
    async (projectId: string, input: ProjectPinnedInput) =>
      await setProjectPinned(projectId, input),
    [setProjectPinned],
  );

  const handleSetPinnedProjectOrder = useCallback(
    async (input: ProjectPinnedOrderInput) => await setPinnedProjectOrder(input),
    [setPinnedProjectOrder],
  );

  const recordPageLeave = useCallback((snapshot: PageStageSessionSnapshot) => {
    recordRecentPageLeave(snapshot.projectId, snapshot.pageId, snapshot.titleSnapshot);
  }, [recordRecentPageLeave]);

  const openPageStageSession = useCallback(
    async (projectId: string, pageId: string) => {
      const isSwitchingCards =
        pageStageState.open
        && (
          pageStageState.projectId !== projectId
          || pageStageState.pageId !== pageId
        );

      if (isSwitchingCards) {
        await pageStagePersistRef.current?.();
        const leavingSnapshot = pageStageSessionSnapshotRef.current;
        if (
          leavingSnapshot
          && (
            leavingSnapshot.projectId !== projectId
            || leavingSnapshot.pageId !== pageId
          )
        ) {
          recordPageLeave(leavingSnapshot);
        }
      }
      openPageStageState(projectId, pageId);
    },
    [
      pageStageState.pageId,
      pageStageState.open,
      pageStageState.projectId,
      openPageStageState,
      recordPageLeave,
    ],
  );

  const openRecentSession = useCallback(
    async (sessionId: string) => {
      const session = recentPageSessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;

      if (
        pageStageState.open
        && pageStageState.projectId === session.projectId
        && pageStageState.pageId === session.pageId
      ) {
        selectRecentPageSessionState(session.id);
        return;
      }

      selectRecentPageSessionState(session.id);
      await openPageStageSession(session.projectId, session.pageId);
    },
    [pageStageState, openPageStageSession, recentPageSessions, selectRecentPageSessionState],
  );

  const handleCloseRecentSession = useCallback(
    (sessionId: string) => {
      const closing = recentPageSessions.find((session) => session.id === sessionId);
      const nextSession = recentPageSessions.find((session) => session.id !== sessionId) ?? null;
      closeRecentPageSession(sessionId);

      if (!closing) return;
      if (!pageStageState.open) return;
      if (pageStageState.projectId !== closing.projectId) return;
      if (pageStageState.pageId !== closing.pageId) return;

      if (nextSession) {
        openPageStageState(nextSession.projectId, nextSession.pageId);
        return;
      }

      closePageStageState();
    },
    [closePageStageState, closeRecentPageSession, pageStageState, openPageStageState, recentPageSessions],
  );

  const prevActiveProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevProjectId = prevActiveProjectIdRef.current;
    if (prevProjectId && prevProjectId !== resolvedDbProjectId) {
      void pageStagePersistRef.current?.();
    }
    prevActiveProjectIdRef.current = resolvedDbProjectId;
  }, [resolvedDbProjectId]);

  const handleReminderHandled = useCallback(
    (payload: { projectId: string; pageId: string; occurrenceStart: string }) => {
      setPendingReminderOpen((current) => {
        if (!current) return null;
        if (
          current.projectId !== payload.projectId ||
          current.pageId !== payload.pageId ||
          current.occurrenceStart !== payload.occurrenceStart
        ) {
          return current;
        }
        return null;
      });
    },
    [],
  );

  const handlePageDeepLinkHandled = useCallback(
    (payload: { projectId: string; pageId: string }) => {
      setPendingDeepLinkOpen((current) => {
        if (!current) return null;
        if (
          current.projectId !== payload.projectId ||
          current.pageId !== payload.pageId
        ) {
          return current;
        }
        return null;
      });
    },
    [],
  );

  const handleOpenProjectPicker = useCallback(() => {
    setProjectPickerOpenTick((tick) => tick + 1);
  }, []);

  const focusStageWithNearestIntent = useCallback(
    (
      projectId: string,
      stageId: StageId,
      fallbackDirection?: StageNavDirection,
    ) => {
      const slidingWindowVisibleStages = resolveExpandedStages(
        focusedStage,
        stageNavDirection,
        slidingWindowPaneCount,
        false,
      );
      const { direction } = resolveSlidingWindowFocusIntent(
        stageId,
        slidingWindowVisibleStages,
        slidingWindowPaneCount,
        fallbackDirection ?? stageNavDirection,
      );
      setFocusedStageState(projectId, stageId, direction);
    },
    [
      focusedStage,
      setFocusedStageState,
      slidingWindowPaneCount,
      stageNavDirection,
    ],
  );

  const resolveNavigationStageDirection = useCallback((
    stageId: StageId,
    fallbackDirection?: StageNavDirection,
  ): StageNavDirection => {
    const slidingWindowVisibleStages = resolveExpandedStages(
      focusedStage,
      stageNavDirection,
      slidingWindowPaneCount,
      false,
    );
    const { direction } = resolveSlidingWindowFocusIntent(
      stageId,
      slidingWindowVisibleStages,
      slidingWindowPaneCount,
      fallbackDirection ?? stageNavDirection,
    );
    return direction;
  }, [focusedStage, slidingWindowPaneCount, stageNavDirection]);

  const navigateToStage = useCallback((projectId: string, stageId: StageId, fallbackDirection?: StageNavDirection) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      focusedStage: stageId,
      stageNavDirection: resolveNavigationStageDirection(stageId, fallbackDirection),
    };
    recordNavigation(nextSnapshot);
    focusStageWithNearestIntent(projectId, stageId, fallbackDirection);
  }, [focusStageWithNearestIntent, recordNavigation, resolveNavigationStageDirection]);

  const navigateToProject = useCallback((projectId: string) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      dbProjectId: projectId,
      activeView: resolveProjectView(projectId),
    };
    recordNavigation(nextSnapshot);
    setDbProjectState(projectId);
  }, [recordNavigation, resolveProjectView, setDbProjectState]);

  const navigateToProjectIndex = useCallback((index: number) => {
    const projectId = projectRefs[index]?.projectId;
    if (!projectId) return;
    navigateToProject(projectId);
  }, [navigateToProject, projectRefs]);

  const navigateToDbView = useCallback((projectId: string, view: WorkbenchView) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      dbProjectId: projectId,
      activeView: view,
      focusedStage: "db",
      stageNavDirection: resolveNavigationStageDirection("db"),
    };
    recordNavigation(nextSnapshot);
    setWorkbenchView(projectId, view);
    focusStageWithNearestIntent(projectId, "db");
  }, [focusStageWithNearestIntent, recordNavigation, resolveNavigationStageDirection, setWorkbenchView]);

  const navigateToPage = useCallback(async (
    projectId: string,
    pageId: string,
    _titleSnapshot?: string,
    options?: OpenPageStageOptions & {
      setDbProjectId?: string;
      activePagesTabId?: string;
      activeRecentSessionId?: string | null;
    },
  ) => {
    const defaultPageSelection = resolvePagesStageSelectionForPage(
      recentPageSessions,
      projectId,
      pageId,
    );
    const nextActivePagesTabId = options?.activePagesTabId ?? defaultPageSelection.activePagesTabId;
    const nextActiveRecentSessionId = options?.activeRecentSessionId !== undefined
      ? options.activeRecentSessionId
      : defaultPageSelection.activeRecentSessionId;
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      dbProjectId: options?.setDbProjectId ?? currentNavigationSnapshotRef.current.dbProjectId,
      activeView: resolveProjectView(options?.setDbProjectId ?? currentNavigationSnapshotRef.current.dbProjectId),
      pageStage: {
        open: true,
        projectId,
        pageId,
      },
      activePagesTabId: nextActivePagesTabId,
      activeRecentSessionId: nextActiveRecentSessionId,
      focusedStage: "pages",
      stageNavDirection: resolveNavigationStageDirection("pages"),
    };
    recordNavigation(nextSnapshot);
    if (options?.setDbProjectId) {
      setDbProjectState(options.setDbProjectId);
    }
    setActivePagesTabState(projectId, nextActivePagesTabId);
    setActiveRecentPageSessionState(nextActiveRecentSessionId);
    await openPageStageSession(projectId, pageId);
    focusStageWithNearestIntent(options?.setDbProjectId ?? projectId, "pages");
  }, [
    focusStageWithNearestIntent,
    openPageStageSession,
    recentPageSessions,
    recordNavigation,
    resolveNavigationStageDirection,
    resolveProjectView,
    setActivePagesTabState,
    setActiveRecentPageSessionState,
    setDbProjectState,
  ]);

  const navigateToRecentSession = useCallback(async (sessionId: string) => {
    const session = recentPageSessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      pageStage: {
        open: true,
        projectId: session.projectId,
        pageId: session.pageId,
      },
      activePagesTabId: `session:${session.id}`,
      activeRecentSessionId: session.id,
      focusedStage: "pages",
      stageNavDirection: resolveNavigationStageDirection("pages"),
    };
    recordNavigation(nextSnapshot);
    await openRecentSession(sessionId);
    focusStageWithNearestIntent(session.projectId, "pages");
  }, [focusStageWithNearestIntent, openRecentSession, recentPageSessions, recordNavigation, resolveNavigationStageDirection]);

  const navigateToPagesTab = useCallback((projectId: string, tabId: string, activeSessionId: string | null) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      activePagesTabId: tabId,
      activeRecentSessionId: activeSessionId,
    };
    recordNavigation(nextSnapshot);
    setActivePagesTabState(projectId, tabId);
    setActiveRecentPageSessionState(activeSessionId);
  }, [recordNavigation, setActivePagesTabState, setActiveRecentPageSessionState]);

  const navigateToThreadTab = useCallback((projectId: string, tabId: string, focusStage = true) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      threadsProjectId: projectId,
      activeThreadsTabId: tabId,
      focusedStage: focusStage ? "threads" : currentNavigationSnapshotRef.current.focusedStage,
      stageNavDirection: focusStage
        ? resolveNavigationStageDirection("threads")
        : currentNavigationSnapshotRef.current.stageNavDirection,
    };
    recordNavigation(nextSnapshot);
    setThreadsProjectIdState(projectId);
    setActiveThreadsTabState(projectId, tabId);
    if (focusStage) {
      focusStageWithNearestIntent(projectId, "threads");
    }
  }, [focusStageWithNearestIntent, recordNavigation, resolveNavigationStageDirection, setActiveThreadsTabState, setThreadsProjectIdState]);

  const navigateToFilesTab = useCallback((projectId: string, tabId: string) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      activeFilesTabId: tabId === "diff" ? "diff" : "diff",
      focusedStage: "files",
      stageNavDirection: resolveNavigationStageDirection("files"),
    };
    recordNavigation(nextSnapshot);
    setActiveFilesTabState(projectId, tabId);
    focusStageWithNearestIntent(projectId, "files");
  }, [focusStageWithNearestIntent, recordNavigation, resolveNavigationStageDirection, setActiveFilesTabState]);

  const requestSidebarToggle = useCallback((source: WorkbenchSidebarToggleCommandSource) => {
    const sidebarToggleHandler = sidebarToggleHandlerRef.current;
    if (sidebarToggleHandler) {
      sidebarToggleHandler(source);
      return;
    }

    setSidebarToggleRequest((current) => ({
      tick: current.tick + 1,
      source,
    }));
  }, []);

  const requestWorkbenchNavigation = useCallback((
    direction: WorkbenchNavigationDirection,
    source: WorkbenchNavigationCommandSource,
  ) => {
    setWorkbenchNavigationCommandRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      direction,
      source,
    }));
  }, []);

  const requestPanelTabCycle = useCallback((direction: WorkbenchPanelTabCycleDirection) => {
    setWorkbenchPanelTabCycleRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      direction,
      source: "menu",
    }));
  }, []);

  const requestPanelTabClose = useCallback(() => {
    setWorkbenchPanelTabCloseRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      source: "menu",
    }));
  }, []);

  const requestThreadRename = useCallback((source: WorkbenchThreadRenameCommandSource) => {
    setThreadRenameRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      source,
    }));
  }, []);

  const requestWorkbenchCommand = useCallback((
    commandId: WorkbenchCommandId,
    source: WorkbenchCommandSource,
  ) => {
    setWorkbenchCommandRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      commandId,
      source,
    }));
  }, []);

  const requestContentSearchOpen = useCallback((
    source: ContentSearchOpenSource,
    preferredDomain?: ContentSearchDomain,
  ) => {
    setContentSearchOpenRequest((current) => ({
      tick: (current?.tick ?? 0) + 1,
      source,
      preferredDomain,
    }));
  }, []);

  useEffect(() => {
    if (!window.api?.onNavigateBack) return undefined;
    return window.api.onNavigateBack(() => {
      requestWorkbenchNavigation("back", "menu");
    });
  }, [requestWorkbenchNavigation]);

  useEffect(() => {
    if (!window.api?.onNavigateForward) return undefined;
    return window.api.onNavigateForward(() => {
      requestWorkbenchNavigation("forward", "menu");
    });
  }, [requestWorkbenchNavigation]);

  useEffect(() => {
    if (!window.api?.onToggleSidebar) return undefined;
    return window.api.onToggleSidebar(() => {
      requestSidebarToggle("menu");
    });
  }, [requestSidebarToggle]);

  useEffect(() => {
    if (!window.api?.onRenameThread) return undefined;
    return window.api.onRenameThread(() => {
      requestThreadRename("menu");
    });
  }, [requestThreadRename]);

  useEffect(() => {
    if (!window.api?.onOpenContentSearch) return undefined;
    return window.api.onOpenContentSearch(() => {
      const preferredDomain: ContentSearchDomain | undefined =
        focusedStage === "threads"
          ? "conversation"
          : focusedStage === "files"
            ? "diff"
            : undefined;
      requestContentSearchOpen("menu", preferredDomain);
    });
  }, [focusedStage, requestContentSearchOpen]);

  useEffect(() => {
    if (!window.api?.onCyclePanelTabPrevious) return undefined;
    return window.api.onCyclePanelTabPrevious(() => {
      requestPanelTabCycle("previous");
    });
  }, [requestPanelTabCycle]);

  useEffect(() => {
    if (!window.api?.onCyclePanelTabNext) return undefined;
    return window.api.onCyclePanelTabNext(() => {
      requestPanelTabCycle("next");
    });
  }, [requestPanelTabCycle]);

  useEffect(() => {
    if (!window.api?.onClosePanelTab) return undefined;
    return window.api.onClosePanelTab(() => {
      requestPanelTabClose();
    });
  }, [requestPanelTabClose]);

  useEffect(() => {
    if (!window.api?.onWorkbenchCommand) return undefined;
    return window.api.onWorkbenchCommand((invocation: WorkbenchCommandInvocation) => {
      requestWorkbenchCommand(invocation.commandId, invocation.source);
    });
  }, [requestWorkbenchCommand]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.on("reminder:open", (...args: unknown[]) => {
      const payload = args[0] as {
        projectId?: unknown;
        pageId?: unknown;
        occurrenceStart?: unknown;
      } | undefined;

      if (!payload) return;
      if (
        typeof payload.projectId !== "string" ||
        typeof payload.pageId !== "string" ||
        typeof payload.occurrenceStart !== "string"
      ) {
        return;
      }

      setPendingReminderOpen({
        projectId: payload.projectId,
        pageId: payload.pageId,
        occurrenceStart: payload.occurrenceStart,
      });
      navigateToProject(payload.projectId);
    });
  }, [navigateToProject]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.on("deeplink:open-page", (...args: unknown[]) => {
      const payload = args[0] as {
        projectId?: unknown;
        pageId?: unknown;
      } | undefined;

      if (!payload) return;
      if (
        typeof payload.projectId !== "string"
        || typeof payload.pageId !== "string"
      ) {
        return;
      }

      setPendingDeepLinkOpen({
        projectId: payload.projectId,
        pageId: payload.pageId,
      });
      navigateToProject(payload.projectId);
    });
  }, [navigateToProject]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.on("deeplink:open-session", (...args: unknown[]) => {
      const payload = args[0] as {
        projectId?: unknown;
        sessionId?: unknown;
      } | undefined;

      if (!payload) return;
      if (
        (typeof payload.projectId !== "string" && payload.projectId !== null)
        || typeof payload.sessionId !== "string"
      ) {
        return;
      }

      setPendingSessionDeepLinkOpen({
        projectId: payload.projectId,
        sessionId: payload.sessionId,
      });
      if (typeof payload.projectId === "string") {
        navigateToProject(payload.projectId);
      }
    });
  }, [navigateToProject]);

  useEffect(() => {
    if (!pendingReminderOpen) return;
    if (pendingReminderOpen.projectId !== resolvedDbProjectId) return;
    if (resolvedView === "calendar") return;

    navigateToDbView(resolvedDbProjectId, "calendar");
  }, [navigateToDbView, pendingReminderOpen, resolvedDbProjectId, resolvedView]);

  useEffect(() => {
    if (!pendingSessionDeepLinkOpen) return;
    if (activeProjectSessionId !== pendingSessionDeepLinkOpen.sessionId) return;
    setPendingSessionDeepLinkOpen(null);
  }, [activeProjectSessionId, pendingSessionDeepLinkOpen]);

  const handleShortcutFocusAdjacentStage = useCallback((projectId: string, direction: -1 | 1) => {
    const currentIndex = STAGE_ORDER.indexOf(focusedStage);
    if (currentIndex < 0) return;
    const nextIndex =
      direction > 0
        ? (currentIndex + 1) % STAGE_ORDER.length
        : (currentIndex - 1 + STAGE_ORDER.length) % STAGE_ORDER.length;
    const nextStage = STAGE_ORDER[nextIndex];
    navigateToStage(projectId, nextStage, direction > 0 ? "right" : "left");
  }, [focusedStage, navigateToStage]);

  const handleShortcutShiftSlidingWindow = useCallback((projectId: string, direction: -1 | 1) => {
    const nextWindowState = resolveSlidingWindowShift(
      focusedStage,
      stageNavDirection,
      slidingWindowPaneCount,
      direction,
    );
    recordNavigation({
      ...currentNavigationSnapshotRef.current,
      focusedStage: nextWindowState.focusedStage,
      stageNavDirection: nextWindowState.stageNavDirection,
    });
    setFocusedStageState(
      projectId,
      nextWindowState.focusedStage,
      nextWindowState.stageNavDirection,
    );
  }, [
    focusedStage,
    recordNavigation,
    setFocusedStageState,
    slidingWindowPaneCount,
    stageNavDirection,
  ]);

  const handleShortcutSwitchToStageIndex = useCallback((projectId: string, index: number) => {
    if (index < 0 || index >= STAGE_ORDER.length) return;
    navigateToStage(projectId, STAGE_ORDER[index] as StageId);
  }, [navigateToStage]);

  const handleOpenTaskSearch = useCallback((projectId: string) => {
    setTaskSearchOpenTick((tick) => tick + 1);
    focusStageWithNearestIntent(projectId, "db");
  }, [focusStageWithNearestIntent]);

  const handleOpenContentSearch = useCallback((projectId: string, preferredDomain?: ContentSearchDomain) => {
    requestContentSearchOpen("keyboard_shortcut", preferredDomain);
    if (preferredDomain === "conversation") {
      focusStageWithNearestIntent(projectId, "threads");
      return;
    }
    if (preferredDomain === "diff") {
      focusStageWithNearestIntent(projectId, "files");
    }
  }, [focusStageWithNearestIntent, requestContentSearchOpen]);

  const handleToggleSettings = useCallback(() => {
    setSettingsToggleTick((tick) => tick + 1);
  }, []);

  const handleOpenKeyboardShortcutsSettings = useCallback(() => {
    setKeyboardShortcutsSettingsOpenTick((tick) => tick + 1);
  }, []);

  const flushBeforeWindowClone = useCallback(async () => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
    await pageStagePersistRef.current?.();
    await flushWindowSessionLayout();
  }, [flushWindowSessionLayout]);

  const handleRequestNewWindow = useCallback(async () => {
    await flushBeforeWindowClone();
    await invoke("window:new", {});
  }, [flushBeforeWindowClone]);

  useEffect(() => {
    if (!window.api?.onRequestNewWindow) return undefined;
    return window.api.onRequestNewWindow(() => {
      void handleRequestNewWindow();
    });
  }, [handleRequestNewWindow]);

  const handleOpenProjectSessionInNewWindow = useCallback(async (session: { id: string; projectId: string | null }) => {
    await flushBeforeWindowClone();
    await invoke("window:new", { activeProjectSessionId: session.id });
  }, [flushBeforeWindowClone]);

  const handleOpenCommandPalette = useCallback((request?: CommandMenuOpenRequest) => {
    setCommandPaletteInitialMode(request?.mode ?? "root");
    setCommandPaletteInitialQuery(request?.query ?? "");
    setCommandPaletteOpenTick((tick) => tick + 1);
  }, []);
  const commandKeymapQuery = useCommandKeymapState();

  useWorkbenchShortcuts({
    projectRefs,
    dbProjectId: resolvedDbProjectId,
    focusedStage,
    focusAdjacentStage: handleShortcutFocusAdjacentStage,
    shiftSlidingWindow: handleShortcutShiftSlidingWindow,
    switchToStageIndex: handleShortcutSwitchToStageIndex,
    switchToProjectIndex: navigateToProjectIndex,
    onRequestNewWindow: window.api?.onRequestNewWindow
      ? undefined
      : () => {
          void handleRequestNewWindow();
        },
    onRequestCommandPalette: handleOpenCommandPalette,
    onRequestProjectPicker: handleOpenProjectPicker,
    onRequestTaskSearch: handleOpenTaskSearch,
    onRequestContentSearch: handleOpenContentSearch,
    onRequestSettingsToggle: handleToggleSettings,
    onRequestKeyboardShortcuts: handleOpenKeyboardShortcutsSettings,
    navigateBack: (source) => {
      requestWorkbenchNavigation("back", source);
    },
    navigateForward: (source) => {
      requestWorkbenchNavigation("forward", source);
    },
    onToggleSidebar: requestSidebarToggle,
    onRequestRenameThread: requestThreadRename,
    onRequestWorkbenchCommand: shouldUseRendererWorkbenchCommandFallback(
      Boolean(window.api?.onWorkbenchCommand),
    )
      ? (commandId) => requestWorkbenchCommand(commandId, "keyboard_shortcut")
      : undefined,
    commandKeymapState: commandKeymapQuery.data,
  });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-(--background)">
        <div className="text-sm text-(--foreground-secondary)">Loading...</div>
      </div>
    );
  }

  if (!workbenchV2Enabled) {
    return (
      <div className="flex h-screen items-center justify-center bg-(--background) text-sm text-(--foreground-secondary)">
        workbenchV2 is disabled. Set localStorage `workbenchV2=true` to use the new shell.
      </div>
    );
  }

  return (
    <LocalConversationProvider>
      <LocalConversationViewStateCleanupController />
      <DesktopNotificationController
      activeThreadId={activeThreadsTabId}
      focusedStage={focusedStage}
      threadsProjectId={threadsProjectId}
      onOpenThread={(projectId, threadId) => {
        navigateToThreadTab(projectId, threadId);
      }}
      />
      <HeartbeatAutomationController />
      <WorkbenchShell
      windowSessionId={initialWindowSessionBootstrap.session.id}
      libraryWorkspaceEnabled={productFeatureGates.libraryWorkspace}
      projects={projects}
      hasMoreProjects={hasMoreProjects}
      loadingMoreProjects={loadingMoreProjects}
      onLoadMoreProjects={loadMoreProjects}
      projectCatalogError={projectsError}
      onRetryProjects={refreshProjects}
      dbProjectId={resolvedDbProjectId}
      threadsProjectId={threadsProjectId}
      activeView={resolvedView}
      activeSearchQuery={resolvedSearchQuery}
      initialActiveProjectSessionId={initialWindowSessionBootstrap.session.layout.activeProjectSessionId ?? null}
      onActiveProjectSessionChange={setActiveProjectSessionId}
      sessionViewsBySessionId={sessionViewsBySessionId}
      setSessionView={setSessionView}
      activeDbViewPrefs={activeDbViewPrefs}
      searchByProject={searchByProject}
      dbViewPrefsByProject={dbViewPrefsByProject}
      projectRefs={projectRefs}
      recentPageSessions={recentPageSessions}
      activeRecentSessionId={activeRecentSessionId}
      sidebar={sidebar}
      stageNavDirection={stageNavDirection}
      pagesTabs={pagesTabs}
      activePagesTabId={activePagesTabId}
      threadsTabs={threadsTabs}
      activeThreadsTabId={activeThreadsTabId}
      filesTabs={filesTabs}
      activeFilesTabId={activeFilesTabId}
      stagePanelWidths={stagePanelWidths}
      slidingWindowPaneCount={slidingWindowPaneCount}
      pageStageState={pageStageState}
      pageStagePageId={pageStageState.projectId === resolvedDbProjectId ? pageStagePageId : undefined}
      pageStageCloseRef={pageStageCloseRef}
      pageStagePersistRef={pageStagePersistRef}
      pendingReminderOpen={pendingReminderOpen}
      pendingPageDeepLinkOpen={pendingDeepLinkOpen}
      pendingSessionOpen={pendingSessionDeepLinkOpen}
      onReminderHandled={handleReminderHandled}
      onPageDeepLinkHandled={handlePageDeepLinkHandled}
      onOpenProjectSessionInNewWindow={handleOpenProjectSessionInNewWindow}
      openPageStage={navigateToPage}
      setDbProject={setDbProjectState}
      setSearchQuery={setSearchQuery}
      setDbViewPrefs={setDbViewPrefs}
      setSidebarCollapsed={setSidebarCollapsed}
      setSidebarWidth={setSidebarWidth}
      setSidebarCollapsibleSectionCollapsed={setSidebarCollapsibleSectionCollapsed}
      setSidebarStageExpanded={setSidebarStageExpanded}
      isSidebarStageExpanded={isSidebarStageExpanded}
      setSidebarSectionExpanded={setSidebarSectionExpanded}
      isSidebarSectionExpanded={isSidebarSectionExpanded}
      setSidebarSectionShowAll={setSidebarSectionShowAll}
      isSidebarSectionShowAll={isSidebarSectionShowAll}
      setActiveThreadsTab={setActiveThreadsTabState}
      setThreadsTabs={setThreadsTabs}
      setStagePanelWidths={setStagePanelWidths}
      stepSlidingWindowPaneCount={stepSlidingWindowPaneCount}
      closeRecentPageSession={handleCloseRecentSession}
      reorderRecentPageSessions={reorderRecentPageSessions}
      closePageStage={closePageStageState}
      onLeavePageStage={recordPageLeave}
      pageStageSessionSnapshotRef={pageStageSessionSnapshotRef}
      navigationCommandRequest={workbenchNavigationCommandRequest}
      panelTabCycleRequest={workbenchPanelTabCycleRequest}
      panelTabCloseRequest={workbenchPanelTabCloseRequest}
      threadRenameRequest={threadRenameRequest}
      workbenchCommandRequest={workbenchCommandRequest}
      onRequestProjectPickerOpen={handleOpenProjectPicker}
      projectPickerOpenTick={projectPickerOpenTick}
      taskSearchOpenTick={taskSearchOpenTick}
      threadSearchOpenTick={0}
      diffSearchOpenTick={0}
      contentSearchOpenRequest={contentSearchOpenRequest}
      onRequestContentSearchOpen={(preferredDomain, source) => {
        requestContentSearchOpen(source, preferredDomain);
      }}
      commandPaletteOpenTick={commandPaletteOpenTick}
      commandPaletteInitialMode={commandPaletteInitialMode}
      commandPaletteInitialQuery={commandPaletteInitialQuery}
      settingsToggleTick={settingsToggleTick}
      keyboardShortcutsSettingsOpenTick={keyboardShortcutsSettingsOpenTick}
      sidebarToggleRequestTick={sidebarToggleRequest.tick}
      sidebarToggleRequestSource={sidebarToggleRequest.source}
      onRegisterSidebarToggleHandler={(handler) => {
        sidebarToggleHandlerRef.current = handler;
        return () => {
          if (sidebarToggleHandlerRef.current !== handler) return;
          sidebarToggleHandlerRef.current = null;
        };
      }}
      onCreateProject={handleCreateProject}
      onArchiveProject={handleArchiveProject}
      onUpdateProject={handleUpdateProject}
      onReorderProjects={handleReorderProjects}
      onSetProjectPinned={handleSetProjectPinned}
      onSetPinnedProjectOrder={handleSetPinnedProjectOrder}
      navigateToRecentSession={navigateToRecentSession}
      navigateToPagesTab={navigateToPagesTab}
      navigateToThreadTab={navigateToThreadTab}
      navigateToFilesTab={navigateToFilesTab}
      commandKeymapState={commandKeymapQuery.data}
      />
      <NodexModalHost />
    </LocalConversationProvider>
  );
}

export default function App() {
  const [bootstrapState, setBootstrapState] = useState<{
    failed: boolean;
    ready: boolean;
    windowSession: WindowSessionBootstrap | null;
    productFeatureGates: ProductFeatureGates;
    step: AppInitializationStep;
  }>({
    failed: false,
    ready: false,
    windowSession: null,
    productFeatureGates: DEFAULT_PRODUCT_FEATURE_GATES,
    step: { phase: "opening" },
  });

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    if (window.api?.onInitializationStep) {
      unsubscribers.push(
        window.api.onInitializationStep((step) => {
          if (cancelled) return;
          setBootstrapState((current) => ({ ...current, step }));
        }),
      );
    }

    const loadBootstrap = () => Promise.all([
      bootstrapWindowSession(),
      loadProductFeatureGates(),
    ] as const);
    const bootstrapPromise = window.api?.awaitInitialization
      ? window.api.awaitInitialization().then(loadBootstrap)
      : loadBootstrap();

    void bootstrapPromise
      .then(([windowSession, productFeatureGates]) => {
        if (cancelled) return;
        window.api?.reportInitializationReady?.({
          durationMs: performance.now() - rendererBootstrapStartedAt,
          outcome: "ready",
        });
        setBootstrapState({
          failed: false,
          ready: true,
          windowSession,
          productFeatureGates,
          step: { phase: "done" },
        });
      })
      .catch(() => {
        if (cancelled) return;
        window.api?.reportInitializationReady?.({
          durationMs: performance.now() - rendererBootstrapStartedAt,
          outcome: "failed",
        });
        setBootstrapState({
          failed: true,
          ready: false,
          windowSession: null,
          productFeatureGates: DEFAULT_PRODUCT_FEATURE_GATES,
          step: { phase: "failed" },
        });
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  if (!bootstrapState.ready || bootstrapState.failed) {
    return (
      <NodexToastProvider>
        <AppStartupScreen step={bootstrapState.step} />
      </NodexToastProvider>
    );
  }

  return (
    <NodexToastProvider>
      {bootstrapState.windowSession ? (
        <WorkbenchApp
          initialWindowSessionBootstrap={bootstrapState.windowSession}
          productFeatureGates={bootstrapState.productFeatureGates}
        />
      ) : (
        <AppStartupScreen step={{ phase: "failed" }} />
      )}
    </NodexToastProvider>
  );
}
