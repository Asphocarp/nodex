import { describe, expect, test } from "bun:test";
import { buildTurnErrorItemView, normalizeThreadItem } from "./codex-item-normalizer";

function normalizeMcpItem(overrides: Record<string, unknown>) {
  return normalizeThreadItem(
    {
      id: "item-mcp",
      type: "mcpToolCall",
      server: "docs",
      tool: "search",
      status: "completed",
      arguments: { query: "thread item schema" },
      ...overrides,
    },
    "thread-1",
    "turn-1",
  );
}

describe("codex-item-normalizer", () => {
  test("normalizes commandExecution items with structured tool metadata", () => {
    const item = normalizeThreadItem(
      {
        id: "item-command",
        type: "commandExecution",
        status: "in_progress",
        command: "bun run lint",
        cwd: "/tmp/repo",
        aggregatedOutput: "Checked 42 files",
        commandActions: [
          {
            type: "read",
            command: "cat src/main.ts",
            name: "main.ts",
            path: "src/main.ts",
          },
          {
            type: "search",
            command: "rg normalize",
            query: "normalize",
            path: "src",
          },
        ],
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("commandExecution");
    expect(item?.status).toBe("inProgress");
    expect(item?.command).toBe("bun run lint");
    expect(item?.cwd).toBe("/tmp/repo");
    expect(item?.aggregatedOutput).toBe("Checked 42 files");
    expect(item?.commandActions?.length).toBe(2);
    expect(item?.exitCode ?? null).toBe(null);
    expect(item?.toolCall?.subtype).toBe("command");
    expect(item?.toolCall?.toolName).toBe("bash");
    expect((item?.toolCall?.args as { command?: string }).command).toBe("bun run lint");
    expect((item?.toolCall?.args as { commandActions?: unknown[] })?.commandActions?.length).toBe(2);
    expect((item?.toolCall?.result as string | undefined)?.includes("Checked 42 files")).toBeTrue();
  });

  test("normalizes fileChange items with structured diffs", () => {
    const item = normalizeThreadItem(
      {
        id: "item-file",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "src/example.ts",
            kind: {
              type: "update",
              move_path: "src/example-old.ts",
            },
            diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("fileChange");
    expect(item?.semanticKind).toBe("patch");
    expect(item?.status).toBe("completed");
    expect(item?.toolCall?.subtype).toBe("fileChange");
    expect(item?.toolCall?.toolName).toBe("file_change");
    expect((item?.toolCall?.args as { label?: string }).label).toBe("Edited src/example.ts");
    expect(item?.fileChange?.changes[0]?.type ?? null).toBe("update");
    expect(item?.fileChange?.changes[0]?.type === "update" ? item.fileChange.changes[0].movePath : null).toBe("src/example-old.ts");
    expect((((item?.toolCall?.result as { diffs?: string[] } | undefined)?.diffs ?? [])[0] ?? "").includes("@@ -1 +1 @@")).toBeTrue();
  });

  test("normalizes fileChange add and delete items using v2 diff text as file content", () => {
    const item = normalizeThreadItem(
      {
        id: "item-file-create-delete",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "src/new-file.ts",
            kind: {
              type: "add",
            },
            diff: "export const created = true;\nconsole.log(created);\n",
          },
          {
            path: "src/old-file.ts",
            kind: {
              type: "delete",
            },
            diff: "export const removed = true;\n",
          },
        ],
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    const changes = item?.fileChange?.changes ?? [];

    expect(changes.length).toBe(2);
    expect(changes[0]?.type ?? null).toBe("add");
    expect(changes[0]?.type === "add" ? changes[0].content : null).toBe("export const created = true;\nconsole.log(created);\n");
    expect(changes[1]?.type ?? null).toBe("delete");
    expect(changes[1]?.type === "delete" ? changes[1].content : null).toBe("export const removed = true;\n");

    const diffs = ((item?.toolCall?.result as { diffs?: string[] } | undefined)?.diffs ?? []);
    expect(diffs[0]?.includes("new file mode 100644") ?? false).toBeTrue();
    expect(diffs[0]?.includes("+export const created = true;") ?? false).toBeTrue();
    expect(diffs[1]?.includes("deleted file mode 100644") ?? false).toBeTrue();
    expect(diffs[1]?.includes("-export const removed = true;") ?? false).toBeTrue();
  });

  test("normalizes mcpToolCall items into canonical tool payloads and derived MCP renderer state", () => {
    const item = normalizeMcpItem({
      status: "in_progress",
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: null,
      },
    });

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("toolCall");
    expect(item?.status).toBe("inProgress");
    expect(item?.toolCall?.subtype).toBe("mcp");
    expect(item?.toolCall?.server).toBe("docs");
    expect((item?.toolCall?.args as { query?: string }).query).toBe("thread item schema");
    expect(((item?.toolCall?.result as { content?: unknown[] } | undefined)?.content?.length ?? 0) > 0).toBeTrue();
    expect(item?.mcpToolCall?.functionName).toBe("docs__search");
    expect(item?.mcpToolCall?.completed).toBeFalse();
    expect(item?.mcpToolCall?.result?.type).toBe("success");
    expect(item?.mcpToolCall?.result?.type === "success" ? item.mcpToolCall.result.content.length : -1).toBe(1);
  });

  test("normalizes protocol MCP errors as completed expandable error results", () => {
    const item = normalizeMcpItem({
      status: "failed",
      result: null,
      error: {
        message: "Authentication required",
      },
    });

    expect(item?.status).toBe("failed");
    expect(item?.mcpToolCall?.completed).toBeTrue();
    expect(item?.mcpToolCall?.result?.type).toBe("error");
    expect(item?.mcpToolCall?.result?.type === "error" ? item.mcpToolCall.result.error : "").toBe("Authentication required");
  });

  test("normalizes empty MCP success results without inferring content", () => {
    const item = normalizeMcpItem({
      result: {
        content: [],
        structuredContent: null,
      },
    });

    expect(item?.mcpToolCall?.result?.type).toBe("success");
    expect(item?.mcpToolCall?.result?.type === "success" ? item.mcpToolCall.result.content.length : -1).toBe(0);
    expect(item?.mcpToolCall?.result?.type === "success" ? item.mcpToolCall.result.structuredContent : "missing").toBe(null);
  });

  test("normalizes structured-only MCP successes and preserves structuredContent separately", () => {
    const item = normalizeMcpItem({
      result: {
        content: [],
        structuredContent: {
          snippetCount: 3,
        },
      },
    });

    expect(item?.mcpToolCall?.result?.type).toBe("success");
    expect(item?.mcpToolCall?.result?.type === "success" ? item.mcpToolCall.result.content.length : -1).toBe(0);
    expect(
      item?.mcpToolCall?.result?.type === "success"
        ? (item.mcpToolCall.result.structuredContent as { snippetCount?: number } | null)?.snippetCount ?? null
        : null,
    ).toBe(3);
  });

  test("normalizes malformed blocks as unknown and aliases resource blocks to embedded_resource", () => {
    const item = normalizeMcpItem({
      result: {
        content: [
          { type: "not_real", foo: "bar" },
          {
            type: "resource",
            uri: "file:///tmp/example.txt",
            mimeType: "text/plain",
            text: "hello",
          },
        ],
        structuredContent: null,
      },
    });

    expect(item?.mcpToolCall?.result?.type).toBe("success");
    const content = item?.mcpToolCall?.result?.type === "success" ? item.mcpToolCall.result.content : [];
    expect(content[0]?.type ?? "").toBe("unknown");
    expect(content[1]?.type ?? "").toBe("embedded_resource");
    expect(
      content[1]?.type === "embedded_resource"
        ? content[1].resource.uri
        : "",
    ).toBe("file:///tmp/example.txt");
  });

  test("normalizes automatic approval review items into dedicated transcript events", () => {
    const item = normalizeThreadItem(
      {
        id: "item-review",
        type: "automaticApprovalReview",
        targetItemId: "item-command",
        review: {
          status: "approved",
          riskScore: 0.82,
          riskLevel: "high",
          rationale: "The command only runs the local test suite.",
        },
        action: {
          type: "commandExecution",
          command: "bun test",
        },
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("systemEvent");
    expect(item?.semanticKind).toBe("automaticApprovalReview");
    expect(item?.status).toBe("completed");
    expect(item?.markdownText).toBe("The command only runs the local test suite.");
  });

  test("normalizes imageView items into assistant messages", () => {
    const item = normalizeThreadItem(
      {
        id: "item-image-view",
        type: "imageView",
        path: "/tmp/screenshot.png",
      },
      "thread-1",
      "turn-1",
    );

    expect(item?.normalizedKind).toBe("assistantMessage");
    expect(item?.semanticKind).toBe("assistantMessage");
    expect(item?.markdownText).toBe("![Image](/tmp/screenshot.png)");
  });

  test("ignores review mode markers", () => {
    expect(normalizeThreadItem({
      id: "item-review-enter",
      type: "enteredReviewMode",
      review: "review-1",
    }, "thread-1", "turn-1")).toBe(null);
    expect(normalizeThreadItem({
      id: "item-review-exit",
      type: "exitedReviewMode",
      review: "review-1",
    }, "thread-1", "turn-1")).toBe(null);
  });

  test("normalizes multi-agent actions with structured receiver metadata", () => {
    const item = normalizeThreadItem(
      {
        id: "item-collab",
        type: "collabAgentToolCall",
        tool: "sendInput",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: "Gather the failing tests.",
        model: "gpt-5.4-mini",
        reasoningEffort: "medium",
        agentsStates: {
          "thread-agent-1": {
            status: "running",
            message: "Inspecting the renderer tests",
          },
        },
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.semanticKind).toBe("multiAgentAction");
    expect(item?.status).toBe("completed");
    expect((item?.toolCall?.args as { receiverThreads?: unknown[] } | undefined)?.receiverThreads?.length).toBe(1);
    expect(((item?.toolCall?.args as { agentsStates?: Record<string, unknown> } | undefined)?.agentsStates?.["thread-agent-1"] as { status?: string } | undefined)?.status).toBe("running");
  });

  test("keeps collab wait items out of the dedicated multi-agent transcript lane", () => {
    const item = normalizeThreadItem(
      {
        id: "item-collab-wait",
        type: "collabAgentToolCall",
        tool: "wait",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        prompt: null,
        agentsStates: {},
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.semanticKind).toBe("toolCall");
  });

  test("normalizes reasoning items from summary only and preserves status when provided", () => {
    const item = normalizeThreadItem(
      {
        id: "item-thinking",
        type: "reasoning",
        status: "in_progress",
        summary: ["Checking thread state", "Comparing item lifecycle with turn status"],
        content: ["Comparing item lifecycle with turn status"],
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("reasoning");
    expect(item?.status).toBe("inProgress");
    expect(item?.markdownText).toBe("**Checking thread state**\n\nComparing item lifecycle with turn status");
  });

  test("normalizes context compaction into Codex-style in-progress and completed labels", () => {
    const inProgressItem = normalizeThreadItem(
      {
        id: "item-compact-running",
        type: "contextCompaction",
        status: "in_progress",
      },
      "thread-1",
      "turn-1",
    );

    const completedItem = normalizeThreadItem(
      {
        id: "item-compact-done",
        type: "context_compaction",
        status: "completed",
      },
      "thread-1",
      "turn-1",
    );

    expect(inProgressItem).not.toBeNull();
    expect(inProgressItem?.semanticKind).toBe("contextCompaction");
    expect(inProgressItem?.status).toBe("inProgress");
    expect(inProgressItem?.markdownText).toBe("Automatically compacting context");

    expect(completedItem).not.toBeNull();
    expect(completedItem?.semanticKind).toBe("contextCompaction");
    expect(completedItem?.status).toBe("completed");
    expect(completedItem?.markdownText).toBe("Context automatically compacted");
  });

  test("builds retryable turn errors into stream-error transcript items", () => {
    const item = buildTurnErrorItemView({
      threadId: "thread-1",
      turnId: "turn-1",
      message: "Reconnecting... 2/5",
      additionalDetails: "Network error: connection dropped while streaming.",
      willRetry: true,
      createdAt: 1,
      updatedAt: 2,
    });

    expect(item.semanticKind).toBe("streamError");
    expect(item.status).toBe("inProgress");
    expect(item.markdownText).toBe("Reconnecting... 2/5");
    expect(item.additionalDetails).toBe("Network error: connection dropped while streaming.");
    expect(item.willRetry).toBeTrue();
  });

  test("keeps empty transcript items blank instead of showing internal type labels", () => {
    const variants = [
      {
        type: "userMessage",
        payload: {
          id: "item-user-empty",
          type: "userMessage",
          content: [],
        },
        unexpectedFallback: "User Message",
      },
      {
        type: "agentMessage",
        payload: {
          id: "item-agent-empty",
          type: "agentMessage",
          text: "",
        },
        unexpectedFallback: "Agent Message",
      },
      {
        type: "plan",
        payload: {
          id: "item-plan-empty",
          type: "plan",
          text: "",
        },
        unexpectedFallback: "Plan",
      },
      {
        type: "reasoning",
        payload: {
          id: "item-reasoning-empty",
          type: "reasoning",
          summary: [],
          content: [],
        },
        unexpectedFallback: "Reasoning",
      },
    ] as const;

    for (const variant of variants) {
      const item = normalizeThreadItem(variant.payload, "thread-1", "turn-1");
      expect(item).not.toBeNull();
      expect((item?.markdownText ?? "").length).toBe(0);
      expect(item?.markdownText === variant.unexpectedFallback).toBeFalse();
    }
  });

  test("normalizes request_user_input items with transcript answers", () => {
    const item = normalizeThreadItem(
      {
        id: "item-user-input",
        type: "request_user_input",
        status: "completed",
        questions: [
          {
            id: "q1",
            header: "Math",
            question: "What is 1 + 1?",
            isOther: false,
            isSecret: false,
            options: [
              { label: "2", description: "Correct" },
              { label: "3", description: "Incorrect" },
            ],
          },
        ],
        answers: {
          q1: {
            answers: ["2"],
          },
        },
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("userInputResponse");
    expect(item?.status).toBe("completed");
    expect(item?.markdownText).toBe("Asked 1 question");
    expect(item?.userInputQuestions?.[0]?.question).toBe("What is 1 + 1?");
    expect(item?.userInputAnswers?.q1?.[0]).toBe("2");
  });

  test("keeps unknown item variants visible with fallback content", () => {
    const item = normalizeThreadItem(
      {
        id: "item-unknown",
        type: "futureToolThing",
        foo: "bar",
      },
      "thread-1",
      "turn-1",
    );

    expect(item).not.toBeNull();
    expect(item?.normalizedKind).toBe("systemEvent");
    expect(item?.markdownText).toBe("Future Tool Thing");
    expect((item?.rawItem as { foo?: string }).foo).toBe("bar");
  });
});
