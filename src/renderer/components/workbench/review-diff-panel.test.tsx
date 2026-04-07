import { beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { NodexTooltipProvider } from "../ui/tooltip";
import type { CodexConversationSnapshot } from "@/lib/types";
import { ReviewDiffPanel } from "./review-diff-panel";
import type { FileDiffMetadata } from "@pierre/diffs/react";

const invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((...args: unknown[]) => Promise<unknown>) | null = null;

function stripPatchPath(value: string): string {
  return value.replace(/^([ab])\//, "");
}

function isDomElement(value: unknown): value is HTMLElement {
  return typeof value === "object"
    && value !== null
    && "nodeType" in value
    && (value as { nodeType?: unknown }).nodeType === Node.ELEMENT_NODE;
}

function parsePatchFilesForTest(patch: string): Array<{ files: FileDiffMetadata[] }> {
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return [];

  const filePatches = normalizedPatch
    .split(/^diff --git /m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => `diff --git ${chunk}`);

  return filePatches.map((filePatch) => {
    const lines = filePatch.split("\n");
    const previousHeader = lines.find((line) => line.startsWith("--- ")) ?? null;
    const nextHeader = lines.find((line) => line.startsWith("+++ ")) ?? null;
    const previousPath = previousHeader
      ? stripPatchPath(previousHeader.slice(4).trim().replace(/^\/dev\/null$/, ""))
      : "";
    const nextPath = nextHeader
      ? stripPatchPath(nextHeader.slice(4).trim().replace(/^\/dev\/null$/, ""))
      : "";

    const hunks = lines.reduce<Array<{
      header: string;
      additionStart: number;
      deletionStart: number;
      additionLines: number;
      deletionLines: number;
    }>>((acc, line) => {
      if (!line.startsWith("@@ ")) return acc;
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      acc.push({
        header: line,
        deletionStart: Number(match?.[1] ?? "1"),
        additionStart: Number(match?.[2] ?? "1"),
        additionLines: 0,
        deletionLines: 0,
      });
      return acc;
    }, []);

    let currentHunk = hunks[0] ?? null;
    let hunkIndex = 0;
    for (const line of lines) {
      if (line.startsWith("@@ ")) {
        currentHunk = hunks[hunkIndex] ?? null;
        hunkIndex += 1;
        continue;
      }
      if (!currentHunk) continue;
      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
      if (line.startsWith("+")) {
        currentHunk.additionLines += 1;
        continue;
      }
      if (line.startsWith("-")) {
        currentHunk.deletionLines += 1;
      }
    }

    const fileDiff = {
      name: nextPath || previousPath || "file.ts",
      prevName: previousPath || null,
      type: previousPath.length === 0 ? "add" : nextPath.length === 0 ? "delete" : "modify",
      hunks,
      additionLines: hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
      deletionLines: hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
    } as unknown as FileDiffMetadata;

    return { files: [fileDiff] };
  });
}

const reviewDiffPanelTestDeps = {
  parsePatchFiles: parsePatchFilesForTest,
  invoke: async (...args: unknown[]) => {
    invokeCalls.push(args);
    if (!mockInvokeImpl) return null;
    return mockInvokeImpl(...args);
  },
  useTheme: () => ({
    theme: "light" as const,
    resolved: "light" as const,
    setTheme: () => { },
  }),
  FileDiff: ({ className, fileDiff }: { className?: string; fileDiff: { name?: string } }) =>
    createElement("div", { className, "data-file-diff": fileDiff.name ?? "file" }),
  MultiFileDiff: ({ className }: { className?: string }) =>
    createElement("div", { className, "data-multi-file-diff": "true" }),
};

function buildConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_review",
    projectId: "codex",
    cardId: "card-1",
    source: null,
    threadName: "Review",
    threadPreview: "Patch preview",
    modelProvider: "codex",
    cwd: "/tmp/codex",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-01T00:00:00.000Z",
    resumeState: "resumed",
    turns: [
      {
        threadId: "thr_review",
        turnId: "turn_1",
        status: "completed",
        diff: "diff --git a/src/example.ts b/src/example.ts\nindex 1111111..2222222 100644\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1,2 @@\n export const value = 1;\n+export const review = true;\n",
        itemIds: [],
        items: [],
      },
    ],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
      canCollapseTurns: true,
    },
  };
}

