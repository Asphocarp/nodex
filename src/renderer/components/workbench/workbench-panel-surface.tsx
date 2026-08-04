import type {
  MutableRefObject,
  RefObject,
} from "react";
import type { MotionValue } from "motion/react";
import type { PageStageSessionSnapshot } from "@/components/kanban/page-stage/types";
import {
  WorkspaceFilesPanel,
  type WorkspaceFilesTab,
} from "@/features/workspace-files";
import { BrowserSidebarPanel } from "@/features/browser-sidebar/browser-sidebar-panel";
import type { BrowserSettingsDestination } from "@/features/browser-sidebar/browser-settings-pages";
import type { BrowserSidebarOpenNewTabRequest } from "../../../shared/browser-sidebar";
import { ConnectedReviewDiffPanel } from "@/features/local-conversation";
import type {
  DbViewPrefs,
  SupportedDbView,
} from "@/lib/db-view-prefs";
import type { PageStageTabTitleStore } from "@/lib/page-stage-tab-title-store";
import {
  resolveLeafIdForPanelTab,
} from "@/lib/workbench-panel-placement";
import type { WorkbenchTabProjectionPanelTab } from "@/lib/workbench-panel-tab-model";
import {
  projectWorkspaceRootOrNull,
  resolveSessionTerminalCwd,
} from "@/lib/workbench-workspace-context";
import type {
  PanelId,
  Project,
  WorkbenchTabProjection,
} from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-profile-preferences";
import type { OpenCanvasStageHandler } from "@/lib/use-workbench-panel-openers";
import type {
  WorkbenchSurfaceUpdatePatch,
} from "@/lib/workbench-scene-presentation";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";
import { DbViewSessionTab } from "./workbench-db-view-panel";
import { WorkbenchCanvasStagePanel } from "./workbench-canvas-stage-panel";
import {
  PageStageSessionTab,
  type OpenPageTabHandler,
  type PageStageHistoryModalContext,
} from "./workbench-page-stage-panel";
import { TerminalPanel } from "./workbench-terminal-panel";
import { projectSessionThreadLinkToSummary } from "./thread-summary-projection";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";

