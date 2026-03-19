import type {
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../lib/types";
import {
  isBlockingConversationRequest,
  selectConversationLiveRequests,
} from "./conversation-request-helpers";

export { selectConversationLiveRequests, selectPlanImplementationRequest } from "./conversation-request-helpers";

export interface LocalConversationSearchUnit {
  key: string;
  threadId: string;
  turnId: string;
  itemId: string;
  role: "user" | "assistant";
  text: string;
}

export function selectVisibleConversationTurns(
  conversation: CodexConversationSnapshot | null,
): CodexConversationTurn[] {
  if (!conversation) return [];
  return conversation.turns;
}

export function selectBlockedTurnIds(
  conversation: CodexConversationSnapshot | null,
): string[] {
  if (!conversation) return [];

  return selectConversationLiveRequests(conversation)
    .filter((request) => isBlockingConversationRequest(request))
    .map((request) => request.turnId)
    .filter((turnId, index, values) => values.indexOf(turnId) === index);
}

export function selectConversationSearchUnits(
  conversation: CodexConversationSnapshot | null,
): LocalConversationSearchUnit[] {
  if (!conversation) return [];

  return conversation.turns.flatMap((turn) =>
    turn.items
      .filter((item) =>
        (item.role === "user" || item.role === "assistant")
        && (item.markdownText ?? "").trim().length > 0,
      )
      .map((item) => ({
        key: `${turn.turnId}:${item.itemId}`,
        threadId: conversation.threadId,
        turnId: turn.turnId,
        itemId: item.itemId,
        role: item.role as "user" | "assistant",
        text: (item.markdownText ?? "").trim(),
      })),
  );
}
