import { z } from "zod";
import { CodexUnknownRecordSchema } from "./schemas/codex";

const NullableStringSchema = z.string().nullable().optional().catch(null).transform((value) => value ?? null);
const NullableFiniteNumberSchema = z.number().finite().nullable().optional().catch(null).transform((value) => value ?? null);

export const AUTO_REVIEW_INTERRUPTION_WARNING_PREFIX =
  "Automatic approval review rejected too many approval requests for this turn";

const CodexAutomaticApprovalReviewStatusSchema = z.enum([
  "approved",
  "denied",
  "aborted",
  "inProgress",
  "timedOut",
]);

const CodexAutomaticApprovalReviewRiskLevelSchema = z.enum([
  "high",
  "medium",
  "low",
  "critical",
]);

const CodexAutomaticApprovalReviewUserAuthorizationSchema = z.enum([
  "unknown",
  "low",
  "medium",
  "high",
]);

const CodexMultiAgentActionNameSchema = z.enum([
  "spawnAgent",
  "sendInput",
  "resumeAgent",
  "closeAgent",
  "wait",
]);

const CodexMultiAgentActionStatusSchema = z.enum([
  "inProgress",
  "completed",
  "failed",
]);

const CodexMultiAgentAgentStatusSchema = z.enum([
  "pendingInit",
  "running",
  "interrupted",
  "shutdown",
  "completed",
  "errored",
  "notFound",
]);

export type CodexAutomaticApprovalReviewStatus = z.infer<typeof CodexAutomaticApprovalReviewStatusSchema>;
export type CodexAutomaticApprovalReviewRiskLevel = z.infer<typeof CodexAutomaticApprovalReviewRiskLevelSchema>;

export interface CodexAutomaticApprovalReviewPayload {
  targetItemId: string | null;
  status: CodexAutomaticApprovalReviewStatus;
  riskScore: number | null;
  riskLevel: CodexAutomaticApprovalReviewRiskLevel | null;
  userAuthorization: "unknown" | "low" | "medium" | "high" | null;
  rationale: string | null;
  action: unknown;
}

export type CodexMultiAgentActionName = z.infer<typeof CodexMultiAgentActionNameSchema>;
export type CodexMultiAgentActionStatus = z.infer<typeof CodexMultiAgentActionStatusSchema>;
export type CodexMultiAgentAgentStatus = z.infer<typeof CodexMultiAgentAgentStatusSchema>;

export interface CodexMultiAgentReceiverThread {
  threadId: string;
  thread: {
    nickname: string | null;
    model: string | null;
    agentRole: string | null;
  } | null;
}

export interface CodexMultiAgentAgentState {
  status: CodexMultiAgentAgentStatus;
  message: string | null;
}

export interface CodexMultiAgentActionPayload {
  id: string | null;
  action: CodexMultiAgentActionName;
  status: CodexMultiAgentActionStatus;
  senderThreadId: string | null;
  receiverThreadIds: string[];
  receiverThreads: CodexMultiAgentReceiverThread[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, CodexMultiAgentAgentState>;
}

const CodexAutomaticApprovalReviewRecordSchema = CodexUnknownRecordSchema.transform((value, ctx) => {
  const status = CodexAutomaticApprovalReviewStatusSchema.safeParse(value.status);
  if (!status.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid automatic approval review status",
    });
    return z.NEVER;
  }

  const riskLevel = CodexAutomaticApprovalReviewRiskLevelSchema.safeParse(value.riskLevel);
  const userAuthorization = CodexAutomaticApprovalReviewUserAuthorizationSchema.safeParse(value.userAuthorization);

  return {
    status: status.data,
    riskScore: NullableFiniteNumberSchema.parse(value.riskScore),
    riskLevel: riskLevel.success ? riskLevel.data : null,
    userAuthorization: userAuthorization.success ? userAuthorization.data : null,
    rationale: NullableStringSchema.parse(value.rationale),
  };
});

const CodexReceiverThreadSchema = CodexUnknownRecordSchema.transform((value, ctx) => {
  const threadId = z.string().safeParse(value.threadId);
  if (!threadId.success || threadId.data.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid receiver thread id",
    });
    return z.NEVER;
  }

  const thread = CodexUnknownRecordSchema.safeParse(value.thread);
  return {
    threadId: threadId.data,
    thread: thread.success
      ? {
          nickname: NullableStringSchema.parse(thread.data.nickname),
          model: NullableStringSchema.parse(thread.data.model),
          agentRole: NullableStringSchema.parse(thread.data.agentRole),
        }
      : null,
  } satisfies CodexMultiAgentReceiverThread;
});

