import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, type ReactNode } from "react";
import type { CodexFileChange, CodexTranscriptEntry } from "@/lib/types";
import { buildCodexFileChangeUnifiedDiff } from "../../../../../../shared/codex-file-change";
import { ThreadExplorationGroupBlock } from "../../blocks/local-conversation-block-leaves";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "../local-conversation-view-constants";
import { TurnDiffSurface } from "../turn-diff-surface";
import { getToolComponent } from "./get-tool-component";
import { McpToolCall } from "./mcp-tool-call";
import { THREAD_TOOL_CALL_STORY_ITEMS } from "../../thread-stage-story-fixtures";

const LONG_COMMAND = [
  "bun x tsx scripts/collect-long-command-metrics.ts",
  "--project nodex",
  "--scope renderer",
  "--filter command-tool-call",
  "--json",
  "--include src/renderer/features/local-conversation/view/shared/tools/command-tool-call.tsx",
  "--include src/renderer/features/local-conversation/view/shared/tools/thread-command-shell-block.tsx",
  "--include src/renderer/features/local-conversation/view/shared/tools/thread-tool-calls.stories.tsx",
  "--include src/renderer/features/local-conversation/view/shared/tools/command-tool-call.render.test.tsx",
  "--group-by semanticKind,status,toolName",
  "--output /tmp/nodex-command-shell-regression-fixture.json",
].join(" ");

const COMMAND_ITEM = THREAD_TOOL_CALL_STORY_ITEMS.command;
function buildCommandItem(overrides?: Partial<typeof COMMAND_ITEM>) {
  return {
    ...COMMAND_ITEM,
    ...overrides,
  };
}

function buildStoryFileChangePayload(changes: CodexFileChange[]) {
  return {
    label: changes.length === 1 ? `${changes[0]?.type === "add" ? "Created" : changes[0]?.type === "delete" ? "Deleted" : "Edited"} ${changes[0]?.path}` : undefined,
    paths: changes.map((change) => change.path),
    changes,
    diffs: changes
      .map((change) => buildCodexFileChangeUnifiedDiff(change))
      .filter((diff): diff is string => typeof diff === "string"),
  };
}

function buildStoryFileChangeToolCall(changes: CodexFileChange[]) {
  const payload = buildStoryFileChangePayload(changes);

  return {
    subtype: "fileChange" as const,
    toolName: "file_change",
    args: {
      label: payload.label,
    },
    result: {
      diffs: payload.diffs,
    },
  };
}

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

function ConversationStorySurface({ children }: { children: ReactNode }) {
  return (
    <div data-thread-find-target="conversation" className={LOCAL_CONVERSATION_CONTENT_CLASS_NAME}>
      {children}
    </div>
  );
}

function ToolCallStory({
  item,
  title,
  description,
  autoOpen = false,
  autoExpandCommandLine = false,
}: {
  item: CodexTranscriptEntry;
  title: string;
  description: string;
  autoOpen?: boolean;
  autoExpandCommandLine?: boolean;
}) {
  const ToolComponent = getToolComponent(item);
  if (!ToolComponent) return null;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoOpen && !autoExpandCommandLine) return;

    const root = containerRef.current;
    if (!root) return;

    let frameId = 0;
    let nestedFrameId = 0;

    const clickSummaryToggle = () => {
      const summaryToggle = root.querySelector<HTMLElement>(
        'button[aria-expanded="false"], [data-command-tool-summary-toggle]',
      );
      summaryToggle?.click();
    };

    frameId = window.requestAnimationFrame(() => {
      if (autoOpen) {
        clickSummaryToggle();
      }

      nestedFrameId = window.requestAnimationFrame(() => {
        if (!autoExpandCommandLine) return;
        if (!root.querySelector("[data-command-shell-line-toggle]")) {
          clickSummaryToggle();
        }
        root.querySelector<HTMLElement>("[data-command-shell-line-toggle]")?.click();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(nestedFrameId);
    };
  }, [autoExpandCommandLine, autoOpen]);

  return (
    <StorySurface title={title} description={description}>
      <ConversationStorySurface>
        <div ref={containerRef}>
          <ToolComponent
            item={item}
            projectWorkspacePath="/workspace/nodex"
            threadCwd="/workspace/nodex"
          />
        </div>
      </ConversationStorySurface>
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
    <ConversationStorySurface>
      <div ref={containerRef}>
        <McpToolCall item={item} rawDialogOpen={rawDialogOpen} />
      </div>
    </ConversationStorySurface>
  );
}

