import { beforeAll, beforeEach, describe, expect, vi, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "../../test/dom";
import { TestQueryProvider } from "../../test/query";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { Project, ProjectSession, WorkspaceFileDirectoryEntry } from "@/lib/types";
import type { WorkspaceFilesTab } from "./workspace-file-types";

let WorkspaceFilesPanel: typeof import("./workspace-files-panel")["WorkspaceFilesPanel"];
let invokeCalls: unknown[][] = [];
let openFileTabCalls: { path: string; title: string; panelId: WorkspaceFilesTab["panelId"] }[] = [];

const WORKSPACE_ROOT = "/workspace";
const WORKTREE_FILE = "/profile/worktrees/abcd/project/README.md";
const HUGE_FILE = "/profile/worktrees/abcd/project/huge.txt";
const LARGE_MARKDOWN_FILE = `${WORKSPACE_ROOT}/large.md`;
const CREATED_AT = "2026-06-13T00:00:00.000Z";

const directoryEntries: Record<string, WorkspaceFileDirectoryEntry[]> = {
  "": [
    entry("src", "src", "directory"),
    entry("README.md", "README.md", "file"),
    entry("archive.zip", "archive.zip", "file"),
  ],
  src: [
    entry("index.ts", "src/index.ts", "file"),
  ],
};

const fileContents: Record<string, string> = {
  [`${WORKSPACE_ROOT}/README.md`]: "# Project\n\nWorkspace notes.",
  [`${WORKSPACE_ROOT}/src/index.ts`]: "export const value = 1;\n",
  [WORKTREE_FILE]: "# Project\n\nWorktree notes.",
  [LARGE_MARKDOWN_FILE]: `# Large\n\n${"linked content\n".repeat(20_000)}`,
};

vi.mock("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
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
        sizeBytes: input.path === HUGE_FILE
          ? 2_000_000
          : unsupported
            ? 12_000
            : fileContents[input.path]?.length ?? 0,
        createdAtMs: Date.parse(CREATED_AT),
        mtimeMs: Date.parse(CREATED_AT),
        contentKind: unsupported ? "binary" : "text",
      };
    }
    if (channel === "read-file") {
      const input = args[0] as { path: string };
      const content = fileContents[input.path] ?? "";
      return {
        contents: content,
      };
    }
    if (channel === "open-file") return true;
    throw new Error(`Unexpected channel: ${channel}`);
  },
  subscribeBoardChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
  subscribeProjectChanges: () => () => undefined,
  subscribeCodexHostMessages: () => () => undefined,
  subscribeDesktopNotificationActions: () => () => undefined,
  subscribeGitBranchChanges: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
  getWindowFocusState: async () => true,
  subscribeWindowFocusChanges: () => () => undefined,
}));

beforeAll(async () => {
  const module = await import("./workspace-files-panel");
  WorkspaceFilesPanel = module.WorkspaceFilesPanel;
});

beforeEach(() => {
  invokeCalls = [];
  openFileTabCalls = [];
});

