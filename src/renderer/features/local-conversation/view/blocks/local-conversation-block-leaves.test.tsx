import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import { installElementScrollHeight, installMeasuredResizeObserver } from "../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import {
  ThreadContextCompactionBlock,
  ThreadCollapsedToolActivityBlock,
  ThreadExplorationGroupBlock,
  ThreadPlanCardBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
  ThreadTurnDiffBlock,
  UserMessageBubble,
} from "./local-conversation-block-leaves";
import type {
  ThreadCollapsedToolActivitySummaryStats,
  ThreadTranscriptBlockModel,
} from "../../thread-stage-types";

const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const canvasGetContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");

function buildCommandEntry(
  itemId: string,
  actions: unknown[],
  overrides?: Partial<CodexConversationItem>,
): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId,
    entryId: itemId,
    type: "exec",
    kind: "commandExecution",
    status: "completed",
    command: "fd",
    cwd: "/workspace/nodex",
    commandActions: actions as CodexConversationItem["commandActions"],
    aggregatedOutput: "",
    exitCode: 0,
    toolCall: {
      toolName: "exec",
      subtype: "command",
      args: {
        cwd: "/workspace/nodex",
        commandActions: actions,
      },
      result: "",
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildFileChangeEntry(itemId: string): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId,
    entryId: itemId,
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    status: "completed",
    fileChange: {
      label: undefined,
      paths: ["src/edited.ts"],
      changes: [
        {
          path: "src/edited.ts",
          type: "update",
          movePath: null,
          unifiedDiff: [
            "@@ -1,1 +1,1 @@",
            "-old value",
            "+new value",
          ].join("\n"),
        },
      ],
      diffs: [
        [
          "diff --git a/src/edited.ts b/src/edited.ts",
          "--- a/src/edited.ts",
          "+++ b/src/edited.ts",
          "@@ -1,1 +1,1 @@",
          "-old value",
          "+new value",
        ].join("\n"),
      ],
    },
    toolCall: {
      subtype: "fileChange",
      toolName: "file_change",
      args: {},
      result: null,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildCollapsedSummaryStats(
  overrides: Partial<ThreadCollapsedToolActivitySummaryStats> = {},
): ThreadCollapsedToolActivitySummaryStats {
  return {
    createdFileCount: 0,
    runningCreatedFileCount: 0,
    stoppedCreatedFileCount: 0,
    editedFileCount: 0,
    runningEditedFileCount: 0,
    deletedFileCount: 0,
    runningDeletedFileCount: 0,
    exploredFileCount: 0,
    runningExploredFileCount: 0,
    searchCount: 0,
    runningSearchCount: 0,
    listCount: 0,
    runningListCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    approvedRequestCount: 0,
    deniedRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    mcpToolCallCount: 0,
    mcpToolCallSources: [],
    webSearchCount: 0,
    runningWebSearchCount: 0,
    ...overrides,
  };
}

function buildUserMessageBlock(text: string): ThreadTranscriptBlockModel {
  return {
    id: "user-message-1",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: text,
    type: "userMessage",
    entry: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "user-message-1",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: text,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function installTextCollapseMeasurement({
  clientWidth,
  characterWidthPx,
}: {
  clientWidth: number;
  characterWidthPx: number;
}): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return clientWidth;
    },
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      font: "",
      measureText: (value: string) => ({
        width: Array.from(value).length * characterWidthPx,
      }),
    }),
  });
}

function restoreTextCollapseMeasurement(): void {
  if (clientWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype as HTMLElement & { clientWidth?: number }, "clientWidth");
  }

  if (canvasGetContextDescriptor) {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasGetContextDescriptor);
  } else {
    Reflect.deleteProperty(HTMLCanvasElement.prototype as HTMLCanvasElement & { getContext?: unknown }, "getContext");
  }
}

function renderUserMessageBubble(text: string) {
  return render(
    <TooltipProvider>
      <UserMessageBubble
        block={buildUserMessageBlock(text)}
        isLatestTurn={false}
        isStreamingTurn={false}
      />
    </TooltipProvider>,
  );
}

