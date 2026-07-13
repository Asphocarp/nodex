import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchShell } from "@/components/workbench/workbench-shell";
import { LocalConversationProvider } from "@/features/local-conversation";
import { DesktopNotificationController } from "@/features/local-conversation/desktop-notification-controller";
import { HeartbeatAutomationController } from "@/features/local-conversation/heartbeat-automation-controller";
import type {
  ContentSearchDomain,
  ContentSearchOpenRequest,
  ContentSearchOpenSource,
} from "@/features/content-search/content-search-context";
import { useProjects } from "@/lib/use-projects";
import {
  resolveCardsStageSelectionForCard,
  resolveSlidingWindowFocusIntent,
  resolveExpandedStages,
  resolveSlidingWindowShift,
  STAGE_ORDER,
  useWorkbenchState,
  type StageId,
  type StageNavDirection,
  type WorkbenchView,
} from "@/lib/use-workbench-state";
import { useCardStageState } from "@/lib/use-card-stage";
import { useWorkbenchShortcuts } from "@/lib/use-workbench-shortcuts";
import { useCommandKeymapState } from "@/lib/use-command-keymap-state";
import type { CommandMenuMode, CommandMenuOpenRequest } from "@/lib/command-palette";
import { invoke } from "@/lib/api";
import { registerAppCloseFlushHandler } from "@/lib/app-close-flush";
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
import { AppStartupScreen } from "@/components/app-startup-screen";
import { NodexToastProvider } from "@/components/ui/toast";
import type { OpenCardStageOptions } from "@/components/kanban/open-card-stage";
import type { CardStageSessionSnapshot } from "@/components/kanban/card-stage/types";
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
import type {
  AppInitializationStep,
  DatabaseMigrationProgress,
} from "../shared/app-startup";
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

function readWorkbenchV2Flag(): boolean {
  try {
    return localStorage.getItem(WORKBENCH_V2_FLAG_KEY) !== "false";
  } catch {
    return true;
  }
}

function findProjectById(projects: readonly Project[], projectId: string): Project | null {
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

function replaceProjectQueryParam(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("project") === projectId) return;
    url.searchParams.set("project", projectId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore URL replacement failures; state reconciliation still selects the canonical project.
  }
}

