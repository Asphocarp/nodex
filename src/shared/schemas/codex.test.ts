import { describe, expect, test } from "vitest";
import {
  CodexReasoningEffortSchema,
  CodexThreadStatusTypeSchema,
  parseCodexThreadTokenUsage,
} from "./codex";

describe("generated Codex schemas", () => {
  test("parses the current generated thread token usage shape", () => {
    const value = {
      total: {
        totalTokens: 12,
        inputTokens: 5,
        cachedInputTokens: 1,
        cacheWriteInputTokens: 0,
        outputTokens: 6,
        reasoningOutputTokens: 2,
      },
      last: {
        totalTokens: 4,
        inputTokens: 2,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 1,
      },
      modelContextWindow: null,
    };

    expect(parseCodexThreadTokenUsage(value)).toEqual(value);
  });

  test("rejects historical spellings and invalid current payloads at the live boundary", () => {
    expect(
      parseCodexThreadTokenUsage({
        total_token_usage: {},
        last_token_usage: {},
        model_context_window: null,
      }),
    ).toBeUndefined();
    expect(
      parseCodexThreadTokenUsage({
        total: { totalTokens: 12 },
        last: {},
        modelContextWindow: null,
      }),
    ).toBeUndefined();
  });

  test("accepts dynamic reasoning efforts while deriving closed status values", () => {
    expect(CodexReasoningEffortSchema.parse("future-effort")).toBe("future-effort");
    expect(CodexReasoningEffortSchema.parse(" Thinking ")).toBe("Thinking");
    expect(CodexReasoningEffortSchema.safeParse("thinking\nunsafe").success).toBe(false);
    expect(CodexThreadStatusTypeSchema.safeParse("active").success).toBe(true);
    expect(CodexThreadStatusTypeSchema.safeParse("future-status").success).toBe(false);
  });
});
