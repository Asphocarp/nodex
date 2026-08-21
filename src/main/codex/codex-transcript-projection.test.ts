import { describe, expect, test } from "vite-plus/test";

import {
  finalizeTurnTranscriptState,
  resolveThreadPreviewFromTranscript,
} from "./codex-transcript-projection";
import type { CodexTranscriptEntry } from "../../shared/types";

function makeEntry(
  input: Partial<CodexTranscriptEntry> & {
    itemId: string;
    type: string;
    kind: string;
    semanticKind: string;
  },
): CodexTranscriptEntry {
  return {
    threadId: "thr_terminalize",
    turnId: "turn_terminalize",
    entryId: input.itemId,
    itemId: input.itemId,
    type: input.type,
    kind: input.kind,
    semanticKind: input.semanticKind,
    status: input.status ?? "inProgress",
    source: "live",
    sequence: input.sequence ?? 0,
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 1,
    ...(input.toolCall ? { toolCall: input.toolCall } : {}),
    ...(input.mcpToolCall ? { mcpToolCall: input.mcpToolCall } : {}),
    ...(input.markdownText ? { markdownText: input.markdownText } : {}),
  };
}

describe("finalizeTurnTranscriptState", () => {
  test("keeps in-progress command executions alive when a turn completes", () => {
    const transcript = [
      makeEntry({
        itemId: "exec_old",
        type: "commandExecution",
        kind: "commandExecution",
        semanticKind: "exec",
        toolCall: {
          subtype: "command",
          toolName: "bash",
        },
      }),
      makeEntry({
        itemId: "reasoning_old",
        type: "reasoning",
        kind: "reasoning",
        semanticKind: "reasoning",
        markdownText: "Thinking...",
        sequence: 1,
      }),
    ];

    const finalized = finalizeTurnTranscriptState(transcript, "turn_terminalize", "completed");
    expect(finalized[0]?.status).toBe("inProgress");
    expect(finalized[1]?.status).toBe("completed");
  });

  test("interrupting a turn still terminalizes command executions", () => {
    const transcript = [
      makeEntry({
        itemId: "exec_interrupt",
        type: "commandExecution",
        kind: "commandExecution",
        semanticKind: "exec",
      }),
    ];

    const finalized = finalizeTurnTranscriptState(transcript, "turn_terminalize", "interrupted");
    expect(finalized[0]?.status).toBe("interrupted");
  });

  test("terminal turns complete a lingering MCP view even when the outer row is already terminal", () => {
    const transcript = [
      makeEntry({
        itemId: "mcp_terminal",
        type: "mcpToolCall",
        kind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "completed",
        mcpToolCall: {
          callId: "mcp_terminal",
          functionName: "docs__search",
          pluginId: null,
          readOnlyHint: null,
          mcpAppResourceUri: undefined,
          source: null,
          invocation: {
            server: "docs",
            tool: "search",
            arguments: {},
          },
          result: null,
          durationMs: null,
          completed: false,
        },
      }),
    ];

    const finalized = finalizeTurnTranscriptState(transcript, "turn_terminalize", "completed");
    expect(finalized[0]?.status).toBe("completed");
    expect(finalized[0]?.mcpToolCall?.completed).toBe(true);
  });
});

describe("resolveThreadPreviewFromTranscript", () => {
  test("uses the first user message instead of a later assistant response", () => {
    const preview = resolveThreadPreviewFromTranscript(
      [
        makeEntry({
          itemId: "user_1",
          type: "userMessage",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          markdownText: "Build the picker",
        }),
        makeEntry({
          itemId: "assistant_1",
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          markdownText: "Implemented the picker.",
          sequence: 1,
        }),
      ],
      "Cached preview",
    );

    expect(preview).toBe("Build the picker");
  });

  test("keeps the first user message across later turns", () => {
    const preview = resolveThreadPreviewFromTranscript(
      [
        makeEntry({
          itemId: "assistant_intro",
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          markdownText: "Ready.",
        }),
        makeEntry({
          itemId: "user_1",
          type: "userMessage",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          markdownText: "Investigate the preview bug",
          sequence: 1,
        }),
        makeEntry({
          itemId: "user_2",
          type: "userMessage",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          markdownText: "Now fix it",
          sequence: 2,
        }),
        makeEntry({
          itemId: "assistant_2",
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          markdownText: "Fixed.",
          sequence: 3,
        }),
      ],
      "",
    );

    expect(preview).toBe("Investigate the preview bug");
  });

  test("falls back when transcript has no user message", () => {
    const preview = resolveThreadPreviewFromTranscript(
      [
        makeEntry({
          itemId: "assistant_1",
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          markdownText: "Only assistant text",
        }),
      ],
      "Cached preview",
    );

    expect(preview).toBe("Cached preview");
  });

  test("uses the first available text when there is no user message or fallback", () => {
    const preview = resolveThreadPreviewFromTranscript(
      [
        makeEntry({
          itemId: "assistant_1",
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          markdownText: "Only assistant text",
        }),
      ],
      "",
    );

    expect(preview).toBe("Only assistant text");
  });

  test("treats a missing fallback as empty", () => {
    const preview = resolveThreadPreviewFromTranscript([], undefined);

    expect(preview).toBe("");
  });
});
