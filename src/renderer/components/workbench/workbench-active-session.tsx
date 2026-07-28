import {
  type ComponentProps,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  motion,
  type MotionStyle,
  type MotionValue,
} from "motion/react";
import {
  APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
} from "@/lib/app-shell-layers";
import {
  filterAvailablePanelActions,
  PANEL_NEW_TAB_ACTIONS,
} from "@/lib/workbench-panel-actions";
import type {
  useWorkbenchPanelCommandRouter,
} from "@/lib/use-workbench-panel-command-router";
import type {
  useWorkbenchPanelLifecycle,
} from "@/lib/use-workbench-panel-lifecycle";
import {
  projectWorkspaceRootOrNull,
} from "@/lib/workbench-workspace-context";
import type {
  SessionPanelRenderModel,
} from "@/lib/workbench-panel-projection";
import type {
  WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import type {
  PanelId,
  Project,
} from "@/lib/types";
import {
  createThreadScopeIdentityRegistry,
  WorkbenchSessionScopePath,
  resolveProjectSessionThreadScopeDescriptor,
} from "@/lib/workbench-ui-scopes";
import { cn } from "@/lib/utils";
import type {
  PanelGroupTabsByPanel,
} from "./use-workbench-panel-projection";
import { ReviewRouteOpenAdapter } from "./workbench-review-route-adapter";
import { SessionThreadPage } from "./workbench-session-thread-route";
import { WorkbenchPanelHost } from "./workbench-panel-host";

type ProjectSession = WorkbenchSessionRenderProjection;
type ThreadPageProps = Omit<
  ComponentProps<typeof SessionThreadPage>,
  "onOpenSummaryGitReview" | "onOpenTurnDiffReview"
>;
type PanelLifecycle = Pick<
  ReturnType<typeof useWorkbenchPanelLifecycle>,
  | "activatePanelGroup"
  | "closePanelTab"
  | "moveTabToPanel"
  | "pinPreviewTab"
  | "reorderTabs"
  | "resizePanelGroup"
  | "selectPanelTab"
  | "splitPanelGroup"
>;
type PanelCommands = Pick<
  ReturnType<typeof useWorkbenchPanelCommandRouter>,
  | "dispatchPanelAction"
  | "openPanelDestinationFromPicker"
  | "rememberFocusedPanelGroup"
>;

interface WorkbenchActiveSessionProps {
  readonly session: ProjectSession;
  readonly model: SessionPanelRenderModel;
  readonly projects: Project[];
  readonly project: Project | null;
  readonly sessionError: string | null;
  readonly threadScopeIdentityRegistry: ReturnType<
    typeof createThreadScopeIdentityRegistry
  >;
  readonly threadPageProps: ThreadPageProps;
  readonly activateReviewTab: ComponentProps<
    typeof ReviewRouteOpenAdapter
  >["activateReviewTab"];
  readonly panelGroupTabs: PanelGroupTabsByPanel;
  readonly panelLifecycle: PanelLifecycle;
  readonly panelCommands: PanelCommands;
  readonly renderPanelNewTabButton: (
    session: ProjectSession,
    panelId: PanelId,
    leafId: string,
  ) => ReactNode;
  readonly layout: {
    readonly appShellMainContentLayout: string;
    readonly frameBorderVisible: boolean;
    readonly rightPanelTargetWidth: MotionValue<number>;
    readonly bottomPanelHeight: MotionValue<number>;
    readonly rightPanel: {
      readonly mounted: boolean;
      readonly opacity: MotionValue<number>;
      readonly animatedSize: MotionValue<number>;
    };
    readonly bottomPanel: {
      readonly mounted: boolean;
      readonly opacity: MotionValue<number>;
      readonly animatedSize: MotionValue<number>;
    };
    readonly rightPanelHeaderStartInsetWidth: number;
    readonly panelTabScrollEndPaddingPx: number;
    readonly bottomPanelGlobalHeaderInsetWidth: number;
  };
  readonly chrome: {
    readonly isMac: boolean;
    readonly commandKeymapState:
      ComponentProps<typeof WorkbenchPanelHost>["commandKeymapState"];
    readonly rightPanelHeaderAfterList: ReactNode;
    readonly bottomPanelGlobalHeaderControls: ReactNode;
    readonly setRightPanelComposerOverlayTarget: Dispatch<
      SetStateAction<HTMLElement | null>
    >;
    readonly resizeRightPanel: (
      event: ReactPointerEvent<HTMLDivElement>,
    ) => void;
    readonly resizeBottomPanel: (
      event: ReactPointerEvent<HTMLDivElement>,
    ) => void;
  };
}

function hasProjectDbView(
  session: ProjectSession,
  projectId: string,
): boolean {
  return session.tabs.some((tab) =>
    tab.kind === "db_view"
    && "projectId" in tab.config
    && tab.config.projectId === projectId
  );
}

/**
 * Session route Implementation. It owns the thread/panel composition and maps
 * lifecycle/feature command ports into the two panel hosts.
 */
export function WorkbenchActiveSession({
  session,
  model,
  projects,
  project,
  sessionError,
  threadScopeIdentityRegistry,
  threadPageProps,
  activateReviewTab,
  panelGroupTabs,
  panelLifecycle,
  panelCommands,
  renderPanelNewTabButton,
  layout,
  chrome,
}: WorkbenchActiveSessionProps) {
  const availableRightPanelActions = filterAvailablePanelActions(
    PANEL_NEW_TAB_ACTIONS,
    session.tabs,
    "right",
    session.projectId,
    Boolean(session.thread),
    session.thread?.cwd,
    projectWorkspaceRootOrNull(project),
  );
  const availableBottomPanelActions = filterAvailablePanelActions(
    PANEL_NEW_TAB_ACTIONS,
    session.tabs,
    "bottom",
    session.projectId,
    Boolean(session.thread),
    session.thread?.cwd,
    projectWorkspaceRootOrNull(project),
  );
  const threadScopeDescriptor =
    resolveProjectSessionThreadScopeDescriptor(
      threadScopeIdentityRegistry,
      session,
    );
  const {
    activatePanelGroup,
    closePanelTab,
    moveTabToPanel,
    pinPreviewTab,
    reorderTabs,
    resizePanelGroup,
    selectPanelTab,
    splitPanelGroup,
  } = panelLifecycle;
  const {
    dispatchPanelAction,
    openPanelDestinationFromPicker,
    rememberFocusedPanelGroup,
  } = panelCommands;

  const renderPanelHost = (panelId: PanelId) => {
    const panel = model[panelId === "right"
      ? "rightPanel"
      : "bottomPanel"];
    const availableActions = panelId === "right"
      ? availableRightPanelActions
      : availableBottomPanelActions;
    return (
      <WorkbenchPanelHost
        sessionId={session.id}
        sessionProjectId={session.projectId}
        panelId={panelId}
        layout={panel.layout}
        tabItemsByLeafId={panelGroupTabs[panelId].itemsByLeafId}
        activeTabIdsByLeafId={
          panelGroupTabs[panelId].activeTabIdsByLeafId
        }
        availableActions={availableActions}
        projects={projects}
        isMac={chrome.isMac}
        commandKeymapState={chrome.commandKeymapState}
        currentProjectDbViewExists={
          panelId === "right"
          && session.projectId !== null
          && hasProjectDbView(session, session.projectId)
        }
        renderAfterTabs={(leafId) =>
          renderPanelNewTabButton(session, panelId, leafId)}
        renderAfterList={
          panelId === "right"
            ? () => chrome.rightPanelHeaderAfterList
            : undefined
        }
        headerStartInsetPx={
          panelId === "right"
            ? layout.rightPanelHeaderStartInsetWidth
            : undefined
        }
        headerEndInsetPx={
          panelId === "bottom"
            ? layout.bottomPanelGlobalHeaderInsetWidth
            : undefined
        }
        tabScrollEndPaddingPx={layout.panelTabScrollEndPaddingPx}
        commands={{
          selectTab: (leafId, tabId) => {
            void selectPanelTab(panelId, tabId, leafId);
          },
          closeTab: (leafId, tabId) => {
            void closePanelTab(panelId, tabId, leafId);
          },
          pinTab: (leafId, tabId) => {
            void pinPreviewTab(panelId, tabId, leafId);
          },
          reorderTab: (leafId, tabId, targetIndex) => {
            void reorderTabs(
              panelId,
              tabId,
              targetIndex,
              leafId,
            );
          },
          moveTab: (
            tabId,
            targetPanelId,
            targetLeafId,
            targetIndex,
            splitTarget,
          ) => {
            void moveTabToPanel(
              tabId,
              targetPanelId,
              targetLeafId,
              targetIndex,
              splitTarget,
            );
          },
          splitGroup: (leafId, side, tabId) => {
            void splitPanelGroup(
              panelId,
              leafId,
              side,
              tabId,
            );
          },
          focusGroup: (leafId) => {
            rememberFocusedPanelGroup(panelId, leafId);
          },
          activateGroup: (leafId, tabId) => {
            void activatePanelGroup(panelId, leafId, tabId);
          },
          resizeGroup: (branchId, ratio) =>
            resizePanelGroup(panelId, branchId, ratio),
          openAction: (kind, leafId) => {
            void dispatchPanelAction(kind, {
              panelId,
              leafId,
            });
          },
          openDestination: async (destination, leafId) => {
            await openPanelDestinationFromPicker(
              destination,
              panelId,
              leafId,
            );
          },
        }}
      />
    );
  };

  return (
    <WorkbenchSessionScopePath
      thread={threadScopeDescriptor}
      route={{ routeKey: "/thread", kind: "thread" }}
      selected
    >
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        data-mounted-session-id={session.id}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <section
            data-testid="session-thread-page"
            data-session-thread-page-hidden={
              model.rightPanelFullWidth ? "true" : "false"
            }
            data-app-shell-main-content-layout={
              layout.appShellMainContentLayout
            }
            aria-hidden={
              model.rightPanelFullWidth ? "true" : undefined
            }
            className={cn(
              "app-shell-main-content-viewport relative flex min-h-0 min-w-0 flex-col",
              model.rightPanelFullWidth
                ? "w-0 flex-none overflow-hidden"
                : "flex-1",
            )}
          >
            <div
              className={cn(
                "app-shell-main-content-frame relative mt-(--app-shell-main-content-frame-top-offset) flex min-h-0 flex-1 flex-col border-t",
                layout.frameBorderVisible
                  ? "border-token-border-default"
                  : "border-transparent",
              )}
            >
              <div
                aria-hidden="true"
                data-app-shell-main-content-top-fade="full-bleed"
                className="app-shell-main-content-top-fade pointer-events-none absolute inset-x-0 top-0 z-20 h-4 bg-gradient-to-b from-token-main-surface-primary opacity-0 transition-opacity duration-200 browser:hidden"
              />
              {sessionError ? (
                <div className="border-b border-token-border px-3 py-2 text-xs text-token-text-secondary">
                  {sessionError}
                </div>
              ) : null}
              <ReviewRouteOpenAdapter
                activateReviewTab={activateReviewTab}
              >
                {({
                  onOpenTurnDiffReview,
                  onOpenSummaryGitReview,
                }) => (
                  <SessionThreadPage
                    {...threadPageProps}
                    onOpenTurnDiffReview={onOpenTurnDiffReview}
                    onOpenSummaryGitReview={onOpenSummaryGitReview}
                  />
                )}
              </ReviewRouteOpenAdapter>
            </div>
          </section>

          {layout.rightPanel.mounted ? (
            <motion.aside
              key={session.id}
              data-app-shell-focus-area="right-panel"
              data-testid="session-right-panel"
              data-right-panel-width-mode={
                model.rightPanelFullWidth ? "full" : "regular"
              }
              className={cn(
                "relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
                APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
              )}
              style={{
                opacity: layout.rightPanel.opacity,
                width: layout.rightPanel.animatedSize,
              }}
            >
              {model.sidePanelOpen
                && !model.rightPanelFullWidth ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize right panel"
                  className="group absolute top-0 bottom-0 left-0 z-40 flex w-4 -translate-x-2 cursor-col-resize touch-none select-none active:cursor-col-resize"
                  onPointerDown={chrome.resizeRightPanel}
                >
                  <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                </div>
              ) : null}

              <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
                <motion.div
                  ref={chrome.setRightPanelComposerOverlayTarget}
                  data-right-panel-composer-overlay-host="true"
                  className={cn(
                    "absolute top-0 right-0 bottom-0 min-w-0 bg-token-main-surface-primary",
                    !model.rightPanelFullWidth
                      && "border-l border-token-border",
                  )}
                  style={{
                    width: layout.rightPanelTargetWidth,
                    "--thread-content-top-inset":
                      "calc(var(--spacing) * 8)",
                  } as MotionStyle}
                >
                  {renderPanelHost("right")}
                </motion.div>
              </div>
            </motion.aside>
          ) : null}
        </div>

        {layout.bottomPanel.mounted ? (
          <motion.section
            data-app-shell-focus-area="bottom-panel"
            data-testid="session-bottom-panel"
            className="relative min-h-0 w-full shrink-0 overflow-visible"
            style={{
              opacity: layout.bottomPanel.opacity,
              height: layout.bottomPanel.animatedSize,
            }}
          >
            {model.bottomPanelOpen ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize bottom panel"
                className="group absolute top-0 left-0 right-0 z-40 flex h-4 -translate-y-2 cursor-row-resize touch-none select-none active:cursor-row-resize"
                onPointerDown={chrome.resizeBottomPanel}
              >
                <div className="pointer-events-none mx-auto h-px w-full bg-linear-to-r from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
              </div>
            ) : null}
            <div className="absolute inset-0 min-h-0 overflow-hidden">
              <motion.div
                className="absolute inset-x-0 top-0 min-h-0 border-t border-token-border bg-token-main-surface-primary"
                style={{
                  height: layout.bottomPanelHeight,
                  minHeight: layout.bottomPanelHeight,
                }}
              >
                {renderPanelHost("bottom")}
                {chrome.bottomPanelGlobalHeaderControls ? (
                  <div
                    data-testid="bottom-panel-global-header-actions"
                    className="pointer-events-none absolute top-0 right-0 z-30 flex h-toolbar items-center justify-end pr-2"
                  >
                    <div className="pointer-events-none flex h-full items-center gap-1">
                      {chrome.bottomPanelGlobalHeaderControls}
                    </div>
                  </div>
                ) : null}
              </motion.div>
            </div>
          </motion.section>
        ) : null}
      </div>
    </WorkbenchSessionScopePath>
  );
}
