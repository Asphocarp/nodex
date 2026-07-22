import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { WorkspaceFilesPanel } from "./workspace-files-panel";
import type { Project, ProjectSession, WorkspaceFileDirectoryEntry } from "@/lib/types";
import { makeProjectSessionPanelLayout } from "../../../shared/project-session-panel-layout";

const WORKSPACE_ROOT = "/Users/asc/repo/nodex";
const WORKTREE_FILE = "/Users/asc/.nodex/worktrees/abcd/nodex/README.md";
const LARGE_MARKDOWN_FILE = `${WORKSPACE_ROOT}/large-notes.md`;
const CREATED_AT = "2026-06-13T00:00:00.000Z";
const LARGE_MARKDOWN_SOURCE = Array.from(
  { length: 6_000 },
  (_, index) => `- [Reference ${index + 1}](https://example.com/reference/${index + 1}) keeps exact source available.`,
).join("\n");

const project: Project = {
  id: "nodex",
  libraryId: "library:test",
  databaseId: "database:test:primary",
  lifecycle: "active",
  bindingRevision: 1,
  name: "Nodex",
  description: "",
  icon: "",
  sources: [{ root: WORKSPACE_ROOT, order: 0 }],
  primaryWorkspaceRoot: WORKSPACE_ROOT,
  pinned: false,
  pinnedOrder: null,
  created: new Date(CREATED_AT),
  updated: new Date(CREATED_AT),
};

const session: ProjectSession = {
  id: "session-files-story",
  projectId: project.id,
  noThreadFallbackTitle: "Files story",
  displayTitle: "Files story",
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
  "": [
    entry("src", "src", "directory"),
    entry("README.md", "README.md", "file"),
    entry("large-notes.md", "large-notes.md", "file"),
    entry("CLAUDE.md", "CLAUDE.md", "file"),
  ],
  src: [
    entry("renderer", "src/renderer", "directory"),
    entry("main", "src/main", "directory"),
  ],
};

const fileContents: Record<string, string> = {
  [`${WORKSPACE_ROOT}/README.md`]: "# Nodex\n\nLocal-first, block-based agent orchestration.",
  [LARGE_MARKDOWN_FILE]: LARGE_MARKDOWN_SOURCE,
  [`${WORKSPACE_ROOT}/CLAUDE.md`]: "# Agent Notes\n\nUse the Files tab to inspect workspace documents.",
  [WORKTREE_FILE]: "# Worktree\n\nThis file is outside the Project source and still previews.",
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

export const LargeMarkdownSourceFallback: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={LARGE_MARKDOWN_FILE} />
  ),
};

export const UnsupportedBinary: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={`${WORKSPACE_ROOT}/archive.zip`} />
  ),
};

export const OutsideWorkspaceSelected: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={WORKTREE_FILE} />
  ),
};

export const ProjectlessFile: Story = {
  render: () => (
    <WorkspaceFilesStoryFrame selectedPath={WORKTREE_FILE} workspaceRoot={null} />
  ),
};

function WorkspaceFilesStoryFrame({
  selectedPath,
  workspaceRoot = WORKSPACE_ROOT,
}: {
  selectedPath: string | undefined;
  workspaceRoot?: string | null;
}) {
  useMockWorkspaceFilesBridge();
  const projectless = workspaceRoot === null;
  const activeSession = projectless
    ? { ...session, projectId: null }
    : session;
  return (
    <div className="h-screen bg-token-main-surface-primary">
      <WorkspaceFilesPanel
        tab={{
          id: "files-tab",
          sessionId: session.id,
          projectId: projectless ? null : project.id,
          browserTabId: null,
          panelId: "right",
          kind: "files",
          title: selectedPath ? selectedPath.split("/").at(-1) ?? "Files" : "Files",
          order: 0,
          config: {
            projectId: projectless ? null : project.id,
            hostId: "local",
            cwd: workspaceRoot,
            workspaceRoot,
            ...(selectedPath ? { path: selectedPath } : {}),
          },
          stateKey: 0,
          state: {},
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        }}
        activeSession={activeSession}
        project={projectless ? null : project}
        onOpenFileTab={async () => undefined}
      />
    </div>
  );
}

function entry(name: string, path: string, kind: "directory" | "file"): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    type: kind,
    isSymlink: false,
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
            const input = args[0] as { directoryPath?: string };
            const directoryPath = input.directoryPath ?? "";
            return {
              directoryPath,
              parentPath: directoryPath ? "" : null,
              entries: directoryEntries[directoryPath] ?? [],
            };
          }
          if (channel === "read-file-metadata") {
            const input = args[0] as { path: string };
            const unsupported = input.path.endsWith(".zip");
            return {
              isFile: true,
              sizeBytes: unsupported ? 12_000 : fileContents[input.path]?.length ?? 0,
              createdAtMs: Date.parse(CREATED_AT),
              mtimeMs: Date.parse(CREATED_AT),
              contentKind: unsupported ? "binary" : "text",
            };
          }
          if (channel === "read-file") {
            const input = args[0] as { path: string };
            return {
              contents: fileContents[input.path] ?? "",
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