function buildMultiFilePatch(fileCount: number, nested = false): string {
  return Array.from({ length: fileCount }, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    const dirPrefix = nested
      ? `src/domain-${String((index % 8) + 1).padStart(2, "0")}/feature-${String(Math.floor(index / 8) + 1).padStart(2, "0")}`
      : "src";
    const filePath = `${dirPrefix}/file-${suffix}.ts`;
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "index 1111111..2222222 100644",
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -1 +1,2 @@",
      ` export const file${suffix} = ${index + 1};`,
      `+export const changed${suffix} = true;`,
      "",
    ].join("\n");
  }).join("\n");
}

function buildGitSummary(path: string, status: "modified" | "added" | "deleted" | "renamed" = "modified") {
  return {
    path,
    previousPath: null,
    status,
    additions: 1,
    deletions: 0,
  };
}

beforeEach(() => {
  invokeCalls.length = 0;
  mockInvokeImpl = null;
});

async function loadReviewDiffPanelModule() {
  function TestReviewDiffPanel(props: Omit<ComponentProps<typeof ReviewDiffPanel>, "deps">) {
    return <ReviewDiffPanel {...props} deps={reviewDiffPanelTestDeps} />;
  }

  return { ReviewDiffPanel: TestReviewDiffPanel };
}

async function waitForReviewTree(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    if (!container.querySelector('[data-review-tree-item="true"]')) {
      throw new Error("Expected review tree items to render.");
    }
  });
}

async function waitForReviewTreePath(container: HTMLElement, path: string): Promise<HTMLElement> {
  let row: Element | null = null;
  await waitFor(() => {
    row = container.querySelector(`[data-review-tree-path="${path}"]`);
    if (!row) {
      throw new Error(`Expected review tree row for ${path}.`);
    }
  });
  if (!isDomElement(row)) {
    throw new Error(`Expected review tree row for ${path}.`);
  }
  return row;
}

async function waitForMenuItem(baseElement: HTMLElement, text: string): Promise<HTMLElement> {
  let item: Element | null = null;
  await waitFor(() => {
    item = Array.from(baseElement.ownerDocument.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent?.includes(text) === true) ?? null;
    if (!item) {
      throw new Error(`Expected menu item containing ${text}.`);
    }
  });
  if (!isDomElement(item)) {
    throw new Error(`Expected menu item containing ${text}.`);
  }
  return item;
}

async function waitForButtonText(container: HTMLElement, text: string): Promise<HTMLElement> {
  let button: Element | null = null;
  await waitFor(() => {
    button = Array.from(container.querySelectorAll("button"))
      .find((node) => node.textContent === text) ?? null;
    if (!button) {
      throw new Error(`Expected button with text ${text}.`);
    }
  });
  if (!isDomElement(button)) {
    throw new Error(`Expected button with text ${text}.`);
  }
  return button;
}

