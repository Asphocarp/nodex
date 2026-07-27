import type { CodexProtocolRequestId } from "./types";

export type CodexUserInputAutoResolutionPhase =
  | { type: "waitingForInactivity" }
  | { type: "scheduled"; deadlineMs: number }
  | { type: "snoozed" };

export interface CodexUserInputAutoResolutionEntry {
  conversationId: string;
  requestId: CodexProtocolRequestId;
  phase: CodexUserInputAutoResolutionPhase;
}

export type CodexUserInputAutoResolutionChange =
  | {
      type: "updated";
      entry: CodexUserInputAutoResolutionEntry;
    }
  | {
      type: "removed";
      conversationId: string;
      requestId: CodexProtocolRequestId;
      reason:
        | "responded"
        | "resolved"
        | "replaced"
        | "disconnected"
        | "disposed";
    }
  | {
      type: "timedOut";
      conversationId: string;
      requestId: CodexProtocolRequestId;
    };

export interface CodexUserInputAutoResolutionTarget {
  conversationId: string;
  requestId: CodexProtocolRequestId;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const conversationId = value.trim();
  return conversationId.length > 0 ? conversationId : null;
}

function parseRequestId(value: unknown): CodexProtocolRequestId | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function parseCodexUserInputAutoResolutionActivityInput(
  value: unknown,
): string | null {
  if (!isRecord(value)) return null;
  return parseConversationId(value.conversationId);
}

export function parseCodexUserInputAutoResolutionTarget(
  value: unknown,
): CodexUserInputAutoResolutionTarget | null {
  if (!isRecord(value)) return null;
  const conversationId = parseConversationId(value.conversationId);
  const requestId = parseRequestId(value.requestId);
  if (conversationId === null || requestId === null) return null;
  return { conversationId, requestId };
}
