import type { CodexConversationSnapshot } from "./types";

export type CodexHeartbeatDecision = "NOTIFY" | "DONT_NOTIFY";

export interface CodexHeartbeatAssistantMessage {
  decision: CodexHeartbeatDecision;
  visibleText: string | null;
  notificationMessage: string | null;
}

export interface CodexTurnCompleteNotificationEnvelope {
  conversationId: string;
  turnId: string;
  status: "completed" | "failed";
  lastAgentMessage: string | null;
  heartbeatAssistantMessage: CodexHeartbeatAssistantMessage | null;
  hasPendingContinuation: boolean;
}

export function normalizeDesktopNotificationText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function findLastHeartbeatRange(text: string): { start: number; end: number; body: string } | null {
  const heartbeatPattern = /<heartbeat\b[^>]*>[\s\S]*?<\/heartbeat>/gi;
  let match: RegExpExecArray | null = null;
  let lastMatch: RegExpExecArray | null = null;

  while ((match = heartbeatPattern.exec(text)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch || typeof lastMatch.index !== "number") return null;
  const raw = lastMatch[0] ?? "";
  const body = raw
    .replace(/^<heartbeat\b[^>]*>/i, "")
    .replace(/<\/heartbeat>$/i, "");
  return {
    start: lastMatch.index,
    end: lastMatch.index + raw.length,
    body,
  };
}

function readXmlishTagValue(body: string, tagName: string): string | null {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = pattern.exec(body);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function removeHeartbeatFence(text: string): string {
  return text.replace(/```(?:xml|heartbeat)?\s*<heartbeat\b[\s\S]*?<\/heartbeat>\s*```/gi, "");
}

export function parseCodexHeartbeatAssistantMessage(
  text: string | null | undefined,
): CodexHeartbeatAssistantMessage | null {
  if (typeof text !== "string" || text.length === 0) return null;

  const range = findLastHeartbeatRange(text);
  if (!range) return null;

  const rawDecision = readXmlishTagValue(range.body, "decision");
  if (rawDecision !== "NOTIFY" && rawDecision !== "DONT_NOTIFY") return null;

  const withoutHeartbeat = removeHeartbeatFence(
    `${text.slice(0, range.start)}${text.slice(range.end)}`,
  );

  return {
    decision: rawDecision,
    visibleText: normalizeDesktopNotificationText(withoutHeartbeat),
    notificationMessage: normalizeDesktopNotificationText(readXmlishTagValue(range.body, "message")),
  };
}

export function isCodexConversationDesktopNotificationEligible(
  conversation: Pick<CodexConversationSnapshot, "ephemeral" | "threadSource" | "source">,
): boolean {
  if (conversation.ephemeral === true) return false;
  if (conversation.threadSource === "system") return false;
  if (conversation.source?.sideConversation === true) return false;
  return true;
}

export function hasCodexPendingContinuation(conversation: Pick<
  CodexConversationSnapshot,
  "queuedFollowUps" | "pendingSteers" | "threadGoal"
>): boolean {
  if (conversation.queuedFollowUps.some((followUp) => !followUp.pausedReason)) {
    return true;
  }
  if (conversation.pendingSteers.length > 0) {
    return true;
  }
  return conversation.threadGoal?.status === "active";
}
