import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import { installElementScrollHeight, installMeasuredResizeObserver } from "../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import {
  ThreadContextCompactionBlock,
  ThreadExplorationGroupBlock,
  ThreadPlanCardBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
  ThreadTurnDiffBlock,
} from "./local-conversation-block-leaves";

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
          { type: "list_files", command: "fd", path: "src" },
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
