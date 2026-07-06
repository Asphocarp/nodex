import { describe, expect, test } from "bun:test";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
import type {
  CodexMultiAgentActionName,
  CodexMultiAgentActionStatus,
} from "../../../../shared/codex-transcript-special-items";
import type { ThreadTranscriptBlockModel, ThreadWorkedForBlockModel } from "../thread-stage-types";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import { buildTurnViewModel } from "./build-turn-view-model";

function buildItem(overrides: Partial<ThreadTranscriptBlockModel>): ThreadTranscriptBlockModel {
  return {
    id: "item_1",
    turnId: "turn_1",
    createdAt: 1,
    updatedAt: 1,
    searchableText: "",
    type: "assistantMessage",
    entry: {
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "item_1",
      type: "assistant_message",
      kind: "assistantMessage",
      createdAt: 1,
      updatedAt: 1,
    },
    ...overrides,
  };
}

function buildWorkedForItem(overrides: Partial<ThreadWorkedForBlockModel>): ThreadWorkedForBlockModel {
  return {
    id: "worked_for",
    turnId: "turn_1",
    createdAt: 2,
    updatedAt: 2,
    searchableText: "",
    type: "workedFor",
    status: "worked",
    startedAtMs: 2,
    completedAtMs: 6_000,
    ...overrides,
  };
}

function multiAgentRawItem(
  id: string,
  tool: CodexMultiAgentActionName,
  status: CodexMultiAgentActionStatus,
): Record<string, unknown> {
  return {
    type: "collabAgentToolCall",
    id,
    tool,
    status,
    senderThreadId: "thread-main",
    receiverThreadIds: [`${id}-agent`],
    receiverThreads: [
      {
        threadId: `${id}-agent`,
        thread: {
          nickname: `${id} agent`,
          model: "gpt-5.4",
          agentRole: null,
        },
      },
    ],
    prompt: `${tool} prompt`,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    agentsStates: {},
  };
}

