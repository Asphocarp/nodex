import type { CodexThreadDetail, CodexThreadSummary, CodexTurnSummary } from "../../shared/types";

const UNTITLED_THREAD_LABEL = "Untitled thread";
const MAX_NOTIFICATION_BODY_CHARS = 220;

function normalizeNotificationText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function truncateNotificationBody(value: string): string {
  if (value.length <= MAX_NOTIFICATION_BODY_CHARS) return value;
  return `${value.slice(0, MAX_NOTIFICATION_BODY_CHARS - 1).trimEnd()}\u2026`;
}

function stringifyToolCallResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function pickLastTurnMessage(detail: CodexThreadDetail | null, turnId: string): string {
  if (!detail) return "";

  const turnEntries = detail.transcript.filter((entry) => entry.turnId === turnId);
  if (turnEntries.length === 0) return "";

  const assistantEntries = turnEntries.filter((entry) =>
    entry.role === "assistant" || entry.kind === "assistantMessage"
  );
  const candidates = assistantEntries.length > 0 ? assistantEntries : turnEntries;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const entry = candidates[index];
    if (!entry) continue;

    const message = normalizeNotificationText(
      entry.markdownText ?? stringifyToolCallResult(entry.toolCall?.result),
    );
    if (!message) continue;
    return truncateNotificationBody(message);
  }

  return "";
}

function buildStatusFallback(turn: CodexTurnSummary): string {
  const normalizedError = normalizeNotificationText(turn.errorMessage);
  if (normalizedError) return truncateNotificationBody(normalizedError);
  if (turn.status === "failed") return "Thread failed.";
  if (turn.status === "interrupted") return "Thread stopped.";
  return "Thread finished.";
}

export function resolveThreadCompletionNotificationContent(input: {
  thread: CodexThreadSummary | null;
  detail: CodexThreadDetail | null;
  turn: CodexTurnSummary;
}): { title: string; body: string } | null {
  if (input.turn.status === "inProgress") return null;
  if (!input.thread) return null;

  const title = normalizeNotificationText(input.thread.threadName) || UNTITLED_THREAD_LABEL;
  const body =
    (input.turn.turnId === null
      ? ""
      : pickLastTurnMessage(input.detail, input.turn.turnId)) ||
    normalizeNotificationText(input.thread.threadPreview) ||
    buildStatusFallback(input.turn);

  return { title, body };
}
