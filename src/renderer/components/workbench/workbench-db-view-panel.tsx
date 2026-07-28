import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import {
  CalendarDays,
  Database,
  PenLine,
  SquareKanban,
  Table2,
} from "lucide-react";
import {
  CalendarToolbarControls,
  CalendarToolbarMonthLabel,
} from "@/components/kanban/calendar/calendar-toolbar";
import { NodexIconButton } from "@/components/ui/button";
import type { CalendarRangeState } from "@/lib/calendar-range";
import { resolveCalendarVisibleDayCount } from "@/lib/calendar-range";
import {
  loadCalendarViewState,
  normalizeCalendarAnchorDate,
  resolveCalendarVisibleDays,
  saveCalendarViewState,
  shiftCalendarAnchorDateByDays,
  type CalendarViewState,
} from "@/lib/calendar-view-state";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import type {
  Project,
  ProjectSessionDbView,
  WorkbenchTabProjection,
} from "@/lib/types";
import { useKanban } from "@/lib/use-kanban";
import type { WorkbenchView } from "@/lib/use-workbench-profile-preferences";
import { applyWorkbenchViewTabPatch } from "@/lib/window-session-view-adapter";
import { DatabaseManagementDialogController } from "./database-management-dialog-controller";
import { DbViewToolbar } from "./db-view-toolbar";
import { MainViewHost } from "./main-view-host";
import { ToggleListIcon } from "./toggle-list-icon";
import type { OpenPageTabHandler } from "./workbench-page-stage-panel";

const DB_VIEW_TABS: Array<{
  id: ProjectSessionDbView;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "kanban", label: "Board", icon: SquareKanban },
  { id: "list", label: "Table", icon: Table2 },
  { id: "toggle-list", label: "List", icon: ToggleListIcon },
  { id: "canvas", label: "Canvas", icon: PenLine },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

