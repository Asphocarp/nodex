import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { Project, WorkspaceRecord } from "@/lib/types";
import type { SpaceRef } from "@/lib/use-workbench-state";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { LeftSidebar, type StageSidebarGroup } from "./left-sidebar";
import { ProjectManagerPopover } from "./left-sidebar-project-manager";
import { LeftSidebarWorkspaceManager } from "./left-sidebar-workspace-manager";
import {
  SidebarNewChatButton,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";

const PROJECTS: Project[] = [
  {
    id: "default",
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex",
    created: new Date("2026-03-01T00:00:00.000Z"),
  },
  {
    id: "bundle",
    name: "Codex bundle",
    description: "",
    workspacePath: "/Users/asc/repo/devtools-codex",
    created: new Date("2026-03-02T00:00:00.000Z"),
  },
];

const SPACES: SpaceRef[] = [
  { projectId: "default", colorToken: "var(--accent-blue)", initial: "N" },
  { projectId: "bundle", colorToken: "var(--accent-green)", initial: "C" },
];

const WORKSPACES: WorkspaceRecord[] = [
  {
    id: "default",
    name: "Default",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    layout: {} as WorkspaceRecord["layout"],
  },
  {
    id: "review",
    name: "Review lane",
    icon: "🧭",
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
    layout: {} as WorkspaceRecord["layout"],
  },
];

function SidebarSectionMenuHarness() {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [showAllItemsBySection, setShowAllItemsBySection] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>("[aria-label='Threads actions']");
      trigger?.click();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const groups: StageSidebarGroup[] = [
    {
      id: "threads",
      label: "Threads",
      active: true,
      expanded: true,
      onFocus: () => {},
      onToggleExpanded: () => {},
      moreActions: {
        itemLimit: 10,
        canMoveUp: false,
        canMoveDown: true,
        onItemLimitChange: () => {},
        onMoveUp: () => {},
        onMoveDown: () => {},
        onHide: () => {},
      },
      sections: [
        {
          id: "recent-threads",
          label: "Recent",
          items: [
            { id: "1", label: "Settings parity", onSelect: () => {}, active: true },
            { id: "2", label: "Storybook regressions", onSelect: () => {} },
          ],
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-(--background)">
      <LeftSidebar
        projects={PROJECTS}
        spaces={SPACES}
        workspaces={WORKSPACES}
        activeProjectId="default"
        activeWorkspaceId="default"
        stageGroups={groups}
        collapsed={false}
        width={280}
        expandedSections={expandedSections}
        showAllItemsBySection={showAllItemsBySection}
        onResizeWidth={() => {}}
        onSetSectionExpanded={(sectionId, expanded) => {
          setExpandedSections((current) => ({ ...current, [sectionId]: expanded }));
        }}
        onSetSectionShowAll={(sectionId, showAll) => {
          setShowAllItemsBySection((current) => ({ ...current, [sectionId]: showAll }));
        }}
        onSelectSpace={() => {}}
        onSelectWorkspace={() => {}}
        onOpenSettings={() => {}}
        projectPickerOpenTick={0}
        onCreateProject={async () => PROJECTS[0]}
        onDeleteProject={async () => true}
        onRenameProject={async () => PROJECTS[0]}
        onCreateWorkspace={async () => {}}
        onRenameWorkspace={async () => {}}
        onDeleteWorkspace={async () => {}}
      />
    </div>
  );
}

function StatusGroupOrderHarness() {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    "cards:status:done": true,
    "cards:status:in_review": true,
    "cards:status:in_progress": true,
  });
  const [showAllItemsBySection, setShowAllItemsBySection] = useState<Record<string, boolean>>({});

  const groups: StageSidebarGroup[] = [
    {
      id: "cards",
      label: "Cards",
      active: true,
      expanded: true,
      onFocus: () => {},
      onToggleExpanded: () => {},
      sections: [
        {
          id: "cards:status:done",
          label: "Done",
          count: 2,
          collapsible: true,
          items: [
            { id: "done-1", label: "Release notarized build", onSelect: () => {}, active: true },
            { id: "done-2", label: "Archive completed sync job", onSelect: () => {} },
          ],
        },
        {
          id: "cards:status:in_review",
          label: "In Review",
          count: 1,
          collapsible: true,
          items: [{ id: "review-1", label: "Check thread transcript parity", onSelect: () => {} }],
        },
        {
          id: "cards:status:in_progress",
          label: "In Progress",
          count: 2,
          collapsible: true,
          items: [
            { id: "progress-1", label: "Tune sidebar density", onSelect: () => {} },
            { id: "progress-2", label: "Wire card search filters", onSelect: () => {} },
          ],
        },
        {
          id: "cards:status:backlog",
          label: "Backlog",
          count: 1,
          collapsible: true,
          items: [{ id: "backlog-1", label: "Investigate branch selector", onSelect: () => {} }],
        },
        {
          id: "cards:status:draft",
          label: "Draft",
          count: 1,
          collapsible: true,
          items: [{ id: "draft-1", label: "Sketch dependency audit", onSelect: () => {} }],
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-(--background)">
      <LeftSidebar
        projects={PROJECTS}
        spaces={SPACES}
        workspaces={WORKSPACES}
        activeProjectId="default"
        activeWorkspaceId="default"
        stageGroups={groups}
        collapsed={false}
        width={280}
        expandedSections={expandedSections}
        showAllItemsBySection={showAllItemsBySection}
        onResizeWidth={() => {}}
        onSetSectionExpanded={(sectionId, expanded) => {
          setExpandedSections((current) => ({ ...current, [sectionId]: expanded }));
        }}
        onSetSectionShowAll={(sectionId, showAll) => {
          setShowAllItemsBySection((current) => ({ ...current, [sectionId]: showAll }));
        }}
        onSelectSpace={() => {}}
        onSelectWorkspace={() => {}}
        onOpenSettings={() => {}}
        projectPickerOpenTick={0}
        onCreateProject={async () => PROJECTS[0]}
        onDeleteProject={async () => true}
        onRenameProject={async () => PROJECTS[0]}
        onCreateWorkspace={async () => {}}
        onRenameWorkspace={async () => {}}
        onDeleteWorkspace={async () => {}}
      />
    </div>
  );
}

function ProjectManagerHarness() {
  return (
    <div className="min-h-screen bg-(--background) p-8">
      <ProjectManagerPopover
        projects={PROJECTS}
        spaces={SPACES}
        activeProjectId="default"
        onSelectSpace={() => {}}
        onCreateProject={async () => PROJECTS[0]}
        onDeleteProject={async () => true}
        onRenameProject={async () => PROJECTS[0]}
        open={true}
        onOpenChange={() => {}}
        trigger={(
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg bg-token-main-surface-secondary text-token-foreground ring-1 ring-token-border"
          >
            +
          </button>
        )}
      />
    </div>
  );
}

function SidebarNewChatControlsHarness() {
  return (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-(--background) p-8">
        <div className="w-[280px] bg-(--background-secondary) py-1">
          <SidebarNewChatButton shortcutLabel="⌘N" onClick={() => {}} />
          <div className="mt-3 px-(--sidebar-shell-padding-x)">
            <div className="group/folder-row flex min-h-7.5 items-center gap-1.5 rounded-xl pl-(--sidebar-row-padding-x) pr-(--sidebar-header-padding-x) py-1 text-(--sidebar-foreground) hover:bg-(--sidebar-accent)">
              <span className="min-w-0 flex-1 truncate text-sm">Codex bundle</span>
              <SidebarProjectNewChatButton
                label="Start new chat in Codex bundle"
                className="opacity-100"
                onClick={() => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function WorkspaceFooterHarness({
  activeWorkspaceId = "default",
  workspaces = WORKSPACES,
  openManager = false,
}: {
  activeWorkspaceId?: string;
  workspaces?: WorkspaceRecord[];
  openManager?: boolean;
}) {
  useEffect(() => {
    if (!openManager) return;
    const frameId = window.requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>("[title='Manage workspaces']");
      trigger?.click();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [openManager]);

  return (
    <div className="flex min-h-screen items-end bg-(--background) p-8">
      <div className="w-[280px] bg-(--background-secondary)">
        <LeftSidebarWorkspaceManager
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={() => {}}
          onCreateWorkspace={async () => {}}
          onRenameWorkspace={async () => {}}
          onDeleteWorkspace={async () => {}}
          onOpenSettings={() => {}}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Sidebar",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SectionMenuOpen: Story = {
  render: () => <SidebarSectionMenuHarness />,
};

export const StatusGroupsReversed: Story = {
  render: () => <StatusGroupOrderHarness />,
};

export const ProjectManagerOpen: Story = {
  render: () => <ProjectManagerHarness />,
};

export const NewChatControls: Story = {
  render: () => <SidebarNewChatControlsHarness />,
};

export const WorkspaceFooter: Story = {
  render: () => <WorkspaceFooterHarness />,
};

export const WorkspaceFooterLongNames: Story = {
  render: () => (
    <WorkspaceFooterHarness
      activeWorkspaceId="very-long"
      workspaces={[
        ...WORKSPACES,
        {
          id: "very-long",
          name: "A very long workspace name for context-heavy review",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-03T00:00:00.000Z",
          layout: {} as WorkspaceRecord["layout"],
        },
      ]}
    />
  ),
};

export const WorkspaceManagerOpen: Story = {
  render: () => <WorkspaceFooterHarness openManager />,
};
