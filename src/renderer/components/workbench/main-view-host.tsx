import { CalendarView } from "@/components/kanban/calendar-view";
import { KanbanBoard } from "@/components/kanban/board";
import { ListView } from "@/components/kanban/list-view";
import { ToggleListView } from "@/components/kanban/toggle-list-view";
import type { OpenPageStageOptions } from "@/components/kanban/open-page-stage";
import type { DbViewPrefs } from "../../lib/db-view-prefs";
import type { CalendarViewState } from "@/lib/calendar-view-state";
import type { Project } from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-profile-preferences";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";

interface MainViewHostProps {
  surfaceId: string;
  panelTabId: string;
  projectId: string;
  databaseViewId: string;
  projects: Project[];
  view: WorkbenchView;
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  onUpdateDbViewPrefs: ((update: (prev: DbViewPrefs) => DbViewPrefs) => void) | null;
  pageStagePageId?: string;
  activePanelPageStagePageIds?: ReadonlySet<string>;
  pageStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  } | null;
  calendarState: CalendarViewState;
  calendarVisibleDays: Date[];
  calendarCreateRequestId: number;
  onCalendarAnchorDateChange: (update: (anchorDate: Date) => Date) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  }) => void;
  openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  scrollStateKey?: string | null;
}

export function MainViewHost({
  surfaceId,
  panelTabId,
  projectId,
  databaseViewId,
  projects,
  view,
  searchQuery,
  dbViewPrefs,
  onUpdateDbViewPrefs,
  pageStagePageId,
  activePanelPageStagePageIds,
  pageStageCloseRef,
  pendingReminderOpen,
  calendarState,
  calendarVisibleDays,
  calendarCreateRequestId,
  onCalendarAnchorDateChange,
  onReminderHandled,
  openPageStage,
  onOpenPageInNewChat,
  onSendPageToChat,
  scrollStateKey,
}: MainViewHostProps) {
  if (view === "kanban") {
    return (
      <KanbanBoard
        surfaceId={surfaceId}
        panelTabId={panelTabId}
        projectId={projectId}
        databaseViewId={databaseViewId}
        projects={projects}
        searchQuery={searchQuery}
        dbViewPrefs={dbViewPrefs}
        openPageStage={openPageStage}
        onOpenPageInNewChat={onOpenPageInNewChat}
        onSendPageToChat={onSendPageToChat}
        pageStagePageId={pageStagePageId}
        activePanelPageStagePageIds={activePanelPageStagePageIds}
        pageStageCloseRef={pageStageCloseRef}
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
        openPageStage={openPageStage}
        pageStagePageId={pageStagePageId}
        pageStageCloseRef={pageStageCloseRef}
        scrollStateKey={scrollStateKey}
      />
    );
  }

  if (view === "calendar") {
    return (
      <CalendarView
        projectId={projectId}
        databaseViewId={databaseViewId}
        searchQuery={searchQuery}
        openPageStage={openPageStage}
        pageStagePageId={pageStagePageId}
        pageStageCloseRef={pageStageCloseRef}
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
      openPageStage={openPageStage}
      scrollStateKey={scrollStateKey}
    />
  );
}
