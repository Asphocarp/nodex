import {
  extractReviewCodeCommentsFromConversation,
  type ReviewCodeComment,
} from "@/lib/review-code-comments";
import type {
  CodexConversationSnapshot,
  CodexTurnDiffPatchBatch,
} from "@/lib/types";

export interface ReviewConversationProjection {
  threadId: string | null;
  cwd: string | null;
  lastTurnId: string | null;
  lastTurnEntryId: string | null;
  lastTurnPatch: string;
  lastTurnPatchBatches: CodexTurnDiffPatchBatch[];
  codeComments: ReviewCodeComment[];
  identity: string;
}

function extractLastTurnPatch(
  conversation: CodexConversationSnapshot | null,
): Pick<
  ReviewConversationProjection,
  | "lastTurnId"
  | "lastTurnEntryId"
  | "lastTurnPatch"
  | "lastTurnPatchBatches"
> {
  const turns = conversation?.turns ?? [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      const rawItem = item?.rawItem;
      if (typeof rawItem !== "object" || rawItem === null) continue;

      const unifiedDiff = (rawItem as { unifiedDiff?: unknown }).unifiedDiff;
      const patchBatches = (rawItem as { patchBatches?: unknown }).patchBatches;
      if (
        typeof unifiedDiff !== "string" ||
        (unifiedDiff.trim().length === 0 && !Array.isArray(patchBatches))
      ) {
        continue;
      }

      return {
        lastTurnId: turn.turnId,
        lastTurnEntryId: item?.entryId ?? item?.itemId ?? null,
        lastTurnPatch: unifiedDiff,
        lastTurnPatchBatches: Array.isArray(patchBatches)
          ? (patchBatches as CodexTurnDiffPatchBatch[])
          : [],
      };
    }

    if (typeof turn.diff === "string" && turn.diff.trim().length > 0) {
      return {
        lastTurnId: turn.turnId,
        lastTurnEntryId: null,
        lastTurnPatch: turn.diff,
        lastTurnPatchBatches: [],
      };
    }
  }

  return {
    lastTurnId: null,
    lastTurnEntryId: null,
    lastTurnPatch: "",
    lastTurnPatchBatches: [],
  };
}

export function buildReviewConversationProjection(
  conversation: CodexConversationSnapshot | null,
): ReviewConversationProjection {
  const lastTurn = extractLastTurnPatch(conversation);
  const codeComments = extractReviewCodeCommentsFromConversation(conversation);
  const identity = JSON.stringify([
    conversation?.threadId ?? null,
    conversation?.cwd ?? null,
    lastTurn.lastTurnId,
    lastTurn.lastTurnEntryId,
    lastTurn.lastTurnPatch,
    lastTurn.lastTurnPatchBatches,
    codeComments,
  ]);

  return {
    threadId: conversation?.threadId ?? null,
    cwd: conversation?.cwd ?? null,
    ...lastTurn,
    codeComments,
    identity,
  };
}

export function areReviewConversationProjectionsEqual(
  left: ReviewConversationProjection,
  right: ReviewConversationProjection,
): boolean {
  return left.identity === right.identity;
}

function itemMayAffectReviewProjection(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as {
    markdownText?: unknown;
    rawItem?: unknown;
  };
  if (
    typeof candidate.markdownText === "string" &&
    candidate.markdownText.includes("::code-comment")
  ) {
    return true;
  }
  if (typeof candidate.rawItem !== "object" || candidate.rawItem === null) {
    return false;
  }
  const rawItem = candidate.rawItem as {
    unifiedDiff?: unknown;
    patchBatches?: unknown;
    text?: unknown;
  };
  return (
    typeof rawItem.unifiedDiff === "string" ||
    Array.isArray(rawItem.patchBatches) ||
    (typeof rawItem.text === "string" &&
      rawItem.text.includes("::code-comment"))
  );
}

function canReuseReviewProjection(input: {
  previousConversation: CodexConversationSnapshot | null;
  conversation: CodexConversationSnapshot | null;
}): boolean {
  const previous = input.previousConversation;
  const current = input.conversation;
  if (!previous || !current) return previous === current;
  if (previous.threadId !== current.threadId || previous.cwd !== current.cwd) {
    return false;
  }

  if (
    current.turns.length >= previous.turns.length &&
    previous.turns.every((turn, index) => current.turns[index] === turn) &&
    current.turns.slice(previous.turns.length).every(
      (turn) =>
        (!turn.diff || turn.diff.trim().length === 0) &&
        !turn.items.some(itemMayAffectReviewProjection),
    )
  ) {
    return true;
  }

  const previousTurn = previous.turns.at(-1) ?? null;
  const currentTurn = current.turns.at(-1) ?? null;
  if (!previousTurn || !currentTurn) return previousTurn === currentTurn;
  if (
    previousTurn.turnId !== currentTurn.turnId ||
    previousTurn.diff !== currentTurn.diff
  ) {
    return false;
  }
  if (previousTurn.items === currentTurn.items) return true;

  const previousItems = previousTurn.items;
  const currentItems = currentTurn.items;
  const sharedLength = Math.min(previousItems.length, currentItems.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const previousItem = previousItems[index];
    const currentItem = currentItems[index];
    if (previousItem === currentItem) continue;
    if (
      itemMayAffectReviewProjection(previousItem) ||
      itemMayAffectReviewProjection(currentItem)
    ) {
      return false;
    }
  }
  for (let index = sharedLength; index < currentItems.length; index += 1) {
    if (itemMayAffectReviewProjection(currentItems[index])) return false;
  }
  for (let index = sharedLength; index < previousItems.length; index += 1) {
    if (itemMayAffectReviewProjection(previousItems[index])) return false;
  }
  return true;
}

export function createReviewConversationProjectionSelector(): (
  conversation: CodexConversationSnapshot | null,
) => ReviewConversationProjection {
  let previousConversation: CodexConversationSnapshot | null = null;
  let previousProjection = buildReviewConversationProjection(null);

  return (conversation) => {
    if (canReuseReviewProjection({ previousConversation, conversation })) {
      previousConversation = conversation;
      return previousProjection;
    }
    previousConversation = conversation;
    previousProjection = buildReviewConversationProjection(conversation);
    return previousProjection;
  };
}
