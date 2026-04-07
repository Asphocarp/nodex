import type {
  CodexApprovalRequest,
  CodexConversationLiveRequest,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationServerRequest,
  CodexMcpServerElicitationRequest,
  CodexPlanImplementationServerRequest,
  CodexPlanImplementationRequest,
  CodexUserInputRequest,
} from "./types";

export type CodexTurnScopedConversationRequest = Exclude<
  CodexConversationLiveRequest,
  { type: "mcpServerElicitation" }
>;

const EMPTY_LIVE_REQUESTS: CodexConversationLiveRequest[] = [];
const EMPTY_TURN_REQUESTS: CodexTurnScopedConversationRequest[] = [];
const EMPTY_TURN_REQUESTS_BY_TURN_ID = new Map<string, CodexTurnScopedConversationRequest[]>();

interface LatestPlanImplementationSelection {
  item: CodexConversationItem;
  turnId: string;
}

interface DerivedConversationRequestSelection {
  planSelection: LatestPlanImplementationSelection | null;
  liveRequests: CodexConversationLiveRequest[];
  primaryRequest: CodexConversationLiveRequest | null;
  requestsByTurnId: Map<string, CodexTurnScopedConversationRequest[]>;
}

interface DerivedConversationRequestCacheEntry extends DerivedConversationRequestSelection {
  latestPlanItemRef: CodexConversationItem | null;
  latestPlanTurnId: string | null;
}

const derivedRequestSelectionsByServerRequestRef = new WeakMap<
  readonly CodexConversationServerRequest[],
  DerivedConversationRequestCacheEntry[]
>();

export function buildPlanImplementationRequestId(turnId: string): string {
  return `implement-plan:${turnId}`;
}

function isLivePlanImplementationItem(
  item: CodexConversationItem,
): boolean {
  return item.semanticKind === "planImplementation"
    && item.status !== "completed"
    && (item.markdownText ?? "").trim().length > 0;
}

function selectLatestPlanImplementationItem(
  conversation: CodexConversationSnapshot,
): LatestPlanImplementationSelection | null {
  for (let turnIndex = conversation.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = conversation.turns[turnIndex];
    if (!turn) continue;

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item || !isLivePlanImplementationItem(item)) {
        continue;
      }

      return {
        item,
        turnId: turn.turnId,
      };
    }
  }

  return null;
}

function findMatchingPlanImplementationRequest(
  conversation: CodexConversationSnapshot,
  turnId: string,
  itemId: string,
): CodexPlanImplementationServerRequest | null {
  return conversation.requests.find(
    (request): request is CodexPlanImplementationServerRequest =>
      request.type === "implementPlan"
      && request.turnId === turnId
      && request.itemId === itemId,
  ) ?? null;
}

function upsertLatestTurnRequest<TRequest extends CodexConversationServerRequest>(
  byTurnId: Map<string, TRequest>,
  request: TRequest,
): void {
  const existing = byTurnId.get(request.turnId);
  if (!existing || existing.createdAt <= request.createdAt) {
    byTurnId.set(request.turnId, request);
  }
}

function freezeTurnRequestMap(
  requests: CodexConversationLiveRequest[],
): Map<string, CodexTurnScopedConversationRequest[]> {
  if (requests.length === 0) {
    return EMPTY_TURN_REQUESTS_BY_TURN_ID;
  }

  const requestsByTurnId = new Map<string, CodexTurnScopedConversationRequest[]>();
  for (const request of requests) {
    if (request.type === "mcpServerElicitation") {
      continue;
    }

    const current = requestsByTurnId.get(request.turnId);
    if (!current) {
      requestsByTurnId.set(request.turnId, [request]);
      continue;
    }

    current.push(request);
  }

  for (const [turnId, turnRequests] of requestsByTurnId.entries()) {
    requestsByTurnId.set(turnId, turnRequests.length === 0 ? EMPTY_TURN_REQUESTS : turnRequests);
  }

  return requestsByTurnId;
}

function deriveConversationRequestSelection(
  conversation: CodexConversationSnapshot,
): DerivedConversationRequestSelection {
  const latestPlanSelection = selectLatestPlanImplementationItem(conversation);
  const planRequest = latestPlanSelection
    ? buildPlanImplementationRequest(conversation, latestPlanSelection)
    : null;

  const latestApprovalByTurnId = new Map<string, CodexApprovalRequest>();
  const latestUserInputByTurnId = new Map<string, CodexUserInputRequest>();
  const latestMcpElicitationByTurnId = new Map<string, CodexMcpServerElicitationRequest>();
  for (const request of conversation.requests) {
    switch (request.type) {
      case "approval":
        upsertLatestTurnRequest(latestApprovalByTurnId, request);
        break;
      case "userInput":
        upsertLatestTurnRequest(latestUserInputByTurnId, request);
        break;
      case "mcpServerElicitation":
        upsertLatestTurnRequest(latestMcpElicitationByTurnId, request);
        break;
      case "implementPlan":
        break;
    }
  }

  const liveRequests: CodexConversationLiveRequest[] = [];
  for (let turnIndex = conversation.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = conversation.turns[turnIndex];
    if (!turn) continue;

    const userInput = latestUserInputByTurnId.get(turn.turnId);
    if (userInput) {
      liveRequests.push(userInput);
    }

    const approval = latestApprovalByTurnId.get(turn.turnId);
    if (approval) {
      liveRequests.push(approval);
    }

    const mcpElicitation = latestMcpElicitationByTurnId.get(turn.turnId);
    if (mcpElicitation) {
      liveRequests.push(mcpElicitation);
    }

    if (planRequest && planRequest.turnId === turn.turnId) {
      liveRequests.push(planRequest);
    }
  }

  return {
    planSelection: latestPlanSelection,
    liveRequests: liveRequests.length === 0 ? EMPTY_LIVE_REQUESTS : liveRequests,
    primaryRequest: liveRequests[0] ?? null,
    requestsByTurnId: freezeTurnRequestMap(liveRequests),
  };
}

