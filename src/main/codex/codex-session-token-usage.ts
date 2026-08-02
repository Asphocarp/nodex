import { z } from "zod";
import type { CodexThreadTokenUsage } from "../../shared/types";

const FiniteNumberSchema = z.number().finite();
const LegacyTokenUsageBreakdownSchema = z.object({
  total_tokens: FiniteNumberSchema,
  input_tokens: FiniteNumberSchema,
  cached_input_tokens: FiniteNumberSchema,
  output_tokens: FiniteNumberSchema,
  reasoning_output_tokens: FiniteNumberSchema,
});

const LegacyThreadTokenUsageSchema = z.object({
  total_token_usage: LegacyTokenUsageBreakdownSchema,
  last_token_usage: LegacyTokenUsageBreakdownSchema,
  model_context_window: FiniteNumberSchema.nullable(),
});

export function parsePersistedCodexThreadTokenUsage(value: unknown): CodexThreadTokenUsage | undefined {
  const parsed = LegacyThreadTokenUsageSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const normalizeBreakdown = (
    breakdown: z.infer<typeof LegacyTokenUsageBreakdownSchema>,
  ): CodexThreadTokenUsage["total"] => ({
    totalTokens: breakdown.total_tokens,
    inputTokens: breakdown.input_tokens,
    cachedInputTokens: breakdown.cached_input_tokens,
    cacheWriteInputTokens: 0,
    outputTokens: breakdown.output_tokens,
    reasoningOutputTokens: breakdown.reasoning_output_tokens,
  });

  return {
    total: normalizeBreakdown(parsed.data.total_token_usage),
    last: normalizeBreakdown(parsed.data.last_token_usage),
    modelContextWindow: parsed.data.model_context_window,
  };
}
