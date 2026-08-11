import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ComponentType,
  type MutableRefObject,
} from "react";
import { type MotionValue } from "motion/react";
import {
  AutomationsIcon,
  SidePanelSideChatIcon,
  SidePanelTerminalIcon,
  ComposerPlanModeIcon,
  ComposerPluginsIcon,
} from "@/components/shared/icons";
import { SubagentAvatar, SubagentGlyphIcon } from "@/features/local-conversation/view/shared/subagent-avatar";
import {
  getWorkspaceFileDomTabId,
  resolveWorkspaceFileTabIcon,
} from "@/features/workspace-files";
import {
  makePageTitleResourceKey,
  type PageTitleProjectionStore,
} from "@/lib/page-title-projection-store";
import { getPanelNewTabAction } from "@/lib/workbench-panel-actions";
import {
  terminalSessionStore,
} from "@/lib/terminal-session-store";
import type {
  WorkbenchPanelController,
} from "@/lib/use-workbench-panel-controller";
import type {
  useWorkbenchPanelCommandRouter,
} from "@/lib/use-workbench-panel-command-router";
import type {
  useWorkbenchPanelLifecycle,
} from "@/lib/use-workbench-panel-lifecycle";
import type {
  useWorkbenchPanelOpeners,
} from "@/lib/use-workbench-panel-openers";
import type {
  useWorkbenchSessionCommands,
} from "@/lib/use-workbench-session-commands";
import {
  collectPanelPresentedPageIds,
  type SessionPanelRenderModel,
} from "@/lib/workbench-panel-projection";
import {
  makeWorkbenchSessionPanelOwnerKey,
  makeWorkbenchSessionPanelSlotKey,
} from "@/lib/workbench-panel-slot-key";
import {
  isAutomationPanelTab,
  isBackgroundAgentPanelTab,
  isMcpAppPanelTab,
  isPanelTabClosable,
  isPlanPanelTab,
  isProcessOutputPanelTab,
  isProjectSessionFilesPreviewTab,
  isSideChatPanelTab,
  isSubagentsPanelTab,
  isTransientPanelTab,
  type ProjectSessionRenderableTab,
} from "@/lib/workbench-panel-tab-model";
import type {
  WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import type {
  CodexScheduledAutomation,
  PanelId,
  Project,
  WorkbenchTabProjection,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  findWorkbenchPanelLeaf,
  listWorkbenchPanelLeaves,
} from "../../../shared/workbench-panel-layout";
import type {
  AppShellTabItem,
} from "./app-shell-tabs";
import { buildAutomationsPath } from "./workbench-automations-routes";
import { WorkbenchAutomationSidePanelTab } from "./workbench-automations-overlay";
import {
  BackgroundAgentSessionTab,
  SideChatSessionTab,
  SubagentsPanelSessionTab,
} from "./workbench-auxiliary-conversation-panels";
import { WorkbenchTabProjectionPanel } from "./workbench-panel-surface";
import {
  McpAppSessionTab,
  ProcessOutputPanelTabView,
} from "./workbench-runtime-panel-surfaces";
import { PlanSidePanelTab } from "./plan-side-panel-tab";
import type {
  PanelTabPresentationRegistry,
} from "./panel-tab-presentation-registry";
import { ReviewRouteOpenAdapter } from "./workbench-review-route-adapter";

type ProjectSession = WorkbenchSessionRenderProjection;
type SurfaceProps = ComponentProps<typeof WorkbenchTabProjectionPanel>;
type PanelLifecycle = Pick<
  ReturnType<typeof useWorkbenchPanelLifecycle>,
  "closeEphemeralPanelTab" | "closeTab"
>;
type PanelOpeners = Pick<
  ReturnType<typeof useWorkbenchPanelOpeners>,
  | "openCanvasStage"
  | "openMcpAppSidePanel"
  | "openPageTab"
  | "openWorkspaceFileTab"
  | "recreateSideChatPanelTab"
>;
type SessionCommands = Pick<
  ReturnType<typeof useWorkbenchSessionCommands>,
  | "activateReviewTab"
  | "createManualTab"
  | "ensureBlankSessionForProject"
  | "openPageInNewChat"
  | "openAttachedThreadSession"
  | "openAttachedThreadSessionById"
  | "sendPageToChat"
  | "openSubagentsPanelTab"
  | "openTurnDiffFileInSidePanel"
>;
type PanelCommands = Pick<
  ReturnType<typeof useWorkbenchPanelCommandRouter>,
  "createBrowserTabToRight" | "reloadBrowserTab"
>;

export type PanelGroupTabsByPanel = Record<PanelId, {
  itemsByLeafId: Record<string, AppShellTabItem[]>;
  activeTabIdsByLeafId: Record<string, string | null>;
}>;

interface WorkbenchPanelProjectionInput {
  readonly activeRenderSession: ProjectSession | null;
  readonly activeSessionPanelModel: SessionPanelRenderModel | null;
  readonly projects: Project[];
  readonly pageTitleStore: PageTitleProjectionStore;
  readonly panelTabPresentationRegistry: PanelTabPresentationRegistry;
  readonly panelTabPresentationControllerKeysRef: MutableRefObject<Set<string>>;
  readonly panelGroupTabsRef: MutableRefObject<PanelGroupTabsByPanel>;
  readonly panelTabMruByLeafRef: MutableRefObject<Record<string, string[]>>;
  readonly terminalSessionVersion: number;
  readonly browserBoundsSyncTriggerByPanel: Partial<
    Record<PanelId, MotionValue<number>>
  >;
  readonly lifecycle: PanelLifecycle;
  readonly openers: PanelOpeners;
  readonly sessionCommands: SessionCommands;
  readonly panelCommands: PanelCommands;
  readonly controller: WorkbenchPanelController;
  readonly surface: Pick<
    SurfaceProps,
    | "activeDbViewPrefs"
    | "activeSearchQuery"
    | "activeView"
    | "browserViewScopeId"
    | "onOpenBrowserSettings"
    | "windowSessionId"
    | "dbViewPrefsByProject"
    | "onLeavePageStage"
    | "onReminderHandled"
    | "pageStageCloseRef"
    | "pageStageHistoryModal"
    | "pageStagePersistRef"
    | "pageStageSessionSnapshotRef"
    | "pendingReminderOpen"
    | "searchByProject"
    | "setDbViewPrefs"
    | "setSearchQuery"
    | "taskSearchOpenTick"
  >;
  readonly conversation: {
    readonly composerEnterBehavior: ComponentProps<
      typeof SideChatSessionTab
    >["composerEnterBehavior"];
    readonly threadQueueFollowUpsEnabled: boolean;
    readonly onOpenHooksSettings: ComponentProps<
      typeof SideChatSessionTab
    >["onOpenHooksSettings"];
    readonly onQueueingEnabledChange: ComponentProps<
      typeof SideChatSessionTab
    >["onQueueingEnabledChange"];
    readonly onRefreshSessions: ComponentProps<
      typeof SideChatSessionTab
    >["onRefreshSessions"];
  };
  readonly automation: {
    readonly onOpenAutomations: (path: string) => void;
    readonly onOpenLocalEnvironmentsSettings: ComponentProps<
      typeof WorkbenchAutomationSidePanelTab
    >["onOpenLocalEnvironmentsSettings"];
  };
  readonly onTogglePageStageHistoryModal:
    SurfaceProps["onTogglePageStageHistoryModal"];
  readonly onUpdateSessionViewTab: SurfaceProps["onUpdateTab"];
}

function getTabIcon(
  kind: WorkbenchTabProjection["kind"],
): ComponentType<{ className?: string }> {
  return getPanelNewTabAction(kind).Icon;
}

function makeBrowserFaviconIcon(
  faviconUrl: string,
): ComponentType<{ className?: string }> {
  return function BrowserFaviconIcon({ className }: { className?: string }) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className={cn("rounded-[2px] object-contain", className)}
      />
    );
  };
}

