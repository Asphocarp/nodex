import { describe, expect, test } from "bun:test";
import type { CodexCommandAction, CodexConversationItem, CodexSemanticItemKind } from "../../../lib/types";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
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
        fileChange: { paths: ["new.ts"], diffs: [], changes: buildCodexFileChangeMap([{ type: "add", path: "new.ts", content: "" }]) },
      }),
      buildBlock("delete", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: { paths: ["old.ts"], diffs: [], changes: buildCodexFileChangeMap([{ type: "delete", path: "old.ts", content: "" }]) },
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

  test("does not collapse fileChange blocks that have no renderable patch entries", () => {
    const grouped = groupAgentEntries([
      buildBlock("empty-file-change", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          paths: ["src/app.ts"],
          diffs: [],
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
          paths: ["src/app.ts"],
          diffs: [],
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
          paths: ["test30.txt"],
          diffs: [],
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
    const grouped = groupAgentEntries(repeatedEditBlocks);
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

  test("deduplicates repeated edits after creating the same path", () => {
    const grouped = groupAgentEntries([
      buildBlock("create", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        fileChange: {
          paths: ["test30.txt"],
          diffs: [],
          changes: buildCodexFileChangeMap([{ type: "add", path: "test30.txt", content: "one\n" }]),
        },
      }),
      ...Array.from({ length: 4 }, (_, index) =>
        buildBlock(`edit-${index}`, "fileChange", {
          kind: "fileChange",
          semanticKind: "patch",
          fileChange: {
            paths: ["test30.txt"],
            diffs: [],
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
          paths: ["src/new.ts"],
          diffs: [],
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
    const grouped = groupAgentEntries([
      buildBlock("file-live", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          paths: ["poem.md"],
          diffs: [],
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
    const grouped = groupAgentEntries([
      buildBlock("file-done", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "completed",
        fileChange: {
          paths: ["poem.md"],
          diffs: [],
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
    const grouped = groupAgentEntries([
      buildBlock("file-change", "fileChange", {
        kind: "fileChange",
        semanticKind: "patch",
        status: "inProgress",
        fileChange: {
          paths: ["src/app.ts"],
          diffs: [],
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
});
