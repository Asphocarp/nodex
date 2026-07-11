import { describe, expect, test } from "vitest";
import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
import { buildTurnRenderModel } from "./build-turn-render-model";

const LIVE_DIFF = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,3 @@",
  "-old",
  "+new",
  "+next",
].join("\n");

function buildTurn(overrides: Partial<CodexConversationTurn> = {}): CodexConversationTurn {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "inProgress",
    itemIds: [],
    items: [],
    ...overrides,
  };
}

function buildTurnDiffItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "turn-diff:turn_1",
    entryId: "turn-diff:turn_1",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "inProgress",
    rawItem: {
      type: "turn-diff",
      unifiedDiff: LIVE_DIFF,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildFileChangeItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "patch_live",
    entryId: "patch_live",
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    status: "inProgress",
    fileChange: {
      changes: buildCodexFileChangeMap([{
        type: "add",
        path: "src/app.ts",
        content: "new",
      }]),
      label: "Created src/app.ts",
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildUserItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "user_1",
    entryId: "user_1",
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: "Run the checks",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildExecItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "exec_1",
    entryId: "exec_1",
    type: "command_execution",
    kind: "commandExecution",
    semanticKind: "exec",
    status: "inProgress",
    commandActions: [{ type: "unknown", command: "bun test" }],
    toolCall: {
      subtype: "command",
      toolName: "exec_command",
      args: {},
    },
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function buildDynamicToolItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "dynamic_1",
    entryId: "dynamic_1",
    type: "dynamic_tool_call",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "inProgress",
    dynamicToolCall: {
      callId: "dynamic_1",
      namespace: "codex_app",
      tool: "read_thread",
      arguments: { threadId: "thread_child" },
      status: "inProgress",
      contentItems: null,
      success: null,
      durationMs: null,
      completed: false,
    },
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function buildMcpToolItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "mcp_1",
    entryId: "mcp_1",
    type: "mcp_tool_call",
    kind: "toolCall",
    semanticKind: "mcpToolCall",
    status: "inProgress",
    mcpToolCall: {
      callId: "mcp_1",
      functionName: "browser-use__click",
      invocation: { server: "browser-use", tool: "click", arguments: {} },
      result: null,
      durationMs: null,
      completed: false,
    },
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function buildAssistantItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "assistant_1",
    entryId: "assistant_1",
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    assistantPhase: "final_answer",
    role: "assistant",
    markdownText: "Done",
    status: "completed",
    createdAt: 5,
    updatedAt: 5,
    ...overrides,
  };
}

