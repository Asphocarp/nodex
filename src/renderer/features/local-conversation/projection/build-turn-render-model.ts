import type { CodexConversationTurn } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import { buildRendererItemStream } from "./build-renderer-item-stream";
import { buildTurnViewModel } from "./build-turn-view-model";
import type { ThreadTurnModel } from "../thread-stage-types";

export interface BuildTurnRenderModelInput {
  turn: CodexConversationTurn;
  requests: CodexTurnScopedConversationRequest[];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  canEditTurnUserPrefix?: boolean;
  canForkTurnUserPrefix?: boolean;
}

function hasIncompleteElicitation(
  items: ReturnType<typeof buildRendererItemStream>,
): boolean {
  return items.some(
    (item) => item.type === "mcpServerElicitation" && item.status !== "completed",
  );
}

export function buildTurnRenderModel(
  input: BuildTurnRenderModelInput,
): ThreadTurnModel {
  const items = buildRendererItemStream({
    entries: input.turn.items,
    requests: input.requests,
    turnStatus: input.turn.status,
    isLatestTurn: input.isLatestTurn,
  });
  const buckets = bucketizeTurnItems({
    items,
    turnStatus: input.turn.status,
  });
  const isBlocked =
    buckets.approvalItems.length > 0
    || buckets.userInputItems.length > 0
    || hasIncompleteElicitation(items);

  return buildTurnViewModel({
    turnId: input.turn.turnId,
    turn: input.turn,
    buckets,
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked,
    canEditTurnUserPrefix: input.canEditTurnUserPrefix,
    canForkTurnUserPrefix: input.canForkTurnUserPrefix,
  });
}
