import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import {
  installElementScrollHeight,
  installMeasuredResizeObserver,
  installWindowApi,
} from "../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { TestQueryProvider } from "../../../../test/query";
import { THREAD_SETTINGS_STORAGE_KEY } from "../../../../lib/codex-thread-settings";
import { CodexThreadSettingsProvider } from "../../../../lib/use-codex-thread-settings";
import { buildCodexFileChangeMap } from "../../../../../shared/codex-file-change";
import {
  ThreadContextCompactionBlock,
  ThreadCollapsedToolActivityBlock,
  ThreadDynamicToolCallGroupBlock,
  ThreadAssistantBodyBlock,
  ThreadExplorationGroupBlock,
  ThreadPendingMcpToolCallsBlock,
  ThreadPlanCardBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
  ThreadTurnDiffBlock,
  UserMessageBubble,
} from "./local-conversation-block-leaves";
import { ThreadBlockRenderer } from "./local-conversation-block-renderer";
import type {
  ThreadBlockModel,
  ThreadCollapsedToolActivitySummaryStats,
  ThreadOpenThreadContext,
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
      changes: buildCodexFileChangeMap([
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
      ]),
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

function buildMultiAgentEntry(itemId: string): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId,
    entryId: itemId,
    type: "collabAgentToolCall",
    kind: "toolCall",
    semanticKind: "multiAgentAction",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    rawItem: {
      id: itemId,
      tool: "spawnAgent",
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
      prompt: "Audit the renderer.",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      agentsStates: {},
    },
  };
}

function buildMultiAgentGroupBlock(): Extract<ThreadBlockModel, { type: "multiAgentGroup" }> {
  const entry = buildMultiAgentEntry("multi-agent-1");
  return {
    id: "multi-agent-group-1",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: "multi agent",
    type: "multiAgentGroup",
    entries: [entry],
    summary: "Multi-agent action",
    status: "completed",
  };
}

function buildSubagentActivityInlineGroupBlock(): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "subagent-activity-1",
    entryId: "subagent-activity-1",
    type: "subAgentActivity",
    kind: "systemEvent",
    semanticKind: "systemEvent",
    status: "completed",
    rawItem: {
      id: "subagent-activity-1",
      type: "subAgentActivity",
      kind: "interacted",
      agentThreadId: "thread-child-1",
      agentPath: "@Scout",
    },
    createdAt: 1,
    updatedAt: 1,
  };

  return {
    id: "subagent-activity-inline-group-1",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: "Scout\nReviewer\nBuilder\nTester\nupdated",
    type: "subagentActivityInlineGroup",
    entry,
    subagentActivityStatusLabel: "updated",
    subagentActivityRows: [
      {
        conversationId: "thread-child-1",
        displayName: "Scout",
        agentRole: null,
        spawnModel: null,
        status: "active",
        activityStatus: "updated",
        statusSummary: "Scout updated",
        diffStats: null,
      },
      {
        conversationId: "thread-child-2",
        displayName: "Reviewer",
        agentRole: null,
        spawnModel: null,
        status: "active",
        activityStatus: "started",
        statusSummary: "Reviewer started working",
        diffStats: null,
      },
      {
        conversationId: "thread-child-3",
        displayName: "Builder",
        agentRole: null,
        spawnModel: null,
        status: "done",
        activityStatus: "done",
        statusSummary: "Builder finished",
        diffStats: null,
      },
      {
        conversationId: "thread-child-4",
        displayName: "Tester",
        agentRole: null,
        spawnModel: null,
        status: "done",
        activityStatus: "interrupted",
        statusSummary: "Tester interrupted",
        diffStats: null,
      },
    ],
  };
}

