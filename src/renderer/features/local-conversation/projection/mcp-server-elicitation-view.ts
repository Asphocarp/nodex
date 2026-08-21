import type { CodexMcpServerElicitationAction } from "../../../lib/types";

export interface CompletedMcpServerElicitationView {
  answer: "Accepted" | "Cancelled" | "Declined" | "Completed";
  question: string;
  requestId: string;
  summary: "Requested permission" | "Completed request";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

function resolveQuestion(elicitation: Record<string, unknown>): string | null {
  if (elicitation.kind === "unsupportedOpenAIForm") return null;
  if (elicitation.kind === "toolSuggestion") {
    return nonEmptyString(asRecord(elicitation.suggestion)?.suggest_reason);
  }
  return nonEmptyString(elicitation.message);
}

function resolveAnswer(
  action: CodexMcpServerElicitationAction | null,
): CompletedMcpServerElicitationView["answer"] {
  if (action === "accept") return "Accepted";
  if (action === "cancel") return "Cancelled";
  if (action === "decline") return "Declined";
  return "Completed";
}

export function resolveCompletedMcpServerElicitationView(
  rawItem: unknown,
): CompletedMcpServerElicitationView | null {
  const item = asRecord(rawItem);
  if (item?.completed !== true) return null;

  const elicitation = asRecord(item.elicitation);
  if (!elicitation) return null;
  const question = resolveQuestion(elicitation);
  if (!question) return null;

  const requestId = nonEmptyString(item.requestId);
  if (!requestId) return null;
  const action =
    item.action === "accept" || item.action === "cancel" || item.action === "decline"
      ? item.action
      : null;

  return {
    answer: resolveAnswer(action),
    question,
    requestId,
    summary: elicitation.kind === "mcpToolCall" ? "Requested permission" : "Completed request",
  };
}