function WorkbenchApp({ initialWindowSessionBootstrap }: { initialWindowSessionBootstrap: WindowSessionBootstrap }) {
  const workbenchV2Enabled = readWorkbenchV2Flag();
  const {
    projects,
    loading,
    createProject,
    deleteProject,
    updateProject,
    reorderProjects,
    setProjectPinned,
    setPinnedProjectOrder,
    refresh,
  } = useProjects();
  const {
    dbProjectId,
    threadsProjectId,
    spaces,
    activeView,
    activeSearchQuery,
    activeDbViewPrefs,
    viewsByProject,
    searchByProject,
    dbViewPrefsByProject,
    sidebar,
    focusedStage,
    stageNavDirection,
    cardsTabs,
    activeCardsTabId,
    threadsTabs,
    activeThreadsTabId,
    filesTabs,
    activeFilesTabId,
    stagePanelWidths,
    slidingWindowPaneCount,
    recentCardSessions,
    activeRecentSessionId,
    setDbProject: setDbProjectState,
    setThreadsProjectId: setThreadsProjectIdState,
    setView: setWorkbenchView,
    setSearchQuery,
    setDbViewPrefs,
    setSidebarCollapsed,
    setSidebarWidth,
    setSidebarPinnedOrganizationMode,
    setSidebarTopLevelSectionVisible,
    setSidebarTopLevelSectionItemLimit,
    setSidebarCollapsibleSectionCollapsed,
    moveSidebarTopLevelSectionBy,
    setFocusedStage: setFocusedStageState,
    setSidebarStageExpanded,
    isSidebarStageExpanded,
    setSidebarSectionExpanded,
    isSidebarSectionExpanded,
    setSidebarSectionShowAll,
    isSidebarSectionShowAll,
    setActiveCardsTab: setActiveCardsTabState,
    setActiveThreadsTab: setActiveThreadsTabState,
    setThreadsTabs,
    setActiveFilesTab: setActiveFilesTabState,
    setStagePanelWidths,
    stepSlidingWindowPaneCount,
    recordRecentCardLeave,
    selectRecentCardSession: selectRecentCardSessionState,
    setActiveRecentCardSession: setActiveRecentCardSessionState,
    closeRecentCardSession,
    reorderRecentCardSessions,
    buildLayoutSnapshot,
  } = useWorkbenchState(projects, {
    initialLayoutSnapshot: initialWindowSessionBootstrap.session.layout,
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
  const [settingsToggleTick, setSettingsToggleTick] = useState(0);
  const [keyboardShortcutsSettingsOpenTick, setKeyboardShortcutsSettingsOpenTick] = useState(0);
  const [activeProjectSessionId, setActiveProjectSessionId] = useState<string | null>(
    initialWindowSessionBootstrap.session.layout.activeProjectSessionId ?? null,
  );

  const {
    state: cardStageState,
    openCardStage: openCardStageState,
    closeCardStage: closeCardStageState,
    cardStageCardId,
  } = useCardStageState(initialWindowSessionBootstrap.session.layout.cardStage ?? null);
  const cardStageCloseRef = useRef<(() => Promise<void>) | null>(null);
  const cardStagePersistRef = useRef<(() => Promise<void>) | null>(null);
  const cardStageSessionSnapshotRef = useRef<CardStageSessionSnapshot | null>(null);

  const [pendingReminderOpen, setPendingReminderOpen] = useState<{
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null>(null);
  const [pendingDeepLinkOpen, setPendingDeepLinkOpen] = useState<{
    projectId: string;
    cardId: string;
  } | null>(null);
  const [pendingSessionDeepLinkOpen, setPendingSessionDeepLinkOpen] = useState<{
    projectId: string | null;
    sessionId: string;
  } | null>(null);
  const cardStageStateRef = useRef(cardStageState);
  const resumeValidationStartedRef = useRef(false);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>(() => readNavigationHistoryState());
  const latestLayoutRef = useRef<WorkbenchLayoutSnapshot>(
    initialWindowSessionBootstrap.session.layout,
  );
  const layoutSaveTimerRef = useRef<number | null>(null);
  const reconciledProjectQueryRef = useRef<string | null>(null);

  useEffect(() => {
    cardStageStateRef.current = cardStageState;
  }, [cardStageState]);

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
    () => buildLayoutSnapshot(cardStageState, activeProjectSessionId),
    [activeProjectSessionId, buildLayoutSnapshot, cardStageState],
  );

  useEffect(() => {
    latestLayoutRef.current = currentLayout;
  }, [currentLayout]);

  const flushWindowSessionLayout = useCallback(async () => {
    await saveWindowSessionLayout(latestLayoutRef.current);
  }, []);

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
    if (project) return project.id;
    return projects[0]?.id ?? "default";
  }, [dbProjectId, projects]);

  const resolvedView = useMemo<WorkbenchView>(
    () => viewsByProject[resolvedDbProjectId] ?? activeView,
    [viewsByProject, resolvedDbProjectId, activeView],
  );

  const resolvedSearchQuery = useMemo(
    () => searchByProject[resolvedDbProjectId] ?? activeSearchQuery,
    [searchByProject, resolvedDbProjectId, activeSearchQuery],
  );
  const currentNavigationSnapshot = useMemo<NavigationSnapshot>(() => ({
    dbProjectId: resolvedDbProjectId,
    activeView: resolvedView,
    focusedStage,
    stageNavDirection,
    cardStage: cardStageState,
    activeCardsTabId,
    activeRecentSessionId,
    threadsProjectId,
    activeThreadsTabId,
    activeFilesTabId,
  }), [
    activeCardsTabId,
    activeFilesTabId,
    activeRecentSessionId,
    activeThreadsTabId,
    cardStageState,
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

  const resolveProjectView = useCallback((projectId: string): WorkbenchView => {
    return viewsByProject[projectId] ?? "kanban";
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
      await cardStagePersistRef.current?.();
      await flushWindowSessionLayout();
    });
  }, [
    flushWindowSessionLayout,
  ]);

  useEffect(() => {
    if (loading) return;
    if (resumeValidationStartedRef.current) return;
    resumeValidationStartedRef.current = true;
    const initialLayout = initialWindowSessionBootstrap.session.layout;

    let cancelled = false;
    void (async () => {
      const invalidRecentSessionIds = await Promise.all(
        initialLayout.recentCardSessions.slice(0, 10).map(async (session) => {
          try {
            const result = await invoke("card:get", session.projectId, session.cardId);
            return !result.ok && result.error.code === "card_not_found"
              ? session.id
              : null;
          } catch {
            return null;
          }
        }),
      );

      let activeCardMissing = false;
      if (initialLayout.cardStage.open && initialLayout.cardStage.cardId) {
        try {
          const result = await invoke(
            "card:get",
            initialLayout.cardStage.projectId,
            initialLayout.cardStage.cardId,
          );
          activeCardMissing =
            !result.ok && result.error.code === "card_not_found";
        } catch {
          activeCardMissing = false;
        }
      }

      if (cancelled) return;

      invalidRecentSessionIds
        .filter((sessionId): sessionId is string => typeof sessionId === "string")
        .forEach((sessionId) => {
          closeRecentCardSession(sessionId);
        });

      if (!activeCardMissing) return;

      const matchingSession = initialLayout.recentCardSessions.find((session) =>
        session.projectId === initialLayout.cardStage.projectId
        && session.cardId === initialLayout.cardStage.cardId
      );
      if (matchingSession) {
        closeRecentCardSession(matchingSession.id);
      }

      const currentCardStageState = cardStageStateRef.current;
      if (
        currentCardStageState.open
        && currentCardStageState.projectId === initialLayout.cardStage.projectId
        && currentCardStageState.cardId === initialLayout.cardStage.cardId
      ) {
        closeCardStageState();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [closeCardStageState, closeRecentCardSession, initialWindowSessionBootstrap.session.layout, loading]);

  const handleCreateProject = useCallback(
    async (input: ProjectCreateInput) => {
      const result = await createProject(input);
      if (result) await refresh();
      return result;
    },
    [createProject, refresh],
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      const success = await deleteProject(projectId);
      if (success) await refresh();
      return success;
    },
    [deleteProject, refresh],
  );

  const handleUpdateProject = useCallback(
    async (projectId: string, updates: ProjectUpdateInput) => {
      const result = await updateProject(projectId, updates);
      if (result) await refresh();
      return result;
    },
    [refresh, updateProject],
  );

  const handleReorderProjects = useCallback(
    async (input: ProjectOrderInput) => {
      const result = await reorderProjects(input);
      await refresh();
      return result;
    },
    [refresh, reorderProjects],
  );

  const handleSetProjectPinned = useCallback(
    async (projectId: string, input: ProjectPinnedInput) => {
      const result = await setProjectPinned(projectId, input);
      await refresh();
      return result;
    },
    [refresh, setProjectPinned],
  );

  const handleSetPinnedProjectOrder = useCallback(
    async (input: ProjectPinnedOrderInput) => {
      const result = await setPinnedProjectOrder(input);
      await refresh();
      return result;
    },
    [refresh, setPinnedProjectOrder],
  );

  const recordCardLeave = useCallback((snapshot: CardStageSessionSnapshot) => {
    recordRecentCardLeave(snapshot.projectId, snapshot.cardId, snapshot.titleSnapshot);
  }, [recordRecentCardLeave]);

  const openCardStageSession = useCallback(
    async (projectId: string, cardId: string) => {
      const isSwitchingCards =
        cardStageState.open
        && (
          cardStageState.projectId !== projectId
          || cardStageState.cardId !== cardId
        );

      if (isSwitchingCards) {
        await cardStagePersistRef.current?.();
        const leavingSnapshot = cardStageSessionSnapshotRef.current;
        if (
          leavingSnapshot
          && (
            leavingSnapshot.projectId !== projectId
            || leavingSnapshot.cardId !== cardId
          )
        ) {
          recordCardLeave(leavingSnapshot);
        }
      }
      openCardStageState(projectId, cardId);
    },
    [
      cardStageState.cardId,
      cardStageState.open,
      cardStageState.projectId,
      openCardStageState,
      recordCardLeave,
    ],
  );

  const openRecentSession = useCallback(
    async (sessionId: string) => {
      const session = recentCardSessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;

      if (
        cardStageState.open
        && cardStageState.projectId === session.projectId
        && cardStageState.cardId === session.cardId
      ) {
        selectRecentCardSessionState(session.id);
        return;
      }

      selectRecentCardSessionState(session.id);
      await openCardStageSession(session.projectId, session.cardId);
    },
    [cardStageState, openCardStageSession, recentCardSessions, selectRecentCardSessionState],
  );

  const handleCloseRecentSession = useCallback(
    (sessionId: string) => {
      const closing = recentCardSessions.find((session) => session.id === sessionId);
      const nextSession = recentCardSessions.find((session) => session.id !== sessionId) ?? null;
      closeRecentCardSession(sessionId);

      if (!closing) return;
      if (!cardStageState.open) return;
      if (cardStageState.projectId !== closing.projectId) return;
      if (cardStageState.cardId !== closing.cardId) return;

      if (nextSession) {
        openCardStageState(nextSession.projectId, nextSession.cardId);
        return;
      }

      closeCardStageState();
    },
    [closeCardStageState, closeRecentCardSession, cardStageState, openCardStageState, recentCardSessions],
  );

  const prevActiveProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevProjectId = prevActiveProjectIdRef.current;
    if (prevProjectId && prevProjectId !== resolvedDbProjectId) {
      void cardStagePersistRef.current?.();
    }
    prevActiveProjectIdRef.current = resolvedDbProjectId;
  }, [resolvedDbProjectId]);

  const handleReminderHandled = useCallback(
    (payload: { projectId: string; cardId: string; occurrenceStart: string }) => {
      setPendingReminderOpen((current) => {
        if (!current) return null;
        if (
          current.projectId !== payload.projectId ||
          current.cardId !== payload.cardId ||
          current.occurrenceStart !== payload.occurrenceStart
        ) {
          return current;
        }
        return null;
      });
    },
    [],
  );

  const handleCardDeepLinkHandled = useCallback(
    (payload: { projectId: string; cardId: string }) => {
      setPendingDeepLinkOpen((current) => {
        if (!current) return null;
        if (
          current.projectId !== payload.projectId ||
          current.cardId !== payload.cardId
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
    const projectId = spaces[index]?.projectId;
    if (!projectId) return;
    navigateToProject(projectId);
  }, [navigateToProject, spaces]);

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

  const navigateToCard = useCallback(async (
    projectId: string,
    cardId: string,
    _titleSnapshot?: string,
    options?: OpenCardStageOptions & {
      setDbProjectId?: string;
      activeCardsTabId?: string;
      activeRecentSessionId?: string | null;
    },
  ) => {
    const defaultCardsSelection = resolveCardsStageSelectionForCard(
      recentCardSessions,
      projectId,
      cardId,
    );
    const nextActiveCardsTabId = options?.activeCardsTabId ?? defaultCardsSelection.activeCardsTabId;
    const nextActiveRecentSessionId = options?.activeRecentSessionId !== undefined
      ? options.activeRecentSessionId
      : defaultCardsSelection.activeRecentSessionId;
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      dbProjectId: options?.setDbProjectId ?? currentNavigationSnapshotRef.current.dbProjectId,
      activeView: resolveProjectView(options?.setDbProjectId ?? currentNavigationSnapshotRef.current.dbProjectId),
      cardStage: {
        open: true,
        projectId,
        cardId,
      },
      activeCardsTabId: nextActiveCardsTabId,
      activeRecentSessionId: nextActiveRecentSessionId,
      focusedStage: "cards",
      stageNavDirection: resolveNavigationStageDirection("cards"),
    };
    recordNavigation(nextSnapshot);
    if (options?.setDbProjectId) {
      setDbProjectState(options.setDbProjectId);
    }
    setActiveCardsTabState(projectId, nextActiveCardsTabId);
    setActiveRecentCardSessionState(nextActiveRecentSessionId);
    await openCardStageSession(projectId, cardId);
    focusStageWithNearestIntent(options?.setDbProjectId ?? projectId, "cards");
  }, [
    focusStageWithNearestIntent,
    openCardStageSession,
    recentCardSessions,
    recordNavigation,
    resolveNavigationStageDirection,
    resolveProjectView,
    setActiveCardsTabState,
    setActiveRecentCardSessionState,
    setDbProjectState,
  ]);

  const navigateToRecentSession = useCallback(async (sessionId: string) => {
    const session = recentCardSessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      cardStage: {
        open: true,
        projectId: session.projectId,
        cardId: session.cardId,
      },
      activeCardsTabId: `session:${session.id}`,
      activeRecentSessionId: session.id,
      focusedStage: "cards",
      stageNavDirection: resolveNavigationStageDirection("cards"),
    };
    recordNavigation(nextSnapshot);
    await openRecentSession(sessionId);
    focusStageWithNearestIntent(session.projectId, "cards");
  }, [focusStageWithNearestIntent, openRecentSession, recentCardSessions, recordNavigation, resolveNavigationStageDirection]);

  const navigateToCardsTab = useCallback((projectId: string, tabId: string, activeSessionId: string | null) => {
    const nextSnapshot: NavigationSnapshot = {
      ...currentNavigationSnapshotRef.current,
      activeCardsTabId: tabId,
      activeRecentSessionId: activeSessionId,
    };
    recordNavigation(nextSnapshot);
    setActiveCardsTabState(projectId, tabId);
    setActiveRecentCardSessionState(activeSessionId);
  }, [recordNavigation, setActiveCardsTabState, setActiveRecentCardSessionState]);

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
    if (!window.api) return;
    return window.api.on("reminder:open", (...args: unknown[]) => {
      const payload = args[0] as {
        projectId?: unknown;
        cardId?: unknown;
        occurrenceStart?: unknown;
      } | undefined;

      if (!payload) return;
      if (
        typeof payload.projectId !== "string" ||
        typeof payload.cardId !== "string" ||
        typeof payload.occurrenceStart !== "string"
      ) {
        return;
      }

      setPendingReminderOpen({
        projectId: payload.projectId,
        cardId: payload.cardId,
        occurrenceStart: payload.occurrenceStart,
      });
      navigateToProject(payload.projectId);
    });
  }, [navigateToProject]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.on("deeplink:open-card", (...args: unknown[]) => {
      const payload = args[0] as {
        projectId?: unknown;
        cardId?: unknown;
      } | undefined;

      if (!payload) return;
      if (
        typeof payload.projectId !== "string"
        || typeof payload.cardId !== "string"
      ) {
        return;
      }

      setPendingDeepLinkOpen({
        projectId: payload.projectId,
        cardId: payload.cardId,
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
    navigateToStage,
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

  const handleRequestNewWindow = useCallback(async () => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
    await cardStagePersistRef.current?.();
    await flushWindowSessionLayout();
    await invoke("window:new", {
      layout: latestLayoutRef.current,
    });
  }, [flushWindowSessionLayout]);

  const handleOpenProjectSessionInNewWindow = useCallback(async (session: { id: string; projectId: string | null }) => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
    await cardStagePersistRef.current?.();
    await flushWindowSessionLayout();
    await invoke("window:new", {
      layout: {
        ...latestLayoutRef.current,
        ...(session.projectId === null ? {} : { dbProjectId: session.projectId }),
        activeProjectSessionId: session.id,
      },
    });
  }, [flushWindowSessionLayout]);

  const handleOpenCommandPalette = useCallback((request?: CommandMenuOpenRequest) => {
    setCommandPaletteInitialMode(request?.mode ?? "root");
    setCommandPaletteInitialQuery(request?.query ?? "");
    setCommandPaletteOpenTick((tick) => tick + 1);
  }, []);
  const commandKeymapQuery = useCommandKeymapState();

  useWorkbenchShortcuts({
    spaces,
    dbProjectId: resolvedDbProjectId,
    focusedStage,
    focusAdjacentStage: handleShortcutFocusAdjacentStage,
    shiftSlidingWindow: handleShortcutShiftSlidingWindow,
    switchToStageIndex: handleShortcutSwitchToStageIndex,
    switchToProjectIndex: navigateToProjectIndex,
    onRequestNewWindow: () => {
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

  if (projects.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-(--background)">
        <div className="text-sm text-(--foreground-secondary)">No projects found.</div>
      </div>
    );
  }

  return (
    <LocalConversationProvider>
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
      projects={projects}
      dbProjectId={resolvedDbProjectId}
      threadsProjectId={threadsProjectId}
      activeView={resolvedView}
      activeSearchQuery={resolvedSearchQuery}
      initialActiveProjectSessionId={initialWindowSessionBootstrap.session.layout.activeProjectSessionId ?? null}
      onActiveProjectSessionChange={setActiveProjectSessionId}
      activeDbViewPrefs={activeDbViewPrefs}
      searchByProject={searchByProject}
      dbViewPrefsByProject={dbViewPrefsByProject}
      spaces={spaces}
      recentCardSessions={recentCardSessions}
      activeRecentSessionId={activeRecentSessionId}
      sidebar={sidebar}
      stageNavDirection={stageNavDirection}
      cardsTabs={cardsTabs}
      activeCardsTabId={activeCardsTabId}
      threadsTabs={threadsTabs}
      activeThreadsTabId={activeThreadsTabId}
      filesTabs={filesTabs}
      activeFilesTabId={activeFilesTabId}
      stagePanelWidths={stagePanelWidths}
      slidingWindowPaneCount={slidingWindowPaneCount}
      cardStageState={cardStageState}
      cardStageCardId={cardStageState.projectId === resolvedDbProjectId ? cardStageCardId : undefined}
      cardStageCloseRef={cardStageCloseRef}
      cardStagePersistRef={cardStagePersistRef}
      pendingReminderOpen={pendingReminderOpen}
      pendingCardDeepLinkOpen={pendingDeepLinkOpen}
      pendingSessionOpen={pendingSessionDeepLinkOpen}
      onReminderHandled={handleReminderHandled}
      onCardDeepLinkHandled={handleCardDeepLinkHandled}
      onOpenProjectSessionInNewWindow={handleOpenProjectSessionInNewWindow}
      openCardStage={navigateToCard}
      setDbProject={setDbProjectState}
      setSearchQuery={setSearchQuery}
      setDbViewPrefs={setDbViewPrefs}
      setSidebarCollapsed={setSidebarCollapsed}
      setSidebarWidth={setSidebarWidth}
      setSidebarPinnedOrganizationMode={setSidebarPinnedOrganizationMode}
      setSidebarTopLevelSectionVisible={setSidebarTopLevelSectionVisible}
      setSidebarTopLevelSectionItemLimit={setSidebarTopLevelSectionItemLimit}
      setSidebarCollapsibleSectionCollapsed={setSidebarCollapsibleSectionCollapsed}
      moveSidebarTopLevelSectionBy={moveSidebarTopLevelSectionBy}
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
      closeRecentCardSession={handleCloseRecentSession}
      reorderRecentCardSessions={reorderRecentCardSessions}
      closeCardStage={closeCardStageState}
      onLeaveCardStageCard={recordCardLeave}
      cardStageSessionSnapshotRef={cardStageSessionSnapshotRef}
      navigationCommandRequest={workbenchNavigationCommandRequest}
      panelTabCycleRequest={workbenchPanelTabCycleRequest}
      panelTabCloseRequest={workbenchPanelTabCloseRequest}
      threadRenameRequest={threadRenameRequest}
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
      onDeleteProject={handleDeleteProject}
      onUpdateProject={handleUpdateProject}
      onReorderProjects={handleReorderProjects}
      onSetProjectPinned={handleSetProjectPinned}
      onSetPinnedProjectOrder={handleSetPinnedProjectOrder}
      navigateToRecentSession={navigateToRecentSession}
      navigateToCardsTab={navigateToCardsTab}
      navigateToThreadTab={navigateToThreadTab}
      navigateToFilesTab={navigateToFilesTab}
      commandKeymapState={commandKeymapQuery.data}
      />
    </LocalConversationProvider>
  );
}

export default function App() {
  const [bootstrapState, setBootstrapState] = useState<{
    ready: boolean;
    windowSession: WindowSessionBootstrap | null;
    step: AppInitializationStep;
    migrationProgress: DatabaseMigrationProgress | null;
  }>({
    ready: false,
    windowSession: null,
    step: { phase: "app_waiting" },
    migrationProgress: null,
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

    if (window.api?.onDatabaseMigrationProgress) {
      unsubscribers.push(
        window.api.onDatabaseMigrationProgress((migrationProgress) => {
          if (cancelled) return;
          setBootstrapState((current) => ({ ...current, migrationProgress }));
        }),
      );
    }

    const bootstrapPromise = window.api?.awaitInitialization
      ? window.api.awaitInitialization().then(() => bootstrapWindowSession())
      : bootstrapWindowSession();

    void bootstrapPromise
      .then((windowSession) => {
        if (cancelled) return;
        setBootstrapState({
          ready: true,
          windowSession,
          step: { phase: "done" },
          migrationProgress: { type: "Done" },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBootstrapState({
          ready: true,
          windowSession: null,
          step: { phase: "done" },
          migrationProgress: { type: "Done" },
        });
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  if (!bootstrapState.ready) {
    return (
      <NodexToastProvider>
        <AppStartupScreen
          step={bootstrapState.step}
          migrationProgress={bootstrapState.migrationProgress}
        />
      </NodexToastProvider>
    );
  }

  return (
    <NodexToastProvider>
      {bootstrapState.windowSession ? (
        <WorkbenchApp initialWindowSessionBootstrap={bootstrapState.windowSession} />
      ) : (
        <AppStartupScreen
          step={{ phase: "done" }}
          migrationProgress={{ type: "Done" }}
        />
      )}
    </NodexToastProvider>
  );
}
