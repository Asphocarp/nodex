import { describe, expect, test } from "vitest";
import type { CodexCommandAction, CodexConversationItem, CodexSemanticItemKind } from "../../../lib/types";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
import type {
  CodexMultiAgentActionName,
  CodexMultiAgentActionStatus,
} from "../../../../shared/codex-transcript-special-items";
import type {
  ThreadAgentEntryModel,
  ThreadAgentItemModel,
  ThreadSubagentActivityStatus,
  ThreadTranscriptBlockModel,
} from "../thread-stage-types";
import {
  buildAgentRenderUnits,
  buildCollapsedToolActivitySummary,
  buildCollapsedToolActivitySummaryFact,
  buildPreGroupedAgentRenderUnits,
  collectCollapsedToolActivitySummaryStats,
  materializeAgentRenderUnits,
  resolveAgentRenderUnitKey,
  resolveCollapsedToolActivityActiveSummary,
  resolveCollapsedToolActivitySummaryCues,
  shouldDisplayCollapsedToolActivityActiveSummary,
} from "./group-exploration-blocks";

function buildEntry(
  id: string,
  overrides: Partial<CodexConversationItem>,
): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: id,
    entryId: id,
    type: "commandExecution",
    kind: "commandExecution",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildBlock(
  id: string,
  type: ThreadTranscriptBlockModel["type"],
  overrides: Partial<CodexConversationItem> = {},
): ThreadTranscriptBlockModel {
  const semanticKind: CodexSemanticItemKind | undefined = type === "exec"
    ? "exec"
    : type === "webSearch"
      ? "webSearch"
      : type === "multiAgentAction"
        ? "multiAgentAction"
      : type === "mcpServerElicitation"
        ? "mcpServerElicitation"
        : undefined;
  const entry = buildEntry(id, {
    semanticKind,
    ...overrides,
  });

  return {
    id,
    turnId: "turn-1",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    searchableText: entry.markdownText ?? "",
    type,
    status: entry.status,
    entry,
  };
}

function groupAgentBlocks(
  blocks: ThreadAgentItemModel[],
  options: Parameters<typeof buildAgentRenderUnits>[1] = {},
): ThreadAgentEntryModel[] {
  return materializeAgentRenderUnits(buildAgentRenderUnits(blocks, options));
}

function renderKeyString(
  blocks: ThreadAgentItemModel[],
  options: Parameters<typeof buildAgentRenderUnits>[1] = {},
): string {
  return groupAgentBlocks(blocks, options)
    .map((entry) => entry.renderKey ?? "")
    .join(",");
}

function readAction(name: string): CodexCommandAction {
  return { type: "read", command: `cat ${name}`, name, path: name };
}

function multiAgentRawItem(
  id: string,
  tool: CodexMultiAgentActionName,
  status: CodexMultiAgentActionStatus = "completed",
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
    prompt: tool === "closeAgent" ? null : `${tool} prompt`,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    agentsStates: {},
  };
}

function mcpBlock(
  id: string,
  options: {
    server?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    pluginId?: string | null;
    mcpAppResourceUri?: string | null;
    status?: CodexConversationItem["status"];
    completed?: boolean;
    rawItem?: Record<string, unknown>;
  } = {},
): ThreadTranscriptBlockModel {
  const server = options.server ?? "browser-use";
  const tool = options.tool ?? "click";
  const status = options.status ?? "inProgress";
  const completed = options.completed ?? status !== "inProgress";
  const invocationArguments = options.arguments ?? {};
  const rawItem = options.rawItem ?? (server === "browser-use"
    ? { source: { kind: "browserUse", backend: "iab" } }
    : undefined);
  return buildBlock(id, "mcpToolCall", {
    kind: "toolCall",
    semanticKind: "mcpToolCall",
    status,
    rawItem,
    mcpToolCall: {
      callId: id,
      functionName: `${server}__${tool}`,
      pluginId: options.pluginId,
      mcpAppResourceUri: options.mcpAppResourceUri,
      invocation: { server, tool, arguments: invocationArguments },
      result: null,
      durationMs: null,
      completed,
    },
  });
}

function dynamicBlock(id: string, tool = "read_thread"): ThreadTranscriptBlockModel {
  return buildBlock(id, "dynamicToolCall", {
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    dynamicToolCall: {
      callId: id,
      namespace: "codex_app",
      tool,
      arguments: { threadId: id },
      status: "completed",
      contentItems: [{ type: "inputText", text: "{\"ok\":true}" }],
      success: true,
      durationMs: 1,
      completed: true,
    },
  });
}

function subagentActivityBlock(
  id: string,
  conversationId: string,
  displayName: string,
  activityStatus: ThreadSubagentActivityStatus,
): ThreadTranscriptBlockModel {
  const status = activityStatus === "interrupted" || activityStatus === "done" ? "done" : "active";
  return {
    ...buildBlock(id, "subagentActivityInlineGroup", {
      kind: "systemEvent",
      semanticKind: "systemEvent",
      rawItem: {
        id,
        type: "subAgentActivity",
        kind: activityStatus === "updated" ? "interacted" : activityStatus === "done" ? "interacted" : activityStatus,
        agentThreadId: conversationId,
        agentPath: displayName,
      },
    }),
    searchableText: `${displayName}\n${activityStatus}`,
    subagentActivityRows: [
      {
        conversationId,
        displayName,
        agentRole: null,
        spawnModel: null,
        status,
        activityStatus,
        statusSummary: `${displayName} ${activityStatus}`,
        diffStats: null,
      },
    ],
    subagentActivityStatusLabel: activityStatus === "started" ? "started working" : activityStatus,
  };
}