function getBrowserTabIcon(
  tab: WorkbenchTabProjection,
): ComponentType<{ className?: string }> {
  if (
    tab.kind === "browser"
    && "faviconUrl" in tab.config
    && typeof tab.config.faviconUrl === "string"
    && tab.config.faviconUrl.trim().length > 0
  ) {
    return makeBrowserFaviconIcon(tab.config.faviconUrl);
  }
  return getTabIcon(tab.kind);
}

function resolveProjectTargetTabChromeContext(
  tab: ProjectSessionRenderableTab,
  activeSession: ProjectSession,
  projects: readonly Project[],
): Pick<AppShellTabItem, "contextLabel" | "titleLabel" | "tooltip"> {
  if (
    isSideChatPanelTab(tab)
    || isMcpAppPanelTab(tab)
    || isPlanPanelTab(tab)
    || isAutomationPanelTab(tab)
    || isBackgroundAgentPanelTab(tab)
    || isSubagentsPanelTab(tab)
    || isProcessOutputPanelTab(tab)
  ) return {};
  if (
    tab.kind !== "db_view"
    && tab.kind !== "page_stage"
    && tab.kind !== "canvas_stage"
  ) return {};
  if (!("projectId" in tab.config)) return {};

  const targetProjectId = tab.config.projectId;
  if (targetProjectId === null) return {};
  if (targetProjectId === activeSession.projectId) return {};

  const targetProject = projects.find(
    (project) => project.id === targetProjectId,
  );
  const projectLabel = targetProject?.name.trim() || targetProjectId;

  return {
    contextLabel: projectLabel,
    titleLabel: (title) => `${projectLabel} project, ${title}`,
    tooltip: (title) => (
      <div className="flex max-w-80 flex-col gap-0.5">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-token-description-foreground">
          Project: {projectLabel}
        </div>
      </div>
    ),
  };
}

function uniqueStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function createBackgroundAgentTabIcon(
  threadId: string,
): ComponentType<{ className?: string }> {
  function BackgroundAgentTabIcon({ className }: { className?: string }) {
    return <SubagentAvatar seed={threadId} className={className} />;
  }

  return BackgroundAgentTabIcon;
}

function resolveTerminalTabIndex(
  session: ProjectSession,
  tab: WorkbenchTabProjection,
): number {
  const index = session.tabs
    .filter((candidate) => candidate.kind === "terminal")
    .findIndex((candidate) => candidate.id === tab.id);
  return index >= 0 ? index + 1 : 1;
}

/**
 * Projects panel state and commands into host-ready tab descriptors.
 *
 * This Adapter is the only Workbench module that knows which React surface,
 * icon, context menu, and runtime command belongs to each renderable tab kind.
 */
export function useWorkbenchPanelProjection({
  activeRenderSession,
  activeSessionPanelModel,
  projects,
  pageTitleStore,
  panelTabPresentationRegistry,
  panelTabPresentationControllerKeysRef,
  panelGroupTabsRef,
  panelTabMruByLeafRef,
  terminalSessionVersion,
  browserBoundsSyncTriggerByPanel,
  lifecycle,
  openers,
  sessionCommands,
  panelCommands,
  controller,
  surface,
  conversation,
  automation,
  onTogglePageStageHistoryModal,
  onUpdateSessionViewTab,
}: WorkbenchPanelProjectionInput) {
  const panelControllerRef = useRef(controller);
  panelControllerRef.current = controller;
  const {
    closeEphemeralPanelTab,
    closeTab,
  } = lifecycle;
  const {
    openCanvasStage,
    openMcpAppSidePanel,
    openPageTab,
    openWorkspaceFileTab,
    recreateSideChatPanelTab,
  } = openers;
  const {
    activateReviewTab,
    createManualTab,
    ensureBlankSessionForProject,
    openPageInNewChat,
    openAttachedThreadSession,
    openAttachedThreadSessionById,
    sendPageToChat,
    openSubagentsPanelTab,
    openTurnDiffFileInSidePanel,
  } = sessionCommands;
  const {
    createBrowserTabToRight,
    reloadBrowserTab,
  } = panelCommands;
  const {
    composerEnterBehavior,
    threadQueueFollowUpsEnabled,
    onOpenHooksSettings,
    onQueueingEnabledChange,
    onRefreshSessions,
  } = conversation;
  const {
    onOpenAutomations,
    onOpenLocalEnvironmentsSettings,
  } = automation;

  const presentedPageIds = useMemo<ReadonlySet<string>>(() => {
    if (!activeRenderSession || !activeSessionPanelModel) return new Set();
    return collectPanelPresentedPageIds(
      activeRenderSession,
      activeSessionPanelModel,
    );
  }, [activeRenderSession, activeSessionPanelModel]);

  const buildPanelGroupTabsForSession = useCallback((
    session: ProjectSession,
    model: SessionPanelRenderModel,
  ): PanelGroupTabsByPanel => {
    void terminalSessionVersion;
    const makeItem = (tab: ProjectSessionRenderableTab): AppShellTabItem => {
      const transientPanelTab = isTransientPanelTab(tab);
      const title = !transientPanelTab
          && tab.kind === "terminal"
          && "terminalSessionId" in tab.config
          ? terminalSessionStore.resolveTitle(
              tab.config.terminalSessionId,
              tab.title,
              resolveTerminalTabIndex(session, tab),
            )
          : tab.title;
      const pageStageProject = !transientPanelTab
          && tab.kind === "page_stage"
        ? projects.find((project) => project.id === tab.config.projectId)
        : undefined;
      const pageStageTitleSource = !transientPanelTab
          && tab.kind === "page_stage"
          && pageStageProject
        ? pageTitleStore.createSource(
            makePageTitleResourceKey(
              pageStageProject.libraryId,
              tab.config.pageId,
            ),
            title,
          )
        : undefined;
      const chromeContext = resolveProjectTargetTabChromeContext(
        tab,
        session,
        projects,
      );
      const filesIcon = !transientPanelTab && tab.kind === "files"
        ? resolveWorkspaceFileTabIcon(
            "path" in tab.config ? tab.config.path : undefined,
          )
        : null;

      return {
        id: tab.id,
        domTabId: !transientPanelTab && tab.kind === "review"
          ? "diff"
          : !transientPanelTab
              && tab.kind === "files"
              && "path" in tab.config
            ? getWorkspaceFileDomTabId(
                "hostId" in tab.config ? tab.config.hostId : "local",
                tab.config.path,
              )
            : undefined,
        title,
        titleSource: pageStageTitleSource,
        ...chromeContext,
        icon: isSideChatPanelTab(tab)
          ? SidePanelSideChatIcon
          : isMcpAppPanelTab(tab)
            ? ComposerPluginsIcon
            : isPlanPanelTab(tab)
              ? ComposerPlanModeIcon
              : isAutomationPanelTab(tab)
                ? AutomationsIcon
                : isBackgroundAgentPanelTab(tab)
                  ? createBackgroundAgentTabIcon(tab.threadId)
                  : isSubagentsPanelTab(tab)
                    ? SubagentGlyphIcon
                    : isProcessOutputPanelTab(tab)
                      ? SidePanelTerminalIcon
                      : filesIcon
                        ?? (isProjectSessionFilesPreviewTab(tab)
                          ? getTabIcon(tab.kind)
                          : getBrowserTabIcon(tab)),
        closable: isPanelTabClosable(tab),
        preview: transientPanelTab ? undefined : tab.preview,
        reorderable: transientPanelTab ? false : tab.preview !== true,
        splittable: !transientPanelTab && tab.preview !== true,
        contextMenuItems: !transientPanelTab && tab.kind === "browser"
          ? [
              {
                id: "browser-new-tab-right",
                label: "New tab to the right",
                onSelect: () => void createBrowserTabToRight(tab, false),
              },
              {
                id: "browser-reload",
                label: "Reload",
                onSelect: () => reloadBrowserTab(tab),
              },
              {
                id: "browser-duplicate",
                label: "Duplicate",
                onSelect: () => void createBrowserTabToRight(tab, true),
              },
            ]
          : !transientPanelTab
              && tab.kind === "terminal"
              && "terminalSessionId" in tab.config
            ? [
                {
                  id: "terminal-kill",
                  label: "Kill terminal",
                  tone: "destructive",
                  onSelect: () => {
                    terminalSessionStore.kill(tab.config.terminalSessionId);
                  },
                },
              ]
            : undefined,
        renderPanel: (_closeTab, panelContext) => {
          if (isSideChatPanelTab(tab)) {
            return (
              <ReviewRouteOpenAdapter activateReviewTab={activateReviewTab}>
                {({ onOpenTurnDiffReview }) => (
                  <SideChatSessionTab
                    key={`${session.id}:${tab.id}:${tab.stateKey}`}
                    tab={tab}
                    activeSession={session}
                    projects={projects}
                    onRefreshSessions={onRefreshSessions}
                    onRecreateSideChat={() =>
                      void recreateSideChatPanelTab(tab.id)}
                    onOpenMcpAppSidePanel={openMcpAppSidePanel}
                    onOpenHooksSettings={onOpenHooksSettings}
                    threadQueueFollowUpsEnabled={
                      threadQueueFollowUpsEnabled
                    }
                    composerEnterBehavior={composerEnterBehavior}
                    onQueueingEnabledChange={onQueueingEnabledChange}
                    onOpenThread={openAttachedThreadSession}
                    onOpenTurnDiffReview={onOpenTurnDiffReview}
                    onOpenTurnDiffFileInSidePanel={
                      openTurnDiffFileInSidePanel
                    }
                    turnDiffHoverPreviewDisabled={model.sidePanelOpen}
                  />
                )}
              </ReviewRouteOpenAdapter>
            );
          }
          if (isMcpAppPanelTab(tab)) {
            return (
              <McpAppSessionTab
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
              />
            );
          }
          if (isPlanPanelTab(tab)) {
            return (
              <PlanSidePanelTab
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                content={tab.content}
                cwd={tab.cwd}
              />
            );
          }
          if (isAutomationPanelTab(tab)) {
            return (
              <WorkbenchAutomationSidePanelTab
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                automationId={tab.automationId}
                createInput={tab.createInput}
                mode={tab.mode}
                projects={projects}
                title={tab.title}
                updateInput={tab.updateInput}
                onClose={() => {
                  void closeEphemeralPanelTab(tab.panelId, tab.id);
                }}
                onOpenInScheduled={(automationId) => {
                  onOpenAutomations(buildAutomationsPath({ automationId }));
                }}
                onOpenLocalEnvironmentsSettings={
                  onOpenLocalEnvironmentsSettings
                }
                onSaved={(automationValue: CodexScheduledAutomation) => {
                  panelControllerRef.current.updateAutomationTabsBySession(
                    (current) => {
                      const tabs = current[session.id] ?? [];
                      return {
                        ...current,
                        [session.id]: tabs.map((candidate) =>
                          candidate.id === tab.id
                            ? {
                                ...candidate,
                                automationId: automationValue.id,
                                createInput: null,
                                mode: "open",
                                title: automationValue.name,
                                updateInput: null,
                                stateKey: candidate.stateKey + 1,
                              }
                            : candidate
                        ),
                      };
                    },
                  );
                }}
                onTitleChange={(titleValue) => {
                  panelControllerRef.current.updateAutomationTabsBySession(
                    (current) => {
                      const tabs = current[session.id] ?? [];
                      return {
                        ...current,
                        [session.id]: tabs.map((candidate) =>
                          candidate.id === tab.id
                            ? { ...candidate, title: titleValue }
                            : candidate
                        ),
                      };
                    },
                  );
                }}
              />
            );
          }
          if (isProcessOutputPanelTab(tab)) {
            return (
              <ProcessOutputPanelTabView
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
              />
            );
          }
          if (isSubagentsPanelTab(tab)) {
            return (
              <ReviewRouteOpenAdapter activateReviewTab={activateReviewTab}>
                {({ onOpenTurnDiffReview }) => (
                  <SubagentsPanelSessionTab
                    key={`${session.id}:${tab.id}:${tab.stateKey}`}
                    tab={tab}
                    activeSession={session}
                    projects={projects}
                    onRefreshSessions={onRefreshSessions}
                    onOpenMcpAppSidePanel={openMcpAppSidePanel}
                    onOpenHooksSettings={onOpenHooksSettings}
                    threadQueueFollowUpsEnabled={
                      threadQueueFollowUpsEnabled
                    }
                    composerEnterBehavior={composerEnterBehavior}
                    onQueueingEnabledChange={onQueueingEnabledChange}
                    onOpenThread={openAttachedThreadSession}
                    onRouteSubagent={(subagent) =>
                      openSubagentsPanelTab(tab.rootThreadId, subagent)}
                    onOpenTurnDiffReview={onOpenTurnDiffReview}
                    onOpenTurnDiffFileInSidePanel={
                      openTurnDiffFileInSidePanel
                    }
                    turnDiffHoverPreviewDisabled={model.sidePanelOpen}
                  />
                )}
              </ReviewRouteOpenAdapter>
            );
          }
          if (isBackgroundAgentPanelTab(tab)) {
            return (
              <ReviewRouteOpenAdapter activateReviewTab={activateReviewTab}>
                {({ onOpenTurnDiffReview }) => (
                  <BackgroundAgentSessionTab
                    key={`${session.id}:${tab.id}:${tab.stateKey}`}
                    tab={tab}
                    activeSession={session}
                    projects={projects}
                    onRefreshSessions={onRefreshSessions}
                    onOpenMcpAppSidePanel={openMcpAppSidePanel}
                    onOpenHooksSettings={onOpenHooksSettings}
                    threadQueueFollowUpsEnabled={
                      threadQueueFollowUpsEnabled
                    }
                    composerEnterBehavior={composerEnterBehavior}
                    onQueueingEnabledChange={onQueueingEnabledChange}
                    onOpenThread={openAttachedThreadSession}
                    onOpenTurnDiffReview={onOpenTurnDiffReview}
                    onOpenTurnDiffFileInSidePanel={
                      openTurnDiffFileInSidePanel
                    }
                    turnDiffHoverPreviewDisabled={model.sidePanelOpen}
                  />
                )}
              </ReviewRouteOpenAdapter>
            );
          }
          return (
            <WorkbenchTabProjectionPanel
              key={`${session.id}:${tab.id}:${tab.stateKey}`}
              {...surface}
              tab={tab}
              activeSession={session}
              projects={projects}
              presentedPageIds={presentedPageIds}
              onOpenCanvasStage={openCanvasStage}
              onOpenPageTab={openPageTab}
              onOpenPageInNewChat={openPageInNewChat}
              onSendPageToChat={sendPageToChat}
              onOpenFileTab={openWorkspaceFileTab}
              onEnsureBlankSessionForProject={ensureBlankSessionForProject}
              onRefreshSessions={onRefreshSessions}
              onCloseTab={closeTab}
              onUpdateTab={onUpdateSessionViewTab}
              {...(tab.kind === "browser"
                ? {
                    onOpenBrowserTab: (request) =>
                      createBrowserTabToRight(tab, false, request),
                  }
                : {})}
              onCreateTerminalTab={async (panelId, leafId) => {
                await createManualTab("terminal", panelId, leafId);
              }}
              onOpenThread={async (threadId) => {
                await openAttachedThreadSessionById(threadId);
              }}
              onTogglePageStageHistoryModal={
                onTogglePageStageHistoryModal
              }
              browserBoundsSyncTrigger={
                browserBoundsSyncTriggerByPanel[tab.panelId]
              }
              isActivePanelTab={
                panelContext.active
                && (
                  tab.panelId === "right"
                    ? model.sidePanelOpen
                    : model.bottomPanelOpen
                )
              }
            />
          );
        },
      };
    };

    const buildPanelTabs = (panelId: PanelId) => {
      const panel = session.panels[panelId];
      const leaves = listWorkbenchPanelLeaves(panel.layout);
      const itemsByLeafId: Record<string, AppShellTabItem[]> = {};
      const activeTabIdsByLeafId: Record<string, string | null> = {};

      for (const leaf of leaves) {
        const renderableTabs =
          model.renderableTabsByPanelLeaf[panelId][leaf.id] ?? [];
        const items = renderableTabs.map(makeItem);
        const presentations = panelTabPresentationRegistry.reconcile(
          makeWorkbenchSessionPanelSlotKey(session.id, panelId, leaf.id),
          items.map((item) => ({
            id: item.id,
            preview: item.preview === true,
          })),
        );
        const presentationIdByTabId = new Map(
          presentations.map((presentation) => [
            presentation.id,
            presentation.presentationId,
          ]),
        );
        itemsByLeafId[leaf.id] = items.map((item) => ({
          ...item,
          presentationId: presentationIdByTabId.get(item.id),
        }));
        activeTabIdsByLeafId[leaf.id] =
          model.activeTabIdsByPanelLeaf[panelId][leaf.id] ?? null;
      }

      return { itemsByLeafId, activeTabIdsByLeafId };
    };

    return {
      right: buildPanelTabs("right"),
      bottom: buildPanelTabs("bottom"),
    };
  }, [
    activateReviewTab,
    presentedPageIds,
    browserBoundsSyncTriggerByPanel,
    closeEphemeralPanelTab,
    closeTab,
    composerEnterBehavior,
    createBrowserTabToRight,
    createManualTab,
    ensureBlankSessionForProject,
    openPageInNewChat,
    onOpenAutomations,
    onOpenHooksSettings,
    onOpenLocalEnvironmentsSettings,
    onQueueingEnabledChange,
    onRefreshSessions,
    onTogglePageStageHistoryModal,
    onUpdateSessionViewTab,
    openAttachedThreadSession,
    openAttachedThreadSessionById,
    openCanvasStage,
    openMcpAppSidePanel,
    openPageTab,
    sendPageToChat,
    openSubagentsPanelTab,
    openTurnDiffFileInSidePanel,
    openWorkspaceFileTab,
    pageTitleStore,
    panelTabPresentationRegistry,
    projects,
    recreateSideChatPanelTab,
    reloadBrowserTab,
    surface,
    terminalSessionVersion,
    threadQueueFollowUpsEnabled,
  ]);

  const panelGroupTabs = useMemo<PanelGroupTabsByPanel>(() => {
    if (!activeRenderSession || !activeSessionPanelModel) {
      return {
        right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
        bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
      };
    }
    return buildPanelGroupTabsForSession(
      activeRenderSession,
      activeSessionPanelModel,
    );
  }, [
    activeRenderSession,
    activeSessionPanelModel,
    buildPanelGroupTabsForSession,
  ]);

  panelGroupTabsRef.current = panelGroupTabs;

  useEffect(() => {
    const nextControllerKeys = new Set<string>();
    if (activeRenderSession) {
      for (const panelId of ["right", "bottom"] as const) {
        for (
          const leafId of Object.keys(
            panelGroupTabs[panelId].itemsByLeafId,
          )
        ) {
          nextControllerKeys.add(
            makeWorkbenchSessionPanelSlotKey(
              activeRenderSession.id,
              panelId,
              leafId,
            ),
          );
        }
      }
    }
    for (
      const controllerKey of
        panelTabPresentationControllerKeysRef.current
    ) {
      if (nextControllerKeys.has(controllerKey)) continue;
      panelTabPresentationRegistry.releaseController(controllerKey);
    }
    panelTabPresentationControllerKeysRef.current = nextControllerKeys;
  }, [
    activeRenderSession,
    panelGroupTabs,
    panelTabPresentationControllerKeysRef,
    panelTabPresentationRegistry,
  ]);

  useEffect(() => {
    if (!activeRenderSession) return;
    const activeSessionPrefix = `${makeWorkbenchSessionPanelOwnerKey(
      activeRenderSession.id,
    )}:`;
    const currentKeys = new Set<string>();

    for (const panelId of ["right", "bottom"] as const) {
      const panelTabs = panelGroupTabs[panelId];
      for (
        const [leafId, tabs] of Object.entries(
          panelTabs.itemsByLeafId,
        )
      ) {
        const key = makeWorkbenchSessionPanelSlotKey(
          activeRenderSession.id,
          panelId,
          leafId,
        );
        currentKeys.add(key);
        const visibleTabIds = new Set(tabs.map((tab) => tab.id));
        const activeTabId =
          panelTabs.activeTabIdsByLeafId[leafId] ?? null;
        const durableLeaf = findWorkbenchPanelLeaf(
          activeRenderSession.panels[panelId].layout,
          leafId,
        );
        const durableMru = durableLeaf?.mruTabIds ?? [];
        const currentMru = panelTabMruByLeafRef.current[key] ?? [];
        const prunedMru = uniqueStringList([
          ...currentMru,
          ...durableMru,
        ]).filter((tabId) => visibleTabIds.has(tabId));
        const nextMru = activeTabId && visibleTabIds.has(activeTabId)
          ? [
              activeTabId,
              ...prunedMru.filter((tabId) => tabId !== activeTabId),
            ]
          : prunedMru;

        if (nextMru.length === 0) {
          delete panelTabMruByLeafRef.current[key];
          continue;
        }

        panelTabMruByLeafRef.current[key] = nextMru;
      }
    }

    for (const key of Object.keys(panelTabMruByLeafRef.current)) {
      if (!key.startsWith(activeSessionPrefix)) continue;
      if (currentKeys.has(key)) continue;
      delete panelTabMruByLeafRef.current[key];
    }
  }, [
    activeRenderSession,
    panelGroupTabs,
    panelTabMruByLeafRef,
  ]);

  return {
    panelGroupTabs,
    browserRetentionTabs:
      activeSessionPanelModel?.browserRetentionTabs ?? [],
    visibleBrowserTabIds:
      activeSessionPanelModel?.visibleBrowserTabIds ?? new Set<string>(),
  };
}