describe("review diff panel", () => {
  test("renders last-turn file diffs from the active conversation", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const { container, getByText } = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(getByText("Last turn").textContent).toBe("Last turn");
    expect(textContent(container).includes("example.ts")).toBeTrue();
    expect(container.querySelector('[data-file-diff="src/example.ts"]')).not.toBeNull();
  });

  test("prefers the explicitly selected turn diff when provided", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const { container, getByText } = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          selectedTurnDiff={{
            type: "turnDiff",
            threadId: "thr_review",
            turnId: "turn_selected",
            entryId: "turn-diff:turn_selected",
            patch: "diff --git a/src/selected.ts b/src/selected.ts\nindex 1111111..2222222 100644\n--- a/src/selected.ts\n+++ b/src/selected.ts\n@@ -1 +1 @@\n-export const selected = false;\n+export const selected = true;\n",
            cwd: "/tmp/codex",
            showRevertButton: true,
          }}
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(getByText("Selected turn").textContent).toBe("Selected turn");
    expect(textContent(container).includes("selected.ts")).toBeTrue();
    expect(container.querySelector('[data-file-diff="src/selected.ts"]')).not.toBeNull();
  });

  test("opens the file tree when requested", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    fireEvent.click(view.getByLabelText("Show file tree"));

    expect(view.getByPlaceholderText("Filter files…").getAttribute("placeholder")).toBe("Filter files…");
    expect(textContent(view.container).includes("src")).toBeTrue();
    expect(textContent(view.container).includes("example.ts")).toBeTrue();
    expect(view.container.querySelector('[data-item-type="folder"]')).not.toBeNull();
    expect(view.container.querySelector('[data-item-type="file"]')).not.toBeNull();
    expect(view.getByLabelText("Resize file tree").getAttribute("role")).toBe("separator");
  });

  test("resizes the file tree from the separator", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await waitForReviewTree(view.container);

    const separator = view.getByLabelText("Resize file tree");
    let treeHost: Element | null = null;
    await waitFor(() => {
      treeHost = separator.nextElementSibling;
      if (!treeHost) {
        throw new Error("Expected the file tree resize handle to own a tree host sibling.");
      }
    });

    const resolvedTreeHost = treeHost as HTMLElement | null;
    if (!resolvedTreeHost) {
      throw new Error("Expected the file tree resize handle to own a tree host sibling.");
    }

    expect(resolvedTreeHost.style.width).toBe("280px");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(resolvedTreeHost.style.width).toBe("296px");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(resolvedTreeHost.style.width).toBe("280px");
  });

  test("virtualizes the review file tree with codex-style host attrs", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/storybook/virtualized-tree",
        source: "unstaged",
        patch: buildMultiFilePatch(120, true),
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/storybook/virtualized-tree"
          initialSource="unstaged"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();
    await waitForReviewTree(view.container);
    await waitFor(() => {
      if (!view.container.querySelector('[data-file-tree-virtualized-root="true"]')) {
        throw new Error("Expected the review file tree to render the virtualized shell.");
      }
    });

    const virtualizedRoot = view.container.querySelector('[data-file-tree-virtualized-root="true"]');
    const virtualizedScroll = view.container.querySelector('[data-file-tree-virtualized-scroll="true"]');
    const virtualizedList = view.container.querySelector('[data-file-tree-virtualized-list="true"]');
    if (!virtualizedRoot || !virtualizedScroll || !virtualizedList) {
      throw new Error("Expected the review file tree to render the virtualized shell.");
    }

    const renderedTreeRows = view.container.querySelectorAll('[data-review-tree-item="true"]');
    expect(renderedTreeRows.length < 120).toBeTrue();
  });

  test("collapses and expands folder rows in the review file tree", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const folderRow = await waitForReviewTreePath(view.container, "src");
    fireEvent.click(folderRow);
    await settleAsyncRender();
    const collapsedTreeRows = Array.from(view.container.querySelectorAll('[data-review-tree-item="true"]'));
    expect(collapsedTreeRows.some((node) => node.getAttribute("data-review-tree-path") === "src/example.ts")).toBeFalse();

    fireEvent.click(folderRow);
    await settleAsyncRender();
    const expandedTreeRows = Array.from(view.container.querySelectorAll('[data-review-tree-item="true"]'));
    expect(expandedTreeRows.some((node) => node.getAttribute("data-review-tree-path") === "src/example.ts")).toBeTrue();
  });

  test("tracks folder selection and focus with tree item ids", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const folderRow = await waitForReviewTreePath(view.container, "src");

    fireEvent.click(folderRow);
    await settleAsyncRender();

    expect(folderRow.getAttribute("data-item-selected")).toBe("true");
    expect(folderRow.getAttribute("data-item-focused")).toBe("true");
  });

  test("keeps ancestor folders visible when filtering the review file tree", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/storybook/virtualized-tree",
        source: "unstaged",
        patch: buildMultiFilePatch(24, true),
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/storybook/virtualized-tree"
          initialSource="unstaged"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.input(view.getByPlaceholderText("Filter files…"), {
      target: { value: "file-001.ts" },
    });
    await settleAsyncRender();

    expect(textContent(view.container).includes("domain-01")).toBeTrue();
    expect(textContent(view.container).includes("feature-01")).toBeTrue();
    expect(textContent(view.container).includes("file-001.ts")).toBeTrue();
  });

  test("keeps folder change metadata without rendering modified status markers", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/storybook/status-tree",
        source: "unstaged",
        patch: "diff --git a/src/workbench.tsx b/src/workbench.tsx\nindex 1111111..2222222 100644\n--- a/src/workbench.tsx\n+++ b/src/workbench.tsx\n@@ -1 +1,2 @@\n export const workbench = true;\n+export const status = 'modified';\n",
        files: [buildGitSummary("src/workbench.tsx", "modified")],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/storybook/status-tree"
          initialSource="unstaged"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();

    const folderRow = await waitForReviewTreePath(view.container, "src");
    const fileRow = await waitForReviewTreePath(view.container, "src/workbench.tsx");

    expect(folderRow.getAttribute("data-item-contains-git-change")).toBe("true");
    expect(folderRow.querySelector('[data-item-section="status"]')).toBe(null);
    expect(fileRow.querySelector('[data-item-section="status"]')).toBe(null);
  });

  test("renders A/D markers for added and deleted files", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/storybook/status-tree",
        source: "unstaged",
        patch: [
          "diff --git a/src/added.ts b/src/added.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/src/added.ts",
          "@@ -0,0 +1 @@",
          "+export const added = true;",
          "",
          "diff --git a/src/deleted.ts b/src/deleted.ts",
          "deleted file mode 100644",
          "--- a/src/deleted.ts",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-export const deleted = true;",
          "",
        ].join("\n"),
        files: [
          buildGitSummary("src/added.ts", "added"),
          buildGitSummary("src/deleted.ts", "deleted"),
        ],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/storybook/status-tree"
          initialSource="unstaged"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();
    await waitForReviewTreePath(view.container, "src/added.ts");
    await waitForReviewTreePath(view.container, "src/deleted.ts");

    const addedStatus = view.container.querySelector('[data-item-type="file"][data-review-tree-path="src/added.ts"] [data-item-section="status"]');
    const deletedStatus = view.container.querySelector('[data-item-type="file"][data-review-tree-path="src/deleted.ts"] [data-item-section="status"]');
    if (!addedStatus || !deletedStatus) {
      throw new Error("Expected added and deleted file status slots.");
    }

    expect((addedStatus.textContent ?? "").trim()).toBe("A");
    expect((deletedStatus.textContent ?? "").trim()).toBe("D");
    expect(addedStatus.className.includes("text-token-charts-green")).toBeTrue();
    expect(deletedStatus.className.includes("text-token-charts-red")).toBeTrue();
  });

  test("keeps review search hidden until searchOpenTick opens it", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          searchOpenTick={0}
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    expect(textContent(view.container).includes("Find in review")).toBeFalse();

    view.rerender(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          searchOpenTick={1}
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();
    expect(view.getByPlaceholderText("Find in review").getAttribute("placeholder")).toBe("Find in review");
  });

  test("loads git review snapshots when switching away from last turn", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/codex",
        source: "unstaged",
        patch: "diff --git a/src/git.ts b/src/git.ts\nindex 1111111..2222222 100644\n--- a/src/git.ts\n+++ b/src/git.ts\n@@ -1 +1,2 @@\n export const git = 1;\n+export const diff = true;\n",
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    fireEvent.pointerDown(view.getByRole("button", { name: "Last turn" }), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    const unstagedItem = await waitForMenuItem(view.baseElement as HTMLElement, "Unstaged");
    fireEvent.click(unstagedItem);
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "git:review:snapshot")).toBeTrue();
  });

  test("prefers the explicit project workspace path for git-backed review sources", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown, payload: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      const cwd = typeof payload === "object" && payload !== null && "cwd" in payload
        ? (payload as { cwd: string }).cwd
        : "";
      return {
        cwd,
        source: "unstaged",
        patch: "",
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/storybook/large-diff"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const snapshotCall = invokeCalls.find((call) => call[0] === "git:review:snapshot");
    if (!snapshotCall) {
      throw new Error("Expected git-backed review to request a snapshot.");
    }
    const payload = snapshotCall[1];
    const cwd = typeof payload === "object" && payload !== null && "cwd" in payload
      ? (payload as { cwd: string }).cwd
      : "";
    expect(cwd).toBe("/tmp/storybook/large-diff");
  });

  test("runs file-level git actions from the review row menu", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel === "git:review:snapshot") {
        return {
          cwd: "/tmp/codex",
          source: "unstaged",
          patch: "diff --git a/src/git.ts b/src/git.ts\nindex 1111111..2222222 100644\n--- a/src/git.ts\n+++ b/src/git.ts\n@@ -1 +1,2 @@\n export const git = 1;\n+export const diff = true;\n",
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: "feature",
          defaultBranch: "main",
          errorMessage: null,
        };
      }

      if (channel === "git:apply-patch") {
        return {
          status: "success",
          appliedPaths: ["src/git.ts"],
          skippedPaths: [],
          conflictedPaths: [],
          errorCode: null,
          errorMessage: null,
        };
      }

      return null;
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    fireEvent.pointerDown(view.getByLabelText("Review file actions"), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    const stageItem = await waitForMenuItem(view.baseElement as HTMLElement, "Stage file");
    fireEvent.click(stageItem);
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "git:apply-patch")).toBeTrue();
  });

  test("renders codex-style review option rows with leading icons", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:snapshot") return null;
      return {
        cwd: "/tmp/codex",
        source: "unstaged",
        patch: "diff --git a/src/git.ts b/src/git.ts\nindex 1111111..2222222 100644\n--- a/src/git.ts\n+++ b/src/git.ts\n@@ -1 +1,2 @@\n export const git = 1;\n+export const diff = true;\n",
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
      };
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    fireEvent.pointerDown(view.getByLabelText("Review options"), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    await waitFor(() => {
      const menuItems = Array.from(
        view.baseElement.ownerDocument.querySelectorAll('[role="menuitem"]'),
      );
      const optionItems = menuItems.filter((node) =>
        node.textContent?.includes("Refresh")
        || node.textContent?.includes("Switch to split diff")
        || node.textContent?.includes("Enable word wrap")
        || node.textContent?.includes("Collapse all diffs")
        || node.textContent?.includes("Don't load full files")
        || node.textContent?.includes("Enable rich preview")
        || node.textContent?.includes("Enable word diffs")
        || node.textContent?.includes("Copy git apply command")
      );
      if (optionItems.length !== 8) {
        throw new Error("Expected review option rows to render.");
      }
    });

    const menuItems = Array.from(
      view.baseElement.ownerDocument.querySelectorAll('[role="menuitem"]'),
    );
    const optionItems = menuItems.filter((node) =>
      node.textContent?.includes("Refresh")
      || node.textContent?.includes("Switch to split diff")
      || node.textContent?.includes("Enable word wrap")
      || node.textContent?.includes("Collapse all diffs")
      || node.textContent?.includes("Don't load full files")
      || node.textContent?.includes("Enable rich preview")
      || node.textContent?.includes("Enable word diffs")
      || node.textContent?.includes("Copy git apply command")
    );

    expect(optionItems.length).toBe(8);
    expect(optionItems.some((node) => node.textContent?.includes("Wrap lines"))).toBeFalse();
    expect(optionItems.some((node) => node.textContent?.includes("Unified"))).toBeFalse();

    for (const item of optionItems) {
      if (!item.querySelector("svg")) {
        throw new Error(`Expected review option row "${item.textContent}" to render a leading icon.`);
      }
    }
  });

  test("loads full file contents when full-file mode is enabled", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel === "git:review:snapshot") {
        return {
          cwd: "/tmp/codex",
          source: "unstaged",
          patch: "diff --git a/src/git.ts b/src/git.ts\nindex 1111111..2222222 100644\n--- a/src/git.ts\n+++ b/src/git.ts\n@@ -1 +1,2 @@\n export const git = 1;\n+export const diff = true;\n",
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: "feature",
          defaultBranch: "main",
          errorMessage: null,
        };
      }

      if (channel === "git:review:file-contents") {
        return {
          path: "src/git.ts",
          previousPath: null,
          oldText: "export const git = 1;\n",
          newText: "export const git = 1;\nexport const diff = true;\n",
          oldExists: true,
          newExists: true,
          errorMessage: null,
        };
      }

      return null;
    };

    render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "git:review:file-contents")).toBeTrue();
  });

  test("keeps file filtering separate from review search matching", async () => {
    const { buildReviewSearchMatches, filterReviewFiles, buildReviewVisibleFiles } = await import("@/lib/review-diff-model");

    const files = [
      {
        key: "src/example.ts:0:0",
        displayPath: "src/example.ts",
        previousPath: null,
        patchText: "export const review = true;",
        openPath: null,
        openLine: 1,
        additions: 1,
        deletions: 0,
        fileDiff: {
          name: "src/example.ts",
          prevName: null,
          type: "modify",
          hunks: [],
          additionLines: [],
          deletionLines: [],
        },
      },
    ];

    expect(filterReviewFiles(files as never, "").length).toBe(1);
    expect(buildReviewSearchMatches(files as never, "review", {}).length).toBe(1);
    expect(buildReviewVisibleFiles(files as never, null, false, true, 20).length).toBe(1);
  });

  test("shows the codex large-diff banner in capped mode", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const manyDiffLines = Array.from({ length: 9_100 }, (_, index) => `+line ${index}`).join("\n");
    const conversation = {
      ...buildConversation(),
      turns: [
        {
          ...buildConversation().turns[0]!,
          diff: `diff --git a/src/large.ts b/src/large.ts\nindex 1111111..2222222 100644\n--- a/src/large.ts\n+++ b/src/large.ts\n@@ -0,0 +1,9100 @@\n${manyDiffLines}\n`,
        },
      ],
    } satisfies CodexConversationSnapshot;

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={conversation}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(textContent(view.container).includes("Large diff detected")).toBeTrue();
    expect(textContent(view.container).includes("showing one file at a time")).toBeTrue();
  });

  test("runs hunk-level git actions from the expanded diff row", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel === "git:review:snapshot") {
        return {
          cwd: "/tmp/codex",
          source: "unstaged",
          patch: "diff --git a/src/git.ts b/src/git.ts\nindex 1111111..2222222 100644\n--- a/src/git.ts\n+++ b/src/git.ts\n@@ -1 +1,2 @@\n export const git = 1;\n+export const diff = true;\n",
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: "feature",
          defaultBranch: "main",
          errorMessage: null,
        };
      }

      if (channel === "git:apply-patch") {
        return {
          status: "success",
          appliedPaths: ["src/git.ts"],
          skippedPaths: [],
          conflictedPaths: [],
          errorCode: null,
          errorMessage: null,
        };
      }

      return null;
    };

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    const hunkButton = await waitForButtonText(view.container, "Stage");
    fireEvent.click(hunkButton);
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "git:apply-patch")).toBeTrue();
  });

});
