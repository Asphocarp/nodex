import type {
  CodexConversationLiveRequest,
  CodexConversationSnapshot,
  CodexPlanImplementationServerRequest,
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

export function buildPlanImplementationRequestId(turnId: string): string {
  return `implement-plan:${turnId}`;
}

function selectPlanImplementationItem(
  conversation: CodexConversationSnapshot,
  request: CodexPlanImplementationServerRequest,
) {
  const turn = conversation.turns.find((candidate) => candidate.turnId === request.turnId);
  if (!turn) return null;

  return turn.items.find((item) =>
    item.itemId === request.itemId
    && item.semanticKind === "planImplementation"
    && item.status !== "completed"
    && (item.markdownText ?? "").trim().length > 0,
  ) ?? null;
}

export function selectPlanImplementationRequest(
  conversation: CodexConversationSnapshot | null,
): CodexPlanImplementationRequest | null {
  if (!conversation) return null;

  const requests = conversation.requests
    .filter((request): request is CodexPlanImplementationServerRequest => request.type === "implementPlan")
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const request of requests) {
    const item = selectPlanImplementationItem(conversation, request);
    if (!item) {
      continue;
    }

    return {
      ...request,
      planContent: (item.markdownText ?? "").trim(),
      createdAt: request.createdAt,
    };
  }

  return null;
}

export function selectConversationLiveRequests(
  conversation: CodexConversationSnapshot | null,
): CodexConversationLiveRequest[] {
  if (!conversation) return [];

  const requests: CodexConversationLiveRequest[] = [];
  for (const request of conversation.requests) {
    if (request.type !== "implementPlan") {
      requests.push(request);
      continue;
    }

    const selected = selectPlanImplementationRequest({
      ...conversation,
      requests: [request],
    });
    if (selected) {
      requests.push(selected);
    }
  }

  return requests.sort((left, right) =>
    LIVE_REQUEST_PRIORITY[left.type] - LIVE_REQUEST_PRIORITY[right.type]
    || left.createdAt - right.createdAt,
  );
}

export function selectPrimaryConversationRequest(
  conversation: CodexConversationSnapshot | null,
): CodexConversationLiveRequest | null {
  return selectConversationLiveRequests(conversation)[0] ?? null;
}

export function selectConversationTurnRequestsByTurnId(
  conversation: CodexConversationSnapshot | null,
): Map<string, CodexTurnScopedConversationRequest[]> {
  const requests = selectConversationLiveRequests(conversation).filter(
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
