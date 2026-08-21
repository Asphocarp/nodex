import type { CodexItemView } from "./types";

function resolveTurnErrorMarkdown(message: string | null | undefined, willRetry: boolean): string {
  const trimmed = message?.trim();
  if (trimmed) return trimmed;
  return willRetry ? "Reconnecting..." : "Thread hit an error";
}

export function buildTurnErrorItemView(input: {
  threadId: string;
  turnId: string;
  message: string | null | undefined;
  additionalDetails?: string | null;
  willRetry: boolean;
  createdAt?: number;
  updatedAt?: number;
}): CodexItemView {
  const now = input.updatedAt ?? Date.now();
  const createdAt = input.createdAt ?? now;
  const itemId = `error:${input.turnId}`;
  const markdownText = resolveTurnErrorMarkdown(input.message, input.willRetry);

  return {
    threadId: input.threadId,
    turnId: input.turnId,
    itemId,
    type: "error",
    normalizedKind: "systemEvent",
    semanticKind: input.willRetry ? "streamError" : "systemError",
    status: input.willRetry ? "inProgress" : "failed",
    markdownText,
    additionalDetails: input.additionalDetails ?? null,
    willRetry: input.willRetry,
    rawItem: {
      id: itemId,
      type: "error",
      error: {
        message: markdownText,
        additionalDetails: input.additionalDetails ?? null,
      },
      willRetry: input.willRetry,
    },
    createdAt,
    updatedAt: now,
  };
}