describe("bucketizeTurnItems", () => {
  test("preserves Codex-style turn ordering across user, agent, assistant, and trailing artifacts", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "model", type: "modelChanged" }),
        buildItem({ id: "user", type: "userMessage" }),
        buildItem({ id: "exec", type: "exec" }),
        buildItem({ id: "reasoning", type: "reasoning" }),
        buildItem({ id: "assistant", type: "assistantMessage" }),
        buildItem({ id: "plan", type: "proposedPlan" }),
        buildItem({ id: "diff", type: "turnDiff" }),
        buildItem({ id: "marker", type: "forkedFromConversation" }),
      ],
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe(
      "modelChanged,userMessage,exec,reasoning,assistantMessage,proposedPlan,forkedFromConversation",
    );
    const assistantBlock = turn.blocks.find((block) => block.type === "assistantMessage");
    expect(assistantBlock?.type === "assistantMessage" ? assistantBlock.assistantAfterBlocks?.map((block) => block.type).join(",") ?? "" : "").toBe("turnDiff");
  });

  test("lifts streaming turn diffs into above-composer blocks only", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user", type: "userMessage" }),
        buildItem({ id: "diff", type: "turnDiff", status: "inProgress" }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.aboveComposerBlocks?.map((block) => block.type).join(",") ?? "").toBe("turnDiff");
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("userMessage,thinkingPlaceholder");
  });

  test("keeps completed turn diffs in trailing thread body", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user", type: "userMessage" }),
        buildItem({ id: "diff", type: "turnDiff", status: "completed" }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(turn.aboveComposerBlocks?.length ?? 0).toBe(0);
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("userMessage,turnDiff");
  });

  test("keeps blocked streaming turn diffs out of the above-composer portal", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user", type: "userMessage" }),
        buildItem({ id: "diff", type: "turnDiff", status: "inProgress" }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: true,
    });

    expect(turn.aboveComposerBlocks?.length ?? 0).toBe(0);
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("userMessage,turnDiff");
  });

  test("keeps only the leading contiguous user prefix in userItems", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user_1", type: "userMessage" }),
        buildItem({ id: "exec", type: "exec" }),
        buildItem({ id: "user_2", type: "userMessage" }),
        buildItem({ id: "assistant", type: "assistantMessage" }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.userItems.map((item) => item.id).join(",")).toBe("user_1");
    expect(buckets.assistantItem?.id ?? "").toBe("assistant");
    expect(buckets.latestAssistantMessage?.id ?? "").toBe("assistant");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec,user_2");
  });

  test("groups contiguous completed tool activity while preserving original units", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec", status: "completed" }),
        buildItem({
          id: "file",
          type: "fileChange",
          status: "completed",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "file",
            type: "file_change",
            kind: "fileChange",
            semanticKind: "patch",
            status: "completed",
            fileChange: {
              changes: buildCodexFileChangeMap([{
                type: "update",
                path: "src/app.ts",
                movePath: null,
                unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
              }]),
            },
            createdAt: 1,
            updatedAt: 1,
          },
        }),
        buildItem({ id: "assistant", type: "assistantMessage" }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });
    const group = turn.agentBodyUnits[0]?.block;

    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.id).join(",") : "").toBe("exec,file");
  });

  test("keeps inline assistant prose before a live single-file collapsed activity group", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "assistant", type: "assistantMessage", status: "completed" }),
        buildItem({
          id: "file",
          type: "fileChange",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "file",
            type: "file_change",
            kind: "fileChange",
            semanticKind: "patch",
            status: "inProgress",
            fileChange: {
              changes: buildCodexFileChangeMap([{ type: "add", path: "poem.md", content: "line\n" }]),
            },
            createdAt: 2,
            updatedAt: 2,
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("assistantMessage,collapsedToolActivity");
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("assistantMessage,collapsedToolActivity");
  });

  test("routes leading hooks into preUserItems and trailing hooks into postAssistantItems", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "hook_pre", type: "hook" }),
        buildItem({ id: "user_1", type: "userMessage" }),
        buildItem({ id: "assistant_1", type: "assistantMessage" }),
        buildItem({ id: "hook_post", type: "hook" }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.preUserItems.map((item) => item.id).join(",")).toBe("hook_pre");
    expect(buckets.userItems.map((item) => item.id).join(",")).toBe("user_1");
    expect(buckets.assistantItem?.id ?? "").toBe("assistant_1");
    expect(buckets.postAssistantItems.map((item) => item.id).join(",")).toBe("hook_post");
  });

  test("keeps completed MCP elicitation rows in generic agent items", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({ id: "elicitation_done", type: "mcpServerElicitation", status: "completed" }),
        buildItem({ id: "assistant", type: "assistantMessage" }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.mcpServerElicitationItems.length).toBe(0);
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec,elicitation_done");
  });

  test("extracts planImplementation into its dedicated bucket instead of generic agent items", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({ id: "plan_impl", type: "planImplementation" }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.planImplementationItem?.id ?? "").toBe("plan_impl");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec");
  });

  test("keeps pre-final assistant commentary in agentItems and reserves postAssistant for trailing reviews", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({
          id: "commentary",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "commentary",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "commentary",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "Running the test suite.",
          },
        }),
        buildItem({
          id: "final",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "final",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 3,
            updatedAt: 3,
            markdownText: "`bun test` passed.",
          },
        }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.assistantItem?.id ?? "").toBe("final");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec,commentary");
    expect(buckets.postAssistantItems.length).toBe(0);
  });

  test("keeps actions on the normal trailing assistant without adding an action-only block", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "Done",
          },
        }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
      canForkTurn: true,
    });

    expect(turn.trailingBlocks.map((block) => block.type).join(",")).toBe("assistantMessage");
    const assistantBlock = turn.trailingBlocks[0];
    expect(assistantBlock?.type === "assistantMessage" && assistantBlock.assistantMessageActions?.copyText).toBe("Done");
  });

  test("keeps the final assistant inline in agentItems when exec arrives later in the turn", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 1,
            updatedAt: 1,
            markdownText: "Done",
          },
        }),
        buildItem({ id: "exec", type: "exec" }),
      ],
      turnStatus: "inProgress",
    });

    expect(buckets.assistantItem).toBe(null);
    expect(buckets.latestAssistantMessage?.id ?? "").toBe("assistant");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("assistant,exec");
  });

  test("defers stopped inline assistant actions after later exploration rows", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 1,
            updatedAt: 1,
            markdownText: "Done",
          },
        }),
        buildItem({
          id: "exec_1",
          type: "exec",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "exec_1",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            createdAt: 2,
            updatedAt: 2,
            commandActions: [{ type: "read", command: "", name: "read", path: "src/app.ts" }],
            toolCall: {
              subtype: "command",
              toolName: "run_command",
              args: {},
            },
          },
        }),
        buildItem({
          id: "reasoning_1",
          type: "reasoning",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "reasoning_1",
            type: "reasoning",
            kind: "reasoning",
            semanticKind: "reasoning",
            createdAt: 3,
            updatedAt: 3,
            markdownText: "Thinking",
          },
        }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(buckets.assistantItem).toBe(null);
    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("assistantMessage,collapsedToolActivity");
    const activityGroup = turn.agentBodyUnits[1]?.block;
    expect(activityGroup?.type === "collapsedToolActivity" ? activityGroup.entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup",
    );
    expect(turn.trailingBlocks.map((block) => block.type).join(",")).toBe("assistantActions");
    const inlineAssistant = turn.agentBodyUnits[0]?.block;
    expect(inlineAssistant?.type === "assistantMessage" && inlineAssistant.assistantMessageActions === undefined).toBeTrue();
    const deferredActions = turn.trailingBlocks[0];
    expect(deferredActions?.type === "assistantActions" && deferredActions.actions.copyText).toBe("Done");
  });

  test("keeps later MCP and web search items in agent lanes and leaves the latest assistant inline", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 1,
            updatedAt: 1,
            markdownText: "Done",
          },
        }),
        buildItem({
          id: "mcp",
          type: "mcpToolCall",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "mcp",
            type: "mcp_tool_call",
            kind: "toolCall",
            semanticKind: "mcpToolCall",
            createdAt: 2,
            updatedAt: 2,
            mcpToolCall: {
              callId: "mcp",
              functionName: "docs__search",
              invocation: {
                server: "docs",
                tool: "search",
                arguments: { query: "search docs" },
              },
              durationMs: null,
              completed: false,
              result: null,
            },
          },
        }),
        buildItem({ id: "web", type: "webSearch", searchableText: "search docs" }),
      ],
      turnStatus: "inProgress",
    });

    expect(buckets.assistantItem).toBe(null);
    expect(buckets.latestAssistantMessage?.id ?? "").toBe("assistant");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("assistant,mcp,web");
  });

  test("suppresses in-progress MCP rows when an incomplete same-server elicitation is present", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "elicitation",
          type: "mcpServerElicitation",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "elicitation",
            type: "mcpServerElicitation",
            kind: "systemEvent",
            semanticKind: "mcpServerElicitation",
            createdAt: 1,
            updatedAt: 1,
            rawItem: {
              serverName: "Docs",
            },
          },
        }),
        buildItem({
          id: "mcp",
          type: "mcpToolCall",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "mcp",
            type: "mcp_tool_call",
            kind: "toolCall",
            semanticKind: "mcpToolCall",
            createdAt: 2,
            updatedAt: 2,
            mcpToolCall: {
              callId: "mcp",
              functionName: "docs__search",
              invocation: {
                server: "docs",
                tool: "search",
                arguments: { query: "search docs" },
              },
              durationMs: null,
              completed: false,
              result: null,
            },
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    expect(buckets.mcpServerElicitationItems.map((item) => item.id).join(",")).toBe("elicitation");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("");
  });

  test("does not suppress MCP rows for a different elicitation server", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "elicitation",
          type: "mcpServerElicitation",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "elicitation",
            type: "mcpServerElicitation",
            kind: "systemEvent",
            semanticKind: "mcpServerElicitation",
            createdAt: 1,
            updatedAt: 1,
            rawItem: {
              serverName: "context7",
            },
          },
        }),
        buildItem({
          id: "mcp",
          type: "mcpToolCall",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "mcp",
            type: "mcp_tool_call",
            kind: "toolCall",
            semanticKind: "mcpToolCall",
            createdAt: 2,
            updatedAt: 2,
            mcpToolCall: {
              callId: "mcp",
              functionName: "docs__search",
              invocation: {
                server: "docs",
                tool: "search",
                arguments: { query: "search docs" },
              },
              durationMs: null,
              completed: false,
              result: null,
            },
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("mcp");
  });

  test("builds search units from user and assistant items only", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user", type: "userMessage", searchableText: "Refactor the renderer" }),
        buildItem({ id: "exec", type: "exec", searchableText: "bun test" }),
        buildItem({ id: "assistant", type: "assistantMessage", searchableText: "I updated the renderer" }),
      ],
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(turn.searchUnits.map((unit) => `${unit.blockType}:${unit.key}`).join(",")).toBe(
      "userMessage:turn_1:user:0,assistantMessage:turn_1:assistant",
    );
  });

  test("preserves the latest-assistant search unit when later agent rows are appended", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "user", type: "userMessage", searchableText: "Refactor the renderer" }),
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          searchableText: "I updated the renderer",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "I updated the renderer",
          },
        }),
        buildItem({ id: "exec", type: "exec", searchableText: "bun test" }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.searchUnits.map((unit) => `${unit.blockType}:${unit.key}`).join(",")).toBe(
      "userMessage:turn_1:user:0,assistantMessage:turn_1:assistant",
    );
    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("assistantMessage,exec");
    expect(turn.trailingBlocks.map((block) => block.id).join(",")).toBe("turn_1:thinking");
    const inlineAssistant = turn.agentBodyUnits[0]?.block;
    expect(inlineAssistant?.type === "assistantMessage" && inlineAssistant.assistantMessageActions === undefined).toBeTrue();
  });

  test("only allows default collapse for older completed turns with grouped agent body content", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec", searchableText: "bun test" }),
      ],
    });

    const completedTurn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        itemIds: ["exec"],
        items: [],
      },
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    const failedTurn = buildTurnViewModel({
      turnId: "turn_2",
      turn: {
        threadId: "thread_1",
        turnId: "turn_2",
        status: "failed",
        itemIds: ["exec"],
        items: [],
      },
      buckets: {
        ...buckets,
        agentItems: buckets.agentItems.map((item) => ({ ...item, turnId: "turn_2" })),
      },
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(completedTurn.hasRenderableAgentBodyUnits).toBeTrue();
    expect(completedTurn.defaultAgentBodyCollapsed).toBeTrue();
    expect(failedTurn.hasRenderableAgentBodyUnits).toBeFalse();
    expect(failedTurn.defaultAgentBodyCollapsed).toBeFalse();
  });

  test("groups exploration-only exec sequences without disturbing surrounding agent order", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "exec_1",
          type: "exec",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "exec_1",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            createdAt: 1,
            updatedAt: 1,
            commandActions: [{ type: "read", command: "", name: "read", path: "src/app.ts" }],
            toolCall: {
              subtype: "command",
              toolName: "run_command",
              args: {},
            },
          },
        }),
        buildItem({
          id: "reasoning_1",
          type: "reasoning",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "reasoning_1",
            type: "reasoning",
            kind: "reasoning",
            semanticKind: "reasoning",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "Thinking",
          },
        }),
      ],
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("collapsedToolActivity");
    const group = turn.agentBodyUnits[0]?.block;
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup",
    );
  });

  test("groups same-action multi-agent actions including in-progress ones", () => {
    const settledBuckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "agent_1",
          type: "multiAgentAction",
          status: "completed",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "agent_1",
            type: "tool_call",
            kind: "toolCall",
            semanticKind: "multiAgentAction",
            createdAt: 1,
            updatedAt: 1,
            rawItem: multiAgentRawItem("agent_1", "spawnAgent", "completed"),
          },
        }),
        buildItem({
          id: "agent_2",
          type: "multiAgentAction",
          status: "completed",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "agent_2",
            type: "tool_call",
            kind: "toolCall",
            semanticKind: "multiAgentAction",
            createdAt: 1,
            updatedAt: 1,
            rawItem: multiAgentRawItem("agent_2", "spawnAgent", "completed"),
          },
        }),
      ],
    });
    const settledTurn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets: settledBuckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    const liveBuckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "agent_live",
          type: "multiAgentAction",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_2",
            itemId: "agent_live",
            type: "tool_call",
            kind: "toolCall",
            semanticKind: "multiAgentAction",
            createdAt: 1,
            updatedAt: 1,
            rawItem: multiAgentRawItem("agent_live", "spawnAgent", "inProgress"),
          },
        }),
      ],
    });
    const liveTurn = buildTurnViewModel({
      turnId: "turn_2",
      turn: null,
      buckets: liveBuckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(settledTurn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("multiAgentGroup");
    expect(liveTurn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("multiAgentGroup");
  });

  test("adds a thinking placeholder for an in-progress turn before assistant content starts", () => {
    const buckets = bucketizeTurnItems({
      items: [],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: [],
        items: [],
      },
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe("thinkingPlaceholder");
  });

  test("promotes a trailing exploration cluster to Exploring while the turn is still active", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "exec_1",
          type: "exec",
          status: "completed",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "exec_1",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "completed",
            createdAt: 1,
            updatedAt: 1,
            commandActions: [{ type: "read", command: "", name: "stage.tsx", path: "src/stage.tsx" }],
            toolCall: {
              subtype: "command",
              toolName: "run_command",
              args: {},
            },
          },
        }),
        buildItem({
          id: "reasoning_1",
          type: "reasoning",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "reasoning_1",
            type: "reasoning",
            kind: "reasoning",
            semanticKind: "reasoning",
            status: "inProgress",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "Checking stage layout details.",
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: ["exec_1", "reasoning_1"],
        items: [],
      },
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity");
    const activityGroup = turn.blocks[0];
    const explorationBlock = activityGroup?.type === "collapsedToolActivity" ? activityGroup.entries[0] : null;
    expect(explorationBlock?.type).toBe("explorationGroup");
    expect(explorationBlock && explorationBlock.type === "explorationGroup" ? explorationBlock.status : undefined).toBe("inProgress");
  });

  test("keeps a completed trailing exploration cluster settled while the turn is still active", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "exec_1",
          type: "exec",
          status: "completed",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "exec_1",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "completed",
            createdAt: 1,
            updatedAt: 1,
            commandActions: [{ type: "search", command: "", query: "shimmer", path: "src" }],
            toolCall: {
              subtype: "command",
              toolName: "run_command",
              args: {},
            },
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: ["exec_1"],
        items: [],
      },
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity,thinkingPlaceholder");
    const activityGroup = turn.blocks[0];
    const explorationBlock = activityGroup?.type === "collapsedToolActivity" ? activityGroup.entries[0] : null;
    expect(explorationBlock?.type).toBe("explorationGroup");
    expect(explorationBlock && explorationBlock.type === "explorationGroup" ? explorationBlock.status : undefined).toBe("completed");
    expect(activityGroup?.type === "collapsedToolActivity" ? activityGroup.summary : "").toBe("Searched code");
    expect(activityGroup?.type === "collapsedToolActivity" ? activityGroup.runningSummary ?? null : null).toBe(null);
  });

  test("does not let a trailing in-progress reasoning row suppress the Thinking placeholder", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "reasoning_1",
          type: "reasoning",
          status: "inProgress",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "reasoning_1",
            type: "reasoning",
            kind: "reasoning",
            semanticKind: "reasoning",
            status: "inProgress",
            createdAt: 2,
            updatedAt: 2,
            markdownText: "Checking the bundle.",
          },
        }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: ["reasoning_1"],
        items: [],
      },
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe("reasoning,thinkingPlaceholder");
  });

  test("suppresses the thinking placeholder while a proposed plan is still streaming", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "plan",
          type: "proposedPlan",
          status: "inProgress",
        }),
      ],
      turnStatus: "inProgress",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: ["plan"],
        items: [],
      },
      buckets,
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
    });

    expect(turn.blocks.map((block) => block.type).join(",")).toBe("proposedPlan");
  });

  test("keeps context compaction inline before the final assistant when that is its canonical item order", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({
          id: "compact",
          type: "contextCompaction",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "compact",
            type: "context_compaction",
            kind: "systemEvent",
            semanticKind: "contextCompaction",
            status: "completed",
            markdownText: "Context automatically compacted",
            createdAt: 2,
            updatedAt: 2,
          },
        }),
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            markdownText: "Done",
            createdAt: 3,
            updatedAt: 3,
          },
        }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec,compact");
    expect(buckets.assistantItem?.id ?? "").toBe("assistant");
    expect(buckets.postAssistantItems.length).toBe(0);
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("exec,contextCompaction,assistantMessage");
  });

  test("keeps context compaction inline after the assistant instead of promoting the assistant", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            markdownText: "Done",
            createdAt: 1,
            updatedAt: 1,
          },
        }),
        buildItem({
          id: "compact",
          type: "contextCompaction",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "compact",
            type: "context_compaction",
            kind: "systemEvent",
            semanticKind: "contextCompaction",
            status: "completed",
            markdownText: "Context automatically compacted",
            createdAt: 2,
            updatedAt: 2,
          },
        }),
        buildItem({ id: "exec", type: "exec" }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: null,
      buckets,
      isLatestTurn: false,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(buckets.assistantItem).toBe(null);
    expect(buckets.latestAssistantMessage?.id ?? "").toBe("assistant");
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("assistant,compact,exec");
    expect(buckets.postAssistantItems.length).toBe(0);
    expect(turn.blocks.map((block) => block.type).join(",")).toBe("assistantMessage,contextCompaction,exec,assistantActions");
  });

  test("still reserves postAssistant for trailing automatic approval reviews", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({ id: "exec", type: "exec" }),
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            markdownText: "Done",
            createdAt: 2,
            updatedAt: 2,
          },
        }),
        buildItem({
          id: "review",
          type: "automaticApprovalReview",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "review",
            type: "automaticApprovalReview",
            kind: "systemEvent",
            semanticKind: "automaticApprovalReview",
            status: "completed",
            createdAt: 3,
            updatedAt: 3,
          },
        }),
      ],
      turnStatus: "completed",
    });

    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("exec");
    expect(buckets.assistantItem?.id ?? "").toBe("assistant");
    expect(buckets.postAssistantItems.map((item) => item.id).join(",")).toBe("review");
  });

  test("keeps worked-for in the classifier path so it blocks assistant promotion", () => {
    const buckets = bucketizeTurnItems({
      items: [
        buildItem({
          id: "assistant",
          type: "assistantMessage",
          entry: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            assistantPhase: "final_answer",
            markdownText: "Done",
            createdAt: 1,
            updatedAt: 1,
          },
        }),
        buildWorkedForItem({
          id: "worked_for",
        }),
      ],
      turnStatus: "completed",
    });

    const turn = buildTurnViewModel({
      turnId: "turn_1",
      turn: {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        itemIds: ["assistant", "worked_for"],
        items: [],
      },
      buckets,
      workedForItem: buckets.agentItems.find((item): item is ThreadWorkedForBlockModel => item.type === "workedFor") ?? null,
      isLatestTurn: true,
      isStreamingTurn: false,
      isBlocked: false,
    });

    expect(buckets.assistantItem).toBe(null);
    expect(buckets.agentItems.map((item) => item.id).join(",")).toBe("assistant,worked_for");
    expect(turn.agentBodyUnits.map((unit) => unit.block.type).join(",")).toBe("assistantMessage");
  });
});
