import { describe, expect, it } from "vitest";
import { parsePersistedCodexThreadTokenUsage } from "./codex-session-token-usage";

describe("persisted Codex session token usage", () => {
  it("converts the historical JSONL snake_case payload into the current generated shape", () => {
    expect(parsePersistedCodexThreadTokenUsage({
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
    })).toEqual({
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
    });
  });
});