function getUserMarkdownRoot(container: ParentNode): HTMLElement {
  const element = container.querySelector<HTMLElement>(".codex-markdown-user");
  if (!element) throw new Error("Expected user markdown root to render.");
  return element;
}

function getWebkitLineClamp(element: HTMLElement): string | undefined {
  return (element.style as CSSStyleDeclaration & { WebkitLineClamp?: string }).WebkitLineClamp;
}

describe("UserMessageBubble collapse", () => {
  afterEach(() => {
    restoreTextCollapseMeasurement();
  });

  test("does not render a toggle for short user messages", async () => {
    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });

    const { queryByText } = renderUserMessageBubble("Short request");
    await settleAsyncRender();

    expect(queryByText("Show more") === null).toBeTrue();
    expect(queryByText("Show less") === null).toBeTrue();
  });

  test("collapses long measured user messages and toggles expansion", async () => {
    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });
    const longMessage = Array.from({ length: 25 }, (_value, index) => `Line ${index + 1}`).join("\n");

    const { container, getByText } = renderUserMessageBubble(longMessage);
    await settleAsyncRender();

    const collapsedButton = getByText("Show more").closest("button");
    expect(collapsedButton?.getAttribute("aria-expanded")).toBe("false");

    const collapsedStyle = getUserMarkdownRoot(container).getAttribute("style") ?? "";
    expect(collapsedStyle.includes("overflow: hidden")).toBeTrue();
    expect(getWebkitLineClamp(getUserMarkdownRoot(container))).toBe("20");

    fireEvent.click(collapsedButton as HTMLElement);
    await settleAsyncRender();

    const expandedButton = getByText("Show less").closest("button");
    expect(expandedButton?.getAttribute("aria-expanded")).toBe("true");
    expect(getUserMarkdownRoot(container).getAttribute("style") ?? "").toBe("");
    expect(Boolean(expandedButton?.querySelector(".rotate-180"))).toBeTrue();

    fireEvent.click(expandedButton as HTMLElement);
    await settleAsyncRender();

    expect(getByText("Show more").closest("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(getWebkitLineClamp(getUserMarkdownRoot(container))).toBe("20");
  });

  test("does not render a toggle when width or canvas measurement is unavailable", async () => {
    installTextCollapseMeasurement({ clientWidth: 0, characterWidthPx: 7 });
    const longMessage = Array.from({ length: 25 }, (_value, index) => `Line ${index + 1}`).join("\n");
    const zeroWidthView = renderUserMessageBubble(longMessage);
    await settleAsyncRender();

    expect(zeroWidthView.queryByText("Show more") === null).toBeTrue();
    zeroWidthView.unmount();

    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });

    const missingCanvasView = renderUserMessageBubble(longMessage);
    await settleAsyncRender();

    expect(missingCanvasView.queryByText("Show more") === null).toBeTrue();
  });

  test("collapses again when expanded text changes", async () => {
    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });
    const firstMessage = Array.from({ length: 25 }, (_value, index) => `First ${index + 1}`).join("\n");
    const secondMessage = Array.from({ length: 25 }, (_value, index) => `Second ${index + 1}`).join("\n");

    const view = renderUserMessageBubble(firstMessage);
    await settleAsyncRender();

    fireEvent.click(view.getByText("Show more").closest("button") as HTMLElement);
    await settleAsyncRender();
    expect(view.getByText("Show less").closest("button")?.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <TooltipProvider>
        <UserMessageBubble
          block={buildUserMessageBlock(secondMessage)}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(view.getByText("Show more").closest("button")?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ThreadExplorationGroupBlock", () => {
  beforeEach(() => {
    installElementScrollHeight(160);
    installMeasuredResizeObserver({ blockSize: 160, inlineSize: 320 });
  });

  test("renders Codex-style counts and deduplicates read files in the header", async () => {
    const block = {
      id: "exploration-1",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "exploration",
      type: "explorationGroup" as const,
      summary: "Exploration",
      status: "completed" as const,
      entries: [
        buildCommandEntry("item-1", [
          { type: "read", command: "cat a.ts", name: "./src/a.ts", path: "./src/a.ts" },
        ]),
        buildCommandEntry("item-2", [
          { type: "read", command: "cat a.ts", name: "./src/a.ts", path: "./src/a.ts" },
        ]),
        buildCommandEntry("item-3", [
          { type: "search", command: "rg thing", query: "thing", path: "src" },
        ]),
        buildCommandEntry("item-4", [
          { type: "listFiles", command: "fd", path: "src" },
        ]),
      ],
    };

    const { container, getByRole, getByTestId } = render(
      <ThreadExplorationGroupBlock
        block={block}
        isLatestTurn={false}
        isStreamingTurn={false}
      />,
    );

    const summaryText = textContent(getByRole("button"));
    expect(summaryText.includes("Explored")).toBeTrue();
    expect(summaryText.includes("1 file")).toBeTrue();
    expect(summaryText.includes("1 search")).toBeTrue();
    expect(summaryText.includes("1 list")).toBeTrue();

    const body = getByTestId("exploration-accordion-body");
    expect(Boolean(body.getAttribute("style")?.includes("height: 0px"))).toBeTrue();

    fireEvent.click(getByRole("button"));
    await settleAsyncRender();

    const scroller = container.querySelector(".vertical-scroll-fade-mask");
    expect(Boolean(body.getAttribute("style")?.includes("pointer-events: auto"))).toBeTrue();
    expect(Boolean(body.getAttribute("style")?.includes("max-height"))).toBeFalse();
    expect(Boolean(scroller?.getAttribute("style")?.includes("max-height: 320px"))).toBeTrue();
    const content = textContent(container);
    expect(content.includes("Read src/a.ts")).toBeTrue();
    expect(content.includes("Searched for thing in src")).toBeTrue();
    expect(content.includes("Listed files in src")).toBeTrue();
    expect(container.querySelectorAll("[data-tool-activity-icon='code-searching']").length).toBe(1);
    expect(container.querySelectorAll("[data-tool-activity-icon='list-files']").length).toBe(0);
  });

  test("starts in preview mode while exploration is still running", async () => {
    const block = {
      id: "exploration-2",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "exploration",
      type: "explorationGroup" as const,
      summary: "Exploration",
      status: "inProgress" as const,
      entries: [
        buildCommandEntry(
          "item-1",
          [{ type: "read", command: "cat stage.tsx", name: "stage.tsx", path: "stage.tsx" }],
          { status: "inProgress" },
        ),
      ],
    };

    const { container, getByRole, getByTestId } = render(
      <ThreadExplorationGroupBlock
        block={block}
        isLatestTurn={true}
        isStreamingTurn={true}
      />,
    );

    await settleAsyncRender();

    const body = getByTestId("exploration-accordion-body");
    const scroller = container.querySelector(".vertical-scroll-fade-mask");
    expect(Boolean(body.getAttribute("style")?.includes("pointer-events: auto"))).toBeTrue();
    expect(Boolean(body.getAttribute("style")?.includes("max-height"))).toBeFalse();
    expect(Boolean(scroller?.getAttribute("style")?.includes("max-height: 112px"))).toBeTrue();

    const summaryText = textContent(getByRole("button"));
    expect(summaryText.includes("Exploring")).toBeTrue();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeTrue();
  });
});

