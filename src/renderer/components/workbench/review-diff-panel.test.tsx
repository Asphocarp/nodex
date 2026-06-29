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
import type { FileDiffMetadata, FileDiffProps } from "@pierre/diffs/react";

const invokeCalls: unknown[][] = [];
const clipboardWrites: string[] = [];
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

function countTestFileDiffLines(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return String(value.length);
  return "";
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
  FileDiff: <LAnnotation,>({ className, fileDiff }: FileDiffProps<LAnnotation>) =>
    createElement("div", {
      className,
      "data-file-diff": fileDiff.name ?? "file",
      "data-file-additions": countTestFileDiffLines((fileDiff as { additionLines?: unknown }).additionLines),
      "data-file-deletions": countTestFileDiffLines((fileDiff as { deletionLines?: unknown }).deletionLines),
    }),
  MultiFileDiff: ({ className }: { className?: string }) =>
    createElement("div", { className, "data-multi-file-diff": "true" }),
};

function buildConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_review",
    projectId: "codex",
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

function buildRepeatedFilePatch(pathName = "src/example.ts"): string {
  return [
    `diff --git a/${pathName} b/${pathName}`,
    "index 1111111..2222222 100644",
    `--- a/${pathName}`,
    `+++ b/${pathName}`,
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const intermediate = 2;",
    "",
    `diff --git a/${pathName} b/${pathName}`,
    "index 2222222..3333333 100644",
    `--- a/${pathName}`,
    `+++ b/${pathName}`,
    "@@ -1 +1,2 @@",
    "-export const intermediate = 2;",
    "+export const finalValue = 3;",
    "+export const secondSectionOnly = true;",
    "",
  ].join("\n");
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
  clipboardWrites.length = 0;
  mockInvokeImpl = null;
  __resetNodexToastStoreForTests();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        clipboardWrites.push(value);
      },
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

  test("folds repeated diff sections for the same path into one review entry", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    const conversation = buildConversation();
    conversation.turns[0]!.diff = buildRepeatedFilePatch();

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={conversation}
          projectWorkspacePath="/tmp/codex"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();
    await waitForReviewTreePath(view.container, "src/example.ts");

    const reviewRows = view.container.querySelectorAll('.codex-review-diff-card[data-review-path="src/example.ts"]');
    const treeRows = view.container.querySelectorAll('[data-item-type="file"][data-review-tree-path="src/example.ts"]');
    const renderedFileDiffs = view.container.querySelectorAll('[data-file-diff="src/example.ts"]');
    const rowStats = reviewRows[0]?.querySelector('span[data-thread-find-skip="true"]');

    expect(reviewRows.length).toBe(1);
    expect(treeRows.length).toBe(1);
    expect(renderedFileDiffs.length).toBe(1);
    expect(renderedFileDiffs[0]?.getAttribute("data-file-additions")).toBe("2");
    expect(rowStats?.textContent?.includes("+3") ?? false).toBeTrue();
    expect(rowStats?.textContent?.includes("-2") ?? false).toBeTrue();
  });

  test("prefers the raw completed turn-diff item over stale last-turn diff text", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    const conversation = buildConversation();
    conversation.turns[0]!.diff = "diff --git a/src/stale.ts b/src/stale.ts\n--- a/src/stale.ts\n+++ b/src/stale.ts\n@@ -1 +1 @@\n-old\n+stale\n";
    conversation.turns[0]!.items = [
      {
        threadId: "thr_review",
        turnId: "turn_1",
        entryId: "turn-diff:turn_1",
        itemId: "turn-diff:turn_1",
        type: "turn_diff",
        kind: "systemEvent",
        semanticKind: "diff",
        status: "completed",
        source: "live",
        sequence: 0,
        rawItem: {
          type: "turn-diff",
          unifiedDiff: "diff --git a/src/raw-canonical.ts b/src/raw-canonical.ts\n--- a/src/raw-canonical.ts\n+++ b/src/raw-canonical.ts\n@@ -1 +1 @@\n-old\n+canonical\n",
        },
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

    expect(view.container.querySelector('[data-file-diff="src/raw-canonical.ts"]')).not.toBeNull();
    expect(view.container.querySelector('[data-file-diff="src/stale.ts"]')).toBe(null);
  });

  test("renders Codex review toolbar and file-row icon chrome", async () => {
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

    const jumpIconPath = view.getByLabelText("Jump to file").querySelector("svg path")?.getAttribute("d") ?? "";
    const commitIconPath = view.getByLabelText("Commit or push").querySelector("svg path")?.getAttribute("d") ?? "";
    const createPrIconPath = view.getByLabelText("Create PR").querySelector("svg path")?.getAttribute("d") ?? "";
    const fileTreeTogglePath = view.getByLabelText("Show files").querySelector("svg path")?.getAttribute("d") ?? "";

    expect(jumpIconPath.startsWith("M13.75 10.76")).toBeTrue();
    expect(commitIconPath.startsWith("M15.0001 14.9967")).toBeTrue();
    expect(createPrIconPath.startsWith("M2.54004 0")).toBeTrue();
    expect(fileTreeTogglePath.includes("15.833-3.333")).toBeTrue();
    expect(textContent(view.getByLabelText("Commit or push")).includes("Commit or push")).toBeTrue();
    expect(textContent(view.getByLabelText("Create PR")).includes("Create PR")).toBeTrue();

    const fileRow = view.container.querySelector('.codex-review-diff-card[data-review-path="src/example.ts"]');
    if (!fileRow) {
      throw new Error("Expected Codex review file diff row.");
    }
    const toggleButton = fileRow.querySelector('button[aria-label="Toggle file diff"][data-app-action-review-file-toggle]');
    const openButton = fileRow.querySelector('button[aria-label="Open in"]');
    if (!toggleButton || !openButton) {
      throw new Error("Expected Codex review row action buttons.");
    }

    expect(toggleButton.getAttribute("data-app-action-review-file-expanded")).toBe("true");
    expect((toggleButton.querySelector("svg path")?.getAttribute("d") ?? "").startsWith("M7.52925 3.7793")).toBeTrue();
    expect((openButton.textContent ?? "").trim()).toBe("");
    expect((openButton.querySelector("svg path")?.getAttribute("d") ?? "").startsWith("M4.30164 12.197")).toBeTrue();

    const rowStats = fileRow.querySelector('span[data-thread-find-skip="true"]');
    if (!isDomElement(rowStats)) {
      throw new Error("Expected Codex review row diff stats.");
    }
    expect(rowStats.className.includes("text-xs")).toBeFalse();
    expect(rowStats.className.includes("tabular-nums")).toBeTrue();
    expect(rowStats.querySelector(".text-token-git-decoration-added-resource-foreground")?.className.includes("items-center") ?? false).toBeTrue();

    const aggregateStats = Array.from(view.container.querySelectorAll('span[data-thread-find-skip="true"]'))
      .filter(isDomElement)
      .find((element) => !element.closest("[data-review-path]"));
    if (!aggregateStats) {
      throw new Error("Expected Codex review aggregate diff stats.");
    }
    expect(aggregateStats.className.includes("text-size-chat")).toBeTrue();
    expect(aggregateStats.className.includes("text-xs")).toBeFalse();
    expect(aggregateStats.className.includes("select-none")).toBeTrue();
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

    expect(getByText("Last turn").textContent).toBe("Last turn");
    expect(textContent(container).includes("selected.ts")).toBeTrue();
    expect(container.querySelector('[data-file-diff="src/selected.ts"]')).not.toBeNull();
  });

  test("uses selected turn diff source and focuses the target path", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    const scrollTargets: string[] = [];
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoViewForTest() {
      const reviewPath = this.getAttribute("data-review-path");
      if (reviewPath) scrollTargets.push(reviewPath);
    };

    try {
      const { container } = render(
        <NodexTooltipProvider>
          <ReviewDiffPanel
            conversation={buildConversation()}
            projectWorkspacePath="/tmp/codex"
            selectedTurnDiff={{
              type: "turnDiff",
              threadId: "thr_review",
              turnId: "turn_1",
              entryId: "turn-diff:turn_1",
              patch: "diff --git a/src/selected.ts b/src/selected.ts\nindex 1111111..2222222 100644\n--- a/src/selected.ts\n+++ b/src/selected.ts\n@@ -1 +1 @@\n-export const selected = false;\n+export const selected = true;\n",
              cwd: "/tmp/codex",
              showRevertButton: true,
              path: "src/selected.ts",
              source: "selected-turn",
            }}
          />
        </NodexTooltipProvider>,
      );

      await waitFor(() => {
        expect(scrollTargets.includes("src/selected.ts")).toBeTrue();
      });
      expect(container.querySelector('[data-review-path="src/selected.ts"]')).not.toBeNull();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("keeps last-turn source while focusing a selected path", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();

    const { container } = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={buildConversation()}
          projectWorkspacePath="/tmp/codex"
          selectedTurnDiff={{
            type: "turnDiff",
            threadId: "thr_review",
            turnId: "turn_1",
            entryId: "turn-diff:turn_1",
            patch: "diff --git a/src/selected.ts b/src/selected.ts\n--- a/src/selected.ts\n+++ b/src/selected.ts\n@@ -1 +1 @@\n-old\n+new\n",
            cwd: "/tmp/codex",
            showRevertButton: true,
            path: "src/example.ts",
            source: "last-turn",
          }}
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(textContent(container).includes("example.ts")).toBeTrue();
    expect(textContent(container).includes("selected.ts")).toBeFalse();
    expect(container.querySelector('[data-review-path="src/example.ts"]')).not.toBeNull();
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

    expect(view.getByPlaceholderText("Filter files…").getAttribute("placeholder")).toBe("Filter files…");
    expect(textContent(view.container).includes("src")).toBeTrue();
    expect(textContent(view.container).includes("example.ts")).toBeTrue();
    expect(view.container.querySelector('[data-item-type="folder"]')).not.toBeNull();
    expect(view.container.querySelector('[data-item-type="file"]')).not.toBeNull();
    const separator = view.container.querySelector('[role="separator"][aria-orientation="vertical"]');
    expect(separator).not.toBeNull();
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

    expect(view.queryByPlaceholderText("Filter files…")).toBe(null);
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
    expect(folderRow.querySelector('[data-item-section="git"]')).toBe(null);
    expect(fileRow.querySelector('[data-item-section="git"]')).toBe(null);
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

    const addedStatus = view.container.querySelector('[data-item-type="file"][data-review-tree-path="src/added.ts"] [data-item-section="git"]');
    const deletedStatus = view.container.querySelector('[data-item-type="file"][data-review-tree-path="src/deleted.ts"] [data-item-section="git"]');
    if (!addedStatus || !deletedStatus) {
      throw new Error("Expected added and deleted file status slots.");
    }

    expect((addedStatus.textContent ?? "").trim()).toBe("A");
    expect((deletedStatus.textContent ?? "").trim()).toBe("D");
  });

  test("does not render the retired review-local search input", async () => {
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
    expect(textContent(view.container).includes("Find in review")).toBeFalse();
  });

  test("switches review source without starting a protocol review", async () => {
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
    const menuText = textContent(view.baseElement);
    expect(menuText.includes("Unstaged")).toBeTrue();
    expect(menuText.includes("Staged")).toBeTrue();
    expect(menuText.includes("Commit")).toBeTrue();
    expect(menuText.includes("Branch")).toBeTrue();
    expect(menuText.includes("Last turn")).toBeTrue();
    expect(menuText.includes("Review uncommitted changes")).toBeFalse();
    const unstagedItem = await waitForMenuItem(view.baseElement as HTMLElement, "Unstaged");
    fireEvent.click(unstagedItem);
    await settleAsyncRender();

    await waitForGitReviewDiffCall();
    expect(invokeCalls.some((call) => call[0] === "git:review:diff")).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "codex:review:start")).toBeFalse();
  });

  test("renders Codex staged empty state and switches to branch diff from its action", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown, input: unknown) => {
      if (channel !== "git:review:diff") return null;
      const source = typeof input === "object" && input !== null && "source" in input
        ? (input as { source?: string }).source
        : "staged";
      return {
        cwd: "/tmp/codex",
        source,
        patch: "",
        files: [],
        isGitRepository: true,
        baseRef: source === "branch" ? "main" : null,
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
          initialSource="staged"
          initialFileTreeOpen
        />
      </NodexTooltipProvider>,
    );

    await waitForGitReviewDiffCall();
    await settleAsyncRender();

    expect(textContent(view.container).includes("No staged changes")).toBeTrue();
    expect(textContent(view.container).includes("Accept edits to stage them")).toBeTrue();
    expect(textContent(view.container).includes("View branch diff")).toBeTrue();
    expect(view.getByPlaceholderText("Filter files…").getAttribute("placeholder")).toBe("Filter files…");
    expect(textContent(view.container).includes("No matching files")).toBeTrue();

    fireEvent.click(view.getByText("View branch diff"));
    await waitFor(() => {
      const hasBranchDiffRequest = invokeCalls.some((call) => {
        if (call[0] !== "git:review:diff") return false;
        const input = call[1];
        return typeof input === "object"
          && input !== null
          && "source" in input
          && (input as { source?: unknown }).source === "branch";
      });
      if (!hasBranchDiffRequest) {
        throw new Error("Expected branch review diff request.");
      }
    });

    expect(invokeCalls.some((call) => call[0] === "codex:review:start")).toBeFalse();
  });

  test("renders Codex unstaged empty state copy", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    mockInvokeImpl = async (channel: unknown, input: unknown) => {
      if (channel !== "git:review:diff") return null;
      const source = typeof input === "object" && input !== null && "source" in input
        ? (input as { source?: string }).source
        : "unstaged";
      return {
        cwd: "/tmp/codex",
        source,
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

    await waitForGitReviewDiffCall();
    await settleAsyncRender();

    expect(textContent(view.container).includes("No unstaged changes")).toBeTrue();
    expect(textContent(view.container).includes("Code changes will appear here")).toBeTrue();
    expect(textContent(view.container).includes("View branch diff")).toBeTrue();
    expect(textContent(view.container).includes("The latest diffs are no longer available.")).toBeFalse();
  });

  test("renders Codex last-turn committed-or-reverted empty state when a stale diff has no files", async () => {
    const conversation = buildConversation();
    conversation.turns[0]!.diff = "diff payload retained but no renderable file entries";

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={conversation}
          projectWorkspacePath="/tmp/codex"
          deps={{
            ...reviewDiffPanelTestDeps,
            parsePatchFiles: () => [],
          }}
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(textContent(view.container).includes("No file changes yet")).toBeTrue();
    expect(textContent(view.container).includes("The last turn was committed or reverted.")).toBeTrue();
    expect(textContent(view.container).includes("The latest diffs are no longer available.")).toBeFalse();
    expect(textContent(view.container).includes("Changes in this project will appear here.")).toBeFalse();
    expect(textContent(view.container).includes("View branch diff")).toBeTrue();
  });

  test("keeps Codex latest-unavailable copy when last-turn has no diff payload", async () => {
    const { ReviewDiffPanel } = await loadReviewDiffPanelModule();
    const conversation = buildConversation();
    conversation.turns[0]!.diff = "";

    const view = render(
      <NodexTooltipProvider>
        <ReviewDiffPanel
          conversation={conversation}
          projectWorkspacePath="/tmp/codex"
        />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    expect(textContent(view.container).includes("No file changes yet")).toBeTrue();
    expect(textContent(view.container).includes("The latest diffs are no longer available.")).toBeTrue();
    expect(textContent(view.container).includes("The last turn was committed or reverted.")).toBeFalse();
    const illustrationPath = view.container.querySelector('svg[viewBox="0 0 66 73"] path')?.getAttribute("d") ?? "";
    expect(illustrationPath.startsWith("M20.4622 0.247806")).toBeTrue();
  });

  test("exposes Codex review options in the parity toolbar", async () => {
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

    expect(Boolean(view.baseElement.textContent?.includes("Review uncommitted changes"))).toBeFalse();
    expect(Boolean(view.baseElement.textContent?.includes("Review against a base branch"))).toBeFalse();
    expect(Boolean(view.baseElement.textContent?.includes("Copy git apply command"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Enable word wrap"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Enable word diffs"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Enable rich preview"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Load full files"))).toBeTrue();
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

  test("renders codex-style review options with icons and diff toggle labels", async () => {
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
      if (menuItems.length !== 8) {
        throw new Error("Expected review option rows to render.");
      }
    });

    const menuItems = Array.from(
      view.baseElement.ownerDocument.querySelectorAll('[role="menuitem"]'),
    ) as HTMLElement[];
    const optionLabels = menuItems.map((node) => (node.textContent ?? "").trim());

    expect(optionLabels.join("|")).toBe("Refresh|Enable word wrap|Collapse all diffs|Load full files|Enable rich preview|Enable word diffs|Hide white space|Copy git apply command");
    expect(menuItems.every((node) => node.querySelector("svg") !== null)).toBeTrue();
    expect(menuItems.some((node) => node.textContent?.includes("Review uncommitted changes"))).toBeFalse();
    expect(menuItems.some((node) => node.textContent?.includes("Review against a base branch"))).toBeFalse();
    expect(menuItems.some((node) => node.textContent?.includes("Wrap lines"))).toBeFalse();
    expect(menuItems.some((node) => node.textContent?.includes("Hide whitespace"))).toBeFalse();
    expect(menuItems.some((node) => node.textContent?.includes("Unified"))).toBeFalse();
    expect(view.getByLabelText("Switch to split diff").tagName).toBe("BUTTON");
  });

  test("copies the git apply command from the review options menu", async () => {
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
    fireEvent.click(await waitForMenuItem(view.baseElement, "Copy git apply command"));
    await settleAsyncRender();

    expect(clipboardWrites.length).toBe(1);
    const copiedCommand = clipboardWrites[0] ?? "";
    expect(copiedCommand.startsWith(" (cd \"$(git rev-parse --show-toplevel)\" && git apply --3way <<'EOF'")).toBeTrue();
    expect(copiedCommand.includes("diff --git a/src/git.ts b/src/git.ts")).toBeTrue();
    expect(copiedCommand.endsWith("EOF\n)")).toBeTrue();
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
    const fileItem = await waitForMenuItem(view.baseElement as HTMLElement, "file-003.ts");
    const fileItemText = textContent(fileItem);
    expect(fileItemText.includes("file-003.ts")).toBeTrue();
    expect(fileItemText.includes("src")).toBeTrue();
    expect(fileItem.querySelector(".text-token-description-foreground")?.textContent).toBe("src");
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