function PartiallyVisibleScrollAnchorHarness({ item }: { item: CodexTranscriptEntry }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ToolComponent = getToolComponent(item);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = 84;
  }, []);

  if (!ToolComponent) {
    throw new Error("Expected command tool-call story item to resolve a tool component.");
  }

  return (
    <ConversationStorySurface>
      <div ref={scrollRef} className="max-h-96 overflow-y-auto rounded-2xl border border-token-border bg-token-main-surface-primary/40 p-4">
        <div className="space-y-3">
          <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
            Scroll position is pre-set so the command card header remains visible while earlier transcript rows sit above the viewport.
          </div>
          <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
            Expanding and collapsing the tool body should not shift the visible header or drag the surrounding thread position.
          </div>
          <ToolComponent
            item={item}
            projectWorkspacePath="/workspace/nodex"
            threadCwd="/workspace/nodex"
          />
          <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
            Additional transcript rows below the command card keep the scroll container tall enough to reproduce the anchoring edge case.
          </div>
          <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
            The transcript should stay visually stable while nested tool accordions remeasure.
          </div>
        </div>
      </div>
    </ConversationStorySurface>
  );
}

function ExplorationGroupStory() {
  return (
    <StorySurface
      title="Exploration Group"
      description="Multiple read/list/search command actions coalesced into the renderer’s exploration summary block."
    >
      <ConversationStorySurface>
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
      </ConversationStorySurface>
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
          "Focused leaf-story coverage for the Codex tool and tool-group surfaces used by mounted turns.",
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
    />
  ),
};

export const CommandExecutionLongCommandCollapsed: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-long-command-collapsed",
        entryId: "tool-call-long-command-collapsed",
        command: LONG_COMMAND,
      }}
      title="Command Execution Long Command Collapsed"
      description="Transcript shell commands start line-clamped inside the expanded embedded shell block."
      autoOpen
    />
  ),
};

export const CommandExecutionLongCommandExpanded: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-long-command-expanded",
        entryId: "tool-call-long-command-expanded",
        command: LONG_COMMAND,
      }}
      title="Command Execution Long Command Expanded"
      description="Clicking the embedded shell command line expands it instead of always truncating with ellipsis."
      autoOpen
      autoExpandCommandLine
    />
  ),
};

export const CommandExecutionScrollAnchorHarness: Story = {
  render: () => {
    const item = {
      ...buildCommandItem(),
      itemId: "tool-call-scroll-anchor-harness",
      entryId: "tool-call-scroll-anchor-harness",
      command: LONG_COMMAND,
    };
    const ToolComponent = getToolComponent(item);
    if (!ToolComponent) {
      throw new Error("Expected command tool-call story item to resolve a tool component.");
    }

    return (
      <StorySurface
        title="Command Execution Scroll Anchor Harness"
        description="Places a long embedded shell card inside a constrained scroll container so header stability can be inspected while expanding and collapsing the tool body."
      >
        <ConversationStorySurface>
          <div className="max-h-96 overflow-y-auto rounded-2xl border border-token-border bg-token-main-surface-primary/40 p-4">
            <div className="space-y-3">
              <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
                Earlier transcript content above the embedded shell card.
              </div>
              <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
                Use this harness to verify that expanding the tool body does not drag the visible header position.
              </div>
              <ToolComponent
                item={item}
                projectWorkspacePath="/workspace/nodex"
                threadCwd="/workspace/nodex"
              />
              <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
                Later transcript content below the tool card.
              </div>
              <div className="rounded-xl bg-token-foreground/4 px-4 py-3 text-token-description-foreground">
                The visible card header should remain visually anchored while the body expands.
              </div>
            </div>
          </div>
        </ConversationStorySurface>
      </StorySurface>
    );
  },
};

export const CommandExecutionInProgressNoOutput: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-running-no-output",
        entryId: "tool-call-running-no-output",
        status: "inProgress",
        markdownText: "Running bun test",
        command: "bun test",
        aggregatedOutput: "",
        exitCode: null,
      }}
      title="Command Execution In Progress Without Output"
      description="Running shell commands keep the embedded output area blank until real output arrives."
      autoOpen
    />
  ),
};

export const CommandExecutionFailedExitCode: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-failed-exit-code",
        entryId: "tool-call-failed-exit-code",
        status: "failed",
        command: "bun test",
        aggregatedOutput: "tests failed\n",
        exitCode: 7,
      }}
      title="Command Execution Failed Exit Code"
      description="The embedded shell footer reads the canonical exit code instead of inferring terminal state from output text."
      autoOpen
    />
  ),
};

export const CommandExecutionScrollAnchorPartiallyVisible: Story = {
  render: () => {
    const item = {
      ...buildCommandItem(),
      itemId: "tool-call-scroll-anchor-partially-visible",
      entryId: "tool-call-scroll-anchor-partially-visible",
      command: LONG_COMMAND,
    };

    return (
      <StorySurface
        title="Command Execution Scroll Anchor Partially Visible"
        description="Matches the Codex regression case where a tool-call header is still visible while the expanded body remeasures inside the virtualized transcript."
      >
        <PartiallyVisibleScrollAnchorHarness item={item} />
      </StorySurface>
    );
  },
};

export const FileChange: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.fileChange}
      title="File Change / Diff"
      description="Codex Electron-style file-edit tool surface rendered from the canonical file-change item."
      autoOpen
    />
  ),
};