describe("ThreadCollapsedToolActivityBlock", () => {
  beforeEach(() => {
    installElementScrollHeight(120);
    installMeasuredResizeObserver({ blockSize: 120, inlineSize: 320 });
  });

  test("starts collapsed and expands a Codex-style body with original flat entries", async () => {
    const block = {
      id: "activity-1",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity",
      type: "collapsedToolActivity" as const,
      summary: "Explored 1 file",
      status: "completed" as const,
      entries: [
        {
          id: "exploration-1",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 2,
          searchableText: "exploration",
          type: "explorationGroup" as const,
          summary: "Exploration",
          status: "completed" as const,
          entries: [
            buildCommandEntry("item-1", [
              { type: "read", command: "cat a.ts", name: "./src/a.ts", path: "./src/a.ts" },
            ]),
          ],
        },
      ],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Explored 1 file/i });
    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(container.querySelector("[data-testid='collapsed-tool-activity-body']"))).toBeFalse();

    fireEvent.click(summaryButton);
    await settleAsyncRender();

    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(textContent(container).includes("Read src/a.ts"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Exploration"))).toBeFalse();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
  });

  test("shimmers only the latest streaming active summary", () => {
    const commandEntry = buildCommandEntry("item-command-active", [], {
      status: "inProgress",
      command: "bun test",
      exitCode: undefined,
    });
    const block = {
      id: "activity-active",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity active",
      type: "collapsedToolActivity" as const,
      summary: "Ran 1 command",
      status: "inProgress" as const,
      summaryStats: buildCollapsedSummaryStats({ runningCommandCount: 1 }),
      entries: [
        {
          id: commandEntry.entryId ?? commandEntry.itemId,
          turnId: commandEntry.turnId,
          createdAt: commandEntry.createdAt,
          updatedAt: commandEntry.updatedAt,
          searchableText: "command",
          type: "exec" as const,
          entry: commandEntry,
          status: commandEntry.status,
        },
      ],
    };

    const { getByRole } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Running bun test/i });
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(shimmer?.textContent ?? "").toBe("Running bun test");
    expect(Boolean(textContent(summaryButton).includes("Ran 1 command"))).toBeFalse();
  });

  test("keeps completed collapsed summaries static", () => {
    const block = {
      id: "activity-static",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity static",
      type: "collapsedToolActivity" as const,
      summary: "Explored 1 file, ran 1 command",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ exploredFileCount: 1, commandCount: 1 }),
      entries: [
        {
          id: "exploration-static",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "exploration",
          type: "explorationGroup" as const,
          summary: "Exploration",
          status: "completed" as const,
          entries: [
            buildCommandEntry("item-explore-static", [
              { type: "read", command: "cat src/a.ts", name: "src/a.ts", path: "src/a.ts" },
            ]),
          ],
        },
      ],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    getByRole("button", { name: /Explored 1 file, ran 1 command/i });
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
  });

  test("shimmers running aggregate text without shimmering the writing-lines segment", () => {
    const block = {
      id: "activity-aggregate",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity aggregate",
      type: "collapsedToolActivity" as const,
      summary: "Editing 1 file • writing 3 lines",
      status: "inProgress" as const,
      summaryStats: buildCollapsedSummaryStats({ runningEditedFileCount: 1 }),
      entries: [],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Editing 1 file/i });
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(shimmer?.textContent ?? "").toBe("Editing 1 file");
    expect(Boolean(textContent(summaryButton).includes("• writing 3 lines"))).toBeTrue();
    expect(Boolean(shimmer?.textContent?.includes("writing 3 lines"))).toBeFalse();
    expect(Boolean(container.querySelector("[data-testid='collapsed-tool-activity-body']"))).toBeFalse();
  });

  test("keeps the group header icon but strips default icons from nested rows", async () => {
    const commandEntry = buildCommandEntry("item-command", [], {
      command: "bun test",
      commandActions: [],
    });
    const fileChangeEntry = buildFileChangeEntry("item-file-change");
    const block = {
      id: "activity-icons",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity icons",
      type: "collapsedToolActivity" as const,
      summary: "Edited 1 file, explored 1 search, ran 1 command",
      status: "completed" as const,
      entries: [
        {
          id: "exploration-icons",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "exploration",
          type: "explorationGroup" as const,
          summary: "Exploration",
          status: "completed" as const,
          entries: [
            buildCommandEntry("item-explore", [
              { type: "read", command: "cat src/a.ts", name: "src/a.ts", path: "src/a.ts" },
              { type: "search", command: "rg thing", query: "thing", path: "src" },
              { type: "listFiles", command: "fd", path: "src" },
            ]),
          ],
        },
        {
          id: commandEntry.entryId ?? commandEntry.itemId,
          turnId: commandEntry.turnId,
          createdAt: commandEntry.createdAt,
          updatedAt: commandEntry.updatedAt,
          searchableText: "command",
          type: "exec" as const,
          entry: commandEntry,
          status: commandEntry.status,
        },
        {
          id: fileChangeEntry.entryId ?? fileChangeEntry.itemId,
          turnId: fileChangeEntry.turnId,
          createdAt: fileChangeEntry.createdAt,
          updatedAt: fileChangeEntry.updatedAt,
          searchableText: "file change",
          type: "fileChange" as const,
          entry: fileChangeEntry,
          status: fileChangeEntry.status,
        },
      ],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Edited 1 file/i });
    expect(container.querySelectorAll("[data-tool-activity-icon='edit-files']").length).toBe(1);
    expect(container.querySelectorAll("[data-tool-activity-icon='run-command']").length).toBe(0);

    fireEvent.click(summaryButton);
    await settleAsyncRender();

    const content = textContent(container);
    expect(content.includes("Read src/a.ts")).toBeTrue();
    expect(content.includes("Searched for thing in src")).toBeTrue();
    expect(content.includes("Listed files in src")).toBeTrue();
    expect(content.includes("Ran bun test")).toBeTrue();
    expect(content.includes("Edited")).toBeTrue();
    expect(container.querySelectorAll("[data-tool-activity-icon='edit-files']").length).toBe(1);
    expect(container.querySelectorAll("[data-tool-activity-icon='run-command']").length).toBe(0);
    expect(container.querySelectorAll("[data-tool-activity-icon='code-searching']").length).toBe(0);
    expect(container.querySelectorAll("[data-tool-activity-icon='list-files']").length).toBe(0);
  });
});

