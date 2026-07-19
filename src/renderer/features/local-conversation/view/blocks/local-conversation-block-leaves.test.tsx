import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import {
  installElementScrollHeight,
  installMeasuredResizeObserver,
  installWindowApi,
} from "../../../../test/browser-globals";
import {
  renderWithMaitai as render,
  settleAsyncRender,
  textContent,
} from "../../../../test/dom";
import { TestQueryProvider } from "../../../../test/query";
import { THREAD_SETTINGS_STORAGE_KEY } from "../../../../lib/codex-thread-settings";
import { CodexThreadSettingsProvider } from "../../../../lib/use-codex-thread-settings";
import { buildCodexFileChangeMap } from "../../../../../shared/codex-file-change";
import { applyContentSearchDomMarks } from "../../../content-search/content-search-dom";
import {
  ThreadContextCompactionBlock,
  ThreadAgentActivityGroupBlock,
  ThreadAssistantBodyBlock,
  ThreadGeneratedImageGalleryBlock,
  ThreadImageViewBlock,
  ThreadMcpServerElicitationBlock,
  ThreadPlanCardBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
  ThreadTurnDiffBlock,
  ThreadWorktreeInitBlock,
  UserMessageBubble,
  buildThreadWorktreeInitActivities,
} from "./local-conversation-block-leaves";
import { ThreadBlockRenderer } from "./local-conversation-block-renderer";
import { HookFeedbackSettingsNavigationProvider } from "../hook-feedback-settings-navigation";
import type {
  ThreadAgentActivityGroupSummaryStats,
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

function buildCommandBlock(
  itemId: string,
  actions: unknown[],
  overrides?: Partial<CodexConversationItem>,
): ThreadTranscriptBlockModel & { type: "exec" } {
  const entry = buildCommandEntry(itemId, actions, overrides);
  return {
    id: entry.entryId ?? entry.itemId,
    turnId: entry.turnId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    searchableText: entry.markdownText ?? entry.command ?? "",
    type: "exec",
    entry,
    status: entry.status,
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

function buildCollapsedSummaryStats(
  overrides: Partial<ThreadAgentActivityGroupSummaryStats> = {},
): ThreadAgentActivityGroupSummaryStats {
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

    expect(queryByText("Show more") === null).toBe(true);
    expect(queryByText("Show less") === null).toBe(true);
  });

  test("labels hook feedback without exposing ordinary edit controls", () => {
    const block = buildUserMessageBlock("Please address the failed check.");
    block.entry.hookFeedback = true;
    block.userMessageActions = { canEdit: false, sentAtMs: null };
    const { getByText, queryByLabelText } = render(
      <TooltipProvider>
        <UserMessageBubble block={block} isLatestTurn isStreamingTurn={false} />
      </TooltipProvider>,
    );

    const status = getByText("Hook feedback");
    expect(status.closest("a")?.getAttribute("href")).toBe("/settings/hooks-settings?hostId=default");
    expect(queryByLabelText("Edit message")).toBe(null);
  });

  test("links matching project hook feedback to its filtered settings source", () => {
    const block = buildUserMessageBlock("Please address the failed check.");
    block.entry.hookFeedback = true;
    block.hookFeedbackSources = ["project"];
    block.userMessageActions = { canEdit: false, sentAtMs: null };
    const onOpenHooksSettings = vi.fn();
    const { getByText } = render(
      <TooltipProvider>
        <HookFeedbackSettingsNavigationProvider
          hostId="remote-1"
          onOpenHooksSettings={onOpenHooksSettings}
        >
          <UserMessageBubble
            block={block}
            isLatestTurn
            isStreamingTurn={false}
            threadCwd="/workspace/nodex"
          />
        </HookFeedbackSettingsNavigationProvider>
      </TooltipProvider>,
    );

    const link = getByText("Hook feedback").closest("a");
    expect(link?.getAttribute("href"))
      .toBe("/settings/hooks-settings?hostId=remote-1&source=project&projectRoot=%2Fworkspace%2Fnodex");
    fireEvent.click(link as HTMLElement);
    expect(onOpenHooksSettings).toHaveBeenCalledWith({
      hostId: "remote-1",
      selection: { source: "project", projectRoot: "/workspace/nodex" },
    });
  });

  test("collapses long measured user messages and toggles expansion", async () => {
    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });
    const longMessage = Array.from({ length: 25 }, (_value, index) => `Line ${index + 1}`).join("\n");

    const { container, getByText } = renderUserMessageBubble(longMessage);
    await settleAsyncRender();

    const collapsedButton = getByText("Show more").closest("button");
    expect(collapsedButton?.getAttribute("aria-expanded")).toBe("false");

    const collapsedStyle = getUserMarkdownRoot(container).getAttribute("style") ?? "";
    expect(collapsedStyle.includes("overflow: hidden")).toBe(true);
    expect(getWebkitLineClamp(getUserMarkdownRoot(container))).toBe("20");

    fireEvent.click(collapsedButton as HTMLElement);
    await settleAsyncRender();

    const expandedButton = getByText("Show less").closest("button");
    expect(expandedButton?.getAttribute("aria-expanded")).toBe("true");
    expect(getUserMarkdownRoot(container).getAttribute("style") ?? "").toBe("");
    expect(Boolean(expandedButton?.querySelector(".rotate-180"))).toBe(true);

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

    expect(zeroWidthView.queryByText("Show more") === null).toBe(true);
    zeroWidthView.unmount();

    installTextCollapseMeasurement({ clientWidth: 320, characterWidthPx: 7 });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });

    const missingCanvasView = renderUserMessageBubble(longMessage);
    await settleAsyncRender();

    expect(missingCanvasView.queryByText("Show more") === null).toBe(true);
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

    expect(container.querySelector("[data-sd-animate]") === null).toBe(true);
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

    expect(container.querySelectorAll("[data-sd-animate]").length > 0).toBe(true);
  });
});

