import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  BoardSummary,
  DatabasePage,
  Project,
  ProjectSession,
  ProjectSessionThreadLink,
  ProjectSessionTab,
} from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-state";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { buildPageDetailStoryResult } from "../kanban/page-stage/page-stage-story-page-detail";
import {
  writeWorkbenchShellNavigationHistoryState,
  type WorkbenchShellNavigationSnapshot,
} from "@/lib/workbench-shell-navigation-history";
import {
  activateProjectSessionPanelLeaf,
  makeProjectSessionPanelLayout,
  mergeProjectSessionPanelLeaf,
  setProjectSessionPanelBranchRatio,
  setProjectSessionPanelMaximizedLeaf,
  splitProjectSessionPanelLeaf,
} from "../../../shared/project-session-panel-layout";
import { WorkbenchShell } from "./workbench-shell";

type ShellStoryArgs = {
  activeTab: "browser" | "terminal" | "db" | "page" | "cross-project-card" | "missing-card" | "loading-card" | "review" | "empty";
  thread: "empty" | "attached";
  rightPanel: "regular" | "collapsed" | "full";
  rightPanelGroups: "single" | "split";
  bottomPanel: "collapsed" | "empty" | "terminal";
  sidebar: "expanded" | "collapsed";
  sidebarReveal: "idle" | "edge" | "focus";
  sidebarWidth: 240 | 300 | 520;
  navigationHistory: "disabled" | "back" | "forward" | "both";
  longNames: boolean;
};

const meta = {
  title: "Workbench/Project session shell",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Codex Electron-style project session shell with fixed global toolbar controls and top-level right and bottom panels.",
      },
    },
  },
  args: {
    activeTab: "browser",
    thread: "empty",
    rightPanel: "regular",
    rightPanelGroups: "single",
    bottomPanel: "collapsed",
    sidebar: "expanded",
    sidebarReveal: "idle",
    sidebarWidth: 300,
    navigationHistory: "both",
    longNames: false,
  },
  argTypes: {
    activeTab: {
      control: "inline-radio",
      options: ["browser", "terminal", "db", "page", "cross-project-card", "missing-card", "loading-card", "review", "empty"],
    },
    thread: {
      control: "inline-radio",
      options: ["empty", "attached"],
    },
    rightPanel: {
      control: "inline-radio",
      options: ["regular", "collapsed", "full"],
    },
    rightPanelGroups: {
      control: "inline-radio",
      options: ["single", "split"],
    },
    bottomPanel: {
      control: "inline-radio",
      options: ["collapsed", "empty", "terminal"],
    },
    sidebar: {
      control: "inline-radio",
      options: ["expanded", "collapsed"],
    },
    sidebarReveal: {
      control: "inline-radio",
      options: ["idle", "edge", "focus"],
    },
    sidebarWidth: {
      control: "inline-radio",
      options: [240, 300, 520],
    },
    navigationHistory: {
      control: "inline-radio",
      options: ["disabled", "back", "forward", "both"],
    },
    longNames: {
      control: "boolean",
    },
  },
  render: (args) => <ProjectSessionShellStory {...args} />,
} satisfies Meta<ShellStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

const CREATED_AT = "2026-06-07T00:00:00.000Z";