describe("WorkspaceFilesPanel", () => {
  test("renders the tree filter and opens files through preview tabs", async () => {
    const view = renderPanel();
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByPlaceholderText("Filter files...") !== null).toBe(true);
    expect(view.getByText("README.md") !== null).toBe(true);
    expect(view.getByText("archive.zip") !== null).toBe(true);

    fireEvent.input(view.getByPlaceholderText("Filter files..."), { target: { value: "read" } });
    await settleAsyncRender();
    expect(view.getByText("README.md") !== null).toBe(true);
    expect(view.queryByText("archive.zip")).toBe(null);

    fireEvent.click(view.getByText("README.md"));
    await settleAsyncRender();

    expect(JSON.stringify(openFileTabCalls)).toBe(JSON.stringify([{
      path: `${WORKSPACE_ROOT}/README.md`,
      title: "README.md",
      panelId: "right",
    }]));
  });

  test("previews an outside-root file while keeping only the directory request root-scoped", async () => {
    const view = renderPanel(WORKTREE_FILE);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Project") !== null).toBe(true);
    expect(view.getByText("Worktree notes.") !== null).toBe(true);
    const directoryCall = invokeCalls.find((call) => call[0] === "workspace-directory-entries");
    expect(directoryCall?.[1]).toEqual({
      hostId: "local",
      workspaceRoot: WORKSPACE_ROOT,
      directoryPath: "",
      includeHidden: true,
    });
    const fileCalls = invokeCalls.filter((call) => ["read-file-metadata", "read-file"].includes(String(call[0])));
    expect(fileCalls.length).toBe(2);
    expect(fileCalls.every((call) => !JSON.stringify(call[1]).includes("workspaceRoot"))).toBe(true);
  });

  test("previews a projectless exact file without requesting a directory tree", async () => {
    const tab = makeFilesTab(WORKTREE_FILE);
    const view = render(
      <TestQueryProvider>
        <NodexTooltipProvider>
          <WorkspaceFilesPanel
            tab={{
              ...tab,
              projectId: null,
              config: {
                ...tab.config,
                projectId: null,
                cwd: "/profile/worktrees/abcd/project",
                workspaceRoot: null,
              },
            }}
            activeSession={{ ...activeSession, projectId: null }}
            project={null}
            onOpenFileTab={async () => undefined}
          />
        </NodexTooltipProvider>
      </TestQueryProvider>,
    );
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Worktree notes.") !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "workspace-directory-entries")).toBe(false);
  });

  test("uses metadata to reject oversized text before reading full contents", async () => {
    const view = renderPanel(HUGE_FILE);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("huge.txt is too large to preview.") !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "read-file")).toBe(false);
  });

  test("routes large Markdown to exact source without mounting the rich renderer", async () => {
    const view = renderPanel(LARGE_MARKDOWN_FILE);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Rich preview is unavailable for large Markdown files.")).not.toBeNull();
    expect(view.container.querySelector(
      "[data-virtualized-text-viewer='true'], [aria-label^='Loading Markdown source']",
    )).not.toBeNull();
    expect(view.container.querySelector(".codex-markdown-user")).toBe(null);
    expect(invokeCalls.some((call) => (
      call[0] === "read-file"
      && (call[1] as { maxBytes?: number }).maxBytes === 1_500_000
    ))).toBe(true);
  });

  test("renders unsupported binaries with external-open action", async () => {
    const view = renderPanel(`${WORKSPACE_ROOT}/archive.zip`);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Preview is not available for archive.zip.") !== null).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    await settleAsyncRender();

    expect(JSON.stringify(invokeCalls.at(-1))).toBe(JSON.stringify([
      "open-file",
      { path: `${WORKSPACE_ROOT}/archive.zip` },
      "fileManager",
    ]));
  });
});

function renderPanel(selectedPath?: string) {
  return render(
    <TestQueryProvider>
      <NodexTooltipProvider>
        <WorkspaceFilesPanel
          tab={makeFilesTab(selectedPath)}
          activeSession={activeSession}
          project={project}
          onOpenFileTab={async (input) => {
            openFileTabCalls.push(input);
          }}
        />
      </NodexTooltipProvider>
    </TestQueryProvider>,
  );
}

function makeFilesTab(selectedPath?: string): WorkspaceFilesTab {
  return {
    id: "files-tab",
    sessionId: activeSession.id,
    projectId: project.id,
    browserTabId: null,
    panelId: "right",
    kind: "files",
    title: selectedPath ? selectedPath.split("/").at(-1) ?? "Files" : "Files",
    order: 0,
    config: {
      projectId: project.id,
      hostId: "local",
      cwd: WORKSPACE_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      ...(selectedPath ? { path: selectedPath } : {}),
    },
    stateKey: 0,
    state: {},
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function entry(name: string, path: string, kind: "directory" | "file"): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    type: kind,
    isSymlink: false,
  };
}

const project: Project = {
  id: "alpha",
  libraryId: "library:test",
  databaseId: "database:test:primary",
  defaultDatabaseViewId: "view:test:primary",
  lifecycle: "active",
  bindingRevision: 1,
  name: "Alpha",
  description: "",
  icon: "",
  sources: [{ root: WORKSPACE_ROOT, order: 0 }],
  primaryWorkspaceRoot: WORKSPACE_ROOT,
  pinned: false,
  pinnedOrder: null,
  created: new Date(CREATED_AT),
  updated: new Date(CREATED_AT),
};

const activeSession: ProjectSession = {
  id: "session-1",
  projectId: project.id,
  databaseStarter: false,
  noThreadFallbackTitle: "Session",
  displayTitle: "Session",
  order: 0,
  pinned: false,
  pinnedOrder: null,
  archived: false,
  archivedAt: null,
  unread: false,
  thread: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};