describe("ThreadContextCompactionBlock", () => {
  test("renders the completed Codex divider row", () => {
    const { container, getByText } = render(
      <ThreadContextCompactionBlock
        block={{
          id: "compact-1",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "Context automatically compacted",
          type: "contextCompaction",
          status: "completed",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "compact-1",
            type: "context_compaction",
            kind: "systemEvent",
            semanticKind: "contextCompaction",
            status: "completed",
            markdownText: "Context automatically compacted",
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn={false}
        isStreamingTurn={false}
      />,
    );

    getByText("Context automatically compacted");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
    expect(container.querySelectorAll(".border-current\\/20").length).toBe(2);
    expect(Boolean(container.querySelector("svg"))).toBeTrue();
  });

  test("renders the in-progress Codex shimmer row", () => {
    const { container, getByText } = render(
      <ThreadContextCompactionBlock
        block={{
          id: "compact-2",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "Automatically compacting context",
          type: "contextCompaction",
          status: "inProgress",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "compact-2",
            type: "context_compaction",
            kind: "systemEvent",
            semanticKind: "contextCompaction",
            status: "inProgress",
            markdownText: "Automatically compacting context",
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn={true}
        isStreamingTurn={true}
      />,
    );

    getByText("Automatically compacting context");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeTrue();
    expect(Boolean(container.querySelector("svg"))).toBeFalse();
  });
});

describe("ThreadPlanCardBlock", () => {
  test("uses the Codex writing-plan shell without the old proposed-plan eyebrow", () => {
    const { container, getByText } = render(
      <TooltipProvider>
        <ThreadPlanCardBlock
          block={{
            id: "plan-1",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "plan",
            type: "proposedPlan",
            entry: {
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "plan-1",
              type: "proposedPlan",
              kind: "plan",
              semanticKind: "proposedPlan",
              status: "inProgress",
              markdownText: "# Plan\n\n1. Investigate\n2. Implement",
              createdAt: 1,
              updatedAt: 1,
            },
          }}
          isLatestTurn
          isStreamingTurn
        />
      </TooltipProvider>,
    );

    getByText("Writing plan");
    expect(Boolean(textContent(container).includes("Proposed plan"))).toBeFalse();
    expect(Boolean(textContent(container).includes("Expand plan"))).toBeTrue();
  });
});

describe("ThreadStreamErrorBlock", () => {
  beforeEach(() => {
    installElementScrollHeight(96);
    installMeasuredResizeObserver({ blockSize: 96, inlineSize: 320 });
  });

  test("renders a Codex-style reconnect row inside the thread body and expands details on demand", async () => {
    const { container, getByText } = render(
      <ThreadStreamErrorBlock
        block={{
          id: "error:turn-1",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "Reconnecting... 2/5",
          type: "streamError",
          status: "inProgress",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "error:turn-1",
            entryId: "error:turn-1",
            type: "error",
            kind: "systemEvent",
            semanticKind: "streamError",
            status: "inProgress",
            markdownText: "Reconnecting... 2/5",
            additionalDetails: "Network error: connection dropped while streaming.",
            willRetry: true,
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn
        isStreamingTurn
      />,
    );

    getByText("Reconnecting... 2/5");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
    expect(Boolean(container.textContent?.includes("Network error: connection dropped while streaming."))).toBeFalse();

    fireEvent.click(getByText("Reconnecting... 2/5"));
    await settleAsyncRender();

    expect(Boolean(container.textContent?.includes("Network error: connection dropped while streaming."))).toBeTrue();
  });
});

describe("ThreadSystemErrorBlock", () => {
  test("renders the Codex-style terminal system error row without generic banner chrome", () => {
    const { container, getByText } = render(
      <ThreadSystemErrorBlock
        block={{
          id: "error:turn-2",
          turnId: "turn-2",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "Failed to reconnect to the stream.",
          type: "systemError",
          status: "failed",
          entry: {
            threadId: "thread-1",
            turnId: "turn-2",
            itemId: "error:turn-2",
            entryId: "error:turn-2",
            type: "error",
            kind: "systemEvent",
            semanticKind: "systemError",
            status: "failed",
            markdownText: "Failed to reconnect to the stream.",
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn={false}
        isStreamingTurn={false}
      />,
    );

    getByText("Failed to reconnect to the stream.");
    expect(Boolean(container.querySelector(".uppercase"))).toBeFalse();
  });
});

describe("ThreadTurnDiffBlock", () => {
  test("renders the compact Codex above-composer banner while the turn is streaming", () => {
    let selectedTurnId: string | null = null;
    const { container, getByText } = render(
      <ThreadTurnDiffBlock
        block={{
          id: "turn-diff-portal",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "4 files changed",
          type: "turnDiff",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "turn-diff-portal",
            entryId: "turn-diff-portal",
            type: "turn_diff",
            kind: "systemEvent",
            semanticKind: "diff",
            status: "completed",
            rawItem: {
              type: "turn-diff",
              cwd: "/tmp/project",
              unifiedDiff: [
                "--- a/src/one.ts",
                "+++ b/src/one.ts",
                "@@ -1 +1 @@",
                "-old",
                "+new",
                "--- a/src/two.ts",
                "+++ b/src/two.ts",
                "@@ -1 +1 @@",
                "-old2",
                "+new2",
              ].join("\n"),
            },
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn={true}
        isStreamingTurn={true}
        threadCwd="/tmp/project"
        onOpenTurnDiffReview={(target) => {
          selectedTurnId = target.turnId;
        }}
      />,
    );

    getByText("2 files changed");
    expect(Boolean(container.textContent?.includes("Review"))).toBeTrue();
    expect(container.querySelectorAll('[role="button"][aria-expanded="false"]').length).toBe(0);
    fireEvent.click(container.querySelector('button[aria-label="Review changes"]') as HTMLElement);
    expect(selectedTurnId).toBe("turn-1");
  });
});