function resolveDerivedConversationRequestSelection(
  conversation: CodexConversationSnapshot,
): DerivedConversationRequestSelection {
  const latestPlanSelection = selectLatestPlanImplementationItem(conversation);
  const latestPlanItemRef = latestPlanSelection?.item ?? null;
  const latestPlanTurnId = latestPlanSelection?.turnId ?? null;
  const cachedEntries = derivedRequestSelectionsByServerRequestRef.get(conversation.requests);
  const cached = cachedEntries?.find((entry) =>
    entry.latestPlanItemRef === latestPlanItemRef
    && entry.latestPlanTurnId === latestPlanTurnId,
  );
  if (cached) {
    return cached;
  }

  const derived = deriveConversationRequestSelection(conversation);
  const entry: DerivedConversationRequestCacheEntry = {
    ...derived,
    latestPlanItemRef,
    latestPlanTurnId,
  };
  const nextEntries = cachedEntries ? [...cachedEntries, entry] : [entry];
  derivedRequestSelectionsByServerRequestRef.set(conversation.requests, nextEntries);
  return entry;
}

export function areConversationLiveRequestsEqual(
  left: CodexConversationLiveRequest | null,
  right: CodexConversationLiveRequest | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.type !== right.type) {
    return false;
  }

  if (
    left.requestId !== right.requestId
    || left.threadId !== right.threadId
    || left.turnId !== right.turnId
    || left.itemId !== right.itemId
    || left.createdAt !== right.createdAt
  ) {
    return false;
  }

  switch (left.type) {
    case "approval":
      return (
        right.type === "approval"
        &&
        left.kind === right.kind
        && left.command === right.command
        && left.reason === right.reason
        && left.cwd === right.cwd
      );
    case "userInput":
      if (right.type !== "userInput") return false;
      return left.questions === right.questions;
    case "mcpServerElicitation":
      return (
        right.type === "mcpServerElicitation"
        &&
        left.kind === right.kind
        && left.mode === right.mode
        && left.serverName === right.serverName
        && left.message === right.message
      );
    case "implementPlan":
      if (right.type !== "implementPlan") return false;
      return left.planContent === right.planContent;
  }
}

export function selectPlanImplementationRequest(
  conversation: CodexConversationSnapshot | null,
): CodexPlanImplementationRequest | null {
  if (!conversation) return null;

  const selected = resolveDerivedConversationRequestSelection(conversation).planSelection;
  if (!selected) return null;

  return buildPlanImplementationRequest(conversation, selected);
}

function buildPlanImplementationRequest(
  conversation: CodexConversationSnapshot,
  selected: LatestPlanImplementationSelection,
): CodexPlanImplementationRequest {
  const request = findMatchingPlanImplementationRequest(
    conversation,
    selected.turnId,
    selected.item.itemId,
  );
  const createdAt = request?.createdAt ?? selected.item.createdAt;

  return {
    type: "implementPlan",
    requestId: request?.requestId ?? buildPlanImplementationRequestId(selected.turnId),
    projectId: request?.projectId ?? conversation.projectId,
    cardId: request?.cardId ?? conversation.cardId,
    threadId: conversation.threadId,
    turnId: selected.turnId,
    itemId: selected.item.itemId,
    planContent: (selected.item.markdownText ?? "").trim(),
    createdAt,
  };
}

export function selectConversationLiveRequests(
  conversation: CodexConversationSnapshot | null,
): CodexConversationLiveRequest[] {
  if (!conversation) return EMPTY_LIVE_REQUESTS;
  return resolveDerivedConversationRequestSelection(conversation).liveRequests;
}

export function selectPrimaryConversationRequest(
  conversation: CodexConversationSnapshot | null,
): CodexConversationLiveRequest | null {
  if (!conversation) return null;
  return resolveDerivedConversationRequestSelection(conversation).primaryRequest;
}

export function selectConversationTurnRequestsByTurnId(
  conversation: CodexConversationSnapshot | null,
): Map<string, CodexTurnScopedConversationRequest[]> {
  if (!conversation) return EMPTY_TURN_REQUESTS_BY_TURN_ID;
  return resolveDerivedConversationRequestSelection(conversation).requestsByTurnId;
}

export function selectTurnScopedConversationRequests(
  requestsByTurnId: ReadonlyMap<string, CodexTurnScopedConversationRequest[]>,
  turnId: string,
): CodexTurnScopedConversationRequest[] {
  return requestsByTurnId.get(turnId) ?? EMPTY_TURN_REQUESTS;
}

export function isBlockingConversationRequest(
  request: CodexConversationLiveRequest,
): boolean {
  return request.type === "approval"
    || request.type === "userInput"
    || request.type === "mcpServerElicitation";
}