const PROJECTS: Project[] = [
  {
    id: "nodex",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Nodex",
    description: "",
    icon: "",
    sources: [{ root: "/Users/asc/repo/nodex", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/nodex",
    pinned: false,
    pinnedOrder: null,
    created: new Date(CREATED_AT),
    updated: new Date(CREATED_AT),
  },
  {
    id: "codex-readable",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Codex readable pack",
    description: "",
    icon: "",
    sources: [{ root: "/Users/asc/repo/devtools-codex", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
    pinned: false,
    pinnedOrder: null,
    created: new Date(CREATED_AT),
    updated: new Date(CREATED_AT),
  },
];

const PROJECT_REFS = PROJECTS.map((project) => ({
  projectId: project.id,
  colorToken: "var(--accent-blue)",
  initial: project.name.slice(0, 1).toUpperCase(),
}));

const STORY_BOARD: BoardSummary = {
  columns: [
    {
      id: "in_progress",
      name: "In Progress",
      cards: [
        {
          id: "card-1",
          status: "in_progress",
          archived: false,
          title: "Workbench redesign",
          richTitle: plainTextToPortableRichText("Workbench redesign"),
          descriptionPreview: "",
          descriptionLength: 0,
          hasDescription: false,
          tags: ["shell"],
          created: new Date(CREATED_AT),
          order: 0,
          revision: 1,
        },
      ],
    },
  ],
};

function buildStoryCardDetail(projectId: string, pageId: string): DatabasePage | null {
  if (pageId !== "card-1") return null;
  const crossProject = projectId === "codex-readable";

  return {
    id: pageId,
    status: "in_progress",
    archived: false,
    title: crossProject ? "Readable pack review" : "Workbench redesign",
    richTitle: plainTextToPortableRichText(
      crossProject ? "Readable pack review" : "Workbench redesign",
    ),
    description: crossProject
      ? "Review the readable Codex pack from the current Nodex session."
      : "Tighten the workbench shell while preserving project-scoped panel tabs.",
    tags: crossProject ? ["review"] : ["shell"],
    created: new Date(CREATED_AT),
    order: 0,
    revision: 1,
  };
}

function makeTab(
  overrides: Partial<ProjectSessionTab> & Pick<ProjectSessionTab, "id" | "kind" | "title" | "config">,
): ProjectSessionTab {
  return {
    sessionId: "session:overview",
    projectId: "nodex",
    panelId: overrides.kind === "terminal" ? "bottom" : "right",
    order: 0,
    stateKey: 0,
    state: {},
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
    browserTabId: overrides.browserTabId
      ?? (overrides.kind === "browser" ? `browser:${overrides.id}` : null),
  };
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return makeProjectSessionPanelLayout(tabIds, activeTabId);
}

function makeSplitPanelLayout(tabIds: string[], activeTabId: string | null): ProjectSession["panels"]["right"]["layout"] {
  const firstTabIds = tabIds.filter((tabId) => tabId !== "tab:browser");
  const secondTabIds: string[] = tabIds.filter((tabId) => tabId === "tab:browser");
  const activeLeafId = activeTabId === "tab:browser" && secondTabIds.length > 0 ? "leaf:browser" : "leaf:main";
  return {
    version: 2,
    activeLeafId,
    mruLeafIds: [activeLeafId, activeLeafId === "leaf:main" ? "leaf:browser" : "leaf:main"],
    maximizedLeafId: null,
    root: {
      type: "split",
      id: "split:right-root",
      direction: "horizontal",
      ratio: 0.58,
      first: {
        type: "leaf",
        id: "leaf:main",
        tabIds: firstTabIds,
        activeTabId: activeTabId && firstTabIds.includes(activeTabId) ? activeTabId : firstTabIds[0] ?? null,
        mruTabIds: [
          ...(activeTabId && firstTabIds.includes(activeTabId) ? [activeTabId] : []),
          ...firstTabIds,
        ],
      },
      second: {
        type: "leaf",
        id: "leaf:browser",
        tabIds: secondTabIds,
        activeTabId: activeTabId && secondTabIds.includes(activeTabId) ? activeTabId : secondTabIds[0] ?? null,
        mruTabIds: [
          ...(activeTabId && secondTabIds.includes(activeTabId) ? [activeTabId] : []),
          ...secondTabIds,
        ],
      },
    },
  };
}

function makePanels(input: {
  rightTabIds?: string[];
  rightActiveTabId?: string | null;
  rightCollapsed?: boolean;
  rightFullWidth?: boolean;
  bottomTabIds?: string[];
  bottomActiveTabId?: string | null;
  bottomCollapsed?: boolean;
}): ProjectSession["panels"] {
  const rightTabIds = input.rightTabIds ?? [];
  const bottomTabIds = input.bottomTabIds ?? [];
  return {
    right: {
      collapsed: input.rightCollapsed ?? false,
      layout: makePanelLayout(rightTabIds, input.rightActiveTabId ?? rightTabIds[0] ?? null),
      size: { widthPx: 600, fullWidth: input.rightFullWidth ?? false },
    },
    bottom: {
      collapsed: input.bottomCollapsed ?? bottomTabIds.length === 0,
      layout: makePanelLayout(bottomTabIds, input.bottomActiveTabId ?? bottomTabIds[0] ?? null),
      size: { heightPx: 280 },
    },
  };
}

function withPanelLayouts(
  session: ProjectSession,
  activeByPanel: Partial<Record<"right" | "bottom", string | null>> = {},
): ProjectSession {
  const rightTabIds = session.tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
  const bottomTabIds = session.tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
  return {
    ...session,
    panels: {
      right: {
        ...session.panels.right,
        layout: makePanelLayout(
          rightTabIds,
          activeByPanel.right ?? rightTabIds[0] ?? null,
        ),
      },
      bottom: {
        ...session.panels.bottom,
        layout: makePanelLayout(
          bottomTabIds,
          activeByPanel.bottom ?? bottomTabIds[0] ?? null,
        ),
      },
    },
  };
}

function makeSession(args: ShellStoryArgs): ProjectSession {
  if (args.activeTab === "empty") {
    const panels = makePanels({
      rightCollapsed: args.rightPanel === "collapsed",
      rightFullWidth: args.rightPanel === "full",
      bottomCollapsed: args.bottomPanel !== "empty",
    });
    const title = "Database View";
    return {
      id: "session:database-view",
      projectId: "nodex",
      noThreadFallbackTitle: title,
      displayTitle: title,
      order: 0,
      pinned: true,
      pinnedOrder: 0,
      archived: false,
      archivedAt: null,
      unread: false,
      leftPaneCollapsed: true,
      panels,
      thread: null,
      tabs: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
  }

  const cardProjectId = args.activeTab === "cross-project-card" ? "codex-readable" : "nodex";
  const pageTitle = args.activeTab === "cross-project-card"
    ? "Readable pack review"
    : args.activeTab === "missing-card"
      ? "Missing project card"
      : args.activeTab === "loading-card"
        ? "Loading project card"
      : args.longNames
        ? "Rewrite the project-session workbench shell while preserving card thread links"
        : "Workbench redesign";
  const baseTabs = [
    makeTab({
      id: "tab:db",
      kind: "db_view",
      title: "DB View",
      order: 0,
      config: { projectId: "nodex", view: "kanban" },
    }),
    makeTab({
      id: "tab:card",
      kind: "page_stage",
      title: pageTitle,
      order: 1,
      config: {
        projectId: cardProjectId,
        pageId: args.activeTab === "missing-card"
          ? "missing-card"
          : args.activeTab === "loading-card"
            ? "loading-card"
            : "card-1",
        titleSnapshot: pageTitle,
      },
    }),
    makeTab({
      id: "tab:terminal",
      kind: "terminal",
      title: "Terminal",
      order: 2,
      config: { projectId: "nodex", terminalSessionId: "story-terminal" },
    }),
    makeTab({
      id: "tab:browser",
      kind: "browser",
      title: "Browser",
      order: 3,
      config: { projectId: "nodex", title: "Browser" },
    }),
  ];
  const tabs = args.activeTab === "review"
    ? [
        ...baseTabs,
        makeTab({
          id: "tab:review",
          kind: "review",
          title: "Review",
          order: 4,
          config: { projectId: "nodex" },
        }),
      ]
    : baseTabs;
  const activeTabId = (() => {
    if (args.activeTab === "db") return "tab:db";
    if (
      args.activeTab === "page"
      || args.activeTab === "cross-project-card"
      || args.activeTab === "missing-card"
      || args.activeTab === "loading-card"
    ) {
      return "tab:card";
    }
    if (args.activeTab === "terminal") return "tab:terminal";
    if (args.activeTab === "review") return "tab:review";
    return "tab:browser";
  })();
  const rightTabIds = tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
  const bottomTabIds = tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
  const panels = makePanels({
    rightTabIds,
    rightActiveTabId: rightTabIds.includes(activeTabId) ? activeTabId : rightTabIds[0] ?? null,
    rightCollapsed: args.rightPanel === "collapsed",
    rightFullWidth: args.rightPanel === "full",
    bottomTabIds,
    bottomActiveTabId: bottomTabIds.includes(activeTabId) ? activeTabId : bottomTabIds[0] ?? null,
    bottomCollapsed: args.bottomPanel === "empty"
      ? false
      : args.activeTab !== "terminal" && args.bottomPanel !== "terminal",
  });
  if (args.rightPanelGroups === "split" && rightTabIds.length > 1) {
    panels.right = {
      ...panels.right,
      layout: makeSplitPanelLayout(
        rightTabIds,
        rightTabIds.includes(activeTabId) ? activeTabId : rightTabIds[0] ?? null,
      ),
    };
  }

  const thread: ProjectSessionThreadLink | null = args.thread === "attached"
    ? {
        sessionId: "session:database-view",
        projectId: "nodex",
        threadId: "thread-story",
        parentThreadId: undefined,
        threadName: "Codex shell parity",
        threadPreview: "Reviewing shell layout and tab persistence",
        modelProvider: "openai",
        cwd: "/Users/asc/repo/nodex",
        statusType: "notLoaded",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1_780_800_000_000,
        updatedAt: 1_780_800_000_000,
        linkedAt: CREATED_AT,
      }
    : null;
  const title = args.longNames
    ? "Database View and implementation notes for a project session shell"
    : "Database View";

  return {
    id: "session:database-view",
    projectId: "nodex",
    noThreadFallbackTitle: title,
    displayTitle: thread?.threadName ?? title,
    order: 0,
    pinned: true,
    pinnedOrder: 0,
    archived: false,
    archivedAt: null,
    unread: false,
    leftPaneCollapsed: true,
    panels,
    thread,
    tabs,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeSecondarySession(args: ShellStoryArgs): ProjectSession {
  const tabs = [
    makeTab({
      id: "tab:release-terminal",
      sessionId: "session:release",
      kind: "terminal",
      title: "Release terminal",
      order: 0,
      config: { projectId: "nodex", terminalSessionId: "release-terminal" },
    }),
    makeTab({
      id: "tab:release-browser",
      sessionId: "session:release",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "nodex", title: "Browser" },
    }),
  ];
  const rightTabIds = tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
  const bottomTabIds = tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
  return {
    ...makeSession({ ...args, activeTab: "terminal", thread: "empty" }),
    id: "session:release",
    noThreadFallbackTitle: args.longNames ? "Release validation and follow-up terminal work" : "Release run",
    displayTitle: args.longNames ? "Release validation and follow-up terminal work" : "Release run",
    order: 1,
    tabs,
    panels: makePanels({
      rightTabIds,
      rightActiveTabId: rightTabIds[0] ?? null,
      rightCollapsed: args.rightPanel === "collapsed",
      rightFullWidth: args.rightPanel === "full",
      bottomTabIds,
      bottomActiveTabId: "tab:release-terminal",
      bottomCollapsed: false,
    }),
  };
}

function resolveStoryPanelActiveTabId(session: ProjectSession, panelId: "right" | "bottom"): string | null {
  const panel = session.panels[panelId];
  if (panel.layout.root.type !== "leaf") return null;
  return panel.layout.root.activeTabId;
}

function makeStoryNavigationSnapshot(
  session: ProjectSession,
  projectId = session.projectId ?? "project-alpha",
): WorkbenchShellNavigationSnapshot {
  return {
    activeProjectId: projectId,
    activeSessionId: session.id,
    activeView: "kanban",
    rightActiveTabId: resolveStoryPanelActiveTabId(session, "right"),
    bottomActiveTabId: resolveStoryPanelActiveTabId(session, "bottom"),
    rightPanelCollapsed: session.panels.right.collapsed,
    bottomPanelCollapsed: session.panels.bottom.collapsed,
    rightPanelFullWidth: session.panels.right.size.fullWidth ?? false,
  };
}

function writeStoryNavigationHistory(
  navigationHistory: ShellStoryArgs["navigationHistory"],
  sessionsByProject: Record<string, ProjectSession[]>,
): void {
  const currentSession = sessionsByProject.nodex?.[0] ?? null;
  const backSession = sessionsByProject.nodex?.[1] ?? currentSession;
  const forwardSession = sessionsByProject["codex-readable"]?.[0] ?? currentSession;
  const backStack =
    navigationHistory === "back" || navigationHistory === "both"
      ? backSession
        ? [makeStoryNavigationSnapshot(backSession)]
        : []
      : [];
  const forwardStack =
    navigationHistory === "forward" || navigationHistory === "both"
      ? forwardSession
        ? [makeStoryNavigationSnapshot(forwardSession, forwardSession.projectId ?? undefined)]
        : []
      : [];
  writeWorkbenchShellNavigationHistoryState({ backStack, forwardStack });
}

function ProjectSessionShellStory(args: ShellStoryArgs) {
  const initialSessionsByProject = useMemo<Record<string, ProjectSession[]>>(
    () => ({
      nodex: [makeSession(args), makeSecondarySession(args)],
      "codex-readable": [
        withPanelLayouts({
          ...makeSession({ ...args, activeTab: "browser", thread: "empty" }),
          id: "session:codex-database-view",
          projectId: "codex-readable",
          noThreadFallbackTitle: "Database View",
          displayTitle: "Database View",
          tabs: [
            makeTab({
              id: "tab:codex-browser",
              sessionId: "session:codex-database-view",
              projectId: "codex-readable",
              kind: "browser",
              title: "Browser",
              config: { projectId: "codex-readable", title: "Browser" },
            }),
          ],
        }, { right: "tab:codex-browser" }),
      ],
    }),
    [args],
  );
  const [sessionsByProject, setSessionsByProject] = useState(initialSessionsByProject);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(args.sidebar === "collapsed");
  const [sidebarWidth, setSidebarWidth] = useState<number>(args.sidebarWidth);
  const [sidebarCollapsibleSections, setSidebarCollapsibleSections] = useState({
    pinned: false,
    projects: false,
    chats: false,
  });

  writeStoryNavigationHistory(args.navigationHistory, initialSessionsByProject);

  installStoryApi(sessionsByProject, setSessionsByProject);

  useEffect(() => {
    setSidebarCollapsed(args.sidebar === "collapsed");
    setSidebarWidth(args.sidebarWidth);
  }, [args.sidebar, args.sidebarWidth]);

  useEffect(() => {
    if (args.rightPanel === "collapsed") return undefined;
    const timeout = window.setTimeout(() => {
      const label = args.rightPanel === "regular" ? "Restore panel width" : "Expand panel";
      document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [args.rightPanel, sessionsByProject]);

  useEffect(() => {
    if (args.sidebar !== "collapsed" || args.sidebarReveal === "idle") return undefined;
    let focusTimeout: number | null = null;
    const timeout = window.setTimeout(() => {
      if (args.sidebarReveal === "edge") {
        window.dispatchEvent(new MouseEvent("pointermove", {
          clientX: 12,
          clientY: 120,
        }));
        return;
      }

      window.dispatchEvent(new MouseEvent("pointermove", {
        clientX: 12,
        clientY: 120,
      }));
      focusTimeout = window.setTimeout(() => {
        const focusTarget = document.querySelector<HTMLElement>(
          '[data-sidebar-floating-focus-area="true"] button',
        );
        focusTarget?.focus();
        window.dispatchEvent(new MouseEvent("pointermove", {
          clientX: args.sidebarWidth + 24,
          clientY: 120,
        }));
      }, 0);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      if (focusTimeout !== null) window.clearTimeout(focusTimeout);
    };
  }, [args.sidebar, args.sidebarReveal, args.sidebarWidth, sessionsByProject]);

  return (
    <div className="h-screen">
      <WorkbenchShell
        key={`${args.thread}:${args.rightPanel}:${args.rightPanelGroups}:${args.bottomPanel}:${args.activeTab}:${args.sidebar}:${args.sidebarReveal}:${args.sidebarWidth}:${args.navigationHistory}:${args.longNames ? "long" : "normal"}`}
        projects={PROJECTS}
        dbProjectId="nodex"
        activeView={"kanban" as WorkbenchView}
        activeSearchQuery=""
        activeDbViewPrefs={null}
        searchByProject={{ nodex: "" }}
        dbViewPrefsByProject={{}}
        projectRefs={PROJECT_REFS}
        sidebar={{
          collapsed: sidebarCollapsed,
          width: sidebarWidth,
          collapsibleSections: sidebarCollapsibleSections,
        }}
        setSidebarCollapsed={setSidebarCollapsed}
        setSidebarWidth={setSidebarWidth}
        setSidebarCollapsibleSectionCollapsed={(sectionId, collapsed) => {
          setSidebarCollapsibleSections((current) => ({
            ...current,
            [sectionId]: collapsed,
          }));
        }}
        pageStageCloseRef={{ current: null }}
        setDbProject={() => undefined}
        setSearchQuery={() => undefined}
        setDbViewPrefs={() => undefined}
        openPageStage={() => undefined}
        onLeavePageStage={() => undefined}
        onCreateProject={async () => null}
        onUpdateProject={async () => null}
        onDeleteProject={async () => false}
        onReorderProjects={async () => PROJECTS}
        onSetProjectPinned={async () => null}
        onSetPinnedProjectOrder={async () => PROJECTS}
        onRequestProjectPickerOpen={() => undefined}
        threadSearchOpenTick={0}
      />
    </div>
  );
}

function installReducedMotionMatchMedia() {
  if (typeof window === "undefined") return null;
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
}

function ReducedMotionProjectSessionShellStory(args: ShellStoryArgs) {
  const [restoreMatchMedia] = useState(installReducedMotionMatchMedia);

  useEffect(() => () => {
    restoreMatchMedia?.();
  }, [restoreMatchMedia]);

  return <ProjectSessionShellStory {...args} />;
}

function ScheduledRouteProjectSessionShellStory(args: ShellStoryArgs) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Scheduled"]')?.click();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  return <ProjectSessionShellStory {...args} />;
}

function installStoryApi(
  sessionsByProject: Record<string, ProjectSession[]>,
  setSessionsByProject: Dispatch<SetStateAction<Record<string, ProjectSession[]>>>,
) {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === "project-sessions:list") {
          return sessionsByProject[String(args[0])] ?? [];
        }
        if (channel === "board:summary:get") {
          return STORY_BOARD;
        }
        if (channel === "codex:scheduled-automations:list") {
          return { items: [] };
        }
        if (channel === "codex:automation-runs:inbox-items") {
          return { items: [] };
        }
        if (channel === "pages:detail:get") {
          const projectId = String(args[0] ?? "nodex");
          const pageId = String(args[1] ?? "");
          if (pageId === "loading-card") {
            return new Promise<never>(() => {});
          }
          return buildPageDetailStoryResult(
            projectId,
            buildStoryCardDetail(projectId, pageId),
          );
        }
        if (channel === "database-rows:details:get") {
          const projectId = String(args[0] ?? "nodex");
          const input = (args[1] ?? {}) as { pageIds?: string[] };
          return (input.pageIds ?? []).flatMap((pageId) => {
            const card = buildStoryCardDetail(projectId, pageId);
            return card ? [card] : [];
          });
        }
        if (channel === "project-session-panels:update") {
          const sessionId = String(args[0]);
          const panelId = args[1] === "bottom" ? "bottom" : "right";
          const input = (args[2] ?? {}) as Partial<ProjectSession["panels"]["right"]>;
          const updated = Object.values(sessionsByProject)
            .flat()
            .find((session) => session.id === sessionId);
          if (!updated) return null;
          const next = {
            ...updated,
            panels: {
              ...updated.panels,
              [panelId]: {
                ...updated.panels[panelId],
                ...input,
                size: {
                  ...updated.panels[panelId].size,
                  ...input.size,
                },
              },
            },
            updatedAt: new Date().toISOString(),
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-panels:activate") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            leafId: string;
            tabId?: string | null;
          };
          const session = Object.values(sessionsByProject).flat().find((item) => item.id === input.sessionId);
          if (!session) return null;
          const next = {
            ...session,
            panels: {
              ...session.panels,
              [input.panelId]: {
                ...session.panels[input.panelId],
                layout: activateProjectSessionPanelLeaf(session.panels[input.panelId].layout, input.leafId, input.tabId),
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-panels:split") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            leafId: string;
            side: "left" | "right" | "up" | "down";
            tabId?: string;
          };
          const session = Object.values(sessionsByProject).flat().find((item) => item.id === input.sessionId);
          if (!session) return null;
          const next = {
            ...session,
            panels: {
              ...session.panels,
              [input.panelId]: {
                ...session.panels[input.panelId],
                layout: splitProjectSessionPanelLeaf(session.panels[input.panelId].layout, {
                  leafId: input.leafId,
                  side: input.side,
                  tabId: input.tabId,
                  newLeafId: `leaf:story:${Date.now()}`,
                  newBranchId: `split:story:${Date.now()}`,
                }),
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-panels:merge") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            leafId: string;
          };
          const session = Object.values(sessionsByProject).flat().find((item) => item.id === input.sessionId);
          if (!session) return null;
          const next = {
            ...session,
            panels: {
              ...session.panels,
              [input.panelId]: {
                ...session.panels[input.panelId],
                layout: mergeProjectSessionPanelLeaf(session.panels[input.panelId].layout, input.leafId),
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-panels:resize") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            branchId: string;
            ratio: number;
          };
          const session = Object.values(sessionsByProject).flat().find((item) => item.id === input.sessionId);
          if (!session) return null;
          const next = {
            ...session,
            panels: {
              ...session.panels,
              [input.panelId]: {
                ...session.panels[input.panelId],
                layout: setProjectSessionPanelBranchRatio(session.panels[input.panelId].layout, input.branchId, input.ratio),
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-panels:maximize") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            leafId: string | null;
          };
          const session = Object.values(sessionsByProject).flat().find((item) => item.id === input.sessionId);
          if (!session) return null;
          const next = {
            ...session,
            panels: {
              ...session.panels,
              [input.panelId]: {
                ...session.panels[input.panelId],
                layout: setProjectSessionPanelMaximizedLeaf(session.panels[input.panelId].layout, input.leafId),
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-tabs:reorder") {
          const input = (args[0] ?? {}) as {
            sessionId: string;
            panelId: ProjectSessionTab["panelId"];
            orderedTabIds: string[];
          };
          const session = Object.values(sessionsByProject)
            .flat()
            .find((item) => item.id === input.sessionId);
          if (!session) return null;
          const byId = new Map(session.tabs.map((tab) => [tab.id, tab]));
          const orderedPanelTabs = input.orderedTabIds.flatMap((tabId, index) => {
            const tab = byId.get(tabId);
            return tab ? [{ ...tab, order: index }] : [];
          });
          const untouchedTabs = session.tabs.filter((tab) => tab.panelId !== input.panelId);
          const tabs = [...untouchedTabs, ...orderedPanelTabs].sort((left, right) => left.order - right.order);
          const next = {
            ...session,
            tabs,
          };
          const normalized = withPanelLayouts(next);
          setSessionsByProject((current) => replaceSession(current, normalized));
          return normalized;
        }
        if (channel === "project-session-tabs:update") {
          const tabId = String(args[0]);
          const input = (args[1] ?? {}) as Partial<ProjectSessionTab>;
          const session = Object.values(sessionsByProject)
            .flat()
            .find((item) => item.tabs.some((tab) => tab.id === tabId));
          if (!session) return null;

          const tabs = session.tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, ...input, updatedAt: new Date().toISOString() }
              : tab,
          );
          const next = { ...session, tabs };
          setSessionsByProject((current) => replaceSession(current, next));
          return tabs.find((tab) => tab.id === tabId) ?? null;
        }
        if (channel === "project-session-tabs:create") {
          const input = args[0] as {
            sessionId: string;
            projectId: string;
            panelId?: ProjectSessionTab["panelId"];
            kind: ProjectSessionTab["kind"];
            title: string;
            config: ProjectSessionTab["config"];
          };
          const session = Object.values(sessionsByProject)
            .flat()
            .find((item) => item.id === input.sessionId);
          if (!session) return null;
          if (["db_view", "review", "browser"].includes(input.kind)) {
            const existing = session.tabs.find((tab) => tab.kind === input.kind);
            if (existing) {
              const next = withPanelLayouts(session, { [existing.panelId]: existing.id });
              setSessionsByProject((current) => replaceSession(current, next));
              return existing;
            }
          }
          const panelId = input.panelId ?? (input.kind === "terminal" ? "bottom" : "right");
          const tab = makeTab({
            id: `tab:${input.kind}:${session.tabs.length + 1}`,
            sessionId: input.sessionId,
            projectId: input.projectId,
            kind: input.kind,
            title: input.title,
            order: session.tabs.filter((item) => item.panelId === panelId).length,
            panelId,
            config: input.config,
          });
          const tabs = [...session.tabs, tab];
          const next = withPanelLayouts({
            ...session,
            tabs,
            panels: {
              ...session.panels,
              [tab.panelId]: {
                ...session.panels[tab.panelId],
                collapsed: false,
              },
            },
          }, { [tab.panelId]: tab.id });
          setSessionsByProject((current) => replaceSession(current, next));
          return tab;
        }
        if (channel === "project-session-tabs:delete") {
          return true;
        }
        if (channel === "project-session-threads:attach" || channel === "project-session-threads:detach") {
          return true;
        }
        return null;
      },
      on: () => () => undefined,
      awaitInitialization: async () => undefined,
      onInitializationStep: () => () => undefined,
      onDatabaseMigrationProgress: () => () => undefined,
      requestMicrophonePermission: () => undefined,
      serverUrl: undefined,
      assetPathPrefix: undefined,
      inspectPasteClipboard: () => ({ items: [] }),
      readPasteClipboard: () => ({}),
      getPathInfoForFile: () => null,
      getPathForFile: () => "",
    } satisfies NonNullable<Window["api"]>,
  });
}

function replaceSession(
  current: Record<string, ProjectSession[]>,
  nextSession: ProjectSession,
): Record<string, ProjectSession[]> {
  return Object.fromEntries(
    Object.entries(current).map(([projectId, sessions]) => [
      projectId,
      sessions.map((session) => (session.id === nextSession.id ? nextSession : session)),
    ]),
  );
}

export const MixedRightTabs: Story = {
  parameters: {
    docs: {
      description: {
        story: "Regular 600px right panel with registry-backed global bottom/side panel toggles in the fixed toolbar, expand/restore in the panel tab header, and no empty toolbar row above the thread title.",
      },
    },
  },
};

export const CardRightPanelCollapseAnchor: Story = {
  args: {
    activeTab: "page",
    thread: "attached",
    rightPanel: "regular",
  },
  parameters: {
    docs: {
      description: {
        story: "Interactive resize acceptance scene: drag the right-panel sash past its collapse threshold, reopen it, then resize it narrower. The full Page Detail canvas follows the sash with no retained minimum width, while trailing toolbar actions stay anchored to the viewport-right edge.",
      },
    },
  },
};

export const EmptyRightPanelActions: Story = {
  args: {
    activeTab: "empty",
  },
  parameters: {
    docs: {
      description: {
        story: "Empty right panel showing the Codex-style new-tab action grid with Database View and Page actions appended.",
      },
    },
  },
};

export const EmptyBottomPanelActions: Story = {
  args: {
    activeTab: "empty",
    rightPanel: "collapsed",
    bottomPanel: "empty",
  },
  parameters: {
    docs: {
      description: {
        story: "Open empty bottom panel showing the Codex-eligible Files, Side chat, Browser, Review, and Terminal action grid.",
      },
    },
  },
};

export const MissingPageStageTab: Story = {
  args: {
    activeTab: "missing-card",
  },
  parameters: {
    docs: {
      description: {
        story: "Page Detail tab whose saved Page id no longer exists; it should render a clear missing state instead of a blank panel.",
      },
    },
  },
};

export const LoadingPageStageTab: Story = {
  args: {
    activeTab: "loading-card",
  },
  parameters: {
    docs: {
      description: {
        story: "Page Detail tab while the saved Page detail is still hydrating; it keeps the shell stable with a disabled toolbar and localized property/editor skeletons instead of the missing-Page state.",
      },
    },
  },
};

export const CrossProjectPageStageTab: Story = {
  args: {
    activeTab: "cross-project-card",
  },
  parameters: {
    docs: {
      description: {
        story: "Nodex session hosting a Page Detail tab whose content project is Codex readable pack; the tab row should expose the content project before the Page title.",
      },
    },
  },
};

export const ReviewRightTab: Story = {
  args: {
    thread: "attached",
    activeTab: "review",
  },
  parameters: {
    docs: {
      description: {
        story: "Attached session with the singleton Review right-panel tab active.",
      },
    },
  },
};

export const BrowserRightTab: Story = {
  args: {
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Real Browser tab with Codex-parity chrome. Storybook renders the desktop-only unavailable state because Electron webview is not present.",
      },
    },
  },
};

export const ExpandedSidebarParity: Story = {
  args: {
    thread: "attached",
    sidebar: "expanded",
    sidebarWidth: 300,
  },
  parameters: {
    docs: {
      description: {
        story: "Expanded Codex sidebar parity state with the real app-shell left panel mounted at the 300px default width and enabled Back/Forward chrome in the titlebar.",
      },
    },
  },
};

export const ScheduledRouteShellHeader: Story = {
  args: {
    thread: "attached",
    rightPanel: "full",
    sidebar: "expanded",
    sidebarWidth: 300,
  },
  render: (args) => <ScheduledRouteProjectSessionShellStory {...args} />,
  parameters: {
    docs: {
      description: {
        story: "Scheduled route opened inside the normal Workbench shell: left titlebar chrome stays mounted while the Scheduled tabs and create controls occupy the global header center.",
      },
    },
  },
};

export const SidebarPinnedProjection: Story = {
  args: {
    thread: "attached",
    sidebar: "expanded",
    sidebarWidth: 300,
  },
  parameters: {
    docs: {
      description: {
        story: "Pinned tasks always render as standalone Pinned rows; pinned project folders separately render their remaining project children.",
      },
    },
  },
};

export const ExpandedSidebarMinWidth: Story = {
  args: {
    thread: "attached",
    sidebar: "expanded",
    sidebarWidth: 240,
  },
  parameters: {
    docs: {
      description: {
        story: "Expanded real sidebar at Codex's 240px minimum width, matching the clamp zone before the half-minimum collapse threshold.",
      },
    },
  },
};

export const ExpandedSidebarMaxWidth: Story = {
  args: {
    thread: "attached",
    sidebar: "expanded",
    sidebarWidth: 520,
  },
  parameters: {
    docs: {
      description: {
        story: "Expanded real sidebar at Codex's 520px maximum width, preserving the native vibrant shell and animated header slot reservation.",
      },
    },
  },
};

export const ExpandedSidebarReducedMotion: Story = {
  args: {
    thread: "attached",
    sidebar: "expanded",
    sidebarWidth: 300,
  },
  render: (args) => <ReducedMotionProjectSessionShellStory {...args} />,
  parameters: {
    docs: {
      description: {
        story: "Expanded real sidebar under prefers-reduced-motion, where explicit sidebar toggles snap instead of running the shell spring.",
      },
    },
  },
};

export const AttachedThreadPage: Story = {
  args: {
    thread: "attached",
    activeTab: "browser",
  },
};

export const SingletonFilteredActions: Story = {
  args: {
    thread: "attached",
    activeTab: "review",
  },
  parameters: {
    docs: {
      description: {
        story: "Session with DB View, Browser, and Review already present; Review filters as a singleton while DB View stays available for other project DBs and Browser remains available for more tabs.",
      },
    },
  },
};

export const CollapsedRightPanel: Story = {
  args: {
    thread: "attached",
    rightPanel: "collapsed",
  },
  parameters: {
    docs: {
      description: {
        story: "Attached thread with the right panel collapsed, keeping the thread title and summary toggle in the fixed app-header center surface at the panel boundary.",
      },
    },
  },
};

export const CollapsedSidebarThreadChrome: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    sidebarReveal: "idle",
    rightPanel: "collapsed",
    longNames: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar chrome parity scene: traffic-light safe left rail with sidebar toggle, Back, Forward, compact New chat, and a long thread title that truncates in the top chrome.",
      },
    },
  },
};

export const DisabledNavigationChrome: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    navigationHistory: "disabled",
    rightPanel: "collapsed",
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed titlebar with Codex Back/Forward buttons present but disabled because the workbench history stacks are empty.",
      },
    },
  },
};

export const FloatingSidebarAutoRevealed: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    sidebarReveal: "edge",
    rightPanel: "collapsed",
    sidebarWidth: 300,
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar with a synthetic pointer at x=12, rendering the Codex fixed floating left panel.",
      },
    },
  },
};

