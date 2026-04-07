import type { CodexConversationSnapshot } from "../../../lib/types";
import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadComposerShellModel,
  ThreadComposerShellPendingRequestModel,
} from "../thread-stage-types";
import {
  buildComposerPendingSteerRows,
  buildComposerQueuedFollowUpRows,
} from "./build-composer-follow-up-lane-model";
import {
  isBlockingConversationRequest,
  selectPrimaryConversationRequest,
} from "../conversation-request-helpers";

interface BuildComposerShellModelInput {
  conversation: CodexConversationSnapshot | null;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
}

function resolveRequestItem(
  conversation: CodexConversationSnapshot | null,
  request: ThreadComposerShellPendingRequestModel["request"] | null,
) {
  if (!conversation || !request) return null;
  const turn = conversation.turns.find((candidate) => candidate.turnId === request.turnId);
  if (!turn) return null;
  return turn.items.find((item) => item.itemId === request.itemId) ?? null;
}

function resolveBackgroundRequest(
  conversation: CodexConversationSnapshot,
  knownConversationsById: Record<string, CodexConversationSnapshot>,
): ThreadComposerShellPendingRequestModel | null {
  for (const membership of conversation.childMemberships) {
    const childConversation = knownConversationsById[membership.threadId];
    const request = selectPrimaryConversationRequest(childConversation ?? null);
    if (!request || request.type !== "approval") {
      continue;
    }

    return {
      request,
      conversationId: membership.threadId,
      surface: "backgroundThread",
      actorName: membership.actorName ?? null,
      requestItem: resolveRequestItem(childConversation ?? null, request),
    };
  }

  return null;
}

function resolveBackgroundAgentStatus(
  conversation: CodexConversationSnapshot,
): ThreadComposerShellBackgroundAgentRowModel["status"] {
  const hasBlockingRequest = conversation.requests.some((request) =>
    isBlockingConversationRequest(request),
  );
  const isWaiting = conversation.statusActiveFlags.includes("waitingOnApproval")
    || conversation.statusActiveFlags.includes("waitingOnUserInput")
    || hasBlockingRequest;
  if (isWaiting) {
    return "waiting";
  }

  const hasInProgressTurn = conversation.turns.some((turn) => turn.status === "inProgress");
  if (conversation.statusType === "active" || hasInProgressTurn) {
    return "active";
  }

  return "done";
}

function buildBackgroundAgentRows(
  conversation: CodexConversationSnapshot,
  knownConversationsById: Record<string, CodexConversationSnapshot>,
): ThreadComposerShellBackgroundAgentRowModel[] {
  return conversation.childMemberships.flatMap((membership) => {
    const childConversation = knownConversationsById[membership.threadId];
    if (!childConversation || childConversation.archived) {
      return [];
    }

    const displayName = membership.actorName?.trim()
      || childConversation.threadName?.trim()
      || childConversation.threadPreview?.trim()
      || membership.threadId;

    return [{
      conversationId: membership.threadId,
      displayName,
      actorName: membership.actorName?.trim() || displayName,
      status: resolveBackgroundAgentStatus(childConversation),
      role: membership.role,
    }];
  });
}

export function buildComposerShellModel(
  input: BuildComposerShellModelInput,
): ThreadComposerShellModel {
  const conversation = input.conversation;
  if (!conversation) {
    return {
      activeRequest: null,
      backgroundRequest: null,
      pendingSteerRows: [],
      queuedFollowUpRows: [],
      backgroundAgentRows: [],
      backgroundTerminalRows: [],
      showRequestCards: false,
      showComposer: true,
      showApprovalMode: false,
    };
  }

  const activeRequest = selectPrimaryConversationRequest(conversation);
  const backgroundRequest = resolveBackgroundRequest(
    conversation,
    input.knownConversationsById,
  );

  const showRequestCards = activeRequest !== null || backgroundRequest !== null;
  const showApprovalMode = activeRequest?.type === "approval" || backgroundRequest !== null;

  return {
    activeRequest: activeRequest
      ? {
          request: activeRequest,
          conversationId: conversation.threadId,
          surface: "activeThread",
          requestItem: resolveRequestItem(conversation, activeRequest),
        }
      : null,
    backgroundRequest,
    pendingSteerRows: buildComposerPendingSteerRows(conversation.pendingSteers),
    queuedFollowUpRows: buildComposerQueuedFollowUpRows(conversation.queuedFollowUps),
    backgroundAgentRows: buildBackgroundAgentRows(conversation, input.knownConversationsById),
    backgroundTerminalRows: conversation.backgroundTerminalRows,
    showRequestCards,
    showComposer: !showRequestCards,
    showApprovalMode,
  };
}
