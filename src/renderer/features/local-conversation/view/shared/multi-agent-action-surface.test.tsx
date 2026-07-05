import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { installElementScrollHeight, installMeasuredResizeObserver } from "../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import type {
  CodexMultiAgentActionName,
  CodexMultiAgentActionStatus,
} from "../../../../../shared/codex-transcript-special-items";
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

function buildActionItem({
  id,
  action,
  status,
  prompt = "Gather the failing tests.",
  receiverThreadId = "thread-agent-1",
}: {
  id: string;
  action: CodexMultiAgentActionName;
  status: CodexMultiAgentActionStatus;
  prompt?: string | null;
  receiverThreadId?: string;
}): CodexConversationItem {
  return buildMultiAgentItem({
    itemId: id,
    entryId: id,
    status,
    rawItem: {
      id,
      tool: action,
      status,
      senderThreadId: "thread-main",
      receiverThreadIds: [receiverThreadId],
      receiverThreads: [
        {
          threadId: receiverThreadId,
          thread: {
            nickname: `@${receiverThreadId.replace(/^thread-agent-/, "agent")}`,
            model: "gpt-5.4-mini",
            agentRole: "worker",
          },
        },
      ],
      prompt,
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      agentsStates: {},
    },
  });
}

describe("MultiAgentActionSurface", () => {
  beforeEach(() => {
    installElementScrollHeight(96);
    installMeasuredResizeObserver({ blockSize: 96, inlineSize: 320 });
  });

  test("renders a dedicated Codex-style grouped surface for settled items", async () => {
    const { getByTestId, container } = render(
      <MultiAgentActionSurface items={[buildMultiAgentItem()]} />,
    );

    const header = getByTestId("multi-agent-action-header");
    expect(textContent(header).includes("Messaged")).toBeTrue();
    expect(textContent(header).includes("an agent")).toBeTrue();

    fireEvent.click(header);
    await settleAsyncRender();

    const rows = getByTestId("multi-agent-action-rows");
    const content = textContent(rows);
    expect(content.includes("Messaged research (worker): Gather the failing tests.")).toBeTrue();
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
    expect(content.includes("Creating")).toBeTrue();
    expect(content.includes("2 agents")).toBeTrue();
    expect(content.includes("Created")).toBeFalse();
    expect(content.includes("Waiting")).toBeFalse();
  });

  test("uses Electron header grammar and count labels", () => {
    const cases: Array<{
      action: CodexMultiAgentActionName;
      status: CodexMultiAgentActionStatus;
      expected: string;
    }> = [
      { action: "spawnAgent", status: "inProgress", expected: "Creating an agent" },
      { action: "spawnAgent", status: "completed", expected: "Created an agent" },
      { action: "spawnAgent", status: "failed", expected: "Failed to create an agent" },
      { action: "sendInput", status: "inProgress", expected: "Messaging an agent" },
      { action: "sendInput", status: "completed", expected: "Messaged an agent" },
      { action: "sendInput", status: "failed", expected: "Failed to message an agent" },
      { action: "resumeAgent", status: "inProgress", expected: "Resuming an agent" },
      { action: "resumeAgent", status: "completed", expected: "Resumed an agent" },
      { action: "resumeAgent", status: "failed", expected: "Failed to resume an agent" },
      { action: "closeAgent", status: "inProgress", expected: "Closing an agent" },
      { action: "closeAgent", status: "completed", expected: "Closed an agent" },
      { action: "closeAgent", status: "failed", expected: "Failed to close an agent" },
    ];

    for (const testCase of cases) {
      const { getByTestId, unmount } = render(
        <MultiAgentActionSurface
          items={[
            buildActionItem({
              id: `${testCase.action}-${testCase.status}`,
              action: testCase.action,
              status: testCase.status,
            }),
          ]}
        />,
      );
      expect(textContent(getByTestId("multi-agent-action-header"))).toBe(testCase.expected);
      unmount();
    }
  });

  test("aggregates grouped header status before choosing the label", () => {
    const { getByTestId: getLiveHeader, unmount: unmountLiveHeader } = render(
      <MultiAgentActionSurface
        items={[
          buildActionItem({
            id: "message-completed",
            action: "sendInput",
            status: "completed",
            receiverThreadId: "thread-agent-1",
          }),
          buildActionItem({
            id: "message-live",
            action: "sendInput",
            status: "inProgress",
            receiverThreadId: "thread-agent-2",
          }),
        ]}
      />,
    );
    expect(textContent(getLiveHeader("multi-agent-action-header"))).toBe("Messaging 2 agents");
    unmountLiveHeader();

    const { getByTestId: getFailedHeader } = render(
      <MultiAgentActionSurface
        items={[
          buildActionItem({
            id: "close-completed",
            action: "closeAgent",
            status: "completed",
            receiverThreadId: "thread-agent-1",
          }),
          buildActionItem({
            id: "close-failed",
            action: "closeAgent",
            status: "failed",
            receiverThreadId: "thread-agent-2",
          }),
        ]}
      />,
    );
    expect(textContent(getFailedHeader("multi-agent-action-header"))).toBe("Failed to close 2 agents");
  });

  test("renders prompt rows with inline truncation nodes and metadata prompt rows", async () => {
    const spawnPrompt = "Audit the renderer rows and keep the prompt visible in the overflow tooltip.";
    const resumePrompt = "First line of resume input\nSecond line of resume input";
    const { getByTestId, container } = render(
      <MultiAgentActionSurface
        items={[
          buildActionItem({
            id: "spawn-with-prompt",
            action: "spawnAgent",
            status: "completed",
            prompt: spawnPrompt,
            receiverThreadId: "thread-agent-1",
          }),
          buildActionItem({
            id: "resume-with-prompt",
            action: "resumeAgent",
            status: "completed",
            prompt: resumePrompt,
            receiverThreadId: "thread-agent-2",
          }),
        ]}
      />,
    );

    fireEvent.click(getByTestId("multi-agent-action-header"));
    await settleAsyncRender();

    const rows = getByTestId("multi-agent-action-rows");
    const content = textContent(rows);
    expect(content.includes(`Created agent1 (worker) with the instructions: ${spawnPrompt}`)).toBeTrue();
    expect(content.includes("Resumed agent2 (worker)")).toBeTrue();
    expect(content.includes(`Input: ${resumePrompt}`)).toBeTrue();
    expect(container.querySelectorAll('[data-testid="multi-agent-action-inline-prompt"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="multi-agent-action-meta-prompt"]').length).toBe(1);
  });

  test("opens the target agent thread from the inline agent button", async () => {
    const openedThreadIds: string[] = [];
    const { getByRole, getByTestId } = render(
      <MultiAgentActionSurface
        items={[buildMultiAgentItem()]}
        onOpenThread={(threadId) => {
          openedThreadIds.push(threadId);
        }}
      />,
    );

    fireEvent.click(getByTestId("multi-agent-action-header"));
    await settleAsyncRender();

    const agentButton = getByRole("button", { name: "research" });
    fireEvent.click(agentButton);

    expect(openedThreadIds.join(",")).toBe("thread-agent-1");
  });

  test("renders generic rows without known target ids", async () => {
    const { getByTestId } = render(
      <MultiAgentActionSurface
        items={[
          buildMultiAgentItem({
            itemId: "generic-row",
            entryId: "generic-row",
            rawItem: {
              id: "generic-row",
              tool: "closeAgent",
              status: "failed",
              senderThreadId: "thread-main",
              receiverThreadIds: ["thread-agent-1"],
              receiverThreads: [],
              prompt: null,
              agentsStates: {},
            },
          }),
        ]}
      />,
    );

    fireEvent.click(getByTestId("multi-agent-action-header"));
    await settleAsyncRender();

    expect(textContent(getByTestId("multi-agent-action-rows"))).toBe("Failed closing");
  });
});
