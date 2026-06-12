import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { WorkspaceFilesPanel } from "./workspace-files-panel";
import type { Project, ProjectSession, WorkspaceFileDirectoryEntry } from "@/lib/types";
import { makeProjectSessionPanelLayout } from "../../../shared/project-session-panel-layout";

const WORKSPACE_ROOT = "/Users/asc/repo/nodex";
const CREATED_AT = "2026-06-13T00:00:00.000Z";

const project: Project = {
  id: "nodex",
  name: "Nodex",
  description: "",
  icon: "",
  workspacePath: WORKSPACE_ROOT,
  created: new Date(CREATED_AT),
};

const session: ProjectSession = {
  id: "session-files-story",
  projectId: project.id,
  title: "Files story",
  isOverview: false,
  order: 0,
  pinned: false,
  pinnedOrder: null,
  archived: false,
  archivedAt: null,
  unread: false,
  leftPaneCollapsed: false,
  panels: {
    right: {
      collapsed: false,
      layout: makeProjectSessionPanelLayout(["files-tab"], "files-tab"),
      size: { widthPx: 600 },
    },
    bottom: {
      collapsed: true,
      layout: makeProjectSessionPanelLayout([], null),
      size: { heightPx: 280 },
    },
  },
  thread: null,
  tabs: [],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const directoryEntries: Record<string, WorkspaceFileDirectoryEntry[]> = {
  [WORKSPACE_ROOT]: [
    entry("src", `${WORKSPACE_ROOT}/src`, "directory"),
    entry("README.md", `${WORKSPACE_ROOT}/README.md`, "file"),
    entry("CLAUDE.md", `${WORKSPACE_ROOT}/CLAUDE.md`, "file"),
  ],
  [`${WORKSPACE_ROOT}/src`]: [
    entry("renderer", `${WORKSPACE_ROOT}/src/renderer`, "directory"),
    entry("main", `${WORKSPACE_ROOT}/src/main`, "directory"),
  ],
};

const fileContents: Record<string, string> = {
  [`${WORKSPACE_ROOT}/README.md`]: "# Nodex\n\nLocal-first, block-based agent orchestration.",
  [`${WORKSPACE_ROOT}/CLAUDE.md`]: "# Agent Notes\n\nUse the Files tab to inspect workspace documents.",
};

const meta = {
  title: "Workspace/Files panel",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptySelection: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={undefined} />
  ),
};

export const MarkdownSelected: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={`${WORKSPACE_ROOT}/README.md`} />
  ),
};

export const UnsupportedBinary: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={`${WORKSPACE_ROOT}/archive.zip`} />
  ),
};

function WorkspaceFilesStoryFrame({ selectedPath }: { selectedPath: string | undefined }) {
  useMockWorkspaceFilesBridge();
  return (
    <div className="h-screen bg-token-main-surface-primary">
      <WorkspaceFilesPanel
        tab={{
          id: "files-tab",
          sessionId: session.id,
          projectId: project.id,
          panelId: "right",
          kind: "files",
          title: selectedPath ? selectedPath.split("/").at(-1) ?? "Files" : "Files",
          order: 0,
          config: {
            projectId: project.id,
            hostId: "local",
            workspaceRoot: WORKSPACE_ROOT,
            ...(selectedPath ? { path: selectedPath } : {}),
          },
          stateKey: 0,
          state: {},
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        }}
        activeSession={session}
        project={project}
        onOpenFileTab={async () => undefined}
      />
    </div>
  );
}

function entry(name: string, path: string, kind: "directory" | "file"): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    kind,
    isDirectory: kind === "directory",
    isFile: kind === "file",
    isSymlink: false,
    size: kind === "file" ? 2048 : 0,
    modifiedAtMs: Date.parse(CREATED_AT),
    hidden: name.startsWith("."),
  };
}

function useMockWorkspaceFilesBridge() {
  useEffect(() => {
    const previousApi = window.api;
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        invoke: async (channel: string, ...args: unknown[]) => {
          if (channel === "workspace-directory-entries") {
            const input = args[0] as { path?: string; workspaceRoot: string };
            const path = input.path ?? input.workspaceRoot;
            return {
              hostId: "local",
              workspaceRoot: input.workspaceRoot,
              path,
              entries: directoryEntries[path] ?? [],
            };
          }
          if (channel === "read-file-metadata") {
            const input = args[0] as { path: string };
            const unsupported = input.path.endsWith(".zip");
            return {
              path: input.path,
              kind: "file",
              isDirectory: false,
              isFile: true,
              isSymlink: false,
              size: unsupported ? 12_000 : fileContents[input.path]?.length ?? 0,
              createdAtMs: Date.parse(CREATED_AT),
              modifiedAtMs: Date.parse(CREATED_AT),
              binary: unsupported,
              mimeType: unsupported ? "application/zip" : "text/markdown",
            };
          }
          if (channel === "read-file") {
            const input = args[0] as { path: string };
            return {
              path: input.path,
              content: fileContents[input.path] ?? "",
              encoding: "utf8",
              size: fileContents[input.path]?.length ?? 0,
              truncated: false,
              binary: false,
            };
          }
          if (channel === "open-file") return true;
          return null;
        },
        on: () => () => undefined,
        off: () => undefined,
      },
    });
    return () => {
      Object.defineProperty(window, "api", {
        configurable: true,
        value: previousApi,
      });
    };
  }, []);
}