describe("ThreadAgentActivityGroupBlock", () => {
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
      type: "agentActivityGroup" as const,
      summary: "Read a file",
      status: "completed" as const,
      entries: [
        buildCommandBlock("item-1", [
          { type: "read", command: "cat a.ts", name: "./src/a.ts", path: "./src/a.ts" },
        ]),
      ],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Read a file/i });
    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(container.querySelector("[data-testid='agent-activity-group-body']"))).toBe(false);
    expect(applyContentSearchDomMarks({
      root: container,
      query: "src/a.ts",
      idPrefix: "collapsed-activity",
    }).totalMatches).toBe(0);

    await act(async () => {
      fireEvent.click(summaryButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(container.querySelector("[data-testid='agent-activity-group-body']"))).toBe(true);
    expect(Boolean(textContent(container).includes("Read src/a.ts"))).toBe(true);
    expect(applyContentSearchDomMarks({
      root: container,
      query: "src/a.ts",
      idPrefix: "expanded-activity",
    }).totalMatches > 0).toBe(true);
    expect(Boolean(textContent(container).includes("Exploration"))).toBe(false);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
    const scroller = [...container.querySelectorAll<HTMLElement>(".vertical-scroll-fade-mask")]
      .find((element) => element.style.getPropertyValue("--conversation-patch-file-gap") !== "");
    const groupedSpacer = scroller?.firstElementChild?.firstElementChild as HTMLElement | null;
    expect(scroller?.style.getPropertyValue("--conversation-patch-file-gap") ?? "")
      .toBe("var(--conversation-grouped-item-gap, 4px)");
    expect(groupedSpacer?.getAttribute("aria-hidden") ?? "").toBe("true");
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
      type: "agentActivityGroup" as const,
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
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Running bun test/i });
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(shimmer?.firstChild?.textContent ?? "").toBe("Running bun test");
    expect(Boolean(textContent(summaryButton).includes("Ran 1 command"))).toBe(false);
  });

  test("renders the latest open group's Thinking fallback as its only live header", () => {
    const commandEntry = buildCommandEntry("item-command-completed", [], {
      status: "completed",
      command: "pnpm test",
      exitCode: 0,
    });
    const block = {
      id: "activity-thinking-owner",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "completed command",
      type: "agentActivityGroup" as const,
      liveHeaderKind: "thinking" as const,
      summary: "Ran a command",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ commandCount: 1 }),
      runningSummary: {
        kind: "text" as const,
        key: "agent-activity-group:item-command-completed:thinking",
        label: "Thinking",
      },
      entries: [{
        id: commandEntry.entryId ?? commandEntry.itemId,
        turnId: commandEntry.turnId,
        createdAt: commandEntry.createdAt,
        updatedAt: commandEntry.updatedAt,
        searchableText: "pnpm test",
        type: "exec" as const,
        entry: commandEntry,
        status: commandEntry.status,
      }],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Thinking/i });
    expect(Boolean(textContent(summaryButton).includes("Ran a command"))).toBe(false);
    expect(summaryButton.querySelectorAll(".loading-shimmer-pure-text").length).toBe(1);
    expect(container.querySelectorAll("[data-tool-activity-icon]").length).toBe(0);
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
      type: "agentActivityGroup" as const,
      summary: "Searched the web",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ webSearchCount: 1, runningWebSearchCount: 0 }),
      runningSummary: null,
      continuitySummary: {
        kind: "text" as const,
        key: "web-completed",
        label: "Searching the web for completed query",
      },
      entries: [webBlock],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Searched the web/i });
    expect(Boolean(textContent(summaryButton).includes("Searching the web"))).toBe(false);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
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
      type: "agentActivityGroup" as const,
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
          <ThreadAgentActivityGroupBlock
            block={buildBlock("first", "Running first command")}
            isLatestTurn={true}
            isStreamingTurn={true}
          />
        </TooltipProvider>,
      );

      expect(Boolean(textContent(view.container).includes("Running first command"))).toBe(true);

      now = 100;
      await act(async () => {
        view.rerender(
          <TooltipProvider>
            <ThreadAgentActivityGroupBlock
              block={buildBlock("second", "Running second command")}
              isLatestTurn={true}
              isStreamingTurn={true}
            />
          </TooltipProvider>,
        );
        await Promise.resolve();
      });

      expect(textContent(view.container).includes("Running first command")).toBe(true);
      expect(textContent(view.container).includes("Running second command")).toBe(false);
      expect(scheduledDelay).toBe(900);
      expect(Boolean(scheduledCallback)).toBe(true);

      now = 1000;
      await act(async () => {
        scheduledCallback?.();
        await Promise.resolve();
      });

      expect(textContent(view.container).includes("Running second command")).toBe(true);
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
      type: "agentActivityGroup" as const,
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
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = container.querySelector<HTMLButtonElement>("button[aria-expanded='false']");
    if (!summaryButton) throw new Error("Expected collapsed activity summary button");
    expect(Boolean(textContent(summaryButton).includes("Creating"))).toBe(true);
    expect(Boolean(textContent(summaryButton).includes("poem.md"))).toBe(true);
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(Boolean(shimmer)).toBe(true);
    expect(shimmer?.firstChild?.textContent ?? "").toBe("Creating");
    expect(Boolean(summaryButton.querySelector(".diff-stat-digit-stack-8"))).toBe(true);
    expect(Boolean(summaryButton.querySelector(".diff-stat-digit-stack-5"))).toBe(true);
    expect(Boolean(textContent(summaryButton).includes("Creating a file • writing"))).toBe(false);

    fireEvent.click(summaryButton);
    await settleAsyncRender();

    expect(Boolean(container.querySelector('[data-testid="agent-activity-group-body"]'))).toBe(true);
    expect(Boolean(textContent(container).includes("Creating"))).toBe(true);
    expect(Boolean(textContent(container).includes("poem.md"))).toBe(true);
    expect(Boolean(textContent(container).includes("Exploration"))).toBe(false);
  });

  test("keeps completed collapsed summaries static", () => {
    const block = {
      id: "activity-static",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity static",
      type: "agentActivityGroup" as const,
      summary: "Read a file, ran a command",
      status: "completed" as const,
      summaryStats: buildCollapsedSummaryStats({ exploredFileCount: 1, commandCount: 1 }),
      entries: [
        buildCommandBlock("item-explore-static", [
          { type: "read", command: "cat src/a.ts", name: "src/a.ts", path: "src/a.ts" },
        ]),
      ],
    };

    const { container, getByRole } = render(
      <TooltipProvider>
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    getByRole("button", { name: /Read a file, ran a command/i });
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
  });

  test("shimmers running aggregate text without shimmering the writing-lines segment", () => {
    const block = {
      id: "activity-aggregate",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "activity aggregate",
      type: "agentActivityGroup" as const,
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
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Creating a file/i });
    const shimmer = summaryButton.querySelector<HTMLElement>(".loading-shimmer-pure-text");
    expect(shimmer?.firstChild?.textContent ?? "").toBe("Creating a file");
    expect(Boolean(textContent(summaryButton).includes("• writing 3 lines"))).toBe(true);
    expect(Boolean(shimmer?.firstChild?.textContent?.includes("writing 3 lines"))).toBe(false);
    const initiallyMountedBody = container.querySelector<HTMLElement>("[data-testid='agent-activity-group-body']");
    expect(Boolean(initiallyMountedBody)).toBe(false);
  });

  test("renders a completed single-file change as an aggregate activity header before the row", async () => {
    const fileChangeEntry = buildFileChangeEntry("item-file-single");
    const block = {
      id: "activity-single-file",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "single file activity",
      type: "agentActivityGroup" as const,
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
        <ThreadAgentActivityGroupBlock
          block={block}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Edited a file/i });
    expect(Boolean(textContent(summaryButton).includes("2 lines"))).toBe(false);
    expect(Boolean(container.querySelector("[data-testid='agent-activity-group-body']"))).toBe(false);

    fireEvent.click(summaryButton);
    await waitFor(() => {
      if (!textContent(container).includes("edited.ts")) {
        throw new Error("Expected expanded file-change row to render.");
      }
    });

    const content = textContent(container);
    expect(Boolean(container.querySelector("[data-testid='agent-activity-group-body']"))).toBe(true);
    expect(Boolean(content.includes("Edited"))).toBe(true);
    expect(Boolean(content.includes("edited.ts"))).toBe(true);
    expect(Boolean(content.includes("+1"))).toBe(true);
    expect(Boolean(content.includes("-1"))).toBe(true);
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
      type: "agentActivityGroup" as const,
      summary: "Edited a file, explored 1 search, ran 1 command",
      status: "completed" as const,
      entries: [
        buildCommandBlock("item-read", [
          { type: "read", command: "cat src/a.ts", name: "src/a.ts", path: "src/a.ts" },
        ]),
        buildCommandBlock("item-search", [
          { type: "search", command: "rg thing", query: "thing", path: "src" },
        ]),
        buildCommandBlock("item-list", [
          { type: "listFiles", command: "fd", path: "src" },
        ]),
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
        <ThreadAgentActivityGroupBlock
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
    expect(content.includes("Read src/a.ts")).toBe(true);
    expect(content.includes("Searched for thing in src")).toBe(true);
    expect(content.includes("Listed files in src")).toBe(true);
    expect(content.includes("Ran bun test")).toBe(true);
    expect(content.includes("Edited")).toBe(true);
    expect(container.querySelectorAll("[data-tool-activity-icon='edit-files']").length).toBe(1);
    expect(container.querySelectorAll("[data-tool-activity-icon='run-command']").length).toBe(0);
    expect(container.querySelectorAll("[data-tool-activity-icon='code-searching']").length).toBe(0);
    expect(container.querySelectorAll("[data-tool-activity-icon='list-files']").length).toBe(0);
  });
});

