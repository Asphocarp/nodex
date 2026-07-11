import { CalendarView } from "@/components/kanban/calendar-view";
import { KanbanBoard } from "@/components/kanban/board";
import { ListView } from "@/components/kanban/list-view";
import { ToggleListView } from "@/components/kanban/toggle-list-view";
import { CanvasView } from "@/components/kanban/canvas-view";
import type { OpenCardStageOptions } from "@/components/kanban/open-card-stage";
import type { DbViewPrefs } from "../../lib/db-view-prefs";
import type { CalendarViewState } from "@/lib/calendar-view-state";
import type { Project } from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-state";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { ReadOnlyDatabaseView } from "./read-only-database-view";

interface MainViewHostProps {
  projectId: string;
  databaseViewId: string;
  databaseView: DatabaseViewRenderModel | null;
  projects: Project[];
  view: WorkbenchView;
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  onUpdateDbViewPrefs: ((update: (prev: DbViewPrefs) => DbViewPrefs) => void) | null;
  cardStageCardId?: string;
  activePanelCardStageCardIds?: ReadonlySet<string>;
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  calendarState: CalendarViewState;
  calendarVisibleDays: Date[];
  calendarCreateRequestId: number;
  onCalendarAnchorDateChange: (update: (anchorDate: Date) => Date) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  }) => void;
  openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
    options?: OpenCardStageOptions,
  ) => void;
  scrollStateKey?: string | null;
}

export function MainViewHost({
  projectId,
  databaseViewId,
  databaseView,
  projects,
  view,
  searchQuery,
  dbViewPrefs,
  onUpdateDbViewPrefs,
  cardStageCardId,
  activePanelCardStageCardIds,
  cardStageCloseRef,
  pendingReminderOpen,
  calendarState,
  calendarVisibleDays,
  calendarCreateRequestId,
  onCalendarAnchorDateChange,
  onReminderHandled,
  openCardStage,
  scrollStateKey,
}: MainViewHostProps) {
  if (databaseView && !databaseView.primaryWriteCompatible) {
    return (
      <ReadOnlyDatabaseView
        model={databaseView}
        searchQuery={searchQuery}
        openCardStage={openCardStage}
      />
    );
  }

  if (view === "kanban") {
    return (
      <KanbanBoard
        projectId={projectId}
        databaseViewId={databaseViewId}
        projects={projects}
        searchQuery={searchQuery}
        dbViewPrefs={dbViewPrefs}
        openCardStage={openCardStage}
        cardStageCardId={cardStageCardId}
        activePanelCardStageCardIds={activePanelCardStageCardIds}
        cardStageCloseRef={cardStageCloseRef}
        scrollStateKey={scrollStateKey}
      />
    );
  }

  if (view === "list") {
    return (
      <ListView
        projectId={projectId}
        databaseViewId={databaseViewId}
        searchQuery={searchQuery}
        dbViewPrefs={dbViewPrefs}
        onUpdateDbViewPrefs={onUpdateDbViewPrefs}
        openCardStage={openCardStage}
        cardStageCardId={cardStageCardId}
        cardStageCloseRef={cardStageCloseRef}
        scrollStateKey={scrollStateKey}
      />
    );
  }

  if (view === "canvas") {
    return (
      <CanvasView
        projectId={projectId}
        databaseViewId={databaseViewId}
        openCardStage={openCardStage}
        cardStageCardId={cardStageCardId}
        cardStageCloseRef={cardStageCloseRef}
      />
    );
  }

  if (view === "calendar") {
    return (
      <CalendarView
        projectId={projectId}
        databaseViewId={databaseViewId}
        searchQuery={searchQuery}
        openCardStage={openCardStage}
        cardStageCardId={cardStageCardId}
        cardStageCloseRef={cardStageCloseRef}
        pendingReminderOpen={pendingReminderOpen?.projectId === projectId ? pendingReminderOpen : null}
        calendarState={calendarState}
        visibleDays={calendarVisibleDays}
        createRequestId={calendarCreateRequestId}
        onCalendarAnchorDateChange={onCalendarAnchorDateChange}
        onReminderHandled={onReminderHandled}
        scrollStateKey={scrollStateKey}
      />
    );
  }

  return (
    <ToggleListView
      projectId={projectId}
      databaseViewId={databaseViewId}
      searchQuery={searchQuery}
      dbViewPrefs={dbViewPrefs}
      openCardStage={openCardStage}
      scrollStateKey={scrollStateKey}
    />
  );
}