describe("buildTurnRenderModel", () => {
  test("derives live turn-diff from turn.diff before any fileChange item exists", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({ diff: LIVE_DIFF, itemIds: [], items: [] }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.type).join(",") ?? "").toBe("turnDiff");
    expect(model.blocks.map((block) => block.type).join(",")).toBe("thinkingPlaceholder");
    expect(model.searchableText.includes("+next")).toBe(false);
    const rawItem = model.aboveComposerBlocks?.[0]?.type === "turnDiff"
      ? model.aboveComposerBlocks[0].entry.rawItem as { unifiedDiff?: unknown } | undefined
      : null;
    expect(String(rawItem?.unifiedDiff ?? "").includes("+next")).toBe(true);
  });

  test("keeps an addressable search unit for empty user messages", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        itemIds: ["user_empty", "assistant_1"],
        items: [
          buildUserItem({ markdownText: "", itemId: "user_empty", entryId: "user_empty" }),
          buildAssistantItem(),
        ],
      }),
      requests: [],
      isLatestTurn: false,
      isStreamingTurn: false,
    });

    expect(model.searchUnits.map((unit) => `${unit.blockType}:${unit.key}:${unit.text}`).join(",")).toBe(
      "userMessage:turn_1:user:0:,assistantMessage:turn_1:assistant:Done",
    );
    expect(model.searchUnits.filter((unit) => unit.text.toLowerCase().includes("missing")).length).toBe(0);
  });

  test("does not index tool-call body text in conversation search units", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        itemIds: ["user_1", "exec_1", "patch_live", "mcp_1", "dynamic_1", "assistant_1"],
        items: [
          buildUserItem({ markdownText: "Refactor the renderer" }),
          buildExecItem({
            status: "completed",
            command: "bun test",
            aggregatedOutput: "HIDDEN_EXEC_OUTPUT",
            markdownText: "HIDDEN_EXEC_MARKDOWN",
          }),
          buildFileChangeItem({
            status: "completed",
            fileChange: {
              changes: buildCodexFileChangeMap([{
                type: "add",
                path: "src/hidden-file.ts",
                content: "HIDDEN_PATCH_BODY",
              }]),
              label: "HIDDEN_PATCH_LABEL",
            },
          }),
          buildMcpToolItem({
            status: "completed",
            mcpToolCall: {
              callId: "mcp_1",
              functionName: "docs__search",
              invocation: { server: "docs", tool: "search", arguments: { query: "HIDDEN_MCP_QUERY" } },
              result: {
                type: "success",
                content: [{ type: "text", text: "HIDDEN_MCP_RESULT" }],
                structuredContent: null,
                raw: {
                  content: [{ type: "text", text: "HIDDEN_MCP_RESULT" }],
                  structuredContent: null,
                },
              },
              durationMs: 100,
              completed: true,
            },
          }),
          buildDynamicToolItem({
            status: "completed",
            dynamicToolCall: {
              callId: "dynamic_1",
              namespace: "codex_app",
              tool: "read_thread",
              arguments: { threadId: "HIDDEN_DYNAMIC_THREAD" },
              status: "completed",
              contentItems: [{ type: "inputText", text: "HIDDEN_DYNAMIC_RESULT" }],
              success: true,
              durationMs: 100,
              completed: true,
            },
          }),
          buildAssistantItem({ markdownText: "Done" }),
        ],
      }),
      requests: [],
      isLatestTurn: false,
      isStreamingTurn: false,
    });

    const indexedText = model.searchUnits.map((unit) => unit.text).join("\n");
    expect(model.searchUnits.map((unit) => `${unit.blockType}:${unit.key}`).join(",")).toBe(
      "userMessage:turn_1:user:0,assistantMessage:turn_1:assistant",
    );
    expect(indexedText.includes("Refactor the renderer")).toBe(true);
    expect(indexedText.includes("Done")).toBe(true);
    expect(indexedText.includes("HIDDEN_")).toBe(false);
  });

  test("does not duplicate a transcript turn-diff when turn.diff is also present", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["turn-diff:turn_1"],
        items: [buildTurnDiffItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
  });

  test("keeps the live turn-diff banner when a live fileChange row represents the draft edit", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["patch_live"],
        items: [buildFileChangeItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.type).join(",") ?? "").toBe("turnDiff");
    expect(model.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
    expect(model.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity");
  });

  test("keeps the live turn-diff portal stable across fileChange streaming updates", () => {
    const beforeFileChange = buildTurnRenderModel({
      turn: buildTurn({ diff: LIVE_DIFF, itemIds: [], items: [] }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });
    const withFileChange = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["patch_live"],
        items: [buildFileChangeItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });
    const withUpdatedFileChange = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["patch_live"],
        items: [
          buildFileChangeItem({
            fileChange: {
              changes: buildCodexFileChangeMap([{
                type: "update",
                path: "src/app.ts",
                unifiedDiff: LIVE_DIFF,
                movePath: null,
              }]),
              label: "Edited src/app.ts",
            },
          }),
        ],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(beforeFileChange.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
    expect(withFileChange.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
    expect(withUpdatedFileChange.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
    expect(withFileChange.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity");
    expect(withUpdatedFileChange.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity");
  });

  test("keeps latest live single dynamic and MCP activity grouped until assistant content starts", () => {
    const liveDynamic = buildTurnRenderModel({
      turn: buildTurn({
        itemIds: ["dynamic_1"],
        items: [buildDynamicToolItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });
    const liveMcp = buildTurnRenderModel({
      turn: buildTurn({
        itemIds: ["mcp_1"],
        items: [buildMcpToolItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });
    const afterAssistantStarts = buildTurnRenderModel({
      turn: buildTurn({
        itemIds: ["dynamic_1", "assistant_1"],
        items: [
          buildDynamicToolItem(),
          buildAssistantItem({
            status: "inProgress",
            markdownText: "Working through the result",
          }),
        ],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(liveDynamic.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("dynamicToolCallGroup");
    expect(liveDynamic.blocks.map((block) => block.type).join(",")).toBe("dynamicToolCallGroup");
    expect(liveMcp.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("pendingMcpToolCalls");
    expect(afterAssistantStarts.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("dynamicToolCall");
    expect(afterAssistantStarts.blocks.map((block) => block.type).join(",")).toBe("dynamicToolCall,assistantMessage,thinkingPlaceholder");
  });

  test("keeps the live turn-diff banner when a live fileChange has no renderable patch entries", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["patch_live"],
        items: [
          buildFileChangeItem({
            fileChange: {
              changes: buildCodexFileChangeMap([]),
            },
          }),
        ],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.type).join(",") ?? "").toBe("turnDiff");
    expect(model.blocks.map((block) => block.type).join(",")).toBe("thinkingPlaceholder");
  });

  test("keeps completed derived turn-diff in the trailing body", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        diff: LIVE_DIFF,
        itemIds: [],
        items: [],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: false,
    });

    expect(model.aboveComposerBlocks?.length ?? 0).toBe(0);
    expect(model.blocks.map((block) => block.type).join(",")).toBe("turnDiff");
  });

  test("inserts active working-for before the first non-user item and suppresses thinking placeholder", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        firstTurnWorkItemStartedAtMs: 1_000,
        itemIds: ["user_1", "exec_1"],
        items: [
          buildUserItem(),
          buildExecItem(),
        ],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("workedFor,exec");
    expect(model.blocks.map((block) => block.type).join(",")).toBe("userMessage,workedFor,exec");
    expect(model.blocks.some((block) => block.type === "thinkingPlaceholder")).toBe(false);
    expect(model.searchableText.includes("Working")).toBe(false);
  });

  test("consumes completed worked-for rows into the collapsed label source", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        firstTurnWorkItemStartedAtMs: 1_000,
        finalAssistantStartedAtMs: 8_000,
        itemIds: ["user_1", "exec_1", "assistant_1"],
        items: [
          buildUserItem(),
          buildExecItem({ status: "completed" }),
          buildAssistantItem(),
        ],
      }),
      requests: [],
      isLatestTurn: false,
      isStreamingTurn: false,
    });

    expect(model.workedForItem?.status ?? "").toBe("worked");
    expect(model.workedForItem?.startedAtMs ?? 0).toBe(1_000);
    expect(model.workedForItem?.completedAtMs ?? 0).toBe(8_000);
    expect(model.agentBodyUnits.some((unit) => unit.block.type === "workedFor")).toBe(false);
    expect(model.hasRenderableAgentBodyUnits).toBe(true);
  });

  test("falls back to completed duration when no explicit worked-for row exists", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        durationMs: 125_000,
        itemIds: ["user_1", "exec_1", "assistant_1"],
        items: [
          buildUserItem(),
          buildExecItem({ status: "completed" }),
          buildAssistantItem(),
        ],
      }),
      requests: [],
      isLatestTurn: false,
      isStreamingTurn: false,
    });

    expect(model.workedForItem).toBe(null);
    expect(model.workedDurationMs).toBe(125_000);
    expect(model.hasRenderableAgentBodyUnits).toBe(true);
  });

  test("does not keep completed worked-for timing without a renderable final assistant boundary", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        firstTurnWorkItemStartedAtMs: 1_000,
        finalAssistantStartedAtMs: 8_000,
        itemIds: ["user_1", "exec_1"],
        items: [
          buildUserItem(),
          buildExecItem({ status: "completed" }),
        ],
      }),
      requests: [],
      isLatestTurn: false,
      isStreamingTurn: false,
    });

    expect(model.workedForItem).toBe(null);
    expect(model.agentBodyUnits.some((unit) => unit.block.type === "workedFor")).toBe(false);
    expect(model.collapsedMessageCount).toBe(1);
  });
});
