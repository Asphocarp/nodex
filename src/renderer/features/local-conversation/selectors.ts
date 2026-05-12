import type {
  CodexConversationResumeState,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../lib/types";
import {
  isBlockingConversationRequest,
  selectConversationLiveRequests,
  selectConversationTurnRequestsByTurnId,
  selectTurnScopedConversationRequests,
  type CodexTurnScopedConversationRequest,
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

export interface VisibleConversationTurnEntry {
  turn: CodexConversationTurn;
  turnId: string;
  turnKey: string;
  turnSearchKey: string;
  requests: CodexTurnScopedConversationRequest[];
  isMostRecentTurn: boolean;
}

const EMPTY_VISIBLE_TURN_ENTRIES: VisibleConversationTurnEntry[] = [];
const EMPTY_PARENT_TURNS: CodexConversationTurn[] = [];
const visibleTurnEntriesByTurn = new WeakMap<
  CodexConversationTurn,
  VisibleConversationTurnEntry[]
>();
const visibleTurnEntrySelectionsByTurns = new WeakMap<
  readonly CodexConversationTurn[],
  Array<{
    parentTurns: readonly CodexConversationTurn[];
    requestsByTurnId: ReadonlyMap<string, CodexTurnScopedConversationRequest[]>;
    resumeState: CodexConversationResumeState;
    entries: VisibleConversationTurnEntry[];
  }>
>();

function isRenderableConversationTurn(
  turn: CodexConversationTurn,
  requests: readonly CodexTurnScopedConversationRequest[],
): boolean {
  return turn.items.length > 0 || requests.length > 0 || (turn.diff?.trim().length ?? 0) > 0;
}

function createVisibleConversationTurnEntry(input: {
  turn: CodexConversationTurn;
  index: number;
  requests: CodexTurnScopedConversationRequest[];
  isMostRecentTurn: boolean;
}): VisibleConversationTurnEntry {
  const turnKey = input.turn.turnId || `turn-index-${input.index}`;
  const candidates = visibleTurnEntriesByTurn.get(input.turn) ?? [];
  const cached = candidates.find((candidate) =>
    candidate.requests === input.requests
    && candidate.isMostRecentTurn === input.isMostRecentTurn
    && candidate.turnKey === turnKey
    && candidate.turnSearchKey === turnKey,
  );
  if (cached) {
    return cached;
  }

  const entry: VisibleConversationTurnEntry = {
    turn: input.turn,
    turnId: input.turn.turnId,
    turnKey,
    turnSearchKey: turnKey,
    requests: input.requests,
    isMostRecentTurn: input.isMostRecentTurn,
  };
  visibleTurnEntriesByTurn.set(input.turn, [...candidates, entry]);
  return entry;
}

function selectMergedVisibleTurnIds(input: {
  turns: readonly CodexConversationTurn[];
  parentTurns: readonly CodexConversationTurn[];
  resumeState: CodexConversationResumeState;
}): ReadonlySet<string> | null {
  if (input.resumeState !== "resumed" || input.parentTurns.length === 0) {
    return null;
  }

  const parentTurnIds = new Set<string>();
  for (const turn of input.parentTurns) {
    if (turn.turnId.length > 0) {
      parentTurnIds.add(turn.turnId);
    }
  }

  if (parentTurnIds.size === 0) {
    return null;
  }

  const visibleTurnIds = new Set<string>();
  for (const turn of input.turns) {
    if (turn.turnId.length === 0 || !parentTurnIds.has(turn.turnId)) {
      visibleTurnIds.add(turn.turnId);
    }
  }
  return visibleTurnIds;
}

export function selectVisibleConversationTurns(
  conversation: CodexConversationSnapshot | null,
): CodexConversationTurn[] {
  if (!conversation) return [];
  return conversation.turns;
}

export function selectVisibleConversationTurnEntries(input: {
  conversation: CodexConversationSnapshot | null;
  parentTurns?: readonly CodexConversationTurn[] | null;
}): VisibleConversationTurnEntry[] {
  const conversation = input.conversation;
  if (!conversation) {
    return EMPTY_VISIBLE_TURN_ENTRIES;
  }

  const turns = conversation.turns;
  if (turns.length === 0) {
    return EMPTY_VISIBLE_TURN_ENTRIES;
  }

  const requestsByTurnId = selectConversationTurnRequestsByTurnId(conversation);
  const parentTurns = input.parentTurns ?? EMPTY_PARENT_TURNS;
  const cachedSelections = visibleTurnEntrySelectionsByTurns.get(turns);
  const cached = cachedSelections?.find((selection) =>
    selection.parentTurns === parentTurns
    && selection.requestsByTurnId === requestsByTurnId
    && selection.resumeState === conversation.resumeState,
  );
  if (cached) {
    return cached.entries;
  }

  const latestTurnId = turns[turns.length - 1]?.turnId ?? null;
  const mergedVisibleTurnIds = selectMergedVisibleTurnIds({
    turns,
    parentTurns,
    resumeState: conversation.resumeState,
  });
  const entries = turns.flatMap((turn, index) => {
    const requests = selectTurnScopedConversationRequests(requestsByTurnId, turn.turnId);
    if (!isRenderableConversationTurn(turn, requests)) {
      return [];
    }

    if (mergedVisibleTurnIds && !mergedVisibleTurnIds.has(turn.turnId)) {
      return [];
    }

    return [createVisibleConversationTurnEntry({
      turn,
      index,
      requests,
      isMostRecentTurn: latestTurnId === turn.turnId,
    })];
  });

  if (entries.length === 0) {
    return EMPTY_VISIBLE_TURN_ENTRIES;
  }

  const nextSelections = cachedSelections
    ? [
        ...cachedSelections,
        {
          parentTurns,
          requestsByTurnId,
          resumeState: conversation.resumeState,
          entries,
        },
      ]
    : [{
        parentTurns,
        requestsByTurnId,
        resumeState: conversation.resumeState,
        entries,
      }];
  visibleTurnEntrySelectionsByTurns.set(turns, nextSelections);
  return entries;
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
