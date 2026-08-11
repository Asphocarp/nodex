import {
  CalendarIcon,
  CanvasIcon,
  BoardIcon,
  DatabaseIcon,
} from "@/components/shared/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";

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
import {
  calendarPresentationFeature,
  resolveDurableDatabasePresentation,
  resolveLegacyWorkbenchPresentation,
  type CalendarPresentationFeature,
} from "@/lib/calendar-presentation-feature";
import type {
  Project,
  ProjectSessionDbView,
  WorkbenchTabProjection,
} from "@/lib/types";
import { useKanban } from "@/lib/use-kanban";
import type { WorkbenchView } from "@/lib/use-workbench-profile-preferences";
import type { WorkbenchSurfaceUpdatePatch } from "@/lib/workbench-scene-presentation";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import type { DatabaseViewKind } from "../../../shared/database-kernel";
import type { ColumnPaginationState } from "@/lib/kanban-store";
import { DatabaseManagementDialogController } from "./database-management-dialog-controller";
import {
  DbViewToolbar,
  type DbViewToolbarItem,
} from "./db-view-toolbar";
import { DatabaseViewSurface } from "./database-view-surface";
import { MainViewHost } from "./main-view-host";
import { ToggleListIcon } from "./toggle-list-icon";
import type { OpenPageTabHandler } from "./workbench-page-stage-panel";
import { primaryCanvasBlockId } from "../../../shared/block-documents";
import type { OpenCanvasStageHandler } from "@/lib/use-workbench-panel-openers";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";

const DB_VIEW_TABS: Array<{
  id: ProjectSessionDbView;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "kanban", label: "Board", icon: BoardIcon },
  { id: "list", label: "Table", icon: DatabaseIcon },
  { id: "toggle-list", label: "List", icon: ToggleListIcon },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
];

const durableDatabaseToolbarItem = (
  model: DatabaseViewRenderModel,
  presentationKind: DatabaseViewKind = model.query.view.kind,
): DbViewToolbarItem => {
  const item = DB_VIEW_TABS.find((candidate) =>
    candidate.id === presentationKind
  );
  return {
    id: presentationKind,
    label: item?.label ?? model.viewName,
    icon: item?.icon ?? DatabaseIcon,
    active: true,
    onSelect: () => undefined,
  };
};

export function DatabaseViewTabSurface({
  model,
  presentationKind = model.query.view.kind,
  toolbarItems = [durableDatabaseToolbarItem(model, presentationKind)],
  destinationItems,
  groupPagination,
  onLoadMoreGroup,
  activeSearchQuery,
  taskSearchOpen,
  searchShortcutLabel,
  taskSearchInputRef,
  managementControl,
  overlay,
  onSearchQueryChange,
  onOpenTaskSearch,
  onCloseTaskSearch,
  onOpenPage,
  onCommitted,
  keyboardSurface,
  presentedPageIds,
}: {
  readonly model: DatabaseViewRenderModel;
  readonly presentationKind?: DatabaseViewKind;
  readonly toolbarItems?: DbViewToolbarItem[];
  readonly destinationItems?: DbViewToolbarItem[];
  readonly groupPagination?: ReadonlyMap<string, ColumnPaginationState>;
  readonly onLoadMoreGroup?: (scopeKey: string) => Promise<void> | void;
  readonly activeSearchQuery: string;
  readonly taskSearchOpen: boolean;
  readonly searchShortcutLabel: string;
  readonly taskSearchInputRef: RefObject<HTMLInputElement | null>;
  readonly managementControl?: ReactNode;
  readonly overlay?: ReactNode;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onOpenTaskSearch: (selectQuery?: boolean) => void;
  readonly onCloseTaskSearch: () => void;
  readonly onOpenPage: (pageId: string, titleSnapshot: string) => void;
  readonly onCommitted?: () => void | Promise<void>;
  readonly keyboardSurface?: {
    readonly surfaceId: string;
    readonly presentationId: string;
  };
  readonly presentedPageIds?: ReadonlySet<string>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={toolbarItems}
        destinationItems={destinationItems}
        activeSearchQuery={activeSearchQuery}
        taskSearchOpen={taskSearchOpen}
        showSearchControls
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        rulesView={null}
        dbViewPrefs={null}
        availableTags={[]}
        managementControl={managementControl}
        onUpdateDbViewPrefs={null}
        onSearchQueryChange={onSearchQueryChange}
        onOpenTaskSearch={onOpenTaskSearch}
        onCloseTaskSearch={onCloseTaskSearch}
      />
      {overlay}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DatabaseViewSurface
          model={model}
          presentationKind={presentationKind}
          groupPagination={groupPagination}
          onLoadMoreGroup={onLoadMoreGroup}
          searchQuery={activeSearchQuery}
          onOpenPage={onOpenPage}
          onCommitted={onCommitted}
          keyboardSurface={keyboardSurface}
          presentedPageIds={presentedPageIds}
        />
      </div>
    </div>
  );
}

