import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "../../test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { Project, ProjectSession, WorkspaceFileDirectoryEntry } from "@/lib/types";
import { makeProjectSessionPanelLayout } from "../../../shared/project-session-panel-layout";
import type { WorkspaceFilesTab } from "./workspace-file-types";

let WorkspaceFilesPanel: typeof import("./workspace-files-panel")["WorkspaceFilesPanel"];
let invokeCalls: unknown[][] = [];
let openFileTabCalls: { path: string; title: string; panelId: WorkspaceFilesTab["panelId"] }[] = [];

const WORKSPACE_ROOT = "/workspace";
const CREATED_AT = "2026-06-13T00:00:00.000Z";

const directoryEntries: Record<string, WorkspaceFileDirectoryEntry[]> = {
  [WORKSPACE_ROOT]: [
    entry("src", `${WORKSPACE_ROOT}/src`, "directory"),
    entry("README.md", `${WORKSPACE_ROOT}/README.md`, "file"),
    entry("archive.zip", `${WORKSPACE_ROOT}/archive.zip`, "file"),
  ],
  [`${WORKSPACE_ROOT}/src`]: [
    entry("index.ts", `${WORKSPACE_ROOT}/src/index.ts`, "file"),
  ],
};

const fileContents: Record<string, string> = {
  [`${WORKSPACE_ROOT}/README.md`]: "# Project\n\nWorkspace notes.",
  [`${WORKSPACE_ROOT}/src/index.ts`]: "export const value = 1;\n",
};

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    if (channel === "workspace-directory-entries") {
      const input = args[0] as { workspaceRoot: string; path?: string };
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
      const content = fileContents[input.path] ?? "";
      return {
        path: input.path,
        content,
        encoding: "utf8",
        size: content.length,
        truncated: false,
        binary: false,
      };
    }
    if (channel === "open-file") return true;
    throw new Error(`Unexpected channel: ${channel}`);
  },
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

    expect(view.getByPlaceholderText("Filter files...") !== null).toBeTrue();
    expect(view.getByText("README.md") !== null).toBeTrue();
    expect(view.getByText("archive.zip") !== null).toBeTrue();

    fireEvent.input(view.getByPlaceholderText("Filter files..."), { target: { value: "read" } });
    await settleAsyncRender();
    expect(view.getByText("README.md") !== null).toBeTrue();
    expect(view.queryByText("archive.zip")).toBe(null);

    fireEvent.click(view.getByText("README.md"));
    await settleAsyncRender();

    expect(JSON.stringify(openFileTabCalls)).toBe(JSON.stringify([{
      path: `${WORKSPACE_ROOT}/README.md`,
      title: "README.md",
      panelId: "right",
    }]));
  });

  test("renders selected markdown and sends root-scoped read requests", async () => {
    const view = renderPanel(`${WORKSPACE_ROOT}/README.md`);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Project") !== null).toBeTrue();
    expect(invokeCalls.some((call) =>
      call[0] === "read-file"
      && JSON.stringify(call[1]).includes(`"workspaceRoot":"${WORKSPACE_ROOT}"`)
    )).toBeTrue();
  });

  test("renders unsupported binaries with external-open action", async () => {
    const view = renderPanel(`${WORKSPACE_ROOT}/archive.zip`);
    await settleAsyncRender();
    await settleAsyncRender();

    expect(view.getByText("Preview is not available for archive.zip.") !== null).toBeTrue();
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
    <NodexTooltipProvider>
      <WorkspaceFilesPanel
        tab={makeFilesTab(selectedPath)}
        activeSession={activeSession}
        project={project}
        onOpenFileTab={async (input) => {
          openFileTabCalls.push(input);
        }}
      />
    </NodexTooltipProvider>,
  );
}

function makeFilesTab(selectedPath?: string): WorkspaceFilesTab {
  return {
    id: "files-tab",
    sessionId: activeSession.id,
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
  };
}

function entry(name: string, path: string, kind: "directory" | "file"): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    kind,
    isDirectory: kind === "directory",
    isFile: kind === "file",
    isSymlink: false,
    size: kind === "file" ? 128 : 0,
    modifiedAtMs: Date.parse(CREATED_AT),
    hidden: name.startsWith("."),
  };
}

const project: Project = {
  id: "alpha",
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
  title: "Session",
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
