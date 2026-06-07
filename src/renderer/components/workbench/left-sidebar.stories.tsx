import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { Project, ProjectSession, WorkspaceRecord } from "@/lib/types";
import type { SpaceRef } from "@/lib/use-workbench-state";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { LeftSidebar, type StageSidebarGroup } from "./left-sidebar";
import { ProjectManagerPopover } from "./left-sidebar-project-manager";
import { SidebarProjectsSection } from "./left-sidebar-projects-section";
import { LeftSidebarWorkspaceManager } from "./left-sidebar-workspace-manager";
import {
  SidebarNewChatButton,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";
import {
  CodexProjectRow,
  CodexProjectSessionList,
  CodexSidebarSection,
  CodexThreadRow,
} from "./codex-sidebar";

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

const SIDEBAR_PARITY_PROJECTS: Project[] = [
  {
    id: "nodex",
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex",
    created: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    id: "codex-electron-readable-bundle-with-a-very-long-name",
    name: "Codex Electron readable bundle with a very long project label",
    description: "",
    workspacePath: "/Users/asc/repo/devtools-codex/codex_electron_26.519.81530_to_be_readable",
    created: new Date("2026-06-02T00:00:00.000Z"),
  },
  {
    id: "missing-workspace",
    name: "Missing workspace path",
    description: "",
    workspacePath: "",
    created: new Date("2026-06-03T00:00:00.000Z"),
  },
];

const SIDEBAR_PARITY_SPACES: SpaceRef[] = [
  { projectId: "nodex", colorToken: "var(--accent-blue)", initial: "N" },
  { projectId: "codex-electron-readable-bundle-with-a-very-long-name", colorToken: "var(--accent-green)", initial: "C" },
  { projectId: "missing-workspace", colorToken: "var(--accent-yellow)", initial: "M" },
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

function CodexProjectsHarness({
  expanded = true,
  activeProjectId = "nodex",
  openActionsFor,
  projects = SIDEBAR_PARITY_PROJECTS,
}: {
  expanded?: boolean;
  activeProjectId?: string;
  openActionsFor?: string;
  projects?: Project[];
}) {
  useEffect(() => {
    if (!openActionsFor) return;
    const frameId = window.requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>(`[aria-label='Project actions for ${openActionsFor}']`);
      if (!trigger) return;
      const event = typeof PointerEvent === "function"
        ? new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false })
        : new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false });
      trigger.dispatchEvent(event);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [openActionsFor]);

  return (
    <NodexTooltipProvider>
      <div data-codex-window-type="electron" className="min-h-screen bg-token-bg-primary p-8">
        <div className="app-shell-left-panel w-[300px] overflow-visible py-4">
          <SidebarProjectsSection
            projects={projects}
            spaces={SIDEBAR_PARITY_SPACES}
            activeProjectId={activeProjectId}
            expanded={expanded}
            onToggleExpanded={() => {}}
            onSelectSpace={() => {}}
            onCreateProject={async () => projects[0] ?? null}
            onDeleteProject={async () => true}
            onRenameProject={async () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null}
            projectPickerOpenTick={0}
          />
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function makeStorySession(input: {
  id: string;
  title: string;
  isOverview?: boolean;
  threadId?: string;
}): ProjectSession {
  const tabId = `${input.id}:db`;
  return {
    id: input.id,
    projectId: "nodex",
    title: input.title,
    isOverview: input.isOverview ?? false,
    order: 0,
    leftPaneCollapsed: true,
    rightPaneCollapsed: false,
    rightPaneLayout: {
      version: 1,
      root: {
        type: "leaf",
        id: "main",
        tabIds: [tabId],
        activeTabId: tabId,
      },
    },
    thread: input.threadId
      ? {
        sessionId: input.id,
        projectId: "nodex",
        threadId: input.threadId,
        parentThreadId: undefined,
        threadName: input.title,
        threadPreview: "",
        modelProvider: "openai",
        cwd: "/Users/asc/repo/nodex",
        statusType: "notLoaded",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1_780_800_000_000,
        updatedAt: 1_780_800_000_000,
        linkedAt: "2026-06-07T00:00:00.000Z",
      }
      : null,
    tabs: [
      {
        id: tabId,
        sessionId: input.id,
        projectId: "nodex",
        kind: "db_view",
        title: "DB View",
        order: 0,
        config: { projectId: "nodex", view: "kanban" },
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ],
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

function CodexProjectSessionRowsHarness() {
  const project = SIDEBAR_PARITY_PROJECTS[0]!;
  const sessions = [
    makeStorySession({ id: "overview:nodex", title: "Overview", isOverview: true }),
    makeStorySession({ id: "thread:nodex:parity", title: "Mirror Codex Electron layout", threadId: "local:sidebar-parity" }),
    makeStorySession({ id: "thread:nodex:long", title: "Very long session title that should truncate before colliding with row actions", threadId: "local:long-title" }),
  ];

  return (
    <NodexTooltipProvider>
      <div data-codex-window-type="electron" className="min-h-screen bg-token-bg-primary p-8">
        <div className="app-shell-left-panel w-[300px] overflow-visible py-4">
          <CodexSidebarSection heading="Projects" collapsed={false} onToggle={() => {}}>
            <div className="pt-0.5">
              <div className="isolate flex flex-col [contain:layout]">
                <div className="flex flex-col" role="list" aria-label="Projects">
                  <CodexProjectRow
                    project={project}
                    active
                    expanded
                    onActivate={() => {}}
                    onStartNewChat={() => {}}
                    onRenameProject={async () => project}
                    onManageProject={() => {}}
                  >
                    <CodexProjectSessionList project={project}>
                      {sessions.map((session, index) => (
                        <CodexThreadRow
                          key={session.id}
                          session={session}
                          active={index === 1}
                          onSelect={() => {}}
                        />
                      ))}
                    </CodexProjectSessionList>
                  </CodexProjectRow>
                </div>
              </div>
            </div>
          </CodexSidebarSection>
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

export const CodexProjectsExpanded: Story = {
  render: () => <CodexProjectsHarness expanded activeProjectId="nodex" />,
};

export const CodexProjectsCollapsed: Story = {
  render: () => <CodexProjectsHarness expanded={false} activeProjectId="nodex" />,
};

export const CodexProjectActionsMenuOpen: Story = {
  render: () => <CodexProjectsHarness expanded activeProjectId="nodex" openActionsFor="Nodex" />,
};

export const CodexProjectsMissingWorkspacePath: Story = {
  render: () => <CodexProjectsHarness expanded activeProjectId="missing-workspace" />,
};

export const CodexProjectsLongLabels: Story = {
  render: () => (
    <CodexProjectsHarness
      expanded
      activeProjectId="codex-electron-readable-bundle-with-a-very-long-name"
    />
  ),
};

export const CodexProjectSessionRows: Story = {
  render: () => <CodexProjectSessionRowsHarness />,
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
