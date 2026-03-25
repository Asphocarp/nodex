import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, type ReactNode } from "react";
import type { CodexTranscriptEntry } from "@/lib/types";
import {
  ThreadExplorationGroupBlock,
  ThreadMultiAgentGroupBlock,
} from "../../blocks/local-conversation-block-leaves";
import { TurnDiffSurface } from "../turn-diff-surface";
import { getToolComponent } from "./get-tool-component";
import { McpToolCall } from "./mcp-tool-call";
import { THREAD_TOOL_CALL_STORY_ITEMS } from "../../thread-stage-story-fixtures";

function StorySurface({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">{title}</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">{description}</div>
      </div>
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}

function ToolCallStory({
  item,
  title,
  description,
  autoOpen = false,
}: {
  item: CodexTranscriptEntry;
  title: string;
  description: string;
  autoOpen?: boolean;
}) {
  const ToolComponent = getToolComponent(item);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoOpen) return;
    const toggle = containerRef.current?.querySelector<HTMLElement>('button[aria-expanded="false"]');
    if (!toggle) return;
    toggle.click();
  }, [autoOpen]);

  return (
    <StorySurface title={title} description={description}>
      <div ref={containerRef}>
        <ToolComponent
          item={item}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </div>
    </StorySurface>
  );
}

function AutoOpenMcpToolCall({
  item,
  rawDialogOpen = false,
}: {
  item: CodexTranscriptEntry;
  rawDialogOpen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const toggle = containerRef.current?.querySelector<HTMLElement>('button[aria-expanded="false"]');
    if (!toggle) return;
    toggle.click();
  }, []);

  return (
    <div ref={containerRef}>
      <McpToolCall item={item} rawDialogOpen={rawDialogOpen} />
    </div>
  );
}

function ExplorationGroupStory() {
  return (
    <StorySurface
      title="Exploration Group"
      description="Multiple read/list/search command actions coalesced into the renderer’s exploration summary block."
    >
      <ThreadExplorationGroupBlock
        block={{
          id: "exploration-story",
          turnId: "turn_tool_story",
          createdAt: 1,
          updatedAt: 2,
          searchableText: "Exploration",
          type: "explorationGroup",
          entries: [THREAD_TOOL_CALL_STORY_ITEMS.command],
          summary: "Explored renderer files",
          status: "completed",
        }}
        isLatestTurn={false}
        isStreamingTurn={false}
        projectWorkspacePath="/workspace/nodex"
        threadCwd="/workspace/nodex"
      />
    </StorySurface>
  );
}

function MultiAgentGroupStory() {
  return (
    <StorySurface
      title="Multi-Agent Group"
      description="Grouped background worker activity shown with the same leaf components used in mounted turns."
    >
      <ThreadMultiAgentGroupBlock
        block={{
          id: "multi-agent-story",
          turnId: "turn_tool_story",
          createdAt: 1,
          updatedAt: 2,
          searchableText: "Multi-agent work",
          type: "multiAgentGroup",
          entries: [...THREAD_TOOL_CALL_STORY_ITEMS.multiAgent],
          summary: "2 background workers reported progress",
          status: "completed",
        }}
        isLatestTurn={false}
        isStreamingTurn={false}
        projectWorkspacePath="/workspace/nodex"
        threadCwd="/workspace/nodex"
      />
    </StorySurface>
  );
}

const meta = {
  title: "Workbench/Threads/Tool Calls",
  component: ToolCallStory,
  parameters: {
    docs: {
      description: {
        component:
          "Focused leaf-story coverage for the thread tool/activity surfaces used by mounted turns, plus exploration and multi-agent grouping blocks.",
      },
    },
  },
  args: {
    item: THREAD_TOOL_CALL_STORY_ITEMS.command,
    title: "Tool call",
    description: "Thread tool call surface.",
  },
} satisfies Meta<typeof ToolCallStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CommandExecution: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.command}
      title="Command Execution"
      description="Structured command summary, output body, and metadata for a settled command run."
      autoOpen
    />
  ),
};

export const FileChange: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.fileChange}
      title="File Change / Diff"
      description="Codex Electron-style file-edit tool surface rendered from the patch item."
      autoOpen
    />
  ),
};

export const TurnDiff: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff"
      description="Turn-level unified diff rendered separately from the file-edit tool call."
    >
      <TurnDiffSurface
        item={THREAD_TOOL_CALL_STORY_ITEMS.turnDiff}
        projectWorkspacePath="/workspace/nodex"
        threadCwd="/workspace/nodex"
      />
    </StorySurface>
  ),
};

export const WebSearch: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.webSearch}
      title="Web Search"
      description="Codex Electron-style compact search summary row showing the primary query without an expandable JSON body."
    />
  ),
};

export const WebSearchFindInPage: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.webSearchFindInPage}
      title="Web Search Find In Page"
      description="The dedicated web-search leaf also matches Codex Electron wording for find-in-page actions."
    />
  ),
};

export const WebSearchInProgress: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.webSearchInProgress}
      title="Web Search In Progress"
      description="Running web searches shimmer and keep the same compact summary row while the tool call is still active."
    />
  ),
};

export const McpToolCallDefault: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.mcp}
      title="MCP Tool Call"
      description="Expanded Codex-style MCP disclosure with plaintext result content and the raw-output dialog trigger."
      autoOpen
    />
  ),
};

export const McpToolCallCollapsed: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Collapsed"
      description="Collapsed Codex Electron parity state for a completed MCP call."
    >
      <McpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpQueryDocs} />
    </StorySurface>
  ),
};

export const McpToolCallExpanded: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Expanded"
      description="Expanded Codex Electron parity state for a completed MCP call with visible plaintext result content."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcp} />
    </StorySurface>
  ),
};

export const McpRawOutputDialog: Story = {
  render: () => (
    <StorySurface
      title="MCP Raw Output Dialog"
      description="The raw-output dialog opened from the Codex-style MCP call footer action."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcp} rawDialogOpen />
    </StorySurface>
  ),
};

export const GenericFallback: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.generic}
      title="Generic Tool Call"
      description="Compatibility fallback for tool payloads without a dedicated Codex Electron renderer, using the same summary/disclosure tone as Codex tool rows."
      autoOpen
    />
  ),
};

export const GenericFallbackRawOnly: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.genericRawOnly}
      title="Generic Fallback Raw Payload"
      description="Unknown tool payloads can still be inspected through the fallback disclosure when only raw structured data is available."
      autoOpen
    />
  ),
};

export const ExplorationGroup: Story = {
  render: () => <ExplorationGroupStory />,
};

export const MultiAgentGroup: Story = {
  render: () => <MultiAgentGroupStory />,
};
