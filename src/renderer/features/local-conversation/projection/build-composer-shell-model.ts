import type {
  CodexBackgroundTerminalRow,
  CodexConversationChildMembership,
  CodexCanonicalServerRequest,
  CodexConversationLiveRequest,
  CodexConversationSnapshot,
  CodexConversationServerRequest,
  CodexConversationTurn,
  CodexPendingSteer,
  CodexQueuedFollowUp,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
} from "../../../lib/types";
import type {
  ThreadComposerShellModel,
  ThreadComposerShellPendingRequestModel,
} from "../thread-stage-types";
import {
  buildComposerPendingSteerRows,
  buildComposerQueuedFollowUpRows,
} from "./build-composer-follow-up-lane-model";
import {
  selectPrimaryBackgroundConversationRequest,
  selectPrimaryConversationRequest,
} from "../conversation-request-helpers";
import { buildBackgroundSubagentRows } from "./background-subagent-row-model";

interface ExplicitBuildComposerShellModelInput {
  threadId: string | null;
  turns: CodexConversationTurn[];
  requests: CodexConversationServerRequest[];
  canonicalRequests?: CodexCanonicalServerRequest[];
  pendingSteers: CodexPendingSteer[];
  queuedFollowUps: CodexQueuedFollowUp[];
  backgroundTerminalRows: CodexBackgroundTerminalRow[];
  childMemberships: CodexConversationChildMembership[];
  statusType: CodexThreadStatusType | null;
  statusActiveFlags: CodexThreadActiveFlag[];
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  primaryRequest?: CodexConversationLiveRequest | null;
}

interface LegacyBuildComposerShellModelInput {
  conversation: CodexConversationSnapshot;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  primaryRequest?: CodexConversationLiveRequest | null;
}

export type BuildComposerShellModelInput =
  | ExplicitBuildComposerShellModelInput
  | LegacyBuildComposerShellModelInput;

function normalizeBuildComposerShellModelInput(
  input: BuildComposerShellModelInput,
): ExplicitBuildComposerShellModelInput {
  if ("conversation" in input) {
    return {
      threadId: input.conversation.threadId,
      turns: input.conversation.turns,
      requests: input.conversation.requests,
      canonicalRequests: input.conversation.canonicalRequests,
      pendingSteers: input.conversation.pendingSteers,
      queuedFollowUps: input.conversation.queuedFollowUps,
      backgroundTerminalRows: input.conversation.backgroundTerminalRows,
      childMemberships: input.conversation.childMemberships,
      statusType: input.conversation.statusType,
      statusActiveFlags: input.conversation.statusActiveFlags,
      knownConversationsById: input.knownConversationsById,
      primaryRequest: input.primaryRequest,
    };
  }

  return input;
}

function resolveRequestItem(
  turns: readonly CodexConversationTurn[],
  request: ThreadComposerShellPendingRequestModel["request"] | null,
) {
  if (!request) return null;
  const turn = turns.find((candidate) => candidate.turnId === request.turnId);
  if (!turn) return null;
  return turn.items.find((item) => item.itemId === request.itemId) ?? null;
}

function resolveBackgroundRequest(
  input: Pick<ExplicitBuildComposerShellModelInput, "childMemberships">,
  knownConversationsById: Record<string, CodexConversationSnapshot>,
): ThreadComposerShellPendingRequestModel | null {
  for (const membership of input.childMemberships) {
    const childConversation = knownConversationsById[membership.threadId];
    const request = selectPrimaryBackgroundConversationRequest(childConversation ?? null);
    if (!request) {
      continue;
    }

    return {
      request,
      conversationId: membership.threadId,
      surface: "backgroundThread",
      actorName: membership.actorName ?? null,
      requestItem: resolveRequestItem(childConversation?.turns ?? [], request),
    };
  }

  return null;
}

export function buildComposerShellModel(
  input: BuildComposerShellModelInput,
): ThreadComposerShellModel {
  const normalized = normalizeBuildComposerShellModelInput(input);

  if (!normalized.threadId) {
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

    const activeRequest = normalized.primaryRequest ?? selectPrimaryConversationRequest({
      threadId: normalized.threadId,
      projectId: null,
    source: null,
    threadName: null,
    threadPreview: "",
    modelProvider: "",
    cwd: null,
    statusType: normalized.statusType ?? "notLoaded",
    statusActiveFlags: normalized.statusActiveFlags,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    linkedAt: "",
    latestCollaborationMode: undefined,
    resumeState: "resumed",
    turns: normalized.turns,
    canonicalRequests: normalized.canonicalRequests,
    requests: normalized.requests,
    queuedFollowUps: normalized.queuedFollowUps,
    pendingSteers: normalized.pendingSteers,
    backgroundTerminalRows: normalized.backgroundTerminalRows,
    childMemberships: normalized.childMemberships,
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: true,
      canCollapseTurns: true,
    },
  });
  const backgroundRequest = resolveBackgroundRequest(
    normalized,
    normalized.knownConversationsById,
  );

  const showRequestCards = activeRequest !== null || backgroundRequest !== null;
  const showApprovalMode = activeRequest?.type === "approval"
    || activeRequest?.type === "permissionRequest"
    || backgroundRequest !== null;

  return {
    activeRequest: activeRequest
      ? {
          request: activeRequest,
          conversationId: normalized.threadId,
          surface: "activeThread",
          requestItem: resolveRequestItem(normalized.turns, activeRequest),
        }
      : null,
    backgroundRequest,
    pendingSteerRows: buildComposerPendingSteerRows(normalized.pendingSteers),
    queuedFollowUpRows: buildComposerQueuedFollowUpRows(normalized.queuedFollowUps),
    backgroundAgentRows: buildBackgroundSubagentRows({
      childMemberships: normalized.childMemberships,
      knownConversationsById: normalized.knownConversationsById,
      parentTurns: normalized.turns,
    }),
    backgroundTerminalRows: normalized.backgroundTerminalRows,
    showRequestCards,
    showComposer: !showRequestCards,
    showApprovalMode,
  };
}
