import type {
  CodexConversationLiveRequest,
  CodexConversationSnapshot,
  CodexPlanImplementationRequest,
} from "./types";

const LIVE_REQUEST_PRIORITY: Record<CodexConversationLiveRequest["type"], number> = {
  approval: 0,
  userInput: 1,
  mcpServerElicitation: 2,
  implementPlan: 3,
};

export type CodexTurnScopedConversationRequest = Exclude<
  CodexConversationLiveRequest,
  { type: "mcpServerElicitation" }
>;

interface ConversationRequestSelectionOptions {
  dismissedPlanImplementationTurnId?: string | null;
}

export function buildPlanImplementationRequestId(turnId: string): string {
  return `implement-plan:${turnId}`;
}

export function selectPlanImplementationRequest(
  conversation: CodexConversationSnapshot | null,
  options?: ConversationRequestSelectionOptions,
): CodexPlanImplementationRequest | null {
  if (!conversation) return null;

  for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
    const turn = conversation.turns[index];
    if (!turn) continue;
    if (options?.dismissedPlanImplementationTurnId === turn.turnId) continue;

    const planImplementationItem = turn.items.find((item) =>
      item.semanticKind === "planImplementation"
      && item.status !== "completed"
      && (item.markdownText ?? "").trim().length > 0);
    if (!planImplementationItem) continue;

    return {
      type: "implementPlan",
      requestId: buildPlanImplementationRequestId(turn.turnId),
      projectId: conversation.projectId,
      cardId: conversation.cardId,
      threadId: conversation.threadId,
      turnId: turn.turnId,
      itemId: planImplementationItem.itemId,
      planContent: (planImplementationItem.markdownText ?? "").trim(),
      createdAt: planImplementationItem.updatedAt,
    };
  }

  return null;
}

export function selectConversationLiveRequests(
  conversation: CodexConversationSnapshot | null,
  options?: ConversationRequestSelectionOptions,
): CodexConversationLiveRequest[] {
  if (!conversation) return [];

  const planRequest = selectPlanImplementationRequest(conversation, options);
  const requests = planRequest
    ? [...conversation.requests, planRequest]
    : [...conversation.requests];

  return requests.sort((left, right) =>
    LIVE_REQUEST_PRIORITY[left.type] - LIVE_REQUEST_PRIORITY[right.type]
    || left.createdAt - right.createdAt,
  );
}

export function selectPrimaryConversationRequest(
  conversation: CodexConversationSnapshot | null,
  options?: ConversationRequestSelectionOptions,
): CodexConversationLiveRequest | null {
  return selectConversationLiveRequests(conversation, options)[0] ?? null;
}

export function selectConversationTurnRequestsByTurnId(
  conversation: CodexConversationSnapshot | null,
  options?: ConversationRequestSelectionOptions,
): Map<string, CodexTurnScopedConversationRequest[]> {
  const requests = selectConversationLiveRequests(conversation, options).filter(
    (request): request is CodexTurnScopedConversationRequest =>
      request.type === "approval"
      || request.type === "userInput"
      || request.type === "implementPlan",
  );

  const requestsByTurnId = new Map<string, CodexTurnScopedConversationRequest[]>();
  for (const request of requests) {
    const current = requestsByTurnId.get(request.turnId) ?? [];
    current.push(request);
    requestsByTurnId.set(request.turnId, current);
  }

  return requestsByTurnId;
}

export function isBlockingConversationRequest(
  request: CodexConversationLiveRequest,
): boolean {
  return request.type === "approval"
    || request.type === "userInput"
    || request.type === "mcpServerElicitation";
}
