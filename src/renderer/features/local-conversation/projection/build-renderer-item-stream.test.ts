import { describe, expect, test } from "bun:test";
import type { CodexConversationItem } from "../../../lib/types";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
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
          itemId: "auto_review_interruption_1",
          type: "autoReviewInterruptionWarning",
          kind: "systemEvent",
          semanticKind: "autoReviewInterruptionWarning",
          markdownText: "Automatic approval review rejected too many approval requests for this turn",
        }),
        buildEntry({
          itemId: "steered_1",
          type: "steered",
          kind: "systemEvent",
          semanticKind: "steered",
          markdownText: "Steered conversation",
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

    expect(items.map((item) => item.type).join(",")).toBe("todoList,turnDiff,modelRerouted,autoReviewInterruptionWarning,steered,webSearch");
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

  test("maps v2 protocol item types when normalized semantic kind is generic", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "agent_message_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "agent_message_1", type: "agentMessage" },
          markdownText: "Done.",
        }),
        buildEntry({
          itemId: "reasoning_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "reasoning_1", type: "reasoning" },
          markdownText: "Thinking through the dispatch.",
        }),
        buildEntry({
          itemId: "exec_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "exec_1", type: "commandExecution" },
        }),
        buildEntry({
          itemId: "patch_1",
          kind: "toolCall",
          semanticKind: "systemEvent",
          rawItem: { id: "patch_1", type: "fileChange" },
          fileChange: {
            changes: buildCodexFileChangeMap([{
              type: "update",
              path: "src/app.ts",
              unifiedDiff: "",
              movePath: null,
            }]),
          },
        }),
        buildEntry({
          itemId: "mcp_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "mcp_1", type: "mcpToolCall" },
        }),
        buildEntry({
          itemId: "dynamic_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "dynamic_1", type: "dynamicToolCall" },
        }),
        buildEntry({
          itemId: "web_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "web_1", type: "webSearch", query: "Codex app-server" },
        }),
        buildEntry({
          itemId: "compact_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "compact_1", type: "contextCompaction" },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("assistantMessage,reasoning,exec,fileChange,mcpToolCall,dynamicToolCall,webSearch,contextCompaction");
  });

  test("omits webSearch rows without a visible query", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "web_missing_query",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: {
            id: "web_missing_query",
            type: "webSearch",
            action: {
              type: "search",
              queries: ["fallback should not render"],
            },
          },
        }),
        buildEntry({
          itemId: "web_blank_query",
          type: "web_search",
          kind: "toolCall",
          semanticKind: "webSearch",
          toolCall: {
            subtype: "webSearch",
            toolName: "web_search",
            args: { query: "   " },
            result: {
              type: "search",
              queries: ["fallback should not render"],
            },
          },
          rawItem: {
            id: "web_blank_query",
            type: "webSearch",
            query: "   ",
            action: {
              type: "search",
              queries: ["fallback should not render"],
            },
          },
        }),
        buildEntry({
          itemId: "web_visible_query",
          type: "web_search",
          kind: "toolCall",
          semanticKind: "webSearch",
          toolCall: {
            subtype: "webSearch",
            toolName: "web_search",
            args: { query: "thread grouping parity" },
          },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.id).join(",")).toBe("web_visible_query");
    expect(items.map((item) => item.type).join(",")).toBe("webSearch");
  });

  test("defers ambiguous v2 protocol item families to normalized semantic kind", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "todo_plan_1",
          type: "plan",
          kind: "plan",
          semanticKind: "todoList",
          rawItem: { id: "todo_plan_1", type: "plan" },
          markdownText: "1. Research\n2. Implement",
        }),
        buildEntry({
          itemId: "proposed_plan_1",
          type: "plan",
          kind: "plan",
          semanticKind: "proposedPlan",
          rawItem: { id: "proposed_plan_1", type: "plan" },
          markdownText: "We can refactor the dispatcher.",
        }),
        buildEntry({
          itemId: "multi_agent_1",
          type: "collabAgentToolCall",
          kind: "toolCall",
          semanticKind: "multiAgentAction",
          rawItem: { id: "multi_agent_1", type: "collabAgentToolCall" },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.map((item) => item.type).join(",")).toBe("todoList,proposedPlan,multiAgentAction");
  });

  test("omits protocol-only items that do not have an inline renderer surface", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "hook_prompt_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "hook_prompt_1", type: "hookPrompt" },
        }),
        buildEntry({
          itemId: "sub_agent_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "sub_agent_1", type: "subAgentActivity" },
        }),
        buildEntry({
          itemId: "sleep_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "sleep_1", type: "sleep" },
        }),
        buildEntry({
          itemId: "image_generation_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "image_generation_1", type: "imageGeneration" },
        }),
        buildEntry({
          itemId: "entered_review_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "entered_review_1", type: "enteredReviewMode" },
        }),
        buildEntry({
          itemId: "exited_review_1",
          kind: "systemEvent",
          semanticKind: "systemEvent",
          rawItem: { id: "exited_review_1", type: "exitedReviewMode" },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.length).toBe(0);
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
            changes: buildCodexFileChangeMap([{
              type: "update",
              path: "src/app.tsx",
              unifiedDiff: "",
              movePath: null,
            }]),
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

  test("omits fileChange rows without canonical patch entries", () => {
    const items = buildRendererItemStream({
      entries: [
        buildEntry({
          itemId: "empty_patch_1",
          type: "file_change",
          kind: "fileChange",
          semanticKind: "patch",
          status: "completed",
          fileChange: {
            changes: buildCodexFileChangeMap([]),
          },
        }),
        buildEntry({
          itemId: "raw_protocol_patch_1",
          type: "file_change",
          kind: "fileChange",
          semanticKind: "patch",
          status: "completed",
          fileChange: {
            changes: [
              { path: "src/raw.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@" },
            ] as never,
          },
        }),
      ],
      requests: [],
      turnStatus: "completed",
    });

    expect(items.length).toBe(0);
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

  test("does not synthesize worked-for rows in the flat renderer item stream", () => {
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

    expect(items.map((item) => item.id).join(",")).toBe("user_1,commentary_1,exec_1,assistant_1");
    expect(items.some((item) => item.type === "workedFor")).toBeFalse();
  });
});
