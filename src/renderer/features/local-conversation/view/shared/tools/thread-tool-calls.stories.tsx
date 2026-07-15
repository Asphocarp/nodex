import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  CodexFileChange,
  CodexMcpToolCallContentBlock,
  CodexMcpToolCallNormalizedResult,
  CodexProtocolRequestId,
  CodexTranscriptEntry,
  ProtocolAppInfo,
} from "@/lib/types";
import type {
  ThreadAgentActivityGroupBlockModel,
  ThreadAgentActivityGroupEntryModel,
} from "../../../thread-stage-types";
import {
  buildCodexFileChangeMap,
  resolveCodexPatchSuccess,
} from "../../../../../../shared/codex-file-change";
import { normalizeCodexAppInfoLogos } from "../../../../../../shared/codex-app-info";
import type {
  CodexAutomaticApprovalReviewRiskLevel,
  CodexAutomaticApprovalReviewStatus,
} from "../../../../../../shared/codex-transcript-special-items";
import {
  ThreadAgentActivityGroupBlock,
} from "../../blocks/local-conversation-block-leaves";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "../local-conversation-view-constants";
import { TurnDiffPatchFailureDialog, TurnDiffSurface } from "../turn-diff-surface";
import { getToolComponent } from "./get-tool-component";
import { DynamicToolCall } from "./dynamic-tool-call";
import { McpToolCall } from "./mcp-tool-call";
import { ThreadMcpAppsProvider } from "./mcp-apps-context";
import { ToolActivityIcon, semanticToolIcon } from "./tool-call-icons";
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

function buildMcpSourceStoryItem(
  id: string,
  source: NonNullable<NonNullable<CodexTranscriptEntry["mcpToolCall"]>["source"]>,
): CodexTranscriptEntry {
  const base = THREAD_TOOL_CALL_STORY_ITEMS.mcp;
  if (!base.mcpToolCall) return base;

  return {
    ...base,
    itemId: id,
    entryId: id,
    mcpToolCall: {
      ...base.mcpToolCall,
      callId: id,
      functionName: `node_repl__${source.kind}`,
      source,
      invocation: {
        server: "node_repl",
        tool: source.kind === "browserUse" ? "browser_action" : "computer_action",
        arguments: {},
      },
    },
  };
}

function buildMcpAppInfoStoryItem(id: string): CodexTranscriptEntry {
  const base = THREAD_TOOL_CALL_STORY_ITEMS.mcp;
  if (!base.mcpToolCall) return base;
  return {
    ...base,
    itemId: id,
    entryId: id,
    mcpToolCall: {
      ...base.mcpToolCall,
      callId: id,
      functionName: "docs__search",
      source: null,
      invocation: { server: "docs", tool: "search", arguments: {} },
    },
  };
}

function buildMcpResultStoryItem(
  id: string,
  result: CodexMcpToolCallNormalizedResult,
): CodexTranscriptEntry {
  const base = THREAD_TOOL_CALL_STORY_ITEMS.mcp;
  if (!base.mcpToolCall) return base;

  return {
    ...base,
    itemId: id,
    entryId: id,
    status: result?.type === "error" ? "failed" : "completed",
    toolCall: base.toolCall
      ? {
          ...base.toolCall,
          result: result?.type === "success"
            ? {
                type: "success",
                content: result.content,
                structuredContent: result.structuredContent,
              }
            : undefined,
          error: result?.type === "error" ? result.error : undefined,
        }
      : base.toolCall,
    mcpToolCall: {
      ...base.mcpToolCall,
      callId: id,
      durationMs: 640,
      completed: true,
      result,
    },
  };
}

const MCP_RARE_CONTENT_BLOCKS: CodexMcpToolCallContentBlock[] = [
  {
    type: "text",
    text: "The tool returned text with audience and priority annotations.",
    annotations: { audience: ["assistant", "user"], priority: 0.8 },
  },
  {
    type: "resource_link",
    uri: "file:///workspace/nodex/docs/RELIABILITY.md",
    title: "Reliability contract",
    annotations: { audience: ["assistant"], lastModified: "2026-07-14T02:00:00Z" },
  },
  {
    type: "embedded_resource",
    resource: {
      uri: "memory://mcp/result-note",
      mimeType: "text/markdown",
      text: "# Embedded result\n\nThis body is rendered inline with its URI and MIME metadata.",
      annotations: { priority: 0.5 },
    },
  },
  {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    annotations: { audience: ["user"] },
  },
  {
    type: "audio",
    mimeType: "audio/wav",
    data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=",
    annotations: { audience: ["user"] },
  },
];

const MCP_APP_INFO_STORY_APPS = normalizeCodexAppInfoLogos([{
  id: "connector_docs",
  name: "Docs",
  description: null,
  logoUrl: null,
  logoUrlDark: null,
  iconAssets: {
    "256_square": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' rx='7' fill='%230b57d0'/%3E%3Cpath d='M9 8h10l4 4v12H9z' fill='white'/%3E%3C/svg%3E",
  },
  iconDarkAssets: {
    "256_square": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' rx='7' fill='%238ab4f8'/%3E%3Cpath d='M9 8h10l4 4v12H9z' fill='%23101828'/%3E%3C/svg%3E",
  },
  distributionChannel: null,
  branding: null,
  appMetadata: null,
  labels: null,
  installUrl: null,
  isAccessible: true,
  isEnabled: true,
  pluginDisplayNames: [],
} satisfies ProtocolAppInfo]);

function buildStoryFileChangePayload(
  changes: CodexFileChange[],
  success: boolean | null = true,
) {
  return {
    label: changes.length === 1 ? `${changes[0]?.type === "add" ? "Created" : changes[0]?.type === "delete" ? "Deleted" : "Edited"} ${changes[0]?.path}` : undefined,
    changes: buildCodexFileChangeMap(changes),
    success,
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
    result: { changes: payload.changes },
  };
}

function buildStoryFileChangeItem({
  approvalRequestId,
  changes,
  id,
  status = "completed",
}: {
  approvalRequestId?: CodexProtocolRequestId | null;
  changes: CodexFileChange[];
  id: string;
  status?: CodexTranscriptEntry["status"];
}): CodexTranscriptEntry {
  return {
    ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
    itemId: id,
    entryId: id,
    status,
    approvalRequestId,
    fileChange: buildStoryFileChangePayload(changes, resolveCodexPatchSuccess(status)),
    toolCall: buildStoryFileChangeToolCall(changes),
  };
}

type AgentActivitySummaryStats = NonNullable<ThreadAgentActivityGroupBlockModel["summaryStats"]>;

function buildCollapsedSummaryStats(
  overrides: Partial<AgentActivitySummaryStats>,
): AgentActivitySummaryStats {
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
    deniedRequestCount: 0,
    timedOutRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    completedWebSearchCommandCount: 0,
    runningFolderCreationCommandCount: 0,
    runningWebSearchCommandCount: 0,
    mcpToolCallCount: 0,
    runningMcpToolCallCount: 0,
    mcpToolCallSources: [],
    webSearchCount: 0,
    runningWebSearchCount: 0,
    ...overrides,
  };
}

