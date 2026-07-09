import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { CodexConversationItem } from "@/lib/types";
import type {
  ThreadAgentActivityGroupBlockModel,
  ThreadAgentActivityGroupEntryModel,
} from "../../thread-stage-types";
import { THREAD_TOOL_CALL_STORY_ITEMS } from "../thread-stage-story-fixtures";
import { CodexShimmerText } from "../shared/codex-shimmer-text";
import { ThreadAgentActivityGroupBlock } from "./local-conversation-block-leaves";
import "../../../../globals.css";

const LARGE_MIXED_GROUP_CYCLES = 30;
const OPEN_TRACE_NAME = "thread-agent-activity:open-120";
const COLLAPSED_STREAM_TRACE_NAME = "thread-agent-activity:collapsed-stream-120";
const EXPANDED_STREAM_TRACE_NAME = "thread-agent-activity:expanded-stream-120";

type ReducedMotionPreference = "no-preference" | "reduce";

interface ChromiumMediaEmulationSession {
  send(
    method: "Emulation.setEmulatedMedia",
    params: {
      features: Array<{
        name: "prefers-reduced-motion";
        value: ReducedMotionPreference;
      }>;
    },
  ): Promise<unknown>;
}

type TraceStage = "mount" | "collapsed-stream" | "open" | "expanded-stream" | "close";

interface ProfileCommit {
  actualDurationMs: number;
  phase: "mount" | "update" | "nested-update";
  stage: TraceStage;
}