function buildDynamicToolBlock(
  itemId: string,
  tool: string,
  overrides?: Partial<NonNullable<CodexConversationItem["dynamicToolCall"]>>,
): ThreadTranscriptBlockModel & { type: "dynamicToolCall" } {
  const dynamicToolCall = {
    callId: itemId,
    namespace: "codex_app",
    tool,
    arguments: { threadId: "thread-1" },
    status: "completed" as const,
    contentItems: [{ type: "inputText" as const, text: "{\"ok\":true}" }],
    success: true,
    durationMs: 1,
    completed: true,
    ...overrides,
  };
  return {
    id: itemId,
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: tool,
    type: "dynamicToolCall",
    status: "completed",
    entry: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId,
      entryId: itemId,
      type: "dynamicToolCall",
      kind: "toolCall",
      semanticKind: "dynamicToolCall",
      status: "completed",
      dynamicToolCall,
      createdAt: 1,
      updatedAt: 1,
    },
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
    changedLineCount: 0,
    runningCreatedLineCount: 0,
    exploredFileCount: 0,
    runningExploredFileCount: 0,
    loadedToolCount: 0,
    runningLoadedToolCount: 0,
    searchCount: 0,
    runningSearchCount: 0,
    listCount: 0,
    runningListCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    completedWebSearchCommandCount: 0,
    runningFolderCreationCommandCount: 0,
    runningWebSearchCommandCount: 0,
    deniedRequestCount: 0,
    timedOutRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    mcpToolCallCount: 0,
    runningMcpToolCallCount: 0,
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

function buildAssistantMessageBlock({
  text,
  status,
}: {
  text: string;
  status: CodexConversationItem["status"];
}): ThreadTranscriptBlockModel {
  return {
    id: "assistant-message-1",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: text,
    type: "assistantMessage",
    entry: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-message-1",
      entryId: "assistant-message-1",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      status,
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

describe("ThreadAssistantBodyBlock streaming markdown", () => {
  test("keeps a completed latest assistant item static while the turn is still active", async () => {
    const { container } = render(
      <ThreadAssistantBodyBlock
        block={buildAssistantMessageBlock({
          text: "Completed assistant prose should not reanimate while another turn item is still active.",
          status: "completed",
        })}
        isLatestTurn={true}
        isStreamingTurn={true}
      />,
    );

    await settleAsyncRender();

    expect(container.querySelector("[data-sd-animate]") === null).toBeTrue();
  });

  test("keeps animation enabled for the in-progress assistant item", async () => {
    const { container } = render(
      <ThreadAssistantBodyBlock
        block={buildAssistantMessageBlock({
          text: "Streaming assistant prose should still use Streamdown word fade while the item is in progress.",
          status: "inProgress",
        })}
        isLatestTurn={true}
        isStreamingTurn={true}
      />,
    );

    await settleAsyncRender();

    expect(container.querySelectorAll("[data-sd-animate]").length > 0).toBeTrue();
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

describe("ThreadPendingMcpToolCallsBlock", () => {
  test("keeps the pending MCP bounded body shell while collapsed and renders items on expand", async () => {
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel === "codex:mcp-server-statuses:list") return [];
        return null;
      },
      on: () => () => {},
    });

    const entry: ThreadTranscriptBlockModel & { type: "mcpToolCall" } = {
      id: "mcp-1",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 1,
      searchableText: "browser click",
      type: "mcpToolCall",
      status: "inProgress",
      entry: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "mcp-1",
        entryId: "mcp-1",
        type: "mcpToolCall",
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "inProgress",
        mcpToolCall: {
          callId: "mcp-1",
          functionName: "browser-use__click",
          invocation: { server: "browser-use", tool: "click", arguments: {} },
          result: null,
          durationMs: null,
          completed: false,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    };

    const { container, getAllByRole, getByTestId } = render(
      <TestQueryProvider>
        <TooltipProvider>
          <ThreadPendingMcpToolCallsBlock
            block={{
              id: "pending-mcp",
              turnId: "turn-1",
              createdAt: 1,
              updatedAt: 1,
              searchableText: "Using the browser",
              type: "pendingMcpToolCalls",
              entries: [entry],
              summary: "Using the browser",
              status: "inProgress",
            }}
            isLatestTurn
            isStreamingTurn
          />
        </TooltipProvider>
      </TestQueryProvider>,
    );

    const button = getAllByRole("button", { name: "Click" })[0];
    expect(button.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(getByTestId("pending-mcp-tool-calls-body"))).toBeTrue();
    expect(textContent(getByTestId("pending-mcp-tool-calls-body")).includes("Click")).toBeFalse();
    const collapsedList = container.querySelector(".vertical-scroll-fade-mask");
    expect(Boolean(collapsedList?.getAttribute("style")?.includes("max-height: 0px"))).toBeTrue();

    fireEvent.click(button);
    await settleAsyncRender();

    expect(button.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(getByTestId("pending-mcp-tool-calls-body"))).toBeTrue();
    expect(textContent(getByTestId("pending-mcp-tool-calls-body")).includes("Click")).toBeTrue();
  });

  test("renders completed Node REPL pending groups with command-count wording", () => {
    const entry: ThreadTranscriptBlockModel & { type: "mcpToolCall" } = {
      id: "mcp-1",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 1,
      searchableText: "node repl",
      type: "mcpToolCall",
      status: "completed",
      entry: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "mcp-1",
        entryId: "mcp-1",
        type: "mcpToolCall",
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "completed",
        mcpToolCall: {
          callId: "mcp-1",
          functionName: "node_repl__js",
          invocation: { server: "node_repl", tool: "js", arguments: {} },
          result: { type: "success", content: [], structuredContent: null, raw: { content: [], structuredContent: null } },
          durationMs: 1,
          completed: true,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const secondEntry = {
      ...entry,
      id: "mcp-2",
      entry: {
        ...entry.entry,
        itemId: "mcp-2",
        entryId: "mcp-2",
        mcpToolCall: {
          callId: "mcp-2",
          functionName: "node_repl__js",
          invocation: { server: "node_repl", tool: "js", arguments: {} },
          result: { type: "success", content: [], structuredContent: null, raw: { content: [], structuredContent: null } },
          durationMs: 1,
          completed: true,
        },
      },
    } satisfies ThreadTranscriptBlockModel & { type: "mcpToolCall" };

    const { getByRole } = render(
      <TestQueryProvider>
        <TooltipProvider>
          <ThreadPendingMcpToolCallsBlock
            block={{
              id: "pending-mcp",
              turnId: "turn-1",
              createdAt: 1,
              updatedAt: 1,
              searchableText: "Ran commands",
              type: "pendingMcpToolCalls",
              entries: [entry, secondEntry],
              summary: "Using Node repl",
              status: "completed",
            }}
            isLatestTurn={false}
            isStreamingTurn={false}
          />
        </TooltipProvider>
      </TestQueryProvider>,
    );

    expect(Boolean(getByRole("button", { name: "Ran 2 commands" }))).toBeTrue();
  });
});

describe("ThreadDynamicToolCallGroupBlock", () => {
  test("renders folded dynamic summary parts instead of one total repeat label", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <ThreadDynamicToolCallGroupBlock
          block={{
            id: "dynamic-group",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "dynamic",
            type: "dynamicToolCallGroup",
            entries: [
              buildDynamicToolBlock("read-1", "read_thread"),
              buildDynamicToolBlock("read-2", "read_thread"),
              buildDynamicToolBlock("send-1", "send_message_to_thread"),
            ],
            summary: "Read thread 2 times · Sent message to thread",
            summaryParts: [
              { key: "read", label: "Read thread", count: 2 },
              { key: "send", label: "Sent message to thread", count: 1 },
            ],
            repeatCount: 3,
            status: "completed",
          }}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("button", { name: /Read thread 2 times · Sent message to thread/i }))).toBeTrue();
  });

  test("mounts compact dynamic rows inside the inner grouped body on expand", async () => {
    const { container, getByRole, getByTestId, queryByTestId } = render(
      <TooltipProvider>
        <ThreadDynamicToolCallGroupBlock
          block={{
            id: "dynamic-group",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "dynamic",
            type: "dynamicToolCallGroup",
            entries: [
              buildDynamicToolBlock("read-1", "read_thread"),
              buildDynamicToolBlock("send-1", "send_message_to_thread"),
            ],
            summary: "Read thread · Sent message to thread",
            summaryParts: [
              { key: "read", label: "Read thread", count: 1 },
              { key: "send", label: "Sent message to thread", count: 1 },
            ],
            repeatCount: 2,
            status: "completed",
          }}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    expect(Boolean(queryByTestId("dynamic-tool-call-group-body"))).toBeFalse();

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Read thread · Sent message to thread/i }));
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    const body = getByTestId("dynamic-tool-call-group-body");
    expect(body.parentElement?.getAttribute("data-testid") ?? "").toBe("");
    expect(textContent(body).includes("Read thread")).toBeTrue();
    expect(textContent(body).includes("Sent message to thread")).toBeTrue();
    expect(textContent(container).includes("thread-1")).toBeFalse();
    expect(textContent(container).includes("{\"ok\":true}")).toBeFalse();
  });

  test("renders the latest incomplete dynamic item as the active group header", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <ThreadDynamicToolCallGroupBlock
          block={{
            id: "dynamic-active",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "dynamic",
            type: "dynamicToolCallGroup",
            entries: [
              buildDynamicToolBlock("read-1", "read_thread"),
              buildDynamicToolBlock("send-1", "send_message_to_thread", {
                status: "inProgress",
                contentItems: null,
                success: null,
                durationMs: null,
                completed: false,
              }),
            ],
            summary: "Read thread · Sending message to thread",
            summaryParts: [
              { key: "read", label: "Read thread", count: 1 },
              { key: "send", label: "Sending message to thread", count: 1 },
            ],
            repeatCount: 2,
            status: "inProgress",
          }}
          isLatestTurn
          isStreamingTurn
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("button", { name: /Sending message to thread/i }))).toBeTrue();
  });

  test("defers active dynamic summary changes and immediately shows settled aggregate summaries", async () => {
    const originalDateNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    let now = 0;
    let nextTimerId = 92_000;
    let scheduledTimerId: number | null = null;
    let scheduledDelay = -1;
    let scheduledCallback: (() => void) | null = null;
    let clearCount = 0;
    Date.now = () => now;
    window.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const timerId = nextTimerId++;
      scheduledTimerId = timerId;
      scheduledDelay = delay ?? 0;
      scheduledCallback = typeof callback === "function" ? () => callback() : null;
      return timerId;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((timerId?: number) => {
      if (timerId !== scheduledTimerId) return;
      clearCount += 1;
      scheduledTimerId = null;
      scheduledCallback = null;
    }) as typeof window.clearTimeout;

    const buildBlock = (
      entries: ReturnType<typeof buildDynamicToolBlock>[],
      status: "completed" | "inProgress",
    ) => ({
      id: "dynamic-deferred-summary",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "dynamic",
      type: "dynamicToolCallGroup" as const,
      entries,
      summary: "Dynamic tools",
      summaryParts: [],
      repeatCount: entries.length,
      status,
    });

    try {
      const view = render(
        <TooltipProvider>
          <ThreadDynamicToolCallGroupBlock
            block={buildBlock([
              buildDynamicToolBlock("read-1", "read_thread", {
                status: "inProgress",
                contentItems: null,
                success: null,
                durationMs: null,
                completed: false,
              }),
            ], "inProgress")}
            isLatestTurn
            isStreamingTurn
          />
        </TooltipProvider>,
      );

      const getHeaderText = () => textContent(view.container.querySelector("button[aria-expanded]") ?? view.container);

      expect(Boolean(getHeaderText().includes("Reading thread"))).toBeTrue();

      now = 100;
      await act(async () => {
        view.rerender(
          <TooltipProvider>
            <ThreadDynamicToolCallGroupBlock
              block={buildBlock([
                buildDynamicToolBlock("read-1", "read_thread"),
                buildDynamicToolBlock("send-1", "send_message_to_thread", {
                  status: "inProgress",
                  contentItems: null,
                  success: null,
                  durationMs: null,
                  completed: false,
                }),
              ], "inProgress")}
              isLatestTurn
              isStreamingTurn
            />
          </TooltipProvider>,
        );
        await Promise.resolve();
      });

      expect(Boolean(getHeaderText().includes("Reading thread"))).toBeTrue();
      expect(Boolean(getHeaderText().includes("Sending message to thread"))).toBeFalse();
      expect(scheduledDelay).toBe(900);
      expect(Boolean(scheduledCallback)).toBeTrue();

      now = 150;
      await act(async () => {
        view.rerender(
          <TooltipProvider>
            <ThreadDynamicToolCallGroupBlock
              block={buildBlock([
                buildDynamicToolBlock("read-1", "read_thread"),
                buildDynamicToolBlock("send-1", "send_message_to_thread"),
              ], "completed")}
              isLatestTurn
              isStreamingTurn
            />
          </TooltipProvider>,
        );
        await Promise.resolve();
      });

      const content = getHeaderText();
      expect(Boolean(content.includes("Read thread · Sent message to thread"))).toBeTrue();
      expect(Boolean(content.includes("Reading thread"))).toBeFalse();
      expect(clearCount).toBe(1);
      expect(Boolean(scheduledCallback)).toBeFalse();
    } finally {
      Date.now = originalDateNow;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });

  test("does not mount an expandable body for summary-only dynamic groups", () => {
    const { container, queryByRole } = render(
      <TooltipProvider>
        <ThreadDynamicToolCallGroupBlock
          block={{
            id: "dynamic-summary-only",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "handoff status",
            type: "dynamicToolCallGroup",
            entries: [
              buildDynamicToolBlock("status-1", "get_handoff_status", {
                arguments: { operationId: "operation-1" },
              }),
              buildDynamicToolBlock("status-2", "get_handoff_status", {
                arguments: { operationId: "operation-1" },
              }),
            ],
            summary: "Checked handoff status 2 times",
            summaryParts: [
              { key: "status", label: "Checked handoff status", count: 2 },
            ],
            canExpand: false,
            repeatCount: 2,
            status: "completed",
          }}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    expect(textContent(container).includes("Checked handoff status 2 times")).toBeTrue();
    expect(Boolean(queryByRole("button", { name: /Checked handoff status 2 times/i }))).toBeFalse();
    expect(Boolean(container.querySelector("[data-testid='dynamic-tool-call-group-body']"))).toBeFalse();
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
      summary: "Read a file",
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

    const summaryButton = getByRole("button", { name: /Read a file/i });
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
      runningSummary: {
        kind: "text" as const,
        key: "item-command-active",
        label: "Running bun test",
      },
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

  test("does not shimmer a latest streaming completed fallback summary", () => {
    const webEntry: CodexConversationItem = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "web-completed",
      entryId: "web-completed",
      type: "web_search",
      kind: "toolCall",
      semanticKind: "webSearch",
      status: "completed",
      toolCall: {
        subtype: "webSearch",
        toolName: "web_search",
        args: { query: "completed query" },
        result: { type: "search", query: "completed query" },
      },
      rawItem: { action: { type: "search", query: "completed query" } },
      createdAt: 1,
      updatedAt: 2,
    };
    const webBlock = {
      id: "web-completed",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "completed query",
      type: "webSearch" as const,
      entry: webEntry,
      status: "completed" as const,
    };
    const block = {
      id: "activity-web-completed",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "completed query",
      type: "collapsedToolActivity" as const,
      summary: "Searched the web",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ webSearchCount: 1, runningWebSearchCount: 0 }),
      runningSummary: null,
      continuitySummary: {
        kind: "text" as const,
        key: "web-completed",
        label: "Searching the web for completed query",
      },
      entries: [{
        id: "web-group",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 2,
        searchableText: "completed query",
        type: "webSearchGroup" as const,
        entries: [webBlock],
        status: "completed" as const,
      }],
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

    const summaryButton = getByRole("button", { name: /Searched the web/i });
    expect(Boolean(textContent(summaryButton).includes("Searching the web"))).toBeFalse();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
  });

  test("defers live active summary changes through the shared activity disclosure", async () => {
    const originalDateNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    let now = 0;
    let nextTimerId = 1;
    let scheduledDelay = -1;
    let scheduledCallback: (() => void) | null = null;
    Date.now = () => now;
    window.setTimeout = ((callback: TimerHandler, delay?: number) => {
      scheduledDelay = delay ?? 0;
      scheduledCallback = typeof callback === "function" ? () => callback() : null;
      return nextTimerId++;
    }) as typeof window.setTimeout;
    window.clearTimeout = (() => {
      scheduledCallback = null;
    }) as typeof window.clearTimeout;

    const buildBlock = (key: string, label: string) => ({
      id: "activity-deferred-summary",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: label,
      type: "collapsedToolActivity" as const,
      summary: "Running a command",
      status: "inProgress" as const,
      summaryStats: buildCollapsedSummaryStats({ runningCommandCount: 1 }),
      runningSummary: {
        kind: "text" as const,
        key,
        label,
      },
      entries: [],
    });

    try {
      const view = render(
        <TooltipProvider>
          <ThreadCollapsedToolActivityBlock
            block={buildBlock("first", "Running first command")}
            isLatestTurn={true}
            isStreamingTurn={true}
          />
        </TooltipProvider>,
      );

      expect(Boolean(textContent(view.container).includes("Running first command"))).toBeTrue();

      now = 100;
      await act(async () => {
        view.rerender(
          <TooltipProvider>
            <ThreadCollapsedToolActivityBlock
              block={buildBlock("second", "Running second command")}
              isLatestTurn={true}
              isStreamingTurn={true}
            />
          </TooltipProvider>,
        );
        await Promise.resolve();
      });

      expect(textContent(view.container).includes("Running first command")).toBeTrue();
      expect(textContent(view.container).includes("Running second command")).toBeFalse();
      expect(scheduledDelay).toBe(900);
      expect(Boolean(scheduledCallback)).toBeTrue();

      now = 1000;
      await act(async () => {
        scheduledCallback?.();
        await Promise.resolve();
      });

      expect(textContent(view.container).includes("Running second command")).toBeTrue();
    } finally {
      Date.now = originalDateNow;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });

  test("renders a live file-change active header with animated diff stats", async () => {
    const liveFileChangeEntry = buildFileChangeEntry("item-file-live");
    const content = Array.from({ length: 85 }, (_, index) => `line ${index + 1}`).join("\n");
    liveFileChangeEntry.status = "inProgress";
    liveFileChangeEntry.fileChange = {
      label: undefined,
      changes: buildCodexFileChangeMap([{ type: "add", path: "poem.md", content }]),
    };

    const block = {
      id: "activity-file-live",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity file live",
      type: "collapsedToolActivity" as const,
      summary: "Creating a file",
      status: "inProgress" as const,
      summaryStats: buildCollapsedSummaryStats({
        createdFileCount: 1,
        runningCreatedFileCount: 1,
        changedLineCount: 85,
        runningCreatedLineCount: 85,
      }),
      runningSummary: {
        kind: "fileChange" as const,
        key: "item-file-live",
        label: "Creating",
        displayPath: "poem.md",
        additions: 85,
        deletions: 0,
      },
      entries: [
        {
          id: liveFileChangeEntry.entryId ?? liveFileChangeEntry.itemId,
          turnId: liveFileChangeEntry.turnId,
          createdAt: liveFileChangeEntry.createdAt,
          updatedAt: liveFileChangeEntry.updatedAt,
          searchableText: "file change",
          type: "fileChange" as const,
          entry: liveFileChangeEntry,
          status: liveFileChangeEntry.status,
        },
      ],
    };

    const { container } = render(
      <TooltipProvider>
        <ThreadCollapsedToolActivityBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = container.querySelector<HTMLButtonElement>("button[aria-expanded='false']");
    if (!summaryButton) throw new Error("Expected collapsed activity summary button");
    expect(Boolean(textContent(summaryButton).includes("Creating"))).toBeTrue();
    expect(Boolean(textContent(summaryButton).includes("poem.md"))).toBeTrue();
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(Boolean(shimmer)).toBeTrue();
    expect(shimmer?.textContent ?? "").toBe("Creating");
    expect(Boolean(summaryButton.querySelector(".diff-stat-digit-stack-8"))).toBeTrue();
    expect(Boolean(summaryButton.querySelector(".diff-stat-digit-stack-5"))).toBeTrue();
    expect(Boolean(textContent(summaryButton).includes("Creating a file • writing"))).toBeFalse();

    fireEvent.click(summaryButton);
    await settleAsyncRender();

    expect(Boolean(container.querySelector('[data-testid="collapsed-tool-activity-body"]'))).toBeTrue();
    expect(Boolean(textContent(container).includes("Creating"))).toBeTrue();
    expect(Boolean(textContent(container).includes("poem.md"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Exploration"))).toBeFalse();
  });

  test("keeps completed collapsed summaries static", () => {
    const block = {
      id: "activity-static",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity static",
      type: "collapsedToolActivity" as const,
      summary: "Read a file, ran a command",
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

    getByRole("button", { name: /Read a file, ran a command/i });
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
      summary: "Creating a file • writing 3 lines",
      status: "inProgress" as const,
      summaryStats: buildCollapsedSummaryStats({
        createdFileCount: 1,
        runningCreatedFileCount: 1,
        runningCreatedLineCount: 3,
      }),
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

    const summaryButton = getByRole("button", { name: /Creating a file/i });
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(shimmer?.textContent ?? "").toBe("Creating a file");
    expect(Boolean(textContent(summaryButton).includes("• writing 3 lines"))).toBeTrue();
    expect(Boolean(shimmer?.textContent?.includes("writing 3 lines"))).toBeFalse();
    const initiallyMountedBody = container.querySelector<HTMLElement>("[data-testid='collapsed-tool-activity-body']");
    expect(Boolean(initiallyMountedBody)).toBeTrue();
    expect(initiallyMountedBody?.getAttribute("data-thread-find-skip") ?? "").toBe("true");
  });

  test("renders a completed single-file change as an aggregate activity header before the row", async () => {
    const fileChangeEntry = buildFileChangeEntry("item-file-single");
    const block = {
      id: "activity-single-file",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "single file activity",
      type: "collapsedToolActivity" as const,
      summary: "Edited a file",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ editedFileCount: 1, changedLineCount: 2 }),
      entries: [
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

    const summaryButton = getByRole("button", { name: /Edited a file/i });
    expect(Boolean(textContent(summaryButton).includes("2 lines"))).toBeFalse();
    expect(Boolean(textContent(container).includes("edited.ts"))).toBeFalse();

    fireEvent.click(summaryButton);
    await waitFor(() => {
      if (!textContent(container).includes("edited.ts")) {
        throw new Error("Expected expanded file-change row to render.");
      }
    });

    const content = textContent(container);
    expect(Boolean(content.includes("Edited"))).toBeTrue();
    expect(Boolean(content.includes("edited.ts"))).toBeTrue();
    expect(Boolean(content.includes("+1"))).toBeTrue();
    expect(Boolean(content.includes("-1"))).toBeTrue();
  });

  test("shows aggregate file-change line counts in the prose detail level", () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_PROSE" }));
    try {
      const fileChangeEntry = buildFileChangeEntry("item-file-prose");
      const block = {
        id: "activity-file-prose",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 2,
        searchableText: "prose file activity",
        type: "collapsedToolActivity" as const,
        summary: "Edited a file",
        status: "completed" as const,
        summaryStats: buildCollapsedSummaryStats({ editedFileCount: 1, changedLineCount: 2 }),
        entries: [
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

      const { getByRole } = render(
        <CodexThreadSettingsProvider>
          <TooltipProvider>
            <ThreadCollapsedToolActivityBlock
              block={block}
              isLatestTurn={false}
              isStreamingTurn={false}
            />
          </TooltipProvider>
        </CodexThreadSettingsProvider>,
      );

      getByRole("button", { name: /Edited a file • 2 lines/i });
    } finally {
      localStorage.removeItem(THREAD_SETTINGS_STORAGE_KEY);
    }
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
      summary: "Edited a file, explored 1 search, ran 1 command",
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

    const summaryButton = getByRole("button", { name: /Edited a file/i });
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
    expect(Boolean(textContent(container).includes("Expand plan"))).toBeFalse();
  });

  test("opens the side panel from a completed proposed-plan item", () => {
    let openedKey = "";
    let openedContent = "";
    const { container } = render(
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
              status: "completed",
              markdownText: "# Plan\n\n1. Investigate\n2. Implement",
              createdAt: 1,
              updatedAt: 1,
            },
          }}
          isLatestTurn
          isStreamingTurn={false}
          threadCwd="/tmp/project"
          planSidePanelState={{
            rightPanelEnabled: true,
            activePlanKey: null,
            activeRightPanelTabId: null,
          }}
          onOpenPlanInSidePanel={(input) => {
            openedKey = input.planKey;
            openedContent = input.content;
          }}
        />
      </TooltipProvider>,
    );

    const overlay = container.querySelector("button[aria-hidden='true'][tabindex='-1']");
    expect(Boolean(overlay)).toBeTrue();

    fireEvent.click(overlay as HTMLButtonElement);

    expect(openedKey).toBe("turn-1");
    expect(openedContent).toBe("# Plan\n\n1. Investigate\n2. Implement");
  });

  test("collapses the proposed-plan preview while its side-panel tab is active", () => {
    const { container, getByRole } = render(
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
              status: "completed",
              markdownText: "# Plan\n\n1. Investigate\n2. Implement",
              createdAt: 1,
              updatedAt: 1,
            },
          }}
          isLatestTurn
          isStreamingTurn={false}
          planSidePanelState={{
            rightPanelEnabled: true,
            activePlanKey: "turn-1",
            activeRightPanelTabId: "plan",
          }}
          onClosePlanSidePanel={() => undefined}
        />
      </TooltipProvider>,
    );

    const body = container.querySelector("[data-plan-preview-body='true']");
    expect(Boolean(getByRole("button", { name: "Close plan side panel" }))).toBeTrue();
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(Boolean(body?.hasAttribute("inert"))).toBeTrue();
  });
});

describe("ThreadBlockRenderer proposed-plan block", () => {
  test("forwards side-panel actions into the plan card", () => {
    let openedKey = "";
    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadBlockRenderer
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
              status: "completed",
              markdownText: "# Plan\n\nOpen this in a side panel.",
              createdAt: 1,
              updatedAt: 1,
            },
          }}
          isLatestTurn
          isStreamingTurn={false}
          threadCwd="/tmp/project"
          planSidePanelState={{
            rightPanelEnabled: true,
            activePlanKey: null,
            activeRightPanelTabId: null,
          }}
          onOpenPlanInSidePanel={(input) => {
            openedKey = input.planKey;
          }}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("button", { name: "Open plan in side panel" }))).toBeTrue();

    const overlay = container.querySelector("button[aria-hidden='true'][tabindex='-1']");
    expect(Boolean(overlay)).toBeTrue();

    fireEvent.click(overlay as HTMLButtonElement);

    expect(openedKey).toBe("turn-1");
  });
});