export function WorkbenchTabProjectionPanel({
  tab,
  activeSession,
  windowSessionId,
  browserViewScopeId,
  projects,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  activePanelPageStagePageIdsByProject,
  pageStageTabTitleStore,
  pageStageCloseRef,
  pageStagePersistRef,
  pageStageSessionSnapshotRef,
  pendingReminderOpen,
  taskSearchOpenTick,
  setSearchQuery,
  setDbViewPrefs,
  onReminderHandled,
  onLeavePageStage,
  onOpenPageTab,
  onOpenPageInNewChat,
  onSendPageToChat,
  onOpenCanvasStage,
  onOpenFileTab,
  onEnsureBlankSessionForProject,
  onRefreshSessions,
  onCloseTab,
  onUpdateTab,
  onOpenBrowserTab,
  onCreateTerminalTab,
  onOpenThread,
  pageStageHistoryModal,
  onTogglePageStageHistoryModal,
  browserBoundsSyncTrigger,
  onOpenBrowserSettings,
  isActivePanelTab,
}: {
  tab: WorkbenchTabProjectionPanelTab;
  activeSession: WorkbenchSessionRenderProjection;
  windowSessionId: string;
  browserViewScopeId: string;
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
  pageStageTabTitleStore: PageStageTabTitleStore;
  pageStageCloseRef: RefObject<(() => Promise<void>) | null>;
  pageStagePersistRef?: MutableRefObject<(() => Promise<void>) | null>;
  pageStageSessionSnapshotRef?: MutableRefObject<
    PageStageSessionSnapshot | null
  >;
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
  onLeavePageStage: (snapshot: PageStageSessionSnapshot) => void;
  onOpenPageTab: OpenPageTabHandler;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  onOpenCanvasStage: OpenCanvasStageHandler;
  onOpenFileTab: (input: {
    path: string;
    title: string;
    panelId: PanelId;
    mode?: "preview" | "durable";
  }) => Promise<unknown>;
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<WorkbenchSessionRenderProjection>;
  onRefreshSessions: (
    projectId: string | null,
  ) => Promise<WorkbenchSessionRenderProjection[]>;
  onCloseTab: (tabId: string) => Promise<void>;
  onUpdateTab: (
    tabId: string,
    patch: WorkbenchSurfaceUpdatePatch,
  ) => WorkbenchTabProjection | null;
  onOpenBrowserTab?: (
    request: BrowserSidebarOpenNewTabRequest,
  ) => void | Promise<void>;
  onCreateTerminalTab: (
    panelId: PanelId,
    leafId: string,
  ) => Promise<void> | void;
  onOpenThread: (threadId: string) => Promise<void>;
  pageStageHistoryModal: PageStageHistoryModalContext | null;
  onTogglePageStageHistoryModal: (
    context: PageStageHistoryModalContext,
  ) => void;
  browserBoundsSyncTrigger?: MotionValue<number>;
  onOpenBrowserSettings: (sectionId: BrowserSettingsDestination) => void;
  isActivePanelTab: boolean;
}) {
  if (tab.kind === "db_view" && "view" in tab.config) {
    return (
      <DbViewSessionTab
        sessionId={activeSession.id}
        tab={tab}
        projects={projects}
        activeView={activeView}
        activeSearchQuery={activeSearchQuery}
        activeDbViewPrefs={activeDbViewPrefs}
        searchByProject={searchByProject}
        dbViewPrefsByProject={dbViewPrefsByProject}
        activePanelPageStagePageIdsByProject={
          activePanelPageStagePageIdsByProject
        }
        pageStageCloseRef={pageStageCloseRef}
        pendingReminderOpen={pendingReminderOpen}
        taskSearchOpenTick={taskSearchOpenTick}
        setSearchQuery={setSearchQuery}
        setDbViewPrefs={setDbViewPrefs}
        onReminderHandled={onReminderHandled}
        onOpenPageTab={onOpenPageTab}
        onOpenPageInNewChat={onOpenPageInNewChat}
        onSendPageToChat={onSendPageToChat}
        onOpenCanvasStage={onOpenCanvasStage}
        targetLeafId={resolveLeafIdForPanelTab(
          activeSession,
          tab.panelId,
          tab.id,
        )}
        onUpdateTab={onUpdateTab}
      />
    );
  }

  if (tab.kind === "canvas_stage") {
    const surface = {
      id: tab.id,
      kind: "canvas_stage" as const,
      titleSnapshot: tab.title,
      config: {
        accessContext: {
          kind: "project" as const,
          projectId: tab.config.projectId,
        },
        canvasBlockId: tab.config.canvasBlockId,
        ...(tab.config.titleSnapshot
          ? { titleSnapshot: tab.config.titleSnapshot }
          : {}),
      },
      stateKey: tab.stateKey,
      state: tab.state,
    };
    return (
      <WorkbenchCanvasStagePanel
        surface={surface}
        windowSessionId={windowSessionId}
        presentationOwnerId={activeSession.id}
        isActivePanelTab={isActivePanelTab}
        onClose={() => void onCloseTab(tab.id)}
        onTitleChange={(title) => {
          onUpdateTab(tab.id, { title });
        }}
      />
    );
  }

  if (
    tab.kind === "page_stage"
    && "pageId" in tab.config
    && "projectId" in tab.config
  ) {
    const pageTab = tab as WorkbenchTabProjection & {
      config: {
        projectId: string;
        pageId: string;
        titleSnapshot?: string;
      };
    };
    return (
      <PageStageSessionTab
        tab={pageTab}
        project={
          projects.find((item) => item.id === pageTab.config.projectId)
            ?? null
        }
        closeRef={pageStageCloseRef}
        persistRef={pageStagePersistRef}
        sessionSnapshotRef={pageStageSessionSnapshotRef}
        sessionId={activeSession.id}
        sessionThread={activeSession.thread
          ? projectSessionThreadLinkToSummary(activeSession.thread)
          : null}
        canStartThreadInSession={
          !activeSession.thread
          && activeSession.projectId === pageTab.config.projectId
        }
        titleStore={pageStageTabTitleStore}
        onLeavePage={onLeavePageStage}
        onClose={() => void onCloseTab(tab.id)}
        onOpenTerminal={async () => {
          await onCreateTerminalTab(
            "bottom",
            activeSession.panels.bottom.layout.activeLeafId,
          );
        }}
        onEnsureBlankSessionForProject={onEnsureBlankSessionForProject}
        onRefreshSessions={onRefreshSessions}
        onOpenPageTab={onOpenPageTab}
        onOpenCanvasStage={onOpenCanvasStage}
        onOpenThread={onOpenThread}
        historyPanelActive={Boolean(
          pageStageHistoryModal
          && pageStageHistoryModal.sessionId === activeSession.id
          && pageStageHistoryModal.tabId === pageTab.id
          && pageStageHistoryModal.projectId === pageTab.config.projectId
          && pageStageHistoryModal.pageId === pageTab.config.pageId,
        )}
        onToggleHistoryPanel={onTogglePageStageHistoryModal}
        isActivePanelTab={isActivePanelTab}
      />
    );
  }

  if (tab.kind === "terminal" && "terminalSessionId" in tab.config) {
    const cwd = resolveSessionTerminalCwd(activeSession, tab, projects);
    const leafId = resolveLeafIdForPanelTab(
      activeSession,
      tab.panelId,
      tab.id,
    );
    if (!cwd) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center bg-token-main-surface-primary px-3 text-sm text-token-text-secondary">
          Terminal workspace is unavailable
        </div>
      );
    }
    return (
      <div className="h-full min-h-0 bg-token-main-surface-primary">
        <TerminalPanel
          terminalId={tab.config.terminalSessionId}
          cwd={cwd}
          conversationId={
            activeSession.thread?.threadId ?? activeSession.id
          }
          projectSessionId={activeSession.id}
          onNewTerminalTab={() => {
            void onCreateTerminalTab(tab.panelId, leafId);
          }}
        />
      </div>
    );
  }

  if (tab.kind === "review") {
    const project =
      projects.find((item) => item.id === tab.projectId) ?? null;
    return (
      <ConnectedReviewDiffPanel
        threadId={activeSession.thread?.threadId ?? null}
        projectWorkspacePath={projectWorkspaceRootOrNull(project)}
        searchOpenTick={0}
      />
    );
  }

  if (tab.kind === "browser") {
    return (
      <BrowserSidebarPanel
        tab={tab}
        activeSession={activeSession}
        browserViewScopeId={browserViewScopeId}
        onRefreshSessions={onRefreshSessions}
        onUpdateTab={onUpdateTab}
        onOpenNewTab={onOpenBrowserTab}
        boundsSyncTrigger={browserBoundsSyncTrigger}
        onOpenBrowserSettings={onOpenBrowserSettings}
        activeForContentSearch={isActivePanelTab}
        isVisible={isActivePanelTab}
      />
    );
  }

  if (tab.kind === "files") {
    return (
      <WorkspaceFilesPanel
        tab={tab as WorkspaceFilesTab}
        activeSession={activeSession}
        project={
          projects.find((item) => item.id === tab.projectId) ?? null
        }
        onOpenFileTab={onOpenFileTab}
        onUpdateTabState={(state) => {
          onUpdateTab(tab.id, { state });
        }}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-text-secondary">
      Unsupported tab.
    </div>
  );
}
