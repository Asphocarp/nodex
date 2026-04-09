import { z } from "zod";
import type {
  CodexCollaborationModeKind,
  CodexPermissionMode,
  CodexReasoningEffort,
  CodexThreadTokenUsage,
  CodexThreadActiveFlag,
  CodexThreadDetailLevel,
  CodexThreadSettings,
  CodexThreadStatusType,
  CodexTokenUsageBreakdown,
} from "../types";

export const CodexUnknownRecordSchema = z.record(z.string(), z.unknown());

const FiniteNumberSchema = z.number().finite();

function parseFiniteNumber(value: unknown): number | null {
  const parsed = FiniteNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const CodexReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]) satisfies z.ZodType<CodexReasoningEffort>;

export const CodexThreadDetailLevelSchema = z.enum([
  "STEPS_PROSE",
  "STEPS_COMMANDS",
  "STEPS_EXECUTION",
]) satisfies z.ZodType<CodexThreadDetailLevel>;

export const CodexCollaborationModeKindSchema = z.enum([
  "default",
  "plan",
]) satisfies z.ZodType<CodexCollaborationModeKind>;

export const CodexPermissionModeSchema = z.enum([
  "auto",
  "guardian-approvals",
  "full-access",
  "custom",
]) satisfies z.ZodType<CodexPermissionMode>;

export const CodexThreadStatusTypeSchema = z.enum([
  "notLoaded",
  "idle",
  "systemError",
  "active",
]) satisfies z.ZodType<CodexThreadStatusType>;

export const CodexThreadActiveFlagSchema = z.enum([
  "waitingOnApproval",
  "waitingOnUserInput",
]) satisfies z.ZodType<CodexThreadActiveFlag>;

const NonEmptyTrimmedStringSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1));

export const CodexTokenUsageBreakdownSchema = CodexUnknownRecordSchema.transform((value, ctx) => {
  const totalTokens = parseFiniteNumber(value.totalTokens ?? value.total_tokens);
  const inputTokens = parseFiniteNumber(value.inputTokens ?? value.input_tokens);
  const cachedInputTokens = parseFiniteNumber(value.cachedInputTokens ?? value.cached_input_tokens);
  const outputTokens = parseFiniteNumber(value.outputTokens ?? value.output_tokens);
  const reasoningOutputTokens = parseFiniteNumber(
    value.reasoningOutputTokens ?? value.reasoning_output_tokens,
  );

  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid token usage breakdown",
    });
    return z.NEVER;
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  } satisfies CodexTokenUsageBreakdown;
}) satisfies z.ZodType<CodexTokenUsageBreakdown>;

export const CodexThreadTokenUsageSchema = CodexUnknownRecordSchema.transform((value, ctx) => {
  const total = CodexTokenUsageBreakdownSchema.safeParse(value.total ?? value.total_token_usage);
  const last = CodexTokenUsageBreakdownSchema.safeParse(value.last ?? value.last_token_usage);
  if (!total.success || !last.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid thread token usage",
    });
    return z.NEVER;
  }

  const modelContextWindow = value.modelContextWindow ?? value.model_context_window;
  const normalizedModelContextWindow = modelContextWindow === null
    ? null
    : parseFiniteNumber(modelContextWindow);

  return {
    total: total.data,
    last: last.data,
    modelContextWindow: normalizedModelContextWindow,
  } satisfies CodexThreadTokenUsage;
}) satisfies z.ZodType<CodexThreadTokenUsage>;

export function parseCodexThreadTokenUsage(value: unknown): CodexThreadTokenUsage | undefined {
  const parsed = CodexThreadTokenUsageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const CodexThreadSettingsSchema = z.record(z.string(), z.unknown()).transform((value) => {
  const next: CodexThreadSettings = {};

  const model = NonEmptyTrimmedStringSchema.safeParse(value.model);
  if (model.success) {
    next.model = model.data;
  }

  const reasoningEffort = CodexReasoningEffortSchema.safeParse(value.reasoningEffort);
  if (reasoningEffort.success) {
    next.reasoningEffort = reasoningEffort.data;
  }

  const detailLevel = CodexThreadDetailLevelSchema.safeParse(value.detailLevel);
  if (detailLevel.success) {
    next.detailLevel = detailLevel.data;
  }

  return next;
}) satisfies z.ZodType<CodexThreadSettings>;

export const CodexPermissionModesByProjectSchema = z.record(z.string(), z.unknown()).transform((value) =>
  Object.entries(value).reduce<Record<string, CodexPermissionMode>>((acc, [projectId, mode]) => {
    const parsedMode = CodexPermissionModeSchema.safeParse(mode);
    if (!parsedMode.success) return acc;
    acc[projectId] = parsedMode.data;
    return acc;
  }, {}),
);

const CollaborationModeMapSchema = z.record(z.string(), z.unknown()).transform((value) =>
  Object.entries(value).reduce<Record<string, CodexCollaborationModeKind>>((acc, [contextKey, mode]) => {
    const parsedMode = CodexCollaborationModeKindSchema.safeParse(mode);
    if (!parsedMode.success) return acc;
    acc[contextKey] = parsedMode.data;
    return acc;
  }, {}),
);

export const CodexCollaborationModesByContextSchema = z.record(z.string(), z.unknown()).transform((value) => {
  const rawModes = typeof value.modes === "object" && value.modes !== null && !Array.isArray(value.modes)
    ? value.modes as Record<string, unknown>
    : value;
  return CollaborationModeMapSchema.parse(rawModes);
});
