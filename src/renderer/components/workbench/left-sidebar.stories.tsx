import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CodexAccountSnapshot, Project, ProjectSession } from "@/lib/types";
import type { SpaceRef } from "@/lib/use-workbench-state";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { SearchIcon } from "@/components/shared/icons";
import { makeProjectSessionPanelLayout } from "../../../shared/project-session-panel-layout";
import { LeftSidebar, type StageSidebarGroup } from "./left-sidebar";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { SidebarProjectsSection } from "./left-sidebar-projects-section";
import {
  SidebarNewChatButton,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";
import {
  CodexProjectRow,
  CodexProjectSessionList,
  CodexSidebarSection,
  CodexSidebarTopAction,
  CodexThreadRow,
  resolveCodexCommandPaletteShortcutLabel,
} from "./codex-sidebar";
import {
  replaceVisibleOrder,
  SidebarDropIndicator,
  SidebarProjectDndProvider,
  SidebarProjectSortableContext,
  usePinnedProjectDroppable,
  useSidebarGroupReorderController,
  type SidebarGroupDndController,
} from "./sidebar-project-group-dnd";

const PROJECTS: Project[] = [
  {
    id: "default",
    name: "Nodex",
    description: "",
    sources: [{ root: "/Users/asc/repo/nodex", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/nodex",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-01T00:00:00.000Z"),
    updated: new Date("2026-03-01T00:00:00.000Z"),
  },
  {
    id: "bundle",
    name: "Codex bundle",
    description: "",
    sources: [{ root: "/Users/asc/repo/devtools-codex", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-02T00:00:00.000Z"),
    updated: new Date("2026-03-02T00:00:00.000Z"),
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
    sources: [{ root: "/Users/asc/repo/nodex", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/nodex",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-01T00:00:00.000Z"),
    updated: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    id: "codex-electron-readable-bundle-with-a-very-long-name",
    name: "Codex Electron readable bundle with a very long project label",
    description: "",
    sources: [{ root: "/Users/asc/repo/devtools-codex/codex_electron_26.519.81530_to_be_readable", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex/codex_electron_26.519.81530_to_be_readable",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-02T00:00:00.000Z"),
    updated: new Date("2026-06-02T00:00:00.000Z"),
  },
  {
    id: "missing-workspace",
    name: "Missing workspace path",
    description: "",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-03T00:00:00.000Z"),
    updated: new Date("2026-06-03T00:00:00.000Z"),
  },
];

const SIDEBAR_PARITY_SPACES: SpaceRef[] = [
  { projectId: "nodex", colorToken: "var(--accent-blue)", initial: "N" },
  { projectId: "codex-electron-readable-bundle-with-a-very-long-name", colorToken: "var(--accent-green)", initial: "C" },
  { projectId: "missing-workspace", colorToken: "var(--accent-yellow)", initial: "M" },
];

const FOOTER_QUOTA_ACCOUNT: CodexAccountSnapshot = {
  account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
  requiresOpenAiAuth: false,
  pendingLogin: null,
  rateLimits: {
    primary: {
      usedPercent: 18,
      windowDurationMins: 300,
    },
    secondary: {
      usedPercent: 39,
      windowDurationMins: 7 * 24 * 60,
    },
  },
};

const FOOTER_LOW_QUOTA_ACCOUNT: CodexAccountSnapshot = {
  account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
  requiresOpenAiAuth: false,
  pendingLogin: null,
  rateLimits: {
    primary: {
      usedPercent: 91,
      windowDurationMins: 300,
    },
    secondary: {
      usedPercent: 72,
      windowDurationMins: 7 * 24 * 60,
    },
  },
};

const FOOTER_NO_LIMITS_ACCOUNT: CodexAccountSnapshot = {
  account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
  requiresOpenAiAuth: false,
  pendingLogin: null,
  rateLimits: null,
};

const FOOTER_SIGNED_OUT_ACCOUNT: CodexAccountSnapshot = {
  account: null,
  requiresOpenAiAuth: true,
  pendingLogin: null,
  rateLimits: null,
};

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
        onUpdateProject={async () => PROJECTS[0]}
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
        onUpdateProject={async () => PROJECTS[0]}
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
          <CodexSidebarTopAction
            label="Search"
            icon={<SearchIcon className="icon-xs" />}
            shortcutLabel={resolveCodexCommandPaletteShortcutLabel()}
            onClick={() => {}}
          />
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
  revealProjectDisclosureChevrons = false,
}: {
  expanded?: boolean;
  activeProjectId?: string;
  openActionsFor?: string;
  projects?: Project[];
  revealProjectDisclosureChevrons?: boolean;
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
      <div
        data-codex-window-type="electron"
        data-story-project-chevron-reveal={revealProjectDisclosureChevrons ? "" : undefined}
        className="min-h-screen bg-token-bg-primary p-8"
      >
        {revealProjectDisclosureChevrons ? (
          <style>
            {"[data-story-project-chevron-reveal] [data-app-action-sidebar-project-toggle-chevron] svg { opacity: 1; }"}
          </style>
        ) : null}
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
            onUpdateProject={async () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null}
            projectPickerOpenTick={0}
          />
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function sortPinnedStoryProjects(projects: Project[]) {
  return [...projects].filter((project) => project.pinned).sort((a, b) =>
    (a.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

function CodexSortableProjectSections({
  projects,
  onProjectsChange,
  forceDropIndicator = false,
  forceEmptyPinnedDropTarget = false,
}: {
  projects: Project[];
  onProjectsChange: (projects: Project[]) => void;
  forceDropIndicator?: boolean;
  forceEmptyPinnedDropTarget?: boolean;
}) {
  const projectOrderIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const pinnedProjects = useMemo(() => sortPinnedStoryProjects(projects), [projects]);
  const unpinnedProjects = useMemo(() => projects.filter((project) => !project.pinned), [projects]);
  const pinnedProjectIds = useMemo(() => pinnedProjects.map((project) => project.id), [pinnedProjects]);
  const unpinnedProjectIds = useMemo(() => unpinnedProjects.map((project) => project.id), [unpinnedProjects]);
  const pinnedDroppable = usePinnedProjectDroppable();

  const reorderUnpinned = useCallback((nextIds: string[]) => {
    const nextOrderIds = replaceVisibleOrder(projectOrderIds, unpinnedProjectIds, nextIds);
    const byId = new Map(projects.map((project) => [project.id, project]));
    onProjectsChange(nextOrderIds.map((id) => byId.get(id)).filter((project): project is Project => Boolean(project)));
  }, [onProjectsChange, projectOrderIds, projects, unpinnedProjectIds]);

  const reorderPinned = useCallback((nextIds: string[]) => {
    const pinnedOrderById = new Map(nextIds.map((id, index) => [id, index]));
    onProjectsChange(projects.map((project) => ({
      ...project,
      pinnedOrder: pinnedOrderById.get(project.id) ?? project.pinnedOrder,
    })));
  }, [onProjectsChange, projects]);

  const pinnedReorder = useSidebarGroupReorderController({
    groupIds: pinnedProjectIds,
    reorderGroups: reorderPinned,
  });
  const unpinnedReorder = useSidebarGroupReorderController({
    groupIds: unpinnedProjectIds,
    reorderGroups: reorderUnpinned,
  });

  const renderProjectRow = (project: Project, controller: SidebarGroupDndController) => (
    <CodexProjectRow
      key={project.id}
      project={project}
      active={project.id === "nodex"}
      expanded={project.id === "nodex"}
      groupDndController={controller}
      allowProjectReorder
      onActivate={() => {}}
      onSelectProject={() => {}}
      onUpdateProject={async () => project}
      onDeleteProject={async () => false}
      onSetProjectPinned={async (_projectId, input) => {
        onProjectsChange(projects.map((candidate) => candidate.id === project.id
          ? {
              ...candidate,
              pinned: input.pinned,
              pinnedOrder: input.pinned ? pinnedProjects.length : null,
            }
          : candidate));
        return project;
      }}
    />
  );

  return (
    <>
      {pinnedProjects.length > 0 ? (
        <div ref={pinnedDroppable.setNodeRef} className="relative">
          <CodexSidebarSection heading="Pinned" collapsed={false} onToggle={() => {}}>
            <div className="isolate flex flex-col [contain:layout]">
              <SidebarProjectSortableContext groupIds={pinnedReorder.groupIds}>
                <div className="flex flex-col" role="list" aria-label="Pinned">
                  {pinnedProjects.map((project, index) => (
                    <Fragment key={project.id}>
                      {forceDropIndicator && index === 1 ? <SidebarDropIndicator /> : null}
                      {renderProjectRow(project, pinnedReorder.controller)}
                    </Fragment>
                  ))}
                </div>
              </SidebarProjectSortableContext>
            </div>
          </CodexSidebarSection>
        </div>
      ) : forceEmptyPinnedDropTarget ? (
        <div className="absolute inset-x-0 top-0 px-row-x">
          <SidebarDropIndicator />
          <div className="h-4" />
        </div>
      ) : null}

      <CodexSidebarSection heading="Projects" collapsed={false} onToggle={() => {}}>
        <div className="isolate flex flex-col [contain:layout]">
          <SidebarProjectSortableContext groupIds={unpinnedReorder.groupIds}>
            <div className="flex flex-col" role="list" aria-label="Projects">
              {unpinnedProjects.map((project, index) => (
                <Fragment key={project.id}>
                  {forceDropIndicator && pinnedProjects.length === 0 && index === 1 ? <SidebarDropIndicator /> : null}
                  {renderProjectRow(project, unpinnedReorder.controller)}
                </Fragment>
              ))}
            </div>
          </SidebarProjectSortableContext>
        </div>
      </CodexSidebarSection>
    </>
  );
}

function CodexSortableProjectsHarness({
  pinned = false,
  emptyPinnedDropTarget = false,
  dropIndicator = false,
}: {
  pinned?: boolean;
  emptyPinnedDropTarget?: boolean;
  dropIndicator?: boolean;
}) {
  const [projects, setProjects] = useState(() =>
    SIDEBAR_PARITY_PROJECTS.map((project, index) => ({
      ...project,
      pinned: pinned && index < 1,
      pinnedOrder: pinned && index < 1 ? index : null,
    }))
  );

  return (
    <NodexTooltipProvider>
      <div data-codex-window-type="electron" className="min-h-screen bg-token-bg-primary p-8">
        <div className="app-shell-left-panel relative w-[300px] overflow-visible py-4">
          <SidebarProjectDndProvider
            onProjectDrop={(drop) => {
              setProjects((current) => current.map((project) => project.id === drop.projectId
                ? { ...project, pinned: true, pinnedOrder: sortPinnedStoryProjects(current).length }
                : project));
            }}
          >
            <CodexSortableProjectSections
              projects={emptyPinnedDropTarget ? projects.map((project) => ({ ...project, pinned: false, pinnedOrder: null })) : projects}
              onProjectsChange={setProjects}
              forceDropIndicator={dropIndicator}
              forceEmptyPinnedDropTarget={emptyPinnedDropTarget}
            />
          </SidebarProjectDndProvider>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function makeStorySession(input: {
  id: string;
  title: string;
  isOverview?: boolean;
  pinned?: boolean;
  pinnedOrder?: number | null;
  unread?: boolean;
  threadId?: string;
}): ProjectSession {
  const tabId = `${input.id}:db`;
  return {
    id: input.id,
    projectId: "nodex",
    noThreadFallbackTitle: input.title,
    displayTitle: input.title,
    isOverview: input.isOverview ?? false,
    order: 0,
    pinned: input.pinned ?? false,
    pinnedOrder: input.pinnedOrder ?? null,
    archived: false,
    archivedAt: null,
    unread: input.unread ?? false,
    leftPaneCollapsed: true,
    panels: {
      right: {
        collapsed: false,
        layout: makeProjectSessionPanelLayout([tabId], tabId),
        size: { widthPx: 600, fullWidth: input.isOverview ?? false },
      },
      bottom: {
        collapsed: true,
        layout: makeProjectSessionPanelLayout([], null, "bottom"),
        size: { heightPx: 280 },
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
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        order: 0,
        config: { projectId: "nodex", view: "kanban" },
        stateKey: 0,
        state: {},
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
    makeStorySession({ id: "thread:nodex:pinned", title: "Pinned architecture notes", pinned: true, pinnedOrder: 0, threadId: "local:pinned" }),
    makeStorySession({ id: "thread:nodex:parity", title: "Mirror Codex Electron layout", unread: true, threadId: "local:sidebar-parity" }),
    makeStorySession({ id: "thread:nodex:unread-idle", title: "Unread accent idle", unread: true, threadId: "local:unread-idle" }),
    makeStorySession({ id: "thread:nodex:long", title: "Very long session title that should truncate before colliding with row actions", threadId: "local:long-title" }),
  ];

  return (
    <NodexTooltipProvider>
      <div data-codex-window-type="electron" className="min-h-screen bg-token-bg-primary p-8">
        <div className="app-shell-left-panel w-[300px] overflow-visible py-4">
          <CodexSidebarSection heading="Projects" collapsed={false} onToggle={() => {}}>
            <div className="isolate flex flex-col [contain:layout]">
              <div className="flex flex-col" role="list" aria-label="Projects">
                <CodexProjectRow
                  project={project}
                  active
                  expanded
                  onActivate={() => {}}
                  onStartNewChat={() => {}}
                  onUpdateProject={async () => project}
                  onDeleteProject={async () => false}
                >
                  <CodexProjectSessionList project={project}>
                    {sessions.map((session, index) => (
                      <CodexThreadRow
                        key={session.id}
                        session={session}
                        active={index === 2}
                        contextMenuOpen={index === 3}
                        onSelect={() => {}}
                        onOpenContextMenu={() => {}}
                        onTogglePinned={() => {}}
                      />
                    ))}
                  </CodexProjectSessionList>
                </CodexProjectRow>
              </div>
            </div>
          </CodexSidebarSection>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function SettingsFooterHarness({
  account = FOOTER_QUOTA_ACCOUNT,
}: {
  account?: CodexAccountSnapshot | null;
}) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-end bg-(--background) p-8">
        <div className="w-[280px] bg-(--background-secondary)">
          <LeftSidebarFooter
            onOpenSettings={() => {}}
            account={account}
            connection={{ status: "connected", retries: 0 }}
            onRefreshAccount={async () => account ?? FOOTER_SIGNED_OUT_ACCOUNT}
            onLogout={async () => undefined}
          />
        </div>
      </div>
    </NodexTooltipProvider>
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

export const NewChatControls: Story = {
  render: () => <SidebarNewChatControlsHarness />,
};

export const CodexProjectsExpanded: Story = {
  render: () => <CodexProjectsHarness expanded activeProjectId="nodex" />,
};

export const CodexProjectDisclosureChevronsRevealed: Story = {
  render: () => <CodexProjectsHarness expanded activeProjectId="nodex" revealProjectDisclosureChevrons />,
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

export const CodexProjectsSortable: Story = {
  render: () => <CodexSortableProjectsHarness />,
};

export const CodexProjectsDraggingOverProject: Story = {
  render: () => <CodexSortableProjectsHarness dropIndicator />,
};

export const CodexPinnedProjects: Story = {
  render: () => <CodexSortableProjectsHarness pinned />,
};

export const CodexPinnedProjectsEmptyDropTarget: Story = {
  render: () => <CodexSortableProjectsHarness emptyPinnedDropTarget />,
};

export const CodexProjectSessionRows: Story = {
  render: () => <CodexProjectSessionRowsHarness />,
};

export const SettingsFooterWithQuota: Story = {
  render: () => <SettingsFooterHarness account={FOOTER_QUOTA_ACCOUNT} />,
};

export const SettingsFooterLowQuota: Story = {
  render: () => <SettingsFooterHarness account={FOOTER_LOW_QUOTA_ACCOUNT} />,
};

export const SettingsFooterNoRateLimits: Story = {
  render: () => <SettingsFooterHarness account={FOOTER_NO_LIMITS_ACCOUNT} />,
};

export const SettingsFooterSignedOut: Story = {
  render: () => <SettingsFooterHarness account={FOOTER_SIGNED_OUT_ACCOUNT} />,
};
