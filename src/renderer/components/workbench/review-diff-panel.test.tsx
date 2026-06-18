import { beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { render, settleAsyncRender as settleBaseAsyncRender, textContent } from "../../test/dom";
import {
  __resetNodexToastStoreForTests,
  NodexToastProvider,
} from "../ui/toast";
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
  __resetNodexToastStoreForTests();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => undefined,
    },
  });
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

async function waitForGitReviewDiffCall(): Promise<void> {
  await waitFor(() => {
    if (!invokeCalls.some((call) => call[0] === "git:review:diff")) {
      throw new Error("Expected git review diff call.");
    }
  });
  await settleAsyncRender();
}

async function waitPastGitReviewBatchDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function settleAsyncRender(): Promise<void> {
  await settleBaseAsyncRender();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  await settleBaseAsyncRender();
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
    fireEvent.click(view.getByLabelText("Show files"));

    expect(view.getByPlaceholderText("Filter files...").getAttribute("placeholder")).toBe("Filter files...");
    expect(textContent(view.container).includes("src")).toBeTrue();
    expect(textContent(view.container).includes("example.ts")).toBeTrue();
    expect(view.container.querySelector('[data-item-type="folder"]')).not.toBeNull();
    expect(view.container.querySelector('[data-item-type="file"]')).not.toBeNull();
    expect(view.queryByLabelText("Resize file tree")).toBe(null);
  });

  test("hides the file tree without losing the selected diff", async () => {
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

    fireEvent.click(view.getByLabelText("Hide files"));
    await settleAsyncRender();

    expect(view.queryByPlaceholderText("Filter files...")).toBe(null);
    expect(view.container.querySelector('[data-file-diff="src/example.ts"]')).not.toBeNull();
  });

  test("virtualizes the review file tree with codex-style host attrs", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:diff") return null;
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
      if (channel !== "git:review:diff") return null;
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
    await waitForReviewTree(view.container);

    fireEvent.input(view.getByPlaceholderText("Filter files..."), {
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
      if (channel !== "git:review:diff") return null;
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
      if (channel !== "git:review:diff") return null;
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
      if (channel !== "git:review:diff") return null;
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
    fireEvent.pointerDown(view.getByLabelText("Review source"), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    const unstagedItem = await waitForMenuItem(view.baseElement as HTMLElement, "Review uncommitted changes");
    fireEvent.click(unstagedItem);
    await settleAsyncRender();

    await waitForGitReviewDiffCall();
    expect(invokeCalls.some((call) => call[0] === "git:review:diff")).toBeTrue();
    const reviewStartCall = invokeCalls.find((call) => call[0] === "codex:review:start");
    expect(JSON.stringify(reviewStartCall?.[1])).toBe(JSON.stringify({
      threadId: "thr_review",
      target: { type: "uncommittedChanges" },
      delivery: "inline",
    }));
  });

  test("does not expose Nodex-only review controls in the parity toolbar", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:diff") return null;
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
      <NodexToastProvider>
        <NodexTooltipProvider>
          <ReviewDiffPanel
            conversation={buildConversation()}
            projectWorkspacePath="/tmp/codex"
            initialSource="unstaged"
          />
        </NodexTooltipProvider>
      </NodexToastProvider>,
    );

    await settleAsyncRender();
    fireEvent.pointerDown(view.getByLabelText("Review options"), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();

    expect(Boolean(view.baseElement.textContent?.includes("Review uncommitted changes"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Review against a base branch"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Copy git apply command"))).toBeFalse();
    expect(Boolean(view.baseElement.textContent?.includes("Enable word diffs"))).toBeFalse();
    expect(Boolean(view.baseElement.textContent?.includes("Enable rich preview"))).toBeFalse();
    expect(Boolean(view.baseElement.textContent?.includes("Load full files"))).toBeFalse();
  });

  test("prefers the explicit project workspace path for git-backed review sources", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown, payload: unknown) => {
      if (channel !== "git:review:diff") return null;
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
    await waitForGitReviewDiffCall();

    const snapshotCall = invokeCalls.find((call) => call[0] === "git:review:diff");
    if (!snapshotCall) {
      throw new Error("Expected git-backed review to request a snapshot.");
    }
    const payload = snapshotCall[1];
    const cwd = typeof payload === "object" && payload !== null && "cwd" in payload
      ? (payload as { cwd: string }).cwd
      : "";
    expect(cwd).toBe("/tmp/storybook/large-diff");
  });

  test("cancels delayed git review snapshot loading after unmount", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:diff") return null;
      return {
        cwd: "/tmp/codex",
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

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          initialSource="unstaged"
        />
      </NodexTooltipProvider>,
    );

    view.unmount();
    await waitPastGitReviewBatchDelay();

    expect(invokeCalls.some((call) => call[0] === "git:review:diff")).toBeFalse();
  });

  test("starts commit and pull-request prompts from the parity action buttons", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel === "git:review:diff") {
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
    await waitForGitReviewDiffCall();
    await waitFor(() => {
      if (view.getByLabelText("Commit or push").hasAttribute("disabled")) {
        throw new Error("Expected Commit or push to become enabled.");
      }
      if (view.getByLabelText("Create PR").hasAttribute("disabled")) {
        throw new Error("Expected Create PR to become enabled.");
      }
    });
    fireEvent.click(view.getByLabelText("Commit or push"));
    fireEvent.click(view.getByLabelText("Create PR"));
    await settleAsyncRender();

    const turnStartCalls = invokeCalls.filter((call) => call[0] === "codex:turn:start");
    expect(turnStartCalls.length).toBe(2);
    expect(String(turnStartCalls[0]?.[2]).includes("Commit or push")).toBeTrue();
    expect(String(turnStartCalls[1]?.[2]).includes("pull request")).toBeTrue();
  });

  test("renders codex-style review options and diff toggle labels", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel !== "git:review:diff") return null;
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
        node.textContent?.includes("Review uncommitted changes")
        || node.textContent?.includes("Review against a base branch")
        || node.textContent?.includes("Hide whitespace")
        || node.textContent?.includes("Collapse all diffs")
        || node.textContent?.includes("Refresh")
      );
      if (optionItems.length !== 5) {
        throw new Error("Expected review option rows to render.");
      }
    });

    const menuItems = Array.from(
      view.baseElement.ownerDocument.querySelectorAll('[role="menuitem"]'),
    );
    const optionItems = menuItems.filter((node) =>
      node.textContent?.includes("Review uncommitted changes")
      || node.textContent?.includes("Review against a base branch")
      || node.textContent?.includes("Hide whitespace")
      || node.textContent?.includes("Collapse all diffs")
      || node.textContent?.includes("Refresh")
    );

    expect(optionItems.length).toBe(5);
    expect(optionItems.some((node) => node.textContent?.includes("Wrap lines"))).toBeFalse();
    expect(optionItems.some((node) => node.textContent?.includes("Unified"))).toBeFalse();
    expect(view.getByLabelText("Switch to split diff").tagName).toBe("BUTTON");
  });

  test("jump-to-file filters and selects a diff row", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown) => {
      if (channel === "git:review:diff") {
        return {
          cwd: "/tmp/codex",
          source: "unstaged",
          patch: buildMultiFilePatch(3),
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: "feature",
          defaultBranch: "main",
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
    await settleAsyncRender();

    fireEvent.pointerDown(view.getByLabelText("Jump to file"), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    const jumpInput = view.baseElement.ownerDocument.querySelector('input[aria-label="Jump to file"]');
    if (!isDomElement(jumpInput)) {
      throw new Error("Expected jump-to-file input.");
    }
    fireEvent.input(jumpInput, {
      target: { value: "file-003" },
    });
    const fileItem = await waitForMenuItem(view.baseElement as HTMLElement, "src/file-003.ts");
    fireEvent.click(fileItem);
    await settleAsyncRender();

    expect(view.container.querySelector('[data-review-path="src/file-003.ts"]')).not.toBeNull();
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

  test("renders code-comment directives as anchored review annotations", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    const conversation = buildConversation();
    conversation.turns[0]!.items = [
      {
        threadId: "thr_review",
        turnId: "turn_1",
        itemId: "item_comment",
        type: "message",
        kind: "assistantMessage",
        role: "assistant",
        markdownText: '::code-comment{title="Check value" body="This line needs a stronger invariant." file="src/example.ts" start=2 end=2 priority=1}',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={conversation}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(textContent(view.container).includes("Check value")).toBeTrue();
    expect(textContent(view.container).includes("L2")).toBeTrue();
    expect(view.container.querySelector('[data-review-code-comments="true"]')).not.toBeNull();
  });

});