export const FloatingSidebarFocusOverride: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    sidebarReveal: "focus",
    rightPanel: "regular",
    sidebarWidth: 300,
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar with focus inside the already revealed floating sidebar, keeping the floating panel visible after the pointer leaves.",
      },
    },
  },
};

export const FloatingSidebarResizedWidth: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    sidebarReveal: "edge",
    rightPanel: "collapsed",
    sidebarWidth: 520,
  },
  parameters: {
    docs: {
      description: {
        story: "Floating sidebar after its right-edge sash has resized to the Codex maximum clamped width of 520px.",
      },
    },
  },
};

export const FloatingSidebarReducedMotion: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    sidebarReveal: "edge",
    rightPanel: "collapsed",
    sidebarWidth: 300,
  },
  render: (args) => <ReducedMotionProjectSessionShellStory {...args} />,
  parameters: {
    docs: {
      description: {
        story: "Floating sidebar under prefers-reduced-motion, using Codex's zero-duration transition branch.",
      },
    },
  },
};

export const FullWidthRightPanel: Story = {
  args: {
    rightPanel: "full",
    activeTab: "terminal",
  },
  parameters: {
    docs: {
      description: {
        story: "Expanded right panel with tabs aligned to the panel edge, restore in the panel tab header, and the main thread viewport collapsed to zero width under the same fixed toolbar.",
      },
    },
  },
};

