function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function normalizeExactString<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null {
  if (!value) return null;
  return allowed.includes(value as T) ? value as T : null;
}

export type CodexAutomaticApprovalReviewStatus = "approved" | "denied" | "aborted" | "inProgress";
export type CodexAutomaticApprovalReviewRiskLevel = "high" | "medium" | "low";

export interface CodexAutomaticApprovalReviewPayload {
  targetItemId: string | null;
  status: CodexAutomaticApprovalReviewStatus;
  riskScore: number | null;
  riskLevel: CodexAutomaticApprovalReviewRiskLevel | null;
  rationale: string | null;
  action: unknown;
}

export function normalizeAutomaticApprovalReviewPayload(
  rawItem: unknown,
  fallbackTargetItemId?: string | null,
): CodexAutomaticApprovalReviewPayload | null {
  const candidate = asRecord(rawItem);
  if (!candidate) return null;

  const reviewRecord = asRecord(candidate.review) ?? candidate;
  const status = normalizeExactString(
    getString(reviewRecord, "status"),
    ["approved", "denied", "aborted", "inProgress"] as const,
  );
  if (!status) return null;

  return {
    targetItemId: getString(candidate, "targetItemId") ?? fallbackTargetItemId ?? null,
    status,
    riskScore: getNumber(reviewRecord, "riskScore"),
    riskLevel: normalizeExactString(
      getString(reviewRecord, "riskLevel"),
      ["high", "medium", "low"] as const,
    ),
    rationale: getString(reviewRecord, "rationale"),
    action: Object.prototype.hasOwnProperty.call(candidate, "action") ? candidate.action : null,
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

export type CodexMultiAgentActionName = "spawnAgent" | "sendInput" | "resumeAgent" | "closeAgent" | "wait";
export type CodexMultiAgentActionStatus = "inProgress" | "completed" | "failed";
export type CodexMultiAgentAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "shutdown"
  | "completed"
  | "errored"
  | "notFound";

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

function normalizeReceiverThreads(rawValue: unknown): CodexMultiAgentReceiverThread[] {
  if (!Array.isArray(rawValue)) return [];

  return rawValue.reduce<CodexMultiAgentReceiverThread[]>((acc, entry) => {
    const candidate = asRecord(entry);
    const threadId = getString(candidate, "threadId");
    if (!threadId) return acc;

    const rawThread = asRecord(candidate?.thread);
    acc.push({
      threadId,
      thread: rawThread
        ? {
            nickname: getString(rawThread, "nickname"),
            model: getString(rawThread, "model"),
            agentRole: getString(rawThread, "agentRole"),
          }
        : null,
    });
    return acc;
  }, []);
}

function normalizeAgentsStates(rawValue: unknown): Record<string, CodexMultiAgentAgentState> {
  const record = asRecord(rawValue);
  if (!record) return {};

  return Object.entries(record).reduce<Record<string, CodexMultiAgentAgentState>>((acc, [threadId, rawState]) => {
    const stateRecord = asRecord(rawState);
    const status = normalizeExactString(
      getString(stateRecord, "status"),
      ["pendingInit", "running", "interrupted", "shutdown", "completed", "errored", "notFound"] as const,
    );
    if (!status) return acc;

    acc[threadId] = {
      status,
      message: getString(stateRecord, "message"),
    };
    return acc;
  }, {});
}

export function normalizeMultiAgentActionPayload(rawItem: unknown): CodexMultiAgentActionPayload | null {
  const candidate = asRecord(rawItem);
  if (!candidate) return null;

  const action = normalizeExactString(
    getString(candidate, "tool"),
    ["spawnAgent", "sendInput", "resumeAgent", "closeAgent", "wait"] as const,
  );
  const status = normalizeExactString(
    getString(candidate, "status"),
    ["inProgress", "completed", "failed"] as const,
  );
  if (!action || !status) return null;

  const receiverThreadIds = Array.isArray(candidate.receiverThreadIds)
    ? candidate.receiverThreadIds.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id: getString(candidate, "id"),
    action,
    status,
    senderThreadId: getString(candidate, "senderThreadId"),
    receiverThreadIds,
    receiverThreads: normalizeReceiverThreads(candidate.receiverThreads),
    prompt: getString(candidate, "prompt"),
    model: getString(candidate, "model"),
    reasoningEffort: getString(candidate, "reasoningEffort"),
    agentsStates: normalizeAgentsStates(candidate.agentsStates),
  };
}