describe("ThreadBlockRenderer multi-agent block", () => {
  beforeEach(() => {
    installElementScrollHeight(96);
    installMeasuredResizeObserver({ blockSize: 96, inlineSize: 320 });
  });

  test("forwards thread navigation actions into agent rows", async () => {
    const openedThreadIds: string[] = [];
    const { getByRole, getByTestId } = render(
      <TooltipProvider>
        <ThreadBlockRenderer
          block={buildMultiAgentGroupBlock()}
          isLatestTurn
          isStreamingTurn={false}
          onOpenThread={(threadId) => {
            openedThreadIds.push(threadId);
          }}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByTestId("multi-agent-action-header"));
    await settleAsyncRender();

    fireEvent.click(getByRole("button", { name: "research" }));

    expect(openedThreadIds.join(",")).toBe("thread-agent-1");
  });
});

describe("ThreadBlockRenderer subagent activity block", () => {
  test("renders capped inline chips and opens subagents with inline activity context", () => {
    const opened: Array<{ threadId: string; context?: ThreadOpenThreadContext }> = [];
    const { container, getByRole, getByTestId, getByText, queryByText } = render(
      <ThreadBlockRenderer
        block={buildSubagentActivityInlineGroupBlock()}
        isLatestTurn
        isStreamingTurn={false}
        onOpenThread={(threadId, context) => {
          opened.push({ threadId, context });
        }}
      />,
    );

    const group = getByTestId("subagent-activity-inline-group");
    const buttons = container.querySelectorAll("button[aria-label$='subagent']");

    expect(Boolean(group)).toBeTrue();
    expect(buttons.length).toBe(3);
    expect(Boolean(getByText("and 1 other subagent updated"))).toBeTrue();
    expect(Boolean(queryByText("Tester"))).toBeFalse();
    expect(Boolean(container.querySelector("[data-animate-entrance]"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Open Scout subagent" }));

    expect(opened.length).toBe(1);
    expect(opened[0]?.threadId).toBe("thread-child-1");
    expect(opened[0]?.context?.subagent?.conversationId).toBe("thread-child-1");
    expect(opened[0]?.context?.subagent?.displayName).toBe("Scout");
    expect(opened[0]?.context?.subagent?.status).toBe("active");
    expect(opened[0]?.context?.subagent?.statusSummary).toBe("Scout updated");
    expect(opened[0]?.context?.subagent?.showInlineActivity ?? false).toBeTrue();
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
        allowInProgressTurnDiff={true}
        threadCwd="/tmp/project"
        onOpenTurnDiffReview={(target) => {
          selectedTurnId = target.turnId;
        }}
      />,
    );

    getByText("2 files changed");
    expect(Boolean(container.querySelector('[codex\\.turn_diff\\.state="in_progress"]'))).toBeTrue();
    expect(container.querySelectorAll('[role="button"][aria-expanded="false"]').length).toBe(0);
    fireEvent.click(container.querySelector("button") as HTMLElement);
    expect(selectedTurnId).toBe("turn-1");
  });

  test("suppresses in-progress turn diffs in the normal thread body", () => {
    const { container } = render(
      <ThreadTurnDiffBlock
        block={{
          id: "turn-diff-body",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 1,
          searchableText: "1 file changed",
          type: "turnDiff",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "turn-diff-body",
            entryId: "turn-diff-body",
            type: "turn_diff",
            kind: "systemEvent",
            semanticKind: "diff",
            status: "inProgress",
            rawItem: {
              type: "turn-diff",
              unifiedDiff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
            },
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn={true}
        isStreamingTurn={true}
      />,
    );

    expect(container.textContent ?? "").toBe("");
  });
});