export function DbViewSessionTab({
  sessionId,
  tab,
  projects,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  activePanelPageStagePageIdsByProject,
  pageStageCloseRef,
  pendingReminderOpen,
  taskSearchOpenTick,
  setSearchQuery,
  setDbViewPrefs,
  onReminderHandled,
  onOpenPageTab,
  onUpdateTab,
}: {
  sessionId: string;
  tab: WorkbenchTabProjection;
  projects: Project[];
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<
    string,
    Partial<Record<SupportedDbView, DbViewPrefs>>
  >;
  activePanelPageStagePageIdsByProject: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  pageStageCloseRef: RefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  } | null;
  taskSearchOpenTick: number;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  }) => void;
  onOpenPageTab: OpenPageTabHandler;
  onUpdateTab: (
    tabId: string,
    patch: Parameters<typeof applyWorkbenchViewTabPatch>[1],
  ) => WorkbenchTabProjection | null;
}) {
  if (tab.kind !== "db_view") {
    throw new Error("Database view tabs require a db_view descriptor");
  }
  const config = tab.config;
  const projectId = config.projectId;
  const selectedDatabaseViewId = config.databaseViewId;
  const view = config.view;
  const legacyRulesView = viewSupportsDbViewPrefs(view) ? view : null;
  const legacyDbViewPrefs = legacyRulesView
    ? dbViewPrefsByProject[projectId]?.[legacyRulesView]
      ?? (
        projectId === tab.projectId && view === activeView
          ? activeDbViewPrefs
          : null
      )
      ?? getDefaultDbViewPrefs(legacyRulesView)
    : null;
  const selectedDatabaseView = useKanban({
    projectId,
    databaseViewId: selectedDatabaseViewId,
    sessionId: `${tab.id}:toolbar`,
  });
  const activeProjectBoard = selectedDatabaseView.board;
  const databaseView = selectedDatabaseView.databaseView;
  const selectedGeneralView = Boolean(
    databaseView && !databaseView.primaryWriteCompatible,
  );
  const renderedView: ProjectSessionDbView = selectedGeneralView && databaseView
    ? databaseView.query.view.kind
    : view;
  const rulesView = selectedGeneralView ? null : legacyRulesView;
  const dbViewPrefs = selectedGeneralView ? null : legacyDbViewPrefs;
  const [calendarState, setCalendarState] = useState<CalendarViewState>(
    () => loadCalendarViewState(),
  );
  const [calendarCreateRequestId, setCalendarCreateRequestId] = useState(0);
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const [databaseManagerOpen, setDatabaseManagerOpen] = useState(false);
  const calendarVisibleDays = useMemo(
    () => resolveCalendarVisibleDays(calendarState),
    [calendarState],
  );
  const calendarDayCount = resolveCalendarVisibleDayCount(calendarState.range);
  const scrollStateKey = renderedView === "calendar"
    ? `db-view:${sessionId}:${tab.id}:${projectId}:${selectedDatabaseViewId}:${renderedView}:${calendarState.range}`
    : `db-view:${sessionId}:${tab.id}:${projectId}:${selectedDatabaseViewId}:${renderedView}`;
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
  const searchQuery = searchByProject[projectId]
    ?? (projectId === tab.projectId ? activeSearchQuery : "");
  const activePanelPageStagePageIds =
    activePanelPageStagePageIdsByProject.get(projectId);
  const availableTags = useMemo(() => {
    if (databaseView) {
      return Array.from(
        new Set(
          databaseView.columns.flatMap((column) =>
            column.rows.flatMap((row) => row.tags)
          ),
        ),
      ).sort((left, right) => left.localeCompare(right));
    }
    if (!activeProjectBoard) return [];
    return Array.from(
      new Set(
        activeProjectBoard.columns.flatMap((column) =>
          column.cards.flatMap((card) => card.tags)
        ),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [activeProjectBoard, databaseView]);

  useEffect(() => {
    saveCalendarViewState(calendarState);
  }, [calendarState]);

  const openTaskSearch = useCallback((selectQuery = false) => {
    setTaskSearchOpen(true);
    window.requestAnimationFrame(() => {
      const input = taskSearchInputRef.current;
      if (!input) return;
      input.focus();
      if (selectQuery) input.select();
    });
  }, []);

  const closeTaskSearch = useCallback(() => {
    setTaskSearchOpen(false);
  }, []);

  useEffect(() => {
    if (
      taskSearchOpenTick <= 0
      || taskSearchOpenTick === lastHandledTaskSearchOpenTickRef.current
    ) {
      return;
    }
    lastHandledTaskSearchOpenTickRef.current = taskSearchOpenTick;
    openTaskSearch(true);
  }, [openTaskSearch, taskSearchOpenTick]);

  const handleCalendarRangeChange = useCallback((range: CalendarRangeState) => {
    setCalendarState((current) => ({ ...current, range }));
  }, []);

  const handleCalendarAnchorDateChange = useCallback(
    (update: (anchorDate: Date) => Date) => {
      setCalendarState((current) => ({
        ...current,
        anchorDate: normalizeCalendarAnchorDate(update(current.anchorDate)),
      }));
    },
    [],
  );

  const handleCalendarToday = useCallback(() => {
    setCalendarState((current) => ({
      ...current,
      anchorDate: normalizeCalendarAnchorDate(new Date()),
    }));
  }, []);

  const handleCalendarPrev = useCallback(() => {
    handleCalendarAnchorDateChange((anchorDate) =>
      shiftCalendarAnchorDateByDays(anchorDate, -calendarDayCount)
    );
  }, [calendarDayCount, handleCalendarAnchorDateChange]);

  const handleCalendarNext = useCallback(() => {
    handleCalendarAnchorDateChange((anchorDate) =>
      shiftCalendarAnchorDateByDays(anchorDate, calendarDayCount)
    );
  }, [calendarDayCount, handleCalendarAnchorDateChange]);

  const handleCalendarCreate = useCallback(() => {
    setCalendarCreateRequestId((current) => current + 1);
  }, []);

  const selectView = async (nextView: ProjectSessionDbView) => {
    if (selectedGeneralView) return;
    onUpdateTab(tab.id, {
      config: {
        projectId,
        databaseViewId: selectedDatabaseViewId,
        view: nextView,
      },
      title:
        DB_VIEW_TABS.find((item) => item.id === nextView)?.label ?? "DB View",
    });
  };

  const availableToolbarItems = selectedGeneralView
    ? DB_VIEW_TABS.filter((item) => item.id === renderedView)
    : DB_VIEW_TABS;
  const toolbarItems = availableToolbarItems.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === renderedView,
    onSelect: () => {
      void selectView(item.id);
    },
  }));
  const calendarToolbarControls =
    !selectedGeneralView && renderedView === "calendar"
      ? (
          <CalendarToolbarControls
            range={calendarState.range}
            onRangeChange={handleCalendarRangeChange}
            onCreate={handleCalendarCreate}
            onToday={handleCalendarToday}
            onPrev={handleCalendarPrev}
            onNext={handleCalendarNext}
          />
        )
      : null;
  const calendarToolbarContextLabel =
    !selectedGeneralView && renderedView === "calendar"
      ? <CalendarToolbarMonthLabel visibleDays={calendarVisibleDays} />
      : null;
  const updateDbViewPrefs = rulesView
    ? (update: (prev: DbViewPrefs) => DbViewPrefs) =>
        setDbViewPrefs(projectId, rulesView, update)
    : null;
  const searchShortcutLabel =
    typeof navigator !== "undefined"
      && navigator.platform.toUpperCase().includes("MAC")
      ? "⌘F"
      : "Ctrl+F";

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={toolbarItems}
        activeSearchQuery={searchQuery}
        taskSearchOpen={taskSearchOpen}
        showSearchControls={
          selectedGeneralView || renderedView !== "calendar"
        }
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        rulesView={rulesView}
        dbViewPrefs={dbViewPrefs}
        availableTags={availableTags}
        viewContextLabel={calendarToolbarContextLabel}
        calendarControls={calendarToolbarControls}
        managementControl={(
          <NodexIconButton
            icon={Database}
            size="sm"
            active={databaseManagerOpen}
            ariaLabel="Manage Databases"
            title="Manage Databases"
            onClick={() => setDatabaseManagerOpen(true)}
          />
        )}
        onUpdateDbViewPrefs={updateDbViewPrefs}
        onSearchQueryChange={(value) => setSearchQuery(projectId, value)}
        onOpenTaskSearch={openTaskSearch}
        onCloseTaskSearch={closeTaskSearch}
      />
      <DatabaseManagementDialogController
        projectId={projectId}
        initialDatabaseId={databaseView?.databaseId ?? null}
        open={databaseManagerOpen}
        onOpenChange={setDatabaseManagerOpen}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MainViewHost
          projectId={projectId}
          databaseViewId={selectedDatabaseViewId}
          databaseView={databaseView}
          databaseViewPagination={selectedDatabaseView.groupPagination}
          onLoadMoreDatabaseViewGroup={selectedDatabaseView.loadMoreGroup}
          refreshDatabaseView={selectedDatabaseView.refresh}
          projects={projects}
          view={renderedView}
          searchQuery={searchQuery}
          dbViewPrefs={dbViewPrefs}
          onUpdateDbViewPrefs={updateDbViewPrefs}
          activePanelPageStagePageIds={activePanelPageStagePageIds}
          pageStageCloseRef={pageStageCloseRef}
          pendingReminderOpen={pendingReminderOpen}
          calendarState={calendarState}
          calendarVisibleDays={calendarVisibleDays}
          calendarCreateRequestId={calendarCreateRequestId}
          onCalendarAnchorDateChange={handleCalendarAnchorDateChange}
          onReminderHandled={onReminderHandled}
          scrollStateKey={scrollStateKey}
          openPageStage={(nextProjectId, pageId, titleSnapshot, options) => {
            void onOpenPageTab(nextProjectId, pageId, titleSnapshot, {
              sourceTabId: tab.id,
              openMode: options?.openMode ?? "preview",
            });
          }}
        />
      </div>
    </div>
  );
}
