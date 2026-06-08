import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Board, Project, ProjectSession, ProjectSessionTab } from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-state";
import { WorkbenchShell } from "./workbench-shell";

type ShellStoryArgs = {
  activeTab: "browser" | "terminal" | "db" | "review" | "empty";
  thread: "empty" | "attached";
  rightPanel: "regular" | "collapsed" | "full";
  bottomPanel: "collapsed" | "empty" | "terminal";
  sidebar: "expanded" | "collapsed";
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
    bottomPanel: "collapsed",
    sidebar: "expanded",
    longNames: false,
  },
  argTypes: {
    activeTab: {
      control: "inline-radio",
      options: ["browser", "terminal", "db", "review", "empty"],
    },
    thread: {
      control: "inline-radio",
      options: ["empty", "attached"],
    },
    rightPanel: {
      control: "inline-radio",
      options: ["regular", "collapsed", "full"],
    },
    bottomPanel: {
      control: "inline-radio",
      options: ["collapsed", "empty", "terminal"],
    },
    sidebar: {
      control: "inline-radio",
      options: ["expanded", "collapsed"],
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
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex",
    icon: "",
    created: new Date(CREATED_AT),
  },
  {
    id: "codex-readable",
    name: "Codex readable pack",
    description: "",
    workspacePath: "/Users/asc/repo/devtools-codex",
    icon: "",
    created: new Date(CREATED_AT),
  },
];

const SPACES = PROJECTS.map((project) => ({
  projectId: project.id,
  colorToken: "var(--accent-blue)",
  initial: project.name.slice(0, 1).toUpperCase(),
}));

const STORY_BOARD: Board = {
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
          description: "",
          tags: ["shell"],
          agentBlocked: false,
          created: new Date(CREATED_AT),
          order: 0,
        },
      ],
    },
  ],
};

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
  };
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return {
    version: 1,
    root: {
      type: "leaf",
      id: "main",
      tabIds,
      activeTabId,
    },
  } as const;
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
    return {
      id: "session:overview",
      projectId: "nodex",
      title: "Overview",
      isOverview: true,
      order: 0,
      leftPaneCollapsed: true,
      panels,
      thread: null,
      tabs: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
  }

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
      kind: "card_stage",
      title: args.longNames
        ? "Rewrite the project-session workbench shell while preserving card thread links"
        : "Workbench redesign",
      order: 1,
      config: { projectId: "nodex", cardId: "card-1", titleSnapshot: "Workbench redesign" },
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
      kind: "browser_placeholder",
      title: "Browser",
      order: 3,
      config: { title: "Browser" },
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
  const activeTabId = args.activeTab === "db"
    ? "tab:db"
    : args.activeTab === "terminal"
      ? "tab:terminal"
      : args.activeTab === "review"
        ? "tab:review"
        : "tab:browser";
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

  return {
    id: "session:overview",
    projectId: "nodex",
    title: args.longNames
      ? "Overview and implementation notes for a Codex-style project session shell"
      : "Overview",
    isOverview: true,
    order: 0,
    leftPaneCollapsed: true,
    panels,
    thread: args.thread === "attached"
      ? {
          sessionId: "session:overview",
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
      : null,
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
      kind: "browser_placeholder",
      title: "Browser",
      order: 1,
      config: { title: "Browser" },
    }),
  ];
  const rightTabIds = tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
  const bottomTabIds = tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
  return {
    ...makeSession({ ...args, activeTab: "terminal", thread: "empty" }),
    id: "session:release",
    title: args.longNames ? "Release validation and follow-up terminal work" : "Release run",
    isOverview: false,
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

function ProjectSessionShellStory(args: ShellStoryArgs) {
  const initialSessionsByProject = useMemo<Record<string, ProjectSession[]>>(
    () => ({
      nodex: [makeSession(args), makeSecondarySession(args)],
      "codex-readable": [
        withPanelLayouts({
          ...makeSession({ ...args, activeTab: "browser", thread: "empty" }),
          id: "session:codex-overview",
          projectId: "codex-readable",
          title: "Overview",
          tabs: [
            makeTab({
              id: "tab:codex-browser",
              sessionId: "session:codex-overview",
              projectId: "codex-readable",
              kind: "browser_placeholder",
              title: "Browser",
              config: { title: "Browser" },
            }),
          ],
        }, { right: "tab:codex-browser" }),
      ],
    }),
    [args],
  );
  const [sessionsByProject, setSessionsByProject] = useState(initialSessionsByProject);

  installStoryApi(sessionsByProject, setSessionsByProject);

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

  return (
    <div className="h-screen">
      <WorkbenchShell
        key={`${args.thread}:${args.rightPanel}:${args.bottomPanel}:${args.activeTab}:${args.longNames ? "long" : "normal"}`}
        projects={PROJECTS}
        dbProjectId="nodex"
        activeView={"kanban" as WorkbenchView}
        activeSearchQuery=""
        activeDbViewPrefs={null}
        searchByProject={{ nodex: "" }}
        dbViewPrefsByProject={{}}
        spaces={SPACES}
        sidebar={{ collapsed: args.sidebar === "collapsed", width: 300 }}
        cardStageCloseRef={{ current: null }}
        setDbProject={() => undefined}
        setSearchQuery={() => undefined}
        setDbViewPrefs={() => undefined}
        openCardStage={() => undefined}
        onLeaveCardStageCard={() => undefined}
        onCreateProject={async () => null}
        onRenameProject={async () => null}
        onDeleteProject={async () => false}
        onRequestProjectPickerOpen={() => undefined}
        threadSearchOpenTick={0}
      />
    </div>
  );
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
        if (channel === "board:get") {
          return STORY_BOARD;
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
          if (["db_view", "review", "browser_placeholder"].includes(input.kind)) {
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

export const EmptyRightPanelActions: Story = {
  args: {
    activeTab: "empty",
  },
  parameters: {
    docs: {
      description: {
        story: "Empty right panel showing the Codex-style new-tab action grid with Nodex DB View and Card Stage actions appended.",
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

export const MockBrowserRightTab: Story = {
  args: {
    activeTab: "browser",
  },
  parameters: {
    docs: {
      description: {
        story: "Browser placeholder tab rendered as a Codex-style mock surface until browser support is implemented.",
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
        story: "Session with DB View, Browser, and Review already present so the plus menu filters those singleton actions.",
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
        story: "Attached thread with the right panel collapsed, keeping the thread title at the top while rendering the Codex summary toggle at the thread header's right edge before the registry-backed global bottom/side panel slot.",
      },
    },
  },
};

export const CollapsedSidebarThreadChrome: Story = {
  args: {
    thread: "attached",
    sidebar: "collapsed",
    rightPanel: "collapsed",
    longNames: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Collapsed sidebar chrome parity scene: traffic-light safe left rail with sidebar toggle, compact New chat, and a long thread title that truncates in the top chrome.",
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

export const LongNames: Story = {
  args: {
    longNames: true,
    activeTab: "terminal",
  },
};
