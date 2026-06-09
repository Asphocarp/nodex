import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import { buildRendererItemStream } from "./build-renderer-item-stream";
import { buildTurnViewModel } from "./build-turn-view-model";
import type {
  ThreadRendererItemModel,
  ThreadTranscriptBlockModel,
  ThreadTurnModel,
  ThreadWorkedForBlockModel,
} from "../thread-stage-types";

export interface BuildTurnRenderModelInput {
  turn: CodexConversationTurn;
  requests: CodexTurnScopedConversationRequest[];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  canEditTurnUserPrefix?: boolean;
  canForkTurn?: boolean;
}

function hasIncompleteElicitation(
  items: ReturnType<typeof buildRendererItemStream>,
): boolean {
  return items.some(
    (item) => item.type === "mcpServerElicitation" && item.status !== "completed",
  );
}

function hasTranscriptTurnDiffItem(entries: readonly CodexConversationItem[]): boolean {
  return entries.some((entry) => {
    if (entry.semanticKind === "diff") return true;
    if (entry.type === "turn_diff" || entry.type === "turn-diff") return true;
    if (entry.rawItem && typeof entry.rawItem === "object") {
      return (entry.rawItem as { type?: unknown }).type === "turn-diff";
    }
    return false;
  });
}

function hasLiveFileChangeItem(entries: readonly CodexConversationItem[]): boolean {
  return entries.some((entry) =>
    entry.status === "inProgress"
    && (
      entry.kind === "fileChange"
      || entry.semanticKind === "patch"
      || entry.fileChange !== undefined
      || entry.toolCall?.subtype === "fileChange"
    )
  );
}

function buildDerivedTurnDiffEntry(turn: CodexConversationTurn): CodexConversationItem | null {
  const unifiedDiff = turn.diff?.trim();
  if (!unifiedDiff) return null;
  if (hasTranscriptTurnDiffItem(turn.items)) return null;
  if (turn.status === "inProgress" && hasLiveFileChangeItem(turn.items)) return null;

  const timestamp = turn.completedAt ?? turn.startedAt ?? turn.turnStartedAtMs ?? Date.now();
  const itemId = `turn-diff:${turn.turnId}`;
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    itemId,
    entryId: itemId,
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: turn.status,
    rawItem: {
      type: "turn-diff",
      unifiedDiff: turn.diff,
      patchBatches: [],
      showRevertButton: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function appendDerivedTurnDiffEntry(turn: CodexConversationTurn): CodexConversationItem[] {
  const derived = buildDerivedTurnDiffEntry(turn);
  if (!derived) return [...turn.items];
  return [...turn.items, derived];
}

function resolveFiniteTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTranscriptItem(item: ThreadRendererItemModel): item is ThreadTranscriptBlockModel {
  return "entry" in item;
}

function isUserItem(item: ThreadRendererItemModel): boolean {
  return item.type === "userMessage";
}

function findFirstNonUserIndex(items: ThreadRendererItemModel[]): number {
  return items.findIndex((item) => !isUserItem(item));
}

function findFirstFinalAnswerAssistantIndex(items: ThreadRendererItemModel[]): number {
  return items.findIndex((item) =>
    isTranscriptItem(item)
    && item.type === "assistantMessage"
    && item.entry.assistantPhase === "final_answer"
  );
}

function findLastAssistantIndex(items: ThreadRendererItemModel[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "assistantMessage") return index;
  }
  return -1;
}

function hasNonUserItemBefore(items: ThreadRendererItemModel[], boundaryIndex: number): boolean {
  return items.slice(0, Math.max(boundaryIndex, 0)).some((item) => !isUserItem(item));
}

function hasRenderableFinalAssistantContent(item: ThreadRendererItemModel | undefined): boolean {
  if (!item || !isTranscriptItem(item) || item.type !== "assistantMessage") return false;
  if (item.entry.assistantPhase !== "final_answer") return false;
  if ((item.entry.markdownText?.trim().length ?? 0) > 0) return true;
  return item.status === "completed";
}

function resolveWorkedForBoundaryIndex(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
): number {
  if (turn.status === "interrupted") return -1;
  if (turn.status === "inProgress") {
    const finalAnswerIndex = findFirstFinalAnswerAssistantIndex(items);
    return finalAnswerIndex >= 0 ? finalAnswerIndex : items.length;
  }
  return findLastAssistantIndex(items);
}

function resolveWorkedForCompletedAtMs(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
  boundaryIndex: number,
): number | null {
  const finalAssistantStartedAtMs = resolveFiniteTimestamp(turn.finalAssistantStartedAtMs);
  if (finalAssistantStartedAtMs === null) return null;

  return hasRenderableFinalAssistantContent(items[boundaryIndex])
    ? finalAssistantStartedAtMs
    : null;
}

function buildWorkedForItem(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
): ThreadWorkedForBlockModel | null {
  const startedAtMs = resolveFiniteTimestamp(turn.firstTurnWorkItemStartedAtMs);
  if (startedAtMs === null) return null;

  const boundaryIndex = resolveWorkedForBoundaryIndex(turn, items);
  if (boundaryIndex < 0) return null;
  if (!hasNonUserItemBefore(items, boundaryIndex)) return null;

  const completedAtMs = resolveWorkedForCompletedAtMs(turn, items, boundaryIndex);
  if (turn.status !== "inProgress" && completedAtMs === null) return null;

  return {
    id: `${turn.turnId}:worked-for`,
    turnId: turn.turnId,
    createdAt: startedAtMs,
    updatedAt: completedAtMs ?? startedAtMs,
    searchableText: "",
    type: "workedFor",
    status: completedAtMs === null ? "working" : "worked",
    startedAtMs,
    completedAtMs,
  };
}

function insertWorkedForItem(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
  workedForItem: ThreadWorkedForBlockModel | null,
): ThreadRendererItemModel[] {
  if (!workedForItem) return items;

  const boundaryIndex = turn.status === "inProgress"
    ? findFirstNonUserIndex(items)
    : resolveWorkedForBoundaryIndex(turn, items);
  if (boundaryIndex < 0) return items;

  return [
    ...items.slice(0, boundaryIndex),
    workedForItem,
    ...items.slice(boundaryIndex),
  ];
}

export function buildTurnRenderModel(
  input: BuildTurnRenderModelInput,
): ThreadTurnModel {
  const entries = appendDerivedTurnDiffEntry(input.turn);
  const baseItems = buildRendererItemStream({
    entries,
    requests: input.requests,
    turnStatus: input.turn.status,
    isLatestTurn: input.isLatestTurn,
  });
  const workedForItem = buildWorkedForItem(input.turn, baseItems);
  const workedForTiming = workedForItem
    ? {
        status: workedForItem.status,
        startedAtMs: workedForItem.startedAtMs,
        completedAtMs: workedForItem.completedAtMs,
      }
    : null;
  const items = insertWorkedForItem(input.turn, baseItems, workedForItem);
  const buckets = bucketizeTurnItems({
    items,
    turnStatus: input.turn.status,
  });
  const isBlocked =
    buckets.approvalItem !== null
    || buckets.userInputItem !== null
    || hasIncompleteElicitation(items);

  return buildTurnViewModel({
    turnId: input.turn.turnId,
    turn: input.turn,
    buckets,
    workedForItem,
    workedForTiming,
    workedDurationMs: resolveFiniteTimestamp(input.turn.durationMs),
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked,
    canEditTurnUserPrefix: input.canEditTurnUserPrefix,
    canForkTurn: input.canForkTurn,
  });
}