export const FileChangeMultiFile: Story = {
  render: () => (
    <ToolCallStory
      item={(() => {
        const changes: CodexFileChange[] = [
          {
            path: "src/one.ts",
            type: "update",
            movePath: null,
            unifiedDiff: [
              "@@ -1 +1 @@",
              "-console.log('one');",
              "+console.log('ONE');",
            ].join("\n"),
          },
          {
            path: "src/two.ts",
            type: "update",
            movePath: null,
            unifiedDiff: [
              "@@ -1 +1 @@",
              "-console.log('two');",
              "+console.log('TWO');",
            ].join("\n"),
          },
        ];

        return {
          ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
          itemId: "tool_story_file_change_multi",
          entryId: "tool_story_file_change_multi",
          fileChange: buildStoryFileChangePayload(changes),
          toolCall: buildStoryFileChangeToolCall(changes),
        };
      })()}
      title="File Change / Diff Multi-File"
      description="Expanded per-file rows keep the thread-owned filename header without repeating the diff library header inside each embedded preview."
      autoOpen
    />
  ),
};

export const FileChangeSemanticFallback: Story = {
  render: () => (
    <ToolCallStory
      item={(() => {
        const changes: CodexFileChange[] = [
          {
            path: "src/new-file.ts",
            type: "add",
            content: "export function Foo() {}\n",
          },
          {
            path: "src/deleted-file.ts",
            type: "delete",
            content: "export function Gone() {}\n",
          },
        ];

        return {
          ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
          itemId: "tool-call-file-change-semantic-fallback",
          entryId: "tool-call-file-change-semantic-fallback",
          fileChange: buildStoryFileChangePayload(changes),
          toolCall: buildStoryFileChangeToolCall(changes),
        };
      })()}
      title="File Change Semantic Fallback"
      description="Structured add and delete changes use semantic previews instead of a raw patch text fallback when no parsed inline file diff is available."
      autoOpen
    />
  ),
};

export const FileChangeDeclinedRename: Story = {
  render: () => (
    <ToolCallStory
      item={(() => {
        const changes: CodexFileChange[] = [
          {
            path: "src/renamed.ts",
            type: "update",
            movePath: "src/original.ts",
            unifiedDiff: [
              "@@ -1 +1 @@",
              "-export const value = 'old';",
              "+export const value = 'new';",
            ].join("\n"),
          },
        ];

        return {
          ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
          itemId: "tool-call-file-change-declined-rename",
          entryId: "tool-call-file-change-declined-rename",
          status: "declined",
          fileChange: buildStoryFileChangePayload(changes),
          toolCall: buildStoryFileChangeToolCall(changes),
        };
      })()}
      title="File Change Declined Rename"
      description="Rejected file edits preserve rename metadata in the renderer and match Codex Electron's plain rejected summary label."
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
      <ConversationStorySurface>
        <TurnDiffSurface
          item={THREAD_TOOL_CALL_STORY_ITEMS.turnDiff}
          isInProgress={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffWithRevert: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff With Revert"
      description="Completed turn diffs can hand off directly to the Diffs stage and expose the Codex-style revert/reapply affordance when the payload requests it."
    >
      <ConversationStorySurface>
        <TurnDiffSurface
          item={{
            ...THREAD_TOOL_CALL_STORY_ITEMS.turnDiff,
            rawItem: {
              ...(typeof THREAD_TOOL_CALL_STORY_ITEMS.turnDiff.rawItem === "object" && THREAD_TOOL_CALL_STORY_ITEMS.turnDiff.rawItem !== null
                ? THREAD_TOOL_CALL_STORY_ITEMS.turnDiff.rawItem
                : {}),
              type: "turn-diff",
              cwd: "/workspace/nodex",
              unifiedDiff: (THREAD_TOOL_CALL_STORY_ITEMS.turnDiff.rawItem as { unifiedDiff?: string } | undefined)?.unifiedDiff ?? "",
              showRevertButton: true,
            },
          }}
          isInProgress={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </ConversationStorySurface>
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

export const McpToolCallInProgress: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call In Progress"
      description="In-progress MCP calls stay collapsed, shimmer, and do not expose the expanded detail body."
    >
      <McpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpInProgress} />
    </StorySurface>
  ),
};

export const McpToolCallProtocolError: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Protocol Error"
      description="Completed protocol errors render the error branch instead of the no-content fallback."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpProtocolError} />
    </StorySurface>
  ),
};

export const McpToolCallStructuredOnly: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Structured Only"
      description="Structured-only success still shows the no-content fallback before appending the JSON panel."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpQueryDocs} />
    </StorySurface>
  ),
};

export const McpToolCallUnknownBlock: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Unknown Block"
      description="Malformed content blocks fall back to visible JSON instead of disappearing."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpUnknownBlock} />
    </StorySurface>
  ),
};

export const ExplorationGroup: Story = {
  render: () => <ExplorationGroupStory />,
};
