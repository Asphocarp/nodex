import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState } from "react";
import type {
  BoardSummary,
  DatabasePage,
  Project,
  ProjectSessionThreadLink,
  WorkbenchTabProjection,
  WorkbenchProjectionTabConfiguration,
} from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-state";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import type {
  LibraryModuleReadRequest,
  LibraryReadValue,
} from "../../../shared/library-module";
import type {
  CodexSideChatStartInput,
  CodexSideChatStartResult,
} from "../../../shared/types";
import { buildPageDetailStoryResult } from "../kanban/page-stage/page-stage-story-page-detail";
import {
  writeWorkbenchShellNavigationHistoryState,
  type WorkbenchShellNavigationSnapshot,
} from "@/lib/workbench-shell-navigation-history";
import {
  makeWorkbenchPanelLayout,
} from "../../../shared/workbench-panel-layout";
import { WorkbenchShell } from "./workbench-shell";
import {
  workbenchViewFromProjectSessionProjection,
  type WindowLocalProjectSession,
} from "@/lib/window-session-view-adapter";
import type { WorkbenchSessionViewSnapshot } from "../../../shared/workbench-session-view";

type ProjectSession = WindowLocalProjectSession;

type ShellStoryArgs = {
  workspace: "projects" | "projectless-only";
  activeTab: "browser" | "terminal" | "db" | "single-db" | "page" | "cross-project-card" | "missing-card" | "loading-card" | "review" | "empty";
  thread: "empty" | "attached";
  rightPanel: "regular" | "collapsed" | "full";
  rightPanelGroups: "single" | "split";
  bottomPanel: "collapsed" | "empty" | "terminal";
  sidebar: "expanded" | "collapsed";
  sidebarReveal: "idle" | "edge" | "focus";
  sidebarWidth: 240 | 300 | 520;
  navigationHistory: "disabled" | "back" | "forward" | "both";
  libraryWorkspace: boolean;
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
    workspace: "projects",
    activeTab: "browser",
    thread: "empty",
    rightPanel: "regular",
    rightPanelGroups: "single",
    bottomPanel: "collapsed",
    sidebar: "expanded",
    sidebarReveal: "idle",
    sidebarWidth: 300,
    navigationHistory: "both",
    libraryWorkspace: false,
    longNames: false,
  },
  argTypes: {
    workspace: {
      control: "inline-radio",
      options: ["projects", "projectless-only"],
    },
    activeTab: {
      control: "inline-radio",
      options: ["browser", "terminal", "db", "single-db", "page", "cross-project-card", "missing-card", "loading-card", "review", "empty"],
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
    libraryWorkspace: {
      control: "boolean",
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
      id: "build",
      name: "In Progress",
      cards: [
        {
          id: "card-1",
          status: "build",
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
    status: "build",
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

type SessionTabFixtureCommon = Pick<WorkbenchTabProjection, "id" | "title"> &
  Partial<Pick<
    WorkbenchTabProjection,
    | "sessionId"
    | "projectId"
    | "panelId"
    | "order"
    | "stateKey"
    | "state"
    | "createdAt"
    | "updatedAt"
  >>;

type SessionTabFixture<
  Configuration extends WorkbenchProjectionTabConfiguration = WorkbenchProjectionTabConfiguration,
> = Configuration extends { kind: "browser" }
  ? Configuration & SessionTabFixtureCommon & { browserTabId?: string }
  : Configuration & SessionTabFixtureCommon & { browserTabId?: never };

type SessionTabInput = SessionTabFixture | WorkbenchTabProjection;

function makeTab(overrides: SessionTabInput): WorkbenchTabProjection {
  const base = {
    sessionId: "session:overview",
    projectId: "nodex",
    panelId: overrides.kind === "terminal" ? "bottom" : "right",
    order: 0,
    stateKey: 0,
    state: {},
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  } satisfies Pick<
    WorkbenchTabProjection,
    | "sessionId"
    | "projectId"
    | "panelId"
    | "order"
    | "stateKey"
    | "state"
    | "createdAt"
    | "updatedAt"
  >;
  if (overrides.kind === "browser") {
    return {
      ...base,
      ...overrides,
      browserTabId: overrides.browserTabId ?? `browser:${overrides.id}`,
    };
  }
  return { ...base, ...overrides, browserTabId: null };
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return makeWorkbenchPanelLayout(tabIds, activeTabId);
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
      initialDatabaseViewId: "database-view:nodex:primary-kanban",
      noThreadFallbackTitle: title,
      displayTitle: title,
      order: 0,
      pinned: true,
      pinnedOrder: 0,
      archived: false,
      archivedAt: null,
      unread: false,
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
      config: { terminalSessionId: "story-terminal" },
    }),
    makeTab({
      id: "tab:browser",
      kind: "browser",
      title: "Browser",
      order: 3,
      config: { projectId: "nodex", title: "Browser" },
    }),
  ];
  const tabs = args.activeTab === "single-db"
    ? baseTabs.filter((tab) => tab.id === "tab:db")
    : args.activeTab === "review"
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
    if (args.activeTab === "db" || args.activeTab === "single-db") return "tab:db";
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
    initialDatabaseViewId: "database-view:nodex:primary-kanban",
    noThreadFallbackTitle: title,
    displayTitle: thread?.threadName ?? title,
    order: 0,
    pinned: true,
    pinnedOrder: 0,
    archived: false,
    archivedAt: null,
    unread: false,
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
      config: { terminalSessionId: "release-terminal" },
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

function makeAttachedProjectlessSession(args: ShellStoryArgs): ProjectSession {
  const base = makeSession({
    ...args,
    activeTab: "browser",
    thread: "attached",
    rightPanel: "regular",
  });
  return {
    ...base,
    id: "session:projectless-attached",
    projectId: null,
    noThreadFallbackTitle: "Projectless chat tools",
    displayTitle: "Projectless chat tools",
    thread: base.thread
      ? {
          ...base.thread,
          sessionId: "session:projectless-attached",
          projectId: null,
          threadId: "thread-projectless-attached",
          threadName: "Projectless chat tools",
          cwd: "/Users/asc/repo/scratch",
        }
      : null,
    tabs: [],
    panels: makePanels({
      rightTabIds: [],
      rightActiveTabId: null,
      rightCollapsed: false,
      rightFullWidth: false,
      bottomTabIds: [],
      bottomActiveTabId: null,
      bottomCollapsed: true,
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
    libraryRoute: null,
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
    () => {
      if (args.workspace === "projectless-only") {
        const session = args.thread === "attached"
          ? makeAttachedProjectlessSession(args)
          : {
              ...makeSession({ ...args, activeTab: "empty", thread: "empty" }),
              id: "session:projectless:blank",
              projectId: null,
              noThreadFallbackTitle: "New chat",
              displayTitle: "New chat",
            };
        return { __projectless__: [session] } as Record<string, ProjectSession[]>;
      }
      return {
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
      } as Record<string, ProjectSession[]>;
    },
    [args],
  );
  const [sessionsByProject] = useState(initialSessionsByProject);
  const [sessionViewsBySessionId, setSessionViewsBySessionId] = useState<
    Record<string, WorkbenchSessionViewSnapshot>
  >(() => Object.fromEntries(
    Object.values(initialSessionsByProject).flat().map((session) => [
      session.id,
      workbenchViewFromProjectSessionProjection(session),
    ]),
  ));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(args.sidebar === "collapsed");
  const [sidebarWidth, setSidebarWidth] = useState<number>(args.sidebarWidth);
  const [sidebarCollapsibleSections, setSidebarCollapsibleSections] = useState({
    pinned: false,
    library: false,
    projects: false,
    chats: false,
  });

  writeStoryNavigationHistory(
    args.workspace === "projectless-only" ? "disabled" : args.navigationHistory,
    initialSessionsByProject,
  );

  installStoryApi(sessionsByProject);

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
        windowSessionId="window-session:storybook"
        libraryWorkspaceEnabled={args.libraryWorkspace}
        key={`${args.workspace}:${args.thread}:${args.rightPanel}:${args.rightPanelGroups}:${args.bottomPanel}:${args.activeTab}:${args.sidebar}:${args.sidebarReveal}:${args.sidebarWidth}:${args.navigationHistory}:${args.longNames ? "long" : "normal"}`}
        projects={args.workspace === "projectless-only" ? [] : PROJECTS}
        dbProjectId={args.workspace === "projectless-only" ? "" : "nodex"}
        sessionViewsBySessionId={sessionViewsBySessionId}
        setSessionView={(sessionId, update) => {
          setSessionViewsBySessionId((current) => ({
            ...current,
            [sessionId]: typeof update === "function"
              ? update(current[sessionId])
              : update,
          }));
        }}
        activeView={"kanban" as WorkbenchView}
        activeSearchQuery=""
        activeDbViewPrefs={null}
        searchByProject={args.workspace === "projectless-only" ? {} : { nodex: "" }}
        dbViewPrefsByProject={{}}
        projectRefs={args.workspace === "projectless-only" ? [] : PROJECT_REFS}
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
        onArchiveProject={async () => ({ kind: "not-found" })}
        onReorderProjects={async () => args.workspace === "projectless-only" ? [] : PROJECTS}
        onSetProjectPinned={async () => null}
        onSetPinnedProjectOrder={async () => args.workspace === "projectless-only" ? [] : PROJECTS}
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

function LibraryRouteProjectSessionShellStory(args: ShellStoryArgs) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open Library"]')?.click();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  return <ProjectSessionShellStory {...args} />;
}

function buildStorySideChatStartResult(
  input: CodexSideChatStartInput,
  sessionsByProject: Record<string, ProjectSession[]>,
): CodexSideChatStartResult {
  const parentSession = Object.values(sessionsByProject)
    .flat()
    .find((session) => session.thread?.threadId === input.parentThreadId) ?? null;
  const threadId = `thread-story-side-chat:${input.parentThreadId}`;
  const now = Date.now();

  return {
    parentThreadId: input.parentThreadId,
    threadId,
    conversation: {
      threadId,
      projectId: parentSession?.projectId ?? null,
      forkedFromId: input.parentThreadId,
      source: {
        parentThreadId: input.parentThreadId,
        sideConversation: true,
        sideConversationParentNavigationPath: input.parentNavigationPath ?? null,
      },
      ephemeral: true,
      threadName: "Side chat",
      threadPreview: "",
      modelProvider: parentSession?.thread?.modelProvider ?? "openai",
      cwd: parentSession?.thread?.cwd ?? null,
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      statusType: "notLoaded",
      statusActiveFlags: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
      linkedAt: CREATED_AT,
      resumeState: "resumed",
      turns: [],
      requests: [],
      queuedFollowUps: [],
      pendingSteers: [],
      backgroundTerminalRows: [],
      childMemberships: [],
      capabilityFlags: {
        canEditLastUserTurn: false,
        canForkFromTurn: false,
        canSearch: true,
        canCollapseTurns: true,
      },
    },
  };
}

function installStoryApi(
  sessionsByProject: Record<string, ProjectSession[]>,
) {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === "codex:thread:side-chat:start") {
          return buildStorySideChatStartResult(
            args[0] as CodexSideChatStartInput,
            sessionsByProject,
          );
        }
        if (channel === "codex:thread:side-chat:discard") {
          return true;
        }
        if (channel === "project-sessions:list" || channel === "project-sessions:list-summaries") {
          const scopeKey = args[0] === null ? "__projectless__" : String(args[0]);
          return sessionsByProject[scopeKey] ?? [];
        }
        if (channel === "board:summary:get") {
          return STORY_BOARD;
        }
        if (channel === "library-module:read") {
          const read = (args[0] as LibraryModuleReadRequest).read;
          const value: LibraryReadValue = (() => {
            if (read.mode === "metadata") return { kind: "metadata" };
            if (read.mode === "path") {
              return { kind: "path", target: read.target, nodes: [] };
            }
            if (read.mode === "catalog") {
              return { kind: "catalog", items: [], nextCursor: null, hasMore: false, total: 0 };
            }
            return {
              kind: "children",
              parent: read.parent,
              items: [],
              nextCursor: null,
              hasMore: false,
              total: 0,
            };
          })();
          return {
            ok: true,
            value: {
              version: 1,
              profileId: "profile:story",
              libraryId: "library:test",
              storeEpoch: "epoch:story",
              changeLogSeq: 0,
              value,
            },
          };
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
        if (channel === "project-session-threads:attach" || channel === "project-session-threads:detach") {
          return true;
        }
        return null;
      },
      on: () => () => undefined,
      awaitInitialization: async () => undefined,
      onInitializationStep: () => () => undefined,
      reportInitializationReady: () => undefined,
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

export const MixedRightTabs: Story = {
  parameters: {
    docs: {
      description: {
        story: "Regular 600px right panel with registry-backed global bottom/side panel toggles in the fixed toolbar, expand/restore in the panel tab header, and no empty toolbar row above the thread title.",
      },
    },
  },
};

export const SingleClosableRightPanelTab: Story = {
  args: {
    activeTab: "single-db",
    rightPanel: "regular",
    bottomPanel: "collapsed",
  },
  parameters: {
    docs: {
      description: {
        story: "A sole durable right-panel tab remains closable: hover or focus the tab to reveal its close action.",
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

export const AttachedProjectlessChatTools: Story = {
  args: {
    workspace: "projectless-only",
    activeTab: "empty",
    thread: "attached",
    rightPanel: "regular",
    bottomPanel: "collapsed",
    navigationHistory: "disabled",
  },
  parameters: {
    docs: {
      description: {
        story: "Attached projectless chat with a workspace cwd. The empty side panel exposes Side chat, Browser, and Terminal in conversation-native order.",
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

export const ProjectlessOnlyWorkspace: Story = {
  args: {
    workspace: "projectless-only",
    thread: "empty",
    activeTab: "empty",
    navigationHistory: "disabled",
  },
  parameters: {
    docs: {
      description: {
        story: "The Workbench remains mounted with its global Chats lane when no Projects exist.",
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

export const LibraryRouteShellHeader: Story = {
  args: {
    thread: "attached",
    rightPanel: "regular",
    bottomPanel: "terminal",
    sidebar: "expanded",
    sidebarWidth: 300,
    libraryWorkspace: true,
  },
  render: (args) => <LibraryRouteProjectSessionShellStory {...args} />,
  parameters: {
    docs: {
      description: {
        story: "Library route opened inside the normal Workbench shell: window navigation and Sidebar controls remain, while Project-session right and bottom panel toggles are absent.",
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

export const NarrowLongThreadHeaderWithRightPanel: Story = {
  args: {
    thread: "attached",
    rightPanel: "regular",
    sidebar: "expanded",
    sidebarWidth: 520,
    longNames: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Narrow main-thread acceptance state with a long task title, maximum-width sidebar, and regular right panel. The fixed toolbar must show exactly one clipped title row while switching tasks; no second title may enter vertically.",
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
        story: "Regular side panel plus open bottom panel, showing one active-thread title in the global header, the animated right header slot for bottom/side toggles, and the summary toggle in the thread header lane while both panel shells use Codex spring geometry.",
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
