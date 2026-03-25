import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { MultiAgentActionSurface } from "./multi-agent-action-surface";

function buildMultiAgentItem(overrides?: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-multi-agent",
    entryId: "item-multi-agent",
    type: "collabAgentToolCall",
    kind: "toolCall",
    semanticKind: "multiAgentAction",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    rawItem: {
      id: "item-multi-agent",
      tool: "sendInput",
      status: "completed",
      senderThreadId: "thread-main",
      receiverThreadIds: ["thread-agent-1"],
      receiverThreads: [
        {
          threadId: "thread-agent-1",
          thread: {
            nickname: "@research",
            model: "gpt-5.4-mini",
            agentRole: "worker",
          },
        },
      ],
      prompt: "Gather the failing tests.",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      agentsStates: {
        "thread-agent-1": {
          status: "running",
          message: "Inspecting the renderer tests",
        },
      },
    },
    ...overrides,
  };
}

describe("MultiAgentActionSurface", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 96;
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
            borderBoxSize: [{ blockSize: 96, inlineSize: 320 }],
            contentBoxSize: [{ blockSize: 96, inlineSize: 320 }],
            devicePixelContentBoxSize: [{ blockSize: 96, inlineSize: 320 }],
          } as unknown as ResizeObserverEntry,
        ], this);
      }

      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
  });

  test("renders a dedicated Codex-style grouped surface for settled items", async () => {
    const { getByTestId, container } = render(
      <MultiAgentActionSurface items={[buildMultiAgentItem()]} />,
    );

    const header = getByTestId("multi-agent-action-header");
    expect(textContent(header).includes("Messaged")).toBeTrue();
    expect(textContent(header).includes("1 agent")).toBeTrue();

    fireEvent.click(header);
    await settleAsyncRender();

    const rows = getByTestId("multi-agent-action-rows");
    const content = textContent(rows);
    expect(content.includes("Messaged research: Gather the failing tests.")).toBeTrue();
    expect(Boolean(container.querySelector('[style*="pointer-events: auto"]'))).toBeTrue();
  });

  test("keeps in-progress actions open without rendering wait-only entries", () => {
    const inProgressItem = buildMultiAgentItem({
      status: "inProgress",
      rawItem: {
        id: "item-multi-agent-live",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1", "thread-agent-2"],
        prompt: "Investigate the regression",
        agentsStates: {
          "thread-agent-1": { status: "pendingInit", message: null },
          "thread-agent-2": { status: "running", message: "Reading the transcript" },
        },
      },
    });
    const waitItem = buildMultiAgentItem({
      itemId: "item-multi-agent-wait",
      entryId: "item-multi-agent-wait",
      rawItem: {
        id: "item-multi-agent-wait",
        tool: "wait",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        agentsStates: {},
      },
    });

    const { container } = render(<MultiAgentActionSurface items={[inProgressItem, waitItem]} />);
    const content = textContent(container);
    expect(content.includes("Spawning")).toBeTrue();
    expect(content.includes("2 agents")).toBeTrue();
    expect(content.includes("Created")).toBeFalse();
    expect(content.includes("Waiting")).toBeFalse();
  });
});
