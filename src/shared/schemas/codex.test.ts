import { describe, expect, test } from "bun:test";
import { parseCodexThreadTokenUsage } from "./codex";

describe("codex schemas", () => {
  test("parses thread token usage from snake_case and camelCase fields", () => {
    const snakeCase = parseCodexThreadTokenUsage({
      total_token_usage: {
        total_tokens: 12,
        input_tokens: 5,
        cached_input_tokens: 1,
        output_tokens: 6,
        reasoning_output_tokens: 2,
      },
      last_token_usage: {
        total_tokens: 4,
        input_tokens: 2,
        cached_input_tokens: 0,
        output_tokens: 2,
        reasoning_output_tokens: 1,
      },
      model_context_window: 200_000,
    });
    const camelCase = parseCodexThreadTokenUsage({
      total: {
        totalTokens: 12,
        inputTokens: 5,
        cachedInputTokens: 1,
        outputTokens: 6,
        reasoningOutputTokens: 2,
      },
      last: {
        totalTokens: 4,
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 1,
      },
      modelContextWindow: null,
    });

    expect(JSON.stringify(snakeCase)).toBe(JSON.stringify({
      total: {
        totalTokens: 12,
        inputTokens: 5,
        cachedInputTokens: 1,
        outputTokens: 6,
        reasoningOutputTokens: 2,
      },
      last: {
        totalTokens: 4,
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 1,
      },
      modelContextWindow: 200_000,
    }));
    expect(JSON.stringify(camelCase)).toBe(JSON.stringify({
      total: {
        totalTokens: 12,
        inputTokens: 5,
        cachedInputTokens: 1,
        outputTokens: 6,
        reasoningOutputTokens: 2,
      },
      last: {
        totalTokens: 4,
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 1,
      },
      modelContextWindow: null,
    }));
  });

  test("drops invalid thread token usage payloads", () => {
    const parsed = parseCodexThreadTokenUsage({
      total: {
        totalTokens: 12,
      },
      last: {
        totalTokens: 4,
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 1,
      },
    });

    expect(parsed).toBe(undefined);
  });
});