export const CollapsedSidebarFullWidthRightPanel: Story = {
  args: {
    sidebar: "collapsed",
    sidebarReveal: "idle",
    rightPanel: "full",
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar with a full-width right panel: the left titlebar rail reserves its measured width before the right-panel tabs so toolbar controls and tabs never overlap.",
      },
    },
  },
};

export const CollapsedSidebarFullWidthRightPanelReveal: Story = {
  args: {
    sidebar: "collapsed",
    sidebarReveal: "edge",
    rightPanel: "full",
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar auto-reveal over a full-width right panel, matching Codex's pointer-led floating left panel behavior.",
      },
    },
  },
};

export const FullWidthRightPanelWithBottomPanel: Story = {
  args: {
    rightPanel: "full",
    bottomPanel: "terminal",
    activeTab: "terminal",
  },
  parameters: {
    docs: {
      description: {
        story: "Full-width right panel with the independent bottom panel still visible, matching Codex's zero right-slot reservation while bottom geometry remains separate.",
      },
    },
  },
};

export const SplitRightPanelGroups: Story = {
  args: {
    rightPanel: "regular",
    rightPanelGroups: "split",
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Right panel with two persisted tab groups, showing the persistent panel-edge hairline plus hover sash treatment, stable resize release, per-leaf tab strip, and active group chrome.",
      },
    },
  },
};

export const EmptyRightPanelOptionMenu: Story = {
  args: {
    activeTab: "empty",
    rightPanel: "regular",
    bottomPanel: "collapsed",
  },
  parameters: {
    docs: {
      description: {
        story: "Codex-parity empty right-panel option menu with the compact Review, Terminal, Browser, Files, and Side chat action rows.",
      },
    },
  },
};

export const RegularRightAndBottomMotionParity: Story = {
  args: {
    thread: "attached",
    rightPanel: "regular",
    bottomPanel: "terminal",
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Regular side panel plus open bottom panel, showing the animated right header slot for bottom/side toggles while the summary toggle remains in the thread header lane and both panel shells use Codex spring geometry.",
      },
    },
  },
};

export const LongNames: Story = {
  args: {
    longNames: true,
    activeTab: "terminal",
  },
};
