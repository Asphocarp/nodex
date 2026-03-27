import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import type { SpaceRef } from "@/lib/use-workbench-state";
import { LeftSidebar, type StageSidebarGroup } from "./left-sidebar";
import { ProjectManagerPopover } from "./left-sidebar-project-manager";

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
        activeProjectId="default"
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
        onOpenSettings={() => {}}
        projectPickerOpenTick={0}
        onCreateProject={async () => PROJECTS[0]}
        onDeleteProject={async () => true}
        onRenameProject={async () => PROJECTS[0]}
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

export const ProjectManagerOpen: Story = {
  render: () => <ProjectManagerHarness />,
};
