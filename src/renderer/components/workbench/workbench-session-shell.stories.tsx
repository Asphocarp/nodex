import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectSession, ProjectSessionTab, WorkspaceRecord } from "@/lib/types";
import type { WorkbenchView } from "@/lib/use-workbench-state";
import { WorkbenchShell } from "./workbench-shell";

type ShellStoryArgs = {
  activeTab: "browser" | "terminal" | "db";
  thread: "empty" | "attached";
  rightPanel: "regular" | "collapsed" | "full";
  sidebar: "expanded" | "collapsed";
  longNames: boolean;
};

const meta = {
  title: "Workbench/Project session shell",
  parameters: {
    layout: "fullscreen",
  },
  args: {
    activeTab: "browser",
    thread: "empty",
    rightPanel: "regular",
    sidebar: "expanded",
    longNames: false,
  },
  argTypes: {
    activeTab: {
      control: "inline-radio",
      options: ["browser", "terminal", "db"],
    },
    thread: {
      control: "inline-radio",
      options: ["empty", "attached"],
    },
    rightPanel: {
      control: "inline-radio",
      options: ["regular", "collapsed", "full"],
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

const WORKSPACES: WorkspaceRecord[] = [
  {
    id: "default",
    name: "Default",
    icon: "",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    layout: {} as WorkspaceRecord["layout"],
  },
  {
    id: "review",
    name: "Review",
    icon: "",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    layout: {} as WorkspaceRecord["layout"],
  },
];

const SPACES = PROJECTS.map((project) => ({
  projectId: project.id,
  colorToken: "var(--accent-blue)",
  initial: project.name.slice(0, 1).toUpperCase(),
}));

function makeTab(
  overrides: Partial<ProjectSessionTab> & Pick<ProjectSessionTab, "id" | "kind" | "title" | "config">,
): ProjectSessionTab {
  return {
    sessionId: "session:overview",
    projectId: "nodex",
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeSession(args: ShellStoryArgs): ProjectSession {
  const tabs = [
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
      config: { projectId: "nodex", terminalSessionId: "story-terminal", mode: "project" },
    }),
    makeTab({
      id: "tab:browser",
      kind: "browser_placeholder",
      title: "Browser",
      order: 3,
      config: { title: "Browser" },
    }),
  ];
  const activeTabId = args.activeTab === "db"
    ? "tab:db"
    : args.activeTab === "terminal"
      ? "tab:terminal"
      : "tab:browser";

  return {
    id: "session:overview",
    projectId: "nodex",
    title: args.longNames
      ? "Overview and implementation notes for a Codex-style project session shell"
      : "Overview",
    isOverview: true,
    order: 0,
    leftPaneCollapsed: true,
    rightPaneCollapsed: args.rightPanel === "collapsed",
    rightPaneLayout: {
      version: 1,
      root: {
        type: "leaf",
        id: "main",
        tabIds: tabs.map((tab) => tab.id),
        activeTabId,
      },
    },
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
  return {
    ...makeSession({ ...args, activeTab: "terminal", thread: "empty" }),
    id: "session:release",
    title: args.longNames ? "Release validation and follow-up terminal work" : "Release run",
    isOverview: false,
    order: 1,
    tabs: [
      makeTab({
        id: "tab:release-terminal",
        sessionId: "session:release",
        kind: "terminal",
        title: "Release terminal",
        order: 0,
        config: { projectId: "nodex", terminalSessionId: "release-terminal", mode: "project" },
      }),
      makeTab({
        id: "tab:release-browser",
        sessionId: "session:release",
        kind: "browser_placeholder",
        title: "Browser",
        order: 1,
        config: { title: "Browser" },
      }),
    ],
    rightPaneLayout: {
      version: 1,
      root: {
        type: "leaf",
        id: "main",
        tabIds: ["tab:release-terminal", "tab:release-browser"],
        activeTabId: "tab:release-terminal",
      },
    },
  };
}

function ProjectSessionShellStory(args: ShellStoryArgs) {
  const initialSessionsByProject = useMemo<Record<string, ProjectSession[]>>(
    () => ({
      nodex: [makeSession(args), makeSecondarySession(args)],
      "codex-readable": [
        {
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
          rightPaneLayout: {
              version: 1 as const,
              root: {
                type: "leaf" as const,
                id: "main",
                tabIds: ["tab:codex-browser"],
                activeTabId: "tab:codex-browser",
            },
          },
        },
      ],
    }),
    [args],
  );
  const [sessionsByProject, setSessionsByProject] = useState(initialSessionsByProject);

  installStoryApi(sessionsByProject, setSessionsByProject);

  useEffect(() => {
    if (args.rightPanel !== "full") return undefined;
    const timeout = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Expand panel"]')?.click();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [args.rightPanel, sessionsByProject]);

  return (
    <div className="h-screen">
      <WorkbenchShell
        key={`${args.thread}:${args.rightPanel}:${args.activeTab}:${args.longNames ? "long" : "normal"}`}
        projects={PROJECTS}
        dbProjectId="nodex"
        activeView={"kanban" as WorkbenchView}
        activeSearchQuery=""
        activeDbViewPrefs={null}
        searchByProject={{ nodex: "" }}
        dbViewPrefsByProject={{}}
        spaces={SPACES}
        workspaces={WORKSPACES}
        activeWorkspaceId="default"
        sidebar={{ collapsed: args.sidebar === "collapsed", width: 300 }}
        cardStageCloseRef={{ current: null }}
        setDbProject={() => undefined}
        setSearchQuery={() => undefined}
        setDbViewPrefs={() => undefined}
        openCardStage={() => undefined}
        onLeaveCardStageCard={() => undefined}
        onSelectWorkspace={() => undefined}
        onCreateProject={async () => null}
        onRenameProject={async () => null}
        onDeleteProject={async () => false}
        onCreateWorkspace={async () => undefined}
        onRenameWorkspace={async () => undefined}
        onDeleteWorkspace={async () => undefined}
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
        if (channel === "project-sessions:update") {
          const sessionId = String(args[0]);
          const input = (args[1] ?? {}) as Partial<ProjectSession>;
          const updated = Object.values(sessionsByProject)
            .flat()
            .find((session) => session.id === sessionId);
          if (!updated) return null;
          const next = { ...updated, ...input, updatedAt: new Date().toISOString() };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
        }
        if (channel === "project-session-tabs:reorder") {
          const sessionId = String(args[0]);
          const order = (args[1] as string[] | undefined) ?? [];
          const session = Object.values(sessionsByProject)
            .flat()
            .find((item) => item.id === sessionId);
          if (!session) return null;
          const byId = new Map(session.tabs.map((tab) => [tab.id, tab]));
          const tabs = order.flatMap((tabId, index) => {
            const tab = byId.get(tabId);
            return tab ? [{ ...tab, order: index }] : [];
          });
          const next = {
            ...session,
            tabs,
            rightPaneLayout: {
              version: 1 as const,
              root: {
                type: "leaf" as const,
                id: "main",
                tabIds: tabs.map((tab) => tab.id),
                activeTabId: session.rightPaneLayout.root.type === "leaf"
                  ? session.rightPaneLayout.root.activeTabId
                  : tabs[0]?.id ?? null,
              },
            },
          };
          setSessionsByProject((current) => replaceSession(current, next));
          return next;
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
          return null;
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

export const MixedRightTabs: Story = {};

export const AttachedThreadPage: Story = {
  args: {
    thread: "attached",
    activeTab: "browser",
  },
};

export const CollapsedRightPanel: Story = {
  args: {
    rightPanel: "collapsed",
  },
};

export const FullWidthRightPanel: Story = {
  args: {
    rightPanel: "full",
    activeTab: "terminal",
  },
};

export const LongNames: Story = {
  args: {
    longNames: true,
    activeTab: "terminal",
  },
};
