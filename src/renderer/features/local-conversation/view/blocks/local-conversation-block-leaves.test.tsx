import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { ThreadContextCompactionBlock, ThreadExplorationGroupBlock } from "./local-conversation-block-leaves";

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
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 160;
      },
    });

    globalThis.ResizeObserver = class ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback([
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [{ blockSize: 160, inlineSize: 320 }],
            contentBoxSize: [{ blockSize: 160, inlineSize: 320 }],
            devicePixelContentBoxSize: [{ blockSize: 160, inlineSize: 320 }],
          } as unknown as ResizeObserverEntry,
        ], this);
      }

      disconnect() {}

      unobserve() {}
    } as typeof ResizeObserver;
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
