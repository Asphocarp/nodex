import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import { buildRendererItemStream, resolveWorkedForAdornment } from "./build-renderer-item-stream";
import { buildTurnViewModel } from "./build-turn-view-model";
import type { ThreadTranscriptBlockModel, ThreadTurnModel } from "../thread-stage-types";

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

export function buildTurnRenderModel(
  input: BuildTurnRenderModelInput,
): ThreadTurnModel {
  const entries = appendDerivedTurnDiffEntry(input.turn);
  const items = buildRendererItemStream({
    entries,
    requests: input.requests,
    turnStatus: input.turn.status,
    isLatestTurn: input.isLatestTurn,
  });
  const workedForAdornment = resolveWorkedForAdornment(
    items.filter((item): item is ThreadTranscriptBlockModel => "entry" in item),
    input.turn.status,
    input.isLatestTurn,
  );
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
    workedForAdornment,
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked,
    canEditTurnUserPrefix: input.canEditTurnUserPrefix,
    canForkTurn: input.canForkTurn,
  });
}
