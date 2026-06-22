import { useState } from "react";
import type { Project, ProjectCreateInput } from "@/lib/types";
import {
  CodexArchiveIcon,
  CodexProjectActionsIcon,
  CodexProjectCollapseAllIcon,
  CodexProjectFolderIcon,
  CodexProjectReopenPreviousIcon,
  CodexSidebarCreatedIcon,
  CodexSidebarManualOrderIcon,
  CodexSidebarSortClockIcon,
  CodexSidebarUpdatedIcon,
  CodexSessionPinIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownRadioGroup,
  NodexDropdownRadioItem,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import {
  normalizeSidebarPinnedOrganizationMode,
  type SidebarPinnedOrganizationMode,
} from "@/lib/use-workbench-state";
import type { SidebarProjectGroupCollapseAction } from "@/lib/sidebar-project-group-collapse-action";
import { CodexSidebarActionButton } from "./codex-sidebar";
import { SidebarProjectAddMenu } from "./sidebar-project-add-menu";

const PROJECT_SIDEBAR_OPTIONS_CONTENT_CLASS = "min-w-[172px] max-w-[240px]";
const PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS = "min-w-[180px]";
const PROJECT_SIDEBAR_MENU_ICON_CLASS = "icon-xs opacity-75 group-focus:opacity-100 group-hover:opacity-100";
const SIDEBAR_PINNED_ORGANIZATION_OPTIONS: readonly {
  value: SidebarPinnedOrganizationMode;
  label: string;
}[] = [
  { value: "byProject", label: "By project" },
  { value: "manualOrder", label: "Manual order" },
];

export function SidebarProjectsSectionActions({
  projectGroupCollapseAction,
  onProjectGroupCollapseAction,
  onCreateProject,
  openSetupTick,
  pinnedOrganizationMode,
  onPinnedOrganizationModeChange,
}: {
  projectGroupCollapseAction?: SidebarProjectGroupCollapseAction | null;
  onProjectGroupCollapseAction?: (action: SidebarProjectGroupCollapseAction) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  openSetupTick: number;
  pinnedOrganizationMode?: SidebarPinnedOrganizationMode;
  onPinnedOrganizationModeChange?: (mode: SidebarPinnedOrganizationMode) => void;
}) {
  const collapseActionLabel = projectGroupCollapseAction === "collapse-all"
    ? "Collapse all"
    : projectGroupCollapseAction === "reopen-previous"
      ? "Reopen previous"
      : null;

  return (
    <>
      {projectGroupCollapseAction && collapseActionLabel ? (
        <CodexSidebarActionButton
          label={collapseActionLabel}
          data-app-action-sidebar-projects-collapse-action={projectGroupCollapseAction}
          onClick={() => onProjectGroupCollapseAction?.(projectGroupCollapseAction)}
        >
          {projectGroupCollapseAction === "collapse-all"
            ? <CodexProjectCollapseAllIcon />
            : <CodexProjectReopenPreviousIcon />}
        </CodexSidebarActionButton>
      ) : null}
      <SidebarProjectOptionsMenu
        pinnedOrganizationMode={pinnedOrganizationMode}
        onPinnedOrganizationModeChange={onPinnedOrganizationModeChange}
      />
      <SidebarProjectAddMenu
        onCreateProject={onCreateProject}
        openSetupTick={openSetupTick}
      />
    </>
  );
}

function SidebarProjectOptionsMenu({
  pinnedOrganizationMode,
  onPinnedOrganizationModeChange,
}: {
  pinnedOrganizationMode?: SidebarPinnedOrganizationMode;
  onPinnedOrganizationModeChange?: (mode: SidebarPinnedOrganizationMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedPinnedOrganizationMode = normalizeSidebarPinnedOrganizationMode(pinnedOrganizationMode);
  const pinnedOrganizationDisabled = onPinnedOrganizationModeChange == null;

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      contentClassName={PROJECT_SIDEBAR_OPTIONS_CONTENT_CLASS}
      triggerButton={(
        <CodexSidebarActionButton
          label="Project sidebar options"
          data-app-action-sidebar-project-options-menu=""
        >
          <CodexProjectActionsIcon />
        </CodexSidebarActionButton>
      )}
    >
      <NodexDropdownItem
        disabled
        leftSlot={<CodexArchiveIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        data-app-action-sidebar-project-options-archive-all=""
      >
        Archive all chats
      </NodexDropdownItem>
      <NodexDropdownSeparator paddingClassName="pt-1 pb-2" />
      <NodexDropdownFlyoutSubmenuItem
        label="Organize pins"
        contentClassName={PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS}
        leftSlot={<CodexSessionPinIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
      >
        <NodexDropdownRadioGroup
          value={normalizedPinnedOrganizationMode}
          onValueChange={(value) => {
            if (!onPinnedOrganizationModeChange) return;
            onPinnedOrganizationModeChange(normalizeSidebarPinnedOrganizationMode(value));
          }}
        >
          {SIDEBAR_PINNED_ORGANIZATION_OPTIONS.map((option) => (
            <NodexDropdownRadioItem
              key={option.value}
              value={option.value}
              disabled={pinnedOrganizationDisabled}
              leftSlot={option.value === "byProject"
                ? <CodexProjectFolderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />
                : <CodexSidebarManualOrderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
            >
              {option.label}
            </NodexDropdownRadioItem>
          ))}
        </NodexDropdownRadioGroup>
      </NodexDropdownFlyoutSubmenuItem>
      <NodexDropdownFlyoutSubmenuItem
        label="Organize sidebar"
        contentClassName={PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS}
        leftSlot={<CodexProjectFolderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
      >
        <NodexDropdownItem
          disabled
          leftSlot={<CodexProjectFolderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
          rightSlot={<NodexDropdownSelectedIcon />}
        >
          By project
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<CodexSidebarSortClockIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Chronological list
        </NodexDropdownItem>
      </NodexDropdownFlyoutSubmenuItem>
      <NodexDropdownFlyoutSubmenuItem
        label="Sort by"
        contentClassName={PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS}
        leftSlot={<CodexSidebarSortClockIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
      >
        <NodexDropdownItem
          leftSlot={<CodexSidebarManualOrderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
          rightSlot={<NodexDropdownSelectedIcon />}
        >
          Manual order
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<CodexSidebarCreatedIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Created
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<CodexSidebarUpdatedIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Updated
        </NodexDropdownItem>
      </NodexDropdownFlyoutSubmenuItem>
    </NodexDropdownMenu>
  );
}
