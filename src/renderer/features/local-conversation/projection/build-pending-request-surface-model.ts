import type { CodexConversationSnapshot } from "../../../lib/types";
import type {
  PendingRequestSurfaceModel,
  PendingRequestSurfaceRequestModel,
} from "../thread-stage-types";
import {
  isBlockingConversationRequest,
  selectConversationLiveRequests,
  selectPrimaryConversationRequest,
} from "../conversation-request-helpers";

interface BuildPendingRequestSurfaceModelInput {
  conversation: CodexConversationSnapshot | null;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  dismissedPlanImplementationTurnIdByThread?: Record<string, string>;
}

export function buildPendingRequestSurfaceModel(
  input: BuildPendingRequestSurfaceModelInput,
): PendingRequestSurfaceModel | null {
  const conversation = input.conversation;
  const threadId = conversation?.threadId ?? null;
  const dismissedPlanImplementationTurnIdByThread = input.dismissedPlanImplementationTurnIdByThread ?? {};
  if (!conversation || !threadId) return null;

  const entries: PendingRequestSurfaceRequestModel[] = [];

  const activeRequest = selectPrimaryConversationRequest(conversation, {
    dismissedPlanImplementationTurnId: dismissedPlanImplementationTurnIdByThread[threadId] ?? null,
  });
  if (activeRequest) {
    entries.push({
      kind: "request",
      request: activeRequest,
      surface: "activeThread",
      blocksActiveTurn: activeRequest.threadId === threadId && isBlockingConversationRequest(activeRequest),
    });
  }

  const backgroundRequest = conversation.childMemberships
    .map((membership) => {
      const childConversation = input.knownConversationsById[membership.threadId];
      const request = selectPrimaryConversationRequest(childConversation ?? null, {
        dismissedPlanImplementationTurnId: dismissedPlanImplementationTurnIdByThread[membership.threadId] ?? null,
      });
      if (!request || request.type !== "approval") return null;

      return {
        kind: "request",
        request,
        surface: "backgroundThread",
        blocksActiveTurn: false,
        actorName: membership.actorName ?? null,
      } satisfies PendingRequestSurfaceRequestModel;
    })
    .find((entry) => entry !== null) ?? null;

  if (backgroundRequest) {
    entries.push(backgroundRequest);
  }

  if (entries.length === 0) return null;

  const blockedTurnIds = selectConversationLiveRequests(conversation, {
    dismissedPlanImplementationTurnId: dismissedPlanImplementationTurnIdByThread[threadId] ?? null,
  })
    .filter((request) => isBlockingConversationRequest(request))
    .map((request) => request.turnId)
    .filter((turnId, index, values) => values.indexOf(turnId) === index);
  const hasBlockingActiveRequest = entries.some((entry) =>
    entry.kind === "request"
    && entry.surface === "activeThread"
    && entry.blocksActiveTurn);
  const hasBackgroundApproval = entries.some((entry) =>
    entry.kind === "request"
    && entry.surface === "backgroundThread"
    && entry.request.type === "approval");

  return {
    entries,
    blockedTurnIds,
    activeRequestCount: entries.filter((entry) => entry.kind === "request" && entry.surface === "activeThread").length,
    backgroundRequestCount: entries.filter((entry) => entry.kind === "request" && entry.surface === "backgroundThread").length,
    showComposer: !hasBlockingActiveRequest && !hasBackgroundApproval,
    hasBlockingActiveRequest,
  };
}