describe("ThreadWorktreeInitBlock", () => {
  const entry: CodexConversationItem = {
    threadId: "thread-1",
    turnId: "turn-worktree-init",
    itemId: "pending-worktree:4",
    entryId: "pending-worktree:4",
    type: "worktreeInit",
    kind: "systemEvent",
    semanticKind: "worktreeInit",
    status: "completed",
    rawItem: {
      id: "pending-worktree:4",
      type: "worktreeInit",
      worktreeOutputText: "[info] Starting worktree creation\n[info] Worktree created\n",
      setup: {
        outcome: "skipped",
        outputText: "[info] Continuing without local environment setup\n",
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };

  test("projects the exact completed worktree and optional setup activities", () => {
    const activities = buildThreadWorktreeInitActivities(entry);

    expect(activities.length).toBe(2);
    expect(activities[0]?.id).toBe("pending-worktree:4:worktree");
    expect(activities[0]?.status).toBe("completed");
    expect(activities[1]?.id).toBe("pending-worktree:4:setup");
    expect(activities[1]?.status).toBe("skipped");
  });

  test("renders completed activities collapsed with shared plain shell output", async () => {
    const { getByRole, getByText } = render(
      <TooltipProvider>
        <ThreadWorktreeInitBlock
          block={{
            id: "pending-worktree:4",
            turnId: "turn-worktree-init",
            createdAt: 1,
            updatedAt: 1,
            searchableText: "Worktree initialization",
            type: "worktreeInit",
            status: "completed",
            entry,
          }}
          isLatestTurn
          isStreamingTurn={false}
        />
      </TooltipProvider>,
    );

    getByText("Worktree created");
    getByText("Environment setup skipped");
    expect(getByRole("button", { name: "Worktree created" }).getAttribute("aria-expanded"))
      .toBe("false");
    expect(
      getByRole("button", { name: "Environment setup skipped" }).getAttribute("aria-expanded"),
    ).toBe("false");

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Environment setup skipped" }));
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    getByText("[info] Continuing without local environment setup");
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
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
    expect(container.querySelectorAll(".border-current\\/20").length).toBe(2);
    expect(Boolean(container.querySelector("svg"))).toBe(true);
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

    getByText("Automatically compacting context", { selector: ".loading-shimmer-pure-text" });
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(true);
    expect(Boolean(container.querySelector("svg"))).toBe(false);
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
    expect(Boolean(textContent(container).includes("Proposed plan"))).toBe(false);
    expect(Boolean(textContent(container).includes("Expand plan"))).toBe(false);
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
    expect(Boolean(overlay)).toBe(true);

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
    expect(Boolean(getByRole("button", { name: "Close plan side panel" }))).toBe(true);
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(Boolean(body?.hasAttribute("inert"))).toBe(true);
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

    expect(Boolean(getByRole("button", { name: "Open plan in side panel" }))).toBe(true);

    const overlay = container.querySelector("button[aria-hidden='true'][tabindex='-1']");
    expect(Boolean(overlay)).toBe(true);

    fireEvent.click(overlay as HTMLButtonElement);

    expect(openedKey).toBe("turn-1");
  });
});

describe("ThreadBlockRenderer subagent activity block", () => {
  test("renders capped inline chips and opens subagents with inline activity context", () => {
    const opened: Array<{ threadId: string; context?: ThreadOpenThreadContext }> = [];
    const completeBlock = buildSubagentActivityInlineGroupBlock();
    const initialBlock = {
      ...completeBlock,
      subagentActivityRows: completeBlock.subagentActivityRows?.slice(0, 2),
    };
    const view = render(
      <ThreadBlockRenderer
        block={initialBlock}
        isLatestTurn
        isStreamingTurn={false}
        onOpenThread={(threadId, context) => {
          opened.push({ threadId, context });
        }}
      />,
    );
    expect(Boolean(view.container.querySelector("[data-animate-entrance]"))).toBe(false);

    view.rerender(
      <ThreadBlockRenderer
        block={completeBlock}
        isLatestTurn
        isStreamingTurn={false}
        onOpenThread={(threadId, context) => {
          opened.push({ threadId, context });
        }}
      />,
    );

    const group = view.getByTestId("subagent-activity-inline-group");
    const buttons = group.querySelectorAll("button");

    expect(Boolean(group)).toBe(true);
    expect(buttons.length).toBe(3);
    expect(Boolean(view.getByText("and 1 other subagent updated"))).toBe(true);
    expect(Boolean(view.queryByText("Tester"))).toBe(false);
    expect(view.container.querySelectorAll("[data-animate-entrance]").length).toBe(1);
    expect(Boolean(view.container.querySelector('[data-subagent-avatar-seed="thread-child-1"]'))).toBe(true);

    fireEvent.click(view.getByRole("button", { name: "Scout" }));

    expect(opened.length).toBe(1);
    expect(opened[0]?.threadId).toBe("thread-child-1");
    expect(opened[0]?.context?.subagent?.conversationId).toBe("thread-child-1");
    expect(opened[0]?.context?.subagent?.displayName).toBe("Scout");
    expect(opened[0]?.context?.subagent?.status).toBe("active");
    expect(opened[0]?.context?.subagent?.statusSummary).toBe("Scout updated");
    expect(opened[0]?.context?.subagent?.showInlineActivity ?? false).toBe(true);
    expect(opened[0]?.context?.subagent?.agentRole).toBe(null);
    expect(opened[0]?.context?.subagent?.spawnModel).toBe(null);
    expect(opened[0]?.context?.subagent?.diffStats).toBe(null);
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
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
    expect(Boolean(container.textContent?.includes("Network error: connection dropped while streaming."))).toBe(false);

    fireEvent.click(getByText("Reconnecting... 2/5"));
    await settleAsyncRender();

    expect(Boolean(container.textContent?.includes("Network error: connection dropped while streaming."))).toBe(true);
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
    expect(Boolean(container.querySelector(".uppercase"))).toBe(false);
  });
});

describe("image-view and completed elicitation leaves", () => {
  beforeEach(() => {
    installWindowApi({});
    installMeasuredResizeObserver({ blockSize: 72, inlineSize: 320 });
  });

  test("keeps turn-wide inspected images behind a default-collapsed gallery disclosure", async () => {
    const imageOne = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    const imageTwo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath/%3E%3C/svg%3E";
    const { container } = render(
      <ThreadImageViewBlock
        block={{
          id: "image-view-1",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 2,
          searchableText: `${imageOne}\n${imageTwo}`,
          type: "imageView",
          status: "completed",
          imageViewPaths: [imageOne, imageTwo],
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "image-view-1",
            type: "imageView",
            kind: "systemEvent",
            semanticKind: "imageView",
            status: "completed",
            rawItem: { id: "image-view-1", type: "imageView", path: imageOne },
            createdAt: 1,
            updatedAt: 1,
          },
        }}
        isLatestTurn
        isStreamingTurn={false}
      />,
    );

    expect(container.querySelectorAll('[role="button"][aria-label="Inspected image"]').length).toBe(0);
    fireEvent.click(container.querySelector('button[aria-expanded="false"]') as HTMLElement);
    await settleAsyncRender();
    expect(container.querySelectorAll('[role="button"][aria-label="Inspected image"]').length).toBe(2);
  });

  test("renders generated images and pending output in the dedicated preview gallery", async () => {
    const imageOne = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='200'/%3E";
    const imageTwo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'/%3E";
    const { container, getByLabelText, getByTestId } = render(
      <TestQueryProvider>
        <ThreadGeneratedImageGalleryBlock
          block={{
            id: "generated-image-gallery",
            turnId: "turn-1",
            createdAt: 1,
            updatedAt: 2,
            searchableText: "",
            type: "generatedImageGallery",
            images: [
              { id: "generated-image-1", previewSrc: imageOne, src: imageTwo },
              { id: "generated-image-2", src: imageTwo },
            ],
            pendingImageCount: 1,
          }}
          isLatestTurn
          isStreamingTurn
        />
      </TestQueryProvider>,
    );

    expect(Boolean(getByTestId("generated-image-gallery"))).toBe(true);
    expect(container.querySelectorAll('[data-testid="generated-image-preview"]').length).toBe(2);
    expect(Boolean(container.querySelector('[aria-label="Generating image..."]'))).toBe(true);
    expect(getByLabelText("Generated image 1").querySelector("img")?.getAttribute("src"))
      .toBe(imageOne);
    const setDragData = vi.fn();
    fireEvent.dragStart(getByLabelText("Generated image 1").querySelector("img") as HTMLImageElement, {
      dataTransfer: { effectAllowed: "none", setData: setDragData },
    });
    expect(setDragData).toHaveBeenCalledWith(
      "application/x-codex-image",
      JSON.stringify({ filename: "generated-image-1", src: imageTwo }),
    );

    await act(async () => {
      fireEvent.click(getByLabelText("Generated image 1"));
      await Promise.resolve();
    });
    expect(Boolean(getByLabelText("Image preview"))).toBe(true);
    expect(getByLabelText("Image preview").querySelector("img")?.getAttribute("src"))
      .toBe(imageTwo);
    expect(getByLabelText("Download image").getAttribute("href")).toBe(imageTwo);
  });

  test("refetches a failed generated-image preview at most twice for its resolved source", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stable-image-source");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      dataBase64: "aW1hZ2U=",
      mimeType: "image/png",
    });
    installWindowApi({ invoke });
    try {
      const { findByLabelText } = render(
        <TestQueryProvider>
          <ThreadGeneratedImageGalleryBlock
            block={{
              id: "generated-image-gallery",
              turnId: "turn-1",
              createdAt: 1,
              updatedAt: 2,
              searchableText: "",
              type: "generatedImageGallery",
              images: [{ id: "generated-image-1", src: "file-service://asset-1" }],
              pendingImageCount: 0,
            }}
            isLatestTurn
            isStreamingTurn={false}
          />
        </TestQueryProvider>,
      );
      const preview = await findByLabelText("Generated image 1");
      const image = preview.querySelector("img") as HTMLImageElement;
      expect(invoke).toHaveBeenCalledTimes(1);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await act(async () => {
          fireEvent.error(image);
          await Promise.resolve();
        });
        await waitFor(() => {
          expect(invoke).toHaveBeenCalledTimes(Math.min(attempt + 2, 3));
        });
      }
    } finally {
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
    }
  });

  test("moves the generated-image carousel one slot and restores focus on pointer release", async () => {
    const measurement = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 74,
      height: 74,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const source = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'/%3E";
    try {
      const { getByLabelText } = render(
        <TestQueryProvider>
          <ThreadGeneratedImageGalleryBlock
            block={{
              id: "generated-image-carousel",
              turnId: "turn-1",
              createdAt: 1,
              updatedAt: 2,
              searchableText: "",
              type: "generatedImageGallery",
              images: Array.from({ length: 6 }, (_, index) => ({
                id: `generated-image-${index + 1}`,
                src: source,
              })),
              pendingImageCount: 0,
            }}
            isLatestTurn
            isStreamingTurn={false}
          />
        </TestQueryProvider>,
      );
      await waitFor(() => {
        expect((getByLabelText("Next images") as HTMLButtonElement).disabled).toBe(false);
      });
      const previousButton = getByLabelText("Previous images") as HTMLButtonElement;
      const nextButton = getByLabelText("Next images") as HTMLButtonElement;
      expect(previousButton.disabled).toBe(true);

      await act(async () => {
        fireEvent.click(nextButton);
        nextButton.focus();
        expect(document.activeElement).toBe(nextButton);
        fireEvent.pointerUp(nextButton);
        await Promise.resolve();
      });

      expect(previousButton.disabled).toBe(false);
      expect(getByLabelText("Generated image 1").getAttribute("aria-hidden")).toBe("true");
      expect(document.activeElement === nextButton).toBe(false);
    } finally {
      measurement.mockRestore();
    }
  });

  test("renders completed MCP elicitation as a collapsed question-and-answer disclosure", async () => {
    const { container, getByText } = render(
      <ThreadMcpServerElicitationBlock
        block={{
          id: "elicitation-1",
          turnId: "turn-1",
          createdAt: 1,
          updatedAt: 2,
          searchableText: "Allow the connector action? Accepted",
          type: "mcpServerElicitation",
          status: "completed",
          entry: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "elicitation-1",
            type: "mcpServerElicitation",
            kind: "systemEvent",
            semanticKind: "mcpServerElicitation",
            status: "completed",
            rawItem: {
              type: "mcpServerElicitation",
              completed: true,
              requestId: "request-1",
              action: "accept",
              elicitation: { kind: "mcpToolCall", message: "Allow the connector action?" },
            },
            createdAt: 1,
            updatedAt: 2,
          },
        }}
        isLatestTurn
        isStreamingTurn={false}
      />,
    );

    const collapsedBody = container.querySelector('[aria-hidden="true"][inert]');
    expect(collapsedBody?.getAttribute("inert")).toBe("");
    fireEvent.click(container.querySelector('button[aria-expanded="false"]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[aria-hidden="false"]') !== null).toBe(true);
    });
    getByText("Allow the connector action?");
    getByText("Accepted");
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
    expect(Boolean(container.querySelector('[codex\\.turn_diff\\.state="in_progress"]'))).toBe(true);
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

  test("suppresses completed turn diffs in prose detail mode", () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_PROSE" }));
    try {
      const { container } = render(
        <CodexThreadSettingsProvider>
          <ThreadTurnDiffBlock
            block={{
              id: "turn-diff-completed-prose",
              turnId: "turn-1",
              createdAt: 1,
              updatedAt: 1,
              searchableText: "1 file changed",
              type: "turnDiff",
              entry: {
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "turn-diff-completed-prose",
                entryId: "turn-diff-completed-prose",
                type: "turn_diff",
                kind: "systemEvent",
                semanticKind: "diff",
                status: "completed",
                rawItem: {
                  type: "turn-diff",
                  unifiedDiff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
                },
                createdAt: 1,
                updatedAt: 1,
              },
            }}
            isLatestTurn={true}
            isStreamingTurn={false}
          />
        </CodexThreadSettingsProvider>,
      );

      expect(container.textContent ?? "").toBe("");
    } finally {
      localStorage.removeItem(THREAD_SETTINGS_STORAGE_KEY);
    }
  });
});
