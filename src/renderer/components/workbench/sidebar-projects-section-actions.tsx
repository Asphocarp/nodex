import { useState } from "react";
import type { Project, ProjectCreateInput } from "@/lib/types";
import {
  ArchiveIcon,
  ProjectActionsIcon,
  ProjectCollapseAllIcon,
  ProjectFolderIcon,
  ProjectRemovedIcon,
  ProjectReopenPreviousIcon,
  SidebarCreatedIcon,
  SidebarManualOrderIcon,
  SidebarSortClockIcon,
  SidebarUpdatedIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import type { SidebarProjectGroupCollapseAction } from "@/lib/sidebar-project-group-collapse-action";
import { CodexSidebarActionButton } from "./codex-sidebar";
import { SidebarProjectAddButton } from "./sidebar-project-add-button";
import { RemovedProjectsDialog } from "./removed-projects-dialog";

const PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS = "min-w-[180px]";
const PROJECT_SIDEBAR_MENU_ICON_CLASS = "icon-xs";
export function SidebarProjectsSectionActions({
  projectGroupCollapseAction,
  onProjectGroupCollapseAction,
  onCreateProject,
  openCreateDialogTick,
}: {
  projectGroupCollapseAction?: SidebarProjectGroupCollapseAction | null;
  onProjectGroupCollapseAction?: (action: SidebarProjectGroupCollapseAction) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  openCreateDialogTick: number;
}) {
  const [removedProjectsOpen, setRemovedProjectsOpen] = useState(false);
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
            ? <ProjectCollapseAllIcon />
            : <ProjectReopenPreviousIcon />}
        </CodexSidebarActionButton>
      ) : null}
      <SidebarProjectOptionsMenu
        onOpenRemovedProjects={() => setRemovedProjectsOpen(true)}
      />
      <SidebarProjectAddButton
        onCreateProject={onCreateProject}
        openDialogTick={openCreateDialogTick}
      />
      <RemovedProjectsDialog
        open={removedProjectsOpen}
        onOpenChange={setRemovedProjectsOpen}
      />
    </>
  );
}

function SidebarProjectOptionsMenu({
  onOpenRemovedProjects,
}: {
  onOpenRemovedProjects: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      triggerButton={(
        <CodexSidebarActionButton
          label="Project sidebar options"
          data-app-action-sidebar-project-options-menu=""
        >
          <ProjectActionsIcon />
        </CodexSidebarActionButton>
      )}
    >
      <NodexDropdownItem
        disabled
        leftSlot={<ArchiveIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        data-app-action-sidebar-project-options-archive-all=""
      >
        Archive all chats
      </NodexDropdownItem>
      <NodexDropdownItem
        leftSlot={<ProjectRemovedIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        onSelect={() => {
          setOpen(false);
          onOpenRemovedProjects();
        }}
      >
        Removed projects…
      </NodexDropdownItem>
      <NodexDropdownSeparator paddingClassName="pt-1 pb-2" />
      <NodexDropdownFlyoutSubmenuItem
        label="Organize sidebar"
        contentClassName={PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS}
        leftSlot={<ProjectFolderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
      >
        <NodexDropdownItem
          disabled
          leftSlot={<ProjectFolderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
          rightSlot={<NodexDropdownSelectedIcon />}
        >
          By project
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<SidebarSortClockIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Chronological list
        </NodexDropdownItem>
      </NodexDropdownFlyoutSubmenuItem>
      <NodexDropdownFlyoutSubmenuItem
        label="Sort by"
        contentClassName={PROJECT_SIDEBAR_OPTIONS_SUBMENU_CLASS}
        leftSlot={<SidebarSortClockIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
      >
        <NodexDropdownItem
          leftSlot={<SidebarManualOrderIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
          rightSlot={<NodexDropdownSelectedIcon />}
        >
          Manual order
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<SidebarCreatedIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Created
        </NodexDropdownItem>
        <NodexDropdownItem
          disabled
          leftSlot={<SidebarUpdatedIcon className={PROJECT_SIDEBAR_MENU_ICON_CLASS} />}
        >
          Updated
        </NodexDropdownItem>
      </NodexDropdownFlyoutSubmenuItem>
    </NodexDropdownMenu>
  );
}