describe("buildAgentRenderUnits collapsed tool activity", () => {
  test("pre-groups web searches and same-action multi-agent entries into explicit render units", () => {
    const units = buildPreGroupedAgentRenderUnits([
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
      buildBlock("spawn-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        rawItem: multiAgentRawItem("spawn-1", "spawnAgent"),
      }),
      buildBlock("spawn-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        rawItem: multiAgentRawItem("spawn-2", "spawnAgent"),
      }),
      buildBlock("cmd", "exec", { command: "date", commandActions: [] }),
    ]);

    expect(units.map((unit) => unit.kind).join(",")).toBe("webSearchGroup,multiAgentGroup,entry");
    expect(units.map((unit, index) => resolveAgentRenderUnitKey(unit, index)).join(",")).toBe(
      "web-search-group:Codex app-server:0,multi-agent-group:spawnAgent:spawn-1,item:exec:cmd",
    );
    expect(materializeAgentRenderUnits(units).map((entry) => entry.type).join(",")).toBe(
      "webSearchGroup,multiAgentGroup,exec",
    );
  });

  test("pre-groups adjacent subagent activity blocks into one inline group", () => {
    const units = buildPreGroupedAgentRenderUnits([
      subagentActivityBlock("subagent-1", "thread-child-a", "Scout", "started"),
      subagentActivityBlock("subagent-2", "thread-child-b", "Reviewer", "updated"),
      subagentActivityBlock("subagent-3", "thread-child-a", "Scout", "updated"),
      buildBlock("cmd", "exec", { command: "date", commandActions: [] }),
    ]);
    const materialized = materializeAgentRenderUnits(units);
    const group = materialized[0];

    expect(units.map((unit) => unit.kind).join(",")).toBe("entry,entry");
    expect(materialized.map((entry) => entry.type).join(",")).toBe("subagentActivityInlineGroup,exec");
    expect(group?.type).toBe("subagentActivityInlineGroup");
    expect(group && "subagentActivityRows" in group ? group.subagentActivityRows?.map((row) => row.conversationId).join(",") : "").toBe(
      "thread-child-a,thread-child-b",
    );
    expect(group && "subagentActivityRows" in group ? group.subagentActivityRows?.[0]?.activityStatus : "").toBe("updated");
    expect(group && "subagentActivityStatusLabel" in group ? group.subagentActivityStatusLabel : "").toBe("updated");
  });

  test("returns final grouped activity through the explicit render-unit taxonomy", () => {
    const units = buildAgentRenderUnits([
      buildBlock("cmd", "exec", { command: "date", commandActions: [] }),
      buildBlock("spawn-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        rawItem: multiAgentRawItem("spawn-1", "spawnAgent"),
      }),
      buildBlock("spawn-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        rawItem: multiAgentRawItem("spawn-2", "spawnAgent"),
      }),
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
      mcpBlock("mcp-1"),
      mcpBlock("mcp-2"),
      dynamicBlock("dynamic-1", "read_thread"),
      dynamicBlock("dynamic-2", "send_message_to_thread"),
    ]);
    const materialized = materializeAgentRenderUnits(units);
    const collapsed = units[2]?.kind === "collapsedToolActivity" ? units[2].block : null;

    expect(units.map((unit) => unit.kind).join(",")).toBe(
      "entry,multiAgentGroup,collapsedToolActivity,pendingMcpToolCalls,dynamicToolCallGroup",
    );
    expect(units.map((unit, index) => resolveAgentRenderUnitKey(unit, index)).join(",")).toBe(
      "item:exec:cmd,multi-agent-group:spawnAgent:spawn-1,collapsed-tool-activity:web-search-group:Codex app-server:2:2,pending-mcp-tool-calls:mcp-1:3,dynamic-tool-call-group:dynamic-1:4",
    );
    expect(materialized.map((entry) => entry.type).join(",")).toBe(
      "exec,multiAgentGroup,collapsedToolActivity,pendingMcpToolCalls,dynamicToolCallGroup",
    );
    expect(materialized.map((entry) => entry.renderKey ?? "").join(",")).toBe(
      "item:exec:cmd,multi-agent-group:spawnAgent:spawn-1,collapsed-tool-activity:web-search-group:Codex app-server:2:2,pending-mcp-tool-calls:mcp-1:3,dynamic-tool-call-group:dynamic-1:4",
    );
    expect(collapsed?.entries.map((entry) => entry.type).join(",") ?? "").toBe("webSearchGroup");
  });

  test("keeps render keys stable when a live patch updates in place", () => {
    const before = groupAgentBlocks([
      buildBlock("patch-1", "fileChange", {
        kind: "fileChange",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([{
            type: "update",
            path: "src/app.ts",
            unifiedDiff: "@@ -1 +1 @@\n-before\n+after\n",
            movePath: null,
          }]),
        },
      }),
    ]);
    const after = groupAgentBlocks([
      buildBlock("patch-1", "fileChange", {
        kind: "fileChange",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([{
            type: "update",
            path: "src/app.ts",
            unifiedDiff: "@@ -1 +1 @@\n-after\n+again\n",
            movePath: null,
          }]),
        },
      }),
    ]);

    expect(before.map((entry) => entry.renderKey ?? "").join(",")).toBe(
      "collapsed-tool-activity:item:patch:patch-1:0",
    );
    expect(after.map((entry) => entry.renderKey ?? "").join(",")).toBe(
      before.map((entry) => entry.renderKey ?? "").join(","),
    );
  });

  test("keeps grouped render keys stable across streaming content updates", () => {
    const stableWebKeys = renderKeyString([
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server", count: 1 } },
      }),
      buildBlock("web-2", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server", count: 2 } },
      }),
    ]);
    expect(renderKeyString([
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server", count: 3 } },
      }),
      buildBlock("web-2", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server", count: 4 } },
      }),
    ])).toBe(stableWebKeys);

    const stableMultiAgentKeys = renderKeyString([
      buildBlock("agent-1", "multiAgentAction", {
        kind: "toolCall",
        status: "inProgress",
        rawItem: multiAgentRawItem("agent-1", "spawnAgent", "inProgress"),
      }),
      buildBlock("agent-2", "multiAgentAction", {
        kind: "toolCall",
        status: "inProgress",
        rawItem: multiAgentRawItem("agent-2", "spawnAgent", "inProgress"),
      }),
    ]);
    expect(renderKeyString([
      buildBlock("agent-1", "multiAgentAction", {
        kind: "toolCall",
        status: "inProgress",
        rawItem: { ...multiAgentRawItem("agent-1", "spawnAgent", "inProgress"), prompt: "updated prompt" },
      }),
      buildBlock("agent-2", "multiAgentAction", {
        kind: "toolCall",
        status: "inProgress",
        rawItem: { ...multiAgentRawItem("agent-2", "spawnAgent", "inProgress"), prompt: "updated prompt" },
      }),
    ])).toBe(stableMultiAgentKeys);

    const stablePendingMcpKeys = renderKeyString([
      mcpBlock("mcp-1", { arguments: { step: 1 } }),
      mcpBlock("mcp-2", { arguments: { step: 1 } }),
    ], { keepLatestLiveActivityInGroup: true });
    expect(renderKeyString([
      mcpBlock("mcp-1", { arguments: { step: 2 } }),
      mcpBlock("mcp-2", { arguments: { step: 2 } }),
    ], { keepLatestLiveActivityInGroup: true })).toBe(stablePendingMcpKeys);

    const stableDynamicKeys = renderKeyString([
      dynamicBlock("dynamic-1", "read_thread"),
      dynamicBlock("dynamic-2", "read_thread"),
    ]);
    expect(renderKeyString([
      buildBlock("dynamic-1", "dynamicToolCall", {
        kind: "toolCall",
        semanticKind: "dynamicToolCall",
        status: "completed",
        dynamicToolCall: {
          callId: "dynamic-1",
          namespace: "codex_app",
          tool: "read_thread",
          arguments: { threadId: "dynamic-1", cursor: "next" },
          status: "completed",
          contentItems: [{ type: "inputText", text: "{\"ok\":true,\"updated\":true}" }],
          success: true,
          durationMs: 2,
          completed: true,
        },
      }),
      buildBlock("dynamic-2", "dynamicToolCall", {
        kind: "toolCall",
        semanticKind: "dynamicToolCall",
        status: "completed",
        dynamicToolCall: {
          callId: "dynamic-2",
          namespace: "codex_app",
          tool: "read_thread",
          arguments: { threadId: "dynamic-2", cursor: "next" },
          status: "completed",
          contentItems: [{ type: "inputText", text: "{\"ok\":true,\"updated\":true}" }],
          success: true,
          durationMs: 2,
          completed: true,
        },
      }),
    ])).toBe(stableDynamicKeys);

    const stableExplorationKeys = renderKeyString([
      buildBlock("read-1", "exec", { status: "inProgress", commandActions: [readAction("ARCHITECTURE.md")] }),
      buildBlock("read-2", "exec", { status: "inProgress", commandActions: [readAction("FRONTEND.md")] }),
    ]);
    expect(renderKeyString([
      buildBlock("read-1", "exec", { status: "inProgress", commandActions: [readAction("ARCHITECTURE.md")], command: "cat ARCHITECTURE.md" }),
      buildBlock("read-2", "exec", { status: "inProgress", commandActions: [readAction("FRONTEND.md")], command: "cat FRONTEND.md" }),
    ])).toBe(stableExplorationKeys);

    const stableExecKeys = renderKeyString([
      buildBlock("cmd-1", "exec", {
        status: "inProgress",
        command: "bun test",
        commandActions: [],
        aggregatedOutput: "one",
      }),
    ]);
    expect(renderKeyString([
      buildBlock("cmd-1", "exec", {
        status: "inProgress",
        command: "bun test",
        commandActions: [],
        aggregatedOutput: "one\ntwo",
      }),
    ])).toBe(stableExecKeys);
  });

  test("formats the Codex mixed exploration, command, and web summary", () => {
    const grouped = groupAgentBlocks([
      buildBlock("explore", "exec", {
        commandActions: [
          readAction("ARCHITECTURE.md"),
          readAction("FRONTEND.md"),
          readAction("README.md"),
          readAction("src/a.ts"),
          readAction("src/b.ts"),
          { type: "search", command: "rg Codex", query: "Codex", path: null },
        ],
      }),
      buildBlock("cmd-1", "exec", { command: "node scripts/check.js", commandActions: [] }),
      buildBlock("cmd-2", "exec", { command: "curl https://developers.openai.com", commandActions: [] }),
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
    ]);

    const group = grouped[0];
    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.summary : "").toBe(
      "Read 5 files and searched code, ran 2 commands, searched the web",
    );
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup,exec,exec,webSearchGroup",
    );
  });

  test("pre-groups consecutive web searches before collapsed activity", () => {
    const grouped = groupAgentBlocks([
      buildBlock("web-1", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    const group = grouped[0];
    const webGroup = group?.type === "collapsedToolActivity" ? group.entries[0] : null;
    expect(webGroup?.type === "webSearchGroup" ? webGroup.entries.length : 0).toBe(2);
    expect(webGroup?.type === "webSearchGroup" ? webGroup.status : "").toBe("inProgress");
  });

  test("collapses single eligible non-exec non-mcp facts", () => {
    const exploration = groupAgentBlocks([
      buildBlock("read", "exec", { commandActions: [readAction("src/app.ts")] }),
    ]);
    const web = groupAgentBlocks([
      buildBlock("web", "webSearch", {
        kind: "toolCall",
        semanticKind: "webSearch",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex" } },
      }),
    ]);
    const approval = groupAgentBlocks([
      buildBlock("review-denied", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        rawItem: { review: { status: "denied", rationale: "Denied" } },
      }),
    ]);

    expect(exploration.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(exploration[0]?.type === "collapsedToolActivity" ? exploration[0].entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup",
    );
    expect(web.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(web[0]?.type === "collapsedToolActivity" ? web[0].entries.map((entry) => entry.type).join(",") : "").toBe(
      "webSearchGroup",
    );
    expect(approval.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(approval[0]?.type === "collapsedToolActivity" ? approval[0].entries.map((entry) => entry.type).join(",") : "").toBe(
      "automaticApprovalReview",
    );
  });

  test("keeps single non-exploration exec and completed MCP calls standalone", () => {
    const exec = groupAgentBlocks([
      buildBlock("cmd", "exec", { command: "date", commandActions: [] }),
    ]);
    const mcp = groupAgentBlocks([
      buildBlock("mcp", "mcpToolCall", {
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "completed",
        mcpToolCall: {
          callId: "mcp",
          functionName: "browser-use__click",
          invocation: { server: "browser-use", tool: "click", arguments: {} },
          result: {
            type: "success",
            content: [],
            structuredContent: null,
            raw: { content: [], structuredContent: null },
          },
          durationMs: 10,
          completed: true,
        },
      }),
    ]);

    expect(exec.map((entry) => entry.type).join(",")).toBe("exec");
    expect(mcp.map((entry) => entry.type).join(",")).toBe("mcpToolCall");
  });

  test("keeps non-failure approval reviews and hooks out of collapsed activity groups", () => {
    const fileChange = buildBlock("file-change", "fileChange", {
      kind: "fileChange",
      semanticKind: "patch",
      fileChange: {
        changes: buildCodexFileChangeMap([{ type: "add", path: "src/app.ts", content: "line\n" }]),
      },
    });
    const approvedThenFile = groupAgentBlocks([
      buildBlock("review-approved", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        rawItem: { review: { status: "approved", rationale: "Approved" } },
      }),
      fileChange,
    ]);
    const hookThenFile = groupAgentBlocks([
      buildBlock("hook", "hook", { semanticKind: "hook" }),
      fileChange,
    ]);

    expect(approvedThenFile.map((entry) => entry.type).join(",")).toBe("automaticApprovalReview,collapsedToolActivity");
    const approvedFileGroup = approvedThenFile[1];
    expect(approvedFileGroup?.type === "collapsedToolActivity" ? approvedFileGroup.entries.map((entry) => entry.type).join(",") : "").toBe(
      "fileChange",
    );
    expect(hookThenFile.map((entry) => entry.type).join(",")).toBe("hook,collapsedToolActivity");
    const hookFileGroup = hookThenFile[1];
    expect(hookFileGroup?.type === "collapsedToolActivity" ? hookFileGroup.entries.map((entry) => entry.type).join(",") : "").toBe(
      "fileChange",
    );
  });

  test("pre-groups consecutive same-action multi-agent actions before collapsed activity", () => {
    const grouped = groupAgentBlocks([
      buildBlock("spawn-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "completed",
        rawItem: multiAgentRawItem("spawn-1", "spawnAgent", "completed"),
      }),
      buildBlock("spawn-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "inProgress",
        rawItem: multiAgentRawItem("spawn-2", "spawnAgent", "inProgress"),
      }),
      buildBlock("send-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "completed",
        rawItem: multiAgentRawItem("send-1", "sendInput", "completed"),
      }),
      buildBlock("send-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "completed",
        rawItem: multiAgentRawItem("send-2", "sendInput", "completed"),
      }),
      buildBlock("close-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "failed",
        rawItem: multiAgentRawItem("close-1", "closeAgent", "failed"),
      }),
      buildBlock("close-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "completed",
        rawItem: multiAgentRawItem("close-2", "closeAgent", "completed"),
      }),
      buildBlock("resume-1", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "interrupted",
        rawItem: multiAgentRawItem("resume-1", "resumeAgent", "completed"),
      }),
      buildBlock("resume-2", "multiAgentAction", {
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "declined",
        rawItem: multiAgentRawItem("resume-2", "resumeAgent", "completed"),
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe(
      "multiAgentGroup,multiAgentGroup,multiAgentGroup,multiAgentGroup",
    );
    const spawnGroup = grouped[0];
    const sendGroup = grouped[1];
    const closeGroup = grouped[2];
    const resumeGroup = grouped[3];
    expect(spawnGroup?.type === "multiAgentGroup" ? spawnGroup.entries.length : 0).toBe(2);
    expect(spawnGroup?.type === "multiAgentGroup" ? spawnGroup.status : "").toBe("inProgress");
    expect(sendGroup?.type === "multiAgentGroup" ? sendGroup.entries.length : 0).toBe(2);
    expect(sendGroup?.type === "multiAgentGroup" ? sendGroup.status : "").toBe("completed");
    expect(closeGroup?.type === "multiAgentGroup" ? closeGroup.entries.length : 0).toBe(2);
    expect(closeGroup?.type === "multiAgentGroup" ? closeGroup.status : "").toBe("failed");
    expect(resumeGroup?.type === "multiAgentGroup" ? resumeGroup.entries.length : 0).toBe(2);
    expect(resumeGroup?.type === "multiAgentGroup" ? resumeGroup.status : "").toBe("completed");
  });

  test("does not create a generic completed-actions group for unsupported rows", () => {
    const grouped = groupAgentBlocks([
      buildBlock("cmd-1", "exec", { command: "true", commandActions: [] }),
      buildBlock("elicitation", "mcpServerElicitation", { semanticKind: "mcpServerElicitation" }),
      buildBlock("cmd-2", "exec", { command: "false", commandActions: [] }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("exec,mcpServerElicitation,exec");
  });

  test("groups pending MCP tool calls after collapsed and dynamic grouping", () => {
    const grouped = groupAgentBlocks([
      dynamicBlock("dynamic-1", "read_thread"),
      dynamicBlock("dynamic-2", "send_message_to_thread"),
      mcpBlock("mcp-1", { tool: "click" }),
      mcpBlock("mcp-2", { tool: "scroll" }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("dynamicToolCallGroup,pendingMcpToolCalls");
    const group = grouped[1];
    expect(group?.type === "pendingMcpToolCalls" ? group.entries.length : 0).toBe(2);
    expect(group?.type === "pendingMcpToolCalls" ? group.summary : "").toBe("Using the browser");
  });

  test("splits pending MCP tool calls by source", () => {
    const grouped = groupAgentBlocks([
      mcpBlock("browser-1", { server: "browser-use", tool: "click" }),
      mcpBlock("browser-2", { server: "browser-use", tool: "scroll" }),
      mcpBlock("docs-1", { server: "docs", tool: "read" }),
      mcpBlock("docs-2", { server: "docs", tool: "search" }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("pendingMcpToolCalls,pendingMcpToolCalls");
    expect(grouped[0]?.type === "pendingMcpToolCalls" ? grouped[0].entries.length : 0).toBe(2);
    expect(grouped[1]?.type === "pendingMcpToolCalls" ? grouped[1].entries.length : 0).toBe(2);
    expect(grouped[0]?.type === "pendingMcpToolCalls" ? grouped[0].entries[0]?.entry.mcpToolCall?.invocation.server ?? "" : "").toBe("browser-use");
    expect(grouped[1]?.type === "pendingMcpToolCalls" ? grouped[1].entries[0]?.entry.mcpToolCall?.invocation.server ?? "" : "").toBe("docs");
  });

  test("does not pending-group computer-use or MCP app resource tool calls", () => {
    const grouped = groupAgentBlocks([
      mcpBlock("computer-1", { server: "computer-use", tool: "click" }),
      mcpBlock("computer-2", { server: "computer-use", tool: "type" }),
      mcpBlock("plugin-1", { server: "docs", tool: "read", pluginId: "plugin-docs" }),
      mcpBlock("plugin-2", { server: "docs", tool: "search", pluginId: "plugin-docs" }),
      mcpBlock("app-1", { server: "docs", tool: "read", mcpAppResourceUri: "mcp-app://docs" }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("mcpToolCall,mcpToolCall,pendingMcpToolCalls,mcpToolCall");
    expect(grouped[2]?.type === "pendingMcpToolCalls" ? grouped[2].entries.length : 0).toBe(2);
  });

  test("keeps a single latest live pending MCP call grouped", () => {
    const settled = materializeAgentRenderUnits(buildAgentRenderUnits([
      mcpBlock("mcp-1", { server: "browser-use", tool: "click" }),
    ]));
    const liveLatest = materializeAgentRenderUnits(buildAgentRenderUnits([
      mcpBlock("mcp-1", { server: "browser-use", tool: "click" }),
    ], {
      keepLatestLiveActivityInGroup: true,
    }));
    const excluded = materializeAgentRenderUnits(buildAgentRenderUnits([
      mcpBlock("computer-1", { server: "computer-use", tool: "click" }),
    ], {
      keepLatestLiveActivityInGroup: true,
    }));

    expect(settled.map((entry) => entry.type).join(",")).toBe("mcpToolCall");
    expect(liveLatest.map((entry) => entry.type).join(",")).toBe("pendingMcpToolCalls");
    expect(liveLatest[0]?.type === "pendingMcpToolCalls" ? liveLatest[0].entries.length : 0).toBe(1);
    expect(excluded.map((entry) => entry.type).join(",")).toBe("mcpToolCall");
  });

  test("keeps completed MCP runs in the live open pending group pass", () => {
    const settled = materializeAgentRenderUnits(buildAgentRenderUnits([
      mcpBlock("mcp-1", { server: "node_repl", tool: "js", status: "completed" }),
      mcpBlock("mcp-2", { server: "node_repl", tool: "js", status: "completed" }),
    ]));
    const liveLatest = materializeAgentRenderUnits(buildAgentRenderUnits([
      mcpBlock("mcp-1", { server: "node_repl", tool: "js", status: "completed" }),
      mcpBlock("mcp-2", { server: "node_repl", tool: "js", status: "completed" }),
    ], {
      keepLatestLiveActivityInGroup: true,
    }));

    expect(settled.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(liveLatest.map((entry) => entry.type).join(",")).toBe("pendingMcpToolCalls");
    expect(liveLatest[0]?.type === "pendingMcpToolCalls" ? liveLatest[0].entries.length : 0).toBe(2);
  });

  test("groups consecutive dynamic tool calls without requiring identical arguments or outputs", () => {
    const dynamicEntry = {
      kind: "toolCall" as const,
      semanticKind: "dynamicToolCall" as const,
      status: "completed" as const,
      dynamicToolCall: {
        callId: "dynamic-1",
        namespace: "codex_app",
        tool: "read_thread",
        arguments: { threadId: "thread-1" },
        status: "completed" as const,
        contentItems: [{ type: "inputText" as const, text: "{\"schemaVersion\":1}" }],
        success: true,
        durationMs: 1,
        completed: true,
      },
    };
    const grouped = groupAgentBlocks([
      buildBlock("dynamic-1", "dynamicToolCall", dynamicEntry),
      buildBlock("dynamic-2", "dynamicToolCall", {
        ...dynamicEntry,
        dynamicToolCall: {
          ...dynamicEntry.dynamicToolCall,
          callId: "dynamic-2",
          tool: "send_message_to_thread",
          arguments: { threadId: "thread-2" },
          contentItems: [{ type: "inputText" as const, text: "{\"ok\":true}" }],
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("dynamicToolCallGroup");
    const group = grouped[0];
    expect(group?.type === "dynamicToolCallGroup" ? group.repeatCount : 0).toBe(2);
    expect(group?.type === "dynamicToolCallGroup" ? group.summary : "").toBe("Read thread · Sent message to thread");
    expect(group?.type === "dynamicToolCallGroup" ? group.summaryParts?.map((part) => `${part.label}:${part.count}`).join(",") ?? "" : "").toBe(
      "Read thread:1,Sent message to thread:1",
    );
  });

  test("groups dynamic runs after collapsed activity grouping", () => {
    const fileChange = buildBlock("file-change", "fileChange", {
      kind: "fileChange",
      semanticKind: "patch",
      fileChange: {
        changes: buildCodexFileChangeMap([{ type: "update", path: "src/app.ts", unifiedDiff: "@@ -1 +1 @@\n-a\n+b\n", movePath: null }]),
      },
    });
    const dynamicEntry = {
      kind: "toolCall" as const,
      semanticKind: "dynamicToolCall" as const,
      status: "completed" as const,
      dynamicToolCall: {
        callId: "dynamic-1",
        namespace: "codex_app",
        tool: "read_thread",
        arguments: { threadId: "thread-1" },
        status: "completed" as const,
        contentItems: [{ type: "inputText" as const, text: "{\"schemaVersion\":1}" }],
        success: true,
        durationMs: 1,
        completed: true,
      },
    };
    const grouped = groupAgentBlocks([
      fileChange,
      buildBlock("dynamic-1", "dynamicToolCall", dynamicEntry),
      buildBlock("dynamic-2", "dynamicToolCall", {
        ...dynamicEntry,
        dynamicToolCall: {
          ...dynamicEntry.dynamicToolCall,
          callId: "dynamic-2",
          arguments: { threadId: "thread-2" },
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity,dynamicToolCallGroup");
    const activityGroup = grouped[0];
    const dynamicGroup = grouped[1];
    expect(activityGroup?.type === "collapsedToolActivity" ? activityGroup.entries.map((entry) => entry.type).join(",") : "").toBe("fileChange");
    expect(dynamicGroup?.type === "dynamicToolCallGroup" ? dynamicGroup.summary : "").toBe("Read thread 2 times");
  });

  test("keeps standalone dynamic thread handoff calls out of dynamic groups", () => {
    const baseDynamic = {
      kind: "toolCall" as const,
      semanticKind: "dynamicToolCall" as const,
      status: "completed" as const,
      dynamicToolCall: {
        callId: "dynamic-1",
        namespace: "codex_app",
        tool: "read_thread",
        arguments: { threadId: "thread-1" },
        status: "completed" as const,
        contentItems: [{ type: "inputText" as const, text: "{\"schemaVersion\":1}" }],
        success: true,
        durationMs: 1,
        completed: true,
      },
    };
    const grouped = groupAgentBlocks([
      buildBlock("dynamic-1", "dynamicToolCall", baseDynamic),
      buildBlock("handoff", "dynamicToolCall", {
        ...baseDynamic,
        dynamicToolCall: {
          ...baseDynamic.dynamicToolCall,
          callId: "handoff",
          tool: "handoff_thread",
          arguments: { threadId: "thread-1", destinationHostId: "host-1" },
        },
      }),
      buildBlock("dynamic-2", "dynamicToolCall", {
        ...baseDynamic,
        dynamicToolCall: {
          ...baseDynamic.dynamicToolCall,
          callId: "dynamic-2",
          arguments: { threadId: "thread-2" },
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("dynamicToolCall,dynamicToolCall,dynamicToolCall");
  });

  test("keeps a single latest live continuing dynamic tool grouped", () => {
    const settled = materializeAgentRenderUnits(buildAgentRenderUnits([
      dynamicBlock("dynamic-1", "read_thread"),
    ]));
    const liveContinuing = materializeAgentRenderUnits(buildAgentRenderUnits([
      dynamicBlock("dynamic-1", "read_thread"),
    ], {
      keepLatestLiveActivityInGroup: true,
    }));
    const liveNonContinuing = materializeAgentRenderUnits(buildAgentRenderUnits([
      dynamicBlock("dynamic-1", "send_message_to_thread"),
    ], {
      keepLatestLiveActivityInGroup: true,
    }));

    expect(settled.map((entry) => entry.type).join(",")).toBe("dynamicToolCall");
    expect(liveContinuing.map((entry) => entry.type).join(",")).toBe("dynamicToolCallGroup");
    expect(liveContinuing[0]?.type === "dynamicToolCallGroup" ? liveContinuing[0].repeatCount : 0).toBe(1);
    expect(liveNonContinuing.map((entry) => entry.type).join(",")).toBe("dynamicToolCall");
  });

  test("marks all-summary-only dynamic groups as non-expandable", () => {
    const baseDynamic = {
      kind: "toolCall" as const,
      semanticKind: "dynamicToolCall" as const,
      status: "completed" as const,
      dynamicToolCall: {
        callId: "status-1",
        namespace: "codex_app",
        tool: "get_handoff_status",
        arguments: { operationId: "operation-1" },
        status: "completed" as const,
        contentItems: [{ type: "inputText" as const, text: "{\"status\":\"done\"}" }],
        success: true,
        durationMs: 1,
        completed: true,
      },
    };
    const grouped = groupAgentBlocks([
      buildBlock("status-1", "dynamicToolCall", baseDynamic),
      buildBlock("status-2", "dynamicToolCall", {
        ...baseDynamic,
        dynamicToolCall: {
          ...baseDynamic.dynamicToolCall,
          callId: "status-2",
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("dynamicToolCallGroup");
    const group = grouped[0];
    expect(group?.type === "dynamicToolCallGroup" ? group.canExpand === false : false).toBe(true);
  });

  test("extracts typed collapsed activity summary facts", () => {
    const patchFact = buildCollapsedToolActivitySummaryFact(buildBlock("create", "fileChange", {
      kind: "fileChange",
      semanticKind: "patch",
      status: "inProgress",
      fileChange: {
        changes: buildCodexFileChangeMap([{ type: "add", path: "src/new.ts", content: "one\ntwo\n" }]),
      },
    }));
    const explorationFact = buildCollapsedToolActivitySummaryFact({
      id: "exploration",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 1,
      searchableText: "",
      type: "explorationGroup",
      summary: "Exploration",
      status: "inProgress",
      entries: [
        buildEntry("read", {
          status: "completed",
          commandActions: [{ type: "read", command: "cat src/app.ts", name: "src/app.ts", path: "src/app.ts" }],
        }),
        buildEntry("search", {
          status: "inProgress",
          commandActions: [{ type: "search", command: "rg parity", query: "parity", path: null }],
        }),
        buildEntry("list", {
          status: "completed",
          commandActions: [{ type: "listFiles", command: "ls src", path: "src" }],
        }),
      ],
    });
    const execFact = buildCollapsedToolActivitySummaryFact(buildBlock("exec", "exec", {
      status: "inProgress",
      commandActions: [{ type: "unknown", command: "bun test" }],
    }));
    const mcpFact = buildCollapsedToolActivitySummaryFact(mcpBlock("mcp", { server: "browser-use", tool: "click" }));
    const webFact = buildCollapsedToolActivitySummaryFact({
      id: "web-group",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "",
      type: "webSearchGroup",
      status: "inProgress",
      entries: [
        buildBlock("web-1", "webSearch", { status: "completed", markdownText: "Codex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
        buildBlock("web-2", "webSearch", { status: "inProgress", markdownText: "Nodex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
      ],
    });
    const approvalFact = buildCollapsedToolActivitySummaryFact(buildBlock("review-denied", "automaticApprovalReview", {
      kind: "systemEvent",
      semanticKind: "automaticApprovalReview",
      status: "completed",
      rawItem: {
        review: { status: "denied" },
      },
    }));
    const otherFact = buildCollapsedToolActivitySummaryFact(buildBlock("hook", "hook", {
      kind: "toolCall",
      semanticKind: "hook",
      status: "inProgress",
    }));

    expect([patchFact, explorationFact, execFact, mcpFact, webFact, approvalFact, otherFact].map((fact) => fact.type).join(",")).toBe(
      "patch,exploration,exec,mcpToolCall,webSearch,automaticApprovalReview,other",
    );
    expect(patchFact.type === "patch" ? Array.from(patchFact.createdPaths).join(",") : "").toBe("src/new.ts");
    expect(patchFact.type === "patch" ? patchFact.createdPaths.size : 0).toBe(1);
    expect(patchFact.type === "patch" ? patchFact.runningCreatedLineCount : 0).toBe(2);
    expect(explorationFact.type === "exploration" ? Array.from(explorationFact.readPaths).join(",") : "").toBe("src/app.ts");
    expect(explorationFact.type === "exploration" ? explorationFact.searchCount : 0).toBe(1);
    expect(explorationFact.type === "exploration" ? explorationFact.runningSearchCount : 0).toBe(1);
    expect(explorationFact.type === "exploration" ? explorationFact.listCount : 0).toBe(1);
    expect(execFact.type === "exec" ? execFact.isInProgress : false).toBe(true);
    expect(mcpFact.type === "mcpToolCall" ? mcpFact.source?.key ?? "" : "").toBe("browser-use");
    expect(mcpFact.type === "mcpToolCall" ? mcpFact.source?.name ?? "" : "").toBe("browser-use");
    expect(webFact.type === "webSearch" ? `${webFact.count}:${webFact.runningCount}` : "").toBe("2:1");
    expect(approvalFact.type === "automaticApprovalReview" ? approvalFact.status : "").toBe("denied");
  });

  test("resolves active file-change summaries from the latest path-keyed patch entry", () => {
    const summary = resolveCollapsedToolActivityActiveSummary([
      buildBlock("patch", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([
            { type: "add", path: "src/first.ts", content: "first\n" },
            {
              type: "update",
              path: "src/latest.ts",
              movePath: null,
              unifiedDiff: [
                "@@ -1,1 +1,2 @@",
                "-old",
                "+new",
                "+extra",
              ].join("\n"),
            },
          ]),
        },
      }),
    ]);

    expect(summary?.kind ?? "").toBe("fileChange");
    expect(summary?.key ?? "").toBe("patch");
    expect(summary?.kind === "fileChange" ? summary.label : "").toBe("Editing");
    expect(summary?.kind === "fileChange" ? summary.displayPath : "").toBe("src/latest.ts");
    expect(summary?.kind === "fileChange" ? `${summary.additions}:${summary.deletions}` : "").toBe("2:1");
  });

  test("resolves collapsed activity running summaries with completed continuity fallback", () => {
    const runningCommand = buildBlock("run", "exec", {
      status: "inProgress",
      command: "bun test",
      commandActions: [{ type: "unknown", command: "bun test" }],
    });
    const completedPatch = buildBlock("patch-done", "fileChange", {
      kind: "fileChange",
      semanticKind: "patch",
      status: "completed",
      fileChange: {
        changes: buildCodexFileChangeMap([{
          type: "update",
          path: "src/done.ts",
          movePath: null,
          unifiedDiff: [
            "@@ -1,1 +1,1 @@",
            "-old",
            "+new",
          ].join("\n"),
        }]),
      },
    });
    const activePreferred = resolveCollapsedToolActivityActiveSummary([runningCommand, completedPatch]);
    const completedActive = resolveCollapsedToolActivityActiveSummary([completedPatch]);
    const completedFallback = resolveCollapsedToolActivitySummaryCues([completedPatch]).continuitySummary;

    expect(activePreferred?.kind ?? "").toBe("text");
    expect(activePreferred?.label ?? "").toBe("Running bun test");
    expect(completedActive).toBe(null);
    expect(completedFallback?.kind ?? "").toBe("fileChange");
    expect(completedFallback?.kind === "fileChange" ? completedFallback.label : "").toBe("Editing");
    expect(shouldDisplayCollapsedToolActivityActiveSummary(completedFallback, "STEPS_COMMANDS")).toBe(true);
    expect(shouldDisplayCollapsedToolActivityActiveSummary(completedFallback, "STEPS_PROSE")).toBe(false);
  });

  test("resolves active summaries for exploration, web search, and approval fallback rows", () => {
    const explorationSummary = resolveCollapsedToolActivityActiveSummary([{
      id: "exploration",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 1,
      searchableText: "",
      type: "explorationGroup",
      summary: "Exploration",
      status: "inProgress",
      entries: [
        buildEntry("read-skill", {
          status: "inProgress",
          commandActions: [{
            type: "read",
            command: "cat /Users/asc/.codex/skills/browser/SKILL.md",
            name: "SKILL.md",
            path: "/Users/asc/.codex/skills/browser/SKILL.md",
          }],
        }),
      ],
    }]);
    const webSummary = resolveCollapsedToolActivityActiveSummary([{
      id: "web-group",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "",
      type: "webSearchGroup",
      status: "inProgress",
      entries: [
        buildBlock("web-1", "webSearch", {
          status: "completed",
          toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "old query" } },
        }) as ThreadTranscriptBlockModel & { type: "webSearch" },
        buildBlock("web-2", "webSearch", {
          status: "inProgress",
          toolCall: {
            toolName: "web",
            subtype: "webSearch",
            result: {
              type: "search",
              query: "site:github.com/openai/codex latest OR site:www.example.com docs",
            },
          },
        }) as ThreadTranscriptBlockModel & { type: "webSearch" },
      ],
    }]);
    const approvalSummary = resolveCollapsedToolActivitySummaryCues([
      buildBlock("approval", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: { status: "approved" },
      }),
    ]).continuitySummary;

    expect(explorationSummary?.label ?? "").toBe("Reading Browser skill");
    expect(webSummary?.label ?? "").toBe("Searching the web for latest docs | github.com \u00b7 example.com");
    expect(approvalSummary?.label ?? "").toBe("Approved request");
  });

  test("formats file and list-only summaries without Completed actions fallback", () => {
    const fileStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("create", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: { changes: buildCodexFileChangeMap([{ type: "add", path: "new.ts", content: "" }]) },
      }),
      buildBlock("delete", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: { changes: buildCodexFileChangeMap([{ type: "delete", path: "old.ts", content: "" }]) },
      }),
    ]);
    const fileSummary = buildCollapsedToolActivitySummary(fileStats);

    const listStats = collectCollapsedToolActivitySummaryStats([
      {
        id: "exploration",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "",
        type: "explorationGroup",
        summary: "Exploration",
        status: "completed",
        entries: [
          buildEntry("list", {
            commandActions: [{ type: "listFiles", command: "ls", path: null }],
          }),
        ],
      },
    ]);
    const listSummary = buildCollapsedToolActivitySummary(listStats);

    expect(fileSummary?.summary ?? "").toBe("Created a file, deleted a file");
    expect(listSummary?.summary ?? "").toBe("Listed files");
  });

  test("tracks MCP summary sources by Electron source key with running counts", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      mcpBlock("browser-completed", {
        status: "completed",
        rawItem: { source: { kind: "browserUse", backend: "iab" } },
      }),
      mcpBlock("browser-running", {
        status: "inProgress",
        rawItem: { source: { kind: "browserUse", backend: "iab" } },
      }),
    ]);

    expect(stats.mcpToolCallSources.map((source) => `${source.key}:${source.name}:${source.count}:${source.runningCount}`).join("|")).toBe(
      "browser-use:browser-use:2:1",
    );
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe(
      "Used the browser integration, using the browser integration",
    );
  });

  test("prefers built-in MCP source kind over incidental raw source keys", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      mcpBlock("chrome-browser", {
        status: "completed",
        rawItem: {
          source: {
            kind: "browserUse",
            backend: "chrome",
            key: "navigate_to_codex_page",
            name: "Codex",
          },
        },
      }),
    ]);

    const source = stats.mcpToolCallSources[0];
    expect(source?.key ?? "").toBe("browser-use:chrome");
    expect(source?.name ?? "").toBe("Chrome");
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Used Chrome integration");
  });

  test("extracts computer-use native app sources from Electron argument fields", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      mcpBlock("chrome-computer-use", {
        server: "computer-use",
        tool: "click",
        status: "inProgress",
        arguments: {
          currentApp: {
            bundleIdentifier: "com.google.Chrome",
            displayName: "Google Chrome",
          },
        },
      }),
      mcpBlock("preview-computer-use", {
        server: "computer-use",
        tool: "type_text",
        status: "completed",
        arguments: {
          target_app_name: "Preview",
          text: "hello",
        },
      }),
    ]);

    expect(stats.mcpToolCallSources.map((source) => `${source.key}:${source.name}:${source.count}:${source.runningCount}`).join("|")).toBe(
      "native-app:chrome:Chrome:1:1|native-app:Preview:Preview:1:0",
    );
    expect(JSON.stringify(stats.mcpToolCallSources[0]?.nativeAppReference ?? null)).toBe(
      "{\"kind\":\"appId\",\"appId\":\"com.google.Chrome\"}",
    );
    expect(JSON.stringify(stats.mcpToolCallSources[1]?.nativeAppReference ?? null)).toBe(
      "{\"kind\":\"displayName\",\"displayName\":\"Preview\"}",
    );
  });

  test("formats node_repl MCP sources as command activity", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      mcpBlock("node-completed", { server: "node_repl", tool: "js", status: "completed" }),
      mcpBlock("node-running", { server: "node_repl", tool: "js", status: "inProgress" }),
    ]);

    expect(stats.mcpToolCallSources.map((source) => `${source.key}:${source.count}:${source.runningCount}`).join("|")).toBe(
      "server:node_repl:2:1",
    );
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Ran a command, running a command");
  });

  test("preserves MCP app source metadata and merges loaded tools with integrations", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      {
        id: "skill-load",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "",
        type: "explorationGroup",
        summary: "Exploration",
        status: "completed",
        entries: [
          buildEntry("read-skill", {
            commandActions: [{
              type: "read",
              command: "cat /Users/asc/.codex/skills/browser/SKILL.md",
              name: "SKILL.md",
              path: "/Users/asc/.codex/skills/browser/SKILL.md",
            }],
          }),
        ],
      },
      mcpBlock("docs-app", {
        server: "docs",
        tool: "search",
        status: "completed",
        rawItem: {
          app: {
            id: "docs",
            name: "Docs",
            logoUrl: "https://example.test/docs-light.png",
            logoUrlDark: "https://example.test/docs-dark.png",
          },
        },
      }),
    ]);

    expect(stats.mcpToolCallSources.map((source) => `${source.key}:${source.name}:${source.logoUrl ?? ""}:${source.logoUrlDark ?? ""}`).join("|")).toBe(
      "app:docs:Docs:https://example.test/docs-light.png:https://example.test/docs-dark.png",
    );
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Loaded a tool and used Docs");
  });

  test("formats raw non-integration MCP source keys without integration suffix", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      mcpBlock("codex-nav", {
        server: "codex_app",
        tool: "navigate_to_codex_page",
        status: "completed",
        rawItem: {
          source: {
            key: "navigate_to_codex_page",
            name: "Codex",
          },
        },
      }),
    ]);

    expect(stats.mcpToolCallSources.map((source) => `${source.key}:${source.name}:${source.count}:${source.runningCount}`).join("|")).toBe(
      "navigate_to_codex_page:Codex:1:0",
    );
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Used Codex");
  });

  test("dedupes automatic approval review failures by review id across summary facts", () => {
    const duplicatedDeniedReview = buildEntry("attached-review", {
      itemId: "review-wrapper-a",
      entryId: "review-wrapper-a",
      type: "automaticApprovalReview",
      kind: "systemEvent",
      semanticKind: "automaticApprovalReview",
      status: "completed",
      rawItem: {
        id: "review-shared",
        review: { status: "denied" },
      },
    });
    const fileChange = {
      ...buildBlock("file-change", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "src/app.ts", content: "line\n" }]),
        },
      }),
      automaticApprovalReviews: [duplicatedDeniedReview],
    };
    const stats = collectCollapsedToolActivitySummaryStats([
      fileChange,
      buildBlock("same-review-timeout", "automaticApprovalReview", {
        itemId: "review-wrapper-b",
        entryId: "review-wrapper-b",
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          id: "review-shared",
          review: { status: "timedOut" },
        },
      }),
      buildBlock("other-review-timeout", "automaticApprovalReview", {
        itemId: "review-timeout",
        entryId: "review-timeout",
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          review: { status: "timedOut" },
        },
      }),
      buildBlock("approved-review", "automaticApprovalReview", {
        itemId: "review-approved",
        entryId: "review-approved",
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          review: { status: "approved" },
        },
      }),
    ]);

    expect(stats.deniedRequestCount).toBe(1);
    expect(stats.timedOutRequestCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe(
      "Created a file, denied request, request timed out",
    );
  });

  test("formats exploration summaries from parsed command actions", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      {
        id: "exploration",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "",
        type: "explorationGroup",
        summary: "Exploration",
        status: "completed",
        entries: [
          buildEntry("read", {
            commandActions: [{ type: "read", command: "cat src/app.ts", name: "src/app.ts", path: "src/app.ts" }],
          }),
          buildEntry("search", {
            commandActions: [{ type: "search", command: "rg parity", query: "parity", path: null }],
          }),
          buildEntry("list", {
            commandActions: [{ type: "listFiles", command: "fd", path: null }],
          }),
        ],
      },
    ]);

    expect(stats.exploredFileCount).toBe(1);
    expect(stats.searchCount).toBe(1);
    expect(stats.listCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Read a file, searched code, and listed files");
  });

  test("formats Electron-style command summary specials", () => {
    const folderStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("mkdir", "exec", {
        status: "inProgress",
        command: "mkdir -p generated/reports",
        commandActions: [],
      }),
    ]);
    const webStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("curl-ok", "exec", {
        command: "curl https://developers.openai.com/codex/app-server",
        commandActions: [],
        exitCode: 0,
      }),
    ]);
    const failedCurlStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("curl-failed", "exec", {
        command: "curl https://developers.openai.com/codex/app-server",
        commandActions: [],
        exitCode: 7,
      }),
    ]);
    const localCurlStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("curl-local", "exec", {
        command: "curl http://localhost:5173",
        commandActions: [],
        exitCode: 0,
      }),
    ]);
    const mutatingCurlStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("curl-post", "exec", {
        command: "curl -X POST https://api.example.com/items",
        commandActions: [],
        exitCode: 0,
      }),
    ]);
    const mixedRunningStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("mkdir-running", "exec", {
        status: "inProgress",
        command: "mkdir generated",
        commandActions: [],
      }),
      buildBlock("test-running", "exec", {
        status: "inProgress",
        command: "bun test",
        commandActions: [],
      }),
    ]);

    expect(folderStats.runningFolderCreationCommandCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(folderStats)?.summary ?? "").toBe("Creating folder");
    expect(webStats.completedWebSearchCommandCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(webStats)?.summary ?? "").toBe("Searched the web");
    expect(buildCollapsedToolActivitySummary(webStats, { showRunningCommandSummary: false })?.summary ?? "").toBe(
      "Ran a command",
    );
    expect(failedCurlStats.completedWebSearchCommandCount).toBe(0);
    expect(buildCollapsedToolActivitySummary(failedCurlStats)?.summary ?? "").toBe("Ran a command");
    expect(localCurlStats.completedWebSearchCommandCount).toBe(0);
    expect(buildCollapsedToolActivitySummary(localCurlStats)?.summary ?? "").toBe("Ran a command");
    expect(mutatingCurlStats.completedWebSearchCommandCount).toBe(0);
    expect(buildCollapsedToolActivitySummary(mutatingCurlStats)?.summary ?? "").toBe("Ran a command");
    expect(mixedRunningStats.runningFolderCreationCommandCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(mixedRunningStats)?.summary ?? "").toBe("Running 2 commands");
  });

  test("formats standalone web-search summaries without count suffixes", () => {
    const completedStats = collectCollapsedToolActivitySummaryStats([{
      id: "web-completed",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "",
      type: "webSearchGroup",
      status: "completed",
      entries: [
        buildBlock("web-1", "webSearch", { status: "completed", markdownText: "Codex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
        buildBlock("web-2", "webSearch", { status: "completed", markdownText: "Nodex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
      ],
    }]);
    const runningStats = collectCollapsedToolActivitySummaryStats([{
      id: "web-running",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "",
      type: "webSearchGroup",
      status: "inProgress",
      entries: [
        buildBlock("web-3", "webSearch", { status: "completed", markdownText: "Codex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
        buildBlock("web-4", "webSearch", { status: "inProgress", markdownText: "Nodex" }) as ThreadTranscriptBlockModel & { type: "webSearch" },
      ],
    }]);

    expect(`${completedStats.webSearchCount}:${completedStats.runningWebSearchCount}`).toBe("2:0");
    expect(buildCollapsedToolActivitySummary(completedStats)?.summary ?? "").toBe("Searched the web");
    expect(`${runningStats.webSearchCount}:${runningStats.runningWebSearchCount}`).toBe("2:1");
    expect(buildCollapsedToolActivitySummary(runningStats)?.summary ?? "").toBe("Searching the web");
  });

  test("counts standalone running web-search rows in total summary facts", () => {
    const runningFact = buildCollapsedToolActivitySummaryFact(
      buildBlock("web-running", "webSearch", {
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex" } },
      }),
    );
    const runningStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("web-running", "webSearch", {
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex" } },
      }),
    ]);

    expect(runningFact.type === "webSearch" ? `${runningFact.count}:${runningFact.runningCount}` : "").toBe("1:1");
    expect(`${runningStats.webSearchCount}:${runningStats.runningWebSearchCount}`).toBe("1:1");
    expect(buildCollapsedToolActivitySummary(runningStats)?.summary ?? "").toBe("Searching the web");
  });

  test("keeps current collapsed web-search running stats factual", () => {
    const settled = groupAgentBlocks([
      buildBlock("web-1", "webSearch", {
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
    ]);
    const current = groupAgentBlocks([
      buildBlock("web-1", "webSearch", {
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
    ], { keepLatestLiveActivityInGroup: true });
    const currentWithRunningChild = groupAgentBlocks([
      buildBlock("web-1", "webSearch", {
        status: "completed",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex app-server" } },
      }),
      buildBlock("web-2", "webSearch", {
        status: "inProgress",
        toolCall: { toolName: "web", subtype: "webSearch", result: { type: "search", query: "Codex Electron" } },
      }),
    ], { keepLatestLiveActivityInGroup: true });
    const settledGroup = settled[0];
    const currentGroup = current[0];
    const runningGroup = currentWithRunningChild[0];

    expect(settledGroup?.type === "collapsedToolActivity" ? `${settledGroup.summaryStats?.webSearchCount ?? 0}:${settledGroup.summaryStats?.runningWebSearchCount ?? 0}` : "").toBe("2:0");
    expect(settledGroup?.type === "collapsedToolActivity" ? settledGroup.summary : "").toBe("Searched the web");
    expect(currentGroup?.type === "collapsedToolActivity" ? `${currentGroup.summaryStats?.webSearchCount ?? 0}:${currentGroup.summaryStats?.runningWebSearchCount ?? 0}` : "").toBe("2:0");
    expect(currentGroup?.type === "collapsedToolActivity" ? currentGroup.summary : "").toBe("Searched the web");
    expect(runningGroup?.type === "collapsedToolActivity" ? `${runningGroup.summaryStats?.webSearchCount ?? 0}:${runningGroup.summaryStats?.runningWebSearchCount ?? 0}` : "").toBe("2:1");
    expect(runningGroup?.type === "collapsedToolActivity" ? runningGroup.summary : "").toBe("Searching the web");
  });

  test("formats skill definition reads as loaded tools", () => {
    const completedStats = collectCollapsedToolActivitySummaryStats([
      {
        id: "skill-load",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "",
        type: "explorationGroup",
        summary: "Exploration",
        status: "completed",
        entries: [
          buildEntry("read-skill", {
            commandActions: [{
              type: "read",
              command: "cat /Users/asc/.codex/skills/skill-creator/SKILL.md",
              name: "SKILL.md",
              path: "/Users/asc/.codex/skills/skill-creator/SKILL.md",
            }],
          }),
        ],
      },
    ]);
    const runningStats = collectCollapsedToolActivitySummaryStats([
      {
        id: "skill-load-running",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "",
        type: "explorationGroup",
        summary: "Exploration",
        status: "inProgress",
        entries: [
          buildEntry("read-skill-running", {
            status: "inProgress",
            commandActions: [{
              type: "read",
              command: "cat /Users/asc/.codex/skills/.system/imagegen/SKILL.md",
              name: "SKILL.md",
              path: "/Users/asc/.codex/skills/.system/imagegen/SKILL.md",
            }],
          }),
        ],
      },
    ]);

    expect(completedStats.loadedToolCount).toBe(1);
    expect(completedStats.exploredFileCount).toBe(0);
    expect(buildCollapsedToolActivitySummary(completedStats)?.summary ?? "").toBe("Loaded a tool");
    expect(runningStats.loadedToolCount).toBe(1);
    expect(runningStats.runningLoadedToolCount).toBe(1);
    expect(buildCollapsedToolActivitySummary(runningStats)?.summary ?? "").toBe("Loading a tool");
  });

  test("does not collapse fileChange blocks that have no renderable patch entries", () => {
    const grouped = groupAgentBlocks([
      buildBlock("empty-file-change", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([]),
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("fileChange");
  });

  test("formats file-change aggregate summaries with display-mode gated line counts", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      buildBlock("edit", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([{
            type: "update",
            path: "src/app.ts",
            movePath: null,
            unifiedDiff: [
              "@@ -1,1 +1,1 @@",
              "-old value",
              "+new value",
            ].join("\n"),
          }]),
        },
      }),
    ]);

    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Edited a file");
    expect(buildCollapsedToolActivitySummary(stats, { showFileChangeLineCount: true })?.summary ?? "").toBe(
      "Edited a file • 2 lines",
    );
  });

  test("deduplicates repeated edits to one path in aggregate file-change summaries", () => {
    const repeatedEditBlocks = Array.from({ length: 5 }, (_, index) =>
      buildBlock(`edit-${index}`, "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([{
            type: "update",
            path: "test30.txt",
            movePath: null,
            unifiedDiff: [
              "@@ -1,1 +1,1 @@",
              `-old value ${index}`,
              `+new value ${index}`,
            ].join("\n"),
          }]),
        },
      })
    );
    const grouped = groupAgentBlocks(repeatedEditBlocks);
    const group = grouped[0];
    const stats = group?.type === "collapsedToolActivity" ? group.summaryStats : undefined;

    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.summary : "").toBe("Edited a file");
    expect(stats?.editedFileCount ?? 0).toBe(1);
    expect(stats?.changedLineCount ?? 0).toBe(10);
    expect(group?.type === "collapsedToolActivity" ? group.entries.length : 0).toBe(5);
    expect(stats ? buildCollapsedToolActivitySummary(stats, { showFileChangeLineCount: true })?.summary ?? "" : "").toBe(
      "Edited a file • 10 lines",
    );
  });

  test("counts unique edited paths across repeated file-change rows", () => {
    const editBlocks = [
      ["edit-a-1", "src/app.ts"],
      ["edit-a-2", "src/app.ts"],
      ["edit-b-1", "src/other.ts"],
      ["edit-b-2", "src/other.ts"],
      ["edit-a-3", "src/app.ts"],
    ].map(([id, path], index) =>
      buildBlock(id, "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([{
            type: "update",
            path,
            movePath: null,
            unifiedDiff: [
              "@@ -1,1 +1,1 @@",
              `-old value ${index}`,
              `+new value ${index}`,
            ].join("\n"),
          }]),
        },
      })
    );
    const stats = collectCollapsedToolActivitySummaryStats(editBlocks);

    expect(stats.editedFileCount).toBe(2);
    expect(stats.changedLineCount).toBe(10);
    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Edited 2 files");
  });

  test("deduplicates repeated edits after creating the same path", () => {
    const grouped = groupAgentBlocks([
      buildBlock("create", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "test30.txt", content: "one\n" }]),
        },
      }),
      ...Array.from({ length: 4 }, (_, index) =>
        buildBlock(`edit-${index}`, "fileChange", {
          kind: "fileChange",
          semanticKind: "patch",
          fileChange: {
            changes: buildCodexFileChangeMap([{
              type: "update",
              path: "test30.txt",
              movePath: null,
              unifiedDiff: [
                "@@ -1,1 +1,1 @@",
                `-created value ${index}`,
                `+edited value ${index}`,
              ].join("\n"),
            }]),
          },
        })
      ),
    ]);
    const group = grouped[0];
    const stats = group?.type === "collapsedToolActivity" ? group.summaryStats : undefined;

    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.summary : "").toBe("Created a file, edited a file");
    expect(stats?.createdFileCount ?? 0).toBe(1);
    expect(stats?.editedFileCount ?? 0).toBe(1);
    expect(group?.type === "collapsedToolActivity" ? group.entries.length : 0).toBe(5);
  });

  test("formats running creation writing text separately from gated aggregate line counts", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      buildBlock("create-live", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "src/new.ts", content: "one\n" }]),
        },
      }),
    ]);

    expect(buildCollapsedToolActivitySummary(stats)?.summary ?? "").toBe("Creating a file • writing a line");
    expect(buildCollapsedToolActivitySummary(stats, { showFileChangeLineCount: true })?.summary ?? "").toBe(
      "Creating a file • 1 line",
    );
  });

  test("wraps one in-progress file change in a collapsed activity group", () => {
    const grouped = groupAgentBlocks([
      buildBlock("file-live", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "poem.md", content: "line\n" }]),
        },
      }),
    ]);

    const group = grouped[0];
    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.status ?? "" : "").toBe("inProgress");
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "fileChange",
    );
  });

  test("wraps one completed file change in a collapsed activity group", () => {
    const grouped = groupAgentBlocks([
      buildBlock("file-done", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "completed",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "poem.md", content: "line\n" }]),
        },
      }),
    ]);

    const group = grouped[0];
    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "fileChange",
    );
  });

  test("counts running MCP calls for collapsed summary shimmer state", () => {
    const stats = collectCollapsedToolActivitySummaryStats([
      buildBlock("mcp-running", "mcpToolCall", {
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "inProgress",
        mcpToolCall: {
          callId: "mcp-running",
          functionName: "computer-use__click",
          invocation: { server: "computer-use", tool: "click", arguments: {} },
          result: null,
          durationMs: null,
          completed: false,
        },
      }),
    ]);

    expect(stats.mcpToolCallCount).toBe(1);
    expect(stats.runningMcpToolCallCount).toBe(1);
  });

  test("attaches automatic approval reviews to target file changes and only counts failures", () => {
    const grouped = groupAgentBlocks([
      buildBlock("file-change", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          changes: buildCodexFileChangeMap([{ type: "add", path: "src/app.ts", content: "line\n" }]),
        },
      }),
      buildBlock("review-denied", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          targetItemId: "file-change",
          review: { status: "denied", riskLevel: "high", userAuthorization: "unknown", rationale: "Denied" },
        },
      }),
      buildBlock("review-aborted", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          targetItemId: "file-change",
          review: { status: "aborted", riskLevel: "low", userAuthorization: "low", rationale: "Aborted" },
        },
      }),
      buildBlock("review-timeout", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          targetItemId: "file-change",
          review: { status: "timedOut", riskLevel: "medium", userAuthorization: "unknown", rationale: "Timed out" },
        },
      }),
    ]);

    const group = grouped[0];
    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "fileChange",
    );
    const fileEntry = group?.type === "collapsedToolActivity" ? group.entries[0] : null;
    expect(fileEntry?.type === "fileChange" ? fileEntry.automaticApprovalReviews?.length ?? 0 : 0).toBe(3);
    expect(group?.type === "collapsedToolActivity" ? group.summaryStats?.deniedRequestCount ?? 0 : 0).toBe(1);
    expect(group?.type === "collapsedToolActivity" ? group.summaryStats?.timedOutRequestCount ?? 0 : 0).toBe(1);
  });

  test("attaches automatic approval reviews to command and MCP targets before summary folding", () => {
    const grouped = groupAgentBlocks([
      buildBlock("read-command", "exec", {
        commandActions: [readAction("src/app.ts")],
      }),
      buildBlock("review-read-denied", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          id: "review-read-denied",
          targetItemId: "read-command",
          review: { status: "denied", riskLevel: "high", userAuthorization: "unknown", rationale: "Denied" },
        },
      }),
      mcpBlock("browser-click", {
        status: "completed",
        completed: true,
        server: "browser-use",
        tool: "click",
      }),
      buildBlock("review-mcp-timeout", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          id: "review-mcp-timeout",
          targetItemId: "browser-click",
          review: { status: "timedOut", riskLevel: "medium", userAuthorization: "unknown", rationale: "Timed out" },
        },
      }),
    ]);

    const group = grouped[0];
    expect(grouped.map((entry) => entry.type).join(",")).toBe("collapsedToolActivity");
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup,mcpToolCall",
    );
    const explorationEntry = group?.type === "collapsedToolActivity" ? group.entries[0] : null;
    const mcpEntry = group?.type === "collapsedToolActivity" ? group.entries[1] : null;
    expect(explorationEntry?.type === "explorationGroup" ? explorationEntry.automaticApprovalReviews?.length ?? 0 : 0).toBe(1);
    expect(mcpEntry?.type === "mcpToolCall" ? mcpEntry.automaticApprovalReviews?.length ?? 0 : 0).toBe(1);
    expect(group?.type === "collapsedToolActivity" ? group.summaryStats?.deniedRequestCount ?? 0 : 0).toBe(1);
    expect(group?.type === "collapsedToolActivity" ? group.summaryStats?.timedOutRequestCount ?? 0 : 0).toBe(1);
  });

  test("folds attached automatic approval failures on standalone exec facts", () => {
    const grouped = groupAgentBlocks([
      buildBlock("command", "exec", {
        command: "bun test",
        commandActions: [],
      }),
      buildBlock("review-command-denied", "automaticApprovalReview", {
        kind: "systemEvent",
        semanticKind: "automaticApprovalReview",
        status: "completed",
        rawItem: {
          id: "review-command-denied",
          targetItemId: "command",
          review: { status: "denied", riskLevel: "high", userAuthorization: "unknown", rationale: "Denied" },
        },
      }),
    ]);

    const commandEntry = grouped[0];
    const stats = commandEntry?.type === "exec"
      ? collectCollapsedToolActivitySummaryStats([commandEntry])
      : null;
    expect(grouped.map((entry) => entry.type).join(",")).toBe("exec");
    expect(commandEntry?.type === "exec" ? commandEntry.automaticApprovalReviews?.length ?? 0 : 0).toBe(1);
    expect(stats?.commandCount ?? 0).toBe(1);
    expect(stats?.deniedRequestCount ?? 0).toBe(1);
  });
});
