import { describe, expect, test } from "bun:test";
import type { CodexConversationItem } from "../../../lib/types";
import { buildRendererItemStream } from "./build-renderer-item-stream";

function buildEntry(overrides: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "item_1",
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("buildRendererItemStream", () => {
  test("maps transcript entries into richer renderer item types", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "plan_1",
          type: "plan",
          kind: "plan",
          semanticKind: "todoList",
          markdownText: "1. Research\n2. Implement\n3. Verify",
        }),
        buildEntry({
          itemId: "diff_1",
          type: "turn_diff",
          kind: "systemEvent",
          semanticKind: "diff",
          rawItem: {
            type: "turn-diff",
            unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
          },
        }),
        buildEntry({
          itemId: "reroute_1",
          type: "model_rerouted",
          kind: "systemEvent",
          semanticKind: "modelRerouted",
          markdownText: "Rerouted to gpt-5.4",
        }),
        buildEntry({
          itemId: "tool_1",
          type: "web_search",
          kind: "toolCall",
          semanticKind: "webSearch",
          toolCall: {
            subtype: "webSearch",
            toolName: "web_search",
            args: { query: "renderer bucketization" },
          },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("todoList,turnDiff,modelRerouted,webSearch");
  });

  test("maps bundle-native hook, planImplementation, and userInputResponse families", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "hook_1",
          type: "hook",
          kind: "hook",
          semanticKind: "hook",
        }),
        buildEntry({
          itemId: "plan_impl_1",
          type: "planImplementation",
          kind: "planImplementation",
          semanticKind: "planImplementation",
          markdownText: "Implement the plan",
        }),
        buildEntry({
          itemId: "user_input_response_1",
          type: "request_user_input",
          kind: "userInputResponse",
          semanticKind: "userInputResponse",
          userInputQuestions: [],
          userInputAnswers: {},
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("hook,planImplementation,userInputResponse");
  });

  test("omits unanswered user-input requests from inline renderer items", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "request_1",
          type: "request_user_input",
          kind: "userInputRequest",
          semanticKind: "systemEvent",
          userInputQuestions: [
            {
              id: "question_1",
              header: "Question",
              question: "What next?",
              isOther: false,
              isSecret: false,
            },
          ],
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.length).toBe(0);
  });

  test("omits reasoning items whose projected summary is empty", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "reasoning_1",
          type: "reasoning",
          kind: "reasoning",
          semanticKind: "reasoning",
          markdownText: "   ",
          rawItem: {
            id: "reasoning_1",
            type: "reasoning",
            summary: [],
            content: ["internal content only"],
          },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.length).toBe(0);
  });

  test("keeps Codex tool rows but omits generic tool fallback entries", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "patch_1",
          type: "file_change",
          kind: "fileChange",
          toolCall: {
            subtype: "fileChange",
            toolName: "file_change",
            result: {
              summary: "Edited src/app.tsx",
            },
          },
          fileChange: {
            paths: ["src/app.tsx"],
            changes: [],
            diffs: [],
          },
        }),
        buildEntry({
          itemId: "mcp_1",
          type: "mcpToolCall",
          kind: "toolCall",
          semanticKind: "mcpToolCall",
          toolCall: {
            subtype: "mcp",
            toolName: "search_docs",
            server: "docs",
            args: { query: "thread item schema" },
          },
        }),
        buildEntry({
          itemId: "generic_1",
          type: "tool_call",
          kind: "toolCall",
          semanticKind: "toolCall",
          toolCall: {
            subtype: "generic",
            toolName: "summarize_stage_shell",
            args: { section: "footer" },
            result: { summary: "legacy fallback" },
          },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("fileChange,mcpToolCall");
  });

  test("injects turn-scoped requests into the renderer item stream", () => {
    const items = buildRendererItemStream({
      entries: [],
      requests: [
        {
          type: "approval",
          requestId: "approval_1",
          kind: "command",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_approval",
          createdAt: 5,
        },
      ],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("approval");
  });

  test("preserves transcript order and injects worked-for before the final assistant anchor", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "user_1",
          createdAt: 1_000,
          updatedAt: 1_000,
          type: "user_message",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          markdownText: "run bun test",
        }),
        buildEntry({
          itemId: "commentary_1",
          createdAt: 2_000,
          updatedAt: 2_000,
          type: "assistant_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          assistantPhase: "commentary",
          role: "assistant",
          markdownText: "Running the test suite.",
        }),
        buildEntry({
          itemId: "exec_1",
          createdAt: 3_000,
          updatedAt: 3_000,
          type: "command_execution",
          kind: "commandExecution",
          semanticKind: "exec",
          toolCall: {
            subtype: "command",
            toolName: "exec_command",
          },
        }),
        buildEntry({
          itemId: "assistant_1",
          createdAt: 5_000,
          updatedAt: 5_000,
          type: "assistant_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          assistantPhase: "final_answer",
          role: "assistant",
          markdownText: "`bun test` passed.",
        }),
      ],
      requests: [],
      turnStatus: "completed",
      isLatestTurn: true,
    });

    expect(items.map((item) => item.id).join(",")).toBe(
      "user_1,commentary_1,exec_1,assistant_1:worked-for,assistant_1",
    );
    const workedForItem = items[3];
    expect(workedForItem?.type ?? "").toBe("workedFor");
    if (!workedForItem || !("entry" in workedForItem)) {
      throw new Error("expected worked-for transcript item");
    }
    expect(workedForItem.entry.timeLabel ?? "").toBe("4s");
  });
});