export function DbViewSessionTab({
  sessionId,
  tab,
  projects,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  presentedPageIds,
  pageStageCloseRef,
  taskSearchOpenTick,
  setSearchQuery,
  setDbViewPrefs,
  onOpenPageTab,
  onOpenPageInNewChat,
  onSendPageToChat,
  onOpenCanvasStage,
  targetLeafId,
  onUpdateTab,
  calendarPresentation = calendarPresentationFeature,
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
  presentedPageIds: ReadonlySet<string>;
  pageStageCloseRef: RefObject<(() => Promise<void>) | null>;
  taskSearchOpenTick: number;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  onOpenPageTab: OpenPageTabHandler;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  onOpenCanvasStage: OpenCanvasStageHandler;
  targetLeafId: string;
  onUpdateTab: (
    tabId: string,
    patch: WorkbenchSurfaceUpdatePatch,
  ) => WorkbenchTabProjection | null;
  calendarPresentation?: CalendarPresentationFeature;
}) {
  if (tab.kind !== "db_view") {
    throw new Error("Database view tabs require a db_view descriptor");
  }
  const config = tab.config;
  const projectId = config.projectId;
  const selectedDatabaseViewId = config.databaseViewId;
  const view = config.view;
  const legacyPresentation = resolveLegacyWorkbenchPresentation(
    view,
    calendarPresentation,
  );
  const legacyRulesView = viewSupportsDbViewPrefs(legacyPresentation)
    ? legacyPresentation
    : null;
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
  const durablePresentation = databaseView
    ? resolveDurableDatabasePresentation(
        databaseView.query.view.kind,
        calendarPresentation,
      )
    : null;
  const renderedView = selectedGeneralView && databaseView
    ? durablePresentation ?? databaseView.query.view.kind
    : legacyPresentation;
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
  const surfaceId = `db-view:${sessionId}:${tab.id}:${projectId}:${selectedDatabaseViewId}:${renderedView}`;
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
  const searchQuery = searchByProject[projectId]
    ?? (projectId === tab.projectId ? activeSearchQuery : "");
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
    if (nextView === renderedView) return;
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
    : DB_VIEW_TABS.filter((item) =>
        calendarPresentation.enabled || item.id !== "calendar"
      );
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

  if (selectedGeneralView && databaseView) {
    return (
      <DatabaseViewTabSurface
        model={databaseView}
        presentationKind={durablePresentation ?? databaseView.query.view.kind}
        toolbarItems={toolbarItems}
        destinationItems={[{
          id: "primary-canvas",
          label: "Canvas",
          icon: CanvasIcon,
          onSelect: () => {
            void onOpenCanvasStage(
              projectId,
              primaryCanvasBlockId(projectId),
              "Canvas",
              {
                targetPanelId: tab.panelId,
                targetLeafId,
              },
            );
          },
        }]}
        groupPagination={selectedDatabaseView.groupPagination}
        onLoadMoreGroup={selectedDatabaseView.loadMoreGroup}
        activeSearchQuery={searchQuery}
        taskSearchOpen={taskSearchOpen}
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        managementControl={(
          <NodexIconButton
            icon={DatabaseIcon}
            size="sm"
            active={databaseManagerOpen}
            ariaLabel="Manage Databases"
            title="Manage Databases"
            onClick={() => setDatabaseManagerOpen(true)}
          />
        )}
        overlay={(
          <DatabaseManagementDialogController
            projectId={projectId}
            initialDatabaseId={databaseView.databaseId}
            open={databaseManagerOpen}
            onOpenChange={setDatabaseManagerOpen}
          />
        )}
        onSearchQueryChange={(value) => setSearchQuery(projectId, value)}
        onOpenTaskSearch={openTaskSearch}
        onCloseTaskSearch={closeTaskSearch}
        onOpenPage={(pageId, titleSnapshot) => {
          void onOpenPageTab(projectId, pageId, titleSnapshot, {
            sourceTabId: tab.id,
            openMode: "preview",
          });
        }}
        onCommitted={selectedDatabaseView.refresh}
        keyboardSurface={{
          surfaceId,
          presentationId: tab.id,
        }}
        presentedPageIds={presentedPageIds}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={toolbarItems}
        destinationItems={[{
          id: "primary-canvas",
          label: "Canvas",
          icon: CanvasIcon,
          onSelect: () => {
            void onOpenCanvasStage(
              projectId,
              primaryCanvasBlockId(projectId),
              "Canvas",
              {
                targetPanelId: tab.panelId,
                targetLeafId,
              },
            );
          },
        }]}
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
            icon={DatabaseIcon}
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
          surfaceId={surfaceId}
          panelTabId={tab.id}
          projectId={projectId}
          databaseViewId={selectedDatabaseViewId}
          projects={projects}
          view={renderedView}
          searchQuery={searchQuery}
          dbViewPrefs={dbViewPrefs}
          onUpdateDbViewPrefs={updateDbViewPrefs}
          presentedPageIds={presentedPageIds}
          pageStageCloseRef={pageStageCloseRef}
          calendarState={calendarState}
          calendarVisibleDays={calendarVisibleDays}
          calendarCreateRequestId={calendarCreateRequestId}
          onCalendarAnchorDateChange={handleCalendarAnchorDateChange}
          scrollStateKey={scrollStateKey}
          openPageStage={(nextProjectId, pageId, titleSnapshot, options) => {
            void onOpenPageTab(nextProjectId, pageId, titleSnapshot, {
              sourceTabId: tab.id,
              openMode: options?.openMode ?? "preview",
            });
          }}
          onOpenPageInNewChat={onOpenPageInNewChat}
          onSendPageToChat={onSendPageToChat}
        />
      </div>
    </div>
  );
}
