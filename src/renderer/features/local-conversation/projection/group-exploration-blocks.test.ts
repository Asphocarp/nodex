import { describe, expect, test } from "bun:test";
import type { CodexCommandAction, CodexConversationItem, CodexSemanticItemKind } from "../../../lib/types";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";
import {
  buildCollapsedToolActivitySummary,
  collectCollapsedToolActivitySummaryStats,
  groupAgentEntries,
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

function readAction(name: string): CodexCommandAction {
  return { type: "read", command: `cat ${name}`, name, path: name };
}

describe("groupAgentEntries collapsed tool activity", () => {
  test("formats the Codex mixed exploration, command, and web summary", () => {
    const grouped = groupAgentEntries([
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
      "Explored 5 files, 1 search, ran 2 commands, searched web 1 time",
    );
    expect(group?.type === "collapsedToolActivity" ? group.entries.map((entry) => entry.type).join(",") : "").toBe(
      "explorationGroup,exec,exec,webSearch",
    );
  });

  test("does not create a generic completed-actions group for unsupported rows", () => {
    const grouped = groupAgentEntries([
      buildBlock("cmd-1", "exec", { command: "true", commandActions: [] }),
      buildBlock("elicitation", "mcpServerElicitation", { semanticKind: "mcpServerElicitation" }),
      buildBlock("cmd-2", "exec", { command: "false", commandActions: [] }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("exec,mcpServerElicitation,exec");
  });

  test("groups pending MCP tool calls before collapsed historical activity", () => {
    const grouped = groupAgentEntries([
      buildBlock("mcp-1", "mcpToolCall", {
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
      }),
      buildBlock("mcp-2", "mcpToolCall", {
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "inProgress",
        mcpToolCall: {
          callId: "mcp-2",
          functionName: "browser-use__scroll",
          invocation: { server: "browser-use", tool: "scroll", arguments: {} },
          result: null,
          durationMs: null,
          completed: false,
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("pendingMcpToolCalls");
    const group = grouped[0];
    expect(group?.type === "pendingMcpToolCalls" ? group.entries.length : 0).toBe(2);
    expect(group?.type === "pendingMcpToolCalls" ? group.summary : "").toBe("Using the browser");
  });

  test("groups repeated dynamic tool calls by stable arguments and outputs", () => {
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
    const grouped = groupAgentEntries([
      buildBlock("dynamic-1", "dynamicToolCall", dynamicEntry),
      buildBlock("dynamic-2", "dynamicToolCall", {
        ...dynamicEntry,
        dynamicToolCall: {
          ...dynamicEntry.dynamicToolCall,
          callId: "dynamic-2",
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("dynamicToolCallGroup");
    const group = grouped[0];
    expect(group?.type === "dynamicToolCallGroup" ? group.repeatCount : 0).toBe(2);
    expect(group?.type === "dynamicToolCallGroup" ? group.summary : "").toBe("Read thread");
  });

  test("formats file and list-only summaries without Completed actions fallback", () => {
    const fileStats = collectCollapsedToolActivitySummaryStats([
      buildBlock("create", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: { paths: ["new.ts"], diffs: [], changes: [{ type: "add", path: "new.ts", content: "" }] },
      }),
      buildBlock("delete", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: { paths: ["old.ts"], diffs: [], changes: [{ type: "delete", path: "old.ts", content: "" }] },
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

    expect(fileSummary?.summary ?? "").toBe("Created 1 file, deleted 1 file");
    expect(listSummary?.summary ?? "").toBe("Listed files");
  });

  test("wraps one in-progress file change in a collapsed activity group", () => {
    const grouped = groupAgentEntries([
      buildBlock("file-live", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          paths: ["poem.md"],
          diffs: [],
          changes: [{ type: "add", path: "poem.md", content: "line\n" }],
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

  test("keeps one completed file change as a normal row", () => {
    const grouped = groupAgentEntries([
      buildBlock("file-done", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "completed",
        fileChange: {
          paths: ["poem.md"],
          diffs: [],
          changes: [{ type: "add", path: "poem.md", content: "line\n" }],
        },
      }),
    ]);

    expect(grouped.map((entry) => entry.type).join(",")).toBe("fileChange");
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
});