function cloneActivityItem(base: CodexConversationItem, id: string): CodexConversationItem {
  return {
    ...base,
    threadId: "thread-performance",
    turnId: "turn-performance",
    itemId: id,
    entryId: id,
    mcpToolCall: base.mcpToolCall
      ? {
          ...base.mcpToolCall,
          callId: id,
        }
      : base.mcpToolCall,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildActivityEntry(
  base: CodexConversationItem,
  type: ThreadAgentActivityGroupEntryModel["type"],
  id: string,
): ThreadAgentActivityGroupEntryModel {
  const entry = cloneActivityItem(base, id);
  return {
    id,
    turnId: entry.turnId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    searchableText: `${type} ${id}`,
    type,
    entry,
    status: entry.status,
  } as ThreadAgentActivityGroupEntryModel;
}

function buildLargeMixedGroup(): ThreadAgentActivityGroupBlockModel {
  const families = [
    { base: THREAD_TOOL_CALL_STORY_ITEMS.fileChange, type: "fileChange" },
    { base: THREAD_TOOL_CALL_STORY_ITEMS.webSearch, type: "webSearch" },
    { base: THREAD_TOOL_CALL_STORY_ITEMS.mcp, type: "mcpToolCall" },
    { base: THREAD_TOOL_CALL_STORY_ITEMS.command, type: "exec" },
  ] as const;
  const entries = Array.from({ length: LARGE_MIXED_GROUP_CYCLES }, (_, cycle) => (
    families.map(({ base, type }) => buildActivityEntry(base, type, `${type}-${cycle}`))
  )).flat();

  return {
    id: "agent-activity-performance",
    turnId: "turn-performance",
    createdAt: 1,
    updatedAt: 1,
    searchableText: "large mixed activity group",
    type: "agentActivityGroup",
    summary: "Edited files, ran commands, used tools, and searched the web",
    status: "completed",
    entries,
  };
}

function buildStreamingUpdate(
  block: ThreadAgentActivityGroupBlockModel,
  revision: number,
): ThreadAgentActivityGroupBlockModel {
  const lastEntry = block.entries.at(-1);
  if (!lastEntry) return block;

  return {
    ...block,
    updatedAt: block.updatedAt + 1,
    summary: `Editing files, running commands, using tools, and searching the web (${revision})`,
    status: "inProgress",
    entries: [
      ...block.entries.slice(0, -1),
      {
        ...lastEntry,
        updatedAt: lastEntry.updatedAt + 1,
        status: "inProgress",
        entry: {
          ...lastEntry.entry,
          aggregatedOutput: `${lastEntry.entry.aggregatedOutput ?? ""}\nstream revision ${revision}`,
          exitCode: undefined,
          status: "inProgress",
          updatedAt: lastEntry.entry.updatedAt + 1,
        },
      },
    ],
  };
}

function sumCommitDuration(commits: readonly ProfileCommit[], stage: TraceStage): number {
  return commits
    .filter((commit) => commit.stage === stage)
    .reduce((total, commit) => total + commit.actualDurationMs, 0);
}

function countGroupRows(body: HTMLElement): number {
  return body.firstElementChild?.children.length ?? 0;
}

describe("ThreadAgentActivityGroupBlock Chromium behavior", () => {
  test("traces collapsed, open, and streaming ownership for a large mixed group", async () => {
    const initialBlock = buildLargeMixedGroup();
    performance.clearMeasures(OPEN_TRACE_NAME);
    performance.clearMeasures(COLLAPSED_STREAM_TRACE_NAME);
    performance.clearMeasures(EXPANDED_STREAM_TRACE_NAME);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const commits: ProfileCommit[] = [];
    let stage: TraceStage = "mount";
    const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
      commits.push({ actualDurationMs: actualDuration, phase, stage });
    };
    const renderGroup = (block: ThreadAgentActivityGroupBlockModel) => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Profiler id="large-thread-agent-activity" onRender={onRender}>
            <ThreadAgentActivityGroupBlock
              block={block}
              isLatestTurn
              isStreamingTurn={block.status === "inProgress"}
            />
          </Profiler>
        </TooltipProvider>
      </QueryClientProvider>
    );
    const view = render(renderGroup(initialBlock));
    const disclosure = view.getByRole("button", { name: /Edited files/i });

    expect(view.queryByTestId("agent-activity-group-body")).toBeNull();

    stage = "collapsed-stream";
    const collapsedStreamStartedAt = performance.now();
    let currentBlock = initialBlock;
    for (let revision = 1; revision <= 3; revision += 1) {
      currentBlock = buildStreamingUpdate(currentBlock, revision);
      await act(async () => {
        view.rerender(renderGroup(currentBlock));
        await Promise.resolve();
      });
      expect(view.queryByTestId("agent-activity-group-body")).toBeNull();
    }
    const collapsedStreamLatencyMs = performance.now() - collapsedStreamStartedAt;
    const collapsedStreamCommitMs = sumCommitDuration(commits, "collapsed-stream");

    stage = "open";
    const openStartedAt = performance.now();
    await act(async () => {
      fireEvent.click(disclosure);
      await Promise.resolve();
    });
    await waitFor(() => {
      const body = view.getByTestId("agent-activity-group-body");
      expect(countGroupRows(body)).toBe(currentBlock.entries.length);
    });
    const openLatencyMs = performance.now() - openStartedAt;
    const openCommitMs = sumCommitDuration(commits, "open");
    const body = view.getByTestId("agent-activity-group-body");
    const scroller = body.firstElementChild;
    if (!(scroller instanceof HTMLElement)) {
      throw new Error("Expected the mixed activity body scroller.");
    }
    const rowWrappersBeforeStream = [...scroller.children];
    const childListMutations: MutationRecord[] = [];
    const mutationObserver = new MutationObserver((records) => {
      childListMutations.push(...records.filter((record) => record.type === "childList"));
    });
    mutationObserver.observe(scroller, { childList: true });

    stage = "expanded-stream";
    const expandedStreamingBlock = buildStreamingUpdate(currentBlock, 4);
    const expandedStreamStartedAt = performance.now();
    await act(async () => {
      view.rerender(renderGroup(expandedStreamingBlock));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    mutationObserver.disconnect();
    const expandedStreamLatencyMs = performance.now() - expandedStreamStartedAt;
    const expandedStreamCommitMs = sumCommitDuration(commits, "expanded-stream");
    const rowWrappersAfterStream = [...scroller.children];

    performance.measure(OPEN_TRACE_NAME, {
      start: openStartedAt,
      duration: openLatencyMs,
      detail: { commitMs: openCommitMs, rows: currentBlock.entries.length },
    });
    performance.measure(COLLAPSED_STREAM_TRACE_NAME, {
      start: collapsedStreamStartedAt,
      duration: collapsedStreamLatencyMs,
      detail: { commitMs: collapsedStreamCommitMs, updates: 3 },
    });
    performance.measure(EXPANDED_STREAM_TRACE_NAME, {
      start: expandedStreamStartedAt,
      duration: expandedStreamLatencyMs,
      detail: { commitMs: expandedStreamCommitMs, rows: expandedStreamingBlock.entries.length },
    });

    expect(openCommitMs).toBeGreaterThan(0);
    expect(collapsedStreamCommitMs).toBeGreaterThan(0);
    expect(expandedStreamCommitMs).toBeGreaterThan(0);
    expect(performance.getEntriesByName(OPEN_TRACE_NAME, "measure").length).toBe(1);
    expect(performance.getEntriesByName(COLLAPSED_STREAM_TRACE_NAME, "measure").length).toBe(1);
    expect(performance.getEntriesByName(EXPANDED_STREAM_TRACE_NAME, "measure").length).toBe(1);
    expect(childListMutations).toEqual([]);
    expect(rowWrappersAfterStream.length).toBe(rowWrappersBeforeStream.length);
    for (let index = 0; index < rowWrappersBeforeStream.length - 1; index += 1) {
      expect(rowWrappersAfterStream[index]).toBe(rowWrappersBeforeStream[index]);
    }
    expect(countGroupRows(view.getByTestId("agent-activity-group-body")))
      .toBe(expandedStreamingBlock.entries.length);

    stage = "close";
    await act(async () => {
      fireEvent.click(disclosure);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.queryByTestId("agent-activity-group-body")).toBeNull();
    });
  });

  test("preserves narrow truncation and native disclosure keyboard behavior", async () => {
    const block = {
      ...buildLargeMixedGroup(),
      summary: "Edited many deeply nested files, ran several long commands, used multiple tools, and searched the web repeatedly",
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div data-testid="narrow-activity-host" style={{ width: 220 }}>
            <ThreadAgentActivityGroupBlock
              block={block}
              isLatestTurn={false}
              isStreamingTurn={false}
              threadCwd="/workspace/nodex"
            />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const host = view.getByTestId("narrow-activity-host");
    const disclosure = view.container.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!disclosure) throw new Error("Expected the activity disclosure button.");
    const hostRect = host.getBoundingClientRect();
    const disclosureRect = disclosure.getBoundingClientRect();

    expect(disclosureRect.width).toBeGreaterThan(0);
    expect(disclosureRect.right).toBeLessThanOrEqual(hostRect.right + 0.5);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);

    disclosure.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(view.getByTestId("agent-activity-group-body")).toBeDefined();
    });

    await userEvent.keyboard("{Space}");
    await waitFor(() => {
      expect(view.queryByTestId("agent-activity-group-body")).toBeNull();
    });
  });

  test("keeps the activity shimmer static under reduced motion", async () => {
    // Vitest keeps this provider-neutral type empty; Chromium supplies `send` at runtime.
    const session = cdp() as unknown as ChromiumMediaEmulationSession;
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    try {
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      const view = render(
        <CodexShimmerText data-testid="reduced-motion-activity-summary">
          Running checks
        </CodexShimmerText>,
      );
      const shimmer = view.getByTestId("reduced-motion-activity-summary");
      const sweep = shimmer.lastElementChild;
      const highlight = sweep?.firstElementChild;
      if (!(sweep instanceof HTMLElement) || !(highlight instanceof HTMLElement)) {
        throw new Error("Expected the retained cadenced shimmer overlay.");
      }

      expect(getComputedStyle(shimmer).animationName).toBe("none");
      expect(getComputedStyle(sweep).animationName).toBe("none");
      expect(getComputedStyle(highlight).animationName).toBe("none");
    } finally {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
    }
  });

  test("scales the exact rem body cap at a high root font size", async () => {
    const originalRootFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "20px";

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const view = render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <div data-testid="scaled-activity-host" style={{ width: 320 }}>
              <ThreadAgentActivityGroupBlock
                block={buildLargeMixedGroup()}
                isLatestTurn={false}
                isStreamingTurn={false}
              />
            </div>
          </TooltipProvider>
        </QueryClientProvider>,
      );
      const disclosure = view.container.querySelector<HTMLButtonElement>("button[aria-expanded]");
      if (!disclosure) throw new Error("Expected the activity disclosure button.");

      await act(async () => {
        fireEvent.click(disclosure);
        await Promise.resolve();
      });
      const body = await waitFor(() => view.getByTestId("agent-activity-group-body"));
      const scroller = body.firstElementChild;
      if (!(scroller instanceof HTMLElement)) {
        throw new Error("Expected the activity body scroller.");
      }

      const scrollerStyle = getComputedStyle(scroller);
      expect(getComputedStyle(document.documentElement).fontSize).toBe("20px");
      expect(scrollerStyle.maxHeight).toBe("280px");
      expect(scrollerStyle.getPropertyValue("--conversation-grouped-item-gap").trim()).toBe("4px");
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      expect(scroller.clientHeight).toBe(280);
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    } finally {
      document.documentElement.style.fontSize = originalRootFontSize;
    }
  });
});
