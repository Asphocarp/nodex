import type {
  CodexBackgroundTerminalRow,
  CodexConversationChildMembership,
  CodexConversationCapabilityFlags,
  CodexConversationItem,
  CodexConversationResumeState,
  CodexPendingSteer,
  CodexQueuedFollowUp,
  CodexConversationServerRequest,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexThreadDetail,
  CodexTranscriptEntry,
} from "../../shared/types";

function sortConversationItems(left: CodexTranscriptEntry, right: CodexTranscriptEntry): number {
  return (left.sequence ?? 0) - (right.sequence ?? 0)
    || left.createdAt - right.createdAt
    || left.updatedAt - right.updatedAt
    || left.itemId.localeCompare(right.itemId);
}

function sortTurnItemsByCanonicalOrder(
  entries: CodexTranscriptEntry[],
  turn: CodexThreadDetail["turns"][number],
): CodexTranscriptEntry[] {
  if (turn.itemIds.length === 0) {
    return [...entries].sort(sortConversationItems);
  }

  const orderByItemId = new Map(turn.itemIds.map((itemId, index) => [itemId, index]));

  return [...entries].sort((left, right) => {
    const leftOrder = orderByItemId.get(left.itemId);
    const rightOrder = orderByItemId.get(right.itemId);

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return sortConversationItems(left, right);
  });
}

function buildConversationTurn(
  detail: CodexThreadDetail,
  turn: CodexThreadDetail["turns"][number],
): CodexConversationTurn {
  const items = detail.transcript
    .filter((entry) => entry.turnId === turn.turnId)
    .sort(sortConversationItems);

  const orderedItems = sortTurnItemsByCanonicalOrder(items, turn)
    .map<CodexConversationItem>((entry) => ({ ...entry }));

  return {
    ...turn,
    items: orderedItems,
  };
}

export function buildCodexConversationSnapshot(input: {
  detail: CodexThreadDetail;
  resumeState: CodexConversationResumeState;
  requests: CodexConversationServerRequest[];
  queuedFollowUps?: CodexQueuedFollowUp[];
  pendingSteers?: CodexPendingSteer[];
  backgroundTerminalRows?: CodexBackgroundTerminalRow[];
  childMemberships?: CodexConversationChildMembership[];
  capabilityFlags: CodexConversationCapabilityFlags;
}): CodexConversationSnapshot {
  const { transcript, ...detail } = input.detail;
  void transcript;

  return {
    ...detail,
    resumeState: input.resumeState,
    turns: input.detail.turns.map((turn) => buildConversationTurn(input.detail, turn)),
    requests: [...input.requests].sort((left, right) => left.createdAt - right.createdAt),
    queuedFollowUps: [...(input.queuedFollowUps ?? [])].sort((left, right) => left.createdAt - right.createdAt),
    pendingSteers: [...(input.pendingSteers ?? [])].sort((left, right) => left.createdAt - right.createdAt),
    backgroundTerminalRows: [...(input.backgroundTerminalRows ?? [])],
    childMemberships: [...(input.childMemberships ?? [])],
    capabilityFlags: input.capabilityFlags,
  };
}