function buildFileChangeAgentActivityBlock({
  entries,
  id,
  searchableText,
  summary,
  summaryStats,
}: {
  entries: CodexTranscriptEntry[];
  id: string;
  searchableText: string;
  summary: string;
  summaryStats: AgentActivitySummaryStats;
}): ThreadAgentActivityGroupBlockModel {
  return {
    id,
    turnId: "turn_tool_story",
    createdAt: 1,
    updatedAt: 2,
    searchableText,
    type: "agentActivityGroup",
    summary,
    summaryParts: [summary],
    status: "completed",
    summaryStats,
    entries: entries.map((entry) => ({
      id: entry.entryId ?? entry.itemId,
      turnId: entry.turnId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      searchableText,
      type: "fileChange" as const,
      entry,
      status: entry.status,
    })),
  };
}

type StoryAutoReview = {
  status: CodexAutomaticApprovalReviewStatus;
  riskLevel?: CodexAutomaticApprovalReviewRiskLevel | null;
  rationale?: string | null;
};

function buildAutoReviewStoryItem(id: string, review: StoryAutoReview): CodexTranscriptEntry {
  return {
    threadId: "thread_tool_story",
    turnId: "turn_tool_story",
    itemId: `automatic-approval-review:${id}`,
    entryId: `automatic-approval-review:${id}`,
    type: "automaticApprovalReview",
    kind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: review.status === "inProgress" ? "inProgress" : "completed",
    markdownText: review.rationale ?? "",
    rawItem: {
      targetItemId: "tool-call-file-change-auto-review-states",
      review: {
        status: review.status,
        riskLevel: review.riskLevel ?? null,
        userAuthorization: "unknown",
        rationale: review.rationale ?? null,
      },
      action: null,
    },
    createdAt: 1,
    updatedAt: 1,
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

function AutoOpenAgentActivity({ block }: { block: ThreadAgentActivityGroupBlockModel }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const frameId = requestAnimationFrame(() => {
      root.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div ref={containerRef}>
      <ThreadAgentActivityGroupBlock
        block={block}
        isLatestTurn={false}
        isStreamingTurn={false}
        projectWorkspacePath="/workspace/nodex"
        threadCwd="/workspace/nodex"
      />
    </div>
  );
}

function ToolCallStory({
  item,
  title,
  description,
  autoOpen = false,
  autoExpandCommandLine = false,
  isTurnCancelled = false,
  isStreamingTurn = true,
  automaticApprovalReviews = [],
}: {
  item: CodexTranscriptEntry;
  title: string;
  description: string;
  autoOpen?: boolean;
  autoExpandCommandLine?: boolean;
  isTurnCancelled?: boolean;
  isStreamingTurn?: boolean;
  automaticApprovalReviews?: CodexTranscriptEntry[];
}) {
  const ToolComponent = getToolComponent(item);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoOpen && !autoExpandCommandLine) return;

    const root = containerRef.current;
    if (!root) return;

    let frameId = 0;
    let nestedFrameId = 0;

    const clickSummaryToggle = () => {
      const summaryToggle = root.querySelector<HTMLElement>(
        '[data-file-change-row-header], button[aria-expanded="false"], [data-command-tool-summary-toggle]',
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

  if (!ToolComponent) return null;

  return (
    <StorySurface title={title} description={description}>
      <ConversationStorySurface>
        <div ref={containerRef}>
          <ToolComponent
            item={item}
            projectWorkspacePath="/workspace/nodex"
            threadCwd="/workspace/nodex"
            isTurnCancelled={isTurnCancelled}
            isStreamingTurn={isStreamingTurn}
            automaticApprovalReviews={automaticApprovalReviews}
          />
        </div>
      </ConversationStorySurface>
    </StorySurface>
  );
}

function buildMixedAgentActivityStoryBlock(): ThreadAgentActivityGroupBlockModel {
  const readCommand = {
    ...THREAD_TOOL_CALL_STORY_ITEMS.command,
    itemId: "collapsed_story_explore",
    entryId: "collapsed_story_explore",
    command: "rg createElement|diffContainerRef|applyFileChangeGutters file-change-tool-call.tsx",
    commandActions: [
      {
        type: "search" as const,
        command: "rg createElement|diffContainerRef|applyFileChangeGutters file-change-tool-call.tsx",
        query: "createElement|diffContainerRef|applyFileChangeGutters",
        path: "file-change-tool-call.tsx",
      },
    ],
  };
  const commandItems = [
    "bun test src/renderer/features/local-conversation/view/shared/tools/file-change-tool-call.test.tsx",
    "bun test src/renderer/features/local-conversation/view/shared/turn-diff-surface.test.tsx",
    "bun run typecheck",
    "bun run lint",
  ].map((command, index) => ({
    ...THREAD_TOOL_CALL_STORY_ITEMS.command,
    itemId: `collapsed_story_cmd_${index + 1}`,
    entryId: `collapsed_story_cmd_${index + 1}`,
    command,
    commandActions: [],
    toolCall: {
      subtype: "command" as const,
      toolName: "exec_command",
      args: {},
      result: "ok",
    },
  }));
  const fileChanges: CodexFileChange[] = [
    {
      path: "src/renderer/features/local-conversation/view/shared/tools/file-change-tool-call.tsx",
      type: "update",
      movePath: null,
      unifiedDiff: [
        "@@ -1,1 +1,1 @@",
        "-with icon",
        "+without icon",
      ].join("\n"),
    },
    {
      path: "src/renderer/features/local-conversation/view/shared/turn-diff-surface.test.tsx",
      type: "update",
      movePath: null,
      unifiedDiff: [
        "@@ -1,1 +1,1 @@",
        "-old assertion",
        "+new assertion",
      ].join("\n"),
    },
    {
      path: "README.md",
      type: "update",
      movePath: null,
      unifiedDiff: [
        "@@ -1,1 +1,1 @@",
        "-Tool rows always show icons",
        "+Tool row icons are surface-specific",
      ].join("\n"),
    },
  ];
  const fileChangeItem: CodexTranscriptEntry = {
    ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
    itemId: "collapsed_story_file_change",
    entryId: "collapsed_story_file_change",
    fileChange: buildStoryFileChangePayload(fileChanges),
    toolCall: buildStoryFileChangeToolCall(fileChanges),
  };

  const entries: ThreadAgentActivityGroupEntryModel[] = [
    {
      id: readCommand.entryId ?? readCommand.itemId,
      turnId: "turn_tool_story",
      createdAt: 1,
      updatedAt: 1,
      searchableText: "Read ARCHITECTURE.md",
      type: "exec",
      entry: readCommand,
      status: "completed",
    },
    ...commandItems.map((entry) => ({
      id: entry.entryId ?? entry.itemId,
      turnId: entry.turnId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      searchableText: "",
      type: "exec" as const,
      entry,
      status: entry.status,
    })),
    {
      id: fileChangeItem.entryId ?? fileChangeItem.itemId,
      turnId: fileChangeItem.turnId,
      createdAt: fileChangeItem.createdAt,
      updatedAt: fileChangeItem.updatedAt,
      searchableText: "",
      type: "fileChange",
      entry: fileChangeItem,
      status: fileChangeItem.status,
    },
  ];

  return {
    id: "collapsed-activity-story",
    turnId: "turn_tool_story",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "Edited files, explored search, ran commands",
    type: "agentActivityGroup",
    summary: "Edited 3 files, explored 1 search, ran 4 commands",
    summaryParts: ["Edited 3 files", "explored 1 search", "ran 4 commands"],
    status: "completed",
    entries,
  };
}

function buildLiveFileChangeAgentActivityStoryBlock(lineCount = 85, itemId = "collapsed_story_live_file_change"): ThreadAgentActivityGroupBlockModel {
  const content = Array.from({ length: lineCount }, (_, index) => `Line ${index + 1}`).join("\n");
  const fileChangeItem: CodexTranscriptEntry = {
    ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
    itemId,
    entryId: itemId,
    status: "inProgress",
    fileChange: buildStoryFileChangePayload([{ type: "add", path: "poem.md", content }], null),
    toolCall: buildStoryFileChangeToolCall([{ type: "add", path: "poem.md", content }]),
  };

  return {
    id: "collapsed-activity-live-file-story",
    turnId: "turn_tool_story",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "Creating poem.md",
    type: "agentActivityGroup",
    summary: lineCount === 1 ? "Creating a file • writing a line" : `Creating a file • writing ${lineCount} lines`,
    summaryParts: [lineCount === 1 ? "Creating a file • writing a line" : `Creating a file • writing ${lineCount} lines`],
    status: "inProgress",
    summaryStats: {
      createdFileCount: 1,
      runningCreatedFileCount: 1,
      stoppedCreatedFileCount: 0,
      editedFileCount: 0,
      runningEditedFileCount: 0,
      deletedFileCount: 0,
      runningDeletedFileCount: 0,
      changedLineCount: lineCount,
      runningCreatedLineCount: lineCount,
      exploredFileCount: 0,
      runningExploredFileCount: 0,
      loadedToolCount: 0,
      runningLoadedToolCount: 0,
      searchCount: 0,
      runningSearchCount: 0,
      listCount: 0,
      runningListCount: 0,
      deniedRequestCount: 0,
      timedOutRequestCount: 0,
      hookCount: 0,
      runningHookCount: 0,
      commandCount: 0,
      runningCommandCount: 0,
      completedWebSearchCommandCount: 0,
      runningFolderCreationCommandCount: 0,
      runningWebSearchCommandCount: 0,
      mcpToolCallCount: 0,
      runningMcpToolCallCount: 0,
      mcpToolCallSources: [],
      webSearchCount: 0,
      runningWebSearchCount: 0,
    },
    runningSummary: {
      kind: "fileChange",
      key: itemId,
      label: "Creating",
      displayPath: "poem.md",
      additions: lineCount,
      deletions: 0,
    },
    entries: [{
      id: fileChangeItem.entryId ?? fileChangeItem.itemId,
      turnId: fileChangeItem.turnId,
      createdAt: fileChangeItem.createdAt,
      updatedAt: fileChangeItem.updatedAt,
      searchableText: "Creating poem.md",
      type: "fileChange",
      entry: fileChangeItem,
      status: fileChangeItem.status,
    }],
  };
}

function buildCompletedCurrentWebSearchAgentActivityStoryBlock(): ThreadAgentActivityGroupBlockModel {
  const webSearchItem = THREAD_TOOL_CALL_STORY_ITEMS.webSearch;
  const webSearchBlock = {
    id: webSearchItem.entryId ?? webSearchItem.itemId,
    turnId: webSearchItem.turnId,
    createdAt: webSearchItem.createdAt,
    updatedAt: webSearchItem.updatedAt,
    searchableText: webSearchItem.markdownText ?? "web search",
    type: "webSearch" as const,
    entry: webSearchItem,
    status: "completed" as const,
  };

  return {
    id: "collapsed-activity-completed-current-web-search",
    turnId: "turn_tool_story",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "completed current web search",
    type: "agentActivityGroup",
    summary: "Searched the web",
    summaryParts: ["Searched the web"],
    status: "completed",
    summaryStats: buildCollapsedSummaryStats({
      webSearchCount: 1,
      runningWebSearchCount: 0,
    }),
    runningSummary: null,
    continuitySummary: {
      kind: "text",
      key: "web-search:0",
      label: "Searching the web",
    },
    entries: [webSearchBlock],
  };
}

function buildThinkingOwnedAgentActivityStoryBlock(): ThreadAgentActivityGroupBlockModel {
  const commandItem = buildCommandItem({
    itemId: "collapsed-activity-thinking-command",
    entryId: "collapsed-activity-thinking-command",
    status: "completed",
    command: "pnpm test",
    aggregatedOutput: "Tests passed",
    exitCode: 0,
  });

  return {
    id: "collapsed-activity-thinking-owner",
    turnId: "turn_tool_story",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "Ran pnpm test",
    type: "agentActivityGroup",
    liveHeaderKind: "thinking",
    summary: "Ran a command",
    summaryParts: ["Ran a command"],
    status: "completed",
    summaryStats: buildCollapsedSummaryStats({ commandCount: 1 }),
    runningSummary: {
      kind: "text",
      key: "agent-activity-group:collapsed-activity-thinking-command:thinking",
      label: "Thinking",
    },
    entries: [{
      id: commandItem.entryId ?? commandItem.itemId,
      turnId: commandItem.turnId,
      createdAt: commandItem.createdAt,
      updatedAt: commandItem.updatedAt,
      searchableText: "pnpm test",
      type: "exec",
      entry: commandItem,
      status: commandItem.status,
    }],
  };
}

function buildLivePatchUpdateStoryItem(lineCount: number): CodexTranscriptEntry {
  const content = Array.from({ length: lineCount }, (_, index) => `Generated line ${index + 1}`).join("\n");
  const changes: CodexFileChange[] = [{ type: "add", path: "poem.md", content }];

  return {
    ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
    itemId: "tool-call-file-change-live-patch",
    entryId: "tool-call-file-change-live-patch",
    status: "inProgress",
    fileChange: buildStoryFileChangePayload(changes, null),
    toolCall: buildStoryFileChangeToolCall(changes),
  };
}

function FileChangeLivePatchUpdateStory() {
  const counts = [0, 1, 9, 10, 35, 85];
  const [countIndex, setCountIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountIndex((current) => (current + 1) % counts.length);
    }, 900);
    return () => window.clearInterval(interval);
  }, [counts.length]);

  return (
    <StorySurface
      title="File Change Live Patch Update"
      description="Live draft file edits appear as a single collapsed activity group immediately, then the header digit stack grows from +0 through +85."
    >
      <ConversationStorySurface>
        <ThreadAgentActivityGroupBlock
          block={buildLiveFileChangeAgentActivityStoryBlock(
            counts[countIndex] ?? 85,
            buildLivePatchUpdateStoryItem(counts[countIndex] ?? 85).itemId,
          )}
          isLatestTurn={true}
          isStreamingTurn={true}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </ConversationStorySurface>
    </StorySurface>
  );
}

function AutoOpenMcpToolCall({
  automaticApprovalReviews = [],
  item,
  rawDialogOpen = false,
}: {
  automaticApprovalReviews?: CodexTranscriptEntry[];
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
        <McpToolCall
          automaticApprovalReviews={automaticApprovalReviews}
          item={item}
          rawDialogOpen={rawDialogOpen}
        />
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

function buildTurnDiffItem(
  itemId: string,
  unifiedDiff: string,
  showRevertButton = false,
): CodexTranscriptEntry {
  return {
    ...THREAD_TOOL_CALL_STORY_ITEMS.turnDiff,
    itemId,
    entryId: itemId,
    rawItem: {
      type: "turn-diff",
      cwd: "/workspace/nodex",
      unifiedDiff,
      showRevertButton,
    },
  };
}

function buildStoryDiffFile(path: string, additions: number, deletions: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${Math.max(1, deletions)} +1,${Math.max(1, additions)} @@`,
    ...Array.from({ length: deletions }, (_, index) => `-export const removed${index} = ${index};`),
    ...Array.from({ length: additions }, (_, index) => `+export const added${index} = ${index};`),
  ].join("\n");
}

function buildDistributedTurnDiff(fileCount: number, additions: number, deletions: number): string {
  return Array.from({ length: fileCount }, (_, index) => {
    const addBase = Math.floor(additions / fileCount);
    const delBase = Math.floor(deletions / fileCount);
    const fileAdditions = addBase + (index < additions % fileCount ? 1 : 0);
    const fileDeletions = delBase + (index < deletions % fileCount ? 1 : 0);
    const suffix = String(index + 1).padStart(2, "0");
    return buildStoryDiffFile(`src/renderer/feature-${suffix}.tsx`, fileAdditions, fileDeletions);
  }).join("\n");
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

function DynamicToolQueryStoryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export const CommandExecution: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.command}
      title="Command Execution"
      description="Structured command summary, output body, and metadata for a settled command run."
    />
  ),
};

export const CommandExecutionSummarySpecials: Story = {
  render: () => {
    const items = [
      buildCommandItem({
        itemId: "tool-call-date-summary",
        entryId: "tool-call-date-summary",
        status: "completed",
        markdownText: "Checked the current date and time",
        command: "date -u",
        aggregatedOutput: "Sun Jul  5 10:24:00 UTC 2026\n",
        exitCode: 0,
      }),
      buildCommandItem({
        itemId: "tool-call-background-summary",
        entryId: "tool-call-background-summary",
        status: "inProgress",
        markdownText: "Started background terminal",
        command: "bun run dev",
        aggregatedOutput: "ready in 421ms\n",
        exitCode: null,
        processId: "4172",
      }),
      buildCommandItem({
        itemId: "tool-call-skill-script-summary",
        entryId: "tool-call-skill-script-summary",
        status: "inProgress",
        markdownText: "Started background terminal",
        command: "python .codex/skills/review-helper/scripts/check.py",
        aggregatedOutput: "review started\n",
        exitCode: null,
        processId: "4188",
      }),
    ];

    return (
      <StorySurface
        title="Command Execution Summary Specials"
        description="Date checks and background terminal commands use compact semantic summaries while the shell body stays manually expandable."
      >
        <ConversationStorySurface>
          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const ToolComponent = getToolComponent(item);
              if (!ToolComponent) return null;
              return (
                <ToolComponent
                  key={item.itemId}
                  item={item}
                  projectWorkspacePath="/workspace/nodex"
                  threadCwd="/workspace/nodex"
                  isStreamingTurn={item.processId == null}
                />
              );
            })}
          </div>
        </ConversationStorySurface>
      </StorySurface>
    );
  },
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

export const CommandExecutionStopped: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-stopped",
        entryId: "tool-call-stopped",
        status: "interrupted",
        command: "bun test",
        aggregatedOutput: "stopped by user\n",
        exitCode: null,
      }}
      title="Command Execution Stopped"
      description="Interrupted commands render the stopped footer state."
      autoOpen
    />
  ),
};

export const CommandExecutionUnknownExitCode: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-unknown-exit-code",
        entryId: "tool-call-unknown-exit-code",
        status: "failed",
        command: "bun test",
        aggregatedOutput: "process ended before an exit code was reported\n",
        exitCode: null,
      }}
      title="Command Execution Unknown Exit Code"
      description="Commands without a canonical exit code render the unknown-exit footer."
      autoOpen
    />
  ),
};

export const CommandExecutionTruncatedOutput: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...buildCommandItem(),
        itemId: "tool-call-truncated-output",
        entryId: "tool-call-truncated-output",
        status: "completed",
        command: "bun test",
        aggregatedOutput: [
          "[output truncated]",
          ...Array.from({ length: 32 }, (_, index) => `line ${String(index + 1).padStart(2, "0")}  pass`),
        ].join("\n"),
        exitCode: 0,
      }}
      title="Command Execution Truncated Output"
      description="Long shell output keeps the truncation prefix and uses the reversed scroll container."
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

export const FileChangeLivePatchUpdate: Story = {
  render: () => <FileChangeLivePatchUpdateStory />,
};

export const FileChangeVisualizationOnly: Story = {
  render: () => (
    <ToolCallStory
      item={{
        ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
        itemId: "tool-call-file-change-visualization-only",
        entryId: "tool-call-file-change-visualization-only",
        status: "inProgress",
        fileChange: {
          changes: {},
          visualizationActivities: [{
            path: "/workspace/nodex/.codex/visualizations/thread/chart.html",
            kind: "create",
          }],
          success: null,
        },
      }}
      title="File Change Visualization Only"
      description="Visualization-only patches retain the exact in-progress activity row even when no ordinary file paths remain."
    />
  ),
};

export const FileChangeSingleCompletedAgentActivity: Story = {
  render: () => {
    const item = buildStoryFileChangeItem({
      id: "tool-call-file-change-single-completed-collapsed",
      changes: [{
        path: "src/single.ts",
        type: "update",
        movePath: null,
        unifiedDiff: [
          "@@ -1 +1 @@",
          "-export const label = 'draft';",
          "+export const label = 'ready';",
        ].join("\n"),
      }],
    });

    return (
      <StorySurface
        title="File Change Single Completed Collapsed Activity"
        description="Single completed patch rows remain eligible for collapsed activity, matching the Codex thread activity grouping contract."
      >
        <ConversationStorySurface>
          <ThreadAgentActivityGroupBlock
            block={buildFileChangeAgentActivityBlock({
              id: "collapsed-file-change-single-completed",
              entries: [item],
              searchableText: "Edited src/single.ts",
              summary: "Edited a file",
              summaryStats: buildCollapsedSummaryStats({
                editedFileCount: 1,
                changedLineCount: 2,
              }),
            })}
            isLatestTurn={false}
            isStreamingTurn={false}
            projectWorkspacePath="/workspace/nodex"
            threadCwd="/workspace/nodex"
          />
        </ConversationStorySurface>
      </StorySurface>
    );
  },
};

export const FileChangeRepeatedSamePathAgentActivity: Story = {
  render: () => {
    const entries = Array.from({ length: 5 }, (_, index) => buildStoryFileChangeItem({
      id: `tool-call-file-change-same-path-${index + 1}`,
      changes: [{
        path: "src/repeated.ts",
        type: "update",
        movePath: null,
        unifiedDiff: [
          "@@ -1 +1 @@",
          `-export const revision = ${index};`,
          `+export const revision = ${index + 1};`,
        ].join("\n"),
      }],
    }));

    return (
      <StorySurface
        title="File Change Repeated Same Path"
        description="Critical regression fixture: repeated edits to the same display path summarize as Edited a file, not Edited 5 files."
      >
        <ConversationStorySurface>
          <ThreadAgentActivityGroupBlock
            block={buildFileChangeAgentActivityBlock({
              id: "collapsed-file-change-repeated-same-path",
              entries,
              searchableText: "Edited src/repeated.ts five times",
              summary: "Edited a file",
              summaryStats: buildCollapsedSummaryStats({
                editedFileCount: 1,
                changedLineCount: 10,
              }),
            })}
            isLatestTurn={false}
            isStreamingTurn={false}
            projectWorkspacePath="/workspace/nodex"
            threadCwd="/workspace/nodex"
          />
        </ConversationStorySurface>
      </StorySurface>
    );
  },
};

export const FileChangePendingApproval: Story = {
  render: () => (
    <ToolCallStory
      item={buildStoryFileChangeItem({
        id: "tool-call-file-change-pending-approval",
        status: "inProgress",
        approvalRequestId: "approval-file-change-story",
        changes: [{
          path: "src/pending.ts",
          type: "update",
          movePath: null,
          unifiedDiff: [
            "@@ -1 +1 @@",
            "-export const permission = 'old';",
            "+export const permission = 'pending';",
          ].join("\n"),
        }],
      })}
      title="File Change Pending Approval"
      description="Pending file-change approvals omit the action word in the row header and use the short diff frame height."
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

export const FileChangeStoppedUpdate: Story = {
  render: () => (
    <ToolCallStory
      item={buildStoryFileChangeItem({
        id: "tool-call-file-change-stopped-update",
        status: "inProgress",
        changes: [{
          path: "src/stopped-update.ts",
          type: "update",
          movePath: null,
          unifiedDiff: [
            "@@ -1 +1 @@",
            "-export const stopped = false;",
            "+export const stopped = true;",
          ].join("\n"),
        }],
      })}
      title="File Change Stopped Update"
      description="Interrupted update rows use stopped editing copy while preserving the ordinary expanded diff body."
      autoOpen
      isTurnCancelled
    />
  ),
};

export const FileChangeStoppedDelete: Story = {
  render: () => (
    <ToolCallStory
      item={buildStoryFileChangeItem({
        id: "tool-call-file-change-stopped-delete",
        status: "inProgress",
        changes: [{
          path: "src/stopped-delete.ts",
          type: "delete",
          content: "export const removed = true;\n",
        }],
      })}
      title="File Change Stopped Delete"
      description="Interrupted delete rows use stopped deleting copy and keep the semantic delete fallback body available when expanded."
      autoOpen
      isTurnCancelled
    />
  ),
};

export const FileChangeDeclinedRename: Story = {
  render: () => (
    <ToolCallStory
      item={(() => {
        const changes: CodexFileChange[] = [
          {
            path: "src/original.ts",
            type: "update",
            movePath: "src/renamed.ts",
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
          fileChange: buildStoryFileChangePayload(changes, false),
          toolCall: buildStoryFileChangeToolCall(changes),
        };
      })()}
      title="File Change Declined Rename"
      description="Rejected file edits preserve rename metadata in the renderer and match Codex Electron's plain rejected summary label."
      autoOpen
    />
  ),
};

export const FileChangeAutoReviewStates: Story = {
  render: () => (
    <ToolCallStory
      item={buildStoryFileChangeItem({
        id: "tool-call-file-change-auto-review-states",
        changes: [{
          path: "src/auto-review.ts",
          type: "update",
          movePath: null,
          unifiedDiff: [
            "@@ -1 +1 @@",
            "-export const autoReview = 'old';",
            "+export const autoReview = 'new';",
          ].join("\n"),
        }],
      })}
      title="File Change Auto Review States"
      description="Attached auto-review rows use the shared compact Auto-review wording for approved, high-risk denied, and timed-out reviews."
      autoOpen
      automaticApprovalReviews={[
        buildAutoReviewStoryItem("approved", {
          status: "approved",
          riskLevel: "low",
          rationale: "This change stays inside the project workspace.",
        }),
        buildAutoReviewStoryItem("denied-high-risk", {
          status: "denied",
          riskLevel: "high",
          rationale: "This request attempted to edit a protected path.",
        }),
        buildAutoReviewStoryItem("timed-out", {
          status: "timedOut",
          riskLevel: null,
          rationale: null,
        }),
      ]}
    />
  ),
};

export const FileChangeStoppedAutoReview: Story = {
  render: () => (
    <ToolCallStory
      item={(() => {
        const changes: CodexFileChange[] = [
          {
            path: "src/stopped.ts",
            type: "add",
            content: "export const stopped = true;\n",
          },
        ];

        return {
          ...THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
          itemId: "tool-call-file-change-stopped-auto-review",
          entryId: "tool-call-file-change-stopped-auto-review",
          status: "inProgress",
          fileChange: buildStoryFileChangePayload(changes, null),
          toolCall: buildStoryFileChangeToolCall(changes),
        };
      })()}
      title="File Change Stopped With Auto Review"
      description="Interrupted turns render stopped patch copy while attached automatic approval reviews stay inside the patch row."
      autoOpen
      isTurnCancelled
      automaticApprovalReviews={[{
        threadId: "thread_tool_story",
        turnId: "turn_tool_story",
        itemId: "automatic-approval-review:story",
        entryId: "automatic-approval-review:story",
        type: "automaticApprovalReview",
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        markdownText: "This generated edit touched a protected file.",
        rawItem: {
          targetItemId: "tool-call-file-change-stopped-auto-review",
          review: {
            status: "denied",
            riskLevel: "high",
            userAuthorization: "unknown",
            rationale: "This generated edit touched a protected file.",
          },
          action: null,
        },
        createdAt: 1,
        updatedAt: 1,
      }]}
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
          onOpenReview={() => undefined}
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
          onOpenReview={() => undefined}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffMultiFileCompleted: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff Edited 12 Files"
      description="Completed turn-diff payload matching the Codex Electron edited-files fixture: 12 files, three visible rows, and Show 9 more files."
    >
      <ConversationStorySurface>
        <TurnDiffSurface
          item={buildTurnDiffItem("turn-diff-multi-file", buildDistributedTurnDiff(12, 467, 348))}
          isInProgress={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
          onOpenReview={() => undefined}
          onOpenFileInSidePanel={() => undefined}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffSingleFile: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff Single File"
      description="Single-file turn-diff card uses the basename in the title and omits the multi-file list."
    >
      <ConversationStorySurface>
        <TurnDiffSurface
          item={buildTurnDiffItem("turn-diff-single-file", buildStoryDiffFile("src/renderer/single-file.tsx", 4, 2))}
          isInProgress={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
          onOpenReview={() => undefined}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffLargeDiffFallback: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff Large Diff Fallback"
      description="Inline rendering switches to the large-diff fallback once the Codex threshold estimate exceeds 5000 lines."
    >
      <ConversationStorySurface>
        <TurnDiffSurface
          item={buildTurnDiffItem("turn-diff-large", [
            "diff --git a/src/large.ts b/src/large.ts",
            "--- a/src/large.ts",
            "+++ b/src/large.ts",
            "@@ -1,5200 +1,5200 @@",
            ...Array.from({ length: 5201 }, (_, index) => `+export const value${index} = ${index};`),
            buildStoryDiffFile("src/small.ts", 2, 1),
          ].join("\n"))}
          isInProgress={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
          onOpenReview={() => undefined}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffPatchFailure: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff Patch Failure"
      description="Failure dialog shown when Undo/Reapply cannot apply every path cleanly."
    >
      <ConversationStorySurface>
        <TurnDiffPatchFailureDialog
          failure={{
            action: "undo",
            result: {
              status: "error",
              appliedPaths: ["src/applied.ts"],
              skippedPaths: ["src/skipped.ts"],
              conflictedPaths: ["src/conflict.ts"],
              errorCode: "applyFailed",
              errorMessage: "patch failed",
            },
          }}
          onClose={() => undefined}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TurnDiffInProgress: Story = {
  render: () => (
    <StorySurface
      title="Turn Diff In Progress"
      description="Streaming turn-diff summary used above the composer while Codex is still working."
    >
      <ConversationStorySurface>
        <TurnDiffSurface
          item={buildTurnDiffItem("turn-diff-in-progress", buildDistributedTurnDiff(4, 34, 18))}
          isInProgress
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
          onOpenReview={() => undefined}
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

export const ToolCallIconography: Story = {
  render: () => (
    <StorySurface
      title="Tool Call Iconography"
      description="Licensed Codex tool glyphs shown with the thread row sizing and muted token contract."
    >
      <ConversationStorySurface>
        <div className="flex flex-col gap-2 text-size-chat text-token-description-foreground">
          {[
            "run-command",
            "edit-files",
            "web-search",
            "code-searching",
            "list-files",
            "approved",
            "denied",
            "skill",
            "browser-use",
            "computer-use",
            "plugin",
            "connector",
          ].map((icon) => (
            <div key={icon} className="flex items-center gap-2">
              <ToolActivityIcon descriptor={semanticToolIcon(icon as Parameters<typeof semanticToolIcon>[0])} />
              <span>{icon}</span>
            </div>
          ))}
        </div>
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const WebSearchInProgress: Story = {
  render: () => (
    <ToolCallStory
      item={THREAD_TOOL_CALL_STORY_ITEMS.webSearchInProgress}
      title="Web Search In Progress"
      description="Running web searches shimmer only the top-level active phrase while the detail text remains static."
    />
  ),
};

export const WebSearchCompletedCurrentAgentActivity: Story = {
  render: () => (
    <StorySurface
      title="Web Search Completed Current Collapsed Activity"
      description="Latest streaming collapsed activity with a completed web search settles immediately instead of shimmering until the turn ends."
    >
      <ConversationStorySurface>
        <ThreadAgentActivityGroupBlock
          block={buildCompletedCurrentWebSearchAgentActivityStoryBlock()}
          isLatestTurn
          isStreamingTurn
        />
      </ConversationStorySurface>
    </StorySurface>
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

export const McpAppInfoSourceLogo: Story = {
  render: () => (
    <StorySurface
      title="MCP AppInfo Source Logo"
      description="Late normalized AppInfo supplies the exact square light/dark source assets without changing transcript state."
    >
      <ThreadMcpAppsProvider apps={MCP_APP_INFO_STORY_APPS}>
        <McpToolCall item={buildMcpAppInfoStoryItem("mcp-app-info-source")} />
      </ThreadMcpAppsProvider>
    </StorySurface>
  ),
};

export const McpBrowserSource: Story = {
  render: () => (
    <StorySurface
      title="MCP Browser Source"
      description="Canonical browser-use source metadata selects the browser glyph and source-specific completed label."
    >
      <McpToolCall
        item={buildMcpSourceStoryItem("mcp-browser-source", { kind: "browserUse", backend: "iab" })}
      />
    </StorySurface>
  ),
};

export const McpChromeBrowserSource: Story = {
  render: () => (
    <StorySurface
      title="MCP Chrome Browser Source"
      description="Chrome browser-use activity uses the exact embedded source identity asset while remaining distinct from native Chrome computer use."
    >
      <McpToolCall
        item={buildMcpSourceStoryItem("mcp-chrome-browser-source", { kind: "browserUse", backend: "chrome" })}
      />
    </StorySurface>
  ),
};

export const McpComputerSource: Story = {
  render: () => (
    <StorySurface
      title="MCP Computer Source"
      description="Canonical computer-use source metadata selects the dedicated computer-use glyph."
    >
      <McpToolCall
        item={buildMcpSourceStoryItem("mcp-computer-source", { kind: "computerUse", app: null })}
      />
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

export const McpToolCallAppWithAutoReview: Story = {
  render: () => (
    <StorySurface
      title="MCP App With Auto-review"
      description="Attached auto-review rows in the MCP app/card branch render as title-only rows before the app surface."
    >
      <AutoOpenMcpToolCall
        automaticApprovalReviews={[
          buildAutoReviewStoryItem("mcp-app-approved", {
            status: "approved",
            riskLevel: "low",
            rationale: "Only connector UI data is being displayed.",
          }),
        ]}
        item={{
          ...THREAD_TOOL_CALL_STORY_ITEMS.mcp,
          mcpToolCall: THREAD_TOOL_CALL_STORY_ITEMS.mcp.mcpToolCall
            ? {
                ...THREAD_TOOL_CALL_STORY_ITEMS.mcp.mcpToolCall,
                mcpAppResourceUri: "ui://context7/docs",
                result: {
                  type: "success",
                  content: [],
                  structuredContent: null,
                  raw: {
                    content: [],
                    structuredContent: null,
                    _meta: null,
                  },
                },
              }
            : THREAD_TOOL_CALL_STORY_ITEMS.mcp.mcpToolCall,
        }}
      />
    </StorySurface>
  ),
};

export const McpToolCallInProgress: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call In Progress"
      description="In-progress MCP calls stay collapsed and shimmer only the label text; source logos remain static."
    >
      <McpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpInProgress} />
    </StorySurface>
  ),
};

export const McpToolCallInProgressWithResult: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call In Progress With Result"
      description="In-progress MCP calls become expandable as soon as a result exists, matching the standalone disclosure boundary."
    >
      <McpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpInProgressWithResult} />
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
      description="Structured-only success renders the JSON panel directly without the no-content fallback."
    >
      <AutoOpenMcpToolCall item={THREAD_TOOL_CALL_STORY_ITEMS.mcpQueryDocs} />
    </StorySurface>
  ),
};

export const McpToolCallRareContentBlocks: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call Rare Content Blocks"
      description="Exact cJn coverage for annotated text, resource links, embedded resources, image data, and audio data in one expanded successful result."
    >
      <AutoOpenMcpToolCall
        item={buildMcpResultStoryItem("mcp-rare-content-blocks", {
          type: "success",
          content: MCP_RARE_CONTENT_BLOCKS,
          structuredContent: null,
          raw: {
            content: JSON.parse(JSON.stringify(MCP_RARE_CONTENT_BLOCKS)),
            structuredContent: null,
            _meta: null,
          },
        })}
      />
    </StorySurface>
  ),
};

export const McpToolCallNoContent: Story = {
  render: () => (
    <StorySurface
      title="MCP Tool Call No Content"
      description="A completed success with no content and no structured payload reaches the exact Tool returned no content fallback."
    >
      <AutoOpenMcpToolCall
        item={buildMcpResultStoryItem("mcp-no-content", {
          type: "success",
          content: [],
          structuredContent: null,
          raw: { content: [], structuredContent: null, _meta: null },
        })}
      />
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

export const AgentActivityGroup: Story = {
  render: () => (
    <StorySurface
      title="Collapsed Activity Group"
      description="Codex-style grouped activity row preserves original tool units inside a flat Motion body."
    >
      <ConversationStorySurface>
        <ThreadAgentActivityGroupBlock
          block={buildMixedAgentActivityStoryBlock()}
          isLatestTurn={false}
          isStreamingTurn={false}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const AgentActivityGroupExpanded: Story = {
  render: () => (
    <StorySurface
      title="Collapsed Activity Group Expanded"
      description="Expanded Codex-style activity groups show direct read, web, and muted command rows without nested subgroup headers."
    >
      <ConversationStorySurface>
        <AutoOpenAgentActivity block={buildMixedAgentActivityStoryBlock()} />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const AgentActivityGroupLiveFileChange: Story = {
  render: () => (
    <StorySurface
      title="Collapsed Activity Group Live File Change"
      description="Matches Codex Electron's live patchUpdated fixture: a single in-progress file edit owns the collapsed activity header and animated +85/-0 digit stack."
    >
      <ConversationStorySurface>
        <ThreadAgentActivityGroupBlock
          block={buildLiveFileChangeAgentActivityStoryBlock()}
          isLatestTurn={true}
          isStreamingTurn={true}
          projectWorkspacePath="/workspace/nodex"
          threadCwd="/workspace/nodex"
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const AgentActivityGroupOwnsThinking: Story = {
  render: () => (
    <StorySurface
      title="Collapsed Activity Group Owns Thinking"
      description="The latest open activity group carries the live Thinking fallback in its header without adding a second transcript row."
    >
      <ConversationStorySurface>
        <ThreadAgentActivityGroupBlock
          block={buildThinkingOwnedAgentActivityStoryBlock()}
          isLatestTurn={true}
          isStreamingTurn={true}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

function buildReadThreadDynamicStoryItem(): CodexTranscriptEntry {
  return {
    threadId: "thread-story",
    turnId: "turn-story",
    itemId: "dynamic-read-thread",
    entryId: "dynamic-read-thread",
    type: "dynamicToolCall",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    toolCall: {
      subtype: "dynamic",
      toolName: "read_thread",
      server: "codex_app",
      args: { threadId: "thread-story", turnLimit: 2 },
      result: [{ type: "inputText", text: "{\"schemaVersion\":1}" }],
    },
    dynamicToolCall: {
      callId: "dynamic-read-thread",
      namespace: "codex_app",
      tool: "read_thread",
      arguments: { threadId: "thread-story", turnLimit: 2 },
      status: "completed",
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          schemaVersion: 1,
          thread: { id: "thread-story", title: "Parity research", cwd: "/workspace/nodex" },
          page: { order: "newest_first", limit: 2, nextCursor: null, hasMore: false },
          turns: [],
        }),
      }],
      success: true,
      durationMs: 18,
      completed: true,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildCodexAppMetaDynamicStoryItem(input: {
  id: string;
  tool: string;
  completed: boolean;
  success?: boolean | null;
  args?: unknown;
  contentText?: string;
}): CodexTranscriptEntry {
  return {
    ...buildReadThreadDynamicStoryItem(),
    itemId: input.id,
    entryId: input.id,
    status: input.completed ? "completed" : "inProgress",
    toolCall: {
      subtype: "dynamic",
      toolName: input.tool,
      server: "codex_app",
      args: input.args ?? {},
      result: input.contentText ? [{ type: "inputText", text: input.contentText }] : undefined,
    },
    dynamicToolCall: {
      callId: input.id,
      namespace: "codex_app",
      tool: input.tool,
      arguments: input.args ?? {},
      status: input.completed ? "completed" : "inProgress",
      contentItems: input.contentText ? [{ type: "inputText", text: input.contentText }] : null,
      success: input.success ?? (input.completed ? true : null),
      durationMs: input.completed ? 18 : null,
      completed: input.completed,
    },
  };
}

function buildGenericDynamicStoryItem(input: {
  id: string;
  namespace: string;
  tool: string;
  completed: boolean;
  args?: unknown;
  contentText?: string;
}): CodexTranscriptEntry {
  return {
    ...buildReadThreadDynamicStoryItem(),
    itemId: input.id,
    entryId: input.id,
    status: input.completed ? "completed" : "inProgress",
    toolCall: {
      subtype: "dynamic",
      toolName: input.tool,
      server: input.namespace,
      args: input.args ?? {},
      result: input.contentText ? [{ type: "inputText", text: input.contentText }] : undefined,
    },
    dynamicToolCall: {
      callId: input.id,
      namespace: input.namespace,
      tool: input.tool,
      arguments: input.args ?? {},
      status: input.completed ? "completed" : "inProgress",
      contentItems: input.contentText ? [{ type: "inputText", text: input.contentText }] : null,
      success: input.completed ? true : null,
      durationMs: input.completed ? 18 : null,
      completed: input.completed,
    },
  };
}

export const DynamicToolCallReadThread: Story = {
  render: () => (
    <StorySurface
      title="Dynamic Tool Call Read Thread"
      description="Codex app-server dynamic thread tools render as compact Codex rows."
    >
      <ConversationStorySurface>
        <DynamicToolCall item={buildReadThreadDynamicStoryItem()} />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const CodexAppMetaThreadTools: Story = {
  render: () => (
    <StorySurface
      title="Codex App Meta Thread Tools"
      description="Parity fixture for codex_app thread control rows and create-thread success cards."
    >
      <ConversationStorySurface>
        <div className="flex flex-col gap-1">
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "create-active",
            tool: "create_thread",
            completed: false,
            args: { prompt: "Background follow-up", target: { type: "projectless" } },
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "create-completed",
            tool: "create_thread",
            completed: true,
            args: { prompt: "Background follow-up", target: { type: "projectless" } },
            contentText: "{\"threadId\":\"thread-created\"}",
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "create-worktree",
            tool: "create_thread",
            completed: true,
            args: {
              prompt: "Worktree follow-up",
              target: { type: "project", projectId: "project-1", environment: { type: "worktree" } },
            },
            contentText: "{\"clientThreadId\":\"client-new-thread:11111111-1111-4111-8111-111111111111\"}",
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "fork-worktree",
            tool: "fork_thread",
            completed: false,
            args: { environment: { type: "worktree" } },
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "list-threads",
            tool: "list_threads",
            completed: false,
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "read-thread",
            tool: "read_thread",
            completed: true,
            args: { threadId: "thread-story" },
          })} onOpenThread={() => {}} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "send-thread",
            tool: "send_message_to_thread",
            completed: true,
            args: { threadId: "thread-story" },
          })} onOpenThread={() => {}} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "handoff-status",
            tool: "get_handoff_status",
            completed: true,
            args: { operationId: "handoff-1" },
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "pin-thread",
            tool: "set_thread_pinned",
            completed: true,
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "archive-thread",
            tool: "set_thread_archived",
            completed: false,
          })} />
          <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
            id: "title-thread",
            tool: "set_thread_title",
            completed: true,
          })} />
        </div>
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const DynamicToolRegistryRenderers: Story = {
  render: () => (
    <StorySurface
      title="Dynamic Tool Registry Renderers"
      description="Non-thread registry renderers use their registered labels and icons instead of generic humanized fallback rows."
    >
      <ConversationStorySurface>
        <div className="flex flex-col gap-1">
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "settings-read-active",
            namespace: "codex_app",
            tool: "read_settings",
            completed: false,
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "settings-write-completed",
            namespace: "codex_app",
            tool: "write_settings",
            completed: true,
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "chrome-tab-context-active",
            namespace: "chrome_extension",
            tool: "get_tab_context",
            completed: false,
            args: { tabId: 8 },
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "chrome-tab-context-invalid",
            namespace: "chrome_extension",
            tool: "get_tab_context",
            completed: true,
            args: { tabId: -1 },
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "handoff-running-steps",
            namespace: "codex_app",
            tool: "handoff_thread",
            completed: true,
            args: { threadId: "thread-story" },
            contentText: JSON.stringify({
              destinationHostDisplayName: "Local",
              operationId: "handoff-running-steps",
              status: "running",
              steps: [
                { id: "resolve-thread", label: "Resolve thread", status: "success", message: null },
                { id: "handoff", label: "Move thread", status: "running", message: "Preparing thread handoff." },
              ],
            }),
          })} />
        </div>
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const DynamicToolCallFallbackRows: Story = {
  render: () => (
    <StorySurface
      title="Dynamic Tool Call Fallback Rows"
      description="Generic dynamic tools render as compact rows without result or argument panels."
    >
      <ConversationStorySurface>
        <div className="flex flex-col gap-1">
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "fallback-load-workspace-dependencies",
            namespace: "codex_app",
            tool: "load_workspace_dependencies",
            completed: true,
            args: { includeLibraries: true },
            contentText: "{\"node\":\"/tmp/node\"}",
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "fallback-automation-update",
            namespace: "codex_app",
            tool: "automation_update",
            completed: false,
            args: { action: "install" },
          })} />
          <DynamicToolCall item={buildGenericDynamicStoryItem({
            id: "fallback-external-tool",
            namespace: "example_connector",
            tool: "inspect_project_graph",
            completed: true,
            args: { depth: 2 },
            contentText: "done",
          })} />
        </div>
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const DynamicToolCallAutomationUpdateCards: Story = {
  render: () => (
    <StorySurface
      title="Dynamic Tool Call Automation Update Cards"
      description="automation_update calls render Scheduled task cards with proposal and saved states."
    >
      <ConversationStorySurface>
        <DynamicToolQueryStoryProvider>
          <div className="flex flex-col gap-2">
            <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
              id: "automation-suggested-create",
              tool: "automation_update",
              completed: true,
              args: {
                mode: "suggested_create",
                kind: "cron",
                status: "ACTIVE",
                name: "Review release notes",
                prompt: "Review release notes and summarize risks.",
                rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                cwds: "/Users/asc/repo/nodex",
                executionEnvironment: "worktree",
                localEnvironmentConfigPath: null,
                model: "gpt-5-codex",
                reasoningEffort: "medium",
              },
            })} />
            <DynamicToolCall item={buildCodexAppMetaDynamicStoryItem({
              id: "automation-suggested-update",
              tool: "automation_update",
              completed: true,
              args: {
                mode: "suggested_update",
                id: "automation-standup",
                kind: "cron",
                status: "ACTIVE",
                name: "Morning standup",
                prompt: "Summarize overnight changes and blockers.",
                rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
                cwds: ["/Users/asc/repo/nodex"],
                executionEnvironment: "worktree",
                localEnvironmentConfigPath: null,
                model: "gpt-5-codex",
                reasoningEffort: "medium",
              },
            })} />
            <DynamicToolCall
              item={buildCodexAppMetaDynamicStoryItem({
                id: "automation-created",
                tool: "automation_update",
                completed: true,
                args: {
                  mode: "create",
                  kind: "cron",
                  status: "ACTIVE",
                  name: "Release notes",
                  prompt: "Review release notes.",
                  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                  cwds: ["/Users/asc/repo/nodex"],
                  executionEnvironment: "worktree",
                  localEnvironmentConfigPath: null,
                  model: "gpt-5-codex",
                  reasoningEffort: "medium",
                },
                contentText: "{\"automationId\":\"automation-release\",\"mode\":\"create\"}",
              })}
              onOpenSummaryScheduledAutomation={() => undefined}
            />
          </div>
        </DynamicToolQueryStoryProvider>
      </ConversationStorySurface>
    </StorySurface>
  ),
};

function CrossThemeLeafMatrixRow({
  children,
  family,
}: {
  children: ReactNode;
  family: string;
}) {
  return (
    <section
      className="border-t-[0.5px] border-token-border py-3 first:border-t-0"
      data-cross-theme-leaf-family={family}
    >
      <div className="mb-1.5 text-xs font-medium text-token-description-foreground">
        {family}
      </div>
      {children}
    </section>
  );
}

function AutoOpenCrossThemeToolLeaf({ item }: { item: CodexTranscriptEntry }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ToolComponent = getToolComponent(item);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const frameId = window.requestAnimationFrame(() => {
      const disclosure = root.querySelector<HTMLElement>(
        'button[aria-expanded="false"], [data-file-change-row-header]',
      );
      disclosure?.click();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  if (!ToolComponent) return null;

  return (
    <div ref={containerRef}>
      <ToolComponent
        item={item}
        projectWorkspacePath="/workspace/nodex"
        threadCwd="/workspace/nodex"
        isStreamingTurn={false}
      />
    </div>
  );
}

function CrossThemeLeafBodyMatrix() {
  const createdTask = buildCodexAppMetaDynamicStoryItem({
    id: "cross-theme-created-task",
    tool: "create_thread",
    completed: true,
    args: { prompt: "Review the parity evidence", target: { type: "projectless" } },
    contentText: '{"threadId":"thread-cross-theme"}',
  });

  return (
    <main
      className="min-h-screen bg-(--background) text-(--foreground)"
      data-testid="cross-theme-leaf-body-matrix"
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-2">
          <h1 className="text-sm font-medium">Tool activity leaf-body matrix</h1>
          <p className="mt-0.5 text-xs text-token-description-foreground">
            Switch the Storybook theme between Light and Dark to review the core groupable families on the production renderer.
          </p>
        </header>

        <ConversationStorySurface>
          <CrossThemeLeafMatrixRow family="Activity group body">
            <AutoOpenAgentActivity block={buildMixedAgentActivityStoryBlock()} />
          </CrossThemeLeafMatrixRow>

          <CrossThemeLeafMatrixRow family="Command output">
            <AutoOpenCrossThemeToolLeaf
              item={buildCommandItem({
                itemId: "cross-theme-command-output",
                entryId: "cross-theme-command-output",
                command: "pnpm test --runInBand",
                commandActions: [],
                aggregatedOutput: "Test Files  42 passed\nTests  317 passed\n",
                exitCode: 0,
                durationMs: 2_400,
              })}
            />
          </CrossThemeLeafMatrixRow>

          <CrossThemeLeafMatrixRow family="File change diff">
            <AutoOpenCrossThemeToolLeaf item={THREAD_TOOL_CALL_STORY_ITEMS.fileChange} />
          </CrossThemeLeafMatrixRow>

          <CrossThemeLeafMatrixRow family="Web search (summary-only by bundle)">
            <AutoOpenCrossThemeToolLeaf item={THREAD_TOOL_CALL_STORY_ITEMS.webSearch} />
          </CrossThemeLeafMatrixRow>

          <CrossThemeLeafMatrixRow family="MCP result and raw-output affordance">
            <AutoOpenCrossThemeToolLeaf item={THREAD_TOOL_CALL_STORY_ITEMS.mcp} />
          </CrossThemeLeafMatrixRow>

          <CrossThemeLeafMatrixRow family="Dynamic summary rows and resource cards">
            <div className="flex flex-col gap-1">
              <DynamicToolCall item={buildReadThreadDynamicStoryItem()} />
              <DynamicToolCall item={createdTask} />
            </div>
          </CrossThemeLeafMatrixRow>
        </ConversationStorySurface>
      </div>
    </main>
  );
}

export const CrossThemeLeafBodies: Story = {
  render: () => <CrossThemeLeafBodyMatrix />,
  parameters: {
    docs: {
      description: {
        story:
          "One production-renderer canvas for light/dark screenshot review of the group, command, patch, web, MCP, and dynamic leaf bodies.",
      },
    },
  },
};
