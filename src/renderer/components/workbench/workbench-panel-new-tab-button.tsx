import { useState } from "react";
import {
  CodexSidePanelPlusIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import {
  filterAvailablePanelActions,
  isNodexPanelOptionAction,
  isPanelDestinationAction,
  PANEL_NEW_TAB_ACTIONS,
  resolvePanelActionShortcutLabel,
} from "@/lib/workbench-panel-actions";
import {
  projectWorkspaceRootOrNull,
} from "@/lib/workbench-workspace-context";
import type {
  useWorkbenchPanelCommandRouter,
} from "@/lib/use-workbench-panel-command-router";
import type {
  useWorkbenchPanelLifecycle,
} from "@/lib/use-workbench-panel-lifecycle";
import type {
  WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import type {
  CommandKeymapState,
} from "../../../shared/command-keybindings";
import type {
  PanelId,
  Project,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { PanelDestinationPicker } from "./panel-destination-picker";
import type {
  PanelDestinationPickerScope,
} from "./panel-destination-picker-model";
import {
  TOOLBAR_BUTTON_BASE_CLASS,
  TOOLBAR_BUTTON_GHOST_CLASS,
} from "@/lib/workbench-toolbar-control-styles";

type PanelCommands =
  Pick<
    ReturnType<typeof useWorkbenchPanelCommandRouter>,
    | "dispatchPanelAction"
  | "focusOrCreateProjectDbViewTab"
    | "openPanelDestinationFromPicker"
  >
  & Pick<
    ReturnType<typeof useWorkbenchPanelLifecycle>,
    "activatePanelGroup"
  >;

interface WorkbenchPanelNewTabButtonProps {
  readonly session: WorkbenchSessionRenderProjection;
  readonly projects: readonly Project[];
  readonly panelId: PanelId;
  readonly leafId: string;
  readonly isMac: boolean;
  readonly commandKeymapState?: CommandKeymapState | null;
  readonly commands: PanelCommands;
}

function hasProjectDbView(
  session: WorkbenchSessionRenderProjection,
  projectId: string,
): boolean {
  return session.tabs.some((tab) =>
    tab.kind === "db_view"
    && "projectId" in tab.config
    && tab.config.projectId === projectId
  );
}

/**
 * Self-contained panel action menu. The menu owns its transient open state and
 * routes semantic choices through the Panel Commands port.
 */
export function WorkbenchPanelNewTabButton({
  session,
  projects,
  panelId,
  leafId,
  isMac,
  commandKeymapState,
  commands,
}: WorkbenchPanelNewTabButtonProps) {
  const [open, setOpen] = useState(false);
  const actions = filterAvailablePanelActions(
    PANEL_NEW_TAB_ACTIONS,
    session.tabs,
    panelId,
    session.projectId,
    Boolean(session.thread),
    session.thread?.cwd,
    session.projectId === null
      ? null
      : projectWorkspaceRootOrNull(
          projects.find(
            (project) => project.id === session.projectId,
          ),
        ),
  );
  const title = panelId === "right"
    ? "Open side panel tab"
    : "Open bottom panel tab";

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      sideOffset={6}
      contentWidth="menuWide"
      triggerButton={(
        <button
          type="button"
          className={cn(
            TOOLBAR_BUTTON_BASE_CLASS,
            TOOLBAR_BUTTON_GHOST_CLASS,
          )}
          title={title}
          aria-label={title}
        >
          <CodexSidePanelPlusIcon className="icon-xs" />
        </button>
      )}
    >
      {actions.map((action, index) => {
        const Icon = action.Icon;
        const showNodexSeparator =
          isNodexPanelOptionAction(action)
          && !isNodexPanelOptionAction(
            actions[index - 1] ?? action,
          );
        const shouldCreateCurrentProjectDbView =
          action.kind === "db_view"
          && session.projectId !== null
          && !hasProjectDbView(session, session.projectId);

        return (
          <div key={action.kind}>
            {showNodexSeparator
              ? <NodexDropdownSeparator />
              : null}
            {shouldCreateCurrentProjectDbView ? (
              <NodexDropdownItem
                leftSlot={<Icon className="icon-sm" />}
                keyboardShortcut={resolvePanelActionShortcutLabel(
                  action,
                  isMac,
                  commandKeymapState,
                )}
                onSelect={() => {
                  void (async () => {
                    await commands.activatePanelGroup(
                      panelId,
                      leafId,
                    );
                    await commands.focusOrCreateProjectDbViewTab(
                      panelId,
                      leafId,
                    );
                  })();
                }}
              >
                {action.label}
              </NodexDropdownItem>
            ) : isPanelDestinationAction(action) ? (
              <NodexDropdownFlyoutSubmenuItem
                label={action.label}
                leftSlot={<Icon className="icon-sm" />}
                contentClassName="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0"
              >
                <PanelDestinationPicker
                  projects={projects}
                  scope={
                    (action.kind === "db_view"
                      ? "db-only"
                      : "page-only") as PanelDestinationPickerScope
                  }
                  ariaLabel={
                    action.kind === "db_view"
                      ? "Open DB view"
                      : "Open Page"
                  }
                  placeholder={
                    action.kind === "db_view"
                      ? "Open DB…"
                      : "Open Page…"
                  }
                  currentProjectId={session.projectId}
                  onClose={() => setOpen(false)}
                  onAccept={async (destination) => {
                    await commands.openPanelDestinationFromPicker(
                      destination,
                      panelId,
                      leafId,
                    );
                    setOpen(false);
                  }}
                />
              </NodexDropdownFlyoutSubmenuItem>
            ) : (
              <NodexDropdownItem
                leftSlot={<Icon className="icon-sm" />}
                keyboardShortcut={resolvePanelActionShortcutLabel(
                  action,
                  isMac,
                  commandKeymapState,
                )}
                onSelect={() => {
                  void commands.dispatchPanelAction(
                    action.kind,
                    { panelId, leafId },
                  );
                }}
              >
                {action.label}
              </NodexDropdownItem>
            )}
          </div>
        );
      })}
    </NodexDropdownMenu>
  );
}