const CodexReceiverThreadsSchema = z.array(z.unknown()).transform((value) =>
  value.reduce<CodexMultiAgentReceiverThread[]>((acc, entry) => {
    const parsed = CodexReceiverThreadSchema.safeParse(entry);
    if (!parsed.success) return acc;
    acc.push(parsed.data);
    return acc;
  }, []),
);

const CodexAgentsStatesSchema = CodexUnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, CodexMultiAgentAgentState>>((acc, [threadId, rawState]) => {
    const state = CodexUnknownRecordSchema.safeParse(rawState);
    if (!state.success) return acc;

    const status = CodexMultiAgentAgentStatusSchema.safeParse(state.data.status);
    if (!status.success) return acc;

    acc[threadId] = {
      status: status.data,
      message: NullableStringSchema.parse(state.data.message),
    };
    return acc;
  }, {}),
);

const CodexMultiAgentActionRecordSchema = CodexUnknownRecordSchema.transform((value, ctx) => {
  const action = CodexMultiAgentActionNameSchema.safeParse(value.tool);
  const status = CodexMultiAgentActionStatusSchema.safeParse(value.status);
  if (!action.success || !status.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid multi-agent action payload",
    });
    return z.NEVER;
  }

  const receiverThreadIds = Array.isArray(value.receiverThreadIds)
    ? value.receiverThreadIds.reduce<string[]>((acc, entry) => {
        const parsed = z.string().safeParse(entry);
        if (!parsed.success) return acc;
        acc.push(parsed.data);
        return acc;
      }, [])
    : [];

  const receiverThreads = CodexReceiverThreadsSchema.safeParse(value.receiverThreads);
  const agentsStates = CodexAgentsStatesSchema.safeParse(value.agentsStates);

  return {
    id: NullableStringSchema.parse(value.id),
    action: action.data,
    status: status.data,
    senderThreadId: NullableStringSchema.parse(value.senderThreadId),
    receiverThreadIds,
    receiverThreads: receiverThreads.success ? receiverThreads.data : [],
    prompt: NullableStringSchema.parse(value.prompt),
    model: NullableStringSchema.parse(value.model),
    reasoningEffort: NullableStringSchema.parse(value.reasoningEffort),
    agentsStates: agentsStates.success ? agentsStates.data : {},
  } satisfies CodexMultiAgentActionPayload;
});

export function normalizeAutomaticApprovalReviewPayload(
  rawItem: unknown,
  fallbackTargetItemId?: string | null,
): CodexAutomaticApprovalReviewPayload | null {
  const candidate = CodexUnknownRecordSchema.safeParse(rawItem);
  if (!candidate.success) return null;

  const reviewRecord = CodexAutomaticApprovalReviewRecordSchema.safeParse(candidate.data.review);
  let normalizedReview: z.infer<typeof CodexAutomaticApprovalReviewRecordSchema> | null = null;
  if (reviewRecord.success) {
    normalizedReview = reviewRecord.data;
  } else {
    const parsedFallback = CodexAutomaticApprovalReviewRecordSchema.safeParse(candidate.data);
    normalizedReview = parsedFallback.success ? parsedFallback.data : null;
  }
  if (!normalizedReview) return null;

  return {
    targetItemId: NullableStringSchema.parse(candidate.data.targetItemId) ?? fallbackTargetItemId ?? null,
    ...normalizedReview,
    action: Object.prototype.hasOwnProperty.call(candidate.data, "action") ? candidate.data.action : null,
  };
}

export function buildAutomaticApprovalReviewSummary(
  review: Pick<CodexAutomaticApprovalReviewPayload, "status" | "rationale">,
): string {
  const trimmedRationale = review.rationale?.trim() ?? "";
  if (trimmedRationale.length > 0) return trimmedRationale;
  if (review.status === "inProgress") {
    return "A carefully prompted reviewer agent is reviewing this request before Codex runs it.";
  }
  if (review.status === "aborted") {
    return "A carefully prompted reviewer agent stopped reviewing this request before Codex ran it.";
  }
  return "A carefully prompted reviewer agent reviewed this request.";
}

export function shouldShowAutoReviewInterruptionWarning(rawNotification: unknown): boolean {
  const candidate = CodexUnknownRecordSchema.safeParse(rawNotification);
  if (!candidate.success) return false;

  if (candidate.data.kind === "tooManyDenials") return true;

  const message = candidate.data.message;
  return typeof message === "string" && message.startsWith(AUTO_REVIEW_INTERRUPTION_WARNING_PREFIX);
}

export function normalizeMultiAgentActionPayload(rawItem: unknown): CodexMultiAgentActionPayload | null {
  const parsed = CodexMultiAgentActionRecordSchema.safeParse(rawItem);
  return parsed.success ? parsed.data : null;
}
